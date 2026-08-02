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
  DUEL_PROTOCOL,
  FORFEIT_GRACE_MS,
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
  otherSeat,
  rematch,
  refreshConnection,
  seatOf,
  setCourse,
  type DuelMatch,
  type DuelSeat,
  type DuelWireMessage,
  type LobbyPost,
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
  claimFrom: string | null;
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
  const [claimFrom, setClaimFrom] = useState<string | null>(null);
  const [pendingClaim, setPendingClaim] = useState<DuelPendingClaim | null>(null);
  const [lobbyNotice, setLobbyNotice] = useState<string | null>(null);
  const pendingClaimRef = useRef<DuelPendingClaim | null>(null);
  const claimLapseTimer = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const hostClaimLapseTimer = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const [chat, setChat] = useState<DuelChatEntry[]>([]);
  const [feed, setFeed] = useState<DuelFeedEntry[]>([]);
  const [peerConnected, setPeerConnected] = useState(false);
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
  const rejoinableCode = useMemo(() => activeCodeRead(), []);

  const mySeat = match ? seatOf(match, token) : null;
  const myTurn = match !== null && mySeat !== null && match.turn.runner === mySeat && !match.result;
  const opponent = match && mySeat ? match.players[otherSeat(mySeat)] : null;
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
    if (next.players.b && !next.result && activeCodeRef.current) {
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
          if (record.players.b && !record.result) setStage({ kind: "match", code });
        },
        onMessage: (message) => {
          switch (message.k) {
            case "pos":
              spectateSampleRef.current = {
                x: message.x, y: message.y, z: message.z, yaw: message.yaw, flags: message.flags,
              };
              break;
            case "evt": {
              const current = matchRef.current;
              const runnerName =
                current && seatOf(current, token)
                  ? current.players[otherSeat(seatOf(current, token)!)]?.name ?? "Opponent"
                  : "Opponent";
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
        onPeerJoin: () => setPeerConnected(true),
        onPeerLeave: () => {
          setPeerConnected(false);
          spectateSampleRef.current = null;
          pushFeed("Opponent disconnected. They can rejoin with the same code.");
        },
        onStatus: (status) => {
          if (status === "disconnected") pushFeed("Connection to Portals lost. Waiting for it to return…");
        },
      });
      if (result.status !== "ok") {
        setStage({
          kind: "error",
          message:
            result.status === "unavailable"
              ? "Duels need a Portals host. Open the game on portals.to to play 1v1."
              : result.message,
        });
        return;
      }
      channel.current = result.connection;
      setPeerConnected(result.peers.length > 0);
      activeCodeWrite(code);
      const player = me(result.connection.selfConnId);
      const existing = matchRef.current;
      if (existing) {
        const known = seatOf(existing, token);
        if (known) {
          const refreshed = refreshConnection(existing, token, player.connId);
          if (refreshed) publish(refreshed);
          if (existing.players.b && !existing.result) setStage({ kind: "match", code });
          else setStage({ kind: "waiting", code });
          return;
        }
        if (existing.players.b === null && !existing.result) {
          const seated = joinMatch(existing, player);
          if (seated) {
            publish(seated);
            return;
          }
        }
        if (role !== "host") {
          setStage({ kind: "error", message: "That duel already has two players." });
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

  // When the host's record arrives while we sit in "waiting", claim seat B.
  // Deferred one tick so the claim reacts to the settled record rather than
  // cascading inside the render that delivered it.
  useEffect(() => {
    if (stage.kind !== "waiting" || !match || !channel.current) return;
    if (seatOf(match, token)) return;
    const timer = globalThis.setTimeout(() => {
      const connection = channel.current;
      if (!connection) return;
      if (match.players.b !== null) {
        if (!match.result) setStage({ kind: "error", message: "That duel already has two players." });
        return;
      }
      if (match.result) return;
      const seated = joinMatch(match, me(connection.selfConnId));
      if (seated) publish(seated);
    }, 0);
    return () => globalThis.clearTimeout(timer);
  }, [match, me, publish, stage, token]);

  // The runner mints the round's course when none exists yet: round 1 right
  // after both seats fill, later rounds right after the reset. A custom base
  // map opens every round from its cached code; otherwise a random clean
  // course is generated. Deferred one tick so the mint-and-publish reacts to
  // the settled record rather than cascading inside the render that
  // delivered it.
  useEffect(() => {
    if (!match || !myTurn || match.courseCode !== null || match.turn.phase !== "handoff") return;
    if (!match.players.b) return;
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

  const forfeitClaimable =
    match !== null && mySeat !== null && mayClaimForfeit(match, mySeat, nowTick);
  const deadlineSeconds = match
    ? Math.max(0, Math.ceil((match.turn.deadlineAt + FORFEIT_GRACE_MS - nowTick) / 1000))
    : 0;
  const claimSecondsLeft = pendingClaim
    ? Math.max(0, Math.ceil((pendingClaim.expiresAt - nowTick) / 1000))
    : 0;

  const sendWire = useCallback((message: DuelWireMessage) => {
    channel.current?.send(message);
  }, []);

  const teardown = useCallback(async () => {
    await dropChannel();
    await dropLobby();
    matchRef.current = null;
    activeCodeRef.current = null;
    spectateSampleRef.current = null;
    chosenBaseRef.current = null;
    baseCourseRef.current = null;
    setMatch(null);
    setChat([]);
    setFeed([]);
    setPeerConnected(false);
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
    course,
    mapChoices,
    courseChoice,
    chooseCourse: (versionId) => setCourseChoice(versionId),
    forfeitClaimable,
    deadlineSeconds,
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
          onClaim: (fromConnId) => {
            // The host gets the same window the claimant watches: an ignored
            // request card clears itself rather than going stale forever.
            if (hostClaimLapseTimer.current !== null) globalThis.clearTimeout(hostClaimLapseTimer.current);
            setClaimFrom(fromConnId);
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
                ? "Duels need a Portals host. Open the game on portals.to to play 1v1."
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
      connection.claim(connId);
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
      connection.accept(target, code);
      clearHostClaim();
      void enterChannel(code, "host");
    },
    denyClaim: () => {
      if (claimFrom) lobby.current?.deny(claimFrom, "taken");
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
      if (current && mySeat) publish(concede(current, mySeat));
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
