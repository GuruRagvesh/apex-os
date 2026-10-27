import { Injectable, Optional, forwardRef, Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { TVAService } from '../../../../../common/services/tva.service';
import { RemediationException } from '../../../../../common/remediation/remediation.exception';
import { buildRemediation } from '../../../../../common/remediation/remediation.serializer';
import { NotificationEventService } from '../../../../operations/notifications/notification-event.service';
import { writeAudit } from '../../employment-continuity';
import { FnfService } from '../fnf/fnf.service';
import { ClearanceService } from './clearance.service';
import { claimKey, findKey, isUniqueViolation, requireIdempotencyKey } from '../request-keys';
import {
  badRequest, businessDate, conflict, dateOnly, dayOf, forbidden, isAdmin, isHrOrAdmin, notFound, optionalText, requireHrOrAdmin,
  requireText, TRANSITION_CODE, TransitionActor,
} from '../transitions-codes';
import { hrAndAdminIds, notifyMany, supervisorIds } from '../transition-support';
import { adjustmentProblem, defaultNoticeForEmployee, lastWorkingDay, NoticeSource, separationDueAt, withdrawalClosesAt } from './notice';

type Tx = any;
const OPEN_STATES = ['NOTICE_RUNNING', 'CLEARANCE_IN_PROGRESS', 'CLEARED'];

/**
 * Resignation, notice, probation verification and withdrawal (Workstream B).
 *
 * Every mutation: idempotency key, row lock (exit case before user), a state
 * re-check on the server, the audit event in the same transaction, and a
 * friendly structured 409 when the state moved underneath the caller.
 */
@Injectable()
export class ExitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
    private readonly fnf: FnfService,
    private readonly clearance: ClearanceService,
    @Optional() @Inject(forwardRef(() => NotificationEventService)) private readonly notifier?: NotificationEventService,
  ) {}

  private tz() {
    return this.tva.companyTimezone();
  }

  // ── Probation verification ───────────────────────────────────────────────

  async verifyProbation(actor: TransitionActor, userId: string, body: any) {
    requireHrOrAdmin(actor);
    const key = requireIdempotencyKey(body?.idempotencyKey);
    const status = String(body?.probationStatus ?? '').toUpperCase();
    if (status !== 'PROBATION' && status !== 'CONFIRMED') badRequest(TRANSITION_CODE.EXIT_NOTICE_ADJUSTMENT_INVALID, 'Choose Probation or Confirmed.');
    if (await findKey(this.prisma, key, 'PROBATION_VERIFY')) return this.employmentSummary(userId);
    const now = this.tva.now();
    try {
      await this.prisma.$transaction(async (tx: Tx) => {
        await tx.$queryRaw`SELECT id FROM "users" WHERE id = ${userId} FOR UPDATE`;
        const open = await tx.employmentPeriod.findFirst({ where: { userId, endDate: null } });
        if (!open) conflict(TRANSITION_CODE.EXIT_NO_EMPLOYMENT_PERIOD, 'This person has no open employment record. Ask an Admin to repair it first.');
        const openExit = await tx.exitCase.count({ where: { userId, state: { in: OPEN_STATES as any } } });
        if (openExit > 0) conflict(TRANSITION_CODE.EXIT_CASE_ALREADY_OPEN, 'Probation status cannot change while an exit case is open; adjust the notice instead.');
        await tx.employmentPeriod.update({ where: { id: open.id }, data: { probationStatus: status, probationVerifiedById: actor.id, probationVerifiedAt: now } });
        await claimKey(tx, { key, scope: 'PROBATION_VERIFY', entityId: userId, actorId: actor.id });
        await writeAudit(tx, { actorId: actor.id, entityType: 'EmploymentPeriod', entityId: open.id, action: 'PROBATION_STATUS_VERIFIED', fromState: open.probationStatus ?? null, toState: status });
      });
    } catch (err) {
      if (!(isUniqueViolation(err) && (await findKey(this.prisma, key, 'PROBATION_VERIFY')))) throw err;
    }
    return this.employmentSummary(userId);
  }

  async employmentSummary(userId: string) {
    const p = await this.prisma.employmentPeriod.findFirst({ where: { userId, endDate: null }, select: { id: true, startDate: true, probationStatus: true, probationVerifiedAt: true, probationVerifiedById: true } });
    return { employmentPeriod: p ? { ...p, startDate: dayOf(p.startDate) } : null };
  }

  // ── Start ────────────────────────────────────────────────────────────────

  async start(actor: TransitionActor, userId: string, body: any) {
    const key = requireIdempotencyKey(body?.idempotencyKey);
    const self = actor.id === userId;
    if (!self && !isHrOrAdmin(actor)) forbidden(TRANSITION_CODE.FORBIDDEN, 'Only the employee, HR or an Admin can start a resignation.');
    const prior = await findKey(this.prisma, key, 'EXIT_START');
    if (prior) return this.timeline(actor, prior.entityId);

    const today = this.tva.companyToday();
    const resignedOn = body?.resignedOn ? businessDate(body.resignedOn, 'Resignation date') : today;
    if (resignedOn > today) badRequest(TRANSITION_CODE.EXIT_RESIGNATION_DATE_INVALID, 'A resignation cannot be dated in the future.');
    let backdateReason: string | null = null;
    let backdateReference: string | null = null;
    if (resignedOn < today) {
      if (self) badRequest(TRANSITION_CODE.EXIT_BACKDATE_NOT_ALLOWED, 'You can submit your resignation for today only. Ask HR if it should be dated earlier.');
      backdateReason = requireText(body?.backdateReason, 'Backdating reason');
      backdateReference = requireText(body?.backdateReference, 'Backdating reference', 120);
    }

    const now = this.tva.now();
    let exitCaseId = '';
    let notifyInfo: { departmentId: string | null } = { departmentId: null };
    try {
      await this.prisma.$transaction(async (tx: Tx) => {
        await tx.$queryRaw`SELECT id FROM "users" WHERE id = ${userId} FOR UPDATE`;
        const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, isActive: true, isSystemAccount: true, employmentState: true, departmentId: true, joiningDate: true, employmentType: true, designation: true, role: { select: { name: true } } } });
        if (!user || user.isSystemAccount || !user.isActive || user.employmentState === 'ARCHIVED' || user.employmentState === 'SCHEDULED_TO_JOIN') {
          conflict(TRANSITION_CODE.EXIT_USER_NOT_ELIGIBLE, 'A resignation can be started only for an active employee.');
        }
        notifyInfo = { departmentId: user.departmentId };
        const period = await tx.employmentPeriod.findFirst({ where: { userId, endDate: null } });
        if (!period) conflict(TRANSITION_CODE.EXIT_NO_EMPLOYMENT_PERIOD, 'This person has no open employment record. Ask an Admin to repair it before starting an exit.');
        if (resignedOn < dayOf(period.startDate)!) badRequest(TRANSITION_CODE.EXIT_RESIGNATION_DATE_INVALID, 'The resignation date is before this employment started.');
        const open = await tx.exitCase.findFirst({ where: { userId, state: { in: OPEN_STATES as any } }, select: { id: true } });
        if (open) conflict(TRANSITION_CODE.EXIT_CASE_ALREADY_OPEN, 'This person already has an open exit case.', { exitCaseId: open.id });
        if (!period.probationVerifiedAt || !period.probationStatus) {
          throw new RemediationException(buildRemediation(TRANSITION_CODE.PROBATION_STATUS_UNVERIFIED, { affectedUserId: userId }), 409);
        }
        const { noticeDays, noticeSource, noticePolicyCode } = defaultNoticeForEmployee({
          roleName: user.role?.name,
          employmentType: user.employmentType,
          designation: user.designation,
        });
        const lwd = lastWorkingDay(resignedOn, noticeDays);
        const due = separationDueAt(lwd, this.tz());
        exitCaseId = randomUUID();
        await tx.exitCase.create({
          data: {
            id: exitCaseId, userId, employmentPeriodId: period.id, state: 'NOTICE_RUNNING', resignedOn: dateOnly(resignedOn), noticeDays, defaultNoticeDays: noticeDays,
            noticeSource, noticePolicyCode, lastWorkingDay: dateOnly(lwd), separationDueAt: due, idempotencyKey: key, createdById: actor.id, submittedById: actor.id,
            backdateReason, backdateReference,
          },
        });
        await tx.user.update({ where: { id: userId }, data: { accessEndsAt: due } });
        await this.clearance.createItems(tx, exitCaseId, { id: userId, departmentId: user.departmentId }, now);
        await this.fnf.createSettlement(tx, exitCaseId, userId, lwd, now);
        await claimKey(tx, { key, scope: 'EXIT_START', entityId: exitCaseId, actorId: actor.id });
        await writeAudit(tx, {
          actorId: actor.id, entityType: 'ExitCase', entityId: exitCaseId, action: 'RESIGNATION_STARTED', toState: 'NOTICE_RUNNING',
          metadata: { noticeSource, noticePolicyCode, noticeDays, selfService: self, backdated: !!backdateReason },
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const k = await findKey(this.prisma, key, 'EXIT_START');
        if (k) return this.timeline(actor, k.entityId);
        const open = await this.prisma.exitCase.findFirst({ where: { userId, state: { in: OPEN_STATES as any } }, select: { id: true } });
        if (open) conflict(TRANSITION_CODE.EXIT_CASE_ALREADY_OPEN, 'This person already has an open exit case.', { exitCaseId: open.id });
      }
      throw err;
    }
    await this.announce(exitCaseId, userId, notifyInfo.departmentId, 'started');
    return this.timeline(actor, exitCaseId);
  }

  // ── Notice adjustment / waiver ─────────────────────────────────────────────

  async adjustNotice(actor: TransitionActor, exitCaseId: string, body: any) {
    requireHrOrAdmin(actor);
    const key = requireIdempotencyKey(body?.idempotencyKey);
    if (await findKey(this.prisma, key, 'EXIT_NOTICE_ADJUST')) return this.timeline(actor, exitCaseId);
    const source = String(body?.source ?? '').toUpperCase() as NoticeSource;
    const waive = body?.waive === true;
    const adj = {
      source: waive ? ('MANAGEMENT_ADJUSTMENT' as NoticeSource) : source,
      noticeDays: waive ? 0 : Number(body?.noticeDays),
      reason: optionalText(body?.reason),
      reference: optionalText(body?.reference, 120),
    };
    const problem = adjustmentProblem(adj);
    if (problem) badRequest(TRANSITION_CODE.EXIT_NOTICE_ADJUSTMENT_INVALID, problem);
    const now = this.tva.now();
    let userId = '';
    try {
      await this.prisma.$transaction(async (tx: Tx) => {
        await tx.$queryRaw`SELECT id FROM "exit_cases" WHERE id = ${exitCaseId} FOR UPDATE`;
        const c = await tx.exitCase.findUnique({ where: { id: exitCaseId } });
        if (!c) notFound('Exit case not found.');
        userId = c.userId;
        await tx.$queryRaw`SELECT id FROM "users" WHERE id = ${c.userId} FOR UPDATE`;
        if (c.state !== 'NOTICE_RUNNING' || c.separatedAt) conflict(TRANSITION_CODE.EXIT_CASE_STATE_CHANGED, 'Notice can be changed only while it is still running.', { state: c.state });
        const resignedOn = dayOf(c.resignedOn)!;
        const lwd = lastWorkingDay(resignedOn, adj.noticeDays);
        const due = separationDueAt(lwd, this.tz());
        await tx.exitCase.update({
          where: { id: c.id },
          data: {
            noticeDays: adj.noticeDays, noticeSource: adj.source, noticeAdjustmentReason: adj.reason, noticeReference: adj.reference,
            noticeAdjustedById: actor.id, noticeAdjustedAt: now, lastWorkingDay: dateOnly(lwd), separationDueAt: due,
          },
        });
        await tx.user.update({ where: { id: c.userId }, data: { accessEndsAt: due } });
        await this.fnf.recomputeDeadline(tx, c.id, c.userId, lwd, now);
        await claimKey(tx, { key, scope: 'EXIT_NOTICE_ADJUST', entityId: c.id, actorId: actor.id });
        await writeAudit(tx, {
          actorId: actor.id, entityType: 'ExitCase', entityId: c.id, action: waive ? 'NOTICE_WAIVED' : 'NOTICE_ADJUSTED',
          metadata: { from: { noticeDays: c.noticeDays, source: c.noticeSource }, to: { noticeDays: adj.noticeDays, source: adj.source } },
        });
      });
    } catch (err) {
      if (!(isUniqueViolation(err) && (await findKey(this.prisma, key, 'EXIT_NOTICE_ADJUST')))) throw err;
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { departmentId: true } });
    await this.announce(exitCaseId, userId, user?.departmentId ?? null, 'notice_adjusted');
    return this.timeline(actor, exitCaseId);
  }

  // ── Withdrawal (D6, correction 5) ────────────────────────────────────────

  async withdraw(actor: TransitionActor, exitCaseId: string, body: any) {
    const key = requireIdempotencyKey(body?.idempotencyKey);
    if (await findKey(this.prisma, key, 'EXIT_WITHDRAW')) return this.timeline(actor, exitCaseId);
    const reason = optionalText(body?.reason);
    const now = this.tva.now();
    let userId = '';
    try {
      await this.prisma.$transaction(async (tx: Tx) => {
        // Same first lock as the separation job: only one of them can win.
        await tx.$queryRaw`SELECT id FROM "exit_cases" WHERE id = ${exitCaseId} FOR UPDATE`;
        const c = await tx.exitCase.findUnique({ where: { id: exitCaseId }, include: { settlement: true } });
        if (!c) notFound('Exit case not found.');
        userId = c.userId;
        if (c.userId !== actor.id && !isHrOrAdmin(actor)) forbidden(TRANSITION_CODE.FORBIDDEN, 'Only the employee, HR or an Admin can withdraw this resignation.');
        await tx.$queryRaw`SELECT id FROM "users" WHERE id = ${c.userId} FOR UPDATE`;
        if (c.state !== 'NOTICE_RUNNING' || c.separatedAt) {
          conflict(TRANSITION_CODE.EXIT_CASE_STATE_CHANGED, 'This resignation can no longer be withdrawn; its state changed.', { state: c.state });
        }
        const lwd = dayOf(c.lastWorkingDay)!;
        if (now.getTime() >= withdrawalClosesAt(lwd, this.tz()).getTime()) {
          throw new RemediationException(buildRemediation(TRANSITION_CODE.RESIGNATION_WITHDRAWAL_CLOSED, { affectedUserId: c.userId }), 409);
        }
        await tx.exitCase.update({ where: { id: c.id }, data: { state: 'WITHDRAWN', withdrawnAt: now, withdrawnById: actor.id, withdrawalReason: reason } });
        // Same EmploymentPeriod, no rehire, no new probation: only access is restored.
        await tx.user.update({ where: { id: c.userId }, data: { accessEndsAt: null } });
        await tx.exitClearanceItem.updateMany({ where: { exitCaseId: c.id, status: { in: ['PENDING', 'IN_PROGRESS'] } }, data: { status: 'CANCELLED', cancelledAt: now } });
        if (c.settlement && c.settlement.state !== 'RELEASED') {
          await tx.fnfAdjustmentRequest.updateMany({ where: { settlementId: c.settlement.id, status: 'PENDING' }, data: { status: 'CANCELLED', decidedAt: now } });
          await tx.fnfSettlement.update({ where: { id: c.settlement.id }, data: { state: 'CANCELLED', cancelledAt: now, holdReason: null } });
        }
        await claimKey(tx, { key, scope: 'EXIT_WITHDRAW', entityId: c.id, actorId: actor.id });
        await writeAudit(tx, { actorId: actor.id, entityType: 'ExitCase', entityId: c.id, action: 'RESIGNATION_WITHDRAWN', fromState: 'NOTICE_RUNNING', toState: 'WITHDRAWN', metadata: { selfService: actor.id === c.userId } });
      });
    } catch (err) {
      if (!(isUniqueViolation(err) && (await findKey(this.prisma, key, 'EXIT_WITHDRAW')))) throw err;
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { departmentId: true } });
    await this.announce(exitCaseId, userId, user?.departmentId ?? null, 'withdrawn');
    return this.timeline(actor, exitCaseId);
  }

  // ── Views ────────────────────────────────────────────────────────────────

  private async canRead(actor: TransitionActor, userId: string, departmentId: string | null): Promise<'STAFF' | 'SELF' | 'SUPERVISOR' | null> {
    if (isHrOrAdmin(actor)) return 'STAFF';
    if (actor.id === userId) return 'SELF';
    const sup = await supervisorIds(this.prisma, userId, departmentId, this.tva.now());
    return sup.includes(actor.id) ? 'SUPERVISOR' : null;
  }

  async timeline(actor: TransitionActor, exitCaseId: string) {
    const c = await this.prisma.exitCase.findUnique({
      where: { id: exitCaseId },
      include: {
        user: { select: { id: true, name: true, employeeId: true, departmentId: true } },
        clearanceItems: { orderBy: { createdAt: 'asc' } },
        settlement: { include: { adjustments: { orderBy: { createdAt: 'asc' } }, requests: { orderBy: { requestedAt: 'asc' } } } },
      },
    });
    if (!c) notFound('Exit case not found.');
    const access = await this.canRead(actor, c.userId, c.user?.departmentId ?? null);
    if (!access) forbidden(TRANSITION_CODE.FORBIDDEN, 'You cannot see this exit case.');
    const events = await this.prisma.operationalEvent.findMany({
      where: {
        OR: [
          { entityType: 'ExitCase', entityId: c.id },
          { entityType: 'ExitClearanceItem', entityId: { in: c.clearanceItems.map((i: any) => i.id) } },
          ...(c.settlement ? [{ entityType: 'FnfSettlement', entityId: c.settlement.id }] : []),
        ],
      },
      orderBy: { timestamp: 'asc' },
      select: { id: true, action: true, fromState: true, toState: true, timestamp: true, actorId: true, entityType: true },
      take: 500,
    });
    const tz = this.tz();
    const lwd = dayOf(c.lastWorkingDay)!;
    const staff = access === 'STAFF';
    return {
      id: c.id,
      userId: c.userId,
      employee: { id: c.user.id, name: c.user.name, employeeId: c.user.employeeId },
      state: c.state,
      resignedOn: dayOf(c.resignedOn),
      noticeDays: c.noticeDays,
      defaultNoticeDays: c.defaultNoticeDays,
      noticeSource: c.noticeSource,
      lastWorkingDay: lwd,
      separationDueAt: c.separationDueAt,
      separatedAt: c.separatedAt,
      withdrawnAt: c.withdrawnAt,
      canWithdraw: c.state === 'NOTICE_RUNNING' && !c.separatedAt && this.tva.now() < withdrawalClosesAt(lwd, tz) && (staff || access === 'SELF'),
      withdrawalClosesAt: withdrawalClosesAt(lwd, tz),
      ...(staff
        ? {
            noticeAdjustmentReason: c.noticeAdjustmentReason, noticeReference: c.noticeReference, noticeAdjustedById: c.noticeAdjustedById,
            noticeAdjustedAt: c.noticeAdjustedAt, backdateReason: c.backdateReason, backdateReference: c.backdateReference,
            withdrawalReason: c.withdrawalReason, createdById: c.createdById,
          }
        : {}),
      clearance: c.clearanceItems.map((i: any) => {
        const v = this.clearance.itemView(i);
        return staff ? v : { id: v.id, category: v.category, label: v.label, status: v.status, ownerNeeded: v.ownerNeeded, completedAt: v.completedAt };
      }),
      settlement: c.settlement ? (staff ? this.fnf.staffSettlement(c.settlement) : access === 'SELF' ? this.fnf.employeeSettlement(c.settlement) : { state: c.settlement.state, deadlineOn: dayOf(c.settlement.deadlineOn) }) : null,
      events: events.map((e: any) => (staff ? e : { id: e.id, action: e.action, toState: e.toState, timestamp: e.timestamp })),
    };
  }

  /** The person's cases (latest first): the timeline for their own "My resignation" page. */
  async forUser(actor: TransitionActor, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, departmentId: true } });
    if (!user) notFound('User not found.');
    const access = await this.canRead(actor, userId, user.departmentId);
    if (!access) forbidden(TRANSITION_CODE.FORBIDDEN, 'You cannot see this person\'s exit cases.');
    const rows = await this.prisma.exitCase.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    const cases = [];
    for (const r of rows.slice(0, 10)) cases.push(await this.timeline(actor, r.id));
    const summary = await this.employmentSummary(userId);
    return { cases, ...(access === 'STAFF' || access === 'SELF' ? summary : {}) };
  }

  async list(actor: TransitionActor, q: any) {
    requireHrOrAdmin(actor);
    const take = Math.min(Math.max(Number(q?.pageSize) || 25, 1), 100);
    const page = Math.max(Number(q?.page) || 1, 1);
    const state = typeof q?.state === 'string' && q.state ? q.state.split(',').filter((s: string) => /^[A-Z_]+$/.test(s)) : undefined;
    const where: any = { ...(state?.length ? { state: { in: state } } : {}) };
    const [total, rows] = await Promise.all([
      this.prisma.exitCase.count({ where }),
      this.prisma.exitCase.findMany({
        where, orderBy: [{ lastWorkingDay: 'asc' }, { id: 'asc' }], skip: (page - 1) * take, take,
        include: { user: { select: { id: true, name: true, employeeId: true } }, settlement: { select: { state: true, deadlineOn: true } }, clearanceItems: { select: { status: true } } },
      }),
    ]);
    return {
      page, pageSize: take, total,
      items: rows.map((c: any) => ({
        id: c.id, state: c.state, employee: c.user, resignedOn: dayOf(c.resignedOn), lastWorkingDay: dayOf(c.lastWorkingDay), separatedAt: c.separatedAt,
        fnfState: c.settlement?.state ?? null, fnfDeadlineOn: dayOf(c.settlement?.deadlineOn),
        clearanceOpen: c.clearanceItems.filter((i: any) => i.status === 'PENDING' || i.status === 'IN_PROGRESS').length,
      })),
    };
  }

  private async announce(exitCaseId: string, userId: string, departmentId: string | null, what: 'started' | 'withdrawn' | 'notice_adjusted') {
    const now = this.tva.now();
    const staff = await hrAndAdminIds(this.prisma);
    const sup = await supervisorIds(this.prisma, userId, departmentId, now);
    const titles = { started: 'Resignation submitted', withdrawn: 'Resignation withdrawn', notice_adjusted: 'Notice period changed' };
    const event = { started: 'exitResignationStarted', withdrawn: 'exitResignationWithdrawn', notice_adjusted: 'exitNoticeAdjusted' }[what];
    const n = what === 'notice_adjusted' ? `:${now.getTime()}` : '';
    await notifyMany(this.notifier, [...staff, ...sup].filter((id) => id !== userId), event, () => ({
      title: titles[what], message: 'Open the exit timeline for the details.', link: `/users/${userId}?tab=exit`, entityId: exitCaseId, entityType: 'ExitCase',
      dedupeKey: `exit:${exitCaseId}:${what}${n}`,
    }));
    await notifyMany(this.notifier, [userId], event, () => ({
      title: titles[what], message: what === 'withdrawn' ? 'Your resignation was withdrawn. Your employment continues as before.' : 'See your resignation page for your last working day and clearance.',
      link: '/profile/resignation', entityId: exitCaseId, entityType: 'ExitCase', dedupeKey: `exit:${exitCaseId}:${what}${n}:employee`,
    }));
  }
}
