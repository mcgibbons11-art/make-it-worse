// Standalone review harness for the claw-hammer sculpt loop. Scaffolding for the pass
// reviews only - nothing in the game imports it. It fits the camera so the rendered
// silhouette lands on the same bounding box as the reference photo, because
// diagnose_render.py compares the two masks in place and would otherwise report
// framing error as shape error.

import * as THREE from 'three';
import {
  createApartmentClawHammerOnWallBracketModel,
  createApartmentClawHammerOnWallBracketLookDevLights,
  createApartmentClawHammerOnWallBracketEnvironment,
  configureApartmentClawHammerOnWallBracketRenderer,
} from '../../../../components/game/models/createHammerModel.js';

type ViewName = 'reference' | 'front' | 'top' | 'grazing' | 'rear' | 'side';
type LightingMode = 'neutral' | 'grazing' | 'reference' | 'review';

// Reference silhouette bounding box in NDC, from measurementBasis.referenceBBox
// (153, 144)-(974, 1290) against the 1086x1448 source.
const REFERENCE_NDC = { minX: -0.7182, maxX: 0.7937, minY: -0.7818, maxY: 0.8011 };

// The prop carries no circle whose projected ellipse would separate yaw from
// elevation, so the reference view is bracketed rather than solved: the striking
// face and the plate both read close to edge-on, which puts the camera near the
// hammer's own plane. Recorded in the spec's risks.
const VIEWS: Record<ViewName, { azimuthDeg: number; elevationDeg: number; lighting: LightingMode }> = {
  reference: { azimuthDeg: 6.0, elevationDeg: 6.0, lighting: 'review' },
  front: { azimuthDeg: 0.0, elevationDeg: 0.0, lighting: 'neutral' },
  side: { azimuthDeg: 90.0, elevationDeg: 6.0, lighting: 'neutral' },
  top: { azimuthDeg: 0.0, elevationDeg: 78.0, lighting: 'neutral' },
  rear: { azimuthDeg: 180.0, elevationDeg: 8.0, lighting: 'neutral' },
  grazing: { azimuthDeg: 34.0, elevationDeg: 3.0, lighting: 'grazing' },
};

const params = new URLSearchParams(window.location.search);
const view = (params.get('view') ?? 'reference') as ViewName;
const clay = params.get('mode') === 'clay';
// The reference is 1086x1448 and diagnose_render resamples BOTH images to its own
// square grid, so a square render arrives stretched relative to the reference and
// reports framing as an aspect-ratio error. Rendering into the reference's own frame
// makes both sides take the same distortion.
const width = Number(params.get('w') ?? 1086);
const height = Number(params.get('h') ?? 1448);
const base = VIEWS[view] ?? VIEWS.reference;
const settings = {
  azimuthDeg: Number(params.get('azim') ?? base.azimuthDeg),
  elevationDeg: Number(params.get('elev') ?? base.elevationDeg),
  lighting: (params.get('light') ?? base.lighting) as LightingMode,
};
const yScale = Number(params.get('yscale') ?? 1);
// The reference frames the hammer on its wall bracket. The swinging_hammer trap
// draws its own pendulum rig, so the game hides the bracket; this renders it for
// the reference comparison and drops it for the call-site check.
const showBracket = params.get('bracket') !== '0';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(width, height);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
configureApartmentClawHammerOnWallBracketRenderer(renderer);
document.body.appendChild(renderer.domElement);
renderer.toneMappingExposure = Number(params.get('exposure') ?? 1);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xd8d7d7);
if (params.get('env') === '1') {
  scene.environment = createApartmentClawHammerOnWallBracketEnvironment(renderer);
}

const model = createApartmentClawHammerOnWallBracketModel({
  textureSize: Number(params.get('tex') ?? 512),
});
if (yScale !== 1) model.scale.y = yScale;
scene.add(model);

const runtime = model.userData.sculptRuntime as {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

if (!showBracket) {
  for (const node of runtime.destructionGroups.bracket ?? []) node.visible = false;
}

// The reference is a soft studio render: nothing clips to white, nothing crushes to
// black, and the shaded side of the navy plate sits only slightly below its lit side.
// A dominant neutral hemisphere with a gentle key reproduces that; the factory's
// shipped look-dev rig is key-dominant and is kept for the neutral and grazing checks.
function createReviewRig(): THREE.Group {
  const rig = new THREE.Group();
  rig.name = 'reference-matched review rig';
  rig.add(new THREE.HemisphereLight(0xf4f2ef, 0xcfcac4, Number(params.get('hemi') ?? 2.9)));
  const key = new THREE.DirectionalLight(0xfff6ea, Number(params.get('key') ?? 1.15));
  key.position.set(-2.2, 3.8, 2.2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.01;
  rig.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, Number(params.get('rim') ?? 0.3));
  rim.position.set(3.2, 1.4, -2.8);
  rig.add(rim);
  return rig;
}

scene.add(
  settings.lighting === 'review'
    ? createReviewRig()
    : createApartmentClawHammerOnWallBracketLookDevLights(settings.lighting),
);

if (clay) {
  const clayMaterial = new THREE.MeshStandardMaterial({ color: 0xbdbdbd, roughness: 0.85, metalness: 0.0 });
  model.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) mesh.material = clayMaterial;
  });
}

// `?mount=trap` reproduces the frame TrapRenderer.tsx hangs this prop in and draws
// the two colliders that actually hit the player, so the prop and the hazard can be
// compared as a picture rather than as arithmetic. Constants are copied from
// TrapRenderer.tsx's Hammer, which this asset does not own and must not edit.
const HAMMER_ARM_LENGTH = 2.25;
const HAMMER_HEAD_HALF_WIDTH = 0.68;
if (params.get('mount') === 'trap') {
  const pivot = new THREE.Group();
  pivot.name = 'trap-frame';
  scene.add(pivot);

  const wire = (
    args: [number, number, number],
    at: [number, number, number],
    colour: number,
  ) => {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(args[0] * 2, args[1] * 2, args[2] * 2),
      new THREE.MeshBasicMaterial({ color: colour, wireframe: true }),
    );
    box.position.set(...at);
    pivot.add(box);
  };
  wire([0.15, 1.7, 0.15], [0, -0.2, 0], 0x4b8dff);
  wire([HAMMER_HEAD_HALF_WIDTH, 0.42, 0.42], [0, -1.75, 0], 0xb3123c);

  const arm = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 3.4, 0.24),
    new THREE.MeshStandardMaterial({ color: 0xffd84d, roughness: 0.8 }),
  );
  arm.position.set(0, -0.2, 0);
  pivot.add(arm);

  // The mount TrapRenderer applies, verbatim.
  model.position.set(0, -HAMMER_ARM_LENGTH, 0);
  model.rotation.set(0, 0, Math.PI / 2);
  pivot.add(model);
}

const camera = new THREE.PerspectiveCamera(28, width / height, 0.05, 60);

// Sample real surface points rather than trusting Box3: a grouping node can emit a
// stub cube and an InstancedMesh contributes its base geometry at the origin under a
// naive traversal, either of which silently inflates the box.
function surfacePoints(root: THREE.Object3D): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const vertex = new THREE.Vector3();
  const instanceMatrix = new THREE.Matrix4();
  root.updateMatrixWorld(true);
  root.traverse((child) => {
    const mesh = child as THREE.Mesh & { isInstancedMesh?: boolean; count?: number };
    if (!mesh.isMesh || mesh.visible === false) return;
    const attribute = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!attribute) return;
    const instanced = mesh as unknown as THREE.InstancedMesh;
    if (mesh.isInstancedMesh) {
      const stride = Math.max(1, Math.floor(attribute.count / 24));
      for (let i = 0; i < (mesh.count ?? 0); i += 1) {
        instanced.getMatrixAt(i, instanceMatrix);
        for (let v = 0; v < attribute.count; v += stride) {
          vertex.fromBufferAttribute(attribute, v).applyMatrix4(instanceMatrix).applyMatrix4(mesh.matrixWorld);
          points.push(vertex.clone());
        }
      }
      return;
    }
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

// Match the render's projected bounding box to a target box. Distance is solved on
// area so diagnose_render's scale delta goes to zero and its aspect delta then
// reports real shape error rather than framing error.
function fitCamera(target: { minX: number; maxX: number; minY: number; maxY: number }): void {
  const points = surfacePoints(params.get('mount') === 'trap' ? scene : model);
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
    camera.near = Math.max(0.005, distance * 0.2);
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
  camera.near = Math.max(0.005, distance * 0.2);
  camera.far = distance * 3.0;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

// Non-reference views are judged for self-consistency, never against the photo, so
// they simply fill a fixed share of the frame.
const fitTarget = view === 'reference'
  ? REFERENCE_NDC
  : { minX: -0.84, maxX: 0.84, minY: -0.84, maxY: 0.84 };
fitCamera(fitTarget);

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
    const mesh = child as THREE.Mesh & { isInstancedMesh?: boolean; count?: number };
    if (!mesh.isMesh) return;
    if (mesh.isInstancedMesh) {
      const position = mesh.geometry.getAttribute('position');
      const index = mesh.geometry.getIndex();
      const per = Math.floor((index ? index.count : (position?.count ?? 0)) / 3);
      parts.push({ name: mesh.name, kind: 'part', module: 'micro', triangles: per * (mesh.count ?? 1) });
      named.add(mesh);
      return;
    }
    if (!named.has(mesh)) unnamedMeshes += 1;
  });
  return { model: 'claw-hammer', parts, unnamedMeshes, integralMeshes: parts.length };
}

// Per-part world extents, so a part that lands at the default position or at the
// default size is caught by number rather than by eye. That is the failure this
// sculpt shipped with: three of five blockout parts sat at the origin.
function partExtents() {
  const extents: Record<string, { size: number[]; min: number[]; max: number[] }> = {};
  for (const [id, mesh] of Object.entries(runtime.meshes)) {
    const box = new THREE.Box3().setFromObject(mesh);
    extents[id] = {
      size: box.getSize(new THREE.Vector3()).toArray().map((v) => Number(v.toFixed(4))),
      min: box.min.toArray().map((v) => Number(v.toFixed(4))),
      max: box.max.toArray().map((v) => Number(v.toFixed(4))),
    };
  }
  return extents;
}

const hull = surfacePoints(model);
const measured = new THREE.Box3().setFromPoints(hull);
const measuredSize = measured.getSize(new THREE.Vector3());
const naive = new THREE.Box3().setFromObject(model);
const naiveSize = naive.getSize(new THREE.Vector3());

const globals = window as unknown as Record<string, unknown>;
globals.__hammerParts = partsManifest();
globals.__hammerStats = {
  view,
  clay,
  yScale,
  showBracket,
  triangles: renderer.info.render.triangles,
  drawCalls: renderer.info.render.calls,
  programs: renderer.info.programs?.length ?? 0,
  cameraPosition: camera.position.toArray().map((v) => Number(v.toFixed(4))),
  measuredSize: measuredSize.toArray().map((v) => Number(v.toFixed(5))),
  measuredMin: measured.min.toArray().map((v) => Number(v.toFixed(5))),
  measuredMax: measured.max.toArray().map((v) => Number(v.toFixed(5))),
  naiveBox3Size: naiveSize.toArray().map((v) => Number(v.toFixed(5))),
  partExtents: partExtents(),
  nodeIds: Object.keys(runtime.nodes),
  socketIds: Object.keys(runtime.sockets),
  meshIds: Object.keys(runtime.meshes),
};
globals.__hammerReady = true;
