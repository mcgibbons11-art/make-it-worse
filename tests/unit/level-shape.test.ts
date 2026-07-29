import { describe, expect, it } from "vitest";
import { PLAYER } from "@/lib/game/constants";
import { LEVEL_PIECES, PLACEMENT_ZONES } from "@/lib/game/level-definition";
import { SHAPE_SEGMENTS } from "@/lib/game/segments-shapes";
import {
  DEFAULT_CUSTOM_TRACK,
  EDITABLE_SEGMENTS,
  JUMP_DISTANCE,
  JUMP_HEIGHT,
  JUMP_MARGIN,
  LANE_X_LIMIT,
  LANE_Y_LIMIT,
  SEGMENT_MAP,
  TRACK_SEGMENTS,
  buildTrack,
  composeFreshTrack,
  isPlayableTrack,
  laneAfter,
  laneIsHome,
  reachAtRise,
  segmentExit,
  worstTraverse,
} from "@/lib/game/track";
import type { TrackSegment } from "@/lib/game/track";

// Everything here measures through the real buildTrack and the real
// worstTraverse. A shape that passes here passes the same rule isPlayableTrack
// applies to an incoming shared link, because it is the same code.
const GAP_BUDGET = JUMP_DISTANCE * JUMP_MARGIN;
const RISE_BUDGET = JUMP_HEIGHT * JUMP_MARGIN;
/** The narrowest plank in the shipped set, and the floor this batch works to. */
const BEAM_WIDTH = 1.2;
const MINE = SHAPE_SEGMENTS.map((segment) => segment.id);
const MIDDLES = EDITABLE_SEGMENTS.map((segment) => segment.id);

type Footprint = {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  top: number;
  bottom: number;
};

function footprints(pieces: TrackSegment["pieces"]): Footprint[] {
  return pieces.map((p) => ({
    id: p.id,
    minX: p.center[0] - p.size[0] / 2,
    maxX: p.center[0] + p.size[0] / 2,
    minZ: p.center[2] - p.size[2] / 2,
    maxZ: p.center[2] + p.size[2] / 2,
    top: p.center[1] + p.size[1] / 2,
    bottom: p.center[1] - p.size[1] / 2,
  }));
}

/** The pieces forming a segment's entry face, and the ones forming its exit. */
function faces(segment: TrackSegment): { near: Footprint[]; far: Footprint[] } {
  const prints = footprints(segment.pieces);
  return {
    near: prints.filter((p) => Math.abs(p.minZ) < 1e-6),
    far: prints.filter((p) => Math.abs(p.maxZ - segment.length) < 1e-6),
  };
}

/** The centre and surface of a face, which is what a seam is measured between. */
function faceAt(prints: readonly Footprint[]): { x: number; top: number } {
  const minX = Math.min(...prints.map((p) => p.minX));
  const maxX = Math.max(...prints.map((p) => p.maxX));
  const top = Math.max(...prints.map((p) => p.top));
  return { x: (minX + maxX) / 2, top };
}

/**
 * A course this segment can legally appear in, or null if none exists.
 *
 * A segment that displaces the lane cannot stand between the start pad and the
 * finish room on its own: the finish door is fixed to the centre line at the
 * datum, so a turn needs answering and a climb needs a way back down. Rather
 * than hard-coding which segment pairs with which, this searches the catalogue
 * the way a composer would.
 */
function playableCourseWith(id: string): readonly string[] | null {
  const partners = MIDDLES.filter((other) => other !== id);
  const candidates: readonly string[][] = [
    ["start", id, "finish"],
    ...partners.map((partner) => ["start", id, partner, "finish"]),
    ...partners.map((partner) => ["start", partner, id, "finish"]),
    ...partners.flatMap((before) =>
      partners.map((after) => ["start", before, id, after, "finish"]),
    ),
  ];
  return candidates.find((candidate) => isPlayableTrack(candidate)) ?? null;
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

describe("level shape", () => {
  it("is registered in the catalogue with ids nothing else uses", () => {
    const ids = TRACK_SEGMENTS.map((segment) => segment.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of MINE) {
      expect(ids, `${id} missing from TRACK_SEGMENTS`).toContain(id);
      // challenge-link.ts encodes a segment id as a 2..24 character string.
      expect(id.length).toBeGreaterThanOrEqual(2);
      expect(id.length).toBeLessThanOrEqual(24);
    }
    for (const segment of SHAPE_SEGMENTS) {
      const pieceIds = segment.pieces.map((p) => p.id);
      const zoneIds = segment.zones.map((z) => z.id);
      expect(new Set(pieceIds).size).toBe(pieceIds.length);
      expect(new Set(zoneIds).size).toBe(zoneIds.length);
      // difficulty.ts strips a trailing _<digits> as buildTrack's slot suffix,
      // so an authored zone id may not end in one.
      expect(zoneIds.filter((id) => /_\d+$/.test(id))).toEqual([]);
    }
  });

  it("spans exactly [0, length] so buildTrack can butt it against a neighbour", () => {
    for (const segment of SHAPE_SEGMENTS) {
      const prints = footprints(segment.pieces);
      const far = Math.max(...prints.map((p) => p.maxZ));
      const near = Math.min(...prints.map((p) => p.minZ));
      expect(far, `${segment.id} reaches ${far} but declares ${segment.length}`).toBeCloseTo(
        segment.length,
        3,
      );
      expect(near, `${segment.id} starts before its own origin`).toBeGreaterThanOrEqual(-0.001);
    }
  });

  it("ends where it says it ends, which is what keeps a seam flush at any lane", () => {
    // The lane is bookkeeping: buildTrack draws a segment at the accumulated
    // exitOffset of everything before it. If a segment's declared exit is not
    // where its geometry actually finishes, every seam after it opens a hole
    // that no jump measurement would attribute to this segment.
    for (const segment of TRACK_SEGMENTS) {
      if (segment.id === "classic") continue;
      const exit = segmentExit(segment);
      const declares = exit[0] !== 0 || exit[1] !== 0;
      // A segment written before the lane existed keeps the old contract: it
      // moves the lane nowhere, and whatever its own faces do is absorbed as a
      // step or a drop exactly as it was. Only a declared exit is checked, plus
      // both faces of everything in this batch.
      if (!declares && !MINE.includes(segment.id)) continue;
      const { near, far } = faces(segment);
      expect(near.length, `${segment.id} has no piece on its entry face`).toBeGreaterThan(0);
      expect(far.length, `${segment.id} has no piece on its exit face`).toBeGreaterThan(0);
      const entry = faceAt(near);
      const leaving = faceAt(far);
      expect(entry.x, `${segment.id} enters off the centre line`).toBeCloseTo(0, 6);
      expect(entry.top, `${segment.id} enters off the datum`).toBeCloseTo(0, 6);
      expect(leaving.x, `${segment.id} declares exit x ${exit[0]}`).toBeCloseTo(exit[0], 6);
      expect(leaving.top, `${segment.id} declares exit y ${exit[1]}`).toBeCloseTo(exit[1], 6);
    }
  });

  it("draws a laned course with every seam flush, face to face", () => {
    // The payoff of the invariant above. Two shaped segments in a row put the
    // second one at the first one's exit, so the join is in exactly the place
    // it would be if neither had moved - which is why the jump budget needed no
    // special case for any of this.
    for (const first of MINE)
      for (const second of MINE) {
        const built = buildTrack(["start", first, second, "finish"]);
        const at = (slot: number, id: string) =>
          built.pieces.find((piece) => piece.id === `${id}_${slot}`)!;
        const leaving = faceAt(
          footprints(faces(SEGMENT_MAP.get(first)!).far.map((p) => at(1, p.id))),
        );
        const arriving = faceAt(
          footprints(faces(SEGMENT_MAP.get(second)!).near.map((p) => at(2, p.id))),
        );
        expect(arriving.x, `${first} -> ${second} joins off-centre`).toBeCloseTo(leaving.x, 6);
        expect(arriving.top, `${first} -> ${second} joins at the wrong height`).toBeCloseTo(
          leaving.top,
          6,
        );
      }
  });

  it("leaves a course built from pre-lane segments byte-identical", () => {
    // Every existing challenge stores its traps at absolute world positions, so
    // moving any authored geometry would detach them from their own zones. The
    // lane may only ever move a course that asked to be moved.
    const flat = TRACK_SEGMENTS.filter(
      (segment) => segment.id !== "classic" && segmentExit(segment).every((value) => value === 0),
    ).map((segment) => segment.id);
    const built = buildTrack(flat);
    let index = 0;
    for (const id of flat)
      for (const piece of SEGMENT_MAP.get(id)!.pieces) {
        const drawn = built.pieces[index]!;
        expect(drawn.center[0], `${id}/${piece.id} moved sideways`).toBe(piece.center[0]);
        expect(drawn.center[1], `${id}/${piece.id} moved vertically`).toBe(piece.center[1]);
        index += 1;
      }
    expect(index).toBe(built.pieces.length);
  });

  it("clears the jump budget on its own and against every other segment", () => {
    const compositions: readonly (readonly string[])[] = [
      ...MINE.map((id) => ["start", id, "finish"]),
      ...MINE.flatMap((mine) =>
        MIDDLES.flatMap((other) => [
          ["start", mine, other, "finish"],
          ["start", other, mine, "finish"],
        ]),
      ),
    ];
    for (const ids of compositions) {
      const worst = worstTraverse(buildTrack(ids));
      const name = ids.slice(1, -1).join(" -> ");
      expect(worst.gap, `${name}: ${worst.gap.toFixed(3)}u carry`).toBeLessThan(GAP_BUDGET);
      expect(worst.rise, `${name}: ${worst.rise.toFixed(3)}u step`).toBeLessThan(RISE_BUDGET);
      // Distance and height are budgeted separately, which flatters a hop that
      // asks for both. slack is the two taken together.
      expect(
        worst.slack,
        `${name}: ${worst.slack.toFixed(3)}u of arc to spare`,
      ).toBeGreaterThan(0);
    }
  });

  it("can appear in a course the game will actually accept", () => {
    for (const id of MINE) {
      const course = playableCourseWith(id);
      expect(course, `${id} fits into no playable composition`).not.toBeNull();
      expect(laneIsHome(laneAfter(course!.slice(0, -1)))).toBe(true);
    }
  });

  it("refuses a course that ends off the centre line or off the datum", () => {
    // PlayerController opens the exit on |x| < 1.15 and 0.1 <= y < 3.2 in world
    // coordinates rather than on the door's own position, so a course that
    // finishes two metres to the left is one the runner cannot leave. That is
    // the failure isPlayableTrack exists to catch before a player meets it.
    expect(laneAfter(["start", "veer_right"])).toEqual([2.2, 0]);
    expect(isPlayableTrack(["start", "veer_right", "finish"])).toBe(false);
    expect(isPlayableTrack(["start", "veer_right", "veer_left", "finish"])).toBe(true);
    expect(isPlayableTrack(["start", "upper_deck", "finish"])).toBe(false);
    expect(isPlayableTrack(["start", "upper_deck", "down_shaft", "finish"])).toBe(true);
    // Down before up leaves the course below the room it is drawn in.
    expect(isPlayableTrack(["start", "down_shaft", "upper_deck", "finish"])).toBe(false);
    // Two turns the same way walk out of the room the course is drawn in.
    expect(
      isPlayableTrack([
        "start",
        "veer_right",
        "veer_right",
        "veer_left",
        "veer_left",
        "finish",
      ]),
    ).toBe(false);
  });

  it("keeps a laned course inside the envelope it declares", () => {
    for (const segment of SHAPE_SEGMENTS) {
      const exit = segmentExit(segment);
      expect(Math.abs(exit[0]), `${segment.id} displaces past the lane limit`).toBeLessThanOrEqual(
        LANE_X_LIMIT,
      );
      expect(Math.abs(exit[1]), `${segment.id} climbs past the lane limit`).toBeLessThanOrEqual(
        LANE_Y_LIMIT,
      );
    }
  });

  it("authors no deck narrower than the beam", () => {
    // The runner's on-screen silhouette is 0.91u across and the beam's 1.2u
    // plank already leaves only about 0.94u of visible deck. Anything thinner
    // is a platform the player cannot see their own feet on, which is not
    // difficulty; difficulty here comes from gaps, height, routing and choice.
    for (const segment of SHAPE_SEGMENTS)
      for (const p of segment.pieces) {
        expect(
          p.size[0],
          `${segment.id}/${p.id} is ${p.size[0]}u wide against a ${BEAM_WIDTH}u floor`,
        ).toBeGreaterThanOrEqual(BEAM_WIDTH);
        expect(p.size[2], `${segment.id}/${p.id} is ${p.size[2]}u deep`).toBeGreaterThanOrEqual(
          BEAM_WIDTH,
        );
      }
  });

  it("never hangs one piece over another", () => {
    // PlayerController grounds the runner on the highest piece whose footprint
    // contains them, so a walkway with air under it makes the floor beneath it
    // unstandable. A plinth resting on the floor is fine and is how the hall
    // gets something to climb; an overpass is not.
    for (const segment of SHAPE_SEGMENTS) {
      const prints = footprints(segment.pieces);
      for (let i = 0; i < prints.length; i += 1)
        for (let j = i + 1; j < prints.length; j += 1) {
          const a = prints[i]!;
          const b = prints[j]!;
          const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
          const overlapZ = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
          if (overlapX <= 1e-9 || overlapZ <= 1e-9) continue;
          const [lower, upper] = a.top <= b.top ? [a, b] : [b, a];
          expect(
            upper.bottom,
            `${segment.id}: ${upper.id} floats over ${lower.id} with air beneath it`,
          ).toBeLessThanOrEqual(lower.top + 1e-9);
        }
    }
  });

  it("keeps every zone on the surface the runner would actually be standing on", () => {
    for (const segment of SHAPE_SEGMENTS) {
      const prints = footprints(segment.pieces);
      for (const z of segment.zones) {
        // The highest piece, not the first: ground detection takes the highest,
        // so a zone on the hall's plinth belongs to the plinth even though the
        // floor's footprint contains it too.
        const hosts = prints
          .filter(
            (p) =>
              z.minX >= p.minX - 1e-9 &&
              z.maxX <= p.maxX + 1e-9 &&
              z.minZ >= p.minZ - 1e-9 &&
              z.maxZ <= p.maxZ + 1e-9,
          )
          .sort((a, b) => b.top - a.top);
        const host = hosts[0];
        expect(host, `${segment.id}/${z.id} sits on no single piece`).toBeDefined();
        expect(
          z.groundY - host!.top,
          `${segment.id}/${z.id} groundY vs ${host!.id} top ${host!.top}`,
        ).toBeCloseTo(0.05, 6);
        expect(z.allowedTypes.length, `${segment.id}/${z.id} allows nothing`).toBeGreaterThan(0);
        expect(z.maxOccupants, `${segment.id}/${z.id} holds nothing`).toBeGreaterThan(0);
        // The widest placementRadius in the roster is the ceiling fan's 1.4 and
        // validatePlacement demands half of it clear on each side, so a zone
        // under 1.4u in either axis silently accepts nothing large.
        expect(z.maxX - z.minX, `${segment.id}/${z.id} width`).toBeGreaterThanOrEqual(1.4);
        expect(z.maxZ - z.minZ, `${segment.id}/${z.id} depth`).toBeGreaterThanOrEqual(1.2);
      }
    }
  });

  it("moves a zone with the lane it is drawn at", () => {
    // A zone carries the ground height a trap is placed at and the box a trap
    // is placed inside. Both are authored in segment-local coordinates, so a
    // segment drawn one storey up whose zones stayed at the datum would put
    // every trap on it in mid-air below the floor.
    const built = buildTrack(["start", "upper_deck", "down_shaft", "finish"]);
    const raised = built.zones.filter((entry) => entry.id.startsWith("stones_shaft"));
    expect(raised.length).toBe(2);
    for (const entry of raised) {
      const authored = SEGMENT_MAP.get("down_shaft")!.zones.find((z) =>
        entry.id.startsWith(z.id),
      )!;
      expect(entry.groundY).toBeCloseTo(authored.groundY + 1.6, 6);
    }
    const turned = buildTrack(["start", "veer_right", "veer_left", "finish"]);
    const afterTurn = turned.zones.find((entry) => entry.id.startsWith("runway_veer_l_in"))!;
    const authoredTurn = SEGMENT_MAP.get("veer_left")!.zones.find(
      (z) => z.id === "runway_veer_l_in",
    )!;
    expect(afterTurn.minX).toBeCloseTo(authoredTurn.minX + 2.2, 6);
    expect(afterTurn.maxX).toBeCloseTo(authoredTurn.maxX + 2.2, 6);
  });

  it("composes fresh courses that bend and still come home", () => {
    let shaped = 0;
    let fellBack = 0;
    for (let seed = 1; seed <= 200; seed += 1) {
      const track = composeFreshTrack(seed);
      expect(isPlayableTrack(track), `seed ${seed}: ${track.join(",")}`).toBe(true);
      expect(laneIsHome(laneAfter(track.slice(0, -1))), `seed ${seed} ends off-centre`).toBe(true);
      if (track.some((id) => MINE.includes(id))) shaped += 1;
      if (track.join(",") === DEFAULT_CUSTOM_TRACK.join(",")) fellBack += 1;
      // The same room twice in a row is the boredom this work exists to fix,
      // and it is cheap to leave in by accident.
      for (let slot = 1; slot < track.length; slot += 1)
        expect(track[slot], `seed ${seed} repeats ${track[slot]} at ${slot}`).not.toBe(
          track[slot - 1],
        );
    }
    // Nothing may reach the fallback. It exists so a player is never handed a
    // course the gate refuses, and a composer that leans on it is a composer
    // quietly shipping the same eight segments to everybody.
    expect(fellBack, `${fellBack}/200 fresh courses fell back to the default`).toBe(0);
    // The point of the exercise: a fresh course is a shape rather than a line.
    // The floor is deliberately well under the rate this batch achieves, since
    // it falls as the catalogue grows and this is not the place to pin that.
    expect(shaped, `${shaped}/200 fresh courses use a shaped segment`).toBeGreaterThan(60);
  });

  it("refuses an over-budget composition rather than certifying it", () => {
    // The checks above only mean something if they can reject something. Both
    // synthetic segments below are the shape of the mistake this file exists to
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

    const chasm = pads("shape_test_chasm", GAP_BUDGET + 3.4, 0);
    withSegment(chasm, () => {
      const ids = ["start", chasm.id, "finish"];
      const worst = worstTraverse(buildTrack(ids));
      expect(worst.gap).toBeGreaterThan(GAP_BUDGET);
      expect(worst.slack).toBeLessThan(0);
      expect(isPlayableTrack(ids)).toBe(false);
    });

    // Inside the published budget on both axes and beyond the arc together,
    // which is the failure the decoupled check cannot see.
    const rise = RISE_BUDGET * 0.95;
    const overreach = pads("shape_test_overreach", reachAtRise(rise) * 0.99 + 3, rise);
    withSegment(overreach, () => {
      const ids = ["start", overreach.id, "finish"];
      const worst = worstTraverse(buildTrack(ids));
      expect(worst.gap).toBeLessThan(GAP_BUDGET);
      expect(worst.rise).toBeLessThan(RISE_BUDGET);
      expect(worst.slack).toBeLessThan(0);
      expect(isPlayableTrack(ids)).toBe(false);
    });
  });

  it("leaves the classic course no riser a runner can walk into", () => {
    // The runner is a dynamic Rapier capsule with no character controller, so
    // nothing lifts them over a ledge. A piece that overlaps its predecessor's
    // footprint while standing above it is therefore a wall the runner meets
    // with no gap in front of it to read as a jump. The classic course had one
    // 0.35u riser where the runway ran under stone-b, four units from spawn,
    // and holding W from the start stopped dead against it.
    //
    // A riser is only a blocker when there is no way round it. The Grand Hall's
    // plinth stands 0.8u off a floor that surrounds it by 2u on both sides and
    // is optional by design, so the test asks whether the step spans the ground
    // it stands on rather than merely whether it exists.
    const prints = footprints(LEVEL_PIECES).sort((a, b) => a.minZ - b.minZ);
    for (let index = 1; index < prints.length; index += 1) {
      const to = prints[index]!;
      for (let from = 0; from < index; from += 1) {
        const source = prints[from]!;
        const overlapZ = Math.min(source.maxZ, to.maxZ) - Math.max(source.minZ, to.minZ);
        if (overlapZ <= 0 || to.top - source.top <= 0.06) continue;
        // Room left on the wider flank of the step, on the piece being walked
        // along. A runner only needs one way past.
        const room = Math.max(to.minX - source.minX, source.maxX - to.maxX);
        expect(
          room,
          `${source.id} -> ${to.id} steps up ${(to.top - source.top).toFixed(2)}u with ${overlapZ.toFixed(2)}u of overlap and no way around it`,
        ).toBeGreaterThan(PLAYER.capsuleRadius * 2);
      }
    }
  });

  it("makes the classic course ask for jumps rather than a held key", () => {
    // Twelve pieces overlapping continuously from z 0 to 41 is a corridor, not
    // a course: the widest gap anywhere on it was 0.30u, which is less than the
    // runner's own capsule, so the whole level ran with W held down.
    const track = buildTrack(["classic"]);
    const prints = footprints(LEVEL_PIECES).sort((a, b) => a.minZ - b.minZ);
    let jumps = 0;
    for (let index = 1; index < prints.length; index += 1) {
      const to = prints[index]!;
      let easiest = Infinity;
      for (let from = 0; from < index; from += 1) {
        const source = prints[from]!;
        easiest = Math.min(
          easiest,
          Math.hypot(
            Math.max(0, source.minX - to.maxX, to.minX - source.maxX),
            Math.max(0, source.minZ - to.maxZ, to.minZ - source.maxZ),
          ),
        );
      }
      if (easiest > PLAYER.capsuleRadius * 2) jumps += 1;
    }
    expect(jumps).toBeGreaterThanOrEqual(5);
    // And it still has to be a course anyone can finish.
    expect(isPlayableTrack(["classic"])).toBe(true);
    const worst = worstTraverse(track);
    expect(worst.gap).toBeLessThan(GAP_BUDGET);
    expect(worst.rise).toBeLessThan(RISE_BUDGET);
    expect(worst.slack).toBeGreaterThan(0);
  });

  it("keeps every classic zone standing on the piece it is named for", () => {
    // The geometry moved to open those gaps and the zones had to move with it.
    // A zone hanging off its piece places traps in mid-air.
    const prints = footprints(LEVEL_PIECES);
    for (const zone of PLACEMENT_ZONES) {
      const carrying = prints.some(
        (p) =>
          zone.minX >= p.minX - 1e-6 &&
          zone.maxX <= p.maxX + 1e-6 &&
          zone.minZ >= p.minZ - 1e-6 &&
          zone.maxZ <= p.maxZ + 1e-6,
      );
      expect(carrying, `zone ${zone.id} is not fully on any piece`).toBe(true);
    }
  });

  it("spreads fresh compositions across the catalogue", () => {
    // The ramp used to be a ceiling, which left the three difficulty-0 segments
    // eligible for every slot in the course. There are only three of them
    // against fifteen rated 2, so grand_hall landed in 999 compositions out of
    // 1000 and two of the same three rooms opened every single course.
    const samples = 400;
    const uses = new Map<string, number>();
    let repeats = 0;
    for (let seed = 1; seed <= samples; seed += 1) {
      const track = composeFreshTrack(seed);
      for (let i = 1; i < track.length; i += 1)
        if (track[i] === track[i - 1]) repeats += 1;
      for (const id of track) uses.set(id, (uses.get(id) ?? 0) + 1);
    }
    expect(repeats).toBe(0);
    // start and finish are structural and bracket every course.
    for (const [id, count] of uses) {
      if (id === "start" || id === "finish") continue;
      expect(
        count / samples,
        `${id} appears in ${((count / samples) * 100).toFixed(0)}% of fresh courses`,
      ).toBeLessThan(0.7);
    }
  });

  it("prices the new zones off authored data rather than a name", () => {
    // difficulty.ts derives a zone's risk multiplier from its segment's rating,
    // the dodge room the zone leaves after the runner's capsule, and the carry
    // the segment forces. Nothing here may leave a zone narrower than the
    // capsule, which is the one input that scheme cannot price.
    const capsule = PLAYER.capsuleRadius * 2;
    for (const segment of SHAPE_SEGMENTS)
      for (const z of segment.zones)
        expect(
          z.maxX - z.minX,
          `${segment.id}/${z.id} leaves ${(z.maxX - z.minX - capsule).toFixed(2)}u of dodge room`,
        ).toBeGreaterThan(capsule);
  });
});
