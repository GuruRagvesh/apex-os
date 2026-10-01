import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { formatInTimeZone } from 'date-fns-tz';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TVAService } from '../../../../common/services/tva.service';
import { AccessPolicyService } from '../../../../common/services/access-policy.service';
import { BusinessCalendarService } from '../calendar/business-calendar.service';
import {
  employmentOnDate,
  LATE_CUTOFF_SETTING_KEY,
  parseConfiguredCutoff,
  resolveLateCutoff,
  resolveRequiredPresence,
} from '../shared/attendance-primitives';
import {
  buildMonthReport,
  type DayInput,
  type MonthReport,
  type ReportEmployee,
} from './attendance-report';

/**
 * THE ONE SERVICE THAT ASSEMBLES A MONTH OF ATTENDANCE FOR READING.
 *
 * It reads facts and hands them to attendance-report.ts, which decides how to
 * present them. It makes no attendance decision of its own, and it NEVER
 * evaluates: a finalized month must show what was finalized, so every official
 * value here comes from the stored DailyAttendance row rather than from a fresh
 * evaluation. GET /attendance/daily re-evaluates history live and is why a
 * closed month can display differently from what Finance received; this path
 * deliberately does not.
 *
 * Both the Attendance Console and the workbook download read this, so there is
 * one dataset behind both and they cannot disagree.
 *
 * WHO APPEARS is decided by employment window overlap and then per date by
 * employmentOnDate(), the same primitive the backfill uses -- not by today's
 * isActive flag, which used to drop anybody who had since left from the month
 * they actually worked.
 */
@Injectable()
export class AttendanceReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
    private readonly accessPolicy: AccessPolicyService,
    private readonly businessCalendar: BusinessCalendarService,
  ) {}

  private assertMonth(month: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new BadRequestException('month must be yyyy-MM');
    }
  }

  private bounds(month: string) {
    const [y, m] = month.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}`, y, m };
  }

  private dates(from: string, to: string): string[] {
    const out: string[] = [];
    const cursor = new Date(`${from}T12:00:00.000Z`);
    const stop = new Date(`${to}T12:00:00.000Z`);
    while (cursor.getTime() <= stop.getTime()) {
      out.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return out;
  }

  /** Minutes past midnight in company time, for the lateness comparison. */
  private arrivalMinutes(at: Date | null): number | null {
    if (!at) return null;
    const hhmm = formatInTimeZone(at, this.tva.companyTimezone(), 'HH:mm');
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  }

  /**
   * The whole month, for every employee the actor may see.
   *
   * One pass: read the facts in bulk, then build both datasets from them.
   */
  async monthReport(
    actor: any,
    month: string,
    /**
     * Pins the report's instant instead of reading the clock.
     *
     * The month-close lifecycle passes the stored finalizedAt so a finalized
     * month renders identically every time it is regenerated -- a live clock
     * would print a different "generated at" on each download and change the
     * bytes. Omitted, it is now().
     */
    generatedAt?: Date,
  ): Promise<MonthReport> {
    if (!this.accessPolicy.isHrOrAdmin(actor)) {
      throw new ForbiddenException('Only HR can read the attendance report');
    }
    this.assertMonth(month);

    const { from, to, y, m } = this.bounds(month);
    const dates = this.dates(from, to);
    const gte = this.tva.companyDateOnly(new Date(`${from}T12:00:00.000Z`));
    const lte = this.tva.companyDateOnly(new Date(`${to}T12:00:00.000Z`));

    // Candidates by employment-window overlap. A superset: employmentOnDate
    // rules on each date below, so this can only be too generous.
    const employees = await this.prisma.user.findMany({
      where: {
        AND: [
          {
            OR: [
              { joiningDate: null },
              { joiningDate: { lte: new Date(`${to}T23:59:59.999Z`) } },
            ],
          },
          {
            OR: [
              { lastWorkingDate: null },
              { lastWorkingDate: { gte: new Date(`${from}T00:00:00.000Z`) } },
            ],
          },
        ],
      },
      select: {
        id: true,
        name: true,
        employeeId: true,
        designation: true,
        employmentType: true,
        joiningDate: true,
        lastWorkingDate: true,
        department: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
    });

    const ids = employees.map((e) => e.id);
    const empty = { records: [], punches: [], sessions: [], leaves: [], regs: [] };
    const fetched = ids.length
      ? await Promise.all([
          this.prisma.dailyAttendance.findMany({
            where: { userId: { in: ids }, date: { gte, lte } },
            orderBy: [{ userId: 'asc' }, { date: 'asc' }],
          }),
          this.prisma.attendancePunchEvidence.findMany({
            where: { userId: { in: ids }, businessDate: { gte, lte } },
            select: { userId: true, businessDate: true, type: true, serverOccurredAt: true },
            orderBy: { serverOccurredAt: 'asc' },
          }),
          this.prisma.workSession.findMany({
            where: { userId: { in: ids }, date: { gte, lte } },
            select: {
              userId: true, date: true, startWorkAt: true, logoutAt: true,
              totalWorkMinutes: true, totalBreakMinutes: true, autoClosed: true,
            },
          }),
          this.prisma.leaveRequest.findMany({
            where: {
              userId: { in: ids },
              status: 'APPROVED',
              startDate: { lte: new Date(`${to}T23:59:59.999Z`) },
              endDate: { gte: new Date(`${from}T00:00:00.000Z`) },
            },
            select: { userId: true, type: true, startDate: true, endDate: true, isHalfDay: true },
          }),
          this.prisma.attendanceRegularization.findMany({
            where: { userId: { in: ids }, date: { gte, lte } },
            select: {
              userId: true, date: true, status: true,
              requestedPunchIn: true, requestedPunchOut: true, entrySource: true,
            },
          }),
        ])
      : [empty.records, empty.punches, empty.sessions, empty.leaves, empty.regs];

    const [records, punches, sessions, leaves, regs] = fetched as any[];

    // The requirement that applied, from each row's OWN stored provenance --
    // never from today's policy, which may have been edited since.
    const policyIds = [...new Set(records.map((r: any) => r.attendancePolicyId).filter(Boolean))];
    const shiftIds = [...new Set(records.map((r: any) => r.shiftPolicyId).filter(Boolean))];
    const [policies, shifts] = await Promise.all([
      // NO `as any` HERE, DELIBERATELY. An earlier version selected
      // `officialStartTime` and `graceMinutes` from AttendancePolicy behind a
      // cast. Neither exists on this schema, so the cast compiled happily and
      // would have made Late Arrival read "—" for every employee forever. The
      // compiler checks these selects now, which is the only reason that class
      // of mistake cannot come back.
      //
      // ONLY minimumWorkingMinutes IS TAKEN FROM THE SHIFT. startTime and
      // graceMinutes used to be selected here to build the arrival threshold
      // and are no longer read: the cutoff is one company value, resolved
      // above. They are dropped rather than left selected, so nothing suggests
      // this query still has a say in lateness.
      policyIds.length
        ? this.prisma.attendancePolicy.findMany({
            where: { id: { in: policyIds as string[] } },
            select: { id: true, minimumWorkingMinutes: true },
          })
        : Promise.resolve([]),
      shiftIds.length
        ? this.prisma.shiftPolicy.findMany({
            where: { id: { in: shiftIds as string[] } },
            select: { id: true, minimumWorkingMinutes: true },
          })
        : Promise.resolve([]),
    ]);
    const policyById = new Map((policies as any[]).map((p) => [p.id, p]));
    const shiftById = new Map((shifts as any[]).map((s) => [s.id, s]));

    // THE LATE CUTOFF, RESOLVED ONCE FOR THE WHOLE REPORT.
    //
    // Once, above the per-employee loop, because it is a company figure: one
    // report cannot hold two cutoffs, and resolving it per row is how a
    // company-wide rule turns back into a per-employee one by accident.
    //
    // Read straight from the setting row rather than through SettingsService,
    // which would mean importing SettingsModule and with it EmailModule into a
    // module whose whole design note is that it stays thin. The key and the
    // parsing both live in attendance-primitives, so there is still one owner.
    //
    // A missing or unreadable setting is not an error: resolveLateCutoff()
    // returns the company fallback and labels where it came from, so a report
    // never fails to render over a configuration row.
    const cutoffSetting = await this.prisma.appSetting
      .findUnique({ where: { key: LATE_CUTOFF_SETTING_KEY }, select: { value: true } })
      .catch(() => null);
    const lateCutoff = resolveLateCutoff(
      cutoffSetting ? parseConfiguredCutoff((cutoffSetting as any).value) : undefined,
    );

    // The calendar, resolved ONCE for the month. `sources` says whether it
    // could be established at all: when it could not, the day reports
    // "Calendar not confirmed" rather than guessing that every Sunday was a
    // working day.
    const calendar = await this.businessCalendar.classifyMonth(y, m).catch(() => null);
    const calendarConfirmed =
      !!calendar && (calendar as any).sources?.weeklyOffPolicy?.resolved !== false;
    const workingByDate = new Map<string, boolean>();
    for (const d of calendar?.days ?? []) workingByDate.set(d.businessDate, d.isWorkingDay);

    // Index the facts by userId|date so assembly is a lookup rather than a scan.
    const key = (userId: string, date: string) => `${userId}|${date}`;
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    const recordByKey = new Map<string, any>();
    for (const r of records) recordByKey.set(key(r.userId, iso(r.date)), r);

    const punchesByKey = new Map<string, Array<{ type: string; occurredAt: Date }>>();
    for (const p of punches) {
      const k = key(p.userId, iso(p.businessDate));
      const list = punchesByKey.get(k) ?? [];
      list.push({ type: p.type as string, occurredAt: p.serverOccurredAt });
      punchesByKey.set(k, list);
    }

    const sessionsByKey = new Map<string, any[]>();
    for (const s of sessions) {
      const k = key(s.userId, iso(s.date));
      const list = sessionsByKey.get(k) ?? [];
      list.push(s);
      sessionsByKey.set(k, list);
    }

    const regByKey = new Map<string, any>();
    for (const r of regs) regByKey.set(key(r.userId, iso(r.date)), r);

    // A leave is a range; expand it to the days it covers.
    const leaveByKey = new Map<string, { type: string; isHalfDay: boolean }>();
    for (const l of leaves) {
      for (const date of dates) {
        if (date >= iso(l.startDate) && date <= iso(l.endDate)) {
          leaveByKey.set(key(l.userId, date), {
            type: l.type as string,
            isHalfDay: !!l.isHalfDay,
          });
        }
      }
    }

    const reportEmployees: ReportEmployee[] = employees.map((e) => ({
      userId: e.id,
      name: e.name,
      employeeId: e.employeeId,
      department: e.department?.name ?? null,
      designation: e.designation,
      employeeType: e.employmentType,
    }));

    const daysByUser = new Map<string, DayInput[]>();
    for (const e of employees) {
      const joining = e.joiningDate ? this.tva.companyBusinessDate(e.joiningDate) : null;
      const lastWorking = e.lastWorkingDate
        ? this.tva.companyBusinessDate(e.lastWorkingDate)
        : null;

      const list: DayInput[] = [];
      for (const date of dates) {
        const k = key(e.id, date);
        const official = recordByKey.get(k) ?? null;
        const reg = regByKey.get(k) ?? null;

        const shift = official?.shiftPolicyId ? shiftById.get(official.shiftPolicyId) : undefined;
        const policy = official?.attendancePolicyId
          ? policyById.get(official.attendancePolicyId)
          : undefined;

        // Null when the day names no policy we can still resolve: the
        // requirement is then UNRESOLVED rather than a number nobody set.
        const requirement =
          shift === undefined && policy === undefined
            ? null
            : resolveRequiredPresence(
                shift?.minimumWorkingMinutes,
                policy?.minimumWorkingMinutes,
              ).minutes;

        const punchList = punchesByKey.get(k) ?? [];
        const firstIn =
          punchList.find((p) => p.type === 'PUNCH_IN')?.occurredAt ??
          official?.punchInAt ??
          null;

        list.push({
          date,
          employment: employmentOnDate(joining, lastWorking, date),
          workingDay: calendarConfirmed ? (workingByDate.get(date) ?? null) : null,
          inExtract: true,
          official: official
            ? {
                status: official.status,
                evaluationState: official.evaluationState,
                punchInAt: official.punchInAt,
                punchOutAt: official.punchOutAt,
                workedMinutes: official.workedMinutes,
                breakMinutes: official.breakMinutes,
                lateMinutes: official.lateMinutes,
                leaveDeducted: official.leaveDeducted,
                lwpDeducted: official.lwpDeducted,
                exceptionFlags: official.exceptionFlags ?? [],
                regularizationId: official.lastRegularizationId ?? null,
                viaManualRecovery: reg?.entrySource === 'MANUAL_RECOVERY',
              }
            : null,
          rawPunches: punchList,
          workSessions: (sessionsByKey.get(k) ?? []).map((s) => ({
            startWorkAt: s.startWorkAt,
            logoutAt: s.logoutAt,
            totalWorkMinutes: s.totalWorkMinutes,
            totalBreakMinutes: s.totalBreakMinutes,
            autoClosed: !!s.autoClosed,
          })),
          leave: leaveByKey.get(k) ?? null,
          compOff: leaveByKey.get(k)?.type === 'COMP_OFF',
          regularization: reg
            ? {
                status:
                  reg.status === 'HR_APPROVED' || reg.status === 'APPROVED'
                    ? 'APPROVED'
                    : reg.status === 'REJECTED'
                      ? 'REJECTED'
                      : 'PENDING',
                // A correction whose punch-out precedes its punch-in cannot be
                // applied. Reported, never used.
                invalid:
                  !!reg.requestedPunchIn &&
                  !!reg.requestedPunchOut &&
                  reg.requestedPunchOut.getTime() <= reg.requestedPunchIn.getTime(),
              }
            : null,
          requiredMinutes: requirement,
          // THE COMPANY CUTOFF, THE SAME ONE FOR EVERY ROW IN THIS REPORT.
          //
          // Resolved once per report, above the loop, not per employee -- which
          // is the whole content of the decision. This line previously read
          // `shift?.startTime`, deriving the cutoff from each employee's own
          // shift, and the comment that stood here argued against a company
          // default on the grounds that it was "how the console's hardcoded
          // 10:30 came to be applied to everybody".
          //
          // THAT REASONING WAS OVERRULED, AND THE DISTINCTION IT MISSED IS THE
          // POINT: the console's defect was that 10:30 was HARDCODED IN A
          // SERVICE, not that it was company-wide. Company-wide is what the
          // company means by late. One resolved, configurable value applied
          // uniformly is the fix for the hardcoding; per-employee thresholds
          // were a different rule nobody asked for.
          arrivalThreshold: lateCutoff.clock,
          // ZERO, AND NOT shift.graceMinutes. The cutoff has the grace baked
          // in -- see COMPANY_LATE_CUTOFF_FALLBACK. Adding a shift's grace on
          // top would move some employees' cutoff to 11:00 and put back the
          // per-person variation this change removes.
          arrivalGraceMinutes: 0,
          arrivalMinutes: this.arrivalMinutes(firstIn),
        });
      }
      daysByUser.set(e.id, list);
    }

    return buildMonthReport({
      month,
      generatedAt: generatedAt ?? this.tva.now(),
      employees: reportEmployees,
      daysByUser,
      timeFormatter: (d: Date) => formatInTimeZone(d, this.tva.companyTimezone(), 'HH:mm'),
      lateCutoff,
    });
  }
}
