import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
const reviewDir = path.resolve("artifacts/review");
mkdirSync(reviewDir, { recursive: true });
test("capture desktop art direction", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /make it worse/i }),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(reviewDir, "home-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: /start a fresh chain/i }).click();
  await expect(page.getByRole("button", { name: /beat it/i })).toBeVisible();
  await page.waitForTimeout(900);
  await page.screenshot({
    path: path.join(reviewDir, "challenge-intro-desktop.png"),
  });
});
test("capture mobile hierarchy", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /start a fresh chain/i }),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(reviewDir, "home-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: /start a fresh chain/i }).click();
  await expect(page.getByRole("button", { name: /beat it/i })).toBeVisible();
  await page.waitForTimeout(900);
  await page.screenshot({
    path: path.join(reviewDir, "challenge-intro-mobile.png"),
  });
});
