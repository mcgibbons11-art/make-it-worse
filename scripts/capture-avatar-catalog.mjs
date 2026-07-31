import { chromium } from "../node_modules/@playwright/test/index.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const url = process.argv[2] ?? "http://127.0.0.1:4173";
const output = path.resolve(process.argv[3] ?? "artifacts/avatar-catalog");
const resumeAfter = Math.max(0, Number(process.argv[4] ?? 0));
const requestedSlots = new Set(
  (process.argv[5] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
await mkdir(output, { recursive: true });

const slots = [
  ["headwear", "Head"],
  ["hair", "Hair"],
  ["face", "Face"],
  ["eyewear", "Eyewear"],
  ["top", "Top"],
  ["outerwear", "Outer layer"],
  ["legwear", "Legs"],
  ["footwear", "Feet"],
  ["backpack", "Back"],
  ["held", "In hand"],
];
const captureSlots = requestedSlots.size > 0
  ? slots.filter(([id]) => requestedSlots.has(id))
  : slots;
if (captureSlots.length === 0)
  throw new Error(`No wardrobe slots matched: ${[...requestedSlots].join(", ")}`);

const safeName = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (error) => console.error("pageerror:", error.message));
  await page.goto(url, { waitUntil: "networkidle" });
  const start = page.getByRole("button", { name: /Start game/i });
  if (await start.isVisible().catch(() => false)) await start.click();
  await page.getByRole("button", { name: /Build your runner/i }).click();
  await page.getByRole("heading", { name: /Build your runner/i }).waitFor();
  await page.locator(".avatar-figure-shell canvas").waitFor();
  await page.waitForTimeout(900);

  // Begin with a bare runner so every sheet judges the named choice rather
  // than a leftover combination from the previous category.
  for (const [id, label] of slots) {
    await page.getByRole("radio", { name: new RegExp(`^${label},`) }).click();
    await page.locator(`input[name="avatar-${id}"]`).first().click();
  }

  const cards = [];
  let ordinal = 0;
  for (const [id, label] of captureSlots) {
    await page.getByRole("radio", { name: new RegExp(`^${label},`) }).click();
    const choices = page.locator(`input[name="avatar-${id}"]`);
    const count = await choices.count();
    for (let index = 1; index < count; index += 1) {
      ordinal += 1;
      const choice = choices.nth(index);
      const optionLabel = (await choice.locator("xpath=following-sibling::span").textContent())?.trim()
        ?? `${label} ${index}`;
      const stem = `${String(ordinal).padStart(3, "0")}-${safeName(id)}-${safeName(optionLabel)}`;
      const front = `${stem}-front.png`;
      const side = `${stem}-side.png`;
      cards.push({ slot: label, label: optionLabel, front, side });
      if (ordinal <= resumeAfter) continue;
      await choice.click();
      await page.waitForTimeout(70);
      const preview = page.locator(".avatar-figure-shell");
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
      if (ordinal % 10 === 0) console.log(`captured ${ordinal}`);
    }
    // Keep the next category isolated.
    await choices.first().click();
  }

  const sections = captureSlots.map(([, label]) => {
    const items = cards.filter((card) => card.slot === label).map((card) => `
      <article><h2>${card.label}</h2><div><img src="${card.front}" alt="${card.label}, front"><img src="${card.side}" alt="${card.label}, side"></div></article>`).join("");
    return `<section><h1>${label}</h1><main>${items}</main></section>`;
  }).join("");
  await writeFile(path.join(output, "index.html"), `<!doctype html><meta charset="utf-8"><title>Avatar catalog review</title><style>
    body{margin:0;padding:28px;background:#171a2b;color:#fff;font:16px system-ui}section{margin-bottom:42px}h1{margin:0 0 14px;padding:10px 14px;border-radius:12px;background:#ffd84d;color:#171a2b}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}article{overflow:hidden;border:2px solid #fff;border-radius:14px;background:#fff8e8;color:#171a2b}h2{margin:0;padding:8px 12px;font-size:1rem}article div{display:grid;grid-template-columns:1fr 1fr}img{display:block;width:100%;height:auto}</style>${sections}`);
  await page.setViewportSize({ width: 1800, height: 1200 });
  await page.goto(pathToFileURL(path.join(output, "index.html")).href, { waitUntil: "load" });
  const sheetSections = page.locator("body > section");
  for (let index = 0; index < captureSlots.length; index += 1)
    await sheetSections.nth(index).screenshot({
      path: path.join(output, `sheet-${String(index + 1).padStart(2, "0")}-${safeName(captureSlots[index][1])}.png`),
    });
  console.log(`${cards.length} visible items indexed in ${output}`);
} finally {
  await browser.close();
}
