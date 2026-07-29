// --- img2threejs refine-code edits applied by assets/reference/props/refine_props.py
// 1. buildLatheGeometry honours latheProfile.phiStart / phiLength (not present).
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

// Generated from ObjectSculptSpec target: Apartment Soap Dish
// Sculpt build pass: structural-pass
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createApartmentSoapDishModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Apartment Soap Dish";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": true, "solveMethod": "azimuth from the 4 degree tilt of the long axis in the silhouette; elevation seeded at 58 degrees from the rim-band ratios and refined by a harness sweep scored on Tier-1 silhouette IoU", "fovDegrees": 12.0, "aspect": 0.75, "orientation": {"yaw": 4.0, "pitch": -58.0, "roll": 0.0}, "targetHint": [0.0, 0.06, 0.0], "note": "Elevation and plan aspect cannot be separated from one view: a wider dish seen from a steeper angle projects the same silhouette. 58 degrees is the seed; the sweep result is recorded in reviewHistory. Distance is not fixed here: the preview harness solves it by fitting the render's projected bounding box to the reference bounding box (x 80-1011, y 378-1035 of 1086x1448)."}, "approximationNotes": []};

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["dish-blue"] = createSculptMaterial(
    "dish-blue",
    {"id": "dish-blue", "name": "Dish plastic", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded polypropylene)", "baseColor": "#3C8AD6", "color": "#3C8AD6", "albedo": {"dominant": "#3C8AD6", "secondary": ["#2A72BA", "#4E9CE6"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#3C8AD6", "#2A72BA", "#4E9CE6"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.58, "variation": 0.09, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; crowns and handled edges trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.3, "contactShadowBias": 0.3, "notes": "Darken every part seam, recess and contact ring."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "rim-crown-sheen", "target": "dish-wall/rim-roll-over", "notes": "The rolled rim crown is the brightest blue in the frame, measured at (64,148,229) against (26,101,174) on the shaded inner wall.", "evidenceRefs": ["full-object", "rim-zone"], "roughness": 0.5, "mask": "rim crown band, the top 25 percent of the wall"}, {"id": "inner-wall-occlusion", "target": "dish-wall/inner-wall", "notes": "The inner wall darkens sharply toward the floor; it is the darkest blue in the frame.", "evidenceRefs": ["full-object", "interior-zone"], "roughness": 0.66, "aoBoost": 0.6, "mask": "inner wall below the rim crown"}, {"id": "underside-shade", "target": "dish-wall/outer-tuck", "notes": "The outer wall tucks under and loses the key entirely along the bottom silhouette.", "evidenceRefs": ["full-object", "rim-zone"], "roughness": 0.64, "aoBoost": 0.35, "mask": "lower third of the outer wall"}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\soap\\crops\\dish-blue-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.847, "estimatedFidelity": 0.847, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\soap\\pbr\\dish-blue_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\soap\\pbr\\dish-blue_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\soap\\pbr\\dish-blue_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\soap\\pbr\\dish-blue_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\soap\\pbr\\dish-blue_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "Single moulded dish: wall and floor share one pigment and one finish."},
    options
  );
  materialMap["bar-cream"] = createSculptMaterial(
    "bar-cream",
    {"id": "bar-cream", "name": "Soap bar", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#FBF3E4", "color": "#FBF3E4", "albedo": {"dominant": "#FBF3E4", "secondary": ["#EFE0CB", "#FFFCF4"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#FBF3E4", "#EFE0CB", "#FFFCF4"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.48, "variation": 0.1, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; crowns and handled edges trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.22, "contactShadowBias": 0.3, "notes": "Darken every part seam, recess and contact ring."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "bar-crown-sheen", "target": "soap-bar/pillow-crown", "notes": "The bar's crown reads (255,251,242), the brightest value in the frame, and slightly smoother than its flanks: cast soap is polished by the mould.", "evidenceRefs": ["full-object", "bar-zone"], "roughness": 0.4, "mask": "upper 35 percent of the pillow"}, {"id": "bar-contact-shadow", "target": "soap-bar/dish-contact", "notes": "A contact shadow runs where the bar meets the dish floor and darkens the bar's lowest band.", "evidenceRefs": ["full-object", "interior-zone"], "roughness": 0.55, "aoBoost": 0.55, "mask": "lowest 12 percent of the bar"}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\soap\\crops\\bar-cream-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.803, "estimatedFidelity": 0.803, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\soap\\pbr\\bar-cream_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\soap\\pbr\\bar-cream_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\soap\\pbr\\bar-cream_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\soap\\pbr\\bar-cream_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\soap\\pbr\\bar-cream_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "Cast soap. Slightly smoother than the dish and with no colour variation of its own."},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const attachment_dish_wall_0 = null;
  const endpoint_dish_wall_0 = makeAttachmentEndpoint(attachment_dish_wall_0);
  const node_dish_wall_0 = new THREE.Group();
  node_dish_wall_0.name = "Dish rim wall__pivot";
  if (endpoint_dish_wall_0) {
    node_dish_wall_0.position.copy(endpoint_dish_wall_0.start);
    node_dish_wall_0.rotation.set(0, 0, 0);
    node_dish_wall_0.scale.set(1, 1, 1);
  } else {
    node_dish_wall_0.position.set(0.0, 0.0, 0.0);
    node_dish_wall_0.rotation.set(0.0, 0.0, 0.0);
    node_dish_wall_0.scale.set(1.0, 1.0, 1.0);
  }
  node_dish_wall_0.userData.sculptComponent = {"id": "dish-wall", "name": "Dish rim wall", "level": "macro", "role": "shell", "importance": 1.0, "confidence": 0.85, "primitive": "extrude", "topologyClass": "continuous-sculpt", "topologyRationale": "One smoothly varying moulded wall with no flat face and no crease: the reference shows the outer surface rolling continuously from the rim crown down and under, so it is a continuous form rather than an assembly of panels.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(60, 138, 214, 1.0)", "secondaryAlbedo": "rgba(54, 124, 192, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "stadium ring swept vertically, rolled inward at both the crown and the base so the section is a rounded moulded rim", "edgeTreatment": {"type": "rolled", "bevelRadius": 0.0, "segments": 1}, "deformationStack": ["crown roll inward 0.0268", "base tuck inward 0.0268"], "uvStrategy": "ExtrudeGeometry cap and wall UVs; one tile per part", "normalStrategy": "welded vertices then smooth vertex normals; the reference has no crease", "profile2D": {"points": [[0.102, -0.248], [0.15719, -0.24178], [0.2096, -0.22344], [0.25663, -0.19389], [0.29589, -0.15463], [0.32544, -0.1076], [0.34378, -0.05519], [0.35, 0.0], [0.34378, 0.05519], [0.32544, 0.1076], [0.29589, 0.15463], [0.25663, 0.19389], [0.2096, 0.22344], [0.15719, 0.24178], [0.102, 0.248], [-0.102, 0.248], [-0.15719, 0.24178], [-0.2096, 0.22344], [-0.25663, 0.19389], [-0.29589, 0.15463], [-0.32544, 0.1076], [-0.34378, 0.05519], [-0.35, 0.0], [-0.34378, -0.05519], [-0.32544, -0.1076], [-0.29589, -0.15463], [-0.25663, -0.19389], [-0.2096, -0.22344], [-0.15719, -0.24178], [-0.102, -0.248]], "depth": 0.129, "axis": "y", "axisOffset": 0.0, "steps": 12, "profileStops": [[0.0, 0.9234, 0.8919], [0.0533, 0.9617, 0.946], [0.1067, 0.9897, 0.9855], [0.16, 1.0, 1.0], [0.84, 1.0, 1.0], [0.8933, 0.9897, 0.9855], [0.9467, 0.9617, 0.946], [1.0, 0.9234, 0.8919]], "holes": [[[0.102, -0.1993], [0.14635, -0.1943], [0.18847, -0.17956], [0.22626, -0.15582], [0.25782, -0.12426], [0.28156, -0.08647], [0.2963, -0.04435], [0.3013, 0.0], [0.2963, 0.04435], [0.28156, 0.08647], [0.25782, 0.12426], [0.22626, 0.15582], [0.18847, 0.17956], [0.14635, 0.1943], [0.102, 0.1993], [-0.102, 0.1993], [-0.14635, 0.1943], [-0.18847, 0.17956], [-0.22626, 0.15582], [-0.25782, 0.12426], [-0.28156, 0.08647], [-0.2963, 0.04435], [-0.3013, 0.0], [-0.2963, -0.04435], [-0.28156, -0.08647], [-0.25782, -0.12426], [-0.22626, -0.15582], [-0.18847, -0.17956], [-0.14635, -0.1943], [-0.102, -0.1993]]], "smoothShading": true}}, "parent": null, "attachment": null, "dimensions": {"width": 0.7, "height": 0.129, "depth": 0.496, "units": "world", "confidence": 0.75}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0.0, 0.0645, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "dish-base", "localPosition": [0.0, 0.0, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Underside of the dish; sits on the floor plane."}, {"id": "bar-seat", "localPosition": [0.0, 0.0581, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Centre of the interior floor, where the bar rests."}], "collider": {"type": "box", "offset": [0.0, 0.0645, 0.0], "scale": [0.7, 0.129, 0.496], "isTrigger": false, "notes": "Box proxy over the dish. The soap-slick trap is a distance trigger and adds no collider of its own."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "dish", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "dish-blue", "materialLayers": ["dish-blue"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rim-roll-over", "description": "The wall's plan rolls inward by 0.0268 units over the top of the extrusion, so the crown is a continuous curve rather than a chamfer.", "geometry": "profileStops easing on a quarter cosine over the last sixth of the sweep", "evidenceRefs": ["full-object", "rim-zone"], "confidence": 0.85}, {"id": "outer-tuck", "description": "The wall tucks inward by the same 0.0268 at the base, which is why the bottom silhouette curves in rather than meeting the ground square.", "geometry": "mirrored profileStops at the start of the sweep", "evidenceRefs": ["full-object", "rim-zone"], "confidence": 0.8}, {"id": "inner-wall", "description": "The opening is a stadium 0.6026 by 0.3986, which is the outer plan inset by the measured wall thickness of 0.0487 on every side.", "geometry": "profile2D hole sharing the outer plan's stadium construction", "evidenceRefs": ["full-object", "interior-zone"], "confidence": 0.85}, {"id": "stadium-plan", "description": "The plan is a stadium, not an ellipse: the reference's long sides run straight for about 30 percent of the length before the end caps begin.", "geometry": "stadium outline of a rectangle capped by two semicircles", "evidenceRefs": ["full-object"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.58, "microRoughness": 0.09, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded polypropylene with slight tone drift", "displacementPattern": "none", "occlusionPattern": "occlusion down the inner wall and under the outer tuck", "edgeWearPattern": "none - the reference dish shows no wear", "notes": "Matte plastic. No specular coat anywhere in the reference."}, "evidenceRefs": ["full-object", "rim-zone", "interior-zone"], "details": [], "fidelityTier": "blockout"};
  node_dish_wall_0.userData.actionProfile = node_dish_wall_0.userData.sculptComponent.actionProfile;
  (nodes["root"] ?? root).add(node_dish_wall_0);
  nodes["dish-wall"] = node_dish_wall_0;
  const mesh_dish_wall_0Geometry = endpoint_dish_wall_0
    ? new THREE.CylinderGeometry(endpoint_dish_wall_0.endRadius, endpoint_dish_wall_0.baseRadius, endpoint_dish_wall_0.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0.102, -0.248], [0.15719, -0.24178], [0.2096, -0.22344], [0.25663, -0.19389], [0.29589, -0.15463], [0.32544, -0.1076], [0.34378, -0.05519], [0.35, 0.0], [0.34378, 0.05519], [0.32544, 0.1076], [0.29589, 0.15463], [0.25663, 0.19389], [0.2096, 0.22344], [0.15719, 0.24178], [0.102, 0.248], [-0.102, 0.248], [-0.15719, 0.24178], [-0.2096, 0.22344], [-0.25663, 0.19389], [-0.29589, 0.15463], [-0.32544, 0.1076], [-0.34378, 0.05519], [-0.35, 0.0], [-0.34378, -0.05519], [-0.32544, -0.1076], [-0.29589, -0.15463], [-0.25663, -0.19389], [-0.2096, -0.22344], [-0.15719, -0.24178], [-0.102, -0.248]], "depth": 0.129, "axis": "y", "axisOffset": 0.0, "steps": 12, "profileStops": [[0.0, 0.9234, 0.8919], [0.0533, 0.9617, 0.946], [0.1067, 0.9897, 0.9855], [0.16, 1.0, 1.0], [0.84, 1.0, 1.0], [0.8933, 0.9897, 0.9855], [0.9467, 0.9617, 0.946], [1.0, 0.9234, 0.8919]], "holes": [[[0.102, -0.1993], [0.14635, -0.1943], [0.18847, -0.17956], [0.22626, -0.15582], [0.25782, -0.12426], [0.28156, -0.08647], [0.2963, -0.04435], [0.3013, 0.0], [0.2963, 0.04435], [0.28156, 0.08647], [0.25782, 0.12426], [0.22626, 0.15582], [0.18847, 0.17956], [0.14635, 0.1943], [0.102, 0.1993], [-0.102, 0.1993], [-0.14635, 0.1943], [-0.18847, 0.17956], [-0.22626, 0.15582], [-0.25782, 0.12426], [-0.28156, 0.08647], [-0.2963, 0.04435], [-0.3013, 0.0], [-0.2963, -0.04435], [-0.28156, -0.08647], [-0.25782, -0.12426], [-0.22626, -0.15582], [-0.18847, -0.17956], [-0.14635, -0.1943], [-0.102, -0.1993]]], "smoothShading": true});
  const mesh_dish_wall_0 = new THREE.Mesh(
    mesh_dish_wall_0Geometry,
    materialMap["dish-blue"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_dish_wall_0.name = "Dish rim wall";
  if (endpoint_dish_wall_0) {
    mesh_dish_wall_0.position.copy(endpoint_dish_wall_0.midpoint);
    mesh_dish_wall_0.quaternion.copy(endpoint_dish_wall_0.quaternion);
  }
  mesh_dish_wall_0.castShadow = options.castShadow ?? true;
  mesh_dish_wall_0.receiveShadow = options.receiveShadow ?? true;
  mesh_dish_wall_0.userData.sculptComponent = node_dish_wall_0.userData.sculptComponent;
  node_dish_wall_0.add(mesh_dish_wall_0);
  meshes["dish-wall"] = mesh_dish_wall_0;
  colliders["dish-wall"] = {"type": "box", "offset": [0.0, 0.0645, 0.0], "scale": [0.7, 0.129, 0.496], "isTrigger": false, "notes": "Box proxy over the dish. The soap-slick trap is a distance trigger and adds no collider of its own."};
  destructionGroups["dish"] ??= [];
  destructionGroups["dish"].push(node_dish_wall_0);
  const socket_dish_wall_dish_base_0 = new THREE.Object3D();
  socket_dish_wall_dish_base_0.name = "dish-base";
  socket_dish_wall_dish_base_0.position.set(0.0, 0.0, 0.0);
  socket_dish_wall_dish_base_0.rotation.set(0.0, 0.0, 0.0);
  socket_dish_wall_dish_base_0.userData.socket = {"id": "dish-base", "localPosition": [0.0, 0.0, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Underside of the dish; sits on the floor plane."};
  node_dish_wall_0.add(socket_dish_wall_dish_base_0);
  sockets["dish-wall:dish-base"] = socket_dish_wall_dish_base_0;
  const socket_dish_wall_bar_seat_1 = new THREE.Object3D();
  socket_dish_wall_bar_seat_1.name = "bar-seat";
  socket_dish_wall_bar_seat_1.position.set(0.0, 0.0581, 0.0);
  socket_dish_wall_bar_seat_1.rotation.set(0.0, 0.0, 0.0);
  socket_dish_wall_bar_seat_1.userData.socket = {"id": "bar-seat", "localPosition": [0.0, 0.0581, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Centre of the interior floor, where the bar rests."};
  node_dish_wall_0.add(socket_dish_wall_bar_seat_1);
  sockets["dish-wall:bar-seat"] = socket_dish_wall_bar_seat_1;

  const attachment_dish_floor_1 = null;
  const endpoint_dish_floor_1 = makeAttachmentEndpoint(attachment_dish_floor_1);
  const node_dish_floor_1 = new THREE.Group();
  node_dish_floor_1.name = "Dish floor__pivot";
  if (endpoint_dish_floor_1) {
    node_dish_floor_1.position.copy(endpoint_dish_floor_1.start);
    node_dish_floor_1.rotation.set(0, 0, 0);
    node_dish_floor_1.scale.set(1, 1, 1);
  } else {
    node_dish_floor_1.position.set(0.0, 0.0, 0.0);
    node_dish_floor_1.rotation.set(0.0, 0.0, 0.0);
    node_dish_floor_1.scale.set(1.0, 1.0, 1.0);
  }
  node_dish_floor_1.userData.sculptComponent = {"id": "dish-floor", "name": "Dish floor", "level": "meso", "role": "floor", "importance": 0.4, "confidence": 0.5, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A flat rigid plate closing the bottom of the dish; it has one visible planar face, which is why it is a plate rather than part of the sculpted wall.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(60, 138, 214, 1.0)", "secondaryAlbedo": "rgba(55, 126, 196, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "flat stadium plate closing the dish, overlapping the wall so no gap opens at the join", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "ExtrudeGeometry cap UVs", "normalStrategy": "flat facet normals", "profile2D": {"points": [[0.102, -0.23826], [0.15502, -0.23229], [0.20538, -0.21466], [0.25055, -0.18628], [0.28828, -0.14855], [0.31666, -0.10338], [0.33429, -0.05302], [0.34026, 0.0], [0.33429, 0.05302], [0.31666, 0.10338], [0.28828, 0.14855], [0.25055, 0.18628], [0.20538, 0.21466], [0.15502, 0.23229], [0.102, 0.23826], [-0.102, 0.23826], [-0.15502, 0.23229], [-0.20538, 0.21466], [-0.25055, 0.18628], [-0.28828, 0.14855], [-0.31666, 0.10338], [-0.33429, 0.05302], [-0.34026, 0.0], [-0.33429, -0.05302], [-0.31666, -0.10338], [-0.28828, -0.14855], [-0.25055, -0.18628], [-0.20538, -0.21466], [-0.15502, -0.23229], [-0.102, -0.23826]], "depth": 0.0581, "axis": "y", "axisOffset": 0.0}}, "parent": "dish-wall", "attachment": null, "dimensions": {"width": 0.6026, "height": 0.0581, "depth": 0.3986, "units": "world", "confidence": 0.5}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.02905, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "dish", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "dish-blue", "materialLayers": ["dish-blue"], "deformations": [], "joints": [], "seams": [{"id": "floor-wall-seam", "with": "dish-wall", "overlap": 0.039, "notes": "Plate contour is buried inside the wall."}], "localFeatures": [{"id": "floor-plate", "description": "Closes the dish 0.0709 units below the rim, which is the recess depth the reference's shadow line implies.", "geometry": "plate wider than the opening so it is buried in the wall", "evidenceRefs": ["full-object", "interior-zone"], "confidence": 0.5}], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.08, "bumpAmplitude": 0.0, "normalPattern": "matte moulded plastic", "displacementPattern": "none", "occlusionPattern": "deep occlusion where it meets the wall", "edgeWearPattern": "none", "notes": "Not directly observed: the bar covers most of it in the reference."}, "evidenceRefs": ["full-object", "interior-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_dish_floor_1.userData.actionProfile = node_dish_floor_1.userData.sculptComponent.actionProfile;
  (nodes["dish-wall"] ?? root).add(node_dish_floor_1);
  nodes["dish-floor"] = node_dish_floor_1;
  const mesh_dish_floor_1Geometry = endpoint_dish_floor_1
    ? new THREE.CylinderGeometry(endpoint_dish_floor_1.endRadius, endpoint_dish_floor_1.baseRadius, endpoint_dish_floor_1.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0.102, -0.23826], [0.15502, -0.23229], [0.20538, -0.21466], [0.25055, -0.18628], [0.28828, -0.14855], [0.31666, -0.10338], [0.33429, -0.05302], [0.34026, 0.0], [0.33429, 0.05302], [0.31666, 0.10338], [0.28828, 0.14855], [0.25055, 0.18628], [0.20538, 0.21466], [0.15502, 0.23229], [0.102, 0.23826], [-0.102, 0.23826], [-0.15502, 0.23229], [-0.20538, 0.21466], [-0.25055, 0.18628], [-0.28828, 0.14855], [-0.31666, 0.10338], [-0.33429, 0.05302], [-0.34026, 0.0], [-0.33429, -0.05302], [-0.31666, -0.10338], [-0.28828, -0.14855], [-0.25055, -0.18628], [-0.20538, -0.21466], [-0.15502, -0.23229], [-0.102, -0.23826]], "depth": 0.0581, "axis": "y", "axisOffset": 0.0});
  const mesh_dish_floor_1 = new THREE.Mesh(
    mesh_dish_floor_1Geometry,
    materialMap["dish-blue"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_dish_floor_1.name = "Dish floor";
  if (endpoint_dish_floor_1) {
    mesh_dish_floor_1.position.copy(endpoint_dish_floor_1.midpoint);
    mesh_dish_floor_1.quaternion.copy(endpoint_dish_floor_1.quaternion);
  }
  mesh_dish_floor_1.castShadow = options.castShadow ?? true;
  mesh_dish_floor_1.receiveShadow = options.receiveShadow ?? true;
  mesh_dish_floor_1.userData.sculptComponent = node_dish_floor_1.userData.sculptComponent;
  node_dish_floor_1.add(mesh_dish_floor_1);
  meshes["dish-floor"] = mesh_dish_floor_1;
  colliders["dish-floor"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["dish"] ??= [];
  destructionGroups["dish"].push(node_dish_floor_1);

  const attachment_soap_bar_2 = null;
  const endpoint_soap_bar_2 = makeAttachmentEndpoint(attachment_soap_bar_2);
  const node_soap_bar_2 = new THREE.Group();
  node_soap_bar_2.name = "Soap bar__pivot";
  if (endpoint_soap_bar_2) {
    node_soap_bar_2.position.copy(endpoint_soap_bar_2.start);
    node_soap_bar_2.rotation.set(0, 0, 0);
    node_soap_bar_2.scale.set(1, 1, 1);
  } else {
    node_soap_bar_2.position.set(0.0, 0.0, 0.0);
    node_soap_bar_2.rotation.set(0.0, 0.0, 0.0);
    node_soap_bar_2.scale.set(1.0, 1.0, 1.0);
  }
  node_soap_bar_2.userData.sculptComponent = {"id": "soap-bar", "name": "Soap bar", "level": "meso", "role": "contents", "importance": 0.9, "confidence": 0.8, "primitive": "extrude", "topologyClass": "continuous-sculpt", "topologyRationale": "One smoothly varying rounded mass with no flat face and no crease anywhere: a cast pillow, not a box with bevels.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(251, 243, 228, 1.0)", "secondaryAlbedo": "rgba(225, 218, 205, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "stadium plan swept vertically and rolled inward at both ends over most of the sweep, giving a pillow whose top and bottom are domed", "edgeTreatment": {"type": "rolled", "bevelRadius": 0.0, "segments": 1}, "deformationStack": ["crown dome", "base dome"], "uvStrategy": "ExtrudeGeometry cap and wall UVs", "normalStrategy": "welded vertices then smooth vertex normals", "profile2D": {"points": [[0.10235, -0.15375], [0.13656, -0.1499], [0.16906, -0.13852], [0.19821, -0.12021], [0.22256, -0.09586], [0.24087, -0.06671], [0.25225, -0.03421], [0.2561, 0.0], [0.25225, 0.03421], [0.24087, 0.06671], [0.22256, 0.09586], [0.19821, 0.12021], [0.16906, 0.13852], [0.13656, 0.1499], [0.10235, 0.15375], [-0.10235, 0.15375], [-0.13656, 0.1499], [-0.16906, 0.13852], [-0.19821, 0.12021], [-0.22256, 0.09586], [-0.24087, 0.06671], [-0.25225, 0.03421], [-0.2561, 0.0], [-0.25225, -0.03421], [-0.24087, -0.06671], [-0.22256, -0.09586], [-0.19821, -0.12021], [-0.16906, -0.13852], [-0.13656, -0.1499], [-0.10235, -0.15375]], "depth": 0.1259, "axis": "y", "axisOffset": 0.0521, "steps": 14, "profileStops": [[0.0, 0.6398, 0.4], [0.07, 0.733, 0.5553], [0.14, 0.8199, 0.7], [0.21, 0.8945, 0.8243], [0.28, 0.9517, 0.9196], [0.35, 0.9877, 0.9796], [0.42, 1.0, 1.0], [0.58, 1.0, 1.0], [0.65, 0.9877, 0.9796], [0.72, 0.9517, 0.9196], [0.79, 0.8945, 0.8243], [0.86, 0.8199, 0.7], [0.93, 0.733, 0.5553], [1.0, 0.6398, 0.4]], "smoothShading": true}}, "parent": "dish-wall", "attachment": null, "dimensions": {"width": 0.5122, "height": 0.1259, "depth": 0.3075, "units": "world", "confidence": 0.7}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "socket", "localPosition": [0.0, 0.1151, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "bar-crown", "localPosition": [0.0, 0.178, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Top of the bar; a lather or bubble effect anchors here."}], "collider": {"type": "box", "offset": [0.0, 0.1151, 0.0], "scale": [0.5122, 0.1259, 0.3075], "isTrigger": false, "notes": "Box proxy over the bar."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bar", "seamRefs": [], "detachableFragments": ["soap-bar"], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "bar-cream", "materialLayers": ["bar-cream"], "deformations": [], "joints": [], "seams": [{"id": "bar-floor-seam", "with": "dish-floor", "overlap": 0.006, "notes": "Bar base is buried in the floor plate."}], "localFeatures": [{"id": "pillow-crown", "description": "The bar's plan rolls inward over the top 6 sweep samples so the crown is domed; the reference shows no flat top and no edge anywhere on it.", "geometry": "profileStops easing on a quarter cosine at both ends of the extrusion", "evidenceRefs": ["full-object", "bar-zone"], "confidence": 0.85}, {"id": "dish-contact", "description": "The bar is buried 0.006 units into the dish floor so no gap can open under it, and it stands 0.049 units above the rim, which is what the reference shows.", "geometry": "component position, not geometry", "evidenceRefs": ["full-object", "interior-zone"], "confidence": 0.8}, {"id": "bar-proportion", "description": "The bar is 0.5122 by 0.3075 by 0.1259, which is 85 percent of the interior length: the reference bar nearly fills the dish.", "geometry": "stadium plan scaled from the measured projected extents", "evidenceRefs": ["full-object", "bar-zone"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.48, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "smooth cast soap", "displacementPattern": "none", "occlusionPattern": "contact shadow at the dish floor", "edgeWearPattern": "none", "notes": "The brightest and smoothest surface in the frame."}, "evidenceRefs": ["full-object", "bar-zone"], "details": [], "fidelityTier": "blockout"};
  node_soap_bar_2.userData.actionProfile = node_soap_bar_2.userData.sculptComponent.actionProfile;
  (nodes["dish-wall"] ?? root).add(node_soap_bar_2);
  nodes["soap-bar"] = node_soap_bar_2;
  const mesh_soap_bar_2Geometry = endpoint_soap_bar_2
    ? new THREE.CylinderGeometry(endpoint_soap_bar_2.endRadius, endpoint_soap_bar_2.baseRadius, endpoint_soap_bar_2.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0.10235, -0.15375], [0.13656, -0.1499], [0.16906, -0.13852], [0.19821, -0.12021], [0.22256, -0.09586], [0.24087, -0.06671], [0.25225, -0.03421], [0.2561, 0.0], [0.25225, 0.03421], [0.24087, 0.06671], [0.22256, 0.09586], [0.19821, 0.12021], [0.16906, 0.13852], [0.13656, 0.1499], [0.10235, 0.15375], [-0.10235, 0.15375], [-0.13656, 0.1499], [-0.16906, 0.13852], [-0.19821, 0.12021], [-0.22256, 0.09586], [-0.24087, 0.06671], [-0.25225, 0.03421], [-0.2561, 0.0], [-0.25225, -0.03421], [-0.24087, -0.06671], [-0.22256, -0.09586], [-0.19821, -0.12021], [-0.16906, -0.13852], [-0.13656, -0.1499], [-0.10235, -0.15375]], "depth": 0.1259, "axis": "y", "axisOffset": 0.0521, "steps": 14, "profileStops": [[0.0, 0.6398, 0.4], [0.07, 0.733, 0.5553], [0.14, 0.8199, 0.7], [0.21, 0.8945, 0.8243], [0.28, 0.9517, 0.9196], [0.35, 0.9877, 0.9796], [0.42, 1.0, 1.0], [0.58, 1.0, 1.0], [0.65, 0.9877, 0.9796], [0.72, 0.9517, 0.9196], [0.79, 0.8945, 0.8243], [0.86, 0.8199, 0.7], [0.93, 0.733, 0.5553], [1.0, 0.6398, 0.4]], "smoothShading": true});
  const mesh_soap_bar_2 = new THREE.Mesh(
    mesh_soap_bar_2Geometry,
    materialMap["bar-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_soap_bar_2.name = "Soap bar";
  if (endpoint_soap_bar_2) {
    mesh_soap_bar_2.position.copy(endpoint_soap_bar_2.midpoint);
    mesh_soap_bar_2.quaternion.copy(endpoint_soap_bar_2.quaternion);
  }
  mesh_soap_bar_2.castShadow = options.castShadow ?? true;
  mesh_soap_bar_2.receiveShadow = options.receiveShadow ?? true;
  mesh_soap_bar_2.userData.sculptComponent = node_soap_bar_2.userData.sculptComponent;
  node_soap_bar_2.add(mesh_soap_bar_2);
  meshes["soap-bar"] = mesh_soap_bar_2;
  colliders["soap-bar"] = {"type": "box", "offset": [0.0, 0.1151, 0.0], "scale": [0.5122, 0.1259, 0.3075], "isTrigger": false, "notes": "Box proxy over the bar."};
  destructionGroups["bar"] ??= [];
  destructionGroups["bar"].push(node_soap_bar_2);
  const socket_soap_bar_bar_crown_0 = new THREE.Object3D();
  socket_soap_bar_bar_crown_0.name = "bar-crown";
  socket_soap_bar_bar_crown_0.position.set(0.0, 0.178, 0.0);
  socket_soap_bar_bar_crown_0.rotation.set(0.0, 0.0, 0.0);
  socket_soap_bar_bar_crown_0.userData.socket = {"id": "bar-crown", "localPosition": [0.0, 0.178, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Top of the bar; a lather or bubble effect anchors here."};
  node_soap_bar_2.add(socket_soap_bar_bar_crown_0);
  sockets["soap-bar:bar-crown"] = socket_soap_bar_bar_crown_0;

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 256, "preferredTextureResolution": 1024, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "ranAnyway": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars."}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness, height, normal or AO", "single-frequency random noise", "glossy toy-plastic highlights on a matte moulded surface", "local colour described only in prose without material masks", "claiming exact PBR recovery from one image"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare the albedo palette and the local colour zones.", "Compare roughness and normal response under the key light.", "Compare contact darkening, seam occlusion and crown polish.", "Compare key, fill and rim structure, exposure, tone mapping and background.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals and uniform roughness.", "Capture a reference-matched render from the solved camera."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createApartmentSoapDishLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Apartment Soap Dish look-dev lights";
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
  lights.userData.lightingFromPhoto = ["Ambient dominance: the reference is a soft studio render. The dish's lit crown reads (64,148,229) and its shaded inner wall (26,101,174), a range a bright neutral hemisphere plus a gentle key reproduces without a hard terminator anywhere.", "Key light: a warm-neutral directional source at about 1.15 from high and camera left. It only has to lift the bar's crown to (255,251,242), about 8 percent above its flanks.", "Rim and environment light: weak neutral back light at about 0.3, enough to keep the far rim from crushing. No environment map: the reference shows no reflected detail.", "Exposure and tone mapping: ACES filmic tone mapping with sRGB output at exposure 1.0.", "Contact shadow: interior ambient occlusion plus the bar's contact ring. The reference dish floats with no ground contact, so the review render has no ground plane and the silhouette mask stays clean."];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 256, "preferredTextureResolution": 1024, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "ranAnyway": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars."}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness, height, normal or AO", "single-frequency random noise", "glossy toy-plastic highlights on a matte moulded surface", "local colour described only in prose without material masks", "claiming exact PBR recovery from one image"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare the albedo palette and the local colour zones.", "Compare roughness and normal response under the key light.", "Compare contact darkening, seam occlusion and crown polish.", "Compare key, fill and rim structure, exposure, tone mapping and background.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals and uniform roughness.", "Capture a reference-matched render from the solved camera."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createApartmentSoapDishEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
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
export function frameApartmentSoapDishCamera(
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
export function createApartmentSoapDishPresentationComposer(
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

export function configureApartmentSoapDishRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createApartmentSoapDishInspectControls(
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
