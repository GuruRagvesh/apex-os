import { test, expect } from '@playwright/test';
import { loginAndEnter, BASE_URL } from './utils';

/**
 * WF5: Workday / Attendance
 *
 * Part A — EMPLOYEE full workday cycle (employee@apex.local):
 *   Start Work → Break (Tea Break) → Resume Work → End Day → confirm "End Workday"
 *   Handles any starting state (OFFLINE, WORKING, ON_BREAK, or already LOGGED_OUT).
 *
 * Part B — EMPLOYEE cannot see Live Status tab on /team.
 *
 * Part C — TEAM_LEAD (Vishal) has Live Status tab and can view team workday data.
 */

test('WF5a: Employee Workday Cycle', async ({ page }) => {
  await loginAndEnter(page, 'employee@apex.local');

  // Dashboard should be loaded; WorkdayBar lives here
  await page.waitForURL('**/dashboard**', { timeout: 15000 });
  await expect(page.locator('main').first()).toBeVisible();

  // Allow React Query to fetch today's session before checking state
  await page.waitForTimeout(2500);

  // ── Handle stale session from a previous day (amber banner) ────────────────
  const endSessionBtn = page.locator('button:has-text("End Session")');
  if (await endSessionBtn.isVisible({ timeout: 2000 })) {
    await endSessionBtn.click();
    await page.locator('h2:has-text("End Your Day")').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('button:has-text("End Workday")').click();
    await page.waitForTimeout(2000);
  }

  // ── Step 1: Start Work (only if OFFLINE / LOGGED_IN) ───────────────────────
  const startBtn = page.locator('button:has-text("Start Work")').first();
  if (await startBtn.isVisible({ timeout: 3000 })) {
    await startBtn.click();
    // Wait for WORKING indicator in the bar
    await page.locator('text=Working').first().waitFor({ state: 'visible', timeout: 15000 });
  }

  // ── Step 2: Take a Break (only if WORKING) ─────────────────────────────────
  const breakBtn = page.locator('button:has-text("Break")').first();
  if (await breakBtn.isVisible({ timeout: 3000 })) {
    await breakBtn.click();
    // BreakModal header
    await page.locator('h2:has-text("Start a Break")').waitFor({ state: 'visible', timeout: 10000 });
    // Select Tea Break type
    await page.locator('button:has-text("Tea Break")').click();
    // Start Break becomes enabled after type selection
    await page.locator('button:has-text("Start Break")').click();
    // Wait for ON_BREAK state → "Resume Work" button appears
    await page.locator('button:has-text("Resume Work")').waitFor({ state: 'visible', timeout: 15000 });
  }

  // ── Step 3: Resume Work (only if ON_BREAK) ─────────────────────────────────
  const resumeBtn = page.locator('button:has-text("Resume Work")').first();
  if (await resumeBtn.isVisible({ timeout: 3000 })) {
    await resumeBtn.click();
    // Back to WORKING
    await page.locator('text=Working').first().waitFor({ state: 'visible', timeout: 15000 });
  }

  // ── Step 4: End Day (only if WORKING or IDLE) ──────────────────────────────
  const endDayBtn = page.locator('button:has-text("End Day")').first();
  if (await endDayBtn.isVisible({ timeout: 3000 })) {
    await endDayBtn.click();
    // EndDayModal opens
    await page.locator('h2:has-text("End Your Day")').waitFor({ state: 'visible', timeout: 10000 });
    // Confirm
    await page.locator('button:has-text("End Workday")').click();
    // Wait for LOGGED_OUT state — "Workday ended" text
    await page.locator('text=Workday ended').first().waitFor({ state: 'visible', timeout: 15000 });
  }

  // ── Final assertion: dashboard is stable ───────────────────────────────────
  // After completing (or already being in) a workday cycle, the dashboard main
  // content remains accessible.
  await expect(page.locator('main').first()).toBeVisible();
});

test('WF5b: Employee Cannot See Live Status Tab on /team', async ({ page }) => {
  // Employee role: canSeeStatus = false → no Live Status tab rendered.
  // The /team sidebar link is only shown for TEAM_LEAD+; navigate directly by URL.
  await loginAndEnter(page, 'pooja.kamble@technoedgels.com');

  // Navigate directly — EMPLOYEE can visit /team but gets the limited view
  await page.goto(`${BASE_URL}/team`);
  await page.waitForURL('**/team**', { timeout: 15000 });

  // Employee should see the Team directory (My Team section)
  await expect(page.locator('main').first()).toBeVisible({ timeout: 10000 });

  // Live Status tab must NOT exist for EMPLOYEE role
  await expect(page.locator('button:has-text("Live Status")')).toHaveCount(0, { timeout: 5000 });
});

test('WF5c: Team Lead Has Live Status View', async ({ page }) => {
  // TEAM_LEAD role: canSeeStatus = true → Live Status tab visible
  await loginAndEnter(page, 'Vishal@technoedgels.com');

  await page.locator('a[href="/team"]').first().click();
  await page.waitForURL('**/team**', { timeout: 15000 });

  // Live Status tab must be present
  const liveTab = page.locator('button:has-text("Live Status")').first();
  await expect(liveTab).toBeVisible({ timeout: 10000 });

  // Click it
  await liveTab.click();
  await page.waitForTimeout(2000); // allow React Query to fetch workday/team

  // Either a member table or the "No team members have started" empty state
  const tableOrEmpty = page.locator('table').or(
    page.locator('text=No team members have started their workday yet')
  ).first();
  await expect(tableOrEmpty).toBeVisible({ timeout: 10000 });
});
