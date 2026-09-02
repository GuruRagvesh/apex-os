/**
 * Items 24-28: two workers, one batch.
 *
 * The lease, the heartbeat and the ownership check exist for one situation --
 * a worker that everybody believes is dead, waking up. Unit tests proved the
 * logic agreed with itself. These run two real service calls against one real
 * database and check what actually got written.
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('two workers, one batch', () => {
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

  /** An approved batch with N actionable CHANGE rows, one per employee. */
  async function approvedBatch(letters: string[]) {
    for (const letter of letters) {
      await givenAttendance(h.prisma, seed.employees[letter].id, DATE);
    }
    const employeeIds: Record<string, string> = {
      A: 'TE-010', B: 'TE-011', C: 'TE-012', D: 'TE-013', E: 'TE-014', F: 'TE-015',
    };
    const batch = await h.imports.upload(seed.actors.operator, {
      buffer: csvFile(
        letters.map((letter) => ({
          employeeId: employeeIds[letter],
          date: DATE,
          status: 'PRESENT',
          punchIn: CURRENT_IN,
          punchOut: '19:05',
        })),
      ),
      fileName: 'concurrent.csv',
      mode: 'CURRENT_CORRECTION',
    });
    await h.apply.approve(seed.actors.hr, batch.id);
    return batch;
  }

  const batchRow = (id: string) =>
    h.prisma.attendanceImportBatch.findUnique({ where: { id } });

  it('24. a second apply while the lease is fresh is refused, not run', async () => {
    const batch = await approvedBatch(['A', 'B', 'C']);

    // Both start. One claims the batch; the other must find it claimed.
    const [first, second] = await Promise.allSettled([
      h.apply.apply(seed.actors.admin, batch.id),
      h.apply.apply(seed.actors.hr, batch.id),
    ]);

    const outcomes = [first, second];
    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String((rejected[0] as any).reason?.message)).toMatch(/already being applied|conflict/i);

    // Each employee-day was corrected exactly once.
    expect(await h.prisma.attendanceRegularization.count()).toBe(3);
    for (const letter of ['A', 'B', 'C']) {
      const days = await h.prisma.dailyAttendance.findMany({
        where: { userId: seed.employees[letter].id },
      });
      expect(days).toHaveLength(1);
      expect(days[0].revision).toBe(2);
    }

    const rows = await h.prisma.attendanceImportRow.findMany({ where: { batchId: batch.id } });
    expect(rows.filter((r) => r.applyState === 'APPLIED')).toHaveLength(3);
  });

  it('25. an expired lease can be resumed, and applied rows are left alone', async () => {
    const batch = await approvedBatch(['A', 'B', 'C']);

    // One row applied, then the worker died: APPLYING with a stale heartbeat.
    const rows = await h.prisma.attendanceImportRow.findMany({
      where: { batchId: batch.id },
      orderBy: { rowNumber: 'asc' },
    });
    const deadAttempt = 'attempt-that-died';
    const reg = await h.prisma.attendanceRegularization.create({
      data: {
        userId: rows[0].userId!,
        date: rows[0].businessDate!,
        requestType: 'MISSING_PUNCH',
        reason: 'Applied by the worker that then died',
        requestedPunchOut: rows[0].proposedPunchOut,
        status: 'HR_APPROVED',
        hrDecisionAt: new Date(),
        entrySource: 'BULK_IMPORT',
      } as any,
    });
    await h.prisma.$transaction(async (tx) => {
      await h.evaluator.reviseForApprovedCorrection(
        tx as any, rows[0].userId!, DATE, reg.id, { authority: 'BULK_IMPORT' },
      );
    });
    await h.prisma.attendanceImportRow.update({
      where: { id: rows[0].id },
      data: { applyState: 'APPLIED', regularizationId: reg.id, appliedAt: new Date() },
    });
    const longAgo = new Date(Date.now() - 30 * 60 * 1000);
    await h.prisma.attendanceImportBatch.update({
      where: { id: batch.id },
      data: {
        status: 'APPLYING',
        applyAttemptId: deadAttempt,
        applyStartedAt: longAgo,
        applyHeartbeatAt: longAgo,
        appliedById: seed.actors.admin.id,
      },
    });

    // The attempt id must be read DURING the run: a completed run releases its
    // lease, so checking afterwards would only ever see null and would pass
    // just as happily if resume had reused the dead worker's id.
    const seenAttempts: (string | null)[] = [];
    const realRevise = h.evaluator.reviseForApprovedCorrection.bind(h.evaluator);
    const spy = jest
      .spyOn(h.evaluator, 'reviseForApprovedCorrection')
      .mockImplementation(async (tx: any, userId: string, date: string, regId: string, opts: any) => {
        const live = await h.prisma.attendanceImportBatch.findUnique({ where: { id: batch.id } });
        seenAttempts.push(live!.applyAttemptId);
        return realRevise(tx, userId, date, regId, opts);
      });

    const out = await h.apply.resume(seed.actors.hr, batch.id);
    spy.mockRestore();

    // The two unfinished rows ran; the applied one did not run again.
    expect(out.applied).toBe(2);
    expect(await h.prisma.attendanceRegularization.count()).toBe(3);

    // A NEW attempt id, observed while the run held it.
    expect(seenAttempts.length).toBe(2);
    expect(new Set(seenAttempts).size).toBe(1);
    expect(seenAttempts[0]).toBeTruthy();
    expect(seenAttempts[0]).not.toBe(deadAttempt);

    const after = await batchRow(batch.id);
    // And the lease is released once the run is over, rather than left held.
    expect(after!.applyAttemptId).toBeNull();
    expect(after!.appliedById).toBe(seed.actors.hr.id);

    const appliedRow = await h.prisma.attendanceImportRow.findUnique({ where: { id: rows[0].id } });
    expect(appliedRow!.regularizationId).toBe(reg.id);
    const day = await h.prisma.dailyAttendance.findFirst({ where: { userId: rows[0].userId! } });
    expect(day!.revision).toBe(2); // corrected once, not twice
  });

  it('26. two simultaneous resumers produce one owner and one conflict', async () => {
    const batch = await approvedBatch(['A', 'B']);
    const longAgo = new Date(Date.now() - 30 * 60 * 1000);
    await h.prisma.attendanceImportBatch.update({
      where: { id: batch.id },
      data: {
        status: 'APPLYING',
        applyAttemptId: 'dead',
        applyStartedAt: longAgo,
        applyHeartbeatAt: longAgo,
        appliedById: seed.actors.admin.id,
      },
    });

    const settled = await Promise.allSettled([
      h.apply.resume(seed.actors.admin, batch.id),
      h.apply.resume(seed.actors.hr, batch.id),
    ]);

    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter((s) => s.status === 'rejected')).toHaveLength(1);

    // Two rows, two corrections. Not four.
    expect(await h.prisma.attendanceRegularization.count()).toBe(2);
    for (const letter of ['A', 'B']) {
      const day = await h.prisma.dailyAttendance.findFirst({
        where: { userId: seed.employees[letter].id },
      });
      expect(day!.revision).toBe(2);
    }
  });

  it('27. a zombie worker that wakes up writes nothing and reports SUPERSEDED', async () => {
    const batch = await approvedBatch(['A', 'B', 'C']);

    // Worker A claims the batch and is paused after its first row, exactly
    // where a stalled process would be.
    let releaseZombie!: () => void;
    const stall = new Promise<void>((resolve) => {
      releaseZombie = resolve;
    });
    let rowsSeenByZombie = 0;
    const real = h.evaluator.reviseForApprovedCorrection.bind(h.evaluator);
    const spy = jest
      .spyOn(h.evaluator, 'reviseForApprovedCorrection')
      .mockImplementation(async (tx: any, userId: string, date: string, regId: string, opts: any) => {
        rowsSeenByZombie += 1;
        if (rowsSeenByZombie === 2) await stall;
        return real(tx, userId, date, regId, opts);
      });

    const zombie = h.apply.apply(seed.actors.admin, batch.id);

    // Wait until it is genuinely mid-run.
    for (let i = 0; i < 100 && rowsSeenByZombie < 2; i++) await sleep(50);
    expect(rowsSeenByZombie).toBe(2);

    // Meanwhile the lease is declared dead and worker B takes over. The stall
    // is inside the evaluator, so the zombie cannot heartbeat while it waits.
    const longAgo = new Date(Date.now() - 30 * 60 * 1000);
    await h.prisma.attendanceImportBatch.update({
      where: { id: batch.id },
      data: { applyHeartbeatAt: longAgo, applyStartedAt: longAgo },
    });
    const takeover = await h.prisma.attendanceImportBatch.update({
      where: { id: batch.id },
      data: { applyAttemptId: 'new-owner-attempt', appliedById: seed.actors.hr.id },
    });
    expect(takeover.applyAttemptId).toBe('new-owner-attempt');

    // The zombie wakes.
    releaseZombie();
    const out = await zombie;
    spy.mockRestore();

    // It stopped rather than finishing the batch it no longer owns.
    expect(out.status).toBe('SUPERSEDED');

    // WHERE THE GUARANTEE ACTUALLY SITS.
    //
    // The zombie had already passed the ownership check for its in-flight row
    // and was inside that row's transaction when the takeover happened, so
    // that ONE employee-day commits. That is safe and deliberate: an
    // employee-day is atomic, and the new owner will either find the row
    // APPLIED or find the fingerprint moved and skip it.
    //
    // What must never happen is the zombie BEGINNING a further row. It saw
    // exactly two, and the third was never attempted.
    expect(rowsSeenByZombie).toBe(2);

    // No day was corrected twice, which is the outcome that would matter.
    const days = await h.prisma.dailyAttendance.findMany({ select: { userId: true, revision: true } });
    expect(days.every((d) => d.revision <= 2)).toBe(true);
    const regs = await h.prisma.attendanceRegularization.groupBy({
      by: ['userId'],
      _count: { _all: true },
    });
    expect(regs.every((r) => r._count._all === 1)).toBe(true);

    // The new owner is still the owner, and the zombie's heartbeat never
    // touched it.
    const owner = await batchRow(batch.id);
    expect(owner!.applyAttemptId).toBe('new-owner-attempt');

    // The row the zombie never reached is still available to the new owner.
    const untouched = await h.prisma.attendanceImportRow.count({
      where: { batchId: batch.id, applyState: 'PENDING' },
    });
    expect(untouched).toBe(1);
  });

  it('28. a crash after partial commit leaves committed rows applied and the rest resumable', async () => {
    const batch = await approvedBatch(['A', 'B', 'C', 'D']);

    // A CRASH, not an error.
    //
    // Throwing inside a row would mark that row FAILED, which is a different
    // story: the worker survived and recorded a verdict. A crashed worker
    // records nothing, so its untouched rows stay PENDING. That is simulated
    // here by taking the batch away mid-run, which stops the worker at its
    // next ownership check and leaves the remainder exactly as a dead process
    // would have left them.
    let seen = 0;
    const real = h.evaluator.reviseForApprovedCorrection.bind(h.evaluator);
    const spy = jest
      .spyOn(h.evaluator, 'reviseForApprovedCorrection')
      .mockImplementation(async (tx: any, userId: string, date: string, regId: string, opts: any) => {
        seen += 1;
        const result = await real(tx, userId, date, regId, opts);
        if (seen === 2) {
          await h.prisma.attendanceImportBatch.update({
            where: { id: batch.id },
            data: { applyAttemptId: 'the-worker-is-gone' },
          });
        }
        return result;
      });

    await h.apply.apply(seed.actors.admin, batch.id).catch(() => undefined);
    spy.mockRestore();

    const midRows = await h.prisma.attendanceImportRow.findMany({
      where: { batchId: batch.id },
      orderBy: { rowNumber: 'asc' },
    });
    const committed = midRows.filter((r) => r.applyState === 'APPLIED');
    expect(committed).toHaveLength(2);
    expect(await h.prisma.attendanceRegularization.count()).toBe(2);
    // The rest were never attempted, so they are still PENDING -- resumable
    // rather than stranded.
    expect(midRows.filter((r) => r.applyState === 'PENDING')).toHaveLength(2);

    // Each committed row is complete: correction, link and revision together.
    for (const row of committed) {
      expect(row.regularizationId).toBeTruthy();
      const day = await h.prisma.dailyAttendance.findFirst({ where: { userId: row.userId! } });
      expect(day!.revision).toBe(2);
      expect(day!.lastRegularizationId).toBe(row.regularizationId);
    }

    // Resume the remainder.
    const longAgo = new Date(Date.now() - 30 * 60 * 1000);
    await h.prisma.attendanceImportBatch.update({
      where: { id: batch.id },
      data: {
        status: 'APPLYING',
        applyAttemptId: 'the-worker-is-gone',
        applyStartedAt: longAgo,
        applyHeartbeatAt: longAgo,
      },
    });

    const out = await h.apply.resume(seed.actors.hr, batch.id);

    // The two that had committed were never touched again.
    expect(await h.prisma.attendanceRegularization.count()).toBe(4);
    for (const row of committed) {
      const again = await h.prisma.attendanceImportRow.findUnique({ where: { id: row.id } });
      expect(again!.regularizationId).toBe(row.regularizationId);
      expect(again!.appliedAt?.toISOString()).toBe(row.appliedAt?.toISOString());
      const day = await h.prisma.dailyAttendance.findFirst({ where: { userId: row.userId! } });
      expect(day!.revision).toBe(2); // still 2, not 3
    }

    // And the batch ends up saying something true.
    const finalRows = await h.prisma.attendanceImportRow.findMany({ where: { batchId: batch.id } });
    expect(finalRows.filter((r) => r.applyState === 'APPLIED')).toHaveLength(4);
    expect(out.status).toBe('APPLIED');
    const saved = await batchRow(batch.id);
    expect(saved!.status).toBe('APPLIED');
  });
});
