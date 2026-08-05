import { describe, expect, it } from "vitest";
import { placementSurfaces, validatePlacement } from "@/lib/game/placement";
import {
  CLASSIC_TRACK,
  DEFAULT_CUSTOM_TRACK,
  EDITABLE_SEGMENTS,
  buildTrack,
} from "@/lib/game/track";
import type { BuiltTrack } from "@/lib/game/track";
import { TRAP_CATALOG, TRAP_TYPES } from "@/lib/game/trap-catalog";
import {
  DEFAULT_ROTATION_QUARTER_TURNS,
  challengeTrack,
  chooseTraps,
  firstLegalPlacement,
  getAvailableTrapTypes,
} from "@/lib/game/trap-choice";
import type { TrapInstance, TrapType } from "@/lib/game/types";

/** Place a trap the way the game does, or report that the course has no room. */
function add(
  track: BuiltTrack,
  type: TrapType,
  placed: TrapInstance[],
): boolean {
  const candidate = firstLegalPlacement(track, type, placed);
  if (!candidate) return false;
  const result = validatePlacement(candidate, placed, track);
  if (!result.valid)
    throw new Error(`suggested ${type} in ${candidate.zoneId} is not valid`);
  placed.push({
    id: `t${placed.length}`,
    type,
    ownerUserId: null,
    ownerName: "Sim",
    ownerAvatarSeed: 1,
    depthAdded: placed.length + 1,
    zoneId: candidate.zoneId,
    position: result.canonicalPosition,
    rotationY: result.rotationY,
    seed: placed.length,
    params: TRAP_CATALOG[type].defaultParams,
  });
  return true;
}

function fill(track: BuiltTrack, limit = Infinity): TrapInstance[] {
  const placed: TrapInstance[] = [];
  while (
    placed.length < limit &&
    TRAP_TYPES.some((type) => add(track, type, placed))
  ) {
    /* keep going until nothing else fits */
  }
  return placed;
}

const NAMED_TRACKS: readonly (readonly [string, readonly string[]])[] = [
  ["classic", CLASSIC_TRACK],
  ["default custom", DEFAULT_CUSTOM_TRACK],
  ...EDITABLE_SEGMENTS.map(
    (segment) =>
      [`start+${segment.id}+finish`, ["start", segment.id, "finish"]] as const,
  ),
];

describe("trap availability", () => {
  it("suggests a placement that belongs to the course it was given", () => {
    for (const [name, segments] of NAMED_TRACKS) {
      const track = buildTrack(segments);
      const ids = new Set(placementSurfaces(track).map((surface) => surface.id));
      // Every one of these courses has blocks, so a course that can hold nothing
      // means the search is looking somewhere other than the course it was
      // handed and every id it finds is being rejected on the way back.
      expect(getAvailableTrapTypes(track, []).length, name).toBeGreaterThan(0);
      for (const existing of [[], fill(track, 4)]) {
        for (const type of TRAP_TYPES) {
          const candidate = firstLegalPlacement(track, type, existing);
          if (!candidate) continue;
          expect(ids, `${name}/${type}`).toContain(candidate.zoneId);
          expect(
            validatePlacement(candidate, existing, track).valid,
            `${name}/${type} in ${candidate.zoneId}`,
          ).toBe(true);
        }
      }
    }
  });

  it("offers every trap the empty classic course can hold", () => {
    const classic = buildTrack(CLASSIC_TRACK);
    expect(getAvailableTrapTypes(classic, [])).toEqual([...TRAP_TYPES]);
  });

  // Rewritten when traps became stackable. The original test saturated a
  // course and demanded availability fall to zero - the honest signal while
  // placement reserved 75% of both footprints between neighbours. Traps now
  // only have to avoid the same spot (TRAP_STACK_MIN_GAP), so crowding can
  // never use a course up: occupancy has stopped being the limit and
  // geometry is all that remains. Saturating now means filling every grid
  // cell, which is quadratic in the trap count and was timing this file out.
  //
  // The course-specificity the old test also guarded - the retired bug
  // counted occupants of a module-level classic zone list, so it answered
  // identically for every course - is covered by its sibling above, which
  // checks that every suggested placement belongs to the given course.
  it("never runs out of room, however crowded the course gets", () => {
    const custom = buildTrack(DEFAULT_CUSTOM_TRACK);
    const classic = buildTrack(CLASSIC_TRACK);
    // A bounded crowd, far past the old saturation point.
    const crowded = fill(custom, 40);
    expect(crowded.length).toBe(40);
    // Traps really are stacked: at least one pair sits closer than the old
    // footprint-proportional rule would ever have allowed.
    const tight = crowded.some((a, index) =>
      crowded.slice(index + 1).some(
        (b) => Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2]) < 1,
      ),
    );
    expect(tight, "stacking did not actually place traps close together").toBe(true);
    // And the crowd never closes the course to anything.
    expect(getAvailableTrapTypes(custom, crowded)).toEqual([...TRAP_TYPES]);
    expect(getAvailableTrapTypes(classic, [])).toEqual([...TRAP_TYPES]);

    // Authored pad allow-lists are legacy compatibility data. New placements
    // use real blocks and geometric validation, so a wide start block remains
    // available even when the retired pads in the middle accepted only small
    // traps.
    const restricted = buildTrack(["start", "stones", "gap"]);
    expect(getAvailableTrapTypes(restricted, [])).toEqual([...TRAP_TYPES]);
  });

  it("continues beyond the old depth cap without offering dead cards", () => {
    const track = buildTrack(CLASSIC_TRACK);
    const placed = fill(track, 20);
    for (let step = 0; step < 3; step += 1) {
      const offers = chooseTraps(`attempt-${step}`, "chain", 7, placed, track);
      expect(offers, `no offer at depth ${placed.length}`).not.toBeNull();
      for (const type of offers!)
        expect(
          firstLegalPlacement(track, type, placed),
          `offered ${type} at depth ${placed.length} with nowhere to put it`,
        ).not.toBeNull();
      expect(add(track, offers![step % 3]!, placed)).toBe(true);
    }
    expect(placed.length).toBe(23);
  });

  it("does not treat twenty placed traps as a terminal chain", () => {
    const capped = fill(buildTrack(CLASSIC_TRACK), 20);
    expect(capped.length).toBe(20);
    expect(
      chooseTraps("attempt", "chain", 7, capped, buildTrack(CLASSIC_TRACK)),
    ).not.toBeNull();
  });

  it("does not aim a suggested trap at the exit", () => {
    // Forward is (sin, cos) of the rotation, so a positive z component points
    // the fan, spring pad, mousetrap, toaster and fridge charge down the course
    // toward the finish, which helps the runner it is charging the player for.
    const forwardZ = Math.cos((DEFAULT_ROTATION_QUARTER_TURNS * Math.PI) / 2);
    expect(forwardZ).toBeLessThanOrEqual(0);
    const suggested = firstLegalPlacement(buildTrack(CLASSIC_TRACK), "floor_fan", []);
    expect(suggested?.rotationQuarterTurns).toBe(DEFAULT_ROTATION_QUARTER_TURNS);
  });

  it("resolves a challenge's course from its segment list", () => {
    expect(challengeTrack({ track: DEFAULT_CUSTOM_TRACK }).zones).toEqual(
      buildTrack(DEFAULT_CUSTOM_TRACK).zones,
    );
    const classic = buildTrack(CLASSIC_TRACK).zones;
    expect(challengeTrack({ track: undefined }).zones).toEqual(classic);
    expect(challengeTrack(null).zones).toEqual(classic);
  });
});
