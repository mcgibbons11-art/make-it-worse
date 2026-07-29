import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DRAWER_SCHEDULE,
  NEW_TRAP_HAZARD,
  PAINT_SCHEDULE,
  RUG_SCHEDULE,
  drawerOffset,
} from "@/components/game/traps/NewTraps";
import { PLAYER } from "@/lib/game/constants";
import { trapTypeSchema } from "@/lib/game/schemas";
import { TRAP_CATALOG, TRAP_TYPES } from "@/lib/game/trap-catalog";
import type { TrapType } from "@/lib/game/types";

/**
 * The six traps in components/game/traps/NewTraps.tsx.
 *
 * Everything here derives from NEW_TRAP_HAZARD, which is the table the trap
 * components themselves run on: each one takes its cycle length or cooldown and
 * its reported impulse out of it. So this file compares the catalogue against
 * what the traps actually do rather than against a second hand-written reading
 * of it. tests/unit/risk-calibration.test.ts pins the same six from its own
 * table, which makes the two tables agree transitively.
 */
const read = (relativePath: string) =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");

const NEW_TYPES = Object.keys(NEW_TRAP_HAZARD) as TrapType[];

// The rule documented above TRAP_CATALOG in lib/game/trap-catalog.ts.
const EXPOSURE_MS = 1000;
/** What PlayerController leaves a stunned runner: a quarter of dry ground. */
const STUNNED_ACCELERATION = PLAYER.acceleration * 0.25;
const SCALE = 1.7631;
const stunMs = (impulse: number) => Math.min(500, Math.max(250, impulse * 22));
const knockback = (impulse: number) => Math.min(5.5, 1.8 + impulse * 0.22);

function derivedWeight(impulse: number, gateMs: number): number {
  const contacts = 1 + EXPOSURE_MS / gateMs;
  const stunShare = Math.min(1, (contacts * stunMs(impulse)) / EXPOSURE_MS);
  const pushShare = Math.min(
    1,
    (contacts * knockback(impulse)) / (EXPOSURE_MS / 1000) / STUNNED_ACCELERATION,
  );
  return Math.round(((stunShare + pushShare) / 2) * SCALE * 20) / 20;
}

describe("new traps are registered everywhere the roster is read", () => {
  it("appends each one to TRAP_TYPES without disturbing the existing order", () => {
    // A share link encodes a trap as its index here, so the six have to stay
    // contiguous and in order, and nothing before them may move. This used to
    // assert they were the LAST six, which stopped being true the moment a
    // later wave appended after them; the index of the first is the thing that
    // actually has to hold, and it survives every wave that comes next.
    const first = TRAP_TYPES.indexOf(NEW_TYPES[0]!);
    expect(first).toBe(16);
    expect(TRAP_TYPES.slice(first, first + NEW_TYPES.length)).toEqual(NEW_TYPES);
    expect(TRAP_TYPES).toHaveLength(new Set(TRAP_TYPES).size);
    for (const type of NEW_TYPES) expect(TRAP_CATALOG[type].type).toBe(type);
  });

  it("carries them through the schema, which derives from TRAP_TYPES", () => {
    // lib/game/schemas.ts builds its enum from TRAP_TYPES rather than restating
    // it. When the roster went 8 -> 16 that literal was missed and challenges
    // built from the new traps failed at the storage boundary permanently.
    expect(trapTypeSchema.options).toHaveLength(TRAP_TYPES.length);
    for (const type of NEW_TYPES)
      expect(trapTypeSchema.safeParse(type).success, `${type} rejected`).toBe(true);
  });

  it("gives every trap type a branch in TrapRenderer", () => {
    // A catalogue entry with no case renders nothing at all: the player spends
    // their pick, the challenge stores the trap and the course stays empty.
    const source = read("components/game/TrapRenderer.tsx");
    for (const type of TRAP_TYPES)
      expect(source, `TrapRenderer has no case for ${type}`).toContain(`case "${type}":`);
  });
});

describe("new trap risk weights derive from measured hazard output", () => {
  it("prices each one by the rule the catalogue documents", () => {
    for (const type of NEW_TYPES) {
      const { impulse, gateMs } = NEW_TRAP_HAZARD[type as keyof typeof NEW_TRAP_HAZARD];
      const expected = derivedWeight(impulse, gateMs);
      expect(
        TRAP_CATALOG[type].riskWeight,
        `${type} is priced ${TRAP_CATALOG[type].riskWeight}, the rule gives ${expected}`,
      ).toBe(expected);
    }
  });

  it("prices the fast repeater above the harder one-shot", () => {
    // The gum reports 4 every 1200ms and the drawer 9 every 3400ms. Repeat rate
    // is the axis the old catalogue was blind to, and it has to win here: less
    // than half the impulse, priced higher, because it lands again.
    expect(NEW_TRAP_HAZARD.sticky_gum.impulse).toBeLessThan(
      NEW_TRAP_HAZARD.drawer_slam.impulse,
    );
    expect(TRAP_CATALOG.sticky_gum.riskWeight).toBeGreaterThan(
      TRAP_CATALOG.drawer_slam.riskWeight,
    );
  });

  it("leaves the roster mean the difficulty curve was fitted to", () => {
    // survivalOdds in difficulty.ts is fitted against a mean weight of about
    // 1.066. Six traps is a quarter of the roster, so a careless set of weights
    // here would move the score every existing challenge is shown.
    const mean =
      TRAP_TYPES.reduce((sum, type) => sum + TRAP_CATALOG[type].riskWeight, 0) /
      TRAP_TYPES.length;
    expect(mean).toBeCloseTo(1.066, 2);
  });
});

describe("new traps telegraph what they are about to do", () => {
  it("draws a ground marker in the reserved danger colour for each of them", () => {
    // An audit found the three highest-risk traps drew nothing on the floor.
    // PALETTE.danger is reserved for hazard reach and used for nothing else, so
    // a section without it is a trap the player cannot see coming.
    const source = read("components/game/traps/NewTraps.tsx");
    const sections = source
      .split(/export function /)
      .slice(1)
      .map((section) => ({ name: section.slice(0, section.indexOf("(")), section }))
      .filter((entry) => entry.name.endsWith("Trap"));
    expect(sections).toHaveLength(NEW_TYPES.length);
    for (const { name, section } of sections)
      expect(section, `${name} draws no PALETTE.danger marker`).toContain(
        "PALETTE.danger",
      );
  });

  it("leaves the paint can a window between locking on and letting go", () => {
    // The aim stops following at aimMs and the can falls at releaseMs. If that
    // gap closed, the trap would be unavoidable rather than committed.
    expect(PAINT_SCHEDULE.releaseMs - PAINT_SCHEDULE.aimMs).toBeGreaterThanOrEqual(400);
    expect(PAINT_SCHEDULE.releaseMs + PAINT_SCHEDULE.fallMs).toBeLessThan(
      NEW_TRAP_HAZARD.paint_bucket.gateMs,
    );
  });

  it("keeps the drawer's lane open for most of its cycle", () => {
    const { outMs, dwellMs, inMs, rattleMs } = DRAWER_SCHEDULE;
    const cycle = NEW_TRAP_HAZARD.drawer_slam.gateMs;
    const shut = outMs + dwellMs + inMs;
    expect(shut).toBeLessThan(cycle - shut);
    // The rattle has to fit inside the closed window, or the wind-up would
    // start before the drawer had finished sliding back in.
    expect(rattleMs).toBeLessThan(cycle - shut);
    expect(drawerOffset(-1, 1.35)).toBe(0);
    expect(drawerOffset(outMs + dwellMs / 2, 1.35)).toBe(1.35);
    expect(drawerOffset(shut, 1.35)).toBe(0);
  });

  it("spends exactly the rug's repeat gate getting back to armed", () => {
    // The catalogue price is derived from that gate, so the sum of the phases
    // is what makes the price honest.
    const { delayMs, yankMs, returnMs, rearmMs } = RUG_SCHEDULE;
    expect(delayMs + yankMs + returnMs + rearmMs).toBe(NEW_TRAP_HAZARD.rug_pull.gateMs);
    expect(rearmMs).toBeGreaterThan(0);
    // Long enough to sprint off, short enough that hesitating is punished.
    expect(delayMs).toBeGreaterThanOrEqual(250);
    expect(delayMs).toBeLessThanOrEqual(600);
  });
});

describe("new traps sound like themselves", () => {
  /** The body of each `case "<type>":` in AudioManager.hazard(). */
  function hazardVoices(): Map<string, string> {
    const source = read("lib/audio/AudioManager.ts");
    const start = source.indexOf("hazard(type: TrapType, impulse: number): void {");
    expect(start, "AudioManager.hazard() not found").toBeGreaterThan(-1);
    const body = source.slice(start);
    const voices = new Map<string, string>();
    const pattern = /case "(\w+)":([\s\S]*?)(?=\n\s*case "|\n\s*}\n\s*}\n)/g;
    for (const match of body.matchAll(pattern))
      voices.set(match[1]!, match[2]!.replace(/\/\/[^\n]*/g, "").trim());
    return voices;
  }

  it("gives each new trap its own synthesis rather than a shared thud", () => {
    // Twelve of sixteen traps used to share one 90Hz thud, so a magnet grab and
    // a beach-ball nudge were acoustically identical.
    const voices = hazardVoices();
    const bodies = new Map<string, string>();
    for (const [type, voice] of voices) {
      if (voice.length === 0) continue; // floor_fan falls through to angry_vacuum
      const twin = bodies.get(voice);
      expect(twin, `${type} and ${twin} synthesise the same sound`).toBeUndefined();
      bodies.set(voice, type);
    }
    for (const type of NEW_TYPES) {
      const voice = voices.get(type);
      expect(voice, `${type} has no case in AudioManager.hazard()`).toBeDefined();
      expect(voice!.length, `${type} has an empty voice`).toBeGreaterThan(0);
    }
  });

  it("scales the recorded peak of every trap, new ones included", () => {
    // HAZARD_PEAK is a Record<TrapType, number>, so a missing entry is a build
    // error rather than a silent one, but a new trap left at another trap's
    // level would still read as the wrong weight of hit.
    const source = read("lib/audio/AudioManager.ts");
    for (const type of NEW_TYPES)
      expect(source, `HAZARD_PEAK has no level for ${type}`).toMatch(
        new RegExp(`${type}:\\s*0?\\.\\d+`),
      );
  });
});
