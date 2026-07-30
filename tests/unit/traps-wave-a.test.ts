import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WAVE_A_HAZARD, floodRadius } from "@/components/game/traps/TrapsWaveA";
import { PALETTE, PLAYER } from "@/lib/game/constants";
import { PLACEMENT_ZONES } from "@/lib/game/level-definition";
import { validatePlacement } from "@/lib/game/placement";
import { trapTypeSchema } from "@/lib/game/schemas";
import { TRAP_CATALOG, TRAP_TYPES } from "@/lib/game/trap-catalog";
import type { TrapType } from "@/lib/game/types";

/**
 * The sixteen traps in components/game/traps/TrapsWaveA.tsx.
 *
 * Everything here derives from WAVE_A_HAZARD, which is the table the trap
 * components themselves run on: each takes its cycle length or cooldown and its
 * reported impulse out of it. So this file compares the catalogue against what
 * the traps actually do rather than against a second hand-written reading of
 * it. tests/unit/risk-calibration.test.ts pins the same sixteen from its own
 * table, which makes the two tables agree transitively.
 */
const read = (relativePath: string) =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");

const WAVE_A_TYPES = Object.keys(WAVE_A_HAZARD) as TrapType[];
const source = read("components/game/traps/TrapsWaveA.tsx");

// The rule documented above TRAP_CATALOG in lib/game/trap-catalog.ts.
const EXPOSURE_MS = 1000;
/** What PlayerController leaves a stunned runner: a quarter of dry ground. */
const STUNNED_ACCELERATION = PLAYER.acceleration * 0.25;
const SCALE = 1.7631;
const stunMs = (impulse: number) => Math.min(500, Math.max(250, impulse * 22));
const knockback = (impulse: number) => Math.min(5.5, 1.8 + impulse * 0.22);

function derivedWeight(impulse: number, gateMs: number | null): number {
  const contacts = 1 + (gateMs === null ? 0 : EXPOSURE_MS / gateMs);
  const stunShare = Math.min(1, (contacts * stunMs(impulse)) / EXPOSURE_MS);
  const pushShare = Math.min(
    1,
    (contacts * knockback(impulse)) / (EXPOSURE_MS / 1000) / STUNNED_ACCELERATION,
  );
  return Math.round(((stunShare + pushShare) / 2) * SCALE * 20) / 20;
}

/** The body of one `export function <Name>Trap(` block. */
function trapSections(): Array<{ name: string; body: string }> {
  return source
    .split(/export function /)
    .slice(1)
    .map((section) => ({ name: section.slice(0, section.indexOf("(")), body: section }))
    .filter((entry) => entry.name.endsWith("Trap"));
}

describe("wave A traps are registered everywhere the roster is read", () => {
  it("appends each one to TRAP_TYPES without disturbing the existing order", () => {
    // A share link encodes a trap as its index here, so these sixteen have to
    // sit after everything that shipped before them and nothing already in the
    // list may move. Asserted by index rather than by "the last sixteen",
    // because a later wave appends after these and would break that.
    const first = TRAP_TYPES.indexOf(WAVE_A_TYPES[0]!);
    expect(first).toBeGreaterThan(0);
    expect(TRAP_TYPES.slice(first, first + WAVE_A_TYPES.length)).toEqual(WAVE_A_TYPES);
    expect(TRAP_TYPES).toHaveLength(new Set(TRAP_TYPES).size);
    for (const type of WAVE_A_TYPES) expect(TRAP_CATALOG[type].type).toBe(type);
  });

  it("carries them through the schema, which derives from TRAP_TYPES", () => {
    // lib/game/schemas.ts builds its enum from TRAP_TYPES rather than restating
    // it. When the roster went 8 -> 16 that literal was missed and challenges
    // built from the new traps failed at the storage boundary permanently.
    expect(trapTypeSchema.options).toHaveLength(TRAP_TYPES.length);
    for (const type of WAVE_A_TYPES)
      expect(trapTypeSchema.safeParse(type).success, `${type} rejected`).toBe(true);
  });

  it("gives every trap type a branch in TrapRenderer", () => {
    // A catalogue entry with no case renders nothing at all: the player spends
    // their pick, the challenge stores the trap and the course stays empty.
    const renderer = read("components/game/TrapRenderer.tsx");
    for (const type of TRAP_TYPES)
      expect(renderer, `TrapRenderer has no case for ${type}`).toContain(`case "${type}":`);
  });

  it("leaves every one of them placeable on the classic course", () => {
    for (const type of WAVE_A_TYPES)
      expect(
        PLACEMENT_ZONES.some((zone) => zone.allowedTypes.includes(type)),
        `${type} is allowed in no classic-course zone`,
      ).toBe(true);
  });
});

describe("wave A risk weights derive from measured hazard output", () => {
  it("prices each one by the rule the catalogue documents", () => {
    for (const type of WAVE_A_TYPES) {
      const { impulse, gateMs } = WAVE_A_HAZARD[type as keyof typeof WAVE_A_HAZARD];
      const expected = derivedWeight(impulse, gateMs);
      expect(
        TRAP_CATALOG[type].riskWeight,
        `${type} is priced ${TRAP_CATALOG[type].riskWeight}, the rule gives ${expected}`,
      ).toBe(expected);
    }
  });

  it("prices the fast repeater above the harder one-shot", () => {
    // The belt reports 6 every 800ms and the weights report 9 exactly once.
    // Repeat rate is the axis the pre-recalibration catalogue was blind to, and
    // it has to win here: two thirds of the impulse, priced twice as high.
    expect(WAVE_A_HAZARD.conveyor_strip.impulse).toBeLessThan(
      WAVE_A_HAZARD.ankle_weight.impulse,
    );
    expect(TRAP_CATALOG.conveyor_strip.riskWeight).toBeGreaterThan(
      TRAP_CATALOG.ankle_weight.riskWeight,
    );
  });

  it("leaves the roster mean the difficulty curve was fitted to", () => {
    // survivalOdds in difficulty.ts is fitted against a mean weight of about
    // 1.073 after Charles became the 55th trap. Sixteen traps is a large share of
    // weights here would move the score every existing challenge is shown.
    const mean =
      TRAP_TYPES.reduce((sum, type) => sum + TRAP_CATALOG[type].riskWeight, 0) /
      TRAP_TYPES.length;
    expect(mean).toBeCloseTo(1.073, 2);
  });

  it("keeps the reported impulse and the repeat gate out of the placement params", () => {
    // defaultParams is what a placement can override. If either number the rule
    // reads were tunable there, a placed trap could quietly cost more than the
    // catalogue says it does.
    for (const type of WAVE_A_TYPES) {
      const keys = Object.keys(TRAP_CATALOG[type].defaultParams);
      expect(keys, `${type} exposes its impulse to placements`).not.toContain("impulse");
      expect(keys, `${type} exposes its repeat gate to placements`).not.toContain("gateMs");
    }
  });
});

describe("wave A traps telegraph what they are about to do", () => {
  it("draws a ground marker in the reserved danger colour for each of them", () => {
    // An audit found the three highest-risk traps drew nothing on the floor.
    // PALETTE.danger is reserved for hazard reach and used for nothing else, so
    // a section without it is a trap the player cannot see coming.
    const sections = trapSections();
    expect(sections).toHaveLength(WAVE_A_TYPES.length);
    for (const { name, body } of sections)
      expect(body, `${name} draws no PALETTE.danger marker`).toContain("PALETTE.danger");
  });

  it("keeps the danger colour reserved by never hard-coding its hex", () => {
    // The point of the reservation is that one constant can be changed and
    // every hazard marker in the game moves with it.
    expect(source).not.toContain(PALETTE.danger);
  });

  it("gives each of them a wind-up as well as a footprint", () => {
    // Space alone is not a telegraph: a marker that never changes cannot say
    // when. Every trap here drives at least one marker or prop off the clock,
    // the approach, or its own phase.
    for (const { name, body } of trapSections())
      expect(
        /\.(visible|opacity|scale|position|rotation)\b/.test(body),
        `${name} has no time-varying telegraph`,
      ).toBe(true);
  });

  it("sizes every marker from the constant the hit test uses", () => {
    // Spot-check the traps whose reach is easiest to get wrong, by asserting
    // the marker and the test share an identifier rather than a literal.
    expect(source).toContain("<planeGeometry args={[span, BUNTING_BAND_HALF * 2]} />");
    expect(source).toContain("<planeGeometry args={[span, FLAP_BAND_HALF * 2]} />");
    expect(source).toContain("<ringGeometry args={[DUST_CONTACT - 0.08, DUST_CONTACT, 24]} />");
    expect(source).toContain(
      "<ringGeometry args={[PLATES_STACK_RADIUS - 0.07, PLATES_STACK_RADIUS, 22]} />",
    );
  });

  it("gives every trap a prop no other trap in the wave mounts", () => {
    // These sixteen used to borrow one of seven sculpted meshes through
    // AssetModel, so a laundry chute arrived as a refrigerator and a fish bowl
    // as a beach ball. A trap a player cannot name is a trap they cannot learn,
    // which is a fairness problem rather than a cosmetic one, so what this
    // asserts is the property that makes them tellable apart: each trap mounts
    // a component of its own out of traps/TrapProps.tsx, and no two share one.
    expect(source, "a borrowed prop is back in this file").not.toContain("<AssetModel");
    expect(source, "a placeholder prop is back in this file").not.toContain("PLACEHOLDER");
    const props = new Set(
      [...read("components/game/traps/TrapProps.tsx").matchAll(/export function (\w+)\(/g)].map(
        (match) => match[1]!,
      ),
    );
    const mountedBy = new Map<string, string[]>();
    for (const { name, body } of trapSections()) {
      const mounted = [...body.matchAll(/<([A-Z]\w+)[\s/>]/g)]
        .map((match) => match[1]!)
        .filter((component) => props.has(component));
      expect(mounted.length, `${name} mounts no prop of its own`).toBeGreaterThan(0);
      for (const prop of new Set(mounted))
        mountedBy.set(prop, [...(mountedBy.get(prop) ?? []), name]);
    }
    for (const [prop, traps] of mountedBy)
      expect(traps, `${prop} is shared by ${traps.join(" and ")}`).toHaveLength(1);
    expect(mountedBy.size).toBeGreaterThanOrEqual(WAVE_A_TYPES.length);
  });
});

describe("wave A traps do what their catalogue entry claims", () => {
  it("keeps the sink growing, and stops it at the width it advertises", () => {
    // The whole trap is that its reach is a function of the clock, so a fixed
    // radius would silently make it a worse soap slick.
    const { start, growth, widest } = { start: 0.7, growth: 0.055, widest: 2 };
    expect(floodRadius(0, start, growth, widest)).toBeCloseTo(start, 6);
    expect(floodRadius(10_000, start, growth, widest)).toBeGreaterThan(
      floodRadius(1_000, start, growth, widest),
    );
    expect(floodRadius(10 * 60 * 1000, start, growth, widest)).toBe(widest);
    // Its widest has to be reachable inside a run, or the mechanic never fires.
    expect(floodRadius(60_000, start, growth, widest)).toBeGreaterThan(start * 1.5);
  });

  it("leaves the cat flap a safe crawl and a safe sprint on either side", () => {
    const { slow, fast } = TRAP_CATALOG.cat_flap.defaultParams;
    expect(typeof slow === "number" && typeof fast === "number").toBe(true);
    expect(Number(slow)).toBeGreaterThan(0);
    expect(Number(fast)).toBeGreaterThan(Number(slow) + 0.5);
    // The fast escape has to be reachable: PLAYER.moveSpeed is what a runner
    // can actually hold, so a threshold above it would make the band open-ended
    // and turn the trap into a second extension cord.
    expect(Number(fast)).toBeLessThan(PLAYER.moveSpeed);
  });

  it("makes the mattress a real upward launch, not a soft horizontal nudge", () => {
    const bounce = TRAP_CATALOG.mattress_rebound.defaultParams["bounce"];
    expect(typeof bounce).toBe("number");
    expect(bounce as number).toBeGreaterThanOrEqual(1.6);

    const mattress = source.slice(
      source.indexOf("const MATTRESS_SPAN_FALLBACK"),
      source.indexOf("// Plate Shards"),
    );
    expect(mattress).toContain("const MATTRESS_VERTICAL_RETURN = 4.5");
    expect(mattress).toContain("const MATTRESS_MAX_RETURN = 12.5");
    expect(mattress).toContain("y: MATTRESS_VERTICAL_RETURN * impulseMass");
    expect(mattress).toContain('"mattress_launched"');
  });

  it("cannot re-topple the dominoes faster than the gate it is priced on", () => {
    // The rank's own phases decide how soon it can strike again. If they summed
    // to less than the report gate the catalogue price would be a fiction, and
    // if they summed to more the gate would be the fiction.
    const phases = ["DOMINO_TEETER_MS", "DOMINO_TOPPLE_MS", "DOMINO_REST_MS", "DOMINO_RISE_MS"]
      .map((name) => {
        const match = new RegExp(`const ${name} = (\\d+);`).exec(source);
        expect(match, `${name} is not a plain constant any more`).not.toBeNull();
        return Number(match![1]);
      })
      .reduce((sum, value) => sum + value, 0);
    expect(phases).toBeLessThanOrEqual(WAVE_A_HAZARD.domino_line.gateMs);
  });

  it("puts the chute's landing somewhere the runner has already stood", () => {
    // The setback runs along world -Z, not the trap's own rotation: a rotated
    // placement aiming the drop off the side of a platform would turn a 0.95
    // weight trap into an instant loss.
    const chute = source.slice(source.indexOf("export function ChuteDropTrap"));
    expect(chute).toContain("z: trap.position[2] - setback");
    expect(chute).not.toMatch(/setTranslation\([\s\S]{0,240}forward\./);
  });

  it("keeps every wave A placement radius inside what the course can hold", () => {
    // Radius is what the overlap rule reads, and the classic course is now full
    // at 38 traps. This is a floor, not a target: shrinking a radius to win a
    // packing argument would make every trap crowd its neighbours.
    for (const type of WAVE_A_TYPES) {
      expect(TRAP_CATALOG[type].placementRadius).toBeGreaterThanOrEqual(0.5);
      expect(TRAP_CATALOG[type].placementRadius).toBeLessThanOrEqual(1);
    }
  });

  it("pins the raised zone capacity against the migration that seeds it", () => {
    // The client and publish_child_challenge both refuse a placement once a
    // zone is full, so a count the server has not been told about means the
    // editor accepts a placement the RPC then rejects. Textual pinning only:
    // nothing here executes SQL, and the migration has never been run.
    const sql = read("supabase/migrations/0012_wave_a_trap_roster.sql");
    const seeded = new Map<string, number>();
    for (const match of sql.matchAll(
      /update public\.placement_zones set max_occupants = (\d+)\s*where id (?:in \(([^)]*)\)|= '([a-z_]+)')\s*;/g,
    )) {
      const ids = match[2]
        ? [...match[2].matchAll(/'([a-z_]+)'/g)].map((entry) => entry[1]!)
        : [match[3]!];
      for (const id of ids) seeded.set(id, Number(match[1]));
    }
    expect(seeded.size, "0012 seeds no max_occupants at all").toBeGreaterThan(0);
    for (const [id, occupants] of seeded) {
      const zone = PLACEMENT_ZONES.find((entry) => entry.id === id);
      expect(zone, `0012 raises an unknown zone ${id}`).toBeDefined();
      expect(occupants, `max_occupants for ${id}`).toBe(zone!.maxOccupants);
    }
    // 0002_tables.sql declares check(max_occupants between 1 and 4), so a
    // client-side count above 4 could never be stored.
    for (const zone of PLACEMENT_ZONES) {
      expect(zone.maxOccupants).toBeGreaterThanOrEqual(1);
      expect(zone.maxOccupants, `${zone.id} exceeds the database check`).toBeLessThanOrEqual(4);
    }
  });

  it("still fits one of every trap on the classic course", () => {
    // The sandbox list is checked in trap-roster.test.ts. This asserts the
    // headroom question directly: a single placement of each wave A trap in the
    // roomiest zone it is allowed in must validate against an empty course.
    for (const type of WAVE_A_TYPES) {
      const zone = PLACEMENT_ZONES.find((entry) => entry.allowedTypes.includes(type));
      expect(zone, `${type} is allowed nowhere`).toBeDefined();
      const result = validatePlacement(
        { type, zoneId: zone!.id, offsetX: 0, offsetZ: 0, rotationQuarterTurns: 0 },
        [],
      );
      expect(result.valid, `${type} in ${zone!.id}: ${result.valid ? "" : result.reason}`).toBe(true);
    }
  });
});
