import { expect, test } from "@playwright/test";

// Every prop is authored in code (components/game/AssetModel.tsx and the
// procedural factories under components/game/models). Nothing calls useGLTF and
// public/assets/models holds no mesh, so a request for one of these means an
// artist file crept back into the build and the "drawn in code" claim below is
// no longer true.
const MODEL_FILE = /\.(glb|gltf|fbx|obj|bin)$/i;

test("the whole trap roster renders from code with no downloaded model art", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const runtimeErrors: string[] = [];
  const modelRequests: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  page.on("request", (request) => {
    if (MODEL_FILE.test(new URL(request.url()).pathname))
      modelRequests.push(request.url());
  });

  await page.goto("/dev/sandbox");
  await expect(page.getByText("ALL-TRAP QA SANDBOX")).toBeVisible();
  // The banner reads "<built> of <roster> obstacles loaded" and every placement
  // is validated on the way in, so the two numbers matching is the proof that
  // the whole roster is in the scene rather than a claim about it. Matching
  // them against each other keeps this true when the roster grows.
  await expect(page.getByText(/(\d+) of \1 obstacles loaded/i)).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          Boolean(window.__MIW_SANDBOX__?.getState().player),
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
  // Traps with a rigid body have to reach the physics world, not merely mount.
  await expect
    .poll(() =>
      page.evaluate(
        () => Object.keys(window.__MIW_SANDBOX__?.getState().traps ?? {}).length,
      ),
    )
    .toBeGreaterThan(0);

  // Grabbing and throwing the dynamic beach ball is covered in the isolated
  // trap-mechanics suite. Repeating it here made this render smoke depend on
  // whether one of the other fifty-four live traps knocked it away first.
  await page.waitForTimeout(500);
  expect(modelRequests).toEqual([]);
  expect(runtimeErrors).toEqual([]);
  await page.screenshot({ path: "artifacts/review/all-trap-sandbox.png" });
});
