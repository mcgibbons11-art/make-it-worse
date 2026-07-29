"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createMAKEITWORSEApartmentRoomModel } from "../models/createApartmentModel";
import {
  APARTMENT_VARIANTS,
  LAMP_POOL_MATERIAL,
  type ApartmentVariant,
} from "./apartmentFurnishing";

/**
 * Furnished rooms opening off the course.
 *
 * The corridor used to be bounded by flat cream slabs with three embossed
 * rectangles on each, which is what "the environment is extremely plain" was
 * describing. These are the real thing: the sculpted apartment room, built by
 * the img2threejs pipeline from assets/reference/apartment-reference.png, stood
 * on both sides of the run so the player is looking into somewhere rather than
 * at a wall.
 *
 * Cost is the reason this is not simply a cloned group per room. One room is 26
 * meshes across 8 materials, so eight rooms cloned naively is 240 draw calls for
 * scenery. Instead the room is built once, every mesh is baked into room space,
 * the result is merged per material, and each material is drawn as a single
 * InstancedMesh across all the rooms. That is 8 draw calls whatever the room
 * count, which is what lets there be enough rooms to read as an apartment.
 *
 * That is now 8 draw calls per FURNITURE SET rather than 8 in total. A room every
 * 4.7 units of course and a runner covering 7.2 units a second means a new room
 * every 0.65 seconds, and one set repeated at that rate is the loudest thing in
 * the environment: the corridor stops being a place and becomes a texture. Four
 * sets on the same shell costs at most 32 batches, still two orders of magnitude
 * under cloning, and each set's geometry is uploaded once no matter how many
 * rooms carry it.
 */

/** Keeps texture work off the frame budget; the room is scenery, not a prop. */
const SCULPT_OPTIONS = { textureSize: 256, qualityPriority: "balanced" } as const;

interface RoomBatch {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

/**
 * Every mesh in the room, baked into room space and merged by the material it
 * uses. InstancedMesh children are expanded first: they carry their instances in
 * a matrix buffer rather than in the scene graph, so walking children alone
 * would drop the legs, the plank seams and the butt joints.
 */
function batchRoom(variant: ApartmentVariant, mirrored: boolean): RoomBatch[] {
  const room = createMAKEITWORSEApartmentRoomModel({ ...SCULPT_OPTIONS, variant });
  room.updateWorldMatrix(true, true);
  const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
  // mergeGeometries refuses a mixed batch: every geometry must be indexed or
  // none of them. ExtrudeGeometry is non-indexed and the box and cylinder
  // primitives are indexed, and the room uses both under one material - navy
  // covers the extruded skirting and the boxed plank seams, cream covers the
  // extruded table and the turned legs - so two of the eight batches merged to
  // null and those parts silently did not draw. Everything is flattened to
  // non-indexed on the way in.
  const collect = (material: THREE.Material, geometry: THREE.BufferGeometry) => {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    const list = byMaterial.get(material);
    if (list) list.push(flat);
    else byMaterial.set(material, [flat]);
  };
  room.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!material) return;
    const instanced = node as THREE.InstancedMesh;
    if (instanced.isInstancedMesh) {
      const local = new THREE.Matrix4();
      for (let index = 0; index < instanced.count; index += 1) {
        instanced.getMatrixAt(index, local);
        collect(
          material,
          mesh.geometry.clone().applyMatrix4(local.premultiply(instanced.matrixWorld)),
        );
      }
      return;
    }
    collect(material, mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
  });
  const batches: RoomBatch[] = [];
  for (const [material, geometries] of byMaterial) {
    const merged = mergeGeometries(geometries, false);
    if (!merged)
      throw new Error(`apartment room: could not merge the ${material.name} batch`);
    batches.push({ geometry: mirrored ? mirrorInZ(merged) : merged, material });
  }
  return batches;
}

/**
 * Turn the room back to front along Z, winding and all.
 *
 * The reason this is baked into the geometry rather than applied as a scale on
 * the instance matrix is that a negative determinant is not a free transform.
 * It reverses triangle winding, so every outward face becomes a back face, and
 * three's double-sided shading then negates the normal on back faces - while the
 * normal had already been mirrored correctly by the same matrix. The two
 * corrections compound: an up-facing floor ends up lit as though it faced down,
 * and the room renders in the hemisphere light's purple ground colour with the
 * sun contributing nothing. Doing it once here leaves every instance matrix a
 * plain rotation, which needs no double-siding and no correction at all.
 */
function mirrorInZ(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  // applyMatrix4 mirrors the normals along with the positions; what it cannot
  // do is reorder the triangles, so the winding is repaired below.
  geometry.applyMatrix4(new THREE.Matrix4().makeScale(1, 1, -1));
  for (const attribute of Object.values(geometry.attributes)) {
    const buffer = attribute as THREE.BufferAttribute;
    const stride = buffer.itemSize;
    for (let vertex = 0; vertex + 2 < buffer.count; vertex += 3)
      for (let part = 0; part < stride; part += 1) {
        const first = (vertex + 1) * stride + part;
        const second = (vertex + 2) * stride + part;
        const held = buffer.array[first]!;
        buffer.array[first] = buffer.array[second]!;
        buffer.array[second] = held;
      }
    buffer.needsUpdate = true;
  }
  return geometry;
}

const batched = new Map<string, RoomBatch[]>();

function roomBatches(variant: ApartmentVariant, mirrored: boolean): RoomBatch[] {
  const key = `${variant}:${mirrored}`;
  let batches = batched.get(key);
  if (!batches) {
    batches = batchRoom(variant, mirrored);
    batched.set(key, batches);
  }
  return batches;
}

/**
 * Why there are two bakes rather than one.
 *
 * This started as a variety lever and turned out to be a bug fix. The shipped
 * build baked ONE handedness, mirrorInZ(sculpt), whose walls land on -X and +Z.
 * That is right for a room on the -X side of the corridor: outer wall outward,
 * other wall at the far end, interior open to a player approaching from -Z. It
 * is wrong for the +X side, which reaches its outer wall by a half turn about Y,
 * and a half turn takes the +Z wall to -Z - the NEAR side. Half the rooms on the
 * course were presenting the player a blank cream slab, and this file's own
 * comment claimed the mirror "backs the room instead of hiding it", which was
 * true of the rooms I had been looking at and false of the other half.
 *
 * A rotation cannot fix it. Only 0 and 180 degrees keep the walls square to the
 * corridor, and neither puts a turned room's walls on +X and +Z. The bake has to
 * differ, so a turned room takes the UNMIRRORED sculpt: walls at -X and -Z,
 * which the half turn carries to +X and +Z. Outer wall outward, far wall at the
 * far end, interior open. Exactly the property the other side already had.
 *
 * The unmirrored bake is also the one that needs no winding repair, because it
 * is the geometry as authored and was never passed through a negative
 * determinant. Only the mirrored half goes through mirrorInZ.
 */

/**
 * Where a room stands and which way it faces.
 *
 * The sculpt is a corner authored for the reference camera, which looks in from
 * +X and +Z at once: solid walls on -X and -Z, open to +X and +Z, window on the
 * -X wall. The chase camera does not stand there. It sits 7.4u behind the runner
 * and 4.3u up, so it looks along +Z and across at whichever side the room is on,
 * and the faces it can see are the room's +X or -X side and its -Z side.
 *
 * The room is therefore mirrored in Z once, in batchRoom, which moves the -Z
 * wall to the far end where it backs the room instead of hiding it. After that a
 * left-hand room needs no transform at all and a right-hand one is a half turn
 * about Y, which puts its remaining wall on the outer side. Both are rotations,
 * so nothing here has to compensate for a flipped winding.
 *
 * Leaving the sculpt unmirrored looks like it works and does not: the near wall
 * is then a back face, and it only stays out of the way for as long as nothing
 * turns backface culling off.
 */
interface RoomPlacement {
  x: number;
  z: number;
  turned: boolean;
  variant: ApartmentVariant;
  /** Index into SOFT_TINTS. Never applied to the architecture. */
  tint: number;
  /**
   * Which way round the sculpt is baked, and it is not free choice: it is
   * determined by `turned`, because only one of the two bakes leaves a room's
   * interior open to the camera once its rotation is applied.
   */
  mirrored: boolean;
}

/** Half the room's floor, so a caller can reason about the corridor it leaves. */
const ROOM_HALF_WIDTH = 2.155;

/**
 * Which materials may change colour room to room.
 *
 * Soft goods only. The wall, floor, trim and glazing carry the contrast the deck
 * legibility work was measured against, and PALETTE.danger marks ground a hazard
 * reaches, so neither the architecture nor anything near that red is allowed to
 * drift. What is left is the fabric: the rug field, the curtains, the throw, the
 * cushion, the duvet and the upholstery.
 */
const SOFT_GOODS = new Set(["rug-coral", "rug-gold", "sage-green"]);

/**
 * Per-instance tints, applied through InstancedMesh's colour buffer.
 *
 * This is the one repetition lever that is genuinely free. Anything expressed as
 * geometry - a mirrored room, a swapped prop - needs its own merged batch,
 * because a batch is one buffer drawn many times and instancing can only vary
 * the matrix and the colour. Colour it can vary, so this costs zero extra draw
 * calls and zero extra triangles no matter how many entries are in the list.
 *
 * Every entry is at most 1.0 per channel because the buffer MULTIPLIES the
 * material's own albedo: a tint can deepen or shift a hue, never brighten past
 * what the material already is. Three entries against four furniture sets gives
 * twelve distinct rooms before anything repeats, rather than four.
 */
export const SOFT_TINTS: readonly (readonly [number, number, number])[] = [
  [1, 1, 1],
  [0.8, 0.72, 1],
  [0.95, 0.78, 0.62],
];

/**
 * The four sets in a per-course order.
 *
 * Rooms alternate sides and the variant stride is odd, so untransformed rooms
 * take even indices and turned rooms odd ones - and (even x odd) mod 4 is always
 * {0,2} while (odd x odd) mod 4 is always {1,3}. No choice of stride escapes
 * that, so each side of the corridor shows two of the four sets and that much is
 * structural. Which two is not: permuting the list per course moves the pairing
 * without adding a bake, so a player who runs several courses meets the whole
 * catalogue on both sides even though any one course splits it.
 *
 * Fisher-Yates over a small linear congruential generator, which reaches all
 * twenty-four permutations and therefore all three ways of splitting four sets
 * into two pairs, each either way round.
 */
function orderedVariants(seed: number): readonly ApartmentVariant[] {
  const order = [...APARTMENT_VARIANTS];
  let state = (seed >>> 0) || 1;
  for (let index = order.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const swap = state % (index + 1);
    const held = order[index]!;
    order[index] = order[swap]!;
    order[swap] = held;
  }
  return order;
}

export function apartmentRoomPlacements(
  courseLength: number,
  corridorHalfWidth: number,
  courseSeed = 0,
): RoomPlacement[] {
  // Rooms are staggered rather than paired so the two sides never frame the
  // player symmetrically, which is what makes a corridor read as a corridor.
  const centre = corridorHalfWidth + ROOM_HALF_WIDTH;
  const placements: RoomPlacement[] = [];
  const spacing = 9.4;
  // Walking the four sets with a stride of three rather than one means the two
  // sides never show the same set at the same z, and a player never meets the
  // same set twice within the four rooms they can see at once.
  const sets = orderedVariants(courseSeed);
  const setAt = (index: number) => sets[(index * 3) % sets.length]!;
  // Four sets and three tints are coprime, so the pair cycles with a period of
  // twelve rather than locking in step and repeating every four rooms.
  const tintAt = (index: number) => index % SOFT_TINTS.length;
  let index = 0;
  for (let z = 6.2; z < courseLength - 1; z += spacing) {
    placements.push({
      x: -centre,
      z,
      turned: false,
      variant: setAt(index),
      tint: tintAt(index),
      mirrored: true,
    });
    placements.push({
      x: centre,
      z: z + spacing / 2,
      turned: true,
      variant: setAt(index + 1),
      tint: tintAt(index + 1),
      mirrored: false,
    });
    index += 2;
  }
  return placements;
}

export function ApartmentRooms({
  courseLength,
  corridorHalfWidth = 4.25,
  courseSeed = 0,
}: {
  courseLength: number;
  corridorHalfWidth?: number;
  /** Identity of the course, so the set pairing differs from track to track. */
  courseSeed?: number;
}) {
  const placements = useMemo(
    () => apartmentRoomPlacements(courseLength, corridorHalfWidth, courseSeed),
    [courseLength, corridorHalfWidth, courseSeed],
  );
  // One batch set per furniture set, each carrying only the rooms that use it.
  // A set nobody placed is never built, so a course too short to reach the
  // fourth room does not pay for the fourth set.
  const groups = useMemo(
    () =>
      APARTMENT_VARIANTS.flatMap((variant) =>
        [true, false].flatMap((mirrored) => {
          const rooms = placements.filter(
            (room) => room.variant === variant && room.mirrored === mirrored,
          );
          // A combination nobody placed is never built, so a course too short to
          // reach the handedness threshold pays for one handedness, not two.
          if (rooms.length === 0) return [];
          const matrices = rooms.map((room) =>
            new THREE.Matrix4().compose(
              new THREE.Vector3(room.x, 0, room.z),
              new THREE.Quaternion().setFromAxisAngle(
                new THREE.Vector3(0, 1, 0),
                room.turned ? Math.PI : 0,
              ),
              new THREE.Vector3(1, 1, 1),
            ),
          );
          const tints = rooms.map((room) => {
            const [r, g, b] = SOFT_TINTS[room.tint % SOFT_TINTS.length]!;
            return new THREE.Color(r, g, b);
          });
          return [
            {
              key: `${variant}-${mirrored}`,
              matrices,
              tints,
              batches: roomBatches(variant, mirrored),
            },
          ];
        }),
      ),
    [placements],
  );

  return (
    <group>
      {groups.map((group) =>
        group.batches.map((batch, index) => (
          <instancedMesh
            key={`${group.key}-${index}`}
            args={[batch.geometry, batch.material, group.matrices.length]}
            // The light pools are light, not objects: a disc that cast a shadow
            // would darken the floor it is there to brighten, and skipping them
            // keeps the shadow pass off a batch that writes no depth anyway.
            castShadow={batch.material.name !== LAMP_POOL_MATERIAL}
            receiveShadow={batch.material.name !== LAMP_POOL_MATERIAL}
            ref={(mesh) => {
              if (!mesh) return;
              group.matrices.forEach((matrix, slot) => mesh.setMatrixAt(slot, matrix));
              mesh.instanceMatrix.needsUpdate = true;
              // setColorAt allocates the buffer on first use, and three only
              // compiles the instance-colour path for materials that have one,
              // so the architecture batches stay on exactly the shader they had.
              if (SOFT_GOODS.has(batch.material.name)) {
                group.tints.forEach((tint, slot) => mesh.setColorAt(slot, tint));
                if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
              }
              mesh.computeBoundingSphere();
            }}
          />
        )),
      )}
    </group>
  );
}
