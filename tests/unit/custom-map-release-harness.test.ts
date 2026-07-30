import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateCustomMapCode } from "@/lib/game/community-maps";

describe("real custom-map release harness", () => {
  it("generates a playable version-5 authored room without credentials", () => {
    const script = path.join(process.cwd(), "scripts", "verify-custom-map-release.mjs");
    const code = execFileSync(process.execPath, [script, "--print-fixture"], {
      encoding: "utf8",
    }).trim();
    const decoded = validateCustomMapCode(code);
    expect(decoded.challenge.slug).toBe("release-fixture");
    expect(decoded.pieceCount).toBe(1);
    expect(decoded.trapCount).toBe(0);
    expect(decoded.track.spawn).toEqual([0, 1.25, 1.2]);
    expect(decoded.track.exit).toEqual([0, 1.5, 9.15]);
  });
});
