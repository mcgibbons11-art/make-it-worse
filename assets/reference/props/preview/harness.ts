// Shared review harness for the apartment-prop sculpt loop. Scaffolding for the pass
// reviews only - nothing in the game imports it.
//
// Two things it does that a normal viewer does not:
//  1. It renders at the reference image's own pixel dimensions. diagnose_render.py
//     rescales both images to a 224x224 grid WITHOUT preserving aspect, so a square
//     render of a 3:4 reference would be sheared before the masks are compared.
//  2. It fits the camera so the rendered silhouette lands on the same bounding box as
//     the reference photo, which is what makes the Tier-1 scale delta report shape error
//     instead of framing error.

import * as THREE from 'three';
import {
  createApartmentBeachBallModel,
  createApartmentBeachBallLookDevLights,
  configureApartmentBeachBallRenderer,
} from '../../../../components/game/models/createBeachBallModel.js';
import {
  createApartmentSoapDishModel,
  createApartmentSoapDishLookDevLights,
  configureApartmentSoapDishRenderer,
} from '../../../../components/game/models/createSoapDishModel.js';
import {
  createRobotMopModel,
  createRobotMopLookDevLights,
  configureRobotMopRenderer,
} from '../../../../components/game/models/createMopModel.js';
import {
  createApartmentClawHammerOnWallBracketModel,
  createApartmentClawHammerOnWallBracketLookDevLights,
  configureApartmentClawHammerOnWallBracketRenderer,
} from '../../../../components/game/models/createHammerModel.js';
import {
  createApartmentRefrigeratorModel,
  createApartmentRefrigeratorLookDevLights,
  configureApartmentRefrigeratorRenderer,
} from '../../../../components/game/models/createRefrigeratorModel.js';
import {
  createApartmentToiletModel,
  createApartmentToiletLookDevLights,
  configureApartmentToiletRenderer,
} from '../../../../components/game/models/createToiletModel.js';
import {
  createApartmentSpringJumpPadModel,
  createApartmentSpringJumpPadLookDevLights,
  configureApartmentSpringJumpPadRenderer,
} from '../../../../components/game/models/createSpringModel.js';
import {
  createApartmentFloorFanModel,
  createApartmentFloorFanLookDevLights,
  configureApartmentFloorFanRenderer,
} from '../../../../components/game/models/createFloorFanModel.js';
import {
  createApartmentCanisterVacuumModel,
  createApartmentCanisterVacuumLookDevLights,
  configureApartmentCanisterVacuumRenderer,
} from '../../../../components/game/models/createVacuumModel.js';

// 'review' is this harness's own reference-matched rig, not a factory mode, so it never
// reaches entry.lights().
type LookDevMode = 'neutral' | 'grazing' | 'reference' | 'review';
type FactoryLookDevMode = 'neutral' | 'grazing' | 'reference';
type BuildOptions = { textureSize: number };
type Ndc = { minX: number; maxX: number; minY: number; maxY: number };

interface ModelEntry {
  build(options: BuildOptions): THREE.Group;
  lights(mode: FactoryLookDevMode): THREE.Object3D;
  configure(renderer: THREE.WebGLRenderer): void;
  /** Reference silhouette box, from measure_reference.py, in the render's own NDC. */
  ndc: Ndc;
  /** Solved reference camera. Orbit views are judged for self-consistency only. */
  azimuthDeg: number;
  elevationDeg: number;
  /** Reference image pixel size; the render matches it so masks compare in place. */
  size: [number, number];
  fovDegrees: number;
  /**
   * Undoes a prop's envelope squash for the review render only.
   *
   * Some props cannot match their reference's aspect by construction, because the
   * collider or trigger that mounts them fixes a different one and gameplay wins. Scored
   * as shipped, their Tier-1 aspect and scale deltas report that squash and drown out
   * every shape signal the gate exists to catch. Rendering the review view at the
   * reciprocal restores the reference's own proportions, so the gate scores the SHAPE.
   *
   * It is a substitution, not a pass: the number here is exactly the deviation, and each
   * spec that carries one states it in risks and in its review entries.
   */
  reviewYScale?: number;
}

const MODELS: Record<string, ModelEntry> = {
  ball: {
    build: (options) => createApartmentBeachBallModel(options),
    lights: (mode) => createApartmentBeachBallLookDevLights(mode),
    configure: (renderer) => configureApartmentBeachBallRenderer(renderer),
    ndc: { minX: -0.7993, maxX: 0.7901, minY: -0.5856, maxY: 0.6326 },
    azimuthDeg: 0.0,
    elevationDeg: 40.6,
    size: [1086, 1448],
    // Long lens. At 26 degrees the fitted camera sits 4.3 radii out, which projects the
    // ball's pole at 0.87 of the silhouette radius against the reference's measured 0.759;
    // at 10 degrees it lands at 0.79 and the cream panels reach the same height as the
    // reference's. The reference is a product-style render, so a long lens is the match.
    fovDegrees: 10,
  },
  soap: {
    build: (options) => createApartmentSoapDishModel(options),
    lights: (mode) => createApartmentSoapDishLookDevLights(mode),
    configure: (renderer) => configureApartmentSoapDishRenderer(renderer),
    ndc: { minX: -0.8527, maxX: 0.8637, minY: -0.4309, maxY: 0.4779 },
    azimuthDeg: 4.0,
    elevationDeg: 58.0,
    size: [1086, 1448],
    fovDegrees: 12,
  },
  fridge: {
    build: (options) => createApartmentRefrigeratorModel(options),
    lights: (mode) => createApartmentRefrigeratorLookDevLights(mode),
    configure: (renderer) => configureApartmentRefrigeratorRenderer(renderer),
    ndc: { minX: -0.547, maxX: 0.5451, minY: -0.7997, maxY: 0.8329 },
    // Both angles come from the plinth's two top-edge slopes rather than from a
    // length fit, so unlike the ball's they did not need a sweep to settle.
    azimuthDeg: 23.0,
    elevationDeg: 16.4,
    size: [1086, 1448],
    fovDegrees: 12,
  },
  hammer: {
    build: (options) => createApartmentClawHammerOnWallBracketModel(options),
    lights: (mode) => createApartmentClawHammerOnWallBracketLookDevLights(mode),
    configure: (renderer) => configureApartmentClawHammerOnWallBracketRenderer(renderer),
    ndc: { minX: -0.7182, maxX: 0.7956, minY: -0.7831, maxY: 0.8011 },
    azimuthDeg: -24.0,
    elevationDeg: 12.0,
    size: [1086, 1448],
    fovDegrees: 26,
  },
  mop: {
    build: (options) => createRobotMopModel(options),
    lights: (mode) => createRobotMopLookDevLights(mode),
    configure: (renderer) => configureRobotMopRenderer(renderer),
    ndc: { minX: -0.8692, maxX: 0.8619, minY: -0.4392, maxY: 0.4185 },
    // The deck is a circle, so its projected minor over major IS sin(elevation):
    // 387/787 = 0.4917 closes to 29.46 degrees. Straight-on in azimuth.
    azimuthDeg: 0.0,
    elevationDeg: 29.46,
    size: [1086, 1448],
    fovDegrees: 28,
  },
  toilet: {
    build: (options) => createApartmentToiletModel(options),
    lights: (mode) => createApartmentToiletLookDevLights(mode),
    configure: (renderer) => configureApartmentToiletRenderer(renderer),
    ndc: { minX: -0.7385, maxX: 0.7403, minY: -0.8011, maxY: 0.8315 },
    // NOT solved. The prop is not a solid of revolution and one three-quarter view cannot
    // separate azimuth from the plan, so these are seeds for the sweep, not measurements.
    azimuthDeg: 28.0,
    elevationDeg: 18.0,
    size: [1086, 1448],
    fovDegrees: 14,
    // The collider is 1.04 x 0.90 x 1.00 and the reference is 1.472 times as tall as wide.
    // Filling the plan costs 40% of that ratio; this is the reciprocal.
    reviewYScale: 1.668,
  },
  fan: {
    build: (options) => createApartmentFloorFanModel(options),
    lights: (mode) => createApartmentFloorFanLookDevLights(mode),
    configure: (renderer) => configureApartmentFloorFanRenderer(renderer),
    ndc: { minX: -0.6924, maxX: 0.6704, minY: -0.8274, maxY: 0.8149 },
    // Solved from two discs in perpendicular planes. The BASE lies in the ground plane, so
    // its top rim's projected minor over major is sin(elevation): 151/576 = 0.2622 closes
    // to 15.20 degrees. The GUARD stands in a vertical plane, so its projected horizontal
    // semi-axis over its vertical one is cos(yaw): 293/401 = 0.7307 closes to 43.1.
    azimuthDeg: 43.1,
    elevationDeg: 15.2,
    size: [1086, 1448],
    fovDegrees: 14,
    // NO CORRECTION, deliberately. A yscale of 1.267 was tried first, computed from the
    // shipped WORLD width against the reference's PROJECTED one, and it stretched the
    // render by a third: the camera yaws the head 43.1 degrees, so the guard projects at
    // its diameter times cos(yaw) while the base, lying in the ground plane, does not
    // foreshorten at all. Beyond that, the reason this prop projects narrower than the
    // reference is the REAR CAGE, which is 20.9 percent of the reference's width and is
    // not built yet. That is a missing part, and a review scale would hide it.
    reviewYScale: 1,
  },
  spring: {
    build: (options) => createApartmentSpringJumpPadModel(options),
    lights: (mode) => createApartmentSpringJumpPadLookDevLights(mode),
    configure: (renderer) => configureApartmentSpringJumpPadRenderer(renderer),
    ndc: { minX: -0.7385, maxX: 0.7293, minY: -0.7099, maxY: 0.75 },
    // The cap and the base are both discs, so each holds its maximum projected width
    // across a band of exactly T cos(e). The base's band is 100px against a 774px
    // diameter, which closes to 22.96 degrees, and the cap reproduces it to a pixel.
    azimuthDeg: 0.0,
    elevationDeg: 22.96,
    size: [1086, 1448],
    fovDegrees: 14,
    // The launch test is 1.40 across and PLAYER.stepAssistHeight is 0.45, so the shipped
    // pad keeps 31.45% of the reference's height-to-width ratio. This is the reciprocal.
    reviewYScale: 3.18,
  },
  vacuum: {
    build: (options) => createApartmentCanisterVacuumModel(options),
    lights: (mode) => createApartmentCanisterVacuumLookDevLights(mode),
    configure: (renderer) => configureApartmentCanisterVacuumRenderer(renderer),
    // From the CLEAN silhouette, measured off the union of the part masks. The obj-based
    // bbox is 33px wider because it swallows the contact shadow.
    ndc: { minX: -0.7336, maxX: 0.6651, minY: -0.8102, maxY: 0.7448 },
    // Elevation is the SOLVED pitch: the yellow top button is a circle in a horizontal
    // plane, so its projected minor over major is sin(elevation), and 40.2/85.5 = 0.4707
    // closes to 28.1. Azimuth is a seed only - it was never solved, and nothing in the
    // spec needed it, because every reading there is a horizontal extent or a
    // horizontal-circle arc fit and neither depends on yaw.
    azimuthDeg: 32.0,
    elevationDeg: 28.1,
    size: [1254, 1254],
    fovDegrees: 16,
    // NO CORRECTION. This prop's deviation is a POSE change, not a squash: every part
    // keeps its measured proportions and only the hose's route and the head's parking
    // place were abandoned, because the reference pose is 2.58 deep for every 1 tall
    // against a collider that allows 0.818. A yscale corrects an aspect the collider
    // forced; there is no such aspect here, and applying one would hide the pose change
    // rather than compensate for it.
    reviewYScale: 1,
  },
};

const params = new URLSearchParams(window.location.search);
const modelId = params.get('model') ?? 'ball';
const entry = MODELS[modelId];
if (!entry) throw new Error(`unknown model ${modelId}`);

const view = params.get('view') ?? 'reference';
const clay = params.get('mode') === 'clay';
const [defaultWidth, defaultHeight] = entry.size;
const width = Number(params.get('w') ?? defaultWidth);
const height = Number(params.get('h') ?? defaultHeight);

// Orbit views exist to prove the form is not a flat card; they are never scored
// against the reference angle, so they simply fill a fixed share of the frame.
const ORBIT: Record<string, { azimuth: number; elevation: number; lighting: LookDevMode }> = {
  front: { azimuth: 0, elevation: 4, lighting: 'neutral' },
  right: { azimuth: 90, elevation: 6, lighting: 'neutral' },
  rear: { azimuth: 180, elevation: 12, lighting: 'neutral' },
  top: { azimuth: 30, elevation: 70, lighting: 'neutral' },
  grazing: { azimuth: 18, elevation: 3, lighting: 'grazing' },
};
const orbit = ORBIT[view];
const azimuthDeg = Number(params.get('azim') ?? (orbit ? orbit.azimuth : entry.azimuthDeg));
const elevationDeg = Number(params.get('elev') ?? (orbit ? orbit.elevation : entry.elevationDeg));
const lighting = (params.get('light') ?? (orbit ? orbit.lighting : 'review')) as LookDevMode;
// Only the reference view is scored against the reference, so only it takes the squash
// correction. An orbit view is judged for self-consistency and has to show the prop as it
// actually ships.
const yScale = Number(params.get('yscale') ?? (orbit ? 1 : entry.reviewYScale ?? 1));

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(width, height);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
entry.configure(renderer);
renderer.toneMappingExposure = Number(params.get('exposure') ?? 1);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// NOT the reference sheet's own #D4D4D4. The Tier-1 gate builds its foreground mask by
// colour distance from the corner background with a floor of 24, and a shaded cream soap
// bar lands 12 from #D4D4D4 - so half the bar fell out of the render's mask and the
// silhouette IoU read 0.459 for a shape that was actually correct. A mid grey-blue keeps
// every prop albedo, including deep-shadow cream, more than 24 away. The comparison sheet
// therefore shows two different backgrounds; that is deliberate.
scene.background = new THREE.Color(0x8c9298);

// Silhouette sweeps do not care about texel density and 1024px maps cost seconds per
// page load, so the map size is a parameter.
const model = entry.build({ textureSize: Number(params.get('tex') ?? 512) });
if (yScale !== 1) model.scale.y = yScale;
scene.add(model);

// These references are soft studio renders: the shaded side of a part sits within a few
// percent of its lit side. A dominant warm-neutral hemisphere with a gentle top key
// reproduces that value range; the factory's shipped look-dev rig is key-dominant and is
// kept for the neutral and grazing checks.
function createReviewRig(): THREE.Group {
  const rig = new THREE.Group();
  rig.name = 'reference-matched review rig';
  rig.add(new THREE.HemisphereLight(0xfdfbf6, 0xdedad2, Number(params.get('hemi') ?? 3.1)));
  const key = new THREE.DirectionalLight(0xfff6e8, Number(params.get('key') ?? 1.15));
  key.position.set(-2.2, 6.0, 4.2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  rig.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, Number(params.get('rim') ?? 0.3));
  rim.position.set(3.0, 2.0, -5.0);
  rig.add(rim);
  return rig;
}

scene.add(lighting === 'review' ? createReviewRig() : entry.lights(lighting as FactoryLookDevMode));

if (clay) {
  const clayMaterial = new THREE.MeshStandardMaterial({ color: 0xbdbdbd, roughness: 0.85, metalness: 0.0 });
  model.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) mesh.material = clayMaterial;
  });
}

// Field of view is a real fidelity control, not a preference: these references are
// product-style renders on a long lens, so a wide harness lens magnifies whatever faces
// the camera and pushes a sphere's pole further up the frame than the reference shows.
const camera = new THREE.PerspectiveCamera(
  Number(params.get('fov') ?? entry.fovDegrees), width / height, 0.05, 400);

function surfacePoints(root: THREE.Object3D): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  root.updateMatrixWorld(true);
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || (mesh as unknown as THREE.InstancedMesh).isInstancedMesh) return;
    const attribute = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!attribute) return;
    // A 64x40 sphere is 2600 vertices; every one of them projected 40 times per fit is
    // the harness's whole cost, and every eighth is enough to bound a convex-ish hull.
    const stride = attribute.count > 4000 ? 4 : 1;
    for (let i = 0; i < attribute.count; i += stride) {
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
// so the Tier-1 scale delta goes to zero and the aspect delta then reports real shape
// error rather than framing error. The look-at target is nudged in camera space to centre
// the box. Converges in a handful of iterations.
function fitCamera(target: Ndc): void {
  const points = surfacePoints(model);
  const azimuth = THREE.MathUtils.degToRad(azimuthDeg);
  const elevation = THREE.MathUtils.degToRad(elevationDeg);
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
    const boundsWidth = bounds.maxX - bounds.minX;
    const boundsHeight = bounds.maxY - bounds.minY;
    if (!Number.isFinite(boundsWidth) || boundsWidth <= 0 || boundsHeight <= 0) break;

    distance *= Math.sqrt((boundsWidth * boundsHeight) / (wantWidth * wantHeight));

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

fitCamera(orbit ? { minX: -0.82, maxX: 0.82, minY: -0.62, maxY: 0.62 } : entry.ndc);
renderer.render(scene, camera);

const runtime = model.userData.sculptRuntime as {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
};

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
  return { model: modelId, parts, unnamedMeshes, integralMeshes: parts.length };
}

// Per-part world bounds. Renders hide the bugs that matter here - a part inheriting a
// pivot scale, or a slab hinged through its own middle, both look plausible and measure
// wrong - so every fit claim is checked against this rather than against a screenshot.
// Probe with ?yscale=1, otherwise the review squash correction scales every y reported.
function partBounds() {
  const box = new THREE.Box3();
  const out: Record<string, { min: number[]; max: number[]; size: number[] }> = {};
  for (const [id, mesh] of Object.entries(runtime.meshes)) {
    box.setFromObject(mesh);
    const extent = box.getSize(new THREE.Vector3());
    out[id] = {
      min: box.min.toArray().map((v) => Number(v.toFixed(4))),
      max: box.max.toArray().map((v) => Number(v.toFixed(4))),
      size: extent.toArray().map((v) => Number(v.toFixed(4))),
    };
  }
  return out;
}

const bounds = new THREE.Box3().setFromObject(model);
const size = bounds.getSize(new THREE.Vector3());
const globals = window as unknown as Record<string, unknown>;
globals.__propParts = partsManifest();
globals.__propPartBounds = partBounds();
globals.__propStats = {
  model: modelId,
  view,
  clay,
  triangles: renderer.info.render.triangles,
  drawCalls: renderer.info.render.calls,
  programs: renderer.info.programs?.length ?? 0,
  cameraPosition: camera.position.toArray().map((v) => Number(v.toFixed(4))),
  boundingBox: {
    min: bounds.min.toArray().map((v) => Number(v.toFixed(4))),
    max: bounds.max.toArray().map((v) => Number(v.toFixed(4))),
    size: size.toArray().map((v) => Number(v.toFixed(4))),
  },
  nodeIds: Object.keys(runtime.nodes),
  socketIds: Object.keys(runtime.sockets),
  meshIds: Object.keys(runtime.meshes),
};
globals.__propReady = true;
