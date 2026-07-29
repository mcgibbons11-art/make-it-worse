// --- img2threejs refine-code edits applied by assets/reference/props/refine_props.py
// 1. buildLatheGeometry honours latheProfile.phiStart / phiLength (applied).
// 2. buildExtrudeGeometry honours profile2D.steps / profileStops / profileExempt /
//    axis / axisOffset / smoothShading (applied).
// 3. SculptMaterialSpec gets a real type; non-null assertions where the generator
//    indexes arrays, both for the project's strict tsconfig and eslint settings.
// 4. primitive tessellation reduced for a prop that is instanced across a level.
// 5. duplicated userData payloads become references (same API, smaller file).
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

// Generated from ObjectSculptSpec target: Apartment Refrigerator
// Sculpt build pass: structural-pass
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createApartmentRefrigeratorModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Apartment Refrigerator";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": true, "solveMethod": "azimuth and elevation separated by the product and ratio of the plinth's two top-edge screen slopes (0.12 on the door face, 0.667 on the left face), which give sin(e)^2 = 0.080 and tan(a)^2 = 0.180 without needing any length; the door seam independently confirms the door-face slope", "fovDegrees": 12.0, "aspect": 0.75, "orientation": {"yaw": 23.0, "pitch": -16.4, "roll": 0.0}, "targetHint": [0.0, 0.92, 0.0], "note": "Both angles come from edge slopes rather than from a length fit, so they do not move when the envelope is fitted to the collider. Distance is not fixed here: the preview harness solves it by fitting the render's projected bounding box to the reference bounding box (x 246-838, y 121-1302 of 1086x1448)."}, "approximationNotes": []};

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["shell-mint"] = createSculptMaterial(
    "shell-mint",
    {"id": "shell-mint", "name": "Cabinet mint", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#57dfa1", "color": "#57dfa1", "albedo": {"dominant": "#57dfa1", "secondary": ["#3fae7b", "#8ff0c0"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#57dfa1", "#3fae7b", "#8ff0c0"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.8, "variation": 0.08, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; crowns and handled edges trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.34, "contactShadowBias": 0.3, "notes": "Darken every part seam, recess and contact ring."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "crown-highlight", "target": "shell/crown-roll", "notes": "The crown roll carries the brightest mint in the frame, measured at (193,224,195) against (155,193,161) on the flat door face.", "evidenceRefs": ["full-object", "crown-zone"], "roughness": 0.7, "mask": "the top roll, above the door panels"}, {"id": "side-face-shade", "target": "shell/side-panel", "notes": "The left face reads (120,155,127) against the door face's (155,193,161): one pigment, two orientations, no second albedo.", "evidenceRefs": ["full-object", "side-zone"], "roughness": 0.84, "mask": "the shaded side face away from the key"}, {"id": "seam-occlusion", "target": "freezer-door/door-under-edge", "notes": "The seam between the doors is the darkest mint in the frame at (9,26,14), which is contact occlusion in a 18 px groove, not a painted line.", "evidenceRefs": ["full-object", "seam-zone"], "roughness": 0.86, "aoBoost": 0.75, "mask": "the groove walls between the two door bands"}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fridge\\crops\\shell-mint-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.842, "estimatedFidelity": 0.842, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fridge\\pbr\\shell-mint_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fridge\\pbr\\shell-mint_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fridge\\pbr\\shell-mint_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fridge\\pbr\\shell-mint_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fridge\\pbr\\shell-mint_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "One moulded cabinet colour across shell and both doors. The reference shows no second mint anywhere; every apparent tone is orientation."},
    options
  );
  materialMap["plinth-navy"] = createSculptMaterial(
    "plinth-navy",
    {"id": "plinth-navy", "name": "Plinth navy", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#24324a", "color": "#24324a", "albedo": {"dominant": "#24324a", "secondary": ["#1a2536", "#33455f"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#24324a", "#1a2536", "#33455f"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.82, "variation": 0.06, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; crowns and handled edges trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.3, "notes": "Darken every part seam, recess and contact ring."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "plinth-front-lift", "target": "plinth/front-face", "notes": "The plinth's front face reads (59,68,86) against (55,61,73) on its left face, the same key/shade split the cabinet shows.", "evidenceRefs": ["full-object", "plinth-zone"], "roughness": 0.78, "mask": "the plinth's door-side face"}, {"id": "floor-contact", "target": "plinth/base-tuck", "notes": "The plinth's lowest band loses the key entirely where it tucks under.", "evidenceRefs": ["full-object", "plinth-zone"], "roughness": 0.86, "aoBoost": 0.55, "mask": "the bottom 20 percent of the plinth"}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fridge\\crops\\plinth-navy-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.815, "estimatedFidelity": 0.815, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fridge\\pbr\\plinth-navy_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fridge\\pbr\\plinth-navy_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fridge\\pbr\\plinth-navy_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fridge\\pbr\\plinth-navy_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fridge\\pbr\\plinth-navy_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "Darker moulded base. Inset from the cabinet on every side, which is what puts the cabinet's bottom edge in shadow above it."},
    options
  );
  materialMap["trim-cream"] = createSculptMaterial(
    "trim-cream",
    {"id": "trim-cream", "name": "Handle cream", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#fff8e8", "color": "#fff8e8", "albedo": {"dominant": "#fff8e8", "secondary": ["#efe4cf", "#fffdf6"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#fff8e8", "#efe4cf", "#fffdf6"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.62, "variation": 0.09, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; crowns and handled edges trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.24, "contactShadowBias": 0.3, "notes": "Darken every part seam, recess and contact ring."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "bar-crown-sheen", "target": "handle-upper/bar-crown", "notes": "The handle crowns are the brightest values on the door face at (240,222,189); a handled part is polished smoother than the panel behind it.", "evidenceRefs": ["full-object", "handle-zone"], "roughness": 0.52, "mask": "the outward-facing third of each bar"}, {"id": "bar-root-shadow", "target": "handle-lower/bar-root", "notes": "Each bar sits in its own contact shadow against the door.", "evidenceRefs": ["full-object", "handle-zone"], "roughness": 0.68, "aoBoost": 0.5, "mask": "where the bar meets the door face"}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fridge\\crops\\trim-cream-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.788, "estimatedFidelity": 0.788, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fridge\\pbr\\trim-cream_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fridge\\pbr\\trim-cream_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fridge\\pbr\\trim-cream_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fridge\\pbr\\trim-cream_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fridge\\pbr\\trim-cream_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "Warm cream handles. Smoother than the cabinet: these are the parts a hand touches."},
    options
  );
  materialMap["badge-coral"] = createSculptMaterial(
    "badge-coral",
    {"id": "badge-coral", "name": "Badge coral", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#ff5c65", "color": "#ff5c65", "albedo": {"dominant": "#ff5c65", "secondary": ["#e04a53", "#ff8a90"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#ff5c65", "#e04a53", "#ff8a90"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.66, "variation": 0.07, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; crowns and handled edges trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.22, "contactShadowBias": 0.3, "notes": "Darken every part seam, recess and contact ring."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "badge-dome-sheen", "target": "badge/dome-crown", "notes": "The badge reads (245,141,122) at its crown and falls off toward its rim, which is a domed disc rather than a printed circle.", "evidenceRefs": ["full-object", "badge-zone"], "roughness": 0.56, "mask": "the crown of the disc"}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fridge\\crops\\badge-coral-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.762, "estimatedFidelity": 0.762, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fridge\\pbr\\badge-coral_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fridge\\pbr\\badge-coral_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fridge\\pbr\\badge-coral_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fridge\\pbr\\badge-coral_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fridge\\pbr\\badge-coral_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "The single accent on the appliance. One disc, domed, on the freezer door."},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const attachment_shell_0 = null;
  const endpoint_shell_0 = makeAttachmentEndpoint(attachment_shell_0);
  const node_shell_0 = new THREE.Group();
  node_shell_0.name = "Cabinet shell__pivot";
  if (endpoint_shell_0) {
    node_shell_0.position.copy(endpoint_shell_0.start);
    node_shell_0.rotation.set(0, 0, 0);
    node_shell_0.scale.set(1, 1, 1);
  } else {
    node_shell_0.position.set(0.0, 0.0, 0.0);
    node_shell_0.rotation.set(0.0, 0.0, 0.0);
    node_shell_0.scale.set(1.0, 1.0, 1.0);
  }
  node_shell_0.userData.sculptComponent = {"id": "shell", "name": "Cabinet shell", "level": "macro", "role": "shell", "importance": 1.0, "confidence": 0.8, "primitive": "extrude", "topologyClass": "continuous-sculpt", "topologyRationale": "One moulded cabinet with no crease: the reference's vertical corners and its crown roll into each other continuously, and no edge scan finds a hard line anywhere on the body. A box with bevels would show four corner facets the reference does not have.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(87, 223, 161, 1.0)", "secondaryAlbedo": "rgba(78, 200, 144, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "rounded-rectangle plan swept vertically from the plinth top to the crown, with the plan easing inward over the top of the sweep so the cabinet rolls over instead of meeting the top face at an edge", "edgeTreatment": {"type": "rolled", "bevelRadius": 0.0, "segments": 1}, "deformationStack": ["crown roll inward over the top 0.16 units"], "uvStrategy": "ExtrudeGeometry cap and wall UVs; one tile per part", "normalStrategy": "welded vertices then smooth vertex normals; the reference has no crease", "profile2D": {"points": [[0.67, 0.23], [0.66455, 0.27141], [0.64856, 0.31], [0.62314, 0.34314], [0.59, 0.36856], [0.55141, 0.38455], [0.51, 0.39], [-0.51, 0.39], [-0.55141, 0.38455], [-0.59, 0.36856], [-0.62314, 0.34314], [-0.64856, 0.31], [-0.66455, 0.27141], [-0.67, 0.23], [-0.67, -0.23], [-0.66455, -0.27141], [-0.64856, -0.31], [-0.62314, -0.34314], [-0.59, -0.36856], [-0.55141, -0.38455], [-0.51, -0.39], [0.51, -0.39], [0.55141, -0.38455], [0.59, -0.36856], [0.62314, -0.34314], [0.64856, -0.31], [0.66455, -0.27141], [0.67, -0.23]], "depth": 1.7552, "axis": "y", "axisOffset": 0.0848, "steps": 72, "profileStops": [[0.0, 0.985, 0.978], [0.012, 1.0, 1.0], [0.922, 0.994, 0.9897], [0.935, 0.9764, 0.9594], [0.948, 0.9479, 0.9105], [0.961, 0.9101, 0.8455], [0.974, 0.8648, 0.7677], [0.987, 0.8143, 0.681], [1.0, 0.7612, 0.5897]], "smoothShading": true}}, "parent": null, "attachment": null, "dimensions": {"width": 1.34, "height": 1.7552, "depth": 0.78, "units": "world", "confidence": 0.6}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0.0, 0.92, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "floor-contact", "localPosition": [0.0, 0.0, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Underside of the plinth; the trap mounts the prop here."}, {"id": "door-face", "localPosition": [0.0, 0.92, 0.41], "localRotation": [0.0, 0.0, 0.0], "notes": "Centre of the door face, which is the direction the trap charges."}], "collider": {"type": "box", "offset": [0.0, 0.92, 0.0], "scale": [1.34, 1.84, 0.96], "isTrigger": false, "notes": "Box proxy matching the trap's CuboidCollider args [0.68, 0.92, 0.48] exactly, which is what the envelope is for."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cabinet", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "shell-mint", "materialLayers": ["shell-mint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "crown-roll", "description": "The plan eases inward over the top 0.16 units on a quarter cosine, so the cabinet's top is a continuous roll. Column 600 shows the flat front face ending at y=231 with no step, which is a roll rather than a chamfer.", "geometry": "profileStops easing the plan inward over the last sixth of the vertical sweep", "evidenceRefs": ["full-object", "crown-zone"], "confidence": 0.6}, {"id": "side-panel", "description": "The shaded left face is the same pigment as the door face at a different orientation: (120,155,127) against (155,193,161), a pure value shift with no hue change.", "geometry": "plan face, not separate geometry", "evidenceRefs": ["full-object", "side-zone"], "confidence": 0.85}, {"id": "corner-round", "description": "The four vertical corners carry a 0.16 radius. This is the one plan number the view cannot measure, because the rounding is exactly what stops the silhouette reaching the box corners that would let it be measured.", "geometry": "rounded-rectangle plan sampled at 24 points", "evidenceRefs": ["full-object"], "confidence": 0.5}], "surfaceDetail": {"macroRoughness": 0.8, "microRoughness": 0.08, "bumpAmplitude": 0.0, "normalPattern": "matte moulded ABS with slight tone drift", "displacementPattern": "none", "occlusionPattern": "occlusion in the door groove and under the cabinet's bottom edge", "edgeWearPattern": "none - the reference appliance shows no wear", "notes": "Matte plastic throughout. No specular coat anywhere in the reference."}, "evidenceRefs": ["full-object", "crown-zone", "side-zone"], "details": [], "fidelityTier": "blockout"};
  node_shell_0.userData.actionProfile = node_shell_0.userData.sculptComponent.actionProfile;
  (nodes["root"] ?? root).add(node_shell_0);
  nodes["shell"] = node_shell_0;
  const mesh_shell_0Geometry = endpoint_shell_0
    ? new THREE.CylinderGeometry(endpoint_shell_0.endRadius, endpoint_shell_0.baseRadius, endpoint_shell_0.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0.67, 0.23], [0.66455, 0.27141], [0.64856, 0.31], [0.62314, 0.34314], [0.59, 0.36856], [0.55141, 0.38455], [0.51, 0.39], [-0.51, 0.39], [-0.55141, 0.38455], [-0.59, 0.36856], [-0.62314, 0.34314], [-0.64856, 0.31], [-0.66455, 0.27141], [-0.67, 0.23], [-0.67, -0.23], [-0.66455, -0.27141], [-0.64856, -0.31], [-0.62314, -0.34314], [-0.59, -0.36856], [-0.55141, -0.38455], [-0.51, -0.39], [0.51, -0.39], [0.55141, -0.38455], [0.59, -0.36856], [0.62314, -0.34314], [0.64856, -0.31], [0.66455, -0.27141], [0.67, -0.23]], "depth": 1.7552, "axis": "y", "axisOffset": 0.0848, "steps": 72, "profileStops": [[0.0, 0.985, 0.978], [0.012, 1.0, 1.0], [0.922, 0.994, 0.9897], [0.935, 0.9764, 0.9594], [0.948, 0.9479, 0.9105], [0.961, 0.9101, 0.8455], [0.974, 0.8648, 0.7677], [0.987, 0.8143, 0.681], [1.0, 0.7612, 0.5897]], "smoothShading": true});
  const mesh_shell_0 = new THREE.Mesh(
    mesh_shell_0Geometry,
    materialMap["shell-mint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shell_0.name = "Cabinet shell";
  if (endpoint_shell_0) {
    mesh_shell_0.position.copy(endpoint_shell_0.midpoint);
    mesh_shell_0.quaternion.copy(endpoint_shell_0.quaternion);
  }
  mesh_shell_0.castShadow = options.castShadow ?? true;
  mesh_shell_0.receiveShadow = options.receiveShadow ?? true;
  mesh_shell_0.userData.sculptComponent = node_shell_0.userData.sculptComponent;
  node_shell_0.add(mesh_shell_0);
  meshes["shell"] = mesh_shell_0;
  colliders["shell"] = {"type": "box", "offset": [0.0, 0.92, 0.0], "scale": [1.34, 1.84, 0.96], "isTrigger": false, "notes": "Box proxy matching the trap's CuboidCollider args [0.68, 0.92, 0.48] exactly, which is what the envelope is for."};
  destructionGroups["cabinet"] ??= [];
  destructionGroups["cabinet"].push(node_shell_0);
  const socket_shell_floor_contact_0 = new THREE.Object3D();
  socket_shell_floor_contact_0.name = "floor-contact";
  socket_shell_floor_contact_0.position.set(0.0, 0.0, 0.0);
  socket_shell_floor_contact_0.rotation.set(0.0, 0.0, 0.0);
  socket_shell_floor_contact_0.userData.socket = {"id": "floor-contact", "localPosition": [0.0, 0.0, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Underside of the plinth; the trap mounts the prop here."};
  node_shell_0.add(socket_shell_floor_contact_0);
  sockets["shell:floor-contact"] = socket_shell_floor_contact_0;
  const socket_shell_door_face_1 = new THREE.Object3D();
  socket_shell_door_face_1.name = "door-face";
  socket_shell_door_face_1.position.set(0.0, 0.92, 0.41);
  socket_shell_door_face_1.rotation.set(0.0, 0.0, 0.0);
  socket_shell_door_face_1.userData.socket = {"id": "door-face", "localPosition": [0.0, 0.92, 0.41], "localRotation": [0.0, 0.0, 0.0], "notes": "Centre of the door face, which is the direction the trap charges."};
  node_shell_0.add(socket_shell_door_face_1);
  sockets["shell:door-face"] = socket_shell_door_face_1;

  const attachment_plinth_1 = null;
  const endpoint_plinth_1 = makeAttachmentEndpoint(attachment_plinth_1);
  const node_plinth_1 = new THREE.Group();
  node_plinth_1.name = "Base plinth__pivot";
  if (endpoint_plinth_1) {
    node_plinth_1.position.copy(endpoint_plinth_1.start);
    node_plinth_1.rotation.set(0, 0, 0);
    node_plinth_1.scale.set(1, 1, 1);
  } else {
    node_plinth_1.position.set(0.0, 0.0, 0.0);
    node_plinth_1.rotation.set(0.0, 0.0, 0.0);
    node_plinth_1.scale.set(1.0, 1.0, 1.0);
  }
  node_plinth_1.userData.sculptComponent = {"id": "plinth", "name": "Base plinth", "level": "macro", "role": "base", "importance": 0.8, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A flat rigid base slab with rolled top and bottom edges. It has one visible planar side face, which is what makes it a slab rather than part of the cabinet's continuous shell.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 50, 74, 1.0)", "secondaryAlbedo": "rgba(32, 45, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "rounded-rectangle plan inset from the cabinet, swept vertically and eased inward at both ends of the sweep", "edgeTreatment": {"type": "rolled", "bevelRadius": 0.0, "segments": 1}, "deformationStack": ["top roll inward", "base tuck inward"], "uvStrategy": "ExtrudeGeometry cap and wall UVs", "normalStrategy": "welded then smooth vertex normals", "profile2D": {"points": [[0.6, 0.228], [0.59618, 0.25699], [0.58499, 0.284], [0.5672, 0.3072], [0.544, 0.32499], [0.51699, 0.33618], [0.488, 0.34], [-0.488, 0.34], [-0.51699, 0.33618], [-0.544, 0.32499], [-0.5672, 0.3072], [-0.58499, 0.284], [-0.59618, 0.25699], [-0.6, 0.228], [-0.6, -0.228], [-0.59618, -0.25699], [-0.58499, -0.284], [-0.5672, -0.3072], [-0.544, -0.32499], [-0.51699, -0.33618], [-0.488, -0.34], [0.488, -0.34], [0.51699, -0.33618], [0.544, -0.32499], [0.5672, -0.3072], [0.58499, -0.284], [0.59618, -0.25699], [0.6, -0.228]], "depth": 0.1148, "axis": "y", "axisOffset": 0.0, "steps": 16, "profileStops": [[0.0, 0.93, 0.9], [0.1, 0.985, 0.978], [0.22, 1.0, 1.0], [0.86, 1.0, 1.0], [0.94, 0.985, 0.978], [1.0, 0.95, 0.93]], "smoothShading": true}}, "parent": "shell", "attachment": null, "dimensions": {"width": 1.2, "height": 0.0848, "depth": 0.68, "units": "world", "confidence": 0.7}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0424, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0424, 0.0], "scale": [1.2000000000000002, 0.0848, 0.6799999999999999], "isTrigger": false, "notes": "Box proxy over the plinth."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cabinet", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "plinth-navy", "materialLayers": ["plinth-navy"], "deformations": [], "joints": [], "seams": [{"id": "plinth-shell-seam", "with": "shell", "overlap": 0.03, "notes": "The cabinet's sweep starts at the plinth top, so the two overlap by the plinth's top roll rather than meeting on a plane."}], "localFeatures": [{"id": "front-face", "description": "The plinth's own key/shade split runs the same way as the cabinet's: (59,68,86) on the door side against (55,61,73) on the left.", "geometry": "plan face, not separate geometry", "evidenceRefs": ["full-object", "plinth-zone"], "confidence": 0.8}, {"id": "base-tuck", "description": "The plan eases inward at the bottom of the sweep, which is why the reference's lowest silhouette curves in rather than meeting the ground square.", "geometry": "profileStops mirrored at the start of the extrusion", "evidenceRefs": ["full-object", "plinth-zone"], "confidence": 0.7}, {"id": "cabinet-inset", "description": "The plinth is inset 0.07 units on every side. Measured as 11 px on the shaded left face and 22 px on the door face, which are 0.078 and 0.066 world units; one value covers both.", "geometry": "smaller plan than the cabinet's", "evidenceRefs": ["full-object", "plinth-zone"], "confidence": 0.8}], "surfaceDetail": {"macroRoughness": 0.82, "microRoughness": 0.06, "bumpAmplitude": 0.0, "normalPattern": "matte moulded ABS", "displacementPattern": "none", "occlusionPattern": "deep occlusion under the cabinet overhang", "edgeWearPattern": "none", "notes": "The darkest part of the appliance and the only one touching the floor."}, "evidenceRefs": ["full-object", "plinth-zone"], "details": [], "fidelityTier": "blockout"};
  node_plinth_1.userData.actionProfile = node_plinth_1.userData.sculptComponent.actionProfile;
  (nodes["shell"] ?? root).add(node_plinth_1);
  nodes["plinth"] = node_plinth_1;
  const mesh_plinth_1Geometry = endpoint_plinth_1
    ? new THREE.CylinderGeometry(endpoint_plinth_1.endRadius, endpoint_plinth_1.baseRadius, endpoint_plinth_1.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0.6, 0.228], [0.59618, 0.25699], [0.58499, 0.284], [0.5672, 0.3072], [0.544, 0.32499], [0.51699, 0.33618], [0.488, 0.34], [-0.488, 0.34], [-0.51699, 0.33618], [-0.544, 0.32499], [-0.5672, 0.3072], [-0.58499, 0.284], [-0.59618, 0.25699], [-0.6, 0.228], [-0.6, -0.228], [-0.59618, -0.25699], [-0.58499, -0.284], [-0.5672, -0.3072], [-0.544, -0.32499], [-0.51699, -0.33618], [-0.488, -0.34], [0.488, -0.34], [0.51699, -0.33618], [0.544, -0.32499], [0.5672, -0.3072], [0.58499, -0.284], [0.59618, -0.25699], [0.6, -0.228]], "depth": 0.1148, "axis": "y", "axisOffset": 0.0, "steps": 16, "profileStops": [[0.0, 0.93, 0.9], [0.1, 0.985, 0.978], [0.22, 1.0, 1.0], [0.86, 1.0, 1.0], [0.94, 0.985, 0.978], [1.0, 0.95, 0.93]], "smoothShading": true});
  const mesh_plinth_1 = new THREE.Mesh(
    mesh_plinth_1Geometry,
    materialMap["plinth-navy"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_plinth_1.name = "Base plinth";
  if (endpoint_plinth_1) {
    mesh_plinth_1.position.copy(endpoint_plinth_1.midpoint);
    mesh_plinth_1.quaternion.copy(endpoint_plinth_1.quaternion);
  }
  mesh_plinth_1.castShadow = options.castShadow ?? true;
  mesh_plinth_1.receiveShadow = options.receiveShadow ?? true;
  mesh_plinth_1.userData.sculptComponent = node_plinth_1.userData.sculptComponent;
  node_plinth_1.add(mesh_plinth_1);
  meshes["plinth"] = mesh_plinth_1;
  colliders["plinth"] = {"type": "box", "offset": [0.0, 0.0424, 0.0], "scale": [1.2000000000000002, 0.0848, 0.6799999999999999], "isTrigger": false, "notes": "Box proxy over the plinth."};
  destructionGroups["cabinet"] ??= [];
  destructionGroups["cabinet"].push(node_plinth_1);

  const attachment_freezer_door_2 = null;
  const endpoint_freezer_door_2 = makeAttachmentEndpoint(attachment_freezer_door_2);
  const node_freezer_door_2 = new THREE.Group();
  node_freezer_door_2.name = "Freezer door__pivot";
  if (endpoint_freezer_door_2) {
    node_freezer_door_2.position.copy(endpoint_freezer_door_2.start);
    node_freezer_door_2.rotation.set(0, 0, 0);
    node_freezer_door_2.scale.set(1, 1, 1);
  } else {
    node_freezer_door_2.position.set(0.0, 0.0, 0.0);
    node_freezer_door_2.rotation.set(0.0, 0.0, 0.0);
    node_freezer_door_2.scale.set(1.0, 1.0, 1.0);
  }
  node_freezer_door_2.userData.sculptComponent = {"id": "freezer-door", "name": "Freezer door", "level": "meso", "role": "door", "importance": 0.9, "confidence": 0.75, "primitive": "extrude", "topologyClass": "continuous-sculpt", "topologyRationale": "A moulded door skin that rolls over at both of its horizontal edges. The reference's seam is a groove with two lit lips, not a scored line, so each door has real thickness and its own rolled edge rather than being a decal on the cabinet.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(87, 223, 161, 1.0)", "secondaryAlbedo": "rgba(78, 200, 144, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "rounded-rectangle plan matching the cabinet's, swept vertically over the door's height and eased inward at both ends so each door edge rolls", "edgeTreatment": {"type": "rolled", "bevelRadius": 0.0, "segments": 1}, "deformationStack": ["top edge roll", "bottom edge roll"], "uvStrategy": "ExtrudeGeometry cap and wall UVs", "normalStrategy": "welded then smooth vertex normals", "profile2D": {"points": [[0.67, 0.25], [0.66455, 0.29141], [0.64856, 0.33], [0.62314, 0.36314], [0.59, 0.38856], [0.55141, 0.40455], [0.51, 0.41], [-0.51, 0.41], [-0.55141, 0.40455], [-0.59, 0.38856], [-0.62314, 0.36314], [-0.64856, 0.33], [-0.66455, 0.29141], [-0.67, 0.25], [-0.67, -0.25], [-0.66455, -0.29141], [-0.64856, -0.33], [-0.62314, -0.36314], [-0.59, -0.38856], [-0.55141, -0.40455], [-0.51, -0.41], [0.51, -0.41], [0.55141, -0.40455], [0.59, -0.38856], [0.62314, -0.36314], [0.64856, -0.33], [0.66455, -0.29141], [0.67, -0.25]], "depth": 0.5728, "axis": "y", "axisOffset": 1.1072, "steps": 10, "profileStops": [[0.0, 0.965, 0.95], [0.06, 1.0, 1.0], [0.94, 1.0, 1.0], [1.0, 0.965, 0.95]], "smoothShading": true}}, "parent": "shell", "attachment": null, "dimensions": {"width": 1.34, "height": 0.5728, "depth": 0.82, "units": "world", "confidence": 0.75}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "panel", "pivot": {"mode": "socket", "localPosition": [0.67, 1.3936, 0.41], "axis": [0.0, 1.0, 0.0], "confidence": 0.55}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "freezer-door-hinge", "localPosition": [0.67, 1.3936, 0.41], "localRotation": [0.0, 0.0, 0.0], "notes": "Hinge axis on the handle-opposite side. The reference puts both handles on the left of the door face, so the hinges are on the right; the hinges themselves are never visible."}], "collider": {"type": "box", "offset": [0.0, 1.3936, 0.0], "scale": [1.34, 0.5728, 0.82], "isTrigger": false, "notes": "Box proxy over the door band."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cabinet", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "shell-mint", "materialLayers": ["shell-mint"], "deformations": [], "joints": [], "seams": [{"id": "freezer-door-shell-seam", "with": "shell", "overlap": 0.02, "notes": "The door band overlaps the cabinet by its own proud depth on every side, so no gap can open behind it."}], "localFeatures": [{"id": "door-proud", "description": "The door stands 0.02 units proud of the cabinet's door face and is flush with its sides, which is what makes the seam a groove with two lit lips rather than a painted line.", "geometry": "larger plan than the shell's over the door's height range", "evidenceRefs": ["full-object", "freezer-zone"], "confidence": 0.7}, {"id": "door-under-edge", "description": "Both horizontal edges roll inward, so the 0.0288-unit groove between the doors is bounded by two curved lips. Column 600 reads the groove floor at (9,26,14) and the lip immediately below it at (183,216,186).", "geometry": "profileStops eased inward at both ends of the sweep", "evidenceRefs": ["full-object", "seam-zone"], "confidence": 0.8}, {"id": "door-span", "description": "The freezer door runs from the seam up to y=1.68, where column 600 finds the front face's top edge at y=231. Above that the cabinet rolls over onto the top face.", "geometry": "plan width equal to the cabinet's", "evidenceRefs": ["full-object", "freezer-zone"], "confidence": 0.8}], "surfaceDetail": {"macroRoughness": 0.8, "microRoughness": 0.08, "bumpAmplitude": 0.0, "normalPattern": "matte moulded ABS", "displacementPattern": "none", "occlusionPattern": "occlusion into the groove", "edgeWearPattern": "none", "notes": "Same pigment and finish as the cabinet it sits on."}, "evidenceRefs": ["full-object", "freezer-zone", "seam-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_freezer_door_2.userData.actionProfile = node_freezer_door_2.userData.sculptComponent.actionProfile;
  (nodes["shell"] ?? root).add(node_freezer_door_2);
  nodes["freezer-door"] = node_freezer_door_2;
  const mesh_freezer_door_2Geometry = endpoint_freezer_door_2
    ? new THREE.CylinderGeometry(endpoint_freezer_door_2.endRadius, endpoint_freezer_door_2.baseRadius, endpoint_freezer_door_2.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0.67, 0.25], [0.66455, 0.29141], [0.64856, 0.33], [0.62314, 0.36314], [0.59, 0.38856], [0.55141, 0.40455], [0.51, 0.41], [-0.51, 0.41], [-0.55141, 0.40455], [-0.59, 0.38856], [-0.62314, 0.36314], [-0.64856, 0.33], [-0.66455, 0.29141], [-0.67, 0.25], [-0.67, -0.25], [-0.66455, -0.29141], [-0.64856, -0.33], [-0.62314, -0.36314], [-0.59, -0.38856], [-0.55141, -0.40455], [-0.51, -0.41], [0.51, -0.41], [0.55141, -0.40455], [0.59, -0.38856], [0.62314, -0.36314], [0.64856, -0.33], [0.66455, -0.29141], [0.67, -0.25]], "depth": 0.5728, "axis": "y", "axisOffset": 1.1072, "steps": 10, "profileStops": [[0.0, 0.965, 0.95], [0.06, 1.0, 1.0], [0.94, 1.0, 1.0], [1.0, 0.965, 0.95]], "smoothShading": true});
  const mesh_freezer_door_2 = new THREE.Mesh(
    mesh_freezer_door_2Geometry,
    materialMap["shell-mint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_freezer_door_2.name = "Freezer door";
  if (endpoint_freezer_door_2) {
    mesh_freezer_door_2.position.copy(endpoint_freezer_door_2.midpoint);
    mesh_freezer_door_2.quaternion.copy(endpoint_freezer_door_2.quaternion);
  }
  mesh_freezer_door_2.castShadow = options.castShadow ?? true;
  mesh_freezer_door_2.receiveShadow = options.receiveShadow ?? true;
  mesh_freezer_door_2.userData.sculptComponent = node_freezer_door_2.userData.sculptComponent;
  node_freezer_door_2.add(mesh_freezer_door_2);
  meshes["freezer-door"] = mesh_freezer_door_2;
  colliders["freezer-door"] = {"type": "box", "offset": [0.0, 1.3936, 0.0], "scale": [1.34, 0.5728, 0.82], "isTrigger": false, "notes": "Box proxy over the door band."};
  destructionGroups["cabinet"] ??= [];
  destructionGroups["cabinet"].push(node_freezer_door_2);
  const socket_freezer_door_freezer_door_hinge_0 = new THREE.Object3D();
  socket_freezer_door_freezer_door_hinge_0.name = "freezer-door-hinge";
  socket_freezer_door_freezer_door_hinge_0.position.set(0.67, 1.3936, 0.41);
  socket_freezer_door_freezer_door_hinge_0.rotation.set(0.0, 0.0, 0.0);
  socket_freezer_door_freezer_door_hinge_0.userData.socket = {"id": "freezer-door-hinge", "localPosition": [0.67, 1.3936, 0.41], "localRotation": [0.0, 0.0, 0.0], "notes": "Hinge axis on the handle-opposite side. The reference puts both handles on the left of the door face, so the hinges are on the right; the hinges themselves are never visible."};
  node_freezer_door_2.add(socket_freezer_door_freezer_door_hinge_0);
  sockets["freezer-door:freezer-door-hinge"] = socket_freezer_door_freezer_door_hinge_0;

  const attachment_fridge_door_3 = null;
  const endpoint_fridge_door_3 = makeAttachmentEndpoint(attachment_fridge_door_3);
  const node_fridge_door_3 = new THREE.Group();
  node_fridge_door_3.name = "Fridge door__pivot";
  if (endpoint_fridge_door_3) {
    node_fridge_door_3.position.copy(endpoint_fridge_door_3.start);
    node_fridge_door_3.rotation.set(0, 0, 0);
    node_fridge_door_3.scale.set(1, 1, 1);
  } else {
    node_fridge_door_3.position.set(0.0, 0.0, 0.0);
    node_fridge_door_3.rotation.set(0.0, 0.0, 0.0);
    node_fridge_door_3.scale.set(1.0, 1.0, 1.0);
  }
  node_fridge_door_3.userData.sculptComponent = {"id": "fridge-door", "name": "Fridge door", "level": "meso", "role": "door", "importance": 0.9, "confidence": 0.75, "primitive": "extrude", "topologyClass": "continuous-sculpt", "topologyRationale": "A moulded door skin that rolls over at both of its horizontal edges. The reference's seam is a groove with two lit lips, not a scored line, so each door has real thickness and its own rolled edge rather than being a decal on the cabinet.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(87, 223, 161, 1.0)", "secondaryAlbedo": "rgba(78, 200, 144, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "rounded-rectangle plan matching the cabinet's, swept vertically over the door's height and eased inward at both ends so each door edge rolls", "edgeTreatment": {"type": "rolled", "bevelRadius": 0.0, "segments": 1}, "deformationStack": ["top edge roll", "bottom edge roll"], "uvStrategy": "ExtrudeGeometry cap and wall UVs", "normalStrategy": "welded then smooth vertex normals", "profile2D": {"points": [[0.67, 0.25], [0.66455, 0.29141], [0.64856, 0.33], [0.62314, 0.36314], [0.59, 0.38856], [0.55141, 0.40455], [0.51, 0.41], [-0.51, 0.41], [-0.55141, 0.40455], [-0.59, 0.38856], [-0.62314, 0.36314], [-0.64856, 0.33], [-0.66455, 0.29141], [-0.67, 0.25], [-0.67, -0.25], [-0.66455, -0.29141], [-0.64856, -0.33], [-0.62314, -0.36314], [-0.59, -0.38856], [-0.55141, -0.40455], [-0.51, -0.41], [0.51, -0.41], [0.55141, -0.40455], [0.59, -0.38856], [0.62314, -0.36314], [0.64856, -0.33], [0.66455, -0.29141], [0.67, -0.25]], "depth": 0.9936, "axis": "y", "axisOffset": 0.0848, "steps": 10, "profileStops": [[0.0, 0.965, 0.95], [0.06, 1.0, 1.0], [0.94, 1.0, 1.0], [1.0, 0.965, 0.95]], "smoothShading": true}}, "parent": "shell", "attachment": null, "dimensions": {"width": 1.34, "height": 0.9936, "depth": 0.82, "units": "world", "confidence": 0.75}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "panel", "pivot": {"mode": "socket", "localPosition": [0.67, 0.5816, 0.41], "axis": [0.0, 1.0, 0.0], "confidence": 0.55}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "fridge-door-hinge", "localPosition": [0.67, 0.5816, 0.41], "localRotation": [0.0, 0.0, 0.0], "notes": "Hinge axis on the handle-opposite side. The reference puts both handles on the left of the door face, so the hinges are on the right; the hinges themselves are never visible."}], "collider": {"type": "box", "offset": [0.0, 0.5816, 0.0], "scale": [1.34, 0.9936, 0.82], "isTrigger": false, "notes": "Box proxy over the door band."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cabinet", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "shell-mint", "materialLayers": ["shell-mint"], "deformations": [], "joints": [], "seams": [{"id": "fridge-door-shell-seam", "with": "shell", "overlap": 0.02, "notes": "The door band overlaps the cabinet by its own proud depth on every side, so no gap can open behind it."}], "localFeatures": [{"id": "door-proud", "description": "The door stands 0.02 units proud of the cabinet's door face and is flush with its sides, which is what makes the seam a groove with two lit lips rather than a painted line.", "geometry": "larger plan than the shell's over the door's height range", "evidenceRefs": ["full-object", "fridge-zone"], "confidence": 0.7}, {"id": "door-under-edge", "description": "Both horizontal edges roll inward, so the 0.0288-unit groove between the doors is bounded by two curved lips. Column 600 reads the groove floor at (9,26,14) and the lip immediately below it at (183,216,186).", "geometry": "profileStops eased inward at both ends of the sweep", "evidenceRefs": ["full-object", "seam-zone"], "confidence": 0.8}, {"id": "door-span", "description": "The fridge door runs from the plinth top up to the seam at y=1.0928, which column 600 reads as a dark band at y 593..611.", "geometry": "plan width equal to the cabinet's", "evidenceRefs": ["full-object", "fridge-zone"], "confidence": 0.8}], "surfaceDetail": {"macroRoughness": 0.8, "microRoughness": 0.08, "bumpAmplitude": 0.0, "normalPattern": "matte moulded ABS", "displacementPattern": "none", "occlusionPattern": "occlusion into the groove", "edgeWearPattern": "none", "notes": "Same pigment and finish as the cabinet it sits on."}, "evidenceRefs": ["full-object", "fridge-zone", "seam-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_fridge_door_3.userData.actionProfile = node_fridge_door_3.userData.sculptComponent.actionProfile;
  (nodes["shell"] ?? root).add(node_fridge_door_3);
  nodes["fridge-door"] = node_fridge_door_3;
  const mesh_fridge_door_3Geometry = endpoint_fridge_door_3
    ? new THREE.CylinderGeometry(endpoint_fridge_door_3.endRadius, endpoint_fridge_door_3.baseRadius, endpoint_fridge_door_3.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0.67, 0.25], [0.66455, 0.29141], [0.64856, 0.33], [0.62314, 0.36314], [0.59, 0.38856], [0.55141, 0.40455], [0.51, 0.41], [-0.51, 0.41], [-0.55141, 0.40455], [-0.59, 0.38856], [-0.62314, 0.36314], [-0.64856, 0.33], [-0.66455, 0.29141], [-0.67, 0.25], [-0.67, -0.25], [-0.66455, -0.29141], [-0.64856, -0.33], [-0.62314, -0.36314], [-0.59, -0.38856], [-0.55141, -0.40455], [-0.51, -0.41], [0.51, -0.41], [0.55141, -0.40455], [0.59, -0.38856], [0.62314, -0.36314], [0.64856, -0.33], [0.66455, -0.29141], [0.67, -0.25]], "depth": 0.9936, "axis": "y", "axisOffset": 0.0848, "steps": 10, "profileStops": [[0.0, 0.965, 0.95], [0.06, 1.0, 1.0], [0.94, 1.0, 1.0], [1.0, 0.965, 0.95]], "smoothShading": true});
  const mesh_fridge_door_3 = new THREE.Mesh(
    mesh_fridge_door_3Geometry,
    materialMap["shell-mint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fridge_door_3.name = "Fridge door";
  if (endpoint_fridge_door_3) {
    mesh_fridge_door_3.position.copy(endpoint_fridge_door_3.midpoint);
    mesh_fridge_door_3.quaternion.copy(endpoint_fridge_door_3.quaternion);
  }
  mesh_fridge_door_3.castShadow = options.castShadow ?? true;
  mesh_fridge_door_3.receiveShadow = options.receiveShadow ?? true;
  mesh_fridge_door_3.userData.sculptComponent = node_fridge_door_3.userData.sculptComponent;
  node_fridge_door_3.add(mesh_fridge_door_3);
  meshes["fridge-door"] = mesh_fridge_door_3;
  colliders["fridge-door"] = {"type": "box", "offset": [0.0, 0.5816, 0.0], "scale": [1.34, 0.9936, 0.82], "isTrigger": false, "notes": "Box proxy over the door band."};
  destructionGroups["cabinet"] ??= [];
  destructionGroups["cabinet"].push(node_fridge_door_3);
  const socket_fridge_door_fridge_door_hinge_0 = new THREE.Object3D();
  socket_fridge_door_fridge_door_hinge_0.name = "fridge-door-hinge";
  socket_fridge_door_fridge_door_hinge_0.position.set(0.67, 0.5816, 0.41);
  socket_fridge_door_fridge_door_hinge_0.rotation.set(0.0, 0.0, 0.0);
  socket_fridge_door_fridge_door_hinge_0.userData.socket = {"id": "fridge-door-hinge", "localPosition": [0.67, 0.5816, 0.41], "localRotation": [0.0, 0.0, 0.0], "notes": "Hinge axis on the handle-opposite side. The reference puts both handles on the left of the door face, so the hinges are on the right; the hinges themselves are never visible."};
  node_fridge_door_3.add(socket_fridge_door_fridge_door_hinge_0);
  sockets["fridge-door:fridge-door-hinge"] = socket_fridge_door_fridge_door_hinge_0;

  const attachment_handle_upper_4 = null;
  const endpoint_handle_upper_4 = makeAttachmentEndpoint(attachment_handle_upper_4);
  const node_handle_upper_4 = new THREE.Group();
  node_handle_upper_4.name = "Freezer door pull__pivot";
  if (endpoint_handle_upper_4) {
    node_handle_upper_4.position.copy(endpoint_handle_upper_4.start);
    node_handle_upper_4.rotation.set(0, 0, 0);
    node_handle_upper_4.scale.set(1, 1, 1);
  } else {
    node_handle_upper_4.position.set(-0.4547, 0.0, 0.43);
    node_handle_upper_4.rotation.set(0.0, 0.0, 0.0);
    node_handle_upper_4.scale.set(1.0, 1.0, 1.0);
  }
  node_handle_upper_4.userData.sculptComponent = {"id": "handle-upper", "name": "Freezer door pull", "level": "meso", "role": "trim", "importance": 0.85, "confidence": 0.8, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "A round-sectioned bar domed at both ends. The reference shows no flat cap and no crease on either handle, which is a capsule rather than a cylinder with end discs.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 248, 232, 1.0)", "secondaryAlbedo": "rgba(229, 223, 208, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "round bar revolved about its own vertical axis and domed at both ends, standing off the door face", "edgeTreatment": {"type": "rolled", "bevelRadius": 0.0466, "segments": 32}, "deformationStack": [], "uvStrategy": "lathe UVs", "normalStrategy": "vertex normals from the revolved profile", "latheProfile": {"points": [[0.0001, 1.1264], [0.01206, 1.12799], [0.0233, 1.13264], [0.03295, 1.14005], [0.04036, 1.1497], [0.04501, 1.16094], [0.0466, 1.173], [0.0466, 1.3854], [0.04501, 1.39746], [0.04036, 1.4087], [0.03295, 1.41835], [0.0233, 1.42576], [0.01206, 1.43041], [0.0, 1.432]], "segments": 20}}, "parent": "freezer-door", "attachment": null, "dimensions": {"width": 0.0932, "height": 0.3056, "depth": 0.0932, "units": "world", "confidence": 0.8}, "transform": {"position": [-0.4547, 0.0, 0.43], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "grip", "pivot": {"mode": "center", "localPosition": [0.0, 1.2792, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "handle-upper-grip", "localPosition": [0.0, 1.2792, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Grip point; a hand or a magnet effect anchors here."}], "collider": {"type": "capsule", "offset": [0.0, 1.2792, 0.0], "scale": [0.0932, 0.3056, 0.0932], "isTrigger": false, "notes": "Capsule proxy over the bar."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "trim", "seamRefs": [], "detachableFragments": ["handle-upper"], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "trim-cream", "materialLayers": ["trim-cream"], "deformations": [], "joints": [], "seams": [{"id": "handle-upper-door-seam", "with": "freezer-door", "overlap": 0.021, "notes": "The bar's inboard flank is buried in the door skin."}], "localFeatures": [{"id": "bar-crown", "description": "The bar is 0.0932 across, measured as a 31 px run at rows 400, 480 and 700, and its crown is the brightest value on the door face.", "geometry": "capsule radius from the measured run", "evidenceRefs": ["full-object", "handle-zone"], "confidence": 0.85}, {"id": "bar-root", "description": "The bar stands 0.02 units off the door face, so its lower flank keeps a contact shadow instead of merging into the door.", "geometry": "component position, not geometry", "evidenceRefs": ["full-object", "handle-zone"], "confidence": 0.6}, {"id": "bar-length", "description": "The bar is 0.3056 units long, from a 191 px run down the door face. It covers under a fifth of the door, which is what makes this a short pull rather than the full-height bar the hand-authored fridge carried.", "geometry": "capsule length from the measured run", "evidenceRefs": ["full-object", "handle-zone"], "confidence": 0.85}], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.09, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded ABS", "displacementPattern": "none", "occlusionPattern": "contact shadow at the door face", "edgeWearPattern": "none", "notes": "Smoother than the cabinet: this is the part a hand touches."}, "evidenceRefs": ["full-object", "handle-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_handle_upper_4.userData.actionProfile = node_handle_upper_4.userData.sculptComponent.actionProfile;
  (nodes["freezer-door"] ?? root).add(node_handle_upper_4);
  nodes["handle-upper"] = node_handle_upper_4;
  const mesh_handle_upper_4Geometry = endpoint_handle_upper_4
    ? new THREE.CylinderGeometry(endpoint_handle_upper_4.endRadius, endpoint_handle_upper_4.baseRadius, endpoint_handle_upper_4.length, 32, 12)
    : buildLatheGeometry({"points": [[0.0001, 1.1264], [0.01206, 1.12799], [0.0233, 1.13264], [0.03295, 1.14005], [0.04036, 1.1497], [0.04501, 1.16094], [0.0466, 1.173], [0.0466, 1.3854], [0.04501, 1.39746], [0.04036, 1.4087], [0.03295, 1.41835], [0.0233, 1.42576], [0.01206, 1.43041], [0.0, 1.432]], "segments": 20});
  const mesh_handle_upper_4 = new THREE.Mesh(
    mesh_handle_upper_4Geometry,
    materialMap["trim-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_handle_upper_4.name = "Freezer door pull";
  if (endpoint_handle_upper_4) {
    mesh_handle_upper_4.position.copy(endpoint_handle_upper_4.midpoint);
    mesh_handle_upper_4.quaternion.copy(endpoint_handle_upper_4.quaternion);
  }
  mesh_handle_upper_4.castShadow = options.castShadow ?? true;
  mesh_handle_upper_4.receiveShadow = options.receiveShadow ?? true;
  mesh_handle_upper_4.userData.sculptComponent = node_handle_upper_4.userData.sculptComponent;
  node_handle_upper_4.add(mesh_handle_upper_4);
  meshes["handle-upper"] = mesh_handle_upper_4;
  colliders["handle-upper"] = {"type": "capsule", "offset": [0.0, 1.2792, 0.0], "scale": [0.0932, 0.3056, 0.0932], "isTrigger": false, "notes": "Capsule proxy over the bar."};
  destructionGroups["trim"] ??= [];
  destructionGroups["trim"].push(node_handle_upper_4);
  const socket_handle_upper_handle_upper_grip_0 = new THREE.Object3D();
  socket_handle_upper_handle_upper_grip_0.name = "handle-upper-grip";
  socket_handle_upper_handle_upper_grip_0.position.set(0.0, 1.2792, 0.0);
  socket_handle_upper_handle_upper_grip_0.rotation.set(0.0, 0.0, 0.0);
  socket_handle_upper_handle_upper_grip_0.userData.socket = {"id": "handle-upper-grip", "localPosition": [0.0, 1.2792, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Grip point; a hand or a magnet effect anchors here."};
  node_handle_upper_4.add(socket_handle_upper_handle_upper_grip_0);
  sockets["handle-upper:handle-upper-grip"] = socket_handle_upper_handle_upper_grip_0;

  const attachment_handle_lower_5 = null;
  const endpoint_handle_lower_5 = makeAttachmentEndpoint(attachment_handle_lower_5);
  const node_handle_lower_5 = new THREE.Group();
  node_handle_lower_5.name = "Fridge door pull__pivot";
  if (endpoint_handle_lower_5) {
    node_handle_lower_5.position.copy(endpoint_handle_lower_5.start);
    node_handle_lower_5.rotation.set(0, 0, 0);
    node_handle_lower_5.scale.set(1, 1, 1);
  } else {
    node_handle_lower_5.position.set(-0.4547, 0.0, 0.43);
    node_handle_lower_5.rotation.set(0.0, 0.0, 0.0);
    node_handle_lower_5.scale.set(1.0, 1.0, 1.0);
  }
  node_handle_lower_5.userData.sculptComponent = {"id": "handle-lower", "name": "Fridge door pull", "level": "meso", "role": "trim", "importance": 0.85, "confidence": 0.8, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "A round-sectioned bar domed at both ends. The reference shows no flat cap and no crease on either handle, which is a capsule rather than a cylinder with end discs.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 248, 232, 1.0)", "secondaryAlbedo": "rgba(229, 223, 208, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "round bar revolved about its own vertical axis and domed at both ends, standing off the door face", "edgeTreatment": {"type": "rolled", "bevelRadius": 0.0466, "segments": 32}, "deformationStack": [], "uvStrategy": "lathe UVs", "normalStrategy": "vertex normals from the revolved profile", "latheProfile": {"points": [[0.0001, 0.6752], [0.01206, 0.67679], [0.0233, 0.68144], [0.03295, 0.68885], [0.04036, 0.6985], [0.04501, 0.70974], [0.0466, 0.7218], [0.0466, 0.9438], [0.04501, 0.95586], [0.04036, 0.9671], [0.03295, 0.97675], [0.0233, 0.98416], [0.01206, 0.98881], [0.0, 0.9904]], "segments": 20}}, "parent": "fridge-door", "attachment": null, "dimensions": {"width": 0.0932, "height": 0.3152, "depth": 0.0932, "units": "world", "confidence": 0.8}, "transform": {"position": [-0.4547, 0.0, 0.43], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "grip", "pivot": {"mode": "center", "localPosition": [0.0, 0.8328, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "handle-lower-grip", "localPosition": [0.0, 0.8328, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Grip point; a hand or a magnet effect anchors here."}], "collider": {"type": "capsule", "offset": [0.0, 0.8328, 0.0], "scale": [0.0932, 0.3152, 0.0932], "isTrigger": false, "notes": "Capsule proxy over the bar."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "trim", "seamRefs": [], "detachableFragments": ["handle-lower"], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "trim-cream", "materialLayers": ["trim-cream"], "deformations": [], "joints": [], "seams": [{"id": "handle-lower-door-seam", "with": "fridge-door", "overlap": 0.021, "notes": "The bar's inboard flank is buried in the door skin."}], "localFeatures": [{"id": "bar-crown", "description": "The bar is 0.0932 across, measured as a 31 px run at rows 400, 480 and 700, and its crown is the brightest value on the door face.", "geometry": "capsule radius from the measured run", "evidenceRefs": ["full-object", "handle-zone"], "confidence": 0.85}, {"id": "bar-root", "description": "The bar stands 0.02 units off the door face, so its lower flank keeps a contact shadow instead of merging into the door.", "geometry": "component position, not geometry", "evidenceRefs": ["full-object", "handle-zone"], "confidence": 0.6}, {"id": "bar-length", "description": "The bar is 0.3152 units long, from a 197 px run down the door face. It covers under a fifth of the door, which is what makes this a short pull rather than the full-height bar the hand-authored fridge carried.", "geometry": "capsule length from the measured run", "evidenceRefs": ["full-object", "handle-zone"], "confidence": 0.85}], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.09, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded ABS", "displacementPattern": "none", "occlusionPattern": "contact shadow at the door face", "edgeWearPattern": "none", "notes": "Smoother than the cabinet: this is the part a hand touches."}, "evidenceRefs": ["full-object", "handle-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_handle_lower_5.userData.actionProfile = node_handle_lower_5.userData.sculptComponent.actionProfile;
  (nodes["fridge-door"] ?? root).add(node_handle_lower_5);
  nodes["handle-lower"] = node_handle_lower_5;
  const mesh_handle_lower_5Geometry = endpoint_handle_lower_5
    ? new THREE.CylinderGeometry(endpoint_handle_lower_5.endRadius, endpoint_handle_lower_5.baseRadius, endpoint_handle_lower_5.length, 32, 12)
    : buildLatheGeometry({"points": [[0.0001, 0.6752], [0.01206, 0.67679], [0.0233, 0.68144], [0.03295, 0.68885], [0.04036, 0.6985], [0.04501, 0.70974], [0.0466, 0.7218], [0.0466, 0.9438], [0.04501, 0.95586], [0.04036, 0.9671], [0.03295, 0.97675], [0.0233, 0.98416], [0.01206, 0.98881], [0.0, 0.9904]], "segments": 20});
  const mesh_handle_lower_5 = new THREE.Mesh(
    mesh_handle_lower_5Geometry,
    materialMap["trim-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_handle_lower_5.name = "Fridge door pull";
  if (endpoint_handle_lower_5) {
    mesh_handle_lower_5.position.copy(endpoint_handle_lower_5.midpoint);
    mesh_handle_lower_5.quaternion.copy(endpoint_handle_lower_5.quaternion);
  }
  mesh_handle_lower_5.castShadow = options.castShadow ?? true;
  mesh_handle_lower_5.receiveShadow = options.receiveShadow ?? true;
  mesh_handle_lower_5.userData.sculptComponent = node_handle_lower_5.userData.sculptComponent;
  node_handle_lower_5.add(mesh_handle_lower_5);
  meshes["handle-lower"] = mesh_handle_lower_5;
  colliders["handle-lower"] = {"type": "capsule", "offset": [0.0, 0.8328, 0.0], "scale": [0.0932, 0.3152, 0.0932], "isTrigger": false, "notes": "Capsule proxy over the bar."};
  destructionGroups["trim"] ??= [];
  destructionGroups["trim"].push(node_handle_lower_5);
  const socket_handle_lower_handle_lower_grip_0 = new THREE.Object3D();
  socket_handle_lower_handle_lower_grip_0.name = "handle-lower-grip";
  socket_handle_lower_handle_lower_grip_0.position.set(0.0, 0.8328, 0.0);
  socket_handle_lower_handle_lower_grip_0.rotation.set(0.0, 0.0, 0.0);
  socket_handle_lower_handle_lower_grip_0.userData.socket = {"id": "handle-lower-grip", "localPosition": [0.0, 0.8328, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Grip point; a hand or a magnet effect anchors here."};
  node_handle_lower_5.add(socket_handle_lower_handle_lower_grip_0);
  sockets["handle-lower:handle-lower-grip"] = socket_handle_lower_handle_lower_grip_0;

  const attachment_badge_6 = null;
  const endpoint_badge_6 = makeAttachmentEndpoint(attachment_badge_6);
  const node_badge_6 = new THREE.Group();
  node_badge_6.name = "Coral badge__pivot";
  if (endpoint_badge_6) {
    node_badge_6.position.copy(endpoint_badge_6.start);
    node_badge_6.rotation.set(0, 0, 0);
    node_badge_6.scale.set(1, 1, 1);
  } else {
    node_badge_6.position.set(0.3854, 1.48, 0.418);
    node_badge_6.rotation.set(1.570796, 0.0, 0.0);
    node_badge_6.scale.set(1.0, 1.0, 1.0);
  }
  node_badge_6.userData.sculptComponent = {"id": "badge", "name": "Coral badge", "level": "micro", "role": "trim", "importance": 0.6, "confidence": 0.75, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "A domed disc. The reference badge falls off in value from its centre to its rim, which is a dome catching the key at varying angles, not a flat circle of paint.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 92, 101, 1.0)", "secondaryAlbedo": "rgba(229, 82, 90, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "disc revolved about its own axis with a domed face, laid against the freezer door", "edgeTreatment": {"type": "rolled", "bevelRadius": 0.0, "segments": 32}, "deformationStack": [], "uvStrategy": "lathe UVs", "normalStrategy": "vertex normals from the revolved profile", "latheProfile": {"points": [[0.0001, 0.0], [0.049536, 0.0], [0.0576, 0.006], [0.0576, 0.018], [0.054144, 0.026], [0.040319999999999995, 0.031], [0.021888, 0.033], [0.0001, 0.0335]], "segments": 32}}, "parent": "freezer-door", "attachment": null, "dimensions": {"width": 0.1152, "height": 0.032, "depth": 0.1152, "units": "world", "confidence": 0.8}, "transform": {"position": [0.3854, 1.48, 0.418], "rotation": [1.570796, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 0.0, 1.0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "trim", "seamRefs": [], "detachableFragments": ["badge"], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "badge-coral", "materialLayers": ["badge-coral"], "deformations": [], "joints": [], "seams": [{"id": "badge-door-seam", "with": "freezer-door", "overlap": 0.012, "notes": "The disc's back face is buried in the door skin."}], "localFeatures": [{"id": "dome-crown", "description": "The disc is 0.1152 across and stands about 0.02 proud, domed so its crown reads (245,141,122) and its rim falls away.", "geometry": "revolved profile with a rounded crown", "evidenceRefs": ["full-object", "badge-zone"], "confidence": 0.75}, {"id": "badge-placement", "description": "The badge sits at x=0.3854, y=1.48: measured at x 718..769, y 329..383, which is the upper outboard corner of the freezer door, away from the handle.", "geometry": "component position, not geometry", "evidenceRefs": ["full-object", "badge-zone"], "confidence": 0.85}], "surfaceDetail": {"macroRoughness": 0.66, "microRoughness": 0.07, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded ABS", "displacementPattern": "none", "occlusionPattern": "thin contact ring at the door", "edgeWearPattern": "none", "notes": "The only accent colour on the appliance."}, "evidenceRefs": ["full-object", "badge-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_badge_6.userData.actionProfile = node_badge_6.userData.sculptComponent.actionProfile;
  (nodes["freezer-door"] ?? root).add(node_badge_6);
  nodes["badge"] = node_badge_6;
  const mesh_badge_6Geometry = endpoint_badge_6
    ? new THREE.CylinderGeometry(endpoint_badge_6.endRadius, endpoint_badge_6.baseRadius, endpoint_badge_6.length, 32, 12)
    : buildLatheGeometry({"points": [[0.0001, 0.0], [0.049536, 0.0], [0.0576, 0.006], [0.0576, 0.018], [0.054144, 0.026], [0.040319999999999995, 0.031], [0.021888, 0.033], [0.0001, 0.0335]], "segments": 32});
  const mesh_badge_6 = new THREE.Mesh(
    mesh_badge_6Geometry,
    materialMap["badge-coral"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_badge_6.name = "Coral badge";
  if (endpoint_badge_6) {
    mesh_badge_6.position.copy(endpoint_badge_6.midpoint);
    mesh_badge_6.quaternion.copy(endpoint_badge_6.quaternion);
  }
  mesh_badge_6.castShadow = options.castShadow ?? true;
  mesh_badge_6.receiveShadow = options.receiveShadow ?? true;
  mesh_badge_6.userData.sculptComponent = node_badge_6.userData.sculptComponent;
  node_badge_6.add(mesh_badge_6);
  meshes["badge"] = mesh_badge_6;
  colliders["badge"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["trim"] ??= [];
  destructionGroups["trim"].push(node_badge_6);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 256, "preferredTextureResolution": 1024, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "ranAnyway": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars."}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness, height, normal or AO", "single-frequency random noise", "glossy toy-plastic highlights on a matte moulded surface", "local colour described only in prose without material masks", "claiming exact PBR recovery from one image"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare the albedo palette and the local colour zones.", "Compare roughness and normal response under the key light.", "Compare contact darkening, seam occlusion and crown polish.", "Compare key, fill and rim structure, exposure, tone mapping and background.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals and uniform roughness.", "Capture a reference-matched render from the solved camera."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createApartmentRefrigeratorLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Apartment Refrigerator look-dev lights";
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
  lights.userData.lightingFromPhoto = ["Ambient dominance: the reference is a soft studio render. The cabinet's lit door face reads (155,193,161) and its shaded left face (120,155,127), a 22 percent value range a bright neutral hemisphere plus a gentle key reproduces with no hard terminator.", "Key light: a warm-neutral directional source at about 1.2 from high and camera right, which is the side the door face turns toward. It lifts the crown roll to (193,224,195) and both handle crowns to (240,222,189).", "Rim and environment light: weak neutral back light at about 0.3, enough to keep the shaded left face from crushing. No environment map: the reference shows no reflection.", "Exposure and tone mapping: ACES filmic tone mapping with sRGB output at exposure 1.0.", "Contact shadow: the door groove and the cabinet-over-plinth overhang carry the only two real occlusions. The reference floats with no ground contact, so the review render has no ground plane and the silhouette mask stays clean."];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 256, "preferredTextureResolution": 1024, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "ranAnyway": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars."}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness, height, normal or AO", "single-frequency random noise", "glossy toy-plastic highlights on a matte moulded surface", "local colour described only in prose without material masks", "claiming exact PBR recovery from one image"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare the albedo palette and the local colour zones.", "Compare roughness and normal response under the key light.", "Compare contact darkening, seam occlusion and crown polish.", "Compare key, fill and rim structure, exposure, tone mapping and background.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals and uniform roughness.", "Capture a reference-matched render from the solved camera."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createApartmentRefrigeratorEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
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
export function frameApartmentRefrigeratorCamera(
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
export function createApartmentRefrigeratorPresentationComposer(
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

export function configureApartmentRefrigeratorRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createApartmentRefrigeratorInspectControls(
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
