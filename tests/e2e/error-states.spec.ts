import { expect, test } from "@playwright/test";
test("unknown demo slug shows a useful recovery", async ({ page }) => {
  await page.goto("/c/does-not-exist");
  // A slug this browser has never stored and no ?d= payload to rebuild it from
  // raises CHALLENGE_NOT_FOUND, which GameClient turns into the copy below.
  await expect(
    page.getByText(/that challenge link is missing its level data/i),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /back to home/i })).toBeVisible();
});
