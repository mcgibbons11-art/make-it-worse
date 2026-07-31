import assert from "node:assert/strict";
import { chromium } from "../node_modules/@playwright/test/index.mjs";

const url = process.argv[2] ?? "http://127.0.0.1:4173";
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

async function viewportAudit(viewport) {
  const context = await browser.newContext({ viewport, isMobile: viewport.width < 600, hasTouch: true });
  await context.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openMenu(page);

  const pageWidth = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth,
    offenders: [...document.querySelectorAll("*")].flatMap((element) => {
      const rect = element.getBoundingClientRect();
      return rect.right > innerWidth + 1 || rect.left < -1
        ? [`${element.tagName.toLowerCase()}.${element.className}:${rect.left.toFixed(0)}..${rect.right.toFixed(0)}`]
        : [];
    }).slice(0, 8),
  }));
  assert.ok(
    pageWidth.scrollWidth <= pageWidth.innerWidth + 1,
    `${viewport.width}x${viewport.height} menu overflows horizontally: ${JSON.stringify(pageWidth)}`,
  );
  for (const label of [/Play a clean level/i, /Trending games/i, /Use map code/i, /Build your runner/i, /Visit your apartment/i, /Build your game/i])
    assert.equal(await page.getByRole("button", { name: label }).count(), 1, `Missing ${label}`);

  await page.getByRole("button", { name: /Build your runner/i }).click();
  await page.getByRole("heading", { name: /Build your runner/i }).waitFor();
  await page.getByRole("button", { name: /Randomize/i }).click();
  await page.getByRole("button", { name: /This one is mine/i }).click();
  await page.getByRole("button", { name: /Build your runner/i }).waitFor();

  await page.getByRole("button", { name: /Visit your apartment/i }).click();
  await page.getByRole("button", { name: /Decorate/i }).waitFor();
  await page.waitForTimeout(3500);
  await page.getByRole("button", { name: /Decorate/i }).click();
  const catalog = page.locator(".avatar-apartment-decor");
  await catalog.waitFor();
  assert.equal(await catalog.evaluate((element) => element.scrollHeight > element.clientHeight), true);
  await catalog.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  assert.ok(await page.getByRole("button", { name: /Floor fan/i }).isVisible());
  await page.getByRole("button", { name: /Back to menu/i }).click();

  await page.getByRole("button", { name: /Build your game/i }).click();
  await page.getByRole("button", { name: /Test map/i }).waitFor();
  await page.getByRole("button", { name: "Floor Fan", exact: true }).click();
  await page.keyboard.press("Control+KeyC");
  await page.keyboard.press("Control+KeyV");
  await page.waitForFunction(() =>
    JSON.parse(localStorage.getItem("miw.room-builder.v2") ?? "[]").length === 6,
  );
  await page.keyboard.press("Delete");
  await page.waitForFunction(() =>
    JSON.parse(localStorage.getItem("miw.room-builder.v2") ?? "[]").length === 5,
  );
  await page.getByRole("button", { name: /Menu/i }).click();

  await page.getByRole("button", { name: /Play a clean level/i }).click();
  await page.locator(".game-hud").waitFor();
  assert.equal(await page.locator(".onboard-progress").count(), 1);
  assert.equal(errors.length, 0, errors.join("\n"));
  await context.close();
}

try {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) await viewportAudit(viewport);
  console.log(JSON.stringify({ ok: true, viewports: ["390x844", "768x1024", "1440x900"], checks: 45 }, null, 2));
} finally {
  await browser.close();
}
