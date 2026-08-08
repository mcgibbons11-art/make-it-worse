// The duel rulebook, exercised as pure data. Every transition the UI can
// perform is asserted here against the rules the user set: best-of-3, three
// hearts per turn, clearer worsens, round loser opens the next round.

import { describe, expect, it } from "vitest";
import {
  DUEL_PROTOCOL,
  DUEL_SEATS,
  DUEL_WIRE_MAX_BYTES,
  HEARTS_PER_TURN,
  ROUNDS_TO_WIN,
  HANDOFF_DEADLINE_MS,
  FORFEIT_GRACE_MS,
  beginRun,
  claimForfeit,
  clearRun,
  concede,
  createMatch,
  duelChannel,
  duelWireBytes,
  failAttempt,
  handOff,
  joinMatch,
  refereeSeatOf,
  vacateSeat,
  lobbyFreshness,
  lobbyPostAbandoned,
  lobbyPostKey,
  LOBBY_DIM_AFTER_MS,
  LOBBY_STALE_AFTER_MS,
  mayClaimForfeit,
  mintDuelCode,
  normalizeDuelCode,
  startMatch,
  mayStartMatch,
  activeSeats,
  seatedSeats,
  nextRunner,
  MAX_DUEL_PLAYERS,
  parseDuelMatch,
  parseDuelMessage,
  parseLobbyPost,
  refreshConnection,
  rematch,
  seatOf,
  setCourse,
  supersedes,
  type DuelMatch,
  type DuelPlayer,
  type DuelSeat,
} from "../../portals/src/duel/duel-protocol";

const NOW = 1_700_000_000_000;

/** Every seat at zero, with the named seats overridden. */
function scoreboard(wins: Partial<Record<DuelSeat, number>> = {}): Record<DuelSeat, number> {
  return Object.fromEntries(
    DUEL_SEATS.map((seat) => [seat, wins[seat] ?? 0]),
  ) as Record<DuelSeat, number>;
}


const host: DuelPlayer = { token: "tok-a", connId: "conn-a", name: "Ava", avatarCode: "0A0A" };
const guest: DuelPlayer = { token: "tok-b", connId: "conn-b", name: "Bo", avatarCode: null };

const third: DuelPlayer = { token: "tok-c", connId: "conn-c", name: "Cyd", avatarCode: null };
const fourth: DuelPlayer = { token: "tok-d", connId: "conn-d", name: "Dez", avatarCode: null };

/** Two seats, started - the classic duel every original rule was written for. */
function fullMatch(): DuelMatch {
  return startMatch(joinMatch(createMatch(host, NOW), guest)!, NOW)!;
}

/** Four seats, started. */
function partyMatch(): DuelMatch {
  let match = createMatch(host, NOW);
  for (const player of [guest, third, fourth]) match = joinMatch(match, player)!;
  return startMatch(match, NOW)!;
}

describe("invite codes", () => {
  it("mints codes that normalize to themselves and to a legal channel", () => {
    for (let round = 0; round < 25; round += 1) {
      const code = mintDuelCode();
      expect(normalizeDuelCode(code)).toBe(code);
      expect(normalizeDuelCode(`miw-${code.toLowerCase()}`)).toBe(code);
      expect(duelChannel(code)).toMatch(/^duel:[a-z0-9]+$/);
    }
  });

  it("rejects the ambiguous symbols the alphabet excludes", () => {
    expect(normalizeDuelCode("AB0I")).toBeNull();
    expect(normalizeDuelCode("")).toBeNull();
    expect(normalizeDuelCode("ABCDE")).toBeNull();
  });
});

describe("match lifecycle", () => {
  it("seats the host at A, the joiner at B, and nobody twice", () => {
    const match = fullMatch();
    expect(seatOf(match, host.token)).toBe("a");
    expect(seatOf(match, guest.token)).toBe("b");
    expect(seatOf(match, "stranger")).toBeNull();
    expect(joinMatch(match, { ...guest, token: "tok-c" })).toBeNull();
  });

  it("survives a validation round-trip and enforces seq ordering", () => {
    const match = fullMatch();
    const parsed = parseDuelMatch(JSON.parse(JSON.stringify(match)));
    expect(parsed).not.toBeNull();
    expect(supersedes(parsed!, null)).toBe(true);
    expect(supersedes(parsed!, match)).toBe(false);
    const advanced = beginRun(match, NOW);
    expect(supersedes(advanced, match)).toBe(true);
  });

  it("lets a rejoiner refresh its connection id behind the stable token", () => {
    const match = fullMatch();
    const refreshed = refreshConnection(match, guest.token, "conn-b2")!;
    expect(refreshed.players.b!.connId).toBe("conn-b2");
    expect(refreshed.players.b!.token).toBe(guest.token);
    expect(refreshConnection(match, "stranger", "x")).toBeNull();
  });
});

describe("the turn loop", () => {
  it("spends hearts on failures and keeps the runner on retries", () => {
    let match = beginRun(setCourse(fullMatch(), "CODE", "v1", NOW), NOW);
    const first = failAttempt(match, NOW);
    expect(first.kind).toBe("retry");
    match = first.match;
    expect(match.turn.heartsLeft).toBe(HEARTS_PER_TURN - 1);
    expect(match.turn.runner).toBe("a");
  });

  it("loses the round on the third burned heart, and the loser opens round 2", () => {
    let match = beginRun(setCourse(fullMatch(), "CODE", "v1", NOW), NOW);
    match = failAttempt(match, NOW).match;
    match = failAttempt(match, NOW).match;
    const third = failAttempt(match, NOW);
    expect(third.kind).toBe("round-lost");
    match = third.match;
    expect(match.score).toEqual(scoreboard({ b: 1 }));
    expect(match.round).toBe(2);
    // Fresh round: course cleared, loser (A) runs first with fresh hearts.
    expect(match.courseCode).toBeNull();
    expect(match.turn.runner).toBe("a");
    expect(match.turn.heartsLeft).toBe(HEARTS_PER_TURN);
    expect(match.turn.number).toBe(1);
  });

  it("hands the turn to the opponent after a clear-and-worsen", () => {
    let match = beginRun(setCourse(fullMatch(), "CODE", "v1", NOW), NOW);
    match = clearRun(match, NOW);
    expect(match.turn.phase).toBe("worsening");
    match = handOff(match, "CODE2", "v2", NOW);
    expect(match.turn.runner).toBe("b");
    expect(match.turn.number).toBe(2);
    expect(match.turn.heartsLeft).toBe(HEARTS_PER_TURN);
    expect(match.courseVersion).toBe("v2");
  });

  it("ends the match at two round wins", () => {
    let match = beginRun(setCourse(fullMatch(), "C", "v1", NOW), NOW);
    for (let round = 0; round < 2; round += 1) {
      match = failAttempt(match, NOW).match;
      match = failAttempt(match, NOW).match;
      const lost = failAttempt(match, NOW);
      match = lost.match;
      if (round === 0) {
        expect(lost.kind).toBe("round-lost");
        // A lost round 1; A opens round 2 and burns it again.
        match = beginRun(setCourse(match, "C2", "v2", NOW), NOW);
      } else {
        expect(lost.kind).toBe("match-over");
      }
    }
    expect(match.result).toEqual({ winner: "b", reason: "rounds" });
    expect(match.score.b).toBe(ROUNDS_TO_WIN);
  });
});

describe("forfeits, concession, rematch", () => {
  it("only the waiting player may claim, only after deadline plus grace, never mid-run", () => {
    const match = setCourse(fullMatch(), "CODE", "v1", NOW);
    expect(mayClaimForfeit(match, "a", NOW + HANDOFF_DEADLINE_MS * 2)).toBe(false); // runner
    expect(mayClaimForfeit(match, "b", NOW)).toBe(false); // too early
    const late = NOW + HANDOFF_DEADLINE_MS + FORFEIT_GRACE_MS + 1;
    expect(mayClaimForfeit(match, "b", late)).toBe(true);
    expect(mayClaimForfeit(beginRun(match, NOW), "b", late)).toBe(false); // live run
    const claimed = claimForfeit(match, "b", late)!;
    expect(claimed.match.score.b).toBe(1);
  });

  it("lets the others move on when the runner walks out mid-attempt", () => {
    // The stall that froze a match: a runner who quits during their own run
    // leaves a turn that never advances, so no clock ever runs out and the
    // mid-run exemption means nobody can claim. Silence is the difference
    // between a player who is slow and a player who has gone.
    const live = beginRun(setCourse(partyMatch(), "CODE", "v1", NOW), NOW);
    expect(live.turn.phase).toBe("running");
    const later = NOW + HANDOFF_DEADLINE_MS + FORFEIT_GRACE_MS + 1;
    // Slow is protected: mid-attempt, the clock alone claims nothing.
    expect(mayClaimForfeit(live, "b", later)).toBe(false);
    expect(claimForfeit(live, "b", later)).toBeNull();
    // Gone is not.
    expect(mayClaimForfeit(live, "b", NOW, true)).toBe(true);
    const outcome = claimForfeit(live, "b", NOW, true)!;
    // Retired, not merely out for the round: a player who has gone must not
    // come back as next round's opener, or the survivors claim against the
    // same empty chair for the rest of the match.
    expect(outcome.match.retired).toContain("a");
    expect(seatedSeats(outcome.match)).not.toContain("a");
    expect(outcome.match.turn.runner).toBe("b");
    // With four seats the rest carry on; the match only ends when too few
    // are left to play one.
    expect(outcome.match.result).toBeNull();
    expect(activeSeats(outcome.match)).toEqual(["b", "c", "d"]);
    // And the runner cannot claim against themselves, however quiet it gets.
    expect(mayClaimForfeit(live, "a", NOW, true)).toBe(false);
  });

  it("concede awards the match to the other seat exactly once", () => {
    const match = concede(fullMatch(), "a", NOW);
    expect(match.result).toEqual({ winner: "b", reason: "left" });
    expect(concede(match, "b", NOW).result).toEqual({ winner: "b", reason: "left" });
  });

  it("rematch rotates the lineup and resets everything but the channel", () => {
    let match = fullMatch();
    match = { ...match, result: { winner: "a", reason: "rounds" }, score: scoreboard({ a: 2, b: 1 }) };
    const next = rematch(match, NOW)!;
    expect(next.players.a!.token).toBe(guest.token);
    expect(next.players.b!.token).toBe(host.token);
    expect(next.score).toEqual(scoreboard());
    expect(next.result).toBeNull();
    // A lineup that already agreed to play does not re-gather in the lobby.
    expect(next.started).toBe(true);
    expect(next.seq).toBeGreaterThan(match.seq);
  });
});

describe("party listings", () => {
  const listing = (extra: Record<string, unknown> = {}) => ({
    v: DUEL_PROTOCOL, connId: "conn-a", name: "Ava", avatarCode: null,
    note: "", courseTitle: null, createdAt: NOW, heartbeatAt: NOW, ...extra,
  });

  it("carries the party roster, and reads an old post as a party of one", () => {
    expect(parseLobbyPost(listing({ members: ["Ava", "Bo"] }))!.members).toEqual(["Ava", "Bo"]);
    // Written before parties existed: one person looking for a duel is a
    // party of one, which is exactly what it was.
    expect(parseLobbyPost(listing())!.members).toEqual(["Ava"]);
    // More members than there are seats is not a party anyone can believe.
    expect(parseLobbyPost(listing({ members: DUEL_SEATS.map(String).concat("i") }))).toBeNull();
    expect(parseLobbyPost(listing({ members: ["Ava", ""] }))).toBeNull();
  });

  it("judges every listing on its heartbeat, because the host stays to send one", () => {
    const post = parseLobbyPost(listing({ members: ["Ava"] }))!;
    expect(lobbyFreshness(post, NOW + LOBBY_DIM_AFTER_MS - 1)).toBe("fresh");
    expect(lobbyFreshness(post, NOW + LOBBY_DIM_AFTER_MS + 1)).toBe("dim");
    expect(lobbyFreshness(post, NOW + LOBBY_STALE_AFTER_MS + 1)).toBe("stale");
    expect(lobbyPostAbandoned(post, NOW + LOBBY_STALE_AFTER_MS * 2 + 1)).toBe(true);
  });

  it("closes a party with one message carrying every seat", () => {
    // One message, not one per member. The host leaves the lobby the moment
    // it sends this, and anything still in flight dies with that connection -
    // sending four meant only the first member ever arrived.
    const seats = [{ to: "conn-b", seat: "b" }, { to: "conn-c", seat: "c" }];
    expect(parseDuelMessage({ k: "party-go", v: DUEL_PROTOCOL, code: "miw-4f7k", seats }))
      .toEqual({ k: "party-go", v: DUEL_PROTOCOL, code: "4F7K", seats });
    // A seat nobody could sit in, a recipient nobody could address, or a code
    // nobody could dial is refused rather than half-understood: each would
    // strand the players it was meant to move.
    expect(parseDuelMessage({ k: "party-go", v: DUEL_PROTOCOL, code: "4F7K", seats: [{ to: "conn-b", seat: "z" }] })).toBeNull();
    expect(parseDuelMessage({ k: "party-go", v: DUEL_PROTOCOL, code: "4F7K", seats: [{ to: "", seat: "b" }] })).toBeNull();
    expect(parseDuelMessage({ k: "party-go", v: DUEL_PROTOCOL, code: "nope", seats })).toBeNull();
    expect(parseDuelMessage({ k: "party-go", v: DUEL_PROTOCOL, code: "4F7K", seats: [] })).toBeNull();
  });
});

describe("wire hygiene", () => {
  it("round-trips the liveness heartbeat", () => {
    expect(parseDuelMessage({ k: "hb", v: DUEL_PROTOCOL })).toEqual({
      k: "hb",
      v: DUEL_PROTOCOL,
    });
    expect(parseDuelMessage({ k: "hb", v: 99 })).toBeNull();
  });

  it("accepts every legal message shape and rejects the rest", () => {
    expect(parseDuelMessage({ k: "pos", v: DUEL_PROTOCOL, x: 1, y: 2, z: 3, yaw: 0.5, flags: 1 })).not.toBeNull();
    expect(parseDuelMessage({ k: "evt", v: DUEL_PROTOCOL, type: "clear" })).not.toBeNull();
    expect(parseDuelMessage({ k: "chat", v: DUEL_PROTOCOL, text: "gg" })).not.toBeNull();
    expect(parseDuelMessage({ k: "react", v: DUEL_PROTOCOL, emoji: "🔥" })).not.toBeNull();
    expect(parseDuelMessage({ k: "duel-accept", v: DUEL_PROTOCOL, to: "conn", code: "ab23" })).toMatchObject({ code: "AB23" });
    expect(parseDuelMessage({ k: "pos", v: DUEL_PROTOCOL, x: Number.NaN, y: 0, z: 0, yaw: 0, flags: 0 })).toBeNull();
    expect(parseDuelMessage({ k: "chat", v: DUEL_PROTOCOL, text: "   " })).toBeNull();
    expect(parseDuelMessage({ k: "react", v: DUEL_PROTOCOL, emoji: "🤖" })).toBeNull();
    expect(parseDuelMessage({ k: "chat", v: 99, text: "hi" })).toBeNull();
    expect(parseDuelMessage(null)).toBeNull();
  });

  it("bounds every record under the 8 KB wire budget with a real map code aboard", () => {
    const match = setCourse(fullMatch(), "x".repeat(2_000), "v1", NOW);
    expect(duelWireBytes(match)).toBeLessThan(8 * 1024);
  });

  it("validates lobby posts and ages them dim then stale", () => {
    const post = {
      v: DUEL_PROTOCOL, connId: "conn-a", name: "Ava", avatarCode: null,
      note: "come lose", createdAt: NOW, heartbeatAt: NOW,
    };
    const parsed = parseLobbyPost(post)!;
    expect(parsed).not.toBeNull();
    expect(lobbyPostKey("conn-a")).toContain("conn-a");
    expect(lobbyFreshness(parsed, NOW)).toBe("fresh");
    expect(lobbyFreshness(parsed, NOW + 60_000)).toBe("dim");
    expect(lobbyFreshness(parsed, NOW + 120_000)).toBe("stale");
    expect(parseLobbyPost({ ...post, note: "x".repeat(400) })).toBeNull();
  });

  it("carries a custom base course through rounds, rematches, and the wire", () => {
    const base = { title: "Lava Loft", version: "map-42" };
    const custom = joinMatch(createMatch(host, NOW, base), guest)!;
    expect(custom.courseTitle).toBe("Lava Loft");
    expect(custom.courseBaseVersion).toBe("map-42");
    // Losing a round resets the course but never the chosen base.
    let burned = beginRun(custom, NOW);
    for (let heart = 0; heart < HEARTS_PER_TURN - 1; heart += 1)
      burned = failAttempt(burned, NOW).match;
    const reset = failAttempt(burned, NOW);
    expect(reset.kind).toBe("round-lost");
    expect(reset.match.courseCode).toBeNull();
    expect(reset.match.courseTitle).toBe("Lava Loft");
    expect(reset.match.courseBaseVersion).toBe("map-42");
    // The record round-trips validation with the base aboard.
    expect(parseDuelMatch(JSON.parse(JSON.stringify(custom)))).toMatchObject({
      courseTitle: "Lava Loft",
      courseBaseVersion: "map-42",
    });
    // A rematch swaps seats but keeps playing the same map.
    // Ended by the scoreline rather than by a walkout: a rematch needs two
    // players who are still seated.
    const over = { ...custom, result: { winner: "a" as const, reason: "rounds" as const } };
    expect(rematch(over, NOW)).toMatchObject({
      courseTitle: "Lava Loft",
      courseBaseVersion: "map-42",
    });
  });

  it("keeps a round-by-round history for the end-of-match summary", () => {
    let match = beginRun(fullMatch(), NOW);
    for (let burn = 0; burn < HEARTS_PER_TURN; burn += 1)
      match = failAttempt(match, NOW).match;
    expect(match.history).toEqual([{ winner: "b", turns: 1, reason: "hearts" }]);
    // Round 2 dies on the clock instead: the waiting player claims it.
    const late = NOW + HANDOFF_DEADLINE_MS + FORFEIT_GRACE_MS + 1;
    const claimed = claimForfeit(match, "b", late)!;
    expect(claimed.kind).toBe("match-over");
    expect(claimed.match.history).toHaveLength(2);
    expect(claimed.match.history[1]).toMatchObject({ winner: "b", reason: "forfeit" });
    // Records written before the summary existed read as an empty history.
    const legacy = JSON.parse(JSON.stringify(fullMatch())) as Record<string, unknown>;
    delete legacy.history;
    expect(parseDuelMatch(legacy)).toMatchObject({ history: [] });
  });

  it("reads records and posts written before custom courses existed", () => {
    const legacyMatch = JSON.parse(JSON.stringify(fullMatch())) as Record<string, unknown>;
    delete legacyMatch.courseTitle;
    delete legacyMatch.courseBaseVersion;
    expect(parseDuelMatch(legacyMatch)).toMatchObject({
      courseTitle: null,
      courseBaseVersion: null,
    });
    const legacyPost = {
      v: DUEL_PROTOCOL, connId: "conn-a", name: "Ava", avatarCode: null,
      note: "come lose", createdAt: NOW, heartbeatAt: NOW,
    };
    expect(parseLobbyPost(legacyPost)).toMatchObject({ courseTitle: null });
    expect(parseLobbyPost({ ...legacyPost, courseTitle: "Lava Loft" })).toMatchObject({
      courseTitle: "Lava Loft",
    });
    expect(parseLobbyPost({ ...legacyPost, courseTitle: "x".repeat(200) })).toBeNull();
  });

  it("rejects a match record whose players are malformed", () => {
    const match = fullMatch() as unknown as Record<string, unknown>;
    expect(parseDuelMatch({ ...match, players: { a: null, b: null } })).toBeNull();
    expect(parseDuelMatch({ ...match, turn: { number: 1 } })).toBeNull();
    expect(parseDuelMatch({ ...match, v: 1 })).toBeNull();
  });

  it("keeps seat helpers coherent", () => {
    const party = partyMatch();
    expect(seatedSeats(party)).toEqual(["a", "b", "c", "d"]);
    expect(activeSeats(party)).toEqual(["a", "b", "c", "d"]);
    // The turn order is clockwise and wraps.
    expect(nextRunner(party, "a")).toBe("b");
    expect(nextRunner(party, "d")).toBe("a");
    // An eliminated seat is skipped; a lone survivor has nobody to pass to.
    const withOut = { ...party, out: ["b" as const, "c" as const] };
    expect(nextRunner(withOut, "a")).toBe("d");
    expect(nextRunner({ ...party, out: ["b", "c", "d"] }, "a")).toBeNull();
  });
});

describe("a full party", () => {
  it("runs a full table down to one survivor, and keeps the record postable", () => {
    // Eight seats is the ceiling, and the two things that could quietly break
    // at the ceiling are the turn order and the wire budget: the match record
    // is capped at 8 KB and already carries a course code that can run past
    // 1,700 characters.
    let match = createMatch(host, NOW);
    for (let index = 1; index < MAX_DUEL_PLAYERS; index += 1)
      match = joinMatch(match, {
        token: `tok-${index}`, connId: `conn-${index}`, name: `Player ${index}`, avatarCode: null,
      })!;
    match = startMatch(match, NOW)!;
    match = setCourse(match, "C".repeat(1732), "version-1", NOW);
    expect(duelWireBytes(match)).toBeLessThan(DUEL_WIRE_MAX_BYTES);

    // Knock out seven of the eight; the round belongs to whoever is left.
    let outcome: ReturnType<typeof failAttempt> | null = null;
    for (let knockout = 0; knockout < MAX_DUEL_PLAYERS - 1; knockout += 1) {
      match = beginRun(match, NOW);
      for (let heart = 0; heart < HEARTS_PER_TURN; heart += 1) {
        outcome = failAttempt(match, NOW);
        match = outcome.match;
      }
    }
    expect(outcome!.kind).toBe("round-lost");
    expect(match.score.h).toBe(1);
    expect(match.round).toBe(2);
    // The round resets the table rather than leaving seven players out.
    expect(activeSeats(match)).toHaveLength(MAX_DUEL_PLAYERS);
  });

  it("fills every seat and refuses the one after", () => {
    let match = createMatch(host, NOW);
    for (let index = 1; index < MAX_DUEL_PLAYERS; index += 1)
      match = joinMatch(match, {
        token: `tok-${index}`, connId: `conn-${index}`, name: `P${index}`, avatarCode: null,
      })!;
    expect(seatedSeats(match)).toHaveLength(MAX_DUEL_PLAYERS);
    expect(seatedSeats(match)).toEqual([...DUEL_SEATS]);
    const spare: DuelPlayer = { token: "tok-x", connId: "conn-x", name: "Ex", avatarCode: null };
    expect(joinMatch(match, spare)).toBeNull();
  });

  it("takes the seat a referee assigned, and refuses one already held", () => {
    const gathering = createMatch(host, NOW);
    // The referee may hand out any free seat, not merely the lowest: seating
    // is its call, which is the whole reason it exists.
    const seated = joinMatch(gathering, guest, "c")!;
    expect(seatOf(seated, guest.token)).toBe("c");
    expect(seated.players.b).toBeNull();
    // A seat someone else holds means the record and the referee disagree.
    // Refusing beats evicting a seated player.
    expect(joinMatch(seated, third, "c")).toBeNull();
    expect(joinMatch(seated, third, "a")).toBeNull();
    // Re-asserting our own seat is the retry after a clobbered write, and it
    // has to succeed or a joiner whose write lost would never get back in.
    expect(seatOf(joinMatch(seated, guest, "c")!, guest.token)).toBe("c");
  });

  it("reads a token's seat out of a referee lobby", () => {
    const lobby = {
      build: 2,
      v: DUEL_PROTOCOL as typeof DUEL_PROTOCOL,
      seats: [
        { seat: "a" as const, token: "tok-a", connId: "conn-a", name: "Ava", avatarCode: null },
        { seat: "b" as const, token: "tok-b", connId: "conn-b", name: "Bo", avatarCode: null },
      ],
      started: false,
      startedAt: null,
      n: 3,
    };
    expect(refereeSeatOf(lobby, "tok-b")).toBe("b");
    expect(refereeSeatOf(lobby, "tok-z")).toBeNull();
    // No referee is the ordinary case, and it must read as "no assignment"
    // rather than throw: that path is every session without a server script.
    expect(refereeSeatOf(null, "tok-a")).toBeNull();
  });

  it("gives up a gathering seat, and refuses to touch one mid-match", () => {
    const gathering = joinMatch(createMatch(host, NOW), guest)!;
    const left = vacateSeat(gathering, "b");
    expect(left.players.b).toBeNull();
    expect(seatedSeats(left)).toEqual(["a"]);
    expect(left.seq).toBeGreaterThan(gathering.seq);
    // The seat is immediately available again, which is the point: a host
    // keeps gathering after somebody changes their mind.
    expect(seatOf(joinMatch(left, third)!, third.token)).toBe("b");
    // Once the match is under way a seat is nobody's to empty - leaving is a
    // concession, with a result, not a quiet disappearance.
    const started = startMatch(gathering, NOW)!;
    expect(vacateSeat(started, "b")).toBe(started);
    expect(vacateSeat(gathering, "c")).toBe(gathering);
  });

  it("opens joining only before the host starts", () => {
    const gathering = joinMatch(createMatch(host, NOW), guest)!;
    expect(mayStartMatch(gathering)).toBe(true);
    // One player alone cannot start a duel.
    expect(mayStartMatch(createMatch(host, NOW))).toBe(false);
    const started = startMatch(gathering, NOW)!;
    expect(started.started).toBe(true);
    expect(joinMatch(started, third)).toBeNull();
    expect(mayStartMatch(started)).toBe(false);
  });

  it("burning three hearts is an elimination, not a lost round, while others live", () => {
    let match = beginRun(partyMatch(), NOW);
    let outcome = failAttempt(match, NOW);
    outcome = failAttempt(outcome.match, NOW);
    outcome = failAttempt(outcome.match, NOW);
    // Seat A is out; the round runs on and the turn moves to B.
    expect(outcome.kind).toBe("eliminated");
    expect(outcome.match.out).toEqual(["a"]);
    expect(outcome.match.turn.runner).toBe("b");
    expect(outcome.match.turn.heartsLeft).toBe(outcome.match.rules.hearts);
    expect(outcome.match.score).toEqual(scoreboard());
    match = outcome.match;
    // Knock out B and C: the last survivor D takes the round.
    for (let knockout = 0; knockout < 2; knockout += 1) {
      let burn = failAttempt(beginRun(match, NOW), NOW);
      burn = failAttempt(burn.match, NOW);
      burn = failAttempt(burn.match, NOW);
      match = burn.match;
    }
    expect(match.score.d).toBe(1);
    expect(match.round).toBe(2);
    // A new round revives everyone, and the seat knocked out FIRST opens it.
    expect(match.out).toEqual([]);
    expect(activeSeats(match)).toHaveLength(4);
    expect(match.turn.runner).toBe("a");
  });

  it("hands the turn to the next survivor when a runner clears and worsens", () => {
    const match = handOff(clearRun(beginRun(partyMatch(), NOW), NOW), "CODE", "v2", NOW);
    expect(match.turn.runner).toBe("b");
    expect(match.turn.number).toBe(2);
    // With B out, the hand-off skips them.
    const skipped = handOff(
      clearRun(beginRun({ ...partyMatch(), out: ["b"] }, NOW), NOW),
      "CODE",
      "v2",
      NOW,
    );
    expect(skipped.turn.runner).toBe("c");
  });

  it("a stalled runner is eliminated by the clock, not handed the round away", () => {
    const match = setCourse(partyMatch(), "CODE", "v1", NOW);
    const late = NOW + HANDOFF_DEADLINE_MS + FORFEIT_GRACE_MS + 1;
    // Any live seat that is not the runner may claim.
    expect(mayClaimForfeit(match, "c", late)).toBe(true);
    expect(mayClaimForfeit(match, "a", late)).toBe(false);
    const claimed = claimForfeit(match, "c", late)!;
    expect(claimed.kind).toBe("eliminated");
    expect(claimed.match.out).toEqual(["a"]);
    // Nobody scored: three players are still in the round.
    expect(claimed.match.score).toEqual(scoreboard());
    // An eliminated seat cannot claim.
    expect(mayClaimForfeit(claimed.match, "a", late)).toBe(false);
  });

  it("a player who leaves is retired and the rest play on", () => {
    const match = concede(partyMatch(), "b", NOW);
    expect(match.retired).toEqual(["b"]);
    expect(seatedSeats(match)).toEqual(["a", "c", "d"]);
    expect(match.result).toBeNull();
    // Down to one seat, the last player standing takes the match.
    const alone = concede(concede(match, "c", NOW), "d", NOW);
    expect(alone.result).toEqual({ winner: "a", reason: "left" });
  });

  it("still plays exactly like 1v1 at two seats", () => {
    let outcome = failAttempt(beginRun(fullMatch(), NOW), NOW);
    outcome = failAttempt(outcome.match, NOW);
    outcome = failAttempt(outcome.match, NOW);
    // The opponent takes the round outright: no elimination limbo.
    expect(outcome.kind).toBe("round-lost");
    expect(outcome.match.score).toEqual(scoreboard({ b: 1 }));
    // And the round loser opens the next round, as before.
    expect(outcome.match.turn.runner).toBe("a");
  });
});
