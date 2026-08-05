// The Duel Mode lobby referee, tested two ways.
//
// First against the module directly, with an injected host, which is where
// every seating rule is asserted. Then against the ACTUAL compiled
// portals/dist/server.js, executed inside a sandbox that emulates the
// documented `server` global and enforces the documented sandbox rules - no
// import/require, no DOM, no network, a frozen global. The second half is the
// one that catches a build that emitted something Portals could not run,
// which no amount of testing the TypeScript would find.
//
// It cannot prove Portals runs the file at all: nothing local can, because
// the documentation never covers whether a GitHub-synced bundle gets its
// server script. That question is answered by the "referee online" line in a
// real session, and every rule here is written so the answer being "no"
// costs nothing.

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createReferee, parseClaim, REFEREE_BUILD } from "@/portals/server/referee";
import {
  DUEL_MATCH_KEY,
  DUEL_PROTOCOL,
  MAX_DUEL_PLAYERS,
  REFEREE_STATE_KEY,
  createMatch,
  joinMatch,
  startMatch,
  type DuelPlayer,
  type RefereeLobby,
} from "@/portals/src/duel/duel-protocol";

/** A faithful stand-in for the frozen `server` global. */
function fakeHost() {
  const state = new Map<string, unknown>();
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  let roster: { id: string }[] = [];
  const writes: string[] = [];
  const host = {
    setState(key: string, value: unknown) {
      // The platform rejects client writes to `server:`; nothing rejects the
      // server's own, but every key it writes must be inside that namespace
      // or it would be forgeable. Asserted rather than assumed.
      writes.push(key);
      state.set(key, JSON.parse(JSON.stringify(value)));
    },
    getState(key?: string) {
      return key === undefined ? Object.fromEntries(state) : state.get(key);
    },
    players: () => roster,
    on(event: string, handler: (...args: never[]) => void) {
      handlers.set(event, [
        ...(handlers.get(event) ?? []),
        handler as unknown as (...args: unknown[]) => void,
      ]);
    },
    send: vi.fn(),
    kick: vi.fn(),
  };
  return {
    host,
    writes,
    lobby: () => state.get(REFEREE_STATE_KEY) as RefereeLobby | undefined,
    emit(event: string, ...args: unknown[]) {
      for (const handler of handlers.get(event) ?? []) handler(...args);
    },
    setRoster(next: { id: string }[]) {
      roster = next;
    },
  };
}

const seatClaim = (
  token: string,
  name: string,
  avatarCode: string | null = null,
  seat: string | null = null,
) => ({
  k: "seat",
  v: DUEL_PROTOCOL,
  token,
  name,
  avatarCode,
  seat,
});

const player = (token: string, name: string): DuelPlayer => ({
  token,
  connId: `conn-${token}`,
  name,
  avatarCode: null,
});

/** A match record as the clients would have published it. */
function record(tokens: string[], started = false) {
  let match = createMatch(player(tokens[0]!, tokens[0]!.toUpperCase()), 1_700_000_000_000);
  for (const token of tokens.slice(1))
    match = joinMatch(match, player(token, token.toUpperCase()))!;
  return started ? startMatch(match, 1_700_000_000_000)! : match;
}

describe("the lobby referee's rules", () => {
  it("announces an empty lobby immediately, so absent and silent are different", () => {
    const world = fakeHost();
    createReferee(world.host);
    expect(world.lobby()).toMatchObject({ build: REFEREE_BUILD, seats: [], started: false });
    // Everything it publishes lives in the namespace clients cannot forge.
    expect(world.writes.every((key) => key.startsWith("server:"))).toBe(true);
  });

  it("assigns seats in arrival order, which is the race four seats introduced", () => {
    const world = fakeHost();
    createReferee(world.host);
    world.emit("message", seatClaim("tok-a", "Ava"), "conn-a");
    world.emit("message", seatClaim("tok-b", "Bo"), "conn-b");
    world.emit("message", seatClaim("tok-c", "Cyd"), "conn-c");
    expect(world.lobby()!.seats.map((seat) => seat.seat)).toEqual(["a", "b", "c"]);
    expect(world.lobby()!.seats.map((seat) => seat.name)).toEqual(["Ava", "Bo", "Cyd"]);
  });

  it("gives simultaneous claimants different seats, never the same one", () => {
    // The whole point of a referee. Three clients that each read the same
    // empty lobby and claim at once are three separate messages here, and a
    // single writer cannot hand out one seat twice.
    const world = fakeHost();
    createReferee(world.host);
    for (const [token, conn] of [["t1", "c1"], ["t2", "c2"], ["t3", "c3"]] as const)
      world.emit("message", seatClaim(token, token), conn);
    const seats = world.lobby()!.seats.map((seat) => seat.seat);
    expect(new Set(seats).size).toBe(seats.length);
  });

  it("fills to four and then refuses, silently", () => {
    const world = fakeHost();
    createReferee(world.host);
    for (let index = 0; index < MAX_DUEL_PLAYERS + 2; index += 1)
      world.emit("message", seatClaim(`tok-${index}`, `P${index}`), `conn-${index}`);
    expect(world.lobby()!.seats).toHaveLength(MAX_DUEL_PLAYERS);
  });

  it("keeps a token's seat across a rejoin, moving only the connection", () => {
    const world = fakeHost();
    createReferee(world.host);
    world.emit("message", seatClaim("tok-a", "Ava"), "conn-a");
    world.emit("message", seatClaim("tok-b", "Bo"), "conn-b");
    // Bo reloads: same token, fresh connection id, new outfit.
    world.emit("message", seatClaim("tok-b", "Bo", "XYZ"), "conn-b2");
    const bo = world.lobby()!.seats.find((seat) => seat.token === "tok-b")!;
    expect(bo.seat).toBe("b");
    expect(bo.connId).toBe("conn-b2");
    expect(bo.avatarCode).toBe("XYZ");
    expect(world.lobby()!.seats).toHaveLength(2);
  });

  it("frees a seat when someone leaves before the start, and holds it after", () => {
    const world = fakeHost();
    createReferee(world.host);
    world.emit("message", seatClaim("tok-a", "Ava"), "conn-a");
    world.emit("message", seatClaim("tok-b", "Bo"), "conn-b");
    world.emit("playerleave", { id: "conn-b" }, []);
    expect(world.lobby()!.seats).toHaveLength(1);

    world.emit("message", seatClaim("tok-c", "Cyd"), "conn-c");
    world.emit("message", { k: "start", v: DUEL_PROTOCOL, token: "tok-a" }, "conn-a");
    expect(world.lobby()!.started).toBe(true);
    // After the start a departure is a retirement the match record owns.
    // Freeing the seat here would let a stranger take the place of a player
    // who is only reloading.
    world.emit("playerleave", { id: "conn-c" }, []);
    expect(world.lobby()!.seats).toHaveLength(2);
  });

  it("lets only the seat-A token start, and only with company", () => {
    const world = fakeHost();
    createReferee(world.host);
    world.emit("message", seatClaim("tok-a", "Ava"), "conn-a");
    // Alone is not a duel.
    world.emit("message", { k: "start", v: DUEL_PROTOCOL, token: "tok-a" }, "conn-a");
    expect(world.lobby()!.started).toBe(false);

    world.emit("message", seatClaim("tok-b", "Bo"), "conn-b");
    // A guest cannot start the host's lobby, nor can an unknown token.
    world.emit("message", { k: "start", v: DUEL_PROTOCOL, token: "tok-b" }, "conn-b");
    world.emit("message", { k: "start", v: DUEL_PROTOCOL, token: "nobody" }, "conn-x");
    expect(world.lobby()!.started).toBe(false);

    world.emit("message", { k: "start", v: DUEL_PROTOCOL, token: "tok-a" }, "conn-a");
    expect(world.lobby()!.started).toBe(true);
    expect(world.lobby()!.startedAt).toBeGreaterThan(0);
  });

  it("closes the lobby at the start, so nobody arrives mid-round", () => {
    const world = fakeHost();
    createReferee(world.host);
    world.emit("message", seatClaim("tok-a", "Ava"), "conn-a");
    world.emit("message", seatClaim("tok-b", "Bo"), "conn-b");
    world.emit("message", { k: "start", v: DUEL_PROTOCOL, token: "tok-a" }, "conn-a");
    world.emit("message", seatClaim("tok-c", "Cyd"), "conn-c");
    expect(world.lobby()!.seats).toHaveLength(2);
    // A player already seated may still reconnect after the start.
    world.emit("message", seatClaim("tok-b", "Bo"), "conn-b2");
    expect(world.lobby()!.seats.find((s) => s.token === "tok-b")!.connId).toBe("conn-b2");
  });

  it("refuses malformed and hostile claims without throwing", () => {
    expect(parseClaim(null)).toBeNull();
    expect(parseClaim({ k: "seat", v: 1, token: "t", name: "n", avatarCode: null })).toBeNull();
    expect(parseClaim({ k: "seat", v: DUEL_PROTOCOL, token: "", name: "n", avatarCode: null })).toBeNull();
    expect(parseClaim({ k: "seat", v: DUEL_PROTOCOL, token: "t".repeat(200), name: "n", avatarCode: null })).toBeNull();
    expect(parseClaim({ k: "seat", v: DUEL_PROTOCOL, token: "t", name: "n".repeat(99), avatarCode: null })).toBeNull();
    expect(parseClaim({ k: "nonsense", v: DUEL_PROTOCOL, token: "t" })).toBeNull();
    expect(parseClaim({ k: "start", v: DUEL_PROTOCOL, token: "t" })).toEqual({
      k: "start", v: DUEL_PROTOCOL, token: "t",
    });

    const world = fakeHost();
    createReferee(world.host);
    for (const junk of [null, 42, "hello", {}, { k: "seat" }, { k: "seat", v: 99 }])
      expect(() => world.emit("message", junk, "conn-x")).not.toThrow();
    expect(world.lobby()!.seats).toHaveLength(0);
  });

  it("does not republish when a rejoin changes nothing", () => {
    // Every write costs a state write against the documented ~30/s budget.
    const world = fakeHost();
    createReferee(world.host);
    world.emit("message", seatClaim("tok-a", "Ava"), "conn-a");
    const before = world.writes.length;
    world.emit("message", seatClaim("tok-a", "Ava"), "conn-a");
    expect(world.writes.length).toBe(before);
  });
});

describe("a replacement server picking up a session in progress", () => {
  // The documented lifecycle makes this ordinary rather than exotic:
  // publishing swaps a running server within seconds, an empty session ends
  // its server after about five minutes, and a crashed script leaves the
  // session running without one. Whatever starts next has no memory, so it
  // has to rebuild from what outlived it.

  it("rebuilds its seating from the match record it finds waiting", () => {
    const world = fakeHost();
    world.host.setState(DUEL_MATCH_KEY, record(["tok-a", "tok-b", "tok-c"]));
    createReferee(world.host);
    const lobby = world.lobby()!;
    expect(lobby.seats.map((seat) => seat.seat)).toEqual(["a", "b", "c"]);
    expect(lobby.seats.map((seat) => seat.token)).toEqual(["tok-a", "tok-b", "tok-c"]);
    // And the seat it hands the next arrival is the one actually free.
    world.emit("message", seatClaim("tok-d", "Dez"), "conn-d");
    expect(world.lobby()!.seats.find((seat) => seat.token === "tok-d")!.seat).toBe("d");
  });

  it("closes its lobby for a match the record says already started", () => {
    const world = fakeHost();
    world.host.setState(DUEL_MATCH_KEY, record(["tok-a", "tok-b"], true));
    createReferee(world.host);
    expect(world.lobby()!.started).toBe(true);
    // Nobody joins a match in progress, however new this server is to it.
    world.emit("message", seatClaim("tok-c", "Cyd"), "conn-c");
    expect(world.lobby()!.seats).toHaveLength(2);
  });

  it("takes the record's word for a seat it does not know, and never for one it does", () => {
    const world = fakeHost();
    createReferee(world.host);
    world.emit("message", seatClaim("tok-a", "Ava"), "conn-a");
    // A record that disagrees about a seated token changes nothing: this
    // server assigned that seat, and a record can lag its own writers.
    world.emit("state", DUEL_MATCH_KEY, record(["tok-x", "tok-a"]));
    const lobby = world.lobby()!;
    expect(lobby.seats.find((seat) => seat.token === "tok-a")!.seat).toBe("a");
    // The token it had never heard of is adopted into the seat the record
    // gives it - except seat A is taken, so it is simply not seated here.
    expect(lobby.seats.some((seat) => seat.token === "tok-x")).toBe(false);
  });

  it("gives a player back the seat they say they already hold", () => {
    // What a client sends when it finds itself missing from the lobby. The
    // alternative - handing out the lowest free seat - would reshuffle a
    // lobby whose record already names who sits where.
    const world = fakeHost();
    createReferee(world.host);
    world.emit("message", seatClaim("tok-c", "Cyd", null, "c"), "conn-c");
    expect(world.lobby()!.seats[0]!.seat).toBe("c");
    // A seat somebody else holds is not available to claim, hint or no hint.
    world.emit("message", seatClaim("tok-d", "Dez", null, "c"), "conn-d");
    expect(world.lobby()!.seats.find((seat) => seat.token === "tok-d")!.seat).toBe("a");
    // And a nonsense seat is refused outright rather than half-understood.
    expect(parseClaim({ ...seatClaim("tok-e", "Eve", null, "z") })).toBeNull();
  });

  it("ignores a match record it cannot fully validate", () => {
    const world = fakeHost();
    createReferee(world.host);
    for (const junk of [null, 42, {}, { v: 1 }, { ...record(["tok-a"]), seq: -1 }])
      expect(() => world.emit("state", DUEL_MATCH_KEY, junk)).not.toThrow();
    expect(world.lobby()!.seats).toHaveLength(0);
    // Nor does it care about other keys moving.
    world.emit("state", "miw-duel:setup", record(["tok-a", "tok-b"]));
    expect(world.lobby()!.seats).toHaveLength(0);
  });
});

describe("the compiled server.js Portals actually runs", () => {
  const source = readFileSync(
    new URL("../../portals/dist/server.js", import.meta.url),
    "utf8",
  );

  it("is a single self-contained script the sandbox can run", () => {
    // No module system: the sandbox provides a frozen global and nothing else.
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toMatch(/\bexport\s/m);
    // Comfortably inside the documented 512 KB script ceiling.
    expect(source.length).toBeLessThan(512 * 1024);
  });

  it("seats players when executed against a bare emulated global", () => {
    const world = fakeHost();
    const forbidden = () => {
      throw new Error("the sandbox has no DOM, window, or network");
    };
    // Run the real artifact the way Portals would: one function, one global,
    // and nothing else in scope.
    const run = new Function(
      "server",
      "window",
      "document",
      "fetch",
      "require",
      `"use strict";${source}`,
    );
    expect(() =>
      run(Object.freeze(world.host), undefined, undefined, forbidden, forbidden),
    ).not.toThrow();

    expect(world.lobby()).toMatchObject({ seats: [], started: false });
    world.emit("message", seatClaim("tok-a", "Ava"), "conn-a");
    world.emit("message", seatClaim("tok-b", "Bo"), "conn-b");
    world.emit("message", { k: "start", v: DUEL_PROTOCOL, token: "tok-a" }, "conn-a");
    const lobby = world.lobby()!;
    expect(lobby.started).toBe(true);
    expect(lobby.seats.map((seat) => seat.seat)).toEqual(["a", "b"]);
    // The artifact and the module agree on the wire shape the clients read.
    expect(lobby.v).toBe(DUEL_PROTOCOL);
    expect(lobby.build).toBe(REFEREE_BUILD);
  });

  it("stays inside the 8 KB state-value budget at a full lobby", () => {
    const world = fakeHost();
    const run = new Function("server", `"use strict";${source}`);
    run(Object.freeze(world.host));
    for (let index = 0; index < MAX_DUEL_PLAYERS; index += 1)
      world.emit(
        "message",
        seatClaim(`token-${"x".repeat(70)}${index}`, "n".repeat(40), "a".repeat(64)),
        `conn-${index}`,
      );
    const bytes = new TextEncoder().encode(JSON.stringify(world.lobby())).byteLength;
    expect(bytes).toBeLessThan(8 * 1024);
  });
});
