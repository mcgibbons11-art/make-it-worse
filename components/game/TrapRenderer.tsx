"use client";
import {
  BallCollider,
  CuboidCollider,
  RigidBody,
  type CollisionEnterPayload,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Euler, Quaternion } from "three";
import * as THREE from "three";
import { PALETTE, PLAYER } from "@/lib/game/constants";
import { createSeededRandom, lerp } from "@/lib/game/seed";
import type { HazardContact, TrapInstance } from "@/lib/game/types";
import { AudioManager } from "@/lib/audio/AudioManager";
import { AssetModel } from "./AssetModel";
import { ProceduralFloorFan } from "./models/MechProps";
import {
  BananaPeelTrap,
  CeilingFanTrap,
  RobotMopTrap,
  ToasterLauncherTrap,
} from "./traps/LauncherTraps";
import {
  LaundryBasketTrap,
  MagnetTrap,
  MousetrapTrap,
  SprinklerTrap,
} from "./traps/ForceTraps";
import {
  CordTripTrap,
  DrawerSlamTrap,
  PaintBucketTrap,
  RugPullTrap,
  SpinCycleTrap,
  StickyGumTrap,
} from "./traps/NewTraps";
import {
  AnkleWeightTrap,
  BuntingLineTrap,
  CartBlockerTrap,
  CatFlapTrap,
  ChuteDropTrap,
  ConveyorStripTrap,
  DominoLineTrap,
  DustBunnyTrap,
  FloodPuddleTrap,
  MattressReboundTrap,
  MotionSensorTrap,
  PipeBurstTrap,
  PlateShardsTrap,
  SteamVentsTrap,
  TiltPlateTrap,
  UpdraftVentTrap,
} from "./traps/TrapsWaveA";
import {
  BallMachineTrap,
  BathroomScalesTrap,
  BinPedalTrap,
  ClothesAirerTrap,
  CuckooClockTrap,
  FishBowlTrap,
  HotPotatoTrap,
  IceDispenserTrap,
  JunkDriftTrap,
  KettleBoilTrap,
  PaparazziTrap,
  PileOnTrap,
  ShoeRackTrap,
  SlowFuseTrap,
  StoveRingTrap,
  SwingDoorTrap,
} from "./traps/TrapsWaveB";
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
export interface TrapMechanicEvent {
  trapType: TrapInstance["type"];
  event: string;
  magnitude: number;
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
  // Each trap has its own voice now, scaled by how hard the hit was. Twelve of
  // sixteen used to share one 90Hz thud, so a magnet grab and a beach-ball
  // nudge were acoustically identical despite a 2x difference in stun.
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
// Pivot-to-head distance, also the AssetModel offset below: the head hangs
// straight down this far when the swing angle is 0.
const HAMMER_ARM_LENGTH = 2.25;
// Head collider half-width, reused for the marker so the strip matches what
// can actually hit the player.
const HAMMER_HEAD_HALF_WIDTH = 0.68;

function Hammer({ trap, startedAt, onHazard, onMechanic, trapBodies }: TrapProps) {
  const body = useRef<RapierRigidBody>(null);
  useRegisterTrapBody(body, trapBodies, trap.id);
  const random = useMemo(() => createSeededRandom(trap.seed), [trap.seed]);
  const params = useMemo(
    () => ({
      amplitude: lerp(0.85, 1.15, random()),
      speed: lerp(1.15, 1.65, random()),
      phase: random() * Math.PI * 2,
    }),
    [random],
  );
  // The pendulum rotates about local X by `angle`, then that frame turns by
  // trap.rotationY, so the head's horizontal swing lands on the forward axis
  // at HAMMER_ARM_LENGTH * sin(angle); this is the same amplitude driving the
  // actual swing, so the footprint cannot drift out of sync with it.
  const sweepHalfLength = HAMMER_ARM_LENGTH * Math.sin(params.amplitude);
  useFrame(() => {
    const elapsed = Math.max(0, performance.now() - startedAt) / 1000;
    const angle =
      Math.sin(elapsed * params.speed + params.phase) *
      params.amplitude;
    const quaternion = new Quaternion().setFromEuler(
      new Euler(angle, trap.rotationY, 0, "ZYX"),
    );
    body.current?.setNextKinematicRotation(quaternion);
  }, -100);
  return (
    <>
      <group
        position={[trap.position[0], trap.position[1] + 0.03, trap.position[2]]}
        rotation={[0, trap.rotationY, 0]}
      >
        <mesh name="hammerSweepFootprint" rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[HAMMER_HEAD_HALF_WIDTH * 2, sweepHalfLength * 2]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.6} />
        </mesh>
      </group>
      <RigidBody
        ref={body}
        type="kinematicPosition"
        colliders={false}
        position={[trap.position[0], trap.position[1] + 2.5, trap.position[2]]}
        onCollisionEnter={(event) => {
          if (playerCollision(event)) {
            contact(trap, onHazard, 15);
            mechanic(trap, onMechanic, "sweep_contact", 15);
          }
        }}
      >
        <CuboidCollider args={[0.15, 1.7, 0.15]} position={[0, -0.2, 0]} />
        <CuboidCollider
          args={[HAMMER_HEAD_HALF_WIDTH, 0.42, 0.42]}
          position={[0, -1.75, 0]}
        />
        <group>
          <mesh position={[-0.9, 0, 0]}>
            <boxGeometry args={[0.18, 2.2, 0.18]} />
            <meshStandardMaterial color={PALETTE.blue} roughness={0.8} />
          </mesh>
          <mesh position={[0.9, 0, 0]}>
            <boxGeometry args={[0.18, 2.2, 0.18]} />
            <meshStandardMaterial color={PALETTE.blue} roughness={0.8} />
          </mesh>
          <mesh position={[0, -0.2, 0]}>
            <boxGeometry args={[0.24, 3.4, 0.24]} />
            <meshStandardMaterial color={PALETTE.yellow} roughness={0.8} />
          </mesh>
          <AssetModel
            model="hammer"
            position={[0, -HAMMER_ARM_LENGTH, 0]}
            rotation={[0, 0, Math.PI / 2]}
          />
        </group>
      </RigidBody>
    </>
  );
}
const FRIDGE_MASS = 4;
// impulse = mass x target speed. 26 gives ~6.5 m/s against a 7.2 m/s player.
const CHARGE_IMPULSE = FRIDGE_MASS * 6.5;
// Proximity that arms the charge, read off the fridge's own live position.
const FRIDGE_TRIGGER_RADIUS = 4;
// Collider half-width, reused so the charge lane marker matches the body.
const FRIDGE_HALF_WIDTH = 0.68;

function Fridge({ trap, player, grabbables, trapBodies, onHazard, onMechanic }: TrapProps) {
  const body = useRef<RapierRigidBody>(null);
  const activated = useRef(false);
  const setBodyRef = (rigid: RapierRigidBody | null) => {
    body.current = rigid;
    if (rigid) {
      grabbables.current.set(trap.id, rigid);
      trapBodies.current.set(trap.id, rigid);
    } else {
      grabbables.current.delete(trap.id);
      trapBodies.current.delete(trap.id);
    }
  };
  useFrame(() => {
    const rigid = body.current;
    const target = player.current;
    if (!isLive(rigid) || !isLive(target)) return;
    const a = rigid.translation();
    const b = target.translation();
    if (!activated.current && Math.hypot(a.x - b.x, a.z - b.z) < FRIDGE_TRIGGER_RADIUS) {
      activated.current = true;
      const direction = {
        x: Math.sin(trap.rotationY),
        y: 0.6,
        z: Math.cos(trap.rotationY),
      };
      rigid.wakeUp();
      // An impulse of 7 on a 4kg body is a 1.75 m/s nudge against a 7.2 m/s
      // runner: measured, it travelled 10cm and stopped. For a "charge" to
      // read as one it has to close on the player, so the impulse now targets
      // roughly 6.5 m/s and the body keeps far less of its friction.
      rigid.applyImpulse(
        {
          x: direction.x * CHARGE_IMPULSE,
          y: direction.y,
          z: direction.z * CHARGE_IMPULSE,
        },
        true,
      );
      rigid.applyTorqueImpulse({ x: 0.3, y: 0.5, z: 0.6 }, true);
      mechanic(trap, onMechanic, "charge_started", CHARGE_IMPULSE);
    }
  }, -100);
  return (
    <>
      <group
        position={[trap.position[0], trap.position[1] + 0.03, trap.position[2]]}
        rotation={[0, trap.rotationY, 0]}
      >
        <mesh name="fridgeTriggerZone" rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[FRIDGE_TRIGGER_RADIUS - 0.14, FRIDGE_TRIGGER_RADIUS, 40]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.6} />
        </mesh>
        {/* Points along the fixed compass heading the charge actually fires on
            (trap.rotationY), not toward the player, so it reads as a lane. */}
        <mesh
          name="fridgeChargeLane"
          position={[0, 0.002, FRIDGE_TRIGGER_RADIUS / 2]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[FRIDGE_HALF_WIDTH * 2, FRIDGE_TRIGGER_RADIUS]} />
          <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.5} />
        </mesh>
      </group>
      <RigidBody
        ref={setBodyRef}
        type="dynamic"
        colliders={false}
        position={[trap.position[0], trap.position[1] + 0.8, trap.position[2]]}
        rotation={[0, trap.rotationY, 0]}
        // 0.85 was high enough that the charge died almost immediately and the
        // player could not shove it either, leaving an immovable wall.
        friction={0.4}
        canSleep
        onCollisionEnter={(event) => {
          if (playerCollision(event)) {
            contact(trap, onHazard, 14);
            mechanic(trap, onMechanic, "charge_contact", 14);
          }
        }}
      >
        {/* Mass on the collider: RigidBody drops the prop, so this body was
            running at 2.40kg (its own volume) rather than 4, and CHARGE_IMPULSE
            gave it 10.8 m/s — faster than the 7.2 m/s player it is chasing. */}
        <CuboidCollider args={[FRIDGE_HALF_WIDTH, 0.92, 0.48]} mass={FRIDGE_MASS} />
        <AssetModel model="refrigerator" position={[0, -0.92, 0]} />
      </RigidBody>
    </>
  );
}
function Fan({ trap, player, grabbables, trapBodies, onHazard, onMechanic }: TrapProps) {
  const body = useRef<RapierRigidBody>(null);
  useRegisterTrapBody(body, trapBodies, trap.id);
  const blades = useRef<THREE.Group>(null);
  const last = useRef(0);
  useFrame((_, delta) => {
    if (blades.current) blades.current.rotation.z += delta * 12;
    const target = player.current;
    if (!isLive(target)) return;
    // Rapier accumulates forces added with addForce and nothing in this project
    // ever resets them, so a per-frame addForce compounded without bound: a
    // player in the cone passed 470 m/s within a second and flew off the map.
    // A per-frame impulse scaled by elapsed time is one-shot and, unlike the
    // old code, does not make trap strength depend on display refresh rate.
    const step = Math.min(delta, 1 / 20);
    const p = target.translation();
    const dx = p.x - trap.position[0];
    const dz = p.z - trap.position[2];
    const forward = {
      x: Math.sin(trap.rotationY),
      z: Math.cos(trap.rotationY),
    };
    for (const body of grabbables.current.values()) {
      if (!isLive(body)) continue;
      const object = body.translation();
      const objectX = object.x - trap.position[0];
      const objectZ = object.z - trap.position[2];
      const objectAlong = objectX * forward.x + objectZ * forward.z;
      const objectLateral = Math.abs(objectX * forward.z - objectZ * forward.x);
      if (objectAlong > 0 && objectAlong < 4.2 && objectLateral < 1.35) {
        const objectForce = 11 * (1 - objectAlong / 4.2);
        body.applyImpulse(
          {
            x: forward.x * objectForce * step,
            y: 0.6 * step,
            z: forward.z * objectForce * step,
          },
          true,
        );
      }
    }
    const along = dx * forward.x + dz * forward.z;
    const lateral = Math.abs(dx * forward.z - dz * forward.x);
    if (along > 0 && along < 4.2 && lateral < 1.2) {
      const force = 19 * (1 - along / 4.2);
      target.applyImpulse(
        {
          x: forward.x * force * step,
          y: 1.2 * step,
          z: forward.z * force * step,
        },
        true,
      );
      if (performance.now() - last.current > 450) {
        contact(trap, onHazard, force);
        mechanic(trap, onMechanic, "wind_force", force);
        last.current = performance.now();
      }
    }
  }, -100);
  return (
    <RigidBody
      ref={body}
      type="fixed"
      colliders={false}
      position={[trap.position[0], trap.position[1] + 0.65, trap.position[2]]}
      rotation={[0, trap.rotationY, 0]}
    >
      <CuboidCollider args={[0.6, 0.65, 0.35]} />
      {/* The base disc and blade group that used to sit here duplicated parts
          the procedural fan already carries. Its own blade group is driven
          through bladesRef instead. The wind rings below stay: they telegraph
          the cone's reach and are not part of the appliance. */}
      <group position={[0, -0.65, 0]}>
        <ProceduralFloorFan bladesRef={blades} />
      </group>
      {[0.95, 1.75, 2.55, 3.35].map((distance, index) => (
        <mesh key={distance} position={[0, 0.15 + index * 0.08, distance]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.58 + index * 0.17, 0.045, 8, 32]} />
          <meshBasicMaterial color={index % 2 ? "#fff3cf" : "#6bbcff"} transparent opacity={0.7 - index * 0.1} />
        </mesh>
      ))}
    </RigidBody>
  );
}
function Soap({ trap, player, soapUntilRef, onHazard, onMechanic }: TrapProps) {
  const bubbles = useRef<THREE.Group>(null);
  const last = useRef(0);
  useFrame(({ clock }) => {
    if (bubbles.current)
      bubbles.current.position.y =
        0.08 + Math.sin(clock.elapsedTime * 3 + trap.seed) * 0.03;
  });
  useFrame((_, delta) => {
    const target = player.current;
    if (!isLive(target)) return;
    const p = target.translation();
    if (
      Math.abs(p.x - trap.position[0]) < 0.9 &&
      Math.abs(p.z - trap.position[2]) < 1
    ) {
      // See the fan: addForce accumulates across frames and is never reset.
      const step = Math.min(delta, 1 / 20);
      soapUntilRef.current = performance.now() + 100;
      target.applyImpulse(
        {
          x: Math.sin(performance.now() / 230 + trap.seed) * 1.2 * step,
          y: 0,
          z: Math.cos(performance.now() / 260 + trap.seed) * 1.2 * step,
        },
        true,
      );
      if (performance.now() - last.current > 450) {
        contact(trap, onHazard, 4);
        mechanic(trap, onMechanic, "slip_applied", 4);
        last.current = performance.now();
      }
    }
  }, -100);
  return (
    <group
      position={[trap.position[0], trap.position[1] + 0.035, trap.position[2]]}
      rotation={[0, trap.rotationY, 0]}
    >
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.82, 20]} />
        <meshStandardMaterial
          color="#72dffd"
          transparent
          opacity={0.72}
          roughness={0.25}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
        <ringGeometry args={[0.72, 0.92, 28]} />
        <meshBasicMaterial color="#ff5964" transparent opacity={0.95} />
      </mesh>
      {[0, Math.PI / 2, Math.PI, Math.PI * 1.5].map((angle) => (
        <mesh key={angle} position={[Math.sin(angle) * 0.78, 0.04, Math.cos(angle) * 0.78]} rotation={[0, angle, 0]}>
          <coneGeometry args={[0.11, 0.32, 8]} />
          <meshBasicMaterial color="#ffd84d" />
        </mesh>
      ))}
      <AssetModel model="soap" position={[0.25, 0.02, 0]} rotation={[0, 0.3, 0]} />
      <group ref={bubbles}>
        {[-0.4, 0.02, 0.42].map((x, index) => (
          <mesh key={x} position={[x, 0.1, (index - 1) * 0.25]}>
            <sphereGeometry args={[0.08 + index * 0.02, 10, 8]} />
            <meshStandardMaterial color="white" transparent opacity={0.7} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
/**
 * The pad's take-off speed, as a multiple of the runner's own jump.
 *
 * Tied to PLAYER.jumpVelocity rather than written as a raw impulse, because a
 * raw one has already inverted this trap once. At gravityScale 2.2 an impulse
 * of 9.5 lifted about 1.85u. The retune to 3 left that same 9.5 lifting 1.35u
 * against a jump that now reaches 1.89u, so "helpful, if your destination is
 * the sky" was launching the runner LOWER than simply jumping would, and the
 * grounded case was worse still at 0.98u. Expressed against the jump, the pad
 * stays 1.77x a jump whatever gravity is retuned to next.
 */
const SPRING_LAUNCH_MULTIPLE = 1.35;
const SPRING_FORWARD_FALLBACK = 3.2;

function Spring({ trap, player, onHazard, onMechanic }: TrapProps) {
  const last = useRef(0);
  const pad = useRef<THREE.Group>(null);
  const compression = useRef(0);
  useFrame((_, delta) => {
    compression.current = Math.max(0, compression.current - delta * 4.8);
    if (pad.current) pad.current.scale.y = 1 - compression.current * 0.34;
  });
  useFrame(() => {
    const target = player.current;
    if (!isLive(target)) return;
    const p = target.translation();
    if (
      performance.now() - last.current > 500 &&
      Math.abs(p.x - trap.position[0]) < 0.7 &&
      Math.abs(p.z - trap.position[2]) < 0.7 &&
      p.y < trap.position[1] + 1.3
    ) {
      const velocity = target.linvel();
      const forward =
        typeof trap.params.forward === "number" && Number.isFinite(trap.params.forward)
          ? trap.params.forward
          : SPRING_FORWARD_FALLBACK;
      const launch = PLAYER.jumpVelocity * SPRING_LAUNCH_MULTIPLE;
      // Set, not added. An impulse left the launch at the mercy of whatever
      // vertical velocity the runner arrived carrying: a runner who hit the pad
      // while descending at 4 m/s kept 0.48u of rise against the 1.35u a
      // standing one got, so the harder you fell onto the spring the less it
      // gave back. A spring returns its own stored energy whatever lands on it,
      // and that is also the only form a player can predict. Horizontal speed
      // is preserved rather than overwritten, so the pad redirects a run
      // upward instead of stopping it dead.
      target.setLinvel(
        {
          x: velocity.x + Math.sin(trap.rotationY) * forward,
          y: launch,
          z: velocity.z + Math.cos(trap.rotationY) * forward,
        },
        true,
      );
      last.current = performance.now();
      compression.current = 1;
      contact(trap, onHazard, 12);
      mechanic(trap, onMechanic, "spring_impulse", launch);
    }
  }, -100);
  return (
    <group
      ref={pad}
      position={[trap.position[0], trap.position[1] + 0.18, trap.position[2]]}
      rotation={[0, trap.rotationY, 0]}
    >
      {/* The base disc, glowing top and four chevrons that used to sit here are
          all part of the procedural jump pad now. The enclosing group still
          carries the compression scale, so the whole pad squashes on impact. */}
      <AssetModel model="spring" position={[0, -0.18, 0]} />
    </group>
  );
}
// How high the body hovers above the ground; also the collider half-height,
// so the box still sits flush with the floor.
const VACUUM_HOVER_HEIGHT = 0.55;
// Omnidirectional pull radius: the body chases from any side, not just ahead.
const VACUUM_SUCTION_RADIUS = 2.5;
const VACUUM_CHASE_RADIUS = 4.5;

function Vacuum({ trap, player, trapBodies, onHazard, onMechanic }: TrapProps) {
  const body = useRef<RapierRigidBody>(null);
  useRegisterTrapBody(body, trapBodies, trap.id);
  const reportedState = useRef<"idle" | "chasing" | "returning">("idle");
  const origin = useMemo(
    () => ({
      x: trap.position[0],
      y: trap.position[1] + VACUUM_HOVER_HEIGHT,
      z: trap.position[2],
    }),
    [trap.position],
  );
  const state = useRef<"idle" | "chasing" | "returning">("idle");
  const last = useRef(0);
  useFrame((_, delta) => {
    const rigid = body.current;
    const target = player.current;
    if (!isLive(rigid) || !isLive(target)) return;
    const v = target.translation();
    const p = rigid.translation();
    const distance = Math.hypot(v.x - p.x, v.z - p.z);
    state.current =
      distance < VACUUM_CHASE_RADIUS
        ? "chasing"
        : Math.hypot(p.x - origin.x, p.z - origin.z) > 0.15
          ? "returning"
          : "idle";
    if (state.current !== reportedState.current) {
      reportedState.current = state.current;
      mechanic(trap, onMechanic, `vacuum_${state.current}`);
    }
    const goal = state.current === "chasing" ? v : origin;
    const dx = goal.x - p.x;
    const dz = goal.z - p.z;
    const length = Math.max(0.001, Math.hypot(dx, dz));
    const leash = Math.hypot(p.x - origin.x, p.z - origin.z);
    const speed =
      state.current === "chasing" && leash < 2.4
        ? 2.7
        : state.current === "returning"
          ? 2
          : 0;
    rigid.setNextKinematicTranslation({
      x: p.x + (dx / length) * speed * Math.min(delta, 1 / 20),
      y: origin.y,
      z: p.z + (dz / length) * speed * Math.min(delta, 1 / 20),
    });
    if (speed > 0.01) {
      rigid.setNextKinematicRotation(
        new Quaternion().setFromEuler(new Euler(0, Math.atan2(dx, dz), 0)),
      );
    }
    if (distance < VACUUM_SUCTION_RADIUS) {
      const force = 13 * (1 - distance / VACUUM_SUCTION_RADIUS);
      // See the fan: addForce accumulates across frames and is never reset.
      const step = Math.min(delta, 1 / 20);
      target.applyImpulse(
        {
          x: ((p.x - v.x) / Math.max(distance, 0.2)) * force * step,
          y: 0.4 * step,
          z: ((p.z - v.z) / Math.max(distance, 0.2)) * force * step,
        },
        true,
      );
      if (performance.now() - last.current > 500) {
        contact(trap, onHazard, force);
        mechanic(trap, onMechanic, "suction_applied", force);
        last.current = performance.now();
      }
    }
  }, -100);
  return (
    <RigidBody
      ref={body}
      type="kinematicPosition"
      colliders={false}
      position={[origin.x, origin.y, origin.z]}
      rotation={[0, trap.rotationY, 0]}
    >
      <CuboidCollider args={[0.5, VACUUM_HOVER_HEIGHT, 0.45]} />
      <AssetModel model="vacuum" position={[0, -VACUUM_HOVER_HEIGHT, 0]} />
      {/* Rings are children of the body, not trap.position, so they recentre
          on every chase/return step instead of only telegraphing the spawn. */}
      <mesh
        name="vacuumSuctionRing"
        position={[0, -VACUUM_HOVER_HEIGHT + 0.03, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry args={[VACUUM_SUCTION_RADIUS - 0.12, VACUUM_SUCTION_RADIUS, 40]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.68} />
      </mesh>
      <mesh
        name="vacuumChaseRing"
        position={[0, -VACUUM_HOVER_HEIGHT + 0.025, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry args={[VACUUM_CHASE_RADIUS - 0.06, VACUUM_CHASE_RADIUS, 48]} />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.5} />
      </mesh>
    </RigidBody>
  );
}
// Hazard box half-width along the orbit's radial axis, also the collider arg
// below; the swept annulus reaches radius +/- this, not just the orbit line.
const TOILET_HAZARD_HALF_X = 0.52;

function Toilet({ trap, startedAt, trapBodies, onHazard, onMechanic }: TrapProps) {
  const body = useRef<RapierRigidBody>(null);
  useRegisterTrapBody(body, trapBodies, trap.id);
  const orbitReported = useRef(false);
  // These were computed in the render body from a stateful seeded generator, so
  // every re-render drew new values. The HUD timer re-renders this tree 20x a
  // second, which teleported the hitbox 2-3 metres around its orbit each tick
  // and made the trap unlearnable. The hammer already does this correctly.
  const { speed, radius } = useMemo(() => {
    const random = createSeededRandom(trap.seed);
    return {
      speed: lerp(1.25, 1.8, random()) * (random() > 0.5 ? 1 : -1),
      radius: trap.zoneId.startsWith("bridge") ? 1.05 : 1.55,
    };
  }, [trap.seed, trap.zoneId]);
  useFrame(() => {
    const angle = (Math.max(0, performance.now() - startedAt) / 1000) * speed;
    body.current?.setNextKinematicTranslation({
      x: trap.position[0] + Math.sin(angle) * radius,
      y: trap.position[1] + 0.48,
      z: trap.position[2] + Math.cos(angle) * radius,
    });
    body.current?.setNextKinematicRotation(
      new Quaternion().setFromEuler(new Euler(0, -angle + trap.rotationY, 0)),
    );
    if (!orbitReported.current) {
      orbitReported.current = true;
      mechanic(trap, onMechanic, "orbit_started", radius);
    }
  }, -100);
  return (
    <>
      <mesh
        name="toiletSweepFootprint"
        position={[trap.position[0], trap.position[1] + 0.03, trap.position[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry
          args={[
            Math.max(0.1, radius - TOILET_HAZARD_HALF_X),
            radius + TOILET_HAZARD_HALF_X,
            48,
          ]}
        />
        <meshBasicMaterial color={PALETTE.danger} transparent opacity={0.55} />
      </mesh>
      <mesh
        position={[trap.position[0], trap.position[1] + 0.22, trap.position[2]]}
      >
        <cylinderGeometry args={[0.18, 0.24, 0.44, 10]} />
        <meshStandardMaterial color={PALETTE.red} />
      </mesh>
      <RigidBody
        ref={body}
        type="kinematicPosition"
        colliders={false}
        onCollisionEnter={(event) => {
          if (playerCollision(event)) {
            contact(trap, onHazard, 13);
            mechanic(trap, onMechanic, "sweep_contact", 13);
          }
        }}
      >
        <CuboidCollider args={[TOILET_HAZARD_HALF_X, 0.45, 0.5]} />
        <AssetModel model="toilet" position={[0, -0.45, 0]} />
      </RigidBody>
    </>
  );
}
const BALL_MASS = 0.55;

function Ball({ trap, grabbables, trapBodies, onHazard, onMechanic }: TrapProps) {
  const body = useRef<RapierRigidBody>(null);
  const setBodyRef = (rigid: RapierRigidBody | null) => {
    body.current = rigid;
    if (rigid) {
      grabbables.current.set(trap.id, rigid);
      trapBodies.current.set(trap.id, rigid);
    } else {
      grabbables.current.delete(trap.id);
      trapBodies.current.delete(trap.id);
    }
  };
  return (
    <RigidBody
      ref={setBodyRef}
      type="dynamic"
      colliders={false}
      position={[trap.position[0], trap.position[1] + 0.86, trap.position[2]]}
      canSleep
      restitution={0.82}
      friction={0.5}
      onCollisionEnter={(event) => {
        if (playerCollision(event)) {
          contact(trap, onHazard, 7);
          mechanic(trap, onMechanic, "ball_contact", 7);
        }
      }}
    >
      {/* Same reason as the fridge: on the body this was ignored and the ball
          ran at 1.77kg from its own volume rather than the intended 0.55. */}
      <BallCollider args={[0.75]} mass={BALL_MASS} />
      <AssetModel model="ball" position={[0, -0.75, 0]} />
    </RigidBody>
  );
}
export function TrapRenderer(props: TrapProps) {
  switch (props.trap.type) {
    case "swinging_hammer":
      return <Hammer {...props} />;
    case "rolling_fridge":
      return <Fridge {...props} />;
    case "floor_fan":
      return <Fan {...props} />;
    case "soap_slick":
      return <Soap {...props} />;
    case "spring_pad":
      return <Spring {...props} />;
    case "angry_vacuum":
      return <Vacuum {...props} />;
    case "rotating_toilet":
      return <Toilet {...props} />;
    case "giant_beach_ball":
      return <Ball {...props} />;
    case "toaster_launcher":
      return <ToasterLauncherTrap {...props} />;
    case "ceiling_fan":
      return <CeilingFanTrap {...props} />;
    case "banana_peel":
      return <BananaPeelTrap {...props} />;
    case "robot_mop":
      return <RobotMopTrap {...props} />;
    case "mousetrap":
      return <MousetrapTrap {...props} />;
    case "sprinkler":
      return <SprinklerTrap {...props} />;
    case "laundry_basket":
      return <LaundryBasketTrap {...props} />;
    case "fridge_magnet":
      return <MagnetTrap {...props} />;
    case "paint_bucket":
      return <PaintBucketTrap {...props} />;
    case "spin_cycle":
      return <SpinCycleTrap {...props} />;
    case "sticky_gum":
      return <StickyGumTrap {...props} />;
    case "cord_trip":
      return <CordTripTrap {...props} />;
    case "drawer_slam":
      return <DrawerSlamTrap {...props} />;
    case "rug_pull":
      return <RugPullTrap {...props} />;
    case "conveyor_strip":
      return <ConveyorStripTrap {...props} />;
    case "tilt_plate":
      return <TiltPlateTrap {...props} />;
    case "motion_sensor":
      return <MotionSensorTrap {...props} />;
    case "domino_line":
      return <DominoLineTrap {...props} />;
    case "bunting_line":
      return <BuntingLineTrap {...props} />;
    case "steam_vents":
      return <SteamVentsTrap {...props} />;
    case "pipe_burst":
      return <PipeBurstTrap {...props} />;
    case "ankle_weight":
      return <AnkleWeightTrap {...props} />;
    case "chute_drop":
      return <ChuteDropTrap {...props} />;
    case "cart_blocker":
      return <CartBlockerTrap {...props} />;
    case "dust_bunny":
      return <DustBunnyTrap {...props} />;
    case "flood_puddle":
      return <FloodPuddleTrap {...props} />;
    case "updraft_vent":
      return <UpdraftVentTrap {...props} />;
    case "mattress_rebound":
      return <MattressReboundTrap {...props} />;
    case "plate_shards":
      return <PlateShardsTrap {...props} />;
    case "cat_flap":
      return <CatFlapTrap {...props} />;
    case "paparazzi":
      return <PaparazziTrap {...props} />;
    case "bathroom_scales":
      return <BathroomScalesTrap {...props} />;
    case "slow_fuse":
      return <SlowFuseTrap {...props} />;
    case "pile_on":
      return <PileOnTrap {...props} />;
    case "bin_pedal":
      return <BinPedalTrap {...props} />;
    case "swing_door":
      return <SwingDoorTrap {...props} />;
    case "ball_machine":
      return <BallMachineTrap {...props} />;
    case "cuckoo_clock":
      return <CuckooClockTrap {...props} />;
    case "fish_bowl":
      return <FishBowlTrap {...props} />;
    case "shoe_rack":
      return <ShoeRackTrap {...props} />;
    case "hot_potato":
      return <HotPotatoTrap {...props} />;
    case "stove_ring":
      return <StoveRingTrap {...props} />;
    case "clothes_airer":
      return <ClothesAirerTrap {...props} />;
    case "ice_dispenser":
      return <IceDispenserTrap {...props} />;
    case "kettle_boil":
      return <KettleBoilTrap {...props} />;
    case "junk_drift":
      return <JunkDriftTrap {...props} />;
    default:
      // A trap type with no case above renders as nothing at all: it is
      // placeable, scoreable and completely invisible, which has shipped once
      // already. `never` here makes that a compile error instead, the way
      // AudioManager's hazard() switch does for a silent trap.
      return unrenderable(props.trap.type);
  }
}

function unrenderable(type: never): null {
  console.error(`TrapRenderer has no case for ${String(type)}`);
  return null;
}
