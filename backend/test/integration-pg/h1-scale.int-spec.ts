/**
 * Item 30: a representative import, measured.
 *
 * Not a benchmark. The question is narrower and more useful: does anything in
 * this pipeline scale per ROW when it should scale per THING? A preview that
 * looks up each employee individually is fine at five rows and a different
 * program at a thousand.
 *
 * Apply is deliberately NOT expected to be constant. Each employee-day runs the
 * evaluator in its own transaction, because atomicity per day is worth more
 * than a fast import -- so the useful assertion there is a bounded cost per
 * row, not a bounded total.
 */

import {
  buildHarness,
  Harness,
  seedCompany,
  Seed,
  csvFile,
  FileRow,
} from './harness';

const EMPLOYEES = 40;
const DAYS = 25;

/** Business days in Aug-Sep 2026 under the fixture policy: no Sundays, no 2nd/4th Saturday. */
function workingDays(count: number): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(2026, 7, 1));
  while (out.length < count) {
    const dow = d.getUTCDay();
    const dom = d.getUTCDate();
    const nthSaturday = Math.ceil(dom / 7);
    const isWeeklyOff = dow === 0 || (dow === 6 && (nthSaturday === 2 || nthSaturday === 4));
    if (!isWeeklyOff) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(dom + 1);
  }
  return out;
}

describe('a representative import', () => {
  let h: Harness;
  let seed: Seed;
  let extraIds: string[];

  beforeAll(async () => {
    h = await buildHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  beforeEach(async () => {
    seed = await seedCompany(h.prisma);

    // A realistic headcount. Six fixture employees is not a scale test.
    extraIds = [];
    const users: any[] = [];
    const profiles: any[] = [];
    for (let i = 0; i < EMPLOYEES; i++) {
      const id = `u-scale-${i}`;
      const employeeId = `TE-9${String(i).padStart(3, '0')}`;
      extraIds.push(employeeId);
      users.push({
        id,
        employeeId,
        email: `${id}@integration.invalid`,
        name: `Scale Employee ${i}`,
        password: 'not-a-real-hash',
        roleId: 'r-employee',
        joiningDate: new Date('2026-04-01T00:00:00.000Z'),
      });
      profiles.push({
        userId: id,
        category: 'REGULAR_EMPLOYEE',
        attendanceRequired: true,
        effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
        assignedShiftId: seed.shiftPolicyId,
        assignedHolidayCalendarId: seed.holidayCalendarId,
        assignedWeeklyOffPolicyId: seed.weeklyOffPolicyId,
        assignedLeavePolicyId: seed.leavePolicyId,
      });
    }
    await h.prisma.user.createMany({ data: users });
    await h.prisma.employeeAttendanceProfile.createMany({ data: profiles });
  });

  it('30. one thousand rows preview with a bounded number of queries', async () => {
    const dates = workingDays(DAYS);
    const rows: FileRow[] = [];
    for (const employeeId of extraIds) {
      for (const date of dates) {
        rows.push({ employeeId, date, status: 'PRESENT', punchIn: '09:35', punchOut: '18:40' });
      }
    }
    expect(rows.length).toBe(EMPLOYEES * DAYS);

    const file = csvFile(rows);

    // Count every statement the preview issues.
    let queries = 0;
    (h.prisma as any).$use(async (params: any, next: any) => {
      queries += 1;
      return next(params);
    });

    const startedAt = Date.now();
    const heapBefore = process.memoryUsage().heapUsed;
    const batch = await h.imports.upload(seed.actors.operator, {
      buffer: file,
      fileName: 'thousand.csv',
      mode: 'CURRENT_CORRECTION',
    });
    const uploadMs = Date.now() - startedAt;
    const uploadQueries = queries;
    const heapAfter = process.memoryUsage().heapUsed;

    const stored = await h.prisma.attendanceImportRow.count({ where: { batchId: batch.id } });
    expect(stored).toBe(rows.length);

    // THE ACTUAL ASSERTION. A per-row employee or attendance lookup would put
    // this in the thousands; the design promises one query per THING plus a
    // bounded number of insert chunks.
    expect(uploadQueries).toBeLessThan(100);

    // eslint-disable-next-line no-console
    console.log(
      `\n  PREVIEW  rows=${rows.length}  queries=${uploadQueries}  ` +
        `duration=${uploadMs}ms  heapDelta=${Math.round((heapAfter - heapBefore) / 1024 / 1024)}MB` +
        `  fileBytes=${file.byteLength}`,
    );

    // ── Apply ─────────────────────────────────────────────────────────────
    await h.apply.approve(seed.actors.hr, batch.id);

    queries = 0;
    const applyStarted = Date.now();
    const out = await h.apply.apply(seed.actors.admin, batch.id);
    const applyMs = Date.now() - applyStarted;

    expect(out.applied).toBe(rows.length);
    expect(out.status).toBe('APPLIED');

    const perRow = queries / rows.length;
    // eslint-disable-next-line no-console
    console.log(
      `  APPLY    rows=${rows.length}  queries=${queries} (${perRow.toFixed(1)}/row)  ` +
        `duration=${applyMs}ms (${(applyMs / rows.length).toFixed(1)}ms/row)`,
    );

    // Per-row cost is the design (one transaction per employee-day), but it
    // must be a small constant. Growth here would mean a lookup inside the
    // per-row loop that should have been hoisted.
    expect(perRow).toBeLessThan(40);

    // Every day genuinely got a correction and a revision.
    expect(await h.prisma.attendanceRegularization.count()).toBe(rows.length);
    expect(await h.prisma.dailyAttendance.count()).toBe(rows.length);

    // THE LEASE SURVIVED THE WHOLE RUN. If a thousand rows outlived the lease,
    // a second operator could have resumed a batch that was still working.
    const finished = await h.prisma.attendanceImportBatch.findUnique({ where: { id: batch.id } });
    expect(finished!.status).toBe('APPLIED');
    const heldFor = applyMs;
    // eslint-disable-next-line no-console
    console.log(
      `  LEASE    run=${heldFor}ms against a 120000ms lease with a 20000ms heartbeat\n`,
    );
    expect(heldFor).toBeLessThan(120000);
  });
});
