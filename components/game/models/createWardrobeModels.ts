// Code-authored clothing for the MAKE IT WORSE runner.
//
// The runner is a pipeline model. Every part of it hangs from a named pivot,
// and this file dresses those pivots without touching the factory that built
// them: createWardrobeAttachments turns a resolved avatar into geometry keyed
// by socket name, and attachWardrobe parents it onto a runner instance.
//
// Three things about the rig drive every number below, and all three were
// measured off the built model rather than assumed.
//
// 1. Some sockets do not carry unit scale. Torso__pivot is (1, 1, 0.8), the
//    sneakers are (0.198, 0.205, 0.3) and the hands are (0.145, 0.15, 0.105).
//    A garment parented straight onto one of those would be squashed by an
//    accident of how the torso lathe was authored, so attachWardrobe cancels
//    each socket's scale and every dimension in this file is in the runner's
//    own units. Where a garment genuinely wants the torso's oval section it
//    says so itself, with TORSO_DEPTH.
//
// 2. The run cycle rotates the arms, hands, legs and ankles about X and nothing
//    else. Rotation about X leaves the x coordinate of every rigidly parented
//    point untouched, so for anything hung off a limb the resting silhouette IS
//    the swept silhouette, and two parts whose x ranges do not overlap can never
//    meet however hard the runner swings. That is what most of the clearance
//    rules below are spending.
//
// 3. The torso and the head do rotate about Y and Z, by up to 0.38 and 0.24
//    radians at the extremes of the victory and failure poses. Those are small
//    enough that a shell hugging the body stays hugging it.
//
// No texture files and no loaded art: every item is primitives, and the only
// per-item cost paid more than once is a material.
//
// Thirty-four items are cut from a reference image under assets/reference,
// one item per wear-*.png. Where a reference exists it decides the part
// breakdown and which parts take the contrast colour - a cap's brim is trim
// because the reference cap has a navy brim on a mint crown, not because a
// two-tone cap looked better. It also decides where the contrast does NOT go:
// the cargo trouser's pockets are the leg's own colour and stand proud
// instead, and the poncho has no hem band at all, because that is what those
// references show. The rest of the catalogue has no reference and is authored
// to match the palette those thirty-four establish.
//
// One reference is worn by an item that does not share its name.
// wear-trainers.png is a running shoe, and every shoe it could have been is
// already answered by a reference of its own, so it dresses the cleat - which
// had no upper at all - and the studs under that upper stay invented.
//
// Two things a reference never decides. Silhouette on a limb comes from the rig
// - a trouser is a sleeve laid along the leg axis - so a reference photographed
// folded flat still settles the palette and the detail placement without being
// able to settle a leg shape it does not show. And nothing may widen past the
// clearances below, which is why the plunger cup stays squashed in x however
// round the reference's cup is: the hand swings past the skull.

import * as THREE from "three";
import { PALETTE } from "@/lib/game/constants";
import { createHeadwearUpgradeModel } from "./createHeadwearUpgradeModels";
import { createHairStyleModel } from "./createHairModels";
import { createWearableUpgradeModel } from "./createWearableUpgradeModels";
import type {
  AvatarBackpackId,
  AvatarEyewearId,
  AvatarFaceId,
  AvatarFootwearId,
  AvatarHeadwearId,
  AvatarHeldId,
  AvatarLegwearId,
  AvatarOuterwearId,
  AvatarTopId,
  ResolvedAvatar,
} from "@/lib/game/avatar";

// --- The rig, measured ------------------------------------------------------

/**
 * The torso lathe's radius against its own height, sampled off the built model.
 *
 * Hardcoded because a garment has to be shaped like the body under it and this
 * file cannot reach into the factory's closure to ask. wardrobe.test.ts reads
 * the real lathe back out of a built runner and fails if these drift apart, the
 * same way avatar.ts keeps DECK_WASH honest against LevelGeometry.
 */
const TORSO_PROFILE: readonly (readonly [number, number])[] = [
  [-0.318, 0.001],
  [-0.3046, 0.152],
  [-0.278, 0.194],
  [-0.238, 0.203],
  [-0.184, 0.224],
  [-0.117, 0.242],
  [-0.064, 0.259],
  [-0.023, 0.262],
  [0.03, 0.259],
  [0.084, 0.249],
  [0.138, 0.239],
  [0.191, 0.228],
  [0.245, 0.212],
  [0.285, 0.19],
  [0.298, 0.176],
  [0.312, 0.149],
  [0.325, 0.001],
];

/** Torso__pivot's own z scale. A garment shell wants the same oval section. */
const TORSO_DEPTH = 0.8;

const ARM = {
  length: 0.38755,
  /** Unit vector from the shoulder to the wrist, for the right side. */
  dir: new THREE.Vector3(0.4797, -0.8773, 0),
  shoulderRadius: 0.082,
  wristRadius: 0.066,
} as const;

const LEG = {
  length: 0.373,
  dir: new THREE.Vector3(0.0751, -0.99718, 0),
  hipRadius: 0.083,
  ankleRadius: 0.067,
} as const;


const HEAD = {
  /** Hair cap ellipsoid, which a hat has to cover. */
  hairCenter: new THREE.Vector3(0, 0.103, -0.012),
  hairRadii: new THREE.Vector3(0.345, 0.235, 0.34),
  eye: new THREE.Vector3(0.108, -0.076, 0.272),
} as const;

// --- The clearances that keep garments out of the body ----------------------

/**
 * Half the widest a dressed runner may be, in the factory's units.
 *
 * character-silhouette.test.ts caps the fitted runner at 0.94u because that is
 * the visible deck left on the narrowest plank in the catalogue, and a runner
 * wider than it hides their own feet exactly where footing matters most. The
 * factory authors 1.899u tall and PlayerVisual fits that to 1.86u, so 0.94u of
 * deck is 0.9597u here; half of it, minus a little, is the number below. Every
 * item is measured against it and wardrobe.test.ts fails on the widest.
 */
export const MAX_HALF_WIDTH = 0.47;

/**
 * The lowest a torso garment may hang, in world units.
 *
 * A thigh rotates about the hip at y = 0.66 and its top cap has radius 0.083,
 * so no point of a leg ever rises above 0.743 whatever the stride does. A hem
 * above that can never be cut by a swinging thigh; a hem below it would be, and
 * the failure is not subtle - the leg passes straight through the coat. Long
 * coats are therefore not in the catalogue, and the items that want length hang
 * it off the legs instead, where it swings with them.
 */
export const TORSO_HEM_Y = 0.772;

/** Torso__pivot sits here, so hems are TORSO_HEM_Y minus this. */
const TORSO_ORIGIN_Y = 0.95;
const HEM = TORSO_HEM_Y - TORSO_ORIGIN_Y;

/**
 * The widest a leg garment may be about its own axis.
 *
 * Two things bound it. The legs are 0.21 apart, so anything over 0.105 has the
 * two sides passing through each other on every stride. And a leg rotates to at
 * most 83.5 degrees off vertical in the victory pose, which lifts a point at
 * radius r on the hip rim to y = 0.66 + 0.994r; keeping that under TORSO_HEM_Y
 * is what stops a trouser waist from eating the shirt above it.
 */
export const LEG_MAX_RADIUS = 0.095;

// --- Materials --------------------------------------------------------------

export type WardrobeTint =
  | "main"
  | "trim"
  | "hairShadow"
  | "skin"
  | "ink"
  | "cream"
  | "steel"
  | "metal"
  | "denim"
  | "knit"
  | "leather"
  | "rubber"
  | "plastic"
  | "glass"
  | "glow"
  | "flame";

/**
 * Every template mesh is built against this and never renders with it. Roles
 * are resolved to real materials when an item is cloned for a runner, which is
 * what lets one template dress a player, a ghost and a preview in three
 * different colours without rebuilding any geometry.
 */
const ROLE_PLACEHOLDER = new THREE.MeshStandardMaterial({ color: 0xffffff });

function luminance(color: THREE.Color): number {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

/**
 * A garment's second colour, derived rather than chosen.
 *
 * Trim exists to give a shape internal edges - a cuff, a stripe, a sole - and
 * an edge you cannot see is not an edge, so the derivation moves away from
 * whatever the main colour already is instead of always darkening. Ink trim on
 * an ink jacket would be one flat slab.
 */
function trimOf(main: string): THREE.Color {
  const color = new THREE.Color(main);
  const target = new THREE.Color(luminance(color) < 0.16 ? PALETTE.cream : PALETTE.ink);
  return color.clone().lerp(target, luminance(color) < 0.16 ? 0.42 : 0.4);
}

/**
 * Where a garment's colours come from, which is not where a prop's come from.
 *
 * `main` arrives already resolved from AVATAR_COLORS in avatar.ts, and that is
 * the authority for anything worn. Every swatch is allowed; the runner's ink
 * silhouette supplies gameplay readability without changing the chosen hue.
 *
 * PALETTE is still right for the fixed roles below, because ink and cream are
 * shared by both lists and neither is a colour a player can choose.
 *
 * The jetpack's body and the boot's sole look like props strapped to a runner,
 * but they sit in player-coloured slots, so they take the wearer's colour
 * rather than the dark navy the hand-authored props use.
 */
function makePalette(main: string, skinColor: string): Record<WardrobeTint, THREE.Material> {
  const cloth = (color: THREE.ColorRepresentation) =>
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.78,
      metalness: 0,
      // Shells are single-walled lathes, so both faces have to draw or the
      // inside of a hem reads as a hole punched through the runner.
      side: THREE.DoubleSide,
    });
  const chosen = new THREE.Color(main);
  const textured = (
    color: THREE.ColorRepresentation,
    roughness: number,
    metalness = 0,
  ) =>
    new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness,
      side: THREE.DoubleSide,
    });
  return {
    main: cloth(main),
    trim: cloth(trimOf(main)),
    // Hair needs modelling contrast without suddenly turning cream or grey.
    // Keeping this role in the selected hue fixes the pale chunks that made
    // curls, locs and puff buns look like separate accessories.
    hairShadow: cloth(new THREE.Color(main).multiplyScalar(0.62)),
    skin: cloth(skinColor),
    ink: cloth(PALETTE.ink),
    cream: cloth(PALETTE.cream),
    steel: new THREE.MeshStandardMaterial({
      color: "#b9c0cf",
      roughness: 0.34,
      metalness: 0.6,
      side: THREE.DoubleSide,
    }),
    metal: new THREE.MeshStandardMaterial({
      color: chosen.clone().lerp(new THREE.Color("#d7e0ed"), 0.22),
      roughness: 0.28,
      metalness: 0.68,
      side: THREE.DoubleSide,
    }),
    // These roles preserve the chosen swatch while giving different item
    // families enough surface response to stop reading as the same plastic.
    denim: textured(chosen.clone().multiplyScalar(0.9), 0.93),
    knit: textured(chosen.clone().lerp(new THREE.Color("#ffffff"), 0.04), 1),
    leather: textured(chosen.clone().multiplyScalar(0.76), 0.48),
    rubber: textured(chosen.clone().multiplyScalar(0.32), 0.96),
    plastic: textured(chosen.clone().lerp(new THREE.Color("#ffffff"), 0.08), 0.25),
    glass: new THREE.MeshPhysicalMaterial({
      color: chosen.clone().lerp(new THREE.Color("#bcecff"), 0.5),
      transparent: true,
      opacity: 0.46,
      roughness: 0.08,
      metalness: 0.05,
      transmission: 0.28,
      thickness: 0.03,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    glow: new THREE.MeshStandardMaterial({
      color: PALETTE.yellow,
      emissive: new THREE.Color(PALETTE.yellow),
      emissiveIntensity: 0.75,
      roughness: 0.5,
      side: THREE.DoubleSide,
    }),
    flame: new THREE.MeshStandardMaterial({
      color: "#ff8a2a",
      emissive: new THREE.Color("#ff4c1f"),
      emissiveIntensity: 1.4,
      roughness: 0.35,
      side: THREE.DoubleSide,
    }),
  };
}

// --- Primitive helpers ------------------------------------------------------

function part(
  geometry: THREE.BufferGeometry,
  tint: WardrobeTint,
  position?: THREE.Vector3Like,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, ROLE_PLACEHOLDER);
  mesh.userData["wardrobeTint"] = tint;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (position) mesh.position.set(position.x, position.y, position.z);
  return mesh;
}

function ball(rx: number, ry: number, rz: number): THREE.SphereGeometry {
  const geometry = new THREE.SphereGeometry(1, 20, 14);
  geometry.scale(rx, ry, rz);
  return geometry;
}

/**
 * A latitude band on a sphere, for carrying a body stripe across a cap.
 *
 * Heights rather than angles, because the caller has the band in the same
 * units as the shell it comes off. A cylinder at a fixed radius would have
 * done for a narrow stripe and floats off the sphere as soon as the band is
 * deep enough to reach where the sphere has started to curve away.
 */
function ballBand(radius: number, bottom: number, top: number): THREE.SphereGeometry {
  const clamp = (y: number) => Math.min(radius, Math.max(-radius, y));
  const start = Math.acos(clamp(top) / radius);
  const end = Math.acos(clamp(bottom) / radius);
  return new THREE.SphereGeometry(radius, 20, 8, 0, Math.PI * 2, start, end - start);
}

/** An upper half-ellipsoid, for crowns and domes. */
function dome(rx: number, ry: number, rz: number): THREE.SphereGeometry {
  const geometry = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  geometry.scale(rx, ry, rz);
  return geometry;
}

function tube(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  segments = 20,
  open = false,
): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments, 1, open);
}

/**
 * A curved plate, for visors, bibs and panels.
 *
 * An open cylinder wall centred on +z, which is the direction the runner faces,
 * so the piece follows the body it sits on for free. Cheaper and better behaved
 * than extruding a shape, and a double-sided material spares it a second wall.
 */
function plate(radius: number, height: number, spread: number): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(
    radius,
    radius,
    height,
    Math.max(8, Math.round(spread * 11)),
    1,
    true,
    -spread / 2,
    spread,
  );
}

function ring(radius: number, thickness: number, arc = Math.PI * 2): THREE.TorusGeometry {
  return new THREE.TorusGeometry(radius, thickness, 8, Math.max(8, Math.round(arc * 6)), arc);
}

function slab(width: number, height: number, depth: number): THREE.BoxGeometry {
  return new THREE.BoxGeometry(width, height, depth);
}

/**
 * A slab with its edges taken off, for the footwear.
 *
 * Every piece of every shoe was a slab, which is a BoxGeometry, which is why
 * the catalogue read as blocks however distinct the compositions were. This is
 * the same brief in a rounded form: a rounded rectangle in plan, given height,
 * and bevelled top and bottom so there is no hard edge anywhere on it.
 *
 * IT OCCUPIES EXACTLY THE BOX IT REPLACES. The bevel is applied first and the
 * result is then refitted onto the full width/height/depth, so the extents are
 * identical to slab()'s to floating point. That matters more here than it looks
 * like it does: the footwear positions are reference-derived numbers tuned
 * against those extents, and the wardrobe suite measures leg clearance and hem
 * bounds off them. Rounding by shrinking would have moved every one of them.
 */
function roundedSlab(width: number, height: number, depth: number): THREE.BufferGeometry {
  // Radius is capped so a thin piece - a lace band, a sandal strap - rounds
  // rather than collapsing into a lozenge.
  const radius = Math.min(width, depth) * 0.3;
  const shape = new THREE.Shape();
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  shape.moveTo(-halfWidth + radius, -halfDepth);
  shape.lineTo(halfWidth - radius, -halfDepth);
  shape.quadraticCurveTo(halfWidth, -halfDepth, halfWidth, -halfDepth + radius);
  shape.lineTo(halfWidth, halfDepth - radius);
  shape.quadraticCurveTo(halfWidth, halfDepth, halfWidth - radius, halfDepth);
  shape.lineTo(-halfWidth + radius, halfDepth);
  shape.quadraticCurveTo(-halfWidth, halfDepth, -halfWidth, halfDepth - radius);
  shape.lineTo(-halfWidth, -halfDepth + radius);
  shape.quadraticCurveTo(-halfWidth, -halfDepth, -halfWidth + radius, -halfDepth);
  const bevel = Math.min(height * 0.3, radius * 0.6);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, height - bevel * 2),
    bevelEnabled: bevel > 1e-4,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 6,
  });
  // Authored in plan and extruded along +Z, so stand it up and centre it.
  geometry.rotateX(-Math.PI / 2);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (box) {
    const size = new THREE.Vector3();
    box.getSize(size);
    geometry.translate(
      -(box.min.x + box.max.x) / 2,
      -(box.min.y + box.max.y) / 2,
      -(box.min.z + box.max.z) / 2,
    );
    geometry.scale(
      size.x > 1e-6 ? width / size.x : 1,
      size.y > 1e-6 ? height / size.y : 1,
      size.z > 1e-6 ? depth / size.z : 1,
    );
  }
  geometry.computeVertexNormals();
  return geometry;
}

function torsoRadius(y: number): number {
  const points = TORSO_PROFILE;
  if (y <= points[0]![0]) return points[0]![1];
  const last = points[points.length - 1]!;
  if (y >= last[0]) return last[1];
  for (let index = 1; index < points.length; index += 1) {
    const [y1, r1] = points[index]!;
    if (y > y1) continue;
    const [y0, r0] = points[index - 1]!;
    return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return last[1];
}

/**
 * A shell that follows the torso at a fixed offset.
 *
 * Offset rather than freely shaped on purpose. The upper arms are embedded in
 * the torso lathe in the rest pose - that is how the sculpt is built, with the
 * shoulder caps covering the seam - so a shell that hugs the torso is left by
 * the arms exactly where the body is, and the swing reads as it already does. A
 * shell much fatter than the torso would move that exit point around as the arm
 * travelled, which is the artefact this avoids.
 */
function torsoProfile(
  bottomY: number,
  topY: number,
  offset: number,
): THREE.Vector2[] {
  const points: THREE.Vector2[] = [];
  const steps = Math.max(4, Math.round((topY - bottomY) / 0.028));
  for (let step = 0; step <= steps; step += 1) {
    const y = bottomY + ((topY - bottomY) * step) / steps;
    points.push(new THREE.Vector2(torsoRadius(y) + offset, y));
  }
  return points;
}

function torsoShell(
  bottomY: number,
  topY: number,
  offset: number,
  /** Leaves a gap of this many radians down the front, for anything that opens. */
  gap = 0,
): THREE.LatheGeometry {
  return new THREE.LatheGeometry(
    torsoProfile(bottomY, topY, offset),
    22,
    gap / 2,
    Math.PI * 2 - gap,
  );
}

/**
 * A stripe running UP the body rather than round it.
 *
 * Cut from the same profile as the shell, so it follows the barrel from hem to
 * collar instead of standing off it at the shoulder the way a flat slab at one
 * radius does. `at` is measured from the front, which is where a lathe's own
 * angle starts, so a pair either side of the placket is `+-` one number.
 */
function torsoStripe(
  bottomY: number,
  topY: number,
  offset: number,
  arc: number,
  at: number,
): THREE.LatheGeometry {
  return new THREE.LatheGeometry(
    torsoProfile(bottomY, topY, offset),
    Math.max(5, Math.round(arc * 10)),
    at - arc / 2,
    arc,
  );
}

/** A group whose contents take the torso's oval section rather than a circle. */
function shellGroup(): THREE.Group {
  const group = new THREE.Group();
  group.scale.z = TORSO_DEPTH;
  return group;
}

/**
 * A limb sleeve: a tapered tube laid along an arm or a leg.
 *
 * `from` and `to` are fractions of the limb's length measured from its joint,
 * so a knee pad and a boot cuff are written in the same units as the limb they
 * ride and cannot drift when one of them moves.
 */
function limbSleeve(
  limb: typeof ARM | typeof LEG,
  side: -1 | 1,
  from: number,
  to: number,
  radiusFrom: number,
  radiusTo: number,
  open = false,
): THREE.Mesh {
  const dir = new THREE.Vector3(limb.dir.x * side, limb.dir.y, limb.dir.z);
  const length = (to - from) * limb.length;
  // The cylinder is laid against the limb by mapping its +Y onto the limb's
  // OPPOSITE direction: both limbs point close enough to straight down that
  // mapping onto the direction itself is near-antiparallel, where
  // setFromUnitVectors falls back to an arbitrary perpendicular axis. The
  // radii swap to match, so radiusFrom stays at the joint end.
  const mesh = part(tube(radiusFrom, radiusTo, Math.abs(length), 18, open), "main");
  mesh.position.copy(dir).multiplyScalar(((from + to) / 2) * limb.length);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().negate());
  return mesh;
}

/** A blob positioned somewhere along a limb, for pads, cuffs and pockets. */
function limbPoint(
  limb: typeof ARM | typeof LEG,
  side: -1 | 1,
  at: number,
): THREE.Vector3 {
  return new THREE.Vector3(limb.dir.x * side, limb.dir.y, limb.dir.z).multiplyScalar(
    at * limb.length,
  );
}

function armRadius(at: number): number {
  return ARM.shoulderRadius + (ARM.wristRadius - ARM.shoulderRadius) * at;
}

function legRadius(at: number): number {
  return LEG.hipRadius + (LEG.ankleRadius - LEG.hipRadius) * at;
}

// --- Sockets ----------------------------------------------------------------

export const SOCKETS = {
  head: "Head mass__pivot",
  neck: "Neck__pivot",
  torso: "Torso__pivot",
  armLeft: "Arm left__pivot",
  armRight: "Arm right__pivot",
  handRight: "Hand right__pivot",
  legLeft: "Leg left__pivot",
  legRight: "Leg right__pivot",
  pelvis: "Leg mass__pivot",
  shoeLeft: "Sneaker left__pivot",
  shoeRight: "Sneaker right__pivot",
  shoulderLeft: "Shoulder cap left__pivot",
  shoulderRight: "Shoulder cap right__pivot",
} as const;

const ARM_SOCKETS = [
  [SOCKETS.armLeft, -1],
  [SOCKETS.armRight, 1],
] as const;
const LEG_SOCKETS = [
  [SOCKETS.legLeft, -1],
  [SOCKETS.legRight, 1],
] as const;
const SHOE_SOCKETS = [
  [SOCKETS.shoeLeft, -1],
  [SOCKETS.shoeRight, 1],
] as const;
const SHOULDER_SOCKETS = [
  [SOCKETS.shoulderLeft, -1],
  [SOCKETS.shoulderRight, 1],
] as const;

interface Spec {
  readonly socket: string;
  /** Cache key. Two runners in the same hat share one built template. */
  readonly key: string;
  readonly build: () => THREE.Group;
}

const templates = new Map<string, THREE.Group>();

function templateFor(spec: Spec): THREE.Group {
  let group = templates.get(spec.key);
  if (!group) {
    group = spec.build();
    group.name = `Wardrobe ${spec.key}`;
    templates.set(spec.key, group);
  }
  return group;
}

function group(...children: THREE.Object3D[]): THREE.Group {
  const node = new THREE.Group();
  for (const child of children) node.add(child);
  return node;
}

// --- Headwear ---------------------------------------------------------------

/**
 * The lowest a hat may hang IN FRONT OF the eyes.
 *
 * A hat band is a ring at radius 0.33 or more and the face it goes round is
 * only 0.29 deep, so a band level with the eyes passes in front of them and the
 * runner wears the hat as a blindfold. Five did: the beanie's 0.145-deep cuff
 * covered both eyes outright, the bobble's, the helmet's and the bucket's brim
 * each crossed the eye line, and the earmuff band - which its own comment
 * describes as passing behind the head - came over the top and ended in a spike
 * on the bridge of the nose.
 *
 * None of that is visible in a box measurement, because every one of those hats
 * is exactly where a hat goes. It survived until the figure was photographed
 * wearing them. wardrobe.test.ts now measures the vertices instead.
 *
 * A crown is free to wrap as low as it likes: it hugs the skull, so by the
 * depth of the eyes it has already drawn back inside them.
 */
export const HAT_FACE_MIN_Y = HEAD.eye.y - 0.01;

/** A crown that clears the sculpt's own hair, whatever shape sits on top. */
function hatCrown(lift: number, height: number, spread = 0.014): THREE.Mesh {
  return part(
    ball(HEAD.hairRadii.x + spread, height, HEAD.hairRadii.z + spread),
    "main",
    new THREE.Vector3(0, HEAD.hairCenter.y + lift, HEAD.hairCenter.z),
  );
}

function headwearParts(id: AvatarHeadwearId): THREE.Object3D[] {
  switch (id) {
    case "hair":
      return [];
    case "cap": {
      // wear-cap.png: a mint SIX-PANEL crown under a navy curved brim, with a
      // coral button at the apex. The brim is the reference's contrast piece,
      // which is why it is trim rather than main. The crown used to be the
      // bare ellipsoid every other hat starts from; the reference's panel
      // seams and eyelets are what make it a ball cap rather than a dome, so
      // three seam arcs now quarter the crown and an eyelet sits mid-panel.
      const crown = hatCrown(0.005, 0.25);
      const seams: THREE.Object3D[] = [];
      for (let index = 0; index < 3; index += 1) {
        const seam = part(ring(0.365, 0.0055, Math.PI), "trim", {
          x: 0, y: 0.108, z: -0.012,
        });
        seam.scale.y = 0.69;
        seam.rotation.y = (index * Math.PI) / 3;
        seams.push(seam);
      }
      const eyelets: THREE.Object3D[] = [];
      for (let index = 0; index < 6; index += 1) {
        const angle = Math.PI / 6 + (index * Math.PI) / 3;
        // On the ellipsoid's own surface at 0.68 of its height, where the
        // horizontal section has radius rx*sqrt(1-0.68^2) = 0.263.
        eyelets.push(
          part(ball(0.013, 0.013, 0.013), "trim", {
            x: Math.cos(angle) * 0.267,
            y: 0.278,
            z: -0.012 + Math.sin(angle) * 0.263,
          }),
        );
      }
      const brim = part(roundedSlab(0.43, 0.026, 0.34), "trim", {
        x: 0, y: 0.018, z: 0.31,
      });
      brim.rotation.x = -0.09;
      // One stitch row following the brim's curve, the navy piece's only
      // interior detail in the reference.
      const stitch = part(ring(0.155, 0.0045), "cream", { x: 0, y: 0.034, z: 0.318 });
      stitch.rotation.x = Math.PI / 2 - 0.09;
      stitch.scale.y = 0.8;
      const button = part(ball(0.032, 0.026, 0.032), "cream", { x: 0, y: 0.35, z: -0.012 });
      return [crown, ...seams, ...eyelets, brim, stitch, button];
    }
    case "band":
      return [
        (() => {
          const band = part(ring(0.33, 0.034), "main", { x: 0, y: 0.075, z: -0.01 });
          band.rotation.x = Math.PI / 2;
          band.scale.z = 0.99;
          return band;
        })(),
      ];
    case "bobble": {
      const cuff = part(tube(0.352, 0.352, 0.09, 22), "trim", { x: 0, y: 0.002, z: -0.012 });
      // Rib ticks the whole way round the fold, so the knit read survives the
      // turn instead of stopping at the front five slabs on the crown.
      // Positions are in the cuff's own frame: it already carries the hat's
      // -0.012 z offset, so the ribs only need their place on its wall.
      for (let index = 0; index < 12; index += 1) {
        const angle = (index / 12) * Math.PI * 2;
        const rib = part(slab(0.011, 0.08, 0.011), "main", {
          x: Math.sin(angle) * 0.354,
          y: 0,
          z: Math.cos(angle) * 0.354,
        });
        rib.rotation.y = angle;
        cuff.add(rib);
      }
      const pom = part(ball(0.102, 0.102, 0.102), "trim", { x: 0, y: 0.43, z: -0.012 });
      const tie = part(tube(0.022, 0.028, 0.065, 10), "trim", { x: 0, y: 0.355, z: -0.012 });
      const crown = hatCrown(0.02, 0.3);
      crown.userData["wardrobeTint"] = "knit";
      for (const x of [-0.22, -0.11, 0, 0.11, 0.22])
        crown.add?.(part(slab(0.012, 0.17, 0.012), "trim", { x, y: 0.11, z: 0.23 }));
      return [crown, cuff, tie, pom];
    }
    case "bucket": {
      // wear-buckethat.png: a tall crown with STRAIGHT sides and a FLAT top, a
      // lavender band where it meets the brim, and a wide brim turned down.
      //
      // The crown was hatCrown's ellipsoid, and a domed crown under a flat brim
      // is a bowler - which is what it was drawing, and is a hat this catalogue
      // does not otherwise have, so the two were being told apart by nothing.
      // A closed cylinder gives the straight side and the flat top for one
      // primitive; its bottom radius is sized to swallow the sculpt's own hair
      // cap, which reaches HEAD.hairRadii.x at HEAD.hairCenter.y.
      // The brim rides on the brow rather than across the eyes, which is the
      // whole reason the crown is 0.40 deep rather than the 0.42 that reached
      // the hair on its own: the crown has to stop where the brim starts.
      const crown = part(tube(0.305, 0.37, 0.31, 24), "main", {
        x: 0,
        y: HEAD.hairCenter.y + 0.025,
        z: HEAD.hairCenter.z,
      });
      const band = part(tube(0.373, 0.373, 0.045, 24), "trim", { x: 0, y: -0.002, z: -0.012 });
      const brim = part(tube(0.37, 0.45, 0.065, 24), "main", { x: 0, y: -0.018, z: -0.01 });
      return [crown, band, brim];
    }
    case "beanie": {
      // wear-beanie.png: a knitted crown over a deep folded brim in cream, the
      // brim about a third of the hat's height rather than a thin band.
      // Rides on the forehead, not over the eyes: at the reference's depth a
      // cuff centred where this one was reached HEAD.eye.y and 0.05u below it.
      const cuff = part(tube(0.366, 0.366, 0.145, 22), "cream", { x: 0, y: 0.024, z: -0.012 });
      // The folded brim is a third of the hat and it was a featureless band;
      // rib ticks in the hat's own colour are what say knit at this scale.
      // In the cuff's own frame, which already carries the hat's offsets.
      for (let index = 0; index < 12; index += 1) {
        const angle = (index / 12) * Math.PI * 2;
        const rib = part(slab(0.012, 0.132, 0.012), "main", {
          x: Math.sin(angle) * 0.368,
          y: 0,
          z: Math.cos(angle) * 0.368,
        });
        rib.rotation.y = angle;
        cuff.add(rib);
      }
      const crown = hatCrown(0.015, 0.3);
      crown.userData["wardrobeTint"] = "knit";
      return [crown, cuff];
    }
    case "visor": {
      // Rebuilt from the 2026-08-03 report ("the brim should be connected to
      // the band"). The old circular band (0.353) hid completely inside the
      // classic-crop hair, the 200-degree paper-thin brim sliced through the
      // hair with its tips out the back of the skull, and the band and brim
      // carried different x-squashes, so they parted company at the temples.
      // One group now owns band and brim under a single ellipse: the band
      // rides outside the hair, the brim's inner edge starts inside the
      // band's tube, and the arc stops at the temples.
      const seat = new THREE.Group();
      // 0.44: outside the classic crop's fringe, which swallowed the 0.40
      // band at the brow and cut the brim off from it.
      const band = part(ring(0.44, 0.036), "trim", { x: 0, y: 0, z: 0 });
      band.rotation.x = Math.PI / 2;
      const ARC = 2.7;
      const ARC_START = Math.PI / 2 - ARC / 2;
      const brimSeat = new THREE.Group();
      const brim = part(
        new THREE.RingGeometry(0.41, 0.56, 28, 1, ARC_START, ARC),
        "main",
        { x: 0, y: 0, z: 0 },
      );
      // A second skin 0.012 below the first: a lone RingGeometry is a
      // zero-thickness plane and the brim vanished edge-on from the front.
      const brimUnder = part(
        new THREE.RingGeometry(0.41, 0.56, 28, 1, ARC_START, ARC),
        "main",
        { x: 0, y: 0, z: 0.012 },
      );
      const edgeRoll = part(ring(0.548, 0.013, ARC), "main", { x: 0, y: 0, z: 0.006 });
      edgeRoll.rotation.z = ARC_START;
      brimSeat.add(brim, brimUnder, edgeRoll);
      brimSeat.position.set(0, -0.006, 0);
      brimSeat.rotation.x = Math.PI / 2 + 0.21;
      const adjuster = part(slab(0.055, 0.045, 0.02), "cream", {
        x: 0, y: 0, z: -0.455,
      });
      seat.add(band, brimSeat, adjuster);
      seat.position.set(0, 0.075, -0.01);
      // Elliptical, not circular: the silhouette suite caps |x| at 0.47 in
      // world units and the head socket's cancelled scale amplifies authored
      // x by ~1.16. Applied to the whole seat so the band squashes WITH the
      // brim instead of parting from it at the temples; 0.71 with the 0.56
      // outer edge is what keeps the whole hat inside that cap.
      seat.scale.x = 0.71;
      return [seat];
    }
    case "helmet": {
      return [createHeadwearUpgradeModel("helmet")];
    }
    case "tophat": {
      const brim = part(tube(0.4, 0.4, 0.026, 26), "main", { x: 0, y: 0.13, z: -0.01 });
      const stack = part(tube(0.268, 0.268, 0.34, 22), "main", { x: 0, y: 0.3, z: -0.01 });
      const band = part(ring(0.272, 0.026), "trim", { x: 0, y: 0.165, z: -0.01 });
      band.rotation.x = Math.PI / 2;
      const topLip = part(ring(0.27, 0.018), "trim", { x: 0, y: 0.47, z: -0.01 });
      topLip.rotation.x = Math.PI / 2;
      const buckle = part(slab(0.065, 0.052, 0.02), "cream", { x: 0, y: 0.165, z: 0.273 });
      return [brim, stack, band, topLip, buckle];
    }
    case "crown": {
      return [createHeadwearUpgradeModel("crown")];
    }
    case "cowboy": {
      // Seat transform on the CALLER, not in the generated factory: the
      // authored crown is narrower than the runner's skull, and the
      // 2026-08-03 report showed the head bulging out BEHIND the brim. The
      // stretch is almost entirely front-to-back because that is where the
      // bleed was, and because the silhouette suite caps |x| at 0.47 - the
      // authored hat already reaches 0.46 there. The generated file itself
      // stays untouched.
      const hat = createHeadwearUpgradeModel("cowboy");
      hat.scale.set(1.02, 1.06, 1.18);
      hat.position.y = -0.025;
      return [hat];
    }
    case "earmuffs": {
      return [createHeadwearUpgradeModel("earmuffs")];
    }
    case "beret": {
      return [createHeadwearUpgradeModel("beret")];
    }
    case "headphones": {
      // wear-headphones.png: a padded band over the crown in the contrast
      // colour, cups in the main colour, cream ear pads. The band is left in
      // its own XY plane, unlike the earmuffs' behind-the-head band, because
      // the reference arcs left to right over the top of the head.
      const band = part(ring(0.385, 0.044, Math.PI), "trim", { x: 0, y: -0.025, z: -0.045 });
      const cushion = part(ring(0.335, 0.026, Math.PI * 0.72), "cream", { x: 0, y: 0.025, z: -0.035 });
      cushion.rotation.z = Math.PI * 0.14;
      const cup = (side: -1 | 1) => {
        const slider = part(slab(0.035, 0.16, 0.045), "steel", {
          x: side * 0.365,
          y: 0.005,
          z: -0.038,
        });
        const shell = part(ball(0.07, 0.13, 0.105), "main", {
          x: side * 0.375,
          y: -0.09,
          z: -0.012,
        });
        // Seated a few thousandths inside the 0.325u skull, which is a pad
        // pressing on a head rather than a pad hovering beside one.
        const pad = part(tube(0.088, 0.088, 0.032, 18), "cream", {
          x: side * 0.326,
          y: -0.09,
          z: -0.012,
        });
        pad.rotation.z = Math.PI / 2;
        const badge = part(tube(0.042, 0.042, 0.018, 16), "glow", {
          x: side * 0.438,
          y: -0.09,
          z: -0.012,
        });
        badge.rotation.z = Math.PI / 2;
        return group(slider, shell, pad, badge);
      };
      return [band, cushion, cup(-1), cup(1)];
    }
  }
}

// --- Face -------------------------------------------------------------------

function browBar(side: -1 | 1, lift: number, tilt: number): THREE.Mesh {
  const bar = part(slab(0.105, 0.026, 0.022), "main", {
    x: side * 0.11,
    y: HEAD.eye.y + lift,
    z: 0.281,
  });
  bar.rotation.z = -side * tilt;
  // Yawed so the outer end follows the skull instead of lifting off it: a
  // straight slab tangent to a sphere floats at the temple and vanishes in
  // profile.
  bar.rotation.y = side * 0.24;
  return bar;
}

function facePartsFor(id: AvatarFaceId): THREE.Object3D[] {
  switch (id) {
    case "plain":
      return [];
    case "grin": {
      return [createHeadwearUpgradeModel("grin")];
    }
    case "focused":
      return [browBar(-1, 0.072, 0.34), browBar(1, 0.072, 0.34)];
    case "shades": {
      const lens = (side: -1 | 1) =>
        part(roundedSlab(0.115, 0.062, 0.012), "glass", {
          x: side * 0.09, y: HEAD.eye.y, z: 0.296,
        });
      const bridge = part(slab(0.06, 0.014, 0.014), "main", {
        x: 0, y: HEAD.eye.y, z: 0.3,
      });
      const left = part(slab(0.02, 0.026, 0.16), "main", { x: -0.15, y: HEAD.eye.y, z: 0.21 });
      const right = part(slab(0.02, 0.026, 0.16), "main", { x: 0.15, y: HEAD.eye.y, z: 0.21 });
      return [lens(-1), lens(1), bridge, left, right];
    }
    case "brows":
      // Thinner in depth and seated closer: at rz 0.027 on z 0.295 the brow
      // mass jutted past the head in profile and read as a beak.
      return ([-1, 1] as const).map((side) => {
        const brow = part(ball(0.108, 0.035, 0.019), "main", {
          x: side * 0.112,
          y: HEAD.eye.y + 0.105,
          z: 0.287,
        });
        brow.rotation.z = side * 0.12;
        brow.rotation.y = side * 0.2;
        return brow;
      });
    case "moustache": {
      // Dropped and widened at the middle so the nose sphere no longer
      // punches through the moustache's centre seam.
      const make = (side: -1 | 1) => {
        const hair = part(ball(0.062, 0.024, 0.022), "main", {
          x: side * 0.058,
          y: -0.142,
          z: 0.278,
        });
        hair.rotation.z = -side * 0.28;
        hair.rotation.y = side * 0.18;
        return hair;
      };
      return [
        make(-1),
        make(1),
        part(ball(0.024, 0.017, 0.02), "main", { x: 0, y: -0.148, z: 0.283 }),
      ];
    }
    case "beard": {
      return [createHeadwearUpgradeModel("beard")];
    }
    case "goatee": {
      // Fuller after the 2026-08-04 evidence: the lone small chin ball read
      // as a soot smudge at catalogue scale. The patch now has real width
      // across the chin, short arms climbing the jaw on both sides, and a
      // soul patch under the lip - the parts that make "goatee" legible as
      // facial hair - while the tapered point stays inside the jaw's reach.
      const chin = part(ball(0.086, 0.06, 0.032), "main", {
        x: 0, y: -0.214, z: 0.288,
      });
      const jawArm = (side: -1 | 1) => {
        const arm = part(ball(0.032, 0.05, 0.024), "main", {
          x: side * 0.074, y: -0.196, z: 0.268,
        });
        arm.rotation.z = -side * 0.35;
        arm.rotation.y = side * 0.3;
        return arm;
      };
      const soul = part(ball(0.02, 0.02, 0.016), "main", {
        x: 0, y: -0.156, z: 0.297,
      });
      const tuft = part(new THREE.ConeGeometry(0.04, 0.09, 12), "main", {
        x: 0, y: -0.276, z: 0.282,
      });
      tuft.rotation.z = Math.PI;
      tuft.rotation.x = 0.15;
      return [chin, jawArm(-1), jawArm(1), soul, tuft];
    }
    case "freckles": {
      // Larger, deeper, and deliberately unmirrored: at 0.004 depth only two
      // of six dots survived catalog scale, and the perfect left-right mirror
      // read as machined. One dot crosses the nose bridge. Densified again
      // 2026-08-04 - seven faint dots still read as stray specks, so each
      // cheek now carries a proper cluster and every dot grew a step.
      const dot = (x: number, y: number, r = 0.018) =>
        part(ball(r, r * 0.82, 0.009), "main", { x, y, z: 0.268 });
      return [
        dot(-0.098, -0.09),
        dot(-0.062, -0.12, 0.015),
        dot(-0.124, -0.126, 0.016),
        dot(-0.088, -0.148, 0.013),
        dot(-0.142, -0.098, 0.013),
        dot(0.09, -0.098),
        dot(0.07, -0.126, 0.016),
        dot(0.126, -0.116, 0.015),
        dot(0.104, -0.146, 0.013),
        dot(0.146, -0.092, 0.012),
        dot(0.012, -0.106, 0.014),
      ];
    }
    case "warpaint": {
      // Each mark yaws to follow the cheek's curvature. At a constant z the
      // slab's inner end sat 0.024 UNDER the face while its outer end poked
      // 0.0065 past the silhouette - one mark simultaneously buried and
      // protruding. The yaw swings the outer end back onto the skull and the
      // inner end out of it.
      const stripe = (side: -1 | 1, yOffset: number) =>
        part(roundedSlab(0.122, 0.022, 0.008), "main", {
          x: side * 0.105,
          y: -0.118 + yOffset,
          z: 0.272,
        });
      const marks = ([-1, 1] as const).flatMap((side) =>
        [-0.025, 0.02].map((offset) => {
          const mark = stripe(side, offset);
          mark.rotation.z = -side * 0.16;
          mark.rotation.y = side * 0.26;
          return mark;
        }),
      );
      return marks;
    }
    case "mask": {
      return [createHeadwearUpgradeModel("mask")];
    }
  }
}

// --- Eyewear ----------------------------------------------------------------

function eyewearParts(id: AvatarEyewearId): THREE.Object3D[] {
  if (id === "none") return [];
  // The temple runs ALONG the skull's side, not through it. At x 0.152 the
  // head's own surface is at z 0.274, so 91 percent of the old arm was inside
  // the skull and the glasses had no arms in profile - measured, not eyeballed.
  const temple = (side: -1 | 1) => {
    // 0.352, not 0.295: the skull is wider than that at eye height, so the
    // arm ran INSIDE the head and only the hinge piece surfaced - which
    // photographed as a rod stuck through the temples (2026-08-03 report).
    // The arm now hugs the outside of the head on its way back to the ear.
    const arm = part(slab(0.016, 0.02, 0.17), "main", {
      x: side * 0.352, y: HEAD.eye.y, z: 0.17,
    });
    arm.rotation.y = -side * 0.22;
    // The end piece carries the frame's outer corner back to the arm, the
    // joint a hinge would occupy on real glasses.
    const endPiece = part(slab(0.12, 0.018, 0.016), "main", {
      x: side * 0.27, y: HEAD.eye.y, z: 0.272,
    });
    endPiece.rotation.y = -side * 0.72;
    return group(arm, endPiece);
  };
  const bridge = (width: number, y: number) =>
    part(slab(width, 0.016, 0.016), "main", { x: 0, y, z: 0.288 });
  switch (id) {
    case "round": {
      const lens = (side: -1 | 1) => {
        const rim = part(ring(0.061, 0.013), "main", {
          x: side * HEAD.eye.x,
          y: HEAD.eye.y,
          z: 0.292,
        });
        const glass = part(tube(0.056, 0.056, 0.01, 18), "glass", {
          x: side * HEAD.eye.x,
          y: HEAD.eye.y,
          z: 0.29,
        });
        glass.rotation.x = Math.PI / 2;
        return group(rim, glass);
      };
      return [lens(-1), lens(1), bridge(0.09, HEAD.eye.y), temple(-1), temple(1)];
    }
    case "square": {
      const lens = (side: -1 | 1) => {
        const x = side * HEAD.eye.x;
        const width = 0.12;
        const height = 0.094;
        const edge = 0.014;
        return group(
          part(slab(width - edge * 2, height - edge * 2, 0.009), "glass", {
            x, y: HEAD.eye.y, z: 0.298,
          }),
          part(slab(width, edge, 0.018), "main", {
            x, y: HEAD.eye.y + height / 2, z: 0.3,
          }),
          part(slab(width, edge, 0.018), "main", {
            x, y: HEAD.eye.y - height / 2, z: 0.3,
          }),
          part(slab(edge, height, 0.018), "main", {
            x: x - width / 2, y: HEAD.eye.y, z: 0.3,
          }),
          part(slab(edge, height, 0.018), "main", {
            x: x + width / 2, y: HEAD.eye.y, z: 0.3,
          }),
        );
      };
      return [lens(-1), lens(1), bridge(0.085, HEAD.eye.y), temple(-1), temple(1)];
    }
    case "goggles": {
      return [createHeadwearUpgradeModel("goggles")];
    }
    case "aviator": {
      return [createHeadwearUpgradeModel("aviator")];
    }
    case "visorband": {
      return [createHeadwearUpgradeModel("visorband")];
    }
  }
}

// --- Tops -------------------------------------------------------------------

/**
 * Where the shoulder cap socket sits in the torso's own frame.
 *
 * Measured off the built rig at world 1.140u against a torso origin of 0.950u,
 * and pinned by wardrobe.test.ts. It is here so a band written in torso
 * heights - the same numbers the body shell uses - can be placed on a cap that
 * hangs from a different socket.
 */
const SHOULDER_Y = 1.14 - TORSO_ORIGIN_Y;

function shoulderPad(
  radius: number,
  tint: WardrobeTint,
  /** Body bands to carry across the cap, in the torso's frame. */
  bands: readonly (readonly [bottom: number, top: number])[] = [],
): THREE.Group {
  const cap = group(part(ball(radius, radius, radius), tint));
  for (const [bottom, top] of bands) {
    const low = bottom - SHOULDER_Y;
    const high = top - SHOULDER_Y;
    if (high <= -radius || low >= radius) continue;
    // A hair proud of the cap, so the band wins the depth test against the
    // sphere it is painted on rather than fighting it.
    cap.add(part(ballBand(radius + 0.002, low, high), "cream"));
  }
  return cap;
}

function sleeve(
  side: -1 | 1,
  to: number,
  tint: WardrobeTint,
  /** Cuff depth as a fraction of the arm, and its radius over the bare arm. */
  cuff: readonly [depth: number, proud: number] = [0.06, 0.023],
  /** Where body hoops carry on across the sleeve, and how deep each is. */
  hoops: readonly (readonly [at: number, depth: number])[] = [],
  /** Radial clearance over the bare arm; outer layers use a larger value. */
  clearance = 0.015,
): THREE.Group {
  const mesh = limbSleeve(
    ARM,
    side,
    0.06,
    to,
    armRadius(0.06) + clearance,
    armRadius(to) + clearance,
  );
  mesh.userData["wardrobeTint"] = tint;
  // Every sleeve in the reference set ends in a band - rolled on the tee and
  // the jacket, ribbed on the hoodie - so the cuff is on the shared builder
  // rather than repeated per garment.
  const band = limbSleeve(
    ARM,
    side,
    to - cuff[0],
    to + 0.02,
    armRadius(to) + Math.max(cuff[1], clearance + 0.008),
    armRadius(to) + Math.max(cuff[1], clearance + 0.008),
  );
  band.userData["wardrobeTint"] = "trim";
  const result = group(mesh, band);
  for (const [at, depth] of hoops) {
    const stripe = limbSleeve(
      ARM,
      side,
      at,
      at + depth,
      armRadius(at) + 0.019,
      armRadius(at + depth) + 0.019,
    );
    stripe.userData["wardrobeTint"] = "cream";
    result.add(stripe);
  }
  return result;
}

/**
 * Where wear-jersey.png's cream hoops fall, in the torso's own frame.
 *
 * Six equal bands over the shell's height with every other one cream, so the
 * hoops land as a repeat rather than at three heights chosen one at a time,
 * and the top band stays the body colour - which is what puts a solid shoulder
 * under the collar the way the reference does.
 *
 * Shared with the shoulder cap rather than restated there. The cap crosses the
 * top hoop and stands outside the shell over part of it, so the two lists have
 * to agree or the band breaks at the seam; wardrobe.test.ts measures that they
 * still do.
 */
const JERSEY_HOOPS: readonly (readonly [bottom: number, top: number])[] = [0, 2, 4].map(
  (index) => {
    const depth = (0.26 - HEM) / 6;
    return [HEM + index * depth, HEM + (index + 1) * depth] as const;
  },
);

/**
 * The fine stripe, which has no reference and exists to not be the jersey.
 *
 * Same construction, half the pitch: thirteen bands over the same height with
 * every other one cream, against the jersey's six. A hoop that deep is a rugby
 * shirt and this one is a Breton, which is the whole of the difference between
 * two options that would otherwise be one option listed twice.
 */
const BRETON_BANDS: readonly (readonly [bottom: number, top: number])[] = [
  1, 3, 5, 7, 9, 11,
].map((index) => {
  const depth = (0.26 - HEM) / 13;
  return [HEM + index * depth, HEM + (index + 1) * depth] as const;
});

function topShellParts(id: AvatarTopId): THREE.Object3D[] {
  const shell = shellGroup();
  switch (id) {
    case "none":
      return [];
    case "tee": {
      // wear-tee.png: one broad cream band across the chest, not a stripe at
      // the hem. It is the whole of the shirt's second colour.
      shell.add(part(torsoShell(HEM, 0.315, 0.014), "main"));
      shell.add(part(torsoShell(0.03, 0.115, 0.019), "cream"));
      // A rolled hem, so the shirt ENDS somewhere visible instead of fading
      // into the body: without an edge the tee photographed as paint.
      const hemRoll = part(ring(torsoRadius(HEM) + 0.018, 0.011), "main", {
        x: 0, y: HEM + 0.013, z: 0,
      });
      hemRoll.rotation.x = Math.PI / 2;
      hemRoll.userData["wardrobeNoOutline"] = true;
      shell.add(hemRoll);
      return [shell];
    }
    case "tank": {
      return [createWearableUpgradeModel("tank")];
    }
    case "stripes": {
      // No reference. Three deep bands in the derived trim read as shading on
      // the body rather than as stripes, and what they read as MOST was the
      // jersey with its collar taken off. Cream at the jersey's own pitch
      // halved is a stripe you can see and cannot mistake for a hoop.
      shell.add(part(torsoShell(HEM, 0.315, 0.014), "main"));
      // 0.0165 against the shell's 0.014: enough to win the depth test,
      // small enough that the silhouette's edge stays smooth. At 0.019 each
      // band stood 0.005 proud and the profile edge read as corrugated.
      for (const [bottom, top] of BRETON_BANDS)
        shell.add(part(torsoShell(bottom, top, 0.0165), "cream"));
      return [shell];
    }
    case "hoodie": {
      // wear-hoodie.png: a royal-blue pullover, a ribbed hem, a light kangaroo
      // pocket and two cream drawstrings. The pocket is the reference's light
      // piece rather than its dark one, which is why it is cream where the hem
      // rib is trim.
      shell.add(part(torsoShell(HEM, 0.315, 0.016), "knit"));
      shell.add(part(torsoShell(HEM, HEM + 0.04, 0.023), "trim"));
      // wear-hoodie.png's pocket is a SOLID contrast trapezoid standing proud
      // of the body, not an outline: the thin half-torus that used to draw the
      // opening photographed as a grey frown floating on a plain chest. The
      // panel is cream because the pocket is the reference's light piece.
      const pocket = part(roundedSlab(0.21, 0.115, 0.032), "cream", {
        x: 0, y: -0.06, z: (torsoRadius(-0.06) + 0.024) * TORSO_DEPTH,
      });
      pocket.rotation.x = -0.1;
      // A worn-down hood is a POUCH: it opens UPWARD at a rim collar behind
      // the neck and its mass hangs down the back. Both previous versions
      // were upper half-domes - bowls upside down over the shoulders, which
      // is exactly what the user called them. The full tilted rim ring reads
      // as the hood's opening from every bearing (no cut arc ends to become
      // shoulder fins), and the flipped dome under it is the hanging bag.
      const hoodRim = part(ring(0.162, 0.026), "trim", {
        x: 0, y: 0.275, z: -0.135,
      });
      hoodRim.rotation.x = Math.PI / 2 - 0.5;
      const hood = part(dome(0.175, 0.15, 0.14), "knit", {
        x: 0, y: 0.272, z: -0.2,
      });
      hood.rotation.x = Math.PI;
      const hoodFold = part(ball(0.125, 0.05, 0.09), "knit", {
        x: 0, y: 0.252, z: -0.252,
      });
      // Chunky drawcords ending in aglets, the reference's most recognisable
      // small detail. Fatter than the 0.011 threads that vanished at picker
      // scale.
      const drawstring = (side: -1 | 1) =>
        group(
          part(tube(0.014, 0.014, 0.125, 8), "cream", {
            x: side * 0.055,
            y: 0.16,
            z: 0.213,
          }),
          part(tube(0.018, 0.018, 0.034, 8), "cream", {
            x: side * 0.055,
            y: 0.085,
            z: 0.213,
          }),
        );
      return [shell, pocket, hood, hoodRim, hoodFold, drawstring(-1), drawstring(1)];
    }
    case "jersey": {
      // wear-jersey.png: a rugby shirt - cream hoops of the same depth as the
      // blue between them, running the whole way round the body and on across
      // the sleeve, under a cream polo collar with a short placket. What was
      // here was a single panel across the front, which is a different garment.
      //
      // Six equal bands over the body's own height, so the hoops land the way
      // the reference's do rather than at heights picked one at a time. The
      // top band is left in the main colour, which is what puts a solid
      // shoulder under the collar.
      shell.add(part(torsoShell(HEM, 0.315, 0.014), "main"));
      for (const [bottom, top] of JERSEY_HOOPS)
        shell.add(part(torsoShell(bottom, top, 0.0165), "cream"));
      // The placket hugs the shell the way the hoops do. It used to be a
      // plate() at one fixed radius, which stood 0.033u off the chest where
      // the torso has already narrowed: photographed, it read as a cream
      // rectangle floating at the collarbone, and it buried its own buttons.
      shell.add(part(torsoStripe(0.09, 0.26, 0.024, 0.36, 0), "cream"));
      shell.add(
        part(ball(0.015, 0.015, 0.01), "trim", {
          x: 0, y: 0.2, z: torsoRadius(0.2) + 0.035,
        }),
      );
      shell.add(
        part(ball(0.015, 0.015, 0.01), "trim", {
          x: 0, y: 0.145, z: torsoRadius(0.145) + 0.035,
        }),
      );
      return [shell];
    }
    case "overalls": {
      // wear-overalls.png: a bib with a patch pocket on it and one square
      // buckle where each strap meets the bib. The buckles are the light piece.
      // Shell stand-off 0.02, up from 0.016, and the trouser top raised to
      // 0.10: at 0.016 the run cycle's torso lean pushed the body through the
      // denim (2026-08-03 report), and the taller waist keeps the bib's
      // sides from opening a bare band at the hip.
      shell.add(part(torsoShell(HEM, 0.1, 0.02), "denim"));
      shell.add(part(plate(0.28, 0.17, 1.35), "denim", { x: 0, y: 0.16, z: 0 }));
      shell.add(part(plate(0.292, 0.1, 0.8), "trim", { x: 0, y: 0.155, z: 0 }));
      // The bib is the same denim as the body panel behind it, so its top
      // edge carries a cream stitch line to separate the two, and a button
      // fastens each hip the way real overalls close.
      shell.add(part(plate(0.287, 0.012, 1.3), "cream", { x: 0, y: 0.238, z: 0 }));
      for (const side of [-1, 1] as const) {
        const angle = side * 1.05;
        const radius = torsoRadius(0.045) + 0.024;
        shell.add(
          part(ball(0.017, 0.017, 0.012), "cream", {
            x: Math.sin(angle) * radius,
            y: 0.045,
            z: Math.cos(angle) * radius,
          }),
        );
      }
      const buckle = (side: -1 | 1) =>
        part(slab(0.036, 0.036, 0.022), "cream", { x: side * 0.1, y: 0.225, z: 0.185 });
      return [shell, buckle(-1), buckle(1), tankStrap(-1), tankStrap(1)];
    }
    case "turtleneck":
      // wear-turtleneck.png: a heavy knit, so the shell stands half again as
      // far off the body as a tee's does and gathers into a deep rib at the
      // hem. The rib is the body's own colour because the reference's is - the
      // whole of that sweater's second colour is at the cuffs - so it is given
      // its edge by standing proud rather than by contrast.
      shell.add(part(torsoShell(HEM, 0.315, 0.022), "knit"));
      shell.add(part(torsoShell(HEM, HEM + 0.06, 0.032), "knit"));
      return [shell];
    case "racer": {
      // No reference. Two stripes running the LENGTH of the body, which is
      // what a racing stripe is. What was here was two short bars across the
      // chest at one radius: they stood off the body where it narrowed, they
      // stopped at the front, and at a glance they read as two dashes stuck on
      // a plain shirt rather than as any garment at all.
      shell.add(part(torsoShell(HEM, 0.315, 0.0165), "main"));
      // Wider than the first cut: at 0.3rad the pair read as two chalk lines.
      // 0.42rad each with the same gap between them is the proportion racing
      // stripes actually carry, and a thin trim edge either side of the pair
      // gives them the painted-on-panel read.
      for (const at of [-0.29, 0.29])
        shell.add(part(torsoStripe(HEM, 0.255, 0.022, 0.42, at), "cream"));
      for (const at of [-0.62, 0.62])
        shell.add(part(torsoStripe(HEM, 0.255, 0.02, 0.07, at), "trim"));
      return [shell];
    }
  }
}

/** An over-the-shoulder strap, arcing front to back where a strap would. */
function tankStrap(side: -1 | 1): THREE.Mesh {
  const strap = part(ring(0.115, 0.024, Math.PI), "main", {
    x: side * 0.152,
    y: 0.155,
    z: 0,
  });
  strap.rotation.y = Math.PI / 2;
  return strap;
}

/**
 * Tops whose cuff is deeper than the rolled band a sleeve gets by default.
 *
 * Only the turtleneck has one. wear-turtleneck.png puts the whole of that
 * sweater's second colour at the wrists, in a chunky cuff folded back over
 * about a seventh of the sleeve, where every other reference in the set ends
 * its sleeve in a thin band.
 */
const DEEP_CUFFS: Partial<Record<AvatarTopId, readonly [depth: number, proud: number]>> = {
  turtleneck: [0.15, 0.032],
};

const TOP_SLEEVES: Partial<Record<AvatarTopId, number>> = {
  tee: 0.34,
  stripes: 0.34,
  racer: 0.3,
  // wear-jersey.png is long-sleeved, cuffed at the wrist. It was short here.
  jersey: 0.98,
  hoodie: 0.98,
  turtleneck: 0.98,
};

/**
 * Tops whose body hoops carry on across the sleeve.
 *
 * Only the jersey has them: wear-jersey.png runs the same cream bands round
 * the arm that it runs round the body, and a hooped body on a plain sleeve
 * reads as a shirt with a panel stuck to it rather than as a rugby shirt.
 */
const SLEEVE_HOOPS: Partial<
  Record<AvatarTopId, readonly (readonly [at: number, depth: number])[]>
> = {
  jersey: [[0.22, 0.12], [0.48, 0.12], [0.74, 0.12]],
  stripes: [[0.12, 0.045], [0.22, 0.045]],
};

/** Tops whose body bands have to carry on across the shoulder cap. */
const SHOULDER_BANDS: Partial<
  Record<AvatarTopId, readonly (readonly [bottom: number, top: number])[]>
> = {
  jersey: JERSEY_HOOPS,
  stripes: BRETON_BANDS,
};

/**
 * Collars ride the neck rather than the torso.
 *
 * Neck__pivot carries unit scale and the torso does not, so a ring built under
 * the torso would come out oval around a round neck. The neck is also static
 * while the torso twists, which is the right behaviour for a collar: it belongs
 * to the head end of the body, not the ribcage.
 */
function collarParts(id: AvatarTopId): THREE.Object3D[] {
  switch (id) {
    case "tee":
      // wear-tee.png: a ribbed crew neck in the shirt's own colour. Reaches
      // lower than it first did - a bare ring of body showed between the
      // shell's top edge and the collar's bottom.
      return [part(tube(0.168, 0.174, 0.065, 18, true), "main", { x: 0, y: -0.005, z: 0 })];
    case "turtleneck":
      // wear-turtleneck.png: the collar is the garment - a tall stand that
      // widens as it rises and rolls over on itself at the top, wide enough to
      // read as knitwear rather than as a neckband. The neck it stands on runs
      // 1.235u to 1.390u and is 0.14u through, so the roll's top edge is set
      // just under the jaw: a collar the head meets when it tilts is what a
      // roll-neck is, and a collar past 1.39u would be one inside the chin.
      // Raised a hair from the first cut: a violet gap showed between the
      // roll and the jaw, and a turtleneck the head visibly clears is a crew
      // neck with ambitions.
      return [
        part(tube(0.186, 0.168, 0.148, 18, true), "main", { x: 0, y: 0.062, z: 0 }),
        (() => {
          // Top of the roll lands at 1.389u world - the suite caps collars at
          // the 1.39u jaw line, and this sits as close under it as the cap
          // allows.
          const roll = part(ring(0.182, 0.027), "main", { x: 0, y: 0.127, z: 0 });
          roll.rotation.x = Math.PI / 2;
          return roll;
        })(),
      ];
    case "hoodie": {
      // A soft torus roll, not a stand funnel: a hoodie's neckband is a
      // folded rib that hugs the collarbone, and the open tube this replaces
      // read as a parka collar standing proud of the body.
      const band = part(ring(0.19, 0.026), "trim", { x: 0, y: 0.02, z: 0 });
      band.rotation.x = Math.PI / 2;
      return [band];
    }
    case "jersey":
      // wear-jersey.png: a cream polo collar that lies flat and spreads as it
      // rises, open at the front where the placket is. Cut on the same partial
      // arc the jacket collar uses, for the same reason: a closed ring here
      // would shut a throat the reference leaves open.
      //
      // The reference's collar is a rolled fold hugging the neck, open at a
      // small front notch where two points turn down. Both flat-walled
      // versions of this failed on camera: the original 2.4rad funnel hid
      // behind the skull, and a wider funnel showed its own cut ends as grey
      // fins over the shoulders. A torus arc has no cut face to catch the
      // light - its ends are rounded - so the roll reads as cloth from every
      // angle the picker offers.
      return [
        (() => {
          const wrap = new THREE.Group();
          const roll = part(ring(0.19, 0.034, Math.PI * 2 - 1.0), "cream", {
            x: 0, y: 0.055, z: 0,
          });
          roll.rotation.x = Math.PI / 2;
          wrap.add(roll);
          // Shift the arc's start so its 1.0rad gap faces the front notch.
          wrap.rotation.y = -(Math.PI / 2 + 0.5);
          return wrap;
        })(),
        ...([-1, 1] as const).map((side) => {
          const point = part(
            new THREE.ConeGeometry(0.034, 0.08, 3),
            "cream",
            { x: side * 0.082, y: 0.012, z: 0.162 },
          );
          point.rotation.x = Math.PI;
          point.rotation.y = side * 0.45;
          return point;
        }),
      ];
    default:
      return [];
  }
}

// --- Outerwear --------------------------------------------------------------

function outerwearParts(id: AvatarOuterwearId): THREE.Object3D[] {
  const shell = shellGroup();
  switch (id) {
    case "none":
      return [];
    case "hoodie":
      // The hoodie is authored by the same factory as the legacy Top version,
      // but now rides the outer palette and clearance path so a T-shirt can
      // remain underneath it.
      return topShellParts("hoodie");
    case "jacket": {
      // wear-jacket.png: a denim jacket with a mint collar (on the neck socket
      // below), two flap chest pockets, a hem band and a row of light buttons
      // down the placket.
      shell.add(part(torsoShell(HEM, 0.315, 0.032, 0.5), "denim"));
      shell.add(part(torsoShell(HEM, HEM + 0.05, 0.038, 0.5), "trim"));
      // A fine cream line above the hem band: the reference's contrast
      // topstitching, at the one scale a single line of it still reads. Cut
      // with the same front gap as the shell so it does not bar the placket.
      shell.add(part(torsoShell(HEM + 0.052, HEM + 0.06, 0.04, 0.5), "cream"));
      // wear-jacket.png's chest pockets are two DISTINCT flapped patches with
      // a domed button each. The old pair of near-identical plates met in the
      // middle and photographed as one grey bar across the chest, so the
      // bodies stay denim, the flaps ride further out with a real gap between
      // the two, and each flap carries its button.
      const pocket = (side: -1 | 1) => {
        const body = part(plate(torsoRadius(0.05) + 0.052, 0.1, 0.4), "denim", {
          x: 0, y: 0.04, z: 0,
        });
        const flap = part(plate(torsoRadius(0.05) + 0.062, 0.048, 0.44), "trim", {
          x: 0, y: 0.095, z: 0,
        });
        const angle = side * 0.46;
        body.rotation.y = angle;
        flap.rotation.y = angle;
        const buttonRadius = torsoRadius(0.075) + 0.075;
        const button = part(ball(0.016, 0.016, 0.011), "cream", {
          x: Math.sin(angle) * buttonRadius,
          y: 0.078,
          z: Math.cos(angle) * buttonRadius,
        });
        button.rotation.y = angle;
        return group(body, flap, button);
      };
      shell.add(pocket(-1));
      shell.add(pocket(1));
      // Welt pockets low on the front quarters, the reference's small coral
      // accents, drawn in trim so they survive every chosen colour.
      for (const side of [-1, 1] as const) {
        const welt = part(slab(0.02, 0.075, 0.016), "trim");
        const angle = side * 0.62;
        const radius = torsoRadius(-0.1) + 0.045;
        welt.position.set(Math.sin(angle) * radius, -0.1, Math.cos(angle) * radius);
        welt.rotation.y = angle;
        welt.rotation.z = side * 0.18;
        shell.add(welt);
      }
      // A raised placket strip carrying four domed buttons, in place of the
      // thin thread-and-floating-pearls column: the buttons sit ON the strip
      // the way the reference's brass domes sit on theirs. At z 0.292 the
      // strip stays OUTSIDE an inner tee (whose shell reaches 0.276 in the
      // gap) - at the 0.262 it shipped with, the shirt drew over the placket.
      shell.add(part(roundedSlab(0.052, 0.44, 0.026), "denim", { x: 0, y: 0.045, z: 0.292 }));
      for (const y of [0.2, 0.1, 0, -0.1])
        shell.add(part(ball(0.019, 0.019, 0.013), "cream", { x: 0, y, z: 0.313 }));
      return [shell];
    }
    case "puffer": {
      return [createWearableUpgradeModel("puffer")];
    }
    case "vest": {
      return [createWearableUpgradeModel("vest")];
    }
    case "cape": {
      // wear-cape.png: a bell that flares toward the hem, a rounded collar in a
      // contrast colour, and a cream tie at the throat. The flare was the wrong
      // way round before this - wide at the shoulder and narrow at the hem -
      // which read as a sack rather than as a cape.
      const cloak = part(
        new THREE.CylinderGeometry(0.26, 0.38, 0.27 - HEM, 18, 1, true, Math.PI - 1.05, 2.1),
        "main",
        { x: 0, y: (0.27 + HEM) / 2, z: 0 },
      );
      cloak.name = "Cape cloth";
      // Cut on the cloak's own arc, so the collar opens at the front where the
      // cape does rather than closing a throat the cape leaves open.
      const collar = part(
        new THREE.CylinderGeometry(0.3, 0.26, 0.075, 18, 1, true, Math.PI - 1.25, 2.5),
        "trim",
        { x: 0, y: 0.3, z: 0 },
      );
      const tie = part(slab(0.125, 0.028, 0.028), "cream", { x: 0, y: 0.25, z: 0.185 });
      return [cloak, collar, tie];
    }
    case "poncho": {
      // wear-poncho.png: a hood over a bell that flares from the neck to a wide
      // hem, and a cream drawstring with two weighted cords under a small tab
      // at the throat. The contrast hem band that used to be here is gone: the
      // reference is one colour from hood to hem, and the cord is the whole of
      // its second colour.
      // The cone closes on the top of the torso lathe rather than on the chest.
      // Ending it at 0.27 left a band of bare body above the neckline, which
      // reads as a poncho that has slipped off the shoulders; 0.175 at 0.30 is
      // the torso's own radius where the shoulder turns over, so the cloth
      // meets the neck instead of hanging below it.
      const shoulder = 0.3;
      // 0.21, not the 0.175 that met the bare torso: with a turtleneck
      // underneath (torso + 0.022 at the shoulder turn) the narrower neck
      // put the sweater outside the cloth.
      const neckRadius = 0.21;
      const hemRadius = 0.372;
      // A lathe with a concave flare rather than a straight cone: cloth
      // hanging off shoulders accelerates outward as it falls, and the
      // straight version photographed as a lampshade. One profile drives both
      // the surface and the cord anchors below, so they cannot drift apart.
      // Wide enough that a turtleneck (torso + 0.022, hem rib + 0.032) stays
      // INSIDE at every shared height - the first profile dipped under the
      // sweater between chest and neck and the blue poked through the cloth.
      // The shoulder band then widened again (0.242 -> 0.278 at 0.21): a worn
      // top's SLEEVE caps sit further out than its torso shell, and the
      // 2026-08-03 seam matrix caught a turtleneck shoulder piercing the
      // cape's upper slope. A poncho covers the shoulders by definition, so
      // the cloth now clears the sleeve caps too.
      const PONCHO_PROFILE: readonly (readonly [number, number])[] = [
        [shoulder, neckRadius],
        [0.21, 0.278],
        [0.1, 0.292],
        [-0.02, 0.312],
        [-0.11, 0.344],
        [HEM, hemRadius],
      ];
      const cloth = part(
        new THREE.LatheGeometry(
          PONCHO_PROFILE.map(([y, radius]) => new THREE.Vector2(radius, y)),
          24,
        ),
        "knit",
        { x: 0, y: 0, z: 0 },
      );
      // The hood rests behind the neck. A full head-sized ellipsoid here read
      // as a second black head in profile and swallowed the face from oblique
      // angles; this folded hood stays recognisable without competing with the
      // runner's actual head.
      // The same slouched-pouch construction as the hoodie: a full tilted
      // rim ring for the opening, a flipped dome hanging behind the neck.
      // The upper half-dome both hoods used to share read as an upside-down
      // bowl on the shoulders.
      const hoodRim = part(ring(0.168, 0.028), "trim", {
        x: 0, y: 0.29, z: -0.14,
      });
      hoodRim.rotation.x = Math.PI / 2 - 0.5;
      const hood = part(dome(0.185, 0.155, 0.145), "knit", {
        x: 0, y: 0.287, z: -0.205,
      });
      hood.rotation.x = Math.PI;
      const hoodFold = part(ball(0.13, 0.052, 0.095), "knit", {
        x: 0, y: 0.265, z: -0.258,
      });
      // The cloth's own front surface at each height, interpolated from the
      // same profile the lathe is built from, so the cord hangs off the cloth
      // instead of floating in front of it or sinking behind it.
      const frontAt = (y: number): number => {
        for (let index = 1; index < PONCHO_PROFILE.length; index += 1) {
          const [y0, r0] = PONCHO_PROFILE[index - 1]!;
          const [y1, r1] = PONCHO_PROFILE[index]!;
          if (y <= y0 && y >= y1)
            return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
        }
        return hemRadius;
      };
      const tab = part(slab(0.05, 0.055, 0.022), "cream", {
        x: 0,
        y: 0.225,
        z: frontAt(0.225) + 0.012,
      });
      const cord = (side: -1 | 1) => {
        const line = part(tube(0.011, 0.011, 0.15, 8), "cream", {
          x: side * 0.052,
          y: 0.145,
          z: frontAt(0.145) + 0.014,
        });
        const tip = part(ball(0.017, 0.023, 0.017), "cream", {
          x: side * 0.052,
          y: 0.062,
          z: frontAt(0.062) + 0.014,
        });
        return group(line, tip);
      };
      return [cloth, hood, hoodRim, hoodFold, tab, cord(-1), cord(1)];
    }
    case "harness": {
      // No reference exists for this one. It is authored as the climbing rig
      // its name promises: a strap over each shoulder, a true X crossing at
      // the sternum under a metal chest ring, and a padded belt with a
      // buckle. What was here before was two near-vertical slabs meeting at
      // the collarbone, which photographed as a letter A drawn on the chest.
      // Every stand-off below cleared a bare torso and a tee, and the
      // 2026-08-03 report showed why that was not enough: over a turtleneck
      // (shell +0.022, hem rib +0.032) the shoulder straps sank into the knit
      // and surfaced as fragments. The rig now stands clear of the thickest
      // top in the catalogue, which reads as a harness worn over the sweater
      // rather than embedded in it.
      const wrap = shellGroup();
      wrap.add(part(torsoShell(-0.12, -0.05, 0.044), "leather"));
      const shoulder = (side: -1 | 1) => {
        const strap = part(ring(0.142, 0.032, Math.PI), "leather", {
          x: side * 0.15,
          y: 0.155,
          z: 0,
        });
        strap.rotation.y = Math.PI / 2;
        return strap;
      };
      // Each diagonal runs shoulder to opposite hip. Rotated about z through
      // the shared sternum point, the two make the X that says harness from
      // the chase camera.
      const cross = (side: -1 | 1) => {
        const strap = part(roundedSlab(0.052, 0.36, 0.022), "leather", {
          x: 0,
          y: 0.045,
          z: 0.222,
        });
        strap.rotation.z = side * 0.82;
        return strap;
      };
      const chestRing = part(ring(0.046, 0.012), "metal", { x: 0, y: 0.045, z: 0.242 });
      // The belt's own front face sits at 0.236 world, so hardware on it
      // starts there and stands proud, not inside it.
      const buckle = part(slab(0.06, 0.045, 0.02), "steel", { x: 0, y: -0.085, z: 0.248 });
      const keeper = (side: -1 | 1) => {
        const tab = part(slab(0.045, 0.03, 0.018), "trim", {
          x: side * 0.14,
          y: -0.075,
          z: 0.218,
        });
        tab.rotation.y = side * 0.55;
        return tab;
      };
      return [
        wrap, shoulder(-1), shoulder(1), cross(-1), cross(1),
        chestRing, buckle, keeper(-1), keeper(1),
      ];
    }
    case "scarf": {
      // wear-scarf.png: a chunky knit looped once at the neck with two tails
      // hanging down the front, each ending in a cream fringe. The loop itself
      // rides the neck socket (scarfCollarParts); only the tails are here, and
      // they stop well above the hem so a thigh never reaches them.
      // The two tails hang at different lengths and lean apart the way a
      // once-looped scarf actually settles; equal parallel slabs read as a
      // bib. Each tail tips slightly outward at the hem so it drapes off the
      // chest instead of lying flat against it.
      const tail = (side: -1 | 1) => {
        const length = side < 0 ? 0.235 : 0.185;
        // Cloth and fringes live in one group whose origin is the top of the
        // tail, so the outward lean carries the fringes with it for free.
        const hang = new THREE.Group();
        hang.position.set(side * 0.06, 0.19, 0.225);
        hang.rotation.z = side * 0.09;
        hang.rotation.x = -0.06;
        hang.add(
          // The fold reaches up past the loop's bottom edge (world 1.155), so
          // the tails visibly continue OUT of the loop instead of starting
          // below it.
          part(roundedSlab(0.082, 0.06, 0.04), "knit", { x: 0, y: 0.012, z: 0.001 }),
          part(roundedSlab(0.075, length, 0.034), "knit", {
            x: 0, y: -length / 2, z: 0,
          }),
          ...[-0.026, -0.009, 0.009, 0.026].map((offset) =>
            part(tube(0.006, 0.006, 0.045, 6), "cream", {
              x: offset,
              y: -length - 0.016,
              z: 0,
            }),
          ),
        );
        return hang;
      };
      return [tail(-1), tail(1)];
    }
    case "wings": {
      // wear-wings.png: two pairs per side - a long pointed upper and a short
      // rounded lower - each a membrane inside a light rim, with a small knot
      // where they meet. The rim is a slightly larger panel set a little
      // further back rather than a torus, which reads as an outline from the
      // chase camera for a fraction of the triangles.
      const panel = (
        side: -1 | 1,
        rx: number,
        ry: number,
        y: number,
        tilt: number,
      ) => {
        const membrane = part(ball(rx, ry, 0.016), "main", {
          x: side * (rx + 0.05),
          y,
          z: -0.225,
        });
        membrane.rotation.z = -side * tilt;
        const rim = part(ball(rx + 0.013, ry + 0.013, 0.012), "cream", {
          x: side * (rx + 0.05),
          y,
          z: -0.237,
        });
        rim.rotation.z = -side * tilt;
        const back = part(ball(rx, ry, 0.01), "main", {
          x: side * (rx + 0.05),
          y,
          z: -0.255,
        });
        back.rotation.z = -side * tilt;
        return group(rim, membrane, back);
      };
      // The lower pair is smaller and sits higher than the reference's, because
      // the hem rule bounds it: a wing tip below 0.772u world is a wing tip a
      // thigh swings through.
      const wing = (side: -1 | 1) =>
        group(panel(side, 0.15, 0.19, 0.17, 0.35), panel(side, 0.1, 0.1, 0.015, 0.2));
      const knot = part(ball(0.035, 0.046, 0.03), "cream", { x: 0, y: 0.075, z: -0.216 });
      return [wing(-1), wing(1), knot];
    }
  }
}

const OUTER_SLEEVES: Partial<Record<AvatarOuterwearId, number>> = {
  jacket: 0.96,
  puffer: 0.94,
  hoodie: 0.98,
};

/** Outer garments that cover a shirt's shoulder cap as well as its sleeve. */
const OUTER_SHOULDERS = new Set<AvatarOuterwearId>(["jacket", "puffer", "hoodie"]);

/**
 * Outerwear that closes round the neck rather than round the ribcage.
 *
 * On the neck for the same reason the top collars are: Neck__pivot carries unit
 * scale where the torso does not, so a ring built under the torso would come
 * out oval around a round neck.
 */
function outerCollarParts(id: AvatarOuterwearId): THREE.Object3D[] {
  switch (id) {
    case "hoodie":
      return collarParts("hoodie");
    case "puffer":
      // Lower and closer than it first shipped: at 0.095u tall on y 0.05 the
      // funnel hovered with open air between its underside and the jacket's
      // shoulders.
      return [part(tube(0.188, 0.198, 0.08, 18, true), "trim", { x: 0, y: 0.025, z: 0 })];
    case "scarf": {
      // The loop reaches DOWN to hand the tails off: its old bottom stopped
      // 0.08u above where the tails began and the garment photographed as two
      // pieces with bare chest between them. A torus roll caps the top so the
      // cut edge of the tube no longer presses a hard line under the jaw.
      const wrap = part(tube(0.207, 0.207, 0.15, 18, true), "main", { x: 0, y: -0.005, z: 0 });
      const roll = part(ring(0.2, 0.022), "main", { x: 0, y: 0.065, z: 0 });
      roll.rotation.x = Math.PI / 2;
      return [wrap, roll];
    }
    case "vest":
      // wear-vest.png: a stand collar in the vest's own colour, seated on the
      // shoulders rather than ringing the neck in mid-air.
      return [part(tube(0.183, 0.193, 0.08, 18, true), "main", { x: 0, y: 0.025, z: 0 })];
    case "jacket":
      // wear-jacket.png: a wide flat collar in a contrast colour, open at the
      // front where the jacket is. The arc runs wider than it first shipped
      // (2.9rad against 2.6) because with the runner's resting torso twist a
      // 2.6 arc showed on one shoulder only, and a rolled top edge keeps the
      // cut rim from reading as a blade in profile.
      return [
        part(
          new THREE.CylinderGeometry(0.24, 0.19, 0.065, 20, 1, true, Math.PI - 1.45, 2.9),
          "trim",
          { x: 0, y: 0.032, z: 0 },
        ),
        (() => {
          const wrap = new THREE.Group();
          const roll = part(ring(0.235, 0.014, Math.PI * 2 - 1.3), "trim", {
            x: 0, y: 0.062, z: 0,
          });
          roll.rotation.x = Math.PI / 2;
          wrap.add(roll);
          wrap.rotation.y = -(Math.PI / 2 + 0.65);
          return wrap;
        })(),
      ];
    default:
      return [];
  }
}

// --- Legwear ----------------------------------------------------------------

function legwearParts(id: AvatarLegwearId, side: -1 | 1): THREE.Object3D[] {
  const trouser = (to: number, radiusTo: number) =>
    limbSleeve(LEG, side, -0.02, to, legRadius(0) + 0.012, radiusTo);
  switch (id) {
    case "none":
      return [];
    case "shorts": {
      // wear-shorts.png: a cream ribbed waistband, a contrast stripe down the
      // outer seam and a rolled cuff at the hem. The continuous pelvis yoke
      // owns the waistband; duplicating one on each animated leg produced a
      // pair of black triangular teeth under the shirt.
      const leg = trouser(0.44, legRadius(0.44) + 0.022);
      const cuff = limbSleeve(LEG, side, 0.4, 0.46, legRadius(0.44) + 0.028, legRadius(0.44) + 0.028);
      cuff.userData["wardrobeTint"] = "trim";
      const stripe = part(slab(0.014, 0.19, 0.05), "trim");
      stripe.position.copy(limbPoint(LEG, side, 0.24));
      stripe.position.x += side * (legRadius(0.24) + 0.018);
      return [leg, cuff, stripe];
    }
    case "joggers": {
      // wear-joggers.png: a cream ribbed waistband with a drawstring, tapering
      // to a gathered ankle cuff.
      const leg = trouser(0.97, legRadius(0.97) + 0.014);
      const cuff = limbSleeve(LEG, side, 0.9, 1.0, legRadius(0.95) + 0.02, legRadius(0.95) + 0.016);
      cuff.userData["wardrobeTint"] = "trim";
      return [leg, cuff];
    }
    case "jeans": {
      // wear-jeans.png came back folded flat. It settles the palette and the
      // details it does show - a waistband and contrast topstitching - and
      // settles nothing about the leg, whose shape comes from the rig here the
      // same way every other trouser's does.
      //
      // The belt loops and the patch back pocket the reference also shows are
      // deliberately absent. Both stand proud in z, and a leg rotates about X:
      // at the top of the swing a point 0.09u behind the leg axis is lifted
      // 0.09u, which put the waist through the shirt hem and the loops 0.011u
      // outside the corridor a leg garment has. Measured, not guessed - the
      // wardrobe test failed on both before they came out.
      const leg = trouser(1.03, legRadius(0.9) + 0.02);
      leg.userData["wardrobeTint"] = "denim";
      const seam = part(slab(0.008, 0.5, 0.026), "trim");
      seam.position.copy(limbPoint(LEG, side, 0.45));
      seam.position.x += side * (legRadius(0.45) + 0.016);
      // A turned-up hem cuff: with the fly and back yoke on the pelvis, this
      // is the one denim cue that can safely ride the leg, because a sleeve
      // around the limb axis never changes its own x extent in the swing.
      const cuff = limbSleeve(
        LEG, side, 0.94, 1.04, legRadius(0.95) + 0.027, legRadius(1) + 0.027,
      );
      cuff.userData["wardrobeTint"] = "trim";
      return [leg, seam, cuff];
    }
    case "cargo": {
      // wear-cargo.png: the trouser, its waistband, its thigh pockets and its
      // turned-up ankle cuff are all one colour, and the only second colour in
      // the whole reference is the cream button on each pocket flap. What was
      // here instead was a contrast-coloured pocket and a contrast knee patch
      // the reference does not have, so both are gone: the pocket now reads by
      // standing proud of the leg and by the flap overhanging it.
      //
      // The reference's fly button is left out. It is a single centre-front
      // detail, and legwear is built once per leg off that leg's own pivot, so
      // it would come out either doubled or riding up with the stride.
      const leg = trouser(1.03, legRadius(0.9) + 0.02);
      const cuff = limbSleeve(LEG, side, 0.92, 1.04, legRadius(0.95) + 0.027, legRadius(1) + 0.027);
      // The bellows pocket is the whole identity of a cargo trouser and the
      // 0.026-thin card that stood here did not read as one. The pouch is now
      // a real box standing off the thigh, the flap overhangs it with a
      // visible shadow gap, and a smaller calf pocket makes the side view
      // differ from the front. All of it grows in x only as far as 0.114 off
      // the axis - under the 0.125 sweep cap the suite enforces.
      const pocket = part(roundedSlab(0.044, 0.115, 0.085), "main");
      pocket.position.copy(limbPoint(LEG, side, 0.52));
      pocket.position.x += side * (legRadius(0.52) + 0.017);
      const flap = part(roundedSlab(0.044, 0.034, 0.08), "main");
      flap.position.copy(limbPoint(LEG, side, 0.42));
      flap.position.x += side * (legRadius(0.42) + 0.019);
      const button = part(ball(0.01, 0.013, 0.013), "cream");
      button.position.copy(limbPoint(LEG, side, 0.44));
      button.position.x += side * (legRadius(0.44) + 0.036);
      const calfPocket = part(roundedSlab(0.036, 0.07, 0.06), "main");
      calfPocket.position.copy(limbPoint(LEG, side, 0.74));
      calfPocket.position.x += side * (legRadius(0.74) + 0.015);
      return [leg, cuff, pocket, flap, button, calfPocket];
    }
    case "kneepads": {
      // A plastic shell over a proud cushion ring, not a lump of dark rubber:
      // with the default charcoal legwear the rubber tint multiplied down to
      // near-black and the pad vanished against the leg it was protecting.
      const pad = part(ball(0.094, 0.086, 0.078), "plastic");
      pad.position.copy(limbPoint(LEG, side, 0.54));
      pad.position.z += 0.034;
      const cushion = part(ring(0.05, 0.013), "trim");
      cushion.position.copy(limbPoint(LEG, side, 0.54));
      cushion.position.z += 0.09;
      const cap = part(ball(0.04, 0.038, 0.018), "trim");
      cap.position.copy(limbPoint(LEG, side, 0.54));
      cap.position.z += 0.098;
      const upperStrap = limbSleeve(
        LEG, side, 0.43, 0.49, legRadius(0.43) + 0.014, legRadius(0.49) + 0.014,
      );
      const lowerStrap = limbSleeve(
        LEG, side, 0.59, 0.65, legRadius(0.59) + 0.014, legRadius(0.65) + 0.014,
      );
      upperStrap.userData["wardrobeTint"] = "trim";
      lowerStrap.userData["wardrobeTint"] = "trim";
      return [upperStrap, lowerStrap, pad, cushion, cap];
    }
    case "kilt": {
      // The actual kilt is a single pelvis-mounted garment. Returning no
      // per-leg tubes prevents it from reading as a pair of shorts.
      return [];
    }
    case "tights": {
      // No reference. A second skin is the point, so the sleeve stays thin -
      // but a thin sleeve in the wearer's own colour over a leg is a garment
      // with nothing to be seen by, and photographed on the runner this drew
      // a figure indistinguishable from a bare one. The waist and ankle bands
      // are what make it read as worn; the leg itself is left as close to the
      // body as it was.
      const leg = trouser(1.05, legRadius(1.0) + 0.008);
      // Sheen is what separates a technical legging from the three matte
      // charcoal trousers beside it in the picker: the plastic role keeps the
      // chosen hue but answers light the way stretch knit does, where main's
      // 0.78 roughness made tights, jeans and joggers one material.
      leg.userData["wardrobeTint"] = "plastic";
      const seam = part(slab(0.009, 0.31, 0.02), "trim");
      seam.position.copy(limbPoint(LEG, side, 0.46));
      seam.position.x += side * (legRadius(0.46) + 0.01);
      const ankle = limbSleeve(
        LEG,
        side,
        0.9,
        1.05,
        legRadius(0.9) + 0.019,
        legRadius(1.05) + 0.019,
      );
      ankle.userData["wardrobeTint"] = "trim";
      return [leg, seam, ankle];
    }
  }
}

/**
 * A shared waist joins the two animated leg shells into one believable pair
 * of trousers. It rides the pelvis, not either leg, so it stays centred while
 * the stride swings underneath it. The deeper overlap is intentional: the old
 * shallow yoke exposed a horizontal body-colored bar between many tops and
 * pants once the animated torso and pelvis twisted in opposite directions.
 */
function pelvisLegwearParts(id: AvatarLegwearId): THREE.Object3D[] {
  if (id === "kneepads" || id === "none") return [];
  // Tights take the same sheen as their legs or the waist reads as a
  // different garment.
  const baseTint: WardrobeTint =
    id === "jeans" ? "denim" : id === "tights" ? "plastic" : "main";
  // The old top radius was only 0.176u: narrower than the runner's bare torso
  // at the same height. The pants technically overlapped the shirt in Y, but
  // sat behind the body in X/Z, leaving a visible body-coloured band. This
  // high-rise yoke meets the actual torso silhouette and overlaps the selected
  // garment bridge above from every viewing angle.
  // A lathe rather than a capped cylinder. The cylinder's flat top rim plus
  // the waistband torus stood wider than the torso and photographed, in the
  // side view of every trouser, as a thin dark plate projecting into the air
  // past the body - a table edge through the hips. The profile still reaches
  // 0.266 (the waist-coverage tests need the pants wider than the shirt gap)
  // but it reaches it MID-YOKE, where it reads as hip flare, and then curls
  // back INWARD so the top edge tucks toward the body instead of ending in a
  // proud rim. The bottom extends to -0.04 to close the bare-hip band that
  // showed between the old yoke and the leg tubes.
  const yoke = part(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.205, -0.04),
        new THREE.Vector2(0.212, 0),
        new THREE.Vector2(0.238, 0.05),
        new THREE.Vector2(0.256, 0.1),
        new THREE.Vector2(0.263, 0.14),
        new THREE.Vector2(0.262, 0.175),
        new THREE.Vector2(0.252, 0.2),
        new THREE.Vector2(0.234, 0.215),
        new THREE.Vector2(0.205, 0.224),
        new THREE.Vector2(0.155, 0.228),
      ],
      24,
    ),
    baseTint,
    { x: 0, y: 0, z: 0 },
  );
  // 0.77 rather than the torso's own 0.8: the coverage tests bound x and z
  // separately, and the sliver the yoke must keep in x (to stay wider than
  // the shirt gap) does not have to be spent in z, which is the axis the
  // side view actually photographs.
  yoke.scale.z = 0.77;
  yoke.userData["wardrobeNoOutline"] = true;
  const waistband = part(new THREE.TorusGeometry(0.25, 0.011, 6, 24), "trim", {
    x: 0,
    y: 0.19,
    z: 0,
  });
  waistband.userData["wardrobeTint"] = baseTint;
  waistband.userData["wardrobeNoOutline"] = true;
  // Mesh scale composes BEFORE rotation, so squashing the ring's world-z
  // means scaling its LOCAL Y once it lies flat. The scale.z it shipped with
  // squashed only the tube's thickness and left the ring a perfect circle
  // around an oval body: 0.26 in a direction where the torso is 0.21, which
  // was the dark ledge photographed at the waist of every trouser.
  waistband.rotation.x = Math.PI / 2;
  waistband.scale.y = 0.77;
  if (id === "kilt") return [yoke, waistband, createWearableUpgradeModel("kilt")];
  // The leg sleeves must stay separate so they can run, but trousers are not
  // two disconnected tubes. This pelvis-mounted gusset overlaps the yoke and
  // both upper thighs, closing the bright vertical slit that used to show
  // through every pair of pants. It ends high enough that the legs still swing
  // freely beneath it.
  // An ellipsoid saddle rather than a slab: the slab's square corners were
  // the hard step at the crotch that read as a diaper from the side.
  const crotch = part(ball(0.1, 0.09, 0.105), baseTint, {
    x: 0,
    y: -0.045,
    z: 0,
  });
  crotch.name = "Trouser crotch bridge";
  crotch.userData["wardrobeNoOutline"] = true;
  if (id === "tights") {
    const frontSeam = part(slab(0.012, 0.15, 0.012), "trim", {
      x: 0, y: 0.095, z: 0.216,
    });
    frontSeam.userData["wardrobeNoOutline"] = true;
    return [yoke, waistband, crotch, frontSeam];
  }
  if (id === "jeans") {
    // The denim details live HERE and not on the legs on purpose: the pelvis
    // does not swing, so small proud features are safe where the same detail
    // on a leg tube would lift into the shirt hem at full stride. Fly stitch,
    // waist button and back yoke are the minimum set that says "jeans"
    // rather than "trousers".
    const fly = part(slab(0.009, 0.115, 0.01), "cream", { x: 0.02, y: 0.1, z: 0.212 });
    fly.userData["wardrobeNoOutline"] = true;
    const flyCurve = part(slab(0.009, 0.045, 0.01), "cream", { x: 0.008, y: 0.048, z: 0.208 });
    flyCurve.rotation.z = 0.6;
    flyCurve.userData["wardrobeNoOutline"] = true;
    const button = part(ball(0.014, 0.014, 0.01), "cream", { x: 0, y: 0.175, z: 0.203 });
    button.userData["wardrobeNoOutline"] = true;
    const backYoke = ([-1, 1] as const).map((side) => {
      const line = part(slab(0.1, 0.008, 0.01), "cream", {
        x: side * 0.06, y: 0.115, z: -0.204,
      });
      line.rotation.z = -side * 0.28;
      line.userData["wardrobeNoOutline"] = true;
      return line;
    });
    return [yoke, waistband, crotch, fly, flyCurve, button, ...backYoke];
  }
  if (id !== "joggers") return [yoke, waistband, crotch];
  const drawstring = (side: -1 | 1) =>
    part(tube(0.007, 0.007, 0.095, 7), "cream", {
      x: side * 0.035, y: 0.15, z: 0.212,
    });
  return [yoke, waistband, crotch, drawstring(-1), drawstring(1)];
}

function overallLowerParts(): THREE.Object3D[] {
  const yoke = part(new THREE.CylinderGeometry(0.176, 0.205, 0.18, 20), "denim", {
    x: 0,
    y: 0.09,
    z: 0,
  });
  yoke.scale.z = 0.8;
  const pocket = part(slab(0.11, 0.07, 0.025), "trim", { x: 0, y: 0.08, z: 0.165 });
  return [yoke, pocket];
}

/**
 * A selected torso garment continues onto the pelvis instead of stopping
 * above it. The torso and pelvis counter-rotate in the run cycle, so a shell
 * attached only to the torso can expose a body-coloured belt even when its
 * static bounds overlap the trousers. This quiet under-panel rides the pelvis,
 * reaches up behind the visible torso shell, and exists only for a selected
 * top (or a full torso outer layer when no top is worn).
 */
function garmentWaistBridge(
  tint: WardrobeTint = "main",
  radialClearance = 0,
): THREE.Object3D[] {
  const bridge = part(
    // Keep the shirt outside the high-rise trouser yoke for the whole shared
    // height. The previous opposing tapers crossed through one another and
    // rasterized as a row of dark triangular "teeth" at the waist. This is a
    // visible shirt tail: it starts inside the torso shell, clears the pants,
    // and finishes just below their waistband.
    new THREE.CylinderGeometry(
      0.282 + radialClearance,
      0.245 + radialClearance,
      0.14,
      24,
      3,
    ),
    tint,
    { x: 0, y: 0.14, z: 0 },
  );
  bridge.scale.z = 0.8;
  // This is an overlap panel, not a belt. Giving it an independent ink shell
  // draws the exact dark horizontal bar players read as the old waist gap.
  bridge.userData["wardrobeNoOutline"] = true;
  return [bridge];
}

// --- Footwear ---------------------------------------------------------------

/** Parts that ride the shin rather than the ankle. */
function footwearShinParts(id: AvatarFootwearId, side: -1 | 1): THREE.Object3D[] {
  switch (id) {
    case "hightop": {
      // wear-hightop.png: the quarters rise well past the ankle and are closed
      // by a fat padded collar in the dark contrast, which is the piece that
      // makes it a high-top rather than a shoe with a tall sleeve. What was
      // here was the sleeve alone.
      const shaft = limbSleeve(LEG, side, 0.86, 1.06, legRadius(0.9) + 0.02, legRadius(1) + 0.018);
      shaft.userData["wardrobeTint"] = "main";
      const collar = limbSleeve(
        LEG,
        side,
        0.83,
        0.92,
        legRadius(0.86) + 0.031,
        legRadius(0.9) + 0.031,
      );
      collar.userData["wardrobeTint"] = "trim";
      return [shaft, collar];
    }
    case "boot": {
      const shaft = limbSleeve(LEG, side, 0.62, 1.08, legRadius(0.7) + 0.028, legRadius(1) + 0.022);
      shaft.userData["wardrobeTint"] = "leather";
      const cuff = limbSleeve(LEG, side, 0.6, 0.68, legRadius(0.62) + 0.034, legRadius(0.68) + 0.03);
      cuff.userData["wardrobeTint"] = "trim";
      return [shaft, cuff];
    }
    case "socks": {
      const sock = limbSleeve(LEG, side, 0.56, 1.06, legRadius(0.56) + 0.016, legRadius(1) + 0.012);
      const band = limbSleeve(LEG, side, 0.58, 0.66, legRadius(0.58) + 0.021, legRadius(0.66) + 0.021);
      band.userData["wardrobeTint"] = "trim";
      // A second ring in cream under the cuff: the classic athletic stripe
      // pair, and the one detail that says "long sock" from across a course.
      const stripe = limbSleeve(LEG, side, 0.69, 0.74, legRadius(0.69) + 0.019, legRadius(0.74) + 0.019);
      stripe.userData["wardrobeTint"] = "cream";
      return [sock, band, stripe];
    }
    case "skates": {
      const shaft = limbSleeve(LEG, side, 0.72, 1.06, legRadius(0.8) + 0.026, legRadius(1) + 0.02);
      shaft.userData["wardrobeTint"] = "leather";
      return [shaft];
    }
    default:
      return [];
  }
}

/** Parts that ride the ankle, and so must stay close to the foot. */
function footwearFootParts(id: AvatarFootwearId): THREE.Object3D[] {
  switch (id) {
    case "none":
      return [];
    case "hightop":
      return [createWearableUpgradeModel("hightop")];
    case "boot":
      return [createWearableUpgradeModel("boot")];
    case "sandal": {
      return [createWearableUpgradeModel("sandal")];
    }
    case "cleats": {
      // A low-cut shoe with no shin sleeve left open daylight between the
      // calf's bottom (y 0.0945 in this frame) and the cleat's collar, so the
      // shoe photographed as detached from the body entirely. The liner is
      // the sock that closes that gap, in the shoe's own colour.
      const liner = part(tube(0.07, 0.082, 0.22, 14), "main", {
        x: 0, y: 0.03, z: -0.05,
      });
      return [createWearableUpgradeModel("cleat"), liner];
    }
    case "skates": {
      return [createWearableUpgradeModel("skate")];
    }
    case "socks": {
      // Socks replace the shoe. Repaint the rounded bare-foot geometry into the
      // selected sock color so this is a covered foot, not a sole-less stock
      // sneaker left under a calf sleeve. Heel and toe panels in cream give
      // the knit its classic two-tone read; their positions are measured
      // against the REBUILT foot, which now stands on the deck plane at
      // y -0.1875 instead of floating where the old one did.
      const sockFoot = createWearableUpgradeModel("barefoot");
      sockFoot.traverse((node) => {
        if (node.userData["wardrobeTint"] === "skin")
          node.userData["wardrobeTint"] = "main";
      });
      // The toe panel tucks INSIDE the sock silhouette: at z 0.185 it stood
      // proud of the knit and photographed as bare toes sticking out of a
      // torn sock (2026-08-04 evidence).
      const heel = part(ball(0.062, 0.05, 0.05), "cream", { x: 0, y: -0.08, z: -0.096 });
      const toe = part(ball(0.06, 0.042, 0.044), "cream", { x: 0, y: -0.112, z: 0.152 });
      return [sockFoot, heel, toe];
    }
  }
}

// --- Backpacks --------------------------------------------------------------

function backpackParts(id: AvatarBackpackId): THREE.Object3D[] {
  switch (id) {
    case "none":
      return [];
    case "daypack": {
      return [createWearableUpgradeModel("daypack")];
    }
    case "bedroll": {
      return [createWearableUpgradeModel("bedroll")];
    }
    case "jetpack": {
      return [createWearableUpgradeModel("jetpack")];
    }
    case "shell": {
      // A dome rather than a whole ellipsoid: the flat side faces the runner's
      // back, so the shell sits ON them instead of half inside them.
      const back = part(dome(0.3, 0.22, 0.2), "main", { x: 0, y: 0.06, z: -0.18 });
      back.rotation.x = -Math.PI / 2;
      const ridge = (angle: number) => {
        const bar = part(slab(0.035, 0.24, 0.035), "trim", {
          x: Math.sin(angle) * 0.16,
          y: 0.03 + Math.cos(angle) * 0.06,
          z: -0.34,
        });
        bar.rotation.z = angle;
        return bar;
      };
      return [back, ridge(-0.5), ridge(0), ridge(0.5)];
    }
    case "satchel": {
      const bag = part(ball(0.1, 0.115, 0.075), "main", { x: 0.235, y: -0.02, z: -0.16 });
      const flap = part(ball(0.104, 0.05, 0.079), "trim", { x: 0.235, y: 0.05, z: -0.16 });
      const strap = part(slab(0.045, 0.42, 0.022), "trim", { x: 0.04, y: 0.09, z: 0.185 });
      strap.rotation.z = 0.5;
      return [bag, flap, strap];
    }
    case "scuba": {
      const cylinderFor = (side: -1 | 1) =>
        part(tube(0.072, 0.072, 0.36, 14), "steel", { x: side * 0.1, y: 0.06, z: -0.27 });
      const valve = part(tube(0.03, 0.03, 0.06, 10), "trim", { x: 0, y: 0.24, z: -0.27 });
      const yoke = part(slab(0.22, 0.035, 0.035), "trim", { x: 0, y: 0.2, z: -0.27 });
      return [cylinderFor(-1), cylinderFor(1), valve, yoke];
    }
    case "cape": {
      return [createWearableUpgradeModel("cape")];
    }
    case "wings": {
      return [createWearableUpgradeModel("wings")];
    }
  }
}

// --- Held items -------------------------------------------------------------

/**
 * Everything carried is authored narrow in x and deep in z.
 *
 * The hand sits at x = 0.336 and the skull reaches 0.325, so the outward gap a
 * held item has to live in is thin. Widening a flag sideways would either enter
 * the head on the victory raise or push the runner past the deck; giving it its
 * width front-to-back costs nothing, because depth is unconstrained.
 */
function heldParts(id: AvatarHeldId): THREE.Object3D[] {
  switch (id) {
    case "none":
      return [];
    case "flag": {
      return [createWearableUpgradeModel("flag")];
    }
    case "torch": {
      // wear-torch.png: a pale bowl on a pale handle with a banded collar
      // under it. The flame is a stack of three lobes twisted off each
      // other's axis with a bright core rising through them - the single
      // cone-through-a-ball it replaces read as a soft-serve swirl with a
      // spike. The bowl carries a rim band and three rivets, and the handle
      // tapers into a grip wrap and pommel.
      const handle = part(tube(0.019, 0.013, 0.16, 10), "leather", { x: 0.055, y: 0.02, z: 0 });
      const wrap = part(tube(0.022, 0.022, 0.05, 10), "trim", { x: 0.055, y: -0.01, z: 0 });
      const pommel = part(ball(0.022, 0.016, 0.022), "metal", { x: 0.055, y: -0.062, z: 0 });
      const collar = part(tube(0.03, 0.024, 0.045, 12), "main", { x: 0.055, y: 0.115, z: 0 });
      const bowl = part(tube(0.05, 0.026, 0.05, 14), "metal", { x: 0.055, y: 0.16, z: 0 });
      bowl.scale.z = 1.4;
      const rim = part(ring(0.05, 0.007), "trim", { x: 0.055, y: 0.183, z: 0 });
      rim.rotation.x = Math.PI / 2;
      rim.scale.y = 1.4;
      const rivets = [0.4, Math.PI, Math.PI * 1.6].map((angle) =>
        part(ball(0.006, 0.006, 0.006), "steel", {
          x: 0.055 + Math.sin(angle) * 0.048,
          y: 0.168,
          z: Math.cos(angle) * 0.067,
        }),
      );
      const lobes = [
        [0.052, 0.21, 0.006, 0.042, 0.05, 0.058, 0.14],
        [0.058, 0.252, -0.008, 0.034, 0.046, 0.048, -0.2],
        [0.053, 0.295, 0.01, 0.024, 0.05, 0.034, 0.1],
      ].map(([x, y, z, rx, ry, rz, tilt]) => {
        const lobe = part(ball(rx!, ry!, rz!), "flame", { x: x!, y: y!, z: z! });
        lobe.rotation.z = tilt!;
        return lobe;
      });
      const tip = part(new THREE.ConeGeometry(0.02, 0.075, 10), "flame", {
        x: 0.054, y: 0.35, z: 0.006,
      });
      tip.rotation.z = -0.1;
      const core = part(ball(0.018, 0.062, 0.02), "glow", { x: 0.056, y: 0.246, z: 0.012 });
      return [handle, wrap, pommel, collar, bowl, rim, ...rivets, ...lobes, tip, core];
    }
    case "umbrella": {
      // wear-umbrella.png is FURLED, not open: a tapered spindle of gores under
      // a banded collar, with a crook handle above and a pale ferrule below.
      // The crook curves fore-and-aft because that is the free direction - one
      // curving sideways would swing through the skull.
      const canopy = part(tube(0.062, 0.009, 0.27, 12), "main", { x: 0.055, y: 0.055, z: 0 });
      canopy.scale.x = 0.7;
      // A second, tilted band midway down the furl: with only the collar band
      // the canopy read as a bare spindle, and a slight diagonal is what says
      // "cloth wrapped and cinched" at this scale.
      const midBand = part(tube(0.037, 0.037, 0.028, 12), "trim", { x: 0.055, y: -0.01, z: 0 });
      midBand.scale.x = 0.72;
      midBand.rotation.z = 0.12;
      const band = part(tube(0.045, 0.045, 0.034, 12), "trim", { x: 0.055, y: 0.1, z: 0 });
      band.scale.x = 0.72;
      const shaft = part(tube(0.012, 0.012, 0.115, 8), "cream", { x: 0.055, y: 0.245, z: 0 });
      const crook = part(ring(0.034, 0.012, Math.PI), "cream", { x: 0.055, y: 0.305, z: 0.034 });
      crook.rotation.y = Math.PI / 2;
      const ferrule = part(ball(0.015, 0.03, 0.015), "cream", { x: 0.055, y: -0.083, z: 0 });
      return [canopy, band, shaft, crook, ferrule];
    }
    case "baguette": {
      // wear-baguette.png: a golden crust with four pale diagonal slashes. The
      // slashes ride in the loaf's own group, so they keep their place on it
      // when it is tipped.
      // Longer and slightly fatter than the first cut, which photographed as
      // a small brown blob at the hip: depth is the free direction for a held
      // item, so the length is where the presence comes from. The heel ends
      // taper the way a real loaf's do.
      const loaf = group(part(ball(0.04, 0.04, 0.165), "main"));
      for (const z of [-0.16, 0.16])
        loaf.add(part(ball(0.02, 0.02, 0.03), "main", { x: 0, y: 0, z }));
      for (const z of [-0.095, -0.032, 0.032, 0.095]) {
        const slash = part(ball(0.012, 0.014, 0.03), "cream", { x: 0, y: 0.033, z });
        slash.rotation.y = 0.5;
        loaf.add(slash);
      }
      loaf.position.set(0.05, 0.07, 0.02);
      loaf.rotation.x = 0.55;
      loaf.rotation.y = 0.48;
      return [loaf];
    }
    case "plunger": {
      // wear-plunger.png: a pale straight handle into a collar, over a domed
      // cup. The cup is now a LATHE with a concave bell flare ending in a
      // rolled lip torus - the straight cone it replaces read as a lampshade
      // on a dowel - and a ferrule socket joins wood to rubber. Still
      // squashed in x, because the hand it is in swings past the skull.
      const handle = part(tube(0.014, 0.014, 0.235, 8), "cream", { x: 0.058, y: 0.075, z: 0 });
      const socket = part(tube(0.024, 0.03, 0.035, 12), "rubber", { x: 0.058, y: -0.028, z: 0 });
      socket.scale.x = 0.6;
      const bell = part(
        new THREE.LatheGeometry(
          [
            new THREE.Vector2(0.02, 0),
            new THREE.Vector2(0.032, -0.022),
            new THREE.Vector2(0.048, -0.045),
            new THREE.Vector2(0.066, -0.062),
            new THREE.Vector2(0.08, -0.072),
          ],
          16,
        ),
        "rubber",
        { x: 0.058, y: -0.045, z: 0 },
      );
      bell.scale.x = 0.6;
      // Rotation about x leaves world x as local x, so the clearance squash
      // stays on scale.x here (unlike a world-Z squash, which moves to local
      // y - the trap this file has now hit four times).
      const lip = part(ring(0.079, 0.011), "rubber", { x: 0.058, y: -0.119, z: 0 });
      lip.rotation.x = Math.PI / 2;
      lip.scale.x = 0.6;
      return [handle, socket, bell, lip];
    }
    case "balloon": {
      return [createWearableUpgradeModel("balloon")];
    }
    case "trophy": {
      return [createWearableUpgradeModel("trophy")];
    }
  }
}

export interface GripSpec {
  /** Authored point that must sit inside the palm. */
  gripPoint: readonly [number, number, number];
  /** Per-item presentation angle; broad faces should read from chase view. */
  rotation: readonly [number, number, number];
  /** Readability scale after the grip point has been moved to the origin. */
  scale: readonly [number, number, number];
  /** Small outboard offset from the hand centre. */
  handOffset: readonly [number, number, number];
}

export const HELD_GRIPS: Readonly<Record<Exclude<AvatarHeldId, "none">, GripSpec>> = {
  flag: { gripPoint: [0.05, 0, 0], rotation: [0, 0.24, -0.22], scale: [1.08, 1.52, 1.52], handOffset: [0.04, 0, 0.015] },
  torch: { gripPoint: [0.055, 0.015, 0], rotation: [0, 0.08, -0.05], scale: [1.15, 1.75, 1.75], handOffset: [0.025, 0, 0] },
  umbrella: { gripPoint: [0.055, 0.22, 0], rotation: [-0.08, -0.12, 0.12], scale: [1.2, 1.72, 1.72], handOffset: [0.03, 0, 0.02] },
  baguette: { gripPoint: [0.05, 0.07, 0.02], rotation: [-0.08, 0.28, 0.72], scale: [1.35, 1.62, 1.82], handOffset: [0.04, 0, 0.01] },
  plunger: { gripPoint: [0.058, 0.055, 0], rotation: [0.12, 0.18, -0.08], scale: [1.32, 1.8, 1.9], handOffset: [0.035, 0, 0.02] },
  balloon: { gripPoint: [0.048, 0.01, 0], rotation: [0, 0.05, -0.05], scale: [1.55, 1.88, 1.88], handOffset: [0.04, 0, 0.02] },
  trophy: { gripPoint: [0.058, 0.055, 0], rotation: [0, 0.05, -0.05], scale: [1.45, 2.15, 2.15], handOffset: [0.04, 0, 0.015] },
};

// --- Assembly ---------------------------------------------------------------

function specsFor(look: ResolvedAvatar): Spec[] {
  const specs: Spec[] = [];
  const add = (socket: string, key: string, parts: () => THREE.Object3D[]) => {
    specs.push({ socket, key, build: () => group(...parts()) });
  };

  // Open accessories do not replace a hairstyle. Full hats still tuck it to
  // avoid two complete skull shells occupying the same space, but a visor,
  // headband, earmuffs or headphones must never make a selected hair choice
  // silently disappear.
  const hairVisible = (["hair", "band", "visor", "earmuffs", "headphones"] as const)
    .includes(look.headwear as "hair" | "band" | "visor" | "earmuffs" | "headphones");
  if (look.hair !== "none" && hairVisible)
    add(SOCKETS.head, `hair:${look.hair}`, () => [
      createHairStyleModel(look.hair, look.garmentColors.hair),
    ]);
  if (look.headwear !== "hair")
    add(SOCKETS.head, `headwear:${look.headwear}`, () => headwearParts(look.headwear));
  // A full-face motorcycle helmet owns the entire face plane. Rendering a
  // mask, beard, or glasses underneath its visor turns the front into a stack
  // of intersecting slabs; keep those choices serialized, but occlude them the
  // same way a real helmet does while it is worn.
  const faceCoveredByHelmet = look.headwear === "helmet";
  if (look.face !== "plain" && !faceCoveredByHelmet)
    add(SOCKETS.head, `face:${look.face}`, () => facePartsFor(look.face));
  if (look.eyewear !== "none" && !faceCoveredByHelmet)
    add(SOCKETS.head, `eyewear:${look.eyewear}`, () => eyewearParts(look.eyewear));

  if (look.top !== "none") {
    add(SOCKETS.torso, `top:${look.top}`, () => topShellParts(look.top));
    if (collarParts(look.top).length > 0)
      add(SOCKETS.neck, `topCollar:${look.top}`, () => collarParts(look.top));
    const reach = TOP_SLEEVES[look.top];
    const topTint: WardrobeTint =
      look.top === "hoodie" || look.top === "turtleneck"
        ? "knit"
        : look.top === "overalls"
          ? "denim"
          : "main";
    if (reach !== undefined)
      for (const [socket, side] of ARM_SOCKETS)
        add(socket, `topSleeve:${look.top}:${side}`, () => [
          sleeve(side, reach, topTint, DEEP_CUFFS[look.top], SLEEVE_HOOPS[look.top]),
        ]);
    // A tank top has cut armholes by definition. The generic shoulder caps
    // turned it back into a T-shirt and were the source of its floating hoop.
    if (look.top !== "tank" && look.top !== "overalls")
      for (const [socket] of SHOULDER_SOCKETS)
        add(socket, `topShoulder:${look.top}`, () => [
          shoulderPad(0.092, topTint, SHOULDER_BANDS[look.top]),
        ]);
    if (look.top === "overalls") {
      add(SOCKETS.pelvis, "topPelvis:overalls", overallLowerParts);
      for (const [socket, side] of LEG_SOCKETS)
        add(socket, `topOverallLeg:overalls:${side}`, () => {
          const leg = limbSleeve(
            LEG, side, -0.02, 0.52, legRadius(0) + 0.018, legRadius(0.52) + 0.024,
          );
          leg.userData["wardrobeTint"] = "denim";
          return [leg];
        });
    } else add(SOCKETS.pelvis, `topWaist:${look.top}`, garmentWaistBridge);
  }

  if (look.outerwear !== "none") {
    add(SOCKETS.torso, `outer:${look.outerwear}`, () => outerwearParts(look.outerwear));
    if (outerCollarParts(look.outerwear).length > 0)
      add(SOCKETS.neck, `outerCollar:${look.outerwear}`, () =>
        outerCollarParts(look.outerwear),
      );
    const reach = OUTER_SLEEVES[look.outerwear];
    const outerTint: WardrobeTint = look.outerwear === "jacket" ? "denim" : "main";
    if (reach !== undefined)
      for (const [socket, side] of ARM_SOCKETS)
        add(socket, `outerSleeve:${look.outerwear}:${side}`, () => [
          // A real second layer: 0.035u radial clearance versus a shirt's
          // 0.015u, so the inner sleeve cannot flicker through at the elbow or
          // cuff while the arm bends.
          sleeve(side, reach, outerTint, undefined, undefined, 0.035),
        ]);
    if (OUTER_SHOULDERS.has(look.outerwear))
      for (const [socket] of SHOULDER_SOCKETS)
        add(socket, `outerShoulder:${look.outerwear}`, () => [
          shoulderPad(0.112, outerTint),
        ]);
    // Closed torso layers continue over the selected shirt at the waist too.
    // Their bridge is wider than the shirt bridge; equal cylinders were the
    // source of z-fighting and of inner shirts appearing on top. A harness and
    // scarf remain honest open accessories rather than manufacturing a solid
    // outer shirt beneath themselves.
    if (["jacket", "puffer", "vest", "poncho", "hoodie"].includes(look.outerwear))
      add(SOCKETS.pelvis, `outerWaist:${look.outerwear}`, () =>
        // 0.008, down from 0.025: the outer bridge never receives the 1.035
        // attach scale the outer SHELLS do, so at 0.025 its rim (0.307)
        // crossed the widened vest and puffer hems (0.298) and rasterized as
        // a sawtooth band above the hem. 0.008 keeps it outside the shirt
        // bridge (0.282) and inside every outer hem shell.
        garmentWaistBridge(outerTint, 0.008),
      );
  }

  // Overalls own their lower half. Keep a separately selected legwear choice in
  // the serialized avatar, but do not stack it through the overall trousers.
  if (look.legwear !== "none" && look.top !== "overalls") {
    add(SOCKETS.pelvis, `legwearPelvis:${look.legwear}`, () => pelvisLegwearParts(look.legwear));
    if (look.legwear !== "kilt")
      for (const [socket, side] of LEG_SOCKETS)
        add(socket, `legwear:${look.legwear}:${side}`, () => legwearParts(look.legwear, side));
  }

  // The sneaker socket sits 0.027u OUTBOARD of the calf's own axis - measured
  // on the built rig - so a foot centred on its socket rides visibly outside
  // the leg it belongs to. Every foot's contents therefore shift that far
  // back INBOARD, which needs a per-side template: one shared clone cannot
  // lean toward the body on both feet at once.
  const FOOT_INBOARD = 0.027;
  const seatFoot = (side: -1 | 1, parts: THREE.Object3D[]): THREE.Object3D[] => {
    const seated = group(...parts);
    seated.position.x = -side * FOOT_INBOARD;
    return [seated];
  };
  if (look.footwear !== "none") {
    for (const [socket, side] of LEG_SOCKETS)
      add(socket, `shoeShin:${look.footwear}:${side}`, () =>
        footwearShinParts(look.footwear, side),
      );
    for (const [socket, side] of SHOE_SOCKETS)
      add(socket, `shoeFoot:${look.footwear}:${side}`, () =>
        seatFoot(side, footwearFootParts(look.footwear)),
      );
  } else {
    for (const [socket, side] of SHOE_SOCKETS)
      add(socket, `bareFoot:none:${side}`, () =>
        seatFoot(side, [createWearableUpgradeModel("barefoot")]),
      );
  }

  if (look.backpack !== "none")
    add(SOCKETS.torso, `pack:${look.backpack}`, () => backpackParts(look.backpack));

  if (look.held !== "none")
    add(SOCKETS.handRight, `held:${look.held}`, () => {
      const spec = HELD_GRIPS[look.held as Exclude<AvatarHeldId, "none">];
      const contents = group(...heldParts(look.held));
      contents.position.set(-spec.gripPoint[0], -spec.gripPoint[1], -spec.gripPoint[2]);
      const prop = group(contents);
      prop.name = `Held grip ${look.held}`;
      prop.position.set(...spec.handOffset);
      // Bias carried props toward the camera-facing half of the fist. This is
      // deliberately smaller than the hand's front radius: the authored grip
      // stays inside the palm instead of hovering in front of it, while broad
      // props no longer disappear on the torso's depth plane.
      prop.position.z += 0.025;
      prop.rotation.set(...spec.rotation);
      prop.scale.set(...spec.scale);
      return [prop];
    });

  return specs;
}

/** Which garment colour a socket's contents take. */
function paletteKeyFor(key: string): keyof ResolvedAvatar["garmentColors"] {
  const slot = key.slice(0, key.indexOf(":"));
  switch (slot) {
    case "hair":
      return "hair";
    case "headwear":
      return "headwear";
    case "face":
      return "face";
    case "eyewear":
      return "eyewear";
    case "top":
    case "topPelvis":
    case "topWaist":
    case "topOverallLeg":
    case "topSleeve":
    case "topShoulder":
    case "topCollar":
      return "top";
    case "outer":
    case "outerWaist":
    case "outerSleeve":
    case "outerCollar":
      return "outerwear";
    case "legwear":
    case "legwearPelvis":
      return "legwear";
    case "shoeShin":
    case "shoeFoot":
    case "bareFoot":
      return "footwear";
    case "pack":
      return "backpack";
    case "held":
      return "held";
    default:
      return "headwear";
  }
}

export interface WardrobeAttachment {
  /** The runner pivot this hangs from. */
  readonly socket: string;
  /** Authored in the runner's own units, before the socket's scale. */
  readonly node: THREE.Object3D;
}

/**
 * The garments a look calls for, ready to parent onto a runner.
 *
 * Geometry is built once per item and cloned per runner, the way the runner
 * itself is: the templates are the expensive artefact and a player, a ghost and
 * a preview all want the same shapes in different colours. Materials are made
 * per call because the colour is the part that differs.
 *
 * Everything this puts in userData is a plain string, so a runner that already
 * has a wardrobe on it stays clonable. The sculpt runtime's own userData holds
 * circular Object3D references and does not, which is why PlayerVisual strips
 * it before cloning the template.
 */
// Sculpt build pass: authored refinement
//
// PROVENANCE, because this file is the odd one out in this directory and a
// reader is entitled to know why it carried no pass line at all until now.
//
//   1. NOT GENERATED. Every other factory here is stage3_build output with an
//      "ObjectSculptSpec target" line above it. This one has no spec, no
//      generator run and no apply_refinements.py. It is hand-authored from
//      first to last line, which is the honest reason it never had a header:
//      no pass ever emitted it. The rung below is therefore a description of
//      the geometry, not a record of what a pipeline stage produced.
//
//   2. WHY AUTHORED REFINEMENT. The catalogue began as primitive blockouts,
//      then received garment-specific profiles, rounded/extruded panels,
//      open frames, seams, closures, layered construction and distinct cloth,
//      denim, knit, leather, rubber, plastic, glass and metal responses. The
//      rig remains code-authored so every piece can be measured in motion and
//      generated at runtime without shipping a second model format.
//
//   3. WHAT IS NEVERTHELESS MEASURED, so the rung is not read as "placeholder
//      proportions". Every rig constant this file is cut against - the torso
//      lathe profile, the limb axes and radii, each socket's scale, the
//      shoulder height, the head landmarks - is read back out of a built
//      runner by wardrobe.test.ts and fails there if it drifts. The clearances
//      are gated the same way. Thirty-four of the sixty-nine garments take
//      their part breakdown and their contrast placement from a reference
//      image under assets/reference, named at each one.
//
//   4. REVIEWED ON THE BODY. assets/reference/wardrobe/renders holds every
//      garment photographed on the figure through the real picker. That review
//      is what caught the five hats that drew a band across the eyes and the
//      tights that drew nothing at all, none of which any box measurement saw.
export function createWardrobeAttachments(look: ResolvedAvatar): WardrobeAttachment[] {
  const palettes = new Map<string, Record<WardrobeTint, THREE.Material>>();
  return specsFor(look).map((spec) => {
    const colorKey = paletteKeyFor(spec.key);
    let palette = palettes.get(colorKey);
    if (!palette) {
      palette = makePalette(look.garmentColors[colorKey], look.bodyColor);
      palettes.set(colorKey, palette);
    }
    const node = templateFor(spec).clone(true);
    // Enforce the semantic layer order in geometry. A small horizontal
    // clearance on the complete outer assembly keeps its panels, pockets and
    // straps outside the inner top instead of relying on draw order between
    // intersecting surfaces. Neck pieces get the same treatment separately
    // because they ride another socket.
    if (
      spec.key.startsWith("outer:") &&
      ["hoodie", "jacket", "puffer", "vest", "poncho", "harness"].some(
        (id) => spec.key === `outer:${id}`,
      )
    ) {
      node.scale.x *= 1.035;
      node.scale.z *= 1.035;
    } else if (spec.key.startsWith("outerCollar:")) {
      node.scale.x *= 1.04;
      node.scale.z *= 1.04;
    }
    // Back-face ink shells are excellent around an outer silhouette, but an
    // open torso shell also exposes that enlarged back face at its lower rim.
    // On a faceted lathe it photographs as a row of black teeth between shirt
    // and pants—the same visual read as a waist gap. Suppress the independent
    // outline only on torso-layer pieces that actually reach the hem; sleeves,
    // collars and the runner's overall silhouette keep their ink treatment.
    if (spec.key.startsWith("top:") || spec.key.startsWith("outer:")) {
      node.updateMatrixWorld(true);
      node.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        const bounds = new THREE.Box3().setFromObject(mesh);
        if (bounds.min.y <= HEM + 0.035)
          mesh.userData["wardrobeNoOutline"] = true;
      });
    }
    node.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const role = mesh.userData["wardrobeTint"] as WardrobeTint | undefined;
      if (role) mesh.material = palette![role];
    });
    return { socket: spec.socket, node };
  });
}

/**
 * Dress a runner instance.
 *
 * Each socket's own scale is cancelled on the way in. Several of the rig's
 * pivots carry a non-unit scale left over from how the sculpt was authored -
 * the torso is squashed to 0.8 in z, the hands to a seventh of their size - and
 * inheriting those would distort every garment in a way that looks like a
 * modelling mistake rather than a transform.
 *
 * Returns the sockets it could not find, so a rig change surfaces as a failing
 * assertion rather than as clothes that quietly stopped appearing.
 */
export function attachWardrobe(root: THREE.Object3D, look: ResolvedAvatar): string[] {
  const missing: string[] = [];
  const wrappers = new Map<string, THREE.Group>();
  for (const { socket, node } of createWardrobeAttachments(look)) {
    let wrapper = wrappers.get(socket);
    if (!wrapper) {
      const target = root.getObjectByName(socket);
      if (!target) {
        missing.push(socket);
        continue;
      }
      wrapper = new THREE.Group();
      wrapper.name = `Wardrobe on ${socket}`;
      wrapper.scale.set(
        1 / target.scale.x,
        1 / target.scale.y,
        1 / target.scale.z,
      );
      target.add(wrapper);
      wrappers.set(socket, wrapper);
    }
    wrapper.add(node);
  }
  return missing;
}
