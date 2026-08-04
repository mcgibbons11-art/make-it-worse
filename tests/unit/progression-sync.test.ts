// The bridge between the progression ledger and the Portals per-player save.
// Times lived only in localStorage before this, which the processed iframe
// does not promise to keep; these tests pin the reconcile-then-mirror contract
// against a fake SDK so the real one is only trusted for what it documents.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyRunEnd,
  defaultStats,
  type ProgressionStats,
  type RunRecord,
} from "@/lib/game/progression";
import {
  LEDGER_SAVE_DEBOUNCE_MS,
  startLedgerSync,
} from "@/portals/src/progression-sync";
import type { PortalsSdk } from "@/portals/src/leaderboard";

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

function cleared(durationMs: number, atMs = 1_000): ProgressionStats {
  return applyRunEnd(defaultStats(), run({ durationMs, atMs })).stats;
}

/** Only loadState and saveState are exercised; the rest fail loudly if touched. */
function fakeSdk(options: {
  stored?: unknown;
  loadFails?: boolean;
  saveFails?: () => boolean;
}): { sdk: PortalsSdk; saves: unknown[] } {
  const saves: unknown[] = [];
  const reject = () => Promise.reject(new Error("not part of this test"));
  const sdk = {
    version: "test",
    ready: reject,
    getPlayer: reject,
    identity: { requestLogin: reject, onChange: () => () => undefined },
    submitScore: reject,
    getLeaderboard: reject,
    quit: () => undefined,
    loadState: <T,>(): Promise<T | null> =>
      options.loadFails
        ? Promise.reject(new Error("signed out"))
        : Promise.resolve((options.stored ?? null) as T | null),
    saveState: (data: unknown): Promise<void> => {
      if (options.saveFails?.()) return Promise.reject(new Error("host refused"));
      saves.push(data);
      return Promise.resolve();
    },
  } as unknown as PortalsSdk;
  return { sdk, saves };
}

async function drainDebounce(): Promise<void> {
  await vi.advanceTimersByTimeAsync(LEDGER_SAVE_DEBOUNCE_MS + 1);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("starting the sync", () => {
  it("returns null when the host store is unreachable, so the caller can retry", async () => {
    const { sdk } = fakeSdk({ loadFails: true });
    expect(
      await startLedgerSync({ sdk, local: defaultStats(), adopt: () => undefined }),
    ).toBeNull();
  });

  it("hands the merged ledger to the caller before any remote write", async () => {
    const remote = cleared(9_000, 2_000);
    const local = cleared(12_000, 1_000);
    const { sdk, saves } = fakeSdk({ stored: { progression: remote } });
    let adopted: ProgressionStats | null = null;
    await startLedgerSync({ sdk, local, adopt: (merged) => (adopted = merged) });
    expect(saves).toHaveLength(0);
    expect(adopted).not.toBeNull();
    expect(adopted!.bests["worse-abc"]?.timeMs).toBe(9_000);
  });

  it("does not adopt anything when the host had no ledger", async () => {
    const { sdk } = fakeSdk({ stored: null });
    const adopt = vi.fn();
    await startLedgerSync({ sdk, local: cleared(12_000), adopt });
    expect(adopt).not.toHaveBeenCalled();
  });

  it("uploads the local history a fresh host store has never seen", async () => {
    const local = cleared(12_000);
    const { sdk, saves } = fakeSdk({ stored: null });
    await startLedgerSync({ sdk, local, adopt: () => undefined });
    await drainDebounce();
    expect(saves).toHaveLength(1);
    const envelope = saves[0] as { progression: ProgressionStats };
    expect(envelope.progression.bests["worse-abc"]?.timeMs).toBe(12_000);
  });

  it("skips the write when the merge changed nothing the host does not know", async () => {
    const remote = cleared(9_000);
    const { sdk, saves } = fakeSdk({ stored: { progression: remote } });
    await startLedgerSync({ sdk, local: defaultStats(), adopt: () => undefined });
    await drainDebounce();
    expect(saves).toHaveLength(0);
  });
});

describe("mirroring later runs", () => {
  it("debounces pushes and writes only the newest ledger", async () => {
    const { sdk, saves } = fakeSdk({ stored: null });
    const handle = await startLedgerSync({
      sdk,
      local: defaultStats(),
      adopt: () => undefined,
    });
    handle!.push(cleared(15_000));
    handle!.push(cleared(9_000));
    await drainDebounce();
    expect(saves).toHaveLength(1);
    const envelope = saves[0] as { progression: ProgressionStats };
    expect(envelope.progression.bests["worse-abc"]?.timeMs).toBe(9_000);
  });

  it("preserves unrelated keys already in the host envelope", async () => {
    const { sdk, saves } = fakeSdk({
      stored: { progression: cleared(9_000), futureFeature: { keep: true } },
    });
    const handle = await startLedgerSync({
      sdk,
      local: defaultStats(),
      adopt: () => undefined,
    });
    handle!.push(cleared(7_000, 3_000));
    await drainDebounce();
    expect(saves).toHaveLength(1);
    expect((saves[0] as Record<string, unknown>)["futureFeature"]).toEqual({ keep: true });
  });

  it("retries a failed write on flush instead of losing the ledger", async () => {
    let failNext = true;
    const { sdk, saves } = fakeSdk({ stored: null, saveFails: () => failNext });
    const handle = await startLedgerSync({
      sdk,
      local: cleared(12_000),
      adopt: () => undefined,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await drainDebounce();
    expect(saves).toHaveLength(0);
    failNext = false;
    await handle!.flush();
    warn.mockRestore();
    expect(saves).toHaveLength(1);
  });

  it("stops writing after dispose", async () => {
    const { sdk, saves } = fakeSdk({ stored: null });
    const handle = await startLedgerSync({
      sdk,
      local: defaultStats(),
      adopt: () => undefined,
    });
    handle!.dispose();
    handle!.push(cleared(9_000));
    await drainDebounce();
    expect(saves).toHaveLength(0);
  });
});
