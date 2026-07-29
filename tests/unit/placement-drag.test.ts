import { describe, expect, it } from "vitest";
import { CLASSIC_TRACK, buildTrack } from "@/lib/game/track";
import {
  nearestSurface,
  placementFromWorld,
  placementSurfaces,
  surfaceAt,
} from "@/lib/game/placement";

/**
 * Dragging a trap across the course.
 *
 * A course is platforms with gaps, so a drag from one deck to the next spends
 * most of its travel over nothing at all. With the cursor off every deck,
 * placementFromWorld measured the offset from the STARTING deck's centre and
 * put no bound on it, so a drag that ran past the lip produced an offset as
 * long as the drag. A refused placement still has to be drawn, and GameScene
 * hands the drawn position to CameraRig as editorTarget, so the camera followed
 * the trap out past the end of the course - the reported "camera jumps to the
 * end of the map".
 *
 * "parks the trap on the deck edge" is the one that actually catches it:
 * without the clamp it lands at 14.25 on a deck whose edge is at 4.0. The rest
 * pin the properties that keep a drag sane - it resolves to a real surface, it
 * prefers the deck underfoot, and it measures to the surface rectangle rather
 * than to its centre.
 */
const track = buildTrack(CLASSIC_TRACK);
const surfaces = placementSurfaces(track);

function isFinitePlacement(input: { offsetX: number; offsetZ: number }): boolean {
  return Number.isFinite(input.offsetX) && Number.isFinite(input.offsetZ);
}

describe("dragging a trap over anything on the map", () => {
  it("never produces a non-finite offset, wherever the cursor goes", () => {
    // Deliberately swept well past the course on every side, because that is
    // exactly what a fast drag does before the pointer catches up.
    const start = surfaces[0]!;
    for (let x = -60; x <= 60; x += 3.5) {
      for (let z = -60; z <= 90; z += 3.5) {
        const input = placementFromWorld("soap_slick", start.id, x, z, 0, track);
        expect(
          isFinitePlacement(input),
          `drag to (${x}, ${z}) produced ${input.offsetX}, ${input.offsetZ}`,
        ).toBe(true);
      }
    }
  });

  it("always resolves to a surface that exists, even over a gap", () => {
    const start = surfaces[0]!;
    const ids = new Set(surfaces.map((surface) => surface.id));
    for (let x = -40; x <= 40; x += 2.5) {
      for (let z = -40; z <= 70; z += 2.5) {
        const { zoneId } = placementFromWorld("soap_slick", start.id, x, z, 0, track);
        expect(ids.has(zoneId), `drag to (${x}, ${z}) landed on "${zoneId}"`).toBe(true);
      }
    }
  });

  it("parks the trap on the deck edge rather than off it", () => {
    const surface = surfaces.find((entry) => entry.maxX - entry.minX > 1)!;
    const cz = (surface.minZ + surface.maxZ) / 2;
    // A cursor far off the right-hand lip of this deck.
    const input = placementFromWorld("soap_slick", surface.id, surface.maxX + 12, cz, 0, track);
    // Offsets are relative to the centre of the surface the drag LANDED on,
    // which need not be the one it started from - that re-homing is the point.
    const home = surfaces.find((entry) => entry.id === input.zoneId)!;
    const landedX = (home.minX + home.maxX) / 2 + input.offsetX;
    const landedZ = (home.minZ + home.maxZ) / 2 + input.offsetZ;
    // Within a grid step of the chosen surface, on both axes.
    expect(landedX).toBeGreaterThanOrEqual(home.minX - 0.25);
    expect(landedX).toBeLessThanOrEqual(home.maxX + 0.25);
    expect(landedZ).toBeGreaterThanOrEqual(home.minZ - 0.25);
    expect(landedZ).toBeLessThanOrEqual(home.maxZ + 0.25);
  });

  it("prefers the deck under the cursor to the nearest one", () => {
    // Where a real surface is underfoot, nearestSurface must not override it -
    // otherwise a drag would snap to a neighbour while over solid ground.
    for (const surface of surfaces) {
      const x = (surface.minX + surface.maxX) / 2;
      const z = (surface.minZ + surface.maxZ) / 2;
      const under = surfaceAt(x, z, track);
      expect(under).not.toBeNull();
      const { zoneId } = placementFromWorld("soap_slick", surfaces[0]!.id, x, z, 0, track);
      expect(zoneId).toBe(under!.id);
    }
  });

  it("measures to the surface rectangle, not to its centre", () => {
    // A long deck the cursor is hanging just off the side of must win against a
    // small deck whose CENTRE happens to be closer. Centre distance is the
    // intuitive implementation and it picks the wrong platform.
    const long = surfaces.reduce((widest, entry) =>
      entry.maxZ - entry.minZ > widest.maxZ - widest.minZ ? entry : widest,
    );
    const justOff = nearestSurface(
      (long.minX + long.maxX) / 2,
      long.maxZ + 0.2,
      track,
    );
    expect(justOff).not.toBeNull();
    expect(justOff!.id).toBe(long.id);
  });
});
