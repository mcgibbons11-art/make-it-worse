"use client";
import { create } from "zustand";
import {
  applyRunEnd,
  applyTrapPlaced,
  defaultStats,
  loadStats,
  saveStats,
  storageAvailable,
  type ProgressionStats,
  type RunRecord,
  type RunSummary,
} from "@/lib/game/progression";
import type { TrapType } from "@/lib/game/types";

/**
 * The live ledger.
 *
 * Deliberately not zustand's `persist` middleware, which the settings store
 * uses. Two reasons. Persist rehydrates during store creation, which on a page
 * that server-renders means the first client render can disagree with the
 * server's; hydrating from an effect keeps both sides on the defaults until the
 * browser is unambiguously in charge. And persist swallows a failed write, so
 * there would be no honest way to tell a player in a private-mode browser that
 * their ledger is session-only.
 *
 * The store keeps working when storage does not. Every number below lives in
 * memory first and is written out afterwards, so a browser that refuses to
 * persist loses the history and nothing else.
 */
interface ProgressionState {
  stats: ProgressionStats;
  /** False until storage has been read, so the first render matches the server. */
  hydrated: boolean;
  /** False when this browser will not keep the ledger. */
  persistent: boolean;
  /** The beat from the most recent run, for the result overlay to show. */
  lastSummary: RunSummary | null;
  hydrate(): void;
  recordRunEnd(run: Omit<RunRecord, "atMs">): RunSummary;
  /** Returns any traps the placement just earned, for the caller to announce. */
  recordTrapPlaced(type: TrapType): readonly TrapType[];
  /**
   * Replace the ledger with one reconciled against an outside copy, such as
   * the Portals per-player save. The caller merges; this only adopts and
   * writes through, so a sync can never bypass the local persistence rules.
   */
  adoptStats(stats: ProgressionStats): void;
  clearSummary(): void;
}

export const useProgressionStore = create<ProgressionState>()((set, get) => {
  /**
   * Read storage before the first write. A recording call that arrived before
   * any component mounted would otherwise save a ledger derived from the empty
   * defaults straight over the player's real history.
   */
  const ready = (): ProgressionStats => {
    if (!get().hydrated) {
      const stats = loadStats();
      set({ stats, persistent: storageAvailable(), hydrated: true });
      return stats;
    }
    return get().stats;
  };
  const commit = (stats: ProgressionStats): void => {
    const stored = saveStats(stats);
    set({ stats, ...(stored ? {} : { persistent: false }) });
  };
  return {
    stats: defaultStats(),
    hydrated: false,
    persistent: false,
    lastSummary: null,
    hydrate: () => {
      ready();
    },
    recordRunEnd: (run) => {
      const result = applyRunEnd(ready(), { ...run, atMs: Date.now() });
      commit(result.stats);
      set({ lastSummary: result.summary });
      return result.summary;
    },
    recordTrapPlaced: (type) => {
      const result = applyTrapPlaced(ready(), type);
      commit(result.stats);
      return result.unlocked;
    },
    adoptStats: (stats) => {
      // Hydrate first: adopting over the unread defaults would erase the very
      // history the caller just merged against.
      ready();
      commit(stats);
    },
    clearSummary: () => set({ lastSummary: null }),
  };
});
