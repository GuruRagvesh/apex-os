/**
 * Unit tests — ticket timer integrity audit (scripts/lib/ticket-time-integrity.ts).
 *
 * No database. The PostgreSQL behaviour (each invariant, read-only proof, CLI
 * exit codes) is in test/integration-pg/t2-ticket-time-integrity.int-spec.ts.
 */
import {
  AUDIT_DB_NAME,
  AuditConfigError,
  AuditReport,
  CHECKS,
  EXIT_CLEAN,
  EXIT_VIOLATIONS,
  assertAuditTarget,
  exitCodeFor,
  formatHuman,
  parseArgs,
  redactSecrets,
  runChecks,
} from '../../scripts/lib/ticket-time-integrity';

const SECRET = 'Sup3r-Secret-Pa55';
const good = `postgresql://apex_test:${SECRET}@127.0.0.1:55432/${AUDIT_DB_NAME}?schema=public`;

describe('ticket-time integrity audit — database gate', () => {
  it('accepts only the dedicated loopback database', () => {
    expect(assertAuditTarget(good)).toEqual({ host: '127.0.0.1', port: '55432', database: AUDIT_DB_NAME });
    expect(assertAuditTarget(`postgresql://apex_test@localhost/${AUDIT_DB_NAME}`).port).toBe('5432');
  });

  it.each([
    ['missing', undefined],
    ['empty', '   '],
    ['malformed', 'not a url'],
    ['not postgres', `mysql://u:${SECRET}@127.0.0.1:3306/${AUDIT_DB_NAME}`],
    ['remote host', `postgresql://u:${SECRET}@10.0.0.5:5432/${AUDIT_DB_NAME}`],
    ['render host', `postgresql://u:${SECRET}@dpg-abc.oregon-postgres.render.com/${AUDIT_DB_NAME}`],
    ['production word', `postgresql://u:${SECRET}@127.0.0.1:5432/apex_production`],
    ['staging word', `postgresql://u:${SECRET}@127.0.0.1:5432/apex_staging`],
    ['wrong local name', `postgresql://u:${SECRET}@127.0.0.1:5432/apex_os_render_clone_20260928`],
  ])('refuses a %s URL without echoing the password', (_label, url) => {
    let error: unknown;
    try {
      assertAuditTarget(url as string | undefined);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(AuditConfigError);
    expect((error as Error).message).not.toContain(SECRET);
  });

  it('redacts the URL and password from any message', () => {
    const leaked = `connect failed for ${good}; auth ${SECRET}; other postgres://x:y@h/db`;
    const out = redactSecrets(leaked, good);
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain('x:y@');
    expect(out).toContain('<DATABASE_URL>');
  });
});

describe('ticket-time integrity audit — read-only by construction', () => {
  it('contains no statement that can write', () => {
    for (const check of CHECKS) {
      expect(check.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT|MERGE|COPY)\b/i);
    }
  });

  it('refuses when the server is not the integration database, not loopback, or not read-only', async () => {
    const opts = { now: new Date('2026-08-13T06:00:00Z'), staleHours: 12, sampleLimit: 5 };
    const client = (who: Record<string, string | null>) => ({
      $queryRawUnsafe: jest.fn().mockResolvedValueOnce([who]),
    });
    const base = { db: AUDIT_DB_NAME, addr: '127.0.0.1', port: '55432', version: '18.6', read_only: 'on' };

    await expect(runChecks(client({ ...base, db: 'apex_db_dugl' }), opts)).rejects.toThrow(AuditConfigError);
    await expect(runChecks(client({ ...base, addr: '172.17.0.2' }), opts)).rejects.toThrow(/not loopback/);
    await expect(runChecks(client({ ...base, read_only: 'off' }), opts)).rejects.toThrow(/not read-only/);
  });

  it('refuses any repair flag', () => {
    for (const flag of ['--apply', '--fix', '--repair']) {
      expect(() => parseArgs([flag])).toThrow(/read-only/);
    }
  });
});

describe('ticket-time integrity audit — arguments and output', () => {
  const clock = () => new Date('2026-08-13T06:00:00Z');

  it('has safe defaults and parses options', () => {
    expect(parseArgs([], clock)).toEqual({
      json: false,
      options: { now: clock(), staleHours: 12, sampleLimit: 20 },
    });
    const a = parseArgs(['--json', '--stale-hours=4', '--sample=500', '--now=2026-01-01T00:00:00Z'], clock);
    expect(a.json).toBe(true);
    expect(a.options.staleHours).toBe(4);
    expect(a.options.sampleLimit).toBe(200);
    expect(a.options.now.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it.each([['--stale-hours=0'], ['--stale-hours=abc'], ['--sample=-1'], ['--now=yesterday'], ['--verbose']])(
    'rejects %s',
    (arg) => expect(() => parseArgs([arg], clock)).toThrow(AuditConfigError),
  );

  const report = (count: number): AuditReport => ({
    result: count === 0 ? 'CLEAN' : 'VIOLATIONS_FOUND',
    auditedAt: '2026-08-13T06:00:00.000Z',
    database: { name: AUDIT_DB_NAME, address: '127.0.0.1', port: '55432', serverVersion: '18.6' },
    options: { staleHours: 12, sampleLimit: 1 },
    totals: { timeLogs: 3, activeAssigneeLogs: 2, ticketsWithActiveLog: 2, usersWithActiveLog: 1 },
    violationTotal: count,
    checks: [
      {
        code: 'DUPLICATE_ACTIVE_ASSIGNEE_LOGS',
        description: 'd',
        unit: 'users',
        count,
        samples: count ? [{ ref: 'u-1', ticketKey: null, detail: '2 active logs on TKT-1,TKT-2' }] : [],
      },
    ],
  });

  it('maps results to exit codes 0 and 2', () => {
    expect(exitCodeFor(report(0))).toBe(EXIT_CLEAN);
    expect(exitCodeFor(report(3))).toBe(EXIT_VIOLATIONS);
  });

  it('prints a human summary with bounded samples', () => {
    const text = formatHuman(report(3));
    expect(text).toContain('VIOLATIONS_FOUND');
    expect(text).toContain('FAIL  DUPLICATE_ACTIVE_ASSIGNEE_LOGS: 3 users');
    expect(text).toContain('… 2 more');
    expect(formatHuman(report(0))).toContain('ok    DUPLICATE_ACTIVE_ASSIGNEE_LOGS: 0 users');
  });

  it('covers every invariant in the Phase 2C list, in a fixed order', () => {
    expect(CHECKS.map((c) => c.code)).toEqual([
      'DUPLICATE_ACTIVE_ASSIGNEE_LOGS',
      'ACTIVE_LOG_TICKET_NOT_IN_PROGRESS',
      'ACTIVE_LOG_ON_OPEN_REVIEW_DONE_CLOSED',
      'ACTIVE_LOG_ON_BLOCKED_TICKET',
      'ACTIVE_LOG_USER_NOT_WORKING',
      'ACTIVE_LOG_WITH_INVALID_WORK_SESSION',
      'ACTIVE_LOG_NOT_PRIMARY_ASSIGNEE',
      'ACTIVE_LOG_ON_UNASSIGNED_TICKET',
      'ACTIVE_LOG_OLDER_THAN_THRESHOLD',
      'CLOSED_LOG_MISSING_DURATION',
      'OPEN_LOG_WITH_DURATION',
      'NEGATIVE_DURATION_OR_INVERTED_RANGE',
      'OVERLAPPING_ASSIGNEE_RANGES',
      'ACTIVE_REWORK_LOG_WITHOUT_OPEN_CYCLE',
      'WORK_LOG_INSIDE_REWORK_CYCLE',
      'REWORK_CYCLE_MULTIPLE_ACTIVE_SEGMENTS',
      // Phase 4: the reviewer active-work clock.
      'DUPLICATE_ACTIVE_TIMED_LOGS',
      'ACTIVE_REVIEWER_LOG_TICKET_NOT_IN_REVIEW',
      'ACTIVE_REVIEWER_LOG_WITHOUT_OPEN_REVIEW_CYCLE',
      'ACTIVE_REVIEWER_LOG_USER_NOT_WORKING',
      'ACTIVE_REVIEWER_LOG_WITH_INVALID_WORK_SESSION',
      'REVIEWER_LOG_WRONG_STAGE',
      'OVERLAPPING_TIMED_RANGES',
      'EMPLOYEE_WORK_CONTRADICTS_STATE',
    ]);
  });
});
