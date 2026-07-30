import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ATTEMPT_LIMIT_MS, PLAYER } from "@/lib/game/constants";
import { TRAP_CATALOG, TRAP_TYPES } from "@/lib/game/trap-catalog";
import {
  WAVE_B_HAZARD,
  WAVE_B_SCHEDULE,
  WAVE_B_TRAP_TYPES,
  type WaveBTrapType,
} from "@/lib/game/traps-wave-b";

/**
 * The sixteen traps in components/game/traps/TrapsWaveB.tsx.
 *
 * Everything priced here derives from WAVE_B_HAZARD, which is the table the
 * components themselves run on: each takes its cycle length or cooldown and its
 * reported impulse out of it. So this file compares the catalogue entries
 * against what the traps actually do rather than against a second hand-written
 * reading of them. It imports only this wave's own modules and the level
 * constants, so it passes before the roster has been widened to include these
 * names.
 */
const source = readFileSync(
  new URL("../../components/game/traps/TrapsWaveB.tsx", import.meta.url),
  "utf8",
);

/** The rule documented above TRAP_CATALOG in lib/game/trap-catalog.ts. */
const EXPOSURE_MS = 1000;
/** What PlayerController leaves a stunned runner: a quarter of dry ground. */
const STUNNED_ACCELERATION = PLAYER.acceleration * 0.25;
const SCALE = 1.7631;
/** GameScene.tsx derives both of these from the reported impulse. */
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

/** Each trap's component, so a source assertion can be scoped to one trap. */
const COMPONENTS: Record<WaveBTrapType, string> = {
  paparazzi: "PaparazziTrap",
  bathroom_scales: "BathroomScalesTrap",
  slow_fuse: "SlowFuseTrap",
  pile_on: "PileOnTrap",
  bin_pedal: "BinPedalTrap",
  swing_door: "SwingDoorTrap",
  ball_machine: "BallMachineTrap",
  cuckoo_clock: "CuckooClockTrap",
  fish_bowl: "FishBowlTrap",
  shoe_rack: "ShoeRackTrap",
  hot_potato: "HotPotatoTrap",
  stove_ring: "StoveRingTrap",
  clothes_airer: "ClothesAirerTrap",
  ice_dispenser: "IceDispenserTrap",
  kettle_boil: "KettleBoilTrap",
  junk_drift: "JunkDriftTrap",
};

/**
 * Each trap's whole block, keyed by its component name. Split on the banner
 * comment rather than on `export function`, because a trap's constants sit
 * above its component and are half of what these assertions are about.
 */
function sections(): Map<string, string> {
  const parts = source.split(/\/\/ -{20,}\r?\n\/\/ .+\r?\n\/\/ -{20,}\r?\n/);
  const found = new Map<string, string>();
  // parts[0] is the file header, which declares no trap.
  for (const block of parts.slice(1)) {
    const name = /export function (\w+Trap)\(/.exec(block)?.[1];
    if (name) found.set(name, block);
  }
  return found;
}

describe("wave B is a complete, self-consistent registry", () => {
  it("lists sixteen distinct traps and describes every one of them", () => {
    expect(WAVE_B_TRAP_TYPES).toHaveLength(16);
    expect(new Set(WAVE_B_TRAP_TYPES).size).toBe(WAVE_B_TRAP_TYPES.length);
    // The sixteen are in the roster proper now, so this asserts membership
    // rather than equality: TRAP_CATALOG carries all fifty-four.
    for (const type of WAVE_B_TRAP_TYPES)
      expect(TRAP_TYPES, `${type} is not in the roster`).toContain(type);
    expect(Object.keys(WAVE_B_HAZARD).sort()).toEqual([...WAVE_B_TRAP_TYPES].sort());
  });

  it("meets every shape TRAP_CATALOG entries are held to", () => {
    // The icon check is deliberately roster-wide rather than scoped to this
    // wave. Two traps sharing an iconKey draws the same picture twice on the
    // choice screen, and a collision with one of the other thirty-eight is
    // exactly as broken as a collision inside this sixteen.
    const icons = new Set(
      TRAP_TYPES.filter((type) => !WAVE_B_TRAP_TYPES.includes(type as WaveBTrapType)).map(
        (type) => TRAP_CATALOG[type].iconKey,
      ),
    );
    for (const type of WAVE_B_TRAP_TYPES) {
      const entry = TRAP_CATALOG[type];
      expect(entry.type).toBe(type);
      expect(entry.displayName.length).toBeGreaterThan(2);
      // The reward panel puts articleName in a sentence: "Turbo Otter added a
      // stack of crockery."
      expect(entry.articleName).toMatch(/^(a|an) /);
      expect(entry.shortDescription.length).toBeGreaterThan(8);
      expect(entry.placementRadius).toBeGreaterThan(0);
      expect(entry.riskWeight).toBeGreaterThan(0);
      expect(["sweeper", "prop", "movement"]).toContain(entry.category);
      expect(icons.has(entry.iconKey), `${type} reuses the icon ${entry.iconKey}`).toBe(false);
      icons.add(entry.iconKey);
    }
  });

  it("spreads the wave across all three categories", () => {
    // chooseTraps offers one sweeper, one movement and one prop where it can, so
    // a wave that landed entirely in one category would make the reward
    // repetitive even though the roster as a whole looks balanced.
    for (const category of ["sweeper", "prop", "movement"] as const) {
      const count = WAVE_B_TRAP_TYPES.filter(
        (type) => TRAP_CATALOG[type].category === category,
      ).length;
      expect(count, `only ${count} wave B traps in ${category}`).toBeGreaterThanOrEqual(4);
    }
  });

  it("keeps the reported impulse and the repeat gate out of defaultParams", () => {
    // Reach and geometry are tunable per placement; the two numbers the price
    // derives from are not, or a tuned placement would silently reprice a trap.
    for (const type of WAVE_B_TRAP_TYPES)
      for (const key of Object.keys(TRAP_CATALOG[type].defaultParams))
        expect(
          /impulse|gate|weight|risk/i.test(key),
          `${type} exposes ${key} to placements`,
        ).toBe(false);
  });
});

describe("wave B risk weights derive from measured hazard output", () => {
  it("prices each one by the rule the catalogue documents", () => {
    for (const type of WAVE_B_TRAP_TYPES) {
      const { impulse, gateMs } = WAVE_B_HAZARD[type];
      const expected = derivedWeight(impulse, gateMs);
      expect(
        TRAP_CATALOG[type].riskWeight,
        `${type} is priced ${TRAP_CATALOG[type].riskWeight}, the rule gives ${expected}`,
      ).toBe(expected);
    }
  });

  it("leaves the roster mean the difficulty curve was fitted to", () => {
    // survivalOdds in difficulty.ts is fitted against a mean weight of about
    // 1.066, and new-traps.test.ts asserts that mean over the whole roster to
    // two decimals. The twenty-two traps that shipped before this wave sum to
    // 23.40. Sixteen more is a large enough share to move the score every
    // existing challenge is shown, so this wave has to sit on the same mean.
    const total = WAVE_B_TRAP_TYPES.reduce(
      (sum, type) => sum + TRAP_CATALOG[type].riskWeight,
      0,
    );
    expect(total / WAVE_B_TRAP_TYPES.length).toBeCloseTo(1.066, 2);
  });

  it("keeps every trap here out of the sustained band", () => {
    // risk-calibration.test.ts requires every trap that can land again inside
    // the 1000ms exposure window to price above every trap that cannot. The
    // lowest of those sustained traps is the sprinkler at 1.45, so nothing here
    // may gate at or below 1000ms, and nothing here may price near 1.45.
    for (const type of WAVE_B_TRAP_TYPES) {
      const gate = WAVE_B_HAZARD[type].gateMs;
      expect(gate === null || gate > EXPOSURE_MS, `${type} gates at ${gate}ms`).toBe(true);
      expect(TRAP_CATALOG[type].riskWeight).toBeLessThanOrEqual(1.4);
    }
  });

  it("prices the fast repeater above the harder one-shot", () => {
    // Repeat rate is the axis the old catalogue was blind to. The junk drift
    // reports 5 every 1200ms and the ice dispenser 19 exactly once; a quarter
    // of the impulse has to win, because it lands again.
    expect(WAVE_B_HAZARD.junk_drift.impulse).toBeLessThan(
      WAVE_B_HAZARD.ice_dispenser.impulse,
    );
    expect(TRAP_CATALOG.junk_drift.riskWeight).toBeGreaterThan(
      TRAP_CATALOG.ice_dispenser.riskWeight,
    );
  });
});

describe("wave B schedules keep the counter-play each trap is built on", () => {
  it("fits every wind-up and strike inside the trap's own repeat gate", () => {
    const spans: Record<WaveBTrapType, number> = {
      paparazzi: WAVE_B_SCHEDULE.paparazzi.chargeMs + WAVE_B_SCHEDULE.paparazzi.flashMs,
      bathroom_scales:
        WAVE_B_SCHEDULE.bathroomScales.compressMs + WAVE_B_SCHEDULE.bathroomScales.springMs,
      slow_fuse: WAVE_B_SCHEDULE.slowFuse.fuseMs,
      pile_on: WAVE_B_SCHEDULE.pileOn.wobbleMs + WAVE_B_SCHEDULE.pileOn.topplesMs,
      bin_pedal: WAVE_B_SCHEDULE.binPedal.releaseMs + WAVE_B_SCHEDULE.binPedal.slamMs,
      swing_door:
        WAVE_B_SCHEDULE.swingDoor.openMs +
        WAVE_B_SCHEDULE.swingDoor.hangMs +
        WAVE_B_SCHEDULE.swingDoor.reboundMs,
      ball_machine: WAVE_B_SCHEDULE.ballMachine.aimMs + WAVE_B_SCHEDULE.ballMachine.flightMs,
      cuckoo_clock: WAVE_B_SCHEDULE.cuckooClock.beatMs * WAVE_B_SCHEDULE.cuckooClock.beatsPerStrike,
      fish_bowl: WAVE_B_SCHEDULE.fishBowl.slopMs + WAVE_B_SCHEDULE.fishBowl.settleMs,
      shoe_rack: WAVE_B_SCHEDULE.shoeRack.crossMs + WAVE_B_SCHEDULE.shoeRack.settleMs,
      hot_potato: WAVE_B_SCHEDULE.hotPotato.fuseMs + WAVE_B_SCHEDULE.hotPotato.blastMs,
      stove_ring: WAVE_B_SCHEDULE.stoveRing.chargeMs + WAVE_B_SCHEDULE.stoveRing.flareMs,
      clothes_airer: WAVE_B_SCHEDULE.clothesAirer.leanMs + WAVE_B_SCHEDULE.clothesAirer.foldMs,
      ice_dispenser: WAVE_B_SCHEDULE.iceDispenser.spinUpMs + WAVE_B_SCHEDULE.iceDispenser.volleyMs,
      kettle_boil: WAVE_B_SCHEDULE.kettleBoil.scaldMs,
      junk_drift: WAVE_B_SCHEDULE.junkDrift.chargeMs + WAVE_B_SCHEDULE.junkDrift.lungeMs,
    };
    for (const type of WAVE_B_TRAP_TYPES) {
      const gate = WAVE_B_HAZARD[type].gateMs;
      if (gate === null) continue;
      expect(
        spans[type],
        `${type} spends ${spans[type]}ms on a cycle it may only repeat every ${gate}ms`,
      ).toBeLessThanOrEqual(gate);
    }
  });

  it("gives the cuckoo a rhythm rather than a coin flip", () => {
    // Two harmless chimes and a third that strikes is the whole trap: shorten
    // the count and it becomes an ordinary timing gate, and the clock's repeat
    // gate has to be exactly the three beats it takes to come round again or
    // the price would be derived from the wrong cycle.
    const { beatMs, beatsPerStrike, lungeMs } = WAVE_B_SCHEDULE.cuckooClock;
    expect(beatsPerStrike).toBeGreaterThanOrEqual(3);
    expect(beatMs * beatsPerStrike).toBe(WAVE_B_HAZARD.cuckoo_clock.gateMs);
    // The lunge has to be visible before it lands and finished before the next
    // chime starts.
    expect(lungeMs).toBeGreaterThanOrEqual(200);
    expect(lungeMs).toBeLessThan(beatMs);
  });

  it("makes the ball machine lead by more than the ball's flight", () => {
    // Leading by less than the flight time is aiming at where the runner is,
    // which is the paint bucket's verb rather than this one's.
    expect(WAVE_B_SCHEDULE.ballMachine.leadMs).toBeGreaterThan(
      WAVE_B_SCHEDULE.ballMachine.flightMs,
    );
  });

  it("gives the scales a compression a runner can sprint out of", () => {
    // Fired by the landing, so the escape is being off the pad before the
    // spring. Below about a tenth of a second there is nothing to do.
    expect(WAVE_B_SCHEDULE.bathroomScales.compressMs).toBeGreaterThanOrEqual(150);
    // And the threshold has to sit between the two descents the course
    // actually produces. A runner who jumps comes back down at about
    // PLAYER.jumpVelocity, so the pad has to read under that or a jump would
    // never arm it. Stepping off one of the classic course's 0.3u ledges is
    // sqrt(2 * 9.81 * PLAYER.gravityScale * 0.3), about 3.6 m/s, so it has to
    // read over that or walking the course would arm it everywhere.
    const impact = TRAP_CATALOG.bathroom_scales.defaultParams["impact"] as number;
    const stepDown = Math.sqrt(2 * 9.81 * PLAYER.gravityScale * 0.3);
    expect(impact).toBeGreaterThan(stepDown);
    expect(impact).toBeLessThan(PLAYER.jumpVelocity);
  });

  it("gives the bin lid a release window and a wider swipe than its pedal", () => {
    // Standing on the pedal is the safe state, so the lid has to reach further
    // than the plate or stepping off would always be free.
    expect(WAVE_B_SCHEDULE.binPedal.releaseMs).toBeGreaterThanOrEqual(150);
    const pedal = TRAP_CATALOG.bin_pedal.defaultParams["pedal"] as number;
    const swipe = TRAP_CATALOG.bin_pedal.defaultParams["swipe"] as number;
    expect(swipe).toBeGreaterThan(pedal);
  });

  it("makes the pedal bin eject visible trash that leaves a slippery field", () => {
    const bin = sections().get("BinPedalTrap");
    expect(bin).toBeDefined();
    expect(bin).toContain("PEDAL_TRASH_FLIGHT_MS");
    expect(bin).toContain("PEDAL_TRASH_LIFE_MS");
    expect(bin).toContain("PEDAL_TRASH_SLIP_MS");
    expect(bin).toContain("soapUntilRef.current");
    expect(bin).toContain('"trash_ejected"');
    expect(bin).toContain('"trash_slipped"');
    expect(bin).toContain("<BinTrash");
  });

  it("leaves the shoe rack's shove enough time to be answered", () => {
    // The opening shove is only fair if there is a readable gap before the
    // topple lands on the patch it puts the runner on.
    const { jabMs, crossMs } = WAVE_B_SCHEDULE.shoeRack;
    expect(crossMs - jabMs).toBeGreaterThanOrEqual(400);
    // And the patch has to sit outside the rack's own footprint, or the setup
    // and the payoff would be the same piece of ground.
    const offset = TRAP_CATALOG.shoe_rack.defaultParams["offset"] as number;
    const crush = TRAP_CATALOG.shoe_rack.defaultParams["crush"] as number;
    const reach = TRAP_CATALOG.shoe_rack.defaultParams["reach"] as number;
    expect(offset).toBeGreaterThan(0);
    expect(offset + crush).toBeLessThanOrEqual(reach + crush);
  });

  it("tips the bowl on a real change of pace rather than on running", () => {
    // A steady run holds its speed, so the threshold has to sit well under what
    // the controller can produce on purpose and well over nothing.
    const jolt = TRAP_CATALOG.fish_bowl.defaultParams["jolt"] as number;
    expect(jolt).toBeGreaterThan(PLAYER.acceleration * 0.3);
    expect(jolt).toBeLessThan(PLAYER.acceleration);
    expect(WAVE_B_SCHEDULE.fishBowl.slopMs).toBeGreaterThanOrEqual(200);
  });

  it("collects the fuse far enough from where it was lit", () => {
    // The trap only exists because the cost lands somewhere else. At the run
    // speed the player controller allows, this is several metres of course.
    const carried = (WAVE_B_SCHEDULE.slowFuse.fuseMs / 1000) * PLAYER.moveSpeed;
    expect(carried).toBeGreaterThan(6);
    expect(WAVE_B_SCHEDULE.slowFuse.fuseMs).toBeLessThan(WAVE_B_HAZARD.slow_fuse.gateMs);
  });

  it("holds the swing door open long enough to walk through", () => {
    expect(WAVE_B_SCHEDULE.swingDoor.hangMs).toBeGreaterThanOrEqual(300);
  });

  it("gives the ice dispenser a window a bait run can use", () => {
    // Spinning up in front of the runner is the only thing that makes a
    // deliberate trigger from the far edge of the lane worth doing.
    expect(WAVE_B_SCHEDULE.iceDispenser.spinUpMs).toBeGreaterThanOrEqual(400);
    expect(WAVE_B_HAZARD.ice_dispenser.gateMs).toBeNull();
  });

  it("spends exactly the potato's repeat gate between two blasts", () => {
    // The component cools for gate minus fuse and then starts counting again,
    // so the shortest interval between two reports is the gate the price came
    // from. A cool shorter than that would make the trap cheaper than it is.
    const cool = WAVE_B_HAZARD.hot_potato.gateMs - WAVE_B_SCHEDULE.hotPotato.fuseMs;
    expect(cool).toBeGreaterThan(1500);
    expect(cool + WAVE_B_SCHEDULE.hotPotato.fuseMs).toBe(WAVE_B_HAZARD.hot_potato.gateMs);
  });

  it("leaves a runner room to stand in the middle of the hob", () => {
    // The trap's whole point is that the unmarked middle is safe. If the eye
    // were narrower than the runner, standing in it would not be possible and
    // the inversion would be a lie.
    const eye = TRAP_CATALOG.stove_ring.defaultParams["eye"];
    const flare = TRAP_CATALOG.stove_ring.defaultParams["flare"];
    expect(typeof eye).toBe("number");
    expect(typeof flare).toBe("number");
    expect(eye as number).toBeGreaterThan(PLAYER.capsuleRadius);
    expect(flare as number).toBeGreaterThan((eye as number) + 0.3);
  });

  it("catches a dodge with the airer and lets a straight run through", () => {
    // Below a full sidestep so a real dodge trips it, well above the drift a
    // runner holding forward produces, and under the walk speed so it can never
    // be triggered by running straight down the lane.
    const sidestep = TRAP_CATALOG.clothes_airer.defaultParams["sidestep"];
    expect(typeof sidestep).toBe("number");
    expect(sidestep as number).toBeGreaterThan(1.5);
    expect(sidestep as number).toBeLessThan(PLAYER.moveSpeed);
  });

  it("brings the kettle to the boil well inside a single attempt", () => {
    // A boil longer than the attempt limit would be a trap that never fires,
    // and one close to it would only ever catch a run that was already lost.
    expect(WAVE_B_SCHEDULE.kettleBoil.boilMs).toBeLessThan(ATTEMPT_LIMIT_MS / 2);
    expect(WAVE_B_SCHEDULE.kettleBoil.boilMs).toBeGreaterThan(WAVE_B_HAZARD.kettle_boil.gateMs);
  });

  it("makes Junk Drift swell from clutter and visibly lunge at the runner", () => {
    const junk = sections().get("JunkDriftTrap");
    expect(junk).toBeDefined();
    expect(TRAP_CATALOG.junk_drift.defaultParams["feed"]).toBeGreaterThanOrEqual(5);
    expect(junk).toContain("DUST_SHOVE");
    expect(junk).toContain("DUST_LIFT");
    expect(junk).toContain("fluff.current.position.z = lunging");
    expect(junk).toContain("rummage");
    expect(junk).toContain('"dust_caught"');
  });
});

describe("wave B traps telegraph what they are about to do", () => {
  it("gives every trap a component", () => {
    const found = sections();
    expect(found.size).toBe(WAVE_B_TRAP_TYPES.length);
    for (const type of WAVE_B_TRAP_TYPES)
      expect(found.has(COMPONENTS[type]), `${type} has no component`).toBe(true);
  });

  it("draws a ground marker in the reserved danger colour for each of them", () => {
    // An audit found the three highest-risk traps in an earlier wave drew
    // nothing on the floor. PALETTE.danger is reserved for hazard reach and
    // used for nothing else, so a component without it is a trap the player
    // cannot see coming.
    for (const [name, section] of sections())
      expect(section, `${name} draws no PALETTE.danger marker`).toContain("PALETTE.danger");
  });

  it("reads its impulse and its repeat gate out of the hazard table", () => {
    // A literal impulse in a component is how the catalogue price and the trap
    // drift apart, which is the failure the table exists to prevent.
    const found = sections();
    for (const type of WAVE_B_TRAP_TYPES) {
      const section = found.get(COMPONENTS[type]);
      expect(section, `${COMPONENTS[type]} missing`).toBeDefined();
      expect(section!, `${type} does not read the hazard table`).toContain(
        `WAVE_B_HAZARD.${type}`,
      );
      expect(section!, `${type} does not report the table's impulse`).toContain(".impulse");
      // Two traps do not read gateMs and say why. The dispenser has no gate: it
      // fires once. The clock's cycle is its three beats, and the test above
      // pins that product to the gate the price was derived from.
      if (type === "ice_dispenser" || type === "cuckoo_clock") continue;
      expect(section!, `${type} does not cycle on the table's gate`).toContain(".gateMs");
    }
  });

  it("gives every trap a prop no other trap in the wave mounts", () => {
    // These sixteen used to borrow one of seven sculpted meshes through
    // AssetModel, so the fish bowl arrived on the course as a beach ball. Each
    // now mounts a component of its own out of traps/TrapProps.tsx, and no two
    // share one, which is the property that makes them tellable apart.
    expect(source, "a borrowed prop is back in this file").not.toContain("<AssetModel");
    expect(source, "a placeholder prop is back in this file").not.toContain("PLACEHOLDER");
    const props = new Set(
      [
        ...readFileSync(
          new URL("../../components/game/traps/TrapProps.tsx", import.meta.url),
          "utf8",
        ).matchAll(/export function (\w+)\(/g),
      ].map((match) => match[1]!),
    );
    const mountedBy = new Map<string, string[]>();
    for (const [name, section] of sections()) {
      const mounted = [...section.matchAll(/<([A-Z]\w+)[\s/>]/g)]
        .map((match) => match[1]!)
        .filter((component) => props.has(component));
      expect(mounted.length, `${name} mounts no prop of its own`).toBeGreaterThan(0);
      for (const prop of new Set(mounted))
        mountedBy.set(prop, [...(mountedBy.get(prop) ?? []), name]);
    }
    for (const [prop, traps] of mountedBy)
      expect(traps, `${prop} is shared by ${traps.join(" and ")}`).toHaveLength(1);
    expect(mountedBy.size).toBeGreaterThanOrEqual(WAVE_B_TRAP_TYPES.length);
  });

  it("still authors only telegraphs here, never a prop", () => {
    // The props live in traps/TrapProps.tsx and are lit. What this file draws
    // is reach and wind-up, in meshBasicMaterial: a lit material appearing here
    // would mean a prop had been built in the file that is not allowed to.
    expect(source).not.toContain("meshStandardMaterial");
    expect(source).not.toContain("meshPhysicalMaterial");
  });

  it("sizes each marker from the same constant its hit test uses", () => {
    // The four traps whose tested region is not a plain radius, so the marker
    // could most easily drift from the physics without anyone noticing.
    expect(source, "the hob ring must be drawn as the annulus it tests").toContain(
      "<ringGeometry args={[eye, flare, 48]} />",
    );
    expect(source, "the airer strip must be its tested length and half-width").toContain(
      "<planeGeometry args={[AIRER_CATCH_HALF * 2, length]} />",
    );
    expect(source, "the ice lane must be its tested width and range").toContain(
      "<planeGeometry args={[ICE_LANE_HALF * 2, range]} />",
    );
    expect(source, "the door band must be its tested span and depth").toContain(
      "<planeGeometry args={[span, DOOR_BAND_HALF * 2]} />",
    );
  });

  it("re-arms every trap when the attempt restarts", () => {
    // Each component latches phase in a ref. Without a reset keyed on
    // startedAt, a retry on the same mount inherits the last run's state, and
    // one-shots such as the ice dispenser would stay spent forever.
    for (const [name, section] of sections())
      expect(section, `${name} does not reset on a retry`).toContain("}, [startedAt");
  });
});
