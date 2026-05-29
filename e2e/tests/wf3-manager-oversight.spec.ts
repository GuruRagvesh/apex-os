import { test, expect } from '@playwright/test';
import { loginAndEnter } from './utils';

test('WF3: Manager Oversight Flow', async ({ page }) => {
  // 1. Login as Manager (anshika is MANAGER for ID Team, same dept as pooja.kamble)
  await loginAndEnter(page, 'anshika.patel@technoedgels.com');

  // 2. Dashboard - verify main content loaded
  await expect(page.locator('main').first()).toBeVisible();

  // 3. Navigate to Tickets
  await page.click('a[href="/tickets"]');
  await page.waitForURL('**/tickets**');
  await expect(page.locator('h2:has-text("Tickets")')).toBeVisible();

  // Manager should see WF1 Playwright Ticket (same dept)
  await expect(page.locator('text=WF1 Playwright Ticket').first()).toBeVisible({ timeout: 10000 });
});
