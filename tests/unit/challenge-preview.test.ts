import { describe, expect, it } from "vitest";
import {
  buildChallengePreview,
  FALLBACK_PREVIEW,
} from "@/lib/game/challenge-preview";
import { TRAP_CATALOG } from "@/lib/game/trap-catalog";
import type { ChallengeDTO, TrapType } from "@/lib/game/types";

function make(over: Partial<ChallengeDTO> = {}): ChallengeDTO {
  return {
    id: "id",
    slug: "abcdef",
    chainId: "chain",
    chainSlug: "abcdef",
    parentSlug: null,
    depth: 0,
    baseSeed: 1,
    levelVersion: 1,
    createdByName: "Sam",
    createdByAvatarSeed: 1,
    addedTrap: null,
    traps: [],
    ghostTrace: null,
    stats: {
      attempts: 0, completions: 0, survivalRate: null,
      bestTimeMs: null, recentAttempts: 0, shareCount: 0,
    },
    createdAt: new Date(0).toISOString(),
    isDemo: false,
    ...over,
  } as ChallengeDTO;
}

function trapInstance(type: TrapType) {
  return {
    id: "t1", type, ownerUserId: null, ownerName: "Sam", ownerAvatarSeed: 1,
    depthAdded: 1, zoneId: "runway_front", position: [0, 1, 5] as [number, number, number],
    rotationY: 0, seed: 1, params: {},
  };
}

describe("challenge link preview", () => {
  it("names the person and the trap they added", () => {
    const type = "rolling_fridge" as TrapType;
    const preview = buildChallengePreview(
      make({ depth: 1, addedTrap: trapInstance(type), traps: [trapInstance(type)] }),
    );
    expect(preview.headline).toContain("Sam");
    expect(preview.headline).toContain(TRAP_CATALOG[type].articleName);
    expect(preview.badge).toBe(TRAP_CATALOG[type].displayName.toUpperCase());
  });

  it("says something honest about a level nobody has touched", () => {
    const preview = buildChallengePreview(make());
    expect(preview.badge).toBe("");
    expect(preview.depthLine).toMatch(/nobody/i);
  });

  it("counts traps with correct grammar", () => {
    expect(buildChallengePreview(make({ depth: 1 })).depthLine).toBe("1 trap deep");
    expect(buildChallengePreview(make({ depth: 7 })).depthLine).toBe("7 traps deep");
  });

  it("stays silent about difficulty until the sample means something", () => {
    // One attempt and one failure is not "0% survive". Publishing that number
    // would be a claim the data does not support, on the most public surface
    // this game has.
    const barely = buildChallengePreview(
      make({ stats: { ...make().stats, attempts: 0, completions: 0 } }),
    );
    expect(barely.statLine).toBeNull();
  });

  it("prefers observed outcomes once enough people have tried", () => {
    const preview = buildChallengePreview(
      make({
        stats: { ...make().stats, attempts: 47, completions: 3, survivalRate: 3 / 47 },
      }),
    );
    expect(preview.statLine).toBe("3 of 47 made it out");
  });

  it("falls back to a rate when the sample is small but non-empty", () => {
    const preview = buildChallengePreview(
      make({ stats: { ...make().stats, attempts: 2, completions: 1, survivalRate: 0.5 } }),
    );
    expect(preview.statLine).toBe("50% survival so far");
  });

  it("keeps the generic card intact for links the server cannot read", () => {
    // Demo challenges live only in the creator's browser, so this is the normal
    // path for a large share of links, not an error case.
    expect(FALLBACK_PREVIEW.headline).toBeTruthy();
    expect(FALLBACK_PREVIEW.statLine).toBeNull();
    expect(FALLBACK_PREVIEW.badge).toBe("");
  });
});
