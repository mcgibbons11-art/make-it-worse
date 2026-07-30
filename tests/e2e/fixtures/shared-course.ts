import {
  CHALLENGE_LINK_PARAM,
  encodeChallengeLink,
} from "@/lib/game/challenge-link";
import { validatePlacement } from "@/lib/game/placement";
import { TRAP_CATALOG } from "@/lib/game/trap-catalog";
import { buildTrack } from "@/lib/game/track";
import type { ChallengeDTO, TrapInstance } from "@/lib/game/types";

const STRAIGHT_JUMP_TRACK = ["start", "washboard", "finish"] as const;
const STRAIGHT_TRAP_TRACK = ["start", "runway", "finish"] as const;

function challengeUrl(challenge: ChallengeDTO): string {
  const query = new URLSearchParams({
    [CHALLENGE_LINK_PARAM]: encodeChallengeLink(challenge),
  });
  return `/c/${challenge.slug}?${query.toString()}`;
}

function challenge(
  slug: string,
  track: readonly string[],
  traps: TrapInstance[] = [],
): ChallengeDTO {
  return {
    id: `${slug}-id`,
    slug,
    chainId: `${slug}-chain`,
    chainSlug: `${slug}-chain`,
    parentSlug: null,
    depth: traps.length,
    baseSeed: 20260730,
    levelVersion: 1,
    createdByName: "Physics Badger",
    createdByAvatarSeed: 73,
    addedTrap: traps.at(-1) ?? null,
    traps,
    ghostTrace: null,
    stats: {
      attempts: 0,
      completions: 0,
      survivalRate: 0,
      bestTimeMs: null,
      recentAttempts: 0,
      shareCount: 0,
    },
    createdAt: new Date(0).toISOString(),
    isDemo: true,
    track,
  };
}

/** A fixed clean route with real half-unit ridges that require keyboard jumps. */
export function cleanKeyboardCourseUrl(): string {
  return challengeUrl(challenge("e2e-keyboard-course", STRAIGHT_JUMP_TRACK));
}

/** A wide straight carrying a real floor fan, isolated from random route shape. */
export function floorFanCourseUrl(): string {
  const built = buildTrack(STRAIGHT_TRAP_TRACK);
  const runway = built.pieces.find((piece) => piece.id === "run_1");
  if (!runway) throw new Error("E2E runway surface is missing");
  const input = {
    type: "floor_fan" as const,
    zoneId: runway.id,
    offsetX: 0,
    offsetZ: -1.5,
    rotationQuarterTurns: 2 as const,
  };
  const placement = validatePlacement(input, [], built);
  if (!placement.valid)
    throw new Error(`E2E floor fan is invalid: ${placement.reason}`);
  const trap: TrapInstance = {
    id: "e2e-floor-fan",
    type: input.type,
    ownerUserId: null,
    ownerName: "Physics Badger",
    ownerAvatarSeed: 73,
    depthAdded: 1,
    zoneId: input.zoneId,
    position: placement.canonicalPosition,
    rotationY: placement.rotationY,
    seed: 73,
    params: TRAP_CATALOG.floor_fan.defaultParams,
  };
  return challengeUrl(challenge("e2e-floor-fan-course", STRAIGHT_TRAP_TRACK, [trap]));
}
