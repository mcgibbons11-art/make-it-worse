export const APARTMENT_DECOR_STORAGE_KEY = "make-it-worse:apartment-decor:v2";

export const APARTMENT_DECOR_TYPES = [
  "sofa",
  "side-table",
  "dining-table",
  "dining-chair",
  "rug",
  "plant",
  "kitchen-counter",
  "wall-cabinet",
  "bathroom-vanity",
  "refrigerator",
  "toaster",
  "bed",
  "bedside-table",
  "bedside-lamp",
  "wardrobe",
  "writing-desk",
  "desk-chair",
  "bookcase",
  "wall-art",
  "curtains",
  "radiator",
  "wall-shelf",
  "toilet",
  "vacuum",
  "floor-fan",
  "robot-mop",
] as const;

export type ApartmentDecorType = (typeof APARTMENT_DECOR_TYPES)[number];
export type ApartmentAnchorKind = "floor" | "wall" | "surface";

export interface ApartmentDecorItem {
  uid: string;
  type: ApartmentDecorType;
  x: number;
  z: number;
  rotation: number;
  color: string;
  anchorKind?: ApartmentAnchorKind;
  parentUid?: string;
}

export interface ApartmentStyle {
  wallColor: string;
  trimColor: string;
  floorColor: string;
}

export const APARTMENT_STYLE_STORAGE_KEY = "make-it-worse:apartment-style:v1";
const LEGACY_APARTMENT_DECOR_STORAGE_KEY = "make-it-worse:apartment-decor:v1";
export const DEFAULT_APARTMENT_STYLE: ApartmentStyle = {
  wallColor: "#fff4df",
  trimColor: "#24324a",
  floorColor: "#d6aa73",
};

const TYPE_SET = new Set<string>(APARTMENT_DECOR_TYPES);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const WALL_TYPES = new Set<ApartmentDecorType>([
  "wall-cabinet",
  "wall-art",
  "curtains",
  "radiator",
  "wall-shelf",
]);
const SURFACE_TYPES = new Set<ApartmentDecorType>(["toaster", "bedside-lamp"]);

export function apartmentAnchorKind(type: ApartmentDecorType): ApartmentAnchorKind {
  if (WALL_TYPES.has(type)) return "wall";
  if (SURFACE_TYPES.has(type)) return "surface";
  return "floor";
}

const RAW_DEFAULT_APARTMENT_DECOR: readonly ApartmentDecorItem[] = [
  { uid: "living-sofa", type: "sofa", x: -8.2, z: -6.7, rotation: 0, color: "#68b78a" },
  { uid: "living-rug", type: "rug", x: -8.1, z: -4.8, rotation: 0, color: "#ff7b6f" },
  { uid: "living-table", type: "side-table", x: -6.1, z: -6.5, rotation: 0, color: "#f2d49d" },
  { uid: "living-plant", type: "plant", x: -11.2, z: -6.6, rotation: 0, color: "#57b878" },
  { uid: "living-curtains", type: "curtains", x: -8.6, z: -7.9, rotation: Math.PI / 2, color: "#ff8b84" },
  { uid: "living-art", type: "wall-art", x: -4.5, z: -7.9, rotation: 0, color: "#ff8b84" },
  { uid: "living-radiator", type: "radiator", x: -11.8, z: -3.4, rotation: 0, color: "#fff4df" },
  { uid: "kitchen-counter", type: "kitchen-counter", x: -8.4, z: 1.1, rotation: 0, color: "#f2d49d" },
  { uid: "kitchen-counter-return", type: "kitchen-counter", x: -5.8, z: 2.2, rotation: Math.PI / 2, color: "#f2d49d" },
  { uid: "kitchen-wall-cabinet", type: "wall-cabinet", x: -8.4, z: 1.1, rotation: 0, color: "#f2d49d" },
  { uid: "kitchen-fridge", type: "refrigerator", x: -11.4, z: 1.2, rotation: 0, color: "#57dfa1" },
  { uid: "kitchen-toaster", type: "toaster", x: -7.9, z: 1.0, rotation: 0, color: "#ff9b4a" },
  { uid: "dining-table", type: "dining-table", x: -8.2, z: 5.3, rotation: 0, color: "#eab65d" },
  { uid: "dining-chair-a", type: "dining-chair", x: -8.2, z: 3.9, rotation: 0, color: "#79aee8" },
  { uid: "dining-chair-b", type: "dining-chair", x: -8.2, z: 6.7, rotation: Math.PI, color: "#79aee8" },
  { uid: "dining-chair-c", type: "dining-chair", x: -6.7, z: 5.3, rotation: Math.PI / 2, color: "#79aee8" },
  { uid: "dining-chair-d", type: "dining-chair", x: -9.7, z: 5.3, rotation: -Math.PI / 2, color: "#79aee8" },
  { uid: "bedroom-bed", type: "bed", x: 8.1, z: -6.4, rotation: 0, color: "#ff8b84" },
  { uid: "bedroom-table", type: "bedside-table", x: 5.6, z: -6.7, rotation: 0, color: "#f2d49d" },
  { uid: "bedroom-lamp", type: "bedside-lamp", x: 5.6, z: -6.7, rotation: 0, color: "#ffd84d" },
  { uid: "bedroom-table-b", type: "bedside-table", x: 10.6, z: -6.7, rotation: Math.PI, color: "#f2d49d" },
  { uid: "bedroom-lamp-b", type: "bedside-lamp", x: 10.6, z: -6.7, rotation: 0, color: "#ffd84d" },
  { uid: "bedroom-rug", type: "rug", x: 8.1, z: -4.5, rotation: 0, color: "#eab65d" },
  { uid: "bedroom-wardrobe", type: "wardrobe", x: 11.7, z: -3.5, rotation: 0, color: "#79aee8" },
  { uid: "bedroom-curtains", type: "curtains", x: 7.4, z: -7.9, rotation: Math.PI / 2, color: "#79aee8" },
  { uid: "study-desk", type: "writing-desk", x: 9.2, z: 0.8, rotation: Math.PI / 2, color: "#79aee8" },
  { uid: "study-chair", type: "desk-chair", x: 7.6, z: 0.8, rotation: -Math.PI / 2, color: "#68b78a" },
  { uid: "study-bookcase", type: "bookcase", x: 11.3, z: -0.4, rotation: Math.PI / 2, color: "#eab65d" },
  { uid: "study-rug", type: "rug", x: 7.8, z: 1.2, rotation: Math.PI / 2, color: "#ff8b84" },
  { uid: "study-shelf", type: "wall-shelf", x: 5.2, z: 2.7, rotation: Math.PI / 2, color: "#eab65d" },
  { uid: "study-art", type: "wall-art", x: 9.7, z: 2.7, rotation: Math.PI, color: "#eab65d" },
  { uid: "bath-toilet", type: "toilet", x: 6.3, z: 7.2, rotation: Math.PI, color: "#fff8e8" },
  { uid: "bath-vanity", type: "bathroom-vanity", x: 5.2, z: 4.2, rotation: 0, color: "#79aee8" },
  { uid: "utility-vacuum", type: "vacuum", x: 10.8, z: 6.3, rotation: 0, color: "#8b72ff" },
  { uid: "utility-mop", type: "robot-mop", x: 9.5, z: 6.4, rotation: 0, color: "#4b8dff" },
  { uid: "utility-fan", type: "floor-fan", x: 11.5, z: 4.5, rotation: -Math.PI / 2, color: "#79aee8" },
  { uid: "utility-storage", type: "wall-cabinet", x: 10.2, z: 4.1, rotation: 0, color: "#eab65d" },
];

export const DEFAULT_APARTMENT_DECOR: readonly ApartmentDecorItem[] = RAW_DEFAULT_APARTMENT_DECOR.map((item) => ({
  ...item,
  anchorKind: apartmentAnchorKind(item.type),
}));

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function sanitizeApartmentDecor(value: unknown): ApartmentDecorItem[] {
  if (!Array.isArray(value)) return DEFAULT_APARTMENT_DECOR.map((item) => ({ ...item }));
  const result: ApartmentDecorItem[] = [];
  const seen = new Set<string>();
  for (const entry of value.slice(0, 80)) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Partial<ApartmentDecorItem>;
    if (typeof candidate.uid !== "string" || !candidate.uid || seen.has(candidate.uid)) continue;
    const candidateType = (entry as { type?: unknown }).type;
    const migratedType = candidateType === "kitchen"
      ? "kitchen-counter"
      : candidateType === "desk"
        ? "writing-desk"
        : candidateType;
    if (typeof migratedType !== "string" || !TYPE_SET.has(migratedType)) continue;
    const color = typeof candidate.color === "string" && HEX_COLOR.test(candidate.color)
      ? candidate.color.toLowerCase()
      : "#68b78a";
    const type = migratedType as ApartmentDecorType;
    const candidateAnchor = (entry as { anchorKind?: unknown }).anchorKind;
    const anchorKind = candidateAnchor === "floor" || candidateAnchor === "wall" || candidateAnchor === "surface"
      ? candidateAnchor
      : apartmentAnchorKind(type);
    seen.add(candidate.uid);
    result.push({
      uid: candidate.uid.slice(0, 80),
      type,
      x: Math.max(-12.2, Math.min(12.2, finiteNumber(candidate.x, 0))),
      z: Math.max(-7.9, Math.min(7.9, finiteNumber(candidate.z, 0))),
      rotation: finiteNumber(candidate.rotation, 0),
      color,
      anchorKind,
    });
  }
  return result;
}

export function sanitizeApartmentStyle(value: unknown): ApartmentStyle {
  const candidate = value && typeof value === "object"
    ? value as Partial<ApartmentStyle>
    : {};
  const color = (entry: unknown, fallback: string) =>
    typeof entry === "string" && HEX_COLOR.test(entry)
      ? entry.toLowerCase()
      : fallback;
  return {
    wallColor: color(candidate.wallColor, DEFAULT_APARTMENT_STYLE.wallColor),
    trimColor: color(candidate.trimColor, DEFAULT_APARTMENT_STYLE.trimColor),
    floorColor: color(candidate.floorColor, DEFAULT_APARTMENT_STYLE.floorColor),
  };
}

export function loadApartmentStyle(
  storage: Pick<Storage, "getItem">,
): ApartmentStyle {
  try {
    const raw = storage.getItem(APARTMENT_STYLE_STORAGE_KEY);
    return raw ? sanitizeApartmentStyle(JSON.parse(raw) as unknown) : { ...DEFAULT_APARTMENT_STYLE };
  } catch {
    return { ...DEFAULT_APARTMENT_STYLE };
  }
}

export function saveApartmentStyle(
  storage: Pick<Storage, "setItem">,
  style: ApartmentStyle,
): void {
  storage.setItem(APARTMENT_STYLE_STORAGE_KEY, JSON.stringify(sanitizeApartmentStyle(style)));
}

export function loadApartmentDecor(storage: Pick<Storage, "getItem">): ApartmentDecorItem[] {
  try {
    const raw = storage.getItem(APARTMENT_DECOR_STORAGE_KEY)
      ?? storage.getItem(LEGACY_APARTMENT_DECOR_STORAGE_KEY);
    return raw ? sanitizeApartmentDecor(JSON.parse(raw) as unknown) : sanitizeApartmentDecor(null);
  } catch {
    return sanitizeApartmentDecor(null);
  }
}

export function saveApartmentDecor(
  storage: Pick<Storage, "setItem">,
  items: readonly ApartmentDecorItem[],
): void {
  storage.setItem(APARTMENT_DECOR_STORAGE_KEY, JSON.stringify(sanitizeApartmentDecor(items)));
}
