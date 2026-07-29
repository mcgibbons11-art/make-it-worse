"use client";

import { RoundedBox } from "@react-three/drei";
import { useCallback, type Ref } from "react";
import {
  DoubleSide,
  Matrix4,
  Shape,
  Vector2,
  type ExtrudeGeometryOptions,
  type Group,
  type InstancedMesh,
} from "three";
import { PALETTE } from "@/lib/game/constants";

/** The hammer handle is a warmer cream than the level trim, so it is local. */
const HANDLE_CREAM = "#fff3cf";

// ---------------------------------------------------------------------------
// Floor fan
// ---------------------------------------------------------------------------
// Origin is the floor centre. The fan faces +Z: the guard cage opens towards
// +Z and the motor body trails off behind it in -Z. Measured bounds are
// x [-0.54, 0.54], y [0, 1.29], z [-0.34, 0.33], so it sits inside the trap
// collider half-extents of [0.6, 0.65, 0.35].

/** Height of the blade hub above the floor. The guard cage is centred here. */
const FAN_HUB_Y = 0.79;
/** The pole meets the motor behind the cage plane rather than under it. */
const FAN_POLE_Z = -0.15;

// LatheGeometry derives its normals from the direction of travel along the
// profile, so both profiles below run "up" (bottom to top, then back to front)
// to keep the generated normals pointing outwards.

/**
 * The base is revolved, so it would otherwise be as deep as it is wide. The
 * collider only allows 0.35 of depth against 0.6 of width, so the disc is
 * flattened into an oval that uses the full width budget.
 */
const FAN_BASE_DEPTH_SCALE = 0.62;

/** Weighted base: flat underside, chunky rim, domed top. Revolved around Y. */
const FAN_BASE_PROFILE = [
  new Vector2(0, 0),
  new Vector2(0.5, 0),
  new Vector2(0.54, 0.04),
  new Vector2(0.54, 0.1),
  new Vector2(0.5, 0.145),
  new Vector2(0.42, 0.168),
  new Vector2(0.3, 0.176),
  new Vector2(0.16, 0.178),
  new Vector2(0.06, 0.178),
  new Vector2(0, 0.178),
];

/**
 * Motor housing plus the cone that flares out to the guard rim, as one closed
 * shell. Revolved around Y, then laid down so its lathe axis runs along Z and
 * the open mouth faces +Z.
 */
const FAN_BODY_PROFILE = [
  new Vector2(0, -0.34),
  new Vector2(0.12, -0.335),
  new Vector2(0.2, -0.315),
  new Vector2(0.26, -0.275),
  new Vector2(0.26, -0.16),
  new Vector2(0.3, -0.145),
  new Vector2(0.37, -0.06),
  new Vector2(0.44, 0.02),
  new Vector2(0.46, 0.06),
];

/** Concentric guard rings, stepped forward in Z so the cage domes outwards. */
const FAN_GUARD_RINGS = [
  { key: "Rim", radius: 0.455, tube: 0.045, segments: 24, z: 0.055 },
  { key: "Outer", radius: 0.335, tube: 0.032, segments: 22, z: 0.115 },
  { key: "Inner", radius: 0.215, tube: 0.03, segments: 18, z: 0.155 },
  { key: "Core", radius: 0.095, tube: 0.028, segments: 14, z: 0.18 },
];

const FAN_SPOKE_COUNT = 8;
/** Radius and Z of each spoke's midpoint, so it bridges hub cap to rim ring. */
const FAN_SPOKE_RADIUS = 0.2675;
const FAN_SPOKE_Z = 0.1175;
/** Lean that follows the cage dome, from the hub at z=0.185 to the rim at 0.05. */
const FAN_SPOKE_TILT = -0.3294;
const FAN_SPOKE_LENGTH = 0.46;

const FAN_BLADE_COUNT = 3;
/** Sunk slightly behind the cage centre to balance clearance front and back. */
const FAN_BLADE_Z = -0.02;
/** Pitch of each blade about its own radial axis, so the fan looks like it bites. */
const FAN_BLADE_PITCH = 0.45;
/** ExtrudeGeometry grows along +Z from the shape plane; pull it back to centre. */
const FAN_BLADE_Z_OFFSET = -0.0175;

const FAN_BLADE_EXTRUDE: ExtrudeGeometryOptions = {
  depth: 0.035,
  bevelEnabled: true,
  bevelThickness: 0.012,
  bevelSize: 0.012,
  bevelSegments: 2,
  curveSegments: 5,
  steps: 1,
};

/** One blade, drawn in the XY plane growing along +Y away from the hub. */
function createFanBladeShape(): Shape {
  const blade = new Shape();
  blade.moveTo(-0.052, 0.055);
  blade.quadraticCurveTo(-0.15, 0.15, -0.12, 0.265);
  blade.quadraticCurveTo(-0.015, 0.325, 0.098, 0.268);
  blade.quadraticCurveTo(0.145, 0.15, 0.058, 0.055);
  blade.quadraticCurveTo(0.003, 0.03, -0.052, 0.055);
  return blade;
}

const FAN_BLADE_SHAPE = createFanBladeShape();

interface ProceduralFloorFanProps {
  /**
   * Optional handle on the spinning blade group. The same group is also named
   * "blades" and is the first child of the root group, so callers that walk the
   * scene graph can find it without threading a ref.
   */
  bladesRef?: Ref<Group> | undefined;
}

export function ProceduralFloorFan({ bladesRef = null }: ProceduralFloorFanProps) {
  const setSpokes = useCallback((spokes: InstancedMesh | null) => {
    if (!spokes) return;
    const matrix = new Matrix4();
    const spin = new Matrix4();
    for (let index = 0; index < FAN_SPOKE_COUNT; index += 1) {
      const angle = (index * Math.PI * 2) / FAN_SPOKE_COUNT;
      matrix.makeRotationX(FAN_SPOKE_TILT);
      matrix.premultiply(spin.makeRotationZ(angle));
      matrix.setPosition(
        -Math.sin(angle) * FAN_SPOKE_RADIUS,
        Math.cos(angle) * FAN_SPOKE_RADIUS,
        FAN_SPOKE_Z,
      );
      spokes.setMatrixAt(index, matrix);
    }
    spokes.instanceMatrix.needsUpdate = true;
  }, []);

  return (
    <group name="proceduralFloorFan">
      {/* Spun on its own Z axis by the caller, so it stays a standalone group. */}
      <group ref={bladesRef} name="blades" position={[0, FAN_HUB_Y, FAN_BLADE_Z]}>
        <mesh name="fanBladeHub" castShadow scale={[1, 1, 1.2]}>
          <sphereGeometry args={[0.105, 14, 10]} />
          <meshStandardMaterial color={PALETTE.red} roughness={0.75} metalness={0.02} />
        </mesh>
        <mesh
          name="fanBladeHubCap"
          castShadow
          position={[0, 0, 0.105]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <cylinderGeometry args={[0.048, 0.055, 0.07, 12]} />
          <meshStandardMaterial color={PALETTE.yellow} roughness={0.72} metalness={0.02} />
        </mesh>
        {Array.from({ length: FAN_BLADE_COUNT }, (_, index) => (
          <group key={index} rotation={[0, 0, (index * Math.PI * 2) / FAN_BLADE_COUNT]}>
            <mesh
              name={`fanBlade${index}`}
              castShadow
              rotation={[0, FAN_BLADE_PITCH, 0]}
              position={[0, 0, FAN_BLADE_Z_OFFSET]}
            >
              <extrudeGeometry args={[FAN_BLADE_SHAPE, FAN_BLADE_EXTRUDE]} />
              <meshStandardMaterial color={PALETTE.yellow} roughness={0.74} metalness={0.03} />
            </mesh>
          </group>
        ))}
      </group>

      {/* Squashed in Z so the wide base still fits the trap collider's depth. */}
      <mesh name="fanBase" castShadow receiveShadow scale={[1, 1, FAN_BASE_DEPTH_SCALE]}>
        <latheGeometry args={[FAN_BASE_PROFILE, 20]} />
        <meshStandardMaterial color={PALETTE.red} roughness={0.8} metalness={0.02} />
      </mesh>
      <mesh name="fanPole" castShadow position={[0, 0.38, FAN_POLE_Z]}>
        <cylinderGeometry args={[0.085, 0.1, 0.5, 14]} />
        <meshStandardMaterial color={PALETTE.cream} roughness={0.82} metalness={0.02} />
      </mesh>
      <mesh
        name="fanPoleCollar"
        castShadow
        position={[0, 0.215, FAN_POLE_Z]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <torusGeometry args={[0.135, 0.045, 8, 16]} />
        <meshStandardMaterial color={PALETTE.cream} roughness={0.82} metalness={0.02} />
      </mesh>

      <mesh
        name="fanBody"
        castShadow
        receiveShadow
        position={[0, FAN_HUB_Y, 0]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <latheGeometry args={[FAN_BODY_PROFILE, 20]} />
        {/* The cone's mouth is open, so its inner wall has to render too. */}
        <meshStandardMaterial
          color={PALETTE.red}
          roughness={0.78}
          metalness={0.03}
          side={DoubleSide}
        />
      </mesh>
      {/* Seals the open cone behind the blades so the body never reads hollow. */}
      <mesh
        name="fanMotorFace"
        position={[0, FAN_HUB_Y, -0.2]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <cylinderGeometry args={[0.265, 0.265, 0.06, 18]} />
        <meshStandardMaterial color={PALETTE.red} roughness={0.82} metalness={0.02} />
      </mesh>
      <mesh
        name="fanMotorShaft"
        position={[0, FAN_HUB_Y, -0.14]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <cylinderGeometry args={[0.055, 0.055, 0.14, 10]} />
        <meshStandardMaterial color={PALETTE.cream} roughness={0.7} metalness={0.05} />
      </mesh>
      <mesh name="fanControlKnob" castShadow position={[0, FAN_HUB_Y + 0.29, -0.24]}>
        <cylinderGeometry args={[0.05, 0.055, 0.12, 12]} />
        <meshStandardMaterial color={PALETTE.yellow} roughness={0.74} metalness={0.02} />
      </mesh>

      {FAN_GUARD_RINGS.map((ring) => (
        <mesh
          key={ring.key}
          name={`fanGuardRing${ring.key}`}
          castShadow
          position={[0, FAN_HUB_Y, ring.z]}
        >
          <torusGeometry args={[ring.radius, ring.tube, 8, ring.segments]} />
          <meshStandardMaterial color={PALETTE.cream} roughness={0.8} metalness={0.02} />
        </mesh>
      ))}
      <instancedMesh
        name="fanGuardSpokes"
        ref={setSpokes}
        castShadow
        args={[undefined, undefined, FAN_SPOKE_COUNT]}
        position={[0, FAN_HUB_Y, 0]}
      >
        <cylinderGeometry args={[0.021, 0.021, FAN_SPOKE_LENGTH, 6]} />
        <meshStandardMaterial color={PALETTE.cream} roughness={0.8} metalness={0.02} />
      </instancedMesh>
      <mesh
        name="fanGuardHubCap"
        castShadow
        position={[0, FAN_HUB_Y, 0.175]}
        scale={[1, 1, 0.8]}
      >
        <sphereGeometry args={[0.085, 12, 8]} />
        <meshStandardMaterial color={PALETTE.cream} roughness={0.8} metalness={0.02} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Hammer
// ---------------------------------------------------------------------------
// Origin is the butt of the handle so the prop can hang off a swing pivot.
// THE HEAD EXTENDS ALONG +Y: the handle runs from y=0 up to y=1.72 and the head
// is centred at y=1.93, giving an overall length of 2.20 along +Y. The striking
// faces point along +/-X and the head is 0.54 deep in Z.

const HAMMER_HEAD_Y = 1.93;
/** Half the head's length in X; the striking domes sit just inside this. */
const HAMMER_HEAD_HALF_LENGTH = 0.51;
const HAMMER_STRIKE_FACE_X = 0.49;

const HAMMER_GRIP_BAND_COUNT = 4;
const HAMMER_GRIP_BAND_BASE_Y = 0.26;
const HAMMER_GRIP_BAND_SPACING = 0.18;

export function ProceduralHammer() {
  const setGripBands = useCallback((bands: InstancedMesh | null) => {
    if (!bands) return;
    const matrix = new Matrix4();
    for (let index = 0; index < HAMMER_GRIP_BAND_COUNT; index += 1) {
      // A torus lies in XY, so tip it into XZ to wrap the Y-aligned handle.
      matrix.makeRotationX(Math.PI / 2);
      matrix.setPosition(
        0,
        HAMMER_GRIP_BAND_BASE_Y + index * HAMMER_GRIP_BAND_SPACING,
        0,
      );
      bands.setMatrixAt(index, matrix);
    }
    bands.instanceMatrix.needsUpdate = true;
  }, []);

  return (
    <group name="proceduralHammer">
      <mesh name="hammerEndCap" castShadow position={[0, 0.105, 0]} scale={[1, 0.85, 1]}>
        <sphereGeometry args={[0.12, 14, 10]} />
        <meshStandardMaterial color={PALETTE.yellow} roughness={0.76} metalness={0.02} />
      </mesh>
      <mesh name="hammerHandle" castShadow position={[0, 0.89, 0]}>
        <cylinderGeometry args={[0.112, 0.085, 1.66, 14]} />
        <meshStandardMaterial color={HANDLE_CREAM} roughness={0.84} metalness={0} />
      </mesh>
      <instancedMesh
        name="hammerGripBands"
        ref={setGripBands}
        castShadow
        args={[undefined, undefined, HAMMER_GRIP_BAND_COUNT]}
      >
        <torusGeometry args={[0.096, 0.03, 8, 16]} />
        <meshStandardMaterial color={PALETTE.yellow} roughness={0.72} metalness={0.02} />
      </instancedMesh>
      {/* Flared collar that hides the handle-to-head joint. */}
      <mesh name="hammerFerrule" castShadow position={[0, 1.62, 0]}>
        <cylinderGeometry args={[0.155, 0.135, 0.17, 14]} />
        <meshStandardMaterial color={PALETTE.yellow} roughness={0.74} metalness={0.03} />
      </mesh>
      <RoundedBox
        name="hammerHead"
        castShadow
        receiveShadow
        args={[HAMMER_HEAD_HALF_LENGTH * 2, 0.54, 0.54]}
        radius={0.12}
        smoothness={3}
        position={[0, HAMMER_HEAD_Y, 0]}
      >
        <meshStandardMaterial color={PALETTE.red} roughness={0.78} metalness={0.04} />
      </RoundedBox>
      {/* Squashed spheres crown each face. Kept narrow enough that the widest
          ring stays buried inside the head's bevel instead of flanging out. */}
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          name={side < 0 ? "hammerStrikeFaceLeft" : "hammerStrikeFaceRight"}
          castShadow
          position={[side * HAMMER_STRIKE_FACE_X, HAMMER_HEAD_Y, 0]}
          scale={[0.3, 1, 1]}
        >
          <sphereGeometry args={[0.2, 16, 10]} />
          <meshStandardMaterial color={PALETTE.red} roughness={0.72} metalness={0.05} />
        </mesh>
      ))}
    </group>
  );
}
