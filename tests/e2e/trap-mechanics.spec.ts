import { expect, test, type Page } from "@playwright/test";
import type { TrapType } from "@/lib/game/types";

async function openTrap(page: Page, type: TrapType, hasBody = true) {
  await page.goto(`/dev/sandbox?trap=${type}`);
  await expect(page.getByText("ALL-TRAP QA SANDBOX")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__MIW_SANDBOX__?.getState().player)))
    .toBe(true);
  if (hasBody) {
    await expect
      .poll(() => page.evaluate((value) => Boolean(window.__MIW_SANDBOX__?.getState().traps[value]), type))
      .toBe(true);
  }
}

async function expectMechanic(page: Page, type: TrapType, event: string) {
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ trapType: value, mechanic: name }) =>
            window.__MIW_SANDBOX__?.getState().mechanics.some(
              (entry) => entry.trapType === value && entry.event === name,
            ) ?? false,
          { trapType: type, mechanic: event },
        ),
    )
    .toBe(true);
}

// Seven of the sixteen traps in TRAP_TYPES are exercised here. The floor fan,
// toaster launcher, ceiling fan, banana peel, robot mop, mousetrap, sprinkler,
// laundry basket, and industrial magnet have no step yet: the sandbox places
// all sixteen, so each is reachable through /dev/sandbox?trap=<type> when a
// step is written for it.
test("seven of the sixteen traps prove their production physics mechanic", async ({ page }) => {
  test.setTimeout(90_000);

  await test.step("hammer moving collider attributes a sweep contact", async () => {
    await openTrap(page, "swinging_hammer");
    await page.evaluate(() => window.__MIW_SANDBOX__!.teleportPlayer("swinging_hammer"));
    await expectMechanic(page, "swinging_hammer", "sweep_contact");
    await expect.poll(() => page.evaluate(() => window.__MIW_SANDBOX__?.getState().lastHazardType)).toBe("swinging_hammer");
  });

  await test.step("fridge activates and gains charge velocity", async () => {
    await openTrap(page, "rolling_fridge");
    await page.evaluate(() => window.__MIW_SANDBOX__!.teleportPlayer("rolling_fridge", 0, -3));
    await expectMechanic(page, "rolling_fridge", "charge_started");
    await expect
      .poll(() =>
        page.evaluate(() => {
          const velocity = window.__MIW_SANDBOX__?.getState().traps.rolling_fridge?.velocity;
          return velocity ? Math.hypot(velocity.x, velocity.y, velocity.z) : 0;
        }),
      )
      .toBeGreaterThan(1);
  });

  await test.step("soap applies the slippery force branch", async () => {
    await openTrap(page, "soap_slick", false);
    await page.evaluate(() => {
      window.__MIW_SANDBOX__!.teleportPlayer("soap_slick");
      window.__MIW_SANDBOX__!.setPlayerVelocity(0, 0, 3);
    });
    await expectMechanic(page, "soap_slick", "slip_applied");
    await expect.poll(() => page.evaluate(() => window.__MIW_SANDBOX__?.getState().lastHazardType)).toBe("soap_slick");
  });

  await test.step("spring applies an upward launch impulse", async () => {
    await openTrap(page, "spring_pad", false);
    await page.evaluate(() => {
      window.__MIW_SANDBOX__!.teleportPlayer("spring_pad");
      window.__MIW_SANDBOX__!.setPlayerVelocity(0, -2, 0);
    });
    await expectMechanic(page, "spring_pad", "spring_impulse");
    await expect
      .poll(() =>
        page.evaluate(() =>
          Math.max(
            0,
            ...(window.__MIW_SANDBOX__?.getState().mechanics
              .filter((entry) => entry.trapType === "spring_pad" && entry.event === "spring_impulse")
              .map((entry) => entry.magnitude) ?? []),
          ),
        ),
      )
      .toBeGreaterThanOrEqual(8);
  });

  await test.step("vacuum closes distance and applies suction", async () => {
    await openTrap(page, "angry_vacuum");
    const before = await page.evaluate(() => window.__MIW_SANDBOX__!.getState().traps.angry_vacuum!.position);
    await page.evaluate(() => window.__MIW_SANDBOX__!.teleportPlayer("angry_vacuum", 0, -3.5));
    await expectMechanic(page, "angry_vacuum", "vacuum_chasing");
    await expect
      .poll(() =>
        page.evaluate((start) => {
          const position = window.__MIW_SANDBOX__?.getState().traps.angry_vacuum?.position;
          return position ? Math.hypot(position.x - start.x, position.z - start.z) : 0;
        }, before),
      )
      .toBeGreaterThan(0.2);
    await page.evaluate(() => window.__MIW_SANDBOX__!.teleportPlayer("angry_vacuum", 0, -1.2));
    await expectMechanic(page, "angry_vacuum", "suction_applied");
  });

  await test.step("toilet physically orbits and its sweep collider contacts", async () => {
    await openTrap(page, "rotating_toilet");
    const before = await page.evaluate(() => window.__MIW_SANDBOX__!.getState().traps.rotating_toilet!.position);
    await expect
      .poll(() =>
        page.evaluate((start) => {
          const position = window.__MIW_SANDBOX__?.getState().traps.rotating_toilet?.position;
          return position ? Math.hypot(position.x - start.x, position.z - start.z) : 0;
        }, before),
      )
      .toBeGreaterThan(0.25);
    await page.evaluate(() => window.__MIW_SANDBOX__!.teleportPlayerToTrapBody("rotating_toilet"));
    await expectMechanic(page, "rotating_toilet", "sweep_contact");
  });

  await test.step("beach ball collides, can be grabbed, and releases with speed", async () => {
    await openTrap(page, "giant_beach_ball");
    await page.evaluate(() => window.__MIW_SANDBOX__!.teleportPlayerToTrapBody("giant_beach_ball"));
    await expectMechanic(page, "giant_beach_ball", "ball_contact");
    await page.keyboard.down("e");
    await page.evaluate(() => {
      window.__MIW_SANDBOX__!.teleportPlayer("giant_beach_ball", 0, -1);
      window.__MIW_SANDBOX__!.placeTrapInFrontOfPlayer("giant_beach_ball", 1);
      window.__MIW_SANDBOX__!.setPlayerVelocity(0, 0, 0.2);
    });
    await expect
      .poll(async () => JSON.parse(await page.getByLabel("Sandbox interaction telemetry").textContent() || "{}").holdingObject)
      .toBe(true);
    await page.keyboard.up("e");
    await expect
      .poll(async () => JSON.parse(await page.getByLabel("Sandbox interaction telemetry").textContent() || "{}").holdingObject)
      .toBe(false);
    await expect
      .poll(async () => JSON.parse(await page.getByLabel("Sandbox interaction telemetry").textContent() || "{}").releasedObjectSpeed ?? 0)
      .toBeGreaterThan(1);
  });
});
