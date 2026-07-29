"use client";

import { RoundedBox } from "@react-three/drei";
import { useMemo } from "react";
import { CatmullRomCurve3, Shape, Vector3 } from "three";
import { PALETTE } from "@/lib/game/constants";

const MATTE_PLASTIC = { roughness: 0.82, metalness: 0.02 } as const;
const GLOSSY_PLASTIC = { roughness: 0.55, metalness: 0.04 } as const;

const DISH_COLOR = "#73dff2";
const PAD_DARK = "#24324a";

const DISH_WIDTH = 0.7;
const DISH_DEPTH = 0.44;
const DISH_FLOOR_HEIGHT = 0.1;
const RIM_THICKNESS = 0.08;
const RIM_HEIGHT = 0.18;
const RIM_CENTER_Y = 0.14;
const RIM_INSET_X = DISH_WIDTH / 2 - RIM_THICKNESS / 2;
const RIM_INSET_Z = DISH_DEPTH / 2 - RIM_THICKNESS / 2;
const DUCK_PERCH_X = RIM_INSET_X;

export function ProceduralSoapDish() {
  return (
    <group name="procedural-soap-dish">
      <RoundedBox
        name="soap-dish-floor"
        args={[DISH_WIDTH, DISH_FLOOR_HEIGHT, DISH_DEPTH]}
        radius={0.04}
        smoothness={3}
        bevelSegments={2}
        position={[0, DISH_FLOOR_HEIGHT / 2, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={DISH_COLOR} {...MATTE_PLASTIC} />
      </RoundedBox>
      <RoundedBox
        name="soap-dish-rim-front"
        args={[DISH_WIDTH, RIM_HEIGHT, RIM_THICKNESS]}
        radius={0.03}
        smoothness={3}
        bevelSegments={2}
        position={[0, RIM_CENTER_Y, RIM_INSET_Z]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={DISH_COLOR} {...MATTE_PLASTIC} />
      </RoundedBox>
      <RoundedBox
        name="soap-dish-rim-back"
        args={[DISH_WIDTH, RIM_HEIGHT, RIM_THICKNESS]}
        radius={0.03}
        smoothness={3}
        bevelSegments={2}
        position={[0, RIM_CENTER_Y, -RIM_INSET_Z]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={DISH_COLOR} {...MATTE_PLASTIC} />
      </RoundedBox>
      <RoundedBox
        name="soap-dish-rim-right"
        args={[RIM_THICKNESS, RIM_HEIGHT, DISH_DEPTH]}
        radius={0.03}
        smoothness={3}
        bevelSegments={2}
        position={[RIM_INSET_X, RIM_CENTER_Y, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={DISH_COLOR} {...MATTE_PLASTIC} />
      </RoundedBox>
      <RoundedBox
        name="soap-dish-rim-left"
        args={[RIM_THICKNESS, RIM_HEIGHT, DISH_DEPTH]}
        radius={0.03}
        smoothness={3}
        bevelSegments={2}
        position={[-RIM_INSET_X, RIM_CENTER_Y, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={DISH_COLOR} {...MATTE_PLASTIC} />
      </RoundedBox>
      <RoundedBox
        name="soap-bar"
        args={[0.34, 0.12, 0.2]}
        radius={0.045}
        smoothness={3}
        bevelSegments={2}
        position={[-0.05, 0.14, 0]}
        rotation={[0, 0.18, 0]}
        castShadow
      >
        <meshStandardMaterial color={PALETTE.cream} roughness={0.6} metalness={0.02} />
      </RoundedBox>
      <mesh
        name="duck-body"
        position={[DUCK_PERCH_X, 0.3, 0]}
        scale={[1, 0.92, 1.05]}
        castShadow
      >
        <sphereGeometry args={[0.1, 16, 12]} />
        <meshStandardMaterial color={PALETTE.yellow} {...MATTE_PLASTIC} />
      </mesh>
      <mesh
        name="duck-tail"
        position={[DUCK_PERCH_X - 0.059, 0.347, 0]}
        rotation={[0, 0, 0.9]}
        castShadow
      >
        <coneGeometry args={[0.055, 0.11, 10]} />
        <meshStandardMaterial color={PALETTE.yellow} {...MATTE_PLASTIC} />
      </mesh>
      <mesh name="duck-head" position={[DUCK_PERCH_X + 0.065, 0.415, 0]} castShadow>
        <sphereGeometry args={[0.066, 14, 10]} />
        <meshStandardMaterial color={PALETTE.yellow} {...MATTE_PLASTIC} />
      </mesh>
      <mesh
        name="duck-beak"
        position={[DUCK_PERCH_X + 0.119, 0.407, 0]}
        rotation={[0, 0, -1.71]}
        castShadow
      >
        <coneGeometry args={[0.03, 0.075, 8]} />
        <meshStandardMaterial color={PALETTE.red} {...MATTE_PLASTIC} />
      </mesh>
      <mesh name="duck-eye-left" position={[DUCK_PERCH_X + 0.098, 0.44, 0.042]}>
        <sphereGeometry args={[0.017, 8, 6]} />
        <meshStandardMaterial color={PALETTE.ink} roughness={0.4} metalness={0.05} />
      </mesh>
      <mesh name="duck-eye-right" position={[DUCK_PERCH_X + 0.098, 0.44, -0.042]}>
        <sphereGeometry args={[0.017, 8, 6]} />
        <meshStandardMaterial color={PALETTE.ink} roughness={0.4} metalness={0.05} />
      </mesh>
    </group>
  );
}

const PAD_BASE_HEIGHT = 0.1;
const PAD_RING_RADIUS = 0.79;
const PAD_RING_TUBE = 0.06;
const SPRING_RADIUS = 0.52;
const SPRING_TUBE_RADIUS = 0.035;
const SPRING_BOTTOM_Y = 0.01;
const SPRING_TOP_Y = 0.19;
const SPRING_COILS = 2;
const SPRING_SAMPLES_PER_COIL = 12;
const PAD_TOP_CENTER_Y = 0.2375;
const PAD_TOP_HEIGHT = 0.125;
const PAD_TOP_SURFACE_Y = PAD_TOP_CENTER_Y + PAD_TOP_HEIGHT / 2;
const CHEVRON_RADIUS = 0.46;
const CHEVRON_TILT = 0.25;
const CHEVRON_EXTRUDE = {
  depth: 0.035,
  bevelEnabled: true,
  bevelSize: 0.006,
  bevelThickness: 0.006,
  bevelSegments: 2,
};
const CHEVRON_ANGLES = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];

export function ProceduralJumpPad() {
  const springCurve = useMemo(() => {
    const segments = SPRING_COILS * SPRING_SAMPLES_PER_COIL;
    const points: Vector3[] = [];
    for (let index = 0; index <= segments; index += 1) {
      const t = index / segments;
      const angle = t * SPRING_COILS * Math.PI * 2;
      points.push(
        new Vector3(
          Math.cos(angle) * SPRING_RADIUS,
          SPRING_BOTTOM_Y + t * (SPRING_TOP_Y - SPRING_BOTTOM_Y),
          Math.sin(angle) * SPRING_RADIUS,
        ),
      );
    }
    return new CatmullRomCurve3(points);
  }, []);

  const chevron = useMemo(() => {
    const shape = new Shape();
    shape.moveTo(0, 0.085);
    shape.lineTo(0.08, 0.005);
    shape.lineTo(0.08, -0.045);
    shape.lineTo(0, 0.035);
    shape.lineTo(-0.08, -0.045);
    shape.lineTo(-0.08, 0.005);
    shape.closePath();
    return shape;
  }, []);

  return (
    <group name="procedural-jump-pad">
      <mesh name="jump-pad-base" position={[0, PAD_BASE_HEIGHT / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.74, 0.84, PAD_BASE_HEIGHT, 20]} />
        <meshStandardMaterial color={PAD_DARK} {...MATTE_PLASTIC} />
      </mesh>
      <mesh
        name="jump-pad-base-ring"
        position={[0, 0.09, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        castShadow
        receiveShadow
      >
        <torusGeometry args={[PAD_RING_RADIUS, PAD_RING_TUBE, 8, 24]} />
        <meshStandardMaterial color={PAD_DARK} {...MATTE_PLASTIC} />
      </mesh>
      <group name="padTop" position={[0, PAD_BASE_HEIGHT, 0]}>
        <mesh name="jump-pad-spring" castShadow>
          <tubeGeometry args={[springCurve, 72, SPRING_TUBE_RADIUS, 8, false]} />
          <meshStandardMaterial color={PALETTE.cream} roughness={0.62} metalness={0.05} />
        </mesh>
        <mesh name="jump-pad-top-disc" position={[0, PAD_TOP_CENTER_Y, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.68, 0.62, PAD_TOP_HEIGHT, 20]} />
          <meshStandardMaterial
            color={PALETTE.green}
            emissive={PALETTE.green}
            emissiveIntensity={0.5}
            {...GLOSSY_PLASTIC}
          />
        </mesh>
        <mesh
          name="jump-pad-top-lip"
          position={[0, PAD_TOP_SURFACE_Y - 0.015, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          castShadow
        >
          <torusGeometry args={[0.655, 0.045, 8, 24]} />
          <meshStandardMaterial color={PAD_DARK} {...MATTE_PLASTIC} />
        </mesh>
        {CHEVRON_ANGLES.map((angle, index) => (
          <group key={angle} rotation={[0, angle, 0]}>
            <mesh
              name={`jump-pad-chevron-${index}`}
              position={[0, PAD_TOP_SURFACE_Y - 0.025, -CHEVRON_RADIUS]}
              rotation={[-Math.PI / 2 + CHEVRON_TILT, 0, 0]}
              castShadow
            >
              <extrudeGeometry args={[chevron, CHEVRON_EXTRUDE]} />
              <meshStandardMaterial color={PALETTE.yellow} {...MATTE_PLASTIC} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

const BALL_RADIUS = 0.75;
const BALL_CAP_RADIUS = BALL_RADIUS + 0.006;
const BALL_CAP_THETA = 0.24;
const GORE_THETA_START = 0.2;
const GORE_COLORS = [
  PALETTE.red,
  PALETTE.cream,
  PALETTE.blue,
  PALETTE.green,
  PALETTE.red,
  PALETTE.cream,
  PALETTE.blue,
  PALETTE.green,
];
const GORE_PHI_LENGTH = (Math.PI * 2) / GORE_COLORS.length;

export function ProceduralBeachBall() {
  return (
    <group name="procedural-beach-ball">
      {GORE_COLORS.map((color, index) => (
        <mesh key={index} name={`beach-ball-gore-${index}`} castShadow receiveShadow>
          <sphereGeometry
            args={[
              BALL_RADIUS,
              3,
              12,
              index * GORE_PHI_LENGTH,
              GORE_PHI_LENGTH,
              GORE_THETA_START,
              Math.PI - GORE_THETA_START * 2,
            ]}
          />
          <meshStandardMaterial color={color} {...GLOSSY_PLASTIC} />
        </mesh>
      ))}
      <mesh name="beach-ball-cap-top" castShadow>
        <sphereGeometry args={[BALL_CAP_RADIUS, 16, 3, 0, Math.PI * 2, 0, BALL_CAP_THETA]} />
        <meshStandardMaterial color={PALETTE.cream} {...GLOSSY_PLASTIC} />
      </mesh>
      <mesh name="beach-ball-cap-bottom" castShadow>
        <sphereGeometry
          args={[BALL_CAP_RADIUS, 16, 3, 0, Math.PI * 2, Math.PI - BALL_CAP_THETA, BALL_CAP_THETA]}
        />
        <meshStandardMaterial color={PALETTE.cream} {...GLOSSY_PLASTIC} />
      </mesh>
    </group>
  );
}
