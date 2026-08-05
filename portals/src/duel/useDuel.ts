// The duel's brain: one hook that owns the matchmaking stage machine, the
// live match record, and the traffic between them. PortalsApp stays the owner
// of the actual run (attempts, hearts are spent through its fail/complete
// callbacks); this hook decides whose turn it is and what the record says.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  encodeChallengeLink,
  decodeChallengeLink,
  decodeChallengeRuntimeTrack,
} from "@/lib/game/challenge-link";
import {
  avatarFromCode,
  avatarToCode,
  type AvatarConfig,
} from "@/lib/game/avatar";
import {
  ensureRequiredEndpoints,
  generateRandomRoom,
  runtimeMap,
} from "@/components/game/RoomBuilder";
import type { BuiltTrack } from "@/lib/game/track";
import type { ChallengeDTO, DecodedGhostSample } from "@/lib/game/types";
import {
  ABANDON_TIMEOUT_MS,
  DUEL_PROTOCOL,
  FORFEIT_GRACE_MS,
  HEARTBEAT_MS,
  PEER_STALE_MS,
  beginRun,
  claimForfeit,
  clearRun,
  concede,
  createMatch,
  failAttempt,
  handOff,
  joinMatch,
  lobbyFreshness,
  mayClaimForfeit,
  mintDuelCode,
  normalizeDuelCode,
  refereeSeatOf,
  seatedSeats,
  mayStartMatch,
  startMatch,
  MAX_DUEL_PLAYERS,
  rematch,
  refreshConnection,
  seatOf,
  setCourse,
  vacateSeat,
  type DuelMatch,
  type DuelSeat,
  type DuelWireMessage,
  type LobbyPost,
  type RefereeLobby,
} from "./duel-protocol";
import {
  connectDuelChannel,
  connectDuelLobby,
  duelToken,
  type DuelChannelConnection,
  type DuelLobbyConnection,
} from "./duel-session";
import {
  listRememberedPublishedMaps,
  type PublishedMapRecord,
} from "../published-map-catalog";

const ACTIVE_DUEL_STORAGE_KEY = "miw:duel-active-code";
/** Streamed run positions: every other 15Hz ghost sample, ~7.5 msgs/s. */
const POS_SEND_DIVISOR = 2;
const CHAT_LIMIT = 60;
const FEED_LIMIT = 24;
/** How long a lobby claim waits for the poster before it lapses, both sides. */
const CLAIM_TIMEOUT_MS = 5 * 60_000;
/**
 * How long a seatless client waits for the referee to assign it a seat before
 * seating itself. A referee that has gone quiet - dropped for its CPU budget,
 * restarted, or never there at all - must not be able to lock anyone out of a
 * duel, so the wait always expires into the original behaviour.
 */
const REFEREE_SEAT_GRACE_MS = 2_500;

export type DuelStage =
  | { kind: "closed" }
  | { kind: "menu" }
  | { kind: "joining" }
  | { kind: "lobby"; posted: boolean }
  | { kind: "connecting" }
  | { kind: "waiting"; code: string }
  | { kind: "match"; code: string }
  | { kind: "error"; message: string };

export interface DuelLobbyPostView extends LobbyPost {
  /** Precomputed at arrival so rendering stays pure. */
  dim: boolean;
}

export interface DuelChatEntry {
  id: number;
  from: "you" | "them";
  text: string;
}

export interface DuelFeedEntry {
  id: number;
  text: string;
}

/** One seated player, as the lobby and score strip render them. */
export interface DuelRosterEntry {
  seat: DuelSeat;
  name: string;
  avatarCode: string | null;
  isYou: boolean;
  isRunner: boolean;
  /** Knocked out of the current round but still in the match. */
  out: boolean;
  score: number;
}

export interface DuelCourse {
  challenge: ChallengeDTO;
  track: BuiltTrack | null;
  version: string;
}

/** An outgoing lobby claim, visible until answered, cancelled, or lapsed. */
export interface DuelPendingClaim {
  connId: string;
  posterName: string;
  expiresAt: number;
}

export interface DuelApi {
  stage: DuelStage;
  /** True while this hook owns the single Portals.net connection. */
  netActive: boolean;
  match: DuelMatch | null;
  mySeat: DuelSeat | null;
  myTurn: boolean;
  opponentName: string;
  opponentAvatar: AvatarConfig | null;
  peerConnected: boolean;
  posts: DuelLobbyPostView[];
  /** The player currently claiming this poster's challenge, or null. */
  claimFrom: { connId: string; name: string } | null;
  /** The claim this player sent and is still waiting on. */
  pendingClaim: DuelPendingClaim | null;
  /** Whole seconds until the pending claim lapses, clamped at zero. */
  claimSecondsLeft: number;
  /** One-line lobby status, e.g. that a request expired unanswered. */
  lobbyNotice: string | null;
  chat: DuelChatEntry[];
  feed: DuelFeedEntry[];
  /** Latest streamed opponent position, for the live spectator ghost. */
  spectateSampleRef: { current: DecodedGhostSample | null };
  /** Whole seconds since the spectated run started, or null between runs. */
  spectateSeconds: number | null;
  /** The course the current turn runs, decoded once per version. */
  course: DuelCourse | null;
  /** This player's published maps, offered as duel courses. */
  mapChoices: PublishedMapRecord[];
  /** versionId of the chosen map, or null for a random clean course. */
  courseChoice: string | null;
  chooseCourse(versionId: string | null): void;
  forfeitClaimable: boolean;
  /** Whole seconds until the current turn's deadline, clamped at zero. */
  deadlineSeconds: number;
  /** Seconds until a vanished opponent forfeits the match, or null. */
  abandonSecondsLeft: number | null;
  rejoinableCode: string | null;

  open(): void;
  close(): void;
  hostPrivate(): void;
  joinWithCode(raw: string): void;
  rejoin(): void;
  enterLobby(): void;
  leaveLobby(): void;
  postToLobby(note: string): void;
  unpost(): void;
  claimPost(connId: string): void;
  cancelClaim(): void;
  acceptClaim(): void;
  denyClaim(): void;
  sendChat(text: string): void;
  sendReaction(emoji: string): void;
  claimTimeout(): void;
  concedeMatch(): void;
  requestRematch(): void;
  /** Everyone seated, in seat order, for the lobby and the score strip. */
  roster: DuelRosterEntry[];
  /** True for the host while the lobby can still legally be started. */
  canStartMatch: boolean;
  /** Host only: close the lobby and begin the match. */
  startNow(): void;
  /** Seats still open in the gathering lobby. */
  openSeats: number;
  /**
   * Whether Portals ran this game's server script for the session. When true
   * the referee assigns seats; when false the clients seat themselves exactly
   * as they did before it existed. Surfaced so a real match can answer
   * whether a GitHub-synced bundle gets a server script at all.
   */
  refereeOnline: boolean;

  /** PortalsApp calls these from its own run lifecycle. */
  noteRunStarted(): void;
  noteRunSample(sample: DecodedGhostSample): void;
  noteRunFailed(): void;
  noteRunCleared(): void;
  noteWorsened(challenge: ChallengeDTO, track: BuiltTrack | null): void;
}

// sessionStorage to match the token's tab-scoped identity: a rejoin offer is
// only honest in the tab whose token still holds the seat.
function activeCodeRead(): string | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(ACTIVE_DUEL_STORAGE_KEY);
    return raw ? normalizeDuelCode(raw) : null;
  } catch {
    return null;
  }
}

function activeCodeWrite(code: string | null) {
  try {
    if (code === null) globalThis.sessionStorage?.removeItem(ACTIVE_DUEL_STORAGE_KEY);
    else globalThis.sessionStorage?.setItem(ACTIVE_DUEL_STORAGE_KEY, code);
  } catch {
    // Private mode: rejoin-after-reload is simply not offered.
  }
}

export function useDuel(input: {
  playerName: string;
  avatar: AvatarConfig | null;
  avatarSeed: number;
  /**
   * Awaited before every net.join. The SDK holds ONE connection, and the map
   * relay owns it between duels; joining while that session is still attached
   * races the SDK and the join dies silently. The shell hands the connection
   * over here, resolving only once the previous session has fully left.
   */
  acquireNet?: () => Promise<void>;
}): DuelApi {
  const { playerName, avatar, avatarSeed, acquireNet } = input;
  const [stage, setStage] = useState<DuelStage>({ kind: "closed" });
  const [match, setMatch] = useState<DuelMatch | null>(null);
  const [posts, setPosts] = useState<DuelLobbyPostView[]>([]);
  const [claimFrom, setClaimFrom] = useState<{ connId: string; name: string } | null>(null);
  const [pendingClaim, setPendingClaim] = useState<DuelPendingClaim | null>(null);
  const [lobbyNotice, setLobbyNotice] = useState<string | null>(null);
  const pendingClaimRef = useRef<DuelPendingClaim | null>(null);
  const claimLapseTimer = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const hostClaimLapseTimer = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const [chat, setChat] = useState<DuelChatEntry[]>([]);
  const [feed, setFeed] = useState<DuelFeedEntry[]>([]);
  const [peerConnected, setPeerConnected] = useState(false);
  /**
   * The session's referee lobby, or null when no server script is present.
   * When it exists the clients defer their SEATING to it - one writer cannot
   * hand the same seat to two people - and everything after the start runs on
   * the client protocol exactly as it does without one.
   */
  const [refereeLobby, setRefereeLobby] = useState<RefereeLobby | null>(null);
  // Written by the handler rather than mirrored from the state during render:
  // the lobby arrives inside connectDuelChannel, and the code that decides how
  // to seat runs the moment that resolves, well before React re-renders.
  const refereeLobbyRef = useRef<RefereeLobby | null>(null);
  /** When the opponent was last presumed gone, for the abandonment clock. */
  const [peerLostAt, setPeerLostAt] = useState<number | null>(null);
  /** Last proof of life off the wire: join, any message, or initial peers. */
  const peerSignalAt = useRef(0);
  /** When the opponent's current run began, for the spectator clock. */
  const [spectateStartedAt, setSpectateStartedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [mapChoices, setMapChoices] = useState<PublishedMapRecord[]>([]);
  const [courseChoice, setCourseChoice] = useState<string | null>(null);
  // The chosen base at the moment a match is created, read inside
  // enterChannel where createMatch runs.
  const chosenBaseRef = useRef<{ title: string; version: string } | null>(null);
  // The pristine base course's challenge code, cached so the round-loser can
  // re-mint later rounds from it. Seeded by the chooser at host time and by
  // both players whenever the record shows the base itself running.
  const baseCourseRef = useRef<{ version: string; code: string } | null>(null);
  const token = useMemo(() => duelToken(), []);
  const lobby = useRef<DuelLobbyConnection | null>(null);
  const channel = useRef<DuelChannelConnection | null>(null);
  const matchRef = useRef<DuelMatch | null>(null);
  const activeCodeRef = useRef<string | null>(null);
  const spectateSampleRef = useRef<DecodedGhostSample | null>(null);
  const sampleCounter = useRef(0);
  const serial = useRef(0);
  /** When we joined the current channel, for the referee's grace window. */
  const channelJoinedAt = useRef(0);
  /** Bumped when that window expires, to re-run the seating effect below. */
  const [seatAttempt, setSeatAttempt] = useState(0);
  const rejoinableCode = useMemo(() => activeCodeRead(), []);

  const refereeOnline = refereeLobby !== null;
  const mySeat = match ? seatOf(match, token) : null;
  const myTurn = match !== null && mySeat !== null && match.turn.runner === mySeat && !match.result;
  // Everyone in the lobby, and the one player whose run is streamed to the
  // rest: the current runner, whoever that is among up to four seats.
  const roster = useMemo<DuelRosterEntry[]>(
    () =>
      match
        ? seatedSeats(match).map((seat) => ({
            seat,
            name: match.players[seat]!.name,
            avatarCode: match.players[seat]!.avatarCode,
            isYou: seat === mySeat,
            isRunner: seat === match.turn.runner,
            out: match.out.includes(seat),
            score: match.score[seat],
          }))
        : [],
    [match, mySeat],
  );
  // Only the host may start, and only from the gathering lobby.
  const canStartMatch = match !== null && mySeat === "a" && mayStartMatch(match);
  const openSeats = match ? MAX_DUEL_PLAYERS - seatedSeats(match).length : 0;
  const opponent =
    match && match.turn.runner !== mySeat ? match.players[match.turn.runner] : null;
  const opponentName = opponent?.name ?? "Opponent";
  const opponentAvatarCode = opponent?.avatarCode ?? null;
  const opponentAvatar = useMemo(
    () => (opponentAvatarCode ? avatarFromCode(opponentAvatarCode) : null),
    [opponentAvatarCode],
  );
  // Decoding is pure, so the shared course is derived rather than mirrored
  // into state: each version decodes once and a damaged code reads as "no
  // course yet" instead of crashing a render.
  const courseCode = match?.courseCode ?? null;
  const courseVersion = match?.courseVersion ?? null;
  const course = useMemo<DuelCourse | null>(() => {
    if (!courseCode || !courseVersion) return null;
    try {
      return {
        challenge: decodeChallengeLink(courseCode),
        track: decodeChallengeRuntimeTrack(courseCode),
        version: courseVersion,
      };
    } catch {
      return null;
    }
  }, [courseCode, courseVersion]);
  // A new course means the previous run's last streamed position is stale.
  useEffect(() => {
    spectateSampleRef.current = null;
  }, [courseVersion]);
  // Whenever the record shows the pristine base itself running (round
  // openers), remember its code: the wire budget cannot carry the base
  // alongside the current course, and whichever player opens the next round
  // needs it to re-mint. Both players witness round 1, so both learn it.
  useEffect(() => {
    if (
      match?.courseBaseVersion &&
      match.courseCode &&
      match.courseVersion === match.courseBaseVersion
    )
      baseCourseRef.current = { version: match.courseBaseVersion, code: match.courseCode };
  }, [match]);

  const pushFeed = useCallback((text: string) => {
    setFeed((entries) => [...entries.slice(-(FEED_LIMIT - 1)), { id: (serial.current += 1), text }]);
  }, []);
  const pushChat = useCallback((from: "you" | "them", text: string) => {
    setChat((entries) => [...entries.slice(-(CHAT_LIMIT - 1)), { id: (serial.current += 1), from, text }]);
  }, []);

  /**
   * Publish a new record and adopt it locally in the same breath. Writing a
   * record that seats both players IS entering the match - the joiner's own
   * write never comes back through onMatch (seq guards drop echoes), so the
   * stage flip has to happen here, not only on arriving records.
   */
  const publish = useCallback((next: DuelMatch) => {
    matchRef.current = next;
    setMatch(next);
    channel.current?.publishMatch(next);
    // The MATCH stage begins when the host starts it, not when a second seat
    // fills: the gathering lobby is its own screen now.
    if (next.started && !next.result && activeCodeRef.current) {
      setStage((current) =>
        current.kind === "match" ? current : { kind: "match", code: activeCodeRef.current! },
      );
    }
  }, []);

  const clearPendingClaim = useCallback(() => {
    if (claimLapseTimer.current !== null) globalThis.clearTimeout(claimLapseTimer.current);
    claimLapseTimer.current = null;
    pendingClaimRef.current = null;
    setPendingClaim(null);
  }, []);
  const clearHostClaim = useCallback(() => {
    if (hostClaimLapseTimer.current !== null) globalThis.clearTimeout(hostClaimLapseTimer.current);
    hostClaimLapseTimer.current = null;
    setClaimFrom(null);
  }, []);

  const dropLobby = useCallback(async () => {
    const connection = lobby.current;
    lobby.current = null;
    setPosts([]);
    setLobbyNotice(null);
    clearPendingClaim();
    clearHostClaim();
    if (connection) await connection.close().catch(() => undefined);
  }, [clearHostClaim, clearPendingClaim]);
  const dropChannel = useCallback(async () => {
    const connection = channel.current;
    channel.current = null;
    if (connection) await connection.close().catch(() => undefined);
  }, []);

  const me = useCallback(
    (connId: string) => ({
      token,
      connId,
      name: playerName.trim().slice(0, 40) || "Runner",
      avatarCode: avatar ? avatarToCode(avatar) : null,
    }),
    [avatar, playerName, token],
  );

  /**
   * Join the invite code's channel and take a seat. Every path into a match
   * funnels through here: hosting (creates the record), joining (claims seat
   * B), and rejoining (refreshes the connection behind a known token).
   */
  const enterChannel = useCallback(
    async (code: string, role: "host" | "join") => {
      setStage({ kind: "connecting" });
      activeCodeRef.current = code;
      await dropLobby();
      await acquireNet?.().catch(() => undefined);
      const result = await connectDuelChannel(code, {
        onMatch: (record) => {
          matchRef.current = record;
          setMatch(record);
          if (record.started && !record.result) setStage({ kind: "match", code });
        },
        onMessage: (message) => {
          peerSignalAt.current = Date.now();
          switch (message.k) {
            case "pos":
              spectateSampleRef.current = {
                x: message.x, y: message.y, z: message.z, yaw: message.yaw, flags: message.flags,
              };
              break;
            case "evt": {
              // The spectator clock keys off the runner's own announcements;
              // network skew of a message hop is invisible at whole seconds.
              if (message.type === "start") setSpectateStartedAt(Date.now());
              if (message.type === "death" || message.type === "clear")
                setSpectateStartedAt(null);
              // The feed names whoever is actually running, which with
              // four seats is rarely "the opponent".
              const current = matchRef.current;
              const runnerName = current?.players[current.turn.runner]?.name ?? "The runner";
              const line = {
                start: `${runnerName} started a run.`,
                death: `${runnerName} went down${message.label ? ` to ${message.label}` : ""}.`,
                clear: `${runnerName} cleared the course.`,
                "trap-hit": `${runnerName} hit ${message.label ?? "a trap"}.`,
                place: `${runnerName} placed ${message.label ?? "a trap"}.`,
              }[message.type];
              if (line) pushFeed(line);
              break;
            }
            case "chat":
              pushChat("them", message.text);
              break;
            case "react":
              pushFeed(message.emoji);
              break;
            default:
              break;
          }
        },
        // Seat claiming is the JOINER's job alone: a host-side provisional
        // seat raced the joiner's own claim (both bumped the same seq with
        // different players.b) and last-write-wins could leave the joiner
        // seatless in its own match.
        onPeerJoin: () => {
          peerSignalAt.current = Date.now();
          setPeerConnected(true);
        },
        onPeerLeave: () => {
          setPeerConnected(false);
          spectateSampleRef.current = null;
          pushFeed("Opponent disconnected. They can rejoin with the same code.");
        },
        onStatus: (status) => {
          if (status === "disconnected") pushFeed("Connection to Portals lost. Waiting for it to return…");
        },
        onReferee: (lobby) => {
          refereeLobbyRef.current = lobby;
          setRefereeLobby(lobby);
        },
      });
      if (result.status !== "ok") {
        setStage({
          kind: "error",
          message:
            result.status === "unavailable"
              ? "Duels need a Portals host. Open the game on portals.to to play."
              : result.message,
        });
        return;
      }
      channel.current = result.connection;
      channelJoinedAt.current = Date.now();
      setPeerConnected(result.peers.length > 0);
      // A peer present at connect counts as a fresh signal; an absent one
      // leaves the signal clock at zero, so the silence watcher starts their
      // abandonment countdown almost immediately after the match resumes.
      if (result.peers.length > 0) peerSignalAt.current = Date.now();
      activeCodeWrite(code);
      const player = me(result.connection.selfConnId);
      // Introduce ourselves to the referee, if one is listening. It answers by
      // publishing a lobby that names our seat. Nothing waits on that answer:
      // a session without a server script never sends one, and this message
      // simply reaches nobody who cares.
      result.connection.sendClaim({
        k: "seat",
        v: DUEL_PROTOCOL,
        token,
        name: player.name,
        avatarCode: player.avatarCode,
        // A rejoin already holds a seat in the record, and says so: a server
        // that restarted while we were away should put us back where we were.
        seat: matchRef.current ? seatOf(matchRef.current, token) : null,
      });
      const existing = matchRef.current;
      if (existing) {
        const known = seatOf(existing, token);
        if (known) {
          const refreshed = refreshConnection(existing, token, player.connId);
          if (refreshed) publish(refreshed);
          if (existing.started && !existing.result) setStage({ kind: "match", code });
          else setStage({ kind: "waiting", code });
          return;
        }
        if (!existing.started && !existing.result) {
          // With a referee listening, which seat we take is its call, and the
          // effect below is where every refereed seating happens. Waiting for
          // the answer we just asked for beats picking a seat a second joiner
          // may be picking at this very moment.
          if (refereeLobbyRef.current !== null) {
            setStage({ kind: "waiting", code });
            return;
          }
          const seated = joinMatch(existing, player);
          if (seated) {
            publish(seated);
            setStage({ kind: "waiting", code });
            return;
          }
        }
        if (role !== "host") {
          setStage({ kind: "error", message: "That duel is full or already under way." });
          await dropChannel();
          activeCodeWrite(null);
          return;
        }
        // A finished or foreign record squatting in the channel: the HOST
        // resets it. seq continues past the stale record - a fresh seq 1
        // would lose every supersedes() comparison and be invisible.
        publish({
          ...createMatch(player, Date.now(), chosenBaseRef.current),
          seq: existing.seq + 1,
        });
        setStage({ kind: "waiting", code });
        return;
      }
      if (role === "host") {
        publish(createMatch(player, Date.now(), chosenBaseRef.current));
        setStage({ kind: "waiting", code });
      } else {
        // Joining an empty channel: the host's record may still be in flight.
        // Wait on it; the claim effect below seats us when it lands, and the
        // poll covers a lost event. A truly dead code stays here until Back.
        setStage({ kind: "waiting", code });
      }
    },
    [acquireNet, dropChannel, dropLobby, me, publish, pushChat, pushFeed, token],
  );

  // When the host's record arrives while we sit in "waiting", take a seat in
  // it. Deferred so the write reacts to the settled record rather than
  // cascading inside the render that delivered it.
  //
  // Which seat depends on whether a referee is running. With one, it has
  // already assigned us a seat and we merely write that seat into the record.
  // Without one, we take the lowest free seat after a JITTERED delay: two
  // joiners arriving together would otherwise pick the same seat, and
  // last-write-wins drops one of them. The loser re-runs this effect - its
  // token is absent from the newer record - and the random spread is what
  // stops the retries colliding again in lockstep.
  useEffect(() => {
    if (stage.kind !== "waiting" || !match || !channel.current) return;
    if (seatOf(match, token)) return;
    const assigned = refereeSeatOf(refereeLobby, token);
    // A full or started referee lobby we are not in is a duel we cannot join,
    // and no amount of waiting changes that.
    const turnedAway =
      refereeLobby !== null &&
      assigned === null &&
      (refereeLobby.started || refereeLobby.seats.length >= MAX_DUEL_PLAYERS);
    const awaitingReferee =
      refereeLobby !== null &&
      assigned === null &&
      !turnedAway &&
      Date.now() - channelJoinedAt.current < REFEREE_SEAT_GRACE_MS;
    if (awaitingReferee) {
      // Re-run once the grace expires even if no lobby update arrives, so a
      // referee that has gone quiet costs a short pause and not the duel.
      const wake = globalThis.setTimeout(
        () => setSeatAttempt((attempt) => attempt + 1),
        REFEREE_SEAT_GRACE_MS - (Date.now() - channelJoinedAt.current),
      );
      return () => globalThis.clearTimeout(wake);
    }
    const timer = globalThis.setTimeout(
      () => {
        const connection = channel.current;
        if (!connection) return;
        // A record that looks full is only the last word when we are choosing
        // our own seat. Holding an assignment means the referee has already
        // counted the house and found room.
        if (
          turnedAway ||
          match.started ||
          (assigned === null && seatedSeats(match).length >= MAX_DUEL_PLAYERS)
        ) {
          if (!match.result)
            setStage({ kind: "error", message: "That duel is full or already under way." });
          return;
        }
        if (match.result) return;
        // The referee frees the seat of anyone who leaves before the start,
        // and the record cannot: nothing in it notices a player going. When
        // the two disagree the referee is the one that knows who is present,
        // so the departed token gives up the seat it is no longer sitting in.
        // Only when the referee has accounted for at least as many players
        // as the record has, though. A server that restarted publishes a
        // lobby it has not finished rebuilding, and a half-built one lists
        // everybody else as absent - evicting on that would throw out the
        // whole table instead of one ghost.
        const holder = assigned === null ? null : match.players[assigned];
        const lobbySeats = refereeLobby?.seats ?? [];
        const departed =
          holder !== null &&
          lobbySeats.length >= seatedSeats(match).length &&
          !lobbySeats.some((seat) => seat.token === holder.token);
        const base = departed ? vacateSeat(match, assigned!) : match;
        const seated = joinMatch(base, me(connection.selfConnId), assigned);
        if (seated) publish(seated);
      },
      assigned ? 0 : Math.floor(Math.random() * 180),
    );
    return () => globalThis.clearTimeout(timer);
  }, [match, me, publish, refereeLobby, seatAttempt, stage, token]);

  // A referee that does not list us has forgotten the session: a replacement
  // server starts with no memory of who was sitting where. Tell it the seat
  // we already hold, before it offers that seat to somebody else. It rebuilds
  // from the match record too, so this is the second of two paths back to the
  // same place rather than the only one.
  useEffect(() => {
    const connection = channel.current;
    if (!connection || !refereeLobby || !mySeat) return;
    if (refereeLobby.seats.some((seat) => seat.token === token)) return;
    const player = me(connection.selfConnId);
    connection.sendClaim({
      k: "seat",
      v: DUEL_PROTOCOL,
      token,
      name: player.name,
      avatarCode: player.avatarCode,
      seat: mySeat,
    });
  }, [me, mySeat, refereeLobby, token]);

  // The runner mints the round's course when none exists yet: round 1 right
  // after both seats fill, later rounds right after the reset. A custom base
  // map opens every round from its cached code; otherwise a random clean
  // course is generated. Deferred one tick so the mint-and-publish reacts to
  // the settled record rather than cascading inside the render that
  // delivered it.
  useEffect(() => {
    if (!match || !myTurn || match.courseCode !== null || match.turn.phase !== "handoff") return;
    if (!match.started) return;
    const timer = globalThis.setTimeout(() => {
      if (match.courseBaseVersion !== null) {
        // Rejoined mid-match without witnessing round 1: the chooser's own
        // catalog still has the map, so try that before giving up.
        const cached =
          baseCourseRef.current?.version === match.courseBaseVersion
            ? baseCourseRef.current
            : (() => {
                const record = listRememberedPublishedMaps().find(
                  (entry) => entry.versionId === match.courseBaseVersion,
                );
                return record
                  ? { version: record.versionId, code: record.challengeCode }
                  : null;
              })();
        if (cached) {
          baseCourseRef.current = cached;
          publish(setCourse(match, cached.code, cached.version, Date.now()));
          pushFeed(`Round ${match.round}: ${match.courseTitle ?? "the map"} opens.`);
          return;
        }
        pushFeed(
          `Could not recover ${match.courseTitle ?? "the chosen map"} on this side. A fresh course stands in.`,
        );
      }
      const seed = Date.now() ^ Math.floor(Math.random() * 0x7fffffff);
      try {
        const runtime = runtimeMap(
          ensureRequiredEndpoints(generateRandomRoom(seed)),
          avatarSeed,
          seed,
          playerName || "Duelist",
        );
        const code = encodeChallengeLink(runtime.challenge, avatar, runtime.track);
        publish(setCourse(match, code, runtime.challenge.slug, Date.now()));
        pushFeed(`Round ${match.round}: a fresh course appears.`);
      } catch {
        pushFeed("Could not mint a fresh course. Trying again on the next tick…");
      }
    }, 0);
    return () => globalThis.clearTimeout(timer);
  }, [avatar, avatarSeed, match, myTurn, playerName, publish, pushFeed]);

  // One 1s tick drives the turn-deadline countdown, the forfeit gate, and
  // the lobby claim countdown.
  useEffect(() => {
    if (stage.kind !== "match" && !pendingClaim) return;
    const timer = globalThis.setInterval(() => setNowTick(Date.now()), 1_000);
    return () => globalThis.clearInterval(timer);
  }, [pendingClaim, stage.kind]);

  // In-match liveness, both directions. This side heartbeats so the opponent
  // can tell silence from idleness; a watcher presumes the opponent gone when
  // NOTHING has arrived for the stale window, because the platform does not
  // reliably report a peer whose page died abruptly (measured live: a killed
  // preview pane produced no peer-leave event at all). A late signal from a
  // throttled-but-alive tab clears the presumption before the clock below
  // can act on it.
  useEffect(() => {
    if (stage.kind !== "match") return;
    const beat = globalThis.setInterval(
      () => channel.current?.send({ k: "hb", v: DUEL_PROTOCOL }),
      HEARTBEAT_MS,
    );
    const watch = globalThis.setInterval(() => {
      const record = matchRef.current;
      if (!record || record.result || seatedSeats(record).length < 2) return;
      const silentFor = Date.now() - peerSignalAt.current;
      if (silentFor > PEER_STALE_MS)
        setPeerLostAt((current) => current ?? Date.now());
      else setPeerLostAt((current) => (current === null ? current : null));
    }, 1_000);
    return () => {
      globalThis.clearInterval(beat);
      globalThis.clearInterval(watch);
    };
  }, [stage.kind]);

  // A vanished opponent forfeits the whole match once their clock runs out:
  // a reload-and-rejoin reconnects well inside the window, and anything
  // longer leaves the remaining player playing against an empty seat. The
  // effect only schedules the timer; peerLostAt is set by the connection
  // callbacks, so the window is anchored to the disconnect and does not
  // slide on the survivor's own record writes. The record is re-read when
  // the clock fires.
  useEffect(() => {
    if (peerLostAt === null || stage.kind !== "match") return;
    const timer = globalThis.setTimeout(() => {
      const record = matchRef.current;
      const seat = record ? seatOf(record, token) : null;
      if (!record || record.result || !seat || seatedSeats(record).length < 2) return;
      // Retire whoever went quiet - with four seats that is the stalled
      // runner, and the rest of the lobby plays on without them.
      const missing = record.turn.runner !== seat ? record.turn.runner : null;
      if (!missing) return;
      const name = record.players[missing]?.name ?? "A player";
      const next = concede(record, missing, Date.now());
      publish(next);
      pushFeed(
        next.result
          ? `${name} never came back. Match over.`
          : `${name} never came back and is out.`,
      );
      if (next.result) activeCodeWrite(null);
    }, Math.max(0, peerLostAt + ABANDON_TIMEOUT_MS - Date.now()));
    return () => globalThis.clearTimeout(timer);
  }, [peerLostAt, publish, pushFeed, stage.kind, token]);

  const forfeitClaimable =
    match !== null && mySeat !== null && mayClaimForfeit(match, mySeat, nowTick);
  const deadlineSeconds = match
    ? Math.max(0, Math.ceil((match.turn.deadlineAt + FORFEIT_GRACE_MS - nowTick) / 1000))
    : 0;
  const claimSecondsLeft = pendingClaim
    ? Math.max(0, Math.ceil((pendingClaim.expiresAt - nowTick) / 1000))
    : 0;
  const spectateSeconds =
    spectateStartedAt !== null
      ? Math.max(0, Math.floor((nowTick - spectateStartedAt) / 1000))
      : null;
  const abandonSecondsLeft =
    peerLostAt !== null &&
    stage.kind === "match" &&
    match !== null &&
    !match.result &&
    seatedSeats(match).length >= 2
      ? Math.max(0, Math.ceil((peerLostAt + ABANDON_TIMEOUT_MS - nowTick) / 1000))
      : null;

  const sendWire = useCallback((message: DuelWireMessage) => {
    channel.current?.send(message);
  }, []);

  const teardown = useCallback(async () => {
    await dropChannel();
    await dropLobby();
    matchRef.current = null;
    activeCodeRef.current = null;
    refereeLobbyRef.current = null;
    setRefereeLobby(null);
    spectateSampleRef.current = null;
    chosenBaseRef.current = null;
    baseCourseRef.current = null;
    setMatch(null);
    setChat([]);
    setFeed([]);
    setPeerConnected(false);
    setPeerLostAt(null);
    setSpectateStartedAt(null);
  }, [dropChannel, dropLobby]);

  // Arm the chooser's selection right before a match record is created, and
  // seed the base-code cache from the local catalog so the chooser can open
  // round 1 without waiting on anything.
  const armChosenCourse = useCallback(() => {
    const record = courseChoice
      ? mapChoices.find((entry) => entry.versionId === courseChoice) ?? null
      : null;
    chosenBaseRef.current = record
      ? { title: record.title, version: record.versionId }
      : null;
    baseCourseRef.current = record
      ? { version: record.versionId, code: record.challengeCode }
      : null;
    return record;
  }, [courseChoice, mapChoices]);

  const api: DuelApi = {
    stage,
    netActive: stage.kind !== "closed" && stage.kind !== "menu" && stage.kind !== "error",
    match,
    mySeat,
    myTurn,
    opponentName,
    opponentAvatar,
    peerConnected,
    posts,
    claimFrom,
    pendingClaim,
    claimSecondsLeft,
    lobbyNotice,
    chat,
    feed,
    spectateSampleRef,
    spectateSeconds,
    course,
    mapChoices,
    courseChoice,
    chooseCourse: (versionId) => setCourseChoice(versionId),
    forfeitClaimable,
    deadlineSeconds,
    abandonSecondsLeft,
    rejoinableCode,

    open: () => {
      // Refresh the catalog on every open: a map published since the last
      // duel should be offerable without a reload.
      const maps = listRememberedPublishedMaps();
      setMapChoices(maps);
      setCourseChoice((current) =>
        current && maps.some((entry) => entry.versionId === current) ? current : null,
      );
      setStage((current) => (current.kind === "closed" ? { kind: "menu" } : current));
    },
    close: () => {
      // Closing the popup mid-match IS leaving the match: concede before the
      // connection drops so the others get the result immediately instead of
      // waiting out the abandonment clock. A guest walking out of a lobby
      // that has not started yet only gives up its seat - ending the host's
      // gathering because one visitor changed their mind would be absurd.
      // The host leaving is the exception: a lobby with no host can never be
      // started, so it closes for everyone.
      const current = matchRef.current;
      const seat = current ? seatOf(current, token) : null;
      if (current && seat && !current.result) {
        if (!current.started && seat !== "a") publish(vacateSeat(current, seat));
        else if (seatedSeats(current).length >= 2)
          publish(concede(current, seat, Date.now()));
      }
      void teardown();
      activeCodeWrite(null);
      setStage({ kind: "closed" });
    },
    hostPrivate: () => {
      armChosenCourse();
      void enterChannel(mintDuelCode(), "host");
    },
    joinWithCode: (raw) => {
      const code = normalizeDuelCode(raw);
      if (!code) {
        setStage({ kind: "error", message: "Codes look like MIW-XXXX. Check it and try again." });
        return;
      }
      void enterChannel(code, "join");
    },
    rejoin: () => {
      const code = activeCodeRead();
      if (code) void enterChannel(code, "join");
    },
    enterLobby: () => {
      setStage({ kind: "joining" });
      void (async () => {
        await acquireNet?.().catch(() => undefined);
        const result = await connectDuelLobby({
          onPosts: (list) => {
            const now = Date.now();
            setPosts(list.map((post) => ({ ...post, dim: lobbyFreshness(post, now) === "dim" })));
          },
          onClaim: (fromConnId, name) => {
            // The host gets the same window the claimant watches: an ignored
            // request card clears itself rather than going stale forever.
            if (hostClaimLapseTimer.current !== null) globalThis.clearTimeout(hostClaimLapseTimer.current);
            setClaimFrom({ connId: fromConnId, name: name ?? "A challenger" });
            hostClaimLapseTimer.current = globalThis.setTimeout(() => {
              hostClaimLapseTimer.current = null;
              setClaimFrom(null);
            }, CLAIM_TIMEOUT_MS);
          },
          onAccept: (code) => {
            // Only honour an accept for a request that still stands - a
            // cancelled or lapsed claim must not yank the player into a match.
            if (!pendingClaimRef.current) return;
            clearPendingClaim();
            void enterChannel(code, "join");
          },
          onDeny: (deny) => {
            clearPendingClaim();
            setStage({
              kind: "error",
              message: deny === "taken" ? "Someone else got there first." : "That post just closed.",
            });
          },
          onStatus: () => undefined,
        });
        if (result.status !== "ok") {
          setStage({
            kind: "error",
            message:
              result.status === "unavailable"
                ? "Duels need a Portals host. Open the game on portals.to to play."
                : result.message,
          });
          return;
        }
        lobby.current = result.connection;
        setStage({ kind: "lobby", posted: false });
      })();
    },
    leaveLobby: () => {
      void dropLobby();
      setStage({ kind: "menu" });
    },
    postToLobby: (note) => {
      const record = courseChoice
        ? mapChoices.find((entry) => entry.versionId === courseChoice) ?? null
        : null;
      lobby.current?.post({
        name: playerName,
        avatarCode: avatar ? avatarToCode(avatar) : null,
        note,
        courseTitle: record?.title ?? null,
      });
      setStage({ kind: "lobby", posted: true });
    },
    unpost: () => {
      lobby.current?.unpost();
      setStage({ kind: "lobby", posted: false });
    },
    claimPost: (connId) => {
      const connection = lobby.current;
      if (!connection) return;
      connection.claim(connId, playerName);
      clearPendingClaim();
      setLobbyNotice(null);
      const claim: DuelPendingClaim = {
        connId,
        posterName: posts.find((post) => post.connId === connId)?.name ?? "the poster",
        expiresAt: Date.now() + CLAIM_TIMEOUT_MS,
      };
      pendingClaimRef.current = claim;
      setPendingClaim(claim);
      setNowTick(Date.now());
      claimLapseTimer.current = globalThis.setTimeout(() => {
        claimLapseTimer.current = null;
        pendingClaimRef.current = null;
        setPendingClaim(null);
        setLobbyNotice("No answer after five minutes. The request expired.");
      }, CLAIM_TIMEOUT_MS);
    },
    cancelClaim: () => {
      clearPendingClaim();
      setLobbyNotice(null);
    },
    acceptClaim: () => {
      const target = claimFrom;
      const connection = lobby.current;
      if (!target || !connection) return;
      const code = mintDuelCode();
      // The poster becomes the host, so the course they advertised applies.
      armChosenCourse();
      connection.unpost();
      connection.accept(target.connId, code);
      clearHostClaim();
      void enterChannel(code, "host");
    },
    denyClaim: () => {
      if (claimFrom) lobby.current?.deny(claimFrom.connId, "taken");
      clearHostClaim();
    },
    sendChat: (text) => {
      const trimmed = text.trim().slice(0, 300);
      if (!trimmed) return;
      sendWire({ k: "chat", v: DUEL_PROTOCOL, text: trimmed });
      pushChat("you", trimmed);
    },
    sendReaction: (emoji) => {
      sendWire({ k: "react", v: DUEL_PROTOCOL, emoji });
      // Echoed locally too: without this the sender saw nothing happen and
      // the buttons read as dead, while the opponent received them fine.
      pushFeed(emoji);
    },
    claimTimeout: () => {
      const current = matchRef.current;
      if (!current || !mySeat) return;
      const outcome = claimForfeit(current, mySeat, Date.now());
      if (!outcome) return;
      publish(outcome.match);
      pushFeed(
        outcome.kind === "match-over"
          ? "Round claimed on the clock. Match over."
          : "Round claimed on the clock.",
      );
    },
    concedeMatch: () => {
      const current = matchRef.current;
      if (current && mySeat) publish(concede(current, mySeat, Date.now()));
      void teardown();
      activeCodeWrite(null);
      setStage({ kind: "closed" });
    },
    requestRematch: () => {
      const current = matchRef.current;
      if (!current) return;
      const next = rematch(current, Date.now());
      if (next) publish(next);
    },
    roster,
    canStartMatch,
    openSeats,
    refereeOnline,
    startNow: () => {
      const current = matchRef.current;
      if (!current) return;
      const next = startMatch(current, Date.now());
      if (!next) return;
      publish(next);
      // Tell the referee the lobby is closed, so it stops handing seats to
      // arrivals the started record would only turn away.
      channel.current?.sendClaim({ k: "start", v: DUEL_PROTOCOL, token });
    },

    noteRunStarted: () => {
      const current = matchRef.current;
      if (!current || !myTurn) return;
      sampleCounter.current = 0;
      publish(beginRun(current, Date.now()));
      sendWire({ k: "evt", v: DUEL_PROTOCOL, type: "start" });
    },
    noteRunSample: (sample) => {
      if (!myTurn) return;
      sampleCounter.current += 1;
      if (sampleCounter.current % POS_SEND_DIVISOR !== 0) return;
      sendWire({
        k: "pos", v: DUEL_PROTOCOL,
        x: sample.x, y: sample.y, z: sample.z, yaw: sample.yaw, flags: sample.flags,
      });
    },
    noteRunFailed: () => {
      const current = matchRef.current;
      if (!current || !myTurn) return;
      const outcome = failAttempt(current, Date.now());
      publish(outcome.match);
      sendWire({ k: "evt", v: DUEL_PROTOCOL, type: "death" });
      if (outcome.kind !== "retry") {
        pushFeed(outcome.kind === "match-over" ? "Match over." : "Round lost. Fresh course next.");
        if (outcome.kind === "match-over") activeCodeWrite(null);
      }
    },
    noteRunCleared: () => {
      const current = matchRef.current;
      if (!current || !myTurn) return;
      publish(clearRun(current, Date.now()));
      sendWire({ k: "evt", v: DUEL_PROTOCOL, type: "clear" });
    },
    noteWorsened: (challenge, track) => {
      const current = matchRef.current;
      if (!current || !myTurn) return;
      try {
        const code = encodeChallengeLink(challenge, avatar, track);
        publish(handOff(current, code, challenge.slug, Date.now()));
        sendWire({
          k: "evt", v: DUEL_PROTOCOL, type: "place",
          label: challenge.addedTrap ? challenge.addedTrap.type.replace(/_/g, " ") : "a trap",
        });
      } catch {
        pushFeed("Your worsened course is too large to send. The turn stays with you.");
      }
    },
  };

  // Unmount safety: leave whatever session is open.
  useEffect(() => {
    return () => {
      void channel.current?.close().catch(() => undefined);
      void lobby.current?.close().catch(() => undefined);
    };
  }, []);

  return api;
}
