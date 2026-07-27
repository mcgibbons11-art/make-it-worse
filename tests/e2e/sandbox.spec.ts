import { expect, test } from "@playwright/test";

test("all eight release trap visuals render together without runtime errors", async ({
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

  await page.goto("/dev/sandbox");
  await expect(page.getByText("ALL-TRAP QA SANDBOX")).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          [...new Set(
            performance
              .getEntriesByType("resource")
              .filter((entry) => entry.name.endsWith(".glb"))
              .map((entry) => new URL(entry.name).pathname.split("/").at(-1)),
          )].sort(),
        ),
      { timeout: 30_000 },
    )
    .toEqual([
      "beach_ball.glb",
      "cartoon_hammer.glb",
      "duck_soap_dish.glb",
      "jump_pad.glb",
      "refrigerator.glb",
      "standing_fan.glb",
      "toilet.glb",
    ]);

  await page.waitForTimeout(500);
  await page.keyboard.down("e");
  await page.keyboard.down("w");
  await expect
    .poll(async () => JSON.parse(await page.getByLabel("Sandbox interaction telemetry").textContent() || "{}").holdingObject)
    .toBe(true);
  await page.keyboard.up("w");
  await page.waitForTimeout(450);
  await page.keyboard.up("e");
  await expect
    .poll(async () => JSON.parse(await page.getByLabel("Sandbox interaction telemetry").textContent() || "{}").holdingObject)
    .toBe(false);
  await expect
    .poll(async () => JSON.parse(await page.getByLabel("Sandbox interaction telemetry").textContent() || "{}").releasedObjectSpeed ?? 0)
    .toBeGreaterThan(1);
  expect(failedModels).toEqual([]);
  expect(runtimeErrors).toEqual([]);
  await page.screenshot({ path: "artifacts/review/all-trap-sandbox.png" });
});
