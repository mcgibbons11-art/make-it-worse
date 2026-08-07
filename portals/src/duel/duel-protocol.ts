// Duel Mode's rulebook, kept pure so every rule is testable without a
// Portals host. The transport (duel-session.ts) moves these records; this
// file decides what they mean and which writes are legitimate.
//
// Up to eight seats. The host gathers players until the lobby is full or they
// press Start (legal from two seats), then turns rotate through the active
// seats: clear the course and worsen it for the next runner, burn all your
// hearts and you are out of the round. The last survivor takes the round,
// and rounds take the match. At exactly two players this reduces to the
// original 1v1 rules move for move.
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

// 3: the eight-seat match record. Older records and messages are ignored
// outright rather than half-understood - every player in a channel is on the
// same published build in practice, and a version 2 client reading a record
// with seats E through H would see a half-empty four-player match and offer
// chairs that are already taken.
export const DUEL_PROTOCOL = 3;
/** Seats in the lobby, host included. */
export const MAX_DUEL_PLAYERS = 8;
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
/**
 * In-match liveness. The platform does not reliably report a peer whose page
 * died abruptly (a closed tab sends no goodbye), so each player sends a tiny
 * heartbeat message and the opponent is presumed gone on SILENCE: no
 * heartbeat, position, chat, or event for the stale window. Three missed
 * beats plus margin, so ordinary background-tab timer throttling cannot fake
 * an abandonment.
 */
export const HEARTBEAT_MS = 10_000;
export const PEER_STALE_MS = 35_000;

/** Lobby posts older than this render dimmed; older than stale are ignored. */
export const LOBBY_HEARTBEAT_MS = 20_000;
export const LOBBY_DIM_AFTER_MS = 45_000;
export const LOBBY_STALE_AFTER_MS = 90_000;


export const DUEL_SETUP_KEY = "miw-duel:setup";
export const DUEL_MATCH_KEY = "miw-duel:match";
/**
 * Written by the server script in portals/server/referee.ts, which Portals
 * runs as an invisible participant in every session. The `server:` prefix is
 * what makes it unforgeable: the platform rejects writes to that namespace
 * from clients, so a seating published under it cannot be raced or faked.
 * A session whose script is absent or dropped still plays identically - the
 * clients seat themselves, as they always did.
 */
export const REFEREE_STATE_KEY = "server:referee";
export const LOBBY_POST_PREFIX = "miw-duel-post:";
/**
 * The open lobby's channel. It has to be NAMED: joining without a channel
 * lands in the default one, which only reaches players already in the same
 * session, so an open challenge was visible to somebody sitting in the same
 * preview and to nobody else. A named channel spans them, which is what
 * invite codes were already relying on - `duel:<code>` has always been one.
 *
 * Everyone posting shares this one channel, so it inherits the documented
 * session limits: about 50 players and 64 state keys, one key per post.
 */
export const DUEL_LOBBY_CHANNEL = "miw-duel-lobby";

// --- The referee's lobby ------------------------------------------------------
//
// portals/server/referee.ts publishes this and clients read it. Both sides
// import these types from here so the wire shape has one definition, which is
// the whole reason the referee is compiled from TypeScript rather than
// hand-written as a second rulebook that drifts.

/** One seated player, as the referee assigned them. */
export interface RefereeSeatRecord {
  seat: DuelSeat;
  token: string;
  connId: string;
  name: string;
  avatarCode: string | null;
}

export interface RefereeLobby {
  build: number;
  v: typeof DUEL_PROTOCOL;
  seats: RefereeSeatRecord[];
  started: boolean;
  startedAt: number | null;
  /**
   * Counts this server's publishes. Its only job is to make every publish a
   * DIFFERENT value, so a republish of identical seating still reaches the
   * clients as a change - which is how they tell a server that is running
   * from one that crashed and left its last lobby sitting in shared state
   * forever. A crashed script is not cleaned up: the session simply carries
   * on without it, and nobody rewrites the key.
   */
  n: number;
}

/**
 * What a client sends the referee: claim a seat, or start the match. `seat`
 * names the seat the sender already holds in the match record, which a
 * replacement server honours so a restart puts everyone back where they were.
 */
export type RefereeClaim =
  | {
      k: "seat";
      v: typeof DUEL_PROTOCOL;
      token: string;
      name: string;
      avatarCode: string | null;
      seat: DuelSeat | null;
    }
  | { k: "start"; v: typeof DUEL_PROTOCOL; token: string };

/**
 * Believe a referee lobby only if it is entirely well formed. The value is
 * unforgeable - the platform rejects client writes to `server:` keys - but a
 * server running an older or newer build of this game is ordinary, and a
 * half-understood lobby would seat people wrongly rather than visibly fail.
 */
export function parseRefereeLobby(value: unknown): RefereeLobby | null {
  if (!value || typeof value !== "object" || wireBytes(value) > DUEL_WIRE_MAX_BYTES) return null;
  const lobby = value as Record<string, unknown>;
  if (lobby.v !== DUEL_PROTOCOL) return null;
  if (!finiteNumber(lobby.build) || !finiteNumber(lobby.n)) return null;
  if (typeof lobby.started !== "boolean") return null;
  if (lobby.startedAt !== null && !finiteNumber(lobby.startedAt)) return null;
  const seats = lobby.seats;
  if (!Array.isArray(seats) || seats.length > DUEL_SEATS.length) return null;
  const parsed: RefereeSeatRecord[] = [];
  for (const entry of seats) {
    if (!entry || typeof entry !== "object") return null;
    const seat = entry as Record<string, unknown>;
    if (!DUEL_SEATS.includes(seat.seat as DuelSeat)) return null;
    if (!shortText(seat.token, 80) || (seat.token as string).length === 0) return null;
    if (!shortText(seat.connId, 80)) return null;
    if (!shortText(seat.name, 40)) return null;
    if (seat.avatarCode !== null && !shortText(seat.avatarCode, 64)) return null;
    parsed.push(entry as RefereeSeatRecord);
  }
  // Two players in one seat is the exact failure a referee exists to prevent,
  // so a lobby claiming it is not one to trust.
  if (new Set(parsed.map((seat) => seat.seat)).size !== parsed.length) return null;
  return {
    build: lobby.build as number,
    v: DUEL_PROTOCOL,
    seats: parsed,
    started: lobby.started as boolean,
    startedAt: (lobby.startedAt as number | null) ?? null,
    n: lobby.n as number,
  };
}

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

export type DuelSeat = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h";
export const DUEL_SEATS: readonly DuelSeat[] = ["a", "b", "c", "d", "e", "f", "g", "h"];

/**
 * An empty value for every seat. Written from DUEL_SEATS rather than spelled
 * out, so adding a seat is one edit rather than a hunt for the literals that
 * would otherwise leave a chair permanently undefined.
 */
function perSeat<T>(value: T): Record<DuelSeat, T> {
  return Object.fromEntries(DUEL_SEATS.map((seat) => [seat, value])) as Record<DuelSeat, T>;
}

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

/** One decided round, for the end-of-match summary. */
export interface DuelRoundSummary {
  winner: DuelSeat;
  /** Turns the round lasted before it was decided. */
  turns: number;
  reason: "hearts" | "forfeit";
}

export interface DuelMatch {
  v: typeof DUEL_PROTOCOL;
  /** Monotonic write counter; readers ignore anything not newer. */
  seq: number;
  players: Record<DuelSeat, DuelPlayer | null>;
  rules: { roundsToWin: number; hearts: number };
  score: Record<DuelSeat, number>;
  /**
   * False while the host is still gathering players. Joining is legal only
   * before the start; every in-match transition is legal only after it.
   */
  started: boolean;
  /** Seats eliminated from the CURRENT round. Cleared when a round ends. */
  out: DuelSeat[];
  /** Seats gone from the match for good: they left or went silent. */
  retired: DuelSeat[];
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
  /** Every decided round so far, oldest first. */
  history: DuelRoundSummary[];
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
  /**
   * Everyone in the party so far, host first. The host never leaves the lobby
   * while gathering, so it keeps this honest with every heartbeat - which is
   * the whole reason the party gathers here rather than in a duel channel the
   * lobby cannot see into.
   */
  members: string[];
}

export type DuelWireMessage =
  | { k: "hb"; v: typeof DUEL_PROTOCOL }
  | { k: "pos"; v: typeof DUEL_PROTOCOL; x: number; y: number; z: number; yaw: number; flags: number }
  | { k: "evt"; v: typeof DUEL_PROTOCOL; type: "start" | "death" | "clear" | "trap-hit" | "place"; label?: string }
  | { k: "chat"; v: typeof DUEL_PROTOCOL; text: string }
  | { k: "react"; v: typeof DUEL_PROTOCOL; emoji: string }
  | { k: "duel-claim"; v: typeof DUEL_PROTOCOL; to: string; name?: string }
  | { k: "duel-accept"; v: typeof DUEL_PROTOCOL; to: string; code: string }
  // The host closing the party and taking everyone to the duel channel. The
  // seat is assigned here, in the one place that knows who joined in what
  // order, so nobody has to race for one on arrival.
  | { k: "party-go"; v: typeof DUEL_PROTOCOL; to: string; code: string; seat: DuelSeat }
  | { k: "duel-deny"; v: typeof DUEL_PROTOCOL; to: string; reason: "taken" | "closed" }
  ;

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
    case "hb":
      return { k: "hb", v: DUEL_PROTOCOL };
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
        ? {
            k: "duel-claim", v: DUEL_PROTOCOL, to: message.to as string,
            // The claimant announces who they are; absent on older builds.
            ...(shortText(message.name, 40) && (message.name as string).trim()
              ? { name: (message.name as string).trim() }
              : {}),
          }
        : null;
    case "duel-accept":
      return shortText(message.to, 80) && normalizeDuelCode((message.code as string) ?? "") !== null
        ? { k: "duel-accept", v: DUEL_PROTOCOL, to: message.to as string, code: normalizeDuelCode(message.code as string)! }
        : null;
    case "party-go":
      return shortText(message.to, 80) &&
        (message.to as string).length > 0 &&
        normalizeDuelCode((message.code as string) ?? "") !== null &&
        DUEL_SEATS.includes(message.seat as DuelSeat)
        ? {
            k: "party-go", v: DUEL_PROTOCOL, to: message.to as string,
            code: normalizeDuelCode(message.code as string)!,
            seat: message.seat as DuelSeat,
          }
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
  // seq counts up from 1 and orders every write. A negative or fractional
  // one is not a record that lost a race, it is a record nobody legitimate
  // wrote, and one that would lose every supersedes() comparison forever.
  if (match.v !== DUEL_PROTOCOL || !finiteNumber(match.seq)) return null;
  if (!Number.isInteger(match.seq) || match.seq < 1) return null;
  const players = match.players as DuelMatch["players"] | undefined;
  if (
    !players ||
    !validPlayer(players.a) ||
    !DUEL_SEATS.every(
      (seat) => seat === "a" || players[seat] === null || validPlayer(players[seat]),
    )
  ) return null;
  const turn = match.turn as DuelTurn | undefined;
  if (
    !turn ||
    !finiteNumber(turn.number) ||
    !DUEL_SEATS.includes(turn.runner) ||
    !finiteNumber(turn.heartsLeft) ||
    !["handoff", "running", "worsening"].includes(turn.phase) ||
    !finiteNumber(turn.deadlineAt)
  ) return null;
  const score = match.score as DuelMatch["score"] | undefined;
  if (!score || !DUEL_SEATS.every((seat) => finiteNumber(score[seat]))) return null;
  if (typeof match.started !== "boolean") return null;
  const seatList = (value: unknown): value is DuelSeat[] =>
    Array.isArray(value) &&
    value.length <= DUEL_SEATS.length &&
    value.every((seat) => DUEL_SEATS.includes(seat as DuelSeat));
  if (!seatList(match.out) || !seatList(match.retired)) return null;
  if (!finiteNumber(match.round)) return null;
  if (match.courseCode !== null && !shortText(match.courseCode, 8_000)) return null;
  if (match.courseVersion !== null && !shortText(match.courseVersion, 80)) return null;
  // Absent on records written before custom courses existed; normalized to
  // null so every parsed record has the full shape.
  const courseTitle = match.courseTitle ?? null;
  const courseBaseVersion = match.courseBaseVersion ?? null;
  if (courseTitle !== null && !shortText(courseTitle, 80)) return null;
  if (courseBaseVersion !== null && !shortText(courseBaseVersion, 80)) return null;
  const history = match.history ?? [];
  if (
    !Array.isArray(history) ||
    history.length > 16 ||
    !history.every(
      (round: unknown) =>
        !!round &&
        typeof round === "object" &&
        DUEL_SEATS.includes((round as DuelRoundSummary).winner) &&
        finiteNumber((round as DuelRoundSummary).turns) &&
        ["hearts", "forfeit"].includes((round as DuelRoundSummary).reason),
    )
  ) return null;
  const result = match.result as DuelResult | null | undefined;
  if (result !== null && result !== undefined) {
    if (!DUEL_SEATS.includes(result.winner) ||
      !["rounds", "forfeit", "left"].includes(result.reason)) return null;
  }
  return { ...(match as DuelMatch), courseTitle, courseBaseVersion, history };
}

export function seatOf(match: DuelMatch, token: string): DuelSeat | null {
  for (const seat of DUEL_SEATS)
    if (match.players[seat]?.token === token) return seat;
  return null;
}

/** Seats holding a player who has not permanently left the match. */
export function seatedSeats(match: DuelMatch): DuelSeat[] {
  return DUEL_SEATS.filter(
    (seat) => match.players[seat] !== null && !match.retired.includes(seat),
  );
}

/** Seated seats still alive in the CURRENT round. */
export function activeSeats(match: DuelMatch): DuelSeat[] {
  return seatedSeats(match).filter((seat) => !match.out.includes(seat));
}

/** The next active seat clockwise after `from`, or null when nobody else is. */
export function nextRunner(match: DuelMatch, from: DuelSeat): DuelSeat | null {
  const start = DUEL_SEATS.indexOf(from);
  for (let step = 1; step <= DUEL_SEATS.length; step += 1) {
    const seat = DUEL_SEATS[(start + step) % DUEL_SEATS.length]!;
    if (seat !== from && activeSeats(match).includes(seat)) return seat;
  }
  return null;
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
    players: { ...perSeat<DuelPlayer | null>(null), a: host },
    rules: { roundsToWin: ROUNDS_TO_WIN, hearts: HEARTS_PER_TURN },
    score: perSeat(0),
    started: false,
    out: [],
    retired: [],
    round: 1,
    turn: { number: 1, runner: "a", heartsLeft: HEARTS_PER_TURN, phase: "handoff", deadlineAt: now + HANDOFF_DEADLINE_MS },
    courseCode: null,
    courseVersion: null,
    courseTitle: base?.title.slice(0, 80) ?? null,
    courseBaseVersion: base?.version ?? null,
    history: [],
    result: null,
  };
}

/**
 * A joiner takes a seat. Legal only while the host is still gathering: once
 * the match starts the lobby is closed, which is what stops a late arrival
 * from appearing mid-round with no turn and no hearts.
 *
 * Pass `assigned` to take a seat the referee handed out, which is the point
 * of having one - two joiners can no longer pick the same lowest free seat.
 * Omit it and the joiner picks for itself, exactly as it did before any
 * server script existed, because a session without a referee has to play the
 * same.
 */
export function joinMatch(
  match: DuelMatch,
  joiner: DuelPlayer,
  assigned: DuelSeat | null = null,
): DuelMatch | null {
  if (match.started || match.result) return null;
  const seat = assigned ?? DUEL_SEATS.find((free) => match.players[free] === null) ?? null;
  if (!seat) return null;
  // An assigned seat someone else already holds means the record and the
  // referee disagree. Refuse rather than evict a seated player.
  const sitting = match.players[seat];
  if (sitting && sitting.token !== joiner.token) return null;
  return { ...match, seq: match.seq + 1, players: { ...match.players, [seat]: joiner } };
}

/**
 * Empty a seat while the lobby is still gathering, for a guest who walked
 * away. Leaving a match under way is a concession, which costs the leaver the
 * match; leaving a lobby that has not started is just leaving, and the others
 * keep gathering. The seat also has to be recoverable when its holder simply
 * closed the tab and published nothing, which is what a referee reports and
 * a match record can never notice on its own.
 */
export function vacateSeat(match: DuelMatch, seat: DuelSeat): DuelMatch {
  if (match.started || match.result || match.players[seat] === null) return match;
  return { ...match, seq: match.seq + 1, players: { ...match.players, [seat]: null } };
}

/** The seat a referee has assigned this token, if it has assigned one. */
export function refereeSeatOf(lobby: RefereeLobby | null, token: string): DuelSeat | null {
  return lobby?.seats.find((seat) => seat.token === token)?.seat ?? null;
}

/** Two seats is a duel; four is the ceiling the lobby fills to. */
export function mayStartMatch(match: DuelMatch): boolean {
  return !match.started && !match.result && seatedSeats(match).length >= 2;
}

/**
 * The host closes the lobby and the first turn begins. The host always runs
 * first, which is also what the 1v1 rules did.
 */
export function startMatch(match: DuelMatch, now: number): DuelMatch | null {
  if (!mayStartMatch(match)) return null;
  return {
    ...match,
    seq: match.seq + 1,
    started: true,
    turn: {
      number: 1,
      runner: "a",
      heartsLeft: match.rules.hearts,
      phase: "handoff",
      deadlineAt: now + HANDOFF_DEADLINE_MS,
    },
  };
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
  /** A seat is out of this round, but the round runs on among survivors. */
  | { kind: "eliminated"; seat: DuelSeat; match: DuelMatch }
  | { kind: "round-lost"; match: DuelMatch }
  | { kind: "match-over"; match: DuelMatch };

/**
 * Runner burned an attempt. The third burn puts them OUT of the round rather
 * than handing it over: with more than two players the round continues among
 * the survivors, and only when one is left does the round end. At two
 * players the last survivor is the opponent, which is exactly the old rule.
 */
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
  return eliminate(match, match.turn.runner, now, "hearts");
}

/**
 * Knock a seat out of the current round and pass the turn on. The last seat
 * standing wins the round; a round that somehow empties (a simultaneous
 * abandonment) is awarded to the seat that went out last, so no record can
 * strand a match with nobody to advance it.
 */
function eliminate(
  match: DuelMatch,
  seat: DuelSeat,
  now: number,
  how: DuelRoundSummary["reason"],
): FailOutcome {
  const out = match.out.includes(seat) ? match.out : [...match.out, seat];
  const knocked: DuelMatch = { ...match, out };
  const survivors = activeSeats(knocked);
  if (survivors.length <= 1) {
    return roundWonBy(knocked, survivors[0] ?? seat, now, how);
  }
  // The turn passes to the next survivor after the eliminated seat, on the
  // course as it stands: an elimination does not reset the worsening.
  const next = nextRunner(knocked, seat) ?? survivors[0]!;
  return {
    kind: "eliminated",
    seat,
    match: {
      ...knocked,
      seq: match.seq + 1,
      turn: {
        number: match.turn.number + 1,
        runner: next,
        heartsLeft: match.rules.hearts,
        phase: "handoff",
        deadlineAt: now + HANDOFF_DEADLINE_MS,
      },
    },
  };
}

/** Runner cleared the course and now owns the worsening phase. */
export function clearRun(match: DuelMatch, now: number): DuelMatch {
  return {
    ...match,
    seq: match.seq + 1,
    turn: { ...match.turn, phase: "worsening", deadlineAt: now + WORSEN_DEADLINE_MS },
  };
}

/** Worsening done: the new course code hands the turn to the next survivor. */
export function handOff(match: DuelMatch, code: string, version: string, now: number): DuelMatch {
  const next = nextRunner(match, match.turn.runner) ?? match.turn.runner;
  return {
    ...match,
    seq: match.seq + 1,
    courseCode: code,
    courseVersion: version,
    turn: {
      number: match.turn.number + 1,
      runner: next,
      heartsLeft: match.rules.hearts,
      phase: "handoff",
      deadlineAt: now + HANDOFF_DEADLINE_MS,
    },
  };
}

function roundWonBy(
  match: DuelMatch,
  winner: DuelSeat,
  now: number,
  how: DuelRoundSummary["reason"],
): FailOutcome {
  const score = { ...match.score, [winner]: match.score[winner] + 1 };
  const history = [
    ...match.history,
    { winner, turns: match.turn.number, reason: how },
  ];
  if (score[winner] >= match.rules.roundsToWin) {
    return {
      kind: "match-over",
      match: {
        ...match,
        seq: match.seq + 1,
        score,
        history,
        result: { winner, reason: "rounds" },
      },
    };
  }
  // Fresh round: everyone knocked out is back in, and the seat eliminated
  // FIRST runs first - the early clean course is the comeback gift, handed
  // to whoever has been waiting longest. At two players that is the round
  // loser, exactly as the 1v1 rules had it.
  const revived: DuelMatch = { ...match, score, history, out: [] };
  const first = match.out[0] ?? nextRunner(revived, winner) ?? winner;
  return {
    kind: "round-lost",
    match: {
      ...revived,
      seq: match.seq + 1,
      round: match.round + 1,
      courseCode: null,
      courseVersion: null,
      turn: {
        number: 1,
        runner: first,
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
export function mayClaimForfeit(
  match: DuelMatch,
  claimant: DuelSeat,
  now: number,
  runnerGone = false,
): boolean {
  if (match.result || !match.started) return false;
  if (match.turn.runner === claimant) return false;
  // Only a seat still alive in the round may claim.
  if (!activeSeats(match).includes(claimant)) return false;
  // A runner who has gone silent can be claimed whatever they were doing.
  // The mid-run exemption below protects somebody who is PLAYING and simply
  // slow; it must not protect somebody who has left, or a player who quits
  // mid-attempt freezes the match for everyone still in it, with no clock
  // that ever runs out because the turn never advances.
  if (runnerGone) return true;
  if (match.turn.phase === "running") return false;
  return now > match.turn.deadlineAt + FORFEIT_GRACE_MS;
}

/**
 * A blown clock eliminates the STALLED RUNNER rather than handing the round
 * to the claimant outright: with a full table the other survivors have not
 * lost anything by one player going quiet.
 */
export function claimForfeit(
  match: DuelMatch,
  claimant: DuelSeat,
  now: number,
  runnerGone = false,
): FailOutcome | null {
  if (!mayClaimForfeit(match, claimant, now, runnerGone)) return null;
  const stalled = match.turn.runner;
  // A runner who has GONE is retired, not merely knocked out of the round.
  // Taking the round off them leaves them seated and opening the next one,
  // so the survivors would have to claim against the same empty chair every
  // round until the match ran out. Somebody who has left has left.
  if (runnerGone) {
    const next = concede(match, stalled, now);
    return next.result
      ? { kind: "match-over", match: next }
      : { kind: "eliminated", seat: stalled, match: next };
  }
  return eliminate(match, stalled, now, "forfeit");
}

/**
 * A player leaving mid-match retires their seat for good. With others still
 * playing the match simply carries on without them; when only one seat is
 * left standing, that player takes the match.
 */
export function concede(match: DuelMatch, leaver: DuelSeat, now: number): DuelMatch {
  if (match.result) return match;
  const retired = match.retired.includes(leaver) ? match.retired : [...match.retired, leaver];
  const out = match.out.includes(leaver) ? match.out : [...match.out, leaver];
  const gone: DuelMatch = { ...match, retired, out };
  const remaining = seatedSeats(gone);
  if (remaining.length <= 1) {
    return {
      ...gone,
      seq: match.seq + 1,
      result: { winner: remaining[0] ?? leaver, reason: "left" },
    };
  }
  // The leaver was mid-turn, so the turn has to move on or the match stalls
  // on an empty seat. Otherwise the record just loses a player.
  if (match.started && match.turn.runner === leaver) {
    const outcome = eliminate(gone, leaver, now, "forfeit");
    return outcome.match;
  }
  return { ...gone, seq: match.seq + 1 };
}

/**
 * Reset for a rematch on the same channel with the same lineup and base
 * course. The seat order rotates by one so a different player opens, which
 * is the multi-player generalisation of the old two-seat swap.
 */
export function rematch(match: DuelMatch, now: number): DuelMatch | null {
  if (!match.result) return null;
  const lineup = seatedSeats(match).map((seat) => match.players[seat]!);
  if (lineup.length < 2) return null;
  const base =
    match.courseTitle !== null && match.courseBaseVersion !== null
      ? { title: match.courseTitle, version: match.courseBaseVersion }
      : null;
  const rotated = [...lineup.slice(1), lineup[0]!];
  const players = perSeat<DuelPlayer | null>(null);
  rotated.forEach((player, index) => {
    players[DUEL_SEATS[index]!] = player;
  });
  return {
    ...createMatch(rotated[0]!, now, base),
    seq: match.seq + 1,
    players,
    // A rematch is a lineup that has already agreed to play: it starts live
    // rather than dropping everyone back into the gathering lobby.
    started: true,
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
  // Absent on posts written before parties existed: those read as a party of
  // one, which is exactly what they were.
  const raw = Array.isArray(post.members) ? post.members : [post.name];
  if (raw.length > DUEL_SEATS.length) return null;
  const members: string[] = [];
  for (const member of raw) {
    if (!shortText(member, 40) || (member as string).length === 0) return null;
    members.push(member as string);
  }
  return {
    ...(post as unknown as LobbyPost),
    courseTitle: courseTitle as string | null,
    members,
  };
}

export type LobbyFreshness = "fresh" | "dim" | "stale";

/**
 * Whether a listing is old enough that its key should be cleared, not merely
 * hidden. A host that closed its tab never got to clear its own, and 64 keys
 * is the documented ceiling for a session.
 */
export function lobbyPostAbandoned(post: LobbyPost, now: number): boolean {
  return now - post.heartbeatAt > LOBBY_STALE_AFTER_MS * 2;
}

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
