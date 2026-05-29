import { test, expect } from '@playwright/test';
import { loginAndEnter } from './utils';

test('WF6: Super Admin System Audit Flow', async ({ page }) => {
  // 1. Login as Super Admin (has role chooser — loginAndEnter handles it)
  await loginAndEnter(page, 'superadmin@apex.local');

  // 2. Navigate to Activity Log
  await page.click('a[href="/admin/activity"]');
  await page.waitForURL('**/admin/activity**');
  await expect(page.getByRole('main').first()).toBeVisible();
});
