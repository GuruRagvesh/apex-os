import { Injectable, Optional, forwardRef, Inject } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { TVAService } from '../../../../../common/services/tva.service';
import { NotificationEventService } from '../../../../operations/notifications/notification-event.service';
import { UserSetupIssuesService } from '../../user-setup-issues.service';
import { writeAudit } from '../../employment-continuity';
import { claimKey, findKey, isUniqueViolation, requireIdempotencyKey } from '../request-keys';
import {
  badRequest, conflict, dayOf, forbidden, isAdmin, notFound, requireAdmin, requireHrOrAdmin, requireText,
  optionalText, TRANSITION_CODE, TransitionActor,
} from '../transitions-codes';
import { hrAndAdminIds, notifyMany } from '../transition-support';
import { allSettled, adjustmentProblem, evaluateFnf, FNF_REASONS, FnfState, releaseProblem } from './fnf-rules';
import {
  calendarFromBasis, CalendarBasis, FALLBACK_BASIS, firstEscalationOn, fnfDeadline, nextEscalationAfter, resolveWorkingCalendar,
} from './working-calendar';

type Tx = Prisma.TransactionClient | any;

export interface FnfSideEffect {
  event: 'fnf.ready' | 'fnf.held' | 'fnf.released' | 'exit.cleared';
  exitCaseId: string;
  userId: string;
}

/**
 * F&F settlement: deadline, readiness, release and four-eyes adjustments.
 * Clearance never creates an adjustment, and nothing here forfeits pay.
 */
@Injectable()
export class FnfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
    @Optional() @Inject(forwardRef(() => NotificationEventService)) private readonly notifier?: NotificationEventService,
    @Optional() private readonly setupIssues?: UserSetupIssuesService,
  ) {}

  /**
   * The deadline and its basis for an LWD. The calendar in force on the LWD
   * is used; with none, the standard weekday fallback (and a setup warning).
   */
  async deadlineFor(tx: Tx, userId: string, lwd: string, now: Date) {
    const cal = await resolveWorkingCalendar(tx, userId, lwd, now);
    const deadlineOn = fnfDeadline(cal, lwd);
    const basis: CalendarBasis & { lwd: string; deadlineOn: string } = { ...cal.basis, lwd, deadlineOn };
    if (cal.basis.source === FALLBACK_BASIS) await this.setupIssues?.record(tx, userId, 'WORKING_CALENDAR_FALLBACK', { reasonCode: FALLBACK_BASIS });
    return { deadlineOn, basis, nextEscalationOn: firstEscalationOn(cal, lwd) };
  }

  async createSettlement(tx: Tx, exitCaseId: string, userId: string, lwd: string, now: Date) {
    const d = await this.deadlineFor(tx, userId, lwd, now);
    return tx.fnfSettlement.create({
      data: {
        id: randomUUID(), exitCaseId, state: 'NOT_STARTED', deadlineOn: new Date(`${d.deadlineOn}T00:00:00.000Z`),
        deadlineBasis: d.basis as any, nextEscalationOn: new Date(`${d.nextEscalationOn}T00:00:00.000Z`),
      },
    });
  }

  /** Before separation only: an LWD change recomputes the deadline. Frozen afterwards. */
  async recomputeDeadline(tx: Tx, exitCaseId: string, userId: string, lwd: string, now: Date) {
    const c = await tx.exitCase.findUnique({ where: { id: exitCaseId }, select: { separatedAt: true } });
    if (c?.separatedAt) return;
    const d = await this.deadlineFor(tx, userId, lwd, now);
    await tx.fnfSettlement.update({
      where: { exitCaseId },
      data: {
        deadlineOn: new Date(`${d.deadlineOn}T00:00:00.000Z`), deadlineBasis: d.basis as any,
        nextEscalationOn: new Date(`${d.nextEscalationOn}T00:00:00.000Z`),
      },
    });
  }

  /**
   * Re-evaluates the settlement and the exit case state inside the caller's
   * transaction (the caller holds the exit case row lock). Returns the side
   * effects to announce after commit.
   */
  async evaluate(tx: Tx, exitCaseId: string, now: Date): Promise<FnfSideEffect[]> {
    const c = await tx.exitCase.findUnique({
      where: { id: exitCaseId },
      select: { id: true, userId: true, state: true, separatedAt: true, clearanceItems: { select: { status: true } }, settlement: true },
    });
    if (!c || !c.settlement) return [];
    const effects: FnfSideEffect[] = [];
    const s = c.settlement;
    const pending = await tx.fnfAdjustmentRequest.count({ where: { settlementId: s.id, status: 'PENDING' } });
    const statuses = c.clearanceItems.map((i: { status: string }) => i.status);
    const today = this.tva.companyToday();
    const next = evaluateFnf({
      state: s.state as FnfState, separated: !!c.separatedAt, today, deadlineOn: dayOf(s.deadlineOn)!, itemStatuses: statuses, pendingRequests: pending,
    });
    if (next.changed || (next.holdReason ?? null) !== (s.holdReason ?? null)) {
      await tx.fnfSettlement.update({
        where: { id: s.id },
        data: {
          state: next.state,
          holdReason: next.holdReason,
          readyAt: next.state === 'READY_FOR_RELEASE' ? s.readyAt ?? now : null,
        },
      });
      await writeAudit(tx, {
        actorId: c.userId, entityType: 'FnfSettlement', entityId: s.id, action: 'FNF_STATE_CHANGED',
        fromState: s.state, toState: next.state, metadata: { holdReason: next.holdReason },
      });
      if (next.state === 'READY_FOR_RELEASE') effects.push({ event: 'fnf.ready', exitCaseId, userId: c.userId });
      if (next.state === 'ON_HOLD_REVIEW_REQUIRED' && s.state !== 'ON_HOLD_REVIEW_REQUIRED') effects.push({ event: 'fnf.held', exitCaseId, userId: c.userId });
    }
    // The case is CLEARED once separated with every item settled.
    if (c.state === 'CLEARANCE_IN_PROGRESS' && c.separatedAt && allSettled(statuses)) {
      await tx.exitCase.update({ where: { id: c.id }, data: { state: 'CLEARED' } });
      await writeAudit(tx, { actorId: c.userId, entityType: 'ExitCase', entityId: c.id, action: 'EXIT_CLEARED', fromState: c.state, toState: 'CLEARED' });
      effects.push({ event: 'exit.cleared', exitCaseId, userId: c.userId });
    } else if (c.state === 'CLEARED' && !allSettled(statuses)) {
      await tx.exitCase.update({ where: { id: c.id }, data: { state: 'CLEARANCE_IN_PROGRESS' } });
      await writeAudit(tx, { actorId: c.userId, entityType: 'ExitCase', entityId: c.id, action: 'EXIT_CLEARANCE_REOPENED', fromState: 'CLEARED', toState: 'CLEARANCE_IN_PROGRESS' });
    }
    return effects;
  }

  async announce(effects: FnfSideEffect[]) {
    if (effects.length === 0) return;
    const staff = await hrAndAdminIds(this.prisma);
    for (const e of effects) {
      const link = `/users/${e.userId}?tab=exit`;
      if (e.event === 'fnf.ready') {
        await notifyMany(this.notifier, staff, 'fnfReady', () => ({ title: 'F&F ready for release', message: 'Every clearance item is settled. An Admin can release the settlement with the payment reference.', link, entityId: e.exitCaseId, entityType: 'ExitCase', dedupeKey: `fnf:${e.exitCaseId}:ready` }));
        await notifyMany(this.notifier, [e.userId], 'fnfReady', () => ({ title: 'Your full and final settlement is being finalised', message: 'Your clearance is complete. You will be told when the settlement is released.', link: '/profile/resignation', entityId: e.exitCaseId, entityType: 'ExitCase', dedupeKey: `fnf:${e.exitCaseId}:ready:employee` }));
      } else if (e.event === 'fnf.held') {
        await notifyMany(this.notifier, staff, 'fnfHeld', () => ({ title: 'F&F on hold: review required', message: 'The F&F deadline passed with clearance or an adjustment still open. Review and complete it.', link, entityId: e.exitCaseId, entityType: 'ExitCase', dedupeKey: `fnf:${e.exitCaseId}:held` }));
      }
    }
  }

  /** Admin/Super Admin release with a payment reference. Never automatic. */
  async release(actor: TransitionActor, exitCaseId: string, body: any) {
    requireAdmin(actor);
    const key = requireIdempotencyKey(body?.idempotencyKey);
    const releaseReference = requireText(body?.releaseReference, 'Payment reference', 120);
    const prior = await findKey(this.prisma, key, 'FNF_RELEASE');
    if (prior) return this.view(actor, prior.entityId);
    const now = this.tva.now();
    let userId = '';
    try {
      await this.prisma.$transaction(async (tx: Tx) => {
        await tx.$queryRaw`SELECT id FROM "exit_cases" WHERE id = ${exitCaseId} FOR UPDATE`;
        const c = await tx.exitCase.findUnique({ where: { id: exitCaseId }, include: { clearanceItems: { select: { status: true } }, settlement: true } });
        if (!c || !c.settlement) notFound('Exit case not found.');
        userId = c.userId;
        await this.evaluate(tx, exitCaseId, now);
        const s = await tx.fnfSettlement.findUnique({ where: { id: c.settlement.id } });
        const pending = await tx.fnfAdjustmentRequest.count({ where: { settlementId: s.id, status: 'PENDING' } });
        const problem = releaseProblem({ state: s.state, separated: !!c.separatedAt, itemStatuses: c.clearanceItems.map((i: any) => i.status), pendingRequests: pending });
        if (problem) conflict(TRANSITION_CODE.FNF_NOT_RELEASABLE, problem, { state: s.state });
        await tx.fnfSettlement.update({ where: { id: s.id }, data: { state: 'RELEASED', releasedAt: now, releasedById: actor.id, releaseReference } });
        await tx.exitCase.update({ where: { id: c.id }, data: { state: 'COMPLETED' } });
        await claimKey(tx, { key, scope: 'FNF_RELEASE', entityId: exitCaseId, actorId: actor.id });
        await writeAudit(tx, { actorId: actor.id, entityType: 'FnfSettlement', entityId: s.id, action: 'FNF_RELEASED', fromState: s.state, toState: 'RELEASED' });
        await writeAudit(tx, { actorId: actor.id, entityType: 'ExitCase', entityId: c.id, action: 'EXIT_COMPLETED', fromState: c.state, toState: 'COMPLETED' });
      });
    } catch (err) {
      if (isUniqueViolation(err) && (await findKey(this.prisma, key, 'FNF_RELEASE'))) return this.view(actor, exitCaseId);
      throw err;
    }
    const staff = await hrAndAdminIds(this.prisma);
    await notifyMany(this.notifier, staff, 'fnfReleased', () => ({ title: 'F&F released', message: 'The full and final settlement was released.', link: `/users/${userId}?tab=exit`, entityId: exitCaseId, entityType: 'ExitCase', dedupeKey: `fnf:${exitCaseId}:released` }));
    await notifyMany(this.notifier, [userId], 'fnfReleased', () => ({ title: 'Your full and final settlement was released', message: 'Your settlement has been released. Contact HR for the payment details.', link: '/profile/resignation', entityId: exitCaseId, entityType: 'ExitCase', dedupeKey: `fnf:${exitCaseId}:released:employee` }));
    return this.view(actor, exitCaseId);
  }

  // ── Adjustments: HR/Admin request, a DIFFERENT Admin approves ──────────────

  async requestAdjustment(actor: TransitionActor, exitCaseId: string, body: any) {
    requireHrOrAdmin(actor);
    const key = requireIdempotencyKey(body?.idempotencyKey);
    const existing = await this.prisma.fnfAdjustmentRequest.findUnique({ where: { idempotencyKey: key } });
    if (existing) return this.requestView(existing, true);
    const input = {
      kind: String(body?.kind ?? ''), direction: String(body?.direction ?? ''), amount: body?.amount,
      currency: String(body?.currency ?? 'INR').toUpperCase(), reasonCode: String(body?.reasonCode ?? ''), reference: String(body?.reference ?? '').trim(),
    };
    const reversesId = optionalText(body?.reversesId, 64);
    const problem = adjustmentProblem(input);
    if (problem) badRequest(TRANSITION_CODE.FNF_ADJUSTMENT_INVALID, problem);
    if (input.reference.length > 120) badRequest(TRANSITION_CODE.FNF_ADJUSTMENT_INVALID, 'Reference must be at most 120 characters.');
    const note = optionalText(body?.note, 1000);
    const created = await this.prisma.$transaction(async (tx: Tx) => {
      await tx.$queryRaw`SELECT id FROM "exit_cases" WHERE id = ${exitCaseId} FOR UPDATE`;
      const c = await tx.exitCase.findUnique({ where: { id: exitCaseId }, include: { settlement: true } });
      if (!c || !c.settlement) notFound('Exit case not found.');
      if (['RELEASED', 'CANCELLED'].includes(c.settlement.state)) conflict(TRANSITION_CODE.FNF_SETTLEMENT_CLOSED, 'This settlement is closed; no further adjustments can be recorded.');
      if (reversesId) {
        const orig = await tx.fnfAdjustment.findUnique({ where: { id: reversesId } });
        if (!orig || orig.settlementId !== c.settlement.id) badRequest(TRANSITION_CODE.FNF_ADJUSTMENT_INVALID, 'The adjustment to reverse is not on this settlement.');
        if (orig.reversesId) badRequest(TRANSITION_CODE.FNF_ADJUSTMENT_INVALID, 'A reversal cannot itself be reversed; record a new adjustment instead.');
        if (orig.direction === input.direction || Number(orig.amount) !== Number(input.amount) || orig.currency !== input.currency || orig.kind !== input.kind) {
          badRequest(TRANSITION_CODE.FNF_ADJUSTMENT_INVALID, 'A reversal must have the opposite direction and the same type, amount and currency.');
        }
        const already = await tx.fnfAdjustment.count({ where: { reversesId } });
        const pendingRev = await tx.fnfAdjustmentRequest.count({ where: { reversesId, status: 'PENDING' } });
        if (already + pendingRev > 0) conflict(TRANSITION_CODE.FNF_ADJUSTMENT_INVALID, 'This adjustment is already reversed or has a reversal waiting for approval.');
      }
      const row = await tx.fnfAdjustmentRequest.create({
        data: {
          id: randomUUID(), settlementId: c.settlement.id, subjectUserId: c.userId, kind: input.kind as any, direction: input.direction as any,
          amount: new Prisma.Decimal(Number(input.amount).toFixed(2)), currency: input.currency, reasonCode: input.reasonCode, reference: input.reference,
          note, reversesId, requestedById: actor.id, idempotencyKey: key,
        },
      });
      await writeAudit(tx, { actorId: actor.id, entityType: 'FnfAdjustmentRequest', entityId: row.id, action: 'FNF_ADJUSTMENT_REQUESTED', toState: 'PENDING', metadata: { kind: input.kind, direction: input.direction, reasonCode: input.reasonCode, reversal: !!reversesId } });
      await this.evaluate(tx, exitCaseId, this.tva.now());
      return row;
    });
    const admins = (await this.prisma.user.findMany({ where: { isActive: true, isSystemAccount: false, role: { name: { in: ['ADMIN', 'SUPER_ADMIN'] } } }, select: { id: true } })).map((u) => u.id).filter((id) => id !== actor.id);
    await notifyMany(this.notifier, admins, 'fnfAdjustmentRequested', () => ({ title: 'F&F adjustment awaiting approval', message: 'An F&F adjustment was requested and needs a second Admin to approve or reject it.', link: `/users/${created.subjectUserId}?tab=exit`, entityId: created.id, entityType: 'FnfAdjustmentRequest', dedupeKey: `fnfreq:${created.id}:requested` }));
    return this.requestView(created, true);
  }

  async decideAdjustment(actor: TransitionActor, requestId: string, body: any) {
    requireAdmin(actor);
    const decision = String(body?.decision ?? '').toUpperCase();
    if (decision !== 'APPROVE' && decision !== 'REJECT') badRequest(TRANSITION_CODE.FNF_ADJUSTMENT_INVALID, 'Choose approve or reject.');
    const reason = decision === 'REJECT' ? requireText(body?.reason, 'Rejection reason') : optionalText(body?.reason);
    const now = this.tva.now();
    const out = await this.prisma.$transaction(async (tx: Tx) => {
      const r0 = await tx.fnfAdjustmentRequest.findUnique({ where: { id: requestId }, include: { settlement: true } });
      if (!r0) notFound('Adjustment request not found.');
      await tx.$queryRaw`SELECT id FROM "exit_cases" WHERE id = ${r0.settlement.exitCaseId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "fnf_adjustment_requests" WHERE id = ${requestId} FOR UPDATE`;
      const r = await tx.fnfAdjustmentRequest.findUnique({ where: { id: requestId }, include: { settlement: true } });
      if (r.status !== 'PENDING') {
        // A replay of the same decision returns the decided row.
        if (r.decidedById === actor.id && ((decision === 'APPROVE' && r.status === 'APPROVED') || (decision === 'REJECT' && r.status === 'REJECTED'))) return r;
        conflict(TRANSITION_CODE.FNF_ADJUSTMENT_STATE_CHANGED, 'This request was already decided or cancelled.', { status: r.status });
      }
      if (r.requestedById === actor.id) forbidden(TRANSITION_CODE.FNF_ADJUSTMENT_SAME_PERSON, 'A different Admin or Super Admin must decide an adjustment you requested.');
      if (['RELEASED', 'CANCELLED'].includes(r.settlement.state)) conflict(TRANSITION_CODE.FNF_SETTLEMENT_CLOSED, 'This settlement is closed.');
      let adjustmentId: string | null = null;
      if (decision === 'APPROVE') {
        const adj = await tx.fnfAdjustment.create({
          data: {
            id: randomUUID(), settlementId: r.settlementId, subjectUserId: r.subjectUserId, kind: r.kind, direction: r.direction, amount: r.amount,
            currency: r.currency, reasonCode: r.reasonCode, reference: r.reference, note: r.note, approvedById: actor.id, approvedAt: now,
            recordedById: r.requestedById, reversesId: r.reversesId,
          },
        });
        adjustmentId = adj.id;
      }
      const updated = await tx.fnfAdjustmentRequest.update({
        where: { id: requestId },
        data: { status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', decidedById: actor.id, decidedAt: now, decisionReason: reason, adjustmentId },
      });
      await writeAudit(tx, { actorId: actor.id, entityType: 'FnfAdjustmentRequest', entityId: requestId, action: decision === 'APPROVE' ? 'FNF_ADJUSTMENT_APPROVED' : 'FNF_ADJUSTMENT_REJECTED', fromState: 'PENDING', toState: updated.status, metadata: { adjustmentId } });
      const effects = await this.evaluate(tx, r.settlement.exitCaseId, now);
      return { ...updated, effects };
    });
    await this.announce((out as any).effects ?? []);
    await notifyMany(this.notifier, [out.requestedById], 'fnfAdjustmentDecided', () => ({ title: `F&F adjustment ${out.status === 'APPROVED' ? 'approved' : 'rejected'}`, message: 'Your F&F adjustment request was decided.', link: `/users/${out.subjectUserId}?tab=exit`, entityId: requestId, entityType: 'FnfAdjustmentRequest', dedupeKey: `fnfreq:${requestId}:decided` }));
    return this.requestView(out, true);
  }

  async cancelAdjustment(actor: TransitionActor, requestId: string) {
    requireHrOrAdmin(actor);
    const now = this.tva.now();
    return this.prisma.$transaction(async (tx: Tx) => {
      await tx.$queryRaw`SELECT id FROM "fnf_adjustment_requests" WHERE id = ${requestId} FOR UPDATE`;
      const r = await tx.fnfAdjustmentRequest.findUnique({ where: { id: requestId }, include: { settlement: true } });
      if (!r) notFound('Adjustment request not found.');
      if (r.status === 'CANCELLED') return this.requestView(r, true);
      if (r.status !== 'PENDING') conflict(TRANSITION_CODE.FNF_ADJUSTMENT_STATE_CHANGED, 'Only a pending request can be cancelled.');
      if (r.requestedById !== actor.id && !isAdmin(actor)) forbidden(TRANSITION_CODE.FORBIDDEN, 'Only the requester or an Admin can cancel this request.');
      const updated = await tx.fnfAdjustmentRequest.update({ where: { id: requestId }, data: { status: 'CANCELLED', decidedAt: now } });
      await writeAudit(tx, { actorId: actor.id, entityType: 'FnfAdjustmentRequest', entityId: requestId, action: 'FNF_ADJUSTMENT_CANCELLED', fromState: 'PENDING', toState: 'CANCELLED' });
      await this.evaluate(tx, r.settlement.exitCaseId, now);
      return this.requestView(updated, true);
    });
  }

  // ── Escalation (day 9 and every 3 working days) ──────────────────────────

  async escalationSweep(): Promise<number> {
    const today = this.tva.companyToday();
    const now = this.tva.now();
    const due = await this.prisma.fnfSettlement.findMany({
      where: { state: { in: ['NOT_STARTED', 'ON_HOLD_REVIEW_REQUIRED'] }, nextEscalationOn: { lte: new Date(`${today}T00:00:00.000Z`) }, exitCase: { separatedAt: { not: null } } },
      select: { id: true, exitCaseId: true },
    });
    let sent = 0;
    for (const row of due) {
      const result = await this.prisma.$transaction(async (tx: Tx) => {
        await tx.$queryRaw`SELECT id FROM "exit_cases" WHERE id = ${row.exitCaseId} FOR UPDATE`;
        const effects = await this.evaluate(tx, row.exitCaseId, now);
        const s = await tx.fnfSettlement.findUnique({ where: { id: row.id }, include: { exitCase: { select: { userId: true } } } });
        if (!s || !['NOT_STARTED', 'ON_HOLD_REVIEW_REQUIRED'].includes(s.state) || !s.nextEscalationOn || dayOf(s.nextEscalationOn)! > today) return { effects, escalate: null };
        const cal = calendarFromBasis(s.deadlineBasis as any);
        const n = s.escalationCount + 1;
        const next = nextEscalationAfter(cal, dayOf(s.nextEscalationOn)!);
        await tx.fnfSettlement.update({ where: { id: s.id }, data: { escalationCount: n, lastEscalatedAt: now, nextEscalationOn: new Date(`${next}T00:00:00.000Z`) } });
        await writeAudit(tx, { actorId: s.exitCase.userId, entityType: 'FnfSettlement', entityId: s.id, action: 'FNF_OVERDUE_ESCALATED', metadata: { escalation: n } });
        return { effects, escalate: { n, userId: s.exitCase.userId } };
      });
      await this.announce(result.effects);
      if (result.escalate) {
        sent += 1;
        const staff = await hrAndAdminIds(this.prisma);
        await notifyMany(this.notifier, staff, 'fnfOverdue', () => ({ title: 'F&F overdue', message: 'An F&F settlement is past its deadline. Complete the remaining clearance or adjustment review.', link: `/users/${result.escalate!.userId}?tab=exit`, entityId: row.exitCaseId, entityType: 'ExitCase', dedupeKey: `fnf:${row.id}:overdue:${result.escalate!.n}` }));
      }
    }
    return sent;
  }

  // ── Views ──────────────────────────────────────────────────────────────

  /** HR/Admin see everything; the employee sees approved amounts and safe reasons only (D7). */
  async view(actor: TransitionActor, exitCaseId: string) {
    const c = await this.prisma.exitCase.findUnique({ where: { id: exitCaseId }, include: { settlement: { include: { adjustments: { orderBy: { createdAt: 'asc' } }, requests: { orderBy: { requestedAt: 'asc' } } } } } });
    if (!c || !c.settlement) notFound('Exit case not found.');
    const staff = actor.isHR || isAdmin(actor);
    if (!staff && c.userId !== actor.id) forbidden(TRANSITION_CODE.FORBIDDEN, 'You can only see your own settlement.');
    return staff ? this.staffSettlement(c.settlement) : this.employeeSettlement(c.settlement);
  }

  staffSettlement(s: any) {
    return {
      id: s.id, state: s.state, holdReason: s.holdReason, deadlineOn: dayOf(s.deadlineOn), deadlineBasis: s.deadlineBasis, readyAt: s.readyAt,
      releasedAt: s.releasedAt, releasedById: s.releasedById, releaseReference: s.releaseReference, escalationCount: s.escalationCount,
      nextEscalationOn: dayOf(s.nextEscalationOn), cancelledAt: s.cancelledAt,
      adjustments: (s.adjustments ?? []).map((a: any) => ({
        id: a.id, kind: a.kind, direction: a.direction, amount: a.amount.toString(), currency: a.currency, reasonCode: a.reasonCode,
        reference: a.reference, note: a.note, approvedById: a.approvedById, approvedAt: a.approvedAt, recordedById: a.recordedById, reversesId: a.reversesId, createdAt: a.createdAt,
      })),
      requests: (s.requests ?? []).map((r: any) => this.requestView(r, true)),
    };
  }

  employeeSettlement(s: any) {
    return {
      id: s.id, state: s.state, deadlineOn: dayOf(s.deadlineOn), releasedAt: s.releasedAt ? dayOf(s.releasedAt) : null,
      adjustments: (s.adjustments ?? []).map((a: any) => ({
        id: a.id, kind: a.kind, direction: a.direction, amount: a.amount.toString(), currency: a.currency,
        reason: FNF_REASONS[a.reasonCode]?.employeeText ?? 'Adjustment', reversesId: a.reversesId, approvedOn: dayOf(a.approvedAt),
      })),
    };
  }

  requestView(r: any, staff: boolean) {
    const base = { id: r.id, kind: r.kind, direction: r.direction, amount: r.amount?.toString?.() ?? String(r.amount), currency: r.currency, reasonCode: r.reasonCode, status: r.status, reversesId: r.reversesId, requestedById: r.requestedById, requestedAt: r.requestedAt, decidedById: r.decidedById, decidedAt: r.decidedAt, adjustmentId: r.adjustmentId };
    return staff ? { ...base, reference: r.reference, note: r.note, decisionReason: r.decisionReason } : base;
  }
}
