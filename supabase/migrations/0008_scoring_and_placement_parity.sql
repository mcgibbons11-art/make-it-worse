-- Brings publish_child_challenge back into agreement with the client. Three
-- fixes, each tied to a client source of truth:
--
-- 1. The idempotent replay branch used to return a hardcoded
--    'estimatedWorsePercent', 1 on every retried publish. It now recomputes
--    the value from the immutable parent/child trap snapshots, exactly like
--    DemoRepository.publishChild's own replay branch does (see
--    lib/repository/DemoRepository.ts, publishChild, the `attempt.childSlug`
--    branch) rather than caching a value that could drift from the formula.
--
-- 2. The difficulty formula used raw trap COUNT (chain depth) as the risk
--    proxy. It now sums each trap's catalog risk_weight, scaled by a
--    per-zone multiplier, plus a synergy bonus for trap pairs placed close
--    together, mirroring lib/game/difficulty.ts (totalRisk, survivalOdds,
--    estimatedWorsePercent). tests/unit/sql-parity.test.ts pins the shared
--    numeric constants between the two files so they cannot silently drift
--    apart again.
--
--    IMPORTANT, read before touching zone_risk_multiplier again: while this
--    migration was being written, lib/game/difficulty.ts's zoneMultiplier
--    changed from a static zone-id-prefix switch to a value derived from
--    TRACK_SEGMENTS (lib/game/track.ts + lib/game/segments-extra.ts) — each
--    zone's authored `difficulty` and its "dodge room" (width minus player
--    capsule), normalized against the MEDIAN dodge room and the MEAN raw
--    value across every authored zone in the game, classic course and every
--    composed-track segment alike. That is no longer a pure function of a
--    zone id; it is a snapshot of a whole-roster renormalization that shifts
--    if any segment anywhere is added or resized. publish_child_challenge
--    only ever validates against public.placement_zones (the fixed classic
--    course — this schema has no server-side concept of composed tracks at
--    all), so zone_risk_multiplier below hardcodes the CURRENT resulting
--    multiplier for exactly those 15 zone ids, computed by calling the
--    exported totalRisk() with a single riskWeight=1 probe trap (banana_peel)
--    per zone rather than hand-derived. It WILL go stale the next time
--    someone tunes track.ts, segments-extra.ts, or a trap's riskWeight.
--    tests/unit/sql-parity.test.ts re-runs that same probe against the live
--    TS module on every test run and fails loudly the moment it drifts —
--    treat that failure as "re-run the probe and refresh this migration (or
--    a follow-up one)," not as a test to silence.
--
-- 3. Two placement rules are closed up: the overlap test now uses the same
--    0.95-on-bridge-zones exception the client (lib/game/placement.ts) and
--    public.has_legal_center_placement (migration 0006) already use instead
--    of a flat 0.75, and an explicit unsafe_sweep rule now rejects a
--    rotating_toilet or swinging_hammer on a stones zone server-side.
--
-- UNVERIFIED AGAINST A LIVE DATABASE. This file has not been executed
-- against Postgres. See the report accompanying this migration for the
-- exact commands to run against a disposable Supabase project before this
-- ships.

-- ---------------------------------------------------------------------------
-- Shared risk-model helpers. Each mirrors one piece of lib/game/difficulty.ts
-- and is intentionally kept as a small, separately named function so the
-- parity test can quote the same constants out of both languages.
-- ---------------------------------------------------------------------------

-- Snapshot of zoneMultiplier() in lib/game/difficulty.ts for the 15 classic
-- course zone ids only (see the migration-level comment above for why this
-- is a snapshot rather than a formula, and how it was computed). Any zone id
-- this RPC could actually receive is one of these 15 (v_zone_id is looked up
-- against public.placement_zones before this is ever called), so the else
-- branch mirrors the TS fallback (`?? 1`) for a zone id neither of us knows.
create or replace function public.zone_risk_multiplier(p_zone_id text)
returns double precision
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select case p_zone_id
    when 'runway_front' then 0.7107806522
    when 'runway_mid' then 0.7107806522
    when 'runway_back' then 0.7107806522
    when 'stones_front' then 0.8362125320
    when 'stones_mid' then 0.8362125320
    when 'stones_back' then 0.7881543405
    when 'bridge_front' then 1.0234242929
    when 'bridge_mid' then 1.0234242929
    when 'bridge_back' then 1.0234242929
    when 'island_left' then 1.0452656650
    when 'island_right' then 1.0452656650
    when 'convergence' then 0.7107806522
    when 'ramp' then 0.7107806522
    when 'finish_front' then 0.7107806522
    when 'finish_mid' then 0.7107806522
    else 1
  end
$$;

-- Mirrors the SYNERGIES table in lib/game/difficulty.ts. Returns null (which
-- sum() ignores) for any pair that is not a priced combination.
create or replace function public.trap_synergy_bonus(p_type_a text, p_type_b text)
returns double precision
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select bonus from (values
    ('floor_fan', 'giant_beach_ball', .3),
    ('floor_fan', 'rolling_fridge', .3),
    ('angry_vacuum', 'giant_beach_ball', .3),
    ('angry_vacuum', 'rolling_fridge', .3),
    ('floor_fan', 'laundry_basket', .25),
    ('soap_slick', 'spring_pad', .25),
    ('soap_slick', 'swinging_hammer', .25),
    ('soap_slick', 'rotating_toilet', .25),
    ('soap_slick', 'fridge_magnet', .4),
    ('soap_slick', 'floor_fan', .3),
    ('sprinkler', 'fridge_magnet', .4),
    ('robot_mop', 'fridge_magnet', .35),
    ('banana_peel', 'fridge_magnet', .3),
    ('robot_mop', 'floor_fan', .3),
    ('robot_mop', 'sprinkler', .3),
    ('robot_mop', 'angry_vacuum', .3),
    ('spring_pad', 'ceiling_fan', .4),
    ('mousetrap', 'ceiling_fan', .4),
    ('spring_pad', 'toaster_launcher', .25),
    ('banana_peel', 'toaster_launcher', .25),
    ('sprinkler', 'swinging_hammer', .25)
  ) as pairs(type_a, type_b, bonus)
  where (type_a = p_type_a and type_b = p_type_b)
     or (type_a = p_type_b and type_b = p_type_a)
  limit 1
$$;

-- Mirrors totalRisk() in lib/game/difficulty.ts: sum of each trap's
-- catalog risk_weight scaled by its zone multiplier, plus a synergy bonus
-- for every pair within SYNERGY_RANGE (4 world units) of each other.
create or replace function public.total_trap_risk(p_traps jsonb)
returns double precision
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    coalesce((
      select sum(tc.risk_weight * public.zone_risk_multiplier(trap ->> 'zoneId'))
      from jsonb_array_elements(coalesce(p_traps, '[]'::jsonb)) trap
      join public.trap_catalog tc on tc.type = trap ->> 'type'
    ), 0)
    +
    coalesce((
      select sum(public.trap_synergy_bonus(a.value ->> 'type', b.value ->> 'type'))
      from jsonb_array_elements(coalesce(p_traps, '[]'::jsonb)) with ordinality as a(value, idx)
      join jsonb_array_elements(coalesce(p_traps, '[]'::jsonb)) with ordinality as b(value, idx)
        on b.idx > a.idx
      where sqrt(
        power((a.value -> 'position' ->> 0)::double precision - (b.value -> 'position' ->> 0)::double precision, 2)
        + power((a.value -> 'position' ->> 2)::double precision - (b.value -> 'position' ->> 2)::double precision, 2)
      ) <= 4
    ), 0)
$$;

-- Mirrors survivalOdds() in lib/game/difficulty.ts. Deliberately UNCLAMPED:
-- the 1%/99% floor and ceiling are a display-only concern (estimatedSurvival
-- in the TS file). Clamping here would zero out the reported difference for
-- any two deep-chain challenges that both round to the same display floor.
create or replace function public.trap_survival_odds(p_traps jsonb)
returns double precision
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select 1 / (1 + exp(-(2.35 - .43 * public.total_trap_risk(p_traps))))
$$;

-- Mirrors estimatedWorsePercent() in lib/game/difficulty.ts.
create or replace function public.estimated_worse_percent(p_parent_traps jsonb, p_child_traps jsonb)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with odds as (
    select
      public.trap_survival_odds(p_parent_traps) as before,
      public.trap_survival_odds(p_child_traps) as after
  )
  select least(99, greatest(1, round(100 * (before - after) / before)::integer))
  from odds
$$;

-- ---------------------------------------------------------------------------
-- publish_child_challenge: same signature as migration 0004, redefined to
-- fix the replay lie (finding 1), the depth-based risk model (finding 2),
-- and the two missing placement rules (finding 3).
-- ---------------------------------------------------------------------------
create or replace function public.publish_child_challenge(
  p_parent_slug text,
  p_attempt_id uuid,
  p_placement jsonb,
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
  v_parent public.challenges;
  v_profile public.profiles;
  v_zone public.placement_zones;
  v_catalog public.trap_catalog;
  v_type text;
  v_zone_id text;
  v_ox double precision;
  v_oz double precision;
  v_q integer;
  v_x double precision;
  v_z double precision;
  v_seed integer;
  v_trap jsonb;
  v_child public.challenges;
  v_slug text;
  v_worse integer;
begin
  perform public.ensure_profile();
  select * into v_profile from public.profiles where user_id = v_uid;
  select * into v_attempt from public.attempts where id = p_attempt_id and user_id = v_uid for update;
  if not found then
    raise exception 'attempt_not_found';
  end if;

  select * into v_parent from public.challenges where id = v_attempt.challenge_id and public_slug = p_parent_slug for update;
  if not found then
    raise exception 'parent_mismatch';
  end if;

  if v_attempt.published_child_id is not null then
    select * into v_child from public.challenges where id = v_attempt.published_child_id;
    return jsonb_build_object(
      'challenge', public.challenge_dto(v_child.id),
      'attributedShareUrl', '/c/' || v_child.public_slug,
      -- FIX (finding 1): recompute from the immutable parent/child trap
      -- snapshots instead of hardcoding 1. Both snapshots are fixed at
      -- creation time, so this returns the exact same number every replay.
      'estimatedWorsePercent', public.estimated_worse_percent(v_parent.traps, v_child.traps)
    );
  end if;

  if v_attempt.outcome <> 'completed' or v_parent.depth >= 20 then
    raise exception 'completion_required';
  end if;
  if exists(select 1 from jsonb_object_keys(p_placement) k where k not in ('type', 'zoneId', 'offsetX', 'offsetZ', 'rotationQuarterTurns')) then
    raise exception 'unknown_placement_key';
  end if;

  v_type := p_placement ->> 'type';
  v_zone_id := p_placement ->> 'zoneId';
  v_ox := (p_placement ->> 'offsetX')::double precision;
  v_oz := (p_placement ->> 'offsetZ')::double precision;
  v_q := (p_placement ->> 'rotationQuarterTurns')::integer;
  if not (v_type = any(v_attempt.offered_traps))
    or v_q not between 0 and 3
    or abs(v_ox) > 20 or abs(v_oz) > 20
    or abs(v_ox * 4 - round(v_ox * 4)) > .00001
    or abs(v_oz * 4 - round(v_oz * 4)) > .00001
  then
    raise exception 'invalid_placement';
  end if;

  select * into v_zone from public.placement_zones where id = v_zone_id;
  select * into v_catalog from public.trap_catalog where type = v_type and enabled;
  if v_zone.id is null or v_catalog.type is null or not (v_type = any(v_zone.allowed_types)) then
    raise exception 'type_not_allowed';
  end if;
  if (select count(*) from jsonb_array_elements(v_parent.traps) t where t ->> 'zoneId' = v_zone_id) >= v_zone.max_occupants then
    raise exception 'zone_full';
  end if;

  v_x := (v_zone.min_x + v_zone.max_x) / 2 + v_ox;
  v_z := (v_zone.min_z + v_zone.max_z) / 2 + v_oz;
  if v_x - v_catalog.placement_radius * .5 < v_zone.min_x
    or v_x + v_catalog.placement_radius * .5 > v_zone.max_x
    or v_z - v_catalog.placement_radius * .5 < v_zone.min_z
    or v_z + v_catalog.placement_radius * .5 > v_zone.max_z
  then
    raise exception 'outside_zone';
  end if;

  -- FIX (finding 3a): bridge zones require more clearance between traps
  -- (0.95x combined radius) than every other zone (0.75x), matching
  -- lib/game/placement.ts and public.has_legal_center_placement (0006).
  -- 0004 used a flat 0.75 everywhere, which under-required clearance on
  -- bridge zones relative to what the client's own editor would accept.
  if exists(
    select 1
    from jsonb_array_elements(v_parent.traps) t
    join public.trap_catalog tc on tc.type = t ->> 'type'
    where sqrt(power(v_x - (t -> 'position' ->> 0)::double precision, 2) + power(v_z - (t -> 'position' ->> 2)::double precision, 2))
      < (case when v_zone_id like 'bridge%' then .95 else .75 end) * (v_catalog.placement_radius + tc.placement_radius)
  ) then
    raise exception 'overlap';
  end if;

  if sqrt(power(v_x, 2) + power(v_z - 1.2, 2)) < 2.2 + v_catalog.placement_radius
    or sqrt(power(v_x, 2) + power(v_z - 40.25, 2)) < 1.5 + v_catalog.placement_radius
  then
    raise exception 'protected_area';
  end if;

  -- FIX (finding 3b): the client refuses a rotating_toilet or
  -- swinging_hammer on a stepping-stone zone because the mandatory landing
  -- pad leaves no way to dodge a full sweep (lib/game/placement.ts,
  -- unsafe_sweep). 0004 had no equivalent rule, relying only on the stones
  -- zones' allowed_types omitting these two types, which is incidental
  -- allowlist behavior, not a structural guarantee.
  if v_type in ('rotating_toilet', 'swinging_hammer') and v_zone_id like 'stones%' then
    raise exception 'unsafe_sweep';
  end if;

  if (select count(*) from public.challenges c where c.created_by = v_uid and c.created_at > now() - interval '1 hour' and c.depth > 0) >= 30 then
    raise exception 'rate_limited';
  end if;

  v_seed := abs(hashtext(v_attempt.id::text || v_type || v_zone_id));
  v_trap := jsonb_build_object(
    'id', 'trap_' || substr(md5(v_attempt.id::text || v_type), 1, 12),
    'type', v_type,
    'ownerUserId', v_uid,
    'ownerName', v_profile.display_name,
    'ownerAvatarSeed', v_profile.avatar_seed,
    'depthAdded', v_parent.depth + 1,
    'zoneId', v_zone_id,
    'position', jsonb_build_array(v_x, v_zone.ground_y, v_z),
    'rotationY', v_q * pi() / 2,
    'seed', v_seed,
    'params', jsonb_build_object()
  );
  v_slug := 'worse-' || substr(encode(gen_random_bytes(8), 'hex'), 1, 12);
  insert into public.challenges(
    chain_id, parent_id, public_slug, depth, created_by, created_by_name, created_by_avatar_seed,
    base_seed, traps, added_trap, ghost_trace, parent_completion_attempt_id
  ) values (
    v_parent.chain_id, v_parent.id, v_slug, v_parent.depth + 1, v_uid, v_profile.display_name, v_profile.avatar_seed,
    v_parent.base_seed, v_parent.traps || jsonb_build_array(v_trap), v_trap, v_attempt.ghost_trace, v_attempt.id
  ) returning * into v_child;

  update public.attempts set published_child_id = v_child.id where id = v_attempt.id;
  perform public.refresh_challenge_payload(v_child.id);

  -- FIX (finding 2): risk-weighted synergy-aware model instead of raw depth.
  v_worse := public.estimated_worse_percent(v_parent.traps, v_child.traps);
  return jsonb_build_object(
    'challenge', public.challenge_dto(v_child.id),
    'attributedShareUrl', '/c/' || v_child.public_slug,
    'estimatedWorsePercent', v_worse
  );
end
$$;

-- New functions default to PUBLIC execute; close them like every other
-- internal helper (see the comment above the equivalent revoke in 0006).
-- publish_child_challenge keeps its existing grant to authenticated because
-- create or replace preserves privileges when the signature is unchanged.
revoke all on function
  public.zone_risk_multiplier(text),
  public.trap_synergy_bonus(text, text),
  public.total_trap_risk(jsonb),
  public.trap_survival_odds(jsonb),
  public.estimated_worse_percent(jsonb, jsonb)
from public, anon, authenticated;
