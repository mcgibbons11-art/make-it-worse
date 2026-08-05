// Transport behaviors for the duel lobby and channel, driven through the same
// mocked-SDK harness portals-map-session.test.ts uses. The mock exposes the
// handler arrays so the tests can fire the events Portals would.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DUEL_MATCH_KEY,
  DUEL_PROTOCOL,
  DUEL_STATE_POLL_MS,
  createMatch,
  joinMatch,
  lobbyPostKey,
  type DuelMatch,
} from "@/portals/src/duel/duel-protocol";
import {
  connectDuelChannel,
  connectDuelLobby,
  duelToken,
  resetDuelTokenForTests,
} from "@/portals/src/duel/duel-session";

function installSdk(initialState: Record<string, unknown> = {}) {
  const handlers = {
    message: [] as Array<(data: unknown, fromId: string) => void>,
    state: [] as Array<(key: string, value: unknown) => void>,
    status: [] as Array<(status: string) => void>,
    playerjoin: [] as Array<(player: unknown, players: unknown[]) => void>,
    playerleave: [] as Array<(player: unknown, players: unknown[]) => void>,
  };
  const sent: unknown[] = [];
  const sharedState = { ...initialState };
  const net = {
    join: vi.fn(async () => ({
      self: { id: "self", playerId: "player", displayName: "Me", avatarUrl: null },
      players: [
        { id: "self", playerId: "player", displayName: "Me", avatarUrl: null },
        { id: "peer", playerId: null, displayName: "Peer", avatarUrl: null },
      ],
      state: { ...sharedState },
    })),
    leave: vi.fn(),
    send: vi.fn((value: unknown) => sent.push(value)),
    setState: vi.fn((key: string, value: unknown) => {
      sharedState[key] = value;
    }),
    getState: vi.fn((key?: string) => (key ? sharedState[key] : { ...sharedState })),
    players: vi.fn(() => []),
    self: vi.fn(() => ({ id: "self", playerId: "player", displayName: "Me", avatarUrl: null })),
    on: vi.fn((event: keyof typeof handlers, handler: never) => handlers[event].push(handler)),
    off: vi.fn((event: keyof typeof handlers, handler: never) => {
      const index = handlers[event].indexOf(handler);
      if (index >= 0) handlers[event].splice(index, 1);
    }),
  };
  const sdk = {
    version: "test",
    ready: vi.fn(async () => ({
      player: { playerId: "player", displayName: "Me", avatarUrl: null },
      context: "room" as const,
    })),
    getPlayer: vi.fn(),
    identity: { requestLogin: vi.fn(), onChange: vi.fn() },
    saveState: vi.fn(),
    loadState: vi.fn(),
    submitScore: vi.fn(),
    getLeaderboard: vi.fn(),
    quit: vi.fn(),
    net,
  };
  Object.defineProperty(globalThis, "window", { value: { Portals: sdk }, configurable: true });
  return { handlers, net, sent, sharedState };
}

function lobbyHandlers() {
  return {
    onPosts: vi.fn(),
    onClaim: vi.fn(),
    onAccept: vi.fn(),
    onDeny: vi.fn(),
    onStatus: vi.fn(),
    onReferee: vi.fn(),
  };
}

function channelHandlers() {
  return {
    onMatch: vi.fn(),
    onMessage: vi.fn(),
    onPeerJoin: vi.fn(),
    onPeerLeave: vi.fn(),
    onStatus: vi.fn(),
    onReferee: vi.fn(),
  };
}

function seededMatch(): DuelMatch {
  return joinMatch(
    createMatch({ token: "tok-a", connId: "conn-a", name: "Ava", avatarCode: null }, 1_000),
    { token: "tok-b", connId: "conn-b", name: "Bo", avatarCode: null },
  )!;
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
  vi.useRealTimers();
});

describe("duel identity", () => {
  it("persists the token in window.name and recovers it after a reload", () => {
    // window.name is per-frame and reload-surviving, which is what keeps the
    // editor's same-origin 2p preview panes DISTINCT players: shared web
    // storage had made both panes seat A.
    resetDuelTokenForTests();
    Object.defineProperty(globalThis, "window", {
      value: { name: "" },
      configurable: true,
    });
    try {
      const first = duelToken();
      expect(first.length).toBeGreaterThanOrEqual(8);
      expect((globalThis.window as { name: string }).name).toContain(first);
      expect(duelToken()).toBe(first);
      // A reload drops the module cache but keeps window.name.
      resetDuelTokenForTests();
      expect(duelToken()).toBe(first);
    } finally {
      Reflect.deleteProperty(globalThis, "window");
      resetDuelTokenForTests();
    }
  });

  it("leaves a platform-owned window.name alone and still mints a token", () => {
    resetDuelTokenForTests();
    Object.defineProperty(globalThis, "window", {
      value: { name: "platform-routing-data" },
      configurable: true,
    });
    try {
      const token = duelToken();
      expect(token.length).toBeGreaterThanOrEqual(8);
      expect((globalThis.window as { name: string }).name).toBe("platform-routing-data");
      expect(duelToken()).toBe(token);
    } finally {
      Reflect.deleteProperty(globalThis, "window");
      resetDuelTokenForTests();
    }
  });
});

describe("duel lobby", () => {
  it("surfaces live posts from the join snapshot, hiding its own and stale ones", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const post = (connId: string, heartbeatAt: number) => ({
      v: DUEL_PROTOCOL, connId, name: "P", avatarCode: null, note: "", createdAt: heartbeatAt, heartbeatAt,
    });
    installSdk({
      [lobbyPostKey("other")]: post("other", 95_000),
      [lobbyPostKey("self")]: post("self", 95_000),
      [lobbyPostKey("ghost")]: post("ghost", 1_000),
      "unrelated-key": { hello: 1 },
    });
    const handlers = lobbyHandlers();
    const result = await connectDuelLobby(handlers);
    expect(result.status).toBe("ok");
    const latest = handlers.onPosts.mock.calls.at(-1)?.[0];
    expect(latest.map((entry: { connId: string }) => entry.connId)).toEqual(["other"]);
    if (result.status === "ok") await result.connection.close();
  });

  it("posts with heartbeats, routes claims, and clears the post on close", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const host = installSdk();
    const handlers = lobbyHandlers();
    const result = await connectDuelLobby(handlers);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    result.connection.post({ name: "Me", avatarCode: null, note: "come lose" });
    expect(host.sharedState[lobbyPostKey("self")]).toMatchObject({ note: "come lose" });
    await vi.advanceTimersByTimeAsync(21_000);
    expect((host.sharedState[lobbyPostKey("self")] as { heartbeatAt: number }).heartbeatAt).toBeGreaterThan(100_000);

    // A claim addressed to us reaches the arbitration handler with the
    // claimant's announced name; noise does not. A nameless claim from an
    // older build still arrives, as null.
    host.handlers.message[0]?.({ k: "duel-claim", v: DUEL_PROTOCOL, to: "self", name: "Ava" }, "peer");
    host.handlers.message[0]?.({ k: "duel-claim", v: DUEL_PROTOCOL, to: "someone-else", name: "Ava" }, "peer");
    expect(handlers.onClaim).toHaveBeenCalledExactlyOnceWith("peer", "Ava");
    host.handlers.message[0]?.({ k: "duel-claim", v: DUEL_PROTOCOL, to: "self" }, "peer");
    expect(handlers.onClaim).toHaveBeenLastCalledWith("peer", null);

    result.connection.accept("peer", "AB23");
    expect(host.sent.at(-1)).toMatchObject({ k: "duel-accept", to: "peer", code: "AB23" });

    host.handlers.message[0]?.({ k: "duel-accept", v: DUEL_PROTOCOL, to: "self", code: "cd45" }, "poster");
    expect(handlers.onAccept).toHaveBeenCalledExactlyOnceWith("CD45");
    host.handlers.message[0]?.({ k: "duel-deny", v: DUEL_PROTOCOL, to: "self", reason: "taken" }, "poster");
    expect(handlers.onDeny).toHaveBeenCalledExactlyOnceWith("taken");

    await result.connection.close();
    expect(host.sharedState[lobbyPostKey("self")]).toBeNull();
    expect(host.net.leave).toHaveBeenCalledOnce();
  });

  it("picks up a new post through the state event and the poll fallback", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const host = installSdk();
    const handlers = lobbyHandlers();
    const result = await connectDuelLobby(handlers);
    expect(result.status).toBe("ok");

    const arrival = {
      v: DUEL_PROTOCOL, connId: "walker", name: "W", avatarCode: null, note: "1v1 me",
      createdAt: 100_000, heartbeatAt: 100_000,
    };
    host.handlers.state[0]?.(lobbyPostKey("walker"), arrival);
    expect(handlers.onPosts.mock.calls.at(-1)?.[0]).toMatchObject([{ connId: "walker" }]);

    // A write that never fired a state event still lands via the mirror poll.
    host.sharedState[lobbyPostKey("silent")] = { ...arrival, connId: "silent" };
    await vi.advanceTimersByTimeAsync(DUEL_STATE_POLL_MS);
    const seen = handlers.onPosts.mock.calls.at(-1)?.[0].map((entry: { connId: string }) => entry.connId);
    expect(seen).toContain("silent");
    if (result.status === "ok") await result.connection.close();
  });
});

describe("duel channel", () => {
  it("imports the join-snapshot match, guards seq, and publishes bounded records", async () => {
    const match = seededMatch();
    const host = installSdk({ [DUEL_MATCH_KEY]: match });
    const handlers = channelHandlers();
    const result = await connectDuelChannel("AB23", handlers);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(host.net.join).toHaveBeenCalledWith({ channel: "duel:ab23" });
    expect(handlers.onMatch).toHaveBeenCalledExactlyOnceWith(match);
    expect(result.peers.map((peer) => peer.id)).toEqual(["peer"]);

    // An older or equal record off the wire is noise; a newer one lands.
    host.handlers.state[0]?.(DUEL_MATCH_KEY, match);
    expect(handlers.onMatch).toHaveBeenCalledOnce();
    const newer = { ...match, seq: match.seq + 1 };
    host.handlers.state[0]?.(DUEL_MATCH_KEY, newer);
    expect(handlers.onMatch).toHaveBeenCalledTimes(2);

    expect(result.connection.publishMatch({ ...newer, seq: newer.seq + 1 })).toBe("sent");
    expect((host.sharedState[DUEL_MATCH_KEY] as DuelMatch).seq).toBe(newer.seq + 1);
    const bloated = { ...newer, courseCode: "x".repeat(9_000) };
    expect(result.connection.publishMatch(bloated)).toBe("too_large");

    await result.connection.close();
    expect(host.net.leave).toHaveBeenCalledOnce();
  });

  it("routes peer traffic but never echoes of itself, and filters roster events", async () => {
    const host = installSdk();
    const handlers = channelHandlers();
    const result = await connectDuelChannel("AB23", handlers);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    const pos = { k: "pos", v: DUEL_PROTOCOL, x: 1, y: 2, z: 3, yaw: 0, flags: 0 };
    host.handlers.message[0]?.(pos, "peer");
    host.handlers.message[0]?.(pos, "self");
    host.handlers.message[0]?.({ garbage: true }, "peer");
    expect(handlers.onMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ k: "pos" }), "peer");

    host.handlers.playerjoin[0]?.({ id: "peer2", playerId: null, displayName: null, avatarUrl: null }, []);
    host.handlers.playerjoin[0]?.({ id: "self", playerId: "player", displayName: "Me", avatarUrl: null }, []);
    expect(handlers.onPeerJoin).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "peer2" }));
    host.handlers.playerleave[0]?.({ id: "peer2", playerId: null, displayName: null, avatarUrl: null }, []);
    expect(handlers.onPeerLeave).toHaveBeenCalledOnce();

    result.connection.send({ k: "chat", v: DUEL_PROTOCOL, text: "gg" });
    expect(host.sent.at(-1)).toMatchObject({ k: "chat", text: "gg" });
    await result.connection.close();
  });

  it("recovers a missed match write through the state mirror poll", async () => {
    vi.useFakeTimers();
    const host = installSdk();
    const handlers = channelHandlers();
    const result = await connectDuelChannel("AB23", handlers);
    expect(result.status).toBe("ok");

    host.sharedState[DUEL_MATCH_KEY] = seededMatch();
    await vi.advanceTimersByTimeAsync(DUEL_STATE_POLL_MS);
    expect(handlers.onMatch).toHaveBeenCalledOnce();
    if (result.status === "ok") await result.connection.close();
  });

  it("reports unavailable outside a processed Portals build", async () => {
    expect((await connectDuelChannel("AB23", channelHandlers())).status).toBe("unavailable");
    expect((await connectDuelLobby(lobbyHandlers())).status).toBe("unavailable");
  });
});
