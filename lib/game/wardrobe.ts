// The wardrobe catalogue.
//
// Nine slots of code-authored clothing, held apart from avatar.ts because that
// file owns colour and legibility while this one owns "what can you wear".
// Nothing here imports avatar.ts, so the dependency runs one way only.
//
// Two rules govern every list below, and both come from the runner rig rather
// than from taste.
//
// Ordering is append-only. A challenge link stores each choice as its index in
// these arrays, so inserting an option anywhere but the end silently repaints
// every runner already in circulation. The first entries of AVATAR_HEADWEAR and
// AVATAR_FACES are the five hats and four faces that shipped before the
// wardrobe existed, in their original order, which is what keeps a version 4
// link decoding to the runner its sender built.
//
// Every slot has an empty option and it is always first, so no slot can trap a
// player in a choice they cannot take back.

export type WardrobeSlotId =
  | "headwear"
  | "face"
  | "eyewear"
  | "top"
  | "outerwear"
  | "legwear"
  | "footwear"
  | "backpack"
  | "held";

/** Slots whose garment takes a colour. The rest draw in fixed ink and glass. */
export type WardrobeColorKey =
  | "headwear"
  | "face"
  | "eyewear"
  | "top"
  | "outerwear"
  | "legwear"
  | "footwear"
  | "backpack"
  | "held";

export type AvatarHeadwearId =
  | "hair"
  | "cap"
  | "band"
  | "bobble"
  | "bucket"
  | "beanie"
  | "visor"
  | "helmet"
  | "tophat"
  | "crown"
  | "cowboy"
  | "earmuffs"
  | "beret"
  | "headphones";

export type AvatarFaceId =
  | "plain"
  | "grin"
  | "focused"
  | "shades"
  | "brows"
  | "moustache"
  | "beard"
  | "freckles"
  | "warpaint"
  | "mask";

export type AvatarEyewearId =
  | "none"
  | "round"
  | "square"
  | "goggles"
  | "aviator"
  | "visorband";

export type AvatarTopId =
  | "none"
  | "tee"
  | "tank"
  | "stripes"
  | "hoodie"
  | "jersey"
  | "overalls"
  | "turtleneck"
  | "racer";

export type AvatarOuterwearId =
  | "none"
  | "jacket"
  | "puffer"
  | "vest"
  | "cape"
  | "poncho"
  | "harness"
  | "wings"
  | "scarf";

export type AvatarLegwearId =
  | "none"
  | "shorts"
  | "joggers"
  | "jeans"
  | "cargo"
  | "kneepads"
  | "kilt"
  | "tights";

export type AvatarFootwearId =
  | "none"
  | "hightop"
  | "boot"
  | "sandal"
  | "cleats"
  | "skates"
  | "socks";

export type AvatarBackpackId =
  | "none"
  | "daypack"
  | "bedroll"
  | "jetpack"
  | "shell"
  | "satchel"
  | "scuba";

export type AvatarHeldId =
  | "none"
  | "flag"
  | "torch"
  | "umbrella"
  | "baguette"
  | "plunger"
  | "balloon"
  | "trophy";

export interface WardrobeOption<Id extends string> {
  readonly id: Id;
  readonly label: string;
}

// "Hair" is the empty option for the head: it is what the sculpt already draws,
// so choosing it removes a hat rather than adding one.
export const AVATAR_HEADWEAR: readonly WardrobeOption<AvatarHeadwearId>[] = [
  { id: "hair", label: "No hat" },
  { id: "cap", label: "Cap" },
  { id: "band", label: "Headband" },
  { id: "bobble", label: "Bobble hat" },
  { id: "bucket", label: "Bucket hat" },
  { id: "beanie", label: "Beanie" },
  { id: "visor", label: "Visor" },
  { id: "helmet", label: "Helmet" },
  { id: "tophat", label: "Top hat" },
  { id: "crown", label: "Crown" },
  { id: "cowboy", label: "Cowboy hat" },
  { id: "earmuffs", label: "Earmuffs" },
  { id: "beret", label: "Beret" },
  { id: "headphones", label: "Headphones" },
];

export const AVATAR_FACES: readonly WardrobeOption<AvatarFaceId>[] = [
  { id: "plain", label: "Neutral" },
  { id: "grin", label: "Grin" },
  { id: "focused", label: "Focused" },
  { id: "shades", label: "Shades" },
  { id: "brows", label: "Big brows" },
  { id: "moustache", label: "Moustache" },
  { id: "beard", label: "Beard" },
  { id: "freckles", label: "Freckles" },
  { id: "warpaint", label: "War paint" },
  { id: "mask", label: "Face mask" },
];

export const AVATAR_EYEWEAR: readonly WardrobeOption<AvatarEyewearId>[] = [
  { id: "none", label: "None" },
  { id: "round", label: "Round" },
  { id: "square", label: "Square" },
  { id: "goggles", label: "Goggles" },
  { id: "aviator", label: "Aviators" },
  { id: "visorband", label: "Visor band" },
];

export const AVATAR_TOPS: readonly WardrobeOption<AvatarTopId>[] = [
  { id: "none", label: "None" },
  { id: "tee", label: "T-shirt" },
  { id: "tank", label: "Tank top" },
  { id: "stripes", label: "Stripes" },
  { id: "hoodie", label: "Hoodie" },
  { id: "jersey", label: "Jersey" },
  { id: "overalls", label: "Overalls" },
  { id: "turtleneck", label: "Turtleneck" },
  { id: "racer", label: "Racer" },
];

export const AVATAR_OUTERWEAR: readonly WardrobeOption<AvatarOuterwearId>[] = [
  { id: "none", label: "None" },
  { id: "jacket", label: "Jacket" },
  { id: "puffer", label: "Puffer" },
  { id: "vest", label: "Vest" },
  { id: "cape", label: "Cape" },
  { id: "poncho", label: "Poncho" },
  { id: "harness", label: "Harness" },
  { id: "wings", label: "Wings" },
  { id: "scarf", label: "Scarf" },
];

export const AVATAR_LEGWEAR: readonly WardrobeOption<AvatarLegwearId>[] = [
  { id: "none", label: "None" },
  { id: "shorts", label: "Shorts" },
  { id: "joggers", label: "Joggers" },
  { id: "jeans", label: "Jeans" },
  { id: "cargo", label: "Cargo pants" },
  { id: "kneepads", label: "Knee pads" },
  { id: "kilt", label: "Kilt" },
  { id: "tights", label: "Tights" },
];

export const AVATAR_FOOTWEAR: readonly WardrobeOption<AvatarFootwearId>[] = [
  { id: "none", label: "None" },
  { id: "hightop", label: "High-tops" },
  { id: "boot", label: "Boots" },
  { id: "sandal", label: "Sandals" },
  { id: "cleats", label: "Cleats" },
  { id: "skates", label: "Skates" },
  { id: "socks", label: "Long socks" },
];

export const AVATAR_BACKPACKS: readonly WardrobeOption<AvatarBackpackId>[] = [
  { id: "none", label: "None" },
  { id: "daypack", label: "Daypack" },
  { id: "bedroll", label: "Bedroll" },
  { id: "jetpack", label: "Jetpack" },
  { id: "shell", label: "Shell" },
  { id: "satchel", label: "Satchel" },
  { id: "scuba", label: "Air tanks" },
];

export const AVATAR_HELD: readonly WardrobeOption<AvatarHeldId>[] = [
  { id: "none", label: "Empty hand" },
  { id: "flag", label: "Flag" },
  { id: "torch", label: "Torch" },
  { id: "umbrella", label: "Umbrella" },
  { id: "baguette", label: "Baguette" },
  { id: "plunger", label: "Plunger" },
  { id: "balloon", label: "Balloon" },
  { id: "trophy", label: "Trophy" },
];

export interface WardrobeSlot {
  readonly id: WardrobeSlotId;
  readonly label: string;
  /** One line saying what the slot does and, where it matters, why. */
  readonly note: string;
  readonly options: readonly WardrobeOption<string>[];
  /** null when the slot draws in fixed colours rather than a chosen one. */
  readonly colorKey: WardrobeColorKey | null;
  /** The runner pivots this slot's geometry hangs from. */
  readonly sockets: readonly string[];
}

export const WARDROBE_SLOTS: readonly WardrobeSlot[] = [
  {
    id: "headwear",
    label: "Head",
    note: "Rides the head pivot, so it counter-rotates with the head as you run.",
    options: AVATAR_HEADWEAR,
    colorKey: "headwear",
    sockets: ["Head mass__pivot"],
  },
  {
    id: "face",
    label: "Face",
    note: "Brows, whiskers and paint, with their own colour.",
    options: AVATAR_FACES,
    colorKey: "face",
    sockets: ["Head mass__pivot"],
  },
  {
    id: "eyewear",
    label: "Eyewear",
    note: "Sits in front of the eyes. Overrides the Shades expression when both are set.",
    options: AVATAR_EYEWEAR,
    colorKey: "eyewear",
    sockets: ["Head mass__pivot"],
  },
  {
    id: "top",
    label: "Top",
    note: "A shell over the torso. It twists with the torso, so the arms leave it where they already leave the body.",
    options: AVATAR_TOPS,
    colorKey: "top",
    sockets: ["Torso__pivot", "Neck__pivot", "Shoulder cap left__pivot", "Shoulder cap right__pivot"],
  },
  {
    id: "outerwear",
    label: "Outer layer",
    note: "Goes over the top. Every hem stops above the hip so a swinging thigh never cuts through it.",
    options: AVATAR_OUTERWEAR,
    colorKey: "outerwear",
    sockets: ["Torso__pivot", "Neck__pivot"],
  },
  {
    id: "legwear",
    label: "Legs",
    note: "One garment per leg, riding that leg's own pivot, so it swings with the stride.",
    options: AVATAR_LEGWEAR,
    colorKey: "legwear",
    sockets: ["Leg left__pivot", "Leg right__pivot"],
  },
  {
    id: "footwear",
    label: "Feet",
    note: "The foot rides the ankle; anything taller rides the shin, which is what keeps a boot out of your own leg.",
    options: AVATAR_FOOTWEAR,
    colorKey: "footwear",
    sockets: ["Sneaker left__pivot", "Sneaker right__pivot", "Leg left__pivot", "Leg right__pivot"],
  },
  {
    id: "backpack",
    label: "Back",
    note: "Faces the chase camera, so it is held to the same floor-contrast bar as your body.",
    options: AVATAR_BACKPACKS,
    colorKey: "backpack",
    sockets: ["Torso__pivot"],
  },
  {
    id: "held",
    label: "In hand",
    note: "Carried in the right hand, out to the side where it cannot swing through you.",
    options: AVATAR_HELD,
    colorKey: "held",
    sockets: ["Hand right__pivot"],
  },
];

/**
 * How many garments there are to put on, which is every option except the empty
 * one each slot opens with. "None" is a way out of a slot, not a thing to wear.
 */
export const WARDROBE_ITEM_COUNT = WARDROBE_SLOTS.reduce(
  (total, slot) => total + slot.options.length - 1,
  0,
);
