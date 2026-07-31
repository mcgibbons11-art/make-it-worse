"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { resolveAvatar, type AvatarConfig } from "@/lib/game/avatar";
import { PALETTE, PLAYER } from "@/lib/game/constants";
import { useSettingsStore } from "@/stores/settings-store";
import { createMAKEITWORSERunnerModel } from "./models/createRunnerModel";
import { attachWardrobe } from "./models/createWardrobeModels";

export interface PlayerMotionState {
  speed: number;
  verticalVelocity: number;
  grounded: boolean;
  yaw: number;
  stunned: boolean;
}

export type PlayerPose = "idle" | "playing" | "victory" | "failure";

/**
 * Built once per session and cloned per instance, for the same two reasons the
 * toaster is: the factory rasterises several procedural maps per material, and
 * doing that per runner (player, ghost, intro preview) would repeat the whole
 * cost. userData is stripped first because it carries the sculpt runtime's
 * circular Object3D references, which make clone() throw.
 */
let template: THREE.Group | null = null;

/** What the physics capsule occupies, which is what the visual has to match. */
const TARGET_HEIGHT = (PLAYER.capsuleHalfHeight + PLAYER.capsuleRadius) * 2;

/** How far the soles sit below the body origin, which is the capsule's centre. */
const SOLE_DROP = PLAYER.capsuleHalfHeight + PLAYER.capsuleRadius;

/**
 * Fit the factory's model to the play space.
 *
 * The sculpt pipeline authors in its own frame - the current model measures
 * 2.56u tall around a centred origin - because it is built to be reviewed
 * against a reference image, not to stand on a platform. Normalising here
 * rather than demanding the factory emit game units means every future pass of
 * the pipeline drops straight in: if a later pass changes the proportions, this
 * re-fits it instead of silently shipping a runner that floats or sinks.
 *
 * Scale is uniform, so the reviewed proportions are preserved exactly; only the
 * overall size and the origin move.
 */
function fitToPlaySpace(model: THREE.Group): THREE.Group {
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (!(size.y > 0)) return model;
  const wrapper = new THREE.Group();
  const scale = TARGET_HEIGHT / size.y;
  model.scale.setScalar(scale);
  // Drop the soles onto the capsule's base, not onto the body origin.
  //
  // A Rapier capsule is positioned by its CENTRE, so its lowest point sits
  // halfHeight + radius below the rigid body's origin - 0.93u here. Standing
  // the model's feet at local zero therefore left the runner hovering most of a
  // jump height above the floor he was supposedly touching, which also made
  // every jump read as far shorter than it was: he was already airborne.
  model.position.set(
    -((box.min.x + box.max.x) / 2) * scale,
    -box.min.y * scale - SOLE_DROP,
    -((box.min.z + box.max.z) / 2) * scale,
  );
  wrapper.add(model);
  return wrapper;
}

function runnerPrototype(): THREE.Group {
  if (!template) {
    const built = createMAKEITWORSERunnerModel({
      textureSize: 256,
      qualityPriority: "balanced",
    });
    built.traverse((node) => {
      node.userData = {};
    });
    template = fitToPlaySpace(built);
  }
  return template;
}

/**
 * The exact model the game renders, exposed so the silhouette test measures
 * what a player sees rather than the factory's unfitted output.
 */
export function buildRunnerForTest(): THREE.Group {
  const built = createMAKEITWORSERunnerModel({
    textureSize: 64,
    qualityPriority: "balanced",
  });
  return fitToPlaySpace(built);
}

/**
 * A runner cloned from the shared template, painted and dressed.
 *
 * Exported because the picker shows the same figure. A preview assembled by its
 * own code is a preview that can disagree with the game, and disagreeing is the
 * whole failure it exists to prevent - the player has to be choosing the runner
 * they will actually get. Sharing the template also means opening the wardrobe
 * costs no second bake of the procedural maps.
 */
export function dressRunner(
  avatar: AvatarConfig | null,
  avatarSeed: number,
  ghost = false,
): THREE.Group {
  const clone = runnerPrototype().clone(true);
  const look = resolveAvatar(avatar, avatarSeed);
  // The old sculpt cap is no longer the hidden default under every hat. Hair
  // is now a real wardrobe slot with twenty generated styles, including the
  // classic crop, so the baked cap stays off for every combination.
  const stockHair = clone.getObjectByName("Hair cap__pivot");
  if (stockHair) stockHair.visible = false;
  // The sculpt's shoulder caps are the sleeves of its baked-in purple shirt,
  // not anatomy. Real tops author their own sleeves; leaving these underneath
  // made Top: None look like a shirt and made sleeveless tops grow T-shirt
  // cuffs. The torso, arms and legs now share the chosen body colour, so None
  // is genuinely the unclothed character instead of a permanent shirt/pants
  // outfit hiding below every wardrobe option.
  clone.getObjectByName("Shoulder cap left__pivot")?.removeFromParent();
  clone.getObjectByName("Shoulder cap right__pivot")?.removeFromParent();
  // The baked shoulder straps belong to the daypack, not to every object that
  // happens to occupy the Back slot. They looked like unrelated base gear over
  // capes, wings, bedrolls, and jetpacks.
  const showPackStraps = look.backpack === "daypack";
  const leftPackStrap = clone.getObjectByName("Backpack strap left__pivot");
  const rightPackStrap = clone.getObjectByName("Backpack strap right__pivot");
  if (leftPackStrap) leftPackStrap.visible = showPackStraps;
  if (rightPackStrap) rightPackStrap.visible = showPackStraps;
  // The original sculpt's dark outsole blocks read as unrelated black pads
  // under bare feet. Wardrobe footwear authors complete soles of its own.
  const leftStockSole = clone.getObjectByName("Sole left");
  const rightStockSole = clone.getObjectByName("Sole right");
  if (leftStockSole) leftStockSole.visible = false;
  if (rightStockSole) rightStockSole.visible = false;
  // Sandals are complete replacements with an authored foot, footbed and
  // straps. Leaving the baked closed sneaker underneath made them closed shoes
  // with bars laid over the top.
  if (["none", "sandal", "socks"].includes(look.footwear)) {
    const leftStockShoe = clone.getObjectByName("Sneaker left");
    const rightStockShoe = clone.getObjectByName("Sneaker right");
    if (leftStockShoe) leftStockShoe.visible = false;
    if (rightStockShoe) rightStockShoe.visible = false;
  }
  // The ghost must never land on the player's own colour - the two share
  // createdByAvatarSeed - and must read as "the ghost" on every replay, so it
  // takes one fixed hue rather than a second seed-derived pick.
  if (ghost) {
    tint(clone, BODY_MATERIAL, PALETTE.ghost);
    tint(clone, PACK_MATERIAL, PALETTE.ghost);
  } else {
    // Driven by the resolved look's own map rather than by the two ids
    // directly, because the wardrobe repaints a third: choosing footwear
    // recolours the sculpt's own sneaker, so the shoe becomes part of the boot
    // instead of a cream shoe wearing a coloured shell.
    for (const [id, color] of Object.entries(look.sculptTints)) tint(clone, id, color);
  }
  // Dressed before the ghost pass below, so a ghost's clothes fade with the
  // rest of it instead of hanging in the air at full opacity.
  const missing = attachWardrobe(clone, look);
  if (missing.length > 0)
    console.warn(
      `[wardrobe] the runner has no socket named ${missing.join(", ")}; those garments are not on screen`,
    );
  if (ghost)
    clone.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const next = (mesh.material as THREE.Material).clone();
      next.transparent = true;
      next.opacity = 0.3;
      // Twenty-odd transparent sub-meshes self-sort by centroid and punch
      // holes through each other unless they stop writing depth.
      next.depthWrite = false;
      mesh.material = next;
    });
  else addInkOutline(clone);
  return clone;
}

/**
 * Every joint the cycle drives.
 *
 * `body` and `pelvis` are the two group nodes the factory emits above the
 * limbs, and they matter because `torso` carries only the shirt mesh: twisting
 * that moved the shirt while the arms joined to it stayed put, so the upper
 * body never actually answered the legs. `body` carries the shirt, both arms,
 * both shoulder caps and the neck together, which is what a spine has to move.
 */
const PIVOTS = {
  leftArm: "Arm left__pivot",
  rightArm: "Arm right__pivot",
  leftHand: "Hand left__pivot",
  rightHand: "Hand right__pivot",
  leftLeg: "Leg left__pivot",
  rightLeg: "Leg right__pivot",
  leftFoot: "Sneaker left__pivot",
  rightFoot: "Sneaker right__pivot",
  // The outsole is hung off the leg rather than off the shoe it belongs to, so
  // that the shoe's dimension scale cannot cascade into it. Nothing else in the
  // sculpt shares that arrangement, and it means an ankle driven on the shoe
  // alone swings the upper off a sole left standing on the deck. Both halves
  // are driven here, the sole about the ankle rather than about its own origin.
  leftSole: "Sole left__pivot",
  rightSole: "Sole right__pivot",
  head: "Head mass__pivot",
  body: "Body mass__pivot",
  pelvis: "Leg mass__pivot",
  torso: "Torso__pivot",
} as const;
type PivotKey = keyof typeof PIVOTS;

/** Left and right, as literals, so the tuple channels below index cleanly. */
const SIDES = [0, 1] as const;

/**
 * Which sculpt material each avatar colour repaints.
 *
 * Matched on the material's own id rather than on mesh names, because the
 * factory already groups the parts correctly: torso-purple covers the torso,
 * both arms AND both shoulder caps, which a name list silently missed. The id
 * lives on the material rather than the node, so it survives the userData strip
 * that makes the template clonable.
 */
const BODY_MATERIAL = "torso-purple";
const PACK_MATERIAL = "strap-coral";

const RUNNER_OUTLINE_MATERIAL = new THREE.MeshBasicMaterial({
  color: PALETTE.ink,
  side: THREE.BackSide,
  toneMapped: false,
});

/**
 * Every player color remains selectable, including Cream and Butter. A thin
 * invariant ink shell keeps those pale bodies and garments readable against a
 * similarly pale course without taking the colors away from the player.
 */
function addInkOutline(root: THREE.Object3D) {
  const meshes: THREE.Mesh[] = [];
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh && mesh.visible && !mesh.name.endsWith("__ink-outline"))
      meshes.push(mesh);
  });
  for (const mesh of meshes) {
    const outline = new THREE.Mesh(mesh.geometry, RUNNER_OUTLINE_MATERIAL);
    outline.name = `${mesh.name || "runner-part"}__ink-outline`;
    outline.scale.setScalar(1.035);
    outline.raycast = () => undefined;
    outline.castShadow = false;
    outline.receiveShadow = false;
    mesh.add(outline);
  }
}

function materialId(material: THREE.Material): string | null {
  const sculpt = (material.userData as { sculptMaterial?: { id?: string } } | undefined)
    ?.sculptMaterial;
  return sculpt?.id ?? null;
}

function tint(root: THREE.Object3D, id: string, color: string) {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const current = mesh.material as THREE.Material;
    if (materialId(current) !== id) return;
    // clone() shares materials with the template, so recolouring in place would
    // repaint every runner on screen, the ghost included.
    const next = current.clone() as THREE.MeshStandardMaterial;
    next.color = new THREE.Color(color);
    // The albedo map has to go with it, because three multiplies the two. The
    // sculpt factory paints that map from the material's own baked palette -
    // #8e67d8 on the torso, #f18979 on the straps - so every chosen colour was
    // arriving multiplied by a purple or a coral. Moss came out muddy black and
    // a cream pack came out coral, and the contrast ratios avatar.ts measures
    // and prints described a colour that was never on screen. Dropping the map
    // costs the 5% tonal drift the spec records as this material's entire
    // albedo variance; the roughness, normal and ambient occlusion fields are
    // authored independently and all three stay.
    next.map = null;
    next.needsUpdate = true;
    mesh.material = next;
  });
}

/* -------------------------------------------------------------------------- */
/*  Skeleton measurements                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The lengths the gait solves against, read off the fitted model rather than
 * written down.
 *
 * Where a foot lands, how far the body drops onto it and how far a leg may
 * reach before it would tear out of its trouser are all functions of these.
 * The sculpt is regenerated by its own pipeline, and a pass that changed the
 * leg proportions would silently invalidate any constant copied out of it, so
 * they are measured on the same model the player sees.
 */
export interface RunnerLimbs {
  /** Hip pivot to ankle pivot: the length of the single rigid segment the leg
   *  is, as a straight line rather than as a drop. */
  hipToAnkle: number;
  /** How far that segment is already tilted at rest. The sculpt does not hang
   *  the ankle straight under the hip - it stands 0.06u forward of it - and
   *  treating the leg as a plumb line put the foot through the deck by most of
   *  that on every backswing. */
  hipTilt: number;
  /** The foot's fore-aft offset at rest, which the stride is centred on. */
  ankleRestAhead: number;
  /** Ankle pivot down to the underside of the sole. */
  ankleToSole: number;
  /** Ankle pivot out to toe and to heel: the levers the foot rocks over. */
  footToe: number;
  footHeel: number;
  /** Each hip's offset from the centre line, so pelvis rotation and the weight
   *  shift resolve without assuming which way round the sculpt is built. */
  hipSideX: readonly [number, number];
  /** Waist pivot up to the head pivot; the head is a sibling, not a child. */
  headAboveWaist: number;
}

/**
 * Measure the fitted model. Returns null when the sculpt does not expose the
 * joints the cycle needs, in which case the runner stands still rather than
 * being animated against invented lengths.
 *
 * Only differences between world positions are used, so this reads the same on
 * the bare template as on an instance that has already been placed in a level.
 */
export function measureRunnerLimbs(model: THREE.Object3D): RunnerLimbs | null {
  model.updateMatrixWorld(true);
  const hipLeftNode = model.getObjectByName(PIVOTS.leftLeg);
  const hipRightNode = model.getObjectByName(PIVOTS.rightLeg);
  const ankleNode = model.getObjectByName(PIVOTS.leftFoot);
  const soleNode = model.getObjectByName(PIVOTS.leftSole);
  const waistNode = model.getObjectByName(PIVOTS.body);
  const headNode = model.getObjectByName(PIVOTS.head);
  if (!hipLeftNode || !hipRightNode || !ankleNode || !soleNode || !waistNode || !headNode)
    return null;

  const point = new THREE.Vector3();
  const at = (node: THREE.Object3D) => point.setFromMatrixPosition(node.matrixWorld).clone();
  const hipLeft = at(hipLeftNode);
  const hipRight = at(hipRightNode);
  const ankle = at(ankleNode);
  const foot = new THREE.Box3().setFromObject(ankleNode);
  foot.union(new THREE.Box3().setFromObject(soleNode));
  const drop = hipLeft.y - ankle.y;
  const ahead = ankle.z - hipLeft.z;
  const ankleToSole = ankle.y - foot.min.y;
  if (!(drop > 0) || !(ankleToSole > 0)) return null;
  const halfStance = (hipLeft.x - hipRight.x) / 2;
  return {
    hipToAnkle: Math.hypot(drop, ahead),
    hipTilt: Math.atan2(ahead, drop),
    ankleRestAhead: ahead,
    ankleToSole,
    // The levers the foot rocks over, taken from the ankle rather than from the
    // middle of the shoe, because they are what decide how far a heel strike or
    // a toe-off raises the hip.
    footToe: Math.max(0.01, foot.max.z - ankle.z),
    footHeel: Math.max(0.01, ankle.z - foot.min.z),
    hipSideX: [halfStance, -halfStance],
    headAboveWaist: at(headNode).y - at(waistNode).y,
  };
}

let limbCache: RunnerLimbs | null | undefined;
function runnerLimbs(): RunnerLimbs | null {
  if (limbCache === undefined) limbCache = measureRunnerLimbs(runnerPrototype());
  return limbCache;
}

/* -------------------------------------------------------------------------- */
/*  Gait model                                                                */
/* -------------------------------------------------------------------------- */

const TAU = Math.PI * 2;

function clamp(value: number, min: number, max: number) {
  return value < min ? min : value > max ? max : value;
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
function frac(x: number) {
  return x - Math.floor(x);
}
/**
 * Shortest signed turn from one heading to another. Yaw arrives as an atan2
 * result, so a runner crossing the back of the level crosses the +/-pi seam;
 * easing toward the raw difference spun the whole body the long way round for
 * a turn of a couple of degrees.
 */
function shortestAngle(from: number, to: number) {
  return ((to - from + Math.PI * 3) % TAU) - Math.PI;
}
/** Approach a target on a frame-rate independent time constant. */
function approach(current: number, target: number, rate: number, dt: number) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

const GAIT = {
  /** Ground speed, u/s, over which the walk turns into a run. */
  runFrom: 1.6,
  runTo: 5.6,
  /** Ground speed over which the runner leaves its idle for the cycle. */
  idleFrom: 0.25,
  idleTo: 1.1,
  /**
   * Fraction of the cycle each foot spends carrying weight. Above a half the
   * two stances overlap and the runner is always supported, which is what makes
   * a walk a walk; below it there is a flight phase and it becomes a run.
   */
  dutyWalk: 0.62,
  dutyRun: 0.28,
  /**
   * Ground covered per two-step cycle, u: a constant plus a term in speed.
   * Stride is what grows with speed and cadence follows from it, which is the
   * way round real gait works - a faster runner mostly takes longer steps
   * rather than proportionally faster ones.
   */
  strideBase: 0.42,
  stridePerSpeed: 0.264,
  /**
   * Hip angle cap, as a sine. The leg is one rigid capsule seated in a trouser
   * with 0.06u of overlap, so past this the joint tears open. It is the swing
   * overshoot rather than the stance that actually reaches it.
   */
  maxHipSin: 0.82,
  /** Ankle joint limits, radians, positive toe-down. Well past what an ankle
   *  does, because a knee-less leg has to reach with the ankle instead. */
  ankleUp: 0.5,
  ankleDown: -0.42,
  /** Foot pitch relative to the deck at the two ends of stance. */
  strikePitch: -0.2,
  toeOffPitch: 0.45,
  /**
   * How much of the stance's fore-aft speed the swing carries out of toe-off
   * and back into contact. At a walk the full amount fits inside the leg's
   * reach. At a sprint it does not - the true heel flick would swing the foot
   * further back than a straight leg can go - so it is damped until it fits,
   * rather than letting the hip sit pinned at its limit for three frames at
   * each end of the swing.
   */
  swingReachWalk: 1,
  swingReachRun: 0.5,
  /** Extra leg shortening through mid-swing: the stand-in for a knee. */
  clearanceWalk: 0.055,
  clearanceRun: 0.23,
  /** Arm swing as a fraction of the hip angle, and how far forward it is held. */
  armWalk: 0.62,
  armRun: 1.3,
  armCarryRun: 0.52,
  /**
   * Held out from the ribs, and the part of that which oscillates. Sized off
   * the screen-space measurement rather than by eye: at 7.2u/s the fore-aft
   * swing was resolving to 8px across a 202px figure, so the arms never left
   * the body's outline from the chase camera.
   */
  armFlareRun: 0.4,
  armOutSwing: 0.22,
  /** Trunk against legs: twist about the spine, lean over the hips, and the
   *  weight shift toward whichever foot is carrying. */
  twistWalk: 0.07,
  twistRun: 0.17,
  pelvisWalk: 0.05,
  pelvisRun: 0.09,
  leanWalk: 0.05,
  leanRun: 0.24,
  rollWalk: 0.03,
  rollRun: 0.06,
  /** Heading easing, and the bank it produces through a turn. */
  turnResponse: 11,
  turnSmoothing: 9,
  bankGain: 0.028,
  bankMax: 0.3,
  headLead: 0.06,
  /**
   * Secondary motion. The arms trail the legs by a fraction of a cycle and the
   * head trails the body's vertical travel, so the figure reads as parts that
   * follow each other rather than one rigid piece. headLagMax is deliberately
   * small: the head carries a garment socket, and a large offset would swim a
   * hat off the scalp.
   */
  armLag: 0.06,
  chestPump: 0.03,
  headLagSeconds: 0.055,
  headLagMax: 0.02,
} as const;

const AIR = {
  /** How fast the pose crosses between the ground cycle and the air arc. */
  blend: 16,
  /** Legs, ankles and arms at take-off, at the apex, and on the way down. */
  hipUp: [0.34, 0.5],
  hipApex: [-0.3, 0.34],
  hipDown: [-0.5, 0.16],
  liftUp: [0.02, 0.05],
  liftApex: [0.09, 0.09],
  liftDown: [0.03, 0.07],
  ankleUp: 0.4,
  ankleApex: 0.1,
  ankleDown: -0.3,
  armUp: -0.95,
  armApex: -0.6,
  armDown: -0.2,
  pitchUp: -0.06,
  pitchApex: 0.04,
  pitchDown: 0.16,
  /** Landing absorption: how long it runs, when it bottoms out, how deep. */
  landingSeconds: 0.34,
  absorbIn: 0.28,
  crouch: 0.14,
  crouchLean: 0.3,
  crouchArm: 2,
  squash: 0.1,
  /**
   * Squash and stretch is integrated as a damped spring toward 1 rather than
   * keyed off the landing curve. Two things follow from that and neither is
   * available from a curve: the body stretches along its travel at take-off and
   * squashes on impact from the same channel, and the recovery overshoots and
   * settles instead of stopping dead on the frame the timer runs out.
   *
   * At these numbers the natural frequency is sqrt(140) = 11.8 rad/s and the
   * damping ratio is 13 / (2 * 11.8) = 0.55, so it crosses one, comes back once
   * and is done inside about 0.4s.
   */
  springStiffness: 140,
  springDamping: 13,
  /** Fixed integration step, so the bounce is the same on any frame rate. */
  springStep: 1 / 120,
  /**
   * Rate kicked into the spring leaving the deck, and meeting it again.
   *
   * These are not the peak scale. An impulse into a spring damped at zeta 0.55
   * peaks at about 0.45 * kick / omega, so 2.8 / 11.8 * 0.45 lands near a tenth
   * either way, which is the classic squash-and-stretch range. Sizing them by
   * eye first gave 4% and read as nothing.
   */
  launchKick: 2.8,
  landKick: 2.8,
  /** Bounds, so one pathological frame cannot invert or explode the body. */
  squashMin: 0.8,
  squashMax: 1.18,
} as const;

/**
 * Standing still is still moving. The weight shift is deliberately kept above
 * the hips: rolling or turning the pelvis would carry the hip joints with it
 * and drag both planted feet across the deck a few millimetres a second.
 */
const IDLE = {
  breathHz: 0.26,
  breathChest: 0.016,
  swayHz: 0.11,
  swayRoll: 0.016,
  glanceHz: 0.07,
  glance: 0.13,
  armHang: -0.05,
} as const;

/**
 * Foot pitch relative to the deck through stance: land on the heel, roll flat
 * while the body passes over it, then rise onto the toe to push off. Those
 * three rockers are what stop a stiff leg reading as a stilt, and the toe rise
 * is also what lifts the hip enough for the other foot to swing through.
 */
function stanceFootPitch(progress: number) {
  if (progress < 0.16) return lerp(GAIT.strikePitch, 0, smoothstep(0, 0.16, progress));
  if (progress < 0.66) return 0;
  return lerp(0, GAIT.toeOffPitch, smoothstep(0.66, 1, progress));
}

/** And through swing: level off out of the push, then cock the toe for contact. */
function swingFootPitch(progress: number) {
  if (progress < 0.22) return lerp(GAIT.toeOffPitch, 0.02, smoothstep(0, 0.22, progress));
  return lerp(0.02, GAIT.strikePitch, smoothstep(0.22, 1, progress));
}

/**
 * Where the swinging foot sits fore and aft, as a cubic Hermite from the back
 * of the stride to the front.
 *
 * Both end tangents are the stance slope, so the foot's fore-aft speed carries
 * continuously through toe-off and through contact instead of stopping dead at
 * each end of the swing. The two overshoots that fall out of that are real
 * gait: the foot carries on backwards for a moment after the push, and reaches
 * past its landing point before retracting onto it.
 */
function swingOffset(progress: number, half: number, tangent: number) {
  const p2 = progress * progress;
  const p3 = p2 * progress;
  const h10 = p3 - 2 * p2 + progress;
  const h11 = p3 - p2;
  return (2 * p3 - 3 * p2 + 1) * -half + (-2 * p3 + 3 * p2) * half + (h10 + h11) * tangent;
}

/**
 * How far the lowest point of the sole sits below the ankle at a given foot
 * pitch. Flat, that is just the sole depth; tipped either way the foot stands
 * on its toe or its heel and the ankle has to be that much higher to touch.
 */
function soleDepth(pitch: number, limbs: RunnerLimbs) {
  const lever = pitch > 0 ? limbs.footToe : limbs.footHeel;
  return limbs.ankleToSole * Math.cos(pitch) + lever * Math.abs(Math.sin(pitch));
}

/**
 * The hip rotation that puts the foot `ahead` of the hip, fore and aft.
 *
 * This is the inversion the stance depends on: the foot is placed on the deck
 * first and the joint is worked out from it, rather than the joint being posed
 * and the foot going wherever that leaves it.
 */
function solveHip(ahead: number, limbs: RunnerLimbs) {
  return limbs.hipTilt
    - Math.asin(clamp(ahead / limbs.hipToAnkle, -GAIT.maxHipSin, GAIT.maxHipSin));
}

/** Hip height above the deck for a leg at `hipAngle` with its foot at `pitch`. */
function legHeight(hipAngle: number, pitch: number, limbs: RunnerLimbs) {
  return limbs.hipToAnkle * Math.cos(hipAngle - limbs.hipTilt) + soleDepth(pitch, limbs);
}

/** The same for a contact pose, whose ankle may be clamped at its joint limit. */
function contactHeight(ahead: number, wanted: number, limbs: RunnerLimbs) {
  const hip = solveHip(ahead, limbs);
  return legHeight(hip, hip + clamp(wanted - hip, GAIT.ankleDown, GAIT.ankleUp), limbs);
}

/** Blend three keys - take-off, apex, touchdown - across an airborne arc. */
function airKey(fall: number, up: number, apex: number, down: number) {
  return fall < 0.5 ? lerp(up, apex, fall * 2) : lerp(apex, down, (fall - 0.5) * 2);
}

/* -------------------------------------------------------------------------- */
/*  Pose                                                                      */
/* -------------------------------------------------------------------------- */

/** Everything one frame writes. Limb channels are indexed [left, right]. */
export interface RunnerPose {
  hipAngle: [number, number];
  /** Raises the hip pivot, shortening the visible leg where a knee would bend. */
  legLift: [number, number];
  ankleAngle: [number, number];
  armAngle: [number, number];
  /**
   * How far the arm is held out from the ribs, about the shoulder's roll axis.
   *
   * This channel exists because of the camera, not because of anatomy. The
   * chase view sits behind and above, so its view axis is very nearly the
   * runner's forward: measured at 7.2u/s the hand travels 0.561u fore-aft in
   * the world and resolves to 8px across the screen, because the whole swing
   * runs down the barrel. Fore-aft swing alone therefore cannot change the
   * silhouette from behind, however large it is. Swinging the arms out does.
   */
  armOut: [number, number];
  handAngle: [number, number];
  bodyTwist: number;
  bodyLean: number;
  bodyRoll: number;
  pelvisTwist: number;
  headTurn: number;
  headPitch: number;
  headTilt: number;
  headOffset: [number, number, number];
  chest: number;
  lift: number;
  facing: number;
  pitch: number;
  squash: number;
}

export function createRunnerPose(): RunnerPose {
  return {
    hipAngle: [0, 0],
    legLift: [0, 0],
    ankleAngle: [0, 0],
    armAngle: [0, 0],
    armOut: [0, 0],
    handAngle: [0, 0],
    bodyTwist: 0,
    bodyLean: 0,
    bodyRoll: 0,
    pelvisTwist: 0,
    headTurn: 0,
    headPitch: 0,
    headTilt: 0,
    headOffset: [0, 0, 0],
    chest: 1,
    lift: 0,
    facing: 0,
    pitch: 0,
    squash: 1,
  };
}

/** What carries between frames. Held by the caller, advanced by the solver. */
export interface RunnerGaitState {
  /** Position in the two-step cycle, advanced by ground covered not by clock. */
  phase: number;
  facing: number;
  heading: number;
  turnRate: number;
  air: number;
  grounded: boolean;
  fallSpeed: number;
  landing: number;
  landingForce: number;
  /** The squash spring: its current scale and the rate it is moving at. */
  squash: number;
  squashRate: number;
  /** Last frame's body height and its smoothed rate, for the head to trail. */
  lastLift: number;
  bobRate: number;
  started: boolean;
}

export function createRunnerGaitState(): RunnerGaitState {
  return {
    phase: 0,
    facing: 0,
    heading: 0,
    turnRate: 0,
    air: 0,
    grounded: true,
    fallSpeed: 0,
    landing: 0,
    landingForce: 0,
    squash: 1,
    squashRate: 0,
    lastLift: 0,
    bobRate: 0,
    started: false,
  };
}

export interface RunnerPoseInput extends PlayerMotionState {
  pose: PlayerPose;
  elapsed: number;
  reducedMotion: boolean;
}

/**
 * Solve one frame of the runner.
 *
 * The cycle advances on ground covered rather than on the clock, and the stance
 * leg is solved rather than posed: the foot is held where the deck is, the hip
 * angle follows from that, and the body is then dropped onto whichever leg is
 * carrying it. That is what stops the support foot skating, which is the
 * difference between a character walking and a doll being waggled.
 */
export function updateRunnerPose(
  pose: RunnerPose,
  state: RunnerGaitState,
  input: RunnerPoseInput,
  limbs: RunnerLimbs,
  delta: number,
) {
  const dt = clamp(delta, 1 / 240, 1 / 15);
  const speed = Math.max(0, input.speed);
  // Reduced motion trims the flourishes a player cannot act on. It deliberately
  // does not touch the cycle itself: how the legs are moving is information
  // about the game state, and the rise and fall over each step is a consequence
  // of where the feet are, not decoration laid on top.
  const flourish = input.reducedMotion ? 0.3 : 1;

  if (!state.started) {
    state.facing = input.yaw;
    state.heading = input.yaw;
    state.started = true;
  }

  // Heading, and the rate of change of the commanded heading. The rate is what
  // the turn banks against; taking it from the eased facing instead would feed
  // the bank back into itself.
  const turn = shortestAngle(state.heading, input.yaw);
  state.heading = input.yaw;
  state.turnRate = approach(state.turnRate, turn / dt, GAIT.turnSmoothing, dt);
  state.facing += shortestAngle(state.facing, input.yaw) * (1 - Math.exp(-GAIT.turnResponse * dt));

  // Air and landing bookkeeping. verticalVelocity has already been resolved to
  // roughly zero by the time `grounded` flips back, so the impact that sizes
  // the absorption is the speed carried on the last airborne frame.
  if (!input.grounded) state.fallSpeed = Math.min(state.fallSpeed, input.verticalVelocity);
  if (input.grounded && !state.grounded) {
    state.landing = 1;
    state.landingForce = clamp(Math.abs(state.fallSpeed) / PLAYER.jumpVelocity, 0.2, 1.4);
    state.squashRate -= AIR.landKick * state.landingForce;
    state.fallSpeed = 0;
  }
  // Leaving the deck upward is a take-off, and it kicks the same spring the
  // other way, so the body draws out along its travel on the way up rather than
  // only compressing on the way back down.
  if (!input.grounded && state.grounded && input.verticalVelocity > 0) {
    state.squashRate += AIR.launchKick
      * clamp(input.verticalVelocity / PLAYER.jumpVelocity, 0.25, 1);
  }
  state.grounded = input.grounded;
  state.landing = Math.max(0, state.landing - dt / AIR.landingSeconds);
  state.air = approach(state.air, input.grounded ? 0 : 1, AIR.blend, dt);
  // Integrated at a fixed sub-step rather than once per frame. Explicit Euler
  // on a spring is frame-rate dependent in AMPLITUDE, not only in stability,
  // and stepping it once per frame made the bounce a function of the player's
  // hardware: measured over a full-height jump it gave 11% of stretch at 120fps,
  // 9.6% at 60, 6.9% at 30 and 2.3% at 15, where it had all but disappeared.
  // dt is already clamped to 1/15, so this runs at most eight iterations.
  let remaining = dt;
  while (remaining > 1e-6) {
    const step = Math.min(AIR.springStep, remaining);
    state.squashRate += (-AIR.springStiffness * (state.squash - 1)
      - AIR.springDamping * state.squashRate) * step;
    state.squash += state.squashRate * step;
    remaining -= step;
  }
  state.squash = clamp(state.squash, AIR.squashMin, AIR.squashMax);

  /* ---- ground cycle ---------------------------------------------------- */

  const run = smoothstep(GAIT.runFrom, GAIT.runTo, speed);
  const moving = smoothstep(GAIT.idleFrom, GAIT.idleTo, speed);
  const duty = lerp(GAIT.dutyWalk, GAIT.dutyRun, run);
  const strideWanted = GAIT.strideBase + GAIT.stridePerSpeed * speed;
  // What one straight leg can cover caps the stride. Past the cap the foot has
  // to give up ground and slide, which the level's top speed stays inside of.
  const excursion = Math.min(duty * strideWanted, 2 * limbs.hipToAnkle * GAIT.maxHipSin);
  const half = excursion / 2;
  const stride = excursion / duty;
  state.phase = frac(state.phase + (speed / strideWanted) * dt);
  const hipMax = Math.asin(Math.min(GAIT.maxHipSin, half / limbs.hipToAnkle));
  const swingReach = lerp(GAIT.swingReachWalk, GAIT.swingReachRun, run);

  // Which way round the sculpt built its hips, so the pelvis and the weight
  // shift below lean toward the leg that is actually carrying.
  const side = Math.sign(limbs.hipSideX[0]) || -1;
  // The pelvis turns with the swinging leg, carrying its hip forward. That
  // displacement is taken back out of the foot target inside the loop, so the
  // twist does not quietly become a step length of its own.
  const pelvis = -side * lerp(GAIT.pelvisWalk, GAIT.pelvisRun, run) * moving
    * Math.cos(TAU * state.phase);

  const height: [number, number] = [0, 0];
  const carrying: [boolean, boolean] = [false, false];
  const bell: [number, number] = [0, 0];
  const gaitHip: [number, number] = [0, 0];
  const gaitAnkle: [number, number] = [0, 0];
  for (const leg of SIDES) {
    const p = frac(state.phase - leg * 0.5);
    const stance = p < duty;
    let ahead: number;
    let wanted: number;
    if (stance) {
      // The line the whole cycle turns on: while a foot carries weight it
      // travels straight backwards through the body at exactly the speed the
      // body travels forwards, so against the deck it does not move at all.
      ahead = half - excursion * (p / duty);
      wanted = stanceFootPitch(p / duty);
    } else {
      const w = (p - duty) / (1 - duty);
      ahead = swingOffset(w, half, -stride * (1 - duty) * swingReach);
      wanted = swingFootPitch(w);
      bell[leg] = Math.sin(Math.PI * w);
    }
    // Centred under the hip, where a straight leg is at its longest, and
    // offset by however far the pelvis turn has already carried that hip.
    ahead += limbs.hipSideX[leg] * Math.sin(pelvis);
    const hip = lerp(0, solveHip(ahead, limbs), moving);
    const joint = clamp(wanted - hip, GAIT.ankleDown, GAIT.ankleUp) * moving;
    gaitHip[leg] = hip;
    gaitAnkle[leg] = joint;
    carrying[leg] = stance;
    height[leg] = legHeight(hip, hip + joint, limbs);
  }

  // How high the hip sits when the runner is simply stood on the deck, which
  // is the height every drop below is measured against.
  const standing = legHeight(0, 0, limbs);
  let support: number;
  if (carrying[0] && carrying[1]) {
    // Both feet down. The leg reaching furthest is the one the body has to come
    // all the way down to, so it sets the height and the other one gives up the
    // difference - which is exactly the trailing knee bending through a double
    // support. Setting the height off the taller leg instead leaves the foot
    // that is landing hanging in the air above the deck.
    support = Math.min(height[0], height[1]);
  } else if (carrying[0] || carrying[1]) {
    support = carrying[0] ? height[0] : height[1];
  } else {
    // Neither foot down, so the duty factor has fallen below a half and the
    // walk has become a run. Carry the body from the last toe-off to the next
    // contact along an arc that tops out at full leg extension.
    const window = state.phase < 0.5
      ? (state.phase - duty) / (0.5 - duty)
      : (state.phase - 0.5 - duty) / (0.5 - duty);
    const off = contactHeight(-half, GAIT.toeOffPitch, limbs);
    const on = contactHeight(half, GAIT.strikePitch, limbs);
    support = lerp(off, on, window)
      + Math.max(0, standing - Math.max(off, on)) * Math.sin(Math.PI * window);
  }

  const clearance = lerp(GAIT.clearanceWalk, GAIT.clearanceRun, run) * moving;
  const gaitLift: [number, number] = [0, 0];
  for (const leg of SIDES) {
    // However much taller a leg stands than the one carrying the body, it has
    // to shorten by, or its foot would be driven through the deck. On a stance
    // leg that shortening is the knee bending through a double support; on a
    // swing leg it is what stops the straight leg grazing the deck as it passes
    // the stance leg, which it otherwise does at exactly the same length.
    const excess = height[leg] - support;
    gaitLift[leg] = carrying[leg] ? excess : Math.max(0, excess) + clearance * bell[leg];
  }

  // Trailing the leg phase rather than matching it: an arm that swings in lock
  // step with the opposite leg reads as one rigid mechanism.
  const armSwing = lerp(GAIT.armWalk, GAIT.armRun, run) * hipMax
    * Math.cos(TAU * (state.phase - GAIT.armLag));
  const armCarry = -GAIT.armCarryRun * run;
  const gaitArm: [number, number] = [armCarry + armSwing, armCarry - armSwing];

  /* ---- idle ------------------------------------------------------------ */

  const breath = Math.sin(TAU * IDLE.breathHz * input.elapsed);
  const sway = Math.sin(TAU * IDLE.swayHz * input.elapsed);
  const idleArm = IDLE.armHang + breath * 0.012;

  /* ---- ground pose ----------------------------------------------------- */

  for (const leg of SIDES) {
    pose.hipAngle[leg] = gaitHip[leg];
    pose.legLift[leg] = gaitLift[leg];
    pose.ankleAngle[leg] = gaitAnkle[leg];
    pose.armAngle[leg] = lerp(idleArm, gaitArm[leg], moving);
    // Mirrored so both arms swing AWAY from the ribs. ARM_SIDE carries which
    // sign is outward for each shoulder in this sculpt; getting it backwards
    // drives the arms through the torso, which is what the lateral figure in
    // the readability probe is there to catch.
    pose.armOut[leg] = ARM_SIDE[leg]
      * (GAIT.armFlareRun * run + GAIT.armOutSwing * Math.sin(TAU * (state.phase - GAIT.armLag)))
      * moving * flourish;
    pose.handAngle[leg] = -gaitArm[leg] * 0.38 * moving;
  }
  pose.lift = support - standing;
  pose.bodyTwist = -lerp(GAIT.twistWalk, GAIT.twistRun, run) * moving * flourish
    * Math.cos(TAU * state.phase);
  pose.bodyLean = lerp(GAIT.leanWalk, GAIT.leanRun, run) * moving;
  pose.pelvisTwist = pelvis;
  // Breath at rest, and a pump on each footfall once there is a stride to pump
  // against - twice a cycle, because a cycle is two steps.
  pose.chest = 1 + breath * IDLE.breathChest * (1 - moving * 0.6)
    + Math.sin(TAU * 2 * state.phase) * GAIT.chestPump * run * moving * flourish;

  // Banking into a turn: the faster the runner is going when the heading
  // swings, the further the body leans across it. Nothing else in the old cycle
  // answered a turn at all, so a corner read as the whole model being rotated.
  const bank = clamp(-state.turnRate * speed * GAIT.bankGain, -GAIT.bankMax, GAIT.bankMax)
    * flourish;
  const weightShift = -side * lerp(GAIT.rollWalk, GAIT.rollRun, run) * Math.sin(TAU * state.phase);
  pose.bodyRoll = lerp(sway * IDLE.swayRoll * flourish, weightShift * flourish, moving) + bank;
  pose.headTurn = -pose.bodyTwist * 0.65
    + clamp(state.turnRate * GAIT.headLead, -0.22, 0.22) * flourish
    + Math.sin(TAU * IDLE.glanceHz * input.elapsed) * IDLE.glance * (1 - moving) * flourish;
  pose.headTilt = -bank * 0.45 - breath * 0.006 * (1 - moving);
  pose.headPitch = -pose.bodyLean * 0.55 - breath * 0.01 * (1 - moving);
  pose.pitch = 0;

  /* ---- airborne arc ---------------------------------------------------- */

  if (state.air > 0.001) {
    const fall = 0.5 - clamp(input.verticalVelocity / PLAYER.jumpVelocity, -1, 1) * 0.5;
    const weight = state.air;
    for (const leg of SIDES) {
      pose.hipAngle[leg] = lerp(
        pose.hipAngle[leg],
        airKey(fall, AIR.hipUp[leg], AIR.hipApex[leg], AIR.hipDown[leg]),
        weight,
      );
      pose.legLift[leg] = lerp(
        pose.legLift[leg],
        airKey(fall, AIR.liftUp[leg], AIR.liftApex[leg], AIR.liftDown[leg]),
        weight,
      );
      pose.ankleAngle[leg] = lerp(
        pose.ankleAngle[leg],
        airKey(fall, AIR.ankleUp, AIR.ankleApex, AIR.ankleDown),
        weight,
      );
      pose.armAngle[leg] = lerp(
        pose.armAngle[leg],
        airKey(fall, AIR.armUp, AIR.armApex, AIR.armDown),
        weight,
      );
      pose.handAngle[leg] = lerp(pose.handAngle[leg], 0.18, weight);
    }
    pose.lift = lerp(pose.lift, 0, weight);
    pose.bodyTwist = lerp(pose.bodyTwist, 0, weight);
    pose.bodyLean = lerp(pose.bodyLean, 0.1, weight);
    // In the air the feet have nothing to stay flat against, so the whole body
    // may pitch through the arc rather than only the trunk over the hips.
    pose.pitch = airKey(fall, AIR.pitchUp, AIR.pitchApex, AIR.pitchDown) * weight * flourish;
    pose.headPitch = lerp(pose.headPitch, -pose.pitch * 0.4, weight);
  }

  /* ---- landing absorption ---------------------------------------------- */

  const sinceLanding = 1 - state.landing;
  const absorb = state.landing > 0
    ? (sinceLanding < AIR.absorbIn
      ? smoothstep(0, AIR.absorbIn, sinceLanding)
      : 1 - smoothstep(AIR.absorbIn, 1, sinceLanding))
    : 0;
  const impact = absorb * state.landingForce * (1 - state.air);
  if (impact > 0) {
    // Dropping the body and shortening both legs by the same amount is a crouch
    // with the feet still on the deck. Dropping it alone would drive them
    // through, which is why the old landing was only a scale.
    pose.lift -= impact * AIR.crouch;
    pose.legLift[0] += impact * AIR.crouch;
    pose.legLift[1] += impact * AIR.crouch;
    pose.bodyLean += impact * AIR.crouchLean;
    pose.armAngle[0] -= impact * AIR.crouchArm;
    pose.armAngle[1] -= impact * AIR.crouchArm;
  }
  // The spring carries the take-off stretch and the landing settle alike, so
  // the absorption above only has to move the body rather than scale it too.
  pose.squash = 1 + (state.squash - 1) * flourish;

  /* ---- pose overrides -------------------------------------------------- */

  if (input.stunned || input.pose === "failure") {
    const flail = Math.sin(input.elapsed * 17) * 1.15 * flourish;
    pose.hipAngle[0] = -flail * 0.5;
    pose.hipAngle[1] = flail * 0.5;
    pose.legLift[0] = 0.05;
    pose.legLift[1] = 0.05;
    pose.ankleAngle[0] = 0.2;
    pose.ankleAngle[1] = 0.2;
    pose.armAngle[0] = flail - 1.1;
    pose.armAngle[1] = -flail - 1.1;
    pose.handAngle[0] = 0;
    pose.handAngle[1] = 0;
    pose.bodyTwist = flail * 0.2;
    pose.bodyLean = -0.2;
    pose.lift = Math.abs(Math.sin(input.elapsed * 14)) * 0.06 * flourish;
    pose.headTilt = Math.sin(input.elapsed * 13) * 0.16 * flourish;
    pose.squash = 0.9;
  } else if (input.pose === "victory") {
    const hop = Math.abs(Math.sin(input.elapsed * 7));
    pose.armAngle[0] = -2.35;
    pose.armAngle[1] = -2.35;
    pose.handAngle[0] = -0.3;
    pose.handAngle[1] = -0.3;
    pose.hipAngle[0] = -0.18 * hop;
    pose.hipAngle[1] = 0.18 * hop;
    pose.legLift[0] = 0.03 * hop;
    pose.legLift[1] = 0.03 * hop;
    pose.lift = hop * 0.12 * flourish;
    pose.bodyLean = -0.12;
    pose.bodyRoll = Math.sin(input.elapsed * 7) * 0.06 * flourish;
    pose.headPitch = -0.12;
  }

  // The head hangs off the root rather than off the trunk, so a trunk that
  // leans or rolls has to carry it across manually or it stays behind on a
  // broken neck. It keeps a little of its own level, which is what makes a
  // runner read as looking where they are going.
  const reach = limbs.headAboveWaist;
  pose.headOffset[0] = -reach * Math.sin(pose.bodyRoll);
  pose.headOffset[1] = reach * (Math.cos(pose.bodyLean) * Math.cos(pose.bodyRoll) - 1);
  pose.headOffset[2] = reach * Math.sin(pose.bodyLean);
  // The head trails the body's vertical travel by a fraction of a frame, which
  // is the cheapest secondary motion there is. Added to the offset that keeps
  // the head on the neck rather than replacing it, and bounded, because this
  // node carries the hat socket.
  state.bobRate = approach(state.bobRate, (pose.lift - state.lastLift) / dt, 12, dt);
  state.lastLift = pose.lift;
  pose.headOffset[1] += clamp(
    -state.bobRate * GAIT.headLagSeconds * flourish,
    -GAIT.headLagMax,
    GAIT.headLagMax,
  );
  pose.headPitch += pose.bodyLean;
  pose.headTilt += pose.bodyRoll;
  pose.facing = state.facing;
}

/* -------------------------------------------------------------------------- */
/*  Applying a pose                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Which sign of shoulder roll carries each arm AWAY from the ribs. Verified by
 * measuring the distance between the two hands with the flare on and off: it
 * has to grow. The opposite sign passes every joint-angle assertion we have and
 * puts both forearms inside the torso.
 */
const ARM_SIDE: readonly [number, number] = [-1, 1];

/** Hip, ankle and outsole, then shoulder and wrist, per side. */
const LEG_JOINTS: readonly (readonly [PivotKey, PivotKey, PivotKey])[] = [
  ["leftLeg", "leftFoot", "leftSole"],
  ["rightLeg", "rightFoot", "rightSole"],
];
const ARM_JOINTS: readonly (readonly [PivotKey, PivotKey])[] = [
  ["leftArm", "leftHand"],
  ["rightArm", "rightHand"],
];

/**
 * The joints, with the rest transform the factory authored for each.
 *
 * Every channel is written as a delta from this rather than assigned outright:
 * the sculpt poses real rest orientations - the arms' outward splay, the shoe's
 * seat on the ankle - and assigning would flatten all of it to zero on the
 * first frame the runner moved.
 */
export interface RunnerRig {
  root: THREE.Object3D;
  joints: Partial<Record<PivotKey, THREE.Object3D>>;
  rotation: Partial<Record<PivotKey, THREE.Euler>>;
  position: Partial<Record<PivotKey, THREE.Vector3>>;
  scale: Partial<Record<PivotKey, THREE.Vector3>>;
}

export function captureRunnerRig(model: THREE.Object3D, root: THREE.Object3D): RunnerRig {
  const rig: RunnerRig = { root, joints: {}, rotation: {}, position: {}, scale: {} };
  for (const [key, name] of Object.entries(PIVOTS) as [PivotKey, string][]) {
    const node = model.getObjectByName(name);
    if (!node) continue;
    rig.joints[key] = node;
    rig.rotation[key] = node.rotation.clone();
    rig.position[key] = node.position.clone();
    rig.scale[key] = node.scale.clone();
  }
  return rig;
}

export function applyRunnerPose(rig: RunnerRig, pose: RunnerPose) {
  const spin = (key: PivotKey, x: number, y = 0, z = 0) => {
    const node = rig.joints[key];
    const rest = rig.rotation[key];
    if (node && rest) node.rotation.set(rest.x + x, rest.y + y, rest.z + z);
  };
  const shift = (key: PivotKey, x: number, y: number, z: number) => {
    const node = rig.joints[key];
    const rest = rig.position[key];
    if (node && rest) node.position.set(rest.x + x, rest.y + y, rest.z + z);
  };

  for (const leg of SIDES) {
    const [hip, ankle, sole] = LEG_JOINTS[leg] ?? [];
    if (hip && ankle && sole) {
      const angle = pose.ankleAngle[leg];
      spin(hip, pose.hipAngle[leg]);
      shift(hip, 0, pose.legLift[leg], 0);
      spin(ankle, angle);
      // The outsole hangs off the leg beside the shoe rather than under it, so
      // it has to be swung about the ankle by hand or the shoe comes apart at
      // the welt on every step.
      const soleNode = rig.joints[sole];
      const soleRest = rig.position[sole];
      const ankleRest = rig.position[ankle];
      if (soleNode && soleRest && ankleRest) {
        const dy = soleRest.y - ankleRest.y;
        const dz = soleRest.z - ankleRest.z;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        soleNode.position.set(
          soleRest.x,
          ankleRest.y + dy * cos - dz * sin,
          ankleRest.z + dy * sin + dz * cos,
        );
        spin(sole, angle);
      }
    }
    const [shoulder, wrist] = ARM_JOINTS[leg] ?? [];
    if (shoulder && wrist) {
      spin(shoulder, pose.armAngle[leg], 0, pose.armOut[leg]);
      spin(wrist, pose.handAngle[leg]);
    }
  }

  spin("pelvis", 0, pose.pelvisTwist, 0);
  spin("body", pose.bodyLean, pose.bodyTwist, pose.bodyRoll);
  spin("head", pose.headPitch, pose.headTurn, pose.headTilt);
  shift("head", pose.headOffset[0], pose.headOffset[1], pose.headOffset[2]);

  const torso = rig.joints.torso;
  const torsoRest = rig.scale.torso;
  if (torso && torsoRest) {
    torso.scale.set(
      torsoRest.x * pose.chest,
      torsoRest.y * (2 - pose.chest),
      torsoRest.z * pose.chest,
    );
  }

  // The squash scales about the body origin, which is the capsule's centre, so
  // on its own it lifts the soles clear of the deck by whatever it takes off
  // the height - and it is at its deepest exactly when the runner is supposed
  // to be planting hardest. Scaling the offset down alongside it keeps the sole
  // the solver planted at the deck exactly on the deck.
  rig.root.position.y = pose.squash * pose.lift - (1 - pose.squash) * SOLE_DROP;
  rig.root.rotation.set(pose.pitch, pose.facing, 0);
  const spread = 1 / Math.sqrt(pose.squash);
  rig.root.scale.set(spread, pose.squash, spread);
}

/* -------------------------------------------------------------------------- */

export function PlayerVisual({
  avatarSeed = 1,
  avatar = null,
  ghost = false,
  visible = true,
  pose = "idle",
  motion,
}: {
  avatarSeed?: number;
  avatar?: AvatarConfig | null;
  ghost?: boolean;
  visible?: boolean;
  pose?: PlayerPose;
  motion?: React.RefObject<PlayerMotionState>;
}) {
  const group = useRef<THREE.Group>(null);
  const rig = useRef<RunnerRig | null>(null);
  const gait = useRef<RunnerGaitState>(createRunnerGaitState());
  const frame = useRef<RunnerPose>(createRunnerPose());
  const reducedMotion = useSettingsStore((state) => state.reducedMotion);
  const limbs = useMemo(() => runnerLimbs(), []);

  const model = useMemo(
    () => dressRunner(avatar, avatarSeed, ghost),
    [avatar, avatarSeed, ghost],
  );

  useEffect(() => {
    if (group.current) rig.current = captureRunnerRig(model, group.current);
  }, [model]);

  useFrame(({ clock }, delta) => {
    if (group.current) group.current.visible = visible;
    const current = rig.current;
    if (!current || !limbs) return;
    const state = motion?.current;
    updateRunnerPose(
      frame.current,
      gait.current,
      {
        speed: state?.speed ?? 0,
        verticalVelocity: state?.verticalVelocity ?? 0,
        grounded: state?.grounded ?? true,
        yaw: state?.yaw ?? 0,
        stunned: state?.stunned ?? false,
        pose,
        elapsed: clock.elapsedTime,
        reducedMotion,
      },
      limbs,
      delta,
    );
    applyRunnerPose(current, frame.current);
  });

  return (
    <group ref={group}>
      <primitive object={model} />
    </group>
  );
}
