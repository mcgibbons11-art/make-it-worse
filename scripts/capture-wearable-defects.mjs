// Targeted evidence for the 2026-08-03 wearable defect reports: the visor's
// detached brim, head bleed through the cowboy hat, hat-plus-glasses
// collisions, body bleed through overalls, shirt bleed through the harness,
// and the reworked poncho shoulder. Same drive as capture-avatar-seam-matrix,
// pointed at the head and torso instead of the waist.
import { chromium } from "../node_modules/@playwright/test/index.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const url = process.argv[2] ?? "http://localhost:4790";
const output = path.resolve(process.argv[3] ?? "artifacts/wearable-defects");
await mkdir(output, { recursive: true });

const looks = [
  { label: "Visor alone", head: "Visor" },
  { label: "Visor + square glasses", head: "Visor", eyewear: "Square" },
  { label: "Cowboy hat alone", head: "Cowboy hat" },
  { label: "Cowboy hat + aviators", head: "Cowboy hat", eyewear: "Aviators" },
  { label: "Cap + round glasses", head: "Cap", eyewear: "Round" },
  { label: "Helmet + goggles", head: "Helmet", eyewear: "Goggles" },
  { label: "Overalls, bare arms", top: "Overalls" },
  { label: "Harness over T-shirt", top: "T-shirt", outer: "Harness" },
  { label: "Harness over turtleneck", top: "Turtleneck", outer: "Harness" },
  { label: "Turtleneck under poncho (refit)", top: "Turtleneck", outer: "Poncho" },
];

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url, { waitUntil: "networkidle" });
  const start = page.getByRole("button", { name: /Start game/i });
  if (await start.isVisible().catch(() => false)) await start.click();
  await page.getByRole("button", { name: /Build your runner/i }).click();
  await page.getByRole("heading", { name: /Build your runner/i }).waitFor();
  await page.locator(".avatar-figure-shell canvas").waitFor();

  const choose = async (slotLabel, inputName, optionLabel) => {
    await page.getByRole("radio", { name: new RegExp(`^${slotLabel},`) }).click();
    const option = page.locator(`label:has(input[name="${inputName}"])`).filter({
      has: page.locator("span", { hasText: new RegExp(`^${optionLabel}$`) }),
    });
    await option.getByRole("radio").click();
  };

  const cards = [];
  const preview = page.locator(".avatar-figure-shell");
  const turn = async (steps, key) => {
    await preview.evaluate((element, { steps: count, key: pressed }) => {
      for (let index = 0; index < count; index += 1)
        element.dispatchEvent(new KeyboardEvent("keydown", { key: pressed, bubbles: true }));
    }, { steps, key });
  };
  for (const [index, look] of looks.entries()) {
    await choose("Head", "avatar-headwear", look.head ?? "No hat");
    await choose("Eyewear", "avatar-eyewear", look.eyewear ?? "None");
    await choose("Top", "avatar-top", look.top ?? "None");
    await choose("Outer layer", "avatar-outerwear", look.outer ?? "None");
    await page.waitForTimeout(120);
    const stem = String(index + 1).padStart(2, "0");
    const front = `${stem}-front.png`;
    const quarter = `${stem}-quarter.png`;
    const side = `${stem}-side.png`;
    await preview.screenshot({ path: path.join(output, front) });
    await turn(3, "ArrowRight");
    await preview.screenshot({ path: path.join(output, quarter) });
    await turn(3, "ArrowRight");
    await preview.screenshot({ path: path.join(output, side) });
    await turn(6, "ArrowLeft");
    cards.push({ ...look, front, quarter, side });
  }
  if (errors.length > 0) throw new Error(`Runtime errors: ${errors.join(" | ")}`);

  const body = cards.map((card) => `<article><h2>${card.label}</h2><div><img src="${card.front}"><img src="${card.quarter}"><img src="${card.side}"></div></article>`).join("");
  const indexPath = path.join(output, "index.html");
  await writeFile(indexPath, `<!doctype html><meta charset="utf-8"><title>Wearable defect evidence</title><style>body{margin:0;padding:24px;background:#171a2b;color:#fff;font:16px system-ui}main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}article{overflow:hidden;border:2px solid #fff;border-radius:14px;background:#fff8e8;color:#171a2b}h2{margin:0;padding:9px 12px}article div{display:grid;grid-template-columns:1fr 1fr 1fr}img{display:block;width:100%}</style><main>${body}</main>`);
  const review = await browser.newPage({ viewport: { width: 1600, height: 2100 } });
  await review.goto(pathToFileURL(indexPath).href);
  await review.locator("main").screenshot({ path: path.join(output, "sheet.png") });
  console.log(JSON.stringify({ ok: true, looks: looks.length, output }, null, 2));
} finally {
  await browser.close();
}
