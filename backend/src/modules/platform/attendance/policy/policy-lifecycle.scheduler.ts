import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { COMPANY_CRON_TIMEZONE } from '../../../../common/constants/company-time.constants';
import { PolicyVersionService } from './policy-version.service';

/**
 * Tidies SCHEDULED policy versions into ACTIVE once their company date
 * arrives (Phase 3). Resolution never waits for this job -- a SCHEDULED version
 * governs from its date by itself -- so a missed run changes only a status
 * label, and the next run (or the next start-up) catches up.
 */
@Injectable()
export class PolicyLifecycleScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(PolicyLifecycleScheduler.name);

  constructor(private readonly policies: PolicyVersionService) {}

  onApplicationBootstrap() {
    void this.settle();
  }

  @Cron('5 0 * * *', { name: 'policy-scheduled-settle', timeZone: COMPANY_CRON_TIMEZONE })
  async settle() {
    try {
      const settled = await this.policies.settleScheduledSupersessions();
      if (settled > 0) this.logger.log(`Activated ${settled} scheduled policy version(s)`);
    } catch (error: any) {
      this.logger.warn(`Scheduled policy settle failed: ${error?.message ?? error}`);
    }
  }
}
