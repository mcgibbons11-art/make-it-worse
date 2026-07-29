-- Refresh the zone_risk_multiplier snapshot after nine segments were added.
--
-- This is the drift 0008 predicted in its own header, arriving on schedule.
-- lib/game/difficulty.ts derives each zone's multiplier from authored segment
-- data, then normalises against the MEDIAN dodge room and the MEAN raw value
-- across every authored zone in the game. None of the fifteen classic zones
-- changed shape; the roster around them did.
--
-- Two things moved at once here, which is why the branches are NOT a uniform
-- rescale of 0008's. The added segments shifted the normalising mean, and
-- difficulty.ts gained a third term: the longest jump a segment forces. Width
-- and carry disagree by design - a segment built around long carries needs wide
-- landing pads, so on width alone it read as the safest ground in the game while
-- being the least forgiving - and correcting that inversion re-ranked the
-- classic zones against each other rather than moving them together.
--
-- Refreshed by the same method 0008 used: re-run the probe in
-- tests/unit/sql-parity.test.ts, which computes the live value through the real
-- totalRisk() and fails the moment this file drifts from it. That test is the
-- verification for these constants - do not silence it, refresh this snapshot.
--
-- UNVERIFIED AGAINST A LIVE DATABASE, exactly as 0008 and 0009 are. This file
-- has not been executed against Postgres. It is a pure function replacement
-- with no schema or data change, so it is the lowest-risk shape a migration can
-- take, but that is an argument about blast radius rather than evidence.

create or replace function public.zone_risk_multiplier(p_zone_id text)
returns double precision
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select case p_zone_id
    when 'runway_front' then 0.6863622325
    when 'runway_mid' then 0.6863622325
    when 'runway_back' then 0.6863622325
    when 'stones_front' then 0.8074849794
    when 'stones_mid' then 0.8074849794
    when 'stones_back' then 0.7610777966
    when 'bridge_front' then 0.9882651986
    when 'bridge_mid' then 0.9882651986
    when 'bridge_back' then 0.9882651986
    when 'island_left' then 1.0093562242
    when 'island_right' then 1.0093562242
    when 'convergence' then 0.6863622325
    when 'ramp' then 0.6863622325
    when 'finish_front' then 0.6863622325
    when 'finish_mid' then 0.6863622325
    else 1
  end
$$;
