-- 0019: the server learns what course a challenge is played on.
--
-- Until now the schema had no concept of a composed track (0008 says so in its
-- own comments), while every client feature grew one: fresh chains compose a
-- course from the segment catalogue, the track editor builds them by hand, and
-- the named map picker sends a chosen one. On the demo repository all of that
-- works because DemoRepository stores the track on the challenge; on THIS
-- schema the track was silently dropped - createRootChain() took no argument,
-- create_root_chain stored nothing, challenge_dto emitted nothing - so the
-- moment Supabase is configured, every picked map, every editor course and
-- every composed fresh chain would quietly open on the classic track instead.
-- Type-checked, tested, and wrong.
--
-- Three pieces, all additive:
--   1. challenges.track, a jsonb array of segment ids; null means the original
--      fixed course, exactly as the DTO's absent field does.
--   2. challenge_dto emits 'track' ONLY when non-null: challengeSchema is
--      .strict() with track OPTIONAL, so track:null would fail every client
--      parse. Absence is the wire format for "classic".
--   3. create_root_chain accepts p_track; a BEFORE INSERT trigger inherits the
--      parent's track onto children, which covers publish_child_challenge and
--      any future child-creating path without re-emitting that function here.
--
-- Server-side validation is shape-only (array, 1..12 short text ids). The
-- playability gate - isPlayableTrack - runs where the physics constants live,
-- in the client that composed the course; the server's job is to refuse
-- garbage, not to re-derive the jump budget.

alter table public.challenges
  add column if not exists track jsonb
  check (
    track is null
    or (jsonb_typeof(track) = 'array' and jsonb_array_length(track) between 1 and 12)
  );

-- ---------------------------------------------------------------------------
-- challenge_dto: faithful copy of 0007's body plus the conditional track key.
-- ---------------------------------------------------------------------------
create or replace function public.challenge_dto(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
select jsonb_build_object(
  'id', c.id,
  'slug', c.public_slug,
  'chainId', c.chain_id,
  'chainSlug', ch.public_slug,
  'parentSlug', p.public_slug,
  'depth', c.depth,
  'baseSeed', c.base_seed,
  'levelVersion', c.level_version,
  'createdByName', c.created_by_name,
  'createdByAvatarSeed', c.created_by_avatar_seed,
  'addedTrap', case
    when c.added_trap is null then null
    else jsonb_set(c.added_trap, '{ownerUserId}', 'null'::jsonb, true)
  end,
  'traps', coalesce((
    select jsonb_agg(jsonb_set(trap.value, '{ownerUserId}', 'null'::jsonb, true))
    from jsonb_array_elements(coalesce(c.traps, '[]'::jsonb)) trap(value)
  ), '[]'::jsonb),
  'ghostTrace', c.ghost_trace,
  'stats', jsonb_build_object(
    'attempts', c.attempts_count,
    'completions', c.completions_count,
    'survivalRate', case
      when c.attempts_count = 0 then null
      else c.completions_count::double precision / c.attempts_count
    end,
    'bestTimeMs', c.best_time_ms,
    'recentAttempts', c.attempts_count,
    'shareCount', c.share_count
  ),
  'createdAt', to_char(c.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'isDemo', false
)
-- Appended rather than inlined above so the 0007 body stays byte-comparable.
|| case when c.track is null then '{}'::jsonb else jsonb_build_object('track', c.track) end
from public.challenges c
join public.chains ch on ch.id = c.chain_id
left join public.challenges p on p.id = c.parent_id
where c.id = p_id
$$;

update public.challenges
set public_payload = public.challenge_dto(id);

revoke all on function public.challenge_dto(uuid) from public, anon, authenticated;
grant execute on function public.challenge_dto(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_root_chain: same body as 0004 plus p_track validation and storage.
-- The old single-argument overload is dropped so there is exactly one
-- function; leaving both would let a stale client keep calling the one that
-- loses the course.
-- ---------------------------------------------------------------------------
drop function if exists public.create_root_chain(uuid);

create or replace function public.create_root_chain(p_idempotency_key uuid, p_track jsonb default null)
returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare v_uid uuid:=auth.uid();v_existing public.mutation_idempotency;v_profile public.profiles;v_chain public.chains;v_challenge public.challenges;v_seed integer;v_slug text;v_entry jsonb;
begin
  if p_track is not null then
    if jsonb_typeof(p_track)<>'array' or jsonb_array_length(p_track) not between 1 and 12 then raise exception 'invalid_track';end if;
    for v_entry in select value from jsonb_array_elements(p_track) loop
      if jsonb_typeof(v_entry)<>'string' or length(v_entry #>> '{}') not between 2 and 24 or (v_entry #>> '{}') !~ '^[a-z][a-z-]*$' then raise exception 'invalid_track';end if;
    end loop;
  end if;
  perform public.ensure_profile();select * into v_profile from public.profiles where user_id=v_uid for update;
  select * into v_existing from public.mutation_idempotency where user_id=v_uid and operation='root' and idempotency_key=p_idempotency_key;
  if found then return coalesce(v_existing.response_json,public.challenge_dto(v_existing.resource_id));end if;
  if (select count(*) from public.chains where owner_id=v_uid and created_at>now()-interval '1 hour')>=10 then raise exception 'rate_limited';end if;
  v_seed:=abs(hashtext(gen_random_uuid()::text));v_slug:='fresh-'||substr(encode(gen_random_bytes(8),'hex'),1,12);
  insert into public.chains(public_slug,owner_id,base_seed) values('chain-'||substr(encode(gen_random_bytes(8),'hex'),1,12),v_uid,v_seed) returning * into v_chain;
  insert into public.challenges(chain_id,public_slug,depth,created_by,created_by_name,created_by_avatar_seed,base_seed,traps,track) values(v_chain.id,v_slug,0,v_uid,v_profile.display_name,v_profile.avatar_seed,v_seed,'[]',p_track) returning * into v_challenge;
  perform public.refresh_challenge_payload(v_challenge.id);
  insert into public.mutation_idempotency(user_id,operation,idempotency_key,resource_id,response_json) values(v_uid,'root',p_idempotency_key,v_challenge.id,public.challenge_dto(v_challenge.id));
  return public.challenge_dto(v_challenge.id);
end$$;

revoke all on function public.create_root_chain(uuid, jsonb) from public, anon;
grant execute on function public.create_root_chain(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Children inherit the course. A trigger rather than an edit to
-- publish_child_challenge, so every path that inserts a child row - including
-- ones that do not exist yet - carries the track forward, and the 150-line
-- publish function does not need to be re-emitted to change one insert.
-- ---------------------------------------------------------------------------
create or replace function public.inherit_parent_track()
returns trigger language plpgsql as $$
begin
  if new.parent_id is not null and new.track is null then
    select track into new.track from public.challenges where id = new.parent_id;
  end if;
  return new;
end$$;

drop trigger if exists challenges_inherit_parent_track on public.challenges;
create trigger challenges_inherit_parent_track
  before insert on public.challenges
  for each row execute function public.inherit_parent_track();
