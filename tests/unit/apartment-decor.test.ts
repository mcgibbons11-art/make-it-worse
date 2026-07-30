import { describe, expect, it } from "vitest";
import {
  APARTMENT_DECOR_STORAGE_KEY,
  APARTMENT_STYLE_STORAGE_KEY,
  DEFAULT_APARTMENT_DECOR,
  DEFAULT_APARTMENT_STYLE,
  loadApartmentDecor,
  loadApartmentStyle,
  sanitizeApartmentDecor,
  sanitizeApartmentStyle,
  saveApartmentDecor,
  saveApartmentStyle,
} from "@/lib/game/apartment-decor";

describe("apartment decor persistence", () => {
  it("restores the starter arrangement when storage is empty or corrupt", () => {
    expect(sanitizeApartmentDecor(null)).toEqual(DEFAULT_APARTMENT_DECOR);
    expect(loadApartmentDecor({ getItem: () => "not-json" })).toEqual(DEFAULT_APARTMENT_DECOR);
  });

  it("bounds positions, colors, duplicate ids, and the maximum item count", () => {
    const items = Array.from({ length: 90 }, (_, index) => ({
      uid: index < 2 ? "duplicate" : `item-${index}`,
      type: index === 3 ? "not-furniture" : "sofa",
      x: 999,
      z: -999,
      rotation: Number.NaN,
      color: index === 4 ? "yellow" : "#ABCDEF",
    }));
    const sanitized = sanitizeApartmentDecor(items);
    expect(sanitized).toHaveLength(78);
    expect(sanitized[0]).toMatchObject({ uid: "duplicate", x: 12.2, z: -7.9, rotation: 0, color: "#abcdef" });
    expect(sanitized.find((item) => item.uid === "item-4")?.color).toBe("#68b78a");
  });

  it("round-trips the saved arrangement through the versioned key", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const moved = DEFAULT_APARTMENT_DECOR.map((item) => ({ ...item, x: item.x + 0.25 }));
    saveApartmentDecor(storage, moved);
    expect(values.has(APARTMENT_DECOR_STORAGE_KEY)).toBe(true);
    expect(loadApartmentDecor(storage)).toEqual(moved);
  });

  it("migrates legacy furniture types without dropping the player's layout", () => {
    expect(sanitizeApartmentDecor([
      { uid: "old-kitchen", type: "kitchen", x: 2, z: 3, rotation: 0, color: "#ABCDEF" },
      { uid: "old-desk", type: "desk", x: -2, z: -3, rotation: 1, color: "#123456" },
    ])).toEqual([
      { uid: "old-kitchen", type: "kitchen-counter", x: 2, z: 3, rotation: 0, color: "#abcdef", anchorKind: "floor" },
      { uid: "old-desk", type: "writing-desk", x: -2, z: -3, rotation: 1, color: "#123456", anchorKind: "floor" },
    ]);
  });

  it("infers wall and surface anchors while migrating the v1 storage key", () => {
    const legacy = JSON.stringify([
      { uid: "art", type: "wall-art", x: 1, z: 2, rotation: 0, color: "#abcdef" },
      { uid: "bedroom-lamp", type: "bedside-lamp", x: 3, z: 4, rotation: 0, color: "#fedcba" },
      { uid: "bedroom-table", type: "bedside-table", x: 3, z: 4, rotation: 0, color: "#123456" },
    ]);
    const loaded = loadApartmentDecor({
      getItem: (key) => key === "make-it-worse:apartment-decor:v1" ? legacy : null,
    });
    expect(loaded[0]).toMatchObject({ anchorKind: "wall" });
    expect(loaded[1]).toMatchObject({ anchorKind: "surface", parentUid: "bedroom-table" });
  });

  it("sanitizes and persists apartment shell colors", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const style = { wallColor: "#AABBCC", trimColor: "nope", floorColor: "#123456" };
    expect(sanitizeApartmentStyle(style)).toEqual({
      wallColor: "#aabbcc",
      trimColor: DEFAULT_APARTMENT_STYLE.trimColor,
      floorColor: "#123456",
    });
    saveApartmentStyle(storage, style);
    expect(values.has(APARTMENT_STYLE_STORAGE_KEY)).toBe(true);
    expect(loadApartmentStyle(storage)).toEqual({
      wallColor: "#aabbcc",
      trimColor: DEFAULT_APARTMENT_STYLE.trimColor,
      floorColor: "#123456",
    });
  });
});
