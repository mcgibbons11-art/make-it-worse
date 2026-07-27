"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group, Mesh } from "three";
import { PALETTE } from "@/lib/game/constants";

export interface PlayerMotionState {
  speed: number;
  verticalVelocity: number;
  grounded: boolean;
  yaw: number;
  stunned: boolean;
}

export type PlayerPose = "idle" | "playing" | "victory" | "failure";

export function PlayerVisual({
  avatarSeed = 1,
  ghost = false,
  visible = true,
  pose = "idle",
  motion,
}: {
  avatarSeed?: number;
  ghost?: boolean;
  visible?: boolean;
  pose?: PlayerPose;
  motion?: React.RefObject<PlayerMotionState>;
}) {
  const group = useRef<Group>(null);
  const leftArm = useRef<Mesh>(null);
  const rightArm = useRef<Mesh>(null);
  const leftLeg = useRef<Mesh>(null);
  const rightLeg = useRef<Mesh>(null);
  const head = useRef<Group>(null);
  const torso = useRef<Mesh>(null);
  const wasGrounded = useRef(true);
  const landingPunch = useRef(0);
  const color = [PALETTE.purple, PALETTE.blue, PALETTE.orange, PALETTE.green][Math.abs(avatarSeed) % 4]!;

  useFrame(({ clock }, delta) => {
    const state = motion?.current ?? { speed: 0, verticalVelocity: 0, grounded: true, yaw: 0, stunned: false };
    if (state.grounded && !wasGrounded.current) landingPunch.current = 1;
    wasGrounded.current = state.grounded;
    landingPunch.current = Math.max(0, landingPunch.current - delta * 6.5);
    const cadence = clock.elapsedTime * (7 + Math.min(7, state.speed));
    let swing = Math.sin(cadence) * Math.min(0.72, state.speed * 0.13);
    let armLift = 0;
    let bounce = state.grounded ? Math.abs(Math.sin(cadence)) * Math.min(0.05, state.speed * 0.008) : 0.05;
    if (!state.grounded) {
      swing = state.verticalVelocity > 0 ? -0.75 : 0.6;
      armLift = -0.8;
    }
    if (state.stunned || pose === "failure") {
      swing = Math.sin(clock.elapsedTime * 17) * 1.15;
      armLift = -1.1;
      bounce = Math.abs(Math.sin(clock.elapsedTime * 14)) * 0.08;
    }
    if (pose === "victory") {
      swing = -2.35;
      armLift = -0.35;
      bounce = Math.abs(Math.sin(clock.elapsedTime * 7)) * 0.12;
    }
    leftArm.current?.rotation.set(swing + armLift, 0, 0.18);
    rightArm.current?.rotation.set(-swing + armLift, 0, -0.18);
    leftLeg.current?.rotation.set(-swing * 0.6, 0, 0);
    rightLeg.current?.rotation.set(swing * 0.6, 0, 0);
    if (group.current) {
      group.current.visible = visible;
      group.current.position.y = bounce;
      group.current.rotation.y += (state.yaw - group.current.rotation.y) * Math.min(1, delta * 13);
      const lean = !state.grounded
        ? Math.max(-0.18, Math.min(0.18, -state.verticalVelocity * 0.018))
        : Math.min(0.16, state.speed * 0.018);
      group.current.rotation.x += (lean - group.current.rotation.x) * Math.min(1, delta * 11);
      group.current.rotation.z = pose === "victory" ? Math.sin(clock.elapsedTime * 7) * 0.06 : 0;
      const squash = pose === "failure" ? 0.86 : 1 - landingPunch.current * 0.22;
      group.current.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
    }
    if (head.current) {
      head.current.rotation.z = pose === "failure"
        ? Math.sin(clock.elapsedTime * 13) * 0.16
        : Math.sin(cadence * 0.5) * Math.min(0.045, state.speed * 0.006);
    }
    if (torso.current) torso.current.rotation.z = Math.sin(cadence) * Math.min(0.035, state.speed * 0.004);
  });

  const opacity = ghost ? 0.3 : 1;
  return (
    <group ref={group}>
      <mesh castShadow position={[0, 0.2, 0.08]} scale={[1.08, 1.04, 1.08]}>
        <capsuleGeometry args={[0.35, 0.72, 8, 16]} />
        <meshStandardMaterial color={PALETTE.ink} roughness={0.74} transparent={ghost} opacity={opacity} />
      </mesh>
      <mesh ref={torso} castShadow position={[0, 0.22, 0.02]}>
        <capsuleGeometry args={[0.34, 0.7, 8, 16]} />
        <meshStandardMaterial color={color} roughness={0.48} metalness={0.04} transparent={ghost} opacity={opacity} />
      </mesh>
      <mesh position={[0, 0.17, 0.355]}>
        <capsuleGeometry args={[0.19, 0.33, 6, 14]} />
        <meshStandardMaterial color={PALETTE.cream} roughness={0.7} transparent={ghost} opacity={opacity * 0.92} />
      </mesh>
      <mesh position={[0, 0.59, 0.02]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.3, 0.06, 8, 24]} />
        <meshStandardMaterial color={PALETTE.ink} roughness={0.68} transparent={ghost} opacity={opacity} />
      </mesh>
      <mesh position={[0, -0.13, 0.35]}>
        <boxGeometry args={[0.46, 0.08, 0.08]} />
        <meshStandardMaterial color={PALETTE.yellow} roughness={0.55} transparent={ghost} opacity={opacity} />
      </mesh>
      <mesh position={[0, 0.22, -0.34]} castShadow>
        <capsuleGeometry args={[0.24, 0.42, 7, 14]} />
        <meshStandardMaterial color={PALETTE.red} roughness={0.5} metalness={0.03} transparent={ghost} opacity={opacity} />
      </mesh>
      <mesh position={[0, 0.25, -0.59]} rotation={[0, Math.PI, 0]}>
        <circleGeometry args={[0.12, 18]} />
        <meshBasicMaterial color={PALETTE.yellow} side={2} transparent={ghost} opacity={opacity} />
      </mesh>
      <mesh position={[0, 0.25, -0.595]} rotation={[0, Math.PI, Math.PI / 4]}>
        <boxGeometry args={[0.12, 0.12, 0.018]} />
        <meshBasicMaterial color={PALETTE.ink} transparent={ghost} opacity={opacity} />
      </mesh>
      <group ref={head} position={[0, 1.01, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.44, 24, 18]} />
          <meshStandardMaterial color={ghost ? color : PALETTE.cream} roughness={0.56} transparent={ghost} opacity={opacity} />
        </mesh>
        <mesh position={[0, 0.2, -0.03]} scale={[1.02, 0.55, 1.02]} castShadow>
          <sphereGeometry args={[0.43, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={PALETTE.ink} roughness={0.66} transparent={ghost} opacity={opacity} />
        </mesh>
        {[-0.45, 0.45].map((x) => (
          <mesh key={x} position={[x, 0, 0]}>
            <sphereGeometry args={[0.1, 12, 9]} />
            <meshStandardMaterial color={PALETTE.cream} roughness={0.62} transparent={ghost} opacity={opacity} />
          </mesh>
        ))}
        {[-0.15, 0.15].map((x) => (
          <group key={x}>
            <mesh position={[x, pose === "failure" ? 0.1 : 0.04, 0.4]} scale={pose === "failure" ? 1.3 : 1}>
              <sphereGeometry args={[0.06, 12, 9]} />
              <meshStandardMaterial color={PALETTE.ink} transparent={ghost} opacity={opacity} />
            </mesh>
            <mesh position={[x, 0.145, 0.39]} rotation={[0, 0, x < 0 ? -0.16 : 0.16]}>
              <boxGeometry args={[0.17, 0.035, 0.035]} />
              <meshStandardMaterial color={PALETTE.ink} transparent={ghost} opacity={opacity} />
            </mesh>
          </group>
        ))}
        <mesh position={[0, -0.12, 0.425]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.1, 0.018, 6, 18, Math.PI]} />
          <meshStandardMaterial color={PALETTE.ink} transparent={ghost} opacity={opacity} />
        </mesh>
        {[-0.27, 0.27].map((x) => (
          <mesh key={x} position={[x, -0.1, 0.39]}>
            <circleGeometry args={[0.055, 12]} />
            <meshBasicMaterial color={PALETTE.red} transparent opacity={ghost ? opacity * 0.35 : 0.35} />
          </mesh>
        ))}
      </group>
      <mesh ref={leftArm} position={[-0.46, 0.33, 0]} castShadow>
        <capsuleGeometry args={[0.105, 0.4, 6, 12]} />
        <meshStandardMaterial color={color} roughness={0.5} transparent={ghost} opacity={opacity} />
        <mesh position={[0, -0.3, 0.02]}><sphereGeometry args={[0.125, 12, 9]} /><meshStandardMaterial color={PALETTE.cream} roughness={0.6} transparent={ghost} opacity={opacity} /></mesh>
      </mesh>
      <mesh ref={rightArm} position={[0.46, 0.33, 0]} castShadow>
        <capsuleGeometry args={[0.105, 0.4, 6, 12]} />
        <meshStandardMaterial color={color} roughness={0.5} transparent={ghost} opacity={opacity} />
        <mesh position={[0, -0.3, 0.02]}><sphereGeometry args={[0.125, 12, 9]} /><meshStandardMaterial color={PALETTE.cream} roughness={0.6} transparent={ghost} opacity={opacity} /></mesh>
      </mesh>
      {([[-0.18, leftLeg], [0.18, rightLeg]] as const).map(([x, leg]) => (
        <mesh key={x} ref={leg} position={[x, -0.43, 0]} castShadow>
          <capsuleGeometry args={[0.12, 0.34, 6, 12]} />
          <meshStandardMaterial color={PALETTE.ink} roughness={0.62} transparent={ghost} opacity={opacity} />
          <mesh position={[0, -0.27, 0.1]} scale={[1.2, 0.7, 1.55]} castShadow>
            <sphereGeometry args={[0.14, 12, 9]} />
            <meshStandardMaterial color={PALETTE.cream} roughness={0.58} transparent={ghost} opacity={opacity} />
          </mesh>
        </mesh>
      ))}
    </group>
  );
}
