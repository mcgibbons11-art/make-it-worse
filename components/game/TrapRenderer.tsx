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
import { PALETTE } from "@/lib/game/constants";
import { createSeededRandom, lerp } from "@/lib/game/seed";
import type { HazardContact, TrapInstance } from "@/lib/game/types";
import { AudioManager } from "@/lib/audio/AudioManager";
import { AssetModel } from "./AssetModel";
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
  sound: "impact" | "spring" = "impact",
) {
  if (sound === "spring") AudioManager.spring();
  else AudioManager.impact();
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
      <CuboidCollider args={[0.68, 0.42, 0.42]} position={[0, -1.75, 0]} />
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
        <AssetModel model="hammer" position={[0, -2.25, 0]} rotation={[0, 0, Math.PI / 2]} />
      </group>
    </RigidBody>
  );
}
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
    if (!activated.current && Math.hypot(a.x - b.x, a.z - b.z) < 4) {
      activated.current = true;
      const direction = {
        x: Math.sin(trap.rotationY),
        y: 0.6,
        z: Math.cos(trap.rotationY),
      };
      rigid.wakeUp();
      rigid.applyImpulse(
        { x: direction.x * 7, y: direction.y, z: direction.z * 7 },
        true,
      );
      rigid.applyTorqueImpulse({ x: 0.3, y: 0.5, z: 0.6 }, true);
      mechanic(trap, onMechanic, "charge_started", 7);
    }
  }, -100);
  return (
    <RigidBody
      ref={setBodyRef}
      type="dynamic"
      colliders={false}
      position={[trap.position[0], trap.position[1] + 0.8, trap.position[2]]}
      rotation={[0, trap.rotationY, 0]}
      mass={4}
      friction={0.85}
      canSleep
      onCollisionEnter={(event) => {
        if (playerCollision(event)) {
          contact(trap, onHazard, 14);
          mechanic(trap, onMechanic, "charge_contact", 14);
        }
      }}
    >
      <CuboidCollider args={[0.68, 0.92, 0.48]} />
      <AssetModel model="refrigerator" position={[0, -0.92, 0]} />
    </RigidBody>
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
        body.addForce({ x: forward.x * objectForce, y: 0.6, z: forward.z * objectForce }, true);
      }
    }
    const along = dx * forward.x + dz * forward.z;
    const lateral = Math.abs(dx * forward.z - dz * forward.x);
    if (along > 0 && along < 4.2 && lateral < 1.2) {
      const force = 19 * (1 - along / 4.2);
      target.addForce(
        { x: forward.x * force, y: 1.2, z: forward.z * force },
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
      <mesh position={[0, -0.56, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.82, 0.9, 0.16, 24]} />
        <meshStandardMaterial color="#ff5964" emissive="#ff5964" emissiveIntensity={0.22} roughness={0.58} />
      </mesh>
      <AssetModel model="fan" position={[0, -0.65, 0]} />
      <group ref={blades} position={[0, 0.27, 0.3]} scale={1.28}>
        {[0, 1, 2].map((index) => (
          <mesh key={index} rotation={[0, 0, (index * Math.PI * 2) / 3]} position={[0, 0.24, 0]} castShadow>
            <capsuleGeometry args={[0.12, 0.42, 5, 10]} />
            <meshStandardMaterial color="#ffd84d" roughness={0.75} />
          </mesh>
        ))}
        <mesh castShadow>
          <sphereGeometry args={[0.16, 12, 10]} />
          <meshStandardMaterial color="#ff5964" roughness={0.75} />
        </mesh>
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
  useFrame(() => {
    const target = player.current;
    if (!isLive(target)) return;
    const p = target.translation();
    if (
      Math.abs(p.x - trap.position[0]) < 0.9 &&
      Math.abs(p.z - trap.position[2]) < 1
    ) {
      soapUntilRef.current = performance.now() + 100;
      target.addForce(
        {
          x: Math.sin(performance.now() / 230 + trap.seed) * 1.2,
          y: 0,
          z: Math.cos(performance.now() / 260 + trap.seed) * 1.2,
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
      const strength = velocity.y < 0 ? 9.5 : 8;
      target.applyImpulse(
        {
          x: Math.sin(trap.rotationY) * 3.2,
          y: strength,
          z: Math.cos(trap.rotationY) * 3.2,
        },
        true,
      );
      last.current = performance.now();
      compression.current = 1;
      contact(trap, onHazard, 12, "spring");
      mechanic(trap, onMechanic, "spring_impulse", strength);
    }
  }, -100);
  return (
    <group
      ref={pad}
      position={[trap.position[0], trap.position[1] + 0.18, trap.position[2]]}
      rotation={[0, trap.rotationY, 0]}
    >
      <mesh position={[0, -0.12, 0]} castShadow>
        <cylinderGeometry args={[0.78, 0.88, 0.22, 24]} />
        <meshStandardMaterial color="#24324a" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.7, 0.76, 0.12, 24]} />
        <meshStandardMaterial color="#57dfa1" emissive="#57dfa1" emissiveIntensity={0.55} roughness={0.45} />
      </mesh>
      {[0, Math.PI / 2, Math.PI, Math.PI * 1.5].map((angle) => (
        <mesh key={angle} position={[Math.sin(angle) * 0.43, 0.12, Math.cos(angle) * 0.43]} rotation={[Math.PI / 2, 0, -angle]}>
          <coneGeometry args={[0.12, 0.38, 10]} />
          <meshBasicMaterial color="#ffd84d" />
        </mesh>
      ))}
      <AssetModel model="spring" position={[0, -0.18, 0]} />
    </group>
  );
}
function Vacuum({ trap, player, trapBodies, onHazard, onMechanic }: TrapProps) {
  const body = useRef<RapierRigidBody>(null);
  useRegisterTrapBody(body, trapBodies, trap.id);
  const reportedState = useRef<"idle" | "chasing" | "returning">("idle");
  const origin = useMemo(
    () => ({
      x: trap.position[0],
      y: trap.position[1] + 0.55,
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
      distance < 4.5
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
    if (distance < 2.5) {
      const force = 13 * (1 - distance / 2.5);
      target.addForce(
        {
          x: ((p.x - v.x) / Math.max(distance, 0.2)) * force,
          y: 0.4,
          z: ((p.z - v.z) / Math.max(distance, 0.2)) * force,
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
      <CuboidCollider args={[0.5, 0.55, 0.45]} />
      <AssetModel model="vacuum" position={[0, -0.55, 0]} />
      {[0.8, 1.25, 1.7].map((distance, index) => (
        <mesh key={distance} position={[0, -0.08, distance]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.2 + index * 0.08, 0.018, 6, 18]} />
          <meshBasicMaterial color="#b9a7ff" transparent opacity={0.5 - index * 0.1} />
        </mesh>
      ))}
    </RigidBody>
  );
}
function Toilet({ trap, startedAt, trapBodies, onHazard, onMechanic }: TrapProps) {
  const body = useRef<RapierRigidBody>(null);
  useRegisterTrapBody(body, trapBodies, trap.id);
  const orbitReported = useRef(false);
  const random = useMemo(() => createSeededRandom(trap.seed), [trap.seed]);
  const speed = lerp(1.25, 1.8, random()) * (random() > 0.5 ? 1 : -1);
  const radius = trap.zoneId.startsWith("bridge") ? 1.05 : 1.55;
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
        <CuboidCollider args={[0.52, 0.45, 0.5]} />
        <AssetModel model="toilet" position={[0, -0.45, 0]} />
      </RigidBody>
    </>
  );
}
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
      mass={0.55}
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
      <BallCollider args={[0.75]} />
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
  }
}
