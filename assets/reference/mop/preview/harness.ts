// Standalone review harness for the robot-mop sculpt loop. Scaffolding for the pass
// reviews only - nothing in the game imports it. It fits the camera so the rendered
// silhouette lands on the same bounding box as the reference photo, because
// diagnose_render.py compares the two masks in place and would otherwise report
// framing error as shape error.

import * as THREE from 'three';
import {
  createRobotMopModel,
  createRobotMopLookDevLights,
  createRobotMopEnvironment,
  configureRobotMopRenderer,
} from '../../../../components/game/models/createMopModel.js';

type ViewName = 'reference' | 'front' | 'top' | 'grazing' | 'rear' | 'side';
type LightingMode = 'neutral' | 'grazing' | 'reference' | 'review';

// Reference silhouette bounding box in NDC, from evidence/measurements.json against the
// 1086x1448 source. The mop is a wide flat disc, so its box is much wider than tall.
const REFERENCE_NDC = { minX: -0.8711, maxX: 0.8619, minY: -0.4406, maxY: 0.4185 };

// Elevation 29.46 solved from the deck ellipse. Azimuth is unobservable on a solid of
// revolution and is fixed by the button and latch sharing one centreline, so the
// reference view looks straight at the front.
const VIEWS: Record<ViewName, { azimuthDeg: number; elevationDeg: number; lighting: LightingMode }> = {
  reference: { azimuthDeg: 0.0, elevationDeg: 29.46, lighting: 'review' },
  front: { azimuthDeg: 0.0, elevationDeg: 4.0, lighting: 'neutral' },
  side: { azimuthDeg: 90.0, elevationDeg: 8.0, lighting: 'neutral' },
  top: { azimuthDeg: 0.0, elevationDeg: 78.0, lighting: 'neutral' },
  rear: { azimuthDeg: 180.0, elevationDeg: 26.0, lighting: 'neutral' },
  grazing: { azimuthDeg: 34.0, elevationDeg: 3.0, lighting: 'grazing' },
};

const params = new URLSearchParams(window.location.search);
const view = (params.get('view') ?? 'reference') as ViewName;
const clay = params.get('mode') === 'clay';
const size = Number(params.get('size') ?? 1086);
const base = VIEWS[view] ?? VIEWS.reference;
const settings = {
  azimuthDeg: Number(params.get('azim') ?? base.azimuthDeg),
  elevationDeg: Number(params.get('elev') ?? base.elevationDeg),
  lighting: (params.get('light') ?? base.lighting) as LightingMode,
};
// The height solve is weakly conditioned from one image (H/D lands anywhere in
// [0.194, 0.298]), so the blockout pass sweeps this and keeps whatever maximises
// silhouette IoU. Authored value is 1.0 = H/D 0.22.
const yScale = Number(params.get('yscale') ?? 1);
const skirtSpin = Number(params.get('spin') ?? 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(size, size);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
configureRobotMopRenderer(renderer);
document.body.appendChild(renderer.domElement);
renderer.toneMappingExposure = Number(params.get('exposure') ?? 1);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xd8d7d7); // sampled backdrop from the reference
if (params.get('env') === '1') scene.environment = createRobotMopEnvironment(renderer);

// Silhouette sweeps do not care about texel density and large maps cost seconds per page
// load, so the map size is a parameter.
const model = createRobotMopModel({ textureSize: Number(params.get('tex') ?? 512) });
if (yScale !== 1) model.scale.y = yScale;
scene.add(model);

// The reference is a soft studio render: no surface clips to white, nothing crushes to
// black, and the shaded side of the navy band sits only slightly below its lit side. A
// dominant neutral hemisphere with a gentle key reproduces that; the factory's shipped
// look-dev rig is key-dominant and is kept for the neutral and grazing checks.
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
  settings.lighting === 'review' ? createReviewRig() : createRobotMopLookDevLights(settings.lighting),
);

const runtime = model.userData.sculptRuntime as {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
};

if (skirtSpin !== 0) {
  const skirt = runtime.nodes['fringe-skirt'];
  if (skirt) skirt.rotation.y = THREE.MathUtils.degToRad(skirtSpin);
}

if (clay) {
  const clayMaterial = new THREE.MeshStandardMaterial({ color: 0xbdbdbd, roughness: 0.85, metalness: 0.0 });
  model.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) mesh.material = clayMaterial;
  });
}

const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 60);

// Sample real surface points rather than trusting Box3: an InstancedMesh contributes its
// base geometry at the origin under a naive traversal, and a grouping node can emit a
// stub cube, either of which silently inflates the box. Instanced tuft rows are expanded
// through their own instance matrices here so the fringe counts once, in the right place.
function surfacePoints(root: THREE.Object3D): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const vertex = new THREE.Vector3();
  const instanceMatrix = new THREE.Matrix4();
  root.updateMatrixWorld(true);
  root.traverse((child) => {
    const mesh = child as THREE.Mesh & { isInstancedMesh?: boolean; count?: number };
    if (!mesh.isMesh) return;
    const attribute = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!attribute) return;
    const instanced = mesh as unknown as THREE.InstancedMesh;
    if (mesh.isInstancedMesh) {
      // Step through the vertices: a 400-vertex tuft times 88 instances is 35k points and
      // the hull only needs the extremes.
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

// Match the render's projected bounding box to a target box. Distance is solved on area
// so diagnose_render's scale delta goes to zero and its aspect delta then reports real
// shape error rather than framing error.
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

// Non-reference views are judged for self-consistency, never against the photo, so they
// simply fill a fixed share of the frame.
const fitTarget = view === 'reference'
  ? REFERENCE_NDC
  : { minX: -0.84, maxX: 0.84, minY: -0.84, maxY: 0.84 };
fitCamera(fitTarget);

renderer.render(scene, camera);

// Runtime dump of the built part tree for stage4_review/check_part_coverage.py. A part is
// a named entry in sculptRuntime.meshes plus each InstancedMesh cluster; anything else is
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
      const index = mesh.geometry.getIndex();
      const per = Math.floor((index ? index.count : (position?.count ?? 0)) / 3);
      parts.push({ name: mesh.name, kind: 'part', module: 'micro', triangles: per * (mesh.count ?? 1) });
      named.add(mesh);
      return;
    }
    if (!named.has(mesh)) unnamedMeshes += 1;
  });
  return { model: 'robot-mop', parts, unnamedMeshes, integralMeshes: parts.length };
}

// Measured extents of what is actually drawn, so the fit to the trap's collider is
// checked against geometry rather than against the authored constants.
const hull = surfacePoints(model);
const measured = new THREE.Box3().setFromPoints(hull);
const measuredSize = measured.getSize(new THREE.Vector3());
const naive = new THREE.Box3().setFromObject(model);
const naiveSize = naive.getSize(new THREE.Vector3());

const globals = window as unknown as Record<string, unknown>;
globals.__mopParts = partsManifest();
globals.__mopStats = {
  view,
  clay,
  yScale,
  triangles: renderer.info.render.triangles,
  drawCalls: renderer.info.render.calls,
  programs: renderer.info.programs?.length ?? 0,
  cameraPosition: camera.position.toArray().map((v) => Number(v.toFixed(4))),
  // Hull-sampled extents (instances expanded) versus a naive Box3 over the same root.
  // A gap between them is the poisoned-bounding-box signature.
  measuredSize: measuredSize.toArray().map((v) => Number(v.toFixed(5))),
  measuredMin: measured.min.toArray().map((v) => Number(v.toFixed(5))),
  measuredMax: measured.max.toArray().map((v) => Number(v.toFixed(5))),
  naiveBox3Size: naiveSize.toArray().map((v) => Number(v.toFixed(5))),
  heightOverDiameter: Number((measuredSize.y / Math.max(measuredSize.x, measuredSize.z)).toFixed(4)),
  nodeIds: Object.keys(runtime.nodes),
  socketIds: Object.keys(runtime.sockets),
  meshIds: Object.keys(runtime.meshes),
};
globals.__mopReady = true;
