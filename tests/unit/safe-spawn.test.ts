import { describe, expect, it } from "vitest";
import { safeSpawnForTrack, withSafeSpawn, type BuiltTrack } from "@/lib/game/track";

const track = (spawn: BuiltTrack["spawn"]): BuiltTrack => ({
  pieces: [
    { id: "start", center: [0, -0.5, 0], size: [4, 1, 4], color: "#ffd84d" },
    { id: "far", center: [10, 1.5, -4], size: [3, 1, 3], color: "#4b8dff" },
  ],
  zones: [],
  spawn,
  exit: [10, 3, -4],
  length: 12,
});

describe("runtime spawn safety", () => {
  it("preserves an already supported spawn", () => {
    const source = track([0, 1.25, 0]);
    expect(safeSpawnForTrack(source)).toEqual(source.spawn);
    expect(withSafeSpawn(source)).toBe(source);
  });

  it("pulls an unsupported marker into the nearest player-sized deck interior", () => {
    const safe = safeSpawnForTrack(track([3, 1.25, 0]));
    expect(safe[0]).toBeCloseTo(1.5);
    expect(safe[1]).toBeCloseTo(1.25);
    expect(safe[2]).toBe(0);
  });

  it("recovers a completely detached imported spawn instead of dropping into the void", () => {
    const safe = safeSpawnForTrack(track([100, -20, 100]));
    expect(Number.isFinite(safe[0])).toBe(true);
    expect(safe[1]).toBeGreaterThan(1);
    expect(Math.abs(safe[0])).toBeLessThan(12);
    expect(Math.abs(safe[2])).toBeLessThan(6);
  });
});
