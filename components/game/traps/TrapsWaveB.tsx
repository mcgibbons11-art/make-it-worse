"use client";
import { useFrame } from "@react-three/fiber";
import {
  BallCollider,
  CuboidCollider,
  RigidBody,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import type { Group, Mesh, MeshBasicMaterial } from "three";
import { AudioManager } from "@/lib/audio/AudioManager";
import { PALETTE } from "@/lib/game/constants";
import { createSeededRandom, lerp } from "@/lib/game/seed";
import { TRAP_CATALOG } from "@/lib/game/trap-catalog";
import { WAVE_B_HAZARD, WAVE_B_SCHEDULE } from "@/lib/game/traps-wave-b";
import type { HazardContact, TrapInstance } from "@/lib/game/types";
import { useSettingsStore } from "@/stores/settings-store";
import {
  BallMachine,
  BathroomScalesBase,
  BathroomScalesPlate,
  ClothesAirer,
  CrockeryStack,
  CuckooBird,
  CuckooClock,
  EggTimer,
  FishBowl,
  HobRing,
  HotPotato,
  IceCube,
  IceDispenser,
  JunkDrift,
  Kettle,
  PEDAL_BIN_LID_HINGE,
  PedalBinBody,
  PedalBinLid,
  PracticeBall,
  PressCamera,
  ShoeRack,
  SwingDoorJamb,
  SwingDoorLeaf,
  ThrownShoe,
} from "./TrapProps";
import type { TrapMechanicEvent } from "../TrapRenderer";

/**
 * Wave B. Sixteen traps chosen for verbs the roster did not have. The first
 * twenty-two sweep, launch, push, slip, chase, pull, spray, snap, aim-then-drop,
 * burst, brake, gate on speed, gate on a clock and arm on contact. These take
 * the view away, punish the takeoff rather than the landing, defer the payment,
 * only touch a runner who is already reeling, change what every later trap does
 * by making the runner light, strike after the runner thinks they are past,
 * lead the target, hide a strike inside a rhythm, grow on every miss, stamp the
 * spot the runner has already left, wait to be picked up, leave the middle of
 * the circle safe, ignore runners and catch dodgers, spend one magazine, arm on
 * the attempt clock, and feed on their neighbours.
 *
 * Conventions carried over from the traps that already ship:
 *
 * - TrapRenderer keeps its TrapProps interface local to that file, so the same
 *   shape is declared again here rather than exported from there.
 * - Rapier accumulates `addForce` and nothing in this project resets it, so
 *   every sustained push is `applyImpulse(force * step)` with `step` clamped:
 *   one-shot, and independent of the display refresh rate.
 * - Every schedule is a pure function of the time since the attempt began, or
 *   of a contact the runner made, so a retry replays the same timing.
 * - Every ground marker is sized from the same named constant the hit test
 *   uses, in PALETTE.danger, which is reserved for hazard reach.
 *
 * PROPS ARE NOT MODELLED HERE. Every visible object is a component out of
 * traps/TrapProps.tsx, mounted by name. Props are lit, and a lit material in
 * this file would mean a prop had been built where only telegraphs belong.
 * Every trap here mounts a prop of its own: these sixteen used to share seven
 * sculpted meshes through AssetModel, so the fish bowl arrived on the course as
 * a beach ball, which is a trap a player cannot learn rather than a trap that
 * merely looks wrong. What this file does author is the ground telegraph and
 * the wind-up, which are gameplay signalling rather than set dressing and have
 * to be sized from the physics constants.
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

function isLive(body: RapierRigidBody | null | undefined): body is RapierRigidBody {
  if (!body) return false;
  try {
    return body.isValid();
  } catch {
    return false;
  }
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
 * TRAP_CATALOG is the fallback. Only reach and geometry are tunable this way:
 * the reported impulse and the repeat gate stay in WAVE_B_HAZARD, because a
 * placement that could move either would silently reprice the trap.
 */
function trapNumber(trap: TrapInstance, key: string, fallback: number): number {
  const placed = trap.params[key];
  if (typeof placed === "number" && Number.isFinite(placed)) return placed;
  const preset = TRAP_CATALOG[trap.type].defaultParams[key];
  return typeof preset === "number" && Number.isFinite(preset) ? preset : fallback;
}

/** Milliseconds since the attempt began. Every cycle below derives from it. */
function elapsedMs(startedAt: number): number {
  return Math.max(0, performance.now() - startedAt);
}

/** World-space forward of a trap, matching the convention in TrapRenderer. */
function trapForward(rotationY: number) {
  return { x: Math.sin(rotationY), z: Math.cos(rotationY) };
}

/**
 * A blink that is on for the first half of each `periodMs`. Used for the
 * committed window of several traps, so "about to land" reads the same way
 * across the file.
 */
function blink(nowMs: number, periodMs: number): number {
  return Math.floor(nowMs / (periodMs / 2)) % 2 === 0 ? 1 : 0.45;
}

// ---------------------------------------------------------------------------
// Paparazzo
// ---------------------------------------------------------------------------
// The verb is taking the read away. Everything else on the roster costs the
// runner control or position; this costs them the picture they are steering by,
// which is why it is worth placing in front of a gap rather than on one. It is
// almost harmless where the next few metres are wide and flat.
//
// The flash is drawn as a small sphere parked on the camera, inside the 0.1
// near plane, so it covers the whole frame whatever the aspect ratio is. It
// only fires at a runner close enough to be looking at it, and reduced motion
// gets a flat wash instead of a spike.

const PAPARAZZI = WAVE_B_HAZARD.paparazzi;
const PAPARAZZI_CHARGE_MS = WAVE_B_SCHEDULE.paparazzi.chargeMs;
const PAPARAZZI_FLASH_MS = WAVE_B_SCHEDULE.paparazzi.flashMs;
const PAPARAZZI_REACH_FALLBACK = 3.2;
const PAPARAZZI_BLIND_FALLBACK = 6;
const PAPARAZZI_SHOVE = 3.6;
const PAPARAZZI_LIFT = 1.2;
const PAPARAZZI_HIT_HEIGHT = 2;
const PAPARAZZI_VEIL_RADIUS = 0.35;
const PAPARAZZI_VEIL_PEAK = 0.92;
const PAPARAZZI_VEIL_CALM = 0.34;

export function PaparazziTrap({
  trap,
  player,
  trapBodies,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const body = useRef<RapierRigidBody>(null);
  useRegisterTrapBody(body, trapBodies, trap.id);
  const veil = useRef<Mesh>(null);
  const charge = useRef<Mesh>(null);
  const firedCycle = useRef(-1);
  const reach = Math.max(0.6, trapNumber(trap, "reach", PAPARAZZI_REACH_FALLBACK));
  const blindRadius = Math.max(reach, trapNumber(trap, "blind", PAPARAZZI_BLIND_FALLBACK));
  const reducedMotion = useSettingsStore((state) => state.reducedMotion);

  useEffect(() => {
    firedCycle.current = -1;
  }, [startedAt]);

  useFrame(({ camera }) => {
    const elapsed = elapsedMs(startedAt);
    const cycle = Math.floor(elapsed / PAPARAZZI.gateMs);
    const phase = elapsed % PAPARAZZI.gateMs;
    const target = player.current;
    let distance = Number.POSITIVE_INFINITY;
    if (isLive(target)) {
      const p = target.translation();
      distance = Math.hypot(p.x - trap.position[0], p.z - trap.position[2]);
    }

    if (phase >= PAPARAZZI_CHARGE_MS && firedCycle.current !== cycle) {
      firedCycle.current = cycle;
      mechanic(trap, onMechanic, "paparazzi_flash", reach);
      if (isLive(target)) {
        const p = target.translation();
        const dx = p.x - trap.position[0];
        const dz = p.z - trap.position[2];
        if (distance < reach && p.y - trap.position[1] < PAPARAZZI_HIT_HEIGHT) {
          const away = Math.max(distance, 0.2);
          target.applyImpulse(
            { x: (dx / away) * PAPARAZZI_SHOVE, y: PAPARAZZI_LIFT, z: (dz / away) * PAPARAZZI_SHOVE },
            true,
          );
          contact(trap, onHazard, PAPARAZZI.impulse);
          mechanic(trap, onMechanic, "paparazzi_hit", PAPARAZZI.impulse);
        }
      }
    }

    const since = phase - PAPARAZZI_CHARGE_MS;
    const glare =
      since >= 0 && since < PAPARAZZI_FLASH_MS && distance < blindRadius
        ? 1 - since / PAPARAZZI_FLASH_MS
        : 0;
    const mesh = veil.current;
    if (mesh) {
      mesh.visible = glare > 0.01;
      mesh.position.copy(camera.position);
      const material = mesh.material as MeshBasicMaterial;
      material.opacity = glare * (reducedMotion ? PAPARAZZI_VEIL_CALM : PAPARAZZI_VEIL_PEAK);
    }
    if (charge.current) {
      const closing = Math.min(1, phase / PAPARAZZI_CHARGE_MS);
      charge.current.visible = phase < PAPARAZZI_CHARGE_MS;
      charge.current.scale.setScalar(Math.max(0.001, closing));
    }
  }, TRAP_FRAME_PRIORITY);

  return (
    <>
      {/* Parked on the camera every frame rather than parented to it, so the
          rig is left alone. One frame of lag at the refresh rates this runs at
          is not visible, and traps update before the camera does. */}
      <mesh name="paparazziVeil" ref={veil} visible={false} renderOrder={999}>
        <sphereGeometry args={[PAPARAZZI_VEIL_RADIUS, 8, 6]} />
        <meshBasicMaterial color={PALETTE.cream} transparent opacity={0} depthTest={false} side={2} />
      </mesh>
      <group position={[trap.position[0], trap.position[1] + 0.02, trap.position[2]]}>
        <mesh name="paparazziReach" rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[reach - 0.12, reach, 48]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.6} />
        </mesh>
        {/* The blindness carries further than the shove, and it is a real cost,
            so the radius it reaches is marked too. */}
        <mesh name="paparazziBlindReach" position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[blindRadius - 0.07, blindRadius, 60]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.22} />
        </mesh>
        <mesh name="paparazziCharge" ref={charge} position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[reach - 0.14, 36]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.24} />
        </mesh>
      </group>
      <RigidBody
        ref={body}
        type="fixed"
        colliders={false}
        position={[trap.position[0], trap.position[1], trap.position[2]]}
        rotation={[0, trap.rotationY, 0]}
      >
        <CuboidCollider args={[0.3, 0.5, 0.3]} position={[0, 0.5, 0]} />
        <PressCamera />
      </RigidBody>
    </>
  );
}

// ---------------------------------------------------------------------------
// Bathroom scales
// ---------------------------------------------------------------------------
// Charges for the landing rather than the jump. Every launcher on the roster
// leaves the runner with a descent they cannot steer out of, and the pad is
// completely inert to anyone who walks across it, so the whole trap is the
// moment nobody reads: the touchdown. It compresses first, which is a fifth of
// a second to sprint off, and gives the spring pads and the toaster something
// to be aimed at.

const SCALES = WAVE_B_HAZARD.bathroom_scales;
const SCALES_COMPRESS_MS = WAVE_B_SCHEDULE.bathroomScales.compressMs;
const SCALES_SPRING_MS = WAVE_B_SCHEDULE.bathroomScales.springMs;
const SCALES_PAD_FALLBACK = 0.95;
/** Metres per second of descent that counts as a landing rather than a step. */
const SCALES_IMPACT_FALLBACK = 5;
/** The runner has to be on the pad, not sailing over it. */
const SCALES_PAD_HEIGHT = 0.9;
const SCALES_LAUNCH = 7;
const SCALES_SHOVE = 2.6;

type ScalesPhase = "flat" | "compressed" | "springing" | "resetting";

export function BathroomScalesTrap({
  trap,
  player,
  trapBodies,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const body = useRef<RapierRigidBody>(null);
  useRegisterTrapBody(body, trapBodies, trap.id);
  const plate = useRef<Group>(null);
  const dial = useRef<Mesh>(null);
  const phase = useRef<ScalesPhase>("flat");
  const phaseAt = useRef(0);
  const lastStrike = useRef(0);
  const pad = Math.max(0.4, trapNumber(trap, "pad", SCALES_PAD_FALLBACK));
  const impact = Math.max(1, trapNumber(trap, "impact", SCALES_IMPACT_FALLBACK));

  useEffect(() => {
    phase.current = "flat";
    phaseAt.current = 0;
    lastStrike.current = 0;
  }, [startedAt]);

  useFrame(() => {
    const now = performance.now();
    const target = player.current;
    let onPad = false;
    let descent = 0;
    if (isLive(target)) {
      const p = target.translation();
      onPad =
        Math.hypot(p.x - trap.position[0], p.z - trap.position[2]) < pad &&
        p.y - trap.position[1] < SCALES_PAD_HEIGHT;
      descent = Math.max(0, -target.linvel().y);
    }
    const since = now - phaseAt.current;

    if (phase.current === "flat") {
      if (onPad && descent > impact && now - lastStrike.current > SCALES.gateMs) {
        phase.current = "compressed";
        phaseAt.current = now;
        mechanic(trap, onMechanic, "scales_loaded", descent);
      }
    } else if (phase.current === "compressed" && since >= SCALES_COMPRESS_MS) {
      phase.current = "springing";
      phaseAt.current = now;
      lastStrike.current = now;
      if (onPad && isLive(target)) {
        const forward = trapForward(trap.rotationY);
        target.applyImpulse(
          {
            x: -forward.x * SCALES_SHOVE,
            y: SCALES_LAUNCH,
            z: -forward.z * SCALES_SHOVE,
          },
          true,
        );
        contact(trap, onHazard, SCALES.impulse);
        mechanic(trap, onMechanic, "scales_sprung", SCALES.impulse);
      } else {
        mechanic(trap, onMechanic, "scales_missed", 0);
      }
    } else if (phase.current === "springing" && since >= SCALES_SPRING_MS) {
      phase.current = "resetting";
      phaseAt.current = now;
    } else if (phase.current === "resetting" && now - lastStrike.current >= SCALES.gateMs) {
      phase.current = "flat";
      phaseAt.current = now;
    }

    const state = phase.current;
    const elapsedPhase = now - phaseAt.current;
    if (plate.current) {
      let squash = 0;
      if (state === "compressed") squash = Math.min(1, elapsedPhase / SCALES_COMPRESS_MS);
      else if (state === "springing")
        squash = -0.6 * Math.max(0, 1 - elapsedPhase / SCALES_SPRING_MS);
      plate.current.position.y = -squash * 0.08;
    }
    // Reads the runner's rate of descent while they are still in the air, so a
    // fast approach lights the pad before the landing rather than after it.
    if (dial.current) {
      const loading = state === "compressed";
      const closing = loading
        ? blink(elapsedPhase, 60)
        : Math.min(1, descent / impact) * (state === "flat" ? 1 : 0);
      dial.current.scale.setScalar(Math.max(0.001, closing));
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
      <CuboidCollider args={[pad * 0.7, 0.04, pad * 0.7]} position={[0, 0.04, 0]} sensor />
      {/* The pad, at the radius the landing test uses. */}
      <mesh name="bathroomScalesPad" position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[pad - 0.1, pad, 40]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.6} />
      </mesh>
      <mesh name="bathroomScalesDial" ref={dial} position={[0, 0.026, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[pad - 0.12, 32]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.34} />
      </mesh>
      {/* Only the tread plate squashes, so the base it sits on stays put. */}
      <BathroomScalesBase pad={pad} />
      <group ref={plate}>
        <BathroomScalesPlate pad={pad} />
      </group>
    </RigidBody>
  );
}

// ---------------------------------------------------------------------------
// Kitchen timer
// ---------------------------------------------------------------------------
// Separates the place from the cost. Every other trap charges the runner where
// they touched it, so the price of a bad line is paid on ground the player has
// already read. This lights a fuse on contact and collects a second and a half
// later, wherever the runner has got to by then, which is usually over the next
// gap. The marker rides the runner while it burns, so it is a countdown rather
// than an ambush.

const FUSE = WAVE_B_HAZARD.slow_fuse;
const FUSE_MS = WAVE_B_SCHEDULE.slowFuse.fuseMs;
const FUSE_RADIUS_FALLBACK = 0.9;
const FUSE_BLAST_FALLBACK = 1.2;
const FUSE_HEIGHT = 1.1;
const FUSE_SLAM = 3.4;
const FUSE_SHOVE = 3;

type FusePhase = "armed" | "lit" | "cooling";

export function SlowFuseTrap({
  trap,
  player,
  trapBodies,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const body = useRef<RapierRigidBody>(null);
  useRegisterTrapBody(body, trapBodies, trap.id);
  const marker = useRef<Group>(null);
  const countdown = useRef<Mesh>(null);
  const phase = useRef<FusePhase>("armed");
  const litAt = useRef(0);
  const radius = Math.max(0.4, trapNumber(trap, "radius", FUSE_RADIUS_FALLBACK));
  const blast = Math.max(radius, trapNumber(trap, "blast", FUSE_BLAST_FALLBACK));

  useEffect(() => {
    phase.current = "armed";
    litAt.current = 0;
  }, [startedAt]);

  useFrame(() => {
    const now = performance.now();
    const target = player.current;
    const alive = isLive(target);
    const p = alive ? target.translation() : null;

    if (phase.current === "armed" && p) {
      const near =
        Math.hypot(p.x - trap.position[0], p.z - trap.position[2]) < radius &&
        p.y - trap.position[1] < FUSE_HEIGHT;
      if (near) {
        phase.current = "lit";
        litAt.current = now;
        mechanic(trap, onMechanic, "fuse_lit", FUSE_MS);
      }
    } else if (phase.current === "lit" && now - litAt.current >= FUSE_MS) {
      phase.current = "cooling";
      if (alive && p) {
        const heading = Math.hypot(p.x - trap.position[0], p.z - trap.position[2]);
        const away = Math.max(heading, 0.2);
        target.applyImpulse(
          {
            x: ((p.x - trap.position[0]) / away) * FUSE_SHOVE,
            y: -FUSE_SLAM,
            z: ((p.z - trap.position[2]) / away) * FUSE_SHOVE,
          },
          true,
        );
        contact(trap, onHazard, FUSE.impulse);
        mechanic(trap, onMechanic, "fuse_paid", FUSE.impulse);
      }
    } else if (phase.current === "cooling" && now - litAt.current >= FUSE.gateMs) {
      phase.current = "armed";
    }

    // While it burns, the blast circle rides the runner and closes, so the cost
    // is drawn where it will actually land rather than back at the timer.
    const burning = phase.current === "lit";
    if (marker.current) {
      marker.current.visible = burning;
      if (burning && p) marker.current.position.set(p.x, trap.position[1] + 0.03, p.z);
    }
    if (countdown.current && burning) {
      const left = 1 - Math.min(1, (now - litAt.current) / FUSE_MS);
      countdown.current.scale.setScalar(Math.max(0.001, left));
    }
  }, TRAP_FRAME_PRIORITY);

  return (
    <>
      <group ref={marker} visible={false} position={[trap.position[0], trap.position[1] + 0.03, trap.position[2]]}>
        <mesh name="slowFuseBlast" rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[blast - 0.1, blast, 34]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.85} />
        </mesh>
        <mesh name="slowFuseCountdown" ref={countdown} position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[blast - 0.12, 28]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.3} />
        </mesh>
      </group>
      <RigidBody
        ref={body}
        type="fixed"
        colliders={false}
        position={[trap.position[0], trap.position[1], trap.position[2]]}
        rotation={[0, trap.rotationY, 0]}
      >
        <CuboidCollider args={[0.22, 0.22, 0.22]} position={[0, 0.22, 0]} sensor />
        {/* The ground that lights the fuse, at the radius the test uses. */}
        <mesh name="slowFuseTrigger" position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[radius, 30]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.45} />
        </mesh>
        <EggTimer radius={radius} />
      </RigidBody>
    </>
  );
}

// ---------------------------------------------------------------------------
// Crockery stack
// ---------------------------------------------------------------------------
// Harmless on its own and vicious next to anything else. It reads the same stun
// timer PlayerController reads, and it only topples on a runner who is already
// inside one. Placed alone it is a stack of plates the runner walks past all
// day; placed a metre downwind of a fan or a hammer it converts every glancing
// hit into a real one. It is the only trap here whose worth is decided by what
// its neighbour does.

const PILE = WAVE_B_HAZARD.pile_on;
const PILE_WOBBLE_MS = WAVE_B_SCHEDULE.pileOn.wobbleMs;
const PILE_TOPPLE_MS = WAVE_B_SCHEDULE.pileOn.topplesMs;
const PILE_RADIUS_FALLBACK = 1.5;
const PILE_HEIGHT = 1.6;
const PILE_SHOVE = 5.4;
const PILE_SLAM = 2.6;

type PilePhase = "watching" | "wobbling" | "toppling" | "spent";

export function PileOnTrap({
  trap,
  player,
  stunUntilRef,
  trapBodies,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const body = useRef<RapierRigidBody>(null);
  useRegisterTrapBody(body, trapBodies, trap.id);
  const stack = useRef<Group>(null);
  const live = useRef<Mesh>(null);
  const phase = useRef<PilePhase>("watching");
  const phaseAt = useRef(0);
  const lastStrike = useRef(0);
  const radius = Math.max(0.6, trapNumber(trap, "radius", PILE_RADIUS_FALLBACK));
  const lean = useMemo(() => (createSeededRandom(trap.seed)() > 0.5 ? 1 : -1), [trap.seed]);

  useEffect(() => {
    phase.current = "watching";
    phaseAt.current = 0;
    lastStrike.current = 0;
  }, [startedAt]);

  useFrame(() => {
    const now = performance.now();
    const target = player.current;
    let inReach = false;
    if (isLive(target)) {
      const p = target.translation();
      inReach =
        Math.hypot(p.x - trap.position[0], p.z - trap.position[2]) < radius &&
        p.y - trap.position[1] < PILE_HEIGHT;
    }
    const reeling = now < stunUntilRef.current;
    const since = now - phaseAt.current;

    if (phase.current === "watching") {
      if (reeling && inReach && now - lastStrike.current > PILE.gateMs) {
        phase.current = "wobbling";
        phaseAt.current = now;
        mechanic(trap, onMechanic, "pile_tipping", PILE_WOBBLE_MS);
      }
    } else if (phase.current === "wobbling" && since >= PILE_WOBBLE_MS) {
      phase.current = "toppling";
      phaseAt.current = now;
      lastStrike.current = now;
      if (inReach && isLive(target)) {
        const p = target.translation();
        const dx = p.x - trap.position[0];
        const dz = p.z - trap.position[2];
        const away = Math.max(Math.hypot(dx, dz), 0.25);
        target.applyImpulse(
          { x: (dx / away) * PILE_SHOVE, y: -PILE_SLAM, z: (dz / away) * PILE_SHOVE },
          true,
        );
        contact(trap, onHazard, PILE.impulse);
        mechanic(trap, onMechanic, "pile_landed", PILE.impulse);
      } else {
        mechanic(trap, onMechanic, "pile_missed", 0);
      }
    } else if (phase.current === "toppling" && since >= PILE_TOPPLE_MS) {
      phase.current = "spent";
      phaseAt.current = now;
    } else if (phase.current === "spent" && now - lastStrike.current >= PILE.gateMs) {
      phase.current = "watching";
      phaseAt.current = now;
    }

    const state = phase.current;
    const elapsedPhase = now - phaseAt.current;
    if (stack.current) {
      let tilt = 0;
      if (state === "wobbling") tilt = 0.16 * Math.min(1, elapsedPhase / PILE_WOBBLE_MS);
      else if (state === "toppling")
        tilt = lerp(0.16, 1.1, Math.min(1, elapsedPhase / PILE_TOPPLE_MS));
      else if (state === "spent")
        tilt = 1.1 * Math.max(0, 1 - elapsedPhase / (PILE.gateMs - PILE_WOBBLE_MS - PILE_TOPPLE_MS));
      stack.current.rotation.z = tilt * lean;
    }
    // Armed only while the runner is inside somebody else's stun, which is the
    // one thing a player cannot infer from the prop, so the ring says it.
    if (live.current) live.current.visible = reeling || state !== "watching";
  }, TRAP_FRAME_PRIORITY);

  return (
    <>
      <group position={[trap.position[0], trap.position[1] + 0.02, trap.position[2]]}>
        <mesh name="pileOnReach" rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[radius - 0.12, radius, 44]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.32} />
        </mesh>
        <mesh name="pileOnLive" ref={live} visible={false} position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[radius - 0.14, 34]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.4} />
        </mesh>
      </group>
      <RigidBody
        ref={body}
        type="fixed"
        colliders={false}
        position={[trap.position[0], trap.position[1], trap.position[2]]}
        rotation={[0, trap.rotationY, 0]}
      >
        <CuboidCollider args={[0.4, 0.7, 0.4]} position={[0, 0.7, 0]} />
        <group ref={stack}>
          <CrockeryStack />
        </group>
      </RigidBody>
    </>
  );
}

// ---------------------------------------------------------------------------
// Pedal bin
// ---------------------------------------------------------------------------
// Fires on the release. Every other trap on the roster is triggered by arriving
// somewhere, so a runner reads the marked ground as somewhere not to be. Here
// standing on the pedal is the safe state and holds the lid up, and the lid
// comes down a fifth of a second after their weight leaves it. Sprinting off is
// clean; stepping off, or being shoved off by a fan or a magnet, is not.

const PEDAL = WAVE_B_HAZARD.bin_pedal;
const PEDAL_RELEASE_MS = WAVE_B_SCHEDULE.binPedal.releaseMs;
const PEDAL_SLAM_MS = WAVE_B_SCHEDULE.binPedal.slamMs;
const PEDAL_PLATE_FALLBACK = 0.8;
const PEDAL_SWIPE_FALLBACK = 1.4;
const PEDAL_HEIGHT = 1;
const PEDAL_SHOVE = 4.6;
const PEDAL_SLAM_DOWN = 2.8;

type PedalPhase = "open" | "held" | "falling" | "shut";

export function BinPedalTrap({
  trap,
  player,
  trapBodies,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const body = useRef<RapierRigidBody>(null);
  useRegisterTrapBody(body, trapBodies, trap.id);
  const lid = useRef<Group>(null);
  const live = useRef<Mesh>(null);
  const phase = useRef<PedalPhase>("open");
  const phaseAt = useRef(0);
  const lastSlam = useRef(0);
  const pedal = Math.max(0.3, trapNumber(trap, "pedal", PEDAL_PLATE_FALLBACK));
  const swipe = Math.max(pedal, trapNumber(trap, "swipe", PEDAL_SWIPE_FALLBACK));

  useEffect(() => {
    phase.current = "open";
    phaseAt.current = 0;
    lastSlam.current = 0;
  }, [startedAt]);

  useFrame(() => {
    const now = performance.now();
    const target = player.current;
    let onPedal = false;
    let reach = Number.POSITIVE_INFINITY;
    if (isLive(target)) {
      const p = target.translation();
      reach = Math.hypot(p.x - trap.position[0], p.z - trap.position[2]);
      onPedal = reach < pedal && p.y - trap.position[1] < PEDAL_HEIGHT;
    }
    const since = now - phaseAt.current;

    if (phase.current === "open") {
      if (onPedal && now - lastSlam.current > PEDAL.gateMs) {
        phase.current = "held";
        phaseAt.current = now;
        mechanic(trap, onMechanic, "pedal_pressed", pedal);
      }
    } else if (phase.current === "held") {
      if (!onPedal) {
        phase.current = "falling";
        phaseAt.current = now;
        mechanic(trap, onMechanic, "pedal_released", PEDAL_RELEASE_MS);
      }
    } else if (phase.current === "falling" && since >= PEDAL_RELEASE_MS) {
      phase.current = "shut";
      phaseAt.current = now;
      lastSlam.current = now;
      if (isLive(target) && reach < swipe) {
        const p = target.translation();
        const dx = p.x - trap.position[0];
        const dz = p.z - trap.position[2];
        const away = Math.max(Math.hypot(dx, dz), 0.25);
        target.applyImpulse(
          { x: (dx / away) * PEDAL_SHOVE, y: -PEDAL_SLAM_DOWN, z: (dz / away) * PEDAL_SHOVE },
          true,
        );
        contact(trap, onHazard, PEDAL.impulse);
        mechanic(trap, onMechanic, "pedal_slammed", PEDAL.impulse);
      } else {
        mechanic(trap, onMechanic, "pedal_missed", 0);
      }
    } else if (phase.current === "shut" && now - lastSlam.current >= PEDAL.gateMs) {
      phase.current = "open";
      phaseAt.current = now;
    }

    const state = phase.current;
    const elapsedPhase = now - phaseAt.current;
    if (lid.current) {
      // Cocked while the pedal is down, so how loaded it is reads off the prop.
      let open = 0;
      if (state === "held") open = Math.min(1, elapsedPhase / 260);
      else if (state === "falling") open = 1;
      else if (state === "shut")
        open = -0.25 * Math.max(0, 1 - elapsedPhase / PEDAL_SLAM_MS);
      lid.current.rotation.x = -open * 1.1;
    }
    // The swipe only lights while the lid is actually up, because that is the
    // only time this ground costs anything.
    if (live.current) live.current.visible = state === "held" || state === "falling";
  }, TRAP_FRAME_PRIORITY);

  return (
    <RigidBody
      ref={body}
      type="fixed"
      colliders={false}
      position={[trap.position[0], trap.position[1], trap.position[2]]}
      rotation={[0, trap.rotationY, 0]}
    >
      <CuboidCollider args={[pedal * 0.6, 0.03, pedal * 0.6]} position={[0, 0.03, 0]} sensor />
      {/* The lid's reach, at the radius the slam test uses. */}
      <mesh name="binPedalSwipe" position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[swipe - 0.1, swipe, 40]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.34} />
      </mesh>
      <mesh name="binPedalLive" ref={live} visible={false} position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[swipe - 0.12, 34]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.42} />
      </mesh>
      {/* The pedal itself, drawn where standing is the safe move. */}
      <mesh name="binPedalPlate" position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[pedal - 0.06, pedal, 28]} />
        <meshBasicMaterial color={PALETTE.cream} transparent opacity={0.85} />
      </mesh>
      {/* Only the lid lifts, so the drum and the pedal stay put, and the group
          that lifts sits on the lid's back edge rather than under its middle. */}
      <PedalBinBody />
      <group ref={lid} position={PEDAL_BIN_LID_HINGE}>
        <PedalBinLid />
      </group>
    </RigidBody>
  );
}

// ---------------------------------------------------------------------------
// Swing door
// ---------------------------------------------------------------------------
// Every other hazard fires at a runner coming towards it, so the read is always
// in front. This one opens away, lets the runner through clean, and comes back
// into their back once they have stopped looking. The counter-play is to keep
// running rather than to slow up on the far side, which is the opposite of what
// a trap that has just missed you normally teaches.

const DOOR = WAVE_B_HAZARD.swing_door;
const DOOR_OPEN_MS = WAVE_B_SCHEDULE.swingDoor.openMs;
const DOOR_HANG_MS = WAVE_B_SCHEDULE.swingDoor.hangMs;
const DOOR_REBOUND_MS = WAVE_B_SCHEDULE.swingDoor.reboundMs;
const DOOR_SPAN_FALLBACK = 1.9;
/** Half-depth of the band the leaf sweeps, along the trap's forward axis. */
const DOOR_BAND_HALF = 0.95;
/** Crossing this narrow strip is what sets the door going. */
const DOOR_TRIGGER_HALF = 0.4;
const DOOR_HEIGHT = 1.6;
const DOOR_SHOVE = 5.2;
const DOOR_LIFT = 2;

type DoorPhase = "shut" | "opening" | "hanging" | "rebounding" | "cooling";

export function SwingDoorTrap({
  trap,
  player,
  trapBodies,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const body = useRef<RapierRigidBody>(null);
  useRegisterTrapBody(body, trapBodies, trap.id);
  const leaf = useRef<Group>(null);
  const strike = useRef<Mesh>(null);
  const phase = useRef<DoorPhase>("shut");
  const phaseAt = useRef(0);
  const swing = useRef(1);
  const span = Math.max(0.8, trapNumber(trap, "span", DOOR_SPAN_FALLBACK));
  const forward = useMemo(() => trapForward(trap.rotationY), [trap.rotationY]);

  useEffect(() => {
    phase.current = "shut";
    phaseAt.current = 0;
  }, [startedAt]);

  useFrame(() => {
    const now = performance.now();
    const target = player.current;
    let along = Number.POSITIVE_INFINITY;
    let lateral = Number.POSITIVE_INFINITY;
    let height = Number.POSITIVE_INFINITY;
    let approach = 1;
    if (isLive(target)) {
      const p = target.translation();
      const v = target.linvel();
      const dx = p.x - trap.position[0];
      const dz = p.z - trap.position[2];
      along = dx * forward.x + dz * forward.z;
      lateral = dx * forward.z - dz * forward.x;
      height = p.y - trap.position[1];
      approach = v.x * forward.x + v.z * forward.z >= 0 ? 1 : -1;
    }
    const inLane = Math.abs(lateral) < span / 2 && height < DOOR_HEIGHT;
    const since = now - phaseAt.current;

    if (phase.current === "shut") {
      if (inLane && Math.abs(along) < DOOR_TRIGGER_HALF) {
        phase.current = "opening";
        phaseAt.current = now;
        // Opens along the runner's own heading, so it is always shoved out of
        // their way first and always comes back from behind them.
        swing.current = approach;
        mechanic(trap, onMechanic, "door_opened", span);
      }
    } else if (phase.current === "opening" && since >= DOOR_OPEN_MS) {
      phase.current = "hanging";
      phaseAt.current = now;
    } else if (phase.current === "hanging" && since >= DOOR_HANG_MS) {
      phase.current = "rebounding";
      phaseAt.current = now;
    } else if (phase.current === "rebounding" && since >= DOOR_REBOUND_MS) {
      phase.current = "cooling";
      phaseAt.current = now;
      if (inLane && Math.abs(along) < DOOR_BAND_HALF && isLive(target)) {
        target.applyImpulse(
          {
            x: forward.x * DOOR_SHOVE * swing.current,
            y: DOOR_LIFT,
            z: forward.z * DOOR_SHOVE * swing.current,
          },
          true,
        );
        contact(trap, onHazard, DOOR.impulse);
        mechanic(trap, onMechanic, "door_slammed", DOOR.impulse);
      } else {
        mechanic(trap, onMechanic, "door_missed", 0);
      }
    } else if (
      phase.current === "cooling" &&
      since >= DOOR.gateMs - DOOR_OPEN_MS - DOOR_HANG_MS - DOOR_REBOUND_MS
    ) {
      phase.current = "shut";
      phaseAt.current = now;
    }

    const state = phase.current;
    const elapsedPhase = now - phaseAt.current;
    let angle = 0;
    if (state === "opening") angle = Math.min(1, elapsedPhase / DOOR_OPEN_MS);
    else if (state === "hanging") angle = 1;
    else if (state === "rebounding") {
      const u = Math.min(1, elapsedPhase / DOOR_REBOUND_MS);
      angle = 1 - u * u;
    }
    if (leaf.current) leaf.current.rotation.y = angle * 1.25 * swing.current;
    // The band lights only while the leaf is coming back, which is the window
    // the runner is standing in the wrong place for.
    if (strike.current)
      strike.current.visible =
        state === "hanging" || (state === "rebounding" && blink(elapsedPhase, 70) > 0.5);
  }, TRAP_FRAME_PRIORITY);

  return (
    <>
      <group
        position={[trap.position[0], trap.position[1] + 0.02, trap.position[2]]}
        rotation={[0, trap.rotationY, 0]}
      >
        {/* The whole band the leaf sweeps, at the width and depth the strike
            test uses, not just the strip that sets it going. */}
        <mesh name="swingDoorSweep" rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[span, DOOR_BAND_HALF * 2]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.34} />
        </mesh>
        <mesh name="swingDoorStrike" ref={strike} visible={false} position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[span, DOOR_BAND_HALF * 2]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.6} />
        </mesh>
        <mesh name="swingDoorTrigger" position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[span, DOOR_TRIGGER_HALF * 2]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.8} />
        </mesh>
      </group>
      <RigidBody
        ref={body}
        type="fixed"
        colliders={false}
        position={[trap.position[0], trap.position[1], trap.position[2]]}
        rotation={[0, trap.rotationY, 0]}
      >
        <CuboidCollider args={[0.12, DOOR_HEIGHT / 2, 0.12]} position={[-span / 2, DOOR_HEIGHT / 2, 0]} />
        {/* Hinged at one jamb, so the leaf swings through the band above. */}
        {/* The jamb is where the collider is, so it stays outside the swing. */}
        <group position={[-span / 2, 0, 0]}>
          <SwingDoorJamb height={DOOR_HEIGHT} />
        </group>
        <group ref={leaf} position={[-span / 2, 0, 0]}>
          <SwingDoorLeaf span={span} height={DOOR_HEIGHT} />
        </group>
      </RigidBody>
    </>
  );
}

// ---------------------------------------------------------------------------
// Ball machine
// ---------------------------------------------------------------------------
// The paint bucket aims at where the runner is and commits, so the escape is to
// move. This one aims at where they will be and commits, so the escape is to
// stop doing what they were doing. Holding a line at a steady speed, which is
// what every launcher on the roster rewards, is exactly what feeds it.

const MACHINE = WAVE_B_HAZARD.ball_machine;
const MACHINE_AIM_MS = WAVE_B_SCHEDULE.ballMachine.aimMs;
const MACHINE_FLIGHT_MS = WAVE_B_SCHEDULE.ballMachine.flightMs;
const MACHINE_LEAD_MS = WAVE_B_SCHEDULE.ballMachine.leadMs;
const MACHINE_RANGE_FALLBACK = 3.6;
const MACHINE_SPREAD_FALLBACK = 0.85;
const MACHINE_HEIGHT = 1.4;
const MACHINE_SHOVE = 4.4;
const MACHINE_LIFT = 1.6;
const MACHINE_MUZZLE_HEIGHT = 0.75;

export function BallMachineTrap({
  trap,
  player,
  trapBodies,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const body = useRef<RapierRigidBody>(null);
  useRegisterTrapBody(body, trapBodies, trap.id);
  const lead = useRef<Group>(null);
  const shot = useRef<Group>(null);
  const aim = useRef({ x: trap.position[0], z: trap.position[2] });
  const firedCycle = useRef(-1);
  const landedCycle = useRef(-1);
  const range = Math.max(1, trapNumber(trap, "range", MACHINE_RANGE_FALLBACK));
  const spread = Math.max(0.3, trapNumber(trap, "spread", MACHINE_SPREAD_FALLBACK));

  useEffect(() => {
    firedCycle.current = -1;
    landedCycle.current = -1;
    aim.current.x = trap.position[0];
    aim.current.z = trap.position[2];
  }, [startedAt, trap.position]);

  useFrame(() => {
    const elapsed = elapsedMs(startedAt);
    const cycle = Math.floor(elapsed / MACHINE.gateMs);
    const phase = elapsed % MACHINE.gateMs;
    const target = player.current;

    if (phase < MACHINE_AIM_MS && isLive(target)) {
      const p = target.translation();
      const v = target.linvel();
      // Where the runner will be when the ball arrives, clamped into range.
      const seconds = MACHINE_LEAD_MS / 1000;
      const dx = p.x + v.x * seconds - trap.position[0];
      const dz = p.z + v.z * seconds - trap.position[2];
      const distance = Math.hypot(dx, dz);
      const clamp = distance > range ? range / distance : 1;
      aim.current.x = trap.position[0] + dx * clamp;
      aim.current.z = trap.position[2] + dz * clamp;
    }

    if (phase >= MACHINE_AIM_MS && firedCycle.current !== cycle) {
      firedCycle.current = cycle;
      mechanic(trap, onMechanic, "ball_fired", spread);
    }
    if (phase >= MACHINE_AIM_MS + MACHINE_FLIGHT_MS && landedCycle.current !== cycle) {
      landedCycle.current = cycle;
      if (isLive(target)) {
        const p = target.translation();
        const dx = p.x - aim.current.x;
        const dz = p.z - aim.current.z;
        const distance = Math.hypot(dx, dz);
        if (distance < spread && p.y - trap.position[1] < MACHINE_HEIGHT) {
          const away = Math.max(distance, 0.2);
          target.applyImpulse(
            { x: (dx / away) * MACHINE_SHOVE, y: MACHINE_LIFT, z: (dz / away) * MACHINE_SHOVE },
            true,
          );
          contact(trap, onHazard, MACHINE.impulse);
          mechanic(trap, onMechanic, "ball_hit", MACHINE.impulse);
        }
      }
    }

    if (lead.current) lead.current.position.set(aim.current.x, trap.position[1] + 0.03, aim.current.z);
    if (shot.current) {
      const flying = phase >= MACHINE_AIM_MS && phase < MACHINE_AIM_MS + MACHINE_FLIGHT_MS;
      shot.current.visible = flying;
      if (flying) {
        const u = (phase - MACHINE_AIM_MS) / MACHINE_FLIGHT_MS;
        shot.current.position.set(
          lerp(trap.position[0], aim.current.x, u),
          trap.position[1] + MACHINE_MUZZLE_HEIGHT + Math.sin(u * Math.PI) * 0.35 - u * MACHINE_MUZZLE_HEIGHT * 0.6,
          lerp(trap.position[2], aim.current.z, u),
        );
      }
    }
  }, TRAP_FRAME_PRIORITY);

  return (
    <>
      <mesh
        name="ballMachineRange"
        position={[trap.position[0], trap.position[1] + 0.02, trap.position[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry args={[range - 0.1, range, 56]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.32} />
      </mesh>
      {/* The led point, at the radius the impact test uses. It runs ahead of the
          runner while the machine tracks and freezes the moment it fires, which
          is the whole window a change of speed has to work in. */}
      <group ref={lead} position={[trap.position[0], trap.position[1] + 0.03, trap.position[2]]}>
        <mesh name="ballMachineLead" rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[spread - 0.1, spread, 30]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.85} />
        </mesh>
        <mesh name="ballMachineLeadFill" position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[spread - 0.12, 26]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.24} />
        </mesh>
      </group>
      <group ref={shot} visible={false}>
        <PracticeBall />
      </group>
      <RigidBody
        ref={body}
        type="fixed"
        colliders={false}
        position={[trap.position[0], trap.position[1], trap.position[2]]}
        rotation={[0, trap.rotationY, 0]}
      >
        <CuboidCollider args={[0.34, 0.4, 0.34]} position={[0, 0.4, 0]} />
        <BallMachine />
      </RigidBody>
    </>
  );
}

// ---------------------------------------------------------------------------
// Cuckoo clock
// ---------------------------------------------------------------------------
// Winds up three times and only strikes on the third, which makes it the one
// hazard on the roster that cannot be read from a single wind-up. Everything
// else teaches that noise means incoming, so a runner who has learned that
// stops for the first chime and loses the time; a runner who counts walks
// through two of them. The count is printed on the floor, so it is a rhythm to
// learn rather than a coin flip.

const CUCKOO = WAVE_B_HAZARD.cuckoo_clock;
const CUCKOO_BEAT_MS = WAVE_B_SCHEDULE.cuckooClock.beatMs;
const CUCKOO_BEATS = WAVE_B_SCHEDULE.cuckooClock.beatsPerStrike;
const CUCKOO_LUNGE_MS = WAVE_B_SCHEDULE.cuckooClock.lungeMs;
const CUCKOO_REACH_FALLBACK = 1.5;
const CUCKOO_HEIGHT = 1.7;
const CUCKOO_SHOVE = 5;
const CUCKOO_LIFT = 1.8;
const CUCKOO_MOUNT_HEIGHT = 1.5;

export function CuckooClockTrap({
  trap,
  player,
  trapBodies,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const body = useRef<RapierRigidBody>(null);
  useRegisterTrapBody(body, trapBodies, trap.id);
  const bird = useRef<Group>(null);
  const commit = useRef<Mesh>(null);
  const pips = useRef<Array<Mesh | null>>([]);
  const struckBeat = useRef(-1);
  const reach = Math.max(0.5, trapNumber(trap, "reach", CUCKOO_REACH_FALLBACK));
  const forward = useMemo(() => trapForward(trap.rotationY), [trap.rotationY]);

  useEffect(() => {
    struckBeat.current = -1;
  }, [startedAt]);

  useFrame(() => {
    const elapsed = elapsedMs(startedAt);
    const beat = Math.floor(elapsed / CUCKOO_BEAT_MS);
    const beatPhase = elapsed % CUCKOO_BEAT_MS;
    const index = beat % CUCKOO_BEATS;
    const striking = index === CUCKOO_BEATS - 1;

    if (striking && beatPhase >= CUCKOO_LUNGE_MS && struckBeat.current !== beat) {
      struckBeat.current = beat;
      const target = player.current;
      if (isLive(target)) {
        const p = target.translation();
        const dx = p.x - trap.position[0];
        const dz = p.z - trap.position[2];
        const distance = Math.hypot(dx, dz);
        if (distance < reach && p.y - trap.position[1] < CUCKOO_HEIGHT) {
          const away = Math.max(distance, 0.25);
          target.applyImpulse(
            { x: (dx / away) * CUCKOO_SHOVE, y: CUCKOO_LIFT, z: (dz / away) * CUCKOO_SHOVE },
            true,
          );
          contact(trap, onHazard, CUCKOO.impulse);
          mechanic(trap, onMechanic, "cuckoo_struck", CUCKOO.impulse);
        } else {
          mechanic(trap, onMechanic, "cuckoo_missed", 0);
        }
      }
    }

    // The bird leans out on every beat and lunges the full reach only on the
    // third, so the difference between a chime and a strike is visible before
    // it lands rather than after.
    const out = Math.min(1, beatPhase / CUCKOO_LUNGE_MS);
    const retreat = Math.max(0, 1 - (beatPhase - CUCKOO_LUNGE_MS) / (CUCKOO_BEAT_MS - CUCKOO_LUNGE_MS));
    const extend = beatPhase < CUCKOO_LUNGE_MS ? out : retreat;
    if (bird.current) {
      const travel = extend * (striking ? reach * 0.75 : reach * 0.22);
      bird.current.position.set(forward.x * travel, CUCKOO_MOUNT_HEIGHT, forward.z * travel);
    }
    if (commit.current) {
      commit.current.visible = striking;
      if (striking) commit.current.scale.setScalar(Math.max(0.001, out));
    }
    for (let slot = 0; slot < CUCKOO_BEATS; slot += 1) {
      const pip = pips.current[slot];
      if (pip) pip.visible = slot <= index;
    }
  }, TRAP_FRAME_PRIORITY);

  return (
    <>
      <group position={[trap.position[0], trap.position[1] + 0.02, trap.position[2]]}>
        <mesh name="cuckooClockReach" rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[reach - 0.12, reach, 40]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.55} />
        </mesh>
        {/* Only fills on the beat that actually strikes. */}
        <mesh name="cuckooClockCommit" ref={commit} visible={false} position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[reach - 0.14, 32]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.36} />
        </mesh>
        {/* The count, in cream rather than danger, and outside the reach ring,
            so it can never be read as ground that hurts. */}
        {Array.from({ length: CUCKOO_BEATS }, (_, slot) => (
          <mesh
            key={slot}
            name={`cuckooClockPip${slot}`}
            ref={(pip: Mesh | null) => {
              pips.current[slot] = pip;
            }}
            position={[(slot - (CUCKOO_BEATS - 1) / 2) * 0.3, 0.01, reach + 0.3]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <circleGeometry args={[0.1, 12]} />
            <meshBasicMaterial color={PALETTE.cream} transparent opacity={0.95} />
          </mesh>
        ))}
      </group>
      <group ref={bird} position={[trap.position[0], trap.position[1] + CUCKOO_MOUNT_HEIGHT, trap.position[2]]}>
        <CuckooBird />
      </group>
      <RigidBody
        ref={body}
        type="fixed"
        colliders={false}
        position={[trap.position[0], trap.position[1], trap.position[2]]}
        rotation={[0, trap.rotationY, 0]}
      >
        <CuboidCollider args={[0.28, 0.9, 0.28]} position={[0, 0.9, 0]} />
        <CuckooClock />
      </RigidBody>
    </>
  );
}

// ---------------------------------------------------------------------------
// Fish bowl
// ---------------------------------------------------------------------------
// Keyed to the change in the runner's speed rather than to the speed itself.
// Holding any pace through it, fast or slow, costs nothing; braking to read
// something, or lunging out of a standstill, slops it over. It is the exact
// complement of the ball machine, which punishes holding a line at a steady
// speed, so the two of them together leave a runner nothing safe to do.

const BOWL = WAVE_B_HAZARD.fish_bowl;
const BOWL_SLOP_MS = WAVE_B_SCHEDULE.fishBowl.slopMs;
const BOWL_SETTLE_MS = WAVE_B_SCHEDULE.fishBowl.settleMs;
const BOWL_RADIUS_FALLBACK = 1.5;
/**
 * Metres per second squared of change in horizontal speed that tips it.
 * PlayerController accelerates at PLAYER.acceleration, 30, on dry ground, so 18
 * is a deliberate stop or lunge rather than the drift of a steady run.
 */
const BOWL_JOLT_FALLBACK = 18;
const BOWL_HEIGHT = 1.3;
const BOWL_SHOVE = 3.6;
const BOWL_SLAM = 2;
/** Time constant of the speed the jolt is measured against, in seconds. */
const BOWL_SMOOTHING = 0.12;

type BowlPhase = "still" | "slopping" | "settling";

export function FishBowlTrap({
  trap,
  player,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const rim = useRef<Mesh>(null);
  const warning = useRef<Mesh>(null);
  const smoothed = useRef(0);
  const seeded = useRef(false);
  const phase = useRef<BowlPhase>("still");
  const phaseAt = useRef(0);
  const lastSlop = useRef(0);
  const radius = Math.max(0.5, trapNumber(trap, "radius", BOWL_RADIUS_FALLBACK));
  const jolt = Math.max(2, trapNumber(trap, "jolt", BOWL_JOLT_FALLBACK));

  useEffect(() => {
    phase.current = "still";
    phaseAt.current = 0;
    lastSlop.current = 0;
    seeded.current = false;
    smoothed.current = 0;
  }, [startedAt]);

  useFrame((_, delta) => {
    const now = performance.now();
    const step = Math.min(delta, MAX_STEP);
    const target = player.current;
    let inside = false;
    let change = 0;
    if (isLive(target)) {
      const p = target.translation();
      const v = target.linvel();
      const speed = Math.hypot(v.x, v.z);
      if (!seeded.current) {
        seeded.current = true;
        smoothed.current = speed;
      }
      // Rate of change of horizontal speed, against a short running mean, so a
      // single noisy frame cannot tip it but a real stop or lunge does.
      change = step > 0 ? Math.abs(speed - smoothed.current) / step : 0;
      smoothed.current += (speed - smoothed.current) * Math.min(1, step / BOWL_SMOOTHING);
      inside =
        Math.hypot(p.x - trap.position[0], p.z - trap.position[2]) < radius &&
        p.y - trap.position[1] < BOWL_HEIGHT;
    }
    const since = now - phaseAt.current;

    if (phase.current === "still") {
      if (inside && change > jolt && now - lastSlop.current > BOWL.gateMs) {
        phase.current = "slopping";
        phaseAt.current = now;
        mechanic(trap, onMechanic, "bowl_tipping", change);
      }
    } else if (phase.current === "slopping" && since >= BOWL_SLOP_MS) {
      phase.current = "settling";
      phaseAt.current = now;
      lastSlop.current = now;
      if (inside && isLive(target)) {
        const p = target.translation();
        const dx = p.x - trap.position[0];
        const dz = p.z - trap.position[2];
        const away = Math.max(Math.hypot(dx, dz), 0.25);
        target.applyImpulse(
          { x: (dx / away) * BOWL_SHOVE, y: -BOWL_SLAM, z: (dz / away) * BOWL_SHOVE },
          true,
        );
        contact(trap, onHazard, BOWL.impulse);
        mechanic(trap, onMechanic, "bowl_slopped", BOWL.impulse);
      } else {
        mechanic(trap, onMechanic, "bowl_steadied", 0);
      }
    } else if (phase.current === "settling" && since >= BOWL_SETTLE_MS) {
      phase.current = "still";
      phaseAt.current = now;
    }

    // The water leans in proportion to how roughly the runner is handling it,
    // which is the only warning there can be for a trap keyed to an input.
    if (rim.current) {
      const material = rim.current.material as MeshBasicMaterial;
      material.opacity = 0.3 + Math.min(1, change / jolt) * 0.5;
    }
    if (warning.current) {
      const tipping = phase.current === "slopping";
      warning.current.visible = tipping;
      if (tipping) warning.current.scale.setScalar(Math.min(1, since / BOWL_SLOP_MS));
    }
  }, TRAP_FRAME_PRIORITY);

  return (
    <group position={[trap.position[0], trap.position[1] + 0.02, trap.position[2]]} rotation={[0, trap.rotationY, 0]}>
      <mesh name="fishBowlReach" ref={rim} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius - 0.12, radius, 44]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.3} />
      </mesh>
      <mesh name="fishBowlTipping" ref={warning} visible={false} position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[radius - 0.14, 34]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.44} />
      </mesh>
      <FishBowl radius={radius} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Shoe rack
// ---------------------------------------------------------------------------
// Sets its own hit up. It opens with a shove that does no damage at all, purely
// sideways, and six hundred milliseconds later the rack goes over onto the exact
// patch that shove puts people on. Both the shove and the landing patch are
// drawn on the floor from the start, so the trap is not a surprise; it is a
// problem, and the answer is to be somewhere the shove cannot move you or to
// fight it while it is happening.

const RACK = WAVE_B_HAZARD.shoe_rack;
const RACK_JAB_MS = WAVE_B_SCHEDULE.shoeRack.jabMs;
const RACK_CROSS_MS = WAVE_B_SCHEDULE.shoeRack.crossMs;
const RACK_SETTLE_MS = WAVE_B_SCHEDULE.shoeRack.settleMs;
const RACK_REACH_FALLBACK = 2.2;
const RACK_CRUSH_FALLBACK = 1.3;
const RACK_OFFSET_FALLBACK = 1.5;
const RACK_HEIGHT = 1.5;
/**
 * The opening shove. It reports no hazard on purpose: it does no stun and no
 * knockback of its own, so counting it would price this as a two-contact
 * repeater instead of the one-hit combination it is.
 */
const RACK_JAB_SHOVE = 3.2;
const RACK_CRUSH_SHOVE = 3.4;
const RACK_CRUSH_SLAM = 3.8;

export function ShoeRackTrap({
  trap,
  player,
  trapBodies,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const body = useRef<RapierRigidBody>(null);
  useRegisterTrapBody(body, trapBodies, trap.id);
  const rack = useRef<Group>(null);
  const shoe = useRef<Group>(null);
  const closing = useRef<Mesh>(null);
  const jabbedCycle = useRef(-1);
  const crossedCycle = useRef(-1);
  const reach = Math.max(0.6, trapNumber(trap, "reach", RACK_REACH_FALLBACK));
  const crush = Math.max(0.4, trapNumber(trap, "crush", RACK_CRUSH_FALLBACK));
  const offset = Math.max(0.4, trapNumber(trap, "offset", RACK_OFFSET_FALLBACK));
  const forward = useMemo(() => trapForward(trap.rotationY), [trap.rotationY]);
  // Which way the shove goes. Fixed per placement and drawn on the floor, so
  // the combination is something to learn rather than something to guess.
  const side = useMemo(() => (createSeededRandom(trap.seed)() > 0.5 ? 1 : -1), [trap.seed]);
  const landing = useMemo(
    () => ({
      x: trap.position[0] + forward.z * offset * side,
      z: trap.position[2] - forward.x * offset * side,
    }),
    [trap.position, forward, offset, side],
  );

  useEffect(() => {
    jabbedCycle.current = -1;
    crossedCycle.current = -1;
  }, [startedAt]);

  useFrame(() => {
    const elapsed = elapsedMs(startedAt);
    const cycle = Math.floor(elapsed / RACK.gateMs);
    const phase = elapsed % RACK.gateMs;
    const target = player.current;

    if (phase >= RACK_JAB_MS && jabbedCycle.current !== cycle) {
      jabbedCycle.current = cycle;
      mechanic(trap, onMechanic, "rack_jabbed", offset);
      if (isLive(target)) {
        const p = target.translation();
        if (
          Math.hypot(p.x - trap.position[0], p.z - trap.position[2]) < reach &&
          p.y - trap.position[1] < RACK_HEIGHT
        ) {
          // Sideways only, toward the patch the rack is going to land on.
          target.applyImpulse(
            {
              x: forward.z * RACK_JAB_SHOVE * side,
              y: 0,
              z: -forward.x * RACK_JAB_SHOVE * side,
            },
            true,
          );
        }
      }
    }

    if (phase >= RACK_CROSS_MS && crossedCycle.current !== cycle) {
      crossedCycle.current = cycle;
      if (isLive(target)) {
        const p = target.translation();
        const dx = p.x - landing.x;
        const dz = p.z - landing.z;
        const distance = Math.hypot(dx, dz);
        if (distance < crush && p.y - trap.position[1] < RACK_HEIGHT) {
          const away = Math.max(distance, 0.25);
          target.applyImpulse(
            {
              x: (dx / away) * RACK_CRUSH_SHOVE,
              y: -RACK_CRUSH_SLAM,
              z: (dz / away) * RACK_CRUSH_SHOVE,
            },
            true,
          );
          contact(trap, onHazard, RACK.impulse);
          mechanic(trap, onMechanic, "rack_crushed", RACK.impulse);
        } else {
          mechanic(trap, onMechanic, "rack_missed", 0);
        }
      }
    }

    const toppling = phase >= RACK_CROSS_MS && phase < RACK_CROSS_MS + RACK_SETTLE_MS;
    if (rack.current) {
      // Leans away from the landing patch through the jab, then goes over onto
      // it, so the second half of the combination is visible from the first.
      let tilt = 0;
      if (phase < RACK_JAB_MS) tilt = -0.12 * (phase / RACK_JAB_MS);
      else if (phase < RACK_CROSS_MS)
        tilt = lerp(-0.12, 0.2, (phase - RACK_JAB_MS) / (RACK_CROSS_MS - RACK_JAB_MS));
      else if (toppling)
        tilt = lerp(0.2, 1.15, (phase - RACK_CROSS_MS) / RACK_SETTLE_MS);
      else
        tilt =
          1.15 *
          Math.max(0, 1 - (phase - RACK_CROSS_MS - RACK_SETTLE_MS) / (RACK.gateMs - RACK_CROSS_MS - RACK_SETTLE_MS));
      rack.current.rotation.z = tilt * side;
    }
    if (shoe.current) {
      const flying = phase >= RACK_JAB_MS && phase < RACK_JAB_MS + 260;
      shoe.current.visible = flying;
      if (flying) {
        const u = (phase - RACK_JAB_MS) / 260;
        shoe.current.position.set(
          lerp(trap.position[0], landing.x, u),
          trap.position[1] + 0.5 + Math.sin(u * Math.PI) * 0.3,
          lerp(trap.position[2], landing.z, u),
        );
      }
    }
    // Fills across the gap between the shove and the topple: how long the
    // runner has to get off the patch they were just put on.
    if (closing.current) {
      const between = phase >= RACK_JAB_MS && phase < RACK_CROSS_MS;
      closing.current.visible = between || toppling;
      closing.current.scale.setScalar(
        between
          ? Math.max(0.001, (phase - RACK_JAB_MS) / (RACK_CROSS_MS - RACK_JAB_MS))
          : 1,
      );
    }
  }, TRAP_FRAME_PRIORITY);

  return (
    <>
      <mesh
        name="shoeRackReach"
        position={[trap.position[0], trap.position[1] + 0.02, trap.position[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry args={[reach - 0.1, reach, 48]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.28} />
      </mesh>
      {/* The patch the rack lands on, at the radius the crush test uses, drawn
          from the start so the shove can be read as the setup it is. */}
      <group position={[landing.x, trap.position[1] + 0.03, landing.z]}>
        <mesh name="shoeRackLanding" rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[crush - 0.1, crush, 34]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.8} />
        </mesh>
        <mesh name="shoeRackClosing" ref={closing} visible={false} position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[crush - 0.12, 30]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.4} />
        </mesh>
      </group>
      <group ref={shoe} visible={false}>
        <ThrownShoe />
      </group>
      <RigidBody
        ref={body}
        type="fixed"
        colliders={false}
        position={[trap.position[0], trap.position[1], trap.position[2]]}
        rotation={[0, trap.rotationY, 0]}
      >
        <CuboidCollider args={[0.45, 0.35, 0.25]} position={[0, 0.35, 0]} />
        <group ref={rack}>
          <ShoeRack />
        </group>
      </RigidBody>
    </>
  );
}

// ---------------------------------------------------------------------------
// Hot potato
// ---------------------------------------------------------------------------
// Baits the one verb the player has that no trap answers. Holding E and
// shoving props around is free everywhere else on the course, so a runner
// learns to pick things up. This starts counting the moment anything moves it,
// whether that is a hand, a fan or a shoulder, and goes off wherever it has got
// to. Throwing it is a real escape, which makes it the only hazard here the
// runner can choose to relocate.

const POTATO = WAVE_B_HAZARD.hot_potato;
const POTATO_FUSE_MS = WAVE_B_SCHEDULE.hotPotato.fuseMs;
const POTATO_BLAST_MS = WAVE_B_SCHEDULE.hotPotato.blastMs;
const POTATO_BLAST_FALLBACK = 1.1;
/** Above this it has been picked up, kicked or blown, rather than just settling. */
const POTATO_DISTURBED_SPEED = 2;
const POTATO_HEIGHT = 1.4;
const POTATO_SHOVE = 5;
const POTATO_LIFT = 2.2;
const POTATO_MASS = 0.4;
const POTATO_RADIUS = 0.17;
/** Cool plus fuse is exactly the repeat gate the catalogue price derives from. */
const POTATO_COOL_MS = POTATO.gateMs - POTATO_FUSE_MS;

type PotatoPhase = "cold" | "burning" | "spent";

export function HotPotatoTrap({
  trap,
  player,
  grabbables,
  trapBodies,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const spud = useRef<RapierRigidBody>(null);
  const marker = useRef<Group>(null);
  const fuse = useRef<Mesh>(null);
  const phase = useRef<PotatoPhase>("cold");
  const phaseAt = useRef(0);
  const blast = Math.max(0.4, trapNumber(trap, "blast", POTATO_BLAST_FALLBACK));

  useEffect(() => {
    const grabbable = grabbables.current;
    const bodies = trapBodies.current;
    const rigid = spud.current;
    if (rigid) {
      grabbable.set(trap.id, rigid);
      bodies.set(trap.id, rigid);
    }
    return () => {
      grabbable.delete(trap.id);
      bodies.delete(trap.id);
    };
  }, [grabbables, trapBodies, trap.id]);

  useEffect(() => {
    phase.current = "cold";
    phaseAt.current = 0;
  }, [startedAt]);

  useFrame(() => {
    const now = performance.now();
    const potato = spud.current;
    if (!isLive(potato)) return;
    const here = potato.translation();
    const since = now - phaseAt.current;

    if (phase.current === "cold") {
      const v = potato.linvel();
      if (Math.hypot(v.x, v.y, v.z) > POTATO_DISTURBED_SPEED) {
        phase.current = "burning";
        phaseAt.current = now;
        mechanic(trap, onMechanic, "potato_lit", POTATO_FUSE_MS);
      }
    } else if (phase.current === "burning" && since >= POTATO_FUSE_MS) {
      phase.current = "spent";
      phaseAt.current = now;
      const target = player.current;
      if (isLive(target)) {
        const p = target.translation();
        const dx = p.x - here.x;
        const dz = p.z - here.z;
        const distance = Math.hypot(dx, dz);
        if (distance < blast && p.y - here.y < POTATO_HEIGHT) {
          const away = Math.max(distance, 0.25);
          target.applyImpulse(
            { x: (dx / away) * POTATO_SHOVE, y: POTATO_LIFT, z: (dz / away) * POTATO_SHOVE },
            true,
          );
          contact(trap, onHazard, POTATO.impulse);
          mechanic(trap, onMechanic, "potato_blew", POTATO.impulse);
        } else {
          mechanic(trap, onMechanic, "potato_wasted", 0);
        }
      }
    } else if (phase.current === "spent" && since >= POTATO_COOL_MS) {
      phase.current = "cold";
      phaseAt.current = now;
    }

    // The blast circle travels with the potato, because the potato is where the
    // hazard is once somebody has thrown it.
    if (marker.current) marker.current.position.set(here.x, trap.position[1] + 0.03, here.z);
    if (fuse.current) {
      const burning = phase.current === "burning";
      const blasting = phase.current === "spent" && since < POTATO_BLAST_MS;
      fuse.current.visible = burning || blasting;
      if (burning) {
        // Beats faster the closer it is to going off.
        const left = 1 - Math.min(1, since / POTATO_FUSE_MS);
        fuse.current.scale.setScalar(blink(since, 90 + left * 260) > 0.5 ? 1 : 0.55);
      } else if (blasting) fuse.current.scale.setScalar(1);
    }
  }, TRAP_FRAME_PRIORITY);

  return (
    <>
      <group ref={marker} position={[trap.position[0], trap.position[1] + 0.03, trap.position[2]]}>
        <mesh name="hotPotatoBlast" rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[blast - 0.1, blast, 32]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.6} />
        </mesh>
        <mesh name="hotPotatoFuse" ref={fuse} visible={false} position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[blast - 0.12, 26]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.4} />
        </mesh>
      </group>
      <RigidBody
        ref={spud}
        type="dynamic"
        colliders={false}
        position={[trap.position[0], trap.position[1] + POTATO_RADIUS + 0.05, trap.position[2]]}
        rotation={[0, trap.rotationY, 0]}
        restitution={0.35}
        friction={0.7}
        canSleep
      >
        {/* @react-three/rapier 2.2.0 drops `mass` from rigid body props, so it
            has to be declared on the collider to take effect at all. */}
        <BallCollider args={[POTATO_RADIUS]} mass={POTATO_MASS} />
        <HotPotato radius={POTATO_RADIUS} />
      </RigidBody>
    </>
  );
}

// ---------------------------------------------------------------------------
// Hob ring
// ---------------------------------------------------------------------------
// Inverts the first thing the danger colour teaches. Twenty-two traps have
// trained the player that the marked ground is the ground to leave, so the
// instinct at a circle closing on you is to sprint out of it. Here the marked
// ground is an annulus and the middle is not marked, because the middle is the
// only place the flare does not reach. Running out is what gets you burnt.

const STOVE = WAVE_B_HAZARD.stove_ring;
const STOVE_CHARGE_MS = WAVE_B_SCHEDULE.stoveRing.chargeMs;
const STOVE_FLARE_MS = WAVE_B_SCHEDULE.stoveRing.flareMs;
const STOVE_EYE_FALLBACK = 0.55;
const STOVE_FLARE_FALLBACK = 1.7;
const STOVE_HEIGHT = 1.2;
const STOVE_SHOVE = 4.2;
const STOVE_LIFT = 2.8;

export function StoveRingTrap({
  trap,
  player,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const front = useRef<Mesh>(null);
  const firedCycle = useRef(-1);
  const eye = Math.max(0.2, trapNumber(trap, "eye", STOVE_EYE_FALLBACK));
  const flare = Math.max(eye + 0.3, trapNumber(trap, "flare", STOVE_FLARE_FALLBACK));

  useEffect(() => {
    firedCycle.current = -1;
  }, [startedAt]);

  useFrame(() => {
    const elapsed = elapsedMs(startedAt);
    const cycle = Math.floor(elapsed / STOVE.gateMs);
    const phase = elapsed % STOVE.gateMs;

    if (phase >= STOVE_CHARGE_MS && firedCycle.current !== cycle) {
      firedCycle.current = cycle;
      const target = player.current;
      if (isLive(target)) {
        const p = target.translation();
        const dx = p.x - trap.position[0];
        const dz = p.z - trap.position[2];
        const distance = Math.hypot(dx, dz);
        if (distance >= eye && distance < flare && p.y - trap.position[1] < STOVE_HEIGHT) {
          const away = Math.max(distance, 0.25);
          target.applyImpulse(
            { x: (dx / away) * STOVE_SHOVE, y: STOVE_LIFT, z: (dz / away) * STOVE_SHOVE },
            true,
          );
          contact(trap, onHazard, STOVE.impulse);
          mechanic(trap, onMechanic, "stove_burnt", STOVE.impulse);
        } else {
          mechanic(trap, onMechanic, "stove_flared", distance < eye ? 0 : flare);
        }
      }
    }

    // A thin rim travelling from the eye out to the flare across the charge, so
    // the annulus is visibly filling outward and the eye visibly is not.
    if (front.current) {
      const closing = Math.min(1, phase / STOVE_CHARGE_MS);
      const flaring = phase >= STOVE_CHARGE_MS && phase < STOVE_CHARGE_MS + STOVE_FLARE_MS;
      front.current.scale.setScalar(flaring ? flare : lerp(eye, flare, closing));
      front.current.visible = flaring ? blink(phase, 70) > 0.5 : true;
    }
  }, TRAP_FRAME_PRIORITY);

  return (
    <group position={[trap.position[0], trap.position[1] + 0.02, trap.position[2]]} rotation={[0, trap.rotationY, 0]}>
      {/* The reach, drawn exactly as the test reads it: everything from the eye
          out to the flare, and nothing inside the eye. */}
      <mesh name="stoveRingBurner" rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[eye, flare, 48]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.4} />
      </mesh>
      <mesh name="stoveRingRim" position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[flare - 0.09, flare, 48]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.9} />
      </mesh>
      <mesh name="stoveRingEye" position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[eye, eye + 0.07, 32]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.9} />
      </mesh>
      <mesh name="stoveRingFront" ref={front} position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.94, 1, 44]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.75} />
      </mesh>
      <HobRing eye={eye} flare={flare} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Clothes airer
// ---------------------------------------------------------------------------
// Stands along the lane rather than across it, and it only catches a runner
// moving sideways. Running straight past it at full speed is free; the dodge
// every sweeper on the roster demands is what folds it onto you. Put one beside
// a hammer or a rotating toilet and the sidestep those force becomes the trap.

const AIRER = WAVE_B_HAZARD.clothes_airer;
const AIRER_LEAN_MS = WAVE_B_SCHEDULE.clothesAirer.leanMs;
const AIRER_FOLD_MS = WAVE_B_SCHEDULE.clothesAirer.foldMs;
const AIRER_STUMBLE_MS = WAVE_B_SCHEDULE.clothesAirer.stumbleMs;
const AIRER_LENGTH_FALLBACK = 2.1;
const AIRER_SIDESTEP_FALLBACK = 2.6;
/** Half-width of the strip either side of the frame that the arms cover. */
const AIRER_CATCH_HALF = 0.5;
const AIRER_HEIGHT = 1.1;
/** Share of the runner's sideways speed the frame takes out of them. */
const AIRER_CATCH = 0.85;
const AIRER_SLAM = 3.6;

export function ClothesAirerTrap({
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
  const frame = useRef<Group>(null);
  const band = useRef<Mesh>(null);
  const lastFold = useRef(0);
  const foldedAt = useRef(0);
  const length = Math.max(0.8, trapNumber(trap, "length", AIRER_LENGTH_FALLBACK));
  const sidestep = Math.max(0.5, trapNumber(trap, "sidestep", AIRER_SIDESTEP_FALLBACK));
  const forward = useMemo(() => trapForward(trap.rotationY), [trap.rotationY]);

  useEffect(() => {
    lastFold.current = 0;
    foldedAt.current = 0;
  }, [startedAt]);

  useFrame(() => {
    const now = performance.now();
    const armed = now - lastFold.current > AIRER.gateMs;
    const target = player.current;
    let drift = 0;
    let side = 1;
    if (isLive(target) && armed) {
      const p = target.translation();
      const v = target.linvel();
      const dx = p.x - trap.position[0];
      const dz = p.z - trap.position[2];
      const along = dx * forward.x + dz * forward.z;
      const lateral = dx * forward.z - dz * forward.x;
      const lateralSpeed = v.x * forward.z - v.z * forward.x;
      const inside =
        Math.abs(along) < length / 2 &&
        Math.abs(lateral) < AIRER_CATCH_HALF &&
        p.y - trap.position[1] < AIRER_HEIGHT;
      if (inside) {
        drift = Math.min(1, Math.abs(lateralSpeed) / sidestep);
        side = lateralSpeed >= 0 ? 1 : -1;
      }
      if (inside && Math.abs(lateralSpeed) > sidestep) {
        lastFold.current = now;
        foldedAt.current = now;
        const mass = target.mass();
        const scale = (mass > 0 ? mass : 1) * AIRER_CATCH * lateralSpeed;
        // Their own sideways speed is what folds it, so the harder the dodge
        // the harder the landing.
        target.applyImpulse(
          { x: -forward.z * scale, y: -AIRER_SLAM, z: forward.x * scale },
          true,
        );
        soapUntilRef.current = Math.max(soapUntilRef.current, now + AIRER_STUMBLE_MS);
        contact(trap, onHazard, AIRER.impulse);
        mechanic(trap, onMechanic, "airer_folded", Math.abs(lateralSpeed));
      }
    }

    const folding = now - foldedAt.current < AIRER_FOLD_MS;
    if (frame.current) {
      // Leans toward whichever way the runner is drifting, in proportion, so
      // "this is about to fold on you" is readable while there is still room.
      const wanted = folding ? 1.2 * side : drift * 0.35 * side;
      const rate = folding ? 1 : Math.min(1, AIRER_LEAN_MS / 1000);
      frame.current.rotation.z += (wanted - frame.current.rotation.z) * rate * 0.35;
    }
    if (band.current) {
      const material = band.current.material as MeshBasicMaterial;
      material.opacity = armed ? 0.3 + drift * 0.55 : 0.14;
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
      <CuboidCollider args={[0.1, 0.4, length / 2]} position={[0, 0.4, 0]} sensor />
      {/* The strip the arms cover, at the width and length the fold test uses:
          long down the lane and narrow across it, which is what makes running
          straight through it free. */}
      <mesh name="clothesAirerStrip" ref={band} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[AIRER_CATCH_HALF * 2, length]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.3} />
      </mesh>
      {[-1, 1].map((end) => (
        <mesh
          key={end}
          name={`clothesAirerEnd${end}`}
          position={[0, 0.026, (end * length) / 2]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[AIRER_CATCH_HALF * 2, 0.08]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.85} />
        </mesh>
      ))}
      <group ref={frame}>
        <ClothesAirer span={length} height={AIRER_HEIGHT} />
      </group>
    </RigidBody>
  );
}

// ---------------------------------------------------------------------------
// Ice dispenser
// ---------------------------------------------------------------------------
// One magazine and then it is furniture, which is the only trap here the player
// can spend deliberately. Clipping the far edge of the lane and backing out
// costs a second and empties it for the rest of the run; walking into the
// middle of it costs the biggest single hit on the roster. The mousetrap
// disarms itself too, but nothing can reach the mousetrap from a safe distance,
// so nothing else on the roster can be baited.

const ICE = WAVE_B_HAZARD.ice_dispenser;
const ICE_SPIN_UP_MS = WAVE_B_SCHEDULE.iceDispenser.spinUpMs;
const ICE_VOLLEY_MS = WAVE_B_SCHEDULE.iceDispenser.volleyMs;
const ICE_RANGE_FALLBACK = 4.5;
const ICE_SPREAD_FALLBACK = 1.3;
/** Half-width of the lane the dispenser watches and dumps down. */
const ICE_LANE_HALF = 1.2;
const ICE_HEIGHT = 1.6;
const ICE_SHOVE = 5.6;
const ICE_SLAM = 2.4;

type IcePhase = "loaded" | "spinning" | "dumping" | "spent";

export function IceDispenserTrap({
  trap,
  player,
  trapBodies,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const body = useRef<RapierRigidBody>(null);
  useRegisterTrapBody(body, trapBodies, trap.id);
  const lane = useRef<Mesh>(null);
  const drop = useRef<Group>(null);
  const cubes = useRef<Group>(null);
  const phase = useRef<IcePhase>("loaded");
  const phaseAt = useRef(0);
  const seen = useRef({ x: trap.position[0], z: trap.position[2] });
  const aim = useRef({ x: trap.position[0], z: trap.position[2] });
  const range = Math.max(1, trapNumber(trap, "range", ICE_RANGE_FALLBACK));
  const spread = Math.max(0.4, trapNumber(trap, "spread", ICE_SPREAD_FALLBACK));
  const forward = useMemo(() => trapForward(trap.rotationY), [trap.rotationY]);

  useEffect(() => {
    phase.current = "loaded";
    phaseAt.current = 0;
    seen.current = { x: trap.position[0], z: trap.position[2] };
  }, [startedAt, trap.position]);

  useFrame(() => {
    const now = performance.now();
    const target = player.current;
    let inLane = false;
    if (isLive(target)) {
      const p = target.translation();
      const dx = p.x - trap.position[0];
      const dz = p.z - trap.position[2];
      const along = dx * forward.x + dz * forward.z;
      const lateral = dx * forward.z - dz * forward.x;
      inLane =
        along > 0 &&
        along < range &&
        Math.abs(lateral) < ICE_LANE_HALF &&
        p.y - trap.position[1] < ICE_HEIGHT;
      if (inLane) seen.current = { x: p.x, z: p.z };
    }
    const since = now - phaseAt.current;

    if (phase.current === "loaded") {
      if (inLane) {
        phase.current = "spinning";
        phaseAt.current = now;
        mechanic(trap, onMechanic, "ice_spinning", ICE_SPIN_UP_MS);
      }
    } else if (phase.current === "spinning" && since >= ICE_SPIN_UP_MS) {
      phase.current = "dumping";
      phaseAt.current = now;
      // Dumped at the last place the runner was actually in the lane, so a bait
      // run is paid for with the second it takes rather than being free.
      aim.current = { ...seen.current };
    } else if (phase.current === "dumping" && since >= ICE_VOLLEY_MS) {
      phase.current = "spent";
      phaseAt.current = now;
      if (isLive(target)) {
        const p = target.translation();
        const dx = p.x - aim.current.x;
        const dz = p.z - aim.current.z;
        const distance = Math.hypot(dx, dz);
        if (distance < spread && p.y - trap.position[1] < ICE_HEIGHT) {
          const away = Math.max(distance, 0.25);
          target.applyImpulse(
            { x: (dx / away) * ICE_SHOVE, y: -ICE_SLAM, z: (dz / away) * ICE_SHOVE },
            true,
          );
          contact(trap, onHazard, ICE.impulse);
          mechanic(trap, onMechanic, "ice_dumped", ICE.impulse);
        } else {
          mechanic(trap, onMechanic, "ice_baited", 0);
        }
      }
    }

    const state = phase.current;
    if (lane.current) {
      const material = lane.current.material as MeshBasicMaterial;
      // A spent trap has to look spent, the way the extension cord lies slack.
      material.opacity =
        state === "spent" ? 0.08 : state === "spinning" ? 0.3 + blink(since, 90) * 0.45 : 0.4;
    }
    if (drop.current) {
      drop.current.visible = state === "dumping";
      drop.current.position.set(aim.current.x, trap.position[1] + 0.03, aim.current.z);
    }
    if (cubes.current) {
      const falling = state === "dumping";
      cubes.current.visible = falling;
      if (falling) {
        const u = Math.min(1, since / ICE_VOLLEY_MS);
        cubes.current.position.set(
          lerp(trap.position[0], aim.current.x, u),
          trap.position[1] + lerp(1.5, 0.2, u * u),
          lerp(trap.position[2], aim.current.z, u),
        );
      }
    }
  }, TRAP_FRAME_PRIORITY);

  return (
    <>
      <group
        position={[trap.position[0], trap.position[1] + 0.02, trap.position[2]]}
        rotation={[0, trap.rotationY, 0]}
      >
        {/* The lane it watches and dumps down, at the length and width the
            trigger test uses. */}
        <mesh name="iceDispenserLane" ref={lane} position={[0, 0, range / 2]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[ICE_LANE_HALF * 2, range]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.4} />
        </mesh>
      </group>
      <group ref={drop} visible={false} position={[trap.position[0], trap.position[1] + 0.03, trap.position[2]]}>
        <mesh name="iceDispenserImpact" rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[spread, 30]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.55} />
        </mesh>
      </group>
      <group ref={cubes} visible={false}>
        <IceCube />
      </group>
      <RigidBody
        ref={body}
        type="fixed"
        colliders={false}
        position={[trap.position[0], trap.position[1], trap.position[2]]}
        rotation={[0, trap.rotationY, 0]}
      >
        <CuboidCollider args={[0.5, 0.9, 0.4]} position={[0, 0.9, 0]} />
        <IceDispenser />
      </RigidBody>
    </>
  );
}

// ---------------------------------------------------------------------------
// Boiling kettle
// ---------------------------------------------------------------------------
// Armed by the attempt clock rather than by the runner. It is scenery for the
// first eighteen seconds of every run and scalds on a beat for the rest, so a
// fast line never meets it at all and a slow one meets it every time. Nothing
// else on the roster charges for the clock, and the fill is drawn at the full
// reach from the first frame, which makes it the one trap a player can read
// from the far end of the course.

const KETTLE = WAVE_B_HAZARD.kettle_boil;
const KETTLE_BOIL_MS = WAVE_B_SCHEDULE.kettleBoil.boilMs;
const KETTLE_SCALD_MS = WAVE_B_SCHEDULE.kettleBoil.scaldMs;
const KETTLE_SCALD_FALLBACK = 1.9;
const KETTLE_HEIGHT = 1.4;
const KETTLE_SHOVE = 4;
const KETTLE_SLAM = 1.8;
/** Everything before this in a boil cycle is the swell you can read. */
const KETTLE_SURGE_AT_MS = KETTLE.gateMs - KETTLE_SCALD_MS;

export function KettleBoilTrap({
  trap,
  player,
  trapBodies,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const body = useRef<RapierRigidBody>(null);
  useRegisterTrapBody(body, trapBodies, trap.id);
  const level = useRef<Mesh>(null);
  const surge = useRef<Mesh>(null);
  const firedCycle = useRef(-1);
  const scald = Math.max(0.6, trapNumber(trap, "scald", KETTLE_SCALD_FALLBACK));

  useEffect(() => {
    firedCycle.current = -1;
  }, [startedAt]);

  useFrame(() => {
    const elapsed = elapsedMs(startedAt);
    const heating = Math.min(1, elapsed / KETTLE_BOIL_MS);
    const armed = elapsed >= KETTLE_BOIL_MS;
    const since = elapsed - KETTLE_BOIL_MS;
    const cycle = armed ? Math.floor(since / KETTLE.gateMs) : -1;
    const phase = armed ? since % KETTLE.gateMs : 0;

    if (armed && phase >= KETTLE_SURGE_AT_MS && firedCycle.current !== cycle) {
      firedCycle.current = cycle;
      mechanic(trap, onMechanic, "kettle_boiled", scald);
      const target = player.current;
      if (isLive(target)) {
        const p = target.translation();
        const dx = p.x - trap.position[0];
        const dz = p.z - trap.position[2];
        const distance = Math.hypot(dx, dz);
        if (distance < scald && p.y - trap.position[1] < KETTLE_HEIGHT) {
          const away = Math.max(distance, 0.25);
          target.applyImpulse(
            { x: (dx / away) * KETTLE_SHOVE, y: -KETTLE_SLAM, z: (dz / away) * KETTLE_SHOVE },
            true,
          );
          contact(trap, onHazard, KETTLE.impulse);
          mechanic(trap, onMechanic, "kettle_scalded", KETTLE.impulse);
        }
      }
    }

    // Before it arms, the disc is how close to the boil it is and therefore the
    // clock. After it arms, it is the swell before each scald. Same reach both
    // times, so the ring never has to move.
    if (level.current)
      level.current.scale.setScalar(Math.max(0.001, armed ? 1 : heating));
    if (surge.current) {
      const boiling = armed && phase >= KETTLE_SURGE_AT_MS;
      surge.current.visible = armed;
      surge.current.scale.setScalar(
        Math.max(0.001, boiling ? 1 : Math.min(1, phase / KETTLE_SURGE_AT_MS)),
      );
    }
  }, TRAP_FRAME_PRIORITY);

  return (
    <>
      <group position={[trap.position[0], trap.position[1] + 0.02, trap.position[2]]}>
        <mesh name="kettleBoilReach" rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[scald - 0.12, scald, 48]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.5} />
        </mesh>
        <mesh name="kettleBoilLevel" ref={level} position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[scald - 0.14, 36]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.2} />
        </mesh>
        <mesh name="kettleBoilSurge" ref={surge} visible={false} position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[scald - 0.2, scald - 0.08, 40]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.8} />
        </mesh>
      </group>
      <RigidBody
        ref={body}
        type="fixed"
        colliders={false}
        position={[trap.position[0], trap.position[1], trap.position[2]]}
        rotation={[0, trap.rotationY, 0]}
      >
        <CuboidCollider args={[0.3, 0.35, 0.3]} position={[0, 0.35, 0]} />
        <Kettle />
      </RigidBody>
    </>
  );
}

// ---------------------------------------------------------------------------
// Junk drift
// ---------------------------------------------------------------------------
// Priced as one of the weakest things on the roster and worth placing anyway,
// because its reach is set by how much else is standing near it. In an empty
// zone it is a scrap of rubbish with a footprint smaller than the soap. Dropped
// into a corner somebody has already filled with four traps, it is the widest
// thing there. It rewards reading the course somebody else built rather than
// hunting for a gap in it.

const DUST = WAVE_B_HAZARD.junk_drift;
const DUST_CHARGE_MS = WAVE_B_SCHEDULE.junkDrift.chargeMs;
const DUST_LUNGE_MS = WAVE_B_SCHEDULE.junkDrift.lungeMs;
const DUST_BASE_FALLBACK = 0.75;
const DUST_FEED_FALLBACK = 4.5;
/** Metres of reach per neighbouring body, and the count it stops counting at. */
const DUST_PER_NEIGHBOUR = 0.42;
const DUST_NEIGHBOUR_CAP = 4;
const DUST_HEIGHT = 1;
const DUST_SHOVE = 3.4;
const DUST_LIFT = 1.4;

export function JunkDriftTrap({
  trap,
  player,
  trapBodies,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const rim = useRef<Mesh>(null);
  const charge = useRef<Mesh>(null);
  const fluff = useRef<Group>(null);
  const firedCycle = useRef(-1);
  const base = Math.max(0.3, trapNumber(trap, "base", DUST_BASE_FALLBACK));
  const feed = Math.max(1, trapNumber(trap, "feed", DUST_FEED_FALLBACK));

  useEffect(() => {
    firedCycle.current = -1;
  }, [startedAt]);

  useFrame(() => {
    const elapsed = elapsedMs(startedAt);
    const cycle = Math.floor(elapsed / DUST.gateMs);
    const phase = elapsed % DUST.gateMs;

    // Everything registered in trapBodies is a proxy for clutter: other traps,
    // and the loose props some of them leave behind. It is read every frame
    // because a rolling fridge or a spilled sock can arrive mid-run.
    let neighbours = 0;
    for (const [id, other] of trapBodies.current) {
      if (id === trap.id || neighbours >= DUST_NEIGHBOUR_CAP) continue;
      if (!isLive(other)) continue;
      const at = other.translation();
      if (Math.hypot(at.x - trap.position[0], at.z - trap.position[2]) < feed) neighbours += 1;
    }
    const reach = base + DUST_PER_NEIGHBOUR * neighbours;

    if (phase >= DUST_CHARGE_MS && firedCycle.current !== cycle) {
      firedCycle.current = cycle;
      mechanic(trap, onMechanic, "dust_lunged", reach);
      const target = player.current;
      if (isLive(target)) {
        const p = target.translation();
        const dx = p.x - trap.position[0];
        const dz = p.z - trap.position[2];
        const distance = Math.hypot(dx, dz);
        if (distance < reach && p.y - trap.position[1] < DUST_HEIGHT) {
          const away = Math.max(distance, 0.25);
          target.applyImpulse(
            { x: (dx / away) * DUST_SHOVE, y: DUST_LIFT, z: (dz / away) * DUST_SHOVE },
            true,
          );
          contact(trap, onHazard, DUST.impulse);
          mechanic(trap, onMechanic, "dust_caught", DUST.impulse);
        }
      }
    }

    if (rim.current) rim.current.scale.setScalar(reach);
    if (charge.current) {
      const closing = Math.min(1, phase / DUST_CHARGE_MS);
      const lunging = phase >= DUST_CHARGE_MS && phase < DUST_CHARGE_MS + DUST_LUNGE_MS;
      charge.current.scale.setScalar(Math.max(0.001, reach * (lunging ? 1 : closing)));
      charge.current.visible = lunging ? blink(phase, 70) > 0.5 : true;
    }
    // The ball of fluff carries the same number, so how fed it is reads off the
    // prop as well as off the floor.
    if (fluff.current) fluff.current.scale.setScalar(reach * 0.45);
  }, TRAP_FRAME_PRIORITY);

  return (
    <group position={[trap.position[0], trap.position[1], trap.position[2]]} rotation={[0, trap.rotationY, 0]}>
      <mesh name="junkDriftReach" ref={rim} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.9, 1, 40]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.6} />
      </mesh>
      <mesh name="junkDriftCharge" ref={charge} position={[0, 0.026, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.88, 30]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.24} />
      </mesh>
      <group ref={fluff} position={[0, 0.16, 0]}>
        <JunkDrift />
      </group>
    </group>
  );
}
