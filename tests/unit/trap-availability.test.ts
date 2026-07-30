import { describe, expect, it } from "vitest";
import { MAX_TRAPS } from "@/lib/game/constants";
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

  // The old filter counted occupants of the module-level classic zone list, so
  // it matched nothing at all on a composed course and reported all sixteen
  // types however full the course was. Both halves matter: the honest answer
  // must be zero, and the wrong-course answer must be visibly different, or
  // this test would pass against the bug it exists to catch.
  it("computes availability against the challenge's own course", () => {
    const custom = buildTrack(DEFAULT_CUSTOM_TRACK);
    const classic = buildTrack(CLASSIC_TRACK);
    const saturated = fill(custom);
    expect(saturated.length).toBeGreaterThan(0);
    expect(getAvailableTrapTypes(custom, saturated)).toEqual([]);
    expect(getAvailableTrapTypes(classic, saturated).length).toBeGreaterThan(2);

    // Authored pad allow-lists are legacy compatibility data. New placements
    // use real blocks and geometric validation, so a wide start block remains
    // available even when the retired pads in the middle accepted only small
    // traps.
    const restricted = buildTrack(["start", "stones", "gap"]);
    expect(getAvailableTrapTypes(restricted, [])).toEqual([...TRAP_TYPES]);
  });

  it("ends a full chain with no offer instead of three dead cards", () => {
    for (const [name, segments] of [
      ["classic", CLASSIC_TRACK],
      ["default custom", DEFAULT_CUSTOM_TRACK],
    ] as const) {
      const track = buildTrack(segments);
      const placed: TrapInstance[] = [];
      let offers = chooseTraps("attempt-0", "chain", 7, placed, track);
      let step = 0;
      while (offers) {
        for (const type of offers)
          expect(
            firstLegalPlacement(track, type, placed),
            `${name} offered ${type} at depth ${placed.length} with nowhere to put it`,
          ).not.toBeNull();
        expect(add(track, offers[step % 3]!, placed)).toBe(true);
        step += 1;
        offers = chooseTraps(`attempt-${step}`, "chain", 7, placed, track);
      }
      expect(placed.length, `${name} ceiling`).toBeGreaterThan(14);
    }
  });

  // MAX_TRAPS is the published cap, and a cap nothing can reach is a lie. The
  // classic course carries 22 legal placements, so the constant is what stops
  // the chain there; a shorter composed course runs out of room first and ends
  // through the same no-offer path.
  it("keeps MAX_TRAPS reachable on the classic course", () => {
    expect(fill(buildTrack(CLASSIC_TRACK)).length).toBeGreaterThanOrEqual(
      MAX_TRAPS,
    );
    const capped = fill(buildTrack(CLASSIC_TRACK), MAX_TRAPS);
    expect(capped.length).toBe(MAX_TRAPS);
    expect(
      chooseTraps("attempt", "chain", 7, capped, buildTrack(CLASSIC_TRACK)),
    ).toBeNull();
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
