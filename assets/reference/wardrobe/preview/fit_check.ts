// Does this garment still fit once the runner starts moving?
//
// A prop only has to look like its reference. A garment has to look like its reference AND
// stay on a body that swings its arms 0.72 rad each way, counter-twists its torso, rotates its
// ankles and gets squashed 22% on landing. Reviewing a garment at rest proves nothing about
// any of that, so this measures the two failures that actually happen:
//
//   bodyEscape  - a body surface that the garment covers at rest pokes out through it in a
//                 pose. This is the visible one: an elbow through a sleeve, a skull through a
//                 cap. Detected by casting each body sample along its own outward normal and
//                 asking whether it still hits the garment.
//   garmentSink - a garment vertex ends up inside the body, so the garment is swallowed rather
//                 than worn. Detected by ray parity against the body's closed primitives.
//
// Both are reported per pose with the pose that produced the worst value, because a garment
// that fails only on `victory` is a different problem from one that fails while running.
//
// Nothing in the game imports this. It is review scaffolding for the img2threejs loop.

import * as THREE from 'three';

export type PoseName =
  | 'rest' | 'run-forward' | 'run-back' | 'jump-rise' | 'jump-fall'
  | 'stun-forward' | 'stun-back' | 'victory';

/** Ranges read straight out of PlayerVisual's useFrame, worst case per mode. */
export const POSES: { id: PoseName; swing: number; armLift: number; effort: number; airborne: boolean }[] = [
  { id: 'rest', swing: 0, armLift: 0, effort: 0, airborne: false },
  { id: 'run-forward', swing: 0.72, armLift: 0, effort: 1, airborne: false },
  { id: 'run-back', swing: -0.72, armLift: 0, effort: 1, airborne: false },
  { id: 'jump-rise', swing: -0.75, armLift: -0.8, effort: 1, airborne: true },
  { id: 'jump-fall', swing: 0.6, armLift: -0.8, effort: 1, airborne: true },
  { id: 'stun-forward', swing: 1.15, armLift: -1.1, effort: 1, airborne: false },
  { id: 'stun-back', swing: -1.15, armLift: -1.1, effort: 1, airborne: false },
  { id: 'victory', swing: -2.35, armLift: -0.35, effort: 1, airborne: false },
];

const PIVOTS: Record<string, string> = {
  leftArm: 'Arm left__pivot', rightArm: 'Arm right__pivot',
  leftHand: 'Hand left__pivot', rightHand: 'Hand right__pivot',
  leftLeg: 'Leg left__pivot', rightLeg: 'Leg right__pivot',
  leftFoot: 'Sneaker left__pivot', rightFoot: 'Sneaker right__pivot',
  head: 'Head mass__pivot', torso: 'Torso__pivot',
};

/** PlayerVisual scales the outer group by 1/sqrt(squash) in x and z on a landing. */
export const LANDING_SQUASH = 0.78;

export class Poser {
  private readonly rest = new Map<string, THREE.Euler>();

  constructor(private readonly runner: THREE.Object3D) {
    for (const name of Object.values(PIVOTS)) {
      const node = runner.getObjectByName(name);
      if (node) this.rest.set(name, node.rotation.clone());
    }
  }

  apply(pose: { swing: number; armLift: number; effort: number; airborne: boolean }): void {
    const spin = (key: string, x: number, y = 0, z = 0) => {
      const name = PIVOTS[key]!;
      const node = this.runner.getObjectByName(name);
      const base = this.rest.get(name);
      if (node && base) node.rotation.set(base.x + x, base.y + y, base.z + z);
    };
    const { swing, armLift, effort, airborne } = pose;
    const legSwing = swing * 0.62;
    const ankle = (legPhase: number) =>
      airborne ? -0.45 : -legPhase * 0.55 + Math.max(0, legPhase) * 0.25;
    spin('leftLeg', -legSwing);
    spin('rightLeg', legSwing);
    spin('leftFoot', ankle(-legSwing));
    spin('rightFoot', ankle(legSwing));
    spin('leftArm', swing + armLift);
    spin('rightArm', -swing + armLift);
    spin('leftHand', -swing * 0.3);
    spin('rightHand', swing * 0.3);
    // The cadence-driven terms peak with the swing, so the extreme of the swing is the extreme
    // of the twist too; using sin(swing) here reproduces the sign without the clock.
    spin('torso', 0, -swing * 0.16 * effort, Math.sin(swing) * 0.05 * effort);
    spin('head', 0, swing * 0.1 * effort, -Math.sin(swing) * 0.03 * effort);
    this.runner.updateMatrixWorld(true);
  }
}

function isStub(mesh: THREE.Mesh): boolean {
  return (mesh.material as THREE.Material | undefined)?.opacity === 0;
}

export function visibleMeshes(root: THREE.Object3D, filter?: (mesh: THREE.Mesh) => boolean): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || isStub(mesh)) return;
    if (filter && !filter(mesh)) return;
    out.push(mesh);
  });
  return out;
}

export function boundsOf(meshes: THREE.Mesh[]): { min: number[]; max: number[]; size: number[] } {
  const box = new THREE.Box3();
  for (const mesh of meshes) box.expandByObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  const round = (v: number) => Number(v.toFixed(4));
  return { min: box.min.toArray().map(round), max: box.max.toArray().map(round), size: size.toArray().map(round) };
}

type Sample = { position: THREE.Vector3; normal: THREE.Vector3 };

/**
 * World-space surface samples with outward normals. Subsampled to `budget` because the test
 * runs eight poses and a raycast per sample, and a dense sample of an already smooth primitive
 * buys nothing a coarse one misses.
 */
function surfaceSamples(meshes: THREE.Mesh[], budget: number): Sample[] {
  const total = meshes.reduce((sum, mesh) => sum + (mesh.geometry.getAttribute('position')?.count ?? 0), 0);
  const stride = Math.max(1, Math.ceil(total / budget));
  const samples: Sample[] = [];
  const normalMatrix = new THREE.Matrix3();
  let index = 0;
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    const normal = mesh.geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
    if (!position) continue;
    normalMatrix.getNormalMatrix(mesh.matrixWorld);
    for (let i = 0; i < position.count; i += 1, index += 1) {
      if (index % stride !== 0) continue;
      const point = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      const direction = normal
        ? new THREE.Vector3().fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize()
        : point.clone().setY(0).normalize();
      samples.push({ position: point, normal: direction });
    }
  }
  return samples;
}

/**
 * Inside/outside against the body's closed primitives by ray parity, voted over three
 * directions. One direction is enough in theory and wrong in practice: a ray that grazes a
 * shared edge between two adjacent parts counts one crossing instead of two.
 */
const PARITY_DIRECTIONS = [
  new THREE.Vector3(0.7071, 0.5, 0.5).normalize(),
  new THREE.Vector3(-0.6, 0.3, 0.74).normalize(),
  new THREE.Vector3(0.15, -0.9, 0.4).normalize(),
];

function insideBody(point: THREE.Vector3, body: THREE.Mesh[], raycaster: THREE.Raycaster): boolean {
  let votes = 0;
  for (const direction of PARITY_DIRECTIONS) {
    raycaster.set(point, direction);
    const hits = raycaster.intersectObjects(body, false);
    if (hits.length % 2 === 1) votes += 1;
  }
  return votes >= 2;
}

export interface FitOptions {
  /** Body meshes this garment is meant to cover, by mesh name. */
  covers: string[];
  /** Samples per side of the test. 600 each keeps eight poses under a second. */
  bodyBudget?: number;
  garmentBudget?: number;
  /** How far a covered body sample may travel before it is treated as having escaped. */
  maxSearch?: number;
}

export interface PoseFit {
  pose: PoseName;
  coveredSamples: number;
  escapedSamples: number;
  minClearance: number;
  medianClearance: number;
  sunkGarmentVertices: number;
  garmentVertices: number;
  runnerBox: { min: number[]; max: number[]; size: number[] };
  dressedBox: { min: number[]; max: number[]; size: number[] };
  widthContribution: number;
}

/**
 * Run the whole fit check. `garment` must already be parented into the runner at its mount
 * socket, because the point of the test is to exercise the transform chain the game will use,
 * not an idealised one.
 */
export function checkFit(
  runner: THREE.Object3D,
  garment: THREE.Object3D,
  options: FitOptions,
): { poses: PoseFit[]; worst: { escape: PoseFit; clearance: PoseFit; width: PoseFit } } {
  const bodyBudget = options.bodyBudget ?? 600;
  const garmentBudget = options.garmentBudget ?? 600;
  const maxSearch = options.maxSearch ?? 0.35;

  const garmentMeshes = visibleMeshes(garment);
  const bodyMeshes = visibleMeshes(runner, (mesh) => !garmentMeshes.includes(mesh));
  const coveredMeshes = bodyMeshes.filter((mesh) => options.covers.includes(mesh.name));
  if (coveredMeshes.length === 0) {
    throw new Error(`fit check covers nothing: none of [${options.covers.join(', ')}] is a body mesh`);
  }

  // Raycasting an inner face needs the garment double sided for the duration of the test; the
  // shipped material stays whatever the spec says.
  const restoreSide = garmentMeshes.map((mesh) => {
    const material = mesh.material as THREE.Material;
    const previous = material.side;
    material.side = THREE.DoubleSide;
    return () => { material.side = previous; };
  });

  const poser = new Poser(runner);
  const raycaster = new THREE.Raycaster();
  const results: PoseFit[] = [];

  // Which body samples the garment covers is decided once, at rest, and then held fixed: a
  // sample that stops being covered is exactly the failure being measured, so recomputing the
  // covered set per pose would define the bug away.
  poser.apply(POSES[0]!);
  const restSamples = surfaceSamples(coveredMeshes, bodyBudget);
  const coveredAtRest: boolean[] = restSamples.map((sample) => {
    raycaster.set(sample.position.clone().addScaledVector(sample.normal, 1e-4), sample.normal);
    raycaster.far = maxSearch;
    return raycaster.intersectObjects(garmentMeshes, false).length > 0;
  });
  const coveredIndices = coveredAtRest.flatMap((covered, index) => (covered ? [index] : []));

  for (const pose of POSES) {
    poser.apply(pose);
    // Re-sample rather than transform the rest samples: the covered meshes are children of the
    // pivots being rotated, so their world positions have moved.
    const samples = surfaceSamples(coveredMeshes, bodyBudget);
    let escaped = 0;
    const clearances: number[] = [];
    for (const index of coveredIndices) {
      const sample = samples[index];
      if (!sample) continue;
      raycaster.set(sample.position.clone().addScaledVector(sample.normal, 1e-4), sample.normal);
      raycaster.far = maxSearch;
      const hits = raycaster.intersectObjects(garmentMeshes, false);
      if (hits.length === 0) escaped += 1;
      else clearances.push(hits[0]!.distance);
    }
    clearances.sort((a, b) => a - b);

    raycaster.far = Infinity;
    const garmentSamples = surfaceSamples(garmentMeshes, garmentBudget);
    let sunk = 0;
    for (const sample of garmentSamples) {
      if (insideBody(sample.position, bodyMeshes, raycaster)) sunk += 1;
    }

    const runnerBox = boundsOf(bodyMeshes);
    const dressedBox = boundsOf([...bodyMeshes, ...garmentMeshes]);
    results.push({
      pose: pose.id,
      coveredSamples: coveredIndices.length,
      escapedSamples: escaped,
      minClearance: clearances.length ? Number(clearances[0]!.toFixed(4)) : Number.NaN,
      medianClearance: clearances.length
        ? Number(clearances[Math.floor(clearances.length / 2)]!.toFixed(4)) : Number.NaN,
      sunkGarmentVertices: sunk,
      garmentVertices: garmentSamples.length,
      runnerBox,
      dressedBox,
      widthContribution: Number((dressedBox.size[0]! - runnerBox.size[0]!).toFixed(4)),
    });
  }

  poser.apply(POSES[0]!);
  for (const restore of restoreSide) restore();

  const pick = (compare: (a: PoseFit, b: PoseFit) => number) =>
    results.reduce((worst, item) => (compare(item, worst) > 0 ? item : worst), results[0]!);

  return {
    poses: results,
    worst: {
      escape: pick((a, b) => a.escapedSamples - b.escapedSamples),
      clearance: pick((a, b) => (b.minClearance || 0) - (a.minClearance || 0)),
      width: pick((a, b) => a.widthContribution - b.widthContribution),
    },
  };
}
