import { describe, expect, it } from "vitest";
import { decodeMapCursor, encodeMapCursor } from "@/lib/api/map-cursor";

describe("community browse cursors", () => {
  it("round-trips bounded offsets", () => {
    expect(decodeMapCursor(encodeMapCursor(0))).toBe(0);
    expect(decodeMapCursor(encodeMapCursor(144))).toBe(144);
  });

  it("rejects tampering and unreasonable offsets", () => {
    expect(() => decodeMapCursor("not-base64-json")).toThrow("invalid");
    const huge = Buffer.from(JSON.stringify({ v: 1, offset: 10_001 })).toString("base64url");
    expect(() => decodeMapCursor(huge)).toThrow("invalid");
  });
});
