import { describe, expect, it } from "vitest";
import { MAX_TRAPS } from "@/lib/game/constants";
import { challengeSchema } from "@/lib/game/schemas";
import { DEFAULT_CUSTOM_TRACK, MAX_TRACK_SEGMENTS } from "@/lib/game/track";
import { TRAP_TYPES } from "@/lib/game/trap-catalog";

// The storage schema must never be tighter than the gameplay limits. When the
// trap roster grew 8 -> 16 the enum here was left restating the old list, and
// because publishChild writes without validating, a level published fine and
// then threw forever on read - players bricked their own saves by playing
// normally. Four numeric bounds had the same shape (MAX_TRAPS twice, plus
// depthAdded, plus MAX_TRACK_SEGMENTS). These tests fail if any of them is
// pinned back to a literal while the constant moves.

function trap(index: number) {
  return {
    id: `trap-${index}`,
    type: TRAP_TYPES[index % TRAP_TYPES.length]!,
    ownerUserId: null,
    ownerName: "Tester",
    ownerAvatarSeed: 1,
    depthAdded: index + 1,
    zoneId: "runway_front",
    position: [0, 1, 5] as [number, number, number],
    rotationY: 0,
    seed: index,
    params: {},
  };
}

function challenge(trapCount: number, track?: readonly string[]) {
  return {
    id: "id-1",
    slug: "abcdef",
    chainId: "chain-1",
    chainSlug: "abcdef",
    parentSlug: null,
    depth: trapCount,
    baseSeed: 7,
    levelVersion: 1 as const,
    createdByName: "Tester",
    createdByAvatarSeed: 1,
    addedTrap: null,
    traps: Array.from({ length: trapCount }, (_, index) => trap(index)),
    ghostTrace: null,
    stats: {
      attempts: 0, completions: 0, survivalRate: null,
      bestTimeMs: null, recentAttempts: 0, shareCount: 0,
    },
    createdAt: new Date(0).toISOString(),
    isDemo: true,
    ...(track ? { track: [...track] } : {}),
  };
}

describe("storage schema bounds track the gameplay limits", () => {
  it("accepts a challenge carrying the full trap allowance", () => {
    const result = challengeSchema.safeParse(challenge(MAX_TRAPS));
    expect(result.success, JSON.stringify(result.error?.issues?.slice(0, 2))).toBe(true);
  });

  it("rejects one trap past the allowance", () => {
    expect(challengeSchema.safeParse(challenge(MAX_TRAPS + 1)).success).toBe(false);
  });

  it("accepts a track of the maximum composable length", () => {
    // A real composition, padded to the cap, so this also fails if the schema's
    // per-segment id length ever falls behind the catalogue's naming.
    const longest = [
      "start",
      ...Array.from({ length: MAX_TRACK_SEGMENTS - 2 }, () => "bridge"),
      "finish",
    ];
    expect(longest).toHaveLength(MAX_TRACK_SEGMENTS);
    const result = challengeSchema.safeParse(challenge(0, longest));
    expect(result.success, JSON.stringify(result.error?.issues?.slice(0, 2))).toBe(true);
  });

  it("rejects a track one segment past the cap", () => {
    const tooLong = [
      "start",
      ...Array.from({ length: MAX_TRACK_SEGMENTS - 1 }, () => "bridge"),
      "finish",
    ];
    expect(challengeSchema.safeParse(challenge(0, tooLong)).success).toBe(false);
  });

  it("accepts the shipped default custom track", () => {
    expect(DEFAULT_CUSTOM_TRACK.length).toBeLessThanOrEqual(MAX_TRACK_SEGMENTS);
    expect(challengeSchema.safeParse(challenge(0, DEFAULT_CUSTOM_TRACK)).success).toBe(true);
  });

  it("accepts every trap type the roster offers", () => {
    // The original bug in one line: a type the game can offer must survive a
    // round trip through storage.
    for (const type of TRAP_TYPES) {
      const one = challenge(1);
      one.traps[0]!.type = type;
      expect(challengeSchema.safeParse(one).success, `roster type ${type} rejected`).toBe(true);
    }
  });
});
