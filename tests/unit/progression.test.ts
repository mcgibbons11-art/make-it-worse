import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PersonalBestPill,
  ProgressionRibbon,
  ProgressionSummary,
} from "@/components/hud/ProgressionHud";
import {
  CLOSE_CALL_PROGRESS,
  MAX_TRACKED_BESTS,
  NEAR_RECORD_MS,
  PROGRESSION_STORAGE_KEY,
  TRAP_UNLOCKS,
  applyRunEnd,
  applyTrapPlaced,
  defaultStats,
  isUnlocked,
  loadStats,
  lockedTraps,
  personalBest,
  saveStats,
  storageAvailable,
  topDeathCauses,
  totalRuns,
  unlockedOffers,
  type ProgressionStats,
  type RunRecord,
} from "@/lib/game/progression";
import { TRAP_CATALOG, TRAP_TYPES } from "@/lib/game/trap-catalog";
import type { TrapType } from "@/lib/game/types";
import { useProgressionStore } from "@/stores/progression-store";

/**
 * Node has no localStorage, so the default state of every test here is the one
 * that breaks in production and never in development: server rendering, and a
 * browser that refuses storage outright.
 */
function memoryStorage(options: { failWrites?: boolean } = {}): Storage {
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
      if (options.failWrites) throw new Error("QuotaExceededError");
      map.set(key, value);
    },
  };
}

function install(value: Storage): void {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value });
}

function installThrowingAccess(): void {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("SecurityError: storage is disabled");
    },
  });
}

function uninstall(): void {
  Reflect.deleteProperty(globalThis, "localStorage");
}

const run = (overrides: Partial<RunRecord> = {}): RunRecord => ({
  challengeSlug: "worse-abc",
  depth: 1,
  outcome: "completed",
  durationMs: 20_000,
  progress: 1,
  hazardTrapType: null,
  atMs: 1_000,
  ...overrides,
});

afterEach(uninstall);

describe("progression storage", () => {
  it("treats an absent localStorage as an empty ledger rather than an error", () => {
    expect(typeof globalThis.localStorage).toBe("undefined");
    expect(storageAvailable()).toBe(false);
    expect(loadStats()).toEqual(defaultStats());
    expect(saveStats(defaultStats())).toBe(false);
  });

  it("survives a browser that throws on touching localStorage at all", () => {
    installThrowingAccess();
    expect(() => loadStats()).not.toThrow();
    expect(loadStats()).toEqual(defaultStats());
    expect(saveStats(defaultStats())).toBe(false);
    expect(storageAvailable()).toBe(false);
  });

  it("reports a private-mode browser that reads but refuses to write", () => {
    install(memoryStorage({ failWrites: true }));
    expect(storageAvailable()).toBe(false);
    expect(saveStats(defaultStats())).toBe(false);
    expect(loadStats()).toEqual(defaultStats());
  });

  it("round trips a ledger through a working store", () => {
    install(memoryStorage());
    const stats = applyRunEnd(defaultStats(), run()).stats;
    expect(saveStats(stats)).toBe(true);
    expect(storageAvailable()).toBe(true);
    expect(loadStats()).toEqual(stats);
  });

  it("falls back to an empty ledger on unreadable or foreign stored data", () => {
    const store = memoryStorage();
    install(store);
    store.setItem(PROGRESSION_STORAGE_KEY, "{ not json");
    expect(loadStats()).toEqual(defaultStats());
    store.setItem(PROGRESSION_STORAGE_KEY, JSON.stringify({ version: 99, clears: 40 }));
    expect(loadStats()).toEqual(defaultStats());
    store.setItem(PROGRESSION_STORAGE_KEY, JSON.stringify("a string"));
    expect(loadStats()).toEqual(defaultStats());
  });

  it("drops the parts of a stored ledger it cannot trust", () => {
    const store = memoryStorage();
    install(store);
    store.setItem(
      PROGRESSION_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        clears: -4,
        resets: "seven",
        currentStreak: 9,
        bestStreak: 2,
        trapsPlaced: 3.7,
        trapsPlacedByType: { soap_slick: 2, not_a_trap: 90 },
        deathsByCause: { floor_fan: 5, nonsense: 3 },
        bests: { good: { timeMs: 900, atMs: 5, clears: 2 }, bad: { timeMs: 0 } },
        firstRunAtMs: 0,
      }),
    );
    const stats = loadStats();
    expect(stats.clears).toBe(0);
    expect(stats.resets).toBe(0);
    expect(stats.trapsPlaced).toBe(3);
    expect(stats.trapsPlacedByType).toEqual({ soap_slick: 2 });
    expect(stats.deathsByCause).toEqual({ floor_fan: 5 });
    expect(Object.keys(stats.bests)).toEqual(["good"]);
    expect(stats.firstRunAtMs).toBeNull();
    // A hand-edited streak longer than the recorded best cannot stand, or the
    // mousetrap milestone reads as met on a ledger that never met it.
    expect(stats.bestStreak).toBe(9);
  });

  it("keeps the per-challenge record table bounded, evicting the least recent", () => {
    install(memoryStorage());
    const played = MAX_TRACKED_BESTS + 60;
    let stats = defaultStats();
    for (let index = 0; index < played; index += 1)
      stats = applyRunEnd(
        stats,
        run({ challengeSlug: `chain-${index}`, atMs: 1_000 + index }),
      ).stats;
    const slugs = Object.keys(stats.bests);
    expect(slugs).toHaveLength(MAX_TRACKED_BESTS);
    expect(slugs).toContain(`chain-${played - 1}`);
    expect(slugs).not.toContain("chain-0");
    expect(saveStats(stats)).toBe(true);
    expect(Object.keys(loadStats().bests)).toHaveLength(MAX_TRACKED_BESTS);
  });
});

describe("personal bests", () => {
  it("treats a first clear as a record with nothing behind it", () => {
    const { stats, summary } = applyRunEnd(defaultStats(), run({ durationMs: 24_000 }));
    expect(summary.record).toEqual({
      timeMs: 24_000,
      previousMs: null,
      improvementMs: null,
    });
    expect(personalBest(stats, "worse-abc")?.timeMs).toBe(24_000);
  });

  it("reports the improvement when a clear beats the standing record", () => {
    const first = applyRunEnd(defaultStats(), run({ durationMs: 24_000 })).stats;
    const { stats, summary } = applyRunEnd(first, run({ durationMs: 21_500, atMs: 2_000 }));
    expect(summary.record).toEqual({
      timeMs: 21_500,
      previousMs: 24_000,
      improvementMs: 2_500,
    });
    expect(personalBest(stats, "worse-abc")).toEqual({
      timeMs: 21_500,
      atMs: 2_000,
      clears: 2,
    });
  });

  it("keeps the record and counts the clear when a slower run comes in", () => {
    const first = applyRunEnd(defaultStats(), run({ durationMs: 21_500 })).stats;
    const { stats, summary } = applyRunEnd(first, run({ durationMs: 30_000, atMs: 3_000 }));
    expect(summary.record).toBeNull();
    expect(summary.nearRecordMs).toBeNull();
    expect(personalBest(stats, "worse-abc")).toEqual({
      timeMs: 21_500,
      atMs: 3_000,
      clears: 2,
    });
  });

  it("reports a clear that missed the record by less than the near-record window", () => {
    const first = applyRunEnd(defaultStats(), run({ durationMs: 21_500 })).stats;
    const near = applyRunEnd(first, run({ durationMs: 21_500 + NEAR_RECORD_MS - 1 }));
    expect(near.summary.nearRecordMs).toBe(NEAR_RECORD_MS - 1);
    const notNear = applyRunEnd(first, run({ durationMs: 21_500 + NEAR_RECORD_MS }));
    expect(notNear.summary.nearRecordMs).toBeNull();
  });

  it("refuses to record a best from a duration the timer could not produce", () => {
    for (const durationMs of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { stats, summary } = applyRunEnd(defaultStats(), run({ durationMs }));
      expect(summary.record).toBeNull();
      expect(personalBest(stats, "worse-abc")).toBeNull();
      expect(stats.clears).toBe(1);
    }
  });

  it("keeps a record per challenge rather than one for the whole game", () => {
    let stats = applyRunEnd(defaultStats(), run({ durationMs: 18_000 })).stats;
    stats = applyRunEnd(stats, run({ challengeSlug: "worse-xyz", durationMs: 40_000 })).stats;
    expect(personalBest(stats, "worse-abc")?.timeMs).toBe(18_000);
    expect(personalBest(stats, "worse-xyz")?.timeMs).toBe(40_000);
  });
});

describe("streaks, deaths and close calls", () => {
  it("counts consecutive clears and remembers the longest", () => {
    let stats = defaultStats();
    for (let index = 0; index < 3; index += 1)
      stats = applyRunEnd(stats, run({ atMs: index })).stats;
    expect(stats.currentStreak).toBe(3);
    expect(stats.bestStreak).toBe(3);
    const dead = applyRunEnd(stats, run({ outcome: "fell", progress: 0.4 }));
    expect(dead.stats.currentStreak).toBe(0);
    expect(dead.stats.bestStreak).toBe(3);
    expect(dead.summary.streakLost).toBe(3);
  });

  it("says nothing about a streak of one ending", () => {
    const stats = applyRunEnd(defaultStats(), run()).stats;
    expect(applyRunEnd(stats, run({ outcome: "fell" })).summary.streakLost).toBeNull();
  });

  it("leaves a streak untouched when the player resets on purpose", () => {
    const cleared = applyRunEnd(defaultStats(), run()).stats;
    const { stats, summary } = applyRunEnd(cleared, run({ outcome: "reset", progress: 0.1 }));
    expect(stats.currentStreak).toBe(1);
    expect(stats.resets).toBe(1);
    expect(summary.streakLost).toBeNull();
    expect(stats.deathsByCause).toEqual({});
  });

  it("blames the trap that was in contact, and the void or the clock otherwise", () => {
    let stats = applyRunEnd(
      defaultStats(),
      run({ outcome: "fell", hazardTrapType: "floor_fan" }),
    ).stats;
    stats = applyRunEnd(stats, run({ outcome: "fell", hazardTrapType: null })).stats;
    stats = applyRunEnd(
      stats,
      run({ outcome: "timeout", hazardTrapType: "soap_slick" }),
    ).stats;
    expect(stats.deathsByCause).toEqual({ floor_fan: 1, void: 1, timeout: 1 });
    expect(topDeathCauses(stats, 2)).toHaveLength(2);
    expect(totalRuns(stats)).toBe(3);
  });

  it("calls a failure close only when it actually was", () => {
    const close = applyRunEnd(
      defaultStats(),
      run({ outcome: "fell", progress: CLOSE_CALL_PROGRESS }),
    );
    expect(close.summary.closeCallProgress).toBe(CLOSE_CALL_PROGRESS);
    expect(close.stats.closeCalls).toBe(1);
    const early = applyRunEnd(
      defaultStats(),
      run({ outcome: "fell", progress: CLOSE_CALL_PROGRESS - 0.01 }),
    );
    expect(early.summary.closeCallProgress).toBeNull();
    expect(early.stats.closeCalls).toBe(0);
  });

  it("never reports a close call on a clear", () => {
    expect(applyRunEnd(defaultStats(), run({ progress: 1 })).summary.closeCallProgress)
      .toBeNull();
  });

  it("counts runs from their endings and leaves the input ledger alone", () => {
    const before = defaultStats();
    const snapshot = structuredClone(before);
    const cleared = applyRunEnd(before, run()).stats;
    expect(before).toEqual(snapshot);
    expect(totalRuns(cleared)).toBe(1);
    expect(totalRuns(applyRunEnd(cleared, run({ outcome: "reset" })).stats)).toBe(2);
  });
});

describe("unlocks", () => {
  it("opens with a roster that spans every category chooseTraps asks for", () => {
    const starting = TRAP_TYPES.filter((type) => isUnlocked(type, defaultStats()));
    expect(starting.length).toBeGreaterThanOrEqual(3);
    expect(new Set(starting.map((type) => TRAP_CATALOG[type].category))).toEqual(
      new Set(["sweeper", "movement", "prop"]),
    );
    expect(starting).toHaveLength(TRAP_TYPES.length - TRAP_UNLOCKS.length);
  });

  it("gates each milestone trap exactly once and never gates the rest", () => {
    const gated = TRAP_UNLOCKS.map((unlock) => unlock.type);
    expect(new Set(gated).size).toBe(gated.length);
    for (const unlock of TRAP_UNLOCKS) expect(TRAP_TYPES).toContain(unlock.type);
    const maxed: ProgressionStats = {
      ...defaultStats(),
      clears: 999,
      bestStreak: 999,
      trapsPlaced: 999,
      deepestClearedDepth: 999,
    };
    expect(TRAP_TYPES.every((type) => isUnlocked(type, maxed))).toBe(true);
    expect(lockedTraps(maxed)).toHaveLength(0);
  });

  it("announces a trap on the run that earns it and not on the next one", () => {
    let stats = defaultStats();
    const announced: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const result = applyRunEnd(stats, run({ atMs: index }));
      stats = result.stats;
      announced.push(...result.summary.unlocked);
    }
    expect(announced).toContain("toaster_launcher");
    expect(announced.filter((type) => type === "toaster_launcher")).toHaveLength(1);
    expect(isUnlocked("toaster_launcher", stats)).toBe(true);
  });

  it("earns the placement milestones from placing traps", () => {
    let stats = defaultStats();
    let earned: readonly string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const result = applyTrapPlaced(stats, "soap_slick");
      stats = result.stats;
      earned = result.unlocked;
    }
    expect(stats.trapsPlaced).toBe(5);
    expect(stats.trapsPlacedByType).toEqual({ soap_slick: 5 });
    expect(earned).toEqual(["robot_mop"]);
  });

  it("narrows an offer to what was earned, and never to nothing", () => {
    const fresh = defaultStats();
    expect(unlockedOffers(["swinging_hammer", "soap_slick", "sprinkler"], fresh)).toEqual([
      "swinging_hammer",
      "soap_slick",
    ]);
    // Three locked traps would leave the choice panel with no way onward, so
    // the ledger stands down rather than end the chain.
    const allLocked: readonly TrapType[] = ["sprinkler", "fridge_magnet", "mousetrap"];
    expect(unlockedOffers(allLocked, fresh)).toEqual(allLocked);
  });

  it("orders the locked roster by how close it is", () => {
    const stats: ProgressionStats = { ...defaultStats(), clears: 4, trapsPlaced: 1 };
    const locked = lockedTraps(stats);
    expect(locked[0]?.type).toBe("banana_peel");
    expect(locked[0]).toMatchObject({ current: 4, target: 5 });
    expect(locked.map((entry) => entry.type)).not.toContain("toaster_launcher");
  });
});

/**
 * The failure this guards is the one the brief calls out: a module-scope
 * localStorage read renders fine in a browser and takes down the server. Node
 * has no storage, no window and no document, so rendering the components here
 * is the real thing rather than a simulation of it.
 *
 * Every component comes back empty on purpose. zustand hands react-dom/server
 * the state the store was created with, and the ledger is only ever read from
 * an effect, so the server and the browser's first render agree on the
 * defaults and the saved numbers arrive afterwards. Asserting the emptiness is
 * asserting that no render path reaches for storage.
 */
describe("server rendering", () => {
  beforeEach(() => {
    useProgressionStore.setState({
      stats: defaultStats(),
      hydrated: false,
      persistent: false,
      lastSummary: null,
    });
  });

  it("renders every progression component with no storage present", () => {
    expect(typeof globalThis.localStorage).toBe("undefined");
    // The live region has to exist before its text does, and collapses through
    // .prog-ribbon:empty until a run has something true to report.
    expect(renderToStaticMarkup(createElement(ProgressionRibbon))).toBe(
      '<div class="prog-ribbon" role="status"></div>',
    );
    expect(
      renderToStaticMarkup(
        createElement(ProgressionSummary, { challengeSlug: "worse-abc" }),
      ),
    ).toBe("");
    expect(
      renderToStaticMarkup(
        createElement(PersonalBestPill, { challengeSlug: "worse-abc" }),
      ),
    ).toBe("");
  });

  it("stays empty on the server even after the ledger has been written", () => {
    install(memoryStorage());
    useProgressionStore.getState().recordRunEnd({
      challengeSlug: "worse-abc",
      depth: 3,
      outcome: "completed",
      durationMs: 24_120,
      progress: 1,
      hazardTrapType: null,
    });
    expect(useProgressionStore.getState().stats.clears).toBe(1);
    expect(
      renderToStaticMarkup(
        createElement(ProgressionSummary, { challengeSlug: "worse-abc" }),
      ),
    ).toBe("");
  });
});

describe("progression store", () => {
  beforeEach(() => {
    useProgressionStore.setState({
      stats: defaultStats(),
      hydrated: false,
      persistent: false,
      lastSummary: null,
    });
  });

  it("starts on the defaults so the first render matches the server", () => {
    expect(useProgressionStore.getState().stats).toEqual(defaultStats());
    expect(useProgressionStore.getState().hydrated).toBe(false);
  });

  it("keeps a session ledger when the browser refuses to persist", () => {
    install(memoryStorage({ failWrites: true }));
    const summary = useProgressionStore.getState().recordRunEnd({
      challengeSlug: "worse-abc",
      depth: 2,
      outcome: "completed",
      durationMs: 19_000,
      progress: 1,
      hazardTrapType: null,
    });
    expect(summary.record?.timeMs).toBe(19_000);
    expect(useProgressionStore.getState().stats.clears).toBe(1);
    expect(useProgressionStore.getState().persistent).toBe(false);
  });

  it("reads the saved ledger before its first write instead of overwriting it", () => {
    const store = memoryStorage();
    install(store);
    const saved = applyRunEnd(defaultStats(), run({ durationMs: 12_000 })).stats;
    expect(saveStats(saved)).toBe(true);
    useProgressionStore.getState().recordTrapPlaced("soap_slick");
    const state = useProgressionStore.getState();
    expect(state.persistent).toBe(true);
    expect(state.stats.clears).toBe(1);
    expect(state.stats.trapsPlaced).toBe(1);
    expect(personalBest(loadStats(), "worse-abc")?.timeMs).toBe(12_000);
  });

  it("hydrates once and holds the latest summary for the result screen", () => {
    install(memoryStorage());
    useProgressionStore.getState().hydrate();
    expect(useProgressionStore.getState().hydrated).toBe(true);
    useProgressionStore.getState().recordRunEnd({
      challengeSlug: "worse-abc",
      depth: 1,
      outcome: "fell",
      durationMs: 8_000,
      progress: 0.93,
      hazardTrapType: "swinging_hammer",
    });
    expect(useProgressionStore.getState().lastSummary?.closeCallProgress).toBe(0.93);
    useProgressionStore.getState().clearSummary();
    expect(useProgressionStore.getState().lastSummary).toBeNull();
  });
});
