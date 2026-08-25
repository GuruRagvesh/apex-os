import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { COMPANY_CRON_TIMEZONE } from '../../../../common/constants/company-time.constants';
import { TVAService } from '../../../../common/services/tva.service';
import { AttendanceProcessingService } from './attendance-processing.service';

/**
 * Attendance cron entry points (SS-1).
 *
 * Deliberately thin. Every method here answers two questions — is this switched
 * on, and which business date — then hands off to AttendanceProcessingService.
 * No attendance logic lives in a @Cron method, so the same work is reachable
 * from the HR console and from a test without waiting for a clock.
 *
 * Every schedule is pinned to the COMPANY timezone. Without that, a "run at
 * 00:30" job fires at 00:30 UTC — 06:00 IST — and a job whose whole purpose is
 * to evaluate *yesterday* would be reading the wrong day for the first five and
 * a half hours of every morning.
 */
@Injectable()
export class AttendanceSchedulerService {
  private readonly logger = new Logger('AttendanceScheduler');

  constructor(
    private readonly processing: AttendanceProcessingService,
    private readonly tva: TVAService,
  ) {}

  /** Yesterday's business date, in company time. */
  private previousBusinessDate(): string {
    const now = this.tva.now();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return this.tva.companyBusinessDate(yesterday);
  }

  /**
   * In-day pass, hourly during working hours.
   *
   * Produces CALCULATED / NEEDS_REVIEW facts for today so the console is useful
   * before the day ends. It never finalizes: a day whose workday is still open
   * is not a finished day.
   */
  @Cron('20 10-20 * * *', { name: 'attendance-inday', timeZone: COMPANY_CRON_TIMEZONE })
  async inDayPass() {
    // One resolved answer, not three booleans to recombine here.
    const state = await this.processing.mode();
    if (state.mode !== 'SHADOW' && state.mode !== 'OFFICIAL') return;

    const businessDate = this.tva.companyToday();
    const result = await this.processing.processDate(businessDate);
    this.logger.log(
      `[attendance] in-day ${businessDate} mode=${result.mode} evaluated=${result.evaluated} ` +
        `review=${result.needsReview} blocked=${result.blocked.length} failed=${result.failed.length}`,
    );
  }

  /**
   * Post-workday pass for the day that just ended.
   *
   * 00:30 company time, so every session that was going to close has closed.
   * Still does not finalize — finalization is its own decision.
   */
  @Cron('30 0 * * *', { name: 'attendance-postday', timeZone: COMPANY_CRON_TIMEZONE })
  async postWorkdayPass() {
    const state = await this.processing.mode();
    if (state.mode !== 'SHADOW' && state.mode !== 'OFFICIAL') return;

    const businessDate = this.previousBusinessDate();
    const result = await this.processing.processDate(businessDate);
    this.logger.log(
      `[attendance] post-day ${businessDate} mode=${result.mode} evaluated=${result.evaluated} ` +
        `review=${result.needsReview} blocked=${result.blocked.length} failed=${result.failed.length}`,
    );
  }

  /**
   * Finalization of the previous day, well after it closed.
   *
   * Separate from evaluation on purpose, and only ever over records the
   * evaluator itself considers eligible: NEEDS_REVIEW and already-locked days
   * are refused inside finalize(), not filtered out hopefully here.
   *
   * Requires official writes: finalizing in shadow mode would be a contradiction.
   */
  @Cron('0 2 * * *', { name: 'attendance-finalize', timeZone: COMPANY_CRON_TIMEZONE })
  async finalizePreviousDay() {
    // Only OFFICIAL finalizes. DISABLED does nothing, SHADOW has written no
    // official record to finalize, and CONFIGURATION_ERROR is refused outright.
    const state = await this.processing.mode();
    if (state.mode !== 'OFFICIAL') return;

    const businessDate = this.previousBusinessDate();
    const out = await this.processing.finalizeEligible(businessDate);
    this.logger.log(
      `[attendance] finalize ${businessDate} finalized=${out.finalized} skipped=${out.skipped} failed=${out.failed}`,
    );
  }
}
