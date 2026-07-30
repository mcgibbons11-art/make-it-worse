import { expect, test } from "@playwright/test";
import { cleanKeyboardCourseUrl } from "./fixtures/shared-course";

test("desktop browser WebGL gameplay can clear the clean course", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });

  // Random clean rooms may bend or branch, so holding W is not a valid driver
  // for them. This self-contained clean room is deterministic but still runs
  // through the production link importer, composed geometry, controller,
  // Rapier simulation, jump edges, and finish sensor in every browser.
  await page.goto(cleanKeyboardCourseUrl());
  const start = page.getByRole("button", { name: /beat it/i });
  await expect(start).toBeEnabled({ timeout: 60_000 });
  await start.click();
  await expect
    .poll(() => page.evaluate(() => window.__MIW_TEST__?.getState().phase))
    .toBe("playing");
  await expect
    .poll(() => page.evaluate(() => window.__MIW_TEST__?.getState().grounded))
    .toBe(true);

  await page.keyboard.down("w");
  for (let index = 0; index < 64; index += 1) {
    const state = await page.evaluate(() => window.__MIW_TEST__?.getState());
    if (state?.phase === "finished") break;
    expect(state?.phase, JSON.stringify(state)).toBe("playing");
    if (state?.grounded) await page.keyboard.press("Space");
    await page.waitForTimeout(250);
  }
  await page.keyboard.up("w");

  await expect
    .poll(() => page.evaluate(() => window.__MIW_TEST__?.getState().phase), {
      timeout: 6_000,
    })
    .toBe("finished");
  expect(runtimeErrors).toEqual([]);
});
