import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  CorrectionDecisionService,
  needsRefreshedApply,
} from '../../src/modules/platform/attendance/regularization/correction-decision.service';
import { RegularizationService } from '../../src/modules/platform/attendance/regularization/regularization.service';

describe('Phase 3 correction safeguards', () => {
  it('requires refreshed confirmation when attendance changed after approval', () => {
    expect(needsRefreshedApply('fingerprint-at-approval', 'current-fingerprint', undefined)).toBe(true);
    expect(needsRefreshedApply('fingerprint-at-approval', 'current-fingerprint', 'old-screen')).toBe(true);
    expect(needsRefreshedApply('fingerprint-at-approval', 'current-fingerprint', 'current-fingerprint')).toBe(false);
    expect(needsRefreshedApply('same', 'same', undefined)).toBe(false);
  });

  it('routes compatibility rejection through the generic v1 decision writer', async () => {
    const decisions = {
      enabled: jest.fn().mockResolvedValue(false),
      decideCompatibility: jest.fn().mockResolvedValue({ status: 'REJECTED', decisionProtocolVersion: 1 }),
    };
    const service = new RegularizationService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { get: jest.fn().mockResolvedValue({ regularizationEnabled: true }) } as any,
      {} as any,
      {} as any,
      decisions as any,
    );
    const result = await service.reject({ id: 'reviewer-1' }, 'correction-1', 'Evidence does not support the change');
    expect(result).toEqual({ status: 'REJECTED', decisionProtocolVersion: 1 });
    expect(decisions.decideCompatibility).toHaveBeenCalledWith('reviewer-1', 'correction-1', {
      decision: 'REJECT',
      reason: 'Evidence does not support the change',
    });
  });

  it('database guard exempts legacy rejected rows but refuses every new unversioned rejection', () => {
    const sql = readFileSync(resolve(__dirname, '../../prisma/migrations/20261021090200_phase3_correction_safeguards/migration.sql'), 'utf8');
    expect(sql).toContain(`TG_OP = 'INSERT'`);
    expect(sql).toContain(`OLD."status" IS DISTINCT FROM 'REJECTED'`);
    expect(sql).toContain(`NEW."decisionProtocolVersion" IS DISTINCT FROM 1`);
    expect(sql).toContain(`BEFORE INSERT OR UPDATE OR DELETE`);
  });

  it('rechecks a held approval under locks and clears its obsolete blocker when applied', async () => {
    const appliedAt = new Date('2026-10-21T10:00:00.000Z');
    const row = {
      id: 'correction-1',
      userId: 'employee-1',
      date: new Date('2026-10-20T00:00:00.000Z'),
      status: 'APPROVED',
      applicationStatus: 'REVIEW_REQUIRED',
      applicationFailureReason: 'DAY_FINALIZED',
      decisionFingerprint: 'fingerprint-current',
    };
    const official = {
      id: 'day-1',
      status: 'PRESENT',
      sourceFingerprint: 'fingerprint-current',
      locked: false,
      revision: 0,
      lastRegularizationId: null,
      evaluationState: 'CALCULATED',
      calculationReason: null,
    };
    const update = jest.fn().mockResolvedValue({ ...row, applicationStatus: 'APPLIED' });
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(1),
      attendanceRegularization: { findUnique: jest.fn().mockResolvedValue(row), update },
      dailyAttendance: { findUnique: jest.fn().mockResolvedValue(official) },
      attendanceMonthClose: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const prisma: any = { $transaction: jest.fn((fn: any) => fn(tx)) };
    const evaluator: any = { reviseForApprovedCorrection: jest.fn().mockResolvedValue({}) };
    const authority: any = {
      loadActor: jest.fn().mockResolvedValue({ id: 'hr-1', isActive: true, isHR: true }),
      canViewCompany: jest.fn().mockReturnValue(true),
    };
    const service = new CorrectionDecisionService(
      prisma,
      { companyBusinessDate: jest.fn().mockReturnValue('2026-10-20'), now: jest.fn().mockReturnValue(appliedAt) } as any,
      {} as any,
      {} as any,
      evaluator,
      authority,
    );

    await expect(service.applyHeld('hr-1', row.id)).resolves.toMatchObject({ applicationStatus: 'APPLIED' });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: row.id },
      data: {
        applicationStatus: 'APPLIED',
        applicationFailureReason: null,
        appliedAt,
      },
    });
    expect(evaluator.reviseForApprovedCorrection).toHaveBeenCalledWith(tx, row.userId, '2026-10-20', row.id);
  });
});
