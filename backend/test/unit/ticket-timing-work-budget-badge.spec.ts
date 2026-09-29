import { workBudgetBadge, computeWorkBudget } from '../../../platforms/operations/tickets/sla/shared/ticket-timing';

// D-2: the list / Kanban badge (TimingTicker) must keep the frozen work-budget
// Time Left for a blocked IN_PROGRESS ticket, like the ticket detail does.
describe('workBudgetBadge (list / Kanban Time Left)', () => {
  const asOf = '2026-09-29T07:00:00.000Z';
  const t0 = new Date(asOf).getTime();
  const ticket = (over: Record<string, any> = {}) => ({
    status: 'IN_PROGRESS',
    isBlocked: false,
    assignedTo: { name: 'Employee A' },
    workBudget: { cycle: 'ORIGINAL', estimatedMinutes: 60, workedSeconds: 6 * 60, running: false, asOf, pause: null },
    ...over,
  });

  it('A. IN_PROGRESS + work budget + blocked renders the work-budget Time Left, marked blocked', () => {
    const b = workBudgetBadge(ticket({ isBlocked: true, workBudget: { ...ticket().workBudget, pause: { reason: 'BLOCKED' } } }), t0);
    expect(b).toEqual({ icon: '⏸', text: '54m left · blocked', tooltip: 'Paused · blocked', tone: 'paused' });
  });

  it('B. Time Left stays frozen while blocked (no local countdown)', () => {
    const blocked = ticket({ isBlocked: true });
    const later = t0 + 10 * 60_000;
    expect(workBudgetBadge(blocked, t0)!.text).toBe('54m left · blocked');
    expect(workBudgetBadge(blocked, later)!.text).toBe('54m left · blocked');
    // Even if a stale payload still says running, a blocked ticket never counts down.
    const staleRunning = ticket({ isBlocked: true, workBudget: { ...ticket().workBudget, running: true } });
    expect(workBudgetBadge(staleRunning, later)).toMatchObject({ icon: '⏸', text: expect.stringContaining('· blocked'), tone: 'paused' });
  });

  it('C. after unblock: running when it becomes active, waiting when another ticket is active', () => {
    const running = ticket({ workBudget: { ...ticket().workBudget, running: true } });
    expect(workBudgetBadge(running, t0)).toEqual({ icon: '⏳', text: '54m left', tooltip: 'Work timer running', tone: 'running' });
    expect(workBudgetBadge(running, t0 + 60_000)!.text).toBe('53m left'); // counts down only while running

    const waiting = ticket({ workBudget: { ...ticket().workBudget, pause: { reason: 'WORKING_ON_OTHER', otherTicketKey: 'TKT-927' } } });
    expect(workBudgetBadge(waiting, t0)).toEqual({
      icon: '⏸', text: '54m left · paused', tooltip: 'Paused · Employee A is on TKT-927', tone: 'paused',
    });
  });

  it('D. the badge uses the same Time Left as the ticket detail (computeWorkBudget)', () => {
    for (const t of [ticket(), ticket({ isBlocked: true }), ticket({ workBudget: { ...ticket().workBudget, running: true } })]) {
      const detail = computeWorkBudget(t, t0)!;
      expect(workBudgetBadge(t, t0)!.text.startsWith(detail.label)).toBe(true);
    }
  });

  it('over estimate stays red-toned; no work budget falls back (null) to the SLA display', () => {
    expect(workBudgetBadge(ticket({ workBudget: { ...ticket().workBudget, workedSeconds: 70 * 60 } }), t0))
      .toMatchObject({ icon: '⏱', text: '10m over estimate · paused', tone: 'over' });
    expect(workBudgetBadge(ticket({ workBudget: null }), t0)).toBeNull();
    expect(workBudgetBadge(ticket({ status: 'REVIEW' }), t0)).toBeNull();
  });
});
