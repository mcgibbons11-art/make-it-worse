// The 1v1 duel's rulebook, kept pure so every rule is testable without a
// Portals host. The transport (duel-session.ts) moves these records; this
// file decides what they mean and which writes are legitimate.
//
// The platform shapes three rules. There is no server, so the match record is
// a single shared-state key with a sequence number and a named writer per
// phase - last-write-wins is safe because at any moment exactly one player
// has the right to advance the match, and the other only ever writes a
// forfeit claim after a generous deadline. Connections are not identities -
// a rejoining tab gets a fresh connection id - so players carry a stable
// token minted in their own browser. And every inbound value is validated
// and size-bounded before it is believed, the same posture map-session.ts
// takes with map codes.

export const DUEL_PROTOCOL = 1;
export const DUEL_WIRE_MAX_BYTES = 8 * 1024;
export const DUEL_STATE_POLL_MS = 1_500;

/** Best-of-3: two round wins take the match. */
export const ROUNDS_TO_WIN = 2;
/** Failed attempts the runner may burn per turn before losing the round. */
export const HEARTS_PER_TURN = 3;

// Turn clocks. Generous on purpose: expiry hands the ROUND to the opponent,
// so a false forfeit is expensive. The waiting player may only claim one
// after the deadline plus grace, which absorbs clock skew between browsers.
export const HANDOFF_DEADLINE_MS = 120_000;
export const WORSEN_DEADLINE_MS = 90_000;
export const FORFEIT_GRACE_MS = 10_000;
/**
 * How long a mid-match opponent may stay disconnected before the match ends
 * in the remaining player's favour. Long enough for the supported
 * reload-and-rejoin (an editor preview reload alone can take half of it),
 * short enough that nobody plays on against an empty seat for long.
 */
export const ABANDON_TIMEOUT_MS = 60_000;

/** Lobby posts older than this render dimmed; older than stale are ignored. */
export const LOBBY_HEARTBEAT_MS = 20_000;
export const LOBBY_DIM_AFTER_MS = 45_000;
export const LOBBY_STALE_AFTER_MS = 90_000;

export const DUEL_SETUP_KEY = "miw-duel:setup";
export const DUEL_MATCH_KEY = "miw-duel:match";
export const LOBBY_POST_PREFIX = "miw-duel-post:";

// Invite codes avoid 0/O and 1/I, read aloud cleanly, and map to a channel
// name that satisfies the documented channel grammar.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const DUEL_CODE_LENGTH = 4;

export function mintDuelCode(random: () => number = Math.random): string {
  let code = "";
  for (let index = 0; index < DUEL_CODE_LENGTH; index += 1)
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)]!;
  return code;
}

/** Accepts "miw-4f7k", "MIW4F7K", "4f7k" and normalizes to "4F7K". */
export function normalizeDuelCode(raw: string): string | null {
  const stripped = raw.trim().toUpperCase().replace(/^MIW[-\s]?/, "").replace(/[\s-]/g, "");
  if (stripped.length !== DUEL_CODE_LENGTH) return null;
  for (const symbol of stripped) if (!CODE_ALPHABET.includes(symbol)) return null;
  return stripped;
}

export function duelChannel(code: string): string {
  return `duel:${code.toLowerCase()}`;
}

export type DuelSeat = "a" | "b";

export interface DuelPlayer {
  /** Stable per-browser token; survives rejoins where connection ids do not. */
  token: string;
  /** Latest known connection id, refreshed on every (re)join. */
  connId: string;
  name: string;
  /** Wardrobe code from avatarToCode, so the opponent renders the real runner. */
  avatarCode: string | null;
}

export type TurnPhase = "handoff" | "running" | "worsening";

export interface DuelTurn {
  number: number;
  runner: DuelSeat;
  heartsLeft: number;
  phase: TurnPhase;
  /** Epoch ms after which the waiting player may claim a forfeit. */
  deadlineAt: number;
}

export interface DuelResult {
  winner: DuelSeat;
  reason: "rounds" | "forfeit" | "left";
}

export interface DuelMatch {
  v: typeof DUEL_PROTOCOL;
  /** Monotonic write counter; readers ignore anything not newer. */
  seq: number;
  players: { a: DuelPlayer; b: DuelPlayer | null };
  rules: { roundsToWin: number; hearts: number };
  score: { a: number; b: number };
  round: number;
  turn: DuelTurn;
  /** Challenge code of the course the current turn runs. */
  courseCode: string | null;
  /** Challenge slug of courseCode, for cheap change detection. */
  courseVersion: string | null;
  /**
   * The host's chosen base course. Null plays a fresh random course each
   * round; a custom map opens every round from that exact map before the
   * worsening begins. Only the title and version ride the record - the 8 KB
   * wire budget cannot carry the base map's code alongside the current
   * course, so each client caches the code the first time it sees the
   * pristine base run (courseVersion === courseBaseVersion).
   */
  courseTitle: string | null;
  courseBaseVersion: string | null;
  result: DuelResult | null;
}

export interface LobbyPost {
  v: typeof DUEL_PROTOCOL;
  connId: string;
  name: string;
  avatarCode: string | null;
  note: string;
  /** Title of the poster's chosen map, or null for a random clean course. */
  courseTitle: string | null;
  createdAt: number;
  heartbeatAt: number;
}

export type DuelWireMessage =
  | { k: "pos"; v: typeof DUEL_PROTOCOL; x: number; y: number; z: number; yaw: number; flags: number }
  | { k: "evt"; v: typeof DUEL_PROTOCOL; type: "start" | "death" | "clear" | "trap-hit" | "place"; label?: string }
  | { k: "chat"; v: typeof DUEL_PROTOCOL; text: string }
  | { k: "react"; v: typeof DUEL_PROTOCOL; emoji: string }
  | { k: "duel-claim"; v: typeof DUEL_PROTOCOL; to: string }
  | { k: "duel-accept"; v: typeof DUEL_PROTOCOL; to: string; code: string }
  | { k: "duel-deny"; v: typeof DUEL_PROTOCOL; to: string; reason: "taken" | "closed" };

const REACTIONS = ["😂", "😱", "🔥", "💀", "👏", "😈"] as const;
export const REACTION_EMOJI: readonly string[] = REACTIONS;

function wireBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function shortText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max;
}

export function parseDuelMessage(value: unknown): DuelWireMessage | null {
  if (!value || typeof value !== "object" || wireBytes(value) > DUEL_WIRE_MAX_BYTES) return null;
  const message = value as Record<string, unknown>;
  if (message.v !== DUEL_PROTOCOL) return null;
  switch (message.k) {
    case "pos":
      return finiteNumber(message.x) && finiteNumber(message.y) && finiteNumber(message.z) &&
        finiteNumber(message.yaw) && finiteNumber(message.flags)
        ? { k: "pos", v: DUEL_PROTOCOL, x: message.x, y: message.y, z: message.z, yaw: message.yaw, flags: message.flags }
        : null;
    case "evt":
      return ["start", "death", "clear", "trap-hit", "place"].includes(message.type as string) &&
        (message.label === undefined || shortText(message.label, 80))
        ? {
            k: "evt", v: DUEL_PROTOCOL,
            type: message.type as "start" | "death" | "clear" | "trap-hit" | "place",
            ...(shortText(message.label, 80) && message.label ? { label: message.label } : {}),
          }
        : null;
    case "chat":
      return shortText(message.text, 300) && (message.text as string).trim().length > 0
        ? { k: "chat", v: DUEL_PROTOCOL, text: (message.text as string).trim() }
        : null;
    case "react":
      return REACTION_EMOJI.includes(message.emoji as string)
        ? { k: "react", v: DUEL_PROTOCOL, emoji: message.emoji as string }
        : null;
    case "duel-claim":
      return shortText(message.to, 80) && (message.to as string).length > 0
        ? { k: "duel-claim", v: DUEL_PROTOCOL, to: message.to as string }
        : null;
    case "duel-accept":
      return shortText(message.to, 80) && normalizeDuelCode((message.code as string) ?? "") !== null
        ? { k: "duel-accept", v: DUEL_PROTOCOL, to: message.to as string, code: normalizeDuelCode(message.code as string)! }
        : null;
    case "duel-deny":
      return shortText(message.to, 80) && ["taken", "closed"].includes(message.reason as string)
        ? { k: "duel-deny", v: DUEL_PROTOCOL, to: message.to as string, reason: message.reason as "taken" | "closed" }
        : null;
    default:
      return null;
  }
}

function validPlayer(value: unknown): value is DuelPlayer {
  if (!value || typeof value !== "object") return false;
  const player = value as Record<string, unknown>;
  return shortText(player.token, 80) && (player.token as string).length > 0 &&
    shortText(player.connId, 80) &&
    shortText(player.name, 40) &&
    (player.avatarCode === null || shortText(player.avatarCode, 64));
}

export function parseDuelMatch(value: unknown): DuelMatch | null {
  if (!value || typeof value !== "object" || wireBytes(value) > DUEL_WIRE_MAX_BYTES) return null;
  const match = value as Record<string, unknown> & Partial<DuelMatch>;
  if (match.v !== DUEL_PROTOCOL || !finiteNumber(match.seq)) return null;
  const players = match.players as DuelMatch["players"] | undefined;
  if (!players || !validPlayer(players.a) || (players.b !== null && !validPlayer(players.b))) return null;
  const turn = match.turn as DuelTurn | undefined;
  if (
    !turn ||
    !finiteNumber(turn.number) ||
    (turn.runner !== "a" && turn.runner !== "b") ||
    !finiteNumber(turn.heartsLeft) ||
    !["handoff", "running", "worsening"].includes(turn.phase) ||
    !finiteNumber(turn.deadlineAt)
  ) return null;
  const score = match.score as DuelMatch["score"] | undefined;
  if (!score || !finiteNumber(score.a) || !finiteNumber(score.b)) return null;
  if (!finiteNumber(match.round)) return null;
  if (match.courseCode !== null && !shortText(match.courseCode, 8_000)) return null;
  if (match.courseVersion !== null && !shortText(match.courseVersion, 80)) return null;
  // Absent on records written before custom courses existed; normalized to
  // null so every parsed record has the full shape.
  const courseTitle = match.courseTitle ?? null;
  const courseBaseVersion = match.courseBaseVersion ?? null;
  if (courseTitle !== null && !shortText(courseTitle, 80)) return null;
  if (courseBaseVersion !== null && !shortText(courseBaseVersion, 80)) return null;
  const result = match.result as DuelResult | null | undefined;
  if (result !== null && result !== undefined) {
    if ((result.winner !== "a" && result.winner !== "b") ||
      !["rounds", "forfeit", "left"].includes(result.reason)) return null;
  }
  return { ...(match as DuelMatch), courseTitle, courseBaseVersion };
}

export function seatOf(match: DuelMatch, token: string): DuelSeat | null {
  if (match.players.a.token === token) return "a";
  if (match.players.b?.token === token) return "b";
  return null;
}

export function otherSeat(seat: DuelSeat): DuelSeat {
  return seat === "a" ? "b" : "a";
}

/** A newer record from the wire supersedes ours; equal or older is noise. */
export function supersedes(candidate: DuelMatch, current: DuelMatch | null): boolean {
  return current === null || candidate.seq > current.seq;
}

// --- Match transitions ------------------------------------------------------
//
// Each returns a NEW match with seq bumped, and each names who may perform it.
// The transport enforces nothing; the UI simply never offers an illegal move,
// and an illegal record arriving off the wire loses on validation or seq.

export function createMatch(
  host: DuelPlayer,
  now: number,
  base: { title: string; version: string } | null = null,
): DuelMatch {
  return {
    v: DUEL_PROTOCOL,
    seq: 1,
    players: { a: host, b: null },
    rules: { roundsToWin: ROUNDS_TO_WIN, hearts: HEARTS_PER_TURN },
    score: { a: 0, b: 0 },
    round: 1,
    turn: { number: 1, runner: "a", heartsLeft: HEARTS_PER_TURN, phase: "handoff", deadlineAt: now + HANDOFF_DEADLINE_MS },
    courseCode: null,
    courseVersion: null,
    courseTitle: base?.title.slice(0, 80) ?? null,
    courseBaseVersion: base?.version ?? null,
    result: null,
  };
}

/** The joiner takes seat B. Only legal while B is empty. */
export function joinMatch(match: DuelMatch, joiner: DuelPlayer): DuelMatch | null {
  if (match.players.b !== null || match.result) return null;
  return { ...match, seq: match.seq + 1, players: { ...match.players, b: joiner } };
}

/** A rejoining player refreshes the connection id behind its stable token. */
export function refreshConnection(match: DuelMatch, token: string, connId: string): DuelMatch | null {
  const seat = seatOf(match, token);
  if (!seat) return null;
  const player = { ...(seat === "a" ? match.players.a : match.players.b!), connId };
  return { ...match, seq: match.seq + 1, players: { ...match.players, [seat]: player } };
}

/** The current turn's runner publishes the course this turn runs. */
export function setCourse(match: DuelMatch, code: string, version: string, now: number): DuelMatch {
  return {
    ...match,
    seq: match.seq + 1,
    courseCode: code,
    courseVersion: version,
    turn: { ...match.turn, phase: "handoff", deadlineAt: now + HANDOFF_DEADLINE_MS },
  };
}

/** Runner starts an attempt. Hearts are spent on failure, not on starting. */
export function beginRun(match: DuelMatch, now: number): DuelMatch {
  return {
    ...match,
    seq: match.seq + 1,
    // The run itself is clocked by ATTEMPT_LIMIT_MS in-game; the shared
    // deadline only needs to outlast one attempt plus a breath.
    turn: { ...match.turn, phase: "running", deadlineAt: now + HANDOFF_DEADLINE_MS },
  };
}

export type FailOutcome =
  | { kind: "retry"; match: DuelMatch }
  | { kind: "round-lost"; match: DuelMatch }
  | { kind: "match-over"; match: DuelMatch };

/** Runner burned an attempt. Third burn loses the round; rounds decide the match. */
export function failAttempt(match: DuelMatch, now: number): FailOutcome {
  const heartsLeft = match.turn.heartsLeft - 1;
  if (heartsLeft > 0) {
    return {
      kind: "retry",
      match: {
        ...match,
        seq: match.seq + 1,
        turn: { ...match.turn, heartsLeft, deadlineAt: now + HANDOFF_DEADLINE_MS },
      },
    };
  }
  return roundWonBy(match, otherSeat(match.turn.runner), now);
}

/** Runner cleared the course and now owns the worsening phase. */
export function clearRun(match: DuelMatch, now: number): DuelMatch {
  return {
    ...match,
    seq: match.seq + 1,
    turn: { ...match.turn, phase: "worsening", deadlineAt: now + WORSEN_DEADLINE_MS },
  };
}

/** Worsening done: the new course code hands the turn to the opponent. */
export function handOff(match: DuelMatch, code: string, version: string, now: number): DuelMatch {
  return {
    ...match,
    seq: match.seq + 1,
    courseCode: code,
    courseVersion: version,
    turn: {
      number: match.turn.number + 1,
      runner: otherSeat(match.turn.runner),
      heartsLeft: match.rules.hearts,
      phase: "handoff",
      deadlineAt: now + HANDOFF_DEADLINE_MS,
    },
  };
}

function roundWonBy(match: DuelMatch, winner: DuelSeat, now: number): FailOutcome {
  const score = { ...match.score, [winner]: match.score[winner] + 1 };
  if (score[winner] >= match.rules.roundsToWin) {
    return {
      kind: "match-over",
      match: {
        ...match,
        seq: match.seq + 1,
        score,
        result: { winner, reason: "rounds" },
      },
    };
  }
  // Fresh round: the round LOSER runs first - the early clean course is the
  // comeback gift - and mints the fresh course when they arrive in handoff.
  const loser = otherSeat(winner);
  return {
    kind: "round-lost",
    match: {
      ...match,
      seq: match.seq + 1,
      score,
      round: match.round + 1,
      courseCode: null,
      courseVersion: null,
      turn: {
        number: 1,
        runner: loser,
        heartsLeft: match.rules.hearts,
        phase: "handoff",
        deadlineAt: now + HANDOFF_DEADLINE_MS,
      },
    },
  };
}

/**
 * Whether the WAITING player may claim the round on a blown clock. Only after
 * deadline plus grace, and never while a run is live: the in-game attempt
 * clock already bounds "running", so a laggy finish is not stolen.
 */
export function mayClaimForfeit(match: DuelMatch, claimant: DuelSeat, now: number): boolean {
  if (match.result || match.players.b === null) return false;
  if (match.turn.runner === claimant) return false;
  if (match.turn.phase === "running") return false;
  return now > match.turn.deadlineAt + FORFEIT_GRACE_MS;
}

export function claimForfeit(match: DuelMatch, claimant: DuelSeat, now: number): FailOutcome | null {
  if (!mayClaimForfeit(match, claimant, now)) return null;
  return roundWonBy(match, claimant, now);
}

/** A player leaving mid-match concedes it. */
export function concede(match: DuelMatch, leaver: DuelSeat): DuelMatch {
  return {
    ...match,
    seq: match.seq + 1,
    result: match.result ?? { winner: otherSeat(leaver), reason: "left" },
  };
}

/** Swap seats and reset for a rematch on the same channel, same base course. */
export function rematch(match: DuelMatch, now: number): DuelMatch | null {
  if (!match.result || !match.players.b) return null;
  const base =
    match.courseTitle !== null && match.courseBaseVersion !== null
      ? { title: match.courseTitle, version: match.courseBaseVersion }
      : null;
  return {
    ...createMatch(match.players.b, now, base),
    seq: match.seq + 1,
    players: { a: match.players.b, b: match.players.a },
  };
}

// --- Lobby ------------------------------------------------------------------

export function lobbyPostKey(connId: string): string {
  return `${LOBBY_POST_PREFIX}${connId}`;
}

export function parseLobbyPost(value: unknown): LobbyPost | null {
  if (!value || typeof value !== "object" || wireBytes(value) > 1_024) return null;
  const post = value as Record<string, unknown>;
  if (post.v !== DUEL_PROTOCOL) return null;
  if (!shortText(post.connId, 80) || (post.connId as string).length === 0) return null;
  if (!shortText(post.name, 40)) return null;
  if (post.avatarCode !== null && !shortText(post.avatarCode, 64)) return null;
  if (!shortText(post.note, 120)) return null;
  // Absent on posts written before custom courses existed.
  const courseTitle = post.courseTitle ?? null;
  if (courseTitle !== null && !shortText(courseTitle, 80)) return null;
  if (!finiteNumber(post.createdAt) || !finiteNumber(post.heartbeatAt)) return null;
  return { ...(post as unknown as LobbyPost), courseTitle: courseTitle as string | null };
}

export type LobbyFreshness = "fresh" | "dim" | "stale";

export function lobbyFreshness(post: LobbyPost, now: number): LobbyFreshness {
  const age = now - post.heartbeatAt;
  if (age > LOBBY_STALE_AFTER_MS) return "stale";
  if (age > LOBBY_DIM_AFTER_MS) return "dim";
  return "fresh";
}

/** Exposed for deterministic wire-size tests. */
export function duelWireBytes(value: unknown): number {
  return wireBytes(value);
}
