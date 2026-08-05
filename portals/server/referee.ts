// The Duel Mode lobby referee, compiled to portals/dist/server.js.
//
// Portals runs this as an invisible authoritative participant in every
// multiplayer session of this game, one instance per session, isolated by
// channel. It owns exactly one thing: who is sitting in which seat, and
// whether the host has started. Match play stays on the client protocol in
// duel-protocol.ts, which is proven in live play.
//
// Why the lobby and nothing else. Seating is the one place four seats added a
// genuine race that two never had: three joiners can each read the same
// record, each claim the lowest free seat, and last-write-wins silently drops
// two of them. The clients resolve that by retrying with jitter, which
// converges but is a negotiation between peers. A referee just assigns.
// State keys prefixed `server:` are rejected from clients, so a seating it
// publishes cannot be forged or raced at all.
//
// What this deliberately does NOT assume, because the documentation does not
// say:
//   - that the server receives a `state` event for its own writes, or any
//     documented signature for a server-side `state` event at all. Everything
//     here is driven by `message`, `playerjoin`, and `playerleave`.
//   - that `server:` keys survive a server restart. A fresh server republishes
//     from an empty lobby, and clients treat a lobby that loses their seat as
//     a reason to re-claim rather than an error.
//
// And what the clients must keep true regardless: a session with no referee -
// absent, still starting, or dropped for exceeding its budget - has to play
// identically. That is both the documented requirement and the reason this
// file can ship before anyone has proven a synced bundle even runs it.
//
// Sandbox: no import/require, no DOM, no network, timers from the frozen
// `server` global. This file ships publicly in the bundle; never put a secret
// in it.

import {
  DUEL_PROTOCOL,
  MAX_DUEL_PLAYERS,
  DUEL_SEATS,
  REFEREE_STATE_KEY,
  type DuelSeat,
  type RefereeLobby,
  type RefereeSeatRecord,
} from "../src/duel/duel-protocol";

/** Bumped by hand so a client can tell a stale server from a fresh one. */
export const REFEREE_BUILD = 2;

// The lobby shape and its validator live in duel-protocol.ts so this file
// and the clients cannot drift apart: one definition, both sides.
type RefereeSeat = RefereeSeatRecord;

/** The subset of the `server` global this module uses. */
export interface RefereeHost {
  setState(key: string, value: unknown): void;
  players(): { id: string }[];
  // One permissive signature rather than overloads: the sandbox hands every
  // event to the same registrar, and each handler below narrows its own args.
  on(event: string, handler: (...args: never[]) => void): void;
}

/** Claim a seat, or refresh the connection behind a token already seated. */
interface SeatClaim {
  k: "seat";
  v: typeof DUEL_PROTOCOL;
  token: string;
  name: string;
  avatarCode: string | null;
}

/** The host closing the lobby. Honoured only from the seat-A token. */
interface StartClaim {
  k: "start";
  v: typeof DUEL_PROTOCOL;
  token: string;
}

function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

/**
 * Validate an inbound claim. Every field is bounded before it is believed,
 * the same posture the client protocol takes with anything off the wire: a
 * hostile client is just another client here.
 */
export function parseClaim(value: unknown): SeatClaim | StartClaim | null {
  if (!value || typeof value !== "object") return null;
  const claim = value as Record<string, unknown>;
  if (claim.v !== DUEL_PROTOCOL) return null;
  if (!text(claim.token, 80)) return null;
  if (claim.k === "start") return { k: "start", v: DUEL_PROTOCOL, token: claim.token };
  if (claim.k !== "seat") return null;
  if (!text(claim.name, 40)) return null;
  if (claim.avatarCode !== null && !text(claim.avatarCode, 64)) return null;
  return {
    k: "seat",
    v: DUEL_PROTOCOL,
    token: claim.token,
    name: claim.name,
    avatarCode: (claim.avatarCode as string | null) ?? null,
  };
}

/**
 * The referee's whole decision surface, as a pure state machine so every rule
 * below is testable without a Portals host - the same discipline the client
 * rulebook keeps.
 */
export function createReferee(host: RefereeHost) {
  let seats: RefereeSeat[] = [];
  let started = false;
  let startedAt: number | null = null;

  const publish = (): void => {
    const lobby: RefereeLobby = {
      build: REFEREE_BUILD,
      v: DUEL_PROTOCOL,
      seats,
      started,
      startedAt,
    };
    host.setState(REFEREE_STATE_KEY, lobby);
  };

  /** The lowest seat letter nobody holds. */
  const freeSeat = (): DuelSeat | null =>
    DUEL_SEATS.find((seat) => !seats.some((held) => held.seat === seat)) ?? null;

  const claimSeat = (claim: SeatClaim, fromId: string): void => {
    const existing = seats.find((seat) => seat.token === claim.token);
    if (existing) {
      // A rejoin: the token keeps its seat and only the connection moves.
      // Name and outfit may have changed in the wardrobe in between.
      if (
        existing.connId === fromId &&
        existing.name === claim.name &&
        existing.avatarCode === claim.avatarCode
      )
        return;
      seats = seats.map((seat) =>
        seat.token === claim.token
          ? { ...seat, connId: fromId, name: claim.name, avatarCode: claim.avatarCode }
          : seat,
      );
      publish();
      return;
    }
    // The lobby closes at the start: a late arrival must not appear mid-round
    // with no turn and no hearts, which is the same rule the client protocol
    // enforces in joinMatch.
    if (started) return;
    const seat = freeSeat();
    if (!seat) return;
    seats = [
      ...seats,
      { seat, token: claim.token, connId: fromId, name: claim.name, avatarCode: claim.avatarCode },
    ];
    publish();
  };

  const start = (claim: StartClaim): void => {
    if (started) return;
    // Only the host may start, and only with someone to play against. The
    // host is whoever holds seat A, not whoever claims to be the host.
    const host_ = seats.find((seat) => seat.seat === "a");
    if (!host_ || host_.token !== claim.token) return;
    if (seats.length < 2) return;
    started = true;
    startedAt = Date.now();
    publish();
  };

  const dropConnection = (connId: string): void => {
    // Before the start a departure frees the seat for somebody else. After
    // it, seating is frozen: leaving mid-match is a retirement the match
    // record owns, and a seat vacated here would let a stranger take the
    // place of a player who is merely reloading.
    if (started) return;
    const remaining = seats.filter((seat) => seat.connId !== connId);
    if (remaining.length === seats.length) return;
    seats = remaining;
    publish();
  };

  host.on("message", ((data: unknown, fromId: string) => {
    const claim = parseClaim(data);
    if (!claim) return;
    if (claim.k === "seat") claimSeat(claim, fromId);
    else start(claim);
  }) as (...args: never[]) => void);
  host.on("playerleave", ((player: { id: string }) => dropConnection(player.id)) as (...args: never[]) => void);
  // A join tells the referee nothing by itself - the arriving client has not
  // said who it is yet - but publishing makes the lobby visible to it
  // immediately rather than only after the first claim.
  host.on("playerjoin", (() => publish()) as (...args: never[]) => void);

  // Announce an empty lobby at once, so a client can tell "no referee" from
  // "a referee that has not heard from anyone".
  publish();

  return {
    /** Exposed for tests; the live server drives everything through events. */
    lobby: (): RefereeLobby => ({
      build: REFEREE_BUILD,
      v: DUEL_PROTOCOL,
      seats,
      started,
      startedAt,
    }),
    seatCount: (): number => seats.length,
    maxSeats: MAX_DUEL_PLAYERS,
  };
}
