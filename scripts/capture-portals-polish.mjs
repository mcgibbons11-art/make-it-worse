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

async function openMenu(page) {
  await page.goto(url, { waitUntil: "networkidle" });
  const start = page.getByRole("button", { name: /Start game/i });
  if (await start.isVisible().catch(() => false)) await start.click();
  await page.getByRole("button", { name: /Play a clean level/i }).waitFor();
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (error) => console.error("pageerror:", error.message));
  await openMenu(page);
  await page.screenshot({ path: path.join(output, "main-menu.png") });

  await page.getByRole("button", { name: /Build your runner/i }).click();
  await page.getByRole("heading", { name: /Build your runner/i }).waitFor();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(output, "avatar-default.png") });
  await page.getByRole("button", { name: /Randomize/i }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(output, "avatar-random.png") });
  await page.getByRole("button", { name: /Cancel/i }).click();

  await page.getByRole("button", { name: /Visit your apartment/i }).click();
  await page.getByRole("button", { name: /Decorate/i }).waitFor();
  // The apartment is the heaviest lazy-loaded scene. Give both the chunk and
  // its generated furnishings time to settle before judging the camera view.
  await page.waitForTimeout(4500);
  await page.screenshot({ path: path.join(output, "apartment-explore.png") });
  await page.getByRole("button", { name: /Decorate/i }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(output, "apartment-decorate.png") });
  await page.getByRole("button", { name: /Back to menu/i }).click();

  await page.getByRole("button", { name: /Build your game/i }).click();
  await page.getByRole("button", { name: /Test map/i }).waitFor();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(output, "custom-builder.png") });
  await page.getByRole("button", { name: /Menu/i }).click();

  await page.getByRole("button", { name: /Play a clean level/i }).click();
  await page.locator(".game-canvas canvas").waitFor({ state: "visible" });
  await page.locator(".game-hud").waitFor({ state: "visible" });
  await page.waitForTimeout(3200);
  await page.screenshot({ path: path.join(output, "clean-play.png") });

  console.log(output);
} finally {
  await browser.close();
}
