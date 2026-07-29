"use client";
import { CuboidCollider, RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Color,
  Euler,
  Matrix4,
  Quaternion,
  Vector3,
  type Group,
  type InstancedMesh,
} from "three";
import { AudioManager } from "@/lib/audio/AudioManager";
import { PALETTE, PLAYER } from "@/lib/game/constants";
import { createSeededRandom, lerp } from "@/lib/game/seed";
import { TRAP_CATALOG } from "@/lib/game/trap-catalog";
import type { HazardContact, TrapInstance } from "@/lib/game/types";
import type { TrapMechanicEvent } from "@/components/game/TrapRenderer";

/**
 * Four traps that act on the player through forces rather than through a
 * collider sweep. They take the same props as every trap in TrapRenderer.
 *
 * Two conventions carried over from the traps that already ship:
 *
 * - Rapier accumulates `addForce` and nothing here ever resets it, so a
 *   per-frame `addForce` compounds without bound. Every sustained push below
 *   is `applyImpulse(force * step)` with `step` clamped, which is one-shot and
 *   independent of the display refresh rate.
 * - The floor fan applies its catalog force as a raw impulse per second, which
 *   makes the resulting acceleration depend on the mass of whatever it hits.
 *   The sprinkler's `push` follows it so the two land in the same tuned range.
 *   The magnet needs a guaranteed escape margin instead, so it converts
 *   through the player's real mass; the reasoning is recorded there.
 */
interface ForceTrapProps {
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

function isLive(body: RapierRigidBody | null | undefined): body is RapierRigidBody {
  if (!body) return false;
  try {
    return body.isValid();
  } catch {
    return false;
  }
}

/**
 * Placements carry the catalog defaults in `params`, so the instance wins and
 * the catalog is the fallback. `fallback` only covers a key neither source
 * defines, which would otherwise silently switch the trap off.
 */
function trapNumber(trap: TrapInstance, key: string, fallback: number): number {
  const placed = trap.params[key];
  if (typeof placed === "number") return placed;
  const preset = TRAP_CATALOG[trap.type].defaultParams[key];
  return typeof preset === "number" ? preset : fallback;
}

function contact(
  trap: TrapInstance,
  onHazard: ForceTrapProps["onHazard"],
  impulse: number,
) {
  // Per-trap voice. The mousetrap previously shared the spring pad's cue, so a
  // violent snap and a helpful boost sounded identical.
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
  onMechanic: ForceTrapProps["onMechanic"],
  event: string,
  magnitude = 0,
) {
  onMechanic?.({ trapType: trap.type, event, magnitude });
}

function useRegisterTrapBody(
  body: React.RefObject<RapierRigidBody | null>,
  trapBodies: ForceTrapProps["trapBodies"],
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

/** Seconds since the attempt began. Every animation phase derives from this. */
function elapsedSeconds(startedAt: number): number {
  return Math.max(0, performance.now() - startedAt) / 1000;
}

/** Shortest signed angle from `from` to `to`, in radians. */
function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

// ---------------------------------------------------------------------------
// Mousetrap
// ---------------------------------------------------------------------------

const MOUSETRAP_SNAP_FALLBACK = 11;
/** Horizontal trigger radius. Vertical clearance lets a jump sail over it. */
const MOUSETRAP_TRIGGER_RADIUS = 0.9;
const MOUSETRAP_TRIGGER_HEIGHT = 1.6;
/** The bar covers its 180 degrees in this long, which is faster than a blink. */
const MOUSETRAP_SNAP_MS = 110;
const MOUSETRAP_BAR_PIVOT_Y = 0.17;
const MOUSETRAP_BAR_PIVOT_Z = -0.4;
const MOUSETRAP_BAR_LENGTH = 0.74;
/** A little forward shove so the launch is not a pure vertical pop. */
const MOUSETRAP_FORWARD_KICK = 2.4;
const MOUSETRAP_COIL_COUNT = 10;
const MOUSETRAP_COILS_PER_SIDE = MOUSETRAP_COIL_COUNT / 2;

export function MousetrapTrap({
  trap,
  player,
  trapBodies,
  startedAt,
  onHazard,
  onMechanic,
}: ForceTrapProps) {
  const body = useRef<RapierRigidBody>(null);
  useRegisterTrapBody(body, trapBodies, trap.id);
  const bar = useRef<Group>(null);
  const armed = useRef(true);
  const snappedAt = useRef(0);
  const snap = useMemo(
    () => trapNumber(trap, "snap", MOUSETRAP_SNAP_FALLBACK),
    [trap],
  );
  // A retry re-arms the trap. The trap tree is usually remounted between
  // attempts, but a fresh startedAt on the same mount has to re-arm too or the
  // second run walks over a trap that is already sprung.
  useEffect(() => {
    armed.current = true;
    snappedAt.current = 0;
  }, [startedAt]);

  const setCoils = useCallback((coils: InstancedMesh | null) => {
    if (!coils) return;
    const matrix = new Matrix4();
    for (let index = 0; index < MOUSETRAP_COIL_COUNT; index += 1) {
      const side = index < MOUSETRAP_COILS_PER_SIDE ? -1 : 1;
      const rank = index % MOUSETRAP_COILS_PER_SIDE;
      // A torus lies in XY with its axis along Z, so turn it to spool along X.
      matrix.makeRotationY(Math.PI / 2);
      matrix.setPosition(side * (0.42 + rank * 0.055), 0, 0);
      coils.setMatrixAt(index, matrix);
    }
    coils.instanceMatrix.needsUpdate = true;
  }, []);

  useFrame(() => {
    const target = player.current;
    const now = performance.now();
    if (isLive(target) && armed.current) {
      const p = target.translation();
      const reach = Math.hypot(
        p.x - trap.position[0],
        p.z - trap.position[2],
      );
      if (
        reach < MOUSETRAP_TRIGGER_RADIUS &&
        p.y - trap.position[1] < MOUSETRAP_TRIGGER_HEIGHT
      ) {
        armed.current = false;
        snappedAt.current = now;
        target.applyImpulse(
          {
            x: Math.sin(trap.rotationY) * MOUSETRAP_FORWARD_KICK,
            y: snap,
            z: Math.cos(trap.rotationY) * MOUSETRAP_FORWARD_KICK,
          },
          true,
        );
        contact(trap, onHazard, snap);
        mechanic(trap, onMechanic, "mousetrap_snap", snap);
      }
    }
    const group = bar.current;
    if (!group) return;
    if (snappedAt.current === 0) {
      // Armed: a slight tremor, phase-locked so every attempt looks the same.
      group.rotation.x = Math.sin(elapsedSeconds(startedAt) * 9) * 0.014;
      return;
    }
    const progress = Math.min(1, (now - snappedAt.current) / MOUSETRAP_SNAP_MS);
    const eased = 1 - (1 - progress) ** 3;
    const rebound = Math.sin(progress * Math.PI * 2) * 0.09 * (1 - progress);
    group.rotation.x = -(Math.PI * eased + rebound);
  }, TRAP_FRAME_PRIORITY);

  return (
    <RigidBody
      ref={body}
      type="fixed"
      colliders={false}
      position={[trap.position[0], trap.position[1], trap.position[2]]}
      rotation={[0, trap.rotationY, 0]}
    >
      <CuboidCollider args={[0.75, 0.07, 0.5]} position={[0, 0.07, 0]} />
      {/* The board reads as 1.5x1.0, but MOUSETRAP_TRIGGER_RADIUS is a circle
          that reaches past every edge, so the ring is what actually warns. */}
      <mesh name="mousetrapTriggerZone" position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[MOUSETRAP_TRIGGER_RADIUS - 0.1, MOUSETRAP_TRIGGER_RADIUS, 32]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.6} />
      </mesh>
      <mesh name="mousetrapBoard" receiveShadow position={[0, 0.07, 0]}>
        <boxGeometry args={[1.5, 0.14, 1]} />
        <meshStandardMaterial color={PALETTE.orange} roughness={0.88} />
      </mesh>
      <mesh name="mousetrapBoardEdge" position={[0, 0.145, 0]}>
        <boxGeometry args={[1.42, 0.02, 0.92]} />
        <meshStandardMaterial color={PALETTE.cream} roughness={0.85} />
      </mesh>
      <mesh name="mousetrapBaitPlate" position={[0, 0.17, 0.16]}>
        <cylinderGeometry args={[0.19, 0.19, 0.04, 12]} />
        <meshStandardMaterial color={PALETTE.red} roughness={0.72} />
      </mesh>
      <mesh name="mousetrapCheese" position={[0, 0.24, 0.16]}>
        <cylinderGeometry args={[0.15, 0.15, 0.1, 10, 1, false, 0, Math.PI / 2]} />
        <meshStandardMaterial color={PALETTE.yellow} roughness={0.75} />
      </mesh>
      <mesh name="mousetrapCatchArm" position={[0, 0.2, 0.42]}>
        <boxGeometry args={[0.06, 0.06, 0.3]} />
        <meshStandardMaterial color={PALETTE.muted} roughness={0.6} metalness={0.2} />
      </mesh>
      <instancedMesh
        name="mousetrapSpringCoils"
        ref={setCoils}
        castShadow
        args={[undefined, undefined, MOUSETRAP_COIL_COUNT]}
        position={[0, MOUSETRAP_BAR_PIVOT_Y, MOUSETRAP_BAR_PIVOT_Z]}
      >
        <torusGeometry args={[0.13, 0.035, 6, 12]} />
        <meshStandardMaterial color={PALETTE.muted} roughness={0.55} metalness={0.25} />
      </instancedMesh>
      <group
        ref={bar}
        name="mousetrapBar"
        position={[0, MOUSETRAP_BAR_PIVOT_Y, MOUSETRAP_BAR_PIVOT_Z]}
      >
        <mesh
          name="mousetrapBarLeftArm"
          castShadow
          position={[-0.52, 0, MOUSETRAP_BAR_LENGTH / 2]}
        >
          <boxGeometry args={[0.07, 0.07, MOUSETRAP_BAR_LENGTH]} />
          <meshStandardMaterial color={PALETTE.blue} roughness={0.7} metalness={0.15} />
        </mesh>
        <mesh
          name="mousetrapBarRightArm"
          castShadow
          position={[0.52, 0, MOUSETRAP_BAR_LENGTH / 2]}
        >
          <boxGeometry args={[0.07, 0.07, MOUSETRAP_BAR_LENGTH]} />
          <meshStandardMaterial color={PALETTE.blue} roughness={0.7} metalness={0.15} />
        </mesh>
        <mesh
          name="mousetrapBarCross"
          castShadow
          position={[0, 0, MOUSETRAP_BAR_LENGTH]}
        >
          <boxGeometry args={[1.11, 0.07, 0.07]} />
          <meshStandardMaterial color={PALETTE.blue} roughness={0.7} metalness={0.15} />
        </mesh>
        <mesh name="mousetrapBarHinge" rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.05, 0.05, 1.14, 10]} />
          <meshStandardMaterial color={PALETTE.muted} roughness={0.55} metalness={0.25} />
        </mesh>
      </group>
    </RigidBody>
  );
}

// ---------------------------------------------------------------------------
// Sprinkler
// ---------------------------------------------------------------------------

const SPRINKLER_SWEEP_FALLBACK = 1.3;
const SPRINKLER_PUSH_FALLBACK = 14;
/** How far the fan of water reaches. The catalog carries no range for this. */
const SPRINKLER_RANGE = 3.2;
/** Half the fan's opening: 24 degrees each side of the nozzle heading. */
const SPRINKLER_ARC_HALF = 0.42;
/** Inside this the player is under the head, where the jet has not landed. */
const SPRINKLER_MIN_RADIUS = 0.35;
const SPRINKLER_HEAD_Y = 0.62;
/** Wet floor outlasts the arc, so the sweep leaves a slick behind it. */
/** Jumping clears the spray, like banana (1.15), mop (1.3) and mousetrap (1.6). */
const SPRINKLER_MAX_HEIGHT = 1.4;
// Was 1100ms. Soaking for longer than the arc takes to sweep past meant the
// push (13 m/s^2 at close range) beat the player's own soaked authority of 7.2,
// so inside 2u the trap disabled you below its own force and input stopped
// mattering. One sweep of soak, not two.
const SPRINKLER_SOAK_MS = 600;
/**
 * GameScene turns every hazard contact into 250-500ms of stun. Reporting on
 * the fan's 450ms cadence would leave the player stunned almost continuously,
 * so the sprinkler reports less often than it pushes.
 */
const SPRINKLER_REPORT_MS = 700;
const SPRINKLER_DROPLET_COUNT = 14;
const SPRINKLER_DROPLET_SPEED = 0.62;
const SPRINKLER_ARC_RADII = [1.1, 2, 2.9] as const;

export function SprinklerTrap({
  trap,
  player,
  soapUntilRef,
  trapBodies,
  startedAt,
  onHazard,
  onMechanic,
}: ForceTrapProps) {
  const body = useRef<RapierRigidBody>(null);
  useRegisterTrapBody(body, trapBodies, trap.id);
  const head = useRef<Group>(null);
  const droplets = useRef<InstancedMesh>(null);
  const lastReport = useRef(0);
  const params = useMemo(
    () => ({
      sweep: trapNumber(trap, "sweep", SPRINKLER_SWEEP_FALLBACK),
      push: trapNumber(trap, "push", SPRINKLER_PUSH_FALLBACK),
    }),
    [trap],
  );
  // Lanes and phases are drawn once from the seed, so the spray pattern is the
  // same on every attempt instead of being redrawn on each re-render.
  const jets = useMemo(() => {
    const random = createSeededRandom(trap.seed);
    return Array.from({ length: SPRINKLER_DROPLET_COUNT }, () => ({
      lane: lerp(-1, 1, random()),
      phase: random(),
      rate: lerp(0.85, 1.3, random()),
    }));
  }, [trap.seed]);
  const scratch = useMemo(
    () => ({
      matrix: new Matrix4(),
      position: new Vector3(),
      quaternion: new Quaternion(),
      scale: new Vector3(),
    }),
    [],
  );

  useFrame((_, delta) => {
    const elapsed = elapsedSeconds(startedAt);
    // Phase-locked to the attempt clock rather than accumulated per frame, so
    // the arc is in the same place at the same moment on every run.
    const spin = elapsed * params.sweep;
    if (head.current) head.current.rotation.y = spin;

    const mesh = droplets.current;
    if (mesh) {
      jets.forEach((jet, index) => {
        const travel = (jet.phase + elapsed * SPRINKLER_DROPLET_SPEED * jet.rate) % 1;
        const radius =
          SPRINKLER_MIN_RADIUS + travel * (SPRINKLER_RANGE - SPRINKLER_MIN_RADIUS);
        const bearing = jet.lane * SPRINKLER_ARC_HALF;
        scratch.position.set(
          Math.sin(bearing) * radius,
          Math.sin(travel * Math.PI) * 0.34 - travel * travel * 0.58,
          Math.cos(bearing) * radius,
        );
        const size = lerp(0.058, 0.03, travel);
        scratch.scale.set(size, size, size);
        scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
        mesh.setMatrixAt(index, scratch.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }

    const target = player.current;
    if (!isLive(target)) return;
    const p = target.translation();
    const dx = p.x - trap.position[0];
    const dz = p.z - trap.position[2];
    const distance = Math.hypot(dx, dz);
    if (distance < SPRINKLER_MIN_RADIUS || distance > SPRINKLER_RANGE) return;
    // Every other new trap gates on player height; this one tested horizontal
    // distance only, so it shoved a player mid-jump who has 2.52 m/s^2 of air
    // authority against 13 m/s^2 of push, with nothing they could do. Water
    // does not reach over your head.
    if (p.y - trap.position[1] > SPRINKLER_MAX_HEIGHT) return;
    const heading = trap.rotationY + spin;
    if (Math.abs(angleDelta(heading, Math.atan2(dx, dz))) > SPRINKLER_ARC_HALF) return;
    const step = Math.min(delta, MAX_STEP);
    const force = params.push * (1 - distance / SPRINKLER_RANGE);
    // The push is radially outward, so the trap always shoves the player clear
    // of its own arc rather than holding them in it.
    target.applyImpulse(
      {
        x: (dx / distance) * force * step,
        y: 0.5 * step,
        z: (dz / distance) * force * step,
      },
      true,
    );
    const now = performance.now();
    soapUntilRef.current = Math.max(soapUntilRef.current, now + SPRINKLER_SOAK_MS);
    if (now - lastReport.current > SPRINKLER_REPORT_MS) {
      lastReport.current = now;
      contact(trap, onHazard, force);
      mechanic(trap, onMechanic, "sprinkler_soaked", force);
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
      <CuboidCollider args={[0.3, 0.24, 0.3]} position={[0, 0.24, 0]} />
      <mesh name="sprinklerBase" receiveShadow position={[0, 0.06, 0]}>
        <cylinderGeometry args={[0.32, 0.36, 0.12, 14]} />
        <meshStandardMaterial color={PALETTE.ink} roughness={0.85} />
      </mesh>
      <mesh name="sprinklerCollar" position={[0, 0.15, 0]}>
        <cylinderGeometry args={[0.16, 0.22, 0.08, 12]} />
        <meshStandardMaterial color={PALETTE.green} roughness={0.8} />
      </mesh>
      <mesh name="sprinklerRiser" castShadow position={[0, 0.39, 0]}>
        <cylinderGeometry args={[0.075, 0.085, 0.48, 10]} />
        <meshStandardMaterial color={PALETTE.muted} roughness={0.7} metalness={0.15} />
      </mesh>
      <group ref={head} name="sprinklerHead" position={[0, SPRINKLER_HEAD_Y, 0]}>
        <mesh name="sprinklerHub" castShadow>
          <sphereGeometry args={[0.14, 12, 10]} />
          <meshStandardMaterial color={PALETTE.blue} roughness={0.7} />
        </mesh>
        <mesh name="sprinklerNozzleArm" castShadow position={[0, 0.02, 0.19]}>
          <boxGeometry args={[0.08, 0.08, 0.28]} />
          <meshStandardMaterial color={PALETTE.cream} roughness={0.78} />
        </mesh>
        <mesh
          name="sprinklerNozzleTip"
          position={[0, 0.05, 0.36]}
          rotation={[Math.PI / 2.6, 0, 0]}
        >
          <coneGeometry args={[0.08, 0.16, 10]} />
          <meshStandardMaterial color={PALETTE.yellow} roughness={0.7} />
        </mesh>
        <mesh name="sprinklerDeflector" position={[0, 0.13, -0.14]} rotation={[0.5, 0, 0]}>
          <boxGeometry args={[0.22, 0.12, 0.03]} />
          <meshStandardMaterial color={PALETTE.red} roughness={0.75} />
        </mesh>
        {SPRINKLER_ARC_RADII.map((radius, index) => (
          <mesh
            key={radius}
            name={`sprinklerWaterArc${index}`}
            position={[0, 0.18 - index * 0.22, 0]}
            rotation={[Math.PI / 2, 0, Math.PI / 2 - SPRINKLER_ARC_HALF]}
          >
            <torusGeometry args={[radius, 0.032, 6, 20, SPRINKLER_ARC_HALF * 2]} />
            <meshBasicMaterial
              color="#8fe3ff"
              transparent
              opacity={0.72 - index * 0.14}
              depthWrite={false}
            />
          </mesh>
        ))}
        <instancedMesh
          name="sprinklerDroplets"
          ref={droplets}
          // Instances travel metres away from an origin-sized geometry, which
          // the default cull test does not account for.
          frustumCulled={false}
          args={[undefined, undefined, SPRINKLER_DROPLET_COUNT]}
        >
          <sphereGeometry args={[1, 8, 6]} />
          <meshBasicMaterial color="#d6f4ff" transparent opacity={0.9} depthWrite={false} />
        </instancedMesh>
      </group>
    </RigidBody>
  );
}

// ---------------------------------------------------------------------------
// Laundry basket
// ---------------------------------------------------------------------------

const SOCK_COUNT_FALLBACK = 5;
const SOCK_COUNT_LIMIT = 10;
/** Set on the collider, not the rigid body: see the note in SockBody. */
const SOCK_MASS = 0.2;
const SOCK_HALF_EXTENTS: readonly [number, number, number] = [0.17, 0.09, 0.1];
const SOCK_COLORS = [PALETTE.red, PALETTE.blue, PALETTE.green, PALETTE.yellow, PALETTE.purple] as const;
/** How far the basket leans over. Zero would stand it upright. */
const BASKET_TIP = 1.18;
const BASKET_WEAVE_COUNT = 12;
const BASKET_WEAVE_PER_SIDE = BASKET_WEAVE_COUNT / 2;

interface SockPlacement {
  id: string;
  position: readonly [number, number, number];
  rotation: readonly [number, number, number];
  color: string;
}

function SockBody({
  sock,
  grabbables,
  trapBodies,
}: {
  sock: SockPlacement;
  grabbables: ForceTrapProps["grabbables"];
  trapBodies: ForceTrapProps["trapBodies"];
}) {
  const body = useRef<RapierRigidBody>(null);
  // Registered from an effect rather than from a ref callback: a callback
  // declared in the render body changes identity every render, which makes
  // React drop and re-add the entry on each of the HUD's 20 ticks a second.
  useEffect(() => {
    const grabbable = grabbables.current;
    const bodies = trapBodies.current;
    const rigid = body.current;
    if (rigid) {
      grabbable.set(sock.id, rigid);
      bodies.set(sock.id, rigid);
    }
    return () => {
      grabbable.delete(sock.id);
      bodies.delete(sock.id);
    };
  }, [sock.id, grabbables, trapBodies]);
  return (
    <RigidBody
      ref={body}
      type="dynamic"
      colliders={false}
      position={[sock.position[0], sock.position[1], sock.position[2]]}
      rotation={[sock.rotation[0], sock.rotation[1], sock.rotation[2]]}
      restitution={0.42}
      friction={0.5}
      canSleep
    >
      {/* @react-three/rapier 2.2.0 strips `mass` from rigid body props before
          they reach a collider and never applies it to the body itself, so the
          mass has to be declared on the collider to take effect at all. */}
      <CuboidCollider args={[...SOCK_HALF_EXTENTS]} mass={SOCK_MASS} />
      <mesh name="sockFoot" castShadow rotation={[0, 0, Math.PI / 2]}>
        <capsuleGeometry args={[0.088, 0.15, 4, 8]} />
        <meshStandardMaterial color={sock.color} roughness={0.9} />
      </mesh>
      <mesh name="sockCuff" castShadow position={[0.11, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.098, 0.098, 0.07, 10]} />
        <meshStandardMaterial color={PALETTE.cream} roughness={0.9} />
      </mesh>
    </RigidBody>
  );
}

export function LaundryBasketTrap({
  trap,
  grabbables,
  trapBodies,
  startedAt,
  onMechanic,
}: ForceTrapProps) {
  const body = useRef<RapierRigidBody>(null);
  useRegisterTrapBody(body, trapBodies, trap.id);
  const spillReported = useRef(false);
  const socks = useMemo<readonly SockPlacement[]>(() => {
    const random = createSeededRandom(trap.seed);
    const count = Math.max(
      1,
      Math.min(SOCK_COUNT_LIMIT, Math.round(trapNumber(trap, "socks", SOCK_COUNT_FALLBACK))),
    );
    const forwardX = Math.sin(trap.rotationY);
    const forwardZ = Math.cos(trap.rotationY);
    return Array.from({ length: count }, (_, index) => {
      // Spilled out of the mouth: a spread of bearings at mixed distances,
      // stacked a little so the pile settles instead of interpenetrating.
      const bearing = lerp(-0.75, 0.75, random());
      const reach = lerp(0.55, 1.45, random());
      const offsetX = Math.sin(bearing) * reach;
      const offsetZ = Math.cos(bearing) * reach;
      return {
        id: `${trap.id}_sock_${index}`,
        position: [
          trap.position[0] + forwardX * offsetZ + forwardZ * offsetX,
          trap.position[1] + 0.16 + index * 0.055,
          trap.position[2] + forwardZ * offsetZ - forwardX * offsetX,
        ] as const,
        rotation: [
          lerp(-0.6, 0.6, random()),
          lerp(-Math.PI, Math.PI, random()),
          lerp(-0.6, 0.6, random()),
        ] as const,
        color: SOCK_COLORS[index % SOCK_COLORS.length] ?? PALETTE.cream,
      };
    });
  }, [trap]);

  // Rigid body position props only apply when the body is created, so a retry
  // on the same mount would inherit wherever the socks were kicked to. Putting
  // them back on every startedAt makes the pile identical at every attempt.
  useEffect(() => {
    const rotation = new Quaternion();
    for (const sock of socks) {
      const rigid = trapBodies.current.get(sock.id);
      if (!isLive(rigid)) continue;
      rotation.setFromEuler(
        new Euler(sock.rotation[0], sock.rotation[1], sock.rotation[2]),
      );
      rigid.setTranslation(
        { x: sock.position[0], y: sock.position[1], z: sock.position[2] },
        true,
      );
      rigid.setRotation(rotation, true);
      rigid.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rigid.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }, [startedAt, socks, trapBodies]);

  useEffect(() => {
    if (spillReported.current) return;
    spillReported.current = true;
    mechanic(trap, onMechanic, "socks_spilled", socks.length);
  }, [trap, onMechanic, socks.length]);

  const setWeave = useCallback((weave: InstancedMesh | null) => {
    if (!weave) return;
    const matrix = new Matrix4();
    for (let index = 0; index < BASKET_WEAVE_COUNT; index += 1) {
      const side = index < BASKET_WEAVE_PER_SIDE ? -1 : 1;
      const rank = index % BASKET_WEAVE_PER_SIDE;
      matrix.identity();
      matrix.setPosition(-0.34 + rank * 0.136, 0.32, side * 0.33);
      weave.setMatrixAt(index, matrix);
    }
    weave.instanceMatrix.needsUpdate = true;
  }, []);

  return (
    <>
      <RigidBody
        ref={body}
        type="fixed"
        colliders={false}
        position={[trap.position[0], trap.position[1], trap.position[2]]}
        rotation={[0, trap.rotationY, 0]}
      >
        <CuboidCollider
          args={[0.47, 0.32, 0.37]}
          position={[0, 0.34, -0.06]}
          rotation={[BASKET_TIP, 0, 0]}
        />
        <group name="laundryBasket" position={[0, 0.34, -0.06]} rotation={[BASKET_TIP, 0, 0]}>
          <mesh name="basketFloor" receiveShadow position={[0, -0.29, 0]}>
            <boxGeometry args={[0.9, 0.06, 0.7]} />
            <meshStandardMaterial color={PALETTE.cream} roughness={0.9} />
          </mesh>
          <mesh name="basketWallLeft" castShadow position={[-0.44, 0, 0]}>
            <boxGeometry args={[0.05, 0.62, 0.7]} />
            <meshStandardMaterial color={PALETTE.cream} roughness={0.9} />
          </mesh>
          <mesh name="basketWallRight" castShadow position={[0.44, 0, 0]}>
            <boxGeometry args={[0.05, 0.62, 0.7]} />
            <meshStandardMaterial color={PALETTE.cream} roughness={0.9} />
          </mesh>
          <mesh name="basketRimFront" castShadow position={[0, 0.29, 0.33]}>
            <boxGeometry args={[0.94, 0.07, 0.07]} />
            <meshStandardMaterial color={PALETTE.blue} roughness={0.82} />
          </mesh>
          <mesh name="basketRimBack" castShadow position={[0, 0.29, -0.33]}>
            <boxGeometry args={[0.94, 0.07, 0.07]} />
            <meshStandardMaterial color={PALETTE.blue} roughness={0.82} />
          </mesh>
          <instancedMesh
            name="basketWeaveSlats"
            ref={setWeave}
            castShadow
            args={[undefined, undefined, BASKET_WEAVE_COUNT]}
            position={[0, -0.32, 0]}
          >
            <boxGeometry args={[0.06, 0.58, 0.05]} />
            <meshStandardMaterial color={PALETTE.cream} roughness={0.9} />
          </instancedMesh>
        </group>
      </RigidBody>
      {socks.map((sock) => (
        <SockBody
          key={sock.id}
          sock={sock}
          grabbables={grabbables}
          trapBodies={trapBodies}
        />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Magnet
// ---------------------------------------------------------------------------

const MAGNET_PULL_FALLBACK = 16;
const MAGNET_RANGE_FALLBACK = 3.4;
/**
 * The pull is read as a target acceleration and converted through the player's
 * real mass, because the impulse a given speed change costs depends on it.
 *
 * PlayerController corrects horizontal velocity toward the input target by at
 * most PLAYER.acceleration per second on dry ground, so a pull capped at 60%
 * of that always leaves the runner a net margin to walk out on. The cap only
 * binds if a placement raises `pull` past it; the catalog default of 16 sits
 * just under.
 */
const MAGNET_ACCELERATION_CAP = PLAYER.acceleration * 0.6;
/** Inside the magnet's own body the pull would only buzz against the collider. */
const MAGNET_DEAD_ZONE = 0.55;
/** Leaving needs more than a hair past the rim before the trap can re-report. */
const MAGNET_RELEASE_MARGIN = 1.15;
const MAGNET_RING_COUNT = 5;
const MAGNET_RING_MIN = 0.5;
const MAGNET_PULSE_RATE = 0.55;
const MAGNET_FIELD_COLOR = new Color(PALETTE.purple);

export function MagnetTrap({
  trap,
  player,
  trapBodies,
  startedAt,
  onHazard,
  onMechanic,
}: ForceTrapProps) {
  const body = useRef<RapierRigidBody>(null);
  useRegisterTrapBody(body, trapBodies, trap.id);
  const rings = useRef<InstancedMesh>(null);
  const held = useRef(false);
  const params = useMemo(
    () => ({
      pull: trapNumber(trap, "pull", MAGNET_PULL_FALLBACK),
      range: trapNumber(trap, "range", MAGNET_RANGE_FALLBACK),
    }),
    [trap],
  );
  // Grabbing the player is a one-shot per approach. GameScene stuns on every
  // hazard contact and a stunned player keeps only a quarter of their
  // acceleration, so a repeating report would hold them here indefinitely.
  useEffect(() => {
    held.current = false;
  }, [startedAt]);
  const scratch = useMemo(
    () => ({
      matrix: new Matrix4(),
      position: new Vector3(),
      quaternion: new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0)),
      scale: new Vector3(),
      color: new Color(),
    }),
    [],
  );

  useFrame((_, delta) => {
    const elapsed = elapsedSeconds(startedAt);
    const mesh = rings.current;
    if (mesh) {
      for (let index = 0; index < MAGNET_RING_COUNT; index += 1) {
        const wave = (elapsed * MAGNET_PULSE_RATE + index / MAGNET_RING_COUNT) % 1;
        const radius = MAGNET_RING_MIN + wave * (params.range - MAGNET_RING_MIN);
        scratch.position.set(0, 0.08 + wave * 0.22, 0);
        scratch.scale.set(radius, radius, radius);
        scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
        mesh.setMatrixAt(index, scratch.matrix);
        // Normal blending now: additive plus toneMapped={false} clipped to
        // white on the light decks and the ring never showed. Dimming toward
        // black no longer fades to nothing, it darkens, which is visible
        // rather than invisible and is the trade this fix is making.
        mesh.setColorAt(
          index,
          scratch.color.copy(MAGNET_FIELD_COLOR).multiplyScalar(Math.sin(wave * Math.PI)),
        );
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    const target = player.current;
    if (!isLive(target)) return;
    const p = target.translation();
    const dx = trap.position[0] - p.x;
    const dz = trap.position[2] - p.z;
    const distance = Math.hypot(dx, dz);
    if (distance > params.range * MAGNET_RELEASE_MARGIN) held.current = false;
    if (distance > params.range || distance < MAGNET_DEAD_ZONE) return;
    const mass = target.mass();
    if (mass <= 0) return;
    const acceleration = Math.min(
      params.pull * (1 - distance / params.range),
      MAGNET_ACCELERATION_CAP,
    );
    const impulse = acceleration * mass * Math.min(delta, MAX_STEP);
    target.applyImpulse(
      { x: (dx / distance) * impulse, y: 0, z: (dz / distance) * impulse },
      true,
    );
    if (!held.current) {
      held.current = true;
      contact(trap, onHazard, params.pull);
      mechanic(trap, onMechanic, "magnet_grabbed", acceleration);
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
      <CuboidCollider args={[0.58, 0.55, 0.18]} position={[0, 0.55, 0]} />
      <mesh name="magnetPlinth" receiveShadow position={[0, 0.05, 0]}>
        <boxGeometry args={[1.1, 0.1, 0.5]} />
        <meshStandardMaterial color={PALETTE.ink} roughness={0.85} />
      </mesh>
      <mesh name="magnetArch" castShadow position={[0, 0.62, 0]} rotation={[0, 0, Math.PI]}>
        <torusGeometry args={[0.42, 0.16, 10, 18, Math.PI]} />
        <meshStandardMaterial color={PALETTE.red} roughness={0.72} metalness={0.12} />
      </mesh>
      <mesh name="magnetLegLeft" castShadow position={[-0.42, 0.79, 0]}>
        <cylinderGeometry args={[0.16, 0.16, 0.34, 12]} />
        <meshStandardMaterial color={PALETTE.red} roughness={0.72} metalness={0.12} />
      </mesh>
      <mesh name="magnetLegRight" castShadow position={[0.42, 0.79, 0]}>
        <cylinderGeometry args={[0.16, 0.16, 0.34, 12]} />
        <meshStandardMaterial color={PALETTE.red} roughness={0.72} metalness={0.12} />
      </mesh>
      <mesh name="magnetPoleNorth" castShadow position={[-0.42, 1.03, 0]}>
        <cylinderGeometry args={[0.165, 0.165, 0.15, 12]} />
        <meshStandardMaterial color={PALETTE.cream} roughness={0.6} metalness={0.3} />
      </mesh>
      <mesh name="magnetPoleSouth" castShadow position={[0.42, 1.03, 0]}>
        <cylinderGeometry args={[0.165, 0.165, 0.15, 12]} />
        <meshStandardMaterial color={PALETTE.blue} roughness={0.6} metalness={0.3} />
      </mesh>
      <instancedMesh
        name="magnetFieldRings"
        ref={rings}
        // The rings scale out to the full pull radius from a unit geometry.
        frustumCulled={false}
        args={[undefined, undefined, MAGNET_RING_COUNT]}
      >
        <torusGeometry args={[1, 0.022, 6, 30]} />
        <meshBasicMaterial transparent depthWrite={false} />
      </instancedMesh>
    </RigidBody>
  );
}
