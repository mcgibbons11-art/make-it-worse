-- SUPERSEDED BY 0017_zone_multiplier_refresh_classic_course.sql, AND THE
-- ANALYSIS BELOW IS WRONG. Left in place because it is harmless once 0017
-- replaces the function, and removing a migration other people may have run is
-- worse than annotating it.
--
-- Two things to correct for anyone reading this file rather than 0017:
--
-- 1. THE VALUES. These were measured mid-reshape, against island zones at 1.70u
--    and stepping stones at 2.00u. Neither width shipped; the finished course
--    carries 1.90u and 2.60u. Every constant below is therefore a snapshot of
--    geometry that never existed outside one afternoon.
--
-- 2. THE SATURATION CLAIM, which is the part worth correcting properly. This
--    header says the fifteen classic multipliers "collapse to just TWO distinct
--    values" and that "EVERY ONE of the fifteen lands outside the clamp". On the
--    finished course, measured: THREE distinct values, and 3 of 15 sit INSIDE
--    the [0.85, 1.25] clamp rather than 0 of 15.
--      0.7391874747  runway x3, convergence, ramp, finish x2
--      0.8696323231  stones x3
--      1.0870404039  bridge x3, islands x2
--    The stepping stones land at 1.840u of dodge room, which is exactly the
--    median across all 103 authored zones, so they sit at r = 1.00 - dead centre
--    of the clamp - and price themselves rather than pinning to an end.
--
--    So the dodge-room term is DEGRADED, NOT DEAD: 12 of 15 saturate, 3 do not.
--    That distinction matters, because "collapses to two, everything saturates"
--    argues for a larger clamp change than the evidence supports. If the clamp
--    is to discriminate across this course it needs to span roughly
--    [0.41, 1.62] against the classic zones' 3.9:1 width ratio - that is the
--    measured requirement, not a balance recommendation.

-- Refresh the zone_risk_multiplier snapshot after the course was reshaped.
--
-- Same mechanism as 0011 and 0013: lib/game/difficulty.ts normalises every zone
-- against the MEDIAN dodge room and the MEAN raw value across all authored
-- zones, so changing the geometry anywhere moves the denominator under all
-- fifteen classic zones whether or not those zones themselves changed. Here
-- they did change - the islands narrowed to 1.70u and the stepping stones to
-- 2.00u - so both terms moved at once.
--
-- READ THIS BEFORE TRUSTING THESE NUMBERS. The fifteen branches below collapse
-- to just TWO distinct values, 0.7488820179 and 1.1012970851, where 0013 had
-- four. That is not a transcription error, and it is not good news. The
-- dodge-room term is
--     clamp(DODGE_ROOM_FLOOR, medianRoom / room, DODGE_ROOM_CEILING)
-- with the clamp at [0.85, 1.25]. Measured against the current course, the
-- median room is 1.840u and the classic zones' rooms run 0.94u to 4.44u, so the
-- ratio spans 0.414 to 1.955 - and EVERY ONE of the fifteen lands outside the
-- clamp. The term is saturated at one end or the other for the whole classic
-- course, so it distinguishes nothing: wide zones all price identically and
-- narrow zones all price identically, however wide or narrow they actually are.
--
-- The snapshot is refreshed anyway, and deliberately, because client/server
-- parity is not optional: publish_child_challenge prices a placement with these
-- constants and lib/game/difficulty.ts prices the same placement in the editor,
-- and a player who is shown one number and charged another is a worse bug than
-- a blunt model. Widening the clamp is a balance change in difficulty.ts, owned
-- by whoever owns the trap roster, and it should be made there and then
-- refreshed here rather than smuggled into a migration.
--
-- Refreshed by the method 0008 established: re-run the probe in
-- tests/unit/sql-parity.test.ts, which computes each value through the real
-- totalRisk() and fails the moment this file drifts from it.
--
-- UNVERIFIED AGAINST A LIVE DATABASE, exactly as 0008 through 0014 are. Pure
-- function replacement, no schema or data change.

create or replace function public.zone_risk_multiplier(p_zone_id text)
returns double precision
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select case p_zone_id
    when 'runway_front' then 0.7488820179
    when 'runway_mid' then 0.7488820179
    when 'runway_back' then 0.7488820179
    when 'stones_front' then 1.1012970851
    when 'stones_mid' then 1.1012970851
    when 'stones_back' then 1.1012970851
    when 'bridge_front' then 1.1012970851
    when 'bridge_mid' then 1.1012970851
    when 'bridge_back' then 1.1012970851
    when 'island_left' then 1.1012970851
    when 'island_right' then 1.1012970851
    when 'convergence' then 0.7488820179
    when 'ramp' then 0.7488820179
    when 'finish_front' then 0.7488820179
    when 'finish_mid' then 0.7488820179
    else 1
  end
$$;
