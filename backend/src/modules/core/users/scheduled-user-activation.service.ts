import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { TVAService } from '../../../common/services/tva.service';
import { COMPANY_CRON_TIMEZONE } from '../../../common/constants/company-time.constants';
import { UserSetupIssuesService } from './user-setup-issues.service';

/**
 * Activates future-dated employees on the company business date. The compare
 * and update predicate make every run idempotent; two app instances may see
 * the same row, but only one can change it and write the activation evidence.
 */
@Injectable()
export class ScheduledUserActivationService {
  private readonly logger = new Logger(ScheduledUserActivationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
    @Optional() private readonly setupIssues?: UserSetupIssuesService,
  ) {}

  @Cron('*/5 * * * *', { name: 'scheduled-user-activation', timeZone: COMPANY_CRON_TIMEZONE })
  async runScheduledActivation() {
    return this.activateDue(this.tva.companyDateOnly());
  }

  async activateDue(companyDate: Date) {
    const due = await this.prisma.user.findMany({
      where: {
        isSystemAccount: false,
        isActive: false,
        employmentState: 'SCHEDULED_TO_JOIN',
        scheduledActivationOn: { lte: companyDate },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    let activated = 0;
    const failed: string[] = [];
    for (const person of due) {
      try {
        const changed = await this.prisma.$transaction(async (tx) => {
          const update = await tx.user.updateMany({
            where: {
              id: person.id,
              isActive: false,
              employmentState: 'SCHEDULED_TO_JOIN',
              scheduledActivationOn: { lte: companyDate },
            },
            data: { isActive: true, employmentState: 'ACTIVE', scheduledActivationOn: null },
          });
          if (update.count !== 1) return false;
          await tx.operationalEvent.create({
            data: {
              actorId: person.id,
              entityType: 'User',
              entityId: person.id,
              action: 'USER_SCHEDULED_ACTIVATED',
              fromState: 'SCHEDULED_TO_JOIN',
              toState: 'ACTIVE',
              metadata: { reasonCode: 'JOINING_DATE_REACHED', counts: {}, eventSchemaVersion: 1 },
            },
          });
          await tx.notification.create({
            data: {
              userId: person.id,
              title: 'Your Apex OS account is active',
              message: 'Your joining date has arrived and your account is now active.',
              type: 'SUCCESS',
              entityType: 'User',
              entityId: person.id,
              dedupeKey: `scheduled-user-activated:${person.id}`,
            },
          });
          return true;
        });
        if (changed) {
          activated += 1;
          await this.setupIssues?.resolve(this.prisma, person.id, 'SCHEDULED_ACTIVATION_FAILED').catch(() => undefined);
        }
      } catch (error) {
        failed.push(person.id);
        this.logger.error(`Scheduled activation failed for user ${person.id}`, error instanceof Error ? error.stack : undefined);
        // The next run retries; the administrators are told once (B4/B9).
        if (this.setupIssues) {
          await this.setupIssues
            .record(this.prisma, person.id, 'SCHEDULED_ACTIVATION_FAILED', { scheduledFor: companyDate.toISOString().slice(0, 10) })
            .then(() => this.setupIssues!.notifyPending(person.id))
            .catch(() => undefined);
        }
      }
    }
    return { checked: due.length, activated, failed };
  }
}
