import { expect, test } from "@playwright/test";
test("home explains the game and creates a fresh chain", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /make it worse/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /start a fresh chain/i }),
  ).toBeVisible();
  await page.getByRole("button", { name: /start a fresh chain/i }).click();
  await expect(page).toHaveURL(/\/c\/fresh-/);
  await expect(page.getByRole("button", { name: /beat it/i })).toBeVisible({ timeout: 30_000 });
  expect(errors).toEqual([]);
});
test("privacy, terms, and health surfaces work", async ({ page }) => {
  await page.goto("/privacy");
  await expect(
    page.getByRole("heading", { name: /small data/i }),
  ).toBeVisible();
  await page.goto("/terms");
  await expect(
    page.getByRole("heading", { name: /make the level worse/i }),
  ).toBeVisible();
  const response = await page.request.get("/api/health");
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ ok: true, mode: "demo" });
});
