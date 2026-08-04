// The per-room best-run trace store behind "race your own best". Kept out of
// the progression ledger on purpose (traces would blow the 64 KB host save),
// so it needs its own storage discipline: faster-only writes, bounded rooms,
// and tolerance for a browser that refuses storage.
import { afterEach, describe, expect, it } from "vitest";
import {
  BEST_GHOST_STORAGE_KEY,
  MAX_TRACKED_GHOSTS,
  loadBestGhost,
  saveBestGhost,
} from "@/lib/game/best-ghost";

function trace(frames = 15): import("@/lib/game/types").GhostTrace {
  return {
    version: 1,
    hz: 15,
    durationMs: Math.round((frames / 15) * 1000),
    frames: Array.from({ length: frames }, (_, index) => [index, 10, index * 2, 0, 0]),
  };
}

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

function install(value: Storage): void {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("the best-run ghost store", () => {
  it("keeps only the fastest trace per room", () => {
    install(memoryStorage());
    expect(saveBestGhost("clean-abc123", 12_000, trace(10), 1)).toBe(true);
    expect(saveBestGhost("clean-abc123", 9_000, trace(20), 2)).toBe(true);
    expect(saveBestGhost("clean-abc123", 10_000, trace(30), 3)).toBe(false);
    expect(loadBestGhost("clean-abc123")?.trace.frames).toHaveLength(20);
    expect(loadBestGhost("clean-abc123")?.timeMs).toBe(9_000);
  });

  it("refuses times and traces a timer could not produce", () => {
    install(memoryStorage());
    expect(saveBestGhost("clean-abc123", 0, trace(), 1)).toBe(false);
    expect(saveBestGhost("clean-abc123", Number.NaN, trace(), 1)).toBe(false);
    expect(saveBestGhost("clean-abc123", 9_000, trace(0), 1)).toBe(false);
    expect(loadBestGhost("clean-abc123")).toBeNull();
  });

  it("evicts the room raced longest ago once the cap is passed", () => {
    install(memoryStorage());
    for (let index = 0; index <= MAX_TRACKED_GHOSTS; index += 1)
      saveBestGhost(`clean-room${index}`, 10_000, trace(), index + 1);
    expect(loadBestGhost("clean-room0")).toBeNull();
    expect(loadBestGhost(`clean-room${MAX_TRACKED_GHOSTS}`)).not.toBeNull();
  });

  it("treats a missing or hostile store as having no ghosts", () => {
    expect(loadBestGhost("clean-abc123")).toBeNull();
    expect(saveBestGhost("clean-abc123", 9_000, trace())).toBe(false);
    const store = memoryStorage();
    store.setItem(BEST_GHOST_STORAGE_KEY, "{not json");
    install(store);
    expect(loadBestGhost("clean-abc123")).toBeNull();
    expect(saveBestGhost("clean-abc123", 9_000, trace(), 1)).toBe(true);
  });
});
