-- Refresh the zone_risk_multiplier snapshot after the shape segments landed and
-- the runner's jump was retuned.
--
-- Two independent changes moved these branches at once, and separating them
-- matters for anyone reading the diff:
--
-- 1. lib/game/segments-shapes.ts added segments to the authored roster.
--    difficulty.ts normalises every zone against the MEDIAN dodge room and the
--    MEAN raw value across all authored zones, so widening the roster moves the
--    denominator under all fifteen classic zones without any of them changing
--    shape. This is the same mechanism 0011 documented.
--
-- 2. The jump budget was retuned: JUMP_HEIGHT 1.1516 -> 1.9480 and
--    JUMP_DISTANCE 4.5917 -> 5.1001. The third term difficulty.ts gained in
--    0011 prices the longest jump a segment forces AGAINST what the runner can
--    actually clear, so a more capable runner makes carry-heavy ground cheaper
--    relative to narrow ground.
--
-- The branches are not a uniform rescale, and the two largest moves are both
-- explained by (2). stones_front rose the most, 0.8074849794 -> 0.9164100863,
-- because the stepping stones are priced on dodge room rather than carry and so
-- gained nothing from the longer jump while the mean moved under them. The two
-- islands converged onto the bridge value, 1.0093562242 -> 1.0210003679, having
-- been separated only by a carry term the new budget now absorbs.
--
-- Refreshed by the method 0008 established: re-run the probe in
-- tests/unit/sql-parity.test.ts, which computes each value through the real
-- totalRisk() and fails the moment this file drifts from it. That test is the
-- verification for these constants - do not silence it, refresh this snapshot.
--
-- UNVERIFIED AGAINST A LIVE DATABASE, exactly as 0008, 0009 and 0011 are. This
-- file has not been executed against Postgres. It is a pure function
-- replacement with no schema or data change, so it is the lowest-risk shape a
-- migration can take, but that is an argument about blast radius rather than
-- evidence.

create or replace function public.zone_risk_multiplier(p_zone_id text)
returns double precision
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select case p_zone_id
    when 'runway_front' then 0.6942802502
    when 'runway_mid' then 0.6942802502
    when 'runway_back' then 0.6942802502
    when 'stones_front' then 0.9164100863
    when 'stones_mid' then 0.9164100863
    when 'stones_back' then 0.8637428400
    when 'bridge_front' then 1.0210003679
    when 'bridge_mid' then 1.0210003679
    when 'bridge_back' then 1.0210003679
    when 'island_left' then 1.0210003679
    when 'island_right' then 1.0210003679
    when 'convergence' then 0.6942802502
    when 'ramp' then 0.6942802502
    when 'finish_front' then 0.6942802502
    when 'finish_mid' then 0.6942802502
    else 1
  end
$$;
