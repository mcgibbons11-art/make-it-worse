import { describe, expect, it } from "vitest";
import { challengeSchema, trapTypeSchema } from "@/lib/game/schemas";
import { TRAP_CATALOG, TRAP_TYPES } from "@/lib/game/trap-catalog";
import { decodeChallengeLink, encodeChallengeLink } from "@/lib/game/challenge-link";
import { isPlayableTrack } from "@/lib/game/track";
import { validatePlacement } from "@/lib/game/placement";
import { seededId } from "@/lib/game/seed";
import type { ChallengeDTO, TrapInstance } from "@/lib/game/types";

const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

function baseChallenge(traps: TrapInstance[] = []): ChallengeDTO {
  return {
    id: "x",
    slug: "worse-abc123",
    chainId: "c",
    chainSlug: "cs",
    parentSlug: null,
    depth: traps.length,
    baseSeed: 1,
    levelVersion: 1,
    createdByName: "Wobbly Badger",
    createdByAvatarSeed: 1,
    addedTrap: traps.at(-1) ?? null,
    traps,
    ghostTrace: null,
    stats: {
      attempts: 0,
      completions: 0,
      survivalRate: null,
      bestTimeMs: null,
      recentAttempts: 0,
      shareCount: 0,
    },
    createdAt: new Date(0).toISOString(),
    isDemo: true,
  };
}

describe("share link hardening", () => {
  it("validates every trap the game can actually offer", () => {
    // The roster grew from 8 to 16 while this enum kept the original 8, so a
    // reward offering a new trap decoded and rendered and then failed at the
    // storage boundary, bricking the player's own save.
    expect(trapTypeSchema.options).toHaveLength(TRAP_TYPES.length);
    for (const type of TRAP_TYPES)
      expect(trapTypeSchema.safeParse(type).success, `${type} rejected`).toBe(
        true,
      );
  });

  it("stores a challenge built from any trap in the catalogue", () => {
    for (const type of TRAP_TYPES) {
      const placement = validatePlacement(
        { type, zoneId: "runway_mid", offsetX: 0, offsetZ: 0, rotationQuarterTurns: 0 },
        [],
      );
      if (!placement.valid) continue;
      const trap: TrapInstance = {
        id: seededId("trap", 1),
        type,
        ownerUserId: null,
        ownerName: "Turbo Otter",
        ownerAvatarSeed: 1,
        depthAdded: 1,
        zoneId: "runway_mid",
        position: placement.canonicalPosition,
        rotationY: placement.rotationY,
        seed: 1,
        params: TRAP_CATALOG[type].defaultParams,
      };
      expect(
        challengeSchema.safeParse(baseChallenge([trap])).success,
        `${type} cannot be persisted`,
      ).toBe(true);
    }
  });

  it("refuses a link whose names would not pass the local name field", () => {
    // SAFE_NAME only gated the character class, and publishChild copies the
    // parent's traps, so an imported slur was re-shared under the recipient's
    // own name to their friends.
    for (const name of ["Shit Badger", "free-robux.example.com"])
      expect(() =>
        decodeChallengeLink(
          encode([1, "worse-abc123", 1, 0, 0, [name], []]),
        ),
      ).toThrow("CHALLENGE_LINK_INVALID");
    // A normal generated name still round-trips.
    expect(
      decodeChallengeLink(
        encode([1, "worse-abc123", 1, 0, 0, ["Wobbly Badger"], []]),
      ).createdByName,
    ).toBe("Wobbly Badger");
  });

  it("refuses a course nobody could finish inside the attempt limit", () => {
    // "classic" is the whole original level as one segment. Checked only at
    // index 0, a hand-written link could repeat it for a 422-unit course.
    expect(isPlayableTrack(["classic"])).toBe(true);
    expect(isPlayableTrack(["start", "classic", "finish"])).toBe(false);
    expect(
      isPlayableTrack(["start", ...new Array(10).fill("classic"), "finish"]),
    ).toBe(false);
  });

  it("fails loudly rather than emitting a link that cannot be decoded", () => {
    // A trap in a zone the track does not contain used to encode as index -1:
    // the sender saw a normal link and the recipient saw a damaged one.
    const orphan: TrapInstance = {
      id: "trap_x",
      type: "floor_fan",
      ownerUserId: null,
      ownerName: "Turbo Otter",
      ownerAvatarSeed: 1,
      depthAdded: 1,
      zoneId: "a_zone_that_does_not_exist",
      position: [0, 0.05, 6.75],
      rotationY: 0,
      seed: 1,
      params: {},
    };
    expect(() => encodeChallengeLink(baseChallenge([orphan]))).toThrow(
      /CHALLENGE_LINK_UNENCODABLE/,
    );
  });
});
