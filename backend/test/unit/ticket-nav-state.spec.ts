import * as fs from 'fs';
import * as path from 'path';
import {
  BACK_ORIGIN_KEY,
  BACK_ORIGIN_WINDOW_MS,
  HISTORY_STATE_KEY,
  MAX_ENTRIES,
  NAV_STATE_PREFIX,
  NAV_STATE_TTL_MS,
  NAV_TAB_KEY,
  acceptEnvelope,
  buildEnvelope,
  clearAllStored,
  draftRowFrom,
  isSafeBackTarget,
  isValidEnvelope,
  pruneStored,
  readHistory,
  readStored,
  storageKey,
  syncStoredOwner,
  tabIdFor,
  takeBackOrigin,
  ticketIdFromHref,
  writeBackOrigin,
  writeHistory,
  writeStored,
  type KeyStorage,
  type KanbanNav,
  type TicketDraftNav,
  type TicketsNav,
} from '../../../platforms/operations/tickets/lifecycle/shared/ticket-nav-state';

// Phase 6C: navigation state (Back/Forward, filters, scroll, New Ticket draft).
// The pure module is tested directly; the browser wiring is checked from source.

const REPO = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');

class MemStorage implements KeyStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  dump() { return Object.fromEntries(this.m); }
}

class FakeHistory {
  state: unknown = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ['', { children: ['tickets', {}] }] };
  calls: Array<{ data: unknown; url?: unknown }> = [];
  replaceState(data: unknown, _unused: string, url?: unknown) { this.state = data; this.calls.push({ data, url }); }
}

const U1 = 'user-one-id';
const U2 = 'user-two-id';
const TAB = 'tab-abc';
const NOW = Date.UTC(2026, 9, 6, 9, 0, 0);
const at = (overrides: Partial<{ userId: string; tabId: string; path: string; nowMs: number }> = {}) =>
  ({ userId: U1, tabId: TAB, path: '/tickets?status=OPEN&page=2', nowMs: NOW, ...overrides });
const want = <P extends 'tickets' | 'kanban' | 'ticket-new'>(page: P, overrides: Record<string, any> = {}) =>
  ({ userId: U1, tabId: TAB, page, path: '/tickets?status=OPEN&page=2', nowMs: NOW + 1000, ...overrides });

const tickets: TicketsNav = { tab: 'approvals', scroll: { x: 0, y: 1240 } };
const kanban: KanbanNav = { departmentId: 'dept_1', search: 'printer', board: { x: 640, y: 120 }, columns: { OPEN: 300, REVIEW: 0 } };
const draftRow = {
  type: 'QUERY', priority: 'HIGH', departmentId: 'd1', taskTypeId: 'tt1', taskSubtypeId: '__custom__',
  assigneeIds: ['u9', 'u10'], targetDepartmentId: 'd2', projectId: '', startDate: '2026-10-06', startTime: '10:30',
  dueDate: '2026-10-08', dueTime: '', estHours: '2', estMinutes: '30', scheduledEndAt: '',
  recurrence: { mode: 'none', oneTimeAt: '', endPreset: '1_month', endDate: '' },
} as const;
const draft: TicketDraftNav = {
  globals: { departmentId: 'd1', projectId: '', priority: 'MEDIUM', taskTypeId: '', taskSubtypeId: '' },
  rows: [{ ...draftRow, assigneeIds: [...draftRow.assigneeIds], recurrence: { ...draftRow.recurrence } }],
};

describe('envelopes: versioned, whitelisted, owned, fresh', () => {
  it('round-trips each page through its schema', () => {
    for (const [page, data, path] of [['tickets', tickets, '/tickets'], ['kanban', kanban, '/kanban'], ['ticket-new', draft, '/tickets/new']] as const) {
      const env = buildEnvelope(page as any, data as any, at({ path }))!;
      expect(env).not.toBeNull();
      expect(isValidEnvelope(JSON.parse(JSON.stringify(env)))).toBe(true);
      expect(acceptEnvelope(JSON.parse(JSON.stringify(env)), want(page as any, { path }))).toEqual(data);
    }
  });

  it('rejects unknown fields anywhere: envelope, page data, nested objects, draft rows', () => {
    const env: any = buildEnvelope('tickets', tickets, at())!;
    expect(isValidEnvelope({ ...env, token: 'x' })).toBe(false);
    expect(isValidEnvelope({ ...env, data: { ...tickets, role: 'ADMIN' } })).toBe(false);
    expect(isValidEnvelope({ ...env, data: { ...tickets, scroll: { x: 1, y: 2, z: 3 } } })).toBe(false);
    const d: any = buildEnvelope('ticket-new', draft, at({ path: '/tickets/new' }))!;
    for (const extra of [{ title: 'Secret' }, { description: 'x' }, { notes: 'x' }, { customSubtype: 'x' }, { attachments: [] }, { comments: [] }]) {
      expect(isValidEnvelope({ ...d, data: { ...draft, rows: [{ ...draft.rows[0], ...extra }] } })).toBe(false);
    }
    expect(isValidEnvelope({ ...d, data: { ...draft, globals: { ...draft.globals, email: 'a@b.c' } } })).toBe(false);
  });

  it('rejects wrong shapes: free text where an id goes, bad dates, negative or huge scroll, bad enums, missing fields', () => {
    const base: any = buildEnvelope('ticket-new', draft, at({ path: '/tickets/new' }))!;
    const row = draft.rows[0];
    const bad = [
      { ...row, assigneeIds: ['Jane Doe <jane@x>'] },
      { ...row, departmentId: 'not an id!' },
      { ...row, dueDate: '08/10/2026' },
      { ...row, startTime: '9am' },
      { ...row, estHours: '1e9' },
      { ...row, type: 'BUG' },
      { ...row, priority: 'CRITICAL' },
    ];
    for (const r of bad) expect(isValidEnvelope({ ...base, data: { ...draft, rows: [r] } })).toBe(false);
    expect(isValidEnvelope({ ...base, data: { ...draft, rows: [] } })).toBe(false);
    const { dueDate: _omit, ...missing } = row as any;
    expect(isValidEnvelope({ ...base, data: { ...draft, rows: [missing] } })).toBe(false);
    const k: any = buildEnvelope('kanban', kanban, at({ path: '/kanban' }))!;
    expect(isValidEnvelope({ ...k, data: { ...kanban, board: { x: -1, y: 0 } } })).toBe(false);
    expect(isValidEnvelope({ ...k, data: { ...kanban, board: { x: Infinity, y: 0 } } })).toBe(false);
    expect(isValidEnvelope({ ...k, data: { ...kanban, columns: { BACKLOG: 10 } } })).toBe(false);
    expect(isValidEnvelope({ ...k, data: { ...kanban, search: 'a'.repeat(201) } })).toBe(false);
    expect(isValidEnvelope({ ...k, v: 2 })).toBe(false);
    expect(isValidEnvelope({ ...k, path: 'https://evil.example/kanban' })).toBe(false);
    expect(isValidEnvelope({ ...k, path: '//evil.example' })).toBe(false);
    expect(buildEnvelope('kanban', { ...kanban, extra: 1 } as any, at())).toBeNull(); // never written either
  });

  it('is only ever returned to the same user, tab, page and path', () => {
    const env = JSON.parse(JSON.stringify(buildEnvelope('tickets', tickets, at())));
    expect(acceptEnvelope(env, want('tickets'))).toEqual(tickets);
    expect(acceptEnvelope(env, want('tickets', { userId: U2 }))).toBeNull();
    expect(acceptEnvelope(env, want('tickets', { userId: null }))).toBeNull();
    expect(acceptEnvelope(env, want('tickets', { tabId: 'other-tab' }))).toBeNull();
    expect(acceptEnvelope(env, want('kanban'))).toBeNull();
    expect(acceptEnvelope(env, want('tickets', { path: '/tickets?status=DONE' }))).toBeNull();
  });

  it('expires after 30 minutes, and a timestamp from the future is not trusted', () => {
    const env = JSON.parse(JSON.stringify(buildEnvelope('tickets', tickets, at())));
    expect(NAV_STATE_TTL_MS).toBe(30 * 60_000);
    expect(acceptEnvelope(env, want('tickets', { nowMs: NOW + NAV_STATE_TTL_MS }))).toEqual(tickets);
    expect(acceptEnvelope(env, want('tickets', { nowMs: NOW + NAV_STATE_TTL_MS + 1 }))).toBeNull();
    expect(acceptEnvelope(env, want('tickets', { nowMs: NOW - 1 }))).toBeNull();
  });
});

describe('sessionStorage fallback', () => {
  it('writes under a user- and tab-namespaced key and reads it back', () => {
    const s = new MemStorage();
    writeStored(s, buildEnvelope('tickets', tickets, at())!);
    const key = storageKey(U1, TAB, 'tickets', '/tickets?status=OPEN&page=2');
    expect(key.startsWith(NAV_STATE_PREFIX)).toBe(true);
    expect(key).toContain(U1);
    expect(key).toContain(TAB);
    expect(readStored(s, want('tickets'))).toEqual(tickets);
  });

  it('corrupt JSON, schema failures and expired entries are ignored and removed', () => {
    const s = new MemStorage();
    const key = storageKey(U1, TAB, 'tickets', '/tickets?status=OPEN&page=2');
    s.setItem(key, '{not json');
    expect(readStored(s, want('tickets'))).toBeNull();
    expect(s.getItem(key)).toBeNull();

    s.setItem(key, JSON.stringify({ ...buildEnvelope('tickets', tickets, at()), data: { tab: 'all', scroll: { x: 0, y: 0 }, token: 'abc' } }));
    expect(readStored(s, want('tickets'))).toBeNull();
    expect(s.getItem(key)).toBeNull();

    writeStored(s, buildEnvelope('tickets', tickets, at())!);
    expect(readStored(s, want('tickets', { nowMs: NOW + NAV_STATE_TTL_MS + 5 }))).toBeNull();
    expect(s.getItem(key)).toBeNull();
  });

  it('another user signing in on the same browser can never read the previous user\'s state', () => {
    const s = new MemStorage();
    writeStored(s, buildEnvelope('tickets', tickets, at())!);
    expect(readStored(s, want('tickets', { userId: U2 }))).toBeNull();
    // Even a key forged to look like U2's holds U1's envelope: refused and removed.
    const forged = storageKey(U2, TAB, 'tickets', '/tickets?status=OPEN&page=2');
    s.setItem(forged, s.getItem(storageKey(U1, TAB, 'tickets', '/tickets?status=OPEN&page=2'))!);
    expect(readStored(s, want('tickets', { userId: U2 }))).toBeNull();
    expect(s.getItem(forged)).toBeNull();
  });

  it('a user change keeps only the new user\'s entries; logout or expiry (no user) clears everything', () => {
    const s = new MemStorage();
    s.setItem(NAV_TAB_KEY, TAB);
    s.setItem('unrelated-key', 'keep me');
    writeStored(s, buildEnvelope('tickets', tickets, at())!);
    writeStored(s, buildEnvelope('kanban', kanban, at({ userId: U2, path: '/kanban' }))!);
    syncStoredOwner(s, U2, NOW + 1000);
    expect(readStored(s, want('kanban', { userId: U2, path: '/kanban' }))).toEqual(kanban);
    expect(Object.keys(s.dump()).filter((k) => k.includes(U1))).toEqual([]);

    syncStoredOwner(s, null, NOW + 2000);
    expect(Object.keys(s.dump())).toEqual(['unrelated-key']);
    s.setItem(BACK_ORIGIN_KEY, 'x');
    clearAllStored(s);
    expect(Object.keys(s.dump())).toEqual(['unrelated-key']);
  });

  it('stays bounded: at most MAX_ENTRIES per tab, oldest dropped first, expired pruned on write', () => {
    const s = new MemStorage();
    for (let i = 0; i < MAX_ENTRIES + 10; i++) {
      writeStored(s, buildEnvelope('tickets', tickets, at({ path: `/tickets?page=${i}`, nowMs: NOW + i }))!);
    }
    const kept = Object.keys(s.dump()).filter((k) => k.startsWith(NAV_STATE_PREFIX));
    expect(kept).toHaveLength(MAX_ENTRIES);
    expect(kept.some((k) => k.endsWith('/tickets?page=0'))).toBe(false);
    expect(kept.some((k) => k.endsWith(`/tickets?page=${MAX_ENTRIES + 9}`))).toBe(true);
    expect(pruneStored(s, U1, NOW + NAV_STATE_TTL_MS + 100)).toBe(MAX_ENTRIES);
  });

  it('the tab id is created once and reused', () => {
    const s = new MemStorage();
    const id = tabIdFor(s, () => '1b4e28ba-2fa1-11d2-883f-0016d3cca427');
    expect(id).toBe('1b4e28ba-2fa1-11d2-883f-0016d3cca427');
    expect(tabIdFor(s, () => 'different')).toBe(id);
    s.setItem(NAV_TAB_KEY, '<script>');
    expect(tabIdFor(s, () => 'fresh-id')).toBe('fresh-id');
  });
});

describe('history.state', () => {
  it('keeps Next.js router keys and adds only ours; never changes the URL', () => {
    const h = new FakeHistory();
    const before = h.state as Record<string, unknown>;
    writeHistory(h, buildEnvelope('tickets', tickets, at())!);
    const after = h.state as Record<string, unknown>;
    expect(after.__NA).toBe(true);
    expect(after.__PRIVATE_NEXTJS_INTERNALS_TREE).toBe(before.__PRIVATE_NEXTJS_INTERNALS_TREE);
    expect(Object.keys(after).sort()).toEqual(['__NA', '__PRIVATE_NEXTJS_INTERNALS_TREE', HISTORY_STATE_KEY].sort());
    expect(h.calls[0].url).toBeUndefined();
    expect(readHistory(h, want('tickets'))).toEqual(tickets);

    writeHistory(h, null);
    expect(Object.keys(h.state as object).sort()).toEqual(['__NA', '__PRIVATE_NEXTJS_INTERNALS_TREE']);
  });

  it('ignores a foreign or malformed history entry', () => {
    const h = new FakeHistory();
    h.state = { [HISTORY_STATE_KEY]: { ...buildEnvelope('tickets', tickets, at()), userId: U2 } };
    expect(readHistory(h, want('tickets'))).toBeNull();
    h.state = null;
    expect(readHistory(h, want('tickets'))).toBeNull();
    h.state = { [HISTORY_STATE_KEY]: 'garbage' };
    expect(readHistory(h, want('tickets'))).toBeNull();
  });
});

describe('ticket detail Back', () => {
  it('only the Tickets list or Kanban is a safe history target', () => {
    for (const p of ['/tickets', '/tickets?status=OPEN&page=3', '/kanban']) expect(isSafeBackTarget(p)).toBe(true);
    for (const p of ['/tickets/abc', '/tickets/new', '/dashboard', 'https://evil.example/tickets', '//evil/tickets', '', null]) {
      expect(isSafeBackTarget(p as any)).toBe(false);
    }
  });

  it('the origin is honoured once, for that ticket, that user, and only right after the click', () => {
    const s = new MemStorage();
    writeBackOrigin(s, U1, '/tickets?status=REVIEW', 'tkt_1', NOW);
    expect(takeBackOrigin(s, U1, 'tkt_1', NOW + 500)).toBe('/tickets?status=REVIEW');
    expect(takeBackOrigin(s, U1, 'tkt_1', NOW + 600)).toBeNull(); // consumed

    writeBackOrigin(s, U1, '/kanban', 'tkt_1', NOW);
    expect(takeBackOrigin(s, U1, 'tkt_2', NOW + 1)).toBeNull(); // another ticket
    writeBackOrigin(s, U1, '/kanban', 'tkt_1', NOW);
    expect(takeBackOrigin(s, U2, 'tkt_1', NOW + 1)).toBeNull(); // another user
    writeBackOrigin(s, U1, '/kanban', 'tkt_1', NOW);
    expect(takeBackOrigin(s, U1, 'tkt_1', NOW + BACK_ORIGIN_WINDOW_MS + 1)).toBeNull(); // too old
    writeBackOrigin(s, U1, '/dashboard', 'tkt_1', NOW);
    expect(s.getItem(BACK_ORIGIN_KEY)).toBeNull(); // never written for an unsafe page
    s.setItem(BACK_ORIGIN_KEY, '{oops');
    expect(takeBackOrigin(s, U1, 'tkt_1', NOW)).toBeNull();
  });

  it('reads the ticket id from a list link, never from /tickets/new or other paths', () => {
    expect(ticketIdFromHref('/tickets/clx123abc')).toBe('clx123abc');
    expect(ticketIdFromHref('/tickets/clx123abc?from=x')).toBe('clx123abc');
    for (const h of ['/tickets/new', '/tickets', '/projects/1', 'https://x/tickets/1', null]) expect(ticketIdFromHref(h as any)).toBeNull();
  });
});

describe('New Ticket draft holds no text', () => {
  it('draftRowFrom copies only the whitelisted non-text fields out of a full form row', () => {
    const formRow = {
      key: 'row-1', title: 'Payroll for Jane', description: 'Confidential details', notes: 'private', customSubtype: 'free text',
      errors: ['x'], showAdvanced: true, custom: { priority: true }, aiReason: 'because', aiBusy: false,
      ...draftRow, assigneeIds: ['u9'], recurrence: { ...draftRow.recurrence, extra: 'no' },
    };
    const out = draftRowFrom(formRow);
    const json = JSON.stringify(out);
    for (const secret of ['Payroll', 'Confidential', 'private', 'free text', 'because', 'extra']) expect(json).not.toContain(secret);
    const env = buildEnvelope('ticket-new', { globals: draft.globals, rows: [out] }, at({ path: '/tickets/new' }));
    expect(env).not.toBeNull();
  });
});

describe('browser wiring (source checks)', () => {
  const hook = read('platforms/operations/tickets/lifecycle/frontend/components/use-ticket-nav-state.ts');
  const lib = read('platforms/operations/tickets/lifecycle/shared/ticket-nav-state.ts');
  const ticketsPage = read('frontend/app/(dashboard)/(operations)/tickets/page.tsx');
  const kanban = read('platforms/operations/tickets/lifecycle/frontend/screens/KanbanScreen.tsx');
  const detail = read('frontend/app/(dashboard)/(operations)/tickets/[id]/page.tsx');
  const newPage = read('frontend/app/(dashboard)/(operations)/tickets/new/page.tsx');

  it('the navigation-state code has no network or mutation path at all', () => {
    for (const src of [hook, lib]) {
      expect(src).not.toMatch(/from ['"][^'"]*(api|axios|shared-auth|react-query)[^'"]*['"]/);
      expect(src).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon|\.mutate\(|workdayApi|ticketsApi/);
      expect(src).not.toMatch(/localStorage/); // per-tab only
    }
  });

  it('nothing sensitive is named in what the pages save', () => {
    // The save calls pass only these shapes.
    expect(ticketsPage).toContain('nav.save({ tab: tabRef.current, scroll: scrollOf(mainScrollElement()) })');
    expect(newPage).toContain('rows: rows.map((r) => draftRowFrom(r))');
    for (const forbidden of ['token', 'password', 'email', 'role', 'permission', 'title', 'description', 'comment', 'attachment', 'timer', 'workday', 'session']) {
      expect(lib.slice(lib.indexOf('// ── Page schemas'), lib.indexOf('// ── Envelope'))).not.toMatch(new RegExp(`\\b${forbidden}\\b\\s*:`, 'i'));
    }
  });

  it('restoration only sets local state, the URL-free scroll and filters; it never calls a mutation', () => {
    const restoreBlocks = [
      ticketsPage.slice(ticketsPage.indexOf('useTicketNavState('), ticketsPage.indexOf('useRecordTicketOpen(pageRef')),
      kanban.slice(kanban.indexOf("useTicketNavState('kanban'"), kanban.indexOf("useRecordTicketOpen(screenRef")),
      newPage.slice(newPage.indexOf("useTicketNavState('ticket-new'"), newPage.indexOf('// Runs on mount')),
    ];
    for (const block of restoreBlocks) {
      expect(block.length).toBeGreaterThan(100);
      expect(block).not.toMatch(/Api\.|\.mutate\(|mutateAsync|fetch\(|router\.(push|replace)/);
    }
  });

  it('ticket detail Back uses history only for a recorded Tickets/Kanban origin, else /tickets', () => {
    const back = detail.slice(detail.indexOf('const backOrigin'), detail.indexOf('if (isLoading) return <SkeletonTicketDetail />'));
    expect(back).toContain('useTicketBackOrigin(id, user?.id)');
    expect(back).toMatch(/else if \(backOrigin\(\)\) \{\s*router\.back\(\);/);
    expect(back).toContain("router.push('/tickets')");
  });

  it('the draft is cleared on Cancel and on a successful submit', () => {
    expect(newPage).toContain('const handleCancel = () => { draft.clear(); handleBack(); };');
    expect(newPage).toMatch(/const onSuccess = \(created: any\[\]\) => \{\s*draft\.clear\(\);/);
    expect(newPage).toContain('onClick={handleCancel}');
  });

  it('saved state is cleared on logout / user change (dashboard shell) and on the login page (expiry)', () => {
    expect(read('frontend/app/(dashboard)/layout.tsx')).toContain('syncStoredOwner(window.sessionStorage, isAuthenticated ? user?.id : null, Date.now())');
    expect(read('frontend/app/(auth)/login/page.tsx')).toContain('clearAllStored(window.sessionStorage)');
  });
});
