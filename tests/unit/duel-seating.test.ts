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
import {
  MAX_DUEL_PLAYERS,
  REFEREE_STATE_KEY,
  type RefereeLobby,
} from "@/portals/src/duel/duel-protocol";
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
  const sent: { from: string; value: unknown }[] = [];
  const members: { id: string; on: Record<string, Handler[]> }[] = [];
  const refereeOn: Record<string, Handler[]> = {
    message: [], playerjoin: [], playerleave: [], state: [],
  };
  let attached = false;

  const fire = (bag: Record<string, Handler[]>, event: string, args: unknown[]) => {
    for (const handler of bag[event] ?? []) (handler as (...a: unknown[]) => void)(...args);
  };
  const broadcastState = (key: string, value: unknown, from: string | null) => {
    for (const member of members)
      if (member.id !== from) fire(member.on, "state", [key, clone(value)]);
    // The server is a participant too: it sees client writes as `state`
    // events, which is how it learns the match record exists.
    if (attached && from !== null) fire(refereeOn, "state", [key, clone(value)]);
  };

  const attachReferee = () => {
    const host = {
      setState(key: string, value: unknown) {
        state[key] = clone(value);
        broadcastState(key, value, null);
      },
      getState: (key?: string) => (key === undefined ? clone(state) : clone(state[key])),
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
        sent.push({ from: id, value: clone(value) });
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

  /**
   * A replacement server: publishing swaps one within seconds, and a crashed
   * script is replaced the same way. The new one starts with no memory of
   * who was sitting where, which is the whole point of the exercise.
   */
  const restartReferee = () => {
    for (const key of Object.keys(refereeOn)) refereeOn[key] = [];
    attached = false;
    attachReferee();
  };

  /**
   * A script that crashed or ran out of budget. The documented behaviour is
   * that the session keeps running and nobody is disconnected - so the server
   * simply stops responding, and the last lobby it published stays in shared
   * state forever with nothing to rewrite it.
   */
  const crashReferee = () => {
    for (const key of Object.keys(refereeOn)) refereeOn[key] = [];
    attached = false;
  };

  return { state, sent, attachReferee, restartReferee, crashReferee, client, drop };
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
  const sdk = session.client(id, name);
  (window as unknown as { Portals: unknown }).Portals = sdk;
  const rendered = renderHook(() => useDuel({ playerName: name, avatar: null, avatarSeed: 1 }));
  return Object.assign(rendered, { sdk });
}

/**
 * Point the single `window.Portals` global at this player before it does
 * anything that opens a connection. Four browsers share one global here and
 * the SDK is read at connect time, so without this a player that connects
 * late - which is now every host, since it stays in the lobby until Start -
 * picks up whoever mounted most recently.
 */
function focus(player: { sdk: unknown }) {
  (window as unknown as { Portals: unknown }).Portals = player.sdk;
}

/**
 * Host a party and return its invite code. Hosting now stays on the lobby
 * page - that is the point of the merge - so the code comes from the party
 * rather than from a screen the host was moved to.
 */
async function hostDuel(player: ReturnType<typeof mountPlayer>) {
  focus(player);
  act(() => player.result.current.open());
  act(() => player.result.current.enterLobby());
  await waitFor(() => expect(player.result.current.stage.kind).toBe("lobby"));
  act(() => player.result.current.hostParty());
  await waitFor(() => expect(player.result.current.partyCode).not.toBeNull());
  return player.result.current.partyCode!;
}

/**
 * Ask to join a party and be let in. Nobody moves: the guest waits on the
 * lobby page with the host until the party is closed.
 */
async function askToJoin(
  guest: ReturnType<typeof mountPlayer>,
  host: ReturnType<typeof mountPlayer>,
) {
  focus(guest);
  act(() => guest.result.current.open());
  act(() => guest.result.current.enterLobby());
  await waitFor(() => expect(guest.result.current.posts).toHaveLength(1));
  act(() => guest.result.current.claimPost(guest.result.current.posts[0]!.connId));
  await waitFor(() => expect(host.result.current.requests.length).toBeGreaterThan(0));
  focus(host);
  const asked = host.result.current.requests.at(-1)!.connId;
  act(() => host.result.current.acceptRequest(asked));
  await waitFor(() => expect(guest.result.current.joinedParty).not.toBeNull());
}

/** Close the party and wait for everyone to be sitting in the duel. */
async function startParty(host: ReturnType<typeof mountPlayer>, seats: number) {
  focus(host);
  act(() => host.result.current.startParty());
  await waitFor(() => expect(host.result.current.roster).toHaveLength(seats), { timeout: 8_000 });
}

afterEach(() => {
  cleanup();
  window.name = "";
  resetDuelTokenForTests();
});

describe("four players taking seats in one session", () => {
  it("gathers the party on the lobby page and moves it in one go", async () => {
    // The whole party flow, and the reason it lives on one page: the host
    // never leaves the lobby while gathering, so the listing stays alive and
    // its roster stays true. Nobody touches a duel channel until Start.
    const session = makeSession();
    session.attachReferee();
    const host = mountPlayer(session, "conn-alpha", "Ava");
    focus(host);
    act(() => host.result.current.open());
    act(() => host.result.current.enterLobby());
    await waitFor(() => expect(host.result.current.stage.kind).toBe("lobby"));
    act(() => host.result.current.hostParty());
    await waitFor(() => expect(host.result.current.party).toHaveLength(1));

    const bo = mountPlayer(session, "conn-bravo", "Bo");
    focus(bo);
    act(() => bo.result.current.open());
    act(() => bo.result.current.enterLobby());
    await waitFor(() => expect(bo.result.current.posts).toHaveLength(1));
    expect(bo.result.current.posts[0]!.members).toEqual(["Ava"]);
    act(() => bo.result.current.claimPost(bo.result.current.posts[0]!.connId));

    // The host answers without going anywhere, and the listing grows.
    await waitFor(() => expect(host.result.current.requests[0]?.name).toBe("Bo"));
    focus(host);
    act(() => host.result.current.acceptRequest(host.result.current.requests[0]!.connId));
    await waitFor(() => expect(host.result.current.party).toHaveLength(2));
    // Bo is IN the party but has not been moved: still on the lobby page.
    await waitFor(() => expect(bo.result.current.joinedParty?.name).toBe("Ava"));
    expect(bo.result.current.stage.kind).toBe("lobby");
    expect(bo.result.current.mySeat).toBeNull();
    await waitFor(() => expect(bo.result.current.posts[0]!.members).toEqual(["Ava", "Bo"]));

    // Start moves everyone at once, into the seats they were given.
    focus(host);
    act(() => host.result.current.startParty());
    await waitFor(() => expect(host.result.current.mySeat).toBe("a"), { timeout: 6_000 });
    await waitFor(() => expect(bo.result.current.mySeat).toBe("b"), { timeout: 6_000 });
    await waitFor(() => expect(host.result.current.roster).toHaveLength(2), { timeout: 8_000 });
    expect(host.result.current.canStartMatch).toBe(true);
    // And the listing is gone, because the host cleared it on the way out.
    await waitFor(() =>
      expect(Object.keys(session.state).some((key) => key.startsWith("miw-duel-post:") && session.state[key])).toBe(false),
    );
  }, 30_000);

  it("seats four through the party, each in the seat the host handed out", async () => {
    const session = makeSession();
    session.attachReferee();
    const host = mountPlayer(session, "conn-alpha", "Ava");
    await hostDuel(host);
    const guests = [
      mountPlayer(session, "conn-bravo", "Bo"),
      mountPlayer(session, "conn-charlie", "Cyd"),
      mountPlayer(session, "conn-delta", "Dez"),
    ];
    for (const guest of guests) await askToJoin(guest, host);
    // Four of the eight seats, which is the point: a party starts with
    // whoever turned up rather than holding out for a full house.
    expect(host.result.current.party).toHaveLength(4);
    expect(host.result.current.party.map((member) => member.name))
      .toEqual(["Ava", "Bo", "Cyd", "Dez"]);
    // Still room for more: openSeats counts chairs in a match record, which
    // does not exist until Start, so the party itself is what has space here.
    expect(host.result.current.party.length).toBeLessThan(MAX_DUEL_PLAYERS);

    focus(host);
    act(() => host.result.current.startParty());
    // Seats are decided before anybody moves, so arriving is a set of
    // predetermined claims rather than a scramble: the host keeps A and the
    // rest follow in the order they were let in.
    //
    // The handout is asserted rather than the arrival because these four
    // browsers share one `window.Portals`, and three guests answering the
    // same broadcast would all resolve it to the same client. Real browsers
    // do not share a global; this harness cannot model four at once.
    await waitFor(() => {
      const handouts = session.sent
        .map((entry) => entry.value as { k?: string; to?: string; seat?: string })
        .filter((value) => value.k === "party-go");
      expect(handouts.map((value) => value.seat)).toEqual(["b", "c", "d"]);
      expect(handouts.map((value) => value.to)).toEqual([
        "conn-bravo", "conn-charlie", "conn-delta",
      ]);
    }, { timeout: 8_000 });
    await waitFor(() => expect(host.result.current.mySeat).toBe("a"), { timeout: 8_000 });
    // And the listing is gone, cleared by the host on its way out.
    expect(Object.keys(session.state).filter((key) => key.startsWith("miw-duel-post:") && session.state[key]))
      .toHaveLength(0);
  }, 30_000);

  it("seats a party with no referee at all, which is the fallback that must hold", async () => {
    const session = makeSession();
    // No attachReferee: a session whose server script never ran.
    const host = mountPlayer(session, "conn-alpha", "Ava");
    await hostDuel(host);
    const bo = mountPlayer(session, "conn-bravo", "Bo");
    await askToJoin(bo, host);
    await startParty(host, 2);
    expect(host.result.current.refereeOnline).toBe(false);
    expect(session.state[REFEREE_STATE_KEY]).toBeUndefined();
    expect([host, bo].map((player) => player.result.current.mySeat)).toEqual(["a", "b"]);
  }, 30_000);

  it("keeps everyone in their seats when the server is swapped out mid-match", async () => {
    // Publishing swaps a running server within seconds, so this is ordinary
    // rather than exotic. The replacement rebuilds from the match record.
    const session = makeSession();
    session.attachReferee();
    const host = mountPlayer(session, "conn-alpha", "Ava");
    await hostDuel(host);
    const bo = mountPlayer(session, "conn-bravo", "Bo");
    await askToJoin(bo, host);
    await startParty(host, 2);

    session.restartReferee();
    const lobby = () => session.state[REFEREE_STATE_KEY] as RefereeLobby;
    await waitFor(() => expect(lobby().seats).toHaveLength(2), { timeout: 8_000 });
    expect(lobby().seats.map((seat) => seat.token)).toEqual(["conn-alpha", "conn-bravo"]);
    expect(host.result.current.mySeat).toBe("a");
    expect(bo.result.current.mySeat).toBe("b");
  }, 30_000);

  it("shows every request when two people ask at once", async () => {
    // A single request slot silently dropped all but the last asker, who then
    // sat waiting on an answer the host was never given the chance to make.
    const session = makeSession();
    const host = mountPlayer(session, "conn-alpha", "Ava");
    await hostDuel(host);
    const bo = mountPlayer(session, "conn-bravo", "Bo");
    const cyd = mountPlayer(session, "conn-charlie", "Cyd");
    for (const guest of [bo, cyd]) {
      focus(guest);
      act(() => guest.result.current.open());
      act(() => guest.result.current.enterLobby());
      await waitFor(() => expect(guest.result.current.posts).toHaveLength(1));
    }
    // Both ask before the host has answered either.
    act(() => bo.result.current.claimPost(bo.result.current.posts[0]!.connId));
    act(() => cyd.result.current.claimPost(cyd.result.current.posts[0]!.connId));
    await waitFor(() => expect(host.result.current.requests).toHaveLength(2));
    expect(host.result.current.requests.map((request) => request.name)).toEqual(["Bo", "Cyd"]);

    // Answering one leaves the other still standing, still answerable.
    focus(host);
    act(() => host.result.current.acceptRequest(host.result.current.requests[0]!.connId));
    await waitFor(() => expect(host.result.current.party).toHaveLength(2));
    expect(host.result.current.requests.map((request) => request.name)).toEqual(["Cyd"]);
    act(() => host.result.current.acceptRequest(host.result.current.requests[0]!.connId));
    await waitFor(() => expect(host.result.current.party).toHaveLength(3));
    expect(host.result.current.requests).toHaveLength(0);
  }, 30_000);

  it("ends the party when the host's tab dies, rather than leaving it waiting", async () => {
    // A closed tab disbands nothing on its way out, so the members would sit
    // on "waiting for Ava to start" for a host that is never coming back. The
    // dropped connection is the only announcement anybody gets.
    const session = makeSession();
    const host = mountPlayer(session, "conn-alpha", "Ava");
    await hostDuel(host);
    const bo = mountPlayer(session, "conn-bravo", "Bo");
    await askToJoin(bo, host);
    expect(bo.result.current.joinedParty?.name).toBe("Ava");

    host.unmount();
    session.drop("conn-alpha");

    await waitFor(() => expect(bo.result.current.joinedParty).toBeNull());
    expect(bo.result.current.lobbyNotice).toMatch(/host left/i);
    expect(bo.result.current.stage.kind).toBe("lobby");
  }, 30_000);

  it("drops a member whose tab dies, so no seat is handed to nobody", async () => {
    const session = makeSession();
    const host = mountPlayer(session, "conn-alpha", "Ava");
    await hostDuel(host);
    const bo = mountPlayer(session, "conn-bravo", "Bo");
    await askToJoin(bo, host);
    expect(host.result.current.party).toHaveLength(2);

    bo.unmount();
    session.drop("conn-bravo");

    await waitFor(() => expect(host.result.current.party).toHaveLength(1));
    // And the listing says so, so nobody joins a party of ghosts.
    const listing = Object.values(session.state).find(
      (value) => (value as { members?: string[] })?.members,
    ) as { members: string[] };
    expect(listing.members).toEqual(["Ava"]);
  }, 30_000);

  it("turns everyone out when the host takes the party down", async () => {
    // Taking the listing down used to tell nobody, leaving the people who had
    // been let in waiting on a host who was no longer hosting anything.
    const session = makeSession();
    const host = mountPlayer(session, "conn-alpha", "Ava");
    await hostDuel(host);
    const bo = mountPlayer(session, "conn-bravo", "Bo");
    await askToJoin(bo, host);
    expect(bo.result.current.joinedParty?.name).toBe("Ava");

    focus(host);
    act(() => host.result.current.unpost());
    await waitFor(() => expect(bo.result.current.joinedParty).toBeNull());
    // Back to browsing with an explanation, not stuck and not thrown out of
    // the lobby altogether.
    expect(bo.result.current.stage.kind).toBe("lobby");
    expect(bo.result.current.lobbyNotice).toMatch(/closed that party/);
    expect(host.result.current.party).toHaveLength(0);
    await waitFor(() => expect(bo.result.current.posts).toHaveLength(0));
  }, 30_000);

  // A crashed server's stale lobby locking out later parties is NOT covered
  // here. It needs two duel channels in one session - the dead lobby in the
  // first, a fresh party in the second - and this harness keeps a single
  // state bucket for every channel, so the old match record would block the
  // new party for a reason that cannot happen in a real session. The rule
  // itself is asserted in duel-referee.test.ts, and the client half of it -
  // never turning a player away on a lobby that has not been seen moving -
  // is in useDuel's seating effect.
});
