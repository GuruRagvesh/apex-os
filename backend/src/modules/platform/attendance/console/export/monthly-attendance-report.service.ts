import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { TVAService } from '../../../../../common/services/tva.service';
import { EventLoggerService, OperationalAction } from '../../../../../common/services/event-logger.service';
import { BusinessCalendarService } from '../../calendar/business-calendar.service';
import { AccessPolicyService } from '../../../../../common/services/access-policy.service';
import { AttendanceConsoleService } from '../attendance-console.service';
import { deviceFileName, devicesCsv, registerCsv, registerFileName, type RegisterResult } from '../register-report';
import { assembleMonthlyAttendanceReport, monthDates } from './report-assembler';
import { csvPackage, packageName, workbookName } from './report-csv';
import { monthlyAttendanceWorkbookBuffer } from './report-workbook';
import type { MonthlyAttendanceReport, ReportSourceFacts } from './report-model';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Generous for a whole company month; the reads are a fixed handful of queries. */
const SNAPSHOT_TRANSACTION = {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  maxWait: 10_000,
  timeout: 120_000,
};

export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const ZIP_CONTENT_TYPE = 'application/zip';

export interface ExportFilters {
  month?: string;
  from?: string;
  to?: string;
  departmentId?: string;
  /** One employee only: the register's per-employee daily view. */
  userId?: string;
}

export interface ExportFile {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

/**
 * Gathers the facts for one month's attendance report and hands them to the
 * canonical assembler.
 *
 * AUTHORIZATION is the console's own: resolveScope() decides who this actor may
 * see before any attendance row is read, and an ineligible actor is refused
 * with a 403. A department filter can only NARROW that population -- it is
 * applied in addition to the scope, never instead of it.
 *
 * CONSISTENCY: every attendance fact is read inside ONE repeatable-read
 * transaction, so a correction approved while the report is being generated
 * lands either entirely before the snapshot or entirely after it. The Daily
 * Attendance and Monthly Summary sheets are built from that one snapshot and
 * cannot disagree.
 *
 * SHAPE: a fixed number of batched queries for the whole population -- no
 * query per employee and none per day -- so a full company month costs the
 * same handful of round trips as a team of three.
 */
@Injectable()
export class MonthlyAttendanceReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
    private readonly console: AttendanceConsoleService,
    private readonly businessCalendar: BusinessCalendarService,
    private readonly eventLogger: EventLoggerService,
    private readonly accessPolicy: AccessPolicyService,
  ) {}

  /** The month an export request names, validated. Always one whole month. */
  resolveMonth(filters: ExportFilters): string {
    let month = filters.month;
    if (!month && (filters.from || filters.to)) {
      if (!DATE_RE.test(filters.from ?? '') || !DATE_RE.test(filters.to ?? '')) {
        throw new BadRequestException('from and to must be yyyy-MM-dd dates');
      }
      const dates = monthDates(filters.from!.slice(0, 7));
      if (filters.from !== dates[0] || filters.to !== dates[dates.length - 1]) {
        throw new BadRequestException('The attendance export covers one whole calendar month.');
      }
      month = filters.from!.slice(0, 7);
    }
    month = month ?? this.tva.companyToday().slice(0, 7);
    if (!MONTH_RE.test(month)) throw new BadRequestException('month must be yyyy-MM');
    if (`${month}-01` > this.tva.companyToday()) {
      throw new BadRequestException('That month has not started yet; there is no attendance to export.');
    }
    return month;
  }

  async build(actor: any, filters: ExportFilters): Promise<MonthlyAttendanceReport> {
    return (await this.snapshot(actor, filters)).report;
  }

  /** build(), plus the read context the on-screen register also needs. */
  private async snapshot(actor: any, filters: ExportFilters) {
    const month = this.resolveMonth(filters);
    if (filters.departmentId !== undefined && (typeof filters.departmentId !== 'string' || filters.departmentId.length > 64)) {
      throw new BadRequestException('Invalid department');
    }

    if (filters.userId !== undefined && (typeof filters.userId !== 'string' || !filters.userId || filters.userId.length > 64)) {
      throw new BadRequestException('Invalid employee');
    }

    // Authority first, before anything about attendance is read.
    const scope = await this.console.resolveScope(actor);
    this.console.assertEligibleScope(scope);
    if (filters.userId && scope.userIds !== null && !scope.userIds.includes(filters.userId)) {
      throw new ForbiddenException('This employee is outside your attendance scope');
    }

    const dates = monthDates(month);
    const from = dates[0];
    const to = dates[dates.length - 1];
    const toDateOnly = (d: string) => this.tva.companyDateOnly(new Date(`${d}T00:00:00.000Z`));
    const fromDate = toDateOnly(from);
    const toDate = toDateOnly(to);
    const monthStartInstant = this.tva.companyDayStart(new Date(`${from}T12:00:00.000Z`));
    const monthEndInstant = this.tva.companyDayEnd(new Date(`${to}T12:00:00.000Z`));
    const businessDate = (d: Date) => this.tva.companyBusinessDate(d);
    const dateOnlyKey = (d: Date) => d.toISOString().slice(0, 10);

    const [y, m] = month.split('-').map(Number);
    const calendar = await this.businessCalendar.classifyMonth(y, m);
    const today = this.tva.companyToday();
    const generatedAt = this.tva.now();

    const facts = await this.prisma.$transaction(async (tx: any) => {
      let departmentName: string | null = null;
      if (filters.departmentId) {
        const dept = await tx.department.findUnique({ where: { id: filters.departmentId }, select: { name: true } });
        if (!dept) throw new BadRequestException('Unknown department');
        departmentName = dept.name;
      }

      // Who appears: everyone employed in the month (or holding attendance in
      // it), within the actor's scope, narrowed by the department filter.
      const where: any = {
        isSystemAccount: false,
        OR: [
          {
            isActive: true,
            AND: [
              { OR: [{ joiningDate: null }, { joiningDate: { lte: monthEndInstant } }] },
              { OR: [{ lastWorkingDate: null }, { lastWorkingDate: { gte: monthStartInstant } }] },
            ],
          },
          { dailyAttendanceRecords: { some: { date: { gte: fromDate, lte: toDate } } } },
          { employmentPeriods: { some: { startDate: { lte: toDate }, OR: [{ endDate: null }, { endDate: { gte: fromDate } }] } } },
        ],
      };
      if (scope.userIds !== null) where.id = { in: scope.userIds };
      if (filters.departmentId) where.departmentId = filters.departmentId;
      if (filters.userId) where.id = filters.userId;

      const users = await tx.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          employeeId: true,
          designation: true,
          employmentType: true,
          joiningDate: true,
          lastWorkingDate: true,
          isActive: true,
          avatar: true,
          photoUrl: true,
          department: { select: { name: true } },
        },
        orderBy: { name: 'asc' },
      });
      const ids: string[] = users.map((u: any) => u.id);
      const none = Promise.resolve([] as any[]);
      const inIds = { in: ids };

      const [profiles, official, corrections, compOff, sessions, punches, leaves] = await Promise.all([
        ids.length
          ? tx.employeeAttendanceProfile.findMany({
              where: { userId: inIds, effectiveFrom: { lte: monthEndInstant }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: monthStartInstant } }] },
              select: {
                userId: true,
                effectiveFrom: true,
                effectiveTo: true,
                category: true,
                attendanceRequired: true,
                assignedShift: { select: { minimumWorkingMinutes: true } },
              },
            })
          : none,
        ids.length
          ? tx.dailyAttendance.findMany({
              where: { userId: inIds, date: { gte: fromDate, lte: toDate } },
              select: {
                userId: true,
                date: true,
                status: true,
                evaluationState: true,
                calculationReason: true,
                exceptionFlags: true,
                punchInAt: true,
                punchOutAt: true,
                workedMinutes: true,
                breakMinutes: true,
                lateMinutes: true,
                leaveDeducted: true,
                lwpDeducted: true,
                revision: true,
                lastRegularizationId: true,
                leaveRequestId: true,
              },
            })
          : none,
        ids.length
          ? tx.attendanceRegularization.findMany({
              where: { userId: inIds, date: { gte: fromDate, lte: toDate } },
              select: {
                userId: true,
                date: true,
                status: true,
                applicationStatus: true,
                applicationFailureReason: true,
                requestType: true,
                policyCorrectionType: true,
                reason: true,
                createdAt: true,
              },
            })
          : none,
        ids.length
          ? tx.compOffCredit.findMany({
              where: { employeeId: inIds, earnedFromBusinessDate: { gte: fromDate, lte: toDate } },
              select: { employeeId: true, earnedFromBusinessDate: true, creditMinutes: true, status: true },
            })
          : none,
        ids.length
          ? tx.workSession.findMany({
              where: { userId: inIds, date: { gte: fromDate, lte: toDate } },
              select: {
                userId: true,
                date: true,
                startWorkAt: true,
                logoutAt: true,
                autoClosed: true,
                totalWorkMinutes: true,
                totalBreakMinutes: true,
                breakLogs: {
                  where: { breakType: 'MEETING' },
                  select: {
                    meetingId: true,
                    startAt: true,
                    endAt: true,
                    durationMinutes: true,
                    source: true,
                    meeting: { select: { approvalStatus: true, status: true } },
                  },
                },
              },
            })
          : none,
        ids.length
          ? tx.attendancePunchEvidence.findMany({
              where: { userId: inIds, businessDate: { gte: fromDate, lte: toDate } },
              select: {
                userId: true,
                businessDate: true,
                type: true,
                serverOccurredAt: true,
                latitude: true,
                longitude: true,
                locationVerification: true,
                distanceFromLocationMeters: true,
                attendanceLocation: { select: { name: true } },
              },
            })
          : none,
        ids.length
          ? tx.leaveRequest.findMany({
              where: {
                userId: inIds,
                status: { in: ['APPROVED', 'PENDING'] },
                startDate: { lte: monthEndInstant },
                endDate: { gte: monthStartInstant },
              },
              select: { id: true, userId: true, type: true, status: true, approvalStage: true, isHalfDay: true, startDate: true, endDate: true },
            })
          : none,
      ]);

      // A leave named by an official day is always resolvable for its label,
      // even if it has since been cancelled.
      const known = new Set(leaves.map((l: any) => l.id));
      const missing = [...new Set(official.map((o: any) => o.leaveRequestId).filter((id: any) => id && !known.has(id)))];
      const referenced = missing.length
        ? await tx.leaveRequest.findMany({
            where: { id: { in: missing } },
            select: { id: true, userId: true, type: true, status: true, approvalStage: true, isHalfDay: true, startDate: true, endDate: true },
          })
        : [];

      return { departmentName, users, profiles, official, corrections, compOff, sessions, punches, leaves: [...leaves, ...referenced] };
    }, SNAPSHOT_TRANSACTION);

    // Company day bounds per date, for placing leave instants on business dates
    // exactly the way LeaveFactsService does (overlap with the company day).
    const bounds = dates.map((d) => ({
      date: d,
      start: this.tva.companyDayStart(new Date(`${d}T12:00:00.000Z`)).getTime(),
      end: this.tva.companyDayEnd(new Date(`${d}T12:00:00.000Z`)).getTime(),
    }));

    const source: ReportSourceFacts = {
      month,
      today,
      generatedAt,
      timezone: this.tva.companyTimezone(),
      financialYear: this.tva.financialYear(new Date(`${from}T12:00:00.000Z`)).label,
      scope: scope.isHr ? 'COMPANY' : 'TEAM',
      departmentName: facts.departmentName,
      calendarResolved:
        calendar.sources.weeklyOffPolicy !== 'NONE' &&
        calendar.sources.weeklyOffPolicy !== 'AMBIGUOUS' &&
        calendar.sources.holidayCalendar !== 'NONE' &&
        calendar.sources.holidayCalendar !== 'AMBIGUOUS',
      employees: facts.users.map((u: any) => ({
        userId: u.id,
        employeeCode: u.employeeId ?? null,
        name: u.name,
        department: u.department?.name ?? null,
        designation: u.designation ?? null,
        employmentType: u.employmentType ?? null,
        joiningDate: u.joiningDate ? businessDate(u.joiningDate) : null,
        lastWorkingDate: u.lastWorkingDate ? businessDate(u.lastWorkingDate) : null,
      })),
      profiles: facts.profiles.map((p: any) => ({
        userId: p.userId,
        effectiveFrom: businessDate(p.effectiveFrom),
        effectiveTo: p.effectiveTo ? businessDate(p.effectiveTo) : null,
        category: p.category,
        attendanceRequired: p.attendanceRequired,
        requiredPresenceMinutes: p.assignedShift?.minimumWorkingMinutes ?? null,
      })),
      calendar: calendar.days,
      official: facts.official.map((o: any) => ({
        userId: o.userId,
        businessDate: dateOnlyKey(o.date),
        status: o.status,
        evaluationState: o.evaluationState,
        calculationReason: o.calculationReason ?? null,
        exceptionFlags: (o.exceptionFlags as string[]) ?? [],
        punchInAt: o.punchInAt ?? null,
        punchOutAt: o.punchOutAt ?? null,
        workedMinutes: o.workedMinutes ?? 0,
        breakMinutes: o.breakMinutes ?? 0,
        lateMinutes: o.lateMinutes ?? 0,
        leaveDeducted: o.leaveDeducted ?? 0,
        lwpDeducted: o.lwpDeducted ?? 0,
        revision: o.revision ?? 0,
        lastRegularizationId: o.lastRegularizationId ?? null,
        leaveRequestId: o.leaveRequestId ?? null,
      })),
      leaves: facts.leaves.map((l: any) => {
        const s = new Date(l.startDate).getTime();
        const e = new Date(l.endDate).getTime();
        return {
          id: l.id,
          userId: l.userId,
          type: l.type,
          status: l.status,
          approvalStage: l.approvalStage ?? null,
          isHalfDay: !!l.isHalfDay,
          dates: bounds.filter((b) => s <= b.end && e >= b.start).map((b) => b.date),
        };
      }),
      compOff: facts.compOff.map((c: any) => ({
        userId: c.employeeId,
        earnedFromBusinessDate: dateOnlyKey(c.earnedFromBusinessDate),
        creditMinutes: c.creditMinutes,
        status: c.status,
      })),
      corrections: facts.corrections.map((c: any) => ({
        userId: c.userId,
        businessDate: dateOnlyKey(c.date),
        status: c.status,
        applicationStatus: c.applicationStatus ?? null,
        applicationFailureReason: c.applicationFailureReason ?? null,
        requestType: c.policyCorrectionType ?? c.requestType,
        reason: c.reason ?? '',
        createdAt: c.createdAt,
      })),
      sessions: facts.sessions.map((s: any) => ({
        userId: s.userId,
        businessDate: dateOnlyKey(s.date),
        startWorkAt: s.startWorkAt ?? null,
        logoutAt: s.logoutAt ?? null,
        totalWorkMinutes: s.totalWorkMinutes ?? 0,
        totalBreakMinutes: s.totalBreakMinutes ?? 0,
        autoClosed: !!s.autoClosed,
      })),
      meetings: facts.sessions.flatMap((s: any) =>
        (s.breakLogs ?? []).map((b: any) => ({
          userId: s.userId,
          businessDate: dateOnlyKey(s.date),
          meetingId: b.meetingId ?? null,
          startAt: b.startAt,
          endAt: b.endAt ?? null,
          durationMinutes: b.durationMinutes ?? null,
          approvalStatus: b.meeting ? b.meeting.approvalStatus : null,
          cancelled: b.source === 'MEETING_CANCELLED' || b.meeting?.status === 'CANCELLED',
        })),
      ),
      punches: facts.punches.map((p: any) => ({
        userId: p.userId,
        businessDate: dateOnlyKey(p.businessDate),
        type: p.type,
        at: p.serverOccurredAt,
        location:
          typeof p.latitude === 'number' && typeof p.longitude === 'number'
            ? {
                latitude: p.latitude,
                longitude: p.longitude,
                verification: p.locationVerification ?? null,
                distanceMeters: p.distanceFromLocationMeters ?? null,
                placeName: p.attendanceLocation?.name ?? null,
              }
            : null,
      })),
    };

    return { report: assembleMonthlyAttendanceReport(source), scope, calendar, users: facts.users as any[] };
  }

  /** The report as a file. Both formats are encodings of one build(). */
  async export(actor: any, filters: ExportFilters, format: 'xlsx' | 'zip'): Promise<ExportFile> {
    const report = await this.build(actor, filters);
    const file: ExportFile =
      format === 'xlsx'
        ? {
            buffer: await monthlyAttendanceWorkbookBuffer(report),
            filename: workbookName(report.metadata.monthLabel),
            contentType: XLSX_CONTENT_TYPE,
          }
        : {
            buffer: csvPackage(report),
            filename: packageName(report.metadata.monthLabel),
            contentType: ZIP_CONTENT_TYPE,
          };

    // Who exported what, as counts only: no attendance values in the audit trail.
    this.eventLogger
      .log({
        actorId: actor?.id,
        entityType: 'AttendanceReport',
        entityId: `month:${report.metadata.month}`,
        action: OperationalAction.EXPORT_PERFORMED,
        metadata: {
          month: report.metadata.month,
          format,
          scope: report.metadata.scope,
          departmentFiltered: !!filters.departmentId,
          employees: report.metadata.employees,
          provisional: report.metadata.provisional,
        },
      })
      .catch(() => {});

    return file;
  }

  /**
   * The on-screen Monthly Register.
   *
   * Served from the SAME snapshot and the SAME assembler as the workbook and
   * the CSV package: every figure below is read off the Monthly Summary row the
   * downloads carry, never recounted. So for one employee, month and scope the
   * screen, the Excel Monthly Summary and the CSV Monthly Summary agree by
   * construction, and an applied correction reaches all three on the next read.
   *
   * Days the system has not settled (not evaluated, NEEDS_REVIEW, held or
   * pending corrections) are counted as Unresolved and leave Attendance % blank
   * with Provisional = Yes. They are never shown as a zero.
   */
  async register(actor: any, filters: ExportFilters) {
    const { report, scope, calendar, users } = await this.snapshot(actor, filters);
    const { metadata } = report;
    const today = this.tva.companyToday();
    const elapsedThrough = metadata.to < today ? metadata.to : today;
    const people = new Map(users.map((u: any) => [u.id, u]));
    const balances = await this.console.leaveBalances(
      report.monthlySummaryRows.map((r) => r.userId),
      metadata.from,
    );
    const num = (v: unknown) => (typeof v === 'number' ? v : 0);

    const employees = report.monthlySummaryRows.map((row) => {
      const v = row.values;
      const u: any = people.get(row.userId) ?? {};
      const percent = typeof v.attendancePercent === 'number' ? v.attendancePercent : null;
      return {
        userId: row.userId,
        name: String(v.employeeName ?? u.name ?? ''),
        employeeId: u.employeeId ?? null,
        avatar: u.avatar ?? null,
        photoUrl: u.photoUrl ?? null,
        // A former employee shown for the days they worked. Reports mark them; they are not reactivated.
        isActive: u.isActive ?? true,
        department: u.department?.name ?? null,

        daysPresent: num(v.presentDays),
        daysAbsent: num(v.absentDays),
        halfDays: num(v.halfDays),
        leaveDays: num(v.leaveDays),
        leaveBalance: balances.byUser.get(row.userId) ?? null,
        latePunchIns: num(v.lateDays),
        daysBelowNineHours: num(v.daysBelowNineHours),
        /** Approved comp-off earned in the month, in hours. */
        approvedCompOff: num(v.approvedCompOff),
        unresolvedDays: num(v.unresolvedDays),
        // The report holds the fraction (0.9545); the screen shows percent
        // points to two decimals -- the same number Excel renders as 95.45%.
        attendanceCompletionPercentage: percent === null ? null : Math.round(percent * 10000) / 100,
        provisional: v.provisional === 'Yes',

        workingDays: num(v.workingDays),
        eligibleWorkingDays: num(v.eligibleWorkingDays),
        lwpDays: num(v.lwpDays),
        weeklyOff: num(v.weeklyOffDays),
        holiday: num(v.holidayDays),
        pendingDisputes: num(v.pendingDisputes),
      };
    });

    return {
      from: metadata.from,
      to: metadata.to,
      days: monthDates(metadata.month).length,
      month: metadata.month,
      /** Scheduled working days in the WHOLE month, for the header metric. */
      workingDays: calendar.workingDays,
      /** Working days elapsed so far. */
      elapsedWorkingDays: calendar.days.filter(
        (d: any) => d.isWorkingDay && d.businessDate >= metadata.from && d.businessDate <= elapsedThrough,
      ).length,
      calendarResolved:
        calendar.sources.weeklyOffPolicy !== 'NONE' && calendar.sources.weeklyOffPolicy !== 'AMBIGUOUS',
      leaveBalanceFinancialYear: balances.financialYear,
      monthComplete: metadata.monthComplete,
      provisional: metadata.provisional,
      generatedAt: metadata.generatedAt,
      warnings: report.warnings,
      employees,
      // HR/Admin only. Managers never receive device evidence.
      ...(scope.isHr
        ? {
            devices: await this.console.registerDevices(
              users.map((u: any) => ({ id: u.id, name: u.name, employeeId: u.employeeId ?? null })),
              metadata.from,
              metadata.to,
            ),
          }
        : {}),
    };
  }

  /**
   * One employee's days for the register's daily view: the same Daily
   * Attendance rows the Excel and CSV carry, from the same snapshot and
   * assembler, so the screen can never disagree with the download.
   */
  async employeeDays(actor: any, filters: ExportFilters & { userId: string }) {
    const { report } = await this.snapshot(actor, filters);
    const { metadata } = report;
    const summary = report.monthlySummaryRows.find((r) => r.userId === filters.userId) ?? null;
    if (!summary) throw new BadRequestException('Unknown employee for this month');
    const pick = (v: Record<string, unknown>, k: string) => (v[k] === undefined ? null : v[k]);
    const days = report.dailyRows
      .filter((r) => r.userId === filters.userId)
      .map((r) => ({
        date: r.businessDate,
        status: pick(r.values, 'attendanceStatus'),
        punchIn: pick(r.values, 'punchIn'),
        punchOut: pick(r.values, 'punchOut'),
        presenceHours: pick(r.values, 'presenceHours'),
        workHours: pick(r.values, 'workHours'),
        breakHours: pick(r.values, 'breakHours'),
        punchInLocation: pick(r.values, 'punchInLocation'),
        punchOutLocation: pick(r.values, 'punchOutLocation'),
        lateArrival: pick(r.values, 'lateArrival'),
        missingPunch: pick(r.values, 'missingPunch'),
        schedule: pick(r.values, 'schedule'),
        hrReview: pick(r.values, 'hrReview'),
        remarks: pick(r.values, 'remarks'),
      }));
    return {
      month: metadata.month,
      from: metadata.from,
      to: metadata.to,
      provisional: metadata.provisional,
      userId: filters.userId,
      name: String(summary.values.employeeName ?? ''),
      days,
    };
  }

  /**
   * The seven-column register as CSV (legacy route, kept for API compatibility).
   * Rendered from register(), so it carries the same figures as the screen.
   */
  async exportLegacyRegisterCsv(actor: any, filters: ExportFilters): Promise<ExportFile> {
    const result = (await this.register(actor, filters)) as unknown as RegisterResult;
    return {
      buffer: Buffer.from(registerCsv(result), 'utf8'),
      filename: registerFileName(result.month, 'csv'),
      contentType: 'text/csv; charset=utf-8',
    };
  }

  /** The device sheet as its own CSV. HR/Admin only. */
  async exportDevices(actor: any, filters: ExportFilters): Promise<ExportFile> {
    if (!this.accessPolicy.isHrOrAdmin(actor)) {
      throw new ForbiddenException('Only HR and administrators can export device evidence');
    }
    const result = await this.register(actor, filters);
    return {
      buffer: Buffer.from(devicesCsv((result as any).devices ?? []), 'utf8'),
      filename: deviceFileName(result.month),
      contentType: 'text/csv; charset=utf-8',
    };
  }
}
