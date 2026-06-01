import { test, expect } from '@playwright/test';
import { loginAndEnter, BASE_URL } from './utils';

test('WF1: Employee Ticket Execution', async ({ page }) => {
  // 1. Login as Employee
  await loginAndEnter(page, 'pooja.kamble@technoedgels.com');

  // 2. Navigate to Tickets
  await page.locator('a[href="/tickets"]').first().click();
  await page.waitForURL('**/tickets**');
  await expect(page.locator('h1:has-text("Tickets"), h2:has-text("Tickets")').first()).toBeVisible({ timeout: 10000 });

  // 3. Navigate to Create Ticket page
  // Two "New Ticket" links exist (header + main). Click the first and wait for URL.
  await page.locator('a[href="/tickets/new"]').first().click();
  // Dev-server first-compile can take 10–15 s; wait for URL before checking heading
  await page.waitForURL('**/tickets/new**', { timeout: 20000 });
  await expect(page.locator('h2:has-text("Create New Ticket")')).toBeVisible({ timeout: 10000 });

  // 4. Fill in the form
  // Actual placeholder: "e.g., Replace light bulb in IT Room 3B"
  await page.getByRole('textbox', { name: /Replace light bulb/i }).fill('WF1 Playwright Ticket');
  await page.getByRole('textbox', { name: /Detailed description/i }).fill('This ticket is created by the automated UI test.');

  await page.locator('button:has-text("Create Ticket")').click();

  // Wait for redirect to /tickets/[id]
  await page.waitForURL(/\/tickets\/[a-z0-9]+$/, { timeout: 15000 });
  await expect(page.locator('text=WF1 Playwright Ticket').first()).toBeVisible({ timeout: 10000 });

  // 5. Advance status to In Progress (stepper button)
  await page.locator('button:has-text("In Progress")').click();
  await page.waitForTimeout(1000);

  // 6. Add Comment
  await page.getByRole('textbox', { name: /Add a comment/i }).fill('Starting work via Playwright UI.');
  await page.keyboard.press('Enter');
  await expect(page.locator('text=Starting work via Playwright UI.').first()).toBeVisible({ timeout: 8000 });

  // 7. Advance status to Under Review
  await page.locator('button:has-text("Under Review")').click();
  await page.waitForTimeout(1000);
  await expect(page.locator('text=Under Review').first()).toBeVisible({ timeout: 8000 });

  // 8. Navigate to dashboard — ticket should appear in activity/overview
  await page.locator('a[href="/dashboard"]').first().click();
  await page.waitForURL('**/dashboard**', { timeout: 10000 });
  // Dashboard shows recent tickets; at minimum verify we landed on the dashboard
  await expect(page.locator('main').first()).toBeVisible({ timeout: 10000 });
});
