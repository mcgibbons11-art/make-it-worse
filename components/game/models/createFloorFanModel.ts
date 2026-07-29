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
//    per-part world Box3 dump can see them (1 registered).
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

// Generated from ObjectSculptSpec target: Apartment Floor Fan
// Sculpt build pass: structural-pass
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createApartmentFloorFanModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Apartment Floor Fan";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": true, "solveMethod": "Elevation from the BASE, which is a disc in the ground plane, so its top rim's projected minor over major is sin(elevation): 151/576 = 0.2622 closes to 15.20 degrees. Yaw from the GUARD, a disc standing in a vertical plane, whose projected horizontal semi-axis over its vertical one is cos(yaw): 293/401 = 0.7307 closes to 43.1 degrees. Two discs in perpendicular planes give both angles independently, which is why this camera is solved where the toilet's was not.", "fovDegrees": 14.0, "aspect": 0.75, "orientation": {"yaw": 43.1, "pitch": -15.2, "roll": 0.0}, "targetHint": [0.0, 0.8304, 0.0], "note": "The review render passes yscale=1.0 to undo the envelope squash so the Tier-1 aspect gate scores shape rather than the squash."}, "approximationNotes": []};

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["guard-mint"] = createSculptMaterial(
    "guard-mint",
    {"id": "guard-mint", "name": "Guard cage plastic", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#57dfa1", "color": "#57dfa1", "albedo": {"dominant": "#57dfa1", "secondary": ["#3fae7d", "#8ff0c4"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#57dfa1", "#3fae7d", "#8ff0c4"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.56, "variation": 0.07, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; crowns and handled edges trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.34, "contactShadowBias": 0.3, "notes": "Darken every part seam, recess and contact ring."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "cage-rim-sheen", "target": "fan-guard-ring/ring-rim", "notes": "The rim is the one part of the cage thick enough to hold a broad terminator rather than a thin highlight, which is what separates it from the spokes at a glance.", "evidenceRefs": ["full-object", "guard-zone"], "roughness": 0.48, "mask": "the outward half of the rim torus"}, {"id": "cage-shadow-on-blades", "target": "fan-guard-ring/ring-shadow", "notes": "The cage throws hard shadows onto the cream blades behind it, which is most of what makes the blades read as being BEHIND rather than painted on.", "evidenceRefs": ["full-object", "blade-zone"], "aoBoost": 0.5, "mask": "the blade surfaces directly behind each spoke"}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fan\\crops\\guard-mint-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.79, "estimatedFidelity": 0.79, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fan\\pbr\\guard-mint_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fan\\pbr\\guard-mint_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fan\\pbr\\guard-mint_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fan\\pbr\\guard-mint_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fan\\pbr\\guard-mint_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "Matte moulded plastic. The cage measures 1.59:1 against the palest deck wash, so it cannot carry the silhouette on value and relies on the navy base to anchor it."},
    options
  );
  materialMap["blade-cream"] = createSculptMaterial(
    "blade-cream",
    {"id": "blade-cream", "name": "Blade and pole plastic", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#fff8e8", "color": "#fff8e8", "albedo": {"dominant": "#fff8e8", "secondary": ["#e6dcc6", "#fffdf5"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#fff8e8", "#e6dcc6", "#fffdf5"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.6, "variation": 0.08, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; crowns and handled edges trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.3, "notes": "Darken every part seam, recess and contact ring."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "blade-occlusion", "target": "fan-blades/blade-petal", "notes": "The blades sit deep inside the cage and lose the key almost entirely; they are the darkest cream on the prop.", "evidenceRefs": ["full-object", "blade-zone"], "roughness": 0.66, "aoBoost": 0.6, "mask": "the blade faces inside the cage"}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fan\\crops\\blade-cream-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.77, "estimatedFidelity": 0.77, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fan\\pbr\\blade-cream_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fan\\pbr\\blade-cream_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fan\\pbr\\blade-cream_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fan\\pbr\\blade-cream_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fan\\pbr\\blade-cream_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "The same matte plastic as the cage in a different colour. Cream against the cream deck wash is 1.00:1, so the blades contribute no silhouette at all and are carried entirely by the cage's shadows."},
    options
  );
  materialMap["base-navy"] = createSculptMaterial(
    "base-navy",
    {"id": "base-navy", "name": "Weighted base", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#24324a", "color": "#24324a", "albedo": {"dominant": "#24324a", "secondary": ["#18222f", "#3a4d6b"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#24324a", "#18222f", "#3a4d6b"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.52, "variation": 0.06, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; crowns and handled edges trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.3, "contactShadowBias": 0.3, "notes": "Darken every part seam, recess and contact ring."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "base-crown-sheen", "target": "fan-base/base-crown", "notes": "The base's domed top is the only broad specular on the prop and is what reads it as a heavy weighted puck rather than a flat disc.", "evidenceRefs": ["full-object", "base-zone"], "roughness": 0.44, "mask": "the top face inside the rolled rim"}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fan\\crops\\base-navy-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.82, "estimatedFidelity": 0.82, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fan\\pbr\\base-navy_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fan\\pbr\\base-navy_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fan\\pbr\\base-navy_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fan\\pbr\\base-navy_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\fan\\pbr\\base-navy_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "The prop's value anchor at 8.91:1 against the palest deck wash, against the cage's 1.59:1 and the blades' 1.00:1. It is the reason the fan reads at all."},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const attachment_fan_base_0 = null;
  const endpoint_fan_base_0 = makeAttachmentEndpoint(attachment_fan_base_0);
  const node_fan_base_0 = new THREE.Group();
  node_fan_base_0.name = "Weighted base__pivot";
  if (endpoint_fan_base_0) {
    node_fan_base_0.position.copy(endpoint_fan_base_0.start);
    node_fan_base_0.rotation.set(0, 0, 0);
    node_fan_base_0.scale.set(1, 1, 1);
  } else {
    node_fan_base_0.position.set(0.0, 0.0, 0.0);
    node_fan_base_0.rotation.set(0.0, 0.0, 0.0);
    node_fan_base_0.scale.set(1.0, 1.0, 1.0);
  }
  node_fan_base_0.userData.sculptComponent = {"id": "fan-base", "name": "Weighted base", "level": "macro", "role": "shell", "importance": 1.0, "confidence": 0.85, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "One revolved navy puck. The reference shows a single moulded form with a rolled rim and no flat face anywhere, which is a casting rather than an assembly.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 50, 74, 1.0)", "secondaryAlbedo": "rgba(32, 45, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "profile revolved about Y: flat foot, rolled rim, domed top", "edgeTreatment": {"type": "rolled", "bevelRadius": 0.04, "segments": 28}, "deformationStack": ["rim roll", "crown dome"], "uvStrategy": "LatheGeometry cylindrical UVs", "normalStrategy": "smooth vertex normals from the revolved profile", "latheProfile": {"points": [[0.0, 0.0], [0.3157, 0.0], [0.3395, 0.0714], [0.3395, 0.1648], [0.3259, 0.2307], [0.2716, 0.2665], [0.1528, 0.2747], [0.0, 0.2747]], "segments": 28, "phiStart": 0.0, "phiLength": 6.283185}}, "parent": null, "attachment": null, "dimensions": {"width": 0.679, "height": 0.2747, "depth": 0.679, "units": "world", "confidence": 0.85}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "floor", "localPosition": [0.0, 0.0, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Underside of the base; sits on the deck plane at y = 0."}, {"id": "neck", "localPosition": [0.0, 0.2747, -0.05], "localRotation": [0.0, 0.0, 0.0], "notes": "The base's crown, where the pole rises."}, {"id": "cage-centre", "localPosition": [0.0, 0.8304, 0.16], "localRotation": [0.0, 0.0, 0.0], "notes": "The cage's axis. It lives on the BASE rather than on the rim because the rim's node carries a 1.075 scale to solve its torus, and a child would inherit it."}], "collider": {"type": "box", "offset": [0.0, 0.65, 0.0], "scale": [1.2, 1.3, 0.7], "isTrigger": false, "notes": "Matches TrapRenderer's CuboidCollider args=[0.6, 0.65, 0.35] at the [0, -0.65, 0] mount."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "base-navy", "materialLayers": ["base-navy"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "base-crown", "description": "The base is 0.679 across and only 0.2747 tall, a wall-to-diameter ratio of 0.4045 measured off the reference's 233 px wall against its 576 px diameter.", "geometry": "revolved profile with a rolled rim and a domed crown", "evidenceRefs": ["full-object", "base-zone"], "confidence": 0.85}, {"id": "base-anchor", "description": "The base is the prop's only strong value and the reason the fan reads against the deck at all; the cage is 1.59:1 and the blades 1.00:1.", "geometry": "navy albedo over the whole revolve", "evidenceRefs": ["full-object", "base-zone"], "confidence": 0.8}], "surfaceDetail": {"macroRoughness": 0.52, "microRoughness": 0.06, "bumpAmplitude": 0.0, "normalPattern": "matte moulded plastic with one broad crown specular", "displacementPattern": "none", "occlusionPattern": "contact occlusion under the rim", "edgeWearPattern": "none - the reference is a new appliance", "notes": "The heaviest-reading material on the prop."}, "evidenceRefs": ["full-object", "base-zone"], "details": [], "fidelityTier": "blockout"};
  node_fan_base_0.userData.actionProfile = node_fan_base_0.userData.sculptComponent.actionProfile;
  (nodes["root"] ?? root).add(node_fan_base_0);
  nodes["fan-base"] = node_fan_base_0;
  const mesh_fan_base_0Geometry = endpoint_fan_base_0
    ? new THREE.CylinderGeometry(endpoint_fan_base_0.endRadius, endpoint_fan_base_0.baseRadius, endpoint_fan_base_0.length, 32, 12)
    : buildLatheGeometry({"points": [[0.0, 0.0], [0.3157, 0.0], [0.3395, 0.0714], [0.3395, 0.1648], [0.3259, 0.2307], [0.2716, 0.2665], [0.1528, 0.2747], [0.0, 0.2747]], "segments": 28, "phiStart": 0.0, "phiLength": 6.283185});
  const mesh_fan_base_0 = new THREE.Mesh(
    mesh_fan_base_0Geometry,
    materialMap["base-navy"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fan_base_0.name = "Weighted base";
  if (endpoint_fan_base_0) {
    mesh_fan_base_0.position.copy(endpoint_fan_base_0.midpoint);
    mesh_fan_base_0.quaternion.copy(endpoint_fan_base_0.quaternion);
  }
  mesh_fan_base_0.castShadow = options.castShadow ?? true;
  mesh_fan_base_0.receiveShadow = options.receiveShadow ?? true;
  mesh_fan_base_0.userData.sculptComponent = node_fan_base_0.userData.sculptComponent;
  node_fan_base_0.add(mesh_fan_base_0);
  meshes["fan-base"] = mesh_fan_base_0;
  colliders["fan-base"] = {"type": "box", "offset": [0.0, 0.65, 0.0], "scale": [1.2, 1.3, 0.7], "isTrigger": false, "notes": "Matches TrapRenderer's CuboidCollider args=[0.6, 0.65, 0.35] at the [0, -0.65, 0] mount."};
  destructionGroups["body"] ??= [];
  destructionGroups["body"].push(node_fan_base_0);
  const socket_fan_base_floor_0 = new THREE.Object3D();
  socket_fan_base_floor_0.name = "floor";
  socket_fan_base_floor_0.position.set(0.0, 0.0, 0.0);
  socket_fan_base_floor_0.rotation.set(0.0, 0.0, 0.0);
  socket_fan_base_floor_0.userData.socket = {"id": "floor", "localPosition": [0.0, 0.0, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Underside of the base; sits on the deck plane at y = 0."};
  node_fan_base_0.add(socket_fan_base_floor_0);
  sockets["fan-base:floor"] = socket_fan_base_floor_0;
  const socket_fan_base_neck_1 = new THREE.Object3D();
  socket_fan_base_neck_1.name = "neck";
  socket_fan_base_neck_1.position.set(0.0, 0.2747, -0.05);
  socket_fan_base_neck_1.rotation.set(0.0, 0.0, 0.0);
  socket_fan_base_neck_1.userData.socket = {"id": "neck", "localPosition": [0.0, 0.2747, -0.05], "localRotation": [0.0, 0.0, 0.0], "notes": "The base's crown, where the pole rises."};
  node_fan_base_0.add(socket_fan_base_neck_1);
  sockets["fan-base:neck"] = socket_fan_base_neck_1;
  const socket_fan_base_cage_centre_2 = new THREE.Object3D();
  socket_fan_base_cage_centre_2.name = "cage-centre";
  socket_fan_base_cage_centre_2.position.set(0.0, 0.8304, 0.16);
  socket_fan_base_cage_centre_2.rotation.set(0.0, 0.0, 0.0);
  socket_fan_base_cage_centre_2.userData.socket = {"id": "cage-centre", "localPosition": [0.0, 0.8304, 0.16], "localRotation": [0.0, 0.0, 0.0], "notes": "The cage's axis. It lives on the BASE rather than on the rim because the rim's node carries a 1.075 scale to solve its torus, and a child would inherit it."};
  node_fan_base_0.add(socket_fan_base_cage_centre_2);
  sockets["fan-base:cage-centre"] = socket_fan_base_cage_centre_2;

  const attachment_fan_pole_1 = {"parentId": "fan-base", "parentSocket": "neck", "contactType": "socketed", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.3443, 0.0], "contactNormal": [0.0, 1.0, 0.0], "embedDepth": 0.03, "overlap": 0.03, "gapTolerance": 0.0, "baseRadius": 0.1037, "endRadius": 0.1037, "geometryFromSpec": true};
  const endpoint_fan_pole_1 = makeAttachmentEndpoint(attachment_fan_pole_1);
  const node_fan_pole_1 = new THREE.Group();
  node_fan_pole_1.name = "Neck__pivot";
  if (endpoint_fan_pole_1) {
    node_fan_pole_1.position.copy(endpoint_fan_pole_1.start);
    node_fan_pole_1.rotation.set(0, 0, 0);
    node_fan_pole_1.scale.set(1, 1, 1);
  } else {
    node_fan_pole_1.position.set(0.0, 0.4468, -0.05);
    node_fan_pole_1.rotation.set(0.0, 0.0, 0.0);
    node_fan_pole_1.scale.set(0.2075, 0.3443, 0.2075);
  }
  node_fan_pole_1.userData.sculptComponent = {"id": "fan-pole", "name": "Neck", "level": "macro", "role": "column", "importance": 0.6, "confidence": 0.7, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "A plain cream column. The reference shows it as a straight cylinder between the base's crown and the cage, with no taper along its visible length.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 248, 232, 1.0)", "secondaryAlbedo": "rgba(239, 233, 218, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "straight column rising from the base's crown to the cage", "edgeTreatment": {"type": "rolled", "bevelRadius": 0.02, "segments": 20}, "deformationStack": [], "uvStrategy": "cylinder UVs", "normalStrategy": "smooth vertex normals"}, "parent": "fan-base", "attachment": {"parentId": "fan-base", "parentSocket": "neck", "contactType": "socketed", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.3443, 0.0], "contactNormal": [0.0, 1.0, 0.0], "embedDepth": 0.03, "overlap": 0.03, "gapTolerance": 0.0, "baseRadius": 0.1037, "endRadius": 0.1037, "geometryFromSpec": true}, "dimensions": {"width": 0.2075, "height": 0.3443, "depth": 0.2075, "units": "world", "confidence": 0.7}, "transform": {"position": [0.0, 0.4468, -0.05], "rotation": [0.0, 0.0, 0.0], "scale": [0.2075, 0.3443, 0.2075]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "blade-cream", "materialLayers": ["blade-cream"], "deformations": [], "joints": [], "seams": [{"id": "pole-base-seam", "with": "fan-base", "overlap": 0.03, "notes": "The pole's foot is buried in the base's domed crown."}], "localFeatures": [{"id": "pole-shaft", "description": "The neck measures 0.2075 across, taken from the steady 176 px cream run at the reference's rows 0.685 to 0.705, between the cage's lower arc and the base's rim.", "geometry": "cylinder at the measured diameter", "evidenceRefs": ["full-object", "base-zone"], "confidence": 0.7}], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.08, "bumpAmplitude": 0.0, "normalPattern": "matte moulded plastic", "displacementPattern": "none", "occlusionPattern": "occlusion where the cage crosses it", "edgeWearPattern": "none", "notes": "Same plastic as the blades."}, "evidenceRefs": ["full-object", "base-zone"], "details": [], "fidelityTier": "blockout"};
  node_fan_pole_1.userData.actionProfile = node_fan_pole_1.userData.sculptComponent.actionProfile;
  (nodes["fan-base"] ?? root).add(node_fan_pole_1);
  nodes["fan-pole"] = node_fan_pole_1;
  const mesh_fan_pole_1Geometry = endpoint_fan_pole_1
    ? new THREE.CylinderGeometry(endpoint_fan_pole_1.endRadius, endpoint_fan_pole_1.baseRadius, endpoint_fan_pole_1.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 32, 1);
  const mesh_fan_pole_1 = new THREE.Mesh(
    mesh_fan_pole_1Geometry,
    materialMap["blade-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fan_pole_1.name = "Neck";
  if (endpoint_fan_pole_1) {
    mesh_fan_pole_1.position.copy(endpoint_fan_pole_1.midpoint);
    mesh_fan_pole_1.quaternion.copy(endpoint_fan_pole_1.quaternion);
  }
  mesh_fan_pole_1.castShadow = options.castShadow ?? true;
  mesh_fan_pole_1.receiveShadow = options.receiveShadow ?? true;
  mesh_fan_pole_1.userData.sculptComponent = node_fan_pole_1.userData.sculptComponent;
  node_fan_pole_1.add(mesh_fan_pole_1);
  meshes["fan-pole"] = mesh_fan_pole_1;
  colliders["fan-pole"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["body"] ??= [];
  destructionGroups["body"].push(node_fan_pole_1);

  const attachment_fan_collar_2 = null;
  const endpoint_fan_collar_2 = makeAttachmentEndpoint(attachment_fan_collar_2);
  const node_fan_collar_2 = new THREE.Group();
  node_fan_collar_2.name = "Neck collar__pivot";
  if (endpoint_fan_collar_2) {
    node_fan_collar_2.position.copy(endpoint_fan_collar_2.start);
    node_fan_collar_2.rotation.set(0, 0, 0);
    node_fan_collar_2.scale.set(1, 1, 1);
  } else {
    node_fan_collar_2.position.set(0.0, 0.2747, -0.05);
    node_fan_collar_2.rotation.set(0.0, 0.0, 0.0);
    node_fan_collar_2.scale.set(1.0, 1.0, 1.0);
  }
  node_fan_collar_2.userData.sculptComponent = {"id": "fan-collar", "name": "Neck collar", "level": "meso", "role": "collar", "importance": 0.4, "confidence": 0.65, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "A short flared cuff where the neck meets the base. The reference shows the cream run widening from 176 px to 214 px over the last few rows before the navy starts, which is a collar rather than a taper on the pole itself.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 248, 232, 1.0)", "secondaryAlbedo": "rgba(229, 223, 208, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "flared cuff revolved about Y", "edgeTreatment": {"type": "rolled", "bevelRadius": 0.015, "segments": 20}, "deformationStack": [], "uvStrategy": "LatheGeometry cylindrical UVs", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.0, 0.0], [0.1262, 0.0], [0.1186, 0.0453], [0.1079, 0.0824], [0.0, 0.0824]], "segments": 20, "phiStart": 0.0, "phiLength": 6.283185}}, "parent": "fan-base", "attachment": null, "dimensions": {"width": 0.2523, "height": 0.0824, "depth": 0.2523, "units": "world", "confidence": 0.65}, "transform": {"position": [0.0, 0.2747, -0.05], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.65}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "blade-cream", "materialLayers": ["blade-cream"], "deformations": [], "joints": [], "seams": [{"id": "collar-base-seam", "with": "fan-base", "overlap": 0.02, "notes": "The cuff's foot laps the base's crown."}], "localFeatures": [{"id": "collar-flare", "description": "The cuff flares to 0.2523 against the neck's 0.2075, measured as 214 px against 176 px on the reference's rows 0.725 and 0.695.", "geometry": "revolved flare seated on the base crown", "evidenceRefs": ["full-object", "base-zone"], "confidence": 0.65}], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.08, "bumpAmplitude": 0.0, "normalPattern": "matte moulded plastic", "displacementPattern": "none", "occlusionPattern": "hard occlusion in the flare's throat", "edgeWearPattern": "none", "notes": "Same plastic as the neck it sleeves."}, "evidenceRefs": ["full-object", "base-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_fan_collar_2.userData.actionProfile = node_fan_collar_2.userData.sculptComponent.actionProfile;
  (nodes["fan-base"] ?? root).add(node_fan_collar_2);
  nodes["fan-collar"] = node_fan_collar_2;
  const mesh_fan_collar_2Geometry = endpoint_fan_collar_2
    ? new THREE.CylinderGeometry(endpoint_fan_collar_2.endRadius, endpoint_fan_collar_2.baseRadius, endpoint_fan_collar_2.length, 32, 12)
    : buildLatheGeometry({"points": [[0.0, 0.0], [0.1262, 0.0], [0.1186, 0.0453], [0.1079, 0.0824], [0.0, 0.0824]], "segments": 20, "phiStart": 0.0, "phiLength": 6.283185});
  const mesh_fan_collar_2 = new THREE.Mesh(
    mesh_fan_collar_2Geometry,
    materialMap["blade-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fan_collar_2.name = "Neck collar";
  if (endpoint_fan_collar_2) {
    mesh_fan_collar_2.position.copy(endpoint_fan_collar_2.midpoint);
    mesh_fan_collar_2.quaternion.copy(endpoint_fan_collar_2.quaternion);
  }
  mesh_fan_collar_2.castShadow = options.castShadow ?? true;
  mesh_fan_collar_2.receiveShadow = options.receiveShadow ?? true;
  mesh_fan_collar_2.userData.sculptComponent = node_fan_collar_2.userData.sculptComponent;
  node_fan_collar_2.add(mesh_fan_collar_2);
  meshes["fan-collar"] = mesh_fan_collar_2;
  colliders["fan-collar"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["body"] ??= [];
  destructionGroups["body"].push(node_fan_collar_2);

  const attachment_fan_guard_ring_3 = null;
  const endpoint_fan_guard_ring_3 = makeAttachmentEndpoint(attachment_fan_guard_ring_3);
  const node_fan_guard_ring_3 = new THREE.Group();
  node_fan_guard_ring_3.name = "Guard rim__pivot";
  if (endpoint_fan_guard_ring_3) {
    node_fan_guard_ring_3.position.copy(endpoint_fan_guard_ring_3.start);
    node_fan_guard_ring_3.rotation.set(0, 0, 0);
    node_fan_guard_ring_3.scale.set(1, 1, 1);
  } else {
    node_fan_guard_ring_3.position.set(0.0, 0.8304, 0.22);
    node_fan_guard_ring_3.rotation.set(0.0, 0.0, 0.0);
    node_fan_guard_ring_3.scale.set(0.98524, 0.98524, 0.98524);
  }
  node_fan_guard_ring_3.userData.sculptComponent = {"id": "fan-guard-ring", "name": "Guard rim", "level": "macro", "role": "guard", "importance": 1.0, "confidence": 0.8, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "The cage's outer rim, and the single part that draws the prop's whole width. It is a true circle: the reference reads it as an ellipse only because the head is yawed 43 degrees off camera.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(87, 223, 161, 1.0)", "secondaryAlbedo": "rgba(78, 200, 144, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "torus standing in the XY plane, facing +Z", "edgeTreatment": {"type": "rolled", "bevelRadius": 0.02, "segments": 96}, "deformationStack": [], "uvStrategy": "torus UVs", "normalStrategy": "smooth vertex normals", "torusTubeRatio": 0.05932}, "parent": "fan-base", "attachment": null, "dimensions": {"width": 0.9393, "height": 0.9393, "depth": 0.0526, "units": "world", "confidence": 0.8}, "transform": {"position": [0.0, 0.8304, 0.22], "rotation": [0.0, 0.0, 0.0], "scale": [0.98524, 0.98524, 0.98524]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 0.0, 1.0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "spoke-ring", "localPosition": [0.0, 0.0, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "The rim's own centre, where the 14 guard spokes terminate. NOTE that the instancer does not read this socket, or any socket; it places a cluster about its PARENT NODE's origin. The socket records the intent and the parent enforces it."}], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cage", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "guard-mint", "materialLayers": ["guard-mint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "ring-rim", "description": "The rim is 0.9393 across with a 0.0526 section, from the reference's 803 px guard span and its 45 px rim.", "geometry": "torus scaled to the measured outer diameter and section", "evidenceRefs": ["full-object", "guard-zone"], "confidence": 0.8}, {"id": "spoke-bridge", "description": "14 spokes bridge the hub to this rim, counted as separated objects around the guard ellipse at three radii: 16, 15 and 17. They are built as one instanced cluster so the measured count costs one draw call.", "geometry": "radial instanced cluster terminating on the rim", "evidenceRefs": ["full-object", "guard-zone"], "confidence": 0.75}, {"id": "ring-shadow", "description": "The rim and its spokes throw the shadows that make the cream blades read as sitting behind a cage rather than as a flat disc.", "geometry": "cage standing clear of the blades in Z", "evidenceRefs": ["full-object", "blade-zone"], "confidence": 0.7}], "surfaceDetail": {"macroRoughness": 0.56, "microRoughness": 0.07, "bumpAmplitude": 0.0, "normalPattern": "matte moulded plastic with a broad rim terminator", "displacementPattern": "none", "occlusionPattern": "cage shadows cast onto the blades", "edgeWearPattern": "none", "notes": "The prop's identity, carried on shape rather than on value."}, "evidenceRefs": ["full-object", "guard-zone"], "details": [], "fidelityTier": "blockout"};
  node_fan_guard_ring_3.userData.actionProfile = node_fan_guard_ring_3.userData.sculptComponent.actionProfile;
  (nodes["fan-base"] ?? root).add(node_fan_guard_ring_3);
  nodes["fan-guard-ring"] = node_fan_guard_ring_3;
  const mesh_fan_guard_ring_3Geometry = endpoint_fan_guard_ring_3
    ? new THREE.CylinderGeometry(endpoint_fan_guard_ring_3.endRadius, endpoint_fan_guard_ring_3.baseRadius, endpoint_fan_guard_ring_3.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.0267, 12, 48);
  const mesh_fan_guard_ring_3 = new THREE.Mesh(
    mesh_fan_guard_ring_3Geometry,
    materialMap["guard-mint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fan_guard_ring_3.name = "Guard rim";
  if (endpoint_fan_guard_ring_3) {
    mesh_fan_guard_ring_3.position.copy(endpoint_fan_guard_ring_3.midpoint);
    mesh_fan_guard_ring_3.quaternion.copy(endpoint_fan_guard_ring_3.quaternion);
  }
  mesh_fan_guard_ring_3.castShadow = options.castShadow ?? true;
  mesh_fan_guard_ring_3.receiveShadow = options.receiveShadow ?? true;
  mesh_fan_guard_ring_3.userData.sculptComponent = node_fan_guard_ring_3.userData.sculptComponent;
  node_fan_guard_ring_3.add(mesh_fan_guard_ring_3);
  meshes["fan-guard-ring"] = mesh_fan_guard_ring_3;
  colliders["fan-guard-ring"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["cage"] ??= [];
  destructionGroups["cage"].push(node_fan_guard_ring_3);
  const socket_fan_guard_ring_spoke_ring_0 = new THREE.Object3D();
  socket_fan_guard_ring_spoke_ring_0.name = "spoke-ring";
  socket_fan_guard_ring_spoke_ring_0.position.set(0.0, 0.0, 0.0);
  socket_fan_guard_ring_spoke_ring_0.rotation.set(0.0, 0.0, 0.0);
  socket_fan_guard_ring_spoke_ring_0.userData.socket = {"id": "spoke-ring", "localPosition": [0.0, 0.0, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "The rim's own centre, where the 14 guard spokes terminate. NOTE that the instancer does not read this socket, or any socket; it places a cluster about its PARENT NODE's origin. The socket records the intent and the parent enforces it."};
  node_fan_guard_ring_3.add(socket_fan_guard_ring_spoke_ring_0);
  sockets["fan-guard-ring:spoke-ring"] = socket_fan_guard_ring_spoke_ring_0;

  const attachment_fan_hub_4 = {"parentId": "fan-base", "parentSocket": "cage-centre", "contactType": "socketed", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.05], "contactNormal": [0.0, 1.0, 0.0], "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0, "baseRadius": 0.1357, "endRadius": 0.1357, "geometryFromSpec": true};
  const endpoint_fan_hub_4 = makeAttachmentEndpoint(attachment_fan_hub_4);
  const node_fan_hub_4 = new THREE.Group();
  node_fan_hub_4.name = "Hub cap__pivot";
  if (endpoint_fan_hub_4) {
    node_fan_hub_4.position.copy(endpoint_fan_hub_4.start);
    node_fan_hub_4.rotation.set(0, 0, 0);
    node_fan_hub_4.scale.set(1, 1, 1);
  } else {
    node_fan_hub_4.position.set(0.0, 0.8304, 0.16);
    node_fan_hub_4.rotation.set(1.570796, 0.0, 0.0);
    node_fan_hub_4.scale.set(0.2714, 0.05, 0.2714);
  }
  node_fan_hub_4.userData.sculptComponent = {"id": "fan-hub", "name": "Hub cap", "level": "macro", "role": "hub", "importance": 0.6, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The mint disc at the cage's centre. The reference shows it as a flat solid cap with a clean edge, which is what the spokes converge on.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(87, 223, 161, 1.0)", "secondaryAlbedo": "rgba(81, 209, 151, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "shallow disc facing +Z", "edgeTreatment": {"type": "rolled", "bevelRadius": 0.012, "segments": 28}, "deformationStack": [], "uvStrategy": "cylinder UVs", "normalStrategy": "smooth vertex normals"}, "parent": "fan-base", "attachment": {"parentId": "fan-base", "parentSocket": "cage-centre", "contactType": "socketed", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.0, 0.05], "contactNormal": [0.0, 1.0, 0.0], "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0, "baseRadius": 0.1357, "endRadius": 0.1357, "geometryFromSpec": true}, "dimensions": {"width": 0.2714, "height": 0.2714, "depth": 0.05, "units": "world", "confidence": 0.75}, "transform": {"position": [0.0, 0.8304, 0.16], "rotation": [1.570796, 0.0, 0.0], "scale": [0.2714, 0.05, 0.2714]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 0.0, 1.0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cage", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "guard-mint", "materialLayers": ["guard-mint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "hub-cap", "description": "The hub is 0.2714 across, 0.289 of the guard's span, measured as 232 px against 803.", "geometry": "disc at the measured fraction of the guard", "evidenceRefs": ["full-object", "guard-zone"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.56, "microRoughness": 0.07, "bumpAmplitude": 0.0, "normalPattern": "matte moulded plastic", "displacementPattern": "none", "occlusionPattern": "occlusion at the blade roots", "edgeWearPattern": "none", "notes": "Same plastic as the cage."}, "evidenceRefs": ["full-object", "guard-zone"], "details": [], "fidelityTier": "blockout"};
  node_fan_hub_4.userData.actionProfile = node_fan_hub_4.userData.sculptComponent.actionProfile;
  (nodes["fan-base"] ?? root).add(node_fan_hub_4);
  nodes["fan-hub"] = node_fan_hub_4;
  const mesh_fan_hub_4Geometry = endpoint_fan_hub_4
    ? new THREE.CylinderGeometry(endpoint_fan_hub_4.endRadius, endpoint_fan_hub_4.baseRadius, endpoint_fan_hub_4.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 32, 1);
  const mesh_fan_hub_4 = new THREE.Mesh(
    mesh_fan_hub_4Geometry,
    materialMap["guard-mint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fan_hub_4.name = "Hub cap";
  if (endpoint_fan_hub_4) {
    mesh_fan_hub_4.position.copy(endpoint_fan_hub_4.midpoint);
    mesh_fan_hub_4.quaternion.copy(endpoint_fan_hub_4.quaternion);
  }
  mesh_fan_hub_4.castShadow = options.castShadow ?? true;
  mesh_fan_hub_4.receiveShadow = options.receiveShadow ?? true;
  mesh_fan_hub_4.userData.sculptComponent = node_fan_hub_4.userData.sculptComponent;
  node_fan_hub_4.add(mesh_fan_hub_4);
  meshes["fan-hub"] = mesh_fan_hub_4;
  colliders["fan-hub"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["cage"] ??= [];
  destructionGroups["cage"].push(node_fan_hub_4);

  const attachment_fan_blades_5 = null;
  const endpoint_fan_blades_5 = makeAttachmentEndpoint(attachment_fan_blades_5);
  const node_fan_blades_5 = new THREE.Group();
  node_fan_blades_5.name = "blades__pivot";
  if (endpoint_fan_blades_5) {
    node_fan_blades_5.position.copy(endpoint_fan_blades_5.start);
    node_fan_blades_5.rotation.set(0, 0, 0);
    node_fan_blades_5.scale.set(1, 1, 1);
  } else {
    node_fan_blades_5.position.set(0.0, 0.8304, 0.125);
    node_fan_blades_5.rotation.set(0.0, 0.0, 0.0);
    node_fan_blades_5.scale.set(1.0, 1.0, 1.0);
  }
  node_fan_blades_5.userData.sculptComponent = {"id": "fan-blades", "name": "blades", "level": "macro", "role": "blade", "importance": 0.75, "confidence": 0.55, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "The 5 cream petals as one rigid rosette. They are broad and rounded, running from the hub out to just inside the rim, and they only ever move together, so they are one part with one pivot rather than five that must be kept in step.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 248, 232, 1.0)", "secondaryAlbedo": "rgba(229, 223, 208, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "five-petal rosette swept along Z and rolled at both faces", "edgeTreatment": {"type": "rolled", "bevelRadius": 0.0135, "segments": 1}, "deformationStack": ["face roll", "tip roll"], "uvStrategy": "ExtrudeGeometry cap and wall UVs", "normalStrategy": "welded vertices then smooth vertex normals", "profile2D": {"points": [[0.29131, 0.0], [0.31963, 0.01435], [0.34254, 0.03083], [0.36051, 0.04883], [0.37347, 0.06778], [0.38125, 0.08702], [0.38371, 0.1059], [0.3808, 0.12373], [0.37267, 0.13986], [0.35959, 0.1537], [0.34198, 0.16469], [0.32036, 0.17239], [0.29524, 0.1764], [0.26702, 0.17626], [0.23568, 0.17123], [0.19956, 0.15915], [0.08992, 0.07856], [0.0863, 0.08251], [0.08251, 0.0863], [0.07856, 0.08992], [0.07444, 0.09335], [0.07018, 0.0966], [0.06578, 0.09965], [0.06124, 0.1025], [0.05658, 0.10514], [0.05181, 0.10758], [0.04693, 0.10979], [0.08969, 0.23897], [0.09002, 0.27706], [0.08512, 0.30842], [0.07653, 0.3353], [0.06496, 0.35795], [0.05095, 0.37614], [0.03505, 0.38948], [0.01786, 0.39765], [0.0, 0.4004], [-0.01786, 0.39765], [-0.03505, 0.38948], [-0.05095, 0.37614], [-0.06496, 0.35795], [-0.07653, 0.3353], [-0.08512, 0.30842], [-0.09002, 0.27706], [-0.08969, 0.23897], [-0.04693, 0.10979], [-0.05181, 0.10758], [-0.05658, 0.10514], [-0.06124, 0.1025], [-0.06578, 0.09965], [-0.07018, 0.0966], [-0.07444, 0.09335], [-0.07856, 0.08992], [-0.08251, 0.0863], [-0.0863, 0.08251], [-0.08992, 0.07856], [-0.19956, 0.15915], [-0.23568, 0.17123], [-0.26702, 0.17626], [-0.29524, 0.1764], [-0.32036, 0.17239], [-0.34198, 0.16469], [-0.35959, 0.1537], [-0.37267, 0.13986], [-0.3808, 0.12373], [-0.38371, 0.1059], [-0.38125, 0.08702], [-0.37347, 0.06778], [-0.36051, 0.04883], [-0.34254, 0.03083], [-0.31963, 0.01435], [-0.29131, 0.0], [-0.25499, -0.01145], [-0.11892, -0.0107], [-0.11832, -0.01603], [-0.11748, -0.02132], [-0.11641, -0.02657], [-0.1151, -0.03176], [-0.11356, -0.0369], [-0.11179, -0.04195], [-0.10979, -0.04693], [-0.10758, -0.05181], [-0.10514, -0.05658], [-0.1025, -0.06124], [-0.21302, -0.14062], [-0.23568, -0.17123], [-0.25015, -0.19949], [-0.259, -0.22628], [-0.26295, -0.25141], [-0.26231, -0.27435], [-0.25729, -0.29449], [-0.24818, -0.31121], [-0.23535, -0.32393], [-0.21928, -0.3322], [-0.20057, -0.3357], [-0.17987, -0.33425], [-0.15785, -0.32777], [-0.13517, -0.31625], [-0.11242, -0.29955], [-0.09002, -0.27706], [-0.06791, -0.24605], [-0.02657, -0.11641], [-0.02132, -0.11748], [-0.01603, -0.11832], [-0.0107, -0.11892], [-0.00536, -0.11928], [-0.0, -0.1194], [0.00536, -0.11928], [0.0107, -0.11892], [0.01603, -0.11832], [0.02132, -0.11748], [0.02657, -0.11641], [0.06791, -0.24605], [0.09002, -0.27706], [0.11242, -0.29955], [0.13517, -0.31625], [0.15785, -0.32777], [0.17987, -0.33425], [0.20057, -0.3357], [0.21928, -0.3322], [0.23535, -0.32393], [0.24818, -0.31121], [0.25729, -0.29449], [0.26231, -0.27435], [0.26295, -0.25141], [0.259, -0.22628], [0.25015, -0.19949], [0.23568, -0.17123], [0.21302, -0.14062], [0.1025, -0.06124], [0.10514, -0.05658], [0.10758, -0.05181], [0.10979, -0.04693], [0.11179, -0.04195], [0.11356, -0.0369], [0.1151, -0.03176], [0.11641, -0.02657], [0.11748, -0.02132], [0.11832, -0.01603], [0.11892, -0.0107], [0.25499, -0.01145]], "depth": 0.03, "axis": "z", "axisOffset": 0.0, "steps": 4, "smoothShading": true}}, "parent": "fan-base", "attachment": null, "dimensions": {"width": 0.8008, "height": 0.8008, "depth": 0.03, "units": "world", "confidence": 0.55}, "transform": {"position": [0.0, 0.8304, 0.125], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "spin", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 0.0, 1.0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "blades", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "blade-cream", "materialLayers": ["blade-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "blade-petal", "description": "Each petal spans radius 0.1194 to 0.4004 and subtends about 50 degrees, from the cream mask's steady 0.55 fraction of the circle shared between 5 blades.", "geometry": "five elliptical petals unioned radially about the spin axis", "evidenceRefs": ["full-object", "blade-zone"], "confidence": 0.55}, {"id": "blade-web", "description": "The petals are joined by a central web out to 0.1194, which is the radius they already reach inward to. The hub cap in front of it is 0.1357, so the web is never seen. It exists so the rosette is one spinnable part rather than five that can drift out of step.", "geometry": "radial union floor at the petals' own inner radius", "evidenceRefs": ["full-object", "blade-zone"], "confidence": 0.5}], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.08, "bumpAmplitude": 0.0, "normalPattern": "matte moulded plastic", "displacementPattern": "none", "occlusionPattern": "deep occlusion behind the cage", "edgeWearPattern": "none", "notes": "Reads only through the cage's shadows; its own value is 1.00:1 on deck."}, "evidenceRefs": ["full-object", "blade-zone"], "details": [], "fidelityTier": "blockout"};
  node_fan_blades_5.userData.actionProfile = node_fan_blades_5.userData.sculptComponent.actionProfile;
  (nodes["fan-base"] ?? root).add(node_fan_blades_5);
  nodes["fan-blades"] = node_fan_blades_5;
  const mesh_fan_blades_5Geometry = endpoint_fan_blades_5
    ? new THREE.CylinderGeometry(endpoint_fan_blades_5.endRadius, endpoint_fan_blades_5.baseRadius, endpoint_fan_blades_5.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0.29131, 0.0], [0.31963, 0.01435], [0.34254, 0.03083], [0.36051, 0.04883], [0.37347, 0.06778], [0.38125, 0.08702], [0.38371, 0.1059], [0.3808, 0.12373], [0.37267, 0.13986], [0.35959, 0.1537], [0.34198, 0.16469], [0.32036, 0.17239], [0.29524, 0.1764], [0.26702, 0.17626], [0.23568, 0.17123], [0.19956, 0.15915], [0.08992, 0.07856], [0.0863, 0.08251], [0.08251, 0.0863], [0.07856, 0.08992], [0.07444, 0.09335], [0.07018, 0.0966], [0.06578, 0.09965], [0.06124, 0.1025], [0.05658, 0.10514], [0.05181, 0.10758], [0.04693, 0.10979], [0.08969, 0.23897], [0.09002, 0.27706], [0.08512, 0.30842], [0.07653, 0.3353], [0.06496, 0.35795], [0.05095, 0.37614], [0.03505, 0.38948], [0.01786, 0.39765], [0.0, 0.4004], [-0.01786, 0.39765], [-0.03505, 0.38948], [-0.05095, 0.37614], [-0.06496, 0.35795], [-0.07653, 0.3353], [-0.08512, 0.30842], [-0.09002, 0.27706], [-0.08969, 0.23897], [-0.04693, 0.10979], [-0.05181, 0.10758], [-0.05658, 0.10514], [-0.06124, 0.1025], [-0.06578, 0.09965], [-0.07018, 0.0966], [-0.07444, 0.09335], [-0.07856, 0.08992], [-0.08251, 0.0863], [-0.0863, 0.08251], [-0.08992, 0.07856], [-0.19956, 0.15915], [-0.23568, 0.17123], [-0.26702, 0.17626], [-0.29524, 0.1764], [-0.32036, 0.17239], [-0.34198, 0.16469], [-0.35959, 0.1537], [-0.37267, 0.13986], [-0.3808, 0.12373], [-0.38371, 0.1059], [-0.38125, 0.08702], [-0.37347, 0.06778], [-0.36051, 0.04883], [-0.34254, 0.03083], [-0.31963, 0.01435], [-0.29131, 0.0], [-0.25499, -0.01145], [-0.11892, -0.0107], [-0.11832, -0.01603], [-0.11748, -0.02132], [-0.11641, -0.02657], [-0.1151, -0.03176], [-0.11356, -0.0369], [-0.11179, -0.04195], [-0.10979, -0.04693], [-0.10758, -0.05181], [-0.10514, -0.05658], [-0.1025, -0.06124], [-0.21302, -0.14062], [-0.23568, -0.17123], [-0.25015, -0.19949], [-0.259, -0.22628], [-0.26295, -0.25141], [-0.26231, -0.27435], [-0.25729, -0.29449], [-0.24818, -0.31121], [-0.23535, -0.32393], [-0.21928, -0.3322], [-0.20057, -0.3357], [-0.17987, -0.33425], [-0.15785, -0.32777], [-0.13517, -0.31625], [-0.11242, -0.29955], [-0.09002, -0.27706], [-0.06791, -0.24605], [-0.02657, -0.11641], [-0.02132, -0.11748], [-0.01603, -0.11832], [-0.0107, -0.11892], [-0.00536, -0.11928], [-0.0, -0.1194], [0.00536, -0.11928], [0.0107, -0.11892], [0.01603, -0.11832], [0.02132, -0.11748], [0.02657, -0.11641], [0.06791, -0.24605], [0.09002, -0.27706], [0.11242, -0.29955], [0.13517, -0.31625], [0.15785, -0.32777], [0.17987, -0.33425], [0.20057, -0.3357], [0.21928, -0.3322], [0.23535, -0.32393], [0.24818, -0.31121], [0.25729, -0.29449], [0.26231, -0.27435], [0.26295, -0.25141], [0.259, -0.22628], [0.25015, -0.19949], [0.23568, -0.17123], [0.21302, -0.14062], [0.1025, -0.06124], [0.10514, -0.05658], [0.10758, -0.05181], [0.10979, -0.04693], [0.11179, -0.04195], [0.11356, -0.0369], [0.1151, -0.03176], [0.11641, -0.02657], [0.11748, -0.02132], [0.11832, -0.01603], [0.11892, -0.0107], [0.25499, -0.01145]], "depth": 0.03, "axis": "z", "axisOffset": 0.0, "steps": 4, "smoothShading": true});
  const mesh_fan_blades_5 = new THREE.Mesh(
    mesh_fan_blades_5Geometry,
    materialMap["blade-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fan_blades_5.name = "blades";
  if (endpoint_fan_blades_5) {
    mesh_fan_blades_5.position.copy(endpoint_fan_blades_5.midpoint);
    mesh_fan_blades_5.quaternion.copy(endpoint_fan_blades_5.quaternion);
  }
  mesh_fan_blades_5.castShadow = options.castShadow ?? true;
  mesh_fan_blades_5.receiveShadow = options.receiveShadow ?? true;
  mesh_fan_blades_5.userData.sculptComponent = node_fan_blades_5.userData.sculptComponent;
  node_fan_blades_5.add(mesh_fan_blades_5);
  meshes["fan-blades"] = mesh_fan_blades_5;
  colliders["fan-blades"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["blades"] ??= [];
  destructionGroups["blades"].push(node_fan_blades_5);

  const attachment_fan_rear_cage_6 = null;
  const endpoint_fan_rear_cage_6 = makeAttachmentEndpoint(attachment_fan_rear_cage_6);
  const node_fan_rear_cage_6 = new THREE.Group();
  node_fan_rear_cage_6.name = "Rear cage__pivot";
  if (endpoint_fan_rear_cage_6) {
    node_fan_rear_cage_6.position.copy(endpoint_fan_rear_cage_6.start);
    node_fan_rear_cage_6.rotation.set(0, 0, 0);
    node_fan_rear_cage_6.scale.set(1, 1, 1);
  } else {
    node_fan_rear_cage_6.position.set(0.0, 0.8304, 0.1411);
    node_fan_rear_cage_6.rotation.set(0.0, 0.0, 0.0);
    node_fan_rear_cage_6.scale.set(1.00079, 1.00079, 1.00079);
  }
  node_fan_rear_cage_6.userData.sculptComponent = {"id": "fan-rear-cage", "name": "Rear cage", "level": "macro", "role": "guard", "importance": 0.8, "confidence": 0.6, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "The basket behind the blades, built as a rim set back from the front ring. The reference shows a ring of hooked loops there; this is a deliberate simplification of them, recorded because it is a real difference and not a rounding.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(87, 223, 161, 1.0)", "secondaryAlbedo": "rgba(78, 200, 144, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "torus standing in the XY plane, set back along -Z from the front rim", "edgeTreatment": {"type": "rolled", "bevelRadius": 0.02, "segments": 28}, "deformationStack": [], "uvStrategy": "torus UVs", "normalStrategy": "smooth vertex normals", "torusTubeRatio": 0.042078}, "parent": "fan-base", "attachment": null, "dimensions": {"width": 0.9386, "height": 0.9386, "depth": 0.0379, "units": "world", "confidence": 0.6}, "transform": {"position": [0.0, 0.8304, 0.1411], "rotation": [0.0, 0.0, 0.0], "scale": [1.00079, 1.00079, 1.00079]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 0.0, 1.0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cage", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "guard-mint", "materialLayers": ["guard-mint"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "cage-depth", "description": "Set back 0.0789 from the front rim, which is what the reference's 152.0 px of one-sided extra reach solves to at a 43.1 degree yaw. It adds PROJECTED width without adding any.", "geometry": "torus displaced along -Z from the front rim's plane", "evidenceRefs": ["full-object", "guard-zone"], "confidence": 0.6}, {"id": "cage-inside-the-rim", "description": "Outer diameter 0.9386 against the front rim.s 0.9393, so the rear cage never sets the prop's width or height. The guard's top already stands 0.05mm outside the collider and this part cannot add to it.", "geometry": "rear rim held inside the front rim on both axes", "evidenceRefs": ["full-object", "guard-zone"], "confidence": 0.7}], "surfaceDetail": {"macroRoughness": 0.56, "microRoughness": 0.07, "bumpAmplitude": 0.0, "normalPattern": "matte moulded plastic", "displacementPattern": "none", "occlusionPattern": "shadowed by the blades in front of it", "edgeWearPattern": "none", "notes": "Same plastic as the front cage it completes."}, "evidenceRefs": ["full-object", "guard-zone"], "details": [], "fidelityTier": "structural-pass"};
  node_fan_rear_cage_6.userData.actionProfile = node_fan_rear_cage_6.userData.sculptComponent.actionProfile;
  (nodes["fan-base"] ?? root).add(node_fan_rear_cage_6);
  nodes["fan-rear-cage"] = node_fan_rear_cage_6;
  const mesh_fan_rear_cage_6Geometry = endpoint_fan_rear_cage_6
    ? new THREE.CylinderGeometry(endpoint_fan_rear_cage_6.endRadius, endpoint_fan_rear_cage_6.baseRadius, endpoint_fan_rear_cage_6.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.0189, 12, 48);
  const mesh_fan_rear_cage_6 = new THREE.Mesh(
    mesh_fan_rear_cage_6Geometry,
    materialMap["guard-mint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fan_rear_cage_6.name = "Rear cage";
  if (endpoint_fan_rear_cage_6) {
    mesh_fan_rear_cage_6.position.copy(endpoint_fan_rear_cage_6.midpoint);
    mesh_fan_rear_cage_6.quaternion.copy(endpoint_fan_rear_cage_6.quaternion);
  }
  mesh_fan_rear_cage_6.castShadow = options.castShadow ?? true;
  mesh_fan_rear_cage_6.receiveShadow = options.receiveShadow ?? true;
  mesh_fan_rear_cage_6.userData.sculptComponent = node_fan_rear_cage_6.userData.sculptComponent;
  node_fan_rear_cage_6.add(mesh_fan_rear_cage_6);
  meshes["fan-rear-cage"] = mesh_fan_rear_cage_6;
  colliders["fan-rear-cage"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["cage"] ??= [];
  destructionGroups["cage"].push(node_fan_rear_cage_6);

  // repetition system: fan-guard-spokes (InstancedMesh, radial, count=14, level=meso)
  {
    const parent = nodes["fan-guard-ring"] ?? root;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = materialMap["guard-mint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    const scl = [0.2856, 0.0241, 0.0241];
    const axis = new THREE.Vector3(0.0, 0.0, 1.0).normalize();
    const radius = 0.561;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 14);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0]!, scl[1]!, scl[2]!);
    for (let i = 0; i < 14; i++) {
      const ang = ((12.857) + (i * 360) / 14) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "fan-guard-spokes";
    parent.add(cluster);
    meshes["fan-guard-spokes"] = cluster;
  }

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 256, "preferredTextureResolution": 1024, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "ranAnyway": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars."}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness, height, normal or AO", "single-frequency random noise", "glossy toy-plastic highlights on a matte moulded surface", "local colour described only in prose without material masks", "claiming exact PBR recovery from one image"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare the albedo palette and the local colour zones.", "Compare roughness and normal response under the key light.", "Compare contact darkening, seam occlusion and crown polish.", "Compare key, fill and rim structure, exposure, tone mapping and background.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals and uniform roughness.", "Capture a reference-matched render from the solved camera."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createApartmentFloorFanLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Apartment Floor Fan look-dev lights";
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
  lights.userData.lightingFromPhoto = ["Ambient dominance: a soft studio render. The navy runs (57,71,94) and the cage (149,187,164), a range a bright neutral hemisphere plus a gentle key reproduces without a hard terminator.", "Key light: warm-neutral directional at about 1.15 from high and camera left, which is where the base's crown specular and the rim's terminator both sit.", "Rim and environment light: weak neutral back light at about 0.3 so the blades inside the cage do not crush to black. No environment map: the reference shows no reflection.", "Exposure and tone mapping: ACES filmic tone mapping with sRGB output at exposure 1.0.", "Contact shadow: the reference floats with a soft contact shadow under the base. The review render has no ground plane so the silhouette mask stays clean."];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 256, "preferredTextureResolution": 1024, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "ranAnyway": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars."}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness, height, normal or AO", "single-frequency random noise", "glossy toy-plastic highlights on a matte moulded surface", "local colour described only in prose without material masks", "claiming exact PBR recovery from one image"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare the albedo palette and the local colour zones.", "Compare roughness and normal response under the key light.", "Compare contact darkening, seam occlusion and crown polish.", "Compare key, fill and rim structure, exposure, tone mapping and background.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals and uniform roughness.", "Capture a reference-matched render from the solved camera."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createApartmentFloorFanEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
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
export function frameApartmentFloorFanCamera(
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
export function createApartmentFloorFanPresentationComposer(
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

export function configureApartmentFloorFanRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createApartmentFloorFanInspectControls(
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
