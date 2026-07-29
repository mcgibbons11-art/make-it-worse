// Standalone review harness for the img2threejs sculpt loop on the apartment room. It is
// scaffolding for the pass reviews only - nothing in the game imports it. Like the toaster and
// runner harnesses it fits the camera so the rendered silhouette lands on the same bounding box
// as the reference, because diagnose_render.py compares the two masks in place.

import * as THREE from 'three';
import {
  createMAKEITWORSEApartmentRoomModel,
  createMAKEITWORSEApartmentRoomLookDevLights,
  configureMAKEITWORSEApartmentRoomRenderer,
} from '../../../../components/game/models/createApartmentModel.js';

type ViewName = 'reference' | 'front' | 'right' | 'threequarter' | 'rear' | 'grazing';
type LightingMode = 'neutral' | 'grazing' | 'reference' | 'review';

// Reference silhouette bounding box in NDC. Source is 1448x1086 and the room occupies
// x 172..1274, y 61..1054, measured by background subtraction against the #d3d1d1 studio grey
// at a tolerance of 11 of 255.
const REFERENCE_NDC = { minX: -0.7624, maxX: 0.7597, minY: -0.9411, maxY: 0.8877 };
const RENDER_WIDTH = 1448;
const RENDER_HEIGHT = 1086;

// The reference camera, solved from four silhouette edges: azimuth 45 deg (the room corner is
// square and viewed on its diagonal), pitch 22.44 deg below horizontal, 13.01 deg vertical
// field. Orbit views are judged for self-consistency only, never against a reference angle the
// photo does not cover, so they use a wider field and simply fill a fixed share of frame.
const VIEWS: Record<ViewName, { azimuthDeg: number; elevationDeg: number; fov: number; lighting: LightingMode }> = {
  reference: { azimuthDeg: 45.0, elevationDeg: 22.44, fov: 13.01, lighting: 'review' },
  front: { azimuthDeg: 0.0, elevationDeg: 12.0, fov: 26.0, lighting: 'neutral' },
  right: { azimuthDeg: 90.0, elevationDeg: 12.0, fov: 26.0, lighting: 'neutral' },
  threequarter: { azimuthDeg: 20.0, elevationDeg: 34.0, fov: 26.0, lighting: 'neutral' },
  rear: { azimuthDeg: 215.0, elevationDeg: 20.0, fov: 26.0, lighting: 'neutral' },
  grazing: { azimuthDeg: 52.0, elevationDeg: 6.0, fov: 20.0, lighting: 'grazing' },
};

const params = new URLSearchParams(window.location.search);
const view = (params.get('view') ?? 'reference') as ViewName;
const clay = params.get('mode') === 'clay';
const base = VIEWS[view] ?? VIEWS.reference;
const settings: { azimuthDeg: number; elevationDeg: number; fov: number; lighting: LightingMode } = {
  azimuthDeg: Number(params.get('azim') ?? base.azimuthDeg),
  elevationDeg: Number(params.get('elev') ?? base.elevationDeg),
  fov: Number(params.get('fov') ?? base.fov),
  lighting: (params.get('light') ?? base.lighting) as LightingMode,
};

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(RENDER_WIDTH, RENDER_HEIGHT);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
configureMAKEITWORSEApartmentRoomRenderer(renderer);
// The reference carries no filmic grade: its brightest pixel is 0.93 relative luminance and
// nothing clips. Under ACES the cream compresses far more than the sage, so a colour comparison
// would measure the tone curve instead of the material. Pass tone=aces to inspect the shipped
// curve instead.
if ((params.get('tone') ?? (settings.lighting === 'review' ? 'neutral' : 'aces')) === 'neutral') {
  renderer.toneMapping = THREE.NoToneMapping;
}
renderer.toneMappingExposure = Number(params.get('exposure') ?? 1);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// Measured background of the reference: (211, 209, 209) within 2/255 at all four corners.
scene.background = new THREE.Color(0xd3d1d1);

const model = createMAKEITWORSEApartmentRoomModel({ textureSize: Number(params.get('tex') ?? 256) });
scene.add(model);

const runtime = model.userData.sculptRuntime as {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
};

// One warm key, a broad fill and no rim, solved from the reference's own values rather than
// dialled by eye. Three orientations are measurable in the reference and all three carry a
// material whose albedo this spec authors from the directly lit face, so the rig is chosen to
// put irradiance at 1.0 on those faces and let the falloff fall out:
//
//   wall A face (+X normal)  #f3e3ce   -> want irradiance 1.00
//   floor board (+Y normal)  #e7b174   -> want irradiance 1.00
//   wall B face (+Z normal)  #d8c8b1   -> want irradiance 0.766 (the measured linear ratio)
//
// The rig's lights are NEUTRAL white on purpose. The reference's own key is warm, but the albedos
// this spec authors are colour-picked from the reference, so they already carry that warmth; a
// warm rig on top of them double-counts it and the first calibration render came back 34 of 255
// short on blue for exactly that reason.
//
// Three.js gives a vertical surface about 0.92 of the hemisphere intensity and an up-facing one
// about 0.96, so hemi 0.55 plus a key of 0.731 along (0.676, 0.646, 0.356) puts the ratios right.
// The absolute level then came from one calibration render: at those intensities wall A came out
// at linear 0.245 against an albedo of 0.898, so the renderer's own unit conversion is 0.273 and
// both intensities are scaled by its reciprocal, 3.666, then by a further 0.906 from a
// second calibration render that came back 4 percent hot on the cream. The key is biased toward +X because in
// the reference the left wall is the bright one; the first rig had it biased toward +Z and
// rendered the two walls the wrong way round.
function createReviewRig(): THREE.Group {
  const rig = new THREE.Group();
  rig.name = 'reference-matched review rig';
  rig.add(new THREE.HemisphereLight(0xffffff, 0xe6e6e6, Number(params.get('hemi') ?? 1.827)));
  const key = new THREE.DirectionalLight(0xffffff, Number(params.get('key') ?? 2.428));
  key.position.set(6.76, 6.46, 3.56);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 40;
  key.shadow.camera.left = -5;
  key.shadow.camera.right = 5;
  key.shadow.camera.top = 5;
  key.shadow.camera.bottom = -5;
  key.shadow.camera.updateProjectionMatrix();
  rig.add(key);
  const bounce = new THREE.DirectionalLight(0xf0f2f5, Number(params.get('bounce') ?? 0.30));
  bounce.position.set(-3.5, 1.5, -2.0);
  rig.add(bounce);
  return rig;
}

scene.add(
  settings.lighting === 'review'
    ? createReviewRig()
    : createMAKEITWORSEApartmentRoomLookDevLights(settings.lighting),
);

if (clay) {
  const clayMaterial = new THREE.MeshStandardMaterial({ color: 0xbdbdbd, roughness: 0.85, metalness: 0.0 });
  model.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh && (mesh.material as THREE.Material | undefined)?.opacity !== 0) {
      mesh.material = clayMaterial;
    }
  });
}

const camera = new THREE.PerspectiveCamera(settings.fov, RENDER_WIDTH / RENDER_HEIGHT, 0.05, 200);

function surfacePoints(root: THREE.Object3D): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  root.updateMatrixWorld(true);
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    if ((mesh.material as THREE.Material | undefined)?.opacity === 0) return;
    const attribute = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!attribute) return;
    const instanced = mesh as unknown as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4();
    const count = instanced.isInstancedMesh ? instanced.count : 1;
    for (let instance = 0; instance < count; instance += 1) {
      if (instanced.isInstancedMesh) instanced.getMatrixAt(instance, matrix);
      else matrix.identity();
      for (let i = 0; i < attribute.count; i += 1) {
        points.push(
          new THREE.Vector3()
            .fromBufferAttribute(attribute, i)
            .applyMatrix4(matrix)
            .applyMatrix4(mesh.matrixWorld),
        );
      }
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

// Match the render's projected bounding box to a target box. Distance is solved on the LARGER of
// the two axis errors so a room that is wider than the reference does not overflow frame while
// its height is being fitted; the residual then shows up as a real proportion error rather than
// as a framing artefact.
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
  let distance = box.getSize(new THREE.Vector3()).length() * 3.0;

  const wantWidth = target.maxX - target.minX;
  const wantHeight = target.maxY - target.minY;
  const wantCenterX = (target.minX + target.maxX) / 2;
  const wantCenterY = (target.minY + target.maxY) / 2;
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();

  for (let iteration = 0; iteration < 80; iteration += 1) {
    camera.position.copy(look).addScaledVector(direction, distance);
    camera.lookAt(look);
    camera.near = Math.max(0.02, distance * 0.05);
    camera.far = distance * 4.0;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    const bounds = ndcBounds(points, camera);
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    if (!Number.isFinite(width) || width <= 0 || height <= 0) break;

    distance *= Math.max(width / wantWidth, height / wantHeight);

    const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * distance;
    const halfWidth = halfHeight * camera.aspect;
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    look.addScaledVector(right, ((bounds.minX + bounds.maxX) / 2 - wantCenterX) * halfWidth);
    look.addScaledVector(up, ((bounds.minY + bounds.maxY) / 2 - wantCenterY) * halfHeight);
  }

  camera.position.copy(look).addScaledVector(direction, distance);
  camera.lookAt(look);
  camera.near = Math.max(0.02, distance * 0.05);
  camera.far = distance * 4.0;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

fitCamera(view === 'reference' ? REFERENCE_NDC : { minX: -0.82, maxX: 0.82, minY: -0.86, maxY: 0.86 });

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
    // InstancedMesh clusters are named after their repetition system and are one part each.
    if (!named.has(mesh) && !(mesh as unknown as THREE.InstancedMesh).isInstancedMesh) unnamedMeshes += 1;
  });
  return { model: 'make-it-worse-apartment-room', parts, unnamedMeshes, integralMeshes: parts.length };
}

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
globals.__roomParts = partsManifest();
globals.__roomStats = {
  view,
  clay,
  triangles: renderer.info.render.triangles,
  drawCalls: renderer.info.render.calls,
  programs: renderer.info.programs?.length ?? 0,
  cameraPosition: camera.position.toArray().map((v) => Number(v.toFixed(4))),
  fov: camera.fov,
  silhouette: silhouette(),
  nodeIds: Object.keys(runtime.nodes),
};
globals.__roomReady = true;
