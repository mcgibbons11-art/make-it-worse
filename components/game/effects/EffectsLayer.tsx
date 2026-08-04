"use client";
import { useFrame } from "@react-three/fiber";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  RingGeometry,
  SRGBColorSpace,
  ShaderMaterial,
  Vector3,
} from "three";
import type { RapierRigidBody } from "@react-three/rapier";
import { AudioManager } from "@/lib/audio/AudioManager";
import { PALETTE, PLAYER } from "@/lib/game/constants";
import { TRAP_CATALOG } from "@/lib/game/trap-catalog";
import type { TrapInstance } from "@/lib/game/types";
import { useSettingsStore } from "@/stores/settings-store";
import {
  RING_CAPACITY,
  clearParticles,
  clearRings,
  createParticlePool,
  createRingPool,
  effectBudget,
  emitConfetti,
  emitImpact,
  emitLandingDust,
  emitRing,
  emitGrazeSpark,
  emitSpeedTrail,
  emitSprinklerMist,
  emitSuctionLint,
  hexToRgb,
  impactSeverity,
  severityColor,
  updateParticles,
  updateRings,
  EFFECT_COLORS,
  type Vec3,
} from "./particles";

/**
 * The decorative layer. It reads the player body and the trap registry and
 * writes nothing back: no rigid bodies, no impulses, no game state. Deleting
 * this component changes how a run looks and not how it plays.
 */
export interface EffectsHandle {
  /** A trap connected. Severity comes from the same impulse GameScene uses. */
  impact(impulseMagnitude: number): void;
  /** The runner reached the exit. */
  celebrate(): void;
}

interface Props {
  player: React.RefObject<RapierRigidBody | null>;
  traps: readonly TrapInstance[];
  trapBodies: React.MutableRefObject<Map<string, RapierRigidBody>>;
  startedAt: number;
  attemptSerial: number;
  active: boolean;
}

/** A long frame must not turn into one giant particle step. */
const MAX_EFFECT_STEP = 1 / 20;
/** Fraction of top speed at which the sprint trail starts. */
const SPEED_CUE_FRACTION = 0.82;
const SPEED_TRAIL_INTERVAL = 0.032;
/** Gravity alone cannot raise vertical velocity, so any rise is a contact. */
const LANDING_CONTACT_RISE = 2;
const LANDING_MIN_FALL_SPEED = 3;
const LANDING_COOLDOWN_MS = 150;
// The near-miss band: how far past a trap's own reach still counts as a
// skim, how much height difference still counts as "at the trap", how long a
// dwell can last before it is loitering rather than skimming, and how often
// the reward may fire at all.
const GRAZE_BAND = 0.5;
const GRAZE_HEIGHT = 1.7;
const GRAZE_MAX_DWELL_MS = 1600;
const GRAZE_COOLDOWN_MS = 900;
/** Impacts below this are a nudge; a ring would overstate them. */
const RING_SEVERITY_THRESHOLD = 0.45;
const AMBIENT_INTERVAL = 0.045;
/** Ambient emitters only run for traps this close to the runner. */
const AMBIENT_RANGE = 13;
/** And only for this many of them, so a crowded course cannot pile up. */
const AMBIENT_EMITTER_LIMIT = 4;
/** Inside the vacuum's real 2.5u suction radius. See emitSuctionLint. */
const LINT_RADIUS = 2.2;
/** Below the sprinkler's real 0.62u head. See emitSprinklerMist. */
const SPRINKLER_HEAD_HEIGHT = 0.55;
const CELEBRATION_SECOND_WAVE_MS = 420;
const DEFAULT_FOV_RADIANS = MathUtils.degToRad(52);

const INK_RGB = hexToRgb(PALETTE.ink);

/**
 * Normal blending, not additive. Additive on this scene clips to white against
 * the sky's near-white lower stop and the cream decks, which is the bug the
 * magnet's rings already hit. Colour management is handled by hand instead of
 * by the usual includes: the fragment shader writes plain sRGB, so the hues in
 * particles.ts are the hues that reach the screen and their measured contrast
 * against the backdrop means what it says.
 */
const PARTICLE_VERTEX_SHADER = `
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
attribute float aSpin;
attribute float aShape;
uniform float uPixelsPerUnit;
varying vec3 vColor;
varying float vAlpha;
varying float vSpin;
varying float vShape;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vSpin = aSpin;
  vShape = aShape;
  vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp((aSize * uPixelsPerUnit) / max(0.1, -viewPosition.z), 1.0, 64.0);
  gl_Position = projectionMatrix * viewPosition;
}
`;

const PARTICLE_FRAGMENT_SHADER = `
uniform vec3 uInk;
varying vec3 vColor;
varying float vAlpha;
varying float vSpin;
varying float vShape;
void main() {
  vec2 offset = gl_PointCoord - 0.5;
  float dotMask = 1.0 - smoothstep(0.16, 0.5, length(offset));
  float spinCos = cos(vSpin);
  float spinSin = sin(vSpin);
  vec2 chipUv = vec2(
    offset.x * spinCos - offset.y * spinSin,
    offset.x * spinSin + offset.y * spinCos
  );
  float chipMask =
    (1.0 - step(0.46, abs(chipUv.x))) * (1.0 - step(0.20, abs(chipUv.y)));
  float alpha = vAlpha * mix(dotMask, chipMask, vShape);
  if (alpha < 0.02) discard;
  vec3 folded = mix(vColor * 0.74, vColor * 1.22, step(0.0, chipUv.y));
  float edge = max(abs(chipUv.x) / 0.46, abs(chipUv.y) / 0.20);
  vec3 chipColor = mix(folded, uInk, smoothstep(0.68, 1.0, edge));
  gl_FragColor = vec4(mix(vColor, chipColor, vShape), alpha);
}
`;

/**
 * A body can be torn down between attempts, and reading a dead handle throws.
 * Every read here goes through one of these two, so a teardown costs a frame
 * of effects rather than the frame loop.
 */
function livePosition(body: RapierRigidBody | null | undefined): Vec3 | null {
  if (!body) return null;
  try {
    if (!body.isValid()) return null;
    const translation = body.translation();
    return [translation.x, translation.y, translation.z];
  } catch {
    return null;
  }
}

interface RunnerMotion {
  position: Vec3;
  verticalVelocity: number;
  groundSpeed: number;
  headingX: number;
  headingZ: number;
}

function readMotion(body: RapierRigidBody | null): RunnerMotion | null {
  if (!body) return null;
  try {
    if (!body.isValid()) return null;
    const translation = body.translation();
    const velocity = body.linvel();
    const groundSpeed = Math.hypot(velocity.x, velocity.z);
    return {
      position: [translation.x, translation.y, translation.z],
      verticalVelocity: velocity.y,
      groundSpeed,
      headingX: groundSpeed > 0.001 ? velocity.x / groundSpeed : 0,
      headingZ: groundSpeed > 0.001 ? velocity.z / groundSpeed : 1,
    };
  } catch {
    return null;
  }
}

/** Same resolution order as the traps: the placement wins, catalog is next. */
function trapNumber(trap: TrapInstance, key: string, fallback: number): number {
  const placed = trap.params[key];
  if (typeof placed === "number") return placed;
  const preset = TRAP_CATALOG[trap.type].defaultParams[key];
  return typeof preset === "number" ? preset : fallback;
}

export const EffectsLayer = forwardRef<EffectsHandle, Props>(function EffectsLayer(
  { player, traps, trapBodies, startedAt, attemptSerial, active },
  ref,
) {
  const reducedMotion = useSettingsStore((state) => state.reducedMotion);
  const quality = useSettingsStore((state) => state.quality);
  const budget = useMemo(
    () => effectBudget(reducedMotion, quality),
    [reducedMotion, quality],
  );

  // Allocated once and reused for the life of the attempt. Nothing below ever
  // constructs a geometry, a material or an Object3D per emission.
  const particles = useMemo(() => createParticlePool(), []);
  const rings = useMemo(() => createRingPool(), []);

  const particleView = useMemo(() => {
    const geometry = new BufferGeometry();
    const attributes: BufferAttribute[] = [];
    const bind = (name: string, array: Float32Array, itemSize: number) => {
      const attribute = new BufferAttribute(array, itemSize);
      attribute.setUsage(DynamicDrawUsage);
      geometry.setAttribute(name, attribute);
      attributes.push(attribute);
    };
    bind("position", particles.position, 3);
    bind("aColor", particles.color, 3);
    bind("aSize", particles.size, 1);
    bind("aAlpha", particles.alpha, 1);
    bind("aSpin", particles.spin, 1);
    bind("aShape", particles.shape, 1);
    geometry.setDrawRange(0, 0);
    const pixelsPerUnit = { value: 700 };
    const material = new ShaderMaterial({
      uniforms: {
        uPixelsPerUnit: pixelsPerUnit,
        uInk: { value: new Vector3(INK_RGB[0], INK_RGB[1], INK_RGB[2]) },
      },
      vertexShader: PARTICLE_VERTEX_SHADER,
      fragmentShader: PARTICLE_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
    });
    return { geometry, material, attributes, pixelsPerUnit };
  }, [particles]);

  const ringView = useMemo(() => {
    const geometry = new RingGeometry(0.78, 1, 40);
    const materials = Array.from(
      { length: RING_CAPACITY },
      () =>
        new MeshBasicMaterial({
          transparent: true,
          // Starts invisible. React can commit these meshes between a frame's
          // useFrame pass and its draw, and twelve white unit rings at the
          // world origin is not the first thing the player should see.
          opacity: 0,
          depthWrite: false,
          side: DoubleSide,
          // The shockwave and the particles must agree on what a hue looks
          // like, and the particle shader skips tone mapping.
          toneMapped: false,
        }),
    );
    return { geometry, materials };
  }, []);

  useEffect(
    () => () => {
      particleView.geometry.dispose();
      particleView.material.dispose();
      ringView.geometry.dispose();
      for (const material of ringView.materials) material.dispose();
    },
    [particleView, ringView],
  );

  const ringMeshes = useRef<(Mesh | null)[]>([]);
  const previousVerticalVelocity = useRef(0);
  const lastLandingAt = useRef(0);
  const speedTrailClock = useRef(0);
  const ambientClock = useRef(0);
  const celebrationWaveAt = useRef(0);
  const celebrationOrigin = useRef<Vec3>([0, 0, 0]);
  // The graze detector: when the runner entered each trap's reach, and when
  // anything last actually hit, so skimming past unharmed can be told apart
  // from the half-second before a hit lands.
  const grazeEntryAt = useRef(new Map<string, number>());
  const lastGrazeAt = useRef(0);
  const lastImpactAt = useRef(0);

  // A finished or abandoned attempt must not leak its confetti into the next
  // one, and the landing detector must not read a stale velocity across the
  // respawn teleport.
  useEffect(() => {
    clearParticles(particles);
    clearRings(rings);
    previousVerticalVelocity.current = 0;
    lastLandingAt.current = 0;
    celebrationWaveAt.current = 0;
    grazeEntryAt.current.clear();
    lastGrazeAt.current = 0;
    lastImpactAt.current = 0;
  }, [attemptSerial, particles, rings]);

  const ambientTraps = useMemo(
    () =>
      traps.filter(
        (trap) => trap.type === "angry_vacuum" || trap.type === "sprinkler",
      ),
    [traps],
  );

  useImperativeHandle(
    ref,
    () => ({
      impact(impulseMagnitude: number) {
        const origin = livePosition(player.current);
        if (!origin) return;
        lastImpactAt.current = performance.now();
        // Math.random on purpose: the seeded generators drive trap behaviour,
        // and decoration must not draw from a stream a run depends on.
        emitImpact(particles, budget, Math.random, origin, impulseMagnitude);
        const severity = impactSeverity(impulseMagnitude);
        if (budget.rings && severity >= RING_SEVERITY_THRESHOLD) {
          emitRing(
            rings,
            origin,
            severityColor(severity),
            0.35,
            1.1 + 1.5 * severity,
            0.34,
            0.7,
          );
        }
      },
      celebrate() {
        const origin = livePosition(player.current);
        if (!origin) return;
        celebrationOrigin.current = origin;
        celebrationWaveAt.current = performance.now() + CELEBRATION_SECOND_WAVE_MS;
        emitConfetti(particles, budget, Math.random, origin, 0.6);
        if (budget.rings) {
          emitRing(rings, origin, EFFECT_COLORS.celebration, 0.4, 3.4, 0.55, 0.75);
        }
      },
    }),
    [budget, particles, player, rings],
  );

  useFrame((state, delta) => {
    const step = Math.min(delta, MAX_EFFECT_STEP);
    updateParticles(particles, step);
    updateRings(rings, step);

    const now = performance.now();
    const motion = readMotion(player.current);
    if (motion) {
      const position = motion.position;
      const feet: Vec3 = [
        position[0],
        position[1] - PLAYER.capsuleHalfHeight - PLAYER.capsuleRadius,
        position[2],
      ];
      const rise = motion.verticalVelocity - previousVerticalVelocity.current;
      if (
        active &&
        previousVerticalVelocity.current <= -LANDING_MIN_FALL_SPEED &&
        rise >= LANDING_CONTACT_RISE &&
        now - lastLandingAt.current > LANDING_COOLDOWN_MS
      ) {
        lastLandingAt.current = now;
        emitLandingDust(
          particles,
          budget,
          Math.random,
          feet,
          previousVerticalVelocity.current,
        );
      }
      previousVerticalVelocity.current = motion.verticalVelocity;

      const groundSpeed = motion.groundSpeed;
      const cueThreshold = PLAYER.moveSpeed * SPEED_CUE_FRACTION;
      speedTrailClock.current += step;
      if (active && groundSpeed > cueThreshold) {
        if (speedTrailClock.current >= SPEED_TRAIL_INTERVAL) {
          speedTrailClock.current = 0;
          emitSpeedTrail(
            particles,
            budget,
            Math.random,
            [feet[0], feet[1] + 0.3, feet[2]],
            motion.headingX,
            motion.headingZ,
            Math.min(1, (groundSpeed - cueThreshold) / cueThreshold),
          );
        }
      } else {
        speedTrailClock.current = 0;
      }

      // Skimming a hazard and coming out the other side unharmed gets a
      // spark and a zip. The reward fires on EXIT of a trap's reach, never on
      // entry, so it can check that nothing actually connected in between -
      // a spark half a second before a hit would read as the game lying.
      if (active) {
        for (const trap of traps) {
          const live = livePosition(trapBodies.current.get(trap.id));
          const origin: Vec3 = live ?? [
            trap.position[0],
            trap.position[1],
            trap.position[2],
          ];
          const horizontal = Math.hypot(
            origin[0] - position[0],
            origin[2] - position[2],
          );
          const inside =
            horizontal < TRAP_CATALOG[trap.type].placementRadius + GRAZE_BAND &&
            Math.abs(origin[1] - position[1]) < GRAZE_HEIGHT;
          const enteredAt = grazeEntryAt.current.get(trap.id);
          if (inside && enteredAt === undefined) {
            grazeEntryAt.current.set(trap.id, now);
          } else if (!inside && enteredAt !== undefined) {
            grazeEntryAt.current.delete(trap.id);
            if (
              lastImpactAt.current < enteredAt &&
              now - enteredAt < GRAZE_MAX_DWELL_MS &&
              now - lastGrazeAt.current > GRAZE_COOLDOWN_MS &&
              motion.groundSpeed > PLAYER.moveSpeed * 0.35
            ) {
              lastGrazeAt.current = now;
              emitGrazeSpark(particles, budget, Math.random, [
                position[0],
                position[1] + 0.2,
                position[2],
              ]);
              AudioManager.graze();
            }
          }
        }
      }

      ambientClock.current += step;
      const ambientDue = ambientClock.current >= AMBIENT_INTERVAL;
      if (ambientDue) ambientClock.current = 0;
      if (active && ambientDue && budget.streams) {
        let emitters = 0;
        for (const trap of ambientTraps) {
          if (emitters >= AMBIENT_EMITTER_LIMIT) break;
          const live = livePosition(trapBodies.current.get(trap.id));
          const origin: Vec3 = live ?? [
            trap.position[0],
            trap.position[1],
            trap.position[2],
          ];
          if (Math.hypot(origin[0] - position[0], origin[2] - position[2]) > AMBIENT_RANGE) {
            continue;
          }
          emitters += 1;
          if (trap.type === "angry_vacuum") {
            emitSuctionLint(particles, budget, Math.random, origin, LINT_RADIUS);
          } else {
            const sweep = trapNumber(trap, "sweep", 1.3);
            const elapsed = Math.max(0, now - startedAt) / 1000;
            emitSprinklerMist(
              particles,
              budget,
              Math.random,
              [origin[0], trap.position[1] + SPRINKLER_HEAD_HEIGHT, origin[2]],
              trap.rotationY + elapsed * sweep,
            );
          }
        }
      }
    }

    if (celebrationWaveAt.current > 0 && now >= celebrationWaveAt.current) {
      celebrationWaveAt.current = 0;
      emitConfetti(particles, budget, Math.random, celebrationOrigin.current, 1);
      if (budget.rings) {
        emitRing(
          rings,
          celebrationOrigin.current,
          EFFECT_COLORS.celebration,
          0.4,
          4.6,
          0.7,
          0.6,
        );
      }
    }

    const camera = state.camera;
    const fovRadians =
      camera instanceof PerspectiveCamera
        ? MathUtils.degToRad(camera.fov)
        : DEFAULT_FOV_RADIANS;
    // gl_PointSize is in framebuffer pixels, so a particle keeps a constant
    // world size at any distance, resolution or device pixel ratio.
    particleView.pixelsPerUnit.value =
      (state.size.height * state.viewport.dpr) / (2 * Math.tan(fovRadians / 2));
    particleView.geometry.setDrawRange(0, particles.count);
    if (particles.count > 0) {
      for (const attribute of particleView.attributes) attribute.needsUpdate = true;
    }

    for (let index = 0; index < ringView.materials.length; index += 1) {
      const mesh = ringMeshes.current[index];
      const material = ringView.materials[index];
      if (!mesh || !material) continue;
      if (index >= rings.count) {
        mesh.visible = false;
        continue;
      }
      const radius = rings.radius[index]!;
      mesh.visible = true;
      mesh.position.set(
        rings.position[index * 3]!,
        rings.position[index * 3 + 1]!,
        rings.position[index * 3 + 2]!,
      );
      // Billboarded rather than laid on the floor: an impact happens at chest
      // height as often as at foot height, and a ground ring would z-fight the
      // deck it is drawn on.
      mesh.quaternion.copy(camera.quaternion);
      mesh.scale.set(radius, radius, 1);
      material.opacity = rings.alpha[index]!;
      material.color.setRGB(
        rings.color[index * 3]!,
        rings.color[index * 3 + 1]!,
        rings.color[index * 3 + 2]!,
        SRGBColorSpace,
      );
    }
  });

  return (
    <>
      <points
        geometry={particleView.geometry}
        material={particleView.material}
        frustumCulled={false}
        renderOrder={4}
      />
      {ringView.materials.map((material, index) => (
        <mesh
          key={index}
          ref={(mesh) => {
            ringMeshes.current[index] = mesh;
          }}
          geometry={ringView.geometry}
          material={material}
          frustumCulled={false}
          renderOrder={4}
        />
      ))}
    </>
  );
});
