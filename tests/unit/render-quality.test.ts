import { describe, expect, it } from "vitest";
import {
  FOG_DENSITY,
  FOG_RADIANCE,
  SKY_RADIANCE,
  TONE_EXPOSURE,
  acesFilmic,
  contrastRatio,
  displayColor,
  fromHex,
  glslVec3,
  relativeLuminance,
  toHex,
  type Rgb,
} from "@/components/game/render/tone";

/**
 * The sky dome, the fog and the deck-edge legibility budget are all one system:
 * the dome is the backdrop every platform is silhouetted against, and the fog
 * is what the far end of the course fades into. Picking any of those colours by
 * eye is how the dome ended up bypassing ACES and landing on a near-white
 * horizon that lit decks could not separate from.
 *
 * These are the display colours measured off the GPU with readPixels at the
 * spawn camera pose, so the ratios below are the ones a player sees rather than
 * palette hexes compared in the abstract.
 */
const MEASURED = {
  /** Lit cream deck, near platform. */
  deck: "#e0d9c0",
  /** Darkest pixel of the ink edge band along a near deck edge. */
  inkEdge: "#07070a",
  /** Same band about 20u down the course, through the fog. */
  inkEdgeFar: "#0d0f15",
} as const;

const display = (hex: string): Rgb => fromHex(hex);

describe("tone transfer", () => {
  it("matches three's ACES output for a mid grey", () => {
    // three scales by exposure/0.6 before the fit, so 0.6/exposure is the
    // radiance that enters RRTAndODTFit at 1.0.
    const mapped = acesFilmic([0.18, 0.18, 0.18]);
    expect(mapped[0]).toBeGreaterThan(0.1);
    expect(mapped[0]).toBeLessThan(0.25);
    expect(mapped[0]).toBeCloseTo(mapped[1], 5);
  });

  it("round-trips a hex through parse and format", () => {
    expect(toHex(fromHex("#8ec2e2"))).toBe("#8ec2e2");
  });

  it("darkens as exposure falls", () => {
    const bright = relativeLuminance(displayColor(SKY_RADIANCE.horizon, TONE_EXPOSURE));
    const dim = relativeLuminance(displayColor(SKY_RADIANCE.horizon, TONE_EXPOSURE * 0.5));
    expect(dim).toBeLessThan(bright);
  });

  it("reports the WCAG ratio for a known pair", () => {
    expect(contrastRatio(fromHex("#000000"), fromHex("#ffffff"))).toBeCloseTo(21, 1);
  });
});

describe("sky dome radiance", () => {
  const rendered = {
    deep: toHex(displayColor(SKY_RADIANCE.deep)),
    horizon: toHex(displayColor(SKY_RADIANCE.horizon)),
    zenith: toHex(displayColor(SKY_RADIANCE.zenith)),
  };

  it("renders the stops the constants claim to render", () => {
    // Verified against the GPU: readPixels on the horizon band returned #8dc1e2
    // against this prediction of #8ec2e2, one step of 255 on one channel.
    expect(rendered).toEqual({ deep: "#6fa8ce", horizon: "#8ec2e2", zenith: "#3a87c9" });
  });

  it("keeps the void darker than a lit deck so platforms read as solid", () => {
    // The dome used to bypass tone mapping and land on #c7ebff, brighter than
    // any lit surface in the game: deck against void was 1.13:1, which is why
    // the edge band had to carry the whole silhouette.
    const deckLuminance = relativeLuminance(display(MEASURED.deck));
    expect(relativeLuminance(display(rendered.deep))).toBeLessThan(deckLuminance);
    expect(relativeLuminance(display(rendered.horizon))).toBeLessThan(deckLuminance);
    expect(contrastRatio(display(MEASURED.deck), display(rendered.deep))).toBeGreaterThan(1.4);
  });

  it("keeps the deck edge band legible against the void", () => {
    // Deepening the dome trades ink-against-sky for deck-against-sky. The band
    // has to stay well clear of the 4.5:1 floor at both the near edge and after
    // the fog has had 20u to work on it.
    expect(contrastRatio(display(MEASURED.inkEdge), display(rendered.deep))).toBeGreaterThan(7);
    expect(contrastRatio(display(MEASURED.inkEdgeFar), display(rendered.horizon))).toBeGreaterThan(7);
  });

  it("keeps the band itself as strong as it was against its own deck", () => {
    // The band's job is the deck edge, and that ratio must not move: 14.41:1
    // before any of this, 14.23:1 measured after.
    expect(contrastRatio(display(MEASURED.deck), display(MEASURED.inkEdge))).toBeGreaterThan(13.5);
  });

  it("gets brighter towards the horizon and deeper overhead", () => {
    const luminance = (hex: string) => relativeLuminance(display(hex));
    expect(luminance(rendered.horizon)).toBeGreaterThan(luminance(rendered.deep));
    expect(luminance(rendered.deep)).toBeGreaterThan(luminance(rendered.zenith));
  });
});

describe("distance haze", () => {
  it("fogs into the horizon stop rather than a separate colour", () => {
    expect(FOG_RADIANCE).toEqual(SKY_RADIANCE.horizon);
  });

  it("is weak up close and readable at the end of a standard course", () => {
    // fogExp2: 1 - exp(-(density * distance)^2).
    const fogged = (distance: number) => 1 - Math.exp(-((FOG_DENSITY * distance) ** 2));
    expect(fogged(8)).toBeLessThan(0.01);
    expect(fogged(41)).toBeGreaterThan(0.15);
    expect(fogged(41)).toBeLessThan(0.3);
  });
});

describe("shader constant emission", () => {
  it("emits radiance the GLSL compiler will accept", () => {
    expect(glslVec3(SKY_RADIANCE.deep)).toBe("vec3(0.10070,0.29230,0.57580)");
  });
});
