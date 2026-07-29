-- Registers the sixteen traps added in components/game/traps/TrapsWaveA.tsx:
-- conveyor_strip, tilt_plate, motion_sensor, domino_line, bunting_line,
-- steam_vents, pipe_burst, ankle_weight, chute_drop, cart_blocker, dust_bunny,
-- flood_puddle, updraft_vent, mattress_rebound, plate_shards and cat_flap.
--
-- Without a public.trap_catalog row, publish_child_challenge's
-- `select ... into v_catalog ... if v_catalog.type is null then raise exception
-- 'type_not_allowed'` rejects a placement the client offers and renders happily,
-- which is the break 0009 closed for the second eight and 0010 for the six after
-- them. placement_zones.allowed_types needs the same treatment, so every zone
-- array is restated here in full rather than appended to: the arrays are the
-- authority on what a zone accepts, and a partial update would leave the SQL
-- disagreeing with lib/game/level-definition.ts again.
--
-- Fix-forward, as 0009 and 0010 were: earlier migrations are left as they are.
--
-- risk_weight is not a taste ranking. Each is derived from the measured hazard
-- rule documented above TRAP_CATALOG in lib/game/trap-catalog.ts, from the
-- impulse the trap reports and the gate it may report again on (WAVE_A_HAZARD
-- in TrapsWaveA.tsx):
--   conveyor_strip    impulse  6, gate  800ms -> 1.30
--   tilt_plate        impulse 10, gate 2000ms -> 1.05
--   motion_sensor     impulse  9, gate 1800ms -> 1.05
--   domino_line       impulse 13, gate 4000ms -> 1.00
--   bunting_line      impulse 12, gate 1800ms -> 1.15
--   steam_vents       impulse  9, gate 1100ms -> 1.25
--   pipe_burst        impulse 13, gate 2600ms -> 1.10
--   ankle_weight      impulse  9, one-shot    -> 0.65
--   chute_drop        impulse 11, gate 3400ms -> 0.95
--   cart_blocker      impulse  9, gate 1500ms -> 1.10
--   dust_bunny        impulse  6, gate 1200ms -> 1.10
--   flood_puddle      impulse  5, gate 1100ms -> 1.05
--   updraft_vent      impulse  4, gate 1200ms -> 1.00
--   mattress_rebound  impulse 11, gate 1500ms -> 1.20
--   plate_shards      impulse 10, gate 1500ms -> 1.15
--   cat_flap          impulse 11, gate 2000ms -> 1.05
-- Expect these to move again whenever that calibration does.
--
-- This migration also raises max_occupants on the eleven wide zones, which the
-- previous three did not touch. The roster went 22 -> 38 while the classic
-- course had exactly 22 legal slots, so publish_child_challenge would have
-- raised 'zone_full' for placements the client had already accepted. The values
-- match lib/game/level-definition.ts exactly and stay inside the
-- `check(max_occupants between 1 and 4)` constraint 0002_tables.sql declares:
-- the three stepping stones and the three bridge planks stay at 1 because they
-- are mandatory landings barely wider than the runner, and the ramp goes to 3
-- rather than 4 because its slope is only 1.8u deep.
--
-- UNVERIFIED AGAINST A LIVE DATABASE. No Postgres was available where this was
-- written, so this file has been checked for parity against the TypeScript
-- catalogue by tests/unit/sql-parity.test.ts and by nothing else. It has never
-- been executed, and in particular the max_occupants update below has never
-- been run against the check constraint it claims to satisfy.

insert into public.trap_catalog(type, display_name, category, placement_radius, risk_weight, sort_order) values
  ('conveyor_strip', 'Conveyor Strip', 'movement', .85, 1.3, 23),
  ('tilt_plate', 'Tilting Plate', 'movement', .75, 1.05, 24),
  ('motion_sensor', 'Motion Sensor', 'prop', .6, 1.05, 25),
  ('domino_line', 'Domino Line', 'prop', .8, 1, 26),
  ('bunting_line', 'Party Bunting', 'sweeper', .7, 1.15, 27),
  ('steam_vents', 'Steam Vents', 'sweeper', .85, 1.25, 28),
  ('pipe_burst', 'Rattling Pipe', 'prop', .65, 1.1, 29),
  ('ankle_weight', 'Ankle Weights', 'movement', .55, .65, 30),
  ('chute_drop', 'Laundry Chute', 'prop', .9, .95, 31),
  ('cart_blocker', 'Runaway Trolley', 'prop', .9, 1.1, 32),
  ('dust_bunny', 'Dust Bunny', 'prop', .6, 1.1, 33),
  ('flood_puddle', 'Overflowing Sink', 'movement', .75, 1.05, 34),
  ('updraft_vent', 'Floor Vent', 'movement', .65, 1, 35),
  ('mattress_rebound', 'Propped Mattress', 'prop', .9, 1.2, 36),
  ('plate_shards', 'Plate Stack', 'sweeper', .7, 1.15, 37),
  ('cat_flap', 'Cat Flap', 'sweeper', .8, 1.05, 38)
on conflict (type) do update set
  display_name = excluded.display_name,
  category = excluded.category,
  placement_radius = excluded.placement_radius,
  risk_weight = excluded.risk_weight,
  sort_order = excluded.sort_order;

-- Full 38-type roster: every zone that passes no explicit allowedTypes to
-- `zone(...)` in level-definition.ts defaults to this.
update public.placement_zones set allowed_types = array[
  'swinging_hammer','rolling_fridge','floor_fan','soap_slick','spring_pad','angry_vacuum','rotating_toilet','giant_beach_ball',
  'toaster_launcher','ceiling_fan','banana_peel','robot_mop','mousetrap','sprinkler','laundry_basket','fridge_magnet',
  'paint_bucket','spin_cycle','sticky_gum','cord_trip','drawer_slam','rug_pull',
  'conveyor_strip','tilt_plate','motion_sensor','domino_line','bunting_line','steam_vents','pipe_burst','ankle_weight',
  'chute_drop','cart_blocker','dust_bunny','flood_puddle','updraft_vent','mattress_rebound','plate_shards','cat_flap'
]::text[]
where id in ('runway_front', 'runway_mid', 'runway_back', 'bridge_front', 'bridge_back', 'island_left', 'island_right', 'convergence', 'finish_front', 'finish_mid');

-- `small` gains exactly two of the sixteen. The stepping stones are mandatory
-- landings, so the bar is still small, static and telegraphed: the ankle weights
-- are a 0.55u pickup that does not move, and the floor vent only acts on a
-- runner who is already airborne, which on a stone is a landing they have to
-- commit to anyway. Everything else in the wave sweeps, chases, relocates or
-- covers the pad.
update public.placement_zones set allowed_types = array[
  'floor_fan','soap_slick','spring_pad','giant_beach_ball','banana_peel','toaster_launcher','laundry_basket',
  'ankle_weight','updraft_vent'
]::text[]
where id in ('stones_front', 'stones_mid', 'stones_back');

-- Full roster minus rolling_fridge (bridge_mid is too narrow for it).
update public.placement_zones set allowed_types = array[
  'swinging_hammer','floor_fan','soap_slick','spring_pad','angry_vacuum','rotating_toilet','giant_beach_ball',
  'toaster_launcher','ceiling_fan','banana_peel','robot_mop','mousetrap','sprinkler','laundry_basket','fridge_magnet',
  'paint_bucket','spin_cycle','sticky_gum','cord_trip','drawer_slam','rug_pull',
  'conveyor_strip','tilt_plate','motion_sensor','domino_line','bunting_line','steam_vents','pipe_burst','ankle_weight',
  'chute_drop','cart_blocker','dust_bunny','flood_puddle','updraft_vent','mattress_rebound','plate_shards','cat_flap'
]::text[]
where id = 'bridge_mid';

-- `rampTypes`, now carrying the thirteen of the wave that are not large
-- appliances. The chute, the trolley and the mattress are excluded for the same
-- reason the fridge and the washer are: standing on a 1.8u slope they would wall
-- the climb off.
update public.placement_zones set allowed_types = array[
  'swinging_hammer','floor_fan','soap_slick','spring_pad','rotating_toilet','giant_beach_ball','banana_peel','toaster_launcher','ceiling_fan','sprinkler','robot_mop',
  'paint_bucket','sticky_gum','cord_trip','rug_pull',
  'conveyor_strip','tilt_plate','motion_sensor','domino_line','bunting_line','steam_vents','pipe_burst','ankle_weight',
  'dust_bunny','flood_puddle','updraft_vent','plate_shards','cat_flap'
]::text[]
where id = 'ramp';

-- Capacity, not spacing: publish_child_challenge still runs its own overlap and
-- clearance checks, so a higher count cannot stack two traps in one spot.
update public.placement_zones set max_occupants = 4
where id in ('runway_front', 'runway_mid', 'runway_back', 'island_left', 'island_right', 'convergence', 'finish_front', 'finish_mid');

update public.placement_zones set max_occupants = 3 where id = 'ramp';
