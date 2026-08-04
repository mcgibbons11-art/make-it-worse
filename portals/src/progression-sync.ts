// Carries the progression ledger through the Portals per-player save.
//
// Local storage is the only place the ledger lived before this, and the
// processed Portals iframe does not promise to keep it: a different device, a
// different browser, or a partitioned storage reset all read as "times aren't
// being stored". The SDK's saveState/loadState pair is the host's durable
// 64 KB per-player store, so the ledger is mirrored through it whenever a
// signed-in player is available, with local storage staying authoritative for
// play outside a Portals host.
//
// The save is stored inside a named envelope ({ progression: ... }) and every
// write is read-modify-write against the envelope seen at start, so a future
// key added beside it survives this module's writes.

import {
  mergeStats,
  normalizeStats,
  type ProgressionStats,
} from "@/lib/game/progression";
import type { PortalsSdk } from "./leaderboard";

/** Trailing delay before a changed ledger is written to the host. */
export const LEDGER_SAVE_DEBOUNCE_MS = 2000;

export interface LedgerSyncHandle {
  /** Schedule the changed ledger for a debounced remote write. */
  push(stats: ProgressionStats): void;
  /** Write anything pending immediately; for pagehide, when no debounce can run. */
  flush(): Promise<void>;
  dispose(): void;
}

function isEnvelope(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reconcile the local ledger with the host's copy and keep the host current
 * from then on.
 *
 * Returns null when the host store is unreachable, which is the signed-out
 * case as well as the transient-failure case; the caller retries by starting
 * again when the player changes.
 */
export async function startLedgerSync(options: {
  sdk: PortalsSdk;
  local: ProgressionStats;
  /** Receives the merged ledger exactly once, before any remote write. */
  adopt(merged: ProgressionStats): void;
  debounceMs?: number;
}): Promise<LedgerSyncHandle | null> {
  const { sdk, local, adopt } = options;
  const debounceMs = options.debounceMs ?? LEDGER_SAVE_DEBOUNCE_MS;

  let envelope: Record<string, unknown>;
  let remote: ProgressionStats | null;
  try {
    const stored = await sdk.loadState();
    envelope = isEnvelope(stored) ? stored : {};
    remote = "progression" in envelope ? normalizeStats(envelope["progression"]) : null;
  } catch {
    return null;
  }

  const merged = remote ? mergeStats(local, remote) : local;
  if (remote) adopt(merged);

  let lastWritten = remote === null ? null : JSON.stringify(remote);
  let pending: ProgressionStats | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const write = async (): Promise<void> => {
    if (pending === null) return;
    const stats = pending;
    const serialized = JSON.stringify(stats);
    if (serialized === lastWritten) {
      pending = null;
      return;
    }
    try {
      envelope = { ...envelope, progression: stats };
      await sdk.saveState(envelope);
      lastWritten = serialized;
      pending = null;
    } catch (error) {
      // Left pending so the next push or flush retries the same ledger.
      console.warn("[progression-sync] save failed", error);
    }
  };

  const push = (stats: ProgressionStats): void => {
    if (disposed) return;
    pending = stats;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void write();
    }, debounceMs);
  };

  // The merged ledger goes up straight away: a device that only ever reads
  // this room would otherwise never contribute the history it carried in.
  push(merged);

  return {
    push,
    flush: async () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      await write();
    },
    dispose: () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
