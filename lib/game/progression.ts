import { TRAP_TYPES } from "./trap-catalog";
import type { TrapType } from "./types";

/**
 * What a player carries between runs.
 *
 * This module is a ledger and nothing else. It reads the result of a run that
 * has already happened and writes numbers to local storage. Nothing here is
 * consulted by physics, by the trap catalogue, by placement validation, or by
 * the challenge link, so two players on the same link play the same level
 * whether this is their first run or their five hundredth.
 *
 * Every function is pure apart from the two named `loadStats`/`saveStats`, and
 * both of those are total: local storage is absent during server rendering and
 * throws on access in a locked-down or private-mode browser, so the failure
 * mode has to be "the ledger does not persist", never "the game does not
 * render". stores/progression-store.ts holds the live copy in memory, so a
 * browser that refuses to persist still gets a working session ledger.
 */

export const PROGRESSION_STORAGE_KEY = "miw-progression-v1";
const PROBE_KEY = "miw-progression-probe";

/**
 * Per-challenge records kept before the oldest played fall off. A player who
 * opens two hundred links should not carry an unbounded blob in a five megabyte
 * store, and a record for a challenge they last touched months ago is not the
 * one they are chasing.
 */
export const MAX_TRACKED_BESTS = 200;

/**
 * A failed run that reached this fraction of the course is reported back as a
 * close call. It is deliberately high: the beat is worth having only when it is
 * true, and a game that calls a 40% death "so close" is lying to keep a player
 * in the chair.
 */
export const CLOSE_CALL_PROGRESS = 0.85;

/** A clear that misses the standing record by less than this is reported. */
export const NEAR_RECORD_MS = 400;

/** What ended a run. A voluntary reset is not a death and is counted apart. */
export type DeathCause = TrapType | "void" | "timeout";

export type RunOutcome = "completed" | "fell" | "timeout" | "reset";

const DEATH_CAUSES: readonly DeathCause[] = [...TRAP_TYPES, "void", "timeout"];

export interface PersonalBest {
  /** Fastest clear of this challenge, in milliseconds. */
  timeMs: number;
  /** Wall clock of the most recent clear, used only to decide what to evict. */
  atMs: number;
  clears: number;
}

export interface ProgressionStats {
  version: 1;
  clears: number;
  resets: number;
  currentStreak: number;
  bestStreak: number;
  deepestClearedDepth: number;
  trapsPlaced: number;
  trapsPlacedByType: Partial<Record<TrapType, number>>;
  deathsByCause: Partial<Record<DeathCause, number>>;
  bests: Record<string, PersonalBest>;
  closeCalls: number;
  firstRunAtMs: number | null;
  lastRunAtMs: number | null;
}

/** One finished run, described with what the game already knows at that point. */
export interface RunRecord {
  challengeSlug: string;
  /** Chain depth of the challenge, so the ledger can track how deep a clear went. */
  depth: number;
  outcome: RunOutcome;
  durationMs: number;
  /** How far along the course the run ended, 0 to 1. */
  progress: number;
  /** The trap blamed for the death, or null for the void, the clock, or a reset. */
  hazardTrapType: TrapType | null;
  /** Wall clock, passed in so the reducer stays pure. */
  atMs: number;
}

export interface RunSummary {
  outcome: RunOutcome;
  /** Set when the run set a new fastest time for this challenge. */
  record: {
    timeMs: number;
    /** Null on a first clear, which is a record with nothing to compare to. */
    previousMs: number | null;
    improvementMs: number | null;
  } | null;
  /** How far off the record a clear landed, when it landed close and missed. */
  nearRecordMs: number | null;
  /** How far a failed run got, when it got far enough to be worth saying. */
  closeCallProgress: number | null;
  /** Consecutive clears after this run. */
  streak: number;
  /** The run of clears this failure ended, when it was two or more. */
  streakLost: number | null;
  unlocked: readonly TrapType[];
}

export function defaultStats(): ProgressionStats {
  return {
    version: 1,
    clears: 0,
    resets: 0,
    currentStreak: 0,
    bestStreak: 0,
    deepestClearedDepth: 0,
    trapsPlaced: 0,
    trapsPlacedByType: {},
    deathsByCause: {},
    bests: {},
    closeCalls: 0,
    firstRunAtMs: null,
    lastRunAtMs: null,
  };
}

/**
 * The traps a player has to earn, and what earns them.
 *
 * Everything absent from this table is available from the first run, which is
 * eight traps spanning all three categories. That matters: chooseTraps builds
 * its offer of three by asking for one sweeper, one movement and one prop, and
 * gives up entirely when fewer than three types are placeable, so a starting
 * roster that missed a category would change the shape of the offer rather than
 * just its contents.
 *
 * Nothing here is a grind for its own sake. Each milestone is something a
 * player passes by playing the game the way it is meant to be played, and none
 * of them can expire.
 */
export interface TrapUnlock {
  readonly type: TrapType;
  /** One plain sentence, shown while the trap is still locked. */
  readonly requirement: string;
  measure(stats: ProgressionStats): { current: number; target: number };
}

function milestone(
  type: TrapType,
  requirement: string,
  target: number,
  read: (stats: ProgressionStats) => number,
): TrapUnlock {
  return { type, requirement, measure: (stats) => ({ current: read(stats), target }) };
}

export const TRAP_UNLOCKS: readonly TrapUnlock[] = [
  milestone("toaster_launcher", "Survive 3 runs", 3, (s) => s.clears),
  milestone("robot_mop", "Add 5 traps to other people's levels", 5, (s) => s.trapsPlaced),
  milestone("banana_peel", "Survive 5 runs", 5, (s) => s.clears),
  milestone("mousetrap", "Clear 3 runs in a row", 3, (s) => s.bestStreak),
  milestone("ceiling_fan", "Survive a chain at disaster 4", 4, (s) => s.deepestClearedDepth),
  milestone("laundry_basket", "Add 12 traps", 12, (s) => s.trapsPlaced),
  milestone("sprinkler", "Survive 12 runs", 12, (s) => s.clears),
  milestone("fridge_magnet", "Survive a chain at disaster 8", 8, (s) => s.deepestClearedDepth),
];

const UNLOCK_BY_TYPE = new Map(TRAP_UNLOCKS.map((entry) => [entry.type, entry]));

/**
 * Whether a player has earned this trap. A type with no milestone is available
 * from the first run, so an un-wired build, where nothing calls this, offers
 * exactly the roster it offers today.
 */
export function isUnlocked(type: TrapType, stats: ProgressionStats): boolean {
  const unlock = UNLOCK_BY_TYPE.get(type);
  if (!unlock) return true;
  const { current, target } = unlock.measure(stats);
  return current >= target;
}

/**
 * The offer, less anything the player has not earned yet.
 *
 * This is the only shape the gate should ever take. It narrows a set of offers
 * that has already been chosen, so the trap the player picks is still one the
 * repository will accept on publish, and it hands the whole offer back when the
 * player has earned none of the three. That fallback is not a nicety: the
 * choice panel is the only route onward from a clear, so a ledger that could
 * empty it would end a player's chain over an unlock, which is a far worse
 * outcome than showing a trap early.
 */
export function unlockedOffers(
  offers: readonly TrapType[],
  stats: ProgressionStats,
): readonly TrapType[] {
  const earned = offers.filter((type) => isUnlocked(type, stats));
  return earned.length > 0 ? earned : offers;
}

/** Locked traps and how close they are, nearest first, for the roster display. */
export function lockedTraps(
  stats: ProgressionStats,
): readonly { type: TrapType; requirement: string; current: number; target: number }[] {
  return TRAP_UNLOCKS.filter((unlock) => !isUnlocked(unlock.type, stats))
    .map((unlock) => ({ type: unlock.type, requirement: unlock.requirement, ...unlock.measure(stats) }))
    .sort((a, b) => b.current / b.target - a.current / a.target);
}

function newlyUnlocked(
  before: ProgressionStats,
  after: ProgressionStats,
): readonly TrapType[] {
  return TRAP_UNLOCKS.filter(
    (unlock) => !isUnlocked(unlock.type, before) && isUnlocked(unlock.type, after),
  ).map((unlock) => unlock.type);
}

function bump<K extends string>(
  table: Partial<Record<K, number>>,
  key: K,
): Partial<Record<K, number>> {
  const next = { ...table };
  next[key] = (table[key] ?? 0) + 1;
  return next;
}

function prune(bests: Record<string, PersonalBest>): Record<string, PersonalBest> {
  const entries = Object.entries(bests);
  if (entries.length <= MAX_TRACKED_BESTS) return bests;
  return Object.fromEntries(
    entries.sort((a, b) => b[1].atMs - a[1].atMs).slice(0, MAX_TRACKED_BESTS),
  );
}

export function applyRunEnd(
  stats: ProgressionStats,
  run: RunRecord,
): { stats: ProgressionStats; summary: RunSummary } {
  const next: ProgressionStats = {
    ...stats,
    firstRunAtMs: stats.firstRunAtMs ?? run.atMs,
    lastRunAtMs: run.atMs,
  };
  const summary: RunSummary = {
    outcome: run.outcome,
    record: null,
    nearRecordMs: null,
    closeCallProgress: null,
    streak: stats.currentStreak,
    streakLost: null,
    unlocked: [],
  };
  // A duration the timer could not produce is not worth recording a best from,
  // and a zero-millisecond best would be unbeatable for the rest of the chain.
  const timed = Number.isFinite(run.durationMs) && run.durationMs > 0;
  const previous = stats.bests[run.challengeSlug];

  if (run.outcome === "reset") {
    // Resetting is how a player restarts a fumbled opening, and the game itself
    // treats it as blameless. Breaking a streak over it would turn a tool into
    // a penalty, so a reset leaves the streak exactly where it was without
    // extending it.
    next.resets = stats.resets + 1;
  } else if (run.outcome === "completed") {
    next.clears = stats.clears + 1;
    next.currentStreak = stats.currentStreak + 1;
    next.bestStreak = Math.max(stats.bestStreak, next.currentStreak);
    next.deepestClearedDepth = Math.max(stats.deepestClearedDepth, run.depth);
    summary.streak = next.currentStreak;
    if (timed) {
      if (!previous || run.durationMs < previous.timeMs) {
        summary.record = {
          timeMs: run.durationMs,
          previousMs: previous?.timeMs ?? null,
          improvementMs: previous ? previous.timeMs - run.durationMs : null,
        };
        next.bests = prune({
          ...stats.bests,
          [run.challengeSlug]: {
            timeMs: run.durationMs,
            atMs: run.atMs,
            clears: (previous?.clears ?? 0) + 1,
          },
        });
      } else {
        const behind = run.durationMs - previous.timeMs;
        if (behind < NEAR_RECORD_MS) summary.nearRecordMs = behind;
        next.bests = prune({
          ...stats.bests,
          [run.challengeSlug]: {
            ...previous,
            atMs: run.atMs,
            clears: previous.clears + 1,
          },
        });
      }
    }
  } else {
    if (stats.currentStreak >= 2) summary.streakLost = stats.currentStreak;
    next.currentStreak = 0;
    summary.streak = 0;
    const cause: DeathCause =
      run.outcome === "timeout" ? "timeout" : (run.hazardTrapType ?? "void");
    next.deathsByCause = bump(stats.deathsByCause, cause);
    const reached = Math.min(1, Math.max(0, run.progress));
    if (Number.isFinite(run.progress) && reached >= CLOSE_CALL_PROGRESS) {
      next.closeCalls = stats.closeCalls + 1;
      summary.closeCallProgress = reached;
    }
  }
  summary.unlocked = newlyUnlocked(stats, next);
  return { stats: next, summary };
}

export function applyTrapPlaced(
  stats: ProgressionStats,
  type: TrapType,
): { stats: ProgressionStats; unlocked: readonly TrapType[] } {
  const next: ProgressionStats = {
    ...stats,
    trapsPlaced: stats.trapsPlaced + 1,
    trapsPlacedByType: bump(stats.trapsPlacedByType, type),
  };
  return { stats: next, unlocked: newlyUnlocked(stats, next) };
}

/**
 * Runs that reached an end. Derived rather than stored so it can never drift
 * from the parts it is made of, and so the ledger needs only one hook in the
 * run lifecycle. A run abandoned by closing the tab is not counted, which is
 * the honest reading of "runs".
 */
export function totalRuns(stats: ProgressionStats): number {
  return (
    stats.clears +
    stats.resets +
    Object.values(stats.deathsByCause).reduce((sum, value) => sum + value, 0)
  );
}

/** The player's own record on a challenge, or null if they have never cleared it. */
export function personalBest(
  stats: ProgressionStats,
  challengeSlug: string,
): PersonalBest | null {
  return stats.bests[challengeSlug] ?? null;
}

/** Death causes, worst first, for the ledger display. */
export function topDeathCauses(
  stats: ProgressionStats,
  limit: number,
): readonly { cause: DeathCause; count: number }[] {
  return DEATH_CAUSES.map((cause) => ({ cause, count: stats.deathsByCause[cause] ?? 0 }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function storage(): Storage | null {
  try {
    // Undefined during server rendering, and the property access itself throws
    // in a browser configured to block storage, so both have to be caught here
    // rather than at the call sites.
    const value: Storage | undefined = globalThis.localStorage;
    return value ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether this browser will actually keep what it is given. Reading works in
 * Safari's private mode and writing throws, so nothing short of a probe write
 * tells the truth.
 */
export function storageAvailable(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(PROBE_KEY, "1");
    store.removeItem(PROBE_KEY);
    return true;
  } catch {
    return false;
  }
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function timestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function readBests(value: unknown): Record<string, PersonalBest> {
  if (typeof value !== "object" || value === null) return {};
  const out: Record<string, PersonalBest> = {};
  for (const [slug, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const timeMs = record["timeMs"];
    if (typeof timeMs !== "number" || !Number.isFinite(timeMs) || timeMs <= 0) continue;
    out[slug] = {
      timeMs,
      atMs: timestamp(record["atMs"]) ?? 0,
      clears: Math.max(1, count(record["clears"])),
    };
  }
  return prune(out);
}

function readCounts<K extends string>(
  value: unknown,
  keys: readonly K[],
): Partial<Record<K, number>> {
  if (typeof value !== "object" || value === null) return {};
  const source = value as Record<string, unknown>;
  const out: Partial<Record<K, number>> = {};
  for (const key of keys) {
    const total = count(source[key]);
    if (total > 0) out[key] = total;
  }
  return out;
}

/**
 * Turn whatever is in storage into a usable ledger. Anything unrecognised is
 * dropped field by field rather than rejected wholesale, so a ledger written by
 * a later build loses only the parts this build does not understand.
 *
 * Exported for the Portals save-state sync, which receives the same shape from
 * the host's per-player store and must not trust it any further than local
 * storage is trusted here.
 */
export function normalizeStats(value: unknown): ProgressionStats {
  if (typeof value !== "object" || value === null) return defaultStats();
  const source = value as Record<string, unknown>;
  if (source["version"] !== 1) return defaultStats();
  const bestStreak = count(source["bestStreak"]);
  const currentStreak = count(source["currentStreak"]);
  return {
    version: 1,
    clears: count(source["clears"]),
    resets: count(source["resets"]),
    currentStreak,
    bestStreak: Math.max(bestStreak, currentStreak),
    deepestClearedDepth: count(source["deepestClearedDepth"]),
    trapsPlaced: count(source["trapsPlaced"]),
    trapsPlacedByType: readCounts(source["trapsPlacedByType"], TRAP_TYPES),
    deathsByCause: readCounts(source["deathsByCause"], DEATH_CAUSES),
    bests: readBests(source["bests"]),
    closeCalls: count(source["closeCalls"]),
    firstRunAtMs: timestamp(source["firstRunAtMs"]),
    lastRunAtMs: timestamp(source["lastRunAtMs"]),
  };
}

export function loadStats(): ProgressionStats {
  const store = storage();
  if (!store) return defaultStats();
  try {
    const raw = store.getItem(PROGRESSION_STORAGE_KEY);
    return raw === null ? defaultStats() : normalizeStats(JSON.parse(raw));
  } catch {
    // Storage that throws on read, or a value that is not JSON. Either way the
    // player starts a fresh ledger rather than meeting an error page.
    return defaultStats();
  }
}

/** Returns false when the write did not stick, which the caller should surface. */
export function saveStats(stats: ProgressionStats): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(PROGRESSION_STORAGE_KEY, JSON.stringify(stats));
    return true;
  } catch {
    return false;
  }
}

function mergeCounts<K extends string>(
  a: Partial<Record<K, number>>,
  b: Partial<Record<K, number>>,
): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = { ...a };
  for (const [key, total] of Object.entries(b) as [K, number][]) {
    out[key] = Math.max(out[key] ?? 0, total);
  }
  return out;
}

/**
 * Reconcile two ledgers that may share history, for the Portals save-state
 * sync: one came from this browser's storage, the other from the host's
 * per-player store, and nothing records which runs each has seen.
 *
 * Counters take the maximum rather than the sum. Two ledgers that both watched
 * the same runs would double every number under addition; under max, history
 * unique to the smaller ledger is forfeited, which only understates. Bests keep
 * the faster time per room and the larger clear count. The current streak is a
 * statement about now, so it follows whichever ledger ran more recently.
 */
export function mergeStats(
  a: ProgressionStats,
  b: ProgressionStats,
): ProgressionStats {
  const newer = (b.lastRunAtMs ?? 0) >= (a.lastRunAtMs ?? 0) ? b : a;
  const bests: Record<string, PersonalBest> = { ...a.bests };
  for (const [slug, remote] of Object.entries(b.bests)) {
    const local = bests[slug];
    bests[slug] = local
      ? {
          timeMs: Math.min(local.timeMs, remote.timeMs),
          atMs: Math.max(local.atMs, remote.atMs),
          clears: Math.max(local.clears, remote.clears),
        }
      : remote;
  }
  const firstRuns = [a.firstRunAtMs, b.firstRunAtMs].filter(
    (value): value is number => value !== null,
  );
  return {
    version: 1,
    clears: Math.max(a.clears, b.clears),
    resets: Math.max(a.resets, b.resets),
    currentStreak: newer.currentStreak,
    bestStreak: Math.max(a.bestStreak, b.bestStreak),
    deepestClearedDepth: Math.max(a.deepestClearedDepth, b.deepestClearedDepth),
    trapsPlaced: Math.max(a.trapsPlaced, b.trapsPlaced),
    trapsPlacedByType: mergeCounts(a.trapsPlacedByType, b.trapsPlacedByType),
    deathsByCause: mergeCounts(a.deathsByCause, b.deathsByCause),
    bests: prune(bests),
    closeCalls: Math.max(a.closeCalls, b.closeCalls),
    firstRunAtMs: firstRuns.length ? Math.min(...firstRuns) : null,
    lastRunAtMs: newer.lastRunAtMs,
  };
}
