import { Injectable, Optional, forwardRef, Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { TVAService } from '../../../../../common/services/tva.service';
import { NotificationEventService } from '../../../../operations/notifications/notification-event.service';
import { isHoldActive } from '../../../../../common/lifecycle-domain';
import { writeAudit } from '../../employment-continuity';
import { calendarFromBasis, nthWorkingDayAfter, resolveWorkingCalendar } from '../fnf/working-calendar';
import { requireIdempotencyKey } from '../request-keys';
import {
  badRequest, conflict, dayOf, forbidden, isAdmin, notFound, optionalText, requireAdmin, requireHrOrAdmin, requireText, TRANSITION_CODE, TransitionActor,
} from '../transitions-codes';
import { adminIds, notifyMany } from '../transition-support';

/** Controlled hold reasons. Codes only travel in notifications and events. */
export const HOLD_REASON_CODES = ['LITIGATION', 'REGULATORY_INQUIRY', 'INTERNAL_INVESTIGATION', 'AUDIT', 'EMPLOYMENT_DISPUTE', 'OTHER'] as const;
const REMINDER_WORKING_DAYS = 3;

/**
 * Legal holds (correction 9). There is NO one-person placement path:
 *
 *   REQUESTED ── confirm (Admin/SA ≠ requester) ──► ACTIVE ── release (Admin/SA, reason) ──► RELEASED
 *   REQUESTED ── reject (Admin/SA ≠ requester, reason) ──► REJECTED
 *   REQUESTED ── withdraw (requester or Admin/SA) ──► WITHDRAWN
 *   legacy NULL ── adopt (Admin/SA) ──► ACTIVE ── release ──► RELEASED
 *
 * The per-state CHECK and the four-eyes CHECK enforce the same in SQL.
 * Notes and reference are returned only to Admin/SA and the requester;
 * notifications, events and logs carry only id, status and reason code; an
 * employee sees only `deletionRestricted`.
 */
@Injectable()
export class LegalHoldsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
    @Optional() @Inject(forwardRef(() => NotificationEventService)) private readonly notifier?: NotificationEventService,
  ) {}

  async request(actor: TransitionActor, userId: string, body: any) {
    requireHrOrAdmin(actor);
    const key = requireIdempotencyKey(body?.idempotencyKey);
    const replay = await this.prisma.userLegalHold.findUnique({ where: { idempotencyKey: key } });
    if (replay) return this.view(actor, replay);
    const reasonCode = String(body?.reasonCode ?? '').toUpperCase();
    if (!(HOLD_REASON_CODES as readonly string[]).includes(reasonCode)) badRequest(TRANSITION_CODE.LEGAL_HOLD_INVALID, 'Choose a hold reason from the list.');
    const notes = optionalText(body?.notes, 2000);
    const reference = optionalText(body?.reference, 200);
    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, isSystemAccount: true } });
    if (!target || target.isSystemAccount) notFound('User not found.');
    const now = this.tva.now();
    const hold = await this.prisma.$transaction(async (tx: any) => {
      const h = await tx.userLegalHold.create({
        data: { id: randomUUID(), userId, reasonCode, status: 'REQUESTED', requestedById: actor.id, requestedAt: now, notes, reference, idempotencyKey: key },
      });
      await writeAudit(tx, { actorId: actor.id, entityType: 'UserLegalHold', entityId: h.id, action: 'LEGAL_HOLD_REQUESTED', toState: 'REQUESTED', metadata: { reasonCode } });
      return h;
    });
    const reviewers = (await adminIds(this.prisma)).filter((id) => id !== actor.id);
    await notifyMany(this.notifier, reviewers, 'legalHoldRequested', () => ({
      title: 'Legal hold requested', message: `A legal hold (${reasonCode}) was requested and needs a second Admin or Super Admin to confirm or reject it.`, link: '/settings?section=compliance',
      entityId: hold.id, entityType: 'UserLegalHold', dedupeKey: `hold:${hold.id}:requested`,
    }));
    return this.view(actor, hold);
  }

  /** confirm | reject | withdraw | release | adopt. */
  async transition(actor: TransitionActor, holdId: string, action: string, body: any) {
    const now = this.tva.now();
    const a = String(action).toLowerCase();
    if (!['confirm', 'reject', 'withdraw', 'release', 'adopt'].includes(a)) badRequest(TRANSITION_CODE.LEGAL_HOLD_INVALID, 'Unknown hold action.');
    const reason = a === 'reject' || a === 'release' ? requireText(body?.reason, a === 'reject' ? 'Rejection reason' : 'Release reason') : null;
    const out = await this.prisma.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT id FROM "user_legal_holds" WHERE id = ${holdId} FOR UPDATE`;
      const h = await tx.userLegalHold.findUnique({ where: { id: holdId } });
      if (!h) notFound('Hold not found.');
      const from = h.status ?? 'LEGACY';
      let data: Record<string, unknown>;
      let to: string;
      if (a === 'confirm' || a === 'reject') {
        requireAdmin(actor);
        if (h.status !== 'REQUESTED') conflict(TRANSITION_CODE.LEGAL_HOLD_STATE_CHANGED, 'Only a requested hold can be confirmed or rejected.', { status: from });
        if (h.requestedById === actor.id) forbidden(TRANSITION_CODE.LEGAL_HOLD_SAME_PERSON, 'A different Admin or Super Admin must review a hold you requested.');
        to = a === 'confirm' ? 'ACTIVE' : 'REJECTED';
        data = a === 'confirm' ? { status: 'ACTIVE', placedById: actor.id, placedAt: now } : { status: 'REJECTED', rejectedById: actor.id, rejectedAt: now, rejectionReason: reason };
      } else if (a === 'withdraw') {
        if (h.status !== 'REQUESTED') conflict(TRANSITION_CODE.LEGAL_HOLD_STATE_CHANGED, 'Only a requested hold can be withdrawn.', { status: from });
        if (h.requestedById !== actor.id && !isAdmin(actor)) forbidden(TRANSITION_CODE.FORBIDDEN, 'Only the requester or an Admin can withdraw this request.');
        to = 'WITHDRAWN';
        data = { status: 'WITHDRAWN', withdrawnById: actor.id, withdrawnAt: now };
      } else if (a === 'release') {
        requireAdmin(actor);
        if (h.status !== 'ACTIVE') conflict(TRANSITION_CODE.LEGAL_HOLD_STATE_CHANGED, 'Only an active hold can be released.', { status: from });
        to = 'RELEASED';
        data = { status: 'RELEASED', releasedById: actor.id, releasedAt: now, releaseReason: reason };
      } else {
        requireAdmin(actor);
        if (h.status !== null || !isHoldActive(h)) conflict(TRANSITION_CODE.LEGAL_HOLD_STATE_CHANGED, 'Only an unresolved legacy hold can be adopted.', { status: from });
        to = 'ACTIVE';
        // The original placement time is kept; the adopter becomes the placing authority.
        data = { status: 'ACTIVE', placedById: actor.id, placedAt: h.placedAt ?? now };
      }
      const updated = await tx.userLegalHold.update({ where: { id: holdId }, data });
      await writeAudit(tx, { actorId: actor.id, entityType: 'UserLegalHold', entityId: holdId, action: `LEGAL_HOLD_${to}`, fromState: from, toState: to, metadata: { reasonCode: h.reasonCode } });
      return updated;
    });
    if (out.requestedById && out.requestedById !== actor.id && (a === 'confirm' || a === 'reject')) {
      await notifyMany(this.notifier, [out.requestedById], 'legalHoldDecided', () => ({
        title: `Legal hold ${a === 'confirm' ? 'confirmed' : 'rejected'}`, message: `Your legal hold request was ${a === 'confirm' ? 'confirmed' : 'rejected'}.`, link: '/settings?section=compliance',
        entityId: out.id, entityType: 'UserLegalHold', dedupeKey: `hold:${out.id}:decided`,
      }));
    }
    return this.view(actor, out);
  }

  /** Reminders for REQUESTED holds every 3 working days until decided. */
  async reminderSweep(): Promise<number> {
    const now = this.tva.now();
    const today = this.tva.companyToday();
    const pending = await this.prisma.userLegalHold.findMany({ where: { status: 'REQUESTED' }, select: { id: true, userId: true, requestedAt: true, requestedById: true, reasonCode: true } });
    let sent = 0;
    for (const h of pending) {
      const from = dayOf(h.requestedAt)!;
      const cal = await resolveWorkingCalendar(this.prisma, h.userId, from, now).catch(() => calendarFromBasis({ source: 'STANDARD_WEEKDAY_FALLBACK', profileId: null, holidayCalendarId: null, weeklyOffPolicyId: null, holidays: [], weeklyOff: null, computedFor: from, computedAt: now.toISOString() }));
      let n = 0;
      let due = nthWorkingDayAfter(cal, from, REMINDER_WORKING_DAYS);
      while (due <= today && n < 100) {
        n += 1;
        due = nthWorkingDayAfter(cal, due, REMINDER_WORKING_DAYS);
      }
      if (n === 0) continue;
      const reviewers = (await adminIds(this.prisma)).filter((id) => id !== h.requestedById);
      await notifyMany(this.notifier, reviewers, 'legalHoldReminder', () => ({
        title: 'Legal hold still awaiting review', message: `A requested legal hold (${h.reasonCode}) is still waiting for confirmation or rejection.`, link: '/settings?section=compliance',
        entityId: h.id, entityType: 'UserLegalHold', dedupeKey: `hold:${h.id}:remind:${n}`,
      }));
      sent += 1;
    }
    return sent;
  }

  async list(actor: TransitionActor, q: any) {
    requireHrOrAdmin(actor);
    const where: any = {};
    if (typeof q?.userId === 'string' && q.userId) where.userId = q.userId;
    if (typeof q?.status === 'string' && /^[A-Z_,]+$/.test(q.status)) where.status = { in: q.status.split(',') };
    // HR sees only the holds they requested; Admin/SA see all.
    if (!isAdmin(actor)) where.requestedById = actor.id;
    const rows = await this.prisma.userLegalHold.findMany({ where, orderBy: [{ requestedAt: 'desc' }, { id: 'asc' }], take: 200 });
    const names = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, name: true, employeeId: true } });
    const byId = new Map(names.map((n) => [n.id, n]));
    return rows.map((r) => ({ ...this.view(actor, r), employee: byId.get(r.userId) ?? null }));
  }

  /** The employee's own view: only whether deletion is restricted. */
  async restrictionFor(actor: TransitionActor, userId: string) {
    if (actor.id !== userId && !isAdmin(actor) && !actor.isHR) forbidden(TRANSITION_CODE.FORBIDDEN, 'Not allowed.');
    const rows = await this.prisma.userLegalHold.findMany({ where: { userId }, select: { status: true, releasedAt: true } });
    return { deletionRestricted: rows.some((r) => isHoldActive(r as any)) };
  }

  view(actor: TransitionActor, h: any) {
    const privileged = isAdmin(actor) || (!!h.requestedById && h.requestedById === actor.id);
    const base = {
      id: h.id, userId: h.userId, status: h.status ?? 'LEGACY', reasonCode: h.reasonCode, blocksDeletion: isHoldActive(h),
      requestedById: h.requestedById, requestedAt: h.requestedAt, placedById: h.placedById, placedAt: h.placedAt, rejectedAt: h.rejectedAt,
      withdrawnAt: h.withdrawnAt, releasedAt: h.releasedAt,
    };
    return privileged ? { ...base, notes: h.notes, reference: h.reference, rejectionReason: h.rejectionReason, releaseReason: h.releaseReason } : base;
  }
}
