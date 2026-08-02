// Transport for 1v1 duels over Portals.net, mirroring map-session.ts: shared
// state is the primary record, live events are the fast path, a bounded poll
// is the lost-event safety net, and everything off the wire is validated
// before it is believed.
//
// Two distinct sessions live here. The LOBBY is the game page's default
// session - the same bucket map-session uses - where players advertise open
// challenges as per-connection state keys and claim each other's posts. A
// DUEL is a private channel named by the invite code, holding exactly the two
// seated players plus the match record. The SDK carries one connection at a
// time, so PortalsApp closes whichever session it holds before opening the
// next; both connections here expose close() for that hand-off.

import {
  DUEL_MATCH_KEY,
  DUEL_STATE_POLL_MS,
  DUEL_WIRE_MAX_BYTES,
  LOBBY_HEARTBEAT_MS,
  LOBBY_POST_PREFIX,
  LOBBY_STALE_AFTER_MS,
  duelChannel,
  duelWireBytes,
  lobbyFreshness,
  lobbyPostKey,
  parseDuelMatch,
  parseDuelMessage,
  parseLobbyPost,
  supersedes,
  DUEL_PROTOCOL,
  type DuelMatch,
  type DuelWireMessage,
  type LobbyPost,
} from "./duel-protocol";
import type { PortalsNet, PortalsNetPlayer } from "../leaderboard";

const TOKEN_NAME_PATTERN = /miwtok:([A-Za-z0-9-]{8,72})/;
let mintedToken: string | null = null;

/**
 * The stable identity a duel seat is keyed by. Portals connection ids change
 * on every join, and playerId is null when signed out, so the game mints its
 * own. Web storage is the wrong home for it: the editor's side-by-side 2p
 * preview runs both players as same-origin iframes in one tab, and they
 * SHARE sessionStorage and localStorage - a stored token made both panes the
 * same player, so the joiner could never take seat B. window.name is the one
 * slot that is per-frame AND survives a reload of that frame, which is
 * exactly the reload-and-rejoin case. When the host platform already uses
 * window.name the token stays in memory and rejoin simply needs the frame to
 * not reload - still correct, just less convenient.
 */
export function duelToken(): string {
  if (mintedToken) return mintedToken;
  try {
    const existing = TOKEN_NAME_PATTERN.exec(globalThis.window?.name ?? "");
    if (existing?.[1]) {
      mintedToken = existing[1];
      return mintedToken;
    }
  } catch {
    // Cross-origin or sandbox restrictions: fall through to a fresh mint.
  }
  mintedToken =
    globalThis.crypto?.randomUUID?.() ??
    `tok-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  try {
    const frame = globalThis.window;
    if (frame && (frame.name === "" || TOKEN_NAME_PATTERN.test(frame.name))) {
      frame.name = `miwtok:${mintedToken}`;
    }
  } catch {
    // Persistence refused: the in-memory token still identifies this player.
  }
  return mintedToken;
}

/** Test hook: clears the module cache so mint/persist paths can be exercised. */
export function resetDuelTokenForTests(): void {
  mintedToken = null;
}

function reason(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Portals multiplayer did not respond.";
}

const JOIN_TIMEOUT_MS = 12_000;

/**
 * The SDK carries one connection, and a join issued while a previous session
 * is still tearing down has been observed to neither resolve nor reject. A
 * hang here used to strand the UI on "Connecting…" forever; a visible error
 * with a retry beats silence.
 */
function joinWithTimeout(
  portalsNet: PortalsNet,
  options?: { channel?: string },
): Promise<Awaited<ReturnType<PortalsNet["join"]>>> {
  return Promise.race([
    portalsNet.join(options),
    new Promise<never>((_, rejectRace) => {
      globalThis.setTimeout(
        () => rejectRace(new Error("Portals did not answer the join request. Try again.")),
        JOIN_TIMEOUT_MS,
      );
    }),
  ]);
}

function net(): { sdk: NonNullable<typeof window.Portals>; net: PortalsNet } | null {
  const sdk = typeof window === "undefined" ? undefined : window.Portals;
  return sdk?.net ? { sdk, net: sdk.net } : null;
}

// --- Lobby ------------------------------------------------------------------

export interface DuelLobbyHandlers {
  /** Fresh full snapshot of live posts (stale ones already dropped). */
  onPosts(posts: LobbyPost[]): void;
  /** Someone claimed OUR post. The poster arbitrates: accept or deny. */
  onClaim(fromConnId: string, name: string | null): void;
  /** Our claim on someone's post was accepted; join this code's channel. */
  onAccept(code: string): void;
  onDeny(reason: "taken" | "closed"): void;
  onStatus(status: "connected" | "disconnected"): void;
}

export interface DuelLobbyConnection {
  selfConnId: string;
  selfName: string | null;
  /** Advertise an open challenge; heartbeats renew it until unpost/close. */
  post(input: {
    name: string;
    avatarCode: string | null;
    note: string;
    courseTitle?: string | null;
  }): void;
  unpost(): void;
  claim(toConnId: string, name: string): void;
  accept(toConnId: string, code: string): void;
  deny(toConnId: string, denyReason: "taken" | "closed"): void;
  close(): Promise<void>;
}

export type DuelLobbyResult =
  | { status: "ok"; connection: DuelLobbyConnection }
  | { status: "unavailable" }
  | { status: "error"; message: string };

export async function connectDuelLobby(handlers: DuelLobbyHandlers): Promise<DuelLobbyResult> {
  const host = net();
  if (!host) return { status: "unavailable" };
  try {
    await host.sdk.ready();
    const joined = await joinWithTimeout(host.net);
    const selfConnId = joined.self.id;
    const posts = new Map<string, LobbyPost>();
    let heartbeat: ReturnType<typeof globalThis.setInterval> | null = null;
    let myPost: LobbyPost | null = null;

    const publishPosts = () => {
      const now = Date.now();
      const live = [...posts.values()]
        .filter((post) => post.connId !== selfConnId && lobbyFreshness(post, now) !== "stale")
        .sort((left, right) => right.heartbeatAt - left.heartbeatAt);
      handlers.onPosts(live);
    };
    const acceptPost = (key: string, value: unknown) => {
      if (!key.startsWith(LOBBY_POST_PREFIX)) return;
      const post = parseLobbyPost(value);
      if (post) posts.set(key, post);
      else posts.delete(key);
      publishPosts();
    };
    const scanState = (state: unknown) => {
      if (!state || typeof state !== "object") return;
      for (const [key, value] of Object.entries(state as Record<string, unknown>)) {
        if (key.startsWith(LOBBY_POST_PREFIX)) acceptPost(key, value);
      }
      // A poster that vanished without clearing its key ages out via
      // freshness; prune the map so it cannot grow without bound.
      const now = Date.now();
      for (const [key, post] of posts) {
        if (now - post.heartbeatAt > LOBBY_STALE_AFTER_MS * 2) posts.delete(key);
      }
      publishPosts();
    };

    const messageHandler = (value: unknown, fromId: string) => {
      const message = parseDuelMessage(value);
      if (!message) return;
      if (message.k === "duel-claim" && message.to === selfConnId && myPost)
        handlers.onClaim(fromId, message.name ?? null);
      if (message.k === "duel-accept" && message.to === selfConnId) handlers.onAccept(message.code);
      if (message.k === "duel-deny" && message.to === selfConnId) handlers.onDeny(message.reason);
    };
    const stateHandler = (key: string, value: unknown) => acceptPost(key, value);
    const statusHandler = (status: "connected" | "disconnected") => handlers.onStatus(status);
    host.net.on("message", messageHandler);
    host.net.on("state", stateHandler);
    host.net.on("status", statusHandler);
    scanState(joined.state);
    const poll = globalThis.setInterval(() => {
      try {
        scanState(host.net.getState());
      } catch {
        // A disconnected host may throw until Portals reports status/rejoin.
      }
    }, DUEL_STATE_POLL_MS);

    const clearPost = () => {
      if (heartbeat !== null) globalThis.clearInterval(heartbeat);
      heartbeat = null;
      if (myPost) {
        try {
          host.net.setState(lobbyPostKey(selfConnId), null);
        } catch {
          // Best-effort: an unreachable host ages the post out via freshness.
        }
      }
      myPost = null;
    };

    const connection: DuelLobbyConnection = {
      selfConnId,
      selfName: joined.self.displayName,
      post({ name, avatarCode, note, courseTitle }) {
        clearPost();
        const now = Date.now();
        myPost = {
          v: DUEL_PROTOCOL,
          connId: selfConnId,
          name: name.trim().slice(0, 40) || "Runner",
          avatarCode,
          note: note.trim().slice(0, 120),
          courseTitle: courseTitle?.slice(0, 80) ?? null,
          createdAt: now,
          heartbeatAt: now,
        };
        host.net.setState(lobbyPostKey(selfConnId), myPost);
        heartbeat = globalThis.setInterval(() => {
          if (!myPost) return;
          myPost = { ...myPost, heartbeatAt: Date.now() };
          try {
            host.net.setState(lobbyPostKey(selfConnId), myPost);
          } catch {
            // Renewed on the next tick once the host answers again.
          }
        }, LOBBY_HEARTBEAT_MS);
      },
      unpost: clearPost,
      claim(toConnId, name) {
        const message: DuelWireMessage = {
          k: "duel-claim",
          v: DUEL_PROTOCOL,
          to: toConnId,
          name: name.trim().slice(0, 40),
        };
        if (parseDuelMessage(message)) host.net.send(message);
      },
      accept(toConnId, code) {
        const message = parseDuelMessage({ k: "duel-accept", v: DUEL_PROTOCOL, to: toConnId, code });
        if (message) host.net.send(message);
      },
      deny(toConnId, denyReason) {
        const message: DuelWireMessage = { k: "duel-deny", v: DUEL_PROTOCOL, to: toConnId, reason: denyReason };
        if (parseDuelMessage(message)) host.net.send(message);
      },
      async close() {
        clearPost();
        globalThis.clearInterval(poll);
        host.net.off("message", messageHandler);
        host.net.off("state", stateHandler);
        host.net.off("status", statusHandler);
        await host.net.leave();
      },
    };
    return { status: "ok", connection };
  } catch (error) {
    return { status: "error", message: reason(error) };
  }
}

// --- Duel channel -----------------------------------------------------------

export interface DuelChannelHandlers {
  /** A validated match record strictly newer than any seen before. */
  onMatch(match: DuelMatch): void;
  /** Live traffic from the peer: pos, evt, chat, react. */
  onMessage(message: DuelWireMessage, fromId: string): void;
  onPeerJoin(player: PortalsNetPlayer): void;
  onPeerLeave(player: PortalsNetPlayer): void;
  onStatus(status: "connected" | "disconnected"): void;
}

export interface DuelChannelConnection {
  selfConnId: string;
  selfName: string | null;
  /**
   * Write the match record. Last-write-wins is safe because the protocol
   * gives each phase exactly one legitimate writer; seq guards readers.
   */
  publishMatch(match: DuelMatch): "sent" | "too_large";
  send(message: DuelWireMessage): void;
  close(): Promise<void>;
}

export type DuelChannelResult =
  | { status: "ok"; connection: DuelChannelConnection; peers: PortalsNetPlayer[] }
  | { status: "unavailable" }
  | { status: "error"; message: string };

export async function connectDuelChannel(
  code: string,
  handlers: DuelChannelHandlers,
): Promise<DuelChannelResult> {
  const host = net();
  if (!host) return { status: "unavailable" };
  try {
    await host.sdk.ready();
    const joined = await joinWithTimeout(host.net, { channel: duelChannel(code) });
    const selfConnId = joined.self.id;
    let latest: DuelMatch | null = null;

    const acceptMatch = (value: unknown) => {
      const match = parseDuelMatch(value);
      if (!match || !supersedes(match, latest)) return;
      latest = match;
      handlers.onMatch(match);
    };
    const messageHandler = (value: unknown, fromId: string) => {
      if (fromId === selfConnId) return;
      const message = parseDuelMessage(value);
      if (message) handlers.onMessage(message, fromId);
    };
    const stateHandler = (key: string, value: unknown) => {
      if (key === DUEL_MATCH_KEY) acceptMatch(value);
    };
    const joinHandler = (player: PortalsNetPlayer) => {
      if (player.id !== selfConnId) handlers.onPeerJoin(player);
    };
    const leaveHandler = (player: PortalsNetPlayer) => {
      if (player.id !== selfConnId) handlers.onPeerLeave(player);
    };
    const statusHandler = (status: "connected" | "disconnected") => handlers.onStatus(status);
    host.net.on("message", messageHandler);
    host.net.on("state", stateHandler);
    host.net.on("playerjoin", joinHandler);
    host.net.on("playerleave", leaveHandler);
    host.net.on("status", statusHandler);
    acceptMatch(joined.state[DUEL_MATCH_KEY]);
    // Same lost-event safety net map-session needed in the processed host:
    // the confirmed setState write can outrun the live state event for a
    // player who joined after the writer. seq makes unchanged samples no-ops.
    const poll = globalThis.setInterval(() => {
      try {
        acceptMatch(host.net.getState(DUEL_MATCH_KEY));
      } catch {
        // A disconnected host may throw until Portals reports status/rejoin.
      }
    }, DUEL_STATE_POLL_MS);

    const connection: DuelChannelConnection = {
      selfConnId,
      selfName: joined.self.displayName,
      publishMatch(match) {
        if (duelWireBytes(match) > DUEL_WIRE_MAX_BYTES) return "too_large";
        latest = match;
        host.net.setState(DUEL_MATCH_KEY, match);
        return "sent";
      },
      send(message) {
        if (parseDuelMessage(message)) host.net.send(message);
      },
      async close() {
        globalThis.clearInterval(poll);
        host.net.off("message", messageHandler);
        host.net.off("state", stateHandler);
        host.net.off("playerjoin", joinHandler);
        host.net.off("playerleave", leaveHandler);
        host.net.off("status", statusHandler);
        await host.net.leave();
      },
    };
    return { status: "ok", connection, peers: joined.players.filter((p) => p.id !== selfConnId) };
  } catch (error) {
    return { status: "error", message: reason(error) };
  }
}
