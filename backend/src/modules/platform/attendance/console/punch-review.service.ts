import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TVAService } from '../../../../common/services/tva.service';
import { AccessPolicyService } from '../../../../common/services/access-policy.service';
import { EventLoggerService, OperationalAction } from '../../../../common/services/event-logger.service';
import { deviceView } from '../punch/device-evidence';

/**
 * HR punch-evidence review queue (Phase 3).
 *
 * Reads the review rows the punch service writes beside append-only evidence
 * (POLICY_SETUP_PENDING, ACCURACY_UNAVAILABLE, DEVICE_ID_UNAVAILABLE) and lets
 * HR mark each one reviewed or dismissed. The evidence row itself is never
 * touched: the database refuses that, and a review is a judgement ABOUT the
 * evidence, not a change to it.
 *
 * HR and Admin only. Managers do not see device identifiers.
 */

export const PUNCH_REVIEW_REASONS = [
  'POLICY_SETUP_PENDING',
  'ACCURACY_UNAVAILABLE',
  'DEVICE_ID_UNAVAILABLE',
] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class PunchReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
    private readonly accessPolicy: AccessPolicyService,
    private readonly eventLogger: EventLoggerService,
  ) {}

  private assertHr(actor: any) {
    if (!this.accessPolicy.isHrOrAdmin(actor)) {
      throw new ForbiddenException('Only HR and administrators can review punch evidence');
    }
  }

  async list(
    actor: any,
    filters: { status?: string; reason?: string; from?: string; to?: string; limit?: number } = {},
  ) {
    this.assertHr(actor);
    const status = filters.status ?? 'PENDING';
    if (!['PENDING', 'REVIEWED', 'DISMISSED'].includes(status)) {
      throw new BadRequestException('status must be PENDING, REVIEWED or DISMISSED');
    }
    if (filters.reason && !(PUNCH_REVIEW_REASONS as readonly string[]).includes(filters.reason)) {
      throw new BadRequestException(`reason must be one of ${PUNCH_REVIEW_REASONS.join(', ')}`);
    }
    for (const [label, value] of [['from', filters.from], ['to', filters.to]] as const) {
      if (value !== undefined && !DATE_RE.test(value)) throw new BadRequestException(`${label} must be a yyyy-MM-dd date`);
    }
    const limit = Math.min(Math.max(filters.limit ?? 100, 1), 300);

    const businessDate: any = {};
    if (filters.from) businessDate.gte = new Date(`${filters.from}T00:00:00.000Z`);
    if (filters.to) businessDate.lte = new Date(`${filters.to}T00:00:00.000Z`);

    const rows = await this.prisma.punchEvidenceReview.findMany({
      where: {
        status: status as any,
        ...(filters.reason ? { reasonCodes: { has: filters.reason } } : {}),
        ...(filters.from || filters.to ? { evidence: { businessDate } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        evidence: {
          select: {
            id: true,
            userId: true,
            type: true,
            businessDate: true,
            serverOccurredAt: true,
            locationVerification: true,
            photoVerification: true,
            accuracyStatus: true,
            policyContextStatus: true,
            deviceId: true,
            deviceType: true,
            captureChannel: true,
            deviceMetadata: true,
            source: true,
            user: { select: { id: true, name: true, employeeId: true } },
          },
        },
      },
    });

    return {
      status,
      items: rows.map((r) => ({
        id: r.id,
        status: r.status,
        reasonCodes: r.reasonCodes,
        createdAt: r.createdAt,
        reviewedAt: r.reviewedAt,
        note: r.note,
        evidence: {
          id: r.evidence.id,
          type: r.evidence.type,
          businessDate: this.tva.companyBusinessDate(r.evidence.businessDate),
          serverOccurredAt: r.evidence.serverOccurredAt,
          locationVerification: r.evidence.locationVerification,
          photoVerification: r.evidence.photoVerification,
          accuracyStatus: r.evidence.accuracyStatus,
          policyContextStatus: r.evidence.policyContextStatus,
          source: r.evidence.source,
          // The label and short code only. Never the stored id or raw metadata.
          ...deviceView(r.evidence),
        },
        employee: r.evidence.user,
      })),
    };
  }

  async resolve(actor: any, reviewId: string, body: { status?: string; note?: string }) {
    this.assertHr(actor);
    const status = body?.status;
    if (status !== 'REVIEWED' && status !== 'DISMISSED') {
      throw new BadRequestException('status must be REVIEWED or DISMISSED');
    }
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 1000) : '';
    if (status === 'DISMISSED' && !note) {
      throw new BadRequestException('A note is required to dismiss a review item');
    }

    const existing = await this.prisma.punchEvidenceReview.findUnique({ where: { id: reviewId } });
    if (!existing) throw new NotFoundException('Review item not found');
    if (existing.status !== 'PENDING') {
      throw new BadRequestException('This review item has already been resolved');
    }

    // Conditional on PENDING so two HR users resolving at once cannot both win.
    const updated = await this.prisma.punchEvidenceReview.updateMany({
      where: { id: reviewId, status: 'PENDING' },
      data: { status: status as any, reviewedById: actor.id, reviewedAt: this.tva.now(), note: note || null },
    });
    if (updated.count !== 1) throw new BadRequestException('This review item has already been resolved');

    this.eventLogger.log({
      actorId: actor.id,
      entityType: 'PunchEvidenceReview',
      entityId: reviewId,
      action: OperationalAction.ATTENDANCE_PUNCH_REVIEWED,
      fromState: 'PENDING',
      toState: status,
      metadata: { reasonCodes: existing.reasonCodes },
    }).catch(() => {});

    return this.prisma.punchEvidenceReview.findUnique({ where: { id: reviewId } });
  }
}
