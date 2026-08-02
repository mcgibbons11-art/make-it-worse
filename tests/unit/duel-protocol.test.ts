// The duel rulebook, exercised as pure data. Every transition the UI can
// perform is asserted here against the rules the user set: best-of-3, three
// hearts per turn, clearer worsens, round loser opens the next round.

import { describe, expect, it } from "vitest";
import {
  DUEL_PROTOCOL,
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
  lobbyFreshness,
  lobbyPostKey,
  mayClaimForfeit,
  mintDuelCode,
  normalizeDuelCode,
  otherSeat,
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
} from "../../portals/src/duel/duel-protocol";

const NOW = 1_700_000_000_000;

const host: DuelPlayer = { token: "tok-a", connId: "conn-a", name: "Ava", avatarCode: "0A0A" };
const guest: DuelPlayer = { token: "tok-b", connId: "conn-b", name: "Bo", avatarCode: null };

function fullMatch(): DuelMatch {
  return joinMatch(createMatch(host, NOW), guest)!;
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
    expect(match.score).toEqual({ a: 0, b: 1 });
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

  it("concede awards the match to the other seat exactly once", () => {
    const match = concede(fullMatch(), "a");
    expect(match.result).toEqual({ winner: "b", reason: "left" });
    expect(concede(match, "b").result).toEqual({ winner: "b", reason: "left" });
  });

  it("rematch swaps seats and resets everything but the channel", () => {
    let match = fullMatch();
    match = { ...match, result: { winner: "a", reason: "rounds" }, score: { a: 2, b: 1 } };
    const next = rematch(match, NOW)!;
    expect(next.players.a.token).toBe(guest.token);
    expect(next.players.b!.token).toBe(host.token);
    expect(next.score).toEqual({ a: 0, b: 0 });
    expect(next.result).toBeNull();
    expect(next.seq).toBeGreaterThan(match.seq);
  });
});

describe("wire hygiene", () => {
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
    const over = concede(custom, "b");
    expect(rematch(over, NOW)).toMatchObject({
      courseTitle: "Lava Loft",
      courseBaseVersion: "map-42",
    });
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
    expect(parseDuelMatch({ ...match, v: 2 })).toBeNull();
  });

  it("keeps seat helpers coherent", () => {
    expect(otherSeat("a")).toBe("b");
    expect(otherSeat("b")).toBe("a");
  });
});
