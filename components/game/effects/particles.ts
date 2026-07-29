/**
 * Pooled particle and shockwave state for the effects layer.
 *
 * Deliberately free of three.js and React: every buffer here is a plain
 * Float32Array that a <points> binds to once, so the simulation runs in node
 * and can be tested without a renderer. `EffectsLayer` owns the pools, calls
 * `updateParticles` once per frame, and uploads the attribute arrays.
 *
 * Nothing in this file touches physics. Particles are drawn, never simulated
 * against colliders, and no emission can change a run's outcome.
 */
import { PALETTE } from "@/lib/game/constants";
import type { QualityMode } from "@/stores/settings-store";

export type Rgb = readonly [number, number, number];
/** A world-space triple. Same shape as Rgb, different meaning. */
export type Vec3 = readonly [number, number, number];

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

/**
 * Values are plain sRGB in 0..1. The particle material writes them straight to
 * gl_FragColor with no colour-management or tone-mapping include, so what is
 * computed here is what reaches the screen, and the contrast figures below
 * describe the real pixels rather than a linear-light intermediate.
 */
export function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function relativeLuminance(rgb: Rgb): number {
  const channel = (value: number) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** The sky sphere's lower stop, the palest thing a particle is ever drawn on. */
export const SKY_BACKDROP = hexToRgb("#c7ebff");
/** Deck tops are washed 62% toward cream, so cream is the palest floor. */
export const DECK_BACKDROP = hexToRgb(PALETTE.cream);
/**
 * 2.5 rather than a flat WCAG number. The scene renders through ACES tone
 * mapping at exposure 1.08 and the particle material does not, so the backdrop
 * on screen is roughly 10-15% darker in luminance than the nominal hex used
 * here while the particle is not. The extra margin covers that gap.
 */
export const MIN_PARTICLE_CONTRAST = 2.5;

const INK = hexToRgb(PALETTE.ink);

/**
 * The palette was chosen against decks and props, not against a near-white sky,
 * and its brightest hues wash out there: raw #ffd84d manages 1.1:1 on the sky's
 * lower stop, which is the same failure the magnet's additive rings hit. Mixing
 * the hue toward ink by the smallest amount that clears MIN_PARTICLE_CONTRAST
 * keeps the hue recognisable and buys back the legibility.
 */
export function deepenForBackdrop(hex: string): Rgb {
  const base = hexToRgb(hex);
  for (let step = 0; step <= 40; step += 1) {
    const candidate = mixRgb(base, INK, step * 0.02);
    if (
      contrastRatio(candidate, SKY_BACKDROP) >= MIN_PARTICLE_CONTRAST &&
      contrastRatio(candidate, DECK_BACKDROP) >= MIN_PARTICLE_CONTRAST
    ) {
      return candidate;
    }
  }
  return mixRgb(base, INK, 0.8);
}

/**
 * PALETTE.danger is reserved for ground that can hurt you and is absent here on
 * purpose. The impact ramp runs through the palette's own yellow, orange and
 * red so a hit's severity reads as heat.
 */
export const EFFECT_COLORS = {
  impactLow: deepenForBackdrop(PALETTE.yellow),
  impactMid: deepenForBackdrop(PALETTE.orange),
  impactHigh: deepenForBackdrop(PALETTE.red),
  dust: deepenForBackdrop(PALETTE.muted),
  speed: deepenForBackdrop(PALETTE.purple),
  water: deepenForBackdrop(PALETTE.blue),
  celebration: deepenForBackdrop(PALETTE.green),
  confetti: [
    deepenForBackdrop(PALETTE.yellow),
    deepenForBackdrop(PALETTE.green),
    deepenForBackdrop(PALETTE.purple),
    deepenForBackdrop(PALETTE.blue),
    deepenForBackdrop(PALETTE.orange),
    deepenForBackdrop(PALETTE.red),
  ] as readonly Rgb[],
} as const;

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

/**
 * Hard ceiling on live particles. Buffers are allocated at this size once and
 * never grow; the settings below only lower how much of them is used.
 */
export const PARTICLE_CAPACITY = 640;
export const RING_CAPACITY = 12;
/**
 * Share of the budget the continuous emitters (speed trail, vacuum lint,
 * sprinkler mist) may occupy. Above it they stop, so a hazard burst or the
 * finish confetti always has room and can never be swallowed by ambience.
 */
export const STREAM_SHARE = 0.5;

export interface EffectBudget {
  /** Live particle ceiling for the current settings. */
  particles: number;
  /** Multiplier on every emission count. */
  countScale: number;
  /** Multiplier on every emission speed. */
  speedScale: number;
  /** Expanding shockwave rings, the largest and fastest motion here. */
  rings: boolean;
  /** Continuous emitters that keep something moving on screen at all times. */
  streams: boolean;
}

/**
 * Reduced motion is a vestibular setting, so what goes first is the large,
 * fast, continuous motion: shockwaves and the three streams. Impact and
 * landing bursts survive at a third of the count and about a third of the
 * speed, because their size and colour are how severity reads, and dropping
 * them entirely would cost information rather than motion.
 */
export function effectBudget(reducedMotion: boolean, quality: QualityMode): EffectBudget {
  if (reducedMotion) {
    return { particles: 160, countScale: 0.3, speedScale: 0.35, rings: false, streams: false };
  }
  if (quality === "low") {
    return { particles: 320, countScale: 0.6, speedScale: 1, rings: true, streams: true };
  }
  return { particles: PARTICLE_CAPACITY, countScale: 1, speedScale: 1, rings: true, streams: true };
}

// ---------------------------------------------------------------------------
// Particle pool
// ---------------------------------------------------------------------------

export interface ParticlePool {
  readonly capacity: number;
  /** Live particles, always packed into indices 0..count-1. */
  count: number;
  // Uploaded to the GPU every frame.
  readonly position: Float32Array;
  readonly color: Float32Array;
  readonly size: Float32Array;
  readonly alpha: Float32Array;
  readonly spin: Float32Array;
  readonly shape: Float32Array;
  // Simulation only.
  readonly velocity: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly baseSize: Float32Array;
  readonly baseAlpha: Float32Array;
  readonly gravity: Float32Array;
  readonly drag: Float32Array;
  readonly grow: Float32Array;
  readonly spinRate: Float32Array;
}

export function createParticlePool(capacity: number = PARTICLE_CAPACITY): ParticlePool {
  return {
    capacity,
    count: 0,
    position: new Float32Array(capacity * 3),
    color: new Float32Array(capacity * 3),
    size: new Float32Array(capacity),
    alpha: new Float32Array(capacity),
    spin: new Float32Array(capacity),
    shape: new Float32Array(capacity),
    velocity: new Float32Array(capacity * 3),
    age: new Float32Array(capacity),
    life: new Float32Array(capacity),
    baseSize: new Float32Array(capacity),
    baseAlpha: new Float32Array(capacity),
    gravity: new Float32Array(capacity),
    drag: new Float32Array(capacity),
    grow: new Float32Array(capacity),
    spinRate: new Float32Array(capacity),
  };
}

/** Total bytes held by a pool, so the peak allocation can be measured. */
export function particlePoolBytes(pool: ParticlePool): number {
  return (
    pool.position.byteLength +
    pool.color.byteLength +
    pool.size.byteLength +
    pool.alpha.byteLength +
    pool.spin.byteLength +
    pool.shape.byteLength +
    pool.velocity.byteLength +
    pool.age.byteLength +
    pool.life.byteLength +
    pool.baseSize.byteLength +
    pool.baseAlpha.byteLength +
    pool.gravity.byteLength +
    pool.drag.byteLength +
    pool.grow.byteLength +
    pool.spinRate.byteLength
  );
}

export function clearParticles(pool: ParticlePool): void {
  pool.count = 0;
}

export interface EmitSpec {
  origin: Vec3;
  count: number;
  /** Half-width of the random cube the spawn point is scattered through. */
  jitter: number;
  /** Velocity every particle starts with, before the random scatter. */
  drift: Vec3;
  /** Random scatter speed, applied along a random direction. */
  speed: readonly [number, number];
  /** 0 keeps the scatter spherical, 1 flattens it into the ground plane. */
  flatten: number;
  size: readonly [number, number];
  life: readonly [number, number];
  alpha: number;
  gravity: number;
  /** Velocity lost per second, as a fraction. */
  drag: number;
  /** Size multiplier gained across the particle's life. */
  grow: number;
  /** Radians per second, only visible on chips. */
  spinRate: number;
  /** 0 is a soft round dot, 1 is a tumbling chip. */
  shape: 0 | 1;
  colors: readonly Rgb[];
}

/**
 * Writes up to `spec.count` particles into the pool and returns how many were
 * taken. Emission is clamped by both the pool's allocation and the caller's
 * budget, so a flood degrades into a smaller burst instead of growing.
 */
export function emit(
  pool: ParticlePool,
  spec: EmitSpec,
  random: () => number,
  limit: number,
): number {
  const ceiling = Math.min(pool.capacity, Math.floor(limit));
  const wanted = Math.max(0, Math.min(Math.round(spec.count), ceiling - pool.count));
  for (let n = 0; n < wanted; n += 1) {
    const index = pool.count;
    const angle = random() * Math.PI * 2;
    const height = random() * 2 - 1;
    const ring = Math.sqrt(Math.max(0, 1 - height * height));
    const scatter = spec.speed[0] + (spec.speed[1] - spec.speed[0]) * random();
    pool.position[index * 3] = spec.origin[0] + (random() - 0.5) * 2 * spec.jitter;
    pool.position[index * 3 + 1] = spec.origin[1] + (random() - 0.5) * 2 * spec.jitter;
    pool.position[index * 3 + 2] = spec.origin[2] + (random() - 0.5) * 2 * spec.jitter;
    pool.velocity[index * 3] = spec.drift[0] + Math.cos(angle) * ring * scatter;
    pool.velocity[index * 3 + 1] =
      spec.drift[1] + height * (1 - spec.flatten) * scatter;
    pool.velocity[index * 3 + 2] = spec.drift[2] + Math.sin(angle) * ring * scatter;
    const color = spec.colors[Math.floor(random() * spec.colors.length) % spec.colors.length] ??
      EFFECT_COLORS.dust;
    pool.color[index * 3] = color[0];
    pool.color[index * 3 + 1] = color[1];
    pool.color[index * 3 + 2] = color[2];
    pool.baseSize[index] = spec.size[0] + (spec.size[1] - spec.size[0]) * random();
    pool.size[index] = pool.baseSize[index]!;
    pool.baseAlpha[index] = spec.alpha;
    pool.alpha[index] = spec.alpha;
    pool.age[index] = 0;
    pool.life[index] = spec.life[0] + (spec.life[1] - spec.life[0]) * random();
    pool.gravity[index] = spec.gravity;
    pool.drag[index] = spec.drag;
    pool.grow[index] = spec.grow;
    pool.shape[index] = spec.shape;
    pool.spin[index] = random() * Math.PI * 2;
    pool.spinRate[index] = (random() * 2 - 1) * spec.spinRate;
    pool.count += 1;
  }
  return wanted;
}

function removeParticle(pool: ParticlePool, index: number): void {
  const last = pool.count - 1;
  if (index !== last) {
    for (let axis = 0; axis < 3; axis += 1) {
      pool.position[index * 3 + axis] = pool.position[last * 3 + axis]!;
      pool.velocity[index * 3 + axis] = pool.velocity[last * 3 + axis]!;
      pool.color[index * 3 + axis] = pool.color[last * 3 + axis]!;
    }
    pool.size[index] = pool.size[last]!;
    pool.alpha[index] = pool.alpha[last]!;
    pool.spin[index] = pool.spin[last]!;
    pool.shape[index] = pool.shape[last]!;
    pool.age[index] = pool.age[last]!;
    pool.life[index] = pool.life[last]!;
    pool.baseSize[index] = pool.baseSize[last]!;
    pool.baseAlpha[index] = pool.baseAlpha[last]!;
    pool.gravity[index] = pool.gravity[last]!;
    pool.drag[index] = pool.drag[last]!;
    pool.grow[index] = pool.grow[last]!;
    pool.spinRate[index] = pool.spinRate[last]!;
  }
  pool.count = last;
}

export function updateParticles(pool: ParticlePool, dt: number): void {
  // Backwards, so the live particle swapped into a freed slot has already been
  // stepped this frame and is not stepped twice.
  for (let index = pool.count - 1; index >= 0; index -= 1) {
    const age = pool.age[index]! + dt;
    const life = pool.life[index]!;
    if (age >= life) {
      removeParticle(pool, index);
      continue;
    }
    pool.age[index] = age;
    const progress = age / life;
    const keep = Math.max(0, 1 - pool.drag[index]! * dt);
    const vx = pool.velocity[index * 3]! * keep;
    const vy = pool.velocity[index * 3 + 1]! * keep - pool.gravity[index]! * dt;
    const vz = pool.velocity[index * 3 + 2]! * keep;
    pool.velocity[index * 3] = vx;
    pool.velocity[index * 3 + 1] = vy;
    pool.velocity[index * 3 + 2] = vz;
    pool.position[index * 3] = pool.position[index * 3]! + vx * dt;
    pool.position[index * 3 + 1] = pool.position[index * 3 + 1]! + vy * dt;
    pool.position[index * 3 + 2] = pool.position[index * 3 + 2]! + vz * dt;
    pool.size[index] = pool.baseSize[index]! * (1 + pool.grow[index]! * progress);
    // Full opacity until the last third, then a linear fade. A fade-in would
    // soften exactly the frames an impact needs to land on.
    pool.alpha[index] = pool.baseAlpha[index]! * Math.min(1, 3 * (1 - progress));
    pool.spin[index] = pool.spin[index]! + pool.spinRate[index]! * dt;
  }
}

// ---------------------------------------------------------------------------
// Shockwave rings
// ---------------------------------------------------------------------------

export interface RingPool {
  readonly capacity: number;
  count: number;
  readonly position: Float32Array;
  readonly color: Float32Array;
  readonly radius: Float32Array;
  readonly alpha: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly radiusFrom: Float32Array;
  readonly radiusTo: Float32Array;
  readonly baseAlpha: Float32Array;
}

export function createRingPool(capacity: number = RING_CAPACITY): RingPool {
  return {
    capacity,
    count: 0,
    position: new Float32Array(capacity * 3),
    color: new Float32Array(capacity * 3),
    radius: new Float32Array(capacity),
    alpha: new Float32Array(capacity),
    age: new Float32Array(capacity),
    life: new Float32Array(capacity),
    radiusFrom: new Float32Array(capacity),
    radiusTo: new Float32Array(capacity),
    baseAlpha: new Float32Array(capacity),
  };
}

export function ringPoolBytes(pool: RingPool): number {
  return (
    pool.position.byteLength +
    pool.color.byteLength +
    pool.radius.byteLength +
    pool.alpha.byteLength +
    pool.age.byteLength +
    pool.life.byteLength +
    pool.radiusFrom.byteLength +
    pool.radiusTo.byteLength +
    pool.baseAlpha.byteLength
  );
}

export function clearRings(pool: RingPool): void {
  pool.count = 0;
}

export function emitRing(
  pool: RingPool,
  origin: Vec3,
  color: Rgb,
  radiusFrom: number,
  radiusTo: number,
  life: number,
  alpha: number,
): boolean {
  if (pool.count >= pool.capacity) return false;
  const index = pool.count;
  pool.position[index * 3] = origin[0];
  pool.position[index * 3 + 1] = origin[1];
  pool.position[index * 3 + 2] = origin[2];
  pool.color[index * 3] = color[0];
  pool.color[index * 3 + 1] = color[1];
  pool.color[index * 3 + 2] = color[2];
  pool.radiusFrom[index] = radiusFrom;
  pool.radiusTo[index] = radiusTo;
  pool.radius[index] = radiusFrom;
  pool.baseAlpha[index] = alpha;
  pool.alpha[index] = alpha;
  pool.age[index] = 0;
  pool.life[index] = life;
  pool.count += 1;
  return true;
}

function removeRing(pool: RingPool, index: number): void {
  const last = pool.count - 1;
  if (index !== last) {
    for (let axis = 0; axis < 3; axis += 1) {
      pool.position[index * 3 + axis] = pool.position[last * 3 + axis]!;
      pool.color[index * 3 + axis] = pool.color[last * 3 + axis]!;
    }
    pool.radius[index] = pool.radius[last]!;
    pool.alpha[index] = pool.alpha[last]!;
    pool.age[index] = pool.age[last]!;
    pool.life[index] = pool.life[last]!;
    pool.radiusFrom[index] = pool.radiusFrom[last]!;
    pool.radiusTo[index] = pool.radiusTo[last]!;
    pool.baseAlpha[index] = pool.baseAlpha[last]!;
  }
  pool.count = last;
}

export function updateRings(pool: RingPool, dt: number): void {
  for (let index = pool.count - 1; index >= 0; index -= 1) {
    const age = pool.age[index]! + dt;
    const life = pool.life[index]!;
    if (age >= life) {
      removeRing(pool, index);
      continue;
    }
    pool.age[index] = age;
    const progress = age / life;
    const eased = 1 - (1 - progress) * (1 - progress);
    pool.radius[index] =
      pool.radiusFrom[index]! + (pool.radiusTo[index]! - pool.radiusFrom[index]!) * eased;
    pool.alpha[index] = pool.baseAlpha[index]! * (1 - progress) ** 1.5;
  }
}

// ---------------------------------------------------------------------------
// Readings the effects are meant to convey
// ---------------------------------------------------------------------------

/**
 * Trap impulses run from 4 (soap) to 19 (floor fan at point blank). GameScene
 * saturates its own knockback at an impulse of 16, so the burst is scaled to
 * the same span: what the player sees stops growing exactly where what they
 * feel stops growing.
 */
export function impactSeverity(impulseMagnitude: number): number {
  return Math.min(1, Math.max(0, (impulseMagnitude - 4) / 12));
}

/** Yellow through orange to red: how hard that just hit. */
export function severityColor(severity: number): Rgb {
  return severity < 0.5
    ? mixRgb(EFFECT_COLORS.impactLow, EFFECT_COLORS.impactMid, severity * 2)
    : mixRgb(EFFECT_COLORS.impactMid, EFFECT_COLORS.impactHigh, (severity - 0.5) * 2);
}

/**
 * A 3 m/s touchdown is a step and raises nothing. Terminal velocity for the
 * player is 18 m/s, but a fall from the standard jump lands near 12, which is
 * where the puff reaches full size.
 */
export function landingStrength(fallSpeed: number): number {
  return Math.min(1, Math.max(0, (Math.abs(fallSpeed) - 3) / 9));
}

// ---------------------------------------------------------------------------
// Emitters
// ---------------------------------------------------------------------------

function streamAllowed(pool: ParticlePool, budget: EffectBudget): boolean {
  return budget.streams && pool.count < budget.particles * STREAM_SHARE;
}

/** Debris off the runner, scaled and coloured by how hard the trap hit. */
export function emitImpact(
  pool: ParticlePool,
  budget: EffectBudget,
  random: () => number,
  origin: Vec3,
  impulseMagnitude: number,
): number {
  const severity = impactSeverity(impulseMagnitude);
  const color = severityColor(severity);
  return emit(
    pool,
    {
      origin,
      count: (10 + 22 * severity) * budget.countScale,
      jitter: 0.18,
      drift: [0, 1.1 + severity, 0],
      speed: [1.2, (2.4 + 5.2 * severity) * budget.speedScale],
      flatten: 0.15,
      size: [0.07 + 0.03 * severity, 0.12 + 0.06 * severity],
      life: [0.34, 0.72],
      alpha: 0.95,
      gravity: 7,
      drag: 1.6,
      grow: 0.2,
      spinRate: 0,
      shape: 0,
      colors: [color],
    },
    random,
    budget.particles,
  );
}

/** Dust off the deck, scaled by the speed the runner arrived at. */
export function emitLandingDust(
  pool: ParticlePool,
  budget: EffectBudget,
  random: () => number,
  origin: Vec3,
  fallSpeed: number,
): number {
  const strength = landingStrength(fallSpeed);
  return emit(
    pool,
    {
      origin,
      count: (5 + 13 * strength) * budget.countScale,
      jitter: 0.16,
      drift: [0, 0.5, 0],
      speed: [0.7, (1.1 + 1.9 * strength) * budget.speedScale],
      flatten: 0.82,
      size: [0.09, 0.16],
      life: [0.4, 0.78],
      alpha: 0.45 + 0.3 * strength,
      gravity: 1.2,
      drag: 2.4,
      grow: 1.6,
      spinRate: 0,
      shape: 0,
      colors: [EFFECT_COLORS.dust],
    },
    random,
    budget.particles,
  );
}

/** A trail that only appears at a sprint, so top speed is visible. */
export function emitSpeedTrail(
  pool: ParticlePool,
  budget: EffectBudget,
  random: () => number,
  origin: Vec3,
  headingX: number,
  headingZ: number,
  intensity: number,
): number {
  if (!streamAllowed(pool, budget)) return 0;
  return emit(
    pool,
    {
      origin,
      count: 1,
      jitter: 0.2,
      drift: [-headingX * 1.1, 0.7, -headingZ * 1.1],
      speed: [0, 0.35],
      flatten: 0.5,
      size: [0.05, 0.085],
      life: [0.26, 0.4],
      alpha: 0.35 + 0.35 * intensity,
      gravity: -0.8,
      drag: 1.2,
      grow: 0.7,
      spinRate: 0,
      shape: 0,
      colors: [EFFECT_COLORS.speed],
    },
    random,
    budget.particles,
  );
}

/** The payoff. Every hue in the palette except the reserved one. */
export function emitConfetti(
  pool: ParticlePool,
  budget: EffectBudget,
  random: () => number,
  origin: Vec3,
  share: number,
): number {
  return emit(
    pool,
    {
      origin,
      count: 150 * share * budget.countScale,
      jitter: 0.5,
      drift: [0, 2.4, 0],
      speed: [2.4, 6.4 * budget.speedScale],
      flatten: 0.1,
      size: [0.1, 0.19],
      life: [1.3, 2.4],
      alpha: 1,
      gravity: 6.5,
      drag: 0.7,
      grow: 0,
      spinRate: 9,
      shape: 1,
      colors: EFFECT_COLORS.confetti,
    },
    random,
    budget.particles,
  );
}

/**
 * Lint pulled inward, spawned on a ring around the vacuum's live position.
 * The radius is deliberately inside the trap's real suction radius, so the
 * effect can only ever under-promise the reach it is illustrating.
 */
export function emitSuctionLint(
  pool: ParticlePool,
  budget: EffectBudget,
  random: () => number,
  origin: Vec3,
  radius: number,
): number {
  if (!streamAllowed(pool, budget)) return 0;
  const angle = random() * Math.PI * 2;
  const inX = -Math.cos(angle);
  const inZ = -Math.sin(angle);
  return emit(
    pool,
    {
      origin: [
        origin[0] - inX * radius,
        origin[1] + random() * 0.5,
        origin[2] - inZ * radius,
      ],
      count: 1,
      jitter: 0.08,
      drift: [inX * 1.9 - inZ * 1.1, 0.25, inZ * 1.9 + inX * 1.1],
      speed: [0, 0.3],
      flatten: 0.6,
      size: [0.05, 0.09],
      life: [0.55, 0.8],
      alpha: 0.75,
      gravity: 0.4,
      drag: 0.4,
      grow: 0,
      spinRate: 0,
      shape: 0,
      colors: [EFFECT_COLORS.dust],
    },
    random,
    budget.particles,
  );
}

/**
 * Water thrown along the sprinkler's current heading. Same caution as the
 * lint: the spray is tuned to fall short of the trap's real range rather than
 * claim reach the hazard does not have.
 */
export function emitSprinklerMist(
  pool: ParticlePool,
  budget: EffectBudget,
  random: () => number,
  origin: Vec3,
  heading: number,
): number {
  if (!streamAllowed(pool, budget)) return 0;
  const spread = heading + (random() - 0.5) * 0.44;
  return emit(
    pool,
    {
      origin,
      count: 1,
      jitter: 0.06,
      drift: [Math.sin(spread) * 3.1, 0.9, Math.cos(spread) * 3.1],
      speed: [0, 0.35],
      flatten: 0.4,
      size: [0.045, 0.08],
      life: [0.5, 0.7],
      alpha: 0.8,
      gravity: 4,
      drag: 0.9,
      grow: 0.3,
      spinRate: 0,
      shape: 0,
      colors: [EFFECT_COLORS.water],
    },
    random,
    budget.particles,
  );
}
