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

const ACTIVE_DUEL_STORAGE_KEY = "miw:duel-active-code";
/** Streamed run positions: every other 15Hz ghost sample, ~7.5 msgs/s. */
const POS_SEND_DIVISOR = 2;
const CHAT_LIMIT = 60;
const FEED_LIMIT = 24;

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
  chat: DuelChatEntry[];
  feed: DuelFeedEntry[];
  /** Latest streamed opponent position, for the live spectator ghost. */
  spectateSampleRef: { current: DecodedGhostSample | null };
  /** The course the current turn runs, decoded once per version. */
  course: DuelCourse | null;
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

function activeCodeRead(): string | null {
  try {
    const raw = globalThis.localStorage?.getItem(ACTIVE_DUEL_STORAGE_KEY);
    return raw ? normalizeDuelCode(raw) : null;
  } catch {
    return null;
  }
}

function activeCodeWrite(code: string | null) {
  try {
    if (code === null) globalThis.localStorage?.removeItem(ACTIVE_DUEL_STORAGE_KEY);
    else globalThis.localStorage?.setItem(ACTIVE_DUEL_STORAGE_KEY, code);
  } catch {
    // Private mode: rejoin-after-reload is simply not offered.
  }
}

export function useDuel(input: {
  playerName: string;
  avatar: AvatarConfig | null;
  avatarSeed: number;
}): DuelApi {
  const { playerName, avatar, avatarSeed } = input;
  const [stage, setStage] = useState<DuelStage>({ kind: "closed" });
  const [match, setMatch] = useState<DuelMatch | null>(null);
  const [posts, setPosts] = useState<DuelLobbyPostView[]>([]);
  const [claimFrom, setClaimFrom] = useState<string | null>(null);
  const [chat, setChat] = useState<DuelChatEntry[]>([]);
  const [feed, setFeed] = useState<DuelFeedEntry[]>([]);
  const [peerConnected, setPeerConnected] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const token = useMemo(() => duelToken(), []);
  const lobby = useRef<DuelLobbyConnection | null>(null);
  const channel = useRef<DuelChannelConnection | null>(null);
  const matchRef = useRef<DuelMatch | null>(null);
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

  const pushFeed = useCallback((text: string) => {
    setFeed((entries) => [...entries.slice(-(FEED_LIMIT - 1)), { id: (serial.current += 1), text }]);
  }, []);
  const pushChat = useCallback((from: "you" | "them", text: string) => {
    setChat((entries) => [...entries.slice(-(CHAT_LIMIT - 1)), { id: (serial.current += 1), from, text }]);
  }, []);

  /** Publish a new record and adopt it locally in the same breath. */
  const publish = useCallback((next: DuelMatch) => {
    matchRef.current = next;
    setMatch(next);
    channel.current?.publishMatch(next);
  }, []);

  const dropLobby = useCallback(async () => {
    const connection = lobby.current;
    lobby.current = null;
    setPosts([]);
    setClaimFrom(null);
    if (connection) await connection.close().catch(() => undefined);
  }, []);
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
      await dropLobby();
      setStage({ kind: "connecting" });
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
        onPeerJoin: (player) => {
          setPeerConnected(true);
          const current = matchRef.current;
          if (!current) return;
          // The host seats a fresh arrival; a known token is a rejoin.
          if (seatOf(current, token) !== "a") return;
          if (current.players.b === null) {
            const seated = joinMatch(current, {
              token: `pending:${player.id}`,
              connId: player.id,
              name: player.displayName?.trim().slice(0, 40) || "Challenger",
              avatarCode: null,
            });
            // The joiner introduces itself through its own refresh below, so
            // seat B starts as the connection and adopts the token after.
            if (seated) publish(seated);
          }
        },
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
        // The host provisionally seated this connection before the token was
        // known; adopt seat B properly. Otherwise take the empty seat.
        if (existing.players.b?.token === `pending:${player.connId}` || existing.players.b === null) {
          const seated =
            existing.players.b === null
              ? joinMatch(existing, player)
              : { ...existing, seq: existing.seq + 1, players: { ...existing.players, b: player } };
          if (seated) {
            publish(seated);
            setStage({ kind: "match", code });
            return;
          }
        }
        setStage({ kind: "error", message: "That duel already has two players." });
        await dropChannel();
        activeCodeWrite(null);
        return;
      }
      if (role === "host") {
        publish(createMatch(player, Date.now()));
        setStage({ kind: "waiting", code });
      } else {
        // Joining an empty channel: the host's record may still be in flight.
        // Wait on it; onMatch flips the stage when it lands, and the poll
        // covers a lost event. A truly dead code stays here until Back.
        setStage({ kind: "waiting", code });
      }
    },
    [dropChannel, dropLobby, me, publish, pushChat, pushFeed, token],
  );

  // When the joiner's record arrives while we sit in "waiting", claim seat B.
  useEffect(() => {
    if (stage.kind !== "waiting" || !match || !channel.current) return;
    if (seatOf(match, token)) return;
    if (match.players.b !== null && match.players.b.token !== `pending:${channel.current.selfConnId}`) {
      setStage({ kind: "error", message: "That duel already has two players." });
      return;
    }
    const player = me(channel.current.selfConnId);
    const seated =
      match.players.b === null
        ? joinMatch(match, player)
        : { ...match, seq: match.seq + 1, players: { ...match.players, b: player } };
    if (seated) publish(seated);
  }, [match, me, publish, stage, token]);

  // The runner mints the round's fresh course when none exists yet: round 1
  // right after both seats fill, later rounds right after the reset. Deferred
  // one tick so the mint-and-publish reacts to the settled record rather than
  // cascading inside the render that delivered it.
  useEffect(() => {
    if (!match || !myTurn || match.courseCode !== null || match.turn.phase !== "handoff") return;
    if (!match.players.b) return;
    const timer = globalThis.setTimeout(() => {
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

  // One 1s tick drives the deadline countdown and the forfeit gate.
  useEffect(() => {
    if (stage.kind !== "match") return;
    const timer = globalThis.setInterval(() => setNowTick(Date.now()), 1_000);
    return () => globalThis.clearInterval(timer);
  }, [stage.kind]);

  const forfeitClaimable =
    match !== null && mySeat !== null && mayClaimForfeit(match, mySeat, nowTick);
  const deadlineSeconds = match
    ? Math.max(0, Math.ceil((match.turn.deadlineAt + FORFEIT_GRACE_MS - nowTick) / 1000))
    : 0;

  const sendWire = useCallback((message: DuelWireMessage) => {
    channel.current?.send(message);
  }, []);

  const teardown = useCallback(async () => {
    await dropChannel();
    await dropLobby();
    matchRef.current = null;
    spectateSampleRef.current = null;
    setMatch(null);
    setChat([]);
    setFeed([]);
    setPeerConnected(false);
  }, [dropChannel, dropLobby]);

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
    chat,
    feed,
    spectateSampleRef,
    course,
    forfeitClaimable,
    deadlineSeconds,
    rejoinableCode,

    open: () => setStage((current) => (current.kind === "closed" ? { kind: "menu" } : current)),
    close: () => {
      void teardown();
      activeCodeWrite(null);
      setStage({ kind: "closed" });
    },
    hostPrivate: () => void enterChannel(mintDuelCode(), "host"),
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
        const result = await connectDuelLobby({
          onPosts: (list) => {
            const now = Date.now();
            setPosts(list.map((post) => ({ ...post, dim: lobbyFreshness(post, now) === "dim" })));
          },
          onClaim: (fromConnId) => setClaimFrom(fromConnId),
          onAccept: (code) => void enterChannel(code, "join"),
          onDeny: (deny) =>
            setStage({
              kind: "error",
              message: deny === "taken" ? "Someone else got there first." : "That post just closed.",
            }),
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
      lobby.current?.post({
        name: playerName,
        avatarCode: avatar ? avatarToCode(avatar) : null,
        note,
      });
      setStage({ kind: "lobby", posted: true });
    },
    unpost: () => {
      lobby.current?.unpost();
      setStage({ kind: "lobby", posted: false });
    },
    claimPost: (connId) => {
      lobby.current?.claim(connId);
    },
    acceptClaim: () => {
      const target = claimFrom;
      const connection = lobby.current;
      if (!target || !connection) return;
      const code = mintDuelCode();
      connection.unpost();
      connection.accept(target, code);
      setClaimFrom(null);
      void enterChannel(code, "host");
    },
    denyClaim: () => {
      if (claimFrom) lobby.current?.deny(claimFrom, "taken");
      setClaimFrom(null);
    },
    sendChat: (text) => {
      const trimmed = text.trim().slice(0, 300);
      if (!trimmed) return;
      sendWire({ k: "chat", v: DUEL_PROTOCOL, text: trimmed });
      pushChat("you", trimmed);
    },
    sendReaction: (emoji) => sendWire({ k: "react", v: DUEL_PROTOCOL, emoji }),
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
