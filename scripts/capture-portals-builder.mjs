import { chromium } from "../node_modules/@playwright/test/index.mjs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const url = process.argv[2] ?? "http://127.0.0.1:4173";
const output = path.resolve(process.argv[3] ?? "artifacts/portals-polish");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url, { waitUntil: "networkidle" });
  const start = page.getByRole("button", { name: /Start game/i });
  if (await start.isVisible().catch(() => false)) await start.click();
  await page.getByRole("button", { name: /Build your game/i }).click();
  await page.getByRole("button", { name: /Test map/i }).waitFor();
  await page.waitForTimeout(1200);
  const target = path.join(output, "custom-builder.png");
  await page.screenshot({ path: target });
  console.log(target);
} finally {
  await browser.close();
}
