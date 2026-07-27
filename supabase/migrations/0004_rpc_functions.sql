create or replace function public.ensure_profile(p_display_name text default null) returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare v_uid uuid:=auth.uid();v_profile public.profiles;v_name text;
begin
  if v_uid is null then raise exception 'auth_required';end if;
  select * into v_profile from public.profiles where user_id=v_uid;
  if not found then
    v_name:=coalesce(nullif(btrim(p_display_name),''),'Wobbly Badger');
    if char_length(v_name) not between 2 and 24 or v_name~'[[:cntrl:]]' or v_name~*'(https?://|www\.)' then raise exception 'invalid_name';end if;
    insert into public.profiles(user_id,display_name,avatar_seed) values(v_uid,v_name,abs(hashtext(v_uid::text))) returning * into v_profile;
  end if;
  if v_profile.is_blocked then raise exception 'blocked';end if;
  return jsonb_build_object('id',v_profile.user_id,'displayName',v_profile.display_name,'avatarSeed',v_profile.avatar_seed);
end$$;

create or replace function public.update_profile(p_display_name text) returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare v_uid uuid:=auth.uid();v_name text:=regexp_replace(btrim(p_display_name),'\s+',' ','g');v_profile public.profiles;
begin
  perform public.ensure_profile();if char_length(v_name) not between 2 and 24 or v_name~'[[:cntrl:]]' or v_name~*'(https?://|www\.|fuck|shit|cunt|nigg|fagg)' then raise exception 'invalid_name';end if;
  if (select count(*) from public.mutation_idempotency where user_id=v_uid and operation='profile' and created_at>now()-interval '1 hour')>=20 then raise exception 'rate_limited';end if;
  update public.profiles set display_name=v_name,updated_at=now() where user_id=v_uid returning * into v_profile;
  insert into public.mutation_idempotency(user_id,operation,idempotency_key) values(v_uid,'profile',gen_random_uuid());
  return jsonb_build_object('id',v_profile.user_id,'displayName',v_profile.display_name,'avatarSeed',v_profile.avatar_seed);
end$$;

create or replace function public.challenge_dto(p_id uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
select jsonb_build_object(
  'id',c.id,'slug',c.public_slug,'chainId',c.chain_id,'chainSlug',ch.public_slug,'parentSlug',p.public_slug,'depth',c.depth,'baseSeed',c.base_seed,'levelVersion',c.level_version,
  'createdByName',c.created_by_name,'createdByAvatarSeed',c.created_by_avatar_seed,'addedTrap',c.added_trap,'traps',c.traps,'ghostTrace',c.ghost_trace,
  'stats',jsonb_build_object('attempts',c.attempts_count,'completions',c.completions_count,'survivalRate',case when c.attempts_count=0 then null else c.completions_count::double precision/c.attempts_count end,'bestTimeMs',c.best_time_ms,'recentAttempts',c.attempts_count,'shareCount',c.share_count),
  'createdAt',to_char(c.created_at at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'isDemo',false)
from public.challenges c join public.chains ch on ch.id=c.chain_id left join public.challenges p on p.id=c.parent_id where c.id=p_id
$$;
create or replace function public.refresh_challenge_payload(p_id uuid) returns void language sql security definer set search_path=public,pg_temp as $$update public.challenges set public_payload=public.challenge_dto(p_id) where id=p_id$$;

create or replace function public.create_root_chain(p_idempotency_key uuid) returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare v_uid uuid:=auth.uid();v_existing public.mutation_idempotency;v_profile public.profiles;v_chain public.chains;v_challenge public.challenges;v_seed integer;v_slug text;
begin
  perform public.ensure_profile();select * into v_profile from public.profiles where user_id=v_uid for update;
  select * into v_existing from public.mutation_idempotency where user_id=v_uid and operation='root' and idempotency_key=p_idempotency_key;
  if found then return coalesce(v_existing.response_json,public.challenge_dto(v_existing.resource_id));end if;
  if (select count(*) from public.chains where owner_id=v_uid and created_at>now()-interval '1 hour')>=10 then raise exception 'rate_limited';end if;
  v_seed:=abs(hashtext(gen_random_uuid()::text));v_slug:='fresh-'||substr(encode(gen_random_bytes(8),'hex'),1,12);
  insert into public.chains(public_slug,owner_id,base_seed) values('chain-'||substr(encode(gen_random_bytes(8),'hex'),1,12),v_uid,v_seed) returning * into v_chain;
  insert into public.challenges(chain_id,public_slug,depth,created_by,created_by_name,created_by_avatar_seed,base_seed,traps) values(v_chain.id,v_slug,0,v_uid,v_profile.display_name,v_profile.avatar_seed,v_seed,'[]') returning * into v_challenge;
  perform public.refresh_challenge_payload(v_challenge.id);
  insert into public.mutation_idempotency(user_id,operation,idempotency_key,resource_id,response_json) values(v_uid,'root',p_idempotency_key,v_challenge.id,public.challenge_dto(v_challenge.id));
  return public.challenge_dto(v_challenge.id);
end$$;

create or replace function public.start_attempt(p_challenge_slug text,p_client_session_id uuid,p_device_class text,p_build_version text,p_idempotency_key uuid,p_share_token text default null) returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare v_uid uuid:=auth.uid();v_attempt public.attempts;v_challenge public.challenges;v_valid_share text;
begin
  perform public.ensure_profile();select * into v_attempt from public.attempts where user_id=v_uid and idempotency_key=p_idempotency_key;if found then return jsonb_build_object('attemptId',v_attempt.id,'offeredTraps',v_attempt.offered_traps);end if;
  if (select count(*) from public.attempts where user_id=v_uid and started_at>now()-interval '1 hour')>=120 then raise exception 'rate_limited';end if;
  if exists(select 1 from public.attempts where user_id=v_uid and started_at>now()-interval '300 milliseconds') then raise exception 'too_fast';end if;
  select * into v_challenge from public.challenges where public_slug=p_challenge_slug and is_published and status='active' for update;if not found then raise exception 'challenge_not_found';end if;
  if p_share_token is not null and exists(select 1 from public.shares s where s.share_token=p_share_token and s.challenge_id=v_challenge.id) then v_valid_share:=p_share_token;end if;
  insert into public.attempts(challenge_id,user_id,client_session_id,idempotency_key,share_token,device_class,build_version) values(v_challenge.id,v_uid,p_client_session_id,p_idempotency_key,v_valid_share,p_device_class,left(p_build_version,80)) returning * into v_attempt;
  update public.challenges set attempts_count=attempts_count+1,last_played_at=now() where id=v_challenge.id;perform public.refresh_challenge_payload(v_challenge.id);
  return jsonb_build_object('attemptId',v_attempt.id,'offeredTraps',null);
end$$;

create or replace function public.finish_attempt(p_attempt_id uuid,p_outcome text,p_duration_ms integer,p_max_progress double precision,p_death_trap_instance_id text,p_ghost_trace jsonb,p_idempotency_key uuid) returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare v_uid uuid:=auth.uid();v_attempt public.attempts;v_challenge public.challenges;v_choices text[];
begin
  perform public.ensure_profile();select * into v_attempt from public.attempts where id=p_attempt_id and user_id=v_uid for update;if not found then raise exception 'attempt_not_found';end if;
  select * into v_challenge from public.challenges where id=v_attempt.challenge_id for update;
  if v_attempt.outcome<>'started' then return jsonb_build_object('attemptId',v_attempt.id,'outcome',v_attempt.outcome,'offeredTraps',v_attempt.offered_traps,'stats',public.challenge_dto(v_challenge.id)->'stats');end if;
  if p_outcome not in('completed','fell','timeout','reset','quit') or p_duration_ms not between 0 and 90000 or p_max_progress not between 0 and 1.1 then raise exception 'invalid_finish';end if;
  if p_duration_ms>extract(epoch from(now()-v_attempt.started_at))*1000+15000 then raise exception 'implausible_duration';end if;
  if p_outcome='completed' then
    if p_ghost_trace is null or p_ghost_trace->>'version'<>'1' or p_ghost_trace->>'hz'<>'15' or jsonb_typeof(p_ghost_trace->'frames')<>'array' or jsonb_array_length(p_ghost_trace->'frames')>900 then raise exception 'invalid_ghost';end if;
    if v_challenge.depth<20 then select array_agg(type order by md5(v_attempt.id::text||type)) into v_choices from (select type from public.trap_catalog where enabled order by md5(v_attempt.id::text||type) limit 3) q;end if;
  elsif p_ghost_trace is not null then raise exception 'ghost_not_allowed';end if;
  update public.attempts set outcome=p_outcome::public.attempt_outcome,finished_at=now(),duration_ms=p_duration_ms,max_progress=p_max_progress,death_trap_instance_id=p_death_trap_instance_id,ghost_trace=case when p_outcome='completed' then p_ghost_trace else null end,offered_traps=v_choices,finish_idempotency_key=p_idempotency_key where id=v_attempt.id returning * into v_attempt;
  if p_outcome='completed' then update public.challenges set completions_count=completions_count+1,best_time_ms=case when best_time_ms is null then p_duration_ms else least(best_time_ms,p_duration_ms) end where id=v_challenge.id;update public.share_visits set completed_attempt_id=v_attempt.id where viewer_id=v_uid and share_id in(select id from public.shares where share_token=v_attempt.share_token);end if;
  perform public.refresh_challenge_payload(v_challenge.id);
  return jsonb_build_object('attemptId',v_attempt.id,'outcome',v_attempt.outcome,'offeredTraps',v_attempt.offered_traps,'stats',public.challenge_dto(v_challenge.id)->'stats');
end$$;

create or replace function public.publish_child_challenge(p_parent_slug text,p_attempt_id uuid,p_placement jsonb,p_idempotency_key uuid) returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare v_uid uuid:=auth.uid();v_attempt public.attempts;v_parent public.challenges;v_profile public.profiles;v_zone public.placement_zones;v_catalog public.trap_catalog;v_type text;v_zone_id text;v_ox double precision;v_oz double precision;v_q integer;v_x double precision;v_z double precision;v_seed integer;v_trap jsonb;v_child public.challenges;v_slug text;v_before double precision;v_after double precision;v_worse integer;
begin
  perform public.ensure_profile();select * into v_profile from public.profiles where user_id=v_uid;select * into v_attempt from public.attempts where id=p_attempt_id and user_id=v_uid for update;if not found then raise exception 'attempt_not_found';end if;
  select * into v_parent from public.challenges where id=v_attempt.challenge_id and public_slug=p_parent_slug for update;if not found then raise exception 'parent_mismatch';end if;
  if v_attempt.published_child_id is not null then select * into v_child from public.challenges where id=v_attempt.published_child_id;return jsonb_build_object('challenge',public.challenge_dto(v_child.id),'attributedShareUrl','/c/'||v_child.public_slug,'estimatedWorsePercent',1);end if;
  if v_attempt.outcome<>'completed' or v_parent.depth>=20 then raise exception 'completion_required';end if;
  if exists(select 1 from jsonb_object_keys(p_placement) k where k not in('type','zoneId','offsetX','offsetZ','rotationQuarterTurns')) then raise exception 'unknown_placement_key';end if;
  v_type:=p_placement->>'type';v_zone_id:=p_placement->>'zoneId';v_ox:=(p_placement->>'offsetX')::double precision;v_oz:=(p_placement->>'offsetZ')::double precision;v_q:=(p_placement->>'rotationQuarterTurns')::integer;
  if not(v_type=any(v_attempt.offered_traps)) or v_q not between 0 and 3 or abs(v_ox)>20 or abs(v_oz)>20 or abs(v_ox*4-round(v_ox*4))>.00001 or abs(v_oz*4-round(v_oz*4))>.00001 then raise exception 'invalid_placement';end if;
  select * into v_zone from public.placement_zones where id=v_zone_id;select * into v_catalog from public.trap_catalog where type=v_type and enabled;if v_zone.id is null or v_catalog.type is null or not(v_type=any(v_zone.allowed_types)) then raise exception 'type_not_allowed';end if;
  if (select count(*) from jsonb_array_elements(v_parent.traps) t where t->>'zoneId'=v_zone_id)>=v_zone.max_occupants then raise exception 'zone_full';end if;
  v_x:=(v_zone.min_x+v_zone.max_x)/2+v_ox;v_z:=(v_zone.min_z+v_zone.max_z)/2+v_oz;
  if v_x-v_catalog.placement_radius*.5<v_zone.min_x or v_x+v_catalog.placement_radius*.5>v_zone.max_x or v_z-v_catalog.placement_radius*.5<v_zone.min_z or v_z+v_catalog.placement_radius*.5>v_zone.max_z then raise exception 'outside_zone';end if;
  if exists(select 1 from jsonb_array_elements(v_parent.traps) t join public.trap_catalog tc on tc.type=t->>'type' where sqrt(power(v_x-(t->'position'->>0)::double precision,2)+power(v_z-(t->'position'->>2)::double precision,2))<.75*(v_catalog.placement_radius+tc.placement_radius)) then raise exception 'overlap';end if;
  if sqrt(power(v_x,2)+power(v_z-1.2,2))<2.2+v_catalog.placement_radius or sqrt(power(v_x,2)+power(v_z-40.25,2))<1.5+v_catalog.placement_radius then raise exception 'protected_area';end if;
  if (select count(*) from public.challenges c where c.created_by=v_uid and c.created_at>now()-interval '1 hour' and c.depth>0)>=30 then raise exception 'rate_limited';end if;
  v_seed:=abs(hashtext(v_attempt.id::text||v_type||v_zone_id));
  v_trap:=jsonb_build_object('id','trap_'||substr(md5(v_attempt.id::text||v_type),1,12),'type',v_type,'ownerUserId',v_uid,'ownerName',v_profile.display_name,'ownerAvatarSeed',v_profile.avatar_seed,'depthAdded',v_parent.depth+1,'zoneId',v_zone_id,'position',jsonb_build_array(v_x,v_zone.ground_y,v_z),'rotationY',v_q*pi()/2,'seed',v_seed,'params',jsonb_build_object());
  v_slug:='worse-'||substr(encode(gen_random_bytes(8),'hex'),1,12);
  insert into public.challenges(chain_id,parent_id,public_slug,depth,created_by,created_by_name,created_by_avatar_seed,base_seed,traps,added_trap,ghost_trace,parent_completion_attempt_id) values(v_parent.chain_id,v_parent.id,v_slug,v_parent.depth+1,v_uid,v_profile.display_name,v_profile.avatar_seed,v_parent.base_seed,v_parent.traps||jsonb_build_array(v_trap),v_trap,v_attempt.ghost_trace,v_attempt.id) returning * into v_child;
  update public.attempts set published_child_id=v_child.id where id=v_attempt.id;perform public.refresh_challenge_payload(v_child.id);
  v_before:=1/(1+exp(-(2.35-.43*v_parent.depth)));v_after:=1/(1+exp(-(2.35-.43*(v_parent.depth+v_catalog.risk_weight))));v_worse:=least(99,greatest(1,round(100*(v_before-v_after)/v_before)::integer));
  return jsonb_build_object('challenge',public.challenge_dto(v_child.id),'attributedShareUrl','/c/'||v_child.public_slug,'estimatedWorsePercent',v_worse);
end$$;

create or replace function public.create_share(p_challenge_slug text,p_channel text,p_idempotency_key uuid) returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare v_uid uuid:=auth.uid();v_share public.shares;v_challenge public.challenges;begin perform public.ensure_profile();select * into v_share from public.shares where user_id=v_uid and idempotency_key=p_idempotency_key;if found then return jsonb_build_object('shareToken',v_share.share_token,'url','/c/'||p_challenge_slug||'?s='||v_share.share_token);end if;if (select count(*) from public.shares where user_id=v_uid and created_at>now()-interval '1 hour')>=100 then raise exception 'rate_limited';end if;select * into v_challenge from public.challenges where public_slug=p_challenge_slug and is_published and status='active' for update;if not found then raise exception 'challenge_not_found';end if;insert into public.shares(share_token,challenge_id,user_id,channel,idempotency_key) values(substr(encode(gen_random_bytes(9),'base64'),1,12),v_challenge.id,v_uid,p_channel::public.share_channel,p_idempotency_key) returning * into v_share;update public.challenges set share_count=share_count+1 where id=v_challenge.id;perform public.refresh_challenge_payload(v_challenge.id);return jsonb_build_object('shareToken',v_share.share_token,'url','/c/'||p_challenge_slug||'?s='||v_share.share_token);end$$;
create or replace function public.record_share_open(p_share_token text,p_challenge_slug text) returns void language plpgsql security definer set search_path=public,auth,pg_temp as $$declare v_uid uuid:=auth.uid();v_share public.shares;begin perform public.ensure_profile();select s.* into v_share from public.shares s join public.challenges c on c.id=s.challenge_id where s.share_token=p_share_token and c.public_slug=p_challenge_slug;if not found or v_share.user_id=v_uid then return;end if;insert into public.share_visits(share_id,viewer_id,challenge_id) values(v_share.id,v_uid,v_share.challenge_id) on conflict do nothing;end$$;
create or replace function public.get_trending_challenges(p_limit integer default 6) returns setof jsonb language sql stable security definer set search_path=public,pg_temp as $$select public.challenge_dto(id) from public.challenges where is_published and status='active' order by (attempts_count+3*completions_count+5*share_count+.2*depth) desc,last_played_at desc nulls last limit least(6,greatest(1,p_limit))$$;

revoke all on function public.ensure_profile(text),public.update_profile(text),public.create_root_chain(uuid),public.start_attempt(text,uuid,text,text,uuid,text),public.finish_attempt(uuid,text,integer,double precision,text,jsonb,uuid),public.publish_child_challenge(text,uuid,jsonb,uuid),public.create_share(text,text,uuid),public.record_share_open(text,text) from public,anon;
grant execute on function public.ensure_profile(text),public.update_profile(text),public.create_root_chain(uuid),public.start_attempt(text,uuid,text,text,uuid,text),public.finish_attempt(uuid,text,integer,double precision,text,jsonb,uuid),public.publish_child_challenge(text,uuid,jsonb,uuid),public.create_share(text,text,uuid),public.record_share_open(text,text) to authenticated;
grant execute on function public.get_trending_challenges(integer),public.challenge_dto(uuid) to anon,authenticated;
