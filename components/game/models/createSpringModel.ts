// --- img2threejs refine-code edits applied by assets/reference/props/refine_props.py
// 1. buildLatheGeometry honours latheProfile.phiStart / phiLength (applied).
// 2. buildExtrudeGeometry honours profile2D.steps / profileStops / profileExempt /
//    axis / axisOffset / smoothShading (applied).
// 3. SculptMaterialSpec gets a real type; non-null assertions where the generator
//    indexes arrays, both for the project's strict tsconfig and eslint settings.
// 4. attachment.geometryFromSpec keeps the authored primitive instead of the
//    generator's cylinder-between-endpoints (applied).
// 5. primitive tessellation reduced for a prop that is instanced across a level.
// 6. duplicated userData payloads become references (same API, smaller file).
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

// Generated from ObjectSculptSpec target: Apartment Spring Jump Pad
// Sculpt build pass: structural-pass
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createApartmentSpringJumpPadModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Apartment Spring Jump Pad";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": true, "solveMethod": "elevation from the constant-width bands of the cap and the base, which project T cos(e) tall; cross-checked between the two parts. Azimuth is unconstrained: the prop is a solid of revolution apart from the chevrons.", "fovDegrees": 14.0, "aspect": 0.75, "orientation": {"yaw": 0.0, "pitch": -22.96, "roll": 0.0}, "targetHint": [0.0, 0.5, 0.0], "note": "Distance is not fixed here: the preview harness solves it by fitting the render's projected bounding box to the reference box (x 142-938, y 181-1237 of 1086x1448). The review render also passes yscale=3.18, which undoes the envelope squash so the Tier-1 aspect gate scores shape rather than the squash."}, "approximationNotes": []};

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["base-navy"] = createSculptMaterial(
    "base-navy",
    {"id": "base-navy", "name": "Base plastic", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#24324a", "color": "#24324a", "albedo": {"dominant": "#24324a", "secondary": ["#1a2536", "#37496b"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#24324a", "#1a2536", "#37496b"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.8, "variation": 0.08, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; crowns and handled edges trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.42, "contactShadowBias": 0.3, "notes": "Darken every part seam, recess and contact ring."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "rim-crown-sheen", "target": "pad-base/rim-roll", "notes": "The base's rolled outer rim is its brightest navy, measured at (58,74,108) against (33,43,64) on the shaded lower wall.", "evidenceRefs": ["full-object", "base-zone"], "roughness": 0.7, "mask": "the rolled rim band, the outer 12 percent of the top face"}, {"id": "seat-groove-occlusion", "target": "pad-base/coil-seat-groove", "notes": "The groove the coil seats in is the darkest navy in the frame; the reference loses the lowest turn into it entirely.", "evidenceRefs": ["full-object", "base-zone"], "roughness": 0.86, "aoBoost": 0.65, "mask": "the annular groove and the boss wall inside it"}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\spring\\crops\\base-navy-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.812, "estimatedFidelity": 0.812, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\spring\\pbr\\base-navy_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\spring\\pbr\\base-navy_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\spring\\pbr\\base-navy_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\spring\\pbr\\base-navy_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\spring\\pbr\\base-navy_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "Single moulded base. Matte, and the darkest value in the reference by a wide margin."},
    options
  );
  materialMap["coil-yellow"] = createSculptMaterial(
    "coil-yellow",
    {"id": "coil-yellow", "name": "Coil plastic", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#ffd84d", "color": "#ffd84d", "albedo": {"dominant": "#ffd84d", "secondary": ["#c9a52c", "#ffe98a"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#ffd84d", "#c9a52c", "#ffe98a"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.62, "variation": 0.1, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; crowns and handled edges trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.34, "contactShadowBias": 0.3, "notes": "Darken every part seam, recess and contact ring."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "coil-crown-sheen", "target": "pad-coil/tube-crown", "notes": "Each turn's upper surface catches the key and reads (245,195,33) against (176,116,10) on its underside: a full stop of range around a round section, which is what makes the coil read as a tube.", "evidenceRefs": ["full-object", "coil-zone"], "roughness": 0.52, "mask": "the upper third of the tube section, following the helix"}, {"id": "inter-turn-occlusion", "target": "pad-coil/turn-gap", "notes": "The gaps between turns are occluded from both sides and are markedly darker than either turn's underside.", "evidenceRefs": ["full-object", "coil-zone"], "roughness": 0.7, "aoBoost": 0.55, "mask": "the tube's lower flank where it faces the adjacent turn"}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\spring\\crops\\coil-yellow-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.795, "estimatedFidelity": 0.795, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\spring\\pbr\\coil-yellow_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\spring\\pbr\\coil-yellow_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\spring\\pbr\\coil-yellow_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\spring\\pbr\\coil-yellow_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\spring\\pbr\\coil-yellow_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "Corrected from the reference's own #F5C321 to PALETTE.yellow. The reference is a render under its own lighting, not a paint chip."},
    options
  );
  materialMap["cap-coral"] = createSculptMaterial(
    "cap-coral",
    {"id": "cap-coral", "name": "Cap plastic", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#ff5c65", "color": "#ff5c65", "albedo": {"dominant": "#ff5c65", "secondary": ["#cc4750", "#ff8f95"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#ff5c65", "#cc4750", "#ff8f95"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.58, "variation": 0.09, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; crowns and handled edges trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.3, "contactShadowBias": 0.3, "notes": "Darken every part seam, recess and contact ring."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "cap-crown-flat", "target": "pad-cap/top-face", "notes": "The cap's top face is the largest single-value surface in the frame and carries almost no gradient: it is a flat disc, not a dome.", "evidenceRefs": ["full-object", "cap-zone"], "roughness": 0.55, "mask": "the top face inside the rolled edge"}, {"id": "cap-underside-shade", "target": "pad-cap/edge-roll", "notes": "The cap's rolled edge turns under and loses the key completely along the bottom of its silhouette.", "evidenceRefs": ["full-object", "cap-zone"], "roughness": 0.64, "aoBoost": 0.4, "mask": "the lower half of the rolled edge"}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\spring\\crops\\cap-coral-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.803, "estimatedFidelity": 0.803, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\spring\\pbr\\cap-coral_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\spring\\pbr\\cap-coral_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\spring\\pbr\\cap-coral_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\spring\\pbr\\cap-coral_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\spring\\pbr\\cap-coral_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "Corrected from the reference's own #F56058 to PALETTE.red."},
    options
  );
  materialMap["chevron-cream"] = createSculptMaterial(
    "chevron-cream",
    {"id": "chevron-cream", "name": "Chevron inlay", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#fff8e8", "color": "#fff8e8", "albedo": {"dominant": "#fff8e8", "secondary": ["#e6dcc9", "#fffdf6"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#fff8e8", "#e6dcc9", "#fffdf6"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.55, "variation": 0.08, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; crowns and handled edges trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.26, "contactShadowBias": 0.3, "notes": "Darken every part seam, recess and contact ring."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "chevron-relief-edge", "target": "pad-chevron-0/chevron-relief", "notes": "Not observed in the reference: this part is a gameplay affordance carried over from the prop it replaces, so its finish is matched to the cap's rather than sampled.", "evidenceRefs": ["not-in-reference"], "roughness": 0.55, "aoBoost": 0.35, "mask": "the chamfer around each chevron"}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\spring\\crops\\chevron-cream-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.3, "estimatedFidelity": 0.3, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\spring\\pbr\\chevron-cream_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\spring\\pbr\\chevron-cream_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\spring\\pbr\\chevron-cream_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\spring\\pbr\\chevron-cream_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\spring\\pbr\\chevron-cream_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "NOT IN THE REFERENCE. Cream so the launch arrows carry against the coral cap; see assumptions and risks."},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const attachment_pad_base_0 = null;
  const endpoint_pad_base_0 = makeAttachmentEndpoint(attachment_pad_base_0);
  const node_pad_base_0 = new THREE.Group();
  node_pad_base_0.name = "Base disc__pivot";
  if (endpoint_pad_base_0) {
    node_pad_base_0.position.copy(endpoint_pad_base_0.start);
    node_pad_base_0.rotation.set(0, 0, 0);
    node_pad_base_0.scale.set(1, 1, 1);
  } else {
    node_pad_base_0.position.set(0.0, 0.0, 0.0);
    node_pad_base_0.rotation.set(0.0, 0.0, 0.0);
    node_pad_base_0.scale.set(1.0, 1.0, 1.0);
  }
  node_pad_base_0.userData.sculptComponent = {"id": "pad-base", "name": "Base disc", "level": "macro", "role": "shell", "importance": 1.0, "confidence": 0.85, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "One revolved moulded body. The reference's outer wall rolls continuously from the top face down and under with no chamfer facet anywhere, so it is a revolved profile rather than a stack of discs.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 50, 74, 1.0)", "secondaryAlbedo": "rgba(32, 45, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "profile revolved about Y: flat underside, rolled outer rim, top face broken by the annular coil groove and a raised centre boss", "edgeTreatment": {"type": "rolled", "bevelRadius": 0.0269, "segments": 32}, "deformationStack": ["outer rim roll 0.0269", "coil seat groove 0.02 deep"], "uvStrategy": "LatheGeometry cylindrical UVs; one tile per part", "normalStrategy": "smooth vertex normals from the revolved profile", "latheProfile": {"points": [[0.0, 0.0], [0.6555, 0.0], [0.67433, 0.0048], [0.6824, 0.0269], [0.67433, 0.0549], [0.6555, 0.0597], [0.5128, 0.0597], [0.5008, 0.0397], [0.388, 0.0397], [0.376, 0.0597], [0.2068, 0.0597], [0.0, 0.0597]], "segments": 32, "phiStart": 0.0, "phiLength": 6.283185}}, "parent": null, "attachment": null, "dimensions": {"width": 1.3647, "height": 0.0597, "depth": 1.3647, "units": "world", "confidence": 0.85}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0.0, 0.02985, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "pad-floor", "localPosition": [0.0, 0.0, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Underside of the base; sits on the deck plane at y = 0."}, {"id": "coil-seat", "localPosition": [0.0, 0.0397, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Floor of the annular groove, where the coil's bottom turn sits."}], "collider": {"type": "cylinder", "offset": [0.0, 0.225, 0.0], "scale": [1.4, 0.45, 1.4], "isTrigger": false, "notes": "Advisory proxy over the whole pad. TrapRenderer's Spring adds no collider: it launches on a distance test of |dx| and |dz| < 0.7, which is the 1.40 this proxy matches."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "base", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "base-navy", "materialLayers": ["base-navy"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rim-roll", "description": "The outer wall rolls by 0.0269 units over both the top and the bottom edge, so the base's silhouette curves in at the deck instead of meeting it square.", "geometry": "lathe profile with the widest radius at 45 percent of the thickness rather than at either face", "evidenceRefs": ["full-object", "base-zone"], "confidence": 0.85}, {"id": "coil-seat-groove", "description": "An annular groove 0.02 deep between radii 0.376 and 0.5128 takes the coil's bottom turn. The reference loses that turn behind a raised step, which is this groove's outer wall.", "geometry": "profile stepping down and back up inside the top face", "evidenceRefs": ["full-object", "base-zone", "coil-zone"], "confidence": 0.7}, {"id": "base-proportion", "description": "The base is 1.3647 across and 0.0597 thick. The diameter is measured; the thickness is the reference's 0.140 of diameter after the envelope squash, and is stated as a deviation rather than a match.", "geometry": "lathe profile extents", "evidenceRefs": ["full-object", "base-zone"], "confidence": 0.85}], "surfaceDetail": {"macroRoughness": 0.8, "microRoughness": 0.08, "bumpAmplitude": 0.0, "normalPattern": "matte moulded ABS with very low tone drift", "displacementPattern": "none", "occlusionPattern": "occlusion in the coil groove and under the rolled rim", "edgeWearPattern": "none - the reference base shows no wear", "notes": "The darkest and most matte surface in the reference."}, "evidenceRefs": ["full-object", "base-zone"], "details": [], "fidelityTier": "blockout"};
  node_pad_base_0.userData.actionProfile = node_pad_base_0.userData.sculptComponent.actionProfile;
  (nodes["root"] ?? root).add(node_pad_base_0);
  nodes["pad-base"] = node_pad_base_0;
  const mesh_pad_base_0Geometry = endpoint_pad_base_0
    ? new THREE.CylinderGeometry(endpoint_pad_base_0.endRadius, endpoint_pad_base_0.baseRadius, endpoint_pad_base_0.length, 32, 12)
    : buildLatheGeometry({"points": [[0.0, 0.0], [0.6555, 0.0], [0.67433, 0.0048], [0.6824, 0.0269], [0.67433, 0.0549], [0.6555, 0.0597], [0.5128, 0.0597], [0.5008, 0.0397], [0.388, 0.0397], [0.376, 0.0597], [0.2068, 0.0597], [0.0, 0.0597]], "segments": 32, "phiStart": 0.0, "phiLength": 6.283185});
  const mesh_pad_base_0 = new THREE.Mesh(
    mesh_pad_base_0Geometry,
    materialMap["base-navy"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pad_base_0.name = "Base disc";
  if (endpoint_pad_base_0) {
    mesh_pad_base_0.position.copy(endpoint_pad_base_0.midpoint);
    mesh_pad_base_0.quaternion.copy(endpoint_pad_base_0.quaternion);
  }
  mesh_pad_base_0.castShadow = options.castShadow ?? true;
  mesh_pad_base_0.receiveShadow = options.receiveShadow ?? true;
  mesh_pad_base_0.userData.sculptComponent = node_pad_base_0.userData.sculptComponent;
  node_pad_base_0.add(mesh_pad_base_0);
  meshes["pad-base"] = mesh_pad_base_0;
  colliders["pad-base"] = {"type": "cylinder", "offset": [0.0, 0.225, 0.0], "scale": [1.4, 0.45, 1.4], "isTrigger": false, "notes": "Advisory proxy over the whole pad. TrapRenderer's Spring adds no collider: it launches on a distance test of |dx| and |dz| < 0.7, which is the 1.40 this proxy matches."};
  destructionGroups["base"] ??= [];
  destructionGroups["base"].push(node_pad_base_0);
  const socket_pad_base_pad_floor_0 = new THREE.Object3D();
  socket_pad_base_pad_floor_0.name = "pad-floor";
  socket_pad_base_pad_floor_0.position.set(0.0, 0.0, 0.0);
  socket_pad_base_pad_floor_0.rotation.set(0.0, 0.0, 0.0);
  socket_pad_base_pad_floor_0.userData.socket = {"id": "pad-floor", "localPosition": [0.0, 0.0, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Underside of the base; sits on the deck plane at y = 0."};
  node_pad_base_0.add(socket_pad_base_pad_floor_0);
  sockets["pad-base:pad-floor"] = socket_pad_base_pad_floor_0;
  const socket_pad_base_coil_seat_1 = new THREE.Object3D();
  socket_pad_base_coil_seat_1.name = "coil-seat";
  socket_pad_base_coil_seat_1.position.set(0.0, 0.0397, 0.0);
  socket_pad_base_coil_seat_1.rotation.set(0.0, 0.0, 0.0);
  socket_pad_base_coil_seat_1.userData.socket = {"id": "coil-seat", "localPosition": [0.0, 0.0397, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Floor of the annular groove, where the coil's bottom turn sits."};
  node_pad_base_0.add(socket_pad_base_coil_seat_1);
  sockets["pad-base:coil-seat"] = socket_pad_base_coil_seat_1;

  const attachment_pad_coil_1 = {"parentId": "pad-base", "parentSocket": "coil-seat", "contactType": "seated-in-recess", "localStart": [0.0, 0.1262, 0.0], "localEnd": [0.0, 1.2238, 0.0], "contactNormal": [0.0, 1.0, 0.0], "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0, "baseRadius": 0.0855, "endRadius": 0.0855, "geometryFromSpec": true, "notes": "The coil's axis, from the groove floor in the base to the cap's underside. Declared because it is true and because the strict gate requires it; the generator's cylinder substitution for attached tubes is undone in refine_props.py, which is recorded in risks."};
  const endpoint_pad_coil_1 = makeAttachmentEndpoint(attachment_pad_coil_1);
  const node_pad_coil_1 = new THREE.Group();
  node_pad_coil_1.name = "Compression coil__pivot";
  if (endpoint_pad_coil_1) {
    node_pad_coil_1.position.copy(endpoint_pad_coil_1.start);
    node_pad_coil_1.rotation.set(0, 0, 0);
    node_pad_coil_1.scale.set(1, 1, 1);
  } else {
    node_pad_coil_1.position.set(0.0, 0.0, 0.0);
    node_pad_coil_1.rotation.set(0.0, 0.0, 0.0);
    node_pad_coil_1.scale.set(1.0, 0.31451, 1.0);
  }
  node_pad_coil_1.userData.sculptComponent = {"id": "pad-coil", "name": "Compression coil", "level": "macro", "role": "spring", "importance": 1.0, "confidence": 0.8, "primitive": "tube", "topologyClass": "continuous-sculpt", "topologyRationale": "A round section swept along a helix. There is no face and no edge on it anywhere in the reference; every turn shades as a cylinder rolling away from the key.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 216, 77, 1.0)", "secondaryAlbedo": "rgba(229, 194, 69, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "3-turn helix of mean radius 0.4444, swept with a round section of radius 0.0855", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 24}, "deformationStack": ["node scale.y 0.31451 squashes pitch and tube section together"], "uvStrategy": "TubeGeometry UVs running along the helix", "normalStrategy": "smooth vertex normals from the swept section", "tubePath": {"points": [[0.4444, 0.21176, 0.0], [0.42926, 0.22462, 0.11502], [0.38486, 0.23749, 0.2222], [0.31424, 0.25035, 0.31424], [0.2222, 0.26322, 0.38486], [0.11502, 0.27608, 0.42926], [0.0, 0.28894, 0.4444], [-0.11502, 0.30181, 0.42926], [-0.2222, 0.31467, 0.38486], [-0.31424, 0.32754, 0.31424], [-0.38486, 0.3404, 0.2222], [-0.42926, 0.35326, 0.11502], [-0.4444, 0.36613, 0.0], [-0.42926, 0.37899, -0.11502], [-0.38486, 0.39185, -0.2222], [-0.31424, 0.40472, -0.31424], [-0.2222, 0.41758, -0.38486], [-0.11502, 0.43045, -0.42926], [-0.0, 0.44331, -0.4444], [0.11502, 0.45617, -0.42926], [0.2222, 0.46904, -0.38486], [0.31424, 0.4819, -0.31424], [0.38486, 0.49477, -0.2222], [0.42926, 0.50763, -0.11502], [0.4444, 0.52049, -0.0], [0.42926, 0.53336, 0.11502], [0.38486, 0.54622, 0.2222], [0.31424, 0.55909, 0.31424], [0.2222, 0.57195, 0.38486], [0.11502, 0.58481, 0.42926], [0.0, 0.59768, 0.4444], [-0.11502, 0.61054, 0.42926], [-0.2222, 0.62341, 0.38486], [-0.31424, 0.63627, 0.31424], [-0.38486, 0.64913, 0.2222], [-0.42926, 0.662, 0.11502], [-0.4444, 0.67486, 0.0], [-0.42926, 0.68773, -0.11502], [-0.38486, 0.70059, -0.2222], [-0.31424, 0.71345, -0.31424], [-0.2222, 0.72632, -0.38486], [-0.11502, 0.73918, -0.42926], [-0.0, 0.75204, -0.4444], [0.11502, 0.76491, -0.42926], [0.2222, 0.77777, -0.38486], [0.31424, 0.79064, -0.31424], [0.38486, 0.8035, -0.2222], [0.42926, 0.81636, -0.11502], [0.4444, 0.82923, -0.0], [0.42926, 0.84209, 0.11502], [0.38486, 0.85496, 0.2222], [0.31424, 0.86782, 0.31424], [0.2222, 0.88068, 0.38486], [0.11502, 0.89355, 0.42926], [0.0, 0.90641, 0.4444], [-0.11502, 0.91928, 0.42926], [-0.2222, 0.93214, 0.38486], [-0.31424, 0.945, 0.31424], [-0.38486, 0.95787, 0.2222], [-0.42926, 0.97073, 0.11502], [-0.4444, 0.9836, 0.0], [-0.42926, 0.99646, -0.11502], [-0.38486, 1.00932, -0.2222], [-0.31424, 1.02219, -0.31424], [-0.2222, 1.03505, -0.38486], [-0.11502, 1.04792, -0.42926], [-0.0, 1.06078, -0.4444], [0.11502, 1.07364, -0.42926], [0.2222, 1.08651, -0.38486], [0.31424, 1.09937, -0.31424], [0.38486, 1.11223, -0.2222], [0.42926, 1.1251, -0.11502], [0.4444, 1.13796, -0.0]], "radius": 0.0855, "radialSegments": 8, "closed": false}}, "parent": "pad-base", "attachment": {"parentId": "pad-base", "parentSocket": "coil-seat", "contactType": "seated-in-recess", "localStart": [0.0, 0.1262, 0.0], "localEnd": [0.0, 1.2238, 0.0], "contactNormal": [0.0, 1.0, 0.0], "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0, "baseRadius": 0.0855, "endRadius": 0.0855, "geometryFromSpec": true, "notes": "The coil's axis, from the groove floor in the base to the cap's underside. Declared because it is true and because the strict gate requires it; the generator's cylinder substitution for attached tubes is undone in refine_props.py, which is recorded in risks."}, "dimensions": {"width": 1.0597, "height": 0.3052, "depth": 1.0597, "units": "world", "confidence": 0.8}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 0.31451, 1.0]}, "actionProfile": {"animationRole": "spring", "pivot": {"mode": "center", "localPosition": [0.0, 0.2123, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "coil-crown", "localPosition": [0.0, 1.2238, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Top of the coil, where the cap seats. Local to the squashed node."}], "collider": {"type": "cylinder", "offset": [0.0, 0.4852, 0.0], "scale": [1.0597, 0.9704, 1.0597], "isTrigger": false, "notes": "Advisory; the coil never touches the player."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "coil", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "coil-yellow", "materialLayers": ["coil-yellow"], "deformations": [], "joints": [], "seams": [{"id": "coil-base-seam", "with": "pad-base", "overlap": 0.02, "notes": "The bottom turn sits inside the base's annular groove, not on its face."}], "localFeatures": [{"id": "tube-crown", "description": "Each turn is a round section: its crown catches the key and its underside falls a full stop away, which is the whole reason the coil reads as a spring rather than as three stacked rings.", "geometry": "TubeGeometry round cross-section, 8 radial segments", "evidenceRefs": ["full-object", "coil-zone"], "confidence": 0.9}, {"id": "turn-gap", "description": "Three turns at a built pitch of 0.0971 against the 0.084 measured, with a 0.0538 section leave a real gap between turns. The reference's column scan at x=540 gives bands of 92, 99 and 99 px separated by gaps of 41 and 49 px.", "geometry": "helix pitch against tube diameter, both measured", "evidenceRefs": ["full-object", "coil-zone"], "confidence": 0.85}, {"id": "turn-count", "description": "3 turns. Not a guess: 3 pitches of 151.5 px plus one tube diameter of 97 px reproduces the 551 px span measured between the base's top face and the cap's underside to within a pixel.", "geometry": "helix sample count", "evidenceRefs": ["full-object", "coil-zone"], "confidence": 0.9}], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "matte moulded ABS, smoother than the base", "displacementPattern": "none", "occlusionPattern": "deep occlusion in the gaps between turns", "edgeWearPattern": "none", "notes": "The only round-section part in the prop."}, "evidenceRefs": ["full-object", "coil-zone"], "details": [], "fidelityTier": "blockout"};
  node_pad_coil_1.userData.actionProfile = node_pad_coil_1.userData.sculptComponent.actionProfile;
  (nodes["pad-base"] ?? root).add(node_pad_coil_1);
  nodes["pad-coil"] = node_pad_coil_1;
  const mesh_pad_coil_1Geometry = endpoint_pad_coil_1
    ? new THREE.CylinderGeometry(endpoint_pad_coil_1.endRadius, endpoint_pad_coil_1.baseRadius, endpoint_pad_coil_1.length, 32, 12)
    : buildTubeGeometry({"points": [[0.4444, 0.21176, 0.0], [0.42926, 0.22462, 0.11502], [0.38486, 0.23749, 0.2222], [0.31424, 0.25035, 0.31424], [0.2222, 0.26322, 0.38486], [0.11502, 0.27608, 0.42926], [0.0, 0.28894, 0.4444], [-0.11502, 0.30181, 0.42926], [-0.2222, 0.31467, 0.38486], [-0.31424, 0.32754, 0.31424], [-0.38486, 0.3404, 0.2222], [-0.42926, 0.35326, 0.11502], [-0.4444, 0.36613, 0.0], [-0.42926, 0.37899, -0.11502], [-0.38486, 0.39185, -0.2222], [-0.31424, 0.40472, -0.31424], [-0.2222, 0.41758, -0.38486], [-0.11502, 0.43045, -0.42926], [-0.0, 0.44331, -0.4444], [0.11502, 0.45617, -0.42926], [0.2222, 0.46904, -0.38486], [0.31424, 0.4819, -0.31424], [0.38486, 0.49477, -0.2222], [0.42926, 0.50763, -0.11502], [0.4444, 0.52049, -0.0], [0.42926, 0.53336, 0.11502], [0.38486, 0.54622, 0.2222], [0.31424, 0.55909, 0.31424], [0.2222, 0.57195, 0.38486], [0.11502, 0.58481, 0.42926], [0.0, 0.59768, 0.4444], [-0.11502, 0.61054, 0.42926], [-0.2222, 0.62341, 0.38486], [-0.31424, 0.63627, 0.31424], [-0.38486, 0.64913, 0.2222], [-0.42926, 0.662, 0.11502], [-0.4444, 0.67486, 0.0], [-0.42926, 0.68773, -0.11502], [-0.38486, 0.70059, -0.2222], [-0.31424, 0.71345, -0.31424], [-0.2222, 0.72632, -0.38486], [-0.11502, 0.73918, -0.42926], [-0.0, 0.75204, -0.4444], [0.11502, 0.76491, -0.42926], [0.2222, 0.77777, -0.38486], [0.31424, 0.79064, -0.31424], [0.38486, 0.8035, -0.2222], [0.42926, 0.81636, -0.11502], [0.4444, 0.82923, -0.0], [0.42926, 0.84209, 0.11502], [0.38486, 0.85496, 0.2222], [0.31424, 0.86782, 0.31424], [0.2222, 0.88068, 0.38486], [0.11502, 0.89355, 0.42926], [0.0, 0.90641, 0.4444], [-0.11502, 0.91928, 0.42926], [-0.2222, 0.93214, 0.38486], [-0.31424, 0.945, 0.31424], [-0.38486, 0.95787, 0.2222], [-0.42926, 0.97073, 0.11502], [-0.4444, 0.9836, 0.0], [-0.42926, 0.99646, -0.11502], [-0.38486, 1.00932, -0.2222], [-0.31424, 1.02219, -0.31424], [-0.2222, 1.03505, -0.38486], [-0.11502, 1.04792, -0.42926], [-0.0, 1.06078, -0.4444], [0.11502, 1.07364, -0.42926], [0.2222, 1.08651, -0.38486], [0.31424, 1.09937, -0.31424], [0.38486, 1.11223, -0.2222], [0.42926, 1.1251, -0.11502], [0.4444, 1.13796, -0.0]], "radius": 0.0855, "radialSegments": 8, "closed": false});
  const mesh_pad_coil_1 = new THREE.Mesh(
    mesh_pad_coil_1Geometry,
    materialMap["coil-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pad_coil_1.name = "Compression coil";
  if (endpoint_pad_coil_1) {
    mesh_pad_coil_1.position.copy(endpoint_pad_coil_1.midpoint);
    mesh_pad_coil_1.quaternion.copy(endpoint_pad_coil_1.quaternion);
  }
  mesh_pad_coil_1.castShadow = options.castShadow ?? true;
  mesh_pad_coil_1.receiveShadow = options.receiveShadow ?? true;
  mesh_pad_coil_1.userData.sculptComponent = node_pad_coil_1.userData.sculptComponent;
  node_pad_coil_1.add(mesh_pad_coil_1);
  meshes["pad-coil"] = mesh_pad_coil_1;
  colliders["pad-coil"] = {"type": "cylinder", "offset": [0.0, 0.4852, 0.0], "scale": [1.0597, 0.9704, 1.0597], "isTrigger": false, "notes": "Advisory; the coil never touches the player."};
  destructionGroups["coil"] ??= [];
  destructionGroups["coil"].push(node_pad_coil_1);
  const socket_pad_coil_coil_crown_0 = new THREE.Object3D();
  socket_pad_coil_coil_crown_0.name = "coil-crown";
  socket_pad_coil_coil_crown_0.position.set(0.0, 1.2238, 0.0);
  socket_pad_coil_coil_crown_0.rotation.set(0.0, 0.0, 0.0);
  socket_pad_coil_coil_crown_0.userData.socket = {"id": "coil-crown", "localPosition": [0.0, 1.2238, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Top of the coil, where the cap seats. Local to the squashed node."};
  node_pad_coil_1.add(socket_pad_coil_coil_crown_0);
  sockets["pad-coil:coil-crown"] = socket_pad_coil_coil_crown_0;

  const attachment_pad_cap_2 = null;
  const endpoint_pad_cap_2 = makeAttachmentEndpoint(attachment_pad_cap_2);
  const node_pad_cap_2 = new THREE.Group();
  node_pad_cap_2.name = "Strike cap__pivot";
  if (endpoint_pad_cap_2) {
    node_pad_cap_2.position.copy(endpoint_pad_cap_2.start);
    node_pad_cap_2.rotation.set(0, 0, 0);
    node_pad_cap_2.scale.set(1, 1, 1);
  } else {
    node_pad_cap_2.position.set(0.0, 1.1411, 0.0);
    node_pad_cap_2.rotation.set(0.0, 0.0, 0.0);
    node_pad_cap_2.scale.set(1.0, 3.17955, 1.0);
  }
  node_pad_cap_2.userData.sculptComponent = {"id": "pad-cap", "name": "Strike cap", "level": "macro", "role": "cap", "importance": 1.0, "confidence": 0.85, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "A revolved disc whose edge rolls continuously from the flat top face down and under. The reference shows one broad flat top and no chamfer anywhere on the edge.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 92, 101, 1.0)", "secondaryAlbedo": "rgba(229, 82, 90, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "profile revolved about Y: flat top face inside a fully rolled edge", "edgeTreatment": {"type": "rolled", "bevelRadius": 0.0425, "segments": 32}, "deformationStack": ["edge roll 0.0425 on both faces"], "uvStrategy": "LatheGeometry cylindrical UVs", "normalStrategy": "smooth vertex normals from the revolved profile", "latheProfile": {"points": [[0.0, 0.0], [0.6617, 0.0], [0.6898, 0.0119], [0.7, 0.0425], [0.6898, 0.0732], [0.6617, 0.0851], [0.0, 0.0851]], "segments": 32, "phiStart": 0.0, "phiLength": 6.283185}}, "parent": "pad-coil", "attachment": null, "dimensions": {"width": 1.4, "height": 0.0851, "depth": 1.4, "units": "world", "confidence": 0.85}, "transform": {"position": [0.0, 1.1411, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 3.17955, 1.0]}, "actionProfile": {"animationRole": "strike-surface", "pivot": {"mode": "center", "localPosition": [0.0, 0.0425, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": false, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "launch-face", "localPosition": [0.0, 0.0851, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "The surface the runner lands on; the launch impulse is applied here by TrapRenderer's distance test."}], "collider": {"type": "cylinder", "offset": [0.0, 0.0425, 0.0], "scale": [1.4, 0.0851, 1.4], "isTrigger": false, "notes": "The widest part of the prop, and the part the launch footprint is matched to."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "cap-coral", "materialLayers": ["cap-coral"], "deformations": [], "joints": [], "seams": [{"id": "cap-coil-seam", "with": "pad-coil", "overlap": 0.02, "notes": "The coil's top turn is buried in the cap's underside roll."}], "localFeatures": [{"id": "top-face", "description": "The cap's flat top is the largest single surface in the reference and carries almost no gradient across it. A domed cap would show a clear falloff to its edge.", "geometry": "lathe profile running flat from the axis to the edge roll", "evidenceRefs": ["full-object", "cap-zone"], "confidence": 0.9}, {"id": "edge-roll", "description": "The edge rolls fully: the widest radius is at half the thickness, so the cap tucks under as well as over and its underside is never seen as a flat face.", "geometry": "lathe profile with maximum radius at 0.5 of the thickness", "evidenceRefs": ["full-object", "cap-zone"], "confidence": 0.85}, {"id": "cap-overhangs-coil", "description": "The cap is 1.4 across against the coil's 1.0597: it overhangs the spring by a third of the coil's radius on every side, which is what makes the reference read as a stool rather than as a coil with a lid.", "geometry": "measured diameters", "evidenceRefs": ["full-object", "cap-zone", "coil-zone"], "confidence": 0.85}], "surfaceDetail": {"macroRoughness": 0.58, "microRoughness": 0.09, "bumpAmplitude": 0.0, "normalPattern": "matte moulded ABS", "displacementPattern": "none", "occlusionPattern": "occlusion under the rolled edge", "edgeWearPattern": "none", "notes": "The brightest and largest surface in the reference."}, "evidenceRefs": ["full-object", "cap-zone"], "details": [], "fidelityTier": "blockout"};
  node_pad_cap_2.userData.actionProfile = node_pad_cap_2.userData.sculptComponent.actionProfile;
  (nodes["pad-coil"] ?? root).add(node_pad_cap_2);
  nodes["pad-cap"] = node_pad_cap_2;
  const mesh_pad_cap_2Geometry = endpoint_pad_cap_2
    ? new THREE.CylinderGeometry(endpoint_pad_cap_2.endRadius, endpoint_pad_cap_2.baseRadius, endpoint_pad_cap_2.length, 32, 12)
    : buildLatheGeometry({"points": [[0.0, 0.0], [0.6617, 0.0], [0.6898, 0.0119], [0.7, 0.0425], [0.6898, 0.0732], [0.6617, 0.0851], [0.0, 0.0851]], "segments": 32, "phiStart": 0.0, "phiLength": 6.283185});
  const mesh_pad_cap_2 = new THREE.Mesh(
    mesh_pad_cap_2Geometry,
    materialMap["cap-coral"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pad_cap_2.name = "Strike cap";
  if (endpoint_pad_cap_2) {
    mesh_pad_cap_2.position.copy(endpoint_pad_cap_2.midpoint);
    mesh_pad_cap_2.quaternion.copy(endpoint_pad_cap_2.quaternion);
  }
  mesh_pad_cap_2.castShadow = options.castShadow ?? true;
  mesh_pad_cap_2.receiveShadow = options.receiveShadow ?? true;
  mesh_pad_cap_2.userData.sculptComponent = node_pad_cap_2.userData.sculptComponent;
  node_pad_cap_2.add(mesh_pad_cap_2);
  meshes["pad-cap"] = mesh_pad_cap_2;
  colliders["pad-cap"] = {"type": "cylinder", "offset": [0.0, 0.0425, 0.0], "scale": [1.4, 0.0851, 1.4], "isTrigger": false, "notes": "The widest part of the prop, and the part the launch footprint is matched to."};
  destructionGroups["cap"] ??= [];
  destructionGroups["cap"].push(node_pad_cap_2);
  const socket_pad_cap_launch_face_0 = new THREE.Object3D();
  socket_pad_cap_launch_face_0.name = "launch-face";
  socket_pad_cap_launch_face_0.position.set(0.0, 0.0851, 0.0);
  socket_pad_cap_launch_face_0.rotation.set(0.0, 0.0, 0.0);
  socket_pad_cap_launch_face_0.userData.socket = {"id": "launch-face", "localPosition": [0.0, 0.0851, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "The surface the runner lands on; the launch impulse is applied here by TrapRenderer's distance test."};
  node_pad_cap_2.add(socket_pad_cap_launch_face_0);
  sockets["pad-cap:launch-face"] = socket_pad_cap_launch_face_0;

  const attachment_pad_chevron_0_3 = null;
  const endpoint_pad_chevron_0_3 = makeAttachmentEndpoint(attachment_pad_chevron_0_3);
  const node_pad_chevron_0_3 = new THREE.Group();
  node_pad_chevron_0_3.name = "Launch chevron 0__pivot";
  if (endpoint_pad_chevron_0_3) {
    node_pad_chevron_0_3.position.copy(endpoint_pad_chevron_0_3.start);
    node_pad_chevron_0_3.rotation.set(0, 0, 0);
    node_pad_chevron_0_3.scale.set(1, 1, 1);
  } else {
    node_pad_chevron_0_3.position.set(0.0, 0.0656, 0.462);
    node_pad_chevron_0_3.rotation.set(0.0, 0.0, 0.0);
    node_pad_chevron_0_3.scale.set(1.0, 1.0, 1.0);
  }
  node_pad_chevron_0_3.userData.sculptComponent = {"id": "pad-chevron-0", "name": "Launch chevron 0", "level": "meso", "role": "affordance", "importance": 0.35, "confidence": 0.3, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A flat inlay with a hard edge, deliberately unlike every other part of this prop: it is signage, not moulding.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 248, 232, 1.0)", "secondaryAlbedo": "rgba(229, 223, 208, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "chevron outline extruded as a shallow relief on the cap's top face", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.0076, "segments": 1}, "deformationStack": [], "uvStrategy": "ExtrudeGeometry cap UVs", "normalStrategy": "flat facet normals", "profile2D": {"points": [[0.0, 0.0595], [0.0805, 0.0], [0.0805, -0.0369], [0.0, 0.0226], [-0.0805, -0.0369], [-0.0805, 0.0]], "depth": 0.0255, "axis": "y", "axisOffset": 0.0}}, "parent": "pad-cap", "attachment": null, "dimensions": {"width": 0.161, "height": 0.0255, "depth": 0.0964, "units": "world", "confidence": 0.3}, "transform": {"position": [0.0, 0.0656, 0.462], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.3}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "chevron-cream", "materialLayers": ["chevron-cream"], "deformations": [], "joints": [], "seams": [{"id": "chevron-0-cap-seam", "with": "pad-cap", "overlap": 0.0195, "notes": "The inlay is buried all but its visible relief; the cap top drops by that same amount so the prop still tops out at 0.45."}], "localFeatures": [{"id": "chevron-relief", "description": "Standing 0.006 proud of the cap face at radius 0.462, pointing outward at 0 degrees. NOT OBSERVED IN THE REFERENCE.", "geometry": "extruded outline placed on the cap's top face", "evidenceRefs": ["not-in-reference"], "confidence": 0.3}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.08, "bumpAmplitude": 0.0, "normalPattern": "matte moulded ABS matched to the cap", "displacementPattern": "none", "occlusionPattern": "chamfer occlusion around the inlay", "edgeWearPattern": "none", "notes": "Not observed in the reference; finish matched to the cap it sits on."}, "evidenceRefs": ["not-in-reference"], "details": [], "fidelityTier": "form-refinement"};
  node_pad_chevron_0_3.userData.actionProfile = node_pad_chevron_0_3.userData.sculptComponent.actionProfile;
  (nodes["pad-cap"] ?? root).add(node_pad_chevron_0_3);
  nodes["pad-chevron-0"] = node_pad_chevron_0_3;
  const mesh_pad_chevron_0_3Geometry = endpoint_pad_chevron_0_3
    ? new THREE.CylinderGeometry(endpoint_pad_chevron_0_3.endRadius, endpoint_pad_chevron_0_3.baseRadius, endpoint_pad_chevron_0_3.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0.0, 0.0595], [0.0805, 0.0], [0.0805, -0.0369], [0.0, 0.0226], [-0.0805, -0.0369], [-0.0805, 0.0]], "depth": 0.0255, "axis": "y", "axisOffset": 0.0});
  const mesh_pad_chevron_0_3 = new THREE.Mesh(
    mesh_pad_chevron_0_3Geometry,
    materialMap["chevron-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pad_chevron_0_3.name = "Launch chevron 0";
  if (endpoint_pad_chevron_0_3) {
    mesh_pad_chevron_0_3.position.copy(endpoint_pad_chevron_0_3.midpoint);
    mesh_pad_chevron_0_3.quaternion.copy(endpoint_pad_chevron_0_3.quaternion);
  }
  mesh_pad_chevron_0_3.castShadow = options.castShadow ?? true;
  mesh_pad_chevron_0_3.receiveShadow = options.receiveShadow ?? true;
  mesh_pad_chevron_0_3.userData.sculptComponent = node_pad_chevron_0_3.userData.sculptComponent;
  node_pad_chevron_0_3.add(mesh_pad_chevron_0_3);
  meshes["pad-chevron-0"] = mesh_pad_chevron_0_3;
  colliders["pad-chevron-0"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["cap"] ??= [];
  destructionGroups["cap"].push(node_pad_chevron_0_3);

  const attachment_pad_chevron_1_4 = null;
  const endpoint_pad_chevron_1_4 = makeAttachmentEndpoint(attachment_pad_chevron_1_4);
  const node_pad_chevron_1_4 = new THREE.Group();
  node_pad_chevron_1_4.name = "Launch chevron 1__pivot";
  if (endpoint_pad_chevron_1_4) {
    node_pad_chevron_1_4.position.copy(endpoint_pad_chevron_1_4.start);
    node_pad_chevron_1_4.rotation.set(0, 0, 0);
    node_pad_chevron_1_4.scale.set(1, 1, 1);
  } else {
    node_pad_chevron_1_4.position.set(0.462, 0.0656, 0.0);
    node_pad_chevron_1_4.rotation.set(0.0, 1.570796, 0.0);
    node_pad_chevron_1_4.scale.set(1.0, 1.0, 1.0);
  }
  node_pad_chevron_1_4.userData.sculptComponent = {"id": "pad-chevron-1", "name": "Launch chevron 1", "level": "meso", "role": "affordance", "importance": 0.35, "confidence": 0.3, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A flat inlay with a hard edge, deliberately unlike every other part of this prop: it is signage, not moulding.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 248, 232, 1.0)", "secondaryAlbedo": "rgba(229, 223, 208, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "chevron outline extruded as a shallow relief on the cap's top face", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.0076, "segments": 1}, "deformationStack": [], "uvStrategy": "ExtrudeGeometry cap UVs", "normalStrategy": "flat facet normals", "profile2D": {"points": [[0.0, 0.0595], [0.0805, 0.0], [0.0805, -0.0369], [0.0, 0.0226], [-0.0805, -0.0369], [-0.0805, 0.0]], "depth": 0.0255, "axis": "y", "axisOffset": 0.0}}, "parent": "pad-cap", "attachment": null, "dimensions": {"width": 0.161, "height": 0.0255, "depth": 0.0964, "units": "world", "confidence": 0.3}, "transform": {"position": [0.462, 0.0656, 0.0], "rotation": [0.0, 1.570796, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.3}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "chevron-cream", "materialLayers": ["chevron-cream"], "deformations": [], "joints": [], "seams": [{"id": "chevron-1-cap-seam", "with": "pad-cap", "overlap": 0.0195, "notes": "The inlay is buried all but its visible relief; the cap top drops by that same amount so the prop still tops out at 0.45."}], "localFeatures": [{"id": "chevron-relief", "description": "Standing 0.006 proud of the cap face at radius 0.462, pointing outward at 90 degrees. NOT OBSERVED IN THE REFERENCE.", "geometry": "extruded outline placed on the cap's top face", "evidenceRefs": ["not-in-reference"], "confidence": 0.3}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.08, "bumpAmplitude": 0.0, "normalPattern": "matte moulded ABS matched to the cap", "displacementPattern": "none", "occlusionPattern": "chamfer occlusion around the inlay", "edgeWearPattern": "none", "notes": "Not observed in the reference; finish matched to the cap it sits on."}, "evidenceRefs": ["not-in-reference"], "details": [], "fidelityTier": "form-refinement"};
  node_pad_chevron_1_4.userData.actionProfile = node_pad_chevron_1_4.userData.sculptComponent.actionProfile;
  (nodes["pad-cap"] ?? root).add(node_pad_chevron_1_4);
  nodes["pad-chevron-1"] = node_pad_chevron_1_4;
  const mesh_pad_chevron_1_4Geometry = endpoint_pad_chevron_1_4
    ? new THREE.CylinderGeometry(endpoint_pad_chevron_1_4.endRadius, endpoint_pad_chevron_1_4.baseRadius, endpoint_pad_chevron_1_4.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0.0, 0.0595], [0.0805, 0.0], [0.0805, -0.0369], [0.0, 0.0226], [-0.0805, -0.0369], [-0.0805, 0.0]], "depth": 0.0255, "axis": "y", "axisOffset": 0.0});
  const mesh_pad_chevron_1_4 = new THREE.Mesh(
    mesh_pad_chevron_1_4Geometry,
    materialMap["chevron-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pad_chevron_1_4.name = "Launch chevron 1";
  if (endpoint_pad_chevron_1_4) {
    mesh_pad_chevron_1_4.position.copy(endpoint_pad_chevron_1_4.midpoint);
    mesh_pad_chevron_1_4.quaternion.copy(endpoint_pad_chevron_1_4.quaternion);
  }
  mesh_pad_chevron_1_4.castShadow = options.castShadow ?? true;
  mesh_pad_chevron_1_4.receiveShadow = options.receiveShadow ?? true;
  mesh_pad_chevron_1_4.userData.sculptComponent = node_pad_chevron_1_4.userData.sculptComponent;
  node_pad_chevron_1_4.add(mesh_pad_chevron_1_4);
  meshes["pad-chevron-1"] = mesh_pad_chevron_1_4;
  colliders["pad-chevron-1"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["cap"] ??= [];
  destructionGroups["cap"].push(node_pad_chevron_1_4);

  const attachment_pad_chevron_2_5 = null;
  const endpoint_pad_chevron_2_5 = makeAttachmentEndpoint(attachment_pad_chevron_2_5);
  const node_pad_chevron_2_5 = new THREE.Group();
  node_pad_chevron_2_5.name = "Launch chevron 2__pivot";
  if (endpoint_pad_chevron_2_5) {
    node_pad_chevron_2_5.position.copy(endpoint_pad_chevron_2_5.start);
    node_pad_chevron_2_5.rotation.set(0, 0, 0);
    node_pad_chevron_2_5.scale.set(1, 1, 1);
  } else {
    node_pad_chevron_2_5.position.set(0.0, 0.0656, -0.462);
    node_pad_chevron_2_5.rotation.set(0.0, 3.141593, 0.0);
    node_pad_chevron_2_5.scale.set(1.0, 1.0, 1.0);
  }
  node_pad_chevron_2_5.userData.sculptComponent = {"id": "pad-chevron-2", "name": "Launch chevron 2", "level": "meso", "role": "affordance", "importance": 0.35, "confidence": 0.3, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A flat inlay with a hard edge, deliberately unlike every other part of this prop: it is signage, not moulding.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 248, 232, 1.0)", "secondaryAlbedo": "rgba(229, 223, 208, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "chevron outline extruded as a shallow relief on the cap's top face", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.0076, "segments": 1}, "deformationStack": [], "uvStrategy": "ExtrudeGeometry cap UVs", "normalStrategy": "flat facet normals", "profile2D": {"points": [[0.0, 0.0595], [0.0805, 0.0], [0.0805, -0.0369], [0.0, 0.0226], [-0.0805, -0.0369], [-0.0805, 0.0]], "depth": 0.0255, "axis": "y", "axisOffset": 0.0}}, "parent": "pad-cap", "attachment": null, "dimensions": {"width": 0.161, "height": 0.0255, "depth": 0.0964, "units": "world", "confidence": 0.3}, "transform": {"position": [0.0, 0.0656, -0.462], "rotation": [0.0, 3.141593, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.3}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "chevron-cream", "materialLayers": ["chevron-cream"], "deformations": [], "joints": [], "seams": [{"id": "chevron-2-cap-seam", "with": "pad-cap", "overlap": 0.0195, "notes": "The inlay is buried all but its visible relief; the cap top drops by that same amount so the prop still tops out at 0.45."}], "localFeatures": [{"id": "chevron-relief", "description": "Standing 0.006 proud of the cap face at radius 0.462, pointing outward at 180 degrees. NOT OBSERVED IN THE REFERENCE.", "geometry": "extruded outline placed on the cap's top face", "evidenceRefs": ["not-in-reference"], "confidence": 0.3}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.08, "bumpAmplitude": 0.0, "normalPattern": "matte moulded ABS matched to the cap", "displacementPattern": "none", "occlusionPattern": "chamfer occlusion around the inlay", "edgeWearPattern": "none", "notes": "Not observed in the reference; finish matched to the cap it sits on."}, "evidenceRefs": ["not-in-reference"], "details": [], "fidelityTier": "form-refinement"};
  node_pad_chevron_2_5.userData.actionProfile = node_pad_chevron_2_5.userData.sculptComponent.actionProfile;
  (nodes["pad-cap"] ?? root).add(node_pad_chevron_2_5);
  nodes["pad-chevron-2"] = node_pad_chevron_2_5;
  const mesh_pad_chevron_2_5Geometry = endpoint_pad_chevron_2_5
    ? new THREE.CylinderGeometry(endpoint_pad_chevron_2_5.endRadius, endpoint_pad_chevron_2_5.baseRadius, endpoint_pad_chevron_2_5.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0.0, 0.0595], [0.0805, 0.0], [0.0805, -0.0369], [0.0, 0.0226], [-0.0805, -0.0369], [-0.0805, 0.0]], "depth": 0.0255, "axis": "y", "axisOffset": 0.0});
  const mesh_pad_chevron_2_5 = new THREE.Mesh(
    mesh_pad_chevron_2_5Geometry,
    materialMap["chevron-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pad_chevron_2_5.name = "Launch chevron 2";
  if (endpoint_pad_chevron_2_5) {
    mesh_pad_chevron_2_5.position.copy(endpoint_pad_chevron_2_5.midpoint);
    mesh_pad_chevron_2_5.quaternion.copy(endpoint_pad_chevron_2_5.quaternion);
  }
  mesh_pad_chevron_2_5.castShadow = options.castShadow ?? true;
  mesh_pad_chevron_2_5.receiveShadow = options.receiveShadow ?? true;
  mesh_pad_chevron_2_5.userData.sculptComponent = node_pad_chevron_2_5.userData.sculptComponent;
  node_pad_chevron_2_5.add(mesh_pad_chevron_2_5);
  meshes["pad-chevron-2"] = mesh_pad_chevron_2_5;
  colliders["pad-chevron-2"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["cap"] ??= [];
  destructionGroups["cap"].push(node_pad_chevron_2_5);

  const attachment_pad_chevron_3_6 = null;
  const endpoint_pad_chevron_3_6 = makeAttachmentEndpoint(attachment_pad_chevron_3_6);
  const node_pad_chevron_3_6 = new THREE.Group();
  node_pad_chevron_3_6.name = "Launch chevron 3__pivot";
  if (endpoint_pad_chevron_3_6) {
    node_pad_chevron_3_6.position.copy(endpoint_pad_chevron_3_6.start);
    node_pad_chevron_3_6.rotation.set(0, 0, 0);
    node_pad_chevron_3_6.scale.set(1, 1, 1);
  } else {
    node_pad_chevron_3_6.position.set(-0.462, 0.0656, -0.0);
    node_pad_chevron_3_6.rotation.set(0.0, 4.712389, 0.0);
    node_pad_chevron_3_6.scale.set(1.0, 1.0, 1.0);
  }
  node_pad_chevron_3_6.userData.sculptComponent = {"id": "pad-chevron-3", "name": "Launch chevron 3", "level": "meso", "role": "affordance", "importance": 0.35, "confidence": 0.3, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A flat inlay with a hard edge, deliberately unlike every other part of this prop: it is signage, not moulding.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 248, 232, 1.0)", "secondaryAlbedo": "rgba(229, 223, 208, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "chevron outline extruded as a shallow relief on the cap's top face", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.0076, "segments": 1}, "deformationStack": [], "uvStrategy": "ExtrudeGeometry cap UVs", "normalStrategy": "flat facet normals", "profile2D": {"points": [[0.0, 0.0595], [0.0805, 0.0], [0.0805, -0.0369], [0.0, 0.0226], [-0.0805, -0.0369], [-0.0805, 0.0]], "depth": 0.0255, "axis": "y", "axisOffset": 0.0}}, "parent": "pad-cap", "attachment": null, "dimensions": {"width": 0.161, "height": 0.0255, "depth": 0.0964, "units": "world", "confidence": 0.3}, "transform": {"position": [-0.462, 0.0656, -0.0], "rotation": [0.0, 4.712389, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.3}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "chevron-cream", "materialLayers": ["chevron-cream"], "deformations": [], "joints": [], "seams": [{"id": "chevron-3-cap-seam", "with": "pad-cap", "overlap": 0.0195, "notes": "The inlay is buried all but its visible relief; the cap top drops by that same amount so the prop still tops out at 0.45."}], "localFeatures": [{"id": "chevron-relief", "description": "Standing 0.006 proud of the cap face at radius 0.462, pointing outward at 270 degrees. NOT OBSERVED IN THE REFERENCE.", "geometry": "extruded outline placed on the cap's top face", "evidenceRefs": ["not-in-reference"], "confidence": 0.3}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.08, "bumpAmplitude": 0.0, "normalPattern": "matte moulded ABS matched to the cap", "displacementPattern": "none", "occlusionPattern": "chamfer occlusion around the inlay", "edgeWearPattern": "none", "notes": "Not observed in the reference; finish matched to the cap it sits on."}, "evidenceRefs": ["not-in-reference"], "details": [], "fidelityTier": "form-refinement"};
  node_pad_chevron_3_6.userData.actionProfile = node_pad_chevron_3_6.userData.sculptComponent.actionProfile;
  (nodes["pad-cap"] ?? root).add(node_pad_chevron_3_6);
  nodes["pad-chevron-3"] = node_pad_chevron_3_6;
  const mesh_pad_chevron_3_6Geometry = endpoint_pad_chevron_3_6
    ? new THREE.CylinderGeometry(endpoint_pad_chevron_3_6.endRadius, endpoint_pad_chevron_3_6.baseRadius, endpoint_pad_chevron_3_6.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0.0, 0.0595], [0.0805, 0.0], [0.0805, -0.0369], [0.0, 0.0226], [-0.0805, -0.0369], [-0.0805, 0.0]], "depth": 0.0255, "axis": "y", "axisOffset": 0.0});
  const mesh_pad_chevron_3_6 = new THREE.Mesh(
    mesh_pad_chevron_3_6Geometry,
    materialMap["chevron-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pad_chevron_3_6.name = "Launch chevron 3";
  if (endpoint_pad_chevron_3_6) {
    mesh_pad_chevron_3_6.position.copy(endpoint_pad_chevron_3_6.midpoint);
    mesh_pad_chevron_3_6.quaternion.copy(endpoint_pad_chevron_3_6.quaternion);
  }
  mesh_pad_chevron_3_6.castShadow = options.castShadow ?? true;
  mesh_pad_chevron_3_6.receiveShadow = options.receiveShadow ?? true;
  mesh_pad_chevron_3_6.userData.sculptComponent = node_pad_chevron_3_6.userData.sculptComponent;
  node_pad_chevron_3_6.add(mesh_pad_chevron_3_6);
  meshes["pad-chevron-3"] = mesh_pad_chevron_3_6;
  colliders["pad-chevron-3"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["cap"] ??= [];
  destructionGroups["cap"].push(node_pad_chevron_3_6);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 256, "preferredTextureResolution": 1024, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "ranAnyway": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars."}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness, height, normal or AO", "single-frequency random noise", "glossy toy-plastic highlights on a matte moulded surface", "local colour described only in prose without material masks", "claiming exact PBR recovery from one image"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare the albedo palette and the local colour zones.", "Compare roughness and normal response under the key light.", "Compare contact darkening, seam occlusion and crown polish.", "Compare key, fill and rim structure, exposure, tone mapping and background.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals and uniform roughness.", "Capture a reference-matched render from the solved camera."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createApartmentSpringJumpPadLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Apartment Spring Jump Pad look-dev lights";
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
  lights.userData.lightingFromPhoto = ["Ambient dominance: a soft studio render. The coil's crown reads (245,195,33) against (176,116,10) on its underside, a range a bright neutral hemisphere plus a gentle key reproduces without a hard terminator.", "Key light: warm-neutral directional at about 1.15 from high and camera left, which is where the cap's brightest band and the base's rim highlight both sit.", "Rim and environment light: weak neutral back light at about 0.3 so the far side of the base does not crush to black. No environment map: the reference shows no reflection.", "Exposure and tone mapping: ACES filmic tone mapping with sRGB output at exposure 1.0.", "Contact shadow: the reference floats with a soft contact shadow below the base. The review render has no ground plane so the silhouette mask stays clean."];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 256, "preferredTextureResolution": 1024, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "ranAnyway": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars."}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness, height, normal or AO", "single-frequency random noise", "glossy toy-plastic highlights on a matte moulded surface", "local colour described only in prose without material masks", "claiming exact PBR recovery from one image"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare the albedo palette and the local colour zones.", "Compare roughness and normal response under the key light.", "Compare contact darkening, seam occlusion and crown polish.", "Compare key, fill and rim structure, exposure, tone mapping and background.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals and uniform roughness.", "Capture a reference-matched render from the solved camera."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createApartmentSpringJumpPadEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
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
export function frameApartmentSpringJumpPadCamera(
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
export function createApartmentSpringJumpPadPresentationComposer(
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

export function configureApartmentSpringJumpPadRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createApartmentSpringJumpPadInspectControls(
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
