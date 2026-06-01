import { test, expect } from '@playwright/test';
import { loginAndEnter } from './utils';

/**
 * WF6: Settings and Profile — Admin Configuration
 *
 * Verifies that an ADMIN can:
 *  - Navigate to Settings and see the Company section
 *  - Navigate to Users & Roles and see the user list
 *  - View the company name field
 */

test('WF5: Admin Configuration Flow', async ({ page }) => {
  // 1. Login as Admin
  await loginAndEnter(page, 'admin@apex.local');

  // 2. Navigate to Settings via sidebar
  await page.locator('a[href="/settings"]').first().click();
  await page.waitForURL('**/settings**');
  await expect(page.locator('#apex-main-content').or(page.locator('main').first())).toBeVisible({ timeout: 10000 });

  // 3. Go to Users & Roles (sidebar link)
  await page.locator('a[href="/users"]').first().click();
  await page.waitForURL('**/users**');
  await expect(page.locator('#apex-main-content').or(page.locator('main').first())).toBeVisible({ timeout: 10000 });
});

test('WF5b: Admin Sees Settings Company Section', async ({ page }) => {
  await loginAndEnter(page, 'admin@apex.local');

  // Navigate to settings
  await page.locator('a[href="/settings"]').first().click();
  await page.waitForURL('**/settings**', { timeout: 15000 });

  // The Company section link/nav item should be present for Admin
  // Settings page has a left nav with "Company", "Policies", etc.
  const companyNav = page.locator('text=Company').first();
  await expect(companyNav).toBeVisible({ timeout: 10000 });

  // Click Company to ensure it loads
  await companyNav.click();
  await page.waitForTimeout(1000);

  // Company Name field should render
  await expect(page.locator('label:has-text("Company Name")').or(
    page.locator('input[value*="TechnoEdge"], input[placeholder*="company"]')
  ).first()).toBeVisible({ timeout: 8000 });
});

test('WF5c: Admin Users List Has Members', async ({ page }) => {
  await loginAndEnter(page, 'admin@apex.local');

  // Navigate to Users
  await page.locator('a[href="/users"]').first().click();
  await page.waitForURL('**/users**', { timeout: 15000 });

  // Wait for user list to load
  await page.waitForTimeout(2000);

  // Users page heading
  await expect(page.locator('h2:has-text("Users")').or(
    page.locator('h1:has-text("Users")')
  ).first()).toBeVisible({ timeout: 10000 });

  // Count indicator shows team members
  await expect(page.locator('text=team members').first()).toBeVisible({ timeout: 8000 });
});
