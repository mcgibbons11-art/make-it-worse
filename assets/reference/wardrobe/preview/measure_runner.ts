// Measure the runner the wardrobe has to fit.
//
// Every garment spec needs three numbers the runner factory does not publish: where each
// mount socket actually sits in the factory's own frame, how far the body surface reaches at
// every height, and how much of that moves when the run cycle plays. Reading them off the
// factory source is guesswork - the generator emits nested pivot groups with authored rest
// rotations, so a socket's local position is not its position on the body. This builds the
// model in a real browser (the factory rasterises canvas textures, so node alone cannot) and
// reports the measured values.
//
// Nothing in the game imports this. It is review scaffolding for the img2threejs loop.

import * as THREE from 'three';
import { createMAKEITWORSERunnerModel } from '../../../../components/game/models/createRunnerModel.js';

// PlayerVisual.fitToPlaySpace normalises the factory model to the physics capsule's height.
// Duplicated rather than imported because that module is a React client component.
const CAPSULE_RADIUS = 0.38;
const CAPSULE_HALF_HEIGHT = 0.55;
const TARGET_HEIGHT = (CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS) * 2;

const MOUNT_SOCKETS = [
  'Head mass__pivot',
  'Torso__pivot',
  'Arm left__pivot',
  'Arm right__pivot',
  'Hand left__pivot',
  'Hand right__pivot',
  'Leg left__pivot',
  'Leg right__pivot',
  'Sneaker left__pivot',
  'Sneaker right__pivot',
  'Shoulder cap left__pivot',
  'Shoulder cap right__pivot',
  'Neck__pivot',
];

const model = createMAKEITWORSERunnerModel({ textureSize: 64, qualityPriority: 'balanced' });
model.updateMatrixWorld(true);

function isStub(mesh: THREE.Mesh): boolean {
  return (mesh.material as THREE.Material | undefined)?.opacity === 0;
}

function isVisibleMesh(object: THREE.Object3D): object is THREE.Mesh {
  const mesh = object as THREE.Mesh;
  return Boolean(mesh.isMesh) && !isStub(mesh);
}

function boxOf(root: THREE.Object3D, visibleOnly: boolean) {
  const box = new THREE.Box3();
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (visibleOnly && !isVisibleMesh(mesh)) return;
    box.expandByObject(mesh);
  });
  if (box.isEmpty()) return null;
  const size = box.getSize(new THREE.Vector3());
  const round = (v: number) => Number(v.toFixed(4));
  return {
    min: box.min.toArray().map(round),
    max: box.max.toArray().map(round),
    size: size.toArray().map(round),
  };
}

// The factory's own bounding box is poisoned by invisible 1x1x1 transform-group stubs; report
// them explicitly so the caller can see the difference rather than trusting one number.
const stubs: { name: string; size: number[] }[] = [];
model.traverse((child) => {
  const mesh = child as THREE.Mesh;
  if (!mesh.isMesh) return;
  if (!isStub(mesh)) return;
  const box = new THREE.Box3().setFromObject(mesh);
  stubs.push({ name: mesh.name, size: box.getSize(new THREE.Vector3()).toArray().map((v) => Number(v.toFixed(4))) });
});

const rawBox = boxOf(model, false)!;
const visibleBox = boxOf(model, true)!;
const fitScale = TARGET_HEIGHT / visibleBox.size[1]!;

// Socket report. `worldRest` is where the socket sits with the model at its authored rest
// pose, which is what a garment's local offset is measured against.
const sockets = MOUNT_SOCKETS.map((name) => {
  const node = model.getObjectByName(name);
  if (!node) return { name, found: false };
  const worldPosition = new THREE.Vector3();
  const worldQuaternion = new THREE.Quaternion();
  const worldScale = new THREE.Vector3();
  node.matrixWorld.decompose(worldPosition, worldQuaternion, worldScale);
  const round = (v: number) => Number(v.toFixed(4));
  const euler = new THREE.Euler().setFromQuaternion(worldQuaternion, 'XYZ');
  return {
    name,
    found: true,
    parent: node.parent?.name ?? null,
    children: node.children.map((child) => child.name),
    localPosition: node.position.toArray().map(round),
    localRotation: node.rotation.toArray().slice(0, 3).map((v) => round(v as number)),
    localScale: node.scale.toArray().map(round),
    worldPosition: worldPosition.toArray().map(round),
    worldRotation: [euler.x, euler.y, euler.z].map(round),
    worldScale: worldScale.toArray().map(round),
    subtreeBox: boxOf(node, true),
  };
});

// Body envelope. A garment clears the body when its inner surface sits outside this at every
// height it covers, so sample the actual vertices rather than trusting part boxes: the torso
// is a lathe and its widest ring is nowhere near its box corner.
function envelope(step: number) {
  const buckets = new Map<number, { maxR: number; maxX: number; maxZ: number; count: number }>();
  const vertex = new THREE.Vector3();
  model.traverse((child) => {
    if (!isVisibleMesh(child)) return;
    const mesh = child as THREE.Mesh;
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!position) return;
    for (let i = 0; i < position.count; i += 1) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      const key = Math.round(vertex.y / step);
      const radius = Math.hypot(vertex.x, vertex.z);
      const bucket = buckets.get(key) ?? { maxR: 0, maxX: 0, maxZ: 0, count: 0 };
      bucket.maxR = Math.max(bucket.maxR, radius);
      bucket.maxX = Math.max(bucket.maxX, Math.abs(vertex.x));
      bucket.maxZ = Math.max(bucket.maxZ, Math.abs(vertex.z));
      bucket.count += 1;
      buckets.set(key, bucket);
    }
  });
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, bucket]) => ({
      y: Number((key * step).toFixed(3)),
      maxRadius: Number(bucket.maxR.toFixed(4)),
      maxAbsX: Number(bucket.maxX.toFixed(4)),
      maxAbsZ: Number(bucket.maxZ.toFixed(4)),
      vertices: bucket.count,
    }));
}

// Per-part boxes, so a garment author can size a sleeve against the arm it wraps rather than
// against the whole figure.
const partBoxes: Record<string, unknown> = {};
model.traverse((child) => {
  if (!isVisibleMesh(child)) return;
  if (!child.name) return;
  partBoxes[child.name] = boxOf(child, true);
});

// Swept envelope. The run cycle drives ten named pivots; a garment that clears the rest pose
// can still be speared by an arm at full swing, so re-measure the body at the extremes the
// animation actually reaches. Ranges read from PlayerVisual's useFrame.
const PIVOTS: Record<string, string> = {
  leftArm: 'Arm left__pivot', rightArm: 'Arm right__pivot',
  leftHand: 'Hand left__pivot', rightHand: 'Hand right__pivot',
  leftLeg: 'Leg left__pivot', rightLeg: 'Leg right__pivot',
  leftFoot: 'Sneaker left__pivot', rightFoot: 'Sneaker right__pivot',
  head: 'Head mass__pivot', torso: 'Torso__pivot',
};
const restRotations = new Map<string, THREE.Euler>();
for (const [, name] of Object.entries(PIVOTS)) {
  const node = model.getObjectByName(name);
  if (node) restRotations.set(name, node.rotation.clone());
}

function applyPose(swing: number, armLift: number, effort: number, airborne: boolean) {
  const spin = (key: string, x: number, y = 0, z = 0) => {
    const name = PIVOTS[key]!;
    const node = model.getObjectByName(name);
    const base = restRotations.get(name);
    if (node && base) node.rotation.set(base.x + x, base.y + y, base.z + z);
  };
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
  spin('torso', 0, -swing * 0.16 * effort, Math.sin(swing) * 0.05 * effort);
  spin('head', 0, swing * 0.1 * effort, -Math.sin(swing) * 0.03 * effort);
  model.updateMatrixWorld(true);
}

// The named poses the game can actually put the runner in, worst case per mode.
const POSES: { id: string; swing: number; armLift: number; effort: number; airborne: boolean }[] = [
  { id: 'rest', swing: 0, armLift: 0, effort: 0, airborne: false },
  { id: 'run-forward', swing: 0.72, armLift: 0, effort: 1, airborne: false },
  { id: 'run-back', swing: -0.72, armLift: 0, effort: 1, airborne: false },
  { id: 'jump-rise', swing: -0.75, armLift: -0.8, effort: 1, airborne: true },
  { id: 'jump-fall', swing: 0.6, armLift: -0.8, effort: 1, airborne: true },
  { id: 'stun-forward', swing: 1.15, armLift: -1.1, effort: 1, airborne: false },
  { id: 'stun-back', swing: -1.15, armLift: -1.1, effort: 1, airborne: false },
  { id: 'victory', swing: -2.35, armLift: -0.35, effort: 1, airborne: false },
];

const poseReport = POSES.map((pose) => {
  applyPose(pose.swing, pose.armLift, pose.effort, pose.airborne);
  const box = boxOf(model, true)!;
  const socketPositions: Record<string, number[]> = {};
  for (const name of MOUNT_SOCKETS) {
    const node = model.getObjectByName(name);
    if (!node) continue;
    const position = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld);
    socketPositions[name] = position.toArray().map((v) => Number(v.toFixed(4)));
  }
  return { ...pose, box, socketPositions };
});

applyPose(0, 0, 0, false);

const globals = window as unknown as Record<string, unknown>;
globals.__measurement = {
  target: 'make-it-worse-runner',
  factoryFrame: {
    rawBox,
    visibleBox,
    invisibleStubs: stubs,
    stubPoisonsWidth: Number((rawBox.size[0]! - visibleBox.size[0]!).toFixed(4)),
  },
  playSpace: {
    targetHeight: TARGET_HEIGHT,
    fitScale: Number(fitScale.toFixed(6)),
    fittedWidth: Number((visibleBox.size[0]! * fitScale).toFixed(4)),
    fittedDepth: Number((visibleBox.size[2]! * fitScale).toFixed(4)),
    widthBudget: 0.94,
    headroomWorldU: Number((0.94 - visibleBox.size[0]! * fitScale).toFixed(4)),
    headroomFactoryU: Number(((0.94 - visibleBox.size[0]! * fitScale) / fitScale).toFixed(4)),
    landingSquashWidthMultiplier: Number((1 / Math.sqrt(1 - 0.22)).toFixed(4)),
  },
  sockets,
  partBoxes,
  envelope: envelope(0.05),
  poses: poseReport,
};
globals.__measurementReady = true;
