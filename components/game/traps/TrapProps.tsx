"use client";
import { PALETTE } from "@/lib/game/constants";

/**
 * The prop each wave A and wave B trap is dressed in.
 *
 * WHY THIS FILE EXISTS. The thirty-two traps in TrapsWaveA.tsx and
 * TrapsWaveB.tsx used to borrow one of eight sculpted props through AssetModel,
 * so a fish bowl arrived on the course as a beach ball and a paint bucket
 * dragged one around the editor. Fifty-four traps that share eight silhouettes
 * is eight traps to a player, and a trap a player cannot name is a trap they
 * cannot learn - which is a fairness problem in a game whose promise is that
 * nothing kills you without warning, not a cosmetic one.
 *
 * WHAT MAKES A SILHOUETTE READABLE, and the rule every prop below is held to:
 * the OUTLINE and the COLOUR BLOCKING have to differ from every other prop's.
 * A bowl is a sphere with a flat waterline and a rim; a tin is a cylinder with
 * a lid and a handle; a plate stack is a short cylinder with visible layers.
 * None of these is a faithful sculpt and none is trying to be. Honest primitive
 * combinations that read apart at ten metres beat eight shared meshes by a wide
 * margin, and distinctness is the thing being optimised here, not fidelity.
 *
 * WHY IT IS NOT IN THE TRAP FILES. tests/unit/traps-wave-b.test.ts forbids a
 * lit material anywhere in TrapsWaveB.tsx, because that file authors telegraphs
 * and telegraphs are meshBasicMaterial drawn in PALETTE.danger. Props are lit.
 * Keeping them here preserves that separation: the trap files still draw only
 * reach and wind-up, and nothing in this file knows what a hazard is.
 *
 * WHY THE PLACEMENT PREVIEW IMPORTS IT TOO. TrapPreview renders the same
 * component the in-play trap renders, so what a player drags around is what
 * lands. Anything mounted here therefore has to stay a pure function of its
 * props: no hooks, no physics, no refs of its own. A trap that animates part of
 * its prop takes that part as a separate export and wraps it in its own group,
 * which is why the flap, the lid, the leaf and the head are split out below.
 *
 * COLOUR comes from PALETTE plus TRIM. Nothing here picks a hex by eye.
 *
 * THE LAST SECTION IS DIFFERENT AND SAYS SO. Fourteen traps in ForceTraps,
 * LauncherTraps and NewTraps already build their own prop, correctly, out of
 * geometry that is sized by the same constants their hit tests read and that is
 * threaded through refs the physics drives. Those cannot be mounted outside a
 * physics world, so the placement preview cannot render them. The section at
 * the bottom of this file draws the same OUTLINE for the preview only, at a
 * lower part count, and each one names the component that owns the real thing.
 * That is the one place in the roster where a silhouette is drawn twice; the
 * other forty are drawn once and rendered in both places.
 */

/** Dark navy for trims, feet and recesses. The established prop convention. */
const TRIM = "#24324a";

const PLASTIC = { roughness: 0.78 } as const;
const METAL = { roughness: 0.55, metalness: 0.25 } as const;
const SOFT = { roughness: 0.92 } as const;

// ---------------------------------------------------------------------------
// Wave A
// ---------------------------------------------------------------------------

/** Long navy deck on two cream rollers, ribbed with yellow cleats. */
export function ConveyorBelt({ width, length }: { width: number; length: number }) {
  return (
    <group name="conveyorBeltProp">
      <mesh name="conveyorDeck" castShadow receiveShadow position={[0, 0.07, 0]}>
        <boxGeometry args={[width, 0.13, length]} />
        <meshStandardMaterial color={TRIM} {...PLASTIC} />
      </mesh>
      {[-1, 1].map((end) => (
        <mesh
          key={end}
          name={`conveyorRoller${end}`}
          castShadow
          position={[0, 0.07, (end * length) / 2]}
          rotation={[0, 0, Math.PI / 2]}
        >
          <cylinderGeometry args={[0.085, 0.085, width, 12]} />
          <meshStandardMaterial color={PALETTE.cream} {...METAL} />
        </mesh>
      ))}
      {[-0.3, 0, 0.3].map((share) => (
        <mesh key={share} name={`conveyorCleat${share}`} position={[0, 0.14, share * length]}>
          <boxGeometry args={[width * 0.9, 0.04, 0.08]} />
          <meshStandardMaterial color={PALETTE.yellow} {...PLASTIC} />
        </mesh>
      ))}
    </group>
  );
}

/** The ridge the plate rocks on. Drawn where the trap's own pivot marker is. */
export function TiltPlatePivot({ half }: { half: number }) {
  return (
    <mesh name="tiltPivotRidge" castShadow position={[0, 0.05, 0]}>
      <boxGeometry args={[0.13, 0.1, half * 1.7]} />
      <meshStandardMaterial color={PALETTE.muted} {...METAL} />
    </mesh>
  );
}

/** The board that rolls. Sits on the ridge, so it is drawn just above it. */
export function TiltPlateBoard({ half }: { half: number }) {
  return (
    <group name="tiltPlateProp">
      <mesh name="tiltBoard" castShadow receiveShadow position={[0, 0.1, 0]}>
        <boxGeometry args={[half * 2, 0.08, half * 2]} />
        <meshStandardMaterial color={PALETTE.purple} {...PLASTIC} />
      </mesh>
      <mesh name="tiltBoardLip" position={[0, 0.145, 0]}>
        <boxGeometry args={[half * 1.82, 0.02, half * 1.82]} />
        <meshStandardMaterial color={PALETTE.cream} {...PLASTIC} />
      </mesh>
    </group>
  );
}

/** The post a motion sensor stands on. The head that pans is separate. */
export function MotionSensorPost() {
  return (
    <group name="motionSensorProp">
      <mesh name="sensorFoot" castShadow position={[0, 0.03, 0]}>
        <cylinderGeometry args={[0.17, 0.2, 0.06, 14]} />
        <meshStandardMaterial color={TRIM} {...PLASTIC} />
      </mesh>
      <mesh name="sensorPost" castShadow position={[0, 0.53, 0]}>
        <cylinderGeometry args={[0.045, 0.055, 1, 10]} />
        <meshStandardMaterial color={PALETTE.muted} {...METAL} />
      </mesh>
    </group>
  );
}

/** Cream housing with a red eye, mounted at the top of the post. */
export function MotionSensorHead() {
  return (
    <group name="motionSensorHead" position={[0, 1.12, 0]}>
      <mesh name="sensorHousing" castShadow>
        <boxGeometry args={[0.34, 0.2, 0.19]} />
        <meshStandardMaterial color={PALETTE.cream} {...PLASTIC} />
      </mesh>
      <mesh name="sensorLens" position={[0, 0, 0.11]} scale={[1, 1, 0.55]}>
        <sphereGeometry args={[0.075, 12, 10]} />
        <meshStandardMaterial color={PALETTE.red} roughness={0.35} />
      </mesh>
      <mesh name="sensorHood" position={[0, 0.11, 0.03]}>
        <boxGeometry args={[0.36, 0.03, 0.24]} />
        <meshStandardMaterial color={TRIM} {...PLASTIC} />
      </mesh>
    </group>
  );
}

/** One upright tile, pipped, standing on its own base. */
export function DominoTile() {
  return (
    <group name="dominoTileProp">
      <mesh name="dominoFace" castShadow position={[0, 0.22, 0]}>
        <boxGeometry args={[0.26, 0.44, 0.07]} />
        <meshStandardMaterial color={PALETTE.cream} {...PLASTIC} />
      </mesh>
      <mesh name="dominoBar" position={[0, 0.22, 0.038]}>
        <boxGeometry args={[0.2, 0.018, 0.01]} />
        <meshStandardMaterial color={TRIM} {...PLASTIC} />
      </mesh>
      {[0.32, 0.12].map((y) => (
        <mesh key={y} name={`dominoPip${y}`} position={[0, y, 0.04]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.034, 0.034, 0.012, 8]} />
          <meshStandardMaterial color={TRIM} {...PLASTIC} />
        </mesh>
      ))}
    </group>
  );
}

const BUNTING_COLOURS = [PALETTE.red, PALETTE.yellow, PALETTE.green] as const;

/** One pennant hanging point-down off the line. */
export function BuntingFlag({ index }: { index: number }) {
  return (
    <mesh
      name={`buntingFlag${index}`}
      castShadow
      position={[0, -0.14, 0]}
      rotation={[0, 0, Math.PI]}
    >
      <coneGeometry args={[0.13, 0.28, 3]} />
      <meshStandardMaterial
        color={BUNTING_COLOURS[index % BUNTING_COLOURS.length]!}
        side={2}
        {...SOFT}
      />
    </mesh>
  );
}

/** Square floor grate the steam comes up through. */
export function FloorGrate() {
  return (
    <group name="floorGrateProp">
      <mesh name="grateFrame" receiveShadow position={[0, 0.025, 0]}>
        <boxGeometry args={[0.46, 0.05, 0.46]} />
        <meshStandardMaterial color={PALETTE.muted} {...METAL} />
      </mesh>
      <mesh name="grateWell" position={[0, 0.04, 0]}>
        <boxGeometry args={[0.36, 0.03, 0.36]} />
        <meshStandardMaterial color={TRIM} {...PLASTIC} />
      </mesh>
      {[-0.11, 0, 0.11].map((z) => (
        <mesh key={z} name={`grateBar${z}`} position={[0, 0.06, z]}>
          <boxGeometry args={[0.36, 0.03, 0.05]} />
          <meshStandardMaterial color={PALETTE.cream} {...METAL} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * The pipe, running the way the trap says it runs.
 *
 * `run` is the DISTANCE FORWARD to the burst, not a length across the lane: the
 * trap draws a strip from the origin to z = run and puts the jet at the far end
 * of it. So the pipe is drawn along +Z, ending in an elbow over the burst, and
 * the valve sits back at the near end where the rattle starts.
 */
export function WallPipe({ run }: { run: number }) {
  return (
    <group name="wallPipeProp">
      <mesh name="pipeRun" castShadow position={[0, 0.88, run / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.095, 0.095, run, 14]} />
        <meshStandardMaterial color={PALETTE.muted} {...METAL} />
      </mesh>
      {[0.28, 0.72].map((share) => (
        <mesh
          key={share}
          name={`pipeBracket${share}`}
          castShadow
          position={[0, 0.78, run * share]}
        >
          <boxGeometry args={[0.16, 0.24, 0.07]} />
          <meshStandardMaterial color={TRIM} {...PLASTIC} />
        </mesh>
      ))}
      <mesh
        name="pipeValveWheel"
        castShadow
        position={[0, 1.05, run * 0.12]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <torusGeometry args={[0.13, 0.032, 6, 16]} />
        <meshStandardMaterial color={PALETTE.yellow} {...METAL} />
      </mesh>
      <mesh name="pipeValveStem" position={[0, 0.96, run * 0.12]}>
        <cylinderGeometry args={[0.028, 0.028, 0.18, 8]} />
        <meshStandardMaterial color={PALETTE.yellow} {...METAL} />
      </mesh>
      <mesh name="pipeElbow" castShadow position={[0, 0.82, run]}>
        <cylinderGeometry args={[0.105, 0.105, 0.2, 12]} />
        <meshStandardMaterial color={PALETTE.muted} {...METAL} />
      </mesh>
      <mesh name="pipeSpout" position={[0, 0.66, run]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.085, 0.2, 10]} />
        <meshStandardMaterial color={PALETTE.blue} roughness={0.4} />
      </mesh>
    </group>
  );
}

/** A pair of strapped cuffs, low enough to be missed and heavy enough to read. */
export function AnkleWeightCuff() {
  return (
    <group name="ankleWeightProp">
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 0.14, 0, 0]}>
          <mesh name={`ankleCuff${side}`} castShadow position={[0, 0.07, 0]}>
            <boxGeometry args={[0.21, 0.14, 0.17]} />
            <meshStandardMaterial color={PALETTE.muted} {...METAL} />
          </mesh>
          <mesh name={`ankleStrap${side}`} position={[0, 0.07, 0]}>
            <boxGeometry args={[0.23, 0.05, 0.185]} />
            <meshStandardMaterial color={PALETTE.red} {...SOFT} />
          </mesh>
          <mesh name={`ankleBuckle${side}`} position={[0, 0.07, 0.1]}>
            <boxGeometry args={[0.06, 0.06, 0.02]} />
            <meshStandardMaterial color={PALETTE.yellow} {...METAL} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** The wall the chute is set into. The hatch that opens is separate. */
export function LaundryChuteBody({ mouth }: { mouth: number }) {
  return (
    <group name="laundryChuteProp">
      <mesh name="chuteWall" castShadow receiveShadow position={[0, 0.75, -0.16]}>
        <boxGeometry args={[mouth * 1.4, 1.5, 0.16]} />
        <meshStandardMaterial color={PALETTE.cream} {...PLASTIC} />
      </mesh>
      {/* A four-sided cylinder turned 45 degrees is a square hopper whose half
          side is radius/sqrt(2), so mouth*0.5 keeps it inside the 0.28 collider
          rather than poking a runner-sized wedge out through the front of it. */}
      <mesh name="chuteThroat" castShadow position={[0, 1, 0]} rotation={[0, Math.PI / 4, 0]}>
        <cylinderGeometry args={[mouth * 0.5, mouth * 0.34, 0.52, 4]} />
        <meshStandardMaterial color={PALETTE.blue} {...PLASTIC} />
      </mesh>
      <mesh name="chuteLip" castShadow position={[0, 0.72, 0]}>
        <boxGeometry args={[mouth * 1.15, 0.09, mouth * 0.6]} />
        <meshStandardMaterial color={TRIM} {...PLASTIC} />
      </mesh>
    </group>
  );
}

/** The hatch. Hinged along its top edge, so it is drawn hanging below y = 0. */
export function LaundryChuteHatch({ mouth }: { mouth: number }) {
  return (
    <mesh name="chuteHatch" castShadow position={[0, -0.22, 0.24]}>
      <boxGeometry args={[mouth * 1.1, 0.44, 0.05]} />
      <meshStandardMaterial color={PALETTE.orange} {...PLASTIC} />
    </mesh>
  );
}

/** Open-topped basket on two axles, with a push handle across the back. */
export function ShoppingTrolley({
  halfWidth,
  halfHeight,
  halfDepth,
}: {
  halfWidth: number;
  halfHeight: number;
  halfDepth: number;
}) {
  return (
    <group name="shoppingTrolleyProp">
      <mesh name="trolleyFloor" castShadow position={[0, halfHeight * 0.62, 0]}>
        <boxGeometry args={[halfWidth * 2, 0.07, halfDepth * 2]} />
        <meshStandardMaterial color={PALETTE.muted} {...METAL} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh
          key={`side${side}`}
          name={`trolleySide${side}`}
          castShadow
          position={[side * halfWidth, halfHeight * 1.05, 0]}
        >
          <boxGeometry args={[0.05, halfHeight * 0.86, halfDepth * 2]} />
          <meshStandardMaterial color={PALETTE.muted} {...METAL} />
        </mesh>
      ))}
      {[-1, 1].map((end) => (
        <mesh
          key={`end${end}`}
          name={`trolleyEnd${end}`}
          castShadow
          position={[0, halfHeight * 1.05, end * halfDepth]}
        >
          <boxGeometry args={[halfWidth * 2, halfHeight * 0.86, 0.05]} />
          <meshStandardMaterial color={PALETTE.muted} {...METAL} />
        </mesh>
      ))}
      <mesh name="trolleyRim" position={[0, halfHeight * 1.46, 0]}>
        <boxGeometry args={[halfWidth * 2.05, 0.06, halfDepth * 2.05]} />
        <meshStandardMaterial color={PALETTE.cream} {...METAL} />
      </mesh>
      <mesh
        name="trolleyHandle"
        castShadow
        position={[0, halfHeight * 1.6, -halfDepth]}
        rotation={[0, 0, Math.PI / 2]}
      >
        <cylinderGeometry args={[0.04, 0.04, halfWidth * 1.8, 8]} />
        <meshStandardMaterial color={PALETTE.orange} {...PLASTIC} />
      </mesh>
      {/* The cart tracks along its own X, so the wheels have to roll along X
          and the axles run across it. An axle drawn the other way is a cart
          that visibly cannot go where the trap is about to take it. */}
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          name={`trolleyAxle${side}`}
          position={[side * halfWidth * 0.7, 0.09, 0]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <cylinderGeometry args={[0.09, 0.09, halfDepth * 1.7, 10]} />
          <meshStandardMaterial color={TRIM} {...PLASTIC} />
        </mesh>
      ))}
    </group>
  );
}

/** Lumpy clump of fluff. Origin at the floor, like every other rolling prop. */
export function DustBunny() {
  return (
    <group name="dustBunnyProp">
      <mesh name="dustCore" castShadow position={[0, 0.24, 0]}>
        <sphereGeometry args={[0.24, 12, 10]} />
        <meshStandardMaterial color={PALETTE.purple} {...SOFT} />
      </mesh>
      <mesh name="dustTuftA" castShadow position={[0.17, 0.35, -0.08]}>
        <sphereGeometry args={[0.15, 10, 8]} />
        <meshStandardMaterial color={PALETTE.purple} {...SOFT} />
      </mesh>
      <mesh name="dustTuftB" castShadow position={[-0.16, 0.16, 0.12]}>
        <sphereGeometry args={[0.17, 10, 8]} />
        <meshStandardMaterial color={PALETTE.muted} {...SOFT} />
      </mesh>
      <mesh name="dustTuftC" castShadow position={[0.04, 0.14, -0.19]}>
        <sphereGeometry args={[0.13, 10, 8]} />
        <meshStandardMaterial color={PALETTE.muted} {...SOFT} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} name={`dustEye${side}`} position={[side * 0.09, 0.3, 0.2]}>
          <sphereGeometry args={[0.035, 8, 6]} />
          <meshStandardMaterial color={PALETTE.ink} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

/** Pedestal basin: a column under a bowl, which is not a toilet's outline. */
export function SinkBasin() {
  return (
    <group name="sinkBasinProp">
      <mesh name="basinPedestal" castShadow position={[0, 0.28, 0]}>
        <cylinderGeometry args={[0.14, 0.19, 0.56, 12]} />
        <meshStandardMaterial color={PALETTE.cream} {...PLASTIC} />
      </mesh>
      <mesh name="basinBowl" castShadow receiveShadow position={[0, 0.66, 0]}>
        <cylinderGeometry args={[0.36, 0.24, 0.2, 16]} />
        <meshStandardMaterial color={PALETTE.cream} {...PLASTIC} />
      </mesh>
      <mesh name="basinWater" position={[0, 0.72, 0]}>
        <cylinderGeometry args={[0.31, 0.31, 0.03, 16]} />
        <meshStandardMaterial color={PALETTE.blue} roughness={0.2} />
      </mesh>
      <mesh name="basinRiser" castShadow position={[0, 0.88, -0.24]}>
        <cylinderGeometry args={[0.035, 0.035, 0.24, 8]} />
        <meshStandardMaterial color={PALETTE.muted} {...METAL} />
      </mesh>
      <mesh name="basinSpout" position={[0, 0.98, -0.14]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.22, 8]} />
        <meshStandardMaterial color={PALETTE.muted} {...METAL} />
      </mesh>
    </group>
  );
}

/** Round floor vent with radial vanes, so it does not read as a steam grate. */
export function FloorVent({ reach }: { reach: number }) {
  const ring = reach * 0.62;
  return (
    <group name="floorVentProp">
      <mesh name="ventRim" receiveShadow position={[0, 0.03, 0]}>
        <cylinderGeometry args={[ring, ring, 0.06, 20]} />
        <meshStandardMaterial color={PALETTE.muted} {...METAL} />
      </mesh>
      <mesh name="ventWell" position={[0, 0.05, 0]}>
        <cylinderGeometry args={[ring * 0.82, ring * 0.82, 0.04, 20]} />
        <meshStandardMaterial color={TRIM} {...PLASTIC} />
      </mesh>
      {[0, 1, 2, 3].map((index) => (
        <mesh
          key={index}
          name={`ventVane${index}`}
          position={[0, 0.075, 0]}
          rotation={[0, (index * Math.PI) / 4, 0]}
        >
          <boxGeometry args={[ring * 1.5, 0.03, 0.06]} />
          <meshStandardMaterial color={PALETTE.blue} {...METAL} />
        </mesh>
      ))}
    </group>
  );
}

/** Mattress stood on its edge: a quilted slab with a rolled top and two feet. */
export function ProppedMattress({ span }: { span: number }) {
  return (
    <group name="proppedMattressProp">
      <mesh name="mattressBody" castShadow receiveShadow position={[0, 0.62, 0]}>
        <boxGeometry args={[span, 1.1, 0.32]} />
        <meshStandardMaterial color={PALETTE.cream} {...SOFT} />
      </mesh>
      <mesh name="mattressRoll" castShadow position={[0, 1.17, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.16, 0.16, span, 12]} />
        <meshStandardMaterial color={PALETTE.cream} {...SOFT} />
      </mesh>
      {[0.36, 0.72, 1.04].map((y) => (
        <mesh key={y} name={`mattressSeam${y}`} position={[0, y, 0.165]}>
          <boxGeometry args={[span * 0.94, 0.05, 0.02]} />
          <meshStandardMaterial color={PALETTE.blue} {...SOFT} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh key={side} name={`mattressFoot${side}`} castShadow position={[side * span * 0.36, 0.05, 0.12]}>
          <boxGeometry args={[0.16, 0.1, 0.34]} />
          <meshStandardMaterial color={TRIM} {...PLASTIC} />
        </mesh>
      ))}
    </group>
  );
}

/** Stack of plates. The layers are the whole point, so they are drawn apart. */
export function PlateStack({ radius }: { radius: number }) {
  const plates = [0, 1, 2, 3, 4];
  return (
    <group name="plateStackProp">
      {plates.map((index) => (
        <mesh
          key={index}
          name={`plateLayer${index}`}
          castShadow
          position={[0, 0.035 + index * 0.055, 0]}
        >
          <cylinderGeometry args={[radius - index * 0.018, radius - index * 0.022, 0.038, 20]} />
          <meshStandardMaterial color={PALETTE.cream} {...PLASTIC} />
        </mesh>
      ))}
      <mesh name="plateTopRim" position={[0, 0.29, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius - 0.09, 0.018, 6, 20]} />
        <meshStandardMaterial color={PALETTE.blue} {...PLASTIC} />
      </mesh>
    </group>
  );
}

/**
 * Cat flap frame, taken from assets/reference/trap-cat-flap.png: a cream
 * square surround with a purple flap hinged along its top rail. The flap is a
 * separate export because it is the part that swings.
 */
export function CatFlapFrame({ span }: { span: number }) {
  const height = span * 0.78;
  const bar = span * 0.16;
  return (
    <group name="catFlapProp" position={[0, height / 2 + 0.12, 0]}>
      {[-1, 1].map((side) => (
        <mesh key={`x${side}`} name={`flapJamb${side}`} castShadow position={[(side * (span - bar)) / 2, 0, 0]}>
          <boxGeometry args={[bar, height, 0.11]} />
          <meshStandardMaterial color={PALETTE.cream} {...PLASTIC} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh key={`y${side}`} name={`flapRail${side}`} castShadow position={[0, (side * (height - bar)) / 2, 0]}>
          <boxGeometry args={[span, bar, 0.11]} />
          <meshStandardMaterial color={PALETTE.cream} {...PLASTIC} />
        </mesh>
      ))}
      <mesh name="flapHinge" position={[0, (height - bar) / 2 - bar * 0.4, 0.045]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.026, 0.026, span * 0.78, 8]} />
        <meshStandardMaterial color={PALETTE.muted} {...METAL} />
      </mesh>
    </group>
  );
}

/**
 * Where the leaf's hinge sits, in the trap's own frame. The group that swings
 * the leaf has to be placed here: rotating it about X anywhere else pivots the
 * flap about the floor, which is a slab tipping over rather than a flap.
 */
export function catFlapHinge(span: number): [number, number, number] {
  return [0, span * 0.78 + 0.12 - span * 0.16, 0.05];
}

/** The swinging leaf, drawn hanging below its hinge so the pivot is at y = 0. */
export function CatFlapLeaf({ span }: { span: number }) {
  const leaf = span * 0.78 - span * 0.34;
  return (
    <mesh name="catFlapLeaf" castShadow position={[0, -leaf / 2, 0]}>
      <boxGeometry args={[span * 0.66, leaf, 0.04]} />
      <meshStandardMaterial color={PALETTE.purple} {...PLASTIC} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Wave B
// ---------------------------------------------------------------------------

/** Press camera on a short stand: body, barrel lens and a flash brick. */
export function PressCamera() {
  return (
    <group name="pressCameraProp">
      <mesh name="cameraLeg" castShadow position={[0, 0.16, 0]}>
        <cylinderGeometry args={[0.06, 0.13, 0.32, 10]} />
        <meshStandardMaterial color={TRIM} {...PLASTIC} />
      </mesh>
      <mesh name="cameraBody" castShadow position={[0, 0.56, 0]}>
        <boxGeometry args={[0.5, 0.34, 0.28]} />
        <meshStandardMaterial color={PALETTE.muted} {...PLASTIC} />
      </mesh>
      <mesh name="cameraLens" castShadow position={[0, 0.56, 0.24]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.15, 0.13, 0.24, 16]} />
        <meshStandardMaterial color={TRIM} {...METAL} />
      </mesh>
      <mesh name="cameraGlass" position={[0, 0.56, 0.36]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.11, 0.11, 0.03, 16]} />
        <meshStandardMaterial color={PALETTE.blue} roughness={0.15} />
      </mesh>
      <mesh name="cameraFlash" castShadow position={[0, 0.8, 0.02]}>
        <boxGeometry args={[0.28, 0.16, 0.12]} />
        <meshStandardMaterial color={PALETTE.cream} {...PLASTIC} />
      </mesh>
      <mesh name="cameraBulb" position={[0, 0.8, 0.09]}>
        <sphereGeometry args={[0.06, 10, 8]} />
        <meshStandardMaterial color={PALETTE.yellow} roughness={0.25} />
      </mesh>
    </group>
  );
}

/**
 * The base the scales sit on. The tread plate that squashes is separate.
 *
 * Kept inside the trap's trigger disc, which is drawn flat at `pad - 0.12`: a
 * prop as wide as the disc covers the warning it is supposed to be standing in.
 */
export function BathroomScalesBase({ pad }: { pad: number }) {
  return (
    <group name="bathroomScalesProp">
      <mesh name="scalesBase" receiveShadow position={[0, 0.035, 0]}>
        <boxGeometry args={[pad * 1.25, 0.07, pad * 1.25]} />
        <meshStandardMaterial color={TRIM} {...PLASTIC} />
      </mesh>
    </group>
  );
}

/** Cream tread plate with a blue dial and a red needle. */
export function BathroomScalesPlate({ pad }: { pad: number }) {
  return (
    <group name="bathroomScalesPlate">
      <mesh name="scalesTread" castShadow receiveShadow position={[0, 0.11, 0]}>
        <boxGeometry args={[pad * 1.15, 0.09, pad * 1.15]} />
        <meshStandardMaterial color={PALETTE.cream} {...PLASTIC} />
      </mesh>
      <mesh name="scalesDial" position={[0, 0.16, pad * 0.28]}>
        <cylinderGeometry args={[pad * 0.34, pad * 0.34, 0.03, 20]} />
        <meshStandardMaterial color={PALETTE.blue} roughness={0.3} />
      </mesh>
      <mesh name="scalesNeedle" position={[0, 0.18, pad * 0.28]} rotation={[0, 0.7, 0]}>
        <boxGeometry args={[0.03, 0.012, pad * 0.5]} />
        <meshStandardMaterial color={PALETTE.red} roughness={0.4} />
      </mesh>
    </group>
  );
}

/** Egg timer: a squat red drum with a cream face and a wind-up knob. */
export function EggTimer({ radius }: { radius: number }) {
  const body = Math.min(0.32, radius * 0.38);
  return (
    <group name="eggTimerProp">
      <mesh name="timerBody" castShadow position={[0, body, 0]}>
        <cylinderGeometry args={[body, body * 1.08, body * 2, 18]} />
        <meshStandardMaterial color={PALETTE.red} {...PLASTIC} />
      </mesh>
      <mesh name="timerFace" position={[0, body, body * 1.02]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[body * 0.7, body * 0.7, 0.02, 18]} />
        <meshStandardMaterial color={PALETTE.cream} roughness={0.4} />
      </mesh>
      <mesh name="timerHand" position={[0, body + body * 0.28, body * 1.04]} rotation={[0, 0, 0.5]}>
        <boxGeometry args={[0.02, body * 0.6, 0.012]} />
        <meshStandardMaterial color={PALETTE.ink} roughness={0.4} />
      </mesh>
      <mesh name="timerKnob" castShadow position={[0, body * 2.16, 0]}>
        <cylinderGeometry args={[body * 0.3, body * 0.34, body * 0.4, 10]} />
        <meshStandardMaterial color={PALETTE.muted} {...METAL} />
      </mesh>
    </group>
  );
}

/** Leaning tower of crates, each one offset so the stack reads as unstable. */
export function CrockeryStack() {
  const crates = [
    { y: 0.16, size: 0.66, colour: PALETTE.orange, turn: 0 },
    { y: 0.48, size: 0.58, colour: PALETTE.purple, turn: 0.18 },
    { y: 0.76, size: 0.5, colour: PALETTE.orange, turn: -0.24 },
    { y: 1, size: 0.4, colour: PALETTE.blue, turn: 0.32 },
  ];
  return (
    <group name="crockeryStackProp">
      {crates.map((crate) => (
        <group key={crate.y} position={[0, crate.y, 0]} rotation={[0, crate.turn, 0]}>
          <mesh name={`crate${crate.y}`} castShadow receiveShadow>
            <boxGeometry args={[crate.size, crate.size * 0.44, crate.size * 0.8]} />
            <meshStandardMaterial color={crate.colour} {...PLASTIC} />
          </mesh>
          <mesh name={`crateLid${crate.y}`} position={[0, crate.size * 0.24, 0]}>
            <boxGeometry args={[crate.size * 1.05, crate.size * 0.06, crate.size * 0.85]} />
            <meshStandardMaterial color={PALETTE.cream} {...PLASTIC} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Where the bin's lid meets its rim, which is also where its hinge sits. */
const PEDAL_BIN_RADIUS = 0.34;

/** Tapered green bin with a foot pedal on a linkage. The lid is separate. */
export function PedalBinBody() {
  return (
    <group name="pedalBinProp">
      <mesh name="binDrum" castShadow receiveShadow position={[0, 0.36, 0]}>
        <cylinderGeometry args={[0.34, 0.27, 0.72, 18]} />
        <meshStandardMaterial color={PALETTE.green} {...PLASTIC} />
      </mesh>
      {[-0.18, 0.06, 0.3].map((y) => (
        <mesh key={y} name={`binRib${y}`} position={[0, 0.36 + y, 0]}>
          <cylinderGeometry args={[0.33, 0.33, 0.025, 18]} />
          <meshStandardMaterial color={TRIM} {...PLASTIC} />
        </mesh>
      ))}
      <mesh name="binPedal" castShadow position={[0, 0.04, 0.36]}>
        <boxGeometry args={[0.26, 0.06, 0.18]} />
        <meshStandardMaterial color={PALETTE.yellow} {...PLASTIC} />
      </mesh>
      <mesh name="binLinkage" position={[0, 0.06, 0.22]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.022, 0.022, 0.3, 8]} />
        <meshStandardMaterial color={PALETTE.muted} {...METAL} />
      </mesh>
    </group>
  );
}

/**
 * Bin lid, drawn a lid's radius forward of the origin so the group holding it
 * can sit on the back edge. Rotating that group about X then throws the lid
 * open on its hinge rather than flipping it about its own middle.
 */
export const PEDAL_BIN_LID_HINGE = [0, 0.72, -PEDAL_BIN_RADIUS] as const;

export function PedalBinLid() {
  return (
    <group name="pedalBinLid" position={[0, 0, PEDAL_BIN_RADIUS]}>
      <mesh name="binLid" castShadow position={[0, 0.04, 0]}>
        <cylinderGeometry args={[0.37, 0.34, 0.08, 18]} />
        <meshStandardMaterial color={PALETTE.muted} {...PLASTIC} />
      </mesh>
      <mesh name="binLidKnob" position={[0, 0.11, 0]}>
        <sphereGeometry args={[0.05, 10, 8]} />
        <meshStandardMaterial color={TRIM} {...PLASTIC} />
      </mesh>
    </group>
  );
}

/** The jamb the door hangs on. Static: only the leaf swings. */
export function SwingDoorJamb({ height }: { height: number }) {
  return (
    <group name="swingDoorJambProp">
      <mesh name="doorJamb" castShadow position={[0, height / 2, 0]}>
        <boxGeometry args={[0.16, height + 0.16, 0.16]} />
        <meshStandardMaterial color={PALETTE.muted} {...METAL} />
      </mesh>
      <mesh name="doorJambFoot" castShadow position={[0, 0.04, 0]}>
        <cylinderGeometry args={[0.19, 0.22, 0.08, 12]} />
        <meshStandardMaterial color={TRIM} {...PLASTIC} />
      </mesh>
    </group>
  );
}

/** The leaf, drawn from the hinge outward so its group rotates about the jamb. */
export function SwingDoorLeaf({ span, height }: { span: number; height: number }) {
  return (
    <group name="swingDoorLeafProp">
      <mesh name="doorLeaf" castShadow receiveShadow position={[span / 2, height / 2, 0]}>
        <boxGeometry args={[span, height, 0.08]} />
        <meshStandardMaterial color={PALETTE.orange} {...PLASTIC} />
      </mesh>
      <mesh name="doorPanel" position={[span / 2, height * 0.58, 0.05]}>
        <boxGeometry args={[span * 0.62, height * 0.4, 0.02]} />
        <meshStandardMaterial color={PALETTE.cream} {...PLASTIC} />
      </mesh>
      <mesh name="doorKnob" position={[span * 0.87, height * 0.46, 0.08]}>
        <sphereGeometry args={[0.06, 10, 8]} />
        <meshStandardMaterial color={PALETTE.yellow} {...METAL} />
      </mesh>
    </group>
  );
}

/** Hopper of balls over a muzzle tube, on a splayed stand. */
export function BallMachine() {
  return (
    <group name="ballMachineProp">
      <mesh name="machineBody" castShadow receiveShadow position={[0, 0.34, 0]}>
        <boxGeometry args={[0.6, 0.68, 0.6]} />
        <meshStandardMaterial color={PALETTE.purple} {...PLASTIC} />
      </mesh>
      <mesh name="machineHopper" castShadow position={[0, 0.84, 0]}>
        <cylinderGeometry args={[0.36, 0.22, 0.32, 14, 1, true]} />
        <meshStandardMaterial color={PALETTE.muted} side={2} {...METAL} />
      </mesh>
      <mesh name="machineHopperBallA" position={[-0.11, 0.9, 0.05]}>
        <sphereGeometry args={[0.1, 10, 8]} />
        <meshStandardMaterial color={PALETTE.yellow} {...PLASTIC} />
      </mesh>
      <mesh name="machineHopperBallB" position={[0.12, 0.88, -0.06]}>
        <sphereGeometry args={[0.1, 10, 8]} />
        <meshStandardMaterial color={PALETTE.blue} {...PLASTIC} />
      </mesh>
      <mesh name="machineMuzzle" castShadow position={[0, 0.5, 0.4]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.13, 0.16, 0.36, 14]} />
        <meshStandardMaterial color={TRIM} {...METAL} />
      </mesh>
      <mesh name="machineFoot" position={[0, 0.03, 0]}>
        <boxGeometry args={[0.7, 0.06, 0.7]} />
        <meshStandardMaterial color={TRIM} {...PLASTIC} />
      </mesh>
    </group>
  );
}

/** The ball it fires: small, yellow, seamed. Not the giant beach ball. */
export function PracticeBall() {
  return (
    <group name="practiceBallProp">
      <mesh name="practiceBall" castShadow>
        <sphereGeometry args={[0.16, 14, 12]} />
        <meshStandardMaterial color={PALETTE.yellow} {...PLASTIC} />
      </mesh>
      <mesh name="practiceBallSeam" rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.155, 0.014, 6, 18]} />
        <meshStandardMaterial color={PALETTE.cream} {...PLASTIC} />
      </mesh>
    </group>
  );
}

/** Gabled clock case with a hatch, a face and a swinging weight. */
export function CuckooClock() {
  return (
    <group name="cuckooClockProp">
      <mesh name="clockCase" castShadow receiveShadow position={[0, 1.1, 0]}>
        <boxGeometry args={[0.62, 0.66, 0.44]} />
        <meshStandardMaterial color={PALETTE.orange} {...PLASTIC} />
      </mesh>
      <mesh name="clockRoof" castShadow position={[0, 1.55, 0]} rotation={[0, Math.PI / 4, 0]}>
        <cylinderGeometry args={[0, 0.56, 0.34, 4]} />
        <meshStandardMaterial color={PALETTE.red} {...PLASTIC} />
      </mesh>
      <mesh name="clockHatch" position={[0, 1.28, 0.23]}>
        <boxGeometry args={[0.26, 0.22, 0.03]} />
        <meshStandardMaterial color={PALETTE.ink} roughness={0.5} />
      </mesh>
      <mesh name="clockFace" position={[0, 0.96, 0.23]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.15, 0.15, 0.03, 16]} />
        <meshStandardMaterial color={PALETTE.cream} roughness={0.4} />
      </mesh>
      <mesh name="clockPost" castShadow position={[0, 0.42, 0]}>
        <cylinderGeometry args={[0.07, 0.09, 0.84, 10]} />
        <meshStandardMaterial color={TRIM} {...PLASTIC} />
      </mesh>
      <mesh name="clockWeight" castShadow position={[0.18, 0.6, 0.16]}>
        <coneGeometry args={[0.07, 0.22, 10]} />
        <meshStandardMaterial color={PALETTE.yellow} {...METAL} />
      </mesh>
    </group>
  );
}

/** The bird that lunges out of the hatch. */
export function CuckooBird() {
  return (
    <group name="cuckooBirdProp">
      <mesh name="birdBody" castShadow>
        <sphereGeometry args={[0.13, 12, 10]} />
        <meshStandardMaterial color={PALETTE.blue} {...PLASTIC} />
      </mesh>
      <mesh name="birdBeak" position={[0, -0.01, 0.14]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.05, 0.12, 8]} />
        <meshStandardMaterial color={PALETTE.yellow} {...PLASTIC} />
      </mesh>
      <mesh name="birdTail" position={[0, 0.04, -0.14]} rotation={[-Math.PI / 2.4, 0, 0]}>
        <coneGeometry args={[0.06, 0.14, 6]} />
        <meshStandardMaterial color={PALETTE.purple} {...PLASTIC} />
      </mesh>
    </group>
  );
}

/**
 * Fish bowl: a sphere flattened where it meets the table, a flat waterline
 * inside it and a rim around the opening. The waterline and the rim are what
 * stop it reading as a ball, which is exactly what it used to read as.
 */
export function FishBowl({ radius }: { radius: number }) {
  const bowl = Math.min(0.42, radius * 0.3);
  return (
    <group name="fishBowlProp">
      <mesh name="bowlStand" position={[0, 0.035, 0]}>
        <cylinderGeometry args={[bowl * 0.62, bowl * 0.74, 0.07, 16]} />
        <meshStandardMaterial color={TRIM} {...PLASTIC} />
      </mesh>
      <mesh name="bowlGlass" castShadow position={[0, 0.07 + bowl * 0.86, 0]} scale={[1, 0.92, 1]}>
        <sphereGeometry args={[bowl, 18, 14]} />
        <meshStandardMaterial color={PALETTE.blue} transparent opacity={0.42} roughness={0.1} />
      </mesh>
      <mesh name="bowlWaterline" position={[0, 0.07 + bowl * 1.06, 0]}>
        <cylinderGeometry args={[bowl * 0.86, bowl * 0.86, 0.02, 18]} />
        <meshStandardMaterial color={PALETTE.blue} roughness={0.15} />
      </mesh>
      <mesh
        name="bowlRim"
        position={[0, 0.07 + bowl * 1.58, 0]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <torusGeometry args={[bowl * 0.56, bowl * 0.08, 6, 18]} />
        <meshStandardMaterial color={PALETTE.cream} {...PLASTIC} />
      </mesh>
      <mesh name="bowlFish" position={[bowl * 0.2, 0.07 + bowl * 0.78, 0]} scale={[1, 0.72, 0.5]}>
        <sphereGeometry args={[bowl * 0.26, 10, 8]} />
        <meshStandardMaterial color={PALETTE.orange} {...PLASTIC} />
      </mesh>
      <mesh
        name="bowlFishTail"
        position={[bowl * 0.44, 0.07 + bowl * 0.78, 0]}
        rotation={[0, 0, -Math.PI / 2]}
      >
        <coneGeometry args={[bowl * 0.16, bowl * 0.22, 6]} />
        <meshStandardMaterial color={PALETTE.orange} {...PLASTIC} />
      </mesh>
    </group>
  );
}

/** Two uprights carrying two rails of shoes. */
export function ShoeRack() {
  const shoes = [
    { x: -0.3, y: 0.28, colour: PALETTE.red },
    { x: 0.02, y: 0.28, colour: PALETTE.blue },
    { x: 0.32, y: 0.28, colour: PALETTE.cream },
    { x: -0.2, y: 0.62, colour: PALETTE.green },
    { x: 0.22, y: 0.62, colour: PALETTE.yellow },
  ];
  return (
    <group name="shoeRackProp">
      {[-1, 1].map((side) => (
        <mesh key={side} name={`rackUpright${side}`} castShadow position={[side * 0.44, 0.42, 0]}>
          <boxGeometry args={[0.07, 0.84, 0.07]} />
          <meshStandardMaterial color={PALETTE.muted} {...METAL} />
        </mesh>
      ))}
      {[0.22, 0.56].map((y) => (
        <mesh key={y} name={`rackShelf${y}`} castShadow position={[0, y, 0]}>
          <boxGeometry args={[0.94, 0.05, 0.34]} />
          <meshStandardMaterial color={PALETTE.orange} {...PLASTIC} />
        </mesh>
      ))}
      {shoes.map((shoe) => (
        <mesh key={`${shoe.x}-${shoe.y}`} name={`rackShoe${shoe.x}`} castShadow position={[shoe.x, shoe.y, 0.03]}>
          <boxGeometry args={[0.24, 0.11, 0.12]} />
          <meshStandardMaterial color={shoe.colour} {...SOFT} />
        </mesh>
      ))}
    </group>
  );
}

/** The shoe it throws: a wedge with a sole, which no other prop here is. */
export function ThrownShoe() {
  return (
    <group name="thrownShoeProp">
      <mesh name="shoeUpper" castShadow position={[0, 0.03, 0]}>
        <boxGeometry args={[0.24, 0.1, 0.11]} />
        <meshStandardMaterial color={PALETTE.red} {...SOFT} />
      </mesh>
      <mesh name="shoeSole" position={[0, -0.03, 0]}>
        <boxGeometry args={[0.26, 0.04, 0.12]} />
        <meshStandardMaterial color={PALETTE.cream} {...SOFT} />
      </mesh>
      <mesh name="shoeToe" position={[0.13, 0.005, 0]} scale={[0.7, 1, 1]}>
        <sphereGeometry args={[0.06, 10, 8]} />
        <meshStandardMaterial color={PALETTE.red} {...SOFT} />
      </mesh>
    </group>
  );
}

/** Squat baked potato with a split top. Grabbable, so it reads at hand size. */
export function HotPotato({ radius }: { radius: number }) {
  return (
    <group name="hotPotatoProp">
      <mesh name="potatoBody" castShadow scale={[1.25, 0.78, 0.9]}>
        <sphereGeometry args={[radius, 14, 12]} />
        <meshStandardMaterial color={PALETTE.orange} {...SOFT} />
      </mesh>
      <mesh name="potatoSplit" position={[0, radius * 0.6, 0]} rotation={[0, 0.3, 0]}>
        <boxGeometry args={[radius * 1.7, 0.02, radius * 0.4]} />
        <meshStandardMaterial color={PALETTE.cream} {...SOFT} />
      </mesh>
      <mesh name="potatoLumpA" castShadow position={[-radius * 0.7, radius * 0.2, radius * 0.3]}>
        <sphereGeometry args={[radius * 0.4, 8, 6]} />
        <meshStandardMaterial color={PALETTE.orange} {...SOFT} />
      </mesh>
    </group>
  );
}

/**
 * Hob ring: a metal collar at the eye and a standable middle inside it.
 *
 * NOTHING HERE MAY REACH `flare`. The trap's telegraph is the annulus from eye
 * to flare drawn flat on the deck, and that annulus is the whole fairness of
 * this trap - it is what says the middle is safe and the ring is not. A prop
 * the width of the flare would sit on top of it and paint the warning out, so
 * the collar stops at the eye and the flames are thin enough to see past.
 */
export function HobRing({ eye, flare }: { eye: number; flare: number }) {
  return (
    <group name="hobRingProp">
      <mesh name="hobCentre" receiveShadow position={[0, 0.006, 0]}>
        <cylinderGeometry args={[eye * 0.88, eye * 0.88, 0.012, 24]} />
        <meshStandardMaterial color={PALETTE.cream} {...PLASTIC} />
      </mesh>
      <mesh name="hobCollar" position={[0, 0.012, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[eye, 0.03, 8, 34]} />
        <meshStandardMaterial color={PALETTE.muted} {...METAL} />
      </mesh>
      {[0, 1, 2, 3, 4, 5].map((index) => {
        const angle = (index / 6) * Math.PI * 2;
        return (
          <mesh
            key={index}
            name={`hobBurner${index}`}
            position={[Math.cos(angle) * eye, 0.09, Math.sin(angle) * eye]}
          >
            <coneGeometry args={[0.045, 0.16, 8]} />
            <meshStandardMaterial color={PALETTE.red} roughness={0.3} />
          </mesh>
        );
      })}
      {/* A single trivet leg out at the flare, so the ring's reach still has
          something standing in it without the annulus being covered over. */}
      {[0, 1, 2].map((index) => {
        const angle = (index / 3) * Math.PI * 2 + 0.4;
        return (
          <mesh
            key={`leg${index}`}
            name={`hobTrivet${index}`}
            castShadow
            position={[Math.cos(angle) * flare * 0.86, 0.05, Math.sin(angle) * flare * 0.86]}
          >
            <boxGeometry args={[0.07, 0.1, 0.07]} />
            <meshStandardMaterial color={PALETTE.muted} {...METAL} />
          </mesh>
        );
      })}
    </group>
  );
}

/**
 * A-frame airer, standing the way the trap tests it.
 *
 * Its long axis is Z: the collider is 0.1 across and `span / 2` deep, and the
 * fold test allows AIRER_CATCH_HALF either side in X. An airer drawn across the
 * lane instead of along it points a runner at the wrong half of the trap.
 */
export function ClothesAirer({ span, height }: { span: number; height: number }) {
  const rails = [0.42, 0.62, 0.82];
  return (
    <group name="clothesAirerProp">
      {[-1, 1].map((end) =>
        [-1, 1].map((side) => (
          <mesh
            key={`${end}-${side}`}
            name={`airerLeg${end}${side}`}
            castShadow
            position={[side * 0.18, height / 2, (end * span) / 2]}
            rotation={[0, 0, -side * 0.16]}
          >
            <boxGeometry args={[0.06, height, 0.06]} />
            <meshStandardMaterial color={PALETTE.muted} {...METAL} />
          </mesh>
        )),
      )}
      {rails.map((share) => (
        <mesh
          key={share}
          name={`airerRail${share}`}
          castShadow
          position={[0, height * share, 0]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <cylinderGeometry args={[0.025, 0.025, span, 8]} />
          <meshStandardMaterial color={PALETTE.purple} {...METAL} />
        </mesh>
      ))}
      <mesh name="airerTowel" castShadow position={[0, height * 0.62, -span * 0.24]}>
        <boxGeometry args={[0.03, height * 0.34, span * 0.3]} />
        <meshStandardMaterial color={PALETTE.blue} {...SOFT} />
      </mesh>
      <mesh name="airerShirt" castShadow position={[0, height * 0.42, span * 0.26]}>
        <boxGeometry args={[0.03, height * 0.3, span * 0.26]} />
        <meshStandardMaterial color={PALETTE.yellow} {...SOFT} />
      </mesh>
    </group>
  );
}

/** Fridge door front with a recessed ice chute and a paddle. */
export function IceDispenser() {
  return (
    <group name="iceDispenserProp">
      <mesh name="dispenserDoor" castShadow receiveShadow position={[0, 0.9, 0]}>
        <boxGeometry args={[1, 1.8, 0.34]} />
        <meshStandardMaterial color={PALETTE.cream} {...PLASTIC} />
      </mesh>
      <mesh name="dispenserRecess" position={[0, 1.14, 0.16]}>
        <boxGeometry args={[0.52, 0.6, 0.16]} />
        <meshStandardMaterial color={TRIM} roughness={0.5} />
      </mesh>
      <mesh name="dispenserChute" position={[0, 1.34, 0.2]}>
        <cylinderGeometry args={[0.13, 0.16, 0.12, 14]} />
        <meshStandardMaterial color={PALETTE.muted} {...METAL} />
      </mesh>
      <mesh name="dispenserPaddle" position={[0, 0.98, 0.22]} rotation={[0.3, 0, 0]}>
        <boxGeometry args={[0.32, 0.16, 0.03]} />
        <meshStandardMaterial color={PALETTE.blue} {...PLASTIC} />
      </mesh>
      <mesh name="dispenserHandle" castShadow position={[0.42, 1.1, 0.2]}>
        <boxGeometry args={[0.06, 0.9, 0.06]} />
        <meshStandardMaterial color={PALETTE.muted} {...METAL} />
      </mesh>
    </group>
  );
}

/** The cube it fires: a cube, which is the one shape none of the others is. */
export function IceCube() {
  return (
    <mesh name="iceCubeProp" castShadow>
      <boxGeometry args={[0.17, 0.17, 0.17]} />
      <meshStandardMaterial color={PALETTE.blue} transparent opacity={0.72} roughness={0.12} />
    </mesh>
  );
}

/** Kettle: tapered body, curved-out spout, a lid and a red handle. */
export function Kettle() {
  return (
    <group name="kettleProp">
      <mesh name="kettleBody" castShadow receiveShadow position={[0, 0.28, 0]}>
        <cylinderGeometry args={[0.24, 0.3, 0.56, 18]} />
        <meshStandardMaterial color={PALETTE.muted} {...METAL} />
      </mesh>
      <mesh name="kettleLid" castShadow position={[0, 0.59, 0]}>
        <cylinderGeometry args={[0.2, 0.25, 0.08, 18]} />
        <meshStandardMaterial color={PALETTE.cream} {...METAL} />
      </mesh>
      <mesh name="kettleKnob" position={[0, 0.66, 0]}>
        <sphereGeometry args={[0.05, 10, 8]} />
        <meshStandardMaterial color={PALETTE.red} {...PLASTIC} />
      </mesh>
      <mesh
        name="kettleSpout"
        castShadow
        position={[0, 0.42, 0.28]}
        rotation={[-Math.PI / 3.4, 0, 0]}
      >
        <cylinderGeometry args={[0.05, 0.09, 0.32, 10]} />
        <meshStandardMaterial color={PALETTE.muted} {...METAL} />
      </mesh>
      <mesh
        name="kettleHandle"
        castShadow
        position={[0, 0.58, -0.2]}
        rotation={[Math.PI / 2, 0, Math.PI / 2]}
      >
        <torusGeometry args={[0.17, 0.032, 6, 14, Math.PI]} />
        <meshStandardMaterial color={PALETTE.red} {...PLASTIC} />
      </mesh>
      <mesh name="kettleBase" position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.32, 0.32, 0.04, 18]} />
        <meshStandardMaterial color={TRIM} {...PLASTIC} />
      </mesh>
    </group>
  );
}

/**
 * A drift of swept-up junk. Sized so a unit scale reads as knee-high, because
 * the trap scales this group by how far the drift has grown.
 */
export function JunkDrift() {
  return (
    <group name="junkDriftProp">
      <mesh name="driftHeap" castShadow receiveShadow position={[0, 0.16, 0]} scale={[1, 0.42, 1]}>
        <sphereGeometry args={[0.72, 14, 10]} />
        <meshStandardMaterial color={PALETTE.muted} {...SOFT} />
      </mesh>
      <mesh name="driftCrust" position={[0, 0.24, 0]} scale={[1, 0.34, 1]}>
        <sphereGeometry args={[0.5, 12, 8]} />
        <meshStandardMaterial color={PALETTE.purple} {...SOFT} />
      </mesh>
      <mesh name="driftBox" castShadow position={[-0.3, 0.2, 0.16]} rotation={[0.2, 0.4, -0.3]}>
        <boxGeometry args={[0.26, 0.2, 0.2]} />
        <meshStandardMaterial color={PALETTE.orange} {...PLASTIC} />
      </mesh>
      <mesh name="driftCard" castShadow position={[0.34, 0.24, -0.1]} rotation={[0, -0.5, 0.5]}>
        <boxGeometry args={[0.3, 0.04, 0.22]} />
        <meshStandardMaterial color={PALETTE.cream} {...PLASTIC} />
      </mesh>
      <mesh name="driftBall" castShadow position={[0.12, 0.3, 0.3]}>
        <sphereGeometry args={[0.11, 10, 8]} />
        <meshStandardMaterial color={PALETTE.yellow} {...PLASTIC} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Placement-preview stand-ins for the fourteen traps that build their own prop
// ---------------------------------------------------------------------------
// Read the note at the top of this file first. Each of these matches the
// outline and the colour blocking of the in-play prop named above it, at fewer
// parts, because a preview is looked at while it is dragged rather than run
// past. Restyling one of those props means following it here.

/** Preview of MousetrapTrap in ForceTraps.tsx: orange board, blue snap bar. */
export function MousetrapPreview() {
  return (
    <group name="mousetrapPreview">
      <mesh castShadow position={[0, 0.07, 0]}>
        <boxGeometry args={[1.5, 0.14, 1]} />
        <meshStandardMaterial color={PALETTE.orange} {...SOFT} />
      </mesh>
      <mesh position={[0, 0.145, 0]}>
        <boxGeometry args={[1.42, 0.02, 0.92]} />
        <meshStandardMaterial color={PALETTE.cream} {...PLASTIC} />
      </mesh>
      <mesh position={[0, 0.17, 0.16]}>
        <cylinderGeometry args={[0.19, 0.19, 0.04, 12]} />
        <meshStandardMaterial color={PALETTE.red} {...PLASTIC} />
      </mesh>
      <mesh position={[0, 0.24, 0.16]}>
        <cylinderGeometry args={[0.15, 0.15, 0.1, 10]} />
        <meshStandardMaterial color={PALETTE.yellow} {...PLASTIC} />
      </mesh>
      {[-0.52, 0.52].map((x) => (
        <mesh key={x} castShadow position={[x, 0.36, -0.06]}>
          <boxGeometry args={[0.07, 0.07, 0.64]} />
          <meshStandardMaterial color={PALETTE.blue} {...METAL} />
        </mesh>
      ))}
      <mesh castShadow position={[0, 0.36, -0.38]}>
        <boxGeometry args={[1.11, 0.07, 0.07]} />
        <meshStandardMaterial color={PALETTE.blue} {...METAL} />
      </mesh>
    </group>
  );
}

/** Preview of SprinklerTrap in ForceTraps.tsx: ink base, riser, blue head. */
export function SprinklerPreview() {
  return (
    <group name="sprinklerPreview">
      <mesh position={[0, 0.06, 0]}>
        <cylinderGeometry args={[0.32, 0.36, 0.12, 14]} />
        <meshStandardMaterial color={PALETTE.ink} {...SOFT} />
      </mesh>
      <mesh position={[0, 0.15, 0]}>
        <cylinderGeometry args={[0.16, 0.22, 0.08, 12]} />
        <meshStandardMaterial color={PALETTE.green} {...PLASTIC} />
      </mesh>
      <mesh castShadow position={[0, 0.39, 0]}>
        <cylinderGeometry args={[0.075, 0.085, 0.48, 10]} />
        <meshStandardMaterial color={PALETTE.muted} {...METAL} />
      </mesh>
      <mesh castShadow position={[0, 0.66, 0]}>
        <sphereGeometry args={[0.14, 12, 10]} />
        <meshStandardMaterial color={PALETTE.blue} {...PLASTIC} />
      </mesh>
      <mesh castShadow position={[0, 0.68, 0.19]}>
        <boxGeometry args={[0.08, 0.08, 0.28]} />
        <meshStandardMaterial color={PALETTE.cream} {...PLASTIC} />
      </mesh>
      <mesh position={[0, 0.71, 0.36]} rotation={[Math.PI / 2.6, 0, 0]}>
        <coneGeometry args={[0.08, 0.16, 10]} />
        <meshStandardMaterial color={PALETTE.yellow} {...PLASTIC} />
      </mesh>
    </group>
  );
}

/** Preview of LaundryBasketTrap in ForceTraps.tsx: open cream box, blue rims. */
export function LaundryBasketPreview() {
  return (
    <group name="laundryBasketPreview" position={[0, 0.34, -0.06]} rotation={[0.12, 0, 0]}>
      <mesh position={[0, -0.29, 0]}>
        <boxGeometry args={[0.9, 0.06, 0.7]} />
        <meshStandardMaterial color={PALETTE.cream} {...SOFT} />
      </mesh>
      {[-0.44, 0.44].map((x) => (
        <mesh key={x} castShadow position={[x, 0, 0]}>
          <boxGeometry args={[0.05, 0.62, 0.7]} />
          <meshStandardMaterial color={PALETTE.cream} {...SOFT} />
        </mesh>
      ))}
      {[-0.33, 0.33].map((z) => (
        <mesh key={z} castShadow position={[0, 0.29, z]}>
          <boxGeometry args={[0.94, 0.07, 0.07]} />
          <meshStandardMaterial color={PALETTE.blue} {...SOFT} />
        </mesh>
      ))}
      {[-0.3, -0.1, 0.1, 0.3].map((x) => (
        <mesh key={`slat${x}`} castShadow position={[x, 0, 0.34]}>
          <boxGeometry args={[0.06, 0.58, 0.05]} />
          <meshStandardMaterial color={PALETTE.cream} {...SOFT} />
        </mesh>
      ))}
    </group>
  );
}

/** Preview of MagnetTrap in ForceTraps.tsx: red horseshoe on an ink plinth. */
export function FridgeMagnetPreview() {
  return (
    <group name="fridgeMagnetPreview">
      <mesh position={[0, 0.05, 0]}>
        <boxGeometry args={[1.1, 0.1, 0.5]} />
        <meshStandardMaterial color={PALETTE.ink} {...SOFT} />
      </mesh>
      <mesh castShadow position={[0, 0.62, 0]} rotation={[0, 0, Math.PI]}>
        <torusGeometry args={[0.42, 0.16, 10, 18, Math.PI]} />
        <meshStandardMaterial color={PALETTE.red} {...METAL} />
      </mesh>
      {[-0.42, 0.42].map((x) => (
        <mesh key={x} castShadow position={[x, 0.79, 0]}>
          <cylinderGeometry args={[0.16, 0.16, 0.34, 12]} />
          <meshStandardMaterial color={PALETTE.red} {...METAL} />
        </mesh>
      ))}
      <mesh castShadow position={[-0.42, 1.03, 0]}>
        <cylinderGeometry args={[0.165, 0.165, 0.15, 12]} />
        <meshStandardMaterial color={PALETTE.cream} {...METAL} />
      </mesh>
      <mesh castShadow position={[0.42, 1.03, 0]}>
        <cylinderGeometry args={[0.165, 0.165, 0.15, 12]} />
        <meshStandardMaterial color={PALETTE.blue} {...METAL} />
      </mesh>
    </group>
  );
}

/** Preview of CeilingFanTrap in LauncherTraps.tsx: four orange blades, globe. */
export function CeilingFanPreview() {
  return (
    <group name="ceilingFanPreview" position={[0, 1.5, 0]}>
      {[0, 1, 2, 3].map((index) => (
        <mesh
          key={index}
          castShadow
          position={[
            Math.cos((index * Math.PI) / 2) * 0.72,
            0,
            Math.sin((index * Math.PI) / 2) * 0.72,
          ]}
          rotation={[0.16, (-index * Math.PI) / 2, 0]}
        >
          <boxGeometry args={[0.92, 0.08, 0.38]} />
          <meshStandardMaterial color={PALETTE.orange} {...SOFT} />
        </mesh>
      ))}
      <mesh castShadow>
        <cylinderGeometry args={[0.26, 0.22, 0.2, 12]} />
        <meshStandardMaterial color={PALETTE.cream} {...PLASTIC} />
      </mesh>
      <mesh castShadow position={[0, -0.22, 0]}>
        <sphereGeometry args={[0.24, 12, 10]} />
        <meshStandardMaterial color={PALETTE.yellow} {...PLASTIC} />
      </mesh>
      <mesh position={[0, 0.35, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 0.7, 8]} />
        <meshStandardMaterial color={PALETTE.muted} {...METAL} />
      </mesh>
      <mesh position={[0, 0.7, 0]}>
        <cylinderGeometry args={[0.3, 0.18, 0.14, 12]} />
        <meshStandardMaterial color={PALETTE.muted} {...PLASTIC} />
      </mesh>
    </group>
  );
}

/** The bruised tip of a peel. Matches BANANA_BRUISE in LauncherTraps.tsx. */
const BANANA_BRUISE = "#8a6a3a";

/** Preview of BananaPeelTrap in LauncherTraps.tsx: splayed yellow strips. */
export function BananaPeelPreview() {
  return (
    <group name="bananaPeelPreview">
      <mesh castShadow position={[0, 0.05, 0]} scale={[1, 0.36, 1]}>
        <sphereGeometry args={[0.17, 10, 8]} />
        <meshStandardMaterial color={PALETTE.yellow} {...PLASTIC} />
      </mesh>
      {[0, 1, 2].map((index) => (
        <group key={index} rotation={[0, (index * Math.PI * 2) / 3, 0]}>
          <mesh castShadow position={[0, 0.05, 0.2]} rotation={[-0.32, 0, 0]}>
            <boxGeometry args={[0.14, 0.05, 0.34]} />
            <meshStandardMaterial color={PALETTE.yellow} {...PLASTIC} />
          </mesh>
          <mesh position={[0, 0.12, 0.36]}>
            <boxGeometry args={[0.11, 0.045, 0.07]} />
            <meshStandardMaterial color={BANANA_BRUISE} {...SOFT} />
          </mesh>
        </group>
      ))}
      <mesh castShadow position={[0, 0.12, 0]}>
        <cylinderGeometry args={[0.035, 0.05, 0.12, 6]} />
        <meshStandardMaterial color={BANANA_BRUISE} {...SOFT} />
      </mesh>
    </group>
  );
}

/** Preview of RobotMopTrap in LauncherTraps.tsx: cream disc, red bumper. */
export function RobotMopPreview() {
  return (
    <group name="robotMopPreview" position={[0, 0.12, 0]}>
      <mesh castShadow>
        <cylinderGeometry args={[0.36, 0.34, 0.2, 18]} />
        <meshStandardMaterial color={PALETTE.cream} {...PLASTIC} />
      </mesh>
      <mesh castShadow position={[0, 0.1, 0]}>
        <cylinderGeometry args={[0.26, 0.28, 0.06, 18]} />
        <meshStandardMaterial color={PALETTE.blue} {...PLASTIC} />
      </mesh>
      <mesh position={[0, -0.04, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.36, 0.045, 8, 20]} />
        <meshStandardMaterial color={PALETTE.red} {...SOFT} />
      </mesh>
      <mesh position={[0, 0.035, 0.3]}>
        <sphereGeometry args={[0.06, 10, 8]} />
        <meshStandardMaterial color={PALETTE.green} roughness={0.3} />
      </mesh>
    </group>
  );
}

/** Preview of PaintBucketTrap in NewTraps.tsx: a step ladder under a tin. */
export function PaintBucketPreview() {
  return (
    <group name="paintBucketPreview">
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh castShadow position={[side * 0.29, 0.45, -0.16]} rotation={[0.14, 0, side * 0.12]}>
            <boxGeometry args={[0.07, 0.9, 0.07]} />
            <meshStandardMaterial color={PALETTE.orange} {...SOFT} />
          </mesh>
          <mesh castShadow position={[side * 0.29, 0.45, 0.2]} rotation={[-0.18, 0, side * 0.12]}>
            <boxGeometry args={[0.06, 0.9, 0.06]} />
            <meshStandardMaterial color={PALETTE.orange} {...SOFT} />
          </mesh>
        </group>
      ))}
      {[0.3, 0.62].map((height) => (
        <mesh key={height} position={[0, height, -0.1]}>
          <boxGeometry args={[0.62, 0.05, 0.16]} />
          <meshStandardMaterial color={PALETTE.cream} {...SOFT} />
        </mesh>
      ))}
      <mesh castShadow position={[0, 0.9, 0]}>
        <boxGeometry args={[0.72, 0.07, 0.44]} />
        <meshStandardMaterial color={PALETTE.cream} {...SOFT} />
      </mesh>
      <mesh castShadow position={[0, 1.05, 0]}>
        <cylinderGeometry args={[0.19, 0.163, 0.24, 14]} />
        <meshStandardMaterial color={PALETTE.cream} {...METAL} />
      </mesh>
      <mesh position={[0, 1.01, 0]}>
        <cylinderGeometry args={[0.194, 0.167, 0.16, 14]} />
        <meshStandardMaterial color={PALETTE.red} {...PLASTIC} />
      </mesh>
      <mesh position={[0, 1.14, 0]}>
        <cylinderGeometry args={[0.171, 0.171, 0.04, 14]} />
        <meshStandardMaterial color={PALETTE.red} roughness={0.35} />
      </mesh>
      <mesh position={[0, 1.17, 0]} rotation={[0, 0, Math.PI]}>
        <torusGeometry args={[0.175, 0.022, 6, 14, Math.PI]} />
        <meshStandardMaterial color={PALETTE.muted} {...METAL} />
      </mesh>
    </group>
  );
}

/** Preview of SpinCycleTrap in NewTraps.tsx: cream cabinet with a dark port. */
export function SpinCyclePreview() {
  return (
    <group name="spinCyclePreview">
      <mesh castShadow position={[0, 0.52, 0]}>
        <boxGeometry args={[0.88, 1.04, 0.84]} />
        <meshStandardMaterial color={PALETTE.cream} {...PLASTIC} />
      </mesh>
      <mesh position={[0, 0.52, 0.44]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.27, 0.27, 0.05, 20]} />
        <meshStandardMaterial color={TRIM} {...PLASTIC} />
      </mesh>
      <mesh position={[0, 0.52, 0.46]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.21, 0.21, 0.03, 20]} />
        <meshStandardMaterial color={PALETTE.blue} roughness={0.25} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 0.22, 0.89, 0.44]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.06, 0.06, 0.04, 10]} />
          <meshStandardMaterial color={side < 0 ? PALETTE.red : PALETTE.yellow} roughness={0.6} />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh key={`foot${side}`} position={[side * 0.31, 0.03, 0]}>
          <boxGeometry args={[0.16, 0.06, 0.76]} />
          <meshStandardMaterial color={PALETTE.ink} {...SOFT} />
        </mesh>
      ))}
    </group>
  );
}

/** The gum a shoe has been on. Matches GUM_PINK in NewTraps.tsx. */
const GUM_PINK = "#ff9bd0";

/** Preview of StickyGumTrap in NewTraps.tsx: a pink splat with strands. */
export function StickyGumPreview({ radius }: { radius: number }) {
  return (
    <group name="stickyGumPreview">
      <mesh position={[0, 0.02, 0]} scale={[1, 0.1, 1]}>
        <sphereGeometry args={[radius, 20, 10]} />
        <meshStandardMaterial color={GUM_PINK} roughness={0.4} />
      </mesh>
      {[0, 1, 2, 3, 4].map((index) => (
        <mesh
          key={index}
          position={[
            Math.sin((index * Math.PI * 2) / 5) * radius * 0.36,
            0.08,
            Math.cos((index * Math.PI * 2) / 5) * radius * 0.36,
          ]}
        >
          <cylinderGeometry args={[0.012, 0.03, 0.12, 5]} />
          <meshStandardMaterial color={GUM_PINK} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

/** Preview of CordTripTrap in NewTraps.tsx: a lamp at each end of a flex. */
export function CordTripPreview({ span }: { span: number }) {
  return (
    <group name="cordTripPreview">
      <mesh position={[-span / 2, 0.06, 0]}>
        <boxGeometry args={[0.26, 0.12, 0.2]} />
        <meshStandardMaterial color={PALETTE.cream} {...PLASTIC} />
      </mesh>
      <mesh position={[span / 2, 0.06, 0]}>
        <cylinderGeometry args={[0.24, 0.28, 0.12, 14]} />
        <meshStandardMaterial color={PALETTE.muted} {...METAL} />
      </mesh>
      <mesh castShadow position={[span / 2, 0.34, 0]}>
        <cylinderGeometry args={[0.04, 0.05, 0.68, 10]} />
        <meshStandardMaterial color={PALETTE.muted} {...METAL} />
      </mesh>
      <mesh castShadow position={[span / 2, 0.78, 0]}>
        <cylinderGeometry args={[0.16, 0.24, 0.26, 14, 1, true]} />
        <meshStandardMaterial color={PALETTE.yellow} side={2} {...SOFT} />
      </mesh>
      <mesh position={[0, 0.16, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.03, 0.03, span, 6]} />
        <meshStandardMaterial color={PALETTE.ink} {...PLASTIC} />
      </mesh>
    </group>
  );
}

/** Preview of DrawerSlamTrap in NewTraps.tsx: an orange drawer, cream face. */
export function DrawerSlamPreview() {
  return (
    <group name="drawerSlamPreview" position={[0, 0.3, 0]}>
      <mesh castShadow>
        <boxGeometry args={[0.9, 0.36, 0.62]} />
        <meshStandardMaterial color={PALETTE.orange} {...SOFT} />
      </mesh>
      <mesh castShadow position={[0, 0, 0.31]}>
        <boxGeometry args={[0.95, 0.4, 0.06]} />
        <meshStandardMaterial color={PALETTE.cream} {...PLASTIC} />
      </mesh>
      <mesh castShadow position={[0, 0, 0.39]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.03, 0.03, 0.54, 8]} />
        <meshStandardMaterial color={PALETTE.muted} {...METAL} />
      </mesh>
      {[-0.24, 0, 0.24].map((x) => (
        <mesh key={x} position={[x, 0.13, 0]} rotation={[0, x * 2, 0]}>
          <boxGeometry args={[0.05, 0.03, 0.46]} />
          <meshStandardMaterial color={PALETTE.muted} roughness={0.35} metalness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

/** Preview of RugPullTrap in NewTraps.tsx: purple pile, yellow border, fringe. */
export function RugPullPreview({ halfX, halfZ }: { halfX: number; halfZ: number }) {
  return (
    <group name="rugPullPreview">
      <mesh position={[0, 0.01, 0]}>
        <boxGeometry args={[halfX * 2, 0.02, halfZ * 2]} />
        <meshStandardMaterial color={PALETTE.purple} {...SOFT} />
      </mesh>
      <mesh position={[0, 0.022, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[halfZ * 0.62, halfZ * 0.82, 4, 1]} />
        <meshStandardMaterial color={PALETTE.yellow} {...SOFT} />
      </mesh>
      <mesh position={[0, 0.024, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[halfZ * 0.38, 18]} />
        <meshStandardMaterial color={PALETTE.cream} {...SOFT} />
      </mesh>
      {[-1, 1].map((side) =>
        [0, 1, 2, 3, 4, 5, 6, 7, 8].map((index) => (
          <mesh
            key={`${side}-${index}`}
            position={[-halfX * 0.9 + (index / 8) * halfX * 1.8, 0.012, side * (halfZ + 0.05)]}
          >
            <boxGeometry args={[0.05, 0.012, 0.1]} />
            <meshStandardMaterial color={PALETTE.cream} {...SOFT} />
          </mesh>
        )),
      )}
    </group>
  );
}
