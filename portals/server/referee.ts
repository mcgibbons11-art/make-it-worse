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
// Servers restart, and that is the case this file works hardest at. The
// documentation is explicit: publishing swaps a running server within
// seconds, an empty session ends its server after about five minutes, and a
// crashed script leaves the session running without it. A replacement starts
// with no memory of who was sitting where, so it rebuilds its seating from
// the match record the clients publish - the record is the one thing that
// outlives it - and the clients re-claim the seats they already hold when
// they find themselves missing from a lobby. Between the two, a restart
// mid-lobby is invisible.
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
  DUEL_MATCH_KEY,
  REFEREE_STATE_KEY,
  parseDuelMatch,
  seatedSeats,
  type DuelSeat,
  type RefereeLobby,
  type RefereeSeatRecord,
} from "../src/duel/duel-protocol";

/** Bumped by hand so a client can tell a stale server from a fresh one. */
export const REFEREE_BUILD = 3;

// The lobby shape and its validator live in duel-protocol.ts so this file
// and the clients cannot drift apart: one definition, both sides.
type RefereeSeat = RefereeSeatRecord;

/** The subset of the `server` global this module uses. */
export interface RefereeHost {
  setState(key: string, value: unknown): void;
  getState(key?: string): unknown;
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
  /**
   * The seat this player already holds in the match record, if any. Sent when
   * a client finds itself missing from the lobby, which is what a restarted
   * server looks like from the outside. Honoured when the seat is free, so
   * recovery puts everyone back where they were rather than reshuffling a
   * lobby whose record already names the seats.
   */
  seat: DuelSeat | null;
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
  const seat = claim.seat;
  if (seat !== undefined && seat !== null && !DUEL_SEATS.includes(seat as DuelSeat)) return null;
  return {
    k: "seat",
    v: DUEL_PROTOCOL,
    token: claim.token,
    name: claim.name,
    avatarCode: (claim.avatarCode as string | null) ?? null,
    seat: (seat as DuelSeat | undefined) ?? null,
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
  let publishes = 0;

  const publish = (): void => {
    publishes += 1;
    const lobby: RefereeLobby = {
      build: REFEREE_BUILD,
      v: DUEL_PROTOCOL,
      seats,
      started,
      startedAt,
      n: publishes,
    };
    host.setState(REFEREE_STATE_KEY, lobby);
  };

  const taken = (seat: DuelSeat): boolean => seats.some((held) => held.seat === seat);
  /** The lowest seat letter nobody holds. */
  const freeSeat = (): DuelSeat | null => DUEL_SEATS.find((seat) => !taken(seat)) ?? null;

  /**
   * Rebuild seating from the clients' match record. This is how a replacement
   * server recovers: the record names who sits where and whether play began,
   * and it survives the restart that emptied this server's memory.
   *
   * It only ever FILLS GAPS. A token this server already seated keeps the
   * seat this server gave it, and a seat already held is never reassigned -
   * the record can lag its own writers, and a stale one must not be able to
   * move a player who is sitting down right now.
   */
  const adoptRecord = (value: unknown): void => {
    const match = parseDuelMatch(value);
    if (!match) return;
    let changed = false;
    for (const seat of seatedSeats(match)) {
      const player = match.players[seat]!;
      if (taken(seat) || seats.some((held) => held.token === player.token)) continue;
      seats = [
        ...seats,
        {
          seat,
          token: player.token,
          connId: player.connId,
          name: player.name,
          avatarCode: player.avatarCode,
        },
      ];
      changed = true;
    }
    // A record that says play began closes the lobby even if the host's start
    // claim never arrived - a lost message must not leave the door open
    // behind a match already under way. It never reopens one.
    if (match.started && !started) {
      started = true;
      startedAt = Date.now();
      changed = true;
    }
    if (changed) publish();
  };

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
    // A seat the player already holds in the record is theirs to reclaim
    // while it stands empty here; otherwise they take the lowest free one.
    const seat = claim.seat !== null && !taken(claim.seat) ? claim.seat : freeSeat();
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
  host.on("state", ((key: string, value: unknown) => {
    if (key === DUEL_MATCH_KEY) adoptRecord(value);
  }) as (...args: never[]) => void);

  // Announce an empty lobby at once, so a client can tell "no referee" from
  // "a referee that has not heard from anyone". A replacement server seeds
  // itself from whatever the session already holds before it does, so its
  // first word is the seating that was already true rather than a blank
  // lobby every seated client would then have to correct.
  try {
    adoptRecord(host.getState(DUEL_MATCH_KEY));
  } catch {
    // A mirror that is not ready yet is ordinary on a cold session; the
    // state event and the clients' claims both still lead here.
  }
  publish();

  return {
    /** Exposed for tests; the live server drives everything through events. */
    lobby: (): RefereeLobby => ({
      build: REFEREE_BUILD,
      v: DUEL_PROTOCOL,
      seats,
      started,
      startedAt,
      n: publishes,
    }),
    seatCount: (): number => seats.length,
    maxSeats: MAX_DUEL_PLAYERS,
  };
}
