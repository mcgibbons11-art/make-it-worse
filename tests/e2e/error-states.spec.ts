import { expect, test } from "@playwright/test";
test("unknown demo slug shows a useful recovery", async ({ page }) => {
  await page.goto("/c/does-not-exist");
  await expect(page.getByText(/does not exist in this browser/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /back to home/i })).toBeVisible();
});
