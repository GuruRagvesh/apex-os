import * as fs from 'fs';
import * as path from 'path';
import { csvCell, TICKET_LIST_ORDER, TicketsService } from '../../src/modules/operations/tickets/tickets.service';
import { createdFilterBound } from '../../src/common/services/ticket-access.service';
import { linkifyText, safeHttpUrl } from '../../../platforms/operations/tickets/lifecycle/shared/linkify';
import {
  companyPlanningNow,
  companyWallClockToIso,
  companyDateTimeLocalToIso,
  withStartDate,
} from '../../../platforms/operations/tickets/lifecycle/shared/ticket-planning-date';
import { NO_RECURRENCE, RECURRENCE_OPTIONS, recurrencePayload } from '../../../platforms/operations/tickets/lifecycle/shared/ticket-recurrence';
import { buildTicketEditPayload } from '../../../platforms/operations/tickets/lifecycle/shared/ticket-edit-payload';
import { pruneReminderKeys, reminderKey } from '../../../frontend/lib/approval-reminder-keys';

// Phase 6A: pure rules behind export, filters, ordering, links, planning
// defaults, the recurrence control, the edit payload and reminder storage,
// plus source checks for wiring that only renders in a browser.

const repo = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(repo, rel), 'utf8');

describe('A. CSV cells', () => {
  it('quotes every cell and doubles embedded quotes; commas stay inside the cell', () => {
    expect(csvCell('a, "b"')).toBe('"a, ""b"""');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(12.5)).toBe('"12.5"');
  });

  it('flattens line breaks', () => {
    expect(csvCell('one\ntwo\r\nthree\rfour')).toBe('"one two three four"');
  });

  it.each([
    ['=SUM(A1:A2)'], ['+1'], ['-1+1'], ['@cmd'], ['\t=1'], ['\r=1'],
    ['  =HYPERLINK("x")'], ['\t+1'], ['\n=1'], [' \t @x'],
  ])('neutralises a formula-like value %j with a leading apostrophe', (value) => {
    expect(csvCell(value).startsWith(`"'`)).toBe(true);
  });

  it('leaves ordinary text alone', () => {
    expect(csvCell('Fix = in the totals')).toBe('"Fix = in the totals"');
    expect(csvCell('TKT-001')).toBe('"TKT-001"');
  });

  it('export pages through every result and reads productive work in one batch', async () => {
    const service = Object.create(TicketsService.prototype) as any;
    const all = Array.from({ length: 1203 }, (_, i) => ({
      id: `t${i}`, ticketId: `TKT-${i}`, title: `T ${i}`, createdAt: new Date('2026-10-05T03:00:00Z'), updatedAt: new Date('2026-10-05T03:00:00Z'),
    }));
    service.findAll = jest.fn(async (q: any, _u: any, opts: any) => {
      expect(opts?.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
      const start = (q.page - 1) * q.limit;
      return { tickets: all.slice(start, start + q.limit), total: all.length, page: q.page, limit: q.limit, totalPages: Math.ceil(all.length / q.limit) };
    });
    service.ticketLedger = { getEmployeeWorkSecondsMany: jest.fn(async () => new Map([['t0', 5400]])) };
    service.tva = { companyBusinessDate: (d: Date) => d.toISOString().slice(0, 10) };
    const csv: string = await service.exportCsv({ page: 9, limit: 3 }, { id: 'u' });
    expect(csv.split('\n')).toHaveLength(1 + 1203);
    expect(service.findAll).toHaveBeenCalledTimes(3);
    expect(service.ticketLedger.getEmployeeWorkSecondsMany).toHaveBeenCalledTimes(1);
    expect(csv.split('\n')[1]).toContain('"1.5"');
  });
});

describe('D. list order', () => {
  it('is most recently changed first, then newest created, then id', () => {
    expect(TICKET_LIST_ORDER).toEqual([{ updatedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]);
  });
});

describe('P. created-date filter bounds', () => {
  it('a date is a whole company (IST) day, inclusive at both ends', () => {
    expect(createdFilterBound('2026-10-05', 'start')!.toISOString()).toBe('2026-10-04T18:30:00.000Z');
    expect(createdFilterBound('2026-10-05', 'end')!.toISOString()).toBe('2026-10-05T18:29:59.999Z');
  });
  it('a full timestamp is used as given; empty or invalid input is ignored', () => {
    expect(createdFilterBound('2026-10-05T10:00:00.000Z', 'end')!.toISOString()).toBe('2026-10-05T10:00:00.000Z');
    expect(createdFilterBound('', 'start')).toBeUndefined();
    expect(createdFilterBound('not-a-date', 'start')).toBeUndefined();
    expect(createdFilterBound(undefined, 'end')).toBeUndefined();
  });
});

describe('O. safe links', () => {
  const links = (s: string) => linkifyText(s).filter((x) => x.kind === 'link').map((x: any) => x.href);

  it('turns http and https URLs into links and keeps the rest as text with line breaks', () => {
    const segs = linkifyText('See https://example.com/a?b=1\nthen http://x.test/p');
    expect(links('See https://example.com/a?b=1\nthen http://x.test/p')).toEqual(['https://example.com/a?b=1', 'http://x.test/p']);
    expect(segs.map((s) => s.text).join('')).toBe('See https://example.com/a?b=1\nthen http://x.test/p');
  });

  it('leaves trailing sentence punctuation and unbalanced brackets outside the link', () => {
    expect(links('Go to https://example.com.')).toEqual(['https://example.com/']);
    expect(links('(see https://example.com/docs), then')).toEqual(['https://example.com/docs']);
    expect(links('https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)']);
    const text = linkifyText('Done: https://a.test/x!').map((s) => s.text).join('');
    expect(text).toBe('Done: https://a.test/x!');
  });

  it('never links unsafe schemes or malformed URLs', () => {
    for (const s of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:msgbox', 'file:///etc/passwd', 'ftp://x.test', 'http://', 'https://']) {
      expect(links(s)).toEqual([]);
    }
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('https://ok.test')).toBe('https://ok.test/');
  });

  it('cannot inject markup: HTML stays text and the URL stops before it', () => {
    const segs = linkifyText('<img src=x onerror=alert(1)> https://ok.test/<script>');
    expect(segs.filter((s) => s.kind === 'link').map((s: any) => s.href)).toEqual(['https://ok.test/']);
    expect(segs.map((s) => s.text).join('')).toBe('<img src=x onerror=alert(1)> https://ok.test/<script>');
  });

  it('the renderer emits anchors with target=_blank and rel=noopener noreferrer, and no raw HTML', () => {
    const src = read('platforms/operations/tickets/lifecycle/frontend/components/linkified-text.tsx');
    expect(src).toContain('target="_blank"');
    expect(src).toContain('rel="noopener noreferrer"');
    expect(src).not.toContain('dangerouslySetInnerHTML');
    expect(read('frontend/app/(dashboard)/(operations)/tickets/[id]/page.tsx')).toContain('<LinkifiedText text={ticket.description} />');
  });
});

describe('K. planning defaults in company time', () => {
  it('"now" is the company date and time, whatever the browser zone', () => {
    expect(companyPlanningNow(new Date('2026-10-04T20:00:00.000Z'))).toEqual({ date: '2026-10-05', time: '01:30' });
    expect(companyPlanningNow(new Date('2026-10-05T12:59:30.000Z'))).toEqual({ date: '2026-10-05', time: '18:29' });
  });

  it('date + time is company wall clock; date only keeps the 18:30 IST convention; no date, no value', () => {
    expect(companyWallClockToIso('2026-10-05', '09:00')).toBe('2026-10-05T03:30:00.000Z');
    expect(companyWallClockToIso('2026-10-05', '')).toBe('2026-10-05T13:00:00.000Z');
    expect(companyWallClockToIso('', '09:00')).toBeUndefined();
    expect(companyWallClockToIso('2026-10-05', '9am')).toBeUndefined();
    expect(companyDateTimeLocalToIso('2026-10-05T23:45')).toBe('2026-10-05T18:15:00.000Z');
  });

  it('clearing Start Date clears Start Time; Start Time alone stays optional', () => {
    expect(withStartDate({ startDate: '2026-10-05', startTime: '10:00' }, '')).toEqual({ startDate: '', startTime: '' });
    expect(withStartDate({ startDate: '', startTime: '' }, '2026-10-06')).toEqual({ startDate: '2026-10-06', startTime: '' });
    expect(withStartDate({ startDate: '2026-10-05', startTime: '10:00' }, '2026-10-06')).toEqual({ startDate: '2026-10-06', startTime: '10:00' });
  });

  it('the New Ticket form defaults every row to now (company time) and never sends actualStartAt', () => {
    const src = read('frontend/app/(dashboard)/(operations)/tickets/new/page.tsx');
    expect(src).toContain('startDate: companyPlanningNow().date, startTime: companyPlanningNow().time');
    expect(src).not.toMatch(/actualStartAt\s*:/);
    expect(src).not.toContain("new Date().toISOString().split('T')[0]");
  });
});

describe('L2. restored recurrence control', () => {
  const now = new Date('2026-10-05T03:30:00.000Z');
  it('offers only the values the scheduler already understands', () => {
    expect(RECURRENCE_OPTIONS.map((o) => o.value)).toEqual(['none', 'custom_time', 'daily_morning', 'daily_evening', 'weekly', 'monthly', '1_month', '6_months']);
  });
  it('maps each choice to the existing ticket fields', () => {
    expect(recurrencePayload(NO_RECURRENCE, now)).toEqual({});
    expect(recurrencePayload({ ...NO_RECURRENCE, mode: 'custom_time', oneTimeAt: '2026-10-06T10:00' }, now))
      .toEqual({ scheduledFor: '2026-10-06T04:30:00.000Z' });
    expect(recurrencePayload({ ...NO_RECURRENCE, mode: 'weekly', endPreset: '1_week' }, now))
      .toEqual({ scheduleRecurring: 'weekly', scheduleEndDate: '2026-10-12T03:30:00.000Z' });
    expect(recurrencePayload({ ...NO_RECURRENCE, mode: 'daily_morning', endPreset: 'custom', endDate: '2026-11-01' }, now))
      .toEqual({ scheduleRecurring: 'daily_morning', scheduleEndDate: '2026-11-01' });
    expect(recurrencePayload({ ...NO_RECURRENCE, mode: 'every_minute' as any }, now)).toEqual({});
  });
});

describe('G. edit payload', () => {
  it('sends only the edited fields: never type, category or the legacy hours estimate', () => {
    const body = buildTicketEditPayload({ title: '  New title ', description: 'd', priority: 'HIGH', dueDate: '2026-10-07', estimatedMinutes: '45' } as any);
    expect(body).toEqual({ title: 'New title', description: 'd', priority: 'HIGH', dueDate: '2026-10-07T13:00:00.000Z', estimatedMinutes: 45 });
    expect(Object.keys(buildTicketEditPayload({ title: 't', description: '', priority: 'LOW', dueDate: '', estimatedMinutes: '', type: 'BUG', category: 'IT', estimatedTime: '2' } as any)).sort())
      .toEqual(['description', 'dueDate', 'estimatedMinutes', 'priority', 'title']);
  });
  it('the edit dialog has no Type control', () => {
    const src = read('frontend/app/(dashboard)/(operations)/tickets/[id]/page.tsx');
    expect(src).not.toContain("'TASK', 'BUG', 'FEATURE'");
    expect(src).toContain('editMutation.mutate(buildTicketEditPayload(editForm))');
  });
});

describe('J. reminder storage stays bounded', () => {
  it('removes earlier days\' reminder keys, keeps today\'s, never touches other keys', () => {
    const store = new Map<string, string>([
      [reminderKey('t1', '2026-10-03'), '1'],
      [reminderKey('t1', '2026-10-05'), '2'],
      [reminderKey('t2', '2026-10-04'), '3'],
      ['apex:last-activity-at', '4'],
      ['apex:notified-approval-lookalike', '5'],
    ]);
    const storage = {
      get length() { return store.size; },
      key: (i: number) => [...store.keys()][i] ?? null,
      removeItem: (k: string) => { store.delete(k); },
    };
    const removed = pruneReminderKeys(storage, '2026-10-05');
    expect(removed.sort()).toEqual([reminderKey('t1', '2026-10-03'), reminderKey('t2', '2026-10-04')].sort());
    expect([...store.keys()].sort()).toEqual(['apex:last-activity-at', 'apex:notified-approval-lookalike', reminderKey('t1', '2026-10-05')].sort());
  });
  it('the hook prunes on every evaluation and dates keys by the company day', () => {
    const src = read('frontend/hooks/useApprovalReminders.ts');
    expect(src).toContain('pruneReminderKeys(localStorage, dateKey)');
    expect(src).toContain('formatCompanyDate(d)');
  });
});

describe('B / C / E / F. browser-only wiring (source checks)', () => {
  const list = read('frontend/app/(dashboard)/(operations)/tickets/page.tsx');
  const detail = read('frontend/app/(dashboard)/(operations)/tickets/[id]/page.tsx');

  it('the ticket approval queue has its own cache key, never the user change-request key', () => {
    expect(list).toContain("['ticket-pending-approvals']");
    expect(list).not.toContain("queryKey: ['pending-approvals']");
    expect(list).toContain('Could not load pending approvals');
  });

  it('the Close button is shown only when the backend says the viewer may close', () => {
    expect(detail).toContain('ticket.viewerCanClose && (');
    expect(detail).not.toMatch(/canEdit && \(\s*<button\s*onClick=\{\(\) => updateStatus\.mutate\('CLOSED'\)\}/);
  });

  it('every ticket-changing action on the detail page refreshes the list, counts, queues and clock', () => {
    expect(detail).toContain('const refreshTicketViews = () => {');
    for (const key of ["['tickets']", "['ticket-stats']", "['ticket-pending-approvals']", 'ACTIVE_TIMER_QUERY_KEY']) {
      expect(detail).toContain(`qc.invalidateQueries({ queryKey: ${key} })`);
    }
    const uses = detail.split('refreshTicketViews()').length - 1;
    expect(uses).toBeGreaterThanOrEqual(10);
  });

  it('the assignee filter reads the role-scoped users endpoint, for leads and above only', () => {
    expect(list).toContain("usersApi.getAll({ limit: 100 })");
    expect(list).toContain("['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(roleNameForFilters)");
  });

  it('export refuses a failed response instead of saving it as CSV', () => {
    const api = read('platforms/operations/tickets/lifecycle/frontend/api/tickets-api.ts');
    expect(api).toContain('if (!res.ok) {');
  });

  it('one status badge per row, the same "Under Review" word everywhere', () => {
    const row = read('platforms/operations/tickets/lifecycle/frontend/components/ticket-row.tsx');
    expect(row).not.toMatch(/>\s*Waiting for Review\s*</);
    expect(read('platforms/operations/tickets/lifecycle/shared/ticket-visibility.ts')).toContain("badgeText: 'Under Review'");
  });
});
