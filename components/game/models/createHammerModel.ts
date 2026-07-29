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

type SculptMaterialSpec = {
  [key: string]: unknown;
  baseColor?: string;
  color?: string;
  albedo?: { [key: string]: unknown; dominant?: unknown; secondary?: unknown };
  colorVariation?: { [key: string]: unknown; palette?: unknown };
  textureResolution?: number;
  textureProjection?: { [key: string]: unknown; anisotropy?: number };
  surfaceFrequencyBands?: unknown;
  normal?: unknown;
  bump?: unknown;
  displacement?: unknown;
  ambientOcclusion?: unknown;
  doubleSided?: boolean;
  emissive?: string;
  attenuationColor?: string;
  sheenColor?: string;
  specularColor?: string;
  colorGradient?: ColorGradientSpec;
  referencePbr?: {
    [key: string]: unknown;
    usable?: unknown;
    confidence?: unknown;
    estimatedFidelity?: unknown;
    targetThreshold?: unknown;
    maps?: unknown;
  };
};

// bevelEnabled defaults to true on THREE.ExtrudeGeometry and rounds every
// corner — sharp/pointed profiles (blades, fork tines, spikes) need
// bevelEnabled: false plus lineTo()-only path segments near the tip, since a
// curve command cannot produce a true converging point.
function buildExtrudeShape(points: [number, number][], holes?: [number, number][][]): THREE.Shape {
  const shape = new THREE.Shape();
  if (points.length > 0) {
    shape.moveTo(points[0]![0], points[0]![1]);
    for (let i = 1; i < points.length; i += 1) {
      shape.lineTo(points[i]![0], points[i]![1]);
    }
  }
  // Cutouts (e.g. an oval wire-cutter hole) as THREE.Path added to shape.holes —
  // dep-free boolean subtraction via the tessellator, no CSG library needed.
  for (const loop of holes ?? []) {
    if (loop.length < 3) continue;
    const path = new THREE.Path();
    path.moveTo(loop[0]![0], loop[0]![1]);
    for (let i = 1; i < loop.length; i += 1) path.lineTo(loop[i]![0], loop[i]![1]);
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

function buildExtrudeGeometry(profile: { points: [number, number][]; depth: number; holes?: [number, number][][]; ovalHoles?: { cx: number; cy: number; rx: number; ry: number }[] }): THREE.ExtrudeGeometry {
  const holes = [...(profile.holes ?? []), ...((profile.ovalHoles ?? []).map((o) => ovalLoop(o.cx, o.cy, o.rx, o.ry)))];
  const shape = buildExtrudeShape(profile.points, holes);
  return new THREE.ExtrudeGeometry(shape, {
    depth: profile.depth,
    bevelEnabled: false,
    steps: 1,
  });
}

function buildLatheGeometry(profile: { points: [number, number][]; segments?: number }): THREE.LatheGeometry {
  const points = profile.points.map(([x, y]) => new THREE.Vector2(Math.max(0.0001, x ?? 0.0001), y ?? 0));
  return new THREE.LatheGeometry(points, profile.segments ?? 24);
}

function buildTubeGeometry(
  path: { points: [number, number, number][]; radius?: number; radialSegments?: number; closed?: boolean },
): THREE.TubeGeometry {
  const vectors = path.points.map(([x, y, z]) => new THREE.Vector3(x ?? 0, y ?? 0, z ?? 0));
  const curve = new THREE.CatmullRomCurve3(vectors, path.closed ?? false);
  const tubularSegments = Math.max(8, path.points.length * 6);
  return new THREE.TubeGeometry(curve, tubularSegments, path.radius ?? 0.05, path.radialSegments ?? 8, path.closed ?? false);
}

// Plan 1.3 F.6 — sweep a thin 2D cross-section along a 3D spine so a curved
// form (hooked blade, handle) reads correctly from EVERY camera angle, not just
// the reference angle a flat extrude happens to match. Uses ExtrudeGeometry's
// native extrudePath; bevelEnabled: false keeps sharp tips (same rule as F.5).
function buildCurveSweepGeometry(
  sweep: { spine: [number, number, number][]; crossSection: { points: [number, number][] }; closed?: boolean },
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const cs = sweep.crossSection.points;
  if (cs.length > 0) {
    shape.moveTo(cs[0]![0], cs[0]![1]);
    for (let i = 1; i < cs.length; i += 1) shape.lineTo(cs[i]![0], cs[i]![1]);
    shape.closePath();
  }
  const spine = sweep.spine.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const path = new THREE.CatmullRomCurve3(spine, sweep.closed ?? false);
  return new THREE.ExtrudeGeometry(shape, {
    extrudePath: path,
    steps: Math.max(24, spine.length * 8),
    bevelEnabled: false,
  });
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
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
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
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
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
  // The joint record documents that the part touches its parent. It does not
  // describe the part's form: these parts carry measured lathe, sweep and tube
  // profiles, and deriving a tapered cylinder from the endpoints would throw all
  // of that away. Only a part whose form genuinely IS a straight member should
  // take its geometry from here.
  if (record.geometryFromEndpoint === false) return null;
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

// --- img2threejs refine-code edits applied by assets/reference/hammer/apply_refinements.py
// Generated from ObjectSculptSpec target: Apartment Claw Hammer On Wall Bracket
// Sculpt build pass: optimization-pass
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createApartmentClawHammerOnWallBracketModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Apartment Claw Hammer On Wall Bracket";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "solveMethod": "Bracketed rather than solved. The prop carries no circle whose projected ellipse would fix the elevation the way the beach ball's valve cap did. The poll drum's face is the only candidate and it is partly occluded by its own collar, so its 216/260 axis ratio bounds the combined yaw and elevation near 34 degrees without separating them.", "fovDegrees": 26.0, "aspect": 0.75, "orientation": {"yaw": -24.0, "pitch": -12.0, "roll": 0.0}, "targetHint": [0.0, 1.1, 0.0], "note": "Yaw and pitch are a starting bracket for the review harness, not a solve. The harness fits camera distance by matching the render's projected bounding box to the reference box (x 153-974, y 144-1290 of 1086x1448), so framing error does not contaminate the Tier 1 scale delta."}, "approximationNotes": []};

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["head-coral"] = createSculptMaterial(
    "head-coral",
    {"id": "head-coral", "name": "Head coral plastic", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#ff5c65", "color": "#ff5c65", "albedo": {"dominant": "#ff5c65", "secondary": ["#F76B5D", "#DB564B", "#C44C42"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#ff5c65", "#F76B5D", "#DB564B", "#C44C42"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 256, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.6, "variation": 0.13, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; crowns and handled edges trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.55, "contactShadowBias": 0.3, "notes": "Darken every part seam, recess and contact ring."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "poll-face-polish", "target": "poll-drum striking face", "notes": "The struck face is the smoothest zone on the head; the reference shows its brightest, tightest highlight there.", "evidenceRefs": ["head-zone"], "roughness": 0.48, "clearcoat": 0.06}, {"id": "poll-step-shade", "target": "poll-drum step groove", "notes": "The recessed ring between collar and drum reads about 12 percent darker than the drum crown.", "evidenceRefs": ["head-zone"], "dirtAmount": 0.0, "cavityBias": 0.75, "roughness": 0.68}, {"id": "claw-fork-shade", "target": "claw fork slot floor", "notes": "The slot between the tines is the darkest coral on the prop.", "evidenceRefs": ["head-zone"], "cavityBias": 0.85, "roughness": 0.7}, {"id": "head-chamfer-catch", "target": "head-body chamfers", "notes": "Every chamfer carries a bright rim line under the key light.", "evidenceRefs": ["full-object", "head-zone"], "roughness": 0.52}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\hammer\\evidence\\crops\\head-coral-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.717, "estimatedFidelity": 0.717, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\hammer\\evidence\\pbr\\head-coral_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\hammer\\evidence\\pbr\\head-coral_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\hammer\\evidence\\pbr\\head-coral_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\hammer\\evidence\\pbr\\head-coral_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\hammer\\evidence\\pbr\\head-coral_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "Coral is the loudest colour on the prop and reads as one matte moulded plastic across poll, block and claw, with no metal response anywhere."},
    options
  );
  materialMap["handle-cream"] = createSculptMaterial(
    "handle-cream",
    {"id": "handle-cream", "name": "Handle cream plastic", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#fff3cf", "color": "#fff3cf", "albedo": {"dominant": "#fff3cf", "secondary": ["#F5E0BF", "#EBD3AB", "#DCC49B"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#fff3cf", "#F5E0BF", "#EBD3AB", "#DCC49B"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 256, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.62, "variation": 0.11, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; crowns and handled edges trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.5, "contactShadowBias": 0.3, "notes": "Darken every part seam, recess and contact ring."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "swell-crown-polish", "target": "handle-shaft butt swell crown", "notes": "The swell's crown is the brightest cream on the prop, about 12 percent above the flank.", "evidenceRefs": ["handle-zone"], "roughness": 0.55}, {"id": "collar-contact-shade", "target": "handle-shaft under the clamp collar", "notes": "A dark contact ring where the navy band grips the shaft.", "evidenceRefs": ["bracket-zone", "handle-zone"], "cavityBias": 0.8, "dirtAmount": 0.04}, {"id": "eye-seam-shade", "target": "handle-shaft at the head eye", "notes": "The cream darkens where it enters the coral eye collar.", "evidenceRefs": ["head-zone"], "cavityBias": 0.75}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\hammer\\evidence\\crops\\handle-cream-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.703, "estimatedFidelity": 0.703, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\hammer\\evidence\\pbr\\handle-cream_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\hammer\\evidence\\pbr\\handle-cream_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\hammer\\evidence\\pbr\\handle-cream_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\hammer\\evidence\\pbr\\handle-cream_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\hammer\\evidence\\pbr\\handle-cream_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "A warm cream, slightly lighter at the crown boss than at the grip because the boss faces the key light. One material, not two."},
    options
  );
  materialMap["bracket-navy"] = createSculptMaterial(
    "bracket-navy",
    {"id": "bracket-navy", "name": "Bracket navy plastic", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#24324a", "color": "#24324a", "albedo": {"dominant": "#24324a", "secondary": ["#334052", "#273140", "#212C3D"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#24324a", "#334052", "#273140", "#212C3D"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 256, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.66, "variation": 0.12, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; crowns and handled edges trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.62, "contactShadowBias": 0.3, "notes": "Darken every part seam, recess and contact ring."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "bore-wall-shade", "target": "bracket-plate screw bores", "notes": "Both bore walls fall to near black, which is what makes the holes read as openings rather than dots.", "evidenceRefs": ["bracket-zone"], "cavityBias": 0.9, "roughness": 0.74}, {"id": "band-crown-polish", "target": "bracket-collar band crown", "notes": "The band's crown catches the strongest highlight on the bracket.", "evidenceRefs": ["bracket-zone"], "roughness": 0.58}, {"id": "lug-split-line", "target": "bracket-collar-lug split", "notes": "A thin dark line across the lug where the clamp halves meet, with no measurable depth, so it is a panel line rather than a groove.", "evidenceRefs": ["bracket-zone"], "cavityBias": 0.6, "roughness": 0.7}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\hammer\\evidence\\crops\\bracket-navy-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.754, "estimatedFidelity": 0.754, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\hammer\\evidence\\pbr\\bracket-navy_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\hammer\\evidence\\pbr\\bracket-navy_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\hammer\\evidence\\pbr\\bracket-navy_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\hammer\\evidence\\pbr\\bracket-navy_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\hammer\\evidence\\pbr\\bracket-navy_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "The darkest material on the prop. Its plate sample reads 33,44,61 and its arm 39,49,64, a difference that is lighting rather than two materials."},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const attachment_handle_shaft_0 = null;
  const endpoint_handle_shaft_0 = makeAttachmentEndpoint(attachment_handle_shaft_0);
  const node_handle_shaft_0 = new THREE.Group();
  node_handle_shaft_0.name = "Handle shaft__pivot";
  if (endpoint_handle_shaft_0) {
    node_handle_shaft_0.position.copy(endpoint_handle_shaft_0.start);
    node_handle_shaft_0.rotation.set(0, 0, 0);
    node_handle_shaft_0.scale.set(1, 1, 1);
  } else {
    node_handle_shaft_0.position.set(0.0, 0.0, 0.0);
    node_handle_shaft_0.rotation.set(0.0, 0.0, 0.0);
    node_handle_shaft_0.scale.set(1.0, 1.0, 1.0);
  }
  node_handle_shaft_0.userData.sculptComponent = {"id": "handle-shaft", "name": "Handle shaft", "level": "macro", "role": "structural-spine", "importance": 0.9, "confidence": 0.9, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "A single surface of revolution whose radius varies continuously from the butt swell to the crown, with no edge anywhere along it. A box stack or a plain cylinder would lose the swell that fixes the grip's read.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 243, 207, 1.0)", "secondaryAlbedo": "rgba(229, 218, 186, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "revolved tapered shaft with a butt swell and a crown boss", "edgeTreatment": {"type": "fillet", "bevelRadius": 0.02, "segments": 3}, "deformationStack": [], "uvStrategy": "generated primitive UVs", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.01, 0.0], [0.079, 0.0192], [0.17, 0.096], [0.19, 0.2112], [0.207, 0.3264], [0.199, 0.4415], [0.188, 0.5567], [0.181, 0.6335], [0.166, 0.7871], [0.155, 1.0942], [0.15, 1.3246], [0.156, 1.4974], [0.158, 1.651], [0.158, 2.0829], [0.15, 2.1693], [0.01, 2.2]], "segments": 28}}, "parent": null, "attachment": null, "dimensions": {"width": 0.414, "height": 2.2, "depth": 0.414, "units": "world", "confidence": 0.9}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "custom", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "grip-centre", "position": [0, 0.55, 0]}, {"id": "swing-pivot", "position": [0, 2.2, 0]}], "collider": {"type": "capsule", "offset": [0, 1.1, 0], "scale": [0.414, 2.2, 0.414], "isTrigger": false, "notes": "Capsule proxy along the shaft; the trap's own colliders are authored in TrapRenderer and are not replaced by this prop."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handle", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "handle-cream", "materialLayers": ["handle-cream"], "deformations": [], "joints": [], "seams": [{"id": "shaft-to-head", "withComponent": "head-body", "overlapWorldUnits": 0.557, "notes": "The shaft runs through the whole head, so the overlap is the head's full height rather than a lip."}, {"id": "shaft-to-collar", "withComponent": "bracket-collar", "overlapWorldUnits": 0.037, "notes": "The collar ring's inner wall sits 0.037 inside the shaft radius."}], "localFeatures": [{"id": "butt-swell", "description": "The shaft widens from radius 0.150 at y 1.325 to 0.207 at y 0.326 before rounding into the butt, which is the only bulge in the silhouette.", "geometry": "Lathe profile radius stops, not a separate part.", "evidenceRefs": ["full-object", "handle-zone"], "confidence": 0.85}, {"id": "butt-round", "description": "The butt closes as a dome over the last 0.096 units rather than a flat disc.", "geometry": "Lathe profile collapses to radius 0.010 at y 0.", "evidenceRefs": ["full-object", "handle-zone"], "confidence": 0.8}, {"id": "crown-boss", "description": "The shaft reappears above the head as a cream cylinder of radius 0.158 standing 0.117 proud of the coral, chamfered at its crown.", "geometry": "Same lathe, profile stops at y 2.083, 2.169 and 2.200.", "evidenceRefs": ["full-object", "head-zone"], "confidence": 0.85}], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.55, "bumpAmplitude": 0.01, "normalPattern": "fine moulded-plastic grain following the axis of revolution", "displacementPattern": "none", "occlusionPattern": "darken where the bracket collar and the head eye contact the shaft", "edgeWearPattern": "very light polish on the swell crown", "notes": "Matte injection-moulded plastic."}, "evidenceRefs": ["full-object", "handle-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_handle_shaft_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "custom", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "grip-centre", "position": [0, 0.55, 0]}, {"id": "swing-pivot", "position": [0, 2.2, 0]}], "collider": {"type": "capsule", "offset": [0, 1.1, 0], "scale": [0.414, 2.2, 0.414], "isTrigger": false, "notes": "Capsule proxy along the shaft; the trap's own colliders are authored in TrapRenderer and are not replaced by this prop."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handle", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}};
  (nodes["root"] ?? root).add(node_handle_shaft_0);
  nodes["handle-shaft"] = node_handle_shaft_0;
  const mesh_handle_shaft_0Geometry = endpoint_handle_shaft_0
    ? new THREE.CylinderGeometry(endpoint_handle_shaft_0.endRadius, endpoint_handle_shaft_0.baseRadius, endpoint_handle_shaft_0.length, 32, 12)
    : buildLatheGeometry({"points": [[0.01, 0.0], [0.079, 0.0192], [0.17, 0.096], [0.19, 0.2112], [0.207, 0.3264], [0.199, 0.4415], [0.188, 0.5567], [0.181, 0.6335], [0.166, 0.7871], [0.155, 1.0942], [0.15, 1.3246], [0.156, 1.4974], [0.158, 1.651], [0.158, 2.0829], [0.15, 2.1693], [0.01, 2.2]], "segments": 28});
  const mesh_handle_shaft_0 = new THREE.Mesh(
    mesh_handle_shaft_0Geometry,
    materialMap["handle-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_handle_shaft_0.name = "Handle shaft";
  if (endpoint_handle_shaft_0) {
    mesh_handle_shaft_0.position.copy(endpoint_handle_shaft_0.midpoint);
    mesh_handle_shaft_0.quaternion.copy(endpoint_handle_shaft_0.quaternion);
  }
  mesh_handle_shaft_0.castShadow = options.castShadow ?? true;
  mesh_handle_shaft_0.receiveShadow = options.receiveShadow ?? true;
  mesh_handle_shaft_0.userData.sculptComponent = {"id": "handle-shaft", "name": "Handle shaft", "level": "macro", "role": "structural-spine", "importance": 0.9, "confidence": 0.9, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "A single surface of revolution whose radius varies continuously from the butt swell to the crown, with no edge anywhere along it. A box stack or a plain cylinder would lose the swell that fixes the grip's read.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 243, 207, 1.0)", "secondaryAlbedo": "rgba(229, 218, 186, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "revolved tapered shaft with a butt swell and a crown boss", "edgeTreatment": {"type": "fillet", "bevelRadius": 0.02, "segments": 3}, "deformationStack": [], "uvStrategy": "generated primitive UVs", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.01, 0.0], [0.079, 0.0192], [0.17, 0.096], [0.19, 0.2112], [0.207, 0.3264], [0.199, 0.4415], [0.188, 0.5567], [0.181, 0.6335], [0.166, 0.7871], [0.155, 1.0942], [0.15, 1.3246], [0.156, 1.4974], [0.158, 1.651], [0.158, 2.0829], [0.15, 2.1693], [0.01, 2.2]], "segments": 28}}, "parent": null, "attachment": null, "dimensions": {"width": 0.414, "height": 2.2, "depth": 0.414, "units": "world", "confidence": 0.9}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "custom", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "grip-centre", "position": [0, 0.55, 0]}, {"id": "swing-pivot", "position": [0, 2.2, 0]}], "collider": {"type": "capsule", "offset": [0, 1.1, 0], "scale": [0.414, 2.2, 0.414], "isTrigger": false, "notes": "Capsule proxy along the shaft; the trap's own colliders are authored in TrapRenderer and are not replaced by this prop."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handle", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "handle-cream", "materialLayers": ["handle-cream"], "deformations": [], "joints": [], "seams": [{"id": "shaft-to-head", "withComponent": "head-body", "overlapWorldUnits": 0.557, "notes": "The shaft runs through the whole head, so the overlap is the head's full height rather than a lip."}, {"id": "shaft-to-collar", "withComponent": "bracket-collar", "overlapWorldUnits": 0.037, "notes": "The collar ring's inner wall sits 0.037 inside the shaft radius."}], "localFeatures": [{"id": "butt-swell", "description": "The shaft widens from radius 0.150 at y 1.325 to 0.207 at y 0.326 before rounding into the butt, which is the only bulge in the silhouette.", "geometry": "Lathe profile radius stops, not a separate part.", "evidenceRefs": ["full-object", "handle-zone"], "confidence": 0.85}, {"id": "butt-round", "description": "The butt closes as a dome over the last 0.096 units rather than a flat disc.", "geometry": "Lathe profile collapses to radius 0.010 at y 0.", "evidenceRefs": ["full-object", "handle-zone"], "confidence": 0.8}, {"id": "crown-boss", "description": "The shaft reappears above the head as a cream cylinder of radius 0.158 standing 0.117 proud of the coral, chamfered at its crown.", "geometry": "Same lathe, profile stops at y 2.083, 2.169 and 2.200.", "evidenceRefs": ["full-object", "head-zone"], "confidence": 0.85}], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.55, "bumpAmplitude": 0.01, "normalPattern": "fine moulded-plastic grain following the axis of revolution", "displacementPattern": "none", "occlusionPattern": "darken where the bracket collar and the head eye contact the shaft", "edgeWearPattern": "very light polish on the swell crown", "notes": "Matte injection-moulded plastic."}, "evidenceRefs": ["full-object", "handle-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_handle_shaft_0.add(mesh_handle_shaft_0);
  meshes["handle-shaft"] = mesh_handle_shaft_0;
  colliders["handle-shaft"] = {"type": "capsule", "offset": [0, 1.1, 0], "scale": [0.414, 2.2, 0.414], "isTrigger": false, "notes": "Capsule proxy along the shaft; the trap's own colliders are authored in TrapRenderer and are not replaced by this prop."};
  destructionGroups["handle"] ??= [];
  destructionGroups["handle"].push(node_handle_shaft_0);
  const socket_handle_shaft_grip_centre_0 = new THREE.Object3D();
  socket_handle_shaft_grip_centre_0.name = "grip-centre";
  socket_handle_shaft_grip_centre_0.position.set(0.0, 0.55, 0.0);
  socket_handle_shaft_grip_centre_0.rotation.set(0, 0, 0);
  socket_handle_shaft_grip_centre_0.userData.socket = {"id": "grip-centre", "position": [0, 0.55, 0]};
  node_handle_shaft_0.add(socket_handle_shaft_grip_centre_0);
  sockets["handle-shaft:grip-centre"] = socket_handle_shaft_grip_centre_0;
  const socket_handle_shaft_swing_pivot_1 = new THREE.Object3D();
  socket_handle_shaft_swing_pivot_1.name = "swing-pivot";
  socket_handle_shaft_swing_pivot_1.position.set(0.0, 2.2, 0.0);
  socket_handle_shaft_swing_pivot_1.rotation.set(0, 0, 0);
  socket_handle_shaft_swing_pivot_1.userData.socket = {"id": "swing-pivot", "position": [0, 2.2, 0]};
  node_handle_shaft_0.add(socket_handle_shaft_swing_pivot_1);
  sockets["handle-shaft:swing-pivot"] = socket_handle_shaft_swing_pivot_1;

  const attachment_head_body_1 = null;
  const endpoint_head_body_1 = makeAttachmentEndpoint(attachment_head_body_1);
  const node_head_body_1 = new THREE.Group();
  node_head_body_1.name = "Head body block__pivot";
  if (endpoint_head_body_1) {
    node_head_body_1.position.copy(endpoint_head_body_1.start);
    node_head_body_1.rotation.set(0, 0, 0);
    node_head_body_1.scale.set(1, 1, 1);
  } else {
    node_head_body_1.position.set(0.0, 0.0, -0.25);
    node_head_body_1.rotation.set(-0.0, 0.0, -0.0);
    node_head_body_1.scale.set(1.0, 1.0, 1.0);
  }
  node_head_body_1.userData.sculptComponent = {"id": "head-body", "name": "Head body block", "level": "macro", "role": "primary-mass", "importance": 0.9, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A chamfered rectangular mass with distinct faces where the poll, the claw and the eye meet it. It is a manufactured block, not a continuous organic form.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 92, 101, 1.0)", "secondaryAlbedo": "rgba(229, 82, 90, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "chamfered block that carries the poll and the claw", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.055, "segments": 3}, "deformationStack": [], "uvStrategy": "generated primitive UVs", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.238, 1.5908], [-0.2358, 1.57102], [-0.2292, 1.55569], [-0.2182, 1.54479], [-0.2028, 1.53835], [-0.183, 1.53634], [0.135, 1.53946], [0.15624, 1.54132], [0.17597, 1.54645], [0.19419, 1.55486], [0.21088, 1.56655], [0.22607, 1.58152], [0.24649, 1.60503], [0.25789, 1.61888], [0.26849, 1.63326], [0.27828, 1.64817], [0.28727, 1.66361], [0.29545, 1.67958], [0.31455, 1.71942], [0.32306, 1.73501], [0.33303, 1.74932], [0.34446, 1.76235], [0.35736, 1.77409], [0.37171, 1.78455], [0.3724, 1.785], [0.38622, 1.7984], [0.39698, 1.8186], [0.40466, 1.8456], [0.40926, 1.8794], [0.4108, 1.92], [0.4108, 1.95415], [0.4048, 2.00599], [0.3868, 2.04619], [0.3568, 2.07475], [0.3148, 2.09168], [0.26081, 2.09696], [-0.183, 2.09299], [-0.2028, 2.09061], [-0.2182, 2.08388], [-0.2292, 2.07278], [-0.2358, 2.05732], [-0.238, 2.0375]], "depth": 0.5}}, "parent": "handle-shaft", "attachment": null, "dimensions": {"width": 0.6488, "height": 0.5567, "depth": 0.5, "units": "world", "confidence": 0.75}, "transform": {"position": [0.0, 0.0, -0.25], "rotation": [-0.0, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy on the head mass."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "head-coral", "materialLayers": ["head-coral"], "deformations": [], "joints": [], "seams": [{"id": "body-to-poll", "withComponent": "poll-drum", "overlapWorldUnits": 0.054, "notes": "The poll's lathe starts 0.054 inside the block's poll face."}, {"id": "body-to-claw", "withComponent": "claw-root", "overlapWorldUnits": 0.035, "notes": "The claw sweep starts 0.035 inside the block's claw face."}], "localFeatures": [{"id": "body-edge-chamfer", "description": "Every edge of the block is softened by about 0.055 units, so the reference shows a bright rim line rather than a hard corner.", "geometry": "edgeTreatment chamfer at bevelRadius 0.055, 3 segments.", "evidenceRefs": ["full-object", "head-zone"], "confidence": 0.8}, {"id": "eye-shoulder", "description": "The block's top face rises slightly toward the claw side, which is where the coral meets the cream boss.", "geometry": "Top face carried by the eye collar rather than modelled as a taper.", "evidenceRefs": ["head-zone"], "confidence": 0.6}], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.52, "bumpAmplitude": 0.008, "normalPattern": "broad moulded tone drift across each face", "displacementPattern": "none", "occlusionPattern": "darken the eye seam and both contact rings", "edgeWearPattern": "light polish on the chamfers", "notes": "Matte injection-moulded plastic, same family as the poll and claw."}, "evidenceRefs": ["full-object", "head-zone"], "details": [], "fidelityTier": "blockout"};
  node_head_body_1.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy on the head mass."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}};
  (nodes["handle-shaft"] ?? root).add(node_head_body_1);
  nodes["head-body"] = node_head_body_1;
  const mesh_head_body_1Geometry = endpoint_head_body_1
    ? new THREE.CylinderGeometry(endpoint_head_body_1.endRadius, endpoint_head_body_1.baseRadius, endpoint_head_body_1.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-0.238, 1.5908], [-0.2358, 1.57102], [-0.2292, 1.55569], [-0.2182, 1.54479], [-0.2028, 1.53835], [-0.183, 1.53634], [0.135, 1.53946], [0.15624, 1.54132], [0.17597, 1.54645], [0.19419, 1.55486], [0.21088, 1.56655], [0.22607, 1.58152], [0.24649, 1.60503], [0.25789, 1.61888], [0.26849, 1.63326], [0.27828, 1.64817], [0.28727, 1.66361], [0.29545, 1.67958], [0.31455, 1.71942], [0.32306, 1.73501], [0.33303, 1.74932], [0.34446, 1.76235], [0.35736, 1.77409], [0.37171, 1.78455], [0.3724, 1.785], [0.38622, 1.7984], [0.39698, 1.8186], [0.40466, 1.8456], [0.40926, 1.8794], [0.4108, 1.92], [0.4108, 1.95415], [0.4048, 2.00599], [0.3868, 2.04619], [0.3568, 2.07475], [0.3148, 2.09168], [0.26081, 2.09696], [-0.183, 2.09299], [-0.2028, 2.09061], [-0.2182, 2.08388], [-0.2292, 2.07278], [-0.2358, 2.05732], [-0.238, 2.0375]], "depth": 0.5});
  const mesh_head_body_1 = new THREE.Mesh(
    mesh_head_body_1Geometry,
    materialMap["head-coral"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_head_body_1.name = "Head body block";
  if (endpoint_head_body_1) {
    mesh_head_body_1.position.copy(endpoint_head_body_1.midpoint);
    mesh_head_body_1.quaternion.copy(endpoint_head_body_1.quaternion);
  }
  mesh_head_body_1.castShadow = options.castShadow ?? true;
  mesh_head_body_1.receiveShadow = options.receiveShadow ?? true;
  mesh_head_body_1.userData.sculptComponent = {"id": "head-body", "name": "Head body block", "level": "macro", "role": "primary-mass", "importance": 0.9, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A chamfered rectangular mass with distinct faces where the poll, the claw and the eye meet it. It is a manufactured block, not a continuous organic form.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 92, 101, 1.0)", "secondaryAlbedo": "rgba(229, 82, 90, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "chamfered block that carries the poll and the claw", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.055, "segments": 3}, "deformationStack": [], "uvStrategy": "generated primitive UVs", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.238, 1.5908], [-0.2358, 1.57102], [-0.2292, 1.55569], [-0.2182, 1.54479], [-0.2028, 1.53835], [-0.183, 1.53634], [0.135, 1.53946], [0.15624, 1.54132], [0.17597, 1.54645], [0.19419, 1.55486], [0.21088, 1.56655], [0.22607, 1.58152], [0.24649, 1.60503], [0.25789, 1.61888], [0.26849, 1.63326], [0.27828, 1.64817], [0.28727, 1.66361], [0.29545, 1.67958], [0.31455, 1.71942], [0.32306, 1.73501], [0.33303, 1.74932], [0.34446, 1.76235], [0.35736, 1.77409], [0.37171, 1.78455], [0.3724, 1.785], [0.38622, 1.7984], [0.39698, 1.8186], [0.40466, 1.8456], [0.40926, 1.8794], [0.4108, 1.92], [0.4108, 1.95415], [0.4048, 2.00599], [0.3868, 2.04619], [0.3568, 2.07475], [0.3148, 2.09168], [0.26081, 2.09696], [-0.183, 2.09299], [-0.2028, 2.09061], [-0.2182, 2.08388], [-0.2292, 2.07278], [-0.2358, 2.05732], [-0.238, 2.0375]], "depth": 0.5}}, "parent": "handle-shaft", "attachment": null, "dimensions": {"width": 0.6488, "height": 0.5567, "depth": 0.5, "units": "world", "confidence": 0.75}, "transform": {"position": [0.0, 0.0, -0.25], "rotation": [-0.0, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy on the head mass."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "head-coral", "materialLayers": ["head-coral"], "deformations": [], "joints": [], "seams": [{"id": "body-to-poll", "withComponent": "poll-drum", "overlapWorldUnits": 0.054, "notes": "The poll's lathe starts 0.054 inside the block's poll face."}, {"id": "body-to-claw", "withComponent": "claw-root", "overlapWorldUnits": 0.035, "notes": "The claw sweep starts 0.035 inside the block's claw face."}], "localFeatures": [{"id": "body-edge-chamfer", "description": "Every edge of the block is softened by about 0.055 units, so the reference shows a bright rim line rather than a hard corner.", "geometry": "edgeTreatment chamfer at bevelRadius 0.055, 3 segments.", "evidenceRefs": ["full-object", "head-zone"], "confidence": 0.8}, {"id": "eye-shoulder", "description": "The block's top face rises slightly toward the claw side, which is where the coral meets the cream boss.", "geometry": "Top face carried by the eye collar rather than modelled as a taper.", "evidenceRefs": ["head-zone"], "confidence": 0.6}], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.52, "bumpAmplitude": 0.008, "normalPattern": "broad moulded tone drift across each face", "displacementPattern": "none", "occlusionPattern": "darken the eye seam and both contact rings", "edgeWearPattern": "light polish on the chamfers", "notes": "Matte injection-moulded plastic, same family as the poll and claw."}, "evidenceRefs": ["full-object", "head-zone"], "details": [], "fidelityTier": "blockout"};
  node_head_body_1.add(mesh_head_body_1);
  meshes["head-body"] = mesh_head_body_1;
  colliders["head-body"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy on the head mass."};
  destructionGroups["head"] ??= [];
  destructionGroups["head"].push(node_head_body_1);

  const attachment_poll_drum_2 = null;
  const endpoint_poll_drum_2 = makeAttachmentEndpoint(attachment_poll_drum_2);
  const node_poll_drum_2 = new THREE.Group();
  node_poll_drum_2.name = "Poll drum and striking face__pivot";
  if (endpoint_poll_drum_2) {
    node_poll_drum_2.position.copy(endpoint_poll_drum_2.start);
    node_poll_drum_2.rotation.set(0, 0, 0);
    node_poll_drum_2.scale.set(1, 1, 1);
  } else {
    node_poll_drum_2.position.set(-0.1843, 1.8141, 0.25);
    node_poll_drum_2.rotation.set(-0.0, 0.0, 1.570796);
    node_poll_drum_2.scale.set(1.0, 1.0, 1.0);
  }
  node_poll_drum_2.userData.sculptComponent = {"id": "poll-drum", "name": "Poll drum and striking face", "level": "macro", "role": "striking-face", "importance": 0.85, "confidence": 0.8, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "A surface of revolution about the horizontal poll axis: collar, recessed step, drum, then a chamfered face. A cylinder primitive would lose the step and the face chamfer, which are what make it read as a struck face rather than a peg.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 92, 101, 1.0)", "secondaryAlbedo": "rgba(229, 82, 90, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "revolved two-step drum laid along the poll axis", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated primitive UVs", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.185, 0.0], [0.215, 0.045], [0.215, 0.105], [0.192, 0.13], [0.24, 0.16], [0.2496, 0.205], [0.2496, 0.38], [0.236, 0.418], [0.196, 0.445], [0.01, 0.453]], "segments": 26}}, "parent": "head-body", "attachment": null, "dimensions": {"width": 0.453, "height": 0.4992, "depth": 0.4992, "units": "world", "confidence": 0.8}, "transform": {"position": [-0.1843, 1.8141, 0.25], "rotation": [-0.0, 0.0, 1.570796], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "custom", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "strike-face", "position": [-0.45299999999999996, 0, 0]}], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Cylinder proxy along the poll axis."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "head-coral", "materialLayers": ["head-coral"], "deformations": [], "joints": [], "seams": [{"id": "poll-to-body", "withComponent": "head-body", "overlapWorldUnits": 0.054, "notes": "Mirror of body-to-poll."}], "localFeatures": [{"id": "poll-step-groove", "description": "A recessed ring 0.023 deep sits between the collar and the drum, 0.130 in from the body face.", "geometry": "Lathe profile radius drops from 0.215 to 0.192 and back to 0.240.", "evidenceRefs": ["full-object", "head-zone"], "confidence": 0.8}, {"id": "poll-face-chamfer", "description": "The striking face is chamfered over its outer 0.065, so the face reads as a flat disc inside a bright ring rather than a dome.", "geometry": "Lathe profile radius steps 0.2496 to 0.236 to 0.196 before closing.", "evidenceRefs": ["full-object", "head-zone"], "confidence": 0.8}], "surfaceDetail": {"macroRoughness": 0.58, "microRoughness": 0.5, "bumpAmplitude": 0.008, "normalPattern": "concentric turning drift around the poll axis", "displacementPattern": "none", "occlusionPattern": "darken the step groove floor", "edgeWearPattern": "polish the face chamfer ring", "notes": "Matte plastic with a slightly smoother crown on the struck face."}, "evidenceRefs": ["full-object", "head-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_poll_drum_2.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "custom", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "strike-face", "position": [-0.45299999999999996, 0, 0]}], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Cylinder proxy along the poll axis."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}};
  (nodes["head-body"] ?? root).add(node_poll_drum_2);
  nodes["poll-drum"] = node_poll_drum_2;
  const mesh_poll_drum_2Geometry = endpoint_poll_drum_2
    ? new THREE.CylinderGeometry(endpoint_poll_drum_2.endRadius, endpoint_poll_drum_2.baseRadius, endpoint_poll_drum_2.length, 32, 12)
    : buildLatheGeometry({"points": [[0.185, 0.0], [0.215, 0.045], [0.215, 0.105], [0.192, 0.13], [0.24, 0.16], [0.2496, 0.205], [0.2496, 0.38], [0.236, 0.418], [0.196, 0.445], [0.01, 0.453]], "segments": 26});
  const mesh_poll_drum_2 = new THREE.Mesh(
    mesh_poll_drum_2Geometry,
    materialMap["head-coral"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_poll_drum_2.name = "Poll drum and striking face";
  if (endpoint_poll_drum_2) {
    mesh_poll_drum_2.position.copy(endpoint_poll_drum_2.midpoint);
    mesh_poll_drum_2.quaternion.copy(endpoint_poll_drum_2.quaternion);
  }
  mesh_poll_drum_2.castShadow = options.castShadow ?? true;
  mesh_poll_drum_2.receiveShadow = options.receiveShadow ?? true;
  mesh_poll_drum_2.userData.sculptComponent = {"id": "poll-drum", "name": "Poll drum and striking face", "level": "macro", "role": "striking-face", "importance": 0.85, "confidence": 0.8, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "A surface of revolution about the horizontal poll axis: collar, recessed step, drum, then a chamfered face. A cylinder primitive would lose the step and the face chamfer, which are what make it read as a struck face rather than a peg.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 92, 101, 1.0)", "secondaryAlbedo": "rgba(229, 82, 90, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "revolved two-step drum laid along the poll axis", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated primitive UVs", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.185, 0.0], [0.215, 0.045], [0.215, 0.105], [0.192, 0.13], [0.24, 0.16], [0.2496, 0.205], [0.2496, 0.38], [0.236, 0.418], [0.196, 0.445], [0.01, 0.453]], "segments": 26}}, "parent": "head-body", "attachment": null, "dimensions": {"width": 0.453, "height": 0.4992, "depth": 0.4992, "units": "world", "confidence": 0.8}, "transform": {"position": [-0.1843, 1.8141, 0.25], "rotation": [-0.0, 0.0, 1.570796], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "custom", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "strike-face", "position": [-0.45299999999999996, 0, 0]}], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Cylinder proxy along the poll axis."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "head-coral", "materialLayers": ["head-coral"], "deformations": [], "joints": [], "seams": [{"id": "poll-to-body", "withComponent": "head-body", "overlapWorldUnits": 0.054, "notes": "Mirror of body-to-poll."}], "localFeatures": [{"id": "poll-step-groove", "description": "A recessed ring 0.023 deep sits between the collar and the drum, 0.130 in from the body face.", "geometry": "Lathe profile radius drops from 0.215 to 0.192 and back to 0.240.", "evidenceRefs": ["full-object", "head-zone"], "confidence": 0.8}, {"id": "poll-face-chamfer", "description": "The striking face is chamfered over its outer 0.065, so the face reads as a flat disc inside a bright ring rather than a dome.", "geometry": "Lathe profile radius steps 0.2496 to 0.236 to 0.196 before closing.", "evidenceRefs": ["full-object", "head-zone"], "confidence": 0.8}], "surfaceDetail": {"macroRoughness": 0.58, "microRoughness": 0.5, "bumpAmplitude": 0.008, "normalPattern": "concentric turning drift around the poll axis", "displacementPattern": "none", "occlusionPattern": "darken the step groove floor", "edgeWearPattern": "polish the face chamfer ring", "notes": "Matte plastic with a slightly smoother crown on the struck face."}, "evidenceRefs": ["full-object", "head-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_poll_drum_2.add(mesh_poll_drum_2);
  meshes["poll-drum"] = mesh_poll_drum_2;
  colliders["poll-drum"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Cylinder proxy along the poll axis."};
  destructionGroups["head"] ??= [];
  destructionGroups["head"].push(node_poll_drum_2);
  const socket_poll_drum_strike_face_0 = new THREE.Object3D();
  socket_poll_drum_strike_face_0.name = "strike-face";
  socket_poll_drum_strike_face_0.position.set(-0.45299999999999996, 0.0, 0.0);
  socket_poll_drum_strike_face_0.rotation.set(0, 0, 0);
  socket_poll_drum_strike_face_0.userData.socket = {"id": "strike-face", "position": [-0.45299999999999996, 0, 0]};
  node_poll_drum_2.add(socket_poll_drum_strike_face_0);
  sockets["poll-drum:strike-face"] = socket_poll_drum_strike_face_0;

  const attachment_claw_root_3 = {"parentId": "head-body", "localStart": [0.195, 2.0925, 0.0], "localEnd": [0.5644, 1.9005, 0.0], "contactType": "embedded-root", "overlap": 0.035, "gapTolerance": 0.004, "geometryFromEndpoint": false, "evidenceRefs": ["full-object", "head-zone"], "notes": "The sweep starts 0.035 inside the block's claw face and runs out along the spine."};
  const endpoint_claw_root_3 = makeAttachmentEndpoint(attachment_claw_root_3);
  const node_claw_root_3 = new THREE.Group();
  node_claw_root_3.name = "Claw root sweep__pivot";
  if (endpoint_claw_root_3) {
    node_claw_root_3.position.copy(endpoint_claw_root_3.start);
    node_claw_root_3.rotation.set(0, 0, 0);
    node_claw_root_3.scale.set(1, 1, 1);
  } else {
    node_claw_root_3.position.set(0.0, 0.0, 0.25);
    node_claw_root_3.rotation.set(-0.0, 0.0, -0.0);
    node_claw_root_3.scale.set(1.0, 1.0, 1.0);
  }
  node_claw_root_3.userData.sculptComponent = {"id": "claw-root", "name": "Claw root sweep", "level": "macro", "role": "hook-root", "importance": 0.85, "confidence": 0.7, "primitive": "curve-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "The claw leaves the block on a continuous curve. Swept along a measured 3D spine so it holds its hook from every camera angle; a flat extrude of the same outline would read correctly only from the reference angle.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 92, 101, 1.0)", "secondaryAlbedo": "rgba(229, 82, 90, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "thick section swept along the claw spine", "edgeTreatment": {"type": "fillet", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated primitive UVs", "normalStrategy": "vertex normals from generated geometry", "curveSweep": {"spine": [[0.3, 2.02, 0.0], [0.449, 1.954, 0.0], [0.507, 1.899, 0.0], [0.564, 1.841, 0.0], [0.622, 1.779, 0.0]], "crossSection": {"points": [[-0.15, -0.14], [0.15, -0.14], [0.15, 0.14], [-0.15, 0.14]]}, "closed": false}}, "parent": "head-body", "attachment": {"parentId": "head-body", "localStart": [0.195, 2.0925, 0.0], "localEnd": [0.5644, 1.9005, 0.0], "contactType": "embedded-root", "overlap": 0.035, "gapTolerance": 0.004, "geometryFromEndpoint": false, "evidenceRefs": ["full-object", "head-zone"], "notes": "The sweep starts 0.035 inside the block's claw face and runs out along the spine."}, "dimensions": {"width": 0.37, "height": 0.3, "depth": 0.3, "units": "world", "confidence": 0.7}, "transform": {"position": [0.0, 0.0, 0.25], "rotation": [-0.0, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "custom", "localPosition": [0.195, 2.0925, 0.0], "axis": [0.0, 0.0, 1.0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy over the claw root."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "head-coral", "materialLayers": ["head-coral"], "deformations": [], "joints": [], "seams": [{"id": "claw-to-body", "withComponent": "head-body", "overlapWorldUnits": 0.035, "notes": "Mirror of body-to-claw."}, {"id": "root-to-tines", "withComponent": "claw-tine-near", "overlapWorldUnits": 0.048, "notes": "Both tines start 0.048 back inside the root sweep."}], "localFeatures": [{"id": "claw-crescent", "description": "The underside of the claw is open to the background between rows 250 and 438, which is the crescent that identifies a claw hammer.", "geometry": "Spine curvature, not a cut: the sweep leaves the gap open.", "evidenceRefs": ["full-object", "head-zone"], "confidence": 0.85}], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.52, "bumpAmplitude": 0.008, "normalPattern": "sweep-aligned moulding drift", "displacementPattern": "none", "occlusionPattern": "darken the root seam", "edgeWearPattern": "light polish along the outer curve", "notes": "Matte plastic, same family as the block."}, "evidenceRefs": ["full-object", "head-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_claw_root_3.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "custom", "localPosition": [0.195, 2.0925, 0.0], "axis": [0.0, 0.0, 1.0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy over the claw root."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}};
  (nodes["head-body"] ?? root).add(node_claw_root_3);
  nodes["claw-root"] = node_claw_root_3;
  const mesh_claw_root_3Geometry = endpoint_claw_root_3
    ? new THREE.CylinderGeometry(endpoint_claw_root_3.endRadius, endpoint_claw_root_3.baseRadius, endpoint_claw_root_3.length, 32, 12)
    : buildCurveSweepGeometry({"spine": [[0.3, 2.02, 0.0], [0.449, 1.954, 0.0], [0.507, 1.899, 0.0], [0.564, 1.841, 0.0], [0.622, 1.779, 0.0]], "crossSection": {"points": [[-0.15, -0.14], [0.15, -0.14], [0.15, 0.14], [-0.15, 0.14]]}, "closed": false});
  const mesh_claw_root_3 = new THREE.Mesh(
    mesh_claw_root_3Geometry,
    materialMap["head-coral"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_claw_root_3.name = "Claw root sweep";
  if (endpoint_claw_root_3) {
    mesh_claw_root_3.position.copy(endpoint_claw_root_3.midpoint);
    mesh_claw_root_3.quaternion.copy(endpoint_claw_root_3.quaternion);
  }
  mesh_claw_root_3.castShadow = options.castShadow ?? true;
  mesh_claw_root_3.receiveShadow = options.receiveShadow ?? true;
  mesh_claw_root_3.userData.sculptComponent = {"id": "claw-root", "name": "Claw root sweep", "level": "macro", "role": "hook-root", "importance": 0.85, "confidence": 0.7, "primitive": "curve-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "The claw leaves the block on a continuous curve. Swept along a measured 3D spine so it holds its hook from every camera angle; a flat extrude of the same outline would read correctly only from the reference angle.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 92, 101, 1.0)", "secondaryAlbedo": "rgba(229, 82, 90, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "thick section swept along the claw spine", "edgeTreatment": {"type": "fillet", "bevelRadius": 0.03, "segments": 2}, "deformationStack": [], "uvStrategy": "generated primitive UVs", "normalStrategy": "vertex normals from generated geometry", "curveSweep": {"spine": [[0.3, 2.02, 0.0], [0.449, 1.954, 0.0], [0.507, 1.899, 0.0], [0.564, 1.841, 0.0], [0.622, 1.779, 0.0]], "crossSection": {"points": [[-0.15, -0.14], [0.15, -0.14], [0.15, 0.14], [-0.15, 0.14]]}, "closed": false}}, "parent": "head-body", "attachment": {"parentId": "head-body", "localStart": [0.195, 2.0925, 0.0], "localEnd": [0.5644, 1.9005, 0.0], "contactType": "embedded-root", "overlap": 0.035, "gapTolerance": 0.004, "geometryFromEndpoint": false, "evidenceRefs": ["full-object", "head-zone"], "notes": "The sweep starts 0.035 inside the block's claw face and runs out along the spine."}, "dimensions": {"width": 0.37, "height": 0.3, "depth": 0.3, "units": "world", "confidence": 0.7}, "transform": {"position": [0.0, 0.0, 0.25], "rotation": [-0.0, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "custom", "localPosition": [0.195, 2.0925, 0.0], "axis": [0.0, 0.0, 1.0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy over the claw root."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "head-coral", "materialLayers": ["head-coral"], "deformations": [], "joints": [], "seams": [{"id": "claw-to-body", "withComponent": "head-body", "overlapWorldUnits": 0.035, "notes": "Mirror of body-to-claw."}, {"id": "root-to-tines", "withComponent": "claw-tine-near", "overlapWorldUnits": 0.048, "notes": "Both tines start 0.048 back inside the root sweep."}], "localFeatures": [{"id": "claw-crescent", "description": "The underside of the claw is open to the background between rows 250 and 438, which is the crescent that identifies a claw hammer.", "geometry": "Spine curvature, not a cut: the sweep leaves the gap open.", "evidenceRefs": ["full-object", "head-zone"], "confidence": 0.85}], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.52, "bumpAmplitude": 0.008, "normalPattern": "sweep-aligned moulding drift", "displacementPattern": "none", "occlusionPattern": "darken the root seam", "edgeWearPattern": "light polish along the outer curve", "notes": "Matte plastic, same family as the block."}, "evidenceRefs": ["full-object", "head-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_claw_root_3.add(mesh_claw_root_3);
  meshes["claw-root"] = mesh_claw_root_3;
  colliders["claw-root"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy over the claw root."};
  destructionGroups["head"] ??= [];
  destructionGroups["head"].push(node_claw_root_3);

  const attachment_claw_tine_near_4 = {"parentId": "claw-root", "localStart": [0.5644, 1.9005, 0.086], "localEnd": [0.7026, 1.6356, 0.086], "contactType": "embedded-root", "overlap": 0.048, "gapTolerance": 0.004, "geometryFromEndpoint": false, "evidenceRefs": ["head-zone"], "notes": "The tine starts 0.048 back inside the root sweep so the fork has no gap at its throat."};
  const endpoint_claw_tine_near_4 = makeAttachmentEndpoint(attachment_claw_tine_near_4);
  const node_claw_tine_near_4 = new THREE.Group();
  node_claw_tine_near_4.name = "Claw tine, near side__pivot";
  if (endpoint_claw_tine_near_4) {
    node_claw_tine_near_4.position.copy(endpoint_claw_tine_near_4.start);
    node_claw_tine_near_4.rotation.set(0, 0, 0);
    node_claw_tine_near_4.scale.set(1, 1, 1);
  } else {
    node_claw_tine_near_4.position.set(0.0, 0.0, 0.086);
    node_claw_tine_near_4.rotation.set(-0.0, 0.0, -0.0);
    node_claw_tine_near_4.scale.set(1.0, 1.0, 1.0);
  }
  node_claw_tine_near_4.userData.sculptComponent = {"id": "claw-tine-near", "name": "Claw tine, near side", "level": "meso", "role": "hook-tine", "importance": 0.6, "confidence": 0.6, "primitive": "curve-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "A slim continuously curving tine. Swept along the same spine as the root so the fork reads as one hook split in two, not two separate hooks.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 92, 101, 1.0)", "secondaryAlbedo": "rgba(229, 82, 90, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "slim section swept along the claw tip spine", "edgeTreatment": {"type": "fillet", "bevelRadius": 0.015, "segments": 2}, "deformationStack": [], "uvStrategy": "generated primitive UVs", "normalStrategy": "vertex normals from generated geometry", "curveSweep": {"spine": [[0.564, 1.841, 0.0], [0.622, 1.779, 0.0], [0.69, 1.7, 0.0], [0.66, 1.64, 0.0]], "crossSection": {"points": [[-0.058, -0.08], [0.058, -0.08], [0.058, 0.08], [-0.058, 0.08]]}, "closed": false}}, "parent": "claw-root", "attachment": {"parentId": "claw-root", "localStart": [0.5644, 1.9005, 0.086], "localEnd": [0.7026, 1.6356, 0.086], "contactType": "embedded-root", "overlap": 0.048, "gapTolerance": 0.004, "geometryFromEndpoint": false, "evidenceRefs": ["head-zone"], "notes": "The tine starts 0.048 back inside the root sweep so the fork has no gap at its throat."}, "dimensions": {"width": 0.16, "height": 0.24, "depth": 0.116, "units": "world", "confidence": 0.6}, "transform": {"position": [0.0, 0.0, 0.086], "rotation": [-0.0, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "custom", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 0.0, 1.0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy over the tine."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "head-coral", "materialLayers": ["head-coral"], "deformations": [], "joints": [], "seams": [{"id": "tine-to-root", "withComponent": "claw-root", "overlapWorldUnits": 0.048, "notes": "Mirror of root-to-tines."}], "localFeatures": [{"id": "tine-taper", "description": "The tine section is 0.116 across against the root's 0.30, so the claw visibly narrows toward the tip.", "geometry": "Smaller swept cross-section on the same spine.", "evidenceRefs": ["head-zone"], "confidence": 0.6}], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.52, "bumpAmplitude": 0.006, "normalPattern": "sweep-aligned drift", "displacementPattern": "none", "occlusionPattern": "darken the fork slot floor", "edgeWearPattern": "polish the tine crown", "notes": "Matte plastic."}, "evidenceRefs": ["full-object", "head-zone"], "details": [], "fidelityTier": "blockout"};
  node_claw_tine_near_4.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "custom", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 0.0, 1.0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy over the tine."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}};
  (nodes["claw-root"] ?? root).add(node_claw_tine_near_4);
  nodes["claw-tine-near"] = node_claw_tine_near_4;
  const mesh_claw_tine_near_4Geometry = endpoint_claw_tine_near_4
    ? new THREE.CylinderGeometry(endpoint_claw_tine_near_4.endRadius, endpoint_claw_tine_near_4.baseRadius, endpoint_claw_tine_near_4.length, 32, 12)
    : buildCurveSweepGeometry({"spine": [[0.564, 1.841, 0.0], [0.622, 1.779, 0.0], [0.69, 1.7, 0.0], [0.66, 1.64, 0.0]], "crossSection": {"points": [[-0.058, -0.08], [0.058, -0.08], [0.058, 0.08], [-0.058, 0.08]]}, "closed": false});
  const mesh_claw_tine_near_4 = new THREE.Mesh(
    mesh_claw_tine_near_4Geometry,
    materialMap["head-coral"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_claw_tine_near_4.name = "Claw tine, near side";
  if (endpoint_claw_tine_near_4) {
    mesh_claw_tine_near_4.position.copy(endpoint_claw_tine_near_4.midpoint);
    mesh_claw_tine_near_4.quaternion.copy(endpoint_claw_tine_near_4.quaternion);
  }
  mesh_claw_tine_near_4.castShadow = options.castShadow ?? true;
  mesh_claw_tine_near_4.receiveShadow = options.receiveShadow ?? true;
  mesh_claw_tine_near_4.userData.sculptComponent = {"id": "claw-tine-near", "name": "Claw tine, near side", "level": "meso", "role": "hook-tine", "importance": 0.6, "confidence": 0.6, "primitive": "curve-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "A slim continuously curving tine. Swept along the same spine as the root so the fork reads as one hook split in two, not two separate hooks.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 92, 101, 1.0)", "secondaryAlbedo": "rgba(229, 82, 90, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "slim section swept along the claw tip spine", "edgeTreatment": {"type": "fillet", "bevelRadius": 0.015, "segments": 2}, "deformationStack": [], "uvStrategy": "generated primitive UVs", "normalStrategy": "vertex normals from generated geometry", "curveSweep": {"spine": [[0.564, 1.841, 0.0], [0.622, 1.779, 0.0], [0.69, 1.7, 0.0], [0.66, 1.64, 0.0]], "crossSection": {"points": [[-0.058, -0.08], [0.058, -0.08], [0.058, 0.08], [-0.058, 0.08]]}, "closed": false}}, "parent": "claw-root", "attachment": {"parentId": "claw-root", "localStart": [0.5644, 1.9005, 0.086], "localEnd": [0.7026, 1.6356, 0.086], "contactType": "embedded-root", "overlap": 0.048, "gapTolerance": 0.004, "geometryFromEndpoint": false, "evidenceRefs": ["head-zone"], "notes": "The tine starts 0.048 back inside the root sweep so the fork has no gap at its throat."}, "dimensions": {"width": 0.16, "height": 0.24, "depth": 0.116, "units": "world", "confidence": 0.6}, "transform": {"position": [0.0, 0.0, 0.086], "rotation": [-0.0, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "custom", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 0.0, 1.0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy over the tine."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "head-coral", "materialLayers": ["head-coral"], "deformations": [], "joints": [], "seams": [{"id": "tine-to-root", "withComponent": "claw-root", "overlapWorldUnits": 0.048, "notes": "Mirror of root-to-tines."}], "localFeatures": [{"id": "tine-taper", "description": "The tine section is 0.116 across against the root's 0.30, so the claw visibly narrows toward the tip.", "geometry": "Smaller swept cross-section on the same spine.", "evidenceRefs": ["head-zone"], "confidence": 0.6}], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.52, "bumpAmplitude": 0.006, "normalPattern": "sweep-aligned drift", "displacementPattern": "none", "occlusionPattern": "darken the fork slot floor", "edgeWearPattern": "polish the tine crown", "notes": "Matte plastic."}, "evidenceRefs": ["full-object", "head-zone"], "details": [], "fidelityTier": "blockout"};
  node_claw_tine_near_4.add(mesh_claw_tine_near_4);
  meshes["claw-tine-near"] = mesh_claw_tine_near_4;
  colliders["claw-tine-near"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy over the tine."};
  destructionGroups["head"] ??= [];
  destructionGroups["head"].push(node_claw_tine_near_4);

  const attachment_claw_tine_far_5 = {"parentId": "claw-root", "localStart": [0.5644, 1.9005, -0.086], "localEnd": [0.7026, 1.6356, -0.086], "contactType": "embedded-root", "overlap": 0.048, "gapTolerance": 0.004, "geometryFromEndpoint": false, "evidenceRefs": ["head-zone"], "notes": "Mirror of the near tine."};
  const endpoint_claw_tine_far_5 = makeAttachmentEndpoint(attachment_claw_tine_far_5);
  const node_claw_tine_far_5 = new THREE.Group();
  node_claw_tine_far_5.name = "Claw tine, far side__pivot";
  if (endpoint_claw_tine_far_5) {
    node_claw_tine_far_5.position.copy(endpoint_claw_tine_far_5.start);
    node_claw_tine_far_5.rotation.set(0, 0, 0);
    node_claw_tine_far_5.scale.set(1, 1, 1);
  } else {
    node_claw_tine_far_5.position.set(0.0, 0.0, -0.086);
    node_claw_tine_far_5.rotation.set(-0.0, 0.0, -0.0);
    node_claw_tine_far_5.scale.set(1.0, 1.0, 1.0);
  }
  node_claw_tine_far_5.userData.sculptComponent = {"id": "claw-tine-far", "name": "Claw tine, far side", "level": "meso", "role": "hook-tine", "importance": 0.5, "confidence": 0.5, "primitive": "curve-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "The mirror of the near tine across the fork slot, on the same measured spine.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 92, 101, 1.0)", "secondaryAlbedo": "rgba(229, 82, 90, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "slim section swept along the claw tip spine", "edgeTreatment": {"type": "fillet", "bevelRadius": 0.015, "segments": 2}, "deformationStack": [], "uvStrategy": "generated primitive UVs", "normalStrategy": "vertex normals from generated geometry", "curveSweep": {"spine": [[0.564, 1.841, 0.0], [0.622, 1.779, 0.0], [0.69, 1.7, 0.0], [0.66, 1.64, 0.0]], "crossSection": {"points": [[-0.058, -0.08], [0.058, -0.08], [0.058, 0.08], [-0.058, 0.08]]}, "closed": false}}, "parent": "claw-root", "attachment": {"parentId": "claw-root", "localStart": [0.5644, 1.9005, -0.086], "localEnd": [0.7026, 1.6356, -0.086], "contactType": "embedded-root", "overlap": 0.048, "gapTolerance": 0.004, "geometryFromEndpoint": false, "evidenceRefs": ["head-zone"], "notes": "Mirror of the near tine."}, "dimensions": {"width": 0.16, "height": 0.24, "depth": 0.116, "units": "world", "confidence": 0.5}, "transform": {"position": [0.0, 0.0, -0.086], "rotation": [-0.0, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "custom", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 0.0, 1.0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy over the tine."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "head-coral", "materialLayers": ["head-coral"], "deformations": [], "joints": [], "seams": [{"id": "far-tine-to-root", "withComponent": "claw-root", "overlapWorldUnits": 0.048, "notes": "Mirror of root-to-tines."}], "localFeatures": [{"id": "far-tine-inference", "description": "The far tine is only partly visible past the near one; its section and spine are mirrored rather than measured.", "geometry": "Mirror of claw-tine-near about the fork plane.", "evidenceRefs": ["head-zone"], "confidence": 0.5}], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.52, "bumpAmplitude": 0.006, "normalPattern": "sweep-aligned drift", "displacementPattern": "none", "occlusionPattern": "darken the fork slot floor", "edgeWearPattern": "polish the tine crown", "notes": "Matte plastic."}, "evidenceRefs": ["full-object", "head-zone"], "details": [], "fidelityTier": "blockout"};
  node_claw_tine_far_5.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "custom", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 0.0, 1.0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy over the tine."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}};
  (nodes["claw-root"] ?? root).add(node_claw_tine_far_5);
  nodes["claw-tine-far"] = node_claw_tine_far_5;
  const mesh_claw_tine_far_5Geometry = endpoint_claw_tine_far_5
    ? new THREE.CylinderGeometry(endpoint_claw_tine_far_5.endRadius, endpoint_claw_tine_far_5.baseRadius, endpoint_claw_tine_far_5.length, 32, 12)
    : buildCurveSweepGeometry({"spine": [[0.564, 1.841, 0.0], [0.622, 1.779, 0.0], [0.69, 1.7, 0.0], [0.66, 1.64, 0.0]], "crossSection": {"points": [[-0.058, -0.08], [0.058, -0.08], [0.058, 0.08], [-0.058, 0.08]]}, "closed": false});
  const mesh_claw_tine_far_5 = new THREE.Mesh(
    mesh_claw_tine_far_5Geometry,
    materialMap["head-coral"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_claw_tine_far_5.name = "Claw tine, far side";
  if (endpoint_claw_tine_far_5) {
    mesh_claw_tine_far_5.position.copy(endpoint_claw_tine_far_5.midpoint);
    mesh_claw_tine_far_5.quaternion.copy(endpoint_claw_tine_far_5.quaternion);
  }
  mesh_claw_tine_far_5.castShadow = options.castShadow ?? true;
  mesh_claw_tine_far_5.receiveShadow = options.receiveShadow ?? true;
  mesh_claw_tine_far_5.userData.sculptComponent = {"id": "claw-tine-far", "name": "Claw tine, far side", "level": "meso", "role": "hook-tine", "importance": 0.5, "confidence": 0.5, "primitive": "curve-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "The mirror of the near tine across the fork slot, on the same measured spine.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 92, 101, 1.0)", "secondaryAlbedo": "rgba(229, 82, 90, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "slim section swept along the claw tip spine", "edgeTreatment": {"type": "fillet", "bevelRadius": 0.015, "segments": 2}, "deformationStack": [], "uvStrategy": "generated primitive UVs", "normalStrategy": "vertex normals from generated geometry", "curveSweep": {"spine": [[0.564, 1.841, 0.0], [0.622, 1.779, 0.0], [0.69, 1.7, 0.0], [0.66, 1.64, 0.0]], "crossSection": {"points": [[-0.058, -0.08], [0.058, -0.08], [0.058, 0.08], [-0.058, 0.08]]}, "closed": false}}, "parent": "claw-root", "attachment": {"parentId": "claw-root", "localStart": [0.5644, 1.9005, -0.086], "localEnd": [0.7026, 1.6356, -0.086], "contactType": "embedded-root", "overlap": 0.048, "gapTolerance": 0.004, "geometryFromEndpoint": false, "evidenceRefs": ["head-zone"], "notes": "Mirror of the near tine."}, "dimensions": {"width": 0.16, "height": 0.24, "depth": 0.116, "units": "world", "confidence": 0.5}, "transform": {"position": [0.0, 0.0, -0.086], "rotation": [-0.0, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "custom", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 0.0, 1.0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy over the tine."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "head-coral", "materialLayers": ["head-coral"], "deformations": [], "joints": [], "seams": [{"id": "far-tine-to-root", "withComponent": "claw-root", "overlapWorldUnits": 0.048, "notes": "Mirror of root-to-tines."}], "localFeatures": [{"id": "far-tine-inference", "description": "The far tine is only partly visible past the near one; its section and spine are mirrored rather than measured.", "geometry": "Mirror of claw-tine-near about the fork plane.", "evidenceRefs": ["head-zone"], "confidence": 0.5}], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.52, "bumpAmplitude": 0.006, "normalPattern": "sweep-aligned drift", "displacementPattern": "none", "occlusionPattern": "darken the fork slot floor", "edgeWearPattern": "polish the tine crown", "notes": "Matte plastic."}, "evidenceRefs": ["full-object", "head-zone"], "details": [], "fidelityTier": "blockout"};
  node_claw_tine_far_5.add(mesh_claw_tine_far_5);
  meshes["claw-tine-far"] = mesh_claw_tine_far_5;
  colliders["claw-tine-far"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy over the tine."};
  destructionGroups["head"] ??= [];
  destructionGroups["head"].push(node_claw_tine_far_5);

  const attachment_eye_collar_6 = {"parentId": "head-body", "localStart": [0.0, -0.035, 0.0], "localEnd": [0.0, 0.035, 0.0], "contactType": "seated-ring", "overlap": 0.023, "gapTolerance": 0.004, "geometryFromEndpoint": false, "evidenceRefs": ["head-zone"], "notes": "The collar sinks 0.023 into the block's top face around the shaft."};
  const endpoint_eye_collar_6 = makeAttachmentEndpoint(attachment_eye_collar_6);
  const node_eye_collar_6 = new THREE.Group();
  node_eye_collar_6.name = "Eye collar__pivot";
  if (endpoint_eye_collar_6) {
    node_eye_collar_6.position.copy(endpoint_eye_collar_6.start);
    node_eye_collar_6.rotation.set(0, 0, 0);
    node_eye_collar_6.scale.set(1, 1, 1);
  } else {
    node_eye_collar_6.position.set(0.0, 2.0695, 0.25);
    node_eye_collar_6.rotation.set(-0.0, 0.0, -0.0);
    node_eye_collar_6.scale.set(0.392, 0.07, 0.392);
  }
  node_eye_collar_6.userData.sculptComponent = {"id": "eye-collar", "name": "Eye collar", "level": "meso", "role": "joint-collar", "importance": 0.55, "confidence": 0.65, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "A short coral ring standing proud of the head's top face where the handle passes through the eye. Assembled hardware, so a cylinder is the right family.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 92, 101, 1.0)", "secondaryAlbedo": "rgba(229, 82, 90, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "proud collar around the handle at the head crown", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated primitive UVs", "normalStrategy": "vertex normals from generated geometry"}, "parent": "head-body", "attachment": {"parentId": "head-body", "localStart": [0.0, -0.035, 0.0], "localEnd": [0.0, 0.035, 0.0], "contactType": "seated-ring", "overlap": 0.023, "gapTolerance": 0.004, "geometryFromEndpoint": false, "evidenceRefs": ["head-zone"], "notes": "The collar sinks 0.023 into the block's top face around the shaft."}, "dimensions": {"width": 0.392, "height": 0.07, "depth": 0.392, "units": "world", "confidence": 0.65}, "transform": {"position": [0.0, 2.0695, 0.25], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.65}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Cylinder proxy on the collar."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "head-coral", "materialLayers": ["head-coral"], "deformations": [], "joints": [], "seams": [{"id": "collar-to-body", "withComponent": "head-body", "overlapWorldUnits": 0.023, "notes": "The collar sinks 0.023 into the block's top face."}], "localFeatures": [{"id": "eye-seam", "description": "A dark seam runs where the cream shaft meets the coral collar, about 0.012 wide.", "geometry": "AO local override on the contact ring, plus the collar's own chamfer.", "evidenceRefs": ["head-zone"], "confidence": 0.7}], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.52, "bumpAmplitude": 0.006, "normalPattern": "ring-aligned drift", "displacementPattern": "none", "occlusionPattern": "darken the shaft contact ring", "edgeWearPattern": "polish the collar chamfer", "notes": "Matte plastic."}, "evidenceRefs": ["full-object", "head-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_eye_collar_6.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.65}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Cylinder proxy on the collar."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}};
  (nodes["head-body"] ?? root).add(node_eye_collar_6);
  nodes["eye-collar"] = node_eye_collar_6;
  const mesh_eye_collar_6Geometry = endpoint_eye_collar_6
    ? new THREE.CylinderGeometry(endpoint_eye_collar_6.endRadius, endpoint_eye_collar_6.baseRadius, endpoint_eye_collar_6.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 20, 3);
  const mesh_eye_collar_6 = new THREE.Mesh(
    mesh_eye_collar_6Geometry,
    materialMap["head-coral"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_eye_collar_6.name = "Eye collar";
  if (endpoint_eye_collar_6) {
    mesh_eye_collar_6.position.copy(endpoint_eye_collar_6.midpoint);
    mesh_eye_collar_6.quaternion.copy(endpoint_eye_collar_6.quaternion);
  }
  mesh_eye_collar_6.castShadow = options.castShadow ?? true;
  mesh_eye_collar_6.receiveShadow = options.receiveShadow ?? true;
  mesh_eye_collar_6.userData.sculptComponent = {"id": "eye-collar", "name": "Eye collar", "level": "meso", "role": "joint-collar", "importance": 0.55, "confidence": 0.65, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "A short coral ring standing proud of the head's top face where the handle passes through the eye. Assembled hardware, so a cylinder is the right family.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(255, 92, 101, 1.0)", "secondaryAlbedo": "rgba(229, 82, 90, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "proud collar around the handle at the head crown", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated primitive UVs", "normalStrategy": "vertex normals from generated geometry"}, "parent": "head-body", "attachment": {"parentId": "head-body", "localStart": [0.0, -0.035, 0.0], "localEnd": [0.0, 0.035, 0.0], "contactType": "seated-ring", "overlap": 0.023, "gapTolerance": 0.004, "geometryFromEndpoint": false, "evidenceRefs": ["head-zone"], "notes": "The collar sinks 0.023 into the block's top face around the shaft."}, "dimensions": {"width": 0.392, "height": 0.07, "depth": 0.392, "units": "world", "confidence": 0.65}, "transform": {"position": [0.0, 2.0695, 0.25], "rotation": [-0.0, 0.0, -0.0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.65}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Cylinder proxy on the collar."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "head-coral", "materialLayers": ["head-coral"], "deformations": [], "joints": [], "seams": [{"id": "collar-to-body", "withComponent": "head-body", "overlapWorldUnits": 0.023, "notes": "The collar sinks 0.023 into the block's top face."}], "localFeatures": [{"id": "eye-seam", "description": "A dark seam runs where the cream shaft meets the coral collar, about 0.012 wide.", "geometry": "AO local override on the contact ring, plus the collar's own chamfer.", "evidenceRefs": ["head-zone"], "confidence": 0.7}], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.52, "bumpAmplitude": 0.006, "normalPattern": "ring-aligned drift", "displacementPattern": "none", "occlusionPattern": "darken the shaft contact ring", "edgeWearPattern": "polish the collar chamfer", "notes": "Matte plastic."}, "evidenceRefs": ["full-object", "head-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_eye_collar_6.add(mesh_eye_collar_6);
  meshes["eye-collar"] = mesh_eye_collar_6;
  colliders["eye-collar"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Cylinder proxy on the collar."};
  destructionGroups["head"] ??= [];
  destructionGroups["head"].push(node_eye_collar_6);

  const attachment_bracket_plate_7 = null;
  const endpoint_bracket_plate_7 = makeAttachmentEndpoint(attachment_bracket_plate_7);
  const node_bracket_plate_7 = new THREE.Group();
  node_bracket_plate_7.name = "Wall plate__pivot";
  if (endpoint_bracket_plate_7) {
    node_bracket_plate_7.position.copy(endpoint_bracket_plate_7.start);
    node_bracket_plate_7.rotation.set(0, 0, 0);
    node_bracket_plate_7.scale.set(1, 1, 1);
  } else {
    node_bracket_plate_7.position.set(-0.6421, 1.0175, -0.06);
    node_bracket_plate_7.rotation.set(-0.0, 0.0, -0.0);
    node_bracket_plate_7.scale.set(1.0, 1.0, 1.0);
  }
  node_bracket_plate_7.userData.sculptComponent = {"id": "bracket-plate", "name": "Wall plate", "level": "macro", "role": "mount-plate", "importance": 0.7, "confidence": 0.75, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A flat manufactured plate with rounded corners and two through holes. A plate genuinely is a slab, so an extrude with real holes is the honest primitive rather than a solid the holes are painted onto.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 50, 74, 1.0)", "secondaryAlbedo": "rgba(32, 45, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "rounded-rectangle plate extruded to its thickness with two bores", "edgeTreatment": {"type": "fillet", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated primitive UVs", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.1891, 0.31855], [0.18339, 0.34725], [0.16713, 0.37158], [0.1428, 0.38784], [0.1141, 0.39355], [-0.1141, 0.39355], [-0.1428, 0.38784], [-0.16713, 0.37158], [-0.18339, 0.34725], [-0.1891, 0.31855], [-0.1891, -0.31855], [-0.18339, -0.34725], [-0.16713, -0.37158], [-0.1428, -0.38784], [-0.1141, -0.39355], [0.1141, -0.39355], [0.1428, -0.38784], [0.16713, -0.37158], [0.18339, -0.34725], [0.1891, -0.31855]], "depth": 0.12, "ovalHoles": [{"cx": 0.0, "cy": 0.2303, "rx": 0.048, "ry": 0.048}, {"cx": 0.0, "cy": -0.2304, "rx": 0.048, "ry": 0.048}]}}, "parent": "handle-shaft", "attachment": null, "dimensions": {"width": 0.3782, "height": 0.7871, "depth": 0.12, "units": "world", "confidence": 0.75}, "transform": {"position": [-0.6421, 1.0175, -0.06], "rotation": [-0.0, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "wall-face", "position": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy on the plate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "bracket-navy", "materialLayers": ["bracket-navy"], "deformations": [], "joints": [], "seams": [{"id": "plate-to-arm", "withComponent": "bracket-arm", "overlapWorldUnits": 0.03, "notes": "The arm starts 0.030 inside the plate's front face."}], "localFeatures": [{"id": "plate-corner-radius", "description": "All four corners carry a 0.075 radius, which is a fifth of the plate's width.", "geometry": "Rounded-rectangle outline, four arcs of four segments each.", "evidenceRefs": ["full-object", "bracket-zone"], "confidence": 0.85}, {"id": "plate-screw-bores", "description": "Two through holes of radius 0.048 sit on the plate centreline at y 1.248 and 0.787, 0.461 apart.", "geometry": "ExtrudeGeometry shape holes, so they are real openings rather than dark decals.", "evidenceRefs": ["full-object", "bracket-zone"], "confidence": 0.8}], "surfaceDetail": {"macroRoughness": 0.66, "microRoughness": 0.58, "bumpAmplitude": 0.008, "normalPattern": "flat moulded drift across the plate face", "displacementPattern": "none", "occlusionPattern": "darken both bore walls and the arm root", "edgeWearPattern": "light polish on the corner radii", "notes": "Matte navy plastic, the darkest material on the prop."}, "evidenceRefs": ["full-object", "bracket-zone"], "details": [], "fidelityTier": "structural-pass"};
  node_bracket_plate_7.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "wall-face", "position": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy on the plate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}};
  (nodes["handle-shaft"] ?? root).add(node_bracket_plate_7);
  nodes["bracket-plate"] = node_bracket_plate_7;
  const mesh_bracket_plate_7Geometry = endpoint_bracket_plate_7
    ? new THREE.CylinderGeometry(endpoint_bracket_plate_7.endRadius, endpoint_bracket_plate_7.baseRadius, endpoint_bracket_plate_7.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0.1891, 0.31855], [0.18339, 0.34725], [0.16713, 0.37158], [0.1428, 0.38784], [0.1141, 0.39355], [-0.1141, 0.39355], [-0.1428, 0.38784], [-0.16713, 0.37158], [-0.18339, 0.34725], [-0.1891, 0.31855], [-0.1891, -0.31855], [-0.18339, -0.34725], [-0.16713, -0.37158], [-0.1428, -0.38784], [-0.1141, -0.39355], [0.1141, -0.39355], [0.1428, -0.38784], [0.16713, -0.37158], [0.18339, -0.34725], [0.1891, -0.31855]], "depth": 0.12, "ovalHoles": [{"cx": 0.0, "cy": 0.2303, "rx": 0.048, "ry": 0.048}, {"cx": 0.0, "cy": -0.2304, "rx": 0.048, "ry": 0.048}]});
  const mesh_bracket_plate_7 = new THREE.Mesh(
    mesh_bracket_plate_7Geometry,
    materialMap["bracket-navy"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_plate_7.name = "Wall plate";
  if (endpoint_bracket_plate_7) {
    mesh_bracket_plate_7.position.copy(endpoint_bracket_plate_7.midpoint);
    mesh_bracket_plate_7.quaternion.copy(endpoint_bracket_plate_7.quaternion);
  }
  mesh_bracket_plate_7.castShadow = options.castShadow ?? true;
  mesh_bracket_plate_7.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_plate_7.userData.sculptComponent = {"id": "bracket-plate", "name": "Wall plate", "level": "macro", "role": "mount-plate", "importance": 0.7, "confidence": 0.75, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A flat manufactured plate with rounded corners and two through holes. A plate genuinely is a slab, so an extrude with real holes is the honest primitive rather than a solid the holes are painted onto.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 50, 74, 1.0)", "secondaryAlbedo": "rgba(32, 45, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "rounded-rectangle plate extruded to its thickness with two bores", "edgeTreatment": {"type": "fillet", "bevelRadius": 0.02, "segments": 2}, "deformationStack": [], "uvStrategy": "generated primitive UVs", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.1891, 0.31855], [0.18339, 0.34725], [0.16713, 0.37158], [0.1428, 0.38784], [0.1141, 0.39355], [-0.1141, 0.39355], [-0.1428, 0.38784], [-0.16713, 0.37158], [-0.18339, 0.34725], [-0.1891, 0.31855], [-0.1891, -0.31855], [-0.18339, -0.34725], [-0.16713, -0.37158], [-0.1428, -0.38784], [-0.1141, -0.39355], [0.1141, -0.39355], [0.1428, -0.38784], [0.16713, -0.37158], [0.18339, -0.34725], [0.1891, -0.31855]], "depth": 0.12, "ovalHoles": [{"cx": 0.0, "cy": 0.2303, "rx": 0.048, "ry": 0.048}, {"cx": 0.0, "cy": -0.2304, "rx": 0.048, "ry": 0.048}]}}, "parent": "handle-shaft", "attachment": null, "dimensions": {"width": 0.3782, "height": 0.7871, "depth": 0.12, "units": "world", "confidence": 0.75}, "transform": {"position": [-0.6421, 1.0175, -0.06], "rotation": [-0.0, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "wall-face", "position": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy on the plate."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "bracket-navy", "materialLayers": ["bracket-navy"], "deformations": [], "joints": [], "seams": [{"id": "plate-to-arm", "withComponent": "bracket-arm", "overlapWorldUnits": 0.03, "notes": "The arm starts 0.030 inside the plate's front face."}], "localFeatures": [{"id": "plate-corner-radius", "description": "All four corners carry a 0.075 radius, which is a fifth of the plate's width.", "geometry": "Rounded-rectangle outline, four arcs of four segments each.", "evidenceRefs": ["full-object", "bracket-zone"], "confidence": 0.85}, {"id": "plate-screw-bores", "description": "Two through holes of radius 0.048 sit on the plate centreline at y 1.248 and 0.787, 0.461 apart.", "geometry": "ExtrudeGeometry shape holes, so they are real openings rather than dark decals.", "evidenceRefs": ["full-object", "bracket-zone"], "confidence": 0.8}], "surfaceDetail": {"macroRoughness": 0.66, "microRoughness": 0.58, "bumpAmplitude": 0.008, "normalPattern": "flat moulded drift across the plate face", "displacementPattern": "none", "occlusionPattern": "darken both bore walls and the arm root", "edgeWearPattern": "light polish on the corner radii", "notes": "Matte navy plastic, the darkest material on the prop."}, "evidenceRefs": ["full-object", "bracket-zone"], "details": [], "fidelityTier": "structural-pass"};
  node_bracket_plate_7.add(mesh_bracket_plate_7);
  meshes["bracket-plate"] = mesh_bracket_plate_7;
  colliders["bracket-plate"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy on the plate."};
  destructionGroups["bracket"] ??= [];
  destructionGroups["bracket"].push(node_bracket_plate_7);
  const socket_bracket_plate_wall_face_0 = new THREE.Object3D();
  socket_bracket_plate_wall_face_0.name = "wall-face";
  socket_bracket_plate_wall_face_0.position.set(0.0, 0.0, 0.0);
  socket_bracket_plate_wall_face_0.rotation.set(0, 0, 0);
  socket_bracket_plate_wall_face_0.userData.socket = {"id": "wall-face", "position": [0, 0, 0]};
  node_bracket_plate_7.add(socket_bracket_plate_wall_face_0);
  sockets["bracket-plate:wall-face"] = socket_bracket_plate_wall_face_0;

  const attachment_bracket_arm_8 = {"parentId": "bracket-plate", "localStart": [-0.1603, 0.0, 0.0], "localEnd": [0.1603, 0.0, 0.0], "contactType": "embedded-root", "overlap": 0.03, "gapTolerance": 0.004, "geometryFromEndpoint": false, "evidenceRefs": ["full-object", "bracket-zone"], "notes": "The bar starts 0.030 inside the plate's front face."};
  const endpoint_bracket_arm_8 = makeAttachmentEndpoint(attachment_bracket_arm_8);
  const node_bracket_arm_8 = new THREE.Group();
  node_bracket_arm_8.name = "Bracket arm__pivot";
  if (endpoint_bracket_arm_8) {
    node_bracket_arm_8.position.copy(endpoint_bracket_arm_8.start);
    node_bracket_arm_8.rotation.set(0, 0, 0);
    node_bracket_arm_8.scale.set(1, 1, 1);
  } else {
    node_bracket_arm_8.position.set(0.3397, -0.0768, -0.005);
    node_bracket_arm_8.rotation.set(-0.0, 0.0, -0.0);
    node_bracket_arm_8.scale.set(1.0, 1.0, 1.0);
  }
  node_bracket_arm_8.userData.sculptComponent = {"id": "bracket-arm", "name": "Bracket arm", "level": "meso", "role": "mount-arm", "importance": 0.6, "confidence": 0.7, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A straight rectangular bar between the plate and the pivot boss. Manufactured stock, so a chamfered bar section is correct.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 50, 74, 1.0)", "secondaryAlbedo": "rgba(32, 45, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "straight bar from plate to pivot", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.022, "segments": 2}, "deformationStack": [], "uvStrategy": "generated primitive UVs", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.1603, 0.0548], [0.15863, 0.06322], [0.15386, 0.07036], [0.14672, 0.07513], [0.1383, 0.0768], [-0.1383, 0.0768], [-0.14672, 0.07513], [-0.15386, 0.07036], [-0.15863, 0.06322], [-0.1603, 0.0548], [-0.1603, -0.0548], [-0.15863, -0.06322], [-0.15386, -0.07036], [-0.14672, -0.07513], [-0.1383, -0.0768], [0.1383, -0.0768], [0.14672, -0.07513], [0.15386, -0.07036], [0.15863, -0.06322], [0.1603, -0.0548]], "depth": 0.13}}, "parent": "bracket-plate", "attachment": {"parentId": "bracket-plate", "localStart": [-0.1603, 0.0, 0.0], "localEnd": [0.1603, 0.0, 0.0], "contactType": "embedded-root", "overlap": 0.03, "gapTolerance": 0.004, "geometryFromEndpoint": false, "evidenceRefs": ["full-object", "bracket-zone"], "notes": "The bar starts 0.030 inside the plate's front face."}, "dimensions": {"width": 0.3206, "height": 0.1536, "depth": 0.13, "units": "world", "confidence": 0.7}, "transform": {"position": [0.3397, -0.0768, -0.005], "rotation": [-0.0, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy on the arm."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "bracket-navy", "materialLayers": ["bracket-navy"], "deformations": [], "joints": [], "seams": [{"id": "arm-to-plate", "withComponent": "bracket-plate", "overlapWorldUnits": 0.03, "notes": "Mirror of plate-to-arm."}, {"id": "arm-to-boss", "withComponent": "bracket-pivot-boss", "overlapWorldUnits": 0.04, "notes": "The boss overlaps the bar end by 0.040."}], "localFeatures": [{"id": "arm-edge-chamfer", "description": "The bar's long edges are softened by about 0.022, so it catches a highlight line along its top.", "geometry": "edgeTreatment chamfer at bevelRadius 0.022.", "evidenceRefs": ["bracket-zone"], "confidence": 0.7}], "surfaceDetail": {"macroRoughness": 0.66, "microRoughness": 0.58, "bumpAmplitude": 0.006, "normalPattern": "drift along the bar axis", "displacementPattern": "none", "occlusionPattern": "darken both ends where it meets the plate and the boss", "edgeWearPattern": "polish the top chamfer", "notes": "Matte navy plastic."}, "evidenceRefs": ["full-object", "bracket-zone"], "details": [], "fidelityTier": "structural-pass"};
  node_bracket_arm_8.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy on the arm."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}};
  (nodes["bracket-plate"] ?? root).add(node_bracket_arm_8);
  nodes["bracket-arm"] = node_bracket_arm_8;
  const mesh_bracket_arm_8Geometry = endpoint_bracket_arm_8
    ? new THREE.CylinderGeometry(endpoint_bracket_arm_8.endRadius, endpoint_bracket_arm_8.baseRadius, endpoint_bracket_arm_8.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0.1603, 0.0548], [0.15863, 0.06322], [0.15386, 0.07036], [0.14672, 0.07513], [0.1383, 0.0768], [-0.1383, 0.0768], [-0.14672, 0.07513], [-0.15386, 0.07036], [-0.15863, 0.06322], [-0.1603, 0.0548], [-0.1603, -0.0548], [-0.15863, -0.06322], [-0.15386, -0.07036], [-0.14672, -0.07513], [-0.1383, -0.0768], [0.1383, -0.0768], [0.14672, -0.07513], [0.15386, -0.07036], [0.15863, -0.06322], [0.1603, -0.0548]], "depth": 0.13});
  const mesh_bracket_arm_8 = new THREE.Mesh(
    mesh_bracket_arm_8Geometry,
    materialMap["bracket-navy"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_arm_8.name = "Bracket arm";
  if (endpoint_bracket_arm_8) {
    mesh_bracket_arm_8.position.copy(endpoint_bracket_arm_8.midpoint);
    mesh_bracket_arm_8.quaternion.copy(endpoint_bracket_arm_8.quaternion);
  }
  mesh_bracket_arm_8.castShadow = options.castShadow ?? true;
  mesh_bracket_arm_8.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_arm_8.userData.sculptComponent = {"id": "bracket-arm", "name": "Bracket arm", "level": "meso", "role": "mount-arm", "importance": 0.6, "confidence": 0.7, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A straight rectangular bar between the plate and the pivot boss. Manufactured stock, so a chamfered bar section is correct.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 50, 74, 1.0)", "secondaryAlbedo": "rgba(32, 45, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "straight bar from plate to pivot", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.022, "segments": 2}, "deformationStack": [], "uvStrategy": "generated primitive UVs", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.1603, 0.0548], [0.15863, 0.06322], [0.15386, 0.07036], [0.14672, 0.07513], [0.1383, 0.0768], [-0.1383, 0.0768], [-0.14672, 0.07513], [-0.15386, 0.07036], [-0.15863, 0.06322], [-0.1603, 0.0548], [-0.1603, -0.0548], [-0.15863, -0.06322], [-0.15386, -0.07036], [-0.14672, -0.07513], [-0.1383, -0.0768], [0.1383, -0.0768], [0.14672, -0.07513], [0.15386, -0.07036], [0.15863, -0.06322], [0.1603, -0.0548]], "depth": 0.13}}, "parent": "bracket-plate", "attachment": {"parentId": "bracket-plate", "localStart": [-0.1603, 0.0, 0.0], "localEnd": [0.1603, 0.0, 0.0], "contactType": "embedded-root", "overlap": 0.03, "gapTolerance": 0.004, "geometryFromEndpoint": false, "evidenceRefs": ["full-object", "bracket-zone"], "notes": "The bar starts 0.030 inside the plate's front face."}, "dimensions": {"width": 0.3206, "height": 0.1536, "depth": 0.13, "units": "world", "confidence": 0.7}, "transform": {"position": [0.3397, -0.0768, -0.005], "rotation": [-0.0, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy on the arm."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "bracket-navy", "materialLayers": ["bracket-navy"], "deformations": [], "joints": [], "seams": [{"id": "arm-to-plate", "withComponent": "bracket-plate", "overlapWorldUnits": 0.03, "notes": "Mirror of plate-to-arm."}, {"id": "arm-to-boss", "withComponent": "bracket-pivot-boss", "overlapWorldUnits": 0.04, "notes": "The boss overlaps the bar end by 0.040."}], "localFeatures": [{"id": "arm-edge-chamfer", "description": "The bar's long edges are softened by about 0.022, so it catches a highlight line along its top.", "geometry": "edgeTreatment chamfer at bevelRadius 0.022.", "evidenceRefs": ["bracket-zone"], "confidence": 0.7}], "surfaceDetail": {"macroRoughness": 0.66, "microRoughness": 0.58, "bumpAmplitude": 0.006, "normalPattern": "drift along the bar axis", "displacementPattern": "none", "occlusionPattern": "darken both ends where it meets the plate and the boss", "edgeWearPattern": "polish the top chamfer", "notes": "Matte navy plastic."}, "evidenceRefs": ["full-object", "bracket-zone"], "details": [], "fidelityTier": "structural-pass"};
  node_bracket_arm_8.add(mesh_bracket_arm_8);
  meshes["bracket-arm"] = mesh_bracket_arm_8;
  colliders["bracket-arm"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy on the arm."};
  destructionGroups["bracket"] ??= [];
  destructionGroups["bracket"].push(node_bracket_arm_8);

  const attachment_bracket_pivot_boss_9 = {"parentId": "bracket-arm", "localStart": [0.0, -0.075, 0.0], "localEnd": [0.0, 0.075, 0.0], "contactType": "butt-joint", "overlap": 0.04, "gapTolerance": 0.004, "geometryFromEndpoint": false, "evidenceRefs": ["bracket-zone"], "notes": "The boss overlaps the bar's outer end by 0.040."};
  const endpoint_bracket_pivot_boss_9 = makeAttachmentEndpoint(attachment_bracket_pivot_boss_9);
  const node_bracket_pivot_boss_9 = new THREE.Group();
  node_bracket_pivot_boss_9.name = "Pivot boss__pivot";
  if (endpoint_bracket_pivot_boss_9) {
    node_bracket_pivot_boss_9.position.copy(endpoint_bracket_pivot_boss_9.start);
    node_bracket_pivot_boss_9.rotation.set(0, 0, 0);
    node_bracket_pivot_boss_9.scale.set(1, 1, 1);
  } else {
    node_bracket_pivot_boss_9.position.set(0.0221, 0.0, 0.065);
    node_bracket_pivot_boss_9.rotation.set(-0.0, 0.0, 1.570796);
    node_bracket_pivot_boss_9.scale.set(1.0, 1.0, 1.0);
  }
  node_bracket_pivot_boss_9.userData.sculptComponent = {"id": "bracket-pivot-boss", "name": "Pivot boss", "level": "meso", "role": "pivot-hardware", "importance": 0.55, "confidence": 0.65, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "A short drum on the arm's outer end, its axis along the arm, with a flat chamfered face. Assembled hardware.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 50, 74, 1.0)", "secondaryAlbedo": "rgba(32, 45, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "revolved pivot drum at the arm end", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.016, "segments": 2}, "deformationStack": [], "uvStrategy": "generated primitive UVs", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.01, -0.075], [0.0992, -0.075], [0.1152, -0.059], [0.1152, 0.059], [0.0992, 0.075], [0.01, 0.075]], "segments": 20}}, "parent": "bracket-arm", "attachment": {"parentId": "bracket-arm", "localStart": [0.0, -0.075, 0.0], "localEnd": [0.0, 0.075, 0.0], "contactType": "butt-joint", "overlap": 0.04, "gapTolerance": 0.004, "geometryFromEndpoint": false, "evidenceRefs": ["bracket-zone"], "notes": "The boss overlaps the bar's outer end by 0.040."}, "dimensions": {"width": 0.15, "height": 0.2304, "depth": 0.2304, "units": "world", "confidence": 0.65}, "transform": {"position": [0.0221, 0.0, 0.065], "rotation": [-0.0, 0.0, 1.570796], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "hinge", "pivot": {"mode": "custom", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.65}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "pivot-axis", "position": [0, 0, 0]}], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Cylinder proxy on the boss."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "bracket-navy", "materialLayers": ["bracket-navy"], "deformations": [], "joints": [], "seams": [{"id": "boss-to-arm", "withComponent": "bracket-arm", "overlapWorldUnits": 0.04, "notes": "Mirror of arm-to-boss."}], "localFeatures": [{"id": "boss-face-flat", "description": "The boss end reads as a flat disc, not a dome, with a bright chamfer ring.", "geometry": "Cylinder with a 0.016 chamfer, no cap dome.", "evidenceRefs": ["bracket-zone"], "confidence": 0.65}], "surfaceDetail": {"macroRoughness": 0.64, "microRoughness": 0.56, "bumpAmplitude": 0.006, "normalPattern": "concentric drift around the pivot axis", "displacementPattern": "none", "occlusionPattern": "darken the arm contact", "edgeWearPattern": "polish the face chamfer", "notes": "Matte navy plastic."}, "evidenceRefs": ["full-object", "bracket-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_bracket_pivot_boss_9.userData.actionProfile = {"animationRole": "hinge", "pivot": {"mode": "custom", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.65}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "pivot-axis", "position": [0, 0, 0]}], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Cylinder proxy on the boss."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}};
  (nodes["bracket-arm"] ?? root).add(node_bracket_pivot_boss_9);
  nodes["bracket-pivot-boss"] = node_bracket_pivot_boss_9;
  const mesh_bracket_pivot_boss_9Geometry = endpoint_bracket_pivot_boss_9
    ? new THREE.CylinderGeometry(endpoint_bracket_pivot_boss_9.endRadius, endpoint_bracket_pivot_boss_9.baseRadius, endpoint_bracket_pivot_boss_9.length, 32, 12)
    : buildLatheGeometry({"points": [[0.01, -0.075], [0.0992, -0.075], [0.1152, -0.059], [0.1152, 0.059], [0.0992, 0.075], [0.01, 0.075]], "segments": 20});
  const mesh_bracket_pivot_boss_9 = new THREE.Mesh(
    mesh_bracket_pivot_boss_9Geometry,
    materialMap["bracket-navy"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_pivot_boss_9.name = "Pivot boss";
  if (endpoint_bracket_pivot_boss_9) {
    mesh_bracket_pivot_boss_9.position.copy(endpoint_bracket_pivot_boss_9.midpoint);
    mesh_bracket_pivot_boss_9.quaternion.copy(endpoint_bracket_pivot_boss_9.quaternion);
  }
  mesh_bracket_pivot_boss_9.castShadow = options.castShadow ?? true;
  mesh_bracket_pivot_boss_9.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_pivot_boss_9.userData.sculptComponent = {"id": "bracket-pivot-boss", "name": "Pivot boss", "level": "meso", "role": "pivot-hardware", "importance": 0.55, "confidence": 0.65, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "A short drum on the arm's outer end, its axis along the arm, with a flat chamfered face. Assembled hardware.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 50, 74, 1.0)", "secondaryAlbedo": "rgba(32, 45, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "revolved pivot drum at the arm end", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.016, "segments": 2}, "deformationStack": [], "uvStrategy": "generated primitive UVs", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.01, -0.075], [0.0992, -0.075], [0.1152, -0.059], [0.1152, 0.059], [0.0992, 0.075], [0.01, 0.075]], "segments": 20}}, "parent": "bracket-arm", "attachment": {"parentId": "bracket-arm", "localStart": [0.0, -0.075, 0.0], "localEnd": [0.0, 0.075, 0.0], "contactType": "butt-joint", "overlap": 0.04, "gapTolerance": 0.004, "geometryFromEndpoint": false, "evidenceRefs": ["bracket-zone"], "notes": "The boss overlaps the bar's outer end by 0.040."}, "dimensions": {"width": 0.15, "height": 0.2304, "depth": 0.2304, "units": "world", "confidence": 0.65}, "transform": {"position": [0.0221, 0.0, 0.065], "rotation": [-0.0, 0.0, 1.570796], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "hinge", "pivot": {"mode": "custom", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.65}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "pivot-axis", "position": [0, 0, 0]}], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Cylinder proxy on the boss."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "bracket-navy", "materialLayers": ["bracket-navy"], "deformations": [], "joints": [], "seams": [{"id": "boss-to-arm", "withComponent": "bracket-arm", "overlapWorldUnits": 0.04, "notes": "Mirror of arm-to-boss."}], "localFeatures": [{"id": "boss-face-flat", "description": "The boss end reads as a flat disc, not a dome, with a bright chamfer ring.", "geometry": "Cylinder with a 0.016 chamfer, no cap dome.", "evidenceRefs": ["bracket-zone"], "confidence": 0.65}], "surfaceDetail": {"macroRoughness": 0.64, "microRoughness": 0.56, "bumpAmplitude": 0.006, "normalPattern": "concentric drift around the pivot axis", "displacementPattern": "none", "occlusionPattern": "darken the arm contact", "edgeWearPattern": "polish the face chamfer", "notes": "Matte navy plastic."}, "evidenceRefs": ["full-object", "bracket-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_bracket_pivot_boss_9.add(mesh_bracket_pivot_boss_9);
  meshes["bracket-pivot-boss"] = mesh_bracket_pivot_boss_9;
  colliders["bracket-pivot-boss"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Cylinder proxy on the boss."};
  destructionGroups["bracket"] ??= [];
  destructionGroups["bracket"].push(node_bracket_pivot_boss_9);
  const socket_bracket_pivot_boss_pivot_axis_0 = new THREE.Object3D();
  socket_bracket_pivot_boss_pivot_axis_0.name = "pivot-axis";
  socket_bracket_pivot_boss_pivot_axis_0.position.set(0.0, 0.0, 0.0);
  socket_bracket_pivot_boss_pivot_axis_0.rotation.set(0, 0, 0);
  socket_bracket_pivot_boss_pivot_axis_0.userData.socket = {"id": "pivot-axis", "position": [0, 0, 0]};
  node_bracket_pivot_boss_9.add(socket_bracket_pivot_boss_pivot_axis_0);
  sockets["bracket-pivot-boss:pivot-axis"] = socket_bracket_pivot_boss_pivot_axis_0;

  const attachment_bracket_pivot_ring_10 = {"parentId": "bracket-pivot-boss", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.016, 0.0, 0.0], "contactType": "surface-relief", "overlap": 0.02, "gapTolerance": 0.004, "geometryFromEndpoint": false, "evidenceRefs": ["bracket-zone"], "notes": "Relief on the boss face, sunk 0.020 into it, so it rides the boss rather than exploding on its own."};
  const endpoint_bracket_pivot_ring_10 = makeAttachmentEndpoint(attachment_bracket_pivot_ring_10);
  const node_bracket_pivot_ring_10 = new THREE.Group();
  node_bracket_pivot_ring_10.name = "Pivot face ring__pivot";
  if (endpoint_bracket_pivot_ring_10) {
    node_bracket_pivot_ring_10.position.copy(endpoint_bracket_pivot_ring_10.start);
    node_bracket_pivot_ring_10.rotation.set(0, 0, 0);
    node_bracket_pivot_ring_10.scale.set(1, 1, 1);
  } else {
    node_bracket_pivot_ring_10.position.set(-0.0, 0.079, 0.0);
    node_bracket_pivot_ring_10.rotation.set(-0.0, 0.0, -1.570796);
    node_bracket_pivot_ring_10.scale.set(1.0, 1.0, 1.0);
  }
  node_bracket_pivot_ring_10.userData.sculptComponent = {"id": "bracket-pivot-ring", "name": "Pivot face ring", "level": "micro", "role": "surface-relief", "importance": 0.4, "confidence": 0.55, "primitive": "tube", "topologyClass": "surface-relief", "topologyRationale": "A raised concentric ring on the boss face. It belongs to the boss and rides it; it is relief, not an independent part.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 50, 74, 1.0)", "secondaryAlbedo": "rgba(32, 45, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "raised ring on the boss face", "edgeTreatment": {"type": "fillet", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated primitive UVs", "normalStrategy": "vertex normals from generated geometry", "tubePath": {"points": [[0.0, 0.072, 0.0], [0.0, 0.06652, 0.02755], [0.0, 0.05091, 0.05091], [0.0, 0.02755, 0.06652], [0.0, 0.0, 0.072], [0.0, -0.02755, 0.06652], [0.0, -0.05091, 0.05091], [0.0, -0.06652, 0.02755], [0.0, -0.072, 0.0], [0.0, -0.06652, -0.02755], [0.0, -0.05091, -0.05091], [0.0, -0.02755, -0.06652], [0.0, -0.0, -0.072], [0.0, 0.02755, -0.06652], [0.0, 0.05091, -0.05091], [0.0, 0.06652, -0.02755]], "radius": 0.016, "radialSegments": 6, "closed": true}}, "parent": "bracket-pivot-boss", "attachment": {"parentId": "bracket-pivot-boss", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.016, 0.0, 0.0], "contactType": "surface-relief", "overlap": 0.02, "gapTolerance": 0.004, "geometryFromEndpoint": false, "evidenceRefs": ["bracket-zone"], "notes": "Relief on the boss face, sunk 0.020 into it, so it rides the boss rather than exploding on its own."}, "dimensions": {"width": 0.032, "height": 0.144, "depth": 0.144, "units": "world", "confidence": 0.55}, "transform": {"position": [-0.0, 0.079, 0.0], "rotation": [-0.0, 0.0, -1.570796], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.55}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Not a separate collider in practice."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "bracket-navy", "materialLayers": ["bracket-navy"], "deformations": [], "joints": [], "seams": [{"id": "ring-to-boss", "withComponent": "bracket-pivot-boss", "overlapWorldUnits": 0.02, "notes": "The ring sinks 0.020 into the boss face."}], "localFeatures": [{"id": "ring-relief", "description": "A ring of radius 0.072 stands about 0.016 proud of the boss face and catches a highlight along its crown.", "geometry": "Closed tube loop about the pivot axis, sunk 0.004 into the face.", "evidenceRefs": ["bracket-zone"], "confidence": 0.6}], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.54, "bumpAmplitude": 0.01, "normalPattern": "ring-aligned relief", "displacementPattern": "none", "occlusionPattern": "darken the ring root groove", "edgeWearPattern": "polish the ring crown", "notes": "Matte navy plastic."}, "evidenceRefs": ["bracket-zone"], "details": [], "fidelityTier": "surface-pass"};
  node_bracket_pivot_ring_10.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.55}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Not a separate collider in practice."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}};
  (nodes["bracket-pivot-boss"] ?? root).add(node_bracket_pivot_ring_10);
  nodes["bracket-pivot-ring"] = node_bracket_pivot_ring_10;
  const mesh_bracket_pivot_ring_10Geometry = endpoint_bracket_pivot_ring_10
    ? new THREE.CylinderGeometry(endpoint_bracket_pivot_ring_10.endRadius, endpoint_bracket_pivot_ring_10.baseRadius, endpoint_bracket_pivot_ring_10.length, 32, 12)
    : buildTubeGeometry({"points": [[0.0, 0.072, 0.0], [0.0, 0.06652, 0.02755], [0.0, 0.05091, 0.05091], [0.0, 0.02755, 0.06652], [0.0, 0.0, 0.072], [0.0, -0.02755, 0.06652], [0.0, -0.05091, 0.05091], [0.0, -0.06652, 0.02755], [0.0, -0.072, 0.0], [0.0, -0.06652, -0.02755], [0.0, -0.05091, -0.05091], [0.0, -0.02755, -0.06652], [0.0, -0.0, -0.072], [0.0, 0.02755, -0.06652], [0.0, 0.05091, -0.05091], [0.0, 0.06652, -0.02755]], "radius": 0.016, "radialSegments": 6, "closed": true});
  const mesh_bracket_pivot_ring_10 = new THREE.Mesh(
    mesh_bracket_pivot_ring_10Geometry,
    materialMap["bracket-navy"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_pivot_ring_10.name = "Pivot face ring";
  if (endpoint_bracket_pivot_ring_10) {
    mesh_bracket_pivot_ring_10.position.copy(endpoint_bracket_pivot_ring_10.midpoint);
    mesh_bracket_pivot_ring_10.quaternion.copy(endpoint_bracket_pivot_ring_10.quaternion);
  }
  mesh_bracket_pivot_ring_10.castShadow = options.castShadow ?? true;
  mesh_bracket_pivot_ring_10.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_pivot_ring_10.userData.sculptComponent = {"id": "bracket-pivot-ring", "name": "Pivot face ring", "level": "micro", "role": "surface-relief", "importance": 0.4, "confidence": 0.55, "primitive": "tube", "topologyClass": "surface-relief", "topologyRationale": "A raised concentric ring on the boss face. It belongs to the boss and rides it; it is relief, not an independent part.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 50, 74, 1.0)", "secondaryAlbedo": "rgba(32, 45, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "raised ring on the boss face", "edgeTreatment": {"type": "fillet", "bevelRadius": 0.008, "segments": 1}, "deformationStack": [], "uvStrategy": "generated primitive UVs", "normalStrategy": "vertex normals from generated geometry", "tubePath": {"points": [[0.0, 0.072, 0.0], [0.0, 0.06652, 0.02755], [0.0, 0.05091, 0.05091], [0.0, 0.02755, 0.06652], [0.0, 0.0, 0.072], [0.0, -0.02755, 0.06652], [0.0, -0.05091, 0.05091], [0.0, -0.06652, 0.02755], [0.0, -0.072, 0.0], [0.0, -0.06652, -0.02755], [0.0, -0.05091, -0.05091], [0.0, -0.02755, -0.06652], [0.0, -0.0, -0.072], [0.0, 0.02755, -0.06652], [0.0, 0.05091, -0.05091], [0.0, 0.06652, -0.02755]], "radius": 0.016, "radialSegments": 6, "closed": true}}, "parent": "bracket-pivot-boss", "attachment": {"parentId": "bracket-pivot-boss", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.016, 0.0, 0.0], "contactType": "surface-relief", "overlap": 0.02, "gapTolerance": 0.004, "geometryFromEndpoint": false, "evidenceRefs": ["bracket-zone"], "notes": "Relief on the boss face, sunk 0.020 into it, so it rides the boss rather than exploding on its own."}, "dimensions": {"width": 0.032, "height": 0.144, "depth": 0.144, "units": "world", "confidence": 0.55}, "transform": {"position": [-0.0, 0.079, 0.0], "rotation": [-0.0, 0.0, -1.570796], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.55}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Not a separate collider in practice."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "bracket-navy", "materialLayers": ["bracket-navy"], "deformations": [], "joints": [], "seams": [{"id": "ring-to-boss", "withComponent": "bracket-pivot-boss", "overlapWorldUnits": 0.02, "notes": "The ring sinks 0.020 into the boss face."}], "localFeatures": [{"id": "ring-relief", "description": "A ring of radius 0.072 stands about 0.016 proud of the boss face and catches a highlight along its crown.", "geometry": "Closed tube loop about the pivot axis, sunk 0.004 into the face.", "evidenceRefs": ["bracket-zone"], "confidence": 0.6}], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.54, "bumpAmplitude": 0.01, "normalPattern": "ring-aligned relief", "displacementPattern": "none", "occlusionPattern": "darken the ring root groove", "edgeWearPattern": "polish the ring crown", "notes": "Matte navy plastic."}, "evidenceRefs": ["bracket-zone"], "details": [], "fidelityTier": "surface-pass"};
  node_bracket_pivot_ring_10.add(mesh_bracket_pivot_ring_10);
  meshes["bracket-pivot-ring"] = mesh_bracket_pivot_ring_10;
  colliders["bracket-pivot-ring"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Not a separate collider in practice."};
  destructionGroups["bracket"] ??= [];
  destructionGroups["bracket"].push(node_bracket_pivot_ring_10);

  const attachment_bracket_collar_11 = {"parentId": "bracket-pivot-boss", "localStart": [0.0, -0.047, 0.0], "localEnd": [0.0, 0.047, 0.0], "contactType": "clamped-band", "overlap": 0.037, "gapTolerance": 0.004, "geometryFromEndpoint": false, "evidenceRefs": ["full-object", "bracket-zone"], "notes": "The band's inner wall sits 0.037 inside the shaft radius at that height, which is what makes it read as gripping rather than hovering."};
  const endpoint_bracket_collar_11 = makeAttachmentEndpoint(attachment_bracket_collar_11);
  const node_bracket_collar_11 = new THREE.Group();
  node_bracket_collar_11.name = "Clamp collar__pivot";
  if (endpoint_bracket_collar_11) {
    node_bracket_collar_11.position.copy(endpoint_bracket_collar_11.start);
    node_bracket_collar_11.rotation.set(0, 0, 0);
    node_bracket_collar_11.scale.set(1, 1, 1);
  } else {
    node_bracket_collar_11.position.set(-0.0768, -0.2803, 0.0);
    node_bracket_collar_11.rotation.set(-0.0, 0.0, -1.570796);
    node_bracket_collar_11.scale.set(1.0, 1.0, 1.0);
  }
  node_bracket_collar_11.userData.sculptComponent = {"id": "bracket-collar", "name": "Clamp collar", "level": "meso", "role": "clamp-band", "importance": 0.65, "confidence": 0.7, "primitive": "tube", "topologyClass": "conforming-shell", "topologyRationale": "A band that wraps the handle. It conforms to the shaft rather than being a solid of its own, so a closed swept loop is the right family.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 50, 74, 1.0)", "secondaryAlbedo": "rgba(32, 45, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "closed band wrapped around the handle", "edgeTreatment": {"type": "fillet", "bevelRadius": 0.014, "segments": 2}, "deformationStack": [], "uvStrategy": "generated primitive UVs", "normalStrategy": "vertex normals from generated geometry", "tubePath": {"points": [[0.203, 0.0, 0.0], [0.19306, 0.0, 0.06273], [0.16423, 0.0, 0.11932], [0.11932, 0.0, 0.16423], [0.06273, 0.0, 0.19306], [0.0, 0.0, 0.203], [-0.06273, 0.0, 0.19306], [-0.11932, 0.0, 0.16423], [-0.16423, 0.0, 0.11932], [-0.19306, 0.0, 0.06273], [-0.203, 0.0, 0.0], [-0.19306, 0.0, -0.06273], [-0.16423, 0.0, -0.11932], [-0.11932, 0.0, -0.16423], [-0.06273, 0.0, -0.19306], [-0.0, 0.0, -0.203], [0.06273, 0.0, -0.19306], [0.11932, 0.0, -0.16423], [0.16423, 0.0, -0.11932], [0.19306, 0.0, -0.06273]], "radius": 0.047, "radialSegments": 10, "closed": true}}, "parent": "bracket-pivot-boss", "attachment": {"parentId": "bracket-pivot-boss", "localStart": [0.0, -0.047, 0.0], "localEnd": [0.0, 0.047, 0.0], "contactType": "clamped-band", "overlap": 0.037, "gapTolerance": 0.004, "geometryFromEndpoint": false, "evidenceRefs": ["full-object", "bracket-zone"], "notes": "The band's inner wall sits 0.037 inside the shaft radius at that height, which is what makes it read as gripping rather than hovering."}, "dimensions": {"width": 0.5, "height": 0.094, "depth": 0.5, "units": "world", "confidence": 0.7}, "transform": {"position": [-0.0768, -0.2803, 0.0], "rotation": [-0.0, 0.0, -1.570796], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Cylinder proxy on the collar band."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "bracket-navy", "materialLayers": ["bracket-navy"], "deformations": [], "joints": [], "seams": [{"id": "collar-to-shaft", "withComponent": "handle-shaft", "overlapWorldUnits": 0.037, "notes": "Mirror of shaft-to-collar."}, {"id": "collar-to-lug", "withComponent": "bracket-collar-lug", "overlapWorldUnits": 0.036, "notes": "The lug sinks 0.036 into the band."}], "localFeatures": [{"id": "collar-grip", "description": "The band's inner wall sits 0.037 inside the shaft radius at that height, so it reads as clamped rather than floating.", "geometry": "Ring centreline radius 0.203 against a shaft radius of 0.166 there.", "evidenceRefs": ["full-object", "bracket-zone"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.66, "microRoughness": 0.58, "bumpAmplitude": 0.008, "normalPattern": "band-aligned drift", "displacementPattern": "none", "occlusionPattern": "darken the shaft contact ring", "edgeWearPattern": "polish the band crown", "notes": "Matte navy plastic."}, "evidenceRefs": ["full-object", "bracket-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_bracket_collar_11.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Cylinder proxy on the collar band."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}};
  (nodes["bracket-pivot-boss"] ?? root).add(node_bracket_collar_11);
  nodes["bracket-collar"] = node_bracket_collar_11;
  const mesh_bracket_collar_11Geometry = endpoint_bracket_collar_11
    ? new THREE.CylinderGeometry(endpoint_bracket_collar_11.endRadius, endpoint_bracket_collar_11.baseRadius, endpoint_bracket_collar_11.length, 32, 12)
    : buildTubeGeometry({"points": [[0.203, 0.0, 0.0], [0.19306, 0.0, 0.06273], [0.16423, 0.0, 0.11932], [0.11932, 0.0, 0.16423], [0.06273, 0.0, 0.19306], [0.0, 0.0, 0.203], [-0.06273, 0.0, 0.19306], [-0.11932, 0.0, 0.16423], [-0.16423, 0.0, 0.11932], [-0.19306, 0.0, 0.06273], [-0.203, 0.0, 0.0], [-0.19306, 0.0, -0.06273], [-0.16423, 0.0, -0.11932], [-0.11932, 0.0, -0.16423], [-0.06273, 0.0, -0.19306], [-0.0, 0.0, -0.203], [0.06273, 0.0, -0.19306], [0.11932, 0.0, -0.16423], [0.16423, 0.0, -0.11932], [0.19306, 0.0, -0.06273]], "radius": 0.047, "radialSegments": 10, "closed": true});
  const mesh_bracket_collar_11 = new THREE.Mesh(
    mesh_bracket_collar_11Geometry,
    materialMap["bracket-navy"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_collar_11.name = "Clamp collar";
  if (endpoint_bracket_collar_11) {
    mesh_bracket_collar_11.position.copy(endpoint_bracket_collar_11.midpoint);
    mesh_bracket_collar_11.quaternion.copy(endpoint_bracket_collar_11.quaternion);
  }
  mesh_bracket_collar_11.castShadow = options.castShadow ?? true;
  mesh_bracket_collar_11.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_collar_11.userData.sculptComponent = {"id": "bracket-collar", "name": "Clamp collar", "level": "meso", "role": "clamp-band", "importance": 0.65, "confidence": 0.7, "primitive": "tube", "topologyClass": "conforming-shell", "topologyRationale": "A band that wraps the handle. It conforms to the shaft rather than being a solid of its own, so a closed swept loop is the right family.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 50, 74, 1.0)", "secondaryAlbedo": "rgba(32, 45, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "closed band wrapped around the handle", "edgeTreatment": {"type": "fillet", "bevelRadius": 0.014, "segments": 2}, "deformationStack": [], "uvStrategy": "generated primitive UVs", "normalStrategy": "vertex normals from generated geometry", "tubePath": {"points": [[0.203, 0.0, 0.0], [0.19306, 0.0, 0.06273], [0.16423, 0.0, 0.11932], [0.11932, 0.0, 0.16423], [0.06273, 0.0, 0.19306], [0.0, 0.0, 0.203], [-0.06273, 0.0, 0.19306], [-0.11932, 0.0, 0.16423], [-0.16423, 0.0, 0.11932], [-0.19306, 0.0, 0.06273], [-0.203, 0.0, 0.0], [-0.19306, 0.0, -0.06273], [-0.16423, 0.0, -0.11932], [-0.11932, 0.0, -0.16423], [-0.06273, 0.0, -0.19306], [-0.0, 0.0, -0.203], [0.06273, 0.0, -0.19306], [0.11932, 0.0, -0.16423], [0.16423, 0.0, -0.11932], [0.19306, 0.0, -0.06273]], "radius": 0.047, "radialSegments": 10, "closed": true}}, "parent": "bracket-pivot-boss", "attachment": {"parentId": "bracket-pivot-boss", "localStart": [0.0, -0.047, 0.0], "localEnd": [0.0, 0.047, 0.0], "contactType": "clamped-band", "overlap": 0.037, "gapTolerance": 0.004, "geometryFromEndpoint": false, "evidenceRefs": ["full-object", "bracket-zone"], "notes": "The band's inner wall sits 0.037 inside the shaft radius at that height, which is what makes it read as gripping rather than hovering."}, "dimensions": {"width": 0.5, "height": 0.094, "depth": 0.5, "units": "world", "confidence": 0.7}, "transform": {"position": [-0.0768, -0.2803, 0.0], "rotation": [-0.0, 0.0, -1.570796], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.7}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Cylinder proxy on the collar band."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "bracket-navy", "materialLayers": ["bracket-navy"], "deformations": [], "joints": [], "seams": [{"id": "collar-to-shaft", "withComponent": "handle-shaft", "overlapWorldUnits": 0.037, "notes": "Mirror of shaft-to-collar."}, {"id": "collar-to-lug", "withComponent": "bracket-collar-lug", "overlapWorldUnits": 0.036, "notes": "The lug sinks 0.036 into the band."}], "localFeatures": [{"id": "collar-grip", "description": "The band's inner wall sits 0.037 inside the shaft radius at that height, so it reads as clamped rather than floating.", "geometry": "Ring centreline radius 0.203 against a shaft radius of 0.166 there.", "evidenceRefs": ["full-object", "bracket-zone"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.66, "microRoughness": 0.58, "bumpAmplitude": 0.008, "normalPattern": "band-aligned drift", "displacementPattern": "none", "occlusionPattern": "darken the shaft contact ring", "edgeWearPattern": "polish the band crown", "notes": "Matte navy plastic."}, "evidenceRefs": ["full-object", "bracket-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_bracket_collar_11.add(mesh_bracket_collar_11);
  meshes["bracket-collar"] = mesh_bracket_collar_11;
  colliders["bracket-collar"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Cylinder proxy on the collar band."};
  destructionGroups["bracket"] ??= [];
  destructionGroups["bracket"].push(node_bracket_collar_11);

  const attachment_bracket_collar_lug_12 = null;
  const endpoint_bracket_collar_lug_12 = makeAttachmentEndpoint(attachment_bracket_collar_lug_12);
  const node_bracket_collar_lug_12 = new THREE.Group();
  node_bracket_collar_lug_12.name = "Collar clamp lug__pivot";
  if (endpoint_bracket_collar_lug_12) {
    node_bracket_collar_lug_12.position.copy(endpoint_bracket_collar_lug_12.start);
    node_bracket_collar_lug_12.rotation.set(0, 0, 0);
    node_bracket_collar_lug_12.scale.set(1, 1, 1);
  } else {
    node_bracket_collar_lug_12.position.set(0.1997, 0.0, -0.0575);
    node_bracket_collar_lug_12.rotation.set(-0.0, 0.0, -0.0);
    node_bracket_collar_lug_12.scale.set(1.0, 1.0, 1.0);
  }
  node_bracket_collar_lug_12.userData.sculptComponent = {"id": "bracket-collar-lug", "name": "Collar clamp lug", "level": "micro", "role": "clamp-lug", "importance": 0.45, "confidence": 0.6, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "The raised block on the collar's claw side that a real split clamp bolts through.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 50, 74, 1.0)", "secondaryAlbedo": "rgba(32, 45, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "raised clamp lug on the collar", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "uvStrategy": "generated primitive UVs", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.0768, 0.058], [0.07589, 0.06259], [0.07329, 0.06649], [0.06939, 0.06909], [0.0648, 0.07], [-0.0648, 0.07], [-0.06939, 0.06909], [-0.07329, 0.06649], [-0.07589, 0.06259], [-0.0768, 0.058], [-0.0768, -0.058], [-0.07589, -0.06259], [-0.07329, -0.06649], [-0.06939, -0.06909], [-0.0648, -0.07], [0.0648, -0.07], [0.06939, -0.06909], [0.07329, -0.06649], [0.07589, -0.06259], [0.0768, -0.058]], "depth": 0.115}}, "parent": "bracket-collar", "attachment": null, "dimensions": {"width": 0.1536, "height": 0.14, "depth": 0.115, "units": "world", "confidence": 0.6}, "transform": {"position": [0.1997, 0.0, -0.0575], "rotation": [-0.0, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy on the lug."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "bracket-navy", "materialLayers": ["bracket-navy"], "deformations": [], "joints": [], "seams": [{"id": "lug-to-collar", "withComponent": "bracket-collar", "overlapWorldUnits": 0.036, "notes": "Mirror of collar-to-lug."}], "localFeatures": [{"id": "lug-split-line", "description": "A horizontal split runs across the lug where the two halves of the clamp meet.", "geometry": "Panel-line local override across the lug, no depth.", "evidenceRefs": ["bracket-zone"], "confidence": 0.55}], "surfaceDetail": {"macroRoughness": 0.66, "microRoughness": 0.58, "bumpAmplitude": 0.006, "normalPattern": "flat drift", "displacementPattern": "none", "occlusionPattern": "darken the split line and the band contact", "edgeWearPattern": "polish the lug chamfers", "notes": "Matte navy plastic."}, "evidenceRefs": ["bracket-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_bracket_collar_lug_12.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy on the lug."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}};
  (nodes["bracket-collar"] ?? root).add(node_bracket_collar_lug_12);
  nodes["bracket-collar-lug"] = node_bracket_collar_lug_12;
  const mesh_bracket_collar_lug_12Geometry = endpoint_bracket_collar_lug_12
    ? new THREE.CylinderGeometry(endpoint_bracket_collar_lug_12.endRadius, endpoint_bracket_collar_lug_12.baseRadius, endpoint_bracket_collar_lug_12.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0.0768, 0.058], [0.07589, 0.06259], [0.07329, 0.06649], [0.06939, 0.06909], [0.0648, 0.07], [-0.0648, 0.07], [-0.06939, 0.06909], [-0.07329, 0.06649], [-0.07589, 0.06259], [-0.0768, 0.058], [-0.0768, -0.058], [-0.07589, -0.06259], [-0.07329, -0.06649], [-0.06939, -0.06909], [-0.0648, -0.07], [0.0648, -0.07], [0.06939, -0.06909], [0.07329, -0.06649], [0.07589, -0.06259], [0.0768, -0.058]], "depth": 0.115});
  const mesh_bracket_collar_lug_12 = new THREE.Mesh(
    mesh_bracket_collar_lug_12Geometry,
    materialMap["bracket-navy"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_collar_lug_12.name = "Collar clamp lug";
  if (endpoint_bracket_collar_lug_12) {
    mesh_bracket_collar_lug_12.position.copy(endpoint_bracket_collar_lug_12.midpoint);
    mesh_bracket_collar_lug_12.quaternion.copy(endpoint_bracket_collar_lug_12.quaternion);
  }
  mesh_bracket_collar_lug_12.castShadow = options.castShadow ?? true;
  mesh_bracket_collar_lug_12.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_collar_lug_12.userData.sculptComponent = {"id": "bracket-collar-lug", "name": "Collar clamp lug", "level": "micro", "role": "clamp-lug", "importance": 0.45, "confidence": 0.6, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "The raised block on the collar's claw side that a real split clamp bolts through.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 50, 74, 1.0)", "secondaryAlbedo": "rgba(32, 45, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "raised clamp lug on the collar", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 2}, "deformationStack": [], "uvStrategy": "generated primitive UVs", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.0768, 0.058], [0.07589, 0.06259], [0.07329, 0.06649], [0.06939, 0.06909], [0.0648, 0.07], [-0.0648, 0.07], [-0.06939, 0.06909], [-0.07329, 0.06649], [-0.07589, 0.06259], [-0.0768, 0.058], [-0.0768, -0.058], [-0.07589, -0.06259], [-0.07329, -0.06649], [-0.06939, -0.06909], [-0.0648, -0.07], [0.0648, -0.07], [0.06939, -0.06909], [0.07329, -0.06649], [0.07589, -0.06259], [0.0768, -0.058]], "depth": 0.115}}, "parent": "bracket-collar", "attachment": null, "dimensions": {"width": 0.1536, "height": 0.14, "depth": 0.115, "units": "world", "confidence": 0.6}, "transform": {"position": [0.1997, 0.0, -0.0575], "rotation": [-0.0, 0.0, -0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy on the lug."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "bracket-navy", "materialLayers": ["bracket-navy"], "deformations": [], "joints": [], "seams": [{"id": "lug-to-collar", "withComponent": "bracket-collar", "overlapWorldUnits": 0.036, "notes": "Mirror of collar-to-lug."}], "localFeatures": [{"id": "lug-split-line", "description": "A horizontal split runs across the lug where the two halves of the clamp meet.", "geometry": "Panel-line local override across the lug, no depth.", "evidenceRefs": ["bracket-zone"], "confidence": 0.55}], "surfaceDetail": {"macroRoughness": 0.66, "microRoughness": 0.58, "bumpAmplitude": 0.006, "normalPattern": "flat drift", "displacementPattern": "none", "occlusionPattern": "darken the split line and the band contact", "edgeWearPattern": "polish the lug chamfers", "notes": "Matte navy plastic."}, "evidenceRefs": ["bracket-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_bracket_collar_lug_12.add(mesh_bracket_collar_lug_12);
  meshes["bracket-collar-lug"] = mesh_bracket_collar_lug_12;
  colliders["bracket-collar-lug"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Box proxy on the lug."};
  destructionGroups["bracket"] ??= [];
  destructionGroups["bracket"].push(node_bracket_collar_lug_12);

  const attachment_bracket_bolt_13 = {"parentId": "bracket-collar-lug", "localStart": [-0.045, 0.0, 0.0], "localEnd": [0.045, 0.0, 0.0], "contactType": "fastener-seat", "overlap": 0.02, "gapTolerance": 0.004, "geometryFromEndpoint": false, "evidenceRefs": ["bracket-zone"], "notes": "The bolt sinks 0.020 into the lug face."};
  const endpoint_bracket_bolt_13 = makeAttachmentEndpoint(attachment_bracket_bolt_13);
  const node_bracket_bolt_13 = new THREE.Group();
  node_bracket_bolt_13.name = "Clamp bolt head__pivot";
  if (endpoint_bracket_bolt_13) {
    node_bracket_bolt_13.position.copy(endpoint_bracket_bolt_13.start);
    node_bracket_bolt_13.rotation.set(0, 0, 0);
    node_bracket_bolt_13.scale.set(1, 1, 1);
  } else {
    node_bracket_bolt_13.position.set(0.1018, 0.0, 0.0575);
    node_bracket_bolt_13.rotation.set(-0.0, 0.0, 1.570796);
    node_bracket_bolt_13.scale.set(0.084, 0.09, 0.084);
  }
  node_bracket_bolt_13.userData.sculptComponent = {"id": "bracket-bolt", "name": "Clamp bolt head", "level": "micro", "role": "fastener", "importance": 0.4, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The bolt head standing proud of the lug. A cylinder is the correct family for a turned fastener head.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 50, 74, 1.0)", "secondaryAlbedo": "rgba(32, 45, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "bolt head on the lug face", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated primitive UVs", "normalStrategy": "vertex normals from generated geometry"}, "parent": "bracket-collar-lug", "attachment": {"parentId": "bracket-collar-lug", "localStart": [-0.045, 0.0, 0.0], "localEnd": [0.045, 0.0, 0.0], "contactType": "fastener-seat", "overlap": 0.02, "gapTolerance": 0.004, "geometryFromEndpoint": false, "evidenceRefs": ["bracket-zone"], "notes": "The bolt sinks 0.020 into the lug face."}, "dimensions": {"width": 0.09, "height": 0.084, "depth": 0.084, "units": "world", "confidence": 0.5}, "transform": {"position": [0.1018, 0.0, 0.0575], "rotation": [-0.0, 0.0, 1.570796], "scale": [0.084, 0.09, 0.084]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Cylinder proxy on the bolt head."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "bracket-navy", "materialLayers": ["bracket-navy"], "deformations": [], "joints": [], "seams": [{"id": "bolt-to-lug", "withComponent": "bracket-collar-lug", "overlapWorldUnits": 0.02, "notes": "The bolt sinks 0.020 into the lug face."}], "localFeatures": [{"id": "bolt-crown-chamfer", "description": "The bolt crown is chamfered, which is what puts a small bright ring on it in the reference.", "geometry": "Cylinder with a 0.008 chamfer.", "evidenceRefs": ["bracket-zone"], "confidence": 0.5}], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.5, "bumpAmplitude": 0.006, "normalPattern": "concentric turning drift", "displacementPattern": "none", "occlusionPattern": "darken the lug contact", "edgeWearPattern": "polish the crown", "notes": "Matte navy plastic with a slightly smoother crown."}, "evidenceRefs": ["bracket-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_bracket_bolt_13.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Cylinder proxy on the bolt head."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}};
  (nodes["bracket-collar-lug"] ?? root).add(node_bracket_bolt_13);
  nodes["bracket-bolt"] = node_bracket_bolt_13;
  const mesh_bracket_bolt_13Geometry = endpoint_bracket_bolt_13
    ? new THREE.CylinderGeometry(endpoint_bracket_bolt_13.endRadius, endpoint_bracket_bolt_13.baseRadius, endpoint_bracket_bolt_13.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 20, 3);
  const mesh_bracket_bolt_13 = new THREE.Mesh(
    mesh_bracket_bolt_13Geometry,
    materialMap["bracket-navy"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bracket_bolt_13.name = "Clamp bolt head";
  if (endpoint_bracket_bolt_13) {
    mesh_bracket_bolt_13.position.copy(endpoint_bracket_bolt_13.midpoint);
    mesh_bracket_bolt_13.quaternion.copy(endpoint_bracket_bolt_13.quaternion);
  }
  mesh_bracket_bolt_13.castShadow = options.castShadow ?? true;
  mesh_bracket_bolt_13.receiveShadow = options.receiveShadow ?? true;
  mesh_bracket_bolt_13.userData.sculptComponent = {"id": "bracket-bolt", "name": "Clamp bolt head", "level": "micro", "role": "fastener", "importance": 0.4, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The bolt head standing proud of the lug. A cylinder is the correct family for a turned fastener head.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(36, 50, 74, 1.0)", "secondaryAlbedo": "rgba(32, 45, 66, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "bolt head on the lug face", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.008, "segments": 2}, "deformationStack": [], "uvStrategy": "generated primitive UVs", "normalStrategy": "vertex normals from generated geometry"}, "parent": "bracket-collar-lug", "attachment": {"parentId": "bracket-collar-lug", "localStart": [-0.045, 0.0, 0.0], "localEnd": [0.045, 0.0, 0.0], "contactType": "fastener-seat", "overlap": 0.02, "gapTolerance": 0.004, "geometryFromEndpoint": false, "evidenceRefs": ["bracket-zone"], "notes": "The bolt sinks 0.020 into the lug face."}, "dimensions": {"width": 0.09, "height": 0.084, "depth": 0.084, "units": "world", "confidence": 0.5}, "transform": {"position": [0.1018, 0.0, 0.0575], "rotation": [-0.0, 0.0, 1.570796], "scale": [0.084, 0.09, 0.084]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [1.0, 0.0, 0.0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Cylinder proxy on the bolt head."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bracket", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "bracket-navy", "materialLayers": ["bracket-navy"], "deformations": [], "joints": [], "seams": [{"id": "bolt-to-lug", "withComponent": "bracket-collar-lug", "overlapWorldUnits": 0.02, "notes": "The bolt sinks 0.020 into the lug face."}], "localFeatures": [{"id": "bolt-crown-chamfer", "description": "The bolt crown is chamfered, which is what puts a small bright ring on it in the reference.", "geometry": "Cylinder with a 0.008 chamfer.", "evidenceRefs": ["bracket-zone"], "confidence": 0.5}], "surfaceDetail": {"macroRoughness": 0.6, "microRoughness": 0.5, "bumpAmplitude": 0.006, "normalPattern": "concentric turning drift", "displacementPattern": "none", "occlusionPattern": "darken the lug contact", "edgeWearPattern": "polish the crown", "notes": "Matte navy plastic with a slightly smoother crown."}, "evidenceRefs": ["bracket-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_bracket_bolt_13.add(mesh_bracket_bolt_13);
  meshes["bracket-bolt"] = mesh_bracket_bolt_13;
  colliders["bracket-bolt"] = {"type": "cylinder", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Cylinder proxy on the bolt head."};
  destructionGroups["bracket"] ??= [];
  destructionGroups["bracket"].push(node_bracket_bolt_13);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 256, "preferredTextureResolution": 1024, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "ranAnyway": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars."}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness, height, normal or AO", "single-frequency random noise", "glossy toy-plastic highlights on a matte moulded surface", "local colour described only in prose without material masks", "claiming exact PBR recovery from one image"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare the albedo palette and the local colour zones.", "Compare roughness and normal response under the key light.", "Compare contact darkening, seam occlusion and crown polish.", "Compare key, fill and rim structure, exposure, tone mapping and background.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals and uniform roughness.", "Capture a reference-matched render from the solved camera."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createApartmentClawHammerOnWallBracketLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Apartment Claw Hammer On Wall Bracket look-dev lights";
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
  lights.userData.lightingFromPhoto = ["Ambient dominance: the reference is a soft studio render. Coral measures 244,103,89 lit against 236,95,82 shaded, a 6.5 percent luma spread across a full curve, which needs a bright neutral hemisphere rather than a hard key.", "Key light: a gentle warm directional source from high and camera left at about 1.15. The head's top faces and the swell crown are the brightest zones, which fixes the direction.", "Rim and environment light: weak neutral back light at about 0.3. No environment map: nothing on the prop reflects anything.", "Exposure and tone mapping: ACES filmic tone mapping with sRGB output at exposure 1.0. The reference holds a narrow range with no blown highlights, the brightest cream reading 237 at the 95th percentile.", "Contact shadow: seam and cavity occlusion only, at the eye collar, the collar band, the fork slot and both screw bores. The reference prop floats with no ground contact, so the review render has no ground plane and the silhouette mask stays clean."];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 256, "preferredTextureResolution": 1024, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "ranAnyway": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars."}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness, height, normal or AO", "single-frequency random noise", "glossy toy-plastic highlights on a matte moulded surface", "local colour described only in prose without material masks", "claiming exact PBR recovery from one image"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare the albedo palette and the local colour zones.", "Compare roughness and normal response under the key light.", "Compare contact darkening, seam occlusion and crown polish.", "Compare key, fill and rim structure, exposure, tone mapping and background.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals and uniform roughness.", "Capture a reference-matched render from the solved camera."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createApartmentClawHammerOnWallBracketEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
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
export function frameApartmentClawHammerOnWallBracketCamera(
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
export function createApartmentClawHammerOnWallBracketPresentationComposer(
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

export function configureApartmentClawHammerOnWallBracketRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createApartmentClawHammerOnWallBracketInspectControls(
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
