import { test, expect, Page, Route } from '@playwright/test';
import { execFileSync } from 'child_process';
import { mkdirSync } from 'fs';
import { join } from 'path';

/**
 * Phase 1 remediation (spec §11.6.2).
 *
 * A. UI runtime contract tests (U1-U7): route interception, frontend behaviour only.
 * B. Real frontend + backend tests (L1-L7): the local backend on the verified
 *    throwaway database, synthetic users, no interception.
 *
 * Runs only against a local scratch stack:
 *   P1_BASE_URL   frontend (default http://localhost:3100)
 *   P1_API_URL    backend  (default http://localhost:3101/api)
 *   P1_PASSWORD   the synthetic accounts' test password (never printed)
 *   P1_PSQL / PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE for the two
 *   L5 fixture changes, refused unless they name 127.0.0.1:55432/apex_phase1_e2e.
 */

const BASE = process.env.P1_BASE_URL ?? 'http://localhost:3100';
const API = process.env.P1_API_URL ?? 'http://localhost:3101/api';
const PASSWORD = process.env.P1_PASSWORD ?? '';
const SHOTS = process.env.P1_SHOTS ?? join(__dirname, '..', 'test-results', 'phase1-screens');
mkdirSync(SHOTS, { recursive: true });

test.describe.configure({ mode: 'serial' });
// An already-installed Chromium may be named explicitly (no browser download).
if (process.env.P1_CHROMIUM) test.use({ launchOptions: { executablePath: process.env.P1_CHROMIUM } });

const ADMIN = 'p1-admin@phase1.test';
const EMPLOYEE = 'p1-emp@phase1.test';

for (const [name, value] of Object.entries({ BASE, API })) {
  if (!/^http:\/\/(localhost|127\.0\.0\.1):31\d\d/.test(value)) throw new Error(`${name} must point at the local Phase 1 scratch stack`);
}

function sql(statement: string) {
  if (process.env.PGHOST !== '127.0.0.1' || process.env.PGPORT !== '55432' || process.env.PGDATABASE !== 'apex_phase1_e2e') {
    throw new Error('Refusing to touch any database but 127.0.0.1:55432/apex_phase1_e2e');
  }
  execFileSync(process.env.P1_PSQL ?? 'psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', statement], { stdio: 'pipe' });
}

async function apiLogin(email: string): Promise<string> {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  const j: any = await res.json();
  const token = j.access_token ?? j.accessToken ?? j.token;
  if (!token) throw new Error(`login failed for ${email}: ${res.status}`);
  return token;
}

async function api(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/login`);
  await page.locator('input[type="email"]').waitFor({ state: 'visible', timeout: 90000 });
  await page.waitForLoadState('networkidle'); // hydrated, so the submit handler is attached
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  if (page.url().includes('/welcome')) {
    await page.locator('button:has-text("Enter Apex OS")').click({ timeout: 30000 });
    await page.waitForURL((u) => !u.pathname.startsWith('/welcome'), { timeout: 30000 });
  }
  if (page.url().includes('/select-mode')) {
    await page.locator('button', { has: page.locator('h2') }).first().click();
    await page.waitForURL((u) => !u.pathname.startsWith('/select-mode'), { timeout: 30000 });
  }
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false });
}

function remediation(code: string, over: Record<string, unknown> = {}) {
  return {
    code,
    remediationClass: 'ADMIN_FIXABLE_FRONTEND',
    severity: 'BLOCKING',
    blockingScope: 'OPERATION',
    title: 'Role no longer exists',
    problem: 'The selected role was removed while this form was open.',
    whyItMatters: 'A user must have a valid role before they can sign in.',
    correctionSteps: ['Choose another role.', 'Submit again.'],
    actions: [{ id: 'COPY_DIAGNOSTIC', kind: 'COPY_DIAGNOSTIC', label: 'Copy diagnostic' }],
    canSystemRepair: false,
    requiresManualExternalAction: false,
    requiresBackendOperations: false,
    status: 'OPEN',
    lastCheckedAt: new Date().toISOString(),
    operationId: 'op-ui-contract',
    notificationRecipients: [],
    ...over,
  };
}

const conflict = (r: unknown) => (route: Route) =>
  route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ statusCode: 409, error: 'REMEDIATION', remediation: r, code: (r as any).code, message: (r as any).problem }) });

const dialog = (page: Page) => page.getByTestId('remediation-dialog');

async function openUsers(page: Page, filter?: 'archived') {
  await page.goto(`${BASE}/users`);
  await expect(page.getByRole('button', { name: /Add User/ })).toBeVisible({ timeout: 60000 });
  if (filter) await page.locator('select').filter({ hasText: 'Active & Inactive' }).selectOption(filter);
}

// ════════════════════════════════════════════════════════════════════════════
// A. UI runtime contract tests (interception; frontend behaviour only)
// ════════════════════════════════════════════════════════════════════════════

test.describe('A. UI runtime contract', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, ADMIN);
  });

  test('U1 + U4 + U6: Create User keeps every value; unknown action not rendered; keyboard stays inside; focus returns to submit', async ({ page }) => {
    await openUsers(page);
    await page.getByRole('button', { name: /Add User/ }).click();
    const modal = page.locator('div').filter({ has: page.getByRole('heading', { name: 'Add New User' }) }).last();
    const values = { name: 'Contract Test User', email: 'contract-user@phase1.test', password: 'Secret-12345', joining: '2026-10-20' };
    await modal.getByPlaceholder('Rajesh Kumar').fill(values.name);
    await modal.getByPlaceholder('rajesh@technoedge.com').fill(values.email);
    await modal.getByPlaceholder('Min 6 characters').fill(values.password);
    await modal.locator('select').first().selectOption({ label: 'EMPLOYEE' });
    await modal.locator('select').nth(1).selectOption({ label: 'Phase 1 Test Dept' });
    await modal.locator('input[type="date"]').fill(values.joining);
    const payload = remediation('ROLE_NOT_FOUND_OR_REMOVED', {
      actions: [
        { id: 'COPY_DIAGNOSTIC', kind: 'COPY_DIAGNOSTIC', label: 'Copy diagnostic' },
        { id: 'DELETE_ALL_USERS', kind: 'NAVIGATE', label: 'Delete everything' },
      ],
    });
    await page.route('**/api/users', (route) => (route.request().method() === 'POST' ? conflict(payload)(route) : route.continue()));
    const submit = modal.getByRole('button', { name: 'Create User' });
    await submit.click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toHaveAttribute('data-remediation-code', 'ROLE_NOT_FOUND_OR_REMOVED');
    // U4: an action id outside the allow-list is not in the DOM.
    await expect(page.locator('[data-action="DELETE_ALL_USERS"]')).toHaveCount(0);
    await expect(page.locator('[data-action="COPY_DIAGNOSTIC"]')).toBeVisible();
    await shot(page, 'U1-create-user-remediation');

    // U6: Tab and Shift+Tab stay inside the dialog.
    for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
      await page.keyboard.press(key);
      expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="remediation-dialog"]'))).toBe(true);
    }
    await shot(page, 'U6-keyboard-focus-inside');
    // Escape closes the dialog only; focus returns to the exact submit button.
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(submit).toBeFocused();
    // Every field kept its value and the modal stayed open.
    await expect(page.getByRole('heading', { name: 'Add New User' })).toBeVisible();
    await expect(modal.getByPlaceholder('Rajesh Kumar')).toHaveValue(values.name);
    await expect(modal.getByPlaceholder('rajesh@technoedge.com')).toHaveValue(values.email);
    await expect(modal.getByPlaceholder('Min 6 characters')).toHaveValue(values.password);
    await expect(modal.locator('input[type="date"]')).toHaveValue(values.joining);
    expect(await modal.locator('select').first().evaluate((s: HTMLSelectElement) => s.selectedOptions[0]?.text)).toBe('EMPLOYEE');
    expect(await modal.locator('select').nth(1).evaluate((s: HTMLSelectElement) => s.selectedOptions[0]?.text)).toBe('Phase 1 Test Dept');
  });

  test('U2: Rehire keeps password, return date, role, department and email', async ({ page }) => {
    await openUsers(page, 'archived');
    await page.getByRole('button', { name: 'Rehire P1 Rehire Candidate' }).click();
    await page.locator('#rehire-email').fill('rehired-again@phase1.test');
    await page.locator('#rehire-password').fill('Rehire-12345');
    await page.locator('#rehire-role').selectOption({ label: 'EMPLOYEE' });
    await page.locator('#rehire-department').selectOption({ label: 'Phase 1 Test Dept' });
    await page.locator('#rehire-joining').fill('2026-11-02');
    await page.route('**/api/users/p1-rehire/rehire', conflict(remediation('ROLE_NOT_FOUND_OR_REMOVED')));
    await page.getByRole('button', { name: 'Rehire user' }).click();
    await expect(dialog(page)).toBeVisible();
    await shot(page, 'U2-rehire-remediation');
    await page.locator('[data-action="CLOSE"]').click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator('#rehire-email')).toHaveValue('rehired-again@phase1.test');
    await expect(page.locator('#rehire-password')).toHaveValue('Rehire-12345');
    await expect(page.locator('#rehire-joining')).toHaveValue('2026-11-02');
    expect(await page.locator('#rehire-role').evaluate((s: HTMLSelectElement) => s.selectedOptions[0]?.text)).toBe('EMPLOYEE');
    expect(await page.locator('#rehire-department').evaluate((s: HTMLSelectElement) => s.selectedOptions[0]?.text)).toBe('Phase 1 Test Dept');
    // The Permanent Delete payload is never involved.
    await expect(page.getByRole('heading', { name: 'Permanently delete user?' })).toHaveCount(0);
  });

  test('U3: Leave keeps type, dates, half-day and reason (warning, non-blocking)', async ({ page }) => {
    await page.route('**/api/leave/balance**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ casual: { total: 10, used: 0, remaining: 10 }, remaining: 10, totalRemaining: 10 }) }));
    await page.goto(`${BASE}/leave`);
    await page.getByRole('button', { name: /Apply Leave/ }).first().click({ timeout: 60000 });
    const form = page.locator('div').filter({ has: page.getByRole('heading', { name: 'Apply for Leave' }) }).last();
    await form.locator('select').first().selectOption('CASUAL');
    await form.locator('input[type="date"]').nth(0).fill('2026-11-10');
    await form.locator('input[type="date"]').nth(1).fill('2026-11-10');
    await form.locator('input[type="checkbox"]').first().check();
    await form.locator('textarea').fill('Contract test reason');
    await page.route('**/api/leave', (route) => (route.request().method() === 'POST'
      ? conflict(remediation('LEAVE_CALENDAR_UNRESOLVED', { remediationClass: 'WARNING_NON_BLOCKING', severity: 'WARNING', title: 'Holiday calendar not resolved', problem: 'No holiday calendar applies to these dates yet.' }))(route)
      : route.continue()));
    await form.getByRole('button', { name: 'Submit Request' }).click();
    await expect(dialog(page)).toBeVisible();
    await expect(page.getByTestId('remediation-severity')).toContainText('Warning');
    await shot(page, 'U3-leave-remediation');
    await page.locator('[data-action="CLOSE"]').click();
    await expect(page.getByRole('heading', { name: 'Apply for Leave' })).toBeVisible();
    await expect(form.locator('select').first()).toHaveValue('CASUAL');
    await expect(form.locator('input[type="date"]').nth(0)).toHaveValue('2026-11-10');
    await expect(form.locator('input[type="date"]').nth(1)).toHaveValue('2026-11-10');
    await expect(form.locator('input[type="checkbox"]').first()).toBeChecked();
    await expect(form.locator('textarea')).toHaveValue('Contract test reason');
  });

  test('U5: a manual-external payload with an injected Safe Repair shows no Safe Repair', async ({ page }) => {
    await openUsers(page);
    await page.getByRole('button', { name: 'Archive P1 Employee' }).click();
    const archive = page.getByRole('button', { name: /^(Archive user|Close active work and archive user)$/ });
    await expect(archive).toBeEnabled({ timeout: 30000 });
    await page.route('**/api/user-lifecycle/p1-emp/archive', conflict(remediation('ARCHIVE_PRIVACY_FAILED', {
      remediationClass: 'MANUAL_EXTERNAL', requiresManualExternalAction: true, canSystemRepair: true, retryEndpoint: 'ARCHIVE_PREFLIGHT', affectedUserId: 'p1-emp',
      title: 'Archive privacy check failed', problem: 'Part of the archive location is shared beyond the archive account.',
      actions: [{ id: 'SAFE_REPAIR', kind: 'SAFE_REPAIR', label: 'Repair safely' }, { id: 'RETRY_VERIFICATION', kind: 'RETRY_VERIFICATION', label: 'Retry verification' }, { id: 'COPY_DIAGNOSTIC', kind: 'COPY_DIAGNOSTIC', label: 'Copy diagnostic' }],
    })));
    await archive.click();
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator('[data-action="SAFE_REPAIR"]')).toHaveCount(0);
    await expect(page.locator('[data-action="RETRY_VERIFICATION"]')).toBeVisible();
    await shot(page, 'U5-no-safe-repair');
  });

  test('U7: leave setup status labels', async ({ page }) => {
    const row = (id: string, setupStatus: string | null) => ({
      id, userId: 'p1-admin', type: 'CASUAL', status: 'APPROVED', startDate: '2026-09-01T00:00:00.000Z', endDate: '2026-09-01T00:00:00.000Z', reason: `Row ${id}`,
      isHalfDay: false, setupStatus, duration: 1, user: { id: 'p1-admin', name: `Leave ${id}`, role: { name: 'ADMIN' } },
    });
    await page.route('**/api/leave?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([row('r1', 'RESOLVED'), row('r2', 'POLICY_SETUP_PENDING'), row('r3', null)]) }));
    await page.route('**/api/leave', (route) => (route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([row('r1', 'RESOLVED'), row('r2', 'POLICY_SETUP_PENDING'), row('r3', null)]) })
      : route.continue()));
    await page.goto(`${BASE}/leave`);
    const expected: Record<string, string> = { r1: 'Policy resolved', r2: 'Policy setup pending', r3: 'Not assessed (legacy)' };
    for (const [id, label] of Object.entries(expected)) {
      await page.getByText(`Leave ${id}`, { exact: true }).click({ timeout: 60000 });
      await expect(page.getByTestId('leave-setup-status').filter({ hasText: label })).toBeVisible();
    }
    await shot(page, 'U7-leave-setup-labels');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// B. Real frontend + backend (no interception)
// ════════════════════════════════════════════════════════════════════════════

async function openDeleteFor(page: Page, name: string) {
  await openUsers(page, 'archived');
  await page.getByRole('button', { name: `Permanently delete ${name}` }).click();
  await expect(dialog(page)).toBeVisible({ timeout: 30000 });
}

async function noHorizontalOverflow(page: Page) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(sw).toBeLessThanOrEqual(iw);
  const box = await dialog(page).boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(iw + 0.5);
  for (const b of await page.locator('[data-testid="remediation-actions"] button').all()) {
    await expect(b).toBeVisible();
    await b.click({ trial: true });
  }
}

const notifSave = (page: Page) =>
  page.locator('div').filter({ has: page.getByTestId('notification-center-note') }).last().getByRole('button', { name: 'Save Preferences' });

test.describe('B. real frontend and backend', () => {
  // Re-runnable: L5 releases the L3 hold, so put it back first.
  test.beforeAll(() => {
    sql(`UPDATE user_legal_holds SET status = 'ACTIVE', "releasedById" = NULL, "releasedAt" = NULL, "releaseReason" = NULL WHERE id = 'hold-l3'`);
  });

  test('L1: Confirm Archive with the vault not ready -> ARCHIVE_VAULT_NOT_READY from the POST; user stays active', async ({ page }) => {
    await login(page, ADMIN);
    await openUsers(page);
    await page.getByRole('button', { name: 'Archive P1 Archive Vault' }).click();
    const archive = page.getByRole('button', { name: /^(Archive user|Close active work and archive user)$/ });
    await expect(archive).toBeEnabled({ timeout: 30000 });
    const post = page.waitForResponse((r) => r.url().endsWith('/api/user-lifecycle/p1-l1/archive') && r.request().method() === 'POST');
    await archive.click();
    const res = await post;
    const body = await res.json();
    expect(res.status()).toBe(409);
    expect(body.error).toBe('REMEDIATION');
    expect(body.remediation.code).toBe('ARCHIVE_VAULT_NOT_READY');
    await expect(dialog(page)).toHaveAttribute('data-remediation-code', 'ARCHIVE_VAULT_NOT_READY');
    await expect(page.locator('[data-action="SAFE_REPAIR"]')).toHaveCount(0);
    await expect(page.locator('[data-action="COPY_DIAGNOSTIC"]')).toBeVisible();
    await shot(page, 'L1-archive-vault-not-ready');
    for (const [w, h] of [[1280, 800], [375, 812]]) {
      await page.setViewportSize({ width: w, height: h });
      await noHorizontalOverflow(page);
      await shot(page, `L6-L1-width-${w}`);
    }
    const token = await apiLogin(ADMIN);
    const user = await api('GET', '/users/p1-l1', token);
    expect(user.json.isActive).toBe(true);
  });

  test('L2: keys missing, no hold -> LIFECYCLE_KEYS_MISSING, no Safe Repair', async ({ page }) => {
    await login(page, ADMIN);
    await openDeleteFor(page, 'P1 Keys Missing');
    await expect(dialog(page)).toHaveAttribute('data-remediation-code', 'LIFECYCLE_KEYS_MISSING');
    await expect(page.locator('[data-action="SAFE_REPAIR"]')).toHaveCount(0);
    // Retention, when it blocks at all, only appears among the other blockers.
    const others = page.locator('[data-detail="otherBlockers"]');
    if (await others.count()) await expect(others).not.toContainText('Deletion keys not configured');
    await shot(page, 'L2-keys-missing');
  });

  test('L3 + L5 + L6: active hold wins; Retry Verification re-runs the server preflight after the hold is released', async ({ page }) => {
    await login(page, ADMIN);
    await openDeleteFor(page, 'P1 Hold Active');
    await expect(dialog(page)).toHaveAttribute('data-remediation-code', 'LEGAL_HOLD_ACTIVE');
    await expect(page.locator('[data-detail="otherBlockers"]')).toContainText('Deletion keys not configured');
    await shot(page, 'L3-legal-hold-active');
    for (const [w, h] of [[1280, 800], [375, 812]]) {
      await page.setViewportSize({ width: w, height: h });
      await noHorizontalOverflow(page);
      await shot(page, `L6-L3-width-${w}`);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await shot(page, 'L5-before-retry');
    sql(`UPDATE user_legal_holds SET status = 'RELEASED', "releasedById" = 'p1-admin', "releasedAt" = now(), "releaseReason" = 'Released for the L5 test' WHERE id = 'hold-l3'`);
    const req = page.waitForRequest((r) => r.url().endsWith('/api/user-lifecycle/p1-l3/permanent-delete/preflight'));
    await page.locator('[data-action="RETRY_VERIFICATION"]').click();
    await req;
    await expect(dialog(page)).toHaveAttribute('data-remediation-code', 'LIFECYCLE_KEYS_MISSING');
    await shot(page, 'L5-after-retry');
  });

  test('L4: requested hold -> LEGAL_HOLD_REQUESTED, "Awaiting hold review"', async ({ page }) => {
    await login(page, ADMIN);
    await openDeleteFor(page, 'P1 Hold Requested');
    await expect(dialog(page)).toHaveAttribute('data-remediation-code', 'LEGAL_HOLD_REQUESTED');
    await expect(dialog(page).getByRole('heading', { name: 'Awaiting hold review' })).toBeVisible();
    await shot(page, 'L4-legal-hold-requested');
  });

  test('L7: muted popup and push -> the record is in Notification Center and no popup appears', async ({ page }) => {
    await login(page, EMPLOYEE);
    await page.goto(`${BASE}/settings?tab=profile`);
    const row = page.locator('[data-event="commentAdded"]');
    await expect(row).toBeVisible({ timeout: 60000 });
    const popup = row.getByRole('switch', { name: 'Comment added: popup' });
    const push = row.getByRole('switch', { name: 'Comment added: push' });
    // Control: popup on, so a toast DOES appear for this event. Wait for the
    // server preferences to load before reading the switches.
    await page.waitForLoadState('networkidle');
    if ((await popup.getAttribute('aria-checked')) !== 'true') await popup.click();
    if ((await push.getAttribute('aria-checked')) === 'true') await push.click();
    await notifSave(page).click();
    await expect(page.getByText('Notification preferences saved')).toBeVisible();
    const admin = await apiLogin(ADMIN);
    await page.goto(`${BASE}/dashboard`);
    await page.waitForTimeout(3000); // socket connected
    expect((await api('POST', '/tickets/t-p1-l7/comments', admin, { content: 'L7 control comment' })).status).toBeLessThan(300);
    await expect(page.getByText('New comment on TKT-P1-L7').first()).toBeVisible({ timeout: 15000 });

    // Mute popup and push for the event.
    await page.goto(`${BASE}/settings?tab=profile`);
    await expect(row).toBeVisible({ timeout: 60000 });
    // The saved control preference (popup on) loads from the server first.
    await expect(popup).toHaveAttribute('aria-checked', 'true', { timeout: 15000 });
    await popup.click();
    await expect(popup).toHaveAttribute('aria-checked', 'false');
    await expect(push).toHaveAttribute('aria-checked', 'false');
    await notifSave(page).click();
    await expect(page.getByText('Notification preferences saved')).toBeVisible();
    const me = await apiLogin(EMPLOYEE);
    const prefs = await api('GET', '/users/me/preferences', me);
    // Effective channels exactly as the backend computes them: popup muted by the
    // channel choice; push off by the channel or by the legacy `false`.
    const own = prefs.json.channels?.commentAdded ?? {};
    expect(own.popup).toBe(false);
    expect(own.push === false || (own.push === undefined && prefs.json.commentAdded === false)).toBe(true);

    await page.goto(`${BASE}/dashboard`);
    await page.waitForTimeout(3000);
    const before = (await api('GET', '/notifications', me)).json;
    const count = (Array.isArray(before) ? before : before?.notifications ?? []).length;
    expect((await api('POST', '/tickets/t-p1-l7/comments', admin, { content: 'L7 muted comment' })).status).toBeLessThan(300);
    await page.waitForTimeout(5000);
    // No popup or toast for the muted event.
    await expect(page.locator('[role="status"]').filter({ hasText: 'New comment on TKT-P1-L7' })).toHaveCount(0);
    // The record is in Notification Center.
    const after = (await api('GET', '/notifications', me)).json;
    expect((Array.isArray(after) ? after : after?.notifications ?? []).length).toBe(count + 1);
    await page.reload();
    await page.locator('button:has(svg.lucide-bell)').first().click();
    await expect(page.getByText('New comment on TKT-P1-L7').first()).toBeVisible({ timeout: 15000 });
    await shot(page, 'L7-notification-center');
  });
});
