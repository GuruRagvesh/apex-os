import { ConfigService } from '@nestjs/config';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TVAService } from '../../src/common/services/tva.service';
import {
  CompOffAlreadyGrantedError,
  CompOffService,
  CompOffSourceNotQualifyingError,
} from '../../src/modules/operations/leave/comp-off.service';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Refined earning rule: each completed 12-hour elapsed-presence day earns 180 minutes; three
// such credits combine to one 540-minute comp-off day.

const tvaOf = () => new TVAService({ get: () => undefined } as unknown as ConfigService);

const HOLIDAY_FACTS = {
  weeklyOff: { isWeeklyOff: false, reasons: [], policyId: 'week-1' },
  holiday: { isHoliday: true, holidayId: 'hol-1', calendarId: 'cal-1', name: 'Diwali', optional: false },
};
const WORKING_FACTS = {
  weeklyOff: { isWeeklyOff: false, reasons: [], policyId: 'week-1' },
  holiday: { isHoliday: false, holidayId: null, calendarId: 'cal-1', name: null, optional: false },
  expectedCompanyWorkingDay: true,
};
const SUNDAY_FACTS = {
  weeklyOff: { isWeeklyOff: true, reasons: ['SUNDAY'], policyId: 'week-1' },
  holiday: { isHoliday: false, holidayId: null, calendarId: 'cal-1', name: null, optional: false },
};

interface RigOptions {
  facts?: any;
  isHr?: boolean;
  /** Credits the employee holds, in whatever order the caller supplies. */
  credits?: Array<{ id: string; expiresAt: string; earnedAt?: string; remainingMinutes?: number }>;
  createThrows?: any;
  expiryDays?: number;
  sessionSpansByDate?: Record<string, Array<{ startMinute: number; endMinute: number }>>;
  existingCredit?: { id: string } | null;
}

function rig(opts: RigOptions = {}) {
  const audit: any[] = [];
  const created: any[] = [];
  const updates: any[] = [];

  // A shared pool the raw lock query draws from, and the update removes from.
  // That is what makes the concurrency test meaningful: a second caller sees
  // only what the first one left behind, exactly as FOR UPDATE would leave it.
  let pool = [...(opts.credits ?? [])];

  const tx: any = {
    $queryRaw: jest.fn((sql: any) => {
      const text = String(sql?.strings?.join(' ') ?? sql?.sql ?? '');
      const sorted = [...pool].sort((a, b) =>
        a.expiresAt === b.expiresAt
          ? String(a.earnedAt ?? '').localeCompare(String(b.earnedAt ?? ''))
          : a.expiresAt.localeCompare(b.expiresAt),
      );
      (tx.$queryRaw as any).lastSql = text;
      return Promise.resolve(sorted.map((c) => ({ id: c.id, remainingMinutes: c.remainingMinutes ?? 540 })));
    }),
    compOffCredit: {
      update: jest.fn((args: any) => {
        const ids: string[] = [args.where.id];
        updates.push(args);
        if (args.data.status === 'USED') pool = pool.filter((c) => !ids.includes(c.id));
        else pool = pool.map((c) => c.id === args.where.id ? { ...c, remainingMinutes: args.data.remainingMinutes } : c);
        return Promise.resolve({ id: args.where.id, ...args.data });
      }),
      findUnique: jest.fn(({ where }: any) => Promise.resolve({ id: where.id, status: 'USED' })),
    },
  };

  const prisma: any = {
    compOffCredit: {
      create: jest.fn((args: any) => {
        if (opts.createThrows) return Promise.reject(opts.createThrows);
        const row = { id: 'credit-new', ...args.data };
        created.push(row);
        return Promise.resolve(row);
      }),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(opts.existingCredit ?? null),
    },
    workSession: {
      findMany: jest.fn(({ where }: any) => Promise.resolve(
        (where.date.in as Date[]).flatMap((date) => {
          const key = date.toISOString().slice(0, 10);
          const spans = opts.sessionSpansByDate?.[key] ?? [];
          return spans.map(({ startMinute, endMinute }) => ({
            date,
            startWorkAt: new Date(date.getTime() + startMinute * 60_000),
            logoutAt: new Date(date.getTime() + endMinute * 60_000),
          }));
        }),
      )),
    },
    leavePolicy: {
      findUnique: jest.fn().mockResolvedValue({ compOffExpiryDays: opts.expiryDays ?? 30 }),
    },
  };

  const calendar: any = {
    resolveBusinessDay: jest.fn().mockResolvedValue(opts.facts ?? HOLIDAY_FACTS),
  };
  const timeline: any = {
    findProfileOn: jest.fn().mockResolvedValue({
      assignedHolidayCalendarId: 'cal-1',
      assignedWeeklyOffPolicyId: 'week-1',
      assignedLeavePolicyId: 'lp-1',
    }),
  };
  const accessPolicy: any = { isHrOrAdmin: () => opts.isHr === true };
  const eventLogger: any = {
    log: jest.fn((e: any) => { audit.push(e); return Promise.resolve(undefined); }),
  };

  const service = new CompOffService(
    prisma, tvaOf(), calendar, timeline, accessPolicy, eventLogger,
  );
  return { service, prisma, tx, audit, created, updates, poolSize: () => pool.length };
}

const HR = { id: 'hr-1' };
const EMPLOYEE = { id: 'emp-1' };

describe('Comp off source qualification', () => {
  it.each([
    ['Sunday', SUNDAY_FACTS, true],
    ['a holiday', HOLIDAY_FACTS, true],
    ['an ordinary working day', WORKING_FACTS, false],
  ])('%s qualifies=%s', async (_label, facts, expected) => {
    const { service } = rig({ facts });
    const out = await service.qualifyingSourceDay('emp-1', '2026-11-08');
    expect(out.qualifies).toBe(expected);
  });

  it('expires exactly 30 calendar days after the earned business date', () => {
    const { service } = rig();
    expect(service.expiresOn('2026-11-08', 30).toISOString().slice(0, 10)).toBe('2026-12-08');
  });

  it('records the approved 9-hour and 12-hour thresholds explicitly', () => {
    const source = readFileSync(resolve(__dirname, '../../src/modules/operations/leave/comp-off.service.ts'), 'utf8');
    expect(source).toContain('9 * 60');
    expect(source).toContain('12 * 60');
  });

  it('ships a targeted repair for finalized rows created by the old break-excluded rule', () => {
    const migration = readFileSync(
      resolve(__dirname, '../../prisma/migrations/20261028120000_correct_attendance_window/migration.sql'),
      'utf8',
    );
    expect(migration).toContain('EXTRACT(EPOCH FROM ("punchOutAt" - "punchInAt")) / 60 >= 540');
    expect(migration).toContain('"calculationReason" = \'REFINED_SHORT_DAY\'');
    expect(migration).toContain('"lastRegularizationId" IS NULL');
    expect(migration).not.toMatch(/WHERE\s+"date"|AND\s+"date"/i);
  });
});

describe('Comp off automatic earning', () => {
  it('does not grant a credit below 12 elapsed hours', async () => {
    const { service, created } = rig({ facts: SUNDAY_FACTS, sessionSpansByDate: { '2026-11-08': [{ startMinute: 0, endMinute: 719 }] } });
    await service.evaluateCompletedWorkday('emp-1', '2026-11-08', 'ws-1');
    expect(created).toHaveLength(0);
  });

  it('grants a 180-minute credit at exactly 12 elapsed hours', async () => {
    const { service, created } = rig({ facts: SUNDAY_FACTS, sessionSpansByDate: { '2026-11-08': [{ startMinute: 0, endMinute: 720 }] } });
    await service.evaluateCompletedWorkday('emp-1', '2026-11-08', 'ws-1');
    expect(created).toHaveLength(1);
    expect(created[0].earnedFromWorkSessionId).toBe('ws-1');
    expect(created[0].creditMinutes).toBe(180);
    expect(created[0].remainingMinutes).toBe(180);
  });

  it('includes breaks, meetings, and gaps across multiple sessions in the 12-hour clock', async () => {
    const { service, created } = rig({
      facts: SUNDAY_FACTS,
      sessionSpansByDate: {
        '2026-11-08': [
          { startMinute: 0, endMinute: 210 },
          { startMinute: 330, endMinute: 720 },
        ],
      },
    });
    await service.evaluateCompletedWorkday('emp-1', '2026-11-08', 'ws-2');
    expect(created).toHaveLength(1);
  });

  it('three completed 12-hour days earn 540 minutes in total', async () => {
    const { service, created } = rig({
      facts: WORKING_FACTS,
      sessionSpansByDate: {
        '2026-11-09': [{ startMinute: 0, endMinute: 720 }],
        '2026-11-10': [{ startMinute: 0, endMinute: 720 }],
        '2026-11-11': [{ startMinute: 0, endMinute: 720 }],
      },
    });
    await service.evaluateCompletedWorkday('emp-1', '2026-11-09', 'ws-1');
    await service.evaluateCompletedWorkday('emp-1', '2026-11-10', 'ws-2');
    await service.evaluateCompletedWorkday('emp-1', '2026-11-11', 'ws-3');
    expect(created).toHaveLength(3);
    expect(created.reduce((sum, row) => sum + row.creditMinutes, 0)).toBe(540);
  });

  it('a later qualifying day earns its own 180-minute credit', async () => {
    const { service, created } = rig({
      facts: WORKING_FACTS,
      existingCredit: { id: 'prior-streak-credit' },
      sessionSpansByDate: {
        '2026-11-10': [{ startMinute: 0, endMinute: 720 }],
        '2026-11-11': [{ startMinute: 0, endMinute: 720 }],
        '2026-11-12': [{ startMinute: 0, endMinute: 720 }],
      },
    });
    await service.evaluateCompletedWorkday('emp-1', '2026-11-12', 'ws-4');
    expect(created).toHaveLength(1);
    expect(created[0].creditMinutes).toBe(180);
  });
});

describe('Comp off manual grant', () => {
  const input = {
    employeeId: 'emp-1',
    earnedFromBusinessDate: '2026-11-08',
    reason: 'Worked the Diwali release window',
  };

  it('is refused to anyone who is not HR or admin', async () => {
    const { service, created } = rig({ isHr: false });
    await expect(service.grantManual(EMPLOYEE, input)).rejects.toBeInstanceOf(ForbiddenException);
    expect(created).toEqual([]);
  });

  it('is refused on an ordinary working day', async () => {
    const { service, created } = rig({ isHr: true, facts: WORKING_FACTS });
    await expect(service.grantManual(HR, input)).rejects.toBeInstanceOf(
      CompOffSourceNotQualifyingError,
    );
    expect(created).toEqual([]);
  });

  it('requires a reason', async () => {
    const { service } = rig({ isHr: true });
    await expect(
      service.grantManual(HR, { ...input, reason: '' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a malformed source date rather than guessing one', async () => {
    const { service } = rig({ isHr: true });
    await expect(
      service.grantManual(HR, { ...input, earnedFromBusinessDate: '08-11-2026' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('grants on a qualifying day with expiry 30 days out', async () => {
    const { service, created } = rig({ isHr: true });
    const credit = await service.grantManual(HR, input);

    expect(created).toHaveLength(1);
    expect(created[0].employeeId).toBe('emp-1');
    expect(created[0].status).toBe('AVAILABLE');
    expect(credit.expiresAt.toISOString().slice(0, 10)).toBe('2026-12-08');
  });

  it('does not apply automatic duration rules to an audited manual grant', async () => {
    const { service, prisma } = rig({ isHr: true });
    await service.grantManual(HR, {
      ...input,
      earnedFromWorkSessionId: 'ws-1',
    });

    // A source session may be REFERENCED for traceability; the manual exception
    // itself does not run the automatic earning calculation.
    expect(prisma.compOffCredit.create.mock.calls[0][0].data.earnedFromWorkSessionId).toBe('ws-1');
    expect(prisma.workSession.findMany).not.toHaveBeenCalled();
  });

  it('cannot grant the same employee two credits for one source date', async () => {
    const unique: any = new Error('Unique constraint failed');
    unique.code = 'P2002';
    const { service } = rig({ isHr: true, createThrows: unique });

    // The database owns this rule, so two concurrent grants cannot both win.
    await expect(service.grantManual(HR, input)).rejects.toBeInstanceOf(
      CompOffAlreadyGrantedError,
    );
  });

  it('audits the grant without any raw evidence', async () => {
    const { service, audit } = rig({ isHr: true });
    await service.grantManual(HR, input);

    const entry = audit.find((e) => e.action === 'COMP_OFF_GRANTED');
    expect(entry).toBeDefined();
    expect(entry.actorId).toBe('hr-1');
    expect(entry.entityId).toBe('credit-new');
    expect(entry.metadata).toMatchObject({
      employeeId: 'emp-1',
      earnedFromBusinessDate: '2026-11-08',
      reason: 'Worked the Diwali release window',
    });

    const serialised = JSON.stringify(entry);
    expect(serialised).not.toContain('latitude');
    expect(serialised).not.toContain('photo');
    expect(serialised).not.toContain('cloudinary');
  });
});

describe('Comp off multi-day consumption', () => {
  const credits = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `c${i + 1}`,
      expiresAt: `2026-12-0${i + 1}`,
      earnedAt: `2026-11-0${i + 1}`,
    }));

  it('a one-day request consumes exactly one credit', async () => {
    const { service, tx, updates, poolSize } = rig({ credits: credits(3) });

    const used = await service.consumeForDays(tx, 'emp-1', 'lv-1', 1);

    expect(used).toEqual(['c1']);
    expect(updates[0].data.status).toBe('USED');
    expect(poolSize()).toBe(2);
  });

  it('a two-day request consumes exactly two credits', async () => {
    const { service, tx, updates, poolSize } = rig({ credits: credits(3) });

    const used = await service.consumeForDays(tx, 'emp-1', 'lv-1', 2);

    expect(used).toEqual(['c1', 'c2']);
    expect(updates.map((entry) => entry.where.id)).toEqual(['c1', 'c2']);
    expect(poolSize()).toBe(1);
  });

  it('a two-day request with only one credit cannot become fully funded', async () => {
    const { service, tx, updates, poolSize } = rig({ credits: credits(1) });

    const used = await service.consumeForDays(tx, 'emp-1', 'lv-1', 2);

    // All or nothing. A partially funded comp off would spend a real credit on
    // leave that was never granted.
    expect(used).toBeNull();
    expect(updates).toEqual([]);
    expect(poolSize()).toBe(1);
  });

  it('spends the oldest-expiring credits first', async () => {
    const { service, tx } = rig({
      credits: [
        { id: 'late', expiresAt: '2026-12-31', earnedAt: '2026-11-01' },
        { id: 'soon', expiresAt: '2026-12-01', earnedAt: '2026-11-20' },
        { id: 'mid', expiresAt: '2026-12-15', earnedAt: '2026-11-10' },
      ],
    });

    const used = await service.consumeForDays(tx, 'emp-1', 'lv-1', 2);

    // Nobody should lose entitlement because a credit about to lapse was
    // skipped in favour of one with a month left.
    expect(used).toEqual(['soon', 'mid']);
  });

  it('excludes expired credits from the lock query itself', async () => {
    const { service, tx } = rig({ credits: credits(2) });
    await service.consumeForDays(tx, 'emp-1', 'lv-1', 1);

    const sql = (tx.$queryRaw as any).lastSql as string;
    expect(sql).toContain('"expiresAt" >=');
    expect(sql).toContain("status = 'AVAILABLE'");
    // Serialised, not merely filtered: two approvals must not both read the
    // same credits and each believe they can spend them.
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('ORDER BY');
  });

  it('concurrent approvals cannot double-consume the same credit', async () => {
    const { service, tx, poolSize } = rig({ credits: credits(2) });

    // First approval takes both credits...
    const first = await service.consumeForDays(tx, 'emp-1', 'lv-1', 2);
    expect(first).toEqual(['c1', 'c2']);
    expect(poolSize()).toBe(0);

    // ...so a second approval, seeing what the lock left behind, funds nothing.
    const second = await service.consumeForDays(tx, 'emp-1', 'lv-2', 1);
    expect(second).toBeNull();
    expect(poolSize()).toBe(0);
  });

  it('a zero-day request consumes nothing', async () => {
    const { service, tx, updates } = rig({ credits: credits(2) });
    expect(await service.consumeForDays(tx, 'emp-1', 'lv-1', 0)).toEqual([]);
    expect(updates).toEqual([]);
  });

  it('there is no fallback to Casual or Emergency entitlement', () => {
    const source = readFileSync(
      resolve(__dirname, '../../src/modules/operations/leave/comp-off.service.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/CASUAL/);
    expect(source).not.toMatch(/EMERGENCY/);
  });
});
