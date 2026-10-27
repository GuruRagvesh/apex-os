import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Optional, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { HalfDaySession, LeaveStatus, LeaveType, NotificationType } from '@prisma/client';
import { EventsGateway } from '../../platform/gateway/events.gateway';
import { NotificationEventService } from '../notifications/notification-event.service';
import { EventLoggerService, OperationalAction } from '../../../common/services/event-logger.service';
import { LeaveAccessService } from '../../../common/services/leave-access.service';
import { LeaveBalanceService, LeavePolicyUnresolvedError } from './leave-balance.service';
import { LeaveSettlementService } from './leave-settlement.service';
import {
  ATTENDANCE_V2_DEFAULTS,
  ATTENDANCE_V2_SETTING_KEY,
} from '../../platform/attendance/punch/punch-evidence.types';
import { AccessPolicyService } from '../../../common/services/access-policy.service';
import { TVAService } from '../../../common/services/tva.service';
import { SettingsService } from '../../platform/settings/settings.service';
import { HierarchyApprovalService } from '../../../common/services/hierarchy-approval.service';
import { LeaveCalendarUnresolvedError, LeaveWorkingDayService } from './leave-working-day.service';
import { LeaveRoutingService } from './leave-routing.service';
import {
  LEAVE_EVIDENCE_MAX_BYTES,
  LeaveEvidenceStorage,
  safeEvidenceFileName,
  sniffEvidenceMime,
} from './leave-evidence.storage';
import {
  NEW_REQUEST_TYPES,
  isLateStandardSubmission,
  isStandardScheduledWorkingDay,
  nthScheduledWorkingDayAfter,
  type PaidBucket,
} from './leave-rules';
import {
  deriveLateSubmission,
  deriveLeaveSetupStatus,
  deriveLeaveSubmissionMode,
} from '../../../common/lifecycle-domain';
import { UserSetupIssuesService } from '../../core/users/user-setup-issues.service';
import { ROLES } from '../../../shared/constants/roles';

/** Emergency evidence and TL/Manager review are both due on this scheduled working day. */
const EMERGENCY_DEADLINE_WORKING_DAYS = 3;

/** What the leave screens read beside a request (Phase 3). */
export interface LeaveWorkflowView {
  submissionMode: 'STANDARD' | 'EMERGENCY';
  fundingBucket: PaidBucket | null;
  setupStatus: 'RESOLVED' | 'POLICY_SETUP_PENDING' | 'LEGACY_UNASSESSED';
  isLateSubmission: boolean | null;
  /** LATE_SUBMISSION_REVIEW_REQUIRED for a late ordinary request, else null. */
  reviewStatus: 'LATE_SUBMISSION_REVIEW_REQUIRED' | null;
  provisionallyApprovedAt: Date | null;
  evidenceDueOn: string | null;
  evidenceSubmittedAt: Date | null;
  reviewDueOn: string | null;
  currentApprover: { id: string; name: string } | null;
  routingTier: string | null;
  fallbackReason: string | null;
  evidenceCount: number;
}

@Injectable()
export class LeaveService {
  private readonly logger = new Logger(LeaveService.name);

  constructor(
    private prisma: PrismaService,
    private gateway: EventsGateway,
    private notificationEventService: NotificationEventService,
    private configService: ConfigService,
    private eventLogger: EventLoggerService,
    private leaveAccess: LeaveAccessService,
    private leaveBalance: LeaveBalanceService,
    private leaveSettlement: LeaveSettlementService,
    private accessPolicy: AccessPolicyService,
    private tva: TVAService,
    private settings: SettingsService,
    private hierarchy: HierarchyApprovalService,
    @Optional() private routing?: LeaveRoutingService,
    @Optional() private workingDays?: LeaveWorkingDayService,
    @Optional() private evidenceStorage?: LeaveEvidenceStorage,
    @Optional() private setupIssues?: UserSetupIssuesService,
  ) {}

  private get frontendUrl() {
    return this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
  }

  /**
   * Whether this viewer may act on the request.
   *
   * Phase 3 routed requests: exactly the snapshot's approver, and nobody else
   * -- not other TLs/Managers, not HR, not Admin (they observe). Requests that
   * predate routing keep the LH-2 rules.
   */
  async viewerCanApprove(user: any, leave: any): Promise<boolean> {
    if (!user) return false;
    if (leave.routingSnapshotId) {
      if (leave.status !== LeaveStatus.PENDING || leave.userId === user.id) return false;
      const snapshot = await this.prisma.routingSnapshot.findUnique({
        where: { id: leave.routingSnapshotId },
        select: { resolvedApproverId: true },
      });
      return !!snapshot?.resolvedApproverId && snapshot.resolvedApproverId === user.id;
    }
    try {
      await this.leaveAccess.assertCanApproveReject(user, leave, 'approve');
      if (!(await this.approvalLifecycleEnabled())) return true;
      if (leave.approvalStage === 'MANAGER_REVIEW') {
        const chain = await this.hierarchy.resolveApproverChainFor(leave.userId);
        return chain.some((entry) => entry.id === user.id);
      }
      if (leave.approvalStage === 'HR_REVIEW') {
        const approver = await this.accessPolicy.hydrateUser(user);
        return this.accessPolicy.isHrOrAdmin(approver);
      }
      return false;
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof NotFoundException) return false;
      throw error;
    }
  }

  /** The Phase 3 workflow facts for one request, derived for legacy rows. */
  async workflowView(item: any): Promise<LeaveWorkflowView> {
    const snapshot = item.routingSnapshotId
      ? await this.prisma.routingSnapshot.findUnique({
          where: { id: item.routingSnapshotId },
          select: { resolvedApproverId: true, tier: true, fallbackReason: true },
        })
      : null;
    const approver = snapshot?.resolvedApproverId
      ? await this.prisma.user.findUnique({ where: { id: snapshot.resolvedApproverId }, select: { id: true, name: true } })
      : null;
    const evidenceCount = await this.prisma.leaveEvidence.count({ where: { leaveRequestId: item.id } });
    const late = deriveLateSubmission(item);
    const day = (d: Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : null);
    return {
      submissionMode: deriveLeaveSubmissionMode(item),
      fundingBucket: item.fundingBucket ?? null,
      setupStatus: deriveLeaveSetupStatus(item),
      isLateSubmission: late,
      reviewStatus: late === true && item.status === LeaveStatus.PENDING ? 'LATE_SUBMISSION_REVIEW_REQUIRED' : null,
      provisionallyApprovedAt: item.provisionallyApprovedAt ?? null,
      evidenceDueOn: day(item.evidenceDueOn),
      evidenceSubmittedAt: item.evidenceSubmittedAt ?? null,
      reviewDueOn: day(item.reviewDueOn),
      currentApprover: approver,
      routingTier: snapshot?.tier ?? null,
      fallbackReason: snapshot?.fallbackReason ?? null,
      evidenceCount,
    };
  }

  private async withReadOnlyDetails(item: any, user?: any) {
    let duration: number | null;
    try {
      duration = await this.leaveBalance.getDurationForRequest(item.startDate, item.endDate, item.isHalfDay, item.userId);
    } catch (error) {
      if (!(error instanceof LeaveCalendarUnresolvedError)) throw error;
      duration = null;
    }
    return {
      ...item,
      duration,
      durationUnavailable: duration === null,
      viewerCanApprove: await this.viewerCanApprove(user, item),
      workflow: await this.workflowView(item),
    };
  }

  async findAll(query: { userId?: string; status?: LeaveStatus; departmentId?: string; page?: number; limit?: number; actionable?: string }, user?: any) {
    const where = await this.leaveAccess.buildLeaveWhereForUser(query, user);

    const page  = Math.max(1, Number(query.page)  || 1);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));
    const skip  = (page - 1) * limit;

    const actionable = query.actionable === 'true';
    const effectiveWhere = actionable ? { AND: [where, { status: LeaveStatus.PENDING }] } : where;
    const dbItems = await this.prisma.leaveRequest.findMany({
        where: effectiveWhere,
        include: { user: { select: { id: true, name: true, email: true, department: true, role: true, reportingManager: true, teamLeadName: true } } },
        orderBy: { createdAt: 'desc' },
        ...(actionable ? {} : { skip, take: limit }),
      });
    const permittedItems = actionable
      ? (await Promise.all(dbItems.map(async (item) => ({ item, allowed: await this.viewerCanApprove(user, item) })))).filter(({ allowed }) => allowed).map(({ item }) => item)
      : dbItems;
    const total = actionable ? permittedItems.length : await this.prisma.leaveRequest.count({ where: effectiveWhere });
    const pageItems = actionable ? permittedItems.slice(skip, skip + limit) : permittedItems;

    const items = await Promise.all(pageItems.map((item) => this.withReadOnlyDetails(item, user)));

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user?: any) {
    const include = { user: { select: { id: true, name: true, email: true, department: true, role: true, reportingManager: true, teamLeadName: true } } };
    const leave = user
      ? await this.leaveAccess.findAccessibleLeave(id, user, include)
      : await this.prisma.leaveRequest.findUnique({
      where: { id },
      include,
    });
    if (!leave) throw new NotFoundException('Leave request not found');
    return this.withReadOnlyDetails(leave, user);
  }

  // userId is optional so the existing public surface is unchanged, but
  // passing it is what lets the employee's own calendar decide the duration.
  async getDurationForRequest(startDate: string, endDate: string, isHalfDay: boolean, userId?: string) {
    return this.leaveBalance.getDurationForRequest(startDate, endDate, isHalfDay, userId);
  }

  /**
   * The Nth scheduled working day after `from`, from the employee's own
   * calendar where it resolves, otherwise the company's standard week
   * (Mon-Fri plus 1st/3rd/5th Saturdays). Weekly offs and holidays never count.
   */
  private async scheduledDeadline(userId: string, from: string): Promise<string> {
    const window = (() => {
      const d = new Date(`${from}T12:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + 30);
      return d.toISOString().slice(0, 10);
    })();
    let resolved: Map<string, boolean> | null = null;
    if (this.workingDays) {
      try {
        const result = await this.workingDays.resolveForEmployee(userId, from, window);
        if (result.resolved) resolved = new Map(result.days.map((d) => [d.businessDate, d.isWorkingDay]));
      } catch {
        resolved = null;
      }
    }
    return nthScheduledWorkingDayAfter(from, EMERGENCY_DEADLINE_WORKING_DAYS, (date) =>
      resolved?.has(date) ? resolved.get(date)! : isStandardScheduledWorkingDay(date),
    );
  }

  async create(data: any, userId: string) {
    const {
      startDate,
      endDate,
      isHalfDay,
      halfDayType,
      halfDaySession: requestedHalfDaySession,
      ...rest
    } = data;
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new ForbiddenException('Invalid leave dates');
    }
    if (start.getTime() > end.getTime()) {
      throw new ForbiddenException('Leave start date cannot be after end date');
    }

    const submissionMode: 'STANDARD' | 'EMERGENCY' = rest.submissionMode === 'EMERGENCY' ? 'EMERGENCY' : 'STANDARD';
    let leaveType = rest.type as LeaveType;
    if (!Object.values(LeaveType).includes(leaveType)) {
      throw new ForbiddenException('Invalid leave type');
    }

    // Refined policy: every paid request draws from one 14-day annual balance.
    // Emergency remains a timing/submission mode, never a separate entitlement.
    let fundingBucket: PaidBucket | null = null;
    if (submissionMode === 'EMERGENCY') {
      leaveType = LeaveType.ANNUAL;
    } else {
      if (!(NEW_REQUEST_TYPES as readonly string[]).includes(leaveType)) {
        throw new BadRequestException({
          message: 'New leave requests are Annual Leave, Comp Off or Unpaid. Emergency is chosen as a submission mode.',
          code: 'LEAVE_TYPE_RETIRED',
        });
      }
      // fundingBucket is a legacy CASUAL/SICK database enum. New annual-pool
      // requests deliberately leave it null; bucketOf() derives ANNUAL from
      // the request type while old rows remain readable.
    }

    let halfDaySession: HalfDaySession | null = null;
    if (isHalfDay) {
      if (requestedHalfDaySession && halfDayType && requestedHalfDaySession !== halfDayType) {
        throw new ForbiddenException('halfDaySession and halfDayType must agree');
      }
      const requestedSession = requestedHalfDaySession ?? halfDayType;
      if (!Object.values(HalfDaySession).includes(requestedSession as HalfDaySession)) {
        throw new ForbiddenException('Half-day requests require FIRST_HALF or SECOND_HALF');
      }
      halfDaySession = requestedSession as HalfDaySession;
    } else if (halfDayType || requestedHalfDaySession) {
      throw new ForbiddenException('halfDaySession is valid only for a half-day request');
    }

    // Validation. A configuration gap (no calendar, no leave policy) never
    // refuses the request: it is saved as POLICY_SETUP_PENDING instead, with
    // nothing deducted, and settled once HR/Admin complete the setup.
    let setupPending = false;
    let insufficient = false;
    const setupReasons: string[] = [];
    try {
      const checked = await this.leaveBalance.validateLeaveRequest(userId, start, end, !!isHalfDay, leaveType, fundingBucket);
      insufficient = checked?.insufficient ?? false;
    } catch (error) {
      if (error instanceof LeaveCalendarUnresolvedError) {
        setupPending = true;
        setupReasons.push(...error.reasons);
      } else if (error instanceof LeavePolicyUnresolvedError) {
        setupPending = true;
        setupReasons.push('NO_LEAVE_POLICY');
      } else {
        throw error;
      }
      // Overlap is still refused while setup is pending.
      await this.leaveBalance.assertNoOverlap(userId, start, end);
    }

    // Late (STANDARD only): submitted later than the versioned notice rule.
    const today = this.tva.companyBusinessDate(this.tva.now());
    const startDay = this.tva.companyBusinessDate(start);
    let isLate = false;
    if (submissionMode === 'STANDARD') {
      const policy = await this.leaveBalance.resolveLeavePolicy(userId, startDay).catch(() => null);
      const noticeDays = typeof policy?.standardLeaveMinimumNoticeDays === 'number' ? policy.standardLeaveMinimumNoticeDays : 1;
      isLate = isLateStandardSubmission(today, startDay, noticeDays);
    }

    const now = this.tva.now();
    let emergency: { evidenceDueOn: Date; reviewDueOn: Date } | null = null;
    if (submissionMode === 'EMERGENCY') {
      const due = await this.scheduledDeadline(userId, today);
      emergency = { evidenceDueOn: new Date(`${due}T00:00:00.000Z`), reviewDueOn: new Date(`${due}T00:00:00.000Z`) };
    }

    // EVERY COLUMN NAMED, NOTHING SPREAD. A field is written because it is
    // named here; client-sent status/approval/funding values never reach the
    // row. The route is snapshotted in the same transaction, so a request never
    // exists without its approver.
    const { leave, route } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.leaveRequest.create({
        data: {
          userId,
          type: leaveType,
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          reason: typeof rest.reason === 'string' ? rest.reason : '',
          isHalfDay: !!isHalfDay,
          halfDaySession,
          halfDayType: halfDaySession,
          status: LeaveStatus.PENDING,
          approvalStage: 'MANAGER_REVIEW',
          // Phase 3 facts, always written explicitly for new rows.
          submissionMode,
          fundingBucket: null,
          isLateSubmission: isLate,
          setupStatus: setupPending ? 'POLICY_SETUP_PENDING' : 'RESOLVED',
          ...(emergency
            ? { provisionallyApprovedAt: now, evidenceDueOn: emergency.evidenceDueOn, reviewDueOn: emergency.reviewDueOn }
            : {}),
        },
        include: { user: { select: { id: true, name: true, departmentId: true } } },
      });
      const snap = this.routing
        ? await this.routing.snapshotFor(tx, created, userId, created.user.departmentId ?? null)
        : null;
      if (setupPending && this.setupIssues) {
        await this.setupIssues.record(tx, userId, 'LEAVE_SETUP_PENDING', { leaveRequestId: created.id, reasons: setupReasons });
      }
      // The row was read before its snapshot was linked; return the linked id.
      return { leave: snap ? { ...created, routingSnapshotId: snap.snapshot.id } : created, route: snap?.route ?? null };
    });

    this.eventLogger.log({
      actorId: userId,
      entityType: 'LeaveRequest',
      entityId: leave.id,
      action: OperationalAction.LEAVE_REQUESTED,
      toState: 'PENDING',
      metadata: { type: leave.type, submissionMode, late: isLate, setupPending, insufficient, tier: route?.tier ?? null },
    }).catch(() => {});

    if (setupPending) this.setupIssues?.notifyPending(userId).catch(() => undefined);

    // The routed approver is told; observers are not spammed. Legacy behaviour
    // (department managers) applies only when routing is unavailable.
    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];
    const label = submissionMode === 'EMERGENCY' ? 'Emergency Annual Leave' : leave.type;
    const flags = [isLate ? 'late submission, review required' : null, setupPending ? 'leave setup pending' : null, insufficient ? 'balance may be insufficient' : null].filter(Boolean);
    const message = `${leave.user.name} requested ${label} leave (${startStr} to ${endStr}).${flags.length ? ` Note: ${flags.join('; ')}.` : ''}`;
    try {
      if (route?.approverId) {
        await this.notificationEventService.sendNotification(route.approverId, 'teamLeaveApply', {
          title: `New leave request: ${leave.user.name}`,
          message: route.fallbackReason ? `${message} ${route.fallbackReason}` : message,
          type: NotificationType.INFO,
          link: '/leave',
          entityId: leave.id,
          entityType: 'LEAVE',
        });
      }
      // HR sees Emergency and late requests (visibility, not approval).
      if (submissionMode === 'EMERGENCY' || isLate) {
        const hr = await this.prisma.user.findMany({ where: { isActive: true, isHR: true, isSystemAccount: false, id: { notIn: [userId, route?.approverId ?? ''] } }, select: { id: true } });
        for (const h of hr) {
          await this.notificationEventService.sendNotification(h.id, 'teamLeaveApply', {
            title: submissionMode === 'EMERGENCY' ? `Emergency Leave: ${leave.user.name}` : `Late leave request: ${leave.user.name}`,
            message,
            type: NotificationType.INFO,
            link: '/leave',
            entityId: leave.id,
            entityType: 'LEAVE',
          });
        }
      }
    } catch (_e) { /* non-critical */ }

    return {
      ...leave,
      workflow: await this.workflowView(leave),
      warnings: [
        ...(setupPending ? ['LEAVE_POLICY_SETUP_PENDING'] : []),
        ...(isLate ? ['LATE_SUBMISSION_REVIEW_REQUIRED'] : []),
        ...(insufficient ? ['LEAVE_BALANCE_INSUFFICIENT'] : []),
        ...(route?.fallbackReason ? ['LEAVE_APPROVAL_FALLBACK'] : []),
      ],
    };
  }

  async getUserBalance(userId: string, requester: any, leaveType?: LeaveType | PaidBucket) {
    if (requester.id !== userId) {
      const targetUser = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { role: true, department: true },
      });
      if (!targetUser) throw new NotFoundException('User not found');
      const canView = await this.accessPolicy.canViewUser(requester, targetUser);
      if (!canView) throw new ForbiddenException('You do not have permission to view this user\'s leave balance');
    }
    return this.leaveBalance.getLeaveBalance(
      userId,
      this.tva.financialYear().startYear,
      leaveType,
    );
  }

  /** Whether the two-stage Manager -> HR approval chain is switched on. */
  private async approvalLifecycleEnabled(): Promise<boolean> {
    const cfg = await this.settings.get(ATTENDANCE_V2_SETTING_KEY);
    return (
      (cfg?.leaveApprovalEnabled ?? ATTENDANCE_V2_DEFAULTS.leaveApprovalEnabled) === true
    );
  }

  /**
   * Refuses unless `actor` is the request's current routed approver. Reroutes
   * first when that approver has since become unavailable, so the request is
   * never stranded.
   */
  private async assertRoutedApprover(leave: any, actorId: string) {
    if (leave.userId === actorId) throw new ForbiddenException('You cannot act on your own leave request');
    if (leave.status !== LeaveStatus.PENDING) throw new ForbiddenException('Only pending leave requests can be processed');
    await this.routing?.rerouteIfUnavailable(leave.id).catch(() => false);
    const fresh = await this.prisma.leaveRequest.findUnique({ where: { id: leave.id }, select: { routingSnapshotId: true } });
    const snapshot = fresh?.routingSnapshotId
      ? await this.prisma.routingSnapshot.findUnique({ where: { id: fresh.routingSnapshotId } })
      : null;
    if (!snapshot?.resolvedApproverId || snapshot.resolvedApproverId !== actorId) {
      const name = snapshot?.resolvedApproverId
        ? (await this.prisma.user.findUnique({ where: { id: snapshot.resolvedApproverId }, select: { name: true } }))?.name
        : null;
      throw new ForbiddenException(
        name
          ? `Only the current approver (${name}) can decide this request. Others can view it.`
          : 'This request has no available approver yet; it will be rerouted automatically.',
      );
    }
  }

  async approve(id: string, approverId: string, user?: any) {
    const include = { user: { select: { id: true, name: true, email: true, role: true, departmentId: true } } };
    const raw = await this.prisma.leaveRequest.findUnique({ where: { id }, include });
    if (!raw) throw new NotFoundException();

    // ── Phase 3 routed request: exactly one approver acts ─────────────────
    if (raw.routingSnapshotId) {
      await this.assertRoutedApprover(raw, approverId);
      const { leave: updated, settlement } = await this.leaveSettlement.settleAndApprove({
        leaveId: id,
        approverId,
        routed: true,
      });
      this.eventLogger.log({
        actorId: approverId,
        entityType: 'LeaveRequest',
        entityId: id,
        action: OperationalAction.LEAVE_APPROVED,
        fromState: 'MANAGER_REVIEW',
        toState: settlement ? 'APPROVED' : 'APPROVED (settlement pending setup)',
      }).catch(() => {});
      this.gateway.emitLeaveStatusChanged(id, 'APPROVED', raw.userId);
      await this.notifyDecision(raw, 'APPROVED', settlement);
      return updated;
    }

    const leave = user ? await this.leaveAccess.findAccessibleLeave(id, user, include) : raw;
    if (!leave) throw new NotFoundException();
    const actor = user ?? await this.prisma.user.findUnique({ where: { id: approverId }, include: { role: true, department: true } });
    if (!actor) throw new ForbiddenException('Not authorized');
    await this.leaveAccess.assertCanApproveReject(actor, leave, 'approve');

    // ── Legacy two-stage chain (LH-2), for requests that predate routing ──
    if (await this.approvalLifecycleEnabled()) {
      return this.approveThroughLifecycle(leave, actor, approverId);
    }

    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data: { status: LeaveStatus.APPROVED, approvedBy: approverId, approvedAt: this.tva.now() },
    });
    this.eventLogger.log({ actorId: approverId, entityType: 'LeaveRequest', entityId: id, action: OperationalAction.LEAVE_APPROVED, fromState: 'PENDING', toState: 'APPROVED' }).catch(() => {});
    this.gateway.emitLeaveStatusChanged(id, 'APPROVED', leave.userId);
    await this.notifyDecision(leave, 'APPROVED', null);
    return updated;
  }

  private async notifyDecision(leave: any, outcome: 'APPROVED' | 'REJECTED', settlement: any | null) {
    const startStr = new Date(leave.startDate).toISOString().split('T')[0];
    const endStr = new Date(leave.endDate).toISOString().split('T')[0];
    let funding = '';
    if (outcome === 'APPROVED' && settlement) {
      funding =
        settlement.fundingOutcome === 'PAID'
          ? ''
          : settlement.fundingOutcome === 'UNPAID'
            ? ' It is recorded as leave without pay, as your paid balance is exhausted.'
            : ` ${settlement.paidDays} day(s) are paid and ${settlement.unpaidDays} day(s) are without pay.`;
    } else if (outcome === 'APPROVED' && leave.routingSnapshotId && !settlement) {
      funding = ' Its pay settlement will be recorded once leave setup is completed.';
    }
    try {
      await this.notificationEventService.sendNotification(
        leave.userId,
        outcome === 'APPROVED' ? 'leaveApproved' : 'leaveRejected',
        {
          title: outcome === 'APPROVED' ? 'Leave request approved' : 'Leave request rejected',
          message: `Your ${leave.type} leave (${startStr} to ${endStr}) has been ${outcome === 'APPROVED' ? 'approved' : 'rejected'}.${funding}`,
          type: outcome === 'APPROVED' ? NotificationType.SUCCESS : NotificationType.WARNING,
          link: '/leave',
          entityId: leave.id,
          entityType: 'LEAVE',
        },
      );
    } catch (_e) { /* never crash main op */ }
  }

  /**
   * Manager -> HR approval, on the existing LeaveRequest (LH-2 legacy path).
   *
   * Only requests created before Phase 3 routing reach here.
   */
  private async approveThroughLifecycle(leave: any, actor: any, approverId: string) {
    const isHr = this.accessPolicy.isHrOrAdmin(actor);

    if (leave.approvalStage === 'MANAGER_REVIEW') {
      const chain = await this.hierarchy.resolveApproverChainFor(leave.userId);
      const entry = chain.find((c) => c.id === approverId);
      if (!entry) {
        throw new ForbiddenException(
          "Only this employee's reporting hierarchy can approve their leave request",
        );
      }
      const viaAdminOverride = entry.tier === 'ADMIN';
      const updated = await this.prisma.leaveRequest.update({
        where: { id: leave.id },
        data: {
          approvalStage: 'HR_REVIEW',
          managerApprovedById: approverId,
          managerApprovedAt: this.tva.now(),
        },
      });
      this.eventLogger.log({
        actorId: approverId,
        entityType: 'LeaveRequest',
        entityId: leave.id,
        action: OperationalAction.LEAVE_APPROVED,
        fromState: 'MANAGER_REVIEW',
        toState: viaAdminOverride ? 'HR_REVIEW (admin override)' : 'HR_REVIEW',
      }).catch(() => {});
      try {
        await this.notificationEventService.sendNotification(leave.userId, 'leaveApproved', {
          title: 'Leave request sent to HR',
          message: 'Your reporting manager approved your leave. It is now with HR for final approval.',
          type: NotificationType.INFO,
          link: '/leave',
          entityId: leave.id,
          entityType: 'LEAVE',
        });
      } catch (_e) { /* never crash main op */ }
      return updated;
    }

    if (leave.approvalStage === 'HR_REVIEW') {
      if (!isHr) {
        throw new ForbiddenException('Only HR can give final approval for leave');
      }
      const { leave: updated, settlement } = await this.leaveSettlement.settleAndApprove({
        leaveId: leave.id,
        hrApproverId: approverId,
      });
      this.eventLogger.log({
        actorId: approverId,
        entityType: 'LeaveRequest',
        entityId: leave.id,
        action: OperationalAction.LEAVE_APPROVED,
        fromState: 'HR_REVIEW',
        toState: 'APPROVED',
      }).catch(() => {});
      this.gateway.emitLeaveStatusChanged(leave.id, 'APPROVED', leave.userId);
      await this.notifyDecision(leave, 'APPROVED', settlement);
      return updated;
    }

    throw new ForbiddenException('This leave request has already completed its approval chain');
  }

  async reject(id: string, rejectorId: string, user?: any) {
    const include = { user: { select: { id: true, name: true, email: true, role: true, departmentId: true } } };
    const raw = await this.prisma.leaveRequest.findUnique({ where: { id }, include });
    if (!raw) throw new NotFoundException();

    if (raw.routingSnapshotId) {
      await this.assertRoutedApprover(raw, rejectorId);
    } else {
      const leave = user ? await this.leaveAccess.findAccessibleLeave(id, user, include) : raw;
      const actor = user ?? await this.prisma.user.findUnique({ where: { id: rejectorId }, include: { role: true, department: true } });
      if (!actor) throw new ForbiddenException('Not authorized');
      await this.leaveAccess.assertCanApproveReject(actor, leave, 'reject');
      if (await this.approvalLifecycleEnabled() && !(await this.viewerCanApprove(actor, leave))) {
        throw new ForbiddenException('Only the current approval-stage owner can reject this leave request');
      }
    }

    // Conditional on PENDING, so a reject cannot overwrite an approval that
    // committed while this request was being read.
    const changed = await this.prisma.leaveRequest.updateMany({
      where: { id, status: LeaveStatus.PENDING },
      data: { status: LeaveStatus.REJECTED, rejectedBy: rejectorId, rejectedAt: this.tva.now() },
    });
    if (changed.count !== 1) throw new ForbiddenException('Only pending leave requests can be processed');
    const updated = await this.prisma.leaveRequest.findUnique({ where: { id } });

    this.eventLogger.log({ actorId: rejectorId, entityType: 'LeaveRequest', entityId: id, action: OperationalAction.LEAVE_REJECTED, fromState: 'PENDING', toState: 'REJECTED' }).catch(() => {});
    this.gateway.emitLeaveStatusChanged(id, 'REJECTED', raw.userId);
    await this.notifyDecision(raw, 'REJECTED', null);
    return updated;
  }

  async cancel(id: string, userId: string) {
    const leave = await this.prisma.leaveRequest.findUnique({
      where: { id },
      include: { user: { select: { id: true, name: true, departmentId: true } } },
    });
    if (!leave) throw new NotFoundException();
    if (leave.userId !== userId) throw new ForbiddenException();

    // Only PENDING leaves can be cancelled by the requester.
    if (leave.status !== LeaveStatus.PENDING) {
      throw new ForbiddenException('Only pending leave requests can be cancelled');
    }

    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data: { status: LeaveStatus.CANCELLED },
    });

    this.eventLogger.log({
      actorId: userId,
      entityType: 'LeaveRequest',
      entityId: id,
      action: OperationalAction.LEAVE_CANCELLED,
      fromState: 'PENDING',
      toState: 'CANCELLED',
    }).catch(() => {});

    // The routed approver's queue stays accurate.
    try {
      const snapshot = leave.routingSnapshotId
        ? await this.prisma.routingSnapshot.findUnique({ where: { id: leave.routingSnapshotId }, select: { resolvedApproverId: true } })
        : null;
      const startStr = leave.startDate.toISOString().split('T')[0];
      const endStr   = leave.endDate.toISOString().split('T')[0];
      const recipients = snapshot?.resolvedApproverId
        ? [snapshot.resolvedApproverId]
        : leave.user.departmentId
          ? (await this.prisma.user.findMany({
              where: {
                isActive: true,
                role: { name: { in: ['MANAGER', 'ADMIN', 'SUPER_ADMIN', 'TEAM_LEAD'] } },
                OR: [
                  { departmentId: leave.user.departmentId },
                  { managedDepts: { some: { departmentId: leave.user.departmentId } } },
                ],
              },
              select: { id: true },
            })).map((m) => m.id)
          : [];
      for (const recipient of recipients) {
        if (recipient === userId) continue;
        await this.notificationEventService.sendNotification(recipient, 'teamLeaveApply', {
          title: `Leave cancelled: ${leave.user.name}`,
          message: `${leave.type} leave request (${startStr} to ${endStr}) has been cancelled by the employee.`,
          type: NotificationType.INFO,
          link: '/leave',
          entityId: leave.id,
          entityType: 'LEAVE',
        });
      }
    } catch (_e) { /* non-critical — never crash the cancel operation */ }

    return updated;
  }

  async getStats(user?: any) {
    const scope = await this.leaveAccess.buildLeaveWhereForUser({}, user);
    const [total, pending, approved, rejected] = await Promise.all([
      this.prisma.leaveRequest.count({ where: scope }),
      this.prisma.leaveRequest.count({ where: { ...scope, status: LeaveStatus.PENDING } }),
      this.prisma.leaveRequest.count({ where: { ...scope, status: LeaveStatus.APPROVED } }),
      this.prisma.leaveRequest.count({ where: { ...scope, status: LeaveStatus.REJECTED } }),
    ]);
    return { total, pending, approved, rejected };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Emergency evidence (Phase 3)
  // ───────────────────────────────────────────────────────────────────────

  /** Who may see a request's evidence: the owner, its approver, HR and Admin. */
  private async assertEvidenceViewer(leave: any, actor: any) {
    if (actor?.id === leave.userId) return;
    if (this.accessPolicy.isHrOrAdmin(await this.accessPolicy.hydrateUser(actor))) return;
    if (leave.routingSnapshotId) {
      const snap = await this.prisma.routingSnapshot.findUnique({ where: { id: leave.routingSnapshotId }, select: { resolvedApproverId: true } });
      if (snap?.resolvedApproverId === actor?.id) return;
    }
    throw new ForbiddenException('You do not have permission to view this evidence');
  }

  /**
   * Adds one evidence file to the employee's own request. Append-only: a file
   * is never replaced; the same file twice is refused; every file records its
   * name, type, size, SHA-256, uploader and time.
   */
  async submitEvidence(
    id: string,
    actorId: string,
    file: { buffer?: Buffer; originalname?: string; mimetype?: string; size?: number } | undefined,
    note?: string,
  ) {
    const leave = await this.prisma.leaveRequest.findUnique({ where: { id } });
    if (!leave) throw new NotFoundException('Leave request not found');
    if (leave.userId !== actorId) throw new ForbiddenException('Only the employee who requested this leave can add evidence');
    if (leave.status === LeaveStatus.CANCELLED || leave.status === LeaveStatus.REJECTED) {
      throw new BadRequestException('Evidence cannot be added to a cancelled or rejected request');
    }
    if (!file?.buffer || file.buffer.length === 0) throw new BadRequestException('Choose a file to upload');
    if (file.buffer.length > LEAVE_EVIDENCE_MAX_BYTES) throw new BadRequestException('Evidence files are limited to 10 MB');
    const mimeType = sniffEvidenceMime(file.buffer);
    if (!mimeType) throw new BadRequestException('Evidence must be a PDF, JPEG, PNG or WebP file');
    if (!this.evidenceStorage) throw new BadRequestException('Leave evidence storage is unavailable');

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const duplicate = await this.prisma.leaveEvidence.findUnique({ where: { leaveRequestId_sha256: { leaveRequestId: id, sha256 } } });
    if (duplicate) throw new BadRequestException('This file has already been submitted for this request');

    const storageKey = await this.evidenceStorage.upload(leave.userId, file.buffer, mimeType);
    const now = this.tva.now();
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.leaveEvidence.create({
        data: {
          id: randomUUID(),
          leaveRequestId: id,
          userId: leave.userId,
          uploadedById: actorId,
          fileName: safeEvidenceFileName(file.originalname, mimeType),
          mimeType,
          sizeBytes: file.buffer!.length,
          sha256,
          storageKey,
          note: typeof note === 'string' && note.trim() ? note.trim().slice(0, 1000) : null,
        },
      });
      // The first evidence time is kept; later files never move it.
      if (!leave.evidenceSubmittedAt) {
        await tx.leaveRequest.update({ where: { id }, data: { evidenceSubmittedAt: now } });
      }
      return row;
    });

    this.eventLogger.log({
      actorId,
      entityType: 'LeaveRequest',
      entityId: id,
      action: OperationalAction.LEAVE_EVIDENCE_SUBMITTED,
      metadata: { evidenceId: created.id, sizeBytes: created.sizeBytes, mimeType },
    }).catch(() => {});

    return this.evidenceView(created);
  }

  private evidenceView(row: any) {
    // The storage key is never returned.
    return {
      id: row.id,
      fileName: row.fileName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      sha256: row.sha256,
      uploadedById: row.uploadedById,
      note: row.note,
      createdAt: row.createdAt,
    };
  }

  async listEvidence(id: string, actor: any) {
    const leave = await this.prisma.leaveRequest.findUnique({ where: { id } });
    if (!leave) throw new NotFoundException('Leave request not found');
    await this.assertEvidenceViewer(leave, actor);
    const rows = await this.prisma.leaveEvidence.findMany({ where: { leaveRequestId: id }, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => this.evidenceView(r));
  }

  async readEvidence(id: string, evidenceId: string, actor: any) {
    const leave = await this.prisma.leaveRequest.findUnique({ where: { id } });
    if (!leave) throw new NotFoundException('Leave request not found');
    await this.assertEvidenceViewer(leave, actor);
    const row = await this.prisma.leaveEvidence.findFirst({ where: { id: evidenceId, leaveRequestId: id } });
    if (!row) throw new NotFoundException('Evidence not found');
    if (!this.evidenceStorage) throw new BadRequestException('Leave evidence storage is unavailable');
    const content = await this.evidenceStorage.read(row.storageKey);
    return { ...content, fileName: row.fileName, mimeType: row.mimeType };
  }

  /**
   * Switches an Emergency request's funding between Casual and Sick, with a
   * reason (decision 7). The current approver or HR/Admin, while pending.
   */
  async changeFunding(id: string, actor: any, body: { fundingBucket?: string; reason?: string }) {
    throw new BadRequestException('Casual/Sick funding buckets are retired. Paid leave uses the single annual balance.');
    /* Legacy implementation retained below temporarily for historical audit
       compatibility; it is unreachable for new requests.
    const bucket = body?.fundingBucket;
    if (bucket !== 'CASUAL' && bucket !== 'SICK') throw new BadRequestException('fundingBucket must be CASUAL or SICK');
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (!reason) throw new BadRequestException('A reason is required to change funding');
    const leave = await this.prisma.leaveRequest.findUnique({ where: { id } });
    if (!leave) throw new NotFoundException('Leave request not found');
    if (leave.status !== LeaveStatus.PENDING) throw new BadRequestException('Funding can only change while the request is pending');
    if (deriveLeaveSubmissionMode(leave) !== 'EMERGENCY') throw new BadRequestException('Only Emergency Leave has a funding choice');
    const hydrated = await this.accessPolicy.hydrateUser(actor);
    let allowed = this.accessPolicy.isHrOrAdmin(hydrated);
    if (!allowed && leave.routingSnapshotId) {
      const snap = await this.prisma.routingSnapshot.findUnique({ where: { id: leave.routingSnapshotId }, select: { resolvedApproverId: true } });
      allowed = snap?.resolvedApproverId === actor.id;
    }
    if (!allowed || actor.id === leave.userId) throw new ForbiddenException('Only the approver or HR can change Emergency Leave funding');
    if (leave.fundingBucket === bucket) return leave;

    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data: { fundingBucket: bucket, type: bucket as LeaveType, fundingChangedById: actor.id, fundingChangeReason: reason.slice(0, 1000) },
    });
    this.eventLogger.log({
      actorId: actor.id,
      entityType: 'LeaveRequest',
      entityId: id,
      action: OperationalAction.LEAVE_FUNDING_CHANGED,
      fromState: leave.fundingBucket ?? 'UNSET',
      toState: bucket,
      metadata: { reason: reason.slice(0, 200) },
    }).catch(() => {});
    return updated; */
  }

  // ───────────────────────────────────────────────────────────────────────
  // Scheduled work (Phase 3)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Re-checks PENDING requests saved as setup-pending and marks them RESOLVED
   * once their calendar and leave policy resolve; settles APPROVED ones that
   * were approved while pending. Idempotent; nothing is deducted until then.
   */
  async resettleSetupPending(): Promise<{ resolved: number; settled: number; stillPending: number }> {
    const pending = await this.prisma.leaveRequest.findMany({
      where: { status: LeaveStatus.PENDING, setupStatus: 'POLICY_SETUP_PENDING' },
      select: { id: true, userId: true, startDate: true, endDate: true, isHalfDay: true },
    });
    let resolved = 0;
    let stillPending = 0;
    const touched = new Set<string>();
    for (const row of pending) {
      try {
        await this.leaveBalance.getDurationForRequest(row.startDate, row.endDate, row.isHalfDay, row.userId);
        const policy = await this.leaveBalance.resolveLeavePolicy(row.userId, this.tva.companyBusinessDate(row.startDate));
        if (!policy) { stillPending += 1; continue; }
        const out = await this.prisma.leaveRequest.updateMany({
          where: { id: row.id, status: LeaveStatus.PENDING, setupStatus: 'POLICY_SETUP_PENDING' },
          data: { setupStatus: 'RESOLVED' },
        });
        if (out.count === 1) {
          resolved += 1;
          touched.add(row.userId);
          this.eventLogger.log({ actorId: 'system', entityType: 'LeaveRequest', entityId: row.id, action: OperationalAction.LEAVE_SETUP_RESOLVED }).catch(() => {});
        }
      } catch {
        stillPending += 1;
      }
    }
    const approved = await this.leaveSettlement.resettleApproved();
    for (const id of approved.settled) {
      const r = await this.prisma.leaveRequest.findUnique({ where: { id }, select: { userId: true } });
      if (r) touched.add(r.userId);
      this.eventLogger.log({ actorId: 'system', entityType: 'LeaveRequest', entityId: id, action: OperationalAction.LEAVE_SETUP_RESOLVED, toState: 'SETTLED' }).catch(() => {});
    }
    for (const userId of touched) await this.setupIssues?.refreshForUser(userId, []);
    return { resolved, settled: approved.settled.length, stillPending: stillPending + approved.stillPending };
  }

  /**
   * Emergency Leave reminders and escalation. Missing evidence after its due
   * date reminds the employee and the approver; a review still pending after
   * its due date escalates to the approver and HR. Never an absence, never an
   * automatic decision. One reminder per request per day (notification dedupe).
   */
  async emergencyReminders(): Promise<{ evidence: number; review: number }> {
    const today = this.tva.companyBusinessDate(this.tva.now());
    const todayDate = new Date(`${today}T00:00:00.000Z`);
    const rows = await this.prisma.leaveRequest.findMany({
      where: {
        submissionMode: 'EMERGENCY',
        status: LeaveStatus.PENDING,
        OR: [
          { evidenceSubmittedAt: null, evidenceDueOn: { lt: todayDate } },
          { reviewDueOn: { lt: todayDate } },
        ],
      },
      include: { user: { select: { name: true } } },
    });
    let evidence = 0;
    let review = 0;
    for (const leave of rows) {
      const snap = leave.routingSnapshotId
        ? await this.prisma.routingSnapshot.findUnique({ where: { id: leave.routingSnapshotId }, select: { resolvedApproverId: true } })
        : null;
      const send = (userId: string, title: string, message: string) =>
        this.notificationEventService.sendNotification(userId, 'teamLeaveApply', {
          title, message, type: NotificationType.WARNING, link: '/leave', entityId: leave.id, entityType: 'LEAVE',
        }).catch(() => undefined);
      if (!leave.evidenceSubmittedAt && leave.evidenceDueOn && leave.evidenceDueOn < todayDate) {
        await send(leave.userId, 'Emergency Leave evidence overdue', 'Please upload the evidence for your Emergency Leave. The day stays protected while it is reviewed.');
        if (snap?.resolvedApproverId) await send(snap.resolvedApproverId, `Evidence overdue: ${leave.user.name}`, `${leave.user.name}'s Emergency Leave evidence was due ${leave.evidenceDueOn.toISOString().slice(0, 10)}.`);
        evidence += 1;
      }
      if (leave.reviewDueOn && leave.reviewDueOn < todayDate) {
        if (snap?.resolvedApproverId) await send(snap.resolvedApproverId, `Review overdue: ${leave.user.name}`, `Please review ${leave.user.name}'s Emergency Leave. The review was due ${leave.reviewDueOn.toISOString().slice(0, 10)}.`);
        const hr = await this.prisma.user.findMany({ where: { isActive: true, isHR: true, isSystemAccount: false }, select: { id: true } });
        for (const h of hr) await send(h.id, `Emergency Leave review overdue: ${leave.user.name}`, 'The TL/Manager review is overdue. HR is informed for visibility; the approver still decides.');
        review += 1;
      }
    }
    return { evidence, review };
  }

  /** Reroutes pending requests whose approver is no longer available. */
  async rerouteSweep(): Promise<number> {
    return this.routing ? this.routing.sweep() : 0;
  }

  /** Called when a person stops being able to approve (deactivated, archived). */
  async rerouteForApprover(approverId: string, actorId = 'system'): Promise<number> {
    return this.routing ? this.routing.rerouteForApprover(approverId, actorId) : 0;
  }

  /** Admin/Super Admin role names, for callers that need the fallback set. */
  static readonly ADMIN_ROLES = [ROLES.ADMIN, ROLES.SUPER_ADMIN];
}
