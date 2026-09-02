/**
 * Items 20, 22, 23: the historical channel, and re-preview against today.
 *
 * The historical case is the one where the temptation to invent data is
 * strongest -- a PRESENT day with no punches looks incomplete, and a system
 * that "helpfully" fills in 09:30/18:30 has fabricated an attendance record.
 * Re-preview is the other half: an approval is only as good as the comparison
 * it was given, so re-previewing must rebuild that comparison from today.
 */

import {
  buildHarness,
  Harness,
  seedCompany,
  Seed,
  givenAttendance,
  csvFile,
  DATE,
} from './harness';

const CURRENT_IN = '09:35';
const OUT_Z = '2026-08-14T13:10:00.000Z';
const HISTORICAL_DATE = '2026-05-15'; // A Friday, well before the fixture month.

describe('historical migration and re-preview', () => {
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

  it('20. a historical PRESENT day with no punches invents nothing', async () => {
    const batch = await h.imports.upload(seed.actors.operator, {
      buffer: csvFile([
        { employeeId: 'TE-013', date: HISTORICAL_DATE, status: 'PRESENT', reason: 'Paper register migration' },
      ]),
      fileName: 'historical.csv',
      mode: 'HISTORICAL_MIGRATION',
    });
    await h.apply.approve(seed.actors.hr, batch.id);
    const out = await h.apply.apply(seed.actors.admin, batch.id);
    expect(out.applied).toBe(1);

    const day = await h.prisma.dailyAttendance.findFirst({
      where: { userId: seed.employees.D.id },
    });

    expect(day!.status).toBe('PRESENT');
    // The whole point. Absent is not zero, and it is certainly not 09:30.
    expect(day!.punchInAt).toBeNull();
    expect(day!.punchOutAt).toBeNull();
    // Presence is punch out minus punch in. With neither, there is no number.
    expect(day!.workedMinutes == null || day!.workedMinutes === 0).toBe(true);
    // Late is a judgement about a punch in that does not exist here.
    expect(day!.lateMinutes == null || day!.lateMinutes === 0).toBe(true);

    // No evidence was manufactured to make the day look captured.
    expect(day!.punchInEvidenceId).toBeNull();
    expect(day!.punchOutEvidenceId).toBeNull();
    expect(await h.prisma.attendancePunchEvidence.count()).toBe(0);

    const reg = await h.prisma.attendanceRegularization.findFirst();
    expect(reg!.entrySource).toBe('HISTORICAL_IMPORT');
    expect(reg!.requestedPunchIn).toBeNull();
    expect(reg!.requestedPunchOut).toBeNull();
  });

  /** An approved CHANGE for employee B, applied once and left stale. */
  async function staleBatch() {
    await givenAttendance(h.prisma, seed.employees.B.id, DATE);
    const batch = await h.imports.upload(seed.actors.operator, {
      buffer: csvFile([
        { employeeId: 'TE-011', date: DATE, status: 'PRESENT', punchIn: CURRENT_IN, punchOut: '19:05' },
      ]),
      fileName: 'to-go-stale.csv',
      mode: 'CURRENT_CORRECTION',
    });
    await h.apply.approve(seed.actors.hr, batch.id);
    return batch;
  }

  /** Corrects B's day out from under the batch, through the supported path. */
  async function correctExternally(punchOutIso: string) {
    const reg = await h.prisma.attendanceRegularization.create({
      data: {
        userId: seed.employees.B.id,
        date: new Date(`${DATE}T00:00:00.000Z`),
        requestType: 'MISSING_PUNCH',
        reason: 'Corrected outside the import',
        requestedPunchOut: new Date(punchOutIso),
        status: 'HR_APPROVED',
        // A real HR approval always stamps this. Leaving it null would make
        // this correction outrank every later one, which is the hazard the
        // evaluator's NULLS LAST ordering now defends against.
        hrDecisionAt: new Date(),
      } as any,
    });
    await h.prisma.$transaction(async (tx) => {
      await h.evaluator.reviseForApprovedCorrection(tx as any, seed.employees.B.id, DATE, reg.id, {
        authority: 'INDIVIDUAL_REVIEW',
      });
    });
    return reg;
  }

  it('22. re-preview rebuilds the current side and demands a fresh approval', async () => {
    const batch = await staleBatch();
    const before = await h.prisma.attendanceImportRow.findFirst({ where: { batchId: batch.id } });
    expect(before!.currentPunchOut?.toISOString()).toBe(OUT_Z);
    const fingerprintAtUpload = before!.currentFingerprint;

    await correctExternally('2026-08-14T13:20:00.000Z');

    const stale = await h.apply.apply(seed.actors.admin, batch.id);
    expect(stale.stale).toBe(1);
    expect(stale.status).toBe('REVIEW_REQUIRED');

    // Applying again without re-previewing is refused: the approval on file
    // was given against a comparison that is no longer true.
    await expect(h.apply.apply(seed.actors.admin, batch.id)).rejects.toThrow(/re-preview/i);

    await h.apply.rePreview(seed.actors.hr, batch.id);

    const after = await h.prisma.attendanceImportRow.findFirst({ where: { batchId: batch.id } });
    // The current side moved to today's truth.
    expect(after!.currentPunchOut?.toISOString()).toBe('2026-08-14T13:20:00.000Z');
    expect(after!.currentFingerprint).not.toBe(fingerprintAtUpload);
    expect(after!.currentStatus).toBeTruthy();
    expect(after!.applyState).toBe('PENDING');
    expect(after!.classification).toBe('CHANGE');

    // The submitted claim did NOT move.
    expect(after!.proposedPunchOut?.toISOString()).toBe(before!.proposedPunchOut?.toISOString());
    expect(after!.proposedStatus).toBe(before!.proposedStatus);
    expect(after!.rawPunchOut).toBe(before!.rawPunchOut);

    // And the old signature is gone.
    const reBatch = await h.prisma.attendanceImportBatch.findUnique({ where: { id: batch.id } });
    expect(reBatch!.approvedById).toBeNull();
    expect(reBatch!.approvedAt).toBeNull();
    expect(reBatch!.status).toBe('READY_FOR_REVIEW');

    // Apply is refused until somebody signs the NEW comparison.
    await expect(h.apply.apply(seed.actors.admin, batch.id)).rejects.toThrow();

    await h.apply.approve(seed.actors.hr, batch.id);
    const out = await h.apply.apply(seed.actors.admin, batch.id);
    expect(out.applied).toBe(1);
    const day = await h.prisma.dailyAttendance.findFirst({ where: { userId: seed.employees.B.id } });
    expect(day!.punchOutAt?.toISOString()).toBe('2026-08-14T13:35:00.000Z');
  });

  it('23. a stale row that has become correct re-previews to MATCH', async () => {
    const batch = await staleBatch();

    // Somebody else made exactly the change this batch was going to make.
    await correctExternally('2026-08-14T13:35:00.000Z');

    const stale = await h.apply.apply(seed.actors.admin, batch.id);
    expect(stale.stale).toBe(1);

    await h.apply.rePreview(seed.actors.hr, batch.id);

    const row = await h.prisma.attendanceImportRow.findFirst({ where: { batchId: batch.id } });
    // Successful reconciliation, not outstanding work.
    expect(row!.classification).toBe('MATCH');

    const regsBefore = await h.prisma.attendanceRegularization.count();
    await h.apply.approve(seed.actors.hr, batch.id);
    const out = await h.apply.apply(seed.actors.admin, batch.id);

    expect(out.status).toBe('APPLIED');
    expect(out.applied).toBe(0);
    expect(out.noOps).toBe(1);
    // The import produced no correction of its own.
    expect(await h.prisma.attendanceRegularization.count()).toBe(regsBefore);
    const day = await h.prisma.dailyAttendance.findFirst({ where: { userId: seed.employees.B.id } });
    expect(day!.revision).toBe(2); // still just the external correction
  });

  it('29. every actionable row going stale is REVIEW_REQUIRED, not FAILED', async () => {
    const batch = await staleBatch();
    await correctExternally('2026-08-14T13:20:00.000Z');

    const out = await h.apply.apply(seed.actors.admin, batch.id);
    expect(out.applied).toBe(0);
    expect(out.stale).toBe(1);
    expect(out.failed).toBe(0);
    expect(out.status).toBe('REVIEW_REQUIRED');

    const saved = await h.prisma.attendanceImportBatch.findUnique({ where: { id: batch.id } });
    expect(saved!.status).toBe('REVIEW_REQUIRED');

    // Refused until re-previewed, then refused again until re-approved.
    await expect(h.apply.apply(seed.actors.admin, batch.id)).rejects.toThrow();
    await h.apply.rePreview(seed.actors.hr, batch.id);
    await expect(h.apply.apply(seed.actors.admin, batch.id)).rejects.toThrow();
    await h.apply.approve(seed.actors.hr, batch.id);
    await expect(h.apply.apply(seed.actors.admin, batch.id)).resolves.toBeTruthy();
  });

  it('22b. re-preview never reopens a row that already applied', async () => {
    await givenAttendance(h.prisma, seed.employees.A.id, DATE);
    await givenAttendance(h.prisma, seed.employees.B.id, DATE);
    const batch = await h.imports.upload(seed.actors.operator, {
      buffer: csvFile([
        { employeeId: 'TE-010', date: DATE, status: 'PRESENT', punchIn: CURRENT_IN, punchOut: '19:05' },
        { employeeId: 'TE-011', date: DATE, status: 'PRESENT', punchIn: CURRENT_IN, punchOut: '19:05' },
      ]),
      fileName: 'partial.csv',
      mode: 'CURRENT_CORRECTION',
    });
    await h.apply.approve(seed.actors.hr, batch.id);

    // B goes stale; A does not.
    await correctExternally('2026-08-14T13:20:00.000Z');

    const out = await h.apply.apply(seed.actors.admin, batch.id);
    expect(out.applied).toBe(1);
    expect(out.stale).toBe(1);
    expect(out.status).toBe('PARTIALLY_APPLIED');

    const appliedRow = await h.prisma.attendanceImportRow.findFirst({
      where: { batchId: batch.id, applyState: 'APPLIED' },
    });
    const frozen = {
      state: appliedRow!.applyState,
      reg: appliedRow!.regularizationId,
      at: appliedRow!.appliedAt?.toISOString(),
      classification: appliedRow!.classification,
      fingerprint: appliedRow!.currentFingerprint,
    };

    await h.apply.rePreview(seed.actors.hr, batch.id);

    const stillApplied = await h.prisma.attendanceImportRow.findUnique({
      where: { id: appliedRow!.id },
    });
    expect({
      state: stillApplied!.applyState,
      reg: stillApplied!.regularizationId,
      at: stillApplied!.appliedAt?.toISOString(),
      classification: stillApplied!.classification,
      fingerprint: stillApplied!.currentFingerprint,
    }).toEqual(frozen);
  });
});
