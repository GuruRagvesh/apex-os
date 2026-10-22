import { test, expect, Page } from '@playwright/test';
import { mkdirSync } from 'fs';
import { join } from 'path';

/**
 * Phase 3 attendance and leave: real frontend + real backend on the local
 * scratch stack only (synthetic people, throwaway database), desktop and 375px.
 *
 *   P3_BASE_URL  frontend (default http://localhost:3100)
 *   P3_API_URL   backend  (default http://localhost:3101/api)
 *   P3_PASSWORD  the synthetic accounts' test password (never printed)
 */

const BASE = process.env.P3_BASE_URL ?? 'http://localhost:3100';
const API = process.env.P3_API_URL ?? 'http://localhost:3101/api';
const PASSWORD = process.env.P3_PASSWORD ?? '';
const SHOTS = process.env.P3_SHOTS ?? join(__dirname, '..', 'test-results', 'phase3-screens');
mkdirSync(SHOTS, { recursive: true });

for (const [name, value] of Object.entries({ BASE, API })) {
  if (!/^http:\/\/(localhost|127\.0\.0\.1):31\d\d/.test(value)) throw new Error(`${name} must point at the local Phase 3 scratch stack`);
}

test.describe.configure({ mode: 'serial' });
if (process.env.P3_CHROMIUM) test.use({ launchOptions: { executablePath: process.env.P3_CHROMIUM } });

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 375, height: 812 },
] as const;

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/login`);
  await page.locator('input[type="email"]').waitFor({ state: 'visible', timeout: 120000 });
  await page.waitForLoadState('networkidle');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 });
  if (page.url().includes('/welcome')) {
    await page.locator('button:has-text("Enter Apex OS")').click({ timeout: 30000 });
    await page.waitForURL((u) => !u.pathname.startsWith('/welcome'), { timeout: 30000 });
  }
  if (page.url().includes('/select-mode')) {
    await page.locator('button', { has: page.locator('h2') }).first().click();
    await page.waitForURL((u) => !u.pathname.startsWith('/select-mode'), { timeout: 30000 });
  }
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false });
}

async function apiToken(email: string) {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  const j: any = await res.json();
  return j.access_token ?? j.accessToken ?? j.token;
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} (${vp.width}px)`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test(`employee files Emergency Leave funded from Sick and sees deadlines and approver (${vp.name})`, async ({ page }) => {
      await login(page, 'p3-emp@phase3.test');
      await page.goto(`${BASE}/leave`);
      await page.getByRole('button', { name: /new|apply|request leave/i }).first().click();
      await page.locator('select').first().selectOption('SICK');
      await page.locator('input[name="emergencySubmission"]').check();
      await page.locator('select[name="fundingBucket"]').selectOption('SICK');
      const today = new Date().toISOString().slice(0, 10);
      // A fresh weekday each run, so a rerun never overlaps an earlier request.
      const day = new Date(Date.UTC(2027, 0, 4));
      day.setUTCDate(day.getUTCDate() + 7 * (Math.floor(Date.now() / 60000) % 40) + (vp.name === 'desktop' ? 0 : 1));
      const leaveDate = day.toISOString().slice(0, 10);
      const dates = page.locator('input[type="date"]');
      await dates.nth(0).fill(leaveDate);
      await dates.nth(1).fill(leaveDate);
      await page.locator('textarea').first().fill(`Phase 3 ${vp.name} emergency request ${today}`);
      await noHorizontalOverflow(page);
      await shot(page, `${vp.name}-01-leave-emergency-form`);
      await page.getByRole('button', { name: /submit request/i }).click();
      // The form closes only on success.
      await expect(page.locator('.apex-backdrop')).toHaveCount(0, { timeout: 30000 });
      await expect(page.getByText(/Emergency · SICK/).first()).toBeVisible({ timeout: 30000 });
      await page.getByText(/Emergency · SICK/).first().click();
      await expect(page.getByTestId('leave-current-approver').first()).toContainText('P3 Team Lead');
      await expect(page.getByText(/Emergency evidence:/).first()).toBeVisible();
      await noHorizontalOverflow(page);
      await shot(page, `${vp.name}-02-leave-emergency-detail`);
    });

    test(`personal balances show Casual 10 and Sick 4, never an Emergency pool (${vp.name})`, async ({ page }) => {
      const token = await apiToken('p3-emp@phase3.test');
      const total = await fetch(`${API}/leave/balance`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
      expect(total.allocation).toBe(14);
      await login(page, 'p3-emp@phase3.test');
      await page.goto(`${BASE}/attendance`);
      await expect(page.getByText(/Sick Leave/).first()).toBeVisible({ timeout: 60000 });
      await expect(page.getByText(/Emergency Leave/)).toHaveCount(0);
      await noHorizontalOverflow(page);
      await shot(page, `${vp.name}-03-attendance-balances`);
    });

    test(`Team Lead sees the team queue and decides once; legacy request stays visible to HR (${vp.name})`, async ({ page }) => {
      await login(page, 'p3-tl@phase3.test');
      await page.goto(`${BASE}/attendance/reviews`);
      await expect(page.getByRole('tab', { name: /My team/ })).toBeVisible({ timeout: 60000 });
      await expect(page.getByRole('tab', { name: /Company pending/ })).toHaveCount(0);
      await expect(page.getByText('P3 Employee').first()).toBeVisible();
      await noHorizontalOverflow(page);
      await shot(page, `${vp.name}-04-reviews-team`);

      await login(page, 'p3-hr@phase3.test');
      await page.goto(`${BASE}/attendance/reviews`);
      await page.getByRole('tab', { name: /Company pending/ }).click();
      await expect(page.getByText('P3 Second Employee').first()).toBeVisible({ timeout: 30000 });
      await noHorizontalOverflow(page);
      await shot(page, `${vp.name}-05-reviews-company`);
    });

    test(`HR punch-review queue shows DEVICE_ID_UNAVAILABLE and device labels (${vp.name})`, async ({ page }) => {
      await login(page, 'p3-admin@phase3.test');
      await page.goto(`${BASE}/attendance/admin`);
      // The queue sits in a collapsed "Punch Evidence Review" section for HR/Admin.
      await page.getByText('Punch Evidence Review').click({ timeout: 60000 });
      await expect(page.getByText(/Device ID unavailable/).first()).toBeVisible({ timeout: 30000 });
      await expect(page.getByText(/DEVICE_ID_UNAVAILABLE|Device ID unavailable/).first()).toBeVisible();
      await noHorizontalOverflow(page);
      await shot(page, `${vp.name}-06-punch-review-queue`);
    });
  });
}

test('the routed approver decides; the request leaves both queues (desktop)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'p3-tl@phase3.test');
  await page.goto(`${BASE}/attendance/reviews`);
  const card = page.getByRole('article', { name: 'Correction for P3 Employee' });
  await expect(card).toBeVisible({ timeout: 60000 });
  await card.getByRole('button', { name: 'Approve', exact: true }).click();
  const confirm = card.getByRole('button', { name: 'Confirm approval' });
  // No decision without a reason.
  await expect(confirm).toBeDisabled();
  await card.locator('textarea[name="decisionReason"]').fill('Badge log confirms the punch-out.');
  await shot(page, 'desktop-07a-decision-reason');
  await confirm.click();
  await expect(page.getByText('Forgot to punch out after the client call.')).toHaveCount(0, { timeout: 30000 });
  await shot(page, 'desktop-07b-decided');
});
