import * as THREE from "three";
import type { ExtrudeProfile } from "../models/createApartmentModel";

/**
 * Everything in the apartment room that the generator does not build.
 *
 * `forge/stage3_build/generate_threejs_factory.py` emits the six macro masses of
 * the blockout pass and nothing else, because the passes above it are locked
 * behind review evidence the spec's own reviewHistory does not carry. This
 * module is the rest of the room, and it is deliberately a separate file so that
 * the boundary between what the pipeline produced and what a person wrote is a
 * file boundary rather than a comment somewhere in the middle of a generated
 * file. `assets/reference/apartment/apply_refinements.py` injects the call, so
 * re-running `build.sh` reproduces the shipped room instead of deleting it.
 *
 * Two bands live here, and they are kept apart on purpose:
 *
 *   SPEC FURNISHING - the twenty components authored in
 *   apartment-sculpt-spec.json that the blockout pass does not reach. Every
 *   dimension is the spec's own, except where a spec value is recorded below as
 *   wrong and corrected.
 *
 *   BEYOND THE REFERENCE - detail no part of apartment-reference.png shows. The
 *   reference is one living room photographed once; a corridor of sixty copies
 *   of it reads as a corridor of one room copied sixty times. Everything in this
 *   band is invented, and each piece says so.
 */

/**
 * Which furniture set a room carries. `living` is the reference room and is
 * unchanged by the variant system: the reference is the ground truth for that
 * room and nothing here is allowed to edit it. The other three swap the sofa and
 * the side table for a different set on the same shell.
 */
export type ApartmentVariant = "living" | "kitchen" | "bedroom" | "study";

export const APARTMENT_VARIANTS: readonly ApartmentVariant[] = [
  "living",
  "kitchen",
  "bedroom",
  "study",
];

export interface FurnishingContext {
  root: THREE.Group;
  materials: Record<string, THREE.Material>;
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  variant: ApartmentVariant;
  castShadow: boolean;
  receiveShadow: boolean;
  /**
   * The generated factory's own extruder, handed in rather than imported. It
   * lives in the generated file, and importing it back would make the two
   * modules a cycle for no gain: the type comes across as a type-only import,
   * which is erased.
   */
  extrude(profile: ExtrudeProfile): THREE.BufferGeometry;
}

/**
 * Room space, before ApartmentRooms mirrors the batch in Z.
 *
 * Wall A stands across X and carries the window; its inner face is at
 * x = -2.00. Wall B stands across Z and carries the sofa; its inner face is at
 * z = -2.00. Both run from the floor at y = 0 to a crest at y = 3.10. The floor
 * tray's rim reaches x and z = +/-2.155, and tests/unit/sculpted-props.test.ts
 * pins that: ApartmentRooms stands every room at corridorHalfWidth + 2.155, so a
 * part that reaches past it walks a room floor into the corridor the course runs
 * down. Nothing below may leave the box those four numbers describe.
 *
 * What that works out to in world space, measured rather than derived, because
 * the room's box is not symmetric about its own origin: wall A's outer face sits
 * at x -2.16 while the tray rim reaches +2.15, so a room centred at 6.405 puts
 * its NEAREST face at 4.2450, not at the 4.25 the placement arithmetic suggests.
 * The widest deck a course can put underfoot has its edge at 4.0, leaving 0.245
 * of clearance against a 0.15 keepout. "Leaves the corridor the course runs down
 * completely clear" in the same test file measures exactly that, through the
 * real placement matrices, and fails if a prop ever eats into it.
 */
const WALL_A_FACE = -2.0;
/**
 * Where the picture rail runs. The window's frame tops out at 2.51 and the crest
 * is at 3.10, so 2.72 is the one height that clears the joinery and still leaves
 * the wall reading as taller than the line drawn across it.
 */
const PICTURE_RAIL_Y = 2.72;

// A filleted rectangle loop, sampled the way the sculpt spec samples its own:
// five segments per corner arc, 24 points in all. Every furnishing profile in
// apartment-sculpt-spec.json that is not a plain rectangle is one of these, so
// generating them here reproduces the authored point lists rather than
// approximating them.
function roundedRectLoop(halfX: number, halfY: number, radius: number): [number, number][] {
  const loop: [number, number][] = [];
  const cx = halfX - radius;
  const cy = halfY - radius;
  const corners: [number, number][] = [[cx, cy], [-cx, cy], [-cx, -cy], [cx, -cy]];
  corners.forEach(([centreX, centreY], quadrant) => {
    for (let step = 0; step <= 5; step += 1) {
      const angle = ((quadrant + step / 5) * Math.PI) / 2;
      loop.push([centreX + radius * Math.cos(angle), centreY + radius * Math.sin(angle)]);
    }
  });
  return loop;
}

/**
 * The one material that is not measured off the reference.
 *
 * A warm shade reads as a lit lamp at corridor distance where a cream one reads
 * as a cone. It is an EMISSIVE and not a light: a room stands every 4.7 units of
 * course, so a practical that actually cast light would be sixty point lights on
 * a 285 unit track, and three.js would run out of light slots long before the
 * frame budget did. What this buys is a shade that looks lit, not a pool of
 * light on the floor.
 *
 * Module-level so the four sets share one instance, which keeps it to one merged
 * batch per room rather than one per set.
 */
let lampGlow: THREE.MeshStandardMaterial | null = null;

/**
 * The pool a practical throws on the boards.
 *
 * An emissive shades itself and lights nothing, so the shade alone was a lit
 * lamp standing over an unlit floor. This is the light it casts, faked the way
 * this art style wants: a disc lying on the boards, opaque at the centre and
 * transparent at the rim, ADDED to what is already there so it brightens the
 * floor rather than tinting it.
 *
 * The blend is the load-bearing part. Plain additive ignores alpha entirely in
 * three's basic shader, so the whole disc would add at full strength and read as
 * a hard-edged coin of light. Source alpha against a destination of one is
 * additive WEIGHTED by alpha, which is what makes the falloff a falloff.
 *
 * Module-level so all four sets share one instance and one merged batch.
 */
let lampPool: THREE.MeshBasicMaterial | null = null;
export const LAMP_POOL_MATERIAL = "lamp-pool";
function lampPoolMaterial(): THREE.MeshBasicMaterial {
  lampPool ??= new THREE.MeshBasicMaterial({
    name: LAMP_POOL_MATERIAL,
    color: 0xffd489,
    transparent: true,
    vertexColors: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneFactor,
  });
  return lampPool;
}

/**
 * A disc whose vertex alpha falls from the centre to nothing at the rim.
 *
 * The falloff is carried in the colour attribute rather than in a texture, so
 * there is no canvas to allocate, nothing to decode, and it works in the test
 * environment where getContext does not exist. CircleGeometry puts the centre
 * vertex first and the rim after it, which is exactly the split needed.
 */
function poolGeometry(radius: number, strength: number): THREE.BufferGeometry {
  const disc = new THREE.CircleGeometry(radius, 24);
  disc.rotateX(-Math.PI / 2);
  const count = disc.attributes.position!.count;
  const colors = new Float32Array(count * 4);
  for (let index = 0; index < count; index += 1) {
    colors[index * 4] = 1;
    colors[index * 4 + 1] = 1;
    colors[index * 4 + 2] = 1;
    colors[index * 4 + 3] = index === 0 ? strength : 0;
  }
  disc.setAttribute("color", new THREE.BufferAttribute(colors, 4));
  return disc;
}
function lampGlowMaterial(): THREE.MeshStandardMaterial {
  lampGlow ??= new THREE.MeshStandardMaterial({
    name: "lamp-glow",
    color: 0xfff0c4,
    emissive: 0xffd489,
    emissiveIntensity: 1.5,
    roughness: 0.85,
  });
  return lampGlow;
}

export function addApartmentFurnishing(context: FurnishingContext): void {
  const { root, materials, nodes, meshes, variant, extrude } = context;

  // The generator builds the eight materials but never names them, so every one
  // arrives with name "". Anything downstream that keys off a material - the
  // per-room tint in ApartmentRooms, and that file's own merge-failure message -
  // was matching against an empty string and silently doing nothing. Naming them
  // here rather than in the factory keeps the generated section untouched.
  for (const [id, entry] of Object.entries(materials)) {
    if (entry && !entry.name) entry.name = id;
  }

  const material = (id: string): THREE.Material =>
    id === "lamp-glow"
      ? lampGlowMaterial()
      : id === LAMP_POOL_MATERIAL
        ? lampPoolMaterial()
        : materials[id] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });

  const mount = (id: string, name: string, mesh: THREE.Mesh): void => {
    mesh.name = name;
    mesh.castShadow = context.castShadow;
    mesh.receiveShadow = context.receiveShadow;
    root.add(mesh);
    nodes[id] = mesh;
    meshes[id] = mesh;
  };

  /** A profiled solid placed by its centre, which is how the spec measures. */
  const part = (
    id: string,
    name: string,
    materialId: string,
    position: readonly [number, number, number],
    profile: ExtrudeProfile,
    rotationX = 0,
  ): void => {
    const mesh = new THREE.Mesh(extrude(profile), material(materialId));
    mesh.position.set(position[0], position[1], position[2]);
    mesh.rotation.x = rotationX;
    mount(id, name, mesh);
  };

  /** A primitive solid, for the few shapes a profile cannot describe. */
  const solid = (
    id: string,
    name: string,
    materialId: string,
    position: readonly [number, number, number],
    geometry: THREE.BufferGeometry,
  ): void => {
    const mesh = new THREE.Mesh(geometry, material(materialId));
    mesh.position.set(position[0], position[1], position[2]);
    mount(id, name, mesh);
  };

  /** A repeated micro part, drawn once. Offsets are local to `parent`. */
  const cluster = (
    id: string,
    name: string,
    materialId: string,
    parent: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    offsets: readonly (readonly [number, number, number])[],
  ): void => {
    const instanced = new THREE.InstancedMesh(geometry, material(materialId), offsets.length);
    instanced.name = name;
    instanced.castShadow = context.castShadow;
    instanced.receiveShadow = context.receiveShadow;
    const placement = new THREE.Matrix4();
    offsets.forEach((offset, index) => {
      instanced.setMatrixAt(index, placement.makeTranslation(offset[0], offset[1], offset[2]));
    });
    instanced.instanceMatrix.needsUpdate = true;
    parent.add(instanced);
    nodes[id] = instanced;
  };

  const bevel = (size: number) => ({ size, thickness: size, segments: 3 });
  /** Two segments, for the parts added below: a fillet nobody can resolve at
   *  corridor distance is triangles spent on nothing. */
  const softBevel = (size: number) => ({ size, thickness: size, segments: 2 });
  const rect = (halfX: number, halfY: number): [number, number][] => [
    [-halfX, -halfY],
    [halfX, -halfY],
    [halfX, halfY],
    [-halfX, halfY],
  ];

  // ===========================================================================
  // SPEC FURNISHING
  //
  // The twenty components apartment-sculpt-spec.json authors above the blockout
  // pass. Every dimension, position and profile is the spec's own except where
  // a comment records the spec value as wrong. Without these the room has no
  // window, no rug, no cushions, no legs and no floorboards, which is most of
  // what makes the reference read as a room at all.
  // ===========================================================================

  // Navy skirting where each wall meets the floor. The profile is a hair under
  // 0.002 across because the fillet is what gives the rail its whole section.
  part("skirting-a", "Skirting rail, wall A", "trim-navy", [-1.955, 0.1235, -0.08], {
    points: roundedRectLoop(0.001, 0.0795, 0.0009),
    depth: 4.072,
    axis: "z",
    center: true,
    bevel: bevel(0.044),
  });
  part("skirting-b", "Skirting rail, wall B", "trim-navy", [0, 0.1235, -1.955], {
    points: roundedRectLoop(0.001, 0.0795, 0.0009),
    depth: 3.912,
    axis: "x",
    center: true,
    bevel: bevel(0.044),
  });

  // The window: a recess behind the glazing so the opening has depth, the
  // glazing plate, the frame ring, and the muntin cross that splits it in four.
  //
  // The spec puts the reveal at x -2.02 and the glass at -1.995. The reveal is
  // 0.1 thick, so it spans -2.07 to -1.97 and swallows the 0.03 glazing plate
  // whole: the rendered window came out solid sage with no blue in it at all.
  // Wall A's inner face is at x -2.00, so the reveal is seated into the wall
  // here and the glass sits just proud of its front face, which is the depth
  // order the reveal is named for.
  part("window-reveal", "Window reveal box", "sage-green", [-2.045, 1.78, 0.15], {
    points: rect(0.685, 0.53),
    depth: 0.04,
    axis: "x",
    center: true,
    bevel: bevel(0.03),
  });
  part("window-glass", "Glazing plate", "glass-blue", [-1.975, 1.78, 0.15], {
    points: rect(0.685, 0.53),
    depth: 0.03,
    axis: "x",
    center: true,
  });
  part("window-frame", "Window frame ring", "sage-green", [-1.94, 1.78, 0.15], {
    points: roundedRectLoop(0.835, 0.68, 0.13),
    holes: [rect(0.735, 0.58)],
    depth: 0.02,
    axis: "x",
    center: true,
    bevel: bevel(0.05),
  });
  part("window-muntin-vertical", "Vertical muntin", "sage-green", [-1.955, 1.78, 0.15], {
    points: rect(0.027, 0.502),
    depth: 0.034,
    axis: "x",
    center: true,
    bevel: bevel(0.028),
  });
  part("window-muntin-horizontal", "Horizontal muntin", "sage-green", [-1.955, 1.78, 0.15], {
    points: rect(0.657, 0.027),
    depth: 0.034,
    axis: "x",
    center: true,
    bevel: bevel(0.028),
  });

  // The rug: a coral field inside a gold binding. The spec's own y values put
  // the field's top at 0.050 and the border's at 0.055, so the border covered
  // the field and the rug rendered gold all over. The field is lifted to lie on
  // the binding instead, which is where a bound rug's field actually sits.
  const rug = (
    id: string,
    borderName: string,
    fieldName: string,
    centre: readonly [number, number],
    halfX: number,
    halfZ: number,
    fieldMaterial: string,
  ): void => {
    part(`${id}-border`, borderName, "rug-gold", [centre[0], 0.0275, centre[1]], {
      points: roundedRectLoop(halfX, halfZ, Math.min(0.278, halfZ * 0.31)),
      depth: 0.011,
      axis: "y",
      center: true,
      bevel: bevel(0.022),
    });
    part(`${id}-field`, fieldName, fieldMaterial, [centre[0], 0.035, centre[1]], {
      points: roundedRectLoop(halfX - 0.156, halfZ - 0.156, Math.min(0.122, (halfZ - 0.156) * 0.16)),
      depth: 0.014,
      axis: "y",
      center: true,
      bevel: bevel(0.018),
    });
  };

  // Five seams for six boards, plus the butt joints, staggered so no two
  // adjacent boards break on the same line.
  const floorSlab = nodes["floor-slab"];
  if (floorSlab) {
    cluster(
      "plank-seam-cluster",
      "Board run seams",
      "trim-navy",
      floorSlab,
      new THREE.BoxGeometry(0.035, 0.022, 3.98),
      [
        [-1.32667, 0.141, 0],
        [-0.66333, 0.141, 0],
        [0, 0.141, 0],
        [0.66333, 0.141, 0],
        [1.32667, 0.141, 0],
      ],
    );
    cluster(
      "plank-butt-cluster",
      "Board butt joints",
      "trim-navy",
      floorSlab,
      new THREE.BoxGeometry(0.66333, 0.022, 0.035),
      [
        [-1.65833, 0.141, -0.64],
        [-1.65833, 0.141, 1.08],
        [-0.995, 0.141, -0.02],
        [-0.995, 0.141, 1.7],
        [-0.33167, 0.141, 0.6],
        [0.33167, 0.141, -0.33],
        [0.33167, 0.141, 1.39],
        [0.995, 0.141, 0.29],
        [1.65833, 0.141, 0.91],
      ],
    );
  }

  // ===========================================================================
  // BEYOND THE REFERENCE - shared architecture
  //
  // apartment-reference.png shows bare plaster between the skirting and the
  // crest, because it is one room lit for a product shot. A corridor is not one
  // room. These four go into every variant, so what changes between rooms is the
  // furniture and what stays constant is the building.
  // ===========================================================================

  // Picture rail. One continuous horizontal at 2.72 on both walls. It is the
  // cheapest thing in this file and the one that does the most work: a chase
  // camera at y 4.3 looks down across four metres of unbroken plaster per room,
  // and a single line at a fixed height is what turns that into a wall. Navy
  // rather than a second cream, because the reference's own trim colour is the
  // only one in the palette that survives being 0.09 tall at corridor distance.
  part("picture-rail-a", "Picture rail, wall A", "trim-navy", [-1.965, PICTURE_RAIL_Y, -0.08], {
    points: rect(0.022, 0.03),
    depth: 4.0,
    axis: "z",
    center: true,
    bevel: softBevel(0.014),
  });
  part("picture-rail-b", "Picture rail, wall B", "trim-navy", [0, PICTURE_RAIL_Y, -1.965], {
    points: rect(0.022, 0.03),
    depth: 3.84,
    axis: "x",
    center: true,
    bevel: softBevel(0.014),
  });

  // A doorway in wall B. The room reads as a box with two open sides until
  // something says it connects to the rest of the flat, and an unlit reveal
  // behind a frame is the whole of that read at speed: 13:1 of navy against
  // cream, in the one part of the wall the sofa does not cover. It is a panel
  // and not a hole because a hole through wall B would show the corridor's own
  // back wall through it, 2.08 further out, which is not where a room goes.
  //
  // x -1.45 with a half width of 0.52 leaves 0.03 between the frame's right edge
  // and the sofa arm's left face at -0.90. Anything wider and the arm clips it.
  part("door-reveal", "Doorway reveal", "trim-navy", [-1.45, 1.03, -2.02], {
    points: rect(0.52, 1.03),
    depth: 0.04,
    axis: "z",
    center: true,
  });
  part("door-frame", "Doorway frame", "furniture-cream", [-1.45, 1.06, -1.96], {
    points: roundedRectLoop(0.6, 1.11, 0.09),
    holes: [rect(0.52, 1.03)],
    depth: 0.05,
    axis: "z",
    center: true,
    bevel: softBevel(0.025),
  });

  // Curtains. Two panels flanking the window, hung from a pole, with a real fold
  // profile rather than a flat card: the fold is extruded as the panel's
  // horizontal footprint, so the silhouette against the plaster is scalloped and
  // the key light breaks across the front of it. This is the largest block of
  // saturated colour on wall A and it is what stops the window reading as a
  // sticker.
  const foldProfile = (halfWidth: number): [number, number][] => {
    const front: [number, number][] = [];
    const steps = 12;
    for (let index = 0; index <= steps; index += 1) {
      const t = index / steps;
      // Three folds across the panel. The cosine is sampled rather than a curve
      // command because ExtrudeGeometry's curveSegments would resample it.
      front.push([0.075 + 0.055 * Math.cos(t * Math.PI * 6), -halfWidth + t * halfWidth * 2]);
    }
    return [[0, -halfWidth], ...front, [0, halfWidth]];
  };
  const curtainMaterial = variant === "bedroom" ? "sage-green" : "rug-coral";
  // The pair straddle the glazing: the window's own edges are at z -0.735 and
  // 1.035, and each panel laps 0.075 over one of them, which is what a hung
  // curtain does and what stops a gap of bare plaster showing between the two.
  for (const [id, z, half] of [
    ["curtain-left", -0.88, 0.22],
    ["curtain-right", 1.18, 0.22],
  ] as const) {
    part(id, id === "curtain-left" ? "Curtain, left" : "Curtain, right", curtainMaterial, [WALL_A_FACE + 0.065, 1.46, z], {
      points: foldProfile(half),
      depth: 2.28,
      axis: "y",
      center: true,
    });
  }
  const pole = new THREE.CylinderGeometry(0.032, 0.032, 2.9, 8);
  pole.rotateX(Math.PI / 2);
  solid("curtain-pole", "Curtain pole", "trim-navy", [-1.93, 2.62, 0.15], pole);

  // A radiator. Not under the window, which is where a radiator belongs and
  // where the reference's own side table already stands: it runs along the same
  // wall at z -1.55 instead, the one stretch of wall A that no variant uses.
  // The fins are what make it a radiator rather than a box - eight navy verticals
  // at 0.09 spacing, each about eleven pixels wide from the corridor, which is
  // over the threshold where a repeated line still reads as a texture.
  part("radiator-body", "Radiator body", "furniture-cream", [-1.94, 0.62, -1.55], {
    points: rect(0.4, 0.28),
    depth: 0.08,
    axis: "x",
    center: true,
    bevel: softBevel(0.03),
  });
  const radiator = nodes["radiator-body"];
  if (radiator) {
    cluster(
      "radiator-fin-cluster",
      "Radiator fins",
      "trim-navy",
      radiator,
      new THREE.BoxGeometry(0.1, 0.44, 0.035),
      Array.from({ length: 8 }, (_, index) => [0.075, 0, (index - 3.5) * 0.09] as const),
    );
  }

  // A windowsill and a wall shelf. Two jobs each: they break the run of bare
  // plaster between the skirting and the picture rail, which was the largest
  // unbroken surface left in the room, and they are somewhere to put things.
  // Every horizontal surface in the first build was empty, and an empty surface
  // reads as a model rather than as a place someone lives.
  //
  // The sill stops at z -0.65 and 0.95 rather than running the window's full
  // opening, because the curtains hang to x -1.87 and a sill that reached under
  // them would pass through the fabric.
  part("window-sill", "Windowsill", "furniture-cream", [-1.93, 1.02, 0.15], {
    points: rect(0.07, 0.8),
    depth: 0.06,
    axis: "y",
    center: true,
    bevel: softBevel(0.02),
  });
  part("wall-shelf", "Wall shelf", "furniture-cream", [-1.91, 1.52, -1.55], {
    points: rect(0.09, 0.4),
    depth: 0.05,
    axis: "y",
    center: true,
    bevel: softBevel(0.02),
  });

  /** A small standing object. Clutter is boxes and cylinders on purpose: at
   *  corridor distance the silhouette and the colour are the whole read, and a
   *  filleted mug costs eight times the triangles for a pixel nobody resolves. */
  const clutter = (
    id: string,
    name: string,
    materialId: string,
    position: readonly [number, number, number],
    size: readonly [number, number, number],
  ): void => solid(id, name, materialId, position, new THREE.BoxGeometry(size[0], size[1], size[2]));

  const cylinder = (
    id: string,
    name: string,
    materialId: string,
    position: readonly [number, number, number],
    radius: number,
    height: number,
  ): void => solid(id, name, materialId, position, new THREE.CylinderGeometry(radius, radius * 0.94, height, 10));

  /** A row of book spines standing on a surface, in the four accent colours. */
  const bookRow = (
    id: string,
    start: readonly [number, number, number],
    count: number,
    step: number,
    along: "x" | "z",
  ): void => {
    const palette = ["rug-coral", "rug-gold", "sage-green", "glass-blue"];
    for (let index = 0; index < count; index += 1) {
      const height = index % 3 === 0 ? 0.24 : index % 3 === 1 ? 0.2 : 0.27;
      const offset = index * step;
      clutter(
        `${id}-${index}`,
        `Book spine, ${id} ${index}`,
        palette[index % palette.length]!,
        [
          start[0] + (along === "x" ? offset : 0),
          start[1] + height / 2,
          start[2] + (along === "z" ? offset : 0),
        ],
        along === "x" ? [0.055, height, 0.15] : [0.15, height, 0.055],
      );
    }
  };

  // A plant on the sill and books on the shelf, in every set. The pot is the one
  // piece of saturated colour below the picture rail on wall A, and the foliage
  // is the only silhouette in the room that is not a rectangle.
  cylinder("sill-pot", "Windowsill pot", "rug-coral", [-1.93, 1.12, -0.34], 0.075, 0.14);
  solid("sill-plant", "Windowsill plant", "sage-green", [-1.93, 1.27, -0.34], new THREE.SphereGeometry(0.115, 10, 7));
  bookRow("shelf-book", [-1.91, 1.545, -1.86], 5, 0.075, "z");
  cylinder("shelf-mug", "Shelf mug", "glass-blue", [-1.91, 1.585, -1.3], 0.045, 0.08);

  /** The pool under a practical. Radii are capped by the room, not by taste. */
  const pool = (
    id: string,
    centre: readonly [number, number],
    radius: number,
    strength = 0.5,
  ): void => solid(id, "Lamp pool", LAMP_POOL_MATERIAL, [centre[0], 0.006, centre[1]], poolGeometry(radius, strength));

  // ===========================================================================
  // BEYOND THE REFERENCE - the furniture sets
  //
  // The corridor places a room every 4.7 units and a runner covers that in 0.65
  // seconds, so one furniture set repeated is the single loudest thing in the
  // environment. Each set below stands on the same shell, uses the same eight
  // measured materials, and swaps only what the room is for.
  // ===========================================================================

  // Wall art at eye height. One canvas per wall, in the variant's own accent, so
  // the colour a player catches out of the corner of their eye is different room
  // to room even where the furniture is occluded.
  const accent = {
    living: "rug-coral",
    kitchen: "glass-blue",
    bedroom: "sage-green",
    study: "rug-gold",
  }[variant];
  // A navy frame, not a cream one. The first build framed the canvas in
  // furniture-cream against wall-cream plaster - #f3e5d2 on #f3e3ce, which is
  // under one percent apart - and the picture rendered as a faint dent in the
  // wall with no picture in it. The frame carries the contrast and the field
  // carries the colour.
  const canvas = (
    centre: readonly [number, number],
    halfWide: number,
    halfTall: number,
    fill: string,
  ): void => {
    part("art-frame", "Wall canvas frame", "trim-navy", [centre[0], centre[1], -1.95], {
      points: roundedRectLoop(halfWide + 0.055, halfTall + 0.055, 0.045),
      depth: 0.05,
      axis: "z",
      center: true,
      bevel: softBevel(0.02),
    });
    part("art-field", "Wall canvas field", fill, [centre[0], centre[1], -1.9], {
      points: rect(halfWide, halfTall),
      depth: 0.03,
      axis: "z",
      center: true,
    });
  };
  const canvasSlot = {
    living: { centre: [0.45, 2.06] as const, halfWide: 0.5, halfTall: 0.3 },
    kitchen: { centre: [-1.45, 2.42] as const, halfWide: 0.4, halfTall: 0.2 },
    bedroom: { centre: [0.62, 2.12] as const, halfWide: 0.5, halfTall: 0.28 },
    study: { centre: [0.72, 2.4] as const, halfWide: 0.5, halfTall: 0.22 },
  }[variant];
  canvas(canvasSlot.centre, canvasSlot.halfWide, canvasSlot.halfTall, accent);

  // The sofa and the side table are macro masses in the generated blockout, so a
  // variant that is not a living room has to take them back out of the tree
  // rather than decline to build them. Their own dressing below is skipped with
  // them.
  const sofaPlinth = nodes["sofa-plinth"];
  const tableShell = nodes["table-shell"];
  if (variant !== "living") {
    if (sofaPlinth) root.remove(sofaPlinth);
    if (tableShell) root.remove(tableShell);
  }

  if (variant === "living") {
    // The sofa above the plinth: two arms, two seat cushions, two back cushions.
    // The back cushions lean 0.09 radians, which is the only rotation in the room
    // and the reason the sofa does not read as a stack of blocks.
    for (const [id, x] of [["sofa-arm-left", -0.71], ["sofa-arm-right", 1.61]] as const)
      part(id, id === "sofa-arm-left" ? "Sofa arm, wall side" : "Sofa arm, room side", "sage-green", [x, 0.625, -1.33], {
        points: rect(0.02, 0.255),
        depth: 0.91,
        axis: "z",
        center: true,
        bevel: bevel(0.17),
      });
    for (const [id, x] of [["sofa-seat-cushion-left", -0.035], ["sofa-seat-cushion-right", 0.935]] as const)
      part(id, `Seat cushion, ${id.endsWith("left") ? "left" : "right"}`, "sage-green", [x, 0.76, -1.27], {
        points: rect(0.375, 0.07),
        depth: 0.85,
        axis: "z",
        center: true,
        bevel: bevel(0.1),
      });
    for (const [id, x] of [["sofa-back-cushion-left", -0.035], ["sofa-back-cushion-right", 0.935]] as const)
      part(
        id,
        `Back cushion, ${id.endsWith("left") ? "left" : "right"}`,
        "sage-green",
        [x, 1.035, -1.765],
        { points: rect(0.355, 0.395), depth: 0.1, axis: "z", center: true, bevel: bevel(0.12) },
        -0.09,
      );

    // Backs the side table's cubby so the recess is a shelf and not a hole
    // straight through the case.
    part("table-back-panel", "Side table cubby back", "furniture-cream", [-1.915, 0.525, 0.15], {
      points: rect(0.365, 0.165),
      depth: 0.03,
      axis: "x",
      center: true,
      bevel: bevel(0.03),
    });

    // Four cream pegs under each of the sofa and the table. Cream, never the
    // sofa's own green: that contrast is what lifts the furniture off the floor.
    const peg = (radius: number) => new THREE.CylinderGeometry(radius, radius * 0.88, 0.2, 12);
    if (sofaPlinth)
      cluster("sofa-leg-cluster", "Sofa peg legs", "furniture-cream", sofaPlinth, peg(0.075), [
        [-1.08, -0.31, -0.445],
        [-1.08, -0.31, 0.445],
        [1.08, -0.31, -0.445],
        [1.08, -0.31, 0.445],
      ]);
    if (tableShell)
      cluster("table-leg-cluster", "Side table peg legs", "furniture-cream", tableShell, peg(0.0575), [
        [-0.2, -0.425, -0.375],
        [-0.2, -0.425, 0.375],
        [0.2, -0.425, -0.375],
        [0.2, -0.425, 0.375],
      ]);

    rug("rug", "Rug gold border", "Rug coral field", [0.15, 0.55], 1.328, 0.893, "rug-coral");

    // The side table's top is at 0.85 and was bare. A stack of books lying flat,
    // a mug, and the set's practical.
    clutter("living-book-a", "Table book, lower", "rug-gold", [-1.66, 0.868, 0.02], [0.26, 0.036, 0.19]);
    clutter("living-book-b", "Table book, upper", "glass-blue", [-1.63, 0.904, 0.04], [0.24, 0.034, 0.18]);
    cylinder("living-mug", "Table mug", "rug-coral", [-1.6, 0.895, 0.42], 0.05, 0.09);
    cylinder("living-lamp-stem", "Table lamp stem", "trim-navy", [-1.68, 0.94, -0.2], 0.025, 0.18);
    solid(
      "living-lamp-shade",
      "Table lamp shade",
      "lamp-glow",
      [-1.68, 1.11, -0.2],
      new THREE.CylinderGeometry(0.11, 0.15, 0.18, 12),
    );

    // A throw over the wall-side arm and a cushion in the corner of the seat.
    // The sofa read as three boxes because every edge on it was the same green;
    // these are the only two things that break that silhouette.
    clutter("sofa-throw", "Sofa throw", "rug-gold", [-0.71, 1.07, -1.25], [0.44, 0.04, 0.86]);
    clutter("sofa-throw-fall", "Sofa throw fall", "rug-gold", [-0.53, 0.88, -1.25], [0.05, 0.38, 0.82]);
    clutter("sofa-cushion", "Throw cushion", "rug-coral", [1.24, 0.99, -1.44], [0.3, 0.28, 0.12]);
    pool("living-pool", [-1.68, -0.2], 0.42);
  }

  if (variant === "kitchen") {
    // A base run along wall B with a worktop, a sink cut into it, and wall units
    // above. The worktop is navy because it is the one surface in the set the
    // camera looks straight down onto, and cream on cream from above is nothing.
    part("kitchen-base-run", "Kitchen base run", "furniture-cream", [0.31, 0.43, -1.68], {
      points: rect(1.05, 0.43),
      depth: 0.6,
      axis: "z",
      center: true,
      bevel: softBevel(0.04),
    });
    part("kitchen-worktop", "Kitchen worktop", "trim-navy", [0.31, 0.89, -1.68], {
      points: roundedRectLoop(1.09, 0.32, 0.04),
      depth: 0.06,
      axis: "y",
      center: true,
      bevel: softBevel(0.025),
    });
    // The basin is a recess, not a decal: the rim stands 0.03 proud of the
    // worktop and the pan sits 0.09 into it, so the shadow in the bottom is what
    // reads rather than a painted rectangle.
    part("kitchen-sink-rim", "Sink rim", "furniture-cream", [0.92, 0.93, -1.68], {
      points: roundedRectLoop(0.31, 0.24, 0.05),
      holes: [rect(0.26, 0.19)],
      depth: 0.05,
      axis: "y",
      center: true,
      bevel: softBevel(0.02),
    });
    part("kitchen-sink-pan", "Sink pan", "trim-navy", [0.92, 0.83, -1.68], {
      points: rect(0.26, 0.19),
      depth: 0.04,
      axis: "y",
      center: true,
    });
    part("kitchen-wall-unit", "Kitchen wall units", "furniture-cream", [0.36, 1.94, -1.82], {
      points: rect(0.98, 0.34),
      depth: 0.34,
      axis: "z",
      center: true,
      bevel: softBevel(0.04),
    });
    // Three door lines across the base run and two across the wall units. A flat
    // carcass reads as a block; the gaps are what make it joinery.
    const carcass = nodes["kitchen-base-run"];
    if (carcass)
      cluster(
        "kitchen-door-gap-cluster",
        "Cabinet door gaps",
        "trim-navy",
        carcass,
        new THREE.BoxGeometry(0.02, 0.72, 0.03),
        [
          [-0.52, 0.02, 0.3],
          [0, 0.02, 0.3],
          [0.52, 0.02, 0.3],
        ],
      );
    // A tall unit in the far corner. Every variant puts one mass above 1.8 in a
    // different corner, because the crest of the wall is a dead straight line
    // across four metres and one thing breaking it is what a player registers
    // before they register any of the detail below it.
    //
    // Local +X is the face that matters. The sculpt is open on +X and the
    // corridor is on that side, and a room turned a half circle about Y turns
    // the viewer's side with it, so local +X faces the player in every room on
    // both sides of the course. A tall unit with nothing on that face is a
    // cream slab, which is what the first build of this was.
    part("kitchen-tall-unit", "Tall kitchen unit", "sage-green", [1.7, 0.95, -1.62], {
      points: rect(0.26, 0.28),
      depth: 1.9,
      axis: "y",
      center: true,
      bevel: softBevel(0.05),
    });
    part("kitchen-tall-handle", "Tall unit handle", "trim-navy", [2.03, 1.1, -1.72], {
      points: rect(0.02, 0.02),
      depth: 0.5,
      axis: "y",
      center: true,
      bevel: softBevel(0.014),
    });
    rug("kitchen-mat", "Kitchen mat binding", "Kitchen mat field", [0.31, -0.66], 0.92, 0.35, "rug-coral");

    // The worktop is at 0.92 and is the surface a chase camera looks straight
    // down onto, so it is the one that most needed something on it.
    cylinder("kitchen-pot", "Stock pot", "sage-green", [-0.42, 1.02, -1.68], 0.11, 0.2);
    cylinder("kitchen-kettle", "Kettle", "glass-blue", [-0.08, 1.0, -1.74], 0.08, 0.16);
    clutter("kitchen-board", "Chopping board", "rug-gold", [0.28, 0.94, -1.56], [0.3, 0.025, 0.22]);
    cylinder("kitchen-mug-a", "Worktop mug", "rug-coral", [0.5, 0.965, -1.5], 0.045, 0.085);
    cylinder("kitchen-mug-b", "Worktop mug", "wall-cream", [0.62, 0.965, -1.56], 0.045, 0.085);
    // An under-cabinet strip rather than a shade: it is the light a kitchen
    // actually has, and it washes the run below it in the same warm the other
    // sets get from a lamp.
    clutter("kitchen-under-light", "Under-cabinet light", "lamp-glow", [0.36, 1.58, -1.66], [1.7, 0.04, 0.14]);
    pool("kitchen-pool", [0.36, -1.35], 0.6, 0.42);
  }

  if (variant === "bedroom") {
    // A bed across the corner: base, mattress, a duvet covering two thirds of it,
    // two pillows and a headboard against wall B. The duvet stops short of the
    // pillows on purpose - the step from duvet to sheet is the read that says bed
    // rather than bench, and it costs one extra box.
    part("bed-base", "Bed base", "furniture-cream", [0.5, 0.29, -1.02], {
      points: rect(0.9, 0.24),
      depth: 1.66,
      axis: "z",
      center: true,
      bevel: softBevel(0.05),
    });
    part("bed-mattress", "Bed mattress", "wall-cream", [0.5, 0.63, -1.02], {
      points: rect(0.86, 0.11),
      depth: 1.58,
      axis: "z",
      center: true,
      bevel: softBevel(0.08),
    });
    part("bed-duvet", "Duvet", "rug-coral", [0.5, 0.79, -0.72], {
      points: rect(0.88, 0.07),
      depth: 1.0,
      axis: "z",
      center: true,
      bevel: softBevel(0.09),
    });
    part("bed-headboard", "Headboard", "sage-green", [0.5, 1.06, -1.86], {
      points: rect(0.92, 0.56),
      depth: 0.12,
      axis: "z",
      center: true,
      bevel: softBevel(0.07),
    });
    for (const [id, x] of [["bed-pillow-left", 0.08], ["bed-pillow-right", 0.92]] as const)
      part(id, `Pillow, ${id.endsWith("left") ? "left" : "right"}`, "wall-cream", [x, 0.83, -1.5], {
        points: rect(0.34, 0.08),
        depth: 0.42,
        axis: "z",
        center: true,
        bevel: softBevel(0.1),
      });
    part("bedside-table", "Bedside table", "furniture-cream", [-0.72, 0.3, -1.66], {
      points: rect(0.26, 0.26),
      depth: 0.5,
      axis: "z",
      center: true,
      bevel: softBevel(0.04),
    });
    // A shade rather than a lamp: the bulb would be an emissive, and an emissive
    // needs a ninth material, which is a ninth merged batch on every room in the
    // corridor for one highlight nobody can resolve.
    const shade = new THREE.CylinderGeometry(0.15, 0.19, 0.24, 12);
    solid("bedside-lamp-shade", "Bedside lamp shade", "lamp-glow", [-0.72, 0.79, -1.66], shade);
    const stem = new THREE.CylinderGeometry(0.03, 0.03, 0.16, 8);
    solid("bedside-lamp-stem", "Bedside lamp stem", "trim-navy", [-0.72, 0.63, -1.66], stem);
    part("bedroom-wardrobe", "Wardrobe", "furniture-cream", [1.7, 1.06, -1.62], {
      points: rect(0.26, 0.28),
      depth: 2.12,
      axis: "y",
      center: true,
      bevel: softBevel(0.05),
    });
    // Sage doors on a cream carcass. A split line alone left the wardrobe a
    // cream slab against a cream wall; two panels in the sofa's own green make
    // the same silhouette read as furniture at the distance the corridor gives.
    for (const [id, z] of [["wardrobe-door-left", -1.79], ["wardrobe-door-right", -1.45]] as const)
      part(id, `Wardrobe door, ${id.endsWith("left") ? "left" : "right"}`, "sage-green", [2.03, 1.12, z], {
        points: rect(0.14, 0.94),
        depth: 0.03,
        axis: "x",
        center: true,
        bevel: softBevel(0.02),
      });
    const wardrobe = nodes["bedroom-wardrobe"];
    if (wardrobe)
      cluster(
        "wardrobe-handle-cluster",
        "Wardrobe handles",
        "trim-navy",
        wardrobe,
        new THREE.BoxGeometry(0.05, 0.26, 0.03),
        [
          [0.36, 0.06, -0.05],
          [0.36, 0.06, 0.05],
        ],
      );
    rug("bedroom-rug", "Bedside rug binding", "Bedside rug field", [-0.6, 0.45], 0.72, 0.5, "rug-gold");

    clutter("bedroom-book", "Bedside book", "glass-blue", [-0.72, 0.618, -1.5], [0.19, 0.036, 0.14]);
    clutter("bedroom-throw", "Bed throw", "rug-gold", [0.5, 0.855, -0.28], [1.78, 0.04, 0.34]);
    pool("bedroom-pool", [-0.72, -1.66], 0.45);
  }

  if (variant === "study") {
    // A desk under the window, a chair pushed under it, and a bookcase on wall B.
    // The desk goes on wall A because that is where the light is, which is where
    // a desk goes, and because it is the only variant that puts a mass in front
    // of the window and changes that wall's read entirely.
    part("desk-top", "Desk top", "furniture-cream", [-1.62, 0.76, 0.3], {
      points: rect(0.31, 0.04),
      depth: 1.3,
      axis: "z",
      center: true,
      bevel: softBevel(0.03),
    });
    const deskTop = nodes["desk-top"];
    if (deskTop)
      cluster(
        "desk-leg-cluster",
        "Desk legs",
        "trim-navy",
        deskTop,
        new THREE.CylinderGeometry(0.035, 0.035, 0.72, 8),
        [
          [-0.2, -0.4, -0.52],
          [-0.2, -0.4, 0.52],
          [0.2, -0.4, -0.52],
          [0.2, -0.4, 0.52],
        ],
      );
    part("desk-chair-seat", "Chair seat", "sage-green", [-1.06, 0.46, 0.3], {
      points: rect(0.22, 0.05),
      depth: 0.44,
      axis: "z",
      center: true,
      bevel: softBevel(0.04),
    });
    part("desk-chair-back", "Chair back", "sage-green", [-0.88, 0.78, 0.3], {
      points: rect(0.04, 0.26),
      depth: 0.4,
      axis: "z",
      center: true,
      bevel: softBevel(0.04),
    });
    const seat = nodes["desk-chair-seat"];
    if (seat)
      cluster(
        "chair-leg-cluster",
        "Chair legs",
        "trim-navy",
        seat,
        new THREE.CylinderGeometry(0.028, 0.028, 0.42, 8),
        [
          [-0.15, -0.26, -0.16],
          [-0.15, -0.26, 0.16],
          [0.15, -0.26, -0.16],
          [0.15, -0.26, 0.16],
        ],
      );
    // A ring, not a box. The first build stood the books inside a solid carcass,
    // where a solid carcass puts them: invisible, except for the few millimetres
    // of spine poking through its front face. The opening is a real recess with
    // an occluded interior, the same construction the spec uses for the side
    // table's cubby, and it is the shadow inside it that makes a bookcase read
    // as deeper than the wall it stands against.
    part("bookcase-carcass", "Bookcase carcass", "furniture-cream", [0.55, 0.94, -1.78], {
      points: roundedRectLoop(0.7, 0.92, 0.05),
      holes: [rect(0.62, 0.84)],
      depth: 0.38,
      axis: "z",
      center: true,
      bevel: softBevel(0.04),
    });
    part("bookcase-back", "Bookcase back panel", "furniture-cream", [0.55, 0.94, -1.95], {
      points: rect(0.62, 0.84),
      depth: 0.03,
      axis: "z",
      center: true,
    });
    const bookcase = nodes["bookcase-carcass"];
    if (bookcase)
      cluster(
        "bookcase-shelf-cluster",
        "Bookcase shelves",
        "furniture-cream",
        bookcase,
        new THREE.BoxGeometry(1.24, 0.03, 0.34),
        [
          [0, -0.46, 0.0],
          [0, 0.0, 0.0],
          [0, 0.46, 0.0],
        ],
      );
    // Books as individual spines rather than a painted band. A 0.09 spine at
    // corridor distance subtends about twelve pixels, which is over the width a
    // vertical still resolves at, so the shelf reads as a row of books and not as
    // a striped block. They cost twelve triangles each and merge into the three
    // batches their colours already use, so the count is free.
    const spines: { id: string; x: number; y: number; height: number; material: string }[] = [];
    const shelfHeights = [-0.46, 0.0, 0.46];
    const palette = ["rug-coral", "rug-gold", "sage-green", "glass-blue"];
    shelfHeights.forEach((shelfY, shelf) => {
      for (let index = 0; index < 7; index += 1) {
        spines.push({
          id: `book-${shelf}-${index}`,
          x: -0.57 + index * 0.19,
          y: shelfY + 0.155,
          height: index % 3 === 0 ? 0.26 : index % 3 === 1 ? 0.23 : 0.29,
          material: palette[(shelf * 3 + index) % palette.length]!,
        });
      }
    });
    for (const spine of spines)
      solid(
        spine.id,
        `Book spine ${spine.id.slice(5)}`,
        spine.material,
        [0.55 + spine.x, 0.94 + spine.y, -1.78 + 0.06],
        new THREE.BoxGeometry(0.085, spine.height, 0.19),
      );
    rug("study-rug", "Study rug binding", "Study rug field", [-0.45, 0.85], 0.86, 0.62, "rug-coral");

    // The desk top is at 0.80. A laptop open at the window, a stack of paper and
    // a mug: the study is the set whose whole point is a surface someone uses.
    clutter("study-laptop-base", "Laptop base", "trim-navy", [-1.6, 0.812, 0.34], [0.26, 0.018, 0.2]);
    clutter("study-laptop-lid", "Laptop lid", "trim-navy", [-1.72, 0.9, 0.34], [0.03, 0.18, 0.2]);
    clutter("study-paper", "Paper stack", "wall-cream", [-1.58, 0.818, -0.05], [0.19, 0.03, 0.24]);
    cylinder("study-mug", "Desk mug", "rug-coral", [-1.5, 0.848, 0.72], 0.05, 0.09);
    cylinder("study-lamp-stem", "Desk lamp stem", "trim-navy", [-1.78, 0.9, 0.78], 0.022, 0.2);
    solid(
      "study-lamp-shade",
      "Desk lamp shade",
      "lamp-glow",
      [-1.78, 1.04, 0.78],
      new THREE.CylinderGeometry(0.07, 0.12, 0.14, 12),
    );
    pool("study-pool", [-1.78, 0.78], 0.35);
  }
}
