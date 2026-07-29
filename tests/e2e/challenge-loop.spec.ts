import { expect, test, type Page } from "@playwright/test";
import { CONSEQUENCE_HEADLINE } from "@/lib/game/share-copy";

/**
 * How long the run may take to actually start, on a COLD production route.
 *
 * This is the budget these two specs were failing on, and the failure looked
 * like a lie from the test hook: expect.poll received "intro" for its whole 5s
 * default while the page snapshot at failure showed the clock running and "Run
 * started" announced, so the obvious reading was that
 * window.__MIW_TEST__.getState() had closed over a stale phase.
 *
 * It had not. Instrumented against a production build, the hook and the store
 * were sampled side by side fifty times across the transition and disagreed
 * ZERO times. The hook was honest; the phase simply had not changed yet:
 *
 *   first hit of /c/[slug] on a freshly started server .... 13,492 ms
 *   same route once the server is warm ..................... 2,420 ms
 *   Playwright's expect.poll default ....................... 5,000 ms
 *
 * The cold number is the one that matters, because a fresh `next build` plus
 * `next start` is exactly what runs these specs. A heartbeat installed in the
 * page found no main-thread block over 250 ms on the warm path, so this is
 * first-hit cost - route bundle, R3F scene and the physics WASM coming up under
 * software rendering - not a hang.
 *
 * So the predicate was wrong, not the hook and not the game. Sized well over
 * the measured cold figure because that figure is from one machine and CI is
 * usually slower; a poll costs nothing when it passes, and the 45s per-test
 * timeout in playwright.config.ts still catches a genuine stall.
 */
const RUN_START_TIMEOUT = 30_000;

/**
 * These two walk the whole loop, and the whole loop does not fit in the 45s
 * default from playwright.config.ts on a cold production route.
 *
 * Measured after the predicate above was fixed: the first spec reached 52.3s
 * and the second a full minute, both dying on the per-test budget rather than
 * on any assertion. Roughly 13.5s of that is the first hit of /c/[slug], and
 * the rest is scene transitions under software rendering - the trap-choice
 * screen in particular blocks the main thread long enough that a click which
 * has already passed every actionability check sits waiting to be dispatched.
 *
 * Scoped to this file on purpose rather than raised in playwright.config.ts:
 * no other spec walks this many transitions, and the 45s default is worth
 * keeping as a stall detector everywhere else.
 */
test.describe.configure({ timeout: 120_000 });

const phaseOf = (page: Page) =>
  page.evaluate(() => window.__MIW_TEST__?.getState().phase);

/**
 * Wait for the phase to LEAVE `from`, and report whichever phase it landed on.
 *
 * Diagnostic rather than corrective, and the distinction is the point. Polling
 * straight for "playing" cannot tell a run that started late from a run that
 * started and then died: both spend the whole budget not being "playing", and
 * both report the same timeout with nothing in it to act on. That is what sent
 * this task off after a stale test hook which turned out to be honest.
 *
 * A run CAN die on the way in. While the main thread is stalled,
 * @react-three/rapier clamps each frame delta to 0.5s, so every frame that
 * finally runs steps up to half a second of unattended simulation; across a
 * sequence of stall frames the runner can fall, and the phase goes
 * intro -> playing -> failed before any poll observes "playing". No timeout is
 * patient enough to catch that, because the value being waited for has already
 * been and gone.
 *
 * So the wait asks only for movement, and the caller asserts on where it
 * arrived. A dying run then fails as `Expected "playing", Received "failed"` -
 * a named outcome someone can act on - instead of as a timeout. The value the
 * poll settled on is captured inside the predicate rather than re-read after
 * it, so a phase that moves again in between cannot be mistaken for the one
 * that satisfied the wait.
 */
async function phaseAfterLeaving(
  page: Page,
  from: string,
): Promise<string | undefined> {
  let landed: string | undefined;
  await expect
    .poll(
      async () => {
        landed = await phaseOf(page);
        return landed;
      },
      { timeout: RUN_START_TIMEOUT },
    )
    .not.toBe(from);
  return landed;
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  // Warm /c/[slug] before anything is measured.
  //
  // The first hit of this route costs 13,492 ms against 2,420 ms warm - both
  // measured on a production build - and paying that inside the test put it
  // inside a phase predicate, which is what made these two specs look like the
  // test hook was reporting a stale phase. It was not: the hook and the store
  // were sampled side by side fifty times across the transition and disagreed
  // zero times. The phase simply had not changed yet.
  //
  // Moving the cost here is worth more than the seconds it saves. While the
  // main thread is stalled, @react-three/rapier clamps each frame delta to
  // 0.5s, so every frame that finally gets to run steps up to half a second of
  // unattended simulation; across a sequence of stall frames that is enough for
  // the runner to fall, and the phase can go intro -> playing -> failed before
  // any poll sees "playing". A predicate cannot be made patient enough to
  // survive that, which is why the budget alone did not settle it.
  //
  // A slug that does not exist is deliberate: it warms the route and its bundle
  // without minting a chain, and the fixture below wipes the database
  // afterwards so nothing this touched survives into the test.
  await page.goto("/c/warm-the-route-not-a-real-challenge");
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
  expect(
    await phaseAfterLeaving(page, "intro"),
    "the run left the intro but did not reach playing",
  ).toBe("playing");
  await page.evaluate(() => window.__MIW_TEST__!.completeAttempt());
  // By role, not by text. GameClient renders an aria-live region carrying the
  // same sentence for screen readers - "You survived in 00:06.98. Choose a trap
  // to add." - so a substring match finds the card AND the announcement and
  // fails strict mode on two elements. This was invisible for as long as the
  // phase predicate above timed out first. Asking for the heading is narrower
  // than the text match it replaces, not looser.
  await expect(page.getByRole("heading", { name: "YOU SURVIVED" })).toBeVisible();
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
  // The reward screen, asserted on what it says NOW. This waited for "you made
  // it N% worse", which share-copy.ts records as deliberately retired: that
  // headline handed the player a small number as the payoff for the whole loop,
  // so the screen leads with what they did instead and keeps the number as a
  // caption. The spec was never updated, so it was waiting for copy the app had
  // stopped rendering - a stale assertion, not a broken app.
  //
  // Both halves are checked, because the percentage is the part this test is
  // really about: it is the one screen that reports the trap actually landed.
  await expect(
    page.getByRole("heading", { name: CONSEQUENCE_HEADLINE }),
  ).toBeVisible();
  await expect(page.locator(".worse-number")).toHaveText(/^\d+%$/);
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
  expect(
    await phaseAfterLeaving(page, "intro"),
    "the run left the intro but did not reach playing",
  ).toBe("playing");
  const before = page.url();
  await page.evaluate(() => window.__MIW_TEST__!.failAttempt("void"));
  // Same collision as "YOU SURVIVED" above: the live region announces "Run
  // over. The void got you. Press Enter to try again."
  await expect(
    page.getByRole("heading", { name: /void got you/i }),
  ).toBeVisible();
  await page.getByRole("button", { name: /try again/i }).click();
  // Leaving "failed" here, not "intro": the retry starts from the failure card.
  // Timing out on this means Try Again never restarted the run at all, which is
  // a different fault from a retried run that started and died again - and the
  // two used to be indistinguishable.
  expect(
    await phaseAfterLeaving(page, "failed"),
    "Try Again left the failure card but did not reach playing",
  ).toBe("playing");
  expect(page.url()).toBe(before);
  expect(runtimeErrors).toEqual([]);
});
