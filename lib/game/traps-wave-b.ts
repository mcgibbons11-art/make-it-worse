/**
 * Wave B: sixteen traps whose components live in
 * components/game/traps/TrapsWaveB.tsx.
 *
 * The sixteen catalogue entries these describe are in TRAP_CATALOG, alongside
 * the other thirty-eight, and are not restated here. This module carries only
 * the two things a placement must never be able to move - the impulse and the
 * repeat gate - plus the phase timings that carry a counter-play.
 *
 * WHY THE NUMBERS LIVE HERE AND NOT IN THE COMPONENTS. The riskWeight rule
 * documented at the top of lib/game/trap-catalog.ts takes exactly two inputs
 * per trap: the impulse it passes to contact(), and the shortest interval at
 * which it can report again while the runner stays in reach. Both are in
 * WAVE_B_HAZARD below, and every component reads its cycle length and its
 * cooldown out of that table rather than carrying its own literal, so a trap
 * cannot change what it does to a runner without the catalogue price moving
 * with it. tests/unit/traps-wave-b.test.ts re-runs the rule against this table
 * and fails if a weight below drifts from it.
 *
 * WHAT THE RULE DOES NOT SEE, for the three traps here where it matters:
 *   - pile_on only lands on a runner who is already inside somebody else's
 *     stun, and bathroom_scales only on a runner who arrives falling. The rule
 *     prices both as though every pass were a hit, so both are held to a modest
 *     impulse to keep the overcharge small.
 *   - junk_drift grows its footprint rather than its impulse. Hazard footprint
 *     is not modelled at all (the known limitation at the foot of the
 *     trap-catalog comment), so that growth is free in the price. It is bounded
 *     in the component for that reason.
 *
 * The shoe rack's opening shove is deliberately not a reported contact. It
 * moves the runner and does no stun, so counting it would price the trap as a
 * two-contact repeater it is not; the topple that follows is the only thing
 * that reports.
 */
export const WAVE_B_TRAP_TYPES = [
  "paparazzi",
  "bathroom_scales",
  "slow_fuse",
  "pile_on",
  "bin_pedal",
  "swing_door",
  "ball_machine",
  "cuckoo_clock",
  "fish_bowl",
  "shoe_rack",
  "hot_potato",
  "stove_ring",
  "clothes_airer",
  "ice_dispenser",
  "kettle_boil",
  "junk_drift",
] as const;

export type WaveBTrapType = (typeof WAVE_B_TRAP_TYPES)[number];

/**
 * Measured hazard output. `gateMs` is null for a trap that reports once and
 * then stops, which is how the rule reads a one-shot.
 */
export const WAVE_B_HAZARD = {
  paparazzi: { impulse: 8, gateMs: 2400 },
  bathroom_scales: { impulse: 13, gateMs: 2800 },
  slow_fuse: { impulse: 11, gateMs: 2600 },
  pile_on: { impulse: 13, gateMs: 2600 },
  bin_pedal: { impulse: 11, gateMs: 2600 },
  swing_door: { impulse: 14, gateMs: 2000 },
  ball_machine: { impulse: 10, gateMs: 1700 },
  cuckoo_clock: { impulse: 15, gateMs: 3300 },
  fish_bowl: { impulse: 6, gateMs: 1400 },
  shoe_rack: { impulse: 13, gateMs: 3000 },
  hot_potato: { impulse: 15, gateMs: 3200 },
  stove_ring: { impulse: 10, gateMs: 1800 },
  clothes_airer: { impulse: 8, gateMs: 1600 },
  // Dumps its whole magazine at the first runner to cross the lane and is
  // furniture afterwards, the way the mousetrap disarms itself permanently.
  ice_dispenser: { impulse: 19, gateMs: null },
  kettle_boil: { impulse: 9, gateMs: 1500 },
  junk_drift: { impulse: 5, gateMs: 1200 },
} as const satisfies Record<WaveBTrapType, { impulse: number; gateMs: number | null }>;

/**
 * Phase timings that carry a design guarantee rather than a look, so a change
 * to one has to fail a test rather than quietly remove the counter-play. Each
 * block sums to, or fits inside, its trap's repeat gate above.
 */
export const WAVE_B_SCHEDULE = {
  /** Whine, then the flash. The whine is the only warning to look away from. */
  paparazzi: { chargeMs: 1500, flashMs: 320 },
  /** Compresses under a hard landing, then springs. Sprinting off clears it. */
  bathroomScales: { compressMs: 180, springMs: 200 },
  /** Lit on contact, paid this long later, wherever the runner has got to. */
  slowFuse: { fuseMs: 1600 },
  /** The wobble is the window an already-stunned runner has to clear it. */
  pileOn: { wobbleMs: 260, topplesMs: 220 },
  /** The lid is held open while the pedal is down and slams once it comes up. */
  binPedal: { releaseMs: 200, slamMs: 220 },
  /** Opens away from the runner, hangs, then comes back at their back. */
  swingDoor: { openMs: 240, hangMs: 420, reboundMs: 180 },
  /** Tracks, commits to a led point, then the ball takes flightMs to get there. */
  ballMachine: { aimMs: 900, flightMs: 220, leadMs: 420 },
  /** Three beats to a cycle and it only strikes on the third. */
  cuckooClock: { beatMs: 1100, beatsPerStrike: 3, lungeMs: 260 },
  /** Slops this long after the runner changes speed, which is the window out. */
  fishBowl: { slopMs: 240, settleMs: 320 },
  /** A shove that does no damage, then the topple onto where it put them. */
  shoeRack: { jabMs: 500, crossMs: 1100, settleMs: 260 },
  /** Starts when something moves the potato, not when it is looked at. */
  hotPotato: { fuseMs: 1200, blastMs: 240 },
  /** The ring builds, then flares. Standing in the eye is safe throughout. */
  stoveRing: { chargeMs: 1000, flareMs: 260 },
  /** Leans toward the drifting runner, then folds. */
  clothesAirer: { leanMs: 300, foldMs: 200, stumbleMs: 500 },
  /** Clatters before it dumps, which is the window a bait run needs. */
  iceDispenser: { spinUpMs: 520, volleyMs: 420 },
  /** Scenery for this long into the attempt, then it scalds every gate. */
  kettleBoil: { boilMs: 18_000, scaldMs: 320 },
  /** Swells on what is around it, then lunges. */
  junkDrift: { chargeMs: 700, lungeMs: 240 },
} as const;

