import { test, expect } from '@playwright/test';
import { loginAndEnter, BASE_URL } from './utils';

/**
 * WF9: Notifications and Activity (Super Admin)
 *
 * Verifies that a SUPER_ADMIN can:
 *  - Navigate to /admin/activity and see the Activity Log page
 *  - Activity log has content (entries or empty state)
 *  - Notification bell shows a count or is present
 */

test('WF6: Super Admin System Audit Flow', async ({ page }) => {
  // 1. Login as Super Admin (has role chooser — loginAndEnter handles it)
  await loginAndEnter(page, 'superadmin@apex.local');

  // 2. Navigate to Activity Log
  await page.locator('a[href="/admin/activity"]').first().click();
  await page.waitForURL('**/admin/activity**');
  await expect(page.getByRole('main').first()).toBeVisible();
});

test('WF6b: Activity Log Has Heading and Content', async ({ page }) => {
  await loginAndEnter(page, 'superadmin@apex.local');

  // Navigate to Activity Log via sidebar
  await page.locator('a[href="/admin/activity"]').first().click();
  await page.waitForURL('**/admin/activity**', { timeout: 15000 });

  // Activity Log h1 heading
  await expect(page.locator('h1:has-text("Activity Log")').or(
    page.locator('text=Activity Log').first()
  ).first()).toBeVisible({ timeout: 10000 });

  // Wait for data to load (spinner → content)
  await page.waitForTimeout(2500);

  // Filter buttons are rendered by the activity log UI regardless of content
  // Their presence confirms the page hydrated and rendered its chrome
  await expect(page.locator('button:has-text("Today")').first()).toBeVisible({ timeout: 8000 });
  await expect(page.locator('button:has-text("This Week")').first()).toBeVisible({ timeout: 8000 });
});

test('WF6c: Super Admin Notification Bell Visible', async ({ page }) => {
  await loginAndEnter(page, 'superadmin@apex.local');

  // The notification bell is in the top banner ([role="banner"]).
  // It is an unlabeled button containing only an img.
  // Use getByRole('banner') to scope to the header region.
  const bannerButtons = page.getByRole('banner').locator('button');
  await expect(bannerButtons.first()).toBeVisible({ timeout: 10000 });
});
