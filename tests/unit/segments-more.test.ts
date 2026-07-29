import { describe, expect, it } from "vitest";
import { MORE_SEGMENTS } from "@/lib/game/segments-more";
import {
  EDITABLE_SEGMENTS,
  JUMP_DISTANCE,
  JUMP_HEIGHT,
  JUMP_MARGIN,
  SEGMENT_MAP,
  TRACK_SEGMENTS,
  buildTrack,
  isPlayableTrack,
  worstTraverse,
} from "@/lib/game/track";
import { PLAYER } from "@/lib/game/constants";
import type { BuiltTrack, TrackSegment } from "@/lib/game/track";

// MORE_SEGMENTS is registered in TRACK_SEGMENTS, so everything below measures
// through the real buildTrack and the real worstTraverse rather than a local
// copy of them. A segment that passes here passes the same rule isPlayableTrack
// applies to an incoming shared link.
const GAP_BUDGET = JUMP_DISTANCE * JUMP_MARGIN;
const RISE_BUDGET = JUMP_HEIGHT * JUMP_MARGIN;

// The published budget scores distance and height independently, which flatters
// any hop that does both at once. This solves the damped trajectory for the
// horizontal reach still available once the runner is `rise` above take-off.
// Vertical follows the closed form track.ts uses; horizontal is held at
// moveSpeed because the controller re-applies up to acceleration * airControl
// every frame, which beats linearDamping at 7.2u/s.
const G = 9.81 * PLAYER.gravityScale;
const D = PLAYER.linearDamping;
const APEX_TIME = Math.log(1 + (D * PLAYER.jumpVelocity) / G) / D;

function height(t: number): number {
  return (PLAYER.jumpVelocity / D + G / D ** 2) * (1 - Math.exp(-D * t)) - (G / D) * t;
}

function reachAtRise(rise: number): number {
  if (rise <= 0) return PLAYER.moveSpeed * APEX_TIME * 2;
  if (rise >= JUMP_HEIGHT) return -1;
  let lo = APEX_TIME;
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

/** The hop with the least room to spare once distance and height are coupled. */
function tightestHop(segmentIds: readonly string[]): {
  gap: number;
  rise: number;
  reach: number;
  slack: number;
} {
  let tightest = { gap: 0, rise: 0, reach: Infinity, slack: Infinity };
  for (const hop of hops(buildTrack(segmentIds))) {
    const reach = reachAtRise(hop.rise);
    const slack = reach < 0 ? -Infinity : reach - hop.gap;
    if (slack < tightest.slack) tightest = { ...hop, reach, slack };
  }
  return tightest;
}

/** Make a synthetic segment composable for one assertion, then take it away. */
function withSegment(segment: TrackSegment, run: () => void): void {
  if (SEGMENT_MAP.has(segment.id))
    throw new Error(`${segment.id} collides with a real segment`);
  SEGMENT_MAP.set(segment.id, segment);
  try {
    run();
  } finally {
    SEGMENT_MAP.delete(segment.id);
  }
}

const MINE = MORE_SEGMENTS.map((segment) => segment.id);
const MIDDLES = EDITABLE_SEGMENTS.map((segment) => segment.id);
/** The narrowest plank in the shipped set, and the floor this batch works to. */
const BEAM_WIDTH = 1.2;

describe("more track segments", () => {
  it("is registered in the catalogue with ids nothing else uses", () => {
    const ids = TRACK_SEGMENTS.map((segment) => segment.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of MINE) {
      expect(ids, `${id} missing from TRACK_SEGMENTS`).toContain(id);
      // challenge-link.ts encodes a segment id as a 2..24 character string.
      expect(id.length).toBeGreaterThanOrEqual(2);
      expect(id.length).toBeLessThanOrEqual(24);
    }
    for (const segment of MORE_SEGMENTS) {
      const pieceIds = segment.pieces.map((p) => p.id);
      const zoneIds = segment.zones.map((z) => z.id);
      expect(new Set(pieceIds).size).toBe(pieceIds.length);
      expect(new Set(zoneIds).size).toBe(zoneIds.length);
      // difficulty.ts keys the risk multiplier on the authored zone id and
      // strips a trailing _<digits> as buildTrack's slot suffix, so an authored
      // id may not end in one.
      expect(zoneIds.filter((id) => /_\d+$/.test(id))).toEqual([]);
    }
  });

  it("spans exactly [0, length] so buildTrack can butt it against a neighbour", () => {
    for (const segment of MORE_SEGMENTS) {
      const far = Math.max(...segment.pieces.map((p) => p.center[2] + p.size[2] / 2));
      const near = Math.min(...segment.pieces.map((p) => p.center[2] - p.size[2] / 2));
      expect(far, `${segment.id} reaches ${far} but declares ${segment.length}`).toBeCloseTo(
        segment.length,
        3,
      );
      expect(near, `${segment.id} starts before its own origin`).toBeGreaterThanOrEqual(-0.001);
    }
  });

  it("clears the decoupled budget on its own", () => {
    for (const segment of MORE_SEGMENTS) {
      const worst = worstTraverse(buildTrack(["start", segment.id, "finish"]));
      expect(
        worst.gap,
        `${segment.id}: hardest carry ${worst.gap.toFixed(3)}u against ${GAP_BUDGET.toFixed(3)}u`,
      ).toBeLessThan(GAP_BUDGET);
      expect(
        worst.rise,
        `${segment.id}: hardest step ${worst.rise.toFixed(3)}u against ${RISE_BUDGET.toFixed(3)}u`,
      ).toBeLessThan(RISE_BUDGET);
      expect(
        isPlayableTrack(["start", segment.id, "finish"]),
        `${segment.id} is refused by the runtime rule it has to pass`,
      ).toBe(true);
    }
  });

  it("clears the coupled arc, not just the decoupled budget", () => {
    for (const segment of MORE_SEGMENTS) {
      const tightest = tightestHop(["start", segment.id, "finish"]);
      expect(
        tightest.slack,
        `${segment.id}: a ${tightest.gap.toFixed(2)}u hop rising ${tightest.rise.toFixed(2)}u ` +
          `has ${tightest.reach.toFixed(2)}u of reach`,
      ).toBeGreaterThan(0);
    }
  });

  it("keeps every seam with every other middle segment jumpable, both ways round", () => {
    // A segment is only as good as the joins a composer can make with it, so
    // every ordered pair is built rather than only the segment on its own.
    // Pairs are enough: worstTraverse scores a piece against its easiest
    // predecessor anywhere on the course, and the easiest predecessor of an
    // entry piece is always in the segment immediately before it.
    for (const mine of MINE)
      for (const other of MIDDLES)
        for (const ids of [
          ["start", mine, other, "finish"],
          ["start", other, mine, "finish"],
        ]) {
          const worst = worstTraverse(buildTrack(ids));
          const tightest = tightestHop(ids);
          const seam = ids.slice(1, 3).join(" -> ");
          expect(worst.gap, `${seam}: ${worst.gap.toFixed(3)}u carry`).toBeLessThan(GAP_BUDGET);
          expect(worst.rise, `${seam}: ${worst.rise.toFixed(3)}u step`).toBeLessThan(RISE_BUDGET);
          expect(
            tightest.slack,
            `${seam}: a ${tightest.gap.toFixed(2)}u hop rising ${tightest.rise.toFixed(2)}u ` +
              `is beyond a ${tightest.reach.toFixed(2)}u arc`,
          ).toBeGreaterThan(0);
        }
  });

  it("composes all nine into one course that is still playable", () => {
    const ids = ["start", ...MINE, "finish"];
    expect(isPlayableTrack(ids), `${ids.length} slots, ${buildTrack(ids).length}u`).toBe(true);
  });

  it("authors no deck narrower than the beam", () => {
    // The runner's on-screen silhouette is 0.91u across and the beam's 1.2u
    // plank already leaves only about 0.94u of visible deck. Anything thinner
    // is a platform the player cannot see their own feet on, which is not
    // difficulty; difficulty here comes from gaps, height and timing instead.
    for (const segment of MORE_SEGMENTS)
      for (const p of segment.pieces)
        expect(
          p.size[0],
          `${segment.id}/${p.id} is ${p.size[0]}u wide against a ${BEAM_WIDTH}u floor`,
        ).toBeGreaterThanOrEqual(BEAM_WIDTH);
  });

  it("keeps every zone on a piece the runner can stand on", () => {
    for (const segment of MORE_SEGMENTS)
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
        expect(z.allowedTypes.length, `${segment.id}/${z.id} allows nothing`).toBeGreaterThan(0);
        expect(z.maxOccupants, `${segment.id}/${z.id} holds nothing`).toBeGreaterThan(0);
        // The widest placementRadius in the roster is the ceiling fan's 1.4 and
        // validatePlacement demands half of it clear on each side, so a zone
        // under 1.4u in either axis silently accepts nothing large. That is
        // allowed, but it must not be an accident: no zone here is that small.
        expect(z.maxX - z.minX, `${segment.id}/${z.id} width`).toBeGreaterThanOrEqual(1.4);
        expect(z.maxZ - z.minZ, `${segment.id}/${z.id} depth`).toBeGreaterThanOrEqual(1.2);
      }
  });

  it("keeps no two pieces overlapping in XZ at different heights", () => {
    // Ground detection takes the highest piece whose XZ footprint contains the
    // player, so an overlap at two heights makes the lower one unstandable.
    for (const segment of MORE_SEGMENTS)
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
          if (overlapX > 1e-9 && overlapZ > 1e-9)
            expect(
              a.center[1] + a.size[1] / 2,
              `${segment.id}: ${a.id} overlaps ${b.id} at different heights`,
            ).toBeCloseTo(b.center[1] + b.size[1] / 2, 6);
        }
  });

  it("fails an over-budget segment rather than certifying it", () => {
    // The checks above only mean something if they can reject something. These
    // two synthetic segments are the shape of the mistake this file exists to
    // catch: one void too long to carry, and one hop that fits the decoupled
    // budget on both axes yet leaves the arc short once they are combined.
    const pads = (id: string, farZ: number, farTop: number): TrackSegment => ({
      id,
      label: "Synthetic pads",
      description: "Two pads and a measured void.",
      length: farZ + 1,
      difficulty: 3,
      pieces: [
        { id: "near", center: [0, -0.5, 1], size: [4, 1, 2], color: "#ff5c65" },
        { id: "far", center: [0, farTop - 0.5, farZ], size: [4, 1, 2], color: "#ff5c65" },
      ],
      zones: [],
    });

    const chasm = pads("more_test_chasm", 8.4, 0);
    withSegment(chasm, () => {
      const ids = ["start", chasm.id, "finish"];
      expect(worstTraverse(buildTrack(ids)).gap).toBeGreaterThan(GAP_BUDGET);
      expect(tightestHop(ids).slack).toBeLessThan(0);
      expect(isPlayableTrack(ids)).toBe(false);
    });

    // 4.3u out and 1.6u up: both inside the published budget on their own,
    // and beyond the arc together, which is the failure the decoupled check
    // cannot see and the coupled one exists for.
    const overreach = pads("more_test_overreach", 7.3, 1.6);
    withSegment(overreach, () => {
      const ids = ["start", overreach.id, "finish"];
      const worst = worstTraverse(buildTrack(ids));
      expect(worst.gap).toBeLessThan(GAP_BUDGET);
      expect(worst.rise).toBeLessThan(RISE_BUDGET);
      expect(tightestHop(ids).slack).toBeLessThan(0);
    });
  });
});
