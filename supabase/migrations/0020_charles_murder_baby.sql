-- Fix-forward parity for the 55th trap and the larger Junk Drift footprint.
--
-- Charles was appended to TRAP_TYPES after the Wave B migration but did not
-- receive the public.trap_catalog row publish_child_challenge validates
-- against. Without this row the client can offer and render Charles while the
-- database rejects publishing him as type_not_allowed.
--
-- Junk Drift also grew from .75 to .9 during its visual/effect redesign. The
-- catalogue radius governs overlap placement, so SQL and TypeScript must agree
-- or the server can accept a pile the client would refuse (or vice versa).

insert into public.trap_catalog(type, display_name, category, placement_radius, risk_weight, sort_order) values
  ('junk_drift', 'Junk Drift', 'prop', .9, 1.05, 54),
  ('charles_murder_baby', 'Charles the Murder Baby', 'prop', .7, 1.4, 55)
on conflict (type) do update set
  display_name = excluded.display_name,
  category = excluded.category,
  placement_radius = excluded.placement_radius,
  risk_weight = excluded.risk_weight,
  sort_order = excluded.sort_order;
