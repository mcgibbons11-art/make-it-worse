"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";
import { TRAP_CATALOG } from "@/lib/game/trap-catalog";
import type { TrapPlacementInput, TrapType, Vec3Tuple } from "@/lib/game/types";
import { AssetModel } from "../AssetModel";
import { CharlesModel } from "../traps/CharlesTrap";
import {
  AnkleWeightCuff,
  BallMachine,
  BananaPeelPreview,
  BathroomScalesBase,
  BathroomScalesPlate,
  BuntingFlag,
  CatFlapFrame,
  CatFlapLeaf,
  catFlapHinge,
  CeilingFanPreview,
  ClothesAirer,
  ConveyorBelt,
  CordTripPreview,
  CrockeryStack,
  CuckooBird,
  CuckooClock,
  DominoTile,
  DrawerSlamPreview,
  DustBunny,
  EggTimer,
  FishBowl,
  FloorGrate,
  FloorVent,
  FridgeMagnetPreview,
  HobRing,
  HotPotato,
  IceDispenser,
  JunkDrift,
  Kettle,
  LaundryBasketPreview,
  LaundryChuteBody,
  LaundryChuteHatch,
  MotionSensorHead,
  MotionSensorPost,
  MousetrapPreview,
  PaintBucketPreview,
  PEDAL_BIN_LID_HINGE,
  PedalBinBody,
  PedalBinLid,
  PlateStack,
  PressCamera,
  ProppedMattress,
  RobotMopPreview,
  RugPullPreview,
  ShoeRack,
  ShoppingTrolley,
  SinkBasin,
  SpinCyclePreview,
  SprinklerPreview,
  StickyGumPreview,
  SwingDoorJamb,
  SwingDoorLeaf,
  TiltPlateBoard,
  TiltPlatePivot,
  WallPipe,
} from "../traps/TrapProps";

/**
 * What the placer drags around.
 *
 * THE GUARANTEE THIS FILE KEEPS, which it used to claim and break: the preview
 * is the silhouette the trap arrives as. It used to map fifty-four traps onto
 * nine sculpted props, so dragging "Fish Bowl" dragged a beach ball and then
 * placed one, and dragging "Paint Bucket" dragged the same beach ball.
 *
 * Every trap now falls into one of three cases, and all three are honest:
 *
 *   1. Thirty-two wave A and wave B traps render the exact component the trap
 *      itself renders, out of components/game/traps/TrapProps.tsx.
 *   2. Nine traps ARE one of the sculpted props - the hammer is a hammer, the
 *      fridge is a fridge - so they mount the same AssetModel the trap does.
 *   3. Thirteen traps build their own prop inside a rigid body, threaded with
 *      refs the physics drives, which cannot be mounted outside a physics
 *      world. Those render a matching stand-in from the last section of
 *      TrapProps.tsx: same outline, same colour blocking, fewer parts. The
 *      header of that file names the component that owns the real one.
 *
 * Sizes come from TRAP_CATALOG defaultParams, with the same fallbacks the trap
 * components use, so the preview is the size of the thing that lands.
 */
function param(type: TrapType, key: string, fallback: number): number {
  const value = TRAP_CATALOG[type].defaultParams[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Even spacing across a span, matching how the traps lay their own rows out. */
function across(span: number, count: number, index: number): number {
  return -span / 2 + (index / (count - 1)) * span;
}

export function TrapPreviewProp({ type }: { type: TrapType }) {
  switch (type) {
    // Case 2: the trap is the sculpted prop.
    case "swinging_hammer":
      return <AssetModel model="hammer" />;
    case "rolling_fridge":
      return <AssetModel model="refrigerator" />;
    case "floor_fan":
      return <AssetModel model="fan" />;
    case "soap_slick":
      return <AssetModel model="soap" />;
    case "spring_pad":
      return <AssetModel model="spring" />;
    case "angry_vacuum":
      return <AssetModel model="vacuum" />;
    case "rotating_toilet":
      return <AssetModel model="toilet" />;
    case "giant_beach_ball":
      return <AssetModel model="ball" />;
    case "toaster_launcher":
      return <AssetModel model="toaster" />;

    // Case 3: stand-ins for the traps that build their own prop in a body.
    case "ceiling_fan":
      return <CeilingFanPreview />;
    case "banana_peel":
      return <BananaPeelPreview />;
    case "robot_mop":
      return <RobotMopPreview />;
    case "mousetrap":
      return <MousetrapPreview />;
    case "sprinkler":
      return <SprinklerPreview />;
    case "laundry_basket":
      return <LaundryBasketPreview />;
    case "fridge_magnet":
      return <FridgeMagnetPreview />;
    case "paint_bucket":
      return <PaintBucketPreview />;
    case "spin_cycle":
      return <SpinCyclePreview />;
    case "sticky_gum":
      return <StickyGumPreview radius={param(type, "radius", 0.72)} />;
    case "cord_trip":
      return <CordTripPreview span={param(type, "span", 1.7)} />;
    case "drawer_slam":
      return <DrawerSlamPreview />;
    case "rug_pull":
      return <RugPullPreview halfX={0.85} halfZ={0.62} />;

    // Case 1: the same components the wave A trap mounts.
    case "conveyor_strip":
      return (
        <ConveyorBelt width={param(type, "width", 1.5)} length={param(type, "length", 2.4)} />
      );
    case "tilt_plate": {
      const half = param(type, "plate", 0.9);
      return (
        <>
          <TiltPlatePivot half={half} />
          <group position={[0, 0.1, 0]}>
            <TiltPlateBoard half={half} />
          </group>
        </>
      );
    }
    case "motion_sensor":
      return (
        <>
          <MotionSensorPost />
          <MotionSensorHead />
        </>
      );
    case "domino_line": {
      const span = param(type, "span", 1.8);
      return (
        <group position={[0, 0.04, 0]}>
          {[0, 1, 2, 3, 4].map((index) => (
            <group key={index} position={[across(span, 5, index), 0, 0]}>
              <DominoTile />
            </group>
          ))}
        </group>
      );
    }
    case "bunting_line": {
      const span = param(type, "span", 2);
      const clearance = param(type, "clearance", 0.75);
      return (
        <group position={[0, clearance + 0.16, 0]}>
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <group key={index} position={[across(span, 6, index), 0, 0]}>
              <BuntingFlag index={index} />
            </group>
          ))}
        </group>
      );
    }
    case "steam_vents": {
      const spread = param(type, "spread", 0.95);
      return (
        <>
          {[-1, 0, 1].map((lane) => (
            <group key={lane} position={[lane * spread, 0, 0]}>
              <FloorGrate />
            </group>
          ))}
        </>
      );
    }
    case "pipe_burst":
      return <WallPipe run={param(type, "run", 2.6)} />;
    case "ankle_weight":
      return <AnkleWeightCuff />;
    case "chute_drop": {
      const mouth = param(type, "mouth", 0.8);
      return (
        <>
          <LaundryChuteBody mouth={mouth} />
          <group position={[0, 1.26, 0.06]}>
            <LaundryChuteHatch mouth={mouth} />
          </group>
        </>
      );
    }
    case "cart_blocker":
      return <ShoppingTrolley halfWidth={0.42} halfHeight={0.5} halfDepth={0.36} />;
    case "dust_bunny":
      return <DustBunny />;
    case "flood_puddle":
      return <SinkBasin />;
    case "updraft_vent":
      return <FloorVent reach={param(type, "reach", 0.9)} />;
    case "mattress_rebound":
      return <ProppedMattress span={param(type, "span", 1.8)} />;
    case "plate_shards":
      return <PlateStack radius={0.45} />;
    case "cat_flap": {
      const span = param(type, "span", 1.3);
      return (
        <>
          <CatFlapFrame span={span} />
          <group position={catFlapHinge(span)}>
            <CatFlapLeaf span={span} />
          </group>
        </>
      );
    }

    // Case 1 continued: wave B.
    case "paparazzi":
      return <PressCamera />;
    case "bathroom_scales": {
      const pad = param(type, "pad", 0.95);
      return (
        <>
          <BathroomScalesBase pad={pad} />
          <BathroomScalesPlate pad={pad} />
        </>
      );
    }
    case "slow_fuse":
      return <EggTimer radius={param(type, "radius", 0.9)} />;
    case "pile_on":
      return <CrockeryStack />;
    case "bin_pedal":
      return (
        <>
          <PedalBinBody />
          <group position={PEDAL_BIN_LID_HINGE}>
            <PedalBinLid />
          </group>
        </>
      );
    case "swing_door": {
      const span = param(type, "span", 1.9);
      return (
        <group position={[-span / 2, 0, 0]}>
          <SwingDoorJamb height={1.6} />
          <SwingDoorLeaf span={span} height={1.6} />
        </group>
      );
    }
    case "ball_machine":
      return <BallMachine />;
    case "cuckoo_clock":
      return (
        <>
          <CuckooClock />
          <group position={[0, 1.5, 0.24]}>
            <CuckooBird />
          </group>
        </>
      );
    case "fish_bowl":
      return <FishBowl radius={param(type, "radius", 1.5)} />;
    case "shoe_rack":
      return <ShoeRack />;
    case "hot_potato":
      return (
        <group position={[0, 0.22, 0]}>
          <HotPotato radius={0.17} />
        </group>
      );
    case "stove_ring":
      return <HobRing eye={param(type, "eye", 0.55)} flare={param(type, "flare", 1.7)} />;
    case "clothes_airer":
      return <ClothesAirer span={param(type, "length", 2.1)} height={1.1} />;
    case "ice_dispenser":
      return <IceDispenser />;
    case "kettle_boil":
      return <Kettle />;
    case "junk_drift":
      return (
        <group scale={0.4}>
          <JunkDrift />
        </group>
      );
    case "charles_murder_baby":
      return <CharlesModel />;
    default:
      // The same invariant TrapRenderer's dispatch and TrapIcon's glyph switch
      // carry: a roster entry with no preview has to be a compile error rather
      // than an empty drag.
      return unpreviewable(type);
  }
}

function unpreviewable(type: never): null {
  console.error(`TrapPreview has no prop for ${String(type)}`);
  return null;
}

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
      <TrapPreviewProp type={placement.type} />
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
