import {
  decodeChallengeLink,
  decodeChallengeRuntimeTrack,
  encodeChallengeLink,
} from "@/lib/game/challenge-link";
import type { AvatarConfig } from "@/lib/game/avatar";
import type { ChallengeDTO } from "@/lib/game/types";
import type { BuiltTrack } from "@/lib/game/track";

export const MAP_SESSION_PROTOCOL = 1;
export const MAP_SESSION_STATE_KEY = "miw:latest-map";
export const MAP_SESSION_MAX_BYTES = 8 * 1024;

export interface MapAnnouncement {
  kind: "miw-map-announcement" | "miw-map-response";
  v: typeof MAP_SESSION_PROTOCOL;
  mapId: string;
  versionId: string;
  title: string;
  author: string;
  publishedAt: string;
  code: string;
}

export interface ReceivedSessionMap {
  announcement: MapAnnouncement;
  challenge: ChallengeDTO;
  track: BuiltTrack | null;
}

interface MapRequest {
  kind: "miw-map-request";
  v: typeof MAP_SESSION_PROTOCOL;
  versionId: string;
}

type MapWireMessage = MapAnnouncement | MapRequest;

export type MapSessionResult =
  | { status: "ok"; connection: MapSessionConnection }
  | { status: "unavailable" }
  | { status: "error"; message: string };

export interface MapSessionConnection {
  announce(input: {
    challenge: ChallengeDTO;
    track: BuiltTrack;
    avatar: AvatarConfig | null;
    title: string;
    publishedAt?: string;
  }): "sent" | "too_large";
  request(versionId: string): void;
  close(): void;
}

function byteLength(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function shortText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function versionId(value: unknown): value is string {
  return shortText(value, 80) && /^[a-z0-9-]+$/i.test(value);
}

export function parseMapSessionMessage(value: unknown): MapWireMessage | null {
  if (!value || typeof value !== "object" || byteLength(value) > MAP_SESSION_MAX_BYTES) return null;
  const message = value as Partial<MapWireMessage> & Record<string, unknown>;
  if (message.v !== MAP_SESSION_PROTOCOL) return null;
  if (message.kind === "miw-map-request") {
    return versionId(message.versionId)
      ? { kind: "miw-map-request", v: MAP_SESSION_PROTOCOL, versionId: message.versionId }
      : null;
  }
  if (message.kind !== "miw-map-announcement" && message.kind !== "miw-map-response") return null;
  if (
    !versionId(message.mapId) ||
    !versionId(message.versionId) ||
    !shortText(message.title, 80) ||
    !shortText(message.author, 40) ||
    !shortText(message.publishedAt, 40) ||
    Number.isNaN(Date.parse(message.publishedAt)) ||
    !shortText(message.code, 8_000)
  ) return null;
  return {
    kind: message.kind,
    v: MAP_SESSION_PROTOCOL,
    mapId: message.mapId,
    versionId: message.versionId,
    title: message.title.trim(),
    author: message.author.trim(),
    publishedAt: message.publishedAt,
    code: message.code,
  };
}

function decodeAnnouncement(message: MapAnnouncement): ReceivedSessionMap | null {
  try {
    const challenge = decodeChallengeLink(message.code);
    if (challenge.slug !== message.versionId) return null;
    return {
      announcement: message,
      challenge,
      track: decodeChallengeRuntimeTrack(message.code),
    };
  } catch {
    return null;
  }
}

function reason(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Portals multiplayer did not respond.";
}

/**
 * Joins the Portals-hosted session and exchanges bounded, self-validating map codes.
 * Outside a processed Portals build this returns `unavailable` and changes nothing.
 */
export async function connectMapSession(
  onMap: (map: ReceivedSessionMap) => void | Promise<void>,
): Promise<MapSessionResult> {
  const sdk = typeof window === "undefined" ? undefined : window.Portals;
  const net = sdk?.net;
  if (!sdk || !net) return { status: "unavailable" };
  try {
    await sdk.ready();
    const joined = await net.join();
    const seen = new Set<string>();
    let latest: MapAnnouncement | null = null;

    const accept = (value: unknown) => {
      const message = parseMapSessionMessage(value);
      if (!message || message.kind === "miw-map-request") return;
      const decoded = decodeAnnouncement(message);
      if (!decoded || seen.has(message.versionId)) return;
      seen.add(message.versionId);
      latest = { ...message, kind: "miw-map-announcement" };
      void Promise.resolve(onMap(decoded)).catch(() => undefined);
    };
    const messageHandler = (value: unknown) => {
      const message = parseMapSessionMessage(value);
      if (!message) return;
      if (message.kind !== "miw-map-request") {
        accept(message);
        return;
      }
      if (!latest || latest.versionId !== message.versionId) return;
      const response: MapAnnouncement = { ...latest, kind: "miw-map-response" };
      if (byteLength(response) <= MAP_SESSION_MAX_BYTES) net.send(response);
    };
    const stateHandler = (key: string, value: unknown) => {
      if (key === MAP_SESSION_STATE_KEY) accept(value);
    };
    // Shared state is the primary late-join path, but a processed Portals
    // preview can occasionally join with an empty initial snapshot while the
    // already-connected publisher still has the confirmed latest version.
    // Portals documents `playerjoin` specifically for keeping the live roster
    // current, so use it as a bounded recovery signal: rebroadcast only the
    // latest validated map once. Existing peers ignore the duplicate through
    // `seen`; the new connection receives the version even when its join
    // snapshot raced the host's state mirror.
    const playerJoinHandler = () => {
      if (!latest) return;
      const response: MapAnnouncement = { ...latest, kind: "miw-map-response" };
      if (byteLength(response) <= MAP_SESSION_MAX_BYTES) net.send(response);
    };
    net.on("message", messageHandler);
    net.on("state", stateHandler);
    net.on("playerjoin", playerJoinHandler);
    accept(joined.state[MAP_SESSION_STATE_KEY]);

    const connection: MapSessionConnection = {
      announce({ challenge, track, avatar, title, publishedAt }) {
        const announcement: MapAnnouncement = {
          kind: "miw-map-announcement",
          v: MAP_SESSION_PROTOCOL,
          mapId: challenge.chainSlug,
          versionId: challenge.slug,
          title: title.trim().slice(0, 80) || "Untitled disaster",
          author: challenge.createdByName.trim().slice(0, 40) || "Builder",
          publishedAt: publishedAt ?? new Date().toISOString(),
          code: encodeChallengeLink(challenge, avatar, track),
        };
        if (byteLength(announcement) > MAP_SESSION_MAX_BYTES) return "too_large";
        latest = announcement;
        seen.add(announcement.versionId);
        net.setState(MAP_SESSION_STATE_KEY, announcement);
        net.send(announcement);
        return "sent";
      },
      request(requestedVersionId) {
        const request: MapRequest = {
          kind: "miw-map-request",
          v: MAP_SESSION_PROTOCOL,
          versionId: requestedVersionId,
        };
        if (parseMapSessionMessage(request)) net.send(request);
      },
      close() {
        net.off("message", messageHandler);
        net.off("state", stateHandler);
        net.off("playerjoin", playerJoinHandler);
        net.leave();
      },
    };
    return { status: "ok", connection };
  } catch (error) {
    return { status: "error", message: reason(error) };
  }
}

/** Exposed for deterministic tests of the 8 KB boundary. */
export function mapSessionWireBytes(value: unknown): number {
  return byteLength(value);
}
