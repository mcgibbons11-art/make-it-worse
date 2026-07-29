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

// Generated from ObjectSculptSpec target: Apartment Toilet
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createApartmentToiletModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Apartment Toilet";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "solveMethod": "NOT solved. The prop is not a solid of revolution and the single view is three-quarter, so azimuth and elevation cannot be separated from the plan without a second view. Vertical bands are read directly off row scans, which do not need the camera; plan proportions are taken from the collider and are recorded as an assumption rather than a measurement.", "fovDegrees": 14.0, "aspect": 0.75, "orientation": {"yaw": 28.0, "pitch": -18.0, "roll": 0.0}, "targetHint": [0.0, 0.45, 0.0], "note": "Yaw and pitch are seeds for the harness sweep, not solved values. The review render passes yscale=1.668 to undo the envelope squash so the Tier-1 aspect gate scores shape rather than the squash."}, "approximationNotes": []};

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["ceramic-cream"] = createSculptMaterial(
    "ceramic-cream",
    {"id": "ceramic-cream", "name": "Glazed ceramic", "type": "physical", "shaderModel": "MeshPhysicalMaterial (glazed vitreous china)", "baseColor": "#fff8e8", "color": "#fff8e8", "albedo": {"dominant": "#fff8e8", "secondary": ["#e6dcc6", "#fffdf5"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#fff8e8", "#e6dcc6", "#fffdf5"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.42, "variation": 0.07, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; crowns and handled edges trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.3, "notes": "Darken every part seam, recess and contact ring."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "bowl-underside-occlusion", "target": "toilet-bowl/bowl-belly", "notes": "The bowl's underside loses the key entirely and is the darkest cream in the frame, measured (209,198,175) against (242,231,211) on the lit crown.", "evidenceRefs": ["full-object", "bowl-zone"], "roughness": 0.5, "aoBoost": 0.62, "mask": "the bowl's lower half and the throat behind the pedestal"}, {"id": "cistern-crown-sheen", "target": "toilet-cistern-lid/lid-crown", "notes": "Glazed ceramic, so the cistern lid's crown is the one surface on this prop with a broad soft sheen rather than a matte falloff.", "evidenceRefs": ["full-object", "cistern-zone"], "roughness": 0.34, "mask": "the top face of the cistern lid inside its rolled edge"}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\toilet\\crops\\ceramic-cream-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.842, "estimatedFidelity": 0.842, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\toilet\\pbr\\ceramic-cream_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\toilet\\pbr\\ceramic-cream_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\toilet\\pbr\\ceramic-cream_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\toilet\\pbr\\ceramic-cream_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\toilet\\pbr\\ceramic-cream_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "Glazed vitreous china: smoother than every plastic in this prop set, which is why its roughness sits at 0.42 against the mint's 0.55."},
    options
  );
  materialMap["seat-mint"] = createSculptMaterial(
    "seat-mint",
    {"id": "seat-mint", "name": "Moulded seat plastic", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#57dfa1", "color": "#57dfa1", "albedo": {"dominant": "#57dfa1", "secondary": ["#3fae7d", "#8ff0c4"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#57dfa1", "#3fae7d", "#8ff0c4"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.55, "variation": 0.08, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; crowns and handled edges trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.34, "contactShadowBias": 0.3, "notes": "Darken every part seam, recess and contact ring."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "lid-face-sheen", "target": "toilet-lid/lid-face", "notes": "The raised lid's front face is the largest single mint field in the reference and carries an even, almost gradient-free value.", "evidenceRefs": ["full-object", "lid-zone"], "roughness": 0.5, "mask": "the lid's outward face inside its rolled edge"}, {"id": "seat-inner-occlusion", "target": "toilet-seat/seat-aperture", "notes": "The seat's inner edge turns down into the bowl and occludes hard.", "evidenceRefs": ["full-object", "seat-zone"], "roughness": 0.6, "aoBoost": 0.55, "mask": "the inner wall of the seat ring"}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\toilet\\crops\\seat-mint-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.826, "estimatedFidelity": 0.826, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\toilet\\pbr\\seat-mint_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\toilet\\pbr\\seat-mint_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\toilet\\pbr\\seat-mint_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\toilet\\pbr\\seat-mint_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\toilet\\pbr\\seat-mint_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "Corrected from the reference's own #9ACAB0 to PALETTE.green. Matte moulded plastic, clearly rougher than the glazed ceramic it sits on."},
    options
  );
  materialMap["lever-navy"] = createSculptMaterial(
    "lever-navy",
    {"id": "lever-navy", "name": "Flush lever", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#24324a", "color": "#24324a", "albedo": {"dominant": "#24324a", "secondary": ["#18222f", "#3a4d6b"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#24324a", "#18222f", "#3a4d6b"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.48, "variation": 0.06, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; crowns and handled edges trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.3, "contactShadowBias": 0.3, "notes": "Darken every part seam, recess and contact ring."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "lever-knob-sheen", "target": "toilet-lever/lever-knob", "notes": "The lever is the only dark value on the prop and its knob carries a small bright terminator, which is what makes it read as a solid turned handle rather than a painted mark.", "evidenceRefs": ["full-object", "cistern-zone"], "roughness": 0.4, "mask": "the outer half of the knob"}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\toilet\\crops\\lever-navy-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.61, "estimatedFidelity": 0.61, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\toilet\\pbr\\lever-navy_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\toilet\\pbr\\lever-navy_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\toilet\\pbr\\lever-navy_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\toilet\\pbr\\lever-navy_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\toilet\\pbr\\lever-navy_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "The reference measures #25406B here. Corrected to the #24324a the fan, vacuum and spring bases already use, NOT to PALETTE.ink: ink is the level's own edge band at 13.7:1 against the sky, and a prop part painted in it reads as level geometry rather than as part of the prop."},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const attachment_toilet_bowl_0 = null;
  const endpoint_toilet_bowl_0 = makeAttachmentEndpoint(attachment_toilet_bowl_0);
  const node_toilet_bowl_0 = new THREE.Group();
  node_toilet_bowl_0.name = "Bowl and pedestal__pivot";
  if (endpoint_toilet_bowl_0) {
    node_toilet_bowl_0.position.copy(endpoint_toilet_bowl_0.start);
    node_toilet_bowl_0.rotation.set(0, 0, 0);
    node_toilet_bowl_0.scale.set(1, 1, 1);
  } else {
    node_toilet_bowl_0.position.set(0.0, 0.0, 0.1921);
    node_toilet_bowl_0.rotation.set(0.0, 0.0, 0.0);
    node_toilet_bowl_0.scale.set(1.0, 1.0, 1.0);
  }
  node_toilet_bowl_0.userData.sculptComponent = {"id": "toilet-bowl", "name": "Bowl and pedestal", "level": "macro", "role": "shell", "importance": 1.0, "confidence": 0.8, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "One revolved ceramic body. The reference shows the foot, the pedestal throat and the bowl belly running into each other with no seam and no flat face anywhere, which is a single moulded casting rather than an assembly.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 248, 232, 1.0)", "secondaryAlbedo": "rgba(229, 223, 208, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "profile revolved about Y: flared foot, narrowed pedestal throat, bowl belly flaring to the rim, then back down the inside", "edgeTreatment": {"type": "rolled", "bevelRadius": 0.03, "segments": 28}, "deformationStack": ["rim roll at the bowl lip", "pedestal taper"], "uvStrategy": "LatheGeometry cylindrical UVs", "normalStrategy": "smooth vertex normals from the revolved profile", "latheProfile": {"points": [[0.0, 0.0], [0.223, 0.0], [0.2275, 0.0505], [0.2209, 0.0918], [0.2403, 0.135], [0.254, 0.1809], [0.2819, 0.2709], [0.2906, 0.3009], [0.2848, 0.324], [0.2557, 0.336], [0.1621, 0.33], [0.138, 0.274], [0.0, 0.264]], "segments": 28, "phiStart": 0.0, "phiLength": 6.283185}}, "parent": null, "attachment": null, "dimensions": {"width": 0.5812, "height": 0.324, "depth": 0.5812, "units": "world", "confidence": 0.75}, "transform": {"position": [0.0, 0.0, 0.1921], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0.0, 0.2709, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "floor", "localPosition": [0.0, 0.0, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Underside of the foot; sits on the deck plane at y = 0."}, {"id": "seat-mount", "localPosition": [0.0, 0.324, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "The bowl rim, where the seat ring lands."}, {"id": "lever-mount", "localPosition": [0.4622, 0.6903, -0.54], "localRotation": [0.0, 0.0, 0.0], "notes": "The cistern's right face, where the flush lever is fixed. It lives on the BOWL rather than on the cistern because the cistern is a box primitive: the generator emits a unit BoxGeometry and puts the tank's real size on its pivot node, so anything parented to the cistern inherits a (0.7292, 0.519, 0.2842) scale."}], "collider": {"type": "box", "offset": [0.0, 0.45, 0.0], "scale": [1.02, 0.9, 0.98], "isTrigger": false, "notes": "Matches TrapRenderer's CuboidCollider args=[0.52, 0.45, 0.5] at the [0, -0.45, 0] mount."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "ceramic-cream", "materialLayers": ["ceramic-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bowl-belly", "description": "The bowl reaches its widest 0.5812 at y 0.2709, which is the reference's row 0.699, and tucks back in both above and below it.", "geometry": "lathe profile maximum at the measured band", "evidenceRefs": ["full-object", "bowl-zone"], "confidence": 0.8}, {"id": "pedestal-taper", "description": "The bowl tapers from its belly to 0.4417 at the plinth without a waist. The reference's rows fall 533, 466, 441, 405 px between the belly and the plinth, which a straight line fits to within a percent, so the pedestal is a taper rather than the pinch the first build gave it.", "geometry": "lathe profile taper on the measured rows", "evidenceRefs": ["full-object", "bowl-zone"], "confidence": 0.8}, {"id": "flared-foot", "description": "The foot flares back out to 0.446 at the deck, measured off the reference's row 0.898.", "geometry": "lathe profile flare at the base", "evidenceRefs": ["full-object", "bowl-zone"], "confidence": 0.8}], "surfaceDetail": {"macroRoughness": 0.42, "microRoughness": 0.07, "bumpAmplitude": 0.0, "normalPattern": "glazed vitreous china with a broad soft sheen", "displacementPattern": "none", "occlusionPattern": "deep occlusion under the bowl belly and in the pedestal throat", "edgeWearPattern": "none - the reference is a new fixture", "notes": "The smoothest material in this prop set."}, "evidenceRefs": ["full-object", "bowl-zone"], "details": [], "fidelityTier": "blockout"};
  node_toilet_bowl_0.userData.actionProfile = node_toilet_bowl_0.userData.sculptComponent.actionProfile;
  (nodes["root"] ?? root).add(node_toilet_bowl_0);
  nodes["toilet-bowl"] = node_toilet_bowl_0;
  const mesh_toilet_bowl_0Geometry = endpoint_toilet_bowl_0
    ? new THREE.CylinderGeometry(endpoint_toilet_bowl_0.endRadius, endpoint_toilet_bowl_0.baseRadius, endpoint_toilet_bowl_0.length, 32, 12)
    : buildLatheGeometry({"points": [[0.0, 0.0], [0.223, 0.0], [0.2275, 0.0505], [0.2209, 0.0918], [0.2403, 0.135], [0.254, 0.1809], [0.2819, 0.2709], [0.2906, 0.3009], [0.2848, 0.324], [0.2557, 0.336], [0.1621, 0.33], [0.138, 0.274], [0.0, 0.264]], "segments": 28, "phiStart": 0.0, "phiLength": 6.283185});
  const mesh_toilet_bowl_0 = new THREE.Mesh(
    mesh_toilet_bowl_0Geometry,
    materialMap["ceramic-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_toilet_bowl_0.name = "Bowl and pedestal";
  if (endpoint_toilet_bowl_0) {
    mesh_toilet_bowl_0.position.copy(endpoint_toilet_bowl_0.midpoint);
    mesh_toilet_bowl_0.quaternion.copy(endpoint_toilet_bowl_0.quaternion);
  }
  mesh_toilet_bowl_0.castShadow = options.castShadow ?? true;
  mesh_toilet_bowl_0.receiveShadow = options.receiveShadow ?? true;
  mesh_toilet_bowl_0.userData.sculptComponent = node_toilet_bowl_0.userData.sculptComponent;
  node_toilet_bowl_0.add(mesh_toilet_bowl_0);
  meshes["toilet-bowl"] = mesh_toilet_bowl_0;
  colliders["toilet-bowl"] = {"type": "box", "offset": [0.0, 0.45, 0.0], "scale": [1.02, 0.9, 0.98], "isTrigger": false, "notes": "Matches TrapRenderer's CuboidCollider args=[0.52, 0.45, 0.5] at the [0, -0.45, 0] mount."};
  destructionGroups["body"] ??= [];
  destructionGroups["body"].push(node_toilet_bowl_0);
  const socket_toilet_bowl_floor_0 = new THREE.Object3D();
  socket_toilet_bowl_floor_0.name = "floor";
  socket_toilet_bowl_floor_0.position.set(0.0, 0.0, 0.0);
  socket_toilet_bowl_floor_0.rotation.set(0.0, 0.0, 0.0);
  socket_toilet_bowl_floor_0.userData.socket = {"id": "floor", "localPosition": [0.0, 0.0, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Underside of the foot; sits on the deck plane at y = 0."};
  node_toilet_bowl_0.add(socket_toilet_bowl_floor_0);
  sockets["toilet-bowl:floor"] = socket_toilet_bowl_floor_0;
  const socket_toilet_bowl_seat_mount_1 = new THREE.Object3D();
  socket_toilet_bowl_seat_mount_1.name = "seat-mount";
  socket_toilet_bowl_seat_mount_1.position.set(0.0, 0.324, 0.0);
  socket_toilet_bowl_seat_mount_1.rotation.set(0.0, 0.0, 0.0);
  socket_toilet_bowl_seat_mount_1.userData.socket = {"id": "seat-mount", "localPosition": [0.0, 0.324, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "The bowl rim, where the seat ring lands."};
  node_toilet_bowl_0.add(socket_toilet_bowl_seat_mount_1);
  sockets["toilet-bowl:seat-mount"] = socket_toilet_bowl_seat_mount_1;
  const socket_toilet_bowl_lever_mount_2 = new THREE.Object3D();
  socket_toilet_bowl_lever_mount_2.name = "lever-mount";
  socket_toilet_bowl_lever_mount_2.position.set(0.4622, 0.6903, -0.54);
  socket_toilet_bowl_lever_mount_2.rotation.set(0.0, 0.0, 0.0);
  socket_toilet_bowl_lever_mount_2.userData.socket = {"id": "lever-mount", "localPosition": [0.4622, 0.6903, -0.54], "localRotation": [0.0, 0.0, 0.0], "notes": "The cistern's right face, where the flush lever is fixed. It lives on the BOWL rather than on the cistern because the cistern is a box primitive: the generator emits a unit BoxGeometry and puts the tank's real size on its pivot node, so anything parented to the cistern inherits a (0.7292, 0.519, 0.2842) scale."};
  node_toilet_bowl_0.add(socket_toilet_bowl_lever_mount_2);
  sockets["toilet-bowl:lever-mount"] = socket_toilet_bowl_lever_mount_2;

  const attachment_toilet_ramp_1 = null;
  const endpoint_toilet_ramp_1 = makeAttachmentEndpoint(attachment_toilet_ramp_1);
  const node_toilet_ramp_1 = new THREE.Group();
  node_toilet_ramp_1.name = "Connecting shoulder__pivot";
  if (endpoint_toilet_ramp_1) {
    node_toilet_ramp_1.position.copy(endpoint_toilet_ramp_1.start);
    node_toilet_ramp_1.rotation.set(0, 0, 0);
    node_toilet_ramp_1.scale.set(1, 1, 1);
  } else {
    node_toilet_ramp_1.position.set(0.0, 0.265, -0.2999);
    node_toilet_ramp_1.rotation.set(0.0, 0.0, 0.0);
    node_toilet_ramp_1.scale.set(0.347, 0.09, 0.2361);
  }
  node_toilet_ramp_1.userData.sculptComponent = {"id": "toilet-ramp", "name": "Connecting shoulder", "level": "macro", "role": "shell", "importance": 0.6, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The cream mass bridging the bowl's rear to the tank's base. The reference shows no seam between it and the bowl, so it is one casting with them in the fiction and a separate part only because the bowl is a lathe and cannot grow a rear shoulder.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 248, 232, 1.0)", "secondaryAlbedo": "rgba(229, 223, 208, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "filleted slab running back and up from inside the bowl to under the tank", "edgeTreatment": {"type": "rolled", "bevelRadius": 0.03, "segments": 28}, "deformationStack": [], "uvStrategy": "box UVs", "normalStrategy": "smooth normals over the fillets"}, "parent": "toilet-bowl", "attachment": null, "dimensions": {"width": 0.347, "height": 0.09, "depth": 0.2361, "units": "world", "confidence": 0.6}, "transform": {"position": [0.0, 0.265, -0.2999], "rotation": [0.0, 0.0, 0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "ceramic-cream", "materialLayers": ["ceramic-cream"], "deformations": [], "joints": [], "seams": [{"id": "ramp-bowl-seam", "with": "toilet-bowl", "overlap": 0.02, "notes": "The shoulder's front corners bite the bowl's rear; its centreline is buried deeper, inside the bowl."}, {"id": "ramp-cistern-seam", "with": "toilet-cistern", "overlap": 0.02, "notes": "The shoulder's rear laps behind the tank's front face and the tank sits on its top."}], "localFeatures": [{"id": "shoulder-bridge", "description": "Spans z -0.2258 to 0.0103, closing the measured 0.1073 gap with a 0.02 bite into the bowl at its front corners and the same into the tank's front face.", "geometry": "filleted slab solved against the revolved bowl's corner radius", "evidenceRefs": ["full-object", "cistern-zone"], "confidence": 0.6}, {"id": "tank-overhang", "description": "At 0.347 wide it is far narrower than the tank's 0.9045, so the tank overhangs it on both sides, which is the shadow line the reference shows under the cistern.", "geometry": "shoulder inset from the tank's flanks", "evidenceRefs": ["full-object", "cistern-zone"], "confidence": 0.6}], "surfaceDetail": {"macroRoughness": 0.42, "microRoughness": 0.07, "bumpAmplitude": 0.0, "normalPattern": "glazed vitreous china", "displacementPattern": "none", "occlusionPattern": "deep occlusion in both re-entrants", "edgeWearPattern": "none", "notes": "Same glaze as the bowl it continues."}, "evidenceRefs": ["full-object", "cistern-zone"], "details": [], "fidelityTier": "blockout"};
  node_toilet_ramp_1.userData.actionProfile = node_toilet_ramp_1.userData.sculptComponent.actionProfile;
  (nodes["toilet-bowl"] ?? root).add(node_toilet_ramp_1);
  nodes["toilet-ramp"] = node_toilet_ramp_1;
  const mesh_toilet_ramp_1Geometry = endpoint_toilet_ramp_1
    ? new THREE.CylinderGeometry(endpoint_toilet_ramp_1.endRadius, endpoint_toilet_ramp_1.baseRadius, endpoint_toilet_ramp_1.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1);
  const mesh_toilet_ramp_1 = new THREE.Mesh(
    mesh_toilet_ramp_1Geometry,
    materialMap["ceramic-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_toilet_ramp_1.name = "Connecting shoulder";
  if (endpoint_toilet_ramp_1) {
    mesh_toilet_ramp_1.position.copy(endpoint_toilet_ramp_1.midpoint);
    mesh_toilet_ramp_1.quaternion.copy(endpoint_toilet_ramp_1.quaternion);
  }
  mesh_toilet_ramp_1.castShadow = options.castShadow ?? true;
  mesh_toilet_ramp_1.receiveShadow = options.receiveShadow ?? true;
  mesh_toilet_ramp_1.userData.sculptComponent = node_toilet_ramp_1.userData.sculptComponent;
  node_toilet_ramp_1.add(mesh_toilet_ramp_1);
  meshes["toilet-ramp"] = mesh_toilet_ramp_1;
  colliders["toilet-ramp"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["body"] ??= [];
  destructionGroups["body"].push(node_toilet_ramp_1);

  const attachment_toilet_cistern_2 = null;
  const endpoint_toilet_cistern_2 = makeAttachmentEndpoint(attachment_toilet_cistern_2);
  const node_toilet_cistern_2 = new THREE.Group();
  node_toilet_cistern_2.name = "Cistern__pivot";
  if (endpoint_toilet_cistern_2) {
    node_toilet_cistern_2.position.copy(endpoint_toilet_cistern_2.start);
    node_toilet_cistern_2.rotation.set(0, 0, 0);
    node_toilet_cistern_2.scale.set(1, 1, 1);
  } else {
    node_toilet_cistern_2.position.set(0.0, 0.5235, -0.54);
    node_toilet_cistern_2.rotation.set(0.0, 0.0, 0.0);
    node_toilet_cistern_2.scale.set(0.9045, 0.519, 0.2842);
  }
  node_toilet_cistern_2.userData.sculptComponent = {"id": "toilet-cistern", "name": "Cistern", "level": "macro", "role": "tank", "importance": 0.85, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A rounded rectangular tank with real flat faces, which is what separates it from the bowl: the reference shows a clear planar front and side on the cistern and none on the bowl.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 248, 232, 1.0)", "secondaryAlbedo": "rgba(239, 233, 218, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "rounded rectangular tank standing behind the bowl", "edgeTreatment": {"type": "fillet", "bevelRadius": 0.05, "segments": 3}, "deformationStack": [], "uvStrategy": "box UVs", "normalStrategy": "smooth normals over the fillets"}, "parent": "toilet-bowl", "attachment": null, "dimensions": {"width": 0.9045, "height": 0.519, "depth": 0.2842, "units": "world", "confidence": 0.8}, "transform": {"position": [0.0, 0.5235, -0.54], "rotation": [0.0, 0.0, 0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "ceramic-cream", "materialLayers": ["ceramic-cream"], "deformations": [], "joints": [], "seams": [{"id": "cistern-bowl-seam", "with": "toilet-ramp", "overlap": 0.02, "notes": "The tank does NOT touch the bowl and is not meant to. The measured 0.1073 gap in Z between the bowl's rear and the tank's front face is spanned by toilet-ramp, which bites both, so the tank's contact is with the shoulder rather than with the bowl."}], "localFeatures": [{"id": "cistern-front-face", "description": "The cistern's front face is planar and carries the tank lid its raised seat lid rests against, which is the contact that fixes the lid's lean.", "geometry": "box face at the cistern's +Z side", "evidenceRefs": ["full-object", "cistern-zone"], "confidence": 0.8}], "surfaceDetail": {"macroRoughness": 0.42, "microRoughness": 0.07, "bumpAmplitude": 0.0, "normalPattern": "glazed vitreous china", "displacementPattern": "none", "occlusionPattern": "occlusion where it meets the bowl", "edgeWearPattern": "none", "notes": "Same glaze as the bowl."}, "evidenceRefs": ["full-object", "cistern-zone"], "details": [], "fidelityTier": "blockout"};
  node_toilet_cistern_2.userData.actionProfile = node_toilet_cistern_2.userData.sculptComponent.actionProfile;
  (nodes["toilet-bowl"] ?? root).add(node_toilet_cistern_2);
  nodes["toilet-cistern"] = node_toilet_cistern_2;
  const mesh_toilet_cistern_2Geometry = endpoint_toilet_cistern_2
    ? new THREE.CylinderGeometry(endpoint_toilet_cistern_2.endRadius, endpoint_toilet_cistern_2.baseRadius, endpoint_toilet_cistern_2.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1);
  const mesh_toilet_cistern_2 = new THREE.Mesh(
    mesh_toilet_cistern_2Geometry,
    materialMap["ceramic-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_toilet_cistern_2.name = "Cistern";
  if (endpoint_toilet_cistern_2) {
    mesh_toilet_cistern_2.position.copy(endpoint_toilet_cistern_2.midpoint);
    mesh_toilet_cistern_2.quaternion.copy(endpoint_toilet_cistern_2.quaternion);
  }
  mesh_toilet_cistern_2.castShadow = options.castShadow ?? true;
  mesh_toilet_cistern_2.receiveShadow = options.receiveShadow ?? true;
  mesh_toilet_cistern_2.userData.sculptComponent = node_toilet_cistern_2.userData.sculptComponent;
  node_toilet_cistern_2.add(mesh_toilet_cistern_2);
  meshes["toilet-cistern"] = mesh_toilet_cistern_2;
  colliders["toilet-cistern"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["body"] ??= [];
  destructionGroups["body"].push(node_toilet_cistern_2);

  const attachment_toilet_cistern_lid_3 = null;
  const endpoint_toilet_cistern_lid_3 = makeAttachmentEndpoint(attachment_toilet_cistern_lid_3);
  const node_toilet_cistern_lid_3 = new THREE.Group();
  node_toilet_cistern_lid_3.name = "Cistern lid__pivot";
  if (endpoint_toilet_cistern_lid_3) {
    node_toilet_cistern_lid_3.position.copy(endpoint_toilet_cistern_lid_3.start);
    node_toilet_cistern_lid_3.rotation.set(0, 0, 0);
    node_toilet_cistern_lid_3.scale.set(1, 1, 1);
  } else {
    node_toilet_cistern_lid_3.position.set(0.0, 0.8415, -0.5172);
    node_toilet_cistern_lid_3.rotation.set(0.0, 0.0, 0.0);
    node_toilet_cistern_lid_3.scale.set(0.9588, 0.117, 0.3297);
  }
  node_toilet_cistern_lid_3.userData.sculptComponent = {"id": "toilet-cistern-lid", "name": "Cistern lid", "level": "meso", "role": "lid", "importance": 0.7, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A separate slab overhanging the tank on every side, which the reference shows as a distinct shadow line all round the cistern's top.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 248, 232, 1.0)", "secondaryAlbedo": "rgba(229, 223, 208, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "rounded slab overhanging the cistern", "edgeTreatment": {"type": "fillet", "bevelRadius": 0.035, "segments": 3}, "deformationStack": [], "uvStrategy": "box UVs", "normalStrategy": "smooth normals over the fillets"}, "parent": "toilet-bowl", "attachment": null, "dimensions": {"width": 0.9588, "height": 0.117, "depth": 0.3297, "units": "world", "confidence": 0.8}, "transform": {"position": [0.0, 0.8415, -0.5172], "rotation": [0.0, 0.0, 0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body", "seamRefs": [], "detachableFragments": ["toilet-cistern-lid"], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "ceramic-cream", "materialLayers": ["ceramic-cream"], "deformations": [], "joints": [], "seams": [{"id": "cistern-lid-seam", "with": "toilet-cistern", "overlap": 0.02, "notes": "The lid's underside laps the tank's top rim."}], "localFeatures": [{"id": "lid-crown", "description": "The cistern lid is the tallest part of the prop at y 0.90, and the reference's row 0.000 is its crown rather than the seat lid's.", "geometry": "component position at the measured top band", "evidenceRefs": ["full-object", "cistern-zone"], "confidence": 0.85}, {"id": "lid-overhang", "description": "It overhangs the tank by 0.0272 a side, which is the shadow line the reference shows all round.", "geometry": "slab wider and deeper than the tank", "evidenceRefs": ["full-object", "cistern-zone"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.34, "microRoughness": 0.06, "bumpAmplitude": 0.0, "normalPattern": "glazed vitreous china, the glossiest face on the prop", "displacementPattern": "none", "occlusionPattern": "a hard shadow line under the overhang", "edgeWearPattern": "none", "notes": "Carries the prop's only broad specular sheen."}, "evidenceRefs": ["full-object", "cistern-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_toilet_cistern_lid_3.userData.actionProfile = node_toilet_cistern_lid_3.userData.sculptComponent.actionProfile;
  (nodes["toilet-bowl"] ?? root).add(node_toilet_cistern_lid_3);
  nodes["toilet-cistern-lid"] = node_toilet_cistern_lid_3;
  const mesh_toilet_cistern_lid_3Geometry = endpoint_toilet_cistern_lid_3
    ? new THREE.CylinderGeometry(endpoint_toilet_cistern_lid_3.endRadius, endpoint_toilet_cistern_lid_3.baseRadius, endpoint_toilet_cistern_lid_3.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1);
  const mesh_toilet_cistern_lid_3 = new THREE.Mesh(
    mesh_toilet_cistern_lid_3Geometry,
    materialMap["ceramic-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_toilet_cistern_lid_3.name = "Cistern lid";
  if (endpoint_toilet_cistern_lid_3) {
    mesh_toilet_cistern_lid_3.position.copy(endpoint_toilet_cistern_lid_3.midpoint);
    mesh_toilet_cistern_lid_3.quaternion.copy(endpoint_toilet_cistern_lid_3.quaternion);
  }
  mesh_toilet_cistern_lid_3.castShadow = options.castShadow ?? true;
  mesh_toilet_cistern_lid_3.receiveShadow = options.receiveShadow ?? true;
  mesh_toilet_cistern_lid_3.userData.sculptComponent = node_toilet_cistern_lid_3.userData.sculptComponent;
  node_toilet_cistern_lid_3.add(mesh_toilet_cistern_lid_3);
  meshes["toilet-cistern-lid"] = mesh_toilet_cistern_lid_3;
  colliders["toilet-cistern-lid"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["body"] ??= [];
  destructionGroups["body"].push(node_toilet_cistern_lid_3);

  const attachment_toilet_seat_4 = null;
  const endpoint_toilet_seat_4 = makeAttachmentEndpoint(attachment_toilet_seat_4);
  const node_toilet_seat_4 = new THREE.Group();
  node_toilet_seat_4.name = "Seat ring__pivot";
  if (endpoint_toilet_seat_4) {
    node_toilet_seat_4.position.copy(endpoint_toilet_seat_4.start);
    node_toilet_seat_4.rotation.set(0, 0, 0);
    node_toilet_seat_4.scale.set(1, 1, 1);
  } else {
    node_toilet_seat_4.position.set(0.0, 0.0, 0.0);
    node_toilet_seat_4.rotation.set(0.0, 0.0, 0.0);
    node_toilet_seat_4.scale.set(1.0, 1.0, 1.0);
  }
  node_toilet_seat_4.userData.sculptComponent = {"id": "toilet-seat", "name": "Seat ring", "level": "macro", "role": "seat", "importance": 0.95, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A thin moulded plate, not a continuous volume. The strict-quality flatness gate is right to flag a 0.074 depth-to-diagonal extrude, and the answer is the classification rather than the geometry: a toilet seat IS a thin ring, and it reads as one from every angle because that is what it is. The rolled edge is a local feature on a plate.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(87, 223, 161, 1.0)", "secondaryAlbedo": "rgba(78, 200, 144, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "elliptical annulus swept vertically and rolled at both faces", "edgeTreatment": {"type": "rolled", "bevelRadius": 0.0324, "segments": 1}, "deformationStack": ["crown roll", "inner edge roll"], "uvStrategy": "ExtrudeGeometry cap and wall UVs", "normalStrategy": "welded vertices then smooth vertex normals", "profile2D": {"points": [[0.308, 0.0], [0.30028, 0.06629], [0.2775, 0.12925], [0.2408, 0.18574], [0.19203, 0.23291], [0.13364, 0.2684], [0.06854, 0.29043], [0.0, 0.2979], [-0.06854, 0.29043], [-0.13364, 0.2684], [-0.19203, 0.23291], [-0.2408, 0.18574], [-0.2775, 0.12925], [-0.30028, 0.06629], [-0.308, 0.0], [-0.30028, -0.06629], [-0.2775, -0.12925], [-0.2408, -0.18574], [-0.19203, -0.23291], [-0.13364, -0.2684], [-0.06854, -0.29043], [-0.0, -0.2979], [0.06854, -0.29043], [0.13364, -0.2684], [0.19203, -0.23291], [0.2408, -0.18574], [0.2775, -0.12925], [0.30028, -0.06629]], "depth": 0.072, "axis": "y", "axisOffset": 0.324, "steps": 6, "holes": [[[0.1725, 0.0], [0.16818, 0.03845], [0.15542, 0.07498], [0.13487, 0.10774], [0.10755, 0.1351], [0.07484, 0.15569], [0.03838, 0.16847], [0.0, 0.1728], [-0.03838, 0.16847], [-0.07484, 0.15569], [-0.10755, 0.1351], [-0.13487, 0.10774], [-0.15542, 0.07498], [-0.16818, 0.03845], [-0.1725, 0.0], [-0.16818, -0.03845], [-0.15542, -0.07498], [-0.13487, -0.10774], [-0.10755, -0.1351], [-0.07484, -0.15569], [-0.03838, -0.16847], [-0.0, -0.1728], [0.03838, -0.16847], [0.07484, -0.15569], [0.10755, -0.1351], [0.13487, -0.10774], [0.15542, -0.07498], [0.16818, -0.03845]]], "smoothShading": true}}, "parent": "toilet-bowl", "attachment": null, "dimensions": {"width": 0.6161, "height": 0.072, "depth": 0.5958, "units": "world", "confidence": 0.8}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "socket", "localPosition": [0.0, 0.36, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "hinge-line", "localPosition": [0.0, 0.396, -0.2779], "localRotation": [0.0, 0.0, 0.0], "notes": "Where the lid's hinge blocks sit, at the seat's rear edge."}], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "seat", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "seat-mint", "materialLayers": ["seat-mint"], "deformations": [], "joints": [], "seams": [{"id": "seat-bowl-seam", "with": "toilet-bowl", "overlap": 0.02, "notes": "The ring's underside laps the bowl's rim roll."}], "localFeatures": [{"id": "seat-aperture", "description": "The opening is 0.345 by 0.3456, a little over half the ring's outer plan, which is what the reference's cream centre measures.", "geometry": "elliptical hole in the extrude profile", "evidenceRefs": ["full-object", "seat-zone"], "confidence": 0.75}, {"id": "seat-overhang", "description": "The seat is 0.6161 across against the bowl's 0.5812, so it overhangs the rim all round, which is what the reference's mint row 0.578 measuring wider than the bowl's row 0.699 shows.", "geometry": "measured plan against the bowl's", "evidenceRefs": ["full-object", "seat-zone", "bowl-zone"], "confidence": 0.8}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.08, "bumpAmplitude": 0.0, "normalPattern": "matte moulded plastic, clearly rougher than the glaze", "displacementPattern": "none", "occlusionPattern": "hard occlusion down the inner wall", "edgeWearPattern": "none", "notes": "The prop's second colour, and the one that separates it from the deck."}, "evidenceRefs": ["full-object", "seat-zone"], "details": [], "fidelityTier": "blockout"};
  node_toilet_seat_4.userData.actionProfile = node_toilet_seat_4.userData.sculptComponent.actionProfile;
  (nodes["toilet-bowl"] ?? root).add(node_toilet_seat_4);
  nodes["toilet-seat"] = node_toilet_seat_4;
  const mesh_toilet_seat_4Geometry = endpoint_toilet_seat_4
    ? new THREE.CylinderGeometry(endpoint_toilet_seat_4.endRadius, endpoint_toilet_seat_4.baseRadius, endpoint_toilet_seat_4.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0.308, 0.0], [0.30028, 0.06629], [0.2775, 0.12925], [0.2408, 0.18574], [0.19203, 0.23291], [0.13364, 0.2684], [0.06854, 0.29043], [0.0, 0.2979], [-0.06854, 0.29043], [-0.13364, 0.2684], [-0.19203, 0.23291], [-0.2408, 0.18574], [-0.2775, 0.12925], [-0.30028, 0.06629], [-0.308, 0.0], [-0.30028, -0.06629], [-0.2775, -0.12925], [-0.2408, -0.18574], [-0.19203, -0.23291], [-0.13364, -0.2684], [-0.06854, -0.29043], [-0.0, -0.2979], [0.06854, -0.29043], [0.13364, -0.2684], [0.19203, -0.23291], [0.2408, -0.18574], [0.2775, -0.12925], [0.30028, -0.06629]], "depth": 0.072, "axis": "y", "axisOffset": 0.324, "steps": 6, "holes": [[[0.1725, 0.0], [0.16818, 0.03845], [0.15542, 0.07498], [0.13487, 0.10774], [0.10755, 0.1351], [0.07484, 0.15569], [0.03838, 0.16847], [0.0, 0.1728], [-0.03838, 0.16847], [-0.07484, 0.15569], [-0.10755, 0.1351], [-0.13487, 0.10774], [-0.15542, 0.07498], [-0.16818, 0.03845], [-0.1725, 0.0], [-0.16818, -0.03845], [-0.15542, -0.07498], [-0.13487, -0.10774], [-0.10755, -0.1351], [-0.07484, -0.15569], [-0.03838, -0.16847], [-0.0, -0.1728], [0.03838, -0.16847], [0.07484, -0.15569], [0.10755, -0.1351], [0.13487, -0.10774], [0.15542, -0.07498], [0.16818, -0.03845]]], "smoothShading": true});
  const mesh_toilet_seat_4 = new THREE.Mesh(
    mesh_toilet_seat_4Geometry,
    materialMap["seat-mint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_toilet_seat_4.name = "Seat ring";
  if (endpoint_toilet_seat_4) {
    mesh_toilet_seat_4.position.copy(endpoint_toilet_seat_4.midpoint);
    mesh_toilet_seat_4.quaternion.copy(endpoint_toilet_seat_4.quaternion);
  }
  mesh_toilet_seat_4.castShadow = options.castShadow ?? true;
  mesh_toilet_seat_4.receiveShadow = options.receiveShadow ?? true;
  mesh_toilet_seat_4.userData.sculptComponent = node_toilet_seat_4.userData.sculptComponent;
  node_toilet_seat_4.add(mesh_toilet_seat_4);
  meshes["toilet-seat"] = mesh_toilet_seat_4;
  colliders["toilet-seat"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["seat"] ??= [];
  destructionGroups["seat"].push(node_toilet_seat_4);
  const socket_toilet_seat_hinge_line_0 = new THREE.Object3D();
  socket_toilet_seat_hinge_line_0.name = "hinge-line";
  socket_toilet_seat_hinge_line_0.position.set(0.0, 0.396, -0.2779);
  socket_toilet_seat_hinge_line_0.rotation.set(0.0, 0.0, 0.0);
  socket_toilet_seat_hinge_line_0.userData.socket = {"id": "hinge-line", "localPosition": [0.0, 0.396, -0.2779], "localRotation": [0.0, 0.0, 0.0], "notes": "Where the lid's hinge blocks sit, at the seat's rear edge."};
  node_toilet_seat_4.add(socket_toilet_seat_hinge_line_0);
  sockets["toilet-seat:hinge-line"] = socket_toilet_seat_hinge_line_0;

  const attachment_toilet_lid_5 = {"parentId": "toilet-seat", "parentSocket": "hinge-line", "contactType": "hinged", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.3015, -0.0745], "contactNormal": [0.0, 1.0, 0.0], "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0, "baseRadius": 0.0331, "endRadius": 0.0331, "geometryFromSpec": true};
  const endpoint_toilet_lid_5 = makeAttachmentEndpoint(attachment_toilet_lid_5);
  const node_toilet_lid_5 = new THREE.Group();
  node_toilet_lid_5.name = "Raised seat lid__pivot";
  if (endpoint_toilet_lid_5) {
    node_toilet_lid_5.position.copy(endpoint_toilet_lid_5.start);
    node_toilet_lid_5.rotation.set(0, 0, 0);
    node_toilet_lid_5.scale.set(1, 1, 1);
  } else {
    node_toilet_lid_5.position.set(0.0, 0.522, -0.2779);
    node_toilet_lid_5.rotation.set(1.328596, 0.0, 0.0);
    node_toilet_lid_5.scale.set(1.0, 1.0, 1.0);
  }
  node_toilet_lid_5.userData.sculptComponent = {"id": "toilet-lid", "name": "Raised seat lid", "level": "macro", "role": "lid", "importance": 1.0, "confidence": 0.65, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A thin elliptical plate with a rolled edge, standing UP and leaning back against the cistern. Classified as a plate for the same reason as the seat: it is one. This is the prop's largest single mint field and the surface a camera looking down at the deck sees.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(87, 223, 161, 1.0)", "secondaryAlbedo": "rgba(78, 200, 144, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "elliptical slab swept and rolled at both faces, rotated back about the hinge line so it stands rather than lies", "edgeTreatment": {"type": "rolled", "bevelRadius": 0.0298, "segments": 1}, "deformationStack": ["face roll", "edge roll"], "uvStrategy": "ExtrudeGeometry cap and wall UVs", "normalStrategy": "welded vertices then smooth vertex normals", "profile2D": {"points": [[0.2895, 0.1553], [0.28224, 0.18986], [0.26083, 0.22268], [0.22634, 0.25213], [0.1805, 0.27672], [0.12561, 0.29522], [0.06442, 0.30671], [0.0, 0.3106], [-0.06442, 0.30671], [-0.12561, 0.29522], [-0.1805, 0.27672], [-0.22634, 0.25213], [-0.26083, 0.22268], [-0.28224, 0.18986], [-0.2895, 0.1553], [-0.28224, 0.12074], [-0.26083, 0.08792], [-0.22634, 0.05847], [-0.1805, 0.03388], [-0.12561, 0.01538], [-0.06442, 0.00389], [-0.0, 0.0], [0.06442, 0.00389], [0.12561, 0.01538], [0.1805, 0.03388], [0.22634, 0.05847], [0.26083, 0.08792], [0.28224, 0.12074]], "depth": 0.0662, "axis": "y", "axisOffset": 0.0, "steps": 6, "smoothShading": true}}, "parent": "toilet-seat", "attachment": {"parentId": "toilet-seat", "parentSocket": "hinge-line", "contactType": "hinged", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.0, 0.3015, -0.0745], "contactNormal": [0.0, 1.0, 0.0], "embedDepth": 0.02, "overlap": 0.02, "gapTolerance": 0.0, "baseRadius": 0.0331, "endRadius": 0.0331, "geometryFromSpec": true}, "dimensions": {"width": 0.5791, "height": 0.0662, "depth": 0.3106, "units": "world", "confidence": 0.65}, "transform": {"position": [0.0, 0.522, -0.2779], "rotation": [1.328596, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "hinge", "pivot": {"mode": "socket", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "lid-tip", "localPosition": [0.0, 0.0, 0.3106], "localRotation": [0.0, 0.0, 0.0], "notes": "The free end of the lid; rests against the cistern lid's front face."}], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "seat", "seamRefs": [], "detachableFragments": ["toilet-lid"], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "seat-mint", "materialLayers": ["seat-mint"], "deformations": [], "joints": [], "seams": [{"id": "lid-hinge-seam", "with": "toilet-seat", "overlap": 0.02, "notes": "The lid's hinge end is buried in the hinge blocks."}], "localFeatures": [{"id": "lid-raised", "description": "The lid stands, hinged at y 0.522 and topping out at y 0.8235, which are the reference's rows 0.420 and 0.085. It is NOT the tallest part of the prop: the cistern lid is, at y 0.9.", "geometry": "component rotation about the hinge socket", "evidenceRefs": ["full-object", "lid-zone"], "confidence": 0.7}, {"id": "lid-face", "description": "The lid's outward face is the largest single mint field in the reference and the one a downward camera sees, which is why the lid is raised rather than closed.", "geometry": "elliptical slab presented at the derived lean", "evidenceRefs": ["full-object", "lid-zone"], "confidence": 0.8}, {"id": "lid-rests-on-cistern", "description": "Leaning 13.9 degrees back from vertical brings the tip onto the cistern lid's front face and lands it exactly on the measured top band. The length that follows is 0.521 of the seat's depth: a lid long enough to cover its seat would overhang the collider's back face by 0.5319.", "geometry": "length and lean solved together from the measured rise and the depth available", "evidenceRefs": ["full-object", "lid-zone", "cistern-zone"], "confidence": 0.6}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.08, "bumpAmplitude": 0.0, "normalPattern": "matte moulded plastic", "displacementPattern": "none", "occlusionPattern": "occlusion where it meets the cistern", "edgeWearPattern": "none", "notes": "The prop's largest camera-facing coloured surface."}, "evidenceRefs": ["full-object", "lid-zone"], "details": [], "fidelityTier": "blockout"};
  node_toilet_lid_5.userData.actionProfile = node_toilet_lid_5.userData.sculptComponent.actionProfile;
  (nodes["toilet-seat"] ?? root).add(node_toilet_lid_5);
  nodes["toilet-lid"] = node_toilet_lid_5;
  const mesh_toilet_lid_5Geometry = endpoint_toilet_lid_5
    ? new THREE.CylinderGeometry(endpoint_toilet_lid_5.endRadius, endpoint_toilet_lid_5.baseRadius, endpoint_toilet_lid_5.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0.2895, 0.1553], [0.28224, 0.18986], [0.26083, 0.22268], [0.22634, 0.25213], [0.1805, 0.27672], [0.12561, 0.29522], [0.06442, 0.30671], [0.0, 0.3106], [-0.06442, 0.30671], [-0.12561, 0.29522], [-0.1805, 0.27672], [-0.22634, 0.25213], [-0.26083, 0.22268], [-0.28224, 0.18986], [-0.2895, 0.1553], [-0.28224, 0.12074], [-0.26083, 0.08792], [-0.22634, 0.05847], [-0.1805, 0.03388], [-0.12561, 0.01538], [-0.06442, 0.00389], [-0.0, 0.0], [0.06442, 0.00389], [0.12561, 0.01538], [0.1805, 0.03388], [0.22634, 0.05847], [0.26083, 0.08792], [0.28224, 0.12074]], "depth": 0.0662, "axis": "y", "axisOffset": 0.0, "steps": 6, "smoothShading": true});
  const mesh_toilet_lid_5 = new THREE.Mesh(
    mesh_toilet_lid_5Geometry,
    materialMap["seat-mint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_toilet_lid_5.name = "Raised seat lid";
  if (endpoint_toilet_lid_5) {
    mesh_toilet_lid_5.position.copy(endpoint_toilet_lid_5.midpoint);
    mesh_toilet_lid_5.quaternion.copy(endpoint_toilet_lid_5.quaternion);
  }
  mesh_toilet_lid_5.castShadow = options.castShadow ?? true;
  mesh_toilet_lid_5.receiveShadow = options.receiveShadow ?? true;
  mesh_toilet_lid_5.userData.sculptComponent = node_toilet_lid_5.userData.sculptComponent;
  node_toilet_lid_5.add(mesh_toilet_lid_5);
  meshes["toilet-lid"] = mesh_toilet_lid_5;
  colliders["toilet-lid"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["seat"] ??= [];
  destructionGroups["seat"].push(node_toilet_lid_5);
  const socket_toilet_lid_lid_tip_0 = new THREE.Object3D();
  socket_toilet_lid_lid_tip_0.name = "lid-tip";
  socket_toilet_lid_lid_tip_0.position.set(0.0, 0.0, 0.3106);
  socket_toilet_lid_lid_tip_0.rotation.set(0.0, 0.0, 0.0);
  socket_toilet_lid_lid_tip_0.userData.socket = {"id": "lid-tip", "localPosition": [0.0, 0.0, 0.3106], "localRotation": [0.0, 0.0, 0.0], "notes": "The free end of the lid; rests against the cistern lid's front face."};
  node_toilet_lid_5.add(socket_toilet_lid_lid_tip_0);
  sockets["toilet-lid:lid-tip"] = socket_toilet_lid_lid_tip_0;

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 256, "preferredTextureResolution": 1024, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "ranAnyway": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars."}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness, height, normal or AO", "single-frequency random noise", "glossy toy-plastic highlights on a matte moulded surface", "local colour described only in prose without material masks", "claiming exact PBR recovery from one image"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare the albedo palette and the local colour zones.", "Compare roughness and normal response under the key light.", "Compare contact darkening, seam occlusion and crown polish.", "Compare key, fill and rim structure, exposure, tone mapping and background.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals and uniform roughness.", "Capture a reference-matched render from the solved camera."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createApartmentToiletLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Apartment Toilet look-dev lights";
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
  lights.userData.lightingFromPhoto = ["Ambient dominance: a soft studio render. The ceramic runs (242,231,211) lit to (209,198,175) shaded, a range a bright neutral hemisphere plus a gentle key reproduces without a hard terminator.", "Key light: warm-neutral directional at about 1.15 from high and camera left, which is where the cistern lid's sheen and the lid's lit face both sit.", "Rim and environment light: weak neutral back light at about 0.3 so the bowl's underside does not crush. No environment map: the reference shows no reflection.", "Exposure and tone mapping: ACES filmic tone mapping with sRGB output at exposure 1.0.", "Contact shadow: the reference floats with a soft contact shadow under the foot. The review render has no ground plane so the silhouette mask stays clean."];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 256, "preferredTextureResolution": 1024, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "ranAnyway": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars."}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness, height, normal or AO", "single-frequency random noise", "glossy toy-plastic highlights on a matte moulded surface", "local colour described only in prose without material masks", "claiming exact PBR recovery from one image"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare the albedo palette and the local colour zones.", "Compare roughness and normal response under the key light.", "Compare contact darkening, seam occlusion and crown polish.", "Compare key, fill and rim structure, exposure, tone mapping and background.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals and uniform roughness.", "Capture a reference-matched render from the solved camera."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createApartmentToiletEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
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
export function frameApartmentToiletCamera(
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
export function createApartmentToiletPresentationComposer(
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

export function configureApartmentToiletRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createApartmentToiletInspectControls(
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
