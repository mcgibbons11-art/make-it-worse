import { PLAYER } from "./constants";
import { buildTrack, JUMP_DISTANCE, TRACK_SEGMENTS, worstTraverse } from "./track";
import { TRAP_CATALOG } from "./trap-catalog";
import type { PlacementZone, TrapInstance, TrapType } from "./types";

/**
 * How much worse a trap is because of where it stands.
 *
 * This used to switch on a zone id prefix, which meant the price tracked what a
 * zone was *named* rather than what it is. `beam` is authored difficulty 3 and
 * is a 1.2u plank, `sidestep` is difficulty 2 and 2.4u wide, and both priced
 * 1.35 because their zones happen to start with "bridge"; `gap`, `zigzag`,
 * `pillars` and `springpit` are all difficulty 3 and all fell through to the
 * 1.15 default, the same price as the stepping stones. Across the 55 authored
 * zones that scheme correlated with authored difficulty at r = 0.42.
 *
 * Three pieces of authored data replace it, all read off the segment and zone
 * themselves so a new segment is priced correctly the day it is written:
 *
 *   difficulty  Each TrackSegment rates itself 0 to 3. A rating of 3 means a
 *               mistake here ends the run, which amplifies whatever the trap
 *               does, so each step adds DIFFICULTY_STEP.
 *   dodge room  A zone's own width less the player capsule is the space left to
 *               walk around a hazard. It is bounded because past a point extra
 *               width stops helping, and below one the terrain is already the
 *               danger, which `difficulty` has priced.
 *   carry       The longest jump the segment forces. Width and carry disagree
 *               on purpose: a segment built around long carries needs wide
 *               landing pads, so on width alone it reads as the safest ground
 *               in the game while actually being the least forgiving. See
 *               SEGMENT_CARRY.
 *
 * The result is divided by its own mean over every authored zone, so the
 * multiplier expresses only relative position and can never inflate a track on
 * its own. The old scheme averaged 1.13, quietly marking every placement in the
 * game up 13% because the 1.15 default caught 24 of the 55 zones.
 */
const DIFFICULTY_STEP = 0.2;
/** How much a full-budget carry adds on top of the authored rating. */
const CARRY_STEP = 0.35;
/**
 * The dodge-room clamp. DO NOT WIDEN IT WITHOUT RE-MEASURING; the obvious
 * reading of it is backwards.
 *
 * What prompts the question: on the classic course this term saturates almost
 * everywhere. 12 of the 15 classic zones sit outside [0.85, 1.25], so they
 * price at one end or the other and the fifteen collapse to three distinct
 * multipliers. That looks like a clamp strangling a useful signal, and the
 * natural fix looks like widening it - the classic zones span a ratio of 0.414
 * to 1.614, so a clamp of roughly [0.41, 1.62] would let every one of them
 * price itself.
 *
 * Measured against the finished course, widening makes the model WORSE, and
 * monotonically. Correlation between the resulting multiplier and the authored
 * segment difficulty, over all 103 authored zones:
 *
 *   [0.85, 1.25]  r = 0.731   <- current, and the best of any clamp tried
 *   [0.80, 1.30]  r = 0.666
 *   [0.75, 1.40]  r = 0.596
 *   [0.60, 1.60]  r = 0.496
 *   [0.41, 1.62]  r = 0.472   <- the "let every classic zone price itself" clamp
 *   unclamped     r = 0.438
 *
 * The old zone-id-prefix scheme this replaced reads r = 0.462. An unclamped
 * dodge-room term therefore prices worse than the scheme it was written to beat,
 * and would fail the margin in tests/unit/risk-calibration.test.ts outright.
 *
 * WHY, and this part is not an artefact of correlating a formula with its own
 * input. Mean dodge room by authored difficulty, raw width against raw rating:
 *
 *   difficulty 0   12 zones   3.107u
 *   difficulty 1   29 zones   2.630u
 *   difficulty 2   44 zones   1.801u
 *   difficulty 3   18 zones   2.251u   <- wider than difficulty 2, not narrower
 *
 * Width tracks difficulty sensibly from 0 to 2 and then inverts at the top.
 * That is the same inversion SEGMENT_CARRY exists to correct, stated in widths:
 * the hardest segments are built around long jumps, and long jumps need
 * generous landing pads, so the most dangerous ground in the game measures as
 * some of the widest. Overall r(dodgeRoom, difficulty) = -0.264.
 *
 * So the saturation is the clamp doing its job. It is muzzling a signal that
 * points the wrong way exactly where mispricing costs most, and the narrow
 * bounds are load-bearing rather than lazy. If the course is ever rebuilt so
 * that hard ground is also narrow ground, re-measure and this may change.
 */
const DODGE_ROOM_FLOOR = 0.85;
const DODGE_ROOM_CEILING = 1.25;
/** A zone narrower than the capsule is still a zone; keep the ratio finite. */
const MIN_DODGE_ROOM = 0.3;

function dodgeRoom(zone: PlacementZone): number {
  return Math.max(MIN_DODGE_ROOM, zone.maxX - zone.minX - PLAYER.capsuleRadius * 2);
}

/**
 * The longest gap a runner is forced to clear inside a segment, as a share of
 * what they can clear.
 *
 * Width alone gets this wrong in one specific and common way. A segment can be
 * rated difficulty 3 for its jumps rather than its planks, and those segments
 * need generous landing pads by construction - so the dodge-room term drags
 * every one of them to its floor and prices them below a merely narrow
 * difficulty-2 zone. Nine segments authored around carries made the inversion
 * plain, but it predates them: gap_land, pit_lip and pit_landing are all
 * difficulty 3 and all sat at the floor too.
 *
 * Carry is the missing signal. Being knocked about over a void is worse than
 * being knocked about on a wide floor, whatever the floor measures, and that is
 * exactly what the width term cannot see.
 *
 * Measured through the real buildTrack/worstTraverse. A second implementation
 * of the traversal rules is how the zone search drifted across three call sites
 * earlier in this project, and the same trap is open here.
 */
const SEGMENT_CARRY: ReadonlyMap<string, number> = new Map(
  TRACK_SEGMENTS.map((segment) => [
    segment.id,
    Math.max(0, worstTraverse(buildTrack([segment.id])).gap) / JUMP_DISTANCE,
  ]),
);

const ZONE_MULTIPLIERS = ((): ReadonlyMap<string, number> => {
  const zones = TRACK_SEGMENTS.flatMap((segment) =>
    segment.zones.map((zone) => ({
      zone,
      difficulty: segment.difficulty,
      carry: SEGMENT_CARRY.get(segment.id) ?? 0,
    })),
  );
  const rooms = zones.map((entry) => dodgeRoom(entry.zone)).sort((a, b) => a - b);
  const reference = rooms[Math.floor(rooms.length / 2)] ?? 1;
  const raw = zones.map(({ zone, difficulty, carry }) => ({
    id: zone.id,
    value:
      (1 + DIFFICULTY_STEP * difficulty) *
      (1 + CARRY_STEP * carry) *
      Math.min(
        DODGE_ROOM_CEILING,
        Math.max(DODGE_ROOM_FLOOR, reference / dodgeRoom(zone)),
      ),
  }));
  const mean = raw.reduce((sum, entry) => sum + entry.value, 0) / raw.length;
  return new Map(raw.map((entry) => [entry.id, entry.value / mean]));
})();

// buildTrack suffixes every composed zone id with its slot index, and the
// classic course keeps its ids bare, so a lookup has to try both. No authored
// zone id ends in _<digits>, which is what makes stripping one unambiguous.
// An id from neither source is priced neutrally rather than guessed at.
function zoneMultiplier(id: string): number {
  return (
    ZONE_MULTIPLIERS.get(id) ?? ZONE_MULTIPLIERS.get(id.replace(/_\d+$/, "")) ?? 1
  );
}
/**
 * Pairs that are worse together than apart, and by how much.
 *
 * Anything that soaks or stuns cuts the player's steering authority from
 * 30 m/s^2 to roughly 7, so a trap that pushes becomes far harder to fight
 * next to one that disables. This table knew only the original eight, which
 * left the strongest combinations in the game priced at zero: a magnet beside
 * any soak beats a soaked player's authority outright, and the mop's wet trail
 * disables without even reporting a hazard.
 */
const SYNERGIES: readonly { pair: readonly [TrapType, TrapType]; bonus: number }[] = [
  // A pusher plus something loose to push.
  { pair: ["floor_fan", "giant_beach_ball"], bonus: .3 },
  { pair: ["floor_fan", "rolling_fridge"], bonus: .3 },
  { pair: ["angry_vacuum", "giant_beach_ball"], bonus: .3 },
  { pair: ["angry_vacuum", "rolling_fridge"], bonus: .3 },
  { pair: ["floor_fan", "laundry_basket"], bonus: .25 },
  // Lost footing plus anything that moves you.
  { pair: ["soap_slick", "spring_pad"], bonus: .25 },
  { pair: ["soap_slick", "swinging_hammer"], bonus: .25 },
  { pair: ["soap_slick", "rotating_toilet"], bonus: .25 },
  { pair: ["soap_slick", "fridge_magnet"], bonus: .4 },
  { pair: ["soap_slick", "floor_fan"], bonus: .3 },
  // The magnet out-pulls a soaked or stunned player, so every soak beside it
  // converts an escapable field into a hold.
  { pair: ["sprinkler", "fridge_magnet"], bonus: .4 },
  { pair: ["robot_mop", "fridge_magnet"], bonus: .35 },
  { pair: ["banana_peel", "fridge_magnet"], bonus: .3 },
  // The mop's trail cuts authority without stunning, which makes every
  // neighbouring pusher land harder.
  { pair: ["robot_mop", "floor_fan"], bonus: .3 },
  { pair: ["robot_mop", "sprinkler"], bonus: .3 },
  { pair: ["robot_mop", "angry_vacuum"], bonus: .3 },
  // Sent upward into something overhead.
  { pair: ["spring_pad", "ceiling_fan"], bonus: .4 },
  { pair: ["mousetrap", "ceiling_fan"], bonus: .4 },
  { pair: ["spring_pad", "toaster_launcher"], bonus: .25 },
  // Knocked into a line of fire you cannot steer out of.
  { pair: ["banana_peel", "toaster_launcher"], bonus: .25 },
  { pair: ["sprinkler", "swinging_hammer"], bonus: .25 },
];

/** Traps interact only when close enough to catch a player in both. */
const SYNERGY_RANGE = 4;

export function totalRisk(traps:readonly TrapInstance[]):number{
  let risk=traps.reduce((sum,trap)=>sum+TRAP_CATALOG[trap.type].riskWeight*zoneMultiplier(trap.zoneId),0);
  for(let i=0;i<traps.length;i+=1)for(let j=i+1;j<traps.length;j+=1){
    const a=traps[i]!;const b=traps[j]!;
    if(Math.hypot(a.position[0]-b.position[0],a.position[2]-b.position[2])>SYNERGY_RANGE)continue;
    for(const {pair,bonus} of SYNERGIES)
      if((a.type===pair[0]&&b.type===pair[1])||(a.type===pair[1]&&b.type===pair[0]))risk+=bonus;
  }
  return risk;
}
// Unclamped odds. The displayed survival below floors at 1% so the interface
// never promises certainty, but that floor must not reach the comparison: once
// parent and child both clamp to 0.01 their difference is zero, so every
// publish from roughly depth 11 upward reported the same "1% worse".
function survivalOdds(traps:readonly TrapInstance[]):number{return 1/(1+Math.exp(-(2.35-.43*totalRisk(traps))));}
export function estimatedSurvival(traps:readonly TrapInstance[]):number{return Math.min(.99,Math.max(.01,survivalOdds(traps)));}
export function estimatedWorsePercent(parent:readonly TrapInstance[],child:readonly TrapInstance[]):number{const before=survivalOdds(parent);return Math.min(99,Math.max(1,Math.round(100*(before-survivalOdds(child))/before)));}
export function smoothedSurvival(completions:number,attempts:number):number{return (completions+2)/(attempts+4);}
