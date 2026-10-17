import { test, expect, Page, Locator } from '@playwright/test';

/**
 * Ticket form accessibility (pre-Phase-3 repair).
 *
 * Every rendered input, select and textarea on Create Tickets, Create Default
 * Ticket, the Assigned To dropdown and Manage Default Tickets has an id or a
 * name and a programmatically associated label; no id is duplicated; the
 * multi-assignee picker works from the keyboard. Business rules are unchanged:
 * a Default Ticket still needs only its name and title, several assignees save
 * and reapply, and an Employee is still limited to self-assignment.
 *
 * Runs only against a local scratch stack on a throwaway database:
 *   A11Y_BASE_URL  frontend (default http://localhost:3100)
 *   A11Y_API_URL   backend  (default http://localhost:3101/api)
 *   A11Y_PASSWORD  the local QC accounts' password (prisma/seed-test-users.ts; never printed)
 */

const BASE = process.env.A11Y_BASE_URL ?? 'http://localhost:3100';
const API = process.env.A11Y_API_URL ?? 'http://localhost:3101/api';
const PASSWORD = process.env.A11Y_PASSWORD ?? '';
const ADMIN = 'admin@apex.local';
const EMPLOYEE = 'employee@apex.local';

for (const [name, value] of Object.entries({ BASE, API })) {
  if (!/^http:\/\/(localhost|127\.0\.0\.1):31\d\d/.test(value)) throw new Error(`${name} must point at the local scratch stack`);
}

test.describe.configure({ mode: 'serial' });
if (process.env.A11Y_CHROMIUM) test.use({ launchOptions: { executablePath: process.env.A11Y_CHROMIUM } });

async function apiToken(email: string): Promise<string> {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  const j: any = await res.json();
  const token = j.access_token ?? j.accessToken ?? j.token ?? j.data?.access_token ?? j.data?.accessToken;
  if (!token) throw new Error(`login failed for ${email}: ${res.status}`);
  return token;
}

async function api(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  return { status: res.status, json: json?.data !== undefined && json?.success !== undefined ? json.data : json };
}

async function login(page: Page, email: string) {
  // The desktop-notification prompt is unrelated to these forms; at 375px it covers the modal's buttons.
  await page.addInitScript(() => localStorage.setItem('apex:desktop-notif-prompt-dismissed', 'true'));
  await page.goto(`${BASE}/login`, { timeout: 180000, waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').waitFor({ state: 'visible', timeout: 90000 });
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

async function openCreateTickets(page: Page) {
  await page.goto(`${BASE}/tickets/new`, { timeout: 180000, waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Create Tickets' })).toBeVisible({ timeout: 90000 });
  await expect(page.getByLabel(/Title/).first()).toBeVisible();
}

interface Audit { controls: number; missingIdOrName: string[]; unlabelled: string[]; duplicateIds: string[] }

/**
 * Every rendered input/select/textarea inside `scope` (hidden file inputs
 * included) has an id or name; every visible one has a label (label[for],
 * a wrapping label, aria-label or aria-labelledby); no id repeats on the page.
 */
async function audit(scope: Locator): Promise<Audit> {
  return scope.evaluate((root) => {
    const describe = (el: Element) => `${el.tagName.toLowerCase()}#${el.id || '?'}[name=${el.getAttribute('name') || '?'}]`;
    const controls = Array.from(root.querySelectorAll('input, select, textarea')) as (HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)[];
    const missingIdOrName = controls.filter((c) => !c.id && !c.getAttribute('name')).map(describe);
    const visible = controls.filter((c) => {
      const r = c.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(c).visibility !== 'hidden';
    });
    const named = (c: Element) => {
      const labels = (c as HTMLInputElement).labels;
      if (labels && Array.from(labels).some((l) => (l.textContent ?? '').trim().length > 0)) return true;
      if ((c.getAttribute('aria-label') ?? '').trim()) return true;
      const by = c.getAttribute('aria-labelledby');
      return !!by && by.split(/\s+/).some((id) => (document.getElementById(id)?.textContent ?? '').trim().length > 0);
    };
    const unlabelled = visible.filter((c) => !named(c)).map(describe);
    const ids = Array.from(document.querySelectorAll('[id]')).map((e) => e.id).filter(Boolean);
    const duplicateIds = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    return { controls: controls.length, missingIdOrName, unlabelled, duplicateIds };
  });
}

function expectClean(a: Audit, min: number) {
  expect(a.missingIdOrName).toEqual([]);
  expect(a.unlabelled).toEqual([]);
  expect(a.duplicateIds).toEqual([]);
  expect(a.controls).toBeGreaterThanOrEqual(min);
}

const editor = (page: Page, title = 'Create Default Ticket') => page.getByRole('dialog', { name: title });

let adminToken = '';
const created: string[] = [];

test.beforeAll(async () => {
  if (!PASSWORD) throw new Error('A11Y_PASSWORD is required');
  adminToken = await apiToken(ADMIN);
  // Start from no Default Tickets left by an earlier run on this scratch database.
  const existing = await api('GET', '/ticket-templates', adminToken);
  for (const t of existing.json?.templates ?? []) {
    if (String(t.name).startsWith('A11y ')) await api('DELETE', `/ticket-templates/${t.id}`, adminToken);
  }
});

test.beforeEach(async () => {
  // Keep every Default Ticket visible as a tag so a new one can be applied.
  await api('PATCH', '/ticket-templates/preference', adminToken, { visibleCount: 20 });
});

test.afterAll(async () => {
  for (const id of created) await api('DELETE', `/ticket-templates/${id}`, adminToken).catch(() => undefined);
});

for (const viewport of [{ name: 'desktop', width: 1366, height: 900 }, { name: '375px', width: 375, height: 812 }]) {
  test.describe(`${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('Create Tickets and a normal ticket row: every control has an id/name and a label, no duplicate ids', async ({ page }) => {
      await login(page, ADMIN);
      await openCreateTickets(page);
      // Show the conditional controls too: custom subtype, Query target department, advanced scheduling, reminders.
      const form = page.locator('form').first();
      await form.getByLabel('Department *').first().selectOption({ label: 'A11y Operations' }).catch(() => undefined);
      await form.getByRole('button', { name: /Advanced Scheduling/ }).first().click();
      await form.getByLabel('Reminder schedule').first().selectOption({ index: 1 });
      expectClean(await audit(page.locator('body')), 15);
      // The import picker is hidden but still has an id, a name and a label.
      await expect(page.locator('#ticket-import-file')).toHaveAttribute('name', 'ticketImportFile');
      // Labels resolve to their control.
      await expect(form.getByLabel(/Priority/).first()).toHaveJSProperty('tagName', 'SELECT');
      await expect(form.getByLabel('Description').first()).toHaveJSProperty('tagName', 'TEXTAREA');
      // A second row gets its own ids.
      await page.getByRole('button', { name: /Duplicate This Ticket/ }).first().click();
      expectClean(await audit(page.locator('body')), 30);
    });

    test('Create Default Ticket and the Assigned To dropdown are labelled and keyboard accessible', async ({ page }) => {
      await login(page, ADMIN);
      await openCreateTickets(page);
      await page.getByRole('button', { name: 'Create Default Tickets' }).click();
      const dlg = editor(page);
      await expect(dlg).toBeVisible();
      for (const label of ['Default Ticket Name', 'Ticket Title', 'Description', 'Department', 'Task Type', 'Subtype', 'Priority', 'Project (optional)', 'Estimated Hours', 'Estimated Minutes']) {
        await expect(dlg.getByLabel(label, { exact: true })).toBeVisible();
      }
      expectClean(await audit(dlg), 10);

      await dlg.getByLabel('Department', { exact: true }).selectOption({ label: 'A11y Operations' });
      const trigger = dlg.getByRole('button', { name: 'Assigned To' });
      await expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await trigger.focus();
      await page.keyboard.press('Enter');
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      const list = dlg.getByRole('listbox');
      await expect(list).toHaveAttribute('aria-multiselectable', 'true');
      await expect(dlg.getByRole('combobox', { name: 'Search Assigned To' })).toBeFocused();
      expectClean(await audit(dlg), 11);
      const options = list.getByRole('option');
      expect(await options.count()).toBeGreaterThanOrEqual(2);
      await page.keyboard.press('Enter'); // first option
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter'); // second option
      await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
      await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('Escape');
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await expect(trigger).toBeFocused();
      await expect(dlg).toBeVisible(); // Escape closed only the dropdown
      // Space opens too; each selected person has a descriptive remove button.
      await page.keyboard.press(' ');
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('Escape');
      await expect(dlg.getByRole('button', { name: /^Remove / })).toHaveCount(2);
      await dlg.getByRole('button', { name: 'Cancel' }).click();
    });

    test('a Default Ticket needs only its name and title; several assignees save and reapply', async ({ page }) => {
      await login(page, ADMIN);
      await openCreateTickets(page);
      const stamp = `${viewport.name}-${Date.now()}`;

      // Only the two required fields.
      await page.getByRole('button', { name: 'Create Default Tickets' }).click();
      let dlg = editor(page);
      await dlg.getByLabel('Default Ticket Name').fill(`A11y minimal ${stamp}`);
      await dlg.getByLabel('Ticket Title').fill('Minimal title');
      await dlg.getByRole('button', { name: 'Create Default Ticket' }).click();
      await expect(dlg).toBeHidden({ timeout: 15000 });

      // Missing the title is still refused by the server; nothing else is required.
      const missingTitle = await api('POST', '/ticket-templates', adminToken, { name: `A11y no title ${stamp}`, title: '' });
      expect(missingTitle.status).toBeGreaterThanOrEqual(400);

      // Several assignees, chosen by keyboard.
      await page.getByRole('button', { name: 'Create Default Tickets' }).click();
      dlg = editor(page);
      await dlg.getByLabel('Default Ticket Name').fill(`A11y multi ${stamp}`);
      await dlg.getByLabel('Ticket Title').fill('Multi assignee title');
      await dlg.getByLabel('Department', { exact: true }).selectOption({ label: 'A11y Operations' });
      const trigger = dlg.getByRole('button', { name: 'Assigned To' });
      await trigger.focus();
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Escape');
      await dlg.getByRole('button', { name: 'Create Default Ticket' }).click();
      await expect(dlg).toBeHidden({ timeout: 15000 });

      const list = await api('GET', '/ticket-templates', adminToken);
      const templates: any[] = list.json.templates;
      const minimal = templates.find((t) => t.name === `A11y minimal ${stamp}`);
      const multi = templates.find((t) => t.name === `A11y multi ${stamp}`);
      expect(minimal).toBeTruthy();
      expect(minimal.departmentId ?? null).toBeNull();
      expect(minimal.assigneeIds ?? []).toEqual([]);
      expect(multi.assigneeIds).toHaveLength(2);
      created.push(minimal.id, multi.id);

      // Reapply: the row receives both assignees.
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Create Tickets' })).toBeVisible({ timeout: 60000 });
      await page.getByRole('button', { name: `Apply Default Ticket A11y multi ${stamp}` }).click();
      const apply = page.getByRole('dialog', { name: 'Apply this Default Ticket?' });
      if (await apply.isVisible().catch(() => false)) await apply.getByRole('button', { name: 'Apply Default' }).click();
      const row = page.locator('form').first();
      await expect(row.getByRole('button', { name: /^Remove / })).toHaveCount(2);
      expectClean(await audit(page.locator('body')), 10);
    });

    test('Manage Default Tickets: search and visible count are labelled', async ({ page }) => {
      // The manager appears once there are more than three Default Tickets.
      for (let i = 0; i < 4; i++) {
        const r = await api('POST', '/ticket-templates', adminToken, { name: `A11y manage ${viewport.name} ${i} ${Date.now()}`, title: `Manage ${i}` });
        expect(r.status).toBeLessThan(300);
        created.push(r.json.id ?? r.json.template?.id);
      }
      await login(page, ADMIN);
      await openCreateTickets(page);
      await page.getByRole('button', { name: /Customize/ }).click();
      const dlg = page.getByRole('dialog', { name: 'Manage Default Tickets' });
      await expect(dlg).toBeVisible();
      await expect(dlg.getByLabel('Search Default Tickets')).toHaveAttribute('id', 'default-ticket-manager-search');
      await expect(dlg.getByLabel(/Visible tickets/)).toHaveAttribute('name', 'visibleCount');
      expectClean(await audit(dlg), 2);
      await dlg.getByRole('button', { name: 'Create' }).click();
      // Editor over the manager: still no duplicate ids.
      expectClean(await audit(page.locator('body')), 12);
    });

    test('an Employee is still limited to self-assignment in the Default Ticket form', async ({ page }) => {
      await login(page, EMPLOYEE);
      await openCreateTickets(page);
      await page.getByRole('button', { name: 'Create Default Tickets' }).click();
      const dlg = editor(page);
      await expect(dlg.getByText('Assigned to you')).toBeVisible();
      await expect(dlg.getByRole('button', { name: 'Assigned To' })).toHaveCount(0);
      expectClean(await audit(dlg), 8);
      await dlg.getByRole('button', { name: 'Cancel' }).click();
    });
  });
}
