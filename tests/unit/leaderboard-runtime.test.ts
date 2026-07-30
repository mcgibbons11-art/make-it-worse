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
      mode: "room-clean-000003",
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
    await expect(fetchClearTimes("room-abc123")).resolves.toEqual({ status: "unavailable" });
    await expect(submitClearTime("room-abc123", 12_000)).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("submits and reads a signed-in player's exact-room board", async () => {
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
    await expect(submitClearTime("clean-000003", 15_000)).resolves.toEqual({ status: "ok" });
    expect(sdk.submitScore).toHaveBeenCalledWith(
      clearTimeToScore(15_000),
      "room-clean-000003",
    );
    await expect(fetchClearTimes("clean-000003")).resolves.toEqual({
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
      mode: "room-clean-000003",
      limit: 10,
    });
  });

  it("requires a player login before submitting", async () => {
    const sdk = installSdk({ signedIn: false });
    const { submitClearTime } = await adapter();
    await expect(submitClearTime("clean-000002", 20_000)).resolves.toEqual({
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
    await fetchClearTimes("clean-000001", 500);
    expect(sdk.getLeaderboard).toHaveBeenLastCalledWith({
      mode: "room-clean-000001",
      limit: 100,
    });
    await fetchClearTimes("clean-000001", 0);
    expect(sdk.getLeaderboard).toHaveBeenLastCalledWith({
      mode: "room-clean-000001",
      limit: 1,
    });
  });

  it("keeps exact-room boards separate and deduplicates published-map activity", async () => {
    const sdk = installSdk();
    sdk.getLeaderboard.mockResolvedValueOnce({
      mode: "map-clean-000007",
      entries: [
        { rank: 1, playerId: "p1", displayName: "One", avatarUrl: null, score: 2 },
        { rank: 2, playerId: "p2", displayName: "Two", avatarUrl: null, score: 1 },
      ],
    });
    const {
      fetchPublishedMapPopularity,
      publishedMapMode,
      roomMode,
      submitPublishedMapSignal,
    } = await adapter();
    expect(roomMode("clean-000007")).toBe("room-clean-000007");
    expect(roomMode("clean-000008")).toBe("room-clean-000008");
    expect(publishedMapMode("clean-000007")).toBe("map-clean-000007");
    await expect(submitPublishedMapSignal("clean-000007", "start")).resolves.toEqual({ status: "ok" });
    await expect(submitPublishedMapSignal("clean-000007", "clear")).resolves.toEqual({ status: "ok" });
    expect(sdk.submitScore).toHaveBeenNthCalledWith(1, 1, "map-clean-000007");
    expect(sdk.submitScore).toHaveBeenNthCalledWith(2, 2, "map-clean-000007");
    await expect(fetchPublishedMapPopularity("clean-000007")).resolves.toEqual({
      status: "ok",
      uniquePlayers: 2,
      clears: 1,
      capped: false,
    });
  });
});
