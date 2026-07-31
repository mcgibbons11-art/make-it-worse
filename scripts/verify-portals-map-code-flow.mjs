import assert from "node:assert/strict";
import { chromium } from "../node_modules/@playwright/test/index.mjs";

const url = process.argv[2] ?? "http://127.0.0.1:4173";
const origin = new URL(url).origin;
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

function decodeBase64Url(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

async function freshContext() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  await context.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  return context;
}

async function openMenu(page) {
  await page.goto(url, { waitUntil: "networkidle" });
  const start = page.getByRole("button", { name: /Start game/i });
  if (await start.isVisible().catch(() => false)) await start.click();
  await page.getByRole("button", { name: /Play a clean level/i }).waitFor();
}

try {
  const creatorContext = await freshContext();
  const creator = await creatorContext.newPage();
  await openMenu(creator);
  await creator.getByRole("button", { name: /Build your game/i }).click();
  await creator.getByRole("button", { name: /Test map/i }).waitFor();

  // Give the authored room one unmistakable runtime trap before publishing.
  await creator.getByRole("button", { name: "Floor Fan", exact: true }).click();
  await creator.getByRole("button", { name: /Publish$/i }).click();
  const title = `Portals exact map ${Date.now().toString(36)}`;
  await creator.getByLabel("Title").fill(title);
  await creator.getByRole("button", { name: /Publish & copy code/i }).click();
  await creator.getByText(/Published map code copied/i).waitFor();

  const publishedCode = await creator.evaluate(() => navigator.clipboard.readText());
  assert.ok(publishedCode.startsWith("MIW-MAP-1."), "Publish did not copy a published-map code");

  const publishedParts = publishedCode.split(".");
  assert.equal(publishedParts.length, 3, "Published-map envelope is malformed");
  const metadata = decodeBase64Url(publishedParts[1]);
  const payload = decodeBase64Url(publishedParts[2]);
  assert.equal(metadata[0], title);
  assert.equal(payload[0], 5, "Authored room did not use the version-5 runtime envelope");
  assert.equal(payload[6].length, 1, "Published room did not contain the placed trap exactly once");
  assert.equal(payload[7][0].length, 2, "Published room changed its two required platforms");
  assert.deepEqual(payload[7][2], [0, 1.25, 2], "Published spawn moved during encoding");
  assert.deepEqual(payload[7][3], [0, 1.5, -6], "Published finish moved during encoding");

  // Copying from My Maps must return the immutable code without republishing.
  await creator.evaluate(() => navigator.clipboard.writeText(""));
  await creator.getByRole("button", { name: /My maps/i }).click();
  await creator.getByRole("button", { name: /Copy Code/i }).click();
  await creator.getByText(/Published map code copied/i).waitFor();
  const recopiedCode = await creator.evaluate(() => navigator.clipboard.readText());
  assert.equal(recopiedCode, publishedCode, "My Maps changed the already-published code");

  // A completely separate browser profile is the cross-session recipient.
  const recipientContext = await freshContext();
  const recipient = await recipientContext.newPage();
  await openMenu(recipient);
  await recipient.getByRole("button", { name: /Use map code/i }).click();
  await recipient.getByRole("textbox", { name: "Map code" }).fill(publishedCode);
  await recipient.getByRole("button", { name: /Load this map/i }).click();
  await recipient.getByRole("button", { name: /Beat their version/i }).waitFor();

  const introActions = await recipient.locator(".portals-buttons button").allTextContents();
  assert.ok(introActions.some((text) => text.includes("🎨") && /runner/i.test(text)));
  assert.ok(introActions.some((text) => text.includes("🏠") && /main menu/i.test(text)));
  const primary = await recipient.getByRole("button", { name: /Beat their version/i }).textContent();
  assert.ok(primary?.includes("🏃"), "Shared-room primary action lost its emoji");

  const remembered = await recipient.evaluate(() =>
    JSON.parse(localStorage.getItem("miw.portals-published-maps.v1") ?? "[]"),
  );
  assert.deepEqual(remembered, [publishedCode], "Recipient did not remember the exact imported version");

  await recipient.getByRole("button", { name: /Beat their version/i }).click();
  await recipient.locator(".game-hud").waitFor();
  assert.equal(
    await recipient.locator(".hud-pill.depth").textContent(),
    "DISASTER 1",
    "Recipient did not start the one-trap authored room",
  );

  // Deleting the creator's local listing must not invalidate a copied code.
  await creator.getByRole("button", { name: /Delete/i }).click();
  await creator.getByRole("button", { name: /Delete saved map/i }).click();
  await creator.getByText(/Deleted the saved copy/i).waitFor();
  const creatorCatalog = await creator.evaluate(() =>
    JSON.parse(localStorage.getItem("miw.portals-published-maps.v1") ?? "[]"),
  );
  assert.deepEqual(creatorCatalog, []);
  assert.deepEqual(
    await recipient.evaluate(() =>
      JSON.parse(localStorage.getItem("miw.portals-published-maps.v1") ?? "[]"),
    ),
    [publishedCode],
    "Creator deletion invalidated the recipient's immutable copy",
  );

  await creatorContext.close();
  await recipientContext.close();
  console.log(JSON.stringify({
    ok: true,
    title,
    codeLength: publishedCode.length,
    traps: payload[6].length,
    pieces: payload[7][0].length,
    checks: 18,
  }, null, 2));
} finally {
  await browser.close();
}
