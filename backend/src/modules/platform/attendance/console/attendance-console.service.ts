import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TVAService } from '../../../../common/services/tva.service';
import { AccessPolicyService } from '../../../../common/services/access-policy.service';
import { HierarchyApprovalService } from '../../../../common/services/hierarchy-approval.service';
import { EventLoggerService, OperationalAction } from '../../../../common/services/event-logger.service';
import { DailyAttendanceEvaluatorService } from '../evaluation/daily-attendance-evaluator.service';
import { AttendanceProcessingService } from '../processing/attendance-processing.service';
import { BusinessCalendarService } from '../calendar/business-calendar.service';
import { LeaveBalanceService } from '../../../operations/leave/leave-balance.service';
import { formatInTimeZone } from 'date-fns-tz';
import { ROLES } from '../../../../shared/constants/roles';
import { registerCsv, registerFileName, type RegisterResult } from './register-report';
import { buildRegisterWorkbook } from './register-workbook';

/**
 * HR / manager attendance console (HC-1).
 *
 * This service READS the official record and OPERATES the services that already
 * exist. It contains no attendance rules of its own: every classification it
 * reports was decided by the AE-1 evaluator and stored on DailyAttendance, and
 * every write it performs is a call into evaluateAndPersist() or finalize().
 *
 * Two consequences worth stating, because they are easy to erode later:
 *
 *  1. A missing DailyAttendance row is reported as NOT_EVALUATED. It is never
 *     counted as absence. "We have not looked at this day yet" and "this person
 *     did not come to work" are different facts, and conflating them in a
 *     summary is how an incorrect absence reaches payroll.
 *
 *  2. Scope is enforced here, in the backend. A manager's queries are narrowed
 *     to the people who actually report to them before any row is read.
 */

/** Longest range any console query or command may span. */
const MAX_RANGE_DAYS = 62;
/** Employee-days one evaluation command may process. */
const MAX_EVALUATION_UNITS = 2000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A punch in AFTER this company-local time is late.
 *
 * The policy window is 09:30-10:30 INCLUSIVE, so 10:30:00 is on time and
 * 10:30:01 is not. Compared as a zero-padded HH:mm:ss string in company time,
 * which sorts correctly and needs no offset arithmetic -- and reading the wall
 * clock in the company timezone is the whole point, since a UTC comparison
 * would call an 09:00 IST arrival late.
 */
const LATE_AFTER = '10:30:00';

/**
 * The only roles that operate this console without HR or Admin authority.
 *
 * A closed list, checked before any department or hierarchy lookup. Seniority
 * is not authority here: EMPLOYEE and INTERN are absent deliberately, and a
 * role that does not exist yet is absent by default rather than admitted by
 * accident.
 */
const CONSOLE_ROLES = new Set<string>([ROLES.MANAGER, ROLES.TEAM_LEAD]);

export interface ConsoleScope {
  /** null means unrestricted (HR/Admin). */
  userIds: string[] | null;
  isHr: boolean;
  /**
   * Whether this actor may operate the console AT ALL, independent of how many
   * people they can see.
   *
   * Separate from an empty userIds on purpose. A manager whose team is empty
   * is permitted and has nothing to show; an employee is not permitted. Both
   * used to produce an empty list, which made a refusal indistinguishable from
   * a quiet day.
   */
  eligible: boolean;
}

export interface EvaluationCommandResult {
  businessDates: string[];
  requested: number;
  evaluated: number;
  unchanged: number;
  skipped: number;
  failed: Array<{ userId: string; businessDate: string; error: string }>;
}

@Injectable()
export class AttendanceConsoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
    private readonly accessPolicy: AccessPolicyService,
    private readonly hierarchy: HierarchyApprovalService,
    private readonly eventLogger: EventLoggerService,
    private readonly evaluator: DailyAttendanceEvaluatorService,
    private readonly processing: AttendanceProcessingService,
    private readonly businessCalendar: BusinessCalendarService,
    private readonly leaveBalance: LeaveBalanceService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────
  // Scope
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Which employees this actor may see.
   *
   * HR and Admin see everyone. MANAGER and TEAM_LEAD are narrowed to their
   * actual reporting relationships — the same `User.reportingManager` /
   * `User.teamLeadName` employeeId links the hierarchy resolver uses, plus the
   * departments the existing access policy says they manage.
   *
   * Nobody else operates this console at all.
   *
   * THE ROLE GATE IS LOAD-BEARING AND MUST COME FIRST.
   *
   * AccessPolicyService.managedDepartmentIds() has explicit branches for
   * MANAGER and TEAM_LEAD and then a final fallback that returns the caller's
   * OWN department. That fallback is reasonable where it is used to answer
   * "which departments may this person see records from"; read here as "which
   * departments does this person MANAGE", it silently promoted every EMPLOYEE
   * and INTERN with a department into a manager of their colleagues — and this
   * console hands out attendance, leave balances and a downloadable register.
   *
   * So the console decides its own eligibility by role before it asks the
   * shared policy anything. The shared policy is untouched: it is reused by
   * tickets, leave and users, and narrowing it globally is a much larger change
   * than this exposure warrants.
   *
   * Belonging to a department is not management authority. Only the two roles
   * that carry it get to ask.
   *
   * Resolved as a set of ids rather than a filter the caller could forget to
   * apply, so a query cannot accidentally escape its scope.
   */
  async resolveScope(actor: any): Promise<ConsoleScope> {
    if (this.accessPolicy.isHrOrAdmin(actor)) {
      return { userIds: null, isHr: true, eligible: true };
    }

    const me = await this.prisma.user.findUnique({
      where: { id: actor?.id },
      select: { id: true, employeeId: true, departmentId: true, role: { select: { name: true } } },
    });
    if (!me) return { userIds: [], isHr: false, eligible: false };

    // EMPLOYEE, INTERN, and any role this ladder has not heard of, stop here.
    // Nothing below this line runs for them, so no inference can reach them.
    if (!CONSOLE_ROLES.has(me.role?.name as any)) {
      return { userIds: [], isHr: false, eligible: false };
    }

    const departmentIds = await this.accessPolicy.managedDepartmentIds({
      id: me.id,
      departmentId: me.departmentId,
      role: me.role,
    } as any);

    const or: any[] = [];
    if (me.employeeId) {
      or.push({ reportingManager: me.employeeId }, { teamLeadName: me.employeeId });
    }
    if (departmentIds.length > 0) or.push({ departmentId: { in: departmentIds } });

    // A manager with nobody under them yet is still a manager: eligible, with
    // an empty population. That is a different fact from "not permitted", and
    // the two must not collapse into the same answer.
    if (or.length === 0) return { userIds: [], isHr: false, eligible: true };

    const reports = await this.prisma.user.findMany({
      where: { isActive: true, OR: or, id: { not: me.id } },
      select: { id: true },
    });
    return { userIds: reports.map((r) => r.id), isHr: false, eligible: true };
  }

  /**
   * The console's single refusal.
   *
   * Every read goes through this, so Daily Review, the Monthly Register and
   * both exports cannot end up with three different ideas of who is allowed.
   * A refusal, not an empty result: "you have no authority here" and "there is
   * nobody to show" are different facts, and returning an empty register to an
   * employee would look to them like a working feature with no data.
   */
  private assertEligible(scope: ConsoleScope): ConsoleScope {
    if (!scope.eligible) {
      throw new ForbiddenException(
        'The attendance console is available to HR, administrators, and managers or team leads with reporting employees.',
      );
    }
    return scope;
  }

  private assertDate(value: string, label = 'businessDate') {
    if (!DATE_RE.test(value ?? '')) {
      throw new BadRequestException(`${label} must be a yyyy-MM-dd date`);
    }
  }

  private enumerate(from: string, to: string): string[] {
    const out: string[] = [];
    const cursor = new Date(`${from}T12:00:00.000Z`);
    const stop = new Date(`${to}T12:00:00.000Z`);
    while (cursor.getTime() <= stop.getTime()) {
      out.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      if (out.length > MAX_RANGE_DAYS) break;
    }
    return out;
  }

  private scopeWhere(scope: ConsoleScope, extra: any = {}) {
    return scope.userIds === null ? extra : { ...extra, userId: { in: scope.userIds } };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Today
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Attendance shape for one date.
   *
   * Every count comes from stored DailyAttendance rows. Nothing is evaluated
   * here — a summary that recalculated would be a second opinion, and two
   * opinions about payroll-relevant facts is exactly what this system exists to
   * avoid.
   */
  async todaySummary(actor: any, businessDate?: string) {
    const date = businessDate ?? this.tva.companyToday();
    this.assertDate(date);
    const scope = this.assertEligible(await this.resolveScope(actor));
    const dateOnly = this.tva.companyDateOnly(new Date(`${date}T00:00:00.000Z`));

    const [employees, records, pendingRegularizations] = await Promise.all([
      this.prisma.user.findMany({
        where: this.scopeWhere(scope, { isActive: true }, ),
        select: { id: true },
      }),
      this.prisma.dailyAttendance.findMany({
        where: this.scopeWhere(scope, { date: dateOnly }),
      }),
      this.prisma.attendanceRegularization.count({
        where: this.scopeWhere(scope, { status: { in: ['PENDING', 'MANAGER_APPROVED'] } }),
      }),
    ]);

    const byStatus: Record<string, number> = {};
    const exceptions = {
      missingPunch: 0,
      missingPunchOut: 0,
      outsideGeofence: 0,
      lowAccuracy: 0,
      // null means "not worked out yet", never "nobody is blocked". A blocked
      // context produces no DailyAttendance row, so this cannot be counted from
      // stored results; it comes from the last processing run instead, and
      // stays null until one has happened.
      configurationBlocked: null as number | null,
      partialLeaveFunding: 0,
      regularizationPending: pendingRegularizations,
    };
    let needsReview = 0;
    let finalized = 0;

    for (const row of records) {
      byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
      if (row.evaluationState === 'NEEDS_REVIEW') needsReview += 1;
      if (row.evaluationState === 'FINALIZED') finalized += 1;

      const flags: string[] = (row.exceptionFlags as string[]) ?? [];
      if (flags.includes('NO_ATTENDANCE_EVIDENCE') || flags.includes('MISSING_PUNCH')) {
        exceptions.missingPunch += 1;
      }
      if (flags.includes('MISSING_PUNCH_OUT')) exceptions.missingPunchOut += 1;
      if (flags.includes('LOCATION_OUTSIDE_GEOFENCE')) exceptions.outsideGeofence += 1;
      if (flags.includes('LOCATION_LOW_ACCURACY')) exceptions.lowAccuracy += 1;
      if (flags.includes('PARTIALLY_FUNDED_LEAVE')) exceptions.partialLeaveFunding += 1;
    }

    // Employees the console can see, minus those with a stored result. These
    // are UNKNOWN, not absent.
    const evaluatedUserIds = new Set(records.map((r) => r.userId));
    const notEvaluated = employees.filter((e) => !evaluatedUserIds.has(e.id)).length;

    // Blocked employees come from the last processing run for this date, not
    // from a fresh 56-way context sweep the console would have to run to render
    // a card. Null when no run has happened, so the UI can say "unknown"
    // instead of implying zero. Filtered through the caller's scope, so a
    // manager never sees a company-wide count.
    const blocked = await this.processing.blockedFromLastRun(date);
    if (blocked !== null) {
      const visible = new Set(employees.map((e) => e.id));
      exceptions.configurationBlocked = blocked.filter((b) => visible.has(b.userId)).length;
    }

    return {
      businessDate: date,
      scope: scope.isHr ? 'COMPANY' : 'TEAM',
      expectedEmployees: employees.length,
      present: byStatus['PRESENT'] ?? 0,
      late: (byStatus['LATE'] ?? 0) + (byStatus['LATE_EXEMPTED'] ?? 0),
      leave: byStatus['LEAVE'] ?? 0,
      lwp: byStatus['LWP'] ?? 0,
      halfDay: byStatus['HALF_DAY'] ?? 0,
      absent: byStatus['ABSENT'] ?? 0,
      holiday: byStatus['HOLIDAY'] ?? 0,
      weeklyOff: byStatus['WEEKLY_OFF'] ?? 0,
      needsReview,
      finalized,
      notEvaluated,
      exceptions,
    };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Roster
  // ───────────────────────────────────────────────────────────────────────

  /** Per-employee attendance for one date, scoped and filterable. */
  async roster(
    actor: any,
    filters: {
      businessDate?: string;
      departmentId?: string;
      employeeId?: string;
      status?: string;
      evaluationState?: string;
      exception?: string;
      page?: number;
      limit?: number;
    } = {},
  ) {
    const date = filters.businessDate ?? this.tva.companyToday();
    this.assertDate(date);
    const scope = this.assertEligible(await this.resolveScope(actor));
    const dateOnly = this.tva.companyDateOnly(new Date(`${date}T00:00:00.000Z`));

    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);

    const userWhere: any = { isActive: true };
    if (scope.userIds !== null) userWhere.id = { in: scope.userIds };
    if (filters.departmentId) userWhere.departmentId = filters.departmentId;
    if (filters.employeeId) userWhere.id = filters.employeeId;

    // A manager naming an employee outside their scope gets an empty result
    // rather than a leak, because the scope filter is applied first.
    if (filters.employeeId && scope.userIds !== null && !scope.userIds.includes(filters.employeeId)) {
      return { businessDate: date, page, limit, total: 0, rows: [] };
    }

    const [total, employees] = await Promise.all([
      this.prisma.user.count({ where: userWhere }),
      this.prisma.user.findMany({
        where: userWhere,
        select: {
          id: true,
          name: true,
          email: true,
          employeeId: true,
          department: { select: { id: true, name: true } },
        },
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const records = await this.prisma.dailyAttendance.findMany({
      where: { date: dateOnly, userId: { in: employees.map((e) => e.id) } },
    });
    const byUser = new Map(records.map((r) => [r.userId, r]));

    let rows = employees.map((e) => {
      const rec = byUser.get(e.id);
      return {
        employee: e,
        // The absence of a row is stated as such, never inferred into a status.
        status: rec?.status ?? null,
        evaluationState: rec ? rec.evaluationState : 'NOT_EVALUATED',
        punchInAt: rec?.punchInAt ?? null,
        punchOutAt: rec?.punchOutAt ?? null,
        workedMinutes: rec?.workedMinutes ?? null,
        breakMinutes: rec?.breakMinutes ?? null,
        exceptionFlags: (rec?.exceptionFlags as string[]) ?? [],
        requiresReview: rec?.evaluationState === 'NEEDS_REVIEW',
        revision: rec?.revision ?? 0,
      };
    });

    if (filters.status) rows = rows.filter((r) => r.status === filters.status);
    if (filters.evaluationState) {
      rows = rows.filter((r) => r.evaluationState === filters.evaluationState);
    }
    if (filters.exception) {
      rows = rows.filter((r) => r.exceptionFlags.includes(filters.exception!));
    }

    return { businessDate: date, page, limit, total, rows };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Detail
  // ───────────────────────────────────────────────────────────────────────

  /** Everything known about one employee-date, assembled from existing sources. */
  async dayDetail(actor: any, userId: string, businessDate: string) {
    this.assertDate(businessDate);
    const scope = this.assertEligible(await this.resolveScope(actor));
    if (scope.userIds !== null && !scope.userIds.includes(userId) && actor?.id !== userId) {
      throw new ForbiddenException('You do not have permission to view this employee');
    }

    const dateOnly = this.tva.companyDateOnly(new Date(`${businessDate}T00:00:00.000Z`));

    const [official, evidence, sessions, leaves, regularizations] = await Promise.all([
      this.prisma.dailyAttendance.findUnique({ where: { userId_date: { userId, date: dateOnly } } }),
      this.prisma.attendancePunchEvidence.findMany({
        where: { userId, businessDate: dateOnly },
        orderBy: { serverOccurredAt: 'asc' },
      }),
      this.prisma.workSession.findMany({
        where: { userId, date: dateOnly },
        include: { breakLogs: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.leaveRequest.findMany({
        where: {
          userId,
          startDate: { lte: this.tva.companyDayEnd(new Date(`${businessDate}T00:00:00.000Z`)) },
          endDate: { gte: this.tva.companyDayStart(new Date(`${businessDate}T00:00:00.000Z`)) },
        },
      }),
      this.prisma.attendanceRegularization.findMany({
        where: { userId, date: dateOnly },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const presenceSpanMinutes =
      official?.punchInAt && official?.punchOutAt
        ? Math.max(
            0,
            Math.floor(
              (official.punchOutAt.getTime() - official.punchInAt.getTime()) / 60_000,
            ),
          )
        : null;

    return {
      businessDate,
      official: official
        ? {
            status: official.status,
            evaluationState: official.evaluationState,
            calculationReason: official.calculationReason,
            exceptionFlags: official.exceptionFlags,
            punchInAt: official.punchInAt,
            punchOutAt: official.punchOutAt,
            presenceSpanMinutes,
            effectiveWorkMinutes: official.workedMinutes,
            breakMinutes: official.breakMinutes,
            lateMinutes: official.lateMinutes,
            leaveDeducted: official.leaveDeducted,
            lwpDeducted: official.lwpDeducted,
            revision: official.revision,
            lastRegularizationId: official.lastRegularizationId,
            locked: official.locked,
            provenance: {
              resolverVersion: official.resolverVersion,
              evaluatorVersion: official.evaluatorVersion,
              employeeProfileId: official.employeeProfileId,
              attendancePolicyId: official.attendancePolicyId,
              attendancePolicyVersion: official.attendancePolicyVersion,
              shiftPolicyId: official.shiftPolicyId,
              shiftPolicyVersion: official.shiftPolicyVersion,
              holidayCalendarId: official.holidayCalendarId,
              weeklyOffPolicyId: official.weeklyOffPolicyId,
              holidayId: official.holidayId,
              businessDayOverrideId: official.businessDayOverrideId,
              leaveRequestId: official.leaveRequestId,
              workSessionIds: official.workSessionIds,
            },
          }
        : null,
      // Verdicts and presence facts only. Storage keys, hashes and raw
      // coordinates stay server-side; a photo is reachable only through the
      // PE-3 owner-scoped signed URL route.
      punchEvidence: evidence.map((e) => ({
        id: e.id,
        type: e.type,
        serverOccurredAt: e.serverOccurredAt,
        locationVerification: e.locationVerification,
        photoVerification: e.photoVerification,
        photoCaptured: e.photoVerification === 'CAPTURED',
        accuracyMeters: e.accuracyMeters,
      })),
      workSessions: sessions.map((s) => ({
        id: s.id,
        startWorkAt: s.startWorkAt,
        logoutAt: s.logoutAt,
        status: s.status,
        totalWorkMinutes: s.totalWorkMinutes,
        totalBreakMinutes: s.totalBreakMinutes,
        autoClosed: s.autoClosed,
        closureReason: s.closureReason,
        breaks: (s as any).breakLogs?.map((b: any) => ({
          id: b.id,
          breakType: b.breakType,
          startAt: b.startAt,
          endAt: b.endAt,
          durationMinutes: b.durationMinutes,
        })) ?? [],
      })),
      leave: leaves.map((l) => ({
        id: l.id,
        type: l.type,
        status: l.status,
        approvalStage: l.approvalStage,
        fundingOutcome: l.fundingOutcome,
        paidDays: l.paidDays,
        unpaidDays: l.unpaidDays,
        isHalfDay: l.isHalfDay,
      })),
      regularizations,
    };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Review queue
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Operational exceptions across a date range, from existing sources.
   *
   * No new status model: every item points back at the DailyAttendance row or
   * the regularization it came from.
   */
  async reviewQueue(
    actor: any,
    filters: { from?: string; to?: string; limit?: number } = {},
  ) {
    const to = filters.to ?? this.tva.companyToday();
    const from = filters.from ?? to;
    this.assertDate(from, 'from');
    this.assertDate(to, 'to');
    if (from > to) throw new BadRequestException('from must not be after to');

    const scope = this.assertEligible(await this.resolveScope(actor));
    const limit = Math.min(Math.max(filters.limit ?? 100, 1), 300);

    const [flagged, regularizations] = await Promise.all([
      this.prisma.dailyAttendance.findMany({
        where: this.scopeWhere(scope, {
          evaluationState: 'NEEDS_REVIEW',
          date: {
            gte: this.tva.companyDateOnly(new Date(`${from}T00:00:00.000Z`)),
            lte: this.tva.companyDateOnly(new Date(`${to}T00:00:00.000Z`)),
          },
        }),
        orderBy: { date: 'desc' },
        take: limit,
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
      this.prisma.attendanceRegularization.findMany({
        where: this.scopeWhere(scope, { status: { in: ['PENDING', 'MANAGER_APPROVED'] } }),
        orderBy: { createdAt: 'asc' },
        take: limit,
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
    ]);

    return {
      from,
      to,
      attendance: flagged.map((r) => ({
        source: 'DAILY_ATTENDANCE' as const,
        id: r.id,
        userId: r.userId,
        user: (r as any).user,
        businessDate: this.tva.companyBusinessDate(r.date),
        status: r.status,
        reason: r.calculationReason,
        exceptionFlags: r.exceptionFlags,
      })),
      regularizations: regularizations.map((r) => ({
        source: 'REGULARIZATION' as const,
        id: r.id,
        userId: r.userId,
        user: (r as any).user,
        businessDate: this.tva.companyBusinessDate(r.date),
        requestType: r.requestType,
        reason: r.reason,
        stage: r.status,
      })),
    };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Monthly register
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Per-employee monthly totals, counted from stored classifications.
   *
   * The evaluator is not run here. Days with no stored result are reported as
   * notEvaluated and are excluded from the attendance percentage's denominator,
   * which is stated explicitly rather than left to be inferred.
   */
  async monthlyRegister(
    actor: any,
    filters: { from?: string; to?: string; departmentId?: string } = {},
  ) {
    const today = this.tva.companyToday();
    const from = filters.from ?? `${today.slice(0, 7)}-01`;
    const to = filters.to ?? today;
    this.assertDate(from, 'from');
    this.assertDate(to, 'to');
    if (from > to) throw new BadRequestException('from must not be after to');

    const dates = this.enumerate(from, to);
    if (dates.length > MAX_RANGE_DAYS) {
      throw new BadRequestException(`Range is limited to ${MAX_RANGE_DAYS} days`);
    }

    const scope = this.assertEligible(await this.resolveScope(actor));
    const userWhere: any = { isActive: true };
    if (scope.userIds !== null) userWhere.id = { in: scope.userIds };
    if (filters.departmentId) userWhere.departmentId = filters.departmentId;

    const employees = await this.prisma.user.findMany({
      where: userWhere,
      select: { id: true, name: true, employeeId: true, department: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });

    const records = await this.prisma.dailyAttendance.findMany({
      where: {
        userId: { in: employees.map((e) => e.id) },
        date: {
          gte: this.tva.companyDateOnly(new Date(`${from}T00:00:00.000Z`)),
          lte: this.tva.companyDateOnly(new Date(`${to}T00:00:00.000Z`)),
        },
      },
    });

    const byUser = new Map<string, any[]>();
    for (const r of records) {
      const list = byUser.get(r.userId) ?? [];
      list.push(r);
      byUser.set(r.userId, list);
    }

    // ── Working days, from the business calendar rather than counted rows ──
    //
    // Two different numbers, and conflating them is the bug this guards
    // against:
    //
    //   workingDays  every scheduled working day in the MONTH. What HR sees
    //                top-right. On the 1st of the month it is still 22.
    //   eligible     working days that have actually ELAPSED. What the
    //                percentage is measured against.
    //
    // Using the month total as a denominator on the 1st would report everybody
    // at 4% and read as a system-wide failure.
    // A range normally sits inside one month, but nothing forces that, so
    // every month it touches is classified rather than silently assuming the
    // first one covers the rest.
    const months = Array.from(new Set(dates.map((d) => d.slice(0, 7))));
    const classified = await Promise.all(
      months.map((m) => {
        const [y, mo] = m.split('-');
        return this.businessCalendar.classifyMonth(Number(y), Number(mo));
      }),
    );
    const calendarDays = classified.flatMap((c) => c.days);
    const workingDays = classified.reduce((n, c) => n + c.workingDays, 0);

    // ELAPSED STOPS AT TODAY, whatever the caller asked for.
    //
    // The console requests a whole month, so on the 1st the range still runs to
    // the 30th. Measuring against that would charge every employee with 21
    // absences they have not had the chance to avoid, and the register would
    // read as a company-wide collapse on the morning it is first opened.
    const elapsedThrough = to < today ? to : today;
    const elapsedWorkingDates = new Set(
      calendarDays
        .filter(
          (d) => d.isWorkingDay && d.businessDate >= from && d.businessDate <= elapsedThrough,
        )
        .map((d) => d.businessDate),
    );

    // ── Leave balance, from the one service that already defines it ────────
    //
    // Reused rather than recomputed: adding leave types together here would
    // create a second, quietly different answer to "how much leave is left".
    //
    // THE ARGUMENT IS A FINANCIAL YEAR, NOT A CALENDAR YEAR. Leave runs April
    // to March, so a March 2027 register belongs to FY 2026-27 and a calendar
    // year read from the date string would ask for FY 2027-28 -- an entitlement
    // that has not started. Nine months of the year the two agree, which is
    // exactly why the wrong one survives testing.
    //
    // financialYear().startYear is also what LeaveService.getUserBalance()
    // passes for the employee's own leave page, so HR and the employee are
    // never shown different balances for the same person.
    const balanceYear = this.tva.financialYear(new Date(`${from}T00:00:00.000Z`)).startYear;

    // Per-employee and several queries each, so it runs in bounded batches --
    // 34 sequential round trips is the pattern that makes a monthly page feel
    // broken.
    const balanceByUser = new Map<string, number | null>();
    const BATCH = 8;
    for (let i = 0; i < employees.length; i += BATCH) {
      const slice = employees.slice(i, i + BATCH);
      const settled = await Promise.all(
        slice.map((e) =>
          this.leaveBalance
            .getLeaveBalance(e.id, balanceYear)
            .then((b: any) => b?.balance ?? null)
            // One employee's leave data must not blank the whole register.
            .catch(() => null),
        ),
      );
      slice.forEach((e, n) => balanceByUser.set(e.id, settled[n]));
    }

    const rows = employees.map((e) => {
      const mine = byUser.get(e.id) ?? [];

      // THE REGISTER COUNTS ELAPSED WORKING DAYS, NOTHING ELSE.
      //
      // Stored rows only exist for evaluated days, so future dates would
      // usually fall out anyway -- but "usually" is not a guarantee, and a
      // single stray future ABSENT row would put a fabricated absence against
      // a real employee's name in a file HR sends on. The filter states the
      // rule instead of inheriting it.
      const applicable = mine.filter((r) =>
        elapsedWorkingDates.has(this.tva.companyBusinessDate(r.date)),
      );
      const count = (status: string) => applicable.filter((r) => r.status === status).length;

      // A late arrival is still an attended day. Lateness is reported in its
      // own column rather than deducted twice.
      const present = count('PRESENT') + count('LATE') + count('LATE_EXEMPTED');
      const leave = count('LEAVE');
      const lwp = count('LWP');
      const halfDay = count('HALF_DAY');
      const absent = count('ABSENT');
      const weeklyOff = mine.filter((r) => r.status === 'WEEKLY_OFF').length;
      const holiday = mine.filter((r) => r.status === 'HOLIDAY').length;
      const needsReview = applicable.filter((r) => r.evaluationState === 'NEEDS_REVIEW').length;
      const notEvaluated = Math.max(0, elapsedWorkingDates.size - applicable.length);

      // Late is read from the ATTENDANCE punch, not a Workday session start.
      // They are different facts and only this one is policy.
      const latePunchIns = applicable.filter(
        (r) =>
          r.punchInAt &&
          formatInTimeZone(r.punchInAt, this.tva.companyTimezone(), 'HH:mm:ss') > LATE_AFTER,
      ).length;

      // Approved full-day leave leaves the denominator entirely: an employee
      // on sanctioned leave has not failed to attend, and counting it against
      // them is the unfairness this formula exists to avoid.
      const eligibleWorkingDays = Math.max(0, elapsedWorkingDates.size - leave);
      const credit = present + halfDay * 0.5;

      return {
        userId: e.id,
        name: e.name,
        employeeId: e.employeeId,
        department: e.department?.name ?? null,

        // ── The seven register figures ──
        daysPresent: present,
        daysAbsent: absent,
        halfDays: halfDay,
        leaveBalance: balanceByUser.get(e.id) ?? null,
        latePunchIns,
        // Null, never 0 or NaN: with nothing to measure, a percentage is not a
        // low score, it is an absent one.
        attendanceCompletionPercentage:
          eligibleWorkingDays > 0
            ? Number(((credit / eligibleWorkingDays) * 100).toFixed(2))
            : null,

        // ── Working figures, not shown in the register ──
        eligibleWorkingDays,
        leaveDays: leave,
        lwp,
        weeklyOff,
        holiday,
        needsReview,
        notEvaluated,
      };
    });

    return {
      from,
      to,
      days: dates.length,
      month: months[0],
      // The full month, deliberately -- see the note above.
      workingDays,
      elapsedWorkingDays: elapsedWorkingDates.size,
      /**
       * Which financial year the Leave Balance column is answering for.
       *
       * Stated rather than assumed. Leave runs April to March while the
       * register is named after a calendar month, so for January, February and
       * March the two disagree -- and a balance is not a number anyone can
       * check without knowing the period it covers.
       */
      leaveBalanceFinancialYear: `${balanceYear}-${balanceYear + 1}`,
      /**
       * Whether the working-day total can be trusted.
       *
       * A month whose weekly-off policy could not be resolved counts Sundays
       * as working days. The register still renders -- refusing to show
       * anything helps nobody -- but it says so instead of presenting a wrong
       * total as a fact.
       */
      calendarResolved:
        classified.every(
          (c) => c.sources.weeklyOffPolicy !== 'NONE' && c.sources.weeklyOffPolicy !== 'AMBIGUOUS',
        ),
      // ONE result. The table, the workbook and the CSV all read this array;
      // none of them recomputes a figure. Three implementations of the same
      // formula is three chances for HR to be handed three different answers.
      employees: rows,
    };
  }

  /**
   * The register as a downloadable file.
   *
   * Calls monthlyRegister() and renders what it returns. The workbook and the
   * CSV are two encodings of ONE result, not two reports -- neither exporter
   * queries anything or recomputes a figure, so a number in the spreadsheet
   * cannot disagree with the number HR was looking at when they pressed the
   * button. Scope and authorization come from the same call, so an export can
   * never reach further than the screen.
   */
  async exportRegister(
    actor: any,
    filters: { from?: string; to?: string; departmentId?: string },
    format: 'xlsx' | 'csv',
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const result = (await this.monthlyRegister(actor, filters)) as unknown as RegisterResult;

    if (format === 'csv') {
      return {
        buffer: Buffer.from(registerCsv(result), 'utf8'),
        filename: registerFileName(result.month, 'csv'),
        contentType: 'text/csv; charset=utf-8',
      };
    }

    const wb = buildRegisterWorkbook(result, this.tva.now());
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return {
      buffer,
      filename: registerFileName(result.month, 'xlsx'),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Commands
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Runs the existing evaluator over a bounded set of employee-days.
   *
   * HR/Admin only, explicit, idempotent and audited. It calls
   * evaluateAndPersist() and nothing else: there is no second evaluation path
   * for the later scheduler to diverge from.
   *
   * One employee failing never abandons the rest — failures are collected and
   * reported so a single misconfigured profile cannot block a whole run.
   */
  async runEvaluation(
    actor: any,
    input: {
      employeeId?: string;
      departmentId?: string;
      businessDate?: string;
      startDate?: string;
      endDate?: string;
      finalize?: boolean;
    },
  ): Promise<EvaluationCommandResult> {
    if (!this.accessPolicy.isHrOrAdmin(actor)) {
      throw new ForbiddenException('Only HR can run attendance evaluation');
    }

    const from = input.startDate ?? input.businessDate ?? this.tva.companyToday();
    const to = input.endDate ?? input.businessDate ?? from;
    this.assertDate(from, 'startDate');
    this.assertDate(to, 'endDate');
    if (from > to) throw new BadRequestException('startDate must not be after endDate');

    const dates = this.enumerate(from, to);
    if (dates.length > MAX_RANGE_DAYS) {
      throw new BadRequestException(`Range is limited to ${MAX_RANGE_DAYS} days`);
    }

    const userWhere: any = { isActive: true };
    if (input.employeeId) userWhere.id = input.employeeId;
    if (input.departmentId) userWhere.departmentId = input.departmentId;

    const employees = await this.prisma.user.findMany({
      where: userWhere,
      select: { id: true },
    });

    const units = employees.length * dates.length;
    if (units > MAX_EVALUATION_UNITS) {
      throw new BadRequestException(
        `This would evaluate ${units} employee-days. Narrow the range or the selection (limit ${MAX_EVALUATION_UNITS}).`,
      );
    }

    const result: EvaluationCommandResult = {
      businessDates: dates,
      requested: units,
      evaluated: 0,
      unchanged: 0,
      skipped: 0,
      failed: [],
    };

    for (const employee of employees) {
      for (const businessDate of dates) {
        try {
          const out = await this.evaluator.evaluateAndPersist(employee.id, businessDate);
          if (out.persisted) result.evaluated += 1;
          else if (out.reason === 'UNCHANGED') result.unchanged += 1;
          else result.skipped += 1;
        } catch (err: any) {
          result.failed.push({
            userId: employee.id,
            businessDate,
            error: err?.message ?? 'Evaluation failed',
          });
        }
      }
    }

    this.eventLogger.log({
      actorId: actor.id,
      entityType: 'DailyAttendance',
      entityId: `run:${from}:${to}`,
      action: OperationalAction.ATTENDANCE_EVALUATION_RUN,
      // Counts only. No employee-level evidence, no coordinates, no photo keys.
      metadata: {
        from,
        to,
        employees: employees.length,
        requested: result.requested,
        evaluated: result.evaluated,
        unchanged: result.unchanged,
        skipped: result.skipped,
        failed: result.failed.length,
      },
    }).catch(() => {});

    return result;
  }

  /** Explicit HR finalization of one employee-date, through the existing service. */
  async finalize(actor: any, userId: string, businessDate: string) {
    if (!this.accessPolicy.isHrOrAdmin(actor)) {
      throw new ForbiddenException('Only HR can finalize attendance');
    }
    this.assertDate(businessDate);

    const outcome = await this.evaluator.finalize(userId, businessDate);

    if (outcome.finalized) {
      this.eventLogger.log({
        actorId: actor.id,
        entityType: 'DailyAttendance',
        entityId: (outcome as any).record?.id ?? `${userId}:${businessDate}`,
        action: OperationalAction.ATTENDANCE_FINALIZED,
        fromState: 'CALCULATED',
        toState: 'FINALIZED',
        metadata: { businessDate },
      }).catch(() => {});
    }

    return outcome;
  }

  /**
   * Whether this actor may operate the console at all.
   *
   * The one read that ANSWERS instead of refusing. It is a capability probe:
   * the screen asks "may I?" on load, and a 403 to that question would make an
   * employee's Attendance page fail rather than simply not offer a console they
   * were never meant to see. Every endpoint that returns actual attendance data
   * refuses, which is where the refusal belongs.
   */
  async canOperate(actor: any): Promise<{ isHr: boolean; hasTeam: boolean }> {
    const scope = await this.resolveScope(actor);
    return {
      isHr: scope.isHr,
      hasTeam: scope.eligible && (scope.userIds === null || scope.userIds.length > 0),
    };
  }
}
