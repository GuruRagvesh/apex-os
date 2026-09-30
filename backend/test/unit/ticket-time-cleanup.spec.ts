/**
 * Unit tests — Phase 2D1 ticket timer cleanup planner and CLI arguments
 * (scripts/lib/ticket-time-cleanup.ts), plus the ledger's handling of the
 * one-active-timer unique index. PostgreSQL behaviour is in
 * test/integration-pg/t3-ticket-time-guardrail.int-spec.ts.
 */
import { ConflictException } from '@nestjs/common';
import {
  ActiveRow,
  CLEANUP_EXIT_CHANGES_REQUIRED,
  CLEANUP_EXIT_OK,
  CLEANUP_REASONS,
  CleanupReport,
  cleanupExitCode,
  formatCleanup,
  parseCleanupArgs,
  pickSurvivor,
  planCleanup,
  stateReasons,
} from '../../scripts/lib/ticket-time-cleanup';
import { AuditConfigError } from '../../scripts/lib/ticket-time-integrity';
import {
  ONE_ACTIVE_TIMER_INDEX,
  TicketLedgerService,
  isOneActiveTimerViolation,
} from '../../src/modules/operations/tickets/ticket-ledger.service';

const DB = 'apex_os_attendance_integration';

const row = (over: Partial<ActiveRow> = {}): ActiveRow => ({
  id: 'l-1',
  userId: 'u-1',
  ticketKey: 'TKT-1',
  startedAt: new Date('2026-08-13T05:00:00Z'),
  stage: 'WORK',
  hasOpenReworkCycle: false,
  ticketStatus: 'IN_PROGRESS',
  isBlocked: false,
  assignedTo: 'u-1',
  userStatus: 'WORKING',
  sessionMissing: false,
  sessionOtherUser: false,
  sessionClosed: false,
  sessionSuperseded: false,
  hasOpenWorkingSession: true,
  ...over,
});

describe('ticket-time cleanup — planner', () => {
  it('a valid active timer needs nothing', () => {
    expect(stateReasons(row())).toEqual([]);
    expect(planCleanup([row()])).toEqual({ inspectedActiveRows: 1, closures: [], survivors: [] });
  });

  it.each<[string, Partial<ActiveRow>, string[]]>([
    ['OPEN ticket', { ticketStatus: 'OPEN' }, ['TICKET_NOT_IN_PROGRESS']],
    ['REVIEW ticket', { ticketStatus: 'REVIEW' }, ['TICKET_NOT_IN_PROGRESS']],
    ['DONE ticket', { ticketStatus: 'DONE' }, ['TICKET_NOT_IN_PROGRESS']],
    ['CLOSED ticket', { ticketStatus: 'CLOSED' }, ['TICKET_NOT_IN_PROGRESS']],
    ['blocked ticket', { isBlocked: true }, ['TICKET_BLOCKED']],
    ['unassigned ticket', { assignedTo: null }, ['TICKET_UNASSIGNED']],
    ['someone else is primary', { assignedTo: 'u-2' }, ['NOT_PRIMARY_ASSIGNEE']],
    ['user on break', { userStatus: 'ON_BREAK' }, ['USER_NOT_WORKING']],
    ['user status missing', { userStatus: null }, ['USER_NOT_WORKING']],
    ['no open WORKING session', { hasOpenWorkingSession: false }, ['NO_OPEN_WORKING_SESSION']],
    ['no linked session', { sessionMissing: true }, ['SESSION_MISSING']],
    ["another user's session", { sessionOtherUser: true }, ['SESSION_OTHER_USER']],
    ['closed session', { sessionClosed: true }, ['SESSION_CLOSED']],
    ['superseded session', { sessionSuperseded: true }, ['SESSION_SUPERSEDED']],
    ['REWORK stage with no open rework cycle', { stage: 'REWORK', hasOpenReworkCycle: false }, ['REWORK_WITHOUT_OPEN_CYCLE']],
  ])('closes a timer on/with a %s', (_label, over, reasons) => {
    expect(stateReasons(row(over))).toEqual(reasons);
    expect(planCleanup([row(over)]).closures).toEqual([{ logId: 'l-1', userId: 'u-1', ticketKey: 'TKT-1', reasons }]);
  });

  it('leaves a REWORK timer alone while its rework cycle is open, and a WORK timer regardless', () => {
    expect(stateReasons(row({ stage: 'REWORK', hasOpenReworkCycle: true }))).toEqual([]);
    expect(stateReasons(row({ stage: 'WORK', hasOpenReworkCycle: true }))).toEqual([]);
  });

  it('never keeps a REWORK timer without an open cycle as a duplicate survivor', () => {
    const plan = planCleanup([
      row({ id: 'w', startedAt: new Date('2026-08-13T05:00:00Z') }),
      row({ id: 'z', startedAt: new Date('2026-08-13T05:30:00Z'), stage: 'REWORK' }),
    ]);
    expect(plan.survivors).toEqual([]);
    expect(plan.closures).toEqual([{ logId: 'z', userId: 'u-1', ticketKey: 'TKT-1', reasons: ['REWORK_WITHOUT_OPEN_CYCLE'] }]);
  });

  it('has no age-based reason: an old but otherwise valid timer is not closed', () => {
    expect(stateReasons(row({ startedAt: new Date('2020-01-01T00:00:00Z') }))).toEqual([]);
    expect(CLEANUP_REASONS).not.toContain('ACTIVE_LOG_OLDER_THAN_THRESHOLD');
  });

  it('reports every reason a row has, in fixed order', () => {
    expect(stateReasons(row({ ticketStatus: 'DONE', isBlocked: true, userStatus: 'OFFLINE', hasOpenWorkingSession: false, sessionClosed: true, sessionSuperseded: true })))
      .toEqual(['TICKET_NOT_IN_PROGRESS', 'TICKET_BLOCKED', 'USER_NOT_WORKING', 'NO_OPEN_WORKING_SESSION', 'SESSION_CLOSED', 'SESSION_SUPERSEDED']);
  });

  it('keeps the most recently started valid timer; ties go to the greatest id', () => {
    const a = row({ id: 'a', startedAt: new Date('2026-08-13T05:00:00Z') });
    const b = row({ id: 'b', startedAt: new Date('2026-08-13T05:30:00Z') });
    const c = row({ id: 'c', startedAt: new Date('2026-08-13T05:30:00Z') });
    expect(pickSurvivor([a, b, c]).id).toBe('c');
    expect(pickSurvivor([c, b, a]).id).toBe('c');
    expect(pickSurvivor([a, b]).id).toBe('b');
  });

  it('closes invalid rows first, then keeps exactly one of the remaining valid ones', () => {
    const rows = [
      row({ id: 'x-old', startedAt: new Date('2026-08-13T04:00:00Z'), ticketKey: 'TKT-A' }),
      row({ id: 'x-new', startedAt: new Date('2026-08-13T05:00:00Z'), ticketKey: 'TKT-B' }),
      // Newest of all, but invalid: it must not be chosen as the survivor.
      row({ id: 'x-bad', startedAt: new Date('2026-08-13T05:30:00Z'), ticketKey: 'TKT-C', ticketStatus: 'REVIEW' }),
      row({ id: 'y-1', userId: 'u-2', assignedTo: 'u-2' }),
    ];
    const plan = planCleanup(rows);
    expect(plan.closures.map((c) => [c.logId, c.reasons])).toEqual([
      ['x-bad', ['TICKET_NOT_IN_PROGRESS']],
      ['x-old', ['DUPLICATE_NOT_SURVIVOR']],
    ]);
    expect(plan.survivors).toEqual([{ userId: 'u-1', keptLogId: 'x-new', keptTicketKey: 'TKT-B', closedLogIds: ['x-old'] }]);
  });

  it('produces the same plan whatever the input order', () => {
    const rows = [
      row({ id: 'p', startedAt: new Date('2026-08-13T05:00:00Z') }),
      row({ id: 'q', startedAt: new Date('2026-08-13T05:00:00Z') }),
      row({ id: 'r', userId: 'u-2', assignedTo: 'u-1' }),
    ];
    expect(planCleanup([...rows].reverse())).toEqual(planCleanup(rows));
  });
});

describe('ticket-time cleanup — arguments, exit codes and output', () => {
  const clock = () => new Date('2026-08-13T06:00:00Z');

  it('is a dry run by default', () => {
    expect(parseCleanupArgs([], DB, clock)).toEqual({
      apply: false,
      json: false,
      options: { repairAt: clock(), sampleLimit: 20 },
    });
  });

  it('applies only with --apply and the exact database name', () => {
    expect(parseCleanupArgs(['--apply', `--confirm-database=${DB}`], DB, clock).apply).toBe(true);
    expect(() => parseCleanupArgs(['--apply'], DB, clock)).toThrow(/--confirm-database/);
    expect(() => parseCleanupArgs(['--apply', '--confirm-database=apex_db_dugl'], DB, clock)).toThrow(AuditConfigError);
    expect(() => parseCleanupArgs([`--confirm-database=${DB}`], DB, clock)).toThrow(/only meaningful with --apply/);
    expect(() => parseCleanupArgs(['--apply=yes', `--confirm-database=${DB}`], DB, clock)).toThrow(AuditConfigError);
  });

  it.each([['--fix'], ['--repair'], ['--force'], ['--yes'], ['--sample=-1'], ['--now=later'], ['--verbose']])(
    'rejects %s',
    (arg) => expect(() => parseCleanupArgs([arg], DB, clock)).toThrow(AuditConfigError),
  );

  const report = (result: CleanupReport['result']): CleanupReport => ({
    mode: result === 'APPLIED' ? 'apply' : 'dry-run',
    result,
    repairAt: '2026-08-13T06:00:00.000Z',
    database: { name: DB, address: '127.0.0.1', port: '55432', serverVersion: '18.6' },
    inspectedActiveRows: 3,
    affectedUsers: 1,
    rowsToClose: result === 'CLEAN' ? 0 : 1,
    reasonCounts: Object.fromEntries(CLEANUP_REASONS.map((r) => [r, r === 'DUPLICATE_NOT_SURVIVOR' && result !== 'CLEAN' ? 1 : 0])) as any,
    survivors: result === 'CLEAN' ? [] : [{ userId: 'u-1', keptLogId: 'l-2', keptTicketKey: 'TKT-2', closedLogIds: ['l-1'] }],
    samples: result === 'CLEAN' ? [] : [{ logId: 'l-1', userId: 'u-1', ticketKey: 'TKT-1', reasons: ['DUPLICATE_NOT_SURVIVOR'] }],
  });

  it('exit codes: 0 clean or applied, 2 changes required', () => {
    expect(cleanupExitCode(report('CLEAN'))).toBe(CLEANUP_EXIT_OK);
    expect(cleanupExitCode(report('APPLIED'))).toBe(CLEANUP_EXIT_OK);
    expect(cleanupExitCode(report('CHANGES_REQUIRED'))).toBe(CLEANUP_EXIT_CHANGES_REQUIRED);
  });

  it('prints the survivor and reasons', () => {
    const text = formatCleanup(report('CHANGES_REQUIRED'));
    expect(text).toContain('Ticket timer cleanup (dry-run): CHANGES_REQUIRED');
    expect(text).toContain('would close 1 rows for 1 users');
    expect(text).toContain('user u-1: kept l-2 [TKT-2], closing l-1');
    expect(text).toContain('DUPLICATE_NOT_SURVIVOR: 1');
  });
});

describe('ledger — one-active-timer index conflicts', () => {
  it('recognises the index violation however Prisma reports it', () => {
    expect(isOneActiveTimerViolation({ code: 'P2002', meta: { modelName: 'TicketTimeLog', target: ['userId'] } })).toBe(true);
    expect(isOneActiveTimerViolation({ code: 'P2002', meta: { target: ONE_ACTIVE_TIMER_INDEX } })).toBe(true);
    expect(isOneActiveTimerViolation({ code: 'P2010', message: `duplicate key value violates unique constraint "${ONE_ACTIVE_TIMER_INDEX}"` })).toBe(true);
    expect(isOneActiveTimerViolation({ code: 'P2002', meta: { modelName: 'User', target: ['email'] } })).toBe(false);
    expect(isOneActiveTimerViolation(new Error('connection reset'))).toBe(false);
    expect(isOneActiveTimerViolation(null)).toBe(false);
  });

  function ledgerWith(tx: jest.Mock) {
    const tva = { now: () => new Date('2026-08-13T06:00:00Z'), elapsedSeconds: () => 0 } as any;
    return new TicketLedgerService({ $transaction: tx } as any, tva);
  }
  const conflict = Object.assign(new Error('Unique constraint failed'), {
    code: 'P2002',
    meta: { modelName: 'TicketTimeLog', target: ['userId'] },
  });
  const input = { ticketId: 't-1', workerId: 'u-1', mode: 'START' as const, source: 'TICKET_STATUS' };

  it('retries once after a conflict and returns the retry result', async () => {
    const tx = jest.fn().mockRejectedValueOnce(conflict).mockResolvedValueOnce({ outcome: 'STARTED' });
    await expect(ledgerWith(tx).startAssigneeTimer(input)).resolves.toEqual({ outcome: 'STARTED' });
    expect(tx).toHaveBeenCalledTimes(2);
  });

  it('turns a repeated conflict into a ConflictException, never a raw database error', async () => {
    const tx = jest.fn().mockRejectedValue(conflict);
    await expect(ledgerWith(tx).startAssigneeTimer(input)).rejects.toBeInstanceOf(ConflictException);
    expect(tx).toHaveBeenCalledTimes(2);
  });

  it('does not swallow other errors', async () => {
    const tx = jest.fn().mockRejectedValue(new Error('connection reset'));
    await expect(ledgerWith(tx).startAssigneeTimer(input)).rejects.toThrow('connection reset');
    expect(tx).toHaveBeenCalledTimes(1);
  });
});
