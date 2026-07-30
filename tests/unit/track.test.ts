import { describe, expect, it } from "vitest";
import { LEVEL_PIECES, PLACEMENT_ZONES } from "@/lib/game/level-definition";
import {
  CLASSIC_TRACK,
  DEFAULT_CUSTOM_TRACK,
  EDITABLE_SEGMENTS,
  JUMP_DISTANCE,
  JUMP_HEIGHT,
  JUMP_MARGIN,
  SEGMENT_MAP,
  TRACK_SEGMENTS,
  buildTrack,
  isPlayableTrack,
  trackFacingYaw,
  worstTraverse,
} from "@/lib/game/track";
import type { TrackSegment } from "@/lib/game/track";

// The jump budget lives in track.ts because isPlayableTrack enforces it on
// incoming shared links. Importing it here rather than restating it is what
// stops the runtime rule and the test from drifting apart.
const SAFETY = JUMP_MARGIN;

/**
 * Two pads with a controllable void between them. `farZ` is the centre of the
 * second pad and `farTop` its surface height, so the pair spans a gap of
 * farZ - 3 at a step of farTop. Everything else is held constant, which is what
 * lets one composition differ from another in exactly one measurement.
 */
function twoPads(id: string, farZ: number, farTop: number): TrackSegment {
  return {
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
  };
}

/** Make a segment composable for one assertion, then take it away again. */
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

describe("track composition", () => {
  it("faces every spawn toward its own end gate", () => {
    expect(trackFacingYaw({ spawn: [0, 1, 0], exit: [0, 1, 10] })).toBeCloseTo(0);
    expect(trackFacingYaw({ spawn: [0, 1, 0], exit: [10, 1, 0] })).toBeCloseTo(Math.PI / 2);
    expect(Math.abs(trackFacingYaw({ spawn: [0, 1, 0], exit: [0, 1, -10] }))).toBeCloseTo(Math.PI);
    expect(trackFacingYaw({ spawn: [4, 1, 4], exit: [4, 2, 4] })).toBe(0);
  });

  it("rebuilds the original course byte-identically", () => {
    const built = buildTrack(CLASSIC_TRACK);
    expect(built.pieces).toEqual(LEVEL_PIECES);
    expect(built.zones).toEqual(PLACEMENT_ZONES);
  });

  it("gives every piece and zone a unique id even when a segment repeats", () => {
    const built = buildTrack(["start", "runway", "runway", "bridge", "finish"]);
    const pieceIds = built.pieces.map((piece) => piece.id);
    const zoneIds = built.zones.map((zone) => zone.id);
    expect(new Set(pieceIds).size).toBe(pieceIds.length);
    expect(new Set(zoneIds).size).toBe(zoneIds.length);
  });

  it("lays segments end to end with the exit on the final platform", () => {
    const built = buildTrack(DEFAULT_CUSTOM_TRACK);
    const totalLength = DEFAULT_CUSTOM_TRACK.reduce(
      (sum, id) =>
        sum + (TRACK_SEGMENTS.find((entry) => entry.id === id)?.length ?? 0),
      0,
    );
    expect(built.length).toBeCloseTo(totalLength, 6);
    const far = Math.max(
      ...built.pieces.map((piece) => piece.center[2] + piece.size[2] / 2),
    );
    expect(built.exit[2]).toBeLessThanOrEqual(far);
    expect(built.exit[2]).toBeGreaterThan(far - 2);
  });

  it("keeps every gap inside a single jump", () => {
    // A track nobody can finish is worse than a hard one. Measuring only along
    // Z understates a diagonal hop, so this compares the real edge-to-edge
    // clearance between platform footprints, and only requires that ONE
    // reachable predecessor exists since the player needs a single route.
    for (const segment of TRACK_SEGMENTS) {
      if (segment.id === "classic") continue;
      const worst = worstTraverse(buildTrack(["start", segment.id, "finish"]));
      expect(
        worst.gap,
        `${segment.id}: easiest jump is ${worst.gap.toFixed(2)}u, budget ${(JUMP_DISTANCE * SAFETY).toFixed(2)}u`,
      ).toBeLessThan(JUMP_DISTANCE * SAFETY);
      expect(
        worst.rise,
        `${segment.id}: needs a ${worst.rise.toFixed(2)}u step up, budget ${(JUMP_HEIGHT * SAFETY).toFixed(2)}u`,
      ).toBeLessThan(JUMP_HEIGHT * SAFETY);
    }
  });

  it("keeps every seam between two middle segments jumpable", () => {
    // Players compose segments, so the joins matter as much as the segments.
    // Checking only [start, X, finish] would never exercise a seam.
    const middles = EDITABLE_SEGMENTS.map((segment) => segment.id);
    for (const first of middles)
      for (const second of middles) {
        const worst = worstTraverse(
          buildTrack(["start", first, second, "finish"]),
        );
        expect(
          worst.gap,
          `${first} -> ${second}: easiest jump is ${worst.gap.toFixed(2)}u`,
        ).toBeLessThan(JUMP_DISTANCE * SAFETY);
      }
  });

  it("declares a length that matches the geometry it contains", () => {
    // buildTrack advances its cursor by `length`. A segment whose pieces
    // overrun that value bleeds into the next one and z-fights; one that
    // under-runs opens a seam nobody authored.
    for (const segment of TRACK_SEGMENTS) {
      if (segment.id === "classic" || segment.pieces.length === 0) continue;
      const far = Math.max(
        ...segment.pieces.map((p) => p.center[2] + p.size[2] / 2),
      );
      const near = Math.min(
        ...segment.pieces.map((p) => p.center[2] - p.size[2] / 2),
      );
      expect(near, `${segment.id} starts before its own origin`).toBeGreaterThanOrEqual(-0.001);
      expect(
        far,
        `${segment.id} geometry reaches ${far} but declares length ${segment.length}`,
      ).toBeCloseTo(segment.length, 3);
    }
  });

  it("only offers middle segments in the editor", () => {
    const ids = EDITABLE_SEGMENTS.map((segment) => segment.id);
    expect(ids).not.toContain("classic");
    expect(ids).not.toContain("start");
    expect(ids).not.toContain("finish");
    expect(ids.length).toBeGreaterThan(4);
  });

  it("requires a start and a finish, and rejects nonsense", () => {
    expect(isPlayableTrack(CLASSIC_TRACK)).toBe(true);
    expect(isPlayableTrack(DEFAULT_CUSTOM_TRACK)).toBe(true);
    expect(isPlayableTrack([])).toBe(false);
    expect(isPlayableTrack(["runway", "finish"])).toBe(false);
    expect(isPlayableTrack(["start", "runway"])).toBe(false);
    expect(isPlayableTrack(["start", "nope", "finish"])).toBe(false);
    expect(isPlayableTrack(["classic", "runway"])).toBe(false);
    expect(isPlayableTrack(new Array(40).fill("runway"))).toBe(false);
    // Connects perfectly, but the runner steps off the pad into the door.
    expect(isPlayableTrack(["start", "finish"])).toBe(false);
  });

  it("refuses a composition the player could not physically cross", () => {
    // The published budget is what isPlayableTrack enforces, so a track whose
    // hardest jump exceeds it must be rejected rather than shared.
    for (const ids of [DEFAULT_CUSTOM_TRACK, ["start", "gap", "finish"]]) {
      const worst = worstTraverse(buildTrack(ids));
      expect(worst.gap).toBeLessThan(JUMP_DISTANCE * JUMP_MARGIN);
      expect(isPlayableTrack(ids)).toBe(true);
    }
    // Every shipped segment must survive the runtime rule, not just the test.
    // A segment that displaces the lane cannot stand between the pad and the
    // door on its own - the door is fixed to the centre line at the datum, so a
    // turn has to be answered and a climb needs a way down - so the search is
    // for any course that holds it rather than for one particular course.
    const middles = EDITABLE_SEGMENTS.map((entry) => entry.id);
    for (const segment of EDITABLE_SEGMENTS) {
      const partners = middles.filter((id) => id !== segment.id);
      const candidates: readonly (readonly string[])[] = [
        ["start", segment.id, "finish"],
        ...partners.map((partner) => ["start", segment.id, partner, "finish"]),
        ...partners.map((partner) => ["start", partner, segment.id, "finish"]),
      ];
      expect(
        candidates.some((candidate) => isPlayableTrack(candidate)),
        `${segment.id} is rejected by its own playability rule in every course`,
      ).toBe(true);
    }
  });

  it("refuses a composition solely because it blows the jump budget", () => {
    // Every shipped segment and every seam between two of them clears the
    // budget by design, which the two tests above enforce. That leaves the last
    // gate in isPlayableTrack with nothing in the catalogue able to trip it, so
    // it is reached here with a registered segment. Each composition below is
    // the same three-slot shape and differs from the control in one number, so
    // a rejection can only come from the measurement that number changed.
    const compose = (segment: TrackSegment) => ["start", segment.id, "finish"];

    const control = twoPads("test_control", 4, 0);
    withSegment(control, () => {
      const worst = worstTraverse(buildTrack(compose(control)));
      expect(worst.gap).toBeLessThan(JUMP_DISTANCE * SAFETY);
      expect(worst.rise).toBeLessThan(JUMP_HEIGHT * SAFETY);
      // Accepting the control is what proves the gates before the budget are
      // satisfied by this shape: known ids, start and finish in place, three
      // slots, and a course well inside the attempt-limit length cap.
      expect(isPlayableTrack(compose(control))).toBe(true);
    });

    const chasm = twoPads("test_chasm", 11, 0);
    withSegment(chasm, () => {
      const worst = worstTraverse(buildTrack(compose(chasm)));
      expect(worst.gap).toBeGreaterThan(JUMP_DISTANCE * SAFETY);
      expect(worst.rise).toBeLessThan(JUMP_HEIGHT * SAFETY);
      expect(
        isPlayableTrack(compose(chasm)),
        `an ${worst.gap.toFixed(2)}u void against a ${(JUMP_DISTANCE * SAFETY).toFixed(2)}u budget was accepted`,
      ).toBe(false);
    });

    // The budget is two measurements joined by an and, so a wall the runner
    // cannot climb has to be refused even where the gap is a stride.
    const wall = twoPads("test_wall", 4, 2.1);
    withSegment(wall, () => {
      const worst = worstTraverse(buildTrack(compose(wall)));
      expect(worst.gap).toBeLessThan(JUMP_DISTANCE * SAFETY);
      expect(worst.rise).toBeGreaterThan(JUMP_HEIGHT * SAFETY);
      expect(
        isPlayableTrack(compose(wall)),
        `a ${worst.rise.toFixed(2)}u step against a ${(JUMP_HEIGHT * SAFETY).toFixed(2)}u budget was accepted`,
      ).toBe(false);
    });
  });

  it("publishes a jump budget that accounts for damping", () => {
    // Guards the correction itself: the undamped closed form gives 5.529 and
    // 2.169 against the damped 5.100 and 1.948, and would certify courses that
    // cannot actually be finished. Both bands sit inside 3% of the true value,
    // which is comfortably narrower than the 8.4% and 11.4% the undamped form
    // overstates by, so neither can slip through.
    expect(JUMP_DISTANCE).toBeGreaterThan(5);
    expect(JUMP_DISTANCE).toBeLessThan(5.2);
    expect(JUMP_HEIGHT).toBeGreaterThan(1.9);
    expect(JUMP_HEIGHT).toBeLessThan(2);
  });
});
