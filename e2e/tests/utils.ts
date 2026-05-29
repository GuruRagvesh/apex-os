import { Page, expect } from '@playwright/test';

export const BASE_URL = 'http://localhost:3000';

/**
 * loginAndEnter — robust multi-step login helper.
 *
 * Handles all post-login redirect chains:
 *   /login → /welcome (first-time, any role)  → /dashboard
 *   /login → /welcome (first-time, SUPER_ADMIN) → /select-mode → /dashboard
 *   /login → /select-mode (returning SUPER_ADMIN) → /dashboard
 *   /login → /dashboard (returning non-SUPER_ADMIN)
 *
 * Uses URL-based detection instead of fixed polling so it isn't brittle
 * against Next.js dev-server compilation delays or slow hydration.
 */
export async function loginAndEnter(page: Page, email: string, pass = 'Apex@2026') {
  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', pass);
  await page.click('button[type="submit"]');

  // ── Step 1: wait for redirect away from /login ────────────────────────────
  await page.waitForURL(
    (url) => !url.pathname.startsWith('/login'),
    { timeout: 15000 },
  );

  // ── Step 2: handle /welcome (first-time for any role) ────────────────────
  if (page.url().includes('/welcome')) {
    // The welcome page has a loading spinner until Zustand hydrates; wait for
    // the actual CTA button before clicking.
    await page.locator('button:has-text("Enter Apex OS")').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('button:has-text("Enter Apex OS")').click();
    await page.waitForURL(
      (url) => !url.pathname.startsWith('/welcome'),
      { timeout: 15000 },
    );
  }

  // ── Step 3: handle /select-mode (SUPER_ADMIN mode picker) ────────────────
  if (page.url().includes('/select-mode')) {
    // Two mode cards each contain an <h2>; click the first (Super Admin)
    const modeBtn = page.locator('button', { has: page.locator('h2') }).first();
    await modeBtn.waitFor({ state: 'visible', timeout: 10000 });
    await modeBtn.click();
    await page.waitForURL(
      (url) => !url.pathname.startsWith('/select-mode'),
      { timeout: 15000 },
    );
  }

  // ── Step 4: confirm we are in the app (sidebar visible) ──────────────────
  await expect(page.locator('a[href="/dashboard"]').first()).toBeVisible({ timeout: 15000 });
}
