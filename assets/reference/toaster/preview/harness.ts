// Standalone review harness for the img2threejs sculpt loop. It is scaffolding for the
// pass reviews only - nothing in the game imports it. The one thing it does that a normal
// viewer does not is fit the camera so the rendered silhouette lands on the same bounding
// box as the reference photo, because diagnose_render.py compares the two masks in place.

import * as THREE from 'three';
import {
  createApartmentToasterModel,
  createApartmentToasterLookDevLights,
  createApartmentToasterEnvironment,
  configureApartmentToasterRenderer,
} from '../../../../components/game/models/createToasterModel.js';

type ViewName = 'reference' | 'front' | 'right' | 'top' | 'rear' | 'grazing';
type LightingMode = 'neutral' | 'grazing' | 'reference' | 'review';

// Reference silhouette bounding box, normalised to the 1254px square source image.
const REFERENCE_NDC = { minX: -0.8469, maxX: 0.8325, minY: -0.8437, maxY: 0.7927 };

const VIEWS: Record<ViewName, { azimuthDeg: number; elevationDeg: number; lighting: LightingMode }> = {
  reference: { azimuthDeg: 41.0, elevationDeg: 19.0, lighting: 'review' },
  front: { azimuthDeg: 0.0, elevationDeg: 6.0, lighting: 'neutral' },
  right: { azimuthDeg: 90.0, elevationDeg: 6.0, lighting: 'neutral' },
  top: { azimuthDeg: 41.0, elevationDeg: 62.0, lighting: 'neutral' },
  rear: { azimuthDeg: 218.0, elevationDeg: 16.0, lighting: 'neutral' },
  grazing: { azimuthDeg: 20.0, elevationDeg: 4.0, lighting: 'grazing' },
};

const params = new URLSearchParams(window.location.search);
const view = (params.get('view') ?? 'reference') as ViewName;
const clay = params.get('mode') === 'clay';
const size = Number(params.get('size') ?? 1254);
const leverOffset = Number(params.get('lever') ?? 0);
const dialDegrees = Number(params.get('dial') ?? 0);
const base = VIEWS[view] ?? VIEWS.reference;
// azim/elev/yscale exist for the camera and proportion sweep used to solve the reference
// view; the shipped model uses the defaults above.
const settings = {
  azimuthDeg: Number(params.get('azim') ?? base.azimuthDeg),
  elevationDeg: Number(params.get('elev') ?? base.elevationDeg),
  lighting: (params.get('light') ?? base.lighting) as LightingMode,
};
const yScale = Number(params.get('yscale') ?? 1);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(size, size);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
configureApartmentToasterRenderer(renderer);
document.body.appendChild(renderer.domElement);

renderer.toneMappingExposure = Number(params.get('exposure') ?? 1);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcecece);
// The room environment adds a large neutral term that washes the warm plastic toward grey,
// so the reference-matched review render runs without it; pass env=1 to inspect with it.
if (params.get('env') === '1') scene.environment = createApartmentToasterEnvironment(renderer);

// Silhouette sweeps do not care about texel density and 1024px maps cost seconds per
// page load, so the map size is a parameter.
const model = createApartmentToasterModel({ textureSize: Number(params.get('tex') ?? 1024) });
if (yScale !== 1) model.scale.y = yScale;
scene.add(model);

// The reference is a soft studio render: its shaded end face sits within a few percent of
// its lit front face, and the top face is only marginally brighter. A dominant warm
// hemisphere with a gentle top key reproduces that value range; the factory's shipped
// look-dev rig is key-dominant and is kept for the neutral and grazing checks.
function createReviewRig(): THREE.Group {
  const rig = new THREE.Group();
  rig.name = 'reference-matched review rig';
  const hemi = new THREE.HemisphereLight(0xffeed2, 0xe4d6be, Number(params.get('hemi') ?? 3.8));
  rig.add(hemi);
  const key = new THREE.DirectionalLight(0xffe9c9, Number(params.get('key') ?? 1.3));
  key.position.set(-2.5, 6.5, 4.0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  rig.add(key);
  const rim = new THREE.DirectionalLight(0xfff1c4, Number(params.get('rim') ?? 0.35));
  rim.position.set(3.0, 2.0, -5.0);
  rig.add(rim);
  return rig;
}

scene.add(
  settings.lighting === 'review'
    ? createReviewRig()
    : createApartmentToasterLookDevLights(settings.lighting),
);

const runtime = model.userData.sculptRuntime as {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
};

if (leverOffset !== 0) {
  const lever = runtime.nodes['lever-knob'];
  if (lever) lever.position.y += leverOffset;
}
if (dialDegrees !== 0) {
  const dial = runtime.nodes['control-dial'];
  if (dial) dial.rotation.x = THREE.MathUtils.degToRad(dialDegrees);
}

if (clay) {
  const clayMaterial = new THREE.MeshStandardMaterial({ color: 0xbdbdbd, roughness: 0.85, metalness: 0.0 });
  model.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) mesh.material = clayMaterial;
  });
}

const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 60);

function surfacePoints(root: THREE.Object3D): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  root.updateMatrixWorld(true);
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || (mesh as unknown as THREE.InstancedMesh).isInstancedMesh) return;
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

// Match the render's projected bounding box to a target box. Distance is solved on area
// so diagnose_render's scale delta goes to zero and its aspect delta then reports real
// shape error rather than framing error. The look-at target is nudged in camera space to
// centre the box. Converges in a handful of iterations.
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
  let distance = box.getSize(new THREE.Vector3()).length() * 2.2;

  const wantWidth = target.maxX - target.minX;
  const wantHeight = target.maxY - target.minY;
  const wantCenterX = (target.minX + target.maxX) / 2;
  const wantCenterY = (target.minY + target.maxY) / 2;
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();

  for (let iteration = 0; iteration < 40; iteration += 1) {
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

    distance *= Math.sqrt((width * height) / (wantWidth * wantHeight));

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

// Non-reference views are judged for self-consistency, never against the photo, so they
// simply fill a fixed share of the frame.
const fitTarget = view === 'reference'
  ? REFERENCE_NDC
  : { minX: -0.84, maxX: 0.84, minY: -0.84, maxY: 0.84 };
fitCamera(fitTarget);

renderer.render(scene, camera);

// Runtime dump of the built part tree for stage4_review/check_part_coverage.py. A part is a
// named entry in sculptRuntime.meshes plus each InstancedMesh cluster; anything else is
// counted rather than named, which is what the gate wants to see.
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
    const mesh = child as THREE.Mesh & { isInstancedMesh?: boolean; count?: number };
    if (!mesh.isMesh) return;
    if (mesh.isInstancedMesh) {
      const position = mesh.geometry.getAttribute('position');
      parts.push({
        name: mesh.name,
        kind: 'part',
        module: 'micro',
        triangles: Math.floor(((position?.count ?? 0) / 3) * (mesh.count ?? 1)),
      });
      named.add(mesh);
      return;
    }
    if (!named.has(mesh)) unnamedMeshes += 1;
  });
  return { model: 'apartment-toaster', parts, unnamedMeshes, integralMeshes: parts.length };
}

const globals = window as unknown as Record<string, unknown>;
globals.__toasterParts = partsManifest();
globals.__toasterStats = {
  view,
  clay,
  triangles: renderer.info.render.triangles,
  drawCalls: renderer.info.render.calls,
  programs: renderer.info.programs?.length ?? 0,
  cameraPosition: camera.position.toArray().map((v) => Number(v.toFixed(4))),
  nodeIds: Object.keys(runtime.nodes),
  socketIds: Object.keys(runtime.sockets),
  meshIds: Object.keys(runtime.meshes),
};
globals.__toasterReady = true;
