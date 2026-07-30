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

/** Half extents of the sneaker box, in Sneaker__pivot's frame. */
const SHOE = { x: 0.099, z: 0.15 } as const;

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

/**
 * How far out a held item has to stay.
 *
 * The victory pose swings the arm up until the hand sits beside the head at
 * x = 0.336, clearing the 0.325 skull by eleven thousandths. Anything in that
 * hand inherits the clearance only if it stays outboard of the skull, and
 * because the arm and hand rotate about X alone, staying outboard is a
 * condition on x alone and holds in every pose at once.
 */
export const HELD_MIN_X = 0.33;

// --- Materials --------------------------------------------------------------

export type WardrobeTint = "main" | "trim" | "ink" | "cream" | "steel" | "glow";

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
 * the authority for anything worn. It is not a stale copy of PALETTE: a garment
 * is judged against the pale wash of the deck the runner stands on - the floor
 * is washed 62% toward cream - and every saturated palette hue is under the 3:1
 * that gate demands, blue at 2.22 and green at 1.16. So a garment colour may
 * never be reached for out of PALETTE, however well the name matches. The note
 * above AVATAR_COLORS carries the measurements and avatar.test.ts pins them.
 *
 * PALETTE is still right for the fixed roles below, because ink and cream are
 * shared by both lists and neither is a colour a player can choose.
 *
 * The boundary is the contrast gate, not whether a part is cloth. The jetpack's
 * body and the boot's sole look like props strapped to a runner, but they sit
 * in gated slots, so they take the wearer's colour rather than the dark navy
 * the hand-authored props use.
 */
function makePalette(main: string): Record<WardrobeTint, THREE.Material> {
  const cloth = (color: THREE.ColorRepresentation) =>
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.78,
      metalness: 0,
      // Shells are single-walled lathes, so both faces have to draw or the
      // inside of a hem reads as a hole punched through the runner.
      side: THREE.DoubleSide,
    });
  return {
    main: cloth(main),
    trim: cloth(trimOf(main)),
    ink: cloth(PALETTE.ink),
    cream: cloth(PALETTE.cream),
    steel: new THREE.MeshStandardMaterial({
      color: "#b9c0cf",
      roughness: 0.34,
      metalness: 0.6,
      side: THREE.DoubleSide,
    }),
    glow: new THREE.MeshStandardMaterial({
      color: PALETTE.yellow,
      emissive: new THREE.Color(PALETTE.yellow),
      emissiveIntensity: 0.75,
      roughness: 0.5,
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
      // wear-cap.png: a mint six-panel crown under a navy curved brim, with a
      // coral button at the apex. The brim is the reference's contrast piece,
      // which is why it is trim rather than main.
      const brim = part(tube(0.24, 0.24, 0.02, 22), "trim", { x: 0, y: -0.035, z: 0.115 });
      brim.scale.z = 1.15;
      const button = part(ball(0.032, 0.026, 0.032), "cream", { x: 0, y: 0.35, z: -0.012 });
      return [hatCrown(0.005, 0.25), brim, button];
    }
    case "band":
      return [
        (() => {
          const band = part(ring(0.33, 0.036), "main", { x: 0, y: 0.02, z: -0.01 });
          band.rotation.x = Math.PI / 2;
          band.scale.z = 0.99;
          return band;
        })(),
      ];
    case "bobble": {
      const cuff = part(tube(0.352, 0.352, 0.09, 22), "trim", { x: 0, y: 0.002, z: -0.012 });
      const pom = part(ball(0.072, 0.072, 0.072), "trim", { x: 0, y: 0.4, z: -0.012 });
      return [hatCrown(0.02, 0.3), cuff, pom];
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
      const crown = part(tube(0.325, 0.39, 0.4, 24), "main", {
        x: 0,
        y: HEAD.hairCenter.y + 0.042,
        z: HEAD.hairCenter.z,
      });
      const band = part(tube(0.392, 0.392, 0.05, 24), "trim", { x: 0, y: -0.028, z: -0.012 });
      const brim = part(tube(0.386, 0.44, 0.05, 24), "main", { x: 0, y: -0.038, z: -0.01 });
      return [crown, band, brim];
    }
    case "beanie": {
      // wear-beanie.png: a knitted crown over a deep folded brim in cream, the
      // brim about a third of the hat's height rather than a thin band.
      // Rides on the forehead, not over the eyes: at the reference's depth a
      // cuff centred where this one was reached HEAD.eye.y and 0.05u below it.
      const cuff = part(tube(0.366, 0.366, 0.145, 22), "cream", { x: 0, y: 0.024, z: -0.012 });
      return [hatCrown(0.015, 0.3), cuff];
    }
    case "visor": {
      const band = part(ring(0.332, 0.032), "trim", { x: 0, y: 0.01, z: -0.01 });
      band.rotation.x = Math.PI / 2;
      const brim = part(tube(0.235, 0.235, 0.02, 22), "main", { x: 0, y: -0.02, z: 0.125 });
      brim.scale.z = 1.12;
      return [band, brim];
    }
    case "helmet": {
      // Full-face motorcycle helmet: the old item was a round cap with one
      // stripe, so it read as the stock hair shell in a different colour.
      const shellGeometry = new THREE.SphereGeometry(1, 26, 16, 0, Math.PI * 2, 0, Math.PI * 0.58);
      shellGeometry.scale(0.385, 0.37, 0.375);
      const shell = part(shellGeometry, "main", { x: 0, y: 0.075, z: -0.018 });
      const visor = part(slab(0.61, 0.12, 0.035), "ink", { x: 0, y: 0.02, z: 0.338 });
      visor.rotation.x = -0.08;
      const chin = part(slab(0.56, 0.12, 0.09), "main", { x: 0, y: -0.25, z: 0.215 });
      chin.rotation.x = -0.16;
      const leftJaw = part(slab(0.09, 0.24, 0.11), "main", { x: -0.305, y: -0.15, z: 0.16 });
      leftJaw.rotation.z = -0.22;
      const rightJaw = leftJaw.clone();
      rightJaw.position.x = 0.305;
      rightJaw.rotation.z = 0.22;
      const leftPivot = part(tube(0.055, 0.055, 0.025, 16), "steel", { x: -0.345, y: -0.05, z: 0.205 });
      leftPivot.rotation.z = Math.PI / 2;
      const rightPivot = leftPivot.clone();
      rightPivot.position.x = 0.345;
      const stripe = part(slab(0.065, 0.32, 0.025), "trim", { x: 0, y: 0.245, z: 0.265 });
      stripe.rotation.x = -0.56;
      return [shell, visor, chin, leftJaw, rightJaw, leftPivot, rightPivot, stripe];
    }
    case "tophat": {
      const brim = part(tube(0.4, 0.4, 0.026, 26), "main", { x: 0, y: 0.13, z: -0.01 });
      const stack = part(tube(0.268, 0.268, 0.34, 22), "main", { x: 0, y: 0.3, z: -0.01 });
      const band = part(ring(0.272, 0.026), "trim", { x: 0, y: 0.165, z: -0.01 });
      band.rotation.x = Math.PI / 2;
      return [hatCrown(-0.02, 0.19), brim, stack, band];
    }
    case "crown": {
      const base = part(tube(0.335, 0.29, 0.13, 26, true), "main", { x: 0, y: 0.14, z: -0.012 });
      const lowerBand = part(ring(0.326, 0.032), "trim", { x: 0, y: 0.085, z: -0.012 });
      lowerBand.rotation.x = Math.PI / 2;
      const points: THREE.Object3D[] = [];
      for (let index = 0; index < 7; index++) {
        const angle = (index / 7) * Math.PI * 2;
        const tall = index % 2 === 0;
        const height = tall ? 0.31 : 0.23;
        const spike = part(new THREE.ConeGeometry(tall ? 0.072 : 0.062, height, 4), "main", {
          x: Math.sin(angle) * 0.275,
          y: 0.28 + height / 2,
          z: Math.cos(angle) * 0.275 - 0.012,
        });
        spike.rotation.y = -angle + Math.PI / 4;
        const pearl = part(ball(0.038, 0.038, 0.038), "cream", {
          x: Math.sin(angle) * 0.275,
          y: 0.29 + height,
          z: Math.cos(angle) * 0.275 - 0.012,
        });
        points.push(spike, pearl);
      }
      const jewels = [-1, 0, 1].map((offset) => {
        const jewel = part(new THREE.OctahedronGeometry(0.045, 0), offset === 0 ? "glow" : "trim", {
          x: offset * 0.14,
          y: 0.145,
          z: 0.302,
        });
        jewel.scale.y = 1.25;
        return jewel;
      });
      return [base, lowerBand, ...points, ...jewels];
    }
    case "cowboy": {
      const brim = part(tube(0.45, 0.4, 0.034, 26), "main", { x: 0, y: 0.095, z: -0.01 });
      brim.scale.z = 1.08;
      const crown = part(ball(0.28, 0.24, 0.26), "main", { x: 0, y: 0.315, z: -0.025 });
      crown.scale.x = 0.92;
      const crease = part(slab(0.07, 0.19, 0.34), "trim", { x: 0, y: 0.39, z: -0.025 });
      const band = part(ring(0.285, 0.024), "trim", { x: 0, y: 0.17, z: -0.018 });
      band.rotation.x = Math.PI / 2;
      return [brim, crown, crease, band];
    }
    case "earmuffs": {
      const band = part(ring(0.375, 0.032, Math.PI), "main", { x: 0, y: -0.055, z: -0.035 });
      return [
        band,
        part(ball(0.068, 0.105, 0.085), "trim", { x: -0.378, y: -0.058, z: -0.02 }),
        part(ball(0.068, 0.105, 0.085), "trim", { x: 0.378, y: -0.058, z: -0.02 }),
      ];
    }
    case "beret": {
      const cap = part(ball(0.352, 0.115, 0.342), "main", { x: 0, y: 0.285, z: -0.045 });
      cap.rotation.z = 0.2;
      const brim = part(ring(0.302, 0.024), "trim", { x: -0.016, y: 0.225, z: -0.03 });
      brim.rotation.x = Math.PI / 2;
      const nub = part(ball(0.03, 0.035, 0.03), "trim", { x: 0.045, y: 0.415, z: -0.05 });
      return [cap, brim, nub];
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
    z: 0.283,
  });
  bar.rotation.z = -side * tilt;
  return bar;
}

function facePartsFor(id: AvatarFaceId): THREE.Object3D[] {
  switch (id) {
    case "plain":
      return [];
    case "grin": {
      const mouth = part(ring(0.085, 0.018, Math.PI), "main", { x: 0, y: -0.19, z: 0.312 });
      mouth.rotation.z = Math.PI;
      mouth.rotation.x = 0.16;
      const teeth = part(slab(0.13, 0.022, 0.014), "cream", { x: 0, y: -0.184, z: 0.328 });
      return [mouth, teeth];
    }
    case "focused":
      return [browBar(-1, 0.072, 0.34), browBar(1, 0.072, 0.34)];
    case "shades": {
      const lens = part(slab(0.235, 0.062, 0.028), "main", { x: 0, y: HEAD.eye.y, z: 0.286 });
      const left = part(slab(0.02, 0.026, 0.16), "main", { x: -0.15, y: HEAD.eye.y, z: 0.21 });
      const right = part(slab(0.02, 0.026, 0.16), "main", { x: 0.15, y: HEAD.eye.y, z: 0.21 });
      return [lens, left, right];
    }
    case "brows":
      return ([-1, 1] as const).map((side) => {
        const brow = part(ball(0.115, 0.035, 0.027), "main", {
          x: side * 0.115,
          y: HEAD.eye.y + 0.105,
          z: 0.295,
        });
        brow.rotation.z = side * 0.12;
        return brow;
      });
    case "moustache": {
      const make = (side: -1 | 1) => {
        const hair = part(ball(0.062, 0.024, 0.022), "main", {
          x: side * 0.056,
          y: -0.132,
          z: 0.276,
        });
        hair.rotation.z = -side * 0.28;
        return hair;
      };
      return [make(-1), make(1)];
    }
    case "beard": {
      const cheek = (side: -1 | 1) => {
        const tuft = part(ball(0.105, 0.08, 0.075), "main", {
          x: side * 0.145,
          y: -0.18,
          z: 0.225,
        });
        tuft.rotation.z = side * 0.18;
        return tuft;
      };
      const chin = part(ball(0.17, 0.07, 0.105), "main", { x: 0, y: -0.255, z: 0.205 });
      return [cheek(-1), cheek(1), chin];
    }
    case "goatee": {
      const patch = part(ball(0.075, 0.045, 0.035), "main", { x: 0, y: -0.195, z: 0.294 });
      const tuft = part(new THREE.ConeGeometry(0.075, 0.17, 14), "main", { x: 0, y: -0.295, z: 0.245 });
      tuft.rotation.z = Math.PI;
      return [patch, tuft];
    }
    case "freckles": {
      const dot = (x: number, y: number) =>
        part(ball(0.014, 0.012, 0.01), "main", { x, y, z: 0.288 });
      return [
        dot(-0.105, -0.095),
        dot(-0.075, -0.125),
        dot(-0.135, -0.13),
        dot(0.105, -0.095),
        dot(0.075, -0.125),
        dot(0.135, -0.13),
      ];
    }
    case "warpaint": {
      const stripe = (side: -1 | 1) =>
        part(slab(0.135, 0.032, 0.014), "main", {
          x: side * 0.105,
          y: -0.128,
          z: 0.281,
        });
      return [stripe(-1), stripe(1)];
    }
    case "mask": {
      const cover = part(ball(0.225, 0.14, 0.09), "main", { x: 0, y: -0.17, z: 0.275 });
      cover.rotation.x = -0.12;
      const foldTop = part(slab(0.34, 0.018, 0.018), "trim", { x: 0, y: -0.12, z: 0.36 });
      const foldBottom = part(slab(0.27, 0.016, 0.016), "trim", { x: 0, y: -0.205, z: 0.35 });
      const loopLeft = part(ring(0.115, 0.012), "cream", { x: -0.31, y: -0.145, z: 0.1 });
      loopLeft.rotation.y = Math.PI / 2;
      const loopRight = part(ring(0.115, 0.012), "cream", { x: 0.31, y: -0.145, z: 0.1 });
      loopRight.rotation.y = Math.PI / 2;
      return [cover, foldTop, foldBottom, loopLeft, loopRight];
    }
  }
}

// --- Eyewear ----------------------------------------------------------------

function eyewearParts(id: AvatarEyewearId): THREE.Object3D[] {
  if (id === "none") return [];
  const temple = (side: -1 | 1) =>
    part(slab(0.018, 0.02, 0.17), "main", { x: side * 0.152, y: HEAD.eye.y, z: 0.205 });
  const bridge = (width: number, y: number) =>
    part(slab(width, 0.016, 0.016), "main", { x: 0, y, z: 0.288 });
  switch (id) {
    case "round": {
      const lens = (side: -1 | 1) => {
        const rim = part(ring(0.056, 0.014), "main", {
          x: side * HEAD.eye.x,
          y: HEAD.eye.y,
          z: 0.292,
        });
        const glass = part(tube(0.052, 0.052, 0.012, 16), "steel", {
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
      // wear-sunglasses.png: a deliberately chunky square frame, where the
      // border is about a fifth of the lens rather than a hairline.
      const lens = (side: -1 | 1) =>
        part(slab(0.118, 0.094, 0.02), "main", {
          x: side * HEAD.eye.x,
          y: HEAD.eye.y,
          z: 0.286,
        });
      const glass = (side: -1 | 1) =>
        part(slab(0.082, 0.058, 0.014), "steel", {
          x: side * HEAD.eye.x,
          y: HEAD.eye.y,
          z: 0.294,
        });
      const assembly = group(
        lens(-1),
        lens(1),
        glass(-1),
        glass(1),
        bridge(0.085, HEAD.eye.y),
        temple(-1),
        temple(1),
      );
      assembly.position.z = 0.05;
      return [assembly];
    }
    case "goggles": {
      const frame = part(ring(0.105, 0.021), "main", { x: 0, y: HEAD.eye.y, z: 0.329 });
      frame.scale.x = 2.45;
      frame.scale.y = 1.03;
      const lens = part(ball(0.235, 0.086, 0.025), "steel", { x: 0, y: HEAD.eye.y, z: 0.334 });
      const strap = part(ring(0.34, 0.038), "trim", { x: 0, y: HEAD.eye.y + 0.008, z: -0.012 });
      strap.rotation.x = Math.PI / 2;
      const vents = [-0.12, 0, 0.12].map((x) =>
        part(slab(0.055, 0.014, 0.016), "cream", { x, y: HEAD.eye.y + 0.105, z: 0.325 }),
      );
      return [strap, lens, frame, ...vents];
    }
    case "aviator": {
      const lens = (side: -1 | 1) => {
        const glass = part(ball(0.068, 0.05, 0.02), "main", {
          x: side * 0.112,
          y: HEAD.eye.y - 0.006,
          z: 0.286,
        });
        glass.rotation.z = -side * 0.12;
        return glass;
      };
      const assembly = group(
        lens(-1),
        lens(1),
        bridge(0.08, HEAD.eye.y + 0.024),
        bridge(0.07, HEAD.eye.y + 0.004),
        temple(-1),
        temple(1),
      );
      assembly.position.z = 0.05;
      return [assembly];
    }
    case "visorband": {
      const visor = part(plate(0.325, 0.12, 1.9), "main", { x: 0, y: HEAD.eye.y, z: 0 });
      const connector = (side: -1 | 1) => {
        const arm = part(slab(0.045, 0.045, 0.245), "trim", {
          x: side * 0.305,
          y: HEAD.eye.y,
          z: 0.105,
        });
        const hinge = part(tube(0.045, 0.045, 0.024, 14), "steel", {
          x: side * 0.327,
          y: HEAD.eye.y,
          z: -0.015,
        });
        hinge.rotation.z = Math.PI / 2;
        return group(arm, hinge);
      };
      return [visor, connector(-1), connector(1)];
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
  /** Where a body hoop carries on across the sleeve, and how deep it is. */
  hoop?: readonly [at: number, depth: number],
): THREE.Group {
  const mesh = limbSleeve(ARM, side, 0.06, to, armRadius(0.06) + 0.015, armRadius(to) + 0.015);
  mesh.userData["wardrobeTint"] = tint;
  // Every sleeve in the reference set ends in a band - rolled on the tee and
  // the jacket, ribbed on the hoodie - so the cuff is on the shared builder
  // rather than repeated per garment.
  const band = limbSleeve(
    ARM,
    side,
    to - cuff[0],
    to + 0.02,
    armRadius(to) + cuff[1],
    armRadius(to) + cuff[1],
  );
  band.userData["wardrobeTint"] = "trim";
  if (!hoop) return group(mesh, band);
  const stripe = limbSleeve(
    ARM,
    side,
    hoop[0],
    hoop[0] + hoop[1],
    armRadius(hoop[0]) + 0.019,
    armRadius(hoop[0] + hoop[1]) + 0.019,
  );
  stripe.userData["wardrobeTint"] = "cream";
  return group(mesh, band, stripe);
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
    case "tee":
      // wear-tee.png: one broad cream band across the chest, not a stripe at
      // the hem. It is the whole of the shirt's second colour.
      shell.add(part(torsoShell(HEM, 0.26, 0.014), "main"));
      shell.add(part(torsoShell(0.03, 0.115, 0.019), "cream"));
      return [shell];
    case "tank": {
      // wear-tank.png: a plain coral body under one continuous cream binding
      // that runs round the neckline, over each shoulder and down the armhole.
      // The binding is the whole of the garment's second colour, and it is
      // what this was missing.
      //
      // It goes round as a full ring because the shell is a lathe and has one
      // height all the way round. The reference's front scoop is not a shape
      // this can hold, so what is bound here is the edge that exists.
      shell.add(part(torsoShell(HEM, 0.155, 0.014), "main"));
      const neckline = part(ring(torsoRadius(0.155) + 0.016, 0.015), "cream", {
        x: 0,
        y: 0.155,
        z: 0,
      });
      neckline.rotation.x = Math.PI / 2;
      shell.add(neckline);
      return [shell, tankStrap(-1), tankStrap(1), armholeBinding(-1), armholeBinding(1)];
    }
    case "stripes": {
      // No reference. Three deep bands in the derived trim read as shading on
      // the body rather than as stripes, and what they read as MOST was the
      // jersey with its collar taken off. Cream at the jersey's own pitch
      // halved is a stripe you can see and cannot mistake for a hoop.
      shell.add(part(torsoShell(HEM, 0.26, 0.014), "main"));
      for (const [bottom, top] of BRETON_BANDS)
        shell.add(part(torsoShell(bottom, top, 0.019), "cream"));
      return [shell];
    }
    case "hoodie": {
      // wear-hoodie.png: a royal-blue pullover, a ribbed hem, a light kangaroo
      // pocket and two cream drawstrings. The pocket is the reference's light
      // piece rather than its dark one, which is why it is cream where the hem
      // rib is trim.
      shell.add(part(torsoShell(HEM, 0.27, 0.016), "main"));
      shell.add(part(torsoShell(HEM, HEM + 0.04, 0.023), "trim"));
      shell.add(part(plate(0.288, 0.115, 1.5), "cream", { x: 0, y: -0.088, z: 0 }));
      const hood = part(ball(0.285, 0.26, 0.24), "main", { x: 0, y: 0.4, z: -0.17 });
      const drawstring = (side: -1 | 1) =>
        part(tube(0.011, 0.011, 0.13, 8), "cream", {
          x: side * 0.052,
          y: 0.155,
          z: 0.196,
        });
      return [shell, hood, drawstring(-1), drawstring(1)];
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
      shell.add(part(torsoShell(HEM, 0.26, 0.014), "main"));
      for (const [bottom, top] of JERSEY_HOOPS)
        shell.add(part(torsoShell(bottom, top, 0.019), "cream"));
      shell.add(part(plate(0.262, 0.15, 0.42), "cream", { x: 0, y: 0.185, z: 0 }));
      return [shell];
    }
    case "overalls": {
      // wear-overalls.png: a bib with a patch pocket on it and one square
      // buckle where each strap meets the bib. The buckles are the light piece.
      shell.add(part(torsoShell(HEM, 0.08, 0.016), "main"));
      shell.add(part(plate(0.28, 0.17, 1.2), "main", { x: 0, y: 0.16, z: 0 }));
      shell.add(part(plate(0.292, 0.1, 0.72), "trim", { x: 0, y: 0.155, z: 0 }));
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
      shell.add(part(torsoShell(HEM, 0.28, 0.022), "main"));
      shell.add(part(torsoShell(HEM, HEM + 0.06, 0.032), "main"));
      return [shell];
    case "racer": {
      // No reference. Two stripes running the LENGTH of the body, which is
      // what a racing stripe is. What was here was two short bars across the
      // chest at one radius: they stood off the body where it narrowed, they
      // stopped at the front, and at a glance they read as two dashes stuck on
      // a plain shirt rather than as any garment at all.
      shell.add(part(torsoShell(HEM, 0.26, 0.014), "main"));
      for (const at of [-0.27, 0.27])
        shell.add(part(torsoStripe(HEM, 0.255, 0.021, 0.3, at), "cream"));
      return [shell];
    }
  }
}

/**
 * The cream edge the tank's binding leaves along each armhole.
 *
 * Set just outboard of the strap it edges rather than round it, because the
 * cream in wear-tank.png runs along the armhole side of the strap and stops
 * there. Its own arc matches tankStrap's so the two read as one bound piece.
 */
function armholeBinding(side: -1 | 1): THREE.Mesh {
  const band = part(ring(0.118, 0.013, Math.PI), "cream", {
    x: side * 0.173,
    y: 0.155,
    z: 0,
  });
  band.rotation.y = Math.PI / 2;
  return band;
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
const SLEEVE_HOOPS: Partial<Record<AvatarTopId, readonly [at: number, depth: number]>> = {
  jersey: [0.52, 0.14],
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
      // wear-tee.png: a ribbed crew neck in the shirt's own colour.
      return [part(tube(0.168, 0.172, 0.05, 18, true), "main", { x: 0, y: 0.005, z: 0 })];
    case "turtleneck":
      // wear-turtleneck.png: the collar is the garment - a tall stand that
      // widens as it rises and rolls over on itself at the top, wide enough to
      // read as knitwear rather than as a neckband. The neck it stands on runs
      // 1.235u to 1.390u and is 0.14u through, so the roll's top edge is set
      // just under the jaw: a collar the head meets when it tilts is what a
      // roll-neck is, and a collar past 1.39u would be one inside the chin.
      return [
        part(tube(0.186, 0.168, 0.145, 18, true), "main", { x: 0, y: 0.06, z: 0 }),
        (() => {
          const roll = part(ring(0.182, 0.027), "main", { x: 0, y: 0.122, z: 0 });
          roll.rotation.x = Math.PI / 2;
          return roll;
        })(),
      ];
    case "hoodie":
      return [part(tube(0.185, 0.2, 0.075, 18, true), "trim", { x: 0, y: 0.015, z: 0 })];
    case "jersey":
      // wear-jersey.png: a cream polo collar that lies flat and spreads as it
      // rises, open at the front where the placket is. Cut on the same partial
      // arc the jacket collar uses, for the same reason: a closed ring here
      // would shut a throat the reference leaves open.
      return [
        part(
          new THREE.CylinderGeometry(0.228, 0.176, 0.062, 18, 1, true, Math.PI - 1.2, 2.4),
          "cream",
          { x: 0, y: 0.031, z: 0 },
        ),
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
    case "jacket": {
      // wear-jacket.png: a denim jacket with a mint collar (on the neck socket
      // below), two flap chest pockets, a hem band and a row of light buttons
      // down the placket.
      shell.add(part(torsoShell(HEM, 0.27, 0.032, 0.5), "main"));
      shell.add(part(torsoShell(HEM, HEM + 0.05, 0.038, 0.5), "trim"));
      const pocket = (side: -1 | 1) => {
        const flap = part(plate(0.3, 0.11, 0.52), "trim", { x: 0, y: 0.075, z: 0 });
        flap.rotation.y = side * 0.44;
        return flap;
      };
      shell.add(pocket(-1));
      shell.add(pocket(1));
      for (const y of [0.2, 0.1, 0, -0.1])
        shell.add(
          part(ball(0.019, 0.019, 0.012), "cream", { x: 0, y, z: torsoRadius(y) + 0.045 }),
        );
      return [shell];
    }
    case "puffer": {
      // wear-puffer.png: horizontal quilted baffles, a full-length zip in a
      // dark contrast, and a stand collar (built on the neck socket below).
      for (const y of [HEM + 0.05, HEM + 0.15, HEM + 0.25, HEM + 0.35, HEM + 0.44])
        shell.add(part(torsoShell(y - 0.045, y + 0.045, 0.042), "main"));
      // A curved strip rather than a flat slab, so the zip follows the barrel
      // of the baffles instead of standing off it at the shoulders.
      shell.add(part(plate(0.305, 0.44, 0.22), "trim", { x: 0, y: HEM + 0.245, z: 0 }));
      return [shell];
    }
    case "vest": {
      // wear-vest.png: a quilted puffer vest, not a flat one - four horizontal
      // baffles, a dark full-length zip, and a stand collar in the body colour
      // (built on the neck socket below).
      for (const y of [HEM + 0.06, HEM + 0.17, HEM + 0.28, HEM + 0.38])
        shell.add(part(torsoShell(y - 0.05, y + 0.05, 0.036), "main"));
      shell.add(part(plate(0.3, 0.42, 0.2), "trim", { x: 0, y: HEM + 0.23, z: 0 }));
      return [shell];
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
      const neckRadius = 0.175;
      const hemRadius = 0.372;
      const cloth = part(tube(neckRadius, hemRadius, shoulder - HEM, 22, true), "main", {
        x: 0,
        y: (shoulder + HEM) / 2,
        z: 0,
      });
      // The hood is UP in this reference, where wear-hoodie.png's rests on the
      // back, so it is not the hoodie's hood moved over: it has to clear a
      // skull rather than sit behind one. The rig puts the head between 1.235u
      // and 1.898u and 0.369u wide, and the eye at z 0.272 - so the hood is
      // wider than the head it covers, reaches almost to the crown, and stops
      // its front rim at the cheek. The first pass sized it off the hoodie and
      // came out a lump behind the shoulders, which is a hood taken down.
      const hood = part(ball(0.405, 0.335, 0.3), "main", { x: 0, y: 0.555, z: -0.135 });
      // The cone's own front surface at each height, so the cord hangs off the
      // cloth instead of floating in front of it or sinking behind it.
      const frontAt = (y: number) =>
        neckRadius + ((shoulder - y) / (shoulder - HEM)) * (hemRadius - neckRadius);
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
      return [cloth, hood, tab, cord(-1), cord(1)];
    }
    case "harness": {
      const belt = part(torsoShell(-0.11, -0.06, 0.03), "main");
      const wrap = shellGroup();
      wrap.add(belt);
      const cross = (side: -1 | 1) => {
        const strap = part(slab(0.05, 0.42, 0.024), "main", {
          x: side * 0.06,
          y: 0.07,
          z: 0.2,
        });
        strap.rotation.z = side * 0.32;
        return strap;
      };
      const buckle = part(slab(0.07, 0.06, 0.03), "trim", { x: 0, y: 0.06, z: 0.215 });
      return [wrap, cross(-1), cross(1), buckle];
    }
    case "scarf": {
      // wear-scarf.png: a chunky knit looped once at the neck with two tails
      // hanging down the front, each ending in a cream fringe. The loop itself
      // rides the neck socket (scarfCollarParts); only the tails are here, and
      // they stop well above the hem so a thigh never reaches them.
      const tail = (side: -1 | 1) => {
        const cloth = part(slab(0.075, 0.235, 0.032), "main", {
          x: side * 0.062,
          y: 0.055,
          z: 0.238,
        });
        const fringe = part(slab(0.079, 0.036, 0.034), "cream", {
          x: side * 0.062,
          y: -0.08,
          z: 0.238,
        });
        return group(cloth, fringe);
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
};

/**
 * Outerwear that closes round the neck rather than round the ribcage.
 *
 * On the neck for the same reason the top collars are: Neck__pivot carries unit
 * scale where the torso does not, so a ring built under the torso would come
 * out oval around a round neck.
 */
function outerCollarParts(id: AvatarOuterwearId): THREE.Object3D[] {
  switch (id) {
    case "puffer":
      return [part(tube(0.195, 0.205, 0.095, 18, true), "trim", { x: 0, y: 0.05, z: 0 })];
    case "scarf":
      return [part(tube(0.207, 0.207, 0.13, 18, true), "main", { x: 0, y: 0.03, z: 0 })];
    case "vest":
      // wear-vest.png: a tall stand collar in the vest's own colour.
      return [part(tube(0.19, 0.2, 0.105, 18, true), "main", { x: 0, y: 0.06, z: 0 })];
    case "jacket":
      // wear-jacket.png: a wide flat collar in a contrast colour, open at the
      // front where the jacket is.
      return [
        part(
          new THREE.CylinderGeometry(0.245, 0.19, 0.07, 18, 1, true, Math.PI - 1.3, 2.6),
          "trim",
          { x: 0, y: 0.035, z: 0 },
        ),
      ];
    default:
      return [];
  }
}

// --- Legwear ----------------------------------------------------------------

/**
 * The cream waistband the shorts, joggers and jeans references all share.
 *
 * It shares the trouser's own top rather than reaching above it, so adding one
 * can never lift the waist into the shirt hem.
 */
function waistband(side: -1 | 1): THREE.Mesh {
  const band = limbSleeve(LEG, side, -0.02, 0.09, legRadius(0) + 0.019, legRadius(0.09) + 0.019);
  band.userData["wardrobeTint"] = "cream";
  return band;
}

function legwearParts(id: AvatarLegwearId, side: -1 | 1): THREE.Object3D[] {
  const trouser = (to: number, radiusTo: number) =>
    limbSleeve(LEG, side, -0.02, to, legRadius(0) + 0.012, radiusTo);
  switch (id) {
    case "none":
      return [];
    case "shorts": {
      // wear-shorts.png: a cream ribbed waistband, a contrast stripe down the
      // outer seam, and a rolled cuff at the hem. The waistband shares the
      // trouser's own top rather than reaching above it, so adding it cannot
      // lift the waist into the shirt hem.
      const leg = trouser(0.44, legRadius(0.44) + 0.022);
      const cuff = limbSleeve(LEG, side, 0.4, 0.46, legRadius(0.44) + 0.028, legRadius(0.44) + 0.028);
      cuff.userData["wardrobeTint"] = "trim";
      const stripe = part(slab(0.014, 0.19, 0.05), "trim");
      stripe.position.copy(limbPoint(LEG, side, 0.24));
      stripe.position.x += side * (legRadius(0.24) + 0.018);
      return [leg, waistband(side), cuff, stripe];
    }
    case "joggers": {
      // wear-joggers.png: a cream ribbed waistband with a drawstring, tapering
      // to a gathered ankle cuff.
      const leg = trouser(0.97, legRadius(0.97) + 0.014);
      const cuff = limbSleeve(LEG, side, 0.9, 1.0, legRadius(0.95) + 0.02, legRadius(0.95) + 0.016);
      cuff.userData["wardrobeTint"] = "trim";
      return [leg, waistband(side), cuff];
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
      const seam = part(slab(0.012, 0.5, 0.04), "cream");
      seam.position.copy(limbPoint(LEG, side, 0.45));
      seam.position.x += side * (legRadius(0.45) + 0.016);
      return [leg, waistband(side), seam];
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
      const band = limbSleeve(LEG, side, -0.02, 0.09, legRadius(0) + 0.019, legRadius(0.09) + 0.019);
      const cuff = limbSleeve(LEG, side, 0.92, 1.04, legRadius(0.95) + 0.027, legRadius(1) + 0.027);
      const pocket = part(slab(0.026, 0.115, 0.085), "main");
      pocket.position.copy(limbPoint(LEG, side, 0.52));
      pocket.position.x += side * (legRadius(0.52) + 0.017);
      const flap = part(slab(0.028, 0.032, 0.089), "main");
      flap.position.copy(limbPoint(LEG, side, 0.42));
      flap.position.x += side * (legRadius(0.42) + 0.019);
      const button = part(ball(0.01, 0.013, 0.013), "cream");
      button.position.copy(limbPoint(LEG, side, 0.44));
      button.position.x += side * (legRadius(0.44) + 0.032);
      return [leg, band, cuff, pocket, flap, button];
    }
    case "kneepads": {
      const pad = part(ball(0.072, 0.066, 0.07), "main");
      pad.position.copy(limbPoint(LEG, side, 0.54));
      pad.position.z += 0.028;
      const cuff = limbSleeve(LEG, side, 0.44, 0.64, legRadius(0.44) + 0.014, legRadius(0.64) + 0.014);
      cuff.userData["wardrobeTint"] = "trim";
      return [cuff, pad];
    }
    case "kilt": {
      const panel = limbSleeve(LEG, side, -0.02, 0.44, legRadius(0) + 0.01, 0.1, true);
      const band = limbSleeve(LEG, side, -0.03, 0.05, legRadius(0) + 0.015, legRadius(0) + 0.015);
      band.userData["wardrobeTint"] = "trim";
      return [panel, band];
    }
    case "tights": {
      // No reference. A second skin is the point, so the sleeve stays thin -
      // but a thin sleeve in the wearer's own colour over a leg is a garment
      // with nothing to be seen by, and photographed on the runner this drew
      // a figure indistinguishable from a bare one. The waist and ankle bands
      // are what make it read as worn; the leg itself is left as close to the
      // body as it was.
      const leg = trouser(1.05, legRadius(1.0) + 0.008);
      // The same 0.019 the shared waistband stands at, and for the same
      // reason: the legs are 0.21 apart and a band 0.002 fatter than this has
      // the two sides meeting at the crotch. The test measured it at 0.0023.
      const waist = limbSleeve(LEG, side, -0.02, 0.1, legRadius(0) + 0.019, legRadius(0.1) + 0.019);
      waist.userData["wardrobeTint"] = "trim";
      const ankle = limbSleeve(
        LEG,
        side,
        0.9,
        1.05,
        legRadius(0.9) + 0.019,
        legRadius(1.05) + 0.019,
      );
      ankle.userData["wardrobeTint"] = "trim";
      return [leg, waist, ankle];
    }
  }
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
      const cuff = limbSleeve(LEG, side, 0.6, 0.68, legRadius(0.62) + 0.034, legRadius(0.68) + 0.03);
      cuff.userData["wardrobeTint"] = "trim";
      return [shaft, cuff];
    }
    case "socks": {
      const sock = limbSleeve(LEG, side, 0.56, 1.06, legRadius(0.56) + 0.016, legRadius(1) + 0.012);
      const band = limbSleeve(LEG, side, 0.58, 0.66, legRadius(0.58) + 0.021, legRadius(0.66) + 0.021);
      band.userData["wardrobeTint"] = "trim";
      return [sock, band];
    }
    case "skates": {
      const shaft = limbSleeve(LEG, side, 0.72, 1.06, legRadius(0.8) + 0.026, legRadius(1) + 0.02);
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
      // wear-hightop.png: a deep cream midsole standing well proud of the
      // upper, a dark outsole under it, a cream toe cap and a laced throat.
      // The midsole's bottom stops level with the boot's, so a high-top does
      // not stand the runner any further off the deck than a boot already
      // does - the gait solver measures an undressed runner and neither can
      // move where the foot lands.
      return [
        part(roundedSlab(SHOE.x * 2.4, 0.068, SHOE.z * 2.06), "cream", { x: 0, y: -0.062, z: 0.005 }),
        part(roundedSlab(SHOE.x * 2.34, 0.026, SHOE.z * 2.02), "trim", { x: 0, y: -0.097, z: 0.005 }),
        part(ball(SHOE.x * 0.96, 0.055, SHOE.z * 0.52), "cream", { x: 0, y: -0.012, z: 0.1 }),
        part(roundedSlab(SHOE.x * 1.5, 0.026, SHOE.z * 0.44), "cream", { x: 0, y: 0.056, z: -0.03 }),
      ];
    case "boot":
      // wear-boots.png: an orange upper over a cream lugged sole, with the dark
      // padded collar handled by the shin parts above. The sole is cream rather
      // than trim because the reference's sole is the light piece.
      return [
        part(roundedSlab(SHOE.x * 2.14, 0.16, SHOE.z * 2.02), "main", { x: 0, y: 0.0, z: 0.005 }),
        part(roundedSlab(SHOE.x * 2.18, 0.05, SHOE.z * 2.04), "cream", { x: 0, y: -0.085, z: 0.005 }),
      ];
    case "sandal": {
      // wear-sandal.png: a thick cream footbed in two tiers, two straps
      // CROSSING over the instep, and a sling behind the heel. The sole was
      // the coloured piece and the straps the dark one, which is the reference
      // exactly inverted - it reads a sandal as a coloured plank with bars
      // laid over it.
      //
      // The straps are trim rather than the reference's own coloured strap,
      // and that is the one place this item departs from it. Choosing footwear
      // repaints the sculpt's sneaker to the wearer's colour, so unlike every
      // other shoe here there is a main-coloured foot still showing under an
      // open garment: a main strap lying straight on it would have nothing to
      // read against. What the reference settles is that the strap contrasts
      // with the sole, and it still does.
      const footbed = part(roundedSlab(SHOE.x * 2.08, 0.042, SHOE.z * 2.0), "cream", {
        x: 0,
        y: -0.058,
        z: 0.005,
      });
      const midsole = part(roundedSlab(SHOE.x * 2.22, 0.034, SHOE.z * 2.04), "cream", {
        x: 0,
        y: -0.092,
        z: 0.005,
      });
      // Rotated about Y rather than Z, so the pair cross in the plane of the
      // foot the way the reference's do. Rotating about Z would tilt them off
      // the footbed instead, and would widen the shoe rather than the strap.
      const strap = (side: -1 | 1) => {
        const band = part(roundedSlab(SHOE.x * 2.16, 0.028, 0.05), "trim", { x: 0, y: 0.012, z: 0.03 });
        band.rotation.y = side * 0.55;
        return band;
      };
      const sling = part(ring(0.076, 0.015, Math.PI), "trim", { x: 0, y: 0.006, z: -0.1 });
      return [footbed, midsole, strap(-1), strap(1), sling];
    }
    case "cleats": {
      // The shoe is cut from wear-trainers.png, which is the one foot
      // reference in the set with no garment of its own: a chunky cream
      // midsole under a low upper, one swept stripe along each side, and a
      // cream lace band. That reference is a running shoe, so the studs under
      // it are invented, and they are the only invented part of this item.
      //
      // The stripe is trim and the midsole cream, which swaps the reference's
      // pale upper and mint stripe: the upper is the piece that takes the
      // wearer's colour on every other shoe in the catalogue, and a cream
      // stripe on a cream midsole would have no edge to read by.
      const midsole = part(roundedSlab(SHOE.x * 2.24, 0.055, SHOE.z * 2.04), "cream", {
        x: 0,
        y: -0.07,
        z: 0.005,
      });
      const stripe = (side: -1 | 1) =>
        part(roundedSlab(0.014, 0.03, SHOE.z * 1.16), "trim", {
          x: side * SHOE.x * 1.04,
          y: -0.022,
          z: -0.012,
        });
      const laces = part(roundedSlab(SHOE.x * 1.48, 0.024, SHOE.z * 0.42), "cream", {
        x: 0,
        y: 0.056,
        z: -0.028,
      });
      const studs = [
        [-0.05, 0.1],
        [0.05, 0.1],
        [-0.05, -0.06],
        [0.05, -0.06],
      ].map(([x, z]) =>
        part(tube(0.016, 0.022, 0.036, 8), "trim", { x: x!, y: -0.116, z: z! }),
      );
      return [midsole, stripe(-1), stripe(1), laces, ...studs];
    }
    case "skates": {
      // wear-skates.png is a ROLLER skate - a light sole plate under the boot
      // and four wheels - where this was modelled as an ice skate with a single
      // blade. The reference's mint plate and coral wheels swap roles here so
      // the wheels stay the darker of the two: a light wheel on a light boot is
      // a wheel you cannot see.
      const sole = part(roundedSlab(SHOE.x * 1.7, 0.03, SHOE.z * 1.9), "cream", {
        x: 0,
        y: -0.115,
        z: 0.005,
      });
      const wheels = [
        [-0.072, 0.09],
        [0.072, 0.09],
        [-0.072, -0.08],
        [0.072, -0.08],
      ].map(([x, z]) => {
        // Sits no lower than the blade it replaces, so the foot still meets the
        // deck where the gait solver - which measures an undressed runner -
        // expects it to.
        const wheel = part(tube(0.042, 0.042, 0.028, 12), "trim", { x: x!, y: -0.145, z: z! });
        wheel.rotation.z = Math.PI / 2;
        return wheel;
      });
      return [sole, ...wheels];
    }
    case "socks":
      return [];
  }
}

// --- Backpacks --------------------------------------------------------------

function backpackParts(id: AvatarBackpackId): THREE.Object3D[] {
  switch (id) {
    case "none":
      return [];
    case "daypack": {
      // wear-backpack.png: a coral body, a dark front pocket flap with a light
      // buckle, and a grab loop on top. The sculpt already wears the shoulder
      // straps the reference has, in its own strap-coral material, so they are
      // not rebuilt here.
      const body = part(ball(0.16, 0.175, 0.115), "main", { x: 0, y: 0.02, z: -0.3 });
      const flap = part(ball(0.155, 0.075, 0.108), "trim", { x: 0, y: 0.13, z: -0.3 });
      const pocket = part(ball(0.115, 0.09, 0.03), "trim", { x: 0, y: -0.03, z: -0.4 });
      const buckle = part(slab(0.045, 0.035, 0.025), "cream", { x: 0, y: -0.035, z: -0.425 });
      const grab = part(ring(0.045, 0.016, Math.PI), "trim", { x: 0, y: 0.185, z: -0.3 });
      grab.rotation.y = Math.PI / 2;
      return [body, flap, pocket, buckle, grab];
    }
    case "bedroll": {
      const roll = part(tube(0.088, 0.088, 0.34, 16), "main", { x: 0, y: 0.09, z: -0.29 });
      roll.rotation.z = Math.PI / 2;
      const strap = part(slab(0.035, 0.03, 0.2), "trim", { x: 0, y: 0.09, z: -0.29 });
      return [roll, strap];
    }
    case "jetpack": {
      // wear-jetpack.png: one rounded body with a porthole, swept fins either
      // side, a band across the bottom and two pale thruster cones - not the
      // two bare barrels this was. The cones are short because the hem rule
      // wins over the reference: anything hanging below 0.772u world gets cut
      // through by a swinging thigh.
      const body = part(ball(0.185, 0.2, 0.1), "main", { x: 0, y: 0.06, z: -0.29 });
      const porthole = part(tube(0.055, 0.055, 0.022, 14), "cream", { x: 0, y: 0.07, z: -0.385 });
      porthole.rotation.x = Math.PI / 2;
      const fin = (side: -1 | 1) => {
        const blade = part(ball(0.075, 0.115, 0.022), "trim", {
          x: side * 0.2,
          y: 0.05,
          z: -0.3,
        });
        blade.rotation.z = -side * 0.28;
        return blade;
      };
      // The band rides higher than the reference's so the thrusters clear it.
      // Photographed on the runner, a band at -0.113 covered all but the last
      // 0.036u of each cone and the pack read as a lump with a stripe on it.
      const band = part(slab(0.33, 0.042, 0.19), "trim", { x: 0, y: -0.086, z: -0.29 });
      const cone = (side: -1 | 1) =>
        part(tube(0.058, 0.032, 0.07, 12), "cream", { x: side * 0.09, y: -0.135, z: -0.29 });
      return [body, porthole, fin(-1), fin(1), band, cone(-1), cone(1)];
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
      const cloak = part(
        new THREE.CylinderGeometry(0.26, 0.38, 0.27 - HEM, 18, 1, true, Math.PI - 1.05, 2.1),
        "main",
        { x: 0, y: (0.27 + HEM) / 2, z: 0 },
      );
      cloak.name = "Cape cloth";
      const collar = part(
        new THREE.CylinderGeometry(0.3, 0.26, 0.075, 18, 1, true, Math.PI - 1.25, 2.5),
        "trim",
        { x: 0, y: 0.3, z: 0 },
      );
      const tie = part(slab(0.125, 0.028, 0.028), "cream", { x: 0, y: 0.25, z: 0.185 });
      return [cloak, collar, tie];
    }
    case "wings": {
      const panel = (side: -1 | 1, rx: number, ry: number, y: number, tilt: number) => {
        const membrane = part(ball(rx, ry, 0.016), "main", {
          x: side * (rx + 0.05), y, z: -0.225,
        });
        membrane.rotation.z = -side * tilt;
        const rim = part(ball(rx + 0.013, ry + 0.013, 0.012), "cream", {
          x: side * (rx + 0.05), y, z: -0.237,
        });
        rim.rotation.z = -side * tilt;
        const back = part(ball(rx, ry, 0.01), "main", {
          x: side * (rx + 0.05), y, z: -0.255,
        });
        back.rotation.z = -side * tilt;
        return group(rim, membrane, back);
      };
      const wing = (side: -1 | 1) =>
        group(panel(side, 0.15, 0.19, 0.17, 0.35), panel(side, 0.1, 0.1, 0.015, 0.2));
      const knot = part(ball(0.035, 0.046, 0.03), "cream", { x: 0, y: 0.075, z: -0.216 });
      return [wing(-1), wing(1), knot];
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
      const pole = part(tube(0.012, 0.012, 0.36, 8), "trim", { x: 0.05, y: 0.1, z: 0 });
      const banner = part(slab(0.01, 0.11, 0.17), "main", { x: 0.05, y: 0.22, z: 0.095 });
      return [pole, banner];
    }
    case "torch": {
      // wear-torch.png: a pale bowl on a pale handle with a banded collar under
      // it, and two flames - an outer one and a brighter inner one. The outer
      // flame takes the carried colour, which is the only part of a torch a
      // player can own. Both are given their size in z, not in x.
      const handle = part(tube(0.018, 0.014, 0.16, 10), "cream", { x: 0.055, y: 0.02, z: 0 });
      const collar = part(tube(0.03, 0.024, 0.045, 12), "trim", { x: 0.055, y: 0.115, z: 0 });
      const bowl = part(tube(0.05, 0.026, 0.05, 14), "cream", { x: 0.055, y: 0.16, z: 0 });
      bowl.scale.z = 1.4;
      const flame = part(tube(0.001, 0.044, 0.13, 10), "main", { x: 0.055, y: 0.245, z: 0 });
      flame.scale.z = 1.3;
      const core = part(tube(0.001, 0.024, 0.085, 8), "glow", { x: 0.055, y: 0.225, z: 0 });
      return [handle, collar, bowl, flame, core];
    }
    case "umbrella": {
      // wear-umbrella.png is FURLED, not open: a tapered spindle of gores under
      // a banded collar, with a crook handle above and a pale ferrule below.
      // The crook curves fore-and-aft because that is the free direction - one
      // curving sideways would swing through the skull.
      const canopy = part(tube(0.052, 0.008, 0.26, 12), "main", { x: 0.055, y: 0.06, z: 0 });
      canopy.scale.x = 0.55;
      const band = part(tube(0.04, 0.04, 0.032, 12), "trim", { x: 0.055, y: 0.09, z: 0 });
      band.scale.x = 0.6;
      const shaft = part(tube(0.011, 0.011, 0.12, 8), "cream", { x: 0.055, y: 0.24, z: 0 });
      const crook = part(ring(0.032, 0.011, Math.PI), "cream", { x: 0.055, y: 0.3, z: 0.032 });
      crook.rotation.y = Math.PI / 2;
      const ferrule = part(ball(0.014, 0.028, 0.014), "cream", { x: 0.055, y: -0.078, z: 0 });
      return [canopy, band, shaft, crook, ferrule];
    }
    case "baguette": {
      // wear-baguette.png: a golden crust with four pale diagonal slashes. The
      // slashes ride in the loaf's own group, so they keep their place on it
      // when it is tipped.
      const loaf = group(part(ball(0.036, 0.036, 0.135), "main"));
      for (const z of [-0.075, -0.025, 0.025, 0.075]) {
        const slash = part(ball(0.01, 0.012, 0.026), "cream", { x: 0, y: 0.03, z });
        slash.rotation.y = 0.5;
        loaf.add(slash);
      }
      loaf.position.set(0.05, 0.07, 0.02);
      loaf.rotation.x = 0.55;
      return [loaf];
    }
    case "plunger": {
      // wear-plunger.png: a pale straight handle into a collar, over a domed
      // cup with a rolled rim. The cup stays squashed in x whatever the
      // reference's is, because the hand it is in swings past the skull.
      const handle = part(tube(0.014, 0.014, 0.24, 8), "cream", { x: 0.058, y: 0.07, z: 0 });
      const collar = part(tube(0.03, 0.03, 0.045, 12), "main", { x: 0.058, y: -0.032, z: 0 });
      collar.scale.x = 0.6;
      const cup = part(tube(0.038, 0.075, 0.085, 14), "main", { x: 0.058, y: -0.082, z: 0 });
      cup.scale.x = 0.6;
      const rim = part(tube(0.082, 0.082, 0.022, 14), "trim", { x: 0.058, y: -0.122, z: 0 });
      rim.scale.x = 0.6;
      return [handle, collar, cup, rim];
    }
    case "balloon": {
      // No reference. The string used to rise straight off the fist, which put
      // the skin 0.027u from the upper arm: not touching, and reading as welded
      // to it, which is what a player reported as the balloon going through the
      // body. Measured against the torso it was never close - 0.318 of the
      // lathe's own radius clear - so the arm is what it was up against.
      //
      // The clearance is spent by leaning the string forward, because z is the
      // only direction there is any. x is pinned between the 0.325u skull the
      // hand swings past and the deck the runner may not overhang, which is a
      // corridor 0.125u wide, and a ball wide enough to read as a balloon uses
      // most of it. Leaning about X keeps every x exactly where it was, so the
      // skull clearance the old one had is the clearance this one has.
      const lean = group(
        part(tube(0.007, 0.007, 0.3, 6), "trim", { x: 0, y: 0.16, z: 0 }),
        part(ball(0.015, 0.019, 0.015), "trim", { x: 0, y: 0.316, z: 0 }),
        part(ball(0.05, 0.082, 0.082), "main", { x: 0, y: 0.4, z: 0 }),
      );
      lean.position.set(0.048, 0.01, 0);
      lean.rotation.x = 0.62;
      return [lean];
    }
    case "trophy": {
      // wear-trophy.png: a cup with a rolled rim and two ring handles, on a
      // two-tier base in a dark contrast. Nothing here goes past the 0.062u the
      // cup already reached, and the whole thing moves 0.003u outboard: this is
      // the held item that clears the skull by the least, and it was clearing
      // it by six ten-thousandths of a unit.
      const cup = part(tube(0.056, 0.028, 0.088, 14), "main", { x: 0.058, y: 0.132, z: 0 });
      const rim = part(tube(0.062, 0.062, 0.016, 14), "main", { x: 0.058, y: 0.178, z: 0 });
      const stem = part(tube(0.016, 0.016, 0.05, 8), "main", { x: 0.058, y: 0.062, z: 0 });
      const knop = part(ball(0.026, 0.014, 0.026), "main", { x: 0.058, y: 0.048, z: 0 });
      const foot = part(tube(0.044, 0.044, 0.024, 12), "trim", { x: 0.058, y: 0.024, z: 0 });
      const base = part(tube(0.055, 0.055, 0.018, 12), "trim", { x: 0.058, y: 0.004, z: 0 });
      const grip = (side: -1 | 1) => {
        const loop = part(ring(0.031, 0.009), "main", { x: 0.058, y: 0.15, z: side * 0.06 });
        loop.rotation.y = Math.PI / 2;
        return loop;
      };
      return [cup, rim, stem, knop, foot, base, grip(-1), grip(1)];
    }
  }
}

// --- Assembly ---------------------------------------------------------------

function specsFor(look: ResolvedAvatar): Spec[] {
  const specs: Spec[] = [];
  const add = (socket: string, key: string, parts: () => THREE.Object3D[]) => {
    specs.push({ socket, key, build: () => group(...parts()) });
  };

  if (look.headwear !== "hair")
    add(SOCKETS.head, `headwear:${look.headwear}`, () => headwearParts(look.headwear));
  if (look.face !== "plain")
    add(SOCKETS.head, `face:${look.face}`, () => facePartsFor(look.face));
  if (look.eyewear !== "none")
    add(SOCKETS.head, `eyewear:${look.eyewear}`, () => eyewearParts(look.eyewear));

  if (look.top !== "none") {
    add(SOCKETS.torso, `top:${look.top}`, () => topShellParts(look.top));
    if (collarParts(look.top).length > 0)
      add(SOCKETS.neck, `topCollar:${look.top}`, () => collarParts(look.top));
    const reach = TOP_SLEEVES[look.top];
    if (reach !== undefined)
      for (const [socket, side] of ARM_SOCKETS)
        add(socket, `topSleeve:${look.top}:${side}`, () => [
          sleeve(side, reach, "main", DEEP_CUFFS[look.top], SLEEVE_HOOPS[look.top]),
        ]);
    for (const [socket] of SHOULDER_SOCKETS)
      add(socket, `topShoulder:${look.top}`, () => [
        shoulderPad(0.092, "main", SHOULDER_BANDS[look.top]),
      ]);
  }

  if (look.outerwear !== "none") {
    add(SOCKETS.torso, `outer:${look.outerwear}`, () => outerwearParts(look.outerwear));
    if (outerCollarParts(look.outerwear).length > 0)
      add(SOCKETS.neck, `outerCollar:${look.outerwear}`, () =>
        outerCollarParts(look.outerwear),
      );
    const reach = OUTER_SLEEVES[look.outerwear];
    if (reach !== undefined)
      for (const [socket, side] of ARM_SOCKETS)
        add(socket, `outerSleeve:${look.outerwear}:${side}`, () => [
          sleeve(side, reach, "main"),
        ]);
  }

  if (look.legwear !== "none")
    for (const [socket, side] of LEG_SOCKETS)
      add(socket, `legwear:${look.legwear}:${side}`, () => legwearParts(look.legwear, side));

  if (look.footwear !== "none") {
    for (const [socket, side] of LEG_SOCKETS)
      add(socket, `shoeShin:${look.footwear}:${side}`, () =>
        footwearShinParts(look.footwear, side),
      );
    for (const [socket] of SHOE_SOCKETS)
      add(socket, `shoeFoot:${look.footwear}`, () => footwearFootParts(look.footwear));
  }

  if (look.backpack !== "none")
    add(SOCKETS.torso, `pack:${look.backpack}`, () => backpackParts(look.backpack));

  if (look.held !== "none")
    add(SOCKETS.handRight, `held:${look.held}`, () => {
      // Every authored handle crosses x=.05/y=0. Move that grip to the local
      // origin before scaling, then seat it in the outboard half of the palm.
      // X stays at authored size: widening a handle makes it miss the hand and
      // widening a balloon makes it swing through the head. Height and depth
      // get the readable-size pass the props need on screen.
      const readableScale: Record<Exclude<AvatarHeldId, "none">, number> = {
        flag: 2,
        torch: 2,
        umbrella: 1.85,
        baguette: 2.05,
        plunger: 1.9,
        balloon: 1.9,
        trophy: 1.9,
      };
      const contents = group(...heldParts(look.held));
      contents.position.x = -0.05;
      const prop = group(contents);
      prop.position.x = 0.055;
      const size = readableScale[look.held as Exclude<AvatarHeldId, "none">];
      prop.scale.set(1, size, size);
      return [prop];
    });

  return specs;
}

/** Which garment colour a socket's contents take. */
function paletteKeyFor(key: string): keyof ResolvedAvatar["garmentColors"] {
  const slot = key.slice(0, key.indexOf(":"));
  switch (slot) {
    case "headwear":
      return "headwear";
    case "face":
      return "face";
    case "eyewear":
      return "eyewear";
    case "top":
    case "topSleeve":
    case "topShoulder":
    case "topCollar":
      return "top";
    case "outer":
    case "outerSleeve":
    case "outerCollar":
      return "outerwear";
    case "legwear":
      return "legwear";
    case "shoeShin":
    case "shoeFoot":
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
// Sculpt build pass: blockout
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
//   2. WHY BLOCKOUT AND NOT HIGHER. Every part is an unmodified primitive -
//      sphere, cylinder, box, torus, lathe. There are no bevels, no smoothing
//      work, no custom profiles beyond the two torso lathes, and those are
//      sampled from the runner's own lathe rather than modelled. Several items
//      are two primitives total: the flag is a tube and a slab, the bedroll a
//      tube and a slab. Nothing here has had an optimization pass either - no
//      LOD, no merging, no vertex budget; the segment counts are hand-picked
//      per call. Anyone unlocking a deeper pass should expect to be modelling,
//      not tidying.
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
      palette = makePalette(look.garmentColors[colorKey]);
      palettes.set(colorKey, palette);
    }
    const node = templateFor(spec).clone(true);
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
