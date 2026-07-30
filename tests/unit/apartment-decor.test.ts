import { describe, expect, it } from "vitest";
import {
  APARTMENT_DECOR_STORAGE_KEY,
  DEFAULT_APARTMENT_DECOR,
  loadApartmentDecor,
  sanitizeApartmentDecor,
  saveApartmentDecor,
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
    const moved = DEFAULT_APARTMENT_DECOR.map((item, index) => ({ ...item, x: index + 0.25 }));
    saveApartmentDecor(storage, moved);
    expect(values.has(APARTMENT_DECOR_STORAGE_KEY)).toBe(true);
    expect(loadApartmentDecor(storage)).toEqual(moved);
  });
});
