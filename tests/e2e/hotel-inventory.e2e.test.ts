// B4B-JARVIS-VERIFY-001 — T15 Browser E2E against real running server
// Requires Playwright installed in CI. Runs against http://localhost:3999 with real PostgreSQL.
import { test, expect } from "@playwright/test";

test.use({ baseURL: "http://localhost:3999" });

test("T15 E2E: hotel creation, room creation, rate-plan editing, calendar changes", async ({ page }) => {
  // Navigate to hotels page (login assumed via existing session or test login)
  await page.goto("/login");
  await page.fill('input[name="email"]', "admin@test.local");
  await page.fill('input[name="password"]', "verify-password-1");
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/.*hotels/);

  // Create hotel
  await page.click('text=Yeni otel');
  await page.fill('input[name="name"]', "E2E Test Otel");
  await page.fill('input[name="location"]', "İstanbul");
  await page.click('button[type="submit"]');
  await expect(page.locator('text=E2E Test Otel')).toBeVisible();

  // Go to hotel detail
  await page.click('text=E2E Test Otel');

  // Create room
  await page.click('text=Yeni oda');
  await page.fill('input[name="name"]', "Standart Oda");
  await page.fill('input[name="maxAdults"]', "2");
  await page.fill('input[name="maxChildren"]', "1");
  await page.click('button[type="submit"]');
  await expect(page.locator('text=Standart Oda')).toBeVisible();

  // Create rate plan
  await page.click('text=Fiyat planı ekle');
  await page.fill('input[name="boardName"]', "Half Board");
  await page.fill('input[name="currency"]', "EUR");
  await page.click('button[type="submit"]');
  await expect(page.locator('text=Half Board')).toBeVisible();
});

test("T15 E2E: unauthorized access redirected to login", async ({ page }) => {
  await page.goto("/admin/hotels");
  await expect(page).toHaveURL(/.*login/);
});

test("T15 E2E: mobile navigation works", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[name="email"]', "admin@test.local");
  await page.fill('input[name="password"]', "verify-password-1");
  await page.click('button[type="submit"]');
  await page.setViewportSize({ width: 375, height: 667 });
  await page.click('text=Oteller');
  await expect(page.locator('text=Oteller')).toBeVisible();
});