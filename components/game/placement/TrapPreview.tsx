"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";
import { TRAP_CATALOG } from "@/lib/game/trap-catalog";
import type { TrapPlacementInput, TrapType, Vec3Tuple } from "@/lib/game/types";
import { AssetModel, type ModelName } from "../AssetModel";

const models: Record<TrapType, ModelName> = {
  swinging_hammer: "hammer",
  rolling_fridge: "refrigerator",
  floor_fan: "fan",
  soap_slick: "soap",
  spring_pad: "spring",
  angry_vacuum: "vacuum",
  rotating_toilet: "toilet",
  giant_beach_ball: "ball",
};

export function TrapPreview({
  placement,
  position,
  valid,
}: {
  placement: TrapPlacementInput;
  position: Vec3Tuple;
  valid: boolean;
}) {
  const group = useRef<Group>(null);
  const telegraph = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (group.current) {
      group.current.position.y =
        position[1] + 0.05 + Math.sin(clock.elapsedTime * 3) * 0.05;
      if (!valid) group.current.position.x = position[0] + Math.sin(clock.elapsedTime * 18) * 0.025;
      else group.current.position.x = position[0];
    }
    if (telegraph.current) {
      telegraph.current.rotation.y = clock.elapsedTime * 0.6;
      const pulse = 1 + Math.sin(clock.elapsedTime * 4) * 0.035;
      telegraph.current.scale.set(pulse, 1, pulse);
    }
  });
  const radius = TRAP_CATALOG[placement.type].placementRadius;
  const color = valid ? "#57dfa1" : "#ff5c65";
  return (
    <group
      ref={group}
      position={position}
      rotation={[0, placement.rotationQuarterTurns * (Math.PI / 2), 0]}
    >
      <AssetModel model={models[placement.type]} />
      <pointLight color={color} intensity={3.2} distance={4.5} position={[0, 1.2, 0]} />
      <mesh position={[0, 1.15, 0]}>
        <cylinderGeometry args={[radius * 0.52, radius * 0.86, 2.3, 24, 1, true]} />
        <meshBasicMaterial color={color} transparent opacity={0.13} depthWrite={false} side={2} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
        <circleGeometry args={[radius, 32]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.52}
          depthWrite={false}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.035, 0]}>
        <ringGeometry args={[radius * 0.94, radius, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} />
      </mesh>
      <group ref={telegraph} position={[0, 0.055, 0]}>
        {[0, Math.PI / 2, Math.PI, Math.PI * 1.5].map((angle) => (
          <group key={angle} rotation={[0, angle, 0]} position={[Math.sin(angle) * radius, 0, Math.cos(angle) * radius]}>
            <mesh position={[0, 0, -0.14]}>
              <boxGeometry args={[0.06, 0.045, 0.34]} />
              <meshBasicMaterial color={color} transparent opacity={0.95} />
            </mesh>
            <mesh position={[0.14, 0, 0]}>
              <boxGeometry args={[0.34, 0.045, 0.06]} />
              <meshBasicMaterial color={color} transparent opacity={0.95} />
            </mesh>
          </group>
        ))}
      </group>
      {(placement.type === "rotating_toilet" ||
        placement.type === "swinging_hammer") && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
          <ringGeometry args={[radius * 1.2, radius * 1.26, 40]} />
          <meshBasicMaterial color={color} transparent opacity={0.55} />
        </mesh>
      )}
      {placement.type === "floor_fan" && (
        <mesh position={[0, 0.06, radius * 1.45]} rotation={[-Math.PI / 2, 0, 0]}>
          <coneGeometry args={[radius * 1.25, radius * 2.8, 3, 1, true]} />
          <meshBasicMaterial color={color} transparent opacity={0.24} depthWrite={false} side={2} />
        </mesh>
      )}
      {placement.type === "angry_vacuum" && (
        <>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.045, 0]}>
            <ringGeometry args={[2.28, 2.4, 40]} />
            <meshBasicMaterial color={color} transparent opacity={0.56} />
          </mesh>
          <mesh position={[0, 0.055, 1.2]}>
            <boxGeometry args={[0.08, 0.04, 2.4]} />
            <meshBasicMaterial color={color} transparent opacity={0.68} />
          </mesh>
        </>
      )}
      {(placement.type === "rolling_fridge" || placement.type === "giant_beach_ball") && (
        <mesh position={[0, 0.045, radius * 1.65]}>
          <boxGeometry args={[radius * 1.4, 0.045, radius * 3.3]} />
          <meshBasicMaterial color={color} transparent opacity={0.22} depthWrite={false} />
        </mesh>
      )}
      {placement.type === "spring_pad" && (
        <group position={[0, 0.18, radius * 1.2]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.24, 0.65, 10]} />
            <meshBasicMaterial color={color} transparent opacity={0.86} />
          </mesh>
          <mesh position={[0, 0, -0.55]}>
            <boxGeometry args={[0.12, 0.12, 0.9]} />
            <meshBasicMaterial color={color} transparent opacity={0.72} />
          </mesh>
        </group>
      )}
    </group>
  );
}
