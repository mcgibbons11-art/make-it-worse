-- Security and integrity hardening for the public Data API surface.

drop policy if exists profiles_update_own on public.profiles;
revoke update on public.profiles from anon, authenticated;

drop policy if exists challenges_public_read on public.challenges;
revoke select on public.challenges from anon, authenticated;

create or replace function public.ensure_profile(p_display_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_name text;
begin
  if v_uid is null then
    raise exception 'auth_required';
  end if;

  select * into v_profile from public.profiles where user_id = v_uid;
  if not found then
    v_name := regexp_replace(
      btrim(coalesce(nullif(p_display_name, ''), 'Wobbly Badger')),
      '\s+',
      ' ',
      'g'
    );
    if char_length(v_name) not between 2 and 24
      or v_name ~ '[[:cntrl:]]'
      or v_name !~ '[[:alnum:]]'
      or v_name ~* '(https?://|www\.|fuck|shit|cunt|nigg|fagg)'
    then
      raise exception 'invalid_name';
    end if;

    insert into public.profiles(user_id, display_name, avatar_seed)
    values (v_uid, v_name, (hashtextextended(v_uid::text, 0) & 2147483647)::integer)
    returning * into v_profile;
  end if;

  if v_profile.is_blocked then
    raise exception 'blocked';
  end if;

  return jsonb_build_object(
    'id', v_profile.user_id,
    'displayName', v_profile.display_name,
    'avatarSeed', v_profile.avatar_seed
  );
end
$$;

create or replace function public.update_profile(p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := regexp_replace(btrim(p_display_name), '\s+', ' ', 'g');
  v_profile public.profiles;
begin
  perform public.ensure_profile();
  if char_length(v_name) not between 2 and 24
    or v_name ~ '[[:cntrl:]]'
    or v_name !~ '[[:alnum:]]'
    or v_name ~* '(https?://|www\.|fuck|shit|cunt|nigg|fagg)'
  then
    raise exception 'invalid_name';
  end if;

  if (
    select count(*)
    from public.mutation_idempotency
    where user_id = v_uid
      and operation = 'profile'
      and created_at > now() - interval '1 hour'
  ) >= 20 then
    raise exception 'rate_limited';
  end if;

  update public.profiles
  set display_name = v_name, updated_at = now()
  where user_id = v_uid
  returning * into v_profile;

  insert into public.mutation_idempotency(user_id, operation, idempotency_key)
  values (v_uid, 'profile', gen_random_uuid());

  return jsonb_build_object(
    'id', v_profile.user_id,
    'displayName', v_profile.display_name,
    'avatarSeed', v_profile.avatar_seed
  );
end
$$;

-- This helper intentionally remains callable only by the migration owner and
-- other SECURITY DEFINER functions. It mirrors the browser schema at the trust
-- boundary so callers cannot bypass validation by invoking PostgREST directly.
create or replace function public.is_valid_ghost_trace(
  p_trace jsonb,
  p_duration_ms integer
)
returns boolean
language plpgsql
immutable
security definer
set search_path = public, pg_temp
as $$
declare
  v_trace_duration integer;
  v_frame_count integer;
  v_frame jsonb;
  v_component jsonb;
  v_number numeric;
begin
  if p_trace is null or jsonb_typeof(p_trace) <> 'object' then
    return false;
  end if;
  if exists (
    select 1
    from jsonb_object_keys(p_trace) as trace_keys(trace_key)
    where trace_key not in ('version', 'hz', 'durationMs', 'frames')
  ) then
    return false;
  end if;
  if jsonb_typeof(p_trace -> 'version') <> 'number'
    or jsonb_typeof(p_trace -> 'hz') <> 'number'
    or jsonb_typeof(p_trace -> 'durationMs') <> 'number'
    or jsonb_typeof(p_trace -> 'frames') <> 'array'
  then
    return false;
  end if;
  if (p_trace ->> 'version')::numeric <> 1
    or (p_trace ->> 'hz')::numeric <> 15
  then
    return false;
  end if;

  if (p_trace ->> 'durationMs')::numeric
    <> trunc((p_trace ->> 'durationMs')::numeric)
  then
    return false;
  end if;
  v_trace_duration := (p_trace ->> 'durationMs')::integer;
  v_frame_count := jsonb_array_length(p_trace -> 'frames');
  if v_trace_duration not between 0 and 60000
    or v_frame_count > 900
    or abs(v_trace_duration - least(p_duration_ms, 60000)) > 1100
    or abs((v_frame_count::numeric / 15 * 1000) - v_trace_duration) > 1100
  then
    return false;
  end if;

  for v_frame in select value from jsonb_array_elements(p_trace -> 'frames') loop
    if jsonb_typeof(v_frame) <> 'array' or jsonb_array_length(v_frame) <> 5 then
      return false;
    end if;
    for v_component in select value from jsonb_array_elements(v_frame) loop
      if jsonb_typeof(v_component) <> 'number' then
        return false;
      end if;
      v_number := v_component::text::numeric;
      if v_number <> trunc(v_number) or abs(v_number) > 1000000 then
        return false;
      end if;
    end loop;
  end loop;

  return true;
exception when others then
  return false;
end
$$;

-- The current placement UI starts a selected trap at the center of a zone.
-- Only offer types that have at least one center position the canonical client
-- and server rules both accept.
create or replace function public.has_legal_center_placement(
  p_type text,
  p_traps jsonb
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.trap_catalog tc
    join public.placement_zones z on tc.type = any(z.allowed_types)
    cross join lateral (
      select (z.min_x + z.max_x) / 2 as x, (z.min_z + z.max_z) / 2 as zed
    ) center
    where tc.type = p_type
      and tc.enabled
      and (
        select count(*)
        from jsonb_array_elements(coalesce(p_traps, '[]'::jsonb)) trap
        where trap ->> 'zoneId' = z.id
      ) < z.max_occupants
      and center.x - tc.placement_radius * .5 >= z.min_x
      and center.x + tc.placement_radius * .5 <= z.max_x
      and center.zed - tc.placement_radius * .5 >= z.min_z
      and center.zed + tc.placement_radius * .5 <= z.max_z
      and sqrt(power(center.x, 2) + power(center.zed - 1.2, 2)) >= 2.2 + tc.placement_radius
      and sqrt(power(center.x, 2) + power(center.zed - 40.25, 2)) >= 1.5 + tc.placement_radius
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(p_traps, '[]'::jsonb)) trap
        join public.trap_catalog other on other.type = trap ->> 'type'
        where sqrt(
          power(center.x - (trap -> 'position' ->> 0)::double precision, 2)
          + power(center.zed - (trap -> 'position' ->> 2)::double precision, 2)
        ) < (case when z.id like 'bridge%' then .95 else .75 end)
          * (tc.placement_radius + other.placement_radius)
      )
  )
$$;

create or replace function public.finish_attempt(
  p_attempt_id uuid,
  p_outcome text,
  p_duration_ms integer,
  p_max_progress double precision,
  p_death_trap_instance_id text,
  p_ghost_trace jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_attempt public.attempts;
  v_challenge public.challenges;
  v_choices text[];
  v_category text;
  v_pick text;
  v_elapsed_ms double precision;
begin
  perform public.ensure_profile();
  select * into v_attempt
  from public.attempts
  where id = p_attempt_id and user_id = v_uid
  for update;
  if not found then
    raise exception 'attempt_not_found';
  end if;

  select * into v_challenge
  from public.challenges
  where id = v_attempt.challenge_id
  for update;

  if v_attempt.outcome <> 'started' then
    return jsonb_build_object(
      'attemptId', v_attempt.id,
      'outcome', v_attempt.outcome,
      'offeredTraps', v_attempt.offered_traps,
      'stats', public.challenge_dto(v_challenge.id) -> 'stats'
    );
  end if;

  if p_outcome not in ('completed', 'fell', 'timeout', 'reset', 'quit')
    or p_duration_ms not between 0 and 90000
    or p_max_progress not between 0 and 1.1
  then
    raise exception 'invalid_finish';
  end if;

  v_elapsed_ms := extract(epoch from (now() - v_attempt.started_at)) * 1000;
  if p_duration_ms > v_elapsed_ms + 3000
    or p_duration_ms < greatest(0, v_elapsed_ms - 15000)
  then
    raise exception 'implausible_duration';
  end if;

  if p_outcome = 'completed' then
    if v_elapsed_ms < 4500 or p_duration_ms < 4500 or p_max_progress < .99 then
      raise exception 'implausible_completion';
    end if;
    if not public.is_valid_ghost_trace(p_ghost_trace, p_duration_ms) then
      raise exception 'invalid_ghost';
    end if;

    if v_challenge.depth < 20 then
      v_choices := array[]::text[];
      foreach v_category in array array['sweeper', 'movement', 'prop'] loop
        select tc.type into v_pick
        from public.trap_catalog tc
        where tc.enabled
          and tc.category = v_category
          and not (tc.type = any(v_choices))
          and public.has_legal_center_placement(tc.type, v_challenge.traps)
        order by md5(v_attempt.id::text || tc.type)
        limit 1;
        if found then
          v_choices := array_append(v_choices, v_pick);
        end if;
      end loop;

      for v_pick in
        select tc.type
        from public.trap_catalog tc
        where tc.enabled
          and not (tc.type = any(v_choices))
          and public.has_legal_center_placement(tc.type, v_challenge.traps)
        order by md5(v_attempt.id::text || tc.type)
      loop
        exit when cardinality(v_choices) >= 3;
        v_choices := array_append(v_choices, v_pick);
      end loop;
    end if;

    if cardinality(v_choices) <> 3 then
      v_choices := null;
    end if;
  elsif p_ghost_trace is not null then
    raise exception 'ghost_not_allowed';
  end if;

  update public.attempts
  set outcome = p_outcome::public.attempt_outcome,
      finished_at = now(),
      duration_ms = p_duration_ms,
      max_progress = p_max_progress,
      death_trap_instance_id = p_death_trap_instance_id,
      ghost_trace = case when p_outcome = 'completed' then p_ghost_trace else null end,
      offered_traps = v_choices,
      finish_idempotency_key = p_idempotency_key
  where id = v_attempt.id
  returning * into v_attempt;

  if p_outcome = 'completed' then
    update public.challenges
    set completions_count = completions_count + 1,
        best_time_ms = case
          when best_time_ms is null then p_duration_ms
          else least(best_time_ms, p_duration_ms)
        end
    where id = v_challenge.id;

    update public.share_visits
    set completed_attempt_id = v_attempt.id
    where viewer_id = v_uid
      and share_id in (
        select id from public.shares where share_token = v_attempt.share_token
      );
  end if;

  perform public.refresh_challenge_payload(v_challenge.id);
  return jsonb_build_object(
    'attemptId', v_attempt.id,
    'outcome', v_attempt.outcome,
    'offeredTraps', v_attempt.offered_traps,
    'stats', public.challenge_dto(v_challenge.id) -> 'stats'
  );
end
$$;

create or replace function public.create_share(
  p_challenge_slug text,
  p_channel text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_share public.shares;
  v_challenge public.challenges;
  v_stored_slug text;
begin
  perform public.ensure_profile();
  select * into v_share
  from public.shares
  where user_id = v_uid and idempotency_key = p_idempotency_key;
  if found then
    select public_slug into v_stored_slug
    from public.challenges
    where id = v_share.challenge_id;
    return jsonb_build_object(
      'shareToken', v_share.share_token,
      'url', '/c/' || v_stored_slug || '?s=' || v_share.share_token
    );
  end if;

  if (
    select count(*)
    from public.shares
    where user_id = v_uid and created_at > now() - interval '1 hour'
  ) >= 100 then
    raise exception 'rate_limited';
  end if;

  select * into v_challenge
  from public.challenges
  where public_slug = p_challenge_slug and is_published and status = 'active'
  for update;
  if not found then
    raise exception 'challenge_not_found';
  end if;

  insert into public.shares(share_token, challenge_id, user_id, channel, idempotency_key)
  values (
    encode(gen_random_bytes(12), 'hex'),
    v_challenge.id,
    v_uid,
    p_channel::public.share_channel,
    p_idempotency_key
  )
  returning * into v_share;

  update public.challenges
  set share_count = share_count + 1
  where id = v_challenge.id;
  perform public.refresh_challenge_payload(v_challenge.id);

  return jsonb_build_object(
    'shareToken', v_share.share_token,
    'url', '/c/' || v_challenge.public_slug || '?s=' || v_share.share_token
  );
end
$$;

create or replace function public.get_public_challenge(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.public_payload
  from public.challenges c
  where c.public_slug = p_slug
    and c.is_published
    and c.status = 'active'
$$;

-- PostgreSQL grants new functions to PUBLIC by default. Explicitly close every
-- helper and expose only the narrowly gated read RPC.
revoke all on function public.challenge_dto(uuid) from public, anon, authenticated;
revoke all on function public.refresh_challenge_payload(uuid) from public, anon, authenticated;
revoke all on function public.is_valid_ghost_trace(jsonb, integer) from public, anon, authenticated;
revoke all on function public.has_legal_center_placement(text, jsonb) from public, anon, authenticated;
revoke all on function public.get_public_challenge(text) from public, anon, authenticated;
grant execute on function public.get_public_challenge(text) to anon, authenticated;
