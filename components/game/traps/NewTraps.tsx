"use client";
import { useFrame } from "@react-three/fiber";
import {
  CuboidCollider,
  RigidBody,
  type CollisionEnterPayload,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import type { Group, Mesh } from "three";
import { AudioManager } from "@/lib/audio/AudioManager";
import { PALETTE } from "@/lib/game/constants";
import { createSeededRandom, lerp } from "@/lib/game/seed";
import { TRAP_CATALOG } from "@/lib/game/trap-catalog";
import type { HazardContact, TrapInstance } from "@/lib/game/types";
import type { TrapMechanicEvent } from "@/components/game/TrapRenderer";

/**
 * Six traps whose verbs the roster did not already have. The existing sixteen
 * sweep, launch, push, chase, pull, spray, slip and snap; these commit to a
 * spot before they strike, charge before they burst, brake a runner instead of
 * sliding them, punish speed rather than contact, block a lane on a clock, and
 * wait a beat after being stepped on.
 *
 * Conventions carried over from the traps that already ship:
 *
 * - TrapRenderer keeps its TrapProps interface local to that file, so the same
 *   shape is declared again here rather than exported from there.
 * - Rapier accumulates `addForce` and nothing in this project resets it, so
 *   every sustained push is `applyImpulse(force * step)` with `step` clamped:
 *   one-shot, and independent of the display refresh rate.
 * - Every schedule is a pure function of the time since the attempt began, so
 *   a retry replays the same timing frame for frame.
 * - Every ground marker is sized from the same named constant the hit test
 *   uses, in PALETTE.danger, which is reserved for hazard reach.
 */
interface TrapProps {
  trap: TrapInstance;
  player: React.RefObject<RapierRigidBody | null>;
  soapUntilRef: React.MutableRefObject<number>;
  stunUntilRef: React.MutableRefObject<number>;
  grabbables: React.MutableRefObject<Map<string, RapierRigidBody>>;
  trapBodies: React.MutableRefObject<Map<string, RapierRigidBody>>;
  startedAt: number;
  onHazard(contact: HazardContact): void;
  onMechanic: ((event: TrapMechanicEvent) => void) | undefined;
}

/** Traps run ahead of the player controller, which reads velocity at 0. */
const TRAP_FRAME_PRIORITY = -100;
/** A long frame must not turn into a giant one-frame kick. */
const MAX_STEP = 1 / 20;

/**
 * What each trap here reports through contact(), and the shortest interval at
 * which it can report again while the runner stays in reach.
 *
 * These two numbers are the entire input to the riskWeight rule documented at
 * the top of lib/game/trap-catalog.ts, and the components below read their
 * cycle lengths and cooldowns straight out of this table, so a trap cannot
 * change what it does to a runner without the catalogue price moving with it.
 * tests/unit/new-traps.test.ts re-runs that rule against this table.
 */
export const NEW_TRAP_HAZARD = {
  paint_bucket: { impulse: 15, gateMs: 2800 },
  spin_cycle: { impulse: 12, gateMs: 2600 },
  // The gum reports rarely on purpose. Its mechanic is the brake, which runs
  // every frame; a contact is 250ms of cut steering on top of that, and the
  // sprinkler already showed what happens when a trap stuns faster than the
  // runner can recover: inside its radius the input stopped mattering. Every
  // 1200ms is punctuation, and the rule below prices it accordingly.
  sticky_gum: { impulse: 4, gateMs: 1200 },
  cord_trip: { impulse: 12, gateMs: 1500 },
  drawer_slam: { impulse: 9, gateMs: 3400 },
  rug_pull: { impulse: 8, gateMs: 2000 },
} as const satisfies Record<string, { impulse: number; gateMs: number }>;

function isLive(body: RapierRigidBody | null | undefined): body is RapierRigidBody {
  if (!body) return false;
  try {
    return body.isValid();
  } catch {
    return false;
  }
}

function playerCollision(event: CollisionEnterPayload) {
  return event.other.rigidBodyObject?.userData.kind === "player";
}

function contact(
  trap: TrapInstance,
  onHazard: TrapProps["onHazard"],
  impulse: number,
) {
  AudioManager.hazard(trap.type, impulse);
  onHazard({
    trapInstanceId: trap.id,
    trapType: trap.type,
    ownerName: trap.ownerName,
    contactedAtMs: performance.now(),
    impulseMagnitude: impulse,
  });
}

function mechanic(
  trap: TrapInstance,
  onMechanic: TrapProps["onMechanic"],
  event: string,
  magnitude = 0,
) {
  onMechanic?.({ trapType: trap.type, event, magnitude });
}

function useRegisterTrapBody(
  body: React.RefObject<RapierRigidBody | null>,
  trapBodies: TrapProps["trapBodies"],
  trapId: string,
) {
  useEffect(() => {
    const registry = trapBodies.current;
    const rigid = body.current;
    if (rigid) registry.set(trapId, rigid);
    return () => {
      registry.delete(trapId);
    };
  }, [body, trapBodies, trapId]);
}

/**
 * Placements carry the catalog defaults in `params`, so the instance wins and
 * the catalog is the fallback. Only reach and geometry are tunable this way:
 * the reported impulse and the repeat gate stay in NEW_TRAP_HAZARD, because a
 * placement that could move either would silently reprice the trap.
 */
function trapNumber(trap: TrapInstance, key: string, fallback: number): number {
  const placed = trap.params[key];
  if (typeof placed === "number" && Number.isFinite(placed)) return placed;
  const preset = TRAP_CATALOG[trap.type].defaultParams[key];
  return typeof preset === "number" && Number.isFinite(preset) ? preset : fallback;
}

/** Milliseconds since the attempt began. Every schedule below derives from it. */
function elapsedMs(startedAt: number): number {
  return Math.max(0, performance.now() - startedAt);
}

/** World-space forward of a trap, matching the convention in TrapRenderer. */
function trapForward(rotationY: number) {
  return { x: Math.sin(rotationY), z: Math.cos(rotationY) };
}

// ---------------------------------------------------------------------------
// Paint bucket
// ---------------------------------------------------------------------------
// The verb the roster was missing: aim, then commit. A can on a ceiling
// carriage tracks the runner for the first stretch of its cycle, freezes on the
// spot it has chosen, and drops there whatever the runner does next. Standing
// still is what loses; the dodge is lateral and it has to happen inside the
// frozen window, which is why the marker stops following before the can falls.

const PAINT = NEW_TRAP_HAZARD.paint_bucket;
/**
 * The can's clock, in milliseconds since the start of its cycle. Exported
 * because the gap between the aim freezing and the can letting go is the whole
 * trap: shrink it and there is nothing to react to.
 */
export const PAINT_SCHEDULE = { aimMs: 1500, releaseMs: 2000, fallMs: 260 } as const;
const PAINT_AIM_MS = PAINT_SCHEDULE.aimMs;
const PAINT_RELEASE_MS = PAINT_SCHEDULE.releaseMs;
const PAINT_FALL_MS = PAINT_SCHEDULE.fallMs;
const PAINT_IMPACT_MS = PAINT_RELEASE_MS + PAINT_FALL_MS;
/** The can lies where it landed this long before the carriage winches it up. */
const PAINT_REST_MS = 140;
const PAINT_WINCH_MS = 400;
const PAINT_SPLASH_FALLBACK = 1.15;
/**
 * How far from its bracket the carriage can chase a runner. Reach is that plus
 * the splash, so 3 keeps the whole field inside 4.15u: the widest hazard field
 * in the game is the vacuum's 4.5u chase, and the 1000ms exposure window the
 * riskWeight rule uses is justified by that being the widest thing a runner has
 * to cross. A carriage that roamed further would quietly break the rule.
 */
const PAINT_TRACK_FALLBACK = 3;
/** Per second, so the aim eases toward the runner instead of snapping to them. */
const PAINT_AIM_RATE = 3.4;
const PAINT_HANG_HEIGHT = 3.4;
const PAINT_CAN_RADIUS = 0.3;
const PAINT_CAN_HEIGHT = 0.44;
/** Thrown clear of the splat rather than into it. */
const PAINT_SHOVE = 3.4;
const PAINT_SLAM = 2.2;
const PAINT_LADDER_HALF_WIDTH = 0.34;
const PAINT_LADDER_HEIGHT = 1.1;
const PAINT_COLORS = [PALETTE.purple, PALETTE.green, PALETTE.blue, PALETTE.orange] as const;

export function PaintBucketTrap({
  trap,
  player,
  trapBodies,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const body = useRef<RapierRigidBody>(null);
  useRegisterTrapBody(body, trapBodies, trap.id);
  const carriage = useRef<Group>(null);
  const rope = useRef<Mesh>(null);
  const can = useRef<Group>(null);
  const marker = useRef<Group>(null);
  const fuse = useRef<Mesh>(null);
  const splat = useRef<Group>(null);
  const aim = useRef({ x: trap.position[0], z: trap.position[2] });
  const firedCycle = useRef(-1);
  const splash = Math.max(0.4, trapNumber(trap, "splash", PAINT_SPLASH_FALLBACK));
  const track = Math.max(splash, trapNumber(trap, "track", PAINT_TRACK_FALLBACK));
  const paint = useMemo(() => {
    const random = createSeededRandom(trap.seed);
    return PAINT_COLORS[Math.floor(random() * PAINT_COLORS.length)] ?? PALETTE.purple;
  }, [trap.seed]);

  // A retry re-arms the drop and parks the aim back over the ladder, so the
  // second run does not inherit where the first run was standing.
  useEffect(() => {
    firedCycle.current = -1;
    aim.current.x = trap.position[0];
    aim.current.z = trap.position[2];
  }, [startedAt, trap.position]);

  useFrame((_, delta) => {
    const elapsed = elapsedMs(startedAt);
    const cycle = Math.floor(elapsed / PAINT.gateMs);
    const phase = elapsed % PAINT.gateMs;
    const target = player.current;

    if (phase < PAINT_AIM_MS && isLive(target)) {
      const p = target.translation();
      const dx = p.x - trap.position[0];
      const dz = p.z - trap.position[2];
      const reach = Math.hypot(dx, dz);
      const clamp = reach > track ? track / reach : 1;
      const follow = 1 - Math.exp(-Math.min(delta, MAX_STEP) * PAINT_AIM_RATE);
      aim.current.x += (trap.position[0] + dx * clamp - aim.current.x) * follow;
      aim.current.z += (trap.position[2] + dz * clamp - aim.current.z) * follow;
    }

    if (phase >= PAINT_IMPACT_MS && firedCycle.current !== cycle) {
      firedCycle.current = cycle;
      mechanic(trap, onMechanic, "paint_dropped", splash);
      if (isLive(target)) {
        const p = target.translation();
        const dx = p.x - aim.current.x;
        const dz = p.z - aim.current.z;
        const distance = Math.hypot(dx, dz);
        if (distance < splash) {
          const away = Math.max(distance, 0.2);
          target.applyImpulse(
            {
              x: (dx / away) * PAINT_SHOVE,
              y: -PAINT_SLAM,
              z: (dz / away) * PAINT_SHOVE,
            },
            true,
          );
          contact(trap, onHazard, PAINT.impulse);
          mechanic(trap, onMechanic, "paint_splat", PAINT.impulse);
        }
      }
    }

    const fall =
      phase < PAINT_RELEASE_MS
        ? 0
        : Math.min(1, (phase - PAINT_RELEASE_MS) / PAINT_FALL_MS);
    const winch =
      phase < PAINT_IMPACT_MS + PAINT_REST_MS
        ? 0
        : Math.min(1, (phase - PAINT_IMPACT_MS - PAINT_REST_MS) / PAINT_WINCH_MS);
    // Accelerating on the way down, decelerating on the way back up.
    const drop = fall < 1 ? fall * fall : 1 - winch * (2 - winch);
    const carriageY = trap.position[1] + PAINT_HANG_HEIGHT;
    const canY =
      trap.position[1] + PAINT_CAN_HEIGHT / 2 + PAINT_HANG_HEIGHT * (1 - drop);

    if (carriage.current) carriage.current.position.set(aim.current.x, carriageY, aim.current.z);
    if (can.current) {
      can.current.position.set(aim.current.x, canY, aim.current.z);
      // Swings while it hunts, hangs dead still once it has chosen.
      const sway = phase < PAINT_AIM_MS ? 0.13 : 0.02;
      can.current.rotation.z = Math.sin(elapsed / 210) * sway;
      can.current.rotation.x = Math.cos(elapsed / 260) * sway;
    }
    if (rope.current) {
      const length = Math.max(0.02, carriageY - canY);
      rope.current.scale.y = length;
      rope.current.position.y = -length / 2;
    }
    if (marker.current)
      marker.current.position.set(aim.current.x, trap.position[1] + 0.03, aim.current.z);
    if (fuse.current) {
      // Fills the marker while the aim is still moving, then blinks through the
      // committed window. It only ever grows inward, so it cannot overstate the
      // splash ring drawn at the real radius.
      const closing = Math.min(1, phase / PAINT_AIM_MS);
      const committed = phase >= PAINT_AIM_MS && phase < PAINT_IMPACT_MS;
      const blink = committed ? (Math.floor(phase / 90) % 2 === 0 ? 1 : 0.45) : closing;
      fuse.current.scale.setScalar(committed ? blink : closing);
      fuse.current.visible = phase < PAINT_IMPACT_MS;
    }
    if (splat.current) {
      const landed = phase >= PAINT_IMPACT_MS;
      splat.current.visible = landed;
      if (landed) {
        const spread = Math.min(1, (phase - PAINT_IMPACT_MS) / 120);
        splat.current.position.set(aim.current.x, trap.position[1] + 0.05, aim.current.z);
        splat.current.scale.setScalar(lerp(0.35, 1, spread));
      }
    }
  }, TRAP_FRAME_PRIORITY);

  return (
    <>
      {/* Total reach: the carriage roams `track` from the bracket and the can
          splashes `splash` past wherever it stops. */}
      <mesh
        name="paintBucketReach"
        position={[trap.position[0], trap.position[1] + 0.02, trap.position[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry args={[track + splash - 0.1, track + splash, 56]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.42} />
      </mesh>
      {/* These four ride the aim in world space, so they carry the trap's own
          position until the first frame moves them. */}
      <group ref={marker} position={[trap.position[0], trap.position[1] + 0.03, trap.position[2]]}>
        <mesh name="paintBucketSplashRing" rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[splash - 0.12, splash, 40]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.72} />
        </mesh>
        <mesh name="paintBucketFuse" ref={fuse} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]}>
          <circleGeometry args={[splash - 0.14, 32]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.3} />
        </mesh>
      </group>
      <group
        ref={splat}
        visible={false}
        position={[trap.position[0], trap.position[1] + 0.05, trap.position[2]]}
      >
        <mesh name="paintBucketSplat" rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[splash, 26]} />
          <meshBasicMaterial color={paint} transparent opacity={0.85} />
        </mesh>
        {[0, 1, 2, 3, 4].map((index) => (
          <mesh
            key={index}
            name={`paintBucketSpatter${index}`}
            position={[
              Math.sin((index * Math.PI * 2) / 5) * splash * 1.18,
              0.005,
              Math.cos((index * Math.PI * 2) / 5) * splash * 1.18,
            ]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <circleGeometry args={[splash * 0.22, 10]} />
            <meshBasicMaterial color={paint} transparent opacity={0.7} />
          </mesh>
        ))}
      </group>
      <group
        ref={carriage}
        position={[trap.position[0], trap.position[1] + PAINT_HANG_HEIGHT, trap.position[2]]}
      >
        <mesh name="paintBucketCarriage" castShadow>
          <boxGeometry args={[0.44, 0.14, 0.32]} />
          <meshStandardMaterial color={PALETTE.muted} roughness={0.7} metalness={0.2} />
        </mesh>
        <mesh name="paintBucketPulley" position={[0, -0.12, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.08, 0.03, 6, 12]} />
          <meshStandardMaterial color={PALETTE.ink} roughness={0.6} metalness={0.3} />
        </mesh>
        {/* Unit height, stretched every frame to span carriage and can. */}
        <mesh name="paintBucketRope" ref={rope}>
          <cylinderGeometry args={[0.018, 0.018, 1, 6]} />
          <meshStandardMaterial color={PALETTE.cream} roughness={0.95} />
        </mesh>
      </group>
      <group
        ref={can}
        position={[
          trap.position[0],
          trap.position[1] + PAINT_HANG_HEIGHT + PAINT_CAN_HEIGHT / 2,
          trap.position[2],
        ]}
      >
        <mesh name="paintBucketCan" castShadow>
          <cylinderGeometry args={[PAINT_CAN_RADIUS, PAINT_CAN_RADIUS * 0.86, PAINT_CAN_HEIGHT, 14]} />
          <meshStandardMaterial color={PALETTE.cream} roughness={0.66} metalness={0.15} />
        </mesh>
        <mesh name="paintBucketLabel" position={[0, -0.04, 0]}>
          <cylinderGeometry args={[PAINT_CAN_RADIUS * 1.02, PAINT_CAN_RADIUS * 0.88, 0.16, 14]} />
          <meshStandardMaterial color={paint} roughness={0.8} />
        </mesh>
        <mesh name="paintBucketPaint" position={[0, PAINT_CAN_HEIGHT / 2 - 0.03, 0]}>
          <cylinderGeometry args={[PAINT_CAN_RADIUS * 0.9, PAINT_CAN_RADIUS * 0.9, 0.04, 14]} />
          <meshStandardMaterial color={paint} roughness={0.35} />
        </mesh>
        <mesh name="paintBucketHandle" position={[0, PAINT_CAN_HEIGHT / 2, 0]} rotation={[0, 0, Math.PI]}>
          <torusGeometry args={[PAINT_CAN_RADIUS * 0.92, 0.022, 6, 14, Math.PI]} />
          <meshStandardMaterial color={PALETTE.muted} roughness={0.55} metalness={0.3} />
        </mesh>
      </group>
      <RigidBody
        ref={body}
        type="fixed"
        colliders={false}
        position={[trap.position[0], trap.position[1], trap.position[2]]}
        rotation={[0, trap.rotationY, 0]}
      >
        <CuboidCollider
          args={[PAINT_LADDER_HALF_WIDTH, PAINT_LADDER_HEIGHT / 2, PAINT_LADDER_HALF_WIDTH]}
          position={[0, PAINT_LADDER_HEIGHT / 2, 0]}
        />
        {[-1, 1].map((side) => (
          <group key={side}>
            <mesh
              name={`paintBucketLadderLeg${side}`}
              castShadow
              position={[side * PAINT_LADDER_HALF_WIDTH * 0.8, PAINT_LADDER_HEIGHT / 2, -0.16]}
              rotation={[0.14, 0, side * 0.12]}
            >
              <boxGeometry args={[0.07, PAINT_LADDER_HEIGHT, 0.07]} />
              <meshStandardMaterial color={PALETTE.orange} roughness={0.85} />
            </mesh>
            <mesh
              name={`paintBucketLadderBrace${side}`}
              castShadow
              position={[side * PAINT_LADDER_HALF_WIDTH * 0.8, PAINT_LADDER_HEIGHT / 2, 0.2]}
              rotation={[-0.18, 0, side * 0.12]}
            >
              <boxGeometry args={[0.06, PAINT_LADDER_HEIGHT, 0.06]} />
              <meshStandardMaterial color={PALETTE.orange} roughness={0.85} />
            </mesh>
          </group>
        ))}
        {[0.3, 0.62].map((height) => (
          <mesh key={height} name={`paintBucketRung${height}`} position={[0, height, -0.1]}>
            <boxGeometry args={[PAINT_LADDER_HALF_WIDTH * 1.7, 0.05, 0.16]} />
            <meshStandardMaterial color={PALETTE.cream} roughness={0.88} />
          </mesh>
        ))}
        <mesh name="paintBucketLadderTop" castShadow position={[0, PAINT_LADDER_HEIGHT, 0]}>
          <boxGeometry args={[PAINT_LADDER_HALF_WIDTH * 2, 0.07, 0.44]} />
          <meshStandardMaterial color={PALETTE.cream} roughness={0.86} />
        </mesh>
        <mesh name="paintBucketDropCloth" position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[1.5, 1.5]} />
          <meshStandardMaterial color={PALETTE.cream} roughness={0.95} transparent opacity={0.85} />
        </mesh>
      </RigidBody>
    </>
  );
}

// ---------------------------------------------------------------------------
// Washing machine
// ---------------------------------------------------------------------------
// A charge the runner can read, then a radial burst. The fan and the sprinkler
// push continuously along a heading; this one is silent for most of its cycle
// and then throws everything around it outward at a moment printed on the
// floor, so it is a beat to run through rather than a field to avoid.

const SPIN = NEW_TRAP_HAZARD.spin_cycle;
/** The drum winds up over this long, then the burst lands. */
const SPIN_CHARGE_MS = 1400;
const SPIN_SHOCKWAVE_MS = 420;
const SPIN_BURST_FALLBACK = 2.2;
/** A jump near its apex clears the burst, as with the other floor hazards. */
const SPIN_BURST_HEIGHT = 2;
const SPIN_SHOVE = 5;
const SPIN_LIFT = 2.6;
const SPIN_HALF_WIDTH = 0.44;
const SPIN_HALF_HEIGHT = 0.52;
const SPIN_HALF_DEPTH = 0.42;
/** Peak sideways travel of the shaking body, in metres. */
const SPIN_JUDDER = 0.05;

export function SpinCycleTrap({
  trap,
  player,
  trapBodies,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const body = useRef<RapierRigidBody>(null);
  useRegisterTrapBody(body, trapBodies, trap.id);
  const shell = useRef<Group>(null);
  const drum = useRef<Group>(null);
  const charge = useRef<Mesh>(null);
  const shockwave = useRef<Group>(null);
  const firedCycle = useRef(-1);
  const burst = Math.max(0.6, trapNumber(trap, "burst", SPIN_BURST_FALLBACK));
  const wobble = useMemo(() => {
    const random = createSeededRandom(trap.seed);
    return { phase: random() * Math.PI * 2, spin: random() > 0.5 ? 1 : -1 };
  }, [trap.seed]);

  useEffect(() => {
    firedCycle.current = -1;
  }, [startedAt]);

  useFrame((_, delta) => {
    const elapsed = elapsedMs(startedAt);
    const cycle = Math.floor(elapsed / SPIN.gateMs);
    const phase = elapsed % SPIN.gateMs;
    const charging = Math.min(1, phase / SPIN_CHARGE_MS);

    if (phase >= SPIN_CHARGE_MS && firedCycle.current !== cycle) {
      firedCycle.current = cycle;
      mechanic(trap, onMechanic, "spin_burst", burst);
      const target = player.current;
      if (isLive(target)) {
        const p = target.translation();
        const dx = p.x - trap.position[0];
        const dz = p.z - trap.position[2];
        const distance = Math.hypot(dx, dz);
        if (distance < burst && p.y - trap.position[1] < SPIN_BURST_HEIGHT) {
          // Falls off toward the rim, so standing at the edge is a real choice.
          const strength = 1 - (distance / burst) * 0.55;
          const away = Math.max(distance, 0.25);
          target.applyImpulse(
            {
              x: (dx / away) * SPIN_SHOVE * strength,
              y: SPIN_LIFT * strength,
              z: (dz / away) * SPIN_SHOVE * strength,
            },
            true,
          );
          contact(trap, onHazard, SPIN.impulse);
          mechanic(trap, onMechanic, "spin_thrown", SPIN.impulse);
        }
      }
    }

    if (shell.current) {
      // Amplitude tracks the charge, so how close the burst is can be read off
      // the machine as well as off the floor.
      const shake = charging * charging * SPIN_JUDDER;
      const settle = phase < SPIN_CHARGE_MS ? 1 : Math.max(0, 1 - (phase - SPIN_CHARGE_MS) / 260);
      shell.current.position.x = Math.sin(elapsed / 26 + wobble.phase) * shake;
      shell.current.position.y = Math.abs(Math.sin(elapsed / 21)) * shake * 0.7 + (phase < SPIN_CHARGE_MS ? 0 : settle * 0.09);
      shell.current.rotation.z = Math.sin(elapsed / 33 + wobble.phase) * shake * 0.5;
    }
    // Accumulated rather than read off the clock: the rate changes across the
    // charge, and a rate multiplied by the elapsed time would snap the load
    // back to a new angle every time the cycle restarted.
    if (drum.current)
      drum.current.rotation.z +=
        Math.min(delta, MAX_STEP) * (3 + charging * 22) * wobble.spin;
    if (charge.current) {
      charge.current.visible = phase < SPIN_CHARGE_MS;
      charge.current.scale.setScalar(Math.max(0.001, charging));
    }
    if (shockwave.current) {
      const since = phase - SPIN_CHARGE_MS;
      const running = since >= 0 && since < SPIN_SHOCKWAVE_MS;
      shockwave.current.visible = running;
      if (running) shockwave.current.scale.setScalar(lerp(0.25, 1.05, since / SPIN_SHOCKWAVE_MS));
    }
  }, TRAP_FRAME_PRIORITY);

  return (
    <RigidBody
      ref={body}
      type="fixed"
      colliders={false}
      position={[trap.position[0], trap.position[1], trap.position[2]]}
      rotation={[0, trap.rotationY, 0]}
    >
      <CuboidCollider
        args={[SPIN_HALF_WIDTH, SPIN_HALF_HEIGHT, SPIN_HALF_DEPTH]}
        position={[0, SPIN_HALF_HEIGHT, 0]}
      />
      <mesh name="spinCycleBurstRing" position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[burst - 0.12, burst, 52]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.6} />
      </mesh>
      {/* Grows from the machine to the rim across the charge: where the burst
          will reach, and how long is left before it does. */}
      <mesh name="spinCycleCharge" ref={charge} position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[burst, 40]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.24} />
      </mesh>
      <group ref={shockwave} position={[0, 0.05, 0]} visible={false}>
        <mesh name="spinCycleShockwave" rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[burst * 0.84, burst, 44]} />
          <meshBasicMaterial color={PALETTE.cream} transparent opacity={0.55} />
        </mesh>
      </group>
      <group ref={shell} position={[0, 0, 0]}>
        <mesh name="spinCycleBody" castShadow receiveShadow position={[0, SPIN_HALF_HEIGHT, 0]}>
          <boxGeometry args={[SPIN_HALF_WIDTH * 2, SPIN_HALF_HEIGHT * 2, SPIN_HALF_DEPTH * 2]} />
          <meshStandardMaterial color={PALETTE.cream} roughness={0.7} />
        </mesh>
        <mesh name="spinCycleTop" castShadow position={[0, SPIN_HALF_HEIGHT * 2 + 0.03, 0]}>
          <boxGeometry args={[SPIN_HALF_WIDTH * 2.08, 0.06, SPIN_HALF_DEPTH * 2.08]} />
          <meshStandardMaterial color={PALETTE.blue} roughness={0.66} />
        </mesh>
        <mesh name="spinCycleDoorRim" position={[0, SPIN_HALF_HEIGHT, SPIN_HALF_DEPTH + 0.01]}>
          <torusGeometry args={[0.27, 0.05, 8, 20]} />
          <meshStandardMaterial color={PALETTE.muted} roughness={0.6} metalness={0.2} />
        </mesh>
        <mesh
          name="spinCycleGlass"
          position={[0, SPIN_HALF_HEIGHT, SPIN_HALF_DEPTH + 0.012]}
        >
          <circleGeometry args={[0.25, 18]} />
          <meshStandardMaterial color={PALETTE.ink} roughness={0.4} />
        </mesh>
        {/* The load, so the spin is something you can see rather than infer. */}
        <group ref={drum} position={[0, SPIN_HALF_HEIGHT, SPIN_HALF_DEPTH + 0.02]}>
          {[PALETTE.red, PALETTE.blue, PALETTE.yellow].map((color, index) => (
            <mesh
              key={color}
              name={`spinCycleLoad${index}`}
              position={[
                Math.sin((index * Math.PI * 2) / 3) * 0.13,
                Math.cos((index * Math.PI * 2) / 3) * 0.13,
                0,
              ]}
              rotation={[0, 0, index * 1.1]}
            >
              <boxGeometry args={[0.13, 0.09, 0.02]} />
              <meshStandardMaterial color={color} roughness={0.9} />
            </mesh>
          ))}
        </group>
        {[-1, 1].map((side) => (
          <mesh
            key={side}
            name={`spinCycleDial${side}`}
            position={[side * 0.22, SPIN_HALF_HEIGHT * 1.72, SPIN_HALF_DEPTH + 0.02]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <cylinderGeometry args={[0.06, 0.06, 0.04, 10]} />
            <meshStandardMaterial color={side < 0 ? PALETTE.red : PALETTE.yellow} roughness={0.6} />
          </mesh>
        ))}
        {[-1, 1].map((side) => (
          <mesh
            key={`foot-${side}`}
            name={`spinCycleFoot${side}`}
            position={[side * SPIN_HALF_WIDTH * 0.7, 0.03, 0]}
          >
            <boxGeometry args={[0.16, 0.06, SPIN_HALF_DEPTH * 1.8]} />
            <meshStandardMaterial color={PALETTE.ink} roughness={0.85} />
          </mesh>
        ))}
      </group>
    </RigidBody>
  );
}

// ---------------------------------------------------------------------------
// Chewed gum
// ---------------------------------------------------------------------------
// The opposite of the soap slick. Soap keeps your momentum and takes your
// steering; gum takes the momentum and leaves the steering, so running into it
// is what costs and the escape is a jump rather than a correction.

const GUM = NEW_TRAP_HAZARD.sticky_gum;
const GUM_RADIUS_FALLBACK = 0.72;
/**
 * Fraction of horizontal speed pulled out per second. PlayerController corrects
 * toward the input target at PLAYER.acceleration on dry ground, so the runner
 * settles at acceleration / grip rather than being pinned: 30 / 9 is a 3.3 m/s
 * crawl against a 7.2 m/s walk, which is slow enough to hurt and fast enough to
 * still be under the player's control.
 */
const GUM_GRIP_FALLBACK = 9;
/** Jumping clears it, as with banana (1.15), mop (1.3) and sprinkler (1.4). */
const GUM_HEIGHT = 1.1;
const GUM_STRAND_COUNT = 5;
/** The gum a shoe has been on: nothing in the level palette is this colour. */
const GUM_PINK = "#ff9bd0";

export function StickyGumTrap({
  trap,
  player,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const strands = useRef<Group>(null);
  const blob = useRef<Group>(null);
  const lastReport = useRef(0);
  const pull = useRef(0);
  useEffect(() => {
    lastReport.current = 0;
  }, [startedAt]);
  const radius = Math.max(0.3, trapNumber(trap, "radius", GUM_RADIUS_FALLBACK));
  const grip = Math.max(0.5, trapNumber(trap, "grip", GUM_GRIP_FALLBACK));

  useFrame((_, delta) => {
    const step = Math.min(delta, MAX_STEP);
    const target = player.current;
    let stuck = false;
    if (isLive(target)) {
      const p = target.translation();
      const distance = Math.hypot(p.x - trap.position[0], p.z - trap.position[2]);
      if (distance < radius && p.y - trap.position[1] < GUM_HEIGHT) {
        stuck = true;
        const velocity = target.linvel();
        const mass = target.mass();
        // A fraction of the current speed, never more than all of it, so the
        // brake can slow a runner to a crawl but never throw them backwards.
        const brake = Math.min(1, grip * step) * (mass > 0 ? mass : 1);
        target.applyImpulse(
          { x: -velocity.x * brake, y: 0, z: -velocity.z * brake },
          true,
        );
        const now = performance.now();
        if (now - lastReport.current > GUM.gateMs) {
          lastReport.current = now;
          contact(trap, onHazard, GUM.impulse);
          mechanic(trap, onMechanic, "gum_stuck", Math.hypot(velocity.x, velocity.z));
        }
      }
    }
    // Strands rise while a shoe is in the wad and sag back once it is out.
    pull.current = Math.max(0, Math.min(1, pull.current + (stuck ? step * 4 : -step * 2.4)));
    if (strands.current) {
      strands.current.scale.y = 1 + pull.current * 2.6;
      strands.current.rotation.y += step * (0.4 + pull.current * 1.6);
    }
    if (blob.current) {
      const squash = 1 - pull.current * 0.22;
      blob.current.scale.set(1 + pull.current * 0.12, squash, 1 + pull.current * 0.12);
    }
  }, TRAP_FRAME_PRIORITY);

  return (
    <group
      position={[trap.position[0], trap.position[1] + 0.02, trap.position[2]]}
      rotation={[0, trap.rotationY, 0]}
    >
      <mesh name="stickyGumReach" rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[radius, 28]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.32} />
      </mesh>
      <mesh name="stickyGumRim" position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius - 0.1, radius, 30]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.8} />
      </mesh>
      <group ref={blob} position={[0, 0.01, 0]}>
        <mesh name="stickyGumWad" castShadow scale={[1, 0.3, 1]}>
          <sphereGeometry args={[radius * 0.62, 14, 10]} />
          <meshStandardMaterial color={GUM_PINK} roughness={0.34} />
        </mesh>
        {[0, 1, 2].map((index) => (
          <mesh
            key={index}
            name={`stickyGumSmear${index}`}
            position={[
              Math.sin(index * 2.1) * radius * 0.5,
              0.012,
              Math.cos(index * 2.1) * radius * 0.5,
            ]}
            scale={[1, 0.16, 1]}
          >
            <sphereGeometry args={[radius * 0.26, 10, 8]} />
            <meshStandardMaterial color={GUM_PINK} roughness={0.4} />
          </mesh>
        ))}
      </group>
      <group ref={strands} position={[0, 0.02, 0]}>
        {Array.from({ length: GUM_STRAND_COUNT }, (_, index) => (
          <mesh
            key={index}
            name={`stickyGumStrand${index}`}
            position={[
              Math.sin((index * Math.PI * 2) / GUM_STRAND_COUNT) * radius * 0.36,
              0.06,
              Math.cos((index * Math.PI * 2) / GUM_STRAND_COUNT) * radius * 0.36,
            ]}
          >
            <cylinderGeometry args={[0.012, 0.03, 0.12, 5]} />
            <meshStandardMaterial color={GUM_PINK} roughness={0.3} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Extension cord
// ---------------------------------------------------------------------------
// The only hazard in the game that a runner clears by slowing down. Below the
// trip speed the cord is stepped over and nothing happens; above it the cord
// catches an ankle, kills the run and puts the runner on the floor. Everything
// else on the roster punishes being in the wrong place, this punishes being in
// a hurry, and it telegraphs by pulling taut as a fast runner closes on it.

const CORD = NEW_TRAP_HAZARD.cord_trip;
const CORD_SPAN_FALLBACK = 1.7;
const CORD_TRIP_SPEED_FALLBACK = 4.2;
/**
 * Depth of the catching band along the trap's forward axis. 0.72u takes a
 * runner at full speed 100ms to cross, so the test still lands several frames
 * even on a display the game is only managing 15 frames a second on.
 */
const CORD_BAND_HALF = 0.36;
const CORD_HEIGHT = 0.16;
/** Above this the ankle is over the cord: jumping clears it as walking does. */
const CORD_CLEAR_HEIGHT = 1;
/** The cord starts twanging once a runner is inside this. */
const CORD_WATCH_RADIUS = 3.2;
/** Share of the runner's own speed the cord takes out of them. */
const CORD_CATCH = 0.72;
const CORD_SLAM = 4.5;
/** Scrambling back up: the same authority cut the mop and sprinkler apply. */
const CORD_STUMBLE_MS = 550;
const CORD_SEGMENTS = 7;
const CORD_SAG = 0.05;
const CORD_POST_HEIGHT = 0.34;

export function CordTripTrap({
  trap,
  player,
  soapUntilRef,
  trapBodies,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const body = useRef<RapierRigidBody>(null);
  useRegisterTrapBody(body, trapBodies, trap.id);
  const segments = useRef<Array<Mesh | null>>([]);
  const lastTrip = useRef(0);
  // A retry pulls the cord taut again. The trap tree is usually remounted
  // between attempts, but a fresh startedAt on the same mount would otherwise
  // start the run with a cord still lying slack from the last one.
  useEffect(() => {
    lastTrip.current = 0;
  }, [startedAt]);
  const span = Math.max(0.6, trapNumber(trap, "span", CORD_SPAN_FALLBACK));
  const tripSpeed = Math.max(1, trapNumber(trap, "tripSpeed", CORD_TRIP_SPEED_FALLBACK));
  const forward = useMemo(() => trapForward(trap.rotationY), [trap.rotationY]);

  useFrame(() => {
    const now = performance.now();
    const armed = now - lastTrip.current > CORD.gateMs;
    let tension = 0;
    const target = player.current;
    if (isLive(target)) {
      const p = target.translation();
      const dx = p.x - trap.position[0];
      const dz = p.z - trap.position[2];
      const along = dx * forward.x + dz * forward.z;
      const lateral = dx * forward.z - dz * forward.x;
      const velocity = target.linvel();
      const speed = Math.hypot(velocity.x, velocity.z);
      const reach = Math.hypot(dx, dz);
      // Pulls taut in proportion to how close a fast runner is: the wind-up
      // says "slow down" while there is still room to do it.
      if (armed && reach < CORD_WATCH_RADIUS)
        tension =
          Math.min(1, speed / tripSpeed) * (1 - reach / CORD_WATCH_RADIUS);
      if (
        armed &&
        speed > tripSpeed &&
        Math.abs(along) < CORD_BAND_HALF &&
        Math.abs(lateral) < span / 2 &&
        p.y - trap.position[1] < CORD_CLEAR_HEIGHT
      ) {
        lastTrip.current = now;
        const mass = target.mass();
        const scale = (mass > 0 ? mass : 1) * CORD_CATCH;
        // The runner's own speed is what puts them down, so the faster the
        // approach the harder the landing.
        target.applyImpulse(
          {
            x: -velocity.x * scale,
            y: -CORD_SLAM,
            z: -velocity.z * scale,
          },
          true,
        );
        soapUntilRef.current = Math.max(soapUntilRef.current, now + CORD_STUMBLE_MS);
        contact(trap, onHazard, CORD.impulse);
        mechanic(trap, onMechanic, "cord_tripped", speed);
      }
    }
    // Taut in proportion to the tension, and left lying slack for the whole
    // cooldown, so both "about to catch you" and "spent" are visible states.
    const sag = armed ? (1 - tension) * CORD_SAG : CORD_SAG * 2.6;
    for (let index = 0; index < CORD_SEGMENTS; index += 1) {
      const segment = segments.current[index];
      if (!segment) continue;
      const t = index / (CORD_SEGMENTS - 1);
      const droop = Math.sin(t * Math.PI) * sag;
      const twang = armed
        ? Math.sin(t * Math.PI * 2 + now / 24) * 0.035 * tension
        : 0;
      segment.position.set((t - 0.5) * span, CORD_HEIGHT - droop + twang, 0);
    }
  }, TRAP_FRAME_PRIORITY);

  return (
    <RigidBody
      ref={body}
      type="fixed"
      colliders={false}
      position={[trap.position[0], trap.position[1], trap.position[2]]}
      rotation={[0, trap.rotationY, 0]}
    >
      {[-1, 1].map((side) => (
        <CuboidCollider
          key={side}
          args={[0.12, CORD_POST_HEIGHT / 2, 0.12]}
          position={[(side * span) / 2, CORD_POST_HEIGHT / 2, 0]}
        />
      ))}
      {/* The band the cord actually catches in, at its real width and depth. */}
      <mesh name="cordTripBand" position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[span, CORD_BAND_HALF * 2]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.55} />
      </mesh>
      <mesh name="cordTripBandEdge" position={[0, 0.026, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[CORD_BAND_HALF - 0.05, CORD_BAND_HALF, 24]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.85} />
      </mesh>
      <mesh name="cordTripSocket" castShadow position={[-span / 2, CORD_POST_HEIGHT / 2, 0]}>
        <boxGeometry args={[0.22, CORD_POST_HEIGHT, 0.2]} />
        <meshStandardMaterial color={PALETTE.cream} roughness={0.8} />
      </mesh>
      <mesh name="cordTripPlug" position={[-span / 2 + 0.14, CORD_POST_HEIGHT * 0.6, 0]}>
        <boxGeometry args={[0.1, 0.12, 0.14]} />
        <meshStandardMaterial color={PALETTE.ink} roughness={0.7} />
      </mesh>
      <mesh name="cordTripLampBase" castShadow position={[span / 2, 0.06, 0]}>
        <cylinderGeometry args={[0.24, 0.28, 0.12, 14]} />
        <meshStandardMaterial color={PALETTE.muted} roughness={0.7} metalness={0.2} />
      </mesh>
      <mesh name="cordTripLampStem" castShadow position={[span / 2, CORD_POST_HEIGHT, 0]}>
        <cylinderGeometry args={[0.04, 0.05, CORD_POST_HEIGHT * 2, 10]} />
        <meshStandardMaterial color={PALETTE.muted} roughness={0.65} metalness={0.2} />
      </mesh>
      <mesh name="cordTripLampShade" castShadow position={[span / 2, CORD_POST_HEIGHT * 2 + 0.1, 0]}>
        <cylinderGeometry args={[0.16, 0.24, 0.26, 14, 1, true]} />
        <meshStandardMaterial color={PALETTE.yellow} roughness={0.8} side={2} />
      </mesh>
      {Array.from({ length: CORD_SEGMENTS }, (_, index) => (
        <mesh
          key={index}
          name={`cordTripSegment${index}`}
          ref={(mesh: Mesh | null) => {
            segments.current[index] = mesh;
          }}
          position={[(index / (CORD_SEGMENTS - 1) - 0.5) * span, CORD_HEIGHT, 0]}
          rotation={[0, 0, Math.PI / 2]}
        >
          <cylinderGeometry args={[0.03, 0.03, span / (CORD_SEGMENTS - 1) + 0.02, 6]} />
          <meshStandardMaterial color={PALETTE.ink} roughness={0.75} />
        </mesh>
      ))}
    </RigidBody>
  );
}

// ---------------------------------------------------------------------------
// Cutlery drawer
// ---------------------------------------------------------------------------
// A timing gate rather than a sweep. The drawer is closed for most of its
// cycle, rattles for a beat, then fires across the lane and holds there long
// enough to matter before sliding back. Nothing else on the roster gives the
// runner a wide safe window and a hard shut one on a fixed clock.

const DRAWER = NEW_TRAP_HAZARD.drawer_slam;
/**
 * The drawer's clock, in milliseconds. Exported because the safe window is a
 * design guarantee rather than an implementation detail: the lane is open for
 * most of the cycle and shut hard for the rest of it.
 */
export const DRAWER_SCHEDULE = {
  outMs: 200,
  dwellMs: 900,
  inMs: 420,
  rattleMs: 450,
} as const;
const DRAWER_RATTLE_MS = DRAWER_SCHEDULE.rattleMs;
/** Everything before this in the cycle is the closed, safe window. */
const DRAWER_FIRE_AT_MS =
  DRAWER.gateMs - (DRAWER_SCHEDULE.outMs + DRAWER_SCHEDULE.dwellMs + DRAWER_SCHEDULE.inMs);

/**
 * How far the drawer is out, `since` milliseconds after it started to fire.
 * Negative is the closed window before the slam.
 */
export function drawerOffset(since: number, travel: number): number {
  if (since < 0) return 0;
  if (since < DRAWER_SCHEDULE.outMs) {
    const u = since / DRAWER_SCHEDULE.outMs;
    return travel * (1 - (1 - u) * (1 - u));
  }
  if (since < DRAWER_SCHEDULE.outMs + DRAWER_SCHEDULE.dwellMs) return travel;
  const u = Math.min(
    1,
    (since - DRAWER_SCHEDULE.outMs - DRAWER_SCHEDULE.dwellMs) / DRAWER_SCHEDULE.inMs,
  );
  return travel * (1 - u * u);
}
const DRAWER_TRAVEL_FALLBACK = 1.35;
const DRAWER_HALF_WIDTH = 0.5;
const DRAWER_HALF_HEIGHT = 0.16;
const DRAWER_HALF_DEPTH = 0.34;
const DRAWER_Y = 0.62;
const DRAWER_CARCASS_HALF_HEIGHT = 0.55;
const DRAWER_SHOVE = 4.2;
const DRAWER_LIFT = 1.4;

export function DrawerSlamTrap({
  trap,
  player,
  trapBodies,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const body = useRef<RapierRigidBody>(null);
  const carcass = useRef<RapierRigidBody>(null);
  // The drawer, not the carcass: the moving half is what QA and the mechanics
  // telemetry want to read the position of.
  useRegisterTrapBody(body, trapBodies, trap.id);
  const front = useRef<Group>(null);
  const reportedCycle = useRef(-1);
  const openedCycle = useRef(-1);
  const travel = Math.max(0.4, trapNumber(trap, "travel", DRAWER_TRAVEL_FALLBACK));
  const forward = useMemo(() => trapForward(trap.rotationY), [trap.rotationY]);

  useEffect(() => {
    reportedCycle.current = -1;
    openedCycle.current = -1;
  }, [startedAt]);

  useFrame(() => {
    const elapsed = elapsedMs(startedAt);
    const phase = elapsed % DRAWER.gateMs;
    const since = phase - DRAWER_FIRE_AT_MS;
    const offset = drawerOffset(since, travel);
    const untilFire = -since;
    const rattle =
      untilFire > 0 && untilFire < DRAWER_RATTLE_MS ? 1 - untilFire / DRAWER_RATTLE_MS : 0;
    const jitter = rattle * 0.03 * Math.sin(elapsed / 18);
    body.current?.setNextKinematicTranslation({
      x: trap.position[0] + forward.x * (offset + jitter),
      y: trap.position[1] + DRAWER_Y,
      z: trap.position[2] + forward.z * (offset + jitter),
    });
    if (front.current) front.current.rotation.x = rattle * 0.04 * Math.sin(elapsed / 14);
    const cycle = Math.floor(elapsed / DRAWER.gateMs);
    if (since >= 0 && openedCycle.current !== cycle) {
      openedCycle.current = cycle;
      mechanic(trap, onMechanic, "drawer_opened", travel);
    }
  }, TRAP_FRAME_PRIORITY);

  return (
    <>
      {/* The lane the drawer sweeps, at the width and reach it actually has. */}
      <group
        position={[trap.position[0], trap.position[1] + 0.02, trap.position[2]]}
        rotation={[0, trap.rotationY, 0]}
      >
        <mesh
          name="drawerSlamLane"
          position={[0, 0, (travel + DRAWER_HALF_DEPTH) / 2]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[DRAWER_HALF_WIDTH * 2, travel + DRAWER_HALF_DEPTH]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.45} />
        </mesh>
        <mesh
          name="drawerSlamLaneEdge"
          position={[0, 0.004, travel + DRAWER_HALF_DEPTH / 2]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[DRAWER_HALF_WIDTH * 2, 0.1]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.9} />
        </mesh>
      </group>
      <RigidBody
        ref={carcass}
        type="fixed"
        colliders={false}
        position={[trap.position[0], trap.position[1], trap.position[2]]}
        rotation={[0, trap.rotationY, 0]}
      >
        <CuboidCollider
          args={[DRAWER_HALF_WIDTH + 0.08, DRAWER_CARCASS_HALF_HEIGHT, 0.3]}
          position={[0, DRAWER_CARCASS_HALF_HEIGHT, -0.3]}
        />
        <mesh
          name="drawerSlamCarcass"
          castShadow
          receiveShadow
          position={[0, DRAWER_CARCASS_HALF_HEIGHT, -0.3]}
        >
          <boxGeometry args={[(DRAWER_HALF_WIDTH + 0.08) * 2, DRAWER_CARCASS_HALF_HEIGHT * 2, 0.6]} />
          <meshStandardMaterial color={PALETTE.orange} roughness={0.86} />
        </mesh>
        <mesh
          name="drawerSlamCounter"
          castShadow
          position={[0, DRAWER_CARCASS_HALF_HEIGHT * 2 + 0.04, -0.3]}
        >
          <boxGeometry args={[(DRAWER_HALF_WIDTH + 0.14) * 2, 0.08, 0.7]} />
          <meshStandardMaterial color={PALETTE.cream} roughness={0.6} />
        </mesh>
      </RigidBody>
      <RigidBody
        ref={body}
        type="kinematicPosition"
        colliders={false}
        position={[trap.position[0], trap.position[1] + DRAWER_Y, trap.position[2]]}
        rotation={[0, trap.rotationY, 0]}
        onCollisionEnter={(event) => {
          if (!playerCollision(event)) return;
          const cycle = Math.floor(elapsedMs(startedAt) / DRAWER.gateMs);
          // One shove per slam: the drawer is out for over a second, and a
          // report per contact would price the trap as a repeater it is not.
          if (reportedCycle.current === cycle) return;
          reportedCycle.current = cycle;
          contact(trap, onHazard, DRAWER.impulse);
          mechanic(trap, onMechanic, "drawer_contact", DRAWER.impulse);
          const target = player.current;
          if (!isLive(target)) return;
          target.applyImpulse(
            {
              x: forward.x * DRAWER_SHOVE,
              y: DRAWER_LIFT,
              z: forward.z * DRAWER_SHOVE,
            },
            true,
          );
        }}
      >
        <CuboidCollider args={[DRAWER_HALF_WIDTH, DRAWER_HALF_HEIGHT, DRAWER_HALF_DEPTH]} />
        <group ref={front}>
          <mesh name="drawerSlamBox" castShadow>
            <boxGeometry args={[DRAWER_HALF_WIDTH * 2, DRAWER_HALF_HEIGHT * 2, DRAWER_HALF_DEPTH * 2]} />
            <meshStandardMaterial color={PALETTE.orange} roughness={0.84} />
          </mesh>
          <mesh name="drawerSlamFace" castShadow position={[0, 0, DRAWER_HALF_DEPTH]}>
            <boxGeometry args={[DRAWER_HALF_WIDTH * 2.1, DRAWER_HALF_HEIGHT * 2.2, 0.06]} />
            <meshStandardMaterial color={PALETTE.cream} roughness={0.72} />
          </mesh>
          <mesh
            name="drawerSlamHandle"
            castShadow
            position={[0, 0, DRAWER_HALF_DEPTH + 0.08]}
            rotation={[0, 0, Math.PI / 2]}
          >
            <cylinderGeometry args={[0.03, 0.03, DRAWER_HALF_WIDTH * 1.2, 8]} />
            <meshStandardMaterial color={PALETTE.muted} roughness={0.5} metalness={0.35} />
          </mesh>
          {[-0.24, 0, 0.24].map((x) => (
            <mesh
              key={x}
              name={`drawerSlamCutlery${x}`}
              position={[x, DRAWER_HALF_HEIGHT * 0.7, 0]}
              rotation={[0, x * 2, 0]}
            >
              <boxGeometry args={[0.05, 0.03, DRAWER_HALF_DEPTH * 1.5]} />
              <meshStandardMaterial color={PALETTE.muted} roughness={0.35} metalness={0.5} />
            </mesh>
          ))}
        </group>
      </RigidBody>
    </>
  );
}

// ---------------------------------------------------------------------------
// Trick rug
// ---------------------------------------------------------------------------
// Armed by being stepped on and paid out a beat later, which is a shape no
// other trap here has: the banana and the mousetrap fire the instant they are
// touched, so there is nothing to react to. The rug gives the runner a short,
// loud window in which sprinting off it is a real escape, and drags anyone
// still standing on it back down the course.

const RUG = NEW_TRAP_HAZARD.rug_pull;
const RUG_HALF_X = 0.85;
const RUG_HALF_Z = 0.62;
/** Jumping over the rug clears it, the same as the other floor hazards. */
const RUG_HEIGHT = 1;
/**
 * Step-on to yank, and back to armed. `rearmMs` is whatever the repeat gate has
 * left once the yank has played out, so the shortest interval between two
 * reports is exactly NEW_TRAP_HAZARD.rug_pull.gateMs and the catalogue price
 * derived from that gate cannot be wrong about this trap.
 */
export const RUG_SCHEDULE = {
  delayMs: 380,
  yankMs: 220,
  returnMs: 900,
  rearmMs: RUG.gateMs - (380 + 220 + 900),
} as const;
const RUG_DELAY_MS = RUG_SCHEDULE.delayMs;
const RUG_YANK_MS = RUG_SCHEDULE.yankMs;
const RUG_RETURN_MS = RUG_SCHEDULE.returnMs;
const RUG_REARM_MS = RUG_SCHEDULE.rearmMs;
const RUG_YANK_FALLBACK = 1.6;
const RUG_DRAG = 4.6;
const RUG_SLAM = 3.2;
const RUG_STUMBLE_MS = 600;
const RUG_FRINGE_COUNT = 9;

type RugPhase = "armed" | "tensing" | "yanking" | "returning" | "rearming";

export function RugPullTrap({
  trap,
  player,
  soapUntilRef,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const rug = useRef<Group>(null);
  const warning = useRef<Mesh>(null);
  const phase = useRef<RugPhase>("armed");
  const phaseAt = useRef(0);
  const yank = Math.max(0.4, trapNumber(trap, "yank", RUG_YANK_FALLBACK));
  const forward = useMemo(() => trapForward(trap.rotationY), [trap.rotationY]);

  useEffect(() => {
    phase.current = "armed";
    phaseAt.current = 0;
  }, [startedAt]);

  useFrame(() => {
    const now = performance.now();
    const target = player.current;
    let onRug = false;
    if (isLive(target)) {
      const p = target.translation();
      const dx = p.x - trap.position[0];
      const dz = p.z - trap.position[2];
      const along = dx * forward.x + dz * forward.z;
      const lateral = dx * forward.z - dz * forward.x;
      onRug =
        Math.abs(along) < RUG_HALF_Z &&
        Math.abs(lateral) < RUG_HALF_X &&
        p.y - trap.position[1] < RUG_HEIGHT;
    }

    const since = now - phaseAt.current;
    if (phase.current === "armed" && onRug) {
      phase.current = "tensing";
      phaseAt.current = now;
      mechanic(trap, onMechanic, "rug_armed", RUG_DELAY_MS);
    } else if (phase.current === "tensing" && since >= RUG_DELAY_MS) {
      phase.current = "yanking";
      phaseAt.current = now;
      if (onRug && isLive(target)) {
        target.applyImpulse(
          {
            x: -forward.x * RUG_DRAG,
            y: -RUG_SLAM,
            z: -forward.z * RUG_DRAG,
          },
          true,
        );
        soapUntilRef.current = Math.max(soapUntilRef.current, now + RUG_STUMBLE_MS);
        contact(trap, onHazard, RUG.impulse);
        mechanic(trap, onMechanic, "rug_pulled", RUG.impulse);
      } else {
        mechanic(trap, onMechanic, "rug_missed", 0);
      }
    } else if (phase.current === "yanking" && since >= RUG_YANK_MS) {
      phase.current = "returning";
      phaseAt.current = now;
    } else if (phase.current === "returning" && since >= RUG_RETURN_MS) {
      phase.current = "rearming";
      phaseAt.current = now;
    } else if (phase.current === "rearming" && since >= RUG_REARM_MS) {
      phase.current = "armed";
      phaseAt.current = now;
    }

    const state = phase.current;
    const elapsedPhase = now - phaseAt.current;
    let slide = 0;
    let shiver = 0;
    if (state === "tensing") {
      const u = Math.min(1, elapsedPhase / RUG_DELAY_MS);
      // Creeps backward and shakes harder the closer the yank gets.
      slide = -u * u * 0.12;
      shiver = u;
    } else if (state === "yanking") {
      const u = Math.min(1, elapsedPhase / RUG_YANK_MS);
      slide = -yank * (1 - (1 - u) * (1 - u));
    } else if (state === "returning") {
      const u = Math.min(1, elapsedPhase / RUG_RETURN_MS);
      slide = -yank * (1 - u);
    }
    if (rug.current) {
      rug.current.position.set(forward.x * slide, 0.015 + shiver * 0.01, forward.z * slide);
      rug.current.rotation.y = trap.rotationY + shiver * Math.sin(now / 22) * 0.03;
    }
    if (warning.current)
      warning.current.visible =
        state === "armed" || (state === "tensing" && Math.floor(elapsedPhase / 70) % 2 === 0);
  }, TRAP_FRAME_PRIORITY);

  return (
    <group position={[trap.position[0], trap.position[1], trap.position[2]]}>
      {/* The trigger rectangle, drawn where it is tested rather than where the
          rug has slid to: stepping here is what arms the yank. Rotated with the
          trap, because the test runs in the trap's own axes. */}
      <group rotation={[0, trap.rotationY, 0]}>
        <mesh
          name="rugPullTrigger"
          ref={warning}
          position={[0, 0.012, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[RUG_HALF_X * 2, RUG_HALF_Z * 2]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.5} />
        </mesh>
      </group>
      <group ref={rug} rotation={[0, trap.rotationY, 0]}>
        <mesh name="rugPullPile" receiveShadow position={[0, 0.01, 0]}>
          <boxGeometry args={[RUG_HALF_X * 2, 0.02, RUG_HALF_Z * 2]} />
          <meshStandardMaterial color={PALETTE.purple} roughness={0.95} />
        </mesh>
        <mesh name="rugPullBorder" position={[0, 0.022, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[RUG_HALF_Z * 0.62, RUG_HALF_Z * 0.82, 4, 1]} />
          <meshStandardMaterial color={PALETTE.yellow} roughness={0.9} />
        </mesh>
        <mesh name="rugPullMedallion" position={[0, 0.024, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[RUG_HALF_Z * 0.38, 18]} />
          <meshStandardMaterial color={PALETTE.cream} roughness={0.92} />
        </mesh>
        {[-1, 1].map((side) =>
          Array.from({ length: RUG_FRINGE_COUNT }, (_, index) => (
            <mesh
              key={`${side}-${index}`}
              name={`rugPullFringe${side}_${index}`}
              position={[
                lerp(-RUG_HALF_X * 0.9, RUG_HALF_X * 0.9, index / (RUG_FRINGE_COUNT - 1)),
                0.012,
                side * (RUG_HALF_Z + 0.05),
              ]}
            >
              <boxGeometry args={[0.05, 0.012, 0.1]} />
              <meshStandardMaterial color={PALETTE.cream} roughness={0.95} />
            </mesh>
          )),
        )}
      </group>
    </group>
  );
}
