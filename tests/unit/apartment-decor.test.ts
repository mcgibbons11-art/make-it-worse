import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APARTMENT_DECOR_STORAGE_KEY,
  APARTMENT_DECOR_TYPES,
  APARTMENT_STYLE_STORAGE_KEY,
  apartmentDecorShortcutAction,
  DEFAULT_APARTMENT_DECOR,
  DEFAULT_APARTMENT_PARTITIONS,
  DEFAULT_APARTMENT_STYLE,
  loadApartmentDecor,
  loadApartmentStyle,
  sanitizeApartmentDecor,
  sanitizeApartmentStyle,
  saveApartmentDecor,
  saveApartmentStyle,
} from "@/lib/game/apartment-decor";

describe("apartment decor persistence", () => {
  it("maps apartment Ctrl/Cmd+C/V and both delete keys without stealing interface input", () => {
    const event = (change: Partial<Parameters<typeof apartmentDecorShortcutAction>[0]> = {}) => ({
      altKey: false,
      code: "",
      ctrlKey: false,
      key: "",
      metaKey: false,
      repeat: false,
      shiftKey: false,
      ...change,
    });
    expect(apartmentDecorShortcutAction(event({ key: "Delete" }), false, true, false)).toBe("delete");
    expect(apartmentDecorShortcutAction(event({ key: "Backspace" }), false, true, false)).toBe("delete");
    expect(apartmentDecorShortcutAction(event({ code: "Backspace" }), false, true, false)).toBe("delete");
    expect(apartmentDecorShortcutAction(event({ code: "KeyC", ctrlKey: true }), false, true, false)).toBe("copy");
    expect(apartmentDecorShortcutAction(event({ code: "KeyC", metaKey: true }), false, true, false)).toBe("copy");
    expect(apartmentDecorShortcutAction(event({ code: "KeyV", ctrlKey: true }), false, false, true)).toBe("paste");
    expect(apartmentDecorShortcutAction(event({ code: "KeyV", metaKey: true }), false, false, true)).toBe("paste");
    expect(apartmentDecorShortcutAction(event({ code: "KeyV", ctrlKey: true }), true, false, true)).toBeNull();
    expect(apartmentDecorShortcutAction(event({ key: "Delete", repeat: true }), false, true, false)).toBeNull();
    expect(apartmentDecorShortcutAction(event({ key: "Backspace" }), true, true, false)).toBeNull();
    expect(apartmentDecorShortcutAction(event({ key: "Delete" }), false, false, false)).toBeNull();
  });

  it("keeps the apartment Decorate panel vertically scrollable with a visible gutter", () => {
    const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
    expect(css).toContain(".avatar-apartment-decor{width:min(430px,calc(100vw - 36px));overflow-x:hidden;overflow-y:scroll");
    expect(css).toContain("scrollbar-gutter:stable");
    expect(css).toContain(".avatar-apartment-decor::-webkit-scrollbar-thumb");
  });

  it("restores the starter arrangement when storage is empty or corrupt", () => {
    expect(sanitizeApartmentDecor(null)).toEqual(DEFAULT_APARTMENT_DECOR);
    expect(loadApartmentDecor({ getItem: () => "not-json" })).toEqual(DEFAULT_APARTMENT_DECOR);
  });

  it("bounds malformed fields without imposing an apartment item-count cap", () => {
    const items = Array.from({ length: 90 }, (_, index) => ({
      uid: index < 2 ? "duplicate" : `item-${index}`,
      type: index === 3 ? "not-furniture" : "sofa",
      x: 999,
      z: -999,
      rotation: Number.NaN,
      color: index === 4 ? "yellow" : "#ABCDEF",
    }));
    const sanitized = sanitizeApartmentDecor(items);
    expect(sanitized).toHaveLength(88);
    expect(sanitized[0]).toMatchObject({ uid: "duplicate", x: 12.2, z: -7.9, rotation: 0, color: "#abcdef" });
    expect(sanitized.find((item) => item.uid === "item-4")?.color).toBe("#68b78a");
  });

  it("stores every interior partition and doorway as modular starter decor", () => {
    expect(DEFAULT_APARTMENT_PARTITIONS.filter((item) => item.type === "wall-section")).toHaveLength(16);
    expect(DEFAULT_APARTMENT_PARTITIONS.filter((item) => item.type === "door-frame")).toHaveLength(6);
    expect(DEFAULT_APARTMENT_DECOR).toEqual(expect.arrayContaining([...DEFAULT_APARTMENT_PARTITIONS]));
  });

  it("uses one continuous wood shell floor and offers movable floor coverings", () => {
    const source = readFileSync(resolve(process.cwd(), "components/hud/wardrobe/AvatarApartment.tsx"), "utf8");
    expect(APARTMENT_DECOR_TYPES).toEqual(expect.arrayContaining(["rug", "round-rug", "runner-rug", "tile-floor"]));
    expect(source).toContain("function WoodFloorPattern()");
    expect(source).toContain('<WoodFloorPattern />');
    expect(source).not.toContain("FLOOR_ZONES");
    expect(source).toContain('id: "floor", label: "🧶 Floors"');
  });

  it("sanitizes modular wall lengths while preserving arbitrary wall counts", () => {
    const walls = Array.from({ length: 240 }, (_, index) => ({
      uid: `wall-${index}`,
      type: "wall-section",
      x: 0,
      z: 0,
      rotation: 0,
      color: "#ABCDEF",
      length: index === 0 ? 100 : 2.5,
    }));
    const sanitized = sanitizeApartmentDecor(walls);
    expect(sanitized).toHaveLength(240);
    expect(sanitized[0]).toMatchObject({ type: "wall-section", color: "#abcdef", length: 24 });
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

  it("keeps legacy wall and surface pieces free while migrating the v1 storage key", () => {
    const legacy = JSON.stringify([
      { uid: "art", type: "wall-art", x: 1, z: 2, rotation: 0, color: "#abcdef" },
      { uid: "bedroom-lamp", type: "bedside-lamp", x: 3, z: 4, rotation: 0, color: "#fedcba" },
      { uid: "bedroom-table", type: "bedside-table", x: 3, z: 4, rotation: 0, color: "#123456" },
    ]);
    const loaded = loadApartmentDecor({
      getItem: (key) => key === "make-it-worse:apartment-decor:v1" ? legacy : null,
    });
    expect(loaded.find((item) => item.uid === "art")).toMatchObject({ anchorKind: "wall" });
    expect(loaded.find((item) => item.uid === "bedroom-lamp")).toMatchObject({ anchorKind: "surface", x: 3, z: 4 });
    expect(loaded.find((item) => item.uid === "bedroom-lamp")).not.toHaveProperty("parentUid");
  });

  it("adds modular partitions once when migrating a v2 furniture layout", () => {
    const oldLayout = JSON.stringify([
      { uid: "my-sofa", type: "sofa", x: 4, z: -2, rotation: 1, color: "#123456" },
    ]);
    const migrated = loadApartmentDecor({
      getItem: (key) => key === "make-it-worse:apartment-decor:v2" ? oldLayout : null,
    });
    expect(migrated.find((item) => item.uid === "my-sofa")).toMatchObject({ x: 4, z: -2 });
    expect(migrated.filter((item) => item.type === "wall-section")).toHaveLength(16);
    expect(new Set(migrated.map((item) => item.uid)).size).toBe(migrated.length);
  });

  it("preserves continuous coordinates and strips old furniture attachments", () => {
    expect(sanitizeApartmentDecor([{
      uid: "free-lamp",
      type: "bedside-lamp",
      x: 1.234567,
      z: -2.345678,
      rotation: 0,
      color: "#fedcba",
      anchorKind: "surface",
      parentUid: "old-table",
    }])).toEqual([{
      uid: "free-lamp",
      type: "bedside-lamp",
      x: 1.234567,
      z: -2.345678,
      rotation: 0,
      color: "#fedcba",
      anchorKind: "surface",
    }]);
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
