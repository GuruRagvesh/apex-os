import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TVAService } from '../../../../common/services/tva.service';
import { AccessPolicyService } from '../../../../common/services/access-policy.service';
import { EventLoggerService, OperationalAction } from '../../../../common/services/event-logger.service';
import { COMPANY_CRON_TIMEZONE } from '../../../../common/constants/company-time.constants';
import { DailyAttendanceEvaluatorService } from '../evaluation/daily-attendance-evaluator.service';
import { describeSettlement, businessMonthOf } from '../evaluation/attendance-settlement';
import { lockAttendanceMonth } from '../evaluation/attendance-month-lock';
import { LeaveWorkingDayService } from '../../../operations/leave/leave-working-day.service';
import { findUnreportedRuns, type DayFact } from './unreported-absence';

/** How far back each run looks for the start of an unreported run. */
const LOOKBACK_DAYS = 45;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REPORT_CHANNELS = ['EMAIL', 'PHONE', 'MESSAGE', 'OTHER'] as const;

export interface UnreportedAbsenceRunResult {
  userId: string;
  applied: string[];
  skippedSettled: string[];
  alreadyDecided: number;
  calendarUnresolved: boolean;
}

/**
 * Three-day unreported absence (Phase 3).
 *
 * Decides LWP for runs of three or more consecutive scheduled working days
 * with no evidence, leave application or recorded report, and records each
 * day's decision. Safe to run repeatedly and concurrently:
 *
 *  - one decision per employee-date (unique index) -- a repeat finds it;
 *  - one run per employee at a time (transaction-scoped advisory lock);
 *  - only COMPLETED company days are considered (strictly before today), so
 *    the third day has ended before it can count.
 *
 * A finalized, locked, manually corrected or payroll-closed day is never
 * changed: its decision is recorded as SKIPPED_SETTLED for HR to see. Applied
 * days become LWP through the ordinary evaluator, which reads the decision, so
 * re-evaluation keeps the LWP and an HR correction removes it.
 */
@Injectable()
export class UnreportedAbsenceService {
  private readonly logger = new Logger(UnreportedAbsenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
    private readonly accessPolicy: AccessPolicyService,
    private readonly eventLogger: EventLoggerService,
    private readonly evaluator: DailyAttendanceEvaluatorService,
    private readonly workingDays: LeaveWorkingDayService,
  ) {}

  private addDays(date: string, days: number) {
    const d = new Date(`${date}T12:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  private day(date: string) {
    return new Date(`${date}T00:00:00.000Z`);
  }

  /** The working-day facts for one employee across a window. */
  async factsFor(userId: string, from: string, through: string): Promise<{ facts: DayFact[]; calendarUnresolved: boolean }> {
    const calendar = await this.workingDays.resolveForEmployee(userId, from, through);
    // Only a missing profile on some dates is acceptable here (it breaks runs);
    // an ambiguous or missing calendar means the working days are unknown, and
    // nothing is concluded from unknown working days.
    const calendarUnresolved = calendar.blockingReasons.some((r) => r !== 'NO_PROFILE_FOR_DATE');
    if (calendarUnresolved) return { facts: [], calendarUnresolved };

    const start = this.tva.companyDayStart(this.day(from));
    const end = this.tva.companyDayEnd(this.day(through));
    const [evidence, sessions, leaves, reports] = await Promise.all([
      this.prisma.attendancePunchEvidence.findMany({
        where: { userId, businessDate: { gte: this.day(from), lte: this.day(through) } },
        select: { businessDate: true },
      }),
      this.prisma.workSession.findMany({
        where: { userId, date: { gte: this.day(from), lte: this.day(through) } },
        select: { date: true },
      }),
      this.prisma.leaveRequest.findMany({
        where: { userId, status: { not: 'CANCELLED' }, startDate: { lte: end }, endDate: { gte: start } },
        select: { startDate: true, endDate: true },
      }),
      this.prisma.absenceReport.findMany({
        where: { userId, businessDate: { gte: this.day(from), lte: this.day(through) } },
        select: { businessDate: true },
      }),
    ]);

    const reported = new Set<string>();
    for (const e of evidence) reported.add(e.businessDate.toISOString().slice(0, 10));
    for (const s of sessions) reported.add(s.date.toISOString().slice(0, 10));
    for (const r of reports) reported.add(r.businessDate.toISOString().slice(0, 10));
    const leaveDays = (d: string) =>
      leaves.some((l) => this.tva.companyBusinessDate(l.startDate) <= d && this.tva.companyBusinessDate(l.endDate) >= d);

    const byDate = new Map(calendar.days.map((d) => [d.businessDate, d]));
    const facts: DayFact[] = [];
    for (let d = from; d <= through; d = this.addDays(d, 1)) {
      const known = byDate.get(d);
      facts.push({
        businessDate: d,
        covered: !!known,
        isWorkingDay: known?.isWorkingDay ?? false,
        reported: reported.has(d) || leaveDays(d),
      });
    }
    return { facts, calendarUnresolved: false };
  }

  /**
   * Decides one employee's unreported runs through `through` (default: the
   * last completed company day). Idempotent.
   */
  async applyForUser(userId: string, through?: string): Promise<UnreportedAbsenceRunResult> {
    const today = this.tva.companyToday();
    const last = through && through < today ? through : this.addDays(today, -1);
    const from = this.addDays(last, -LOOKBACK_DAYS);
    const result: UnreportedAbsenceRunResult = { userId, applied: [], skippedSettled: [], alreadyDecided: 0, calendarUnresolved: false };

    const { facts, calendarUnresolved } = await this.factsFor(userId, from, last);
    if (calendarUnresolved) {
      result.calendarUnresolved = true;
      return result;
    }
    const runs = findUnreportedRuns(facts);
    if (runs.length === 0) return result;

    await this.prisma.$transaction(async (tx) => {
      // One run per employee at a time; a concurrent scheduler waits here.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`lwp:${userId}`}))`;
      for (const run of runs) {
        for (const businessDate of run.days) {
          const date = this.day(businessDate);
          const existing = await tx.unreportedAbsenceDecision.findUnique({
            where: { userId_businessDate: { userId, businessDate: date } },
            select: { id: true },
          });
          if (existing) {
            result.alreadyDecided += 1;
            continue;
          }
          const month = businessMonthOf(businessDate);
          await lockAttendanceMonth(tx, month);
          const [official, monthClose] = await Promise.all([
            tx.dailyAttendance.findUnique({ where: { userId_date: { userId, date } } }),
            tx.attendanceMonthClose.findUnique({ where: { month }, select: { status: true } }),
          ]);
          const settled =
            describeSettlement({ day: official, monthClose }).length > 0 || (official?.revision ?? 0) > 0;
          await tx.unreportedAbsenceDecision.create({
            data: {
              id: randomUUID(),
              userId,
              businessDate: date,
              runStartDate: this.day(run.runStartDate),
              runLength: run.days.length,
              outcome: settled ? 'SKIPPED_SETTLED' : 'APPLIED',
              previousStatus: official?.status ?? null,
              previousLwpDeducted: official?.lwpDeducted ?? null,
              previousRevision: official?.revision ?? null,
            },
          });
          (settled ? result.skippedSettled : result.applied).push(businessDate);
        }
      }
    });

    // The official day follows from the decision through the ordinary
    // evaluator, which refuses finalized and locked days on its own.
    for (const businessDate of result.applied) {
      await this.evaluator.evaluateAndPersist(userId, businessDate).catch((error: any) => {
        this.logger.warn(`LWP evaluation failed for ${userId} ${businessDate}: ${error?.message ?? error}`);
      });
    }
    if (result.applied.length > 0 || result.skippedSettled.length > 0) {
      this.eventLogger.log({
        actorId: 'system',
        entityType: 'User',
        entityId: userId,
        action: OperationalAction.ATTENDANCE_UNREPORTED_ABSENCE_LWP,
        metadata: { applied: result.applied, skippedSettled: result.skippedSettled },
      }).catch(() => {});
    }
    return result;
  }

  /** Daily, after the post-workday evaluation pass. */
  @Cron('0 1 * * *', { name: 'attendance-unreported-absence', timeZone: COMPANY_CRON_TIMEZONE })
  async runDaily() {
    const users = await this.prisma.user.findMany({
      where: { isActive: true, isSystemAccount: false },
      select: { id: true },
    });
    let applied = 0;
    for (const u of users) {
      try {
        const out = await this.applyForUser(u.id);
        applied += out.applied.length;
      } catch (error: any) {
        this.logger.warn(`Unreported-absence run failed for ${u.id}: ${error?.message ?? error}`);
      }
    }
    return { users: users.length, applied };
  }

  private assertHr(actor: any) {
    if (!this.accessPolicy.isHrOrAdmin(actor)) {
      throw new ForbiddenException('Only HR and administrators can manage unreported-absence decisions');
    }
  }

  async list(actor: any, filters: { from?: string; to?: string; outcome?: string }) {
    this.assertHr(actor);
    for (const v of [filters.from, filters.to]) {
      if (v !== undefined && !DATE_RE.test(v)) throw new BadRequestException('Dates must be yyyy-MM-dd');
    }
    if (filters.outcome && !['APPLIED', 'SKIPPED_SETTLED', 'CORRECTED'].includes(filters.outcome)) {
      throw new BadRequestException('outcome must be APPLIED, SKIPPED_SETTLED or CORRECTED');
    }
    const rows = await this.prisma.unreportedAbsenceDecision.findMany({
      where: {
        ...(filters.outcome ? { outcome: filters.outcome } : {}),
        ...(filters.from || filters.to
          ? { businessDate: { ...(filters.from ? { gte: this.day(filters.from) } : {}), ...(filters.to ? { lte: this.day(filters.to) } : {}) } }
          : {}),
      },
      orderBy: [{ businessDate: 'desc' }],
      take: 500,
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.userId))] } },
      select: { id: true, name: true, employeeId: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({
      id: r.id,
      employee: byId.get(r.userId) ?? { id: r.userId, name: null, employeeId: null },
      businessDate: r.businessDate.toISOString().slice(0, 10),
      runStartDate: r.runStartDate.toISOString().slice(0, 10),
      runLength: r.runLength,
      outcome: r.outcome,
      correctedAt: r.correctedAt,
      correctionReason: r.correctionReason,
    }));
  }

  /**
   * HR reverses an LWP decision when valid emergency evidence is supplied.
   * Reason required; actor and time recorded; the original decision columns
   * stay as they were (database trigger). The day returns to review.
   */
  async correct(actor: any, id: string, body: { reason?: string }) {
    this.assertHr(actor);
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 5) throw new BadRequestException('Explain why this LWP decision is being corrected');

    const row = await this.prisma.unreportedAbsenceDecision.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Decision not found');
    if (row.outcome === 'CORRECTED') throw new BadRequestException('This decision has already been corrected');

    const changed = await this.prisma.unreportedAbsenceDecision.updateMany({
      where: { id, outcome: { in: ['APPLIED', 'SKIPPED_SETTLED'] } },
      data: { outcome: 'CORRECTED', correctedById: actor.id, correctedAt: this.tva.now(), correctionReason: reason.slice(0, 1000) },
    });
    if (changed.count !== 1) throw new BadRequestException('This decision has already been corrected');

    const businessDate = row.businessDate.toISOString().slice(0, 10);
    const reevaluated = row.outcome === 'APPLIED'
      ? await this.evaluator.evaluateAndPersist(row.userId, businessDate).catch(() => null)
      : null;

    this.eventLogger.log({
      actorId: actor.id,
      entityType: 'UnreportedAbsenceDecision',
      entityId: id,
      action: OperationalAction.ATTENDANCE_UNREPORTED_ABSENCE_CORRECTED,
      fromState: row.outcome,
      toState: 'CORRECTED',
      metadata: { businessDate, reason: reason.slice(0, 200), reevaluated: reevaluated?.persisted ?? false },
    }).catch(() => {});

    return {
      id,
      outcome: 'CORRECTED',
      businessDate,
      // A day finalized since the LWP was applied is not rewritten here.
      dayUpdated: reevaluated?.persisted === true,
      dayBlockedReason: reevaluated && !reevaluated.persisted ? reevaluated.reason : null,
    };
  }

  /** HR records that the employee DID report an absence. */
  async recordAbsenceReport(
    actor: any,
    body: { userId?: string; businessDate?: string; channel?: string; note?: string },
  ) {
    this.assertHr(actor);
    if (!body?.userId) throw new BadRequestException('userId is required');
    if (!body.businessDate || !DATE_RE.test(body.businessDate)) throw new BadRequestException('businessDate must be yyyy-MM-dd');
    if (!REPORT_CHANNELS.includes(body.channel as any)) throw new BadRequestException(`channel must be one of ${REPORT_CHANNELS.join(', ')}`);
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (!note) throw new BadRequestException('A note describing the report is required');
    if (body.userId === actor.id) throw new ForbiddenException('You cannot record a report for your own absence');

    const created = await this.prisma.absenceReport.create({
      data: {
        id: randomUUID(),
        userId: body.userId,
        businessDate: this.day(body.businessDate),
        channel: body.channel!,
        note: note.slice(0, 1000),
        recordedById: actor.id,
      },
    }).catch((error: any) => {
      if (error?.code === 'P2002') throw new BadRequestException('A report is already recorded for this employee and date');
      throw error;
    });
    this.eventLogger.log({
      actorId: actor.id,
      entityType: 'AbsenceReport',
      entityId: created.id,
      action: OperationalAction.ATTENDANCE_ABSENCE_REPORTED,
      metadata: { businessDate: body.businessDate, channel: body.channel },
    }).catch(() => {});
    return created;
  }
}
