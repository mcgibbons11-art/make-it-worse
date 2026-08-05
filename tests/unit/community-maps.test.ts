import { describe, expect, it } from "vitest";
import { generateRandomRoom, runtimeMap } from "@/components/game/RoomBuilder";
import { dailyRoomSeed } from "@/lib/game/seed";
import { encodeChallengeLink } from "@/lib/game/challenge-link";
import {
  CUSTOM_MAP_CODE_MAX_LENGTH,
  customMapBrowseResponseSchema,
  customMapPublishRequestSchema,
  validateCustomMapCode,
} from "@/lib/game/community-maps";

function authoredCode(seed = 9301) {
  // Keep the contract fixture focused on custom geometry. Random-room traps
  // intentionally include chaotic placements that are not all share-safe.
  const items = generateRandomRoom(seed).filter((item) => !item.asset.startsWith("trap:"));
  const runtime = runtimeMap(items, seed, seed, "Wobbly Builder");
  return {
    runtime,
    code: encodeChallengeLink(runtime.challenge, null, runtime.track),
  };
}

describe("community map wire contract", () => {
  it("accepts only a fully decodable authored room", () => {
    const { runtime, code } = authoredCode();
    const decoded = validateCustomMapCode(code);
    expect(decoded.challenge.slug).toBe(runtime.challenge.slug);
    expect(decoded.pieceCount).toBe(runtime.track.pieces.length);
    expect(decoded.trapCount).toBe(runtime.challenge.traps.length);
    expect(decoded.track).toEqual(expect.objectContaining({
      spawn: runtime.track.spawn,
      exit: runtime.track.exit,
    }));
    expect(customMapPublishRequestSchema.parse({
      title: "Kitchen Catastrophe",
      description: "A real authored room.",
      visibility: "public",
      code,
    }).code).toBe(code);
  });

  it("rejects legacy levels, corruption, oversized codes, and unknown fields", () => {
    expect(() => validateCustomMapCode("damaged")).toThrow();
    expect(() => validateCustomMapCode("x".repeat(CUSTOM_MAP_CODE_MAX_LENGTH + 1))).toThrow();
    const { runtime } = authoredCode(22);
    const legacy = encodeChallengeLink(runtime.challenge, null, null);
    expect(() => validateCustomMapCode(legacy)).toThrow("CUSTOM_MAP_REQUIRES_AUTHORED_ROOM");
    const { code } = authoredCode(23);
    expect(customMapPublishRequestSchema.safeParse({
      title: "Valid title",
      description: "",
      visibility: "public",
      code,
      injected: true,
    }).success).toBe(false);
  });

  it("requires bounded metadata and keeps browse responses strict", () => {
    const { code } = authoredCode(24);
    expect(customMapPublishRequestSchema.safeParse({ title: "x", visibility: "public", code }).success).toBe(false);
    expect(customMapPublishRequestSchema.safeParse({ title: "Valid", visibility: "friends", code }).success).toBe(false);
    expect(customMapBrowseResponseSchema.safeParse({ items: [], nextCursor: null }).success).toBe(true);
    expect(customMapBrowseResponseSchema.safeParse({ items: [], nextCursor: null, total: 0 }).success).toBe(false);
  });
});

describe("the Daily Disaster", () => {
  it("rolls at the player's local midnight, not at a UTC boundary", () => {
    // The bug this pins: keyed to UTC, an 8pm Eastern evening and the next
    // morning shared one course. Local calendar dating is the contract now.
    const lateEvening = new Date(2026, 7, 4, 23, 59, 0);
    const nextMorning = new Date(2026, 7, 5, 0, 1, 0);
    const sameDayNoon = new Date(2026, 7, 5, 12, 0, 0);
    expect(dailyRoomSeed(lateEvening)).not.toBe(dailyRoomSeed(nextMorning));
    expect(dailyRoomSeed(nextMorning)).toBe(dailyRoomSeed(sameDayNoon));
    // Deterministic per date, so every player lands on the same room slug.
    expect(dailyRoomSeed(sameDayNoon)).toBe(dailyRoomSeed(new Date(2026, 7, 5, 18, 30, 0)));
  });

  it("generates a gauntlet: far longer and denser than a standard clean room", () => {
    for (const date of [new Date(2026, 7, 5), new Date(2026, 7, 6), new Date(2026, 7, 7)]) {
      const seed = dailyRoomSeed(date);
      const standard = generateRandomRoom(seed);
      const daily = generateRandomRoom(seed, "daily");
      const platforms = (items: typeof daily) =>
        items.filter((item) => !item.asset.startsWith("trap:") && item.asset !== "spawn" && item.asset !== "finish");
      const traps = (items: typeof daily) => items.filter((item) => item.asset.startsWith("trap:"));
      expect(platforms(daily).length).toBeGreaterThan(platforms(standard).length * 2 - 1);
      // Every daily platform carries at least one trap, and the course runs
      // far deeper into the room than a warm-up ever does.
      expect(traps(daily).length).toBeGreaterThanOrEqual(platforms(daily).length - 1);
      const depth = (items: typeof daily) => Math.min(...items.map((item) => item.z));
      expect(depth(daily)).toBeLessThan(depth(standard) - 40);
      // Consecutive platform spacing stays inside real jump reach even at
      // its cruellest: the profile trades comfort, never possibility.
      const hops = platforms(daily);
      for (let index = 1; index < hops.length; index += 1) {
        const dz = Math.abs(hops[index]!.z - hops[index - 1]!.z);
        const dx = Math.abs(hops[index]!.x - hops[index - 1]!.x);
        expect(Math.hypot(dx, dz)).toBeLessThanOrEqual(7.6);
        expect(hops[index]!.y - hops[index - 1]!.y).toBeLessThanOrEqual(0.75);
      }
    }
  });
});
