"use client";

import { RoundedBox } from "@react-three/drei";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { LEVEL_PIECES } from "@/lib/game/level-definition";
import { PALETTE } from "@/lib/game/constants";

function SurfaceDetail({ width, depth, tiled }: { width: number; depth: number; tiled: boolean }) {
  const lines = Array.from({ length: 7 }, (_, index) => index - 3);
  return (
    <group position={[0, 0.036, 0]}>
      {lines.map((index) => (
        <mesh key={index} position={tiled ? [(index * width) / 7, 0, 0] : [0, 0, (index * depth) / 7]}>
          <boxGeometry args={tiled ? [0.018, 0.008, depth * 0.9] : [width * 0.9, 0.008, 0.018]} />
          <meshBasicMaterial color={tiled ? "#c8c1af" : "#c89b68"} transparent opacity={0.55} />
        </mesh>
      ))}
    </group>
  );
}

function PendantLight({ position, color }: { position: [number, number, number]; color: string }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.52, 0]} castShadow>
        <cylinderGeometry args={[0.025, 0.025, 1.04, 8]} />
        <meshStandardMaterial color={PALETTE.ink} roughness={0.65} />
      </mesh>
      <mesh rotation={[Math.PI, 0, 0]} castShadow>
        <coneGeometry args={[0.58, 0.62, 24, 1, true]} />
        <meshStandardMaterial color={color} roughness={0.42} metalness={0.08} side={2} />
      </mesh>
      <mesh position={[0, -0.17, 0]}>
        <sphereGeometry args={[0.18, 16, 12]} />
        <meshStandardMaterial color="#fff7c7" emissive="#ffd84d" emissiveIntensity={3.4} />
      </mesh>
      <pointLight position={[0, -0.2, 0]} color="#ffe5a5" intensity={5} distance={9} decay={2} />
    </group>
  );
}

function DecorativePlant({ position, flip = false }: { position: [number, number, number]; flip?: boolean }) {
  return (
    <group position={position} rotation={[0, flip ? -0.4 : 0.35, 0]}>
      <mesh castShadow position={[0, 0.35, 0]}>
        <cylinderGeometry args={[0.38, 0.28, 0.7, 16]} />
        <meshStandardMaterial color={flip ? PALETTE.red : PALETTE.orange} roughness={0.72} />
      </mesh>
      <mesh position={[0, 1.05, 0]} castShadow>
        <cylinderGeometry args={[0.055, 0.075, 1.2, 8]} />
        <meshStandardMaterial color="#25745d" roughness={0.9} />
      </mesh>
      {[-0.75, -0.25, 0.25, 0.75].map((angle, index) => (
        <mesh
          key={angle}
          position={[Math.sin(angle) * 0.34, 1.15 + index * 0.22, Math.cos(angle) * 0.26]}
          rotation={[angle * 0.28, 0, -angle]}
          castShadow
        >
          <sphereGeometry args={[0.2, 12, 8]} />
          <meshStandardMaterial color={index % 2 ? "#57dfa1" : "#36b985"} roughness={0.92} />
        </mesh>
      ))}
    </group>
  );
}

function ArchitecturalShell() {
  const rooms = [6, 15, 24, 33, 42];
  const wallColors = ["#ffd7cf", "#d8ceff", "#cceaff", "#fff0bb", "#d5f5e6"];
  return (
    <group>
      {rooms.map((z, roomIndex) => (
        <group key={z}>
          {[-1, 1].map((side) => (
            <group key={side} position={[side * 5.65, 1.75, z]}>
              <mesh castShadow receiveShadow>
                <boxGeometry args={[0.28, 5.1, 8.35]} />
                <meshStandardMaterial color={wallColors[roomIndex]!} roughness={0.9} />
              </mesh>
              <mesh position={[-side * 0.18, -1.65, 0]} castShadow>
                <boxGeometry args={[0.13, 0.34, 8.45]} />
                <meshStandardMaterial color={PALETTE.ink} roughness={0.72} />
              </mesh>
              {[-2.65, 0, 2.65].map((panelZ) => (
                <group key={panelZ} position={[-side * 0.19, 0.15, panelZ]}>
                  <mesh>
                    <boxGeometry args={[0.045, 1.65, 1.9]} />
                    <meshStandardMaterial color="#fff8e8" roughness={0.82} />
                  </mesh>
                  <mesh position={[-side * 0.035, 0, 0]}>
                    <boxGeometry args={[0.04, 1.25, 1.5]} />
                    <meshStandardMaterial color={wallColors[roomIndex]!} roughness={0.9} />
                  </mesh>
                </group>
              ))}
            </group>
          ))}
        </group>
      ))}
      {[10.5, 19.5, 28.5, 37.5].map((z, index) => (
        <group key={z} position={[0, 0, z]}>
          {[-4.55, 4.55].map((x) => (
            <RoundedBox key={x} position={[x, 2.1, 0]} args={[0.42, 4.25, 0.48]} radius={0.12} smoothness={3} castShadow>
              <meshStandardMaterial color={index % 2 ? PALETTE.purple : PALETTE.blue} roughness={0.65} />
            </RoundedBox>
          ))}
          <RoundedBox position={[0, 4.08, 0]} args={[9.5, 0.42, 0.48]} radius={0.12} smoothness={3} castShadow>
            <meshStandardMaterial color={index % 2 ? PALETTE.purple : PALETTE.blue} roughness={0.65} />
          </RoundedBox>
          {[-2.8, 2.8].map((x) => (
            <mesh key={x} position={[x, 4.02, 0.28]}>
              <sphereGeometry args={[0.12, 12, 8]} />
              <meshStandardMaterial color={PALETTE.yellow} emissive={PALETTE.yellow} emissiveIntensity={1.8} />
            </mesh>
          ))}
        </group>
      ))}
      <PendantLight position={[-3.8, 4.3, 7]} color={PALETTE.red} />
      <PendantLight position={[3.9, 4.4, 20]} color={PALETTE.blue} />
      <PendantLight position={[-3.9, 4.35, 33]} color={PALETTE.purple} />
      <DecorativePlant position={[-4.45, 0, 19.7]} />
      <DecorativePlant position={[4.4, 0, 34.7]} flip />
    </group>
  );
}

function ApartmentSetDressing() {
  return (
    <>
      <group position={[3.28, 1.25, 8.2]}>
        <mesh castShadow receiveShadow><boxGeometry args={[0.24, 3.1, 6.1]} /><meshStandardMaterial color="#ffb3a8" roughness={0.95} /></mesh>
        {[-2.1, -1.05, 0, 1.05, 2.1].map((z) => <mesh key={z} position={[-0.14, -0.15, z]}><boxGeometry args={[0.035, 0.045, 0.92]} /><meshStandardMaterial color="#fff3cf" /></mesh>)}
        <mesh position={[-0.18, -1.26, 0]}><boxGeometry args={[0.16, 0.28, 6.25]} /><meshStandardMaterial color={PALETTE.ink} roughness={0.9} /></mesh>
      </group>
      <group position={[-3.25, 1.05, 27]}>
        <mesh castShadow receiveShadow><boxGeometry args={[0.22, 2.8, 5.4]} /><meshStandardMaterial color="#b9a7ff" roughness={0.95} /></mesh>
        <mesh position={[0.16, -1.15, 0]}><boxGeometry args={[0.14, 0.25, 5.6]} /><meshStandardMaterial color={PALETTE.ink} /></mesh>
      </group>
      <mesh position={[0, 0.065, 3.25]} receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[5.1, 2.4]} />
        <meshStandardMaterial color="#ff7b6b" roughness={1} />
      </mesh>
      <mesh position={[0, 0.065, 8.25]} receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[4.7, 3.7]} />
        <meshStandardMaterial color="#73dff2" roughness={1} />
      </mesh>
      <group position={[-4.15, 0.7, 9]} rotation={[0, 0.08, 0]}>
        <mesh castShadow><boxGeometry args={[2.2, 1.4, 3.8]} /><meshStandardMaterial color="#f3c858" roughness={0.8} /></mesh>
        {[-0.7, 0, 0.7].map((z) => <mesh key={z} position={[1.11, 0, z]}><boxGeometry args={[0.05, 0.9, 0.55]} /><meshStandardMaterial color="#fff1cb" /></mesh>)}
        <mesh position={[0, 0.78, 0]}><boxGeometry args={[2.35, 0.16, 4]} /><meshStandardMaterial color="#f7eee0" roughness={0.45} /></mesh>
      </group>
      <group position={[4.4, 0.85, 25.5]} rotation={[0, -0.16, 0]}>
        <mesh castShadow><boxGeometry args={[2.5, 1.2, 4.1]} /><meshStandardMaterial color={PALETTE.purple} roughness={0.92} /></mesh>
        <mesh position={[-0.95, 0.85, 0]}><boxGeometry args={[0.45, 1.7, 4.2]} /><meshStandardMaterial color="#7054d8" /></mesh>
        <mesh position={[0, 0.73, 0]}><boxGeometry args={[2.3, 0.35, 3.7]} /><meshStandardMaterial color="#917cff" /></mesh>
      </group>
      <group position={[-4.7, 1.5, 38]}>
        <mesh castShadow><boxGeometry args={[3.1, 3, 0.6]} /><meshStandardMaterial color={PALETTE.blue} roughness={0.85} /></mesh>
        {[-0.8, 0, 0.8].map((x) => <mesh key={x} position={[x, 0.25, 0.34]}><boxGeometry args={[0.55, 1.8, 0.2]} /><meshStandardMaterial color={PALETTE.cream} /></mesh>)}
      </group>
      <group position={[4.7, 1.1, 47]}>
        <mesh position={[0, -0.9, 0]}><cylinderGeometry args={[0.12, 0.18, 1.8, 10]} /><meshStandardMaterial color={PALETTE.ink} /></mesh>
        <mesh><coneGeometry args={[0.9, 1.3, 14, 1, true]} /><meshStandardMaterial color={PALETTE.red} side={2} /></mesh>
        <pointLight color="#ffd84d" intensity={2.5} distance={8} />
      </group>
    </>
  );
}

export function LevelGeometry() {
  return (
    <>
      {LEVEL_PIECES.map((piece, index) => (
        <RigidBody key={piece.id} type="fixed" colliders={false} position={piece.center} rotation={[piece.rotationX ?? 0, 0, 0]}>
          <CuboidCollider args={[piece.size[0] / 2, piece.size[1] / 2, piece.size[2] / 2]} />
          <RoundedBox args={[...piece.size]} radius={0.14} smoothness={3} castShadow receiveShadow>
            <meshStandardMaterial color={piece.color} roughness={0.7} metalness={0.03} />
          </RoundedBox>
          <RoundedBox position={[0, -piece.size[1] / 2 - 0.08, 0]} args={[piece.size[0] * 0.92, 0.16, piece.size[2] * 0.92]} radius={0.08} smoothness={2} castShadow>
            <meshStandardMaterial color={PALETTE.ink} roughness={0.78} />
          </RoundedBox>
          <mesh position={[0, piece.size[1] / 2 + 0.025, 0]} receiveShadow>
            <boxGeometry args={[piece.size[0] * 0.94, 0.05, piece.size[2] * 0.94]} />
            <meshStandardMaterial color={index % 2 ? "#e9c18c" : PALETTE.cream} roughness={0.9} />
          </mesh>
          <group position={[0, piece.size[1] / 2 + 0.05, 0]}>
            <SurfaceDetail width={piece.size[0]} depth={piece.size[2]} tiled={index % 2 === 0} />
          </group>
        </RigidBody>
      ))}
      <ArchitecturalShell />
      <ApartmentSetDressing />
    </>
  );
}
