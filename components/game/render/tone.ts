/**
 * Scene-referred colour for the renderer.
 *
 * Everything the scene draws is linear radiance that ACES maps to display
 * values, so the numbers a human picks (a sky colour, a fog colour) have to be
 * written as radiance, not as the hex they end up looking like. The functions
 * here mirror three's `tonemapping_pars_fragment` and sRGB transfer exactly, so
 * a constant can be chosen for the colour it *renders as* and that claim can be
 * checked without a GPU.
 */

export type Rgb = readonly [number, number, number];

/** Matches `gl.toneMappingExposure` set in GameCanvas. */
export const TONE_EXPOSURE = 1.08;

const ACES_INPUT: readonly Rgb[] = [
  [0.59719, 0.35458, 0.04823],
  [0.076, 0.90834, 0.01566],
  [0.0284, 0.13383, 0.83777],
];
const ACES_OUTPUT: readonly Rgb[] = [
  [1.60475, -0.53108, -0.07367],
  [-0.10208, 1.10813, -0.00605],
  [-0.00327, -0.07276, 1.07602],
];

function transform(matrix: readonly Rgb[], c: Rgb): Rgb {
  return matrix.map((row) => row[0] * c[0] + row[1] * c[1] + row[2] * c[2]) as unknown as Rgb;
}

function rrtAndOdtFit(c: Rgb): Rgb {
  return c.map((x) => {
    const a = x * (x + 0.0245786) - 0.000090537;
    const b = x * (0.983729 * x + 0.432951) + 0.238081;
    return a / b;
  }) as unknown as Rgb;
}

export function acesFilmic(radiance: Rgb, exposure = TONE_EXPOSURE): Rgb {
  const scaled = radiance.map((x) => (x * exposure) / 0.6) as unknown as Rgb;
  const fitted = rrtAndOdtFit(transform(ACES_INPUT, scaled));
  return transform(ACES_OUTPUT, fitted).map((x) => Math.min(1, Math.max(0, x))) as unknown as Rgb;
}

export const srgbEncode = (c: Rgb): Rgb =>
  c.map((x) => (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055)) as unknown as Rgb;

export const srgbDecode = (c: Rgb): Rgb =>
  c.map((x) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4))) as unknown as Rgb;

/** What a linear radiance actually looks like on screen, 0..1 per channel. */
export const displayColor = (radiance: Rgb, exposure = TONE_EXPOSURE): Rgb =>
  srgbEncode(acesFilmic(radiance, exposure));

export const toHex = (srgb: Rgb): string =>
  "#" + srgb.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, "0")).join("");

export const fromHex = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];

export function relativeLuminance(srgb: Rgb): number {
  const l = srgbDecode(srgb);
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Sky dome stops as linear radiance, chosen so the dome renders as a real blue
 * rather than the near-white it used to be.
 *
 * The old dome wrote display values straight to the framebuffer with no
 * tone-mapping include, so it was the one surface in the game that skipped
 * ACES; its horizon landed on #c7ebff and the void therefore read brighter than
 * the brightest lit deck (relative luminance 0.787 against 0.694). These stops
 * go through the same transform as every other surface and put the void back
 * underneath the decks. `deep` is what a player sees past a platform edge,
 * `horizon` is eye level and the colour distant geometry fogs into, `zenith` is
 * straight up.
 */
export const SKY_RADIANCE = {
  deep: [0.1007, 0.2923, 0.5758] as Rgb, // renders #6fa8ce
  horizon: [0.1318, 0.4381, 0.9441] as Rgb, // renders #8ec2e2
  zenith: [0.0402, 0.1853, 0.5239] as Rgb, // renders #3a87c9
} as const;

/**
 * Distance haze. The old density of 0.0045 left the far end of a 41u course
 * 3% fogged, which is nothing, and its colour was a palette hex that ACES then
 * darkened away from the sky it was meant to blend into. Matching the horizon
 * radiance makes distant geometry recede into the dome instead of into a
 * separate grey.
 */
export const FOG_RADIANCE: Rgb = SKY_RADIANCE.horizon;
export const FOG_DENSITY = 0.011;

export const glslVec3 = (c: Rgb): string => `vec3(${c.map((x) => x.toFixed(5)).join(",")})`;
