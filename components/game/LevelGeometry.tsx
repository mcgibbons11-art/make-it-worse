"use client";

import { RoundedBox } from "@react-three/drei";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useMemo } from "react";
import { Color } from "three";
import { LEVEL_PIECES } from "@/lib/game/level-definition";
import type { LevelPiece } from "@/lib/game/level-definition";
import { PALETTE } from "@/lib/game/constants";
import { ApartmentRooms } from "./environment/ApartmentRooms";

// A deck against the void measures 1.18:1 - the void is the sky sphere's lower
// stop, a near-white #c7ebff, so a platform edge was white on white and judging
// a gap meant guessing. Ink against that same sky is 13.7:1. Leaving a band of
// the dark plinth colour exposed around every deck is what turns an edge into
// something a player can actually see. Held in world units rather than as a
// fraction so a 1.2u plank gets the same readable band as a 3u bridge.
const DECK_EDGE = 0.13;
// How far the walking surface is pulled toward cream. The cap used to be a flat
// cream/tan alternation keyed on the piece's index in the array, which painted
// over every piece's own colour for no semantic gain: the chase camera looks
// down at tops, so the whole segment palette reached the player through a
// 3%-of-width rim, 0.036u of it on the beam plank. Washing the piece colour
// instead keeps the surface light enough to read a runner against while letting
// the hue say which segment you are on.
const DECK_WASH = 0.62;

// The corridor the course runs down, measured from the centre line to where the
// sculpted rooms open onto it. The widest floor authored anywhere is 7.2u across
// and LANE_X_LIMIT lets a course wander 2.2u off centre, so 4.25 is the closest
// a room can stand without a player mistaking its floor for somewhere to land.
const CORRIDOR_HALF_WIDTH = 4.25;
/** Half the sculpted room's floor tray, measured off its Box3. */
const ROOM_HALF_WIDTH = 2.155;
// The rooms' own back wall is 0.16 thick and sits on the far side of the room,
// so the corridor's back plane is flush with it and the two read as one wall.
const BACK_WALL_X = CORRIDOR_HALF_WIDTH + ROOM_HALF_WIDTH + 2.08;
const PORTAL_HALF_SPAN = 4.05;
const PORTAL_SPACING = 9;

/** Evenly spaced marks from `start` that stop short of the course's far end. */
function spanPositions(start: number, spacing: number, length: number): number[] {
  const marks: number[] = [];
  for (let z = start; z < length - 1; z += spacing) marks.push(z);
  return marks;
}

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

function ArchitecturalShell({ courseLength }: { courseLength: number }) {
  return (
    <group>
      {/* The wall the rooms are cut into. It used to be five free-standing cream
          slabs per side with three embossed rectangles on each, which is what
          read as plain: a corridor of blank panels with nothing behind them.
          Now it is the back plane of a real apartment, and the sculpted rooms
          below stand in front of it. */}
      {[-1, 1].map((side) => (
        <group key={side} position={[side * BACK_WALL_X, 1.4, courseLength / 2]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[0.3, 3.1, courseLength + 8]} />
            <meshStandardMaterial color="#f3e5d2" roughness={0.92} />
          </mesh>
          <mesh position={[-side * 0.2, -1.28, 0]} castShadow>
            <boxGeometry args={[0.14, 0.55, courseLength + 8]} />
            <meshStandardMaterial color={PALETTE.ink} roughness={0.8} />
          </mesh>
          {/* Picture rail. A single continuous line at eye height is what stops
              a long wall reading as an untextured plane. */}
          <mesh position={[-side * 0.17, 1.05, 0]}>
            <boxGeometry args={[0.09, 0.11, courseLength + 8]} />
            <meshStandardMaterial color="#d8c8ae" roughness={0.85} />
          </mesh>
        </group>
      ))}
      {/* Doorway frames every PORTAL_SPACING. These used to be four hardcoded
          positions sized for the 41u classic course, so a composed track ran
          past the last one into bare corridor. */}
      {spanPositions(10.5, PORTAL_SPACING, courseLength).map((z, index) => (
        <group key={z} position={[0, 0, z]}>
          {[-PORTAL_HALF_SPAN, PORTAL_HALF_SPAN].map((x) => (
            <RoundedBox key={x} position={[x, 2.1, 0]} args={[0.42, 4.25, 0.48]} radius={0.12} smoothness={3} castShadow>
              <meshStandardMaterial color={index % 2 ? PALETTE.purple : PALETTE.blue} roughness={0.65} />
            </RoundedBox>
          ))}
          <RoundedBox position={[0, 4.08, 0]} args={[PORTAL_HALF_SPAN * 2 + 0.4, 0.42, 0.48]} radius={0.12} smoothness={3} castShadow>
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
      {spanPositions(7, 13, courseLength).map((z, index) => (
        <PendantLight
          key={z}
          position={[index % 2 ? 3.9 : -3.85, 4.32, z]}
          color={[PALETTE.red, PALETTE.blue, PALETTE.purple][index % 3]!}
        />
      ))}
      {spanPositions(19.7, 15, courseLength).map((z, index) => (
        <DecorativePlant key={z} position={[index % 2 ? 4.05 : -4.05, 0, z]} flip={index % 2 === 1} />
      ))}
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
      {/* A kitchen counter, a bed, a bookshelf and a standing lamp used to sit
          here as blocked-in stand-ins for furniture. They spanned x -5.25 to
          5.6, which is inside the sculpted rooms now standing at 4.25, and the
          rooms carry real furniture, so what is left in the corridor band is the
          things a hallway actually has. */}
      <group position={[3.55, 1.1, 47]}>
        <mesh position={[0, -0.9, 0]}><cylinderGeometry args={[0.12, 0.18, 1.8, 10]} /><meshStandardMaterial color={PALETTE.ink} /></mesh>
        <mesh><coneGeometry args={[0.9, 1.3, 14, 1, true]} /><meshStandardMaterial color={PALETTE.red} side={2} /></mesh>
        <pointLight color="#ffd84d" intensity={2.5} distance={8} />
      </group>
    </>
  );
}

export function LevelGeometry({
  pieces = LEVEL_PIECES,
}: {
  pieces?: readonly LevelPiece[];
}) {
  const decks = useMemo(
    () =>
      pieces.map((piece) => {
        // A deck never narrows past half the piece, so a hypothetical plank
        // thinner than two bands still reads as a surface rather than as solid
        // ink.
        const width = Math.max(piece.size[0] - DECK_EDGE * 2, piece.size[0] * 0.5);
        const depth = Math.max(piece.size[2] - DECK_EDGE * 2, piece.size[2] * 0.5);
        const color = new Color(piece.color).lerp(new Color(PALETTE.cream), DECK_WASH);
        return { width, depth, color: `#${color.getHexString()}` };
      }),
    [pieces],
  );
  // The shell used to be authored for the 41u classic course alone, so a
  // composed track ran off the end of its walls, its doorframes and its lights.
  const courseLength = useMemo(
    () => pieces.reduce((far, piece) => Math.max(far, piece.center[2] + piece.size[2] / 2), 0),
    [pieces],
  );
  // The course's own identity, hashed from the pieces that define it. The rooms
  // use it to decide which two furniture sets stand on which side, so two tracks
  // do not open onto the same pairing. Derived rather than threaded through the
  // scene because the piece list already IS what makes one course different from
  // another, and a new prop through GameScene would say nothing extra.
  const courseSeed = useMemo(
    () =>
      pieces.reduce((hash, piece) => {
        let value = hash;
        for (const part of `${piece.id}:${piece.center.join()}:${piece.size.join()}`)
          value = Math.imul(value ^ part.charCodeAt(0), 16777619);
        return value >>> 0;
      }, 2166136261),
    [pieces],
  );
  return (
    <>
      {pieces.map((piece, index) => (
        <RigidBody key={piece.id} type="fixed" colliders={false} position={piece.center} rotation={[piece.rotationX ?? 0, 0, 0]}>
          <CuboidCollider args={[piece.size[0] / 2, piece.size[1] / 2, piece.size[2] / 2]} />
          <RoundedBox args={[...piece.size]} radius={0.14} smoothness={3} castShadow receiveShadow>
            <meshStandardMaterial color={piece.color} roughness={0.7} metalness={0.03} />
          </RoundedBox>
          <RoundedBox position={[0, -piece.size[1] / 2 - 0.08, 0]} args={[piece.size[0] * 0.92, 0.16, piece.size[2] * 0.92]} radius={0.08} smoothness={2} castShadow>
            <meshStandardMaterial color={PALETTE.ink} roughness={0.78} />
          </RoundedBox>
          {/* Sunk a little into the piece so the band reads as the platform's
              own lip rather than as a plate hovering over it. */}
          <mesh position={[0, piece.size[1] / 2 + 0.02, 0]} receiveShadow>
            <boxGeometry args={[piece.size[0] * 0.995, 0.07, piece.size[2] * 0.995]} />
            <meshStandardMaterial color={PALETTE.ink} roughness={0.85} />
          </mesh>
          <mesh position={[0, piece.size[1] / 2 + 0.05, 0]} receiveShadow>
            <boxGeometry args={[decks[index]!.width, 0.05, decks[index]!.depth]} />
            <meshStandardMaterial color={decks[index]!.color} roughness={0.9} />
          </mesh>
          <group position={[0, piece.size[1] / 2 + 0.039, 0]}>
            <SurfaceDetail width={decks[index]!.width} depth={decks[index]!.depth} tiled={index % 2 === 0} />
          </group>
        </RigidBody>
      ))}
      <ArchitecturalShell courseLength={courseLength} />
      <ApartmentRooms
        courseLength={courseLength}
        corridorHalfWidth={CORRIDOR_HALF_WIDTH}
        courseSeed={courseSeed}
      />
      <ApartmentSetDressing />
    </>
  );
}
