/**
 * Item 10: an approver may not approve a change to their OWN attendance.
 *
 * A DIFFERENT RULE FROM MAKER/CHECKER, and easy to conflate.
 *
 * Maker/checker asks who uploaded versus who signed, and the database enforces
 * it with a CHECK constraint (c1-preview-approve). This asks something the
 * database cannot see: whether the batch being signed contains a row about the
 * signer. Somebody approving a change to their own record is the one review
 * that reviews nothing, and the two people involved can be entirely different.
 *
 * The refusal is of the WHOLE BATCH, not of the offending row. Quietly
 * excluding it would apply a batch the approver believes they approved in
 * full -- which is a worse failure than a refusal, because nobody would know.
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
const CURRENT_OUT = '18:40';

describe('an approver may not sign off their own attendance', () => {
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

  /** HR B is TE-901 and has a real attendance day of their own. */
  async function batchTouchingHrsOwnDay(extra: any[] = []) {
    await givenAttendance(h.prisma, seed.actors.hr.id, DATE);
    await givenAttendance(h.prisma, seed.employees.A.id, DATE);
    const batch = await h.imports.upload(seed.actors.operator, {
      buffer: csvFile([
        // Somebody else's day, so the batch is not solely about the approver.
        { employeeId: 'TE-010', date: DATE, status: 'PRESENT', punchIn: CURRENT_IN, punchOut: '19:05' },
        // HR B's own day, changed.
        { employeeId: 'TE-901', date: DATE, status: 'PRESENT', punchIn: CURRENT_IN, punchOut: '19:20' },
        ...extra,
      ]),
      fileName: 'includes-the-approver.csv',
      mode: 'CURRENT_CORRECTION',
    });
    expect(batch.status).toBe('READY_FOR_REVIEW');
    return batch;
  }

  it('10a. HR B cannot approve a batch that changes HR B own attendance', async () => {
    const batch = await batchTouchingHrsOwnDay();

    // The maker/checker rule is satisfied -- the operator uploaded, HR B would
    // sign. This must still be refused, on the other rule entirely.
    await expect(h.apply.approve(seed.actors.hr, batch.id)).rejects.toThrow(
      /your own attendance/i,
    );

    const untouched = await h.prisma.attendanceImportBatch.findUnique({ where: { id: batch.id } });
    expect(untouched!.status).toBe('READY_FOR_REVIEW');
    expect(untouched!.approvedById).toBeNull();
    expect(untouched!.approvedAt).toBeNull();
  });

  it('10b. the refusal names how many days, and drops no row', async () => {
    const batch = await batchTouchingHrsOwnDay([
      // A second day of the approver's own, to prove the count is real.
      { employeeId: 'TE-901', date: '2026-08-13', status: 'PRESENT', punchIn: CURRENT_IN, punchOut: '19:20' },
    ]);

    await expect(h.apply.approve(seed.actors.hr, batch.id)).rejects.toThrow(/2 day/);

    // NO SILENT OMISSION. All three rows are still there, none excluded, none
    // rewritten to dodge the guard.
    const rows = await h.prisma.attendanceImportRow.findMany({ where: { batchId: batch.id } });
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.rawEmployeeId === 'TE-901')).toHaveLength(2);
    expect(rows.every((r) => r.applyState === 'PENDING')).toBe(true);
  });

  it('10c. another authorised approver can sign the same batch, in full', async () => {
    const batch = await batchTouchingHrsOwnDay();
    await expect(h.apply.approve(seed.actors.hr, batch.id)).rejects.toThrow();

    // Admin C is authorised, is not the uploader, and is not in the batch.
    await h.apply.approve(seed.actors.admin, batch.id);

    const approved = await h.prisma.attendanceImportBatch.findUnique({ where: { id: batch.id } });
    expect(approved!.status).toBe('APPROVED');
    expect(approved!.uploadedById).toBe(seed.actors.operator.id);
    expect(approved!.approvedById).toBe(seed.actors.admin.id);

    // And the approver's own day is applied along with everything else --
    // the earlier refusal excluded nothing.
    const out = await h.apply.apply(seed.actors.admin, batch.id);
    expect(out.applied).toBe(2);

    const hrDay = await h.prisma.dailyAttendance.findFirst({
      where: { userId: seed.actors.hr.id, date: new Date(`${DATE}T00:00:00.000Z`) },
    });
    expect(hrDay!.punchOutAt?.toISOString()).toBe('2026-08-14T13:50:00.000Z');
    expect(hrDay!.revision).toBe(2);
  });

  it('10d. a MATCH row about the approver own day does not block them', async () => {
    // The guard counts NEW and CHANGE. A row that agrees with what is already
    // recorded proposes no change to the approver's attendance, so refusing it
    // would block a reconciliation for no reason. Worth pinning: this boundary
    // could plausibly be wrong in either direction.
    await givenAttendance(h.prisma, seed.actors.hr.id, DATE);
    await givenAttendance(h.prisma, seed.employees.A.id, DATE);
    const batch = await h.imports.upload(seed.actors.operator, {
      buffer: csvFile([
        { employeeId: 'TE-010', date: DATE, status: 'PRESENT', punchIn: CURRENT_IN, punchOut: '19:05' },
        // Exactly what is already on record for the approver.
        { employeeId: 'TE-901', date: DATE, status: 'PRESENT', punchIn: CURRENT_IN, punchOut: CURRENT_OUT },
      ]),
      fileName: 'approver-row-matches.csv',
      mode: 'CURRENT_CORRECTION',
    });

    const rows = await h.prisma.attendanceImportRow.findMany({ where: { batchId: batch.id } });
    expect(rows.find((r) => r.rawEmployeeId === 'TE-901')!.classification).toBe('MATCH');

    await h.apply.approve(seed.actors.hr, batch.id);
    const approved = await h.prisma.attendanceImportBatch.findUnique({ where: { id: batch.id } });
    expect(approved!.status).toBe('APPROVED');

    // Their own day is untouched by the apply, because there was nothing to do.
    const out = await h.apply.apply(seed.actors.admin, batch.id);
    expect(out.applied).toBe(1);
    const hrDay = await h.prisma.dailyAttendance.findFirst({
      where: { userId: seed.actors.hr.id, date: new Date(`${DATE}T00:00:00.000Z`) },
    });
    expect(hrDay!.revision).toBe(1);
  });

  it('10e. an approver cannot slip their own NEW day past the guard either', async () => {
    // No existing record for the approver, so the row is NEW rather than
    // CHANGE. Creating your own attendance from nothing is at least as strong
    // a conflict of interest as amending it.
    await givenAttendance(h.prisma, seed.employees.A.id, DATE);
    const batch = await h.imports.upload(seed.actors.operator, {
      buffer: csvFile([
        { employeeId: 'TE-010', date: DATE, status: 'PRESENT', punchIn: CURRENT_IN, punchOut: '19:05' },
        { employeeId: 'TE-901', date: DATE, status: 'PRESENT', punchIn: CURRENT_IN, punchOut: '19:20' },
      ]),
      fileName: 'approver-new-day.csv',
      mode: 'CURRENT_CORRECTION',
    });

    const rows = await h.prisma.attendanceImportRow.findMany({ where: { batchId: batch.id } });
    expect(rows.find((r) => r.rawEmployeeId === 'TE-901')!.classification).toBe('NEW');

    await expect(h.apply.approve(seed.actors.hr, batch.id)).rejects.toThrow(/your own attendance/i);
  });
});
