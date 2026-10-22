import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { COMPANY_CRON_TIMEZONE } from '../../../common/constants/company-time.constants';
import { LeaveService } from './leave.service';

/**
 * Phase 3 leave jobs. No rule lives here: each job calls one idempotent
 * service method, so a missed run is simply caught up by the next one.
 */
@Injectable()
export class LeaveSchedulerService {
  private readonly logger = new Logger(LeaveSchedulerService.name);

  constructor(private readonly leave: LeaveService) {}

  /** Pending requests whose approver became unavailable get a new route. */
  @Cron('*/15 * * * *', { name: 'leave-reroute-sweep', timeZone: COMPANY_CRON_TIMEZONE })
  async reroute() {
    await this.run('reroute', () => this.leave.rerouteSweep());
  }

  /** Setup-pending requests are settled once configuration is repaired. */
  @Cron('10 * * * *', { name: 'leave-setup-resettle', timeZone: COMPANY_CRON_TIMEZONE })
  async resettle() {
    await this.run('resettle', () => this.leave.resettleSetupPending());
  }

  /** Emergency evidence and review reminders, once each working morning. */
  @Cron('0 10 * * *', { name: 'leave-emergency-reminders', timeZone: COMPANY_CRON_TIMEZONE })
  async reminders() {
    await this.run('emergency reminders', () => this.leave.emergencyReminders());
  }

  private async run(label: string, job: () => Promise<unknown>) {
    try {
      const out = await job();
      this.logger.log(`Leave ${label}: ${JSON.stringify(out)}`);
    } catch (error: any) {
      this.logger.warn(`Leave ${label} failed: ${error?.message ?? error}`);
    }
  }
}
