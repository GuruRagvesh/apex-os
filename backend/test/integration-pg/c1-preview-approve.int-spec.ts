/**
 * Items 8-10: what a real upload actually persists, and what approval does
 * NOT do.
 *
 * The whole design rests on one claim -- that a preview is a comparison and
 * nothing more, and that an approval is a signature and nothing more. Neither
 * may touch an attendance record. Here that is checked against the tables
 * rather than against a mock's call log.
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
} from './harness';

// The fixture day is 09:35-18:40 company time, which is 04:05Z-13:10Z.
const CURRENT_IN = '09:35';
const CURRENT_OUT = '18:40';

describe('a real upload, previewed and approved', () => {
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

  /** A, B, E have days; C and F do not. */
  async function givenTheWorldAsItIs() {
    await givenAttendance(h.prisma, seed.employees.A.id, DATE);
    await givenAttendance(h.prisma, seed.employees.B.id, DATE);
    await givenApprovedLeave(h.prisma, seed.employees.E.id, DATE, DATE);
  }

  const theFile = () =>
    csvFile([
      // A: exactly what is already recorded.
      { employeeId: 'TE-010', date: DATE, status: 'PRESENT', punchIn: CURRENT_IN, punchOut: CURRENT_OUT },
      // B: a different punch out.
      { employeeId: 'TE-011', date: DATE, status: 'PRESENT', punchIn: CURRENT_IN, punchOut: '19:05' },
      // C: no record at all yet.
      { employeeId: 'TE-012', date: DATE, status: 'PRESENT', punchIn: '09:40', punchOut: '18:35' },
      // E: leave, and the leave genuinely exists.
      { employeeId: 'TE-014', date: DATE, status: 'LEAVE', leaveType: 'CASUAL' },
      // F: leave claimed with no approved leave behind it.
      { employeeId: 'TE-015', date: DATE, status: 'LEAVE', leaveType: 'CASUAL' },
    ]);

  const byEmployee = (rows: any[]) =>
    Object.fromEntries(rows.map((r) => [r.rawEmployeeId, r]));

  it('8a. classifies each of the six cases against real attendance', async () => {
    await givenTheWorldAsItIs();
    const preview = await h.imports.preview(seed.actors.operator, {
      buffer: theFile(),
      fileName: 'august-corrections.csv',
      mode: 'CURRENT_CORRECTION',
    });

    const rows = Object.fromEntries(preview.rows.map((r: any) => [r.employeeId, r]));
    expect(rows['TE-010'].classification).toBe('MATCH');
    expect(rows['TE-011'].classification).toBe('CHANGE');
    expect(rows['TE-012'].classification).toBe('NEW');
    expect(rows['TE-014'].classification).toBe('NEW');
    // No approved leave behind the claim: not importable, whatever the file says.
    expect(rows['TE-015'].classification).toBe('CONFLICT');
  });

  it('8b. persists raw, frozen proposal, current snapshot, fingerprint and codes', async () => {
    await givenTheWorldAsItIs();
    const batch = await h.imports.upload(seed.actors.operator, {
      buffer: theFile(),
      fileName: 'august-corrections.csv',
      mode: 'CURRENT_CORRECTION',
    });

    const stored = await h.prisma.attendanceImportRow.findMany({
      where: { batchId: batch.id },
      orderBy: { rowNumber: 'asc' },
    });
    expect(stored).toHaveLength(5);
    const r = byEmployee(stored);

    // The submitted claim, frozen.
    expect(r['TE-011'].proposedStatus).toBe('PRESENT');
    expect(r['TE-011'].proposedPunchOut?.toISOString()).toBe('2026-08-14T13:35:00.000Z');
    expect(r['TE-011'].normalizedReason).toBe('Integration fixture correction');

    // The world as it was at preview time, including the fingerprint the
    // staleness check will later compare against. A null here would make every
    // Phase 5 staleness comparison vacuous.
    expect(r['TE-011'].currentStatus).toBe('PRESENT');
    expect(r['TE-011'].currentPunchIn?.toISOString()).toBe('2026-08-14T04:05:00.000Z');
    expect(r['TE-011'].currentPunchOut?.toISOString()).toBe('2026-08-14T13:10:00.000Z');
    expect(r['TE-011'].currentFingerprint).toBe(`fp-${seed.employees.B.id}-${DATE}-1`);

    // Codes, not sentences.
    expect(r['TE-015'].classification).toBe('CONFLICT');
    expect(r['TE-015'].messages.length).toBeGreaterThan(0);
    expect(r['TE-015'].messages.every((m: string) => /^[A-Z0-9_]+$/.test(m))).toBe(true);

    // Nobody has a current snapshot they should not have.
    expect(r['TE-012'].currentStatus).toBeNull();
    expect(r['TE-012'].currentFingerprint).toBeNull();

    // Counts on the batch agree with the rows.
    const saved = await h.prisma.attendanceImportBatch.findUnique({ where: { id: batch.id } });
    expect(saved!.totalRows).toBe(5);
    expect(saved!.conflictRows).toBe(1);
    expect(saved!.status).toBe('HAS_ERRORS'); // a conflict is not approvable
  });

  it('8c. writes NOTHING authoritative during preview', async () => {
    await givenTheWorldAsItIs();
    const before = await snapshot();

    await h.imports.upload(seed.actors.operator, {
      buffer: theFile(),
      fileName: 'august-corrections.csv',
      mode: 'CURRENT_CORRECTION',
    });

    expect(await snapshot()).toEqual(before);
  });

  it('8d. never persists private evidence alongside the import', async () => {
    // The preview copies a snapshot of the day. It must not become a second,
    // less-guarded home for object keys, photo hashes, IPs or device metadata.
    const columns: any[] = await h.prisma.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'attendance_import_rows'`,
    );
    const names = columns.map((c) => String(c.column_name).toLowerCase());
    for (const forbidden of ['photo', 'hash', 'ip', 'device', 'latitude', 'longitude', 'objectkey', 'url', 'accuracy']) {
      expect(names.filter((n) => n.includes(forbidden))).toEqual([]);
    }
  });

  it('9. approval is a signature, not a write', async () => {
    await givenTheWorldAsItIs();
    // A clean file, so the batch is approvable at all.
    const batch = await h.imports.upload(seed.actors.operator, {
      buffer: csvFile([
        { employeeId: 'TE-011', date: DATE, status: 'PRESENT', punchIn: CURRENT_IN, punchOut: '19:05' },
      ]),
      fileName: 'clean.csv',
      mode: 'CURRENT_CORRECTION',
    });
    expect(batch.status).toBe('READY_FOR_REVIEW');

    const before = await snapshot();
    await h.apply.approve(seed.actors.hr, batch.id);

    const saved = await h.prisma.attendanceImportBatch.findUnique({ where: { id: batch.id } });
    expect(saved!.status).toBe('APPROVED');
    expect(saved!.uploadedById).toBe(seed.actors.operator.id);
    expect(saved!.approvedById).toBe(seed.actors.hr.id);
    expect(saved!.approvedAt).toBeTruthy();

    // Zero corrections, zero revisions. The signature moved nothing.
    const after = await snapshot();
    expect(after).toEqual(before);
    expect(after.regularizations).toBe(0);
  });

  it('10. the uploader cannot approve their own batch, and PostgreSQL agrees', async () => {
    await givenTheWorldAsItIs();
    const batch = await h.imports.upload(seed.actors.operator, {
      buffer: csvFile([
        { employeeId: 'TE-011', date: DATE, status: 'PRESENT', punchIn: CURRENT_IN, punchOut: '19:05' },
      ]),
      fileName: 'self-approval.csv',
      mode: 'CURRENT_CORRECTION',
    });

    // The operator is HR too, for this test only: authority alone must not be
    // enough when the authority is the same person who uploaded.
    await h.prisma.user.update({
      where: { id: seed.actors.operator.id },
      data: { isHR: true },
    });

    await expect(
      h.apply.approve({ ...seed.actors.operator, isHR: true }, batch.id),
    ).rejects.toThrow();

    const untouched = await h.prisma.attendanceImportBatch.findUnique({ where: { id: batch.id } });
    expect(untouched!.approvedById).toBeNull();
    expect(untouched!.status).toBe('READY_FOR_REVIEW');

    // And if the service check were ever removed, the database still refuses.
    await expect(
      h.prisma.attendanceImportBatch.update({
        where: { id: batch.id },
        data: { approvedById: seed.actors.operator.id },
      }),
    ).rejects.toThrow(/approver_differs_from_uploader/);

    // Somebody else can. No row is silently dropped by the refusal.
    await h.apply.approve(seed.actors.hr, batch.id);
    const approved = await h.prisma.attendanceImportBatch.findUnique({ where: { id: batch.id } });
    expect(approved!.approvedById).toBe(seed.actors.hr.id);
    expect(await h.prisma.attendanceImportRow.count({ where: { batchId: batch.id } })).toBe(1);
  });

  /** Everything authoritative, in one comparable shape. */
  async function snapshot() {
    const days = await h.prisma.dailyAttendance.findMany({
      orderBy: [{ userId: 'asc' }, { date: 'asc' }],
      select: {
        userId: true, date: true, status: true, punchInAt: true, punchOutAt: true,
        revision: true, sourceFingerprint: true, lastRegularizationId: true,
      },
    });
    return {
      days,
      regularizations: await h.prisma.attendanceRegularization.count(),
      leave: await h.prisma.leaveRequest.count(),
    };
  }
});
