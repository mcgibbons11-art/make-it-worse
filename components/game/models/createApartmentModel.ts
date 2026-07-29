import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { addApartmentFurnishing, type ApartmentVariant } from '../environment/apartmentFurnishing';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
  /** Which furniture set the room carries. See apartmentFurnishing.ts. */
  variant?: ApartmentVariant;
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

// The nested shapes keep their own index signature so a spec literal carrying extra
// keys is not rejected as an excess property.
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

export type ExtrudeProfile = {
  points: [number, number][];
  depth: number;
  holes?: [number, number][][];
  ovalHoles?: { cx: number; cy: number; rx: number; ry: number }[];
  // Extrusion axis. ExtrudeGeometry always works in XY and pushes along +Z, so a
  // wall that runs along X has its profile authored in the plane it faces and is
  // rotated onto the axis here.
  axis?: 'x' | 'y' | 'z';
  // Put the solid's centre on the node origin. Every dimension in this spec is
  // measured about a part's centre, and the node transform places that centre.
  center?: boolean;
  // A real fillet on all twelve edges. The spec insets the profile by `size` and
  // shortens `depth` by twice it, so the finished solid is exactly the measured
  // width by height by depth.
  bevel?: { size: number; thickness: number; segments: number };
};

export function buildExtrudeGeometry(profile: ExtrudeProfile): THREE.ExtrudeGeometry {
  const holes = [...(profile.holes ?? []), ...((profile.ovalHoles ?? []).map((o) => ovalLoop(o.cx, o.cy, o.rx, o.ry)))];
  const shape = buildExtrudeShape(profile.points, holes);
  const bevel = profile.bevel;
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: profile.depth,
    bevelEnabled: !!bevel && bevel.size > 0,
    bevelSize: bevel?.size ?? 0,
    bevelThickness: bevel?.thickness ?? 0,
    bevelOffset: 0,
    bevelSegments: bevel?.segments ?? 1,
    curveSegments: 4,
    steps: 1,
  });
  if (profile.center !== false) {
    // Centre on the extrusion axis first: ExtrudeGeometry runs 0..depth in Z and
    // the bevel adds `thickness` at each end, so the solid's midpoint is at
    // depth/2 regardless of the bevel.
    geometry.translate(0, 0, -profile.depth / 2);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (box) {
      geometry.translate(-(box.min.x + box.max.x) / 2, -(box.min.y + box.max.y) / 2, 0);
    }
  }
  if (profile.axis === 'x') geometry.rotateY(Math.PI / 2);
  else if (profile.axis === 'y') geometry.rotateX(-Math.PI / 2);
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

// Generated from ObjectSculptSpec target: MAKE IT WORSE Apartment Room
//
// PROVENANCE. This factory is three things stacked, and the room a player sees is
// all three. The header used to say "Sculpt build pass: blockout" on a file that
// shipped a furnished room, which is how three separate agents came to believe
// the room was six grey boxes. What is actually true, band by band:
//
//   1. GENERATED, and only this. Everything from this function down to the
//      furnishing call is stage3_build/generate_threejs_factory.py at
//      --pass-id blockout: the eight measured materials and six macro masses
//      (wall-a, wall-b, floor-slab, base-trim, sofa-plinth, table-shell). Six
//      meshes. That is the whole of what the pipeline emits.
//
//   2. SCRIPTED. assets/reference/apartment/apply_refinements.py rewrites four
//      things the generator cannot express and one it gets wrong for this
//      project: fillets and the axis/center fields on buildExtrudeGeometry, the
//      noUncheckedIndexedAccess guards, the SculptMaterialSpec type, box segment
//      counts, and explicit instance placement. It also injects the call in band
//      3 and rewrites this header. Deterministic, and it fails loudly on a
//      missing anchor.
//
//   3. HAND-AUTHORED. components/game/environment/apartmentFurnishing.ts. The
//      twenty spec components the blockout pass does not reach, plus the room
//      variants and the architectural detail that no part of the reference
//      shows. That module labels its own two bands.
//
// The generator will not go past blockout: --pass-id form-refinement is refused
// because the spec's reviewHistory carries no completed structural-pass review
// with screenshot evidence, and --force does not lift that. Advancing it means
// running the render/diagnose/append_review loop twice, and it would still not
// account for band 3, which is beyond anything the spec authors. So the ledger
// below is the honest description rather than a promise to regenerate.
//
// Re-running assets/reference/apartment/build.sh reproduces all three bands.
export function createMAKEITWORSEApartmentRoomModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "MAKE IT WORSE Apartment Room";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": true, "solveMethod": "two-point perspective solve. Four silhouette edges were fitted by least squares (the two wall crests and the two near floor edges, max residual 2.2 px), intersected into two vanishing points, and the focal length taken as sqrt of the negative dot product of the two vanishing rays about the principal point.", "fovDegrees": 13.01, "aspect": 1.3333333333333333, "orientation": {"yaw": 45.0, "pitch": -22.44, "roll": 0.0}, "targetHint": [0.0, 0.95, 0.0], "focalPixels": 4762.7, "note": "A 13 degree vertical field is a long lens, which is why the reference reads as isometric even though it is a true perspective render: the wall crests slope at 0.278 while the floor edges slope at 0.482, and an orthographic camera would give both the same slope. Azimuth is 45 degrees within 1.3 degrees, so the room corner is square and viewed on its diagonal."}, "approximationNotes": []};

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["wall-cream"] = createSculptMaterial(
    "wall-cream",
    {"id": "wall-cream", "name": "Wall plaster, matte cream", "type": "physical", "shaderModel": "MeshStandardMaterial (matte interior plaster)", "baseColor": "#f3e3ce", "color": "#f3e3ce", "albedo": {"dominant": "#f3e3ce", "secondary": ["#f3e3ce", "#e7d8c4"], "samplingNotes": "Run-length colour scans across the reference at rows y=130/300/480/620/700/790/850/900/980 and columns x=250/700/900/1150, then cross-checked against the extract_pbr_evidence palette for the same crop. Where a surface appears both lit and shaded the lit face is the authored albedo and the shaded value is carried as a secondary so the review can check that the render reproduces the falloff instead of painting it in.", "map": null}, "colorVariation": {"palette": ["#ffeed8", "#f3e3ce", "#e7d8c4"], "pattern": "flat-fill-with-per-instance-tone", "amplitude": 0.035, "heightCorrelation": 0.0}, "textureResolution": 256, "textureProjection": {"mode": "triplanar", "repeat": [1.0, 1.0], "anisotropy": 4, "texelDensityIntent": "one texel per 3 mm of model surface at review distance"}, "surfaceFrequencyBands": [{"id": "wall-cream-macro", "frequency": 1.6, "amplitude": 0.045, "role": "broad tone drift so a four-unit wall face is not uniformly lit"}, {"id": "wall-cream-meso", "frequency": 9.0, "amplitude": 0.0275, "role": "panel-scale roughness variation, the band the review actually reads"}, {"id": "wall-cream-micro", "frequency": 48.0, "amplitude": 0.015, "role": "tooth; keeps the diffuse from reading as vinyl under a grazing key"}], "roughness": {"base": 0.94, "variation": 0.05, "map": "procedural-noise", "localResponse": "cavity and contact zones darken and roughen; crests stay smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "fine-plaster-tooth", "strength": 0.35, "scale": 2.4, "space": "tangent"}, "bump": {"pattern": "fine-plaster-tooth", "amplitude": 0.006, "scale": 2.4}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.55, "contactShadowBias": 0.012, "notes": "Cavity term drives the corner crease, the cubby interior and the gap under every peg leg."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [{"id": "crest-highlight", "description": "The round-over along the wall crest reads #fcefdd against the #f3e3ce flat face, a 4 percent lift that comes from curvature meeting the key, so it is left to the geometry and the material only drops roughness slightly on the roll.", "mask": "curvature > 0.6 on the top and end fillets", "response": "roughness 0.94 -> 0.88", "evidenceRefs": ["wall-back"]}, {"id": "corner-crease", "description": "The inside corner is the darkest cream in the reference (#c6bca3, 19 percent below the lit face). It is contact occlusion between two planes, not a painted line.", "mask": "within 0.12 units of the wall A / wall B intersection", "response": "ambient occlusion 0.55 -> 0.85", "evidenceRefs": ["wall-back", "skirting"]}, {"id": "skirting-contact-shadow", "description": "A narrow band of the plaster just above the skirting sits about 8 percent darker than the wall mid-height, from the rail's own occlusion.", "mask": "0 to 0.10 units above the skirting crest", "response": "ambient occlusion 0.55 -> 0.72", "evidenceRefs": ["skirting"]}], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\crops\\wall-cream-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with a de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.86, "estimatedFidelity": 0.86, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction cleared its 0.7 confidence gate on all eight materials, but the maps are NOT bound to the runtime material. Every surface in this reference is flat paint with no pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's own key light onto every wall of every repeated module. The runtime uses solid albedo plus procedural roughness/normal variation, which is the rule of thumb the skill states for flat paint. The extracted palettes and the de-lit reference are evidence for the albedo and roughness scalars, nothing more. Two crops had to be recut before they passed: the first sage crop straddled the arm's round-over (confidence 0.678) and the first gold and navy crops caught neighbouring coral and plank pixels, which showed up as a contaminated dominant palette entry rather than as a low score.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\wall-cream_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\wall-cream_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\wall-cream_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\wall-cream_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\wall-cream_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "Two wall slabs, one material. The reference shows the same paint at #f3e3ce on the key-facing left wall and #d8c8b1 on the back wall, an 11 percent difference that is lighting, not albedo. Authoring both at the lit value and letting the rig produce the falloff is a falsifiable claim, and the material-pass review checks it."},
    options
  );
  materialMap["trim-navy"] = createSculptMaterial(
    "trim-navy",
    {"id": "trim-navy", "name": "Skirting and floor rim, matte navy", "type": "physical", "shaderModel": "MeshStandardMaterial (matte painted trim)", "baseColor": "#394254", "color": "#394254", "albedo": {"dominant": "#394254", "secondary": ["#394254", "#343c4c"], "samplingNotes": "Run-length colour scans across the reference at rows y=130/300/480/620/700/790/850/900/980 and columns x=250/700/900/1150, then cross-checked against the extract_pbr_evidence palette for the same crop. Where a surface appears both lit and shaded the lit face is the authored albedo and the shaded value is carried as a secondary so the review can check that the render reproduces the falloff instead of painting it in.", "map": null}, "colorVariation": {"palette": ["#3e485c", "#394254", "#343c4c"], "pattern": "flat-fill-with-per-instance-tone", "amplitude": 0.035, "heightCorrelation": 0.0}, "textureResolution": 256, "textureProjection": {"mode": "triplanar", "repeat": [1.0, 1.0], "anisotropy": 4, "texelDensityIntent": "one texel per 3 mm of model surface at review distance"}, "surfaceFrequencyBands": [{"id": "trim-navy-macro", "frequency": 1.6, "amplitude": 0.054, "role": "broad tone drift so a four-unit wall face is not uniformly lit"}, {"id": "trim-navy-meso", "frequency": 9.0, "amplitude": 0.033, "role": "panel-scale roughness variation, the band the review actually reads"}, {"id": "trim-navy-micro", "frequency": 48.0, "amplitude": 0.018, "role": "tooth; keeps the diffuse from reading as vinyl under a grazing key"}], "roughness": {"base": 0.9, "variation": 0.06, "map": "procedural-noise", "localResponse": "cavity and contact zones darken and roughen; crests stay smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "fine-plaster-tooth", "strength": 0.35, "scale": 2.4, "space": "tangent"}, "bump": {"pattern": "fine-plaster-tooth", "amplitude": 0.006, "scale": 2.4}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.6, "contactShadowBias": 0.012, "notes": "Cavity term drives the corner crease, the cubby interior and the gap under every peg leg."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [{"id": "rim-crest-roll", "description": "The rim's top round-over lifts to #3d475a where it faces the key and drops to #2c3343 on the shadow side, the widest relative value swing of any material in the reference.", "mask": "curvature > 0.5 on the rim crest", "response": "roughness 0.90 -> 0.84", "evidenceRefs": ["base-trim"]}, {"id": "inside-corner-black", "description": "Where the two skirting rails meet, the crease reads #11141a, far below either rail's own value; that is occlusion between two dark surfaces and must not be baked into the albedo.", "mask": "within 0.08 units of the skirting corner", "response": "ambient occlusion 0.60 -> 0.95", "evidenceRefs": ["skirting"]}], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\crops\\trim-navy-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with a de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.793, "estimatedFidelity": 0.793, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction cleared its 0.7 confidence gate on all eight materials, but the maps are NOT bound to the runtime material. Every surface in this reference is flat paint with no pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's own key light onto every wall of every repeated module. The runtime uses solid albedo plus procedural roughness/normal variation, which is the rule of thumb the skill states for flat paint. The extracted palettes and the de-lit reference are evidence for the albedo and roughness scalars, nothing more. Two crops had to be recut before they passed: the first sage crop straddled the arm's round-over (confidence 0.678) and the first gold and navy crops caught neighbouring coral and plank pixels, which showed up as a contaminated dominant palette entry rather than as a low score.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\trim-navy_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\trim-navy_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\trim-navy_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\trim-navy_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\trim-navy_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "The single darkest element in the room and the one that gives every edge its read. In the game this material is what keeps a silhouette legible against the sky."},
    options
  );
  materialMap["floor-tan"] = createSculptMaterial(
    "floor-tan",
    {"id": "floor-tan", "name": "Board floor, matte warm tan", "type": "physical", "shaderModel": "MeshStandardMaterial (matte finished board)", "baseColor": "#e7b174", "color": "#e7b174", "albedo": {"dominant": "#e7b174", "secondary": ["#e7b174", "#d9a66d"], "samplingNotes": "Run-length colour scans across the reference at rows y=130/300/480/620/700/790/850/900/980 and columns x=250/700/900/1150, then cross-checked against the extract_pbr_evidence palette for the same crop. Where a surface appears both lit and shaded the lit face is the authored albedo and the shaded value is carried as a secondary so the review can check that the render reproduces the falloff instead of painting it in.", "map": null}, "colorVariation": {"palette": ["#f5bc7b", "#e7b174", "#d9a66d"], "pattern": "flat-fill-with-per-instance-tone", "amplitude": 0.035, "heightCorrelation": 0.0}, "textureResolution": 256, "textureProjection": {"mode": "triplanar", "repeat": [1.0, 1.0], "anisotropy": 4, "texelDensityIntent": "one texel per 3 mm of model surface at review distance"}, "surfaceFrequencyBands": [{"id": "floor-tan-macro", "frequency": 1.6, "amplitude": 0.081, "role": "broad tone drift so a four-unit wall face is not uniformly lit"}, {"id": "floor-tan-meso", "frequency": 9.0, "amplitude": 0.0495, "role": "panel-scale roughness variation, the band the review actually reads"}, {"id": "floor-tan-micro", "frequency": 48.0, "amplitude": 0.027, "role": "tooth; keeps the diffuse from reading as vinyl under a grazing key"}], "roughness": {"base": 0.88, "variation": 0.09, "map": "procedural-noise", "localResponse": "cavity and contact zones darken and roughen; crests stay smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "fine-plaster-tooth", "strength": 0.35, "scale": 2.4, "space": "tangent"}, "bump": {"pattern": "fine-plaster-tooth", "amplitude": 0.006, "scale": 2.4}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.5, "contactShadowBias": 0.012, "notes": "Cavity term drives the corner crease, the cubby interior and the gap under every peg leg."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [{"id": "per-board-tone", "description": "Adjacent boards differ by roughly one stop with no hue shift: #e7b174, #dca468 and #d39c62 all measured on lit board faces in the same scan row.", "mask": "per plank instance", "response": "albedo multiplied by a seeded 0.92 to 1.0 per-instance factor", "evidenceRefs": ["floor-planks"]}, {"id": "seam-shadow", "description": "Recessed seams read #583817 where shadowed, five stops under the board face. The groove is geometry; the material only deepens the cavity term.", "mask": "inside the seam grooves", "response": "ambient occlusion 0.50 -> 0.92", "evidenceRefs": ["floor-planks"]}], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\crops\\floor-tan-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with a de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.779, "estimatedFidelity": 0.779, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction cleared its 0.7 confidence gate on all eight materials, but the maps are NOT bound to the runtime material. Every surface in this reference is flat paint with no pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's own key light onto every wall of every repeated module. The runtime uses solid albedo plus procedural roughness/normal variation, which is the rule of thumb the skill states for flat paint. The extracted palettes and the de-lit reference are evidence for the albedo and roughness scalars, nothing more. Two crops had to be recut before they passed: the first sage crop straddled the arm's round-over (confidence 0.678) and the first gold and navy crops caught neighbouring coral and plank pixels, which showed up as a contaminated dominant palette entry rather than as a low score.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\floor-tan_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\floor-tan_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\floor-tan_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\floor-tan_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\floor-tan_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "Boards, not a tiled texture. The seams and butt joints are instanced geometry so they survive relighting and read correctly at a grazing angle."},
    options
  );
  materialMap["sage-green"] = createSculptMaterial(
    "sage-green",
    {"id": "sage-green", "name": "Upholstery and window joinery, matte sage", "type": "physical", "shaderModel": "MeshStandardMaterial (matte upholstery / painted joinery)", "baseColor": "#97b79a", "color": "#97b79a", "albedo": {"dominant": "#97b79a", "secondary": ["#9fc1a4", "#97b79c"], "samplingNotes": "Run-length colour scans across the reference at rows y=130/300/480/620/700/790/850/900/980 and columns x=250/700/900/1150, then cross-checked against the extract_pbr_evidence palette for the same crop. Where a surface appears both lit and shaded the lit face is the authored albedo and the shaded value is carried as a secondary so the review can check that the render reproduces the falloff instead of painting it in.", "map": null}, "colorVariation": {"palette": ["#a7cbac", "#9fc1a4", "#97b79c"], "pattern": "flat-fill-with-per-instance-tone", "amplitude": 0.035, "heightCorrelation": 0.0}, "textureResolution": 256, "textureProjection": {"mode": "triplanar", "repeat": [1.0, 1.0], "anisotropy": 4, "texelDensityIntent": "one texel per 3 mm of model surface at review distance"}, "surfaceFrequencyBands": [{"id": "sage-green-macro", "frequency": 1.6, "amplitude": 0.063, "role": "broad tone drift so a four-unit wall face is not uniformly lit"}, {"id": "sage-green-meso", "frequency": 9.0, "amplitude": 0.0385, "role": "panel-scale roughness variation, the band the review actually reads"}, {"id": "sage-green-micro", "frequency": 48.0, "amplitude": 0.021, "role": "tooth; keeps the diffuse from reading as vinyl under a grazing key"}], "roughness": {"base": 0.92, "variation": 0.07, "map": "procedural-noise", "localResponse": "cavity and contact zones darken and roughen; crests stay smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "fine-plaster-tooth", "strength": 0.35, "scale": 2.4, "space": "tangent"}, "bump": {"pattern": "fine-plaster-tooth", "amplitude": 0.006, "scale": 2.4}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.62, "contactShadowBias": 0.012, "notes": "Cavity term drives the corner crease, the cubby interior and the gap under every peg leg."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [{"id": "cushion-crease", "description": "Every cushion gap darkens to about #77987a, 20 percent under the lit #9fc1a4 face, and the gap is real air, so the darkening is contact occlusion between two solids.", "mask": "within 0.05 units of a cushion seam", "response": "ambient occlusion 0.62 -> 0.88", "evidenceRefs": ["sofa"]}, {"id": "window-reveal-shade", "description": "The window's inner reveal sits at #67927c against the #97ba9d frame face, which is the setback catching no key at all.", "mask": "the reveal box behind the frame band", "response": "ambient occlusion 0.62 -> 0.90", "evidenceRefs": ["window"]}], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\crops\\sage-green-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with a de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.703, "estimatedFidelity": 0.703, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction cleared its 0.7 confidence gate on all eight materials, but the maps are NOT bound to the runtime material. Every surface in this reference is flat paint with no pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's own key light onto every wall of every repeated module. The runtime uses solid albedo plus procedural roughness/normal variation, which is the rule of thumb the skill states for flat paint. The extracted palettes and the de-lit reference are evidence for the albedo and roughness scalars, nothing more. Two crops had to be recut before they passed: the first sage crop straddled the arm's round-over (confidence 0.678) and the first gold and navy crops caught neighbouring coral and plank pixels, which showed up as a contaminated dominant palette entry rather than as a low score.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\sage-green_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\sage-green_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\sage-green_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\sage-green_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\sage-green_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "The sofa upholstery and the window frame measure the same green within 2 of 255 (#97b79a and #95b69a), so the reference uses one paint on both and this spec does too. Splitting them would invent a distinction the image does not contain."},
    options
  );
  materialMap["rug-coral"] = createSculptMaterial(
    "rug-coral",
    {"id": "rug-coral", "name": "Rug field, matte coral textile", "type": "physical", "shaderModel": "MeshStandardMaterial (matte flat-weave textile)", "baseColor": "#f57a68", "color": "#f57a68", "albedo": {"dominant": "#f57a68", "secondary": ["#f57a68", "#eb7564"], "samplingNotes": "Run-length colour scans across the reference at rows y=130/300/480/620/700/790/850/900/980 and columns x=250/700/900/1150, then cross-checked against the extract_pbr_evidence palette for the same crop. Where a surface appears both lit and shaded the lit face is the authored albedo and the shaded value is carried as a secondary so the review can check that the render reproduces the falloff instead of painting it in.", "map": null}, "colorVariation": {"palette": ["#ff7f6c", "#f57a68", "#eb7564"], "pattern": "flat-fill-with-per-instance-tone", "amplitude": 0.035, "heightCorrelation": 0.0}, "textureResolution": 256, "textureProjection": {"mode": "triplanar", "repeat": [1.0, 1.0], "anisotropy": 4, "texelDensityIntent": "one texel per 3 mm of model surface at review distance"}, "surfaceFrequencyBands": [{"id": "rug-coral-macro", "frequency": 1.6, "amplitude": 0.036, "role": "broad tone drift so a four-unit wall face is not uniformly lit"}, {"id": "rug-coral-meso", "frequency": 9.0, "amplitude": 0.022, "role": "panel-scale roughness variation, the band the review actually reads"}, {"id": "rug-coral-micro", "frequency": 48.0, "amplitude": 0.012, "role": "tooth; keeps the diffuse from reading as vinyl under a grazing key"}], "roughness": {"base": 0.96, "variation": 0.04, "map": "procedural-noise", "localResponse": "cavity and contact zones darken and roughen; crests stay smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "fine-plaster-tooth", "strength": 0.35, "scale": 2.4, "space": "tangent"}, "bump": {"pattern": "fine-plaster-tooth", "amplitude": 0.006, "scale": 2.4}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.45, "contactShadowBias": 0.012, "notes": "Cavity term drives the corner crease, the cubby interior and the gap under every peg leg."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [{"id": "border-contact", "description": "The field sits a hair below the gold border, so a thin occlusion line runs the whole inner edge of the border.", "mask": "within 0.04 units of the border's inner edge", "response": "ambient occlusion 0.45 -> 0.75", "evidenceRefs": ["rug"]}], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\crops\\rug-coral-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with a de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.709, "estimatedFidelity": 0.709, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction cleared its 0.7 confidence gate on all eight materials, but the maps are NOT bound to the runtime material. Every surface in this reference is flat paint with no pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's own key light onto every wall of every repeated module. The runtime uses solid albedo plus procedural roughness/normal variation, which is the rule of thumb the skill states for flat paint. The extracted palettes and the de-lit reference are evidence for the albedo and roughness scalars, nothing more. Two crops had to be recut before they passed: the first sage crop straddled the arm's round-over (confidence 0.678) and the first gold and navy crops caught neighbouring coral and plank pixels, which showed up as a contaminated dominant palette entry rather than as a low score.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\rug-coral_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\rug-coral_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\rug-coral_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\rug-coral_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\rug-coral_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "The flattest material in the reference: the coral field shows under 4 percent value variation across its whole area, so any roughness pattern here must stay subtle."},
    options
  );
  materialMap["rug-gold"] = createSculptMaterial(
    "rug-gold",
    {"id": "rug-gold", "name": "Rug border, matte gold textile", "type": "physical", "shaderModel": "MeshStandardMaterial (matte flat-weave textile)", "baseColor": "#fac764", "color": "#fac764", "albedo": {"dominant": "#fac764", "secondary": ["#fac764", "#f0bf60"], "samplingNotes": "Run-length colour scans across the reference at rows y=130/300/480/620/700/790/850/900/980 and columns x=250/700/900/1150, then cross-checked against the extract_pbr_evidence palette for the same crop. Where a surface appears both lit and shaded the lit face is the authored albedo and the shaded value is carried as a secondary so the review can check that the render reproduces the falloff instead of painting it in.", "map": null}, "colorVariation": {"palette": ["#ffcf68", "#fac764", "#f0bf60"], "pattern": "flat-fill-with-per-instance-tone", "amplitude": 0.035, "heightCorrelation": 0.0}, "textureResolution": 256, "textureProjection": {"mode": "triplanar", "repeat": [1.0, 1.0], "anisotropy": 4, "texelDensityIntent": "one texel per 3 mm of model surface at review distance"}, "surfaceFrequencyBands": [{"id": "rug-gold-macro", "frequency": 1.6, "amplitude": 0.045, "role": "broad tone drift so a four-unit wall face is not uniformly lit"}, {"id": "rug-gold-meso", "frequency": 9.0, "amplitude": 0.0275, "role": "panel-scale roughness variation, the band the review actually reads"}, {"id": "rug-gold-micro", "frequency": 48.0, "amplitude": 0.015, "role": "tooth; keeps the diffuse from reading as vinyl under a grazing key"}], "roughness": {"base": 0.95, "variation": 0.05, "map": "procedural-noise", "localResponse": "cavity and contact zones darken and roughen; crests stay smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "fine-plaster-tooth", "strength": 0.35, "scale": 2.4, "space": "tangent"}, "bump": {"pattern": "fine-plaster-tooth", "amplitude": 0.006, "scale": 2.4}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.45, "contactShadowBias": 0.012, "notes": "Cavity term drives the corner crease, the cubby interior and the gap under every peg leg."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [{"id": "border-crest", "description": "The border's outer round-over catches the key and lifts to #ffda6e at the crest, which is the only place the rug shows a highlight at all.", "mask": "curvature > 0.5 on the border's outer edge", "response": "roughness 0.95 -> 0.90", "evidenceRefs": ["rug"]}], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\crops\\rug-gold-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with a de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.775, "estimatedFidelity": 0.775, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction cleared its 0.7 confidence gate on all eight materials, but the maps are NOT bound to the runtime material. Every surface in this reference is flat paint with no pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's own key light onto every wall of every repeated module. The runtime uses solid albedo plus procedural roughness/normal variation, which is the rule of thumb the skill states for flat paint. The extracted palettes and the de-lit reference are evidence for the albedo and roughness scalars, nothing more. Two crops had to be recut before they passed: the first sage crop straddled the arm's round-over (confidence 0.678) and the first gold and navy crops caught neighbouring coral and plank pixels, which showed up as a contaminated dominant palette entry rather than as a low score.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\rug-gold_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\rug-gold_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\rug-gold_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\rug-gold_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\rug-gold_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "A band 0.16 units wide around the coral field. Its width is what makes the rug read as two concentric rounded rectangles rather than as a coral plate with a painted edge."},
    options
  );
  materialMap["furniture-cream"] = createSculptMaterial(
    "furniture-cream",
    {"id": "furniture-cream", "name": "Case goods and peg legs, matte warm cream", "type": "physical", "shaderModel": "MeshStandardMaterial (matte moulded case goods)", "baseColor": "#f3e5d2", "color": "#f3e5d2", "albedo": {"dominant": "#f3e5d2", "secondary": ["#f3e5d2", "#e7dac8"], "samplingNotes": "Run-length colour scans across the reference at rows y=130/300/480/620/700/790/850/900/980 and columns x=250/700/900/1150, then cross-checked against the extract_pbr_evidence palette for the same crop. Where a surface appears both lit and shaded the lit face is the authored albedo and the shaded value is carried as a secondary so the review can check that the render reproduces the falloff instead of painting it in.", "map": null}, "colorVariation": {"palette": ["#fff0dc", "#f3e5d2", "#e7dac8"], "pattern": "flat-fill-with-per-instance-tone", "amplitude": 0.035, "heightCorrelation": 0.0}, "textureResolution": 256, "textureProjection": {"mode": "triplanar", "repeat": [1.0, 1.0], "anisotropy": 4, "texelDensityIntent": "one texel per 3 mm of model surface at review distance"}, "surfaceFrequencyBands": [{"id": "furniture-cream-macro", "frequency": 1.6, "amplitude": 0.054, "role": "broad tone drift so a four-unit wall face is not uniformly lit"}, {"id": "furniture-cream-meso", "frequency": 9.0, "amplitude": 0.033, "role": "panel-scale roughness variation, the band the review actually reads"}, {"id": "furniture-cream-micro", "frequency": 48.0, "amplitude": 0.018, "role": "tooth; keeps the diffuse from reading as vinyl under a grazing key"}], "roughness": {"base": 0.9, "variation": 0.06, "map": "procedural-noise", "localResponse": "cavity and contact zones darken and roughen; crests stay smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "fine-plaster-tooth", "strength": 0.35, "scale": 2.4, "space": "tangent"}, "bump": {"pattern": "fine-plaster-tooth", "amplitude": 0.006, "scale": 2.4}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.58, "contactShadowBias": 0.012, "notes": "Cavity term drives the corner crease, the cubby interior and the gap under every peg leg."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [{"id": "cubby-interior", "description": "The table cavity reads #c9b69c against the #f3e5d2 face, 18 percent down with no hue shift, so the interior is the same cream seen only by occlusion.", "mask": "inside the cubby recess", "response": "ambient occlusion 0.58 -> 0.90", "evidenceRefs": ["side-table"]}, {"id": "leg-tone", "description": "Peg legs measure #edd8bf, marginally warmer and darker than the table body, and the same value appears on the sofa legs, which is what ties the two pieces of furniture together.", "mask": "peg leg instances", "response": "albedo #f3e5d2 -> #edd8bf", "evidenceRefs": ["side-table", "sofa"]}], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\crops\\furniture-cream-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with a de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.796, "estimatedFidelity": 0.796, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction cleared its 0.7 confidence gate on all eight materials, but the maps are NOT bound to the runtime material. Every surface in this reference is flat paint with no pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's own key light onto every wall of every repeated module. The runtime uses solid albedo plus procedural roughness/normal variation, which is the rule of thumb the skill states for flat paint. The extracted palettes and the de-lit reference are evidence for the albedo and roughness scalars, nothing more. Two crops had to be recut before they passed: the first sage crop straddled the arm's round-over (confidence 0.678) and the first gold and navy crops caught neighbouring coral and plank pixels, which showed up as a contaminated dominant palette entry rather than as a low score.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\furniture-cream_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\furniture-cream_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\furniture-cream_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\furniture-cream_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\furniture-cream_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "One cream for the side table and for every peg leg in the room, including the sofa's. The legs never take the item's own colour, and that is what makes the furniture read as lifted off the floor rather than growing out of it."},
    options
  );
  materialMap["glass-blue"] = createSculptMaterial(
    "glass-blue",
    {"id": "glass-blue", "name": "Window glazing, flat pale blue", "type": "physical", "shaderModel": "MeshStandardMaterial (opaque stylised glazing)", "baseColor": "#98cfe5", "color": "#98cfe5", "albedo": {"dominant": "#98cfe5", "secondary": ["#98cfe5", "#93c9de"], "samplingNotes": "Run-length colour scans across the reference at rows y=130/300/480/620/700/790/850/900/980 and columns x=250/700/900/1150, then cross-checked against the extract_pbr_evidence palette for the same crop. Where a surface appears both lit and shaded the lit face is the authored albedo and the shaded value is carried as a secondary so the review can check that the render reproduces the falloff instead of painting it in.", "map": null}, "colorVariation": {"palette": ["#9dd5ec", "#98cfe5", "#93c9de"], "pattern": "flat-fill-with-per-instance-tone", "amplitude": 0.035, "heightCorrelation": 0.0}, "textureResolution": 128, "textureProjection": {"mode": "triplanar", "repeat": [1.0, 1.0], "anisotropy": 4, "texelDensityIntent": "one texel per 3 mm of model surface at review distance"}, "surfaceFrequencyBands": [{"id": "glass-blue-macro", "frequency": 1.6, "amplitude": 0.027, "role": "broad tone drift so a four-unit wall face is not uniformly lit"}, {"id": "glass-blue-meso", "frequency": 9.0, "amplitude": 0.0165, "role": "panel-scale roughness variation, the band the review actually reads"}, {"id": "glass-blue-micro", "frequency": 48.0, "amplitude": 0.009, "role": "tooth; keeps the diffuse from reading as vinyl under a grazing key"}], "roughness": {"base": 0.34, "variation": 0.03, "map": "procedural-noise", "localResponse": "cavity and contact zones darken and roughen; crests stay smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.12}, "normal": {"pattern": "none", "strength": 0.35, "scale": 2.4, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 2.4}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.3, "contactShadowBias": 0.012, "notes": "Cavity term drives the corner crease, the cubby interior and the gap under every peg leg."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#000000"}, "localOverrides": [{"id": "pane-uniformity", "description": "All four panes measure #98cfe5 within 3 of 255 and show no reflected room content and no gradient. The glazing is a flat sky fill.", "mask": "the whole glazing plate", "response": "no environment map, no transmission", "evidenceRefs": ["window"]}], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\crops\\glass-blue-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with a de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.704, "estimatedFidelity": 0.704, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction cleared its 0.7 confidence gate on all eight materials, but the maps are NOT bound to the runtime material. Every surface in this reference is flat paint with no pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's own key light onto every wall of every repeated module. The runtime uses solid albedo plus procedural roughness/normal variation, which is the rule of thumb the skill states for flat paint. The extracted palettes and the de-lit reference are evidence for the albedo and roughness scalars, nothing more. Two crops had to be recut before they passed: the first sage crop straddled the arm's round-over (confidence 0.678) and the first gold and navy crops caught neighbouring coral and plank pixels, which showed up as a contaminated dominant palette entry rather than as a low score.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\glass-blue_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\glass-blue_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\glass-blue_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\glass-blue_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\apartment\\evidence\\pbr\\glass-blue_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "Deliberately not a transmissive material. Transmission or an environment map would put reflections on a surface the reference renders as flat colour, which would read as a different object."},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const attachment_wall_a_0 = null;
  const endpoint_wall_a_0 = makeAttachmentEndpoint(attachment_wall_a_0);
  const node_wall_a_0 = new THREE.Group();
  node_wall_a_0.name = "Wall A left with window__pivot";
  if (endpoint_wall_a_0) {
    node_wall_a_0.position.copy(endpoint_wall_a_0.start);
    node_wall_a_0.rotation.set(0, 0, 0);
    node_wall_a_0.scale.set(1, 1, 1);
  } else {
    node_wall_a_0.position.set(-2.08, 1.55, -0.08);
    node_wall_a_0.rotation.set(0.0, 0.0, 0.0);
    node_wall_a_0.scale.set(1.0, 1.0, 1.0);
  }
  node_wall_a_0.userData.sculptComponent = {"id": "wall-a", "name": "Wall A left with window", "level": "macro", "role": "shell-plane", "importance": 0.95, "confidence": 0.85, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "assembled-solid. Two parallel faces joined by a continuous filleted rim. It is a slab, not a plane: the reference shows the wall's own thickness as a lit band along the crest, so a zero-thickness card cannot reproduce it.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(243, 227, 206, 1.0)", "secondaryAlbedo": "rgba(216, 200, 177, 1.0)", "materialClass": "ceramic", "materialClassConfidence": 0.88}, "geometryDescriptor": {"topologyIntent": "filleted slab, all twelve edges rolled", "edgeTreatment": {"type": "fillet", "bevelRadius": 0.22, "segments": 3}, "deformationStack": ["none"], "uvStrategy": "triplanar-world", "normalStrategy": "smooth-with-30-degree-crease", "profile2D": {"points": [[2.001, 1.33], [1.9941, 1.37357], [1.97407, 1.41288], [1.94288, 1.44407], [1.90357, 1.4641], [1.86, 1.471], [-1.86, 1.471], [-1.90357, 1.4641], [-1.94288, 1.44407], [-1.97407, 1.41288], [-1.9941, 1.37357], [-2.001, 1.33], [-2.001, -1.33], [-1.9941, -1.37357], [-1.97407, -1.41288], [-1.94288, -1.44407], [-1.90357, -1.4641], [-1.86, -1.471], [1.86, -1.471], [1.90357, -1.4641], [1.94288, -1.44407], [1.97407, -1.41288], [1.9941, -1.37357], [2.001, -1.33]], "depth": 0.002, "axis": "x", "center": true, "bevel": {"size": 0.079, "thickness": 0.079, "segments": 3}}}, "parent": null, "attachment": null, "dimensions": {"width": 0.16, "height": 3.1, "depth": 4.16, "units": "world", "confidence": 0.6}, "transform": {"position": [-2.08, 1.55, -0.08], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "window-mount", "localPosition": [0.08, 0.22999999999999998, 0.22999999999999998], "localRotation": [0, 0, 0], "notes": "Inside face of wall A, where the window relief mounts."}, {"id": "module-join-near", "localPosition": [0, -1.55, 2.08], "localRotation": [0, 0, 0], "notes": "Flush end used when the module tiles along the course."}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Full slab; the game gives the wall no collider because the play corridor never reaches it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "room-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wall-cream"}}, "material": "wall-cream", "materialLayers": ["wall-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "wall-slab-roundover", "description": "Continuous round-over of radius 0.22 on the crest and both vertical ends, measured against a 3.10 unit wall height. The crest highlight (#fcefdd) is a curvature read, so a hard edge here loses the reference's whole soft-toy look.", "geometry": "ExtrudeGeometry bevel with size and thickness both 0.22 and three segments.", "evidenceRefs": ["wall-left", "wall-back"], "confidence": 0.9}, {"id": "corner-butt-joint", "description": "Wall A runs the full room depth plus one wall thickness so it butts into wall B's inner face, giving one continuous vertical crease instead of a mitre.", "geometry": "Length ROOM + WALL_T, offset back by half a thickness.", "evidenceRefs": ["wall-back"], "confidence": 0.72}], "surfaceDetail": {"macroRoughness": 0.94, "microRoughness": 0.05, "bumpAmplitude": 0.006, "normalPattern": "fine-plaster-tooth", "displacementPattern": "none", "occlusionPattern": "crease-and-contact", "edgeWearPattern": "none", "notes": "Broad matte plane. Any visible highlight has to come from the fillets, not from a specular lobe."}, "evidenceRefs": ["wall-left", "wall-back"], "details": [], "fidelityTier": "form-refinement"};
  node_wall_a_0.userData.actionProfile = (node_wall_a_0.userData.sculptComponent as { actionProfile?: unknown }).actionProfile;
  (nodes["root"] ?? root).add(node_wall_a_0);
  nodes["wall-a"] = node_wall_a_0;
  const mesh_wall_a_0Geometry = endpoint_wall_a_0
    ? new THREE.CylinderGeometry(endpoint_wall_a_0.endRadius, endpoint_wall_a_0.baseRadius, endpoint_wall_a_0.length, 32, 12)
    : buildExtrudeGeometry({"points": [[2.001, 1.33], [1.9941, 1.37357], [1.97407, 1.41288], [1.94288, 1.44407], [1.90357, 1.4641], [1.86, 1.471], [-1.86, 1.471], [-1.90357, 1.4641], [-1.94288, 1.44407], [-1.97407, 1.41288], [-1.9941, 1.37357], [-2.001, 1.33], [-2.001, -1.33], [-1.9941, -1.37357], [-1.97407, -1.41288], [-1.94288, -1.44407], [-1.90357, -1.4641], [-1.86, -1.471], [1.86, -1.471], [1.90357, -1.4641], [1.94288, -1.44407], [1.97407, -1.41288], [1.9941, -1.37357], [2.001, -1.33]], "depth": 0.002, "axis": "x", "center": true, "bevel": {"size": 0.079, "thickness": 0.079, "segments": 3}});
  const mesh_wall_a_0 = new THREE.Mesh(
    mesh_wall_a_0Geometry,
    materialMap["wall-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wall_a_0.name = "Wall A left with window";
  if (endpoint_wall_a_0) {
    mesh_wall_a_0.position.copy(endpoint_wall_a_0.midpoint);
    mesh_wall_a_0.quaternion.copy(endpoint_wall_a_0.quaternion);
  }
  mesh_wall_a_0.castShadow = options.castShadow ?? true;
  mesh_wall_a_0.receiveShadow = options.receiveShadow ?? true;
  mesh_wall_a_0.userData.sculptComponent = node_wall_a_0.userData.sculptComponent;
  node_wall_a_0.add(mesh_wall_a_0);
  meshes["wall-a"] = mesh_wall_a_0;
  colliders["wall-a"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Full slab; the game gives the wall no collider because the play corridor never reaches it."};
  destructionGroups["room-shell"] ??= [];
  destructionGroups["room-shell"].push(node_wall_a_0);
  const socket_wall_a_window_mount_0 = new THREE.Object3D();
  socket_wall_a_window_mount_0.name = "window-mount";
  socket_wall_a_window_mount_0.position.set(0.08, 0.22999999999999998, 0.22999999999999998);
  socket_wall_a_window_mount_0.rotation.set(0.0, 0.0, 0.0);
  socket_wall_a_window_mount_0.userData.socket = {"id": "window-mount", "localPosition": [0.08, 0.22999999999999998, 0.22999999999999998], "localRotation": [0, 0, 0], "notes": "Inside face of wall A, where the window relief mounts."};
  node_wall_a_0.add(socket_wall_a_window_mount_0);
  sockets["wall-a:window-mount"] = socket_wall_a_window_mount_0;
  const socket_wall_a_module_join_near_1 = new THREE.Object3D();
  socket_wall_a_module_join_near_1.name = "module-join-near";
  socket_wall_a_module_join_near_1.position.set(0.0, -1.55, 2.08);
  socket_wall_a_module_join_near_1.rotation.set(0.0, 0.0, 0.0);
  socket_wall_a_module_join_near_1.userData.socket = {"id": "module-join-near", "localPosition": [0, -1.55, 2.08], "localRotation": [0, 0, 0], "notes": "Flush end used when the module tiles along the course."};
  node_wall_a_0.add(socket_wall_a_module_join_near_1);
  sockets["wall-a:module-join-near"] = socket_wall_a_module_join_near_1;

  const attachment_wall_b_1 = null;
  const endpoint_wall_b_1 = makeAttachmentEndpoint(attachment_wall_b_1);
  const node_wall_b_1 = new THREE.Group();
  node_wall_b_1.name = "Wall B back with sofa__pivot";
  if (endpoint_wall_b_1) {
    node_wall_b_1.position.copy(endpoint_wall_b_1.start);
    node_wall_b_1.rotation.set(0, 0, 0);
    node_wall_b_1.scale.set(1, 1, 1);
  } else {
    node_wall_b_1.position.set(-0.08, 1.55, -2.08);
    node_wall_b_1.rotation.set(0.0, 0.0, 0.0);
    node_wall_b_1.scale.set(1.0, 1.0, 1.0);
  }
  node_wall_b_1.userData.sculptComponent = {"id": "wall-b", "name": "Wall B back with sofa", "level": "macro", "role": "shell-plane", "importance": 0.92, "confidence": 0.85, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "assembled-solid. Same slab topology as wall A. Kept as a separate component rather than mirrored in code because the two carry different furnishings and the game tiles them independently.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(216, 200, 177, 1.0)", "secondaryAlbedo": "rgba(243, 227, 206, 1.0)", "materialClass": "ceramic", "materialClassConfidence": 0.88}, "geometryDescriptor": {"topologyIntent": "filleted slab, all twelve edges rolled", "edgeTreatment": {"type": "fillet", "bevelRadius": 0.22, "segments": 3}, "deformationStack": ["none"], "uvStrategy": "triplanar-world", "normalStrategy": "smooth-with-30-degree-crease", "profile2D": {"points": [[2.001, 1.33], [1.9941, 1.37357], [1.97407, 1.41288], [1.94288, 1.44407], [1.90357, 1.4641], [1.86, 1.471], [-1.86, 1.471], [-1.90357, 1.4641], [-1.94288, 1.44407], [-1.97407, 1.41288], [-1.9941, 1.37357], [-2.001, 1.33], [-2.001, -1.33], [-1.9941, -1.37357], [-1.97407, -1.41288], [-1.94288, -1.44407], [-1.90357, -1.4641], [-1.86, -1.471], [1.86, -1.471], [1.90357, -1.4641], [1.94288, -1.44407], [1.97407, -1.41288], [1.9941, -1.37357], [2.001, -1.33]], "depth": 0.002, "axis": "z", "center": true, "bevel": {"size": 0.079, "thickness": 0.079, "segments": 3}}}, "parent": null, "attachment": null, "dimensions": {"width": 4.16, "height": 3.1, "depth": 0.16, "units": "world", "confidence": 0.6}, "transform": {"position": [-0.08, 1.55, -2.08], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "sofa-mount", "localPosition": [0.45, -1.55, 0.755], "localRotation": [0, 0, 0], "notes": "Where the sofa's back plane sits against the wall."}], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "room-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wall-cream"}}, "material": "wall-cream", "materialLayers": ["wall-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "corner-fillet-interpenetration", "description": "Wall B runs one wall thickness past the corner so the two slabs overlap in a 0.16 by 0.16 block. Butting them left a dark notch where the two crest fillets met without merging, which the reference does not have.", "geometry": "Length ROOM + WALL_T, centre offset by half a thickness along X.", "evidenceRefs": ["wall-back"], "confidence": 0.8}, {"id": "wall-slab-roundover-b", "description": "The same 0.22 round-over as wall A. Because wall B faces away from the key it is where the reference's cream reads darkest (#d8c8b1), and the crest roll is the only thing separating it from the background.", "geometry": "ExtrudeGeometry bevel, size and thickness 0.22.", "evidenceRefs": ["wall-back"], "confidence": 0.9}], "surfaceDetail": {"macroRoughness": 0.94, "microRoughness": 0.05, "bumpAmplitude": 0.006, "normalPattern": "fine-plaster-tooth", "displacementPattern": "none", "occlusionPattern": "crease-and-contact", "edgeWearPattern": "none", "notes": "Broad matte plane. Any visible highlight has to come from the fillets, not from a specular lobe."}, "evidenceRefs": ["wall-back"], "details": [], "fidelityTier": "form-refinement"};
  node_wall_b_1.userData.actionProfile = (node_wall_b_1.userData.sculptComponent as { actionProfile?: unknown }).actionProfile;
  (nodes["root"] ?? root).add(node_wall_b_1);
  nodes["wall-b"] = node_wall_b_1;
  const mesh_wall_b_1Geometry = endpoint_wall_b_1
    ? new THREE.CylinderGeometry(endpoint_wall_b_1.endRadius, endpoint_wall_b_1.baseRadius, endpoint_wall_b_1.length, 32, 12)
    : buildExtrudeGeometry({"points": [[2.001, 1.33], [1.9941, 1.37357], [1.97407, 1.41288], [1.94288, 1.44407], [1.90357, 1.4641], [1.86, 1.471], [-1.86, 1.471], [-1.90357, 1.4641], [-1.94288, 1.44407], [-1.97407, 1.41288], [-1.9941, 1.37357], [-2.001, 1.33], [-2.001, -1.33], [-1.9941, -1.37357], [-1.97407, -1.41288], [-1.94288, -1.44407], [-1.90357, -1.4641], [-1.86, -1.471], [1.86, -1.471], [1.90357, -1.4641], [1.94288, -1.44407], [1.97407, -1.41288], [1.9941, -1.37357], [2.001, -1.33]], "depth": 0.002, "axis": "z", "center": true, "bevel": {"size": 0.079, "thickness": 0.079, "segments": 3}});
  const mesh_wall_b_1 = new THREE.Mesh(
    mesh_wall_b_1Geometry,
    materialMap["wall-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_wall_b_1.name = "Wall B back with sofa";
  if (endpoint_wall_b_1) {
    mesh_wall_b_1.position.copy(endpoint_wall_b_1.midpoint);
    mesh_wall_b_1.quaternion.copy(endpoint_wall_b_1.quaternion);
  }
  mesh_wall_b_1.castShadow = options.castShadow ?? true;
  mesh_wall_b_1.receiveShadow = options.receiveShadow ?? true;
  mesh_wall_b_1.userData.sculptComponent = node_wall_b_1.userData.sculptComponent;
  node_wall_b_1.add(mesh_wall_b_1);
  meshes["wall-b"] = mesh_wall_b_1;
  colliders["wall-b"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["room-shell"] ??= [];
  destructionGroups["room-shell"].push(node_wall_b_1);
  const socket_wall_b_sofa_mount_0 = new THREE.Object3D();
  socket_wall_b_sofa_mount_0.name = "sofa-mount";
  socket_wall_b_sofa_mount_0.position.set(0.45, -1.55, 0.755);
  socket_wall_b_sofa_mount_0.rotation.set(0.0, 0.0, 0.0);
  socket_wall_b_sofa_mount_0.userData.socket = {"id": "sofa-mount", "localPosition": [0.45, -1.55, 0.755], "localRotation": [0, 0, 0], "notes": "Where the sofa's back plane sits against the wall."};
  node_wall_b_1.add(socket_wall_b_sofa_mount_0);
  sockets["wall-b:sofa-mount"] = socket_wall_b_sofa_mount_0;

  const attachment_floor_slab_2 = null;
  const endpoint_floor_slab_2 = makeAttachmentEndpoint(attachment_floor_slab_2);
  const node_floor_slab_2 = new THREE.Group();
  node_floor_slab_2.name = "Floor tray board field__pivot";
  if (endpoint_floor_slab_2) {
    node_floor_slab_2.position.copy(endpoint_floor_slab_2.start);
    node_floor_slab_2.rotation.set(0, 0, 0);
    node_floor_slab_2.scale.set(1, 1, 1);
  } else {
    node_floor_slab_2.position.set(0.0, -0.15, 0.0);
    node_floor_slab_2.rotation.set(0.0, 0.0, 0.0);
    node_floor_slab_2.scale.set(1.0, 1.0, 1.0);
  }
  node_floor_slab_2.userData.sculptComponent = {"id": "floor-slab", "name": "Floor tray board field", "level": "macro", "role": "shell-plate", "importance": 0.85, "confidence": 0.75, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "assembled-solid. A plate with real thickness, filleted on its bottom edges. The reference shows the slab edge below the navy rim, so the floor is a tray and not a texture on the ground plane.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(231, 177, 116, 1.0)", "secondaryAlbedo": "rgba(211, 156, 98, 1.0)", "materialClass": "wood", "materialClassConfidence": 0.88}, "geometryDescriptor": {"topologyIntent": "filleted plate", "edgeTreatment": {"type": "fillet", "bevelRadius": 0.06, "segments": 3}, "deformationStack": ["none"], "uvStrategy": "triplanar-world", "normalStrategy": "smooth-with-30-degree-crease", "profile2D": {"points": [[-2.07, -2.07], [2.07, -2.07], [2.07, 2.07], [-2.07, 2.07]], "depth": 0.18, "axis": "y", "center": true, "bevel": {"size": 0.06, "thickness": 0.06, "segments": 3}}}, "parent": null, "attachment": null, "dimensions": {"width": 4.26, "height": 0.3, "depth": 4.26, "units": "world", "confidence": 0.75}, "transform": {"position": [0.0, -0.15, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-tray", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wall-cream"}}, "material": "floor-tan", "materialLayers": ["floor-tan"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "plank-run-direction", "description": "Boards run parallel to wall A. Read from the seam slope alone, which is the weakest inference in the model: if it is wrong the boards run across the room instead of along it.", "geometry": "Seam instances aligned to the z axis.", "evidenceRefs": ["floor-planks"], "confidence": 0.66}], "surfaceDetail": {"macroRoughness": 0.88, "microRoughness": 0.09, "bumpAmplitude": 0.008, "normalPattern": "board-grain-drift", "displacementPattern": "none", "occlusionPattern": "seam-cavity", "edgeWearPattern": "none", "notes": "Grain drift runs along the board direction only; a cross-grained pattern would fight the seam geometry."}, "evidenceRefs": ["floor-planks"], "details": [], "fidelityTier": "form-refinement"};
  node_floor_slab_2.userData.actionProfile = (node_floor_slab_2.userData.sculptComponent as { actionProfile?: unknown }).actionProfile;
  (nodes["root"] ?? root).add(node_floor_slab_2);
  nodes["floor-slab"] = node_floor_slab_2;
  const mesh_floor_slab_2Geometry = endpoint_floor_slab_2
    ? new THREE.CylinderGeometry(endpoint_floor_slab_2.endRadius, endpoint_floor_slab_2.baseRadius, endpoint_floor_slab_2.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-2.07, -2.07], [2.07, -2.07], [2.07, 2.07], [-2.07, 2.07]], "depth": 0.18, "axis": "y", "center": true, "bevel": {"size": 0.06, "thickness": 0.06, "segments": 3}});
  const mesh_floor_slab_2 = new THREE.Mesh(
    mesh_floor_slab_2Geometry,
    materialMap["floor-tan"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_floor_slab_2.name = "Floor tray board field";
  if (endpoint_floor_slab_2) {
    mesh_floor_slab_2.position.copy(endpoint_floor_slab_2.midpoint);
    mesh_floor_slab_2.quaternion.copy(endpoint_floor_slab_2.quaternion);
  }
  mesh_floor_slab_2.castShadow = options.castShadow ?? true;
  mesh_floor_slab_2.receiveShadow = options.receiveShadow ?? true;
  mesh_floor_slab_2.userData.sculptComponent = node_floor_slab_2.userData.sculptComponent;
  node_floor_slab_2.add(mesh_floor_slab_2);
  meshes["floor-slab"] = mesh_floor_slab_2;
  colliders["floor-slab"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["floor-tray"] ??= [];
  destructionGroups["floor-tray"].push(node_floor_slab_2);

  const attachment_base_trim_3 = null;
  const endpoint_base_trim_3 = makeAttachmentEndpoint(attachment_base_trim_3);
  const node_base_trim_3 = new THREE.Group();
  node_base_trim_3.name = "Navy floor rim__pivot";
  if (endpoint_base_trim_3) {
    node_base_trim_3.position.copy(endpoint_base_trim_3.start);
    node_base_trim_3.rotation.set(0, 0, 0);
    node_base_trim_3.scale.set(1, 1, 1);
  } else {
    node_base_trim_3.position.set(0.0, -0.12, 0.0);
    node_base_trim_3.rotation.set(0.0, 0.0, 0.0);
    node_base_trim_3.scale.set(1.0, 1.0, 1.0);
  }
  node_base_trim_3.userData.sculptComponent = {"id": "base-trim", "name": "Navy floor rim", "level": "macro", "role": "edge-rail", "importance": 0.8, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "assembled-solid. A ring, not four rails. The reference shows the rim turning every corner without a visible joint, which a mitred set of four boxes cannot do at this fillet radius.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(57, 66, 84, 1.0)", "secondaryAlbedo": "rgba(44, 51, 67, 1.0)", "materialClass": "ceramic", "materialClassConfidence": 0.88}, "geometryDescriptor": {"topologyIntent": "filleted rounded-rectangle ring", "edgeTreatment": {"type": "fillet", "bevelRadius": 0.055, "segments": 3}, "deformationStack": ["none"], "uvStrategy": "triplanar-world", "normalStrategy": "smooth-with-30-degree-crease", "profile2D": {"points": [[2.095, 2.05], [2.0928, 2.06391], [2.08641, 2.07645], [2.07645, 2.08641], [2.06391, 2.0928], [2.05, 2.095], [-2.05, 2.095], [-2.06391, 2.0928], [-2.07645, 2.08641], [-2.08641, 2.07645], [-2.0928, 2.06391], [-2.095, 2.05], [-2.095, -2.05], [-2.0928, -2.06391], [-2.08641, -2.07645], [-2.07645, -2.08641], [-2.06391, -2.0928], [-2.05, -2.095], [2.05, -2.095], [2.06391, -2.0928], [2.07645, -2.08641], [2.08641, -2.07645], [2.0928, -2.06391], [2.095, -2.05]], "holes": [[[-2.045, -2.045], [2.045, -2.045], [2.045, 2.045], [-2.045, 2.045]]], "depth": 0.31, "axis": "y", "center": true, "bevel": {"size": 0.055, "thickness": 0.055, "segments": 3}}}, "parent": null, "attachment": null, "dimensions": {"width": 4.3, "height": 0.42, "depth": 4.3, "units": "world", "confidence": 0.7}, "transform": {"position": [0.0, -0.12, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static-shell", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "floor-tray", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wall-cream"}}, "material": "trim-navy", "materialLayers": ["trim-navy"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "floor-tray-rim", "description": "The rim stands 0.09 units above the board surface and drops 0.03 below the slab, so the floor reads as a tray. Against the game's sky this is the highest-contrast edge in the whole model.", "geometry": "Rounded-rectangle ring extruded 0.42 along y.", "evidenceRefs": ["base-trim", "floor-planks"], "confidence": 0.85}], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.06, "bumpAmplitude": 0.005, "normalPattern": "painted-trim-tooth", "displacementPattern": "none", "occlusionPattern": "crease-and-contact", "edgeWearPattern": "none", "notes": "Painted trim: slightly smoother than the plaster so the crest roll reads, never glossy."}, "evidenceRefs": ["base-trim"], "details": [], "fidelityTier": "form-refinement"};
  node_base_trim_3.userData.actionProfile = (node_base_trim_3.userData.sculptComponent as { actionProfile?: unknown }).actionProfile;
  (nodes["root"] ?? root).add(node_base_trim_3);
  nodes["base-trim"] = node_base_trim_3;
  const mesh_base_trim_3Geometry = endpoint_base_trim_3
    ? new THREE.CylinderGeometry(endpoint_base_trim_3.endRadius, endpoint_base_trim_3.baseRadius, endpoint_base_trim_3.length, 32, 12)
    : buildExtrudeGeometry({"points": [[2.095, 2.05], [2.0928, 2.06391], [2.08641, 2.07645], [2.07645, 2.08641], [2.06391, 2.0928], [2.05, 2.095], [-2.05, 2.095], [-2.06391, 2.0928], [-2.07645, 2.08641], [-2.08641, 2.07645], [-2.0928, 2.06391], [-2.095, 2.05], [-2.095, -2.05], [-2.0928, -2.06391], [-2.08641, -2.07645], [-2.07645, -2.08641], [-2.06391, -2.0928], [-2.05, -2.095], [2.05, -2.095], [2.06391, -2.0928], [2.07645, -2.08641], [2.08641, -2.07645], [2.0928, -2.06391], [2.095, -2.05]], "holes": [[[-2.045, -2.045], [2.045, -2.045], [2.045, 2.045], [-2.045, 2.045]]], "depth": 0.31, "axis": "y", "center": true, "bevel": {"size": 0.055, "thickness": 0.055, "segments": 3}});
  const mesh_base_trim_3 = new THREE.Mesh(
    mesh_base_trim_3Geometry,
    materialMap["trim-navy"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_base_trim_3.name = "Navy floor rim";
  if (endpoint_base_trim_3) {
    mesh_base_trim_3.position.copy(endpoint_base_trim_3.midpoint);
    mesh_base_trim_3.quaternion.copy(endpoint_base_trim_3.quaternion);
  }
  mesh_base_trim_3.castShadow = options.castShadow ?? true;
  mesh_base_trim_3.receiveShadow = options.receiveShadow ?? true;
  mesh_base_trim_3.userData.sculptComponent = node_base_trim_3.userData.sculptComponent;
  node_base_trim_3.add(mesh_base_trim_3);
  meshes["base-trim"] = mesh_base_trim_3;
  colliders["base-trim"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["floor-tray"] ??= [];
  destructionGroups["floor-tray"].push(node_base_trim_3);

  const attachment_sofa_plinth_4 = null;
  const endpoint_sofa_plinth_4 = makeAttachmentEndpoint(attachment_sofa_plinth_4);
  const node_sofa_plinth_4 = new THREE.Group();
  node_sofa_plinth_4.name = "Sofa base block__pivot";
  if (endpoint_sofa_plinth_4) {
    node_sofa_plinth_4.position.copy(endpoint_sofa_plinth_4.start);
    node_sofa_plinth_4.rotation.set(0, 0, 0);
    node_sofa_plinth_4.scale.set(1, 1, 1);
  } else {
    node_sofa_plinth_4.position.set(0.45, 0.41, -1.33);
    node_sofa_plinth_4.rotation.set(0.0, 0.0, 0.0);
    node_sofa_plinth_4.scale.set(1.0, 1.0, 1.0);
  }
  node_sofa_plinth_4.userData.sculptComponent = {"id": "sofa-plinth", "name": "Sofa base block", "level": "macro", "role": "body", "importance": 0.8, "confidence": 0.72, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "assembled-solid. The mass that carries the cushions and arms. Heavily filleted on every edge, which is what stops the sofa reading as a stack of boxes.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(151, 183, 154, 1.0)", "secondaryAlbedo": "rgba(119, 152, 122, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.88}, "geometryDescriptor": {"topologyIntent": "filleted block", "edgeTreatment": {"type": "fillet", "bevelRadius": 0.11, "segments": 3}, "deformationStack": ["none"], "uvStrategy": "triplanar-world", "normalStrategy": "smooth-with-30-degree-crease", "profile2D": {"points": [[-1.24, -0.09999999999999999], [1.24, -0.09999999999999999], [1.24, 0.09999999999999999], [-1.24, 0.09999999999999999]], "depth": 1.03, "axis": "z", "center": true, "bevel": {"size": 0.11, "thickness": 0.11, "segments": 3}}}, "parent": null, "attachment": null, "dimensions": {"width": 2.7, "height": 0.42, "depth": 1.25, "units": "world", "confidence": 0.7}, "transform": {"position": [0.45, 0.41, -1.33], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static-prop", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "sofa", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wall-cream"}}, "material": "sage-green", "materialLayers": ["sage-green"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "plinth-fillet", "description": "Corner radius 0.11 on a 0.42 unit tall block, so more than half the block's height is rolled edge.", "geometry": "ExtrudeGeometry bevel size 0.11.", "evidenceRefs": ["sofa"], "confidence": 0.8}], "surfaceDetail": {"macroRoughness": 0.92, "microRoughness": 0.07, "bumpAmplitude": 0.009, "normalPattern": "woven-tooth", "displacementPattern": "none", "occlusionPattern": "seam-cavity", "edgeWearPattern": "none", "notes": "Woven tooth at a scale that disappears at play distance but keeps the cushion from reading as moulded plastic up close."}, "evidenceRefs": ["sofa"], "details": [], "fidelityTier": "form-refinement"};
  node_sofa_plinth_4.userData.actionProfile = (node_sofa_plinth_4.userData.sculptComponent as { actionProfile?: unknown }).actionProfile;
  (nodes["root"] ?? root).add(node_sofa_plinth_4);
  nodes["sofa-plinth"] = node_sofa_plinth_4;
  const mesh_sofa_plinth_4Geometry = endpoint_sofa_plinth_4
    ? new THREE.CylinderGeometry(endpoint_sofa_plinth_4.endRadius, endpoint_sofa_plinth_4.baseRadius, endpoint_sofa_plinth_4.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-1.24, -0.09999999999999999], [1.24, -0.09999999999999999], [1.24, 0.09999999999999999], [-1.24, 0.09999999999999999]], "depth": 1.03, "axis": "z", "center": true, "bevel": {"size": 0.11, "thickness": 0.11, "segments": 3}});
  const mesh_sofa_plinth_4 = new THREE.Mesh(
    mesh_sofa_plinth_4Geometry,
    materialMap["sage-green"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_sofa_plinth_4.name = "Sofa base block";
  if (endpoint_sofa_plinth_4) {
    mesh_sofa_plinth_4.position.copy(endpoint_sofa_plinth_4.midpoint);
    mesh_sofa_plinth_4.quaternion.copy(endpoint_sofa_plinth_4.quaternion);
  }
  mesh_sofa_plinth_4.castShadow = options.castShadow ?? true;
  mesh_sofa_plinth_4.receiveShadow = options.receiveShadow ?? true;
  mesh_sofa_plinth_4.userData.sculptComponent = node_sofa_plinth_4.userData.sculptComponent;
  node_sofa_plinth_4.add(mesh_sofa_plinth_4);
  meshes["sofa-plinth"] = mesh_sofa_plinth_4;
  colliders["sofa-plinth"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["sofa"] ??= [];
  destructionGroups["sofa"].push(node_sofa_plinth_4);

  const attachment_table_shell_5 = null;
  const endpoint_table_shell_5 = makeAttachmentEndpoint(attachment_table_shell_5);
  const node_table_shell_5 = new THREE.Group();
  node_table_shell_5.name = "Side table body with cubby__pivot";
  if (endpoint_table_shell_5) {
    node_table_shell_5.position.copy(endpoint_table_shell_5.start);
    node_table_shell_5.rotation.set(0, 0, 0);
    node_table_shell_5.scale.set(1, 1, 1);
  } else {
    node_table_shell_5.position.set(-1.65, 0.525, 0.15);
    node_table_shell_5.rotation.set(0.0, 0.0, 0.0);
    node_table_shell_5.scale.set(1.0, 1.0, 1.0);
  }
  node_table_shell_5.userData.sculptComponent = {"id": "table-shell", "name": "Side table body with cubby", "level": "macro", "role": "case-body", "importance": 0.72, "confidence": 0.75, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "closed-ring. A ring extruded along x, so the cubby is a real recess with an occluded interior rather than a dark rectangle painted on the front face.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(243, 229, 210, 1.0)", "secondaryAlbedo": "rgba(201, 182, 156, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88}, "geometryDescriptor": {"topologyIntent": "filleted rounded-rectangle ring", "edgeTreatment": {"type": "fillet", "bevelRadius": 0.075, "segments": 3}, "deformationStack": ["none"], "uvStrategy": "triplanar-world", "normalStrategy": "smooth-with-30-degree-crease", "profile2D": {"points": [[0.45, 0.185], [0.44682, 0.20509], [0.43759, 0.22321], [0.42321, 0.23759], [0.40509, 0.24682], [0.385, 0.25], [-0.385, 0.25], [-0.40509, 0.24682], [-0.42321, 0.23759], [-0.43759, 0.22321], [-0.44682, 0.20509], [-0.45, 0.185], [-0.45, -0.185], [-0.44682, -0.20509], [-0.43759, -0.22321], [-0.42321, -0.23759], [-0.40509, -0.24682], [-0.385, -0.25], [0.385, -0.25], [0.40509, -0.24682], [0.42321, -0.23759], [0.43759, -0.22321], [0.44682, -0.20509], [0.45, -0.185]], "holes": [[[-0.44, -0.24], [0.44, -0.24], [0.44, 0.24], [-0.44, 0.24]]], "depth": 0.47, "axis": "x", "center": true, "bevel": {"size": 0.075, "thickness": 0.075, "segments": 3}}}, "parent": null, "attachment": null, "dimensions": {"width": 0.62, "height": 0.65, "depth": 1.05, "units": "world", "confidence": 0.72}, "transform": {"position": [-1.65, 0.525, 0.15], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static-prop", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.85}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "side-table", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "wall-cream"}}, "material": "furniture-cream", "materialLayers": ["furniture-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "cubby-recess", "description": "A rounded-rectangle opening leaving a 0.16 unit frame on every side. The cavity interior is the same cream as the face and is read only by occlusion (#c9b69c against #f3e5d2).", "geometry": "Ring profile with a rounded-rect hole, plus a separate back panel so the recess is not a through-hole.", "evidenceRefs": ["side-table"], "confidence": 0.84}], "surfaceDetail": {"macroRoughness": 0.9, "microRoughness": 0.06, "bumpAmplitude": 0.006, "normalPattern": "moulded-tooth", "displacementPattern": "none", "occlusionPattern": "cavity", "edgeWearPattern": "none", "notes": "Moulded case goods: uniform tooth, cavity term does the cubby."}, "evidenceRefs": ["side-table"], "details": [], "fidelityTier": "form-refinement"};
  node_table_shell_5.userData.actionProfile = (node_table_shell_5.userData.sculptComponent as { actionProfile?: unknown }).actionProfile;
  (nodes["root"] ?? root).add(node_table_shell_5);
  nodes["table-shell"] = node_table_shell_5;
  const mesh_table_shell_5Geometry = endpoint_table_shell_5
    ? new THREE.CylinderGeometry(endpoint_table_shell_5.endRadius, endpoint_table_shell_5.baseRadius, endpoint_table_shell_5.length, 32, 12)
    : buildExtrudeGeometry({"points": [[0.45, 0.185], [0.44682, 0.20509], [0.43759, 0.22321], [0.42321, 0.23759], [0.40509, 0.24682], [0.385, 0.25], [-0.385, 0.25], [-0.40509, 0.24682], [-0.42321, 0.23759], [-0.43759, 0.22321], [-0.44682, 0.20509], [-0.45, 0.185], [-0.45, -0.185], [-0.44682, -0.20509], [-0.43759, -0.22321], [-0.42321, -0.23759], [-0.40509, -0.24682], [-0.385, -0.25], [0.385, -0.25], [0.40509, -0.24682], [0.42321, -0.23759], [0.43759, -0.22321], [0.44682, -0.20509], [0.45, -0.185]], "holes": [[[-0.44, -0.24], [0.44, -0.24], [0.44, 0.24], [-0.44, 0.24]]], "depth": 0.47, "axis": "x", "center": true, "bevel": {"size": 0.075, "thickness": 0.075, "segments": 3}});
  const mesh_table_shell_5 = new THREE.Mesh(
    mesh_table_shell_5Geometry,
    materialMap["furniture-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_table_shell_5.name = "Side table body with cubby";
  if (endpoint_table_shell_5) {
    mesh_table_shell_5.position.copy(endpoint_table_shell_5.midpoint);
    mesh_table_shell_5.quaternion.copy(endpoint_table_shell_5.quaternion);
  }
  mesh_table_shell_5.castShadow = options.castShadow ?? true;
  mesh_table_shell_5.receiveShadow = options.receiveShadow ?? true;
  mesh_table_shell_5.userData.sculptComponent = node_table_shell_5.userData.sculptComponent;
  node_table_shell_5.add(mesh_table_shell_5);
  meshes["table-shell"] = mesh_table_shell_5;
  colliders["table-shell"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["side-table"] ??= [];
  destructionGroups["side-table"].push(node_table_shell_5);

  // --- img2threejs refine-code: hand-authored furnishing, injected by
  // assets/reference/apartment/apply_refinements.py. Band 3 of the provenance
  // ledger above. The generated blockout stops at the six macro masses; this is
  // the twenty spec components it does not reach plus everything beyond the
  // reference. It lives in its own module so the boundary between generated and
  // hand-written is a file boundary, and so regenerating this file cannot
  // silently delete two thirds of the room.
  addApartmentFurnishing({
    root,
    materials: materialMap,
    nodes,
    meshes,
    variant: options.variant ?? 'living',
    castShadow: options.castShadow ?? true,
    receiveShadow: options.receiveShadow ?? true,
    extrude: buildExtrudeGeometry,
  });

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "balanced", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 128, "preferredTextureResolution": 256, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "ranAnyway": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "measuredConfidence": {"wall-cream": 0.86, "trim-navy": 0.793, "floor-tan": 0.779, "sage-green": 0.703, "rug-coral": 0.709, "rug-gold": 0.775, "furniture-cream": 0.796, "glass-blue": 0.704}, "acceptedLimitation": "Extraction cleared its 0.7 confidence gate on all eight materials, but the maps are NOT bound to the runtime material. Every surface in this reference is flat paint with no pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's own key light onto every wall of every repeated module. The runtime uses solid albedo plus procedural roughness/normal variation, which is the rule of thumb the skill states for flat paint. The extracted palettes and the de-lit reference are evidence for the albedo and roughness scalars, nothing more. Two crops had to be recut before they passed: the first sage crop straddled the arm's round-over (confidence 0.678) and the first gold and navy crops caught neighbouring coral and plank pixels, which showed up as a contaminated dominant palette entry rather than as a low score."}}, "lightingPass": {"keyDirection": "upper front left, matching the reference's left wall being 11 percent brighter than the back wall on one albedo", "fillRatio": 0.55, "rim": "none; the reference's silhouette edge reads darker than its interior", "background": "#d3d1d1, measured at all four corners of the reference within 2 of 255", "toneMapping": "neutral for the reference-matched review, since the reference's brightest pixel is 0.93 relative luminance and nothing clips", "exposure": 1.0}};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createMAKEITWORSEApartmentRoomLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "MAKE IT WORSE Apartment Room look-dev lights";
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
  lights.userData.lightingFromPhoto = ["One warm key, upper front left. The same cream measures #f3e3ce on wall A and #d8c8b1 on wall B, an 11 percent difference across a 90 degree normal change.", "Broad soft fill: the deepest occlusion in the room (the skirting corner at #11141a) is still 6 percent above black, so nothing goes fully dark.", "No rim light. The silhouette edge reads darker than the interior everywhere.", "Contact shadows are short and soft, and they are the only thing anchoring the furniture to the floor.", "Background is a flat #d3d1d1 studio grey, uniform within 2 of 255 at all four corners.", "Exposure 1.0 with neutral tone mapping for the reference-matched review. The reference carries no filmic or ACES grade: its brightest pixel is 0.93 relative luminance and nothing clips, so an ACES curve would compress the cream far more than the sage and a colour comparison under it would measure the tone curve instead of the material."];
  lights.userData.lookDevTargets = {"qualityPriority": "balanced", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 128, "preferredTextureResolution": 256, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "ranAnyway": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "measuredConfidence": {"wall-cream": 0.86, "trim-navy": 0.793, "floor-tan": 0.779, "sage-green": 0.703, "rug-coral": 0.709, "rug-gold": 0.775, "furniture-cream": 0.796, "glass-blue": 0.704}, "acceptedLimitation": "Extraction cleared its 0.7 confidence gate on all eight materials, but the maps are NOT bound to the runtime material. Every surface in this reference is flat paint with no pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's own key light onto every wall of every repeated module. The runtime uses solid albedo plus procedural roughness/normal variation, which is the rule of thumb the skill states for flat paint. The extracted palettes and the de-lit reference are evidence for the albedo and roughness scalars, nothing more. Two crops had to be recut before they passed: the first sage crop straddled the arm's round-over (confidence 0.678) and the first gold and navy crops caught neighbouring coral and plank pixels, which showed up as a contaminated dominant palette entry rather than as a low score."}}, "lightingPass": {"keyDirection": "upper front left, matching the reference's left wall being 11 percent brighter than the back wall on one albedo", "fillRatio": 0.55, "rim": "none; the reference's silhouette edge reads darker than its interior", "background": "#d3d1d1, measured at all four corners of the reference within 2 of 255", "toneMapping": "neutral for the reference-matched review, since the reference's brightest pixel is 0.93 relative luminance and nothing clips", "exposure": 1.0}};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createMAKEITWORSEApartmentRoomEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
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
export function frameMAKEITWORSEApartmentRoomCamera(
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
export function createMAKEITWORSEApartmentRoomPresentationComposer(
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

export function configureMAKEITWORSEApartmentRoomRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createMAKEITWORSEApartmentRoomInspectControls(
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

// --- img2threejs refine-code edits applied by assets/reference/apartment/apply_refinements.py
