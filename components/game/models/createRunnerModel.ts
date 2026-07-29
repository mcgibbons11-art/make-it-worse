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


/**
 * A rounded shoe, drawn in side view and given thickness: flat under the sole,
 * swelling over a toe box, dipping at the instep and rising to an ankle collar.
 * `outsole` returns the same plan kept low, for the piece under the upper.
 *
 * Normalised into the unit box, so it drops in where a BoxGeometry(1, 1, 1) was
 * and every extent - above all the sole height - is unchanged.
 */
function runnerFootGeometry(outsole: boolean): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  if (outsole) {
    shape.moveTo(-1, -0.5);
    shape.lineTo(0.74, -0.5);
    shape.quadraticCurveTo(1.02, -0.5, 1.02, -0.12);
    shape.quadraticCurveTo(0.96, 0.1, 0.6, 0.12);
    shape.lineTo(-0.86, 0.12);
    shape.quadraticCurveTo(-1.04, -0.1, -1, -0.5);
  } else {
    shape.moveTo(-1, -0.5);
    shape.lineTo(0.7, -0.5);
    shape.quadraticCurveTo(1, -0.5, 1.02, -0.06);
    shape.quadraticCurveTo(0.94, 0.26, 0.5, 0.24);
    shape.quadraticCurveTo(0.2, 0.2, -0.04, 0.3);
    shape.quadraticCurveTo(-0.18, 0.68, -0.32, 0.95);
    shape.lineTo(-0.8, 0.95);
    shape.quadraticCurveTo(-1.06, 0.3, -1, -0.5);
  }
  const bevel = outsole ? 0.1 : 0.16;
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 1.4,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: outsole ? 2 : 3,
    curveSegments: 10,
  });
  // rotateY(+PI/2) maps the profile's +x to world -z, which puts the toe
  // BEHIND the runner - he faces +Z. Negative turns it the right way round.
  // The width axis mirrors with it, which is a no-op on a uniform extrusion.
  geometry.rotateY(-Math.PI / 2);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (box) {
    const size = new THREE.Vector3();
    box.getSize(size);
    geometry.translate(-box.min.x, -box.min.y, -box.min.z);
    geometry.scale(
      size.x > 1e-6 ? 1 / size.x : 1,
      size.y > 1e-6 ? 1 / size.y : 1,
      size.z > 1e-6 ? 1 / size.z : 1,
    );
    geometry.translate(-0.5, -0.5, -0.5);
  }
  geometry.computeVertexNormals();
  return geometry;
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

// --- img2threejs refine-code edits applied by assets/reference/character/apply_refinements.py
// Generated from ObjectSculptSpec target: MAKE IT WORSE Runner
// Sculpt build pass: optimization-pass
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createMAKEITWORSERunnerModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "MAKE IT WORSE Runner";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 40.0, "aspect": 1.0, "orientation": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "positionHint": [0.0, 0.0, 3.0], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review."}, "approximationNotes": []};

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["skin"] = createSculptMaterial(
    "skin",
    {"id": "skin", "name": "Skin", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#fbdfb4", "color": "#fbdfb4", "albedo": {"dominant": "#fbdfb4", "secondary": ["#DFBF94", "#CCA981", "#D6B58B"], "samplingNotes": "Base colour is the recorded flat-lit median. Keeps the recorded flat-lit median #fbdfb4. The extractor's de-lit palette for this crop is #E8C89C, about 8% darker, because the only fully clean skin rectangle sits in the chin's own shadow and the de-lighting under-corrects it. The extractor palette is kept below as measured evidence, not promoted to base colour.", "map": null}, "colorVariation": {"palette": ["#fbdfb4", "#e9cfa7", "#ffeabd"], "pattern": "flat albedo with a low-amplitude tonal drift; the reference shows almost no albedo variance within a part", "amplitude": 0.05, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part. The figure is a smooth clay render with no repeating pattern, so detail stays at object scale and never stretches with component scale or tiles visibly."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.336, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.191, "role": "reference-derived moulding flow and seam relief"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.078, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.692, "variation": 0.05, "map": "independent-procedural-field", "localResponse": "cavities and part intersections trend rougher; crowns catching the key trend slightly smoother", "evidence": "roughness.base is the extractor's measured estimate for this material's own crop. Across all seven surfaces the extractor spans only 0.680-0.714, so roughness carries almost no identity in this reference; the figure is uniformly matte clay. The previous hand-set 0.55-0.78 spread was not measured and has been replaced."}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.168, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.28, "contactShadowBias": 0.35, "map": "independent-procedural-field", "notes": "Darken where parts meet: under the hair fringe, under the chin, along the strap channels, at the sleeve cuff and where the sole meets the upper. Independent of albedo."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["MeshPhysicalMaterial with clearcoat, transmission and sheen at zero: the reference is matte clay with no specular coat.", "Albedo, roughness, height, normal and AO are five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the fields are stable across reloads.", "roughness.base is the extractor's measured estimate for this material's own crop. Across all seven surfaces the extractor spans only 0.680-0.714, so roughness carries almost no identity in this reference; the figure is uniformly matte clay. The previous hand-set 0.55-0.78 spread was not measured and has been replaced."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\crops\\skin-crop.png", "sourceCropBoxPx": [445, 436, 641, 493], "sourceCropRegion": "chin and jaw band below the mouth line, the largest rectangle that is 100% face skin", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "conditional", "confidence": 0.672, "estimatedFidelity": 0.672, "targetThreshold": 0.7, "extractorPalette": ["#E8C89C", "#DFBF94", "#CCA981", "#D6B58B", "#EFD1A5"], "extractorWarnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped", "low value range weakens height/roughness inference"], "measuredStats": {"valueRange": 0.1589, "heightP90Gradient": 0.0097, "roughnessBase": 0.692, "roughnessVariation": 0.05, "normalStrength": 0.168, "blurRadius": 21}, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction ran on a per-material crop and its numbers are recorded verbatim, but the extracted maps are NOT bound to the runtime material and referencePbr.usable is false. Three reasons, in order of weight. (1) Inspecting the generated maps shows the albedo is a flat colour carrying the reference's own lighting falloff, the height/normal/roughness channels are the render's compression grain upsampled from a small crop, and the AO channel is essentially white; tiling them would paint the reference's shading and its codec noise onto every surface. (2) The factory's referenceMapUrl() loads these maps by absolute disk path, which cannot resolve in a browser, so usable:true would break the runtime. (3) Thirty-five 1024px PNGs is not a viable budget for a player character in a web game. The runtime instead builds five independent procedural canvas fields per material, and the extracted palettes and roughness estimates are used as evidence for the scalars.", "albedoDecision": "Keeps the recorded flat-lit median #fbdfb4. The extractor's de-lit palette for this crop is #E8C89C, about 8% darker, because the only fully clean skin rectangle sits in the chin's own shadow and the de-lighting under-corrects it. The extractor palette is kept below as measured evidence, not promoted to base colour.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\skin_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\skin_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\skin_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\skin_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\skin_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "belowTargetThreshold": "Extraction confidence 0.672 is below the 0.7 target. Cause is recorded in extractorWarnings: the only clean rectangle for this material is small and low-relief, so the resolution and detail terms of the extractor's confidence model are pinned near their floor. This is reported as a conditional result, not upgraded."}, "roughnessMap": {"type": "constant", "value": 0.78, "independent": true, "notes": "The reference is a uniformly matte clay render: roughness carries no spatial variation, so a constant is the honest map rather than a fabricated texture. Explicitly independent of albedo."}},
    options
  );
  materialMap["hair-ink"] = createSculptMaterial(
    "hair-ink",
    {"id": "hair-ink", "name": "Hair and trousers ink", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#313a51", "color": "#313a51", "albedo": {"dominant": "#313a51", "secondary": ["#363F56", "#303A51", "#2B354B"], "samplingNotes": "Base colour is the recorded flat-lit median. Extractor de-lit palette #333D54 confirms the recorded #313a51 to within 2/255 per channel. Recorded value kept.", "map": null}, "colorVariation": {"palette": ["#313a51", "#2e364b", "#333d55"], "pattern": "flat albedo with a low-amplitude tonal drift; the reference shows almost no albedo variance within a part", "amplitude": 0.05, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part. The figure is a smooth clay render with no repeating pattern, so detail stays at object scale and never stretches with component scale or tiles visibly."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.308, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.22, "role": "reference-derived moulding flow and seam relief"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.095, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.702, "variation": 0.05, "map": "independent-procedural-field", "localResponse": "cavities and part intersections trend rougher; crowns catching the key trend slightly smoother", "evidence": "roughness.base is the extractor's measured estimate for this material's own crop. Across all seven surfaces the extractor spans only 0.680-0.714, so roughness carries almost no identity in this reference; the figure is uniformly matte clay. The previous hand-set 0.55-0.78 spread was not measured and has been replaced."}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.176, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.28, "contactShadowBias": 0.35, "map": "independent-procedural-field", "notes": "Darken where parts meet: under the hair fringe, under the chin, along the strap channels, at the sleeve cuff and where the sole meets the upper. Independent of albedo."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["MeshPhysicalMaterial with clearcoat, transmission and sheen at zero: the reference is matte clay with no specular coat.", "Albedo, roughness, height, normal and AO are five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the fields are stable across reloads.", "roughness.base is the extractor's measured estimate for this material's own crop. Across all seven surfaces the extractor spans only 0.680-0.714, so roughness carries almost no identity in this reference; the figure is uniformly matte clay. The previous hand-set 0.55-0.78 spread was not measured and has been replaced."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\crops\\hair-ink-crop.png", "sourceCropBoxPx": [409, 149, 678, 253], "sourceCropRegion": "hair cap crown, clear of the forehead and of the fringe notch", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.729, "estimatedFidelity": 0.729, "targetThreshold": 0.7, "extractorPalette": ["#333D54", "#363F56", "#303A51", "#2B354B", "#3A4258"], "extractorWarnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped", "low value range weakens height/roughness inference"], "measuredStats": {"valueRange": 0.08, "heightP90Gradient": 0.01659, "roughnessBase": 0.702, "roughnessVariation": 0.05, "normalStrength": 0.176, "blurRadius": 21}, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction ran on a per-material crop and its numbers are recorded verbatim, but the extracted maps are NOT bound to the runtime material and referencePbr.usable is false. Three reasons, in order of weight. (1) Inspecting the generated maps shows the albedo is a flat colour carrying the reference's own lighting falloff, the height/normal/roughness channels are the render's compression grain upsampled from a small crop, and the AO channel is essentially white; tiling them would paint the reference's shading and its codec noise onto every surface. (2) The factory's referenceMapUrl() loads these maps by absolute disk path, which cannot resolve in a browser, so usable:true would break the runtime. (3) Thirty-five 1024px PNGs is not a viable budget for a player character in a web game. The runtime instead builds five independent procedural canvas fields per material, and the extracted palettes and roughness estimates are used as evidence for the scalars.", "albedoDecision": "Extractor de-lit palette #333D54 confirms the recorded #313a51 to within 2/255 per channel. Recorded value kept.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\hair-ink_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\hair-ink_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\hair-ink_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\hair-ink_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\hair-ink_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "crossCheck": {"crop": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\crops\\hair-ink-alt-trouser-crop.png", "region": "left trouser leg, the other surface that shares this navy", "confidence": 0.717, "palette": ["#232B3F", "#252D41", "#262E43", "#1F273A", "#1A2030"], "finding": "The trouser crop de-lights to #232B3F against the hair crop's #333D54. The trouser sits further from the top key so it reads darker; the hair crop is the higher confidence of the two and is the bound evidence."}}, "roughnessMap": {"type": "constant", "value": 0.72, "independent": true, "notes": "The reference is a uniformly matte clay render: roughness carries no spatial variation, so a constant is the honest map rather than a fabricated texture. Explicitly independent of albedo."}},
    options
  );
  materialMap["torso-purple"] = createSculptMaterial(
    "torso-purple",
    {"id": "torso-purple", "name": "Shirt purple", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#8e67d8", "color": "#8e67d8", "albedo": {"dominant": "#8e67d8", "secondary": ["#8862D3", "#815CCA", "#9069DA"], "samplingNotes": "Base colour is the recorded flat-lit median. Extractor de-lit palette #8D66D7 confirms the recorded #8e67d8 to within 1/255 per channel.", "map": null}, "colorVariation": {"palette": ["#8e67d8", "#8460c9", "#956ce3"], "pattern": "flat albedo with a low-amplitude tonal drift; the reference shows almost no albedo variance within a part", "amplitude": 0.05, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part. The figure is a smooth clay render with no repeating pattern, so detail stays at object scale and never stretches with component scale or tiles visibly."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.31, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.255, "role": "reference-derived moulding flow and seam relief"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.115, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.714, "variation": 0.05, "map": "independent-procedural-field", "localResponse": "cavities and part intersections trend rougher; crowns catching the key trend slightly smoother", "evidence": "roughness.base is the extractor's measured estimate for this material's own crop. Across all seven surfaces the extractor spans only 0.680-0.714, so roughness carries almost no identity in this reference; the figure is uniformly matte clay. The previous hand-set 0.55-0.78 spread was not measured and has been replaced."}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.186, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.28, "contactShadowBias": 0.35, "map": "independent-procedural-field", "notes": "Darken where parts meet: under the hair fringe, under the chin, along the strap channels, at the sleeve cuff and where the sole meets the upper. Independent of albedo."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "uniform-bevel", "description": "uniform 0.012u edge bevel; nothing in the figure carries a hard edge", "roughness": 0.68}], "shaderNotes": ["MeshPhysicalMaterial with clearcoat, transmission and sheen at zero: the reference is matte clay with no specular coat.", "Albedo, roughness, height, normal and AO are five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the fields are stable across reloads.", "roughness.base is the extractor's measured estimate for this material's own crop. Across all seven surfaces the extractor spans only 0.680-0.714, so roughness carries almost no identity in this reference; the figure is uniformly matte clay. The previous hand-set 0.55-0.78 spread was not measured and has been replaced."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\crops\\torso-purple-crop.png", "sourceCropBoxPx": [451, 571, 633, 873], "sourceCropRegion": "shirt front between the two backpack straps", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.751, "estimatedFidelity": 0.751, "targetThreshold": 0.7, "extractorPalette": ["#8D66D7", "#8862D3", "#815CCA", "#9069DA", "#7452B7"], "extractorWarnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped", "low value range weakens height/roughness inference"], "measuredStats": {"valueRange": 0.0854, "heightP90Gradient": 0.02507, "roughnessBase": 0.714, "roughnessVariation": 0.05, "normalStrength": 0.186, "blurRadius": 21}, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction ran on a per-material crop and its numbers are recorded verbatim, but the extracted maps are NOT bound to the runtime material and referencePbr.usable is false. Three reasons, in order of weight. (1) Inspecting the generated maps shows the albedo is a flat colour carrying the reference's own lighting falloff, the height/normal/roughness channels are the render's compression grain upsampled from a small crop, and the AO channel is essentially white; tiling them would paint the reference's shading and its codec noise onto every surface. (2) The factory's referenceMapUrl() loads these maps by absolute disk path, which cannot resolve in a browser, so usable:true would break the runtime. (3) Thirty-five 1024px PNGs is not a viable budget for a player character in a web game. The runtime instead builds five independent procedural canvas fields per material, and the extracted palettes and roughness estimates are used as evidence for the scalars.", "albedoDecision": "Extractor de-lit palette #8D66D7 confirms the recorded #8e67d8 to within 1/255 per channel.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\torso-purple_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\torso-purple_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\torso-purple_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\torso-purple_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\torso-purple_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "roughnessMap": {"type": "constant", "value": 0.68, "independent": true, "notes": "The reference is a uniformly matte clay render: roughness carries no spatial variation, so a constant is the honest map rather than a fabricated texture. Explicitly independent of albedo."}},
    options
  );
  materialMap["strap-coral"] = createSculptMaterial(
    "strap-coral",
    {"id": "strap-coral", "name": "Backpack strap coral", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#f18979", "color": "#f18979", "albedo": {"dominant": "#f18979", "secondary": ["#F18976", "#EF8673", "#F68D7A"], "samplingNotes": "Base colour is the recorded flat-lit median. Extractor de-lit palette #F28B78 confirms the recorded #f18979 to within 2/255 per channel.", "map": null}, "colorVariation": {"palette": ["#f18979", "#e07f71", "#fd907f"], "pattern": "flat albedo with a low-amplitude tonal drift; the reference shows almost no albedo variance within a part", "amplitude": 0.05, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part. The figure is a smooth clay render with no repeating pattern, so detail stays at object scale and never stretches with component scale or tiles visibly."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.308, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.194, "role": "reference-derived moulding flow and seam relief"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.08, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.688, "variation": 0.05, "map": "independent-procedural-field", "localResponse": "cavities and part intersections trend rougher; crowns catching the key trend slightly smoother", "evidence": "roughness.base is the extractor's measured estimate for this material's own crop. Across all seven surfaces the extractor spans only 0.680-0.714, so roughness carries almost no identity in this reference; the figure is uniformly matte clay. The previous hand-set 0.55-0.78 spread was not measured and has been replaced."}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.169, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.28, "contactShadowBias": 0.35, "map": "independent-procedural-field", "notes": "Darken where parts meet: under the hair fringe, under the chin, along the strap channels, at the sleeve cuff and where the sole meets the upper. Independent of albedo."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["MeshPhysicalMaterial with clearcoat, transmission and sheen at zero: the reference is matte clay with no specular coat.", "Albedo, roughness, height, normal and AO are five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the fields are stable across reloads.", "roughness.base is the extractor's measured estimate for this material's own crop. Across all seven surfaces the extractor spans only 0.680-0.714, so roughness carries almost no identity in this reference; the figure is uniformly matte clay. The previous hand-set 0.55-0.78 spread was not measured and has been replaced."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\crops\\strap-coral-crop.png", "sourceCropBoxPx": [412, 572, 428, 619], "sourceCropRegion": "left backpack strap over the shoulder, the widest fully-coral rectangle in the frame", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "conditional", "confidence": 0.679, "estimatedFidelity": 0.679, "targetThreshold": 0.7, "extractorPalette": ["#F28B78", "#F18976", "#EF8673", "#F68D7A", "#F9927F"], "extractorWarnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped", "low value range weakens height/roughness inference"], "measuredStats": {"valueRange": 0.08, "heightP90Gradient": 0.01059, "roughnessBase": 0.688, "roughnessVariation": 0.05, "normalStrength": 0.169, "blurRadius": 21}, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction ran on a per-material crop and its numbers are recorded verbatim, but the extracted maps are NOT bound to the runtime material and referencePbr.usable is false. Three reasons, in order of weight. (1) Inspecting the generated maps shows the albedo is a flat colour carrying the reference's own lighting falloff, the height/normal/roughness channels are the render's compression grain upsampled from a small crop, and the AO channel is essentially white; tiling them would paint the reference's shading and its codec noise onto every surface. (2) The factory's referenceMapUrl() loads these maps by absolute disk path, which cannot resolve in a browser, so usable:true would break the runtime. (3) Thirty-five 1024px PNGs is not a viable budget for a player character in a web game. The runtime instead builds five independent procedural canvas fields per material, and the extracted palettes and roughness estimates are used as evidence for the scalars.", "albedoDecision": "Extractor de-lit palette #F28B78 confirms the recorded #f18979 to within 2/255 per channel.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\strap-coral_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\strap-coral_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\strap-coral_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\strap-coral_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\strap-coral_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "belowTargetThreshold": "Extraction confidence 0.679 is below the 0.7 target. Cause is recorded in extractorWarnings: the only clean rectangle for this material is small and low-relief, so the resolution and detail terms of the extractor's confidence model are pinned near their floor. This is reported as a conditional result, not upgraded."}, "roughnessMap": {"type": "constant", "value": 0.74, "independent": true, "notes": "The reference is a uniformly matte clay render: roughness carries no spatial variation, so a constant is the honest map rather than a fabricated texture. Explicitly independent of albedo."}},
    options
  );
  materialMap["shoe-cream"] = createSculptMaterial(
    "shoe-cream",
    {"id": "shoe-cream", "name": "Sneaker upper", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#efe6d9", "color": "#efe6d9", "albedo": {"dominant": "#efe6d9", "secondary": ["#EEE6D8", "#F3EADD", "#F5ECDF"], "samplingNotes": "Base colour is the recorded flat-lit median. Extractor de-lit palette #F0E8DA confirms the recorded #efe6d9 to within 2/255 per channel.", "map": null}, "colorVariation": {"palette": ["#efe6d9", "#ded6ca", "#fbf2e4"], "pattern": "flat albedo with a low-amplitude tonal drift; the reference shows almost no albedo variance within a part", "amplitude": 0.05, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part. The figure is a smooth clay render with no repeating pattern, so detail stays at object scale and never stretches with component scale or tiles visibly."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.308, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.208, "role": "reference-derived moulding flow and seam relief"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.088, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.694, "variation": 0.05, "map": "independent-procedural-field", "localResponse": "cavities and part intersections trend rougher; crowns catching the key trend slightly smoother", "evidence": "roughness.base is the extractor's measured estimate for this material's own crop. Across all seven surfaces the extractor spans only 0.680-0.714, so roughness carries almost no identity in this reference; the figure is uniformly matte clay. The previous hand-set 0.55-0.78 spread was not measured and has been replaced."}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.173, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.28, "contactShadowBias": 0.35, "map": "independent-procedural-field", "notes": "Darken where parts meet: under the hair fringe, under the chin, along the strap channels, at the sleeve cuff and where the sole meets the upper. Independent of albedo."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["MeshPhysicalMaterial with clearcoat, transmission and sheen at zero: the reference is matte clay with no specular coat.", "Albedo, roughness, height, normal and AO are five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the fields are stable across reloads.", "roughness.base is the extractor's measured estimate for this material's own crop. Across all seven surfaces the extractor spans only 0.680-0.714, so roughness carries almost no identity in this reference; the figure is uniformly matte clay. The previous hand-set 0.55-0.78 spread was not measured and has been replaced."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\crops\\shoe-cream-crop.png", "sourceCropBoxPx": [388, 1246, 505, 1276], "sourceCropRegion": "left sneaker upper above the welt line", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.787, "estimatedFidelity": 0.787, "targetThreshold": 0.7, "extractorPalette": ["#F0E8DA", "#EEE6D8", "#F3EADD", "#F5ECDF", "#F1E9DC"], "extractorWarnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped", "low value range weakens height/roughness inference"], "measuredStats": {"valueRange": 0.08, "heightP90Gradient": 0.01392, "roughnessBase": 0.694, "roughnessVariation": 0.05, "normalStrength": 0.173, "blurRadius": 21}, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction ran on a per-material crop and its numbers are recorded verbatim, but the extracted maps are NOT bound to the runtime material and referencePbr.usable is false. Three reasons, in order of weight. (1) Inspecting the generated maps shows the albedo is a flat colour carrying the reference's own lighting falloff, the height/normal/roughness channels are the render's compression grain upsampled from a small crop, and the AO channel is essentially white; tiling them would paint the reference's shading and its codec noise onto every surface. (2) The factory's referenceMapUrl() loads these maps by absolute disk path, which cannot resolve in a browser, so usable:true would break the runtime. (3) Thirty-five 1024px PNGs is not a viable budget for a player character in a web game. The runtime instead builds five independent procedural canvas fields per material, and the extracted palettes and roughness estimates are used as evidence for the scalars.", "albedoDecision": "Extractor de-lit palette #F0E8DA confirms the recorded #efe6d9 to within 2/255 per channel.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\shoe-cream_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\shoe-cream_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\shoe-cream_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\shoe-cream_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\shoe-cream_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "roughnessMap": {"type": "constant", "value": 0.7, "independent": true, "notes": "The reference is a uniformly matte clay render: roughness carries no spatial variation, so a constant is the honest map rather than a fabricated texture. Explicitly independent of albedo."}},
    options
  );
  materialMap["shoe-sole"] = createSculptMaterial(
    "shoe-sole",
    {"id": "shoe-sole", "name": "Sneaker sole", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#252d42", "color": "#252d42", "albedo": {"dominant": "#252d42", "secondary": ["#F2E9DB", "#F4ECDE", "#F3EADC"], "samplingNotes": "Base colour is the recorded flat-lit median. Deliberate departure from the reference. The extractor reads the outsole at #F1E8DA, which is the same cream as the upper: a seeded region grow at a 5/255 step tolerance cannot separate sole from upper at all, so the reference genuinely paints them one colour. Against the pale walking deck that cream measures 1.17:1 contrast, which is invisible at the moment a player needs to judge footing, so the shipped sole is darkened to #252d42. Roughness, height, normal and AO evidence still come from this crop.", "map": null}, "colorVariation": {"palette": ["#252d42", "#222a3d", "#272f45"], "pattern": "flat albedo with a low-amplitude tonal drift; the reference shows almost no albedo variance within a part", "amplitude": 0.05, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part. The figure is a smooth clay render with no repeating pattern, so detail stays at object scale and never stretches with component scale or tiles visibly."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.308, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.197, "role": "reference-derived moulding flow and seam relief"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.082, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.68, "variation": 0.05, "map": "independent-procedural-field", "localResponse": "cavities and part intersections trend rougher; crowns catching the key trend slightly smoother", "evidence": "roughness.base is the extractor's measured estimate for this material's own crop. Across all seven surfaces the extractor spans only 0.680-0.714, so roughness carries almost no identity in this reference; the figure is uniformly matte clay. The previous hand-set 0.55-0.78 spread was not measured and has been replaced."}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.169, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.28, "contactShadowBias": 0.35, "map": "independent-procedural-field", "notes": "Darken where parts meet: under the hair fringe, under the chin, along the strap channels, at the sleeve cuff and where the sole meets the upper. Independent of albedo."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "contrast-sole", "description": "sole darkened from the reference's cream to ink so the ground-contact point clears 3:1 against the pale walking deck", "roughness": 0.66}], "shaderNotes": ["MeshPhysicalMaterial with clearcoat, transmission and sheen at zero: the reference is matte clay with no specular coat.", "Albedo, roughness, height, normal and AO are five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the fields are stable across reloads.", "roughness.base is the extractor's measured estimate for this material's own crop. Across all seven surfaces the extractor spans only 0.680-0.714, so roughness carries almost no identity in this reference; the figure is uniformly matte clay. The previous hand-set 0.55-0.78 spread was not measured and has been replaced."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\crops\\shoe-sole-crop.png", "sourceCropBoxPx": [389, 1286, 492, 1325], "sourceCropRegion": "left sneaker outsole band below the welt line", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.763, "estimatedFidelity": 0.763, "targetThreshold": 0.7, "extractorPalette": ["#F1E8DA", "#F2E9DB", "#F4ECDE", "#F3EADC", "#F6EEE1"], "extractorWarnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped", "low value range weakens height/roughness inference"], "measuredStats": {"valueRange": 0.08, "heightP90Gradient": 0.0111, "roughnessBase": 0.68, "roughnessVariation": 0.05, "normalStrength": 0.169, "blurRadius": 21}, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction ran on a per-material crop and its numbers are recorded verbatim, but the extracted maps are NOT bound to the runtime material and referencePbr.usable is false. Three reasons, in order of weight. (1) Inspecting the generated maps shows the albedo is a flat colour carrying the reference's own lighting falloff, the height/normal/roughness channels are the render's compression grain upsampled from a small crop, and the AO channel is essentially white; tiling them would paint the reference's shading and its codec noise onto every surface. (2) The factory's referenceMapUrl() loads these maps by absolute disk path, which cannot resolve in a browser, so usable:true would break the runtime. (3) Thirty-five 1024px PNGs is not a viable budget for a player character in a web game. The runtime instead builds five independent procedural canvas fields per material, and the extracted palettes and roughness estimates are used as evidence for the scalars.", "albedoDecision": "Deliberate departure from the reference. The extractor reads the outsole at #F1E8DA, which is the same cream as the upper: a seeded region grow at a 5/255 step tolerance cannot separate sole from upper at all, so the reference genuinely paints them one colour. Against the pale walking deck that cream measures 1.17:1 contrast, which is invisible at the moment a player needs to judge footing, so the shipped sole is darkened to #252d42. Roughness, height, normal and AO evidence still come from this crop.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\shoe-sole_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\shoe-sole_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\shoe-sole_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\shoe-sole_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\shoe-sole_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "roughnessMap": {"type": "constant", "value": 0.66, "independent": true, "notes": "The reference is a uniformly matte clay render: roughness carries no spatial variation, so a constant is the honest map rather than a fabricated texture. Explicitly independent of albedo."}},
    options
  );
  materialMap["eye-ink"] = createSculptMaterial(
    "eye-ink",
    {"id": "eye-ink", "name": "Eye ink", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#1a1c22", "color": "#1a1c22", "albedo": {"dominant": "#1a1c22", "secondary": ["#23272C", "#202429", "#2E3238"], "samplingNotes": "Base colour is the recorded flat-lit median. Keeps the recorded #1a1c22. The extractor de-lights this 20 px crop to #272B31 and the raw pixel at the pupil centre is #24272C, so the shipped ink is about 0.05 luminance darker than measured. That is a legibility choice for a dot eye seen at game scale, and it is recorded here rather than presented as a measurement.", "map": null}, "colorVariation": {"palette": ["#1a1c22", "#181a20", "#1b1d24"], "pattern": "flat albedo with a low-amplitude tonal drift; the reference shows almost no albedo variance within a part", "amplitude": 0.05, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part. The figure is a smooth clay render with no repeating pattern, so detail stays at object scale and never stretches with component scale or tiles visibly."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.329, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.201, "role": "reference-derived moulding flow and seam relief"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.084, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.685, "variation": 0.05, "map": "independent-procedural-field", "localResponse": "cavities and part intersections trend rougher; crowns catching the key trend slightly smoother", "evidence": "roughness.base is the extractor's measured estimate for this material's own crop. Across all seven surfaces the extractor spans only 0.680-0.714, so roughness carries almost no identity in this reference; the figure is uniformly matte clay. The previous hand-set 0.55-0.78 spread was not measured and has been replaced."}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.17, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.28, "contactShadowBias": 0.35, "map": "independent-procedural-field", "notes": "Darken where parts meet: under the hair fringe, under the chin, along the strap channels, at the sleeve cuff and where the sole meets the upper. Independent of albedo."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["MeshPhysicalMaterial with clearcoat, transmission and sheen at zero: the reference is matte clay with no specular coat.", "Albedo, roughness, height, normal and AO are five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the fields are stable across reloads.", "roughness.base is the extractor's measured estimate for this material's own crop. Across all seven surfaces the extractor spans only 0.680-0.714, so roughness carries almost no identity in this reference; the figure is uniformly matte clay. The previous hand-set 0.55-0.78 spread was not measured and has been replaced."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\crops\\eye-ink-crop.png", "sourceCropBoxPx": [463, 362, 483, 382], "sourceCropRegion": "left eye dot, inside the ink rim", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.741, "estimatedFidelity": 0.741, "targetThreshold": 0.7, "extractorPalette": ["#272B31", "#23272C", "#202429", "#2E3238", "#45484D"], "extractorWarnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped", "low value range weakens height/roughness inference"], "measuredStats": {"valueRange": 0.1412, "heightP90Gradient": 0.01211, "roughnessBase": 0.685, "roughnessVariation": 0.05, "normalStrength": 0.17, "blurRadius": 21}, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction ran on a per-material crop and its numbers are recorded verbatim, but the extracted maps are NOT bound to the runtime material and referencePbr.usable is false. Three reasons, in order of weight. (1) Inspecting the generated maps shows the albedo is a flat colour carrying the reference's own lighting falloff, the height/normal/roughness channels are the render's compression grain upsampled from a small crop, and the AO channel is essentially white; tiling them would paint the reference's shading and its codec noise onto every surface. (2) The factory's referenceMapUrl() loads these maps by absolute disk path, which cannot resolve in a browser, so usable:true would break the runtime. (3) Thirty-five 1024px PNGs is not a viable budget for a player character in a web game. The runtime instead builds five independent procedural canvas fields per material, and the extracted palettes and roughness estimates are used as evidence for the scalars.", "albedoDecision": "Keeps the recorded #1a1c22. The extractor de-lights this 20 px crop to #272B31 and the raw pixel at the pupil centre is #24272C, so the shipped ink is about 0.05 luminance darker than measured. That is a legibility choice for a dot eye seen at game scale, and it is recorded here rather than presented as a measurement.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\eye-ink_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\eye-ink_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\eye-ink_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\eye-ink_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\character\\evidence\\pbr\\eye-ink_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "roughnessMap": {"type": "constant", "value": 0.55, "independent": true, "notes": "The reference is a uniformly matte clay render: roughness carries no spatial variation, so a constant is the honest map rather than a fabricated texture. Explicitly independent of albedo."}},
    options
  );
  materialMap["hidden"] = createSculptMaterial(
    "hidden",
    {"id": "hidden", "name": "Non-rendering group", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#000000", "color": "#000000", "albedo": {"dominant": "#000000", "secondary": [], "samplingNotes": "transform-only node; never rasterised"}, "colorVariation": {"palette": ["#000000"], "pattern": "none", "amplitude": 0.0}, "roughness": 1.0, "metalness": 0.0, "visible": false, "qualityTier": "utility", "opacity": {"base": 0.0}, "alpha": {"cutoff": 0.5}, "notes": "Transform-only node material for the four grouping nodes. The factory emits a mesh for every component including pure transform groups and does not read a 'visible' flag, so the group boxes are made invisible with opacity 0 plus an alpha cutoff; the cutoff is what also keeps them out of the shadow pass."},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const attachment_root_0 = null;
  const endpoint_root_0 = makeAttachmentEndpoint(attachment_root_0);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "Runner (root)__pivot";
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0, 0, 0);
    node_root_0.scale.set(1, 1, 1);
  } else {
    node_root_0.position.set(0.0, 0.0, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
    node_root_0.scale.set(1.0, 1.0, 1.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Runner (root)", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.8, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Character (root) is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "tubePath": {"points": [[0, -0.001, 0], [0, 0.001, 0]], "radius": 0.001, "radialSegments": 3, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 0.94, "height": 1.9, "depth": 0.4, "units": "world", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(0, 0, 0, 1.0)", "secondaryAlbedo": "rgba(0, 0, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_root_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 20, 3)
    : buildTubeGeometry({"points": [[0, -0.001, 0], [0, 0.001, 0]], "radius": 0.001, "radialSegments": 3, "closed": false});
  const mesh_root_0 = new THREE.Mesh(
    mesh_root_0Geometry,
    materialMap["hidden"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "Runner (root)";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Runner (root)", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.8, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Character (root) is a discrete primitive body part assembled onto the humanoid rig, not a continuous sculpt or shell.", "geometryDescriptor": {"topologyIntent": "stylized character part", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "tubePath": {"points": [[0, -0.001, 0], [0, 0.001, 0]], "radius": 0.001, "radialSegments": 3, "closed": false}}, "parent": null, "attachment": null, "dimensions": {"width": 0.94, "height": 1.9, "depth": 0.4, "units": "world", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(0, 0, 0, 1.0)", "secondaryAlbedo": "rgba(0, 0, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_root_0);

  const attachment_head_group_1 = {"parentId": "root", "parentSocket": "root-spine-top", "localStart": [0, 1.56, 0], "localEnd": [0, 1.56, 0], "contactType": "fused", "embedDepth": 0.045, "gapTolerance": 0.004, "notes": "Head mass. Spans the crown at y=1.898 down to the neck pinch at y=1.279, one head unit of 0.619u. Overlap is the neck embed into the jaw.", "evidenceRefs": ["full-object"]};
  const endpoint_head_group_1 = makeAttachmentEndpoint(attachment_head_group_1);
  const node_head_group_1 = new THREE.Group();
  node_head_group_1.name = "Head mass__pivot";
  if (endpoint_head_group_1) {
    node_head_group_1.position.copy(endpoint_head_group_1.start);
    node_head_group_1.rotation.set(0, 0, 0);
    node_head_group_1.scale.set(1, 1, 1);
  } else {
    node_head_group_1.position.set(0.0, 1.56, 0.0);
    node_head_group_1.rotation.set(0.0, 0.0, 0.0);
    node_head_group_1.scale.set(1.0, 1.0, 1.0);
  }
  node_head_group_1.userData.sculptComponent = {"id": "head-group", "name": "Head mass", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.9, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Head mass is a transform group over the parts that move together.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "tubePath": {"points": [[0, -0.001, 0], [0, 0.001, 0]], "radius": 0.001, "radialSegments": 3, "closed": false}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-spine-top", "localStart": [0, 1.56, 0], "localEnd": [0, 1.56, 0], "contactType": "fused", "embedDepth": 0.045, "gapTolerance": 0.004, "notes": "Head mass. Spans the crown at y=1.898 down to the neck pinch at y=1.279, one head unit of 0.619u. Overlap is the neck embed into the jaw.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.733, "height": 0.62, "depth": 0.6, "units": "world", "confidence": 0.9}, "transform": {"position": [0, 1.56, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(0, 0, 0, 1.0)", "secondaryAlbedo": "rgba(0, 0, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_head_group_1.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["root"] ?? root).add(node_head_group_1);
  nodes["head-group"] = node_head_group_1;
  const mesh_head_group_1Geometry = endpoint_head_group_1
    ? new THREE.CylinderGeometry(endpoint_head_group_1.endRadius, endpoint_head_group_1.baseRadius, endpoint_head_group_1.length, 20, 3)
    : buildTubeGeometry({"points": [[0, -0.001, 0], [0, 0.001, 0]], "radius": 0.001, "radialSegments": 3, "closed": false});
  const mesh_head_group_1 = new THREE.Mesh(
    mesh_head_group_1Geometry,
    materialMap["hidden"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_head_group_1.name = "Head mass";
  if (endpoint_head_group_1) {
    mesh_head_group_1.position.copy(endpoint_head_group_1.midpoint);
    mesh_head_group_1.quaternion.copy(endpoint_head_group_1.quaternion);
  }
  mesh_head_group_1.castShadow = options.castShadow ?? true;
  mesh_head_group_1.receiveShadow = options.receiveShadow ?? true;
  mesh_head_group_1.userData.sculptComponent = {"id": "head-group", "name": "Head mass", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.9, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Head mass is a transform group over the parts that move together.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "tubePath": {"points": [[0, -0.001, 0], [0, 0.001, 0]], "radius": 0.001, "radialSegments": 3, "closed": false}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-spine-top", "localStart": [0, 1.56, 0], "localEnd": [0, 1.56, 0], "contactType": "fused", "embedDepth": 0.045, "gapTolerance": 0.004, "notes": "Head mass. Spans the crown at y=1.898 down to the neck pinch at y=1.279, one head unit of 0.619u. Overlap is the neck embed into the jaw.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.733, "height": 0.62, "depth": 0.6, "units": "world", "confidence": 0.9}, "transform": {"position": [0, 1.56, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(0, 0, 0, 1.0)", "secondaryAlbedo": "rgba(0, 0, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_head_group_1.add(mesh_head_group_1);
  meshes["head-group"] = mesh_head_group_1;
  colliders["head-group"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["neck"] ??= [];
  destructionGroups["neck"].push(node_head_group_1);

  const attachment_body_group_2 = {"parentId": "root", "parentSocket": "root-spine", "localStart": [0, 0.95, 0], "localEnd": [0, 0.95, 0], "contactType": "fused", "embedDepth": 0.06, "gapTolerance": 0.004, "notes": "Body mass. Spans the shirt collar at y=1.250 down to the hem at y=0.660, widest at y=0.948 as measured. Overlap is the hem over the hip.", "evidenceRefs": ["full-object"]};
  const endpoint_body_group_2 = makeAttachmentEndpoint(attachment_body_group_2);
  const node_body_group_2 = new THREE.Group();
  node_body_group_2.name = "Body mass__pivot";
  if (endpoint_body_group_2) {
    node_body_group_2.position.copy(endpoint_body_group_2.start);
    node_body_group_2.rotation.set(0, 0, 0);
    node_body_group_2.scale.set(1, 1, 1);
  } else {
    node_body_group_2.position.set(0.0, 0.95, 0.0);
    node_body_group_2.rotation.set(0.0, 0.0, 0.0);
    node_body_group_2.scale.set(1.0, 1.0, 1.0);
  }
  node_body_group_2.userData.sculptComponent = {"id": "body-group", "name": "Body mass", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.9, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Body mass is a transform group over the parts that move together.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "tubePath": {"points": [[0, -0.001, 0], [0, 0.001, 0]], "radius": 0.001, "radialSegments": 3, "closed": false}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-spine", "localStart": [0, 0.95, 0], "localEnd": [0, 0.95, 0], "contactType": "fused", "embedDepth": 0.06, "gapTolerance": 0.004, "notes": "Body mass. Spans the shirt collar at y=1.250 down to the hem at y=0.660, widest at y=0.948 as measured. Overlap is the hem over the hip.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.524, "height": 0.59, "depth": 0.44, "units": "world", "confidence": 0.9}, "transform": {"position": [0, 0.95, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(0, 0, 0, 1.0)", "secondaryAlbedo": "rgba(0, 0, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_body_group_2.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["root"] ?? root).add(node_body_group_2);
  nodes["body-group"] = node_body_group_2;
  const mesh_body_group_2Geometry = endpoint_body_group_2
    ? new THREE.CylinderGeometry(endpoint_body_group_2.endRadius, endpoint_body_group_2.baseRadius, endpoint_body_group_2.length, 20, 3)
    : buildTubeGeometry({"points": [[0, -0.001, 0], [0, 0.001, 0]], "radius": 0.001, "radialSegments": 3, "closed": false});
  const mesh_body_group_2 = new THREE.Mesh(
    mesh_body_group_2Geometry,
    materialMap["hidden"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_body_group_2.name = "Body mass";
  if (endpoint_body_group_2) {
    mesh_body_group_2.position.copy(endpoint_body_group_2.midpoint);
    mesh_body_group_2.quaternion.copy(endpoint_body_group_2.quaternion);
  }
  mesh_body_group_2.castShadow = options.castShadow ?? true;
  mesh_body_group_2.receiveShadow = options.receiveShadow ?? true;
  mesh_body_group_2.userData.sculptComponent = {"id": "body-group", "name": "Body mass", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.9, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Body mass is a transform group over the parts that move together.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "tubePath": {"points": [[0, -0.001, 0], [0, 0.001, 0]], "radius": 0.001, "radialSegments": 3, "closed": false}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-spine", "localStart": [0, 0.95, 0], "localEnd": [0, 0.95, 0], "contactType": "fused", "embedDepth": 0.06, "gapTolerance": 0.004, "notes": "Body mass. Spans the shirt collar at y=1.250 down to the hem at y=0.660, widest at y=0.948 as measured. Overlap is the hem over the hip.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.524, "height": 0.59, "depth": 0.44, "units": "world", "confidence": 0.9}, "transform": {"position": [0, 0.95, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(0, 0, 0, 1.0)", "secondaryAlbedo": "rgba(0, 0, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_body_group_2.add(mesh_body_group_2);
  meshes["body-group"] = mesh_body_group_2;
  colliders["body-group"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["neck"] ??= [];
  destructionGroups["neck"].push(node_body_group_2);

  const attachment_legs_group_3 = {"parentId": "root", "parentSocket": "root-hips", "localStart": [0, 0.66, 0], "localEnd": [0, 0.66, 0], "contactType": "fused", "embedDepth": 0.06, "gapTolerance": 0.004, "notes": "Leg mass. Spans the hip at y=0.660 down to the ground at y=0.000. Overlap is the hip into the shirt hem.", "evidenceRefs": ["full-object"]};
  const endpoint_legs_group_3 = makeAttachmentEndpoint(attachment_legs_group_3);
  const node_legs_group_3 = new THREE.Group();
  node_legs_group_3.name = "Leg mass__pivot";
  if (endpoint_legs_group_3) {
    node_legs_group_3.position.copy(endpoint_legs_group_3.start);
    node_legs_group_3.rotation.set(0, 0, 0);
    node_legs_group_3.scale.set(1, 1, 1);
  } else {
    node_legs_group_3.position.set(0.0, 0.66, 0.0);
    node_legs_group_3.rotation.set(0.0, 0.0, 0.0);
    node_legs_group_3.scale.set(1.0, 1.0, 1.0);
  }
  node_legs_group_3.userData.sculptComponent = {"id": "legs-group", "name": "Leg mass", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.9, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Leg mass is a transform group over the parts that move together.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "tubePath": {"points": [[0, -0.001, 0], [0, 0.001, 0]], "radius": 0.001, "radialSegments": 3, "closed": false}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-hips", "localStart": [0, 0.66, 0], "localEnd": [0, 0.66, 0], "contactType": "fused", "embedDepth": 0.06, "gapTolerance": 0.004, "notes": "Leg mass. Spans the hip at y=0.660 down to the ground at y=0.000. Overlap is the hip into the shirt hem.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.564, "height": 0.66, "depth": 0.32, "units": "world", "confidence": 0.9}, "transform": {"position": [0, 0.66, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(0, 0, 0, 1.0)", "secondaryAlbedo": "rgba(0, 0, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_legs_group_3.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["root"] ?? root).add(node_legs_group_3);
  nodes["legs-group"] = node_legs_group_3;
  const mesh_legs_group_3Geometry = endpoint_legs_group_3
    ? new THREE.CylinderGeometry(endpoint_legs_group_3.endRadius, endpoint_legs_group_3.baseRadius, endpoint_legs_group_3.length, 20, 3)
    : buildTubeGeometry({"points": [[0, -0.001, 0], [0, 0.001, 0]], "radius": 0.001, "radialSegments": 3, "closed": false});
  const mesh_legs_group_3 = new THREE.Mesh(
    mesh_legs_group_3Geometry,
    materialMap["hidden"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_legs_group_3.name = "Leg mass";
  if (endpoint_legs_group_3) {
    mesh_legs_group_3.position.copy(endpoint_legs_group_3.midpoint);
    mesh_legs_group_3.quaternion.copy(endpoint_legs_group_3.quaternion);
  }
  mesh_legs_group_3.castShadow = options.castShadow ?? true;
  mesh_legs_group_3.receiveShadow = options.receiveShadow ?? true;
  mesh_legs_group_3.userData.sculptComponent = {"id": "legs-group", "name": "Leg mass", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.9, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Leg mass is a transform group over the parts that move together.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "tubePath": {"points": [[0, -0.001, 0], [0, 0.001, 0]], "radius": 0.001, "radialSegments": 3, "closed": false}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-hips", "localStart": [0, 0.66, 0], "localEnd": [0, 0.66, 0], "contactType": "fused", "embedDepth": 0.06, "gapTolerance": 0.004, "notes": "Leg mass. Spans the hip at y=0.660 down to the ground at y=0.000. Overlap is the hip into the shirt hem.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.564, "height": 0.66, "depth": 0.32, "units": "world", "confidence": 0.9}, "transform": {"position": [0, 0.66, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(0, 0, 0, 1.0)", "secondaryAlbedo": "rgba(0, 0, 0, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_legs_group_3.add(mesh_legs_group_3);
  meshes["legs-group"] = mesh_legs_group_3;
  colliders["legs-group"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["neck"] ??= [];
  destructionGroups["neck"].push(node_legs_group_3);

  const attachment_torso_4 = null;
  const endpoint_torso_4 = makeAttachmentEndpoint(attachment_torso_4);
  const node_torso_4 = new THREE.Group();
  node_torso_4.name = "Torso__pivot";
  if (endpoint_torso_4) {
    node_torso_4.position.copy(endpoint_torso_4.start);
    node_torso_4.rotation.set(0, 0, 0);
    node_torso_4.scale.set(1, 1, 1);
  } else {
    node_torso_4.position.set(0.0, 0.0, 0.0);
    node_torso_4.rotation.set(0.0, 0.0, 0.0);
    node_torso_4.scale.set(1.0, 1.0, 0.8);
  }
  node_torso_4.userData.sculptComponent = {"id": "torso", "name": "Torso", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.85, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Torso is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.001, -0.318], [0.1518, -0.3046], [0.1857, -0.2912], [0.194, -0.2778], [0.1978, -0.2644], [0.2002, -0.251], [0.2028, -0.2376], [0.2071, -0.2242], [0.2126, -0.2108], [0.2185, -0.1974], [0.2242, -0.184], [0.2291, -0.1706], [0.233, -0.1573], [0.2363, -0.1439], [0.2393, -0.1305], [0.2422, -0.1171], [0.2465, -0.1037], [0.2525, -0.0903], [0.2572, -0.0769], [0.2594, -0.0635], [0.261, -0.0501], [0.2618, -0.0367], [0.2619, -0.0233], [0.2608, -0.0099], [0.259, 0.0035], [0.2574, 0.0169], [0.2561, 0.0303], [0.2546, 0.0437], [0.2531, 0.0571], [0.2513, 0.0705], [0.2494, 0.0839], [0.2474, 0.0973], [0.2452, 0.1107], [0.2429, 0.1241], [0.2404, 0.1375], [0.2378, 0.1509], [0.2348, 0.1643], [0.2315, 0.1776], [0.2281, 0.191], [0.2247, 0.2044], [0.221, 0.2178], [0.2163, 0.2312], [0.2115, 0.2446], [0.2065, 0.258], [0.1989, 0.2714], [0.1897, 0.2848], [0.176, 0.2982], [0.1487, 0.3116], [0.001, 0.325]], "segments": 48}}, "parent": "body-group", "attachment": null, "dimensions": {"width": 0.524, "height": 0.618, "depth": 0.42, "units": "world", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 0.8]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "torso-purple", "materialLayers": ["torso-purple"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["pear profile: 0.300u across at the shoulder, widening to 0.524u at the belly (y=0.948) and tucking back to 0.376u at the hem", "widest row reproduces anatomy.json landmarkFraction torsoWidest = 0.501"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "torso-region"], "details": ["pear profile: 0.227u across at the shoulder widening to 0.356u at the hem"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(142, 103, 216, 1.0)", "secondaryAlbedo": "rgba(125, 91, 190, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9}};
  node_torso_4.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["body-group"] ?? root).add(node_torso_4);
  nodes["torso"] = node_torso_4;
  const mesh_torso_4Geometry = endpoint_torso_4
    ? new THREE.CylinderGeometry(endpoint_torso_4.endRadius, endpoint_torso_4.baseRadius, endpoint_torso_4.length, 20, 3)
    : buildLatheGeometry({"points": [[0.001, -0.318], [0.1518, -0.3046], [0.1857, -0.2912], [0.194, -0.2778], [0.1978, -0.2644], [0.2002, -0.251], [0.2028, -0.2376], [0.2071, -0.2242], [0.2126, -0.2108], [0.2185, -0.1974], [0.2242, -0.184], [0.2291, -0.1706], [0.233, -0.1573], [0.2363, -0.1439], [0.2393, -0.1305], [0.2422, -0.1171], [0.2465, -0.1037], [0.2525, -0.0903], [0.2572, -0.0769], [0.2594, -0.0635], [0.261, -0.0501], [0.2618, -0.0367], [0.2619, -0.0233], [0.2608, -0.0099], [0.259, 0.0035], [0.2574, 0.0169], [0.2561, 0.0303], [0.2546, 0.0437], [0.2531, 0.0571], [0.2513, 0.0705], [0.2494, 0.0839], [0.2474, 0.0973], [0.2452, 0.1107], [0.2429, 0.1241], [0.2404, 0.1375], [0.2378, 0.1509], [0.2348, 0.1643], [0.2315, 0.1776], [0.2281, 0.191], [0.2247, 0.2044], [0.221, 0.2178], [0.2163, 0.2312], [0.2115, 0.2446], [0.2065, 0.258], [0.1989, 0.2714], [0.1897, 0.2848], [0.176, 0.2982], [0.1487, 0.3116], [0.001, 0.325]], "segments": 48});
  const mesh_torso_4 = new THREE.Mesh(
    mesh_torso_4Geometry,
    materialMap["torso-purple"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_torso_4.name = "Torso";
  if (endpoint_torso_4) {
    mesh_torso_4.position.copy(endpoint_torso_4.midpoint);
    mesh_torso_4.quaternion.copy(endpoint_torso_4.quaternion);
  }
  mesh_torso_4.castShadow = options.castShadow ?? true;
  mesh_torso_4.receiveShadow = options.receiveShadow ?? true;
  mesh_torso_4.userData.sculptComponent = {"id": "torso", "name": "Torso", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.85, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Torso is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.001, -0.318], [0.1518, -0.3046], [0.1857, -0.2912], [0.194, -0.2778], [0.1978, -0.2644], [0.2002, -0.251], [0.2028, -0.2376], [0.2071, -0.2242], [0.2126, -0.2108], [0.2185, -0.1974], [0.2242, -0.184], [0.2291, -0.1706], [0.233, -0.1573], [0.2363, -0.1439], [0.2393, -0.1305], [0.2422, -0.1171], [0.2465, -0.1037], [0.2525, -0.0903], [0.2572, -0.0769], [0.2594, -0.0635], [0.261, -0.0501], [0.2618, -0.0367], [0.2619, -0.0233], [0.2608, -0.0099], [0.259, 0.0035], [0.2574, 0.0169], [0.2561, 0.0303], [0.2546, 0.0437], [0.2531, 0.0571], [0.2513, 0.0705], [0.2494, 0.0839], [0.2474, 0.0973], [0.2452, 0.1107], [0.2429, 0.1241], [0.2404, 0.1375], [0.2378, 0.1509], [0.2348, 0.1643], [0.2315, 0.1776], [0.2281, 0.191], [0.2247, 0.2044], [0.221, 0.2178], [0.2163, 0.2312], [0.2115, 0.2446], [0.2065, 0.258], [0.1989, 0.2714], [0.1897, 0.2848], [0.176, 0.2982], [0.1487, 0.3116], [0.001, 0.325]], "segments": 48}}, "parent": "body-group", "attachment": null, "dimensions": {"width": 0.524, "height": 0.618, "depth": 0.42, "units": "world", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 0.8]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "torso-purple", "materialLayers": ["torso-purple"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["pear profile: 0.300u across at the shoulder, widening to 0.524u at the belly (y=0.948) and tucking back to 0.376u at the hem", "widest row reproduces anatomy.json landmarkFraction torsoWidest = 0.501"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "torso-region"], "details": ["pear profile: 0.227u across at the shoulder widening to 0.356u at the hem"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(142, 103, 216, 1.0)", "secondaryAlbedo": "rgba(125, 91, 190, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9}};
  node_torso_4.add(mesh_torso_4);
  meshes["torso"] = mesh_torso_4;
  colliders["torso"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["neck"] ??= [];
  destructionGroups["neck"].push(node_torso_4);

  const attachment_neck_5 = {"parentId": "body-group", "parentSocket": "torso-shoulder-line", "localStart": [0, 0.285, 0], "localEnd": [0, 0.44, 0], "contactType": "socket", "embedDepth": 0.045, "gapTolerance": 0.004, "baseRadius": 0.14, "endRadius": 0.135, "notes": "Neck runs from the shirt collar at y=1.235 up into the jaw at y=1.390; both ends are embedded.", "evidenceRefs": ["full-object"]};
  const endpoint_neck_5 = makeAttachmentEndpoint(attachment_neck_5);
  const node_neck_5 = new THREE.Group();
  node_neck_5.name = "Neck__pivot";
  if (endpoint_neck_5) {
    node_neck_5.position.copy(endpoint_neck_5.start);
    node_neck_5.rotation.set(0, 0, 0);
    node_neck_5.scale.set(1, 1, 1);
  } else {
    node_neck_5.position.set(0.0, 0.36, 0.0);
    node_neck_5.rotation.set(0.0, 0.0, 0.0);
    node_neck_5.scale.set(0.28, 0.155, 0.28);
  }
  node_neck_5.userData.sculptComponent = {"id": "neck", "name": "Neck", "level": "meso", "role": "support", "importance": 0.6, "confidence": 0.85, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Neck is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "body-group", "attachment": {"parentId": "body-group", "parentSocket": "torso-shoulder-line", "localStart": [0, 0.285, 0], "localEnd": [0, 0.44, 0], "contactType": "socket", "embedDepth": 0.045, "gapTolerance": 0.004, "baseRadius": 0.14, "endRadius": 0.135, "notes": "Neck runs from the shirt collar at y=1.235 up into the jaw at y=1.390; both ends are embedded.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.28, "height": 0.155, "depth": 0.28, "units": "world", "confidence": 0.85}, "transform": {"position": [0, 0.36, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "head-region"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(251, 223, 180, 1.0)", "secondaryAlbedo": "rgba(221, 196, 158, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_neck_5.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["body-group"] ?? root).add(node_neck_5);
  nodes["neck"] = node_neck_5;
  const mesh_neck_5Geometry = endpoint_neck_5
    ? new THREE.CylinderGeometry(endpoint_neck_5.endRadius, endpoint_neck_5.baseRadius, endpoint_neck_5.length, 20, 3)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 20, 4);
  const mesh_neck_5 = new THREE.Mesh(
    mesh_neck_5Geometry,
    materialMap["skin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_neck_5.name = "Neck";
  if (endpoint_neck_5) {
    mesh_neck_5.position.copy(endpoint_neck_5.midpoint);
    mesh_neck_5.quaternion.copy(endpoint_neck_5.quaternion);
  }
  mesh_neck_5.castShadow = options.castShadow ?? true;
  mesh_neck_5.receiveShadow = options.receiveShadow ?? true;
  mesh_neck_5.userData.sculptComponent = {"id": "neck", "name": "Neck", "level": "meso", "role": "support", "importance": 0.6, "confidence": 0.85, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Neck is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "body-group", "attachment": {"parentId": "body-group", "parentSocket": "torso-shoulder-line", "localStart": [0, 0.285, 0], "localEnd": [0, 0.44, 0], "contactType": "socket", "embedDepth": 0.045, "gapTolerance": 0.004, "baseRadius": 0.14, "endRadius": 0.135, "notes": "Neck runs from the shirt collar at y=1.235 up into the jaw at y=1.390; both ends are embedded.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.28, "height": 0.155, "depth": 0.28, "units": "world", "confidence": 0.85}, "transform": {"position": [0, 0.36, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "head-region"], "details": [], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(251, 223, 180, 1.0)", "secondaryAlbedo": "rgba(221, 196, 158, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_neck_5.add(mesh_neck_5);
  meshes["neck"] = mesh_neck_5;
  colliders["neck"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["neck"] ??= [];
  destructionGroups["neck"].push(node_neck_5);

  const attachment_head_6 = null;
  const endpoint_head_6 = makeAttachmentEndpoint(attachment_head_6);
  const node_head_6 = new THREE.Group();
  node_head_6.name = "Head__pivot";
  if (endpoint_head_6) {
    node_head_6.position.copy(endpoint_head_6.start);
    node_head_6.rotation.set(0, 0, 0);
    node_head_6.scale.set(1, 1, 1);
  } else {
    node_head_6.position.set(0.0, 0.0, 0.0);
    node_head_6.rotation.set(0.0, 0.0, 0.0);
    node_head_6.scale.set(0.65, 0.65, 0.62);
  }
  node_head_6.userData.sculptComponent = {"id": "head", "name": "Head", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.85, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Head is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head-group", "attachment": null, "dimensions": {"width": 0.65, "height": 0.65, "depth": 0.62, "units": "world", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "look", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["near-spherical; 1.18x wider than the head unit once ears are counted"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "head-region"], "details": ["near-spherical; 1.18x wider than the head unit once ears are counted"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(251, 223, 180, 1.0)", "secondaryAlbedo": "rgba(221, 196, 158, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_head_6.userData.actionProfile = {"animationRole": "look", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["head-group"] ?? root).add(node_head_6);
  nodes["head"] = node_head_6;
  const mesh_head_6Geometry = endpoint_head_6
    ? new THREE.CylinderGeometry(endpoint_head_6.endRadius, endpoint_head_6.baseRadius, endpoint_head_6.length, 20, 3)
    : new THREE.SphereGeometry(0.5, 24, 16);
  const mesh_head_6 = new THREE.Mesh(
    mesh_head_6Geometry,
    materialMap["skin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_head_6.name = "Head";
  if (endpoint_head_6) {
    mesh_head_6.position.copy(endpoint_head_6.midpoint);
    mesh_head_6.quaternion.copy(endpoint_head_6.quaternion);
  }
  mesh_head_6.castShadow = options.castShadow ?? true;
  mesh_head_6.receiveShadow = options.receiveShadow ?? true;
  mesh_head_6.userData.sculptComponent = {"id": "head", "name": "Head", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.85, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Head is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head-group", "attachment": null, "dimensions": {"width": 0.65, "height": 0.65, "depth": 0.62, "units": "world", "confidence": 0.9}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "look", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["near-spherical; 1.18x wider than the head unit once ears are counted"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "head-region"], "details": ["near-spherical; 1.18x wider than the head unit once ears are counted"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(251, 223, 180, 1.0)", "secondaryAlbedo": "rgba(221, 196, 158, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_head_6.add(mesh_head_6);
  meshes["head"] = mesh_head_6;
  colliders["head"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["neck"] ??= [];
  destructionGroups["neck"].push(node_head_6);

  const attachment_hair_cap_7 = null;
  const endpoint_hair_cap_7 = makeAttachmentEndpoint(attachment_hair_cap_7);
  const node_hair_cap_7 = new THREE.Group();
  node_hair_cap_7.name = "Hair cap__pivot";
  if (endpoint_hair_cap_7) {
    node_hair_cap_7.position.copy(endpoint_hair_cap_7.start);
    node_hair_cap_7.rotation.set(0, 0, 0);
    node_hair_cap_7.scale.set(1, 1, 1);
  } else {
    node_hair_cap_7.position.set(0.0, 0.103, -0.012);
    node_hair_cap_7.rotation.set(0.0, 0.0, 0.0);
    node_hair_cap_7.scale.set(0.69, 0.47, 0.68);
  }
  node_hair_cap_7.userData.sculptComponent = {"id": "hair-cap", "name": "Hair cap", "level": "meso", "role": "detail", "importance": 0.6, "confidence": 0.85, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Hair cap is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head-group", "attachment": null, "dimensions": {"width": 0.69, "height": 0.47, "depth": 0.68, "units": "world", "confidence": 0.8}, "transform": {"position": [0, 0.103, -0.012], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "hair-ink", "materialLayers": ["hair-ink"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["covers the crown down to just above the eye line", "centre fringe dips lower on the wearer's right", "sideburn tabs descend in front of each ear"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "head-region"], "details": ["covers the crown down to just above the eye line", "centre fringe dips lower on the wearer's right", "sideburn tabs descend in front of each ear"], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(49, 58, 81, 1.0)", "secondaryAlbedo": "rgba(43, 51, 71, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_hair_cap_7.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["head-group"] ?? root).add(node_hair_cap_7);
  nodes["hair-cap"] = node_hair_cap_7;
  const mesh_hair_cap_7Geometry = endpoint_hair_cap_7
    ? new THREE.CylinderGeometry(endpoint_hair_cap_7.endRadius, endpoint_hair_cap_7.baseRadius, endpoint_hair_cap_7.length, 20, 3)
    : new THREE.SphereGeometry(0.5, 24, 16);
  const mesh_hair_cap_7 = new THREE.Mesh(
    mesh_hair_cap_7Geometry,
    materialMap["hair-ink"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hair_cap_7.name = "Hair cap";
  if (endpoint_hair_cap_7) {
    mesh_hair_cap_7.position.copy(endpoint_hair_cap_7.midpoint);
    mesh_hair_cap_7.quaternion.copy(endpoint_hair_cap_7.quaternion);
  }
  mesh_hair_cap_7.castShadow = options.castShadow ?? true;
  mesh_hair_cap_7.receiveShadow = options.receiveShadow ?? true;
  mesh_hair_cap_7.userData.sculptComponent = {"id": "hair-cap", "name": "Hair cap", "level": "meso", "role": "detail", "importance": 0.6, "confidence": 0.85, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Hair cap is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head-group", "attachment": null, "dimensions": {"width": 0.69, "height": 0.47, "depth": 0.68, "units": "world", "confidence": 0.8}, "transform": {"position": [0, 0.103, -0.012], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "hair-ink", "materialLayers": ["hair-ink"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["covers the crown down to just above the eye line", "centre fringe dips lower on the wearer's right", "sideburn tabs descend in front of each ear"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "head-region"], "details": ["covers the crown down to just above the eye line", "centre fringe dips lower on the wearer's right", "sideburn tabs descend in front of each ear"], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(49, 58, 81, 1.0)", "secondaryAlbedo": "rgba(43, 51, 71, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_hair_cap_7.add(mesh_hair_cap_7);
  meshes["hair-cap"] = mesh_hair_cap_7;
  colliders["hair-cap"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["neck"] ??= [];
  destructionGroups["neck"].push(node_hair_cap_7);

  const attachment_ear_l_8 = null;
  const endpoint_ear_l_8 = makeAttachmentEndpoint(attachment_ear_l_8);
  const node_ear_l_8 = new THREE.Group();
  node_ear_l_8.name = "Ear left__pivot";
  if (endpoint_ear_l_8) {
    node_ear_l_8.position.copy(endpoint_ear_l_8.start);
    node_ear_l_8.rotation.set(0, 0, 0);
    node_ear_l_8.scale.set(1, 1, 1);
  } else {
    node_ear_l_8.position.set(-0.33, -0.082, -0.01);
    node_ear_l_8.rotation.set(0.0, 0.0, 0.0);
    node_ear_l_8.scale.set(0.078, 0.12, 0.062);
  }
  node_ear_l_8.userData.sculptComponent = {"id": "ear-l", "name": "Ear left", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.85, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Ear left is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head-group", "attachment": null, "dimensions": {"width": 0.078, "height": 0.12, "depth": 0.062, "units": "world", "confidence": 0.75}, "transform": {"position": [-0.33, -0.082, -0.01], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["set at the eye line, projecting laterally"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "head-region"], "details": ["set at the eye line, projecting laterally"], "fidelityTier": "feature-placement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(251, 223, 180, 1.0)", "secondaryAlbedo": "rgba(221, 196, 158, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_ear_l_8.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["head-group"] ?? root).add(node_ear_l_8);
  nodes["ear-l"] = node_ear_l_8;
  const mesh_ear_l_8Geometry = endpoint_ear_l_8
    ? new THREE.CylinderGeometry(endpoint_ear_l_8.endRadius, endpoint_ear_l_8.baseRadius, endpoint_ear_l_8.length, 20, 3)
    : new THREE.SphereGeometry(0.5, 24, 16);
  const mesh_ear_l_8 = new THREE.Mesh(
    mesh_ear_l_8Geometry,
    materialMap["skin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_ear_l_8.name = "Ear left";
  if (endpoint_ear_l_8) {
    mesh_ear_l_8.position.copy(endpoint_ear_l_8.midpoint);
    mesh_ear_l_8.quaternion.copy(endpoint_ear_l_8.quaternion);
  }
  mesh_ear_l_8.castShadow = options.castShadow ?? true;
  mesh_ear_l_8.receiveShadow = options.receiveShadow ?? true;
  mesh_ear_l_8.userData.sculptComponent = {"id": "ear-l", "name": "Ear left", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.85, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Ear left is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head-group", "attachment": null, "dimensions": {"width": 0.078, "height": 0.12, "depth": 0.062, "units": "world", "confidence": 0.75}, "transform": {"position": [-0.33, -0.082, -0.01], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["set at the eye line, projecting laterally"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "head-region"], "details": ["set at the eye line, projecting laterally"], "fidelityTier": "feature-placement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(251, 223, 180, 1.0)", "secondaryAlbedo": "rgba(221, 196, 158, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_ear_l_8.add(mesh_ear_l_8);
  meshes["ear-l"] = mesh_ear_l_8;
  colliders["ear-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["neck"] ??= [];
  destructionGroups["neck"].push(node_ear_l_8);

  const attachment_ear_r_9 = null;
  const endpoint_ear_r_9 = makeAttachmentEndpoint(attachment_ear_r_9);
  const node_ear_r_9 = new THREE.Group();
  node_ear_r_9.name = "Ear right__pivot";
  if (endpoint_ear_r_9) {
    node_ear_r_9.position.copy(endpoint_ear_r_9.start);
    node_ear_r_9.rotation.set(0, 0, 0);
    node_ear_r_9.scale.set(1, 1, 1);
  } else {
    node_ear_r_9.position.set(0.33, -0.082, -0.01);
    node_ear_r_9.rotation.set(0.0, 0.0, 0.0);
    node_ear_r_9.scale.set(0.078, 0.12, 0.062);
  }
  node_ear_r_9.userData.sculptComponent = {"id": "ear-r", "name": "Ear right", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.85, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Ear right is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head-group", "attachment": null, "dimensions": {"width": 0.078, "height": 0.12, "depth": 0.062, "units": "world", "confidence": 0.75}, "transform": {"position": [0.33, -0.082, -0.01], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["mirror of ear-l"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "head-region"], "details": ["mirror of ear-l"], "fidelityTier": "feature-placement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(251, 223, 180, 1.0)", "secondaryAlbedo": "rgba(221, 196, 158, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_ear_r_9.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["head-group"] ?? root).add(node_ear_r_9);
  nodes["ear-r"] = node_ear_r_9;
  const mesh_ear_r_9Geometry = endpoint_ear_r_9
    ? new THREE.CylinderGeometry(endpoint_ear_r_9.endRadius, endpoint_ear_r_9.baseRadius, endpoint_ear_r_9.length, 20, 3)
    : new THREE.SphereGeometry(0.5, 24, 16);
  const mesh_ear_r_9 = new THREE.Mesh(
    mesh_ear_r_9Geometry,
    materialMap["skin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_ear_r_9.name = "Ear right";
  if (endpoint_ear_r_9) {
    mesh_ear_r_9.position.copy(endpoint_ear_r_9.midpoint);
    mesh_ear_r_9.quaternion.copy(endpoint_ear_r_9.quaternion);
  }
  mesh_ear_r_9.castShadow = options.castShadow ?? true;
  mesh_ear_r_9.receiveShadow = options.receiveShadow ?? true;
  mesh_ear_r_9.userData.sculptComponent = {"id": "ear-r", "name": "Ear right", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.85, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Ear right is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head-group", "attachment": null, "dimensions": {"width": 0.078, "height": 0.12, "depth": 0.062, "units": "world", "confidence": 0.75}, "transform": {"position": [0.33, -0.082, -0.01], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["mirror of ear-l"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "head-region"], "details": ["mirror of ear-l"], "fidelityTier": "feature-placement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(251, 223, 180, 1.0)", "secondaryAlbedo": "rgba(221, 196, 158, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_ear_r_9.add(mesh_ear_r_9);
  meshes["ear-r"] = mesh_ear_r_9;
  colliders["ear-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["neck"] ??= [];
  destructionGroups["neck"].push(node_ear_r_9);

  const attachment_eye_l_10 = null;
  const endpoint_eye_l_10 = makeAttachmentEndpoint(attachment_eye_l_10);
  const node_eye_l_10 = new THREE.Group();
  node_eye_l_10.name = "Eye left__pivot";
  if (endpoint_eye_l_10) {
    node_eye_l_10.position.copy(endpoint_eye_l_10.start);
    node_eye_l_10.rotation.set(0, 0, 0);
    node_eye_l_10.scale.set(1, 1, 1);
  } else {
    node_eye_l_10.position.set(-0.108, -0.076, 0.272);
    node_eye_l_10.rotation.set(0.0, 0.0, 0.0);
    node_eye_l_10.scale.set(0.062, 0.062, 0.048);
  }
  node_eye_l_10.userData.sculptComponent = {"id": "eye-l", "name": "Eye left", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.85, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Eye left is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head-group", "attachment": null, "dimensions": {"width": 0.062, "height": 0.062, "depth": 0.048, "units": "world", "confidence": 0.9}, "transform": {"position": [-0.108, -0.076, 0.272], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "expression", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "eye-ink", "materialLayers": ["eye-ink"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["opaque dot, no sclera, no highlight"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "head-region"], "details": ["opaque dot, no sclera, no highlight"], "fidelityTier": "feature-placement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 28, 34, 1.0)", "secondaryAlbedo": "rgba(23, 25, 30, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_eye_l_10.userData.actionProfile = {"animationRole": "expression", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["head-group"] ?? root).add(node_eye_l_10);
  nodes["eye-l"] = node_eye_l_10;
  const mesh_eye_l_10Geometry = endpoint_eye_l_10
    ? new THREE.CylinderGeometry(endpoint_eye_l_10.endRadius, endpoint_eye_l_10.baseRadius, endpoint_eye_l_10.length, 20, 3)
    : new THREE.SphereGeometry(0.5, 24, 16);
  const mesh_eye_l_10 = new THREE.Mesh(
    mesh_eye_l_10Geometry,
    materialMap["eye-ink"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_eye_l_10.name = "Eye left";
  if (endpoint_eye_l_10) {
    mesh_eye_l_10.position.copy(endpoint_eye_l_10.midpoint);
    mesh_eye_l_10.quaternion.copy(endpoint_eye_l_10.quaternion);
  }
  mesh_eye_l_10.castShadow = options.castShadow ?? true;
  mesh_eye_l_10.receiveShadow = options.receiveShadow ?? true;
  mesh_eye_l_10.userData.sculptComponent = {"id": "eye-l", "name": "Eye left", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.85, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Eye left is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head-group", "attachment": null, "dimensions": {"width": 0.062, "height": 0.062, "depth": 0.048, "units": "world", "confidence": 0.9}, "transform": {"position": [-0.108, -0.076, 0.272], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "expression", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "eye-ink", "materialLayers": ["eye-ink"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["opaque dot, no sclera, no highlight"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "head-region"], "details": ["opaque dot, no sclera, no highlight"], "fidelityTier": "feature-placement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 28, 34, 1.0)", "secondaryAlbedo": "rgba(23, 25, 30, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_eye_l_10.add(mesh_eye_l_10);
  meshes["eye-l"] = mesh_eye_l_10;
  colliders["eye-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["neck"] ??= [];
  destructionGroups["neck"].push(node_eye_l_10);

  const attachment_eye_r_11 = null;
  const endpoint_eye_r_11 = makeAttachmentEndpoint(attachment_eye_r_11);
  const node_eye_r_11 = new THREE.Group();
  node_eye_r_11.name = "Eye right__pivot";
  if (endpoint_eye_r_11) {
    node_eye_r_11.position.copy(endpoint_eye_r_11.start);
    node_eye_r_11.rotation.set(0, 0, 0);
    node_eye_r_11.scale.set(1, 1, 1);
  } else {
    node_eye_r_11.position.set(0.108, -0.076, 0.272);
    node_eye_r_11.rotation.set(0.0, 0.0, 0.0);
    node_eye_r_11.scale.set(0.062, 0.062, 0.048);
  }
  node_eye_r_11.userData.sculptComponent = {"id": "eye-r", "name": "Eye right", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.85, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Eye right is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head-group", "attachment": null, "dimensions": {"width": 0.062, "height": 0.062, "depth": 0.048, "units": "world", "confidence": 0.9}, "transform": {"position": [0.108, -0.076, 0.272], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "expression", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "eye-ink", "materialLayers": ["eye-ink"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["mirror of eye-l"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "head-region"], "details": ["mirror of eye-l"], "fidelityTier": "feature-placement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 28, 34, 1.0)", "secondaryAlbedo": "rgba(23, 25, 30, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_eye_r_11.userData.actionProfile = {"animationRole": "expression", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["head-group"] ?? root).add(node_eye_r_11);
  nodes["eye-r"] = node_eye_r_11;
  const mesh_eye_r_11Geometry = endpoint_eye_r_11
    ? new THREE.CylinderGeometry(endpoint_eye_r_11.endRadius, endpoint_eye_r_11.baseRadius, endpoint_eye_r_11.length, 20, 3)
    : new THREE.SphereGeometry(0.5, 24, 16);
  const mesh_eye_r_11 = new THREE.Mesh(
    mesh_eye_r_11Geometry,
    materialMap["eye-ink"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_eye_r_11.name = "Eye right";
  if (endpoint_eye_r_11) {
    mesh_eye_r_11.position.copy(endpoint_eye_r_11.midpoint);
    mesh_eye_r_11.quaternion.copy(endpoint_eye_r_11.quaternion);
  }
  mesh_eye_r_11.castShadow = options.castShadow ?? true;
  mesh_eye_r_11.receiveShadow = options.receiveShadow ?? true;
  mesh_eye_r_11.userData.sculptComponent = {"id": "eye-r", "name": "Eye right", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.85, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Eye right is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head-group", "attachment": null, "dimensions": {"width": 0.062, "height": 0.062, "depth": 0.048, "units": "world", "confidence": 0.9}, "transform": {"position": [0.108, -0.076, 0.272], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "expression", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "eye-ink", "materialLayers": ["eye-ink"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["mirror of eye-l"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "head-region"], "details": ["mirror of eye-l"], "fidelityTier": "feature-placement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 28, 34, 1.0)", "secondaryAlbedo": "rgba(23, 25, 30, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_eye_r_11.add(mesh_eye_r_11);
  meshes["eye-r"] = mesh_eye_r_11;
  colliders["eye-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["neck"] ??= [];
  destructionGroups["neck"].push(node_eye_r_11);

  const attachment_nose_12 = null;
  const endpoint_nose_12 = makeAttachmentEndpoint(attachment_nose_12);
  const node_nose_12 = new THREE.Group();
  node_nose_12.name = "Nose__pivot";
  if (endpoint_nose_12) {
    node_nose_12.position.copy(endpoint_nose_12.start);
    node_nose_12.rotation.set(0, 0, 0);
    node_nose_12.scale.set(1, 1, 1);
  } else {
    node_nose_12.position.set(0.0, -0.123, 0.286);
    node_nose_12.rotation.set(0.0, 0.0, 0.0);
    node_nose_12.scale.set(0.055, 0.045, 0.05);
  }
  node_nose_12.userData.sculptComponent = {"id": "nose", "name": "Nose", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.85, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Nose is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head-group", "attachment": null, "dimensions": {"width": 0.055, "height": 0.045, "depth": 0.05, "units": "world", "confidence": 0.6}, "transform": {"position": [0, -0.123, 0.286], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["reads only through shading; no distinct silhouette"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "head-region"], "details": ["reads only through shading; no distinct silhouette"], "fidelityTier": "feature-placement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(251, 223, 180, 1.0)", "secondaryAlbedo": "rgba(221, 196, 158, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_nose_12.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["head-group"] ?? root).add(node_nose_12);
  nodes["nose"] = node_nose_12;
  const mesh_nose_12Geometry = endpoint_nose_12
    ? new THREE.CylinderGeometry(endpoint_nose_12.endRadius, endpoint_nose_12.baseRadius, endpoint_nose_12.length, 20, 3)
    : new THREE.SphereGeometry(0.5, 24, 16);
  const mesh_nose_12 = new THREE.Mesh(
    mesh_nose_12Geometry,
    materialMap["skin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_nose_12.name = "Nose";
  if (endpoint_nose_12) {
    mesh_nose_12.position.copy(endpoint_nose_12.midpoint);
    mesh_nose_12.quaternion.copy(endpoint_nose_12.quaternion);
  }
  mesh_nose_12.castShadow = options.castShadow ?? true;
  mesh_nose_12.receiveShadow = options.receiveShadow ?? true;
  mesh_nose_12.userData.sculptComponent = {"id": "nose", "name": "Nose", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.85, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Nose is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "head-group", "attachment": null, "dimensions": {"width": 0.055, "height": 0.045, "depth": 0.05, "units": "world", "confidence": 0.6}, "transform": {"position": [0, -0.123, 0.286], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["reads only through shading; no distinct silhouette"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "head-region"], "details": ["reads only through shading; no distinct silhouette"], "fidelityTier": "feature-placement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(251, 223, 180, 1.0)", "secondaryAlbedo": "rgba(221, 196, 158, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_nose_12.add(mesh_nose_12);
  meshes["nose"] = mesh_nose_12;
  colliders["nose"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["neck"] ??= [];
  destructionGroups["neck"].push(node_nose_12);

  const attachment_mouth_13 = {"parentId": "head-group", "parentSocket": "face-front", "localStart": [0, -0.165, 0.274], "localEnd": [0, -0.165, 0.274], "contactType": "fused", "embedDepth": 0.006, "gapTolerance": 0.004, "notes": "Smile arc laid on the face front. The tube spine already carries its own world placement, so the node stays at the head-group origin.", "evidenceRefs": ["full-object"]};
  const endpoint_mouth_13 = makeAttachmentEndpoint(attachment_mouth_13);
  const node_mouth_13 = new THREE.Group();
  node_mouth_13.name = "Mouth__pivot";
  if (endpoint_mouth_13) {
    node_mouth_13.position.copy(endpoint_mouth_13.start);
    node_mouth_13.rotation.set(0, 0, 0);
    node_mouth_13.scale.set(1, 1, 1);
  } else {
    node_mouth_13.position.set(0.0, 0.0, 0.0);
    node_mouth_13.rotation.set(0.0, 0.0, 0.0);
    node_mouth_13.scale.set(1.0, 1.0, 1.0);
  }
  node_mouth_13.userData.sculptComponent = {"id": "mouth", "name": "Mouth", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.85, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Mouth is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "tubePath": {"points": [[-0.048, -0.152, 0.258], [-0.025, -0.162, 0.27], [0.0, -0.165, 0.274], [0.025, -0.162, 0.27], [0.048, -0.152, 0.258]], "radius": 0.009, "radialSegments": 8, "closed": false}}, "parent": "head-group", "attachment": {"parentId": "head-group", "parentSocket": "face-front", "localStart": [0, -0.165, 0.274], "localEnd": [0, -0.165, 0.274], "contactType": "fused", "embedDepth": 0.006, "gapTolerance": 0.004, "notes": "Smile arc laid on the face front. The tube spine already carries its own world placement, so the node stays at the head-group origin.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.096, "height": 0.018, "depth": 0.018, "units": "world", "confidence": 0.7}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "expression", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "eye-ink", "materialLayers": ["eye-ink"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["single upward-curved line, no opening: corners at y=1.407 sit above the centre at y=1.393"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "head-region"], "details": ["single upward-curved line, no opening"], "fidelityTier": "feature-placement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 28, 34, 1.0)", "secondaryAlbedo": "rgba(23, 25, 30, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_mouth_13.userData.actionProfile = {"animationRole": "expression", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["head-group"] ?? root).add(node_mouth_13);
  nodes["mouth"] = node_mouth_13;
  const mesh_mouth_13Geometry = endpoint_mouth_13
    ? new THREE.CylinderGeometry(endpoint_mouth_13.endRadius, endpoint_mouth_13.baseRadius, endpoint_mouth_13.length, 20, 3)
    : buildTubeGeometry({"points": [[-0.048, -0.152, 0.258], [-0.025, -0.162, 0.27], [0.0, -0.165, 0.274], [0.025, -0.162, 0.27], [0.048, -0.152, 0.258]], "radius": 0.009, "radialSegments": 8, "closed": false});
  const mesh_mouth_13 = new THREE.Mesh(
    mesh_mouth_13Geometry,
    materialMap["eye-ink"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_mouth_13.name = "Mouth";
  if (endpoint_mouth_13) {
    mesh_mouth_13.position.copy(endpoint_mouth_13.midpoint);
    mesh_mouth_13.quaternion.copy(endpoint_mouth_13.quaternion);
  }
  mesh_mouth_13.castShadow = options.castShadow ?? true;
  mesh_mouth_13.receiveShadow = options.receiveShadow ?? true;
  mesh_mouth_13.userData.sculptComponent = {"id": "mouth", "name": "Mouth", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.85, "primitive": "tube", "topologyClass": "assembled-solid", "topologyRationale": "Mouth is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals", "tubePath": {"points": [[-0.048, -0.152, 0.258], [-0.025, -0.162, 0.27], [0.0, -0.165, 0.274], [0.025, -0.162, 0.27], [0.048, -0.152, 0.258]], "radius": 0.009, "radialSegments": 8, "closed": false}}, "parent": "head-group", "attachment": {"parentId": "head-group", "parentSocket": "face-front", "localStart": [0, -0.165, 0.274], "localEnd": [0, -0.165, 0.274], "contactType": "fused", "embedDepth": 0.006, "gapTolerance": 0.004, "notes": "Smile arc laid on the face front. The tube spine already carries its own world placement, so the node stays at the head-group origin.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.096, "height": 0.018, "depth": 0.018, "units": "world", "confidence": 0.7}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "expression", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "eye-ink", "materialLayers": ["eye-ink"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["single upward-curved line, no opening: corners at y=1.407 sit above the centre at y=1.393"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "head-region"], "details": ["single upward-curved line, no opening"], "fidelityTier": "feature-placement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(26, 28, 34, 1.0)", "secondaryAlbedo": "rgba(23, 25, 30, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_mouth_13.add(mesh_mouth_13);
  meshes["mouth"] = mesh_mouth_13;
  colliders["mouth"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["neck"] ??= [];
  destructionGroups["neck"].push(node_mouth_13);

  const attachment_strap_l_14 = {"parentId": "body-group", "parentSocket": "shoulder-l", "localStart": [-0.135, 0.29, 0.11], "localEnd": [-0.215, -0.08, 0.18], "contactType": "seated", "embedDepth": 0.012, "gapTolerance": 0.004, "baseRadius": 0.03, "endRadius": 0.028, "notes": "Backpack strap laid over the shoulder and down the chest front; the only warm accent on the figure.", "evidenceRefs": ["full-object"]};
  const endpoint_strap_l_14 = makeAttachmentEndpoint(attachment_strap_l_14);
  const node_strap_l_14 = new THREE.Group();
  node_strap_l_14.name = "Backpack strap left__pivot";
  if (endpoint_strap_l_14) {
    node_strap_l_14.position.copy(endpoint_strap_l_14.start);
    node_strap_l_14.rotation.set(0, 0, 0);
    node_strap_l_14.scale.set(1, 1, 1);
  } else {
    node_strap_l_14.position.set(-0.175, 0.105, 0.145);
    node_strap_l_14.rotation.set(0.0, 0.0, 0.0);
    node_strap_l_14.scale.set(0.058, 0.38, 0.058);
  }
  node_strap_l_14.userData.sculptComponent = {"id": "strap-l", "name": "Backpack strap left", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.85, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Backpack strap left is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "body-group", "attachment": {"parentId": "body-group", "parentSocket": "shoulder-l", "localStart": [-0.135, 0.29, 0.11], "localEnd": [-0.215, -0.08, 0.18], "contactType": "seated", "embedDepth": 0.012, "gapTolerance": 0.004, "baseRadius": 0.03, "endRadius": 0.028, "notes": "Backpack strap laid over the shoulder and down the chest front; the only warm accent on the figure.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.058, "height": 0.38, "depth": 0.058, "units": "world", "confidence": 0.7}, "transform": {"position": [-0.175, 0.105, 0.145], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "strap-coral", "materialLayers": ["strap-coral"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["tapers toward the hem"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "torso-region"], "details": ["tapers toward the hem"], "fidelityTier": "feature-placement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(241, 137, 121, 1.0)", "secondaryAlbedo": "rgba(212, 121, 106, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9}};
  node_strap_l_14.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["body-group"] ?? root).add(node_strap_l_14);
  nodes["strap-l"] = node_strap_l_14;
  const mesh_strap_l_14Geometry = endpoint_strap_l_14
    ? new THREE.CylinderGeometry(endpoint_strap_l_14.endRadius, endpoint_strap_l_14.baseRadius, endpoint_strap_l_14.length, 20, 3)
    : new THREE.CapsuleGeometry(0.35, 0.7, 6, 20);
  const mesh_strap_l_14 = new THREE.Mesh(
    mesh_strap_l_14Geometry,
    materialMap["strap-coral"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_strap_l_14.name = "Backpack strap left";
  if (endpoint_strap_l_14) {
    mesh_strap_l_14.position.copy(endpoint_strap_l_14.midpoint);
    mesh_strap_l_14.quaternion.copy(endpoint_strap_l_14.quaternion);
  }
  mesh_strap_l_14.castShadow = options.castShadow ?? true;
  mesh_strap_l_14.receiveShadow = options.receiveShadow ?? true;
  mesh_strap_l_14.userData.sculptComponent = {"id": "strap-l", "name": "Backpack strap left", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.85, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Backpack strap left is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "body-group", "attachment": {"parentId": "body-group", "parentSocket": "shoulder-l", "localStart": [-0.135, 0.29, 0.11], "localEnd": [-0.215, -0.08, 0.18], "contactType": "seated", "embedDepth": 0.012, "gapTolerance": 0.004, "baseRadius": 0.03, "endRadius": 0.028, "notes": "Backpack strap laid over the shoulder and down the chest front; the only warm accent on the figure.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.058, "height": 0.38, "depth": 0.058, "units": "world", "confidence": 0.7}, "transform": {"position": [-0.175, 0.105, 0.145], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "strap-coral", "materialLayers": ["strap-coral"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["tapers toward the hem"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "torso-region"], "details": ["tapers toward the hem"], "fidelityTier": "feature-placement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(241, 137, 121, 1.0)", "secondaryAlbedo": "rgba(212, 121, 106, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9}};
  node_strap_l_14.add(mesh_strap_l_14);
  meshes["strap-l"] = mesh_strap_l_14;
  colliders["strap-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["neck"] ??= [];
  destructionGroups["neck"].push(node_strap_l_14);

  const attachment_strap_r_15 = {"parentId": "body-group", "parentSocket": "shoulder-r", "localStart": [0.135, 0.29, 0.11], "localEnd": [0.215, -0.08, 0.18], "contactType": "seated", "embedDepth": 0.012, "gapTolerance": 0.004, "baseRadius": 0.03, "endRadius": 0.028, "notes": "Backpack strap laid over the shoulder and down the chest front; the only warm accent on the figure.", "evidenceRefs": ["full-object"]};
  const endpoint_strap_r_15 = makeAttachmentEndpoint(attachment_strap_r_15);
  const node_strap_r_15 = new THREE.Group();
  node_strap_r_15.name = "Backpack strap right__pivot";
  if (endpoint_strap_r_15) {
    node_strap_r_15.position.copy(endpoint_strap_r_15.start);
    node_strap_r_15.rotation.set(0, 0, 0);
    node_strap_r_15.scale.set(1, 1, 1);
  } else {
    node_strap_r_15.position.set(0.175, 0.105, 0.145);
    node_strap_r_15.rotation.set(0.0, 0.0, 0.0);
    node_strap_r_15.scale.set(0.058, 0.38, 0.058);
  }
  node_strap_r_15.userData.sculptComponent = {"id": "strap-r", "name": "Backpack strap right", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.85, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Backpack strap right is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "body-group", "attachment": {"parentId": "body-group", "parentSocket": "shoulder-r", "localStart": [0.135, 0.29, 0.11], "localEnd": [0.215, -0.08, 0.18], "contactType": "seated", "embedDepth": 0.012, "gapTolerance": 0.004, "baseRadius": 0.03, "endRadius": 0.028, "notes": "Backpack strap laid over the shoulder and down the chest front; the only warm accent on the figure.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.058, "height": 0.38, "depth": 0.058, "units": "world", "confidence": 0.7}, "transform": {"position": [0.175, 0.105, 0.145], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "strap-coral", "materialLayers": ["strap-coral"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["mirror of strap-l"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "torso-region"], "details": ["mirror of strap-l"], "fidelityTier": "feature-placement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(241, 137, 121, 1.0)", "secondaryAlbedo": "rgba(212, 121, 106, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9}};
  node_strap_r_15.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["body-group"] ?? root).add(node_strap_r_15);
  nodes["strap-r"] = node_strap_r_15;
  const mesh_strap_r_15Geometry = endpoint_strap_r_15
    ? new THREE.CylinderGeometry(endpoint_strap_r_15.endRadius, endpoint_strap_r_15.baseRadius, endpoint_strap_r_15.length, 20, 3)
    : new THREE.CapsuleGeometry(0.35, 0.7, 6, 20);
  const mesh_strap_r_15 = new THREE.Mesh(
    mesh_strap_r_15Geometry,
    materialMap["strap-coral"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_strap_r_15.name = "Backpack strap right";
  if (endpoint_strap_r_15) {
    mesh_strap_r_15.position.copy(endpoint_strap_r_15.midpoint);
    mesh_strap_r_15.quaternion.copy(endpoint_strap_r_15.quaternion);
  }
  mesh_strap_r_15.castShadow = options.castShadow ?? true;
  mesh_strap_r_15.receiveShadow = options.receiveShadow ?? true;
  mesh_strap_r_15.userData.sculptComponent = {"id": "strap-r", "name": "Backpack strap right", "level": "micro", "role": "detail", "importance": 0.6, "confidence": 0.85, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Backpack strap right is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "body-group", "attachment": {"parentId": "body-group", "parentSocket": "shoulder-r", "localStart": [0.135, 0.29, 0.11], "localEnd": [0.215, -0.08, 0.18], "contactType": "seated", "embedDepth": 0.012, "gapTolerance": 0.004, "baseRadius": 0.03, "endRadius": 0.028, "notes": "Backpack strap laid over the shoulder and down the chest front; the only warm accent on the figure.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.058, "height": 0.38, "depth": 0.058, "units": "world", "confidence": 0.7}, "transform": {"position": [0.175, 0.105, 0.145], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "strap-coral", "materialLayers": ["strap-coral"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["mirror of strap-l"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "torso-region"], "details": ["mirror of strap-l"], "fidelityTier": "feature-placement", "colorMaterialRecipe": {"dominantAlbedo": "rgba(241, 137, 121, 1.0)", "secondaryAlbedo": "rgba(212, 121, 106, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9}};
  node_strap_r_15.add(mesh_strap_r_15);
  meshes["strap-r"] = mesh_strap_r_15;
  colliders["strap-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["neck"] ??= [];
  destructionGroups["neck"].push(node_strap_r_15);

  const attachment_arm_l_16 = {"parentId": "body-group", "parentSocket": "shoulder-l", "localStart": [-0.15, 0.17999999999999994, 0], "localEnd": [-0.336, -0.15999999999999992, 0], "contactType": "socket", "embedDepth": 0.05, "gapTolerance": 0.004, "baseRadius": 0.082, "endRadius": 0.066, "notes": "Sleeve from shoulder to wrist. Its node sits at the shoulder so the swing pivot is the shoulder, and the hand rides it.", "evidenceRefs": ["full-object"]};
  const endpoint_arm_l_16 = makeAttachmentEndpoint(attachment_arm_l_16);
  const node_arm_l_16 = new THREE.Group();
  node_arm_l_16.name = "Arm left__pivot";
  if (endpoint_arm_l_16) {
    node_arm_l_16.position.copy(endpoint_arm_l_16.start);
    node_arm_l_16.rotation.set(0, 0, 0);
    node_arm_l_16.scale.set(1, 1, 1);
  } else {
    node_arm_l_16.position.set(-0.243, 0.010000000000000009, 0.0);
    node_arm_l_16.rotation.set(0.0, 0.0, 0.0);
    node_arm_l_16.scale.set(0.17, 0.445, 0.17);
  }
  node_arm_l_16.userData.sculptComponent = {"id": "arm-l", "name": "Arm left", "level": "macro", "role": "limb", "importance": 0.9, "confidence": 0.85, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Arm left is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "body-group", "attachment": {"parentId": "body-group", "parentSocket": "shoulder-l", "localStart": [-0.15, 0.17999999999999994, 0], "localEnd": [-0.336, -0.15999999999999992, 0], "contactType": "socket", "embedDepth": 0.05, "gapTolerance": 0.004, "baseRadius": 0.082, "endRadius": 0.066, "notes": "Sleeve from shoulder to wrist. Its node sits at the shoulder so the swing pivot is the shoulder, and the hand rides it.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.17, "height": 0.445, "depth": 0.17, "units": "world", "confidence": 0.8}, "transform": {"position": [-0.243, 0.010000000000000009, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0.17, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "torso-purple", "materialLayers": ["torso-purple"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["sleeve ends in a purple-to-cream cuff at the wrist, where the mitten hand takes over", "shoulder pivot for the run cycle swing", "wrist held at x=0.336u: deliberate inboard departure from the reference's 1.173u span"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "torso-region"], "details": ["pivot at the shoulder so the animation can swing it", "sleeve ends in a purple-to-cream cuff at the wrist"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(142, 103, 216, 1.0)", "secondaryAlbedo": "rgba(125, 91, 190, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9}};
  node_arm_l_16.userData.actionProfile = {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0.17, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["body-group"] ?? root).add(node_arm_l_16);
  nodes["arm-l"] = node_arm_l_16;
  const mesh_arm_l_16Geometry = endpoint_arm_l_16
    ? new THREE.CylinderGeometry(endpoint_arm_l_16.endRadius, endpoint_arm_l_16.baseRadius, endpoint_arm_l_16.length, 20, 3)
    : new THREE.CapsuleGeometry(0.35, 0.7, 6, 20);
  const mesh_arm_l_16 = new THREE.Mesh(
    mesh_arm_l_16Geometry,
    materialMap["torso-purple"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arm_l_16.name = "Arm left";
  if (endpoint_arm_l_16) {
    mesh_arm_l_16.position.copy(endpoint_arm_l_16.midpoint);
    mesh_arm_l_16.quaternion.copy(endpoint_arm_l_16.quaternion);
  }
  mesh_arm_l_16.castShadow = options.castShadow ?? true;
  mesh_arm_l_16.receiveShadow = options.receiveShadow ?? true;
  mesh_arm_l_16.userData.sculptComponent = {"id": "arm-l", "name": "Arm left", "level": "macro", "role": "limb", "importance": 0.9, "confidence": 0.85, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Arm left is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "body-group", "attachment": {"parentId": "body-group", "parentSocket": "shoulder-l", "localStart": [-0.15, 0.17999999999999994, 0], "localEnd": [-0.336, -0.15999999999999992, 0], "contactType": "socket", "embedDepth": 0.05, "gapTolerance": 0.004, "baseRadius": 0.082, "endRadius": 0.066, "notes": "Sleeve from shoulder to wrist. Its node sits at the shoulder so the swing pivot is the shoulder, and the hand rides it.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.17, "height": 0.445, "depth": 0.17, "units": "world", "confidence": 0.8}, "transform": {"position": [-0.243, 0.010000000000000009, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0.17, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "torso-purple", "materialLayers": ["torso-purple"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["sleeve ends in a purple-to-cream cuff at the wrist, where the mitten hand takes over", "shoulder pivot for the run cycle swing", "wrist held at x=0.336u: deliberate inboard departure from the reference's 1.173u span"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "torso-region"], "details": ["pivot at the shoulder so the animation can swing it", "sleeve ends in a purple-to-cream cuff at the wrist"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(142, 103, 216, 1.0)", "secondaryAlbedo": "rgba(125, 91, 190, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9}};
  node_arm_l_16.add(mesh_arm_l_16);
  meshes["arm-l"] = mesh_arm_l_16;
  colliders["arm-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["neck"] ??= [];
  destructionGroups["neck"].push(node_arm_l_16);

  const attachment_arm_r_17 = {"parentId": "body-group", "parentSocket": "shoulder-r", "localStart": [0.15, 0.17999999999999994, 0], "localEnd": [0.336, -0.15999999999999992, 0], "contactType": "socket", "embedDepth": 0.05, "gapTolerance": 0.004, "baseRadius": 0.082, "endRadius": 0.066, "notes": "Sleeve from shoulder to wrist. Its node sits at the shoulder so the swing pivot is the shoulder, and the hand rides it.", "evidenceRefs": ["full-object"]};
  const endpoint_arm_r_17 = makeAttachmentEndpoint(attachment_arm_r_17);
  const node_arm_r_17 = new THREE.Group();
  node_arm_r_17.name = "Arm right__pivot";
  if (endpoint_arm_r_17) {
    node_arm_r_17.position.copy(endpoint_arm_r_17.start);
    node_arm_r_17.rotation.set(0, 0, 0);
    node_arm_r_17.scale.set(1, 1, 1);
  } else {
    node_arm_r_17.position.set(0.243, 0.010000000000000009, 0.0);
    node_arm_r_17.rotation.set(0.0, 0.0, 0.0);
    node_arm_r_17.scale.set(0.17, 0.445, 0.17);
  }
  node_arm_r_17.userData.sculptComponent = {"id": "arm-r", "name": "Arm right", "level": "macro", "role": "limb", "importance": 0.9, "confidence": 0.85, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Arm right is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "body-group", "attachment": {"parentId": "body-group", "parentSocket": "shoulder-r", "localStart": [0.15, 0.17999999999999994, 0], "localEnd": [0.336, -0.15999999999999992, 0], "contactType": "socket", "embedDepth": 0.05, "gapTolerance": 0.004, "baseRadius": 0.082, "endRadius": 0.066, "notes": "Sleeve from shoulder to wrist. Its node sits at the shoulder so the swing pivot is the shoulder, and the hand rides it.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.17, "height": 0.445, "depth": 0.17, "units": "world", "confidence": 0.8}, "transform": {"position": [0.243, 0.010000000000000009, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0.17, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "torso-purple", "materialLayers": ["torso-purple"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["sleeve ends in a purple-to-cream cuff at the wrist, where the mitten hand takes over", "shoulder pivot for the run cycle swing", "wrist held at x=0.336u: deliberate inboard departure from the reference's 1.173u span"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "torso-region"], "details": ["mirror of arm-l"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(142, 103, 216, 1.0)", "secondaryAlbedo": "rgba(125, 91, 190, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9}};
  node_arm_r_17.userData.actionProfile = {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0.17, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["body-group"] ?? root).add(node_arm_r_17);
  nodes["arm-r"] = node_arm_r_17;
  const mesh_arm_r_17Geometry = endpoint_arm_r_17
    ? new THREE.CylinderGeometry(endpoint_arm_r_17.endRadius, endpoint_arm_r_17.baseRadius, endpoint_arm_r_17.length, 20, 3)
    : new THREE.CapsuleGeometry(0.35, 0.7, 6, 20);
  const mesh_arm_r_17 = new THREE.Mesh(
    mesh_arm_r_17Geometry,
    materialMap["torso-purple"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arm_r_17.name = "Arm right";
  if (endpoint_arm_r_17) {
    mesh_arm_r_17.position.copy(endpoint_arm_r_17.midpoint);
    mesh_arm_r_17.quaternion.copy(endpoint_arm_r_17.quaternion);
  }
  mesh_arm_r_17.castShadow = options.castShadow ?? true;
  mesh_arm_r_17.receiveShadow = options.receiveShadow ?? true;
  mesh_arm_r_17.userData.sculptComponent = {"id": "arm-r", "name": "Arm right", "level": "macro", "role": "limb", "importance": 0.9, "confidence": 0.85, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Arm right is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "body-group", "attachment": {"parentId": "body-group", "parentSocket": "shoulder-r", "localStart": [0.15, 0.17999999999999994, 0], "localEnd": [0.336, -0.15999999999999992, 0], "contactType": "socket", "embedDepth": 0.05, "gapTolerance": 0.004, "baseRadius": 0.082, "endRadius": 0.066, "notes": "Sleeve from shoulder to wrist. Its node sits at the shoulder so the swing pivot is the shoulder, and the hand rides it.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.17, "height": 0.445, "depth": 0.17, "units": "world", "confidence": 0.8}, "transform": {"position": [0.243, 0.010000000000000009, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0.17, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "torso-purple", "materialLayers": ["torso-purple"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["sleeve ends in a purple-to-cream cuff at the wrist, where the mitten hand takes over", "shoulder pivot for the run cycle swing", "wrist held at x=0.336u: deliberate inboard departure from the reference's 1.173u span"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "torso-region"], "details": ["mirror of arm-l"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(142, 103, 216, 1.0)", "secondaryAlbedo": "rgba(125, 91, 190, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.9}};
  node_arm_r_17.add(mesh_arm_r_17);
  meshes["arm-r"] = mesh_arm_r_17;
  colliders["arm-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["neck"] ??= [];
  destructionGroups["neck"].push(node_arm_r_17);

  const attachment_hand_l_18 = {"parentId": "arm-l", "parentSocket": "wrist-l", "localStart": [-0.18600000000000003, -0.33999999999999986, 0.01], "localEnd": [-0.18600000000000003, -0.33999999999999986, 0.01], "contactType": "socket", "embedDepth": 0.03, "gapTolerance": 0.004, "notes": "Three-lobed mitten mass seated on the cuff. Modelled as one rounded blob; the reference's thumb split is not reproduced.", "evidenceRefs": ["full-object"]};
  const endpoint_hand_l_18 = makeAttachmentEndpoint(attachment_hand_l_18);
  const node_hand_l_18 = new THREE.Group();
  node_hand_l_18.name = "Hand left__pivot";
  if (endpoint_hand_l_18) {
    node_hand_l_18.position.copy(endpoint_hand_l_18.start);
    node_hand_l_18.rotation.set(0, 0, 0);
    node_hand_l_18.scale.set(1, 1, 1);
  } else {
    node_hand_l_18.position.set(-0.18600000000000003, -0.40199999999999986, 0.01);
    node_hand_l_18.rotation.set(0.0, 0.0, 0.0);
    node_hand_l_18.scale.set(0.145, 0.15, 0.105);
  }
  node_hand_l_18.userData.sculptComponent = {"id": "hand-l", "name": "Hand left", "level": "meso", "role": "limb", "importance": 0.9, "confidence": 0.85, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Hand left is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "arm-l", "attachment": {"parentId": "arm-l", "parentSocket": "wrist-l", "localStart": [-0.18600000000000003, -0.33999999999999986, 0.01], "localEnd": [-0.18600000000000003, -0.33999999999999986, 0.01], "contactType": "socket", "embedDepth": 0.03, "gapTolerance": 0.004, "notes": "Three-lobed mitten mass seated on the cuff. Modelled as one rounded blob; the reference's thumb split is not reproduced.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.145, "height": 0.15, "depth": 0.105, "units": "world", "confidence": 0.7}, "transform": {"position": [-0.18600000000000003, -0.40199999999999986, 0.01], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0.065, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["three-lobed mitten: separated thumb, merged fingers"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "torso-region"], "details": ["three-lobed mitten: separated thumb, merged fingers"], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(251, 223, 180, 1.0)", "secondaryAlbedo": "rgba(221, 196, 158, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_hand_l_18.userData.actionProfile = {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0.065, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["arm-l"] ?? root).add(node_hand_l_18);
  nodes["hand-l"] = node_hand_l_18;
  const mesh_hand_l_18Geometry = endpoint_hand_l_18
    ? new THREE.CylinderGeometry(endpoint_hand_l_18.endRadius, endpoint_hand_l_18.baseRadius, endpoint_hand_l_18.length, 20, 3)
    : new THREE.SphereGeometry(0.5, 24, 16);
  const mesh_hand_l_18 = new THREE.Mesh(
    mesh_hand_l_18Geometry,
    materialMap["skin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hand_l_18.name = "Hand left";
  if (endpoint_hand_l_18) {
    mesh_hand_l_18.position.copy(endpoint_hand_l_18.midpoint);
    mesh_hand_l_18.quaternion.copy(endpoint_hand_l_18.quaternion);
  }
  mesh_hand_l_18.castShadow = options.castShadow ?? true;
  mesh_hand_l_18.receiveShadow = options.receiveShadow ?? true;
  mesh_hand_l_18.userData.sculptComponent = {"id": "hand-l", "name": "Hand left", "level": "meso", "role": "limb", "importance": 0.9, "confidence": 0.85, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Hand left is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "arm-l", "attachment": {"parentId": "arm-l", "parentSocket": "wrist-l", "localStart": [-0.18600000000000003, -0.33999999999999986, 0.01], "localEnd": [-0.18600000000000003, -0.33999999999999986, 0.01], "contactType": "socket", "embedDepth": 0.03, "gapTolerance": 0.004, "notes": "Three-lobed mitten mass seated on the cuff. Modelled as one rounded blob; the reference's thumb split is not reproduced.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.145, "height": 0.15, "depth": 0.105, "units": "world", "confidence": 0.7}, "transform": {"position": [-0.18600000000000003, -0.40199999999999986, 0.01], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0.065, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["three-lobed mitten: separated thumb, merged fingers"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "torso-region"], "details": ["three-lobed mitten: separated thumb, merged fingers"], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(251, 223, 180, 1.0)", "secondaryAlbedo": "rgba(221, 196, 158, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_hand_l_18.add(mesh_hand_l_18);
  meshes["hand-l"] = mesh_hand_l_18;
  colliders["hand-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["neck"] ??= [];
  destructionGroups["neck"].push(node_hand_l_18);

  const attachment_hand_r_19 = {"parentId": "arm-r", "parentSocket": "wrist-r", "localStart": [0.18600000000000003, -0.33999999999999986, 0.01], "localEnd": [0.18600000000000003, -0.33999999999999986, 0.01], "contactType": "socket", "embedDepth": 0.03, "gapTolerance": 0.004, "notes": "Three-lobed mitten mass seated on the cuff. Modelled as one rounded blob; the reference's thumb split is not reproduced.", "evidenceRefs": ["full-object"]};
  const endpoint_hand_r_19 = makeAttachmentEndpoint(attachment_hand_r_19);
  const node_hand_r_19 = new THREE.Group();
  node_hand_r_19.name = "Hand right__pivot";
  if (endpoint_hand_r_19) {
    node_hand_r_19.position.copy(endpoint_hand_r_19.start);
    node_hand_r_19.rotation.set(0, 0, 0);
    node_hand_r_19.scale.set(1, 1, 1);
  } else {
    node_hand_r_19.position.set(0.18600000000000003, -0.40199999999999986, 0.01);
    node_hand_r_19.rotation.set(0.0, 0.0, 0.0);
    node_hand_r_19.scale.set(0.145, 0.15, 0.105);
  }
  node_hand_r_19.userData.sculptComponent = {"id": "hand-r", "name": "Hand right", "level": "meso", "role": "limb", "importance": 0.9, "confidence": 0.85, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Hand right is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "arm-r", "attachment": {"parentId": "arm-r", "parentSocket": "wrist-r", "localStart": [0.18600000000000003, -0.33999999999999986, 0.01], "localEnd": [0.18600000000000003, -0.33999999999999986, 0.01], "contactType": "socket", "embedDepth": 0.03, "gapTolerance": 0.004, "notes": "Three-lobed mitten mass seated on the cuff. Modelled as one rounded blob; the reference's thumb split is not reproduced.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.145, "height": 0.15, "depth": 0.105, "units": "world", "confidence": 0.7}, "transform": {"position": [0.18600000000000003, -0.40199999999999986, 0.01], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0.065, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["mirror of hand-l"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "torso-region"], "details": ["mirror of hand-l"], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(251, 223, 180, 1.0)", "secondaryAlbedo": "rgba(221, 196, 158, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_hand_r_19.userData.actionProfile = {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0.065, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["arm-r"] ?? root).add(node_hand_r_19);
  nodes["hand-r"] = node_hand_r_19;
  const mesh_hand_r_19Geometry = endpoint_hand_r_19
    ? new THREE.CylinderGeometry(endpoint_hand_r_19.endRadius, endpoint_hand_r_19.baseRadius, endpoint_hand_r_19.length, 20, 3)
    : new THREE.SphereGeometry(0.5, 24, 16);
  const mesh_hand_r_19 = new THREE.Mesh(
    mesh_hand_r_19Geometry,
    materialMap["skin"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_hand_r_19.name = "Hand right";
  if (endpoint_hand_r_19) {
    mesh_hand_r_19.position.copy(endpoint_hand_r_19.midpoint);
    mesh_hand_r_19.quaternion.copy(endpoint_hand_r_19.quaternion);
  }
  mesh_hand_r_19.castShadow = options.castShadow ?? true;
  mesh_hand_r_19.receiveShadow = options.receiveShadow ?? true;
  mesh_hand_r_19.userData.sculptComponent = {"id": "hand-r", "name": "Hand right", "level": "meso", "role": "limb", "importance": 0.9, "confidence": 0.85, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Hand right is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "arm-r", "attachment": {"parentId": "arm-r", "parentSocket": "wrist-r", "localStart": [0.18600000000000003, -0.33999999999999986, 0.01], "localEnd": [0.18600000000000003, -0.33999999999999986, 0.01], "contactType": "socket", "embedDepth": 0.03, "gapTolerance": 0.004, "notes": "Three-lobed mitten mass seated on the cuff. Modelled as one rounded blob; the reference's thumb split is not reproduced.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.145, "height": 0.15, "depth": 0.105, "units": "world", "confidence": 0.7}, "transform": {"position": [0.18600000000000003, -0.40199999999999986, 0.01], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0.065, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "skin", "materialLayers": ["skin"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["mirror of hand-l"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "torso-region"], "details": ["mirror of hand-l"], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(251, 223, 180, 1.0)", "secondaryAlbedo": "rgba(221, 196, 158, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_hand_r_19.add(mesh_hand_r_19);
  meshes["hand-r"] = mesh_hand_r_19;
  colliders["hand-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["neck"] ??= [];
  destructionGroups["neck"].push(node_hand_r_19);

  const attachment_leg_l_20 = {"parentId": "legs-group", "parentSocket": "hip-l", "localStart": [-0.105, 0.0, 0], "localEnd": [-0.133, -0.373, 0], "contactType": "socket", "embedDepth": 0.06, "gapTolerance": 0.004, "baseRadius": 0.083, "endRadius": 0.067, "notes": "Trouser leg from the hip at y=0.660 to the ankle at y=0.287, tapering 0.166u to 0.134u as measured.", "evidenceRefs": ["full-object"]};
  const endpoint_leg_l_20 = makeAttachmentEndpoint(attachment_leg_l_20);
  const node_leg_l_20 = new THREE.Group();
  node_leg_l_20.name = "Leg left__pivot";
  if (endpoint_leg_l_20) {
    node_leg_l_20.position.copy(endpoint_leg_l_20.start);
    node_leg_l_20.rotation.set(0, 0, 0);
    node_leg_l_20.scale.set(1, 1, 1);
  } else {
    node_leg_l_20.position.set(-0.119, -0.187, 0.0);
    node_leg_l_20.rotation.set(0.0, 0.0, 0.0);
    node_leg_l_20.scale.set(0.15, 0.373, 0.15);
  }
  node_leg_l_20.userData.sculptComponent = {"id": "leg-l", "name": "Leg left", "level": "macro", "role": "limb", "importance": 0.9, "confidence": 0.85, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Leg left is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "legs-group", "attachment": {"parentId": "legs-group", "parentSocket": "hip-l", "localStart": [-0.105, 0.0, 0], "localEnd": [-0.133, -0.373, 0], "contactType": "socket", "embedDepth": 0.06, "gapTolerance": 0.004, "baseRadius": 0.083, "endRadius": 0.067, "notes": "Trouser leg from the hip at y=0.660 to the ankle at y=0.287, tapering 0.166u to 0.134u as measured.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.15, "height": 0.373, "depth": 0.15, "units": "world", "confidence": 0.9}, "transform": {"position": [-0.119, -0.187, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0.2415, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "hair-ink", "materialLayers": ["hair-ink"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["legs merge into one mass at the hip; no crotch gap"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "legs-region"], "details": ["legs merge into one mass at the hip; no crotch gap"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(49, 58, 81, 1.0)", "secondaryAlbedo": "rgba(43, 51, 71, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_leg_l_20.userData.actionProfile = {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0.2415, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["legs-group"] ?? root).add(node_leg_l_20);
  nodes["leg-l"] = node_leg_l_20;
  const mesh_leg_l_20Geometry = endpoint_leg_l_20
    ? new THREE.CylinderGeometry(endpoint_leg_l_20.endRadius, endpoint_leg_l_20.baseRadius, endpoint_leg_l_20.length, 20, 3)
    : new THREE.CapsuleGeometry(0.35, 0.7, 6, 20);
  const mesh_leg_l_20 = new THREE.Mesh(
    mesh_leg_l_20Geometry,
    materialMap["hair-ink"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg_l_20.name = "Leg left";
  if (endpoint_leg_l_20) {
    mesh_leg_l_20.position.copy(endpoint_leg_l_20.midpoint);
    mesh_leg_l_20.quaternion.copy(endpoint_leg_l_20.quaternion);
  }
  mesh_leg_l_20.castShadow = options.castShadow ?? true;
  mesh_leg_l_20.receiveShadow = options.receiveShadow ?? true;
  mesh_leg_l_20.userData.sculptComponent = {"id": "leg-l", "name": "Leg left", "level": "macro", "role": "limb", "importance": 0.9, "confidence": 0.85, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Leg left is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "legs-group", "attachment": {"parentId": "legs-group", "parentSocket": "hip-l", "localStart": [-0.105, 0.0, 0], "localEnd": [-0.133, -0.373, 0], "contactType": "socket", "embedDepth": 0.06, "gapTolerance": 0.004, "baseRadius": 0.083, "endRadius": 0.067, "notes": "Trouser leg from the hip at y=0.660 to the ankle at y=0.287, tapering 0.166u to 0.134u as measured.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.15, "height": 0.373, "depth": 0.15, "units": "world", "confidence": 0.9}, "transform": {"position": [-0.119, -0.187, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0.2415, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "hair-ink", "materialLayers": ["hair-ink"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["legs merge into one mass at the hip; no crotch gap"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "legs-region"], "details": ["legs merge into one mass at the hip; no crotch gap"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(49, 58, 81, 1.0)", "secondaryAlbedo": "rgba(43, 51, 71, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_leg_l_20.add(mesh_leg_l_20);
  meshes["leg-l"] = mesh_leg_l_20;
  colliders["leg-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["neck"] ??= [];
  destructionGroups["neck"].push(node_leg_l_20);

  const attachment_leg_r_21 = {"parentId": "legs-group", "parentSocket": "hip-r", "localStart": [0.105, 0.0, 0], "localEnd": [0.133, -0.373, 0], "contactType": "socket", "embedDepth": 0.06, "gapTolerance": 0.004, "baseRadius": 0.083, "endRadius": 0.067, "notes": "Trouser leg from the hip at y=0.660 to the ankle at y=0.287, tapering 0.166u to 0.134u as measured.", "evidenceRefs": ["full-object"]};
  const endpoint_leg_r_21 = makeAttachmentEndpoint(attachment_leg_r_21);
  const node_leg_r_21 = new THREE.Group();
  node_leg_r_21.name = "Leg right__pivot";
  if (endpoint_leg_r_21) {
    node_leg_r_21.position.copy(endpoint_leg_r_21.start);
    node_leg_r_21.rotation.set(0, 0, 0);
    node_leg_r_21.scale.set(1, 1, 1);
  } else {
    node_leg_r_21.position.set(0.119, -0.187, 0.0);
    node_leg_r_21.rotation.set(0.0, 0.0, 0.0);
    node_leg_r_21.scale.set(0.15, 0.373, 0.15);
  }
  node_leg_r_21.userData.sculptComponent = {"id": "leg-r", "name": "Leg right", "level": "macro", "role": "limb", "importance": 0.9, "confidence": 0.85, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Leg right is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "legs-group", "attachment": {"parentId": "legs-group", "parentSocket": "hip-r", "localStart": [0.105, 0.0, 0], "localEnd": [0.133, -0.373, 0], "contactType": "socket", "embedDepth": 0.06, "gapTolerance": 0.004, "baseRadius": 0.083, "endRadius": 0.067, "notes": "Trouser leg from the hip at y=0.660 to the ankle at y=0.287, tapering 0.166u to 0.134u as measured.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.15, "height": 0.373, "depth": 0.15, "units": "world", "confidence": 0.9}, "transform": {"position": [0.119, -0.187, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0.2415, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "hair-ink", "materialLayers": ["hair-ink"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["mirror of leg-l"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "legs-region"], "details": ["mirror of leg-l"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(49, 58, 81, 1.0)", "secondaryAlbedo": "rgba(43, 51, 71, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_leg_r_21.userData.actionProfile = {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0.2415, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["legs-group"] ?? root).add(node_leg_r_21);
  nodes["leg-r"] = node_leg_r_21;
  const mesh_leg_r_21Geometry = endpoint_leg_r_21
    ? new THREE.CylinderGeometry(endpoint_leg_r_21.endRadius, endpoint_leg_r_21.baseRadius, endpoint_leg_r_21.length, 20, 3)
    : new THREE.CapsuleGeometry(0.35, 0.7, 6, 20);
  const mesh_leg_r_21 = new THREE.Mesh(
    mesh_leg_r_21Geometry,
    materialMap["hair-ink"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leg_r_21.name = "Leg right";
  if (endpoint_leg_r_21) {
    mesh_leg_r_21.position.copy(endpoint_leg_r_21.midpoint);
    mesh_leg_r_21.quaternion.copy(endpoint_leg_r_21.quaternion);
  }
  mesh_leg_r_21.castShadow = options.castShadow ?? true;
  mesh_leg_r_21.receiveShadow = options.receiveShadow ?? true;
  mesh_leg_r_21.userData.sculptComponent = {"id": "leg-r", "name": "Leg right", "level": "macro", "role": "limb", "importance": 0.9, "confidence": 0.85, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "Leg right is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "legs-group", "attachment": {"parentId": "legs-group", "parentSocket": "hip-r", "localStart": [0.105, 0.0, 0], "localEnd": [0.133, -0.373, 0], "contactType": "socket", "embedDepth": 0.06, "gapTolerance": 0.004, "baseRadius": 0.083, "endRadius": 0.067, "notes": "Trouser leg from the hip at y=0.660 to the ankle at y=0.287, tapering 0.166u to 0.134u as measured.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.15, "height": 0.373, "depth": 0.15, "units": "world", "confidence": 0.9}, "transform": {"position": [0.119, -0.187, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0.2415, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "hair-ink", "materialLayers": ["hair-ink"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["mirror of leg-l"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "legs-region"], "details": ["mirror of leg-l"], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(49, 58, 81, 1.0)", "secondaryAlbedo": "rgba(43, 51, 71, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_leg_r_21.add(mesh_leg_r_21);
  meshes["leg-r"] = mesh_leg_r_21;
  colliders["leg-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["neck"] ??= [];
  destructionGroups["neck"].push(node_leg_r_21);

  const attachment_shoe_l_22 = {"parentId": "leg-l", "parentSocket": "ankle-l", "localStart": [-0.055, -0.395, 0.03], "localEnd": [-0.055, -0.395, 0.03], "contactType": "socket", "embedDepth": 0.035, "gapTolerance": 0.004, "notes": "Sneaker upper seated on the ankle. Depth is inferred: a single front view cannot show shoe length.", "evidenceRefs": ["full-object"]};
  const endpoint_shoe_l_22 = makeAttachmentEndpoint(attachment_shoe_l_22);
  const node_shoe_l_22 = new THREE.Group();
  node_shoe_l_22.name = "Sneaker left__pivot";
  if (endpoint_shoe_l_22) {
    node_shoe_l_22.position.copy(endpoint_shoe_l_22.start);
    node_shoe_l_22.rotation.set(0, 0, 0);
    node_shoe_l_22.scale.set(1, 1, 1);
  } else {
    node_shoe_l_22.position.set(-0.055, -0.4725, 0.06);
    node_shoe_l_22.rotation.set(0.0, 0.0, 0.0);
    node_shoe_l_22.scale.set(0.198, 0.205, 0.3);
  }
  node_shoe_l_22.userData.sculptComponent = {"id": "shoe-l", "name": "Sneaker left", "level": "meso", "role": "limb", "importance": 0.9, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Sneaker left is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg-l", "attachment": {"parentId": "leg-l", "parentSocket": "ankle-l", "localStart": [-0.055, -0.395, 0.03], "localEnd": [-0.055, -0.395, 0.03], "contactType": "socket", "embedDepth": 0.035, "gapTolerance": 0.004, "notes": "Sneaker upper seated on the ankle. Depth is inferred: a single front view cannot show shoe length.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.198, "height": 0.205, "depth": 0.3, "units": "world", "confidence": 0.6}, "transform": {"position": [-0.055, -0.4725, 0.06], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0.1, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "shoe-cream", "materialLayers": ["shoe-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["chunky upper, rounded toe", "lace/panel lines across the tongue"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "feet-region"], "details": ["chunky upper, rounded toe", "lace/panel lines across the tongue"], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(239, 230, 217, 1.0)", "secondaryAlbedo": "rgba(210, 202, 191, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_shoe_l_22.userData.actionProfile = {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0.1, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["leg-l"] ?? root).add(node_shoe_l_22);
  nodes["shoe-l"] = node_shoe_l_22;
  const mesh_shoe_l_22Geometry = endpoint_shoe_l_22
    ? new THREE.CylinderGeometry(endpoint_shoe_l_22.endRadius, endpoint_shoe_l_22.baseRadius, endpoint_shoe_l_22.length, 20, 3)
    : runnerFootGeometry(false);
  const mesh_shoe_l_22 = new THREE.Mesh(
    mesh_shoe_l_22Geometry,
    materialMap["shoe-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shoe_l_22.name = "Sneaker left";
  if (endpoint_shoe_l_22) {
    mesh_shoe_l_22.position.copy(endpoint_shoe_l_22.midpoint);
    mesh_shoe_l_22.quaternion.copy(endpoint_shoe_l_22.quaternion);
  }
  mesh_shoe_l_22.castShadow = options.castShadow ?? true;
  mesh_shoe_l_22.receiveShadow = options.receiveShadow ?? true;
  mesh_shoe_l_22.userData.sculptComponent = {"id": "shoe-l", "name": "Sneaker left", "level": "meso", "role": "limb", "importance": 0.9, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Sneaker left is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg-l", "attachment": {"parentId": "leg-l", "parentSocket": "ankle-l", "localStart": [-0.055, -0.395, 0.03], "localEnd": [-0.055, -0.395, 0.03], "contactType": "socket", "embedDepth": 0.035, "gapTolerance": 0.004, "notes": "Sneaker upper seated on the ankle. Depth is inferred: a single front view cannot show shoe length.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.198, "height": 0.205, "depth": 0.3, "units": "world", "confidence": 0.6}, "transform": {"position": [-0.055, -0.4725, 0.06], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0.1, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "shoe-cream", "materialLayers": ["shoe-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["chunky upper, rounded toe", "lace/panel lines across the tongue"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "feet-region"], "details": ["chunky upper, rounded toe", "lace/panel lines across the tongue"], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(239, 230, 217, 1.0)", "secondaryAlbedo": "rgba(210, 202, 191, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_shoe_l_22.add(mesh_shoe_l_22);
  meshes["shoe-l"] = mesh_shoe_l_22;
  colliders["shoe-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["neck"] ??= [];
  destructionGroups["neck"].push(node_shoe_l_22);

  const attachment_shoe_r_23 = {"parentId": "leg-r", "parentSocket": "ankle-r", "localStart": [0.055, -0.395, 0.03], "localEnd": [0.055, -0.395, 0.03], "contactType": "socket", "embedDepth": 0.035, "gapTolerance": 0.004, "notes": "Sneaker upper seated on the ankle. Depth is inferred: a single front view cannot show shoe length.", "evidenceRefs": ["full-object"]};
  const endpoint_shoe_r_23 = makeAttachmentEndpoint(attachment_shoe_r_23);
  const node_shoe_r_23 = new THREE.Group();
  node_shoe_r_23.name = "Sneaker right__pivot";
  if (endpoint_shoe_r_23) {
    node_shoe_r_23.position.copy(endpoint_shoe_r_23.start);
    node_shoe_r_23.rotation.set(0, 0, 0);
    node_shoe_r_23.scale.set(1, 1, 1);
  } else {
    node_shoe_r_23.position.set(0.055, -0.4725, 0.06);
    node_shoe_r_23.rotation.set(0.0, 0.0, 0.0);
    node_shoe_r_23.scale.set(0.198, 0.205, 0.3);
  }
  node_shoe_r_23.userData.sculptComponent = {"id": "shoe-r", "name": "Sneaker right", "level": "meso", "role": "limb", "importance": 0.9, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Sneaker right is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg-r", "attachment": {"parentId": "leg-r", "parentSocket": "ankle-r", "localStart": [0.055, -0.395, 0.03], "localEnd": [0.055, -0.395, 0.03], "contactType": "socket", "embedDepth": 0.035, "gapTolerance": 0.004, "notes": "Sneaker upper seated on the ankle. Depth is inferred: a single front view cannot show shoe length.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.198, "height": 0.205, "depth": 0.3, "units": "world", "confidence": 0.6}, "transform": {"position": [0.055, -0.4725, 0.06], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0.1, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "shoe-cream", "materialLayers": ["shoe-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["mirror of shoe-l"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "feet-region"], "details": ["mirror of shoe-l"], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(239, 230, 217, 1.0)", "secondaryAlbedo": "rgba(210, 202, 191, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_shoe_r_23.userData.actionProfile = {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0.1, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["leg-r"] ?? root).add(node_shoe_r_23);
  nodes["shoe-r"] = node_shoe_r_23;
  const mesh_shoe_r_23Geometry = endpoint_shoe_r_23
    ? new THREE.CylinderGeometry(endpoint_shoe_r_23.endRadius, endpoint_shoe_r_23.baseRadius, endpoint_shoe_r_23.length, 20, 3)
    : runnerFootGeometry(false);
  const mesh_shoe_r_23 = new THREE.Mesh(
    mesh_shoe_r_23Geometry,
    materialMap["shoe-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shoe_r_23.name = "Sneaker right";
  if (endpoint_shoe_r_23) {
    mesh_shoe_r_23.position.copy(endpoint_shoe_r_23.midpoint);
    mesh_shoe_r_23.quaternion.copy(endpoint_shoe_r_23.quaternion);
  }
  mesh_shoe_r_23.castShadow = options.castShadow ?? true;
  mesh_shoe_r_23.receiveShadow = options.receiveShadow ?? true;
  mesh_shoe_r_23.userData.sculptComponent = {"id": "shoe-r", "name": "Sneaker right", "level": "meso", "role": "limb", "importance": 0.9, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Sneaker right is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg-r", "attachment": {"parentId": "leg-r", "parentSocket": "ankle-r", "localStart": [0.055, -0.395, 0.03], "localEnd": [0.055, -0.395, 0.03], "contactType": "socket", "embedDepth": 0.035, "gapTolerance": 0.004, "notes": "Sneaker upper seated on the ankle. Depth is inferred: a single front view cannot show shoe length.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.198, "height": 0.205, "depth": 0.3, "units": "world", "confidence": 0.6}, "transform": {"position": [0.055, -0.4725, 0.06], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0.1, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "shoe-cream", "materialLayers": ["shoe-cream"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["mirror of shoe-l"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "feet-region"], "details": ["mirror of shoe-l"], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(239, 230, 217, 1.0)", "secondaryAlbedo": "rgba(210, 202, 191, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_shoe_r_23.add(mesh_shoe_r_23);
  meshes["shoe-r"] = mesh_shoe_r_23;
  colliders["shoe-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["neck"] ??= [];
  destructionGroups["neck"].push(node_shoe_r_23);

  const attachment_sole_l_24 = {"parentId": "leg-l", "parentSocket": "ankle-l", "localStart": [-0.055, -0.57, 0.055], "localEnd": [-0.055, -0.57, 0.055], "contactType": "fused", "embedDepth": 0.02, "gapTolerance": 0.004, "notes": "Outsole slab proud of the upper on every side. Parented to the leg rather than the shoe so the shoe's dimension scale cannot cascade into it.", "evidenceRefs": ["full-object"]};
  const endpoint_sole_l_24 = makeAttachmentEndpoint(attachment_sole_l_24);
  const node_sole_l_24 = new THREE.Group();
  node_sole_l_24.name = "Sole left__pivot";
  if (endpoint_sole_l_24) {
    node_sole_l_24.position.copy(endpoint_sole_l_24.start);
    node_sole_l_24.rotation.set(0, 0, 0);
    node_sole_l_24.scale.set(1, 1, 1);
  } else {
    node_sole_l_24.position.set(-0.055, -0.6175, 0.06);
    node_sole_l_24.rotation.set(0.0, 0.0, 0.0);
    node_sole_l_24.scale.set(0.232, 0.085, 0.318);
  }
  node_sole_l_24.userData.sculptComponent = {"id": "sole-l", "name": "Sole left", "level": "meso", "role": "detail", "importance": 0.6, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Sole left is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg-l", "attachment": {"parentId": "leg-l", "parentSocket": "ankle-l", "localStart": [-0.055, -0.57, 0.055], "localEnd": [-0.055, -0.57, 0.055], "contactType": "fused", "embedDepth": 0.02, "gapTolerance": 0.004, "notes": "Outsole slab proud of the upper on every side. Parented to the leg rather than the shoe so the shoe's dimension scale cannot cascade into it.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.232, "height": 0.085, "depth": 0.318, "units": "world", "confidence": 0.6}, "transform": {"position": [-0.055, -0.6175, 0.06], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0.03, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "shoe-sole", "materialLayers": ["shoe-sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["raised rim proud of the upper by 0.005u per side; the ground-contact read"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "feet-region"], "details": ["raised rim proud of the upper; the ground-contact read"], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(37, 45, 66, 1.0)", "secondaryAlbedo": "rgba(33, 40, 58, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.9}};
  node_sole_l_24.userData.actionProfile = {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0.03, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["leg-l"] ?? root).add(node_sole_l_24);
  nodes["sole-l"] = node_sole_l_24;
  const mesh_sole_l_24Geometry = endpoint_sole_l_24
    ? new THREE.CylinderGeometry(endpoint_sole_l_24.endRadius, endpoint_sole_l_24.baseRadius, endpoint_sole_l_24.length, 20, 3)
    : runnerFootGeometry(true);
  const mesh_sole_l_24 = new THREE.Mesh(
    mesh_sole_l_24Geometry,
    materialMap["shoe-sole"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_sole_l_24.name = "Sole left";
  if (endpoint_sole_l_24) {
    mesh_sole_l_24.position.copy(endpoint_sole_l_24.midpoint);
    mesh_sole_l_24.quaternion.copy(endpoint_sole_l_24.quaternion);
  }
  mesh_sole_l_24.castShadow = options.castShadow ?? true;
  mesh_sole_l_24.receiveShadow = options.receiveShadow ?? true;
  mesh_sole_l_24.userData.sculptComponent = {"id": "sole-l", "name": "Sole left", "level": "meso", "role": "detail", "importance": 0.6, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Sole left is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg-l", "attachment": {"parentId": "leg-l", "parentSocket": "ankle-l", "localStart": [-0.055, -0.57, 0.055], "localEnd": [-0.055, -0.57, 0.055], "contactType": "fused", "embedDepth": 0.02, "gapTolerance": 0.004, "notes": "Outsole slab proud of the upper on every side. Parented to the leg rather than the shoe so the shoe's dimension scale cannot cascade into it.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.232, "height": 0.085, "depth": 0.318, "units": "world", "confidence": 0.6}, "transform": {"position": [-0.055, -0.6175, 0.06], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0.03, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "shoe-sole", "materialLayers": ["shoe-sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["raised rim proud of the upper by 0.005u per side; the ground-contact read"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "feet-region"], "details": ["raised rim proud of the upper; the ground-contact read"], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(37, 45, 66, 1.0)", "secondaryAlbedo": "rgba(33, 40, 58, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.9}};
  node_sole_l_24.add(mesh_sole_l_24);
  meshes["sole-l"] = mesh_sole_l_24;
  colliders["sole-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["neck"] ??= [];
  destructionGroups["neck"].push(node_sole_l_24);

  const attachment_sole_r_25 = {"parentId": "leg-r", "parentSocket": "ankle-r", "localStart": [0.055, -0.57, 0.055], "localEnd": [0.055, -0.57, 0.055], "contactType": "fused", "embedDepth": 0.02, "gapTolerance": 0.004, "notes": "Outsole slab proud of the upper on every side. Parented to the leg rather than the shoe so the shoe's dimension scale cannot cascade into it.", "evidenceRefs": ["full-object"]};
  const endpoint_sole_r_25 = makeAttachmentEndpoint(attachment_sole_r_25);
  const node_sole_r_25 = new THREE.Group();
  node_sole_r_25.name = "Sole right__pivot";
  if (endpoint_sole_r_25) {
    node_sole_r_25.position.copy(endpoint_sole_r_25.start);
    node_sole_r_25.rotation.set(0, 0, 0);
    node_sole_r_25.scale.set(1, 1, 1);
  } else {
    node_sole_r_25.position.set(0.055, -0.6175, 0.06);
    node_sole_r_25.rotation.set(0.0, 0.0, 0.0);
    node_sole_r_25.scale.set(0.232, 0.085, 0.318);
  }
  node_sole_r_25.userData.sculptComponent = {"id": "sole-r", "name": "Sole right", "level": "meso", "role": "detail", "importance": 0.6, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Sole right is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg-r", "attachment": {"parentId": "leg-r", "parentSocket": "ankle-r", "localStart": [0.055, -0.57, 0.055], "localEnd": [0.055, -0.57, 0.055], "contactType": "fused", "embedDepth": 0.02, "gapTolerance": 0.004, "notes": "Outsole slab proud of the upper on every side. Parented to the leg rather than the shoe so the shoe's dimension scale cannot cascade into it.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.232, "height": 0.085, "depth": 0.318, "units": "world", "confidence": 0.6}, "transform": {"position": [0.055, -0.6175, 0.06], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0.03, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "shoe-sole", "materialLayers": ["shoe-sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["raised rim proud of the upper by 0.005u per side; the ground-contact read"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "feet-region"], "details": ["mirror of sole-l"], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(37, 45, 66, 1.0)", "secondaryAlbedo": "rgba(33, 40, 58, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.9}};
  node_sole_r_25.userData.actionProfile = {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0.03, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["leg-r"] ?? root).add(node_sole_r_25);
  nodes["sole-r"] = node_sole_r_25;
  const mesh_sole_r_25Geometry = endpoint_sole_r_25
    ? new THREE.CylinderGeometry(endpoint_sole_r_25.endRadius, endpoint_sole_r_25.baseRadius, endpoint_sole_r_25.length, 20, 3)
    : runnerFootGeometry(true);
  const mesh_sole_r_25 = new THREE.Mesh(
    mesh_sole_r_25Geometry,
    materialMap["shoe-sole"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_sole_r_25.name = "Sole right";
  if (endpoint_sole_r_25) {
    mesh_sole_r_25.position.copy(endpoint_sole_r_25.midpoint);
    mesh_sole_r_25.quaternion.copy(endpoint_sole_r_25.quaternion);
  }
  mesh_sole_r_25.castShadow = options.castShadow ?? true;
  mesh_sole_r_25.receiveShadow = options.receiveShadow ?? true;
  mesh_sole_r_25.userData.sculptComponent = {"id": "sole-r", "name": "Sole right", "level": "meso", "role": "detail", "importance": 0.6, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Sole right is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "leg-r", "attachment": {"parentId": "leg-r", "parentSocket": "ankle-r", "localStart": [0.055, -0.57, 0.055], "localEnd": [0.055, -0.57, 0.055], "contactType": "fused", "embedDepth": 0.02, "gapTolerance": 0.004, "notes": "Outsole slab proud of the upper on every side. Parented to the leg rather than the shoe so the shoe's dimension scale cannot cascade into it.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.232, "height": 0.085, "depth": 0.318, "units": "world", "confidence": 0.6}, "transform": {"position": [0.055, -0.6175, 0.06], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "swing", "pivot": {"mode": "end", "localPosition": [0, 0.03, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "shoe-sole", "materialLayers": ["shoe-sole"], "deformations": [], "joints": [], "seams": [], "localFeatures": ["raised rim proud of the upper by 0.005u per side; the ground-contact read"], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "feet-region"], "details": ["mirror of sole-l"], "fidelityTier": "structural-pass", "colorMaterialRecipe": {"dominantAlbedo": "rgba(37, 45, 66, 1.0)", "secondaryAlbedo": "rgba(33, 40, 58, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.9}};
  node_sole_r_25.add(mesh_sole_r_25);
  meshes["sole-r"] = mesh_sole_r_25;
  colliders["sole-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["neck"] ??= [];
  destructionGroups["neck"].push(node_sole_r_25);

  const attachment_shoulder_l_26 = {"parentId": "body-group", "parentSocket": "shoulder-l", "localStart": [-0.168, 0.18999999999999995, 0], "localEnd": [-0.168, 0.18999999999999995, 0], "contactType": "fused", "embedDepth": 0.055, "gapTolerance": 0.004, "notes": "Deltoid cap fusing sleeve to shirt. It is what makes the shoulder read round instead of showing the sleeve's flat top cap.", "evidenceRefs": ["full-object"]};
  const endpoint_shoulder_l_26 = makeAttachmentEndpoint(attachment_shoulder_l_26);
  const node_shoulder_l_26 = new THREE.Group();
  node_shoulder_l_26.name = "Shoulder cap left__pivot";
  if (endpoint_shoulder_l_26) {
    node_shoulder_l_26.position.copy(endpoint_shoulder_l_26.start);
    node_shoulder_l_26.rotation.set(0, 0, 0);
    node_shoulder_l_26.scale.set(1, 1, 1);
  } else {
    node_shoulder_l_26.position.set(-0.168, 0.18999999999999995, 0.0);
    node_shoulder_l_26.rotation.set(0.0, 0.0, 0.0);
    node_shoulder_l_26.scale.set(0.165, 0.165, 0.165);
  }
  node_shoulder_l_26.userData.sculptComponent = {"id": "shoulder-l", "name": "Shoulder cap left", "level": "macro", "role": "detail", "importance": 0.9, "confidence": 0.85, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Hand left is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "body-group", "attachment": {"parentId": "body-group", "parentSocket": "shoulder-l", "localStart": [-0.168, 0.18999999999999995, 0], "localEnd": [-0.168, 0.18999999999999995, 0], "contactType": "fused", "embedDepth": 0.055, "gapTolerance": 0.004, "notes": "Deltoid cap fusing sleeve to shirt. It is what makes the shoulder read round instead of showing the sleeve's flat top cap.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.165, "height": 0.165, "depth": 0.165, "units": "world", "confidence": 0.7}, "transform": {"position": [-0.168, 0.18999999999999995, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "end", "localPosition": [0, 0.065, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "torso-purple", "materialLayers": ["torso-purple"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "torso-region"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(251, 223, 180, 1.0)", "secondaryAlbedo": "rgba(221, 196, 158, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_shoulder_l_26.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "end", "localPosition": [0, 0.065, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["body-group"] ?? root).add(node_shoulder_l_26);
  nodes["shoulder-l"] = node_shoulder_l_26;
  const mesh_shoulder_l_26Geometry = endpoint_shoulder_l_26
    ? new THREE.CylinderGeometry(endpoint_shoulder_l_26.endRadius, endpoint_shoulder_l_26.baseRadius, endpoint_shoulder_l_26.length, 20, 3)
    : new THREE.SphereGeometry(0.5, 24, 16);
  const mesh_shoulder_l_26 = new THREE.Mesh(
    mesh_shoulder_l_26Geometry,
    materialMap["torso-purple"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shoulder_l_26.name = "Shoulder cap left";
  if (endpoint_shoulder_l_26) {
    mesh_shoulder_l_26.position.copy(endpoint_shoulder_l_26.midpoint);
    mesh_shoulder_l_26.quaternion.copy(endpoint_shoulder_l_26.quaternion);
  }
  mesh_shoulder_l_26.castShadow = options.castShadow ?? true;
  mesh_shoulder_l_26.receiveShadow = options.receiveShadow ?? true;
  mesh_shoulder_l_26.userData.sculptComponent = {"id": "shoulder-l", "name": "Shoulder cap left", "level": "macro", "role": "detail", "importance": 0.9, "confidence": 0.85, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Hand left is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "body-group", "attachment": {"parentId": "body-group", "parentSocket": "shoulder-l", "localStart": [-0.168, 0.18999999999999995, 0], "localEnd": [-0.168, 0.18999999999999995, 0], "contactType": "fused", "embedDepth": 0.055, "gapTolerance": 0.004, "notes": "Deltoid cap fusing sleeve to shirt. It is what makes the shoulder read round instead of showing the sleeve's flat top cap.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.165, "height": 0.165, "depth": 0.165, "units": "world", "confidence": 0.7}, "transform": {"position": [-0.168, 0.18999999999999995, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "end", "localPosition": [0, 0.065, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "torso-purple", "materialLayers": ["torso-purple"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "torso-region"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(251, 223, 180, 1.0)", "secondaryAlbedo": "rgba(221, 196, 158, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_shoulder_l_26.add(mesh_shoulder_l_26);
  meshes["shoulder-l"] = mesh_shoulder_l_26;
  colliders["shoulder-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["neck"] ??= [];
  destructionGroups["neck"].push(node_shoulder_l_26);

  const attachment_shoulder_r_27 = {"parentId": "body-group", "parentSocket": "shoulder-r", "localStart": [0.168, 0.18999999999999995, 0], "localEnd": [0.168, 0.18999999999999995, 0], "contactType": "fused", "embedDepth": 0.055, "gapTolerance": 0.004, "notes": "Deltoid cap fusing sleeve to shirt. It is what makes the shoulder read round instead of showing the sleeve's flat top cap.", "evidenceRefs": ["full-object"]};
  const endpoint_shoulder_r_27 = makeAttachmentEndpoint(attachment_shoulder_r_27);
  const node_shoulder_r_27 = new THREE.Group();
  node_shoulder_r_27.name = "Shoulder cap right__pivot";
  if (endpoint_shoulder_r_27) {
    node_shoulder_r_27.position.copy(endpoint_shoulder_r_27.start);
    node_shoulder_r_27.rotation.set(0, 0, 0);
    node_shoulder_r_27.scale.set(1, 1, 1);
  } else {
    node_shoulder_r_27.position.set(0.168, 0.18999999999999995, 0.0);
    node_shoulder_r_27.rotation.set(0.0, 0.0, 0.0);
    node_shoulder_r_27.scale.set(0.165, 0.165, 0.165);
  }
  node_shoulder_r_27.userData.sculptComponent = {"id": "shoulder-r", "name": "Shoulder cap right", "level": "macro", "role": "detail", "importance": 0.9, "confidence": 0.85, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Hand left is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "body-group", "attachment": {"parentId": "body-group", "parentSocket": "shoulder-r", "localStart": [0.168, 0.18999999999999995, 0], "localEnd": [0.168, 0.18999999999999995, 0], "contactType": "fused", "embedDepth": 0.055, "gapTolerance": 0.004, "notes": "Deltoid cap fusing sleeve to shirt. It is what makes the shoulder read round instead of showing the sleeve's flat top cap.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.165, "height": 0.165, "depth": 0.165, "units": "world", "confidence": 0.7}, "transform": {"position": [0.168, 0.18999999999999995, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "end", "localPosition": [0, 0.065, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "torso-purple", "materialLayers": ["torso-purple"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "torso-region"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(251, 223, 180, 1.0)", "secondaryAlbedo": "rgba(221, 196, 158, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_shoulder_r_27.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "end", "localPosition": [0, 0.065, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}};
  (nodes["body-group"] ?? root).add(node_shoulder_r_27);
  nodes["shoulder-r"] = node_shoulder_r_27;
  const mesh_shoulder_r_27Geometry = endpoint_shoulder_r_27
    ? new THREE.CylinderGeometry(endpoint_shoulder_r_27.endRadius, endpoint_shoulder_r_27.baseRadius, endpoint_shoulder_r_27.length, 20, 3)
    : new THREE.SphereGeometry(0.5, 24, 16);
  const mesh_shoulder_r_27 = new THREE.Mesh(
    mesh_shoulder_r_27Geometry,
    materialMap["torso-purple"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shoulder_r_27.name = "Shoulder cap right";
  if (endpoint_shoulder_r_27) {
    mesh_shoulder_r_27.position.copy(endpoint_shoulder_r_27.midpoint);
    mesh_shoulder_r_27.quaternion.copy(endpoint_shoulder_r_27.quaternion);
  }
  mesh_shoulder_r_27.castShadow = options.castShadow ?? true;
  mesh_shoulder_r_27.receiveShadow = options.receiveShadow ?? true;
  mesh_shoulder_r_27.userData.sculptComponent = {"id": "shoulder-r", "name": "Shoulder cap right", "level": "macro", "role": "detail", "importance": 0.9, "confidence": 0.85, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Hand left is a discrete rounded primitive assembled onto the figure. The reference is a toy render with no continuous sculpted transitions, so an assembled solid is the honest decomposition.", "geometryDescriptor": {"topologyIntent": "rounded stylised body part; nothing in the figure has a hard edge", "edgeTreatment": {"type": "uniform-bevel", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "smooth vertex normals"}, "parent": "body-group", "attachment": {"parentId": "body-group", "parentSocket": "shoulder-r", "localStart": [0.168, 0.18999999999999995, 0], "localEnd": [0.168, 0.18999999999999995, 0], "contactType": "fused", "embedDepth": 0.055, "gapTolerance": 0.004, "notes": "Deltoid cap fusing sleeve to shirt. It is what makes the shoulder read round instead of showing the sleeve's flat top cap.", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.165, "height": 0.165, "depth": 0.165, "units": "world", "confidence": 0.7}, "transform": {"position": [0.168, 0.18999999999999995, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "end", "localPosition": [0, 0.065, 0], "axis": [1, 0, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "neck", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin"}}, "material": "torso-purple", "materialLayers": ["torso-purple"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "torso-region"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(251, 223, 180, 1.0)", "secondaryAlbedo": "rgba(221, 196, 158, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}};
  node_shoulder_r_27.add(mesh_shoulder_r_27);
  meshes["shoulder-r"] = mesh_shoulder_r_27;
  colliders["shoulder-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["neck"] ??= [];
  destructionGroups["neck"].push(node_shoulder_r_27);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 1024, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "Extraction ran on a per-material crop and its numbers are recorded verbatim, but the extracted maps are NOT bound to the runtime material and referencePbr.usable is false. Three reasons, in order of weight. (1) Inspecting the generated maps shows the albedo is a flat colour carrying the reference's own lighting falloff, the height/normal/roughness channels are the render's compression grain upsampled from a small crop, and the AO channel is essentially white; tiling them would paint the reference's shading and its codec noise onto every surface. (2) The factory's referenceMapUrl() loads these maps by absolute disk path, which cannot resolve in a browser, so usable:true would break the runtime. (3) Thirty-five 1024px PNGs is not a viable budget for a player character in a web game. The runtime instead builds five independent procedural canvas fields per material, and the extracted palettes and roughness estimates are used as evidence for the scalars.", "ranAnyway": true, "measuredConfidence": {"eye-ink": 0.741, "hair-ink": 0.729, "hair-ink-alt-trouser": 0.717, "shoe-cream": 0.787, "shoe-sole": 0.763, "skin": 0.672, "strap-coral": 0.679, "torso-purple": 0.751}, "belowTarget": ["skin", "strap-coral"]}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createMAKEITWORSERunnerLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "MAKE IT WORSE Runner look-dev lights";
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
  lights.userData.lightingFromPhoto = ["Key light: a single soft source high and very slightly camera-right. Sampled around the face at a fixed 110 px radius, relative luminance peaks at 0.901 at the top of the ring and falls to 0.602 directly under the chin, and the right cheek reads 0.852 against the left cheek's 0.818. A 4% left-right difference against a 50% top-bottom difference means elevation dominates and the horizontal bias is small.", "Fill light: dominant. The shadow side of the head never falls below 0.602 while the lit side peaks at 0.901, so fill sits at about 67% of key. A warm hemisphere reproduces that near-shadowless range; anything approaching a 3:1 key-to-fill ratio drives the underside of the chin far darker than the reference.", "Rim and environment light: the reference has none. The shirt silhouette edge reads 0.411 against 0.477 at the shirt's centre, so the outline is darker than the interior rather than lifted. The background is flat #DBDBDB with no gradient, measured within 2/255 at all four corners and at centre. The reference-matched review render therefore disables the rim; the game scene supplies its own environment.", "Exposure and tone mapping: ACES filmic with sRGB output at exposure 1.0. Nothing in the reference clips. The brightest face pixel is 0.901 relative luminance, well under 1.0, and the darkest hair pixel is 0.19, so the render must hold a narrow band with no blown highlight and no crushed black.", "Contact shadow: absent from the reference and supplied by the game instead. The pixels directly under both shoes measure (219,219,219), identical to the background 400 px away, so the figure is floating on a flat backdrop with no ground shadow. All occlusion in the reference-matched render therefore has to come from the materials' own ambient occlusion response at part intersections."];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 1024, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "Extraction ran on a per-material crop and its numbers are recorded verbatim, but the extracted maps are NOT bound to the runtime material and referencePbr.usable is false. Three reasons, in order of weight. (1) Inspecting the generated maps shows the albedo is a flat colour carrying the reference's own lighting falloff, the height/normal/roughness channels are the render's compression grain upsampled from a small crop, and the AO channel is essentially white; tiling them would paint the reference's shading and its codec noise onto every surface. (2) The factory's referenceMapUrl() loads these maps by absolute disk path, which cannot resolve in a browser, so usable:true would break the runtime. (3) Thirty-five 1024px PNGs is not a viable budget for a player character in a web game. The runtime instead builds five independent procedural canvas fields per material, and the extracted palettes and roughness estimates are used as evidence for the scalars.", "ranAnyway": true, "measuredConfidence": {"eye-ink": 0.741, "hair-ink": 0.729, "hair-ink-alt-trouser": 0.717, "shoe-cream": 0.787, "shoe-sole": 0.763, "skin": 0.672, "strap-coral": 0.679, "torso-purple": 0.751}, "belowTarget": ["skin", "strap-coral"]}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createMAKEITWORSERunnerEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
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
export function frameMAKEITWORSERunnerCamera(
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
export function createMAKEITWORSERunnerPresentationComposer(
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

export function configureMAKEITWORSERunnerRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createMAKEITWORSERunnerInspectControls(
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
