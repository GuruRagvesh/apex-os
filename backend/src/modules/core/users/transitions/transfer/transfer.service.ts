import { Injectable, Logger, Optional, forwardRef, Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { TVAService } from '../../../../../common/services/tva.service';
import { RemediationException } from '../../../../../common/remediation/remediation.exception';
import { buildRemediation } from '../../../../../common/remediation/remediation.serializer';
import { NotificationEventService } from '../../../../operations/notifications/notification-event.service';
import { LeaveRoutingService } from '../../../../operations/leave/leave-routing.service';
import { lockAttendanceMonth } from '../../../../platform/attendance/evaluation/attendance-month-lock';
import { closeProfilesAt, reopenProfileFrom } from '../../../../platform/attendance/timeline/profile-continuity';
import { EventsGateway } from '../../../../platform/gateway/events.gateway';
import { UserSetupIssuesService } from '../../user-setup-issues.service';
import { writeAudit } from '../../employment-continuity';
import { claimKey, findKey, isUniqueViolation, requireIdempotencyKey } from '../request-keys';
import {
  addDays, badRequest, businessDate, conflict, dateOnly, dayOf, forbidden, isHrOrAdmin, isSuperAdmin, notFound, optionalText, requireAdmin, requireHrOrAdmin,
  requireText, TRANSITION_CODE, TransitionActor,
} from '../transitions-codes';
import { adminIds, hrIds, notifyMany, resolveDepartmentManager, resolveTeamLead } from '../transition-support';
import { companyDayStartAt, dayActivity, gatherTransferState, permissionDelta, TransferPlan, TransferState, transferFingerprint } from './transfer-state';

type Tx = any;
const PROFILE_FIELDS = ['assignedShiftId', 'assignedLeavePolicyId', 'assignedHolidayCalendarId', 'assignedWeeklyOffPolicyId', 'assignedAttendanceLocationId'] as const;
const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN'];

interface Applied {
  transferId: string;
  userId: string;
  reroutes: Array<{ leaveId: string; from: string | null; to: string | null }>;
  ticketSnapshots: Array<{ ticketId: string; approverId: string | null }>;
  hierarchyMissing: boolean;
}

/**
 * Primary department / base role transfer (Workstream A, correction 1).
 *
 *   preview (not stored) ── confirm(fingerprint) ──┬─ today, clean ──► COMPLETED (applied now)
 *                                                  └─ future day ────► SCHEDULED
 *   SCHEDULED ── activation (fingerprint unchanged, day clean) ──► COMPLETED
 *   SCHEDULED ── stale or day used ──► REVIEW_REQUIRED ── Admin re-confirm ──► SCHEDULED / COMPLETED
 *   SCHEDULED | REVIEW_REQUIRED ── Admin cancel ──► CANCELLED
 *
 * Department, role, profile, hierarchy and routing change in ONE commit at the
 * same day boundary, so there is never a mixed new-department/old-profile
 * interval. UserDepartmentMembership, UserRoleAssignment and Team/TeamMember
 * are read for the preview only and never written (Phase 4.5 boundary).
 */
@Injectable()
export class TransferService {
  private readonly logger = new Logger(TransferService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
    private readonly leaveRouting: LeaveRoutingService,
    @Optional() @Inject(forwardRef(() => NotificationEventService)) private readonly notifier?: NotificationEventService,
    @Optional() private readonly setupIssues?: UserSetupIssuesService,
    @Optional() private readonly gateway?: EventsGateway,
  ) {}

  private tz() {
    return this.tva.companyTimezone();
  }

  private parsePlan(body: any): TransferPlan {
    const toRoleId = requireText(body?.toRoleId, 'Role', 64);
    const toDepartmentId = optionalText(body?.toDepartmentId, 64);
    const profileOverrides: TransferPlan['profileOverrides'] = {};
    const raw = body?.profileOverrides && typeof body.profileOverrides === 'object' ? body.profileOverrides : {};
    for (const f of PROFILE_FIELDS) if (raw[f] !== undefined) profileOverrides[f] = raw[f] === null ? null : String(raw[f]).slice(0, 64);
    return {
      toDepartmentId, toRoleId, profileOverrides,
      newTeamLeadId: optionalText(body?.newTeamLeadId, 64), newManagerId: optionalText(body?.newManagerId, 64),
    };
  }

  private assertAllowed(actor: TransitionActor, state: TransferState, plan: TransferPlan) {
    if (state.user.id === actor.id) forbidden(TRANSITION_CODE.TRANSFER_SELF, 'You cannot transfer yourself.');
    if ((state.user.roleName === 'SUPER_ADMIN' || state.toRole?.name === 'SUPER_ADMIN') && !isSuperAdmin(actor)) {
      forbidden(TRANSITION_CODE.TRANSFER_SUPER_ADMIN_TARGET, 'Only a Super Admin can transfer a Super Admin or grant the Super Admin role.');
    }
    // employmentState is NULL for accounts that predate the lifecycle foundation; they are active.
    if (!state.user.isActive || (state.user.employmentState !== null && state.user.employmentState !== 'ACTIVE')) conflict(TRANSITION_CODE.TRANSFER_USER_NOT_ACTIVE, 'Only an active employee can be transferred.');
    if (!state.toRole) badRequest(TRANSITION_CODE.TRANSFER_TARGET_INVALID, 'The selected role no longer exists. Choose another role.', { field: 'toRoleId' });
    if (plan.toDepartmentId && !state.toDepartment) badRequest(TRANSITION_CODE.TRANSFER_TARGET_INVALID, 'The selected department no longer exists. Choose another department.', { field: 'toDepartmentId' });
    if ((plan.toDepartmentId ?? null) === (state.user.departmentId ?? null) && plan.toRoleId === state.user.roleId) {
      badRequest(TRANSITION_CODE.TRANSFER_NO_CHANGE, 'Choose a different department or role.');
    }
    if (state.openExitCaseId) throw new RemediationException(buildRemediation('TRANSFER_EXIT_CASE_OPEN', { affectedUserId: state.user.id }), 409);
  }

  /** The preview shown before confirmation. Nothing is written. */
  private async buildPreview(db: Tx, userId: string, plan: TransferPlan) {
    const now = this.tva.now();
    const state = await gatherTransferState(db, userId, plan, now);
    if (!state) notFound('User not found.');
    const today = this.tva.companyToday();
    const todayBlockers = await dayActivity(db, userId, today, this.tz());
    const fingerprint = transferFingerprint(state, plan);
    const [teamLeadId, managerId] = await Promise.all([resolveTeamLead(db, userId, state.user.departmentId, now), resolveDepartmentManager(db, userId, state.user.departmentId, now)]);
    return {
      state,
      preview: {
        fingerprint,
        user: { id: state.user.id, name: state.user.name },
        department: { from: state.fromDepartment, to: state.toDepartment },
        role: { from: { id: state.fromRole.id, name: state.fromRole.name }, to: state.toRole ? { id: state.toRole.id, name: state.toRole.name } : null },
        hierarchy: {
          currentTeamLeadId: teamLeadId, currentManagerId: managerId,
          asSubject: state.hierarchyAsSubject, asAssigneeForReview: state.hierarchyAsAssignee,
        },
        attendanceProfile: state.profile,
        profileOverrides: plan.profileOverrides ?? {},
        pendingLeave: state.ownPendingLeave,
        leaveApprovalsRoutedToThem: state.leaveApprovalsRoutedToUser.length,
        corrections: { own: state.ownCorrections, awaitingTheirApproval: state.correctionsAwaitingUser.length },
        ticketsWaitingForReview: state.reviewTickets.map((t) => ({ id: t.id, title: t.title, type: t.type })),
        tickets: { owned: state.ownedTickets.length, assigned: state.assignedTickets.length, coAssigned: state.coAssignedTickets.length },
        projects: state.projectMemberships.length,
        teams: state.teamMemberships.length,
        pendingChangeRequests: state.pendingChangeRequests.length,
        openExitCaseId: state.openExitCaseId,
        permissions: permissionDelta(state.fromRole.name, state.toRole?.name ?? null),
        isHrUnchanged: true,
        today,
        canApplyToday: todayBlockers.length === 0,
        todayBlockers,
        earliestScheduledDay: addDays(today, 1),
      },
    };
  }

  async preview(actor: TransitionActor, userId: string, body: any) {
    requireAdmin(actor);
    const plan = this.parsePlan(body);
    const { state, preview } = await this.buildPreview(this.prisma, userId, plan);
    this.assertAllowed(actor, state, plan);
    return preview;
  }

  async confirm(actor: TransitionActor, userId: string, body: any) {
    requireAdmin(actor);
    const key = requireIdempotencyKey(body?.idempotencyKey);
    const prior = await findKey(this.prisma, key, 'TRANSFER_CONFIRM');
    if (prior) return this.transferView(prior.entityId, actor);
    const plan = this.parsePlan(body);
    const fingerprint = requireText(body?.fingerprint, 'Preview fingerprint', 64);
    const reason = optionalText(body?.reason, 500);
    const today = this.tva.companyToday();
    const effectiveOn = body?.effectiveOn ? businessDate(body.effectiveOn, 'Effective date') : today;
    if (effectiveOn < today) badRequest(TRANSITION_CODE.TRANSFER_EFFECTIVE_DATE_INVALID, 'A transfer cannot take effect in the past.');
    if (effectiveOn > addDays(today, 366)) badRequest(TRANSITION_CODE.TRANSFER_EFFECTIVE_DATE_INVALID, 'Choose a date within the next year.');
    return this.confirmInternal(actor, userId, plan, { key, fingerprint, reason, effectiveOn, reconfirmOf: null });
  }

  /** Re-confirm a REVIEW_REQUIRED transfer from a fresh preview. */
  async reconfirm(actor: TransitionActor, transferId: string, body: any) {
    requireAdmin(actor);
    const key = requireIdempotencyKey(body?.idempotencyKey);
    const prior = await findKey(this.prisma, key, 'TRANSFER_CONFIRM');
    if (prior) return this.transferView(prior.entityId, actor);
    const t = await this.prisma.departmentTransfer.findUnique({ where: { id: transferId } });
    if (!t) notFound('Transfer not found.');
    if (t.status !== 'REVIEW_REQUIRED') conflict(TRANSITION_CODE.TRANSFER_STATE_CHANGED, 'Only a transfer that needs review can be re-confirmed.', { status: t.status });
    const plan = { ...(t.plan as any), ...this.parsePlan({ ...(t.plan as any), ...body }) } as TransferPlan;
    const fingerprint = requireText(body?.fingerprint, 'Preview fingerprint', 64);
    const today = this.tva.companyToday();
    const effectiveOn = body?.effectiveOn ? businessDate(body.effectiveOn, 'Effective date') : dayOf(t.effectiveOn) && dayOf(t.effectiveOn)! > today ? dayOf(t.effectiveOn)! : today;
    if (effectiveOn < today) badRequest(TRANSITION_CODE.TRANSFER_EFFECTIVE_DATE_INVALID, 'A transfer cannot take effect in the past.');
    return this.confirmInternal(actor, t.userId, plan, { key, fingerprint, reason: optionalText(body?.reason, 500) ?? t.reason, effectiveOn, reconfirmOf: t.id });
  }

  private async confirmInternal(
    actor: TransitionActor, userId: string, plan: TransferPlan,
    o: { key: string; fingerprint: string; reason: string | null; effectiveOn: string; reconfirmOf: string | null },
  ) {
    const today = this.tva.companyToday();
    const now = this.tva.now();
    let applied: Applied | null = null;
    let transferId = o.reconfirmOf ?? randomUUID();
    try {
      await this.prisma.$transaction(async (tx: Tx) => {
        // Lock order everywhere: user, attendance month, leave rows (by id).
        await tx.$queryRaw`SELECT id FROM "users" WHERE id = ${userId} FOR UPDATE`;
        const { state, preview } = await this.buildPreview(tx, userId, plan);
        this.assertAllowed(actor, state, plan);
        if (preview.fingerprint !== o.fingerprint) {
          conflict(TRANSITION_CODE.TRANSFER_PREVIEW_STALE, 'Something changed since the preview. Review the refreshed impact and confirm again; your choices are kept.', { preview });
        }
        if (o.reconfirmOf) {
          await tx.$queryRaw`SELECT id FROM "department_transfers" WHERE id = ${o.reconfirmOf} FOR UPDATE`;
          const t = await tx.departmentTransfer.findUnique({ where: { id: o.reconfirmOf } });
          if (t.status !== 'REVIEW_REQUIRED') conflict(TRANSITION_CODE.TRANSFER_STATE_CHANGED, 'This transfer changed while you were reviewing it.', { status: t.status });
        }
        const effectiveAt = companyDayStartAt(o.effectiveOn, this.tz());
        const base = {
          userId, fromDepartmentId: state.user.departmentId, toDepartmentId: plan.toDepartmentId ?? null, fromRoleId: state.user.roleId, toRoleId: plan.toRoleId,
          effectiveAt, effectiveOn: dateOnly(o.effectiveOn), actorId: actor.id, plan: plan as any, previewFingerprint: preview.fingerprint, reason: o.reason,
          reviewReasonCode: null, warnings: [] as any,
        };
        if (o.effectiveOn === today) {
          if (!preview.canApplyToday) {
            conflict(TRANSITION_CODE.TRANSFER_TODAY_NOT_CLEAN, 'Today already has attendance or payroll activity for this person, so the transfer must start on a later day.', { todayBlockers: preview.todayBlockers, earliestScheduledDay: preview.earliestScheduledDay });
          }
          if (o.reconfirmOf) await tx.departmentTransfer.update({ where: { id: transferId }, data: { ...base, status: 'SCHEDULED', idempotencyKey: o.key } });
          else await tx.departmentTransfer.create({ data: { id: transferId, ...base, status: 'SCHEDULED', idempotencyKey: o.key } });
          applied = await this.applyLocked(tx, transferId, actor.id, now, { alreadyLockedUser: true });
        } else {
          if (o.reconfirmOf) await tx.departmentTransfer.update({ where: { id: transferId }, data: { ...base, status: 'SCHEDULED', idempotencyKey: o.key } });
          else await tx.departmentTransfer.create({ data: { id: transferId, ...base, status: 'SCHEDULED', idempotencyKey: o.key } });
          await writeAudit(tx, { actorId: actor.id, entityType: 'DepartmentTransfer', entityId: transferId, action: 'TRANSFER_SCHEDULED', toState: 'SCHEDULED', metadata: { effectiveOn: o.effectiveOn, reconfirm: !!o.reconfirmOf } });
        }
        await claimKey(tx, { key: o.key, scope: 'TRANSFER_CONFIRM', entityId: transferId, actorId: actor.id });
      });
    } catch (err: any) {
      if (isUniqueViolation(err)) {
        const k = await findKey(this.prisma, o.key, 'TRANSFER_CONFIRM');
        if (k) return this.transferView(k.entityId, actor);
        conflict(TRANSITION_CODE.TRANSFER_PENDING_EXISTS, 'This person already has a scheduled transfer. Cancel or re-confirm it first.');
      }
      throw err;
    }
    if (applied) await this.afterApplied(applied);
    else await this.announceScheduled(transferId, userId, o.effectiveOn);
    return this.transferView(transferId, actor);
  }

  /**
   * Applies a SCHEDULED transfer under locks (activation and immediate path).
   * Recomputes the full fingerprint and the clean-day rule first; on either
   * failure the transfer becomes REVIEW_REQUIRED and nothing is applied.
   */
  private async applyLocked(tx: Tx, transferId: string, actorId: string, now: Date, o: { alreadyLockedUser?: boolean } = {}): Promise<Applied | null> {
    const t = await tx.departmentTransfer.findUnique({ where: { id: transferId } });
    if (!t || t.status !== 'SCHEDULED') return null;
    if (now.getTime() < t.effectiveAt.getTime()) return null; // never applied early
    const userId = t.userId;
    if (!o.alreadyLockedUser) await tx.$queryRaw`SELECT id FROM "users" WHERE id = ${userId} FOR UPDATE`;
    const effectiveOn = dayOf(t.effectiveOn ?? t.effectiveAt)!;
    await lockAttendanceMonth(tx, effectiveOn.slice(0, 7));
    const plan = t.plan as TransferPlan;
    const state = await gatherTransferState(tx, userId, plan, now);
    const ids = (state?.ownPendingLeave ?? []).map((l) => l.id).sort();
    for (const id of ids) await tx.$queryRaw`SELECT id FROM "leave_requests" WHERE id = ${id} FOR UPDATE`;

    const stale = !state || transferFingerprint(state, plan) !== t.previewFingerprint;
    const blockers = state ? await dayActivity(tx, userId, effectiveOn, this.tz()) : [];
    // On the effective day itself the immediate path already proved the day
    // clean under this same lock; a late activation re-checks it.
    if (stale || blockers.length > 0 || !state || state.openExitCaseId) {
      const code = stale ? TRANSITION_CODE.TRANSFER_STALE_AT_ACTIVATION : TRANSITION_CODE.TRANSFER_EFFECTIVE_DAY_NOT_CLEAN;
      await tx.departmentTransfer.update({ where: { id: t.id }, data: { status: 'REVIEW_REQUIRED', reviewReasonCode: code, warnings: { blockers } as any } });
      await writeAudit(tx, { actorId, entityType: 'DepartmentTransfer', entityId: t.id, action: 'TRANSFER_REVIEW_REQUIRED', fromState: 'SCHEDULED', toState: 'REVIEW_REQUIRED', metadata: { reasonCode: code, blockers } });
      return null;
    }

    const prevDay = addDays(effectiveOn, -1);
    // Ticket snapshots resolve the ORIGINAL department's reviewers first, so
    // they are taken before the department changes.
    const ticketSnapshots: Applied['ticketSnapshots'] = [];
    for (const ticket of state.reviewTickets) {
      const resolved = await this.resolveTicketReviewer(tx, ticket, state, plan, now);
      const previous = await tx.routingSnapshot.findFirst({ where: { workflow: 'TICKET_REVIEW', entityType: 'Ticket', entityId: ticket.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true } });
      await tx.routingSnapshot.create({
        data: {
          id: randomUUID(), workflow: 'TICKET_REVIEW', entityType: 'Ticket', entityId: ticket.id, subjectUserId: userId,
          originalDepartmentId: state.user.departmentId, resolvedApproverId: resolved.approverId, tier: resolved.tier,
          fallbackReason: resolved.approverId ? 'EMPLOYEE_TRANSFERRED' : 'NO_REVIEWER_AVAILABLE', supersedesId: previous?.id ?? null, createdById: actorId,
        },
      });
      ticketSnapshots.push({ ticketId: ticket.id, approverId: resolved.approverId });
    }

    // Department and role: one commit, same boundary as the profile.
    const fromAdmin = ADMIN_ROLES.includes(state.fromRole.name);
    const toAdmin = !!state.toRole && ADMIN_ROLES.includes(state.toRole.name);
    const demoted = (fromAdmin && !toAdmin) || (state.fromRole.name === 'SUPER_ADMIN' && state.toRole?.name !== 'SUPER_ADMIN');
    await tx.user.update({
      where: { id: userId },
      data: { departmentId: plan.toDepartmentId ?? null, roleId: plan.toRoleId, ...(demoted ? { sessionsRevokedAt: now } : {}) },
    });

    // Attendance profile: close at effectiveOn - 1, open from effectiveOn.
    let profileAction = 'NONE';
    if (state.profile && state.profile.effectiveFrom >= effectiveOn) {
      // The profile itself starts on the effective day (a clean day): update in place.
      const data: Record<string, unknown> = { updatedById: actorId };
      for (const f of PROFILE_FIELDS) if (plan.profileOverrides?.[f] !== undefined) data[f] = plan.profileOverrides[f];
      await tx.employeeAttendanceProfile.update({ where: { id: state.profile.id }, data });
      profileAction = 'UPDATED_SAME_DAY';
    } else {
      await closeProfilesAt(tx, userId, prevDay, actorId);
      const newId = await reopenProfileFrom(tx, userId, effectiveOn, actorId);
      if (newId) {
        const data: Record<string, unknown> = {};
        for (const f of PROFILE_FIELDS) if (plan.profileOverrides?.[f] !== undefined) data[f] = plan.profileOverrides[f];
        if (Object.keys(data).length) await tx.employeeAttendanceProfile.update({ where: { id: newId }, data });
        profileAction = 'CLOSED_AND_OPENED';
      } else {
        profileAction = state.profile ? 'CLOSED_NO_SUCCESSOR' : 'NO_PROFILE';
        await this.setupIssues?.record(tx, userId, 'ATTENDANCE_POLICY_SETUP_PENDING', { reasonCode: 'TRANSFER_PROFILE_NOT_CONTINUED' });
      }
    }

    // Hierarchy: end the employee-scope rows about this person; add chosen ones.
    await tx.hierarchyAssignment.updateMany({ where: { subjectUserId: userId, scope: 'EMPLOYEE', effectiveTo: null }, data: { effectiveTo: t.effectiveAt } });
    for (const [role, assignee] of [['TEAM_LEAD', plan.newTeamLeadId], ['MANAGER', plan.newManagerId]] as const) {
      if (!assignee || assignee === userId) continue;
      const ok = await tx.user.findFirst({ where: { id: assignee, isActive: true, isSystemAccount: false }, select: { id: true } });
      if (!ok) continue;
      await tx.hierarchyAssignment.create({ data: { id: randomUUID(), scope: 'EMPLOYEE', role, subjectUserId: userId, assigneeUserId: assignee, isPrimary: true, effectiveFrom: t.effectiveAt, createdById: actorId } });
    }
    const newTl = await resolveTeamLead(tx, userId, plan.toDepartmentId ?? null, now);
    const newMgr = await resolveDepartmentManager(tx, userId, plan.toDepartmentId ?? null, now);
    const hierarchyMissing = !newTl && !newMgr;
    if (hierarchyMissing) await this.setupIssues?.record(tx, userId, 'HIERARCHY_MISSING', { reasonCode: 'TRANSFER' });

    // Leave: reroute this person's pending requests from the new hierarchy.
    const reroutes: Applied['reroutes'] = [];
    for (const id of ids) {
      const r = await this.leaveRouting.rerouteForTransfer(tx, id, actorId, now);
      if (r) reroutes.push({ leaveId: id, from: r.previousApproverId, to: r.route.approverId });
    }

    // Impacts: what changed, and what an Admin should look at. Codes and ids only.
    const impacts: Array<{ kind: string; entityType: string; entityId: string; action: string; reviewStatus: string; detail?: any }> = [];
    const add = (kind: string, entityType: string, entityId: string, action: string, review = true, detail?: any) =>
      impacts.push({ kind, entityType, entityId, action, reviewStatus: review ? 'PENDING_REVIEW' : 'NO_ACTION', detail });
    add('PROFILE', 'EmployeeAttendanceProfile', state.profile?.id ?? userId, profileAction, profileAction !== 'CLOSED_AND_OPENED' && profileAction !== 'UPDATED_SAME_DAY');
    for (const h of state.hierarchyAsSubject.filter((x) => x.scope === 'EMPLOYEE')) add('HIERARCHY', 'HierarchyAssignment', h.id, 'ENDED', false);
    for (const h of state.hierarchyAsAssignee) add('HIERARCHY', 'HierarchyAssignment', h.id, 'REVIEW_ASSIGNEE_ROW');
    if (hierarchyMissing) add('HIERARCHY', 'User', userId, 'HIERARCHY_MISSING');
    for (const l of state.ownPendingLeave) {
      const r = reroutes.find((x) => x.leaveId === l.id);
      add('OWN_LEAVE_REQUEST', 'LeaveRequest', l.id, r ? 'REROUTED' : l.routingSnapshotId ? 'APPROVER_UNCHANGED' : 'LEGACY_NOT_ROUTED', !r && !l.routingSnapshotId);
    }
    for (const l of state.leaveApprovalsRoutedToUser) add('LEAVE_APPROVAL', 'LeaveRequest', l.id, 'REVIEW_APPROVER');
    for (const c of state.ownCorrections) add('CORRECTION', 'AttendanceRegularization', c.id, 'REVIEW_ROUTING');
    for (const c of state.correctionsAwaitingUser) add('CORRECTION', 'AttendanceRegularization', c.id, 'REVIEW_APPROVER');
    for (const s of ticketSnapshots) add('TICKET_REVIEW', 'Ticket', s.ticketId, s.approverId ? 'REVIEWER_FROZEN' : 'NO_REVIEWER', !s.approverId);
    for (const tk of [...state.ownedTickets, ...state.assignedTickets, ...state.coAssignedTickets]) add('TICKET', 'Ticket', tk.id, 'KEPT', false);
    for (const p of state.projectMemberships) add('PROJECT', 'ProjectMember', p.id, 'REVIEW_MEMBERSHIP');
    for (const m of state.teamMemberships) add('TEAM_MEMBERSHIP', 'TeamMember', m.id, 'REVIEW_MEMBERSHIP');
    for (const c of state.pendingChangeRequests) add('CHANGE_REQUEST', 'EmployeeProfileChangeRequest', c.id, 'REVIEW_APPROVER');
    const delta = permissionDelta(state.fromRole.name, state.toRole?.name ?? null);
    if (delta.gained.length || delta.lost.length) add('PERMISSION', 'Role', plan.toRoleId, demoted ? 'SESSIONS_REVOKED' : 'ROLE_CHANGED', false, { gained: delta.gained.length, lost: delta.lost.length });
    if (impacts.length) {
      await tx.departmentTransferImpact.createMany({ data: impacts.map((i) => ({ id: randomUUID(), transferId: t.id, kind: i.kind, entityType: i.entityType, entityId: i.entityId, action: i.action, reviewStatus: i.reviewStatus, detail: i.detail ?? null })) });
    }

    await tx.departmentTransfer.update({ where: { id: t.id }, data: { status: 'COMPLETED', appliedAt: now, reviewReasonCode: null } });
    await writeAudit(tx, {
      actorId, entityType: 'DepartmentTransfer', entityId: t.id, action: 'TRANSFER_COMPLETED', fromState: 'SCHEDULED', toState: 'COMPLETED',
      metadata: { fromDepartmentId: state.user.departmentId, toDepartmentId: plan.toDepartmentId ?? null, fromRoleId: state.user.roleId, toRoleId: plan.toRoleId, reroutes: reroutes.length, ticketSnapshots: ticketSnapshots.length, sessionsRevoked: demoted },
    });
    if (plan.toRoleId !== state.user.roleId) {
      await writeAudit(tx, { actorId, entityType: 'User', entityId: userId, action: 'USER_ROLE_CHANGED', metadata: { source: 'TRANSFER', transferId: t.id } });
    }
    return { transferId: t.id, userId, reroutes, ticketSnapshots, hierarchyMissing };
  }

  /** Decision-40 order, resolved BEFORE the department change. Workers and the transferred person are skipped. */
  private async resolveTicketReviewer(tx: Tx, ticket: TransferState['reviewTickets'][number], state: TransferState, plan: TransferPlan, now: Date) {
    const t = await tx.ticket.findUnique({ where: { id: ticket.id }, select: { assignedToId: true, approverId: true, assignees: { select: { userId: true } } } });
    const workers = new Set<string>([state.user.id, t?.assignedToId, ...(t?.assignees ?? []).map((a: any) => a.userId)].filter(Boolean) as string[]);
    const active = async (id: string | null | undefined) => {
      if (!id || workers.has(id)) return null;
      const u = await tx.user.findUnique({ where: { id }, select: { id: true, isActive: true, isSystemAccount: true } });
      return u && u.isActive && !u.isSystemAccount ? u.id : null;
    };
    const deptLead = async (departmentId: string | null, role: 'TEAM_LEAD' | 'MANAGER') => {
      if (!departmentId) return null;
      const row = await tx.hierarchyAssignment.findFirst({ where: { scope: 'DEPARTMENT', role, departmentId, isPrimary: true, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }, orderBy: { effectiveFrom: 'desc' }, select: { assigneeUserId: true } });
      return active(row?.assigneeUserId);
    };
    const original = (await active(t?.approverId)) ?? (await active(await resolveTeamLead(tx, state.user.id, state.user.departmentId, now)));
    if (original) return { approverId: original, tier: 'ORIGINAL_REVIEWER' };
    const chain: Array<[string, () => Promise<string | null>]> = [
      ['ORIGINAL_DEPT_TL', () => deptLead(state.user.departmentId, 'TEAM_LEAD')],
      ['ORIGINAL_DEPT_MANAGER', () => deptLead(state.user.departmentId, 'MANAGER')],
      ['DEPT_TL', () => deptLead(plan.toDepartmentId ?? null, 'TEAM_LEAD')],
      ['DEPT_MANAGER', () => deptLead(plan.toDepartmentId ?? null, 'MANAGER')],
      ['COMPANY_MANAGER', async () => {
        const row = await tx.hierarchyAssignment.findFirst({ where: { scope: 'COMPANY', role: 'MANAGER', isPrimary: true, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }, select: { assigneeUserId: true } });
        return active(row?.assigneeUserId);
      }],
      ['ADMIN', async () => {
        const admins = await tx.user.findMany({ where: { isActive: true, isSystemAccount: false, role: { name: { in: ADMIN_ROLES } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } });
        for (const a of admins) if (!workers.has(a.id)) return a.id;
        return null;
      }],
    ];
    for (const [tier, f] of chain) {
      const id = await f();
      if (id) return { approverId: id, tier };
    }
    return { approverId: null, tier: 'ADMIN' };
  }

  /** Activation sweep: SCHEDULED and effectiveAt <= now. Idempotent (row lock + status re-check). */
  async activateDue(): Promise<number> {
    const now = this.tva.now();
    const due = await this.prisma.departmentTransfer.findMany({ where: { status: 'SCHEDULED', effectiveAt: { lte: now } }, select: { id: true, userId: true, actorId: true }, orderBy: { effectiveAt: 'asc' }, take: 100 });
    let n = 0;
    for (const row of due) {
      try {
        let applied: Applied | null = null;
        let review = false;
        await this.prisma.$transaction(async (tx: Tx) => {
          await tx.$queryRaw`SELECT id FROM "users" WHERE id = ${row.userId} FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM "department_transfers" WHERE id = ${row.id} FOR UPDATE`;
          applied = await this.applyLocked(tx, row.id, row.actorId, now, { alreadyLockedUser: true });
          if (!applied) review = (await tx.departmentTransfer.findUnique({ where: { id: row.id }, select: { status: true } }))?.status === 'REVIEW_REQUIRED';
        });
        if (applied) {
          n += 1;
          await this.afterApplied(applied);
        } else if (review) {
          await notifyMany(this.notifier, await adminIds(this.prisma), 'transferReviewRequired', () => ({
            title: 'Scheduled transfer needs review', message: 'A scheduled transfer was not applied because something changed. Review and re-confirm or cancel it.',
            link: '/users/transfers', entityId: row.id, entityType: 'DepartmentTransfer', dedupeKey: `transfer:${row.id}:review`,
          }));
        }
      } catch (err: any) {
        this.logger.warn(`Transfer activation failed for ${row.id}: ${err?.message ?? err}`);
      }
    }
    return n;
  }

  async cancel(actor: TransitionActor, transferId: string, body: any) {
    requireAdmin(actor);
    const key = requireIdempotencyKey(body?.idempotencyKey);
    if (await findKey(this.prisma, key, 'TRANSFER_CANCEL')) return this.transferView(transferId, actor);
    const reason = requireText(body?.reason, 'Cancellation reason');
    const now = this.tva.now();
    try {
      await this.prisma.$transaction(async (tx: Tx) => {
        const peek = await tx.departmentTransfer.findUnique({ where: { id: transferId }, select: { userId: true } });
        if (!peek) notFound('Transfer not found.');
        await tx.$queryRaw`SELECT id FROM "users" WHERE id = ${peek.userId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "department_transfers" WHERE id = ${transferId} FOR UPDATE`;
        const t = await tx.departmentTransfer.findUnique({ where: { id: transferId } });
        if (t.status !== 'SCHEDULED' && t.status !== 'REVIEW_REQUIRED') conflict(TRANSITION_CODE.TRANSFER_STATE_CHANGED, 'Only a scheduled transfer or one that needs review can be cancelled.', { status: t.status });
        await tx.departmentTransfer.update({ where: { id: transferId }, data: { status: 'CANCELLED', cancelledById: actor.id, cancelledAt: now, cancelReason: reason } });
        await claimKey(tx, { key, scope: 'TRANSFER_CANCEL', entityId: transferId, actorId: actor.id });
        await writeAudit(tx, { actorId: actor.id, entityType: 'DepartmentTransfer', entityId: transferId, action: 'TRANSFER_CANCELLED', fromState: t.status, toState: 'CANCELLED' });
      });
    } catch (err) {
      if (!(isUniqueViolation(err) && (await findKey(this.prisma, key, 'TRANSFER_CANCEL')))) throw err;
    }
    return this.transferView(transferId, actor);
  }

  async markImpactReviewed(actor: TransitionActor, impactId: string) {
    requireAdmin(actor);
    const now = this.tva.now();
    return this.prisma.$transaction(async (tx: Tx) => {
      await tx.$queryRaw`SELECT id FROM "department_transfer_impacts" WHERE id = ${impactId} FOR UPDATE`;
      const i = await tx.departmentTransferImpact.findUnique({ where: { id: impactId } });
      if (!i) notFound('Impact not found.');
      if (i.reviewStatus === 'REVIEWED') return i;
      if (i.reviewStatus !== 'PENDING_REVIEW') conflict(TRANSITION_CODE.TRANSFER_STATE_CHANGED, 'This item does not need review.');
      const out = await tx.departmentTransferImpact.update({ where: { id: impactId }, data: { reviewStatus: 'REVIEWED', reviewedById: actor.id, reviewedAt: now } });
      await writeAudit(tx, { actorId: actor.id, entityType: 'DepartmentTransferImpact', entityId: impactId, action: 'TRANSFER_IMPACT_REVIEWED', fromState: 'PENDING_REVIEW', toState: 'REVIEWED' });
      return out;
    });
  }

  // ── Views ──────────────────────────────────────────────────────────────

  async transferView(transferId: string, actor: TransitionActor) {
    const t = await this.prisma.departmentTransfer.findUnique({ where: { id: transferId }, include: { impacts: { orderBy: [{ kind: 'asc' }, { id: 'asc' }] }, user: { select: { id: true, name: true, employeeId: true } } } });
    if (!t) notFound('Transfer not found.');
    const staff = isHrOrAdmin(actor);
    if (!staff && t.userId !== actor.id) forbidden(TRANSITION_CODE.FORBIDDEN, 'You cannot see this transfer.');
    const names = await this.names([t.fromDepartmentId, t.toDepartmentId], [t.fromRoleId, t.toRoleId]);
    const base = {
      id: t.id, userId: t.userId, employee: t.user, status: t.status, effectiveOn: dayOf(t.effectiveOn ?? t.effectiveAt), effectiveAt: t.effectiveAt, appliedAt: t.appliedAt,
      fromDepartment: names.dept(t.fromDepartmentId), toDepartment: names.dept(t.toDepartmentId), fromRole: names.role(t.fromRoleId), toRole: names.role(t.toRoleId),
    };
    if (!staff) return base;
    return {
      ...base, createdAt: t.createdAt, actorId: t.actorId, reason: t.reason, reviewReasonCode: t.reviewReasonCode, warnings: t.warnings,
      cancelledAt: t.cancelledAt, cancelledById: t.cancelledById, cancelReason: t.cancelReason, plan: t.plan,
      impacts: t.impacts.map((i: any) => ({ id: i.id, kind: i.kind, entityType: i.entityType, entityId: i.entityId, action: i.action, reviewStatus: i.reviewStatus, reviewedAt: i.reviewedAt, reviewedById: i.reviewedById, detail: i.detail })),
    };
  }

  private async names(depts: Array<string | null>, roles: string[]) {
    const [d, r] = await Promise.all([
      this.prisma.department.findMany({ where: { id: { in: depts.filter(Boolean) as string[] } }, select: { id: true, name: true } }),
      this.prisma.role.findMany({ where: { id: { in: roles } }, select: { id: true, name: true } }),
    ]);
    const dm = new Map(d.map((x) => [x.id, x])), rm = new Map(r.map((x) => [x.id, x]));
    return { dept: (id: string | null) => (id ? dm.get(id) ?? { id, name: null } : null), role: (id: string) => rm.get(id) ?? { id, name: null } };
  }

  async history(actor: TransitionActor, userId: string) {
    if (!isHrOrAdmin(actor) && actor.id !== userId) forbidden(TRANSITION_CODE.FORBIDDEN, 'You can see only your own transfer history.');
    const rows = await this.prisma.departmentTransfer.findMany({ where: { userId }, orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }], select: { id: true }, take: 50 });
    const out = [];
    for (const r of rows) {
      const v = await this.transferView(r.id, actor);
      if (!isHrOrAdmin(actor) && v.status !== 'COMPLETED' && v.status !== 'SCHEDULED') continue;
      out.push(v);
    }
    return out;
  }

  /** Company review list: scheduled, review-required, and completed transfers with impacts to review. */
  async reviewList(actor: TransitionActor, q: any) {
    requireHrOrAdmin(actor);
    const take = Math.min(Math.max(Number(q?.pageSize) || 25, 1), 100);
    const page = Math.max(Number(q?.page) || 1, 1);
    const status = typeof q?.status === 'string' && /^[A-Z_,]+$/.test(q.status) ? q.status.split(',') : null;
    const where: any = status
      ? { status: { in: status } }
      : { OR: [{ status: { in: ['SCHEDULED', 'REVIEW_REQUIRED'] } }, { status: 'COMPLETED', impacts: { some: { reviewStatus: 'PENDING_REVIEW' } } }] };
    const [total, rows] = await Promise.all([
      this.prisma.departmentTransfer.count({ where }),
      this.prisma.departmentTransfer.findMany({ where, orderBy: [{ effectiveAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * take, take, select: { id: true } }),
    ]);
    const items = [];
    for (const r of rows) items.push(await this.transferView(r.id, actor));
    return { page, pageSize: take, total, items };
  }

  // ── Notifications ────────────────────────────────────────────────────────

  private async afterApplied(a: Applied) {
    const now = this.tva.now();
    const user = await this.prisma.user.findUnique({ where: { id: a.userId }, select: { sessionsRevokedAt: true, departmentId: true } });
    if (user?.sessionsRevokedAt && now.getTime() - user.sessionsRevokedAt.getTime() < 60_000) this.gateway?.disconnectUser(a.userId);
    const t = await this.prisma.departmentTransfer.findUnique({ where: { id: a.transferId }, select: { fromDepartmentId: true } });
    const leads = new Set<string>();
    for (const dept of [t?.fromDepartmentId ?? null, user?.departmentId ?? null]) {
      const tl = await resolveTeamLead(this.prisma, a.userId, dept, now);
      const mgr = await resolveDepartmentManager(this.prisma, a.userId, dept, now);
      if (tl) leads.add(tl);
      if (mgr) leads.add(mgr);
    }
    const recipients = [a.userId, ...leads, ...(await hrIds(this.prisma))];
    await notifyMany(this.notifier, recipients, 'transferConfirmed', (uid) => ({
      title: 'Transfer completed', message: uid === a.userId ? 'Your department or role has changed. New work follows your new department.' : 'An employee transfer was applied.',
      link: uid === a.userId ? '/profile' : `/users/${a.userId}?tab=transfers`, entityId: a.transferId, entityType: 'DepartmentTransfer', dedupeKey: `transfer:${a.transferId}:COMPLETED:${uid}`,
    }));
    for (const r of a.reroutes) {
      const ids = [r.from, r.to, a.userId].filter(Boolean) as string[];
      await notifyMany(this.notifier, ids, 'workflowRerouted', (uid) => ({
        title: 'Leave request rerouted', message: 'A pending leave request now goes to a different approver after a transfer.', link: '/leave', entityId: r.leaveId, entityType: 'LEAVE', dedupeKey: `reroute:${a.transferId}:${r.leaveId}:${uid}`,
      }));
    }
    for (const s of a.ticketSnapshots) {
      if (!s.approverId) continue;
      await notifyMany(this.notifier, [s.approverId], 'workflowRerouted', () => ({
        title: 'Ticket review stays with you', message: 'A ticket waiting for your review belongs to someone who was transferred. You can still approve or return it.', link: `/tickets/${s.ticketId}`, entityId: s.ticketId, entityType: 'Ticket', dedupeKey: `reroute:${a.transferId}:${s.ticketId}:${s.approverId}`,
      }));
    }
    if (a.hierarchyMissing) {
      await notifyMany(this.notifier, [...(await adminIds(this.prisma)), ...(await hrIds(this.prisma))], 'hierarchyMissing', () => ({
        title: 'Reporting line missing after transfer', message: 'A transferred employee has no Team Lead or Manager in the new department. Their approvals use the fallback approvers.', link: `/users/${a.userId}`, entityId: a.userId, entityType: 'User', dedupeKey: `transfer:${a.transferId}:hierarchy-missing`,
      }));
    }
  }

  private async announceScheduled(transferId: string, userId: string, effectiveOn: string) {
    await notifyMany(this.notifier, [userId, ...(await hrIds(this.prisma))], 'transferScheduled', (uid) => ({
      title: 'Transfer scheduled', message: `A department or role change takes effect on ${effectiveOn}.`, link: uid === userId ? '/profile' : `/users/${userId}?tab=transfers`,
      entityId: transferId, entityType: 'DepartmentTransfer', dedupeKey: `transfer:${transferId}:SCHEDULED:${effectiveOn}:${uid}`,
    }));
  }
}
