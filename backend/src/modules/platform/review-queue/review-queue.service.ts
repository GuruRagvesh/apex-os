import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { EventLoggerService } from '../../../common/services/event-logger.service';
import { LeaveService } from '../../operations/leave/leave.service';
import { TransferService } from '../../core/users/transitions/transfer/transfer.service';
import { FnfService } from '../../core/users/transitions/fnf/fnf.service';
import { RetentionProposalsService } from '../../core/users/transitions/compliance/retention-proposals.service';
import { LegalHoldsService } from '../../core/users/transitions/compliance/legal-holds.service';
import { actorFrom, type TransitionActor } from '../../core/users/transitions/transitions-codes';
import { PunchReviewService } from '../attendance/console/punch-review.service';
import { CorrectionAuthorityService } from '../attendance/regularization/correction-authority.service';
import { CorrectionDecisionService } from '../attendance/regularization/correction-decision.service';
import { REVIEW_TYPE_LABEL, type ReviewQueueEmployee, type ReviewQueueItem, type ReviewRequestType } from './review-queue.types';

type Reviewer = {
  id: string;
  name: string;
  employeeId: string | null;
  isHR: boolean;
  role: { name: string; level: number } | null;
  department: { id: string; name: string } | null;
};

const dateOnly = (value: Date | string | null | undefined) => value
  ? (typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10))
  : '';

@Injectable()
export class ReviewQueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authority: CorrectionAuthorityService,
    private readonly corrections: CorrectionDecisionService,
    private readonly leave: LeaveService,
    private readonly transfers: TransferService,
    private readonly punchReviews: PunchReviewService,
    private readonly retention: RetentionProposalsService,
    private readonly holds: LegalHoldsService,
    private readonly fnf: FnfService,
    private readonly events: EventLoggerService,
  ) {}

  private actorId(user: any): string {
    const id = user?.id ?? user?.sub;
    if (!id) throw new ForbiddenException('A signed-in reviewer is required');
    return id;
  }

  private transitionActor(user: any): TransitionActor {
    return actorFrom({ user: { ...user, id: this.actorId(user) } });
  }

  private async reviewer(id: string): Promise<Reviewer | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true, name: true, employeeId: true, isHR: true,
        role: { select: { name: true, level: true } },
        department: { select: { id: true, name: true } },
      },
    }) as Promise<Reviewer | null>;
  }

  private isAdmin(actor: Reviewer | null) {
    return !!actor && ['ADMIN', 'SUPER_ADMIN'].includes(actor.role?.name ?? '');
  }

  private isHrOrAdmin(actor: Reviewer | null) {
    return !!actor && (actor.isHR || this.isAdmin(actor));
  }

  async list(user: any, scope: 'team' | 'company') {
    const actorId = this.actorId(user);
    const actor = await this.reviewer(actorId);
    if (!actor) throw new ForbiddenException('Reviewer account not found');
    const items = await this.pendingItems();
    const assignments = await (this.prisma as any).reviewQueueAssignment.findMany({ where: { endedAt: null } });
    const assignmentByKey = new Map<string, any>(assignments.map((a: any) => [`${a.requestType}:${a.requestId}`, a]));
    const reviewerIds = [...new Set(assignments.map((a: any) => a.assignedReviewerId))] as string[];
    const assignedPeople = reviewerIds.length ? await this.prisma.user.findMany({
      where: { id: { in: reviewerIds } }, select: { id: true, name: true, employeeId: true },
    }) : [];
    const people = new Map(assignedPeople.map((p) => [p.id, p]));
    const visible: ReviewQueueItem[] = [];
    for (const item of items) {
      const assignment = assignmentByKey.get(`${item.requestType}:${item.id}`);
      if (assignment && assignment.assignedReviewerId !== actorId) continue;
      const authorityScope = await this.reviewScope(actor, item);
      if (!authorityScope || authorityScope !== scope) continue;
      visible.push({
        ...item,
        assignedReviewer: assignment ? people.get(assignment.assignedReviewerId) ?? null : null,
      });
    }
    visible.sort((a, b) => b.requestDate.localeCompare(a.requestDate) || b.applicationId.localeCompare(a.applicationId));
    return { scope, total: visible.length, items: visible };
  }

  async counts(user: any) {
    const [team, company] = await Promise.all([this.list(user, 'team'), this.list(user, 'company')]);
    const teamPending = team.items.filter((item) => item.status === 'PENDING').length;
    const companyPending = company.items.filter((item) => item.status === 'PENDING').length;
    return { team: teamPending, company: companyPending, canViewCompany: companyPending > 0 || (await this.isCompanyReviewer(this.actorId(user))) };
  }

  async detail(user: any, type: ReviewRequestType, id: string) {
    return this.authorizedItem(user, type, id);
  }

  async forwardCandidates(user: any, type: ReviewRequestType, id: string) {
    const item = await this.authorizedItem(user, type, id);
    const actorId = this.actorId(user);
    let ids: string[] = [];
    const makerId = String(item.details.requestedById ?? item.details.proposedById ?? '');
    if ((type === 'ATTENDANCE_CORRECTION' || type === 'LEAVE_REQUEST') && item.subjectUserId) {
      const eligible = await this.authority.eligibleReviewerIds(item.subjectUserId);
      ids = [...eligible.team, ...eligible.company];
    } else if (type === 'PUNCH_EVIDENCE_REVIEW') {
      ids = (await this.companyReviewers(['HR', 'ADMIN', 'SUPER_ADMIN'])).map((x) => x.id);
    } else {
      ids = (await this.companyReviewers(['ADMIN', 'SUPER_ADMIN'])).map((x) => x.id);
    }
    ids = [...new Set(ids)].filter((candidate) => candidate !== actorId && candidate !== item.subjectUserId && candidate !== makerId);
    const candidates = ids.length ? await this.prisma.user.findMany({
      where: { id: { in: ids }, isActive: true, isSystemAccount: false },
      select: { id: true, employeeId: true, name: true, isHR: true, role: { select: { name: true } }, department: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    }) : [];
    return { items: candidates.map((candidate) => ({
      id: candidate.id,
      employeeId: candidate.employeeId,
      name: candidate.name,
      role: candidate.isHR ? 'HR' : candidate.role?.name ?? 'Reviewer',
      department: candidate.department,
    })) };
  }

  async forward(user: any, type: ReviewRequestType, id: string, body: any) {
    const actorId = this.actorId(user);
    const item = await this.authorizedItem(user, type, id);
    const targetId = typeof body?.reviewerId === 'string' ? body.reviewerId : '';
    const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
    if (!targetId) throw new BadRequestException('Choose a reviewer');
    const candidates = await this.forwardCandidates(user, type, id);
    if (!candidates.items.some((candidate) => candidate.id === targetId)) {
      throw new ForbiddenException('That person is not eligible to review this request');
    }
    await this.prisma.$transaction(async (tx: any) => {
      // PostgreSQL returns `void` from pg_advisory_xact_lock(). Prisma cannot
      // deserialize that value through $queryRaw, so this must be executed as
      // a statement instead of read as a result set.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${type}:${id}`}))`;
      await tx.reviewQueueAssignment.updateMany({ where: { requestType: type, requestId: id, endedAt: null }, data: { endedAt: new Date() } });
      await tx.reviewQueueAssignment.create({ data: {
        requestType: type, requestId: id, subjectUserId: item.subjectUserId,
        assignedReviewerId: targetId, forwardedById: actorId, forwardReason: reason || null,
      } });
      if (type === 'LEAVE_REQUEST') await this.routeLeave(tx, id, targetId, actorId);
    });
    this.events.log({
      actorId, entityType: 'UnifiedReviewRequest', entityId: `${type}:${id}`,
      action: 'REVIEW_REQUEST_FORWARDED' as any, metadata: { requestType: type, assignedReviewerId: targetId },
    }).catch(() => {});
    return { forwarded: true, assignedReviewer: candidates.items.find((candidate) => candidate.id === targetId) };
  }

  async decide(user: any, type: ReviewRequestType, id: string, body: any) {
    const actorId = this.actorId(user);
    const item = await this.authorizedItem(user, type, id);
    const decision = String(body?.decision ?? '').toUpperCase();
    if (decision !== 'APPROVE' && decision !== 'REJECT') throw new BadRequestException('Choose approve or reject');
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    const actor = this.transitionActor(user);
    let result: unknown;
    switch (type) {
      case 'ATTENDANCE_CORRECTION':
        const correctionInput = {
          decision,
          reason: reason || (decision === 'APPROVE' ? 'Reviewed and approved.' : 'Reviewed and rejected.'),
          reviewedFingerprint: (item.details.currentFingerprint as string | null | undefined) ?? null,
          confirmCreatorDecision: body?.confirmCreatorDecision === true,
          // An attendance-status correction is approved FOR a status.
          ...(typeof body?.grantedStatus === 'string' ? { grantedStatus: body.grantedStatus } : {}),
        };
        result = await this.corrections.enabled()
          ? this.corrections.decide(actorId, id, correctionInput)
          : this.corrections.decideCompatibility(actorId, id, correctionInput);
        break;
      case 'LEAVE_REQUEST':
        await this.ensureLeaveReviewer(id, actorId);
        result = decision === 'APPROVE'
          ? await this.leave.approve(id, actorId, user)
          : await this.leave.reject(id, actorId, user);
        break;
      case 'DEPARTMENT_ROLE_TRANSFER': {
        if (decision === 'REJECT') {
          result = await this.transfers.cancel(actor, id, { idempotencyKey: randomUUID(), reason: reason || 'Rejected from the unified review queue.' });
          break;
        }
        const transfer = await this.prisma.departmentTransfer.findUnique({ where: { id } });
        if (!transfer) throw new NotFoundException('Transfer not found');
        const plan = transfer.plan as Record<string, unknown>;
        const preview: any = await this.transfers.preview(actor, transfer.userId, plan);
        result = await this.transfers.reconfirm(actor, id, {
          ...plan,
          fingerprint: preview.fingerprint,
          effectiveOn: dateOnly(transfer.effectiveOn ?? transfer.effectiveAt),
          idempotencyKey: randomUUID(),
          reason: reason || transfer.reason || 'Approved from the unified review queue.',
        });
        break;
      }
      case 'PUNCH_EVIDENCE_REVIEW':
        result = await this.punchReviews.resolve(user, id, {
          status: decision === 'APPROVE' ? 'REVIEWED' : 'DISMISSED',
          note: reason || (decision === 'APPROVE' ? 'Reviewed.' : 'Rejected from the unified review queue.'),
        });
        break;
      case 'RETENTION_RULE_PROPOSAL':
        result = await this.retention.decide(actor, id, { decision, reason });
        break;
      case 'LEGAL_HOLD_REQUEST':
        result = await this.holds.transition(actor, id, decision === 'APPROVE' ? 'confirm' : 'reject', { reason });
        break;
      case 'FNF_ADJUSTMENT_REQUEST':
        result = await this.fnf.decideAdjustment(actor, id, { decision, reason });
        break;
    }
    await (this.prisma as any).reviewQueueAssignment.updateMany({
      where: { requestType: type, requestId: id, endedAt: null }, data: { endedAt: new Date() },
    });
    return result;
  }

  private async authorizedItem(user: any, type: ReviewRequestType, id: string): Promise<ReviewQueueItem> {
    const actorId = this.actorId(user);
    const assignment = await (this.prisma as any).reviewQueueAssignment.findFirst({ where: { requestType: type, requestId: id, endedAt: null } });
    if (assignment && assignment.assignedReviewerId !== actorId) throw new ForbiddenException('This request was forwarded to another reviewer');
    const item = (await this.pendingItems()).find((candidate) => candidate.requestType === type && candidate.id === id);
    if (!item) throw new NotFoundException('Pending request not found');
    if (item.status !== 'PENDING') throw new BadRequestException('This request has already been decided');
    const actor = await this.reviewer(actorId);
    if (!(await this.reviewScope(actor, item))) throw new ForbiddenException('You cannot review this request');
    if (assignment) {
      const person = await this.prisma.user.findUnique({ where: { id: assignment.assignedReviewerId }, select: { id: true, name: true, employeeId: true } });
      item.assignedReviewer = person;
    }
    return item;
  }

  private async reviewScope(actor: Reviewer | null, item: ReviewQueueItem): Promise<'team' | 'company' | null> {
    if (!actor) return null;
    if (item.requestType === 'ATTENDANCE_CORRECTION' || item.requestType === 'LEAVE_REQUEST') {
      if (!item.subjectUserId) return null;
      const loaded = await this.authority.loadActor(actor.id);
      return (await this.authority.eligibility(loaded, item.subjectUserId))?.scope ?? null;
    }
    if (item.requestType === 'PUNCH_EVIDENCE_REVIEW') return this.isHrOrAdmin(actor) ? 'company' : null;
    const makerId = String(item.details.requestedById ?? item.details.proposedById ?? '');
    return this.isAdmin(actor) && actor.id !== makerId ? 'company' : null;
  }

  private async isCompanyReviewer(actorId: string) {
    const actor = await this.reviewer(actorId);
    return this.isHrOrAdmin(actor);
  }

  private async companyReviewers(roles: string[]) {
    const where: any = roles.includes('HR')
      ? { isActive: true, isSystemAccount: false, OR: [{ isHR: true }, { role: { name: { in: roles.filter((x) => x !== 'HR') } } }] }
      : { isActive: true, isSystemAccount: false, role: { name: { in: roles } } };
    return this.prisma.user.findMany({ where, select: { id: true } });
  }

  private async routeLeave(tx: any, leaveId: string, reviewerId: string, actorId: string) {
    await tx.$queryRaw`SELECT id FROM "leave_requests" WHERE id = ${leaveId} FOR UPDATE`;
    const leave = await tx.leaveRequest.findUnique({ where: { id: leaveId }, include: { routingSnapshot: true } });
    if (!leave || leave.status !== 'PENDING') throw new BadRequestException('Leave request is no longer pending');
    const current = leave.routingSnapshot;
    const reviewer = await tx.user.findUnique({
      where: { id: reviewerId },
      select: { isHR: true, role: { select: { name: true } } },
    });
    if (!reviewer) throw new BadRequestException('Selected reviewer no longer exists');
    const roleName = reviewer.role?.name ?? '';
    const tier = reviewer.isHR
      ? 'HR'
      : roleName === 'TEAM_LEAD'
        ? 'EMPLOYEE_TL'
        : roleName === 'MANAGER'
          ? 'DEPT_MANAGER'
          : 'ADMIN';
    const next = await tx.routingSnapshot.create({ data: {
      id: randomUUID(), workflow: 'LEAVE', entityType: 'LeaveRequest', entityId: leave.id,
      subjectUserId: leave.userId, originalDepartmentId: current?.originalDepartmentId ?? null,
      resolvedApproverId: reviewerId, tier, fallbackReason: 'MANUAL_REVIEW_FORWARD',
      supersedesId: current?.id ?? null, createdById: actorId,
    } });
    await tx.leaveRequest.update({ where: { id: leave.id }, data: { routingSnapshotId: next.id } });
  }

  private async ensureLeaveReviewer(leaveId: string, reviewerId: string) {
    const row = await this.prisma.leaveRequest.findUnique({ where: { id: leaveId }, select: { routingSnapshot: { select: { resolvedApproverId: true } } } });
    if (row?.routingSnapshot?.resolvedApproverId === reviewerId) return;
    await this.prisma.$transaction((tx) => this.routeLeave(tx, leaveId, reviewerId, reviewerId));
  }

  private async pendingItems(): Promise<ReviewQueueItem[]> {
    const [corrections, leaves, transfers, punches, proposals, holds, fnf] = await Promise.all([
      this.prisma.attendanceRegularization.findMany({
        where: { status: { in: ['PENDING', 'STALE_REVIEW_REQUIRED', 'MANAGER_APPROVED', 'HR_APPROVED', 'APPROVED', 'REJECTED'] } },
        include: { user: { select: { id: true, employeeId: true, name: true, avatar: true, photoUrl: true, designation: true, role: { select: { name: true } }, department: { select: { id: true, name: true } } } } }, orderBy: { createdAt: 'desc' }, take: 200,
      }),
      this.prisma.leaveRequest.findMany({
        where: { status: { in: ['PENDING', 'APPROVED', 'REJECTED'] } }, include: { user: { select: { id: true, employeeId: true, name: true, avatar: true, photoUrl: true, designation: true, role: { select: { name: true } }, department: { select: { id: true, name: true } } } } }, orderBy: { createdAt: 'desc' }, take: 200,
      }),
      this.prisma.departmentTransfer.findMany({
        where: { status: { in: ['REVIEW_REQUIRED', 'COMPLETED', 'CANCELLED'] } }, include: { user: { select: { id: true, employeeId: true, name: true, avatar: true, photoUrl: true, designation: true, role: { select: { name: true } }, department: { select: { id: true, name: true } } } } }, orderBy: { updatedAt: 'desc' }, take: 200,
      }),
      this.prisma.punchEvidenceReview.findMany({
        where: { status: { in: ['PENDING', 'REVIEWED', 'DISMISSED'] } },
        include: {
          evidence: {
            include: {
              user: {
                select: {
                  id: true, employeeId: true, name: true, avatar: true, photoUrl: true, designation: true,
                  role: { select: { name: true } }, department: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      this.prisma.retentionRuleProposal.findMany({ where: { status: { in: ['PENDING', 'APPROVED', 'REJECTED'] } }, orderBy: { proposedAt: 'desc' }, take: 200 }),
      this.prisma.userLegalHold.findMany({ where: { status: { in: ['REQUESTED', 'ACTIVE', 'REJECTED'] } }, orderBy: { requestedAt: 'desc' }, take: 200 }),
      this.prisma.fnfAdjustmentRequest.findMany({ where: { status: { in: ['PENDING', 'APPROVED', 'REJECTED'] } }, orderBy: { requestedAt: 'desc' }, take: 200 }),
    ]);
    const official = corrections.length ? await this.prisma.dailyAttendance.findMany({
      where: { OR: corrections.map((row) => ({ userId: row.userId, date: row.date })) },
      select: { userId: true, date: true, status: true, punchInAt: true, punchOutAt: true, sourceFingerprint: true },
    }) : [];
    const officialByKey = new Map(official.map((row) => [`${row.userId}:${dateOnly(row.date)}`, row]));
    const identityIds = new Set<string>();
    proposals.forEach((row) => identityIds.add(row.proposedById));
    holds.forEach((row) => identityIds.add(row.userId));
    fnf.forEach((row) => identityIds.add(row.subjectUserId));
    const identities = identityIds.size ? await this.prisma.user.findMany({ where: { id: { in: [...identityIds] } }, select: { id: true, employeeId: true, name: true, avatar: true, photoUrl: true, designation: true, role: { select: { name: true } }, department: { select: { id: true, name: true } } } }) : [];
    const identity = new Map(identities.map((row) => [row.id, row]));
    const [departments, roles] = transfers.length ? await Promise.all([
      this.prisma.department.findMany({ where: { id: { in: [...new Set(transfers.flatMap((row) => [row.fromDepartmentId, row.toDepartmentId].filter(Boolean) as string[]))] } }, select: { id: true, name: true } }),
      this.prisma.role.findMany({ where: { id: { in: [...new Set(transfers.flatMap((row) => [row.fromRoleId, row.toRoleId]))] } }, select: { id: true, name: true } }),
    ]) : [[], []];
    const department = new Map(departments.map((row) => [row.id, row.name]));
    const role = new Map(roles.map((row) => [row.id, row.name]));
    const items: ReviewQueueItem[] = [];
    for (const row of corrections) {
      const current = officialByKey.get(`${row.userId}:${dateOnly(row.date)}`);
      items.push(this.item('ATTENDANCE_CORRECTION', row.id, row.userId, row.user, row.reason, row.createdAt, row.status, {
        correctionType: row.requestType,
        // The refined type: INCORRECT_ATTENDANCE_STATUS is approved FOR a status.
        policyCorrectionType: (row as any).policyCorrectionType ?? null,
        currentStatus: current?.status ?? null,
        requestedIn: row.requestedPunchIn,
        requestedOut: row.requestedPunchOut,
        currentIn: current?.punchInAt ?? null,
        currentOut: current?.punchOutAt ?? null,
        currentFingerprint: current?.sourceFingerprint ?? null,
        businessDate: dateOnly(row.date),
        createdById: row.createdById,
      }));
    }
    for (const row of leaves) items.push(this.item('LEAVE_REQUEST', row.id, row.userId, row.user, row.reason, row.createdAt, row.status, {
      leaveType: row.type, startDate: dateOnly(row.startDate), endDate: dateOnly(row.endDate), isHalfDay: row.isHalfDay,
    }));
    for (const row of transfers) items.push(this.item('DEPARTMENT_ROLE_TRANSFER', row.id, row.userId, row.user, row.reason ?? row.reviewReasonCode ?? 'Department or role transfer requires review.', row.updatedAt, row.status, {
      fromDepartment: row.fromDepartmentId ? department.get(row.fromDepartmentId) ?? row.fromDepartmentId : null,
      toDepartment: row.toDepartmentId ? department.get(row.toDepartmentId) ?? row.toDepartmentId : null,
      fromRole: role.get(row.fromRoleId) ?? row.fromRoleId,
      toRole: role.get(row.toRoleId) ?? row.toRoleId,
      effectiveOn: dateOnly(row.effectiveOn ?? row.effectiveAt), requestedById: row.actorId,
    }));
    for (const row of punches) items.push(this.item('PUNCH_EVIDENCE_REVIEW', row.id, row.evidence.userId, row.evidence.user, row.reasonCodes.join(', ') || 'Punch evidence requires review.', row.createdAt, row.status, {
      reasonCodes: row.reasonCodes, punchType: row.evidence.type, businessDate: dateOnly(row.evidence.businessDate),
      occurredAt: row.evidence.serverOccurredAt, deviceType: row.evidence.deviceType, captureChannel: row.evidence.captureChannel,
    }));
    for (const row of proposals) items.push(this.item('RETENTION_RULE_PROPOSAL', row.id, row.proposedById, identity.get(row.proposedById) ?? null, row.reason, row.proposedAt, row.status, {
      category: row.category, action: row.action, retentionMonths: row.retentionMonths, noExpiry: row.noExpiry, proposedById: row.proposedById,
    }));
    for (const row of holds) items.push(this.item('LEGAL_HOLD_REQUEST', row.id, row.userId, identity.get(row.userId) ?? null, row.notes ?? row.reasonCode, row.requestedAt ?? row.placedAt ?? new Date(0), row.status ?? 'REQUESTED', {
      reasonCode: row.reasonCode, reference: row.reference, requestedById: row.requestedById,
    }));
    for (const row of fnf) items.push(this.item('FNF_ADJUSTMENT_REQUEST', row.id, row.subjectUserId, identity.get(row.subjectUserId) ?? null, row.note ?? row.reasonCode, row.requestedAt, row.status, {
      kind: row.kind, direction: row.direction, amount: row.amount.toString(), currency: row.currency, reference: row.reference, requestedById: row.requestedById,
    }));
    return items;
  }

  private item(
    requestType: ReviewRequestType,
    id: string,
    subjectUserId: string | null,
    employee: ReviewQueueEmployee | null,
    reason: string,
    date: Date,
    sourceStatus: string,
    details: Record<string, unknown>,
  ): ReviewQueueItem {
    return {
      id, applicationId: id, requestType, requestTypeLabel: REVIEW_TYPE_LABEL[requestType], subjectUserId, employee,
      reason, requestDate: date.toISOString(),
      status: ['REJECTED', 'DISMISSED', 'CANCELLED'].includes(sourceStatus)
        ? 'REJECTED'
        : ['APPROVED', 'HR_APPROVED', 'REVIEWED', 'COMPLETED', 'ACTIVE'].includes(sourceStatus)
          ? 'APPROVED'
          : 'PENDING',
      sourceStatus, details, assignedReviewer: null,
    };
  }
}
