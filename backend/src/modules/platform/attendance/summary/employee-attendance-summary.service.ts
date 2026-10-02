import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TVAService } from '../../../../common/services/tva.service';
import { AccessPolicyService } from '../../../../common/services/access-policy.service';
import { DailyContextService } from '../context/daily-context.service';
import { DailyAttendanceEvaluatorService } from '../evaluation/daily-attendance-evaluator.service';
// BOTH FROM THE CANONICAL PRIMITIVES, and that is the reconciliation.
//
// This imported resolveRequiredPresence from attendance/settings, which is a
// SECOND copy of the same resolver -- the canonical one lives in
// shared/attendance-primitives and is what the register, the evaluator and the
// display classifier all read. Two copies of "how long must this person be
// present" is the duplication this whole architecture exists to remove, and
// nothing linked them, so they could answer differently and no test would
// notice.
//
// minutesOfDay came from attendance/vnext; clockToMinutes in the primitives is
// the same function with the same contract, already used by the late rule.
import {
  clockToMinutes,
  resolveRequiredPresence,
} from '../shared/attendance-primitives';
import {
  averageTimeMetrics,
  computeTenure,
  officePresenceMinutes,
  summariseMonth,
  type AttendanceDayFacts,
  type DailyAttendanceStatus,
  type EvaluationState,
} from './employee-attendance-summary';

const MONTH_RE = /^\d{4}-\d{2}$/;

/**
 * Which of the evaluator's own calculationReason values mean "never an
 * attendance day for this person", matching unofficial()'s own mapping in
 * DailyAttendanceEvaluatorService exactly -- CONTEXT_BLOCKED (a real
 * configuration gap) is deliberately excluded.
 */
const NOT_APPLICABLE_REASONS = new Set(['NOT_APPLICABLE_EXEMPT', 'NOT_APPLICABLE_NOT_EMPLOYED']);

/**
 * The employee Attendance dashboard's ONE composed read.
 *
 * WHAT THIS DOES NOT OWN. Header identity (name/employeeId/designation),
 * leave balance and Comp Off each already have their own authoritative,
 * already-tested read endpoint -- GET /users/:id/profile, GET /leave/balance,
 * GET /leave/comp-off/me. Duplicating their masking and authorization logic
 * here would be a second, divergence-prone copy of each; the frontend calls
 * those three directly. This service owns exactly the composition that does
 * NOT already exist anywhere: a month of DailyAttendance turned into counts
 * and averages, today's live state, and the required-presence figure --
 * reusing the SAME resolver and the SAME evaluator every other Attendance
 * surface in this codebase reads from, never a second interpretation.
 *
 * HISTORICAL MONTHS READ PERSISTED TRUTH. A day the nightly cron has already
 * evaluated has a DailyAttendance row; that row -- not a fresh
 * evaluator.evaluate() call -- is what a past month must be built from, or a
 * policy change since that day would silently rewrite what already happened.
 * Only a date with NO ROW YET (today, before tonight's cron) falls back to a
 * live, read-only evaluate() -- the same thing GET /attendance/daily/today
 * already does.
 */
@Injectable()
export class EmployeeAttendanceSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
    private readonly accessPolicy: AccessPolicyService,
    private readonly dailyContext: DailyContextService,
    private readonly evaluator: DailyAttendanceEvaluatorService,
  ) {}

  /**
   * Authority for viewing somebody else's summary. Self always allowed; the
   * same canViewUser rule the profile endpoint already enforces otherwise --
   * one authority, read from one place, not re-derived here.
   */
  private async assertMayView(requesterId: string, targetUserId: string): Promise<void> {
    if (requesterId === targetUserId) return;
    const requester = await this.prisma.user.findUnique({
      where: { id: requesterId },
      include: { role: true, department: true },
    });
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      include: { role: true, department: true },
    });
    if (!target) throw new NotFoundException('Employee not found');
    if (!requester) throw new ForbiddenException('Not authorized');
    const allowed = await this.accessPolicy.canViewUser(requester, target);
    if (!allowed) throw new ForbiddenException('You do not have permission to view this Attendance summary');
  }

  async summary(requesterId: string, targetUserId: string, month?: string) {
    await this.assertMayView(requesterId, targetUserId);

    const resolvedMonth = month ?? this.tva.companyToday().slice(0, 7);
    if (!MONTH_RE.test(resolvedMonth)) {
      throw new ForbiddenException('month must be yyyy-MM');
    }

    const [year, mon] = resolvedMonth.split('-').map(Number);
    const monthStart = `${resolvedMonth}-01`;
    const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
    const today = this.tva.companyToday();
    // Never past today -- a "month" spanning into the future has no days to
    // evaluate yet, not a string of ABSENT ones.
    const monthEndCandidate = `${resolvedMonth}-${String(daysInMonth).padStart(2, '0')}`;
    const monthEnd = monthEndCandidate > today ? today : monthEndCandidate;
    const isFutureMonth = monthStart > today;

    const [user, context, existingRows, pendingRegularizations] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: targetUserId },
        select: {
          id: true, name: true, employeeId: true, designation: true,
          joiningDate: true, lastWorkingDate: true, isActive: true,
          department: { select: { id: true, name: true } },
        },
      }),
      this.dailyContext.resolveDailyContext(targetUserId, new Date(`${monthStart}T00:00:00.000Z`)),
      isFutureMonth
        ? Promise.resolve([])
        : this.prisma.dailyAttendance.findMany({
            where: {
              userId: targetUserId,
              date: {
                gte: this.tva.companyDateOnly(new Date(`${monthStart}T00:00:00.000Z`)),
                lte: this.tva.companyDateOnly(new Date(`${monthEnd}T00:00:00.000Z`)),
              },
            },
          }),
      this.prisma.attendanceRegularization.count({
        where: { userId: targetUserId, status: { in: ['PENDING', 'MANAGER_APPROVED'] } },
      }),
    ]);
    if (!user) throw new NotFoundException('Employee not found');

    const byDate = new Map(existingRows.map((r) => [r.date.toISOString().slice(0, 10), r]));

    const requiredPresenceMinutes = resolveRequiredPresence(
      context.shift?.minimumWorkingMinutes ?? null,
      context.attendancePolicy?.minimumWorkingMinutes ?? null,
    ).minutes;
    // THE SHIFT START, AND ONLY FOR THE COMPLETION PROJECTION. This feeds
    // "when will nine hours be done", which legitimately depends on when the
    // day is expected to start -- you cannot complete a shift before it
    // begins. It is NOT the late rule: lateness is one company cutoff, decided
    // on the context, and deriving it from the shift here would reintroduce
    // per-employee lateness through the back door.
    const officialStartMinutes = context.shift
      ? clockToMinutes(context.shift.startTime)
      : null;

    const dates = isFutureMonth ? [] : enumerateDates(monthStart, monthEnd);
    const facts: AttendanceDayFacts[] = [];
    let todayLiveResult: AttendanceDayFacts | null = null;

    for (const businessDate of dates) {
      const row = byDate.get(businessDate);
      if (row) {
        facts.push(toDayFacts(businessDate, row));
        continue;
      }
      if (businessDate === today) {
        // No row yet -- tonight's cron has not run. A live, READ-ONLY
        // evaluation, exactly what /attendance/daily/today already returns.
        const live = await this.evaluator.evaluate(targetUserId, businessDate);
        // live.status is already null for an unofficial day (exempt, not yet
        // employed, blocked context) -- see DailyAttendanceEvaluatorService's
        // own unofficial() builder. Passed through directly, not re-derived.
        // calculationReason distinguishes EXEMPT/NOT_EMPLOYED (not a gap) from
        // CONTEXT_BLOCKED (a real one) among those null-status days.
        const day: AttendanceDayFacts = {
          businessDate,
          status: live.status,
          evaluationState: live.evaluationState as EvaluationState,
          punchInAt: live.punchInAt,
          punchOutAt: live.punchOutAt,
          workedMinutes: live.workedMinutes,
          breakMinutes: live.breakMinutes,
          lateMinutes: live.lateMinutes,
          locked: false,
          notApplicable: NOT_APPLICABLE_REASONS.has(live.calculationReason),
        };
        facts.push(day);
        todayLiveResult = day;
        continue;
      }
      // A past date with no persisted row at all -- evaluateAndPersist()
      // never writes one for a day that was never an attendance day for this
      // person ("Non-applicable and blocked days produce no official record
      // at all"). Distinguished here by the SAME plain employment dates
      // already fetched, and by the month-start category read: not a second
      // employment rule, a direct read of the one already on the User row.
      //
      // RESOLVED ONCE, AT MONTH-START. A category or employment-window change
      // mid-month could misclassify a day right at that boundary -- accepted
      // for this first version rather than re-resolving context per missing
      // day, which would be a full context+leave+evidence query for every
      // blank day in the month.
      const isExempt = context.attendanceApplicability !== 'REQUIRED'
        && context.attendanceApplicability !== 'BLOCKED';
      const beforeJoining = user.joiningDate !== null
        && businessDate < user.joiningDate.toISOString().slice(0, 10);
      const afterLeaving = user.lastWorkingDate !== null
        && businessDate > user.lastWorkingDate.toISOString().slice(0, 10);

      facts.push({
        businessDate, status: null, evaluationState: null,
        punchInAt: null, punchOutAt: null, workedMinutes: 0, breakMinutes: 0,
        lateMinutes: 0, locked: false,
        notApplicable: isExempt || beforeJoining || afterLeaving,
      });
    }

    const counts = summariseMonth(facts, requiredPresenceMinutes);
    const metrics = averageTimeMetrics(
      facts,
      (at) => this.companyMinutesOfDay(at),
    );

    const todayFacts = todayLiveResult ?? facts.find((f) => f.businessDate === today) ?? null;
    const completion = this.completionForToday(todayFacts, officialStartMinutes, requiredPresenceMinutes);

    return {
      employee: {
        id: user.id,
        name: user.name,
        employeeId: user.employeeId,
        designation: user.designation,
        department: user.department,
        isActive: user.isActive,
        joiningDate: user.joiningDate ? user.joiningDate.toISOString().slice(0, 10) : null,
        lastWorkingDate: user.lastWorkingDate ? user.lastWorkingDate.toISOString().slice(0, 10) : null,
        employmentCategory: context.profile?.category ?? null,
        tenure: computeTenure(
          user.joiningDate, this.tva.now(), user.lastWorkingDate,
        ),
      },
      month: resolvedMonth,
      requiredPresenceMinutes,
      counts,
      metrics,
      days: facts.map((f) => ({
        businessDate: f.businessDate,
        status: f.status,
        evaluationState: f.evaluationState,
        punchInAt: f.punchInAt ? f.punchInAt.toISOString() : null,
        punchOutAt: f.punchOutAt ? f.punchOutAt.toISOString() : null,
        officePresenceMinutes: officePresenceMinutes(f),
        workedMinutes: f.workedMinutes,
        breakMinutes: f.breakMinutes,
        locked: f.locked,
        // Without this, a day with no row reads identically to the frontend
        // whether it was exempt (nothing wrong) or a genuine unrecorded gap
        // (something wrong) -- the same disclosure the ordering fix protects
        // in the aggregate counts, but here for the per-day trend row.
        notApplicable: f.notApplicable ?? false,
      })),
      today: {
        businessDate: today,
        completion,
      },
      needsAttention: {
        missingPunchIn: counts.missingPunchIn,
        missingPunchOut: counts.missingPunchOut,
        needsReview: counts.needsReview,
        noRecord: counts.noRecord,
        pendingRegularizations,
        missingJoiningDate: !user.joiningDate,
        requiredPresenceUnconfigured: requiredPresenceMinutes === null,
      },
    };
  }

  /** Company-time minutes since midnight, matching how the shift start is expressed. */
  private companyMinutesOfDay(at: Date): number {
    return this.tva.elapsedMinutes(this.tva.companyDayStart(at), at);
  }

  /**
   * Today's expected-completion figure, using the SAME arithmetic
   * Reminder V2's completion trigger uses -- max(punch in, shift start) +
   * required presence -- never re-derived. Null when any input is missing;
   * that is Reminder V2's own resolveCompletionAt() judgment, reused, not a
   * new one invented for this screen.
   */
  private completionForToday(
    todayFacts: AttendanceDayFacts | null,
    officialStartMinutes: number | null,
    requiredPresenceMinutes: number | null,
  ): { expectedCompletionMinutes: number | null; unresolvedReason: string | null } {
    if (!todayFacts?.punchInAt) {
      return { expectedCompletionMinutes: null, unresolvedReason: 'NO_PUNCH_IN' };
    }
    if (officialStartMinutes === null) {
      return { expectedCompletionMinutes: null, unresolvedReason: 'NO_ARRIVAL_POLICY' };
    }
    if (requiredPresenceMinutes === null) {
      return { expectedCompletionMinutes: null, unresolvedReason: 'NO_REQUIRED_PRESENCE' };
    }
    const punchInMinutes = this.companyMinutesOfDay(todayFacts.punchInAt);
    return {
      expectedCompletionMinutes: Math.max(punchInMinutes, officialStartMinutes) + requiredPresenceMinutes,
      unresolvedReason: null,
    };
  }
}

function toDayFacts(businessDate: string, row: {
  status: DailyAttendanceStatus; evaluationState: string; punchInAt: Date | null;
  punchOutAt: Date | null; workedMinutes: number; breakMinutes: number;
  lateMinutes: number; locked: boolean;
}): AttendanceDayFacts {
  return {
    businessDate,
    status: row.status,
    evaluationState: row.evaluationState as EvaluationState,
    punchInAt: row.punchInAt,
    punchOutAt: row.punchOutAt,
    workedMinutes: row.workedMinutes,
    breakMinutes: row.breakMinutes,
    lateMinutes: row.lateMinutes,
    locked: row.locked,
  };
}

/** Inclusive list of yyyy-MM-dd dates, walked in UTC to avoid DST surprises. */
function enumerateDates(from: string, to: string): string[] {
  const out: string[] = [];
  let cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor.getTime() <= end.getTime()) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return out;
}
