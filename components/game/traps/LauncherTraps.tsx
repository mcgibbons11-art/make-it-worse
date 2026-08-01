"use client";
import { useFrame } from "@react-three/fiber";
import {
  BallCollider,
  CuboidCollider,
  CylinderCollider,
  RigidBody,
  type CollisionEnterPayload,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import { Euler, Quaternion, Vector3, type Group, type Mesh, type Object3D } from "three";
import { AudioManager } from "@/lib/audio/AudioManager";
import { PALETTE, PLAYER } from "@/lib/game/constants";
import { createSeededRandom, lerp } from "@/lib/game/seed";
import { TRAP_CATALOG } from "@/lib/game/trap-catalog";
import type { HazardContact, TrapInstance } from "@/lib/game/types";
import {
  createApartmentToasterModel,
  type ProceduralModelRuntime,
} from "../models/createToasterModel";
import type { TrapMechanicEvent } from "../TrapRenderer";
import { AssetModel } from "../AssetModel";

// TrapRenderer keeps its TrapProps interface local to that file. This is the
// same shape, declared again rather than exported from there, so the renderer
// stays untouched. TrapMechanicEvent is imported because it is already public.
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
  impulse = 10,
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
 * Tuned value for this trap instance, falling back to the catalog default and
 * then to the caller's literal. The catalog stays the single source of truth
 * for balance; the literal only covers a param the catalog never defined.
 */
function trapParam(trap: TrapInstance, key: string, fallback: number): number {
  const value = trap.params[key] ?? TRAP_CATALOG[trap.type].defaultParams[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Seconds since the attempt began. Every schedule in this file is a pure
 * function of this value, so a retry replays the same trap timing frame for
 * frame no matter what the display refresh rate is.
 */
function elapsedSeconds(startedAt: number): number {
  return Math.max(0, performance.now() - startedAt) / 1000;
}

/** World-space forward of a trap, matching the convention in TrapRenderer. */
function trapForward(rotationY: number) {
  return { x: Math.sin(rotationY), z: Math.cos(rotationY) };
}

// ---------------------------------------------------------------------------
// Toaster launcher
// ---------------------------------------------------------------------------
// The appliance is the img2threejs Apartment Toaster. Its model space runs
// x [-0.85, 1.03] (the lever knob is the overhang), y [0, 1.31], z [-0.71,
// 0.71], with the origin on the counter surface and the front facing +Z.

const TOASTER_MODEL_HALF_WIDTH = 0.85;
const TOASTER_MODEL_HEIGHT = 1.31;
const TOASTER_MODEL_HALF_DEPTH = 0.71;
/** Shrinks a 1.7-unit-wide appliance to something a runner can vault past. */
const TOASTER_SCALE = 0.62;
const TOASTER_HALF_HEIGHT = (TOASTER_MODEL_HEIGHT * TOASTER_SCALE) / 2;
const TOASTER_MUZZLE_SOCKET = "slot-cavity:toast-eject";
/** Socket height in model space, used only if the model stops carrying it. */
const TOASTER_MUZZLE_FALLBACK_Y = 1.3308;
const TOASTER_LEVER_NODE = "Lever knob__pivot";
/** How far the carriage lever rides down its channel, in model units. */
const TOASTER_LEVER_TRAVEL = 0.34;
/** The lever presses down over this long, then snaps up as the toast leaves. */
const TOASTER_WINDUP_SECONDS = 0.35;
const TOASTER_RECOIL_SECONDS = 0.22;
const TOASTER_RECOIL_DROP = 0.07;
/** 256 is the factory's floor; the maps are noise, and this one is background. */
const TOASTER_TEXTURE_SIZE = 256;

const TOAST_POOL_SIZE = 3;
const TOAST_LIFETIME_MS = 1800;
const TOAST_MASS = 0.25;
/** Clears the bezel so a slice never spawns inside the deck it launches from. */
const TOAST_MUZZLE_CLEARANCE = 0.12;
const TOAST_UP_FRACTION = 0.8;
const TOAST_FORWARD_FRACTION = 0.55;
const TOAST_HALF_EXTENTS: [number, number, number] = [0.17, 0.18, 0.04];
const TOAST_IMPULSE = 8;
/** Toasters fire on a timer whether or not anyone is near, so the ding is local. */
const TOASTER_AUDIBLE_RANGE = 12;
const TOASTER_DING_HZ = 880;
/** The crust is darker than anything in the level palette carries. */
const TOAST_CRUST = "#d8752f";

interface ToasterPrototype {
  template: Group;
  muzzle: Vector3;
}

let toasterPrototypeCache: ToasterPrototype | null = null;

/**
 * One built toaster for the whole session. The factory rasterises five
 * procedural maps per material, which is far too much work to repeat for every
 * toaster in a level, so instances clone this template and share its geometries
 * and materials. Object3D.copy JSON round-trips userData and the sculpt runtime
 * holds circular Object3D references, so that payload is stripped before the
 * first clone; the socket it carries is read out first.
 */
function toasterPrototype(): ToasterPrototype {
  if (toasterPrototypeCache) return toasterPrototypeCache;
  const root = createApartmentToasterModel({
    textureSize: TOASTER_TEXTURE_SIZE,
    qualityPriority: "balanced",
  });
  root.updateMatrixWorld(true);
  const runtime = root.userData.sculptRuntime as ProceduralModelRuntime | undefined;
  const socket = runtime?.sockets[TOASTER_MUZZLE_SOCKET];
  const muzzle = socket
    ? socket.getWorldPosition(new Vector3())
    : new Vector3(0, TOASTER_MUZZLE_FALLBACK_Y, 0);
  root.traverse((object) => {
    object.userData = {};
  });
  toasterPrototypeCache = { template: root, muzzle };
  return toasterPrototypeCache;
}

export function ToasterLauncherTrap({
  trap,
  player,
  trapBodies,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const body = useRef<RapierRigidBody>(null);
  useRegisterTrapBody(body, trapBodies, trap.id);
  const interval = Math.max(0.6, trapParam(trap, "interval", 2.4));
  const muzzleSpeed = Math.max(1, trapParam(trap, "muzzleSpeed", 9));
  const aim = useMemo(() => {
    const random = createSeededRandom(trap.seed);
    return {
      // A fixed sideways bias per toaster, so each one has an aim the player
      // can learn rather than a spray that changes every shot.
      spread: lerp(-0.16, 0.16, random()),
      tumble: lerp(6, 11, random()) * (random() > 0.5 ? 1 : -1),
    };
  }, [trap.seed]);

  const prototype = useMemo(() => toasterPrototype(), []);
  const model = useMemo(() => prototype.template.clone(true), [prototype]);
  const lever = useRef<Object3D | null>(null);
  const leverRestY = useRef(0);
  useEffect(() => {
    const node = model.getObjectByName(TOASTER_LEVER_NODE) ?? null;
    lever.current = node;
    leverRestY.current = node?.position.y ?? 0;
  }, [model]);

  const muzzle = useMemo(() => {
    const forward = trapForward(trap.rotationY);
    const local = prototype.muzzle;
    return {
      x:
        trap.position[0] +
        (local.x * forward.z + local.z * forward.x) * TOASTER_SCALE,
      y: trap.position[1] + local.y * TOASTER_SCALE + TOAST_MUZZLE_CLEARANCE,
      z:
        trap.position[2] +
        (local.z * forward.z - local.x * forward.x) * TOASTER_SCALE,
    };
  }, [prototype, trap.position, trap.rotationY]);

  // Three parallel ref arrays rather than one array of slot objects: a value
  // handed back by useMemo may not be mutated after render, and every one of
  // these fields changes as slices are fired and retired.
  const toastBodies = useRef<Array<RapierRigidBody | null>>([]);
  const toastVisuals = useRef<Array<Group | null>>([]);
  /** performance.now() a slice leaves play; 0 or absent means parked. */
  const toastRetireAt = useRef<number[]>([]);
  const nextSlot = useRef(0);
  // Launch 0 lands on elapsed 0, which is the starting gun; the first slice
  // leaves one interval later.
  const lastLaunch = useRef(0);
  const primed = useRef(false);

  useFrame(() => {
    const now = performance.now();
    const elapsed = elapsedSeconds(startedAt);
    // Parked here rather than in an effect: this runs ahead of the first
    // physics step, so the pool never gets a frame of gravity, and it cannot
    // race the child RigidBody handing its body back through the ref.
    if (!primed.current) {
      primed.current = true;
      for (let slot = 0; slot < TOAST_POOL_SIZE; slot += 1) {
        const toast = toastBodies.current[slot];
        if (isLive(toast)) toast.setEnabled(false);
        const visual = toastVisuals.current[slot];
        if (visual) visual.visible = false;
        toastRetireAt.current[slot] = 0;
      }
    }
    for (let slot = 0; slot < TOAST_POOL_SIZE; slot += 1) {
      const retireAt = toastRetireAt.current[slot] ?? 0;
      if (retireAt === 0 || now < retireAt) continue;
      toastRetireAt.current[slot] = 0;
      const visual = toastVisuals.current[slot];
      if (visual) visual.visible = false;
      const toast = toastBodies.current[slot];
      if (isLive(toast)) toast.setEnabled(false);
    }

    const index = Math.floor(elapsed / interval);
    if (index > lastLaunch.current) {
      lastLaunch.current = index;
      const slot = nextSlot.current % TOAST_POOL_SIZE;
      nextSlot.current += 1;
      const toast = toastBodies.current[slot];
      if (isLive(toast)) {
        const forward = trapForward(trap.rotationY);
        const lateral = { x: forward.z, z: -forward.x };
        const speed = muzzleSpeed * TOAST_FORWARD_FRACTION;
        toast.setEnabled(true);
        toast.setTranslation(muzzle, true);
        toast.setRotation(
          new Quaternion().setFromEuler(new Euler(0, trap.rotationY, 0)),
          true,
        );
        toast.setLinvel(
          {
            x: forward.x * speed + lateral.x * muzzleSpeed * aim.spread,
            y: muzzleSpeed * TOAST_UP_FRACTION,
            z: forward.z * speed + lateral.z * muzzleSpeed * aim.spread,
          },
          true,
        );
        toast.setAngvel(
          { x: lateral.x * aim.tumble, y: 0, z: lateral.z * aim.tumble },
          true,
        );
        toastRetireAt.current[slot] = now + TOAST_LIFETIME_MS;
        const visual = toastVisuals.current[slot];
        if (visual) visual.visible = true;
        mechanic(trap, onMechanic, "toast_launched", muzzleSpeed);
        const target = player.current;
        if (isLive(target)) {
          const p = target.translation();
          if (
            Math.hypot(p.x - muzzle.x, p.z - muzzle.z) < TOASTER_AUDIBLE_RANGE
          ) {
            AudioManager.tone(TOASTER_DING_HZ, 0.12, {
              wave: "triangle",
              gain: 0.045,
            });
          }
        }
      }
    }

    // Both of these read the schedule rather than a stored animation clock, so
    // the wind-up telegraphs the same shot on every attempt.
    const untilNext = interval - (elapsed % interval);
    const drop =
      untilNext < TOASTER_WINDUP_SECONDS
        ? 1 - untilNext / TOASTER_WINDUP_SECONDS
        : 0;
    const leverNode = lever.current;
    if (leverNode) {
      leverNode.position.y = leverRestY.current - drop * TOASTER_LEVER_TRAVEL;
    }
    const sinceLaunch = elapsed % interval;
    const recoil =
      elapsed >= interval && sinceLaunch < TOASTER_RECOIL_SECONDS
        ? 1 - sinceLaunch / TOASTER_RECOIL_SECONDS
        : 0;
    body.current?.setNextKinematicTranslation({
      x: trap.position[0],
      y: trap.position[1] + TOASTER_HALF_HEIGHT - recoil * TOASTER_RECOIL_DROP,
      z: trap.position[2],
    });
  }, -100);

  return (
    <>
      <RigidBody
        ref={body}
        type="kinematicPosition"
        colliders={false}
        position={[
          trap.position[0],
          trap.position[1] + TOASTER_HALF_HEIGHT,
          trap.position[2],
        ]}
        rotation={[0, trap.rotationY, 0]}
      >
        <CuboidCollider
          args={[
            TOASTER_MODEL_HALF_WIDTH * TOASTER_SCALE,
            TOASTER_HALF_HEIGHT,
            TOASTER_MODEL_HALF_DEPTH * TOASTER_SCALE,
          ]}
        />
        <primitive
          object={model}
          dispose={null}
          scale={TOASTER_SCALE}
          position={[0, -TOASTER_HALF_HEIGHT, 0]}
        />
      </RigidBody>
      {Array.from({ length: TOAST_POOL_SIZE }, (_, slot) => (
        <RigidBody
          key={`toast-${slot}`}
          ref={(rigid: RapierRigidBody | null) => {
            toastBodies.current[slot] = rigid;
          }}
          type="dynamic"
          colliders={false}
          canSleep={false}
          ccd
          restitution={0.24}
          friction={0.6}
          gravityScale={PLAYER.gravityScale}
          position={[muzzle.x, muzzle.y, muzzle.z]}
          onCollisionEnter={(event) => {
            if (!playerCollision(event)) return;
            if ((toastRetireAt.current[slot] ?? 0) === 0) return;
            contact(trap, onHazard, TOAST_IMPULSE);
            mechanic(trap, onMechanic, "toast_contact", TOAST_IMPULSE);
            // Parked on the next frame rather than mid-step, which is the only
            // moment rapier is happy to have a body pulled out of the world.
            toastRetireAt.current[slot] = performance.now();
          }}
        >
          {/* On the RigidBody this prop is stripped by the library, leaving the
              slice at its own volume (~0.0098kg) instead of TOAST_MASS. */}
          <CuboidCollider args={TOAST_HALF_EXTENTS} mass={TOAST_MASS} />
          <group
            ref={(group: Group | null) => {
              toastVisuals.current[slot] = group;
            }}
          >
            <mesh name="toastSlice" castShadow position={[0, -0.04, 0]}>
              <boxGeometry args={[0.34, 0.28, 0.08]} />
              <meshStandardMaterial color={TOAST_CRUST} roughness={0.88} />
            </mesh>
            {/* A full disc whose lower half is buried in the slice, which is a
                domed crust from every angle and has no open theta face. */}
            <mesh
              name="toastCrown"
              castShadow
              position={[0, 0.1, 0]}
              rotation={[Math.PI / 2, 0, 0]}
            >
              <cylinderGeometry args={[0.17, 0.17, 0.08, 12]} />
              <meshStandardMaterial color={TOAST_CRUST} roughness={0.88} />
            </mesh>
            <mesh name="toastButter" position={[0, 0, 0.045]}>
              <boxGeometry args={[0.14, 0.12, 0.03]} />
              <meshStandardMaterial color={PALETTE.yellow} roughness={0.7} />
            </mesh>
          </group>
        </RigidBody>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Ceiling fan
// ---------------------------------------------------------------------------
// Hung above head height on purpose: a runner walks under it untouched, and
// only a jump puts a head in the blade plane.

const CEILING_FAN_HEIGHT = 2.6;
const CEILING_FAN_BLADE_COUNT = 4;
const CEILING_FAN_BLADE_HALF_WIDTH = 0.19;
const CEILING_FAN_BLADE_HALF_THICKNESS = 0.04;
const CEILING_FAN_HUB_RADIUS = 0.26;
/** Each blade sits at this angle about its own long axis, like a real one. */
const CEILING_FAN_BLADE_PITCH = 0.16;
const CEILING_FAN_ROD_HEIGHT = 0.7;
const CEILING_FAN_GLOBE_RADIUS = 0.24;
const CEILING_FAN_IMPULSE = 12;

export function CeilingFanTrap({
  trap,
  trapBodies,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const body = useRef<RapierRigidBody>(null);
  useRegisterTrapBody(body, trapBodies, trap.id);
  const radius = Math.max(0.6, trapParam(trap, "radius", 1.5));
  const speed = Math.max(0.2, trapParam(trap, "speed", 1.9));
  const sweep = useMemo(() => {
    const random = createSeededRandom(trap.seed);
    return {
      direction: random() > 0.5 ? 1 : -1,
      phase: random() * Math.PI * 2,
    };
  }, [trap.seed]);
  const reported = useRef(false);
  const bladeLength = Math.max(0.1, radius - CEILING_FAN_HUB_RADIUS);

  useFrame(() => {
    const angle =
      elapsedSeconds(startedAt) * speed * sweep.direction + sweep.phase;
    body.current?.setNextKinematicRotation(
      new Quaternion().setFromEuler(new Euler(0, angle + trap.rotationY, 0)),
    );
    if (!reported.current) {
      reported.current = true;
      mechanic(trap, onMechanic, "sweep_started", speed);
    }
  }, -100);

  return (
    <>
      {/* Reading a hazard you have to jump into is hard from the floor, so the
          sweep prints its footprint on the ground below it. */}
      <mesh
        name="ceilingFanFootprint"
        position={[trap.position[0], trap.position[1] + 0.03, trap.position[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry args={[radius - 0.14, radius, 36]} />
        <meshBasicMaterial color={PALETTE.blue} transparent opacity={0.3} />
      </mesh>
      <RigidBody
        ref={body}
        type="kinematicPosition"
        colliders={false}
        position={[
          trap.position[0],
          trap.position[1] + CEILING_FAN_HEIGHT,
          trap.position[2],
        ]}
        rotation={[0, trap.rotationY, 0]}
        onCollisionEnter={(event) => {
          if (playerCollision(event)) {
            contact(trap, onHazard, CEILING_FAN_IMPULSE);
            mechanic(trap, onMechanic, "sweep_contact", CEILING_FAN_IMPULSE);
          }
        }}
      >
        {/* Two crossed bars cover all four blades without a rotated collider. */}
        <CuboidCollider
          args={[radius, CEILING_FAN_BLADE_HALF_THICKNESS, CEILING_FAN_BLADE_HALF_WIDTH]}
        />
        <CuboidCollider
          args={[CEILING_FAN_BLADE_HALF_WIDTH, CEILING_FAN_BLADE_HALF_THICKNESS, radius]}
        />
        {/* Without this the dead centre would be a free square to jump through. */}
        <BallCollider args={[CEILING_FAN_GLOBE_RADIUS]} position={[0, -0.22, 0]} />
        {Array.from({ length: CEILING_FAN_BLADE_COUNT }, (_, index) => (
          <group
            key={index}
            rotation={[0, (index * Math.PI * 2) / CEILING_FAN_BLADE_COUNT, 0]}
          >
            <mesh
              name={`ceilingFanBlade${index}`}
              castShadow
              position={[CEILING_FAN_HUB_RADIUS + bladeLength / 2, 0, 0]}
              rotation={[CEILING_FAN_BLADE_PITCH, 0, 0]}
            >
              <boxGeometry
                args={[
                  bladeLength,
                  CEILING_FAN_BLADE_HALF_THICKNESS * 2,
                  CEILING_FAN_BLADE_HALF_WIDTH * 2,
                ]}
              />
              <meshStandardMaterial color={PALETTE.orange} roughness={0.82} />
            </mesh>
            <mesh
              name={`ceilingFanBladeArm${index}`}
              castShadow
              position={[CEILING_FAN_HUB_RADIUS * 0.8, 0.02, 0]}
            >
              <boxGeometry args={[CEILING_FAN_HUB_RADIUS, 0.05, 0.1]} />
              <meshStandardMaterial color={PALETTE.cream} roughness={0.75} />
            </mesh>
          </group>
        ))}
        <mesh name="ceilingFanHub" castShadow>
          <cylinderGeometry
            args={[CEILING_FAN_HUB_RADIUS, CEILING_FAN_HUB_RADIUS * 0.85, 0.2, 12]}
          />
          <meshStandardMaterial color={PALETTE.cream} roughness={0.76} />
        </mesh>
        <mesh name="ceilingFanGlobe" castShadow position={[0, -0.22, 0]}>
          <sphereGeometry args={[CEILING_FAN_GLOBE_RADIUS, 12, 10]} />
          <meshStandardMaterial color={PALETTE.yellow} roughness={0.7} />
        </mesh>
        <mesh name="ceilingFanRod" position={[0, CEILING_FAN_ROD_HEIGHT / 2, 0]}>
          <cylinderGeometry args={[0.06, 0.06, CEILING_FAN_ROD_HEIGHT, 8]} />
          <meshStandardMaterial color={PALETTE.muted} roughness={0.7} />
        </mesh>
        <mesh
          name="ceilingFanCanopy"
          position={[0, CEILING_FAN_ROD_HEIGHT, 0]}
        >
          <cylinderGeometry args={[0.3, 0.18, 0.14, 12]} />
          <meshStandardMaterial color={PALETTE.muted} roughness={0.75} />
        </mesh>
      </RigidBody>
    </>
  );
}

// ---------------------------------------------------------------------------
// Banana peel
// ---------------------------------------------------------------------------

const BANANA_RADIUS = 0.55;
/** A jumped peel is a cleared peel, so the trigger only covers standing height. */
const BANANA_HEIGHT_WINDOW = 1.15;
const BANANA_SLIP_MS = 1200;
const BANANA_COOLDOWN_MS = 1400;
const BANANA_FLIP_SECONDS = 0.9;
const BANANA_FLIP_HEIGHT = 0.85;
/** Share of the launch that throws the runner back down the course. */
const BANANA_BACKWARD_FRACTION = 0.6;
const BANANA_IMPULSE = 6;
const BANANA_STRIP_COUNT = 3;
/** The bruised tip of a peel; nothing in the level palette is this brown. */
const BANANA_BRUISE = "#8a6a3a";

export function BananaPeelTrap({
  trap,
  player,
  soapUntilRef,
  onHazard,
  onMechanic,
}: TrapProps) {
  const peel = useRef<Group>(null);
  const last = useRef(0);
  const flip = useRef(0);
  const launch = Math.max(0.5, trapParam(trap, "launch", 5.5));

  useFrame((_, delta) => {
    if (flip.current <= 0) return;
    flip.current = Math.max(0, flip.current - delta);
    const progress = 1 - flip.current / BANANA_FLIP_SECONDS;
    const group = peel.current;
    if (!group) return;
    group.position.y = Math.sin(progress * Math.PI) * BANANA_FLIP_HEIGHT;
    // Four half turns, so the peel lands the same way up it started.
    group.rotation.x = progress * Math.PI * 4;
  });

  useFrame(() => {
    const target = player.current;
    if (!isLive(target)) return;
    const now = performance.now();
    if (now - last.current < BANANA_COOLDOWN_MS) return;
    const p = target.translation();
    if (
      Math.hypot(p.x - trap.position[0], p.z - trap.position[2]) >
        BANANA_RADIUS ||
      p.y > trap.position[1] + BANANA_HEIGHT_WINDOW
    ) {
      return;
    }
    const forward = trapForward(trap.rotationY);
    last.current = now;
    flip.current = BANANA_FLIP_SECONDS;
    soapUntilRef.current = now + BANANA_SLIP_MS;
    // One impulse, one time. The slip is what lingers, not the shove.
    target.applyImpulse(
      {
        x: -forward.x * launch * BANANA_BACKWARD_FRACTION,
        y: launch,
        z: -forward.z * launch * BANANA_BACKWARD_FRACTION,
      },
      true,
    );
    contact(trap, onHazard, BANANA_IMPULSE);
    mechanic(trap, onMechanic, "banana_launch", launch);
  }, -100);

  return (
    <group
      position={[trap.position[0], trap.position[1] + 0.02, trap.position[2]]}
      rotation={[0, trap.rotationY, 0]}
    >
      {/* The slip radius, which reaches well past the peel itself, so the peel
          being visible is not the same as the reach being visible. It was drawn
          in PALETTE.yellow, which measures 1.01:1 against the worst deck in
          DECK_COLORS and is therefore no marking at all on a light floor.
          Alpha matters as much as hue here: the deck shows through, and danger
          only clears MIN_CONTRAST from about 0.7 up. At 0.75 this composites to
          roughly 3.4:1 on the worst deck. */}
      <mesh name="bananaZone" rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[BANANA_RADIUS - 0.09, BANANA_RADIUS, 26]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.75} />
      </mesh>
      <group ref={peel}>
        <mesh name="bananaCore" castShadow position={[0, 0.05, 0]} scale={[1, 0.36, 1]}>
          <sphereGeometry args={[0.17, 10, 8]} />
          <meshStandardMaterial color={PALETTE.yellow} roughness={0.72} />
        </mesh>
        {Array.from({ length: BANANA_STRIP_COUNT }, (_, index) => (
          <group
            key={index}
            rotation={[0, (index * Math.PI * 2) / BANANA_STRIP_COUNT, 0]}
          >
            <mesh
              name={`bananaStrip${index}`}
              castShadow
              position={[0, 0.05, 0.2]}
              rotation={[-0.32, 0, 0]}
            >
              <boxGeometry args={[0.14, 0.05, 0.34]} />
              <meshStandardMaterial color={PALETTE.yellow} roughness={0.72} />
            </mesh>
            <mesh name={`bananaTip${index}`} position={[0, 0.12, 0.36]}>
              <boxGeometry args={[0.11, 0.045, 0.07]} />
              <meshStandardMaterial color={BANANA_BRUISE} roughness={0.85} />
            </mesh>
          </group>
        ))}
        <mesh name="bananaStem" castShadow position={[0, 0.12, 0]}>
          <cylinderGeometry args={[0.035, 0.05, 0.12, 6]} />
          <meshStandardMaterial color={BANANA_BRUISE} roughness={0.85} />
        </mesh>
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Robot mop
// ---------------------------------------------------------------------------

const MOP_RADIUS = 0.36;
const MOP_HALF_HEIGHT = 0.1;
/** Clears the floor so the disc never grinds into it. */
const MOP_GROUND_CLEARANCE = 0.02;
/** How long the floor stays wet behind the mop. */
const MOP_TRAIL_MS = 1200;
/** Past positions tested along the wet stretch. */
const MOP_TRAIL_SAMPLES = 5;
const MOP_TRAIL_HALF_WIDTH = 0.55;
/** Refreshed every frame the runner is on the wet stretch, as the soap does. */
const MOP_SLIP_MS = 150;
const MOP_SLIP_HEIGHT = 1.3;
const MOP_BUMP_IMPULSE = 4.5;
const MOP_IMPULSE = 7;
const MOP_CONTACT_COOLDOWN_MS = 500;
const MOP_REPORT_COOLDOWN_MS = 450;
const MOP_BRUSH_COUNT = 6;
const MOP_BRUSH_SPEED = 5.5;
// The brush ring survives the swap to the sculpted mop, and it has to.
//
// The sculpt's own floor-facing part is "Microfibre fringe skirt", and it is real geometry
// rather than the degenerate stub this factory used to ship: measured, it spans y 0 to 0.0364
// out to radius 0.3419. But it is a full solid of revolution, so turning it about Y changes
// nothing on screen. Driving the sculpt's skirt instead of these boxes would keep
// MOP_BRUSH_SPEED alive in code while deleting the only thing that makes the mop look like it
// is running.
//
// Seated by measurement, not by eye. Mounted at -MOP_HALF_HEIGHT the skirt occupies body-local
// y -0.1 to -0.0636 at radius 0.3419, and the brushes ride at radius 0.216, so they sit
// directly under it. At the old 0.05 height and y -0.1 the boxes spanned -0.125 to -0.075 and
// drove 0.025 up into the skirt: coincident surfaces at the same radius, which is z-fighting on
// the one face the chase camera can see under a low disc. Dropped to 0.04 tall centred at
// -0.12, they span -0.14 to -0.10 and stop exactly on the skirt's underside. That reaches
// 0.02 below the deck line against 0.005 before, which is inside MOP_GROUND_CLEARANCE and reads
// as bristles sweeping the floor.
const MOP_BRUSH_HEIGHT = 0.04;
const MOP_BRUSH_Y = -0.12;

/**
 * Signed distance from the trap origin along its forward axis. A triangle wave
 * keeps the speed constant through the turn, and reading it straight off
 * elapsed time means the mop is in the same place on every attempt.
 */
function patrolOffset(
  elapsed: number,
  patrol: number,
  speed: number,
  phase: number,
): number {
  const period = (2 * patrol) / speed;
  const cycles = (elapsed + phase * period) / period;
  const wrapped = cycles - Math.floor(cycles);
  const triangle = wrapped < 0.5 ? wrapped * 2 : 2 - wrapped * 2;
  return (triangle - 0.5) * patrol;
}

export function RobotMopTrap({
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
  const trail = useRef<Mesh>(null);
  const brushes = useRef<Group>(null);
  const travelSign = useRef(1);
  const lastBump = useRef(0);
  const lastSlip = useRef(0);
  const patrol = Math.max(0.4, trapParam(trap, "patrol", 2.2));
  const speed = Math.max(0.2, trapParam(trap, "speed", 1.6));
  const phase = useMemo(() => createSeededRandom(trap.seed)(), [trap.seed]);
  const forward = useMemo(() => trapForward(trap.rotationY), [trap.rotationY]);
  const trailSeconds = MOP_TRAIL_MS / 1000;

  useFrame(() => {
    const now = performance.now();
    const elapsed = elapsedSeconds(startedAt);
    const offset = patrolOffset(elapsed, patrol, speed, phase);
    const behind = patrolOffset(
      Math.max(0, elapsed - trailSeconds),
      patrol,
      speed,
      phase,
    );
    body.current?.setNextKinematicTranslation({
      x: trap.position[0] + forward.x * offset,
      y: trap.position[1] + MOP_HALF_HEIGHT + MOP_GROUND_CLEARANCE,
      z: trap.position[2] + forward.z * offset,
    });
    travelSign.current = offset >= behind ? 1 : -1;
    if (brushes.current) brushes.current.rotation.y = elapsed * MOP_BRUSH_SPEED;
    // The wet patch is exactly the stretch the disc covered in the last
    // MOP_TRAIL_MS, so the decal is drawn between then and now.
    if (trail.current) {
      trail.current.position.z = (offset + behind) / 2;
      trail.current.scale.y = Math.max(0.05, Math.abs(offset - behind));
    }

    const target = player.current;
    if (!isLive(target)) return;
    const p = target.translation();
    if (p.y > trap.position[1] + MOP_SLIP_HEIGHT) return;
    for (let index = 0; index <= MOP_TRAIL_SAMPLES; index += 1) {
      const sampled = patrolOffset(
        Math.max(0, elapsed - (index / MOP_TRAIL_SAMPLES) * trailSeconds),
        patrol,
        speed,
        phase,
      );
      const x = trap.position[0] + forward.x * sampled;
      const z = trap.position[2] + forward.z * sampled;
      if (Math.hypot(p.x - x, p.z - z) > MOP_TRAIL_HALF_WIDTH) continue;
      soapUntilRef.current = now + MOP_SLIP_MS;
      if (now - lastSlip.current > MOP_REPORT_COOLDOWN_MS) {
        lastSlip.current = now;
        mechanic(trap, onMechanic, "polish_slip", MOP_TRAIL_HALF_WIDTH);
      }
      return;
    }
  }, -100);

  return (
    <>
      <group
        position={[trap.position[0], trap.position[1] + 0.02, trap.position[2]]}
        rotation={[0, trap.rotationY, 0]}
      >
        <mesh name="mopLane" rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[MOP_TRAIL_HALF_WIDTH * 2, patrol + MOP_RADIUS * 2]} />
          <meshBasicMaterial color={PALETTE.muted} transparent opacity={0.18} />
        </mesh>
        {/* Unit height, stretched each frame to cover what is still wet. */}
        <mesh name="mopWetTrail" ref={trail} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
          <planeGeometry args={[MOP_TRAIL_HALF_WIDTH * 2, 1]} />
          <meshBasicMaterial color="#72dffd" transparent opacity={0.55} />
        </mesh>
      </group>
      <RigidBody
        ref={body}
        type="kinematicPosition"
        colliders={false}
        position={[
          trap.position[0],
          trap.position[1] + MOP_HALF_HEIGHT + MOP_GROUND_CLEARANCE,
          trap.position[2],
        ]}
        rotation={[0, trap.rotationY, 0]}
        onCollisionEnter={(event) => {
          if (!playerCollision(event)) return;
          const now = performance.now();
          if (now - lastBump.current < MOP_CONTACT_COOLDOWN_MS) return;
          lastBump.current = now;
          contact(trap, onHazard, MOP_IMPULSE);
          mechanic(trap, onMechanic, "mop_bump", MOP_IMPULSE);
          // Shoved the way the mop is travelling, once per contact. Deferred a
          // microtask because onCollisionEnter runs inside world.contactPair
          // with the world borrowed - an inline applyImpulse re-enters wasm
          // and borrow-poisons the whole physics world (see GameScene's
          // hazard knockback for the full story).
          const sign = travelSign.current;
          queueMicrotask(() => {
            const target = player.current;
            if (!isLive(target)) return;
            target.applyImpulse(
              {
                x: forward.x * sign * MOP_BUMP_IMPULSE,
                y: 1.2,
                z: forward.z * sign * MOP_BUMP_IMPULSE,
              },
              true,
            );
          });
        }}
      >
        <CylinderCollider args={[MOP_HALF_HEIGHT, MOP_RADIUS]} />
        {/* The shell, lid, bumper torus and eye that used to sit here are all parts of the
            sculpted mop now. It measures 0.72 x 0.1635 x 0.7196 on its own base, so its
            radius IS MOP_RADIUS; the mount offset is here because this body's origin is the
            shell centre while the sculpt sits on its base. */}
        <AssetModel model="mop" position={[0, -MOP_HALF_HEIGHT, 0]} />
        <group ref={brushes} position={[0, MOP_BRUSH_Y, 0]}>
          {Array.from({ length: MOP_BRUSH_COUNT }, (_, index) => (
            <mesh
              key={index}
              name={`mopBrush${index}`}
              position={[
                Math.sin((index * Math.PI * 2) / MOP_BRUSH_COUNT) * MOP_RADIUS * 0.6,
                0,
                Math.cos((index * Math.PI * 2) / MOP_BRUSH_COUNT) * MOP_RADIUS * 0.6,
              ]}
            >
              <boxGeometry args={[0.13, MOP_BRUSH_HEIGHT, 0.13]} />
              <meshStandardMaterial color={PALETTE.yellow} roughness={0.85} />
            </mesh>
          ))}
        </group>
      </RigidBody>
    </>
  );
}
