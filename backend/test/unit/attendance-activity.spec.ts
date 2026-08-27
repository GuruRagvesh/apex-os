import { readFileSync } from 'fs';
import { resolve } from 'path';
import { AttendanceActivityService } from '../../src/modules/platform/attendance/activity/attendance-activity.service';

// Employees need to see who corrected their attendance and why. The tempting
// way to give them that was to widen /events, which carries every operational
// event in the company. This is the narrow alternative: a projection over the
// same audit rows, scoped by construction to rows the caller owns.

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const DATE = '2026-08-27';

function build(over: any = {}) {
  const prisma: any = {
    attendanceRegularization: {
      findMany: jest.fn().mockResolvedValue(
        over.regularizations ?? [{ id: 'reg-1', date: d(DATE), reason: 'Forgot to punch out' }],
      ),
    },
    dailyAttendance: {
      findMany: jest.fn().mockResolvedValue(over.attendance ?? [{ id: 'att-1', date: d(DATE) }]),
    },
    operationalEvent: {
      findMany: jest.fn().mockResolvedValue(over.events ?? []),
    },
  };
  const tva: any = { now: () => d(DATE) };
  return { service: new AttendanceActivityService(prisma, tva), prisma };
}

const event = (over: any = {}) => ({
  id: 'evt-1',
  action: 'ATTENDANCE_OFFICIAL_REVISED',
  entityId: 'att-1',
  fromState: 'MISSING_PUNCH',
  toState: 'PRESENT',
  metadata: { businessDate: DATE },
  beforeValue: { status: 'MISSING_PUNCH', punchOutAt: null, workedMinutes: 0 },
  afterValue: { status: 'PRESENT', punchOutAt: '2026-08-27T13:00:00.000Z', workedMinutes: 490 },
  timestamp: d('2026-08-28'),
  actor: { name: 'Priya (HR)', role: { name: 'HR' } },
  ...over,
});

describe('scoping is by owned rows, never by caller input', () => {
  it('queries only the caller own regularizations and attendance', async () => {
    const { service, prisma } = build();
    await service.mine('emp-1');

    expect(prisma.attendanceRegularization.findMany.mock.calls[0][0].where.userId).toBe('emp-1');
    expect(prisma.dailyAttendance.findMany.mock.calls[0][0].where.userId).toBe('emp-1');
  });

  it('matches events against those ids only', async () => {
    const { service, prisma } = build();
    await service.mine('emp-1');

    const where = prisma.operationalEvent.findMany.mock.calls[0][0].where;
    const ids = where.OR.flatMap((c: any) => c.entityId.in);

    expect(ids.sort()).toEqual(['att-1', 'reg-1']);
  });

  it('returns nothing when the employee owns no attendance rows', async () => {
    // Not "everything" -- an unfiltered query here would return the company.
    const { service, prisma } = build({ regularizations: [], attendance: [] });

    expect(await service.mine('emp-1')).toEqual([]);
    expect(prisma.operationalEvent.findMany).not.toHaveBeenCalled();
  });

  it('takes no userId from anywhere but its own argument', () => {
    const src = readFileSync(
      resolve(
        __dirname,
        '../../src/modules/platform/attendance/activity/attendance-activity.controller.ts',
      ),
      'utf8',
    );

    // No route may accept an employee id: that is the whole boundary.
    expect(src).not.toMatch(/@Param\(\s*['"]userId/);
    expect(src).not.toMatch(/@Query\(\s*['"]userId/);
    expect(src).not.toMatch(/@Body\(/);
  });

  it('narrows to one business date without widening on a bad value', async () => {
    const { service, prisma } = build();
    await service.mine('emp-1', DATE);

    expect(prisma.attendanceRegularization.findMany.mock.calls[0][0].where.date).toEqual(d(DATE));
  });
});

describe('only attendance actions the employee may see', () => {
  it('keeps correction and comp-off actions', async () => {
    const { service } = build({
      events: [
        event({ id: 'a', action: 'REGULARIZATION_REQUESTED' }),
        event({ id: 'b', action: 'REGULARIZATION_HR_APPROVED' }),
        event({ id: 'c', action: 'COMP_OFF_GRANTED' }),
      ],
    });

    expect((await service.mine('emp-1')).map((e) => e.action)).toEqual([
      'REGULARIZATION_REQUESTED',
      'REGULARIZATION_HR_APPROVED',
      'COMP_OFF_GRANTED',
    ]);
  });

  it('drops internal machinery an employee has no use for', async () => {
    // Shadow runs and evaluation passes are operational noise, and a
    // configuration error is not this employee's business.
    const { service } = build({
      events: [
        event({ id: 'a', action: 'ATTENDANCE_SHADOW_RUN' }),
        event({ id: 'b', action: 'ATTENDANCE_EVALUATION_RUN' }),
        event({ id: 'c', action: 'ATTENDANCE_CONFIGURATION_ERROR' }),
      ],
    });

    expect(await service.mine('emp-1')).toEqual([]);
  });

  it('is an allowlist, so an action added later is invisible by default', async () => {
    const { service } = build({ events: [event({ action: 'SOME_FUTURE_ACTION' })] });

    expect(await service.mine('emp-1')).toEqual([]);
  });
});

describe('the projection is readable and allowlisted', () => {
  it('renders a correction as a sentence with actor and reason', async () => {
    const { service } = build({
      events: [event({ metadata: { businessDate: DATE, reason: 'Forgot to punch out' } })],
    });
    const [entry] = await service.mine('emp-1');

    expect(entry.label).toBe('Attendance corrected');
    expect(entry.actorName).toBe('Priya (HR)');
    expect(entry.actorRole).toBe('HR');
    expect(entry.reason).toBe('Forgot to punch out');
    expect(entry.businessDate).toBe(DATE);
  });

  it('reports what actually changed, old value to new', async () => {
    const { service } = build({ events: [event()] });
    const [entry] = await service.mine('emp-1');
    const punchOut = entry.changed!.find((c) => c.field === 'punchOutAt')!;

    expect(punchOut.from).toBeNull();
    expect(punchOut.to).toBe('2026-08-27T13:00:00.000Z');
    expect(entry.changed!.find((c) => c.field === 'status')).toEqual({
      field: 'status',
      from: 'MISSING_PUNCH',
      to: 'PRESENT',
    });
  });

  it('reports no change when the snapshots agree', async () => {
    const { service } = build({
      events: [event({ beforeValue: { status: 'PRESENT' }, afterValue: { status: 'PRESENT' } })],
    });

    expect((await service.mine('emp-1'))[0].changed).toBeNull();
  });

  it('never leaks a snapshot field outside the allowlist', async () => {
    const { service } = build({
      events: [
        event({
          beforeValue: { status: 'ABSENT', ipAddress: '10.0.0.1', deviceMetadata: { ua: 'x' } },
          afterValue: {
            status: 'PRESENT',
            photoObjectKey: 'cloudinary:authenticated:image:secret',
            photoHash: 'a'.repeat(64),
          },
        }),
      ],
    });
    const entry = (await service.mine('emp-1'))[0];
    const serialised = JSON.stringify(entry);

    expect(serialised).not.toContain('10.0.0.1');
    expect(serialised).not.toContain('cloudinary:authenticated');
    expect(serialised).not.toContain('a'.repeat(64));
    expect(serialised).not.toContain('deviceMetadata');
    expect(entry.changed!.map((c) => c.field)).toEqual(['status']);
  });

  it('never returns raw metadata, only the two fields it reads', async () => {
    const { service } = build({
      events: [
        event({
          metadata: { businessDate: DATE, reason: 'ok', internalTrace: 'do-not-expose', ip: '1.2.3.4' },
        }),
      ],
    });
    const serialised = JSON.stringify((await service.mine('emp-1'))[0]);

    expect(serialised).not.toContain('do-not-expose');
    expect(serialised).not.toContain('1.2.3.4');
  });

  it('exposes only the documented keys', async () => {
    const { service } = build({ events: [event()] });

    expect(Object.keys((await service.mine('emp-1'))[0]).sort()).toEqual(
      [
        'action',
        'actorName',
        'actorRole',
        'at',
        'businessDate',
        'changed',
        'fromState',
        'id',
        'label',
        'reason',
        'toState',
      ].sort(),
    );
  });

  it('selects only the actor name and role from the user record', async () => {
    const { service, prisma } = build({ events: [event()] });
    await service.mine('emp-1');
    const select = prisma.operationalEvent.findMany.mock.calls[0][0].select;

    expect(select.actor.select).toEqual({ name: true, role: { select: { name: true } } });
    expect(select.ip).toBeUndefined();
    expect(select.device).toBeUndefined();
  });
});
