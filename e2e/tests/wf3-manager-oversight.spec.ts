import { test, expect } from '@playwright/test';
import { loginAndEnter, BASE_URL } from './utils';

/**
 * WF3: Manager Project / Ticket Oversight
 *
 * Verifies that a MANAGER (anshika.patel, ID Team) can:
 *  - See and open tickets belonging to their department
 *  - Navigate to the Projects page
 *  - See the Kanban board
 */

test('WF3: Manager Ticket Visibility (same dept)', async ({ page }) => {
  await loginAndEnter(page, 'anshika.patel@technoedgels.com');

  // Dashboard loaded
  await expect(page.locator('main').first()).toBeVisible();

  // ── Navigate to Tickets ───────────────────────────────────────────────────
  await page.locator('a[href="/tickets"]').first().click();
  await page.waitForURL('**/tickets**', { timeout: 15000 });
  await expect(page.locator('h1, h2').filter({ hasText: /tickets/i }).first()).toBeVisible({ timeout: 10000 });

  // Manager (ID Team) should see tickets from their department
  // The WF1 ticket created by pooja.kamble (ID Team) must be visible
  await expect(page.locator('text=WF1 Playwright Ticket').first()).toBeVisible({ timeout: 10000 });
});

test('WF3b: Manager Opens a Ticket Detail', async ({ page }) => {
  await loginAndEnter(page, 'anshika.patel@technoedgels.com');

  // Navigate to tickets list
  await page.locator('a[href="/tickets"]').first().click();
  await page.waitForURL('**/tickets**', { timeout: 15000 });

  // Click into the WF1 ticket
  await page.locator('text=WF1 Playwright Ticket').first().click();
  await page.waitForURL(/\/tickets\/[a-z0-9]+$/, { timeout: 15000 });

  // Ticket detail page renders with title
  await expect(page.locator('h2:has-text("WF1 Playwright Ticket")')).toBeVisible({ timeout: 10000 });

  // Tabs are visible (Comments, History, Attachments)
  await expect(page.locator('button:has-text("Comments")').first()).toBeVisible({ timeout: 8000 });
  await expect(page.locator('button:has-text("Attachments")').first()).toBeVisible({ timeout: 8000 });
});

test('WF3c: Manager Navigates to Projects', async ({ page }) => {
  await loginAndEnter(page, 'anshika.patel@technoedgels.com');

  // Navigate to Projects via sidebar
  await page.locator('a[href="/projects"]').first().click();
  await page.waitForURL('**/projects**', { timeout: 15000 });

  // Projects page renders
  await expect(page.locator('main').first()).toBeVisible({ timeout: 10000 });

  // Page has a heading or project content
  const heading = page.locator('h1, h2').first();
  await expect(heading).toBeVisible({ timeout: 10000 });
});

test('WF3d: Manager Can Access Kanban Board', async ({ page }) => {
  await loginAndEnter(page, 'anshika.patel@technoedgels.com');

  // Navigate to Kanban
  await page.locator('a[href="/kanban"]').first().click();
  await page.waitForURL('**/kanban**', { timeout: 15000 });

  await expect(page.locator('main').first()).toBeVisible({ timeout: 10000 });
  // Kanban page has an h2 "Kanban Board" heading
  await expect(page.locator('h2:has-text("Kanban Board")')).toBeVisible({ timeout: 10000 });
});
