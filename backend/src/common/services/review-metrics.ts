/**
 * Reviewer metrics, computed one way for analytics and the dashboard.
 *
 * Two separate clocks, never mixed:
 *   - reviewer active time: productive REVIEWER ledger seconds, frozen on the
 *     review cycle at decision time (ReviewCycleLog.reviewerWorkSeconds). Only
 *     explicit Start Review segments count; repair rows and markers never do.
 *   - review turnaround: wall-clock reviewEndedAt − reviewStartedAt, the review
 *     SLA clock. It keeps running through breaks and while nobody is timing.
 *
 * Definitions (per reviewer):
 *   decided cycles        decision APPROVED or REWORK. WITHDRAWN is the
 *                         worker pulling a submission back, not a reviewer
 *                         decision, and is reported separately.
 *   approvals/rejections  decided cycles with APPROVED / REWORK.
 *   reviewerActiveSeconds Σ reviewerWorkSeconds over decided cycles.
 *   timedReviews          decided cycles with reviewerWorkSeconds > 0.
 *   averageReviewerActive reviewerActiveSeconds / timedReviews (0 if none).
 *                         Cycles reviewed without starting the review clock
 *                         (including every cycle before Phase 4) have no
 *                         measured reviewer time; averaging them as 0 would
 *                         understate it, so they are left out of the
 *                         denominator.
 *   turnaround            decided cycles with both stamps; average over those.
 *   reviewSlaBreaches     decided cycles whose turnaround exceeds the review
 *                         SLA hours configured for the ticket's priority.
 *   breach / approval / rejection rates are over decided cycles.
 */

export const DECIDED_REVIEW_DECISIONS = ['APPROVED', 'REWORK'] as const;
export const WITHDRAWN_DECISION = 'WITHDRAWN';

export interface ReviewCycleForMetrics {
  decision: string | null;
  reviewerWorkSeconds: number | null;
  reviewStartedAt: Date | null;
  reviewEndedAt: Date | null;
  priority: string | null | undefined;
}

export interface ReviewerMetrics {
  decidedReviews: number;
  approvals: number;
  rejections: number;
  withdrawn: number;
  reviewerActiveSeconds: number;
  timedReviews: number;
  averageReviewerActiveSeconds: number;
  turnaroundMeasured: number;
  averageTurnaroundSeconds: number;
  reviewSlaBreaches: number;
  reviewSlaBreachRate: number;
  approvalPercent: number;
  rejectionPercent: number;
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

export function computeReviewerMetrics(
  cycles: ReviewCycleForMetrics[],
  reviewSlaHours: Record<string, number>,
): ReviewerMetrics {
  const decided = cycles.filter((c) => (DECIDED_REVIEW_DECISIONS as readonly string[]).includes(c.decision ?? ''));
  const approvals = decided.filter((c) => c.decision === 'APPROVED').length;
  const rejections = decided.filter((c) => c.decision === 'REWORK').length;
  const withdrawn = cycles.filter((c) => c.decision === WITHDRAWN_DECISION).length;

  const reviewerActiveSeconds = decided.reduce((acc, c) => acc + Math.max(0, c.reviewerWorkSeconds ?? 0), 0);
  const timedReviews = decided.filter((c) => (c.reviewerWorkSeconds ?? 0) > 0).length;

  let turnaroundTotal = 0;
  let turnaroundMeasured = 0;
  let reviewSlaBreaches = 0;
  for (const c of decided) {
    if (!c.reviewStartedAt || !c.reviewEndedAt) continue;
    const seconds = Math.max(0, Math.floor((c.reviewEndedAt.getTime() - c.reviewStartedAt.getTime()) / 1000));
    turnaroundTotal += seconds;
    turnaroundMeasured += 1;
    const limitHours = reviewSlaHours[c.priority ?? 'MEDIUM'] ?? reviewSlaHours.MEDIUM ?? 24;
    if (seconds > limitHours * 3600) reviewSlaBreaches += 1;
  }

  return {
    decidedReviews: decided.length,
    approvals,
    rejections,
    withdrawn,
    reviewerActiveSeconds,
    timedReviews,
    averageReviewerActiveSeconds: timedReviews > 0 ? reviewerActiveSeconds / timedReviews : 0,
    turnaroundMeasured,
    averageTurnaroundSeconds: turnaroundMeasured > 0 ? turnaroundTotal / turnaroundMeasured : 0,
    reviewSlaBreaches,
    reviewSlaBreachRate: pct(reviewSlaBreaches, decided.length),
    approvalPercent: pct(approvals, decided.length),
    rejectionPercent: pct(rejections, decided.length),
  };
}

/** The Prisma select both callers use, so they read the same rows. */
export const REVIEW_METRICS_CYCLE_SELECT = {
  decision: true,
  reviewerWorkSeconds: true,
  reviewStartedAt: true,
  reviewEndedAt: true,
  ticket: { select: { priority: true } },
} as const;

export function toMetricsCycle(c: {
  decision: string | null;
  reviewerWorkSeconds: number | null;
  reviewStartedAt: Date | null;
  reviewEndedAt: Date | null;
  ticket?: { priority?: string | null } | null;
}): ReviewCycleForMetrics {
  return {
    decision: c.decision,
    reviewerWorkSeconds: c.reviewerWorkSeconds,
    reviewStartedAt: c.reviewStartedAt,
    reviewEndedAt: c.reviewEndedAt,
    priority: c.ticket?.priority ?? 'MEDIUM',
  };
}
