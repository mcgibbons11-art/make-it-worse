"use client";

import { RoundedBox } from "@react-three/drei";
import { useMemo } from "react";
import { ExtrudeGeometry, LatheGeometry, Path, Shape, Vector2 } from "three";
import { PALETTE } from "@/lib/game/constants";

const MINT = "#A8DCD9";
const MINT_DOOR = "#b9e6e3";
const MINT_GROOVE = "#6eafac";
const TRIM_CREAM = "#fff3cf";

const FRIDGE_FEET: readonly (readonly [number, number])[] = [
  [-0.52, -0.3],
  [0.52, -0.3],
  [-0.52, 0.3],
  [0.52, 0.3],
];
const FRIDGE_HANDLE_POST_Y: readonly number[] = [0.83, 1.49];

/**
 * Floor-centred retro fridge, 1.34 x 1.84 x 0.94, sized so every part sits
 * inside the rolling-fridge CuboidCollider args={[0.68, 0.92, 0.48]}. The door
 * faces +Z, which is the direction the trap charges.
 *
 * The door is built as three stacked slabs - body face, darker recess plate,
 * then a proud door panel - so the seam around the door is a real step rather
 * than a painted outline.
 */
export function ProceduralRefrigerator() {
  return (
    <group>
      {FRIDGE_FEET.map(([x, z]) => (
        <mesh key={`${x},${z}`} name="fridge-foot" position={[x, 0.055, z]} castShadow>
          <cylinderGeometry args={[0.075, 0.085, 0.11, 12]} />
          <meshStandardMaterial color={PALETTE.ink} roughness={0.85} />
        </mesh>
      ))}
      <RoundedBox
        name="fridge-plinth"
        args={[1.34, 0.3, 0.84]}
        radius={0.09}
        smoothness={3}
        position={[0, 0.19, -0.05]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={PALETTE.red} roughness={0.74} metalness={0.02} />
      </RoundedBox>
      <RoundedBox
        name="fridge-body"
        args={[1.28, 1.56, 0.74]}
        radius={0.16}
        smoothness={4}
        position={[0, 1.06, -0.1]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={MINT} roughness={0.82} metalness={0.02} />
      </RoundedBox>
      <RoundedBox
        name="fridge-door-recess"
        args={[1.25, 1.49, 0.06]}
        radius={0.025}
        smoothness={2}
        position={[0, 1.06, 0.26]}
        receiveShadow
      >
        <meshStandardMaterial color={MINT_GROOVE} roughness={0.88} />
      </RoundedBox>
      <RoundedBox
        name="fridge-door"
        args={[1.17, 1.41, 0.12]}
        radius={0.045}
        smoothness={3}
        position={[0, 1.06, 0.29]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={MINT_DOOR} roughness={0.8} metalness={0.02} />
      </RoundedBox>
      <RoundedBox
        name="fridge-badge"
        args={[0.32, 0.11, 0.06]}
        radius={0.025}
        smoothness={2}
        position={[-0.26, 1.63, 0.35]}
        castShadow
      >
        <meshStandardMaterial color={TRIM_CREAM} roughness={0.6} metalness={0.05} />
      </RoundedBox>
      {FRIDGE_HANDLE_POST_Y.map((y) => (
        <RoundedBox
          key={y}
          name="fridge-handle-post"
          args={[0.07, 0.11, 0.09]}
          radius={0.025}
          smoothness={2}
          position={[0.46, y, 0.375]}
          castShadow
        >
          <meshStandardMaterial color={TRIM_CREAM} roughness={0.55} metalness={0.05} />
        </RoundedBox>
      ))}
      <RoundedBox
        name="fridge-handle-bar"
        args={[0.09, 0.94, 0.11]}
        radius={0.035}
        smoothness={3}
        position={[0.46, 1.16, 0.415]}
        castShadow
      >
        <meshStandardMaterial color={TRIM_CREAM} roughness={0.5} metalness={0.05} />
      </RoundedBox>
    </group>
  );
}

/**
 * Revolved profile of the pedestal and bowl, as [radius, height] pairs. The
 * polyline climbs the outside, rolls over the rim at y=0.68, then drops back
 * down the inside so the rim reads as a thick lip rather than a paper edge.
 */
const BOWL_PROFILE: readonly (readonly [number, number])[] = [
  [0.0, 0.0],
  [0.3, 0.0],
  [0.32, 0.05],
  [0.29, 0.13],
  [0.23, 0.26],
  [0.21, 0.36],
  [0.25, 0.47],
  [0.33, 0.56],
  [0.39, 0.62],
  [0.4, 0.66],
  [0.36, 0.68],
  [0.29, 0.64],
  [0.24, 0.55],
  [0.14, 0.5],
  [0.0, 0.49],
];
const BOWL_SEGMENTS = 16;
const SEAT_OUTER = [0.36, 0.38] as const;
const SEAT_INNER = [0.22, 0.24] as const;
const SEAT_BEVEL = 0.025;
const TOILET_HINGE_X: readonly number[] = [-0.18, 0.18];

/**
 * Floor-centred cartoon toilet, 1.02 x 0.90 x 0.99, sized so every part sits
 * inside the rotating-toilet CuboidCollider args={[0.52, 0.45, 0.5]}. The
 * cistern is at -Z so the bowl faces +Z, matching the fridge convention.
 *
 * The lid stops 0.03 short of the cistern front instead of resting open,
 * because a raised lid would stand roughly 1.25 units tall and overhang the
 * collider that the trap sweeps with. The hinge pucks bridge that gap, and the
 * lid is inset from the seat so the purple ring stays visible all round.
 */
export function ProceduralToilet() {
  const bowlGeometry = useMemo(
    () =>
      new LatheGeometry(
        BOWL_PROFILE.map(([radius, height]) => new Vector2(radius, height)),
        BOWL_SEGMENTS,
      ),
    [],
  );
  const seatGeometry = useMemo(() => {
    const [outerX, outerZ] = SEAT_OUTER;
    const [innerX, innerZ] = SEAT_INNER;
    const outline = new Shape();
    outline.absellipse(0, 0, outerX, outerZ, 0, Math.PI * 2, false, 0);
    const hole = new Path();
    hole.absellipse(0, 0, innerX, innerZ, 0, Math.PI * 2, true, 0);
    outline.holes.push(hole);
    return new ExtrudeGeometry(outline, {
      depth: 0.05,
      curveSegments: 18,
      bevelEnabled: true,
      bevelThickness: 0.02,
      bevelSize: SEAT_BEVEL,
      bevelSegments: 2,
    });
  }, []);

  return (
    <group>
      <mesh
        name="toilet-bowl"
        geometry={bowlGeometry}
        position={[0, 0, 0.07]}
        scale={[1, 1, 1.05]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={PALETTE.cream} roughness={0.72} metalness={0.03} />
      </mesh>
      <RoundedBox
        name="toilet-cistern-neck"
        args={[0.52, 0.3, 0.26]}
        radius={0.08}
        smoothness={3}
        position={[0, 0.3, -0.28]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={PALETTE.cream} roughness={0.74} metalness={0.03} />
      </RoundedBox>
      <RoundedBox
        name="toilet-cistern"
        args={[0.86, 0.5, 0.3]}
        radius={0.09}
        smoothness={4}
        position={[0, 0.6, -0.33]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={PALETTE.cream} roughness={0.72} metalness={0.03} />
      </RoundedBox>
      <RoundedBox
        name="toilet-cistern-lid"
        args={[0.92, 0.09, 0.34]}
        radius={0.035}
        smoothness={3}
        position={[0, 0.855, -0.33]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={PALETTE.cream} roughness={0.68} metalness={0.03} />
      </RoundedBox>
      <mesh
        name="toilet-lever-mount"
        position={[0.44, 0.72, -0.33]}
        rotation={[0, 0, Math.PI / 2]}
        castShadow
      >
        <cylinderGeometry args={[0.05, 0.05, 0.06, 12]} />
        <meshStandardMaterial color={PALETTE.purple} roughness={0.68} metalness={0.04} />
      </mesh>
      <RoundedBox
        name="toilet-lever-arm"
        args={[0.06, 0.055, 0.2]}
        radius={0.022}
        smoothness={2}
        position={[0.48, 0.705, -0.26]}
        rotation={[0.18, 0, 0]}
        castShadow
      >
        <meshStandardMaterial color={PALETTE.purple} roughness={0.68} metalness={0.04} />
      </RoundedBox>
      <mesh
        name="toilet-seat"
        geometry={seatGeometry}
        position={[0, 0.635, 0.09]}
        rotation={[-Math.PI / 2, 0, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={PALETTE.purple} roughness={0.7} metalness={0.03} />
      </mesh>
      <RoundedBox
        name="toilet-lid"
        args={[0.62, 0.09, 0.56]}
        radius={0.035}
        smoothness={3}
        position={[0, 0.73, 0.13]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={PALETTE.cream} roughness={0.66} metalness={0.03} />
      </RoundedBox>
      {TOILET_HINGE_X.map((x) => (
        <mesh
          key={x}
          name="toilet-lid-hinge"
          position={[x, 0.73, -0.17]}
          rotation={[0, 0, Math.PI / 2]}
          castShadow
        >
          <cylinderGeometry args={[0.045, 0.045, 0.09, 12]} />
          <meshStandardMaterial color={PALETTE.purple} roughness={0.7} metalness={0.04} />
        </mesh>
      ))}
    </group>
  );
}
