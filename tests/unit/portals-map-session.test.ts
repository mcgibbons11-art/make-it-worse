import { afterEach, describe, expect, it, vi } from "vitest";
import { generateRandomRoom, runtimeMap } from "@/components/game/RoomBuilder";
import { encodeChallengeLink } from "@/lib/game/challenge-link";
import {
  MAP_SESSION_MAX_BYTES,
  MAP_SESSION_PROTOCOL,
  MAP_SESSION_STATE_KEY,
  connectMapSession,
  mapSessionWireBytes,
  parseMapSessionMessage,
  type MapAnnouncement,
} from "@/portals/src/map-session";

function announcement(seed: number): MapAnnouncement {
  const runtime = runtimeMap(generateRandomRoom(seed), seed, seed);
  return {
    kind: "miw-map-announcement",
    v: MAP_SESSION_PROTOCOL,
    mapId: runtime.challenge.chainSlug,
    versionId: runtime.challenge.slug,
    title: `Map ${seed}`,
    author: "Session builder",
    publishedAt: "2026-07-30T00:00:00.000Z",
    code: encodeChallengeLink(runtime.challenge, null, runtime.track),
  };
}

function installSdk(initialState: Record<string, unknown> = {}) {
  const handlers = {
    message: [] as Array<(data: unknown, fromId: string) => void>,
    state: [] as Array<(key: string, value: unknown) => void>,
    status: [] as Array<(status: string) => void>,
    playerjoin: [] as Array<(player: unknown, players: unknown[]) => void>,
  };
  const sent: unknown[] = [];
  const stateWrites: Array<[string, unknown]> = [];
  const net = {
    join: vi.fn(async () => ({
      self: { id: "self", playerId: "player", displayName: "Me", avatarUrl: null },
      players: [],
      state: initialState,
    })),
    leave: vi.fn(),
    send: vi.fn((value: unknown) => sent.push(value)),
    setState: vi.fn((key: string, value: unknown) => stateWrites.push([key, value])),
    getState: vi.fn(),
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
    ready: vi.fn(async () => ({ player: { playerId: "player", displayName: "Me", avatarUrl: null }, context: "room" as const })),
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
  return { handlers, net, sent, stateWrites };
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

describe("Portals same-session map protocol", () => {
  it("rejects unknown, malformed, and over-8-KB messages", () => {
    expect(parseMapSessionMessage(null)).toBeNull();
    expect(parseMapSessionMessage({ kind: "miw-map-request", v: 2, versionId: "map-1" })).toBeNull();
    const oversized = { ...announcement(1), code: "x".repeat(MAP_SESSION_MAX_BYTES) };
    expect(mapSessionWireBytes(oversized)).toBeGreaterThan(MAP_SESSION_MAX_BYTES);
    expect(parseMapSessionMessage(oversized)).toBeNull();
  });

  it("imports late-join state, announces a bounded map, and answers requests", async () => {
    const lateMap = announcement(21);
    const host = installSdk({ [MAP_SESSION_STATE_KEY]: lateMap });
    const received: string[] = [];
    const result = await connectMapSession((map) => { received.push(map.challenge.slug); });
    expect(result.status).toBe("ok");
    await Promise.resolve();
    expect(received).toEqual([lateMap.versionId]);
    if (result.status !== "ok") return;

    const runtime = runtimeMap(generateRandomRoom(22), 22, 22);
    expect(result.connection.announce({ challenge: runtime.challenge, track: runtime.track, avatar: null, title: "Shared room" })).toBe("sent");
    expect(host.stateWrites.at(-1)?.[0]).toBe(MAP_SESSION_STATE_KEY);
    expect(parseMapSessionMessage(host.sent.at(-1))).toMatchObject({ kind: "miw-map-announcement", versionId: runtime.challenge.slug });

    host.handlers.message[0]?.({ kind: "miw-map-request", v: MAP_SESSION_PROTOCOL, versionId: runtime.challenge.slug }, "peer");
    expect(parseMapSessionMessage(host.sent.at(-1))).toMatchObject({ kind: "miw-map-response", versionId: runtime.challenge.slug });

    host.handlers.playerjoin[0]?.(
      { id: "late-peer", playerId: "late-player", displayName: "Late player", avatarUrl: null },
      [],
    );
    expect(parseMapSessionMessage(host.sent.at(-1))).toMatchObject({
      kind: "miw-map-response",
      versionId: runtime.challenge.slug,
    });

    result.connection.close();
    expect(host.net.leave).toHaveBeenCalledOnce();
    expect(host.net.off).toHaveBeenCalledTimes(3);
  });

  it("resends validated shared state when a player joins after the publisher", async () => {
    const lateMap = announcement(23);
    const host = installSdk({ [MAP_SESSION_STATE_KEY]: lateMap });
    const result = await connectMapSession(vi.fn());
    expect(result.status).toBe("ok");

    host.handlers.playerjoin[0]?.(
      { id: "new-connection", playerId: null, displayName: null, avatarUrl: null },
      [],
    );

    expect(parseMapSessionMessage(host.sent.at(-1))).toMatchObject({
      kind: "miw-map-response",
      versionId: lateMap.versionId,
    });
  });

  it("ignores corrupted announcements without poisoning the session", async () => {
    const host = installSdk();
    const received = vi.fn();
    const result = await connectMapSession(received);
    expect(result.status).toBe("ok");
    host.handlers.message[0]?.({ ...announcement(30), code: "damaged" }, "peer");
    await Promise.resolve();
    expect(received).not.toHaveBeenCalled();
  });
});
