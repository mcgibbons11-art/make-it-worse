"use client";

import { Html } from "@react-three/drei";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { MeshStandardMaterial } from "three";
import { EXIT_POSITION, EXIT_SENSOR_SIZE, PALETTE } from "@/lib/game/constants";

export function ExitDoor({ showLabel }: { showLabel: boolean }) {
  const glow = useRef<MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (glow.current) glow.current.emissiveIntensity = 1.6 + Math.sin(clock.elapsedTime * 4) * 0.35;
  });
  return (
    <group position={EXIT_POSITION}>
      {[-1.35, 1.35].map((x) => (
        <mesh key={x} position={[x, 0, 0]} castShadow>
          <boxGeometry args={[0.35, 3.4, 0.65]} />
          <meshStandardMaterial color={PALETTE.cream} roughness={0.75} />
        </mesh>
      ))}
      <mesh position={[0, 1.55, 0]} castShadow>
        <boxGeometry args={[3.05, 0.35, 0.65]} />
        <meshStandardMaterial color={PALETTE.cream} roughness={0.75} />
      </mesh>
      <mesh position={[0, 0, 0.05]}>
        <boxGeometry args={[2.35, 2.95, 0.12]} />
        <meshStandardMaterial ref={glow} color={PALETTE.green} emissive={PALETTE.green} transparent opacity={0.42} />
      </mesh>
      {showLabel && (
        <Html center position={[0, 2.15, 0]} zIndexRange={[5, 0]}>
          <div className="exit-label">EXIT</div>
        </Html>
      )}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider sensor args={[EXIT_SENSOR_SIZE[0] / 2, EXIT_SENSOR_SIZE[1] / 2, EXIT_SENSOR_SIZE[2] / 2]} />
      </RigidBody>
    </group>
  );
}
