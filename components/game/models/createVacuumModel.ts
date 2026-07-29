// --- img2threejs refine-code edits applied by assets/reference/props/refine_props.py
// 1. buildLatheGeometry honours latheProfile.phiStart / phiLength (applied).
// 2. buildExtrudeGeometry honours profile2D.steps / profileStops / profileExempt /
//    axis / axisOffset / smoothShading (applied).
// 3. SculptMaterialSpec gets a real type; non-null assertions where the generator
//    indexes arrays, both for the project's strict tsconfig and eslint settings.
// 4. attachment.geometryFromSpec keeps the authored primitive instead of the
//    generator's cylinder-between-endpoints (applied).
// 5. primitive tessellation reduced for a prop that is instanced across a level,
//    including the torus, whose 24x96 was the most expensive primitive emitted.
// 6. duplicated userData payloads become references (same API, smaller file).
// 7. repetition-system InstancedMeshes registered into `meshes` so the harness's
//    per-part world Box3 dump can see them (0 registered).
// Re-apply with: python assets/reference/props/refine_props.py <this file>
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptTextureProjection = {
  [key: string]: unknown;
  anisotropy?: number;
};

type SculptReferencePbr = {
  [key: string]: unknown;
  usable?: unknown;
  confidence?: unknown;
  estimatedFidelity?: unknown;
  targetThreshold?: unknown;
  maps?: unknown;
};

// The nested shapes keep their own index signature so a spec literal carrying extra keys is
// not rejected as an excess property. Only these fields are ever property-accessed;
// everything else reaches readLayerNumber, which already takes `unknown`.
type SculptMaterialSpec = {
  [key: string]: unknown;
  baseColor?: string;
  color?: string;
  albedo?: { [key: string]: unknown; dominant?: unknown; secondary?: unknown };
  colorVariation?: { [key: string]: unknown; palette?: unknown };
  colorGradient?: ColorGradientSpec;
  textureProjection?: SculptTextureProjection;
  textureResolution?: number;
  referencePbr?: SculptReferencePbr;
  doubleSided?: boolean;
};

// bevelEnabled defaults to true on THREE.ExtrudeGeometry and rounds every
// corner — sharp/pointed profiles (blades, fork tines, spikes) need
// bevelEnabled: false plus lineTo()-only path segments near the tip, since a
// curve command cannot produce a true converging point.
function buildExtrudeShape(points: [number, number][], holes?: [number, number][][]): THREE.Shape {
  const shape = new THREE.Shape();
  if (points.length > 0) {
    shape.moveTo(points[0]![0]!, points[0]![1]!);
    for (let i = 1; i < points.length; i += 1) {
      shape.lineTo(points[i]![0]!, points[i]![1]!);
    }
  }
  // Cutouts (e.g. an oval wire-cutter hole) as THREE.Path added to shape.holes —
  // dep-free boolean subtraction via the tessellator, no CSG library needed.
  for (const loop of holes ?? []) {
    if (loop.length < 3) continue;
    const path = new THREE.Path();
    path.moveTo(loop[0]![0]!, loop[0]![1]!);
    for (let i = 1; i < loop.length; i += 1) path.lineTo(loop[i]![0]!, loop[i]![1]!);
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

// Build an N-gon oval loop (for hole authoring from a compact {cx,cy,rx,ry} descriptor).
function ovalLoop(cx: number, cy: number, rx: number, ry: number, seg = 24): [number, number][] {
  const loop: [number, number][] = [];
  for (let i = 0; i < seg; i += 1) {
    const a = (i / seg) * Math.PI * 2;
    loop.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return loop;
}

type ExtrudeAxis = 'x' | '-x' | 'y' | '-y' | 'z';

type ExtrudeProfile = {
  points: [number, number][];
  depth: number;
  holes?: [number, number][][];
  ovalHoles?: { cx: number; cy: number; rx: number; ry: number }[];
  steps?: number;
  profileStops?: [number, number, number][];
  profileExempt?: [number, number];
  axis?: ExtrudeAxis;
  axisOffset?: number;
  smoothShading?: boolean;
};

// A straight prism is not the reference shape: a fridge shell rounds over at the top and a
// plinth bevels at both edges. profileStops are [t, scaleX, scaleY] samples along the
// extrusion; each vertex is scaled in the shape plane by the interpolated pair.
// profileExempt names shape-plane half-extents the profile must leave alone, which is what
// keeps a bore at a constant section while the wall around it tapers.
function applyExtrudeProfile(
  geometry: THREE.BufferGeometry,
  depth: number,
  stops: [number, number, number][],
  exempt?: [number, number],
): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const sorted = [...stops].sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    if (exempt && Math.abs(x) < exempt[0] && Math.abs(y) < exempt[1]) continue;
    const t = depth === 0 ? 0 : clamp01(position.getZ(i) / depth);
    let lo = sorted[0]!;
    let hi = sorted[sorted.length - 1]!;
    for (let s = 0; s < sorted.length - 1; s += 1) {
      if (t >= sorted[s]![0] && t <= sorted[s + 1]![0]) {
        lo = sorted[s]!;
        hi = sorted[s + 1]!;
        break;
      }
    }
    const span = hi[0] - lo[0];
    const k = span <= 1e-6 ? 0 : (t - lo[0]) / span;
    position.setX(i, x * THREE.MathUtils.lerp(lo[1], hi[1], k));
    position.setY(i, y * THREE.MathUtils.lerp(lo[2], hi[2], k));
  }
  position.needsUpdate = true;
}

// axis/axisOffset bake orientation and placement into the geometry so every component node
// can stay at the world origin with an identity rotation. That keeps parent frames
// world-aligned, which is what lets a handle be a plain child of the door it rides on.
function buildExtrudeGeometry(profile: ExtrudeProfile): THREE.ExtrudeGeometry {
  const holes = [...(profile.holes ?? []), ...((profile.ovalHoles ?? []).map((o) => ovalLoop(o.cx, o.cy, o.rx, o.ry)))];
  const shape = buildExtrudeShape(profile.points, holes);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: profile.depth,
    bevelEnabled: false,
    steps: profile.steps ?? 1,
  });
  if (profile.profileStops && profile.profileStops.length > 1) {
    applyExtrudeProfile(geometry, profile.depth, profile.profileStops, profile.profileExempt);
  }
  if (profile.axisOffset) geometry.translate(0, 0, profile.axisOffset);
  switch (profile.axis) {
    case 'x': geometry.rotateY(Math.PI / 2); break;
    case '-x': geometry.rotateY(-Math.PI / 2); break;
    case 'y': geometry.rotateX(-Math.PI / 2); break;
    case '-y': geometry.rotateX(Math.PI / 2); break;
    default: break;
  }
  // Non-indexed after the deformation. computeVertexNormals then gives one normal per
  // facet, which is the hard crease a moulded edge shows; smoothShading merges the
  // duplicated vertices first so a rounded shell reads as one continuous surface.
  if (profile.smoothShading) {
    const merged = mergeExtrudeVertices(geometry);
    merged.computeVertexNormals();
    return merged as THREE.ExtrudeGeometry;
  }
  geometry.computeVertexNormals();
  return geometry;
}

// ExtrudeGeometry emits non-indexed triangles, so neighbouring wall quads never share a
// vertex and computeVertexNormals cannot average across them. Welding by rounded position
// restores the shared vertices; without this a 48-sided rounded shell reads as 48 flat
// facets no matter how many sides it has.
function mergeExtrudeVertices(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const map = new Map<string, number>();
  const indices: number[] = [];
  const packed: number[] = [];
  const packedUv: number[] = [];
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    let index = map.get(key);
    if (index === undefined) {
      index = packed.length / 3;
      map.set(key, index);
      packed.push(x, y, z);
      if (uv) packedUv.push(uv.getX(i), uv.getY(i));
    }
    indices.push(index);
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(packed, 3));
  if (uv) merged.setAttribute('uv', new THREE.Float32BufferAttribute(packedUv, 2));
  merged.setIndex(indices);
  return merged;
}

// A full revolution is not the reference shape: a beach ball panel covers 59 degrees of
// longitude and a bowl rim is cut away at the back. phiStart/phiLength are already in the
// spec's latheProfile; LatheGeometry takes them directly.
function buildLatheGeometry(
  profile: { points: [number, number][]; segments?: number; phiStart?: number; phiLength?: number },
): THREE.LatheGeometry {
  const points = profile.points.map(([x, y]) => new THREE.Vector2(Math.max(0.0001, x), y));
  return new THREE.LatheGeometry(
    points,
    profile.segments ?? 24,
    profile.phiStart ?? 0,
    profile.phiLength ?? Math.PI * 2,
  );
}

function buildTubeGeometry(
  path: { points: [number, number, number][]; radius?: number; radialSegments?: number; closed?: boolean },
): THREE.TubeGeometry {
  const vectors = path.points.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const curve = new THREE.CatmullRomCurve3(vectors, path.closed ?? false);
  const tubularSegments = Math.max(8, path.points.length * 6);
  return new THREE.TubeGeometry(curve, tubularSegments, path.radius ?? 0.05, path.radialSegments ?? 8, path.closed ?? false);
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index]!;
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0]!;
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index]!;
  const b = colors[index + 1]!;
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index]!.color);
  const b = parseRgba(stops[index + 1]!.color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection: SculptTextureProjection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection: SculptTextureProjection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index]!;
      const dx = (heightField[y * size + right]! - heightField[y * size + left]!) * normalStrength * 6;
      const dy = (heightField[down + x]! - heightField[up + x]!) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left]! + heightField[y * size + right]!
        + heightField[up + x]! + heightField[down + x]!
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index]! * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions): THREE.MeshPhysicalMaterial {
  const textures = makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : new THREE.Color(typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F'),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clamp01(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: Math.max(1, readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: Math.max(1, readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clamp01(readLayerNumber(spec.specularIntensity, ['base'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    if (bumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = bumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    if (displacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = displacementScale;
      material.displacementBias = -displacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  // The joint is described, but the geometry is not derived from it. Without this the
  // component's authored primitive is replaced by a cylinder between the two endpoints
  // and its transform is discarded, which turns a swept helix into a smooth cone that
  // still fills the reference silhouette and so passes every pixel gate.
  if (record.geometryFromSpec === true) return null;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: Apartment Canister Vacuum
// Sculpt build pass: structural-pass
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createApartmentCanisterVacuumModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Apartment Canister Vacuum";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "solveMethod": "SINGLE-SOURCED AND NOT CONFIRMED. Pitch comes from ONE measurement: the ellipse axis ratio of the yellow top button, a circle in a horizontal plane, fitted by second moments, giving 28.1 +/- 3. The canister 'cross-check' that once accompanied it was one equation in two unknowns and is a plausibility check, not an independent solve. The contact-shadow route FAILED diagnostically: the shadow measures 855 px across against a 646 px canister at axis ratio 0.1854, flatter than that circle can project at ANY pitch, so it carries a raked key light's direction inseparably from the ground plane's foreshortening. That failure is kept because it tells the lighting pass the key is low and off to one side. The named honest second solve, if pitch precision is ever needed, is a CONIC FIT to the waist belt's front arc - a moment fit will not do, because only the front arc is visible, and the wheel hub is degenerate, mixing pitch with the wheel's own azimuth. YAW IS NOT SOLVED and is not needed: every reading this spec uses is either a horizontal extent, which yaw does not affect, or a horizontal-circle arc fit, which returns radius and height together.", "fovDegrees": 16.0, "aspect": 1.0, "orientation": {"yaw": 32.0, "pitch": -28.1, "roll": 0.0}, "targetHint": [0.0, 0.221, 0.0], "note": "Pitch 28.1 +/- 3 degrees; the button reads as a disc but is a moulded cap with a rounded edge, so its silhouette is marginally wider than the true circle and the recovered pitch is a slight underestimate. Yaw is a harness seed only. The camera is ORTHOGRAPHIC in every derivation here and the reference is a perspective render, which is the dominant error in the height solve and is recorded in risks."}, "approximationNotes": []};

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["body-lilac"] = createSculptMaterial(
    "body-lilac",
    {"id": "body-lilac", "name": "Canister shell", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#bca6da", "color": "#bca6da", "albedo": {"dominant": "#bca6da", "secondary": ["#a690c6", "#d3c2ea"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#bca6da", "#a690c6", "#d3c2ea"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.58, "variation": 0.07, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; crowns and handled edges trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.36, "contactShadowBias": 0.3, "notes": "Darken every part seam, recess and contact ring."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "body-underside-occlusion", "target": "vacuum-body/body-roll-under", "notes": "The canister's underside turns away from the key and is the darkest lilac in the frame; the reference's roll-under reads as a soft band rather than a terminator, so the falloff is broad.", "evidenceRefs": ["full-object", "body-zone"], "roughness": 0.64, "aoBoost": 0.58, "mask": "the body below the widest band and the throat behind the wheels"}, {"id": "body-crown-sheen", "target": "vacuum-body/body-top-face", "notes": "The top face is the one broad soft highlight on the body and is what makes the shell read as a moulded lid rather than a painted drum.", "evidenceRefs": ["full-object", "body-zone"], "roughness": 0.5, "mask": "the top face inside the rim roll"}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\crops\\body-lilac-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.84, "estimatedFidelity": 0.84, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\pbr\\body-lilac_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\pbr\\body-lilac_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\pbr\\body-lilac_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\pbr\\body-lilac_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\pbr\\body-lilac_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "Matte injection-moulded ABS. Measured #bca6da and SHIPPED at that value rather than corrected to PALETTE.purple, which is a different colour at #8b72ff, not a correction of this one."},
    options
  );
  materialMap["hose-navy"] = createSculptMaterial(
    "hose-navy",
    {"id": "hose-navy", "name": "Hose, belt and collar", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#374c72", "color": "#374c72", "albedo": {"dominant": "#374c72", "secondary": ["#26365a", "#4d6591"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#374c72", "#26365a", "#4d6591"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.66, "variation": 0.08, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; crowns and handled edges trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.42, "contactShadowBias": 0.3, "notes": "Darken every part seam, recess and contact ring."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "hose-groove-occlusion", "target": "vacuum-hose/hose-corrugation", "notes": "Each corrugation groove holds shadow the crown does not, which is the whole reason the hose reads as ribbed at distance rather than as a smooth navy tube.", "evidenceRefs": ["full-object", "hose-zone"], "roughness": 0.72, "aoBoost": 0.66, "mask": "the rib valleys along the hose"}, {"id": "collar-seat-shadow", "target": "vacuum-collar/collar-boss", "notes": "The collar's root darkens hard where it meets the curved flank; the reference shows a crisp crescent there rather than a soft blend.", "evidenceRefs": ["full-object", "collar-zone"], "aoBoost": 0.62, "mask": "the ring where the boss meets the body"}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\crops\\hose-navy-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.82, "estimatedFidelity": 0.82, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\pbr\\hose-navy_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\pbr\\hose-navy_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\pbr\\hose-navy_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\pbr\\hose-navy_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\pbr\\hose-navy_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "The darkest value on the prop and the one that carries its read at distance. Measured #374c72, which is not the #24324a the hand-authored props share; the reference's own value is shipped, because this rebuild's whole premise is that the reference is the source of truth."},
    options
  );
  materialMap["nozzle-cream"] = createSculptMaterial(
    "nozzle-cream",
    {"id": "nozzle-cream", "name": "Floor head", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#f9e9c4", "color": "#f9e9c4", "albedo": {"dominant": "#f9e9c4", "secondary": ["#e6d5ac", "#fffbee"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#f9e9c4", "#e6d5ac", "#fffbee"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.6, "variation": 0.06, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; crowns and handled edges trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.34, "contactShadowBias": 0.3, "notes": "Darken every part seam, recess and contact ring."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "nozzle-slot-occlusion", "target": "vacuum-nozzle/nozzle-slot", "notes": "A long recessed slot runs the head's front face and is the only hard dark line on the cream.", "evidenceRefs": ["full-object", "nozzle-zone"], "roughness": 0.68, "aoBoost": 0.7, "mask": "the suction slot along the front face"}, {"id": "nozzle-crown-sheen", "target": "vacuum-nozzle-boss/boss-dome", "notes": "The boss where the hose lands is the head's only convex crown and takes the key cleanly.", "evidenceRefs": ["full-object", "nozzle-zone"], "roughness": 0.52, "mask": "the dome of the hose boss"}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\crops\\nozzle-cream-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.82, "estimatedFidelity": 0.82, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\pbr\\nozzle-cream_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\pbr\\nozzle-cream_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\pbr\\nozzle-cream_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\pbr\\nozzle-cream_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\pbr\\nozzle-cream_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "The palest value on the prop. Warm cream, distinctly lighter than the yellow it sits near, which is why the two masks needed a saturation split rather than a luminance one."},
    options
  );
  materialMap["wheel-coral"] = createSculptMaterial(
    "wheel-coral",
    {"id": "wheel-coral", "name": "Wheel and nub", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#eb8273", "color": "#eb8273", "albedo": {"dominant": "#eb8273", "secondary": ["#cf6a5c", "#f79c8d"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#eb8273", "#cf6a5c", "#f79c8d"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.62, "variation": 0.07, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; crowns and handled edges trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.3, "notes": "Darken every part seam, recess and contact ring."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "tyre-crown-sheen", "target": "vacuum-wheel-right/wheel-tyre-roll", "notes": "The tyre's rolled edge catches a bright rim all the way round, which is what separates the wheel from the body behind it.", "evidenceRefs": ["full-object", "wheel-zone"], "roughness": 0.54, "mask": "the outer roll of the tyre"}, {"id": "wheel-body-shadow", "target": "vacuum-wheel-right/wheel-standoff", "notes": "The body throws a hard shadow onto the wheel's inboard face where the two nearly meet.", "evidenceRefs": ["full-object", "wheel-zone"], "aoBoost": 0.64, "mask": "the wheel's inboard face"}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\crops\\wheel-coral-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.8, "estimatedFidelity": 0.8, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\pbr\\wheel-coral_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\pbr\\wheel-coral_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\pbr\\wheel-coral_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\pbr\\wheel-coral_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\pbr\\wheel-coral_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "The prop's only warm saturated accent, and the second strongest value after the navy."},
    options
  );
  materialMap["trim-mint"] = createSculptMaterial(
    "trim-mint",
    {"id": "trim-mint", "name": "Carry handle and hose cuff", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#91c4ae", "color": "#91c4ae", "albedo": {"dominant": "#91c4ae", "secondary": ["#77a894", "#b0dcc7"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#91c4ae", "#77a894", "#b0dcc7"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.57, "variation": 0.07, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; crowns and handled edges trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.34, "contactShadowBias": 0.3, "notes": "Darken every part seam, recess and contact ring."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "handle-crown-sheen", "target": "vacuum-handle/handle-arch", "notes": "The arch's crown carries a continuous soft highlight along its length, which is what reads as a round bar rather than a flat strap.", "evidenceRefs": ["full-object", "handle-zone"], "roughness": 0.5, "mask": "the upper third of the arch"}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\crops\\trim-mint-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.82, "estimatedFidelity": 0.82, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\pbr\\trim-mint_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\pbr\\trim-mint_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\pbr\\trim-mint_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\pbr\\trim-mint_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\pbr\\trim-mint_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "Matte plastic, marginally smoother than the shell. Measured #91c4ae and shipped at that value; PALETTE.green #57dfa1 is a far more saturated mint and would pull the handle forward of the body it sits on."},
    options
  );
  materialMap["accent-yellow"] = createSculptMaterial(
    "accent-yellow",
    {"id": "accent-yellow", "name": "Top button and hub caps", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#fdda9c", "color": "#fdda9c", "albedo": {"dominant": "#fdda9c", "secondary": ["#e5c184", "#fff0c4"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#fdda9c", "#e5c184", "#fff0c4"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.55, "variation": 0.06, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; crowns and handled edges trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.32, "contactShadowBias": 0.3, "notes": "Darken every part seam, recess and contact ring."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "button-edge-catch", "target": "vacuum-button/button-cap", "notes": "The button is a moulded cap with a rounded edge, not a printed disc: its side wall adds about 15 px of image height beyond what a flat circle at this pitch would, which is the measurement that reconciled its bounding box with the solved camera.", "evidenceRefs": ["full-object", "body-zone"], "roughness": 0.48, "mask": "the button's rounded side wall"}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\crops\\accent-yellow-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.8, "estimatedFidelity": 0.8, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\pbr\\accent-yellow_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\pbr\\accent-yellow_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\pbr\\accent-yellow_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\pbr\\accent-yellow_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\vacuum\\pbr\\accent-yellow_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "The smallest albedo on the prop at 2.8 percent of its area, and the one the camera solve was taken from."},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const attachment_vacuum_body_0 = null;
  const endpoint_vacuum_body_0 = makeAttachmentEndpoint(attachment_vacuum_body_0);
  const node_vacuum_body_0 = new THREE.Group();
  node_vacuum_body_0.name = "Canister shell__pivot";
  if (endpoint_vacuum_body_0) {
    node_vacuum_body_0.position.copy(endpoint_vacuum_body_0.start);
    node_vacuum_body_0.rotation.set(0, 0, 0);
    node_vacuum_body_0.scale.set(1, 1, 1);
  } else {
    node_vacuum_body_0.position.set(0.0, 0.0, -0.096);
    node_vacuum_body_0.rotation.set(0.0, 0.0, 0.0);
    node_vacuum_body_0.scale.set(1.0, 1.0, 1.0);
  }
  node_vacuum_body_0.userData.sculptComponent = {"id": "vacuum-body", "name": "Canister shell", "level": "macro", "role": "shell", "importance": 1.0, "confidence": 0.8, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "One revolved drum. The reference shows no face, seam or edge anywhere on the shell: the floor contact, the widest band and the top face run into each other as one moulded casting, and every shading break on it is curvature rather than geometry.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(188, 166, 218, 1.0)", "secondaryAlbedo": "rgba(169, 149, 196, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "profile revolved about Y: floor contact at 0.6508 of the maximum radius, widest band at 0.575 of the height, top face at 0.7492", "edgeTreatment": {"type": "rolled", "bevelRadius": 0.04, "segments": 24}, "deformationStack": ["rim roll into the top face", "roll-under to the floor contact"], "uvStrategy": "LatheGeometry cylindrical UVs", "normalStrategy": "smooth vertex normals from the revolved profile", "latheProfile": {"points": [[0.0, 0.0], [0.164, 0.0], [0.2278, 0.0], [0.259, 0.0353], [0.2975, 0.0794], [0.3255, 0.1323], [0.3412, 0.1852], [0.35, 0.2359], [0.3479, 0.2708], [0.343, 0.2941], [0.337, 0.3175], [0.3321, 0.3409], [0.3297, 0.3524], [0.3188, 0.3876], [0.2992, 0.4145], [0.2622, 0.441], [0.2438, 0.441], [0.0, 0.441]], "segments": 24, "phiStart": 0.0, "phiLength": 6.283185}}, "parent": null, "attachment": null, "dimensions": {"width": 0.7, "height": 0.441, "depth": 0.7, "units": "world", "confidence": 0.8}, "transform": {"position": [0.0, 0.0, -0.096], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0.0, 0.2536, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "floor", "localPosition": [0.0, 0.0, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Underside of the shell, on the deck plane at y = 0."}, {"id": "hose-port", "localPosition": [-0.2631, 0.1985, 0.2208], "localRotation": [0.0, -2.443461, 0.0], "notes": "Where the collar stands off the flank and the hose leaves."}, {"id": "top-face", "localPosition": [0.0, 0.441, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Centre of the top face, where the handle and button seat."}, {"id": "axle-right", "localPosition": [0.364, 0.1235, -0.07], "localRotation": [0.0, 0.0, 0.0], "notes": "Right wheel centre."}, {"id": "axle-left", "localPosition": [-0.364, 0.1235, -0.07], "localRotation": [0.0, 0.0, 0.0], "notes": "Left wheel centre."}], "collider": {"type": "cylinder", "offset": [0.0, 0.2205, 0.0], "scale": [0.7, 0.441, 0.7], "isTrigger": false, "notes": "Advisory proxy over the shell only. The gameplay collider is the CuboidCollider at the call site and is not derived from this."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "body-lilac", "materialLayers": ["body-lilac"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "body-roll-under", "description": "The shell's underside rolls in from the widest 0.35 to a floor contact of 0.2278, so it overhangs its own footprint all round. That overhang is not decoration: it is the room the nozzle parks in.", "geometry": "lathe profile narrowing below the widest band, fitted from the lower silhouette", "evidenceRefs": ["full-object", "body-zone"], "confidence": 0.8}, {"id": "body-widest-band", "description": "The body holds within 4 percent of its maximum radius across a BAND from 0.535 to 0.720 of its height, not at a single point. 9 of the 14 profile rows are measured off the reference's own silhouette scan. This is the finding that separates a drum from a ball: an earlier profile interpolated between three landmarks, narrowed straight off its single maximum, and rendered as a sphere.", "geometry": "lathe profile from a two-flank silhouette row scan", "evidenceRefs": ["full-object", "body-zone"], "confidence": 0.8}, {"id": "body-top-face", "description": "The top face is 0.7492 of the maximum radius, a domed lid rather than a full-width cap. This is the measurement that corrected the recorded height: a full-width cap is what the retracted H/D = 0.459 assumed.", "geometry": "lathe profile rolling in to the top face", "evidenceRefs": ["full-object", "body-zone"], "confidence": 0.7}], "surfaceDetail": {"macroRoughness": 0.58, "microRoughness": 0.07, "bumpAmplitude": 0.0, "normalPattern": "matte moulded ABS with very low tone drift", "displacementPattern": "none", "occlusionPattern": "broad occlusion under the widest band and behind both wheels", "edgeWearPattern": "none - the reference shell shows no wear", "notes": "The largest single albedo field on the prop at 32.5 percent of its area."}, "evidenceRefs": ["full-object", "body-zone"], "details": [], "fidelityTier": "blockout"};
  node_vacuum_body_0.userData.actionProfile = node_vacuum_body_0.userData.sculptComponent.actionProfile;
  (nodes["root"] ?? root).add(node_vacuum_body_0);
  nodes["vacuum-body"] = node_vacuum_body_0;
  const mesh_vacuum_body_0Geometry = endpoint_vacuum_body_0
    ? new THREE.CylinderGeometry(endpoint_vacuum_body_0.endRadius, endpoint_vacuum_body_0.baseRadius, endpoint_vacuum_body_0.length, 32, 12)
    : buildLatheGeometry({"points": [[0.0, 0.0], [0.164, 0.0], [0.2278, 0.0], [0.259, 0.0353], [0.2975, 0.0794], [0.3255, 0.1323], [0.3412, 0.1852], [0.35, 0.2359], [0.3479, 0.2708], [0.343, 0.2941], [0.337, 0.3175], [0.3321, 0.3409], [0.3297, 0.3524], [0.3188, 0.3876], [0.2992, 0.4145], [0.2622, 0.441], [0.2438, 0.441], [0.0, 0.441]], "segments": 24, "phiStart": 0.0, "phiLength": 6.283185});
  const mesh_vacuum_body_0 = new THREE.Mesh(
    mesh_vacuum_body_0Geometry,
    materialMap["body-lilac"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_vacuum_body_0.name = "Canister shell";
  if (endpoint_vacuum_body_0) {
    mesh_vacuum_body_0.position.copy(endpoint_vacuum_body_0.midpoint);
    mesh_vacuum_body_0.quaternion.copy(endpoint_vacuum_body_0.quaternion);
  }
  mesh_vacuum_body_0.castShadow = options.castShadow ?? true;
  mesh_vacuum_body_0.receiveShadow = options.receiveShadow ?? true;
  mesh_vacuum_body_0.userData.sculptComponent = node_vacuum_body_0.userData.sculptComponent;
  node_vacuum_body_0.add(mesh_vacuum_body_0);
  meshes["vacuum-body"] = mesh_vacuum_body_0;
  colliders["vacuum-body"] = {"type": "cylinder", "offset": [0.0, 0.2205, 0.0], "scale": [0.7, 0.441, 0.7], "isTrigger": false, "notes": "Advisory proxy over the shell only. The gameplay collider is the CuboidCollider at the call site and is not derived from this."};
  destructionGroups["body"] ??= [];
  destructionGroups["body"].push(node_vacuum_body_0);
  const socket_vacuum_body_floor_0 = new THREE.Object3D();
  socket_vacuum_body_floor_0.name = "floor";
  socket_vacuum_body_floor_0.position.set(0.0, 0.0, 0.0);
  socket_vacuum_body_floor_0.rotation.set(0.0, 0.0, 0.0);
  socket_vacuum_body_floor_0.userData.socket = {"id": "floor", "localPosition": [0.0, 0.0, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Underside of the shell, on the deck plane at y = 0."};
  node_vacuum_body_0.add(socket_vacuum_body_floor_0);
  sockets["vacuum-body:floor"] = socket_vacuum_body_floor_0;
  const socket_vacuum_body_hose_port_1 = new THREE.Object3D();
  socket_vacuum_body_hose_port_1.name = "hose-port";
  socket_vacuum_body_hose_port_1.position.set(-0.2631, 0.1985, 0.2208);
  socket_vacuum_body_hose_port_1.rotation.set(0.0, -2.443461, 0.0);
  socket_vacuum_body_hose_port_1.userData.socket = {"id": "hose-port", "localPosition": [-0.2631, 0.1985, 0.2208], "localRotation": [0.0, -2.443461, 0.0], "notes": "Where the collar stands off the flank and the hose leaves."};
  node_vacuum_body_0.add(socket_vacuum_body_hose_port_1);
  sockets["vacuum-body:hose-port"] = socket_vacuum_body_hose_port_1;
  const socket_vacuum_body_top_face_2 = new THREE.Object3D();
  socket_vacuum_body_top_face_2.name = "top-face";
  socket_vacuum_body_top_face_2.position.set(0.0, 0.441, 0.0);
  socket_vacuum_body_top_face_2.rotation.set(0.0, 0.0, 0.0);
  socket_vacuum_body_top_face_2.userData.socket = {"id": "top-face", "localPosition": [0.0, 0.441, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Centre of the top face, where the handle and button seat."};
  node_vacuum_body_0.add(socket_vacuum_body_top_face_2);
  sockets["vacuum-body:top-face"] = socket_vacuum_body_top_face_2;
  const socket_vacuum_body_axle_right_3 = new THREE.Object3D();
  socket_vacuum_body_axle_right_3.name = "axle-right";
  socket_vacuum_body_axle_right_3.position.set(0.364, 0.1235, -0.07);
  socket_vacuum_body_axle_right_3.rotation.set(0.0, 0.0, 0.0);
  socket_vacuum_body_axle_right_3.userData.socket = {"id": "axle-right", "localPosition": [0.364, 0.1235, -0.07], "localRotation": [0.0, 0.0, 0.0], "notes": "Right wheel centre."};
  node_vacuum_body_0.add(socket_vacuum_body_axle_right_3);
  sockets["vacuum-body:axle-right"] = socket_vacuum_body_axle_right_3;
  const socket_vacuum_body_axle_left_4 = new THREE.Object3D();
  socket_vacuum_body_axle_left_4.name = "axle-left";
  socket_vacuum_body_axle_left_4.position.set(-0.364, 0.1235, -0.07);
  socket_vacuum_body_axle_left_4.rotation.set(0.0, 0.0, 0.0);
  socket_vacuum_body_axle_left_4.userData.socket = {"id": "axle-left", "localPosition": [-0.364, 0.1235, -0.07], "localRotation": [0.0, 0.0, 0.0], "notes": "Left wheel centre."};
  node_vacuum_body_0.add(socket_vacuum_body_axle_left_4);
  sockets["vacuum-body:axle-left"] = socket_vacuum_body_axle_left_4;

  const attachment_vacuum_belt_1 = null;
  const endpoint_vacuum_belt_1 = makeAttachmentEndpoint(attachment_vacuum_belt_1);
  const node_vacuum_belt_1 = new THREE.Group();
  node_vacuum_belt_1.name = "Waist belt__pivot";
  if (endpoint_vacuum_belt_1) {
    node_vacuum_belt_1.position.copy(endpoint_vacuum_belt_1.start);
    node_vacuum_belt_1.rotation.set(0, 0, 0);
    node_vacuum_belt_1.scale.set(1, 1, 1);
  } else {
    node_vacuum_belt_1.position.set(0.0, 0.0, 0.0);
    node_vacuum_belt_1.rotation.set(0.0, 0.0, 0.0);
    node_vacuum_belt_1.scale.set(1.0, 1.0, 1.0);
  }
  node_vacuum_belt_1.userData.sculptComponent = {"id": "vacuum-belt", "name": "Waist belt", "level": "meso", "role": "trim", "importance": 0.6, "confidence": 0.6, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "A navy band wrapping the shell just above its widest point, standing marginally proud of it. The reference shows it as an unbroken ring with no fastener anywhere on its run.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(55, 76, 114, 1.0)", "secondaryAlbedo": "rgba(49, 68, 102, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "band of height 0.0412 revolved about Y at radius 0.3365, standing 0.005 proud of the shell", "edgeTreatment": {"type": "rolled", "bevelRadius": 0.006, "segments": 24}, "deformationStack": [], "uvStrategy": "LatheGeometry cylindrical UVs", "normalStrategy": "smooth vertex normals from the revolved profile", "latheProfile": {"points": [[0.3165, 0.2994], [0.3415, 0.3076], [0.3415, 0.3324], [0.3165, 0.3406]], "segments": 24, "phiStart": 0.0, "phiLength": 6.283185}}, "parent": "vacuum-body", "attachment": null, "dimensions": {"width": 0.683, "height": 0.0412, "depth": 0.683, "units": "world", "confidence": 0.6}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "trim", "pivot": {"mode": "center", "localPosition": [0.0, 0.32, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0.0, 0.32, 0.0], "scale": [0.683, 0.0412, 0.683], "isTrigger": false, "notes": "Advisory; the belt never touches anything."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "hose-navy", "materialLayers": ["hose-navy"], "deformations": [], "joints": [], "seams": [{"id": "belt-body-seam", "with": "vacuum-body", "overlap": 0.02, "notes": "The band's inner radius runs 0.02 inside the shell's own surface. It was 0.004, below the contract's floor; the inner radius dropped and the outer one did not, so nothing visible moved."}], "localFeatures": [{"id": "belt-band", "description": "The band is 0.0588 of the canister's diameter tall, the median of 98 column samples down the shell's right flank.", "geometry": "lathe profile height", "evidenceRefs": ["full-object", "body-zone"], "confidence": 0.8}, {"id": "belt-standoff", "description": "It stands 0.005 proud rather than being painted on: the reference's navy silhouette is 8 px wider than the lilac's at the same rows, which is a raised band seen edge-on.", "geometry": "lathe profile radius above the shell's own", "evidenceRefs": ["full-object", "body-zone"], "confidence": 0.65}], "surfaceDetail": {"macroRoughness": 0.66, "microRoughness": 0.08, "bumpAmplitude": 0.0, "normalPattern": "matte plastic, marginally rougher than the shell", "displacementPattern": "none", "occlusionPattern": "a hard occlusion line along both of the band's roots", "edgeWearPattern": "none", "notes": "The darkest band on the body and the value that separates its two lilac halves."}, "evidenceRefs": ["full-object", "body-zone"], "details": [], "fidelityTier": "blockout"};
  node_vacuum_belt_1.userData.actionProfile = node_vacuum_belt_1.userData.sculptComponent.actionProfile;
  (nodes["vacuum-body"] ?? root).add(node_vacuum_belt_1);
  nodes["vacuum-belt"] = node_vacuum_belt_1;
  const mesh_vacuum_belt_1Geometry = endpoint_vacuum_belt_1
    ? new THREE.CylinderGeometry(endpoint_vacuum_belt_1.endRadius, endpoint_vacuum_belt_1.baseRadius, endpoint_vacuum_belt_1.length, 32, 12)
    : buildLatheGeometry({"points": [[0.3165, 0.2994], [0.3415, 0.3076], [0.3415, 0.3324], [0.3165, 0.3406]], "segments": 24, "phiStart": 0.0, "phiLength": 6.283185});
  const mesh_vacuum_belt_1 = new THREE.Mesh(
    mesh_vacuum_belt_1Geometry,
    materialMap["hose-navy"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_vacuum_belt_1.name = "Waist belt";
  if (endpoint_vacuum_belt_1) {
    mesh_vacuum_belt_1.position.copy(endpoint_vacuum_belt_1.midpoint);
    mesh_vacuum_belt_1.quaternion.copy(endpoint_vacuum_belt_1.quaternion);
  }
  mesh_vacuum_belt_1.castShadow = options.castShadow ?? true;
  mesh_vacuum_belt_1.receiveShadow = options.receiveShadow ?? true;
  mesh_vacuum_belt_1.userData.sculptComponent = node_vacuum_belt_1.userData.sculptComponent;
  node_vacuum_belt_1.add(mesh_vacuum_belt_1);
  meshes["vacuum-belt"] = mesh_vacuum_belt_1;
  colliders["vacuum-belt"] = {"type": "cylinder", "offset": [0.0, 0.32, 0.0], "scale": [0.683, 0.0412, 0.683], "isTrigger": false, "notes": "Advisory; the belt never touches anything."};
  destructionGroups["body"] ??= [];
  destructionGroups["body"].push(node_vacuum_belt_1);

  const attachment_vacuum_collar_2 = {"parentId": "vacuum-body", "parentSocket": "hose-port", "contactType": "seated-on-flank", "localStart": [0.0, -0.0375, 0.0], "localEnd": [0.0, 0.0375, 0.0], "contactNormal": [0.0, 1.0, 0.0], "embedDepth": 0.03, "overlap": 0.03, "gapTolerance": 0.0, "baseRadius": 0.0969, "endRadius": 0.0969, "geometryFromSpec": true, "notes": "The boss's axis, from inside the shell to its outboard face. Declared because it is true and because a cylinder with a parent fails --strict-quality without one."};
  const endpoint_vacuum_collar_2 = makeAttachmentEndpoint(attachment_vacuum_collar_2);
  const node_vacuum_collar_2 = new THREE.Group();
  node_vacuum_collar_2.name = "Hose collar__pivot";
  if (endpoint_vacuum_collar_2) {
    node_vacuum_collar_2.position.copy(endpoint_vacuum_collar_2.start);
    node_vacuum_collar_2.rotation.set(0, 0, 0);
    node_vacuum_collar_2.scale.set(1, 1, 1);
  } else {
    node_vacuum_collar_2.position.set(-0.2631, 0.1985, 0.2208);
    node_vacuum_collar_2.rotation.set(0.0, -2.443461, -1.570796);
    node_vacuum_collar_2.scale.set(1.0, 1.0, 1.0);
  }
  node_vacuum_collar_2.userData.sculptComponent = {"id": "vacuum-collar", "name": "Hose collar", "level": "meso", "role": "socket", "importance": 0.7, "confidence": 0.7, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "A short navy boss standing off the shell's front-left flank, the socket the hose leaves through. The reference shows it as a stepped cylinder with a clear shoulder, not as a hole in the body.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(55, 76, 114, 1.0)", "secondaryAlbedo": "rgba(49, 68, 102, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "profile revolved about the outward radial at 140.0 degrees: a barrel of diameter 0.1939 rounding over at its outer end", "edgeTreatment": {"type": "rolled", "bevelRadius": 0.012, "segments": 20}, "deformationStack": [], "uvStrategy": "LatheGeometry cylindrical UVs about the boss axis", "normalStrategy": "smooth around the barrel and over the outer roll", "latheProfile": {"points": [[0.0, -0.0375], [0.0969, -0.0375], [0.0969, 0.015], [0.0853, 0.03], [0.0582, 0.0367], [0.0, 0.039]], "segments": 20, "phiStart": 0.0, "phiLength": 6.283185}}, "parent": "vacuum-body", "attachment": {"parentId": "vacuum-body", "parentSocket": "hose-port", "contactType": "seated-on-flank", "localStart": [0.0, -0.0375, 0.0], "localEnd": [0.0, 0.0375, 0.0], "contactNormal": [0.0, 1.0, 0.0], "embedDepth": 0.03, "overlap": 0.03, "gapTolerance": 0.0, "baseRadius": 0.0969, "endRadius": 0.0969, "geometryFromSpec": true, "notes": "The boss's axis, from inside the shell to its outboard face. Declared because it is true and because a cylinder with a parent fails --strict-quality without one."}, "dimensions": {"width": 0.1939, "height": 0.075, "depth": 0.1939, "units": "world", "confidence": 0.7}, "transform": {"position": [-0.2631, 0.1985, 0.2208], "rotation": [0.0, -2.443461, -1.570796], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "socket", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "hose-mouth", "localPosition": [0.0, 0.0375, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "The outboard face, where the hose's first sample sits."}], "collider": {"type": "cylinder", "offset": [0.0, 0.0, 0.0], "scale": [0.1939, 0.075, 0.1939], "isTrigger": false, "notes": "Advisory."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "hose-navy", "materialLayers": ["hose-navy"], "deformations": [], "joints": [], "seams": [{"id": "collar-body-seam", "with": "vacuum-body", "overlap": 0.03, "notes": "The boss is sunk 0.03 into the shell so no gap opens on the curve."}], "localFeatures": [{"id": "collar-boss", "description": "The boss is 0.277 of the canister's diameter across, measured from the navy region that survives once the hose limb is windowed out.", "geometry": "cylinder diameter on the body's outward radial", "evidenceRefs": ["full-object", "collar-zone"], "confidence": 0.7}], "surfaceDetail": {"macroRoughness": 0.66, "microRoughness": 0.08, "bumpAmplitude": 0.0, "normalPattern": "matte plastic matching the belt", "displacementPattern": "none", "occlusionPattern": "a crescent of hard occlusion where the boss meets the curved flank", "edgeWearPattern": "none", "notes": "The joint the hose's whole read depends on."}, "evidenceRefs": ["full-object", "collar-zone"], "details": [], "fidelityTier": "blockout"};
  node_vacuum_collar_2.userData.actionProfile = node_vacuum_collar_2.userData.sculptComponent.actionProfile;
  (nodes["vacuum-body"] ?? root).add(node_vacuum_collar_2);
  nodes["vacuum-collar"] = node_vacuum_collar_2;
  const mesh_vacuum_collar_2Geometry = endpoint_vacuum_collar_2
    ? new THREE.CylinderGeometry(endpoint_vacuum_collar_2.endRadius, endpoint_vacuum_collar_2.baseRadius, endpoint_vacuum_collar_2.length, 32, 12)
    : buildLatheGeometry({"points": [[0.0, -0.0375], [0.0969, -0.0375], [0.0969, 0.015], [0.0853, 0.03], [0.0582, 0.0367], [0.0, 0.039]], "segments": 20, "phiStart": 0.0, "phiLength": 6.283185});
  const mesh_vacuum_collar_2 = new THREE.Mesh(
    mesh_vacuum_collar_2Geometry,
    materialMap["hose-navy"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_vacuum_collar_2.name = "Hose collar";
  if (endpoint_vacuum_collar_2) {
    mesh_vacuum_collar_2.position.copy(endpoint_vacuum_collar_2.midpoint);
    mesh_vacuum_collar_2.quaternion.copy(endpoint_vacuum_collar_2.quaternion);
  }
  mesh_vacuum_collar_2.castShadow = options.castShadow ?? true;
  mesh_vacuum_collar_2.receiveShadow = options.receiveShadow ?? true;
  mesh_vacuum_collar_2.userData.sculptComponent = node_vacuum_collar_2.userData.sculptComponent;
  node_vacuum_collar_2.add(mesh_vacuum_collar_2);
  meshes["vacuum-collar"] = mesh_vacuum_collar_2;
  colliders["vacuum-collar"] = {"type": "cylinder", "offset": [0.0, 0.0, 0.0], "scale": [0.1939, 0.075, 0.1939], "isTrigger": false, "notes": "Advisory."};
  destructionGroups["body"] ??= [];
  destructionGroups["body"].push(node_vacuum_collar_2);
  const socket_vacuum_collar_hose_mouth_0 = new THREE.Object3D();
  socket_vacuum_collar_hose_mouth_0.name = "hose-mouth";
  socket_vacuum_collar_hose_mouth_0.position.set(0.0, 0.0375, 0.0);
  socket_vacuum_collar_hose_mouth_0.rotation.set(0.0, 0.0, 0.0);
  socket_vacuum_collar_hose_mouth_0.userData.socket = {"id": "hose-mouth", "localPosition": [0.0, 0.0375, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "The outboard face, where the hose's first sample sits."};
  node_vacuum_collar_2.add(socket_vacuum_collar_hose_mouth_0);
  sockets["vacuum-collar:hose-mouth"] = socket_vacuum_collar_hose_mouth_0;

  const attachment_vacuum_button_3 = {"parentId": "vacuum-body", "parentSocket": "top-face", "contactType": "seated-on-face", "localStart": [0.0, -0.017, 0.0], "localEnd": [0.0, 0.017, 0.0], "contactNormal": [0.0, 1.0, 0.0], "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0, "baseRadius": 0.0862, "endRadius": 0.0862, "geometryFromSpec": true, "notes": "The cap's axis through the top face."};
  const endpoint_vacuum_button_3 = makeAttachmentEndpoint(attachment_vacuum_button_3);
  const node_vacuum_button_3 = new THREE.Group();
  node_vacuum_button_3.name = "Top button__pivot";
  if (endpoint_vacuum_button_3) {
    node_vacuum_button_3.position.copy(endpoint_vacuum_button_3.start);
    node_vacuum_button_3.rotation.set(0, 0, 0);
    node_vacuum_button_3.scale.set(1, 1, 1);
  } else {
    node_vacuum_button_3.position.set(-0.0616, 0.438, 0.0412);
    node_vacuum_button_3.rotation.set(0.0, 0.0, 0.0);
    node_vacuum_button_3.scale.set(0.1723, 0.034, 0.1723);
  }
  node_vacuum_button_3.userData.sculptComponent = {"id": "vacuum-button", "name": "Top button", "level": "meso", "role": "control", "importance": 0.5, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "A yellow moulded cap on the top face, forward and left of the axis. It is a cap with a rounded side wall rather than a printed disc, which is what its silhouette shows.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(253, 218, 156, 1.0)", "secondaryAlbedo": "rgba(227, 196, 140, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "cylinder of diameter 0.1723 and thickness 0.034 standing on the top face", "edgeTreatment": {"type": "rolled", "bevelRadius": 0.006, "segments": 20}, "deformationStack": [], "uvStrategy": "planar UVs on the cap face", "normalStrategy": "smooth over the rolled edge, flat across the face"}, "parent": "vacuum-body", "attachment": {"parentId": "vacuum-body", "parentSocket": "top-face", "contactType": "seated-on-face", "localStart": [0.0, -0.017, 0.0], "localEnd": [0.0, 0.017, 0.0], "contactNormal": [0.0, 1.0, 0.0], "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0, "baseRadius": 0.0862, "endRadius": 0.0862, "geometryFromSpec": true, "notes": "The cap's axis through the top face."}, "dimensions": {"width": 0.1723, "height": 0.034, "depth": 0.1723, "units": "world", "confidence": 0.8}, "transform": {"position": [-0.0616, 0.438, 0.0412], "rotation": [0.0, 0.0, 0.0]}, "actionProfile": {"animationRole": "control", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0.0, 0.0, 0.0], "scale": [0.1723, 0.034, 0.1723], "isTrigger": false, "notes": "Advisory; the button is press-capable."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "accent-yellow", "materialLayers": ["accent-yellow"], "deformations": [], "joints": [], "seams": [{"id": "button-body-seam", "with": "vacuum-body", "overlap": 0.02, "notes": "The cap is 0.034 thick and sunk 0.02 into the top face, leaving the measured 0.014 proud. It was a 0.018 cap sunk 0.004 - below the floor, and a cap that thin CANNOT meet it, which is why the fix was to make it thicker and bury the difference rather than to raise the embed."}], "localFeatures": [{"id": "button-cap", "description": "The cap is 0.2461 of the canister's diameter across, read as a horizontal image extent and so unforeshortened. Its ellipse is what the camera pitch was solved from.", "geometry": "cylinder diameter on the top face", "evidenceRefs": ["full-object", "body-zone"], "confidence": 0.85}, {"id": "button-placement", "description": "It sits 0.0616 left of the axis and 0.0412 forward of it. The forward offset is not a style choice: it is what the corrected canister height implies, and it is the third route that rejected the retracted height.", "geometry": "component position on the top face", "evidenceRefs": ["full-object", "body-zone"], "confidence": 0.7}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.06, "bumpAmplitude": 0.0, "normalPattern": "matte plastic with a slightly polished crown", "displacementPattern": "none", "occlusionPattern": "a thin ring of occlusion at the cap's root", "edgeWearPattern": "none", "notes": "The smallest part on the prop and the one the camera was solved from."}, "evidenceRefs": ["full-object", "body-zone"], "details": [], "fidelityTier": "blockout"};
  node_vacuum_button_3.userData.actionProfile = node_vacuum_button_3.userData.sculptComponent.actionProfile;
  (nodes["vacuum-body"] ?? root).add(node_vacuum_button_3);
  nodes["vacuum-button"] = node_vacuum_button_3;
  const mesh_vacuum_button_3Geometry = endpoint_vacuum_button_3
    ? new THREE.CylinderGeometry(endpoint_vacuum_button_3.endRadius, endpoint_vacuum_button_3.baseRadius, endpoint_vacuum_button_3.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 32, 1);
  const mesh_vacuum_button_3 = new THREE.Mesh(
    mesh_vacuum_button_3Geometry,
    materialMap["accent-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_vacuum_button_3.name = "Top button";
  if (endpoint_vacuum_button_3) {
    mesh_vacuum_button_3.position.copy(endpoint_vacuum_button_3.midpoint);
    mesh_vacuum_button_3.quaternion.copy(endpoint_vacuum_button_3.quaternion);
  }
  mesh_vacuum_button_3.castShadow = options.castShadow ?? true;
  mesh_vacuum_button_3.receiveShadow = options.receiveShadow ?? true;
  mesh_vacuum_button_3.userData.sculptComponent = node_vacuum_button_3.userData.sculptComponent;
  node_vacuum_button_3.add(mesh_vacuum_button_3);
  meshes["vacuum-button"] = mesh_vacuum_button_3;
  colliders["vacuum-button"] = {"type": "cylinder", "offset": [0.0, 0.0, 0.0], "scale": [0.1723, 0.034, 0.1723], "isTrigger": false, "notes": "Advisory; the button is press-capable."};
  destructionGroups["body"] ??= [];
  destructionGroups["body"].push(node_vacuum_button_3);

  const attachment_vacuum_handle_4 = {"parentId": "vacuum-body", "parentSocket": "top-face", "contactType": "seated-in-face", "localStart": [0.1654, 0.421, 0.0602], "localEnd": [-0.1654, 0.421, -0.0602], "contactNormal": [0.0, 1.0, 0.0], "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0, "baseRadius": 0.035, "endRadius": 0.035, "geometryFromSpec": true, "notes": "Foot to foot across the top face. THE GEOMETRY IS NOT THIS LINE: without geometryFromSpec the generator would build a straight bar between these two points and throw the arch away, and the render would still pass every pixel gate from the reference angle because the arch is nearly edge-on there."};
  const endpoint_vacuum_handle_4 = makeAttachmentEndpoint(attachment_vacuum_handle_4);
  const node_vacuum_handle_4 = new THREE.Group();
  node_vacuum_handle_4.name = "Carry handle__pivot";
  if (endpoint_vacuum_handle_4) {
    node_vacuum_handle_4.position.copy(endpoint_vacuum_handle_4.start);
    node_vacuum_handle_4.rotation.set(0, 0, 0);
    node_vacuum_handle_4.scale.set(1, 1, 1);
  } else {
    node_vacuum_handle_4.position.set(0.0, 0.0, 0.0);
    node_vacuum_handle_4.rotation.set(0.0, 0.0, 0.0);
    node_vacuum_handle_4.scale.set(1.0, 1.0, 1.0);
  }
  node_vacuum_handle_4.userData.sculptComponent = {"id": "vacuum-handle", "name": "Carry handle", "level": "meso", "role": "handle", "importance": 0.7, "confidence": 0.7, "primitive": "tube", "topologyClass": "continuous-sculpt", "topologyRationale": "A round mint bar arching across the top face from back-left to front-right. There is no flat anywhere on it in the reference; its crown carries one continuous highlight, which is a round section rolling away from the key.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(145, 196, 174, 1.0)", "secondaryAlbedo": "rgba(130, 176, 156, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "round section of radius 0.035 swept along an arch spanning 0.3521 and rising 0.1484", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 10}, "deformationStack": [], "uvStrategy": "TubeGeometry UVs running along the arch", "normalStrategy": "smooth vertex normals from the swept section", "tubePath": {"points": [[0.1654, 0.421, 0.0602], [0.13232, 0.5305, 0.04816], [0.09924, 0.56185, 0.03612], [0.06616, 0.57881, 0.02408], [0.03308, 0.58716, 0.01204], [0.0, 0.5894, 0.0], [-0.03308, 0.58716, -0.01204], [-0.06616, 0.57881, -0.02408], [-0.09924, 0.56185, -0.03612], [-0.13232, 0.5305, -0.04816], [-0.1654, 0.421, -0.0602]], "radius": 0.035, "radialSegments": 8, "closed": false}}, "parent": "vacuum-body", "attachment": {"parentId": "vacuum-body", "parentSocket": "top-face", "contactType": "seated-in-face", "localStart": [0.1654, 0.421, 0.0602], "localEnd": [-0.1654, 0.421, -0.0602], "contactNormal": [0.0, 1.0, 0.0], "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0, "baseRadius": 0.035, "endRadius": 0.035, "geometryFromSpec": true, "notes": "Foot to foot across the top face. THE GEOMETRY IS NOT THIS LINE: without geometryFromSpec the generator would build a straight bar between these two points and throw the arch away, and the render would still pass every pixel gate from the reference angle because the arch is nearly edge-on there."}, "dimensions": {"width": 0.3521, "height": 0.1684, "depth": 0.1904, "units": "world", "confidence": 0.7}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "handle", "pivot": {"mode": "center", "localPosition": [0.0, 0.5052, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "grip", "localPosition": [0.0, 0.5894, 0.0], "localRotation": [0.0, 0.349066, 0.0], "notes": "The crown, and the prop's highest point."}], "collider": {"type": "box", "offset": [0.0, 0.5052, 0.0], "scale": [0.3521, 0.1684, 0.07], "isTrigger": false, "notes": "Advisory."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "trim", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "trim-mint", "materialLayers": ["trim-mint"], "deformations": [], "joints": [], "seams": [{"id": "handle-body-seam", "with": "vacuum-body", "overlap": 0.02, "notes": "Both feet run 0.02 below the top face rather than butting onto it."}], "localFeatures": [{"id": "handle-arch", "description": "The arch spans 0.503 of the canister's diameter and rises 0.212 of it. The rise is measured as the crown's height above the chord between the two feet AT MATCHED IMAGE X, so the depth term cancels and the 137 px is pure elevation.", "geometry": "tube path rise over its own chord", "evidenceRefs": ["full-object", "handle-zone"], "confidence": 0.75}, {"id": "handle-section", "description": "A round bar of radius 0.035, which at this span is a chunky toy handle rather than a wire loop.", "geometry": "TubeGeometry round cross-section, 8 radial segments", "evidenceRefs": ["full-object", "handle-zone"], "confidence": 0.7}, {"id": "handle-foot-angle", "description": "The arch leaves its feet steeply and flattens at the crown. Authored as a super-ellipse: a sine arch of the same span and rise leaves the foot at 53 degrees from horizontal, which reads as a croquet hoop rather than a handle.", "geometry": "super-ellipse exponent 2.2 on the rise", "evidenceRefs": ["full-object", "handle-zone"], "confidence": 0.6}], "surfaceDetail": {"macroRoughness": 0.57, "microRoughness": 0.07, "bumpAmplitude": 0.0, "normalPattern": "matte plastic, marginally smoother than the shell", "displacementPattern": "none", "occlusionPattern": "deep occlusion in the gap between the arch and the top face", "edgeWearPattern": "none", "notes": "The only part of the prop above the canister."}, "evidenceRefs": ["full-object", "handle-zone"], "details": [], "fidelityTier": "blockout"};
  node_vacuum_handle_4.userData.actionProfile = node_vacuum_handle_4.userData.sculptComponent.actionProfile;
  (nodes["vacuum-body"] ?? root).add(node_vacuum_handle_4);
  nodes["vacuum-handle"] = node_vacuum_handle_4;
  const mesh_vacuum_handle_4Geometry = endpoint_vacuum_handle_4
    ? new THREE.CylinderGeometry(endpoint_vacuum_handle_4.endRadius, endpoint_vacuum_handle_4.baseRadius, endpoint_vacuum_handle_4.length, 32, 12)
    : buildTubeGeometry({"points": [[0.1654, 0.421, 0.0602], [0.13232, 0.5305, 0.04816], [0.09924, 0.56185, 0.03612], [0.06616, 0.57881, 0.02408], [0.03308, 0.58716, 0.01204], [0.0, 0.5894, 0.0], [-0.03308, 0.58716, -0.01204], [-0.06616, 0.57881, -0.02408], [-0.09924, 0.56185, -0.03612], [-0.13232, 0.5305, -0.04816], [-0.1654, 0.421, -0.0602]], "radius": 0.035, "radialSegments": 8, "closed": false});
  const mesh_vacuum_handle_4 = new THREE.Mesh(
    mesh_vacuum_handle_4Geometry,
    materialMap["trim-mint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_vacuum_handle_4.name = "Carry handle";
  if (endpoint_vacuum_handle_4) {
    mesh_vacuum_handle_4.position.copy(endpoint_vacuum_handle_4.midpoint);
    mesh_vacuum_handle_4.quaternion.copy(endpoint_vacuum_handle_4.quaternion);
  }
  mesh_vacuum_handle_4.castShadow = options.castShadow ?? true;
  mesh_vacuum_handle_4.receiveShadow = options.receiveShadow ?? true;
  mesh_vacuum_handle_4.userData.sculptComponent = node_vacuum_handle_4.userData.sculptComponent;
  node_vacuum_handle_4.add(mesh_vacuum_handle_4);
  meshes["vacuum-handle"] = mesh_vacuum_handle_4;
  colliders["vacuum-handle"] = {"type": "box", "offset": [0.0, 0.5052, 0.0], "scale": [0.3521, 0.1684, 0.07], "isTrigger": false, "notes": "Advisory."};
  destructionGroups["trim"] ??= [];
  destructionGroups["trim"].push(node_vacuum_handle_4);
  const socket_vacuum_handle_grip_0 = new THREE.Object3D();
  socket_vacuum_handle_grip_0.name = "grip";
  socket_vacuum_handle_grip_0.position.set(0.0, 0.5894, 0.0);
  socket_vacuum_handle_grip_0.rotation.set(0.0, 0.349066, 0.0);
  socket_vacuum_handle_grip_0.userData.socket = {"id": "grip", "localPosition": [0.0, 0.5894, 0.0], "localRotation": [0.0, 0.349066, 0.0], "notes": "The crown, and the prop's highest point."};
  node_vacuum_handle_4.add(socket_vacuum_handle_grip_0);
  sockets["vacuum-handle:grip"] = socket_vacuum_handle_grip_0;

  const attachment_vacuum_hose_5 = {"parentId": "vacuum-body", "parentSocket": "hose-port", "contactType": "seated-in-socket", "localStart": [-0.2631, 0.1985, 0.2208], "localEnd": [-0.075, 0.0877, 0.3744], "contactNormal": [0.0, 1.0, 0.0], "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.0, "baseRadius": 0.0577, "endRadius": 0.0577, "geometryFromSpec": true, "notes": "Collar mouth to cuff. THIS IS THE HIGHEST-RISK LINE IN THE SPEC. Without geometryFromSpec the generator replaces the swept curve with a CylinderGeometry between exactly these two points and discards the component's transform, so the hose ships as a straight navy rod - and every pixel gate still passes, because a rod between the same endpoints fills a similar silhouette. refine_props.py installs the guard and fails the build loudly if it cannot; tests/unit/sculpted-props.test.ts pins the sample count so a regenerated factory that drops the guard fails rather than shipping the rod."};
  const endpoint_vacuum_hose_5 = makeAttachmentEndpoint(attachment_vacuum_hose_5);
  const node_vacuum_hose_5 = new THREE.Group();
  node_vacuum_hose_5.name = "Corrugated hose__pivot";
  if (endpoint_vacuum_hose_5) {
    node_vacuum_hose_5.position.copy(endpoint_vacuum_hose_5.start);
    node_vacuum_hose_5.rotation.set(0, 0, 0);
    node_vacuum_hose_5.scale.set(1, 1, 1);
  } else {
    node_vacuum_hose_5.position.set(0.0, 0.0, 0.0);
    node_vacuum_hose_5.rotation.set(0.0, 0.0, 0.0);
    node_vacuum_hose_5.scale.set(1.0, 1.0, 1.0);
  }
  node_vacuum_hose_5.userData.sculptComponent = {"id": "vacuum-hose", "name": "Corrugated hose", "level": "macro", "role": "tube", "importance": 1.0, "confidence": 0.6, "primitive": "tube", "topologyClass": "continuous-sculpt", "topologyRationale": "A round navy section swept along a curve from the collar to the floor head. This is the part that says vacuum rather than kettle: a quarter of the reference's silhouette is hose, and it is the only long curve on the prop.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(55, 76, 114, 1.0)", "secondaryAlbedo": "rgba(49, 68, 102, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "round section of radius 0.0577 swept along a 0.8928 centreline from the collar, over the body's forward shoulder, down onto the head", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 8}, "deformationStack": [], "uvStrategy": "TubeGeometry UVs running along the hose", "normalStrategy": "smooth vertex normals from the swept section", "tubePath": {"points": [[-0.2631, 0.1985, 0.2208], [-0.27351, 0.19831, 0.22659], [-0.28776, 0.19869, 0.23558], [-0.2976, 0.2035, 0.2497], [-0.30141, 0.21572, 0.27099], [-0.30082, 0.23239, 0.29739], [-0.2924, 0.2485, 0.3247], [-0.27403, 0.26331, 0.35297], [-0.24784, 0.27757, 0.38214], [-0.2168, 0.2885, 0.4078], [-0.1801, 0.29517, 0.42905], [-0.13855, 0.2985, 0.44679], [-0.0976, 0.2985, 0.4593], [-0.05758, 0.29591, 0.46549], [-0.01816, 0.28998, 0.46644], [0.0162, 0.2785, 0.4637], [0.04415, 0.25924, 0.45721], [0.06705, 0.23443, 0.44703], [0.0845, 0.2085, 0.4348], [0.1019, 0.18112, 0.41913], [0.11386, 0.15263, 0.40141], [0.1038, 0.1285, 0.3875], [0.05225, 0.11049, 0.38011], [-0.02131, 0.09683, 0.37653], [-0.075, 0.0877, 0.3744]], "radius": 0.0577, "radialSegments": 8, "closed": false}}, "parent": "vacuum-body", "attachment": {"parentId": "vacuum-body", "parentSocket": "hose-port", "contactType": "seated-in-socket", "localStart": [-0.2631, 0.1985, 0.2208], "localEnd": [-0.075, 0.0877, 0.3744], "contactNormal": [0.0, 1.0, 0.0], "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.0, "baseRadius": 0.0577, "endRadius": 0.0577, "geometryFromSpec": true, "notes": "Collar mouth to cuff. THIS IS THE HIGHEST-RISK LINE IN THE SPEC. Without geometryFromSpec the generator replaces the swept curve with a CylinderGeometry between exactly these two points and discards the component's transform, so the hose ships as a straight navy rod - and every pixel gate still passes, because a rod between the same endpoints fills a similar silhouette. refine_props.py installs the guard and fails the build loudly if it cannot; tests/unit/sculpted-props.test.ts pins the sample count so a regenerated factory that drops the guard fails rather than shipping the rod."}, "dimensions": {"width": 0.5307, "height": 0.3262, "depth": 0.361, "units": "world", "confidence": 0.6}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "tube", "pivot": {"mode": "center", "localPosition": [0.0, 0.3, 0.25], "axis": [0.0, 1.0, 0.0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": true, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "hose-root", "localPosition": [-0.2631, 0.1985, 0.2208], "localRotation": [0.0, 0.0, 0.0], "notes": "The collar end."}, {"id": "hose-tip", "localPosition": [-0.075, 0.0877, 0.3744], "localRotation": [0.0, 0.0, 0.0], "notes": "The cuff end, on the head's boss."}], "collider": {"type": "capsule", "offset": [-0.15, 0.32, 0.28], "scale": [0.42, 0.3, 0.4], "isTrigger": false, "notes": "Advisory only, and deliberately crude: the hose is a curve and no single proxy fits it. Nothing in the game tests against it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hose", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "hose-navy", "materialLayers": ["hose-navy"], "deformations": [], "joints": [], "seams": [{"id": "hose-collar-seam", "with": "vacuum-collar", "overlap": 0.025, "notes": "The first sample sits inside the collar's mouth."}, {"id": "hose-cuff-seam", "with": "vacuum-cuff", "overlap": 0.025, "notes": "The last sample sits inside the cuff."}], "localFeatures": [{"id": "hose-curve", "description": "The hose runs 0.8928 of centreline between two points only 0.2669 apart, so most of its length is slack. That slack is what makes it read as a hose; a taut run between the same two points reads as a strut.", "geometry": "Catmull-Rom through 8 control points, sampled at 14 per segment", "evidenceRefs": ["full-object", "hose-zone"], "confidence": 0.6}, {"id": "hose-section", "description": "A round section of radius 0.0577, from a tube diameter measured at 0.1649 of the canister's, held between 101.5 and 110.0 px across three independently chosen locally-straight runs.", "geometry": "TubeGeometry round cross-section, 8 radial segments", "evidenceRefs": ["full-object", "hose-zone"], "confidence": 0.8}, {"id": "hose-corrugation", "description": "35 ribs at a pitch of 0.0255, which is 0.0364 of the canister's diameter. The pitch is measured; the COUNT is derived from it and the authored centreline, because the reference foreshortens the far limb of the loop and a count read off the projection would be short by however much of the run is depth. NOT BUILT AT BLOCKOUT - see risks.", "geometry": "repetition system hose-corrugation, delivered at form-refinement", "evidenceRefs": ["full-object", "hose-zone"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.66, "microRoughness": 0.08, "bumpAmplitude": 0.0, "normalPattern": "matte plastic, the same family as the belt", "displacementPattern": "none", "occlusionPattern": "deep occlusion in every rib valley and where the hose passes the body", "edgeWearPattern": "none", "notes": "The prop's value anchor: the darkest, longest continuous form on it."}, "evidenceRefs": ["full-object", "hose-zone"], "details": [], "fidelityTier": "blockout"};
  node_vacuum_hose_5.userData.actionProfile = node_vacuum_hose_5.userData.sculptComponent.actionProfile;
  (nodes["vacuum-body"] ?? root).add(node_vacuum_hose_5);
  nodes["vacuum-hose"] = node_vacuum_hose_5;
  const mesh_vacuum_hose_5Geometry = endpoint_vacuum_hose_5
    ? new THREE.CylinderGeometry(endpoint_vacuum_hose_5.endRadius, endpoint_vacuum_hose_5.baseRadius, endpoint_vacuum_hose_5.length, 32, 12)
    : buildTubeGeometry({"points": [[-0.2631, 0.1985, 0.2208], [-0.27351, 0.19831, 0.22659], [-0.28776, 0.19869, 0.23558], [-0.2976, 0.2035, 0.2497], [-0.30141, 0.21572, 0.27099], [-0.30082, 0.23239, 0.29739], [-0.2924, 0.2485, 0.3247], [-0.27403, 0.26331, 0.35297], [-0.24784, 0.27757, 0.38214], [-0.2168, 0.2885, 0.4078], [-0.1801, 0.29517, 0.42905], [-0.13855, 0.2985, 0.44679], [-0.0976, 0.2985, 0.4593], [-0.05758, 0.29591, 0.46549], [-0.01816, 0.28998, 0.46644], [0.0162, 0.2785, 0.4637], [0.04415, 0.25924, 0.45721], [0.06705, 0.23443, 0.44703], [0.0845, 0.2085, 0.4348], [0.1019, 0.18112, 0.41913], [0.11386, 0.15263, 0.40141], [0.1038, 0.1285, 0.3875], [0.05225, 0.11049, 0.38011], [-0.02131, 0.09683, 0.37653], [-0.075, 0.0877, 0.3744]], "radius": 0.0577, "radialSegments": 8, "closed": false});
  const mesh_vacuum_hose_5 = new THREE.Mesh(
    mesh_vacuum_hose_5Geometry,
    materialMap["hose-navy"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_vacuum_hose_5.name = "Corrugated hose";
  if (endpoint_vacuum_hose_5) {
    mesh_vacuum_hose_5.position.copy(endpoint_vacuum_hose_5.midpoint);
    mesh_vacuum_hose_5.quaternion.copy(endpoint_vacuum_hose_5.quaternion);
  }
  mesh_vacuum_hose_5.castShadow = options.castShadow ?? true;
  mesh_vacuum_hose_5.receiveShadow = options.receiveShadow ?? true;
  mesh_vacuum_hose_5.userData.sculptComponent = node_vacuum_hose_5.userData.sculptComponent;
  node_vacuum_hose_5.add(mesh_vacuum_hose_5);
  meshes["vacuum-hose"] = mesh_vacuum_hose_5;
  colliders["vacuum-hose"] = {"type": "capsule", "offset": [-0.15, 0.32, 0.28], "scale": [0.42, 0.3, 0.4], "isTrigger": false, "notes": "Advisory only, and deliberately crude: the hose is a curve and no single proxy fits it. Nothing in the game tests against it."};
  destructionGroups["hose"] ??= [];
  destructionGroups["hose"].push(node_vacuum_hose_5);
  const socket_vacuum_hose_hose_root_0 = new THREE.Object3D();
  socket_vacuum_hose_hose_root_0.name = "hose-root";
  socket_vacuum_hose_hose_root_0.position.set(-0.2631, 0.1985, 0.2208);
  socket_vacuum_hose_hose_root_0.rotation.set(0.0, 0.0, 0.0);
  socket_vacuum_hose_hose_root_0.userData.socket = {"id": "hose-root", "localPosition": [-0.2631, 0.1985, 0.2208], "localRotation": [0.0, 0.0, 0.0], "notes": "The collar end."};
  node_vacuum_hose_5.add(socket_vacuum_hose_hose_root_0);
  sockets["vacuum-hose:hose-root"] = socket_vacuum_hose_hose_root_0;
  const socket_vacuum_hose_hose_tip_1 = new THREE.Object3D();
  socket_vacuum_hose_hose_tip_1.name = "hose-tip";
  socket_vacuum_hose_hose_tip_1.position.set(-0.075, 0.0877, 0.3744);
  socket_vacuum_hose_hose_tip_1.rotation.set(0.0, 0.0, 0.0);
  socket_vacuum_hose_hose_tip_1.userData.socket = {"id": "hose-tip", "localPosition": [-0.075, 0.0877, 0.3744], "localRotation": [0.0, 0.0, 0.0], "notes": "The cuff end, on the head's boss."};
  node_vacuum_hose_5.add(socket_vacuum_hose_hose_tip_1);
  sockets["vacuum-hose:hose-tip"] = socket_vacuum_hose_hose_tip_1;

  const attachment_vacuum_nozzle_6 = null;
  const endpoint_vacuum_nozzle_6 = makeAttachmentEndpoint(attachment_vacuum_nozzle_6);
  const node_vacuum_nozzle_6 = new THREE.Group();
  node_vacuum_nozzle_6.name = "Floor head__pivot";
  if (endpoint_vacuum_nozzle_6) {
    node_vacuum_nozzle_6.position.copy(endpoint_vacuum_nozzle_6.start);
    node_vacuum_nozzle_6.rotation.set(0, 0, 0);
    node_vacuum_nozzle_6.scale.set(1, 1, 1);
  } else {
    node_vacuum_nozzle_6.position.set(0.0, 0.0, 0.3296);
    node_vacuum_nozzle_6.rotation.set(0.0, 0.0, 0.0);
    node_vacuum_nozzle_6.scale.set(1.0, 1.0, 1.0);
  }
  node_vacuum_nozzle_6.userData.sculptComponent = {"id": "vacuum-nozzle", "name": "Floor head", "level": "macro", "role": "shell", "importance": 0.9, "confidence": 0.7, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A cream slab lying flat on the deck, longer than it is deep, with rounded corners and a recessed suction slot down its front face. The reference shows it as a squared moulding, not a revolve: its two long edges are straight.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(249, 233, 196, 1.0)", "secondaryAlbedo": "rgba(224, 209, 176, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "chamfered rectangle 0.4543 by 0.2037 extruded 0.0615 along +Y", "edgeTreatment": {"type": "chamfered", "bevelRadius": 0.05, "segments": 8}, "deformationStack": [], "uvStrategy": "planar UVs from the extrusion", "normalStrategy": "hard normals on the walls, flat on the top face", "profile2D": {"points": [[0.22715, -0.05185], [0.22715, 0.05185], [0.17715, 0.10185], [-0.17715, 0.10185], [-0.22715, 0.05185], [-0.22715, -0.05185], [-0.17715, -0.10185], [0.17715, -0.10185]], "depth": 0.0615, "axis": "y", "axisOffset": 0.0}}, "parent": "vacuum-body", "attachment": null, "dimensions": {"width": 0.4543, "height": 0.0615, "depth": 0.2037, "units": "world", "confidence": 0.7}, "transform": {"position": [0.0, 0.0, 0.3296], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "shell", "pivot": {"mode": "center", "localPosition": [0.0, 0.0307, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.75}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "boss-seat", "localPosition": [-0.075, 0.0615, 0.0448], "localRotation": [0.0, 0.0, 0.0], "notes": "Where the hose boss stands on the head's top face."}], "collider": {"type": "box", "offset": [0.0, 0.0307, 0.0], "scale": [0.4543, 0.0615, 0.2037], "isTrigger": false, "notes": "Advisory."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "nozzle-cream", "materialLayers": ["nozzle-cream"], "deformations": [], "joints": [], "seams": [{"id": "nozzle-boss-seam", "with": "vacuum-nozzle-boss", "overlap": 0.02, "notes": "The boss's base is sunk into the head's top face."}], "localFeatures": [{"id": "nozzle-plan", "description": "The head is 0.649 by 0.291 of the canister's diameter in plan. Both come from the floor-contact contour un-squashed by 1/sin(pitch): that contour lies in the ground plane everywhere, unlike the head's top edge, which the raised boss lifts out of it.", "geometry": "chamfered rectangle in the extrusion profile", "evidenceRefs": ["full-object", "nozzle-zone"], "confidence": 0.65}, {"id": "nozzle-slot", "description": "A long recessed slot runs the front face, the only hard dark line on the cream.", "geometry": "recessed channel in the front wall, delivered at form-refinement", "evidenceRefs": ["full-object", "nozzle-zone"], "confidence": 0.7}, {"id": "nozzle-parks-under-body", "description": "The head's rear edge sits at z 0.1318, which is the body's forward floor contact. It tucks UNDER the shell's overhang: the body's widest band reaches 0.35 while its floor contact stops at 0.2278, and the head is thinner than the height of that overhang. This is the authored deviation from the reference pose, and it is what makes the prop fit at all.", "geometry": "component placement against the measured roll-under", "evidenceRefs": ["full-object", "call-site"], "confidence": 0.8}], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.06, "bumpAmplitude": 0.0, "normalPattern": "matte moulded plastic, flatter than the shell", "displacementPattern": "none", "occlusionPattern": "hard occlusion in the suction slot and under the head's overhang", "edgeWearPattern": "none", "notes": "The palest field on the prop and the one nearest the deck."}, "evidenceRefs": ["full-object", "nozzle-zone"], "details": [], "fidelityTier": "blockout"};
  node_vacuum_nozzle_6.userData.actionProfile = node_vacuum_nozzle_6.userData.sculptComponent.actionProfile;
  (nodes["vacuum-body"] ?? root).add(node_vacuum_nozzle_6);
  nodes["vacuum-nozzle"] = node_vacuum_nozzle_6;
  const mesh_vacuum_nozzle_6Geometry = endpoint_vacuum_nozzle_6
    ? new THREE.CylinderGeometry(endpoint_vacuum_nozzle_6.endRadius, endpoint_vacuum_nozzle_6.baseRadius, endpoint_vacuum_nozzle_6.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0.22715, -0.05185], [0.22715, 0.05185], [0.17715, 0.10185], [-0.17715, 0.10185], [-0.22715, 0.05185], [-0.22715, -0.05185], [-0.17715, -0.10185], [0.17715, -0.10185]], "depth": 0.0615, "axis": "y", "axisOffset": 0.0});
  const mesh_vacuum_nozzle_6 = new THREE.Mesh(
    mesh_vacuum_nozzle_6Geometry,
    materialMap["nozzle-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_vacuum_nozzle_6.name = "Floor head";
  if (endpoint_vacuum_nozzle_6) {
    mesh_vacuum_nozzle_6.position.copy(endpoint_vacuum_nozzle_6.midpoint);
    mesh_vacuum_nozzle_6.quaternion.copy(endpoint_vacuum_nozzle_6.quaternion);
  }
  mesh_vacuum_nozzle_6.castShadow = options.castShadow ?? true;
  mesh_vacuum_nozzle_6.receiveShadow = options.receiveShadow ?? true;
  mesh_vacuum_nozzle_6.userData.sculptComponent = node_vacuum_nozzle_6.userData.sculptComponent;
  node_vacuum_nozzle_6.add(mesh_vacuum_nozzle_6);
  meshes["vacuum-nozzle"] = mesh_vacuum_nozzle_6;
  colliders["vacuum-nozzle"] = {"type": "box", "offset": [0.0, 0.0307, 0.0], "scale": [0.4543, 0.0615, 0.2037], "isTrigger": false, "notes": "Advisory."};
  destructionGroups["head"] ??= [];
  destructionGroups["head"].push(node_vacuum_nozzle_6);
  const socket_vacuum_nozzle_boss_seat_0 = new THREE.Object3D();
  socket_vacuum_nozzle_boss_seat_0.name = "boss-seat";
  socket_vacuum_nozzle_boss_seat_0.position.set(-0.075, 0.0615, 0.0448);
  socket_vacuum_nozzle_boss_seat_0.rotation.set(0.0, 0.0, 0.0);
  socket_vacuum_nozzle_boss_seat_0.userData.socket = {"id": "boss-seat", "localPosition": [-0.075, 0.0615, 0.0448], "localRotation": [0.0, 0.0, 0.0], "notes": "Where the hose boss stands on the head's top face."};
  node_vacuum_nozzle_6.add(socket_vacuum_nozzle_boss_seat_0);
  sockets["vacuum-nozzle:boss-seat"] = socket_vacuum_nozzle_boss_seat_0;

  const attachment_vacuum_nozzle_boss_7 = null;
  const endpoint_vacuum_nozzle_boss_7 = makeAttachmentEndpoint(attachment_vacuum_nozzle_boss_7);
  const node_vacuum_nozzle_boss_7 = new THREE.Group();
  node_vacuum_nozzle_boss_7.name = "Hose boss__pivot";
  if (endpoint_vacuum_nozzle_boss_7) {
    node_vacuum_nozzle_boss_7.position.copy(endpoint_vacuum_nozzle_boss_7.start);
    node_vacuum_nozzle_boss_7.rotation.set(0, 0, 0);
    node_vacuum_nozzle_boss_7.scale.set(1, 1, 1);
  } else {
    node_vacuum_nozzle_boss_7.position.set(-0.075, 0.0615, 0.0448);
    node_vacuum_nozzle_boss_7.rotation.set(0.0, 0.0, 0.0);
    node_vacuum_nozzle_boss_7.scale.set(1.0, 1.0, 1.0);
  }
  node_vacuum_nozzle_boss_7.userData.sculptComponent = {"id": "vacuum-nozzle-boss", "name": "Hose boss", "level": "meso", "role": "shell", "importance": 0.5, "confidence": 0.6, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "The rounded cream dome on the head's top face where the hose lands. In the reference it is the only convex crown on the head and the reason its middle columns span four times what its end columns do.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(249, 233, 196, 1.0)", "secondaryAlbedo": "rgba(224, 209, 176, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "dome of base width 0.14 and rise 0.0476 revolved about Y", "edgeTreatment": {"type": "rolled", "bevelRadius": 0.02, "segments": 16}, "deformationStack": [], "uvStrategy": "LatheGeometry cylindrical UVs", "normalStrategy": "smooth vertex normals from the revolved profile", "latheProfile": {"points": [[0.0, 0.0], [0.07, 0.0], [0.0644, 0.0162], [0.0504, 0.0324], [0.028, 0.0438], [0.0, 0.0476]], "segments": 16, "phiStart": 0.0, "phiLength": 6.283185}}, "parent": "vacuum-nozzle", "attachment": null, "dimensions": {"width": 0.14, "height": 0.0476, "depth": 0.14, "units": "world", "confidence": 0.6}, "transform": {"position": [-0.075, 0.0615, 0.0448], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "shell", "pivot": {"mode": "center", "localPosition": [0.0, 0.0238, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0.0, 0.0238, 0.0], "scale": [0.14, 0.0476, 0.14], "isTrigger": false, "notes": "Advisory."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "nozzle-cream", "materialLayers": ["nozzle-cream"], "deformations": [], "joints": [], "seams": [{"id": "boss-head-seam", "with": "vacuum-nozzle", "overlap": 0.02, "notes": "The dome's base is sunk 0.02 into the head."}], "localFeatures": [{"id": "boss-dome", "description": "The dome rises 0.0476 above the head's 0.0615 slab, so the head's silhouette is more than twice as tall through its middle as at either end. The reference's column scan gives 208 px through the boss against 46 and 53 at the ends.", "geometry": "lathe profile rise", "evidenceRefs": ["full-object", "nozzle-zone"], "confidence": 0.7}], "surfaceDetail": {"macroRoughness": 0.52, "microRoughness": 0.06, "bumpAmplitude": 0.0, "normalPattern": "matte plastic with a soft crown highlight", "displacementPattern": "none", "occlusionPattern": "occlusion in the fillet where the dome meets the slab", "edgeWearPattern": "none", "notes": "The head's only convex form."}, "evidenceRefs": ["full-object", "nozzle-zone"], "details": [], "fidelityTier": "blockout"};
  node_vacuum_nozzle_boss_7.userData.actionProfile = node_vacuum_nozzle_boss_7.userData.sculptComponent.actionProfile;
  (nodes["vacuum-nozzle"] ?? root).add(node_vacuum_nozzle_boss_7);
  nodes["vacuum-nozzle-boss"] = node_vacuum_nozzle_boss_7;
  const mesh_vacuum_nozzle_boss_7Geometry = endpoint_vacuum_nozzle_boss_7
    ? new THREE.CylinderGeometry(endpoint_vacuum_nozzle_boss_7.endRadius, endpoint_vacuum_nozzle_boss_7.baseRadius, endpoint_vacuum_nozzle_boss_7.length, 32, 12)
    : buildLatheGeometry({"points": [[0.0, 0.0], [0.07, 0.0], [0.0644, 0.0162], [0.0504, 0.0324], [0.028, 0.0438], [0.0, 0.0476]], "segments": 16, "phiStart": 0.0, "phiLength": 6.283185});
  const mesh_vacuum_nozzle_boss_7 = new THREE.Mesh(
    mesh_vacuum_nozzle_boss_7Geometry,
    materialMap["nozzle-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_vacuum_nozzle_boss_7.name = "Hose boss";
  if (endpoint_vacuum_nozzle_boss_7) {
    mesh_vacuum_nozzle_boss_7.position.copy(endpoint_vacuum_nozzle_boss_7.midpoint);
    mesh_vacuum_nozzle_boss_7.quaternion.copy(endpoint_vacuum_nozzle_boss_7.quaternion);
  }
  mesh_vacuum_nozzle_boss_7.castShadow = options.castShadow ?? true;
  mesh_vacuum_nozzle_boss_7.receiveShadow = options.receiveShadow ?? true;
  mesh_vacuum_nozzle_boss_7.userData.sculptComponent = node_vacuum_nozzle_boss_7.userData.sculptComponent;
  node_vacuum_nozzle_boss_7.add(mesh_vacuum_nozzle_boss_7);
  meshes["vacuum-nozzle-boss"] = mesh_vacuum_nozzle_boss_7;
  colliders["vacuum-nozzle-boss"] = {"type": "cylinder", "offset": [0.0, 0.0238, 0.0], "scale": [0.14, 0.0476, 0.14], "isTrigger": false, "notes": "Advisory."};
  destructionGroups["head"] ??= [];
  destructionGroups["head"].push(node_vacuum_nozzle_boss_7);

  const attachment_vacuum_cuff_8 = {"parentId": "vacuum-nozzle", "parentSocket": "boss-seat", "contactType": "sleeved-over-tube", "localStart": [0.0, -0.045, 0.0], "localEnd": [0.0, 0.045, 0.0], "contactNormal": [0.0, 1.0, 0.0], "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.0, "baseRadius": 0.0595, "endRadius": 0.0595, "geometryFromSpec": true, "notes": "The cuff's axis along the hose's tangent where it lands on the boss."};
  const endpoint_vacuum_cuff_8 = makeAttachmentEndpoint(attachment_vacuum_cuff_8);
  const node_vacuum_cuff_8 = new THREE.Group();
  node_vacuum_cuff_8.name = "Hose cuff__pivot";
  if (endpoint_vacuum_cuff_8) {
    node_vacuum_cuff_8.position.copy(endpoint_vacuum_cuff_8.start);
    node_vacuum_cuff_8.rotation.set(0, 0, 0);
    node_vacuum_cuff_8.scale.set(1, 1, 1);
  } else {
    node_vacuum_cuff_8.position.set(0.05225, 0.11049, 0.05051);
    node_vacuum_cuff_8.rotation.set(-1.237346, 2.879846, -1.570796);
    node_vacuum_cuff_8.scale.set(0.119, 0.09, 0.119);
  }
  node_vacuum_cuff_8.userData.sculptComponent = {"id": "vacuum-cuff", "name": "Hose cuff", "level": "meso", "role": "connector", "importance": 0.5, "confidence": 0.6, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The mint collar where the hose meets the head. It is the second mint field on the prop and the only one that is not the handle.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(145, 196, 174, 1.0)", "secondaryAlbedo": "rgba(130, 176, 156, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "cylinder of diameter 0.119 and length 0.09 laid on the hose's own tangent at its last sample", "edgeTreatment": {"type": "chamfered", "bevelRadius": 0.008, "segments": 16}, "deformationStack": [], "uvStrategy": "cylindrical UVs about the cuff axis", "normalStrategy": "smooth around the barrel"}, "parent": "vacuum-nozzle", "attachment": {"parentId": "vacuum-nozzle", "parentSocket": "boss-seat", "contactType": "sleeved-over-tube", "localStart": [0.0, -0.045, 0.0], "localEnd": [0.0, 0.045, 0.0], "contactNormal": [0.0, 1.0, 0.0], "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.0, "baseRadius": 0.0595, "endRadius": 0.0595, "geometryFromSpec": true, "notes": "The cuff's axis along the hose's tangent where it lands on the boss."}, "dimensions": {"width": 0.119, "height": 0.09, "depth": 0.119, "units": "world", "confidence": 0.6}, "transform": {"position": [0.05225, 0.11049, 0.05051], "rotation": [-1.237346, 2.879846, -1.570796]}, "actionProfile": {"animationRole": "connector", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0.0, 0.0, 0.0], "scale": [0.119, 0.09, 0.119], "isTrigger": false, "notes": "Advisory."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "trim-mint", "materialLayers": ["trim-mint"], "deformations": [], "joints": [], "seams": [{"id": "cuff-hose-seam", "with": "vacuum-hose", "overlap": 0.025, "notes": "The hose's last sample runs inside the cuff."}], "localFeatures": [{"id": "cuff-band", "description": "The cuff is 0.17 of the canister's diameter across, from a 110 px mint blob against the hose's own 0.1649, so it is a genuine step out from the tube rather than a painted band.", "geometry": "cylinder diameter over the hose's section", "evidenceRefs": ["full-object", "nozzle-zone"], "confidence": 0.7}], "surfaceDetail": {"macroRoughness": 0.57, "microRoughness": 0.07, "bumpAmplitude": 0.0, "normalPattern": "matte plastic matching the handle", "displacementPattern": "none", "occlusionPattern": "occlusion at both of the cuff's shoulders", "edgeWearPattern": "none", "notes": "A small part carrying a large share of the prop's colour rhythm."}, "evidenceRefs": ["full-object", "nozzle-zone"], "details": [], "fidelityTier": "blockout"};
  node_vacuum_cuff_8.userData.actionProfile = node_vacuum_cuff_8.userData.sculptComponent.actionProfile;
  (nodes["vacuum-nozzle"] ?? root).add(node_vacuum_cuff_8);
  nodes["vacuum-cuff"] = node_vacuum_cuff_8;
  const mesh_vacuum_cuff_8Geometry = endpoint_vacuum_cuff_8
    ? new THREE.CylinderGeometry(endpoint_vacuum_cuff_8.endRadius, endpoint_vacuum_cuff_8.baseRadius, endpoint_vacuum_cuff_8.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 32, 1);
  const mesh_vacuum_cuff_8 = new THREE.Mesh(
    mesh_vacuum_cuff_8Geometry,
    materialMap["trim-mint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_vacuum_cuff_8.name = "Hose cuff";
  if (endpoint_vacuum_cuff_8) {
    mesh_vacuum_cuff_8.position.copy(endpoint_vacuum_cuff_8.midpoint);
    mesh_vacuum_cuff_8.quaternion.copy(endpoint_vacuum_cuff_8.quaternion);
  }
  mesh_vacuum_cuff_8.castShadow = options.castShadow ?? true;
  mesh_vacuum_cuff_8.receiveShadow = options.receiveShadow ?? true;
  mesh_vacuum_cuff_8.userData.sculptComponent = node_vacuum_cuff_8.userData.sculptComponent;
  node_vacuum_cuff_8.add(mesh_vacuum_cuff_8);
  meshes["vacuum-cuff"] = mesh_vacuum_cuff_8;
  colliders["vacuum-cuff"] = {"type": "cylinder", "offset": [0.0, 0.0, 0.0], "scale": [0.119, 0.09, 0.119], "isTrigger": false, "notes": "Advisory."};
  destructionGroups["head"] ??= [];
  destructionGroups["head"].push(node_vacuum_cuff_8);

  const attachment_vacuum_wheel_right_9 = null;
  const endpoint_vacuum_wheel_right_9 = makeAttachmentEndpoint(attachment_vacuum_wheel_right_9);
  const node_vacuum_wheel_right_9 = new THREE.Group();
  node_vacuum_wheel_right_9.name = "Right wheel__pivot";
  if (endpoint_vacuum_wheel_right_9) {
    node_vacuum_wheel_right_9.position.copy(endpoint_vacuum_wheel_right_9.start);
    node_vacuum_wheel_right_9.rotation.set(0, 0, 0);
    node_vacuum_wheel_right_9.scale.set(1, 1, 1);
  } else {
    node_vacuum_wheel_right_9.position.set(0.364, 0.1235, -0.07);
    node_vacuum_wheel_right_9.rotation.set(0.0, -0.0, -1.570796);
    node_vacuum_wheel_right_9.scale.set(1.0, 1.0, 1.0);
  }
  node_vacuum_wheel_right_9.userData.sculptComponent = {"id": "vacuum-wheel-right", "name": "Right wheel", "level": "macro", "role": "wheel", "importance": 0.8, "confidence": 0.7, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "A fat coral disc with a rolled tyre edge, mounted on a horizontal axle at the shell's flank. The reference shows the outer face square to its axle with a generous roll all round the rim, which is a toy wheel rather than a castor.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(235, 130, 115, 1.0)", "secondaryAlbedo": "rgba(211, 117, 103, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "disc of radius 0.1235 and thickness 0.1106 revolved about Y, then laid on a horizontal axle by the node's rotation alone", "edgeTreatment": {"type": "rolled", "bevelRadius": 0.03, "segments": 24}, "deformationStack": [], "uvStrategy": "LatheGeometry cylindrical UVs", "normalStrategy": "smooth vertex normals from the revolved profile", "latheProfile": {"points": [[0.0, -0.0553], [0.0519, -0.0553], [0.0939, -0.052], [0.1161, -0.0343], [0.1235, 0.0], [0.1161, 0.0343], [0.0939, 0.052], [0.0519, 0.0553], [0.0, 0.0553]], "segments": 24, "phiStart": 0.0, "phiLength": 6.283185}}, "parent": "vacuum-body", "attachment": null, "dimensions": {"width": 0.1106, "height": 0.247, "depth": 0.247, "units": "world", "confidence": 0.7}, "transform": {"position": [0.364, 0.1235, -0.07], "rotation": [0.0, -0.0, -1.570796], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "wheel", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "hub-face", "localPosition": [0.0, 0.0553, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "The outboard face, where the hub cap seats. Local to the rotated node, so its +Y is the world outward direction."}], "collider": {"type": "cylinder", "offset": [0.0, 0.0, 0.0], "scale": [0.247, 0.1106, 0.247], "isTrigger": false, "notes": "Advisory. The wheel spins in the runtime but never carries the prop's motion, which the root does."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "wheel-coral", "materialLayers": ["wheel-coral"], "deformations": [], "joints": [], "seams": [{"id": "wheel-right-body-seam", "with": "vacuum-body", "overlap": 0.02, "notes": "The inboard face laps the shell's flank."}], "localFeatures": [{"id": "wheel-tyre-roll", "description": "The tyre rolls over its full 0.0553 half-thickness at the rim rather than meeting the face at an edge, which is what gives it a continuous bright ring all the way round.", "geometry": "lathe profile with its maximum radius at the mid-thickness", "evidenceRefs": ["full-object", "wheel-zone"], "confidence": 0.7}, {"id": "wheel-standoff", "description": "The wheel's centre sits 0.52 of the canister's diameter from the axis, which is 0.0432 outside the shell's own surface at that height. It is mounted proud on a stub, not sunk into the flank.", "geometry": "component position against the body profile at the wheel's height", "evidenceRefs": ["full-object", "wheel-zone"], "confidence": 0.65}, {"id": "wheel-proportion", "description": "Diameter 0.3529 of the canister's and thickness 0.158, so the wheel is 0.45 as thick as it is wide. The diameter is the disc's image vertical extent divided by 0.975: a circle in a vertical plane projects its true diameter vertically to within 2.5 percent at any plausible axle bearing, which is what makes that reading safe when its horizontal one is not.", "geometry": "lathe profile extents", "evidenceRefs": ["full-object", "wheel-zone"], "confidence": 0.7}], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.07, "bumpAmplitude": 0.0, "normalPattern": "matte moulded plastic", "displacementPattern": "none", "occlusionPattern": "hard occlusion on the inboard face where the body nearly touches it", "edgeWearPattern": "none", "notes": "The prop's only saturated warm accent."}, "evidenceRefs": ["full-object", "wheel-zone"], "details": [], "fidelityTier": "blockout"};
  node_vacuum_wheel_right_9.userData.actionProfile = node_vacuum_wheel_right_9.userData.sculptComponent.actionProfile;
  (nodes["vacuum-body"] ?? root).add(node_vacuum_wheel_right_9);
  nodes["vacuum-wheel-right"] = node_vacuum_wheel_right_9;
  const mesh_vacuum_wheel_right_9Geometry = endpoint_vacuum_wheel_right_9
    ? new THREE.CylinderGeometry(endpoint_vacuum_wheel_right_9.endRadius, endpoint_vacuum_wheel_right_9.baseRadius, endpoint_vacuum_wheel_right_9.length, 32, 12)
    : buildLatheGeometry({"points": [[0.0, -0.0553], [0.0519, -0.0553], [0.0939, -0.052], [0.1161, -0.0343], [0.1235, 0.0], [0.1161, 0.0343], [0.0939, 0.052], [0.0519, 0.0553], [0.0, 0.0553]], "segments": 24, "phiStart": 0.0, "phiLength": 6.283185});
  const mesh_vacuum_wheel_right_9 = new THREE.Mesh(
    mesh_vacuum_wheel_right_9Geometry,
    materialMap["wheel-coral"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_vacuum_wheel_right_9.name = "Right wheel";
  if (endpoint_vacuum_wheel_right_9) {
    mesh_vacuum_wheel_right_9.position.copy(endpoint_vacuum_wheel_right_9.midpoint);
    mesh_vacuum_wheel_right_9.quaternion.copy(endpoint_vacuum_wheel_right_9.quaternion);
  }
  mesh_vacuum_wheel_right_9.castShadow = options.castShadow ?? true;
  mesh_vacuum_wheel_right_9.receiveShadow = options.receiveShadow ?? true;
  mesh_vacuum_wheel_right_9.userData.sculptComponent = node_vacuum_wheel_right_9.userData.sculptComponent;
  node_vacuum_wheel_right_9.add(mesh_vacuum_wheel_right_9);
  meshes["vacuum-wheel-right"] = mesh_vacuum_wheel_right_9;
  colliders["vacuum-wheel-right"] = {"type": "cylinder", "offset": [0.0, 0.0, 0.0], "scale": [0.247, 0.1106, 0.247], "isTrigger": false, "notes": "Advisory. The wheel spins in the runtime but never carries the prop's motion, which the root does."};
  destructionGroups["wheel"] ??= [];
  destructionGroups["wheel"].push(node_vacuum_wheel_right_9);
  const socket_vacuum_wheel_right_hub_face_0 = new THREE.Object3D();
  socket_vacuum_wheel_right_hub_face_0.name = "hub-face";
  socket_vacuum_wheel_right_hub_face_0.position.set(0.0, 0.0553, 0.0);
  socket_vacuum_wheel_right_hub_face_0.rotation.set(0.0, 0.0, 0.0);
  socket_vacuum_wheel_right_hub_face_0.userData.socket = {"id": "hub-face", "localPosition": [0.0, 0.0553, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "The outboard face, where the hub cap seats. Local to the rotated node, so its +Y is the world outward direction."};
  node_vacuum_wheel_right_9.add(socket_vacuum_wheel_right_hub_face_0);
  sockets["vacuum-wheel-right:hub-face"] = socket_vacuum_wheel_right_hub_face_0;

  const attachment_vacuum_wheel_left_10 = null;
  const endpoint_vacuum_wheel_left_10 = makeAttachmentEndpoint(attachment_vacuum_wheel_left_10);
  const node_vacuum_wheel_left_10 = new THREE.Group();
  node_vacuum_wheel_left_10.name = "Left wheel__pivot";
  if (endpoint_vacuum_wheel_left_10) {
    node_vacuum_wheel_left_10.position.copy(endpoint_vacuum_wheel_left_10.start);
    node_vacuum_wheel_left_10.rotation.set(0, 0, 0);
    node_vacuum_wheel_left_10.scale.set(1, 1, 1);
  } else {
    node_vacuum_wheel_left_10.position.set(-0.364, 0.1235, -0.07);
    node_vacuum_wheel_left_10.rotation.set(0.0, -3.141593, -1.570796);
    node_vacuum_wheel_left_10.scale.set(1.0, 1.0, 1.0);
  }
  node_vacuum_wheel_left_10.userData.sculptComponent = {"id": "vacuum-wheel-left", "name": "Left wheel", "level": "macro", "role": "wheel", "importance": 0.8, "confidence": 0.7, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "A fat coral disc with a rolled tyre edge, mounted on a horizontal axle at the shell's flank. The reference shows the outer face square to its axle with a generous roll all round the rim, which is a toy wheel rather than a castor.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(235, 130, 115, 1.0)", "secondaryAlbedo": "rgba(211, 117, 103, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "disc of radius 0.1235 and thickness 0.1106 revolved about Y, then laid on a horizontal axle by the node's rotation alone", "edgeTreatment": {"type": "rolled", "bevelRadius": 0.03, "segments": 24}, "deformationStack": [], "uvStrategy": "LatheGeometry cylindrical UVs", "normalStrategy": "smooth vertex normals from the revolved profile", "latheProfile": {"points": [[0.0, -0.0553], [0.0519, -0.0553], [0.0939, -0.052], [0.1161, -0.0343], [0.1235, 0.0], [0.1161, 0.0343], [0.0939, 0.052], [0.0519, 0.0553], [0.0, 0.0553]], "segments": 24, "phiStart": 0.0, "phiLength": 6.283185}}, "parent": "vacuum-body", "attachment": null, "dimensions": {"width": 0.1106, "height": 0.247, "depth": 0.247, "units": "world", "confidence": 0.7}, "transform": {"position": [-0.364, 0.1235, -0.07], "rotation": [0.0, -3.141593, -1.570796], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "wheel", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "hub-face", "localPosition": [0.0, 0.0553, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "The outboard face, where the hub cap seats. Local to the rotated node, so its +Y is the world outward direction."}], "collider": {"type": "cylinder", "offset": [0.0, 0.0, 0.0], "scale": [0.247, 0.1106, 0.247], "isTrigger": false, "notes": "Advisory. The wheel spins in the runtime but never carries the prop's motion, which the root does."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "wheel-coral", "materialLayers": ["wheel-coral"], "deformations": [], "joints": [], "seams": [{"id": "wheel-left-body-seam", "with": "vacuum-body", "overlap": 0.02, "notes": "The inboard face laps the shell's flank."}], "localFeatures": [{"id": "wheel-tyre-roll", "description": "The tyre rolls over its full 0.0553 half-thickness at the rim rather than meeting the face at an edge, which is what gives it a continuous bright ring all the way round.", "geometry": "lathe profile with its maximum radius at the mid-thickness", "evidenceRefs": ["full-object", "wheel-zone"], "confidence": 0.7}, {"id": "wheel-standoff", "description": "The wheel's centre sits 0.52 of the canister's diameter from the axis, which is 0.0432 outside the shell's own surface at that height. It is mounted proud on a stub, not sunk into the flank.", "geometry": "component position against the body profile at the wheel's height", "evidenceRefs": ["full-object", "wheel-zone"], "confidence": 0.65}, {"id": "wheel-proportion", "description": "Diameter 0.3529 of the canister's and thickness 0.158, so the wheel is 0.45 as thick as it is wide. The diameter is the disc's image vertical extent divided by 0.975: a circle in a vertical plane projects its true diameter vertically to within 2.5 percent at any plausible axle bearing, which is what makes that reading safe when its horizontal one is not.", "geometry": "lathe profile extents", "evidenceRefs": ["full-object", "wheel-zone"], "confidence": 0.7}], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.07, "bumpAmplitude": 0.0, "normalPattern": "matte moulded plastic", "displacementPattern": "none", "occlusionPattern": "hard occlusion on the inboard face where the body nearly touches it", "edgeWearPattern": "none", "notes": "The prop's only saturated warm accent."}, "evidenceRefs": ["full-object", "wheel-zone"], "details": [], "fidelityTier": "blockout"};
  node_vacuum_wheel_left_10.userData.actionProfile = node_vacuum_wheel_left_10.userData.sculptComponent.actionProfile;
  (nodes["vacuum-body"] ?? root).add(node_vacuum_wheel_left_10);
  nodes["vacuum-wheel-left"] = node_vacuum_wheel_left_10;
  const mesh_vacuum_wheel_left_10Geometry = endpoint_vacuum_wheel_left_10
    ? new THREE.CylinderGeometry(endpoint_vacuum_wheel_left_10.endRadius, endpoint_vacuum_wheel_left_10.baseRadius, endpoint_vacuum_wheel_left_10.length, 32, 12)
    : buildLatheGeometry({"points": [[0.0, -0.0553], [0.0519, -0.0553], [0.0939, -0.052], [0.1161, -0.0343], [0.1235, 0.0], [0.1161, 0.0343], [0.0939, 0.052], [0.0519, 0.0553], [0.0, 0.0553]], "segments": 24, "phiStart": 0.0, "phiLength": 6.283185});
  const mesh_vacuum_wheel_left_10 = new THREE.Mesh(
    mesh_vacuum_wheel_left_10Geometry,
    materialMap["wheel-coral"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_vacuum_wheel_left_10.name = "Left wheel";
  if (endpoint_vacuum_wheel_left_10) {
    mesh_vacuum_wheel_left_10.position.copy(endpoint_vacuum_wheel_left_10.midpoint);
    mesh_vacuum_wheel_left_10.quaternion.copy(endpoint_vacuum_wheel_left_10.quaternion);
  }
  mesh_vacuum_wheel_left_10.castShadow = options.castShadow ?? true;
  mesh_vacuum_wheel_left_10.receiveShadow = options.receiveShadow ?? true;
  mesh_vacuum_wheel_left_10.userData.sculptComponent = node_vacuum_wheel_left_10.userData.sculptComponent;
  node_vacuum_wheel_left_10.add(mesh_vacuum_wheel_left_10);
  meshes["vacuum-wheel-left"] = mesh_vacuum_wheel_left_10;
  colliders["vacuum-wheel-left"] = {"type": "cylinder", "offset": [0.0, 0.0, 0.0], "scale": [0.247, 0.1106, 0.247], "isTrigger": false, "notes": "Advisory. The wheel spins in the runtime but never carries the prop's motion, which the root does."};
  destructionGroups["wheel"] ??= [];
  destructionGroups["wheel"].push(node_vacuum_wheel_left_10);
  const socket_vacuum_wheel_left_hub_face_0 = new THREE.Object3D();
  socket_vacuum_wheel_left_hub_face_0.name = "hub-face";
  socket_vacuum_wheel_left_hub_face_0.position.set(0.0, 0.0553, 0.0);
  socket_vacuum_wheel_left_hub_face_0.rotation.set(0.0, 0.0, 0.0);
  socket_vacuum_wheel_left_hub_face_0.userData.socket = {"id": "hub-face", "localPosition": [0.0, 0.0553, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "The outboard face, where the hub cap seats. Local to the rotated node, so its +Y is the world outward direction."};
  node_vacuum_wheel_left_10.add(socket_vacuum_wheel_left_hub_face_0);
  sockets["vacuum-wheel-left:hub-face"] = socket_vacuum_wheel_left_hub_face_0;

  const attachment_vacuum_hub_right_11 = {"parentId": "vacuum-wheel-right", "parentSocket": "hub-face", "contactType": "seated-on-face", "localStart": [0.0, -0.0125, 0.0], "localEnd": [0.0, 0.0125, 0.0], "contactNormal": [0.0, 1.0, 0.0], "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0, "baseRadius": 0.0733, "endRadius": 0.0733, "geometryFromSpec": true, "notes": "The cap's axis through the wheel's outer face."};
  const endpoint_vacuum_hub_right_11 = makeAttachmentEndpoint(attachment_vacuum_hub_right_11);
  const node_vacuum_hub_right_11 = new THREE.Group();
  node_vacuum_hub_right_11.name = "Right hub cap__pivot";
  if (endpoint_vacuum_hub_right_11) {
    node_vacuum_hub_right_11.position.copy(endpoint_vacuum_hub_right_11.start);
    node_vacuum_hub_right_11.rotation.set(0, 0, 0);
    node_vacuum_hub_right_11.scale.set(1, 1, 1);
  } else {
    node_vacuum_hub_right_11.position.set(0.0, 0.0478, 0.0);
    node_vacuum_hub_right_11.rotation.set(0.0, 0.0, 0.0);
    node_vacuum_hub_right_11.scale.set(0.1466, 0.025, 0.1466);
  }
  node_vacuum_hub_right_11.userData.sculptComponent = {"id": "vacuum-hub-right", "name": "Right hub cap", "level": "meso", "role": "trim", "importance": 0.4, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "A yellow disc on the wheel's outer face. It is the second yellow field on the prop and reads at distance as the wheel's eye.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(253, 218, 156, 1.0)", "secondaryAlbedo": "rgba(227, 196, 140, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "cylinder of diameter 0.1466 standing on the wheel's outboard face", "edgeTreatment": {"type": "rolled", "bevelRadius": 0.005, "segments": 16}, "deformationStack": [], "uvStrategy": "planar UVs on the cap face", "normalStrategy": "smooth over the rolled edge"}, "parent": "vacuum-wheel-right", "attachment": {"parentId": "vacuum-wheel-right", "parentSocket": "hub-face", "contactType": "seated-on-face", "localStart": [0.0, -0.0125, 0.0], "localEnd": [0.0, 0.0125, 0.0], "contactNormal": [0.0, 1.0, 0.0], "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0, "baseRadius": 0.0733, "endRadius": 0.0733, "geometryFromSpec": true, "notes": "The cap's axis through the wheel's outer face."}, "dimensions": {"width": 0.1466, "height": 0.025, "depth": 0.1466, "units": "world", "confidence": 0.7}, "transform": {"position": [0.0, 0.0478, 0.0], "rotation": [0.0, 0.0, 0.0]}, "actionProfile": {"animationRole": "trim", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0.0, 0.0, 0.0], "scale": [0.1466, 0.018, 0.1466], "isTrigger": false, "notes": "Advisory."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "accent-yellow", "materialLayers": ["accent-yellow"], "deformations": [], "joints": [], "seams": [{"id": "hub-right-wheel-seam", "with": "vacuum-wheel-right", "overlap": 0.02, "notes": "The cap is 0.025 thick and sunk 0.02 into the tyre's outer face, leaving 0.005 proud. Same fix as the top button, for the same reason."}], "localFeatures": [{"id": "hub-cap", "description": "The cap is 0.2093 of the canister's diameter, which is 0.59 of its own wheel. Both come from vertical image extents corrected by the same 0.975 factor, so their ratio is firmer than either absolute value.", "geometry": "cylinder diameter on the wheel's face", "evidenceRefs": ["full-object", "wheel-zone"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.06, "bumpAmplitude": 0.0, "normalPattern": "matte plastic with a slightly polished crown", "displacementPattern": "none", "occlusionPattern": "a thin ring of occlusion at the cap's root", "edgeWearPattern": "none", "notes": "Shares its material with the top button."}, "evidenceRefs": ["full-object", "wheel-zone"], "details": [], "fidelityTier": "blockout"};
  node_vacuum_hub_right_11.userData.actionProfile = node_vacuum_hub_right_11.userData.sculptComponent.actionProfile;
  (nodes["vacuum-wheel-right"] ?? root).add(node_vacuum_hub_right_11);
  nodes["vacuum-hub-right"] = node_vacuum_hub_right_11;
  const mesh_vacuum_hub_right_11Geometry = endpoint_vacuum_hub_right_11
    ? new THREE.CylinderGeometry(endpoint_vacuum_hub_right_11.endRadius, endpoint_vacuum_hub_right_11.baseRadius, endpoint_vacuum_hub_right_11.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 32, 1);
  const mesh_vacuum_hub_right_11 = new THREE.Mesh(
    mesh_vacuum_hub_right_11Geometry,
    materialMap["accent-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_vacuum_hub_right_11.name = "Right hub cap";
  if (endpoint_vacuum_hub_right_11) {
    mesh_vacuum_hub_right_11.position.copy(endpoint_vacuum_hub_right_11.midpoint);
    mesh_vacuum_hub_right_11.quaternion.copy(endpoint_vacuum_hub_right_11.quaternion);
  }
  mesh_vacuum_hub_right_11.castShadow = options.castShadow ?? true;
  mesh_vacuum_hub_right_11.receiveShadow = options.receiveShadow ?? true;
  mesh_vacuum_hub_right_11.userData.sculptComponent = node_vacuum_hub_right_11.userData.sculptComponent;
  node_vacuum_hub_right_11.add(mesh_vacuum_hub_right_11);
  meshes["vacuum-hub-right"] = mesh_vacuum_hub_right_11;
  colliders["vacuum-hub-right"] = {"type": "cylinder", "offset": [0.0, 0.0, 0.0], "scale": [0.1466, 0.018, 0.1466], "isTrigger": false, "notes": "Advisory."};
  destructionGroups["wheel"] ??= [];
  destructionGroups["wheel"].push(node_vacuum_hub_right_11);

  const attachment_vacuum_hub_left_12 = {"parentId": "vacuum-wheel-left", "parentSocket": "hub-face", "contactType": "seated-on-face", "localStart": [0.0, -0.0125, 0.0], "localEnd": [0.0, 0.0125, 0.0], "contactNormal": [0.0, 1.0, 0.0], "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0, "baseRadius": 0.0733, "endRadius": 0.0733, "geometryFromSpec": true, "notes": "The cap's axis through the wheel's outer face."};
  const endpoint_vacuum_hub_left_12 = makeAttachmentEndpoint(attachment_vacuum_hub_left_12);
  const node_vacuum_hub_left_12 = new THREE.Group();
  node_vacuum_hub_left_12.name = "Left hub cap__pivot";
  if (endpoint_vacuum_hub_left_12) {
    node_vacuum_hub_left_12.position.copy(endpoint_vacuum_hub_left_12.start);
    node_vacuum_hub_left_12.rotation.set(0, 0, 0);
    node_vacuum_hub_left_12.scale.set(1, 1, 1);
  } else {
    node_vacuum_hub_left_12.position.set(0.0, 0.0478, 0.0);
    node_vacuum_hub_left_12.rotation.set(0.0, 0.0, 0.0);
    node_vacuum_hub_left_12.scale.set(0.1466, 0.025, 0.1466);
  }
  node_vacuum_hub_left_12.userData.sculptComponent = {"id": "vacuum-hub-left", "name": "Left hub cap", "level": "meso", "role": "trim", "importance": 0.4, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "A yellow disc on the wheel's outer face. It is the second yellow field on the prop and reads at distance as the wheel's eye.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(253, 218, 156, 1.0)", "secondaryAlbedo": "rgba(227, 196, 140, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "cylinder of diameter 0.1466 standing on the wheel's outboard face", "edgeTreatment": {"type": "rolled", "bevelRadius": 0.005, "segments": 16}, "deformationStack": [], "uvStrategy": "planar UVs on the cap face", "normalStrategy": "smooth over the rolled edge"}, "parent": "vacuum-wheel-left", "attachment": {"parentId": "vacuum-wheel-left", "parentSocket": "hub-face", "contactType": "seated-on-face", "localStart": [0.0, -0.0125, 0.0], "localEnd": [0.0, 0.0125, 0.0], "contactNormal": [0.0, 1.0, 0.0], "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0, "baseRadius": 0.0733, "endRadius": 0.0733, "geometryFromSpec": true, "notes": "The cap's axis through the wheel's outer face."}, "dimensions": {"width": 0.1466, "height": 0.025, "depth": 0.1466, "units": "world", "confidence": 0.7}, "transform": {"position": [0.0, 0.0478, 0.0], "rotation": [0.0, 0.0, 0.0]}, "actionProfile": {"animationRole": "trim", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0.0, 0.0, 0.0], "scale": [0.1466, 0.018, 0.1466], "isTrigger": false, "notes": "Advisory."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "accent-yellow", "materialLayers": ["accent-yellow"], "deformations": [], "joints": [], "seams": [{"id": "hub-left-wheel-seam", "with": "vacuum-wheel-left", "overlap": 0.02, "notes": "The cap is 0.025 thick and sunk 0.02 into the tyre's outer face, leaving 0.005 proud. Same fix as the top button, for the same reason."}], "localFeatures": [{"id": "hub-cap", "description": "The cap is 0.2093 of the canister's diameter, which is 0.59 of its own wheel. Both come from vertical image extents corrected by the same 0.975 factor, so their ratio is firmer than either absolute value.", "geometry": "cylinder diameter on the wheel's face", "evidenceRefs": ["full-object", "wheel-zone"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.06, "bumpAmplitude": 0.0, "normalPattern": "matte plastic with a slightly polished crown", "displacementPattern": "none", "occlusionPattern": "a thin ring of occlusion at the cap's root", "edgeWearPattern": "none", "notes": "Shares its material with the top button."}, "evidenceRefs": ["full-object", "wheel-zone"], "details": [], "fidelityTier": "blockout"};
  node_vacuum_hub_left_12.userData.actionProfile = node_vacuum_hub_left_12.userData.sculptComponent.actionProfile;
  (nodes["vacuum-wheel-left"] ?? root).add(node_vacuum_hub_left_12);
  nodes["vacuum-hub-left"] = node_vacuum_hub_left_12;
  const mesh_vacuum_hub_left_12Geometry = endpoint_vacuum_hub_left_12
    ? new THREE.CylinderGeometry(endpoint_vacuum_hub_left_12.endRadius, endpoint_vacuum_hub_left_12.baseRadius, endpoint_vacuum_hub_left_12.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 32, 1);
  const mesh_vacuum_hub_left_12 = new THREE.Mesh(
    mesh_vacuum_hub_left_12Geometry,
    materialMap["accent-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_vacuum_hub_left_12.name = "Left hub cap";
  if (endpoint_vacuum_hub_left_12) {
    mesh_vacuum_hub_left_12.position.copy(endpoint_vacuum_hub_left_12.midpoint);
    mesh_vacuum_hub_left_12.quaternion.copy(endpoint_vacuum_hub_left_12.quaternion);
  }
  mesh_vacuum_hub_left_12.castShadow = options.castShadow ?? true;
  mesh_vacuum_hub_left_12.receiveShadow = options.receiveShadow ?? true;
  mesh_vacuum_hub_left_12.userData.sculptComponent = node_vacuum_hub_left_12.userData.sculptComponent;
  node_vacuum_hub_left_12.add(mesh_vacuum_hub_left_12);
  meshes["vacuum-hub-left"] = mesh_vacuum_hub_left_12;
  colliders["vacuum-hub-left"] = {"type": "cylinder", "offset": [0.0, 0.0, 0.0], "scale": [0.1466, 0.018, 0.1466], "isTrigger": false, "notes": "Advisory."};
  destructionGroups["wheel"] ??= [];
  destructionGroups["wheel"].push(node_vacuum_hub_left_12);

  const attachment_vacuum_nub_13 = null;
  const endpoint_vacuum_nub_13 = makeAttachmentEndpoint(attachment_vacuum_nub_13);
  const node_vacuum_nub_13 = new THREE.Group();
  node_vacuum_nub_13.name = "Axle nub__pivot";
  if (endpoint_vacuum_nub_13) {
    node_vacuum_nub_13.position.copy(endpoint_vacuum_nub_13.start);
    node_vacuum_nub_13.rotation.set(0, 0, 0);
    node_vacuum_nub_13.scale.set(1, 1, 1);
  } else {
    node_vacuum_nub_13.position.set(0.32229, 0.34, -0.05);
    node_vacuum_nub_13.rotation.set(0.0, -0.0, -1.570796);
    node_vacuum_nub_13.scale.set(1.0, 1.0, 1.0);
  }
  node_vacuum_nub_13.userData.sculptComponent = {"id": "vacuum-nub", "name": "Axle nub", "level": "meso", "role": "trim", "importance": 0.3, "confidence": 0.55, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "A small coral bump on the shell above the right wheel. The reference shows exactly one, and it is what ties the wheel's colour up into the body instead of leaving the wheel as an unrelated disc.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(235, 130, 115, 1.0)", "secondaryAlbedo": "rgba(211, 117, 103, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "dome of base width 0.0739 revolved about Y on the shell's outward radial", "edgeTreatment": {"type": "rolled", "bevelRadius": 0.01, "segments": 14}, "deformationStack": [], "uvStrategy": "LatheGeometry cylindrical UVs", "normalStrategy": "smooth vertex normals from the revolved profile", "latheProfile": {"points": [[0.0, 0.0], [0.0323, 0.0], [0.037, 0.0139], [0.0308, 0.0308], [0.0169, 0.04], [0.0, 0.0431]], "segments": 14, "phiStart": 0.0, "phiLength": 6.283185}}, "parent": "vacuum-body", "attachment": null, "dimensions": {"width": 0.077, "height": 0.0431, "depth": 0.077, "units": "world", "confidence": 0.5}, "transform": {"position": [0.32229, 0.34, -0.05], "rotation": [0.0, -0.0, -1.570796], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "trim", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0.0, 0.0, 0.0], "scale": [0.077, 0.077, 0.077], "isTrigger": false, "notes": "Advisory."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "wheel-coral", "materialLayers": ["wheel-coral"], "deformations": [], "joints": [], "seams": [{"id": "nub-body-seam", "with": "vacuum-body", "overlap": 0.02, "notes": "The dome's base is sunk into the flank."}], "localFeatures": [{"id": "nub-dome", "description": "A dome 0.11 of the canister's diameter across, standing on the flank above the wheel. ONE, not two: the reference shows a single nub and the prop is mirrored only in its wheels, which is recorded in assumptions.", "geometry": "lathe dome on the body's outward radial", "evidenceRefs": ["full-object", "wheel-zone"], "confidence": 0.55}], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.07, "bumpAmplitude": 0.0, "normalPattern": "matte plastic matching the wheel", "displacementPattern": "none", "occlusionPattern": "a ring of occlusion where the dome meets the flank", "edgeWearPattern": "none", "notes": "The smallest coral field."}, "evidenceRefs": ["full-object", "wheel-zone"], "details": [], "fidelityTier": "blockout"};
  node_vacuum_nub_13.userData.actionProfile = node_vacuum_nub_13.userData.sculptComponent.actionProfile;
  (nodes["vacuum-body"] ?? root).add(node_vacuum_nub_13);
  nodes["vacuum-nub"] = node_vacuum_nub_13;
  const mesh_vacuum_nub_13Geometry = endpoint_vacuum_nub_13
    ? new THREE.CylinderGeometry(endpoint_vacuum_nub_13.endRadius, endpoint_vacuum_nub_13.baseRadius, endpoint_vacuum_nub_13.length, 32, 12)
    : buildLatheGeometry({"points": [[0.0, 0.0], [0.0323, 0.0], [0.037, 0.0139], [0.0308, 0.0308], [0.0169, 0.04], [0.0, 0.0431]], "segments": 14, "phiStart": 0.0, "phiLength": 6.283185});
  const mesh_vacuum_nub_13 = new THREE.Mesh(
    mesh_vacuum_nub_13Geometry,
    materialMap["wheel-coral"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_vacuum_nub_13.name = "Axle nub";
  if (endpoint_vacuum_nub_13) {
    mesh_vacuum_nub_13.position.copy(endpoint_vacuum_nub_13.midpoint);
    mesh_vacuum_nub_13.quaternion.copy(endpoint_vacuum_nub_13.quaternion);
  }
  mesh_vacuum_nub_13.castShadow = options.castShadow ?? true;
  mesh_vacuum_nub_13.receiveShadow = options.receiveShadow ?? true;
  mesh_vacuum_nub_13.userData.sculptComponent = node_vacuum_nub_13.userData.sculptComponent;
  node_vacuum_nub_13.add(mesh_vacuum_nub_13);
  meshes["vacuum-nub"] = mesh_vacuum_nub_13;
  colliders["vacuum-nub"] = {"type": "sphere", "offset": [0.0, 0.0, 0.0], "scale": [0.077, 0.077, 0.077], "isTrigger": false, "notes": "Advisory."};
  destructionGroups["body"] ??= [];
  destructionGroups["body"].push(node_vacuum_nub_13);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 256, "preferredTextureResolution": 1024, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "ranAnyway": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars."}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness, height, normal or AO", "single-frequency random noise", "glossy toy-plastic highlights on a matte moulded surface", "local colour described only in prose without material masks", "claiming exact PBR recovery from one image"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare the albedo palette and the local colour zones.", "Compare roughness and normal response under the key light.", "Compare contact darkening, seam occlusion and crown polish.", "Compare key, fill and rim structure, exposure, tone mapping and background.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals and uniform roughness.", "Capture a reference-matched render from the solved camera."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createApartmentCanisterVacuumLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Apartment Canister Vacuum look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = ["Ambient dominance: a soft studio render on a (219,218,218) plate. The lilac runs from a lit crown to a shaded underside without a hard terminator anywhere, which a bright neutral hemisphere plus a gentle key reproduces.", "Key light: warm-neutral directional at about 1.1 from high and camera left, which is where the top face's sheen and the handle's crown highlight both sit.", "Rim and environment light: weak neutral back light at about 0.3 so the shell's underside and the hose's far limb do not crush to black. No environment map: the reference shows no reflection on any of the six materials.", "Exposure and tone mapping: ACES filmic tone mapping with sRGB output at exposure 1.0. The navy at (55,76,114) is the value most at risk here - it is the darkest albedo on the prop and the one that will read near-black if exposure is pulled down.", "Contact shadow: the reference floats with a soft contact shadow under the shell and a second under the head. The review render has no ground plane so the silhouette mask stays clean."];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 256, "preferredTextureResolution": 1024, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "ranAnyway": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars."}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness, height, normal or AO", "single-frequency random noise", "glossy toy-plastic highlights on a matte moulded surface", "local colour described only in prose without material masks", "claiming exact PBR recovery from one image"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare the albedo palette and the local colour zones.", "Compare roughness and normal response under the key light.", "Compare contact darkening, seam occlusion and crown polish.", "Compare key, fill and rim structure, exposure, tone mapping and background.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals and uniform roughness.", "Capture a reference-matched render from the solved camera."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createApartmentCanisterVacuumEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function frameApartmentCanisterVacuumCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createApartmentCanisterVacuumPresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configureApartmentCanisterVacuumRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createApartmentCanisterVacuumInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}
