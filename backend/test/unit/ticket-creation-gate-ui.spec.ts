import * as fs from 'fs';
import * as path from 'path';
import {
  ACTIVE_WORKDAY_REQUIRED,
  PUNCH_IN_TO_CREATE_MESSAGE,
  isActiveWorkdayRequiredError,
  ticketCreationGate,
} from '../../../platforms/operations/tickets/lifecycle/shared/ticket-creation-gate';
import {
  ACTIVE_WORKDAY_REQUIRED as BACKEND_CODE,
  ACTIVE_WORKDAY_REQUIRED_MESSAGE,
  activeWorkdayRequired,
  isPunchedInSession,
  ticketCreationState,
} from '../../src/common/services/active-workday-policy.service';
import { computeClientTimingState, computeWorkBudget, dueCountdownText, workBudgetBadge } from '../../../platforms/operations/tickets/sla/shared/ticket-timing';

// Phase 3B/3D frontend behaviour, tested through the pure modules the UI renders
// from (this repo has no browser test runner), plus source checks that every
// creation control goes through the gate.

const REPO = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');

describe('ticket creation gate (UI)', () => {
  const settled = { isLoading: false, isError: false };

  it('the UI and the API use the same code and message', () => {
    expect(ACTIVE_WORKDAY_REQUIRED).toBe(BACKEND_CODE);
    expect(PUNCH_IN_TO_CREATE_MESSAGE).toBe(ACTIVE_WORKDAY_REQUIRED_MESSAGE);
    expect(PUNCH_IN_TO_CREATE_MESSAGE).toBe('Punch In before creating a ticket.');
  });

  it('punched out: disabled, with the message', () => {
    const today = { session: null, ticketCreation: ticketCreationState(false) };
    expect(ticketCreationGate(today, settled)).toEqual({
      allowed: false, pending: false, reason: 'Punch In before creating a ticket.',
    });
  });

  it('punched in: enabled, no message', () => {
    const today = { session: { status: 'WORKING' }, ticketCreation: ticketCreationState(true) };
    expect(ticketCreationGate(today, settled)).toEqual({ allowed: true, pending: false, reason: null });
  });

  it('Punch In then Punch Out: the gate follows each refetched workday answer', () => {
    const states = [false, true, false].map((punchedIn) =>
      ticketCreationGate({ ticketCreation: ticketCreationState(punchedIn) }, settled).allowed);
    expect(states).toEqual([false, true, false]);
  });

  it('still loading: disabled while it checks, never enabled on a guess', () => {
    expect(ticketCreationGate(undefined, { isLoading: true, isError: false })).toEqual({
      allowed: false, pending: true, reason: 'Checking your workday…',
    });
  });

  it('fails closed: workday unreadable → disabled with "Unable to verify your workday. Refresh and try again."', () => {
    expect(ticketCreationGate(undefined, { isLoading: false, isError: true })).toEqual({
      allowed: false, pending: false, reason: 'Unable to verify your workday. Refresh and try again.',
    });
  });

  it('fails closed: an answer without a ticketCreation verdict, or a query that has not run, never enables creation', () => {
    expect(ticketCreationGate({ session: null }, settled)).toEqual({
      allowed: false, pending: false, reason: 'Unable to verify your workday. Refresh and try again.',
    });
    expect(ticketCreationGate(undefined, settled)).toMatchObject({ allowed: false, pending: true }); // disabled query
    expect(ticketCreationGate({ ticketCreation: { allowed: 'yes' } }, settled).allowed).toBe(false);
  });

  it('fails closed: a cached "allowed" answer whose refetch failed no longer enables creation', () => {
    const cachedAllowed = { ticketCreation: ticketCreationState(true) };
    expect(ticketCreationGate(cachedAllowed, { isLoading: false, isError: true })).toEqual({
      allowed: false, pending: false, reason: 'Unable to verify your workday. Refresh and try again.',
    });
  });

  it('a refetch that succeeds after a failure re-enables creation', () => {
    const states = [
      ticketCreationGate(undefined, { isLoading: false, isError: true }),
      ticketCreationGate({ ticketCreation: ticketCreationState(true) }, settled),
    ].map((g) => g.allowed);
    expect(states).toEqual([false, true]);
  });

  it('recognises the backend 409 in each shape the client produces, and nothing else', () => {
    const body = (activeWorkdayRequired().getResponse() as any);
    expect(isActiveWorkdayRequiredError(body)).toBe(true); // shared client: rejects with the body
    expect(isActiveWorkdayRequiredError({ ...body, status: 409 })).toBe(true); // body + status
    expect(isActiveWorkdayRequiredError({ response: { status: 409, data: body } })).toBe(true); // raw AxiosError
    expect(isActiveWorkdayRequiredError({ statusCode: 409, message: 'One active timer conflict', code: 'ONE_ACTIVE_TIMER_CONFLICT' })).toBe(false);
    expect(isActiveWorkdayRequiredError(new Error('network'))).toBe(false);
    expect(isActiveWorkdayRequiredError(undefined)).toBe(false);
  });
});

describe('GET /workday/today ticketCreation (same rule as the API)', () => {
  it.each([
    ['WORKING', null, true],
    ['ON_BREAK', null, true],
    ['IDLE', null, true],
    ['LOGGED_IN', null, false],
    ['ON_LEAVE', null, false],
    ['LOGGED_OUT', new Date(), false],
    ['AUTO_CLOSED', new Date(), false],
    ['WORKING', new Date(), false],
  ])('%s (logoutAt %p) → punched in: %p', (status, logoutAt, expected) => {
    expect(isPunchedInSession({ status: status as string, logoutAt: logoutAt as Date | null })).toBe(expected);
  });

  it('no session is not punched in', () => {
    expect(isPunchedInSession(null)).toBe(false);
    expect(ticketCreationState(false)).toEqual({ allowed: false, code: BACKEND_CODE, message: ACTIVE_WORKDAY_REQUIRED_MESSAGE });
  });
});

describe('every creation control goes through the gate', () => {
  const ENTRY_POINTS: Array<[string, RegExp]> = [
    ['frontend/components/layout/topbar.tsx', /<CreateTicketLink[\s\S]*?New Ticket[\s\S]*?<\/CreateTicketLink>/],
    ['frontend/app/(dashboard)/(operations)/tickets/page.tsx', /<CreateTicketLink className="apex-btn-new-ticket">/],
    ['platforms/operations/tickets/lifecycle/frontend/screens/KanbanScreen.tsx', /<CreateTicketLink className="apex-btn-new-ticket">/],
    ['platforms/operations/projects/project-management/frontend/screens/ProjectDetailScreen.tsx', /<CreateTicketLink href=\{`\/tickets\/new\?projectId=/],
    ['platforms/intelligence/dashboard/overview/frontend/components/QuickActionStrip.tsx', /a\.url === '\/tickets\/new' && !ticketGate\.allowed/],
    ['platforms/intelligence/dashboard/overview/frontend/screens/DashboardScreen.tsx', /\.\.\.\(!ticketGate\.allowed \? \[\] : \[\{\s*id: 'new-ticket'/],
    ['frontend/app/(dashboard)/layout.tsx', /\.\.\.\(!ticketGate\.allowed \? \[\] : \[\{\s*id: 'new-ticket'/],
    ['frontend/components/ui/QuickActionDock.tsx', /label: '\+ Ticket'[^\n]*\n\s*disabled: !ticketGate\.allowed, title: ticketGate\.reason/],
  ];

  it.each(ENTRY_POINTS)('%s is gated', (file, pattern) => {
    expect(read(file)).toMatch(pattern);
  });

  it('no ungated link or navigation to /tickets/new remains', () => {
    const roots = ['frontend/app', 'frontend/components', 'platforms'];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
        const rel = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(rel); continue; }
        if (!/\.tsx?$/.test(entry.name)) continue;
        read(rel).split(/\r?\n/).forEach((line, i) => {
          if (/<Link[^>]*href=["{`]+\/tickets\/new/.test(line)) offenders.push(`${rel}:${i + 1}`);
        });
      }
    };
    roots.forEach(walk);
    expect(offenders).toEqual([]);
  });

  it('a disabled creation link stays keyboard-focusable and announces its reason', () => {
    const gate = read('platforms/operations/tickets/lifecycle/frontend/components/ticket-creation-gate.tsx');
    const disabled = gate.slice(gate.indexOf('if (!gate.allowed)'), gate.indexOf('<Link href={href}'));
    expect(disabled).toMatch(/role="link"/);
    expect(disabled).toMatch(/aria-disabled="true"/);
    expect(disabled).toContain('tabIndex={0}');
    expect(disabled).toContain('aria-describedby={gate.reason ? reasonId : undefined}');
    expect(disabled).toContain('<span id={reasonId} style={VISUALLY_HIDDEN}>{gate.reason}</span>');
    expect(disabled).not.toMatch(/onClick/); // nothing to activate
    // The quick-action strip keeps its button focusable too (aria-disabled, not disabled).
    const strip = read('platforms/intelligence/dashboard/overview/frontend/components/QuickActionStrip.tsx');
    expect(strip).toContain('aria-disabled={disabled || undefined}');
    expect(strip).toContain('onClick={() => { if (!disabled) router.push(a.url); }}');
    expect(strip).not.toContain(' disabled={disabled}');
  });

  it('the create page disables Create and Import while punched out and handles the 409', () => {
    const page = read('frontend/app/(dashboard)/(operations)/tickets/new/page.tsx');
    expect(page).toMatch(/<button type="submit" disabled=\{submitting \|\| !canCreate\}/);
    expect(page).toMatch(/onClick=\{\(\) => fileInputRef\.current\?\.click\(\)\} disabled=\{importing \|\| !canCreate\}/);
    expect(page).toMatch(/!canCreate && creationGate\.reason/); // the explanation banner
    expect((page.match(/if \(handleActiveWorkdayRequired\(err\)\) return;/g) ?? []).length).toBe(2); // form + Excel import
    expect(page).toMatch(/qc\.invalidateQueries\(\{ queryKey: WORKDAY_TODAY_QUERY_KEY \}\)/);
  });

  it('Punch In / Punch Out refresh the shared workday state the gate reads', () => {
    const bar = read('frontend/components/workday/WorkdayBar.tsx');
    expect(bar).toMatch(/queryKey: \['workday-today'\]/);
    expect(bar).toMatch(/onClose=\{\(\) => \{ setPunchType\(null\); refetch\(\); \}\}/);
    expect(bar).toMatch(/onPunched=\{\(\) => \{ setPunchType\(null\); refetch\(\); \}\}/);
    const gate = read('platforms/operations/tickets/lifecycle/frontend/components/ticket-creation-gate.tsx');
    expect(gate).toMatch(/queryKey: WORKDAY_TODAY_QUERY_KEY/);
  });

  it('Start Time and the estimate stay optional on the create page', () => {
    const page = read('frontend/app/(dashboard)/(operations)/tickets/new/page.tsx');
    const validate = page.slice(page.indexOf('const validateRow'), page.indexOf('const rowToPayload'));
    expect(validate).not.toMatch(/startTime\) e\.push|Start Time is required|Estimate.* is required|estHours.*required/);
    expect(page).toMatch(/estimatedMinutes: estTotal > 0 \? estTotal : undefined/);
  });
});

describe('ticket timing labels (3D)', () => {
  const asOf = '2026-09-29T07:00:00.000Z';
  const t0 = new Date(asOf).getTime();
  const base = (over: Record<string, any> = {}) => ({
    status: 'IN_PROGRESS',
    isBlocked: false,
    assignedTo: { name: 'Employee A' },
    workBudget: { cycle: 'ORIGINAL', estimatedMinutes: 60, workedSeconds: 6 * 60, running: true, asOf, pause: null },
    ...over,
  });

  it('running comes from timers.activeClock when the response has it', () => {
    expect(computeWorkBudget(base({ timers: { activeClock: 'EMPLOYEE_WORK' } }), t0)!.running).toBe(true);
    // A stale workBudget.running never overrides the ledger's activeClock.
    expect(computeWorkBudget(base({ timers: { activeClock: 'NONE' } }), t0)!.running).toBe(false);
    expect(computeWorkBudget(base({ timers: { activeClock: 'REVIEWER_APPROVAL' } }), t0)!.running).toBe(false);
    expect(workBudgetBadge(base({ timers: { activeClock: 'NONE' } }), t0)).toMatchObject({ tone: 'paused' });
  });

  it('a paused clock does not count down between refetches', () => {
    const paused = base({ timers: { activeClock: 'NONE' } });
    expect(computeWorkBudget(paused, t0 + 10 * 60_000)!.label).toBe('54m left');
  });

  it('"Time Left: No estimate" is separate from the "Due in" deadline clock', () => {
    const noEstimate = base({
      timers: { activeClock: 'EMPLOYEE_WORK' },
      workBudget: { cycle: 'ORIGINAL', estimatedMinutes: null, workedSeconds: 0, running: true, asOf },
      timing: { timerType: 'execution', dueAt: new Date(t0 + 33 * 60_000).toISOString(), remainingMs: 33 * 60_000, isOverdue: false },
    });
    expect(computeWorkBudget(noEstimate, t0)).toBeNull(); // the page then shows "Time Left: No estimate"
    const text = dueCountdownText(computeClientTimingState(noEstimate));
    expect(text).toBe('Due in 33m');
    expect(text).not.toMatch(/left/);
  });

  it('a rework cycle without its own estimate says so, never the original estimate', () => {
    const rework = base({ workBudget: { cycle: 'REWORK', estimatedMinutes: null, workedSeconds: 120, running: false, asOf } });
    expect(computeWorkBudget(rework, t0)).toMatchObject({ label: 'No rework estimate', cycle: 'REWORK', estimatedMinutes: 0 });
  });

  it('the ticket page calls lifecycle time "Ticket age", and its timer status uses activeClock only', () => {
    const page = read('frontend/app/(dashboard)/(operations)/tickets/[id]/page.tsx');
    expect(page).not.toMatch(/Total Ticket Time/);
    expect(page).toMatch(/Ticket age: \{Math\.floor\(ticket\.timers\.totalTicketSeconds/);
    const status = page.slice(page.indexOf('function workTimerStatus'), page.indexOf('function TimingHeaderSummary'));
    expect(status).toMatch(/ticket\?\.timers\?\.activeClock === 'EMPLOYEE_WORK'/);
    expect(status).not.toMatch(/workBudget\?\.running/);
  });
});
