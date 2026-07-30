import {
  decodeChallengeLink,
  decodeChallengeRuntimeTrack,
  encodeChallengeLink,
} from "@/lib/game/challenge-link";
import type { AvatarConfig } from "@/lib/game/avatar";
import type { ChallengeDTO } from "@/lib/game/types";
import type { BuiltTrack } from "@/lib/game/track";

export const PUBLISHED_MAP_CODE_PREFIX = "MIW-MAP-1.";
export const PUBLISHED_MAP_CODE_MAX_LENGTH = 8_000;
export const PUBLISHED_MAP_CATALOG_KEY = "miw.portals-published-maps.v1";
const MAX_REMEMBERED_MAPS = 48;

export interface PublishedMapRecord {
  mapId: string;
  versionId: string;
  title: string;
  author: string;
  publishedAt: string;
  code: string;
  challengeCode: string;
  challenge: ChallengeDTO;
  track: BuiltTrack;
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(payload: string): string {
  const standard = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (standard.length % 4)) % 4);
  const binary = atob(standard + padding);
  return new TextDecoder().decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  );
}

function cleanTitle(value: unknown): string {
  if (typeof value !== "string") throw new Error("PUBLISHED_MAP_CODE_INVALID");
  const title = value.trim();
  if (
    title.length < 2 ||
    title.length > 80 ||
    /[\u0000-\u001f\u007f]/.test(title)
  ) throw new Error("PUBLISHED_MAP_CODE_INVALID");
  return title;
}

function cleanPublishedAt(value: unknown): string {
  if (typeof value !== "string" || value.length > 40 || Number.isNaN(Date.parse(value)))
    throw new Error("PUBLISHED_MAP_CODE_INVALID");
  return value;
}

function assertPublishedRoot(challenge: ChallengeDTO, track: BuiltTrack | null): BuiltTrack {
  // A made-worse child has a parent slug. A generated clean course uses a
  // different chain slug. Only a root authored in Build your game satisfies
  // all three checks, so challenge codes cannot distort a published map's rank.
  if (!track || challenge.parentSlug !== null || challenge.slug !== challenge.chainSlug)
    throw new Error("PUBLISHED_MAP_CODE_NOT_ROOT");
  return track;
}

function assertPublishedIdentity(
  mapId: unknown,
  versionId: unknown,
  challenge: ChallengeDTO,
): { mapId: string; versionId: string } {
  if (
    typeof mapId !== "string" ||
    typeof versionId !== "string" ||
    !/^[a-z0-9-]{6,24}$/.test(mapId) ||
    mapId !== versionId ||
    versionId !== challenge.slug
  ) throw new Error("PUBLISHED_MAP_CODE_NOT_ROOT");
  return { mapId, versionId };
}

export function encodePublishedMapCode(input: {
  challenge: ChallengeDTO;
  track: BuiltTrack;
  avatar: AvatarConfig | null;
  title: string;
  publishedAt?: string;
}): string {
  assertPublishedRoot(input.challenge, input.track);
  const challengeCode = encodeChallengeLink(input.challenge, input.avatar, input.track);
  return wrapPublishedMapCode({
    challengeCode,
    title: input.title,
    mapId: input.challenge.chainSlug,
    versionId: input.challenge.slug,
    ...(input.publishedAt ? { publishedAt: input.publishedAt } : {}),
  });
}

export function wrapPublishedMapCode(input: {
  challengeCode: string;
  title: string;
  mapId: string;
  versionId: string;
  publishedAt?: string;
}): string {
  const challenge = decodeChallengeLink(input.challengeCode);
  assertPublishedIdentity(input.mapId, input.versionId, challenge);
  if (!decodeChallengeRuntimeTrack(input.challengeCode))
    throw new Error("PUBLISHED_MAP_CODE_NOT_ROOT");
  const title = cleanTitle(input.title);
  const publishedAt = cleanPublishedAt(input.publishedAt ?? new Date().toISOString());
  const metadata = toBase64Url(
    JSON.stringify([title, publishedAt, input.mapId, input.versionId]),
  );
  const code = `${PUBLISHED_MAP_CODE_PREFIX}${metadata}.${input.challengeCode}`;
  if (code.length > PUBLISHED_MAP_CODE_MAX_LENGTH)
    throw new Error("PUBLISHED_MAP_CODE_TOO_LARGE");
  return code;
}

export function decodePublishedMapCode(code: string): PublishedMapRecord {
  const trimmed = code.trim();
  if (
    trimmed.length > PUBLISHED_MAP_CODE_MAX_LENGTH ||
    !trimmed.startsWith(PUBLISHED_MAP_CODE_PREFIX)
  ) throw new Error("PUBLISHED_MAP_CODE_INVALID");
  const remainder = trimmed.slice(PUBLISHED_MAP_CODE_PREFIX.length);
  const divider = remainder.indexOf(".");
  if (divider <= 0 || divider === remainder.length - 1)
    throw new Error("PUBLISHED_MAP_CODE_INVALID");
  let metadata: unknown;
  try {
    metadata = JSON.parse(fromBase64Url(remainder.slice(0, divider)));
  } catch {
    throw new Error("PUBLISHED_MAP_CODE_INVALID");
  }
  if (!Array.isArray(metadata) || metadata.length !== 4)
    throw new Error("PUBLISHED_MAP_CODE_INVALID");
  const title = cleanTitle(metadata[0]);
  const publishedAt = cleanPublishedAt(metadata[1]);
  const challengeCode = remainder.slice(divider + 1);
  const challenge = decodeChallengeLink(challengeCode);
  const identity = assertPublishedIdentity(metadata[2], metadata[3], challenge);
  const track = decodeChallengeRuntimeTrack(challengeCode);
  if (!track) throw new Error("PUBLISHED_MAP_CODE_NOT_ROOT");
  return {
    mapId: identity.mapId,
    versionId: identity.versionId,
    title,
    author: challenge.createdByName,
    publishedAt,
    code: trimmed,
    challengeCode,
    challenge,
    track,
  };
}

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function listRememberedPublishedMaps(
  storage: Storage | null = browserStorage(),
): PublishedMapRecord[] {
  if (!storage) return [];
  let codes: unknown;
  try {
    codes = JSON.parse(storage.getItem(PUBLISHED_MAP_CATALOG_KEY) ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(codes)) return [];
  const seen = new Set<string>();
  const maps: PublishedMapRecord[] = [];
  for (const value of codes) {
    if (typeof value !== "string") continue;
    try {
      const map = decodePublishedMapCode(value);
      if (seen.has(map.versionId)) continue;
      seen.add(map.versionId);
      maps.push(map);
    } catch {
      // One damaged local entry must not hide the rest of the catalog.
    }
  }
  return maps
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, MAX_REMEMBERED_MAPS);
}

export function rememberPublishedMap(
  code: string,
  storage: Storage | null = browserStorage(),
): PublishedMapRecord {
  const map = decodePublishedMapCode(code);
  if (!storage) return map;
  const next = [
    map,
    ...listRememberedPublishedMaps(storage).filter(
      (entry) => entry.versionId !== map.versionId,
    ),
  ].slice(0, MAX_REMEMBERED_MAPS);
  storage.setItem(
    PUBLISHED_MAP_CATALOG_KEY,
    JSON.stringify(next.map((entry) => entry.code)),
  );
  return map;
}
