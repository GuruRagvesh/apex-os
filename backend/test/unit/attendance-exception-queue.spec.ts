import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  deriveExceptions,
  filterExceptions,
  summariseExceptions,
  UNREPRESENTABLE,
  type DerivationInput,
  type ExceptionItem,
} from '../../src/modules/platform/attendance/exceptions/exception-derivation';
import { AttendanceExceptionService } from '../../src/modules/platform/attendance/exceptions/attendance-exception.service';

/**
 * The exception queue exists to close a loop, not to add a screen. So the rules
 * that matter are:
 *
 *   a clean day produces nothing
 *   a broken day produces exactly one item, however many things are wrong
 *   an item names who can end it and what ends it
 *   the item disappears when the underlying record stops being broken
 *   nothing is ever written, and nothing is ever invented
 */

const EMP = {
  'u-1': { id: 'u-1', name: 'Rahul', employeeId: 'TE-014', department: 'Engineering' },
  'u-2': { id: 'u-2', name: 'Anita', employeeId: 'TE-021', department: 'Finance' },
};

function input(over: Partial<DerivationInput> = {}): DerivationInput {
  return {
    attendance: [],
    regularizations: [],
    handoffs: [],
    punches: [],
    employees: EMP,
    ...over,
  };
}

function day(over: any = {}) {
  return {
    id: 'da-1',
    userId: 'u-1',
    businessDate: '2026-08-20',
    status: 'PRESENT',
    evaluationState: 'CALCULATED',
    exceptionFlags: [],
    punchInAt: '2026-08-20T03:30:00.000Z',
    punchOutAt: '2026-08-20T12:30:00.000Z',
    calculationReason: 'COMPLETE_WORKDAY',
    updatedAt: '2026-08-20T13:00:00.000Z',
    ...over,
  };
}

function reg(over: any = {}) {
  return {
    id: 'rg-1',
    userId: 'u-1',
    businessDate: '2026-08-20',
    status: 'PENDING',
    requestType: 'MISSING_PUNCH',
    entrySource: 'EMPLOYEE_REQUEST',
    reason: 'Forgot to punch out',
    recoveryReason: null,
    createdAt: '2026-08-21T04:00:00.000Z',
    ...over,
  };
}

function handoff(over: any = {}) {
  return {
    id: 'ho-1',
    userId: 'u-1',
    businessDate: '2026-08-20',
    intent: 'PUNCH_IN',
    status: 'WAITING',
    expiredByClock: true,
    hasEvidence: false,
    createdAt: '2026-08-20T03:25:00.000Z',
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('a settled day is not an exception', () => {
  it('produces nothing for a clean present day', () => {
    expect(deriveExceptions(input({ attendance: [day()] }))).toEqual([]);
  });

  it('produces nothing for a weekly off or a holiday', () => {
    const rows = [day({ status: 'WEEKLY_OFF' }), day({ id: 'da-2', status: 'HOLIDAY' })];

    expect(deriveExceptions(input({ attendance: rows }))).toEqual([]);
  });

  it('does not re-open a day an approved correction already settled', () => {
    // CORRECTED_BY_REGULARIZATION explains the result; it is not a question.
    // Treating it as one would make the queue impossible to empty: every
    // approval would immediately re-queue the day it just fixed.
    const rows = [day({ exceptionFlags: ['CORRECTED_BY_REGULARIZATION'] })];

    expect(deriveExceptions(input({ attendance: rows }))).toEqual([]);
  });

  it('ignores corrections that were already decided', () => {
    const decided = [
      reg({ id: 'rg-a', status: 'HR_APPROVED' }),
      reg({ id: 'rg-b', status: 'REJECTED', businessDate: '2026-08-19' }),
    ];

    expect(deriveExceptions(input({ regularizations: decided }))).toEqual([]);
  });
});

describe('the categories come from the stored records', () => {
  const cat = (over: any) => deriveExceptions(input({ attendance: [day(over)] }))[0];

  it.each([
    ['MISSING_PUNCH', 'MISSING_PUNCH_IN'],
    ['NO_ATTENDANCE_EVIDENCE', 'MISSING_PUNCH_IN'],
    ['MISSING_PUNCH_OUT', 'MISSING_PUNCH_OUT'],
    ['LOCATION_OUTSIDE_GEOFENCE', 'OUTSIDE_GEOFENCE'],
    ['LOCATION_LOW_ACCURACY', 'LOW_ACCURACY_LOCATION'],
    ['LOCATION_UNAVAILABLE', 'LOCATION_UNVERIFIED'],
    ['PHOTO_MISSING', 'PHOTO_MISSING'],
  ])('maps the %s flag to %s', (flag, category) => {
    expect(cat({ exceptionFlags: [flag], evaluationState: 'NEEDS_REVIEW' }).category).toBe(
      category,
    );
  });

  it('falls back to NEEDS_REVIEW only when nothing more specific was recorded', () => {
    const item = cat({
      evaluationState: 'NEEDS_REVIEW',
      exceptionFlags: ['AMBIGUOUS_APPROVED_LEAVE'],
    });

    expect(item.category).toBe('NEEDS_REVIEW');
    // The unmapped flag is still carried, so the reason is not lost.
    expect(item.evidence.unmappedFlags).toEqual(['AMBIGUOUS_APPROVED_LEAVE']);
  });

  it('surfaces a MISSING_PUNCH status even with no flags at all', () => {
    // Rows written before a flag existed still have to reach a human.
    const item = cat({ status: 'MISSING_PUNCH', exceptionFlags: [], punchInAt: null });

    expect(item.category).toBe('MISSING_PUNCH_IN');
  });

  it('tells a missing punch in from a missing punch out by the stored times', () => {
    const item = cat({ status: 'MISSING_PUNCH', exceptionFlags: [], punchOutAt: null });

    expect(item.category).toBe('MISSING_PUNCH_OUT');
  });
});

describe('one broken day is exactly one row', () => {
  it('does not emit a row per flag', () => {
    const item = deriveExceptions(
      input({
        attendance: [
          day({
            evaluationState: 'NEEDS_REVIEW',
            status: 'MISSING_PUNCH',
            punchOutAt: null,
            exceptionFlags: [
              'MISSING_PUNCH_OUT',
              'LOCATION_OUTSIDE_GEOFENCE',
              'PHOTO_MISSING',
            ],
          }),
        ],
      }),
    );

    expect(item).toHaveLength(1);
    expect(item[0].category).toBe('MISSING_PUNCH_OUT');
    expect(item[0].categories).toEqual([
      'MISSING_PUNCH_OUT',
      'OUTSIDE_GEOFENCE',
      'PHOTO_MISSING',
    ]);
  });

  it('leads with the most blocking problem', () => {
    // A day with no punch in cannot be judged on its geofence, so saying
    // "outside geofence" first would send somebody to answer the wrong
    // question.
    const item = deriveExceptions(
      input({
        attendance: [
          day({
            evaluationState: 'NEEDS_REVIEW',
            exceptionFlags: ['LOCATION_OUTSIDE_GEOFENCE', 'MISSING_PUNCH'],
          }),
        ],
      }),
    )[0];

    expect(item.category).toBe('MISSING_PUNCH_IN');
  });

  it('stays findable by every problem it has, not only the headline one', () => {
    const items = deriveExceptions(
      input({
        attendance: [
          day({
            evaluationState: 'NEEDS_REVIEW',
            exceptionFlags: ['MISSING_PUNCH', 'LOCATION_OUTSIDE_GEOFENCE'],
          }),
        ],
      }),
    );

    expect(filterExceptions(items, { category: 'OUTSIDE_GEOFENCE' })).toHaveLength(1);
    expect(filterExceptions(items, { category: 'MISSING_PUNCH_IN' })).toHaveLength(1);
    expect(filterExceptions(items, { category: 'PHOTO_MISSING' })).toHaveLength(0);
  });

  it('keeps one key per employee-day so a refresh does not reshuffle rows', () => {
    const items = deriveExceptions(
      input({
        attendance: [
          day({ evaluationState: 'NEEDS_REVIEW', exceptionFlags: ['MISSING_PUNCH'] }),
          day({
            id: 'da-2',
            userId: 'u-2',
            evaluationState: 'NEEDS_REVIEW',
            exceptionFlags: ['MISSING_PUNCH'],
          }),
        ],
        regularizations: [reg()],
        handoffs: [handoff()],
      }),
    );

    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
    expect(items.filter((i) => i.userId === 'u-1' && i.businessDate === '2026-08-20')).toHaveLength(
      1,
    );
  });
});

describe('an item says who ends it and how', () => {
  const flagged = day({ evaluationState: 'NEEDS_REVIEW', exceptionFlags: ['MISSING_PUNCH'] });

  it('is OPEN when nobody has started', () => {
    const item = deriveExceptions(input({ attendance: [flagged] }))[0];

    expect(item.state).toBe('OPEN');
    expect(item.resolvableBy).toBe('EMPLOYEE_THEN_APPROVAL');
    expect(item.resolvingAction.kind).toBe('RAISE_REGULARIZATION');
    expect(item.sourceIds.regularizationId).toBeUndefined();
  });

  it('becomes AWAITING_MANAGER once the employee has raised a correction', () => {
    const item = deriveExceptions(
      input({ attendance: [flagged], regularizations: [reg({ status: 'PENDING' })] }),
    )[0];

    expect(item.state).toBe('AWAITING_MANAGER');
    expect(item.resolvingAction.kind).toBe('MANAGER_DECISION');
    expect(item.resolvingAction.regularizationId).toBe('rg-1');
    expect(item.sourceIds).toEqual({ dailyAttendanceId: 'da-1', regularizationId: 'rg-1' });
  });

  it('becomes AWAITING_HR once the manager has approved', () => {
    const item = deriveExceptions(
      input({ attendance: [flagged], regularizations: [reg({ status: 'MANAGER_APPROVED' })] }),
    )[0];

    expect(item.state).toBe('AWAITING_HR');
    expect(item.resolvingAction.kind).toBe('HR_DECISION');
  });

  it('does not add a second row when a correction is in flight for the same day', () => {
    // This is the whole difference between a queue that closes and a queue
    // that grows: the correction is the RESOLUTION of the exception, not a
    // second exception standing next to it.
    const items = deriveExceptions(input({ attendance: [flagged], regularizations: [reg()] }));

    expect(items).toHaveLength(1);
  });

  it('reports a correction on a day the evaluator never flagged', () => {
    const items = deriveExceptions(input({ regularizations: [reg()] }));

    expect(items).toHaveLength(1);
    expect(items[0].category).toBe('PENDING_REGULARIZATION');
    expect(items[0].resolvableBy).toBe('MANAGER_THEN_HR');
  });

  it('routes a manual recovery awaiting HR to HR alone', () => {
    const items = deriveExceptions(
      input({
        regularizations: [
          reg({ entrySource: 'MANUAL_RECOVERY', status: 'MANAGER_APPROVED', recoveryReason: 'CAMERA_UNAVAILABLE' }),
        ],
      }),
    );

    expect(items[0].category).toBe('MANUAL_RECOVERY_AWAITING_HR');
    expect(items[0].resolvableBy).toBe('HR_ONLY');
    expect(items[0].resolvingAction.kind).toBe('HR_DECISION');
    expect(items[0].whyFlagged).toContain('CAMERA_UNAVAILABLE');
  });

  it('answers all eight questions for every item it emits', () => {
    const items = deriveExceptions(
      input({
        attendance: [flagged],
        regularizations: [reg({ userId: 'u-2', businessDate: '2026-08-18' })],
        handoffs: [handoff({ userId: 'u-2', businessDate: '2026-08-17' })],
      }),
    );

    expect(items.length).toBeGreaterThan(2);
    for (const i of items) {
      expect(i.employee?.name).toBeTruthy(); //  who
      expect(i.businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/); //  when
      expect(i.problem.length).toBeGreaterThan(10); //  what is wrong
      expect(i.whyFlagged.length).toBeGreaterThan(10); //  why flagged
      expect(Object.keys(i.evidence).length).toBeGreaterThan(0); //  context
      expect(i.resolvableBy).toBeTruthy(); //  who resolves
      expect(i.resolvingAction.label.length).toBeGreaterThan(10); //  what resolves
      expect(['OPEN', 'AWAITING_MANAGER', 'AWAITING_HR']).toContain(i.state); //  state
    }
  });
});

describe('handoffs are only reported when they really failed', () => {
  it('reports one that expired with no punch behind it', () => {
    const items = deriveExceptions(input({ handoffs: [handoff()] }));

    expect(items).toHaveLength(1);
    expect(items[0].category).toBe('FAILED_OR_EXPIRED_HANDOFF');
  });

  it('trusts the clock rather than the stored status', () => {
    // Nothing sweeps WAITING rows to EXPIRED, so a queue that believed the
    // column would never show an abandoned handoff at all.
    const stillWaiting = handoff({ status: 'WAITING', expiredByClock: false });

    expect(deriveExceptions(input({ handoffs: [stillWaiting] }))).toEqual([]);
  });

  it('says nothing when the punch actually landed', () => {
    const items = deriveExceptions(
      input({
        handoffs: [handoff()],
        punches: [{ userId: 'u-1', businessDate: '2026-08-20', type: 'PUNCH_IN' }],
      }),
    );

    expect(items).toEqual([]);
  });

  it('is not fooled by a punch of the other kind on the same day', () => {
    const items = deriveExceptions(
      input({
        handoffs: [handoff({ intent: 'PUNCH_OUT' })],
        punches: [{ userId: 'u-1', businessDate: '2026-08-20', type: 'PUNCH_IN' }],
      }),
    );

    expect(items).toHaveLength(1);
  });

  it('ignores a cancelled handoff', () => {
    // Creating a new handoff cancels the previous WAITING one, so CANCELLED is
    // usually a retry. Reporting it would fill the queue with successes.
    expect(deriveExceptions(input({ handoffs: [handoff({ status: 'CANCELLED' })] }))).toEqual([]);
  });

  it('ignores one that completed into evidence', () => {
    expect(deriveExceptions(input({ handoffs: [handoff({ hasEvidence: true })] }))).toEqual([]);
  });

  it('explains a missing punch rather than duplicating it', () => {
    const items = deriveExceptions(
      input({
        attendance: [day({ evaluationState: 'NEEDS_REVIEW', exceptionFlags: ['MISSING_PUNCH'] })],
        handoffs: [handoff()],
      }),
    );

    expect(items).toHaveLength(1);
    expect(items[0].category).toBe('MISSING_PUNCH_IN');
    expect(items[0].categories).toContain('FAILED_OR_EXPIRED_HANDOFF');
    expect((items[0].evidence as any).expiredHandoff.id).toBe('ho-1');
    expect(items[0].sourceIds.handoffId).toBe('ho-1');
  });
});

describe('the summary cannot disagree with the list', () => {
  const items = () =>
    deriveExceptions(
      input({
        attendance: [
          day({ evaluationState: 'NEEDS_REVIEW', exceptionFlags: ['MISSING_PUNCH'] }),
          day({
            id: 'da-2',
            userId: 'u-2',
            businessDate: '2026-08-19',
            evaluationState: 'NEEDS_REVIEW',
            exceptionFlags: ['LOCATION_OUTSIDE_GEOFENCE'],
          }),
        ],
        regularizations: [reg({ userId: 'u-2', businessDate: '2026-08-19' })],
      }),
    );

  it('counts the same rows the list contains', () => {
    const list = items();
    const s = summariseExceptions(list);

    expect(s.total).toBe(list.length);
    expect(s.employees).toBe(2);
    expect(s.byState.OPEN + s.byState.AWAITING_MANAGER + s.byState.AWAITING_HR).toBe(s.total);
  });

  it('counts a row under every category it carries', () => {
    const s = summariseExceptions(items());

    expect(s.byCategory.MISSING_PUNCH_IN).toBe(1);
    expect(s.byCategory.OUTSIDE_GEOFENCE).toBe(1);
  });

  it('agrees with a filtered list', () => {
    const filtered = filterExceptions(items(), { state: 'AWAITING_MANAGER' });

    expect(summariseExceptions(filtered).total).toBe(filtered.length);
    expect(filtered.every((i) => i.state === 'AWAITING_MANAGER')).toBe(true);
  });

  it('filters by employee and by department without widening anything', () => {
    const list = items();

    expect(filterExceptions(list, { userId: 'u-2' }).every((i) => i.userId === 'u-2')).toBe(true);
    expect(filterExceptions(list, { department: 'Finance' })).toHaveLength(1);
    expect(filterExceptions(list, { department: 'Nowhere' })).toHaveLength(0);
    expect(filterExceptions(list, {}).length).toBe(list.length);
  });
});

describe('the derivation invents nothing', () => {
  it('reads no clock, so the same records always produce the same queue', () => {
    const src = require('fs').readFileSync(
      require('path').resolve(
        __dirname,
        '../../src/modules/platform/attendance/exceptions/exception-derivation.ts',
      ),
      'utf8',
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    expect(code).not.toMatch(/new Date\(\)|Date\.now\(\)/);
  });

  it('touches no database and no framework', () => {
    const src = require('fs').readFileSync(
      require('path').resolve(
        __dirname,
        '../../src/modules/platform/attendance/exceptions/exception-derivation.ts',
      ),
      'utf8',
    );

    expect(src).not.toMatch(/^import /m);
  });

  it('names the failures it structurally cannot see', () => {
    // An HR user looking at an empty queue after an employee reported a camera
    // failure must be told no such record exists, not left to conclude nothing
    // happened.
    const text = UNREPRESENTABLE.map((u) => `${u.what} ${u.why}`).join(' ').toLowerCase();

    expect(text).toContain('camera');
    expect(text).toContain('location permission');
    expect(text).toContain('network');
    for (const u of UNREPRESENTABLE) expect(u.why.length).toBeGreaterThan(20);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Service: scope, windowing, and the promise that it writes nothing
// ─────────────────────────────────────────────────────────────────────────────

const NOW = new Date('2026-08-21T06:00:00.000Z');
const HR = { id: 'hr-1', name: 'Priya', role: { name: 'HR' } };
const MANAGER = { id: 'mgr-1', name: 'Vikram', role: { name: 'MANAGER' } };
const EMPLOYEE = { id: 'u-1', name: 'Rahul', role: { name: 'EMPLOYEE' } };

function service(over: any = {}) {
  const calls: Array<{ model: string; method: string; args: any }> = [];

  const model = (name: string, rows: any[]) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) => (args: any) => {
          calls.push({ model: name, method, args });
          if (method === 'findMany') return Promise.resolve(rows);
          if (method === 'count') return Promise.resolve(rows.length);
          return Promise.resolve(rows[0] ?? null);
        },
      },
    ) as any;

  const prisma: any = {
    dailyAttendance: model('dailyAttendance', over.attendance ?? []),
    attendanceRegularization: model('attendanceRegularization', over.regularizations ?? []),
    attendancePunchHandoff: model('attendancePunchHandoff', over.handoffs ?? []),
    attendancePunchEvidence: model('attendancePunchEvidence', over.punches ?? []),
    user: model(
      'user',
      over.users ?? [
        { id: 'u-1', name: 'Rahul', employeeId: 'TE-014', department: { name: 'Engineering' } },
      ],
    ),
  };

  const tva: any = {
    now: () => NOW,
    companyToday: () => '2026-08-21',
    companyBusinessDate: (d: Date) => new Date(d).toISOString().slice(0, 10),
    companyDateOnly: (d: Date) => d,
    companyDayStart: (d: Date) => d,
    companyDayEnd: (d: Date) => d,
  };

  const consoleService: any = {
    resolveScope: jest.fn(async () => over.scope ?? { userIds: null, isHr: true }),
  };

  return {
    service: new AttendanceExceptionService(prisma, tva, consoleService),
    calls,
    consoleService,
  };
}

describe('scope is decided by the server, never by the caller', () => {
  it('lets HR see the whole company', async () => {
    const { service: s, calls } = service();
    const result = await s.list(HR, {});

    expect(result.scope).toBe('COMPANY');
    const reads = calls.filter((c) => c.method === 'findMany' && c.model !== 'user');
    expect(reads.every((c) => !c.args.where.userId)).toBe(true);
  });

  it('narrows a manager to their own reports before any row is read', async () => {
    const { service: s, calls } = service({ scope: { userIds: ['u-1', 'u-2'], isHr: false } });
    const result = await s.list(MANAGER, {});

    expect(result.scope).toBe('TEAM');
    const reads = calls.filter((c) => c.method === 'findMany' && c.model !== 'user');
    expect(reads.length).toBeGreaterThan(0);
    for (const c of reads) {
      expect(c.args.where.userId).toEqual({ in: ['u-1', 'u-2'] });
    }
  });

  it('keeps the punch lookup scoped too, and skips it when nothing needs it', async () => {
    // Punches are read only to answer "did the handoff's punch land". With no
    // expired handoff there is no such question, and sweeping every punch in a
    // 62-day window would be a large read on a live database for nothing.
    const quiet = service({ scope: { userIds: ['u-1'], isHr: false } });
    await quiet.service.list(MANAGER, {});
    expect(quiet.calls.some((c) => c.model === 'attendancePunchEvidence')).toBe(false);

    const busy = service({
      scope: { userIds: ['u-1'], isHr: false },
      handoffs: [
        {
          id: 'ho-1',
          userId: 'u-1',
          intent: 'PUNCH_IN',
          status: 'WAITING',
          expiresAt: new Date('2026-08-20T04:00:00.000Z'),
          evidenceId: null,
          createdAt: new Date('2026-08-20T03:55:00.000Z'),
        },
      ],
    });
    await busy.service.list(MANAGER, {});
    const punchRead = busy.calls.find((c) => c.model === 'attendancePunchEvidence')!;

    expect(punchRead.args.where.userId).toEqual({ in: ['u-1'] });
  });

  it('cannot be widened by a userId filter', async () => {
    // The filter narrows the derived list; it never reaches the query.
    const { service: s, calls } = service({ scope: { userIds: ['u-1'], isHr: false } });
    await s.list(MANAGER, { userId: 'someone-else' });

    const reads = calls.filter((c) => c.method === 'findMany' && c.model !== 'user');
    for (const c of reads) expect(c.args.where.userId).toEqual({ in: ['u-1'] });
  });

  it('refuses an employee with no reports rather than showing an empty queue', async () => {
    // "You have no authority here" and "nothing is wrong today" are different
    // facts, and an empty list says the wrong one.
    const { service: s } = service({ scope: { userIds: [], isHr: false } });

    await expect(s.list(EMPLOYEE, {})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(s.summary(EMPLOYEE, {})).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('the window is bounded and validated', () => {
  it('rejects a malformed date rather than guessing a range', async () => {
    const { service: s } = service();

    for (const bad of ['2026-8-1', 'yesterday', '2026/08/01', '']) {
      await expect(s.list(HR, { from: bad, to: '2026-08-21' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
  });

  it('rejects a reversed range', async () => {
    const { service: s } = service();

    await expect(s.list(HR, { from: '2026-08-21', to: '2026-08-01' })).rejects.toThrow(
      /must not be after/i,
    );
  });

  it('refuses an unbounded sweep of history', async () => {
    const { service: s } = service();

    await expect(s.list(HR, { from: '2025-01-01', to: '2026-08-21' })).rejects.toThrow(
      /may not exceed/i,
    );
  });

  it('defaults to a recent window ending today', async () => {
    const { service: s } = service();
    const result = await s.list(HR, {});

    expect(result.to).toBe('2026-08-21');
    expect(result.from).toBe('2026-08-08');
  });
});

describe('the queue is a read surface', () => {
  it('never writes, on any path', async () => {
    // The moment this queue can change attendance there are two ways to change
    // attendance, and the audited one stops being the only one.
    const { service: s, calls } = service({
      attendance: [
        {
          id: 'da-1',
          userId: 'u-1',
          date: new Date('2026-08-20T00:00:00.000Z'),
          status: 'MISSING_PUNCH',
          evaluationState: 'NEEDS_REVIEW',
          exceptionFlags: ['MISSING_PUNCH'],
          punchInAt: null,
          punchOutAt: null,
          calculationReason: 'INCOMPLETE_PUNCH_PAIR',
          updatedAt: new Date('2026-08-20T13:00:00.000Z'),
        },
      ],
    });

    await s.list(HR, {});
    await s.summary(HR, {});

    const mutations = calls.filter(
      (c) => !['findMany', 'findUnique', 'findFirst', 'count'].includes(c.method),
    );
    expect(mutations).toEqual([]);
  });

  it('returns items, a summary and the stated blind spots together', async () => {
    const { service: s } = service({
      regularizations: [
        {
          id: 'rg-1',
          userId: 'u-1',
          date: new Date('2026-08-20T00:00:00.000Z'),
          status: 'PENDING',
          requestType: 'MISSING_PUNCH',
          entrySource: 'EMPLOYEE_REQUEST',
          reason: 'Forgot',
          recoveryReason: null,
          createdAt: new Date('2026-08-21T04:00:00.000Z'),
        },
      ],
    });

    const result = await s.list(HR, {});

    expect(result.items).toHaveLength(1);
    expect(result.items[0].employee?.name).toBe('Rahul');
    expect(result.summary.total).toBe(1);
    expect(result.notRepresented.length).toBeGreaterThan(0);
  });

  it('only asks for handoffs that have already expired and produced nothing', async () => {
    const { service: s, calls } = service();
    await s.list(HR, {});

    const where = calls.find((c) => c.model === 'attendancePunchHandoff')!.args.where;
    expect(where.evidenceId).toBeNull();
    expect(where.status).toEqual({ in: ['WAITING', 'EXPIRED'] });
    expect(where.expiresAt).toEqual({ lte: NOW });
  });

  it('windows corrections by the day they concern, not the day they were filed', async () => {
    // A request filed today about last month belongs with last month. Filtering
    // on createdAt would hide it from the month it actually affects.
    const { service: s, calls } = service();
    await s.list(HR, { from: '2026-08-01', to: '2026-08-21' });

    const where = calls.find((c) => c.model === 'attendanceRegularization')!.args.where;
    expect(where.date).toBeDefined();
    expect(where.createdAt).toBeUndefined();
    expect(where.status).toEqual({ in: ['PENDING', 'MANAGER_APPROVED'] });
  });
});

describe('every category the brief asked for is reachable', () => {
  it('supports the eight prioritised categories plus the two durable evidence gaps', () => {
    const built: ExceptionItem[] = deriveExceptions(
      input({
        attendance: [
          day({ id: 'a', evaluationState: 'NEEDS_REVIEW', exceptionFlags: ['MISSING_PUNCH'] }),
          day({
            id: 'b',
            businessDate: '2026-08-19',
            evaluationState: 'NEEDS_REVIEW',
            exceptionFlags: ['MISSING_PUNCH_OUT'],
          }),
          day({
            id: 'c',
            businessDate: '2026-08-18',
            evaluationState: 'NEEDS_REVIEW',
            exceptionFlags: ['LOCATION_OUTSIDE_GEOFENCE'],
          }),
          day({
            id: 'd',
            businessDate: '2026-08-17',
            evaluationState: 'NEEDS_REVIEW',
            exceptionFlags: ['LOCATION_LOW_ACCURACY'],
          }),
          day({
            id: 'e',
            businessDate: '2026-08-16',
            evaluationState: 'NEEDS_REVIEW',
            exceptionFlags: ['LOCATION_UNAVAILABLE'],
          }),
          day({
            id: 'f',
            businessDate: '2026-08-15',
            evaluationState: 'NEEDS_REVIEW',
            exceptionFlags: ['PHOTO_MISSING'],
          }),
          day({
            id: 'g',
            businessDate: '2026-08-14',
            evaluationState: 'NEEDS_REVIEW',
            exceptionFlags: ['BREAK_EXCEEDS_ALLOWANCE'],
          }),
        ],
        regularizations: [
          reg({ id: 'r1', businessDate: '2026-08-13' }),
          reg({
            id: 'r2',
            businessDate: '2026-08-12',
            entrySource: 'MANUAL_RECOVERY',
            status: 'MANAGER_APPROVED',
          }),
        ],
        handoffs: [handoff({ businessDate: '2026-08-11' })],
      }),
    );

    expect(new Set(built.map((i) => i.category))).toEqual(
      new Set([
        'MISSING_PUNCH_IN',
        'MISSING_PUNCH_OUT',
        'OUTSIDE_GEOFENCE',
        'LOW_ACCURACY_LOCATION',
        'LOCATION_UNVERIFIED',
        'PHOTO_MISSING',
        'NEEDS_REVIEW',
        'PENDING_REGULARIZATION',
        'MANUAL_RECOVERY_AWAITING_HR',
        'FAILED_OR_EXPIRED_HANDOFF',
      ]),
    );
  });
});
