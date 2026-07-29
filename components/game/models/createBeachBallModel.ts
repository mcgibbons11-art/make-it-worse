// --- img2threejs refine-code edits applied by assets/reference/props/refine_props.py
// 1. buildLatheGeometry honours latheProfile.phiStart / phiLength (applied).
// 2. buildExtrudeGeometry honours profile2D.steps / profileStops / profileExempt /
//    axis / axisOffset / smoothShading (not present).
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

// Generated from ObjectSculptSpec target: Apartment Beach Ball
// Sculpt build pass: form-refinement
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createApartmentBeachBallModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Apartment Beach Ball";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": true, "solveMethod": "elevation from the valve cap's screen offset from the sphere centre (327 px of a 431.5 px radius gives 49.4 degrees from the view axis, so 40.6 degrees of camera elevation); azimuth from the measured panel boundary longitudes", "fovDegrees": 26.0, "aspect": 0.75, "orientation": {"yaw": 0.0, "pitch": -40.6, "roll": 0.0}, "targetHint": [0.0, 0.0, 0.0], "note": "A sphere's silhouette carries no camera information, so elevation had to come from the valve cap and the panel boundaries instead. Distance is not fixed here: the preview harness solves it by fitting the render's projected bounding box to the reference bounding box (x 109-971, y 266-1147 of 1086x1448)."}, "approximationNotes": []};

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["gore-coral"] = createSculptMaterial(
    "gore-coral",
    {"id": "gore-coral", "name": "Coral panel vinyl", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte inflated PVC)", "baseColor": "#F2685C", "color": "#F2685C", "albedo": {"dominant": "#F2685C", "secondary": ["#E45B50", "#F8776B"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#F2685C", "#E45B50", "#F8776B"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.62, "variation": 0.08, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; crowns and handled edges trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.2, "contactShadowBias": 0.3, "notes": "Darken every part seam, recess and contact ring."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "coral-seam-shade", "target": "gore-coral-front/gore-seam-edge", "notes": "The panel darkens into its seam groove; the groove is the darkest coral value in the frame.", "evidenceRefs": ["full-object", "equator-zone"], "roughness": 0.7, "aoBoost": 0.45, "mask": "outer 4 percent of the gore width"}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\crops\\gore-coral-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.831, "estimatedFidelity": 0.831, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\pbr\\gore-coral_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\pbr\\gore-coral_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\pbr\\gore-coral_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\pbr\\gore-coral_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\pbr\\gore-coral_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "Two coral gores. Matte inflated vinyl, no specular coat."},
    options
  );
  materialMap["gore-yellow"] = createSculptMaterial(
    "gore-yellow",
    {"id": "gore-yellow", "name": "Yellow panel vinyl", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#FCC348", "color": "#FCC348", "albedo": {"dominant": "#FCC348", "secondary": ["#EDB63C", "#FFD25C"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#FCC348", "#EDB63C", "#FFD25C"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.62, "variation": 0.08, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; crowns and handled edges trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.2, "contactShadowBias": 0.3, "notes": "Darken every part seam, recess and contact ring."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "yellow-crown-sheen", "target": "gore-yellow/panel-crown", "notes": "The panel crown facing the key light is the brightest value in the frame and reads slightly smoother than the panel flanks.", "evidenceRefs": ["full-object", "equator-zone"], "roughness": 0.55, "mask": "central 30 percent of the gore width"}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\crops\\gore-yellow-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.804, "estimatedFidelity": 0.804, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\pbr\\gore-yellow_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\pbr\\gore-yellow_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\pbr\\gore-yellow_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\pbr\\gore-yellow_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\pbr\\gore-yellow_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "One yellow gore, centred on the reference view."},
    options
  );
  materialMap["gore-mint"] = createSculptMaterial(
    "gore-mint",
    {"id": "gore-mint", "name": "Mint panel vinyl", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#86C0A0", "color": "#86C0A0", "albedo": {"dominant": "#86C0A0", "secondary": ["#78B392", "#93CCAC"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#86C0A0", "#78B392", "#93CCAC"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.62, "variation": 0.08, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; crowns and handled edges trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.2, "contactShadowBias": 0.3, "notes": "Darken every part seam, recess and contact ring."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "mint-limb-falloff", "target": "gore-mint/gore-seam-edge", "notes": "The mint panel turns away from the key toward the right limb and loses about 12 percent of its value.", "evidenceRefs": ["full-object", "equator-zone"], "roughness": 0.68, "aoBoost": 0.3, "mask": "outer 20 percent toward the limb"}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\crops\\gore-mint-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.812, "estimatedFidelity": 0.812, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\pbr\\gore-mint_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\pbr\\gore-mint_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\pbr\\gore-mint_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\pbr\\gore-mint_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\pbr\\gore-mint_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "One mint gore."},
    options
  );
  materialMap["gore-cream"] = createSculptMaterial(
    "gore-cream",
    {"id": "gore-cream", "name": "Cream panel vinyl", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#EFE6D6", "color": "#EFE6D6", "albedo": {"dominant": "#EFE6D6", "secondary": ["#E4D9C6", "#F7EFE2"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#EFE6D6", "#E4D9C6", "#F7EFE2"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.6, "variation": 0.08, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; crowns and handled edges trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.2, "contactShadowBias": 0.3, "notes": "Darken every part seam, recess and contact ring."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "cream-seam-shade", "target": "gore-cream-right/gore-seam-edge", "notes": "Cream shows the seam groove more strongly than any other panel because it carries the widest value range.", "evidenceRefs": ["full-object", "equator-zone"], "roughness": 0.7, "aoBoost": 0.5, "mask": "outer 4 percent of the gore width"}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\crops\\gore-cream-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.786, "estimatedFidelity": 0.786, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\pbr\\gore-cream_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\pbr\\gore-cream_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\pbr\\gore-cream_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\pbr\\gore-cream_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\pbr\\gore-cream_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "Two cream gores, both seen edge-on at the limbs in the reference."},
    options
  );
  materialMap["seam-core"] = createSculptMaterial(
    "seam-core",
    {"id": "seam-core", "name": "Seam core shell", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#94897A", "color": "#94897A", "albedo": {"dominant": "#94897A", "secondary": ["#847A6C", "#A79B8B"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#94897A", "#847A6C", "#A79B8B"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.8, "variation": 0.06, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; crowns and handled edges trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.55, "contactShadowBias": 0.3, "notes": "Darken every part seam, recess and contact ring."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "groove-depth-shade", "target": "ball-core/seam-groove-floor", "notes": "Only the 0.6 degree strips between panels are ever visible, and they read as the darkest lines on the ball.", "evidenceRefs": ["full-object", "equator-zone"], "roughness": 0.88, "aoBoost": 0.7, "mask": "entire visible surface"}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\crops\\seam-core-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.702, "estimatedFidelity": 0.702, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\pbr\\seam-core_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\pbr\\seam-core_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\pbr\\seam-core_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\pbr\\seam-core_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\pbr\\seam-core_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "Inner shell 0.014 units under the panels. It is what a seam groove shows, and it stops the panel gaps reading through to the inside of the ball."},
    options
  );
  materialMap["valve-coral"] = createSculptMaterial(
    "valve-coral",
    {"id": "valve-coral", "name": "Valve cap vinyl", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#F2685C", "color": "#F2685C", "albedo": {"dominant": "#F2685C", "secondary": ["#DE564B", "#F8776B"], "samplingNotes": "Median-sampled from named regions of the reference, cross-checked against the extract_pbr_evidence palette for the same crop.", "map": null}, "colorVariation": {"palette": ["#F2685C", "#DE564B", "#F8776B"], "pattern": "very low amplitude injection-moulding tone drift; the reference shows almost no albedo variance", "amplitude": 0.018, "heightCorrelation": 0.18}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [1.0, 1.0], "anisotropy": 8, "texelDensityIntent": "One tile per part so the moulding drift never repeats visibly on a small control; detail stays at object scale rather than stretching with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.3, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.16, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 64.0, "amplitude": 0.05, "role": "matte-texture highlight breakup visible under grazing light"}], "roughness": {"base": 0.55, "variation": 0.07, "map": "independent-procedural-field", "localResponse": "cavities and recessed channels trend rougher; crowns and handled edges trend slightly smoother"}, "metalness": {"base": 0.0, "variation": 0.0}, "clearcoat": {"base": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.18, "scale": 18.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.28, "contactShadowBias": 0.3, "notes": "Darken every part seam, recess and contact ring."}, "wear": {"edgeWear": 0.05, "scratches": [], "chips": []}, "dirt": {"amount": 0.03, "cavityBias": 0.35, "color": "#3B372F"}, "localOverrides": [{"id": "valve-rim-step", "target": "valve-collar/collar-step", "notes": "A hard shadow ring runs where the collar meets the panels.", "evidenceRefs": ["full-object", "pole-zone"], "roughness": 0.66, "aoBoost": 0.55, "mask": "collar outer wall"}], "envMapIntensity": 0.5, "shaderNotes": ["MeshPhysicalMaterial with clearcoat/transmission/sheen at zero: the reference is matte unpolished plastic with no specular coat.", "Albedo, roughness, height, normal and AO are generated as five independent procedural fields; albedo is never aliased into another channel.", "Deterministic seed: the factory hashes the material id, so the noise fields are stable across reloads."], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\crops\\valve-coral-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.744, "estimatedFidelity": 0.744, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "limitationNote": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\pbr\\valve-coral_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\pbr\\valve-coral_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\pbr\\valve-coral_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\pbr\\valve-coral_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\props\\evidence\\ball\\pbr\\valve-coral_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "Valve collar and plug. Slightly smoother than the panels; it is moulded, not welded."},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const attachment_ball_core_0 = null;
  const endpoint_ball_core_0 = makeAttachmentEndpoint(attachment_ball_core_0);
  const node_ball_core_0 = new THREE.Group();
  node_ball_core_0.name = "Seam core shell__pivot";
  if (endpoint_ball_core_0) {
    node_ball_core_0.position.copy(endpoint_ball_core_0.start);
    node_ball_core_0.rotation.set(0, 0, 0);
    node_ball_core_0.scale.set(1, 1, 1);
  } else {
    node_ball_core_0.position.set(0.0, 0.0, 0.0);
    node_ball_core_0.rotation.set(0.0, 0.0, 0.0);
    node_ball_core_0.scale.set(1.0, 1.0, 1.0);
  }
  node_ball_core_0.userData.sculptComponent = {"id": "ball-core", "name": "Seam core shell", "level": "macro", "role": "shell", "importance": 0.8, "confidence": 0.8, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "One smoothly varying closed volume with no internal seam and no flat face: the reference silhouette is circular to within 2.2 percent, so this is a single continuous mass rather than an assembly.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(148, 137, 122, 1.0)", "secondaryAlbedo": "rgba(133, 123, 109, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "full revolution of the panel meridian at 0.009 units under the panel radius, so every seam gap shows a recessed groove floor instead of a hole", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "lathe UVs", "normalStrategy": "smooth vertex normals; the core has no creases", "latheProfile": {"points": [[0.0, -0.741], [0.12867, -0.72974], [0.25344, -0.69631], [0.3705, -0.64172], [0.47631, -0.56764], [0.56764, -0.47631], [0.64172, -0.3705], [0.69631, -0.25344], [0.72974, -0.12867], [0.741, -0.0], [0.72974, 0.12867], [0.69631, 0.25344], [0.64172, 0.3705], [0.56764, 0.47631], [0.47631, 0.56764], [0.3705, 0.64172], [0.25344, 0.69631], [0.12867, 0.72974], [0.0, 0.741]], "segments": 24, "phiStart": 0.0, "phiLength": 6.283185}}, "parent": null, "attachment": null, "dimensions": {"width": 1.482, "height": 1.482, "depth": 1.482, "units": "world", "confidence": 0.85}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "ball-center", "localPosition": [0.0, 0.0, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Centre of mass; the trap's BallCollider is concentric with this."}, {"id": "valve-pole", "localPosition": [0.0, 0.762, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Outer face of the valve; an inflate or deflate effect anchors here."}], "collider": {"type": "sphere", "offset": [0.0, 0.0, 0.0], "scale": [1.5, 1.5, 1.5], "isTrigger": false, "notes": "Sphere proxy at the panel radius, matching the trap's BallCollider."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ball-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "seam-core", "materialLayers": ["seam-core"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "seam-groove-floor", "description": "The 0.6 degree strip between each pair of panels exposes this shell 0.009 units below them, which is what makes the six seams read as grooves rather than lines.", "geometry": "sphere radius set 0.014 under the panel radius; no map involved", "evidenceRefs": ["full-object", "equator-zone"], "confidence": 0.8}, {"id": "polar-closure", "description": "Panels stop 7 degrees short of each pole, so this shell closes the ball at the top under the valve and at the bottom where the reference cannot see.", "geometry": "full sphere behind the six partial lathes", "evidenceRefs": ["full-object", "pole-zone"], "confidence": 0.6}], "surfaceDetail": {"macroRoughness": 0.8, "microRoughness": 0.06, "bumpAmplitude": 0.0, "normalPattern": "smooth vinyl with no relief", "displacementPattern": "none", "occlusionPattern": "deep occlusion in every seam groove", "edgeWearPattern": "none", "notes": "Only 6.6 degrees of this shell's circumference is ever visible."}, "evidenceRefs": ["full-object", "equator-zone", "pole-zone"], "details": [], "fidelityTier": "blockout"};
  node_ball_core_0.userData.actionProfile = node_ball_core_0.userData.sculptComponent.actionProfile;
  (nodes["root"] ?? root).add(node_ball_core_0);
  nodes["ball-core"] = node_ball_core_0;
  const mesh_ball_core_0Geometry = endpoint_ball_core_0
    ? new THREE.CylinderGeometry(endpoint_ball_core_0.endRadius, endpoint_ball_core_0.baseRadius, endpoint_ball_core_0.length, 32, 12)
    : buildLatheGeometry({"points": [[0.0, -0.741], [0.12867, -0.72974], [0.25344, -0.69631], [0.3705, -0.64172], [0.47631, -0.56764], [0.56764, -0.47631], [0.64172, -0.3705], [0.69631, -0.25344], [0.72974, -0.12867], [0.741, -0.0], [0.72974, 0.12867], [0.69631, 0.25344], [0.64172, 0.3705], [0.56764, 0.47631], [0.47631, 0.56764], [0.3705, 0.64172], [0.25344, 0.69631], [0.12867, 0.72974], [0.0, 0.741]], "segments": 24, "phiStart": 0.0, "phiLength": 6.283185});
  const mesh_ball_core_0 = new THREE.Mesh(
    mesh_ball_core_0Geometry,
    materialMap["seam-core"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_ball_core_0.name = "Seam core shell";
  if (endpoint_ball_core_0) {
    mesh_ball_core_0.position.copy(endpoint_ball_core_0.midpoint);
    mesh_ball_core_0.quaternion.copy(endpoint_ball_core_0.quaternion);
  }
  mesh_ball_core_0.castShadow = options.castShadow ?? true;
  mesh_ball_core_0.receiveShadow = options.receiveShadow ?? true;
  mesh_ball_core_0.userData.sculptComponent = node_ball_core_0.userData.sculptComponent;
  node_ball_core_0.add(mesh_ball_core_0);
  meshes["ball-core"] = mesh_ball_core_0;
  colliders["ball-core"] = {"type": "sphere", "offset": [0.0, 0.0, 0.0], "scale": [1.5, 1.5, 1.5], "isTrigger": false, "notes": "Sphere proxy at the panel radius, matching the trap's BallCollider."};
  destructionGroups["ball-shell"] ??= [];
  destructionGroups["ball-shell"].push(node_ball_core_0);
  const socket_ball_core_ball_center_0 = new THREE.Object3D();
  socket_ball_core_ball_center_0.name = "ball-center";
  socket_ball_core_ball_center_0.position.set(0.0, 0.0, 0.0);
  socket_ball_core_ball_center_0.rotation.set(0.0, 0.0, 0.0);
  socket_ball_core_ball_center_0.userData.socket = {"id": "ball-center", "localPosition": [0.0, 0.0, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Centre of mass; the trap's BallCollider is concentric with this."};
  node_ball_core_0.add(socket_ball_core_ball_center_0);
  sockets["ball-core:ball-center"] = socket_ball_core_ball_center_0;
  const socket_ball_core_valve_pole_1 = new THREE.Object3D();
  socket_ball_core_valve_pole_1.name = "valve-pole";
  socket_ball_core_valve_pole_1.position.set(0.0, 0.762, 0.0);
  socket_ball_core_valve_pole_1.rotation.set(0.0, 0.0, 0.0);
  socket_ball_core_valve_pole_1.userData.socket = {"id": "valve-pole", "localPosition": [0.0, 0.762, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Outer face of the valve; an inflate or deflate effect anchors here."};
  node_ball_core_0.add(socket_ball_core_valve_pole_1);
  sockets["ball-core:valve-pole"] = socket_ball_core_valve_pole_1;

  const attachment_gore_coral_front_1 = null;
  const endpoint_gore_coral_front_1 = makeAttachmentEndpoint(attachment_gore_coral_front_1);
  const node_gore_coral_front_1 = new THREE.Group();
  node_gore_coral_front_1.name = "Coral gore__pivot";
  if (endpoint_gore_coral_front_1) {
    node_gore_coral_front_1.position.copy(endpoint_gore_coral_front_1.start);
    node_gore_coral_front_1.rotation.set(0, 0, 0);
    node_gore_coral_front_1.scale.set(1, 1, 1);
  } else {
    node_gore_coral_front_1.position.set(0.0, 0.0, 0.0);
    node_gore_coral_front_1.rotation.set(0.0, 0.0, 0.0);
    node_gore_coral_front_1.scale.set(1.0, 1.0, 1.0);
  }
  node_gore_coral_front_1.userData.sculptComponent = {"id": "gore-coral-front", "name": "Coral gore", "level": "meso", "role": "panel", "importance": 0.9, "confidence": 0.9, "primitive": "lathe", "topologyClass": "conforming-shell", "topologyRationale": "A thin doubly curved panel that follows the core sphere beneath it rather than enclosing a volume of its own; it has no flat face and no crease except at its two meridian edges.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 104, 92, 1.0)", "secondaryAlbedo": "rgba(217, 93, 82, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "60 degree spherical gore from pole to pole, inset 0.3 degrees at each meridian edge so the seam groove opens", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "lathe UVs; one tile per panel", "normalStrategy": "smooth vertex normals across the panel, hard at its meridian edges", "latheProfile": {"points": [[0.0914, -0.74441], [0.20952, -0.72014], [0.32223, -0.67725], [0.4266, -0.61686], [0.51995, -0.54051], [0.59985, -0.4502], [0.66425, -0.34825], [0.71147, -0.23729], [0.74031, -0.1202], [0.75, -0.0], [0.74031, 0.1202], [0.71147, 0.23729], [0.66425, 0.34825], [0.59985, 0.4502], [0.51995, 0.54051], [0.4266, 0.61686], [0.32223, 0.67725], [0.20952, 0.72014], [0.0914, 0.74441]], "segments": 18, "phiStart": -1.56556, "phiLength": 1.036726}}, "parent": "ball-core", "attachment": null, "dimensions": {"width": 1.5, "height": 1.5, "depth": 1.5, "units": "world", "confidence": 0.8}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ball-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "gore-coral", "materialLayers": ["gore-coral"], "deformations": [], "joints": [], "seams": [{"id": "gore-coral-front-core-seam", "with": "ball-core", "overlap": 0.009, "notes": "Panel floats 0.009 units proud of the core; the gap between panels is the groove."}], "localFeatures": [{"id": "gore-seam-edge", "description": "The panel spans 59.4 degrees of longitude from -89.7 degrees, leaving a 0.6 degree groove against each neighbour.", "geometry": "LatheGeometry phiStart/phiLength, which the generated buildLatheGeometry is extended to honour", "evidenceRefs": ["full-object", "equator-zone"], "confidence": 0.9}, {"id": "panel-crown", "description": "The panel's own curvature carries the value gradient across it; the reference shows about 14 percent falloff from crown to seam on the coral panel.", "geometry": "spherical curvature, shaded rather than painted", "evidenceRefs": ["full-object", "equator-zone"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.08, "bumpAmplitude": 0.0, "normalPattern": "smooth inflated vinyl", "displacementPattern": "none", "occlusionPattern": "groove occlusion at both meridian edges", "edgeWearPattern": "none", "notes": "Matte vinyl. No gloss anywhere in the reference."}, "evidenceRefs": ["full-object", "equator-zone"], "details": [], "fidelityTier": "blockout"};
  node_gore_coral_front_1.userData.actionProfile = node_gore_coral_front_1.userData.sculptComponent.actionProfile;
  (nodes["ball-core"] ?? root).add(node_gore_coral_front_1);
  nodes["gore-coral-front"] = node_gore_coral_front_1;
  const mesh_gore_coral_front_1Geometry = endpoint_gore_coral_front_1
    ? new THREE.CylinderGeometry(endpoint_gore_coral_front_1.endRadius, endpoint_gore_coral_front_1.baseRadius, endpoint_gore_coral_front_1.length, 32, 12)
    : buildLatheGeometry({"points": [[0.0914, -0.74441], [0.20952, -0.72014], [0.32223, -0.67725], [0.4266, -0.61686], [0.51995, -0.54051], [0.59985, -0.4502], [0.66425, -0.34825], [0.71147, -0.23729], [0.74031, -0.1202], [0.75, -0.0], [0.74031, 0.1202], [0.71147, 0.23729], [0.66425, 0.34825], [0.59985, 0.4502], [0.51995, 0.54051], [0.4266, 0.61686], [0.32223, 0.67725], [0.20952, 0.72014], [0.0914, 0.74441]], "segments": 18, "phiStart": -1.56556, "phiLength": 1.036726});
  const mesh_gore_coral_front_1 = new THREE.Mesh(
    mesh_gore_coral_front_1Geometry,
    materialMap["gore-coral"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gore_coral_front_1.name = "Coral gore";
  if (endpoint_gore_coral_front_1) {
    mesh_gore_coral_front_1.position.copy(endpoint_gore_coral_front_1.midpoint);
    mesh_gore_coral_front_1.quaternion.copy(endpoint_gore_coral_front_1.quaternion);
  }
  mesh_gore_coral_front_1.castShadow = options.castShadow ?? true;
  mesh_gore_coral_front_1.receiveShadow = options.receiveShadow ?? true;
  mesh_gore_coral_front_1.userData.sculptComponent = node_gore_coral_front_1.userData.sculptComponent;
  node_gore_coral_front_1.add(mesh_gore_coral_front_1);
  meshes["gore-coral-front"] = mesh_gore_coral_front_1;
  colliders["gore-coral-front"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["ball-shell"] ??= [];
  destructionGroups["ball-shell"].push(node_gore_coral_front_1);

  const attachment_gore_yellow_2 = null;
  const endpoint_gore_yellow_2 = makeAttachmentEndpoint(attachment_gore_yellow_2);
  const node_gore_yellow_2 = new THREE.Group();
  node_gore_yellow_2.name = "Yellow gore__pivot";
  if (endpoint_gore_yellow_2) {
    node_gore_yellow_2.position.copy(endpoint_gore_yellow_2.start);
    node_gore_yellow_2.rotation.set(0, 0, 0);
    node_gore_yellow_2.scale.set(1, 1, 1);
  } else {
    node_gore_yellow_2.position.set(0.0, 0.0, 0.0);
    node_gore_yellow_2.rotation.set(0.0, 0.0, 0.0);
    node_gore_yellow_2.scale.set(1.0, 1.0, 1.0);
  }
  node_gore_yellow_2.userData.sculptComponent = {"id": "gore-yellow", "name": "Yellow gore", "level": "meso", "role": "panel", "importance": 0.9, "confidence": 0.92, "primitive": "lathe", "topologyClass": "conforming-shell", "topologyRationale": "A thin doubly curved panel that follows the core sphere beneath it rather than enclosing a volume of its own; it has no flat face and no crease except at its two meridian edges.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(252, 195, 72, 1.0)", "secondaryAlbedo": "rgba(226, 175, 64, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "60 degree spherical gore from pole to pole, inset 0.3 degrees at each meridian edge so the seam groove opens", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "lathe UVs; one tile per panel", "normalStrategy": "smooth vertex normals across the panel, hard at its meridian edges", "latheProfile": {"points": [[0.0914, -0.74441], [0.20952, -0.72014], [0.32223, -0.67725], [0.4266, -0.61686], [0.51995, -0.54051], [0.59985, -0.4502], [0.66425, -0.34825], [0.71147, -0.23729], [0.74031, -0.1202], [0.75, -0.0], [0.74031, 0.1202], [0.71147, 0.23729], [0.66425, 0.34825], [0.59985, 0.4502], [0.51995, 0.54051], [0.4266, 0.61686], [0.32223, 0.67725], [0.20952, 0.72014], [0.0914, 0.74441]], "segments": 18, "phiStart": -0.518363, "phiLength": 1.036726}}, "parent": "ball-core", "attachment": null, "dimensions": {"width": 1.5, "height": 1.5, "depth": 1.5, "units": "world", "confidence": 0.8}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ball-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "gore-yellow", "materialLayers": ["gore-yellow"], "deformations": [], "joints": [], "seams": [{"id": "gore-yellow-core-seam", "with": "ball-core", "overlap": 0.009, "notes": "Panel floats 0.009 units proud of the core; the gap between panels is the groove."}], "localFeatures": [{"id": "gore-seam-edge", "description": "The panel spans 59.4 degrees of longitude from -29.7 degrees, leaving a 0.6 degree groove against each neighbour.", "geometry": "LatheGeometry phiStart/phiLength, which the generated buildLatheGeometry is extended to honour", "evidenceRefs": ["full-object", "equator-zone"], "confidence": 0.92}, {"id": "panel-crown", "description": "The panel's own curvature carries the value gradient across it; the reference shows about 14 percent falloff from crown to seam on the coral panel.", "geometry": "spherical curvature, shaded rather than painted", "evidenceRefs": ["full-object", "equator-zone"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.08, "bumpAmplitude": 0.0, "normalPattern": "smooth inflated vinyl", "displacementPattern": "none", "occlusionPattern": "groove occlusion at both meridian edges", "edgeWearPattern": "none", "notes": "Matte vinyl. No gloss anywhere in the reference."}, "evidenceRefs": ["full-object", "equator-zone"], "details": [], "fidelityTier": "blockout"};
  node_gore_yellow_2.userData.actionProfile = node_gore_yellow_2.userData.sculptComponent.actionProfile;
  (nodes["ball-core"] ?? root).add(node_gore_yellow_2);
  nodes["gore-yellow"] = node_gore_yellow_2;
  const mesh_gore_yellow_2Geometry = endpoint_gore_yellow_2
    ? new THREE.CylinderGeometry(endpoint_gore_yellow_2.endRadius, endpoint_gore_yellow_2.baseRadius, endpoint_gore_yellow_2.length, 32, 12)
    : buildLatheGeometry({"points": [[0.0914, -0.74441], [0.20952, -0.72014], [0.32223, -0.67725], [0.4266, -0.61686], [0.51995, -0.54051], [0.59985, -0.4502], [0.66425, -0.34825], [0.71147, -0.23729], [0.74031, -0.1202], [0.75, -0.0], [0.74031, 0.1202], [0.71147, 0.23729], [0.66425, 0.34825], [0.59985, 0.4502], [0.51995, 0.54051], [0.4266, 0.61686], [0.32223, 0.67725], [0.20952, 0.72014], [0.0914, 0.74441]], "segments": 18, "phiStart": -0.518363, "phiLength": 1.036726});
  const mesh_gore_yellow_2 = new THREE.Mesh(
    mesh_gore_yellow_2Geometry,
    materialMap["gore-yellow"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gore_yellow_2.name = "Yellow gore";
  if (endpoint_gore_yellow_2) {
    mesh_gore_yellow_2.position.copy(endpoint_gore_yellow_2.midpoint);
    mesh_gore_yellow_2.quaternion.copy(endpoint_gore_yellow_2.quaternion);
  }
  mesh_gore_yellow_2.castShadow = options.castShadow ?? true;
  mesh_gore_yellow_2.receiveShadow = options.receiveShadow ?? true;
  mesh_gore_yellow_2.userData.sculptComponent = node_gore_yellow_2.userData.sculptComponent;
  node_gore_yellow_2.add(mesh_gore_yellow_2);
  meshes["gore-yellow"] = mesh_gore_yellow_2;
  colliders["gore-yellow"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["ball-shell"] ??= [];
  destructionGroups["ball-shell"].push(node_gore_yellow_2);

  const attachment_gore_mint_3 = null;
  const endpoint_gore_mint_3 = makeAttachmentEndpoint(attachment_gore_mint_3);
  const node_gore_mint_3 = new THREE.Group();
  node_gore_mint_3.name = "Mint gore__pivot";
  if (endpoint_gore_mint_3) {
    node_gore_mint_3.position.copy(endpoint_gore_mint_3.start);
    node_gore_mint_3.rotation.set(0, 0, 0);
    node_gore_mint_3.scale.set(1, 1, 1);
  } else {
    node_gore_mint_3.position.set(0.0, 0.0, 0.0);
    node_gore_mint_3.rotation.set(0.0, 0.0, 0.0);
    node_gore_mint_3.scale.set(1.0, 1.0, 1.0);
  }
  node_gore_mint_3.userData.sculptComponent = {"id": "gore-mint", "name": "Mint gore", "level": "meso", "role": "panel", "importance": 0.9, "confidence": 0.9, "primitive": "lathe", "topologyClass": "conforming-shell", "topologyRationale": "A thin doubly curved panel that follows the core sphere beneath it rather than enclosing a volume of its own; it has no flat face and no crease except at its two meridian edges.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(134, 192, 160, 1.0)", "secondaryAlbedo": "rgba(120, 172, 144, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "60 degree spherical gore from pole to pole, inset 0.3 degrees at each meridian edge so the seam groove opens", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "lathe UVs; one tile per panel", "normalStrategy": "smooth vertex normals across the panel, hard at its meridian edges", "latheProfile": {"points": [[0.0914, -0.74441], [0.20952, -0.72014], [0.32223, -0.67725], [0.4266, -0.61686], [0.51995, -0.54051], [0.59985, -0.4502], [0.66425, -0.34825], [0.71147, -0.23729], [0.74031, -0.1202], [0.75, -0.0], [0.74031, 0.1202], [0.71147, 0.23729], [0.66425, 0.34825], [0.59985, 0.4502], [0.51995, 0.54051], [0.4266, 0.61686], [0.32223, 0.67725], [0.20952, 0.72014], [0.0914, 0.74441]], "segments": 18, "phiStart": 0.528835, "phiLength": 1.036726}}, "parent": "ball-core", "attachment": null, "dimensions": {"width": 1.5, "height": 1.5, "depth": 1.5, "units": "world", "confidence": 0.8}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ball-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "gore-mint", "materialLayers": ["gore-mint"], "deformations": [], "joints": [], "seams": [{"id": "gore-mint-core-seam", "with": "ball-core", "overlap": 0.009, "notes": "Panel floats 0.009 units proud of the core; the gap between panels is the groove."}], "localFeatures": [{"id": "gore-seam-edge", "description": "The panel spans 59.4 degrees of longitude from 30.3 degrees, leaving a 0.6 degree groove against each neighbour.", "geometry": "LatheGeometry phiStart/phiLength, which the generated buildLatheGeometry is extended to honour", "evidenceRefs": ["full-object", "equator-zone"], "confidence": 0.9}, {"id": "panel-crown", "description": "The panel's own curvature carries the value gradient across it; the reference shows about 14 percent falloff from crown to seam on the coral panel.", "geometry": "spherical curvature, shaded rather than painted", "evidenceRefs": ["full-object", "equator-zone"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.08, "bumpAmplitude": 0.0, "normalPattern": "smooth inflated vinyl", "displacementPattern": "none", "occlusionPattern": "groove occlusion at both meridian edges", "edgeWearPattern": "none", "notes": "Matte vinyl. No gloss anywhere in the reference."}, "evidenceRefs": ["full-object", "equator-zone"], "details": [], "fidelityTier": "blockout"};
  node_gore_mint_3.userData.actionProfile = node_gore_mint_3.userData.sculptComponent.actionProfile;
  (nodes["ball-core"] ?? root).add(node_gore_mint_3);
  nodes["gore-mint"] = node_gore_mint_3;
  const mesh_gore_mint_3Geometry = endpoint_gore_mint_3
    ? new THREE.CylinderGeometry(endpoint_gore_mint_3.endRadius, endpoint_gore_mint_3.baseRadius, endpoint_gore_mint_3.length, 32, 12)
    : buildLatheGeometry({"points": [[0.0914, -0.74441], [0.20952, -0.72014], [0.32223, -0.67725], [0.4266, -0.61686], [0.51995, -0.54051], [0.59985, -0.4502], [0.66425, -0.34825], [0.71147, -0.23729], [0.74031, -0.1202], [0.75, -0.0], [0.74031, 0.1202], [0.71147, 0.23729], [0.66425, 0.34825], [0.59985, 0.4502], [0.51995, 0.54051], [0.4266, 0.61686], [0.32223, 0.67725], [0.20952, 0.72014], [0.0914, 0.74441]], "segments": 18, "phiStart": 0.528835, "phiLength": 1.036726});
  const mesh_gore_mint_3 = new THREE.Mesh(
    mesh_gore_mint_3Geometry,
    materialMap["gore-mint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gore_mint_3.name = "Mint gore";
  if (endpoint_gore_mint_3) {
    mesh_gore_mint_3.position.copy(endpoint_gore_mint_3.midpoint);
    mesh_gore_mint_3.quaternion.copy(endpoint_gore_mint_3.quaternion);
  }
  mesh_gore_mint_3.castShadow = options.castShadow ?? true;
  mesh_gore_mint_3.receiveShadow = options.receiveShadow ?? true;
  mesh_gore_mint_3.userData.sculptComponent = node_gore_mint_3.userData.sculptComponent;
  node_gore_mint_3.add(mesh_gore_mint_3);
  meshes["gore-mint"] = mesh_gore_mint_3;
  colliders["gore-mint"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["ball-shell"] ??= [];
  destructionGroups["ball-shell"].push(node_gore_mint_3);

  const attachment_gore_cream_right_4 = null;
  const endpoint_gore_cream_right_4 = makeAttachmentEndpoint(attachment_gore_cream_right_4);
  const node_gore_cream_right_4 = new THREE.Group();
  node_gore_cream_right_4.name = "Right cream gore__pivot";
  if (endpoint_gore_cream_right_4) {
    node_gore_cream_right_4.position.copy(endpoint_gore_cream_right_4.start);
    node_gore_cream_right_4.rotation.set(0, 0, 0);
    node_gore_cream_right_4.scale.set(1, 1, 1);
  } else {
    node_gore_cream_right_4.position.set(0.0, 0.0, 0.0);
    node_gore_cream_right_4.rotation.set(0.0, 0.0, 0.0);
    node_gore_cream_right_4.scale.set(1.0, 1.0, 1.0);
  }
  node_gore_cream_right_4.userData.sculptComponent = {"id": "gore-cream-right", "name": "Right cream gore", "level": "meso", "role": "panel", "importance": 0.9, "confidence": 0.7, "primitive": "lathe", "topologyClass": "conforming-shell", "topologyRationale": "A thin doubly curved panel that follows the core sphere beneath it rather than enclosing a volume of its own; it has no flat face and no crease except at its two meridian edges.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(239, 230, 214, 1.0)", "secondaryAlbedo": "rgba(215, 207, 192, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "60 degree spherical gore from pole to pole, inset 0.3 degrees at each meridian edge so the seam groove opens", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "lathe UVs; one tile per panel", "normalStrategy": "smooth vertex normals across the panel, hard at its meridian edges", "latheProfile": {"points": [[0.0914, -0.74441], [0.20952, -0.72014], [0.32223, -0.67725], [0.4266, -0.61686], [0.51995, -0.54051], [0.59985, -0.4502], [0.66425, -0.34825], [0.71147, -0.23729], [0.74031, -0.1202], [0.75, -0.0], [0.74031, 0.1202], [0.71147, 0.23729], [0.66425, 0.34825], [0.59985, 0.4502], [0.51995, 0.54051], [0.4266, 0.61686], [0.32223, 0.67725], [0.20952, 0.72014], [0.0914, 0.74441]], "segments": 18, "phiStart": 1.576032, "phiLength": 1.036726}}, "parent": "ball-core", "attachment": null, "dimensions": {"width": 1.5, "height": 1.5, "depth": 1.5, "units": "world", "confidence": 0.8}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ball-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "gore-cream", "materialLayers": ["gore-cream"], "deformations": [], "joints": [], "seams": [{"id": "gore-cream-right-core-seam", "with": "ball-core", "overlap": 0.009, "notes": "Panel floats 0.009 units proud of the core; the gap between panels is the groove."}], "localFeatures": [{"id": "gore-seam-edge", "description": "The panel spans 59.4 degrees of longitude from 90.3 degrees, leaving a 0.6 degree groove against each neighbour.", "geometry": "LatheGeometry phiStart/phiLength, which the generated buildLatheGeometry is extended to honour", "evidenceRefs": ["full-object", "equator-zone"], "confidence": 0.7}, {"id": "panel-crown", "description": "The panel's own curvature carries the value gradient across it; the reference shows about 14 percent falloff from crown to seam on the coral panel.", "geometry": "spherical curvature, shaded rather than painted", "evidenceRefs": ["full-object", "equator-zone"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.08, "bumpAmplitude": 0.0, "normalPattern": "smooth inflated vinyl", "displacementPattern": "none", "occlusionPattern": "groove occlusion at both meridian edges", "edgeWearPattern": "none", "notes": "Matte vinyl. No gloss anywhere in the reference."}, "evidenceRefs": ["full-object", "equator-zone"], "details": [], "fidelityTier": "structural-pass"};
  node_gore_cream_right_4.userData.actionProfile = node_gore_cream_right_4.userData.sculptComponent.actionProfile;
  (nodes["ball-core"] ?? root).add(node_gore_cream_right_4);
  nodes["gore-cream-right"] = node_gore_cream_right_4;
  const mesh_gore_cream_right_4Geometry = endpoint_gore_cream_right_4
    ? new THREE.CylinderGeometry(endpoint_gore_cream_right_4.endRadius, endpoint_gore_cream_right_4.baseRadius, endpoint_gore_cream_right_4.length, 32, 12)
    : buildLatheGeometry({"points": [[0.0914, -0.74441], [0.20952, -0.72014], [0.32223, -0.67725], [0.4266, -0.61686], [0.51995, -0.54051], [0.59985, -0.4502], [0.66425, -0.34825], [0.71147, -0.23729], [0.74031, -0.1202], [0.75, -0.0], [0.74031, 0.1202], [0.71147, 0.23729], [0.66425, 0.34825], [0.59985, 0.4502], [0.51995, 0.54051], [0.4266, 0.61686], [0.32223, 0.67725], [0.20952, 0.72014], [0.0914, 0.74441]], "segments": 18, "phiStart": 1.576032, "phiLength": 1.036726});
  const mesh_gore_cream_right_4 = new THREE.Mesh(
    mesh_gore_cream_right_4Geometry,
    materialMap["gore-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gore_cream_right_4.name = "Right cream gore";
  if (endpoint_gore_cream_right_4) {
    mesh_gore_cream_right_4.position.copy(endpoint_gore_cream_right_4.midpoint);
    mesh_gore_cream_right_4.quaternion.copy(endpoint_gore_cream_right_4.quaternion);
  }
  mesh_gore_cream_right_4.castShadow = options.castShadow ?? true;
  mesh_gore_cream_right_4.receiveShadow = options.receiveShadow ?? true;
  mesh_gore_cream_right_4.userData.sculptComponent = node_gore_cream_right_4.userData.sculptComponent;
  node_gore_cream_right_4.add(mesh_gore_cream_right_4);
  meshes["gore-cream-right"] = mesh_gore_cream_right_4;
  colliders["gore-cream-right"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["ball-shell"] ??= [];
  destructionGroups["ball-shell"].push(node_gore_cream_right_4);

  const attachment_gore_coral_back_5 = null;
  const endpoint_gore_coral_back_5 = makeAttachmentEndpoint(attachment_gore_coral_back_5);
  const node_gore_coral_back_5 = new THREE.Group();
  node_gore_coral_back_5.name = "Rear coral gore__pivot";
  if (endpoint_gore_coral_back_5) {
    node_gore_coral_back_5.position.copy(endpoint_gore_coral_back_5.start);
    node_gore_coral_back_5.rotation.set(0, 0, 0);
    node_gore_coral_back_5.scale.set(1, 1, 1);
  } else {
    node_gore_coral_back_5.position.set(0.0, 0.0, 0.0);
    node_gore_coral_back_5.rotation.set(0.0, 0.0, 0.0);
    node_gore_coral_back_5.scale.set(1.0, 1.0, 1.0);
  }
  node_gore_coral_back_5.userData.sculptComponent = {"id": "gore-coral-back", "name": "Rear coral gore", "level": "meso", "role": "panel", "importance": 0.4, "confidence": 0.3, "primitive": "lathe", "topologyClass": "conforming-shell", "topologyRationale": "A thin doubly curved panel that follows the core sphere beneath it rather than enclosing a volume of its own; it has no flat face and no crease except at its two meridian edges.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 104, 92, 1.0)", "secondaryAlbedo": "rgba(217, 93, 82, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "60 degree spherical gore from pole to pole, inset 0.3 degrees at each meridian edge so the seam groove opens", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "lathe UVs; one tile per panel", "normalStrategy": "smooth vertex normals across the panel, hard at its meridian edges", "latheProfile": {"points": [[0.0914, -0.74441], [0.20952, -0.72014], [0.32223, -0.67725], [0.4266, -0.61686], [0.51995, -0.54051], [0.59985, -0.4502], [0.66425, -0.34825], [0.71147, -0.23729], [0.74031, -0.1202], [0.75, -0.0], [0.74031, 0.1202], [0.71147, 0.23729], [0.66425, 0.34825], [0.59985, 0.4502], [0.51995, 0.54051], [0.4266, 0.61686], [0.32223, 0.67725], [0.20952, 0.72014], [0.0914, 0.74441]], "segments": 18, "phiStart": 2.62323, "phiLength": 1.036726}}, "parent": "ball-core", "attachment": null, "dimensions": {"width": 1.5, "height": 1.5, "depth": 1.5, "units": "world", "confidence": 0.8}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ball-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "gore-coral", "materialLayers": ["gore-coral"], "deformations": [], "joints": [], "seams": [{"id": "gore-coral-back-core-seam", "with": "ball-core", "overlap": 0.009, "notes": "Panel floats 0.009 units proud of the core; the gap between panels is the groove."}], "localFeatures": [{"id": "gore-seam-edge", "description": "The panel spans 59.4 degrees of longitude from 150.3 degrees, leaving a 0.6 degree groove against each neighbour.", "geometry": "LatheGeometry phiStart/phiLength, which the generated buildLatheGeometry is extended to honour", "evidenceRefs": ["full-object", "equator-zone"], "confidence": 0.3}, {"id": "panel-crown", "description": "The panel's own curvature carries the value gradient across it; the reference shows about 14 percent falloff from crown to seam on the coral panel.", "geometry": "spherical curvature, shaded rather than painted", "evidenceRefs": ["full-object", "equator-zone"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.08, "bumpAmplitude": 0.0, "normalPattern": "smooth inflated vinyl", "displacementPattern": "none", "occlusionPattern": "groove occlusion at both meridian edges", "edgeWearPattern": "none", "notes": "Matte vinyl. No gloss anywhere in the reference."}, "evidenceRefs": ["full-object", "equator-zone"], "details": [], "fidelityTier": "structural-pass"};
  node_gore_coral_back_5.userData.actionProfile = node_gore_coral_back_5.userData.sculptComponent.actionProfile;
  (nodes["ball-core"] ?? root).add(node_gore_coral_back_5);
  nodes["gore-coral-back"] = node_gore_coral_back_5;
  const mesh_gore_coral_back_5Geometry = endpoint_gore_coral_back_5
    ? new THREE.CylinderGeometry(endpoint_gore_coral_back_5.endRadius, endpoint_gore_coral_back_5.baseRadius, endpoint_gore_coral_back_5.length, 32, 12)
    : buildLatheGeometry({"points": [[0.0914, -0.74441], [0.20952, -0.72014], [0.32223, -0.67725], [0.4266, -0.61686], [0.51995, -0.54051], [0.59985, -0.4502], [0.66425, -0.34825], [0.71147, -0.23729], [0.74031, -0.1202], [0.75, -0.0], [0.74031, 0.1202], [0.71147, 0.23729], [0.66425, 0.34825], [0.59985, 0.4502], [0.51995, 0.54051], [0.4266, 0.61686], [0.32223, 0.67725], [0.20952, 0.72014], [0.0914, 0.74441]], "segments": 18, "phiStart": 2.62323, "phiLength": 1.036726});
  const mesh_gore_coral_back_5 = new THREE.Mesh(
    mesh_gore_coral_back_5Geometry,
    materialMap["gore-coral"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gore_coral_back_5.name = "Rear coral gore";
  if (endpoint_gore_coral_back_5) {
    mesh_gore_coral_back_5.position.copy(endpoint_gore_coral_back_5.midpoint);
    mesh_gore_coral_back_5.quaternion.copy(endpoint_gore_coral_back_5.quaternion);
  }
  mesh_gore_coral_back_5.castShadow = options.castShadow ?? true;
  mesh_gore_coral_back_5.receiveShadow = options.receiveShadow ?? true;
  mesh_gore_coral_back_5.userData.sculptComponent = node_gore_coral_back_5.userData.sculptComponent;
  node_gore_coral_back_5.add(mesh_gore_coral_back_5);
  meshes["gore-coral-back"] = mesh_gore_coral_back_5;
  colliders["gore-coral-back"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["ball-shell"] ??= [];
  destructionGroups["ball-shell"].push(node_gore_coral_back_5);

  const attachment_gore_cream_left_6 = null;
  const endpoint_gore_cream_left_6 = makeAttachmentEndpoint(attachment_gore_cream_left_6);
  const node_gore_cream_left_6 = new THREE.Group();
  node_gore_cream_left_6.name = "Left cream gore__pivot";
  if (endpoint_gore_cream_left_6) {
    node_gore_cream_left_6.position.copy(endpoint_gore_cream_left_6.start);
    node_gore_cream_left_6.rotation.set(0, 0, 0);
    node_gore_cream_left_6.scale.set(1, 1, 1);
  } else {
    node_gore_cream_left_6.position.set(0.0, 0.0, 0.0);
    node_gore_cream_left_6.rotation.set(0.0, 0.0, 0.0);
    node_gore_cream_left_6.scale.set(1.0, 1.0, 1.0);
  }
  node_gore_cream_left_6.userData.sculptComponent = {"id": "gore-cream-left", "name": "Left cream gore", "level": "meso", "role": "panel", "importance": 0.9, "confidence": 0.7, "primitive": "lathe", "topologyClass": "conforming-shell", "topologyRationale": "A thin doubly curved panel that follows the core sphere beneath it rather than enclosing a volume of its own; it has no flat face and no crease except at its two meridian edges.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(239, 230, 214, 1.0)", "secondaryAlbedo": "rgba(215, 207, 192, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "60 degree spherical gore from pole to pole, inset 0.3 degrees at each meridian edge so the seam groove opens", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "lathe UVs; one tile per panel", "normalStrategy": "smooth vertex normals across the panel, hard at its meridian edges", "latheProfile": {"points": [[0.0914, -0.74441], [0.20952, -0.72014], [0.32223, -0.67725], [0.4266, -0.61686], [0.51995, -0.54051], [0.59985, -0.4502], [0.66425, -0.34825], [0.71147, -0.23729], [0.74031, -0.1202], [0.75, -0.0], [0.74031, 0.1202], [0.71147, 0.23729], [0.66425, 0.34825], [0.59985, 0.4502], [0.51995, 0.54051], [0.4266, 0.61686], [0.32223, 0.67725], [0.20952, 0.72014], [0.0914, 0.74441]], "segments": 18, "phiStart": 3.670427, "phiLength": 1.036726}}, "parent": "ball-core", "attachment": null, "dimensions": {"width": 1.5, "height": 1.5, "depth": 1.5, "units": "world", "confidence": 0.8}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ball-shell", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "gore-cream", "materialLayers": ["gore-cream"], "deformations": [], "joints": [], "seams": [{"id": "gore-cream-left-core-seam", "with": "ball-core", "overlap": 0.009, "notes": "Panel floats 0.009 units proud of the core; the gap between panels is the groove."}], "localFeatures": [{"id": "gore-seam-edge", "description": "The panel spans 59.4 degrees of longitude from 210.3 degrees, leaving a 0.6 degree groove against each neighbour.", "geometry": "LatheGeometry phiStart/phiLength, which the generated buildLatheGeometry is extended to honour", "evidenceRefs": ["full-object", "equator-zone"], "confidence": 0.7}, {"id": "panel-crown", "description": "The panel's own curvature carries the value gradient across it; the reference shows about 14 percent falloff from crown to seam on the coral panel.", "geometry": "spherical curvature, shaded rather than painted", "evidenceRefs": ["full-object", "equator-zone"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.62, "microRoughness": 0.08, "bumpAmplitude": 0.0, "normalPattern": "smooth inflated vinyl", "displacementPattern": "none", "occlusionPattern": "groove occlusion at both meridian edges", "edgeWearPattern": "none", "notes": "Matte vinyl. No gloss anywhere in the reference."}, "evidenceRefs": ["full-object", "equator-zone"], "details": [], "fidelityTier": "structural-pass"};
  node_gore_cream_left_6.userData.actionProfile = node_gore_cream_left_6.userData.sculptComponent.actionProfile;
  (nodes["ball-core"] ?? root).add(node_gore_cream_left_6);
  nodes["gore-cream-left"] = node_gore_cream_left_6;
  const mesh_gore_cream_left_6Geometry = endpoint_gore_cream_left_6
    ? new THREE.CylinderGeometry(endpoint_gore_cream_left_6.endRadius, endpoint_gore_cream_left_6.baseRadius, endpoint_gore_cream_left_6.length, 32, 12)
    : buildLatheGeometry({"points": [[0.0914, -0.74441], [0.20952, -0.72014], [0.32223, -0.67725], [0.4266, -0.61686], [0.51995, -0.54051], [0.59985, -0.4502], [0.66425, -0.34825], [0.71147, -0.23729], [0.74031, -0.1202], [0.75, -0.0], [0.74031, 0.1202], [0.71147, 0.23729], [0.66425, 0.34825], [0.59985, 0.4502], [0.51995, 0.54051], [0.4266, 0.61686], [0.32223, 0.67725], [0.20952, 0.72014], [0.0914, 0.74441]], "segments": 18, "phiStart": 3.670427, "phiLength": 1.036726});
  const mesh_gore_cream_left_6 = new THREE.Mesh(
    mesh_gore_cream_left_6Geometry,
    materialMap["gore-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gore_cream_left_6.name = "Left cream gore";
  if (endpoint_gore_cream_left_6) {
    mesh_gore_cream_left_6.position.copy(endpoint_gore_cream_left_6.midpoint);
    mesh_gore_cream_left_6.quaternion.copy(endpoint_gore_cream_left_6.quaternion);
  }
  mesh_gore_cream_left_6.castShadow = options.castShadow ?? true;
  mesh_gore_cream_left_6.receiveShadow = options.receiveShadow ?? true;
  mesh_gore_cream_left_6.userData.sculptComponent = node_gore_cream_left_6.userData.sculptComponent;
  node_gore_cream_left_6.add(mesh_gore_cream_left_6);
  meshes["gore-cream-left"] = mesh_gore_cream_left_6;
  colliders["gore-cream-left"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["ball-shell"] ??= [];
  destructionGroups["ball-shell"].push(node_gore_cream_left_6);

  const attachment_valve_collar_7 = null;
  const endpoint_valve_collar_7 = makeAttachmentEndpoint(attachment_valve_collar_7);
  const node_valve_collar_7 = new THREE.Group();
  node_valve_collar_7.name = "Valve collar__pivot";
  if (endpoint_valve_collar_7) {
    node_valve_collar_7.position.copy(endpoint_valve_collar_7.start);
    node_valve_collar_7.rotation.set(0, 0, 0);
    node_valve_collar_7.scale.set(1, 1, 1);
  } else {
    node_valve_collar_7.position.set(0.0, 0.0, 0.0);
    node_valve_collar_7.rotation.set(0.0, 0.0, 0.0);
    node_valve_collar_7.scale.set(1.0, 1.0, 1.0);
  }
  node_valve_collar_7.userData.sculptComponent = {"id": "valve-collar", "name": "Valve collar", "level": "meso", "role": "fitting", "importance": 0.6, "confidence": 0.75, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "A separate moulded disc welded onto the panels: the reference shows a hard step where it meets them and a flat crown, which no continuous inflation of the ball surface would give.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 104, 92, 1.0)", "secondaryAlbedo": "rgba(217, 93, 82, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "flat-crowned disc lying on the sphere at the north pole", "edgeTreatment": {"type": "flat-chamfer", "bevelRadius": 0.0, "segments": 1}, "deformationStack": ["crown flattened to the tangent plane at the pole"], "uvStrategy": "lathe UVs", "normalStrategy": "flat crown normals, smooth outer wall", "latheProfile": {"points": [[0.0001, 0.73], [0.16512166859791425, 0.742], [0.16512166859791425, 0.762], [0.14530706836616453, 0.762], [0.0001, 0.762]], "segments": 24, "phiStart": 0.0, "phiLength": 6.283185}}, "parent": "ball-core", "attachment": null, "dimensions": {"width": 0.3302, "height": 0.012, "depth": 0.3302, "units": "world", "confidence": 0.7}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "socket", "localPosition": [0.0, 0.75, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.75}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "valve-assembly", "seamRefs": [], "detachableFragments": ["valve-collar", "valve-plug"], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "valve-coral", "materialLayers": ["valve-coral"], "deformations": [], "joints": [], "seams": [{"id": "collar-panel-seam", "with": "gore-yellow", "overlap": 0.02, "notes": "Collar base is buried 0.02 units inside the panel radius."}], "localFeatures": [{"id": "collar-step", "description": "The collar stands 0.012 units proud of the panels, so a hard shadow ring runs all the way round it.", "geometry": "lathe profile whose outer wall is vertical, seated 0.02 units into the panels", "evidenceRefs": ["full-object", "pole-zone"], "confidence": 0.8}, {"id": "collar-crown-flat", "description": "The crown is flat, not domed: its projected ellipse has straight-sided shading with no terminator across it.", "geometry": "profile ends with a horizontal run to the axis", "evidenceRefs": ["full-object", "pole-zone"], "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.07, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded vinyl", "displacementPattern": "none", "occlusionPattern": "shadow ring at the panel step", "edgeWearPattern": "none", "notes": "Same coral pigment as the coral gores; measured within 3 of 255 on each channel."}, "evidenceRefs": ["full-object", "pole-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_valve_collar_7.userData.actionProfile = node_valve_collar_7.userData.sculptComponent.actionProfile;
  (nodes["ball-core"] ?? root).add(node_valve_collar_7);
  nodes["valve-collar"] = node_valve_collar_7;
  const mesh_valve_collar_7Geometry = endpoint_valve_collar_7
    ? new THREE.CylinderGeometry(endpoint_valve_collar_7.endRadius, endpoint_valve_collar_7.baseRadius, endpoint_valve_collar_7.length, 32, 12)
    : buildLatheGeometry({"points": [[0.0001, 0.73], [0.16512166859791425, 0.742], [0.16512166859791425, 0.762], [0.14530706836616453, 0.762], [0.0001, 0.762]], "segments": 24, "phiStart": 0.0, "phiLength": 6.283185});
  const mesh_valve_collar_7 = new THREE.Mesh(
    mesh_valve_collar_7Geometry,
    materialMap["valve-coral"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_valve_collar_7.name = "Valve collar";
  if (endpoint_valve_collar_7) {
    mesh_valve_collar_7.position.copy(endpoint_valve_collar_7.midpoint);
    mesh_valve_collar_7.quaternion.copy(endpoint_valve_collar_7.quaternion);
  }
  mesh_valve_collar_7.castShadow = options.castShadow ?? true;
  mesh_valve_collar_7.receiveShadow = options.receiveShadow ?? true;
  mesh_valve_collar_7.userData.sculptComponent = node_valve_collar_7.userData.sculptComponent;
  node_valve_collar_7.add(mesh_valve_collar_7);
  meshes["valve-collar"] = mesh_valve_collar_7;
  colliders["valve-collar"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["valve-assembly"] ??= [];
  destructionGroups["valve-assembly"].push(node_valve_collar_7);

  const attachment_valve_plug_8 = null;
  const endpoint_valve_plug_8 = makeAttachmentEndpoint(attachment_valve_plug_8);
  const node_valve_plug_8 = new THREE.Group();
  node_valve_plug_8.name = "Valve plug__pivot";
  if (endpoint_valve_plug_8) {
    node_valve_plug_8.position.copy(endpoint_valve_plug_8.start);
    node_valve_plug_8.rotation.set(0, 0, 0);
    node_valve_plug_8.scale.set(1, 1, 1);
  } else {
    node_valve_plug_8.position.set(0.0, 0.0, 0.0);
    node_valve_plug_8.rotation.set(0.0, 0.0, 0.0);
    node_valve_plug_8.scale.set(1.0, 1.0, 1.0);
  }
  node_valve_plug_8.userData.sculptComponent = {"id": "valve-plug", "name": "Valve plug", "level": "micro", "role": "fitting", "importance": 0.35, "confidence": 0.65, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "A second smaller disc standing on the collar crown, visible in the reference as a concentric step with its own shadow ring.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(242, 104, 92, 1.0)", "secondaryAlbedo": "rgba(227, 97, 86, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "inner plug disc on the collar crown", "edgeTreatment": {"type": "flat-chamfer", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "lathe UVs", "normalStrategy": "flat crown normals", "latheProfile": {"points": [[0.0001, 0.754], [0.10237543453070683, 0.758], [0.10237543453070683, 0.769], [0.08190034762456547, 0.769], [0.0001, 0.769]], "segments": 24, "phiStart": 0.0, "phiLength": 6.283185}}, "parent": "valve-collar", "attachment": null, "dimensions": {"width": 0.2048, "height": 0.007, "depth": 0.2048, "units": "world", "confidence": 0.6}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.6}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "valve-assembly", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "body"}}, "material": "valve-coral", "materialLayers": ["valve-coral"], "deformations": [], "joints": [], "seams": [{"id": "plug-collar-seam", "with": "valve-collar", "overlap": 0.02, "notes": "Plug base is buried in the collar crown."}], "localFeatures": [{"id": "plug-step", "description": "The plug stands a further 0.007 units above the collar crown, giving the cap the two-step read the reference shows.", "geometry": "second lathe disc seated 0.004 units into the collar", "evidenceRefs": ["full-object", "pole-zone"], "confidence": 0.7}], "surfaceDetail": {"macroRoughness": 0.55, "microRoughness": 0.07, "bumpAmplitude": 0.0, "normalPattern": "smooth moulded vinyl", "displacementPattern": "none", "occlusionPattern": "shadow ring at the collar step", "edgeWearPattern": "none", "notes": "Slightly darker than the collar in the reference, which is shading rather than a second pigment; modelled as a 6 percent albedo step."}, "evidenceRefs": ["full-object", "pole-zone"], "details": [], "fidelityTier": "form-refinement"};
  node_valve_plug_8.userData.actionProfile = node_valve_plug_8.userData.sculptComponent.actionProfile;
  (nodes["valve-collar"] ?? root).add(node_valve_plug_8);
  nodes["valve-plug"] = node_valve_plug_8;
  const mesh_valve_plug_8Geometry = endpoint_valve_plug_8
    ? new THREE.CylinderGeometry(endpoint_valve_plug_8.endRadius, endpoint_valve_plug_8.baseRadius, endpoint_valve_plug_8.length, 32, 12)
    : buildLatheGeometry({"points": [[0.0001, 0.754], [0.10237543453070683, 0.758], [0.10237543453070683, 0.769], [0.08190034762456547, 0.769], [0.0001, 0.769]], "segments": 24, "phiStart": 0.0, "phiLength": 6.283185});
  const mesh_valve_plug_8 = new THREE.Mesh(
    mesh_valve_plug_8Geometry,
    materialMap["valve-coral"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_valve_plug_8.name = "Valve plug";
  if (endpoint_valve_plug_8) {
    mesh_valve_plug_8.position.copy(endpoint_valve_plug_8.midpoint);
    mesh_valve_plug_8.quaternion.copy(endpoint_valve_plug_8.quaternion);
  }
  mesh_valve_plug_8.castShadow = options.castShadow ?? true;
  mesh_valve_plug_8.receiveShadow = options.receiveShadow ?? true;
  mesh_valve_plug_8.userData.sculptComponent = node_valve_plug_8.userData.sculptComponent;
  node_valve_plug_8.add(mesh_valve_plug_8);
  meshes["valve-plug"] = mesh_valve_plug_8;
  colliders["valve-plug"] = {"type": "box", "offset": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0], "isTrigger": false, "notes": "Box proxy sized to the part bounds."};
  destructionGroups["valve-assembly"] ??= [];
  destructionGroups["valve-assembly"].push(node_valve_plug_8);

  // repetition system: gore-panel-ring (InstancedMesh, radial, count=6, level=meso)
  {
    const parent = nodes["ball-core"] ?? root;
    const geo = buildLatheGeometry({"points": [[0.3, -0.5], [0.15, 0.0], [0.3, 0.5]], "segments": 24});
    const mat = materialMap["gore-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    const scl = [1.0, 1.0, 1.0];
    const axis = new THREE.Vector3(0.0, 1.0, 0.0).normalize();
    const radius = 0.0;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 6);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0]!, scl[1]!, scl[2]!);
    for (let i = 0; i < 6; i++) {
      const ang = ((-90.0) + (i * 360) / 6) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "gore-panel-ring";
    parent.add(cluster);
  }

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 256, "preferredTextureResolution": 1024, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "ranAnyway": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars."}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness, height, normal or AO", "single-frequency random noise", "glossy toy-plastic highlights on a matte moulded surface", "local colour described only in prose without material masks", "claiming exact PBR recovery from one image"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare the albedo palette and the local colour zones.", "Compare roughness and normal response under the key light.", "Compare contact darkening, seam occlusion and crown polish.", "Compare key, fill and rim structure, exposure, tone mapping and background.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals and uniform roughness.", "Capture a reference-matched render from the solved camera."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createApartmentBeachBallLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Apartment Beach Ball look-dev lights";
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
  lights.userData.lightingFromPhoto = ["Ambient dominance: the reference is a soft studio render. Measured yellow reads 255,200,69 at the panel crown and 196,152,55 at the seam, a 23 percent range across a full hemisphere of curvature, which needs a bright neutral hemisphere rather than a hard key.", "Key light: a gentle warm directional source at about 1.15 from high and camera left, enough to put the crown 20 percent above the flank without crushing the limb.", "Rim and environment light: weak neutral back light at about 0.3. No environment map: the reference shows no reflected detail anywhere on the ball.", "Exposure and tone mapping: ACES filmic tone mapping with sRGB output at exposure 1.0. The reference holds a narrow value range with no blown highlights.", "Contact shadow: seam-groove ambient occlusion only. The reference ball floats with no ground contact, so the review render has no ground plane and the silhouette mask stays clean."];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 256, "preferredTextureResolution": 1024, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "ranAnyway": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "Extraction passed its own confidence gate, but the maps are NOT bound to the runtime material. These references are flat-paint stylised studio renders with no surface pattern, so the extracted crops carry only baked lighting and crop-boundary contamination; tiling them would paint the reference's shading onto every facet. The runtime instead builds five independent procedural canvas maps (albedo/roughness/height/normal/AO) so the prop stays self-contained with no network-fetched textures. The extracted palettes and roughness estimates were used as evidence for the albedo and roughness scalars."}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness, height, normal or AO", "single-frequency random noise", "glossy toy-plastic highlights on a matte moulded surface", "local colour described only in prose without material masks", "claiming exact PBR recovery from one image"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare the albedo palette and the local colour zones.", "Compare roughness and normal response under the key light.", "Compare contact darkening, seam occlusion and crown polish.", "Compare key, fill and rim structure, exposure, tone mapping and background.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals and uniform roughness.", "Capture a reference-matched render from the solved camera."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createApartmentBeachBallEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
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
export function frameApartmentBeachBallCamera(
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
export function createApartmentBeachBallPresentationComposer(
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

export function configureApartmentBeachBallRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createApartmentBeachBallInspectControls(
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
