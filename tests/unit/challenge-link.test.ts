import { describe, expect, it } from "vitest";
import {
  CHALLENGE_LINK_PARAM,
  challengeLinkUrl,
  decodeChallengeLink,
  encodeChallengeLink,
} from "@/lib/game/challenge-link";
import { placementSurfaces, validatePlacement } from "@/lib/game/placement";
import { buildTrack } from "@/lib/game/track";
import { seededId } from "@/lib/game/seed";
import { TRAP_CATALOG } from "@/lib/game/trap-catalog";
import type { ChallengeDTO, TrapInstance, TrapType } from "@/lib/game/types";

interface Placed {
  type: TrapType;
  zoneId: string;
  owner: string;
  quarterTurns?: 0 | 1 | 2 | 3;
  offsetX?: number;
  offsetZ?: number;
}

function buildChallenge(placed: readonly Placed[]): ChallengeDTO {
  const traps: TrapInstance[] = [];
  placed.forEach((entry, index) => {
    const rotationQuarterTurns = entry.quarterTurns ?? 0;
    const placement = validatePlacement(
      {
        type: entry.type,
        zoneId: entry.zoneId,
        offsetX: entry.offsetX ?? 0,
        offsetZ: entry.offsetZ ?? 0,
        rotationQuarterTurns,
      },
      traps,
    );
    if (!placement.valid)
      throw new Error(`fixture placement rejected: ${placement.reason}`);
    const seed = 1000 + index;
    traps.push({
      id: seededId("trap", seed),
      type: entry.type,
      ownerUserId: null,
      ownerName: entry.owner,
      ownerAvatarSeed: 40 + index,
      depthAdded: index + 1,
      zoneId: entry.zoneId,
      position: placement.canonicalPosition,
      rotationY: placement.rotationY,
      seed,
      params: TRAP_CATALOG[entry.type].defaultParams,
    });
  });
  return {
    id: "local-1",
    slug: "worse-abc123",
    chainId: "chain-1",
    chainSlug: "chain-abc123",
    parentSlug: null,
    depth: traps.length,
    baseSeed: 424242,
    levelVersion: 1,
    createdByName: "Wobbly Badger",
    createdByAvatarSeed: 7,
    addedTrap: traps.at(-1) ?? null,
    traps,
    ghostTrace: null,
    stats: {
      attempts: 3,
      completions: 1,
      survivalRate: 1 / 3,
      bestTimeMs: 20_000,
      recentAttempts: 3,
      shareCount: 2,
    },
    createdAt: new Date(0).toISOString(),
    isDemo: true,
  };
}

describe("challenge links", () => {
  it("round-trips every field the level is rebuilt from", () => {
    const challenge = buildChallenge([
      { type: "floor_fan", zoneId: "runway_mid", owner: "Turbo Otter" },
      {
        type: "giant_beach_ball",
        zoneId: "bridge_front",
        owner: "Cheeky Kettle",
        quarterTurns: 2,
      },
      { type: "rotating_toilet", zoneId: "finish_front", owner: "Turbo Otter" },
    ]);
    const decoded = decodeChallengeLink(encodeChallengeLink(challenge));

    expect(decoded.slug).toBe(challenge.slug);
    expect(decoded.baseSeed).toBe(challenge.baseSeed);
    expect(decoded.depth).toBe(3);
    expect(decoded.createdByName).toBe("Wobbly Badger");
    expect(decoded.createdByAvatarSeed).toBe(7);
    expect(decoded.traps).toHaveLength(3);
    decoded.traps.forEach((trap, index) => {
      const original = challenge.traps[index]!;
      expect(trap.type).toBe(original.type);
      expect(trap.zoneId).toBe(original.zoneId);
      expect(trap.ownerName).toBe(original.ownerName);
      expect(trap.ownerAvatarSeed).toBe(original.ownerAvatarSeed);
      expect(trap.seed).toBe(original.seed);
      expect(trap.id).toBe(original.id);
      expect(trap.position[0]).toBeCloseTo(original.position[0], 6);
      expect(trap.position[1]).toBeCloseTo(original.position[1], 6);
      expect(trap.position[2]).toBeCloseTo(original.position[2], 6);
      expect(trap.rotationY).toBeCloseTo(original.rotationY, 6);
    });
    expect(decoded.addedTrap?.type).toBe("rotating_toilet");
  });

  it("preserves owner names containing spaces", () => {
    // The generated names are always "Adjective Noun", so a name guard that
    // rejected spaces would have made every real link undecodable.
    const challenge = buildChallenge([
      { type: "soap_slick", zoneId: "runway_front", owner: "Dizzy Teapot" },
    ]);
    expect(
      decodeChallengeLink(encodeChallengeLink(challenge)).traps[0]?.ownerName,
    ).toBe("Dizzy Teapot");
  });

  it("survives a full-depth chain inside a usable URL length", () => {
    // Twenty legal placements, SEARCHED rather than written down.
    //
    // This test is about payload length at full chain depth; which twenty spots
    // the traps occupy is incidental to it. The list used to be hand-picked,
    // and it broke the moment the course was reshaped and narrowed - failing
    // with "outside_zone" on a fixture, which tells you nothing about whether a
    // 20-deep chain still fits in a URL. Searching keeps the test measuring the
    // thing it is named after.
    const steps = [0, 1, -1, 2, -2, 0.5, -0.5, 1.5, -1.5];
    const slots: Placed[] = [];
    const standing: TrapInstance[] = [];
    outer: for (const surface of placementSurfaces()) {
      for (const offsetX of steps)
        for (const offsetZ of steps) {
          const type = (slots.length % 2 ? "soap_slick" : "spring_pad") as TrapType;
          const check = validatePlacement(
            { type, zoneId: surface.id, offsetX, offsetZ, rotationQuarterTurns: 0 },
            standing,
          );
          if (!check.valid) continue;
          slots.push({ type, zoneId: surface.id, offsetX, offsetZ, owner: `Runner ${slots.length}` });
          standing.push({
            id: `probe_${slots.length}`, type, ownerUserId: null, ownerName: "probe",
            ownerAvatarSeed: 1, depthAdded: 1, zoneId: surface.id,
            position: check.canonicalPosition, rotationY: check.rotationY, seed: 1, params: {},
          });
          if (slots.length === 20) break outer;
        }
    }
    expect(slots, "could not find 20 legal placements on the whole course").toHaveLength(20);
    const challenge = buildChallenge(slots);
    const payload = encodeChallengeLink(challenge);
    const decoded = decodeChallengeLink(payload);
    expect(decoded.traps).toHaveLength(20);
    expect(decoded.depth).toBe(20);
    expect(payload.length).toBeLessThan(2_000);
  });

  it("builds a URL carrying the payload", () => {
    const challenge = buildChallenge([
      { type: "floor_fan", zoneId: "runway_mid", owner: "Turbo Otter" },
    ]);
    const url = new URL(challengeLinkUrl(challenge, "https://example.test"));
    expect(url.pathname).toBe("/c/worse-abc123");
    const payload = url.searchParams.get(CHALLENGE_LINK_PARAM);
    expect(payload).toBeTruthy();
    expect(decodeChallengeLink(payload!).traps[0]?.type).toBe("floor_fan");
  });

  it("carries a custom track and rebuilds it on the far side", () => {
    const segments = ["start", "zigzag", "gap", "pillars", "finish"];
    const track = buildTrack(segments);
    const traps: TrapInstance[] = [];
    // Place one trap in each zone the composed track exposes.
    track.zones.slice(0, 3).forEach((zone, index) => {
      const placement = validatePlacement(
        {
          type: "soap_slick",
          zoneId: zone.id,
          offsetX: 0,
          offsetZ: 0,
          rotationQuarterTurns: 0,
        },
        traps,
        track,
      );
      if (!placement.valid)
        throw new Error(`custom-track fixture rejected: ${placement.reason}`);
      const seed = 900 + index;
      traps.push({
        id: seededId("trap", seed),
        type: "soap_slick",
        ownerUserId: null,
        ownerName: `Runner ${index}`,
        ownerAvatarSeed: index,
        depthAdded: index + 1,
        zoneId: zone.id,
        position: placement.canonicalPosition,
        rotationY: placement.rotationY,
        seed,
        params: TRAP_CATALOG.soap_slick.defaultParams,
      });
    });
    const challenge: ChallengeDTO = {
      ...buildChallenge([]),
      depth: traps.length,
      traps,
      addedTrap: traps.at(-1) ?? null,
      track: segments,
    };

    const decoded = decodeChallengeLink(encodeChallengeLink(challenge));
    expect(decoded.track).toEqual(segments);
    expect(decoded.traps).toHaveLength(traps.length);
    decoded.traps.forEach((trap, index) => {
      expect(trap.zoneId).toBe(traps[index]!.zoneId);
      expect(trap.position[2]).toBeCloseTo(traps[index]!.position[2], 6);
    });
    // Links are emitted at version 3 now, which also carries the parent's
    // record. What matters is that older links still decode, since any already
    // shared in a chat must keep working.
    const classicPayload = encodeChallengeLink(buildChallenge([]));
    expect(
      JSON.parse(atob(classicPayload.replace(/-/g, "+").replace(/_/g, "/")))[0],
    ).toBe(3);
    const v1 = "WzEsIndvcnNlLWxpbmt0ZXN0Iiw5ODc2NTQsMCwxMixbIkNoZWVreSBLZXR0bGUiLCJUdXJibyBPdHRlciJdLFtbMiwxLDAsMCwwLDEsMTEsNTAwMF0sWzcsNiwwLDAsMCwwLDEyLDUwMDFdXV0";
    const decodedV1 = decodeChallengeLink(v1);
    expect(decodedV1.traps).toHaveLength(2);
    expect(decodedV1.track).toBeUndefined();
    expect(decodedV1.stats.attempts).toBe(0);
  });

  it("carries the sender's record so an arriving stranger sees proof", () => {
    // Zeroed stats meant every recipient read "0 attempts, No survival data",
    // which is precisely the line that says nobody has played this.
    const played: ChallengeDTO = {
      ...buildChallenge([]),
      stats: {
        attempts: 47,
        completions: 6,
        survivalRate: 6 / 47,
        bestTimeMs: 6410,
        recentAttempts: 47,
        shareCount: 3,
      },
    };
    const decoded = decodeChallengeLink(encodeChallengeLink(played));
    expect(decoded.stats.attempts).toBe(47);
    expect(decoded.stats.completions).toBe(6);
    expect(decoded.stats.bestTimeMs).toBe(6410);
    // Derived, not carried, so a hand-edited link cannot claim a survival rate
    // its own counts contradict.
    expect(decoded.stats.survivalRate).toBeCloseTo(6 / 47, 6);
  });

  it("refuses a link whose track could never be finished", () => {
    const challenge = { ...buildChallenge([]), track: ["runway", "gap"] };
    expect(() =>
      decodeChallengeLink(encodeChallengeLink(challenge)),
    ).toThrow("CHALLENGE_LINK_INVALID");
  });

  it("rejects malformed, tampered, and unplayable payloads", () => {
    expect(() => decodeChallengeLink("")).toThrow("CHALLENGE_LINK_INVALID");
    expect(() => decodeChallengeLink("not-base64!!")).toThrow(
      "CHALLENGE_LINK_INVALID",
    );
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value), "utf8")
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    // Wrong version.
    expect(() =>
      decodeChallengeLink(encode([2, "worse-abc123", 1, 0, 0, ["A B"], []])),
    ).toThrow("CHALLENGE_LINK_INVALID");
    // Trap type index out of range.
    expect(() =>
      decodeChallengeLink(
        encode([
          1,
          "worse-abc123",
          1,
          0,
          0,
          ["Wobbly Badger"],
          [[99, 0, 0, 0, 0, 0, 1, 1]],
        ]),
      ),
    ).toThrow("CHALLENGE_LINK_INVALID");
    // Two traps stacked in one spot: the canonical validator refuses the
    // overlap, so the link is refused rather than producing a broken level.
    expect(() =>
      decodeChallengeLink(
        encode([
          1,
          "worse-abc123",
          1,
          0,
          0,
          ["Wobbly Badger"],
          [
            [0, 0, 0, 0, 0, 0, 1, 1],
            [0, 0, 0, 0, 0, 0, 1, 2],
          ],
        ]),
      ),
    ).toThrow("CHALLENGE_LINK_INVALID");
    // A trap crammed onto the spawn pad.
    expect(() =>
      decodeChallengeLink(
        encode([
          1,
          "worse-abc123",
          1,
          0,
          0,
          ["Wobbly Badger"],
          [[0, 0, 0, -MAX_STEPS_BEYOND_ZONE, 0, 0, 1, 1]],
        ]),
      ),
    ).toThrow("CHALLENGE_LINK_INVALID");
  });
});

const MAX_STEPS_BEYOND_ZONE = 40;
