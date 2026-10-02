/**
 * What the ticket page may offer around a review, derived from the backend.
 *
 * - Reviewer actions (Start / Pause Review, Approve, Request Rework) only when
 *   the backend says the viewer can approve (`viewerCanApprove`).
 * - Withdraw Submission only for the ticket's primary assignee while in REVIEW.
 * - "Review running" only from the ledger: timers.activeClock ===
 *   'REVIEWER_WORK' and the running row is the viewer's. Never from status.
 * - Where the backend requires it (ticket.reviewTimerRequired), Approve and
 *   Send Back stay unavailable until the viewer's own review is running; the
 *   backend refuses such a decision too (409 REVIEW_NOT_STARTED).
 * - Everything is disabled while the ticket is loading or could not be read.
 */

export interface ReviewControls {
  inReview: boolean;
  isReviewer: boolean;
  /** The viewer's own reviewer clock is running on this ticket (ledger). */
  reviewRunningForViewer: boolean;
  /** Someone's reviewer clock is running on this ticket (ledger). */
  reviewRunning: boolean;
  canStartReview: boolean;
  canPauseReview: boolean;
  canDecide: boolean;
  canWithdraw: boolean;
  /** The backend requires the viewer's running review before a decision. */
  reviewTimerRequired: boolean;
  /** Show the mandatory Start Review / View Only / Go Back prompt. */
  needsReviewStart: boolean;
  /** Why Approve / Send Back are unavailable while the ticket is otherwise ready. */
  decisionBlockedReason: string | null;
  /** Why controls are unavailable right now, if they are. */
  disabledReason: string | null;
}

export const REVIEW_STATE_UNVERIFIED = 'Unable to load this ticket. Refresh and try again.';
export const REVIEW_STATE_LOADING = 'Loading…';
export const REVIEW_START_REQUIRED = 'Start Review to approve or send this ticket back.';

export function reviewControls(
  ticket: any,
  viewerId: string | null | undefined,
  query: { isLoading: boolean; isError: boolean },
): ReviewControls {
  const inReview = ticket?.status === 'REVIEW';
  const isReviewer = inReview && ticket?.viewerCanApprove === true;
  const reviewRunning = ticket?.timers?.activeClock === 'REVIEWER_WORK';
  const reviewRunningForViewer =
    reviewRunning && !!viewerId && ticket?.timers?.active?.userId === viewerId && ticket?.timers?.active?.ownerType === 'REVIEWER';
  const isAssignee = !!viewerId && ticket?.assignedToId === viewerId;

  const disabledReason = query.isError ? REVIEW_STATE_UNVERIFIED : query.isLoading || !ticket ? REVIEW_STATE_LOADING : null;
  const ready = disabledReason === null;
  // Absent means an older backend: treat as required, the safe direction.
  const reviewTimerRequired = ticket?.reviewTimerRequired !== false;
  const decisionNeedsStart = isReviewer && reviewTimerRequired && !reviewRunningForViewer;

  return {
    inReview,
    isReviewer,
    reviewRunningForViewer,
    reviewRunning,
    canStartReview: ready && isReviewer && !reviewRunningForViewer,
    canPauseReview: ready && isReviewer && reviewRunningForViewer,
    canDecide: ready && isReviewer && !decisionNeedsStart,
    canWithdraw: ready && inReview && isAssignee,
    reviewTimerRequired,
    needsReviewStart: ready && decisionNeedsStart,
    decisionBlockedReason: ready && decisionNeedsStart ? REVIEW_START_REQUIRED : null,
    disabledReason,
  };
}

/** User-facing label for a review cycle's decision. */
export function reviewDecisionLabel(decision: string | null | undefined): string {
  switch (decision) {
    case 'APPROVED': return 'Approved';
    case 'REWORK': return 'Rework requested';
    case 'WITHDRAWN': return 'Withdrawn by assignee';
    case 'CANCELLED': return 'Review cancelled';
    default: return 'In review';
  }
}

/** Formats seconds as "Hh Mm" for the timing strip. */
export function formatHoursMinutes(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.floor(seconds ?? 0));
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
