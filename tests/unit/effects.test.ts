import { describe, expect, it } from "vitest";
import { PALETTE } from "@/lib/game/constants";
import {
  DECK_BACKDROP,
  EFFECT_COLORS,
  MIN_PARTICLE_CONTRAST,
  PARTICLE_CAPACITY,
  RING_CAPACITY,
  SKY_BACKDROP,
  STREAM_SHARE,
  clearParticles,
  contrastRatio,
  createParticlePool,
  createRingPool,
  deepenForBackdrop,
  effectBudget,
  emitConfetti,
  emitImpact,
  emitLandingDust,
  emitRing,
  emitSpeedTrail,
  emitSprinklerMist,
  emitSuctionLint,
  hexToRgb,
  impactSeverity,
  landingStrength,
  particlePoolBytes,
  ringPoolBytes,
  severityColor,
  updateParticles,
  updateRings,
  type ParticlePool,
  type Rgb,
} from "@/components/game/effects/particles";

/** Deterministic stand-in for Math.random so counts and paths are repeatable. */
function sequence(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const FULL = effectBudget(false, "auto");
const REDUCED = effectBudget(true, "auto");
const LOW = effectBudget(false, "low");

/** Longest life any emitter here hands out, plus a margin. */
const LONGEST_LIFE = 3;

function drain(pool: ParticlePool): void {
  for (let frame = 0; frame < Math.ceil(LONGEST_LIFE / (1 / 60)) + 2; frame += 1) {
    updateParticles(pool, 1 / 60);
  }
}

function allFinite(pool: ParticlePool): boolean {
  const arrays = [pool.position, pool.velocity, pool.color, pool.size, pool.alpha, pool.spin];
  for (const array of arrays) {
    for (let index = 0; index < array.length; index += 1) {
      if (!Number.isFinite(array[index]!)) return false;
    }
  }
  return true;
}

describe("particle pool allocation", () => {
  it("holds one fixed allocation whose size is known", () => {
    const particles = createParticlePool();
    const rings = createRingPool();
    // 21 floats per particle, 13 per ring, all allocated at mount and reused.
    expect(particlePoolBytes(particles)).toBe(PARTICLE_CAPACITY * 21 * 4);
    expect(ringPoolBytes(rings)).toBe(RING_CAPACITY * 13 * 4);
    expect(particlePoolBytes(particles) + ringPoolBytes(rings)).toBe(54_384);
  });

  it("caps live particles at the budget however hard it is driven", () => {
    const pool = createParticlePool();
    const random = sequence(7);
    for (let burst = 0; burst < 400; burst += 1) {
      emitImpact(pool, FULL, random, [0, 1, 0], 19);
      emitConfetti(pool, FULL, random, [0, 1, 0], 1);
      emitLandingDust(pool, FULL, random, [0, 0, 0], 18);
      expect(pool.count).toBeLessThanOrEqual(FULL.particles);
      expect(pool.count).toBeLessThanOrEqual(pool.capacity);
    }
    expect(pool.count).toBe(FULL.particles);
    expect(allFinite(pool)).toBe(true);
  });

  it("honours a lower budget without reallocating", () => {
    const pool = createParticlePool();
    const random = sequence(11);
    for (let burst = 0; burst < 50; burst += 1) {
      emitConfetti(pool, REDUCED, random, [0, 1, 0], 1);
    }
    expect(pool.count).toBeLessThanOrEqual(REDUCED.particles);
    expect(pool.capacity).toBe(PARTICLE_CAPACITY);
    expect(LOW.particles).toBeLessThan(FULL.particles);
  });

  it("returns every particle to the pool once its life runs out", () => {
    const pool = createParticlePool();
    const random = sequence(3);
    emitImpact(pool, FULL, random, [0, 1, 0], 15);
    emitConfetti(pool, FULL, random, [0, 1, 0], 1);
    expect(pool.count).toBeGreaterThan(0);
    drain(pool);
    expect(pool.count).toBe(0);
  });

  it("keeps every survivor when a particle in the middle dies", () => {
    const pool = createParticlePool(8);
    emitLandingDust(pool, FULL, sequence(5), [0, 0, 0], -12);
    const before = pool.count;
    expect(before).toBeGreaterThan(2);
    // Tag each particle with its index and hold it still, so the swap that
    // fills the freed slot can be traced.
    for (let index = 0; index < before; index += 1) {
      pool.position[index * 3] = index;
      pool.velocity[index * 3] = 0;
      pool.velocity[index * 3 + 1] = 0;
      pool.velocity[index * 3 + 2] = 0;
      pool.gravity[index] = 0;
      pool.drag[index] = 0;
    }
    const doomed = 1;
    pool.life[doomed] = 0.001;

    updateParticles(pool, 0.01);

    expect(pool.count).toBe(before - 1);
    const survivors = new Set<number>();
    for (let index = 0; index < pool.count; index += 1) {
      survivors.add(Math.round(pool.position[index * 3]!));
    }
    expect(survivors.size).toBe(before - 1);
    expect(survivors.has(doomed)).toBe(false);
    for (let tag = 0; tag < before; tag += 1) {
      if (tag !== doomed) expect(survivors.has(tag)).toBe(true);
    }
  });

  it("empties on demand, which is how an attempt resets", () => {
    const pool = createParticlePool();
    const random = sequence(59);
    emitConfetti(pool, FULL, random, [0, 1, 0], 1);
    expect(pool.count).toBeGreaterThan(0);
    clearParticles(pool);
    expect(pool.count).toBe(0);
    expect(emitImpact(pool, FULL, random, [0, 1, 0], 15)).toBeGreaterThan(0);
  });
});

describe("stream emitters cannot starve the bursts", () => {
  it("stops the trail at its share and leaves room for an impact", () => {
    const pool = createParticlePool();
    const random = sequence(13);
    for (let tick = 0; tick < 5_000; tick += 1) {
      emitSpeedTrail(pool, FULL, random, [0, 0, 0], 0, 1, 1);
      emitSuctionLint(pool, FULL, random, [4, 0, 4], 2.2);
      emitSprinklerMist(pool, FULL, random, [8, 0.5, 8], 0.4);
    }
    expect(pool.count).toBeLessThanOrEqual(FULL.particles * STREAM_SHARE + 3);
    const burst = emitImpact(pool, FULL, random, [0, 1, 0], 15);
    expect(burst).toBeGreaterThan(0);
  });

  it("switches the streams off entirely for reduced motion", () => {
    const pool = createParticlePool();
    const random = sequence(17);
    expect(emitSpeedTrail(pool, REDUCED, random, [0, 0, 0], 0, 1, 1)).toBe(0);
    expect(emitSuctionLint(pool, REDUCED, random, [0, 0, 0], 2.2)).toBe(0);
    expect(emitSprinklerMist(pool, REDUCED, random, [0, 0, 0], 0)).toBe(0);
    expect(pool.count).toBe(0);
  });
});

describe("reduced motion", () => {
  it("keeps the informative bursts but makes them smaller and slower", () => {
    expect(REDUCED.rings).toBe(false);
    expect(REDUCED.streams).toBe(false);
    expect(REDUCED.countScale).toBeLessThan(FULL.countScale);
    expect(REDUCED.speedScale).toBeLessThan(FULL.speedScale);
    expect(REDUCED.particles).toBeLessThan(FULL.particles);

    const full = createParticlePool();
    const reduced = createParticlePool();
    emitImpact(full, FULL, sequence(23), [0, 1, 0], 15);
    emitImpact(reduced, REDUCED, sequence(23), [0, 1, 0], 15);
    expect(reduced.count).toBeGreaterThan(0);
    expect(reduced.count).toBeLessThan(full.count / 2);

    const fastest = (pool: ParticlePool) => {
      let peak = 0;
      for (let index = 0; index < pool.count; index += 1) {
        peak = Math.max(
          peak,
          Math.hypot(
            pool.velocity[index * 3]!,
            pool.velocity[index * 3 + 1]!,
            pool.velocity[index * 3 + 2]!,
          ),
        );
      }
      return peak;
    };
    expect(fastest(reduced)).toBeLessThan(fastest(full));
  });
});

describe("what the effects tell the player", () => {
  it("scales impact severity across the range of trap impulses", () => {
    expect(impactSeverity(4)).toBe(0);
    expect(impactSeverity(0)).toBe(0);
    expect(impactSeverity(7)).toBeCloseTo(0.25, 5);
    expect(impactSeverity(16)).toBe(1);
    expect(impactSeverity(19)).toBe(1);
    expect(impactSeverity(13)).toBeGreaterThan(impactSeverity(7));
  });

  it("emits a bigger, faster burst for a harder hit", () => {
    const soft = createParticlePool();
    const hard = createParticlePool();
    emitImpact(soft, FULL, sequence(29), [0, 1, 0], 4);
    emitImpact(hard, FULL, sequence(29), [0, 1, 0], 15);
    expect(hard.count).toBeGreaterThan(soft.count * 2);
  });

  it("runs the severity ramp from yellow through orange to red", () => {
    expect(severityColor(0)).toEqual(EFFECT_COLORS.impactLow);
    expect(severityColor(0.5)).toEqual(EFFECT_COLORS.impactMid);
    expect(severityColor(1)).toEqual(EFFECT_COLORS.impactHigh);
    // Redder and darker as it gets worse, which is the read.
    expect(severityColor(1)[1]).toBeLessThan(severityColor(0)[1]);
  });

  it("raises no dust for a step and a full puff for a long fall", () => {
    expect(landingStrength(2)).toBe(0);
    expect(landingStrength(-2)).toBe(0);
    expect(landingStrength(7.5)).toBeCloseTo(0.5, 5);
    expect(landingStrength(-12)).toBe(1);
    expect(landingStrength(-18)).toBe(1);

    const light = createParticlePool();
    const heavy = createParticlePool();
    emitLandingDust(light, FULL, sequence(31), [0, 0, 0], -3.5);
    emitLandingDust(heavy, FULL, sequence(31), [0, 0, 0], -12);
    expect(heavy.count).toBeGreaterThan(light.count);
  });
});

describe("colour against a near-white scene", () => {
  const backdrops: readonly [string, Rgb][] = [
    ["sky lower stop", SKY_BACKDROP],
    ["cream deck", DECK_BACKDROP],
  ];
  const colors: readonly [string, Rgb][] = [
    ["impactLow", EFFECT_COLORS.impactLow],
    ["impactMid", EFFECT_COLORS.impactMid],
    ["impactHigh", EFFECT_COLORS.impactHigh],
    ["dust", EFFECT_COLORS.dust],
    ["speed", EFFECT_COLORS.speed],
    ["water", EFFECT_COLORS.water],
    ["celebration", EFFECT_COLORS.celebration],
    ...EFFECT_COLORS.confetti.map(
      (color, index) => [`confetti ${index}`, color] as [string, Rgb],
    ),
  ];

  it.each(colors)("%s clears the contrast floor on both backdrops", (_name, color) => {
    for (const [, backdrop] of backdrops) {
      expect(contrastRatio(color, backdrop)).toBeGreaterThanOrEqual(MIN_PARTICLE_CONTRAST);
    }
  });

  it("shows why the raw palette needed deepening", () => {
    // The exact failure the brief warns about: bright yellow on the sky's
    // lower stop is invisible, and additive blending there clips to white.
    expect(contrastRatio(hexToRgb(PALETTE.yellow), SKY_BACKDROP)).toBeLessThan(1.3);
    expect(contrastRatio(EFFECT_COLORS.impactLow, SKY_BACKDROP)).toBeGreaterThanOrEqual(
      MIN_PARTICLE_CONTRAST,
    );
  });

  it("leaves a colour alone when it already reads", () => {
    expect(deepenForBackdrop(PALETTE.ink)).toEqual(hexToRgb(PALETTE.ink));
    expect(deepenForBackdrop(PALETTE.muted)).toEqual(hexToRgb(PALETTE.muted));
  });

  it("never spends the reserved danger colour on decoration", () => {
    const danger = hexToRgb(PALETTE.danger);
    for (const [, color] of colors) {
      expect(color).not.toEqual(danger);
      // And is not close enough to be mistaken for a hazard marker.
      const distance = Math.hypot(
        color[0] - danger[0],
        color[1] - danger[1],
        color[2] - danger[2],
      );
      expect(distance).toBeGreaterThan(0.1);
    }
  });
});

describe("shockwave rings", () => {
  it("bounds the ring pool and drains it", () => {
    const rings = createRingPool();
    for (let index = 0; index < 40; index += 1) {
      emitRing(rings, [0, 1, 0], EFFECT_COLORS.impactHigh, 0.35, 2, 0.34, 0.7);
    }
    expect(rings.count).toBe(RING_CAPACITY);
    for (let frame = 0; frame < 40; frame += 1) updateRings(rings, 1 / 60);
    expect(rings.count).toBe(0);
  });

  it("expands and fades over its life", () => {
    const rings = createRingPool();
    emitRing(rings, [0, 1, 0], EFFECT_COLORS.impactHigh, 0.5, 3, 0.5, 0.8);
    let radius = rings.radius[0]!;
    let alpha = rings.alpha[0]!;
    for (let frame = 0; frame < 20; frame += 1) {
      updateRings(rings, 1 / 60);
      if (rings.count === 0) break;
      expect(rings.radius[0]!).toBeGreaterThan(radius);
      expect(rings.alpha[0]!).toBeLessThan(alpha);
      radius = rings.radius[0]!;
      alpha = rings.alpha[0]!;
    }
    expect(radius).toBeLessThanOrEqual(3);
  });
});

describe("simulation", () => {
  it("falls under gravity and loses speed to drag", () => {
    const pool = createParticlePool(4);
    emitConfetti(pool, FULL, sequence(37), [0, 5, 0], 0.02);
    expect(pool.count).toBeGreaterThan(0);
    const startSpeed = Math.hypot(pool.velocity[0]!, pool.velocity[2]!);
    for (let frame = 0; frame < 45; frame += 1) updateParticles(pool, 1 / 60);
    expect(pool.count).toBeGreaterThan(0);
    expect(pool.velocity[1]!).toBeLessThan(0);
    expect(Math.hypot(pool.velocity[0]!, pool.velocity[2]!)).toBeLessThan(startSpeed);
  });

  it("fades to nothing rather than popping out", () => {
    const pool = createParticlePool(4);
    emitLandingDust(pool, FULL, sequence(41), [0, 0, 0], -12);
    let previous = pool.alpha[0]!;
    let faded = false;
    for (let frame = 0; frame < 60 && pool.count > 0; frame += 1) {
      updateParticles(pool, 1 / 60);
      if (pool.count === 0) break;
      if (pool.alpha[0]! < previous) faded = true;
      previous = pool.alpha[0]!;
    }
    expect(faded).toBe(true);
    expect(previous).toBeLessThan(0.5);
  });

  it("survives a long random run without producing a NaN", () => {
    const pool = createParticlePool();
    const rings = createRingPool();
    const random = sequence(43);
    for (let frame = 0; frame < 600; frame += 1) {
      if (frame % 7 === 0) emitImpact(pool, FULL, random, [0, 1, 0], random() * 20);
      if (frame % 11 === 0) emitLandingDust(pool, FULL, random, [0, 0, 0], -random() * 18);
      emitSpeedTrail(pool, FULL, random, [0, 0, 0], 0, 1, random());
      if (frame % 53 === 0) {
        emitRing(rings, [0, 1, 0], severityColor(random()), 0.3, 2, 0.4, 0.7);
      }
      updateParticles(pool, 1 / 60);
      updateRings(rings, 1 / 60);
      expect(pool.count).toBeLessThanOrEqual(pool.capacity);
    }
    expect(allFinite(pool)).toBe(true);
    for (let index = 0; index < rings.count; index += 1) {
      expect(Number.isFinite(rings.radius[index]!)).toBe(true);
    }
  });
});
