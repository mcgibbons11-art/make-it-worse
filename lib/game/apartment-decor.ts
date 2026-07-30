export const APARTMENT_DECOR_STORAGE_KEY = "make-it-worse:apartment-decor:v1";

export const APARTMENT_DECOR_TYPES = [
  "sofa",
  "side-table",
  "rug",
  "plant",
  "kitchen",
  "bed",
  "wardrobe",
  "desk",
  "bookcase",
] as const;

export type ApartmentDecorType = (typeof APARTMENT_DECOR_TYPES)[number];

export interface ApartmentDecorItem {
  uid: string;
  type: ApartmentDecorType;
  x: number;
  z: number;
  rotation: number;
  color: string;
}

const TYPE_SET = new Set<string>(APARTMENT_DECOR_TYPES);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export const DEFAULT_APARTMENT_DECOR: readonly ApartmentDecorItem[] = [
  { uid: "home-sofa", type: "sofa", x: -3.2, z: -0.3, rotation: 0, color: "#68b78a" },
  { uid: "home-rug", type: "rug", x: -3.2, z: 1.15, rotation: 0, color: "#ff7b6f" },
  { uid: "home-table", type: "side-table", x: -1.4, z: -0.25, rotation: 0, color: "#f2d49d" },
  { uid: "home-plant", type: "plant", x: 0.2, z: -1.1, rotation: 0, color: "#57b878" },
  { uid: "home-desk", type: "desk", x: 3.4, z: -0.7, rotation: Math.PI / 2, color: "#79aee8" },
  { uid: "home-bookcase", type: "bookcase", x: 5.25, z: -0.2, rotation: Math.PI / 2, color: "#eab65d" },
];

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
    if (typeof candidate.type !== "string" || !TYPE_SET.has(candidate.type)) continue;
    const color = typeof candidate.color === "string" && HEX_COLOR.test(candidate.color)
      ? candidate.color.toLowerCase()
      : "#68b78a";
    seen.add(candidate.uid);
    result.push({
      uid: candidate.uid.slice(0, 80),
      type: candidate.type as ApartmentDecorType,
      x: Math.max(-12.2, Math.min(12.2, finiteNumber(candidate.x, 0))),
      z: Math.max(-7.9, Math.min(7.9, finiteNumber(candidate.z, 0))),
      rotation: finiteNumber(candidate.rotation, 0),
      color,
    });
  }
  return result;
}

export function loadApartmentDecor(storage: Pick<Storage, "getItem">): ApartmentDecorItem[] {
  try {
    const raw = storage.getItem(APARTMENT_DECOR_STORAGE_KEY);
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
