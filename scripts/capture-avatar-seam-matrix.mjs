import { chromium } from "../node_modules/@playwright/test/index.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const url = process.argv[2] ?? "http://127.0.0.1:4173";
const output = path.resolve(process.argv[3] ?? "artifacts/avatar-seam-matrix");
await mkdir(output, { recursive: true });

const outfits = [
  { label: "Naked None state", top: "None", legs: "None", outer: "None" },
  { label: "T-shirt + jeans", top: "T-shirt", legs: "Jeans", outer: "None" },
  { label: "Tank top + shorts", top: "Tank top", legs: "Shorts", outer: "None" },
  { label: "Hoodie + joggers", top: "None", legs: "Joggers", outer: "Hoodie" },
  { label: "Stripes + cargo pants", top: "Stripes", legs: "Cargo pants", outer: "None" },
  { label: "Jersey + kilt", top: "Jersey", legs: "Kilt", outer: "None" },
  { label: "Turtleneck + tights", top: "Turtleneck", legs: "Tights", outer: "None" },
  { label: "T-shirt under jacket", top: "T-shirt", legs: "Jeans", outer: "Jacket" },
  { label: "T-shirt under hoodie", top: "T-shirt", legs: "Jeans", outer: "Hoodie" },
  { label: "T-shirt under puffer", top: "T-shirt", legs: "Joggers", outer: "Puffer" },
  { label: "Tank under vest", top: "Tank top", legs: "Shorts", outer: "Vest" },
  { label: "Turtleneck under poncho", top: "Turtleneck", legs: "Tights", outer: "Poncho" },
  { label: "Stripes under harness", top: "Stripes", legs: "Cargo pants", outer: "Harness" },
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

  // Isolate the waist/foot evidence from hats, packs and props.
  for (const [slotLabel, inputName] of [
    ["Head", "avatar-headwear"], ["Hair", "avatar-hair"],
    ["Face", "avatar-face"], ["Eyewear", "avatar-eyewear"],
    ["Outer layer", "avatar-outerwear"], ["Back", "avatar-backpack"],
    ["In hand", "avatar-held"], ["Feet", "avatar-footwear"],
  ]) {
    await page.getByRole("radio", { name: new RegExp(`^${slotLabel},`) }).click();
    await page.locator(`input[name="${inputName}"]`).first().click();
  }

  const cards = [];
  const preview = page.locator(".avatar-figure-shell");
  for (const [index, outfit] of outfits.entries()) {
    await choose("Top", "avatar-top", outfit.top);
    await choose("Legs", "avatar-legwear", outfit.legs);
    await choose("Outer layer", "avatar-outerwear", outfit.outer);
    await page.waitForTimeout(120);
    const front = `${String(index + 1).padStart(2, "0")}-front.png`;
    const side = `${String(index + 1).padStart(2, "0")}-side.png`;
    await preview.screenshot({ path: path.join(output, front) });
    await preview.evaluate((element) => {
      for (let turn = 0; turn < 6; turn += 1)
        element.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    await preview.screenshot({ path: path.join(output, side) });
    await preview.evaluate((element) => {
      for (let turn = 0; turn < 6; turn += 1)
        element.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
    cards.push({ ...outfit, front, side });
  }
  if (errors.length > 0) throw new Error(`Runtime errors: ${errors.join(" | ")}`);

  const body = cards.map((card) => `<article><h2>${card.label}</h2><div><img src="${card.front}"><img src="${card.side}"></div></article>`).join("");
  const indexPath = path.join(output, "index.html");
  await writeFile(indexPath, `<!doctype html><meta charset="utf-8"><title>Waist and feet acceptance</title><style>body{margin:0;padding:24px;background:#171a2b;color:#fff;font:16px system-ui}main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}article{overflow:hidden;border:2px solid #fff;border-radius:14px;background:#fff8e8;color:#171a2b}h2{margin:0;padding:9px 12px}article div{display:grid;grid-template-columns:1fr 1fr}img{display:block;width:100%}</style><main>${body}</main>`);
  const review = await browser.newPage({ viewport: { width: 1600, height: 1500 } });
  await review.goto(pathToFileURL(indexPath).href);
  await review.locator("main").screenshot({ path: path.join(output, "sheet.png") });
  console.log(JSON.stringify({ ok: true, outfits: outfits.length, output }, null, 2));
} finally {
  await browser.close();
}
