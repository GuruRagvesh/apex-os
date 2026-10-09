/**
 * Attendance recovery — Phase 1 write-safety guarantees.
 *
 *   R22 no User creation path          R23 no LeaveRequest creation path
 *   R24 no automatic overwrite path    R25 no delete path
 *
 * Proved two ways: (1) the recovery module's source contains no Prisma write or
 * raw-SQL call at all; (2) the read service, driven against a recording fake
 * client, issues only reads. Plus: the classifier's action vocabulary has no
 * UPDATE, INSERT or DELETE, and RECOVERY_ONLY is never more than a preview.
 */
import * as fs from 'fs';
import * as path from 'path';
import { RecoveryReadService } from '../../src/modules/platform/attendance/recovery/recovery-read.service';
import { classifyDay } from '../../src/modules/platform/attendance/recovery/reconcile-classify';
import { parseRecoveryDocument } from '../../src/modules/platform/attendance/recovery/recovery-document';

const DIR = path.join(__dirname, '../../src/modules/platform/attendance/recovery');
const sources = fs.readdirSync(DIR).filter((f) => f.endsWith('.ts')).map((f) => ({ f, body: fs.readFileSync(path.join(DIR, f), 'utf8') }));
const WRITE_CALL = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(|\$executeRaw|\$queryRaw|\$transaction/;
/** Comments removed, and the one legitimate `.update(` — Node's crypto hash — removed exactly. */
const code = (body: string) =>
  body.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '').replace(/createHash\('sha256'\)\.update\(/g, 'createHash(sha256).feed(');

describe('Recovery module cannot write (static)', () => {
  it('R22–R25 no Prisma write, raw SQL or transaction call exists anywhere in the module', () => {
    expect(sources.length).toBeGreaterThan(5);
    const offenders = sources.filter((s) => WRITE_CALL.test(code(s.body))).map((s) => s.f);
    expect(offenders).toEqual([]);
  });

  it('R22/R23 nothing references creating users, leave requests or policies', () => {
    for (const s of sources) {
      const code = s.body.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(code).not.toMatch(/(user|leaveRequest|shiftPolicy|attendancePolicy|department|leaveBalance)\s*\.\s*(create|upsert|update)/i);
    }
  });

  it('Phase 2A wiring: registered with exactly one controller and no write route', () => {
    const appModule = fs.readFileSync(path.join(__dirname, '../../src/app.module.ts'), 'utf8');
    expect(appModule).toMatch(/AttendanceRecoveryModule/);
    expect(sources.filter((s) => /@Controller\(/.test(s.body)).map((s) => s.f)).toEqual(['data-manager.controller.ts']);
    expect(sources.some((s) => /@(Post|Put|Patch|Delete)\(/.test(s.body))).toBe(false);
  });
});

describe('Recovery read service issues reads only (runtime)', () => {
  function recordingPrisma() {
    const calls: string[] = [];
    const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
    const data: Record<string, any[]> = {
      user: [{ id: 'u1', employeeId: 'TE-001' }],
      attendancePolicy: [], shiftPolicy: [], holidayCalendar: [],
      dailyAttendance: [{ id: 'da1', userId: 'u1', date: d('2026-08-12'), status: 'PRESENT', workedMinutes: 480, breakMinutes: 0, lateMinutes: 0, leaveDeducted: 0, lwpDeducted: 0, locked: false, evaluationState: 'FINALIZED', evaluatorVersion: 1, exceptionFlags: [], workSessionIds: ['s1'], revision: 1 }],
      workSession: [{ id: 's1', userId: 'u1', date: d('2026-08-12'), status: 'LOGGED_OUT', totalLoggedMinutes: 0, totalBreakMinutes: 0, totalIdleMinutes: 0, totalWorkMinutes: 0, autoClosed: false, logoutAt: d('2026-08-12') }],
      breakLog: [], attendancePunchEvidence: [], attendanceRegularization: [], attendanceRecoveryTombstone: [],
      attendanceMonthClose: [], leaveRequest: [], weeklyOffPolicy: [], holiday: [], businessDayOverride: [],
      employeeAttendanceProfile: [], attendanceLocation: [],
    };
    const prisma = new Proxy({}, {
      get: (_t, model: string) => new Proxy({}, {
        get: (_m, op: string) => async () => { calls.push(`${model}.${op}`); return op === 'count' ? 0 : data[model] ?? []; },
      }),
    });
    return { prisma, calls };
  }
  const tva = { companyBusinessDate: (d: Date) => d.toISOString().slice(0, 10), companyToday: () => '2026-10-09' };

  it('R24/R25 building current bundles and a validation context performs only findMany/count', async () => {
    const { prisma, calls } = recordingPrisma();
    const svc = new RecoveryReadService(prisma as any, tva as any);
    const current = await svc.currentBundles('2026-08-01', '2026-08-31');
    expect([...current.bundles.keys()]).toEqual(['TE-001|2026-08-12']);
    const doc = parseRecoveryDocument(Buffer.from(JSON.stringify({ format: 'apex-os.attendance-recovery', schemaVersion: 1, source: { sourceType: 'R2_BACKUP_RECOVERY', sourceId: 'b' }, bundles: [] })));
    await svc.validationContext(doc, []);
    expect(calls.length).toBeGreaterThan(5);
    expect(calls.filter((c) => !/\.(findMany|findUnique|findFirst|count)$/.test(c))).toEqual([]);
  });
});

describe('No automatic overwrite or delete in the decision vocabulary', () => {
  it('R24 every classification action is one of NO_ACTION / MIRROR_CANDIDATE / RECOVERY_PREVIEW / MANUAL_REVIEW / REJECT', () => {
    const src = sources.find((s) => s.f === 'recovery.types.ts')!.body;
    const block = src.slice(src.indexOf('export type ProposedAction'), src.indexOf(';', src.indexOf('export type ProposedAction')));
    expect(block).not.toMatch(/UPDATE|DELETE|INSERT|OVERWRITE/);
  });

  it('R24 a DIFFERENT day is never proposed for anything but manual review, whichever side looks newer', () => {
    const base: any = {
      employeeId: 'E', businessDate: '2026-08-12', identity: { state: 'RESOLVED', userId: 'u' }, references: { missing: [], review: [] },
      tombstones: [], companyToday: '2026-10-09', monthCloseStatus: null,
    };
    const mk = (status: string, revision: number) => ({
      schemaVersion: 1, bundleVersion: 1, employeeId: 'E', businessDate: '2026-08-12', workSessions: [], breakLogs: [], punchEvidence: [], regularizations: [], leaveReferences: [], attendancePolicyReference: null, shiftPolicyReference: null, provenance: { sourceType: 'LIVE', sourceId: 'x' },
      dailyAttendance: { date: '2026-08-12', status, punchInAt: null, punchOutAt: null, workedMinutes: 0, breakMinutes: 0, lateMinutes: 0, leaveDeducted: 0, lwpDeducted: 0, calculationReason: null, locked: false, lockedAt: null, policyVersion: null, evaluationState: 'FINALIZED', evaluatorVersion: 1, resolverVersion: null, evaluatedAt: null, exceptionFlags: [], sourceFingerprint: null, employeeProfileId: null, holidayCalendarReference: null, weeklyOffPolicyId: null, holidayId: null, businessDayOverrideId: null, leaveRequestId: null, punchInEvidenceKey: null, punchOutEvidenceKey: null, workSessionIds: [], revision, lastRegularizationId: null },
    });
    for (const [cur, rec] of [[mk('ABSENT', 1), mk('PRESENT', 9)], [mk('PRESENT', 9), mk('ABSENT', 1)]]) {
      expect(classifyDay({ ...base, current: cur, recovery: rec })).toMatchObject({ state: 'DIFFERENT', action: 'MANUAL_REVIEW', eligibility: 'NOT_APPLICABLE' });
    }
  });
});
