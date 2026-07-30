import { describe, expect, it } from "vitest";
import { generateRandomRoom, runtimeMap } from "@/components/game/RoomBuilder";
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
