import { test, expect } from '@playwright/test';
import { loginAndEnter } from './utils';

test('WF5: Admin Configuration Flow', async ({ page }) => {
  // 1. Login as Admin
  await loginAndEnter(page, 'admin@apex.local');

  // 2. Navigate to Settings
  await page.click('a[href="/settings"]');
  await page.waitForURL('**/settings**');
  // Just confirm we're on settings page
  await expect(page.locator('#apex-main-content').or(page.locator('main').first())).toBeVisible();

  // 3. Go to Users & Roles (sidebar link)
  await page.click('a[href="/users"]');
  await page.waitForURL('**/users**');
  await expect(page.locator('#apex-main-content').or(page.locator('main').first())).toBeVisible();
});
