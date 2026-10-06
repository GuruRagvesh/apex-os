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

// Comp off is the one entitlement management deliberately left half-specified:
// they named the days that EARN it but never the work required to earn one. So
// every test here is really the same assertion in different clothes — nothing
// creates a credit except a human, and nothing spends one except an exact match.

const tvaOf = () => new TVAService({ get: () => undefined } as unknown as ConfigService);

const HOLIDAY_FACTS = {
  weeklyOff: { isWeeklyOff: false, reasons: [], policyId: 'week-1' },
  holiday: { isHoliday: true, holidayId: 'hol-1', calendarId: 'cal-1', name: 'Diwali', optional: false },
};
const WORKING_FACTS = {
  weeklyOff: { isWeeklyOff: false, reasons: [], policyId: 'week-1' },
  holiday: { isHoliday: false, holidayId: null, calendarId: 'cal-1', name: null, optional: false },
};
const SUNDAY_FACTS = {
  weeklyOff: { isWeeklyOff: true, reasons: ['SUNDAY'], policyId: 'week-1' },
  holiday: { isHoliday: false, holidayId: null, calendarId: 'cal-1', name: null, optional: false },
};

interface RigOptions {
  facts?: any;
  isHr?: boolean;
  /** Credits the employee holds, in whatever order the caller supplies. */
  credits?: Array<{ id: string; expiresAt: string; earnedAt?: string }>;
  createThrows?: any;
  expiryDays?: number;
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
      const limit = sql?.values?.[sql.values.length - 1] ?? 1;
      const sorted = [...pool].sort((a, b) =>
        a.expiresAt === b.expiresAt
          ? String(a.earnedAt ?? '').localeCompare(String(b.earnedAt ?? ''))
          : a.expiresAt.localeCompare(b.expiresAt),
      );
      (tx.$queryRaw as any).lastSql = text;
      return Promise.resolve(sorted.slice(0, Number(limit)).map((c) => ({ id: c.id })));
    }),
    compOffCredit: {
      updateMany: jest.fn((args: any) => {
        const ids: string[] = args.where.id.in;
        updates.push(args);
        pool = pool.filter((c) => !ids.includes(c.id));
        return Promise.resolve({ count: ids.length });
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

  it('contains no automatic WorkSession-to-credit creation path', () => {
    const source = readFileSync(
      resolve(__dirname, '../../src/modules/operations/leave/comp-off.service.ts'),
      'utf8',
    );
    // Management never defined how much work earns a credit, so there must be
    // no arithmetic here that quietly decides it.
    expect(source).not.toMatch(/totalWorkMinutes/);
    expect(source).not.toMatch(/workSession\.(findMany|findFirst)/);
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

  it('never inspects how long anybody worked', async () => {
    const { service, prisma } = rig({ isHr: true });
    await service.grantManual(HR, {
      ...input,
      earnedFromWorkSessionId: 'ws-1',
    });

    // A source session may be REFERENCED for traceability, but its duration is
    // never read — there is no approved threshold to compare it against.
    expect(prisma.compOffCredit.create.mock.calls[0][0].data.earnedFromWorkSessionId).toBe('ws-1');
    expect((prisma as any).workSession).toBeUndefined();
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
    expect(updates[0].where.id.in).toEqual(['c1', 'c2']);
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
