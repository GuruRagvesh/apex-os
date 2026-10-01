import { AttendanceConsoleService } from '../../src/modules/platform/attendance/console/attendance-console.service';

/**
 * WHO A HISTORICAL EVALUATION INCLUDES.
 *
 * runEvaluation() filtered on `{ isActive: true }` -- today's account flag --
 * so backfilling a past month created official rows for current employees only
 * and silently skipped anybody who had since left. The gap would have been
 * baked into the official record for exactly the people least able to notice.
 *
 * These assert on the employee-DAYS actually handed to the evaluator, not on the
 * query shape. A test that only inspected the `where` clause would still pass if
 * the per-date rule were wrong, which is the failure mode that let the original
 * defect through. The prisma double therefore returns every fixture and lets the
 * service's own filtering be the thing measured -- a double that pre-filtered
 * would be testing itself.
 */

const HR = { id: 'hr-1', name: 'Priya', role: { name: 'HR' } };

interface UserRow {
  id: string;
  joiningDate: Date | null;
  lastWorkingDate: Date | null;
  isActive: boolean;
}

const d = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00.000Z`) : null);

const user = (
  id: string,
  joining: string | null,
  lastWorking: string | null,
  isActive = true,
): UserRow => ({ id, joiningDate: d(joining), lastWorkingDate: d(lastWorking), isActive });

/**
 * Applies the service's real Prisma predicate to a fixture. Throws on anything
 * it does not recognise, so a rewritten query cannot quietly opt out of being
 * tested.
 *
 * OR AND AND ARE COMBINED WITH THEIR SIBLINGS, not returned from early. An
 * earlier version of this matcher elsewhere did `if (where.OR) return
 * where.OR.some(...)`, which ignored every other key at the same level -- so a
 * mutant that reinstated an `isActive` filter alongside an OR went undetected
 * by a test written to catch it. Prisma ANDs an object's keys; so does this.
 */
function matches(row: any, where: any): boolean {
  if (where == null) return true;

  return Object.entries(where).every(([field, cond]: [string, any]) => {
    if (field === 'OR') return (cond as any[]).some((w) => matches(row, w));
    if (field === 'AND') return (cond as any[]).every((w) => matches(row, w));

    const value = row[field];
    if (cond === null) return value === null || value === undefined;
    if (typeof cond === 'boolean' || typeof cond === 'string') return value === cond;

    if (cond && typeof cond === 'object') {
      return Object.entries(cond).every(([op, operand]: [string, any]) => {
        switch (op) {
          case 'lte':
            return value != null && new Date(value) <= new Date(operand as any);
          case 'gte':
            return value != null && new Date(value) >= new Date(operand as any);
          case 'in':
            return (operand as any[]).includes(value);
          default:
            throw new Error(`eligibility matcher does not understand operator '${op}'`);
        }
      });
    }
    throw new Error(`eligibility matcher does not understand a condition on '${field}'`);
  });
}

function build(users: UserRow[]) {
  const evaluated: Array<{ userId: string; businessDate: string }> = [];
  const userWheres: any[] = [];

  const prisma: any = {
    user: {
      // THE REAL WHERE CLAUSE IS APPLIED.
      //
      // Returning every fixture regardless would leave the candidate query
      // untested: a mutant narrowing it to exclude leavers survived exactly
      // that way. The query is a deliberate superset and the per-date primitive
      // is authoritative, so both layers need covering -- this double exercises
      // the first, and the assertions on `evaluated` exercise the second.
      findMany: jest.fn(async ({ where }: any) => {
        userWheres.push(where);
        return users.filter((u) => matches(u, where));
      }),
    },
  };

  const evaluator: any = {
    evaluateAndPersist: jest.fn(async (userId: string, businessDate: string) => {
      evaluated.push({ userId, businessDate });
      return { persisted: true };
    }),
  };

  const tva: any = {
    companyToday: () => '2026-09-30',
    companyBusinessDate: (x: Date) => x.toISOString().slice(0, 10),
    // HONEST DAY BOUNDARIES. These passed the value through unchanged, which
    // left midday as midday -- so a lastWorkingDate stored at 00:00 failed
    // `>= companyDayStart(midday(d))` and the inclusive boundary broke inside
    // the double rather than in the code under test.
    companyDayStart: (x: Date) => new Date(`${x.toISOString().slice(0, 10)}T00:00:00.000Z`),
    companyDayEnd: (x: Date) => new Date(`${x.toISOString().slice(0, 10)}T23:59:59.999Z`),
    companyDateOnly: (x: Date) => x,
    companyTimezone: () => 'Asia/Kolkata',
    now: () => new Date('2026-09-30T06:00:00.000Z'),
  };

  const service = new AttendanceConsoleService(
    prisma,
    tva,
    { isHrOrAdmin: (u: any) => ['HR', 'ADMIN', 'SUPER_ADMIN'].includes(u?.role?.name) } as any,
    {} as any, // hierarchy
    { log: jest.fn(async () => undefined) } as any,
    evaluator,
    {} as any, // processing
    {} as any, // businessCalendar
    {} as any, // leaveBalance
  );

  return { service, evaluated, userWheres };
}

/** The dates a given employee was actually evaluated for. */
const datesFor = (evaluated: Array<{ userId: string; businessDate: string }>, id: string) =>
  evaluated.filter((e) => e.userId === id).map((e) => e.businessDate);

// ════════════════════════════════════════════════════════════════════════════
describe('the harness can distinguish included from excluded', () => {
  it('the matcher actually filters, rather than passing everything through', () => {
    // Proven before anything relies on it.
    const rows = [user('a', '2024-01-01', null), user('b', '2024-01-01', '2026-06-30')];
    const where = { OR: [{ lastWorkingDate: null }] };

    expect(rows.filter((r) => matches(r, where)).map((r) => r.id)).toEqual(['a']);
  });

  it('the matcher refuses a predicate shape it does not understand', () => {
    expect(() => matches(user('a', '2024-01-01', null), { id: { contains: 'a' } })).toThrow(
      /does not understand operator 'contains'/,
    );
  });

  it('records the employee-days the evaluator was asked to decide', async () => {
    const ctx = build([user('a', '2026-01-01', null)]);
    await ctx.service.runEvaluation(HR, { startDate: '2026-09-20', endDate: '2026-09-20' });

    expect(ctx.evaluated).toEqual([{ userId: 'a', businessDate: '2026-09-20' }]);
  });

  it('no longer filters on isActive', async () => {
    const ctx = build([user('a', '2026-01-01', null)]);
    await ctx.service.runEvaluation(HR, { startDate: '2026-09-20', endDate: '2026-09-20' });

    const serialised = JSON.stringify(ctx.userWheres[0]);
    expect(serialised).not.toContain('isActive');
    // The employment window is what narrows the query now.
    expect(serialised).toContain('joiningDate');
    expect(serialised).toContain('lastWorkingDate');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('historical eligibility is decided by the date, not by today', () => {
  it('1. INACTIVE TODAY BUT EMPLOYED ON THE DATE -> INCLUDED', async () => {
    // The regression. Left on 25 September; 20 September is still theirs.
    const ctx = build([user('left', '2025-03-01', '2026-09-25', false)]);

    const out = await ctx.service.runEvaluation(HR, {
      startDate: '2026-09-20',
      endDate: '2026-09-20',
    });

    expect(datesFor(ctx.evaluated, 'left')).toEqual(['2026-09-20']);
    expect(out.evaluated).toBe(1);
    expect(out.notEmployed).toBe(0);
  });

  it('2. joined after the target date -> excluded, counted as notEmployed', async () => {
    const ctx = build([user('future', '2026-10-05', null, true)]);

    const out = await ctx.service.runEvaluation(HR, {
      startDate: '2026-09-20',
      endDate: '2026-09-20',
    });

    // Excluded by the candidate query, which is correct: somebody who joins
    // after the whole range cannot overlap it, so there is nothing to rule on
    // per date. notEmployed counts PARTIAL overlaps -- see the range tests.
    expect(datesFor(ctx.evaluated, 'future')).toEqual([]);
    expect(out.requested).toBe(0);
    expect(out.evaluated).toBe(0);
  });

  it('3. left before the target date -> excluded', async () => {
    const ctx = build([user('gone', '2024-01-01', '2026-06-30', false)]);

    const out = await ctx.service.runEvaluation(HR, {
      startDate: '2026-09-20',
      endDate: '2026-09-20',
    });

    expect(datesFor(ctx.evaluated, 'gone')).toEqual([]);
    expect(out.requested).toBe(0);
  });

  it('4. MISSING EMPLOYMENT METADATA IS UNRESOLVED, NOT A SILENT SKIP', async () => {
    // Its own bucket. Folding it into `skipped` would hide a gap in the employee
    // record behind a correct-looking total, and treating it as employed would
    // put every former employee into every month.
    const ctx = build([user('unknown', null, null, true)]);

    const out = await ctx.service.runEvaluation(HR, {
      startDate: '2026-09-20',
      endDate: '2026-09-20',
    });

    expect(datesFor(ctx.evaluated, 'unknown')).toEqual([]);
    expect(out.employmentUnresolved).toBe(1);
    expect(out.notEmployed).toBe(0);
    expect(out.skipped).toBe(0);
  });

  it('5. a current employee on a valid date -> included', async () => {
    const ctx = build([user('active', '2026-01-15', null, true)]);

    const out = await ctx.service.runEvaluation(HR, {
      startDate: '2026-09-20',
      endDate: '2026-09-20',
    });

    expect(datesFor(ctx.evaluated, 'active')).toEqual(['2026-09-20']);
    expect(out.evaluated).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('eligibility is applied per date, not per employee', () => {
  it('EVALUATES ONLY THE DAYS INSIDE THE WINDOW, ACROSS A RANGE', async () => {
    // Left on the 25th. A range spanning the exit must give the 23rd, 24th and
    // 25th and stop. An employee-level decision would give all five days or
    // none, and both are wrong.
    const ctx = build([user('left', '2025-03-01', '2026-09-25', false)]);

    const out = await ctx.service.runEvaluation(HR, {
      startDate: '2026-09-23',
      endDate: '2026-09-27',
    });

    expect(datesFor(ctx.evaluated, 'left')).toEqual(['2026-09-23', '2026-09-24', '2026-09-25']);
    expect(out.notEmployed).toBe(2);
    expect(out.requested).toBe(3);
  });

  it('the last working day is INCLUSIVE', async () => {
    const ctx = build([user('left', '2025-03-01', '2026-09-25', false)]);
    await ctx.service.runEvaluation(HR, { startDate: '2026-09-25', endDate: '2026-09-25' });

    expect(datesFor(ctx.evaluated, 'left')).toEqual(['2026-09-25']);
  });

  it('the joining day is inclusive too', async () => {
    const ctx = build([user('joiner', '2026-09-22', null, true)]);

    const out = await ctx.service.runEvaluation(HR, {
      startDate: '2026-09-21',
      endDate: '2026-09-23',
    });

    expect(datesFor(ctx.evaluated, 'joiner')).toEqual(['2026-09-22', '2026-09-23']);
    expect(out.notEmployed).toBe(1);
  });

  it('counts ELIGIBLE employee-days against the cap, not candidates times dates', async () => {
    // One employee eligible for one of three days, one for all three.
    const ctx = build([
      user('partial', '2026-09-23', null, true),
      user('whole', '2024-01-01', null, true),
    ]);

    const out = await ctx.service.runEvaluation(HR, {
      startDate: '2026-09-21',
      endDate: '2026-09-23',
    });

    // 1 + 3, not 2 x 3.
    expect(out.requested).toBe(4);
    expect(ctx.evaluated).toHaveLength(4);
  });

  it('a mixed population is split correctly in one run', async () => {
    const ctx = build([
      user('active', '2024-01-01', null, true),
      user('left-mid', '2024-01-01', '2026-09-24', false),
      user('future', '2026-11-01', null, true),
      user('unknown', null, null, true),
    ]);

    const out = await ctx.service.runEvaluation(HR, {
      startDate: '2026-09-23',
      endDate: '2026-09-25',
    });

    expect(datesFor(ctx.evaluated, 'active')).toHaveLength(3);
    expect(datesFor(ctx.evaluated, 'left-mid')).toEqual(['2026-09-23', '2026-09-24']);
    expect(datesFor(ctx.evaluated, 'future')).toEqual([]);
    expect(datesFor(ctx.evaluated, 'unknown')).toEqual([]);

    expect(out.requested).toBe(5);
    // left-mid overlaps the range partially, so its 25th is ruled out per date.
    // `future` never reaches the loop -- the query excluded it -- which is why
    // this is 1 rather than 4.
    expect(out.notEmployed).toBe(1);
    expect(out.employmentUnresolved).toBe(3); // unknown, all three dates
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('authorization is unchanged', () => {
  it('refuses a non-HR actor before reading anything', async () => {
    const ctx = build([user('a', '2026-01-01', null)]);

    await expect(
      ctx.service.runEvaluation({ id: 'e-1', role: { name: 'EMPLOYEE' } } as any, {
        startDate: '2026-09-20',
        endDate: '2026-09-20',
      }),
    ).rejects.toThrow(/Only HR/);

    expect(ctx.evaluated).toHaveLength(0);
  });
});
