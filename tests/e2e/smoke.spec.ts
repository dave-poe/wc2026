import { test, expect } from "@playwright/test";

test("site loads with key UI", async ({ page }) => {
  await page.goto("./");

  await expect(page).toHaveTitle(/World Cup 2026/i);
  await expect(page.locator("#title")).toBeVisible();
  await expect(page.locator("#nav")).toBeVisible();
  await expect(page.locator("#themeToggle")).toBeVisible();

  // Leaderboard renders at least one row (data baked in at build time)
  await expect(page.locator("#leaderboard .lbrow").first()).toBeVisible();
});
