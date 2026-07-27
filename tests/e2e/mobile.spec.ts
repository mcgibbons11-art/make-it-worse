import { expect, test } from "@playwright/test";
test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});
test("mobile controls and editor remain reachable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /start a fresh chain/i }).click();
  await page.getByRole("button", { name: /beat it/i }).click();
  await expect
    .poll(() => page.evaluate(() => window.__MIW_TEST__?.getState().phase))
    .toBe("playing");
  await expect
    .poll(() => page.evaluate(() => window.__MIW_TEST__?.getState().grounded))
    .toBe(true);
  await page.waitForTimeout(400);
  await expect(page.getByLabel("Touch game controls")).toBeVisible();
  await expect(page.getByRole("button", { name: "Jump" })).toBeVisible();
  const beforeJump = await page.evaluate(() => window.__MIW_TEST__!.getState());
  await page.getByRole("button", { name: "Jump" }).tap();
  await expect
    .poll(() => page.evaluate(() => window.__MIW_TEST__?.getState().jumpPressSequence ?? 0))
    .toBe(beforeJump.jumpPressSequence + 1);
  await expect
    .poll(() => page.evaluate(() => window.__MIW_TEST__?.getState().jumpAppliedSequence ?? 0))
    .toBeGreaterThan(beforeJump.jumpAppliedSequence);
  await page.evaluate(() => window.__MIW_TEST__!.completeAttempt());
  await page.getByRole("button", { name: /make it worse/i }).click();
  const offered = await page.evaluate(
    () => window.__MIW_TEST__!.getState().offeredTraps!,
  );
  await page.evaluate(
    (type) => window.__MIW_TEST__!.selectTrap(type),
    offered[0]!,
  );
  await expect(
    page.getByRole("button", { name: /add this trap/i }),
  ).toBeVisible();
});
