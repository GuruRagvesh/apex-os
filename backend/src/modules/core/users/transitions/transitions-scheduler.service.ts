import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { COMPANY_CRON_TIMEZONE } from '../../../../common/constants/company-time.constants';
import { TransitionCapabilitiesService } from './capabilities.service';
import { TransferService } from './transfer/transfer.service';
import { SeparationService } from './exit/separation.service';
import { FnfService } from './fnf/fnf.service';
import { LegalHoldsService } from './compliance/legal-holds.service';

/**
 * Phase 4 jobs. Each runs only when its capability is enabled, and every one
 * is idempotent (row lock + state re-check), so the 15-minute reconciliation
 * sweeps double as catch-up after a restart or a missed run.
 */
@Injectable()
export class TransitionsSchedulerService {
  private readonly logger = new Logger(TransitionsSchedulerService.name);

  constructor(
    private readonly caps: TransitionCapabilitiesService,
    private readonly transfers: TransferService,
    private readonly separation: SeparationService,
    private readonly fnf: FnfService,
    private readonly holds: LegalHoldsService,
  ) {}

  private async guarded(name: string, cap: 'transfer' | 'exit' | 'compliance', fn: () => Promise<unknown>) {
    try {
      if (!(await this.caps.isEnabled(cap))) return;
      await fn();
    } catch (err: any) {
      this.logger.warn(`${name} failed: ${err?.message ?? err}`);
    }
  }

  @Cron('30 0 0 * * *', { name: 'transfer-activation-midnight', timeZone: COMPANY_CRON_TIMEZONE })
  transferMidnight() { return this.guarded('transfer midnight', 'transfer', () => this.transfers.activateDue()); }

  @Cron('0 */15 * * * *', { name: 'transfer-activation-sweep', timeZone: COMPANY_CRON_TIMEZONE })
  transferSweep() { return this.guarded('transfer sweep', 'transfer', () => this.transfers.activateDue()); }

  @Cron('0 1 0 * * *', { name: 'exit-separation-midnight', timeZone: COMPANY_CRON_TIMEZONE })
  separationMidnight() { return this.guarded('separation', 'exit', () => this.separation.separateDue('SCHEDULER')); }

  @Cron('0 */15 * * * *', { name: 'exit-separation-reconcile', timeZone: COMPANY_CRON_TIMEZONE })
  separationSweep() { return this.guarded('separation reconcile', 'exit', () => this.separation.separateDue('RECONCILIATION')); }

  @Cron('0 20 9 * * *', { name: 'fnf-escalation', timeZone: COMPANY_CRON_TIMEZONE })
  fnfEscalation() { return this.guarded('fnf escalation', 'exit', () => this.fnf.escalationSweep()); }

  @Cron('0 40 9 * * *', { name: 'legal-hold-reminders', timeZone: COMPANY_CRON_TIMEZONE })
  holdReminders() { return this.guarded('hold reminders', 'compliance', () => this.holds.reminderSweep()); }
}
