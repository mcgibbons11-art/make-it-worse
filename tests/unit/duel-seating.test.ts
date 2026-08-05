// @vitest-environment jsdom
//
// Four browsers, one Portals session, and the REAL compiled server.js sitting
// in it as the referee. Everything here is the shipping code: useDuel drives
// the stages, duel-session moves the traffic, duel-protocol decides the rules,
// and portals/dist/server.js assigns the seats. Only the platform underneath
// is a stand-in, and it enforces the two platform rules that matter - clients
// cannot write `server:` keys, and shared state is last-write-wins.
//
// The pair of runs is the point. The same script seats four players with a
// referee and without one, because a session whose server script never ran has
// to play identically.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_DUEL_PLAYERS, REFEREE_STATE_KEY } from "@/portals/src/duel/duel-protocol";
import { resetDuelTokenForTests } from "@/portals/src/duel/duel-session";
import { useDuel } from "@/portals/src/duel/useDuel";

// Resolved from the working directory rather than import.meta.url: under
// jsdom that url is an http one, and node:fs will not read it.
const SERVER_SOURCE = readFileSync(resolve(process.cwd(), "portals/dist/server.js"), "utf8");

type Handler = (...args: never[]) => void;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * One Portals multiplayer session: shared state, a message bus, and a roster.
 * Members are the browsers; the referee, when present, is a member that
 * receives events but never appears in the roster, which is how the platform
 * describes an invisible participant.
 */
function makeSession() {
  const state: Record<string, unknown> = {};
  const members: { id: string; on: Record<string, Handler[]> }[] = [];
  const refereeOn: Record<string, Handler[]> = { message: [], playerjoin: [], playerleave: [] };
  let attached = false;

  const fire = (bag: Record<string, Handler[]>, event: string, args: unknown[]) => {
    for (const handler of bag[event] ?? []) (handler as (...a: unknown[]) => void)(...args);
  };
  const broadcastState = (key: string, value: unknown, from: string | null) => {
    for (const member of members)
      if (member.id !== from) fire(member.on, "state", [key, clone(value)]);
  };

  const attachReferee = () => {
    const host = {
      setState(key: string, value: unknown) {
        state[key] = clone(value);
        broadcastState(key, value, null);
      },
      players: () => members.map((member) => ({ id: member.id })),
      on(event: string, handler: Handler) {
        (refereeOn[event] ??= []).push(handler);
      },
    };
    // Executed exactly as Portals would: one function, one frozen global.
    new Function("server", `"use strict";${SERVER_SOURCE}`)(Object.freeze(host));
    attached = true;
  };

  /** A browser's view of the SDK, for one client only. */
  const client = (id: string, displayName: string) => {
    const on: Record<string, Handler[]> = {
      message: [], state: [], status: [], playerjoin: [], playerleave: [],
    };
    const member = { id, on };
    const net = {
      async join() {
        const peers = members.map((other) => ({
          id: other.id, playerId: other.id, displayName: other.id, avatarUrl: null,
        }));
        members.push(member);
        for (const other of members)
          if (other.id !== id)
            fire(other.on, "playerjoin", [{ id, playerId: id, displayName, avatarUrl: null }, []]);
        if (attached) fire(refereeOn, "playerjoin", [{ id }, []]);
        return {
          self: { id, playerId: id, displayName, avatarUrl: null },
          players: [...peers, { id, playerId: id, displayName, avatarUrl: null }],
          state: clone(state),
        };
      },
      async leave() {
        const index = members.indexOf(member);
        if (index >= 0) members.splice(index, 1);
        if (attached) fire(refereeOn, "playerleave", [{ id }, []]);
      },
      send(value: unknown) {
        for (const other of members)
          if (other.id !== id) fire(other.on, "message", [clone(value), id]);
        if (attached) fire(refereeOn, "message", [clone(value), id]);
      },
      setState(key: string, value: unknown) {
        // The platform rejects client writes to the server's namespace. Without
        // this the whole exercise would prove nothing: a client could simply
        // forge the seating it wanted.
        if (key.startsWith("server:")) return;
        state[key] = clone(value);
        broadcastState(key, value, id);
      },
      getState: (key?: string) => (key === undefined ? clone(state) : clone(state[key])),
      players: () => members.map((other) => ({ id: other.id })),
      self: () => ({ id, playerId: id, displayName, avatarUrl: null }),
      on: (event: string, handler: Handler) => void (on[event] ??= []).push(handler),
      off: (event: string, handler: Handler) => {
        const list = on[event] ?? [];
        const index = list.indexOf(handler);
        if (index >= 0) list.splice(index, 1);
      },
    };
    return {
      version: "test",
      async ready() {
        return { player: { playerId: id, displayName, avatarUrl: null }, context: "room" as const };
      },
      getPlayer: () => null,
      identity: { requestLogin: () => undefined, onChange: () => undefined },
      saveState: async () => undefined,
      loadState: async () => null,
      submitScore: async () => undefined,
      getLeaderboard: async () => [],
      quit: () => undefined,
      net,
    };
  };

  /**
   * A browser that died without saying goodbye - a closed tab. The platform
   * notices the dropped connection and reports it; the departed client
   * publishes nothing, which is exactly what leaves a ghost in the record.
   */
  const drop = (id: string) => {
    const index = members.findIndex((member) => member.id === id);
    if (index >= 0) members.splice(index, 1);
    for (const other of members) fire(other.on, "playerleave", [{ id }, []]);
    if (attached) fire(refereeOn, "playerleave", [{ id }, []]);
  };

  return { state, attachReferee, client, drop };
}

/**
 * Mount one player's hook. The token is per-browser and these four share a
 * jsdom window, so it is forced per client the way four real browsers would
 * differ naturally. The connection id doubles as that token, which is why the
 * ids here are long enough to satisfy the token grammar.
 */
function mountPlayer(session: ReturnType<typeof makeSession>, id: string, name: string) {
  window.name = `miwtok:${id}`;
  resetDuelTokenForTests();
  (window as unknown as { Portals: unknown }).Portals = session.client(id, name);
  return renderHook(() => useDuel({ playerName: name, avatar: null, avatarSeed: 1 }));
}

/** Host a duel and return its invite code. */
async function hostDuel(player: ReturnType<typeof mountPlayer>) {
  act(() => player.result.current.open());
  act(() => player.result.current.hostPrivate());
  await waitFor(() => expect(player.result.current.stage.kind).toBe("waiting"));
  const stage = player.result.current.stage;
  if (stage.kind !== "waiting") throw new Error("host never reached the gathering lobby");
  return stage.code;
}

async function joinDuel(player: ReturnType<typeof mountPlayer>, code: string) {
  act(() => player.result.current.open());
  act(() => player.result.current.joinWithCode(code));
  await waitFor(() => expect(player.result.current.mySeat).not.toBeNull(), { timeout: 4_000 });
}

afterEach(() => {
  cleanup();
  window.name = "";
  resetDuelTokenForTests();
});

describe("four players taking seats in one session", () => {
  it("seats everyone the referee assigned, and lets the host start", async () => {
    const session = makeSession();
    session.attachReferee();

    const host = mountPlayer(session, "conn-alpha", "Ava");
    const code = await hostDuel(host);
    // The referee is live and knows the host before anybody else arrives.
    await waitFor(() => expect(host.result.current.refereeOnline).toBe(true));

    const guests = [
      mountPlayer(session, "conn-bravo", "Bo"),
      mountPlayer(session, "conn-charlie", "Cyd"),
      mountPlayer(session, "conn-delta", "Dez"),
    ];
    for (const guest of guests) await joinDuel(guest, code);

    // Each guest holds the seat the referee gave it, and no two agree.
    const lobby = session.state[REFEREE_STATE_KEY] as {
      seats: { seat: string; token: string }[];
    };
    expect(lobby.seats).toHaveLength(MAX_DUEL_PLAYERS);
    for (const [index, guest] of guests.entries()) {
      const token = ["conn-bravo", "conn-charlie", "conn-delta"][index];
      const assigned = lobby.seats.find((seat) => seat.token === token);
      expect(assigned).toBeDefined();
      expect(guest.result.current.mySeat).toBe(assigned!.seat);
    }
    const seats = guests.map((guest) => guest.result.current.mySeat);
    expect(new Set([...seats, "a"]).size).toBe(MAX_DUEL_PLAYERS);

    // The host sees a full lobby and may close it.
    await waitFor(() => expect(host.result.current.roster).toHaveLength(MAX_DUEL_PLAYERS));
    expect(host.result.current.openSeats).toBe(0);
    expect(host.result.current.canStartMatch).toBe(true);
    act(() => host.result.current.startNow());
    await waitFor(() => expect(host.result.current.stage.kind).toBe("match"));
    for (const guest of guests)
      await waitFor(() => expect(guest.result.current.stage.kind).toBe("match"));
    // The referee closed its lobby with the match, so a latecomer is not
    // handed a seat the started record would only turn away.
    expect((session.state[REFEREE_STATE_KEY] as { started: boolean }).started).toBe(true);
    // Seat A runs first, exactly as the two-player rules always did.
    expect(host.result.current.myTurn).toBe(true);
  }, 30_000);

  it("recycles the seat of someone who bailed, which no client would do alone", async () => {
    // The discriminating case. Bo takes seat B and the tab dies before the
    // start, publishing nothing: the referee sees the dropped connection and
    // frees B, while the record still shows Bo sitting in it. Cyd arrives, is
    // given B, and must take it over the ghost. A client choosing for itself
    // would read the record, see A and B occupied, and pick C - so Cyd
    // landing in B is proof the referee's assignment is what seated her, and
    // not a lucky agreement between two rules that usually match.
    const session = makeSession();
    session.attachReferee();
    const host = mountPlayer(session, "conn-alpha", "Ava");
    const code = await hostDuel(host);

    const bo = mountPlayer(session, "conn-bravo", "Bo");
    await joinDuel(bo, code);
    expect(bo.result.current.mySeat).toBe("b");
    bo.unmount();
    session.drop("conn-bravo");
    await waitFor(() =>
      expect((session.state[REFEREE_STATE_KEY] as { seats: unknown[] }).seats).toHaveLength(1),
    );

    const cyd = mountPlayer(session, "conn-charlie", "Cyd");
    await joinDuel(cyd, code);
    expect(cyd.result.current.mySeat).toBe("b");
    // And the lobby the host sees is two players, not a ghost plus one.
    await waitFor(() => expect(host.result.current.roster).toHaveLength(2));
    expect(host.result.current.roster.map((entry) => entry.name)).toEqual(["Ava", "Cyd"]);
  }, 30_000);

  it("seats everyone with no referee at all, which is the fallback that must hold", async () => {
    const session = makeSession();
    // No attachReferee: this is a session whose server script never ran.
    const host = mountPlayer(session, "conn-alpha", "Ava");
    const code = await hostDuel(host);
    expect(host.result.current.refereeOnline).toBe(false);

    const guests = [
      mountPlayer(session, "conn-bravo", "Bo"),
      mountPlayer(session, "conn-charlie", "Cyd"),
      mountPlayer(session, "conn-delta", "Dez"),
    ];
    for (const guest of guests) await joinDuel(guest, code);

    expect(session.state[REFEREE_STATE_KEY]).toBeUndefined();
    const seats = guests.map((guest) => guest.result.current.mySeat);
    expect(new Set([...seats, "a"]).size).toBe(MAX_DUEL_PLAYERS);
    await waitFor(() => expect(host.result.current.roster).toHaveLength(MAX_DUEL_PLAYERS));
    expect(host.result.current.canStartMatch).toBe(true);
  }, 30_000);
});
