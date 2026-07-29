-- Free placement: a trap may stand anywhere on solid floor.
--
-- Placement was limited to eight hand-drawn zones, and all other ground in the
-- game was simply forbidden. Three of the eight rejection reasons existed only
-- to police that abstraction rather than to protect anything real:
--   type_not_allowed  per-zone allowlists of trap types
--   zone_full         a per-zone occupancy cap
--   outside_zone      which refused most of the course outright
-- Dragging a prop therefore snapped to a handful of legal discs and refused
-- everywhere else. That is what read as jank, and it is what this removes.
--
-- The five rules that protect something survive, because each answers a real
-- question rather than an abstraction's question:
--   invalid_placement  non-finite or off-grid input
--   outside_zone       REDEFINED: is this point on floor at all
--   overlap            two traps in one spot is broken
--   protected_area     spawn and exit stay reachable
--   unsafe_sweep       REDEFINED below, and this is the interesting one
--
-- WHY THE WIRE FORMAT DID NOT CHANGE. Every challenge link in circulation
-- stores placement INPUTS, including zoneId, and replays them through
-- validatePlacement on decode so a hand-edited link cannot smuggle an illegal
-- level. A link whose zoneId stopped resolving would break a saved level. So
-- zoneId keeps its name and its meaning of "which surface"; there are simply
-- many more surfaces now. placement_zones gains one row per level piece, and
-- the two ids that already exist as zones - convergence and ramp - are left
-- alone by the on-conflict clause, because lib/game/placement.ts resolves
-- authored zones FIRST and the two sides must agree on which extents win.
--
-- unsafe_sweep WAS A NAME TEST. It read `v_zone_id like 'stones%'`, so it
-- refused a sweeping trap on anything called a stone and allowed it on any
-- narrow platform called something else. The question it was always asking is
-- geometric: a rotating or swinging arm covers its whole radius, so is there a
-- body's width of floor left to either side of it? It is now measured, on the
-- wider side, because a runner only needs one way past. 0.76 is the client's
-- DODGE_MARGIN, PLAYER.capsuleRadius * 2, which is the same width
-- lib/game/difficulty.ts already subtracts when it measures a zone's dodge room.
--
-- The overlap multiplier is also unified, at 0.75. It was 0.95 on bridge zones
-- and 0.75 elsewhere, keyed on the zone id prefix - the same kind of name test,
-- and one that cannot mean anything once every piece is a surface. 0.75 is the
-- value that already governed thirteen of the fifteen zones, and it is the more
-- permissive of the two, which is the right direction for a change whose whole
-- point is to stop refusing placements. The bridge's extra clearance was really
-- about the bridge being narrow, and narrowness is now measured directly.
--
-- UNVERIFIED AGAINST A LIVE DATABASE, exactly as 0008 through 0013 are. This
-- file has not been executed against Postgres. tests/unit/sql-parity.test.ts
-- pins these constants against lib/game/placement.ts and fails the moment the
-- two drift, which is the verification that exists for them.

-- max_occupants is checked between 1 and 4 by 0002, so the column is kept
-- satisfied even though the cap is no longer enforced. allowed_types is
-- likewise seeded with the full roster rather than dropped, so any code still
-- reading the column sees "everything is allowed" rather than an empty array.
insert into public.placement_zones(id, label, min_x, max_x, min_z, max_z, ground_y, max_occupants, allowed_types)
select v.id, v.label, v.min_x, v.max_x, v.min_z, v.max_z, v.ground_y, 4,
       array(select type from public.trap_catalog where enabled)
from (values
  ('start','Start',-4.000,4.000,0.000,5.000,0.000),
  ('runway','Runway',-3.000,3.000,5.000,13.500,0.000),
  ('stone-a','Stepping stone A',-2.800,-0.400,11.300,13.100,0.000),
  ('stone-b','Stepping stone B',-1.100,1.100,13.100,14.900,0.350),
  ('stone-c','Stepping stone C',0.300,2.700,14.900,16.700,0.150),
  ('bridge','Bridge',-1.500,1.500,15.500,25.700,0.000),
  ('left-island','Left island',-3.100,-0.400,24.700,29.500,0.000),
  ('center-island','Centre island',-0.600,0.600,24.700,29.500,0.000),
  ('right-island','Right island',0.400,3.100,24.700,29.500,0.000),
  ('convergence','Convergence',-2.800,2.800,29.800,32.400,0.000),
  ('ramp','Ramp',-2.000,2.000,32.250,35.850,0.300),
  ('finish','Finish',-3.500,3.500,35.100,41.100,0.400)
) as v(id,label,min_x,max_x,min_z,max_z,ground_y)
on conflict (id) do nothing;

create or replace function public.trap_fits_surface(
  p_type text,
  p_zone_id text,
  p_x double precision
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- True when a sweeping trap leaves a runner room to pass. Non-sweeping traps
  -- always fit: their hazard is a footprint, not an arc, so a runner can walk
  -- around one on any floor wide enough to hold it, which outside_zone checked.
  --
  -- The list is deliberately short. A trap belongs here only when its hazard
  -- covers the WHOLE lane it stands in, leaving no gap to slip through. Wave B's
  -- swing_door qualifies: its leaf rotates through a band `span` wide and the
  -- strike test accepts any lateral offset inside span/2. Its neighbours do not
  -- - stove_ring's safe ground is the middle of its own annulus, and running
  -- straight past clothes_airer is free by design, so measuring lane width for
  -- either would refuse placements that are perfectly fair.
  select case
    when p_type not in ('rotating_toilet', 'swinging_hammer', 'ceiling_fan', 'swing_door') then true
    else (
      select greatest(p_x - z.min_x, z.max_x - p_x) - c.placement_radius >= 0.76
      from public.placement_zones z, public.trap_catalog c
      where z.id = p_zone_id and c.type = p_type
    )
  end
$$;

comment on function public.trap_fits_surface(text, text, double precision) is
  'Geometric replacement for the zone-id-prefix unsafe_sweep test. Mirrors the SWEEPING_TYPES set and DODGE_MARGIN in lib/game/placement.ts.';

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
  -- 0014: the per-zone allowlist and the occupancy cap are gone; any trap may
  -- stand on any floor. An unknown surface or an unknown/disabled trap type is
  -- still refused, because neither can be positioned at all.
  if v_zone.id is null or v_catalog.type is null then
    raise exception 'outside_zone';
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

  -- 0014: unified at 0.75, the value thirteen of the fifteen zones already
  -- used. The 0.95/0.75 split was keyed on the zone id prefix, which cannot
  -- mean anything once every level piece is a surface.
  if exists(
    select 1
    from jsonb_array_elements(v_parent.traps) t
    join public.trap_catalog tc on tc.type = t ->> 'type'
    where sqrt(power(v_x - (t -> 'position' ->> 0)::double precision, 2) + power(v_z - (t -> 'position' ->> 2)::double precision, 2))
      < .75 * (v_catalog.placement_radius + tc.placement_radius)
  ) then
    raise exception 'overlap';
  end if;

  if sqrt(power(v_x, 2) + power(v_z - 1.2, 2)) < 2.2 + v_catalog.placement_radius
    or sqrt(power(v_x, 2) + power(v_z - 40.25, 2)) < 1.5 + v_catalog.placement_radius
  then
    raise exception 'protected_area';
  end if;

  -- 0014: was `v_zone_id like 'stones%'`, a name test that refused a sweep on
  -- anything called a stone and allowed it on any narrow platform called
  -- something else. Now measured: does the arc leave a body's width to pass?
  if not public.trap_fits_surface(v_type, v_zone_id, v_x) then
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
