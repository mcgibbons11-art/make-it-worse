import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TRAP_CATALOG, TRAP_TYPES } from "@/lib/game/trap-catalog";
import { PLACEMENT_ZONES } from "@/lib/game/level-definition";
import { validatePlacement } from "@/lib/game/placement";
import { TRACK_SEGMENTS } from "@/lib/game/track";
import type { TrapInstance, TrapPlacementInput, TrapType } from "@/lib/game/types";

// A share link encodes a trap as its index in TRAP_TYPES. Reordering or
// removing an entry silently repoints every link already in the wild at a
// different trap, so the original eight are pinned here by position.
const ORIGINAL_ORDER: readonly TrapType[] = [
  "swinging_hammer",
  "rolling_fridge",
  "floor_fan",
  "soap_slick",
  "spring_pad",
  "angry_vacuum",
  "rotating_toilet",
  "giant_beach_ball",
];

describe("trap roster", () => {
  it("never reorders the trap indices a shared link depends on", () => {
    expect(TRAP_TYPES.slice(0, ORIGINAL_ORDER.length)).toEqual(ORIGINAL_ORDER);
  });

  it("describes every trap it offers", () => {
    for (const type of TRAP_TYPES) {
      const entry = TRAP_CATALOG[type];
      expect(entry, `${type} has no catalog entry`).toBeDefined();
      expect(entry.type).toBe(type);
      expect(entry.displayName.length).toBeGreaterThan(2);
      // The reward panel shows articleName in a sentence, so it must read as
      // one: "Turbo Otter added a rolling refrigerator."
      expect(entry.articleName).toMatch(/^(a|an) /);
      expect(entry.shortDescription.length).toBeGreaterThan(8);
      expect(entry.placementRadius).toBeGreaterThan(0);
      expect(entry.riskWeight).toBeGreaterThan(0);
      expect(["sweeper", "prop", "movement"]).toContain(entry.category);
    }
  });

  it("has no orphaned catalog entries", () => {
    expect(Object.keys(TRAP_CATALOG).sort()).toEqual([...TRAP_TYPES].sort());
  });

  it("keeps every trap placeable somewhere", () => {
    // A trap that no zone accepts can still be offered as a reward and then
    // refuse every placement, stranding the player on the choice screen.
    const zones = [
      ...PLACEMENT_ZONES,
      ...TRACK_SEGMENTS.flatMap((segment) => segment.zones),
    ];
    for (const type of TRAP_TYPES)
      expect(
        zones.some((zone) => zone.allowedTypes.includes(type)),
        `${type} is allowed in no placement zone anywhere`,
      ).toBe(true);
  });

  it("keeps every trap reachable in the QA sandbox", () => {
    // /dev/sandbox?trap=<type> is the only way to exercise a trap without
    // playing a course that happens to contain it, and it serves an empty
    // scene for a type with no placement. The list is read out of the component
    // rather than restated here, so what this test approves is what the sandbox
    // actually builds.
    const source = readFileSync(
      new URL("../../components/game/SandboxClient.tsx", import.meta.url),
      "utf8",
    );
    const block = /const placements: TrapPlacementInput\[\] = \[([\s\S]*?)\n\];/.exec(source);
    expect(block, "could not find the sandbox placement list").not.toBeNull();
    const placements: TrapPlacementInput[] = [
      // zoneId is [\w-]+ rather than \w+ because free placement made every
      // LevelPiece a placement surface, and four of those ids are hyphenated:
      // `right-island`, `left-island`, `center-island`, `stone-a`. Under \w+
      // this pattern silently skipped any placement standing on one, so the
      // list below it read short and the roster comparison blamed the missing
      // trap rather than the parser.
      ...block![1]!.matchAll(
        /\{\s*type:\s*"(\w+)",\s*zoneId:\s*"([\w-]+)",\s*offsetX:\s*(-?[\d.]+),\s*offsetZ:\s*(-?[\d.]+),\s*rotationQuarterTurns:\s*([0-3])\s*\}/g,
      ),
    ].map((entry) => ({
      type: entry[1] as TrapType,
      zoneId: entry[2]!,
      offsetX: Number(entry[3]),
      offsetZ: Number(entry[4]),
      rotationQuarterTurns: Number(entry[5]) as 0 | 1 | 2 | 3,
    }));
    // Reformatting the component past the pattern above has to fail here rather
    // than quietly approve an empty list.
    expect(placements.map((entry) => entry.type).sort()).toEqual(
      [...TRAP_TYPES].sort(),
    );
    // The unfiltered sandbox builds all sixteen at once, so each placement is
    // checked against the ones already standing.
    const standing: TrapInstance[] = [];
    placements.forEach((placement, index) => {
      const result = validatePlacement(placement, standing);
      expect(
        result.valid,
        `${placement.type} in ${placement.zoneId}: ${result.valid ? "" : result.reason}`,
      ).toBe(true);
      if (!result.valid) return;
      standing.push({
        id: `sandbox-${index}`,
        type: placement.type,
        ownerUserId: null,
        ownerName: "QA Gremlin",
        ownerAvatarSeed: 900 + index,
        depthAdded: index + 1,
        zoneId: placement.zoneId,
        position: result.canonicalPosition,
        rotationY: result.rotationY,
        seed: 7000 + index,
        params: TRAP_CATALOG[placement.type].defaultParams,
      });
    });
  });

  it("spreads risk across the three categories", () => {
    // chooseTraps offers one sweeper, one movement and one prop where it can,
    // so a category with too few members makes the reward repetitive.
    for (const category of ["sweeper", "prop", "movement"] as const) {
      const count = TRAP_TYPES.filter(
        (type) => TRAP_CATALOG[type].category === category,
      ).length;
      expect(count, `only ${count} traps in ${category}`).toBeGreaterThanOrEqual(3);
    }
  });
});
