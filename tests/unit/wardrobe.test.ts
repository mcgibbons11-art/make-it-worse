// The wardrobe has to fit a rig this file does not own.
//
// Everything here is measured off a built runner rather than asserted about
// one. The geometry in createWardrobeModels.ts is written against constants
// copied out of the sculpt - the torso's lathe profile, the arm and leg axes,
// each socket's scale - and a copied constant is a constant that can go stale,
// so the first block below reads all of them back out of a real model and fails
// if they have drifted.
//
// The rest measures the two things a garment can break: how wide the runner
// gets, which is bounded by the deck they run on, and whether a garment ends up
// inside the body once the run cycle starts moving the joints it hangs from.

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildRunnerForTest } from "@/components/game/PlayerVisual";
import { createMAKEITWORSERunnerModel } from "@/components/game/models/createRunnerModel";
import {
  HAT_FACE_MIN_Y,
  HELD_MIN_X,
  LEG_MAX_RADIUS,
  MAX_HALF_WIDTH,
  SOCKETS,
  TORSO_HEM_Y,
  attachWardrobe,
  createWardrobeAttachments,
} from "@/components/game/models/createWardrobeModels";
import {
  AVATAR_COLORS,
  DEFAULT_AVATAR,
  MIN_CONTRAST,
  MIN_DANGER_DISTANCE,
  WARDROBE_SLOTS,
  avatarFromCode,
  avatarToCode,
  colorDistance,
  colorRejection,
  deckContrast,
  normalizeAvatar,
  randomAvatar,
  resolveAvatar,
} from "@/lib/game/avatar";
import { PALETTE } from "@/lib/game/constants";
import type { AvatarConfig } from "@/lib/game/avatar";

const MAX_SILHOUETTE = 0.94;

function rawRunner(): THREE.Group {
  return createMAKEITWORSERunnerModel({ textureSize: 64, qualityPriority: "balanced" });
}

/** The runner's own units, before PlayerVisual fits it to the play space. */
function dressedRaw(config: Partial<AvatarConfig>): {
  model: THREE.Group;
  missing: string[];
} {
  const model = rawRunner();
  const missing = attachWardrobe(model, resolveAvatar(config, 1));
  model.updateMatrixWorld(true);
  return { model, missing };
}

/** Only the clothes, not the runner inside them. */
function wardrobeMeshes(model: THREE.Object3D, socket?: string): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  model.traverse((node) => {
    if (!node.name.startsWith("Wardrobe on ")) return;
    if (socket && node.name !== `Wardrobe on ${socket}`) return;
    node.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) found.push(mesh);
    });
  });
  return found;
}

function boxOf(meshes: readonly THREE.Mesh[]): THREE.Box3 {
  const box = new THREE.Box3();
  for (const mesh of meshes) box.union(new THREE.Box3().setFromObject(mesh));
  return box;
}

function only(slot: string, item: string): Partial<AvatarConfig> {
  return { ...DEFAULT_AVATAR, [slot]: item };
}

const NON_EMPTY = WARDROBE_SLOTS.flatMap((slot) =>
  slot.options.slice(1).map((option) => ({ slot: slot.id, item: option.id })),
);

describe("the rig the wardrobe is cut for", () => {
  const model = rawRunner();
  model.updateMatrixWorld(true);

  const nodeAt = (name: string) => {
    const node = model.getObjectByName(name);
    expect(node, `${name} is missing from the runner`).toBeTruthy();
    return node!;
  };

  it("still exposes every socket the catalogue names", () => {
    for (const socket of Object.values(SOCKETS)) nodeAt(socket);
    for (const slot of WARDROBE_SLOTS)
      for (const socket of slot.sockets) nodeAt(socket);
  });

  it("still carries the non-unit socket scales the attach step cancels", () => {
    // Named in createWardrobeModels' header as the reason attachWardrobe exists
    // at all. If the pipeline ever normalises them, the compensation becomes a
    // no-op rather than a bug, but the claim in the comment stops being true.
    const scaleOf = (name: string) => nodeAt(name).scale.toArray();
    expect(scaleOf(SOCKETS.torso)).toEqual([1, 1, 0.8]);
    expect(scaleOf(SOCKETS.handRight)).toEqual([0.145, 0.15, 0.105]);
    expect(scaleOf(SOCKETS.shoeRight)).toEqual([0.198, 0.205, 0.3]);
    for (const socket of [SOCKETS.head, SOCKETS.neck, SOCKETS.armRight, SOCKETS.legRight])
      expect(scaleOf(socket), `${socket} moved off unit scale`).toEqual([1, 1, 1]);
  });

  it("rests every socket at identity rotation", () => {
    // Garments are authored in each socket's rest frame, so a socket that
    // arrived pre-rotated would tilt everything hung off it.
    for (const socket of Object.values(SOCKETS))
      expect(nodeAt(socket).rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
  });

  it("keeps the torso profile the shells are cut from", () => {
    // createWardrobeModels hardcodes this curve because it cannot ask the
    // factory for it. Reading the real lathe back is what makes a future pass
    // of the pipeline fail here rather than ship shirts that no longer fit.
    const torso = nodeAt("Torso") as THREE.Mesh;
    const points = (
      torso.geometry as unknown as { parameters: { points: THREE.Vector2[] } }
    ).parameters.points;
    const worn = wardrobeMeshes(
      dressedRaw(only("top", "turtleneck")).model,
      SOCKETS.torso,
    );
    expect(worn.length).toBeGreaterThan(0);
    // The garment's body, not the rib standing proud at its hem. Taking the
    // widest mesh at each height would read that band as the shell sitting
    // further off the torso than it does, and would hide a real drift behind
    // it. The body is the tallest piece in the socket by a long way.
    const heightOf = (mesh: THREE.Mesh) => {
      const size = new THREE.Vector3();
      new THREE.Box3().setFromObject(mesh).getSize(size);
      return size.y;
    };
    const body = worn.reduce((tallest, mesh) =>
      heightOf(mesh) > heightOf(tallest) ? mesh : tallest,
    );
    // Sample the shell's own radius at each real lathe height and compare.
    const shellRadius = (y: number): number => {
      let radius = 0;
      const position = body.geometry.getAttribute("position");
      for (let index = 0; index < position.count; index += 1) {
        const vertex = new THREE.Vector3().fromBufferAttribute(position, index);
        body.localToWorld(vertex);
        if (Math.abs(vertex.y - (y + 0.95)) > 0.02) continue;
        radius = Math.max(radius, Math.abs(vertex.x));
      }
      return radius;
    };
    // The offset that garment's shell is built at, which this number has to
    // follow: the check is that the torso under it has not moved, so a garment
    // change must be reflected here rather than absorbed by the tolerance.
    const shellOffset = 0.022;
    let worst = 0;
    for (const point of points) {
      if (point.y < -0.16 || point.y > 0.26) continue;
      const measured = shellRadius(point.y);
      if (measured === 0) continue;
      worst = Math.max(worst, Math.abs(measured - point.x - shellOffset));
    }
    expect(worst, `torso profile drifted by ${worst.toFixed(4)}u`).toBeLessThan(0.012);
  });

  it("keeps the limb axes the sleeves are laid along", () => {
    // The arm cylinder is centred on its own midpoint, so twice that position
    // is the vector from the shoulder to the wrist - which is what a sleeve is
    // laid along, and is not quite where the hand pivot sits.
    const armMesh = nodeAt("Arm right") as THREE.Mesh;
    const armDir = armMesh.position.clone().multiplyScalar(2);
    const armLength = armDir.length();
    armDir.normalize();
    expect(armDir.x).toBeCloseTo(0.4797, 3);
    expect(armDir.y).toBeCloseTo(-0.8773, 3);
    expect(armLength).toBeCloseTo(0.38755, 3);
    const armParams = (
      armMesh.geometry as unknown as {
        parameters: { radiusTop: number; radiusBottom: number };
      }
    ).parameters;
    expect(armParams.radiusBottom).toBeCloseTo(0.082, 3);
    expect(armParams.radiusTop).toBeCloseTo(0.066, 3);
    expect(nodeAt(SOCKETS.armRight).position.x).toBeCloseTo(0.15, 3);

    const legMesh = nodeAt("Leg right") as THREE.Mesh;
    const legParams = (
      legMesh.geometry as unknown as {
        parameters: { radiusTop: number; radiusBottom: number; height: number };
      }
    ).parameters;
    expect(legParams.radiusBottom).toBeCloseTo(0.083, 3);
    expect(legParams.radiusTop).toBeCloseTo(0.067, 3);
    expect(legParams.height).toBeCloseTo(0.373, 2);
    expect(nodeAt(SOCKETS.legRight).position.x).toBeCloseTo(0.105, 3);
    // The leg pivot hangs under a leg-mass group, so the hip height it swings
    // about is a world position rather than its own.
    const hip = new THREE.Vector3();
    nodeAt(SOCKETS.legRight).getWorldPosition(hip);
    expect(hip.y).toBeCloseTo(0.66, 3);
    expect(hip.x).toBeCloseTo(0.105, 3);
  });

  it("keeps the shoulder caps where a body band is placed against them", () => {
    // createWardrobeModels writes SHOULDER_Y as 1.14 minus the torso origin so
    // it can put a band authored in torso heights onto a cap hanging from its
    // own socket. Both numbers are copied out of the rig, so both are read
    // back here rather than trusted.
    const torso = new THREE.Vector3();
    nodeAt(SOCKETS.torso).getWorldPosition(torso);
    expect(torso.y).toBeCloseTo(0.95, 3);
    for (const [socket, side] of [
      [SOCKETS.shoulderLeft, -1],
      [SOCKETS.shoulderRight, 1],
    ] as const) {
      const shoulder = new THREE.Vector3();
      nodeAt(socket).getWorldPosition(shoulder);
      expect(shoulder.y).toBeCloseTo(1.14, 3);
      expect(shoulder.x).toBeCloseTo(side * 0.168, 3);
    }
  });

  it("keeps the head landmarks the hats and glasses sit on", () => {
    const hair = nodeAt("Hair cap__pivot");
    expect(hair.position.toArray()).toEqual([0, 0.103, -0.012]);
    expect(hair.scale.toArray()).toEqual([0.69, 0.47, 0.68]);
    expect(nodeAt("Eye right__pivot").position.toArray()).toEqual([0.108, -0.076, 0.272]);
  });
});

describe("dressing a runner", () => {
  it("finds a socket for every garment in the catalogue", () => {
    for (const { slot, item } of NON_EMPTY) {
      const { missing, model } = dressedRaw(only(slot, item));
      expect(missing, `${slot}/${item} wanted sockets that do not exist`).toEqual([]);
      expect(
        wardrobeMeshes(model).length,
        `${slot}/${item} attached no geometry`,
      ).toBeGreaterThan(0);
    }
  });

  it("draws something different for every option in a slot", () => {
    // An option that renders identically to another is a label with nothing
    // behind it, which is exactly what the old four-slot picker had.
    for (const slot of WARDROBE_SLOTS) {
      const signatures = slot.options.map((option) => {
        const { model } = dressedRaw(only(slot.id, option.id));
        const meshes = wardrobeMeshes(model);
        const box = boxOf(meshes);
        return [
          meshes.length,
          meshes.reduce((total, mesh) => total + mesh.geometry.getAttribute("position").count, 0),
          box.isEmpty() ? "empty" : box.min.toArray().concat(box.max.toArray()).map((v) => v.toFixed(3)).join(","),
        ].join("|");
      });
      expect(
        new Set(signatures).size,
        `two ${slot.id} options draw alike`,
      ).toBe(slot.options.length);
    }
  });

  it("leaves a dressed runner clonable", () => {
    // PlayerVisual clones the runner template and the ghost clones materials
    // again on top. Anything the wardrobe writes into userData travels through
    // JSON on the way, so a stray object reference here would throw the same
    // way the sculpt runtime's circular references do.
    const { model } = dressedRaw({ ...DEFAULT_AVATAR, top: "hoodie", held: "flag" });
    expect(() => model.clone(true)).not.toThrow();
  });

  it("shares one template between two runners in the same outfit", () => {
    const look = resolveAvatar({ ...DEFAULT_AVATAR, headwear: "tophat" }, 1);
    const first = createWardrobeAttachments(look);
    const second = createWardrobeAttachments(look);
    const geometryOf = (list: ReturnType<typeof createWardrobeAttachments>) => {
      const found: THREE.BufferGeometry[] = [];
      for (const { node } of list)
        node.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (mesh.isMesh) found.push(mesh.geometry);
        });
      return found;
    };
    const a = geometryOf(first);
    const b = geometryOf(second);
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBe(b.length);
    for (const [index, geometry] of a.entries()) expect(b[index]).toBe(geometry);
  });
});

describe("the silhouette a dressed runner casts", () => {
  /** The widest item in each slot, measured rather than guessed. */
  const widest = new Map<string, { item: string; halfWidth: number }>();
  const halfWidths = new Map<string, number>();
  for (const { slot, item } of NON_EMPTY) {
    const { model } = dressedRaw(only(slot, item));
    const box = boxOf(wardrobeMeshes(model));
    const halfWidth = Math.max(Math.abs(box.min.x), Math.abs(box.max.x));
    halfWidths.set(`${slot}/${item}`, halfWidth);
    const best = widest.get(slot);
    if (!best || halfWidth > best.halfWidth) widest.set(slot, { item, halfWidth });
  }

  it("keeps every single garment inside the authoring bound", () => {
    for (const [name, halfWidth] of halfWidths)
      expect(
        halfWidth,
        `${name} reaches ${halfWidth.toFixed(3)}u from the centre line`,
      ).toBeLessThanOrEqual(MAX_HALF_WIDTH);
  });

  it("keeps the widest outfit in the game inside the visible deck", () => {
    // Width is a maximum over parts and every part is independent, so the
    // broadest runner the game can draw is the widest option in every slot at
    // once. Measured on the fitted model PlayerVisual renders, not on the
    // factory's raw output, because that is what stands on the plank.
    const broadest = Object.fromEntries(
      [...widest].map(([slot, best]) => [slot, best.item]),
    ) as unknown as Partial<AvatarConfig>;
    const config = { ...DEFAULT_AVATAR, ...broadest };
    const model = buildRunnerForTest();
    expect(attachWardrobe(model, resolveAvatar(config, 1))).toEqual([]);
    model.updateMatrixWorld(true);
    const size = new THREE.Vector3();
    new THREE.Box3().setFromObject(model).getSize(size);
    expect(
      size.x,
      `the widest outfit measures ${size.x.toFixed(3)}u across, over the ${MAX_SILHOUETTE}u of visible deck`,
    ).toBeLessThanOrEqual(MAX_SILHOUETTE);
  });

  it("leaves the bare runner exactly as it was", () => {
    const model = buildRunnerForTest();
    model.updateMatrixWorld(true);
    const size = new THREE.Vector3();
    new THREE.Box3().setFromObject(model).getSize(size);
    expect(size.x).toBeLessThanOrEqual(MAX_SILHOUETTE);
    expect(wardrobeMeshes(model)).toHaveLength(0);
  });
});

/**
 * The run cycle, enveloped.
 *
 * PlayerVisual drives the legs to +-0.62 of a swing that peaks at 2.35 in the
 * victory pose, the ankles to +-0.8, the arms to 2.7, the hands to 0.7, and
 * twists the torso and head about Y and Z by a fifth of that. These ranges sit
 * outside all of them, so a garment that clears this sweep clears the cycle
 * with room, and the check does not have to track a formula in a file this one
 * does not own.
 */
const SWEEP = {
  "Leg left__pivot": 1.55,
  "Leg right__pivot": 1.55,
  "Sneaker left__pivot": 0.9,
  "Sneaker right__pivot": 0.9,
  "Arm left__pivot": 2.85,
  "Arm right__pivot": 2.85,
  "Hand left__pivot": 0.8,
  "Hand right__pivot": 0.8,
} as const;

const TWIST = {
  "Torso__pivot": { y: 0.42, z: 0.12 },
  "Head mass__pivot": { y: 0.28, z: 0.22 },
} as const;

function poses(): number[] {
  return [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];
}

/**
 * The volume a torso garment occupies, read off the real lathe.
 *
 * The rule these checks enforce is not "stay above a line" but "stay out of
 * each other". A boot sole does rise past the shirt hem in the victory splits,
 * and it is 0.37u out in z when it does, nowhere near the shirt. Testing the
 * height alone would have failed that and passed something genuinely wrong.
 */
function torsoGarmentVolume(model: THREE.Object3D): (point: THREE.Vector3) => boolean {
  const torso = model.getObjectByName("Torso") as THREE.Mesh;
  const profile = (
    torso.geometry as unknown as { parameters: { points: THREE.Vector2[] } }
  ).parameters.points;
  const radiusAt = (y: number): number => {
    if (y <= profile[0]!.y || y >= profile[profile.length - 1]!.y) return 0;
    for (let index = 1; index < profile.length; index += 1) {
      const high = profile[index]!;
      if (y > high.y) continue;
      const low = profile[index - 1]!;
      return low.x + ((high.x - low.x) * (y - low.y)) / (high.y - low.y);
    }
    return 0;
  };
  // The thickest garment in the catalogue is the puffer at 0.042 off the body;
  // 0.05 covers it with room, and being generous here only makes the test
  // stricter on everything measured against it.
  const padding = 0.05;
  // The tallest shell in the catalogue stops at the top of the torso lathe's
  // shoulder, 1.23u up. Above that there is no torso garment, only the collar
  // that sits round the neck - and a beard resting into a turtleneck collar is
  // how a beard and a turtleneck go together, not a defect to design out.
  const shellTop = 1.23;
  return (point) => {
    if (point.y < TORSO_HEM_Y || point.y > shellTop) return false;
    const radius = radiusAt(point.y - 0.95) + padding;
    if (radius <= padding) return false;
    return (point.x / radius) ** 2 + (point.z / (0.8 * radius)) ** 2 <= 1;
  };
}

/** The two spheres that cover the arm-to-torso seam, plus a garment's worth. */
function insideShoulderCap(point: THREE.Vector3): boolean {
  for (const side of [-1, 1])
    if (point.distanceTo(new THREE.Vector3(side * 0.168, 1.14, 0)) <= 0.0825 + 0.012)
      return true;
  return false;
}

const describe3 = (point: THREE.Vector3) =>
  `(${point.x.toFixed(3)}, ${point.y.toFixed(3)}, ${point.z.toFixed(3)})`;

function verticesOf(meshes: readonly THREE.Mesh[]): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute("position");
    for (let index = 0; index < position.count; index += 1)
      points.push(
        mesh.localToWorld(new THREE.Vector3().fromBufferAttribute(position, index)),
      );
  }
  return points;
}

describe("garments through the run cycle", () => {
  it("never lets a limb garment change its own x extent", () => {
    // The claim the whole clearance model rests on: every joint the cycle
    // drives rotates about X, and rotation about X preserves x. If that stops
    // being true, every "these two never meet" argument below stops holding.
    //
    // Every limb-mounted option rather than one outfit, because the claim is
    // about the whole catalogue and was being checked against four items. A
    // rotation baked into an item's own template does not break it - the
    // sandal's crossed straps are rigidly parented and travel with the ankle
    // like everything else - so what this widening buys is not a new class of
    // failure but the absence of an untested item to hide one in.
    const limbSockets = [
      SOCKETS.legLeft,
      SOCKETS.legRight,
      SOCKETS.armLeft,
      SOCKETS.armRight,
      SOCKETS.handRight,
      SOCKETS.shoeLeft,
      SOCKETS.shoeRight,
    ];
    for (const { slot, item } of NON_EMPTY) {
      if (!["legwear", "footwear", "held", "top", "outerwear"].includes(slot)) continue;
      const { model } = dressedRaw(only(slot, item));
      const rest = limbSockets.map((socket) =>
        boxOf(wardrobeMeshes(model, socket)).clone(),
      );
      for (const fraction of poses()) {
        for (const [name, limit] of Object.entries(SWEEP)) {
          const node = model.getObjectByName(name);
          if (node) node.rotation.x = limit * fraction;
        }
        model.updateMatrixWorld(true);
        for (const [index, socket] of limbSockets.entries()) {
          const box = boxOf(wardrobeMeshes(model, socket));
          if (box.isEmpty()) continue;
          expect(box.min.x, `${slot}/${item} on ${socket}`).toBeCloseTo(rest[index]!.min.x, 6);
          expect(box.max.x, `${slot}/${item} on ${socket}`).toBeCloseTo(rest[index]!.max.x, 6);
        }
      }
    }
  }, 20_000);

  it("carries a body band across the shoulder cap that crosses it", () => {
    // A horizontal band on the torso is three separate pieces on two sockets:
    // the shell, the band standing proud of it, and the shoulder cap that
    // covers the arm seam. The cap sits at 1.140u with radius 0.092 and stands
    // outside the shell over the top of its travel, so a cap left in the body
    // colour punches a hole in whichever band it crosses - which on a hooped
    // jersey is the difference between a rugby shirt and a shirt with a
    // printed-on stripe.
    //
    // Measured on the cap itself rather than by sampling heights across both
    // sockets. A lathe only carries vertices at its own rows, so a thin slab
    // taken anywhere else reads a hoop as absent and then compares a shoulder
    // band against the torso shell, which are not the same surface. The caps
    // are spheres and carry vertices throughout, so the overlap is exact.
    const { model } = dressedRaw(only("top", "jersey"));
    const byTint = (socket: string, tint: string) =>
      wardrobeMeshes(model, socket).filter(
        (mesh) => String(mesh.userData["wardrobeTint"]) === tint,
      );
    // The hoops, read off the shell rather than restated. The placket is cream
    // too and is a front panel, so it is excluded by not going round the body.
    const hoops = byTint(SOCKETS.torso, "cream")
      .map((mesh) => new THREE.Box3().setFromObject(mesh))
      .filter((box) => box.max.x - box.min.x > 0.3)
      .map((box) => [box.min.y, box.max.y] as const);
    expect(hoops.length, "the jersey drew no hoops round the body").toBe(3);

    const reachIn = (points: THREE.Vector3[], low: number, high: number) =>
      Math.max(
        0,
        ...points
          .filter((point) => point.y >= low && point.y <= high)
          .map((point) => Math.abs(point.x)),
      );
    let crossings = 0;
    for (const socket of [SOCKETS.shoulderLeft, SOCKETS.shoulderRight]) {
      const cap = verticesOf(byTint(socket, "main"));
      const band = verticesOf(byTint(socket, "cream"));
      const capBox = boxOf(byTint(socket, "main"));
      for (const [low, high] of hoops) {
        const from = Math.max(low, capBox.min.y);
        const to = Math.min(high, capBox.max.y);
        if (to <= from) continue;
        crossings += 1;
        const body = reachIn(cap, from, to);
        const stripe = reachIn(band, from, to);
        expect(
          stripe,
          `the cap on ${socket} shows ${(body - stripe).toFixed(4)}u of body colour outside the hoop it crosses at ${from.toFixed(3)}..${to.toFixed(3)}`,
        ).toBeGreaterThanOrEqual(body);
      }
    }
    expect(crossings, "no shoulder cap crosses a hoop, so nothing was checked").toBe(2);
  });

  it("keeps a hood and a collar behind the face they rise past", () => {
    // Above the top of the torso lathe there is no shell, only the collars and
    // the two hoods, and the volume check below stops at that line - so a hood
    // that swallowed the skull or a collar that wrapped forward over the mouth
    // is the one shape on the torso that nothing else measures. Both may rise
    // and both may sit behind the head. Neither may reach past the eye, whose
    // own z is read off the rig rather than assumed.
    const rig = rawRunner();
    rig.updateMatrixWorld(true);
    const eye = new THREE.Vector3();
    rig.getObjectByName("Eye right__pivot")!.getWorldPosition(eye);
    const shellTop = 1.23;
    for (const { slot, item } of NON_EMPTY) {
      if (slot !== "top" && slot !== "outerwear") continue;
      const { model } = dressedRaw(only(slot, item));
      const meshes = [SOCKETS.torso, SOCKETS.neck].flatMap((socket) =>
        wardrobeMeshes(model, socket),
      );
      const over = verticesOf(meshes).find(
        (point) => point.y > shellTop && point.z > eye.z,
      );
      expect(
        over && `${slot}/${item} at ${describe3(over)}`,
        `a garment rose past ${shellTop}u and reached in front of the eyes at z ${eye.z.toFixed(3)}`,
      ).toBeUndefined();
    }
  });

  it("keeps every torso garment above the reach of a swinging thigh", () => {
    // The thigh's top cap has radius 0.083 about a hip at y = 0.66, so no leg
    // ever rises past 0.743. A hem below that is a hem a leg cuts through.
    for (const { slot, item } of NON_EMPTY) {
      if (!["top", "outerwear", "backpack"].includes(slot)) continue;
      const { model } = dressedRaw(only(slot, item));
      for (const socket of [SOCKETS.torso, SOCKETS.neck]) {
        const box = boxOf(wardrobeMeshes(model, socket));
        if (box.isEmpty()) continue;
        expect(
          box.min.y,
          `${slot}/${item} hangs to ${box.min.y.toFixed(3)}u, inside the thigh's sweep`,
        ).toBeGreaterThanOrEqual(TORSO_HEM_Y - 0.001);
      }
    }
  });

  it("never drives a leg garment into a torso garment", () => {
    for (const legwear of ["kilt", "jeans", "shorts", "cargo", "kneepads"] as const)
      for (const footwear of ["boot", "skates", "hightop"] as const) {
        const { model } = dressedRaw({ ...DEFAULT_AVATAR, legwear, footwear });
        const occupied = torsoGarmentVolume(model);
        for (const fraction of poses()) {
          for (const [name, limit] of Object.entries(SWEEP)) {
            const node = model.getObjectByName(name);
            if (node) node.rotation.x = limit * fraction;
          }
          model.updateMatrixWorld(true);
          const legMeshes = [
            SOCKETS.legLeft,
            SOCKETS.legRight,
            SOCKETS.shoeLeft,
            SOCKETS.shoeRight,
          ].flatMap((socket) => wardrobeMeshes(model, socket));
          const inside = verticesOf(legMeshes).find(occupied);
          expect(
            inside && `${legwear}/${footwear} at ${describe3(inside)}`,
            "a leg garment landed inside the shirt",
          ).toBeUndefined();
        }
      }
  });

  it("keeps leg garments narrow enough to miss the other leg and the hem", () => {
    for (const { slot, item } of NON_EMPTY) {
      if (slot !== "legwear" && slot !== "footwear") continue;
      const { model } = dressedRaw(only(slot, item));
      for (const socket of [SOCKETS.legLeft, SOCKETS.legRight]) {
        const meshes = wardrobeMeshes(model, socket);
        if (meshes.length === 0) continue;
        const box = boxOf(meshes);
        const inner = Math.min(Math.abs(box.min.x), Math.abs(box.max.x));
        expect(
          inner,
          `${slot}/${item} crosses the centre line and would meet the other leg`,
        ).toBeGreaterThan(0.004);
        // Distance from the leg's own axis line, not from the hip: the leg
        // leans outward as it descends, so measuring against a fixed x would
        // charge a boot cuff for the lean rather than for its thickness. The
        // allowance over LEG_MAX_RADIUS is for the pieces meant to stand proud
        // of the sleeve - cargo pockets, boot cuffs, knee pads.
        const side = socket === SOCKETS.legLeft ? -1 : 1;
        const hip = new THREE.Vector3(side * 0.105, 0.66, 0);
        const axis = new THREE.Vector3(side * 0.0751, -0.99718, 0);
        let reach = 0;
        for (const point of verticesOf(meshes)) {
          const offset = point.clone().sub(hip);
          reach = Math.max(
            reach,
            offset.clone().sub(axis.clone().multiplyScalar(offset.dot(axis))).length(),
          );
        }
        expect(
          reach,
          `${slot}/${item} stands ${reach.toFixed(3)}u off the leg axis`,
        ).toBeLessThanOrEqual(LEG_MAX_RADIUS + 0.03);
      }
    }
  });

  it("leaves no leg garment invisible against the leg it covers", () => {
    // "Draws something different for every option" above compares meshes,
    // vertex counts and boxes, and a garment can clear all three and still be
    // a garment nobody can see: the tights were one tapered sleeve 0.006u off
    // the leg in the wearer's own colour, which on the runner drew a figure
    // indistinguishable from a bare one. Photographed side by side there was
    // no difference to find.
    //
    // A leg garment has to be told from the leg by colour or by shape, so this
    // asks for one of the two: a part in a tint other than the wearer's main
    // colour, or a part standing 0.02u proud of the bare leg. The leg is the
    // one body part whose surface is exactly known here - a tapered capsule
    // about a measured axis - which is what makes the second branch a
    // measurement rather than an estimate.
    const standoff = 0.02;
    for (const { slot, item } of NON_EMPTY) {
      if (slot !== "legwear" && slot !== "footwear") continue;
      const { model } = dressedRaw(only(slot, item));
      const meshes = wardrobeMeshes(model);
      const tints = new Set(
        meshes.map((mesh) => String(mesh.userData["wardrobeTint"])),
      );
      tints.delete("main");
      if (tints.size > 0) continue;
      let proud = 0;
      for (const side of [-1, 1] as const) {
        const socket = side < 0 ? SOCKETS.legLeft : SOCKETS.legRight;
        const hip = new THREE.Vector3(side * 0.105, 0.66, 0);
        const axis = new THREE.Vector3(side * 0.0751, -0.99718, 0);
        for (const point of verticesOf(wardrobeMeshes(model, socket))) {
          const offset = point.clone().sub(hip);
          const along = Math.min(0.373, Math.max(0, offset.dot(axis)));
          const leg = 0.083 + (0.067 - 0.083) * (along / 0.373);
          proud = Math.max(
            proud,
            offset.clone().sub(axis.clone().multiplyScalar(along)).length() - leg,
          );
        }
      }
      expect(
        proud,
        `${slot}/${item} is the wearer's own colour and stands ${proud.toFixed(3)}u off the leg, so it draws a bare leg`,
      ).toBeGreaterThanOrEqual(standoff);
    }
  });

  it("never lifts a leg-mounted waistband into the hem above it", () => {
    // The shin garments swing out in z at the extremes and are covered by the
    // volume check above. What this pins is the waist itself, which stays under
    // the hem however far the leg travels because it never leaves the hip.
    for (const legwear of [
      "kilt",
      "jeans",
      "shorts",
      "joggers",
      "tights",
      "cargo",
    ] as const) {
      const { model } = dressedRaw({ ...DEFAULT_AVATAR, legwear });
      let highest = -Infinity;
      for (const fraction of poses()) {
        for (const [name, limit] of Object.entries(SWEEP)) {
          const node = model.getObjectByName(name);
          if (node) node.rotation.x = limit * fraction;
        }
        model.updateMatrixWorld(true);
        for (const socket of [SOCKETS.legLeft, SOCKETS.legRight]) {
          const box = boxOf(wardrobeMeshes(model, socket));
          if (!box.isEmpty()) highest = Math.max(highest, box.max.y);
        }
      }
      expect(
        highest,
        `legwear/${legwear} reaches ${highest.toFixed(3)}u, above the ${TORSO_HEM_Y}u hem`,
      ).toBeLessThan(TORSO_HEM_Y);
    }
  });

  it("stops every collar under the jaw it rises towards", () => {
    // The neck runs 1.235u to 1.390u and disappears into the jaw at the top.
    // A collar is meant to reach for that line - the turtleneck's rolls over
    // just under it - but a collar past it is a collar drawn inside the chin,
    // and the head counter-rotates while the neck does not, so it would swing
    // through rather than sit there.
    const jaw = 1.39;
    for (const { slot, item } of NON_EMPTY) {
      if (slot !== "top" && slot !== "outerwear") continue;
      const box = boxOf(wardrobeMeshes(dressedRaw(only(slot, item)).model, SOCKETS.neck));
      if (box.isEmpty()) continue;
      expect(
        box.max.y,
        `${slot}/${item} collars to ${box.max.y.toFixed(3)}u, into the jaw at ${jaw}u`,
      ).toBeLessThanOrEqual(jaw);
    }
  });

  it("keeps a carried item outboard of the skull it swings past", () => {
    // The victory pose lifts the hand to the side of the head. The hand itself
    // clears the skull by 0.011u; anything in it has to clear it too, and
    // because the swing is about X alone, clearing it once clears it always.
    for (const { slot, item } of NON_EMPTY) {
      if (slot !== "held") continue;
      const { model } = dressedRaw(only(slot, item));
      const box = boxOf(wardrobeMeshes(model, SOCKETS.handRight));
      const inner = Math.min(Math.abs(box.min.x), Math.abs(box.max.x));
      expect(
        inner,
        `held/${item} reaches in to ${inner.toFixed(3)}u, inside the 0.325u skull`,
      ).toBeGreaterThanOrEqual(HELD_MIN_X);
    }
  });

  it("keeps a hat off the eyes it is worn above", () => {
    // A hat band is a ring at radius 0.33 or more and the face it goes round
    // is only 0.29 deep, so a band level with the eyes passes in FRONT of them
    // and the runner wears the hat as a blindfold. Five did, and the whole
    // face slot goes with them: brows and freckles under a blindfold are nine
    // options nobody can see.
    //
    // Measured on vertices rather than on boxes, and that distinction is the
    // test. A crown's box reaches far below the eyes and its geometry does
    // not: it hugs the skull, so by the depth of the eyes it has already drawn
    // back inside them. A box check fails the cap for wearing a crown.
    const rig = rawRunner();
    rig.updateMatrixWorld(true);
    const origin = new THREE.Vector3();
    rig.getObjectByName(SOCKETS.head)!.getWorldPosition(origin);
    const eye = new THREE.Vector3();
    rig.getObjectByName("Eye right__pivot")!.getWorldPosition(eye);
    for (const { slot, item } of NON_EMPTY) {
      if (slot !== "headwear") continue;
      const { model } = dressedRaw(only(slot, item));
      const across = verticesOf(wardrobeMeshes(model, SOCKETS.head)).find(
        (point) =>
          point.z > eye.z + 0.005 && point.y - origin.y < HAT_FACE_MIN_Y,
      );
      expect(
        across && `headwear/${item} at ${describe3(across)}`,
        `a hat reached in front of the eyes at z ${eye.z.toFixed(3)} and hung below ${HAT_FACE_MIN_Y.toFixed(3)}u`,
      ).toBeUndefined();
    }
  });

  it("keeps the head's own garments clear of the shoulders and the shirt", () => {
    // The head counter-rotates about Y and Z, so a beard or a wide brim travels
    // sideways as well as down. What it must not reach is the shoulder caps or
    // anything worn on the torso.
    for (const { slot, item } of NON_EMPTY) {
      if (!["headwear", "face", "eyewear"].includes(slot)) continue;
      const { model } = dressedRaw(only(slot, item));
      const occupied = torsoGarmentVolume(model);
      for (const fraction of poses()) {
        for (const [name, limit] of Object.entries(TWIST)) {
          const node = model.getObjectByName(name);
          if (!node) continue;
          node.rotation.y = limit.y * fraction;
          node.rotation.z = limit.z * fraction;
        }
        model.updateMatrixWorld(true);
        const points = verticesOf(wardrobeMeshes(model, SOCKETS.head));
        const onCap = points.find(insideShoulderCap);
        expect(
          onCap && `${slot}/${item} at ${describe3(onCap)}`,
          "a head garment reached into a shoulder cap",
        ).toBeUndefined();
        const inShirt = points.find(occupied);
        expect(
          inShirt && `${slot}/${item} at ${describe3(inShirt)}`,
          "a head garment reached into the shirt",
        ).toBeUndefined();
      }
    }
  }, 20_000);
});

describe("colour rules", () => {
  it("holds every offered colour off the reserved hazard red", () => {
    for (const entry of AVATAR_COLORS) {
      expect(entry.hex).not.toBe(PALETTE.danger);
      expect(
        colorDistance(entry.hex, PALETTE.danger),
        `${entry.id} crowds the hazard marker`,
      ).toBeGreaterThanOrEqual(MIN_DANGER_DISTANCE);
    }
  });

  it("gates every garment that paints a region of the runner", () => {
    for (const slot of WARDROBE_SLOTS) {
      if (!slot.colorKey) continue;
      for (const entry of AVATAR_COLORS) {
        const rejected = Boolean(colorRejection(slot.colorKey, entry.id, "violet"));
        expect(rejected, `${slot.colorKey}/${entry.id}`).toBe(
          deckContrast(entry.hex).min < MIN_CONTRAST,
        );
      }
    }
  });

  it("leaves every slot with enough colours to be worth opening", () => {
    for (const slot of WARDROBE_SLOTS) {
      if (!slot.colorKey) continue;
      const usable = AVATAR_COLORS.filter(
        (entry) => !colorRejection(slot.colorKey!, entry.id, "violet"),
      );
      expect(usable.length, `${slot.id} has ${usable.length} colours`).toBeGreaterThanOrEqual(12);
    }
  });

  it("only judges a garment colour when the garment is worn", () => {
    // Refusing a runner over the colour of a jacket they are not wearing would
    // be a dead end with nothing on screen to explain it.
    const unwornCream: AvatarConfig = {
      ...DEFAULT_AVATAR,
      colors: { ...DEFAULT_AVATAR.colors, outerwear: "cream" },
    };
    expect(colorRejection("outerwear", "cream", "violet")).not.toBeNull();
    expect(resolveAvatar(unwornCream, 1).outerwear).toBe("none");
    const worn: AvatarConfig = { ...unwornCream, outerwear: "jacket" };
    expect(worn.colors.outerwear).toBe("cream");
  });
});

describe("outfits in a link", () => {
  it("round-trips every slot through the code", () => {
    for (const { slot, item } of NON_EMPTY) {
      const config = normalizeAvatar(only(slot, item));
      expect(avatarFromCode(avatarToCode(config))).toEqual(config);
    }
    for (const entry of AVATAR_COLORS) {
      const config = normalizeAvatar({ ...DEFAULT_AVATAR, body: entry.id, pack: "cream" });
      expect(avatarFromCode(avatarToCode(config))).toEqual(config);
    }
  });

  // Given a real timeout rather than fewer runners. A thousand round-trips is
  // the point - the codec packs nine slots plus seven garment colours into a
  // fixed-width string, and a rare combination that fails to round-trip is
  // exactly what a large random sweep is for. It measured 5.4s against vitest's
  // 5s default while three agents were building concurrently, so it was failing
  // on machine load rather than on a defect. A test that goes red for reasons
  // unrelated to the code is worse than a slow one: it teaches people to ignore
  // the colour.
  it("round-trips a thousand random runners", () => {
    let seed = 12345;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      const config = randomAvatar(random);
      expect(avatarFromCode(avatarToCode(config))).toEqual(config);
    }
  }, 30_000);

  it("costs one character per slot", () => {
    const code = avatarToCode(DEFAULT_AVATAR);
    expect(code).toHaveLength(WARDROBE_SLOTS.length + WARDROBE_SLOTS.filter((s) => s.colorKey).length + 2);
    expect(code).toMatch(/^[0-9A-Za-z_-]+$/);
  });

  it("fills the rest in from defaults when a code is short", () => {
    // Forward compatibility in the direction that matters: a link written
    // before a slot existed still opens once the slot ships.
    const full = avatarToCode({ ...DEFAULT_AVATAR, body: "pine", pack: "butter" });
    const short = avatarFromCode(full.slice(0, 4));
    expect(short).not.toBeNull();
    expect(short!.body).toBe("pine");
    expect(short!.pack).toBe("butter");
    expect(short!.top).toBe(DEFAULT_AVATAR.top);
  });

  it("refuses a code describing something the wardrobe does not have", () => {
    expect(avatarFromCode("~~~")).toBeNull();
    expect(avatarFromCode("")).toBeNull();
    // Index 40 of a twenty-colour palette.
    expect(avatarFromCode("e0000")).toBeNull();
  });

  it("randomises into something wearable every time", () => {
    let seed = 99;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const config = randomAvatar(random);
      expect(
        colorRejection("body", config.body, config.body),
        `random runner ${attempt} was refused`,
      ).toBeNull();
      expect(colorRejection("pack", config.pack, config.body)).toBeNull();
    }
  });
});
