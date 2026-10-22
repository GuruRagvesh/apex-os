import { Injectable, Optional, forwardRef, Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { TVAService } from '../../../../../common/services/tva.service';
import { NotificationEventService } from '../../../../operations/notifications/notification-event.service';
import { writeAudit } from '../../employment-continuity';
import { RETENTION_CATEGORIES, ruleHealth, RuleHealth } from '../../lifecycle/retention';
import { requireIdempotencyKey } from '../request-keys';
import {
  badRequest, conflict, forbidden, notFound, optionalText, requireAdmin, requireText, TRANSITION_CODE, TransitionActor,
} from '../transitions-codes';
import { adminIds, notifyMany } from '../transition-support';

const MAX_MONTHS = 1200;

/**
 * Retention rules change only through a four-eyes proposal (D10, correction 8).
 *
 *   proposal(CREATE | UPDATE | DEACTIVATE) PENDING
 *      ── approve (Admin/SA ≠ proposer, base version unchanged) ──► rule written + immutable version row
 *      ── reject (Admin/SA ≠ proposer, reason) ──► REJECTED
 *      ── cancel (proposer) ──► CANCELLED
 *
 * The active rule stays in force until a DIFFERENT person approves. Nothing
 * here reads or writes legal holds, and no period is ever seeded or invented.
 */
@Injectable()
export class RetentionProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
    @Optional() @Inject(forwardRef(() => NotificationEventService)) private readonly notifier?: NotificationEventService,
  ) {}

  async propose(actor: TransitionActor, body: any) {
    requireAdmin(actor);
    const key = requireIdempotencyKey(body?.idempotencyKey);
    const replay = await this.prisma.retentionRuleProposal.findUnique({ where: { idempotencyKey: key } });
    if (replay) return replay;
    const category = String(body?.category ?? '').toUpperCase();
    if (!(RETENTION_CATEGORIES as string[]).includes(category)) badRequest(TRANSITION_CODE.RETENTION_PROPOSAL_INVALID, 'Choose Attendance, Leave or Payroll.');
    const action = String(body?.action ?? '').toUpperCase();
    if (!['CREATE', 'UPDATE', 'DEACTIVATE'].includes(action)) badRequest(TRANSITION_CODE.RETENTION_PROPOSAL_INVALID, 'Choose create, update or deactivate.');
    const reason = requireText(body?.reason, 'Reason');
    const noExpiry = body?.noExpiry === true;
    const months = noExpiry || action === 'DEACTIVATE' ? null : Number(body?.retentionMonths);
    const policyReference = action === 'DEACTIVATE' ? optionalText(body?.policyReference, 200) : requireText(body?.policyReference, 'Policy reference', 200);
    if (action !== 'DEACTIVATE' && !noExpiry && (!Number.isInteger(months) || (months as number) <= 0 || (months as number) > MAX_MONTHS)) {
      badRequest(TRANSITION_CODE.RETENTION_PROPOSAL_INVALID, `Enter a whole number of months between 1 and ${MAX_MONTHS}, or choose "retain indefinitely".`);
    }
    const created = await this.prisma.$transaction(async (tx: any) => {
      const rule = await tx.retentionRule.findUnique({ where: { category } });
      if (action === 'CREATE' && rule && rule.status === 'ACTIVE') conflict(TRANSITION_CODE.RETENTION_PROPOSAL_INVALID, 'An active rule already exists for this category. Propose an update instead.');
      if ((action === 'UPDATE' || action === 'DEACTIVATE') && !rule) conflict(TRANSITION_CODE.RETENTION_PROPOSAL_INVALID, 'There is no rule for this category yet. Propose a new rule instead.');
      if (action === 'DEACTIVATE' && rule && rule.status === 'INACTIVE') conflict(TRANSITION_CODE.RETENTION_PROPOSAL_INVALID, 'This rule is already inactive.');
      try {
        const p = await tx.retentionRuleProposal.create({
          data: {
            id: randomUUID(), category, action, retentionMonths: months, noExpiry: action === 'DEACTIVATE' ? false : noExpiry, policyReference,
            reason, baseVersion: rule?.version ?? null, proposedById: actor.id, idempotencyKey: key,
          },
        });
        await writeAudit(tx, { actorId: actor.id, entityType: 'RetentionRuleProposal', entityId: p.id, action: 'RETENTION_PROPOSED', toState: 'PENDING', metadata: { category, action } });
        return p;
      } catch (err: any) {
        if (err?.code === 'P2002' && !String(err?.meta?.target ?? '').includes('idempotency')) {
          conflict(TRANSITION_CODE.RETENTION_PROPOSAL_PENDING, 'A proposal for this category is already waiting for approval.');
        }
        throw err;
      }
    });
    const others = (await adminIds(this.prisma)).filter((id) => id !== actor.id);
    await notifyMany(this.notifier, others, 'retentionProposalPending', () => ({
      title: 'Retention rule change awaiting approval', message: 'A retention rule change needs a second Admin or Super Admin to approve or reject it.', link: '/settings?section=compliance',
      entityId: created.id, entityType: 'RetentionRuleProposal', dedupeKey: `retention:${created.id}:pending`,
    }));
    return created;
  }

  async decide(actor: TransitionActor, proposalId: string, body: any) {
    requireAdmin(actor);
    const decision = String(body?.decision ?? '').toUpperCase();
    if (decision !== 'APPROVE' && decision !== 'REJECT') badRequest(TRANSITION_CODE.RETENTION_PROPOSAL_INVALID, 'Choose approve or reject.');
    const reason = decision === 'REJECT' ? requireText(body?.reason, 'Rejection reason') : optionalText(body?.reason);
    const now = this.tva.now();
    const out = await this.prisma.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT id FROM "retention_rule_proposals" WHERE id = ${proposalId} FOR UPDATE`;
      const p = await tx.retentionRuleProposal.findUnique({ where: { id: proposalId } });
      if (!p) notFound('Proposal not found.');
      if (p.status !== 'PENDING') {
        if (p.decidedById === actor.id && ((decision === 'APPROVE' && p.status === 'APPROVED') || (decision === 'REJECT' && p.status === 'REJECTED'))) return p;
        conflict(TRANSITION_CODE.RETENTION_PROPOSAL_STATE_CHANGED, 'This proposal was already decided or cancelled.', { status: p.status });
      }
      if (p.proposedById === actor.id) forbidden(TRANSITION_CODE.RETENTION_PROPOSAL_SAME_PERSON, 'A different Admin or Super Admin must decide a retention change you proposed.');
      if (decision === 'REJECT') {
        const r = await tx.retentionRuleProposal.update({ where: { id: p.id }, data: { status: 'REJECTED', decidedById: actor.id, decidedAt: now, decisionReason: reason } });
        await writeAudit(tx, { actorId: actor.id, entityType: 'RetentionRuleProposal', entityId: p.id, action: 'RETENTION_REJECTED', fromState: 'PENDING', toState: 'REJECTED' });
        return r;
      }
      await tx.$queryRaw`SELECT id FROM "retention_rules" WHERE category = ${p.category} FOR UPDATE`;
      const rule = await tx.retentionRule.findUnique({ where: { category: p.category } });
      if ((rule?.version ?? null) !== p.baseVersion) {
        conflict(TRANSITION_CODE.RETENTION_PROPOSAL_STALE, 'The rule changed after this proposal was made. Reject it and propose again from the current rule.');
      }
      const version = rule ? rule.version + 1 : 1;
      const status = p.action === 'DEACTIVATE' ? 'INACTIVE' : 'ACTIVE';
      const values = p.action === 'DEACTIVATE'
        ? { status, active: false, version, approvedById: actor.id, approvedAt: now }
        : { status, active: true, version, retentionMonths: p.retentionMonths, noExpiry: p.noExpiry, policyReference: p.policyReference, approvedById: actor.id, approvedAt: now };
      const saved = rule
        ? await tx.retentionRule.update({ where: { category: p.category }, data: values })
        : await tx.retentionRule.create({ data: { category: p.category, createdById: p.proposedById, ...values } });
      await tx.retentionRuleVersion.create({
        data: {
          id: randomUUID(), category: p.category, version, retentionMonths: saved.retentionMonths, noExpiry: saved.noExpiry, status, policyReference: saved.policyReference,
          approvedById: actor.id, approvedAt: now, proposalId: p.id,
        },
      });
      const r = await tx.retentionRuleProposal.update({ where: { id: p.id }, data: { status: 'APPROVED', decidedById: actor.id, decidedAt: now, decisionReason: reason } });
      await writeAudit(tx, { actorId: actor.id, entityType: 'RetentionRule', entityId: saved.id, action: 'RETENTION_APPROVED', toState: status, metadata: { category: p.category, version, action: p.action } });
      return r;
    });
    await notifyMany(this.notifier, [out.proposedById], 'retentionProposalDecided', () => ({
      title: `Retention change ${out.status === 'APPROVED' ? 'approved' : 'rejected'}`, message: 'Your retention rule proposal was decided.', link: '/settings?section=compliance',
      entityId: out.id, entityType: 'RetentionRuleProposal', dedupeKey: `retention:${out.id}:decided`,
    }));
    return out;
  }

  async cancel(actor: TransitionActor, proposalId: string) {
    requireAdmin(actor);
    const now = this.tva.now();
    return this.prisma.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT id FROM "retention_rule_proposals" WHERE id = ${proposalId} FOR UPDATE`;
      const p = await tx.retentionRuleProposal.findUnique({ where: { id: proposalId } });
      if (!p) notFound('Proposal not found.');
      if (p.status === 'CANCELLED') return p;
      if (p.status !== 'PENDING') conflict(TRANSITION_CODE.RETENTION_PROPOSAL_STATE_CHANGED, 'Only a pending proposal can be cancelled.');
      if (p.proposedById !== actor.id) forbidden(TRANSITION_CODE.FORBIDDEN, 'Only the person who proposed this change can cancel it.');
      const r = await tx.retentionRuleProposal.update({ where: { id: p.id }, data: { status: 'CANCELLED', decidedAt: now } });
      await writeAudit(tx, { actorId: actor.id, entityType: 'RetentionRuleProposal', entityId: p.id, action: 'RETENTION_CANCELLED', fromState: 'PENDING', toState: 'CANCELLED' });
      return r;
    });
  }

  async overview(actor: TransitionActor) {
    requireAdmin(actor);
    const [rules, proposals, versions] = await Promise.all([
      this.prisma.retentionRule.findMany({ orderBy: { category: 'asc' } }),
      this.prisma.retentionRuleProposal.findMany({ orderBy: { proposedAt: 'desc' }, take: 100 }),
      this.prisma.retentionRuleVersion.findMany({ orderBy: [{ category: 'asc' }, { version: 'desc' }], take: 200 }),
    ]);
    return { rules, proposals, versions, readiness: await this.readiness(actor) };
  }

  /** Read-only: which protected categories would block under default-deny. */
  async readiness(actor?: TransitionActor) {
    if (actor) requireAdmin(actor);
    return computeReadiness(this.prisma);
  }
}

export async function computeReadiness(db: any): Promise<{ categories: Array<{ category: string; health: RuleHealth; version: number | null; noExpiry: boolean; retentionMonths: number | null }>; ready: boolean; defaultDenyOn: boolean }> {
  const [rules, flag] = await Promise.all([
    db.retentionRule.findMany({ select: { category: true, retentionMonths: true, active: true, approvedAt: true, status: true, noExpiry: true, policyReference: true, version: true } }),
    db.appSetting.findUnique({ where: { key: 'compliance.retentionDefaultDeny' }, select: { value: true } }),
  ]);
  const categories = (RETENTION_CATEGORIES as string[]).map((category) => {
    const r = rules.find((x: any) => x.category === category);
    return { category, health: ruleHealth(r), version: r?.version ?? null, noExpiry: !!r?.noExpiry, retentionMonths: r?.retentionMonths ?? null };
  });
  return { categories, ready: categories.every((c) => c.health === 'OK'), defaultDenyOn: flag?.value === true };
}
