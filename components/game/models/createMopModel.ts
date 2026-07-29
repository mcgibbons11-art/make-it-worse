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

// Generated from ObjectSculptSpec target: Robot Mop
// Sculpt build pass: structural-pass
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createRobotMopModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Robot Mop";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"azimuthDeg": 0.0, "elevationDeg": 29.46, "rollDeg": 0.0, "fovDeg": 28.0, "projection": "perspective, long lens; the deck ellipse is consistent with a near-orthographic solve", "solveMethod": "The deck is a circle, so its projected minor/major ratio is sin(elevation): 387/787 = 0.4917 gives 29.46 degrees, and the solve closes to the pixel (787 * 0.4917 = 387.0).", "confidence": 0.85}, "approximationNotes": []};

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["shell-cream"] = createSculptMaterial(
    "shell-cream",
    {"id": "shell-cream", "name": "Cream shell ABS", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#e6dccb", "color": "#e6dccb", "albedo": {"dominant": "#e6dccb", "secondary": ["#f2ece0", "#cfc4b2"], "samplingNotes": "Median-sampled from the named region of the reference and cross-checked against the magnified crop. The sampled values are lit pixels, so the authored albedo is darkened from the sample to remove the key light's contribution.", "textureStrategy": "procedural canvas albedo with low-amplitude mottle"}, "roughness": {"base": 0.62, "variation": 0.08, "map": "independent-procedural-field", "localResponse": "recesses and the gaps between tufts trend rougher; convex crowns trend marginally smoother, though nothing on this prop becomes glossy"}, "metalness": 0.0, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.16, "scale": 20.0, "space": "tangent"}, "ambientOcclusion": {"cavityStrength": 0.55, "contactShadowBias": 0.3, "notes": "Darken the deck-to-rim seam, the wall beneath the rim overhang, the bumper gaps, the latch recess and the roots between fringe tufts."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.28, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 15.0, "amplitude": 0.14, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 60.0, "amplitude": 0.05, "role": "matte-texture breakup that only reads under grazing light"}], "textureResolution": 1024, "textureProjection": {"mode": "triplanar-world", "texelDensityIntent": "roughly 1400 texels per world unit at 1024, so the mottle stays sub-pixel at gameplay distance and only reads under review framing"}, "localOverrides": [{"id": "under-rim-occlusion", "kind": "ambient-occlusion", "region": "cream wall directly beneath the rim overhang and inside each bumper gap", "aoStrength": 0.8, "roughness": 0.66, "notes": "The cream under the rim reads 12-18 levels darker than the lit crown. It is contact occlusion, not a change of colour, so it is an AO override rather than a second albedo."}, {"id": "rim-crown-lightening", "kind": "albedo", "region": "the convex crown of the rim where the key light grazes it", "color": "#f4eee3", "roughness": 0.58, "notes": "A broad soft sheen, not a specular hotspot: the rim is the same matte plastic and only its curvature makes it brighter."}], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\mop\\evidence\\crops\\shell-cream-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with a de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.83, "estimatedFidelity": 0.83, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; these maps are reference-derived estimates.", "limitationNote": "usable is false on purpose. referenceMapUrl() resolves these maps by absolute disk path, which cannot load in a browser, so binding them would break the runtime asset. The reference is also a soft studio render of flat matte plastic with no surface pattern, so the crops carry baked lighting rather than albedo; tiling them would paint the reference's own shading onto every facet. The runtime instead builds independent procedural canvas maps and the extracted palettes and roughness estimates are used as evidence for the scalars below.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\mop\\evidence\\pbr\\shell-cream_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\mop\\evidence\\pbr\\shell-cream_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\mop\\evidence\\pbr\\shell-cream_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\mop\\evidence\\pbr\\shell-cream_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\mop\\evidence\\pbr\\shell-cream_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "Matte injection-moulded ABS. No clearcoat anywhere: the reference has no specular hotspot on any surface."},
    options
  );
  materialMap["deck-mint"] = createSculptMaterial(
    "deck-mint",
    {"id": "deck-mint", "name": "Mint deck ABS", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#9cc4ab", "color": "#9cc4ab", "albedo": {"dominant": "#9cc4ab", "secondary": ["#a9ceb7", "#8bb59c"], "samplingNotes": "Median-sampled from the named region of the reference and cross-checked against the magnified crop. The sampled values are lit pixels, so the authored albedo is darkened from the sample to remove the key light's contribution.", "textureStrategy": "procedural canvas albedo with low-amplitude mottle"}, "roughness": {"base": 0.66, "variation": 0.06, "map": "independent-procedural-field", "localResponse": "recesses and the gaps between tufts trend rougher; convex crowns trend marginally smoother, though nothing on this prop becomes glossy"}, "metalness": 0.0, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.16, "scale": 20.0, "space": "tangent"}, "ambientOcclusion": {"cavityStrength": 0.5, "contactShadowBias": 0.3, "notes": "Darken the deck-to-rim seam, the wall beneath the rim overhang, the bumper gaps, the latch recess and the roots between fringe tufts."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.28, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 15.0, "amplitude": 0.14, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 60.0, "amplitude": 0.05, "role": "matte-texture breakup that only reads under grazing light"}], "textureResolution": 1024, "textureProjection": {"mode": "triplanar-world", "texelDensityIntent": "roughly 1400 texels per world unit at 1024, so the mottle stays sub-pixel at gameplay distance and only reads under review framing"}, "localOverrides": [{"id": "button-contact-shadow", "kind": "ambient-occlusion", "region": "a tight arc on the deck hugging the button's base", "aoStrength": 0.9, "roughness": 0.68, "notes": "Strongest at the button's left and right where the deck turns away from the key. Visible as a 2-4px dark rim in the 3x button crop."}], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\mop\\evidence\\crops\\deck-mint-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with a de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.85, "estimatedFidelity": 0.85, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; these maps are reference-derived estimates.", "limitationNote": "usable is false on purpose. referenceMapUrl() resolves these maps by absolute disk path, which cannot load in a browser, so binding them would break the runtime asset. The reference is also a soft studio render of flat matte plastic with no surface pattern, so the crops carry baked lighting rather than albedo; tiling them would paint the reference's own shading onto every facet. The runtime instead builds independent procedural canvas maps and the extracted palettes and roughness estimates are used as evidence for the scalars below.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\mop\\evidence\\pbr\\deck-mint_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\mop\\evidence\\pbr\\deck-mint_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\mop\\evidence\\pbr\\deck-mint_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\mop\\evidence\\pbr\\deck-mint_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\mop\\evidence\\pbr\\deck-mint_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "The largest single colour field in the reference and the one a viewer identifies the prop by."},
    options
  );
  materialMap["bumper-navy"] = createSculptMaterial(
    "bumper-navy",
    {"id": "bumper-navy", "name": "Navy bumper elastomer", "type": "physical", "shaderModel": "MeshPhysicalMaterial (soft-touch matte elastomer)", "baseColor": "#3a4150", "color": "#3a4150", "albedo": {"dominant": "#3a4150", "secondary": ["#404650", "#2f3542"], "samplingNotes": "Median-sampled from the named region of the reference and cross-checked against the magnified crop. The sampled values are lit pixels, so the authored albedo is darkened from the sample to remove the key light's contribution.", "textureStrategy": "procedural canvas albedo with low-amplitude mottle"}, "roughness": {"base": 0.74, "variation": 0.07, "map": "independent-procedural-field", "localResponse": "recesses and the gaps between tufts trend rougher; convex crowns trend marginally smoother, though nothing on this prop becomes glossy"}, "metalness": 0.0, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.16, "scale": 20.0, "space": "tangent"}, "ambientOcclusion": {"cavityStrength": 0.6, "contactShadowBias": 0.3, "notes": "Darken the deck-to-rim seam, the wall beneath the rim overhang, the bumper gaps, the latch recess and the roots between fringe tufts."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.28, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 15.0, "amplitude": 0.14, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 60.0, "amplitude": 0.05, "role": "matte-texture breakup that only reads under grazing light"}], "textureResolution": 1024, "textureProjection": {"mode": "triplanar-world", "texelDensityIntent": "roughly 1400 texels per world unit at 1024, so the mottle stays sub-pixel at gameplay distance and only reads under review framing"}, "localOverrides": [{"id": "segment-gap-occlusion", "kind": "ambient-occlusion", "region": "the rounded end caps where each segment meets its cream gap", "aoStrength": 0.85, "roughness": 0.78, "notes": "Darkens the end caps so the gaps read as real slots rather than painted lines."}], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\mop\\evidence\\crops\\bumper-navy-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with a de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.8, "estimatedFidelity": 0.8, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; these maps are reference-derived estimates.", "limitationNote": "usable is false on purpose. referenceMapUrl() resolves these maps by absolute disk path, which cannot load in a browser, so binding them would break the runtime asset. The reference is also a soft studio render of flat matte plastic with no surface pattern, so the crops carry baked lighting rather than albedo; tiling them would paint the reference's own shading onto every facet. The runtime instead builds independent procedural canvas maps and the extracted palettes and roughness estimates are used as evidence for the scalars below.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\mop\\evidence\\pbr\\bumper-navy_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\mop\\evidence\\pbr\\bumper-navy_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\mop\\evidence\\pbr\\bumper-navy_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\mop\\evidence\\pbr\\bumper-navy_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\mop\\evidence\\pbr\\bumper-navy_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "Soft-touch matte elastomer, noticeably rougher than the ABS shell and with no sheen at all."},
    options
  );
  materialMap["button-coral"] = createSculptMaterial(
    "button-coral",
    {"id": "button-coral", "name": "Coral button ABS", "type": "physical", "shaderModel": "MeshPhysicalMaterial (matte injection-moulded ABS)", "baseColor": "#e0665f", "color": "#e0665f", "albedo": {"dominant": "#e0665f", "secondary": ["#ec7e79", "#c9544e"], "samplingNotes": "Median-sampled from the named region of the reference and cross-checked against the magnified crop. The sampled values are lit pixels, so the authored albedo is darkened from the sample to remove the key light's contribution.", "textureStrategy": "procedural canvas albedo with low-amplitude mottle"}, "roughness": {"base": 0.6, "variation": 0.06, "map": "independent-procedural-field", "localResponse": "recesses and the gaps between tufts trend rougher; convex crowns trend marginally smoother, though nothing on this prop becomes glossy"}, "metalness": 0.0, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.16, "scale": 20.0, "space": "tangent"}, "ambientOcclusion": {"cavityStrength": 0.5, "contactShadowBias": 0.3, "notes": "Darken the deck-to-rim seam, the wall beneath the rim overhang, the bumper gaps, the latch recess and the roots between fringe tufts."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.28, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 15.0, "amplitude": 0.14, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 60.0, "amplitude": 0.05, "role": "matte-texture breakup that only reads under grazing light"}], "textureResolution": 1024, "textureProjection": {"mode": "triplanar-world", "texelDensityIntent": "roughly 1400 texels per world unit at 1024, so the mottle stays sub-pixel at gameplay distance and only reads under review framing"}, "localOverrides": [], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\mop\\evidence\\crops\\button-coral-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with a de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.82, "estimatedFidelity": 0.82, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; these maps are reference-derived estimates.", "limitationNote": "usable is false on purpose. referenceMapUrl() resolves these maps by absolute disk path, which cannot load in a browser, so binding them would break the runtime asset. The reference is also a soft studio render of flat matte plastic with no surface pattern, so the crops carry baked lighting rather than albedo; tiling them would paint the reference's own shading onto every facet. The runtime instead builds independent procedural canvas maps and the extracted palettes and roughness estimates are used as evidence for the scalars below.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\mop\\evidence\\pbr\\button-coral_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\mop\\evidence\\pbr\\button-coral_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\mop\\evidence\\pbr\\button-coral_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\mop\\evidence\\pbr\\button-coral_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\mop\\evidence\\pbr\\button-coral_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "The only saturated accent on the prop. Deliberately distinct from PALETTE.danger (#b3123c), which is reserved for hazard ground markers and must never appear on a prop."},
    options
  );
  materialMap["fringe-grey"] = createSculptMaterial(
    "fringe-grey",
    {"id": "fringe-grey", "name": "Microfibre fringe", "type": "physical", "shaderModel": "MeshPhysicalMaterial (flocked microfibre, fully diffuse)", "baseColor": "#a8a49f", "color": "#a8a49f", "albedo": {"dominant": "#a8a49f", "secondary": ["#b0aca8", "#918d88"], "samplingNotes": "Median-sampled from the named region of the reference and cross-checked against the magnified crop. The sampled values are lit pixels, so the authored albedo is darkened from the sample to remove the key light's contribution.", "textureStrategy": "procedural canvas albedo with low-amplitude mottle"}, "roughness": {"base": 0.92, "variation": 0.05, "map": "independent-procedural-field", "localResponse": "recesses and the gaps between tufts trend rougher; convex crowns trend marginally smoother, though nothing on this prop becomes glossy"}, "metalness": 0.0, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.16, "scale": 20.0, "space": "tangent"}, "ambientOcclusion": {"cavityStrength": 0.75, "contactShadowBias": 0.3, "notes": "Darken the deck-to-rim seam, the wall beneath the rim overhang, the bumper gaps, the latch recess and the roots between fringe tufts."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 3.0, "amplitude": 0.28, "role": "broad tone drift across a moulded panel"}, {"id": "meso", "frequency": 15.0, "amplitude": 0.14, "role": "shallow moulding flow and sink-mark relief"}, {"id": "micro", "frequency": 60.0, "amplitude": 0.05, "role": "matte-texture breakup that only reads under grazing light"}], "textureResolution": 1024, "textureProjection": {"mode": "triplanar-world", "texelDensityIntent": "roughly 1400 texels per world unit at 1024, so the mottle stays sub-pixel at gameplay distance and only reads under review framing"}, "localOverrides": [{"id": "tuft-root-occlusion", "kind": "ambient-occlusion", "region": "between adjacent tufts and where each tuft meets the shell underside", "aoStrength": 0.95, "roughness": 0.94, "notes": "Self-shadowing between tufts is most of what makes the fringe read as fibrous."}], "referencePbr": {"version": "1.0", "sourceImage": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\mop\\evidence\\crops\\fringe-grey-crop.png", "extractor": "forge/stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with a de-lighting estimate; not photogrammetry", "usable": false, "verdict": "pass", "confidence": 0.71, "estimatedFidelity": 0.71, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; these maps are reference-derived estimates.", "limitationNote": "usable is false on purpose. referenceMapUrl() resolves these maps by absolute disk path, which cannot load in a browser, so binding them would break the runtime asset. The reference is also a soft studio render of flat matte plastic with no surface pattern, so the crops carry baked lighting rather than albedo; tiling them would paint the reference's own shading onto every facet. The runtime instead builds independent procedural canvas maps and the extracted palettes and roughness estimates are used as evidence for the scalars below.", "maps": {"albedo": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\mop\\evidence\\pbr\\fringe-grey_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\mop\\evidence\\pbr\\fringe-grey_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\mop\\evidence\\pbr\\fringe-grey_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\mop\\evidence\\pbr\\fringe-grey_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\Users\\Mcgib\\Partners HealthCare Dropbox\\Jason Gibbons\\Portals make it worse\\assets\\reference\\mop\\evidence\\pbr\\fringe-grey_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}, "notes": "Flocked microfibre: the roughest material on the prop and fully diffuse. Its extraction confidence is the lowest of the five because the crop is small and sits against the backdrop."},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const attachment_shell_body_0 = null;
  const endpoint_shell_body_0 = makeAttachmentEndpoint(attachment_shell_body_0);
  const node_shell_body_0 = new THREE.Group();
  node_shell_body_0.name = "Cream shell body__pivot";
  if (endpoint_shell_body_0) {
    node_shell_body_0.position.copy(endpoint_shell_body_0.start);
    node_shell_body_0.rotation.set(0, 0, 0);
    node_shell_body_0.scale.set(1, 1, 1);
  } else {
    node_shell_body_0.position.set(0.0, 0.0, 0.0);
    node_shell_body_0.rotation.set(0.0, 0.0, 0.0);
    node_shell_body_0.scale.set(1.0, 1.0, 1.0);
  }
  node_shell_body_0.userData.sculptComponent = {"id": "shell-body", "name": "Cream shell body", "level": "macro", "role": "structure", "importance": 1.0, "confidence": 0.75, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "One continuously revolved cream surface: the reference shows an unbroken curve from the base, out to the widest wall, over the rim crown and back down into the deck recess, with no crease anywhere along it.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(230, 220, 203, 1.0)", "secondaryAlbedo": "rgba(207, 196, 178, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "solid of revolution carrying the wall taper, the rim crown and the deck recess", "edgeTreatment": {"type": "filleted", "bevelRadius": 0.004, "segments": 3}, "deformationStack": [], "uvStrategy": "LatheGeometry cylindrical UVs", "normalStrategy": "smooth vertex normals along the profile, so the rim reads as a curve", "latheProfile": {"points": [[0.0, 0.03443], [0.24, 0.03443], [0.3, 0.03683], [0.31608, 0.04043], [0.33329, 0.05227], [0.34593, 0.06558], [0.3512, 0.07128], [0.3505, 0.09029], [0.34488, 0.10882], [0.3354, 0.12612], [0.32029, 0.13971], [0.30835, 0.15206], [0.30484, 0.1568], [0.3044, 0.1584], [0.304, 0.1564], [0.3035, 0.15286], [0.2953, 0.15026], [0.16572, 0.15006], [0.0, 0.15006]], "segments": 48}}, "parent": null, "attachment": null, "dimensions": {"width": 0.7024, "height": 0.121968, "depth": 0.7024, "units": "world", "confidence": 0.7}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "socket", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "floor-contact", "localPosition": [0.0, 0.0, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Model base. The trap offsets the whole prop down by its collider half-height from here."}], "collider": {"type": "cylinder", "offset": [0.0, 0.07919999999999999, 0.0], "scale": [0.72, 0.15839999999999999, 0.72], "isTrigger": false, "notes": "Matches the trap's CylinderCollider(MOP_HALF_HEIGHT, MOP_RADIUS)."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chassis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shell-cream"}}, "material": "shell-cream", "materialLayers": ["shell-cream"], "deformations": [], "joints": [], "seams": [{"id": "deck-seat-seam", "with": "deck-plate", "notes": "The deck sits into the recess this profile turns back down to form."}], "localFeatures": [{"id": "wall-taper", "description": "Below the bumper the wall draws inward toward the base; the silhouette half-width falls from 470px at the band to roughly 440px near the floor.", "kind": "contour"}, {"id": "base-underside", "description": "A flat underside disc that closes the shell; never seen in the reference and carried at low confidence.", "kind": "contour"}], "evidenceRefs": ["full-object", "side-profile"], "notes": "Authored base-at-origin in game units so the prop needs no rescaling to fit its collider."};
  node_shell_body_0.userData.actionProfile = node_shell_body_0.userData.sculptComponent.actionProfile;
  (nodes["root"] ?? root).add(node_shell_body_0);
  nodes["shell-body"] = node_shell_body_0;
  const mesh_shell_body_0Geometry = endpoint_shell_body_0
    ? new THREE.CylinderGeometry(endpoint_shell_body_0.endRadius, endpoint_shell_body_0.baseRadius, endpoint_shell_body_0.length, 32, 12)
    : buildLatheGeometry({"points": [[0.0, 0.03443], [0.24, 0.03443], [0.3, 0.03683], [0.31608, 0.04043], [0.33329, 0.05227], [0.34593, 0.06558], [0.3512, 0.07128], [0.3505, 0.09029], [0.34488, 0.10882], [0.3354, 0.12612], [0.32029, 0.13971], [0.30835, 0.15206], [0.30484, 0.1568], [0.3044, 0.1584], [0.304, 0.1564], [0.3035, 0.15286], [0.2953, 0.15026], [0.16572, 0.15006], [0.0, 0.15006]], "segments": 48});
  const mesh_shell_body_0 = new THREE.Mesh(
    mesh_shell_body_0Geometry,
    materialMap["shell-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shell_body_0.name = "Cream shell body";
  if (endpoint_shell_body_0) {
    mesh_shell_body_0.position.copy(endpoint_shell_body_0.midpoint);
    mesh_shell_body_0.quaternion.copy(endpoint_shell_body_0.quaternion);
  }
  mesh_shell_body_0.castShadow = options.castShadow ?? true;
  mesh_shell_body_0.receiveShadow = options.receiveShadow ?? true;
  mesh_shell_body_0.userData.sculptComponent = node_shell_body_0.userData.sculptComponent;
  node_shell_body_0.add(mesh_shell_body_0);
  meshes["shell-body"] = mesh_shell_body_0;
  colliders["shell-body"] = {"type": "cylinder", "offset": [0.0, 0.07919999999999999, 0.0], "scale": [0.72, 0.15839999999999999, 0.72], "isTrigger": false, "notes": "Matches the trap's CylinderCollider(MOP_HALF_HEIGHT, MOP_RADIUS)."};
  destructionGroups["chassis"] ??= [];
  destructionGroups["chassis"].push(node_shell_body_0);
  const socket_shell_body_floor_contact_0 = new THREE.Object3D();
  socket_shell_body_floor_contact_0.name = "floor-contact";
  socket_shell_body_floor_contact_0.position.set(0.0, 0.0, 0.0);
  socket_shell_body_floor_contact_0.rotation.set(0.0, 0.0, 0.0);
  socket_shell_body_floor_contact_0.userData.socket = {"id": "floor-contact", "localPosition": [0.0, 0.0, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Model base. The trap offsets the whole prop down by its collider half-height from here."};
  node_shell_body_0.add(socket_shell_body_floor_contact_0);
  sockets["shell-body:floor-contact"] = socket_shell_body_floor_contact_0;

  const attachment_shell_rim_1 = null;
  const endpoint_shell_rim_1 = makeAttachmentEndpoint(attachment_shell_rim_1);
  const node_shell_rim_1 = new THREE.Group();
  node_shell_rim_1.name = "Raised rim lip__pivot";
  if (endpoint_shell_rim_1) {
    node_shell_rim_1.position.copy(endpoint_shell_rim_1.start);
    node_shell_rim_1.rotation.set(0, 0, 0);
    node_shell_rim_1.scale.set(1, 1, 1);
  } else {
    node_shell_rim_1.position.set(0.0, 0.0, 0.0);
    node_shell_rim_1.rotation.set(0.0, 0.0, 0.0);
    node_shell_rim_1.scale.set(1.0, 1.0, 1.0);
  }
  node_shell_rim_1.userData.sculptComponent = {"id": "shell-rim", "name": "Raised rim lip", "level": "meso", "role": "trim", "importance": 0.75, "confidence": 0.6, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "The crown between the deck seam and the outer wall is a smooth convex band in the reference, catching one broad soft highlight with no facet break across it.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(244, 238, 227, 1.0)", "secondaryAlbedo": "rgba(230, 220, 203, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.88}, "geometryDescriptor": {"topologyIntent": "convex annular crown standing proud of the recessed deck", "edgeTreatment": {"type": "filleted", "bevelRadius": 0.003, "segments": 3}, "deformationStack": [], "uvStrategy": "LatheGeometry cylindrical UVs", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.3039, 0.15306], [0.3047, 0.1572], [0.3103, 0.1584], [0.30484, 0.1566], [0.30835, 0.15206]], "segments": 48}}, "parent": "shell-body", "attachment": null, "dimensions": {"width": 0.6167072, "height": 0.006336000000000008, "depth": 0.6167072, "units": "world", "confidence": 0.6}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "socket", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": null, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chassis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shell-cream"}}, "material": "shell-cream", "materialLayers": ["shell-cream"], "deformations": [], "joints": [], "seams": [{"id": "rim-shell-seam", "with": "shell-body", "notes": "Coincident revolved surfaces; no visible seam."}], "localFeatures": [{"id": "rim-inner-lip", "description": "The cream rises above the mint deck as a raised lip, so the deck reads as recessed; visible as a bright crown line along the far rim.", "kind": "ridge"}, {"id": "rim-crown-sheen", "description": "A broad soft value gradient across the crown from curvature alone, not a specular hotspot.", "kind": "contour"}], "evidenceRefs": ["full-object", "rim-zone"], "notes": "Split out from the shell so the crown can be reviewed and re-profiled without touching the wall."};
  node_shell_rim_1.userData.actionProfile = node_shell_rim_1.userData.sculptComponent.actionProfile;
  (nodes["shell-body"] ?? root).add(node_shell_rim_1);
  nodes["shell-rim"] = node_shell_rim_1;
  const mesh_shell_rim_1Geometry = endpoint_shell_rim_1
    ? new THREE.CylinderGeometry(endpoint_shell_rim_1.endRadius, endpoint_shell_rim_1.baseRadius, endpoint_shell_rim_1.length, 32, 12)
    : buildLatheGeometry({"points": [[0.3039, 0.15306], [0.3047, 0.1572], [0.3103, 0.1584], [0.30484, 0.1566], [0.30835, 0.15206]], "segments": 48});
  const mesh_shell_rim_1 = new THREE.Mesh(
    mesh_shell_rim_1Geometry,
    materialMap["shell-cream"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shell_rim_1.name = "Raised rim lip";
  if (endpoint_shell_rim_1) {
    mesh_shell_rim_1.position.copy(endpoint_shell_rim_1.midpoint);
    mesh_shell_rim_1.quaternion.copy(endpoint_shell_rim_1.quaternion);
  }
  mesh_shell_rim_1.castShadow = options.castShadow ?? true;
  mesh_shell_rim_1.receiveShadow = options.receiveShadow ?? true;
  mesh_shell_rim_1.userData.sculptComponent = node_shell_rim_1.userData.sculptComponent;
  node_shell_rim_1.add(mesh_shell_rim_1);
  meshes["shell-rim"] = mesh_shell_rim_1;
  colliders["shell-rim"] = null;
  destructionGroups["chassis"] ??= [];
  destructionGroups["chassis"].push(node_shell_rim_1);

  const attachment_deck_plate_2 = null;
  const endpoint_deck_plate_2 = makeAttachmentEndpoint(attachment_deck_plate_2);
  const node_deck_plate_2 = new THREE.Group();
  node_deck_plate_2.name = "Mint top deck__pivot";
  if (endpoint_deck_plate_2) {
    node_deck_plate_2.position.copy(endpoint_deck_plate_2.start);
    node_deck_plate_2.rotation.set(0, 0, 0);
    node_deck_plate_2.scale.set(1, 1, 1);
  } else {
    node_deck_plate_2.position.set(0.0, 0.0, 0.0);
    node_deck_plate_2.rotation.set(0.0, 0.0, 0.0);
    node_deck_plate_2.scale.set(1.0, 1.0, 1.0);
  }
  node_deck_plate_2.userData.sculptComponent = {"id": "deck-plate", "name": "Mint top deck", "level": "meso", "role": "panel", "importance": 0.95, "confidence": 0.85, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "A single revolved disc with a very slight crown and a rolled edge; the reference shows a continuous tone across it with no flat-to-wall crease.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(156, 196, 171, 1.0)", "secondaryAlbedo": "rgba(139, 181, 156, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.92}, "geometryDescriptor": {"topologyIntent": "shallow crowned disc seated in the rim recess", "edgeTreatment": {"type": "filleted", "bevelRadius": 0.0016, "segments": 2}, "deformationStack": [], "uvStrategy": "LatheGeometry cylindrical UVs", "normalStrategy": "smooth vertex normals", "latheProfile": {"points": [[0.0, 0.15026], [0.2923, 0.15026], [0.2997, 0.15146], [0.3013, 0.15296], [0.2985, 0.15416], [0.21694, 0.15486], [0.16572, 0.15506], [0.0, 0.15506]], "segments": 48}}, "parent": "shell-body", "attachment": null, "dimensions": {"width": 0.6026, "height": 0.0048, "depth": 0.6026, "units": "world", "confidence": 0.85}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "socket", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "deck-centre", "localPosition": [0.0, 0.15506399999999998, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Deck surface centre; anchor for any decal."}], "collider": null, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chassis", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shell-cream"}}, "material": "deck-mint", "materialLayers": ["deck-mint"], "deformations": [], "joints": [], "seams": [{"id": "deck-seat-seam", "with": "shell-body", "notes": "Deck edge against the rim's inner lip."}], "localFeatures": [{"id": "deck-rim-seam", "description": "A fine dark groove where the mint deck meets the cream rim, running the full circumference at 83.7 percent of the plan radius.", "kind": "seam"}, {"id": "deck-crown", "description": "The deck is very slightly domed rather than dead flat, which is why its tone brightens toward the key side.", "kind": "contour"}], "evidenceRefs": ["full-object", "deck-zone"], "notes": "Largest single colour field and the strongest identity cue after the overall disc proportion."};
  node_deck_plate_2.userData.actionProfile = node_deck_plate_2.userData.sculptComponent.actionProfile;
  (nodes["shell-body"] ?? root).add(node_deck_plate_2);
  nodes["deck-plate"] = node_deck_plate_2;
  const mesh_deck_plate_2Geometry = endpoint_deck_plate_2
    ? new THREE.CylinderGeometry(endpoint_deck_plate_2.endRadius, endpoint_deck_plate_2.baseRadius, endpoint_deck_plate_2.length, 32, 12)
    : buildLatheGeometry({"points": [[0.0, 0.15026], [0.2923, 0.15026], [0.2997, 0.15146], [0.3013, 0.15296], [0.2985, 0.15416], [0.21694, 0.15486], [0.16572, 0.15506], [0.0, 0.15506]], "segments": 48});
  const mesh_deck_plate_2 = new THREE.Mesh(
    mesh_deck_plate_2Geometry,
    materialMap["deck-mint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_deck_plate_2.name = "Mint top deck";
  if (endpoint_deck_plate_2) {
    mesh_deck_plate_2.position.copy(endpoint_deck_plate_2.midpoint);
    mesh_deck_plate_2.quaternion.copy(endpoint_deck_plate_2.quaternion);
  }
  mesh_deck_plate_2.castShadow = options.castShadow ?? true;
  mesh_deck_plate_2.receiveShadow = options.receiveShadow ?? true;
  mesh_deck_plate_2.userData.sculptComponent = node_deck_plate_2.userData.sculptComponent;
  node_deck_plate_2.add(mesh_deck_plate_2);
  meshes["deck-plate"] = mesh_deck_plate_2;
  colliders["deck-plate"] = null;
  destructionGroups["chassis"] ??= [];
  destructionGroups["chassis"].push(node_deck_plate_2);
  const socket_deck_plate_deck_centre_0 = new THREE.Object3D();
  socket_deck_plate_deck_centre_0.name = "deck-centre";
  socket_deck_plate_deck_centre_0.position.set(0.0, 0.15506399999999998, 0.0);
  socket_deck_plate_deck_centre_0.rotation.set(0.0, 0.0, 0.0);
  socket_deck_plate_deck_centre_0.userData.socket = {"id": "deck-centre", "localPosition": [0.0, 0.15506399999999998, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Deck surface centre; anchor for any decal."};
  node_deck_plate_2.add(socket_deck_plate_deck_centre_0);
  sockets["deck-plate:deck-centre"] = socket_deck_plate_deck_centre_0;

  const attachment_power_button_3 = null;
  const endpoint_power_button_3 = makeAttachmentEndpoint(attachment_power_button_3);
  const node_power_button_3 = new THREE.Group();
  node_power_button_3.name = "Coral power button__pivot";
  if (endpoint_power_button_3) {
    node_power_button_3.position.copy(endpoint_power_button_3.start);
    node_power_button_3.rotation.set(0, 0, 0);
    node_power_button_3.scale.set(1, 1, 1);
  } else {
    node_power_button_3.position.set(0.0, 0.0, -0.1745);
    node_power_button_3.rotation.set(0.0, 0.0, 0.0);
    node_power_button_3.scale.set(1.0, 1.0, 1.0);
  }
  node_power_button_3.userData.sculptComponent = {"id": "power-button", "name": "Coral power button", "level": "meso", "role": "control", "importance": 0.85, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "A separately moulded disc sitting on the deck with its own filleted rim and a visible contact shadow around its base, not a printed circle.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(224, 102, 95, 1.0)", "secondaryAlbedo": "rgba(201, 84, 78, 1.0)", "materialClass": "plastic", "materialClassConfidence": 0.9}, "geometryDescriptor": {"topologyIntent": "shallow filleted disc button seated in a slight recess", "edgeTreatment": {"type": "filleted", "bevelRadius": 0.0022, "segments": 3}, "deformationStack": [], "uvStrategy": "LatheGeometry cylindrical UVs", "normalStrategy": "smooth vertex normals with a crease held at the fillet tangent", "latheProfile": {"points": [[0.0, 0.15466], [0.04822, 0.15466], [0.0513, 0.15546], [0.0513, 0.16086], [0.0497, 0.16236], [0.0471, 0.16306], [0.02565, 0.16346], [0.0, 0.16346]], "segments": 32}}, "parent": "deck-plate", "attachment": null, "dimensions": {"width": 0.1026, "height": 0.011, "depth": 0.1026, "units": "world", "confidence": 0.8}, "transform": {"position": [0.0, 0.0, -0.1745], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "presser", "pivot": {"mode": "socket", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.8}, "transformChannels": {"translate": true, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "button-top", "localPosition": [0.0, 0.163064, -0.1745], "localRotation": [0.0, 0.0, 0.0], "notes": "Press target; travels down the deck normal."}], "collider": {"type": "cylinder", "offset": [0.0, 0.15756399999999998, -0.1745], "scale": [0.1026, 0.011, 0.1026], "isTrigger": true, "notes": "Press proxy."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "control", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shell-cream"}}, "material": "button-coral", "materialLayers": ["button-coral"], "deformations": [], "joints": [], "seams": [{"id": "button-deck-seam", "with": "deck-plate", "notes": "Button base against the deck surface."}], "localFeatures": [{"id": "button-edge-fillet", "description": "The top face meets the side wall through a soft fillet that catches a light band around the button's upper rim.", "kind": "bevel"}, {"id": "button-recess-ring", "description": "The side wall is slightly wider at the top than at the bottom, so the button reads as seated in a shallow recess rather than stuck on.", "kind": "contour"}], "evidenceRefs": ["full-object", "deck-zone"], "notes": "Offset 0.1745 toward the back on the centreline, measured from its 112px screen offset."};
  node_power_button_3.userData.actionProfile = node_power_button_3.userData.sculptComponent.actionProfile;
  (nodes["deck-plate"] ?? root).add(node_power_button_3);
  nodes["power-button"] = node_power_button_3;
  const mesh_power_button_3Geometry = endpoint_power_button_3
    ? new THREE.CylinderGeometry(endpoint_power_button_3.endRadius, endpoint_power_button_3.baseRadius, endpoint_power_button_3.length, 32, 12)
    : buildLatheGeometry({"points": [[0.0, 0.15466], [0.04822, 0.15466], [0.0513, 0.15546], [0.0513, 0.16086], [0.0497, 0.16236], [0.0471, 0.16306], [0.02565, 0.16346], [0.0, 0.16346]], "segments": 32});
  const mesh_power_button_3 = new THREE.Mesh(
    mesh_power_button_3Geometry,
    materialMap["button-coral"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_power_button_3.name = "Coral power button";
  if (endpoint_power_button_3) {
    mesh_power_button_3.position.copy(endpoint_power_button_3.midpoint);
    mesh_power_button_3.quaternion.copy(endpoint_power_button_3.quaternion);
  }
  mesh_power_button_3.castShadow = options.castShadow ?? true;
  mesh_power_button_3.receiveShadow = options.receiveShadow ?? true;
  mesh_power_button_3.userData.sculptComponent = node_power_button_3.userData.sculptComponent;
  node_power_button_3.add(mesh_power_button_3);
  meshes["power-button"] = mesh_power_button_3;
  colliders["power-button"] = {"type": "cylinder", "offset": [0.0, 0.15756399999999998, -0.1745], "scale": [0.1026, 0.011, 0.1026], "isTrigger": true, "notes": "Press proxy."};
  destructionGroups["control"] ??= [];
  destructionGroups["control"].push(node_power_button_3);
  const socket_power_button_button_top_0 = new THREE.Object3D();
  socket_power_button_button_top_0.name = "button-top";
  socket_power_button_button_top_0.position.set(0.0, 0.163064, -0.1745);
  socket_power_button_button_top_0.rotation.set(0.0, 0.0, 0.0);
  socket_power_button_button_top_0.userData.socket = {"id": "button-top", "localPosition": [0.0, 0.163064, -0.1745], "localRotation": [0.0, 0.0, 0.0], "notes": "Press target; travels down the deck normal."};
  node_power_button_3.add(socket_power_button_button_top_0);
  sockets["power-button:button-top"] = socket_power_button_button_top_0;

  const attachment_bumper_band_4 = null;
  const endpoint_bumper_band_4 = makeAttachmentEndpoint(attachment_bumper_band_4);
  const node_bumper_band_4 = new THREE.Group();
  node_bumper_band_4.name = "Segmented bumper band__pivot";
  if (endpoint_bumper_band_4) {
    node_bumper_band_4.position.copy(endpoint_bumper_band_4.start);
    node_bumper_band_4.rotation.set(0, 0, 0);
    node_bumper_band_4.scale.set(1, 1, 1);
  } else {
    node_bumper_band_4.position.set(0.0, 0.0, 0.0);
    node_bumper_band_4.rotation.set(0.0, 0.0, 0.0);
    node_bumper_band_4.scale.set(1.0, 1.0, 1.0);
  }
  node_bumper_band_4.userData.sculptComponent = {"id": "bumper-band", "name": "Segmented bumper band", "level": "meso", "role": "trim", "importance": 0.9, "confidence": 0.65, "primitive": "lathe", "topologyClass": "material-only", "topologyRationale": "A grouping node only. It owns the band's shared local features and carries no geometry of its own, so the four segments below stay independently pickable.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(58, 65, 80, 1.0)", "secondaryAlbedo": "rgba(47, 53, 66, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.85}, "geometryDescriptor": {"topologyIntent": "grouping node for the four bumper segments", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "none", "normalStrategy": "none", "latheProfile": {"points": [[0.0001, 0.07128], [0.0002, 0.07138]], "segments": 3}}, "parent": "shell-body", "attachment": null, "dimensions": {"width": 0.72, "height": 0.03801599999999998, "depth": 0.72, "units": "world", "confidence": 0.7}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "socket", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": null, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bumper", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shell-cream"}}, "material": "bumper-navy", "materialLayers": ["bumper-navy"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "segment-gap", "description": "Narrow cream slots split the navy into segments; the two on the front half are measured at plus and minus 23.8 degrees.", "kind": "groove"}, {"id": "segment-end-cap", "description": "Each segment terminates in a generously rounded end cap rather than a square cut.", "kind": "bevel"}, {"id": "segment-standoff", "description": "The band stands 0.0088 proud of the cream wall and casts its own soft shadow onto it; it is an applied bumper, not a painted stripe.", "kind": "ridge"}], "evidenceRefs": ["full-object", "bumper-zone"], "notes": "A named group of named parts stays a container under the assembly gate, which is what this is."};
  node_bumper_band_4.userData.actionProfile = node_bumper_band_4.userData.sculptComponent.actionProfile;
  (nodes["shell-body"] ?? root).add(node_bumper_band_4);
  nodes["bumper-band"] = node_bumper_band_4;
  const mesh_bumper_band_4Geometry = endpoint_bumper_band_4
    ? new THREE.CylinderGeometry(endpoint_bumper_band_4.endRadius, endpoint_bumper_band_4.baseRadius, endpoint_bumper_band_4.length, 32, 12)
    : buildLatheGeometry({"points": [[0.0001, 0.07128], [0.0002, 0.07138]], "segments": 3});
  const mesh_bumper_band_4 = new THREE.Mesh(
    mesh_bumper_band_4Geometry,
    materialMap["bumper-navy"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bumper_band_4.name = "Segmented bumper band";
  if (endpoint_bumper_band_4) {
    mesh_bumper_band_4.position.copy(endpoint_bumper_band_4.midpoint);
    mesh_bumper_band_4.quaternion.copy(endpoint_bumper_band_4.quaternion);
  }
  mesh_bumper_band_4.castShadow = options.castShadow ?? true;
  mesh_bumper_band_4.receiveShadow = options.receiveShadow ?? true;
  mesh_bumper_band_4.userData.sculptComponent = node_bumper_band_4.userData.sculptComponent;
  node_bumper_band_4.add(mesh_bumper_band_4);
  meshes["bumper-band"] = mesh_bumper_band_4;
  colliders["bumper-band"] = null;
  destructionGroups["bumper"] ??= [];
  destructionGroups["bumper"].push(node_bumper_band_4);

  const attachment_bumper_front_5 = null;
  const endpoint_bumper_front_5 = makeAttachmentEndpoint(attachment_bumper_front_5);
  const node_bumper_front_5 = new THREE.Group();
  node_bumper_front_5.name = "Bumper Front__pivot";
  if (endpoint_bumper_front_5) {
    node_bumper_front_5.position.copy(endpoint_bumper_front_5.start);
    node_bumper_front_5.rotation.set(0, 0, 0);
    node_bumper_front_5.scale.set(1, 1, 1);
  } else {
    node_bumper_front_5.position.set(0.0, 0.0, 0.0);
    node_bumper_front_5.rotation.set(0.0, 0.0, 0.0);
    node_bumper_front_5.scale.set(1.0, 1.0, 1.0);
  }
  node_bumper_front_5.userData.sculptComponent = {"id": "bumper-front", "name": "Bumper Front", "level": "meso", "role": "trim", "importance": 0.8, "confidence": 0.9, "primitive": "lathe", "topologyClass": "conforming-shell", "topologyRationale": "An applied band that follows the shell wall's curvature at a constant standoff. Constant radius and constant height over its arc, so it is a partial revolution of the band's own section rather than a sweep along a free 3D spine.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(58, 65, 80, 1.0)", "secondaryAlbedo": "rgba(47, 53, 66, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.85}, "geometryDescriptor": {"topologyIntent": "band section revolved through the segment's own arc", "edgeTreatment": {"type": "filleted", "bevelRadius": 0.012925439999999995, "segments": 3}, "deformationStack": [], "uvStrategy": "lathe UVs", "normalStrategy": "smooth normals around the section, creased at the arc ends", "latheProfile": {"points": [[0.3447, 0.0652], [0.3447, 0.07736], [0.34568, 0.08231], [0.34849, 0.0865], [0.35268, 0.0893], [0.34707, 0.09029], [0.35202, 0.0893], [0.35621, 0.0865], [0.35902, 0.08231], [0.36, 0.0652], [0.35902, 0.06025], [0.35621, 0.05606], [0.35202, 0.05326], [0.35763, 0.05227], [0.35268, 0.05326], [0.34849, 0.05606], [0.34568, 0.06025]], "segments": 11, "phiStart": -0.37525, "phiLength": 0.75049}}, "parent": "bumper-band", "attachment": null, "dimensions": {"width": 0.72, "height": 0.03801599999999998, "depth": 0.72, "units": "world", "confidence": 0.9}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "socket", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.07127999999999998, 0.0], "scale": [0.72, 0.03801599999999998, 0.72], "isTrigger": false, "notes": "Shared band proxy; the real trap collider is one cylinder for the whole prop."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bumper", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shell-cream"}}, "material": "bumper-navy", "materialLayers": ["bumper-navy"], "deformations": [], "joints": [], "seams": [{"id": "bumper-front-shell-seam", "with": "shell-body", "notes": "Band inner face against the cream wall."}], "localFeatures": [], "evidenceRefs": ["full-object", "bumper-zone"], "notes": "Front segment, both ends measured from the visible gaps."};
  node_bumper_front_5.userData.actionProfile = node_bumper_front_5.userData.sculptComponent.actionProfile;
  (nodes["bumper-band"] ?? root).add(node_bumper_front_5);
  nodes["bumper-front"] = node_bumper_front_5;
  const mesh_bumper_front_5Geometry = endpoint_bumper_front_5
    ? new THREE.CylinderGeometry(endpoint_bumper_front_5.endRadius, endpoint_bumper_front_5.baseRadius, endpoint_bumper_front_5.length, 32, 12)
    : buildLatheGeometry({"points": [[0.3447, 0.0652], [0.3447, 0.07736], [0.34568, 0.08231], [0.34849, 0.0865], [0.35268, 0.0893], [0.34707, 0.09029], [0.35202, 0.0893], [0.35621, 0.0865], [0.35902, 0.08231], [0.36, 0.0652], [0.35902, 0.06025], [0.35621, 0.05606], [0.35202, 0.05326], [0.35763, 0.05227], [0.35268, 0.05326], [0.34849, 0.05606], [0.34568, 0.06025]], "segments": 11, "phiStart": -0.37525, "phiLength": 0.75049});
  const mesh_bumper_front_5 = new THREE.Mesh(
    mesh_bumper_front_5Geometry,
    materialMap["bumper-navy"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bumper_front_5.name = "Bumper Front";
  if (endpoint_bumper_front_5) {
    mesh_bumper_front_5.position.copy(endpoint_bumper_front_5.midpoint);
    mesh_bumper_front_5.quaternion.copy(endpoint_bumper_front_5.quaternion);
  }
  mesh_bumper_front_5.castShadow = options.castShadow ?? true;
  mesh_bumper_front_5.receiveShadow = options.receiveShadow ?? true;
  mesh_bumper_front_5.userData.sculptComponent = node_bumper_front_5.userData.sculptComponent;
  node_bumper_front_5.add(mesh_bumper_front_5);
  meshes["bumper-front"] = mesh_bumper_front_5;
  colliders["bumper-front"] = {"type": "box", "offset": [0.0, 0.07127999999999998, 0.0], "scale": [0.72, 0.03801599999999998, 0.72], "isTrigger": false, "notes": "Shared band proxy; the real trap collider is one cylinder for the whole prop."};
  destructionGroups["bumper"] ??= [];
  destructionGroups["bumper"].push(node_bumper_front_5);

  const attachment_bumper_right_6 = null;
  const endpoint_bumper_right_6 = makeAttachmentEndpoint(attachment_bumper_right_6);
  const node_bumper_right_6 = new THREE.Group();
  node_bumper_right_6.name = "Bumper Right__pivot";
  if (endpoint_bumper_right_6) {
    node_bumper_right_6.position.copy(endpoint_bumper_right_6.start);
    node_bumper_right_6.rotation.set(0, 0, 0);
    node_bumper_right_6.scale.set(1, 1, 1);
  } else {
    node_bumper_right_6.position.set(0.0, 0.0, 0.0);
    node_bumper_right_6.rotation.set(0.0, 0.0, 0.0);
    node_bumper_right_6.scale.set(1.0, 1.0, 1.0);
  }
  node_bumper_right_6.userData.sculptComponent = {"id": "bumper-right", "name": "Bumper Right", "level": "meso", "role": "trim", "importance": 0.8, "confidence": 0.55, "primitive": "lathe", "topologyClass": "conforming-shell", "topologyRationale": "An applied band that follows the shell wall's curvature at a constant standoff. Constant radius and constant height over its arc, so it is a partial revolution of the band's own section rather than a sweep along a free 3D spine.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(58, 65, 80, 1.0)", "secondaryAlbedo": "rgba(47, 53, 66, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.85}, "geometryDescriptor": {"topologyIntent": "band section revolved through the segment's own arc", "edgeTreatment": {"type": "filleted", "bevelRadius": 0.012925439999999995, "segments": 3}, "deformationStack": [], "uvStrategy": "lathe UVs", "normalStrategy": "smooth normals around the section, creased at the arc ends", "latheProfile": {"points": [[0.3447, 0.0652], [0.3447, 0.07736], [0.34568, 0.08231], [0.34849, 0.0865], [0.35268, 0.0893], [0.34707, 0.09029], [0.35202, 0.0893], [0.35621, 0.0865], [0.35902, 0.08231], [0.36, 0.0652], [0.35902, 0.06025], [0.35621, 0.05606], [0.35202, 0.05326], [0.35763, 0.05227], [0.35268, 0.05326], [0.34849, 0.05606], [0.34568, 0.06025]], "segments": 32, "phiStart": 0.46251, "phiLength": 2.21657}}, "parent": "bumper-band", "attachment": null, "dimensions": {"width": 0.72, "height": 0.03801599999999998, "depth": 0.72, "units": "world", "confidence": 0.55}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "socket", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.07127999999999998, 0.0], "scale": [0.72, 0.03801599999999998, 0.72], "isTrigger": false, "notes": "Shared band proxy; the real trap collider is one cylinder for the whole prop."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bumper", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shell-cream"}}, "material": "bumper-navy", "materialLayers": ["bumper-navy"], "deformations": [], "joints": [], "seams": [{"id": "bumper-right-shell-seam", "with": "shell-body", "notes": "Band inner face against the cream wall."}], "localFeatures": [], "evidenceRefs": ["full-object", "bumper-zone"], "notes": "Right segment; its front end is measured, its rear end is inferred."};
  node_bumper_right_6.userData.actionProfile = node_bumper_right_6.userData.sculptComponent.actionProfile;
  (nodes["bumper-band"] ?? root).add(node_bumper_right_6);
  nodes["bumper-right"] = node_bumper_right_6;
  const mesh_bumper_right_6Geometry = endpoint_bumper_right_6
    ? new THREE.CylinderGeometry(endpoint_bumper_right_6.endRadius, endpoint_bumper_right_6.baseRadius, endpoint_bumper_right_6.length, 32, 12)
    : buildLatheGeometry({"points": [[0.3447, 0.0652], [0.3447, 0.07736], [0.34568, 0.08231], [0.34849, 0.0865], [0.35268, 0.0893], [0.34707, 0.09029], [0.35202, 0.0893], [0.35621, 0.0865], [0.35902, 0.08231], [0.36, 0.0652], [0.35902, 0.06025], [0.35621, 0.05606], [0.35202, 0.05326], [0.35763, 0.05227], [0.35268, 0.05326], [0.34849, 0.05606], [0.34568, 0.06025]], "segments": 32, "phiStart": 0.46251, "phiLength": 2.21657});
  const mesh_bumper_right_6 = new THREE.Mesh(
    mesh_bumper_right_6Geometry,
    materialMap["bumper-navy"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bumper_right_6.name = "Bumper Right";
  if (endpoint_bumper_right_6) {
    mesh_bumper_right_6.position.copy(endpoint_bumper_right_6.midpoint);
    mesh_bumper_right_6.quaternion.copy(endpoint_bumper_right_6.quaternion);
  }
  mesh_bumper_right_6.castShadow = options.castShadow ?? true;
  mesh_bumper_right_6.receiveShadow = options.receiveShadow ?? true;
  mesh_bumper_right_6.userData.sculptComponent = node_bumper_right_6.userData.sculptComponent;
  node_bumper_right_6.add(mesh_bumper_right_6);
  meshes["bumper-right"] = mesh_bumper_right_6;
  colliders["bumper-right"] = {"type": "box", "offset": [0.0, 0.07127999999999998, 0.0], "scale": [0.72, 0.03801599999999998, 0.72], "isTrigger": false, "notes": "Shared band proxy; the real trap collider is one cylinder for the whole prop."};
  destructionGroups["bumper"] ??= [];
  destructionGroups["bumper"].push(node_bumper_right_6);

  const attachment_bumper_rear_7 = null;
  const endpoint_bumper_rear_7 = makeAttachmentEndpoint(attachment_bumper_rear_7);
  const node_bumper_rear_7 = new THREE.Group();
  node_bumper_rear_7.name = "Bumper Rear__pivot";
  if (endpoint_bumper_rear_7) {
    node_bumper_rear_7.position.copy(endpoint_bumper_rear_7.start);
    node_bumper_rear_7.rotation.set(0, 0, 0);
    node_bumper_rear_7.scale.set(1, 1, 1);
  } else {
    node_bumper_rear_7.position.set(0.0, 0.0, 0.0);
    node_bumper_rear_7.rotation.set(0.0, 0.0, 0.0);
    node_bumper_rear_7.scale.set(1.0, 1.0, 1.0);
  }
  node_bumper_rear_7.userData.sculptComponent = {"id": "bumper-rear", "name": "Bumper Rear", "level": "meso", "role": "trim", "importance": 0.8, "confidence": 0.3, "primitive": "lathe", "topologyClass": "conforming-shell", "topologyRationale": "An applied band that follows the shell wall's curvature at a constant standoff. Constant radius and constant height over its arc, so it is a partial revolution of the band's own section rather than a sweep along a free 3D spine.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(58, 65, 80, 1.0)", "secondaryAlbedo": "rgba(47, 53, 66, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.85}, "geometryDescriptor": {"topologyIntent": "band section revolved through the segment's own arc", "edgeTreatment": {"type": "filleted", "bevelRadius": 0.012925439999999995, "segments": 3}, "deformationStack": [], "uvStrategy": "lathe UVs", "normalStrategy": "smooth normals around the section, creased at the arc ends", "latheProfile": {"points": [[0.3447, 0.0652], [0.3447, 0.07736], [0.34568, 0.08231], [0.34849, 0.0865], [0.35268, 0.0893], [0.34707, 0.09029], [0.35202, 0.0893], [0.35621, 0.0865], [0.35902, 0.08231], [0.36, 0.0652], [0.35902, 0.06025], [0.35621, 0.05606], [0.35202, 0.05326], [0.35763, 0.05227], [0.35268, 0.05326], [0.34849, 0.05606], [0.34568, 0.06025]], "segments": 11, "phiStart": 2.76635, "phiLength": 0.75049}}, "parent": "bumper-band", "attachment": null, "dimensions": {"width": 0.72, "height": 0.03801599999999998, "depth": 0.72, "units": "world", "confidence": 0.3}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "socket", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.07127999999999998, 0.0], "scale": [0.72, 0.03801599999999998, 0.72], "isTrigger": false, "notes": "Shared band proxy; the real trap collider is one cylinder for the whole prop."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bumper", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shell-cream"}}, "material": "bumper-navy", "materialLayers": ["bumper-navy"], "deformations": [], "joints": [], "seams": [{"id": "bumper-rear-shell-seam", "with": "shell-body", "notes": "Band inner face against the cream wall."}], "localFeatures": [], "evidenceRefs": ["full-object", "bumper-zone"], "notes": "Rear segment; entirely inferred from front/side symmetry, not visible."};
  node_bumper_rear_7.userData.actionProfile = node_bumper_rear_7.userData.sculptComponent.actionProfile;
  (nodes["bumper-band"] ?? root).add(node_bumper_rear_7);
  nodes["bumper-rear"] = node_bumper_rear_7;
  const mesh_bumper_rear_7Geometry = endpoint_bumper_rear_7
    ? new THREE.CylinderGeometry(endpoint_bumper_rear_7.endRadius, endpoint_bumper_rear_7.baseRadius, endpoint_bumper_rear_7.length, 32, 12)
    : buildLatheGeometry({"points": [[0.3447, 0.0652], [0.3447, 0.07736], [0.34568, 0.08231], [0.34849, 0.0865], [0.35268, 0.0893], [0.34707, 0.09029], [0.35202, 0.0893], [0.35621, 0.0865], [0.35902, 0.08231], [0.36, 0.0652], [0.35902, 0.06025], [0.35621, 0.05606], [0.35202, 0.05326], [0.35763, 0.05227], [0.35268, 0.05326], [0.34849, 0.05606], [0.34568, 0.06025]], "segments": 11, "phiStart": 2.76635, "phiLength": 0.75049});
  const mesh_bumper_rear_7 = new THREE.Mesh(
    mesh_bumper_rear_7Geometry,
    materialMap["bumper-navy"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bumper_rear_7.name = "Bumper Rear";
  if (endpoint_bumper_rear_7) {
    mesh_bumper_rear_7.position.copy(endpoint_bumper_rear_7.midpoint);
    mesh_bumper_rear_7.quaternion.copy(endpoint_bumper_rear_7.quaternion);
  }
  mesh_bumper_rear_7.castShadow = options.castShadow ?? true;
  mesh_bumper_rear_7.receiveShadow = options.receiveShadow ?? true;
  mesh_bumper_rear_7.userData.sculptComponent = node_bumper_rear_7.userData.sculptComponent;
  node_bumper_rear_7.add(mesh_bumper_rear_7);
  meshes["bumper-rear"] = mesh_bumper_rear_7;
  colliders["bumper-rear"] = {"type": "box", "offset": [0.0, 0.07127999999999998, 0.0], "scale": [0.72, 0.03801599999999998, 0.72], "isTrigger": false, "notes": "Shared band proxy; the real trap collider is one cylinder for the whole prop."};
  destructionGroups["bumper"] ??= [];
  destructionGroups["bumper"].push(node_bumper_rear_7);

  const attachment_bumper_left_8 = null;
  const endpoint_bumper_left_8 = makeAttachmentEndpoint(attachment_bumper_left_8);
  const node_bumper_left_8 = new THREE.Group();
  node_bumper_left_8.name = "Bumper Left__pivot";
  if (endpoint_bumper_left_8) {
    node_bumper_left_8.position.copy(endpoint_bumper_left_8.start);
    node_bumper_left_8.rotation.set(0, 0, 0);
    node_bumper_left_8.scale.set(1, 1, 1);
  } else {
    node_bumper_left_8.position.set(0.0, 0.0, 0.0);
    node_bumper_left_8.rotation.set(0.0, 0.0, 0.0);
    node_bumper_left_8.scale.set(1.0, 1.0, 1.0);
  }
  node_bumper_left_8.userData.sculptComponent = {"id": "bumper-left", "name": "Bumper Left", "level": "meso", "role": "trim", "importance": 0.8, "confidence": 0.55, "primitive": "lathe", "topologyClass": "conforming-shell", "topologyRationale": "An applied band that follows the shell wall's curvature at a constant standoff. Constant radius and constant height over its arc, so it is a partial revolution of the band's own section rather than a sweep along a free 3D spine.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(58, 65, 80, 1.0)", "secondaryAlbedo": "rgba(47, 53, 66, 1.0)", "materialClass": "rubber", "materialClassConfidence": 0.85}, "geometryDescriptor": {"topologyIntent": "band section revolved through the segment's own arc", "edgeTreatment": {"type": "filleted", "bevelRadius": 0.012925439999999995, "segments": 3}, "deformationStack": [], "uvStrategy": "lathe UVs", "normalStrategy": "smooth normals around the section, creased at the arc ends", "latheProfile": {"points": [[0.3447, 0.0652], [0.3447, 0.07736], [0.34568, 0.08231], [0.34849, 0.0865], [0.35268, 0.0893], [0.34707, 0.09029], [0.35202, 0.0893], [0.35621, 0.0865], [0.35902, 0.08231], [0.36, 0.0652], [0.35902, 0.06025], [0.35621, 0.05606], [0.35202, 0.05326], [0.35763, 0.05227], [0.35268, 0.05326], [0.34849, 0.05606], [0.34568, 0.06025]], "segments": 32, "phiStart": 3.6041, "phiLength": 2.21657}}, "parent": "bumper-band", "attachment": null, "dimensions": {"width": 0.72, "height": 0.03801599999999998, "depth": 0.72, "units": "world", "confidence": 0.55}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "socket", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0.0, 0.07127999999999998, 0.0], "scale": [0.72, 0.03801599999999998, 0.72], "isTrigger": false, "notes": "Shared band proxy; the real trap collider is one cylinder for the whole prop."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bumper", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shell-cream"}}, "material": "bumper-navy", "materialLayers": ["bumper-navy"], "deformations": [], "joints": [], "seams": [{"id": "bumper-left-shell-seam", "with": "shell-body", "notes": "Band inner face against the cream wall."}], "localFeatures": [], "evidenceRefs": ["full-object", "bumper-zone"], "notes": "Left segment; its front end is measured, its rear end is inferred."};
  node_bumper_left_8.userData.actionProfile = node_bumper_left_8.userData.sculptComponent.actionProfile;
  (nodes["bumper-band"] ?? root).add(node_bumper_left_8);
  nodes["bumper-left"] = node_bumper_left_8;
  const mesh_bumper_left_8Geometry = endpoint_bumper_left_8
    ? new THREE.CylinderGeometry(endpoint_bumper_left_8.endRadius, endpoint_bumper_left_8.baseRadius, endpoint_bumper_left_8.length, 32, 12)
    : buildLatheGeometry({"points": [[0.3447, 0.0652], [0.3447, 0.07736], [0.34568, 0.08231], [0.34849, 0.0865], [0.35268, 0.0893], [0.34707, 0.09029], [0.35202, 0.0893], [0.35621, 0.0865], [0.35902, 0.08231], [0.36, 0.0652], [0.35902, 0.06025], [0.35621, 0.05606], [0.35202, 0.05326], [0.35763, 0.05227], [0.35268, 0.05326], [0.34849, 0.05606], [0.34568, 0.06025]], "segments": 32, "phiStart": 3.6041, "phiLength": 2.21657});
  const mesh_bumper_left_8 = new THREE.Mesh(
    mesh_bumper_left_8Geometry,
    materialMap["bumper-navy"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bumper_left_8.name = "Bumper Left";
  if (endpoint_bumper_left_8) {
    mesh_bumper_left_8.position.copy(endpoint_bumper_left_8.midpoint);
    mesh_bumper_left_8.quaternion.copy(endpoint_bumper_left_8.quaternion);
  }
  mesh_bumper_left_8.castShadow = options.castShadow ?? true;
  mesh_bumper_left_8.receiveShadow = options.receiveShadow ?? true;
  mesh_bumper_left_8.userData.sculptComponent = node_bumper_left_8.userData.sculptComponent;
  node_bumper_left_8.add(mesh_bumper_left_8);
  meshes["bumper-left"] = mesh_bumper_left_8;
  colliders["bumper-left"] = {"type": "box", "offset": [0.0, 0.07127999999999998, 0.0], "scale": [0.72, 0.03801599999999998, 0.72], "isTrigger": false, "notes": "Shared band proxy; the real trap collider is one cylinder for the whole prop."};
  destructionGroups["bumper"] ??= [];
  destructionGroups["bumper"].push(node_bumper_left_8);

  const attachment_fringe_skirt_9 = null;
  const endpoint_fringe_skirt_9 = makeAttachmentEndpoint(attachment_fringe_skirt_9);
  const node_fringe_skirt_9 = new THREE.Group();
  node_fringe_skirt_9.name = "Microfibre fringe skirt__pivot";
  if (endpoint_fringe_skirt_9) {
    node_fringe_skirt_9.position.copy(endpoint_fringe_skirt_9.start);
    node_fringe_skirt_9.rotation.set(0, 0, 0);
    node_fringe_skirt_9.scale.set(1, 1, 1);
  } else {
    node_fringe_skirt_9.position.set(0.0, 0.0, 0.0);
    node_fringe_skirt_9.rotation.set(0.0, 0.0, 0.0);
    node_fringe_skirt_9.scale.set(1.0, 1.0, 1.0);
  }
  node_fringe_skirt_9.userData.sculptComponent = {"id": "fringe-skirt", "name": "Microfibre fringe skirt", "level": "macro", "role": "structure", "importance": 0.9, "confidence": 0.6, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "The solid backing band the tuft rows stand on. The reference fringe is opaque: no background shows between tufts anywhere around the rim, so there is a skirt behind them and the tufts are its surface relief rather than the whole part.", "colorMaterialRecipe": {"dominantAlbedo": "rgba(168, 164, 159, 1.0)", "secondaryAlbedo": "rgba(145, 141, 136, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.75}, "geometryDescriptor": {"topologyIntent": "shallow revolved skirt filling the band between the shell's underside and the floor, held just inside the tuft ring", "edgeTreatment": {"type": "rolled", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "lathe UVs", "normalStrategy": "vertex normals from the revolved profile", "latheProfile": {"points": [[0.0001, 0.03643], [0.3258, 0.03643], [0.34195, 0.02259], [0.33435, 0.00802], [0.32105, 0.0], [0.0001, 0.0]], "segments": 40}}, "parent": "shell-body", "attachment": null, "dimensions": {"width": 0.72, "height": 0.036432, "depth": 0.72, "units": "world", "confidence": 0.6}, "transform": {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}, "actionProfile": {"animationRole": "spinner", "pivot": {"mode": "socket", "localPosition": [0.0, 0.0, 0.0], "axis": [0.0, 1.0, 0.0], "confidence": 0.8}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "brush-ring", "localPosition": [0.0, 0.018216, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Spin the whole skirt about Y; the trap already animates a brush ring."}], "collider": null, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "skirt", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "shell-cream"}}, "material": "fringe-grey", "materialLayers": ["fringe-grey"], "deformations": [], "joints": [], "seams": [{"id": "fringe-shell-seam", "with": "shell-body", "notes": "Tuft roots against the shell underside."}], "localFeatures": [{"id": "tuft-scallop", "description": "Individual rounded tufts give the bottom of the silhouette a scalloped rather than a smooth outline; this is what makes it a mop and not a vacuum.", "kind": "contour"}, {"id": "tuft-row-stagger", "description": "Two staggered rows, so the lower row shows through the gaps in the upper one and the band reads dense rather than as a picket line.", "kind": "contour"}], "evidenceRefs": ["full-object", "fringe-zone"], "notes": "Rotating this node is the cheapest way to animate the mop's brush action."};
  node_fringe_skirt_9.userData.actionProfile = node_fringe_skirt_9.userData.sculptComponent.actionProfile;
  (nodes["shell-body"] ?? root).add(node_fringe_skirt_9);
  nodes["fringe-skirt"] = node_fringe_skirt_9;
  const mesh_fringe_skirt_9Geometry = endpoint_fringe_skirt_9
    ? new THREE.CylinderGeometry(endpoint_fringe_skirt_9.endRadius, endpoint_fringe_skirt_9.baseRadius, endpoint_fringe_skirt_9.length, 32, 12)
    : buildLatheGeometry({"points": [[0.0001, 0.03643], [0.3258, 0.03643], [0.34195, 0.02259], [0.33435, 0.00802], [0.32105, 0.0], [0.0001, 0.0]], "segments": 40});
  const mesh_fringe_skirt_9 = new THREE.Mesh(
    mesh_fringe_skirt_9Geometry,
    materialMap["fringe-grey"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_fringe_skirt_9.name = "Microfibre fringe skirt";
  if (endpoint_fringe_skirt_9) {
    mesh_fringe_skirt_9.position.copy(endpoint_fringe_skirt_9.midpoint);
    mesh_fringe_skirt_9.quaternion.copy(endpoint_fringe_skirt_9.quaternion);
  }
  mesh_fringe_skirt_9.castShadow = options.castShadow ?? true;
  mesh_fringe_skirt_9.receiveShadow = options.receiveShadow ?? true;
  mesh_fringe_skirt_9.userData.sculptComponent = node_fringe_skirt_9.userData.sculptComponent;
  node_fringe_skirt_9.add(mesh_fringe_skirt_9);
  meshes["fringe-skirt"] = mesh_fringe_skirt_9;
  colliders["fringe-skirt"] = null;
  destructionGroups["skirt"] ??= [];
  destructionGroups["skirt"].push(node_fringe_skirt_9);
  const socket_fringe_skirt_brush_ring_0 = new THREE.Object3D();
  socket_fringe_skirt_brush_ring_0.name = "brush-ring";
  socket_fringe_skirt_brush_ring_0.position.set(0.0, 0.018216, 0.0);
  socket_fringe_skirt_brush_ring_0.rotation.set(0.0, 0.0, 0.0);
  socket_fringe_skirt_brush_ring_0.userData.socket = {"id": "brush-ring", "localPosition": [0.0, 0.018216, 0.0], "localRotation": [0.0, 0.0, 0.0], "notes": "Spin the whole skirt about Y; the trap already animates a brush ring."};
  node_fringe_skirt_9.add(socket_fringe_skirt_brush_ring_0);
  sockets["fringe-skirt:brush-ring"] = socket_fringe_skirt_brush_ring_0;

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 1024, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "ranAnyway": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "measuredConfidence": {"shell-cream": 0.83, "deck-mint": 0.85, "bumper-navy": 0.8, "button-coral": 0.82, "fringe-grey": 0.71}, "acceptedLimitation": "usable is false on purpose. referenceMapUrl() resolves these maps by absolute disk path, which cannot load in a browser, so binding them would break the runtime asset. The reference is also a soft studio render of flat matte plastic with no surface pattern, so the crops carry baked lighting rather than albedo; tiling them would paint the reference's own shading onto every facet. The runtime instead builds independent procedural canvas maps and the extracted palettes and roughness estimates are used as evidence for the scalars below."}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo reused as roughness, normal or AO"]}, "lightingPass": {"keyFillRim": [{"role": "key", "type": "directional", "intensity": 1.15, "direction": [-0.45, 0.78, 0.44], "color": "#fff6ea", "notes": "Broad soft key from upper front left; the deck's gradient brightens toward it."}, {"role": "fill", "type": "hemisphere", "intensity": 2.9, "color": "#f4f2ef", "groundColor": "#cfcac4", "notes": "Dominant ambient term; the reference has almost no fully dark side."}, {"role": "rim", "type": "directional", "intensity": 0.3, "direction": [0.7, 0.3, -0.62], "color": "#ffffff", "notes": "Separates the rear of the rim from the backdrop."}], "exposure": 1.0, "toneMapping": "ACESFilmic", "contactShadow": "soft ground shadow under the fringe; the object never touches a hard shadow edge"}};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createRobotMopLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Robot Mop look-dev lights";
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
  lights.userData.lightingFromPhoto = [{"observation": "The deck is evenly lit with a gentle gradient brightening toward the upper left.", "inference": "A large soft key from the upper front left, close to the camera axis in azimuth."}, {"observation": "The right side of the navy band is only slightly darker than the left.", "inference": "A dominant ambient or hemisphere term; the key-to-fill ratio is low."}, {"observation": "No specular hotspot on any surface, including the convex rim.", "inference": "Every material is rough dielectric; no clearcoat and no metal anywhere."}, {"observation": "Soft occlusion under the rim overhang and inside the bumper gaps.", "inference": "Contact occlusion rather than a cast shadow; there is no hard shadow edge on the object."}, {"observation": "A soft contact shadow sits under the fringe against a flat grey backdrop.", "inference": "The object rests on a diffuse surface lit by the same broad source."}, {"observation": "Nothing in the reference clips to pure white and nothing crushes to black; the whole image sits in a narrow mid band.", "inference": "Exposure 1.0 with ACES filmic tone mapping reproduces that range without blowing the cream rim."}];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 1024, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "ranAnyway": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "measuredConfidence": {"shell-cream": 0.83, "deck-mint": 0.85, "bumper-navy": 0.8, "button-coral": 0.82, "fringe-grey": 0.71}, "acceptedLimitation": "usable is false on purpose. referenceMapUrl() resolves these maps by absolute disk path, which cannot load in a browser, so binding them would break the runtime asset. The reference is also a soft studio render of flat matte plastic with no surface pattern, so the crops carry baked lighting rather than albedo; tiling them would paint the reference's own shading onto every facet. The runtime instead builds independent procedural canvas maps and the extracted palettes and roughness estimates are used as evidence for the scalars below."}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo reused as roughness, normal or AO"]}, "lightingPass": {"keyFillRim": [{"role": "key", "type": "directional", "intensity": 1.15, "direction": [-0.45, 0.78, 0.44], "color": "#fff6ea", "notes": "Broad soft key from upper front left; the deck's gradient brightens toward it."}, {"role": "fill", "type": "hemisphere", "intensity": 2.9, "color": "#f4f2ef", "groundColor": "#cfcac4", "notes": "Dominant ambient term; the reference has almost no fully dark side."}, {"role": "rim", "type": "directional", "intensity": 0.3, "direction": [0.7, 0.3, -0.62], "color": "#ffffff", "notes": "Separates the rear of the rim from the backdrop."}], "exposure": 1.0, "toneMapping": "ACESFilmic", "contactShadow": "soft ground shadow under the fringe; the object never touches a hard shadow edge"}};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createRobotMopEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
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
export function frameRobotMopCamera(
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
export function createRobotMopPresentationComposer(
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

export function configureRobotMopRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createRobotMopInspectControls(
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
