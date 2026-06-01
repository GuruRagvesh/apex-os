import { test, expect } from '@playwright/test';
import { loginAndEnter } from './utils';

test('WF8: Leave Application Flow', async ({ page }) => {
  // 1. Login as Employee
  await loginAndEnter(page, 'employee@apex.local');

  // 2. Navigate to Leave
  await page.click('a[href="/leave"]');
  await page.waitForURL('**/leave**');
  // The leave page should render main content
  await expect(page.locator('main')).toBeVisible();

  // 3. Look for Apply/Request Leave button
  const applyBtn = page.locator('button', { hasText: 'Apply' }).or(page.locator('button', { hasText: 'Request Leave' })).or(page.locator('button', { hasText: 'New Leave' }));
  await expect(applyBtn.first()).toBeVisible({ timeout: 10000 });
});
