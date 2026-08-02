import {
  CHALLENGE_LINK_PARAM,
  COMPRESSED_CODE_PREFIX,
} from "@/lib/game/challenge-link";
import { PUBLISHED_MAP_CODE_PREFIX } from "./published-map-catalog";

export const PASTED_MAP_INPUT_MAX_LENGTH = 1_006_144;

// Compressed challenge codes carry the marker and its dot; everything after
// is still plain base64url. Legacy codes have no marker at all.
const COMPRESSED_MARKER = COMPRESSED_CODE_PREFIX.replace(".", "\\.");
const RAW_CHALLENGE_CODE = new RegExp(`^(?:${COMPRESSED_MARKER})?[A-Za-z0-9_-]+$`);
const PUBLISHED_MAP_CODE = new RegExp(
  `^MIW-MAP-1\\.[A-Za-z0-9_-]+\\.(?:${COMPRESSED_MARKER})?[A-Za-z0-9_-]+`,
);

function payloadFromUrl(candidate: string): string | null {
  try {
    return new URL(candidate).searchParams.get(CHALLENGE_LINK_PARAM)?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Accepts the ways a map reaches a Portals player: a raw code, a direct legacy
 * link, a URL embedded in chat copy, or a code whose visual line wrapping was
 * copied as whitespace. The decoder still owns validation; this only isolates
 * the exact payload instead of feeding surrounding prose to it.
 */
export function extractSharedMapPayload(raw: string): string {
  const pasted = raw.trim();
  if (!pasted) return "";

  const directUrl = payloadFromUrl(pasted);
  if (directUrl) return directUrl;

  for (const match of pasted.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    const candidate = match[0].replace(/[),.;!?\]}]+$/, "");
    const payload = payloadFromUrl(candidate);
    if (payload) return payload;
  }

  const published = pasted.slice(pasted.indexOf(PUBLISHED_MAP_CODE_PREFIX));
  const publishedMatch = published.match(PUBLISHED_MAP_CODE)?.[0];
  if (publishedMatch) return publishedMatch;

  // Base64url map codes never contain whitespace. This recovers a code copied
  // from a client that inserted line breaks without weakening decoder checks.
  const compact = pasted.replace(/\s+/g, "");
  if (
    RAW_CHALLENGE_CODE.test(compact) ||
    PUBLISHED_MAP_CODE.test(compact)
  ) return compact;

  const rawMatches = pasted.match(
    new RegExp(`(?:${COMPRESSED_MARKER})?[A-Za-z0-9_-]{40,}`, "g"),
  );
  if (rawMatches?.length) return rawMatches.sort((a, b) => b.length - a.length)[0]!;

  return pasted;
}
