import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TRAP_TYPES } from "@/lib/game/trap-catalog";

type Credit = {
  file: string;
  source: string | null;
  title?: string;
  author?: string;
  originalFilename?: string;
  license?: string;
};

const audioRoot = resolve(process.cwd(), "public/audio");
const manifest = JSON.parse(
  readFileSync(resolve(audioRoot, "CREDITS.json"), "utf8"),
) as { files: Credit[]; planned: unknown[] };

describe("recorded trap audio assets", () => {
  it("has finished the sourcing plan", () => {
    expect(manifest.planned).toEqual([]);
  });

  it("ships a credited recording for every trap that reports audio", () => {
    const credits = new Map(manifest.files.map((entry) => [entry.file, entry]));
    for (const trap of TRAP_TYPES) {
      if (trap === "laundry_basket") continue;
      const file = `${trap}.mp3`;
      const path = resolve(audioRoot, file);
      expect(existsSync(path), file).toBe(true);
      expect(statSync(path).size, file).toBeGreaterThan(1_000);
      expect(credits.has(file), `${file} credit`).toBe(true);
    }
  });

  it("keeps complete provenance for every Pixabay recording", () => {
    const pixabay = manifest.files.filter(
      (entry) => entry.license === "Pixabay Content License",
    );
    expect(pixabay).toHaveLength(38);
    for (const entry of pixabay) {
      expect(entry.source, entry.file).toMatch(/^https:\/\/pixabay\.com\/sound-effects\//);
      expect(entry.title, entry.file).toBeTruthy();
      expect(entry.author, entry.file).toBeTruthy();
      expect(entry.originalFilename, entry.file).toMatch(/\.mp3$/);
    }
  });
});
