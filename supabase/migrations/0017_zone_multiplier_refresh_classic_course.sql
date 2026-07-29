-- Refresh the zone_risk_multiplier snapshot after the classic course was
-- reshaped to contain jumps.
--
-- Supersedes 0016_zone_multiplier_refresh_rooms.sql, which snapshotted this
-- same reshaping while it was still half done: its header describes the islands
-- at 1.70u and the stepping stones at 2.00u, which were intermediate widths.
-- The stones are 2.60u and the islands 1.90u as shipped. 0016 is left in place
-- because migrations are fix-forward and running both in order lands on these
-- values; nothing in it needs undoing.
--
-- 0016 also recorded a finding that survives this refresh and is worth keeping:
-- difficulty.ts clamps the dodge-room ratio to [0.85, 1.25], and every one of
-- the fifteen classic zones lands outside that clamp, so the term saturates and
-- distinguishes nothing across this course. That is why the fifteen branches
-- below collapse to two distinct values. It is a property of difficulty.ts, not
-- of the geometry, and it is not addressed here.
--
-- The twelve pieces of the original course overlapped continuously in Z from 0
-- to 41, so the widest gap anywhere on it was 0.30u - narrower than the runner's
-- own capsule - and the whole level ran with W held down. The one thing that
-- ever interrupted it was a 0.35u step where the runway passed under stone-b,
-- and because the two overlapped in Z there was no gap in front of that step to
-- read as a jump. The runner is a dynamic Rapier body with no character
-- controller, so nothing lifts them over a ledge: holding W from spawn stopped
-- dead against it about four seconds in.
--
-- lib/game/level-definition.ts now opens five real gaps, between 1.10u and
-- 1.61u, and leaves no riser a runner can walk into. The zones moved with the
-- pieces they stand on. Ids, allowlists and occupancy caps are unchanged, which
-- is what lets a challenge already in circulation replay: a stored placement
-- names a zone and an offset from that zone's centre, never a world position.
--
-- Two things move these branches, and both are the same mechanism 0011 and 0013
-- documented:
--
-- 1. difficulty.ts prices a zone partly on the longest jump its segment forces,
--    against what the runner can clear. The classic course's worst carry went
--    from 0.30u to 1.61u, so every zone on it now carries a real carry term
--    where before it carried almost none. That is why all fifteen rose.
--
-- 2. The same file normalises against the mean over every authored zone, so the
--    classic course's own move drags its denominator with it and damps the
--    change. The three stone zones are the clearest case: they widened from
--    2.4u to 2.6u, which alone would have made them cheaper, and they still
--    ended up dearer because the carry term outweighs the dodge room.
--
-- The stones also stopped being three different prices. They were 0.9164,
-- 0.9164 and 0.8637 because stones_back was authored 2.5u wide against the
-- other two at 2.4u; all three pads are now the same size, so all three price
-- the same. stones_front had a second problem worth recording: it ran from
-- x -2.4 to 0 over a pad that stopped at -0.4, so two fifths of that zone hung
-- over the void and a trap could legally be placed off the edge of the stone.
--
-- Refreshed by the method 0008 established: re-run the probe in
-- tests/unit/sql-parity.test.ts, which computes each value through the real
-- totalRisk() and fails the moment this file drifts from it. That test is the
-- verification for these constants - do not silence it, refresh this snapshot.
--
-- UNVERIFIED AGAINST A LIVE DATABASE, exactly as 0008, 0009, 0011 and 0013 are.
-- This file has not been executed against Postgres. It is a pure function
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
    when 'runway_front' then 0.7391874747
    when 'runway_mid' then 0.7391874747
    when 'runway_back' then 0.7391874747
    when 'stones_front' then 0.8696323231
    when 'stones_mid' then 0.8696323231
    when 'stones_back' then 0.8696323231
    when 'bridge_front' then 1.0870404039
    when 'bridge_mid' then 1.0870404039
    when 'bridge_back' then 1.0870404039
    when 'island_left' then 1.0870404039
    when 'island_right' then 1.0870404039
    when 'convergence' then 0.7391874747
    when 'ramp' then 0.7391874747
    when 'finish_front' then 0.7391874747
    when 'finish_mid' then 0.7391874747
    else 1
  end
$$;
