import { test, expect } from '@playwright/test';
import { loginAndEnter } from './utils';

test('WF4: Cross-Department Block Flow', async ({ page }) => {
  // 1. Login as Employee from a DIFFERENT department than ID Team
  // employee@apex.local is in QC Team, pooja.kamble is in ID Team
  await loginAndEnter(page, 'employee@apex.local');

  // 2. Navigate to Tickets
  await page.click('a[href="/tickets"]');
  await page.waitForURL('**/tickets**');
  await expect(page.locator('h2:has-text("Tickets")')).toBeVisible();

  // 3. The WF1 Playwright Ticket (ID Team) should NOT be visible to QC Team employee
  await expect(page.locator('text=WF1 Playwright Ticket')).not.toBeVisible({ timeout: 5000 });
});
