import { describe, expect, it } from "vitest";
import { PLAYER } from "@/lib/game/constants";
import type { LevelPiece } from "@/lib/game/level-definition";
import {
  CLASSIC_TRACK,
  DEFAULT_CUSTOM_TRACK,
  JUMP_DISTANCE,
  JUMP_HEIGHT,
  JUMP_MARGIN,
  TRACK_SEGMENTS,
  buildTrack,
  composeFreshTrack,
  isPlayableTrack,
  worstTraverse,
} from "@/lib/game/track";

/**
 * What the runner can actually do, as opposed to what track.ts publishes.
 *
 * Every other test in this project measures courses against the closed-form
 * jump budget in track.ts. That form is continuous, undamped in neither axis,
 * and knows nothing about the apex and fall gravity PlayerController applies at
 * runtime, so on its own it is a claim rather than a measurement. This file
 * closes the gap by integrating the vertical motion the way the game does and
 * asserting the published budget is a floor the real arc clears, not a promise
 * the simulation has to keep.
 *
 * The integration below duplicates PlayerController's vertical rules, which is
 * a real risk - a second copy of a rule is how the traversal check drifted
 * across three call sites earlier in this project. It is confined to this file,
 * every number it uses comes from PLAYER rather than a literal, and it exists
 * because Rapier cannot be stepped from a node test. Changing the controller's
 * vertical block without changing this mirror is the failure to watch for.
 */

/** Rapier is mounted with a fixed timeStep in GameCanvas, so this is exact. */
const PHYSICS_STEP = 1 / 60;
const EARTH_GRAVITY = 9.81;
const RUNNER_HEIGHT = 2 * PLAYER.capsuleHalfHeight + 2 * PLAYER.capsuleRadius;
const RISE_BUDGET = JUMP_HEIGHT * JUMP_MARGIN;
const GAP_BUDGET = JUMP_DISTANCE * JUMP_MARGIN;

/**
 * One jump, sampled every physics step, as height above the take-off surface.
 *
 * Order of operations mirrors the controller and Rapier: the controller picks
 * the gravity scale from the velocity it is about to write, Rapier then applies
 * gravity, then damping, then advances the position.
 */
function jumpArc(takeoffVelocity: number, shaped: boolean): number[] {
  const heights = [0];
  let velocity = takeoffVelocity;
  let height = 0;
  while (heights.length < 3000) {
    let gravity = PLAYER.gravityScale;
    if (shaped) {
      if (Math.abs(velocity) <= PLAYER.apexVelocityWindow)
        gravity *= PLAYER.apexGravityMultiplier;
      else if (velocity < 0) gravity *= PLAYER.fallGravityMultiplier;
    }
    velocity -= EARTH_GRAVITY * gravity * PHYSICS_STEP;
    velocity /= 1 + PHYSICS_STEP * PLAYER.linearDamping;
    velocity = Math.max(-PLAYER.maxFallSpeed, velocity);
    height += velocity * PHYSICS_STEP;
    heights.push(height);
    if (height < 0 && velocity < 0) break;
  }
  return heights;
}

/**
 * How far forward the runner still travels while at or above `rise`.
 *
 * Horizontal speed is held at moveSpeed: the controller re-applies up to
 * acceleration * airControl every frame, which is 10.5 u/s^2 against the
 * 3.24 u/s^2 linear damping removes at full speed, so the runner does not slow
 * down in the air. Returns -1 for a rise the arc never reaches.
 */
function reachAtRise(takeoffVelocity: number, rise: number, shaped = true): number {
  const heights = jumpArc(takeoffVelocity, shaped);
  let lastStep = -1;
  heights.forEach((height, step) => {
    if (height >= rise) lastStep = step;
  });
  return lastStep < 0 ? -1 : PLAYER.moveSpeed * lastStep * PHYSICS_STEP;
}

const peak = (takeoffVelocity: number, shaped = true) =>
  Math.max(...jumpArc(takeoffVelocity, shaped));

/** The hop the player is left with after releasing the button immediately. */
const CUT_VELOCITY = PLAYER.jumpVelocity * PLAYER.jumpCutMultiplier;

/**
 * The height a capsule climbs on its own, which is not a tolerance but a
 * consequence of its shape: the contact normal off a ledge points upward only
 * while the ledge sits below the centre of the bottom hemisphere, and that
 * centre stands exactly capsuleRadius off the floor. Above it the normal points
 * back at the runner and they stop dead.
 */
const RIDE_HEIGHT = PLAYER.capsuleRadius;
/** Authored tenths summed along buildTrack's cursor, not slack on the design. */
const TOUCHING = 1e-9;

interface Riser {
  rise: number;
  from: string;
  to: string;
  owner?: string;
}

/**
 * Steps the runner meets head-on, with no gap in front of them to read as a
 * jump: two pieces whose footprints touch or overlap in both axes, the far one
 * standing higher than the capsule can ride.
 *
 * Touching counts, and that is the whole point. buildTrack lays segments end to
 * end with no gap, so the pieces either side of a seam share a face exactly;
 * measuring only strict overlap sees none of them and reports a course clean
 * when its last seam is a wall.
 */
function walkIntoRisers(pieces: readonly LevelPiece[]): Riser[] {
  const prints = pieces
    .map((piece) => ({
      id: piece.id,
      minX: piece.center[0] - piece.size[0] / 2,
      maxX: piece.center[0] + piece.size[0] / 2,
      minZ: piece.center[2] - piece.size[2] / 2,
      maxZ: piece.center[2] + piece.size[2] / 2,
      top: piece.center[1] + piece.size[1] / 2,
    }))
    .sort((a, b) => a.minZ - b.minZ);
  const found: Riser[] = [];
  for (let index = 1; index < prints.length; index += 1) {
    const to = prints[index]!;
    for (let from = 0; from < index; from += 1) {
      const source = prints[from]!;
      if (Math.min(source.maxZ, to.maxZ) - Math.max(source.minZ, to.minZ) < -TOUCHING)
        continue;
      if (Math.min(source.maxX, to.maxX) - Math.max(source.minX, to.minX) < -TOUCHING)
        continue;
      const rise = to.top - source.top;
      if (rise > RIDE_HEIGHT) found.push({ rise, from: source.id, to: to.id });
    }
  }
  return found;
}

describe("how the jump actually behaves", () => {
  it("clears the runner's own standing height", () => {
    // The complaint this tuning answers: at 1.15u against a 1.86u body the
    // runner could not get his feet over his own head, which reads as heavy
    // whatever the course demands of him.
    expect(RUNNER_HEIGHT).toBeCloseTo(1.86, 6);
    expect(
      peak(PLAYER.jumpVelocity),
      `peak ${peak(PLAYER.jumpVelocity).toFixed(3)}u against a ${RUNNER_HEIGHT}u runner`,
    ).toBeGreaterThan(RUNNER_HEIGHT);
  });

  it("delivers the budget isPlayableTrack certifies", () => {
    // track.ts hands out a height and a distance and refuses shared courses
    // that ask for more than 90% of either. Those are the numbers a player has
    // to be able to hit, so the simulated arc has to clear both.
    expect(peak(PLAYER.jumpVelocity)).toBeGreaterThan(RISE_BUDGET);
    expect(reachAtRise(PLAYER.jumpVelocity, 0)).toBeGreaterThan(GAP_BUDGET);
  });

  it("never lets the apex and fall shaping cost the runner reach", () => {
    // The shaping is invisible to track.ts, which solves the budget from a
    // single gravityScale. That is only sound while the shaped arc dominates
    // the plain one everywhere, so a course certified against the plain form
    // stays crossable with the shaping switched on.
    expect(peak(PLAYER.jumpVelocity)).toBeGreaterThanOrEqual(
      peak(PLAYER.jumpVelocity, false),
    );
    for (let rise = 0; rise <= RISE_BUDGET; rise += 0.05)
      expect(
        reachAtRise(PLAYER.jumpVelocity, rise),
        `shaped arc is short of the plain one at a ${rise.toFixed(2)}u rise`,
      ).toBeGreaterThanOrEqual(reachAtRise(PLAYER.jumpVelocity, rise, false));
  });

  it("crosses every authored segment on a held jump", () => {
    // worstTraverse reports the hardest carry and the hardest step a segment
    // asks for, which need not be the same hop. Requiring one arc to clear
    // both at once is therefore stricter than the course really is, and it
    // passing means no authored hop is beyond the runner.
    for (const segment of TRACK_SEGMENTS) {
      const ids =
        segment.id === "classic" ? ["classic"] : ["start", segment.id, "finish"];
      const { gap, rise } = worstTraverse(buildTrack(ids));
      expect(
        reachAtRise(PLAYER.jumpVelocity, rise),
        `${segment.id}: the arc stalls at ${rise.toFixed(2)}u and cannot carry ${gap.toFixed(2)}u`,
      ).toBeGreaterThan(gap);
    }
  });

  it("crosses every authored segment on the shortest possible hop", () => {
    // Releasing the button at the first opportunity is the weakest jump the
    // game can produce, and a player who taps rather than holds is still a
    // player. Scored the way track.ts scores a course, with carry and step
    // measured independently, every segment in the catalogue is inside a
    // tapped hop, so the taller jump is an improvement to the existing courses
    // rather than a trade against the players who never hold the button.
    //
    // The published budget itself is what a held jump delivers, not a tapped
    // one. A composer can author a carry up to it, and a carry that long is a
    // jump the player is meant to commit to.
    for (const segment of TRACK_SEGMENTS) {
      const ids =
        segment.id === "classic" ? ["classic"] : ["start", segment.id, "finish"];
      const { gap, rise } = worstTraverse(buildTrack(ids));
      expect(reachAtRise(CUT_VELOCITY, 0), `${segment.id} carry`).toBeGreaterThan(gap);
      expect(peak(CUT_VELOCITY), `${segment.id} step`).toBeGreaterThan(rise);
    }
    // Height is the half the player has to earn: the tallest step the budget
    // certifies is out of reach of a tap, which is what makes holding the
    // button a decision rather than a habit.
    expect(peak(CUT_VELOCITY)).toBeLessThan(RISE_BUDGET);
  });

  it("keeps the shipped tracks playable under the rule that gates shared links", () => {
    expect(isPlayableTrack(CLASSIC_TRACK)).toBe(true);
    expect(isPlayableTrack(DEFAULT_CUSTOM_TRACK)).toBe(true);
  });

  it("lifts the runner over the seams and over nothing else", () => {
    // The census the step assist is set from, re-derived from the catalogue
    // every run so the height in constants.ts cannot drift away from the
    // geometry it was solved for.
    //
    // Two populations, and the assist has to sit between them. A riser at a
    // seam between two segments is always an accident, because exitOffset and
    // the lane exist precisely to hand the runner over at the height they
    // arrived at; a riser inside one segment is the author's, and five of them
    // describe theirs as a jump in so many words. Clearing the first and none
    // of the second is the whole of the design decision here.
    const seam: Riser[] = [];
    for (const from of TRACK_SEGMENTS)
      for (const to of TRACK_SEGMENTS) {
        if (from.id === "classic" || to.id === "classic") continue;
        const built = buildTrack([from.id, to.id]);
        const near = new Set(built.pieces.slice(0, from.pieces.length).map((p) => p.id));
        for (const riser of walkIntoRisers(built.pieces))
          if (near.has(riser.from) && !near.has(riser.to))
            seam.push({ ...riser, owner: `${from.id} -> ${to.id}` });
      }
    const authored = TRACK_SEGMENTS.flatMap((segment) =>
      walkIntoRisers(segment.pieces).map((riser) => ({ ...riser, owner: segment.id })),
    );

    // Nothing may hand the runner over at a height they cannot walk up to.
    expect(seam.length, "no segment pair produces a seam riser at all").toBeGreaterThan(0);
    for (const riser of seam)
      expect(
        riser.rise,
        `${riser.owner} hands over a ${riser.rise.toFixed(2)}u wall at ${riser.from} -> ${riser.to}`,
      ).toBeLessThanOrEqual(PLAYER.stepAssistHeight);

    // Every riser a segment authors above the assist has to be a jump the
    // weakest hop in the game can actually make, or it is a wall by accident.
    const mechanics = authored.filter((riser) => riser.rise > PLAYER.stepAssistHeight);
    for (const riser of mechanics)
      expect(
        peak(CUT_VELOCITY),
        `${riser.owner} asks for a ${riser.rise.toFixed(2)}u standing climb at ${riser.from} -> ${riser.to}`,
      ).toBeGreaterThan(riser.rise);

    // And the one segment that authors a riser under the assist is a known
    // defect rather than a mechanic: upper_deck's own comment enumerates its
    // climbs as "0.4u then 0.8u, both over 1.2u of open air" and misses the
    // third, which is 0.4u flush against the sill it exits on. The assist
    // covers it. Should the geometry be opened up instead, this expectation is
    // the thing to delete - and if a second segment ever joins it, that is a
    // mechanic quietly being walked up rather than jumped.
    expect(
      authored
        .filter((riser) => riser.rise <= PLAYER.stepAssistHeight)
        .map((riser) => `${riser.owner}:${riser.from}->${riser.to}`),
    ).toEqual(["upper_deck:deck->sill"]);
  });

  it("leaves no composed course with a wall the runner can neither walk nor jump", () => {
    // The bug this file is guarding: every "play a clean level" is a composed
    // course, and before the assist essentially all of them contained a riser
    // flush against the floor in front of it, so holding W stopped dead with
    // nothing on screen to say why.
    let walked = 0;
    let jumped = 0;
    for (let seed = 1; seed <= 200; seed += 1) {
      const ids = composeFreshTrack(seed);
      for (const riser of walkIntoRisers(buildTrack(ids).pieces)) {
        if (riser.rise <= PLAYER.stepAssistHeight) {
          walked += 1;
          continue;
        }
        jumped += 1;
        expect(
          peak(CUT_VELOCITY),
          `seed ${seed}: ${riser.from} -> ${riser.to} is a ${riser.rise.toFixed(2)}u wall`,
        ).toBeGreaterThan(riser.rise);
      }
    }
    // Both populations have to be represented, or the sweep has stopped
    // measuring what it claims to: the assist is doing work, and the segments
    // that author a climb still author one.
    expect(walked, "no composed course exercises the step assist").toBeGreaterThan(0);
    expect(jumped, "no composed course still asks for a climb").toBeGreaterThan(0);
  });

  it("keeps the shortest hop ahead of the fixed jump it replaced", () => {
    // The jump used to be one height for everyone: 7.4 u/s under a 2.2 gravity
    // scale, which peaks at 1.095u and carries 4.56u through this same
    // integration. Variable height is only free if the floor of the new range
    // sits at or above that ceiling, otherwise letting go early is a way to
    // fail a course that used to be clearable.
    expect(peak(CUT_VELOCITY)).toBeGreaterThan(1.095);
    expect(reachAtRise(CUT_VELOCITY, 0)).toBeGreaterThanOrEqual(4.56);
  });
});
