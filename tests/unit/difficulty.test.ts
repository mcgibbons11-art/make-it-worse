import { describe, expect, it } from "vitest";
import {
  estimatedSurvival,
  estimatedWorsePercent,
} from "@/lib/game/difficulty";
import type { TrapInstance, TrapType } from "@/lib/game/types";

const trap: TrapInstance = {
  id: "t",
  type: "angry_vacuum",
  ownerUserId: null,
  ownerName: "Safe Otter",
  ownerAvatarSeed: 1,
  depthAdded: 1,
  zoneId: "bridge_front",
  position: [0, 0.05, 18],
  rotationY: 0,
  seed: 1,
  params: {},
};

/** A chain of `count` traps spread far enough apart to avoid pair bonuses. */
function chain(count: number, type: TrapType = "angry_vacuum"): TrapInstance[] {
  return Array.from({ length: count }, (_, index) => ({
    ...trap,
    id: `t${index}`,
    type,
    depthAdded: index + 1,
    zoneId: "bridge_front",
    position: [0, 0.05, index * 9] as const,
  }));
}

describe("difficulty", () => {
  it("is bounded and positive risk never improves survival", () => {
    expect(estimatedSurvival([])).toBeGreaterThanOrEqual(0.01);
    expect(estimatedSurvival([])).toBeLessThanOrEqual(0.99);
    expect(estimatedSurvival([trap])).toBeLessThan(estimatedSurvival([]));
    expect(estimatedWorsePercent([], [trap])).toBeGreaterThanOrEqual(1);
  });

  it("still reports a real percentage once survival bottoms out", () => {
    // The displayed survival floors at 1%. When that floor was also used for
    // the comparison, parent and child both clamped and every deep publish
    // read "You made it 1% worse" from about depth 11 up.
    for (const depth of [11, 14, 17, 19]) {
      const parent = chain(depth);
      const child = chain(depth + 1);
      expect(estimatedSurvival(parent)).toBe(0.01);
      expect(estimatedSurvival(child)).toBe(0.01);
      const worse = estimatedWorsePercent(parent, child);
      expect(
        worse,
        `depth ${depth} -> ${depth + 1} reported ${worse}% worse`,
      ).toBeGreaterThan(1);
    }
  });

  it("scales the reported damage with how lethal the added trap is", () => {
    const parent = chain(6);
    const mild = [...parent, { ...trap, id: "x", type: "giant_beach_ball" as TrapType, position: [0, 0.05, 60] as const }];
    const nasty = [...parent, { ...trap, id: "x", type: "angry_vacuum" as TrapType, position: [0, 0.05, 60] as const }];
    expect(estimatedWorsePercent(parent, nasty)).toBeGreaterThan(
      estimatedWorsePercent(parent, mild),
    );
  });
});
