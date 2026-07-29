-- Re-seed placement_zones from the level's real geometry.
--
-- A LIVE CLIENT/SERVER DIVERGENCE, found by a QA probe rather than by any
-- existing test, and worth stating plainly because it is the exact failure
-- 0014 was written to prevent.
--
-- The course was reshaped tonight. lib/game/level-definition.ts moved almost
-- every piece and zone; placement_zones still held the extents seeded by 0005
-- and 0014. 24 of 27 surfaces had drifted, several by 1.7u to 2.0u.
--
-- WHY THAT IS NOT COSMETIC. Both sides turn a stored placement into a world
-- position the same way, by adding the offset to the surface's CENTRE:
--     client  lib/game/placement.ts   cx = (surface.minX + surface.maxX) / 2
--     server  publish_child_challenge v_x := (v_zone.min_x + v_zone.max_x) / 2 + v_ox
-- so a drifted centre means the two sides place the same trap in two different
-- places. The client draws a legal green preview, the player commits, and the
-- server writes the trap somewhere else - or refuses it as outside_zone against
-- extents the player never saw. That is the class of bug that previously let a
-- player publish a level which then threw forever on read.
--
-- WHY THE OFFSET DESIGN IS STILL RIGHT. Storing an offset from a surface centre
-- rather than a world position is what lets a trap stay ON the platform it was
-- placed on when the course is re-authored: move the bridge, and the trap on
-- the bridge moves with it. The cost is that the surface table has to be
-- refreshed whenever geometry changes, which is what this migration is. The
-- alternative - absolute world positions - would leave old traps hanging in the
-- air where a platform used to be, which is worse.
--
-- KNOWN AND ACCEPTED CONSEQUENCE, so nobody reports it later as a fresh bug:
-- challenge links minted before the reshape still decode, and their traps still
-- land on the surfaces they were placed on, but at different world positions
-- than the sender saw. The QA probe measured two on the pinned v1 payload -
-- floor_fan on runway_mid moved 1.70u and giant_beach_ball on bridge_front
-- moved 2.00u. Both remain legal placements on their own surfaces. The link
-- guarantee this project actually makes is "a shared level stays playable and
-- keeps its traps on their platforms", not "every trap keeps its world
-- coordinate through a level re-author", and the second is not achievable while
-- the course is still being designed.
--
-- The fifteen authored zones and the ten raw level pieces are both seeded, for
-- the reason 0014 gave: free placement made every LevelPiece a placement
-- surface, so the server has to know their extents too.
--
-- UNVERIFIED AGAINST A LIVE DATABASE, exactly as 0008 through 0017 are. Pure
-- data replacement, no schema change. tests/unit/qa-probe.test.ts PROBE A is
-- what catches this drifting again, and it should be kept.

insert into public.placement_zones(id, label, min_x, max_x, min_z, max_z, ground_y, max_occupants, allowed_types)
select v.id, v.label, v.min_x, v.max_x, v.min_z, v.max_z, v.ground_y, 4,
       array(select type from public.trap_catalog where enabled)
from (values
  ('runway_front','Runway front',-2.300,2.300,4.300,5.800,0.050),
  ('runway_mid','Runway middle',-2.300,2.300,6.100,7.500,0.050),
  ('runway_back','Runway back',-2.300,2.300,7.800,9.000,0.050),
  ('stones_front','First stones',-1.300,1.300,10.600,12.400,0.050),
  ('stones_mid','Middle stone',-3.050,-0.450,13.500,15.300,0.050),
  ('stones_back','Last stone',0.350,2.950,16.400,18.200,0.050),
  ('bridge_front','Bridge front',-1.050,1.050,19.500,21.100,0.050),
  ('bridge_mid','Bridge middle',-1.050,1.050,21.400,23.000,0.050),
  ('bridge_back','Bridge back',-1.050,1.050,23.100,25.000,0.050),
  ('island_left','Left island',-3.150,-1.250,26.500,30.500,0.050),
  ('island_right','Right island',1.250,3.150,26.500,30.500,0.050),
  ('convergence','Convergence',-2.200,2.200,30.600,32.500,0.050),
  ('ramp','Ramp',-1.550,1.550,32.700,34.500,0.450),
  ('finish_front','Finish approach',-2.600,2.600,35.400,37.000,0.450),
  ('finish_mid','Finish middle',-2.400,2.400,37.300,38.700,0.450),
  ('start','Start',-4.000,4.000,0.000,4.000,0.000),
  ('runway','Runway',-3.000,3.000,4.000,9.500,0.000),
  ('stone-a','Stone a',-1.300,1.300,10.600,12.400,0.000),
  ('stone-b','Stone b',-3.050,-0.450,13.500,15.300,0.000),
  ('stone-c','Stone c',0.350,2.950,16.400,18.200,0.000),
  ('bridge','Bridge',-1.300,1.300,19.300,25.200,0.000),
  ('left-island','Left island',-3.350,-1.050,26.300,30.500,0.000),
  ('center-island','Center island',-0.550,0.550,26.300,29.900,-0.400),
  ('right-island','Right island',1.050,3.350,26.300,30.500,0.000),
  ('finish','Finish',-3.500,3.500,35.100,41.100,0.400)
) as v(id,label,min_x,max_x,min_z,max_z,ground_y)
on conflict (id) do update set
  label = excluded.label,
  min_x = excluded.min_x,
  max_x = excluded.max_x,
  min_z = excluded.min_z,
  max_z = excluded.max_z,
  ground_y = excluded.ground_y;
