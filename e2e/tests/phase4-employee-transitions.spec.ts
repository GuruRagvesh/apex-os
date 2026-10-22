import { expect, Page, test } from '@playwright/test';

/**
 * Phase 4 employee transitions: real frontend and backend, but only on the
 * loopback integration stack. The API suite seeds the synthetic accounts and
 * a scheduled transfer used here; no shared or production data is accepted.
 *
 *   P4_BASE_URL  frontend (default http://localhost:3100)
 *   P4_PASSWORD  synthetic integration-account password
 */
const BASE = process.env.P4_BASE_URL ?? 'http://localhost:3100';
const PASSWORD = process.env.P4_PASSWORD ?? 'integration-only-not-a-real-password';

if (!/^http:\/\/(localhost|127\.0\.0\.1):31\d\d$/.test(BASE)) {
  throw new Error('P4_BASE_URL must point at the local Phase 4 integration stack');
}
test.describe.configure({ mode: 'serial' });
if (process.env.P4_CHROMIUM) {
  test.use({ launchOptions: { executablePath: process.env.P4_CHROMIUM } });
}

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/login`);
  await page.locator('input[type="email"]').waitFor({ state: 'visible', timeout: 120_000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 });
  if (page.url().includes('/welcome')) {
    await page.getByRole('button', { name: /enter apex os/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/welcome'), { timeout: 30_000 });
  }
  if (page.url().includes('/select-mode')) {
    await page.locator('button', { has: page.locator('h2') }).first().click();
    await page.waitForURL((url) => !url.pathname.startsWith('/select-mode'), { timeout: 30_000 });
  }
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 375, height: 812 },
] as const) {
  test.describe(`${viewport.name} (${viewport.width}px)`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test(`Admin can open transfer review and payroll (${viewport.name})`, async ({ page }) => {
      await login(page, 'admin@integration.invalid');
      await page.goto(`${BASE}/users/transfers`);
      await expect(page.getByRole('heading', { name: 'Transfer review' })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText('Phase 4 Transfer Target').first()).toBeVisible({ timeout: 30_000 });
      await expectNoHorizontalOverflow(page);

      await page.goto(`${BASE}/attendance/payroll`);
      await expect(page.getByRole('heading', { name: 'Payroll', exact: true })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByRole('heading', { name: 'Monthly attendance for payroll' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });

    test(`Employee sees only their resignation workspace (${viewport.name})`, async ({ page }) => {
      await login(page, 'employee@integration.invalid');
      await page.goto(`${BASE}/profile/resignation`);
      await expect(page.getByRole('heading', { name: 'My resignation' })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByRole('button', { name: 'Submit resignation' })).toBeVisible();
      await expect(page.getByText(/Only you and authorised reviewers can see this/i)).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  });
}
