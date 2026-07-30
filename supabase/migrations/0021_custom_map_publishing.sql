-- Immutable authored-map publishing, discovery, ranking and moderation.
--
-- Challenge chains remain the play-history model. These tables add the stable
-- map identity and immutable authored-room versions needed by the builder.

do $$ begin
  create type public.custom_map_visibility as enum ('public', 'unlisted', 'private');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.custom_map_moderation as enum ('active', 'quarantined', 'rejected');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.custom_map_event_type as enum ('impression', 'start', 'clear', 'like', 'share');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.custom_map_report_reason as enum ('unsafe', 'hate', 'harassment', 'sexual', 'personal_information', 'spam', 'broken', 'other');
exception when duplicate_object then null; end $$;

alter table public.profiles add column if not exists is_moderator boolean not null default false;

create table if not exists public.custom_maps (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(user_id) on delete cascade,
  title text not null check(char_length(btrim(title)) between 2 and 80 and title !~ '[[:cntrl:]]'),
  description text not null default '' check(char_length(description) <= 280 and description !~ '[[:cntrl:]]'),
  visibility public.custom_map_visibility not null default 'public',
  moderation_status public.custom_map_moderation not null default 'active',
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz not null default now()
);

create table if not exists public.custom_map_versions (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references public.custom_maps(id) on delete cascade,
  version_number integer not null check(version_number between 1 and 100),
  schema_version smallint not null default 1 check(schema_version = 1),
  challenge_slug text not null check(challenge_slug ~ '^[a-z0-9-]{6,24}$'),
  payload_code text not null check(char_length(payload_code) between 1 and 8000 and payload_code ~ '^[A-Za-z0-9_-]+$'),
  payload_hash text not null check(payload_hash ~ '^[0-9a-f]{64}$'),
  piece_count smallint not null check(piece_count between 1 and 96),
  trap_count smallint not null check(trap_count between 0 and 20),
  playable boolean not null default true,
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  unique(map_id, version_number),
  unique(map_id, payload_hash)
);

do $$ begin
  alter table public.custom_maps add constraint custom_maps_current_version_fk
    foreign key(current_version_id) references public.custom_map_versions(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists public.custom_map_events (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references public.custom_maps(id) on delete cascade,
  version_id uuid not null references public.custom_map_versions(id) on delete cascade,
  actor_id uuid not null references public.profiles(user_id) on delete cascade,
  event_type public.custom_map_event_type not null,
  created_at timestamptz not null default now(),
  unique(version_id, actor_id, event_type)
);

create table if not exists public.custom_map_reports (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references public.custom_maps(id) on delete cascade,
  version_id uuid not null references public.custom_map_versions(id) on delete cascade,
  reporter_id uuid not null references public.profiles(user_id) on delete cascade,
  reason public.custom_map_report_reason not null,
  note text not null default '' check(char_length(note) <= 500 and note !~ '[[:cntrl:]]'),
  status text not null default 'open' check(status in ('open', 'dismissed', 'actioned')),
  moderator_id uuid references public.profiles(user_id),
  moderator_note text not null default '' check(char_length(moderator_note) <= 500),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique(version_id, reporter_id)
);

create table if not exists public.custom_map_moderation_actions (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references public.custom_maps(id) on delete cascade,
  version_id uuid references public.custom_map_versions(id),
  moderator_id uuid not null references public.profiles(user_id),
  previous_status public.custom_map_moderation not null,
  next_status public.custom_map_moderation not null,
  note text not null default '' check(char_length(note) <= 500),
  created_at timestamptz not null default now()
);

create index if not exists custom_maps_public_browse_idx on public.custom_maps(published_at desc, id) where visibility='public' and moderation_status='active';
create index if not exists custom_maps_owner_idx on public.custom_maps(owner_id, updated_at desc);
create index if not exists custom_map_versions_map_idx on public.custom_map_versions(map_id, version_number desc);
create index if not exists custom_map_events_rank_idx on public.custom_map_events(version_id, event_type, created_at desc);
create index if not exists custom_map_reports_open_idx on public.custom_map_reports(map_id, created_at desc) where status='open';

alter table public.custom_maps enable row level security;
alter table public.custom_map_versions enable row level security;
alter table public.custom_map_events enable row level security;
alter table public.custom_map_reports enable row level security;
alter table public.custom_map_moderation_actions enable row level security;
revoke insert, update, delete, select on public.custom_maps, public.custom_map_versions, public.custom_map_events, public.custom_map_reports, public.custom_map_moderation_actions from anon, authenticated;

-- Decode just enough of the version-5 challenge envelope to make the database
-- boundary independently reject arbitrary text, legacy levels, mismatched
-- slugs and falsified counts. The application still runs the full physics and
-- placement decoder before invoking publish_custom_map.
create or replace function public.custom_map_code_payload(p_code text)
returns jsonb language plpgsql immutable security definer set search_path=public,pg_temp as $$
declare v_base64 text;v_payload jsonb;
begin
  if p_code is null or char_length(p_code) not between 1 and 8000 or p_code !~ '^[A-Za-z0-9_-]+$' then return null;end if;
  v_base64:=translate(p_code,'-_','+/');
  v_base64:=v_base64||repeat('=',(4-(char_length(v_base64)%4))%4);
  v_payload:=convert_from(decode(v_base64,'base64'),'UTF8')::jsonb;
  if jsonb_typeof(v_payload)<>'array' or jsonb_array_length(v_payload)<>10 or v_payload->>0<>'5' then return null;end if;
  if jsonb_typeof(v_payload->6)<>'array' or jsonb_array_length(v_payload->6)>20 then return null;end if;
  if jsonb_typeof(v_payload->7)<>'array' or jsonb_array_length(v_payload->7)<>5 or jsonb_typeof(v_payload->7->0)<>'array' or jsonb_array_length(v_payload->7->0) not between 1 and 96 then return null;end if;
  return v_payload;
exception when others then return null;end$$;

create or replace function public.custom_map_metrics(p_version_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
select jsonb_build_object(
  'impressions',count(*) filter(where event_type='impression'),
  'starts',count(*) filter(where event_type='start'),
  'clears',count(*) filter(where event_type='clear'),
  'likes',count(*) filter(where event_type='like'),
  'shares',count(*) filter(where event_type='share'),
  'reports',(select count(*) from public.custom_map_reports r where r.version_id=p_version_id and r.status='open')
) from public.custom_map_events where version_id=p_version_id
$$;

create or replace function public.custom_map_trending_score(p_map_id uuid)
returns double precision language sql stable security definer set search_path=public,pg_temp as $$
with current_data as(
  select m.current_version_id,m.published_at,
    count(*) filter(where e.event_type='impression')::double precision impressions,
    count(*) filter(where e.event_type='start')::double precision starts,
    count(*) filter(where e.event_type='clear')::double precision clears,
    count(*) filter(where e.event_type='like')::double precision likes,
    count(*) filter(where e.event_type='share')::double precision shares,
    (select count(*)::double precision from public.custom_map_reports r where r.version_id=m.current_version_id and r.status='open') reports
  from public.custom_maps m left join public.custom_map_events e on e.version_id=m.current_version_id
  where m.id=p_map_id group by m.current_version_id,m.published_at
)
select coalesce(
  (case when impressions<5 then .25 else 1 end)
  * (starts+3*clears+5*likes+4*shares-8*reports+4*((clears+1)/(starts+4)))
  * exp(-extract(epoch from(now()-published_at))/604800.0),0
) from current_data
$$;

create or replace function public.custom_map_version_json(p_version_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
select jsonb_build_object(
  'id',v.id,'number',v.version_number,'schemaVersion',v.schema_version,
  'challengeSlug',v.challenge_slug,'payloadHash',v.payload_hash,
  'pieceCount',v.piece_count,'trapCount',v.trap_count,'playable',v.playable,
  'createdAt',to_char(v.created_at at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
) from public.custom_map_versions v where v.id=p_version_id
$$;

create or replace function public.custom_map_summary(p_map_id uuid)
returns jsonb language sql stable security definer set search_path=public,auth,pg_temp as $$
select jsonb_build_object(
  'id',m.id,'title',m.title,'description',m.description,'visibility',m.visibility,
  'moderationStatus',m.moderation_status,'ownerName',p.display_name,
  'ownerAvatarSeed',p.avatar_seed,'currentVersion',public.custom_map_version_json(m.current_version_id),
  'metrics',public.custom_map_metrics(m.current_version_id),
  'trendingScore',public.custom_map_trending_score(m.id),
  'isOwner',coalesce(auth.uid()=m.owner_id,false),
  'canModerate',coalesce((select is_moderator from public.profiles where user_id=auth.uid()),false),
  'createdAt',to_char(m.created_at at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'updatedAt',to_char(m.updated_at at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'publishedAt',to_char(m.published_at at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
) from public.custom_maps m join public.profiles p on p.user_id=m.owner_id where m.id=p_map_id and m.current_version_id is not null
$$;

create or replace function public.get_custom_map(p_map_id uuid,p_version_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public,auth,pg_temp as $$
declare v_map public.custom_maps;v_version public.custom_map_versions;v_moderator boolean:=false;
begin
  select * into v_map from public.custom_maps where id=p_map_id;
  if not found then return null;end if;
  select coalesce(is_moderator,false) into v_moderator from public.profiles where user_id=auth.uid();
  if not(coalesce(auth.uid()=v_map.owner_id,false) or v_moderator or (v_map.visibility in('public','unlisted') and v_map.moderation_status='active')) then return null;end if;
  select * into v_version from public.custom_map_versions where id=coalesce(p_version_id,v_map.current_version_id) and map_id=v_map.id and playable;
  if not found then return null;end if;
  return public.custom_map_summary(v_map.id)||jsonb_build_object(
    'code',v_version.payload_code,
    'currentVersion',public.custom_map_version_json(v_version.id),
    'versions',(select coalesce(jsonb_agg(public.custom_map_version_json(v.id) order by v.version_number desc),'[]'::jsonb) from public.custom_map_versions v where v.map_id=v_map.id)
  );
end$$;

create or replace function public.browse_custom_maps(p_query text default '',p_sort text default 'trending',p_limit integer default 12,p_offset integer default 0,p_mine boolean default false)
returns jsonb language plpgsql stable security definer set search_path=public,auth,pg_temp as $$
declare v_limit integer:=least(24,greatest(1,p_limit));v_offset integer:=least(10000,greatest(0,p_offset));v_items jsonb;v_count integer;
begin
  if p_sort not in('trending','new') or char_length(coalesce(p_query,''))>80 then raise exception 'invalid_browse';end if;
  if p_mine and auth.uid() is null then raise exception 'auth_required';end if;
  with eligible as(
    select m.id,m.owner_id,m.published_at,public.custom_map_trending_score(m.id) score
    from public.custom_maps m
    where m.current_version_id is not null
      and (case when p_mine then m.owner_id=auth.uid() else m.visibility='public' and m.moderation_status='active' end)
      and (coalesce(p_query,'')='' or m.title ilike '%'||p_query||'%' or m.description ilike '%'||p_query||'%')
  ),diverse as(
    select *,row_number() over(partition by owner_id order by case when p_sort='trending' then score else 0 end desc,published_at desc,id) author_rank
    from eligible
  ),page as(
    select * from diverse where p_mine or author_rank<=2
    order by case when p_sort='trending' then score else 0 end desc,published_at desc,id
    offset v_offset limit v_limit
  )
  select coalesce(jsonb_agg(public.custom_map_summary(id) order by case when p_sort='trending' then score else 0 end desc,published_at desc,id),'[]'::jsonb) into v_items from page;
  with eligible as(
    select m.id,m.owner_id,m.published_at,public.custom_map_trending_score(m.id) score
    from public.custom_maps m where m.current_version_id is not null
      and (case when p_mine then m.owner_id=auth.uid() else m.visibility='public' and m.moderation_status='active' end)
      and (coalesce(p_query,'')='' or m.title ilike '%'||p_query||'%' or m.description ilike '%'||p_query||'%')
  ),diverse as(
    select *,row_number() over(partition by owner_id order by case when p_sort='trending' then score else 0 end desc,published_at desc,id) author_rank from eligible
  ) select count(*) into v_count from diverse where p_mine or author_rank<=2;
  return jsonb_build_object('items',v_items,'nextOffset',case when v_offset+v_limit<v_count then v_offset+v_limit else null end);
end$$;

create or replace function public.publish_custom_map(
  p_map_id uuid,p_expected_version_id uuid,p_title text,p_description text,
  p_visibility text,p_code text,p_challenge_slug text,p_piece_count integer,
  p_trap_count integer,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare v_uid uuid:=auth.uid();v_profile public.profiles;v_map public.custom_maps;v_version public.custom_map_versions;v_payload jsonb;v_hash text;v_response jsonb;v_existing public.mutation_idempotency;
begin
  perform public.ensure_profile();select * into v_profile from public.profiles where user_id=v_uid for update;
  select * into v_existing from public.mutation_idempotency where user_id=v_uid and operation='custom-map-publish' and idempotency_key=p_idempotency_key;
  if found then return v_existing.response_json;end if;
  if char_length(btrim(p_title)) not between 2 and 80 or char_length(p_description)>280 or p_title~'[[:cntrl:]]' or p_description~'[[:cntrl:]]' or p_title~*'(https?://|www\.|fuck|shit|cunt|nigg|fagg)' or p_description~*'(https?://|www\.|fuck|shit|cunt|nigg|fagg)' or p_visibility not in('public','unlisted','private') then raise exception 'invalid_metadata';end if;
  v_payload:=public.custom_map_code_payload(p_code);
  if v_payload is null or v_payload->>1<>p_challenge_slug or jsonb_array_length(v_payload->6)<>p_trap_count or jsonb_array_length(v_payload->7->0)<>p_piece_count then raise exception 'invalid_map_code';end if;
  v_hash:=encode(digest(p_code,'sha256'),'hex');
  if(select count(*) from public.custom_map_versions where created_by=v_uid and created_at>now()-interval '1 hour')>=30 then raise exception 'rate_limited';end if;
  if p_map_id is null then
    insert into public.custom_maps(owner_id,title,description,visibility) values(v_uid,btrim(p_title),btrim(p_description),p_visibility::public.custom_map_visibility) returning * into v_map;
  else
    select * into v_map from public.custom_maps where id=p_map_id for update;
    if not found then
      insert into public.custom_maps(id,owner_id,title,description,visibility) values(p_map_id,v_uid,btrim(p_title),btrim(p_description),p_visibility::public.custom_map_visibility) returning * into v_map;
    elsif v_map.owner_id<>v_uid then raise exception 'map_not_found';
    elsif v_map.current_version_id is distinct from p_expected_version_id then raise exception 'version_conflict';end if;
  end if;
  select * into v_version from public.custom_map_versions where map_id=v_map.id and payload_hash=v_hash;
  if not found then
    insert into public.custom_map_versions(map_id,version_number,challenge_slug,payload_code,payload_hash,piece_count,trap_count,created_by)
    values(v_map.id,coalesce((select max(version_number)+1 from public.custom_map_versions where map_id=v_map.id),1),p_challenge_slug,p_code,v_hash,p_piece_count,p_trap_count,v_uid) returning * into v_version;
  end if;
  update public.custom_maps set title=btrim(p_title),description=btrim(p_description),visibility=p_visibility::public.custom_map_visibility,current_version_id=v_version.id,updated_at=now(),published_at=now() where id=v_map.id;
  v_response:=public.get_custom_map(v_map.id,v_version.id);
  insert into public.mutation_idempotency(user_id,operation,idempotency_key,resource_id,response_json) values(v_uid,'custom-map-publish',p_idempotency_key,v_version.id,v_response);
  return v_response;
end$$;

create or replace function public.update_custom_map(p_map_id uuid,p_title text default null,p_description text default null,p_visibility text default null)
returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare v_map public.custom_maps;
begin
  perform public.ensure_profile();select * into v_map from public.custom_maps where id=p_map_id and owner_id=auth.uid() for update;if not found then raise exception 'map_not_found';end if;
  if p_title is not null and(char_length(btrim(p_title)) not between 2 and 80 or p_title~'[[:cntrl:]]' or p_title~*'(https?://|www\.|fuck|shit|cunt|nigg|fagg)') then raise exception 'invalid_metadata';end if;
  if p_description is not null and(char_length(p_description)>280 or p_description~'[[:cntrl:]]' or p_description~*'(https?://|www\.|fuck|shit|cunt|nigg|fagg)') then raise exception 'invalid_metadata';end if;
  if p_visibility is not null and p_visibility not in('public','unlisted','private') then raise exception 'invalid_metadata';end if;
  update public.custom_maps set title=coalesce(btrim(p_title),title),description=coalesce(btrim(p_description),description),visibility=coalesce(p_visibility::public.custom_map_visibility,visibility),updated_at=now() where id=p_map_id;
  return public.get_custom_map(p_map_id,null);
end$$;

create or replace function public.rollback_custom_map(p_map_id uuid,p_version_id uuid)
returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare v_map public.custom_maps;v_version public.custom_map_versions;
begin
  perform public.ensure_profile();select * into v_map from public.custom_maps where id=p_map_id and owner_id=auth.uid() for update;if not found then raise exception 'map_not_found';end if;
  select * into v_version from public.custom_map_versions where id=p_version_id and map_id=p_map_id and playable;if not found then raise exception 'version_not_found';end if;
  update public.custom_maps set current_version_id=v_version.id,updated_at=now(),published_at=now() where id=p_map_id;
  return public.get_custom_map(p_map_id,v_version.id);
end$$;

create or replace function public.record_custom_map_event(p_map_id uuid,p_version_id uuid,p_event_type text)
returns boolean language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare v_map public.custom_maps;
begin
  perform public.ensure_profile();if p_event_type not in('impression','start','clear','like','share') then raise exception 'invalid_event';end if;
  select * into v_map from public.custom_maps where id=p_map_id and visibility in('public','unlisted') and moderation_status='active' and exists(select 1 from public.custom_map_versions where id=p_version_id and map_id=p_map_id and playable);if not found then raise exception 'map_not_found';end if;
  insert into public.custom_map_events(map_id,version_id,actor_id,event_type) values(p_map_id,p_version_id,auth.uid(),p_event_type::public.custom_map_event_type) on conflict(version_id,actor_id,event_type) do nothing;
  return found;
end$$;

create or replace function public.report_custom_map(p_map_id uuid,p_version_id uuid,p_reason text,p_note text default '')
returns boolean language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare v_map public.custom_maps;v_inserted integer;
begin
  perform public.ensure_profile();if p_reason not in('unsafe','hate','harassment','sexual','personal_information','spam','broken','other') or char_length(p_note)>500 or p_note~'[[:cntrl:]]' then raise exception 'invalid_report';end if;
  select * into v_map from public.custom_maps where id=p_map_id and visibility in('public','unlisted') and moderation_status='active' and exists(select 1 from public.custom_map_versions where id=p_version_id and map_id=p_map_id and playable);if not found or v_map.owner_id=auth.uid() then raise exception 'map_not_found';end if;
  insert into public.custom_map_reports(map_id,version_id,reporter_id,reason,note) values(p_map_id,p_version_id,auth.uid(),p_reason::public.custom_map_report_reason,btrim(p_note)) on conflict(version_id,reporter_id) do nothing;
  get diagnostics v_inserted=row_count;
  if(select count(*) from public.custom_map_reports where map_id=p_map_id and status='open')>=3 then update public.custom_maps set moderation_status='quarantined',updated_at=now() where id=p_map_id;end if;
  return v_inserted>0;
end$$;

create or replace function public.moderate_custom_map(p_map_id uuid,p_status text,p_version_id uuid default null,p_note text default '')
returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare v_map public.custom_maps;v_previous public.custom_map_moderation;v_version public.custom_map_versions;
begin
  perform public.ensure_profile();if not coalesce((select is_moderator from public.profiles where user_id=auth.uid()),false) then raise exception 'moderator_required';end if;
  if p_status not in('active','quarantined','rejected') or char_length(p_note)>500 then raise exception 'invalid_moderation';end if;
  select * into v_map from public.custom_maps where id=p_map_id for update;if not found then raise exception 'map_not_found';end if;v_previous:=v_map.moderation_status;
  if p_version_id is not null then select * into v_version from public.custom_map_versions where id=p_version_id and map_id=p_map_id;if not found then raise exception 'version_not_found';end if;end if;
  update public.custom_maps set moderation_status=p_status::public.custom_map_moderation,current_version_id=coalesce(p_version_id,current_version_id),updated_at=now() where id=p_map_id;
  update public.custom_map_reports set status=case when p_status='active' then 'dismissed' else 'actioned' end,moderator_id=auth.uid(),moderator_note=btrim(p_note),decided_at=now() where map_id=p_map_id and status='open';
  insert into public.custom_map_moderation_actions(map_id,version_id,moderator_id,previous_status,next_status,note) values(p_map_id,p_version_id,auth.uid(),v_previous,p_status::public.custom_map_moderation,btrim(p_note));
  return public.get_custom_map(p_map_id,p_version_id);
end$$;

create or replace function public.reject_custom_map_version_mutation()
returns trigger language plpgsql as $$begin raise exception 'immutable_map_version';end$$;
drop trigger if exists custom_map_versions_immutable on public.custom_map_versions;
create trigger custom_map_versions_immutable before update on public.custom_map_versions for each row execute function public.reject_custom_map_version_mutation();

revoke all on function public.custom_map_code_payload(text),public.custom_map_metrics(uuid),public.custom_map_trending_score(uuid),public.custom_map_version_json(uuid),public.custom_map_summary(uuid),public.reject_custom_map_version_mutation() from public,anon,authenticated;
revoke all on function public.get_custom_map(uuid,uuid),public.browse_custom_maps(text,text,integer,integer,boolean),public.publish_custom_map(uuid,uuid,text,text,text,text,text,integer,integer,uuid),public.update_custom_map(uuid,text,text,text),public.rollback_custom_map(uuid,uuid),public.record_custom_map_event(uuid,uuid,text),public.report_custom_map(uuid,uuid,text,text),public.moderate_custom_map(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.get_custom_map(uuid,uuid),public.browse_custom_maps(text,text,integer,integer,boolean) to anon,authenticated;
grant execute on function public.publish_custom_map(uuid,uuid,text,text,text,text,text,integer,integer,uuid),public.update_custom_map(uuid,text,text,text),public.rollback_custom_map(uuid,uuid),public.record_custom_map_event(uuid,uuid,text),public.report_custom_map(uuid,uuid,text,text) to authenticated;
grant execute on function public.moderate_custom_map(uuid,text,uuid,text) to authenticated;
