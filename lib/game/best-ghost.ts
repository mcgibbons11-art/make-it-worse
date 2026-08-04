// The rabbit you actually want to chase: the trace of YOUR fastest clear of
// each room, kept beside the ledger so every later attempt can race it.
//
// Deliberately NOT part of the progression ledger: traces are three orders of
// magnitude bigger than a personal best row, and the ledger mirrors through
// the Portals per-player save with its 64 KB ceiling. A ghost that stays on
// this device is worth more than a ledger that stops fitting.

import { ghostTraceSchema } from "./schemas";
import type { GhostTrace } from "./types";

export const BEST_GHOST_STORAGE_KEY = "miw-best-ghosts-v1";

/** Rooms kept before the oldest-raced falls off. Traces are a few KB each. */
export const MAX_TRACKED_GHOSTS = 40;

export interface BestGhost {
  /** The clear this trace belongs to, so a slower run never overwrites it. */
  timeMs: number;
  /** encodeGhostTrace output, replayable by GhostRunner as-is. */
  trace: GhostTrace;
  /** Wall clock of the save, used only to decide what to evict. */
  atMs: number;
}

type GhostTable = Record<string, BestGhost>;

function storage(): Storage | null {
  try {
    const value: Storage | undefined = globalThis.localStorage;
    return value ?? null;
  } catch {
    return null;
  }
}

function readTable(store: Storage): GhostTable {
  try {
    const raw = store.getItem(BEST_GHOST_STORAGE_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: GhostTable = {};
    for (const [slug, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof entry !== "object" || entry === null) continue;
      const record = entry as Record<string, unknown>;
      // The trace is held to the same schema the repository holds link traces
      // to: a hand-edited entry becomes an absent ghost, never a crash inside
      // the replay loop mid-run.
      const trace = ghostTraceSchema.safeParse(record["trace"]);
      if (
        typeof record["timeMs"] === "number" &&
        Number.isFinite(record["timeMs"]) &&
        record["timeMs"] > 0 &&
        trace.success
      ) {
        out[slug] = {
          timeMs: record["timeMs"],
          trace: trace.data,
          atMs:
            typeof record["atMs"] === "number" && Number.isFinite(record["atMs"])
              ? record["atMs"]
              : 0,
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function prune(table: GhostTable): GhostTable {
  const entries = Object.entries(table);
  if (entries.length <= MAX_TRACKED_GHOSTS) return table;
  return Object.fromEntries(
    entries.sort((a, b) => b[1].atMs - a[1].atMs).slice(0, MAX_TRACKED_GHOSTS),
  );
}

/** Your fastest recorded run of this room, or null when you have none. */
export function loadBestGhost(challengeSlug: string): BestGhost | null {
  const store = storage();
  if (!store) return null;
  return readTable(store)[challengeSlug] ?? null;
}

/**
 * Keep this run's trace when it is the fastest seen for the room. Returns
 * whether the ghost is now this run, so a caller can say so.
 */
export function saveBestGhost(
  challengeSlug: string,
  timeMs: number,
  trace: GhostTrace,
  atMs = Date.now(),
): boolean {
  if (!Number.isFinite(timeMs) || timeMs <= 0 || trace.frames.length === 0) return false;
  const store = storage();
  if (!store) return false;
  const table = readTable(store);
  const current = table[challengeSlug];
  if (current && current.timeMs <= timeMs) return false;
  const next = prune({
    ...table,
    [challengeSlug]: { timeMs, trace, atMs },
  });
  try {
    store.setItem(BEST_GHOST_STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}
