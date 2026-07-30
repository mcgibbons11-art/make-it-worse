import { describe, expect, it } from "vitest";
import { generateRandomRoom, runtimeMap } from "@/components/game/RoomBuilder";
import {
  PUBLISHED_MAP_CATALOG_KEY,
  PUBLISHED_MAP_CODE_MAX_LENGTH,
  PUBLISHED_MAP_CODE_PREFIX,
  decodePublishedMapCode,
  encodePublishedMapCode,
  listRememberedPublishedMaps,
  rememberPublishedMap,
} from "@/portals/src/published-map-catalog";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function published(seed: number, title = `Published map ${seed}`) {
  const runtime = runtimeMap(generateRandomRoom(seed), seed, seed, `Builder ${seed}`);
  const code = encodePublishedMapCode({
    ...runtime,
    avatar: null,
    title,
    publishedAt: `2026-07-${String((seed % 20) + 1).padStart(2, "0")}T00:00:00.000Z`,
  });
  return { runtime, code };
}

describe("Portals published-map codes", () => {
  it("round-trips an exact root authored room in one bounded paste code", () => {
    const { runtime, code } = published(7, "Kitchen catastrophe");
    expect(code.startsWith(PUBLISHED_MAP_CODE_PREFIX)).toBe(true);
    expect(code.length).toBeLessThanOrEqual(PUBLISHED_MAP_CODE_MAX_LENGTH);
    const decoded = decodePublishedMapCode(code);
    expect(decoded.title).toBe("Kitchen catastrophe");
    expect(decoded.author).toBe("Builder 7");
    expect(decoded.versionId).toBe(runtime.challenge.slug);
    expect(decoded.track.pieces.map((piece) => ({
      center: piece.center,
      size: piece.size,
      color: piece.color,
      rotationX: piece.rotationX,
    }))).toEqual(
      runtime.track.pieces.map((piece) => ({
        center: piece.center,
        size: piece.size,
        color: piece.color,
        rotationX: piece.rotationX,
      })),
    );
    expect(decoded.track.zones.map((zone) => ({
      minX: zone.minX,
      maxX: zone.maxX,
      minZ: zone.minZ,
      maxZ: zone.maxZ,
      groundY: zone.groundY,
      maxOccupants: zone.maxOccupants,
      allowedTypes: zone.allowedTypes,
    }))).toEqual(
      runtime.track.zones.map((zone) => ({
        minX: zone.minX,
        maxX: zone.maxX,
        minZ: zone.minZ,
        maxZ: zone.maxZ,
        groundY: zone.groundY,
        maxOccupants: zone.maxOccupants,
        allowedTypes: zone.allowedTypes,
      })),
    );
    expect(decoded.track.spawn).toEqual(runtime.track.spawn);
    expect(decoded.track.exit).toEqual(runtime.track.exit);
    expect(decoded.track.length).toBe(runtime.track.length);
    expect(decoded.challenge.traps.map((trap) => ({
      type: trap.type,
      position: trap.position.map((value) => Number(value.toFixed(6))),
      rotationY: trap.rotationY,
      seed: trap.seed,
      params: trap.params,
    }))).toEqual(runtime.challenge.traps.map((trap) => ({
      type: trap.type,
      position: trap.position.map((value) => Number(value.toFixed(6))),
      rotationY: trap.rotationY,
      seed: trap.seed,
      params: trap.params,
    })));
  });

  it("rejects ordinary and made-worse challenge payloads as publications", () => {
    const { runtime } = published(8);
    expect(() => decodePublishedMapCode("not-a-published-map")).toThrow();
    expect(() => encodePublishedMapCode({
      challenge: { ...runtime.challenge, parentSlug: "clean-parent" },
      track: runtime.track,
      avatar: null,
      title: "Distorted child",
    })).toThrow("PUBLISHED_MAP_CODE_NOT_ROOT");
  });

  it("persists, deduplicates, and skips a damaged local catalog entry", () => {
    const storage = new MemoryStorage();
    const first = published(10).code;
    const second = published(11).code;
    rememberPublishedMap(first, storage);
    rememberPublishedMap(second, storage);
    rememberPublishedMap(first, storage);
    expect(listRememberedPublishedMaps(storage).map((map) => map.code)).toEqual([
      second,
      first,
    ]);
    storage.setItem(PUBLISHED_MAP_CATALOG_KEY, JSON.stringify(["damaged", second]));
    expect(listRememberedPublishedMaps(storage).map((map) => map.code)).toEqual([second]);
  });
});
