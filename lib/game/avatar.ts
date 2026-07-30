// Runner identity.
//
// Every runner was one of four colours chosen by
// [purple, blue, orange, green][abs(avatarSeed) % 4] from a seed the player
// never saw and could not change. In a game whose entire loop is "beat my
// level, then send it on", the runner your friend watches is the one thing
// worth owning, and it was the one thing nobody could pick.
//
// It is now a wardrobe: nine slots of code-authored garments, catalogued in
// wardrobe.ts, dressed onto the runner rig by createWardrobeModels.ts, and
// coloured from the palette below. This file owns the parts that have to be
// right rather than merely present - which colours are legible, which
// combinations are refused, and how a whole outfit survives a URL.
//
// Legibility is measured, not asserted. LevelGeometry paints each platform's
// walking surface as that platform's own colour washed 62% toward cream, so the
// deck is a pale tint of whatever hue the segment uses. A mid-tone runner on a
// pale tint of its own hue is a runner you cannot see, and every one of the four
// legacy colours lands there: green measures 1.16:1 against the palest deck.
// The palette below is the same hues taken deep enough to clear 3:1.

import { PALETTE } from "./constants";
import { TRACK_SEGMENTS } from "./track";
import {
  AVATAR_BACKPACKS,
  AVATAR_EYEWEAR,
  AVATAR_FACES,
  AVATAR_FOOTWEAR,
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

// Deep enough to clear MIN_CONTRAST against every walking surface in the game,
// and still far enough from the ink outline capsule that the figure keeps
// internal form rather than reading as one dark blob.
//
// Order is append-only: a challenge link stores a colour as its index here, so
// the first nine entries are the original palette in its original order and
// every later addition goes on the end.
//
// Deep red is absent by rule rather than by taste. PALETTE.danger marks ground
// a hazard can reach, and a runner wearing it would unteach the one colour in
// the game that means "this hurts". MIN_DANGER_DISTANCE below turns that from
// an intention into something a test can fail on.
//
// This list is deliberately NOT PALETTE, and the difference is not an oversight
// to be tidied away. PALETTE's hues are picked to sit on a level under sky; a
// garment is judged against the pale wash of the floor the runner is standing
// on, which is a stricter bar, and every saturated palette hue fails it:
// blue measures 2.22:1, purple 2.44, red 2.08, orange 1.45 and green 1.16,
// against the 3.0 of MIN_CONTRAST. Only ink, cream, butter and slate are shared
// with PALETTE, and cream and butter are carried here refused, for the straps.
// So a swatch cannot be repainted to "the palette version" of its name without
// the contrast gate then refusing it - which for cobalt, the default top,
// would strip the top off every runner who never opened the wardrobe.
// avatar.test.ts measures this rather than trusting the paragraph.
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

// Cream, butter and blush are in the list for the straps, where the torso frames
// them. They are offered everywhere else too, and refused there with the
// measured ratio, because "you would disappear into the floor" is worth showing
// once rather than hiding behind a shorter list.

const COLOR_MAP = new Map(AVATAR_COLORS.map((entry) => [entry.id, entry]));

const DEFAULT_GARMENT_COLORS: AvatarGarmentColors = {
  headwear: "ink",
  face: "coffee",
  eyewear: "ink",
  top: "cobalt",
  outerwear: "charcoal",
  legwear: "charcoal",
  footwear: "ink",
  backpack: "rust",
  held: "bronze",
};

export const DEFAULT_AVATAR: AvatarConfig = {
  body: "violet",
  pack: "cream",
  headwear: "hair",
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
  return {
    body: knownColor(stored.body, DEFAULT_AVATAR.body),
    pack: knownColor(stored.pack, DEFAULT_AVATAR.pack),
    headwear: known(AVATAR_HEADWEAR, stored.headwear, "hair"),
    face: known(AVATAR_FACES, stored.face, "plain"),
    eyewear: known(AVATAR_EYEWEAR, stored.eyewear, "none"),
    top: known(AVATAR_TOPS, stored.top, "none"),
    outerwear: known(AVATAR_OUTERWEAR, stored.outerwear, "none"),
    legwear: known(AVATAR_LEGWEAR, stored.legwear, "none"),
    footwear: known(AVATAR_FOOTWEAR, stored.footwear, "none"),
    backpack: known(AVATAR_BACKPACKS, stored.backpack, "none"),
    held: known(AVATAR_HELD, stored.held, "none"),
    colors: {
      headwear: knownColor(colors.headwear, DEFAULT_GARMENT_COLORS.headwear),
      face: knownColor(colors.face, DEFAULT_GARMENT_COLORS.face),
      eyewear: knownColor(colors.eyewear, DEFAULT_GARMENT_COLORS.eyewear),
      top: knownColor(colors.top, DEFAULT_GARMENT_COLORS.top),
      outerwear: knownColor(colors.outerwear, DEFAULT_GARMENT_COLORS.outerwear),
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
    "strap-coral": packColor,
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
 * Why a colour cannot fill a slot, or null when it can.
 *
 * Everything the floor sees is measured against the walking surfaces: the body,
 * and every garment that paints a contiguous region of the runner. That is the
 * silhouette a player tracks while judging a gap, and a backpack is in it too,
 * because the chase camera sits behind the runner and the pack is the nearest
 * thing to it.
 *
 * The straps are the exception, and are measured against the body instead. They
 * are two 0.06-wide cords on the FRONT of a 0.52-wide torso, so from the chase
 * camera the torso hides them from the floor entirely. Which slot a colour
 * suits therefore depends on the body already chosen, and the strap list
 * changes as the body changes.
 */
export function colorRejection(
  slot: ColorSlot,
  id: AvatarColorId,
  body: AvatarColorId,
): AvatarRejection | null {
  const hex = avatarColor(id);
  if (slot === "pack") {
    const bodyHex = avatarColor(body);
    const ratio = contrastRatio(hex, bodyHex);
    if (ratio >= MIN_CONTRAST) return null;
    return {
      slot,
      ratio,
      against: bodyHex,
      reason: "vanishes into the body",
    };
  }
  const { min, worstDeck } = deckContrast(hex);
  if (min >= MIN_CONTRAST) return null;
  return { slot, ratio: min, against: worstDeck, reason: "vanishes into the floor" };
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
export const PACK_COLORS: readonly AvatarSwatch[] = AVATAR_COLORS.filter((pack) =>
  AVATAR_COLORS.some(
    (body) =>
      !colorRejection("body", body.id, body.id) &&
      !colorRejection("pack", pack.id, body.id),
  ),
);

/**
 * The first thing wrong with a whole outfit, or null when it is wearable.
 *
 * A garment colour is judged only when that slot is actually filled. Refusing a
 * runner over the colour of a jacket they are not wearing would be a dead end
 * with no visible cause.
 */
export function avatarRejection(
  config: Partial<AvatarConfig> | null | undefined,
): AvatarRejection | null {
  const full = normalizeAvatar(config);
  const body = colorRejection("body", full.body, full.body);
  if (body) return body;
  const pack = colorRejection("pack", full.pack, full.body);
  if (pack) return pack;
  for (const slot of WARDROBE_SLOTS) {
    if (!slot.colorKey || !isSlotFilled(full, slot.id)) continue;
    const rejection = colorRejection(
      slot.colorKey,
      full.colors[slot.colorKey],
      full.body,
    );
    if (rejection) return rejection;
  }
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
  slot: ColorSlot,
  body: AvatarColorId,
): readonly AvatarSwatch[] {
  return AVATAR_COLORS.filter((entry) => !colorRejection(slot, entry.id, body));
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
  const body = pick(usableColors("body", "violet")).id;
  const garment = (key: WardrobeColorKey): AvatarColorId =>
    pick(usableColors(key, body)).id;
  return {
    body,
    pack: pick(usableColors("pack", body)).id,
    headwear: pick(AVATAR_HEADWEAR).id,
    face: pick(AVATAR_FACES).id,
    eyewear: pick(AVATAR_EYEWEAR).id,
    top: pick(AVATAR_TOPS).id,
    outerwear: pick(AVATAR_OUTERWEAR).id,
    legwear: pick(AVATAR_LEGWEAR).id,
    footwear: pick(AVATAR_FOOTWEAR).id,
    backpack: pick(AVATAR_BACKPACKS).id,
    held: pick(AVATAR_HELD).id,
    colors: {
      headwear: garment("headwear"),
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
];

export const WARDROBE_CODE_LENGTH = CODE_FIELDS.length;

/** What a link's wardrobe field has to look like before it is worth parsing. */
export const WARDROBE_CODE_PATTERN = /^[0-9A-Za-z_-]{1,32}$/;

function fieldOptions(field: CodeField): readonly string[] {
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
