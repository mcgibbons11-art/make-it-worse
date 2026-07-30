import { describe, expect, it } from "vitest";
import { placementFromWorld, placementSurfaces, snapToGrid, surfaceAt, validatePlacement } from "@/lib/game/placement";
import { PLAYER } from "@/lib/game/constants";
import { ZONE_MAP, zoneCenter } from "@/lib/game/level-definition";
import type { TrapInstance } from "@/lib/game/types";

// Standing on the middle of runway_front, which is where a zero-offset
// placement lands. Derived rather than written out: this was the literal
// [0, 0.05, 6.75], and when the classic course was reshaped to open real gaps
// in it the zone moved out from under the fixture, so the overlap test below
// stopped overlapping anything and passed a placement it exists to refuse.
const RUNWAY_FRONT = zoneCenter(ZONE_MAP.get("runway_front")!);

const trap = (over: Partial<TrapInstance> = {}): TrapInstance => ({
  id: "one", type: "floor_fan", ownerUserId: null, ownerName: "Safe Otter",
  ownerAvatarSeed: 1, depthAdded: 1, zoneId: "runway_front",
  position: [RUNWAY_FRONT[0], 0.05, RUNWAY_FRONT[1]], rotationY: 0, seed: 1, params: {}, ...over,
});

describe("placement", () => {
  it("accepts a valid placement and snaps deterministically", () => {
    const result = validatePlacement(
      { type: "floor_fan", zoneId: "runway_front", offsetX: 0.26, offsetZ: 0, rotationQuarterTurns: 1 },
      [],
    );
    expect(result.valid).toBe(true);
    expect(snapToGrid(0.26)).toBe(0.25);
  });

  it("still rejects the things that protect the level", () => {
    // Nowhere at all.
    expect(validatePlacement({ type: "floor_fan", zoneId: "missing", offsetX: 0, offsetZ: 0, rotationQuarterTurns: 0 }, []))
      .toMatchObject({ valid: false, reason: "outside_zone" });
    // Not a real number.
    expect(validatePlacement({ type: "floor_fan", zoneId: "runway_front", offsetX: Number.NaN, offsetZ: 0, rotationQuarterTurns: 0 }, []))
      .toMatchObject({ valid: false, reason: "invalid_number" });
    // On top of an existing trap.
    expect(validatePlacement({ type: "soap_slick", zoneId: "runway_front", offsetX: 0, offsetZ: 0, rotationQuarterTurns: 0 }, [trap()]))
      .toMatchObject({ valid: false, reason: "overlaps_trap" });
  });

  it("no longer refuses a trap for the surface's taste in traps", () => {
    // Was `type_not_allowed`: the stepping-stone zones carried an allowlist that
    // omitted the larger props. A rolling fridge on a stone is now a legal, and
    // frankly excellent, decision - it is only refused if it does not FIT.
    const result = validatePlacement(
      { type: "rolling_fridge", zoneId: "stones_mid", offsetX: 0, offsetZ: 0, rotationQuarterTurns: 0 },
      [],
    );
    if (!result.valid) expect(result.reason).not.toBe("type_not_allowed");
  });

  it("no longer caps how many traps a surface may hold", () => {
    // Was `zone_full` at maxOccupants. Two traps far enough apart on one broad
    // surface are fine; only overlap decides, and overlap is about distance.
    const result = validatePlacement(
      { type: "soap_slick", zoneId: "runway_front", offsetX: 1.5, offsetZ: 2, rotationQuarterTurns: 0 },
      [trap()],
    );
    if (!result.valid) expect(result.reason).not.toBe("zone_full");
  });

  it("lets a trap stand on a level piece that was never an authored zone", () => {
    // The whole point of free placement. `bridge` is a LevelPiece id, not a
    // zone id, so this exact call returned outside_zone before.
    expect(validatePlacement({ type: "soap_slick", zoneId: "bridge", offsetX: 0, offsetZ: 0, rotationQuarterTurns: 0 }, []))
      .toMatchObject({ valid: true });
  });

  it("measures dodge room for a sweep instead of reading the surface's name", () => {
    // The bridge is 2.6u wide, so a hammer centred on it leaves 1.3 - 1.3 = 0u
    // of floor either side against the 0.76u a runner is wide. Refused, and
    // refused for its geometry: the old rule only ever looked at ids beginning
    // "stones", so it waved this one straight through.
    expect(validatePlacement({ type: "swinging_hammer", zoneId: "bridge", offsetX: 0, offsetZ: 0, rotationQuarterTurns: 0 }, []))
      .toMatchObject({ valid: false, reason: "unsafe_sweep" });
    // The 6u-wide runway leaves 3 - 1.3 = 1.7u, which is room to get past.
    expect(validatePlacement({ type: "swinging_hammer", zoneId: "runway_front", offsetX: 0, offsetZ: 0, rotationQuarterTurns: 0 }, []))
      .toMatchObject({ valid: true });
    // A surface too narrow to hold the trap at all is refused before the sweep
    // rule is reached, which is the more basic complaint and the better message.
    expect(validatePlacement({ type: "swinging_hammer", zoneId: "center-island", offsetX: 0, offsetZ: 0, rotationQuarterTurns: 0 }, []))
      .toMatchObject({ valid: false, reason: "outside_zone" });
  });

  it("keeps the sweep rule honest about the margin it claims", () => {
    // A runner needs their own width of floor to get past. If this drifts
    // from the SQL the parity test fails, so pin the arithmetic here too.
    expect(PLAYER.capsuleRadius * 2).toBeCloseTo(0.76, 6);
  });

  it("finds the surface under a dragged point, and prefers the higher one", () => {
    // Probe points are DERIVED from each surface rather than written down. The
    // level is authored elsewhere and its pieces move; a test that hard-codes
    // "z = 14 is the middle stone" fails when someone reshapes the course,
    // which says nothing about whether surfaceAt works.
    for (const surface of placementSurfaces()) {
      const x = (surface.minX + surface.maxX) / 2;
      const z = (surface.minZ + surface.maxZ) / 2;
      const found = surfaceAt(x, z);
      expect(found, `nothing found at the centre of ${surface.id}`).not.toBeNull();
      // Not necessarily the same surface - another may overlap it - but never
      // one that sits LOWER, because the runner stands on the highest floor.
      expect(found!.groundY, `${surface.id} resolved to something lower`)
        .toBeGreaterThanOrEqual(surface.groundY);
    }
    // Far off the course in both axes, which no piece reaches.
    expect(surfaceAt(500, 500)).toBeNull();
  });

  it("offers far more floor than the eight authored zones did", () => {
    // The editor draws one patch per surface, so this count IS how much of the
    // course a player can drop a trap on. Eight hand-drawn boxes was the whole
    // board before; anything at or below that means the pieces stopped being
    // reachable and the jank is back.
    const surfaces = placementSurfaces();
    expect(surfaces.length).toBeGreaterThan(8);
    // Only the real blocks are drawn. Legacy pad ids still validate old links,
    // but are no longer presented as smaller preferred targets in the editor.
    expect(surfaces.some((surface) => surface.id === "runway_front")).toBe(false);
    for (const id of ["start", "runway", "bridge", "finish"])
      expect(surfaces.some((surface) => surface.id === id)).toBe(true);
  });

  it("re-homes a drag that crosses onto another surface", () => {
    // A drag that begins on one surface and ends over a DIFFERENT one must
    // re-home to where the cursor actually is. Before free placement it kept
    // computing offsets against the surface it started on, which is how a drag
    // appeared to stop dead at an invisible line.
    const surfaces = placementSurfaces();
    const from = surfaces.find((surface) => surface.id === "runway")!;
    const to = surfaces.find((surface) => surface.id !== from.id && surface.id !== "start")!;
    const x = (to.minX + to.maxX) / 2;
    const z = (to.minZ + to.maxZ) / 2;
    const input = placementFromWorld("soap_slick", from.id, x, z, 0);
    expect(Number.isFinite(input.offsetX)).toBe(true);
    // It named the surface under the cursor, not the one the drag began on.
    expect(input.zoneId).not.toBe(from.id);
    expect(surfaceAt(x, z)?.id).toBe(input.zoneId);
  });
});
