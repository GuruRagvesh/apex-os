import { Injectable, Logger, Optional, forwardRef, Inject } from '@nestjs/common';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { TVAService } from '../../../../../common/services/tva.service';
import { EventsGateway } from '../../../../platform/gateway/events.gateway';
import { NotificationEventService } from '../../../../operations/notifications/notification-event.service';
import { separateEmployment, SeparateInput } from '../../employment-continuity';
import { FnfService, FnfSideEffect } from '../fnf/fnf.service';
import { dayOf } from '../transitions-codes';
import { hrAndAdminIds, notifyMany, supervisorIds } from '../transition-support';

/**
 * Automatic separation after the end of the last working day (D3,
 * correction 4). Recoverable by design:
 *
 *  - the 00:01 company-time job and a 15-minute reconciliation sweep both
 *    process `NOTICE_RUNNING AND separationDueAt <= now`, so a missed or
 *    restarted run is caught up;
 *  - each case is separated in ONE transaction, so it is never half-done;
 *  - the case row is locked first (the same first lock as withdrawal), the
 *    state re-checked under it, and an already separated or withdrawn case is
 *    skipped, so a re-run is a no-op;
 *  - authentication refuses from users.accessEndsAt regardless, so a late job
 *    never leaves access open.
 */
@Injectable()
export class SeparationService {
  private readonly logger = new Logger(SeparationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
    private readonly fnf: FnfService,
    @Optional() private readonly gateway?: EventsGateway,
    @Optional() @Inject(forwardRef(() => NotificationEventService)) private readonly notifier?: NotificationEventService,
  ) {}

  async separateDue(source: SeparateInput['source']): Promise<number> {
    const now = this.tva.now();
    const due = await this.prisma.exitCase.findMany({
      where: { state: 'NOTICE_RUNNING', separatedAt: null, separationDueAt: { lte: now } },
      select: { id: true },
      orderBy: { separationDueAt: 'asc' },
      take: 200,
    });
    let done = 0;
    for (const row of due) {
      try {
        if (await this.separateOne(row.id, source)) done += 1;
      } catch (err: any) {
        this.logger.warn(`Separation failed for exit case ${row.id}: ${err?.message ?? err}`);
      }
    }
    return done;
  }

  /** Separates one case if it is still due. Returns false when there was nothing to do. */
  async separateOne(exitCaseId: string, source: SeparateInput['source'], actorId: string | null = null): Promise<boolean> {
    const now = this.tva.now();
    let effects: FnfSideEffect[] = [];
    const result = await this.prisma.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT id FROM "exit_cases" WHERE id = ${exitCaseId} FOR UPDATE`;
      const c = await tx.exitCase.findUnique({ where: { id: exitCaseId } });
      if (!c || c.state !== 'NOTICE_RUNNING' || c.separatedAt || !c.separationDueAt || c.separationDueAt.getTime() > now.getTime()) return null;
      await tx.$queryRaw`SELECT id FROM "users" WHERE id = ${c.userId} FOR UPDATE`;
      const lwd = dayOf(c.lastWorkingDay)!;
      await separateEmployment(tx, { userId: c.userId, exitCaseId: c.id, lastWorkingDay: lwd, actorId, now, source });
      await tx.exitCase.update({
        where: { id: c.id },
        data: { state: 'CLEARANCE_IN_PROGRESS', separatedAt: now, separatedById: actorId ?? c.userId },
      });
      effects = await this.fnf.evaluate(tx, c.id, now);
      return { userId: c.userId };
    });
    if (!result) return false;
    this.gateway?.disconnectUser(result.userId);
    await this.fnf.announce(effects);
    const user = await this.prisma.user.findUnique({ where: { id: result.userId }, select: { departmentId: true } });
    const recipients = [...(await hrAndAdminIds(this.prisma)), ...(await supervisorIds(this.prisma, result.userId, user?.departmentId ?? null, now))];
    await notifyMany(this.notifier, recipients, 'exitSeparated', () => ({
      title: 'Employee separated', message: 'The last working day has ended. Access is closed; clearance and F&F continue.',
      link: `/users/${result.userId}?tab=exit`, entityId: exitCaseId, entityType: 'ExitCase', dedupeKey: `exit:${exitCaseId}:separated`,
    }));
    return true;
  }
}
