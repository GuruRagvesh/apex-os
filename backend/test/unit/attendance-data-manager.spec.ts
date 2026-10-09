/**
 * Attendance Data Manager — Phase 2A.
 *
 *   T1/T2  CURRENT_CORRECTION and HISTORICAL_MIGRATION behave exactly as before
 *   T3/T4  RECOVERY_IMPORT cannot reach the correction apply path; it fails closed
 *   T5     recovery defaults OFF
 *   T6     Data Health never claims HEALTHY without evidence
 *   T7/T8  only company-wide attendance authority reaches Data Health
 *   T9     the health endpoint writes nothing
 *   T10    the recovery module registers no scheduled job
 */
import * as fs from 'fs';
import * as path from 'path';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { AttendanceImportApplyService } from '../../src/modules/platform/attendance/import/attendance-import-apply.service';
import { AttendanceImportController } from '../../src/modules/platform/attendance/import/attendance-import.controller';
import {
  assertCorrectionImportMode,
  correctionEntrySource,
  parseUploadMode,
  RECOVERY_IMPORT_APPLY_NOT_ENABLED,
  RECOVERY_IMPORT_UPLOAD_NOT_ENABLED,
} from '../../src/modules/platform/attendance/import/import-mode';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';
import { DataHealthService, DataManagerController } from '../../src/modules/platform/attendance/recovery/data-manager.controller';
import { RecoveryFlagsService, ATTENDANCE_RECOVERY_SETTING_KEY } from '../../src/modules/platform/attendance/recovery/recovery-flags';
import { computeDataHealth, evidenceProvesHealthy, HEALTH_STATUSES, NO_EVIDENCE } from '../../src/modules/platform/attendance/recovery/data-health';
import { readRecoveryConfig } from '../../src/modules/platform/attendance/recovery/recovery-flags';
import { AttendanceRecoveryVault } from '../../src/modules/platform/attendance/recovery/recovery-vault.service';

const codeOf = (e: any) => (e?.getResponse?.() as any)?.code;

// ════════════════════════════════════════════════════════════════════════════
describe('Import mode handling is exhaustive', () => {
  it('T1 CURRENT_CORRECTION is unchanged: accepted, writes BULK_IMPORT corrections', () => {
    expect(parseUploadMode('CURRENT_CORRECTION')).toBe('CURRENT_CORRECTION');
    expect(assertCorrectionImportMode('CURRENT_CORRECTION', 'apply')).toBe('CURRENT_CORRECTION');
    expect(correctionEntrySource('CURRENT_CORRECTION')).toBe('BULK_IMPORT');
  });

  it('T2 HISTORICAL_MIGRATION is unchanged: accepted, writes HISTORICAL_IMPORT corrections', () => {
    expect(parseUploadMode('HISTORICAL_MIGRATION')).toBe('HISTORICAL_MIGRATION');
    expect(assertCorrectionImportMode('HISTORICAL_MIGRATION', 'approve')).toBe('HISTORICAL_MIGRATION');
    expect(correctionEntrySource('HISTORICAL_MIGRATION')).toBe('HISTORICAL_IMPORT');
  });

  it('T4 RECOVERY_IMPORT fails closed with an explicit code — never a fall-through to BULK_IMPORT', () => {
    for (const action of ['approve', 'apply', 'resume', 're-preview'] as const) {
      try { assertCorrectionImportMode('RECOVERY_IMPORT', action); throw new Error('not refused'); } catch (e) {
        expect(e).toBeInstanceOf(ForbiddenException);
        expect(codeOf(e)).toBe(RECOVERY_IMPORT_APPLY_NOT_ENABLED);
      }
    }
    expect(() => correctionEntrySource('RECOVERY_IMPORT')).toThrow(ForbiddenException);
    expect(() => correctionEntrySource('SOMETHING_NEW')).toThrow(ForbiddenException);
  });

  it('T4 a recovery upload is refused before anything is archived; unknown modes keep the old error', async () => {
    const imports = { upload: jest.fn(), assertMayPrepare: jest.fn() };
    const controller = new AttendanceImportController(imports as any, {} as any);
    const file = { buffer: Buffer.from('x'), originalname: 'r.json' } as any;
    await expect(controller.upload({ id: 'hr' }, file, 'RECOVERY_IMPORT')).rejects.toMatchObject({ response: { code: RECOVERY_IMPORT_UPLOAD_NOT_ENABLED } });
    await expect(controller.upload({ id: 'hr' }, file, 'whatever')).rejects.toBeInstanceOf(BadRequestException);
    expect(imports.upload).not.toHaveBeenCalled();
    await controller.upload({ id: 'hr' }, file, 'CURRENT_CORRECTION');
    expect(imports.upload).toHaveBeenCalledWith({ id: 'hr' }, { buffer: file.buffer, fileName: 'r.json', mode: 'CURRENT_CORRECTION' });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('T3 RECOVERY_IMPORT cannot reach the correction apply path', () => {
  function rig(status: string) {
    const calls: string[] = [];
    const batch = { id: 'b1', reference: 'ATI-1', mode: 'RECOVERY_IMPORT', status, uploadedById: 'u-up', applyHeartbeatAt: null };
    const recorder = (model: string) => new Proxy({}, {
      get: (_t, op: string) => async () => {
        calls.push(`${model}.${op}`);
        if (model === 'attendanceImportBatch' && op === 'findUnique') return batch;
        return op === 'count' ? 0 : op === 'findMany' ? [] : null;
      },
    });
    const tx: any = new Proxy({}, {
      get: (_t, prop: string) => (prop === '$queryRaw' ? async () => { calls.push('$queryRaw'); return []; } : recorder(prop)),
    });
    const prisma: any = new Proxy({}, {
      get: (_t, prop: string) => (prop === '$transaction' ? async (fn: any) => fn(tx) : recorder(prop)),
    });
    const evaluator = { reviseForApprovedCorrection: jest.fn(), evaluateAndPersist: jest.fn(), finalize: jest.fn() };
    const logger = { log: jest.fn() };
    const service = new AttendanceImportApplyService(
      prisma, { now: () => new Date(), companyToday: () => '2026-10-09' } as any,
      { isHrOrAdmin: () => true } as any, logger as any, evaluator as any, { resolveForDate: jest.fn() } as any,
    );
    return { service, calls, evaluator, logger };
  }
  const HR = { id: 'hr-1', isHR: true, role: { name: 'EMPLOYEE' } };
  const WRITES = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)$/;

  it.each([
    ['approve', 'READY_FOR_REVIEW'],
    ['apply', 'APPROVED'],
    ['resume', 'APPLYING'],
    ['rePreview', 'REVIEW_REQUIRED'],
  ])('%s of a RECOVERY_IMPORT batch is refused before any write, evaluation or log', async (method, status) => {
    const { service, calls, evaluator, logger } = rig(status);
    await expect((service as any)[method](HR, 'b1')).rejects.toMatchObject({ response: { code: RECOVERY_IMPORT_APPLY_NOT_ENABLED } });
    expect(calls.filter((c) => WRITES.test(c))).toEqual([]);
    expect(evaluator.reviseForApprovedCorrection).not.toHaveBeenCalled();
    expect(logger.log).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Data Health', () => {
  const OFF = readRecoveryConfig(undefined).flags;
  const ON = readRecoveryConfig({ ATTENDANCE_RECOVERY_ENABLED: true, ATTENDANCE_RECOVERY_R2_ENABLED: true, ATTENDANCE_RECONCILIATION_ENABLED: true, ATTENDANCE_AUTO_REPAIR_ENABLED: true }).flags;
  const now = new Date('2026-10-09T06:00:00.000Z');

  const NOT_CONFIGURED = { status: 'NOT_CONFIGURED', credentialsPresent: false, reason: 'RECOVERY_VAULT_NOT_CONFIGURED' } as const;
  const HEALTHY_VAULT = { status: 'HEALTHY', credentialsPresent: true } as const;

  it('T5 with no setting stored, recovery and every component are DISABLED; counts are unknown, not zero', () => {
    const h = computeDataHealth({ flags: OFF, operationalAvailable: true, vault: NOT_CONFIGURED, failedImports: 0 }, now);
    expect(h).toMatchObject({
      overall: 'DISABLED',
      operationalAttendance: 'AVAILABLE',
      recovery: { enabled: false, status: 'DISABLED' },
      recoveryVault: { configured: false, status: 'NOT_CONFIGURED' },
      reconciliation: { enabled: false, status: 'DISABLED', lastRunAt: null },
      mirror: { enabled: false, status: 'DISABLED', lastWriteAt: null },
      autoRepair: { enabled: false, status: 'DISABLED' },
      existingDatabaseBackup: { status: 'UNCHANGED' },
      counts: { productionOnly: null, recoveryOnly: null, conflicts: null, missingReferences: null, failedImports: 0 },
    });
  });

  it('T6 HEALTHY is unreachable without every piece of evidence — even with every flag on and a healthy vault', () => {
    const noClient = computeDataHealth({ flags: ON, operationalAvailable: true, vault: NOT_CONFIGURED, failedImports: 0 }, now);
    expect(noClient.overall).toBe('NOT_CONFIGURED');
    const noEvidence = computeDataHealth({ flags: ON, operationalAvailable: true, vault: HEALTHY_VAULT, failedImports: 0 }, now);
    expect(noEvidence.overall).toBe('ATTENTION');
    expect(noEvidence.recoveryVault.status).toBe('HEALTHY');
    // Mirror, reconciliation and auto-repair do not exist yet: DISABLED whatever their flags say.
    expect([noEvidence.mirror.status, noEvidence.reconciliation.status, noEvidence.autoRepair.status]).toEqual(['DISABLED', 'DISABLED', 'DISABLED']);
    const degraded = computeDataHealth({ flags: ON, operationalAvailable: true, vault: { status: 'DEGRADED', credentialsPresent: true, reason: 'RECOVERY_VAULT_UNREACHABLE' }, failedImports: 0 }, now);
    expect([degraded.overall, degraded.recoveryVault.reason]).toEqual(['DEGRADED', 'RECOVERY_VAULT_UNREACHABLE']);
    const partial = { ...NO_EVIDENCE, vaultReachable: true, mirrorCurrent: true, lastReconciliationSucceeded: true, recoveryOnly: 0, conflicts: 0, missingReferences: 0 };
    expect(evidenceProvesHealthy(partial)).toBe(false); // failedSyncs unknown
    expect(evidenceProvesHealthy({ ...partial, failedSyncs: 0 })).toBe(true);
    expect(evidenceProvesHealthy({ ...partial, failedSyncs: 0, conflicts: 1 })).toBe(false);
    const json = JSON.stringify(noEvidence);
    expect(json).not.toMatch(/Fully Synced|SYNCED"/i);
    expect(HEALTH_STATUSES).toEqual(['NOT_CONFIGURED', 'DISABLED', 'HEALTHY', 'SYNCING', 'ATTENTION', 'DEGRADED', 'RECOVERY_REQUIRED']);
  });

  function healthRig() {
    const calls: string[] = [];
    const prisma: any = new Proxy({}, {
      get: (_t, model: string) => new Proxy({}, {
        get: (_m, op: string) => async () => {
          calls.push(`${model}.${op}`);
          if (model === 'appSetting') return null;
          return op === 'count' ? 2 : null;
        },
      }),
    });
    const settings = { get: jest.fn(async (key: string) => { calls.push(`settings.get:${key}`); return {}; }) };
    const flagsSvc = new RecoveryFlagsService(settings as any);
    // Credentials absent → the vault reports NOT_CONFIGURED without any network call.
    const vault = new AttendanceRecoveryVault(flagsSvc, {} as NodeJS.ProcessEnv, () => { throw new Error('no store expected'); });
    const svc = new DataHealthService(prisma, new AccessPolicyService(prisma), flagsSvc, { now: () => new Date('2026-10-09T06:00:00Z') } as any, vault);
    return { controller: new DataManagerController(svc), calls };
  }

  it.each([
    ['SUPER_ADMIN', { id: 'a', role: { name: 'SUPER_ADMIN' } }],
    ['ADMIN', { id: 'b', role: { name: 'ADMIN' } }],
    ['HR (company-wide)', { id: 'c', isHR: true, role: { name: 'EMPLOYEE' } }],
  ])('T7 %s may read Data Health', async (_label, actor) => {
    const { controller } = healthRig();
    await expect(controller.getHealth(actor)).resolves.toMatchObject({ overall: 'DISABLED', counts: { failedImports: 2 } });
  });

  it.each([
    ['EMPLOYEE', { id: 'e', role: { name: 'EMPLOYEE' } }],
    ['INTERN', { id: 'i', role: { name: 'INTERN' } }],
    ['TEAM_LEAD', { id: 't', role: { name: 'TEAM_LEAD' } }],
    ['MANAGER', { id: 'm', role: { name: 'MANAGER' } }],
    ['attendance data operator (not company-wide)', { id: 'o', isAttendanceDataOperator: true, role: { name: 'EMPLOYEE' } }],
    ['no user', undefined],
  ])('T8 %s is refused on the server', async (_label, actor) => {
    const { controller, calls } = healthRig();
    await expect(controller.getHealth(actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(calls).toEqual([]); // refused before any read
  });

  it('T9 the health endpoint only reads (setting, findFirst, count), never writes', async () => {
    const { controller, calls } = healthRig();
    await controller.getHealth({ id: 'a', role: { name: 'SUPER_ADMIN' } });
    expect(calls).toEqual([
      `settings.get:${ATTENDANCE_RECOVERY_SETTING_KEY}`,
      'dailyAttendance.findFirst',
      'attendanceImportBatch.count',
    ]);
  });

  it('T9 credentials are reported by presence only — values never appear in the response', async () => {
    const env = {
      APP_ENV: 'staging',
      ATTENDANCE_RECOVERY_R2_ACCOUNT_ID: 'secret-value-account',
      ATTENDANCE_RECOVERY_R2_ACCESS_KEY_ID: 'secret-value-key',
      ATTENDANCE_RECOVERY_R2_SECRET_ACCESS_KEY: 'secret-value-secret',
      ATTENDANCE_RECOVERY_R2_BUCKET: 'apex-os-attendance-recovery-staging',
    };
    const settings = { get: jest.fn(async () => ({})) };
    const flagsSvc = new RecoveryFlagsService(settings as any);
    const vault = new AttendanceRecoveryVault(flagsSvc, env as any, () => ({ head: jest.fn(), get: jest.fn(), list: jest.fn(), putIfAbsent: jest.fn() }) as any);
    const prisma: any = { dailyAttendance: { findFirst: async () => null }, attendanceImportBatch: { count: async () => 0 } };
    const svc = new DataHealthService(prisma, new AccessPolicyService(prisma), flagsSvc, { now: () => new Date() } as any, vault);
    const h = await svc.health({ id: 'a', role: { name: 'ADMIN' } });
    expect(h.recoveryVault).toMatchObject({ credentialsPresent: true, status: 'DISABLED' }); // flag off by default
    expect(JSON.stringify(h)).not.toMatch(/secret-value/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('T10 the recovery module schedules nothing', () => {
  const dir = path.join(__dirname, '../../src/modules/platform/attendance/recovery');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => ({ f, body: fs.readFileSync(path.join(dir, f), 'utf8') }));
  it('no @Cron/@Interval/@Timeout, no SchedulerRegistry, no timers', () => {
    const offenders = files.filter((x) => /@Cron\(|@Interval\(|@Timeout\(|SchedulerRegistry|setInterval\(|setTimeout\(/.test(x.body.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
    expect(offenders.map((x) => x.f)).toEqual([]);
  });
  it('the only HTTP route is GET /attendance/data-manager/health', () => {
    const routes = files.flatMap((x) => [...x.body.matchAll(/@(Get|Post|Put|Patch|Delete)\(([^)]*)\)/g)].map((m) => `${m[1]} ${m[2]}`));
    expect(routes).toEqual(["Get 'health'"]);
    expect(files.find((x) => x.f === 'data-manager.controller.ts')!.body).toMatch(/@Controller\('attendance\/data-manager'\)/);
  });
});
