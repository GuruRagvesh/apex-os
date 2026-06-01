import { test, expect } from '@playwright/test';
import { loginAndEnter } from './utils';

test('WF2: Team Lead Review Flow', async ({ page }) => {
  // 1. Login as Team Lead (same department as pooja.kamble - ID Team)
  await loginAndEnter(page, 'Vishal@technoedgels.com');

  // 2. Navigate to Tickets
  await page.click('a[href="/tickets"]');
  await page.waitForURL('**/tickets**');
  await expect(page.locator('h2:has-text("Tickets")')).toBeVisible();

  // 3. Verify the WF1 ticket is visible to TL in same dept
  await expect(page.locator('text=WF1 Playwright Ticket').first()).toBeVisible({ timeout: 10000 });

  // 4. Click into the ticket
  await page.locator('text=WF1 Playwright Ticket').first().click();
  await expect(page.locator('text=WF1 Playwright Ticket').first()).toBeVisible();

  // 5. Add Comment (status buttons may be disabled for TL on another's ticket)
  await page.getByRole('textbox', { name: 'Add a comment...' }).fill('Looks good. Approved by TL.');
  await page.keyboard.press('Enter');
  await expect(page.locator('text=Looks good. Approved by TL.')).toBeVisible();
});
