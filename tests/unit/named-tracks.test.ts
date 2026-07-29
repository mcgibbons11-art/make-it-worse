import { describe, expect, it } from "vitest";
import {
  CLASSIC_TRACK,
  DEFAULT_CUSTOM_TRACK,
  NAMED_TRACKS,
  SEGMENT_MAP,
  buildTrack,
  isPlayableTrack,
} from "@/lib/game/track";
import { placementSurfaces } from "@/lib/game/placement";

/**
 * The map list is data, and data is exactly where a quiet mistake ships: a
 * sequence that reads fine, connects fine, and strands the runner two units
 * short of a door that never opens. So every named map goes through the same
 * gate a shared link goes through - isPlayableTrack itself, not a restatement
 * of its rules - and the gate is probed with a known-bad course first so a
 * stubbed gate cannot wave everything through.
 */
describe("the named map list", () => {
  it("is checked by a gate that still refuses anything", () => {
    // The self-test: if isPlayableTrack ever degrades into `return true`,
    // every assertion below becomes theater. A start bolted to a finish is
    // refused by design ("a course where the runner steps off the pad into
    // the door"), so it is the cheapest possible probe.
    expect(isPlayableTrack(["start", "finish"])).toBe(false);
    expect(isPlayableTrack([])).toBe(false);
    expect(isPlayableTrack(["classic", "classic"])).toBe(false);
  });

  it("offers only courses a runner can actually finish", () => {
    for (const map of NAMED_TRACKS)
      expect(
        isPlayableTrack(map.segmentIds),
        `${map.id} does not pass the gate every shared link must pass`,
      ).toBe(true);
  });

  it("gives every map a distinct identity", () => {
    const ids = NAMED_TRACKS.map((map) => map.id);
    const names = NAMED_TRACKS.map((map) => map.name);
    const sequences = NAMED_TRACKS.map((map) => map.segmentIds.join(">"));
    expect(new Set(ids).size).toBe(NAMED_TRACKS.length);
    expect(new Set(names).size).toBe(NAMED_TRACKS.length);
    expect(new Set(sequences).size).toBe(NAMED_TRACKS.length);
    // And distinct from the two courses that already exist without a name.
    for (const existing of [CLASSIC_TRACK, DEFAULT_CUSTOM_TRACK])
      expect(sequences).not.toContain(existing.join(">"));
    for (const map of NAMED_TRACKS) {
      expect(map.name.trim().length).toBeGreaterThan(0);
      expect(map.tagline.trim().length).toBeGreaterThan(0);
      expect(map.id).toMatch(/^[a-z][a-z-]*$/);
    }
  });

  it("survives its own repeats: no colliding piece or zone ids", () => {
    // stepping-stones and the-crossing repeat a segment on purpose; buildTrack
    // suffixes ids by slot, and this is what keeps that promise held.
    for (const map of NAMED_TRACKS) {
      const track = buildTrack(map.segmentIds);
      const pieceIds = track.pieces.map((piece) => piece.id);
      const zoneIds = track.zones.map((zone) => zone.id);
      expect(new Set(pieceIds).size, `${map.id} piece ids collide`).toBe(pieceIds.length);
      expect(new Set(zoneIds).size, `${map.id} zone ids collide`).toBe(zoneIds.length);
      // And every map is somewhere a trap can be dropped.
      const surfaces = placementSurfaces(track);
      expect(surfaces.length, `${map.id} has nowhere to place a trap`).toBeGreaterThan(0);
      expect(new Set(surfaces.map((surface) => surface.id)).size).toBe(surfaces.length);
    }
  });

  it("spans easy to hard rather than clustering", () => {
    const hardest = (map: (typeof NAMED_TRACKS)[number]) =>
      Math.max(...map.segmentIds.map((id) => SEGMENT_MAP.get(id)!.difficulty));
    // At least one map a first-timer can clear without meeting a difficulty-3
    // room, and at least one that is mostly difficulty-3.
    expect(NAMED_TRACKS.some((map) => hardest(map) <= 2)).toBe(true);
    expect(
      NAMED_TRACKS.some(
        (map) =>
          map.segmentIds.filter((id) => SEGMENT_MAP.get(id)!.difficulty === 3).length >= 2,
      ),
    ).toBe(true);
  });
});
