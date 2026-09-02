/**
 * Items 14-21: applying an approved batch against a real database.
 *
 * Everything here is about the gap between "HR approved this comparison" and
 * "the write is happening now". A persisted preview is not permission to
 * write, and each of these tests moves the world underneath an approval to see
 * whether the apply notices.
 */

import {
  buildHarness,
  Harness,
  seedCompany,
  Seed,
  givenAttendance,
  givenApprovedLeave,
  csvFile,
  DATE,
  MONTH,
} from './harness';

const CURRENT_IN = '09:35';
const CURRENT_OUT = '18:40';
const IN_Z = '2026-08-14T04:05:00.000Z';
const OUT_Z = '2026-08-14T13:10:00.000Z';

describe('applying an approved batch', () => {
  let h: Harness;
  let seed: Seed;

  beforeAll(async () => {
    h = await buildHarness();
  });
  afterAll(async () => {
    await h?.close();
  });
  beforeEach(async () => {
    seed = await seedCompany(h.prisma);
  });

  /** Upload + approve one CHANGE row for employee B, ready to apply. */
  async function approvedChange(over: { punchOut?: string } = {}) {
    await givenAttendance(h.prisma, seed.employees.B.id, DATE);
    const batch = await h.imports.upload(seed.actors.operator, {
      buffer: csvFile([
        {
          employeeId: 'TE-011',
          date: DATE,
          status: 'PRESENT',
          punchIn: CURRENT_IN,
          punchOut: over.punchOut ?? '19:05',
        },
      ]),
      fileName: 'change.csv',
      mode: 'CURRENT_CORRECTION',
    });
    expect(batch.status).toBe('READY_FOR_REVIEW');
    await h.apply.approve(seed.actors.hr, batch.id);
    return batch;
  }

  const dayOf = (userId: string) =>
    h.prisma.dailyAttendance.findFirst({
      where: { userId, date: new Date(`${DATE}T00:00:00.000Z`) },
    });

  it('14. one applied row commits the correction, the revision and the link together', async () => {
    const batch = await approvedChange();
    const out = await h.apply.apply(seed.actors.admin, batch.id);

    expect(out).toMatchObject({ status: 'APPLIED', attempted: 1, applied: 1, stale: 0, failed: 0 });

    // A regularization exists, carrying the import's own entry source.
    const regs = await h.prisma.attendanceRegularization.findMany();
    expect(regs).toHaveLength(1);
    expect(regs[0].entrySource).toBe('BULK_IMPORT');
    expect(regs[0].userId).toBe(seed.employees.B.id);
    // The evidence fields a real punch would carry are absent, because an
    // import has no evidence to offer.
    expect(regs[0].originalPunchOut?.toISOString()).toBe(OUT_Z);

    // The official record moved, through the evaluator, not by direct write.
    const day = await dayOf(seed.employees.B.id);
    expect(day!.punchOutAt?.toISOString()).toBe('2026-08-14T13:35:00.000Z');
    expect(day!.punchInAt?.toISOString()).toBe(IN_Z);
    expect(day!.revision).toBe(2);
    expect(day!.lastRegularizationId).toBe(regs[0].id);
    // The fingerprint moved with it -- a later batch comparing against the old
    // one must see a difference.
    expect(day!.sourceFingerprint).not.toBe(`fp-${seed.employees.B.id}-${DATE}-1`);

    // And the row records what it did.
    const row = await h.prisma.attendanceImportRow.findFirst({ where: { batchId: batch.id } });
    expect(row!.applyState).toBe('APPLIED');
    expect(row!.regularizationId).toBe(regs[0].id);
    expect(row!.appliedAt).toBeTruthy();
  });

  it('15. a row that fails mid-transaction leaves nothing behind', async () => {
    const batch = await approvedChange();

    // Fail AFTER the regularization is created and the evaluator has been
    // asked, but before the transaction can commit. If the boundary is wrong,
    // a correction or a revision survives the rollback and a retry double-applies.
    const real = h.evaluator.reviseForApprovedCorrection.bind(h.evaluator);
    const spy = jest
      .spyOn(h.evaluator, 'reviseForApprovedCorrection')
      .mockImplementation(async (tx: any, userId: string, date: string, regId: string, opts: any) => {
        await real(tx, userId, date, regId, opts);
        throw new Error('injected failure after the revision, before commit');
      });

    try {
      const out = await h.apply.apply(seed.actors.admin, batch.id);
      expect(out.applied).toBe(0);
      expect(out.failed).toBe(1);
    } finally {
      spy.mockRestore();
    }

    // Nothing committed.
    expect(await h.prisma.attendanceRegularization.count()).toBe(0);
    const day = await dayOf(seed.employees.B.id);
    expect(day!.revision).toBe(1);
    expect(day!.punchOutAt?.toISOString()).toBe(OUT_Z);
    expect(day!.lastRegularizationId).toBeNull();

    const row = await h.prisma.attendanceImportRow.findFirst({ where: { batchId: batch.id } });
    expect(row!.applyState).not.toBe('APPLIED');
    expect(row!.regularizationId).toBeNull();
  });

  it('16. a day corrected by someone else since the preview is SKIPPED_STALE', async () => {
    const batch = await approvedChange();

    // Somebody corrects the same day through the supported path.
    const reg = await h.prisma.attendanceRegularization.create({
      data: {
        userId: seed.employees.B.id,
        date: new Date(`${DATE}T00:00:00.000Z`),
        requestType: 'MISSING_PUNCH',
        reason: 'A manager corrected this first',
        requestedPunchOut: new Date('2026-08-14T13:20:00.000Z'),
        status: 'HR_APPROVED',
        hrDecisionAt: new Date(),
      } as any,
    });
    await h.prisma.$transaction(async (tx) => {
      await h.evaluator.reviseForApprovedCorrection(tx as any, seed.employees.B.id, DATE, reg.id, {
        authority: 'INDIVIDUAL_REVIEW',
      });
    });

    const out = await h.apply.apply(seed.actors.admin, batch.id);
    expect(out.applied).toBe(0);
    expect(out.stale).toBe(1);

    // The other correction stands, untouched.
    const day = await dayOf(seed.employees.B.id);
    expect(day!.punchOutAt?.toISOString()).toBe('2026-08-14T13:20:00.000Z');
    expect(day!.lastRegularizationId).toBe(reg.id);
    expect(await h.prisma.attendanceRegularization.count()).toBe(1);

    const row = await h.prisma.attendanceImportRow.findFirst({ where: { batchId: batch.id } });
    expect(row!.applyState).toBe('SKIPPED_STALE');
  });

  it('17. an open correction raised after the preview is SKIPPED_STALE', async () => {
    const batch = await approvedChange();

    // Not yet approved -- but a human is mid-conversation about this day, and
    // an import must not write underneath them.
    await h.prisma.attendanceRegularization.create({
      data: {
        userId: seed.employees.B.id,
        date: new Date(`${DATE}T00:00:00.000Z`),
        requestType: 'MISSING_PUNCH',
        reason: 'Employee has raised this themselves',
        status: 'PENDING',
      } as any,
    });

    const out = await h.apply.apply(seed.actors.admin, batch.id);
    expect(out.stale).toBe(1);
    expect(out.applied).toBe(0);

    const day = await dayOf(seed.employees.B.id);
    expect(day!.revision).toBe(1);
    // No second competing correction was created.
    expect(await h.prisma.attendanceRegularization.count()).toBe(1);
  });

  it.each([
    ['a locked day', 'day-locked'],
    ['a FINALIZED day', 'day-finalized'],
    ['a FINALIZED month', 'month-finalized'],
    ['a SENT month', 'month-sent'],
  ])('18. %s settled after the preview refuses the bulk write', async (_label, kind) => {
    const batch = await approvedChange();

    if (kind === 'day-locked') {
      await h.prisma.dailyAttendance.updateMany({
        where: { userId: seed.employees.B.id },
        data: { locked: true, lockedAt: new Date() },
      });
    } else if (kind === 'day-finalized') {
      await h.prisma.dailyAttendance.updateMany({
        where: { userId: seed.employees.B.id },
        data: { evaluationState: 'FINALIZED' },
      });
    } else {
      await h.prisma.attendanceMonthClose.create({
        data: {
          month: MONTH,
          status: kind === 'month-sent' ? 'SENT' : 'FINALIZED',
        } as any,
      });
    }

    const out = await h.apply.apply(seed.actors.admin, batch.id);
    expect(out.applied).toBe(0);
    expect(out.stale + out.failed).toBe(1);

    const day = await dayOf(seed.employees.B.id);
    expect(day!.revision).toBe(1);
    expect(day!.punchOutAt?.toISOString()).toBe(OUT_Z);
    expect(await h.prisma.attendanceRegularization.count()).toBe(0);
  });

  it('19. leave authority withdrawn after the preview is SKIPPED_STALE', async () => {
    await givenApprovedLeave(h.prisma, seed.employees.E.id, DATE, DATE);
    const batch = await h.imports.upload(seed.actors.operator, {
      buffer: csvFile([{ employeeId: 'TE-014', date: DATE, status: 'LEAVE', leaveType: 'CASUAL' }]),
      fileName: 'leave.csv',
      mode: 'CURRENT_CORRECTION',
    });
    await h.apply.approve(seed.actors.hr, batch.id);

    // The leave is cancelled between approval and apply.
    await h.prisma.leaveRequest.updateMany({
      where: { userId: seed.employees.E.id },
      data: { status: 'CANCELLED' },
    });

    const out = await h.apply.apply(seed.actors.admin, batch.id);
    expect(out.applied).toBe(0);
    expect(out.stale).toBe(1);

    // No attendance record was invented for a leave that no longer exists.
    const day = await h.prisma.dailyAttendance.findFirst({
      where: { userId: seed.employees.E.id },
    });
    expect(day).toBeNull();
    expect(await h.prisma.attendanceRegularization.count()).toBe(0);
  });

  it('21. an all-MATCH batch succeeds having written nothing', async () => {
    await givenAttendance(h.prisma, seed.employees.A.id, DATE);
    await givenAttendance(h.prisma, seed.employees.B.id, DATE);
    const batch = await h.imports.upload(seed.actors.operator, {
      buffer: csvFile([
        { employeeId: 'TE-010', date: DATE, status: 'PRESENT', punchIn: CURRENT_IN, punchOut: CURRENT_OUT },
        { employeeId: 'TE-011', date: DATE, status: 'PRESENT', punchIn: CURRENT_IN, punchOut: CURRENT_OUT },
      ]),
      fileName: 'all-match.csv',
      mode: 'CURRENT_CORRECTION',
    });
    await h.apply.approve(seed.actors.hr, batch.id);

    const out = await h.apply.apply(seed.actors.admin, batch.id);

    // A file that agrees with reality is a successful reconciliation.
    expect(out.status).toBe('APPLIED');
    expect(out.applied).toBe(0);
    expect(out.noOps).toBe(2);
    expect(await h.prisma.attendanceRegularization.count()).toBe(0);

    const days = await h.prisma.dailyAttendance.findMany();
    expect(days.every((d) => d.revision === 1)).toBe(true);

    const rows = await h.prisma.attendanceImportRow.findMany({ where: { batchId: batch.id } });
    expect(rows.every((r) => r.classification === 'MATCH')).toBe(true);
    expect(rows.every((r) => r.applyState === 'PENDING')).toBe(true);
  });
});
