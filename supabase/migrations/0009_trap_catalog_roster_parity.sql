-- Not one of the three audited findings. Found while verifying finding 2:
-- fixing the risk model requires public.trap_catalog to have a correct
-- risk_weight row for every trap the client can place, and it did not.
--
-- lib/game/trap-catalog.ts (TRAP_TYPES) lists 16 trap types. Migration 0005
-- seeded only the original 8. The other 8 (toaster_launcher, ceiling_fan,
-- banana_peel, robot_mop, mousetrap, sprinkler, laundry_basket,
-- fridge_magnet) have no public.trap_catalog row, so
-- publish_child_challenge's `select ... into v_catalog ... if v_catalog.type
-- is null then raise exception 'type_not_allowed'` rejects every one of
-- them today, independently of the placement_zones.allowed_types arrays,
-- which are also still the pre-expansion 8-type lists seeded by 0005 and no
-- longer match lib/game/level-definition.ts. Concretely: half the client's
-- trap roster cannot currently be published through this RPC at all.
--
-- Separately, and discovered only while re-reading trap-catalog.ts a second
-- time in the same sitting: every risk_weight, including the original 8,
-- has since been recalibrated in the TS file against a measured-hazard rule
-- (see the large comment block above TRAP_CATALOG there) and no longer
-- matches what 0005 seeded. placement_radius is unchanged. This migration
-- re-upserts all 16 rows so both problems close together; expect risk_weight
-- here to need refreshing again as that calibration keeps moving.
--
-- This also corrects every zone's allowed_types to match
-- lib/game/level-definition.ts exactly (the default full 16-type roster,
-- the restrictive 7-type `small` list on stepping stones, the
-- rolling_fridge-excluded 15-type list on bridge_mid, and the 11-type
-- `rampTypes` list on the ramp). Note this also means finish_attempt's
-- has_legal_center_placement (migration 0006) will start offering these 8
-- trap types after completions, since it already reads from
-- trap_catalog/placement_zones dynamically rather than a hardcoded list;
-- that is the intended effect, not a side effect to work around.
--
-- UNVERIFIED AGAINST A LIVE DATABASE. See the report accompanying this
-- migration for exact verification commands.

insert into public.trap_catalog(type, display_name, category, placement_radius, risk_weight, sort_order) values
  ('swinging_hammer', 'Swinging Hammer', 'sweeper', 1.3, 0.9, 1),
  ('rolling_fridge', 'Rolling Refrigerator', 'prop', 1.1, 0.85, 2),
  ('floor_fan', 'Floor Fan', 'movement', .9, 1.75, 3),
  ('soap_slick', 'Soap Slick', 'movement', .8, 1.6, 4),
  ('spring_pad', 'Spring Pad', 'movement', .75, 1.6, 5),
  ('angry_vacuum', 'Angry Vacuum', 'prop', 1.2, 1.65, 6),
  ('rotating_toilet', 'Rotating Toilet', 'sweeper', 1.25, .8, 7),
  ('giant_beach_ball', 'Giant Beach Ball', 'prop', .8, .6, 8),
  ('toaster_launcher', 'Toaster Launcher', 'prop', .85, .9, 9),
  ('ceiling_fan', 'Ceiling Fan', 'sweeper', 1.4, .75, 10),
  ('banana_peel', 'Banana Peel', 'movement', .6, 1, 11),
  ('robot_mop', 'Robot Mop', 'prop', 1, 1.55, 12),
  ('mousetrap', 'Giant Mousetrap', 'sweeper', .9, .7, 13),
  ('sprinkler', 'Rogue Sprinkler', 'movement', .95, 1.45, 14),
  ('laundry_basket', 'Laundry Basket', 'prop', .9, .05, 15),
  ('fridge_magnet', 'Industrial Magnet', 'movement', 1.05, .95, 16)
on conflict (type) do update set
  display_name = excluded.display_name,
  category = excluded.category,
  placement_radius = excluded.placement_radius,
  risk_weight = excluded.risk_weight,
  sort_order = excluded.sort_order;

-- Full 16-type roster: every zone that passes no explicit allowedTypes to
-- `zone(...)` in level-definition.ts defaults to this.
update public.placement_zones set allowed_types = array[
  'swinging_hammer','rolling_fridge','floor_fan','soap_slick','spring_pad','angry_vacuum','rotating_toilet','giant_beach_ball',
  'toaster_launcher','ceiling_fan','banana_peel','robot_mop','mousetrap','sprinkler','laundry_basket','fridge_magnet'
]::text[]
where id in ('runway_front', 'runway_mid', 'runway_back', 'bridge_front', 'bridge_back', 'island_left', 'island_right', 'convergence', 'finish_front', 'finish_mid');

-- `small`: mandatory-landing pads stay restricted to static/telegraphed
-- traps on purpose (see the comment in level-definition.ts).
update public.placement_zones set allowed_types = array[
  'floor_fan','soap_slick','spring_pad','giant_beach_ball','banana_peel','toaster_launcher','laundry_basket'
]::text[]
where id in ('stones_front', 'stones_mid', 'stones_back');

-- Full roster minus rolling_fridge (bridge_mid is too narrow for it).
update public.placement_zones set allowed_types = array[
  'swinging_hammer','floor_fan','soap_slick','spring_pad','angry_vacuum','rotating_toilet','giant_beach_ball',
  'toaster_launcher','ceiling_fan','banana_peel','robot_mop','mousetrap','sprinkler','laundry_basket','fridge_magnet'
]::text[]
where id = 'bridge_mid';

-- `rampTypes`.
update public.placement_zones set allowed_types = array[
  'swinging_hammer','floor_fan','soap_slick','spring_pad','rotating_toilet','giant_beach_ball','banana_peel','toaster_launcher','ceiling_fan','sprinkler','robot_mop'
]::text[]
where id = 'ramp';
