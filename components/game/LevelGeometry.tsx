"use client";

import { RoundedBox } from "@react-three/drei";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useMemo } from "react";
import { Color } from "three";
import { PALETTE } from "@/lib/game/constants";
import { LEVEL_PIECES, type LevelPiece } from "@/lib/game/level-definition";

const DECK_EDGE = 0.13;
const DECK_WASH = 0.62;

function SurfaceDetail({
  width,
  depth,
  tiled,
}: {
  width: number;
  depth: number;
  tiled: boolean;
}) {
  const lines = Array.from({ length: 7 }, (_, index) => index - 3);
  return (
    <group position={[0, 0.036, 0]}>
      {lines.map((index) => (
        <mesh
          key={index}
          position={
            tiled
              ? [(index * width) / 7, 0, 0]
              : [0, 0, (index * depth) / 7]
          }
        >
          <boxGeometry
            args={
              tiled
                ? [0.018, 0.008, depth * 0.9]
                : [width * 0.9, 0.008, 0.018]
            }
          />
          <meshBasicMaterial
            color={tiled ? "#c8c1af" : "#c89b68"}
            transparent
            opacity={0.55}
          />
        </mesh>
      ))}
    </group>
  );
}

/** The playable course only. Decorative side apartments obscured its shape. */
export function LevelGeometry({
  pieces = LEVEL_PIECES,
}: {
  pieces?: readonly LevelPiece[];
}) {
  const decks = useMemo(
    () =>
      pieces.map((piece) => {
        const width = Math.max(
          piece.size[0] - DECK_EDGE * 2,
          piece.size[0] * 0.5,
        );
        const depth = Math.max(
          piece.size[2] - DECK_EDGE * 2,
          piece.size[2] * 0.5,
        );
        const color = new Color(piece.color).lerp(
          new Color(PALETTE.cream),
          DECK_WASH,
        );
        return { width, depth, color: `#${color.getHexString()}` };
      }),
    [pieces],
  );

  return (
    <>
      {pieces.map((piece, index) => (
        <RigidBody
          key={piece.id}
          type="fixed"
          colliders={false}
          position={piece.center}
          rotation={[
            piece.rotationX ?? 0,
            piece.rotationY ?? 0,
            piece.rotationZ ?? 0,
          ]}
        >
          <CuboidCollider
            args={[piece.size[0] / 2, piece.size[1] / 2, piece.size[2] / 2]}
          />
          <RoundedBox
            args={[...piece.size]}
            radius={0.14}
            smoothness={3}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial
              color={piece.color}
              roughness={0.7}
              metalness={0.03}
            />
          </RoundedBox>
          <RoundedBox
            position={[0, -piece.size[1] / 2 - 0.08, 0]}
            args={[piece.size[0] * 0.92, 0.16, piece.size[2] * 0.92]}
            radius={0.08}
            smoothness={2}
            castShadow
          >
            <meshStandardMaterial color={PALETTE.ink} roughness={0.78} />
          </RoundedBox>
          <mesh
            position={[0, piece.size[1] / 2 + 0.02, 0]}
            receiveShadow
          >
            <boxGeometry
              args={[piece.size[0] * 0.995, 0.07, piece.size[2] * 0.995]}
            />
            <meshStandardMaterial color={PALETTE.ink} roughness={0.85} />
          </mesh>
          <mesh
            position={[0, piece.size[1] / 2 + 0.05, 0]}
            receiveShadow
          >
            <boxGeometry
              args={[decks[index]!.width, 0.05, decks[index]!.depth]}
            />
            <meshStandardMaterial color={decks[index]!.color} roughness={0.9} />
          </mesh>
          <group position={[0, piece.size[1] / 2 + 0.039, 0]}>
            <SurfaceDetail
              width={decks[index]!.width}
              depth={decks[index]!.depth}
              tiled={index % 2 === 0}
            />
          </group>
        </RigidBody>
      ))}
    </>
  );
}
