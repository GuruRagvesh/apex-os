import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import type { DailyAttendanceStatus } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TVAService } from '../../../../common/services/tva.service';
import { DailyContextService } from '../context/daily-context.service';
import { LeaveFactsService } from './leave-facts.service';
import type { DailyAttendanceContext } from '../context/daily-context.types';
import {
  EVALUATOR_VERSION,
  NON_REVIEW_FLAGS,
  type AttendanceCalculationReason,
  type AttendanceExceptionFlag,
  type DailyAttendanceResult,
  type EvaluationProvenance,
  type EvaluationState,
  type LeaveDayFacts,
} from './daily-attendance.types';

/**
 * The Daily Attendance Evaluator (AE-1).
 *
 * Turns resolved context + approved leave + immutable punch evidence + the
 * workday's own totals into the single official answer for one employee on one
 * business date.
 *
 * Three rules govern everything below:
 *
 *  1. It never recalculates workday internals. `totalWorkMinutes` and
 *     `totalBreakMinutes` are read from the finalized WorkSession, because the
 *     workday engine already owns that arithmetic (meeting-as-work included)
 *     and a second implementation would eventually disagree with the first.
 *
 *  2. It never manufactures a payroll-affecting outcome. Where management has
 *     not decided, the day becomes NEEDS_REVIEW — not ABSENT, not LWP, not a
 *     half day, and never a leave deduction.
 *
 *  3. It never mutates evidence. Punch rows and work sessions are read-only
 *     here; the only thing written is the DailyAttendance result itself.
 */
@Injectable()
export class DailyAttendanceEvaluatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
    private readonly dailyContext: DailyContextService,
    private readonly leaveFacts: LeaveFactsService,
  ) {}

  /**
   * Evaluates one employee-date WITHOUT writing anything.
   *
   * Separated from persistence so the same logic can answer "what would today
   * look like right now?" for a live UI, where writing a provisional row on
   * every page load would be wrong.
   */
  async evaluate(
    userId: string,
    businessDate: string,
    client: any = this.prisma,
  ): Promise<DailyAttendanceResult> {
    const at = new Date(`${businessDate}T00:00:00.000Z`);
    const context = await this.dailyContext.resolveDailyContext(userId, at);

    // ── Applicability gate ───────────────────────────────────────────────
    // A configuration gap must never become an attendance outcome. None of
    // these produce an official classification, and none are persisted.
    if (context.attendanceApplicability !== 'REQUIRED') {
      const reason: AttendanceCalculationReason =
        context.attendanceApplicability === 'EXEMPT'
          ? 'NOT_APPLICABLE_EXEMPT'
          : context.attendanceApplicability === 'NOT_EMPLOYED'
            ? 'NOT_APPLICABLE_NOT_EMPLOYED'
            : 'CONTEXT_BLOCKED';

      return this.unofficial(userId, businessDate, context, reason);
    }

    const flags: AttendanceExceptionFlag[] = [];
    const leave = await this.leaveFacts.resolveForDate(userId, businessDate);

    if (leave.kind === 'AMBIGUOUS') {
      // Two approved leaves covering one date is a data problem. The day is
      // still evaluated on its punch evidence so a full workday is not lost,
      // but a human has to settle which leave applies.
      flags.push('AMBIGUOUS_APPROVED_LEAVE');
    }

    // ── Non-working days ─────────────────────────────────────────────────
    const calendar = context.calendar;
    if (!calendar.expectedCompanyWorkingDay) {
      return this.nonWorkingDay(userId, businessDate, context, leave, flags);
    }

    // ── Working day with proven leave ────────────────────────────────────
    if (leave.hasApprovedLeave && leave.kind !== 'AMBIGUOUS') {
      return this.leaveDay(userId, businessDate, context, leave, flags);
    }

    // ── Working day: punch and workday facts ─────────────────────────────
    return this.workingDay(userId, businessDate, context, leave, flags, client);
  }

  /**
   * Evaluates and persists the official result.
   *
   * Idempotent by design: an unchanged re-evaluation neither duplicates nor
   * rewrites the row, and a finalized or locked day is never recalculated.
   */
  async evaluateAndPersist(userId: string, businessDate: string) {
    const result = await this.evaluate(userId, businessDate);

    // Non-applicable and blocked days produce no official record at all.
    if (!result.official || result.status === null) {
      return { result, persisted: false, reason: 'NOT_OFFICIAL' as const };
    }

    const date = this.tva.companyDateOnly(new Date(`${businessDate}T00:00:00.000Z`));
    const existing = await this.prisma.dailyAttendance.findUnique({
      where: { userId_date: { userId, date } },
    });

    if (existing) {
      // A finalized or locked day is settled. Later corrections belong to the
      // regularization workflow, which is audited; silently recomputing over a
      // locked result would erase a decision somebody already made.
      if (existing.locked || existing.evaluationState === 'FINALIZED') {
        return { result, persisted: false, reason: 'LOCKED' as const, record: existing };
      }
      // Same inputs, same answer: nothing to write.
      if (existing.sourceFingerprint === result.sourceFingerprint) {
        return { result, persisted: false, reason: 'UNCHANGED' as const, record: existing };
      }
    }

    const data = this.toRow(result);
    const record = await this.prisma.dailyAttendance.upsert({
      where: { userId_date: { userId, date } },
      create: { userId, date, ...data },
      update: data,
    });

    return { result, persisted: true, reason: 'WRITTEN' as const, record };
  }

  /**
   * Rewrites the official record after an approved correction.
   *
   * This is the ONLY path allowed to write over a FINALIZED day, and it exists
   * precisely so that "finalized" can mean something: the ordinary evaluator
   * refuses, and only an approved, audited correction may revise the fact.
   *
   * Runs inside the approver's transaction so the correction and the revised
   * official result commit together.
   */
  async reviseForApprovedCorrection(
    tx: any,
    userId: string,
    businessDate: string,
    regularizationId: string,
  ): Promise<{ before: any; after: any; result: DailyAttendanceResult }> {
    const date = this.tva.companyDateOnly(new Date(`${businessDate}T00:00:00.000Z`));
    const before = await tx.dailyAttendance.findUnique({
      where: { userId_date: { userId, date } },
    });

    // Re-evaluated through the SAME evaluator, now seeing the approved
    // correction. The corrected day stays explainable by the ordinary rules
    // rather than being hand-patched into shape.
    const result = await this.evaluate(userId, businessDate, tx);
    const data = this.toRow(result);

    const after = await tx.dailyAttendance.upsert({
      where: { userId_date: { userId, date } },
      create: {
        userId,
        date,
        ...data,
        revision: (before?.revision ?? 0) + 1,
        lastRegularizationId: regularizationId,
      },
      update: {
        ...data,
        revision: (before?.revision ?? 0) + 1,
        lastRegularizationId: regularizationId,
      },
    });

    return { before, after, result };
  }

  /**
   * Marks a day's official result final.
   *
   * Deliberately a separate, explicit action: nothing in the read path or the
   * ordinary evaluation path may finalize, because finalization is what removes
   * the day from routine recalculation.
   */
  async finalize(userId: string, businessDate: string) {
    const date = this.tva.companyDateOnly(new Date(`${businessDate}T00:00:00.000Z`));
    const existing = await this.prisma.dailyAttendance.findUnique({
      where: { userId_date: { userId, date } },
    });
    if (!existing) return { finalized: false, reason: 'NO_RECORD' as const };
    if (existing.evaluationState === 'NEEDS_REVIEW') {
      // A day with open questions is not payroll-final by definition.
      return { finalized: false, reason: 'NEEDS_REVIEW' as const, record: existing };
    }
    if (existing.evaluationState === 'FINALIZED') {
      return { finalized: false, reason: 'ALREADY_FINAL' as const, record: existing };
    }

    const record = await this.prisma.dailyAttendance.update({
      where: { userId_date: { userId, date } },
      data: { evaluationState: 'FINALIZED', locked: true, lockedAt: this.tva.now() },
    });
    return { finalized: true, reason: 'FINALIZED' as const, record };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Branches
  // ───────────────────────────────────────────────────────────────────────

  private nonWorkingDay(
    userId: string,
    businessDate: string,
    context: DailyAttendanceContext,
    leave: LeaveDayFacts,
    flags: AttendanceExceptionFlag[],
  ): DailyAttendanceResult {
    const cal = context.calendar;

    let status: DailyAttendanceStatus = 'HOLIDAY';
    let reason: AttendanceCalculationReason = 'HOLIDAY';

    if (cal.override?.type === 'COMPANY_CLOSURE') {
      status = 'HOLIDAY';
      reason = 'COMPANY_CLOSURE';
    } else if (cal.holiday.isHoliday) {
      status = 'HOLIDAY';
      reason = 'HOLIDAY';
    } else if (cal.weeklyOff.isWeeklyOff) {
      status = 'WEEKLY_OFF';
      reason = 'WEEKLY_OFF';
    }

    // Approved leave landing on a non-working day deducts NOTHING here. The
    // leave policy's own holidaysExcluded/weeklyOffExcluded settings are what
    // would authorise a deduction, and inventing one would quietly cost the
    // employee a day off. Flagged so it is visible rather than lost.
    if (leave.hasApprovedLeave) flags.push('LEAVE_ON_NON_WORKING_DAY');

    return this.build({
      userId,
      businessDate,
      context,
      status,
      reason,
      flags,
      leaveRequestId: leave.leaveRequestId,
      // Deliberately zero. See above.
      leaveDeducted: 0,
      lwpDeducted: 0,
    });
  }

  private leaveDay(
    userId: string,
    businessDate: string,
    context: DailyAttendanceContext,
    leave: LeaveDayFacts,
    flags: AttendanceExceptionFlag[],
  ): DailyAttendanceResult {
    let status: DailyAttendanceStatus;
    let reason: AttendanceCalculationReason;
    let leaveDeducted = 0;
    let lwpDeducted = 0;

    switch (leave.kind) {
      case 'PAID':
        status = 'LEAVE';
        reason = 'APPROVED_PAID_LEAVE';
        leaveDeducted = 1;
        break;
      case 'UNPAID':
        // LWP because the leave record itself says UNPAID, not because a
        // balance lookup came back empty.
        status = 'LWP';
        reason = 'APPROVED_UNPAID_LEAVE';
        lwpDeducted = 1;
        break;
      case 'HALF_DAY_PAID':
        // An explicitly approved half day is proven, not manufactured, so
        // automaticHalfDayEnabled does not gate it.
        status = 'HALF_DAY';
        reason = 'APPROVED_HALF_DAY_LEAVE';
        leaveDeducted = 0.5;
        break;
      case 'HALF_DAY_UNPAID':
        status = 'HALF_DAY';
        reason = 'APPROVED_HALF_DAY_LEAVE';
        lwpDeducted = 0.5;
        break;
      case 'PARTIALLY_FUNDED':
        // The company funded part of this leave and not the rest, but the
        // request records only totals -- not which dates were unpaid. Marking
        // this date LEAVE or LWP would be a guess with a pay consequence, so
        // the day is recorded as leave and sent for review instead.
        status = 'LEAVE';
        reason = 'APPROVED_PARTIALLY_FUNDED_LEAVE';
        flags.push('PARTIALLY_FUNDED_LEAVE');
        break;
      default:
        status = 'LEAVE';
        reason = 'APPROVED_PAID_LEAVE';
        leaveDeducted = 1;
    }

    return this.build({
      userId,
      businessDate,
      context,
      status,
      reason,
      flags,
      leaveRequestId: leave.leaveRequestId,
      leaveDeducted,
      lwpDeducted,
    });
  }

  private async workingDay(
    userId: string,
    businessDate: string,
    context: DailyAttendanceContext,
    leave: LeaveDayFacts,
    flags: AttendanceExceptionFlag[],
    client: any = this.prisma,
  ): Promise<DailyAttendanceResult> {
    const date = this.tva.companyDateOnly(new Date(`${businessDate}T00:00:00.000Z`));

    const [evidence, sessions, correction] = await Promise.all([
      client.attendancePunchEvidence.findMany({
        where: { userId, businessDate: date },
        orderBy: { serverOccurredAt: 'asc' },
      }),
      client.workSession.findMany({
        where: { userId, date },
        orderBy: { createdAt: 'asc' },
      }),
      // AR-1: the approved correction for this day, if one exists. Corrections
      // change the official INTERPRETATION of the day; the punch rows and work
      // sessions above are read exactly as recorded and never rewritten.
      client.attendanceRegularization.findFirst({
        where: { userId, date, status: 'HR_APPROVED' },
        orderBy: { hrDecisionAt: 'desc' },
      }),
    ]);

    const punchIn = evidence.find((e) => e.type === 'PUNCH_IN') ?? null;
    const punchOut = [...evidence].reverse().find((e) => e.type === 'PUNCH_OUT') ?? null;
    const workSessionIds = sessions.map((s) => s.id);

    // An approved correction supplies the official punch times the raw evidence
    // could not. Applied HERE, before the branches, so a supplied punch-out
    // simply is not missing any more -- rather than being flagged missing and
    // then contradicted further down.
    const correctedIn = correction?.requestedPunchIn ?? null;
    const correctedOut = correction?.requestedPunchOut ?? null;
    const isCorrected = !!correction && (!!correctedIn || !!correctedOut || !!correction.proposedStatus);
    if (isCorrected) flags.push('CORRECTED_BY_REGULARIZATION');

    this.collectEvidenceExceptions(evidence, flags);

    // ── No evidence at all ───────────────────────────────────────────────
    // No punch, no session, no approved leave, on a day the company expected
    // work. That is a factual exception, and there is no policy field today
    // that authorises turning it into an automatic ABSENT.
    if (!punchIn && sessions.length === 0 && !isCorrected) {
      flags.push('NO_ATTENDANCE_EVIDENCE');
      return this.build({
        userId,
        businessDate,
        context,
        status: 'MISSING_PUNCH',
        reason: 'NO_EVIDENCE_ON_WORKING_DAY',
        flags,
        forceReview: true,
        leaveRequestId: leave.leaveRequestId,
      });
    }

    const openSession = sessions.find((s) => !s.logoutAt);
    const closed = sessions.filter((s) => !!s.logoutAt);

    // Workday totals come from the workday engine, never recomputed here.
    let workedMinutes = closed.reduce((n, s) => n + (s.totalWorkMinutes ?? 0), 0);
    const breakMinutes = closed.reduce((n, s) => n + (s.totalBreakMinutes ?? 0), 0);

    const punchInAt = correctedIn ?? punchIn?.serverOccurredAt ?? sessions[0]?.startWorkAt ?? null;
    const punchOutAt = correctedOut ?? punchOut?.serverOccurredAt ?? null;
    // The ONE place official worked time is derived rather than read. A
    // correction is a statement that the recorded session is wrong, so there is
    // no engine total to trust -- the corrected span minus the breaks the
    // workday DID record is the best available official answer, and the raw
    // session totals remain reachable through workSessionIds.
    if (isCorrected && punchInAt && punchOutAt) {
      const span = Math.floor((punchOutAt.getTime() - punchInAt.getTime()) / 60_000);
      workedMinutes = Math.max(0, span - breakMinutes);
    }

    const lateMinutes = this.lateMinutes(context, punchInAt);

    // ── Still working ────────────────────────────────────────────────────
    // Provisional only: useful for today's UI, explicitly not finalized.
    if (openSession) {
      flags.push('WORKDAY_STILL_OPEN');
      return this.build({
        userId,
        businessDate,
        context,
        status: 'PRESENT',
        reason: 'WORKDAY_IN_PROGRESS',
        flags,
        punchInAt,
        punchOutAt: null,
        workedMinutes,
        breakMinutes,
        lateMinutes,
        punchInEvidenceId: punchIn?.id ?? null,
        punchOutEvidenceId: null,
        workSessionIds,
        leaveRequestId: leave.leaveRequestId,
      });
    }

    // ── Incomplete punch pair ────────────────────────────────────────────
    // The session closed (possibly by the auto-close scheduler) but the
    // employee never punched out. No end time is fabricated.
    if (punchIn && !punchOut && !correctedOut) {
      flags.push('MISSING_PUNCH_OUT');
      return this.build({
        userId,
        businessDate,
        context,
        status: 'MISSING_PUNCH',
        reason: 'INCOMPLETE_PUNCH_PAIR',
        flags,
        forceReview: true,
        punchInAt,
        punchOutAt: null,
        workedMinutes,
        breakMinutes,
        lateMinutes,
        punchInEvidenceId: punchIn.id,
        workSessionIds,
        leaveRequestId: leave.leaveRequestId,
      });
    }

    // A closed session with no punch evidence at all: the workday happened
    // through the legacy controls, which is normal while the punch feature is
    // off. Not an exception, but there is no punch pair to judge.
    if (!punchIn) {
      flags.push('MISSING_PUNCH');
    }

    // ── Complete working day, subject to policy questions ────────────────
    let status: DailyAttendanceStatus = 'PRESENT';
    let reason: AttendanceCalculationReason = 'COMPLETE_WORKDAY';
    let forceReview = false;
    let leaveDeducted = 0;
    let lwpDeducted = 0;

    const policy = context.attendancePolicy;

    // ── Three distinct measures, three distinct policy fields ─────────────
    //
    //   presence span      how long the employee was at work, breaks included
    //   break minutes      how much of that span was break
    //   effective work     span minus non-meeting breaks (the workday's own total)
    //
    // The required 540 is a SPAN requirement: the shift window it accompanies
    // (10:00-19:00) is exactly 540 minutes, which is only reachable if breaks
    // sit inside it. Comparing effective work against 540 would fail everyone
    // who takes a normal lunch, which is what this replaces.
    const requiredSpan = context.shift?.minimumWorkingMinutes ?? policy?.minimumWorkingMinutes ?? 540;
    const permittedBreak = policy?.permittedBreakMinutes ?? 60;
    const minimumEffectiveWork = policy?.minimumEffectiveWorkMinutes ?? null;

    const presenceSpanMinutes =
      punchInAt && punchOutAt
        ? Math.max(0, Math.floor((punchOutAt.getTime() - punchInAt.getTime()) / 60_000))
        : closed.reduce((n, sess) => {
            if (!sess.startWorkAt || !sess.logoutAt) return n;
            return n + Math.max(0, Math.floor((sess.logoutAt.getTime() - sess.startWorkAt.getTime()) / 60_000));
          }, 0);

    // Late beyond the punch window.
    if (lateMinutes > 0) {
      status = policy?.lateExemptionEnabled ? 'LATE_EXEMPTED' : 'LATE';
      const decision = this.applyPolicyAction(
        policy?.afterPunchWindowAction,
        policy?.automaticHalfDayEnabled === true,
      );
      flags.push('LATE_BEYOND_PUNCH_WINDOW');
      if (decision.review) forceReview = true;
      if (decision.status) status = decision.status;
      leaveDeducted += decision.leaveDeducted;
      lwpDeducted += decision.lwpDeducted;
      if (decision.status || decision.review) reason = 'POLICY_DECISION_DEFERRED';
    }

    // Each duration question is asked separately, and each routes through the
    // one configured action for duration shortfalls.
    const durationShortfalls: AttendanceExceptionFlag[] = [];
    if (presenceSpanMinutes < requiredSpan) durationShortfalls.push('INSUFFICIENT_PRESENCE_SPAN');
    if (breakMinutes > permittedBreak) durationShortfalls.push('BREAK_EXCEEDS_ALLOWANCE');
    if (minimumEffectiveWork !== null && workedMinutes < minimumEffectiveWork) {
      durationShortfalls.push('INSUFFICIENT_EFFECTIVE_WORK');
    }

    if (durationShortfalls.length > 0) {
      for (const f of durationShortfalls) flags.push(f);
      const decision = this.applyPolicyAction(
        policy?.insufficientHoursAction,
        policy?.automaticHalfDayEnabled === true,
      );
      if (decision.review) forceReview = true;
      if (decision.status) status = decision.status;
      leaveDeducted += decision.leaveDeducted;
      lwpDeducted += decision.lwpDeducted;
      if (decision.status || decision.review) reason = 'POLICY_DECISION_DEFERRED';
    }

    if (context.calendar.override?.type === 'SPECIAL_WORKING_DAY' && reason === 'COMPLETE_WORKDAY') {
      reason = 'SPECIAL_WORKING_DAY_WORKED';
    }

    // An explicitly granted status is an approved decision and outranks the
    // evaluator's own reading, including any deferred policy question above.
    if (correction?.proposedStatus) {
      status = correction.proposedStatus as DailyAttendanceStatus;
      forceReview = false;
    }
    if (isCorrected) reason = 'CORRECTED_WORKDAY';

    return this.build({
      userId,
      businessDate,
      context,
      status,
      reason,
      flags,
      forceReview,
      punchInAt,
      punchOutAt,
      workedMinutes,
      breakMinutes,
      lateMinutes,
      leaveDeducted,
      lwpDeducted,
      punchInEvidenceId: punchIn?.id ?? null,
      punchOutEvidenceId: punchOut?.id ?? null,
      workSessionIds,
      leaveRequestId: leave.leaveRequestId,
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Translates a configured PolicyDecisionAction into an outcome.
   *
   * REQUIRE_REVIEW is the default on both fields, so an undecided rule can only
   * ever produce a review. The two DEDUCT_* actions are recognised but NOT
   * executed: applying them means writing to leave balances, which is payroll
   * territory and out of scope for this wave — they route to review instead of
   * silently doing half the job.
   */
  private applyPolicyAction(
    action: string | undefined,
    automaticHalfDayEnabled: boolean,
  ): {
    review: boolean;
    status: DailyAttendanceStatus | null;
    leaveDeducted: number;
    lwpDeducted: number;
  } {
    const none = { review: false, status: null, leaveDeducted: 0, lwpDeducted: 0 };

    switch (action) {
      case 'NO_ACTION':
        return none;
      case 'MARK_HALF_DAY':
        // Explicitly gated: with automatic half-day off, a threshold must never
        // manufacture one, whatever the action says.
        return automaticHalfDayEnabled
          ? { ...none, status: 'HALF_DAY' }
          : { ...none, review: true };
      case 'MARK_ABSENT':
        return { ...none, status: 'ABSENT' };
      case 'MARK_LWP':
        return { ...none, status: 'LWP', lwpDeducted: 1 };
      case 'DEDUCT_HALF_PAID_LEAVE':
      case 'DEDUCT_FULL_PAID_LEAVE':
        return { ...none, review: true };
      case 'REQUIRE_REVIEW':
      default:
        return { ...none, review: true };
    }
  }

  /** Location and photo observations. NOT_ENFORCED is a policy fact, not a fault. */
  private collectEvidenceExceptions(evidence: any[], flags: AttendanceExceptionFlag[]) {
    for (const e of evidence) {
      switch (e.locationVerification) {
        case 'OUTSIDE_GEOFENCE':
          if (!flags.includes('LOCATION_OUTSIDE_GEOFENCE')) flags.push('LOCATION_OUTSIDE_GEOFENCE');
          break;
        case 'LOW_ACCURACY':
          if (!flags.includes('LOCATION_LOW_ACCURACY')) flags.push('LOCATION_LOW_ACCURACY');
          break;
        case 'UNAVAILABLE':
          if (!flags.includes('LOCATION_UNAVAILABLE')) flags.push('LOCATION_UNAVAILABLE');
          break;
        default:
          break; // VERIFIED and NOT_ENFORCED are both fine.
      }
      if (e.photoVerification && e.photoVerification !== 'CAPTURED') {
        if (!flags.includes('PHOTO_MISSING')) flags.push('PHOTO_MISSING');
      }
    }
  }

  /** Minutes past the shift start plus its grace window. Zero when on time. */
  private lateMinutes(context: DailyAttendanceContext, punchInAt: Date | null): number {
    const shift = context.shift;
    if (!shift || !punchInAt) return 0;

    // Shift start as a real instant in company time, via the time authority.
    const shiftStart = this.tva.companyInstantAt(context.businessDate, shift.startTime);
    if (!shiftStart) return 0;

    const allowedFrom = new Date(shiftStart.getTime() + (shift.graceMinutes ?? 0) * 60_000);

    const diff = Math.floor((punchInAt.getTime() - allowedFrom.getTime()) / 60_000);
    return diff > 0 ? diff : 0;
  }

  private provenanceOf(context: DailyAttendanceContext, extra: Partial<EvaluationProvenance>) {
    const s = context.sources;
    return {
      resolverVersion: context.resolverVersion,
      evaluatorVersion: EVALUATOR_VERSION,
      employeeProfileId: s.employeeProfileId,
      attendancePolicyId: s.attendancePolicyId,
      attendancePolicyVersion: s.attendancePolicyVersion,
      shiftPolicyId: s.shiftPolicyId,
      shiftPolicyVersion: s.shiftPolicyVersion,
      holidayCalendarId: s.resolvedHolidayCalendarId ?? s.holidayCalendarId,
      weeklyOffPolicyId: s.resolvedWeeklyOffPolicyId ?? s.weeklyOffPolicyId,
      holidayId: s.holidayId,
      businessDayOverrideId: s.businessDayOverrideId,
      leaveRequestId: null,
      punchInEvidenceId: null,
      punchOutEvidenceId: null,
      workSessionIds: [],
      ...extra,
    } as EvaluationProvenance;
  }

  private unofficial(
    userId: string,
    businessDate: string,
    context: DailyAttendanceContext,
    reason: AttendanceCalculationReason,
  ): DailyAttendanceResult {
    return {
      employeeId: userId,
      businessDate,
      official: false,
      status: null,
      // Blocked configuration is a review item for HR; exempt and not-employed
      // are simply not attendance situations.
      evaluationState: reason === 'CONTEXT_BLOCKED' ? 'NEEDS_REVIEW' : 'CALCULATED',
      calculationReason: reason,
      exceptionFlags: [],
      punchInAt: null,
      punchOutAt: null,
      workedMinutes: 0,
      breakMinutes: 0,
      lateMinutes: 0,
      leaveDeducted: 0,
      lwpDeducted: 0,
      requiresReview: reason === 'CONTEXT_BLOCKED',
      blockingReasons: reason === 'CONTEXT_BLOCKED' ? (context.blockingReasons ?? []) : [],
      provenance: this.provenanceOf(context, {}),
      sourceFingerprint: '',
      evaluatedAt: this.tva.now(),
    };
  }

  private build(input: {
    userId: string;
    businessDate: string;
    context: DailyAttendanceContext;
    status: DailyAttendanceStatus;
    reason: AttendanceCalculationReason;
    flags: AttendanceExceptionFlag[];
    forceReview?: boolean;
    punchInAt?: Date | null;
    punchOutAt?: Date | null;
    workedMinutes?: number;
    breakMinutes?: number;
    lateMinutes?: number;
    leaveDeducted?: number;
    lwpDeducted?: number;
    punchInEvidenceId?: string | null;
    punchOutEvidenceId?: string | null;
    workSessionIds?: string[];
    leaveRequestId?: string | null;
  }): DailyAttendanceResult {
    // Any exception at all means a human should look. Review is the safe
    // direction: it delays a decision instead of inventing one.
    const openQuestions = input.flags.filter((f) => !NON_REVIEW_FLAGS.includes(f));
    const requiresReview = input.forceReview === true || openQuestions.length > 0;
    const evaluationState: EvaluationState = requiresReview ? 'NEEDS_REVIEW' : 'CALCULATED';

    const provenance = this.provenanceOf(input.context, {
      leaveRequestId: input.leaveRequestId ?? null,
      punchInEvidenceId: input.punchInEvidenceId ?? null,
      punchOutEvidenceId: input.punchOutEvidenceId ?? null,
      workSessionIds: input.workSessionIds ?? [],
    });

    const result: DailyAttendanceResult = {
      employeeId: input.userId,
      businessDate: input.businessDate,
      official: true,
      status: input.status,
      evaluationState,
      calculationReason: input.reason,
      exceptionFlags: input.flags,
      punchInAt: input.punchInAt ?? null,
      punchOutAt: input.punchOutAt ?? null,
      workedMinutes: input.workedMinutes ?? 0,
      breakMinutes: input.breakMinutes ?? 0,
      lateMinutes: input.lateMinutes ?? 0,
      leaveDeducted: input.leaveDeducted ?? 0,
      lwpDeducted: input.lwpDeducted ?? 0,
      requiresReview,
      blockingReasons: [],
      provenance,
      sourceFingerprint: '',
      evaluatedAt: this.tva.now(),
    };

    result.sourceFingerprint = this.fingerprint(result);
    return result;
  }

  /**
   * Digest of everything that determined this result.
   *
   * `evaluatedAt` is deliberately excluded — it changes on every call, and a
   * fingerprint that always differs would defeat the idempotency check it
   * exists to serve.
   */
  private fingerprint(r: DailyAttendanceResult): string {
    const canonical = JSON.stringify({
      employeeId: r.employeeId,
      businessDate: r.businessDate,
      status: r.status,
      state: r.evaluationState,
      reason: r.calculationReason,
      flags: [...r.exceptionFlags].sort(),
      punchInAt: r.punchInAt?.toISOString() ?? null,
      punchOutAt: r.punchOutAt?.toISOString() ?? null,
      workedMinutes: r.workedMinutes,
      breakMinutes: r.breakMinutes,
      lateMinutes: r.lateMinutes,
      leaveDeducted: r.leaveDeducted,
      lwpDeducted: r.lwpDeducted,
      provenance: r.provenance,
    });
    return createHash('sha256').update(canonical).digest('hex');
  }

  /** Result -> DailyAttendance columns. */
  private toRow(r: DailyAttendanceResult) {
    return {
      status: r.status as DailyAttendanceStatus,
      punchInAt: r.punchInAt,
      punchOutAt: r.punchOutAt,
      workedMinutes: r.workedMinutes,
      breakMinutes: r.breakMinutes,
      lateMinutes: r.lateMinutes,
      leaveDeducted: r.leaveDeducted,
      lwpDeducted: r.lwpDeducted,
      calculationReason: r.calculationReason,
      evaluationState: r.evaluationState,
      evaluatorVersion: r.provenance.evaluatorVersion,
      resolverVersion: r.provenance.resolverVersion,
      evaluatedAt: r.evaluatedAt,
      exceptionFlags: r.exceptionFlags,
      sourceFingerprint: r.sourceFingerprint,
      employeeProfileId: r.provenance.employeeProfileId,
      attendancePolicyId: r.provenance.attendancePolicyId,
      attendancePolicyVersion: r.provenance.attendancePolicyVersion,
      shiftPolicyId: r.provenance.shiftPolicyId,
      shiftPolicyVersion: r.provenance.shiftPolicyVersion,
      holidayCalendarId: r.provenance.holidayCalendarId,
      weeklyOffPolicyId: r.provenance.weeklyOffPolicyId,
      holidayId: r.provenance.holidayId,
      businessDayOverrideId: r.provenance.businessDayOverrideId,
      leaveRequestId: r.provenance.leaveRequestId,
      punchInEvidenceId: r.provenance.punchInEvidenceId,
      punchOutEvidenceId: r.provenance.punchOutEvidenceId,
      workSessionIds: r.provenance.workSessionIds,
      policyVersion:
        r.provenance.attendancePolicyVersion != null
          ? String(r.provenance.attendancePolicyVersion)
          : null,
    };
  }
}
