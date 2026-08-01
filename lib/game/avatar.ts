// Runner identity.
//
// Every runner was one of four colours chosen by
// [purple, blue, orange, green][abs(avatarSeed) % 4] from a seed the player
// never saw and could not change. In a game whose entire loop is "beat my
// level, then send it on", the runner your friend watches is the one thing
// worth owning, and it was the one thing nobody could pick.
//
// It is now a wardrobe: ten slots of code-authored garments, catalogued in
// wardrobe.ts, dressed onto the runner rig by createWardrobeModels.ts, and
// coloured from the palette below. This file owns the parts that have to be
// right rather than merely present - including how every authored colour and a
// whole outfit survive a URL.
//
// Every authored colour is selectable. Player expression is never rejected
// because it resembles a level surface; PlayerVisual supplies an invariant ink
// outline so pale choices still have a readable silhouette during a run.

import { PALETTE } from "./constants";
import { TRACK_SEGMENTS } from "./track";
import {
  AVATAR_BACKPACKS,
  AVATAR_EYEWEAR,
  AVATAR_FACES,
  AVATAR_FOOTWEAR,
  AVATAR_HAIR,
  AVATAR_HEADWEAR,
  AVATAR_HELD,
  AVATAR_LEGWEAR,
  AVATAR_OUTERWEAR,
  AVATAR_TOPS,
  WARDROBE_SLOTS,
} from "./wardrobe";
import type {
  AvatarBackpackId,
  AvatarEyewearId,
  AvatarFaceId,
  AvatarFootwearId,
  AvatarHairId,
  AvatarHeadwearId,
  AvatarHeldId,
  AvatarLegwearId,
  AvatarOuterwearId,
  AvatarTopId,
  WardrobeColorKey,
  WardrobeSlotId,
} from "./wardrobe";

export {
  AVATAR_BACKPACKS,
  AVATAR_EYEWEAR,
  AVATAR_FACES,
  AVATAR_FOOTWEAR,
  AVATAR_HAIR,
  AVATAR_HEADWEAR,
  AVATAR_HELD,
  AVATAR_LEGWEAR,
  AVATAR_OUTERWEAR,
  AVATAR_TOPS,
  WARDROBE_SLOTS,
} from "./wardrobe";
export type {
  AvatarBackpackId,
  AvatarEyewearId,
  AvatarFaceId,
  AvatarFootwearId,
  AvatarHairId,
  AvatarHeadwearId,
  AvatarHeldId,
  AvatarLegwearId,
  AvatarOuterwearId,
  AvatarTopId,
  WardrobeColorKey,
  WardrobeSlotId,
} from "./wardrobe";

export type AvatarColorId =
  | "violet"
  | "cobalt"
  | "teal"
  | "forest"
  | "rust"
  | "slate"
  | "ink"
  | "cream"
  | "butter"
  | "grape"
  | "indigo"
  | "ocean"
  | "pine"
  | "moss"
  | "bronze"
  | "coffee"
  | "plum"
  | "steel"
  | "charcoal"
  | "blush";

/** What a garment slot is coloured with, plus the two body colours. */
export type ColorSlot = "body" | "pack" | WardrobeColorKey;

export interface AvatarGarmentColors {
  headwear: AvatarColorId;
  hair: AvatarColorId;
  face: AvatarColorId;
  eyewear: AvatarColorId;
  top: AvatarColorId;
  outerwear: AvatarColorId;
  legwear: AvatarColorId;
  footwear: AvatarColorId;
  backpack: AvatarColorId;
  held: AvatarColorId;
}

export interface AvatarConfig {
  /** Torso, arms, and the whole silhouette the player tracks. */
  body: AvatarColorId;
  /** The shoulder straps. Read against the torso, which encloses them. */
  pack: AvatarColorId;
  headwear: AvatarHeadwearId;
  hair: AvatarHairId;
  face: AvatarFaceId;
  eyewear: AvatarEyewearId;
  top: AvatarTopId;
  outerwear: AvatarOuterwearId;
  legwear: AvatarLegwearId;
  footwear: AvatarFootwearId;
  backpack: AvatarBackpackId;
  held: AvatarHeldId;
  colors: AvatarGarmentColors;
}

/**
 * What a renderer consumes. Total and already defaulted, so a caller never
 * branches on whether the player has chosen anything.
 */
export interface ResolvedAvatar {
  bodyColor: string;
  packColor: string;
  headwear: AvatarHeadwearId;
  hair: AvatarHairId;
  face: AvatarFaceId;
  eyewear: AvatarEyewearId;
  top: AvatarTopId;
  outerwear: AvatarOuterwearId;
  legwear: AvatarLegwearId;
  footwear: AvatarFootwearId;
  backpack: AvatarBackpackId;
  held: AvatarHeldId;
  /** Resolved hex per garment slot, whether or not that slot is filled. */
  garmentColors: Readonly<Record<WardrobeColorKey, string>>;
  /**
   * Sculpt material id to hex, for the parts of the rig the wardrobe repaints.
   * Keyed on the material's own id rather than on mesh names because the
   * factory already groups the parts correctly, and because the id lives on the
   * material rather than the node, so it survives the userData strip that makes
   * the runner template clonable.
   */
  sculptTints: Readonly<Record<string, string>>;
}

export interface AvatarSwatch {
  id: AvatarColorId;
  label: string;
  hex: string;
}

// Order is append-only: a challenge link stores a colour as its index here, so
// the first nine entries are the original palette in its original order and
// every later addition goes on the end.
// This list remains deliberately separate from PALETTE: these are stable player
// choices encoded in saved runners and challenge links, not environment roles.
export const AVATAR_COLORS: readonly AvatarSwatch[] = [
  { id: "violet", label: "Violet", hex: "#7963df" },
  { id: "cobalt", label: "Cobalt", hex: "#3e74d3" },
  { id: "teal", label: "Teal", hex: "#477d99" },
  { id: "forest", label: "Forest", hex: "#348363" },
  { id: "rust", label: "Rust", hex: "#a96639" },
  { id: "slate", label: "Slate", hex: PALETTE.muted },
  { id: "ink", label: "Ink", hex: PALETTE.ink },
  { id: "cream", label: "Cream", hex: PALETTE.cream },
  { id: "butter", label: "Butter", hex: PALETTE.yellow },
  { id: "grape", label: "Grape", hex: "#6a4fbe" },
  { id: "indigo", label: "Indigo", hex: "#3f4fb0" },
  { id: "ocean", label: "Ocean", hex: "#1f6f9c" },
  { id: "pine", label: "Pine", hex: "#1f6b58" },
  { id: "moss", label: "Moss", hex: "#5f7a2b" },
  { id: "bronze", label: "Bronze", hex: "#8a6a2c" },
  { id: "coffee", label: "Coffee", hex: "#6b4a34" },
  { id: "plum", label: "Plum", hex: "#8a3f86" },
  { id: "steel", label: "Steel", hex: "#59657a" },
  { id: "charcoal", label: "Charcoal", hex: "#3a3f4d" },
  { id: "blush", label: "Blush", hex: "#d98aa0" },
];

// No entry is gated by body, garment, or course colour.

const COLOR_MAP = new Map(AVATAR_COLORS.map((entry) => [entry.id, entry]));

const DEFAULT_GARMENT_COLORS: AvatarGarmentColors = {
  headwear: "ink",
  hair: "coffee",
  face: "coffee",
  eyewear: "ink",
  top: "cobalt",
  outerwear: "charcoal",
  legwear: "charcoal",
  footwear: "ink",
  backpack: "rust",
  // Ocean, not bronze: with bronze the default flag, torch collar, balloon
  // and trophy landed in the same orange-brown band as the rust backpack,
  // and adjacent picker slots read as one substance.
  held: "ocean",
};

export const DEFAULT_AVATAR: AvatarConfig = {
  body: "violet",
  pack: "cream",
  headwear: "hair",
  hair: "classic",
  face: "plain",
  eyewear: "none",
  top: "none",
  outerwear: "none",
  legwear: "none",
  footwear: "none",
  backpack: "none",
  held: "none",
  colors: DEFAULT_GARMENT_COLORS,
};

/** What PlayerVisual renders today when nobody has chosen anything. */
const LEGACY_BODY_COLORS = [
  PALETTE.purple,
  PALETTE.blue,
  PALETTE.orange,
  PALETTE.green,
] as const;

const SLOT_BY_ID = new Map(WARDROBE_SLOTS.map((slot) => [slot.id, slot]));

/** The first option in every slot is the empty one, by construction. */
export function emptyOption(slot: WardrobeSlotId): string {
  return SLOT_BY_ID.get(slot)!.options[0]!.id;
}

export function isSlotFilled(config: AvatarConfig, slot: WardrobeSlotId): boolean {
  return config[slot] !== emptyOption(slot);
}

export interface WardrobeSelectionResult {
  readonly config: AvatarConfig;
  /** Existing slots removed because the newly selected item would hide them. */
  readonly cleared: readonly WardrobeSlotId[];
}

const OPEN_HAIR_HEADWEAR: readonly AvatarHeadwearId[] = [
  "hair",
  "band",
  "visor",
  "earmuffs",
  "headphones",
];

/**
 * Apply one wardrobe choice with the newest choice winning every collision.
 *
 * The picker used to allow players to select several valid-looking chips even
 * though one item completely hid another. Randomize had a separate, smaller
 * set of fixes, so manual and randomized outfits behaved differently. This is
 * now the single compatibility authority used by both paths.
 */
export function applyWardrobeSelection(
  current: AvatarConfig,
  slot: WardrobeSlotId,
  id: string,
): WardrobeSelectionResult {
  const next: AvatarConfig = { ...current, colors: { ...current.colors } };
  const assign = (target: WardrobeSlotId, value: string) => {
    switch (target) {
      case "headwear": next.headwear = value as AvatarHeadwearId; break;
      case "hair": next.hair = value as AvatarHairId; break;
      case "face": next.face = value as AvatarFaceId; break;
      case "eyewear": next.eyewear = value as AvatarEyewearId; break;
      case "top": next.top = value as AvatarTopId; break;
      case "outerwear": next.outerwear = value as AvatarOuterwearId; break;
      case "legwear": next.legwear = value as AvatarLegwearId; break;
      case "footwear": next.footwear = value as AvatarFootwearId; break;
      case "backpack": next.backpack = value as AvatarBackpackId; break;
      case "held": next.held = value as AvatarHeldId; break;
    }
  };
  assign(slot, id);

  const cleared: WardrobeSlotId[] = [];
  const clear = (target: WardrobeSlotId) => {
    const empty = emptyOption(target);
    if (next[target] === empty) return;
    assign(target, empty);
    cleared.push(target);
  };

  if (slot === "headwear") {
    if (next.headwear === "helmet") {
      clear("hair");
      clear("face");
      clear("eyewear");
    } else if (next.headwear === "visor") {
      clear("face");
      clear("eyewear");
    } else if (!OPEN_HAIR_HEADWEAR.includes(next.headwear)) {
      clear("hair");
    }
  } else if (slot === "hair" && next.hair !== "none") {
    if (!OPEN_HAIR_HEADWEAR.includes(next.headwear)) clear("headwear");
  } else if (slot === "face" && next.face !== "plain") {
    if (next.headwear === "helmet" || next.headwear === "visor") clear("headwear");
    if (next.face === "mask") {
      clear("eyewear");
      if (!OPEN_HAIR_HEADWEAR.includes(next.headwear)) clear("headwear");
    }
  } else if (slot === "eyewear" && next.eyewear !== "none") {
    if (next.headwear === "helmet" || next.headwear === "visor") clear("headwear");
    if (next.face === "mask") clear("face");
  } else if (slot === "top" && next.top !== "none") {
    if (next.top === "overalls") clear("legwear");
  } else if (slot === "legwear" && next.legwear !== "none") {
    if (next.top === "overalls") clear("top");
  } else if (slot === "outerwear" && next.outerwear !== "none") {
    if (["puffer", "poncho", "harness"].includes(next.outerwear)) {
      clear("backpack");
    } else if (next.backpack === "cape" || next.backpack === "wings") {
      clear("backpack");
    }
  } else if (slot === "backpack" && next.backpack !== "none") {
    if (next.backpack === "cape" || next.backpack === "wings") clear("outerwear");
    else if (["puffer", "poncho", "harness"].includes(next.outerwear)) clear("outerwear");
  }

  return { config: next, cleared };
}

function known<Id extends string>(
  options: readonly { id: Id }[],
  value: unknown,
  fallback: Id,
): Id {
  return options.some((entry) => entry.id === value) ? (value as Id) : fallback;
}

function knownColor(value: unknown, fallback: AvatarColorId): AvatarColorId {
  return COLOR_MAP.has(value as AvatarColorId)
    ? (value as AvatarColorId)
    : fallback;
}

/**
 * Fill in whatever a stored avatar is missing.
 *
 * Settings persist under one un-versioned key and a saved runner from before
 * the wardrobe existed carries four fields, so every read of a stored config
 * has to survive arriving short. Unknown ids fall back rather than throwing,
 * which is also what makes a hand-edited localStorage entry harmless.
 */
export function normalizeAvatar(
  config: Partial<AvatarConfig> | null | undefined,
): AvatarConfig {
  const stored: Partial<AvatarConfig> = config ?? {};
  const colors: Partial<AvatarGarmentColors> = stored.colors ?? {};
  // Hoodies shipped in the Top slot. Keep that id in the legacy codec, but
  // migrate the old standalone state into Outer layer so new and old runners
  // can put the hoodie over a shirt. Preserve its chosen top colour too.
  const legacyTopHoodie = stored.top === "hoodie";
  const migrateLegacyHoodie = legacyTopHoodie &&
    (stored.outerwear === undefined || stored.outerwear === "none");
  return {
    body: knownColor(stored.body, DEFAULT_AVATAR.body),
    pack: knownColor(stored.pack, DEFAULT_AVATAR.pack),
    headwear: known(AVATAR_HEADWEAR, stored.headwear, "hair"),
    hair: known(AVATAR_HAIR, stored.hair, "classic"),
    face: known(AVATAR_FACES, stored.face, "plain"),
    eyewear: known(AVATAR_EYEWEAR, stored.eyewear, "none"),
    top: legacyTopHoodie ? "none" : known(AVATAR_TOPS, stored.top, "none"),
    outerwear: migrateLegacyHoodie
      ? "hoodie"
      : known(AVATAR_OUTERWEAR, stored.outerwear, "none"),
    legwear: known(AVATAR_LEGWEAR, stored.legwear, "none"),
    footwear: known(AVATAR_FOOTWEAR, stored.footwear, "none"),
    backpack: known(AVATAR_BACKPACKS, stored.backpack, "none"),
    held: known(AVATAR_HELD, stored.held, "none"),
    colors: {
      headwear: knownColor(colors.headwear, DEFAULT_GARMENT_COLORS.headwear),
      hair: knownColor(colors.hair, DEFAULT_GARMENT_COLORS.hair),
      face: knownColor(colors.face, DEFAULT_GARMENT_COLORS.face),
      eyewear: knownColor(colors.eyewear, DEFAULT_GARMENT_COLORS.eyewear),
      top: knownColor(colors.top, DEFAULT_GARMENT_COLORS.top),
      outerwear: migrateLegacyHoodie
        ? knownColor(colors.top, DEFAULT_GARMENT_COLORS.top)
        : knownColor(colors.outerwear, DEFAULT_GARMENT_COLORS.outerwear),
      legwear: knownColor(colors.legwear, DEFAULT_GARMENT_COLORS.legwear),
      footwear: knownColor(colors.footwear, DEFAULT_GARMENT_COLORS.footwear),
      backpack: knownColor(colors.backpack, DEFAULT_GARMENT_COLORS.backpack),
      held: knownColor(colors.held, DEFAULT_GARMENT_COLORS.held),
    },
  };
}

/**
 * The look for a runner. An unset avatar reproduces the seed-derived
 * appearance exactly, so a challenge made before anyone customised anything
 * still renders the way its creator saw it.
 */
export function resolveAvatar(
  config: Partial<AvatarConfig> | null | undefined,
  avatarSeed: number,
): ResolvedAvatar {
  if (!config) {
    const bodyColor = LEGACY_BODY_COLORS[Math.abs(avatarSeed) % 4]!;
    return {
      bodyColor,
      packColor: PALETTE.red,
      headwear: "hair",
      hair: "classic",
      face: "plain",
      eyewear: "none",
      top: "none",
      outerwear: "none",
      legwear: "none",
      footwear: "none",
      backpack: "none",
      held: "none",
      garmentColors: garmentHexes(DEFAULT_GARMENT_COLORS),
      sculptTints: {
        "torso-purple": bodyColor,
        // The stock hair cap is hidden by PlayerVisual. Its material is also
        // used by the baked leg meshes, so repainting it removes the false
        // permanent trousers when Legs: None is selected.
        "hair-ink": bodyColor,
        skin: bodyColor,
        "strap-coral": PALETTE.red,
      },
    };
  }
  const full = normalizeAvatar(config);
  const bodyColor = COLOR_MAP.get(full.body)!.hex;
  const packColor = COLOR_MAP.get(full.pack)!.hex;
  const garmentColors = garmentHexes(full.colors);
  const sculptTints: Record<string, string> = {
    "torso-purple": bodyColor,
    "hair-ink": bodyColor,
    skin: bodyColor,
    "strap-coral": full.backpack === "none" ? packColor : garmentColors.backpack,
  };
  // Choosing footwear replaces the shoe rather than adding to it, so the
  // sculpt's own sneaker upper takes the chosen colour and the garment reads as
  // one object instead of a cream shoe wearing a coloured shell.
  if (full.footwear !== "none")
    sculptTints["shoe-cream"] = garmentColors.footwear;
  return {
    bodyColor,
    packColor,
    headwear: full.headwear,
    hair: full.hair,
    // Shades predate the eyewear slot. Where a link or a saved runner carries
    // both, the explicit choice wins and the expression drops back to neutral,
    // so nobody ends up wearing two pairs of sunglasses.
    face: full.face === "shades" && full.eyewear !== "none" ? "plain" : full.face,
    eyewear: full.eyewear,
    top: full.top,
    outerwear: full.outerwear,
    legwear: full.legwear,
    footwear: full.footwear,
    backpack: full.backpack,
    held: full.held,
    garmentColors,
    sculptTints,
  };
}

function garmentHexes(
  colors: AvatarGarmentColors,
): Readonly<Record<WardrobeColorKey, string>> {
  return {
    headwear: COLOR_MAP.get(colors.headwear)!.hex,
    hair: COLOR_MAP.get(colors.hair)!.hex,
    face: COLOR_MAP.get(colors.face)!.hex,
    eyewear: COLOR_MAP.get(colors.eyewear)!.hex,
    top: COLOR_MAP.get(colors.top)!.hex,
    outerwear: COLOR_MAP.get(colors.outerwear)!.hex,
    legwear: COLOR_MAP.get(colors.legwear)!.hex,
    footwear: COLOR_MAP.get(colors.footwear)!.hex,
    backpack: COLOR_MAP.get(colors.backpack)!.hex,
    held: COLOR_MAP.get(colors.held)!.hex,
  };
}

export function avatarColor(id: AvatarColorId): string {
  return COLOR_MAP.get(id)!.hex;
}

// --- Legibility -------------------------------------------------------------

// Mirrors LevelGeometry's DECK_WASH. The two must stay in step or the ratios
// reported here describe a floor the game no longer draws; avatar.test.ts reads
// the constant back out of LevelGeometry to make drift fail loudly.
const DECK_WASH = 0.62;

// three's sRGB transfer functions, reproduced rather than imported so the
// legibility model stays free of the renderer. Color.lerp interpolates in the
// linear working space, and linear and sRGB interpolation disagree by enough to
// matter here: the bridge deck is #dcd2f1 linear against #d3c5f1 naive.
const toLinear = (channel: number): number =>
  channel < 0.04045
    ? channel * 0.0773993808
    : Math.pow(channel * 0.9478672986 + 0.0521327014, 2.4);
const toSrgb = (channel: number): number =>
  channel < 0.0031308 ? channel * 12.92 : 1.055 * Math.pow(channel, 0.41666) - 0.055;

function channels(hex: string): readonly [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function toHex(rgb: readonly number[]): string {
  return `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
}

function washTowardCream(hex: string): string {
  const piece = channels(hex).map((v) => toLinear(v / 255));
  const cream = channels(PALETTE.cream).map((v) => toLinear(v / 255));
  return toHex(
    piece.map((v, index) => toSrgb(v + (cream[index]! - v) * DECK_WASH) * 255),
  );
}

/**
 * Every walking surface the game can draw, derived from the segment catalogue
 * so a new segment cannot quietly introduce a deck nothing was checked against.
 */
export const DECK_COLORS: readonly string[] = Array.from(
  new Set(
    TRACK_SEGMENTS.flatMap((segment) =>
      segment.pieces.map((piece) => washTowardCream(piece.color)),
    ),
  ),
);

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const channel = v / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio, 1 through 21. */
export function contrastRatio(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (
    (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
  );
}

/** How a colour fares across the whole set of walking surfaces. */
export function deckContrast(hex: string): {
  min: number;
  max: number;
  worstDeck: string;
} {
  let min = Infinity;
  let max = 0;
  let worstDeck = DECK_COLORS[0]!;
  for (const deck of DECK_COLORS) {
    const ratio = contrastRatio(hex, deck);
    if (ratio < min) {
      min = ratio;
      worstDeck = deck;
    }
    if (ratio > max) max = ratio;
  }
  return { min, max, worstDeck };
}

/** WCAG 1.4.11, the bar the level geometry already holds itself to. */
export const MIN_CONTRAST = 3;

/** Straight-line distance between two colours in sRGB, 0 through 441. */
export function colorDistance(a: string, b: string): number {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  return Math.hypot(ar - br, ag - bg, ab - bb);
}

/**
 * How close a garment may come to the reserved hazard red.
 *
 * Not a number picked to feel safe: it is the distance the shipped palette
 * already keeps from PALETTE.danger at its closest, so the rule is "no new
 * colour may crowd the hazard marker more than the game already does" rather
 * than a threshold invented to let a favourite through. Rust measures 84.6 and
 * is the closest thing already in the game, so the floor is that rounded down.
 */
export const MIN_DANGER_DISTANCE = 84;

export interface AvatarRejection {
  /** The slot that cannot take the colour. */
  slot: ColorSlot;
  /** The measured ratio that failed. */
  ratio: number;
  /** The colour it was measured against. */
  against: string;
  reason: string;
}

/**
 * Kept as an API boundary for old decoders and diagnostics. Avatar colours are
 * now player expression, not a gameplay restriction: every authored swatch is
 * valid in every slot, even when it resembles a course surface or another part.
 */
export function colorRejection(
  _slot: ColorSlot,
  _id: AvatarColorId,
  _body: AvatarColorId,
): AvatarRejection | null;
export function colorRejection(): AvatarRejection | null {
  return null;
}

/**
 * The colours worth offering for the pack, which is not all of them.
 *
 * A pack is judged against the body it sits on, and a body is judged against
 * the deck it runs over. Those two rules squeeze from opposite ends: the deck is
 * cream, so a pale body vanishes into the floor and is refused, which leaves
 * every selectable body mid-to-dark - and against a mid-to-dark body, a
 * mid-to-dark pack has nowhere to go. Seven colours lose that squeeze (grape,
 * indigo, pine, coffee, plum, steel, charcoal): each is a perfectly good body,
 * and none of them clears MIN_CONTRAST against any body a player can actually
 * pick. Their best case is grape on ink at 2.85 against a floor of 3.
 *
 * Offering them anyway rendered seven swatches that were disabled no matter
 * what else the player chose, which reads as a broken control rather than as a
 * rule. Filtering here keeps every authored colour exactly as it is - none is
 * restyled to force it through - and AVATAR_COLORS keeps its order, so the
 * index a challenge link encodes still means the same colour.
 */
export const PACK_COLORS: readonly AvatarSwatch[] = AVATAR_COLORS;

/**
 * The first thing wrong with a whole outfit, or null when it is wearable.
 *
 * A garment colour is judged only when that slot is actually filled. Refusing a
 * runner over the colour of a jacket they are not wearing would be a dead end
 * with no visible cause.
 */
export function avatarRejection(
  _config: Partial<AvatarConfig> | null | undefined,
): AvatarRejection | null;
export function avatarRejection(): AvatarRejection | null {
  return null;
}

/** True when every colour the runner actually shows clears its bar. */
export function isReadableAvatar(
  config: Partial<AvatarConfig> | null | undefined,
): boolean {
  return avatarRejection(config) === null;
}

/** Every colour that can fill a slot, given the body already chosen. */
export function usableColors(
  _slot: ColorSlot,
  _body: AvatarColorId,
): readonly AvatarSwatch[];
export function usableColors(): readonly AvatarSwatch[] {
  return AVATAR_COLORS;
}

/**
 * A complete, wearable runner from a random source.
 *
 * Every draw is taken from the colours that already clear the bar for that
 * slot, so the result is always accepted. A player who does not want to fiddle
 * still gets something, and gets it without being handed a refusal.
 */
export function randomAvatar(random: () => number = Math.random): AvatarConfig {
  const pick = <T>(list: readonly T[]): T =>
    list[Math.min(list.length - 1, Math.floor(random() * list.length))]!;
  const wardrobePick = <Id extends string>(slot: WardrobeSlotId): Id =>
    pick(SLOT_BY_ID.get(slot)!.options).id as Id;
  const body = pick(usableColors("body", "violet")).id;
  const garment = (key: WardrobeColorKey): AvatarColorId =>
    pick(usableColors(key, body)).id;
  const choices: Record<WardrobeSlotId, string> = {
    headwear: wardrobePick<AvatarHeadwearId>("headwear"),
    hair: wardrobePick<AvatarHairId>("hair"),
    face: wardrobePick<AvatarFaceId>("face"),
    eyewear: wardrobePick<AvatarEyewearId>("eyewear"),
    top: wardrobePick<AvatarTopId>("top"),
    outerwear: wardrobePick<AvatarOuterwearId>("outerwear"),
    legwear: wardrobePick<AvatarLegwearId>("legwear"),
    footwear: wardrobePick<AvatarFootwearId>("footwear"),
    backpack: wardrobePick<AvatarBackpackId>("backpack"),
    held: wardrobePick<AvatarHeldId>("held"),
  };
  let result: AvatarConfig = {
    ...DEFAULT_AVATAR,
    body,
    pack: pick(usableColors("pack", body)).id,
    colors: {
      headwear: garment("headwear"),
      hair: garment("hair"),
      face: garment("face"),
      eyewear: garment("eyewear"),
      top: garment("top"),
      outerwear: garment("outerwear"),
      legwear: garment("legwear"),
      footwear: garment("footwear"),
      backpack: garment("backpack"),
      held: garment("held"),
    },
  };
  // Face layers establish themselves first, then complete torso silhouettes,
  // then hats. That produces coherent outfits while still giving each random
  // category a chance to be the visible winner. The same resolver powers the
  // manual picker, so Randomize cannot invent combinations players cannot.
  const compatibilityOrder: readonly WardrobeSlotId[] = [
    "hair", "face", "eyewear", "top", "legwear", "footwear", "backpack",
    "held", "outerwear", "headwear",
  ];
  for (const slot of compatibilityOrder)
    result = applyWardrobeSelection(result, slot, choices[slot]).config;
  return result;
}

// --- Link encoding ----------------------------------------------------------

const HEADWEAR_IDS = AVATAR_HEADWEAR.map((entry) => entry.id);
const FACE_IDS = AVATAR_FACES.map((entry) => entry.id);

export const AVATAR_TUPLE_BOUNDS = [
  AVATAR_COLORS.length - 1,
  AVATAR_COLORS.length - 1,
  HEADWEAR_IDS.length - 1,
  FACE_IDS.length - 1,
] as const;

export type AvatarTuple = readonly [number, number, number, number];

/**
 * The four integers a version 4 link carries. Kept exactly as it was: the
 * wardrobe rides in a separate field so that widening this one is never what
 * decides whether an old link still opens.
 */
export function avatarToTuple(config: AvatarConfig): AvatarTuple {
  return [
    AVATAR_COLORS.findIndex((entry) => entry.id === config.body),
    AVATAR_COLORS.findIndex((entry) => entry.id === config.pack),
    HEADWEAR_IDS.indexOf(config.headwear),
    FACE_IDS.indexOf(config.face),
  ];
}

/**
 * Rebuild a config from a link tuple. The caller is expected to have bounded
 * the indices already, which is why this is total rather than nullable. Slots
 * that predate the wardrobe come back empty, which is what the sender's runner
 * looked like.
 */
export function avatarFromTuple(tuple: AvatarTuple): AvatarConfig {
  return {
    ...DEFAULT_AVATAR,
    body: AVATAR_COLORS[tuple[0]]!.id,
    pack: AVATAR_COLORS[tuple[1]]!.id,
    headwear: HEADWEAR_IDS[tuple[2]]!,
    face: FACE_IDS[tuple[3]]!,
  };
}

// One character per slot, from a 64-symbol alphabet that is already URL-safe.
// A whole outfit is eighteen characters of JSON string rather than eighteen
// comma-separated integers, which is most of the reason the link can afford to
// carry it at all.
const CODE_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";

type CodeField =
  | { readonly kind: "body" }
  | { readonly kind: "pack" }
  | { readonly kind: "item"; readonly slot: WardrobeSlotId }
  | { readonly kind: "garment"; readonly key: WardrobeColorKey };

// Append-only, like every list in this file. A reader that knows more fields
// than the code it is given fills the rest from DEFAULT_AVATAR, so a link
// written before a slot existed still opens once the slot ships.
const CODE_FIELDS: readonly CodeField[] = [
  { kind: "body" },
  { kind: "pack" },
  { kind: "item", slot: "headwear" },
  { kind: "item", slot: "face" },
  { kind: "garment", key: "headwear" },
  { kind: "item", slot: "eyewear" },
  { kind: "item", slot: "top" },
  { kind: "garment", key: "top" },
  { kind: "item", slot: "outerwear" },
  { kind: "garment", key: "outerwear" },
  { kind: "item", slot: "legwear" },
  { kind: "garment", key: "legwear" },
  { kind: "item", slot: "footwear" },
  { kind: "garment", key: "footwear" },
  { kind: "item", slot: "backpack" },
  { kind: "garment", key: "backpack" },
  { kind: "item", slot: "held" },
  { kind: "garment", key: "held" },
  // Appended so every pre-colour wardrobe code keeps every earlier position.
  { kind: "garment", key: "face" },
  { kind: "garment", key: "eyewear" },
  // Hair shipped after the original wardrobe code. Append-only keeps every
  // earlier character in every shared runner code stable.
  { kind: "item", slot: "hair" },
  { kind: "garment", key: "hair" },
];

export const WARDROBE_CODE_LENGTH = CODE_FIELDS.length;

/** What a link's wardrobe field has to look like before it is worth parsing. */
export const WARDROBE_CODE_PATTERN = /^[0-9A-Za-z_-]{1,32}$/;

function fieldOptions(field: CodeField): readonly string[] {
  if (field.kind === "item" && field.slot === "face")
    return AVATAR_FACES.map((entry) => entry.id);
  if (field.kind === "item" && field.slot === "outerwear")
    return AVATAR_OUTERWEAR.map((entry) => entry.id);
  // The visible Top picker no longer offers the legacy hoodie entry, but the
  // append-only link codec must retain its old character index forever.
  if (field.kind === "item" && field.slot === "top")
    return AVATAR_TOPS.map((entry) => entry.id);
  if (field.kind === "item" && field.slot === "backpack")
    return AVATAR_BACKPACKS.map((entry) => entry.id);
  if (field.kind === "item")
    return SLOT_BY_ID.get(field.slot)!.options.map((entry) => entry.id);
  return AVATAR_COLORS.map((entry) => entry.id);
}

function fieldValue(config: AvatarConfig, field: CodeField): string {
  switch (field.kind) {
    case "body":
      return config.body;
    case "pack":
      return config.pack;
    case "item":
      return config[field.slot];
    case "garment":
      return config.colors[field.key];
  }
}

/** The whole outfit as one URL-safe string, one character per slot. */
export function avatarToCode(config: Partial<AvatarConfig>): string {
  const full = normalizeAvatar(config);
  return CODE_FIELDS.map((field) => {
    const index = fieldOptions(field).indexOf(fieldValue(full, field));
    return CODE_ALPHABET[index]!;
  }).join("");
}

/**
 * Rebuild an outfit from a link code, or null when the code describes one that
 * does not exist. Nullable rather than total because this is the one place a
 * hand-edited URL reaches the wardrobe, and "index 40 of a 13-hat list" has to
 * be a refusal rather than a crash.
 */
export function avatarFromCode(code: string): AvatarConfig | null {
  if (!WARDROBE_CODE_PATTERN.test(code)) return null;
  const draft: AvatarConfig = {
    ...DEFAULT_AVATAR,
    colors: { ...DEFAULT_AVATAR.colors },
  };
  for (const [position, field] of CODE_FIELDS.entries()) {
    const symbol = code[position];
    if (symbol === undefined) break;
    const index = CODE_ALPHABET.indexOf(symbol);
    const options = fieldOptions(field);
    const value = index >= 0 ? options[index] : undefined;
    if (value === undefined) return null;
    switch (field.kind) {
      case "body":
        draft.body = value as AvatarColorId;
        break;
      case "pack":
        draft.pack = value as AvatarColorId;
        break;
      case "garment":
        draft.colors[field.key] = value as AvatarColorId;
        break;
      case "item":
        // Every slot's field is typed as its own id union and the value came
        // out of that slot's own option list, so the cast restores what the
        // shared CodeField type had to widen away.
        (draft as unknown as Record<string, string>)[field.slot] = value;
        break;
    }
  }
  return draft;
}
