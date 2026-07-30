import { describe, expect, it } from "vitest";
import { generateRandomRoom, runtimeMap, unreachablePlatformIds, type RoomItem } from "@/components/game/RoomBuilder";
import { TRAP_TYPES } from "@/lib/game/trap-catalog";

const item = (uid: number, asset: RoomItem["asset"], x: number, y: number, z: number): RoomItem => ({
  uid, asset, x, y, z, rotation: 0, color: "#ffd84d",
});

describe("unrestricted custom map builder", () => {
  it("generates a playable document with builder-only spawn and an end gate", () => {
    const room = generateRandomRoom(1234);
    expect(room.some((entry) => entry.asset === "spawn")).toBe(true);
    expect(room.some((entry) => entry.asset === "finish")).toBe(true);
    expect(room.some((entry) => entry.asset.startsWith("trap:"))).toBe(true);
    expect(room.every((entry) => /^#[0-9a-f]{6}$/i.test(entry.color))).toBe(true);
    const platformColors = new Set(room.filter((entry) => !entry.asset.startsWith("trap:") && !["spawn", "finish"].includes(entry.asset)).map((entry) => entry.color));
    expect(platformColors.size).toBeGreaterThan(1);
    expect(runtimeMap(room, 17, 1234).track.zones.length).toBeGreaterThan(1);
  });

  it("marks a platform beyond the real jump envelope and clears it when bridged", () => {
    const isolated = [item(1, "spawn", 0, 0, 0), item(2, "platform", 0, 0, 0), item(3, "platform", 20, 0, 0)];
    expect(unreachablePlatformIds(isolated)).toContain(3);
    const bridged = [...isolated, item(4, "wide-platform", 5, 0, 0), item(5, "wide-platform", 11, 0, 0), item(6, "wide-platform", 16, 0, 0)];
    expect(unreachablePlatformIds(bridged)).not.toContain(3);
  });

  it("uses the complete main-game trap roster as builder asset ids", () => {
    const ids = TRAP_TYPES.map((type) => `trap:${type}`);
    expect(ids).toHaveLength(55);
    expect(ids).toContain("trap:charles_murder_baby");
    expect(new Set(ids).size).toBe(ids.length);
  });
});
