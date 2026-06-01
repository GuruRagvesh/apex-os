import { test, expect } from '@playwright/test';
import { loginAndEnter, BASE_URL } from './utils';

test('WF7: Intern Minimal Access Flow', async ({ page }) => {
  // 1. Login as Intern
  await loginAndEnter(page, 'intern@apex.local');

  // 2. Verify sidebar doesn't have admin-only links
  // From error context: Intern sidebar has Home, Tickets, Kanban Board, Projects, Leave, Calendar, Settings
  // It does NOT have: Team, Analytics, Users & Roles, Departments, Activity Log
  await expect(page.locator('a[href="/team"]')).not.toBeVisible();
  await expect(page.locator('a[href="/analytics"]')).not.toBeVisible();
  await expect(page.locator('a[href="/admin/activity"]')).not.toBeVisible();
  await expect(page.locator('a[href="/users"]')).not.toBeVisible();
  await expect(page.locator('a[href="/departments"]')).not.toBeVisible();

  // 3. Navigate to /projects (intern CAN see it but with 0 results — this is frontend behavior)
  await page.goto(`${BASE_URL}/projects`);
  await page.waitForURL('**/projects**');
  // Intern sees Projects page with "No projects yet" or "0 projects total"
  await expect(page.locator('text=0 projects').or(page.locator('text=No projects'))).toBeVisible();
});
