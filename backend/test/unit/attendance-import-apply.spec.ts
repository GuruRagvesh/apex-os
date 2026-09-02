import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { TVAService } from '../../src/common/services/tva.service';
import {
  AttendanceImportApplyService,
  batchOutcome,
} from '../../src/modules/platform/attendance/import/attendance-import-apply.service';
import { AttendanceImportController } from '../../src/modules/platform/attendance/import/attendance-import.controller';

/**
 * Phase 5. Approval, then apply.
 *
 * The rule this suite exists to hold: a persisted preview is a record of what
 * somebody was shown, not permission to write. Every applicable row is
 * re-checked against authoritative state at the moment of applying, and a row
 * whose world moved is skipped rather than forced.
 */

const tva = new TVAService({ get: () => undefined } as unknown as ConfigService);

const HR = { id: 'hr-1', isHR: true, role: { name: 'ADMIN' } };
const HR2 = { id: 'hr-2', isHR: true, role: { name: 'ADMIN' } };
const SUPER = { id: 'sa-1', role: { name: 'SUPER_ADMIN' } };
const OPERATOR = { id: 'ops-1', isAttendanceDataOperator: true, role: { name: 'EMPLOYEE' } };
const MANAGER = { id: 'mgr-1', role: { name: 'MANAGER' } };
const EMPLOYEE = { id: 'emp-9', role: { name: 'EMPLOYEE' } };
const INTERN = { id: 'int-1', role: { name: 'INTERN' } };

const DATE = new Date('2026-08-14T00:00:00.000Z');

const importRow = (over: any = {}) => ({
  id: 'row-1',
  batchId: 'batch-1',
  rowNumber: 2,
  userId: 'u1',
  businessDate: DATE,
  classification: 'NEW',
  applyState: 'PENDING',
  proposedStatus: 'PRESENT',
  proposedPunchIn: new Date('2026-08-14T04:08:00.000Z'),
  proposedPunchOut: new Date('2026-08-14T13:12:00.000Z'),
  normalizedReason: 'Office internet outage - attendance could not be recorded.',
  currentFingerprint: null,
  ...over,
});

function rig(over: any = {}) {
  const batch = {
    id: 'batch-1',
    reference: 'ATI-2026-ABC123',
    mode: over.mode ?? 'CURRENT_CORRECTION',
    status: over.status ?? 'READY_FOR_REVIEW',
    uploadedById: over.uploadedById ?? 'ops-1',
    approvedById: over.approvedById ?? null,
    ...over.batch,
  };

  const rows: any[] = over.rows ?? [importRow()];
  const created: any[] = [];
  const revised: any[] = [];
  const rowUpdates: any[] = [];
  const locks: any[] = [];

  const client: any = {
    $queryRaw: jest.fn((...args: any[]) => { locks.push(args); return Promise.resolve([]); }),
    attendanceImportBatch: {
      findUnique: jest.fn(async () => {
        // Simulates another worker claiming the batch mid-run.
        if (over.stealAfterRows !== undefined && created.length >= over.stealAfterRows) {
          return { ...batch, applyAttemptId: 'someone-elses-attempt' };
        }
        return batch;
      }),
      update: jest.fn(async ({ data }: any) => { Object.assign(batch, data); return { ...batch }; }),
      // Scoped to the attempt id, exactly as the heartbeat is: a mock that
      // ignored the where clause would let a zombie worker refresh somebody
      // else's lease and still pass.
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (where.applyAttemptId && where.applyAttemptId !== batch.applyAttemptId) return { count: 0 };
        Object.assign(batch, data);
        return { count: 1 };
      }),
    },
    attendanceImportRow: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        const states: string[] | undefined = where?.applyState?.in;
        const hit = rows.filter((r) => !states || states.includes(r.applyState));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      }),
      // Counts read from the ACTUAL rows unless a test deliberately overrides
      // one. A mock that always returned the override would let a re-preview
      // reclassify a row to CONFLICT and still report the batch approvable --
      // the test would be measuring the double, not the code.
      count: jest.fn(async ({ where }: any) => {
        if (where.userId) {
          return rows.filter(
            (r) => r.userId === where.userId && ['NEW', 'CHANGE'].includes(r.classification),
          ).length;
        }
        const cls = where.classification;
        const override = {
          INVALID: over.invalidRows,
          CONFLICT: over.conflictRows,
          MATCH: over.matchRows,
        }[cls as string];
        if (override !== undefined) return override;
        if (cls?.in) return rows.filter((r) => cls.in.includes(r.classification)).length;
        if (cls) return rows.filter((r) => r.classification === cls).length;
        return rows.length;
      }),
      // The where clause is HONOURED here on purpose. A mock that filters by
      // its own rules regardless of what it was asked would let the query drop
      // its applyState or classification filter and still pass -- the test
      // would be testing the double, not the code.
      findMany: jest.fn(async ({ where }: any) => {
        const classes: string[] | undefined = where?.classification?.in;
        const states: string[] | undefined = where?.applyState?.in;
        const state: string | undefined =
          typeof where?.applyState === 'string' ? where.applyState : undefined;
        return rows.filter(
          (r) =>
            (!classes || classes.includes(r.classification)) &&
            (!states || states.includes(r.applyState)) &&
            (state === undefined || r.applyState === state),
        );
      }),
      update: jest.fn(async ({ where, data }: any) => {
        rowUpdates.push({ id: where.id, ...data });
        const row = rows.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      }),
    },
    dailyAttendance: {
      findUnique: jest.fn(async () => over.current ?? null),
      // Re-preview reads current truth in bulk through the Phase 3 classifier.
      findMany: jest.fn(async () => over.currentRecords ?? []),
    },
    attendanceMonthClose: {
      findUnique: jest.fn(async () => (over.monthStatus ? { status: over.monthStatus } : null)),
      findMany: jest.fn(async () =>
        over.monthStatus ? [{ month: '2026-08', status: over.monthStatus }] : [],
      ),
    },
    attendanceRegularization: {
      findFirst: jest.fn(async () => over.openCorrection ?? null),
      findMany: jest.fn(async () => over.openCorrections ?? []),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `reg-${created.length + 1}`, ...data };
        created.push(row);
        return row;
      }),
    },
  };

  const prisma: any = { ...client, $transaction: jest.fn((fn: any) => fn(client)) };

  const evaluator: any = {
    reviseForApprovedCorrection: jest.fn(async (_tx, userId, businessDate, regId, opts) => {
      if (over.reviseThrows) throw over.reviseThrows;
      revised.push({ userId, businessDate, regId, opts });
      return { before: null, after: { id: 'da-1', status: 'PRESENT', revision: 1 } };
    }),
  };

  // A clock that can be made to advance, so a time-gated heartbeat can be
  // observed without waiting twenty real seconds. Only now() moves; every
  // date-arithmetic helper is the real one.
  let tick = 0;
  const clock: any = over.clockStep
    ? Object.assign(Object.create(Object.getPrototypeOf(tva)), tva, {
        now: () => new Date(Date.now() + (tick++) * over.clockStep),
      })
    : tva;

  const service = new AttendanceImportApplyService(
    prisma,
    clock,
    { isHrOrAdmin: (a: any) => Boolean(a?.isHR) || ['ADMIN', 'SUPER_ADMIN'].includes(a?.role?.name) } as any,
    { log: jest.fn().mockResolvedValue(undefined) } as any,
    evaluator,
    { resolveForDate: jest.fn().mockResolvedValue(over.leave ?? { kind: 'PAID' }) } as any,
  );

  return { service, prisma, client, batch, rows, created, revised, rowUpdates, locks, evaluator };
}

// ════════════════════════════════════════════════════════════════════════════
describe('approval records a decision and writes no attendance', () => {
  it('1. HR, Admin and Super Admin may approve', async () => {
    for (const actor of [HR, SUPER]) {
      const { service } = rig();
      await expect(service.approve(actor, 'batch-1')).resolves.toBeDefined();
    }
  });

  it.each([
    ['an operator', OPERATOR], ['a manager', MANAGER],
    ['an employee', EMPLOYEE], ['an intern', INTERN],
  ])('2. %s may not approve', async (_l, actor) => {
    const { service } = rig();
    await expect(service.approve(actor, 'batch-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('3. the uploader may not approve their own batch', async () => {
    // Maker/checker. Also a database CHECK constraint, so it holds against a
    // code path that forgets to ask.
    const { service } = rig({ uploadedById: 'hr-1' });
    await expect(service.approve(HR, 'batch-1')).rejects.toThrow(/somebody other than the person who uploaded/i);
  });

  it('4. an approver may not approve a batch that changes their own attendance', async () => {
    // Signing off a change to your own record is the one review that reviews
    // nothing. The batch is refused rather than the row quietly dropped.
    const { service } = rig({ rows: [importRow({ userId: 'hr-1' })] });
    await expect(service.approve(HR, 'batch-1')).rejects.toThrow(/your own attendance/i);
  });

  it('5. a batch with known problems cannot be approved', async () => {
    for (const over of [{ invalidRows: 3 }, { conflictRows: 2 }]) {
      const { service } = rig(over);
      await expect(service.approve(HR, 'batch-1')).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('6. approvability is recomputed from the rows, not trusted', async () => {
    const { service, client } = rig();
    await service.approve(HR, 'batch-1');

    // A client-supplied approvable=true must never be the reason anything is
    // written.
    expect(client.attendanceImportRow.count).toHaveBeenCalled();
  });

  it.each(['APPROVED', 'APPLYING', 'APPLIED', 'FAILED', 'CANCELLED', 'HAS_ERRORS'])(
    '7. a batch in %s cannot be approved', async (status) => {
      const { service } = rig({ status });
      await expect(service.approve(HR, 'batch-1')).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  it('8. approval creates no correction and revises no attendance', async () => {
    const { service, created, revised, batch } = rig();
    await service.approve(HR, 'batch-1');

    expect(created).toEqual([]);
    expect(revised).toEqual([]);
    expect(batch).toMatchObject({ status: 'APPROVED', approvedById: 'hr-1' });
  });

  it('9. approval takes a row lock so two approvers cannot both proceed', async () => {
    const { service, client } = rig();
    await service.approve(HR, 'batch-1');

    expect(String(client.$queryRaw.mock.calls[0][0].join('?'))).toContain('FOR UPDATE');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('apply executes against the present, not the preview', () => {
  const approved = (over: any = {}) =>
    rig({ status: 'APPROVED', approvedById: 'hr-2', ...over });

  it('10. a clean row becomes a correction and an official revision', async () => {
    const { service, created, revised, rowUpdates, batch } = approved();
    const out = await service.apply(HR, 'batch-1');

    expect(out).toMatchObject({ status: 'APPLIED', attempted: 1, applied: 1, stale: 0, failed: 0 });
    expect(created).toHaveLength(1);
    expect(revised).toHaveLength(1);
    expect(batch.status).toBe('APPLIED');

    // The row link is written in the same transaction as the revision.
    expect(rowUpdates.at(-1)).toMatchObject({ applyState: 'APPLIED', regularizationId: 'reg-1' });
  });

  it('11. the correction records all three actors separately', async () => {
    const { service, created } = approved();
    await service.apply(SUPER, 'batch-1');

    // The uploader supplied the proposal, the approver sanctioned it, the
    // applier executed it. Blurring them would lose a responsibility.
    expect(created[0]).toMatchObject({
      createdById: 'ops-1',
      hrApproverId: 'hr-2',
      status: 'HR_APPROVED',
      entrySource: 'BULK_IMPORT',
    });
    // No invented manager stage.
    expect(created[0].managerApproverId).toBeUndefined();
  });

  it('12. a historical batch is marked as such, forever', async () => {
    const { service, created } = approved({ mode: 'HISTORICAL_MIGRATION' });
    await service.apply(HR, 'batch-1');

    expect(created[0].entrySource).toBe('HISTORICAL_IMPORT');
  });

  it('13. it revises through the ONE engine, as a bulk caller', async () => {
    const { service, revised } = approved();
    await service.apply(HR, 'batch-1');

    // BULK_IMPORT is what makes the settlement gate refuse a closed period.
    expect(revised[0].opts).toEqual({ authority: 'BULK_IMPORT' });
  });

  it('14. it takes the shared month lock before reading anything', async () => {
    const { service, client } = approved();
    await service.apply(HR, 'batch-1');

    const sql = client.$queryRaw.mock.calls.map((c: any[]) => String(c[0].join('?')));
    expect(sql.some((s) => s.includes('pg_advisory_xact_lock'))).toBe(true);
  });

  it('15. original punch values are preserved before being replaced', async () => {
    const { service, created } = approved({
      current: {
        id: 'da-1',
        punchInAt: new Date('2026-08-14T04:22:00.000Z'),
        punchOutAt: new Date('2026-08-14T13:30:00.000Z'),
        sourceFingerprint: null,
      },
    });
    await service.apply(HR, 'batch-1');

    expect(created[0].originalPunchIn).toEqual(new Date('2026-08-14T04:22:00.000Z'));
    expect(created[0].originalPunchOut).toEqual(new Date('2026-08-14T13:30:00.000Z'));
  });

  it.each([
    ['an operator', OPERATOR], ['a manager', MANAGER], ['an employee', EMPLOYEE], ['an intern', INTERN],
  ])('16. %s may not apply', async (_l, actor) => {
    const { service } = approved();
    await expect(service.apply(actor, 'batch-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('17. an unapproved batch cannot be applied', async () => {
    for (const status of ['READY_FOR_REVIEW', 'HAS_ERRORS', 'APPLYING', 'APPLIED', 'CANCELLED']) {
      const { service } = rig({ status });
      await expect(service.apply(HR, 'batch-1')).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('18. a second apply is refused deterministically, not run again', async () => {
    // What a double click and two open browsers both hit.
    const { service, created } = approved();
    await service.apply(HR, 'batch-1');

    await expect(service.apply(HR, 'batch-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(created).toHaveLength(1);
  });

  it('19. the apply actor is recorded, distinctly from the approver', async () => {
    const { service, batch } = approved();
    await service.apply(HR, 'batch-1');

    expect(batch.appliedById).toBe('hr-1');
    expect(batch.approvedById).toBe('hr-2');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('a row whose world moved is skipped, never forced', () => {
  const approved = (over: any = {}) => rig({ status: 'APPROVED', approvedById: 'hr-2', ...over });

  it('20. the attendance record changed since approval', async () => {
    const { service, created, revised, rowUpdates } = approved({
      rows: [importRow({ currentFingerprint: 'fp-at-preview' })],
      current: { id: 'da-1', sourceFingerprint: 'fp-changed-since' },
    });

    const out = await service.apply(HR, 'batch-1');

    expect(out).toMatchObject({ status: 'REVIEW_REQUIRED', applied: 0, stale: 1 });
    expect(created).toEqual([]);
    expect(revised).toEqual([]);
    expect(rowUpdates.at(-1)).toMatchObject({ applyState: 'SKIPPED_STALE' });
    expect(rowUpdates.at(-1).failureReason).toMatch(/changed after this import was approved/i);
  });

  it.each([['FINALIZED'], ['SENT']])('21. the month became %s after approval', async (status) => {
    const { service, created, rowUpdates } = approved({ monthStatus: status });
    const out = await service.apply(HR, 'batch-1');

    expect(out.stale).toBe(1);
    expect(created).toEqual([]);
    expect(rowUpdates.at(-1)).toMatchObject({ applyState: 'SKIPPED_STALE' });
  });

  it('22. the day became locked after approval', async () => {
    const { service, created } = approved({
      current: { id: 'da-1', locked: true, evaluationState: 'FINALIZED', sourceFingerprint: null },
    });
    const out = await service.apply(HR, 'batch-1');

    expect(out.stale).toBe(1);
    expect(created).toEqual([]);
  });

  it('23. a correction was raised after approval', async () => {
    const { service, created, rowUpdates } = approved({ openCorrection: { id: 'reg-open' } });
    const out = await service.apply(HR, 'batch-1');

    expect(out.stale).toBe(1);
    expect(created).toEqual([]);
    expect(rowUpdates.at(-1).failureReason).toMatch(/correction for this day was raised/i);
  });

  it('24. the leave behind a LEAVE row disappeared', async () => {
    // An import may never manufacture a leave day the leave module does not
    // support, and approval does not freeze that fact.
    const { service, created, rowUpdates } = approved({
      rows: [importRow({ proposedStatus: 'LEAVE', proposedPunchIn: null, proposedPunchOut: null })],
      leave: { kind: 'NONE' },
    });
    const out = await service.apply(HR, 'batch-1');

    expect(out.stale).toBe(1);
    expect(created).toEqual([]);
    expect(rowUpdates.at(-1).failureReason).toMatch(/leave behind this row no longer exists/i);
  });

  it('25. a LEAVE row with live leave still applies', async () => {
    const { service, created } = approved({
      rows: [importRow({ proposedStatus: 'LEAVE', proposedPunchIn: null, proposedPunchOut: null })],
      leave: { kind: 'PAID' },
    });
    const out = await service.apply(HR, 'batch-1');

    expect(out.applied).toBe(1);
    expect(created[0].proposedStatus).toBe('LEAVE');
  });

  it('26. a genuine failure is FAILED, not stale — and wrote nothing', async () => {
    const { service, rowUpdates, revised } = approved({ reviseThrows: new Error('evaluator exploded') });
    const out = await service.apply(HR, 'batch-1');

    expect(out).toMatchObject({ failed: 1, stale: 0, applied: 0 });
    expect(rowUpdates.at(-1)).toMatchObject({ applyState: 'FAILED' });
    // The correction, revision and row link share one transaction, so a FAILED
    // row means no revision committed. That is what makes it safe to retry.
    expect(revised).toEqual([]);
  });

  it('27. some applied and some skipped is PARTIALLY_APPLIED', async () => {
    const { service, batch } = approved({
      rows: [importRow({ id: 'row-1' }), importRow({ id: 'row-2', userId: 'u2', currentFingerprint: 'moved' })],
      current: null,
    });
    // The second row expects a fingerprint the current record does not have.
    const out = await service.apply(HR, 'batch-1');

    expect(out.applied).toBe(1);
    expect(out.stale).toBe(1);
    expect(batch.status).toBe('PARTIALLY_APPLIED');
  });

  it('28. a wholly stale batch is REVIEW_REQUIRED, not FAILED', async () => {
    // The system worked exactly as designed and refused to write against an
    // approval that no longer describes reality. Calling that FAILED sends
    // somebody hunting a bug that is not there, and hides the one action that
    // resolves it.
    const { service, batch } = approved({ monthStatus: 'SENT' });
    const out = await service.apply(HR, 'batch-1');

    expect(out.applied).toBe(0);
    expect(out.stale).toBe(1);
    expect(batch.status).toBe('REVIEW_REQUIRED');
    expect(out.status).not.toBe('APPLIED');
    expect(out.status).not.toBe('FAILED');
  });

  it('29. an already-applied row is never applied twice', async () => {
    const { service, created } = approved({
      rows: [importRow({ applyState: 'APPLIED', regularizationId: 'reg-old' })],
    });
    const out = await service.apply(HR, 'batch-1');

    expect(out.attempted).toBe(0);
    expect(created).toEqual([]);
  });

  it('30. MATCH rows are never applied and never counted as revisions', async () => {
    // A real MATCH row has to be IN the set the query reads, or widening that
    // query to include MATCH would change nothing and this test would pass
    // while proving nothing.
    const match = importRow({ id: 'row-match', classification: 'MATCH' });
    const { service, created, revised, rows } = approved({
      rows: [match, importRow({ id: 'row-new' })],
      matchRows: 1,
    });

    const out = await service.apply(HR, 'batch-1');

    expect(out.attempted).toBe(1);
    expect(out.applied).toBe(1);
    expect(out.noOps).toBe(1);

    // Exactly one correction, for the NEW row. The MATCH row produced none.
    expect(created).toHaveLength(1);
    expect(revised).toHaveLength(1);

    // And it stays PENDING: APPLIED would claim a revision that never happened.
    expect(rows.find((r: any) => r.id === 'row-match').applyState).toBe('PENDING');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('nothing here writes attendance directly', () => {
  const src = readFileSync(
    resolve(__dirname, '../../src/modules/platform/attendance/import/attendance-import-apply.service.ts'),
    'utf8',
  );

  it('31. no DailyAttendance writer and no Finance side effect', () => {
    for (const forbidden of [
      'dailyAttendance.create', 'dailyAttendance.update', 'dailyAttendance.upsert',
      'attendanceMonthClose.update', 'attendanceMonthClose.upsert', 'attendanceMonthClose.create',
      'leaveRequest.create', 'leaveRequest.update',
      'appSetting.update', 'sendPayrollAttendanceReport', 'renderCanonical',
    ]) {
      expect([forbidden, src.includes(forbidden)]).toEqual([forbidden, false]);
    }
  });

  it('32. the revision goes through the single engine', () => {
    expect(src).toContain('reviseForApprovedCorrection');
    expect(src).toContain("authority: 'BULK_IMPORT'");
  });

  it('33. the month lock is the shared helper, not a reimplementation', () => {
    expect(src).toContain('lockAttendanceMonth');
    expect(src).not.toContain('pg_advisory');
  });

  it('34. the controller exposes approve and apply, and still deletes nothing', () => {
    const surface = Object.getOwnPropertyNames(AttendanceImportController.prototype).sort();
    expect(surface).toEqual([
      'applyBatch', 'approve', 'constructor', 'errors', 'findOne', 'list',
      'preview', 'rePreview', 'resume', 'template', 'upload',
    ]);

    const controller = readFileSync(
      resolve(__dirname, '../../src/modules/platform/attendance/import/attendance-import.controller.ts'),
      'utf8',
    );
    expect(controller).not.toContain('@Delete');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('what a finished batch is called', () => {
  const outcome = (over: any) =>
    batchOutcome({ totalRows: 4, invalid: 0, conflict: 0, actionable: 4, applied: 0, stale: 0, failed: 0, ...over });

  it('35. the outcome rules, stated as a table', () => {
    // Row APPLIED and batch APPLIED mean different things on purpose. A row is
    // APPLIED when it produced a revision; a batch is APPLIED when it was fully
    // processed with nothing left to do.
    expect(outcome({ totalRows: 4000, actionable: 0 })).toBe('APPLIED');
    expect(outcome({ applied: 4 })).toBe('APPLIED');
    expect(outcome({ applied: 3, stale: 1 })).toBe('PARTIALLY_APPLIED');
    expect(outcome({ applied: 3, failed: 1 })).toBe('PARTIALLY_APPLIED');
    expect(outcome({ stale: 4 })).toBe('REVIEW_REQUIRED');
    expect(outcome({ failed: 4 })).toBe('FAILED');
    // A runtime failure alongside staleness is still something to investigate.
    expect(outcome({ stale: 3, failed: 1 })).toBe('FAILED');
  });

  it('35b. AN EMPTY BATCH CAN NEVER BE A SUCCESS', () => {
    // "Nothing to do" and "there was never anything here" produce the same
    // actionable count and mean opposite things. The helper takes totalRows so
    // the distinction is a rule rather than an assumption about the caller.
    expect(outcome({ totalRows: 0, actionable: 0 })).toBe('FAILED');
    expect(outcome({ totalRows: 0, actionable: 0, applied: 0, stale: 0, failed: 0 })).toBe('FAILED');
  });

  it('35c. a batch carrying known-bad rows can never be a success', () => {
    // Approval already refuses these; reaching the outcome helper with them
    // means something upstream let a known-bad batch through, and papering
    // over that would apply some rows while silently dropping others.
    expect(outcome({ invalid: 1, applied: 3 })).toBe('FAILED');
    expect(outcome({ conflict: 1, applied: 3 })).toBe('FAILED');
  });

  it('36. AN ALL-MATCH BATCH IS A SUCCESS', async () => {
    // The bug this phase existed to fix. Four thousand rows that all agree with
    // Apex OS is a completely successful reconciliation, and reporting it as
    // FAILED tells HR the opposite of what happened.
    const { service, batch, created, revised } = rig({
      status: 'APPROVED',
      approvedById: 'hr-2',
      rows: [
        importRow({ id: 'm1', classification: 'MATCH' }),
        importRow({ id: 'm2', classification: 'MATCH' }),
      ],
      matchRows: 2,
    });

    const out = await service.apply(HR, 'batch-1');

    expect(out).toMatchObject({
      status: 'APPLIED', attempted: 0, applied: 0, noOps: 2, stale: 0, failed: 0,
    });
    expect(batch.status).toBe('APPLIED');
    expect(created).toEqual([]);
    expect(revised).toEqual([]);
  });

  it('37. MATCH rows stay PENDING and are terminal no-ops', async () => {
    const { service, rows } = rig({
      status: 'APPROVED',
      approvedById: 'hr-2',
      rows: [importRow({ id: 'm1', classification: 'MATCH' })],
      matchRows: 1,
    });
    await service.apply(HR, 'batch-1');

    // classification=MATCH already makes this unambiguous; a NO_OP state would
    // add a value that says nothing the classification does not.
    expect(rows[0]).toMatchObject({ classification: 'MATCH', applyState: 'PENDING' });
  });

  it('38. a REVIEW_REQUIRED batch cannot be applied against the old approval', async () => {
    const { service } = rig({ status: 'REVIEW_REQUIRED', approvedById: 'hr-2' });

    await expect(service.apply(HR, 'batch-1')).rejects.toThrow(/Re-preview it and approve again/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('the apply lease', () => {
  it('39. a finished run releases its lease', async () => {
    const { service, batch } = rig({ status: 'APPROVED', approvedById: 'hr-2' });
    await service.apply(HR, 'batch-1');

    expect(batch.applyAttemptId).toBeNull();
    expect(batch.applyStartedAt).toBeInstanceOf(Date);
  });

  it('40. a live run refuses a second caller with a conflict', async () => {
    const { service } = rig({
      status: 'APPLYING',
      batch: { applyAttemptId: 'attempt-1', applyHeartbeatAt: new Date() },
    });

    await expect(service.apply(HR, 'batch-1')).rejects.toBeInstanceOf(ConflictException);
    await expect(service.resume(HR, 'batch-1')).rejects.toThrow(/still alive/i);
  });

  it('41. a stale lease permits an explicit resume — nothing resumes on a timer', async () => {
    const stale = new Date(Date.now() - 10 * 60 * 1000);
    const { service, client } = rig({
      status: 'APPLYING',
      approvedById: 'hr-2',
      batch: { applyAttemptId: 'dead-attempt', applyHeartbeatAt: stale },
      rows: [importRow()],
    });

    const out = await service.resume(HR, 'batch-1');

    expect(out.applied).toBe(1);

    // A NEW attempt is claimed, checked at the moment of CLAIMING rather than
    // afterwards: by the end of a run the lease has been released to null, and
    // null !== the dead id would pass whether or not a new one was ever issued.
    //
    // It matters because beat() is scoped by attempt id. Without a fresh one,
    // the dead worker that wakes up still holds the id that owns this batch and
    // could keep refreshing a lease somebody else now depends on.
    const claim = client.attendanceImportBatch.update.mock.calls
      .map((c: any[]) => c[0].data)
      .find((d: any) => d.applyHeartbeatAt && !('status' in d));

    expect(claim.applyAttemptId).toBeTruthy();
    expect(claim.applyAttemptId).not.toBe('dead-attempt');
  });

  it('42. a heartbeat only refreshes the attempt that owns the batch', async () => {
    // The clock is pushed past the interval so the time-gated heartbeat
    // actually fires; a one-row run finishes far too fast to reach it.
    const { service, client } = rig({
      status: 'APPROVED',
      approvedById: 'hr-2',
      clockStep: 30_000,
      rows: [importRow({ id: 'r1' }), importRow({ id: 'r2', userId: 'u2' })],
    });
    await service.apply(HR, 'batch-1');

    expect(client.attendanceImportBatch.updateMany).toHaveBeenCalled();
    const beat = client.attendanceImportBatch.updateMany.mock.calls[0][0];
    // Scoped, so a zombie worker cannot make a live run look dead -- or keep a
    // lease alive that somebody else now owns.
    expect(beat.where.applyAttemptId).toBeTruthy();
    expect(beat.data).toEqual({ applyHeartbeatAt: expect.any(Date) });
  });

  it('42b. losing the batch mid-run stops the worker rather than writing on', async () => {
    // Attempt A stalls, is replaced, then wakes. It must not go on revising
    // attendance: the right to write is re-proved inside the transaction that
    // would do the writing.
    const { service, created, batch } = rig({
      status: 'APPROVED',
      approvedById: 'hr-2',
      rows: [importRow({ id: 'r1' }), importRow({ id: 'r2', userId: 'u2' })],
      stealAfterRows: 1,
    });

    const out = await service.apply(HR, 'batch-1');

    expect(out.status).toBe('SUPERSEDED');
    // One row landed before the takeover; nothing after it.
    expect(created).toHaveLength(1);
    // The batch status belongs to whoever holds the current attempt now.
    expect(batch.status).toBe('APPLYING');
  });

  it('43. a batch that is not mid-apply cannot be resumed', async () => {
    for (const status of ['APPROVED', 'APPLIED', 'READY_FOR_REVIEW', 'REVIEW_REQUIRED']) {
      const { service } = rig({ status });
      await expect(service.resume(HR, 'batch-1')).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('44. resume never reconsiders rows that already landed', async () => {
    const stale = new Date(Date.now() - 10 * 60 * 1000);
    const { service, created } = rig({
      status: 'APPLYING',
      approvedById: 'hr-2',
      batch: { applyAttemptId: 'dead', applyHeartbeatAt: stale },
      rows: [
        importRow({ id: 'done', applyState: 'APPLIED', regularizationId: 'reg-old' }),
        importRow({ id: 'todo' }),
        importRow({ id: 'was-stale', applyState: 'SKIPPED_STALE' }),
      ],
    });

    const out = await service.resume(HR, 'batch-1');

    // Only the never-attempted row continues. APPLIED is history; SKIPPED_STALE
    // needs a fresh preview, not a retry against the same stale decision.
    expect(out.attempted).toBe(1);
    expect(created).toHaveLength(1);
  });

  it('45. resume is refused to everyone but HR authority', async () => {
    for (const actor of [OPERATOR, MANAGER, EMPLOYEE, INTERN]) {
      const { service } = rig({ status: 'APPLYING' });
      await expect(service.resume(actor, 'batch-1')).rejects.toBeInstanceOf(ForbiddenException);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('re-preview is the only way out of REVIEW_REQUIRED', () => {
  it('46. it clears the approval, because the comparison changed', async () => {
    const { service, batch } = rig({ status: 'REVIEW_REQUIRED', approvedById: 'hr-2' });
    await service.rePreview(HR, 'batch-1');

    expect(batch).toMatchObject({
      status: 'READY_FOR_REVIEW', approvedById: null, approvedAt: null,
    });
  });

  it('47. stale and failed rows return to PENDING; applied rows never do', async () => {
    const { service, rows } = rig({
      status: 'REVIEW_REQUIRED',
      rows: [
        importRow({ id: 'stale', applyState: 'SKIPPED_STALE' }),
        importRow({ id: 'failed', applyState: 'FAILED' }),
        importRow({ id: 'done', applyState: 'APPLIED' }),
      ],
    });
    await service.rePreview(HR, 'batch-1');

    expect(rows.find((r: any) => r.id === 'stale').applyState).toBe('PENDING');
    expect(rows.find((r: any) => r.id === 'failed').applyState).toBe('PENDING');
    expect(rows.find((r: any) => r.id === 'done').applyState).toBe('APPLIED');
  });

  it('48. a healthy batch does not need re-previewing', async () => {
    for (const status of ['READY_FOR_REVIEW', 'APPROVED', 'APPLIED']) {
      const { service } = rig({ status });
      await expect(service.rePreview(HR, 'batch-1')).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('49. after re-preview the batch must be approved again before it can apply', async () => {
    const { service, batch } = rig({ status: 'REVIEW_REQUIRED', approvedById: 'hr-2' });
    await service.rePreview(HR, 'batch-1');

    expect(batch.status).toBe('READY_FOR_REVIEW');
    await expect(service.apply(HR, 'batch-1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('re-preview compares against today, not against upload day', () => {
  const stale = (over: any = {}) =>
    rig({
      status: 'REVIEW_REQUIRED',
      approvedById: 'hr-2',
      rows: [
        importRow({
          id: 'stale',
          applyState: 'SKIPPED_STALE',
          classification: 'CHANGE',
          // What HR was shown at upload, and what must not survive a re-preview.
          currentStatus: 'MISSING_PUNCH',
          currentPunchIn: null,
          currentPunchOut: null,
          currentPunchInEvidenceId: null,
          currentPunchOutEvidenceId: null,
          currentFingerprint: 'fingerprint-at-upload',
        }),
      ],
      ...over,
    });

  const currentRecord = (over: any = {}) => ({
    userId: 'u1',
    date: DATE,
    status: 'PRESENT',
    punchInAt: new Date('2026-08-14T04:22:00.000Z'),
    punchOutAt: new Date('2026-08-14T13:30:00.000Z'),
    evaluationState: 'CALCULATED',
    locked: false,
    punchInEvidenceId: 'ev-in-now',
    punchOutEvidenceId: 'ev-out-now',
    sourceFingerprint: 'fingerprint-today',
    ...over,
  });

  it('50. every current-side field is refreshed from live truth', async () => {
    // The whole point. Resetting rows to PENDING and asking for a fresh
    // approval would put a new signature on an old comparison.
    const { service, rows } = stale({ currentRecords: [currentRecord()] });
    await service.rePreview(HR, 'batch-1');

    const row = rows[0];
    expect(row.currentFingerprint).toBe('fingerprint-today');
    expect(row.currentStatus).toBe('PRESENT');
    expect(row.currentPunchIn).toEqual(new Date('2026-08-14T04:22:00.000Z'));
    expect(row.currentPunchOut).toEqual(new Date('2026-08-14T13:30:00.000Z'));
    expect(row.currentPunchInEvidenceId).toBe('ev-in-now');
    expect(row.currentPunchOutEvidenceId).toBe('ev-out-now');
    expect(row.applyState).toBe('PENDING');
  });

  it('51. THE PROPOSAL IS FROZEN — only the current side moves', async () => {
    // The submitted claim is what somebody uploaded. A parser that behaves
    // differently today must never be able to change it, so re-preview reads
    // proposedStatus and never rawStatus.
    const { service, rows } = stale({
      rows: [
        importRow({
          id: 'stale',
          applyState: 'SKIPPED_STALE',
          classification: 'CHANGE',
          proposedStatus: 'PRESENT',
          // Deliberately disagrees with the frozen proposal. If re-preview
          // reached for the raw cell, the classification would follow it.
          rawStatus: 'ABSENT',
          currentFingerprint: 'old',
        }),
      ],
      currentRecords: [currentRecord({ status: 'ABSENT', punchInAt: null, punchOutAt: null })],
    });

    await service.rePreview(HR, 'batch-1');

    // PRESENT proposed against an ABSENT record is still a CHANGE. Had the raw
    // ABSENT been used, it would have come back MATCH and quietly disappeared.
    expect(rows[0].classification).toBe('CHANGE');
    expect(rows[0].proposedStatus).toBe('PRESENT');
  });

  it('52. a stale row that has become correct comes back as MATCH', async () => {
    // Somebody else corrected the day to the same value while the batch sat.
    // That is successful reconciliation, not work still to do.
    const { service, rows } = stale({
      currentRecords: [
        currentRecord({
          status: 'PRESENT',
          punchInAt: new Date('2026-08-14T04:08:00.000Z'),
          punchOutAt: new Date('2026-08-14T13:12:00.000Z'),
        }),
      ],
    });

    await service.rePreview(HR, 'batch-1');

    expect(rows[0].classification).toBe('MATCH');
  });

  it('53. a row that has become unsafe blocks approval rather than staying READY', async () => {
    const { service, batch, rows } = stale({
      currentRecords: [currentRecord()],
      monthStatus: 'SENT',
    });

    await service.rePreview(HR, 'batch-1');

    expect(rows[0].classification).toBe('CONFLICT');
    // Not READY_FOR_REVIEW: a batch carrying a conflict is not approvable, and
    // saying otherwise would invite an approval that apply must then refuse.
    expect(batch.status).toBe('HAS_ERRORS');
  });

  it('54. an open correction raised meanwhile is a conflict', async () => {
    const { service, rows } = stale({
      currentRecords: [currentRecord()],
      openCorrections: [{ userId: 'u1', date: DATE }],
    });

    await service.rePreview(HR, 'batch-1');
    expect(rows[0].classification).toBe('CONFLICT');
  });

  it('55. leave authority that has disappeared is a conflict', async () => {
    const { service, rows } = stale({
      rows: [
        importRow({
          id: 'stale',
          applyState: 'SKIPPED_STALE',
          classification: 'CHANGE',
          proposedStatus: 'LEAVE',
          proposedPunchIn: null,
          proposedPunchOut: null,
        }),
      ],
      currentRecords: [],
      leave: { kind: 'NONE' },
    });

    await service.rePreview(HR, 'batch-1');
    expect(rows[0].classification).toBe('CONFLICT');
  });
});

describe('a worker that loses the batch stops beating and stops working', () => {
  it('56. a heartbeat that updates nothing ends the run', async () => {
    // beat() reporting success unconditionally would let a superseded worker
    // carry on through the remaining rows.
    const { service, client } = rig({
      status: 'APPROVED',
      approvedById: 'hr-2',
      clockStep: 30_000,
      rows: [
        importRow({ id: 'r1' }),
        importRow({ id: 'r2', userId: 'u2' }),
        importRow({ id: 'r3', userId: 'u3' }),
      ],
    });

    // The attempt id moves on under us: every heartbeat now matches no rows.
    client.attendanceImportBatch.updateMany.mockResolvedValue({ count: 0 });

    const out = await service.apply(HR, 'batch-1');

    // It stopped rather than working through the rest of the batch.
    expect(out.applied).toBeLessThan(3);
  });
});
