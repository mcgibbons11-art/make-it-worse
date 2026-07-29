import { describe, expect, it } from "vitest";
import { totalRisk } from "@/lib/game/difficulty";
import { PLACEMENT_ZONES } from "@/lib/game/level-definition";
import { TRAP_CATALOG, TRAP_TYPES } from "@/lib/game/trap-catalog";
import type { TrapInstance, TrapType, Vec3Tuple } from "@/lib/game/types";

function trap(
  type: TrapType,
  position: Vec3Tuple,
  zoneId = "runway_mid",
): TrapInstance {
  return {
    id: `${type}-${position[2]}`,
    type,
    ownerUserId: null,
    ownerName: "Turbo Otter",
    ownerAvatarSeed: 1,
    depthAdded: 1,
    zoneId,
    position,
    rotationY: 0,
    seed: 1,
    params: TRAP_CATALOG[type].defaultParams,
  };
}

describe("risk model", () => {
  it("prices a disabling trap next to a pushing one above the pair apart", () => {
    // Anything that soaks or stuns cuts steering authority from 30 m/s^2 to
    // about 7, so a magnet beside a soak beats the player outright. The table
    // knew only the original eight, leaving these at zero.
    const pairs: [TrapType, TrapType][] = [
      ["soap_slick", "fridge_magnet"],
      ["sprinkler", "fridge_magnet"],
      ["robot_mop", "floor_fan"],
      ["spring_pad", "ceiling_fan"],
    ];
    for (const [a, b] of pairs) {
      const near = totalRisk([trap(a, [0, 0, 8]), trap(b, [0, 0, 9])]);
      const far = totalRisk([trap(a, [0, 0, 8]), trap(b, [0, 0, 30])]);
      expect(near, `${a} + ${b} is not priced as a combination`).toBeGreaterThan(
        far,
      );
    }
  });

  it("only counts a combination when both can catch the same player", () => {
    const together = totalRisk([
      trap("soap_slick", [0, 0, 8]),
      trap("fridge_magnet", [0, 0, 10]),
    ]);
    const apart = totalRisk([
      trap("soap_slick", [0, 0, 8]),
      trap("fridge_magnet", [0, 0, 40]),
    ]);
    expect(together).toBeGreaterThan(apart);
    // Distance is the only difference, so the gap is exactly the bonus.
    expect(together - apart).toBeCloseTo(0.4, 6);
  });

  it("leaves every classic zone able to accept a modern trap", () => {
    // These allowlists predate the roster doubling. Four of fifteen zones on
    // the course every existing challenge uses accepted none of the new traps.
    // Everything added after the original eight, however many waves that ends
    // up being. This used to pin the count at 14, which said nothing about the
    // allowlists and broke on the next wave for no useful reason.
    const modern = TRAP_TYPES.slice(8);
    expect(modern.length).toBe(TRAP_TYPES.length - 8);
    expect(modern.length).toBeGreaterThan(0);
    for (const zone of PLACEMENT_ZONES)
      expect(
        modern.some((type) => zone.allowedTypes.includes(type)),
        `classic zone ${zone.id} accepts none of the newer traps`,
      ).toBe(true);
  });

  it("keeps the stepping stones restrictive on purpose", () => {
    // Small mandatory pads: a sweep or a chase there is unavoidable, not hard.
    const banned: TrapType[] = [
      "swinging_hammer",
      "rotating_toilet",
      "rolling_fridge",
      "angry_vacuum",
      "mousetrap",
      "ceiling_fan",
    ];
    for (const zone of PLACEMENT_ZONES.filter((z) => z.id.startsWith("stones")))
      for (const type of banned)
        expect(
          zone.allowedTypes.includes(type),
          `${type} should not be placeable on ${zone.id}`,
        ).toBe(false);
  });
});
