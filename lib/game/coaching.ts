"use client";
import { useEffect, useSyncExternalStore } from "react";
import { PLAYER } from "./constants";
import { TRAP_CATALOG, TRAP_TYPES } from "./trap-catalog";
import type { TrapCategory } from "./trap-catalog";
import type { TrapType } from "./types";

/**
 * What the game has already taught this player, and what it still owes them.
 *
 * The rule this module exists to enforce is that the game says nothing until a
 * player has demonstrated they need to hear it, and never says the same thing
 * twice. Every field below is therefore a record of something the player did,
 * not a timer or a counter of sessions, and every hint carries a condition that
 * goes false the moment the lesson lands.
 *
 * Storage is best effort. `loadMemory` and `saveMemory` are total: local storage
 * is absent during server rendering and throws on access in a locked-down or
 * private-mode browser, so the failure mode is "the tour runs again on the next
 * page load", never "the game does not render". The live copy below is the
 * source of truth for the session, so a browser that refuses to persist still
 * gets a tour that finishes and hints that stay dismissed.
 */

export const COACH_STORAGE_KEY = "miw-coach-v1";
const PROBE_KEY = "miw-coach-probe";

/** Run endings kept. Only the last three are ever read; five is slack. */
export const MAX_RECENT_ENDINGS = 5;

/**
 * How many times a hint may appear before it silences itself. A player who has
 * seen a card twice and not acted on it has decided, and a third showing is
 * nagging rather than coaching.
 */
export const HINT_MAX_SHOWS = 2;

/** Consecutive deaths that make a pattern worth naming. */
export const REPEAT_DEATHS = 3;

/** How close three endings must be, as a fraction of the course, to be "the same spot". */
export const SAME_SPOT_BAND = 0.08;

export type CoachRunOutcome = "completed" | "fell" | "timeout" | "reset";

export interface RunEnding {
  outcome: CoachRunOutcome;
  /** How far along the course the run ended, 0 to 1. */
  progress: number;
  /** The trap blamed for the ending, or null for the void, the clock, or a reset. */
  cause: TrapType | null;
}

export type HintId =
  | "never-jumped"
  | "repeat-trap"
  | "same-spot"
  | "never-reset";

export interface CoachHint {
  id: HintId;
  title: string;
  body: string;
  /** The trap the hint is about, so the card can offer its details. */
  trap: TrapType | null;
}

export interface CoachMemory {
  version: 1;
  /** The first-run tour has been finished or skipped. */
  toured: boolean;
  /** The player has moved the runner at least once. */
  moved: boolean;
  /** The player has pressed jump at least once. */
  jumped: boolean;
  /** The player has restarted an attempt with R at least once. */
  usedReset: boolean;
  /** Runs that reached an ending, of any kind. */
  runs: number;
  /** Traps this player has added to a level, by type. */
  placed: Partial<Record<TrapType, number>>;
  /** Runs each trap has ended, by type. */
  deaths: Partial<Record<TrapType, number>>;
  /** Hints the player dismissed, which never return. */
  silenced: readonly HintId[];
  /** Times each hint has been shown, against HINT_MAX_SHOWS. */
  shows: Partial<Record<HintId, number>>;
  /**
   * The run count at the last hint. One card per run is the whole anti-nag
   * guarantee: dismissing a hint can never uncover the next one, and a player
   * who reads nothing still meets at most one card between two runs.
   */
  lastHintRun: number;
  /** The last few endings, oldest first. */
  recent: readonly RunEnding[];
}

export function defaultMemory(): CoachMemory {
  return {
    version: 1,
    toured: false,
    moved: false,
    jumped: false,
    usedReset: false,
    runs: 0,
    placed: {},
    deaths: {},
    silenced: [],
    shows: {},
    lastHintRun: -1,
    recent: [],
  };
}

// -------------------------------------------------------------------------
// Pure reducers.
// -------------------------------------------------------------------------

export function applyRunEnd(memory: CoachMemory, ending: RunEnding): CoachMemory {
  const progress = Number.isFinite(ending.progress)
    ? Math.min(1, Math.max(0, ending.progress))
    : 0;
  // A reset is a choice and a clear is not a death, so neither carries blame
  // even when a trap touched the runner on the way.
  const cause =
    ending.outcome === "reset" || ending.outcome === "completed"
      ? null
      : ending.cause;
  const next: CoachMemory = {
    ...memory,
    runs: memory.runs + 1,
    usedReset: memory.usedReset || ending.outcome === "reset",
    recent: [...memory.recent, { outcome: ending.outcome, progress, cause }].slice(
      -MAX_RECENT_ENDINGS,
    ),
  };
  if (cause)
    next.deaths = { ...memory.deaths, [cause]: (memory.deaths[cause] ?? 0) + 1 };
  return next;
}

export function applyTrapPlaced(memory: CoachMemory, type: TrapType): CoachMemory {
  return {
    ...memory,
    placed: { ...memory.placed, [type]: (memory.placed[type] ?? 0) + 1 },
  };
}

export function markMoved(memory: CoachMemory): CoachMemory {
  return memory.moved ? memory : { ...memory, moved: true };
}

export function markJumped(memory: CoachMemory): CoachMemory {
  return memory.jumped ? memory : { ...memory, jumped: true };
}

/** The tour is over: finished, or skipped, which are the same to everything else. */
export function markToured(memory: CoachMemory): CoachMemory {
  return memory.toured ? memory : { ...memory, toured: true };
}

export function silenceHint(memory: CoachMemory, id: HintId): CoachMemory {
  return memory.silenced.includes(id)
    ? memory
    : { ...memory, silenced: [...memory.silenced, id] };
}

export function noteHintShown(memory: CoachMemory, id: HintId): CoachMemory {
  return {
    ...memory,
    shows: { ...memory.shows, [id]: (memory.shows[id] ?? 0) + 1 },
    lastHintRun: memory.runs,
  };
}

/** Endings that were deaths, oldest first. Resets and clears are not deaths. */
function deaths(memory: CoachMemory): readonly RunEnding[] {
  return memory.recent.filter(
    (entry) => entry.outcome === "fell" || entry.outcome === "timeout",
  );
}

function lastThreeDeaths(memory: CoachMemory): readonly RunEnding[] {
  const all = deaths(memory);
  return all.length >= REPEAT_DEATHS ? all.slice(-REPEAT_DEATHS) : [];
}

function available(memory: CoachMemory, id: HintId): boolean {
  return !memory.silenced.includes(id) && (memory.shows[id] ?? 0) < HINT_MAX_SHOWS;
}

/**
 * The one thing worth saying, or nothing.
 *
 * Order is the order a player is hurt by not knowing. Every branch returns null
 * unless the player has demonstrated the gap, and silence is the expected
 * answer: a game that always finds something to say teaches you to stop reading
 * it. Nothing fires while the tour is unfinished, because the tour is already
 * teaching and two teachers is noise.
 */
export function chooseHint(memory: CoachMemory): CoachHint | null {
  if (!memory.toured) return null;
  if (memory.lastHintRun === memory.runs) return null;

  if (available(memory, "never-jumped") && memory.runs >= 3 && !memory.jumped)
    return {
      id: "never-jumped",
      title: "Space jumps.",
      body: `Three runs in and nothing has used it. Most gaps in this apartment need one, and you keep ${memory.runs} runs of practice either way.`,
      trap: null,
    };

  const recentDeaths = lastThreeDeaths(memory);

  if (available(memory, "repeat-trap") && recentDeaths.length === REPEAT_DEATHS) {
    const cause = recentDeaths[0]!.cause;
    if (cause && recentDeaths.every((entry) => entry.cause === cause))
      return {
        id: "repeat-trap",
        title: `${TRAP_CATALOG[cause].displayName} has ended your last three runs.`,
        body: `${TRAP_CATALOG[cause].shortDescription} Worth reading what it actually does before the next attempt.`,
        trap: cause,
      };
  }

  if (available(memory, "same-spot") && recentDeaths.length === REPEAT_DEATHS) {
    const values = recentDeaths.map((entry) => entry.progress);
    const low = Math.min(...values);
    const high = Math.max(...values);
    if (high - low <= SAME_SPOT_BAND) {
      const where = Math.round(((low + high) / 2) * 100);
      return {
        id: "same-spot",
        title: `Three runs have ended around ${where}%.`,
        body: "The same stretch each time. R restarts on the spot, so you can spend the next attempt on that stretch instead of on the run-up to it.",
        trap: null,
      };
    }
  }

  if (
    available(memory, "never-reset") &&
    memory.runs >= 4 &&
    !memory.usedReset &&
    deaths(memory).length >= 2
  )
    return {
      id: "never-reset",
      title: "R restarts the attempt.",
      body: "Instantly, and the game stamps it RESET rather than blaming you for a fall. A run that has already gone wrong costs you seconds instead of a minute.",
      trap: null,
    };

  return null;
}

// -------------------------------------------------------------------------
// What a trap is, in facts the player can check.
// -------------------------------------------------------------------------

/**
 * How each category reaches a runner. Written from the mechanic rather than the
 * name, and kept to what is true of every trap in the category.
 */
const METHOD: Record<TrapCategory, string> = {
  sweeper: "Sweeps a fixed path on its own clock, so it is beatable on timing.",
  movement: "Works on your footing rather than on you, and puts you where you did not aim.",
  prop: "A physical object parked in the lane. It has mass, and it reacts.",
};

export interface TrapProfile {
  type: TrapType;
  displayName: string;
  shortDescription: string;
  category: TrapCategory;
  /** How it reaches a runner, in plain words. */
  method: string;
  /** Traps in the roster this one out-hits, against the rest of the roster. */
  outHits: number;
  rosterSize: number;
  /** Share of the heaviest trap in the roster, for the bar. */
  dangerFill: number;
  /** Metres of clear floor the placement rules make it keep, as a diameter. */
  floorMetres: number;
  /** Runner widths that diameter comes to, which is the readable version of it. */
  runnerWidths: number;
}

/**
 * Everything the game can honestly tell a player about a trap before they meet
 * it, derived from the catalogue rather than written out per trap, so a roster
 * that doubles needs no new copy.
 *
 * `riskWeight` is the catalogue's measured hazard output and the only input to
 * the "you made it N% worse" score, so ranking on it tells the player the same
 * thing the reward screen will. `placementRadius` is what placement validation
 * actually enforces as clearance, so the floor figure is the rule rather than an
 * estimate of the model's size.
 */
export function trapProfile(type: TrapType): TrapProfile {
  const item = TRAP_CATALOG[type];
  const weights = TRAP_TYPES.map((entry) => TRAP_CATALOG[entry].riskWeight);
  const heaviest = Math.max(...weights);
  return {
    type,
    displayName: item.displayName,
    shortDescription: item.shortDescription,
    category: item.category,
    method: METHOD[item.category],
    outHits: weights.filter((weight) => weight < item.riskWeight).length,
    rosterSize: TRAP_TYPES.length,
    dangerFill: heaviest > 0 ? item.riskWeight / heaviest : 0,
    floorMetres: item.placementRadius * 2,
    runnerWidths: (item.placementRadius * 2) / (PLAYER.capsuleRadius * 2),
  };
}

// -------------------------------------------------------------------------
// Storage. Guarded, because it is absent on the server and throws in private mode.
// -------------------------------------------------------------------------

function storage(): Storage | null {
  try {
    // Undefined during server rendering, and the property access itself throws
    // in a browser configured to block storage, so both are caught here rather
    // than at the call sites.
    const value: Storage | undefined = globalThis.localStorage;
    return value ?? null;
  } catch {
    return null;
  }
}

/** Whether this browser will keep what it is given. Reading works in Safari's
 * private mode and writing throws, so only a probe write tells the truth. */
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

function flag(value: unknown): boolean {
  return value === true;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

/** A stored run index, which is -1 before any hint has been shown. */
function runIndex(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(-1, Math.floor(value))
    : -1;
}

/** A stored 0-to-1 fraction. Unlike `count` this keeps the decimal part. */
function fraction(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : 0;
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

const HINT_IDS: readonly HintId[] = [
  "never-jumped",
  "repeat-trap",
  "same-spot",
  "never-reset",
];

const OUTCOMES: readonly CoachRunOutcome[] = ["completed", "fell", "timeout", "reset"];

function readRecent(value: unknown): readonly RunEnding[] {
  if (!Array.isArray(value)) return [];
  const out: RunEnding[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const outcome = record["outcome"];
    if (typeof outcome !== "string") continue;
    if (!OUTCOMES.includes(outcome as CoachRunOutcome)) continue;
    const cause = record["cause"];
    out.push({
      outcome: outcome as CoachRunOutcome,
      progress: fraction(record["progress"]),
      cause:
        typeof cause === "string" && (TRAP_TYPES as readonly string[]).includes(cause)
          ? (cause as TrapType)
          : null,
    });
  }
  return out.slice(-MAX_RECENT_ENDINGS);
}

/**
 * Turn whatever is in storage into a usable memory. Anything unrecognised is
 * dropped field by field rather than rejected wholesale, so a memory written by
 * a later build loses only the parts this build does not understand.
 */
function normalize(value: unknown): CoachMemory {
  if (typeof value !== "object" || value === null) return defaultMemory();
  const source = value as Record<string, unknown>;
  if (source["version"] !== 1) return defaultMemory();
  const silenced = Array.isArray(source["silenced"])
    ? HINT_IDS.filter((id) => (source["silenced"] as unknown[]).includes(id))
    : [];
  return {
    version: 1,
    toured: flag(source["toured"]),
    moved: flag(source["moved"]),
    jumped: flag(source["jumped"]),
    usedReset: flag(source["usedReset"]),
    runs: count(source["runs"]),
    placed: readCounts(source["placed"], TRAP_TYPES),
    deaths: readCounts(source["deaths"], TRAP_TYPES),
    silenced,
    shows: readCounts(source["shows"], HINT_IDS),
    lastHintRun: runIndex(source["lastHintRun"]),
    recent: readRecent(source["recent"]),
  };
}

export function loadMemory(): CoachMemory {
  const store = storage();
  if (!store) return defaultMemory();
  try {
    const raw = store.getItem(COACH_STORAGE_KEY);
    return raw === null ? defaultMemory() : normalize(JSON.parse(raw));
  } catch {
    // Storage that throws on read, or a value that is not JSON. Either way the
    // player gets the tour rather than an error page.
    return defaultMemory();
  }
}

/** Returns false when the write did not stick. */
export function saveMemory(memory: CoachMemory): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(COACH_STORAGE_KEY, JSON.stringify(memory));
    return true;
  } catch {
    return false;
  }
}

// -------------------------------------------------------------------------
// The live copy. One per document, shared by every teaching component.
// -------------------------------------------------------------------------

/**
 * A stable object for `useSyncExternalStore` to hand back during server
 * rendering. It has to be the same reference on every call, and it has to be
 * what the first client render sees too, or the two disagree.
 */
const SERVER_MEMORY: CoachMemory = Object.freeze(defaultMemory());

let current: CoachMemory = SERVER_MEMORY;
let hydrated = false;
const listeners = new Set<() => void>();

function publish(next: CoachMemory): void {
  current = next;
  // The return value is deliberately unused. The live copy above is what every
  // component reads, so a browser that refuses to persist still gets a session
  // where the tour finishes and dismissed hints stay dismissed; all it loses is
  // that state surviving a reload, and there is nothing useful to say about it.
  saveMemory(next);
  for (const listener of listeners) listener();
}

export function getCoachMemory(): CoachMemory {
  return current;
}

export function getServerCoachMemory(): CoachMemory {
  return SERVER_MEMORY;
}

export function subscribeCoachMemory(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Read storage once, on the client, after the first render. Hydrating during
 * module evaluation would make the client's first render disagree with the
 * server's.
 */
export function hydrateCoachMemory(): void {
  if (hydrated) return;
  hydrated = true;
  current = loadMemory();
  for (const listener of listeners) listener();
}

/** Apply a reducer to the live memory and persist the result. */
export function updateCoachMemory(
  reduce: (memory: CoachMemory) => CoachMemory,
): void {
  const next = reduce(current);
  if (next !== current) publish(next);
}

/** Test seam, and the reset the game itself never needs. */
export function resetCoachMemory(): void {
  hydrated = false;
  current = SERVER_MEMORY;
  for (const listener of listeners) listener();
}

/** The live memory, hydrated from storage on mount. */
export function useCoachMemory(): CoachMemory {
  useEffect(() => hydrateCoachMemory(), []);
  return useSyncExternalStore(
    subscribeCoachMemory,
    getCoachMemory,
    getServerCoachMemory,
  );
}

// -------------------------------------------------------------------------
// The calls a host makes. One per event the game already knows about.
// -------------------------------------------------------------------------

/** Call once per run that reached an ending, from the same place the host
 * decides what to tell the player. */
export function recordRunEnd(ending: RunEnding): void {
  updateCoachMemory((memory) => applyRunEnd(memory, ending));
}

/** Call once per trap the player adds to a level. */
export function recordTrapPlaced(type: TrapType): void {
  updateCoachMemory((memory) => applyTrapPlaced(memory, type));
}
