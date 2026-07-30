// @vitest-environment jsdom
//
// THESE TESTS EXERCISE THE OPPOSITE MATERIAL PATH FROM THE BROWSER, so their authority is
// GEOMETRY and no assertion about shipped appearance belongs in this file.
//
// generate_threejs_factory emits `color: textures ? 0xffffff : new THREE.Color(spec.baseColor)`
// and `roughness: textures ? 1 : spec.roughness.base`, where `textures` comes from
// makeProceduralTextureSet. That returns null when no 2D canvas context is available - and
// under jsdom without the `canvas` package, which is NOT a dependency here, vitest prints
// "Not implemented: HTMLCanvasElement's getContext() method" and the context IS null.
//
// So a sculpted prop gets baseColor and roughness.base HERE, and white-plus-procedural-maps
// in Chromium. Those are different materials. A colour assertion that passes in this file
// says nothing about what a player sees, and one that fails here might be describing a prop
// that renders correctly. Verify appearance through the preview harness in a real browser
// instead (assets/reference/props/preview).
//
// A sculpt is authored to look right on its own. Nothing in the img2threejs
// pipeline knows how big the prop it replaces was, so a factory can pass every
// fidelity gate it has and still arrive at twice the size of the thing it
// stands in for. That is what happened to the claw hammer: 4.04u against the
// 1.80u head it replaced, hung sideways off a pendulum arm so the excess became
// horizontal reach past the collider that actually hits the player.
//
// These are call-site contracts, not art direction. Each bound below is what
// the code that mounts the prop already assumes, so breaking one means the
// visual and the collider have parted company.
import { describe, expect, it } from "vitest";
import { Box3, Color, Vector3, type Object3D } from "three";
import { PALETTE } from "@/lib/game/constants";
import {
  APARTMENT_VARIANTS,
  type ApartmentVariant,
} from "@/components/game/environment/apartmentFurnishing";
import {
  SOFT_TINTS,
  apartmentRoomPlacements,
} from "@/components/game/environment/ApartmentRooms";
import { createApartmentBeachBallModel } from "@/components/game/models/createBeachBallModel";
import { createApartmentSoapDishModel } from "@/components/game/models/createSoapDishModel";
import { createApartmentToasterModel } from "@/components/game/models/createToasterModel";
import { createMAKEITWORSEApartmentRoomModel } from "@/components/game/models/createApartmentModel";
import { createRobotMopModel } from "@/components/game/models/createMopModel";
import { createApartmentRefrigeratorModel } from "@/components/game/models/createRefrigeratorModel";
import { createApartmentClawHammerOnWallBracketModel } from "@/components/game/models/createHammerModel";
import { createApartmentSpringJumpPadModel } from "@/components/game/models/createSpringModel";
import { createApartmentToiletModel } from "@/components/game/models/createToiletModel";
import { createApartmentFloorFanModel } from "@/components/game/models/createFloorFanModel";
import { createApartmentCanisterVacuumModel } from "@/components/game/models/createVacuumModel";

/** Small enough to keep the suite quick; geometry does not depend on it. */
const TEXTURE_SIZE = 64;

const measure = (group: ReturnType<typeof createApartmentBeachBallModel>) => {
  const box = new Box3().setFromObject(group);
  return { size: box.getSize(new Vector3()), min: box.min };
};

/** The named mesh, in world space, or undefined. */
const findMesh = (root: Object3D, name: string) => {
  let found: (Object3D & { geometry?: { getAttribute(n: string): { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } | undefined } }) | undefined;
  root.updateMatrixWorld(true);
  root.traverse((node) => {
    if ((node as { isMesh?: boolean }).isMesh && node.name === name) found = node as typeof found;
  });
  return found;
};

/**
 * The largest distance from any vertex to the chord joining the mesh's two most distant
 * vertices. For a straight tube every vertex lies within its own radius of that chord; for a
 * swept arc the mid-span stands far off it. This separates an authored curve from the
 * generator's cylinder substitution when the bounding box cannot.
 */
const maximumBow = (mesh: NonNullable<ReturnType<typeof findMesh>>) => {
  const position = mesh.geometry!.getAttribute("position")!;
  const world: Vector3[] = [];
  for (let i = 0; i < position.count; i += 1)
    world.push(new Vector3(position.getX(i), position.getY(i), position.getZ(i))
      .applyMatrix4((mesh as unknown as { matrixWorld: Parameters<Vector3["applyMatrix4"]>[0] }).matrixWorld));
  // The chord: the pair of vertices furthest apart, found against the centroid rather than
  // by an O(n^2) sweep.
  const centre = world.reduce((a, v) => a.add(v), new Vector3()).multiplyScalar(1 / world.length);
  const a = world.reduce((best, v) => (v.distanceTo(centre) > best.distanceTo(centre) ? v : best), world[0]!);
  const b = world.reduce((best, v) => (v.distanceTo(a) > best.distanceTo(a) ? v : best), world[0]!);
  const axis = b.clone().sub(a);
  const length = axis.length();
  if (length < 1e-6) return 0;
  axis.multiplyScalar(1 / length);
  let bow = 0;
  for (const v of world) {
    const along = v.clone().sub(a).dot(axis);
    const perpendicular = v.clone().sub(a).sub(axis.clone().multiplyScalar(along)).length();
    if (perpendicular > bow) bow = perpendicular;
  }
  return bow;
};

describe("sculpted props fit the call sites that mount them", () => {
  it("keeps the beach ball centred on its origin at the radius TrapRenderer assumes", () => {
    // TrapRenderer mounts it at position={[0, -0.75, 0]}, which only seats the
    // ball on the deck if the sculpt is 1.5u across and centred on its origin.
    const { size, min } = measure(createApartmentBeachBallModel({ textureSize: TEXTURE_SIZE }));
    expect(size.x).toBeCloseTo(1.5, 1);
    expect(size.y).toBeCloseTo(1.5, 1);
    expect(min.y).toBeCloseTo(-0.75, 1);
  });

  it("keeps the soap dish within the footprint the hand-authored dish had", () => {
    // DISH_WIDTH 0.7 and DISH_DEPTH 0.44 in SmallProps.tsx, and the trap set
    // scales it down as far as 0.5, so an oversized dish overhangs its slick.
    const { size } = measure(createApartmentSoapDishModel({ textureSize: TEXTURE_SIZE }));
    expect(size.x).toBeLessThanOrEqual(0.8);
    expect(size.y).toBeLessThanOrEqual(0.4);
    expect(size.z).toBeLessThanOrEqual(0.6);
  });

  it("hangs the sculpted hammer on the pendulum frame TrapRenderer mounts it in", () => {
    // HAMMER_ARM_LENGTH 2.25 in TrapRenderer.tsx, and the AssetModel mount is
    // position={[0, -HAMMER_ARM_LENGTH, 0]}. That only seats the prop on the arm if
    // the sculpt runs its full length along its own +Y with the butt on the origin,
    // which is the frame the hand-authored ProceduralHammer used and the frame the
    // spec's coordinateFrame declares. 2.20 against an arm of 2.25 leaves the head at
    // the tip rather than past it.
    const hammer = createApartmentClawHammerOnWallBracketModel({ textureSize: TEXTURE_SIZE });
    const { size, min } = measure(hammer);
    expect(size.y).toBeCloseTo(2.2, 1);
    expect(min.y).toBeCloseTo(0, 2);
    expect(size.y).toBeLessThanOrEqual(2.25);

    // Poll face to claw tip, measured over what AssetModel actually shows. The wall
    // plate reaches x -0.83 and would dominate this bound. Box3 ignores `visible`, and
    // the bracket hangs off the handle shaft rather than off the root, so the subtree
    // is skipped by walking up each mesh's parents.
    const bracket = new Set(
      (
        hammer.userData.sculptRuntime as { destructionGroups: Record<string, Object3D[]> }
      ).destructionGroups.bracket ?? [],
    );
    const onBracket = (node: Object3D | null): boolean =>
      node !== null && (bracket.has(node) || onBracket(node.parent));
    const visible = new Box3();
    hammer.traverse((node) => {
      if ((node as { isMesh?: boolean }).isMesh && !onBracket(node)) {
        visible.union(new Box3().setFromObject(node));
      }
    });
    // The head collider is CuboidCollider args={[0.68, 0.42, 0.42]}, so 1.36 is the
    // length that fits it exactly. The reference's own head measures 1.380 poll tip to
    // claw tip, so a faithful hammer overhangs its collider by about 0.02 a side and
    // there is no shape that satisfies both. The bound is the measured 1.407 plus a
    // float margin, and the 0.047 overhang is recorded rather than fitted away.
    expect(visible.max.x - visible.min.x).toBeLessThanOrEqual(1.41);
  });

  it("assembles the sculpted hammer instead of stacking its parts on the origin", () => {
    // Every transform in the spec is measured in the prop's world frame, but the
    // generator applies transform.position as an offset from the parent node. Left
    // uncorrected the poll drum landed at y 3.63, the claw at 4.04 and the prop stood
    // 4.04u tall. transform.scale defaulting to (1,1,1) also suppressed the fallback
    // to dimensions, which shipped the head as a 1u cube. Both are frame errors that
    // look fine in a part list and only show up as a measurement.
    const hammer = createApartmentClawHammerOnWallBracketModel({ textureSize: TEXTURE_SIZE });
    // Box3.setFromObject only walks down from the node it is given, so a per-mesh box
    // is measured against whatever the ancestors' matrices last held. Update the tree
    // first or every part reads as though its parents were at the origin.
    hammer.updateMatrixWorld(true);
    const parts = new Map<string, Box3>();
    hammer.traverse((node) => {
      if ((node as { isMesh?: boolean }).isMesh) {
        parts.set(node.name, new Box3().setFromObject(node));
      }
    });
    for (const part of [
      "Handle shaft",
      "Head body block",
      "Poll drum and striking face",
      "Claw root sweep",
      "Claw tine, near side",
      "Claw tine, far side",
      "Eye collar",
      "Wall plate",
      "Bracket arm",
      "Pivot boss",
      "Clamp collar",
      "Collar clamp lug",
      "Clamp bolt head",
    ])
      expect(parts.has(part), `hammer is missing ${part}`).toBe(true);

    // The head rides the top of the shaft, at the coral run the reference measures
    // across rows 200-490.
    const head = parts.get("Head body block")!;
    expect(head.min.y).toBeCloseTo(1.54, 1);
    expect(head.max.y).toBeCloseTo(2.09, 1);
    // The poll's striking face points along -X and the claw's tip along +X, so the two
    // straddle the shaft rather than sharing its axis.
    expect(parts.get("Poll drum and striking face")!.min.x).toBeLessThan(-0.6);
    expect(parts.get("Claw root sweep")!.max.x).toBeGreaterThan(0.6);
    // The wall bracket is built because the reference has one, and AssetModel hides it
    // because the trap draws its own pendulum rig. Hiding it needs the group.
    const runtime = hammer.userData.sculptRuntime as {
      destructionGroups: Record<string, unknown[]>;
    };
    expect(runtime.destructionGroups.bracket?.length).toBe(7);
  });

  it("closes the soap dish so it is not see-through from above", () => {
    // The factory shipped as a blockout: dish-wall and soap-bar only, with dish-floor
    // gated out because it is meso. That left a hole through the middle of the dish, and
    // the chase camera looks DOWN at the deck, so the one angle a player always has was
    // the one that showed it. Five call sites across TrapsWaveA and TrapRenderer mount
    // this prop at scales from 0.5 to 1.0. The spec's own risks predicted it: "no floor,
    // so the dish reads through".
    const dish = createApartmentSoapDishModel({ textureSize: TEXTURE_SIZE });
    const named = new Set<string>();
    dish.traverse((node) => {
      if ((node as { isMesh?: boolean }).isMesh) named.add(node.name);
    });
    for (const part of ["Dish rim wall", "Dish floor", "Soap bar"])
      expect(named, `soap dish is missing ${part}`).toContain(part);
  });

  it("keeps the toaster small enough to sit on a deck the player shares", () => {
    // The runner is 1.86u tall. A launcher taller than the thing it launches
    // reads as scenery rather than as a trap.
    const { size, min } = measure(createApartmentToasterModel({ textureSize: TEXTURE_SIZE }));
    expect(size.y).toBeLessThan(1.86);
    expect(min.y).toBeCloseTo(0, 1);
  });

  it("keeps the apartment room the size ApartmentRooms stands it at", () => {
    // ROOM_HALF_WIDTH in components/game/environment/ApartmentRooms.tsx is
    // 2.155 and every room is placed at corridorHalfWidth + that, so a wider
    // sculpt walks its floor into the corridor the course runs down and a
    // narrower one opens a gap between the rooms and the wall behind them.
    const { size, min } = measure(
      createMAKEITWORSEApartmentRoomModel({ textureSize: TEXTURE_SIZE }),
    );
    expect(size.x / 2).toBeCloseTo(2.155, 2);
    expect(size.z / 2).toBeCloseTo(2.155, 2);
    // The rooms are placed at y = 0 with no vertical offset, so the floor's
    // walking surface has to be the deck datum for them to sit level with the
    // course. The tray below it is the plinth and is allowed to hang.
    expect(min.y).toBeCloseTo(-0.33, 2);
    // CameraRig floors the chase camera at y = 4.3 and the doorway frames top
    // out at 4.29. A taller room would stand in front of the camera.
    expect(size.y).toBeLessThan(4.29);
  });

  it("keeps the apartment room furnished rather than blocked out", () => {
    // The factory shipped as a blockout: two blank wall planes, a floor, a rim
    // and one box each for the sofa and the table. Wired as it stood it would
    // have been plainer than the hand-authored dressing it replaced. These are
    // the parts that make it read as a room, and the count is the guard against
    // a regenerated factory silently dropping back to the blockout pass.
    const room = createMAKEITWORSEApartmentRoomModel({ textureSize: TEXTURE_SIZE });
    const named = new Set<string>();
    let meshes = 0;
    room.traverse((node) => {
      if (!(node as { isMesh?: boolean }).isMesh) return;
      meshes += 1;
      named.add(node.name);
    });
    for (const part of [
      "Glazing plate",
      "Window frame ring",
      "Vertical muntin",
      "Horizontal muntin",
      "Rug coral field",
      "Rug gold border",
      "Sofa arm, wall side",
      "Seat cushion, left",
      "Back cushion, left",
      "Skirting rail, wall A",
      "Sofa peg legs",
      "Board run seams",
    ])
      expect(named, `apartment room is missing ${part}`).toContain(part);
    expect(meshes).toBeGreaterThanOrEqual(20);
  });

  it("gives every furniture set its own room rather than one room four times", () => {
    // A room stands every 4.7 units of course and a runner covers 7.2 units a
    // second, so one furniture set repeated is a new identical room every 0.65
    // seconds. These are the parts that tell the four sets apart at that rate.
    const setParts: Record<ApartmentVariant, string[]> = {
      living: ["Sofa arm, wall side", "Seat cushion, left", "Rug coral field"],
      kitchen: ["Kitchen base run", "Kitchen worktop", "Sink pan", "Tall kitchen unit"],
      bedroom: ["Bed base", "Duvet", "Headboard", "Wardrobe", "Wardrobe door, left"],
      study: ["Desk top", "Chair seat", "Bookcase carcass", "Bookcase back panel"],
    };
    const built = new Map<ApartmentVariant, Set<string>>();
    for (const variant of APARTMENT_VARIANTS) {
      const named = new Set<string>();
      createMAKEITWORSEApartmentRoomModel({ textureSize: TEXTURE_SIZE, variant }).traverse((node) => {
        if ((node as { isMesh?: boolean }).isMesh) named.add(node.name);
      });
      built.set(variant, named);
    }
    for (const variant of APARTMENT_VARIANTS) {
      const named = built.get(variant)!;
      for (const part of setParts[variant])
        expect(named, `${variant} is missing ${part}`).toContain(part);
      // A set's own furniture belongs to it alone. The sofa and the side table
      // are macro masses in the generated blockout, so a set that is not the
      // living room has to take them back out of the tree rather than decline
      // to build them, and a missed removal leaves a sofa in the kitchen.
      for (const other of APARTMENT_VARIANTS) {
        if (other === variant) continue;
        for (const part of setParts[other])
          expect(named, `${variant} should not carry ${other}'s ${part}`).not.toContain(part);
      }
    }
    expect(built.get("kitchen")).not.toContain("Sofa base block");
    expect(built.get("living")).toContain("Sofa base block");
  });

  it("keeps every furniture set inside the shell ApartmentRooms stands it in", () => {
    // The bound is the same one the living room is pinned to above, applied to
    // the three sets that did not come from the reference: a set that reaches
    // past the floor tray walks a room's furniture into the corridor the course
    // runs down, and a taller one stands in front of the chase camera at 4.29.
    for (const variant of APARTMENT_VARIANTS) {
      const { size, min } = measure(
        createMAKEITWORSEApartmentRoomModel({ textureSize: TEXTURE_SIZE, variant }),
      );
      expect(size.x / 2, `${variant} is the wrong width`).toBeCloseTo(2.155, 2);
      expect(size.z / 2, `${variant} is the wrong depth`).toBeCloseTo(2.155, 2);
      expect(min.y, `${variant} does not sit on the deck datum`).toBeCloseTo(-0.33, 2);
      expect(size.y, `${variant} stands in front of the camera`).toBeLessThan(4.29);
    }
  });

  it("dresses every room with the architecture the reference does not show", () => {
    // The reference is one living room lit for a product shot: bare plaster from
    // the skirting to the crest. A corridor of sixty copies of that reads as
    // sixty copies. These go into every set, so what changes room to room is the
    // furniture and what stays constant is the building.
    for (const variant of APARTMENT_VARIANTS) {
      const named = new Set<string>();
      createMAKEITWORSEApartmentRoomModel({ textureSize: TEXTURE_SIZE, variant }).traverse((node) => {
        if ((node as { isMesh?: boolean }).isMesh) named.add(node.name);
      });
      for (const part of [
        "Picture rail, wall A",
        "Picture rail, wall B",
        "Doorway reveal",
        "Doorway frame",
        "Curtain, left",
        "Curtain, right",
        "Curtain pole",
        "Radiator body",
        "Radiator fins",
        "Wall canvas frame",
        "Wall canvas field",
        // A surface to put things on is half of what these two are for. Every
        // horizontal surface in the room was bare, which reads as a model rather
        // than as somewhere someone lives.
        "Windowsill",
        "Wall shelf",
        "Windowsill pot",
        "Windowsill plant",
        "Shelf mug",
      ])
        expect(named, `${variant} is missing ${part}`).toContain(part);
    }
  });

  it("keeps the doorway reveal in front of the wall instead of coplanar with it", () => {
    const room = createMAKEITWORSEApartmentRoomModel({
      textureSize: TEXTURE_SIZE,
      variant: "living",
    });
    let reveal: Object3D | null = null;
    room.traverse((node) => {
      if (node.name === "Doorway reveal") reveal = node;
    });

    expect(reveal).not.toBeNull();
    const bounds = new Box3().setFromObject(reveal!);
    // Wall B's room-facing plane is z=-2.00. A max of exactly -2.00 flickers.
    expect(bounds.max.z).toBeGreaterThan(-2);
  });

  it("leaves the corridor the course runs down completely clear", () => {
    // The room-local envelope test above is the input to this one, but it is not
    // the claim that matters for gameplay. This measures where the rooms
    // actually stand: every set, boxed, pushed through the same placement
    // matrices ApartmentRooms builds, and checked against the corridor half
    // width and the widest deck a course can put underfoot.
    //
    // A prettier room that closes a line is a regression, so this is the guard
    // that no piece of furniture, clutter or wall dressing ever reaches into the
    // space a runner moves through.
    const placements = apartmentRoomPlacements(41.1, 4.25);
    expect(placements.length).toBeGreaterThan(0);

    // Which bake a room uses is determined by its rotation, not free choice.
    // Only one of the two leaves a room's interior open to a camera approaching
    // from -Z once the half turn is applied, and shipping the wrong one turned
    // half the course into blank cream slabs without failing anything.
    for (const placement of placements)
      expect(
        placement.mirrored,
        `a ${placement.turned ? "turned" : "unturned"} room has the bake that hides its interior`,
      ).toBe(!placement.turned);

    // The widest deck authored on the classic course is `start` at 8u across on
    // the centre line, so its edges sit at |x| = 4.0. DECK_EDGE keeps a 0.13u ink
    // band around that, and the brief holds a 0.15u keepout beyond it.
    const widestDeckEdge = 4.0;
    const keepout = 0.15;

    let nearestFace = Infinity;
    let tallest = -Infinity;
    for (const variant of APARTMENT_VARIANTS) {
      const room = createMAKEITWORSEApartmentRoomModel({ textureSize: TEXTURE_SIZE, variant });
      room.updateMatrixWorld(true);
      const local = new Box3().setFromObject(room);
      for (const placement of placements.filter((entry) => entry.variant === variant)) {
        // ApartmentRooms composes translation plus an optional half turn about Y.
        // A half turn maps x to -x, so the box's near face is the smaller of the
        // two |x| the corners land on either way round.
        const corners = [local.min.x, local.max.x].flatMap((x) => [
          placement.x + x,
          placement.x - x,
        ]);
        nearestFace = Math.min(nearestFace, ...corners.map(Math.abs));
        tallest = Math.max(tallest, local.max.y);
      }
    }
    expect(nearestFace).toBeGreaterThanOrEqual(widestDeckEdge + keepout);
    // CameraRig floors the chase camera at y = 4.3. Anything taller stands in
    // front of it.
    expect(tallest).toBeLessThan(4.29);
  });

  it("circulates the furniture sets across courses without adding a batch", () => {
    // Rooms alternate sides and the variant stride is odd, so untransformed
    // rooms take even indices and turned rooms odd ones. (even x odd) mod 4 is
    // always {0,2} and (odd x odd) mod 4 always {1,3}: each side of a given
    // course shows two of the four sets, and no stride escapes that. What the
    // course seed changes is WHICH two, which costs nothing because the number
    // of (set, handedness) pairs a course uses is four either way - and four
    // pairs is what the batch count is made of.
    const sidesFor = (seed: number) => {
      const left = new Set<ApartmentVariant>();
      const right = new Set<ApartmentVariant>();
      for (const room of apartmentRoomPlacements(120, 4.25, seed))
        (room.x < 0 ? left : right).add(room.variant);
      return { left, right };
    };

    const everLeft = new Set<ApartmentVariant>();
    const everRight = new Set<ApartmentVariant>();
    for (const seed of [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233]) {
      const { left, right } = sidesFor(seed);
      // Two a side, and a set never appears on both sides of one course.
      expect(left.size, `seed ${seed} left`).toBe(2);
      expect(right.size, `seed ${seed} right`).toBe(2);
      for (const variant of left)
        expect(right.has(variant), `seed ${seed}: ${variant} on both sides`).toBe(false);
      // Four pairs is what the batch count is made of, whatever the seed.
      const pairs = new Set(
        apartmentRoomPlacements(120, 4.25, seed).map((room) => `${room.variant}:${room.mirrored}`),
      );
      expect(pairs.size, `seed ${seed} changed the batch count`).toBe(4);
      for (const variant of left) everLeft.add(variant);
      for (const variant of right) everRight.add(variant);
    }
    // The point of the whole exercise: over a handful of courses every set has
    // stood on both sides, so the catalogue circulates even though any one
    // course splits it.
    for (const variant of APARTMENT_VARIANTS) {
      expect(everLeft, `${variant} never appears on the left`).toContain(variant);
      expect(everRight, `${variant} never appears on the right`).toContain(variant);
    }
    // And it is deterministic: the same course always looks the same.
    expect([...sidesFor(42).left]).toEqual([...sidesFor(42).left]);
  });

  it("gives every set a practical and something on its own surfaces", () => {
    // A warm shade is worth more than polygons in this art style, and clutter is
    // the cheapest density there is. The practical is an EMISSIVE, not a light:
    // a room stands every 4.7u of course, so sixty point lights is not a budget
    // that exists. This asserts the emissive is bound rather than the shade
    // quietly rendering in a flat cream.
    const surfaceProps: Record<ApartmentVariant, string[]> = {
      living: ["Table book, lower", "Table mug", "Table lamp shade", "Sofa throw", "Throw cushion"],
      kitchen: ["Stock pot", "Kettle", "Chopping board", "Under-cabinet light"],
      bedroom: ["Bedside book", "Bed throw", "Bedside lamp shade"],
      study: ["Laptop base", "Laptop lid", "Paper stack", "Desk mug", "Desk lamp shade"],
    };
    for (const variant of APARTMENT_VARIANTS) {
      const named = new Set<string>();
      let emissive = 0;
      createMAKEITWORSEApartmentRoomModel({ textureSize: TEXTURE_SIZE, variant }).traverse((node) => {
        const mesh = node as { isMesh?: boolean; material?: unknown };
        if (!mesh.isMesh) return;
        named.add((node as { name: string }).name);
        const material = mesh.material as { emissiveIntensity?: number; emissive?: Color } | undefined;
        if (material?.emissive && (material.emissiveIntensity ?? 0) > 0) emissive += 1;
      });
      for (const part of surfaceProps[variant])
        expect(named, `${variant} is missing ${part}`).toContain(part);
      expect(emissive, `${variant} has no practical`).toBeGreaterThan(0);
    }
  });

  it("keeps the room off the colour that means a hazard can reach the ground", () => {
    // PALETTE.danger marks ground a hazard covers. A player who learns that red
    // is furniture has been taught the wrong thing about the one colour in the
    // game that means this hurts, so no room surface may sit near it. The eight
    // sculpt materials are measured off the reference and none of them is close,
    // and this is the guard against a later set reaching for a red it likes.
    const danger = new Color(PALETTE.danger);
    for (const variant of APARTMENT_VARIANTS) {
      const seen = new Set<string>();
      createMAKEITWORSEApartmentRoomModel({ textureSize: TEXTURE_SIZE, variant }).traverse((node) => {
        const mesh = node as { isMesh?: boolean; material?: unknown };
        if (!mesh.isMesh) return;
        const material = mesh.material as { color?: Color; name?: string } | undefined;
        if (!material?.color) return;
        const distance = Math.hypot(
          material.color.r - danger.r,
          material.color.g - danger.g,
          material.color.b - danger.b,
        );
        if (distance < 0.25) seen.add(material.name ?? "unnamed");
        // The per-room tint in ApartmentRooms multiplies a soft good's albedo,
        // so a colour that is safe as authored can still be pushed toward the
        // hazard red by a tint. Every tint is checked against every material it
        // can reach, not just the base.
        for (const tint of SOFT_TINTS) {
          const tinted = [
            material.color.r * tint[0],
            material.color.g * tint[1],
            material.color.b * tint[2],
          ] as const;
          const tintedDistance = Math.hypot(
            tinted[0] - danger.r,
            tinted[1] - danger.g,
            tinted[2] - danger.b,
          );
          if (tintedDistance < 0.25) seen.add(`${material.name ?? "unnamed"} @ ${tint.join()}`);
        }
      });
      expect(Array.from(seen), `${variant} decorates with the hazard colour`).toEqual([]);
    }
  });

  it("keeps the refrigerator inside the collider the charging fridge trap drives", () => {
    // TrapRenderer mounts it at position={[0, -0.92, 0]} inside a CuboidCollider of
    // args={[FRIDGE_HALF_WIDTH, 0.92, 0.48]} with FRIDGE_HALF_WIDTH 0.68. Those half
    // extents are the budget for EVERYTHING, the door pulls included: the first build
    // measured 1.0322 deep because the pulls stood 0.082 past the collider, which is the
    // swinging hammer's failure in miniature - a visible part reaching past the shape
    // that actually touches the player.
    const { size, min } = measure(
      createApartmentRefrigeratorModel({ textureSize: TEXTURE_SIZE }),
    );
    const box = new Box3().setFromObject(
      createApartmentRefrigeratorModel({ textureSize: TEXTURE_SIZE }),
    );
    expect(size.x / 2).toBeLessThanOrEqual(0.68);
    expect(box.max.z).toBeLessThanOrEqual(0.48);
    expect(box.min.z).toBeGreaterThanOrEqual(-0.48);
    // Floor-centred, because the -0.92 mount only stands it on the deck if it is.
    expect(min.y).toBeCloseTo(0, 2);
    // Exactly the collider's 2 * 0.92, and comfortably under the 2.17u a standing jump
    // clears: a fridge authored at the reference's own 1.79 front-face aspect would stand
    // 2.97u, which both overflows the collider and stops being jumpable.
    expect(size.y).toBeCloseTo(1.84, 2);
    expect(size.y).toBeLessThan(2.17);
  });

  it("keeps the refrigerator's reference parts rather than a blockout slab", () => {
    // Generated at blockout the factory is the cabinet and the plinth only: a plain
    // rounded box, which is plainer than the hand-authored fridge it replaces and the
    // opposite of the point. These are the parts that make it read as the reference,
    // and the count is the guard against a regenerated factory dropping back to two.
    const fridge = createApartmentRefrigeratorModel({ textureSize: TEXTURE_SIZE });
    const named = new Set<string>();
    let meshes = 0;
    fridge.traverse((node) => {
      if (!(node as { isMesh?: boolean }).isMesh) return;
      meshes += 1;
      named.add(node.name);
    });
    for (const part of [
      "Cabinet shell",
      "Base plinth",
      "Freezer door",
      "Fridge door",
      "Freezer door pull",
      "Fridge door pull",
      "Coral badge",
    ])
      expect(named, `refrigerator is missing ${part}`).toContain(part);
    expect(meshes).toBeGreaterThanOrEqual(7);
  });

  it("keeps the robot mop inside the collider RobotMopTrap drives", () => {
    // MOP_RADIUS 0.36 and MOP_HALF_HEIGHT 0.1 in traps/LauncherTraps.tsx, and
    // the CylinderCollider is built from both. The sculpt has to fit inside
    // that footprint or the visible disc overhangs the shape that actually
    // bumps the player. It also sits on its own origin while the trap's body
    // origin is the shell's centre, so a caller mounts it at -MOP_HALF_HEIGHT.
    // The bumper is now seated so its OUTER face lands on MOP_RADIUS rather than its
    // centreline, which puts the disc exactly on 0.72 and one float ulp over it. The
    // bound carries that epsilon rather than the model being pulled 0.0002 inside a
    // number it is meant to land on.
    const { size, min } = measure(createRobotMopModel({ textureSize: TEXTURE_SIZE }));
    expect(size.x).toBeLessThanOrEqual(0.7201);
    expect(size.z).toBeLessThanOrEqual(0.7201);
    expect(size.y).toBeLessThanOrEqual(0.2);
    expect(min.y).toBeCloseTo(0, 2);
  });

  it("keeps the robot mop's reference parts rather than a blockout disc", () => {
    // The factory shipped as two meshes, and one of them was invisible: the macro
    // fringe-skirt was a two-point lathe at radius 0.0002 declared "builds no geometry
    // itself", so the whole prop was a plain cream disc, plainer than the hand-authored
    // mop in traps/LauncherTraps.tsx that it is meant to replace. These are the parts
    // that make it read as the reference, and the count is the guard against a
    // regenerated factory dropping back.
    const mop = createRobotMopModel({ textureSize: TEXTURE_SIZE });
    const named = new Set<string>();
    let meshes = 0;
    mop.traverse((node) => {
      if (!(node as { isMesh?: boolean }).isMesh) return;
      meshes += 1;
      named.add(node.name);
    });
    for (const part of [
      "Cream shell body",
      "Raised rim lip",
      "Mint top deck",
      "Coral power button",
      "Bumper Front",
      "Bumper Rear",
      "Bumper Left",
      "Bumper Right",
      "Microfibre fringe skirt",
    ])
      expect(named, `robot mop is missing ${part}`).toContain(part);
    expect(meshes).toBeGreaterThanOrEqual(9);
  });

  it("keeps the robot mop's fringe skirt real, and clear of the trap's brush ring", () => {
    // Two separate things this pins, and both were found by measuring rather than reading.
    //
    // First, the skirt is real. An earlier build of this factory shipped `fringe-skirt` as a
    // two-point lathe at radius 0.0002 whose comment claimed it "builds no geometry itself",
    // which would have left the mop a bare disc. It is now a revolved skirt spanning y 0 to
    // 0.0364 out to radius 0.3419, and this bound fails if it collapses back to a stub. The
    // sibling "Segmented bumper band" IS still such a stub, at 0.0004 across; it is the
    // container for the four real bumper segments and is left alone here.
    //
    // Second, the skirt is why RobotMopTrap keeps its own brush ring. The skirt is a full
    // solid of revolution, so spinning it about Y shows nothing, and MOP_BRUSH_SPEED would
    // survive in code while the mop stopped looking like it was running. The trap seats its
    // boxes at MOP_BRUSH_Y -0.12, MOP_BRUSH_HEIGHT 0.04, so their top face lands on -0.10;
    // mounted at -MOP_HALF_HEIGHT the skirt's underside is also -0.10. Those two numbers meet
    // exactly, and this asserts the sculpt's half of that contract.
    const mop = createRobotMopModel({ textureSize: TEXTURE_SIZE });
    mop.updateMatrixWorld(true);
    const parts = new Map<string, Box3>();
    mop.traverse((node) => {
      if ((node as { isMesh?: boolean }).isMesh) parts.set(node.name, new Box3().setFromObject(node));
    });
    const skirt = parts.get("Microfibre fringe skirt");
    expect(skirt, "robot mop is missing its fringe skirt").toBeDefined();
    // Real geometry, not a stub: a skirt that reaches the disc's own radius and has thickness.
    expect(skirt!.max.x - skirt!.min.x).toBeGreaterThan(0.6);
    expect(skirt!.max.y - skirt!.min.y).toBeGreaterThan(0.02);
    // Sits on the sculpt's base, which is what puts its underside on the brush ring's top face.
    expect(skirt!.min.y).toBeCloseTo(0, 3);
    // Inside MOP_RADIUS 0.36, so the skirt never overhangs the collider that bumps the player.
    expect(skirt!.max.x).toBeLessThanOrEqual(0.36);
    expect(skirt!.max.z).toBeLessThanOrEqual(0.36);
  });

  it("keeps the spring pad inside the trigger and under the step-assist ceiling", () => {
    // The jump pad is the only prop in this set with NO collider. TrapRenderer's Spring
    // launches on a distance test, |dx| < 0.7 and |dz| < 0.7 about trap.position, so a pad
    // wider than 1.40 is visible pad that does not launch. The height bound is
    // PLAYER.stepAssistHeight, 0.45 in lib/game/constants.ts: that is the tallest riser
    // PlayerController lifts the runner over, and a launcher taller than it is a wall the
    // runner has to jump BEFORE it can throw him.
    //
    // Both numbers are landed on exactly rather than merely cleared, because the reference
    // is a stool as tall as it is wide and the fit cost 68.5% of its height. Getting that
    // squash right is the whole difficulty of this prop, so the bounds are tight.
    const { size, min } = measure(createApartmentSpringJumpPadModel({ textureSize: TEXTURE_SIZE }));
    expect(size.x).toBeLessThanOrEqual(1.4001);
    expect(size.z).toBeLessThanOrEqual(1.4001);
    expect(size.y).toBeLessThanOrEqual(0.4501);
    expect(size.y).toBeCloseTo(0.45, 3);
    // Floor-centred: the [0, -0.18, 0] mount inside a group at trap.position.y + 0.18 only
    // stands the pad on the deck if the sculpt's own base is its origin.
    expect(min.y).toBeCloseTo(0, 3);
  });

  it("builds the spring's coil as a helix rather than the generator's cylinder", () => {
    // validate_sculpt_spec puts `tube` in ATTACHMENT_PRIMITIVES, so a tube with a parent
    // FAILS --strict-quality without an attachment. generate_threejs_factory then reads that
    // attachment and replaces the component's geometry with a CylinderGeometry between its
    // two endpoints, discarding the component's transform as well. The first build shipped
    // exactly that: the three-turn helix was generated into the factory and never used, and
    // the coil rendered as a smooth rod. refine_props.py carries the guard that honours
    // attachment.geometryFromSpec.
    //
    // A cone or rod fills nearly the same silhouette from the reference angle, so no pixel
    // gate catches this. Counting the coil's vertices does: a 3-turn, 24-sample tube at 8
    // radial segments is far denser than a 32x12 cylinder, and only the helix leaves the
    // coil's bounding box wider than its own tube.
    const pad = createApartmentSpringJumpPadModel({ textureSize: TEXTURE_SIZE });
    pad.updateMatrixWorld(true);
    const parts = new Map<string, Box3>();
    pad.traverse((node) => {
      if ((node as { isMesh?: boolean }).isMesh) parts.set(node.name, new Box3().setFromObject(node));
    });
    for (const part of ["Base disc", "Compression coil", "Strike cap"])
      expect(parts.has(part), `spring pad is missing ${part}`).toBe(true);

    // The helix sweeps a full circle, so the coil spans its mean diameter plus a tube; the
    // cylinder the generator would substitute runs straight up the axis and spans one tube.
    const coil = parts.get("Compression coil")!;
    expect(coil.max.x - coil.min.x).toBeGreaterThan(1.0);
    expect(coil.max.z - coil.min.z).toBeGreaterThan(1.0);
    // Seated in the base groove at the bottom and buried in the cap seat at the top, so no
    // gap can open at either end of the spring.
    expect(coil.min.y).toBeLessThan(0.0597);
    expect(coil.max.y).toBeGreaterThan(0.3589);
  });

  it("keeps the spring's four launch chevrons, which the reference does not have", () => {
    // TrapRenderer's Spring renders the AssetModel and nothing else, so these four inlays are
    // the trap's ENTIRE signal that it launches. The reference is a plain coral stool, so a
    // reference-pure sculpt would ship a launcher that tells the player nothing. They are
    // carried over deliberately, declared non-reference throughout the spec, and pinned here
    // so that neither a regenerated factory nor a later fidelity pass drops them silently.
    const pad = createApartmentSpringJumpPadModel({ textureSize: TEXTURE_SIZE });
    const named = new Set<string>();
    pad.traverse((node) => {
      if ((node as { isMesh?: boolean }).isMesh) named.add(node.name);
    });
    for (const slot of [0, 1, 2, 3])
      expect(named, `spring pad is missing launch chevron ${slot}`).toContain(
        `Launch chevron ${slot}`,
      );
  });

  it("fits the toilet inside TrapRenderer's hazard box without rattling in it", () => {
    // CuboidCollider args={[TOILET_HAZARD_HALF_X, 0.45, 0.5]} at a [0, -0.45, 0] mount, so
    // 1.04 x 0.90 x 1.00 with the foot on the deck. Both directions are failures: geometry
    // outside the box is the swinging hammer's bug, and a prop rattling inside it kills a
    // player who was never touched. The blockout measured 0.7292 x 0.8481 x 0.7879 in that
    // box before the cistern was moved to the frame it was authored for.
    const { size, min } = measure(createApartmentToiletModel({ textureSize: TEXTURE_SIZE }));
    expect(size.x).toBeLessThanOrEqual(1.04);
    expect(size.y).toBeLessThanOrEqual(0.9001);
    expect(size.z).toBeLessThanOrEqual(1.0);
    expect(size.x).toBeGreaterThan(0.93);
    expect(size.z).toBeGreaterThan(0.95);
    // The cistern lid is the tallest part and the collider's ceiling is the measured top.
    expect(size.y).toBeCloseTo(0.9, 3);
    expect(min.y).toBeCloseTo(0, 3);
  });

  it("stands the toilet's raised lid clear of the tank instead of inside it", () => {
    // The identity of this prop is a RAISED mint lid against cream ceramic, and it has been
    // lost twice to the same class of bug. The spec authors the cistern's Z in world, but
    // generate_threejs_factory emits every xform in its PARENT's frame and the cistern hangs
    // off the bowl, whose node carries z 0.1921 - so the tank landed forward by exactly that
    // and swallowed the lid whole. The render still looked like a toilet; only the part
    // bounds showed the lid's whole z span sitting inside the tank's.
    //
    // Renders cannot catch this and neither can a whole-model Box3, so the contract is the
    // one thing that distinguishes the two builds: the lid's rear tip must reach the cistern
    // lid's front face and the tank must be entirely behind the lid.
    const toilet = createApartmentToiletModel({ textureSize: TEXTURE_SIZE });
    toilet.updateMatrixWorld(true);
    const parts = new Map<string, Box3>();
    toilet.traverse((node) => {
      if ((node as { isMesh?: boolean }).isMesh) parts.set(node.name, new Box3().setFromObject(node));
    });
    for (const part of ["Bowl and pedestal", "Cistern", "Cistern lid", "Seat ring", "Raised seat lid"])
      expect(parts.has(part), `toilet is missing ${part}`).toBe(true);

    const lid = parts.get("Raised seat lid")!;
    const cistern = parts.get("Cistern")!;
    const cisternLid = parts.get("Cistern lid")!;
    // Wholly in front of the tank: the burial bug put lid.min.z inside the cistern's span.
    expect(lid.min.z).toBeGreaterThanOrEqual(cistern.max.z);
    // Resting on the cistern lid's front face, which is the surface at the tip's height -
    // the tank's own face is 0.0455 further back and 0.04 below the tip, so solving against
    // it left the lid leaning on nothing.
    expect(lid.min.z).toBeCloseTo(cisternLid.max.z, 3);
    // Raised, not closed: the hinge is at the seat's top and the lid climbs from there.
    expect(lid.max.y - lid.min.y).toBeGreaterThan(0.25);
    // And still not the tallest thing on the prop, which is what makes it affordable here.
    expect(lid.max.y).toBeLessThan(cisternLid.max.y);
  });

  it("fits the fan inside TrapRenderer's hazard box", () => {
    // CuboidCollider args={[0.47, 0.65, 0.34]} at a [0, -0.65, 0] mount, so 0.94 x 1.30 x
    // 0.68 with the base on the deck. The box was trimmed to the sculpt when it was wired
    // (from the hand-authored fan's [0.6, 0.65, 0.35]), so unlike the old box every axis
    // is now nearly filled and the width bound below is tight: growing the guard by a
    // centimetre means the visible fan pokes out of the hitbox players learn to dodge.
    const { size, min } = measure(createApartmentFloorFanModel({ textureSize: TEXTURE_SIZE }));
    expect(size.x).toBeLessThanOrEqual(0.9401);
    expect(size.y).toBeLessThanOrEqual(1.3001);
    expect(size.z).toBeLessThanOrEqual(0.6801);
    expect(size.y).toBeCloseTo(1.3, 2);
    expect(size.z).toBeGreaterThan(0.65);
    expect(min.y).toBeCloseTo(0, 3);
    // The collider is CENTRED on the body origin, so size alone cannot prove
    // containment: a fan of the right depth shifted forward still pokes out.
    // Both z extremes must sit inside the 0.34 half-extent.
    expect(min.z).toBeGreaterThanOrEqual(-0.3401);
    expect(min.z + size.z).toBeLessThanOrEqual(0.3401);
  });

  it("builds the fan's guard as a circle, not as the reference's projected ellipse", () => {
    // The reference reads the cage as a tall oval, and it is not one: the head is yawed
    // 43.1 degrees, solved from the guard's own 293:401 projected semi-axes against an
    // elevation the BASE gives independently (its top rim's 151:576 minor-to-major is
    // sin(elevation)). Two discs in perpendicular planes fix both angles, so the ellipse is
    // the camera and never the part. Building what the reference literally shows would ship
    // a fan with an oval cage, which is why this is pinned rather than left to a render.
    const fan = createApartmentFloorFanModel({ textureSize: TEXTURE_SIZE });
    fan.updateMatrixWorld(true);
    const parts = new Map<string, Box3>();
    fan.traverse((node) => {
      if ((node as { isMesh?: boolean }).isMesh) parts.set(node.name, new Box3().setFromObject(node));
    });
    for (const part of ["Weighted base", "Neck", "Guard rim", "Hub cap"])
      expect(parts.has(part), `fan is missing ${part}`).toBe(true);

    const rim = parts.get("Guard rim")!;
    const width = rim.max.x - rim.min.x;
    const height = rim.max.y - rim.min.y;
    expect(width / height).toBeCloseTo(1, 2);
    // Thin in Z next to its own diameter: a torus, not a dome or a disc.
    expect(rim.max.z - rim.min.z).toBeLessThan(width * 0.1);

    // The blades sit BEHIND the rim's plane. The blades are cream on a cream deck at
    // 1.00:1 and carry no silhouette of their own, so the only thing that reads them is the
    // cage's shadow falling across them - which needs them behind it.
    //
    // REWRITTEN 2026-07-29 for a restructured SUBJECT, not a relaxed property. This asserted
    // once per mesh named "Blade N" back when the five petals were five components; the
    // ruling that made them one rigid rosette left that filter matching nothing, which would
    // have passed an empty loop silently had the count check not been here. The property is
    // unchanged and still exact: every petal's geometry must lie behind the rim. One mesh now
    // carries all five, so the bound over the merged rosette IS the bound over every petal.
    const blades = parts.get("blades");
    expect(blades, "the fan has no merged blade mesh named blades").toBeDefined();
    expect(blades!.max.z, "the blade rosette is not behind the guard rim").toBeLessThan(rim.min.z);
  });

  it("gives the fan one spinnable blade group that the cage does not hang from", () => {
    // THE bladesRef CONTRACT. ProceduralFloorFan exposes a ref on a group named "blades" and
    // a caller spins it every frame (TrapRenderer.tsx passes bladesRef; the group is also
    // findable by name for callers that walk the graph instead). The sculpted replacement
    // has to keep that exactly, and the dangerous half is not "does it spin" but "what else
    // spins with it": if any cage geometry hangs under the blade node, the whole guard
    // rotates with the blades. A render at rest cannot show that and neither can a bounds
    // dump - only spinning it and re-measuring can, which is why this test drives the
    // rotation itself.
    const fan = createApartmentFloorFanModel({ textureSize: TEXTURE_SIZE });
    fan.updateMatrixWorld(true);

    let group: Object3D | undefined;
    fan.traverse((node) => {
      if (node.name === "blades__pivot") group = node;
    });
    expect(group, "the fan has no blade group named blades__pivot").toBeDefined();

    const under = new Set<string>();
    group!.traverse((node) => {
      if ((node as { isMesh?: boolean }).isMesh) under.add(node.name);
    });
    expect(under.has("blades"), "the blade mesh is not under the blade group").toBe(true);
    for (const caged of ["Guard rim", "fan-guard-spokes", "Hub cap"])
      expect(under.has(caged), `${caged} hangs under the spinning blade group`).toBe(false);

    const rim = findMesh(fan, "Guard rim")!;
    const rimBefore = new Box3().setFromObject(rim);
    const bladesBefore = new Box3().setFromObject(group!);

    // Deliberately NOT a multiple of 360/5: a five-fold symmetric blade group maps onto
    // itself every 72 degrees, so a 72-degree test would measure identical bounds and pass
    // whether or not anything actually turned.
    group!.rotation.z += Math.PI / 7;
    fan.updateMatrixWorld(true);

    const rimAfter = new Box3().setFromObject(rim);
    const bladesAfter = new Box3().setFromObject(group!);
    expect(rimAfter.min.distanceTo(rimBefore.min), "the cage moved with the blades").toBeLessThan(1e-9);
    expect(rimAfter.max.distanceTo(rimBefore.max), "the cage moved with the blades").toBeLessThan(1e-9);
    expect(
      bladesAfter.min.distanceTo(bladesBefore.min) + bladesAfter.max.distanceTo(bladesBefore.max),
      "the blade group did not actually turn",
    ).toBeGreaterThan(1e-4);
  });

  it("fits the vacuum inside TrapRenderer's hazard box and fills its plan", () => {
    // CuboidCollider args={[0.43, 0.32, 0.45]} at a [0, -0.32, 0] mount, so 0.86 x 0.64 x
    // 0.90 with the shell on the deck - the trim that closed the "queued collider-trim
    // decision" this comment used to reference. Z's half-extent is 0.45 and NOT 0.44
    // because vacuum-body reaches z -0.446; 0.44 would have left real geometry outside
    // the hitbox. The canister stays sized DOWN from 0.80 to 0.70 so the hose can clear
    // the shell and read as a hose; that ruling is why the width lower bound is loose.
    // Depth is filled by the hose's own sweep.
    const { size, min } = measure(createApartmentCanisterVacuumModel({ textureSize: TEXTURE_SIZE }));
    expect(size.x).toBeLessThanOrEqual(0.8601);
    expect(size.y).toBeLessThanOrEqual(0.6401);
    expect(size.z).toBeLessThanOrEqual(0.9001);
    expect(size.x).toBeGreaterThan(0.80);
    expect(size.z).toBeGreaterThan(0.85);
    expect(min.y).toBeCloseTo(0, 3);
    // The collider is CENTRED on the body origin; size alone cannot prove containment.
    // Both z extremes must sit inside the 0.45 half-extent (the -z extreme is the one
    // that forced 0.45 over 0.44), and both x extremes inside 0.43.
    expect(min.z).toBeGreaterThanOrEqual(-0.4501);
    expect(min.z + size.z).toBeLessThanOrEqual(0.4501);
    expect(min.x).toBeGreaterThanOrEqual(-0.4301);
    expect(min.x + size.x).toBeLessThanOrEqual(0.4301);
  });

  it("builds the vacuum's hose as a swept curve rather than the generator's cylinder", () => {
    // The same trap the spring's coil fell into, and worth pinning twice because the
    // consequence here is larger: a quarter of this prop's reference silhouette is hose, and
    // without it the model reads as a kettle. `tube` is in validate_sculpt_spec's
    // ATTACHMENT_PRIMITIVES, so a tube with a parent fails --strict-quality without an
    // attachment; generate_threejs_factory then reads that attachment and substitutes a
    // CylinderGeometry between its two endpoints, discarding the component's transform.
    // refine_props.py's attachment.geometryFromSpec guard is what prevents it.
    //
    // NO PIXEL GATE CATCHES THIS. A rod between the same two endpoints fills a similar
    // silhouette from the reference angle. The bounding box does catch it, and by a wide
    // margin: the authored route arcs up over the shell and back down, so it spans about
    // 0.62 in Y, where a rod between endpoints spans its own 0.13 tube plus the 0.16 of
    // height between its ends.
    const vacuum = createApartmentCanisterVacuumModel({ textureSize: TEXTURE_SIZE });
    vacuum.updateMatrixWorld(true);
    const parts = new Map<string, Box3>();
    vacuum.traverse((node) => {
      if ((node as { isMesh?: boolean }).isMesh) parts.set(node.name, new Box3().setFromObject(node));
    });
    for (const part of ["Canister shell", "Corrugated hose", "Floor head", "Hose collar"])
      expect(parts.has(part), `vacuum is missing ${part}`).toBe(true);

    // THE BOUNDING BOX DOES NOT DISCRIMINATE HERE, and that is worth stating because an
    // earlier version of this test relied on it. When the route climbed into the free height
    // above the shell, the arc spanned 0.616 in Y against a substituted cylinder's 0.284. Once
    // the route was re-authored to sweep the FRONT, its two endpoints moved far apart in every
    // axis, and a straight cylinder between them now spans [0.524, 0.325, 0.354] against the
    // real hose's [0.553, 0.331, 0.355] - indistinguishable. So this measures the property the
    // risk is actually about: how far the tube's surface bows off the straight line joining
    // its ends. A cylinder cannot exceed its own radius; an arc does, by a wide margin.
    const hoseMesh = findMesh(vacuum, "Corrugated hose");
    expect(hoseMesh, "vacuum is missing the hose mesh").toBeDefined();
    expect(maximumBow(hoseMesh!)).toBeGreaterThan(0.12);
  });

  it("mounts both of the vacuum's wheels on their axles rather than at the origin", () => {
    // The hub caps are children of a wheel node that carries a 90-degree rotation, so their
    // positions are in the WHEEL's frame, not the world's. Authoring a world position there
    // spins it by the parent's rotation: the first build put the right hub cap at y -0.343,
    // below the deck, and the left one up at 0.607. Neither showed in a render - the caps
    // are small and the prop still read as a vacuum - and both are obvious here.
    const vacuum = createApartmentCanisterVacuumModel({ textureSize: TEXTURE_SIZE });
    vacuum.updateMatrixWorld(true);
    const parts = new Map<string, Box3>();
    vacuum.traverse((node) => {
      if ((node as { isMesh?: boolean }).isMesh) parts.set(node.name, new Box3().setFromObject(node));
    });
    for (const side of ["Right", "Left"]) {
      const wheel = parts.get(`${side} wheel`)!;
      const cap = parts.get(`${side} hub cap`)!;
      expect(wheel, `vacuum is missing the ${side.toLowerCase()} wheel`).toBeDefined();
      // Each wheel rolls on the deck, so its lowest point is the floor and its diameter is
      // its height.
      expect(wheel.min.y).toBeCloseTo(0, 2);
      expect(wheel.max.y - wheel.min.y).toBeCloseTo(0.247, 2);
      // The cap sits on the wheel's OUTBOARD face, concentric with it.
      expect(cap.min.y).toBeGreaterThan(wheel.min.y);
      expect(cap.max.y).toBeLessThan(wheel.max.y);
      const capCentreY = (cap.min.y + cap.max.y) / 2;
      const wheelCentreY = (wheel.min.y + wheel.max.y) / 2;
      expect(capCentreY, `${side} hub cap is not concentric with its wheel`).toBeCloseTo(
        wheelCentreY,
        2,
      );
    }
    // Mirrored about X = 0, which is the ruling that the reference neither shows nor
    // excludes: a second wheel would sit behind the shell and project about 9 px past its
    // left silhouette. A chase-camera prop needs both, because one reads as broken from the
    // far side.
    const right = parts.get("Right wheel")!;
    const left = parts.get("Left wheel")!;
    expect(right.min.x).toBeCloseTo(-left.max.x, 3);
    expect(right.max.x).toBeCloseTo(-left.min.x, 3);
  });
});
