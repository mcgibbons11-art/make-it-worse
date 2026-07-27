import { expect, test } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase("make-it-worse-v1");
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      }),
  );
  await page.reload();
});
test("complete viral loop publishes exactly one additional trap", async ({
  page,
}) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  await page.getByRole("button", { name: /start a fresh chain/i }).click();
  await expect(page).toHaveURL(/\/c\/fresh-/);
  await page.getByRole("button", { name: /beat it/i }).click();
  await expect
    .poll(() => page.evaluate(() => window.__MIW_TEST__?.getState().phase))
    .toBe("playing");
  await page.evaluate(() => window.__MIW_TEST__!.completeAttempt());
  await expect(page.getByText("YOU SURVIVED")).toBeVisible();
  await page.getByRole("button", { name: /make it worse/i }).click();
  await expect
    .poll(() => page.evaluate(() => window.__MIW_TEST__?.getState().phase))
    .toBe("choosing_trap");
  await page.locator(".trap-card").first().click();
  await expect
    .poll(() => page.evaluate(() => window.__MIW_TEST__?.getState().phase))
    .toBe("placing_trap");
  const initialPlacement = await page.evaluate(
    () => window.__MIW_TEST__!.getState().placement,
  );
  expect(initialPlacement).not.toBeNull();
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const zoneAnchor = await page.getByTestId("selected-zone-anchor").boundingBox();
  expect(zoneAnchor).not.toBeNull();
  const startX = zoneAnchor!.x + zoneAnchor!.width / 2;
  const startY = zoneAnchor!.y + zoneAnchor!.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 10, startY, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const placement = window.__MIW_TEST__?.getState().placement;
        return placement
          ? `${placement.zoneId}:${placement.offsetX}:${placement.offsetZ}`
          : null;
      }),
    )
    .not.toBe(
      `${initialPlacement!.zoneId}:${initialPlacement!.offsetX}:${initialPlacement!.offsetZ}`,
    );
  const addTrap = page.getByRole("button", { name: /add this trap/i });
  await expect(addTrap).toBeEnabled();
  await addTrap.click();
  await expect(page.getByText(/you made it \d+% worse/i)).toBeVisible();
  const child = await page.evaluate(() => window.__MIW_TEST__!.getState());
  expect(child.depth).toBe(0);
  const playButton = page.getByRole("button", { name: /play your version/i });
  await playButton.click();
  await expect(page).toHaveURL(/\/c\/worse-/);
  await expect
    .poll(() => page.evaluate(() => window.__MIW_TEST__?.getState().depth))
    .toBe(1);
  await expect
    .poll(() => page.evaluate(() => window.__MIW_TEST__?.getState().trapCount))
    .toBe(1);
  await expect(
    page.getByRole("button", { name: /beat their version/i }),
  ).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});
test("failure retries without a page reload", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.getByRole("button", { name: /start a fresh chain/i }).click();
  await page.getByRole("button", { name: /beat it/i }).click();
  await expect
    .poll(() => page.evaluate(() => window.__MIW_TEST__?.getState().phase))
    .toBe("playing");
  const before = page.url();
  await page.evaluate(() => window.__MIW_TEST__!.failAttempt("void"));
  await expect(page.getByText(/void got you/i)).toBeVisible();
  await page.getByRole("button", { name: /try again/i }).click();
  await expect
    .poll(() => page.evaluate(() => window.__MIW_TEST__?.getState().phase))
    .toBe("playing");
  expect(page.url()).toBe(before);
  expect(runtimeErrors).toEqual([]);
});
