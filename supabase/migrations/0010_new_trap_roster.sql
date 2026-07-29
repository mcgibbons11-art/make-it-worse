-- Registers the six traps added in components/game/traps/NewTraps.tsx:
-- paint_bucket, spin_cycle, sticky_gum, cord_trip, drawer_slam and rug_pull.
--
-- Without a public.trap_catalog row, publish_child_challenge's
-- `select ... into v_catalog ... if v_catalog.type is null then raise exception
-- 'type_not_allowed'` rejects a placement the client offers and renders
-- happily, which is exactly the break 0009 was written to close for the
-- previous eight. placement_zones.allowed_types needs the same treatment, so
-- every zone array is restated here in full rather than appended to: the arrays
-- are the authority on what a zone accepts, and a partial update would leave
-- the SQL disagreeing with lib/game/level-definition.ts again.
--
-- Fix-forward, as 0009 was: earlier migrations are left exactly as they were.
--
-- risk_weight is not a taste ranking. Each of these is derived from the
-- measured hazard rule documented above TRAP_CATALOG in
-- lib/game/trap-catalog.ts, from the impulse the trap reports and the gate it
-- may report again on (NEW_TRAP_HAZARD in NewTraps.tsx):
--   paint_bucket  impulse 15, gate 2800ms -> 1.20
--   spin_cycle    impulse 12, gate 2600ms -> 1.05
--   sticky_gum    impulse  4, gate 1200ms -> 1.00
--   cord_trip     impulse 12, gate 1500ms -> 1.25
--   drawer_slam   impulse  9, gate 3400ms -> 0.85
--   rug_pull      impulse  8, gate 2000ms -> 0.95
-- Expect these to move again whenever that calibration does.
--
-- UNVERIFIED AGAINST A LIVE DATABASE. No Postgres was available where this was
-- written, so this file has been checked for parity against the TypeScript
-- catalogue by tests/unit/sql-parity.test.ts and by nothing else. It has never
-- been executed.

insert into public.trap_catalog(type, display_name, category, placement_radius, risk_weight, sort_order) values
  ('paint_bucket', 'Paint Bucket', 'sweeper', 1, 1.2, 17),
  ('spin_cycle', 'Washing Machine', 'movement', 1, 1.05, 18),
  ('sticky_gum', 'Chewed Gum', 'movement', .7, 1, 19),
  ('cord_trip', 'Extension Cord', 'sweeper', .85, 1.25, 20),
  ('drawer_slam', 'Cutlery Drawer', 'prop', 1, .85, 21),
  ('rug_pull', 'Trick Rug', 'prop', .95, .95, 22)
on conflict (type) do update set
  display_name = excluded.display_name,
  category = excluded.category,
  placement_radius = excluded.placement_radius,
  risk_weight = excluded.risk_weight,
  sort_order = excluded.sort_order;

-- Full 22-type roster: every zone that passes no explicit allowedTypes to
-- `zone(...)` in level-definition.ts defaults to this.
update public.placement_zones set allowed_types = array[
  'swinging_hammer','rolling_fridge','floor_fan','soap_slick','spring_pad','angry_vacuum','rotating_toilet','giant_beach_ball',
  'toaster_launcher','ceiling_fan','banana_peel','robot_mop','mousetrap','sprinkler','laundry_basket','fridge_magnet',
  'paint_bucket','spin_cycle','sticky_gum','cord_trip','drawer_slam','rug_pull'
]::text[]
where id in ('runway_front', 'runway_mid', 'runway_back', 'bridge_front', 'bridge_back', 'island_left', 'island_right', 'convergence', 'finish_front', 'finish_mid');

-- `small` is unchanged by this migration: the stepping stones are mandatory
-- landings, and none of the six is small and static enough to belong there.
update public.placement_zones set allowed_types = array[
  'floor_fan','soap_slick','spring_pad','giant_beach_ball','banana_peel','toaster_launcher','laundry_basket'
]::text[]
where id in ('stones_front', 'stones_mid', 'stones_back');

-- Full roster minus rolling_fridge (bridge_mid is too narrow for it).
update public.placement_zones set allowed_types = array[
  'swinging_hammer','floor_fan','soap_slick','spring_pad','angry_vacuum','rotating_toilet','giant_beach_ball',
  'toaster_launcher','ceiling_fan','banana_peel','robot_mop','mousetrap','sprinkler','laundry_basket','fridge_magnet',
  'paint_bucket','spin_cycle','sticky_gum','cord_trip','drawer_slam','rug_pull'
]::text[]
where id = 'bridge_mid';

-- `rampTypes`, now carrying the four new traps that are not large appliances.
update public.placement_zones set allowed_types = array[
  'swinging_hammer','floor_fan','soap_slick','spring_pad','rotating_toilet','giant_beach_ball','banana_peel','toaster_launcher','ceiling_fan','sprinkler','robot_mop',
  'paint_bucket','sticky_gum','cord_trip','rug_pull'
]::text[]
where id = 'ramp';
