// Standalone review harness for the img2threejs sculpt loop on the runner character. It is
// scaffolding for the pass reviews only - nothing in the game imports it. Like the toaster
// harness it fits the camera so the rendered silhouette lands on the same bounding box as the
// reference render, because diagnose_render.py compares the two masks in place.

import * as THREE from 'three';
import {
  createMAKEITWORSERunnerModel,
  createMAKEITWORSERunnerLookDevLights,
  configureMAKEITWORSERunnerRenderer,
} from '../../../../components/game/models/createRunnerModel.js';

type ViewName = 'reference' | 'front' | 'right' | 'threequarter' | 'rear' | 'grazing';
type LightingMode = 'neutral' | 'grazing' | 'reference' | 'review';

// Reference silhouette bounding box in NDC. Source image is 1086x1448 and the figure occupies
// x 161..924, y 102..1337, measured by the same colour-segmented scan that drove the spec.
const REFERENCE_NDC = { minX: -0.7035, maxX: 0.7017, minY: -0.8467, maxY: 0.8591 };
const RENDER_WIDTH = 1086;
const RENDER_HEIGHT = 1448;

const VIEWS: Record<ViewName, { azimuthDeg: number; elevationDeg: number; lighting: LightingMode }> = {
  reference: { azimuthDeg: 0.0, elevationDeg: 0.0, lighting: 'review' },
  front: { azimuthDeg: 0.0, elevationDeg: 4.0, lighting: 'neutral' },
  right: { azimuthDeg: 90.0, elevationDeg: 4.0, lighting: 'neutral' },
  threequarter: { azimuthDeg: 38.0, elevationDeg: 10.0, lighting: 'neutral' },
  rear: { azimuthDeg: 180.0, elevationDeg: 4.0, lighting: 'neutral' },
  grazing: { azimuthDeg: 16.0, elevationDeg: 3.0, lighting: 'grazing' },
};

const params = new URLSearchParams(window.location.search);
const view = (params.get('view') ?? 'reference') as ViewName;
const clay = params.get('mode') === 'clay';
const base = VIEWS[view] ?? VIEWS.reference;
const settings = {
  azimuthDeg: Number(params.get('azim') ?? base.azimuthDeg),
  elevationDeg: Number(params.get('elev') ?? base.elevationDeg),
  lighting: (params.get('light') ?? base.lighting) as LightingMode,
};

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(RENDER_WIDTH, RENDER_HEIGHT);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
configureMAKEITWORSERunnerRenderer(renderer);
document.body.appendChild(renderer.domElement);
// The factory sets ACES filmic, which is right for a view-dependent metal but wrong for
// judging this figure's albedo: ACES compresses the bright cream far more than the mid purple,
// so a colour comparison under it measures the tone curve rather than the material. The
// reference itself carries no ACES grade (its brightest face pixel is 0.901 relative luminance
// and nothing clips), so the reference-matched review renders with neutral tone mapping. Pass
// tone=aces to inspect the shipped curve.
if ((params.get('tone') ?? (settings.lighting === 'review' ? 'neutral' : 'aces')) === 'neutral') {
  renderer.toneMapping = THREE.NoToneMapping;
}
renderer.toneMappingExposure = Number(params.get('exposure') ?? 1);

const scene = new THREE.Scene();
// Measured background of the reference: (219,219,219) within 2/255 at all four corners.
scene.background = new THREE.Color(0xdbdbdb);

const model = createMAKEITWORSERunnerModel({ textureSize: Number(params.get('tex') ?? 512) });
scene.add(model);

// Limb pose for the interaction review: drive the same nodes the game animation drives.
const swing = THREE.MathUtils.degToRad(Number(params.get('swing') ?? 0));
const runtime = model.userData.sculptRuntime as {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
};
if (swing !== 0) {
  const pairs: [string, number][] = [['arm-l', 1], ['arm-r', -1], ['leg-l', -0.6], ['leg-r', 0.6]];
  for (const [id, factor] of pairs) {
    const node = runtime.nodes[id];
    if (node) node.rotation.x = swing * factor;
  }
}

// The reference is a soft studio render with a dominant fill: sampled around the face at a
// fixed radius its luminance runs 0.602 under the chin to 0.901 at the crown, so fill sits at
// about 67% of key, and there is no rim (the silhouette edge reads darker than the interior).
function createReviewRig(): THREE.Group {
  const rig = new THREE.Group();
  rig.name = 'reference-matched review rig';
  const hemi = new THREE.HemisphereLight(0xfff3e2, 0xd8d2c8, Number(params.get('hemi') ?? 2.98));
  rig.add(hemi);
  const key = new THREE.DirectionalLight(0xfff1dc, Number(params.get('key') ?? 1.21));
  key.position.set(1.2, 7.0, 4.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  rig.add(key);
  const bounce = new THREE.DirectionalLight(0xe8eaf2, Number(params.get('bounce') ?? 0.33));
  bounce.position.set(-2.0, -1.5, 3.0);
  rig.add(bounce);
  return rig;
}

scene.add(
  settings.lighting === 'review'
    ? createReviewRig()
    : createMAKEITWORSERunnerLookDevLights(settings.lighting),
);

if (clay) {
  const clayMaterial = new THREE.MeshStandardMaterial({ color: 0xbdbdbd, roughness: 0.85, metalness: 0.0 });
  model.traverse((child) => {
    const mesh = child as THREE.Mesh;
    // group nodes ship at opacity 0; keep them invisible in clay too or they read as boxes
    if (mesh.isMesh && (mesh.material as THREE.Material | undefined)?.opacity !== 0) {
      mesh.material = clayMaterial;
    }
  });
}

const camera = new THREE.PerspectiveCamera(18, RENDER_WIDTH / RENDER_HEIGHT, 0.05, 60);

function surfacePoints(root: THREE.Object3D): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  root.updateMatrixWorld(true);
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    // the four transform-group boxes are invisible; including them in the fit would size the
    // camera to a mass the reference silhouette never shows.
    if ((mesh.material as THREE.Material | undefined)?.opacity === 0) return;
    const attribute = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!attribute) return;
    for (let i = 0; i < attribute.count; i += 1) {
      points.push(new THREE.Vector3().fromBufferAttribute(attribute, i).applyMatrix4(mesh.matrixWorld));
    }
  });
  return points;
}

function ndcBounds(points: THREE.Vector3[], activeCamera: THREE.PerspectiveCamera) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const projected = new THREE.Vector3();
  for (const point of points) {
    projected.copy(point).project(activeCamera);
    minX = Math.min(minX, projected.x);
    maxX = Math.max(maxX, projected.x);
    minY = Math.min(minY, projected.y);
    maxY = Math.max(maxY, projected.y);
  }
  return { minX, minY, maxX, maxY };
}

// Match the render's projected bounding box to a target box. Distance is solved on HEIGHT, not
// on area. The toaster harness solves on area because its silhouette is meant to match the
// reference outline; this figure's arm span is deliberately 0.815u against the reference's
// 1.173u, so an area fit would scale the figure up until its height overshot the frame and
// every landmark comparison would be measuring that scale error instead of the real one. A
// height fit puts crown and ground on the reference's own crown and ground, and the narrower
// span then shows up as exactly what it is.
function fitCamera(target: { minX: number; maxX: number; minY: number; maxY: number }): void {
  const points = surfacePoints(model);
  const azimuth = THREE.MathUtils.degToRad(settings.azimuthDeg);
  const elevation = THREE.MathUtils.degToRad(settings.elevationDeg);
  const direction = new THREE.Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation),
  );
  const box = new THREE.Box3().setFromPoints(points);
  const look = box.getCenter(new THREE.Vector3());
  let distance = box.getSize(new THREE.Vector3()).length() * 2.6;

  const wantHeight = target.maxY - target.minY;
  const wantCenterX = (target.minX + target.maxX) / 2;
  const wantCenterY = (target.minY + target.maxY) / 2;
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();

  for (let iteration = 0; iteration < 60; iteration += 1) {
    camera.position.copy(look).addScaledVector(direction, distance);
    camera.lookAt(look);
    camera.near = Math.max(0.02, distance * 0.2);
    camera.far = distance * 3.0;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    const bounds = ndcBounds(points, camera);
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    if (!Number.isFinite(width) || width <= 0 || height <= 0) break;

    distance *= height / wantHeight;

    const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * distance;
    const halfWidth = halfHeight * camera.aspect;
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    look.addScaledVector(right, ((bounds.minX + bounds.maxX) / 2 - wantCenterX) * halfWidth);
    look.addScaledVector(up, ((bounds.minY + bounds.maxY) / 2 - wantCenterY) * halfHeight);
  }

  camera.position.copy(look).addScaledVector(direction, distance);
  camera.lookAt(look);
  camera.near = Math.max(0.02, distance * 0.2);
  camera.far = distance * 3.0;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

// Non-reference views are judged for self-consistency, never against the reference angle, so
// they simply fill a fixed share of the frame.
fitCamera(view === 'reference' ? REFERENCE_NDC : { minX: -0.7, maxX: 0.7, minY: -0.85, maxY: 0.85 });

renderer.render(scene, camera);

// Runtime dump of the built part tree for stage4_review/check_part_coverage.py.
function partsManifest() {
  const named = new Set<THREE.Object3D>();
  const parts = Object.entries(runtime.meshes).map(([id, mesh]) => {
    named.add(mesh);
    const position = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex();
    return {
      name: id,
      kind: 'part',
      module: (mesh.userData.sculptComponent as { level?: string } | undefined)?.level ?? 'meso',
      triangles: Math.floor((index ? index.count : (position?.count ?? 0)) / 3),
    };
  });
  let unnamedMeshes = 0;
  model.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!named.has(mesh)) unnamedMeshes += 1;
  });
  return { model: 'make-it-worse-runner', parts, unnamedMeshes, integralMeshes: parts.length };
}

// Measured silhouette of the built model, so the 0.94u gameplay cap can be checked from the
// same render the vision review looks at rather than trusted from the spec.
function silhouette() {
  const points = surfacePoints(model);
  const box = new THREE.Box3().setFromPoints(points);
  const size = box.getSize(new THREE.Vector3());
  return {
    widthX: Number(size.x.toFixed(4)),
    heightY: Number(size.y.toFixed(4)),
    depthZ: Number(size.z.toFixed(4)),
    minY: Number(box.min.y.toFixed(4)),
    maxY: Number(box.max.y.toFixed(4)),
  };
}

const globals = window as unknown as Record<string, unknown>;
globals.__runnerParts = partsManifest();
globals.__runnerStats = {
  view,
  clay,
  swingDeg: Number(params.get('swing') ?? 0),
  triangles: renderer.info.render.triangles,
  drawCalls: renderer.info.render.calls,
  programs: renderer.info.programs?.length ?? 0,
  cameraPosition: camera.position.toArray().map((v) => Number(v.toFixed(4))),
  silhouette: silhouette(),
  nodeIds: Object.keys(runtime.nodes),
};
globals.__THREE__ = THREE;
globals.__runnerModel = model;
// Two bounding boxes: one over every mesh the factory emits, one over only the meshes that are
// actually visible. They differ, and any caller that normalises the model by its bounds needs
// the second one.
globals.__bbox = (includeInvisible: boolean) => {
  const box = new THREE.Box3();
  model.updateMatrixWorld(true);
  model.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!includeInvisible && (mesh.material as THREE.Material | undefined)?.opacity === 0) return;
    box.expandByObject(mesh);
  });
  const size = box.getSize(new THREE.Vector3());
  return {
    minY: +box.min.y.toFixed(4), maxY: +box.max.y.toFixed(4),
    width: +size.x.toFixed(4), height: +size.y.toFixed(4), depth: +size.z.toFixed(4),
  };
};
globals.__runnerReady = true;
