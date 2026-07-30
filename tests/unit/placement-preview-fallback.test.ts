import { describe, expect, it } from "vitest";
import { buildTrack } from "@/lib/game/track";
import { placementSurfaces, validatePlacement } from "@/lib/game/placement";
import type { TrapPlacementInput } from "@/lib/game/types";

/**
 * The invalid-placement fallback in GameScene resolves the dragged trap's id
 * against `track.zones` alone:
 *
 *   const zone = track.zones.find((entry) => entry.id === placement.zoneId);
 *   if (!zone) return null;      // previewPosition === null
 *
 * Free placement made every level PIECE a placement surface too, so most ids a
 * drag can produce are not zones at all. When one of those is momentarily
 * invalid - which happens constantly while sweeping a trap around - the
 * fallback returns null, which unmounts TrapPreview AND hands CameraRig
 * `editorTarget={null}`. The course leaves the screen, so no surface is left
 * under the cursor to move the trap back onto, and the drag cannot recover.
 *
 * These tests pin the two halves of that: piece-backed ids exist, and they do
 * not resolve through a zones-only lookup.
 */
const GENTLE_OPENER = [
  "start",
  "runway",
  "parlour",
  "grand_hall",
  "convergence",
  "ramp",
  "finish",
] as const;

describe("placement preview fallback", () => {
  const track = buildTrack([...GENTLE_OPENER]);
  const surfaces = placementSurfaces(track);
  const zoneIds = new Set(track.zones.map((zone) => zone.id));
  const pieceBacked = surfaces.filter((surface) => !zoneIds.has(surface.id));

  it("exposes placement surfaces that are pieces rather than authored zones", () => {
    expect(surfaces.length).toBeGreaterThan(0);
    expect(pieceBacked.length).toBeGreaterThan(0);
  });

  it("cannot resolve a piece-backed surface through a zones-only lookup", () => {
    for (const surface of pieceBacked) {
      expect(track.zones.find((zone) => zone.id === surface.id)).toBeUndefined();
    }
  });

  it("produces a refusal on a piece-backed surface that the fallback then cannot place", () => {
    const surface = pieceBacked[0]!;
    // Far enough off centre to leave the surface, which is exactly what a drag
    // toward a platform edge does.
    const placement: TrapPlacementInput = {
      type: "paint_bucket",
      zoneId: surface.id,
      offsetX: (surface.maxX - surface.minX) / 2 + 2,
      offsetZ: 0,
      rotationQuarterTurns: 0,
    };
    const validation = validatePlacement(placement, [], track);
    expect(validation.valid).toBe(false);
    // The refusal is fine. Losing the preview and the camera with it is not.
    expect(track.zones.find((zone) => zone.id === placement.zoneId)).toBeUndefined();
  });
});
