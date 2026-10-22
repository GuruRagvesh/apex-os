import { Injectable, Optional, forwardRef, Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { TVAService } from '../../../../../common/services/tva.service';
import { NotificationEventService } from '../../../../operations/notifications/notification-event.service';
import { UserSetupIssuesService } from '../../user-setup-issues.service';
import { writeAudit } from '../../employment-continuity';
import { FnfService } from '../fnf/fnf.service';
import { claimKey, findKey, isUniqueViolation, requireIdempotencyKey } from '../request-keys';
import {
  badRequest, conflict, forbidden, isAdmin, isHrOrAdmin, notFound, optionalText, requireText, TRANSITION_CODE, TransitionActor,
} from '../transitions-codes';
import { hrAndAdminIds, notifyMany, resolveDepartmentManager, resolveTeamLead } from '../transition-support';
import { CLEARANCE_CATEGORIES, CLEARANCE_DEFAULTS, evidenceRefProblem, isTerminalClearance, OWNER_TRANSITIONS } from './clearance-defaults';

type Tx = any;

/**
 * Exit clearance (correction 10). The assigned owner (or a holder of the
 * item's HR/Admin capability) moves an item PENDING -> IN_PROGRESS -> DONE,
 * with an opaque evidence reference when the category requires one. Only HR
 * or Admin may waive, mark N/A or reassign. Clearance can finish during
 * notice; it never creates an F&F adjustment.
 */
@Injectable()
export class ClearanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
    private readonly fnf: FnfService,
    @Optional() @Inject(forwardRef(() => NotificationEventService)) private readonly notifier?: NotificationEventService,
    @Optional() private readonly setupIssues?: UserSetupIssuesService,
  ) {}

  /** Creates the nine items for a new case. Missing TL/Manager owners raise a setup issue. */
  async createItems(tx: Tx, exitCaseId: string, user: { id: string; departmentId: string | null }, now: Date) {
    const [tl, mgr] = await Promise.all([
      resolveTeamLead(tx, user.id, user.departmentId, now),
      resolveDepartmentManager(tx, user.id, user.departmentId, now),
    ]);
    const missing: string[] = [];
    const owners: Array<{ category: string; ownerId: string | null }> = [];
    for (const category of CLEARANCE_CATEGORIES) {
      const d = CLEARANCE_DEFAULTS[category];
      const ownerId = d.capability === 'TEAM_LEAD' ? tl : d.capability === 'DEPT_MANAGER' ? mgr : null;
      if ((d.capability === 'TEAM_LEAD' || d.capability === 'DEPT_MANAGER') && !ownerId) missing.push(category);
      await tx.exitClearanceItem.create({
        data: { id: randomUUID(), exitCaseId, category, ownerId, ownerCapability: d.capability, evidenceRequired: d.evidenceRequired, status: 'PENDING' },
      });
      owners.push({ category, ownerId });
    }
    if (missing.length > 0) await this.setupIssues?.record(tx, user.id, 'CLEARANCE_OWNER_MISSING', { categories: missing });
    return owners;
  }

  private canProgress(actor: TransitionActor, item: { ownerId: string | null; ownerCapability: string | null }): boolean {
    if (isHrOrAdmin(actor)) return true;
    return !!item.ownerId && item.ownerId === actor.id;
  }

  async update(actor: TransitionActor, itemId: string, body: any) {
    const key = requireIdempotencyKey(body?.idempotencyKey);
    const action = String(body?.action ?? '').toUpperCase();
    const prior = await findKey(this.prisma, key, 'CLEARANCE_UPDATE');
    if (prior) return this.itemView(await this.prisma.exitClearanceItem.findUnique({ where: { id: prior.entityId } }));
    const now = this.tva.now();
    let caseInfo: { id: string; userId: string } | null = null;
    let effects: any[] = [];
    let item: any;
    try {
      item = await this.prisma.$transaction(async (tx: Tx) => {
        const peek = await tx.exitClearanceItem.findUnique({ where: { id: itemId }, select: { exitCaseId: true } });
        if (!peek) notFound('Clearance item not found.');
        // Lock order: exit case, then item.
        await tx.$queryRaw`SELECT id FROM "exit_cases" WHERE id = ${peek.exitCaseId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "exit_clearance_items" WHERE id = ${itemId} FOR UPDATE`;
        const it = await tx.exitClearanceItem.findUnique({ where: { id: itemId }, include: { exitCase: { select: { id: true, userId: true, state: true } } } });
        caseInfo = { id: it.exitCase.id, userId: it.exitCase.userId };
        if (!['NOTICE_RUNNING', 'CLEARANCE_IN_PROGRESS', 'CLEARED'].includes(it.exitCase.state)) {
          conflict(TRANSITION_CODE.EXIT_CASE_STATE_CHANGED, 'This exit case is closed; its clearance can no longer change.', { state: it.exitCase.state });
        }
        if (it.exitCase.userId === actor.id) forbidden(TRANSITION_CODE.FORBIDDEN, 'You cannot clear your own exit items.');
        const data: Record<string, unknown> = {};
        let audit = 'CLEARANCE_UPDATED';
        if (action === 'START' || action === 'DONE' || action === 'REOPEN') {
          if (!this.canProgress(actor, it)) forbidden(TRANSITION_CODE.FORBIDDEN, 'Only the item owner, HR or an Admin can update this item.');
          const to = action === 'START' ? 'IN_PROGRESS' : action === 'DONE' ? 'DONE' : 'PENDING';
          if (!(OWNER_TRANSITIONS[it.status] ?? []).includes(to)) {
            conflict(TRANSITION_CODE.CLEARANCE_TRANSITION_INVALID, `An item that is ${it.status.toLowerCase().replace(/_/g, ' ')} cannot move to ${to.toLowerCase().replace(/_/g, ' ')}.`, { status: it.status });
          }
          if (to === 'DONE') {
            const ref = optionalText(body?.evidenceRef, 64);
            if (it.evidenceRequired && !ref) badRequest(TRANSITION_CODE.CLEARANCE_EVIDENCE_REQUIRED, 'This item needs an evidence reference before it can be marked done.');
            if (ref) {
              const p = evidenceRefProblem(ref);
              if (p) badRequest(TRANSITION_CODE.CLEARANCE_EVIDENCE_REF_INVALID, p);
            }
            Object.assign(data, { status: 'DONE', evidenceRef: ref, completedById: actor.id, completedAt: now });
            audit = 'CLEARANCE_COMPLETED';
          } else {
            Object.assign(data, { status: to });
          }
        } else if (action === 'WAIVE' || action === 'NOT_APPLICABLE' || action === 'REASSIGN') {
          if (!isHrOrAdmin(actor)) forbidden(TRANSITION_CODE.FORBIDDEN, 'Only HR or an Admin can waive, mark not applicable or reassign an item.');
          if (action === 'REASSIGN') {
            if (isTerminalClearance(it.status)) conflict(TRANSITION_CODE.CLEARANCE_TRANSITION_INVALID, 'A finished item cannot be reassigned.');
            const ownerId = requireText(body?.ownerId, 'New owner', 64);
            const owner = await tx.user.findUnique({ where: { id: ownerId }, select: { id: true, isActive: true, isSystemAccount: true } });
            if (!owner || !owner.isActive || owner.isSystemAccount || owner.id === it.exitCase.userId) {
              badRequest(TRANSITION_CODE.CLEARANCE_OWNER_INVALID, 'Choose an active colleague other than the person leaving.');
            }
            Object.assign(data, { ownerId });
            audit = 'CLEARANCE_REASSIGNED';
          } else {
            if (isTerminalClearance(it.status)) conflict(TRANSITION_CODE.CLEARANCE_TRANSITION_INVALID, 'This item is already finished.');
            const reason = requireText(body?.reason, action === 'WAIVE' ? 'Waiver reason' : 'Reason');
            if (action === 'WAIVE') Object.assign(data, { status: 'WAIVED', waivedById: actor.id, waivedAt: now, waiverReason: reason });
            else Object.assign(data, { status: 'NOT_APPLICABLE', completedById: actor.id, completedAt: now, notApplicableReason: reason });
            audit = action === 'WAIVE' ? 'CLEARANCE_WAIVED' : 'CLEARANCE_NOT_APPLICABLE';
          }
        } else {
          badRequest(TRANSITION_CODE.CLEARANCE_TRANSITION_INVALID, 'Unknown clearance action.');
        }
        const updated = await tx.exitClearanceItem.update({ where: { id: itemId }, data });
        await claimKey(tx, { key, scope: 'CLEARANCE_UPDATE', entityId: itemId, actorId: actor.id });
        await writeAudit(tx, { actorId: actor.id, entityType: 'ExitClearanceItem', entityId: itemId, action: audit, fromState: it.status, toState: updated.status, metadata: { category: it.category } });
        effects = await this.fnf.evaluate(tx, it.exitCase.id, now);
        return updated;
      });
    } catch (err) {
      if (isUniqueViolation(err) && (await findKey(this.prisma, key, 'CLEARANCE_UPDATE'))) {
        return this.itemView(await this.prisma.exitClearanceItem.findUnique({ where: { id: itemId } }));
      }
      throw err;
    }
    await this.fnf.announce(effects);
    const c = caseInfo as { id: string; userId: string } | null;
    if (c && item.status === 'DONE') {
      const staff = await hrAndAdminIds(this.prisma);
      await notifyMany(this.notifier, staff, 'clearanceCompleted', () => ({ title: 'Clearance item completed', message: `${CLEARANCE_DEFAULTS[item.category as keyof typeof CLEARANCE_DEFAULTS]?.label ?? 'A clearance item'} was completed.`, link: `/users/${c.userId}?tab=exit`, entityId: item.id, entityType: 'ExitClearanceItem', dedupeKey: `clr:${item.id}:completed:staff` }));
    }
    if (c && action === 'REASSIGN' && item.ownerId) {
      await notifyMany(this.notifier, [item.ownerId], 'clearanceAssigned', () => ({ title: 'Clearance item assigned to you', message: `You own the "${CLEARANCE_DEFAULTS[item.category as keyof typeof CLEARANCE_DEFAULTS]?.label ?? 'clearance'}" item of a colleague's exit.`, link: '/users/clearance', entityId: item.id, entityType: 'ExitClearanceItem', dedupeKey: `clr:${item.id}:assigned:${item.ownerId}` }));
    }
    return this.itemView(item);
  }

  /** Items the actor can act on in open cases: owned, or held by their HR/Admin capability. */
  async myItems(actor: TransitionActor) {
    const caps: string[] = [];
    if (actor.isHR) caps.push('HR');
    if (isAdmin(actor)) caps.push('ADMIN');
    const rows = await this.prisma.exitClearanceItem.findMany({
      where: {
        status: { in: ['PENDING', 'IN_PROGRESS'] },
        exitCase: { state: { in: ['NOTICE_RUNNING', 'CLEARANCE_IN_PROGRESS', 'CLEARED'] }, userId: { not: actor.id } },
        OR: [{ ownerId: actor.id }, ...(caps.length ? [{ ownerCapability: { in: caps } }] : [])],
      },
      include: { exitCase: { select: { id: true, userId: true, lastWorkingDay: true, user: { select: { name: true, employeeId: true } } } } },
      orderBy: [{ exitCase: { lastWorkingDay: 'asc' } }, { category: 'asc' }],
      take: 200,
    });
    return rows.map((r: any) => ({ ...this.itemView(r), employee: { id: r.exitCase.userId, name: r.exitCase.user?.name ?? null, employeeId: r.exitCase.user?.employeeId ?? null }, lastWorkingDay: r.exitCase.lastWorkingDay.toISOString().slice(0, 10) }));
  }

  itemView(i: any) {
    if (!i) notFound('Clearance item not found.');
    return {
      id: i.id, exitCaseId: i.exitCaseId, category: i.category, label: CLEARANCE_DEFAULTS[i.category as keyof typeof CLEARANCE_DEFAULTS]?.label ?? i.category,
      status: i.status, ownerId: i.ownerId, ownerCapability: i.ownerCapability, ownerNeeded: !i.ownerId && (i.ownerCapability === 'TEAM_LEAD' || i.ownerCapability === 'DEPT_MANAGER'),
      evidenceRequired: i.evidenceRequired, evidenceRef: i.evidenceRef, completedById: i.completedById, completedAt: i.completedAt,
      waivedById: i.waivedById, waivedAt: i.waivedAt, waiverReason: i.waiverReason, notApplicableReason: i.notApplicableReason, cancelledAt: i.cancelledAt, updatedAt: i.updatedAt,
    };
  }
}
