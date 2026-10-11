import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TVAService } from '../../../../common/services/tva.service';
import { buildDayBundle, type BundleLookups } from './bundle-builder';
import { buildEmployeeIndex } from './identity-map';
import { indexPolicies, type PolicyVersionRow } from './policy-map';
import type { ParsedRecoveryDocument } from './recovery-document';
import type { RecoveryValidationContext } from './recovery-validation';
import { bundleKey, type AttendanceDayBundle, type PolicyReference, type RecoveryTombstone } from './recovery.types';

/**
 * Read-only access to the facts recovery needs. Every query is a findMany or a
 * count; there is no create, update, upsert, delete or raw SQL in this file (a
 * unit test scans for them). It is the only part of the recovery module that
 * touches the database, and it only reads.
 */

const CHUNK = 1000;

@Injectable()
export class RecoveryReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
  ) {}

  private async byIds<T>(model: { findMany: (args: any) => Promise<T[]> }, field: string, ids: Iterable<string>, extra: any = {}): Promise<T[]> {
    const list = [...new Set([...ids].filter(Boolean))];
    const out: T[] = [];
    for (let i = 0; i < list.length; i += CHUNK) {
      out.push(...(await model.findMany({ ...extra, where: { ...(extra.where ?? {}), [field]: { in: list.slice(i, i + CHUNK) } } })));
    }
    return out;
  }

  private dateOnly(d: string): Date {
    return new Date(`${d}T00:00:00.000Z`);
  }

  private async policyRows(): Promise<{ attendance: PolicyVersionRow[]; shift: PolicyVersionRow[]; holidayCalendar: PolicyVersionRow[] }> {
    const select = { id: true, policyKey: true, version: true, status: true, effectiveFrom: true, effectiveTo: true };
    const conv = (rows: any[]): PolicyVersionRow[] =>
      rows.map((r) => ({
        id: r.id,
        policyKey: r.policyKey,
        version: r.version,
        status: String(r.status),
        effectiveFrom: this.tva.companyBusinessDate(r.effectiveFrom),
        effectiveTo: r.effectiveTo ? this.tva.companyBusinessDate(r.effectiveTo) : null,
      }));
    const [attendance, shift, holidayCalendar] = await Promise.all([
      this.prisma.attendancePolicy.findMany({ select }),
      this.prisma.shiftPolicy.findMany({ select }),
      this.prisma.holidayCalendar.findMany({ select }),
    ]);
    return { attendance: conv(attendance), shift: conv(shift), holidayCalendar: conv(holidayCalendar) };
  }

  /** Lookups that translate stored UUIDs into business identity. */
  async lookups(): Promise<BundleLookups & { users: Array<{ id: string; employeeId: string | null }> }> {
    const users = await this.prisma.user.findMany({ select: { id: true, employeeId: true } });
    const p = await this.policyRows();
    const keyMap = (rows: PolicyVersionRow[]) => new Map<string, PolicyReference>(rows.map((r) => [r.id, { policyKey: r.policyKey, version: r.version }]));
    return {
      users,
      employeeIdByUserId: new Map(users.map((u) => [u.id, u.employeeId])),
      attendancePolicyKeyById: keyMap(p.attendance),
      shiftPolicyKeyById: keyMap(p.shift),
      holidayCalendarKeyById: keyMap(p.holidayCalendar),
    };
  }

  /**
   * The target's stored attendance for a date range, as bundles keyed
   * `${employeeId}|${businessDate}`. Users without an employeeId cannot be keyed
   * and are reported in `unkeyedUserIds` rather than silently dropped.
   */
  async currentBundles(from: string, to: string, onlyUserIds?: string[]): Promise<{
    bundles: Map<string, AttendanceDayBundle>;
    problems: Map<string, string[]>;
    unkeyedUserIds: string[];
  }> {
    const lk = await this.lookups();
    const range = { gte: this.dateOnly(from), lte: this.dateOnly(to) };
    const userFilter = onlyUserIds ? { userId: { in: onlyUserIds } } : {};
    const da = await this.prisma.dailyAttendance.findMany({ where: { date: range, ...userFilter } });
    let sessions = await this.prisma.workSession.findMany({ where: { date: range, ...userFilter } });
    const known = new Set(sessions.map((s) => s.id));
    sessions = sessions.concat(await this.byIds(this.prisma.workSession as any, 'id', da.flatMap((r) => r.workSessionIds).filter((id) => !known.has(id))) as any[]);
    const breaks = await this.byIds(this.prisma.breakLog as any, 'workSessionId', sessions.map((s) => s.id));
    const evidence = await this.prisma.attendancePunchEvidence.findMany({ where: { businessDate: range, ...userFilter } });
    const regs = await this.prisma.attendanceRegularization.findMany({ where: { date: range, ...userFilter } });

    type Rows = { userId: string; date: string; da: any; s: any[]; b: any[]; e: any[]; g: any[] };
    const days = new Map<string, Rows>();
    const at = (userId: string, date: string) => {
      const k = `${userId}|${date}`;
      if (!days.has(k)) days.set(k, { userId, date, da: null, s: [], b: [], e: [], g: [] });
      return days.get(k)!;
    };
    const d = (x: Date) => x.toISOString().slice(0, 10);
    const sessionHome = new Map<string, string>();
    for (const r of da) {
      at(r.userId, d(r.date)).da = r;
      for (const sid of r.workSessionIds) if (!sessionHome.has(sid)) sessionHome.set(sid, `${r.userId}|${d(r.date)}`);
    }
    const sessionDay = new Map<string, Rows>();
    for (const s of sessions) {
      const home = sessionHome.get(s.id);
      const rows = home ? days.get(home)! : at(s.userId, d(s.date));
      rows.s.push(s);
      sessionDay.set(s.id, rows);
    }
    for (const b of breaks as any[]) sessionDay.get(b.workSessionId)?.b.push(b);
    for (const e of evidence) at(e.userId, d(e.businessDate)).e.push(e);
    for (const g of regs) at(g.userId, d(g.date)).g.push(g);

    const bundles = new Map<string, AttendanceDayBundle>();
    const problems = new Map<string, string[]>();
    const unkeyed = new Set<string>();
    for (const rows of days.values()) {
      if (rows.date < from || rows.date > to) continue;
      const employeeId = lk.employeeIdByUserId.get(rows.userId);
      if (!employeeId) { unkeyed.add(rows.userId); continue; }
      const built = buildDayBundle({
        ownerUserId: rows.userId,
        employeeId,
        businessDate: rows.date,
        rows: { dailyAttendance: rows.da, workSessions: rows.s, breakLogs: rows.b, punchEvidence: rows.e, regularizations: rows.g },
        lookups: lk,
        provenance: { sourceType: 'LIVE', sourceId: 'database' },
      });
      const key = bundleKey(employeeId, rows.date);
      bundles.set(key, built.bundle);
      if (built.problems.length) problems.set(key, built.problems);
    }
    return { bundles, problems, unkeyedUserIds: [...unkeyed].sort() };
  }

  /** Every fact validateRecoveryDocument() needs, for the dates and people the document covers. */
  async validationContext(
    doc: ParsedRecoveryDocument,
    priorRecoveryBatches: Array<{ reference: string; fileSha256: string; status: string }>,
  ): Promise<RecoveryValidationContext> {
    const companyToday = this.tva.companyToday();
    const bundles = doc.bundles.map((p) => p.bundle).filter(Boolean) as AttendanceDayBundle[];
    const dates = bundles.map((b) => b.businessDate).sort();
    const from = dates[0] ?? companyToday;
    const to = dates[dates.length - 1] ?? companyToday;

    const lk = await this.lookups();
    const p = await this.policyRows();
    const current = await this.currentBundles(from, to);

    const ids = (pick: (b: AttendanceDayBundle) => Array<string | null | undefined>) =>
      new Set(bundles.flatMap(pick).filter(Boolean) as string[]);
    const existing = async (model: any, wanted: Set<string>) =>
      new Set((await this.byIds<any>(model, 'id', wanted, { select: { id: true } })).map((r) => r.id));

    const leaveIds = ids((b) => b.leaveReferences);
    const sessionIds = ids((b) => [...b.workSessions.map((s) => s.id), ...b.workSessions.map((s) => s.continuationOfSessionId), ...b.punchEvidence.map((e) => e.workSessionId)]);
    const regIds = ids((b) => [...b.regularizations.map((g) => g.id), b.dailyAttendance?.lastRegularizationId]);
    const breakIds = ids((b) => b.breakLogs.map((x) => x.id));
    const evidenceKeys = ids((b) => b.punchEvidence.map((e) => e.idempotencyKey));

    const sessionRows = await this.byIds<any>(this.prisma.workSession as any, 'id', sessionIds, { select: { id: true, userId: true, date: true } });
    const regRows = await this.byIds<any>(this.prisma.attendanceRegularization as any, 'id', regIds, { select: { id: true, userId: true, date: true } });
    const breakRows = await this.byIds<any>(this.prisma.breakLog as any, 'id', breakIds, { select: { id: true, workSessionId: true } });
    const breakSessions = await this.byIds<any>(this.prisma.workSession as any, 'id', breakRows.map((r) => r.workSessionId), { select: { id: true, userId: true, date: true } });
    const evidenceRows = await this.byIds<any>(this.prisma.attendancePunchEvidence as any, 'idempotencyKey', evidenceKeys, { select: { userId: true, idempotencyKey: true, businessDate: true } });

    const keyOf = (userId: string, date: Date) => {
      const emp = lk.employeeIdByUserId.get(userId);
      return emp ? bundleKey(emp, date.toISOString().slice(0, 10)) : `UNKEYED:${userId}`;
    };
    const takenIds = new Map<string, string>();
    for (const r of sessionRows) takenIds.set(`WorkSession:${r.id}`, keyOf(r.userId, r.date));
    for (const r of regRows) takenIds.set(`AttendanceRegularization:${r.id}`, keyOf(r.userId, r.date));
    const sessionById = new Map(breakSessions.map((s: any) => [s.id, s]));
    for (const r of breakRows) {
      const s: any = sessionById.get(r.workSessionId);
      if (s) takenIds.set(`BreakLog:${r.id}`, keyOf(s.userId, s.date));
    }
    for (const r of evidenceRows) {
      const emp = lk.employeeIdByUserId.get(r.userId);
      if (emp) takenIds.set(`AttendancePunchEvidence:${emp}|${r.idempotencyKey}`, bundleKey(emp, r.businessDate.toISOString().slice(0, 10)));
    }

    const employeeIds = [...new Set(bundles.map((b) => b.employeeId))];
    const tombRows = await this.byIds<any>(this.prisma.attendanceRecoveryTombstone as any, 'employeeId', employeeIds, {
      where: { businessDate: { gte: this.dateOnly(from), lte: this.dateOnly(to) } },
    });
    const tombstones: RecoveryTombstone[] = tombRows.map((t) => ({
      id: t.id, employeeId: t.employeeId, businessDate: t.businessDate.toISOString().slice(0, 10),
      recordType: t.recordType, recordId: t.recordId ?? null, reason: t.reason,
    }));

    const months = [...new Set(dates.map((x) => x.slice(0, 7)))];
    const closes = await this.prisma.attendanceMonthClose.findMany({ where: { month: { in: months } }, select: { month: true, status: true } });

    const historicalTo = new Date(this.dateOnly(companyToday).getTime() - 2 * 86_400_000);
    const daDates = await this.prisma.dailyAttendance.findMany({
      where: { date: { gte: this.dateOnly(`${from.slice(0, 7)}-01`), lte: this.dateOnly(to) } },
      select: { date: true },
    });
    const currentDaysByMonth = new Map<string, number>();
    let historicalEmployeeDays = 0;
    for (const r of daDates) {
      const m = r.date.toISOString().slice(0, 7);
      currentDaysByMonth.set(m, (currentDaysByMonth.get(m) ?? 0) + 1);
      if (r.date <= historicalTo) historicalEmployeeDays += 1;
    }

    const exactIds = (pick: (b: AttendanceDayBundle) => Array<string | null | undefined>) => ids(pick);
    return {
      companyToday,
      employeeIndex: buildEmployeeIndex(lk.users),
      attendancePolicies: indexPolicies(p.attendance),
      shiftPolicies: indexPolicies(p.shift),
      holidayCalendars: indexPolicies(p.holidayCalendar),
      existingLeaveIds: await existing(this.prisma.leaveRequest, leaveIds),
      existingIds: {
        weeklyOffPolicy: await existing(this.prisma.weeklyOffPolicy, exactIds((b) => [b.dailyAttendance?.weeklyOffPolicyId])),
        holiday: await existing(this.prisma.holiday, exactIds((b) => [b.dailyAttendance?.holidayId])),
        businessDayOverride: await existing(this.prisma.businessDayOverride, exactIds((b) => [b.dailyAttendance?.businessDayOverrideId])),
        employeeProfile: await existing(this.prisma.employeeAttendanceProfile, exactIds((b) => [b.dailyAttendance?.employeeProfileId, ...b.punchEvidence.map((e) => e.employeeProfileId)])),
        attendanceLocation: await existing(this.prisma.attendanceLocation, exactIds((b) => b.punchEvidence.map((e) => e.attendanceLocationId))),
        workSession: new Set(sessionRows.map((r) => r.id)),
        regularization: new Set(regRows.map((r) => r.id)),
      },
      currentBundles: current.bundles,
      tombstones,
      monthCloseStatus: new Map(closes.map((c) => [c.month, String(c.status)])),
      takenIds,
      historicalEmployeeDays,
      currentDaysByMonth,
      priorRecoveryBatches,
    };
  }
}
