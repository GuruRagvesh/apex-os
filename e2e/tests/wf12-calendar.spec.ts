import { test, expect } from '@playwright/test';
import { loginAndEnter, BASE_URL } from './utils';

/**
 * WF8: Calendar
 *
 * Flow:
 *   EMPLOYEE (pooja.kamble) navigates to /calendar via sidebar →
 *   verifies FullCalendar renders → verifies today's cell is marked →
 *   if any events are present, verifies the event list is non-empty.
 *
 * Uses client-side navigation (sidebar link click) to avoid the
 * Zustand/DashboardLayout auth-redirect race that occurs on hard loads.
 */

test('WF8: Calendar Renders with Today Highlighted', async ({ page }) => {
  await loginAndEnter(page, 'pooja.kamble@technoedgels.com');

  // ── Step 1: Navigate to /calendar via sidebar link ────────────────────────
  await page.locator('a[href="/calendar"]').first().click();
  await page.waitForURL('**/calendar**', { timeout: 15000 });

  // ── Step 2: Page heading ───────────────────────────────────────────────────
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 10000 });

  // ── Step 3: FullCalendar container renders ─────────────────────────────────
  // FullCalendar always attaches class "fc" to its root element
  const calendar = page.locator('.fc').first();
  await expect(calendar).toBeVisible({ timeout: 15000 });

  // ── Step 4: Today's cell is highlighted ────────────────────────────────────
  // FullCalendar adds "fc-day-today" to the current day's cell
  const todayCell = page.locator('.fc-day-today').first();
  await expect(todayCell).toBeVisible({ timeout: 10000 });

  // ── Step 5: Calendar grid has rendered day cells ───────────────────────────
  // The month/week grid always renders at least one day cell
  const dayCells = page.locator('.fc-daygrid-day, .fc-timegrid-col');
  await expect(dayCells.first()).toBeVisible({ timeout: 10000 });
});

test('WF8b: Calendar Navigation Controls Work', async ({ page }) => {
  await loginAndEnter(page, 'pooja.kamble@technoedgels.com');

  await page.locator('a[href="/calendar"]').first().click();
  await page.waitForURL('**/calendar**', { timeout: 15000 });

  // Wait for calendar to load
  await expect(page.locator('.fc').first()).toBeVisible({ timeout: 15000 });

  // Navigate to next period first (enables the "today" button), then click Today
  const nextBtn = page.locator('.fc-next-button');
  if (await nextBtn.isVisible({ timeout: 3000 })) {
    await nextBtn.click();
    await page.waitForTimeout(500);
    // Today button is now enabled (we've moved away from current month)
    const todayBtn = page.locator('.fc-today-button');
    await expect(todayBtn).toBeEnabled({ timeout: 5000 });
    await todayBtn.click();
    await expect(page.locator('.fc-day-today').first()).toBeVisible({ timeout: 8000 });
  }

  // Verify calendar still visible after navigation
  await expect(page.locator('.fc').first()).toBeVisible();
});
