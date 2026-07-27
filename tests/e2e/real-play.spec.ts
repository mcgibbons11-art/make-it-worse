import { expect, test } from "@playwright/test";

test("real keyboard movement advances without physics errors", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });

  await page.goto("/");
  await page.getByRole("button", { name: /start a fresh chain/i }).click();
  await page.getByRole("button", { name: /beat it/i }).click();
  await expect
    .poll(() => page.evaluate(() => window.__MIW_TEST__?.getState().phase))
    .toBe("playing");
  await page.waitForTimeout(500);

  await page.keyboard.down("w");
  await expect
    .poll(() => page.evaluate(() => window.__MIW_TEST__?.getState().inputZ ?? 0))
    .toBe(1);
  await page.waitForTimeout(600);
  await page.keyboard.press("Space");
  await page.waitForTimeout(600);
  await page.keyboard.up("w");

  await expect
    .poll(() => page.evaluate(() => window.__MIW_TEST__?.getState().progress ?? 0))
    .toBeGreaterThan(0.035);
  expect(runtimeErrors).toEqual([]);
});

test("licensed trap models load and the demo gauntlet runs without physics errors", async ({
  page,
}) => {
  const runtimeErrors: string[] = [];
  const failedModels: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.url().endsWith(".glb") && response.status() >= 400)
      failedModels.push(`${response.status()} ${response.url()}`);
  });

  await page.goto("/c/demo-disaster");
  await expect(page.getByRole("button", { name: /beat their version/i })).toBeVisible();
  await page.getByRole("button", { name: /beat their version/i }).click();
  await expect
    .poll(() => page.evaluate(() => window.__MIW_TEST__?.getState().phase), {
      timeout: 15_000,
    })
    .toBe("playing");
  await page.waitForTimeout(700);
  await page.keyboard.down("w");
  await expect
    .poll(() => page.evaluate(() => window.__MIW_TEST__?.getState().inputZ ?? 0))
    .toBe(1);
  await page.waitForTimeout(2_500);
  await page.keyboard.up("w");

  await expect
    .poll(() => page.evaluate(() => window.__MIW_TEST__?.getState().lastHazardType))
    .toBe("floor_fan");
  await expect(page.getByText(/floor fan got you/i)).toBeVisible();
  expect(failedModels).toEqual([]);
  expect(runtimeErrors).toEqual([]);
  await page.screenshot({ path: "artifacts/review/demo-gauntlet-assets.png" });
});

test("fixed-step movement remains playable under 4x CPU throttle", async ({ page, context }) => {
  const session = await context.newCDPSession(page);
  await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.goto("/");
  await page.getByRole("button", { name: /start a fresh chain/i }).click();
  const start = page.getByRole("button", { name: /beat it/i });
  await expect(start).toBeEnabled({ timeout: 30_000 });
  await start.click();
  await expect.poll(() => page.evaluate(() => window.__MIW_TEST__?.getState().phase)).toBe("playing");
  await page.keyboard.down("w");
  await page.waitForTimeout(2_500);
  await page.keyboard.up("w");
  await expect.poll(() => page.evaluate(() => window.__MIW_TEST__?.getState().progress ?? 0)).toBeGreaterThan(0.035);
  await session.send("Emulation.setCPUThrottlingRate", { rate: 1 });
});

test("a clean course can be cleared with real keyboard input", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /start a fresh chain/i }).click();
  const start = page.getByRole("button", { name: /beat it/i });
  await expect(start).toBeEnabled({ timeout: 30_000 });
  await start.click();
  await expect.poll(() => page.evaluate(() => window.__MIW_TEST__?.getState().phase)).toBe("playing");
  await page.waitForTimeout(500);
  await expect.poll(() => page.evaluate(() => window.__MIW_TEST__?.getState().grounded)).toBe(true);
  // Verify that a real keyboard edge reaches the controller and applies a
  // physics impulse. The full traversal below is the authoritative physical
  // outcome check; a headless first-frame stall can otherwise simulate an
  // entire jump arc between two 15 Hz telemetry samples.
  const beforeJump = await page.evaluate(() => window.__MIW_TEST__!.getState());
  await page.keyboard.down("w");
  await page.keyboard.press("Space");
  await expect.poll(() => page.evaluate(() => window.__MIW_TEST__?.getState().jumpPressSequence ?? 0)).toBeGreaterThan(beforeJump.jumpPressSequence);
  await expect.poll(() => page.evaluate(() => window.__MIW_TEST__?.getState().jumpAppliedSequence ?? 0)).toBeGreaterThan(beforeJump.jumpAppliedSequence);
  // Continue with ordinary player inputs: jump whenever the runner is grounded
  // so the raised stones, island seam, and finish ramp are all traversed.
  for (let index = 0; index < 48; index += 1) {
    const state = await page.evaluate(() => window.__MIW_TEST__?.getState());
    if (state?.phase === "finished") break;
    expect(state?.phase, JSON.stringify(state)).toBe("playing");
    if (state?.grounded) await page.keyboard.press("Space");
    await page.waitForTimeout(250);
  }
  await page.keyboard.up("w");
  await expect.poll(() => page.evaluate(() => window.__MIW_TEST__?.getState().phase), { timeout: 6_000 }).toBe("finished");
});
