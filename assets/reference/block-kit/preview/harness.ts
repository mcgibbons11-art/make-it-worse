// Review harness for the level building blocks. Scaffolding for the sculpt-pass
// reviews only - nothing in the game imports it.
//
// It does three things a prop harness does not, because a block is repeated down a
// 41u-to-285u course rather than seen once:
//
//   1. It lays N copies on the authored pitch and MEASURES the seam between each
//      adjacent pair, so "the edges meet" is a number rather than an impression.
//   2. It stands the block on a mock platform built from LevelGeometry's own
//      construction, so the ink edge band is visible in the same render and a
//      block that swallows it is caught by eye and by the reported overlap.
//   3. It reports the cost of a full-length course both instanced and not, which
//      is the difference between one draw call and several hundred.

import * as THREE from 'three';
import {
  createApartmentToasterModel,
} from '../../../../components/game/models/createToasterModel.js';

type BlockFactory = (options: { textureSize?: number }) => THREE.Group;

// Static so tsc pulls each factory into the compiled tree. Add a stem here when its
// factory lands; `?block=<stem>` selects it. The toaster is not a block - it is here
// as the harness's own pre-flight, because it is the one factory that already exists
// and tiling something real proves the rig before any block does.
const FACTORIES: Record<string, BlockFactory> = {
  'toaster-preflight': createApartmentToasterModel as BlockFactory,
};

// Mirrored from lib/game/constants.ts and components/game/LevelGeometry.tsx, which
// this harness must not import (they are React/Next modules and another agent owns
// the second). `npm run test` covers the pairing; grid.py --audit covers the rest.
const PALETTE = { ink: '#171a2b', cream: '#fff8e8' };
const DECK_EDGE = 0.13;
const DECK_WASH = 0.62;

const params = new URLSearchParams(window.location.search);
const blockId = params.get('block') ?? 'toaster-preflight';
const view = params.get('view') ?? 'single';
const clay = params.get('mode') === 'clay';
const size = Number(params.get('size') ?? 1254);
const textureSize = Number(params.get('tex') ?? 256);
// The authored tiling pitch. Blocks declare their own; the default is one module.
const pitch = Number(params.get('pitch') ?? 0.6);
const axis = (params.get('axis') ?? 'z') as 'x' | 'z';
const count = Number(params.get('count') ?? 8);
// Platform extent to stand the block on, so the ink band's width matches a real piece.
const platformExtent = Number(params.get('platform') ?? 0);
const platformColor = params.get('platformColor') ?? '#8b72ff';

const factory = FACTORIES[blockId];
if (!factory) {
  throw new Error(`no factory registered for "${blockId}"; known: ${Object.keys(FACTORIES).join(', ')}`);
}

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(size, size);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcecece);

// ---------------------------------------------------------------------------
// build one template, then clone or instance it
// ---------------------------------------------------------------------------

// One template per session for the same reason PlayerVisual keeps one: the factory
// rasterises several procedural maps per material and repeating that per copy would
// repeat the whole cost. userData goes first because the sculpt runtime holds
// circular Object3D references that make clone() throw.
const template = factory({ textureSize });
const runtime = template.userData.sculptRuntime as {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
} | undefined;
const runtimeNodeIds = runtime ? Object.keys(runtime.nodes) : [];
const runtimeSocketIds = runtime ? Object.keys(runtime.sockets) : [];
const runtimeMeshIds = runtime ? Object.keys(runtime.meshes) : [];
template.traverse((node) => { node.userData = {}; });

/**
 * Measure the block, ignoring the two things that poison a naive Box3.
 *
 * A factory authors in its own frame and its bounding box can read a bogus extent
 * from an invisible 1x1x1 stub cube left behind as a container, or from an
 * InstancedMesh whose per-instance matrices place copies far from the geometry the
 * box is computed over. The runner read a 1.000u width exactly this way. So measure
 * over world-space vertices of visible, non-degenerate meshes and expand
 * InstancedMesh geometry through each instance matrix, and report what was skipped
 * rather than silently dropping it. Same intent as fitToPlaySpace() in
 * components/game/PlayerVisual.tsx, which normalises the runner - read, not imported.
 */
function measure(root: THREE.Object3D) {
  const box = new THREE.Box3();
  const raw = new THREE.Box3();
  const stubs: string[] = [];
  const vertex = new THREE.Vector3();
  const instanceMatrix = new THREE.Matrix4();
  root.updateMatrixWorld(true);
  root.traverse((child) => {
    const mesh = child as THREE.Mesh & { isInstancedMesh?: boolean; count?: number };
    if (!mesh.isMesh) return;
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!position) return;

    mesh.geometry.computeBoundingBox();
    const extent = mesh.geometry.boundingBox!.getSize(new THREE.Vector3());
    const unitCube = Math.abs(extent.x - 1) < 1e-6
      && Math.abs(extent.y - 1) < 1e-6
      && Math.abs(extent.z - 1) < 1e-6;
    const material = mesh.material as THREE.Material & { opacity?: number };
    const invisible = !mesh.visible
      || (material?.transparent === true && (material.opacity ?? 1) <= 0.001);
    const isStub = invisible || (unitCube && mesh.name === '');
    if (isStub) stubs.push(mesh.name || '(anonymous)');

    // Both boxes walk the instance matrices; the only difference between them is
    // whether stubs are admitted. Measuring `raw` off unplaced geometry instead
    // would make every model with an InstancedMesh look stub-poisoned, which is a
    // false alarm that trains you to ignore the real one.
    const matrices = mesh.isInstancedMesh
      ? Array.from({ length: mesh.count ?? 0 }, (_, n) => {
        (mesh as unknown as THREE.InstancedMesh).getMatrixAt(n, instanceMatrix);
        return instanceMatrix.clone().premultiply(mesh.matrixWorld);
      })
      : [mesh.matrixWorld];
    for (const matrix of matrices) {
      for (let i = 0; i < position.count; i += 1) {
        vertex.fromBufferAttribute(position, i).applyMatrix4(matrix);
        raw.expandByPoint(vertex);
        if (!isStub) box.expandByPoint(vertex);
      }
    }
  });
  const extent = box.getSize(new THREE.Vector3());
  const rawExtent = raw.getSize(new THREE.Vector3());
  return { box, extent, rawExtent, stubs, poisoned: extent.distanceTo(rawExtent) > 1e-4 };
}

function countTriangles(root: THREE.Object3D): number {
  let total = 0;
  root.traverse((child) => {
    const mesh = child as THREE.Mesh & { isInstancedMesh?: boolean; count?: number };
    if (!mesh.isMesh) return;
    const index = mesh.geometry.getIndex();
    const position = mesh.geometry.getAttribute('position');
    const per = Math.floor((index ? index.count : (position?.count ?? 0)) / 3);
    total += per * (mesh.isInstancedMesh ? (mesh.count ?? 1) : 1);
  });
  return total;
}

const measured = measure(template);
const singleTriangles = countTriangles(template);

// ---------------------------------------------------------------------------
// mock platform, built the way LevelGeometry builds one
// ---------------------------------------------------------------------------

/**
 * The five stacked boxes LevelGeometry gives every piece: the body, the ink plinth
 * under it, the ink cap sunk into its top, and the washed deck inside that cap. The
 * band of ink left showing between the cap's edge and the deck's edge is the whole
 * point - it is what makes an edge visible against the sky - so a block reviewed on
 * top of a platform has to be reviewed with that band present.
 */
function mockPlatform(extent: number, colour: string): THREE.Group {
  const group = new THREE.Group();
  group.name = 'mock-platform';
  const height = 0.8;
  const deck = Math.max(extent - DECK_EDGE * 2, extent * 0.5);
  const washed = new THREE.Color(colour).lerp(new THREE.Color(PALETTE.cream), DECK_WASH);

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(extent, height, extent),
    new THREE.MeshStandardMaterial({ color: colour, roughness: 0.7, metalness: 0.03 }),
  );
  body.name = 'mock-platform-body';
  body.position.y = -height / 2;
  body.receiveShadow = true;
  group.add(body);

  const cap = new THREE.Mesh(
    new THREE.BoxGeometry(extent * 0.995, 0.07, extent * 0.995),
    new THREE.MeshStandardMaterial({ color: PALETTE.ink, roughness: 0.85 }),
  );
  cap.name = 'mock-platform-ink-band';
  cap.position.y = 0.02;
  cap.receiveShadow = true;
  group.add(cap);

  const surface = new THREE.Mesh(
    new THREE.BoxGeometry(deck, 0.05, deck),
    new THREE.MeshStandardMaterial({ color: washed, roughness: 0.9 }),
  );
  surface.name = 'mock-platform-deck';
  surface.position.y = 0.05;
  surface.receiveShadow = true;
  group.add(surface);
  return group;
}

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

const copies: THREE.Object3D[] = [];
const root = new THREE.Group();
root.name = 'block-harness-root';

function place(n: number): void {
  for (let i = 0; i < n; i += 1) {
    const copy = template.clone(true);
    copy.name = `${blockId}-copy-${i}`;
    const offset = (i - (n - 1) / 2) * pitch;
    copy.position[axis] = offset;
    root.add(copy);
    copies.push(copy);
  }
}

const tiling = view.startsWith('tile') || view === 'seam' || view === 'course';
if (tiling) {
  place(view === 'course' ? Math.max(count, 24) : count);
} else {
  place(1);
}

if (platformExtent > 0) {
  // The deck's walkable surface sits at y = 0 in this harness, matching the way a
  // piece's collider top is centre.y + size.y/2 while the visual deck rides 0.075
  // above it. Stand the run ON that deck rather than translating it there: a factory
  // authors in its own frame and a block whose origin is its centre would otherwise
  // hover by half its height, which reads in the render as a modelling fault that
  // is not there. Same normalisation fitToPlaySpace() does for the runner, without
  // the rescale - a block's authored size is the thing under review.
  root.position.y = 0.075 - measure(root).box.min.y;
  scene.add(mockPlatform(platformExtent, platformColor));
}
scene.add(root);

if (clay) {
  const clayMaterial = new THREE.MeshStandardMaterial({ color: 0xbdbdbd, roughness: 0.85 });
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) mesh.material = clayMaterial;
  });
}

// ---------------------------------------------------------------------------
// seam measurement
// ---------------------------------------------------------------------------

/**
 * The number that decides whether these are blocks or just props laid in a row.
 *
 * For each adjacent pair, the gap is the next copy's low face minus this copy's high
 * face along the tiling axis. Zero means the edges meet. Positive is a hairline of
 * background showing through on every repeat; negative is z-fighting on every repeat.
 * Both are visible at a glance once the run is long enough, which is why this is
 * measured rather than eyeballed.
 */
function seamReport() {
  if (copies.length < 2) return null;
  const bounds = copies.map((copy) => measure(copy).box);
  const key = axis === 'x' ? 'x' : 'z';
  const gaps: number[] = [];
  for (let i = 1; i < bounds.length; i += 1) {
    gaps.push(bounds[i]!.min[key] - bounds[i - 1]!.max[key]);
  }
  const worst = gaps.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
  const spread = Math.max(...gaps) - Math.min(...gaps);
  const footprint = measured.extent[key];
  return {
    axis: key,
    pitch,
    footprintAlongAxis: Number(footprint.toFixed(6)),
    // A block whose footprint equals its pitch tiles edge to edge. Anything else is
    // an authoring error unless the block deliberately leaves a reveal.
    pitchMinusFootprint: Number((pitch - footprint).toFixed(6)),
    gaps: gaps.map((g) => Number(g.toFixed(6))),
    worstGap: Number(worst.toFixed(6)),
    gapSpread: Number(spread.toFixed(6)),
    meets: Math.abs(worst) <= 1e-4,
  };
}

/**
 * How far from a platform's centre this block can be placed before it eats the ink
 * edge band.
 *
 * The band is the ring of plinth colour between the cap edge (extent x 0.995 / 2)
 * and the deck edge (extent / 2 - DECK_EDGE), 0.110u to 0.127u wide depending on the
 * piece. It is the only thing making a platform edge visible: a deck against the sky
 * measures 1.18:1 while ink against it measures 13.74:1.
 *
 * The useful number is not "is this one render overlapping" - a course view
 * deliberately runs off both ends of the mock platform - but the placement envelope:
 * deck half-extent minus block half-extent. Negative means the block cannot sit on a
 * platform this size at all without covering the band, whatever the offset. This
 * matters most for railings, which want to be at the edge and are exactly the block
 * that can destroy it.
 */
function edgeBandReport() {
  if (platformExtent <= 0) return null;
  const half = platformExtent / 2;
  const deckHalf = Math.max(half - DECK_EDGE, half * 0.5);
  const bandWidth = (platformExtent * 0.995) / 2 - deckHalf;
  const blockHalf = { x: measured.extent.x / 2, z: measured.extent.z / 2 };
  const envelope = { x: deckHalf - blockHalf.x, z: deckHalf - blockHalf.z };
  const worst = Math.min(envelope.x, envelope.z);
  return {
    platformExtent,
    bandWidth: Number(bandWidth.toFixed(6)),
    deckHalfExtent: Number(deckHalf.toFixed(6)),
    blockHalfExtent: { x: Number(blockHalf.x.toFixed(6)), z: Number(blockHalf.z.toFixed(6)) },
    maxCentreOffset: { x: Number(envelope.x.toFixed(6)), z: Number(envelope.z.toFixed(6)) },
    worstClearance: Number(worst.toFixed(6)),
    swallowsBand: worst < 0,
  };
}

// ---------------------------------------------------------------------------
// cost
// ---------------------------------------------------------------------------

const MAX_COURSE_LENGTH = 285;

function costReport() {
  const perCopyDrawCalls = new Set<THREE.Material>();
  template.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((m) => perCopyDrawCalls.add(m));
    else perCopyDrawCalls.add(material);
  });
  const instancesOverCourse = Math.ceil(MAX_COURSE_LENGTH / pitch);
  return {
    trianglesPerBlock: singleTriangles,
    materialsPerBlock: perCopyDrawCalls.size,
    instancesOverCourse,
    courseTriangles: singleTriangles * instancesOverCourse,
    // A cloned copy costs one draw call per material it carries, every frame, plus
    // the same again in the shadow pass. Instanced, the whole run costs one call per
    // material however long the course is. This is the entire argument for
    // instancing blocks and the reason the figure is reported at every pass.
    drawCallsCloned: perCopyDrawCalls.size * instancesOverCourse,
    drawCallsInstanced: perCopyDrawCalls.size,
  };
}

// ---------------------------------------------------------------------------
// lighting and camera
// ---------------------------------------------------------------------------

const rig = new THREE.Group();
rig.name = 'block-review-rig';
rig.add(new THREE.HemisphereLight(0xffeed2, 0xe4d6be, Number(params.get('hemi') ?? 3.2)));
const key = new THREE.DirectionalLight(0xffe9c9, Number(params.get('key') ?? 1.5));
key.position.set(-2.5, 6.5, 4.0);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
rig.add(key);
const rim = new THREE.DirectionalLight(0xfff1c4, Number(params.get('rim') ?? 0.4));
rim.position.set(3.0, 2.0, -5.0);
rig.add(rim);
scene.add(rig);

const VIEWS: Record<string, { azimuthDeg: number; elevationDeg: number; fov: number }> = {
  single: { azimuthDeg: 41, elevationDeg: 19, fov: 28 },
  front: { azimuthDeg: 0, elevationDeg: 6, fov: 28 },
  side: { azimuthDeg: 90, elevationDeg: 6, fov: 28 },
  top: { azimuthDeg: 41, elevationDeg: 62, fov: 28 },
  grazing: { azimuthDeg: 20, elevationDeg: 3, fov: 28 },
  'tile-run': { azimuthDeg: 32, elevationDeg: 22, fov: 32 },
  'tile-flat': { azimuthDeg: 0, elevationDeg: 4, fov: 30 },
  // Player eye height over the deck, looking down the run: what repetition actually
  // looks like in play, which is where wallpaper shows up and a three-quarter hero
  // shot hides it.
  course: { azimuthDeg: 4, elevationDeg: 8, fov: 55 },
  // Hard on the join between the middle two copies at a grazing angle, because a
  // seam that survives a hero shot still shows when the light rakes across it.
  seam: { azimuthDeg: 62, elevationDeg: 7, fov: 34 },
};
const settings = VIEWS[view] ?? VIEWS.single!;

const camera = new THREE.PerspectiveCamera(
  Number(params.get('fov') ?? settings.fov), 1, 0.02, 400,
);
// The seam view exists to answer one question - does the join between two copies
// show - so it frames that join and nothing else. Fitting it to the whole run, as
// every other view does, just dollies back until the seam is a few pixels wide,
// which is exactly the framing that lets a bad seam through.
const seamView = view === 'seam' && copies.length >= 2;
const framed = seamView
  ? measure(copies[Math.floor(copies.length / 2)]!)
  : measure(scene);
const look = framed.box.getCenter(new THREE.Vector3());
if (seamView) look[axis] = framed.box.min[axis];
const radius = seamView
  ? framed.box.getSize(new THREE.Vector3()).length() * 0.55
  : framed.box.getSize(new THREE.Vector3()).length();
const azimuth = THREE.MathUtils.degToRad(Number(params.get('azim') ?? settings.azimuthDeg));
const elevation = THREE.MathUtils.degToRad(Number(params.get('elev') ?? settings.elevationDeg));
const margin = Number(params.get('margin') ?? 1.15);
const distance = (radius / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * margin;
camera.position.set(
  look.x + Math.sin(azimuth) * Math.cos(elevation) * distance,
  look.y + Math.sin(elevation) * distance,
  look.z + Math.cos(azimuth) * Math.cos(elevation) * distance,
);
camera.lookAt(look);
camera.updateProjectionMatrix();
camera.updateMatrixWorld(true);

renderer.render(scene, camera);

const globals = window as unknown as Record<string, unknown>;
globals.__blockStats = {
  block: blockId,
  view,
  axis,
  pitch,
  copies: copies.length,
  triangles: renderer.info.render.triangles,
  drawCalls: renderer.info.render.calls,
  measured: {
    extent: measured.extent.toArray().map((v) => Number(v.toFixed(6))),
    rawExtentIncludingStubs: measured.rawExtent.toArray().map((v) => Number(v.toFixed(6))),
    boxPoisonedByStubs: measured.poisoned,
    skippedStubMeshes: measured.stubs,
  },
  seam: seamReport(),
  edgeBand: edgeBandReport(),
  cost: costReport(),
  runtime: { nodeIds: runtimeNodeIds, socketIds: runtimeSocketIds, meshIds: runtimeMeshIds },
};
globals.__blockReady = true;
