// Adapter for the Portals SDK leaderboard.
//
// Portals injects ./_portals/sdk.js into every processed preview and published
// bundle, so the runtime is absent during `vite dev` and in any other host.
// Every call below feature-detects `window.Portals` and returns a status the UI
// can show, rather than throwing into a render path.
//
// Type declarations mirror https://portals.to/portals-sdk/portals.d.ts (SDK
// v1.0.0). The SDK file itself is managed by Portals and must not be vendored.

import { ATTEMPT_LIMIT_MS } from "@/lib/game/constants";

export type PortalsContext = "standalone" | "room";

export interface PortalsPlayer {
  playerId: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

interface PortalsSession {
  player: PortalsPlayer;
  context: PortalsContext;
}

interface PortalsLeaderboardEntry {
  rank: number;
  playerId: string;
  displayName: string | null;
  avatarUrl: string | null;
  score: number;
}

interface PortalsSdk {
  readonly version: string;
  ready(): Promise<PortalsSession>;
  getPlayer(): Promise<PortalsPlayer>;
  readonly identity: {
    requestLogin(): Promise<PortalsPlayer>;
    onChange(listener: (player: PortalsPlayer) => void): () => void;
  };
  saveState(data: unknown): Promise<void>;
  loadState<T = unknown>(): Promise<T | null>;
  submitScore(score: number, mode?: string): Promise<void>;
  getLeaderboard(options?: {
    mode?: string;
    limit?: number;
  }): Promise<{ mode: string; entries: PortalsLeaderboardEntry[] }>;
  quit(): void;
}

declare global {
  interface Window {
    Portals?: PortalsSdk;
  }
}

export const LEADERBOARD_SIZE = 10;

export interface ClearTime {
  rank: number;
  playerId: string;
  displayName: string | null;
  clearTimeMs: number;
}

export type ConnectResult =
  | { status: "ok"; player: PortalsPlayer }
  | { status: "unavailable" }
  | { status: "error"; message: string };

export type SubmitResult =
  | { status: "ok" }
  | { status: "unavailable" }
  | { status: "sign_in_required" }
  | { status: "error"; message: string };

export type BoardResult =
  | { status: "ok"; entries: ClearTime[] }
  | { status: "unavailable" }
  | { status: "error"; message: string };

// The SDK ranks higher scores first, but a faster clear is a better clear, so
// the remaining milliseconds invert the ordering. Scores are shifted up by
// one (MIN_SCORE..MAX_SCORE instead of 0..ATTEMPT_LIMIT_MS) so a clear that
// lands exactly on the attempt limit still gets a strictly positive score
// without needing a separate floor that would collide with the next-fastest
// duration. Both directions clamp their input to the valid domain, so an
// out-of-range or hostile score can never decode to a negative clear time,
// and every duration in [0, ATTEMPT_LIMIT_MS] round-trips through
// clearTimeToScore -> scoreToClearTime back to itself exactly.
const MIN_SCORE = 1;
const MAX_SCORE = ATTEMPT_LIMIT_MS + 1;

export function clearTimeToScore(durationMs: number): number {
  const clampedDuration = Math.min(Math.max(0, durationMs), ATTEMPT_LIMIT_MS);
  return Math.round(MAX_SCORE - clampedDuration);
}

export function scoreToClearTime(score: number): number {
  const clampedScore = Math.min(Math.max(MIN_SCORE, Math.round(score)), MAX_SCORE);
  return MAX_SCORE - clampedScore;
}

// Every trap in a chain is shared by everyone playing that depth, so depth is
// the only axis on which two players' times compare fairly. Chain slugs are
// local to one browser in this edition and would never collect a second player.
export function depthMode(depth: number): string {
  return `depth-${Math.max(0, Math.trunc(depth))}`;
}

let readyPromise: Promise<PortalsSession> | null = null;

function host(): PortalsSdk | null {
  return typeof window === "undefined" ? null : (window.Portals ?? null);
}

// Caching the handshake avoids a round trip per call, but a cached rejection
// would make one transient failure permanent, so drop it and let the next
// caller retry.
function ready(sdk: PortalsSdk): Promise<PortalsSession> {
  readyPromise ??= sdk.ready().catch((error: unknown) => {
    readyPromise = null;
    throw error;
  });
  return readyPromise;
}

function reason(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "The Portals leaderboard did not respond.";
}

export async function connect(): Promise<ConnectResult> {
  const sdk = host();
  if (!sdk) return { status: "unavailable" };
  try {
    await ready(sdk);
    return { status: "ok", player: await sdk.getPlayer() };
  } catch (error) {
    return { status: "error", message: reason(error) };
  }
}

// The SDK requires sign-in to originate from a direct player action, so this
// must stay wired to a button rather than an effect.
export async function signIn(): Promise<ConnectResult> {
  const sdk = host();
  if (!sdk) return { status: "unavailable" };
  try {
    await ready(sdk);
    return { status: "ok", player: await sdk.identity.requestLogin() };
  } catch (error) {
    return { status: "error", message: reason(error) };
  }
}

export function onPlayerChange(
  listener: (player: PortalsPlayer) => void,
): () => void {
  const sdk = host();
  if (!sdk) return () => undefined;
  try {
    return sdk.identity.onChange(listener);
  } catch {
    return () => undefined;
  }
}

export async function submitClearTime(
  depth: number,
  durationMs: number,
): Promise<SubmitResult> {
  const sdk = host();
  if (!sdk) return { status: "unavailable" };
  try {
    await ready(sdk);
    const player = await sdk.getPlayer();
    if (!player.playerId) return { status: "sign_in_required" };
    await sdk.submitScore(clearTimeToScore(durationMs), depthMode(depth));
    return { status: "ok" };
  } catch (error) {
    return { status: "error", message: reason(error) };
  }
}

export async function fetchClearTimes(
  depth: number,
  limit = LEADERBOARD_SIZE,
): Promise<BoardResult> {
  const sdk = host();
  if (!sdk) return { status: "unavailable" };
  try {
    await ready(sdk);
    // The host contract accepts integer limits from 1 through 100. Keep this
    // adapter safe for future callers rather than handing an invalid request to
    // the optional SDK and turning the whole panel into an error state.
    const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
    const board = await sdk.getLeaderboard({
      mode: depthMode(depth),
      limit: safeLimit,
    });
    return {
      status: "ok",
      entries: board.entries.map((entry) => ({
        rank: entry.rank,
        playerId: entry.playerId,
        displayName: entry.displayName,
        clearTimeMs: scoreToClearTime(entry.score),
      })),
    };
  } catch (error) {
    return { status: "error", message: reason(error) };
  }
}
