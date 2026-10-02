/**
 * The reviewer's workspace around a ticket in REVIEW, derived only from the
 * backend: the review-start prompt, evidence-first attachments, and the
 * labels for ownership and locking.
 *
 * - The running clock comes from GET /tickets/active-timer (the ledger),
 *   never from page state. Opening a page changes no timer.
 * - Which review cycle is "current" comes from ticket.currentReviewCycle.
 * - Whether an attachment can be deleted comes from attachment.canDelete,
 *   never from role, participation or ticket ownership.
 */

/** Shared by the ticket page and the app-wide review banner. */
export const ACTIVE_TIMER_QUERY_KEY = ['active-timer'] as const;

export interface ActiveTimerTicket {
  id: string;
  ticketId: string;
  title?: string | null;
  status?: string | null;
}

export interface ActiveTimer {
  activeClock: 'EMPLOYEE_WORK' | 'REVIEWER_WORK' | 'NONE';
  active: null | {
    ownerType: 'ASSIGNEE' | 'REVIEWER' | string;
    startedAt: string;
    elapsedSeconds: number;
    ticket: ActiveTimerTicket | null;
  };
}

export interface ReviewStartPrompt {
  title: string;
  /** Null when nothing else is running. */
  message: string | null;
  startLabel: string;
  /** False while another review runs: the backend would refuse (OTHER_REVIEW_ACTIVE). */
  canStart: boolean;
}

/** The mandatory prompt shown before a reviewer may decide. Opening it changes nothing. */
export function reviewStartPrompt(ticket: { id: string; ticketId: string }, timer: ActiveTimer | null | undefined): ReviewStartPrompt {
  const title = `Start reviewing ${ticket.ticketId}?`;
  const running = timer?.active?.ticket;
  if (timer?.activeClock === 'EMPLOYEE_WORK' && running && running.id !== ticket.id) {
    return {
      title,
      message: `Starting this review will pause ${running.ticketId}. It will resume when you pause or finish this review.`,
      startLabel: `Start Review & Pause ${running.ticketId}`,
      canStart: true,
    };
  }
  if (timer?.activeClock === 'REVIEWER_WORK' && running && running.id !== ticket.id) {
    return {
      title,
      message: `You are already reviewing ${running.ticketId}. Pause that review before starting this one.`,
      startLabel: 'Start Review',
      canStart: false,
    };
  }
  return { title, message: null, startLabel: 'Start Review', canStart: true };
}

/** "1h 05m 09s" style elapsed time for the review banner. */
export function formatElapsed(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.floor(seconds ?? 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}h ${pad(m)}m ${pad(sec)}s` : `${m}m ${pad(sec)}s`;
}

// ── Attachments ──────────────────────────────────────────────────────────────

export type AttachmentPurpose = 'REFERENCE' | 'GENERAL' | 'POC' | 'REVIEW_FEEDBACK';

export interface TicketAttachment {
  id: string;
  filename: string;
  mimeType?: string | null;
  size?: number | null;
  createdAt: string;
  purpose?: AttachmentPurpose | null;
  isPoc?: boolean;
  reviewCycleId?: string | null;
  cycleNo?: number | null;
  locked?: boolean;
  lockReason?: string | null;
  legacyProtected?: boolean;
  canDelete?: boolean;
  uploadedBy?: { id: string; name: string } | null;
}

export function attachmentPurpose(att: TicketAttachment): AttachmentPurpose {
  return (att.purpose ?? (att.isPoc ? 'POC' : 'GENERAL')) as AttachmentPurpose;
}

export interface EvidenceCycleGroup {
  cycleNo: number | null;
  items: TicketAttachment[];
}

export interface GroupedAttachments {
  /** Proof of completion for the review cycle under review now, newest first. */
  currentProof: TicketAttachment[];
  /** Reviewer feedback files for the current cycle, newest first. */
  currentFeedback: TicketAttachment[];
  /** Earlier cycles' evidence, oldest cycle first, each cycle's files in upload order. */
  previous: EvidenceCycleGroup[];
  /** Proof uploaded but not yet submitted for review (unlocked, no cycle). */
  pendingProof: TicketAttachment[];
  /** Reference and general files. */
  other: TicketAttachment[];
}

const newestFirst = (a: TicketAttachment, b: TicketAttachment) =>
  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
const oldestFirst = (a: TicketAttachment, b: TicketAttachment) => -newestFirst(a, b);

/**
 * Splits a ticket's attachments into current evidence, previous evidence and
 * everything else. Evidence of an earlier cycle is never shown as current:
 * only files bound to `currentCycleId` are.
 */
export function groupAttachments(attachments: TicketAttachment[] | null | undefined, currentCycleId: string | null | undefined): GroupedAttachments {
  const out: GroupedAttachments = { currentProof: [], currentFeedback: [], previous: [], pendingProof: [], other: [] };
  const byCycle = new Map<string, EvidenceCycleGroup>();
  for (const att of attachments ?? []) {
    const purpose = attachmentPurpose(att);
    const evidence = purpose === 'POC' || purpose === 'REVIEW_FEEDBACK';
    if (evidence && currentCycleId && att.reviewCycleId === currentCycleId) {
      (purpose === 'POC' ? out.currentProof : out.currentFeedback).push(att);
    } else if (evidence && att.reviewCycleId) {
      const group = byCycle.get(att.reviewCycleId) ?? { cycleNo: att.cycleNo ?? null, items: [] };
      group.items.push(att);
      byCycle.set(att.reviewCycleId, group);
    } else if (purpose === 'POC' && !att.locked && !att.legacyProtected) {
      out.pendingProof.push(att);
    } else if (evidence) {
      // Legacy proof whose cycle was never recorded: earlier evidence of unknown cycle.
      const group = byCycle.get('legacy') ?? { cycleNo: null, items: [] };
      group.items.push(att);
      byCycle.set('legacy', group);
    } else {
      out.other.push(att);
    }
  }
  out.currentProof.sort(newestFirst);
  out.currentFeedback.sort(newestFirst);
  out.pendingProof.sort(newestFirst);
  out.other.sort(newestFirst);
  out.previous = Array.from(byCycle.values())
    .map((g) => ({ ...g, items: [...g.items].sort(oldestFirst) }))
    .sort((a, b) => (a.cycleNo ?? 0) - (b.cycleNo ?? 0));
  return out;
}

/** Evidence-first: a ticket in review whose current cycle has proof opens on Attachments. */
export function shouldOpenEvidenceFirst(ticket: { status?: string; currentReviewCycle?: { id: string } | null; attachments?: TicketAttachment[] } | null | undefined): boolean {
  if (ticket?.status !== 'REVIEW' || !ticket.currentReviewCycle) return false;
  return groupAttachments(ticket.attachments, ticket.currentReviewCycle.id).currentProof.length > 0;
}

export type PreviewKind = 'image' | 'pdf' | 'none';

/** Inline preview only for images and PDFs; everything else is View / Download. */
export function previewKind(att: Pick<TicketAttachment, 'mimeType' | 'filename'>): PreviewKind {
  const mime = (att.mimeType ?? '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf' || /\.pdf$/i.test(att.filename ?? '')) return 'pdf';
  return 'none';
}

const LOCK_REASON_LABELS: Record<string, string> = {
  SUBMITTED_FOR_REVIEW: 'Locked when submitted for review',
  REVIEW_APPROVED: 'Locked when the review was approved',
  REVIEW_REWORK: 'Locked when sent back for rework',
  REVIEW_WITHDRAWN: 'Locked when the submission was withdrawn',
  REVIEW_CANCELLED: 'Locked when the review was cancelled',
};

/** Why an attachment cannot be deleted, if it is protected. */
export function attachmentProtectionLabel(att: TicketAttachment): string | null {
  if (att.locked) return LOCK_REASON_LABELS[att.lockReason ?? ''] ?? 'Locked review evidence';
  if (att.legacyProtected) return 'Uploaded before uploaders were recorded; protected';
  return null;
}

export function attachmentPurposeLabel(att: TicketAttachment): string | null {
  switch (attachmentPurpose(att)) {
    case 'POC': return 'Proof of completion';
    case 'REVIEW_FEEDBACK': return 'Review feedback';
    case 'REFERENCE': return 'Reference';
    default: return null;
  }
}

/**
 * The purpose a new upload is sent with. The backend re-checks it and always
 * records the authenticated uploader as the owner.
 */
export function uploadPurposeFor(
  ticket: { status?: string; viewerCanApprove?: boolean; assignedToId?: string | null; assignees?: Array<{ userId?: string; user?: { id: string } }> } | null | undefined,
  viewerId: string | null | undefined,
): AttachmentPurpose {
  if (!ticket || !viewerId) return 'GENERAL';
  if (ticket.status === 'REVIEW' && ticket.viewerCanApprove === true) return 'REVIEW_FEEDBACK';
  const isWorker = ticket.assignedToId === viewerId ||
    Boolean(ticket.assignees?.some((a) => (a.userId ?? a.user?.id) === viewerId));
  return isWorker ? 'GENERAL' : 'REFERENCE';
}

/** Neutral, never alarming: a review cycle without proof is allowed. */
export const NO_CURRENT_PROOF_MESSAGE = 'No proof of completion was attached for this review cycle.';
export const SUBMIT_PROOF_PROMPT = 'Add proof of completion if this ticket has supporting evidence.';
