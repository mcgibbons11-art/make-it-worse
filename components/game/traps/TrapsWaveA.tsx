"use client";
import { useFrame } from "@react-three/fiber";
import {
  CuboidCollider,
  RigidBody,
  type CollisionEnterPayload,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import type { Group, Mesh, MeshBasicMaterial } from "three";
import { AudioManager } from "@/lib/audio/AudioManager";
import { PALETTE } from "@/lib/game/constants";
import { createSeededRandom, lerp } from "@/lib/game/seed";
import { TRAP_CATALOG } from "@/lib/game/trap-catalog";
import type { HazardContact, TrapInstance } from "@/lib/game/types";
import type { TrapMechanicEvent } from "@/components/game/TrapRenderer";
import {
  AnkleWeightCuff,
  BuntingFlag,
  CatFlapFrame,
  CatFlapLeaf,
  ConveyorBelt,
  catFlapHinge,
  DominoTile,
  DustBunny,
  FloorGrate,
  FloorVent,
  LaundryChuteBody,
  LaundryChuteHatch,
  MotionSensorHead,
  MotionSensorPost,
  PlateStack,
  ProppedMattress,
  ShoppingTrolley,
  SinkBasin,
  TiltPlateBoard,
  TiltPlatePivot,
  WallPipe,
} from "./TrapProps";

/**
 * Sixteen traps whose verbs the roster did not already have.
 *
 * The twenty-two that ship already sweep, launch, push, slip, chase, pull,
 * spray, snap, aim-then-commit, burst, brake, gate on speed, gate on a clock
 * and arm on contact. These sixteen instead: carry a runner along a surface,
 * tip under their weight, fire only at movement, sit inert until another trap
 * shoves them, catch only a runner who is airborne, rotate which third of a
 * lane is unsafe, make their noise at the end they will not burst at, clamp on
 * and tax the rest of the attempt, put a runner down somewhere they did not
 * choose, mirror a sidestep instead of closing distance, walk the line the
 * runner walked a moment ago, widen the longer the run takes, lift only a
 * runner already off the deck, hand back the runner's own speed reversed, turn
 * one contact into a floor that stays ruined, and hurt at a middling speed
 * while a crawl and a sprint both pass.
 *
 * WHAT IS AUTHORED HERE AND WHAT IS NOT. Physics, contact, repeat gating and
 * the hazard telegraphs are authored in this file: a telegraph is gameplay
 * signalling, it has to be sized from the same named constant the hit test
 * uses, and it is drawn in PALETTE.danger, which is reserved for hazard reach.
 * The prop each trap is dressed in is NOT authored here. Props are lit, and a
 * lit material in this file would mean a prop had been built where only
 * telegraphs belong, so each one lives in traps/TrapProps.tsx and is mounted by
 * name. Every trap here mounts a prop of its own: these sixteen used to share
 * seven sculpted meshes through AssetModel, which made a laundry chute arrive
 * as a refrigerator and a floor grate as a bar of soap.
 *
 * Where a trap animates part of its prop, the moving part is a separate export
 * and only that part goes inside the group the frame loop turns. The sensor
 * head pans and its post does not; the chute hatch swings and its wall does
 * not; the cat flap leaf swings and its surround does not.
 *
 * Conventions carried over from traps/NewTraps.tsx:
 *
 * - TrapRenderer keeps TrapProps local to that file, so the shape is declared
 *   again here rather than exported from there.
 * - Rapier accumulates `addForce` and nothing in this project resets it, so
 *   every sustained push is `applyImpulse(force * step)` with `step` clamped:
 *   one-shot, and independent of the display refresh rate.
 * - Every schedule is a pure function of the time since the attempt began, so
 *   a retry replays the same timing frame for frame.
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
 * which it can report again while the runner stays in reach. `gateMs: null` is
 * a trap that can only ever land once in an attempt.
 *
 * These two numbers are the entire input to the riskWeight rule documented at
 * the top of lib/game/trap-catalog.ts, and every component below reads its
 * cycle length or cooldown straight out of this table, so a trap cannot change
 * what it does to a runner without the catalogue price moving with it.
 * tests/unit/traps-wave-a.test.ts re-runs that rule against this table.
 */
export const WAVE_A_HAZARD = {
  conveyor_strip: { impulse: 6, gateMs: 800 },
  tilt_plate: { impulse: 10, gateMs: 2000 },
  motion_sensor: { impulse: 9, gateMs: 1800 },
  domino_line: { impulse: 13, gateMs: 4000 },
  bunting_line: { impulse: 12, gateMs: 1800 },
  steam_vents: { impulse: 9, gateMs: 1100 },
  pipe_burst: { impulse: 13, gateMs: 2600 },
  // The one trap here that cannot repeat. The weights clamp on the first time
  // they are touched and then tax every step for the rest of the attempt, so
  // the rule prices the single clamp and misses the tax entirely. See the
  // second known limitation above TRAP_CATALOG: that is a gap in the rule, not
  // a licence to hand-tune this row upward.
  ankle_weight: { impulse: 9, gateMs: null },
  chute_drop: { impulse: 11, gateMs: 3400 },
  cart_blocker: { impulse: 9, gateMs: 1500 },
  dust_bunny: { impulse: 6, gateMs: 1200 },
  flood_puddle: { impulse: 5, gateMs: 1100 },
  updraft_vent: { impulse: 4, gateMs: 1200 },
  mattress_rebound: { impulse: 11, gateMs: 1500 },
  plate_shards: { impulse: 10, gateMs: 1500 },
  cat_flap: { impulse: 11, gateMs: 2000 },
} as const satisfies Record<string, { impulse: number; gateMs: number | null }>;

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
 * the reported impulse and the repeat gate stay in WAVE_A_HAZARD, because a
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

/**
 * Four of the wind-ups below are a marker brightening rather than growing, and
 * `mesh.material` is typed as `Material | Material[]` because a mesh can carry
 * a group per face. Every marker in this file is a single meshBasicMaterial.
 */
function fadeMarker(mesh: Mesh | null, opacity: number) {
  if (mesh) (mesh.material as MeshBasicMaterial).opacity = opacity;
}

/**
 * A ground marker built from circleGeometry or ringGeometry lies in the XY
 * plane and is rotated -PI/2 about X to lie flat, which maps its local +X to
 * world +X and its local +Y to world -Z. A wedge centred on the trap's own
 * forward (+Z inside a group rotated by trap.rotationY) therefore starts at
 * -PI/2 - half its angle. Two traps need this, so it is named once.
 */
const GROUND_WEDGE_CENTRE = -Math.PI / 2;

// ---------------------------------------------------------------------------
// Conveyor strip
// ---------------------------------------------------------------------------
// VERB: carries whoever is standing on it along its own axis at a set speed,
// so the cost is paid by holding position rather than by being hit.
// NOT the floor fan: the fan adds a force that falls off with distance and can
// be leaned against from outside it. The belt is a surface with a hard edge -
// it steers the runner's velocity toward the belt speed while they are on it,
// leaves their steering authority completely intact, and does nothing at all
// one step off the strip. A runner sprinting with the belt is held back by it
// exactly as much as a runner sprinting against it is dragged.

const CONVEYOR = WAVE_A_HAZARD.conveyor_strip;
const CONVEYOR_CARRY_FALLBACK = 3.4;
const CONVEYOR_LENGTH_FALLBACK = 2.4;
const CONVEYOR_WIDTH_FALLBACK = 1.5;
/** Above this the runner has jumped clear, as with the other floor hazards. */
const CONVEYOR_HEIGHT = 1.2;
/** The belt idles at this share of its speed and surges to full on the gate. */
const CONVEYOR_IDLE_SHARE = 0.4;
const CONVEYOR_SURGE_MS = 260;
/** The blink before a surge: the wind-up, in the same colour as the reach. */
const CONVEYOR_WARN_MS = 220;
/** How hard the belt pulls the runner's speed toward its own, per second. */
const CONVEYOR_GRIP = 6;
const CONVEYOR_CHEVRONS = 5;

export function ConveyorStripTrap({
  trap,
  player,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const chevrons = useRef<Group>(null);
  const surgeMark = useRef<Mesh>(null);
  const deck = useRef<Group>(null);
  const reportedCycle = useRef(-1);
  const carry = Math.max(0.5, trapNumber(trap, "carry", CONVEYOR_CARRY_FALLBACK));
  const length = Math.max(0.8, trapNumber(trap, "length", CONVEYOR_LENGTH_FALLBACK));
  const width = Math.max(0.6, trapNumber(trap, "width", CONVEYOR_WIDTH_FALLBACK));
  const forward = useMemo(() => trapForward(trap.rotationY), [trap.rotationY]);

  useEffect(() => {
    reportedCycle.current = -1;
  }, [startedAt]);

  useFrame((_, delta) => {
    const step = Math.min(delta, MAX_STEP);
    const elapsed = elapsedMs(startedAt);
    const cycle = Math.floor(elapsed / CONVEYOR.gateMs);
    const phase = elapsed % CONVEYOR.gateMs;
    const surging = phase < CONVEYOR_SURGE_MS;
    const belt = carry * (surging ? 1 : CONVEYOR_IDLE_SHARE);
    const target = player.current;
    if (isLive(target)) {
      const p = target.translation();
      const dx = p.x - trap.position[0];
      const dz = p.z - trap.position[2];
      const along = dx * forward.x + dz * forward.z;
      const lateral = dx * forward.z - dz * forward.x;
      if (
        Math.abs(along) < length / 2 &&
        Math.abs(lateral) < width / 2 &&
        p.y - trap.position[1] < CONVEYOR_HEIGHT
      ) {
        const velocity = target.linvel();
        const mass = target.mass();
        const carried = velocity.x * forward.x + velocity.z * forward.z;
        // Steers the along-axis speed toward the belt's, never past it, so the
        // strip can move a standing runner and hold back a sprinting one with
        // the same expression and cannot fling anybody.
        const pull = (belt - carried) * Math.min(1, CONVEYOR_GRIP * step) * (mass > 0 ? mass : 1);
        target.applyImpulse(
          { x: forward.x * pull, y: 0, z: forward.z * pull },
          true,
        );
        if (surging && reportedCycle.current !== cycle) {
          reportedCycle.current = cycle;
          contact(trap, onHazard, CONVEYOR.impulse);
          mechanic(trap, onMechanic, "belt_carried", belt);
        }
      }
    }
    if (chevrons.current) {
      // Scrolls at the belt's real speed, so how fast it is running and which
      // way it is running are both readable before stepping on.
      const travel = length / CONVEYOR_CHEVRONS;
      chevrons.current.position.z = ((elapsed / 1000) * belt) % travel;
    }
    if (surgeMark.current) {
      const untilSurge = CONVEYOR.gateMs - phase;
      const warning = untilSurge < CONVEYOR_WARN_MS;
      surgeMark.current.visible = surging || warning;
      surgeMark.current.scale.setScalar(
        surging ? 1 : Math.max(0.001, 1 - untilSurge / CONVEYOR_WARN_MS),
      );
    }
    if (deck.current) deck.current.position.y = surging ? 0.01 : 0;
  }, TRAP_FRAME_PRIORITY);

  return (
    <group
      position={[trap.position[0], trap.position[1], trap.position[2]]}
      rotation={[0, trap.rotationY, 0]}
    >
      <mesh name="conveyorStripReach" position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width, length]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.38} />
      </mesh>
      {/* The hard edge. Four strips laid exactly on the lines the hit test cuts
          at, rather than a four-segment ring: a square ring's flats sit at
          cos(45 degrees) of its radius, so it would have drawn the belt 30 per
          cent narrower than it is. */}
      {[-1, 1].map((side) => (
        <mesh
          key={`side-${side}`}
          name={`conveyorStripEdgeX${side}`}
          position={[(side * width) / 2, 0.026, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[0.07, length]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.85} />
        </mesh>
      ))}
      {[-1, 1].map((end) => (
        <mesh
          key={`end-${end}`}
          name={`conveyorStripEdgeZ${end}`}
          position={[0, 0.026, (end * length) / 2]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[width, 0.07]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.85} />
        </mesh>
      ))}
      <mesh
        name="conveyorStripSurge"
        ref={surgeMark}
        position={[0, 0.03, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        visible={false}
      >
        <planeGeometry args={[width * 0.9, length * 0.94]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.3} />
      </mesh>
      <group ref={chevrons}>
        {Array.from({ length: CONVEYOR_CHEVRONS }, (_, index) => (
          <mesh
            key={index}
            name={`conveyorStripChevron${index}`}
            position={[0, 0.034, -length / 2 + (index * length) / CONVEYOR_CHEVRONS]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <ringGeometry args={[0.1, 0.22, 3, 1, GROUND_WEDGE_CENTRE - 0.6, 1.2]} />
            <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.9} />
          </mesh>
        ))}
      </group>
      <group ref={deck}>
        <ConveyorBelt width={width} length={length} />
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Tilting plate
// ---------------------------------------------------------------------------
// VERB: pivots under a runner who lingers on it and dumps them off the side
// they loaded, so the direction of the fall is chosen by where they stood.
// NOT the trick rug: the rug arms on contact and always yanks the same way, so
// once learnt it is a fixed answer. The plate has no fixed answer - it is a
// balance the runner is inside, the loaded side is whichever side they are on,
// and moving to the other half of the plate genuinely unloads it.

const TILT = WAVE_A_HAZARD.tilt_plate;
const TILT_PLATE_FALLBACK = 0.9;
const TILT_TIP_FALLBACK = 4.2;
const TILT_HEIGHT = 1.1;
/** How long a side has to stay loaded before the plate goes over. */
const TILT_ARM_MS = 420;
/** Dead zone around the pivot where neither side is loaded. */
const TILT_BALANCE = 0.15;
const TILT_RESET_MS = 900;
const TILT_SLAM = 2.4;
/** Radians the plate rolls when fully over. Visual, and the wind-up. */
const TILT_MAX_ANGLE = 0.3;

export function TiltPlateTrap({
  trap,
  player,
  soapUntilRef,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const board = useRef<Group>(null);
  const loadBar = useRef<Mesh>(null);
  const load = useRef(0);
  const loadedSince = useRef(0);
  const loadedSide = useRef(0);
  const tippedAt = useRef(0);
  const lastReport = useRef(0);
  const plate = Math.max(0.4, trapNumber(trap, "plate", TILT_PLATE_FALLBACK));
  const tip = Math.max(1, trapNumber(trap, "tip", TILT_TIP_FALLBACK));
  const forward = useMemo(() => trapForward(trap.rotationY), [trap.rotationY]);

  useEffect(() => {
    load.current = 0;
    loadedSince.current = 0;
    loadedSide.current = 0;
    tippedAt.current = 0;
    lastReport.current = 0;
  }, [startedAt]);

  useFrame((_, delta) => {
    const now = performance.now();
    const step = Math.min(delta, MAX_STEP);
    const settling = now - tippedAt.current < TILT_RESET_MS;
    const target = player.current;
    let side = 0;
    let onPlate = false;
    if (isLive(target) && !settling) {
      const p = target.translation();
      const dx = p.x - trap.position[0];
      const dz = p.z - trap.position[2];
      const along = dx * forward.x + dz * forward.z;
      const lateral = dx * forward.z - dz * forward.x;
      if (
        Math.abs(along) < plate &&
        Math.abs(lateral) < plate &&
        p.y - trap.position[1] < TILT_HEIGHT
      ) {
        onPlate = true;
        const offset = lateral / plate;
        if (Math.abs(offset) > TILT_BALANCE) side = Math.sign(offset);
      }
    }
    if (side !== 0 && side === loadedSide.current) {
      if (now - loadedSince.current >= TILT_ARM_MS) {
        tippedAt.current = now;
        loadedSince.current = 0;
        loadedSide.current = 0;
        mechanic(trap, onMechanic, "plate_tipped", side);
        if (onPlate && isLive(target)) {
          // Thrown off the low side, which is the side they loaded.
          target.applyImpulse(
            {
              x: forward.z * side * tip,
              y: -TILT_SLAM,
              z: -forward.x * side * tip,
            },
            true,
          );
          soapUntilRef.current = Math.max(soapUntilRef.current, now + TILT_RESET_MS / 2);
          if (now - lastReport.current > TILT.gateMs) {
            lastReport.current = now;
            contact(trap, onHazard, TILT.impulse);
            mechanic(trap, onMechanic, "plate_dumped", TILT.impulse);
          }
        }
      }
    } else if (side !== 0) {
      loadedSide.current = side;
      loadedSince.current = now;
    } else {
      loadedSide.current = 0;
      loadedSince.current = 0;
    }

    const arming =
      loadedSide.current !== 0 && loadedSince.current > 0
        ? Math.min(1, (now - loadedSince.current) / TILT_ARM_MS)
        : 0;
    const settle = settling ? 1 - (now - tippedAt.current) / TILT_RESET_MS : 0;
    const goal = settling ? 0 : loadedSide.current * arming;
    load.current += (goal - load.current) * Math.min(1, step * 8);
    if (board.current) {
      const roll = load.current * TILT_MAX_ANGLE + settle * Math.sin(now / 40) * 0.03;
      board.current.rotation.z = roll;
    }
    if (loadBar.current) {
      // Slides toward the loading side and grows with how close the tip is, so
      // the wind-up says which way as well as how soon.
      loadBar.current.position.x = load.current * plate * 0.7;
      loadBar.current.scale.set(Math.max(0.001, Math.abs(load.current)), 1, 1);
      loadBar.current.visible =
        arming < 0.82 || Math.floor(now / 70) % 2 === 0;
    }
  }, TRAP_FRAME_PRIORITY);

  return (
    <group
      position={[trap.position[0], trap.position[1], trap.position[2]]}
      rotation={[0, trap.rotationY, 0]}
    >
      <mesh name="tiltPlateReach" position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[plate * 2, plate * 2]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.34} />
      </mesh>
      {/* Strips on the four lines the hit test cuts at. See the belt: a
          four-segment ring would have drawn the plate narrower than it is. */}
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh
            name={`tiltPlateEdgeX${side}`}
            position={[side * plate, 0.026, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <planeGeometry args={[0.07, plate * 2]} />
            <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.8} />
          </mesh>
          <mesh
            name={`tiltPlateEdgeZ${side}`}
            position={[0, 0.026, side * plate]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <planeGeometry args={[plate * 2, 0.07]} />
            <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.8} />
          </mesh>
        </group>
      ))}
      {/* The pivot the plate rolls about, drawn so the two halves read. */}
      <mesh name="tiltPlatePivot" position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.07, plate * 2]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.9} />
      </mesh>
      <mesh
        name="tiltPlateLoad"
        ref={loadBar}
        position={[0, 0.034, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[plate * 1.2, plate * 1.3]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.45} />
      </mesh>
      {/* The ridge is what the board rolls ON, so it stays outside the group
          that rolls. Both are drawn where tiltPlatePivot above is. */}
      <TiltPlatePivot half={plate} />
      <group ref={board} position={[0, 0.1, 0]}>
        <TiltPlateBoard half={plate} />
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Motion sensor
// ---------------------------------------------------------------------------
// VERB: samples its cone on a clock and fires only at a runner who is moving
// faster than a crawl at the moment it looks, so standing still is the escape.
// NOT the extension cord: the cord is a line you either cross fast or do not
// cross, and slowing for it costs a fraction of a second. The sensor is a
// volume you have to be inside, and beating it means holding still through a
// sample - it charges time rather than position, and it is the only hazard in
// the game that a completely stationary runner is safe from.

const SENSOR = WAVE_A_HAZARD.motion_sensor;
const SENSOR_REACH_FALLBACK = 3.2;
/** Half-angle of the cone, radians. */
const SENSOR_ARC_FALLBACK = 0.55;
/** At or under this the runner is invisible to it. */
const SENSOR_STILL_FALLBACK = 1.4;
/** Where in the cycle the sample lands. Everything before it is warning. */
const SENSOR_SAMPLE_MS = 1400;
const SENSOR_WARN_MS = 520;
const SENSOR_PUSH = 5.2;
const SENSOR_LIFT = 1.6;
const SENSOR_HEIGHT = 2.2;

export function MotionSensorTrap({
  trap,
  player,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const wedge = useRef<Mesh>(null);
  const lamp = useRef<Group>(null);
  const firedCycle = useRef(-1);
  const reach = Math.max(1, trapNumber(trap, "reach", SENSOR_REACH_FALLBACK));
  const arc = Math.min(Math.PI, Math.max(0.15, trapNumber(trap, "arc", SENSOR_ARC_FALLBACK)));
  const stillSpeed = Math.max(0.2, trapNumber(trap, "stillSpeed", SENSOR_STILL_FALLBACK));
  const forward = useMemo(() => trapForward(trap.rotationY), [trap.rotationY]);

  useEffect(() => {
    firedCycle.current = -1;
  }, [startedAt]);

  useFrame(() => {
    const elapsed = elapsedMs(startedAt);
    const cycle = Math.floor(elapsed / SENSOR.gateMs);
    const phase = elapsed % SENSOR.gateMs;

    if (phase >= SENSOR_SAMPLE_MS && firedCycle.current !== cycle) {
      firedCycle.current = cycle;
      const target = player.current;
      if (isLive(target)) {
        const p = target.translation();
        const dx = p.x - trap.position[0];
        const dz = p.z - trap.position[2];
        const distance = Math.hypot(dx, dz);
        const along = dx * forward.x + dz * forward.z;
        const velocity = target.linvel();
        const speed = Math.hypot(velocity.x, velocity.z);
        const inCone =
          distance < reach &&
          distance > 0.01 &&
          Math.acos(Math.min(1, Math.max(-1, along / distance))) < arc &&
          p.y - trap.position[1] < SENSOR_HEIGHT;
        if (inCone && speed > stillSpeed) {
          const away = Math.max(distance, 0.25);
          target.applyImpulse(
            {
              x: (dx / away) * SENSOR_PUSH,
              y: SENSOR_LIFT,
              z: (dz / away) * SENSOR_PUSH,
            },
            true,
          );
          contact(trap, onHazard, SENSOR.impulse);
          mechanic(trap, onMechanic, "sensor_tripped", speed);
        } else {
          mechanic(trap, onMechanic, inCone ? "sensor_held_still" : "sensor_empty", speed);
        }
      }
    }

    if (wedge.current) {
      // Fills across the whole cycle and blinks through the warning window, so
      // "how long until it looks" is legible from the floor.
      const closing = Math.min(1, phase / SENSOR_SAMPLE_MS);
      const warning = phase > SENSOR_SAMPLE_MS - SENSOR_WARN_MS && phase < SENSOR_SAMPLE_MS;
      const blink = warning ? (Math.floor(phase / 80) % 2 === 0 ? 1 : 0.55) : closing;
      wedge.current.scale.setScalar(Math.max(0.001, blink));
    }
    if (lamp.current) lamp.current.rotation.y = Math.sin(elapsed / 260) * arc * 0.4;
  }, TRAP_FRAME_PRIORITY);

  return (
    <group
      position={[trap.position[0], trap.position[1], trap.position[2]]}
      rotation={[0, trap.rotationY, 0]}
    >
      {/* The cone it can see, at the reach and arc the sample actually uses. */}
      <mesh name="motionSensorCone" position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[reach, 30, GROUND_WEDGE_CENTRE - arc, arc * 2]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.24} />
      </mesh>
      <mesh name="motionSensorConeEdge" position={[0, 0.026, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[reach - 0.09, reach, 30, 1, GROUND_WEDGE_CENTRE - arc, arc * 2]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.8} />
      </mesh>
      <mesh name="motionSensorCharge" ref={wedge} position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[reach * 0.96, 26, GROUND_WEDGE_CENTRE - arc * 0.94, arc * 1.88]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.3} />
      </mesh>
      {/* Only the head pans, so the post stays outside the group that turns. */}
      <MotionSensorPost />
      <group ref={lamp} position={[0, 0.05, 0]}>
        <MotionSensorHead />
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Domino line
// ---------------------------------------------------------------------------
// VERB: stands doing nothing until something else pushes into it, then topples
// across the lane as one running rank.
// NOT the mousetrap: the mousetrap arms itself and fires on the runner. The
// rank is the only hazard in the game whose trigger is another trap - a fan
// blowing a beach ball into it, a charging fridge, a patrolling mop, or a
// runner who clipped it on a previous pass all set it off, and a placement next
// to a pusher is worth more than the same placement on its own.

const DOMINO = WAVE_A_HAZARD.domino_line;
const DOMINO_SPAN_FALLBACK = 1.8;
const DOMINO_TILES = 5;
/** How far into the lane the fallen rank reaches. Also the marker's depth. */
const DOMINO_FALL_DEPTH = 0.7;
/** Anything of any kind this close to a tile knocks the rank over. */
const DOMINO_TRIGGER = 0.55;
/** The rank teeters this long before the first tile goes: the wind-up. */
const DOMINO_TEETER_MS = 180;
/** The falling front crosses the span in this. */
const DOMINO_TOPPLE_MS = 520;
const DOMINO_REST_MS = 700;
const DOMINO_RISE_MS = 1200;
const DOMINO_SHOVE = 4.4;
const DOMINO_SLAM = 1.8;
const DOMINO_HEIGHT = 1.2;

type DominoPhase = "standing" | "teetering" | "toppling" | "down" | "rising";

export function DominoLineTrap({
  trap,
  player,
  grabbables,
  trapBodies,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const rank = useRef<Group>(null);
  const front = useRef<Mesh>(null);
  const phase = useRef<DominoPhase>("standing");
  const phaseAt = useRef(0);
  const lastReport = useRef(0);
  const span = Math.max(0.6, trapNumber(trap, "span", DOMINO_SPAN_FALLBACK));
  const forward = useMemo(() => trapForward(trap.rotationY), [trap.rotationY]);

  useEffect(() => {
    phase.current = "standing";
    phaseAt.current = 0;
    lastReport.current = 0;
  }, [startedAt]);

  useFrame(() => {
    const now = performance.now();
    const since = now - phaseAt.current;
    const target = player.current;

    if (phase.current === "standing") {
      // Anything at all: the runner, a grabbable a fan has thrown, or another
      // trap's body that has wandered into the rank.
      let nudged = false;
      const touches = (x: number, z: number) => {
        const dx = x - trap.position[0];
        const dz = z - trap.position[2];
        const along = dx * forward.x + dz * forward.z;
        const lateral = dx * forward.z - dz * forward.x;
        return Math.abs(along) < DOMINO_TRIGGER && Math.abs(lateral) < span / 2 + DOMINO_TRIGGER;
      };
      if (isLive(target)) {
        const p = target.translation();
        if (p.y - trap.position[1] < DOMINO_HEIGHT && touches(p.x, p.z)) nudged = true;
      }
      if (!nudged)
        for (const registry of [grabbables.current, trapBodies.current]) {
          for (const [id, body] of registry) {
            if (id === trap.id || !isLive(body)) continue;
            const p = body.translation();
            if (touches(p.x, p.z)) {
              nudged = true;
              break;
            }
          }
          if (nudged) break;
        }
      if (nudged) {
        phase.current = "teetering";
        phaseAt.current = now;
        mechanic(trap, onMechanic, "dominoes_nudged", span);
      }
    } else if (phase.current === "teetering" && since >= DOMINO_TEETER_MS) {
      phase.current = "toppling";
      phaseAt.current = now;
    } else if (phase.current === "toppling" && since >= DOMINO_TOPPLE_MS) {
      phase.current = "down";
      phaseAt.current = now;
    } else if (phase.current === "down" && since >= DOMINO_REST_MS) {
      phase.current = "rising";
      phaseAt.current = now;
    } else if (phase.current === "rising" && since >= DOMINO_RISE_MS) {
      phase.current = "standing";
      phaseAt.current = now;
    }

    const toppling = phase.current === "toppling";
    const sweep = toppling ? Math.min(1, since / DOMINO_TOPPLE_MS) : phase.current === "down" || phase.current === "rising" ? 1 : 0;
    if ((toppling || phase.current === "down") && isLive(target)) {
      const p = target.translation();
      const dx = p.x - trap.position[0];
      const dz = p.z - trap.position[2];
      const along = dx * forward.x + dz * forward.z;
      const lateral = dx * forward.z - dz * forward.x;
      const fallenTo = -span / 2 + sweep * span;
      if (
        along > -DOMINO_TRIGGER &&
        along < DOMINO_FALL_DEPTH &&
        lateral > -span / 2 &&
        lateral < fallenTo &&
        p.y - trap.position[1] < DOMINO_HEIGHT &&
        now - lastReport.current > DOMINO.gateMs
      ) {
        lastReport.current = now;
        target.applyImpulse(
          { x: forward.x * DOMINO_SHOVE, y: -DOMINO_SLAM, z: forward.z * DOMINO_SHOVE },
          true,
        );
        contact(trap, onHazard, DOMINO.impulse);
        mechanic(trap, onMechanic, "dominoes_struck", DOMINO.impulse);
      }
    }

    if (rank.current) {
      const teeter = phase.current === "teetering" ? Math.min(1, since / DOMINO_TEETER_MS) : 0;
      const rising = phase.current === "rising" ? Math.min(1, since / DOMINO_RISE_MS) : 0;
      const down = phase.current === "down" ? 1 : phase.current === "rising" ? 1 - rising : sweep;
      rank.current.rotation.x = down * (Math.PI / 2 - 0.12) + teeter * 0.1;
      rank.current.position.z = down * DOMINO_FALL_DEPTH * 0.4;
    }
    if (front.current) {
      front.current.visible = toppling;
      if (toppling) front.current.position.x = -span / 2 + sweep * span;
    }
  }, TRAP_FRAME_PRIORITY);

  return (
    <group
      position={[trap.position[0], trap.position[1], trap.position[2]]}
      rotation={[0, trap.rotationY, 0]}
    >
      {/* The band the rank lands in, at the span and depth the hit test uses. */}
      <mesh
        name="dominoLineFallBand"
        position={[0, 0.02, DOMINO_FALL_DEPTH / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[span, DOMINO_FALL_DEPTH + DOMINO_TRIGGER]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.4} />
      </mesh>
      {/* The rank's own footprint, which is also what has to be touched. */}
      <mesh name="dominoLineTrigger" position={[0, 0.026, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[span + DOMINO_TRIGGER * 2, DOMINO_TRIGGER * 2]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.7} />
      </mesh>
      <mesh
        name="dominoLineFront"
        ref={front}
        position={[0, 0.032, DOMINO_FALL_DEPTH / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        visible={false}
      >
        <planeGeometry args={[0.12, DOMINO_FALL_DEPTH]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.95} />
      </mesh>
      <group ref={rank} position={[0, 0.04, 0]}>
        {Array.from({ length: DOMINO_TILES }, (_, index) => (
          <group
            key={index}
            position={[lerp(-span / 2, span / 2, index / (DOMINO_TILES - 1)), 0, 0]}
          >
            <DominoTile />
          </group>
        ))}
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Party bunting
// ---------------------------------------------------------------------------
// VERB: strung above head height, it passes over a runner on the ground and
// catches anyone whose feet have left it.
// NOT the extension cord: the cord is at ankle height and catches a runner for
// being fast, and a jump clears it. This is the exact inverse - it is the only
// hazard on the roster that a jump cannot clear and that walking through is
// completely safe, which turns every launcher, spring pad and banana upstream
// of it into a liability rather than an inconvenience.

const BUNTING = WAVE_A_HAZARD.bunting_line;
const BUNTING_SPAN_FALLBACK = 2;
/** Feet this far off the deck and the line has something to catch. */
const BUNTING_CLEARANCE_FALLBACK = 0.75;
/** Depth of the catching band along the trap's forward axis. */
const BUNTING_BAND_HALF = 0.34;
/** Over this and the runner is above the whole string. */
const BUNTING_CEILING = 2.4;
/** Share of the runner's horizontal speed the line takes out of them. */
const BUNTING_CATCH = 0.68;
const BUNTING_SLAM = 5;
const BUNTING_STUMBLE_MS = 520;
/** The string starts tightening once an airborne runner is inside this. */
const BUNTING_WATCH = 3;
const BUNTING_FLAGS = 6;

export function BuntingLineTrap({
  trap,
  player,
  soapUntilRef,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const flags = useRef<Group>(null);
  const airMark = useRef<Mesh>(null);
  const lastCatch = useRef(0);
  const span = Math.max(0.8, trapNumber(trap, "span", BUNTING_SPAN_FALLBACK));
  const clearance = Math.max(0.3, trapNumber(trap, "clearance", BUNTING_CLEARANCE_FALLBACK));
  const forward = useMemo(() => trapForward(trap.rotationY), [trap.rotationY]);

  useEffect(() => {
    lastCatch.current = 0;
  }, [startedAt]);

  useFrame(() => {
    const now = performance.now();
    const armed = now - lastCatch.current > BUNTING.gateMs;
    const target = player.current;
    let tension = 0;
    if (isLive(target)) {
      const p = target.translation();
      const dx = p.x - trap.position[0];
      const dz = p.z - trap.position[2];
      const along = dx * forward.x + dz * forward.z;
      const lateral = dx * forward.z - dz * forward.x;
      const height = p.y - trap.position[1];
      const reach = Math.hypot(dx, dz);
      // Only tightens for a runner who is actually off the ground: the string
      // is telling them their feet are the problem, before they arrive.
      if (armed && reach < BUNTING_WATCH && height > clearance)
        tension = 1 - reach / BUNTING_WATCH;
      if (
        armed &&
        Math.abs(along) < BUNTING_BAND_HALF &&
        Math.abs(lateral) < span / 2 &&
        height > clearance &&
        height < BUNTING_CEILING
      ) {
        lastCatch.current = now;
        const velocity = target.linvel();
        const mass = target.mass();
        const scale = (mass > 0 ? mass : 1) * BUNTING_CATCH;
        target.applyImpulse(
          { x: -velocity.x * scale, y: -BUNTING_SLAM, z: -velocity.z * scale },
          true,
        );
        soapUntilRef.current = Math.max(soapUntilRef.current, now + BUNTING_STUMBLE_MS);
        contact(trap, onHazard, BUNTING.impulse);
        mechanic(trap, onMechanic, "bunting_caught", height);
      }
    }
    if (flags.current) {
      flags.current.position.y = clearance + 0.16 - tension * 0.1;
      flags.current.rotation.z = Math.sin(now / (armed ? 150 : 420)) * (0.08 + tension * 0.2);
    }
    fadeMarker(airMark.current, armed ? 0.55 + tension * 0.4 : 0.18);
  }, TRAP_FRAME_PRIORITY);

  return (
    <group
      position={[trap.position[0], trap.position[1], trap.position[2]]}
      rotation={[0, trap.rotationY, 0]}
    >
      {/* Where it hangs, on the ground. */}
      <mesh name="buntingLineBand" position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[span, BUNTING_BAND_HALF * 2]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.4} />
      </mesh>
      {/* The catch window is vertical, so the reach has to be drawn vertically
          too: this panel spans exactly clearance..BUNTING_CEILING, which is the
          band of heights the hit test accepts. */}
      <mesh
        name="buntingLineAirBand"
        ref={airMark}
        position={[0, (clearance + BUNTING_CEILING) / 2, 0]}
      >
        <planeGeometry args={[span, BUNTING_CEILING - clearance]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.55} side={2} />
      </mesh>
      <mesh name="buntingLineFloor" position={[0, clearance, 0]}>
        <boxGeometry args={[span, 0.035, 0.035]} />
        <meshBasicMaterial color={PALETTE.danger} />
      </mesh>
      <group ref={flags} position={[0, clearance + 0.16, 0]}>
        {Array.from({ length: BUNTING_FLAGS }, (_, index) => (
          <group
            key={index}
            position={[lerp(-span / 2, span / 2, index / (BUNTING_FLAGS - 1)), 0, 0]}
          >
            <BuntingFlag index={index} />
          </group>
        ))}
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Steam vents
// ---------------------------------------------------------------------------
// VERB: three grates across the lane fire in a printed rotation, so exactly one
// third of the lane is unsafe at a time and which third is legible one turn in
// advance.
// NOT the cutlery drawer: the drawer is a single lane that is shut or open, so
// the answer is always "wait". Here waiting does not help, because the safe
// lane moves - the runner has to read the rotation and pick a side, which is a
// route choice made with information rather than a timing window.

const STEAM = WAVE_A_HAZARD.steam_vents;
const STEAM_SPREAD_FALLBACK = 0.95;
const STEAM_BLAST_FALLBACK = 0.7;
const STEAM_LANES = 3;
/** The active grate fills for this long before it blows. */
const STEAM_WARN_MS = 700;
const STEAM_JET_MS = 260;
const STEAM_PUSH = 3.4;
const STEAM_LIFT = 5.2;
const STEAM_HEIGHT = 2;

export function SteamVentsTrap({
  trap,
  player,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const fills = useRef<Array<Mesh | null>>([]);
  const next = useRef<Array<Mesh | null>>([]);
  const jets = useRef<Array<Group | null>>([]);
  const firedCycle = useRef(-1);
  const spread = Math.max(0.4, trapNumber(trap, "spread", STEAM_SPREAD_FALLBACK));
  const blast = Math.max(0.3, trapNumber(trap, "blast", STEAM_BLAST_FALLBACK));
  const forward = useMemo(() => trapForward(trap.rotationY), [trap.rotationY]);
  const offset = useMemo(
    () => Math.floor(createSeededRandom(trap.seed)() * STEAM_LANES),
    [trap.seed],
  );
  const laneAt = useMemo(
    () => (index: number) => ({
      x: trap.position[0] + forward.z * (index - 1) * spread,
      z: trap.position[2] - forward.x * (index - 1) * spread,
    }),
    [forward, spread, trap.position],
  );

  useEffect(() => {
    firedCycle.current = -1;
  }, [startedAt]);

  useFrame(() => {
    const elapsed = elapsedMs(startedAt);
    const cycle = Math.floor(elapsed / STEAM.gateMs);
    const phase = elapsed % STEAM.gateMs;
    const active = (cycle + offset) % STEAM_LANES;
    const upcoming = (cycle + offset + 1) % STEAM_LANES;

    if (phase >= STEAM_WARN_MS && firedCycle.current !== cycle) {
      firedCycle.current = cycle;
      mechanic(trap, onMechanic, "vent_blew", active);
      const target = player.current;
      if (isLive(target)) {
        const p = target.translation();
        const vent = laneAt(active);
        const dx = p.x - vent.x;
        const dz = p.z - vent.z;
        const distance = Math.hypot(dx, dz);
        if (distance < blast && p.y - trap.position[1] < STEAM_HEIGHT) {
          const away = Math.max(distance, 0.2);
          target.applyImpulse(
            {
              x: (dx / away) * STEAM_PUSH,
              y: STEAM_LIFT,
              z: (dz / away) * STEAM_PUSH,
            },
            true,
          );
          contact(trap, onHazard, STEAM.impulse);
          mechanic(trap, onMechanic, "vent_scalded", STEAM.impulse);
        }
      }
    }

    const charging = Math.min(1, phase / STEAM_WARN_MS);
    for (let lane = 0; lane < STEAM_LANES; lane += 1) {
      const fill = fills.current[lane];
      if (fill) {
        fill.visible = lane === active && phase < STEAM_WARN_MS;
        fill.scale.setScalar(Math.max(0.001, charging));
      }
      // The lane that is next, outlined but not filled: the route choice is
      // made before the current jet has even fired.
      const hint = next.current[lane];
      if (hint) hint.visible = lane === upcoming;
      const jet = jets.current[lane];
      if (jet) {
        const running = lane === active && phase >= STEAM_WARN_MS && phase < STEAM_WARN_MS + STEAM_JET_MS;
        jet.visible = running;
        if (running) jet.scale.setScalar(lerp(0.4, 1.1, (phase - STEAM_WARN_MS) / STEAM_JET_MS));
      }
    }
  }, TRAP_FRAME_PRIORITY);

  return (
    <group
      position={[trap.position[0], trap.position[1], trap.position[2]]}
      rotation={[0, trap.rotationY, 0]}
    >
      {Array.from({ length: STEAM_LANES }, (_, lane) => (
        <group key={lane} position={[(lane - 1) * spread, 0, 0]}>
          <mesh name={`steamVentsRing${lane}`} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[blast - 0.09, blast, 30]} />
            <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.62} />
          </mesh>
          <mesh
            name={`steamVentsCharge${lane}`}
            ref={(mesh: Mesh | null) => {
              fills.current[lane] = mesh;
            }}
            position={[0, 0.026, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            visible={false}
          >
            <circleGeometry args={[blast, 24]} />
            <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.42} />
          </mesh>
          <mesh
            name={`steamVentsNext${lane}`}
            ref={(mesh: Mesh | null) => {
              next.current[lane] = mesh;
            }}
            position={[0, 0.03, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            visible={false}
          >
            <ringGeometry args={[blast * 0.5, blast * 0.6, 20]} />
            <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.9} />
          </mesh>
          <group
            ref={(group: Group | null) => {
              jets.current[lane] = group;
            }}
            position={[0, 0.05, 0]}
            visible={false}
          >
            <mesh name={`steamVentsJet${lane}`} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[blast * 0.7, blast, 24]} />
              <meshBasicMaterial color={PALETTE.cream} transparent opacity={0.6} />
            </mesh>
          </group>
          <FloorGrate />
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Rattling pipe
// ---------------------------------------------------------------------------
// VERB: rattles loudly at its valve and bursts at the far end of its run, so
// the half of it that is making all the noise is the half that is safe.
// NOT the washing machine: the washer charges and bursts in the same place, so
// the wind-up and the hazard are the same object. Here they are metres apart,
// and the trap is a lesson in reading the marker rather than the movement. The
// valve's rattle is deliberately drawn in PALETTE.yellow, because it is not a
// hazard, and the only thing in PALETTE.danger is the ring the burst reaches.

const PIPE = WAVE_A_HAZARD.pipe_burst;
const PIPE_RUN_FALLBACK = 2.6;
const PIPE_BLAST_FALLBACK = 0.9;
/** The valve shakes for this long. Nothing happens there, ever. */
const PIPE_RATTLE_MS = 900;
const PIPE_JET_MS = 320;
const PIPE_PUSH = 5.4;
const PIPE_LIFT = 2.2;
const PIPE_HEIGHT = 2;

export function PipeBurstTrap({
  trap,
  player,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const valve = useRef<Group>(null);
  const charge = useRef<Mesh>(null);
  const jet = useRef<Group>(null);
  const firedCycle = useRef(-1);
  const run = Math.max(0.8, trapNumber(trap, "run", PIPE_RUN_FALLBACK));
  const blast = Math.max(0.35, trapNumber(trap, "blast", PIPE_BLAST_FALLBACK));
  const forward = useMemo(() => trapForward(trap.rotationY), [trap.rotationY]);

  useEffect(() => {
    firedCycle.current = -1;
  }, [startedAt]);

  useFrame(() => {
    const elapsed = elapsedMs(startedAt);
    const cycle = Math.floor(elapsed / PIPE.gateMs);
    const phase = elapsed % PIPE.gateMs;

    if (phase >= PIPE_RATTLE_MS && firedCycle.current !== cycle) {
      firedCycle.current = cycle;
      mechanic(trap, onMechanic, "pipe_burst", run);
      const target = player.current;
      if (isLive(target)) {
        const p = target.translation();
        const dx = p.x - (trap.position[0] + forward.x * run);
        const dz = p.z - (trap.position[2] + forward.z * run);
        const distance = Math.hypot(dx, dz);
        if (distance < blast && p.y - trap.position[1] < PIPE_HEIGHT) {
          const away = Math.max(distance, 0.2);
          target.applyImpulse(
            {
              x: (dx / away) * PIPE_PUSH,
              y: PIPE_LIFT,
              z: (dz / away) * PIPE_PUSH,
            },
            true,
          );
          contact(trap, onHazard, PIPE.impulse);
          mechanic(trap, onMechanic, "pipe_scalded", PIPE.impulse);
        }
      }
    }

    const rattling = phase < PIPE_RATTLE_MS;
    if (valve.current) {
      const shake = rattling ? (phase / PIPE_RATTLE_MS) ** 2 * 0.05 : 0;
      valve.current.position.x = Math.sin(elapsed / 22) * shake;
      valve.current.position.y = Math.abs(Math.sin(elapsed / 17)) * shake;
    }
    if (charge.current) {
      charge.current.visible = rattling;
      charge.current.scale.setScalar(Math.max(0.001, phase / PIPE_RATTLE_MS));
    }
    if (jet.current) {
      const since = phase - PIPE_RATTLE_MS;
      const running = since >= 0 && since < PIPE_JET_MS;
      jet.current.visible = running;
      if (running) jet.current.scale.setScalar(lerp(0.3, 1.15, since / PIPE_JET_MS));
    }
  }, TRAP_FRAME_PRIORITY);

  return (
    <group
      position={[trap.position[0], trap.position[1], trap.position[2]]}
      rotation={[0, trap.rotationY, 0]}
    >
      {/* Drawn from the valve to the burst so the link between the noise and
          the hazard is on the floor rather than something to be learnt by
          dying. This run is not itself dangerous, hence the muted colour. */}
      <mesh name="pipeBurstRun" position={[0, 0.02, run / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.1, run]} />
        <meshBasicMaterial color={PALETTE.muted} transparent opacity={0.55} />
      </mesh>
      {/* The valve's tell: loud, and pointedly not in the hazard colour. */}
      <mesh name="pipeBurstValveTell" position={[0, 0.024, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.28, 0.36, 20]} />
        <meshBasicMaterial color={PALETTE.yellow} transparent opacity={0.8} />
      </mesh>
      <group position={[0, 0, run]}>
        <mesh name="pipeBurstReach" position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[blast - 0.1, blast, 34]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.75} />
        </mesh>
        <mesh
          name="pipeBurstCharge"
          ref={charge}
          position={[0, 0.026, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <circleGeometry args={[blast * 0.94, 26]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.34} />
        </mesh>
        <group ref={jet} position={[0, 0.05, 0]} visible={false}>
          <mesh name="pipeBurstJet" rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[blast * 0.72, blast, 26]} />
            <meshBasicMaterial color={PALETTE.cream} transparent opacity={0.62} />
          </mesh>
        </group>
      </group>
      <group ref={valve}>
        <WallPipe run={run} />
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Ankle weights
// ---------------------------------------------------------------------------
// VERB: clamps on the first time it is touched and taxes every step for the
// rest of the attempt, so what it costs depends on how early it is hit.
// NOT the chewed gum: the gum brakes a runner inside a 0.7u wad and stops the
// moment they leave it, so its cost is bounded by its footprint. The weights
// have no footprint after the clamp - they follow the runner off the course
// and out to the finish line, and they are the only trap here whose price is a
// function of where in the run the contact happened.

const ANKLE = WAVE_A_HAZARD.ankle_weight;
const ANKLE_REACH_FALLBACK = 0.55;
/**
 * Fraction of horizontal speed pulled out per second once attached. Against
 * PLAYER.acceleration of 30 correcting toward a 7.2 m/s walk, 1.6 settles the
 * runner around 6.8 m/s: a five per cent tax rather than a crawl, because it
 * is paid for the whole remaining run and nothing lifts it.
 */
const ANKLE_DRAG_FALLBACK = 1.6;
const ANKLE_HEIGHT = 1;
/** The clasp starts snapping open once the runner is inside this. */
const ANKLE_WARN_RADIUS = 1.6;
const ANKLE_SNAP = 2.4;

export function AnkleWeightTrap({
  trap,
  player,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const clasp = useRef<Group>(null);
  const rim = useRef<Mesh>(null);
  const attached = useRef(false);
  const reach = Math.max(0.25, trapNumber(trap, "reach", ANKLE_REACH_FALLBACK));
  const drag = Math.max(0.1, trapNumber(trap, "drag", ANKLE_DRAG_FALLBACK));

  useEffect(() => {
    attached.current = false;
  }, [startedAt]);

  useFrame((_, delta) => {
    const now = performance.now();
    const step = Math.min(delta, MAX_STEP);
    const target = player.current;
    let approach = 0;
    if (isLive(target)) {
      const p = target.translation();
      const distance = Math.hypot(p.x - trap.position[0], p.z - trap.position[2]);
      approach = Math.max(0, 1 - distance / ANKLE_WARN_RADIUS);
      if (
        !attached.current &&
        distance < reach &&
        p.y - trap.position[1] < ANKLE_HEIGHT
      ) {
        attached.current = true;
        target.applyImpulse({ x: 0, y: -ANKLE_SNAP, z: 0 }, true);
        contact(trap, onHazard, ANKLE.impulse);
        mechanic(trap, onMechanic, "weights_clamped", drag);
      }
      if (attached.current) {
        const velocity = target.linvel();
        const mass = target.mass();
        const brake = Math.min(1, drag * step) * (mass > 0 ? mass : 1);
        target.applyImpulse(
          { x: -velocity.x * brake, y: 0, z: -velocity.z * brake },
          true,
        );
      }
    }
    if (clasp.current) {
      const open = attached.current ? 0 : approach;
      clasp.current.rotation.z = open * 0.5 * Math.sin(now / 90);
      clasp.current.visible = !attached.current;
    }
    // Stays lit for the rest of the run once they are on, because they are
    // still costing the runner something the whole way to the finish.
    fadeMarker(
      rim.current,
      attached.current
        ? 0.3 + 0.25 * (Math.sin(now / 260) * 0.5 + 0.5)
        : 0.5 + approach * 0.45,
    );
  }, TRAP_FRAME_PRIORITY);

  return (
    <group position={[trap.position[0], trap.position[1], trap.position[2]]}>
      <mesh name="ankleWeightReach" position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[reach, 22]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.32} />
      </mesh>
      <mesh name="ankleWeightRim" ref={rim} position={[0, 0.026, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[reach - 0.08, reach, 24]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.5} />
      </mesh>
      <group ref={clasp} position={[0, 0.03, 0]}>
        <AnkleWeightCuff />
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Laundry chute
// ---------------------------------------------------------------------------
// VERB: swallows a runner who steps into its mouth and sets them down at a
// fixed point back down the course, moving them somewhere they did not choose.
// NOT a knockback: every other trap here changes the runner's velocity and
// lets the physics decide where that ends up, so the outcome scales with mass,
// footing and what they were doing at the time. The chute ignores all of that
// and relocates them, which makes it the only trap whose cost is exactly the
// same every time and is printed on the floor before they fall in.

const CHUTE = WAVE_A_HAZARD.chute_drop;
const CHUTE_MOUTH_FALLBACK = 0.8;
/**
 * Metres back along world -Z, which is the axis GameScene already knocks a hit
 * runner along. Using the trap's own rotation here would let a placement aim
 * the drop off the side of a platform, and the runner has by definition just
 * walked the ground behind them.
 */
const CHUTE_SETBACK_FALLBACK = 2.6;
const CHUTE_SWALLOW_MS = 300;
const CHUTE_HEIGHT = 1.4;
/** Dropped from here so they land rather than clip into the deck. */
const CHUTE_DROP_HEIGHT = 1;
const CHUTE_STUMBLE_MS = 620;

export function ChuteDropTrap({
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
  const flap = useRef<Group>(null);
  const mouthMark = useRef<Mesh>(null);
  const swallowedAt = useRef(0);
  const holding = useRef(false);
  const mouth = Math.max(0.35, trapNumber(trap, "mouth", CHUTE_MOUTH_FALLBACK));
  const setback = Math.max(0.8, trapNumber(trap, "setback", CHUTE_SETBACK_FALLBACK));

  useEffect(() => {
    swallowedAt.current = 0;
    holding.current = false;
  }, [startedAt]);

  useFrame(() => {
    const now = performance.now();
    const since = now - swallowedAt.current;
    const armed = swallowedAt.current === 0 || since > CHUTE.gateMs;
    const target = player.current;

    if (holding.current && isLive(target)) {
      if (since < CHUTE_SWALLOW_MS) {
        // Held in the mouth for the length of the swallow, so the relocation
        // reads as being taken rather than as a teleport glitch.
        target.setLinvel({ x: 0, y: 0, z: 0 }, true);
        target.setTranslation(
          { x: trap.position[0], y: trap.position[1] + 0.4, z: trap.position[2] },
          true,
        );
      } else {
        holding.current = false;
        target.setTranslation(
          {
            x: trap.position[0],
            y: trap.position[1] + CHUTE_DROP_HEIGHT,
            z: trap.position[2] - setback,
          },
          true,
        );
        target.setLinvel({ x: 0, y: 0, z: 0 }, true);
        soapUntilRef.current = Math.max(soapUntilRef.current, now + CHUTE_STUMBLE_MS);
        contact(trap, onHazard, CHUTE.impulse);
        mechanic(trap, onMechanic, "chute_dropped", setback);
      }
    } else if (armed && isLive(target)) {
      const p = target.translation();
      const distance = Math.hypot(p.x - trap.position[0], p.z - trap.position[2]);
      if (distance < mouth && p.y - trap.position[1] < CHUTE_HEIGHT) {
        swallowedAt.current = now;
        holding.current = true;
        mechanic(trap, onMechanic, "chute_swallowed", mouth);
      }
    }

    // Open and pulsing while it can take someone, dark while it is spent.
    fadeMarker(
      mouthMark.current,
      armed ? 0.55 + 0.3 * (Math.sin(now / 190) * 0.5 + 0.5) : 0.16,
    );
    if (flap.current) flap.current.rotation.x = armed ? -0.5 : 0;
  }, TRAP_FRAME_PRIORITY);

  return (
    <>
      <group position={[trap.position[0], trap.position[1], trap.position[2]]}>
        <mesh name="chuteDropMouth" position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[mouth, 26]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.4} />
        </mesh>
        <mesh
          name="chuteDropMouthRim"
          ref={mouthMark}
          position={[0, 0.026, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[mouth - 0.09, mouth, 28]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.55} />
        </mesh>
        {/* Where it will put them, and the line between, both at the setback
            the relocation actually uses. Nothing else on the roster can tell
            the player where they are about to end up, so this is the whole
            readability of the trap. */}
        <mesh
          name="chuteDropLane"
          position={[0, 0.02, -setback / 2]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[0.12, setback]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.5} />
        </mesh>
        <mesh
          name="chuteDropLanding"
          position={[0, 0.024, -setback]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[mouth * 0.62, mouth * 0.78, 24]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.8} />
        </mesh>
      </group>
      <RigidBody
        ref={body}
        type="fixed"
        colliders={false}
        position={[trap.position[0], trap.position[1], trap.position[2] - mouth - 0.5]}
        rotation={[0, trap.rotationY, 0]}
      >
        <CuboidCollider args={[0.55, 0.75, 0.28]} position={[0, 0.75, 0]} />
        {/* Only the hatch swings, so the wall it is set into stays put. */}
        <LaundryChuteBody mouth={mouth} />
        <group ref={flap} position={[0, 1.26, 0.06]}>
          <LaundryChuteHatch mouth={mouth} />
        </group>
      </RigidBody>
    </>
  );
}

// ---------------------------------------------------------------------------
// Runaway trolley
// ---------------------------------------------------------------------------
// VERB: mirrors the runner's sideways position to stay in front of them, so it
// is beaten by committing to one side and then reversing rather than by speed.
// NOT the angry vacuum: the vacuum closes distance and pulls, so it is escaped
// by outrunning it or by taking a line outside its leash. The trolley never
// advances a single metre - it only ever slides across, it is a wall that
// copies the runner, and a runner who never fakes will never get past it.

const CART = WAVE_A_HAZARD.cart_blocker;
const CART_TRAVEL_FALLBACK = 1.4;
/** How fast it slides across, metres per second. Also what makes it beatable. */
const CART_TRACK_FALLBACK = 2.2;
const CART_HALF_WIDTH = 0.42;
const CART_HALF_HEIGHT = 0.5;
const CART_HALF_DEPTH = 0.36;
const CART_SHOVE = 4.6;
const CART_LIFT = 1.4;

export function CartBlockerTrap({
  trap,
  player,
  trapBodies,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const body = useRef<RapierRigidBody>(null);
  useRegisterTrapBody(body, trapBodies, trap.id);
  const aimMark = useRef<Mesh>(null);
  const shell = useRef<Group>(null);
  const slide = useRef(0);
  const lastReport = useRef(0);
  const travel = Math.max(0.3, trapNumber(trap, "travel", CART_TRAVEL_FALLBACK));
  const track = Math.max(0.4, trapNumber(trap, "track", CART_TRACK_FALLBACK));
  const forward = useMemo(() => trapForward(trap.rotationY), [trap.rotationY]);

  useEffect(() => {
    slide.current = 0;
    lastReport.current = 0;
  }, [startedAt]);

  useFrame((_, delta) => {
    const step = Math.min(delta, MAX_STEP);
    const rigid = body.current;
    const target = player.current;
    let goal = slide.current;
    if (isLive(target)) {
      const p = target.translation();
      const dx = p.x - trap.position[0];
      const dz = p.z - trap.position[2];
      goal = Math.max(-travel, Math.min(travel, dx * forward.z - dz * forward.x));
    }
    // A capped rate rather than a snap, which is what makes the mirror lag by
    // a beat and a reversal beat it.
    const move = Math.max(-track * step, Math.min(track * step, goal - slide.current));
    slide.current += move;
    if (isLive(rigid))
      rigid.setNextKinematicTranslation({
        x: trap.position[0] + forward.z * slide.current,
        y: trap.position[1] + CART_HALF_HEIGHT,
        z: trap.position[2] - forward.x * slide.current,
      });
    if (aimMark.current) aimMark.current.position.x = goal;
    if (shell.current) shell.current.rotation.z = -move * 6;
  }, TRAP_FRAME_PRIORITY);

  return (
    <>
      <group
        position={[trap.position[0], trap.position[1], trap.position[2]]}
        rotation={[0, trap.rotationY, 0]}
      >
        {/* Everything it can cover, at the travel and body width it has. */}
        <mesh name="cartBlockerLane" position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[travel * 2 + CART_HALF_WIDTH * 2, CART_HALF_DEPTH * 2]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.36} />
        </mesh>
        {/* Where it is sliding to, a beat before it gets there. */}
        <mesh
          name="cartBlockerAim"
          ref={aimMark}
          position={[0, 0.028, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[CART_HALF_WIDTH * 2, CART_HALF_DEPTH * 2.2]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.8} />
        </mesh>
      </group>
      <RigidBody
        ref={body}
        type="kinematicPosition"
        colliders={false}
        position={[trap.position[0], trap.position[1] + CART_HALF_HEIGHT, trap.position[2]]}
        rotation={[0, trap.rotationY, 0]}
        onCollisionEnter={(event) => {
          if (!playerCollision(event)) return;
          const now = performance.now();
          if (now - lastReport.current <= CART.gateMs) return;
          lastReport.current = now;
          contact(trap, onHazard, CART.impulse);
          mechanic(trap, onMechanic, "trolley_blocked", CART.impulse);
          const target = player.current;
          if (!isLive(target)) return;
          target.applyImpulse(
            { x: -forward.x * CART_SHOVE, y: CART_LIFT, z: -forward.z * CART_SHOVE },
            true,
          );
        }}
      >
        <CuboidCollider args={[CART_HALF_WIDTH, CART_HALF_HEIGHT, CART_HALF_DEPTH]} />
        <group ref={shell} position={[0, -CART_HALF_HEIGHT, 0]}>
          <ShoppingTrolley
            halfWidth={CART_HALF_WIDTH}
            halfHeight={CART_HALF_HEIGHT}
            halfDepth={CART_HALF_DEPTH}
          />
        </group>
      </RigidBody>
    </>
  );
}

// ---------------------------------------------------------------------------
// Dust bunny
// ---------------------------------------------------------------------------
// VERB: walks the line the runner walked a second and a half ago, so it only
// ever reaches someone who stops, doubles back, or circles.
// NOT the angry vacuum: the vacuum goes at where the runner is now, so running
// away from it works and the counter is speed. The bunny goes where the runner
// has already been, which means a straight, committed line is completely safe
// from it and hesitating in place is what puts it on top of you. Its path is
// drawn on the floor because the runner drew it.

const DUST = WAVE_A_HAZARD.dust_bunny;
const DUST_LAG_FALLBACK = 1600;
const DUST_CHASE_FALLBACK = 3.6;
const DUST_SAMPLE_MS = 80;
/** 24 samples at 80ms covers 1920ms, comfortably past the default lag. */
const DUST_TRAIL = 24;
const DUST_CONTACT = 0.62;
const DUST_PUSH = 3.6;
const DUST_LIFT = 1.2;
const DUST_HEIGHT = 1.2;
/** It swells for this long before it can land again: the wind-up. */
const DUST_SWELL_MS = 300;

export function DustBunnyTrap({
  trap,
  player,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const clump = useRef<Group>(null);
  const ring = useRef<Group>(null);
  const dots = useRef<Array<Mesh | null>>([]);
  const trail = useRef<Array<{ x: number; z: number; at: number }>>([]);
  const sampledAt = useRef(0);
  const at = useRef({ x: trap.position[0], z: trap.position[2] });
  const lastReport = useRef(0);
  const lag = Math.max(400, trapNumber(trap, "lag", DUST_LAG_FALLBACK));
  const chase = Math.max(0.5, trapNumber(trap, "chase", DUST_CHASE_FALLBACK));

  useEffect(() => {
    trail.current = [];
    sampledAt.current = 0;
    lastReport.current = 0;
    at.current.x = trap.position[0];
    at.current.z = trap.position[2];
  }, [startedAt, trap.position]);

  useFrame((_, delta) => {
    const now = performance.now();
    const step = Math.min(delta, MAX_STEP);
    const target = player.current;
    if (isLive(target) && now - sampledAt.current >= DUST_SAMPLE_MS) {
      sampledAt.current = now;
      const p = target.translation();
      trail.current.push({ x: p.x, z: p.z, at: now });
      if (trail.current.length > DUST_TRAIL) trail.current.shift();
    }
    // The oldest sample still inside the lag window is where the runner was
    // `lag` ago; before there is any history the bunny sits at its placement.
    const wanted = now - lag;
    let goal = at.current;
    for (const sample of trail.current) {
      if (sample.at <= wanted) goal = sample;
      else break;
    }
    const dx = goal.x - at.current.x;
    const dz = goal.z - at.current.z;
    const distance = Math.hypot(dx, dz);
    if (distance > 0.001) {
      const move = Math.min(distance, chase * step);
      at.current.x += (dx / distance) * move;
      at.current.z += (dz / distance) * move;
    }

    let swelling = 0;
    if (isLive(target)) {
      const p = target.translation();
      const reach = Math.hypot(p.x - at.current.x, p.z - at.current.z);
      swelling = Math.max(0, 1 - reach / (DUST_CONTACT * 3));
      if (
        reach < DUST_CONTACT &&
        p.y - trap.position[1] < DUST_HEIGHT &&
        now - lastReport.current > DUST.gateMs
      ) {
        lastReport.current = now;
        const away = Math.max(reach, 0.15);
        target.applyImpulse(
          {
            x: ((p.x - at.current.x) / away) * DUST_PUSH,
            y: DUST_LIFT,
            z: ((p.z - at.current.z) / away) * DUST_PUSH,
          },
          true,
        );
        contact(trap, onHazard, DUST.impulse);
        mechanic(trap, onMechanic, "dust_caught", reach);
      }
    }

    if (ring.current) ring.current.position.set(at.current.x, trap.position[1] + 0.02, at.current.z);
    if (clump.current) {
      clump.current.position.set(at.current.x, trap.position[1] + 0.12, at.current.z);
      const ready = now - lastReport.current > DUST.gateMs - DUST_SWELL_MS;
      clump.current.scale.setScalar(1 + (ready ? swelling * 0.28 : 0));
      clump.current.rotation.y += step * 2.4;
    }
    // The route it is going to take, which is the route the runner took. Drawn
    // in the hazard colour because every dot is somewhere it will reach.
    for (let index = 0; index < DUST_TRAIL; index += 1) {
      const dot = dots.current[index];
      if (!dot) continue;
      const sample = trail.current[index];
      dot.visible = sample !== undefined;
      if (sample) dot.position.set(sample.x, trap.position[1] + 0.015, sample.z);
    }
  }, TRAP_FRAME_PRIORITY);

  return (
    <>
      <group ref={ring} position={[trap.position[0], trap.position[1] + 0.02, trap.position[2]]}>
        <mesh name="dustBunnyReach" rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[DUST_CONTACT - 0.08, DUST_CONTACT, 24]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.78} />
        </mesh>
      </group>
      {Array.from({ length: DUST_TRAIL }, (_, index) => (
        <mesh
          key={index}
          name={`dustBunnyTrail${index}`}
          ref={(mesh: Mesh | null) => {
            dots.current[index] = mesh;
          }}
          position={[trap.position[0], trap.position[1] + 0.015, trap.position[2]]}
          rotation={[-Math.PI / 2, 0, 0]}
          visible={false}
        >
          <circleGeometry args={[0.07, 8]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.35} />
        </mesh>
      ))}
      <group ref={clump} position={[trap.position[0], trap.position[1] + 0.12, trap.position[2]]}>
        <DustBunny />
      </group>
    </>
  );
}

// ---------------------------------------------------------------------------
// Overflowing sink
// ---------------------------------------------------------------------------
// VERB: its radius grows with the elapsed run, so a slow runner meets a wider
// hazard than a fast one and the same placement costs different people
// different amounts.
// NOT the soap slick: soap is 1.8u across on the first second and on the
// sixtieth. This is the only hazard whose reach is a function of the clock, so
// it is the mirror of the extension cord - the cord punishes hurrying and the
// sink punishes dithering, and a course with both has no comfortable speed.

const FLOOD = WAVE_A_HAZARD.flood_puddle;
const FLOOD_START_FALLBACK = 0.7;
/** Metres of radius added per second of attempt. */
const FLOOD_GROWTH_FALLBACK = 0.055;
const FLOOD_WIDEST_FALLBACK = 2;
const FLOOD_HEIGHT = 1;
const FLOOD_SLIP_MS = 110;
const FLOOD_WOBBLE = 1.4;

/** Exported because the spread is the trap, and a test has to be able to check it. */
export function floodRadius(elapsed: number, start: number, growth: number, widest: number): number {
  return Math.min(widest, start + (growth * Math.max(0, elapsed)) / 1000);
}

export function FloodPuddleTrap({
  trap,
  player,
  soapUntilRef,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const pool = useRef<Group>(null);
  const lastReport = useRef(0);
  const start = Math.max(0.25, trapNumber(trap, "start", FLOOD_START_FALLBACK));
  const growth = Math.max(0, trapNumber(trap, "growth", FLOOD_GROWTH_FALLBACK));
  const widest = Math.max(start, trapNumber(trap, "widest", FLOOD_WIDEST_FALLBACK));

  useEffect(() => {
    lastReport.current = 0;
  }, [startedAt]);

  useFrame((_, delta) => {
    const now = performance.now();
    const step = Math.min(delta, MAX_STEP);
    const radius = floodRadius(elapsedMs(startedAt), start, growth, widest);
    const target = player.current;
    if (isLive(target)) {
      const p = target.translation();
      const distance = Math.hypot(p.x - trap.position[0], p.z - trap.position[2]);
      if (distance < radius && p.y - trap.position[1] < FLOOD_HEIGHT) {
        soapUntilRef.current = Math.max(soapUntilRef.current, now + FLOOD_SLIP_MS);
        target.applyImpulse(
          {
            x: Math.sin(now / 210 + trap.seed) * FLOOD_WOBBLE * step,
            y: 0,
            z: Math.cos(now / 240 + trap.seed) * FLOOD_WOBBLE * step,
          },
          true,
        );
        if (now - lastReport.current > FLOOD.gateMs) {
          lastReport.current = now;
          contact(trap, onHazard, FLOOD.impulse);
          mechanic(trap, onMechanic, "puddle_slipped", radius);
        }
      }
    }
    // The marker is the hit test: one scale, driven by the same radius.
    if (pool.current) pool.current.scale.set(radius, 1, radius);
  }, TRAP_FRAME_PRIORITY);

  return (
    <group position={[trap.position[0], trap.position[1], trap.position[2]]}>
      {/* Where it will get to eventually, so the placement can be read before
          the puddle has grown into it. */}
      <mesh name="floodPuddleWidest" position={[0, 0.016, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[widest - 0.06, widest, 40]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.3} />
      </mesh>
      {/* Unit geometry, scaled every frame to the live radius. */}
      <group ref={pool} position={[0, 0, 0]} scale={[start, 1, start]}>
        <mesh name="floodPuddleReach" position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[1, 32]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.34} />
        </mesh>
        <mesh name="floodPuddleRim" position={[0, 0.026, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.9, 1, 32]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.85} />
        </mesh>
      </group>
      <group position={[0, 0.03, 0]}>
        <SinkBasin />
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Floor vent
// ---------------------------------------------------------------------------
// VERB: adds lift only to a runner who is already off the deck, so a jump
// taken over it carries further than it was aimed.
// NOT the spring pad: the pad fires a grounded runner upward on contact, and
// it is a thing you land on. The vent does nothing at all to anybody standing
// on it - it needs the runner's feet to be in the air already, and what it
// costs is the landing, not the take-off. It is the only trap that makes a
// jump longer rather than shorter.

const UPDRAFT = WAVE_A_HAZARD.updraft_vent;
const UPDRAFT_REACH_FALLBACK = 0.9;
const UPDRAFT_LIFT_FALLBACK = 4.2;
const UPDRAFT_CEILING_FALLBACK = 2.6;
/** The column blows for the last stretch of each cycle. */
const UPDRAFT_BLOW_MS = 520;
/** Feet at least this far off the deck, or there is nothing to lift. */
const UPDRAFT_MIN_AIR = 0.55;

export function UpdraftVentTrap({
  trap,
  player,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const charge = useRef<Mesh>(null);
  const column = useRef<Mesh>(null);
  const lastReport = useRef(0);
  const reach = Math.max(0.3, trapNumber(trap, "reach", UPDRAFT_REACH_FALLBACK));
  const lift = Math.max(0.5, trapNumber(trap, "lift", UPDRAFT_LIFT_FALLBACK));
  const ceiling = Math.max(UPDRAFT_MIN_AIR + 0.4, trapNumber(trap, "ceiling", UPDRAFT_CEILING_FALLBACK));

  useEffect(() => {
    lastReport.current = 0;
  }, [startedAt]);

  useFrame((_, delta) => {
    const now = performance.now();
    const step = Math.min(delta, MAX_STEP);
    const phase = elapsedMs(startedAt) % UPDRAFT.gateMs;
    const blowing = phase >= UPDRAFT.gateMs - UPDRAFT_BLOW_MS;
    const target = player.current;
    if (blowing && isLive(target)) {
      const p = target.translation();
      const distance = Math.hypot(p.x - trap.position[0], p.z - trap.position[2]);
      const height = p.y - trap.position[1];
      if (distance < reach && height > UPDRAFT_MIN_AIR && height < ceiling) {
        target.applyImpulse({ x: 0, y: lift * step, z: 0 }, true);
        if (now - lastReport.current > UPDRAFT.gateMs) {
          lastReport.current = now;
          contact(trap, onHazard, UPDRAFT.impulse);
          mechanic(trap, onMechanic, "updraft_lifted", height);
        }
      }
    }
    if (charge.current) {
      // Fills across the quiet part of the cycle and flashes while it blows.
      const closing = Math.min(1, phase / (UPDRAFT.gateMs - UPDRAFT_BLOW_MS));
      charge.current.scale.setScalar(
        Math.max(0.001, blowing ? (Math.floor(phase / 70) % 2 === 0 ? 1 : 0.6) : closing),
      );
    }
    if (column.current) column.current.visible = blowing;
  }, TRAP_FRAME_PRIORITY);

  return (
    <group position={[trap.position[0], trap.position[1], trap.position[2]]}>
      <mesh name="updraftVentReach" position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[reach - 0.08, reach, 28]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.7} />
      </mesh>
      <mesh name="updraftVentCharge" ref={charge} position={[0, 0.026, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[reach * 0.92, 24]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.3} />
      </mesh>
      {/* The lift only works between MIN_AIR and the ceiling, so the ceiling is
          drawn where it is: over that ring is over the trap. */}
      <mesh
        name="updraftVentCeiling"
        position={[0, ceiling, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry args={[reach - 0.06, reach, 24]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.45} />
      </mesh>
      <mesh
        name="updraftVentColumn"
        ref={column}
        position={[0, (UPDRAFT_MIN_AIR + ceiling) / 2, 0]}
        visible={false}
      >
        <cylinderGeometry args={[reach * 0.9, reach * 0.6, ceiling - UPDRAFT_MIN_AIR, 18, 1, true]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.2} side={2} depthWrite={false} />
      </mesh>
      <group position={[0, 0.03, 0]}>
        <FloorVent reach={reach} />
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Propped mattress
// ---------------------------------------------------------------------------
// VERB: hands the runner's own horizontal speed back to them reversed, so the
// harder they arrive the further back they end up.
// NOT the spring pad and not the extension cord: the pad's launch is a fixed
// number the runner cannot influence, and the cord deletes their speed. This
// returns it. Everything about the outcome is chosen by the approach, which
// makes it the only trap on the roster that is completely harmless to a runner
// who walks into it and brutal to one who sprints.

const MATTRESS = WAVE_A_HAZARD.mattress_rebound;
const MATTRESS_SPAN_FALLBACK = 1.8;
/** Multiplier on the returned speed. Over 1 gives back more than it took. */
const MATTRESS_BOUNCE_FALLBACK = 1.6;
const MATTRESS_BAND_HALF = 0.45;
const MATTRESS_HEIGHT = 1.8;
/** Under this the board just absorbs, which is what makes a crawl safe. */
const MATTRESS_MIN_SPEED = 1.2;
/** Cap, so a freak approach cannot fire the runner off the map. */
const MATTRESS_MAX_RETURN = 12.5;
const MATTRESS_VERTICAL_RETURN = 4.5;
const MATTRESS_STUMBLE_MS = 520;

export function MattressReboundTrap({
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
  const face = useRef<Group>(null);
  const band = useRef<Mesh>(null);
  const squash = useRef(0);
  const lastReport = useRef(0);
  const span = Math.max(0.6, trapNumber(trap, "span", MATTRESS_SPAN_FALLBACK));
  const bounce = Math.max(0, trapNumber(trap, "bounce", MATTRESS_BOUNCE_FALLBACK));
  const forward = useMemo(() => trapForward(trap.rotationY), [trap.rotationY]);

  useEffect(() => {
    lastReport.current = 0;
    squash.current = 0;
  }, [startedAt]);

  useFrame((_, delta) => {
    const now = performance.now();
    const step = Math.min(delta, MAX_STEP);
    squash.current = Math.max(0, squash.current - step * 4);
    const target = player.current;
    let heat = 0;
    if (isLive(target)) {
      const p = target.translation();
      const dx = p.x - trap.position[0];
      const dz = p.z - trap.position[2];
      const along = dx * forward.x + dz * forward.z;
      const lateral = dx * forward.z - dz * forward.x;
      const velocity = target.linvel();
      // Only the component coming at the board counts, so a runner sliding
      // along the face is not thrown by it.
      const approach = -(velocity.x * forward.x + velocity.z * forward.z);
      if (Math.abs(lateral) < span / 2 && along > 0 && along < 2.4)
        heat = Math.min(1, Math.max(0, approach) / MATTRESS_MAX_RETURN);
      if (
        along > 0 &&
        along < MATTRESS_BAND_HALF * 2 &&
        Math.abs(lateral) < span / 2 &&
        p.y - trap.position[1] < MATTRESS_HEIGHT &&
        approach > MATTRESS_MIN_SPEED &&
        now - lastReport.current > MATTRESS.gateMs
      ) {
        lastReport.current = now;
        const mass = target.mass();
        const returned = Math.min(MATTRESS_MAX_RETURN, approach * (1 + bounce));
        const impulseMass = mass > 0 ? mass : 1;
        target.applyImpulse(
          {
            x: forward.x * returned * impulseMass,
            y: MATTRESS_VERTICAL_RETURN * impulseMass,
            z: forward.z * returned * impulseMass,
          },
          true,
        );
        soapUntilRef.current = Math.max(soapUntilRef.current, now + MATTRESS_STUMBLE_MS);
        squash.current = 1;
        contact(trap, onHazard, MATTRESS.impulse);
        mechanic(trap, onMechanic, "mattress_launched", Math.hypot(returned, MATTRESS_VERTICAL_RETURN));
      }
    }
    // Heats with the approaching runner's speed: the wind-up is the runner's
    // own momentum being shown back to them before it is returned.
    fadeMarker(band.current, 0.3 + heat * 0.62);
    if (face.current) face.current.position.z = -squash.current * 0.16;
  }, TRAP_FRAME_PRIORITY);

  return (
    <RigidBody
      ref={body}
      type="fixed"
      colliders={false}
      position={[trap.position[0], trap.position[1], trap.position[2]]}
      rotation={[0, trap.rotationY, 0]}
    >
      <CuboidCollider args={[span / 2, 0.85, 0.16]} position={[0, 0.85, -0.16]} />
      {/* The band that returns speed, at the depth and span the test uses. */}
      <mesh
        name="mattressReboundBand"
        ref={band}
        position={[0, 0.02, MATTRESS_BAND_HALF]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[span, MATTRESS_BAND_HALF * 2]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.3} />
      </mesh>
      <mesh
        name="mattressReboundFace"
        position={[0, 0.028, 0.04]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[span, 0.08]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.95} />
      </mesh>
      <group ref={face}>
        <ProppedMattress span={span} />
      </group>
    </RigidBody>
  );
}

// ---------------------------------------------------------------------------
// Plate stack
// ---------------------------------------------------------------------------
// VERB: one contact converts a tidy stack into a field of shards that stays on
// the floor for the rest of the attempt.
// NOT the laundry basket: the basket spills props another trap can push. This
// creates hazard, not scenery - after the break there is a permanently ruined
// stretch of floor downstream of where the stack stood, and the runner made it
// themselves. It is the only trap whose reach is larger after it has been used
// than before, and the field it will make is printed before it is made.

const PLATES = WAVE_A_HAZARD.plate_shards;
const PLATES_SPREAD_FALLBACK = 2.4;
/** Touching this close to the stack knocks it over. */
const PLATES_STACK_RADIUS = 0.45;
const PLATES_SHARDS = 5;
const PLATES_SHARD_RADIUS = 0.42;
const PLATES_BREAK_SHOVE = 3.8;
/** Fraction of speed pulled out per second while standing in the shards. */
const PLATES_SHARD_BRAKE = 5;
const PLATES_HEIGHT = 1.1;
/** The stack rattles once the runner is inside this: the wind-up. */
const PLATES_RATTLE = 1.4;

export function PlateShardsTrap({
  trap,
  player,
  grabbables,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const stack = useRef<Group>(null);
  const field = useRef<Group>(null);
  const potential = useRef<Mesh>(null);
  const broken = useRef(false);
  const lastReport = useRef(0);
  const spread = Math.max(0.8, trapNumber(trap, "spread", PLATES_SPREAD_FALLBACK));
  // Seeded, so a retry meets the same field rather than a fresh scatter.
  const shards = useMemo(() => {
    const random = createSeededRandom(trap.seed);
    return Array.from({ length: PLATES_SHARDS }, () => {
      const angle = random() * Math.PI * 2;
      const distance = lerp(PLATES_STACK_RADIUS, spread - PLATES_SHARD_RADIUS, random());
      return {
        x: Math.sin(angle) * distance * 0.7,
        // Biased down the course, because that is the floor the runner still
        // has to cross: breaking the stack ruins the road ahead, not behind.
        z: Math.abs(Math.cos(angle)) * distance,
      };
    });
  }, [spread, trap.seed]);

  useEffect(() => {
    broken.current = false;
    lastReport.current = 0;
  }, [startedAt]);

  useFrame((_, delta) => {
    const now = performance.now();
    const step = Math.min(delta, MAX_STEP);
    const target = player.current;
    let closing = 0;

    if (!broken.current) {
      let struck = false;
      if (isLive(target)) {
        const p = target.translation();
        const distance = Math.hypot(p.x - trap.position[0], p.z - trap.position[2]);
        closing = Math.max(0, 1 - distance / PLATES_RATTLE);
        if (distance < PLATES_STACK_RADIUS && p.y - trap.position[1] < PLATES_HEIGHT) struck = true;
      }
      if (!struck)
        for (const [id, other] of grabbables.current) {
          if (id === trap.id || !isLive(other)) continue;
          const p = other.translation();
          if (Math.hypot(p.x - trap.position[0], p.z - trap.position[2]) < PLATES_STACK_RADIUS) {
            struck = true;
            break;
          }
        }
      if (struck) {
        broken.current = true;
        lastReport.current = now;
        mechanic(trap, onMechanic, "plates_broken", spread);
        contact(trap, onHazard, PLATES.impulse);
        if (isLive(target)) {
          const p = target.translation();
          const dx = p.x - trap.position[0];
          const dz = p.z - trap.position[2];
          const away = Math.max(Math.hypot(dx, dz), 0.2);
          target.applyImpulse(
            { x: (dx / away) * PLATES_BREAK_SHOVE, y: 1.2, z: (dz / away) * PLATES_BREAK_SHOVE },
            true,
          );
        }
      }
    } else if (isLive(target)) {
      const p = target.translation();
      if (p.y - trap.position[1] < PLATES_HEIGHT) {
        for (const shard of shards) {
          const distance = Math.hypot(
            p.x - (trap.position[0] + shard.x),
            p.z - (trap.position[2] + shard.z),
          );
          if (distance >= PLATES_SHARD_RADIUS) continue;
          const velocity = target.linvel();
          const mass = target.mass();
          const brake = Math.min(1, PLATES_SHARD_BRAKE * step) * (mass > 0 ? mass : 1);
          target.applyImpulse(
            { x: -velocity.x * brake, y: 0, z: -velocity.z * brake },
            true,
          );
          if (now - lastReport.current > PLATES.gateMs) {
            lastReport.current = now;
            contact(trap, onHazard, PLATES.impulse);
            mechanic(trap, onMechanic, "shard_stepped", Math.hypot(velocity.x, velocity.z));
          }
          break;
        }
      }
    }

    if (stack.current) {
      stack.current.visible = !broken.current;
      stack.current.position.x = closing * 0.03 * Math.sin(now / 24);
      stack.current.rotation.z = closing * 0.05 * Math.sin(now / 31);
    }
    if (field.current) field.current.visible = broken.current;
    if (potential.current) potential.current.visible = !broken.current;
  }, TRAP_FRAME_PRIORITY);

  return (
    <group position={[trap.position[0], trap.position[1], trap.position[2]]}>
      {/* Before the break: the whole field this stack is capable of making, at
          the spread the shards are actually seeded within. */}
      <mesh
        name="plateShardsPotential"
        ref={potential}
        position={[0, 0.016, spread / 3]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry args={[spread - 0.07, spread, 44]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.3} />
      </mesh>
      <mesh name="plateShardsTrigger" position={[0, 0.022, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[PLATES_STACK_RADIUS - 0.07, PLATES_STACK_RADIUS, 22]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.85} />
      </mesh>
      {/* After the break: each shard at the radius that brakes the runner. */}
      <group ref={field} visible={false}>
        {shards.map((shard, index) => (
          <group key={index} position={[shard.x, 0, shard.z]}>
            <mesh name={`plateShardsPatch${index}`} position={[0, 0.018, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[PLATES_SHARD_RADIUS, 14]} />
              <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.38} />
            </mesh>
            <mesh name={`plateShardsPatchRim${index}`} position={[0, 0.024, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[PLATES_SHARD_RADIUS - 0.06, PLATES_SHARD_RADIUS, 16]} />
              <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.8} />
            </mesh>
          </group>
        ))}
      </group>
      <group ref={stack} position={[0, 0.03, 0]}>
        <PlateStack radius={PLATES_STACK_RADIUS} />
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Cat flap
// ---------------------------------------------------------------------------
// VERB: only hurts at a middling speed - a crawl pushes it open and a sprint
// goes straight through, and anything in between gets it swinging back.
// NOT the extension cord: the cord has one threshold and the answer is always
// "slower". This has two, so slowing down is only right if the runner slows
// down far enough, and speeding up is equally correct. It is the one hazard
// where the wrong response to seeing it is to ease off a little.

const FLAP = WAVE_A_HAZARD.cat_flap;
const FLAP_SPAN_FALLBACK = 1.3;
const FLAP_SLOW_FALLBACK = 2.2;
const FLAP_FAST_FALLBACK = 6;
const FLAP_BAND_HALF = 0.34;
const FLAP_HEIGHT = 1.3;
const FLAP_REBOUND = 5.2;
const FLAP_SLAM = 2.6;
const FLAP_STUMBLE_MS = 460;
/** The gauge lights up once the runner is inside this. */
const FLAP_WATCH = 3.4;
/** Top of the gauge's scale, as a multiple of the fast threshold. */
const FLAP_GAUGE_TOP = 1.25;

export function CatFlapTrap({
  trap,
  player,
  soapUntilRef,
  startedAt,
  onHazard,
  onMechanic,
}: TrapProps) {
  const door = useRef<Group>(null);
  const needle = useRef<Mesh>(null);
  const swing = useRef(0);
  const lastReport = useRef(0);
  const span = Math.max(0.5, trapNumber(trap, "span", FLAP_SPAN_FALLBACK));
  const slow = Math.max(0.4, trapNumber(trap, "slow", FLAP_SLOW_FALLBACK));
  const fast = Math.max(slow + 0.6, trapNumber(trap, "fast", FLAP_FAST_FALLBACK));
  const forward = useMemo(() => trapForward(trap.rotationY), [trap.rotationY]);
  const gaugeTop = fast * FLAP_GAUGE_TOP;

  useEffect(() => {
    lastReport.current = 0;
    swing.current = 0;
  }, [startedAt]);

  useFrame((_, delta) => {
    const now = performance.now();
    const step = Math.min(delta, MAX_STEP);
    swing.current = Math.max(0, swing.current - step * 2.6);
    const target = player.current;
    let reading = 0;
    let watching = false;
    if (isLive(target)) {
      const p = target.translation();
      const dx = p.x - trap.position[0];
      const dz = p.z - trap.position[2];
      const along = dx * forward.x + dz * forward.z;
      const lateral = dx * forward.z - dz * forward.x;
      const velocity = target.linvel();
      const speed = Math.hypot(velocity.x, velocity.z);
      const reach = Math.hypot(dx, dz);
      watching = reach < FLAP_WATCH;
      reading = Math.min(1, speed / gaugeTop);
      // The flap starts moving only when the approach is in the band that will
      // catch, which is the wind-up: a safe approach leaves it hanging still.
      if (watching && speed > slow && speed < fast) swing.current = Math.max(swing.current, 0.5);
      if (
        Math.abs(along) < FLAP_BAND_HALF &&
        Math.abs(lateral) < span / 2 &&
        p.y - trap.position[1] < FLAP_HEIGHT &&
        speed > slow &&
        speed < fast &&
        now - lastReport.current > FLAP.gateMs
      ) {
        lastReport.current = now;
        const heading = Math.max(0.001, speed);
        target.applyImpulse(
          {
            x: (-velocity.x / heading) * FLAP_REBOUND,
            y: -FLAP_SLAM,
            z: (-velocity.z / heading) * FLAP_REBOUND,
          },
          true,
        );
        soapUntilRef.current = Math.max(soapUntilRef.current, now + FLAP_STUMBLE_MS);
        swing.current = 1;
        contact(trap, onHazard, FLAP.impulse);
        mechanic(trap, onMechanic, "flap_rebounded", speed);
      }
    }
    if (door.current) door.current.rotation.x = Math.sin(now / 60) * swing.current * 0.45;
    if (needle.current) {
      needle.current.visible = watching;
      needle.current.position.x = (reading - 0.5) * span * 2;
    }
  }, TRAP_FRAME_PRIORITY);

  return (
    <group
      position={[trap.position[0], trap.position[1], trap.position[2]]}
      rotation={[0, trap.rotationY, 0]}
    >
      <mesh name="catFlapBand" position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[span, FLAP_BAND_HALF * 2]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.42} />
      </mesh>
      {/* A speed gauge on the floor, drawn to the same scale the needle reads
          on. Cream is safe and danger is the band that catches, so the runner
          can see whether to slow down or speed up rather than guessing. */}
      <group position={[0, 0, -FLAP_BAND_HALF - 0.4]}>
        {/* Every segment is centred at the midpoint of the speeds it covers,
            on the same scale the needle reads on: x(v) = (v / gaugeTop - 0.5)
            * span * 2. This one was centred at 0, which put the crawl-safe
            band under the middle of the gauge and told the runner to hold a
            speed that is exactly the one that catches. */}
        <mesh
          name="catFlapGaugeSafeSlow"
          position={[(slow / 2 / gaugeTop - 0.5) * span * 2, 0.02, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[(slow / gaugeTop) * span * 2, 0.16]} />
          <meshBasicMaterial color={PALETTE.cream} transparent opacity={0.75} />
        </mesh>
        <mesh
          name="catFlapGaugeUnsafe"
          position={[((slow + fast) / 2 / gaugeTop - 0.5) * span * 2, 0.022, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[((fast - slow) / gaugeTop) * span * 2, 0.2]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.9} />
        </mesh>
        <mesh
          name="catFlapGaugeSafeFast"
          position={[((fast + gaugeTop) / 2 / gaugeTop - 0.5) * span * 2, 0.02, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[((gaugeTop - fast) / gaugeTop) * span * 2, 0.16]} />
          <meshBasicMaterial color={PALETTE.cream} transparent opacity={0.75} />
        </mesh>
        <mesh
          name="catFlapGaugeNeedle"
          ref={needle}
          position={[0, 0.028, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          visible={false}
        >
          <planeGeometry args={[0.07, 0.34]} />
          <meshBasicMaterial color={PALETTE.ink} />
        </mesh>
      </group>
      {/* Only the leaf swings, so the surround it hangs in stays put, and the
          group that swings sits ON the hinge rather than on the floor. Form and
          proportions from assets/reference/trap-cat-flap.png. */}
      <CatFlapFrame span={span} />
      <group ref={door} position={catFlapHinge(span)}>
        <CatFlapLeaf span={span} />
      </group>
    </group>
  );
}
