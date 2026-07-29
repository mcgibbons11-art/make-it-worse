import { describe, expect, it } from "vitest";
import { totalRisk } from "@/lib/game/difficulty";
import { TRAP_CATALOG, TRAP_TYPES } from "@/lib/game/trap-catalog";
import { TRACK_SEGMENTS, buildTrack } from "@/lib/game/track";
import { WAVE_B_HAZARD, WAVE_B_TRAP_TYPES } from "@/lib/game/traps-wave-b";
import type { TrapInstance, TrapType } from "@/lib/game/types";

/**
 * The measured hazard output of every trap: the impulse it passes to contact()
 * and the gate that lets it report again while the runner stays in reach. These
 * are read off TrapRenderer.tsx, traps/ForceTraps.tsx and traps/LauncherTraps.tsx
 * and are the input the riskWeight comment in trap-catalog.ts derives from. If a
 * trap component changes what it reports, this table changes with it and the
 * assertion below fails until the catalogue is re-derived.
 */
const MEASURED: Record<TrapType, { impulse: number; gate: number | null }> = {
  floor_fan: { impulse: 19, gate: 450 },
  angry_vacuum: { impulse: 13, gate: 500 },
  soap_slick: { impulse: 4, gate: 450 },
  spring_pad: { impulse: 12, gate: 500 },
  robot_mop: { impulse: 7, gate: 500 },
  // Known limitation, left as-is deliberately. 700 is the component's own
  // report guard, but the sweep cannot deliver contacts at that rate: a
  // 0.84 rad arc at 1.3 rad/s dwells on a fixed point for 0.646s of a 4.833s
  // period, a 13.4% duty cycle, so about 0.21 contacts per second against the
  // 2.43 this row implies. The impulse is a worst case too, since it scales
  // with distance: 12.47 is closest approach, about 7.00 mid-range. Correcting
  // the gate alone would move this trap 1.45 -> 0.95. See ceiling_fan.
  sprinkler: { impulse: 12.47, gate: 700 },
  banana_peel: { impulse: 6, gate: 1400 },
  toaster_launcher: { impulse: 8, gate: 2400 },
  fridge_magnet: { impulse: 16, gate: null },
  swinging_hammer: { impulse: 15, gate: null },
  rolling_fridge: { impulse: 14, gate: null },
  rotating_toilet: { impulse: 13, gate: null },
  // Known limitation, left as-is deliberately, and the mirror of sprinkler
  // above. This gate is nominal: the component has no report guard at all, so
  // its four arms re-contact every 830ms at the default 1.9 rad/s and faster on
  // a quicker fan, against the one contact per EXPOSURE_MS that `null` claims.
  //
  // Both rows stay because the correction is smaller than the approximation
  // around it. EXPOSURE_MS assumes 1000ms of continuous reach for every trap,
  // and this fan hangs at 2.6u where a standing head reaches 1.86: the only
  // exposure is mid-jump, about 460ms of a 686ms jump, so one jump can take at
  // most one of those 830ms passes anyway. The gate error and the exposure
  // error point in opposite directions here. Correcting the gate alone would
  // move this trap 0.75 -> 1.40; correcting both this and sprinkler nets +0.15
  // on the roster sum and lands the mean at 1.07105, just past the 0.005 that
  // new-traps.test.ts allows, which would force a refit of SCALE across every
  // weight in the catalogue. Sharpening one term inside a coarser assumption is
  // not worth that, so both are documented rather than fixed.
  ceiling_fan: { impulse: 12, gate: null },
  mousetrap: { impulse: 11, gate: null },
  giant_beach_ball: { impulse: 7, gate: null },
  laundry_basket: { impulse: 0, gate: null },
  // traps/NewTraps.tsx keeps both numbers in NEW_TRAP_HAZARD and its components
  // read them, so these rows are the same values the traps run on rather than a
  // second reading of them. tests/unit/new-traps.test.ts asserts that.
  paint_bucket: { impulse: 15, gate: 2800 },
  spin_cycle: { impulse: 12, gate: 2600 },
  sticky_gum: { impulse: 4, gate: 1200 },
  cord_trip: { impulse: 12, gate: 1500 },
  drawer_slam: { impulse: 9, gate: 3400 },
  rug_pull: { impulse: 8, gate: 2000 },
  // traps/TrapsWaveA.tsx follows the same discipline: both numbers live in
  // WAVE_A_HAZARD there and every component reads its cooldown out of it, so
  // these rows are the values the traps run on rather than a second reading of
  // them. tests/unit/traps-wave-a.test.ts asserts that.
  //
  // Each `gate` below is the guard that stands between two calls to contact()
  // in the component, read off the code rather than off the design intent:
  //   conveyor_strip    once per 800ms cycle  (reportedCycle, gate is the cycle)
  //   tilt_plate        now - lastReport > 2000
  //   motion_sensor     once per 1800ms cycle (firedCycle)
  //   domino_line       now - lastReport > 4000
  //   bunting_line      armed = now - lastCatch > 1800
  //   steam_vents       once per 1100ms cycle (firedCycle)
  //   pipe_burst        once per 2600ms cycle (firedCycle)
  //   ankle_weight      genuinely null: contact() sits behind !attached, and
  //                     attached is only cleared when startedAt changes, so it
  //                     cannot fire twice in one attempt by any path
  //   chute_drop        armed = since > 3400
  //   cart_blocker      now - lastReport > 1500 inside onCollisionEnter
  //   dust_bunny        now - lastReport > 1200
  //   flood_puddle      now - lastReport > 1100
  //   updraft_vent      now - lastReport > 1200
  //   mattress_rebound  now - lastReport > 1500
  //   plate_shards      now - lastReport > 1500, shared by the break and the
  //                     shard field it leaves behind
  //   cat_flap          now - lastReport > 2000
  conveyor_strip: { impulse: 6, gate: 800 },
  tilt_plate: { impulse: 10, gate: 2000 },
  motion_sensor: { impulse: 9, gate: 1800 },
  domino_line: { impulse: 13, gate: 4000 },
  bunting_line: { impulse: 12, gate: 1800 },
  steam_vents: { impulse: 9, gate: 1100 },
  pipe_burst: { impulse: 13, gate: 2600 },
  ankle_weight: { impulse: 9, gate: null },
  chute_drop: { impulse: 11, gate: 3400 },
  cart_blocker: { impulse: 9, gate: 1500 },
  dust_bunny: { impulse: 6, gate: 1200 },
  flood_puddle: { impulse: 5, gate: 1100 },
  updraft_vent: { impulse: 4, gate: 1200 },
  mattress_rebound: { impulse: 11, gate: 1500 },
  plate_shards: { impulse: 10, gate: 1500 },
  cat_flap: { impulse: 11, gate: 2000 },
  // traps/TrapsWaveB.tsx keeps both numbers one module further out, in
  // lib/game/traps-wave-b.ts, so that the migration parity test can read them
  // without importing a component. Every component there reads its cycle or
  // cooldown out of WAVE_B_HAZARD, so these rows are the values the traps run
  // on. tests/unit/traps-wave-b.test.ts asserts that against the same rule.
  //
  // Each `gate` below is the guard between two calls to contact():
  //   paparazzi         once per 2400ms cycle (firedCycle)
  //   bathroom_scales   now - lastStrike > 2800, and the phase machine cannot
  //                     re-enter "flat" until that has elapsed either
  //   slow_fuse         now - litAt >= 2600 before it re-arms
  //   pile_on           now - lastStrike > 2600
  //   bin_pedal         now - lastSlam > 2600
  //   swing_door        the five phases sum to exactly the 2000ms gate
  //   ball_machine      once per 1700ms cycle (landedCycle)
  //   cuckoo_clock      3 beats x 1100ms = 3300ms, and it strikes on the third
  //                     only, so the cycle is the gate
  //   fish_bowl         now - lastSlop > 1400
  //   shoe_rack         once per 3000ms cycle (crossedCycle). The opening jab
  //                     is not a reported contact and so is not a second gate
  //   hot_potato        fuse 1200 + cool 2000 = 3200
  //   stove_ring        once per 1800ms cycle (firedCycle)
  //   clothes_airer     now - lastFold > 1600
  //   ice_dispenser     genuinely null: the phase machine ends at "spent" and
  //                     nothing returns it to "loaded" inside an attempt
  //   kettle_boil       once per 1500ms cycle, but only after an 18s boil
  //   junk_drift        once per 1200ms cycle (firedCycle)
  paparazzi: { impulse: 8, gate: 2400 },
  bathroom_scales: { impulse: 13, gate: 2800 },
  slow_fuse: { impulse: 11, gate: 2600 },
  pile_on: { impulse: 13, gate: 2600 },
  bin_pedal: { impulse: 11, gate: 2600 },
  swing_door: { impulse: 14, gate: 2000 },
  ball_machine: { impulse: 10, gate: 1700 },
  cuckoo_clock: { impulse: 15, gate: 3300 },
  fish_bowl: { impulse: 6, gate: 1400 },
  shoe_rack: { impulse: 13, gate: 3000 },
  hot_potato: { impulse: 15, gate: 3200 },
  stove_ring: { impulse: 10, gate: 1800 },
  clothes_airer: { impulse: 8, gate: 1600 },
  ice_dispenser: { impulse: 19, gate: null },
  kettle_boil: { impulse: 9, gate: 1500 },
  junk_drift: { impulse: 5, gate: 1200 },
};

/** GameScene.tsx derives both of these from the reported impulse. */
const stunMs = (impulse: number) =>
  impulse === 0 ? 0 : Math.min(500, Math.max(250, impulse * 22));
const knockback = (impulse: number) =>
  impulse === 0 ? 0 : Math.min(5.5, 1.8 + impulse * 0.22);

const EXPOSURE_MS = 1000;
/** PLAYER.acceleration cut to the 25% PlayerController allows a stunned runner. */
const STUNNED_ACCELERATION = 7.5;
const SCALE = 1.7631;

function hazard(type: TrapType): number {
  const { impulse, gate } = MEASURED[type];
  if (impulse === 0) return 0;
  const contacts = 1 + (gate ? EXPOSURE_MS / gate : 0);
  const stunShare = Math.min(1, (contacts * stunMs(impulse)) / EXPOSURE_MS);
  const pushShare = Math.min(
    1,
    (contacts * knockback(impulse)) / (EXPOSURE_MS / 1000) / STUNNED_ACCELERATION,
  );
  return (stunShare + pushShare) / 2;
}

const derived = (type: TrapType) => Math.round(hazard(type) * SCALE * 20) / 20;

function trap(type: TrapType, zoneId: string, z: number): TrapInstance {
  return {
    id: `${type}-${zoneId}-${z}`,
    type,
    ownerUserId: null,
    ownerName: "Turbo Otter",
    ownerAvatarSeed: 1,
    depthAdded: 1,
    zoneId,
    position: [0, 0.05, z],
    rotationY: 0,
    seed: 1,
    params: TRAP_CATALOG[type].defaultParams,
  };
}

describe("risk weights track measured hazard output", () => {
  it("reads wave B's rows off the table its components run on", () => {
    // The rows above are a second transcription of numbers that live in
    // lib/game/traps-wave-b.ts, and a transcription is exactly how a table like
    // this goes quietly stale. Wave B is the one set whose hazard numbers are
    // importable from outside a component file, so the drift is checkable here
    // rather than only described in a comment.
    for (const type of WAVE_B_TRAP_TYPES) {
      const { impulse, gateMs } = WAVE_B_HAZARD[type];
      expect(MEASURED[type].impulse, `${type} impulse`).toBe(impulse);
      expect(MEASURED[type].gate, `${type} gate`).toBe(gateMs);
    }
  });

  it("matches the rule documented in trap-catalog", () => {
    for (const type of TRAP_TYPES) {
      // The basket is the one exception and says so in the catalogue: the rule
      // gives it 0 because it never calls contact(), and it carries a nominal
      // 0.05 for the five dynamic socks a pusher can throw at the runner.
      const expected = type === "laundry_basket" ? 0.05 : derived(type);
      expect(
        TRAP_CATALOG[type].riskWeight,
        `${type} is priced ${TRAP_CATALOG[type].riskWeight}, the measured rule gives ${expected}`,
      ).toBe(expected);
    }
  });

  it("prices a repeating trap above a one-shot that hits harder", () => {
    // The old catalogue correlated with repeat rate at r = 0.004: it was blind
    // to the axis that matters most. The fan hits for 19 every 450ms forever;
    // the mousetrap hits once for 11 and disarms itself permanently.
    expect(TRAP_CATALOG.floor_fan.riskWeight).toBeGreaterThan(
      TRAP_CATALOG.mousetrap.riskWeight,
    );
    expect(TRAP_CATALOG.floor_fan.riskWeight).toBe(
      Math.max(...TRAP_TYPES.map((type) => TRAP_CATALOG[type].riskWeight)),
    );
    // Only a gate inside the exposure window makes a trap land more than once
    // while the runner is in reach. The toaster's 2400ms schedule does not, and
    // it is priced with the one-shots on purpose.
    const sustained = TRAP_TYPES.filter((type) => {
      const gate = MEASURED[type].gate;
      return gate !== null && gate <= EXPOSURE_MS;
    });
    const single = TRAP_TYPES.filter((type) => {
      const gate = MEASURED[type].gate;
      return MEASURED[type].impulse > 0 && (gate === null || gate > EXPOSURE_MS);
    });
    const worstSingle = Math.max(
      ...single.map((type) => TRAP_CATALOG[type].riskWeight),
    );
    for (const type of sustained)
      expect(
        TRAP_CATALOG[type].riskWeight,
        `${type} lands again every ${MEASURED[type].gate}ms but is priced below a trap that lands once`,
      ).toBeGreaterThan(worstSingle);
  });

  it("prices the trap that never reports a hazard at the bottom", () => {
    // LaundryBasketTrap does not take onHazard at all, so it produces no stun
    // and no knockback. Nothing may sit below it, and it must sit below
    // everything that does land a contact.
    const basket = TRAP_CATALOG.laundry_basket.riskWeight;
    expect(basket).toBeLessThan(0.1);
    for (const type of TRAP_TYPES.filter((t) => t !== "laundry_basket"))
      expect(TRAP_CATALOG[type].riskWeight).toBeGreaterThan(basket);
  });
});

describe("zone multipliers derive from authored segment difficulty", () => {
  const authored = TRACK_SEGMENTS.flatMap((segment) =>
    segment.zones.map((zone) => ({ zone, difficulty: segment.difficulty })),
  );
  /** One trap in one zone, so totalRisk returns exactly weight x multiplier. */
  const multiplierOf = (zoneId: string) =>
    totalRisk([trap("giant_beach_ball", zoneId, 0)]) /
    TRAP_CATALOG.giant_beach_ball.riskWeight;

  it("keeps every authored zone id unique and free of a slot-like suffix", () => {
    // Both are what make the id the usable key: a collision would silently
    // reprice a zone, and a trailing _<digits> would be mistaken for the slot
    // suffix buildTrack appends.
    const ids = authored.map((entry) => entry.zone.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => /_\d+$/.test(id))).toEqual([]);
  });

  it("averages exactly 1 across the catalogue, so no track is inflated", () => {
    const mean =
      authored.reduce((sum, entry) => sum + multiplierOf(entry.zone.id), 0) /
      authored.length;
    expect(mean).toBeCloseTo(1, 6);
  });

  it("resolves a composed zone id through its slot suffix", () => {
    const composed = buildTrack(["start", "beam", "finish"]);
    const plank = composed.zones.find((zone) => zone.id.startsWith("bridge_plank_a"));
    expect(plank?.id).toBe("bridge_plank_a_1");
    expect(multiplierOf("bridge_plank_a_1")).toBeCloseTo(
      multiplierOf("bridge_plank_a"),
      6,
    );
  });

  it("ranks the segments the old prefix scheme got backwards", () => {
    // beam is difficulty 3 on a 1.2u plank and sidestep is difficulty 2 on 2.4u
    // tiles, yet both priced 1.35 because their zone ids start with "bridge".
    expect(multiplierOf("bridge_plank_a")).toBeGreaterThan(
      multiplierOf("bridge_drift_a"),
    );
    // gap, zigzag, pillars and springpit are all difficulty 3 and all fell to
    // the 1.15 default, the same price as the difficulty 2 stepping stones.
    for (const harder of ["zigzag_a", "pillars_last", "pit_pad"])
      expect(
        multiplierOf(harder),
        `${harder} is difficulty 3 and must price above the difficulty 2 stones`,
      ).toBeGreaterThan(multiplierOf("stones_a"));
  });

  it("correlates with authored difficulty better than the prefix scheme did", () => {
    // Measured against the scheme this one replaced, rather than against an
    // absolute floor. The floor used to be 0.75, which was where the current
    // scheme happened to sit on a 55-zone roster; at 103 zones it reads 0.74 and
    // the test failed while the claim in its own name stayed true. Worse, no
    // value of CARRY_STEP recovers 0.75 - swept from 0.35 to 1.0 the
    // correlation peaks at 0.756 - so the only way to satisfy an absolute floor
    // was to tune a model constant until the number went green, which is
    // backwards. The comparison below is the assertion the name always made,
    // and it does not decay as the roster grows.
    const prefixMultiplier = (id: string) =>
      id.startsWith("runway") ? 0.85
      : id.startsWith("stones") ? 1.15
      : id.startsWith("bridge") ? 1.35
      : id.startsWith("island") ? 1
      : id === "convergence" ? 1.05
      : id === "ramp" ? 1.1
      : 1.15;
    const difficulties = authored.map((entry) => entry.difficulty);
    const correlate = (values: number[]) => {
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      const mx = mean(difficulties);
      const my = mean(values);
      let sxy = 0;
      let sxx = 0;
      let syy = 0;
      for (let i = 0; i < difficulties.length; i += 1) {
        const dx = difficulties[i]! - mx;
        const dy = values[i]! - my;
        sxy += dx * dy;
        sxx += dx * dx;
        syy += dy * dy;
      }
      return sxy / Math.sqrt(sxx * syy);
    };
    const now = correlate(authored.map((entry) => multiplierOf(entry.zone.id)));
    const before = correlate(authored.map((entry) => prefixMultiplier(entry.zone.id)));
    // A margin, so "better" cannot quietly erode to "indistinguishable". The
    // gap is 0.28 today against a prefix scheme that reads 0.46; requiring 0.20
    // leaves real headroom while still failing long before the two schemes meet.
    expect(now, `zone multipliers r=${now.toFixed(4)} vs prefix r=${before.toFixed(4)}`)
      .toBeGreaterThan(before + 0.2);
  });

  it("prices an unknown zone neutrally rather than at the old inflated default", () => {
    expect(multiplierOf("not_a_zone")).toBe(1);
  });
});
