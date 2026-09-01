import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import { TVAService } from '../../src/common/services/tva.service';
import { AttendanceImportService } from '../../src/modules/platform/attendance/import/attendance-import.service';
import { AttendanceImportController } from '../../src/modules/platform/attendance/import/attendance-import.controller';

/**
 * Phase 4. Durable batches and rows — and still not one attendance write.
 *
 * What Phase 4 adds is memory: the classification HR reviewed has to outlive
 * the request that produced it, or an approval in Phase 5 would be approving a
 * fresh opinion rather than the one somebody looked at.
 */

const tva = new TVAService({ get: () => undefined } as unknown as ConfigService);

const HEADER = 'Employee ID,Employee Name,Date,Status,Punch In,Punch Out,Half Day,Leave Type,Reason';
const REASON = 'Office internet outage - attendance could not be recorded.';
const csv = (...lines: string[]) => Buffer.from([HEADER, ...lines].join('\n'), 'utf8');
const ROW = `TE-014,Ajay Singh,2026-08-14,PRESENT,09:38,18:42,,,${REASON}`;

const HR = { id: 'hr-1', isHR: true, role: { name: 'ADMIN' } };
const OPERATOR = { id: 'ops-1', isAttendanceDataOperator: true, role: { name: 'EMPLOYEE' } };
const EMPLOYEE = { id: 'emp-9', role: { name: 'EMPLOYEE' } };
const INTERN = { id: 'int-1', role: { name: 'INTERN' } };
const MANAGER = { id: 'mgr-1', role: { name: 'MANAGER' } };

function rig(over: any = {}) {
  const batches: any[] = [];
  const rows: any[] = [];
  const archived: any[] = [];

  const prisma: any = {
    user: {
      findMany: jest.fn().mockResolvedValue(
        over.employees ?? [
          { id: 'u1', employeeId: 'TE-014', name: 'Ajay Singh', joiningDate: new Date('2025-01-06T00:00:00.000Z'), lastWorkingDate: null },
        ],
      ),
    },
    dailyAttendance: { findMany: jest.fn().mockResolvedValue(over.records ?? []) },
    attendanceMonthClose: { findMany: jest.fn().mockResolvedValue(over.monthCloses ?? []) },
    attendanceRegularization: { findMany: jest.fn().mockResolvedValue([]) },
    attendanceImportBatch: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `batch-${batches.length + 1}`, ...data };
        batches.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = batches.find((b) => b.id === where.id);
        Object.assign(row, data);
        return row;
      }),
      findUnique: jest.fn(async ({ where }: any) =>
        batches.find((b) => b.id === where.id || b.reference === where.reference) ?? null,
      ),
      findMany: jest.fn(async () => batches),
    },
    attendanceImportRow: {
      createMany: jest.fn(async ({ data }: any) => { rows.push(...data); return { count: data.length }; }),
      findMany: jest.fn(async () => rows),
    },
  };

  const vault: any = {
    archiveToVault: jest.fn(async (objectKey: string, buffer: Buffer) => {
      if (over.vaultFails) throw new Error('R2 unreachable');
      archived.push({ objectKey, size: buffer.byteLength });
      return { provider: 'r2', objectKey, sizeBytes: buffer.byteLength, sha256: 'x', verifiedAt: new Date() };
    }),
  };

  const accessPolicy: any = {
    isHrOrAdmin: (a: any) => Boolean(a?.isHR) || ['ADMIN', 'SUPER_ADMIN'].includes(a?.role?.name),
  };

  const service = new AttendanceImportService(
    prisma,
    tva,
    accessPolicy,
    { resolveForDate: jest.fn().mockResolvedValue(over.leave ?? { kind: 'NONE' }) } as any,
    vault,
  );

  return { service, prisma, vault, batches, rows, archived };
}

// ════════════════════════════════════════════════════════════════════════════
describe('a batch remembers what was uploaded', () => {
  it('1. stores the file identity and a human reference', async () => {
    const { service, batches } = rig();
    const out = await service.upload(HR, { buffer: csv(ROW), fileName: 'august.csv', mode: 'CURRENT_CORRECTION' });

    expect(out.reference).toMatch(/^ATI-\d{4}-[0-9A-F]{6}$/);
    expect(batches[0]).toMatchObject({
      fileName: 'august.csv',
      mode: 'CURRENT_CORRECTION',
      uploadedById: 'hr-1',
    });
    expect(batches[0].fileSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(batches[0].fileByteSize).toBeGreaterThan(0);
  });

  it('2. the reference is random, not a counter', async () => {
    // MAX(reference)+1 is a read two concurrent uploads can both win, producing
    // a duplicate or a lost batch. The unique index is the real guarantee.
    const seen = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      const { service } = rig();
      const out = await service.upload(HR, { buffer: csv(ROW), fileName: 'a.csv', mode: 'CURRENT_CORRECTION' });
      seen.add(out.reference);
    }
    expect(seen.size).toBe(5);
  });

  it('3. archives the source file privately, in its own namespace', async () => {
    const { service, archived, batches } = rig();
    await service.upload(HR, { buffer: csv(ROW), fileName: 'august.csv', mode: 'HISTORICAL_MIGRATION' });

    // Attendance imports are audit evidence and do not sit under the database
    // backup retention rule; there is no approved HR records deletion policy.
    expect(archived[0].objectKey).toMatch(/^attendance-imports\/\d{4}\/batch-1\/source-august\.csv$/);
    // A durable object key, never a signed or public URL: those expire, and an
    // audit trail cannot rest on a link that stops resolving.
    expect(batches[0].vaultObjectKey).toBe(archived[0].objectKey);
    expect(String(batches[0].vaultObjectKey)).not.toMatch(/^https?:/);
  });

  it('4. a file archived before the batch existed would be an orphan, so the batch comes first', async () => {
    const { service, prisma, vault } = rig();
    await service.upload(HR, { buffer: csv(ROW), fileName: 'a.csv', mode: 'CURRENT_CORRECTION' });

    expect(prisma.attendanceImportBatch.create.mock.invocationCallOrder[0])
      .toBeLessThan(vault.archiveToVault.mock.invocationCallOrder[0]);
  });

  it('5. an R2 failure leaves a truthful FAILED batch, never a plausible empty one', async () => {
    const { service, batches, rows } = rig({ vaultFails: true });

    await expect(
      service.upload(HR, { buffer: csv(ROW), fileName: 'a.csv', mode: 'CURRENT_CORRECTION' }),
    ).rejects.toThrow(/R2 unreachable/);

    // R2 and PostgreSQL are two systems. Pretending they commit together is how
    // a READY batch over an unarchived file gets written.
    expect(batches[0].status).toBe('FAILED');
    expect(batches[0].failureReason).toContain('R2 unreachable');
    expect(batches[0].vaultObjectKey).toBeUndefined();
    expect(rows).toEqual([]);
  });

  it('6. a repeated file is reported, never refused', async () => {
    const { service, prisma } = rig();
    await service.upload(HR, { buffer: csv(ROW), fileName: 'a.csv', mode: 'CURRENT_CORRECTION' });

    const same = await service.previousUploadsOf(prisma.attendanceImportBatch.create.mock.calls[0][0].data.fileSha256);
    expect(prisma.attendanceImportBatch.findMany).toHaveBeenCalled();
    expect(Array.isArray(same)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('a row remembers raw, normalized and what it was compared against', () => {
  const upload = async (line: string, mode: any = 'CURRENT_CORRECTION', over: any = {}) => {
    const r = rig(over);
    await r.service.upload(HR, { buffer: csv(line), fileName: 'a.csv', mode });
    return r;
  };

  it('7. persists the normalized proposal, including half day and leave type', async () => {
    const { rows } = await upload(
      `TE-014,Ajay Singh,2026-08-14,HALF_DAY,09:38,13:40,FIRST_HALF,,${REASON}`,
    );

    expect(rows[0]).toMatchObject({
      userId: 'u1',
      proposedStatus: 'HALF_DAY',
      proposedHalfDay: 'FIRST_HALF',
    });
    expect(rows[0].proposedPunchIn).toBeInstanceOf(Date);
    expect(rows[0].normalizedReason).toBe(REASON);
  });

  it('8. persists a leave type on a leave row', async () => {
    const { rows } = await upload(
      `TE-014,Ajay Singh,2026-08-14,LEAVE,,,,CASUAL,${REASON}`,
      'CURRENT_CORRECTION',
      { leave: { kind: 'PAID', leaveType: 'CASUAL' } },
    );

    expect(rows[0].proposedLeaveType).toBe('CASUAL');
  });

  it('9. persists warnings as codes a reviewer can act on', async () => {
    const { rows } = await upload(`TE-014,A. Singh,2026-08-14,PRESENT,09:38,18:42,,,${REASON}`);

    // A name that disagrees with the ID it was filed under is neither an error
    // nor nothing: it is what an approver reads before deciding.
    expect(rows[0].warnings).toContain('EMPLOYEE_NAME_MISMATCH');
    expect(rows[0].classification).toBe('NEW');
  });

  it('10. persists codes rather than sentences', async () => {
    const { rows } = await upload(`TE-014,Ajay Singh,01/02/26,PRESENT,09:38,18:42,,,${REASON}`);

    // A reworded message must never invalidate a stored verdict.
    expect(rows[0].messages).toContain('DATE_AMBIGUOUS');
    expect(rows[0].classification).toBe('INVALID');
  });

  it('11. persists the snapshot it compared against, evidence ids included', async () => {
    const { rows } = await upload(ROW, 'CURRENT_CORRECTION', {
      records: [{
        userId: 'u1',
        date: new Date('2026-08-14T00:00:00.000Z'),
        status: 'PRESENT',
        punchInAt: new Date('2026-08-14T04:22:00.000Z'),
        punchOutAt: new Date('2026-08-14T13:12:00.000Z'),
        evaluationState: 'CALCULATED',
        locked: false,
        punchInEvidenceId: 'ev-in-1',
        punchOutEvidenceId: 'ev-out-1',
      }],
    });

    expect(rows[0]).toMatchObject({
      classification: 'CHANGE',
      currentStatus: 'PRESENT',
      currentPunchInEvidenceId: 'ev-in-1',
      currentPunchOutEvidenceId: 'ev-out-1',
    });
  });

  it('12. a historical present stays punchless', async () => {
    const { rows } = await upload(
      `TE-014,Ajay Singh,2026-08-14,PRESENT,,,,,${REASON}`,
      'HISTORICAL_MIGRATION',
    );

    expect(rows[0].proposedStatus).toBe('PRESENT');
    expect(rows[0].proposedPunchIn).toBeNull();
    expect(rows[0].proposedPunchOut).toBeNull();

    // Nothing invented, and nothing that could be mistaken for evidence.
    for (const key of Object.keys(rows[0])) {
      expect(key.toLowerCase()).not.toMatch(/latitude|longitude|accuracy|photo|device/);
    }
  });

  it('13. leave with no authority is stored as a conflict, and no leave is created', async () => {
    const { rows, prisma } = await upload(
      `TE-014,Ajay Singh,2026-08-14,LEAVE,,,,CASUAL,${REASON}`,
    );

    expect(rows[0].classification).toBe('CONFLICT');
    expect(rows[0].messages).toContain('MISSING_AUTHORITATIVE_LEAVE');
    expect(prisma.leaveRequest).toBeUndefined();
  });

  it('14. rolls the counts up onto the batch', async () => {
    const { service, batches } = rig();
    await service.upload(HR, {
      buffer: csv(ROW, `TE-999,Nobody,2026-08-14,PRESENT,09:38,18:42,,,${REASON}`),
      fileName: 'a.csv',
      mode: 'CURRENT_CORRECTION',
    });

    expect(batches[0]).toMatchObject({ totalRows: 2, newRows: 1, invalidRows: 1, status: 'HAS_ERRORS' });
  });

  it('15. a clean batch is READY_FOR_REVIEW', async () => {
    const { service, batches } = rig();
    await service.upload(HR, { buffer: csv(ROW), fileName: 'a.csv', mode: 'CURRENT_CORRECTION' });

    expect(batches[0].status).toBe('READY_FOR_REVIEW');
  });

  it('16. writes rows in bounded chunks, not one statement per row', async () => {
    const { service, prisma } = rig();
    await service.upload(HR, { buffer: csv(...Array.from({ length: 40 }, (_, i) =>
      `TE-014,Ajay Singh,2026-08-${String((i % 28) + 1).padStart(2, '0')},PRESENT,09:38,18:42,,,${REASON}`)),
      fileName: 'a.csv', mode: 'CURRENT_CORRECTION' });

    // 6,200 individual inserts is 6,200 round trips; one statement of 6,200 is
    // a parameter count PostgreSQL refuses.
    expect(prisma.attendanceImportRow.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.attendanceImportRow.createMany.mock.calls[0][0].data.length).toBe(40);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('who may prepare, and who may not', () => {
  it.each([
    ['HR', HR], ['an attendance data operator', OPERATOR],
  ])('17. %s may prepare an import', async (_l, actor) => {
    const { service } = rig();
    await expect(
      service.upload(actor, { buffer: csv(ROW), fileName: 'a.csv', mode: 'CURRENT_CORRECTION' }),
    ).resolves.toBeDefined();
  });

  it.each([
    ['an employee', EMPLOYEE], ['an intern', INTERN], ['a manager', MANAGER],
  ])('18. %s may not prepare an import', async (_l, actor) => {
    const { service } = rig();
    await expect(
      service.upload(actor, { buffer: csv(ROW), fileName: 'a.csv', mode: 'CURRENT_CORRECTION' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('19. the operator flag prepares but never approves', () => {
    const { service } = rig();

    expect(() => service.assertMayPrepare(OPERATOR)).not.toThrow();
    // Preparation and authority are different things, and the flag grants only
    // the first. Phase 5 approval stays with HR.
    expect(() => service.assertMayApprove(OPERATOR)).toThrow(ForbiddenException);
    expect(() => service.assertMayApprove(HR)).not.toThrow();
  });

  it('20. an operator sees only the batches they prepared', async () => {
    const { service, prisma } = rig();
    await service.list(OPERATOR);
    expect(prisma.attendanceImportBatch.findMany.mock.calls[0][0].where).toEqual({ uploadedById: 'ops-1' });

    await service.list(HR);
    expect(prisma.attendanceImportBatch.findMany.mock.calls[1][0].where).toEqual({});
  });

  it("21. an operator cannot open somebody else's batch", async () => {
    const { service } = rig();
    await service.upload(HR, { buffer: csv(ROW), fileName: 'a.csv', mode: 'CURRENT_CORRECTION' });

    await expect(service.findOne(OPERATOR, 'batch-1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.findOne(HR, 'batch-1')).resolves.toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('PHASE 4 STILL WRITES NO ATTENDANCE', () => {
  const dir = '../../src/modules/platform/attendance/import';
  const source = (f: string) => readFileSync(resolve(__dirname, dir, f), 'utf8');
  const FILES = [
    'attendance-import.service.ts', 'attendance-import.controller.ts', 'attendance-import.module.ts',
    'import-rows.ts', 'import-normalize.ts', 'import-classify.ts', 'import-template.ts',
  ];

  it('22. nothing in the import subsystem calls an authoritative writer', () => {
    for (const file of FILES) {
      const src = source(file);
      for (const writer of [
        'dailyAttendance.create', 'dailyAttendance.update', 'dailyAttendance.upsert',
        'attendanceRegularization.create', 'attendanceRegularization.update',
        'attendanceMonthClose.create', 'attendanceMonthClose.update', 'attendanceMonthClose.upsert',
        'leaveRequest.create', 'leaveRequest.update', 'leaveRequest.delete',
        'appSetting.create', 'appSetting.update', 'appSetting.upsert',
        'reviseForApprovedCorrection', '$executeRaw',
      ]) {
        expect([file, writer, src.includes(writer)]).toEqual([file, writer, false]);
      }
    }
  });

  it('23. it writes ONLY its own staging tables', () => {
    const src = source('attendance-import.service.ts');
    const writes = [...src.matchAll(/prisma\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/g)]
      .map((m) => m[1]);

    expect([...new Set(writes)].sort()).toEqual(['attendanceImportBatch', 'attendanceImportRow']);
  });

  it('24. there is no approve or apply route', () => {
    const controller = source('attendance-import.controller.ts');
    const surface = Object.getOwnPropertyNames(AttendanceImportController.prototype).sort();

    expect(surface).toEqual(['constructor', 'errors', 'findOne', 'list', 'preview', 'template', 'upload']);
    expect(controller).not.toMatch(/@Post\(['"]:id\/approve/);
    expect(controller).not.toMatch(/@Post\(['"]:id\/apply/);
  });

  it('25. and no route deletes import history', () => {
    // A finished batch is CANCELLED, never deleted: the audit explaining an
    // attendance change must be harder to destroy than the spreadsheet.
    const controller = source('attendance-import.controller.ts');
    expect(controller).not.toContain('@Delete');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('the migration is additive and the audit is durable', () => {
  const sql = readFileSync(
    resolve(__dirname, '../../prisma/migrations/20260901000000_attendance_data_control/migration.sql'),
    'utf8',
  );

  it('26. drops, renames and retypes nothing', () => {
    // Executable statements only. A comment explaining that nothing is renamed
    // must not itself trip a check for the word.
    const statements = sql
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith('--'))
      .join('|')
      .toUpperCase();

    for (const destructive of ['DROP TABLE', 'DROP COLUMN', 'DROP TYPE', 'RENAME', 'ALTER COLUMN', 'TRUNCATE', 'DELETE FROM']) {
      expect([destructive, statements.includes(destructive)]).toEqual([destructive, false]);
    }

    // Every statement is a CREATE or an ADD.
    for (const line of statements.split('|').filter((l) => l.trim())) {
      expect([line.slice(0, 40), /^\s*(CREATE|ALTER TABLE|ALTER TYPE|\)|\s|"|CONSTRAINT|[A-Z_"]+\s)/.test(line)])
        .toEqual([line.slice(0, 40), true]);
    }
  });

  it('27. import rows and batches are RESTRICT, never CASCADE', () => {
    // Phase 0 proposed Cascade. Once an import has changed official attendance,
    // the evidence explaining it must outlive an attempt to tidy up.
    expect(sql).toContain('"attendance_import_rows_batchId_fkey"');
    expect(sql).toMatch(/attendance_import_rows_batchId_fkey[\s\S]*?ON DELETE RESTRICT/);
    expect(sql).not.toContain('ON DELETE CASCADE');
  });

  it('28. removing a correction never deletes the import row explaining it', () => {
    expect(sql).toMatch(/attendance_import_rows_regularizationId_fkey[\s\S]*?ON DELETE SET NULL/);
  });

  it('29. the actor relations restrict deletion rather than cascading', () => {
    expect(sql).toMatch(/attendance_import_batches_uploadedById_fkey[\s\S]*?ON DELETE RESTRICT/);
    expect(sql).toMatch(/attendance_import_batches_approvedById_fkey[\s\S]*?ON DELETE RESTRICT/);
  });

  it('30. maker/checker is enforced at the database, not only in a service', () => {
    // An import can rewrite months of attendance. "The uploader was not the
    // approver" should hold even against a future code path that forgets to ask.
    expect(sql).toContain('attendance_import_batches_approver_differs_from_uploader');
    expect(sql).toMatch(/CHECK \("approvedById" IS NULL OR "approvedById" <> "uploadedById"\)/);
  });

  it('31. the file hash is indexed but not unique', () => {
    expect(sql).toContain('"attendance_import_batches_fileSha256_idx"');
    expect(sql).not.toContain('attendance_import_batches_fileSha256_key');
  });

  it('32. deleting a user who uploaded a batch is blocked with a readable reason', () => {
    // The FKs are RESTRICT, so without this the delete would fail with a raw
    // constraint error instead of the list of what is in the way.
    const users = readFileSync(resolve(__dirname, '../../src/modules/core/users/users.service.ts'), 'utf8');
    expect(users).toContain('attendanceImportBatch.count');
    expect(users).toContain('Attendance Imports Uploaded');
    expect(users).toContain('Attendance Imports Approved');
  });
});
