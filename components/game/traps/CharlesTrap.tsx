"use client";

import { CuboidCollider, RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { AudioManager } from "@/lib/audio/AudioManager";
import { createCharlesModel } from "../models/createCharlesModel";
import type { TrapProps } from "../TrapRenderer";

const CHARLES_IMPULSE = 13;
const CHARLES_GATE_MS = 1000;

export function CharlesModel() {
  const rig = useMemo(() => createCharlesModel(), []);
  return <primitive object={rig.root} rotation={[0, Math.PI, 0]} />;
}

export function CharlesTrap({ trap, player, trapBodies, onHazard, onMechanic }: TrapProps) {
  const body = useRef<RapierRigidBody>(null);
  const rig = useMemo(() => createCharlesModel(), []);
  const lastHit = useRef(-Infinity);
  const homeX = trap.position[0];
  const homeZ = trap.position[2];
  const speed = typeof trap.params.speed === "number" ? trap.params.speed : 2.25;
  const leash = typeof trap.params.leash === "number" ? trap.params.leash : 3.8;

  useEffect(() => {
    const registry = trapBodies.current;
    const rigid = body.current;
    if (rigid) registry.set(trap.id, rigid);
    return () => {
      registry.delete(trap.id);
    };
  }, [trap.id, trapBodies]);

  useFrame((state, delta) => {
    const rigid = body.current;
    const runner = player.current;
    if (!rigid || !runner) return;
    const crawl = state.clock.elapsedTime * 9;
    rig.leftShoulder.rotation.z = -0.22 + Math.sin(crawl) * 0.18;
    rig.rightShoulder.rotation.z = 0.42 - Math.sin(crawl) * 0.14;
    rig.leftHip.rotation.z = -0.35 - Math.sin(crawl) * 0.16;
    rig.rightHip.rotation.z = 0.35 + Math.sin(crawl) * 0.16;
    rig.head.rotation.x = -0.12 + Math.abs(Math.sin(crawl)) * 0.045;
    rig.weaponHand.rotation.z = Math.sin(crawl * 0.5) * 0.12;
    const here = rigid.translation();
    const target = runner.translation();
    const fromHome = Math.hypot(target.x - homeX, target.z - homeZ);
    const goalX = fromHome <= leash ? target.x : homeX;
    const goalZ = fromHome <= leash ? target.z : homeZ;
    const dx = goalX - here.x;
    const dz = goalZ - here.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.02) return;
    const step = Math.min(distance, speed * Math.min(delta, 0.05));
    rigid.setNextKinematicTranslation({
      x: here.x + (dx / distance) * step,
      y: trap.position[1] + 0.03 + Math.abs(Math.sin(state.clock.elapsedTime * 9)) * 0.035,
      z: here.z + (dz / distance) * step,
    });
    rigid.setNextKinematicRotation(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(dx, dz)),
    );
  });

  return (
    <RigidBody
      ref={body}
      type="kinematicPosition"
      colliders={false}
      position={[homeX, trap.position[1] + 0.03, homeZ]}
      rotation={[0, trap.rotationY, 0]}
      onCollisionEnter={(event) => {
        if (event.other.rigidBodyObject?.userData.kind !== "player") return;
        const now = performance.now();
        if (now - lastHit.current < CHARLES_GATE_MS) return;
        lastHit.current = now;
        AudioManager.hazard(trap.type, CHARLES_IMPULSE);
        onHazard({
          trapInstanceId: trap.id,
          trapType: trap.type,
          ownerName: trap.ownerName,
          contactedAtMs: now,
          impulseMagnitude: CHARLES_IMPULSE,
        });
        onMechanic?.({ trapType: trap.type, event: "charles_attack", magnitude: CHARLES_IMPULSE });
      }}
    >
      <CuboidCollider args={[0.33, 0.3, 0.34]} position={[0, 0.3, 0]} />
      <primitive object={rig.root} rotation={[0, Math.PI, 0]} />
    </RigidBody>
  );
}
