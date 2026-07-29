"use client";

import type { ThreeElements } from "@react-three/fiber";
import { useEffect, useMemo, type RefObject } from "react";
import * as THREE from "three";
import { createApartmentFloorFanModel } from "./models/createFloorFanModel";
import { createApartmentToiletModel } from "./models/createToiletModel";
import { createApartmentSpringJumpPadModel } from "./models/createSpringModel";
import { createRobotMopModel } from "./models/createMopModel";
import { createApartmentToasterModel } from "./models/createToasterModel";
import { createApartmentSoapDishModel } from "./models/createSoapDishModel";
import { createApartmentBeachBallModel } from "./models/createBeachBallModel";
import { createApartmentRefrigeratorModel } from "./models/createRefrigeratorModel";
import { createApartmentClawHammerOnWallBracketModel } from "./models/createHammerModel";
import { createApartmentCanisterVacuumModel } from "./models/createVacuumModel";

export type ModelName =
  | "hammer"
  | "refrigerator"
  | "fan"
  | "soap"
  | "spring"
  | "toilet"
  | "ball"
  | "vacuum"
  | "toaster"
  | "mop";

interface Props extends Omit<ThreeElements["group"], "children"> {
  model: ModelName;
}

// Built by the img2threejs pipeline as an imperative factory rather than a
// component. Two things matter here:
//
// 1. The factory defaults to 1024px maps at reference fidelity, which
//    rasterises four materials x five procedural maps per call. That is around
//    21 megapixels of CPU-side noise for a prop the size of a toaster, and it
//    would run again for every instance.
// 2. sculptRuntime holds circular Object3D references in userData, so cloning
//    the root as-built throws. Stripping userData first makes it clonable.
//
// So build one template per session at a size that suits a game prop and clone
// it, sharing geometry and materials across every instance.
const templates = new Map<string, THREE.Group>();

function prototypeOf(id: string, build: () => THREE.Group): THREE.Group {
  let template = templates.get(id);
  if (!template) {
    template = build();
    template.traverse((node) => {
      node.userData = {};
    });
    templates.set(id, template);
  }
  return template;
}

/**
 * One sculpted prop, built once per session and cloned per instance.
 *
 * `build` is deliberately not a dependency of the memo: the id identifies the
 * template, and an inline arrow would otherwise rebuild on every render.
 *
 * `fitHeight` exists because a sculpt is authored to look right on its own, not
 * to match the prop it replaces, and the two need not agree. It is applied only
 * where a measurement said it was needed. Nothing needs it today: the beach ball
 * matches its call site (1.50u across, centred on its origin, which is what
 * `position={[0, -0.75, 0]}` in TrapRenderer expects), the soap dish matches
 * DISH_WIDTH, and the refrigerator and the claw hammer were both authored
 * straight into the envelope their call site fixes.
 */
function Sculpted({
  id,
  build,
  fitHeight,
}: {
  id: string;
  build: () => THREE.Group;
  fitHeight?: number;
}) {
  const model = useMemo(() => {
    const clone = prototypeOf(id, build).clone(true);
    if (fitHeight !== undefined) {
      const size = new THREE.Box3().setFromObject(clone).getSize(new THREE.Vector3());
      if (size.y > 0) clone.scale.setScalar(fitHeight / size.y);
    }
    return clone;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, fitHeight]);
  return <primitive object={model} />;
}

const SCULPT_OPTIONS = { textureSize: 256, qualityPriority: "balanced" } as const;

const ProceduralToaster = () => (
  <Sculpted id="toaster" build={() => createApartmentToasterModel(SCULPT_OPTIONS)} />
);
// The reference frames the claw hammer on a wall bracket, so the sculpt builds one:
// plate, arm, pivot boss, clamp collar, lug and bolt. The swinging hammer draws its own
// pendulum rig, and shipping the bracket visible would put two mounting systems on one
// prop, so it is hidden here rather than deleted from the spec. destructionGroups holds
// the whole chain as one array, which is what makes that a single call.
//
// No fitHeight. The sculpt measures 2.20u along its own +Y, butt at the origin, which is
// the span the hand-authored hammer it replaces occupied and what the [0, -2.25, 0]
// mount in TrapRenderer expects. tests/unit/sculpted-props.test.ts pins that.
function buildHammer(): THREE.Group {
  const model = createApartmentClawHammerOnWallBracketModel(SCULPT_OPTIONS);
  const runtime = model.userData.sculptRuntime as
    | { destructionGroups?: Record<string, THREE.Object3D[]> }
    | undefined;
  const bracket = runtime?.destructionGroups?.bracket;
  if (!bracket?.length) {
    // prototypeOf strips userData straight after this, so a silent miss here would ship
    // a hammer with a wall bracket bolted through the pendulum arm and no way to tell.
    console.warn("hammer sculpt: no 'bracket' destruction group, wall mount will render");
  }
  for (const node of bracket ?? []) node.visible = false;
  return model;
}
const SculptedHammer = () => <Sculpted id="hammer" build={buildHammer} />;
const SculptedSoapDish = () => (
  <Sculpted id="soap" build={() => createApartmentSoapDishModel(SCULPT_OPTIONS)} />
);
const SculptedBeachBall = () => (
  <Sculpted id="ball" build={() => createApartmentBeachBallModel(SCULPT_OPTIONS)} />
);
// No fitHeight, for the refrigerator's reason: the toilet sculpt was authored into the
// envelope its trap collider fixes, not at the reference's own proportions. HEIGHT is 0.90,
// exactly the collider's 0.45 half-extent doubled, and the prop measures
// 0.976 x 0.9000 x 0.98 seated on y = 0 inside CuboidCollider args={[0.52, 0.45, 0.5]} at
// the [0, -0.45, 0] mount. tests/unit/sculpted-props.test.ts pins that.
const SculptedToilet = () => (
  <Sculpted id="toilet" build={() => createApartmentToiletModel(SCULPT_OPTIONS)} />
);
// No fitHeight. The refrigerator sculpt was authored straight into the envelope its
// trap collider fixes rather than at the reference's own proportions, because the two
// disagree: the reference cabinet's front face is 1.79 times its width and the collider
// is a box 1.34 by 1.84 by 0.96. Measured, it is 1.34 x 1.84 x 0.8866 sitting on y = 0,
// so every part is inside CuboidCollider args={[0.68, 0.92, 0.48]} at the [0, -0.92, 0]
// mount, trim included. tests/unit/sculpted-props.test.ts pins that.
const SculptedRefrigerator = () => (
  <Sculpted id="refrigerator" build={() => createApartmentRefrigeratorModel(SCULPT_OPTIONS)} />
);
// No fitHeight, for the toilet's and refrigerator's reason: the sculpt is authored into the
// envelope its trap collider fixes. Measured, it is 0.8486 x 0.6225 x 0.8742 seated on y = 0
// inside CuboidCollider args={[0.5, 0.55, 0.45]} at the [0, -0.55, 0] mount, hose and wheels
// included. Replacing the hand-authored vacuum FIXES a containment breach rather than risking
// one: that prop's hose ran out to x -1.42 and z 0.70, far outside the box that kills the
// player.
//
// The box is about 43 percent empty in height, because a canister vacuum measures 0.63 as
// tall as it is wide and stretching it would destroy the measured proportion that is its
// identity. That gap is recorded in the spec's fairness note and feeds a queued collider-trim
// decision; it is not a number to tune here.
//
// TWO THINGS ARE HONESTLY OUTSTANDING and neither is hidden by shipping this. The hose passes
// through itself once on its descent to the cuff - measured at 0.42 of the tube radius,
// visible in the render as a crease - and removing it needs a route change that is a design
// decision, so it is recorded in the spec's risks. And the structural pass was NOT reviewed:
// it has renders but no comparison sheet, feature or layer scores, and no reviewHistory entry
// was written for a review that did not happen.
const SculptedVacuum = () => (
  <Sculpted id="vacuum" build={() => createApartmentCanisterVacuumModel(SCULPT_OPTIONS)} />
);
// No fitHeight. The jump pad is the one prop whose envelope comes from a trigger rather than
// a collider: TrapRenderer's Spring launches on |dx| < 0.7 and |dz| < 0.7 with no collider at
// all, and PLAYER.stepAssistHeight is 0.45, the tallest riser the controller lifts the runner
// over. So the sculpt is authored at exactly 1.40 x 0.45 x 1.40, floor-centred, which is what
// the [0, -0.18, 0] mount inside a group at trap.position.y + 0.18 stands on the deck.
//
// The reference is a stool as tall as it is wide. Fitting it cost 68.5% of its height, which is
// the largest reference deviation in this prop set and is recorded in the spec rather than
// presented as a match; the preview harness renders its review pass at yscale 3.18 to undo
// exactly that squash so the Tier-1 aspect gate scores shape.
// tests/unit/sculpted-props.test.ts pins both numbers.
const SculptedJumpPad = () => (
  <Sculpted id="spring" build={() => createApartmentSpringJumpPadModel(SCULPT_OPTIONS)} />
);
// No fitHeight. Measured 0.72 x 0.1635 x 0.7196 sitting on y = 0, so its radius is exactly
// MOP_RADIUS and it clears MOP_HALF_HEIGHT: LauncherTraps mounts it at [0, -MOP_HALF_HEIGHT, 0]
// because the trap's RigidBody origin is the shell CENTRE while the sculpt sits on its own
// base, which puts every part inside CylinderCollider args={[0.1, 0.36]}.
//
// The factory had no caller at all until now, while two tests asserted its fit. Its spinning
// brushes are NOT part of the sculpt: the reference has a revolved microfibre skirt instead,
// and a solid of revolution shows nothing when it turns. LauncherTraps therefore keeps its own
// brush ring under this, which is what carries the rotation.
const SculptedRobotMop = () => (
  <Sculpted id="mop" build={() => createRobotMopModel(SCULPT_OPTIONS)} />
);
// No fitHeight. Measured 0.9393 x 1.3001 x 0.679 sitting on y = 0, which is what the
// [0, -0.65, 0] mount under TrapRenderer's CuboidCollider expects.
//
// The fan is the one sculpt with a moving part: TrapRenderer spins its blade rosette
// every frame through bladesRef. `Sculpted` cannot carry that, so this clones the
// template itself and recovers the pivot BY NAME - prototypeOf strips userData, so the
// factory's sculptRuntime node map does not survive into the template, but node names
// do. tests/unit/sculpted-props.test.ts pins that "blades__pivot" exists, spins free of
// the cage, and carries the "blades" mesh.
export function SculptedFloorFan({
  bladesRef,
}: {
  bladesRef?: RefObject<THREE.Group | null>;
}) {
  const model = useMemo(
    () => prototypeOf("fan", () => createApartmentFloorFanModel(SCULPT_OPTIONS)).clone(true),
    [],
  );
  useEffect(() => {
    if (!bladesRef) return;
    bladesRef.current =
      (model.getObjectByName("blades__pivot") as THREE.Group | undefined) ?? null;
    return () => {
      bladesRef.current = null;
    };
  }, [bladesRef, model]);
  return <primitive object={model} />;
}

export function AssetReadinessGate({ onReady }: { onReady(): void }) {
  // Props are authored in code now, so nothing has to decode before play. The
  // gate is kept because callers depend on it and a future streamed asset
  // would need somewhere to suspend.
  useEffect(() => {
    onReady();
  }, [onReady]);
  return null;
}

// Every prop is now authored in code. The seven CC BY Sketchfab GLBs this
// replaced are gone from the runtime, which drops seven network fetches and
// leaves the build with no third-party art to attribute.
// The fan accepts an optional ref so a caller can spin its blade group; every
// other prop takes no props, hence the loose component signature here.
// Sculpted entries come from the img2threejs pipeline; the rest are still the
// hand-authored components and are the remaining work on this map.
const PROCEDURAL: Record<ModelName, React.ComponentType> = {
  hammer: SculptedHammer,
  refrigerator: SculptedRefrigerator,
  fan: SculptedFloorFan,
  soap: SculptedSoapDish,
  spring: SculptedJumpPad,
  toilet: SculptedToilet,
  ball: SculptedBeachBall,
  vacuum: SculptedVacuum,
  toaster: ProceduralToaster,
  mop: SculptedRobotMop,
};

export function AssetModel({ model, ...props }: Props) {
  const Prop = PROCEDURAL[model];
  return (
    <group {...props}>
      <Prop />
    </group>
  );
}
