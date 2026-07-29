// --- img2threejs refine-code edits applied by assets/reference/toaster/apply_refinements.py
// 1. buildExtrudeGeometry honours profile2D.steps / profileStops / profileExempt /
//    axis / axisOffset so the spec's tapered chamfer-box geometry is buildable.
// 2. the cavity-element-tabs InstancedMesh uses the spec's explicit row placement.
// 3. flat-shaded boxes drop from 12x12x12 segments to 1x1x1 (78k triangles -> 2.3k).
// 4. SculptMaterialSpec gets a real type; non-null assertions where the generator
//    indexes arrays, both for the project's strict tsconfig and eslint settings.
// 5. duplicated userData payloads become references (29% smaller file, same API).
// Re-apply with: python assets/reference/toaster/apply_refinements.py
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

// The nested shapes keep their own index signature so a spec literal carrying extra keys
// is not rejected as an excess property.
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
};

// A straight prism is not the reference shape: the shell tapers as it rises and then
// breaks into a wide chamfer band under the top deck, and the plinth bevels at both
// edges. profileStops are [t, scaleX, scaleY] samples along the extrusion; each vertex
// is scaled in the shape plane by the interpolated pair. profileExempt names shape-plane
// half-extents the profile must leave alone, which is what keeps the slot bore at a
// constant section while the outer wall around it tapers.
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

// axis/axisOffset bake orientation and placement into the geometry so every component
// node can stay at the world origin with an identity rotation. That keeps parent frames
// world-aligned, which is what lets the lever neck and the dial pointer be plain children
// of the parts they ride on.
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
  // Non-indexed after the deformation, so this gives one normal per facet - the hard
  // creases the reference shows, not a smoothed shell.
  geometry.computeVertexNormals();
  return geometry;
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

// Generated from ObjectSculptSpec target: Apartment Toaster
// Sculpt build pass: optimization-pass
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createApartmentToasterModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Apartment Toaster";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": true, "solveMethod": "azimuth from facet-width ratios on the reference silhouette; elevation and vertical proportion from a rendered sweep scored by Tier-1 silhouette IoU", "fovDegrees": 28.0, "aspect": 1.0, "orientation": {"yaw": 41.0, "pitch": -19.0, "roll": 0.0}, "targetHint": [0.0, 0.62, 0.0], "note": "Azimuth 41 degrees comes from the measured screen widths of the front face (462 px), the corner chamfer facet (187 px) and the right face (310 px), which give tan(azimuth) = 0.87. The first elevation estimate from top-face edge slopes was 13 degrees and proved wrong; a 15-position sweep over elevation and vertical scale, scored by silhouette IoU, settled on 19 degrees with the model 14 percent shorter than the first estimate (IoU 0.932, aspect delta 0.000, scale delta 0.000). Distance is not fixed here: the preview harness solves it by fitting the render's projected bounding box to the reference bounding box (x 96-1149, y 130-1156 of 1254)."}, "approximationNotes": []};

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["shell-cream"] = createSculptMaterial(
    "shell-cream",
    {"id": "shell-cream", "name": "Cream shell plastic", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#EDE0C8", "color": "#EDE0C8", "albedo": {"dominant": "#EDE0C8", "secondary": ["#E7D9C0", "#F2E6D2"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#EDE0C8", "#E7D9C0", "#F2E6D2"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.72, "variation": 0.1, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; chamfer crowns trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.22, "contactShadowBias": 0.3, "notes": "Darken the slot pocket, the lever channel, the plinth seam, and the dial undercut."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "chamfer-crown-sheen", "target": "body-shell/plan-chamfer-facets", "roughness": 0.66, "mask": "chamfer facets only", "notes": "Mould tooling polishes the narrow 45 degree facets slightly smoother than the broad faces.", "evidenceRefs": ["full-object", "front-facet-zone"]}, {"id": "plinth-seam-shadow", "target": "body-shell/plinth-seam", "roughness": 0.78, "aoBoost": 0.35, "mask": "lowest 0.05 units of the wall", "notes": "Contact darkening where the shell meets the coral plinth.", "evidenceRefs": ["full-object", "base-plinth-zone"]}, {"id": "control-plate-edge", "target": "control-plate/raised-pad-edge", "roughness": 0.7, "aoBoost": 0.22, "mask": "raised dial pad outline", "notes": "Shallow step around the dial pad reads as a soft outline, not a painted line.", "evidenceRefs": ["full-object", "right-control-zone"]}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\toaster\\evidence\\crops\\shell-cream-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.842, "estimatedFidelity": 0.842, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. The reference is a flat-paint stylised render with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the asset stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars below.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\toaster\\evidence\\pbr\\shell-cream_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\toaster\\evidence\\pbr\\shell-cream_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\toaster\\evidence\\pbr\\shell-cream_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\toaster\\evidence\\pbr\\shell-cream_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\toaster\\evidence\\pbr\\shell-cream_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "Cream body, top deck, lever collar and dial pad. Matte, no coat."},
    options
  );
  materialMap["accent-coral"] = createSculptMaterial(
    "accent-coral",
    {"id": "accent-coral", "name": "Coral accent plastic", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#DE554D", "color": "#DE554D", "albedo": {"dominant": "#DE554D", "secondary": ["#D44E46", "#E75F57"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#DE554D", "#D44E46", "#E75F57"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.7, "variation": 0.1, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; chamfer crowns trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.24, "contactShadowBias": 0.3, "notes": "Darken the slot pocket, the lever channel, the plinth seam, and the dial undercut."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "bezel-crown-highlight", "target": "top-bezel/proud-lip-step", "roughness": 0.63, "mask": "bezel crown chamfer", "notes": "The proud bezel crown catches the key light more than the surrounding deck.", "evidenceRefs": ["full-object", "top-slot-zone"]}, {"id": "plinth-underside-dirt", "target": "base-plinth/overhang-ledge", "roughness": 0.8, "dirt": 0.1, "mask": "underside of the plinth overhang", "notes": "Cavity dirt collects under the overhang where it is never wiped.", "evidenceRefs": ["full-object", "base-plinth-zone"]}, {"id": "tick-mark-edges", "target": "control-plate/tick-arc", "roughness": 0.68, "aoBoost": 0.3, "mask": "tick mark footprints", "notes": "Each tick is a raised nub, so its base carries a contact-occlusion ring.", "evidenceRefs": ["full-object", "right-control-zone"]}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\toaster\\evidence\\crops\\accent-coral-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.848, "estimatedFidelity": 0.848, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. The reference is a flat-paint stylised render with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the asset stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars below.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\toaster\\evidence\\pbr\\accent-coral_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\toaster\\evidence\\pbr\\accent-coral_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\toaster\\evidence\\pbr\\accent-coral_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\toaster\\evidence\\pbr\\accent-coral_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\toaster\\evidence\\pbr\\accent-coral_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "Bezel ring, base plinth, dial knob and dial tick marks."},
    options
  );
  materialMap["lever-yellow"] = createSculptMaterial(
    "lever-yellow",
    {"id": "lever-yellow", "name": "Yellow lever plastic", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#F7C244", "color": "#F7C244", "albedo": {"dominant": "#F7C244", "secondary": ["#EFB93B", "#FBCB53"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#F7C244", "#EFB93B", "#FBCB53"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.68, "variation": 0.09, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; chamfer crowns trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.22, "contactShadowBias": 0.3, "notes": "Darken the slot pocket, the lever channel, the plinth seam, and the dial undercut."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "knob-chamfer-wear", "target": "lever-knob/knob-chamfers", "roughness": 0.6, "edgeWear": 0.12, "mask": "knob chamfer facets", "notes": "The knob is the only part a hand touches, so its chamfers polish first.", "evidenceRefs": ["full-object", "right-control-zone"]}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\toaster\\evidence\\crops\\lever-yellow-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.723, "estimatedFidelity": 0.723, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. The reference is a flat-paint stylised render with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the asset stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars below.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\toaster\\evidence\\pbr\\lever-yellow_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\toaster\\evidence\\pbr\\lever-yellow_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\toaster\\evidence\\pbr\\lever-yellow_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\toaster\\evidence\\pbr\\lever-yellow_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\toaster\\evidence\\pbr\\lever-yellow_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "Carriage lever knob and its neck. Slightly smoother than the shell from handling."},
    options
  );
  materialMap["cavity-gray"] = createSculptMaterial(
    "cavity-gray",
    {"id": "cavity-gray", "name": "Slot cavity interior", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#615F5C", "color": "#615F5C", "albedo": {"dominant": "#615F5C", "secondary": ["#55534F", "#6D6B67"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#615F5C", "#55534F", "#6D6B67"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.84, "variation": 0.08, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; chamfer crowns trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.34, "contactShadowBias": 0.3, "notes": "Darken the slot pocket, the lever channel, the plinth seam, and the dial undercut."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "pocket-depth-gradient", "target": "slot-cavity/pocket-walls", "roughness": 0.9, "aoBoost": 0.65, "mask": "lower two thirds of the pocket wall", "notes": "Light falls off sharply down the slot, so the pocket darkens with depth.", "evidenceRefs": ["full-object", "top-slot-zone"]}, {"id": "element-tab-scorch", "target": "slot-cavity/element-tab-rows", "roughness": 0.92, "dirt": 0.18, "mask": "element tab faces", "notes": "Tabs sit next to the elements and read darker and rougher than the walls.", "evidenceRefs": ["full-object", "top-slot-zone"]}, {"id": "lever-slot-shadow", "target": "lever-track/recessed-channel", "roughness": 0.88, "aoBoost": 0.55, "mask": "channel floor", "notes": "The channel floor is the darkest value on the right face.", "evidenceRefs": ["full-object", "right-control-zone"]}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\toaster\\evidence\\crops\\cavity-gray-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.826, "estimatedFidelity": 0.826, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. The reference is a flat-paint stylised render with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the asset stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars below.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\toaster\\evidence\\pbr\\cavity-gray_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\toaster\\evidence\\pbr\\cavity-gray_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\toaster\\evidence\\pbr\\cavity-gray_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\toaster\\evidence\\pbr\\cavity-gray_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\toaster\\evidence\\pbr\\cavity-gray_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "Slot pocket walls, floor, divider, element tabs and the lever channel floor. This albedo is darker than a de-lit sample of the reference pocket suggests, deliberately: procedural AO cannot reproduce a real pocket's occlusion, so the albedo carries part of that darkening. The rendered pocket then lands on the reference's measured (98, 94, 82)."},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const attachment_body_shell_0 = null;
  const endpoint_body_shell_0 = makeAttachmentEndpoint(attachment_body_shell_0);
  const node_body_shell_0 = new THREE.Group();
  node_body_shell_0.name = "Body shell__pivot";
  if (endpoint_body_shell_0) {
    node_body_shell_0.position.copy(endpoint_body_shell_0.start);
    node_body_shell_0.rotation.set(0, 0, 0);
    node_body_shell_0.scale.set(1, 1, 1);
  } else {
    node_body_shell_0.position.set(0.0, 0.0, 0.0);
    node_body_shell_0.rotation.set(0.0, 0.0, 0.0);
    node_body_shell_0.scale.set(1.0, 1.0, 1.0);
  }
  node_body_shell_0.userData.sculptComponent = {"id": "body-shell", "name": "Body shell", "level": "macro", "role": "shell", "importance": 1.0, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Eight flat faces you can point to and count: four broad walls and four 45 degree corner facets, meeting at hard creases with no smooth blending anywhere on the reference.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(237, 224, 200, 1.0)", "secondaryAlbedo": "rgba(226, 210, 184, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "chamfer-box shell: octagonal plan swept vertically, tapering inward, with a broad chamfer band under the top deck", "edgeTreatment": {"type": "flat-chamfer", "bevelRadius": 0.0, "segments": 1}, "deformationStack": ["vertical taper 0.03 per side", "top chamfer inset 0.11 over 0.14 height"], "uvStrategy": "ExtrudeGeometry cap and wall UVs; one tile per part", "normalStrategy": "flat facet normals recomputed after the profile deformation", "profile2D": {"points": [[0.8, -0.42], [0.8, 0.42], [0.56, 0.66], [-0.56, 0.66], [-0.8, 0.42], [-0.8, -0.42], [-0.56, -0.66], [0.56, -0.66]], "depth": 1.0492, "axis": "y", "axisOffset": 0.2236, "steps": 8, "profileStops": [[0.0, 1.0, 1.0], [0.75, 0.9625, 0.9545], [1.0, 0.775, 0.7273]], "profileExempt": [0.5449999999999999, 0.375], "holes": [[[0.485, -0.205], [0.485, 0.205], [0.375, 0.315], [-0.375, 0.315], [-0.485, 0.205], [-0.485, -0.205], [-0.375, -0.315], [0.375, -0.315]]]}}, "parent": null, "attachment": null, "dimensions": {"width": 1.6, "height": 1.0492, "depth": 1.32, "units": "world", "confidence": 0.7}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0.0, 0.7482, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "mount-base", "localPosition": [0.0, 0.0, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "World origin of the appliance; sits on the floor plane."}, {"id": "counter-contact", "localPosition": [0.0, 0.06, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Top of the rubber feet - the real contact plane."}], "collider": {"type": "box", "offset": [0.0, 0.6811, 0.0], "scale": [1.7, 1.3106, 1.42], "isTrigger": false, "notes": "Single box proxy over the whole appliance."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shell-cream"}}, "material": "shell-cream", "materialLayers": ["shell-cream"], "deformations": [], "joints": [], "seams": [{"id": "shell-plinth-seam", "with": "base-plinth", "overlap": 0.02, "notes": "Shell base is buried 0.02 units inside the plinth top."}], "localFeatures": [{"id": "plan-chamfer-facets", "description": "Four 45 degree corner facets cut the rectangular plan into an octagon; each facet is 0.24 units of cut on both plan axes and runs the full height.", "geometry": "extrude profile2D outline with eight vertices, not a rounded box", "evidenceRefs": ["full-object", "front-facet-zone"], "confidence": 0.92}, {"id": "upward-taper", "description": "The plan contracts by 0.03 units per side between the plinth seam and the top of the vertical wall, so the silhouette leans inward as it rises.", "geometry": "profileStops scale the shape-plane coordinates along the extrusion axis", "evidenceRefs": ["full-object", "front-facet-zone"], "confidence": 0.72}, {"id": "top-chamfer-band", "description": "A broad chamfer band 0.14 units tall insets the plan a further 0.11 units before the flat top deck begins.", "geometry": "final profileStop drives the extruded prism into a frustum band", "evidenceRefs": ["full-object", "top-slot-zone"], "confidence": 0.82}, {"id": "slot-bore", "description": "A chamfered rectangular bore is cut through the top deck; its walls are exempt from the taper so the opening keeps a constant section.", "geometry": "profile2D hole plus profileExempt box", "evidenceRefs": ["full-object", "top-slot-zone"], "confidence": 0.88}, {"id": "plinth-seam", "description": "The wall sinks 0.02 units into the plinth so no gap can open at the seam.", "geometry": "geometry overlap, not a butt joint", "evidenceRefs": ["full-object", "base-plinth-zone"], "confidence": 0.8}], "surfaceDetail": {"macroRoughness": 0.72, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "shallow moulding flow aligned with the extrusion axis", "displacementPattern": "none", "occlusionPattern": "crease darkening along every chamfer edge and at the plinth seam", "edgeWearPattern": "light polish on the chamfer crowns", "notes": "Matte ABS. No specular coat anywhere on the reference."}, "evidenceRefs": ["full-object", "front-facet-zone", "top-slot-zone"], "details": [], "fidelityTier": "blockout"};
  node_body_shell_0.userData.actionProfile = node_body_shell_0.userData.sculptComponent.actionProfile;
  (nodes["root"] ?? root).add(node_body_shell_0);
  nodes["body-shell"] = node_body_shell_0;
  const mesh_body_shell_0Geometry = endpoint_body_shell_0
    ? new THREE.CylinderGeometry(endpoint_body_shell_0.endRadius, endpoint_body_shell_0.baseRadius, endpoint_body_shell_0.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0.8, -0.42], [0.8, 0.42], [0.56, 0.66], [-0.56, 0.66], [-0.8, 0.42], [-0.8, -0.42], [-0.56, -0.66], [0.56, -0.66]], "depth": 1.0492, "axis": "y", "axisOffset": 0.2236, "steps": 8, "profileStops": [[0.0, 1.0, 1.0], [0.75, 0.9625, 0.9545], [1.0, 0.775, 0.7273]], "profileExempt": [0.5449999999999999, 0.375], "holes": [[[0.485, -0.205], [0.485, 0.205], [0.375, 0.315], [-0.375, 0.315], [-0.485, 0.205], [-0.485, -0.205], [-0.375, -0.315], [0.375, -0.315]]]});
  const mesh_body_shell_0 = new THREE.Mesh(
    mesh_body_shell_0Geometry,
    materialMap["shell-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_body_shell_0.name = "Body shell";
  if (endpoint_body_shell_0) {
    mesh_body_shell_0.position.copy(endpoint_body_shell_0.midpoint);
    mesh_body_shell_0.quaternion.copy(endpoint_body_shell_0.quaternion);
  }
  mesh_body_shell_0.castShadow = options.castShadow ?? true;
  mesh_body_shell_0.receiveShadow = options.receiveShadow ?? true;
  mesh_body_shell_0.userData.sculptComponent = node_body_shell_0.userData.sculptComponent;
  node_body_shell_0.add(mesh_body_shell_0);
  meshes["body-shell"] = mesh_body_shell_0;
  colliders["body-shell"] = {"type": "box", "offset": [0.0, 0.6811, 0.0], "scale": [1.7, 1.3106, 1.42], "isTrigger": false, "notes": "Single box proxy over the whole appliance."};
  destructionGroups["body-shell"] ??= [];
  destructionGroups["body-shell"].push(node_body_shell_0);
  const socket_body_shell_mount_base_0 = new THREE.Object3D();
  socket_body_shell_mount_base_0.name = "mount-base";
  socket_body_shell_mount_base_0.position.set(0.0, 0.0, 0.0);
  socket_body_shell_mount_base_0.rotation.set(0.0, 0.0, 0.0);
  socket_body_shell_mount_base_0.userData.socket = {"id": "mount-base", "localPosition": [0.0, 0.0, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "World origin of the appliance; sits on the floor plane."};
  node_body_shell_0.add(socket_body_shell_mount_base_0);
  sockets["body-shell:mount-base"] = socket_body_shell_mount_base_0;
  const socket_body_shell_counter_contact_1 = new THREE.Object3D();
  socket_body_shell_counter_contact_1.name = "counter-contact";
  socket_body_shell_counter_contact_1.position.set(0.0, 0.06, 0.0);
  socket_body_shell_counter_contact_1.rotation.set(0.0, 0.0, 0.0);
  socket_body_shell_counter_contact_1.userData.socket = {"id": "counter-contact", "localPosition": [0.0, 0.06, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Top of the rubber feet - the real contact plane."};
  node_body_shell_0.add(socket_body_shell_counter_contact_1);
  sockets["body-shell:counter-contact"] = socket_body_shell_counter_contact_1;

  const attachment_base_plinth_1 = null;
  const endpoint_base_plinth_1 = makeAttachmentEndpoint(attachment_base_plinth_1);
  const node_base_plinth_1 = new THREE.Group();
  node_base_plinth_1.name = "Base plinth__pivot";
  if (endpoint_base_plinth_1) {
    node_base_plinth_1.position.copy(endpoint_base_plinth_1.start);
    node_base_plinth_1.rotation.set(0, 0, 0);
    node_base_plinth_1.scale.set(1, 1, 1);
  } else {
    node_base_plinth_1.position.set(0.0, 0.0, 0.0);
    node_base_plinth_1.rotation.set(0.0, 0.0, 0.0);
    node_base_plinth_1.scale.set(1.0, 1.0, 1.0);
  }
  node_base_plinth_1.userData.sculptComponent = {"id": "base-plinth", "name": "Base plinth", "level": "macro", "role": "plinth", "importance": 0.9, "confidence": 0.85, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A separate rigid slab with its own flat top, flat sides and 45 degree corner facets, wider than the shell on every side and reading as a distinct moulded part in the reference.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(222, 85, 77, 1.0)", "secondaryAlbedo": "rgba(212, 78, 70, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "chamfered slab with a bevel top and bottom", "edgeTreatment": {"type": "flat-chamfer", "bevelRadius": 0.0, "segments": 1}, "deformationStack": ["bottom bevel inset 0.05", "top bevel inset 0.05"], "uvStrategy": "ExtrudeGeometry cap and wall UVs", "normalStrategy": "flat facet normals recomputed after the profile deformation", "profile2D": {"points": [[0.85, -0.43], [0.85, 0.43], [0.57, 0.71], [-0.57, 0.71], [-0.85, 0.43], [-0.85, -0.43], [-0.57, -0.71], [0.57, -0.71]], "depth": 0.1892, "axis": "y", "axisOffset": 0.0516, "steps": 4, "profileStops": [[0.0, 0.9412, 0.9296], [0.25, 1.0, 1.0], [0.75, 1.0, 1.0], [1.0, 0.9412, 0.9296]]}}, "parent": null, "attachment": null, "dimensions": {"width": 1.7, "height": 0.1892, "depth": 1.42, "units": "world", "confidence": 0.7}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.1462, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.17, 0.0], "scale": [1.7, 0.22, 1.45], "isTrigger": false, "notes": "Plinth footprint proxy."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "base-plinth", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shell-cream"}}, "material": "accent-coral", "materialLayers": ["accent-coral"], "deformations": [], "joints": [], "seams": [{"id": "plinth-shell-seam", "with": "body-shell", "overlap": 0.02, "notes": "Receives the shell base."}], "localFeatures": [{"id": "overhang-ledge", "description": "The plinth is 0.05 units wider than the shell on every side, so its top face shows as a continuous ledge around the body.", "geometry": "larger plan outline than the shell, same chamfer language", "evidenceRefs": ["full-object", "base-plinth-zone"], "confidence": 0.85}, {"id": "double-bevel-profile", "description": "Both the top and the bottom edge of the slab are bevelled inward by 0.05 units, giving the slab a three-band elevation.", "geometry": "profileStops at t=0, 0.23, 0.77 and 1.0", "evidenceRefs": ["full-object", "base-plinth-zone"], "confidence": 0.78}], "surfaceDetail": {"macroRoughness": 0.7, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat moulded coral with slight tone drift", "displacementPattern": "none", "occlusionPattern": "darkening under the overhang and in the shell seam", "edgeWearPattern": "none - the plinth shows no wear in the reference", "notes": "Same matte plastic family as the shell, saturated coral pigment."}, "evidenceRefs": ["full-object", "base-plinth-zone"], "details": [], "fidelityTier": "blockout"};
  node_base_plinth_1.userData.actionProfile = node_base_plinth_1.userData.sculptComponent.actionProfile;
  (nodes["root"] ?? root).add(node_base_plinth_1);
  nodes["base-plinth"] = node_base_plinth_1;
  const mesh_base_plinth_1Geometry = endpoint_base_plinth_1
    ? new THREE.CylinderGeometry(endpoint_base_plinth_1.endRadius, endpoint_base_plinth_1.baseRadius, endpoint_base_plinth_1.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0.85, -0.43], [0.85, 0.43], [0.57, 0.71], [-0.57, 0.71], [-0.85, 0.43], [-0.85, -0.43], [-0.57, -0.71], [0.57, -0.71]], "depth": 0.1892, "axis": "y", "axisOffset": 0.0516, "steps": 4, "profileStops": [[0.0, 0.9412, 0.9296], [0.25, 1.0, 1.0], [0.75, 1.0, 1.0], [1.0, 0.9412, 0.9296]]});
  const mesh_base_plinth_1 = new THREE.Mesh(
    mesh_base_plinth_1Geometry,
    materialMap["accent-coral"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_base_plinth_1.name = "Base plinth";
  if (endpoint_base_plinth_1) {
    mesh_base_plinth_1.position.copy(endpoint_base_plinth_1.midpoint);
    mesh_base_plinth_1.quaternion.copy(endpoint_base_plinth_1.quaternion);
  }
  mesh_base_plinth_1.castShadow = options.castShadow ?? true;
  mesh_base_plinth_1.receiveShadow = options.receiveShadow ?? true;
  mesh_base_plinth_1.userData.sculptComponent = node_base_plinth_1.userData.sculptComponent;
  node_base_plinth_1.add(mesh_base_plinth_1);
  meshes["base-plinth"] = mesh_base_plinth_1;
  colliders["base-plinth"] = {"type": "box", "offset": [0.0, 0.17, 0.0], "scale": [1.7, 0.22, 1.45], "isTrigger": false, "notes": "Plinth footprint proxy."};
  destructionGroups["base-plinth"] ??= [];
  destructionGroups["base-plinth"].push(node_base_plinth_1);

  const attachment_foot_front_right_2 = null;
  const endpoint_foot_front_right_2 = makeAttachmentEndpoint(attachment_foot_front_right_2);
  const node_foot_front_right_2 = new THREE.Group();
  node_foot_front_right_2.name = "Front right corner foot__pivot";
  if (endpoint_foot_front_right_2) {
    node_foot_front_right_2.position.copy(endpoint_foot_front_right_2.start);
    node_foot_front_right_2.rotation.set(0, 0, 0);
    node_foot_front_right_2.scale.set(1, 1, 1);
  } else {
    node_foot_front_right_2.position.set(0.58, 0.0225, 0.46);
    node_foot_front_right_2.rotation.set(0.0, 0.0, 0.0);
    node_foot_front_right_2.scale.set(0.14, 0.045, 0.14);
  }
  node_foot_front_right_2.userData.sculptComponent = {"id": "foot-front-right", "name": "Front right corner foot", "level": "micro", "role": "foot", "importance": 0.25, "confidence": 0.45, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A small flat-faced pad under a plinth corner facet; four of them are visible as short steps in the reference silhouette below the coral slab.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(222, 85, 77, 1.0)", "secondaryAlbedo": "rgba(212, 78, 70, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "short rectangular pad", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "box UVs", "normalStrategy": "vertex normals from generated geometry"}, "parent": "base-plinth", "attachment": null, "dimensions": {"width": 0.14, "height": 0.045, "depth": 0.14, "units": "world", "confidence": 0.45}, "transform": {"position": [0.58, 0.0225, 0.46], "rotation": [0.0, 0.0, 0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.45}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "base-plinth", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shell-cream"}}, "material": "accent-coral", "materialLayers": ["accent-coral"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "foot-pad-front-right", "description": "Lifts the plinth 0.06 units clear of the counter and shows as a short step in the bottom silhouette.", "geometry": "box pad inset from the plinth corner facet", "evidenceRefs": ["full-object", "base-plinth-zone"], "confidence": 0.45}], "surfaceDetail": {"macroRoughness": 0.8, "microRoughness": 0.08, "bumpAmplitude": 0.0, "normalPattern": "flat moulded coral", "displacementPattern": "none", "occlusionPattern": "full contact occlusion under the pad", "edgeWearPattern": "none", "notes": "Inferred by symmetry from two feet visible in the reference; the other two are not observed."}, "evidenceRefs": ["full-object", "base-plinth-zone"], "details": [], "fidelityTier": "blockout"};
  node_foot_front_right_2.userData.actionProfile = node_foot_front_right_2.userData.sculptComponent.actionProfile;
  (nodes["base-plinth"] ?? root).add(node_foot_front_right_2);
  nodes["foot-front-right"] = node_foot_front_right_2;
  const mesh_foot_front_right_2Geometry = endpoint_foot_front_right_2
    ? new THREE.CylinderGeometry(endpoint_foot_front_right_2.endRadius, endpoint_foot_front_right_2.baseRadius, endpoint_foot_front_right_2.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1);
  const mesh_foot_front_right_2 = new THREE.Mesh(
    mesh_foot_front_right_2Geometry,
    materialMap["accent-coral"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_foot_front_right_2.name = "Front right corner foot";
  if (endpoint_foot_front_right_2) {
    mesh_foot_front_right_2.position.copy(endpoint_foot_front_right_2.midpoint);
    mesh_foot_front_right_2.quaternion.copy(endpoint_foot_front_right_2.quaternion);
  }
  mesh_foot_front_right_2.castShadow = options.castShadow ?? true;
  mesh_foot_front_right_2.receiveShadow = options.receiveShadow ?? true;
  mesh_foot_front_right_2.userData.sculptComponent = node_foot_front_right_2.userData.sculptComponent;
  node_foot_front_right_2.add(mesh_foot_front_right_2);
  meshes["foot-front-right"] = mesh_foot_front_right_2;
  colliders["foot-front-right"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["base-plinth"] ??= [];
  destructionGroups["base-plinth"].push(node_foot_front_right_2);

  const attachment_foot_front_left_3 = null;
  const endpoint_foot_front_left_3 = makeAttachmentEndpoint(attachment_foot_front_left_3);
  const node_foot_front_left_3 = new THREE.Group();
  node_foot_front_left_3.name = "Front left corner foot__pivot";
  if (endpoint_foot_front_left_3) {
    node_foot_front_left_3.position.copy(endpoint_foot_front_left_3.start);
    node_foot_front_left_3.rotation.set(0, 0, 0);
    node_foot_front_left_3.scale.set(1, 1, 1);
  } else {
    node_foot_front_left_3.position.set(-0.58, 0.0225, 0.46);
    node_foot_front_left_3.rotation.set(0.0, 0.0, 0.0);
    node_foot_front_left_3.scale.set(0.14, 0.045, 0.14);
  }
  node_foot_front_left_3.userData.sculptComponent = {"id": "foot-front-left", "name": "Front left corner foot", "level": "micro", "role": "foot", "importance": 0.25, "confidence": 0.45, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A small flat-faced pad under a plinth corner facet; four of them are visible as short steps in the reference silhouette below the coral slab.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(222, 85, 77, 1.0)", "secondaryAlbedo": "rgba(212, 78, 70, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "short rectangular pad", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "box UVs", "normalStrategy": "vertex normals from generated geometry"}, "parent": "base-plinth", "attachment": null, "dimensions": {"width": 0.14, "height": 0.045, "depth": 0.14, "units": "world", "confidence": 0.45}, "transform": {"position": [-0.58, 0.0225, 0.46], "rotation": [0.0, 0.0, 0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.45}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "base-plinth", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shell-cream"}}, "material": "accent-coral", "materialLayers": ["accent-coral"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "foot-pad-front-left", "description": "Lifts the plinth 0.06 units clear of the counter and shows as a short step in the bottom silhouette.", "geometry": "box pad inset from the plinth corner facet", "evidenceRefs": ["full-object", "base-plinth-zone"], "confidence": 0.45}], "surfaceDetail": {"macroRoughness": 0.8, "microRoughness": 0.08, "bumpAmplitude": 0.0, "normalPattern": "flat moulded coral", "displacementPattern": "none", "occlusionPattern": "full contact occlusion under the pad", "edgeWearPattern": "none", "notes": "Inferred by symmetry from two feet visible in the reference; the other two are not observed."}, "evidenceRefs": ["full-object", "base-plinth-zone"], "details": [], "fidelityTier": "blockout"};
  node_foot_front_left_3.userData.actionProfile = node_foot_front_left_3.userData.sculptComponent.actionProfile;
  (nodes["base-plinth"] ?? root).add(node_foot_front_left_3);
  nodes["foot-front-left"] = node_foot_front_left_3;
  const mesh_foot_front_left_3Geometry = endpoint_foot_front_left_3
    ? new THREE.CylinderGeometry(endpoint_foot_front_left_3.endRadius, endpoint_foot_front_left_3.baseRadius, endpoint_foot_front_left_3.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1);
  const mesh_foot_front_left_3 = new THREE.Mesh(
    mesh_foot_front_left_3Geometry,
    materialMap["accent-coral"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_foot_front_left_3.name = "Front left corner foot";
  if (endpoint_foot_front_left_3) {
    mesh_foot_front_left_3.position.copy(endpoint_foot_front_left_3.midpoint);
    mesh_foot_front_left_3.quaternion.copy(endpoint_foot_front_left_3.quaternion);
  }
  mesh_foot_front_left_3.castShadow = options.castShadow ?? true;
  mesh_foot_front_left_3.receiveShadow = options.receiveShadow ?? true;
  mesh_foot_front_left_3.userData.sculptComponent = node_foot_front_left_3.userData.sculptComponent;
  node_foot_front_left_3.add(mesh_foot_front_left_3);
  meshes["foot-front-left"] = mesh_foot_front_left_3;
  colliders["foot-front-left"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["base-plinth"] ??= [];
  destructionGroups["base-plinth"].push(node_foot_front_left_3);

  const attachment_foot_back_right_4 = null;
  const endpoint_foot_back_right_4 = makeAttachmentEndpoint(attachment_foot_back_right_4);
  const node_foot_back_right_4 = new THREE.Group();
  node_foot_back_right_4.name = "Back right corner foot__pivot";
  if (endpoint_foot_back_right_4) {
    node_foot_back_right_4.position.copy(endpoint_foot_back_right_4.start);
    node_foot_back_right_4.rotation.set(0, 0, 0);
    node_foot_back_right_4.scale.set(1, 1, 1);
  } else {
    node_foot_back_right_4.position.set(0.58, 0.0225, -0.46);
    node_foot_back_right_4.rotation.set(0.0, 0.0, 0.0);
    node_foot_back_right_4.scale.set(0.14, 0.045, 0.14);
  }
  node_foot_back_right_4.userData.sculptComponent = {"id": "foot-back-right", "name": "Back right corner foot", "level": "micro", "role": "foot", "importance": 0.25, "confidence": 0.45, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A small flat-faced pad under a plinth corner facet; four of them are visible as short steps in the reference silhouette below the coral slab.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(222, 85, 77, 1.0)", "secondaryAlbedo": "rgba(212, 78, 70, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "short rectangular pad", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "box UVs", "normalStrategy": "vertex normals from generated geometry"}, "parent": "base-plinth", "attachment": null, "dimensions": {"width": 0.14, "height": 0.045, "depth": 0.14, "units": "world", "confidence": 0.45}, "transform": {"position": [0.58, 0.0225, -0.46], "rotation": [0.0, 0.0, 0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.45}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "base-plinth", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shell-cream"}}, "material": "accent-coral", "materialLayers": ["accent-coral"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "foot-pad-back-right", "description": "Lifts the plinth 0.06 units clear of the counter and shows as a short step in the bottom silhouette.", "geometry": "box pad inset from the plinth corner facet", "evidenceRefs": ["full-object", "base-plinth-zone"], "confidence": 0.45}], "surfaceDetail": {"macroRoughness": 0.8, "microRoughness": 0.08, "bumpAmplitude": 0.0, "normalPattern": "flat moulded coral", "displacementPattern": "none", "occlusionPattern": "full contact occlusion under the pad", "edgeWearPattern": "none", "notes": "Inferred by symmetry from two feet visible in the reference; the other two are not observed."}, "evidenceRefs": ["full-object", "base-plinth-zone"], "details": [], "fidelityTier": "blockout"};
  node_foot_back_right_4.userData.actionProfile = node_foot_back_right_4.userData.sculptComponent.actionProfile;
  (nodes["base-plinth"] ?? root).add(node_foot_back_right_4);
  nodes["foot-back-right"] = node_foot_back_right_4;
  const mesh_foot_back_right_4Geometry = endpoint_foot_back_right_4
    ? new THREE.CylinderGeometry(endpoint_foot_back_right_4.endRadius, endpoint_foot_back_right_4.baseRadius, endpoint_foot_back_right_4.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1);
  const mesh_foot_back_right_4 = new THREE.Mesh(
    mesh_foot_back_right_4Geometry,
    materialMap["accent-coral"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_foot_back_right_4.name = "Back right corner foot";
  if (endpoint_foot_back_right_4) {
    mesh_foot_back_right_4.position.copy(endpoint_foot_back_right_4.midpoint);
    mesh_foot_back_right_4.quaternion.copy(endpoint_foot_back_right_4.quaternion);
  }
  mesh_foot_back_right_4.castShadow = options.castShadow ?? true;
  mesh_foot_back_right_4.receiveShadow = options.receiveShadow ?? true;
  mesh_foot_back_right_4.userData.sculptComponent = node_foot_back_right_4.userData.sculptComponent;
  node_foot_back_right_4.add(mesh_foot_back_right_4);
  meshes["foot-back-right"] = mesh_foot_back_right_4;
  colliders["foot-back-right"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["base-plinth"] ??= [];
  destructionGroups["base-plinth"].push(node_foot_back_right_4);

  const attachment_foot_back_left_5 = null;
  const endpoint_foot_back_left_5 = makeAttachmentEndpoint(attachment_foot_back_left_5);
  const node_foot_back_left_5 = new THREE.Group();
  node_foot_back_left_5.name = "Back left corner foot__pivot";
  if (endpoint_foot_back_left_5) {
    node_foot_back_left_5.position.copy(endpoint_foot_back_left_5.start);
    node_foot_back_left_5.rotation.set(0, 0, 0);
    node_foot_back_left_5.scale.set(1, 1, 1);
  } else {
    node_foot_back_left_5.position.set(-0.58, 0.0225, -0.46);
    node_foot_back_left_5.rotation.set(0.0, 0.0, 0.0);
    node_foot_back_left_5.scale.set(0.14, 0.045, 0.14);
  }
  node_foot_back_left_5.userData.sculptComponent = {"id": "foot-back-left", "name": "Back left corner foot", "level": "micro", "role": "foot", "importance": 0.25, "confidence": 0.45, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A small flat-faced pad under a plinth corner facet; four of them are visible as short steps in the reference silhouette below the coral slab.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(222, 85, 77, 1.0)", "secondaryAlbedo": "rgba(212, 78, 70, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "short rectangular pad", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "box UVs", "normalStrategy": "vertex normals from generated geometry"}, "parent": "base-plinth", "attachment": null, "dimensions": {"width": 0.14, "height": 0.045, "depth": 0.14, "units": "world", "confidence": 0.45}, "transform": {"position": [-0.58, 0.0225, -0.46], "rotation": [0.0, 0.0, 0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.45}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "base-plinth", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shell-cream"}}, "material": "accent-coral", "materialLayers": ["accent-coral"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "foot-pad-back-left", "description": "Lifts the plinth 0.06 units clear of the counter and shows as a short step in the bottom silhouette.", "geometry": "box pad inset from the plinth corner facet", "evidenceRefs": ["full-object", "base-plinth-zone"], "confidence": 0.45}], "surfaceDetail": {"macroRoughness": 0.8, "microRoughness": 0.08, "bumpAmplitude": 0.0, "normalPattern": "flat moulded coral", "displacementPattern": "none", "occlusionPattern": "full contact occlusion under the pad", "edgeWearPattern": "none", "notes": "Inferred by symmetry from two feet visible in the reference; the other two are not observed."}, "evidenceRefs": ["full-object", "base-plinth-zone"], "details": [], "fidelityTier": "blockout"};
  node_foot_back_left_5.userData.actionProfile = node_foot_back_left_5.userData.sculptComponent.actionProfile;
  (nodes["base-plinth"] ?? root).add(node_foot_back_left_5);
  nodes["foot-back-left"] = node_foot_back_left_5;
  const mesh_foot_back_left_5Geometry = endpoint_foot_back_left_5
    ? new THREE.CylinderGeometry(endpoint_foot_back_left_5.endRadius, endpoint_foot_back_left_5.baseRadius, endpoint_foot_back_left_5.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1);
  const mesh_foot_back_left_5 = new THREE.Mesh(
    mesh_foot_back_left_5Geometry,
    materialMap["accent-coral"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_foot_back_left_5.name = "Back left corner foot";
  if (endpoint_foot_back_left_5) {
    mesh_foot_back_left_5.position.copy(endpoint_foot_back_left_5.midpoint);
    mesh_foot_back_left_5.quaternion.copy(endpoint_foot_back_left_5.quaternion);
  }
  mesh_foot_back_left_5.castShadow = options.castShadow ?? true;
  mesh_foot_back_left_5.receiveShadow = options.receiveShadow ?? true;
  mesh_foot_back_left_5.userData.sculptComponent = node_foot_back_left_5.userData.sculptComponent;
  node_foot_back_left_5.add(mesh_foot_back_left_5);
  meshes["foot-back-left"] = mesh_foot_back_left_5;
  colliders["foot-back-left"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["base-plinth"] ??= [];
  destructionGroups["base-plinth"].push(node_foot_back_left_5);

  const attachment_top_bezel_6 = null;
  const endpoint_top_bezel_6 = makeAttachmentEndpoint(attachment_top_bezel_6);
  const node_top_bezel_6 = new THREE.Group();
  node_top_bezel_6.name = "Top bezel ring__pivot";
  if (endpoint_top_bezel_6) {
    node_top_bezel_6.position.copy(endpoint_top_bezel_6.start);
    node_top_bezel_6.rotation.set(0, 0, 0);
    node_top_bezel_6.scale.set(1, 1, 1);
  } else {
    node_top_bezel_6.position.set(0.0, 0.0, 0.0);
    node_top_bezel_6.rotation.set(0.0, 0.0, 0.0);
    node_top_bezel_6.scale.set(1.0, 1.0, 1.0);
  }
  node_top_bezel_6.userData.sculptComponent = {"id": "top-bezel", "name": "Top bezel ring", "level": "meso", "role": "bezel", "importance": 0.85, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A discrete moulded ring with a flat crown and hard chamfered corners standing proud of the cream deck; the reference shows a clean step where it meets the deck.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(222, 85, 77, 1.0)", "secondaryAlbedo": "rgba(212, 78, 70, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "proud octagonal ring framing the slot opening", "edgeTreatment": {"type": "flat-chamfer", "bevelRadius": 0.0, "segments": 1}, "deformationStack": ["crown chamfer inset 0.03"], "uvStrategy": "ExtrudeGeometry cap and wall UVs", "normalStrategy": "flat facet normals recomputed after the profile deformation", "profile2D": {"points": [[0.605, -0.285], [0.605, 0.285], [0.455, 0.435], [-0.455, 0.435], [-0.605, 0.285], [-0.605, -0.285], [-0.455, -0.435], [0.455, -0.435]], "depth": 0.055, "axis": "y", "axisOffset": 1.2556, "steps": 2, "profileStops": [[0.0, 1.0, 1.0], [0.5, 1.0, 1.0], [1.0, 0.9504, 0.931]], "profileExempt": [0.505, 0.335], "holes": [[[0.485, -0.205], [0.485, 0.205], [0.375, 0.315], [-0.375, 0.315], [-0.485, 0.205], [-0.485, -0.205], [-0.375, -0.315], [0.375, -0.315]]]}}, "parent": "body-shell", "attachment": null, "dimensions": {"width": 1.21, "height": 0.055, "depth": 0.87, "units": "world", "confidence": 0.7}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 1.2831, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 1.2831, 0.0], "scale": [1.21, 0.055, 0.87], "isTrigger": false, "notes": "Rim proxy for toast collision on eject."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "top-bezel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shell-cream"}}, "material": "accent-coral", "materialLayers": ["accent-coral"], "deformations": [], "joints": [], "seams": [{"id": "bezel-deck-seam", "with": "body-shell", "overlap": 0.02, "notes": "Bezel base is 0.02 units below the deck plane."}], "localFeatures": [{"id": "proud-lip-step", "description": "The ring stands 0.055 units above the cream deck, so a hard shadow line runs all the way round its outer edge.", "geometry": "separate extrusion starting 0.02 units inside the deck", "evidenceRefs": ["full-object", "top-slot-zone"], "confidence": 0.9}, {"id": "bezel-crown-chamfer", "description": "The crown chamfers inward by 0.03 units, softening the top edge without rounding it.", "geometry": "final profileStop", "evidenceRefs": ["full-object", "top-slot-zone"], "confidence": 0.8}, {"id": "bezel-inner-wall", "description": "The inner wall of the ring drops straight to the deck and frames the opening.", "geometry": "profile2D hole matching the shell bore exactly", "evidenceRefs": ["full-object", "top-slot-zone"], "confidence": 0.85}], "surfaceDetail": {"macroRoughness": 0.7, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat coral moulding", "displacementPattern": "none", "occlusionPattern": "shadow line at the deck step", "edgeWearPattern": "slight polish on the crown", "notes": "The most saturated coral in the frame."}, "evidenceRefs": ["full-object", "top-slot-zone"], "details": [], "fidelityTier": "blockout"};
  node_top_bezel_6.userData.actionProfile = node_top_bezel_6.userData.sculptComponent.actionProfile;
  (nodes["body-shell"] ?? root).add(node_top_bezel_6);
  nodes["top-bezel"] = node_top_bezel_6;
  const mesh_top_bezel_6Geometry = endpoint_top_bezel_6
    ? new THREE.CylinderGeometry(endpoint_top_bezel_6.endRadius, endpoint_top_bezel_6.baseRadius, endpoint_top_bezel_6.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0.605, -0.285], [0.605, 0.285], [0.455, 0.435], [-0.455, 0.435], [-0.605, 0.285], [-0.605, -0.285], [-0.455, -0.435], [0.455, -0.435]], "depth": 0.055, "axis": "y", "axisOffset": 1.2556, "steps": 2, "profileStops": [[0.0, 1.0, 1.0], [0.5, 1.0, 1.0], [1.0, 0.9504, 0.931]], "profileExempt": [0.505, 0.335], "holes": [[[0.485, -0.205], [0.485, 0.205], [0.375, 0.315], [-0.375, 0.315], [-0.485, 0.205], [-0.485, -0.205], [-0.375, -0.315], [0.375, -0.315]]]});
  const mesh_top_bezel_6 = new THREE.Mesh(
    mesh_top_bezel_6Geometry,
    materialMap["accent-coral"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_top_bezel_6.name = "Top bezel ring";
  if (endpoint_top_bezel_6) {
    mesh_top_bezel_6.position.copy(endpoint_top_bezel_6.midpoint);
    mesh_top_bezel_6.quaternion.copy(endpoint_top_bezel_6.quaternion);
  }
  mesh_top_bezel_6.castShadow = options.castShadow ?? true;
  mesh_top_bezel_6.receiveShadow = options.receiveShadow ?? true;
  mesh_top_bezel_6.userData.sculptComponent = node_top_bezel_6.userData.sculptComponent;
  node_top_bezel_6.add(mesh_top_bezel_6);
  meshes["top-bezel"] = mesh_top_bezel_6;
  colliders["top-bezel"] = {"type": "box", "offset": [0.0, 1.2831, 0.0], "scale": [1.21, 0.055, 0.87], "isTrigger": false, "notes": "Rim proxy for toast collision on eject."};
  destructionGroups["top-bezel"] ??= [];
  destructionGroups["top-bezel"].push(node_top_bezel_6);

  const attachment_slot_cavity_7 = null;
  const endpoint_slot_cavity_7 = makeAttachmentEndpoint(attachment_slot_cavity_7);
  const node_slot_cavity_7 = new THREE.Group();
  node_slot_cavity_7.name = "Slot cavity pocket__pivot";
  if (endpoint_slot_cavity_7) {
    node_slot_cavity_7.position.copy(endpoint_slot_cavity_7.start);
    node_slot_cavity_7.rotation.set(0, 0, 0);
    node_slot_cavity_7.scale.set(1, 1, 1);
  } else {
    node_slot_cavity_7.position.set(0.0, 0.0, 0.0);
    node_slot_cavity_7.rotation.set(0.0, 0.0, 0.0);
    node_slot_cavity_7.scale.set(1.0, 1.0, 1.0);
  }
  node_slot_cavity_7.userData.sculptComponent = {"id": "slot-cavity", "name": "Slot cavity pocket", "level": "meso", "role": "cavity", "importance": 0.8, "confidence": 0.6, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "The pocket is bounded by four flat wall panels meeting the deck at a hard rim; the reference shows straight vertical wall planes, not a blended cup.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(110, 108, 104, 1.0)", "secondaryAlbedo": "rgba(96, 94, 90, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "open-top pocket liner: an extruded ring that lines the deck bore", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "ExtrudeGeometry cap and wall UVs", "normalStrategy": "flat facet normals", "profile2D": {"points": [[0.535, -0.235], [0.535, 0.235], [0.405, 0.365], [-0.405, 0.365], [-0.535, 0.235], [-0.535, -0.235], [-0.405, -0.365], [0.405, -0.365]], "depth": 0.4128, "axis": "-y", "axisOffset": -1.2708, "holes": [[[0.483, -0.203], [0.483, 0.203], [0.373, 0.313], [-0.373, 0.313], [-0.483, 0.203], [-0.483, -0.203], [-0.373, -0.313], [0.373, -0.313]]]}}, "parent": "body-shell", "attachment": null, "dimensions": {"width": 0.97, "height": 0.4128, "depth": 0.63, "units": "world", "confidence": 0.5}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "socket", "localPosition": [0.0, 1.2708, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "toast-eject-front", "localPosition": [0.0, 1.3308, 0.1575], "localRotation": [0.0, 0.0, 0.0], "notes": "Toast spawn for the front slot; launch direction is world +Y."}, {"id": "toast-eject-back", "localPosition": [0.0, 1.3308, -0.1575], "localRotation": [0.0, 0.0, 0.0], "notes": "Toast spawn for the back slot; launch direction is world +Y."}, {"id": "toast-eject", "localPosition": [0.0, 1.3308, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Combined launch origin when both slots fire together."}], "collider": {"type": "box", "offset": [0.0, 1.0644, 0.0], "scale": [0.97, 0.4128, 0.63], "isTrigger": true, "notes": "Trigger volume: anything inside is launchable."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shell-cream"}}, "material": "cavity-gray", "materialLayers": ["cavity-gray"], "deformations": [], "joints": [], "seams": [{"id": "cavity-shell-seam", "with": "body-shell", "overlap": 0.05, "notes": "Liner outer contour is buried inside the shell wall."}], "localFeatures": [{"id": "pocket-walls", "description": "Four wall panels drop 0.55 units from the rim, darkening with depth.", "geometry": "extruded ring lining the deck bore, embedded 0.05 units into the shell wall", "evidenceRefs": ["full-object", "top-slot-zone"], "confidence": 0.7}, {"id": "element-tab-rows", "description": "Six trapezoidal nubs project from the wall faces, three along the divider and three along the rear wall, at a constant depth below the rim.", "geometry": "InstancedMesh of six boxes, one draw call", "evidenceRefs": ["full-object", "top-slot-zone"], "confidence": 0.8}, {"id": "rim-undercut", "description": "The liner sits 0.002 units below the deck so a thin dark line reads at the opening edge instead of a coincident-face seam.", "geometry": "axisOffset shifted below the deck plane", "evidenceRefs": ["full-object", "top-slot-zone"], "confidence": 0.7}], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.08, "bumpAmplitude": 0.0, "normalPattern": "matte moulded liner", "displacementPattern": "none", "occlusionPattern": "strong depth-driven occlusion down the pocket", "edgeWearPattern": "none", "notes": "Cavity depth is inferred; the reference view cannot see the floor."}, "evidenceRefs": ["full-object", "top-slot-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_slot_cavity_7.userData.actionProfile = node_slot_cavity_7.userData.sculptComponent.actionProfile;
  (nodes["body-shell"] ?? root).add(node_slot_cavity_7);
  nodes["slot-cavity"] = node_slot_cavity_7;
  const mesh_slot_cavity_7Geometry = endpoint_slot_cavity_7
    ? new THREE.CylinderGeometry(endpoint_slot_cavity_7.endRadius, endpoint_slot_cavity_7.baseRadius, endpoint_slot_cavity_7.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0.535, -0.235], [0.535, 0.235], [0.405, 0.365], [-0.405, 0.365], [-0.535, 0.235], [-0.535, -0.235], [-0.405, -0.365], [0.405, -0.365]], "depth": 0.4128, "axis": "-y", "axisOffset": -1.2708, "holes": [[[0.483, -0.203], [0.483, 0.203], [0.373, 0.313], [-0.373, 0.313], [-0.483, 0.203], [-0.483, -0.203], [-0.373, -0.313], [0.373, -0.313]]]});
  const mesh_slot_cavity_7 = new THREE.Mesh(
    mesh_slot_cavity_7Geometry,
    materialMap["cavity-gray"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_slot_cavity_7.name = "Slot cavity pocket";
  if (endpoint_slot_cavity_7) {
    mesh_slot_cavity_7.position.copy(endpoint_slot_cavity_7.midpoint);
    mesh_slot_cavity_7.quaternion.copy(endpoint_slot_cavity_7.quaternion);
  }
  mesh_slot_cavity_7.castShadow = options.castShadow ?? true;
  mesh_slot_cavity_7.receiveShadow = options.receiveShadow ?? true;
  mesh_slot_cavity_7.userData.sculptComponent = node_slot_cavity_7.userData.sculptComponent;
  node_slot_cavity_7.add(mesh_slot_cavity_7);
  meshes["slot-cavity"] = mesh_slot_cavity_7;
  colliders["slot-cavity"] = {"type": "box", "offset": [0.0, 1.0644, 0.0], "scale": [0.97, 0.4128, 0.63], "isTrigger": true, "notes": "Trigger volume: anything inside is launchable."};
  destructionGroups["body-shell"] ??= [];
  destructionGroups["body-shell"].push(node_slot_cavity_7);
  const socket_slot_cavity_toast_eject_front_0 = new THREE.Object3D();
  socket_slot_cavity_toast_eject_front_0.name = "toast-eject-front";
  socket_slot_cavity_toast_eject_front_0.position.set(0.0, 1.3308, 0.1575);
  socket_slot_cavity_toast_eject_front_0.rotation.set(0.0, 0.0, 0.0);
  socket_slot_cavity_toast_eject_front_0.userData.socket = {"id": "toast-eject-front", "localPosition": [0.0, 1.3308, 0.1575], "localRotation": [0.0, 0.0, 0.0], "notes": "Toast spawn for the front slot; launch direction is world +Y."};
  node_slot_cavity_7.add(socket_slot_cavity_toast_eject_front_0);
  sockets["slot-cavity:toast-eject-front"] = socket_slot_cavity_toast_eject_front_0;
  const socket_slot_cavity_toast_eject_back_1 = new THREE.Object3D();
  socket_slot_cavity_toast_eject_back_1.name = "toast-eject-back";
  socket_slot_cavity_toast_eject_back_1.position.set(0.0, 1.3308, -0.1575);
  socket_slot_cavity_toast_eject_back_1.rotation.set(0.0, 0.0, 0.0);
  socket_slot_cavity_toast_eject_back_1.userData.socket = {"id": "toast-eject-back", "localPosition": [0.0, 1.3308, -0.1575], "localRotation": [0.0, 0.0, 0.0], "notes": "Toast spawn for the back slot; launch direction is world +Y."};
  node_slot_cavity_7.add(socket_slot_cavity_toast_eject_back_1);
  sockets["slot-cavity:toast-eject-back"] = socket_slot_cavity_toast_eject_back_1;
  const socket_slot_cavity_toast_eject_2 = new THREE.Object3D();
  socket_slot_cavity_toast_eject_2.name = "toast-eject";
  socket_slot_cavity_toast_eject_2.position.set(0.0, 1.3308, 0.0);
  socket_slot_cavity_toast_eject_2.rotation.set(0.0, 0.0, 0.0);
  socket_slot_cavity_toast_eject_2.userData.socket = {"id": "toast-eject", "localPosition": [0.0, 1.3308, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Combined launch origin when both slots fire together."};
  node_slot_cavity_7.add(socket_slot_cavity_toast_eject_2);
  sockets["slot-cavity:toast-eject"] = socket_slot_cavity_toast_eject_2;

  const attachment_cavity_floor_8 = null;
  const endpoint_cavity_floor_8 = makeAttachmentEndpoint(attachment_cavity_floor_8);
  const node_cavity_floor_8 = new THREE.Group();
  node_cavity_floor_8.name = "Slot cavity floor__pivot";
  if (endpoint_cavity_floor_8) {
    node_cavity_floor_8.position.copy(endpoint_cavity_floor_8.start);
    node_cavity_floor_8.rotation.set(0, 0, 0);
    node_cavity_floor_8.scale.set(1, 1, 1);
  } else {
    node_cavity_floor_8.position.set(0.0, 0.0, 0.0);
    node_cavity_floor_8.rotation.set(0.0, 0.0, 0.0);
    node_cavity_floor_8.scale.set(1.0, 1.0, 1.0);
  }
  node_cavity_floor_8.userData.sculptComponent = {"id": "cavity-floor", "name": "Slot cavity floor", "level": "meso", "role": "cavity", "importance": 0.3, "confidence": 0.4, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A flat rigid plate closing the bottom of the pocket; it has one visible planar face, which is why it is a primitive plate rather than a sculpted form.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(110, 108, 104, 1.0)", "secondaryAlbedo": "rgba(96, 94, 90, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "flat plate closing the pocket", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "ExtrudeGeometry cap UVs", "normalStrategy": "flat facet normals", "profile2D": {"points": [[0.525, -0.235], [0.525, 0.235], [0.405, 0.355], [-0.405, 0.355], [-0.525, 0.235], [-0.525, -0.235], [-0.405, -0.355], [0.405, -0.355]], "depth": 0.06, "axis": "y", "axisOffset": 0.838}}, "parent": "slot-cavity", "attachment": null, "dimensions": {"width": 0.97, "height": 0.04, "depth": 0.63, "units": "world", "confidence": 0.35}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.858, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.4}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shell-cream"}}, "material": "cavity-gray", "materialLayers": ["cavity-gray"], "deformations": [], "joints": [], "seams": [{"id": "floor-wall-seam", "with": "slot-cavity", "overlap": 0.04, "notes": "Plate overlaps the wall ring."}], "localFeatures": [{"id": "crumb-floor", "description": "Closes the pocket 0.55 units below the rim and catches the darkest value in the frame.", "geometry": "plate wider than the pocket so no gap shows at the wall join", "evidenceRefs": ["full-object", "top-slot-zone"], "confidence": 0.4}], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.06, "bumpAmplitude": 0.0, "normalPattern": "matte liner", "displacementPattern": "none", "occlusionPattern": "deep occlusion", "edgeWearPattern": "none", "notes": "Not observed in the reference; depth chosen so a slice of toast fits."}, "evidenceRefs": ["full-object", "top-slot-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_cavity_floor_8.userData.actionProfile = node_cavity_floor_8.userData.sculptComponent.actionProfile;
  (nodes["slot-cavity"] ?? root).add(node_cavity_floor_8);
  nodes["cavity-floor"] = node_cavity_floor_8;
  const mesh_cavity_floor_8Geometry = endpoint_cavity_floor_8
    ? new THREE.CylinderGeometry(endpoint_cavity_floor_8.endRadius, endpoint_cavity_floor_8.baseRadius, endpoint_cavity_floor_8.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0.525, -0.235], [0.525, 0.235], [0.405, 0.355], [-0.405, 0.355], [-0.525, 0.235], [-0.525, -0.235], [-0.405, -0.355], [0.405, -0.355]], "depth": 0.06, "axis": "y", "axisOffset": 0.838});
  const mesh_cavity_floor_8 = new THREE.Mesh(
    mesh_cavity_floor_8Geometry,
    materialMap["cavity-gray"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cavity_floor_8.name = "Slot cavity floor";
  if (endpoint_cavity_floor_8) {
    mesh_cavity_floor_8.position.copy(endpoint_cavity_floor_8.midpoint);
    mesh_cavity_floor_8.quaternion.copy(endpoint_cavity_floor_8.quaternion);
  }
  mesh_cavity_floor_8.castShadow = options.castShadow ?? true;
  mesh_cavity_floor_8.receiveShadow = options.receiveShadow ?? true;
  mesh_cavity_floor_8.userData.sculptComponent = node_cavity_floor_8.userData.sculptComponent;
  node_cavity_floor_8.add(mesh_cavity_floor_8);
  meshes["cavity-floor"] = mesh_cavity_floor_8;
  colliders["cavity-floor"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["body-shell"] ??= [];
  destructionGroups["body-shell"].push(node_cavity_floor_8);

  const attachment_cavity_divider_9 = null;
  const endpoint_cavity_divider_9 = makeAttachmentEndpoint(attachment_cavity_divider_9);
  const node_cavity_divider_9 = new THREE.Group();
  node_cavity_divider_9.name = "Cavity divider wall__pivot";
  if (endpoint_cavity_divider_9) {
    node_cavity_divider_9.position.copy(endpoint_cavity_divider_9.start);
    node_cavity_divider_9.rotation.set(0, 0, 0);
    node_cavity_divider_9.scale.set(1, 1, 1);
  } else {
    node_cavity_divider_9.position.set(0.0, 1.0504, 0.0);
    node_cavity_divider_9.rotation.set(0.0, 0.0, 0.0);
    node_cavity_divider_9.scale.set(0.93, 0.3848, 0.09);
  }
  node_cavity_divider_9.userData.sculptComponent = {"id": "cavity-divider", "name": "Cavity divider wall", "level": "meso", "role": "divider", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A single flat rigid partition with a light flat crown, clearly visible in the reference splitting the opening into two slots.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(110, 108, 104, 1.0)", "secondaryAlbedo": "rgba(96, 94, 90, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "thin partition splitting the pocket into two slots", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "box UVs", "normalStrategy": "vertex normals from generated geometry"}, "parent": "slot-cavity", "attachment": null, "dimensions": {"width": 0.93, "height": 0.3848, "depth": 0.09, "units": "world", "confidence": 0.65}, "transform": {"position": [0.0, 1.0504, 0.0], "rotation": [0.0, 0.0, 0.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.65}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shell-cream"}}, "material": "cavity-gray", "materialLayers": ["cavity-gray"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "divider-crown", "description": "The partition stops 0.08 units short of the rim, so its lit top edge reads as a pale strip running the length of the opening.", "geometry": "box height ends below the deck plane", "evidenceRefs": ["full-object", "top-slot-zone"], "confidence": 0.85}], "surfaceDetail": {"macroRoughness": 0.86, "microRoughness": 0.08, "bumpAmplitude": 0.0, "normalPattern": "matte liner", "displacementPattern": "none", "occlusionPattern": "occlusion in both slot troughs", "edgeWearPattern": "none", "notes": "Crown height read from the reference; the partition's base is inferred."}, "evidenceRefs": ["full-object", "top-slot-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_cavity_divider_9.userData.actionProfile = node_cavity_divider_9.userData.sculptComponent.actionProfile;
  (nodes["slot-cavity"] ?? root).add(node_cavity_divider_9);
  nodes["cavity-divider"] = node_cavity_divider_9;
  const mesh_cavity_divider_9Geometry = endpoint_cavity_divider_9
    ? new THREE.CylinderGeometry(endpoint_cavity_divider_9.endRadius, endpoint_cavity_divider_9.baseRadius, endpoint_cavity_divider_9.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1);
  const mesh_cavity_divider_9 = new THREE.Mesh(
    mesh_cavity_divider_9Geometry,
    materialMap["cavity-gray"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cavity_divider_9.name = "Cavity divider wall";
  if (endpoint_cavity_divider_9) {
    mesh_cavity_divider_9.position.copy(endpoint_cavity_divider_9.midpoint);
    mesh_cavity_divider_9.quaternion.copy(endpoint_cavity_divider_9.quaternion);
  }
  mesh_cavity_divider_9.castShadow = options.castShadow ?? true;
  mesh_cavity_divider_9.receiveShadow = options.receiveShadow ?? true;
  mesh_cavity_divider_9.userData.sculptComponent = node_cavity_divider_9.userData.sculptComponent;
  node_cavity_divider_9.add(mesh_cavity_divider_9);
  meshes["cavity-divider"] = mesh_cavity_divider_9;
  colliders["cavity-divider"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["body-shell"] ??= [];
  destructionGroups["body-shell"].push(node_cavity_divider_9);

  const attachment_lever_track_10 = null;
  const endpoint_lever_track_10 = makeAttachmentEndpoint(attachment_lever_track_10);
  const node_lever_track_10 = new THREE.Group();
  node_lever_track_10.name = "Lever track collar__pivot";
  if (endpoint_lever_track_10) {
    node_lever_track_10.position.copy(endpoint_lever_track_10.start);
    node_lever_track_10.rotation.set(0, 0, 0);
    node_lever_track_10.scale.set(1, 1, 1);
  } else {
    node_lever_track_10.position.set(0.0, 0.0, 0.0);
    node_lever_track_10.rotation.set(0.0, 0.0, 0.0);
    node_lever_track_10.scale.set(1.0, 1.0, 1.0);
  }
  node_lever_track_10.userData.sculptComponent = {"id": "lever-track", "name": "Lever track collar", "level": "meso", "role": "trim", "importance": 0.6, "confidence": 0.75, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A flat-faced collar with hard chamfered corners framing the carriage channel; the reference shows a crisp step, not a blended dish.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(237, 224, 200, 1.0)", "secondaryAlbedo": "rgba(226, 210, 184, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "collar ring standing proud of the right face, framing the channel opening", "edgeTreatment": {"type": "flat-chamfer", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "ExtrudeGeometry cap and wall UVs", "normalStrategy": "flat facet normals", "profile2D": {"points": [[0.07, 0.57], [0.07, 0.98], [0.01, 1.04], [-0.13, 1.04], [-0.19, 0.98], [-0.19, 0.57], [-0.13, 0.51], [0.01, 0.51]], "depth": 0.022, "axis": "x", "axisOffset": 0.79, "holes": [[[-0.005, 0.57], [-0.005, 0.98], [-0.03, 1.005], [-0.09, 1.005], [-0.115, 0.98], [-0.115, 0.57], [-0.09, 0.545], [-0.03, 0.545]]]}}, "parent": "body-shell", "attachment": null, "dimensions": {"width": 0.022, "height": 0.53, "depth": 0.26, "units": "world", "confidence": 0.7}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.8, 0.775, 0.06], "axis": [1.0, 0.0, 0.0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shell-cream"}}, "material": "shell-cream", "materialLayers": ["shell-cream"], "deformations": [], "joints": [], "seams": [{"id": "collar-shell-seam", "with": "body-shell", "overlap": 0.012, "notes": "Collar base is buried in the shell face."}], "localFeatures": [{"id": "recessed-channel", "description": "The collar stands 0.018 units proud around a 0.16 by 0.64 opening, so the channel floor sits 0.036 units below the collar crown and reads as a cut groove.", "geometry": "extruded ring with a chamfered-rect hole; the dark floor plate sits behind it", "evidenceRefs": ["full-object", "right-control-zone"], "confidence": 0.8}, {"id": "channel-end-caps", "description": "The opening is chamfered at all four corners so the channel matches the body's facet language rather than reading as a rounded slot.", "geometry": "chamfered-rect hole outline", "evidenceRefs": ["full-object", "right-control-zone"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.72, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat cream moulding", "displacementPattern": "none", "occlusionPattern": "hard occlusion inside the collar opening", "edgeWearPattern": "light polish on the collar crown", "notes": "Modelled as a proud collar around a recessed floor because ExtrudeGeometry can only cut holes along the extrusion axis; the step reads equivalently at the review angle."}, "evidenceRefs": ["full-object", "right-control-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_lever_track_10.userData.actionProfile = node_lever_track_10.userData.sculptComponent.actionProfile;
  (nodes["body-shell"] ?? root).add(node_lever_track_10);
  nodes["lever-track"] = node_lever_track_10;
  const mesh_lever_track_10Geometry = endpoint_lever_track_10
    ? new THREE.CylinderGeometry(endpoint_lever_track_10.endRadius, endpoint_lever_track_10.baseRadius, endpoint_lever_track_10.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0.07, 0.57], [0.07, 0.98], [0.01, 1.04], [-0.13, 1.04], [-0.19, 0.98], [-0.19, 0.57], [-0.13, 0.51], [0.01, 0.51]], "depth": 0.022, "axis": "x", "axisOffset": 0.79, "holes": [[[-0.005, 0.57], [-0.005, 0.98], [-0.03, 1.005], [-0.09, 1.005], [-0.115, 0.98], [-0.115, 0.57], [-0.09, 0.545], [-0.03, 0.545]]]});
  const mesh_lever_track_10 = new THREE.Mesh(
    mesh_lever_track_10Geometry,
    materialMap["shell-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lever_track_10.name = "Lever track collar";
  if (endpoint_lever_track_10) {
    mesh_lever_track_10.position.copy(endpoint_lever_track_10.midpoint);
    mesh_lever_track_10.quaternion.copy(endpoint_lever_track_10.quaternion);
  }
  mesh_lever_track_10.castShadow = options.castShadow ?? true;
  mesh_lever_track_10.receiveShadow = options.receiveShadow ?? true;
  mesh_lever_track_10.userData.sculptComponent = node_lever_track_10.userData.sculptComponent;
  node_lever_track_10.add(mesh_lever_track_10);
  meshes["lever-track"] = mesh_lever_track_10;
  colliders["lever-track"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["body-shell"] ??= [];
  destructionGroups["body-shell"].push(node_lever_track_10);

  const attachment_lever_slot_11 = null;
  const endpoint_lever_slot_11 = makeAttachmentEndpoint(attachment_lever_slot_11);
  const node_lever_slot_11 = new THREE.Group();
  node_lever_slot_11.name = "Lever channel floor__pivot";
  if (endpoint_lever_slot_11) {
    node_lever_slot_11.position.copy(endpoint_lever_slot_11.start);
    node_lever_slot_11.rotation.set(0, 0, 0);
    node_lever_slot_11.scale.set(1, 1, 1);
  } else {
    node_lever_slot_11.position.set(0.0, 0.0, 0.0);
    node_lever_slot_11.rotation.set(0.0, 0.0, 0.0);
    node_lever_slot_11.scale.set(1.0, 1.0, 1.0);
  }
  node_lever_slot_11.userData.sculptComponent = {"id": "lever-slot", "name": "Lever channel floor", "level": "micro", "role": "recess", "importance": 0.35, "confidence": 0.65, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A flat recessed plate with straight edges forming the floor of the channel; the darkest flat value on the right face in the reference.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(110, 108, 104, 1.0)", "secondaryAlbedo": "rgba(96, 94, 90, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "dark floor plate set behind the collar opening", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "ExtrudeGeometry cap UVs", "normalStrategy": "flat facet normals", "profile2D": {"points": [[-0.01, 0.57], [-0.01, 0.98], [-0.03, 1.0], [-0.09, 1.0], [-0.11, 0.98], [-0.11, 0.57], [-0.09, 0.55], [-0.03, 0.55]], "depth": 0.02, "axis": "x", "axisOffset": 0.766}}, "parent": "lever-track", "attachment": null, "dimensions": {"width": 0.02, "height": 0.45, "depth": 0.1, "units": "world", "confidence": 0.6}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.774, 0.775, 0.06], "axis": [1.0, 0.0, 0.0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shell-cream"}}, "material": "cavity-gray", "materialLayers": ["cavity-gray"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "channel-floor", "description": "Sits 0.036 units below the collar crown so the channel reads as depth rather than as a painted dark line.", "geometry": "plate offset along the extrusion axis", "evidenceRefs": ["full-object", "right-control-zone"], "confidence": 0.7}], "surfaceDetail": {"macroRoughness": 0.88, "microRoughness": 0.06, "bumpAmplitude": 0.0, "normalPattern": "matte liner", "displacementPattern": "none", "occlusionPattern": "channel occlusion", "edgeWearPattern": "none", "notes": "Channel depth inferred; the reference cannot show the true floor distance."}, "evidenceRefs": ["full-object", "right-control-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_lever_slot_11.userData.actionProfile = node_lever_slot_11.userData.sculptComponent.actionProfile;
  (nodes["lever-track"] ?? root).add(node_lever_slot_11);
  nodes["lever-slot"] = node_lever_slot_11;
  const mesh_lever_slot_11Geometry = endpoint_lever_slot_11
    ? new THREE.CylinderGeometry(endpoint_lever_slot_11.endRadius, endpoint_lever_slot_11.baseRadius, endpoint_lever_slot_11.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-0.01, 0.57], [-0.01, 0.98], [-0.03, 1.0], [-0.09, 1.0], [-0.11, 0.98], [-0.11, 0.57], [-0.09, 0.55], [-0.03, 0.55]], "depth": 0.02, "axis": "x", "axisOffset": 0.766});
  const mesh_lever_slot_11 = new THREE.Mesh(
    mesh_lever_slot_11Geometry,
    materialMap["cavity-gray"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lever_slot_11.name = "Lever channel floor";
  if (endpoint_lever_slot_11) {
    mesh_lever_slot_11.position.copy(endpoint_lever_slot_11.midpoint);
    mesh_lever_slot_11.quaternion.copy(endpoint_lever_slot_11.quaternion);
  }
  mesh_lever_slot_11.castShadow = options.castShadow ?? true;
  mesh_lever_slot_11.receiveShadow = options.receiveShadow ?? true;
  mesh_lever_slot_11.userData.sculptComponent = node_lever_slot_11.userData.sculptComponent;
  node_lever_slot_11.add(mesh_lever_slot_11);
  meshes["lever-slot"] = mesh_lever_slot_11;
  colliders["lever-slot"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["body-shell"] ??= [];
  destructionGroups["body-shell"].push(node_lever_slot_11);

  const attachment_lever_knob_12 = null;
  const endpoint_lever_knob_12 = makeAttachmentEndpoint(attachment_lever_knob_12);
  const node_lever_knob_12 = new THREE.Group();
  node_lever_knob_12.name = "Lever knob__pivot";
  if (endpoint_lever_knob_12) {
    node_lever_knob_12.position.copy(endpoint_lever_knob_12.start);
    node_lever_knob_12.rotation.set(0, 0, 0);
    node_lever_knob_12.scale.set(1, 1, 1);
  } else {
    node_lever_knob_12.position.set(0.8, 0.775, 0.06);
    node_lever_knob_12.rotation.set(0.0, 0.0, 0.0);
    node_lever_knob_12.scale.set(1.0, 1.0, 1.0);
  }
  node_lever_knob_12.userData.sculptComponent = {"id": "lever-knob", "name": "Lever knob", "level": "meso", "role": "actuator", "importance": 0.85, "confidence": 0.85, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A chunky slab with six flat faces and a chamfer on every edge, clearly a moulded rigid part in the reference rather than a smooth blob.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 194, 68, 1.0)", "secondaryAlbedo": "rgba(224, 167, 44, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "chamfered slab projecting from the right face", "edgeTreatment": {"type": "flat-chamfer", "bevelRadius": 0.0, "segments": 1}, "deformationStack": ["outer end chamfer inset 0.035"], "uvStrategy": "ExtrudeGeometry cap and wall UVs", "normalStrategy": "flat facet normals recomputed after the profile deformation", "profile2D": {"points": [[0.195, -0.0475], [0.195, 0.0475], [0.16, 0.0825], [-0.16, 0.0825], [-0.195, 0.0475], [-0.195, -0.0475], [-0.16, -0.0825], [0.16, -0.0825]], "depth": 0.225, "axis": "x", "axisOffset": 0.0, "steps": 4, "profileStops": [[0.0, 1.0, 1.0], [0.75, 1.0, 1.0], [1.0, 0.8205, 0.5758]]}}, "parent": "body-shell", "attachment": null, "dimensions": {"width": 0.225, "height": 0.165, "depth": 0.39, "units": "world", "confidence": 0.7}, "transform": {"position": [0.8, 0.775, 0.06], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "slider", "pivot": {"mode": "socket", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.85}, "transformChannels": {"translate": true, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "lever-grip", "localPosition": [0.2, 0.0, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Outer face of the knob; the hand or an actuator grabs here."}], "collider": {"type": "box", "offset": [0.1, 0.0, 0.0], "scale": [0.2, 0.24, 0.34], "isTrigger": false, "notes": "Knob proxy."}, "constraints": [{"type": "linear-limit", "axis": [0, 1, 0], "min": -0.2, "max": 0.0, "notes": "Down 0.30 units is the fully-cocked carriage position; 0 is popped up."}], "destruction": {"breakable": false, "fractureGroup": "lever-assembly", "seamRefs": [], "detachableFragments": ["lever-knob", "lever-neck"], "breakImpulse": 0.0, "debrisMaterial": "shell-cream"}}, "material": "lever-yellow", "materialLayers": ["lever-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "knob-chamfers", "description": "Every edge of the slab carries a flat chamfer roughly 0.06 units wide, matching the body's facet language.", "geometry": "chamfered-rect extrude profile plus an end-chamfer profileStop", "evidenceRefs": ["full-object", "right-control-zone"], "confidence": 0.9}, {"id": "knob-projection", "description": "The knob stands 0.20 units clear of the right face, far enough to overhang the channel collar.", "geometry": "extrusion depth along the face normal", "evidenceRefs": ["full-object", "right-control-zone"], "confidence": 0.85}], "surfaceDetail": {"macroRoughness": 0.68, "microRoughness": 0.09, "bumpAmplitude": 0.0, "normalPattern": "flat yellow moulding", "displacementPattern": "none", "occlusionPattern": "contact shadow where it meets the collar", "edgeWearPattern": "chamfer crowns polished by handling", "notes": "Brightest saturated value in the frame; slightly smoother than the shell."}, "evidenceRefs": ["full-object", "right-control-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_lever_knob_12.userData.actionProfile = node_lever_knob_12.userData.sculptComponent.actionProfile;
  (nodes["body-shell"] ?? root).add(node_lever_knob_12);
  nodes["lever-knob"] = node_lever_knob_12;
  const mesh_lever_knob_12Geometry = endpoint_lever_knob_12
    ? new THREE.CylinderGeometry(endpoint_lever_knob_12.endRadius, endpoint_lever_knob_12.baseRadius, endpoint_lever_knob_12.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0.195, -0.0475], [0.195, 0.0475], [0.16, 0.0825], [-0.16, 0.0825], [-0.195, 0.0475], [-0.195, -0.0475], [-0.16, -0.0825], [0.16, -0.0825]], "depth": 0.225, "axis": "x", "axisOffset": 0.0, "steps": 4, "profileStops": [[0.0, 1.0, 1.0], [0.75, 1.0, 1.0], [1.0, 0.8205, 0.5758]]});
  const mesh_lever_knob_12 = new THREE.Mesh(
    mesh_lever_knob_12Geometry,
    materialMap["lever-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lever_knob_12.name = "Lever knob";
  if (endpoint_lever_knob_12) {
    mesh_lever_knob_12.position.copy(endpoint_lever_knob_12.midpoint);
    mesh_lever_knob_12.quaternion.copy(endpoint_lever_knob_12.quaternion);
  }
  mesh_lever_knob_12.castShadow = options.castShadow ?? true;
  mesh_lever_knob_12.receiveShadow = options.receiveShadow ?? true;
  mesh_lever_knob_12.userData.sculptComponent = node_lever_knob_12.userData.sculptComponent;
  node_lever_knob_12.add(mesh_lever_knob_12);
  meshes["lever-knob"] = mesh_lever_knob_12;
  colliders["lever-knob"] = {"type": "box", "offset": [0.1, 0.0, 0.0], "scale": [0.2, 0.24, 0.34], "isTrigger": false, "notes": "Knob proxy."};
  destructionGroups["lever-assembly"] ??= [];
  destructionGroups["lever-assembly"].push(node_lever_knob_12);
  const socket_lever_knob_lever_grip_0 = new THREE.Object3D();
  socket_lever_knob_lever_grip_0.name = "lever-grip";
  socket_lever_knob_lever_grip_0.position.set(0.2, 0.0, 0.0);
  socket_lever_knob_lever_grip_0.rotation.set(0.0, 0.0, 0.0);
  socket_lever_knob_lever_grip_0.userData.socket = {"id": "lever-grip", "localPosition": [0.2, 0.0, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Outer face of the knob; the hand or an actuator grabs here."};
  node_lever_knob_12.add(socket_lever_knob_lever_grip_0);
  sockets["lever-knob:lever-grip"] = socket_lever_knob_lever_grip_0;

  const attachment_lever_neck_13 = null;
  const endpoint_lever_neck_13 = makeAttachmentEndpoint(attachment_lever_neck_13);
  const node_lever_neck_13 = new THREE.Group();
  node_lever_neck_13.name = "Lever neck__pivot";
  if (endpoint_lever_neck_13) {
    node_lever_neck_13.position.copy(endpoint_lever_neck_13.start);
    node_lever_neck_13.rotation.set(0, 0, 0);
    node_lever_neck_13.scale.set(1, 1, 1);
  } else {
    node_lever_neck_13.position.set(-0.015, 0.0, 0.0);
    node_lever_neck_13.rotation.set(0.0, 0.0, 0.0);
    node_lever_neck_13.scale.set(0.06, 0.172, 0.13);
  }
  node_lever_neck_13.userData.sculptComponent = {"id": "lever-neck", "name": "Lever neck", "level": "micro", "role": "actuator", "importance": 0.3, "confidence": 0.6, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A short flat-sided stem bridging the knob to the channel; partly occluded in the reference but its flat sides are visible above and below the knob.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(247, 194, 68, 1.0)", "secondaryAlbedo": "rgba(224, 167, 44, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "stem passing through the channel opening", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "box UVs", "normalStrategy": "vertex normals from generated geometry"}, "parent": "lever-knob", "attachment": null, "dimensions": {"width": 0.06, "height": 0.172, "depth": 0.13, "units": "world", "confidence": 0.55}, "transform": {"position": [-0.015, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0]}, "actionProfile": {"animationRole": "slider", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.6}, "transformChannels": {"translate": true, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lever-assembly", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shell-cream"}}, "material": "lever-yellow", "materialLayers": ["lever-yellow"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "neck-through-slot", "description": "Fills the channel opening behind the knob so no gap shows through to the shell interior.", "geometry": "box sized to the collar opening, rides with the knob", "evidenceRefs": ["full-object", "right-control-zone"], "confidence": 0.6}], "surfaceDetail": {"macroRoughness": 0.7, "microRoughness": 0.09, "bumpAmplitude": 0.0, "normalPattern": "flat yellow moulding", "displacementPattern": "none", "occlusionPattern": "occlusion inside the channel", "edgeWearPattern": "none", "notes": "Partly inferred: the reference only shows the neck where the knob does not cover it."}, "evidenceRefs": ["full-object", "right-control-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_lever_neck_13.userData.actionProfile = node_lever_neck_13.userData.sculptComponent.actionProfile;
  (nodes["lever-knob"] ?? root).add(node_lever_neck_13);
  nodes["lever-neck"] = node_lever_neck_13;
  const mesh_lever_neck_13Geometry = endpoint_lever_neck_13
    ? new THREE.CylinderGeometry(endpoint_lever_neck_13.endRadius, endpoint_lever_neck_13.baseRadius, endpoint_lever_neck_13.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1);
  const mesh_lever_neck_13 = new THREE.Mesh(
    mesh_lever_neck_13Geometry,
    materialMap["lever-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lever_neck_13.name = "Lever neck";
  if (endpoint_lever_neck_13) {
    mesh_lever_neck_13.position.copy(endpoint_lever_neck_13.midpoint);
    mesh_lever_neck_13.quaternion.copy(endpoint_lever_neck_13.quaternion);
  }
  mesh_lever_neck_13.castShadow = options.castShadow ?? true;
  mesh_lever_neck_13.receiveShadow = options.receiveShadow ?? true;
  mesh_lever_neck_13.userData.sculptComponent = node_lever_neck_13.userData.sculptComponent;
  node_lever_neck_13.add(mesh_lever_neck_13);
  meshes["lever-neck"] = mesh_lever_neck_13;
  colliders["lever-neck"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["lever-assembly"] ??= [];
  destructionGroups["lever-assembly"].push(node_lever_neck_13);

  const attachment_control_plate_14 = null;
  const endpoint_control_plate_14 = makeAttachmentEndpoint(attachment_control_plate_14);
  const node_control_plate_14 = new THREE.Group();
  node_control_plate_14.name = "Control plate__pivot";
  if (endpoint_control_plate_14) {
    node_control_plate_14.position.copy(endpoint_control_plate_14.start);
    node_control_plate_14.rotation.set(0, 0, 0);
    node_control_plate_14.scale.set(1, 1, 1);
  } else {
    node_control_plate_14.position.set(0.81, 0.34, 0.07);
    node_control_plate_14.rotation.set(0.0, 0.0, 0.0);
    node_control_plate_14.scale.set(1.0, 1.0, 1.0);
  }
  node_control_plate_14.userData.sculptComponent = {"id": "control-plate", "name": "Control plate", "level": "meso", "role": "trim", "importance": 0.55, "confidence": 0.7, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A shallow raised pad with a flat top and hard chamfered corners; the reference shows its outline as a step in the shell face, so it is a real part, not a decal.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(237, 224, 200, 1.0)", "secondaryAlbedo": "rgba(226, 210, 184, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "raised pad carrying the dial and its tick arc", "edgeTreatment": {"type": "flat-chamfer", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "ExtrudeGeometry cap and wall UVs", "normalStrategy": "flat facet normals", "profile2D": {"points": [[0.31, -0.148], [0.31, 0.148], [0.2, 0.258], [-0.2, 0.258], [-0.31, 0.148], [-0.31, -0.148], [-0.2, -0.258], [0.2, -0.258]], "depth": 0.01, "axis": "-x", "axisOffset": 0.0}}, "parent": "body-shell", "attachment": null, "dimensions": {"width": 0.01, "height": 0.516, "depth": 0.62, "units": "world", "confidence": 0.6}, "transform": {"position": [0.81, 0.34, 0.07], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "socket", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shell-cream"}}, "material": "shell-cream", "materialLayers": ["shell-cream"], "deformations": [], "joints": [], "seams": [{"id": "plate-shell-seam", "with": "body-shell", "overlap": 0.017, "notes": "Pad extrudes inward from its outer face into the shell."}], "localFeatures": [{"id": "raised-pad-edge", "description": "The pad stands 0.017 units proud of the shell face; its chamfered outline is the faint arc visible above and left of the dial.", "geometry": "shallow extrusion along the face normal", "evidenceRefs": ["full-object", "right-control-zone"], "confidence": 0.75}, {"id": "tick-arc", "description": "Nine short coral nubs sit on a 0.19 unit circle around the dial axis; the lowest three or four are hidden behind the plinth, which is why the reference reads as an arc rather than a full ring.", "geometry": "InstancedMesh of nine boxes on a radial placement, one draw call", "evidenceRefs": ["full-object", "right-control-zone"], "confidence": 0.8}], "surfaceDetail": {"macroRoughness": 0.72, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat cream moulding", "displacementPattern": "none", "occlusionPattern": "soft step shadow around the pad outline", "edgeWearPattern": "none", "notes": "Pad extent partly occluded by the dial and the plinth."}, "evidenceRefs": ["full-object", "right-control-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_control_plate_14.userData.actionProfile = node_control_plate_14.userData.sculptComponent.actionProfile;
  (nodes["body-shell"] ?? root).add(node_control_plate_14);
  nodes["control-plate"] = node_control_plate_14;
  const mesh_control_plate_14Geometry = endpoint_control_plate_14
    ? new THREE.CylinderGeometry(endpoint_control_plate_14.endRadius, endpoint_control_plate_14.baseRadius, endpoint_control_plate_14.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0.31, -0.148], [0.31, 0.148], [0.2, 0.258], [-0.2, 0.258], [-0.31, 0.148], [-0.31, -0.148], [-0.2, -0.258], [0.2, -0.258]], "depth": 0.01, "axis": "-x", "axisOffset": 0.0});
  const mesh_control_plate_14 = new THREE.Mesh(
    mesh_control_plate_14Geometry,
    materialMap["shell-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_control_plate_14.name = "Control plate";
  if (endpoint_control_plate_14) {
    mesh_control_plate_14.position.copy(endpoint_control_plate_14.midpoint);
    mesh_control_plate_14.quaternion.copy(endpoint_control_plate_14.quaternion);
  }
  mesh_control_plate_14.castShadow = options.castShadow ?? true;
  mesh_control_plate_14.receiveShadow = options.receiveShadow ?? true;
  mesh_control_plate_14.userData.sculptComponent = node_control_plate_14.userData.sculptComponent;
  node_control_plate_14.add(mesh_control_plate_14);
  meshes["control-plate"] = mesh_control_plate_14;
  colliders["control-plate"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["body-shell"] ??= [];
  destructionGroups["body-shell"].push(node_control_plate_14);

  const attachment_control_dial_15 = null;
  const endpoint_control_dial_15 = makeAttachmentEndpoint(attachment_control_dial_15);
  const node_control_dial_15 = new THREE.Group();
  node_control_dial_15.name = "Control dial__pivot";
  if (endpoint_control_dial_15) {
    node_control_dial_15.position.copy(endpoint_control_dial_15.start);
    node_control_dial_15.rotation.set(0, 0, 0);
    node_control_dial_15.scale.set(1, 1, 1);
  } else {
    node_control_dial_15.position.set(0.8, 0.34, 0.07);
    node_control_dial_15.rotation.set(0.0, 0.0, 0.0);
    node_control_dial_15.scale.set(1.0, 1.0, 1.0);
  }
  node_control_dial_15.userData.sculptComponent = {"id": "control-dial", "name": "Control dial", "level": "meso", "role": "control", "importance": 0.8, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A twelve-sided faceted knob: the reference shows countable flat facets around its rim and a flat chamfered outer face, not a smooth turned cylinder.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(222, 85, 77, 1.0)", "secondaryAlbedo": "rgba(212, 78, 70, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "faceted rotary knob with a chamfered outer face", "edgeTreatment": {"type": "flat-chamfer", "bevelRadius": 0.0, "segments": 1}, "deformationStack": ["outer face chamfer inset 0.018"], "uvStrategy": "ExtrudeGeometry cap and wall UVs", "normalStrategy": "flat facet normals recomputed after the profile deformation", "profile2D": {"points": [[0.14489, 0.03882], [0.10607, 0.10607], [0.03882, 0.14489], [-0.03882, 0.14489], [-0.10607, 0.10607], [-0.14489, 0.03882], [-0.14489, -0.03882], [-0.10607, -0.10607], [-0.03882, -0.14489], [0.03882, -0.14489], [0.10607, -0.10607], [0.14489, -0.03882]], "depth": 0.088, "axis": "x", "axisOffset": 0.0, "steps": 5, "profileStops": [[0.0, 1.0, 1.0], [0.8, 1.0, 1.0], [1.0, 0.88, 0.88]]}}, "parent": "body-shell", "attachment": null, "dimensions": {"width": 0.088, "height": 0.3, "depth": 0.3, "units": "world", "confidence": 0.7}, "transform": {"position": [0.8, 0.34, 0.07], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "rotator", "pivot": {"mode": "socket", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "dial-pointer", "localPosition": [0.096, 0.11, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Tip of the pointer rib; read the browning setting from its angle."}], "collider": {"type": "cylinder", "offset": [0.05, 0.0, 0.0], "scale": [0.1, 0.24, 0.24], "isTrigger": false, "notes": "Knob proxy; axis is world X."}, "constraints": [{"type": "angular-limit", "axis": [1, 0, 0], "min": -2.79, "max": 2.79, "notes": "Nine detents spanning 320 degrees, one per tick mark."}], "destruction": {"breakable": false, "fractureGroup": "control-assembly", "seamRefs": [], "detachableFragments": ["control-dial", "dial-notch"], "breakImpulse": 0.0, "debrisMaterial": "shell-cream"}}, "material": "accent-coral", "materialLayers": ["accent-coral"], "deformations": [], "joints": [], "seams": [{"id": "dial-plate-seam", "with": "control-plate", "overlap": 0.017, "notes": "Knob base is buried in the pad."}], "localFeatures": [{"id": "faceted-rim", "description": "Twelve flat rim facets catch the key light as discrete bands rather than a continuous specular sweep.", "geometry": "twelve-sided extrude profile", "evidenceRefs": ["full-object", "right-control-zone"], "confidence": 0.8}, {"id": "outer-face-chamfer", "description": "The outer face steps in by 0.018 units, giving the knob a flat crown ringed by a narrow chamfer.", "geometry": "final profileStop", "evidenceRefs": ["full-object", "right-control-zone"], "confidence": 0.8}, {"id": "plinth-straddle", "description": "The knob axis sits 0.06 units above the plinth top and the knob projects past the plinth face, so its lower third overlaps the coral slab exactly as in the reference.", "geometry": "component position, not geometry", "evidenceRefs": ["full-object", "right-control-zone", "base-plinth-zone"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.7, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat coral moulding", "displacementPattern": "none", "occlusionPattern": "undercut shadow where the knob meets the pad", "edgeWearPattern": "none", "notes": "Same coral pigment as the bezel and plinth."}, "evidenceRefs": ["full-object", "right-control-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_control_dial_15.userData.actionProfile = node_control_dial_15.userData.sculptComponent.actionProfile;
  (nodes["body-shell"] ?? root).add(node_control_dial_15);
  nodes["control-dial"] = node_control_dial_15;
  const mesh_control_dial_15Geometry = endpoint_control_dial_15
    ? new THREE.CylinderGeometry(endpoint_control_dial_15.endRadius, endpoint_control_dial_15.baseRadius, endpoint_control_dial_15.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0.14489, 0.03882], [0.10607, 0.10607], [0.03882, 0.14489], [-0.03882, 0.14489], [-0.10607, 0.10607], [-0.14489, 0.03882], [-0.14489, -0.03882], [-0.10607, -0.10607], [-0.03882, -0.14489], [0.03882, -0.14489], [0.10607, -0.10607], [0.14489, -0.03882]], "depth": 0.088, "axis": "x", "axisOffset": 0.0, "steps": 5, "profileStops": [[0.0, 1.0, 1.0], [0.8, 1.0, 1.0], [1.0, 0.88, 0.88]]});
  const mesh_control_dial_15 = new THREE.Mesh(
    mesh_control_dial_15Geometry,
    materialMap["accent-coral"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_control_dial_15.name = "Control dial";
  if (endpoint_control_dial_15) {
    mesh_control_dial_15.position.copy(endpoint_control_dial_15.midpoint);
    mesh_control_dial_15.quaternion.copy(endpoint_control_dial_15.quaternion);
  }
  mesh_control_dial_15.castShadow = options.castShadow ?? true;
  mesh_control_dial_15.receiveShadow = options.receiveShadow ?? true;
  mesh_control_dial_15.userData.sculptComponent = node_control_dial_15.userData.sculptComponent;
  node_control_dial_15.add(mesh_control_dial_15);
  meshes["control-dial"] = mesh_control_dial_15;
  colliders["control-dial"] = {"type": "cylinder", "offset": [0.05, 0.0, 0.0], "scale": [0.1, 0.24, 0.24], "isTrigger": false, "notes": "Knob proxy; axis is world X."};
  destructionGroups["control-assembly"] ??= [];
  destructionGroups["control-assembly"].push(node_control_dial_15);
  const socket_control_dial_dial_pointer_0 = new THREE.Object3D();
  socket_control_dial_dial_pointer_0.name = "dial-pointer";
  socket_control_dial_dial_pointer_0.position.set(0.096, 0.11, 0.0);
  socket_control_dial_dial_pointer_0.rotation.set(0.0, 0.0, 0.0);
  socket_control_dial_dial_pointer_0.userData.socket = {"id": "dial-pointer", "localPosition": [0.096, 0.11, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Tip of the pointer rib; read the browning setting from its angle."};
  node_control_dial_15.add(socket_control_dial_dial_pointer_0);
  sockets["control-dial:dial-pointer"] = socket_control_dial_dial_pointer_0;

  const attachment_dial_notch_16 = null;
  const endpoint_dial_notch_16 = makeAttachmentEndpoint(attachment_dial_notch_16);
  const node_dial_notch_16 = new THREE.Group();
  node_dial_notch_16.name = "Dial pointer mark__pivot";
  if (endpoint_dial_notch_16) {
    node_dial_notch_16.position.copy(endpoint_dial_notch_16.start);
    node_dial_notch_16.rotation.set(0, 0, 0);
    node_dial_notch_16.scale.set(1, 1, 1);
  } else {
    node_dial_notch_16.position.set(0.096, 0.055, 0.0);
    node_dial_notch_16.rotation.set(0.0, 0.0, 0.0);
    node_dial_notch_16.scale.set(0.03, 0.11, 0.045);
  }
  node_dial_notch_16.userData.sculptComponent = {"id": "dial-notch", "name": "Dial pointer mark", "level": "micro", "role": "control", "importance": 0.3, "confidence": 0.7, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A short raised rib with flat sides on the knob crown, visible in the reference as a hard-edged pointer running from the knob centre toward its rim.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(222, 85, 77, 1.0)", "secondaryAlbedo": "rgba(212, 78, 70, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "raised pointer rib on the knob crown", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "box UVs", "normalStrategy": "vertex normals from generated geometry"}, "parent": "control-dial", "attachment": null, "dimensions": {"width": 0.03, "height": 0.11, "depth": 0.045, "units": "world", "confidence": 0.7}, "transform": {"position": [0.096, 0.055, 0.0], "rotation": [0.0, 0.0, 0.0]}, "actionProfile": {"animationRole": "rotator", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "control-assembly", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shell-cream"}}, "material": "accent-coral", "materialLayers": ["accent-coral"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "pointer-rib", "description": "Stands 0.015 units proud of the knob crown and reads as a shadowed groove pair at the reference lighting angle.", "geometry": "box rib parented to the knob so it turns with it", "evidenceRefs": ["full-object", "right-control-zone"], "confidence": 0.7}], "surfaceDetail": {"macroRoughness": 0.7, "microRoughness": 0.1, "bumpAmplitude": 0.0, "normalPattern": "flat coral moulding", "displacementPattern": "none", "occlusionPattern": "hard shadow either side of the rib", "edgeWearPattern": "none", "notes": "The reference rib has a slight L bend; modelled as a straight bar."}, "evidenceRefs": ["full-object", "right-control-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_dial_notch_16.userData.actionProfile = node_dial_notch_16.userData.sculptComponent.actionProfile;
  (nodes["control-dial"] ?? root).add(node_dial_notch_16);
  nodes["dial-notch"] = node_dial_notch_16;
  const mesh_dial_notch_16Geometry = endpoint_dial_notch_16
    ? new THREE.CylinderGeometry(endpoint_dial_notch_16.endRadius, endpoint_dial_notch_16.baseRadius, endpoint_dial_notch_16.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1);
  const mesh_dial_notch_16 = new THREE.Mesh(
    mesh_dial_notch_16Geometry,
    materialMap["accent-coral"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_dial_notch_16.name = "Dial pointer mark";
  if (endpoint_dial_notch_16) {
    mesh_dial_notch_16.position.copy(endpoint_dial_notch_16.midpoint);
    mesh_dial_notch_16.quaternion.copy(endpoint_dial_notch_16.quaternion);
  }
  mesh_dial_notch_16.castShadow = options.castShadow ?? true;
  mesh_dial_notch_16.receiveShadow = options.receiveShadow ?? true;
  mesh_dial_notch_16.userData.sculptComponent = node_dial_notch_16.userData.sculptComponent;
  node_dial_notch_16.add(mesh_dial_notch_16);
  meshes["dial-notch"] = mesh_dial_notch_16;
  colliders["dial-notch"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["control-assembly"] ??= [];
  destructionGroups["control-assembly"].push(node_dial_notch_16);

  // repetition system: dial-tick-ring (InstancedMesh, radial, count=9, level=micro)
  {
    const parent = nodes["control-plate"] ?? root;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = materialMap["accent-coral"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    const scl = [0.048, 0.022, 0.022];
    const axis = new THREE.Vector3(1.0, 0.0, 0.0).normalize();
    const radius = 0.39;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 9);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0]!, scl[1]!, scl[2]!);
    for (let i = 0; i < 9; i++) {
      const ang = ((160.0) + (i * 360) / 9) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "dial-tick-ring";
    parent.add(cluster);
  }

  // repetition system: cavity-element-tabs (InstancedMesh, rows, count=6, level=micro)
  {
    const parent = nodes["slot-cavity"] ?? root;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = materialMap["cavity-gray"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    const scl = [0.055, 0.0645, 0.045];
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 6);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0]!, scl[1]!, scl[2]!);
    // refine-code: the repetition emitter only places instances on a radial ring.
    // The six element tabs sit in two rows of three along the slot length, so they use
    // the explicit local positions authored in the spec's placement.instances. Still one
    // InstancedMesh, still one draw call.
    const tabPositions: [number, number, number][] = [
      [-0.28000, 1.20080, 0.06750],
      [0.00000, 1.20080, 0.06750],
      [0.28000, 1.20080, 0.06750],
      [-0.28000, 1.20080, -0.29050],
      [0.00000, 1.20080, -0.29050],
      [0.28000, 1.20080, -0.29050],
    ];
    for (let i = 0; i < 6; i++) {
      const p = tabPositions[i]!;
      _p.set(p[0], p[1], p[2]);
      _q.identity();
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "cavity-element-tabs";
    parent.add(cluster);
  }

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 1024, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "ranAnyway": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "measuredConfidence": {"shell-cream": 0.842, "accent-coral": 0.848, "lever-yellow": 0.723, "cavity-gray": 0.826}, "acceptedLimitation": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. The reference is a flat-paint stylised render with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the asset stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars below."}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness, height, normal or AO", "single-frequency random noise", "glossy toy-plastic highlights on a matte moulded surface", "local colour described only in prose without material masks", "claiming exact PBR recovery from one image"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare the albedo palette and the local colour zones.", "Compare roughness and normal response under the key light.", "Compare cavity darkening, seam occlusion and chamfer-crown polish.", "Compare key, fill and rim structure, exposure, tone mapping and background.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals and uniform roughness.", "Capture a reference-matched render from the solved camera."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createApartmentToasterLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Apartment Toaster look-dev lights";
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
  lights.userData.lightingFromPhoto = ["Ambient dominance: the reference is a soft studio render, not a key-lit one. Measured cream values are 235,218,197 on the lit front face and 238,216,186 on the shaded right end face - within two percent of each other. A warm hemisphere (#FFEED2 sky over #E4D6BE ground) at about 3.8 reproduces that near-shadowless value range.", "Key light: a gentle warm directional source (#FFE9C9) at about 1.3 from high and to the camera left. It only has to lift the top deck to 249,235,220, about six percent above the front face; a stronger key drives the end face far darker than the reference.", "Rim and environment light: weak warm back light at about 0.35. The room environment map is deliberately off for the reference-matched render: its neutral white irradiance washes the warm plastic toward grey and drops the cream chroma from 0.16 to 0.05.", "Exposure and tone mapping: ACES filmic tone mapping with sRGB output at exposure 1.0. The reference holds a narrow value range with no blown highlights and no crushed shadows.", "Contact shadow: cavity ambient occlusion plus a soft ground shadow. The slot pocket, the lever channel and the plinth seam carry the darkest values; the review render has no ground plane so the silhouette mask stays clean."];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 1024, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "ranAnyway": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "measuredConfidence": {"shell-cream": 0.842, "accent-coral": 0.848, "lever-yellow": 0.723, "cavity-gray": 0.826}, "acceptedLimitation": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. The reference is a flat-paint stylised render with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the asset stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars below."}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness, height, normal or AO", "single-frequency random noise", "glossy toy-plastic highlights on a matte moulded surface", "local colour described only in prose without material masks", "claiming exact PBR recovery from one image"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare the albedo palette and the local colour zones.", "Compare roughness and normal response under the key light.", "Compare cavity darkening, seam occlusion and chamfer-crown polish.", "Compare key, fill and rim structure, exposure, tone mapping and background.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals and uniform roughness.", "Capture a reference-matched render from the solved camera."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createApartmentToasterEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
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
export function frameApartmentToasterCamera(
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
export function createApartmentToasterPresentationComposer(
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

export function configureApartmentToasterRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createApartmentToasterInspectControls(
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
