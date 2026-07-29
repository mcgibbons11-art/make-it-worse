import { describe, expect, it } from "vitest";
import { EXTRA_SEGMENTS } from "@/lib/game/segments-extra";
import {
  EDITABLE_SEGMENTS,
  JUMP_DISTANCE,
  JUMP_HEIGHT,
  JUMP_MARGIN,
  TRACK_SEGMENTS,
  buildTrack,
  worstTraverse,
} from "@/lib/game/track";
import { PLAYER } from "@/lib/game/constants";
import type { BuiltTrack } from "@/lib/game/track";

// The published budget scores distance and height independently. The real arc
// couples them, so this solves the damped trajectory for the horizontal reach
// still available once the player is `rise` above take-off. Vertical follows
// the same closed form track.ts uses; horizontal is held at moveSpeed because
// the controller re-applies up to acceleration*airControl every frame, which
// beats linearDamping at 7.2u/s.
const G = 9.81 * PLAYER.gravityScale;
const D = PLAYER.linearDamping;
function height(t: number): number {
  return (PLAYER.jumpVelocity / D + G / D ** 2) * (1 - Math.exp(-D * t)) - (G / D) * t;
}
function reachAtRise(rise: number): number {
  if (rise <= 0) return PLAYER.moveSpeed * (Math.log(1 + (D * PLAYER.jumpVelocity) / G) / D) * 2;
  if (rise >= JUMP_HEIGHT) return -1;
  let lo = Math.log(1 + (D * PLAYER.jumpVelocity) / G) / D;
  let hi = lo * 4;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (height(mid) > rise) lo = mid;
    else hi = mid;
  }
  return PLAYER.moveSpeed * lo;
}

/** Every piece scored against its easiest predecessor, as worstTraverse does. */
function hops(track: BuiltTrack): { gap: number; rise: number }[] {
  const prints = track.pieces
    .map((p) => ({
      minX: p.center[0] - p.size[0] / 2,
      maxX: p.center[0] + p.size[0] / 2,
      minZ: p.center[2] - p.size[2] / 2,
      maxZ: p.center[2] + p.size[2] / 2,
      top: p.center[1] + p.size[1] / 2,
    }))
    .sort((a, b) => a.minZ - b.minZ);
  const out: { gap: number; rise: number }[] = [];
  for (let i = 1; i < prints.length; i += 1) {
    const to = prints[i]!;
    let best = Infinity;
    let bestRise = 0;
    for (let j = 0; j < i; j += 1) {
      const from = prints[j]!;
      const distance = Math.hypot(
        Math.max(0, from.minX - to.maxX, to.minX - from.maxX),
        Math.max(0, from.minZ - to.maxZ, to.minZ - from.maxZ),
      );
      if (distance < best) {
        best = distance;
        bestRise = to.top - from.top;
      }
    }
    out.push({ gap: best, rise: bestRise });
  }
  return out;
}

// This was a copy of buildTrack that could also see EXTRA_SEGMENTS, kept
// honest by the equality check below. track.ts has registered those segments
// for some time, so the copy bought nothing, and when buildTrack learned to
// carry a lateral and vertical lane across a seam the copy did not: it drew a
// descending segment's successor back at the datum and reported a 2.00u step up
// on a course that has none. The equality check could not see it, because every
// track it compares is built from segments that leave the lane where they found
// it. Measuring through the real thing is the only version of this that works.
const compose = (ids: readonly string[]): BuiltTrack => buildTrack(ids);

const GAP_BUDGET = JUMP_DISTANCE * JUMP_MARGIN;
const RISE_BUDGET = JUMP_HEIGHT * JUMP_MARGIN;

describe("extra track segments", () => {
  it("composes identically to buildTrack", () => {
    for (const ids of [
      ["start", "stones", "finish"],
      ["start", "runway", "runway", "bridge", "finish"],
      ["start", "zigzag", "pillars", "finish"],
    ])
      expect(compose(ids)).toEqual(buildTrack(ids));
  });

  it("prints the budget and the per-segment table", () => {
    const rows: string[] = [];
    rows.push(
      `JUMP_DISTANCE=${JUMP_DISTANCE.toFixed(4)} budget=${GAP_BUDGET.toFixed(4)}  ` +
        `JUMP_HEIGHT=${JUMP_HEIGHT.toFixed(4)} budget=${RISE_BUDGET.toFixed(4)}`,
    );
    rows.push("id           len    far    near   gap    rise   gapHead riseHead");
    for (const segment of EXTRA_SEGMENTS) {
      const far = Math.max(...segment.pieces.map((p) => p.center[2] + p.size[2] / 2));
      const near = Math.min(...segment.pieces.map((p) => p.center[2] - p.size[2] / 2));
      const worst = worstTraverse(compose(["start", segment.id, "finish"]));
      rows.push(
        [
          segment.id.padEnd(12),
          segment.length.toFixed(2).padStart(6),
          far.toFixed(2).padStart(6),
          near.toFixed(2).padStart(6),
          worst.gap.toFixed(3).padStart(6),
          worst.rise.toFixed(3).padStart(6),
          (GAP_BUDGET - worst.gap).toFixed(3).padStart(7),
          (RISE_BUDGET - worst.rise).toFixed(3).padStart(8),
        ].join(" "),
      );
      expect(far, `${segment.id} far`).toBeCloseTo(segment.length, 3);
      expect(near, `${segment.id} near`).toBeGreaterThanOrEqual(-0.001);
      expect(worst.gap, `${segment.id} gap`).toBeLessThan(GAP_BUDGET);
      expect(worst.rise, `${segment.id} rise`).toBeLessThan(RISE_BUDGET);
    }
  });

  it("clears the coupled arc, not just the decoupled budget", () => {
    const rows = ["segment      gap    rise   reach  slack"];
    for (const segment of [...EDITABLE_SEGMENTS, ...EXTRA_SEGMENTS]) {
      let tightest = { gap: 0, rise: 0, reach: Infinity, slack: Infinity };
      for (const hop of hops(compose(["start", segment.id, "finish"]))) {
        const reach = reachAtRise(hop.rise);
        const slack = reach < 0 ? -Infinity : reach - hop.gap;
        if (slack < tightest.slack) tightest = { ...hop, reach, slack };
      }
      rows.push(
        [
          segment.id.padEnd(12),
          tightest.gap.toFixed(3).padStart(6),
          tightest.rise.toFixed(3).padStart(6),
          tightest.reach.toFixed(3).padStart(6),
          tightest.slack.toFixed(3).padStart(6),
        ].join(" "),
      );
    }
    for (const segment of EXTRA_SEGMENTS)
      for (const hop of hops(compose(["start", segment.id, "finish"]))) {
        const reach = reachAtRise(hop.rise);
        expect(
          reach,
          `${segment.id}: a ${hop.gap.toFixed(2)}u hop rising ${hop.rise.toFixed(2)}u is above the arc`,
        ).toBeGreaterThan(hop.gap);
      }
  });

  it("keeps every seam with every other middle segment jumpable", () => {
    const middles = [
      ...EDITABLE_SEGMENTS.map((s) => s.id),
      ...EXTRA_SEGMENTS.map((s) => s.id),
    ];
    let worstPair = { ids: "", gap: 0 };
    for (const first of middles)
      for (const second of middles) {
        const worst = worstTraverse(compose(["start", first, second, "finish"]));
        if (worst.gap > worstPair.gap) worstPair = { ids: `${first} -> ${second}`, gap: worst.gap };
        expect(
          worst.gap,
          `${first} -> ${second}: ${worst.gap.toFixed(3)}u`,
        ).toBeLessThan(GAP_BUDGET);
      }
  });

  it("reports the rise on every seam pair too", () => {
    const middles = [
      ...EDITABLE_SEGMENTS.map((s) => s.id),
      ...EXTRA_SEGMENTS.map((s) => s.id),
    ];
    let worstPair = { ids: "", rise: 0 };
    for (const first of middles)
      for (const second of middles) {
        const worst = worstTraverse(compose(["start", first, second, "finish"]));
        if (worst.rise > worstPair.rise) worstPair = { ids: `${first} -> ${second}`, rise: worst.rise };
      }
    // Asserting beats printing: a seam that needs an impossible step up should
    // fail the build, not scroll past in the log.
    expect(
      worstPair.rise,
      `worst seam rise: ${worstPair.ids} at ${worstPair.rise.toFixed(3)}u`,
    ).toBeLessThan(RISE_BUDGET);
  });

  it("keeps every zone inside a piece it can stand on", () => {
    for (const segment of EXTRA_SEGMENTS)
      for (const z of segment.zones) {
        const host = segment.pieces.find(
          (p) =>
            z.minX >= p.center[0] - p.size[0] / 2 - 1e-9 &&
            z.maxX <= p.center[0] + p.size[0] / 2 + 1e-9 &&
            z.minZ >= p.center[2] - p.size[2] / 2 - 1e-9 &&
            z.maxZ <= p.center[2] + p.size[2] / 2 + 1e-9,
        );
        expect(host, `${segment.id}/${z.id} sits on no single piece`).toBeDefined();
        const top = host!.center[1] + host!.size[1] / 2;
        expect(z.groundY - top, `${segment.id}/${z.id} groundY vs top ${top}`).toBeCloseTo(0.05, 6);
        expect(z.allowedTypes.length, `${segment.id}/${z.id} empty allowedTypes`).toBeGreaterThan(0);
      }
  });

  it("keeps no two pieces overlapping in XZ at different heights", () => {
    // Ground detection takes the highest piece whose XZ footprint contains the
    // player, so an overlap at two heights makes the lower one unstandable.
    for (const segment of EXTRA_SEGMENTS)
      for (let i = 0; i < segment.pieces.length; i += 1)
        for (let j = i + 1; j < segment.pieces.length; j += 1) {
          const a = segment.pieces[i]!;
          const b = segment.pieces[j]!;
          const overlapX =
            Math.min(a.center[0] + a.size[0] / 2, b.center[0] + b.size[0] / 2) -
            Math.max(a.center[0] - a.size[0] / 2, b.center[0] - b.size[0] / 2);
          const overlapZ =
            Math.min(a.center[2] + a.size[2] / 2, b.center[2] + b.size[2] / 2) -
            Math.max(a.center[2] - a.size[2] / 2, b.center[2] - b.size[2] / 2);
          const topA = a.center[1] + a.size[1] / 2;
          const topB = b.center[1] + b.size[1] / 2;
          if (overlapX > 1e-9 && overlapZ > 1e-9)
            expect(topA, `${segment.id}: ${a.id} overlaps ${b.id} at different heights`).toBeCloseTo(topB, 6);
        }
  });

  it("has unique ids across the merged set", () => {
    // EXTRA_SEGMENTS is now merged into TRACK_SEGMENTS rather than sitting
    // beside it, so the catalogue itself is what must be collision-free.
    const ids = TRACK_SEGMENTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const extra of EXTRA_SEGMENTS)
      expect(ids, `${extra.id} missing from the catalogue`).toContain(extra.id);
    for (const segment of EXTRA_SEGMENTS) {
      expect(segment.id.length).toBeGreaterThanOrEqual(2);
      expect(segment.id.length).toBeLessThanOrEqual(24);
      const pieceIds = segment.pieces.map((p) => p.id);
      const zoneIds = segment.zones.map((z) => z.id);
      expect(new Set(pieceIds).size).toBe(pieceIds.length);
      expect(new Set(zoneIds).size).toBe(zoneIds.length);
    }
  });
});
