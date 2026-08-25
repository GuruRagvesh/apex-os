import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TVAService } from '../../../../common/services/tva.service';
import { EventLoggerService, OperationalAction } from '../../../../common/services/event-logger.service';
import { SettingsService } from '../../settings/settings.service';
import { DailyAttendanceEvaluatorService } from '../evaluation/daily-attendance-evaluator.service';
import {
  ATTENDANCE_V2_DEFAULTS,
  ATTENDANCE_V2_SETTING_KEY,
} from '../punch/punch-evidence.types';

/**
 * Attendance processing (SS-1).
 *
 * The single place a batch of attendance gets evaluated, whether the trigger is
 * the nightly cron, an HR console command, or a test. Cron methods contain no
 * business logic; they call this.
 *
 * It owns no attendance rules either. Every answer comes from the AE-1
 * evaluator, through the same evaluateAndPersist() the HR console already uses,
 * so there is exactly one evaluation path in the system.
 *
 * Three modes, all defaulting to the safe one:
 *
 *   OFF      nothing runs
 *   SHADOW   the evaluator runs for real, results are reported and audited,
 *            and NOTHING is written to the official record
 *   OFFICIAL evaluateAndPersist() may store the result
 *
 * Shadow exists so Attendance V2 can be proven against a real company's real
 * days before it is allowed to decide anything.
 */

export type ProcessingMode = 'SHADOW' | 'OFFICIAL';

/**
 * What the current configuration actually authorises.
 *
 * Resolved as ONE value rather than three loose booleans, because the dangerous
 * case is not any single flag — it is a combination an administrator can
 * misread. shadowEnabled AND officialWriteEnabled together would let somebody
 * believe they were observing a rehearsal while the system wrote official
 * attendance. That combination is therefore not a precedence question to be
 * settled quietly in code; it is a configuration error, and it stops everything.
 */
export type ResolvedProcessingMode =
  | 'DISABLED'
  | 'SHADOW'
  | 'OFFICIAL'
  | 'CONFIGURATION_ERROR';

export interface ProcessingModeState {
  mode: ResolvedProcessingMode;
  automatic: boolean;
  shadow: boolean;
  official: boolean;
  /** Present only for CONFIGURATION_ERROR. */
  problem?: string;
}

/** Longest span one call may process. */
const MAX_RANGE_DAYS = 31;
/** Employees evaluated concurrently. Small on purpose — see processDate. */
const CONCURRENCY = 5;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface BlockedEmployee {
  userId: string;
  blockingReasons: string[];
}

export interface ProcessingResult {
  businessDate: string;
  mode: ProcessingMode;
  /** Set when the configuration was contradictory and nothing was run. */
  configurationError?: string;
  attempted: number;
  evaluated: number;
  unchanged: number;
  needsReview: number;
  /** Employees whose context could not be resolved. Never a fake status. */
  blocked: BlockedEmployee[];
  notApplicable: number;
  failed: Array<{ userId: string; error: string }>;
}

@Injectable()
export class AttendanceProcessingService {
  private readonly logger = new Logger('AttendanceProcessing');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
    private readonly settings: SettingsService,
    private readonly eventLogger: EventLoggerService,
    private readonly evaluator: DailyAttendanceEvaluatorService,
  ) {}

  /**
   * The one authoritative reading of the attendance processing configuration.
   *
   *   automatic off                     -> DISABLED
   *   shadow on,  official off          -> SHADOW
   *   shadow off, official on           -> OFFICIAL
   *   shadow on,  official on           -> CONFIGURATION_ERROR
   *   shadow off, official off          -> DISABLED
   *
   * The ambiguity check runs FIRST, before the automatic switch, so a
   * contradictory configuration is reported the moment it exists rather than
   * lying dormant until somebody turns automation on and gets a surprise.
   *
   * Neither flag is given precedence over the other. Silently picking one would
   * mean the system's behaviour and the administrator's belief could differ on
   * the single question that decides whether attendance is real.
   */
  async mode(): Promise<ProcessingModeState> {
    const cfg = await this.settings.get(ATTENDANCE_V2_SETTING_KEY);
    const read = (key: keyof typeof ATTENDANCE_V2_DEFAULTS) =>
      (cfg?.[key] ?? ATTENDANCE_V2_DEFAULTS[key]) === true;

    const automatic = read('automaticEvaluationEnabled');
    const shadow = read('shadowEnabled');
    const official = read('officialWriteEnabled');

    if (shadow && official) {
      return {
        mode: 'CONFIGURATION_ERROR',
        automatic,
        shadow,
        official,
        problem:
          'shadowEnabled and officialWriteEnabled are both on. Shadow mode observes ' +
          'without writing; official mode writes. Enable exactly one.',
      };
    }
    if (!automatic) return { mode: 'DISABLED', automatic, shadow, official };
    if (shadow) return { mode: 'SHADOW', automatic, shadow, official };
    if (official) return { mode: 'OFFICIAL', automatic, shadow, official };
    return { mode: 'DISABLED', automatic, shadow, official };
  }

  /**
   * Refuses to do anything under a contradictory configuration.
   *
   * Returns the misconfiguration as a result rather than throwing, so a cron
   * tick records it and moves on instead of crashing a scheduled job.
   */
  private async guard(businessDate: string): Promise<ProcessingResult | null> {
    const state = await this.mode();
    if (state.mode !== 'CONFIGURATION_ERROR') return null;

    this.logger.error(`[attendance] ${state.problem}`);
    this.eventLogger.log({
      actorId: 'system',
      entityType: 'DailyAttendance',
      entityId: `misconfigured:${businessDate}`,
      action: OperationalAction.ATTENDANCE_CONFIGURATION_ERROR,
      metadata: {
        businessDate,
        problem: state.problem,
        shadowEnabled: state.shadow,
        officialWriteEnabled: state.official,
      },
    }).catch(() => {});

    return {
      businessDate,
      mode: 'SHADOW',
      configurationError: state.problem,
      attempted: 0,
      evaluated: 0,
      unchanged: 0,
      needsReview: 0,
      blocked: [],
      notApplicable: 0,
      failed: [],
    };
  }

  private assertDate(value: string, label = 'businessDate') {
    if (!DATE_RE.test(value ?? '')) {
      throw new BadRequestException(`${label} must be a yyyy-MM-dd date`);
    }
  }

  /**
   * Evaluates every attendance-covered employee for one business date.
   *
   * Failure is isolated per employee: one unconfigured profile must not stop
   * the other fifty-five people from being evaluated. A context that cannot be
   * resolved is recorded as BLOCKED with its reasons — never as a status, and
   * never silently dropped.
   */
  async processDate(
    businessDate: string,
    options: { mode?: ProcessingMode; employeeIds?: string[]; actorId?: string } = {},
  ): Promise<ProcessingResult> {
    this.assertDate(businessDate);

    // Fail closed. An explicit mode from a caller does NOT override this: the
    // point of the guard is that nobody can accidentally write official
    // attendance while believing they are rehearsing.
    const blocked = await this.guard(businessDate);
    if (blocked) return blocked;

    const state = await this.mode();
    const mode: ProcessingMode =
      options.mode ?? (state.mode === 'OFFICIAL' ? 'OFFICIAL' : 'SHADOW');

    const employees = await this.prisma.user.findMany({
      where: {
        isActive: true,
        ...(options.employeeIds ? { id: { in: options.employeeIds } } : {}),
      },
      select: { id: true },
    });

    const result: ProcessingResult = {
      businessDate,
      mode,
      attempted: employees.length,
      evaluated: 0,
      unchanged: 0,
      needsReview: 0,
      blocked: [],
      notApplicable: 0,
      failed: [],
    };

    // Deliberately a small bounded pool rather than Promise.all over the whole
    // company: each evaluation issues several queries, and a 56-way fan-out
    // would spike a small production database for no user-visible gain.
    for (let i = 0; i < employees.length; i += CONCURRENCY) {
      const batch = employees.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map((employee) => this.processOne(employee.id, businessDate, mode, result)),
      );
    }

    await this.audit(result, options.actorId);
    return result;
  }

  /** One employee-date. Never throws: every outcome is recorded on the result. */
  private async processOne(
    userId: string,
    businessDate: string,
    mode: ProcessingMode,
    result: ProcessingResult,
  ) {
    try {
      if (mode === 'SHADOW') {
        // The real evaluator, the real rules, and no write. This is what makes
        // shadow mode a genuine rehearsal rather than a simulation.
        const evaluated = await this.evaluator.evaluate(userId, businessDate);
        this.record(evaluated, result, userId);
        return;
      }

      const out = await this.evaluator.evaluateAndPersist(userId, businessDate);
      const counted = this.record(out.result, result, userId);
      // An unchanged re-run is reported separately from a fresh write, so an
      // idempotent second pass is visible as such instead of looking like work.
      if (counted && !out.persisted && out.reason === 'UNCHANGED') {
        result.unchanged += 1;
        result.evaluated -= 1;
      }
    } catch (err: any) {
      result.failed.push({ userId, error: err?.message ?? 'Evaluation failed' });
    }
  }

  /** Returns true when the result counted as an evaluated official day. */
  private record(evaluated: any, result: ProcessingResult, userId: string): boolean {
    if (!evaluated.official) {
      if (evaluated.calculationReason === 'CONTEXT_BLOCKED') {
        // The HC-1 gap closed: blocked employees are now countable, from a real
        // per-employee resolve rather than an assumed zero.
        result.blocked.push({
          userId,
          blockingReasons: evaluated.blockingReasons ?? [],
        });
      } else {
        result.notApplicable += 1;
      }
      return false;
    }

    result.evaluated += 1;
    if (evaluated.evaluationState === 'NEEDS_REVIEW') result.needsReview += 1;
    return true;
  }

  /** A bounded multi-day run. Each date is processed independently. */
  async processRange(
    from: string,
    to: string,
    options: { mode?: ProcessingMode; employeeIds?: string[]; actorId?: string } = {},
  ): Promise<ProcessingResult[]> {
    this.assertDate(from, 'from');
    this.assertDate(to, 'to');
    if (from > to) throw new BadRequestException('from must not be after to');

    const dates: string[] = [];
    const cursor = new Date(`${from}T12:00:00.000Z`);
    const stop = new Date(`${to}T12:00:00.000Z`);
    while (cursor.getTime() <= stop.getTime()) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      if (dates.length > MAX_RANGE_DAYS) {
        throw new BadRequestException(`Range is limited to ${MAX_RANGE_DAYS} days`);
      }
    }

    const out: ProcessingResult[] = [];
    for (const date of dates) out.push(await this.processDate(date, options));
    return out;
  }

  /**
   * Finalizes the days that are genuinely eligible.
   *
   * Eligibility is decided entirely by the existing finalize(), which refuses a
   * NEEDS_REVIEW record and is idempotent on one already FINALIZED. Records
   * whose workday is still open never reach it, because an open session leaves
   * the day CALCULATED-with-WORKDAY_STILL_OPEN, which is a review state.
   */
  async finalizeEligible(
    businessDate: string,
    options: { actorId?: string } = {},
  ): Promise<{ businessDate: string; finalized: number; skipped: number; failed: number }> {
    this.assertDate(businessDate);

    // Finalization is the most consequential write in the system, so it is the
    // last place a contradictory configuration should be allowed to proceed.
    const blocked = await this.guard(businessDate);
    if (blocked) return { businessDate, finalized: 0, skipped: 0, failed: 0 };

    const dateOnly = this.tva.companyDateOnly(new Date(`${businessDate}T00:00:00.000Z`));

    const candidates = await this.prisma.dailyAttendance.findMany({
      where: { date: dateOnly, evaluationState: 'CALCULATED', locked: false },
      select: { userId: true },
    });

    let finalized = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of candidates) {
      try {
        const out = await this.evaluator.finalize(row.userId, businessDate);
        if (out.finalized) finalized += 1;
        else skipped += 1;
      } catch {
        failed += 1;
      }
    }

    this.eventLogger.log({
      actorId: options.actorId ?? 'system',
      entityType: 'DailyAttendance',
      entityId: `finalize:${businessDate}`,
      action: OperationalAction.ATTENDANCE_FINALIZED,
      metadata: { businessDate, candidates: candidates.length, finalized, skipped, failed },
    }).catch(() => {});

    return { businessDate, finalized, skipped, failed };
  }

  /**
   * Run summary for the audit trail.
   *
   * Counts, plus the ids of blocked employees so HR can actually go and fix
   * them. No photo keys, no coordinates, no evidence payloads — those live on
   * the immutable evidence and must not be copied into a widely-read stream.
   */
  private async audit(result: ProcessingResult, actorId?: string) {
    await this.eventLogger.log({
      actorId: actorId ?? 'system',
      entityType: 'DailyAttendance',
      entityId: `${result.mode.toLowerCase()}:${result.businessDate}`,
      action:
        result.mode === 'SHADOW'
          ? OperationalAction.ATTENDANCE_SHADOW_RUN
          : OperationalAction.ATTENDANCE_EVALUATION_RUN,
      metadata: {
        businessDate: result.businessDate,
        mode: result.mode,
        attempted: result.attempted,
        evaluated: result.evaluated,
        unchanged: result.unchanged,
        needsReview: result.needsReview,
        notApplicable: result.notApplicable,
        blockedCount: result.blocked.length,
        // Ids and configuration reasons only. Both are exactly what HR needs to
        // resolve the block, and neither is employee evidence.
        blocked: result.blocked.slice(0, 200),
        failedCount: result.failed.length,
      },
    }).catch(() => {});
  }

  /**
   * Blocked employees for a date, read back from the last processing run.
   *
   * Deliberately NOT a fresh per-employee sweep: the console must not run 56
   * context resolutions to render a card. Returns null when no run has happened
   * yet, which the console reports as unavailable rather than as zero.
   */
  async blockedFromLastRun(businessDate: string): Promise<BlockedEmployee[] | null> {
    this.assertDate(businessDate);
    const event = await (this.prisma as any).operationalEvent.findFirst({
      where: {
        entityType: 'DailyAttendance',
        action: {
          in: [
            OperationalAction.ATTENDANCE_EVALUATION_RUN,
            OperationalAction.ATTENDANCE_SHADOW_RUN,
          ],
        },
        entityId: { in: [`shadow:${businessDate}`, `official:${businessDate}`] },
      },
      orderBy: { timestamp: 'desc' },
    });

    if (!event) return null;
    const blocked = (event.metadata as any)?.blocked;
    return Array.isArray(blocked) ? blocked : [];
  }
}
