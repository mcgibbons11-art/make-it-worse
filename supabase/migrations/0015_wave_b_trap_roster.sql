-- Registers the sixteen traps added in components/game/traps/TrapsWaveB.tsx:
-- paparazzi, bathroom_scales, slow_fuse, pile_on, bin_pedal, swing_door,
-- ball_machine, cuckoo_clock, fish_bowl, shoe_rack, hot_potato, stove_ring,
-- clothes_airer, ice_dispenser, kettle_boil and junk_drift. The roster goes
-- 38 -> 54.
--
-- Without a public.trap_catalog row, publish_child_challenge's
-- `select ... into v_catalog ... if v_catalog.type is null then raise exception
-- 'type_not_allowed'` rejects a placement the client offers and renders happily,
-- which is the break 0009 closed for the second eight, 0010 for the six after
-- them and 0012 for wave A. Fix-forward, as those were: earlier migrations are
-- left exactly as they are.
--
-- risk_weight is not a taste ranking. Each is derived from the measured hazard
-- rule documented above TRAP_CATALOG in lib/game/trap-catalog.ts, from the
-- impulse the trap reports and the gate it may report again on (WAVE_B_HAZARD
-- in lib/game/traps-wave-b.ts):
--   paparazzi         impulse  8, gate 2400ms -> 0.90
--   bathroom_scales   impulse 13, gate 2800ms -> 1.10
--   slow_fuse         impulse 11, gate 2600ms -> 1.00
--   pile_on           impulse 13, gate 2600ms -> 1.10
--   bin_pedal         impulse 11, gate 2600ms -> 1.00
--   swing_door        impulse 14, gate 2000ms -> 1.25
--   ball_machine      impulse 10, gate 1700ms -> 1.10
--   cuckoo_clock      impulse 15, gate 3300ms -> 1.15
--   fish_bowl         impulse  6, gate 1400ms -> 1.00
--   shoe_rack         impulse 13, gate 3000ms -> 1.05
--   hot_potato        impulse 15, gate 3200ms -> 1.15
--   stove_ring        impulse 10, gate 1800ms -> 1.05
--   clothes_airer     impulse  8, gate 1600ms -> 1.05
--   ice_dispenser     impulse 19, one-shot    -> 1.00
--   kettle_boil       impulse  9, gate 1500ms -> 1.10
--   junk_drift        impulse  5, gate 1200ms -> 1.05
-- Adding them moves the roster mean from 1.06711 to 1.06667, which leaves the
-- survivalOdds fit in lib/game/difficulty.ts calibrated. Expect these to move
-- again whenever that calibration does.
--
-- WHAT THIS FILE DOES NOT DO, AND WHY, unlike 0009, 0010 and 0012. Those three
-- each restated every zone's placement_zones.allowed_types array in full. This
-- one touches that column not at all, and no later roster migration should
-- either.
--
-- allowed_types was the storage behind the `type_not_allowed` rejection.
-- 0014_free_placement retired that rejection from both the client and
-- publish_child_challenge, so the column now gates nothing: a trap missing from
-- a zone's array is still placeable there, and a trap present in one can still
-- be refused on geometry. Restating it here would mean hand-maintaining a
-- 54-entry text[] per zone to keep data honest that no code reads, and it would
-- grow by sixteen again with every wave. The parity test that used to pin those
-- arrays against lib/game/level-definition.ts is `it.skip` for the same reason.
--
-- The column is left in place rather than dropped because 0002_tables.sql
-- declares it not-null and something may want a per-surface allowlist again. If
-- that happens, the arrays should be regenerated from the roster in one pass
-- rather than appended to wave by wave.
--
-- max_occupants is untouched for the same reason: 0014 retired the `zone_full`
-- cap, so there is no longer a cap to raise.
--
-- UNVERIFIED AGAINST A LIVE DATABASE. No Postgres was available where this was
-- written, so this file has been checked for parity against the TypeScript
-- catalogue by tests/unit/sql-parity.test.ts and by nothing else. It has never
-- been executed.

insert into public.trap_catalog(type, display_name, category, placement_radius, risk_weight, sort_order) values
  ('paparazzi', 'Paparazzo', 'prop', .85, .9, 39),
  ('bathroom_scales', 'Bathroom Scales', 'sweeper', .95, 1.1, 40),
  ('slow_fuse', 'Kitchen Timer', 'prop', .8, 1, 41),
  ('pile_on', 'Toppling Bookcase', 'prop', 1.1, 1.1, 42),
  ('bin_pedal', 'Pedal Bin', 'movement', .9, 1, 43),
  ('swing_door', 'Swing Door', 'sweeper', 1.15, 1.25, 44),
  ('ball_machine', 'Ball Machine', 'movement', .95, 1.1, 45),
  ('cuckoo_clock', 'Cuckoo Clock', 'sweeper', .9, 1.15, 46),
  ('fish_bowl', 'Fish Bowl', 'movement', .85, 1, 47),
  ('shoe_rack', 'Shoe Rack', 'sweeper', 1, 1.05, 48),
  ('hot_potato', 'Hot Potato', 'prop', .7, 1.15, 49),
  ('stove_ring', 'Hob Ring', 'movement', .85, 1.05, 50),
  ('clothes_airer', 'Clothes Airer', 'sweeper', 1, 1.05, 51),
  ('ice_dispenser', 'Ice Dispenser', 'prop', 1.1, 1, 52),
  ('kettle_boil', 'Boiling Kettle', 'movement', .9, 1.1, 53),
  ('junk_drift', 'Junk Drift', 'prop', .75, 1.05, 54)
on conflict (type) do update set
  display_name = excluded.display_name,
  category = excluded.category,
  placement_radius = excluded.placement_radius,
  risk_weight = excluded.risk_weight,
  sort_order = excluded.sort_order;
