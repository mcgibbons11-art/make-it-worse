// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

function installSdk(options?: { signedIn?: boolean; failReady?: boolean }) {
  const player = {
    playerId: options?.signedIn === false ? null : "player-1",
    displayName: "Runner",
    avatarUrl: null,
  };
  const sdk = {
    version: "1.0.0",
    ready: vi.fn(async () => {
      if (options?.failReady) throw new Error("host offline");
      return { player, context: "standalone" };
    }),
    getPlayer: vi.fn(async () => player),
    identity: {
      requestLogin: vi.fn(async () => player),
      onChange: vi.fn(() => () => undefined),
    },
    saveState: vi.fn(),
    loadState: vi.fn(),
    submitScore: vi.fn(async () => undefined),
    getLeaderboard: vi.fn(async () => ({
      mode: "depth-3",
      entries: [
        {
          rank: 1,
          playerId: "player-1",
          displayName: "Runner",
          avatarUrl: null,
          score: 45_001,
        },
      ],
    })),
    quit: vi.fn(),
  };
  Object.defineProperty(window, "Portals", {
    configurable: true,
    value: sdk,
  });
  return sdk;
}

async function adapter() {
  vi.resetModules();
  return import("@/portals/src/leaderboard");
}

afterEach(() => {
  Reflect.deleteProperty(window, "Portals");
  vi.restoreAllMocks();
});

describe("Portals leaderboard runtime adapter", () => {
  it("is a safe no-op on a plain URL with no injected SDK", async () => {
    const { connect, fetchClearTimes, submitClearTime } = await adapter();
    await expect(connect()).resolves.toEqual({ status: "unavailable" });
    await expect(fetchClearTimes(0)).resolves.toEqual({ status: "unavailable" });
    await expect(submitClearTime(0, 12_000)).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("submits and reads a signed-in player's depth board", async () => {
    const sdk = installSdk();
    const {
      clearTimeToScore,
      connect,
      fetchClearTimes,
      submitClearTime,
    } = await adapter();

    await expect(connect()).resolves.toMatchObject({
      status: "ok",
      player: { playerId: "player-1" },
    });
    await expect(submitClearTime(3, 15_000)).resolves.toEqual({ status: "ok" });
    expect(sdk.submitScore).toHaveBeenCalledWith(
      clearTimeToScore(15_000),
      "depth-3",
    );
    await expect(fetchClearTimes(3)).resolves.toEqual({
      status: "ok",
      entries: [
        {
          rank: 1,
          playerId: "player-1",
          displayName: "Runner",
          clearTimeMs: 15_000,
        },
      ],
    });
    expect(sdk.getLeaderboard).toHaveBeenCalledWith({
      mode: "depth-3",
      limit: 10,
    });
  });

  it("requires a player login before submitting", async () => {
    const sdk = installSdk({ signedIn: false });
    const { submitClearTime } = await adapter();
    await expect(submitClearTime(2, 20_000)).resolves.toEqual({
      status: "sign_in_required",
    });
    expect(sdk.submitScore).not.toHaveBeenCalled();
  });

  it("turns host failures into visible error results", async () => {
    installSdk({ failReady: true });
    const { connect } = await adapter();
    await expect(connect()).resolves.toEqual({
      status: "error",
      message: "host offline",
    });
  });

  it("keeps leaderboard limits inside the host's documented range", async () => {
    const sdk = installSdk();
    const { fetchClearTimes } = await adapter();
    await fetchClearTimes(1, 500);
    expect(sdk.getLeaderboard).toHaveBeenLastCalledWith({
      mode: "depth-1",
      limit: 100,
    });
    await fetchClearTimes(1, 0);
    expect(sdk.getLeaderboard).toHaveBeenLastCalledWith({
      mode: "depth-1",
      limit: 1,
    });
  });
});
