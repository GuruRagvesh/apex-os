'use client';

import { useState, useRef, useMemo, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { commentsApi, aiApi, workdayApi } from '@/lib/api';
import { usersApi } from '@apex/core-users/api';
import { ticketsApi } from '@apex/operations-tickets-lifecycle/api';
import { useAuthStore } from '@apex/core-identity';
import { PRIORITY_COLORS, PRIORITY_LABELS } from '@apex/shared-configuration';
import { STATUS_COLORS, STATUS_LABELS, formatRole } from '@apex/operations-tickets-lifecycle/shared/ticket-vocabulary';
import { cn, formatDate, getInitials, formatRelativeTime } from '@apex/shared-utilities';
import { getTicketVisibility, PRIORITY_DOT } from '@apex/operations-tickets-lifecycle';
import { computeClientTimingState, computeWorkBudget, dueCountdownText, pauseLabel } from '@apex/operations-tickets-sla';
import { SkeletonTicketDetail } from '@apex/shared-ui/components/skeleton';
import { reviewControls, reviewDecisionLabel, formatHoursMinutes } from '@apex/operations-tickets-lifecycle/shared/review-controls';
import {
  ACTIVE_TIMER_QUERY_KEY, NO_CURRENT_PROOF_MESSAGE, SUBMIT_PROOF_PROMPT,
  attachmentProtectionLabel, attachmentPurposeLabel, groupAttachments, previewKind,
  reviewStartPrompt, shouldOpenEvidenceFirst, uploadPurposeFor,
  type ReviewStartPrompt, type TicketAttachment,
} from '@apex/operations-tickets-lifecycle/shared/review-workspace';
import { useActiveTimer } from '@apex/operations-tickets-lifecycle/components/active-review-banner';
import { WORKDAY_TODAY_QUERY_KEY } from '@apex/operations-tickets-lifecycle/shared/ticket-creation-gate';
import { useSocket } from '@/hooks/useSocket';
import { LinkifiedText } from '@apex/operations-tickets-lifecycle/components/linkified-text';
import { buildTicketEditPayload } from '@apex/operations-tickets-lifecycle/shared/ticket-edit-payload';
import toast from 'react-hot-toast';
import { useTicketBackOrigin } from '@apex/operations-tickets-lifecycle/components/use-ticket-nav-state';
import {
  ArrowLeft, Send, Trash2, Clock, Calendar, User, Building2, Tag,
  Copy, CheckCircle, XCircle, History, Paperclip, Upload,
  FileText, AlertTriangle, Sparkles, ChevronDown, ChevronUp, ChevronRight, Loader2,
  Lightbulb, UserCheck, Hourglass, Download, Eye, Users, Edit2, Ban, Unlock, Star, UserMinus, Lock,
} from 'lucide-react';
import Link from 'next/link';

const STATUSES = ['OPEN', 'IN_PROGRESS', 'REVIEW', 'DONE', 'CLOSED'];

const RECURRENCE_LABELS: Record<string, string> = {
  daily_morning: 'Every day — Morning (9 AM)',
  daily_evening: 'Every day — Evening (6 PM)',
  weekly: 'Every week',
  monthly: 'Every month',
  '1_month': 'Daily for 1 month',
  '6_months': 'Daily for 6 months',
};

// ─── Work timer status (display only) ─────────────────────────────────────────
// "Running" comes only from the backend ledger (timers.activeClock), never from
// ticket.status: an IN_PROGRESS ticket is paused while its assignee is on break,
// has ended the day, has punched out or is timing another ticket.
function workTimerStatus(ticket: any): { label: string; cls: string } {
  const paused = { label: 'Paused', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' };
  if (ticket?.isBlocked) return { ...paused, label: 'Paused (blocked)' };
  switch (ticket?.status) {
    case 'IN_PROGRESS':
      // A paused label always says why (the assignee's break, punch out, another ticket).
      return ticket?.timers?.activeClock === 'EMPLOYEE_WORK'
        ? { label: 'Running', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' }
        : { ...paused, label: pauseLabel(ticket) ?? 'Paused' };
    // Under review only while a reviewer's clock actually runs (ledger), never from status alone.
    case 'REVIEW':      return ticket?.timers?.activeClock === 'REVIEWER_WORK'
        ? { label: 'Under review', cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' }
        : { label: 'Waiting for review', cls: 'bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300' };
    case 'DONE':        return { label: 'Completed', cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' };
    // CLOSED is a cancellation or administrative close, not a completion.
    case 'CLOSED':      return { label: 'Closed', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' };
    case 'OPEN':
    default:            return { label: 'Not started', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' };
  }
}

// ─── Header timing summary — a short, correctly-labeled status only ───────────
// Just the work-timer status (the full Due Date / Due Time / Time Left lives once
// in the sidebar Timing panel). Overdue urgency is already shown by the header's
// own OVERDUE badge, so we never repeat a countdown or the misleading "Due date: 2h".
function TimingHeaderSummary({ ticket }: { ticket: any }) {
  const wt = workTimerStatus(ticket);
  return (
    <div className="mt-1">
      <span className={cn('text-xs px-2 py-0.5 rounded font-medium', wt.cls)}>Work timer: {wt.label}</span>
    </div>
  );
}

// ─── One clean Timing section — Due Date / Due Time / Time Left ──────────────
// The work-timer status is shown once, in the header (TimingHeaderSummary).
function TicketTimingPanel({ ticket }: { ticket: any }) {
  const t = computeClientTimingState(ticket);
  const budget = computeWorkBudget(ticket);
  const due = ticket?.dueDate ? new Date(ticket.dueDate) : null;
  const rowLabel = { color: 'var(--text-tertiary)' };
  const rowValue = { color: 'var(--text-primary)' };
  return (
    <div className="space-y-2">
      {due && (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs" style={rowLabel}>Due Date</span>
            <span className="text-sm font-medium" style={rowValue}>{formatDate(due)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs" style={rowLabel}>Due Time</span>
            <span className="text-sm font-medium" style={rowValue}>
              {due.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </>
      )}
      {budget ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs" style={rowLabel}>Time Left</span>
          <span className={cn('text-sm font-medium', budget.over ? 'text-red-500' : '')} style={!budget.over ? rowValue : undefined}>
            {budget.label}
          </span>
        </div>
      ) : (
        // No work budget. "Time Left" only ever means estimate minus work time (it
        // pauses on breaks), so an OPEN / IN_PROGRESS ticket without an estimate says
        // so, and the deadline clock gets its own "Due in" row.
        <>
          {['OPEN', 'IN_PROGRESS'].includes(ticket?.status) && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs" style={rowLabel}>Time Left</span>
              <span className="text-sm font-medium" style={rowLabel}>No estimate</span>
            </div>
          )}
          {dueCountdownText(t) && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs" style={rowLabel}>{t.isOverdue ? 'Overdue' : 'Due in'}</span>
              <span className={cn('text-sm font-medium', t.isOverdue ? 'text-red-500' : '')} style={!t.isOverdue ? rowValue : undefined}>
                {t.isOverdue ? t.countdownLabel : dueCountdownText(t)!.replace(/^Due in /, '')}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Copyable Ticket ID ───────────────────────────────────────────────────────
function CopyableId({ ticketId }: { ticketId: string }) {
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(ticketId).then(() =>
          toast.success(`Copied ${ticketId}`, { duration: 2000 }),
        );
      }}
      className="group flex items-center gap-1 font-mono text-sm font-medium transition-colors"
      style={{ color: 'var(--text-tertiary)' }}
      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-tertiary)')}
      title="Click to copy"
    >
      {ticketId}
      <Copy size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
}

// ─── History helpers ──────────────────────────────────────────────────────────
const FIELD_LABELS: Record<string, string> = {
  status: 'status',
  assignedToId: 'assignee',
  priority: 'priority',
  title: 'title',
};

const STATUS_DISPLAY: Record<string, string> = {
  OPEN: 'Open', IN_PROGRESS: 'In Progress', REVIEW: 'Under Review', DONE: 'Done', CLOSED: 'Closed',
};

// ─── Request type (TASK / QUERY / HELP) display helpers ───────────────────────
// A HELP/QUERY ticket is a cross-department request, not ordinary assigned work —
// the header badge, Details card, and assignee label all need to say so plainly
// instead of quietly looking like a normal TASK.
const REQUEST_TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  TASK: {
    label: 'TASK',
    cls: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600',
  },
  QUERY: {
    label: 'QUERY',
    cls: 'bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-700',
  },
  HELP: {
    label: 'HELP REQUEST',
    cls: 'bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700',
  },
};
function requestTypeBadge(type: string) {
  return REQUEST_TYPE_BADGE[type] ?? REQUEST_TYPE_BADGE.TASK;
}

const REQUEST_TYPE_DISPLAY: Record<string, string> = { TASK: 'Task', QUERY: 'Query', HELP: 'Help' };

function assigneeLabelFor(type: string): string {
  if (type === 'QUERY') return 'Routed To';
  if (type === 'HELP') return 'Help From';
  return 'Assigned To';
}

function humanValue(field: string, value: string | null) {
  if (!value) return 'none';
  if (field === 'status') return STATUS_DISPLAY[value] ?? value;
  return value;
}

// ─── Attachment card ──────────────────────────────────────────────────────────
// Capabilities come from the backend: canDelete is true only for the uploader
// of an attachment that is not locked evidence. Nothing here derives it from a
// role, from being a participant, or from owning the ticket.
function AttachmentCard({ att, ticketId, onDelete, highlight, inlinePreview }: {
  att: TicketAttachment & Record<string, any>;
  ticketId: string;
  onDelete?: (id: string) => void;
  /** The latest proof of the current review cycle. */
  highlight?: boolean;
  /** Show the image or PDF itself under the card (never a download). */
  inlinePreview?: boolean;
}) {
  const kind = previewKind(att);
  const isImage = kind === 'image';
  const isPdf = kind === 'pdf';
  const isDoc = att.mimeType?.includes('word') || att.filename?.endsWith('.doc') || att.filename?.endsWith('.docx');
  const sizeKb = att.size ? Math.round(att.size / 1024) : null;
  const purposeLabel = attachmentPurposeLabel(att);
  const protection = attachmentProtectionLabel(att);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  // Images always get a thumbnail; a PDF is fetched only when shown inline.
  const wantsPreview = isImage || (isPdf && Boolean(inlinePreview));

  useEffect(() => {
    if (!wantsPreview) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    setLoadingPreview(true);
    ticketsApi.fetchAttachmentBlob(ticketId, att.id, 'inline')
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      })
      .catch(() => setPreviewUrl(null))
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [att.id, wantsPreview, ticketId]);

  const openBlob = async (mode: 'inline' | 'download') => {
    try {
      const blob = await ticketsApi.fetchAttachmentBlob(ticketId, att.id, mode);
      const url = URL.createObjectURL(blob);
      if (mode === 'download') {
        const a = document.createElement('a');
        a.href = url;
        a.download = att.filename;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Attachment could not be loaded');
    }
  };

  const handleView = () => openBlob('inline');
  const handleDownload = () => openBlob('download');

  return (
    <div
      className="rounded-lg border transition-colors"
      style={{
        borderColor: highlight ? '#a855f7' : 'var(--border-primary)',
        boxShadow: highlight ? '0 0 0 1px #a855f7' : undefined,
      }}
    >
      <div className="flex items-start gap-2 p-2.5">
        {/* Thumbnail / Icon */}
        <div
          className="w-10 h-10 rounded overflow-hidden flex-shrink-0 flex items-center justify-center"
          style={{ backgroundColor: 'var(--bg-tertiary)' }}
        >
          {isImage && previewUrl ? (
            <img src={previewUrl} alt={att.filename} className="w-full h-full object-cover" />
          ) : wantsPreview && loadingPreview ? (
            <Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} />
          ) : isPdf ? (
            <FileText size={18} className="text-red-400" />
          ) : isDoc ? (
            <FileText size={18} className="text-blue-400" />
          ) : (
            <FileText size={18} style={{ color: 'var(--text-tertiary)' }} />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-xs font-medium truncate max-w-[180px]" style={{ color: 'var(--text-secondary)' }} title={att.filename}>{att.filename}</p>
            {purposeLabel && (
              <span className={cn(
                'inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded',
                att.purpose === 'POC' || att.isPoc ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-700',
              )}>
                {purposeLabel}
              </span>
            )}
            {highlight && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-600 text-white">Latest</span>
            )}
            {att.cycleNo ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }}>
                Cycle {att.cycleNo}
              </span>
            ) : null}
            {protection && (
              <span className="inline-flex items-center gap-0.5 text-[10px]" style={{ color: 'var(--text-tertiary)' }} title={protection}>
                {/* The reason is read once, from the visible line below. */}
                <Lock size={10} aria-hidden="true" />
              </span>
            )}
          </div>
          <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            {sizeKb ? `${sizeKb} KB · ` : ''}
            {att.createdAt ? new Date(att.createdAt).toLocaleDateString() : ''}
            {att.uploadedBy?.name ? ` · by ${att.uploadedBy.name}` : att.legacyProtected ? ' · uploader not recorded' : ''}
          </p>
          {protection && (
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{protection}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={handleView}
            title="View"
            aria-label={`View ${att.filename}`}
            className="p-1 rounded transition-colors"
            style={{ color: 'var(--text-tertiary)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
          >
            <Eye size={13} />
          </button>
          <button
            onClick={handleDownload}
            title="Download"
            aria-label={`Download ${att.filename}`}
            className="p-1 rounded transition-colors"
            style={{ color: 'var(--text-tertiary)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
          >
            <Download size={13} />
          </button>
          {att.canDelete === true && onDelete && (
            <button
              onClick={() => {
                if (confirm('Delete this attachment?')) {
                  onDelete(att.id);
                }
              }}
              title="Delete"
              aria-label={`Delete ${att.filename}`}
              className="p-1 rounded transition-colors text-red-400 hover:text-red-500 hover:bg-red-50/10"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Inline preview: images and PDFs only; other formats use View / Download. */}
      {inlinePreview && previewUrl && isImage && (
        <div className="px-2.5 pb-2.5">
          <img src={previewUrl} alt={att.filename} className="w-full max-h-96 object-contain rounded" style={{ backgroundColor: 'var(--bg-tertiary)' }} />
        </div>
      )}
      {inlinePreview && previewUrl && isPdf && (
        <div className="px-2.5 pb-2.5">
          <iframe src={previewUrl} title={`Preview of ${att.filename}`} className="w-full h-96 rounded border" style={{ borderColor: 'var(--border-primary)' }} />
        </div>
      )}
    </div>
  );
}

// ─── AI Suggestions panel ────────────────────────────────────────────────────
function AiSuggestionsPanel({ ticketId }: { ticketId: string }) {
  const [open, setOpen] = useState(false);
  const [fetched, setFetched] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['ai-suggestions', ticketId],
    queryFn: () => aiApi.ticketSuggestions(ticketId) as Promise<{
      nextAction?: string;
      suggestedAssignee?: string;
      estimatedTime?: string;
      result?: string;
      disabled?: boolean;
    }>,
    enabled: false, // only fetch on demand
    staleTime: 10 * 60 * 1000,
  });
  const aiDisabled = data?.disabled === true;

  const handleToggle = () => {
    if (!open && !fetched) {
      refetch();
      setFetched(true);
    }
    setOpen((v) => !v);
  };

  const rows = [
    { icon: <Lightbulb size={14} className="text-amber-500" />, label: 'Next Action', value: data?.nextAction },
    { icon: <UserCheck size={14} className="text-indigo-500" />, label: 'Suggested Assignee', value: data?.suggestedAssignee },
    { icon: <Hourglass size={14} className="text-emerald-500" />, label: 'Estimated Time', value: data?.estimatedTime },
  ];

  return (
    <div className="apex-card overflow-hidden">
      {/* Header — always visible */}
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between px-4 py-3 transition-colors"
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
      >
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg,#1e40af,#4f46e5)' }}>
            <Sparkles size={12} className="text-white" />
          </div>
          <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>AI Suggestions</span>
          <span
            className="text-[10px] font-medium px-1.5 py-0.5 rounded"
            style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent)' }}
          >
            GPT-4o mini
          </span>
        </div>
        {open
          ? <ChevronUp size={15} style={{ color: 'var(--text-tertiary)' }} />
          : <ChevronDown size={15} style={{ color: 'var(--text-tertiary)' }} />}
      </button>

      {/* Collapsible body */}
      {open && (
        <div className="px-4 pb-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          {isLoading && (
            <div className="flex items-center gap-2 py-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <Loader2 size={16} className="animate-spin text-indigo-400" />
              Analysing ticket with AI…
            </div>
          )}
          {error && !aiDisabled && (
            <p className="py-3 text-xs text-red-500">
              Failed to load suggestions. Please try again later.
            </p>
          )}
          {aiDisabled && (
            <div className="flex flex-col items-center justify-center py-6 gap-2 text-center">
              <Sparkles size={20} style={{ color: 'var(--text-tertiary)' }} />
              <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>AI suggestions coming soon</p>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Smart next-action, assignee and time-estimate suggestions will appear here.</p>
            </div>
          )}
          {data && !aiDisabled && (
            <div className="pt-3 space-y-3">
              {rows.map((row) => (
                <div key={row.label} className="flex items-start gap-2.5">
                  <div className="mt-0.5 flex-shrink-0">{row.icon}</div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{row.label}</p>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>{row.value}</p>
                  </div>
                </div>
              ))}
              <button
                onClick={() => { setFetched(false); refetch(); }}
                className="text-xs text-indigo-500 hover:text-indigo-700 mt-1"
              >
                ↺ Refresh suggestions
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Review-start gate ────────────────────────────────────────────────────────
// Shown to an authorized reviewer who is not timing this review. Opening the
// page changed no timer; only Start Review does, through the backend, which
// pauses the reviewer's running ticket and starts the review together.
function ReviewStartGate({ prompt, starting, onStart, onViewOnly, onGoBack }: {
  prompt: ReviewStartPrompt;
  starting: boolean;
  onStart: () => void;
  onViewOnly: () => void;
  onGoBack: () => void;
}) {
  const firstRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { firstRef.current?.focus(); }, []);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onKeyDown={(e) => { if (e.key === 'Escape') onViewOnly(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-gate-title"
        aria-describedby="review-gate-message"
        className="apex-card rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4"
      >
        <h3 id="review-gate-title" className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>{prompt.title}</h3>
        <div id="review-gate-message" className="space-y-2">
          {prompt.message && <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{prompt.message}</p>}
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            View Only lets you read the ticket and its attachments. Approve and Send Back need a started review.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <button
            ref={prompt.canStart ? firstRef : undefined}
            type="button"
            onClick={onStart}
            disabled={!prompt.canStart || starting}
            aria-busy={starting}
            className="w-full py-2.5 text-sm font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-lg disabled:opacity-40"
          >
            {starting ? 'Starting…' : prompt.startLabel}
          </button>
          <button
            ref={prompt.canStart ? undefined : firstRef}
            type="button"
            onClick={onViewOnly}
            className="w-full py-2.5 text-sm rounded-lg border"
            style={{ color: 'var(--text-primary)', borderColor: 'var(--border-primary)' }}
          >
            View Only
          </button>
          <button
            type="button"
            onClick={onGoBack}
            className="w-full py-2.5 text-sm rounded-lg"
            style={{ color: 'var(--text-secondary)' }}
          >
            Go Back
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── POC Upload Modal ─────────────────────────────────────────────────────────
function PocUploadModal({
  ticketId,
  onUploadAndSubmit,
  onSkip,
  onClose,
  isUploading,
}: {
  ticketId: string;
  onUploadAndSubmit: (file: File) => void;
  onSkip: () => void;
  onClose: () => void;
  isUploading: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    if (file.size > 5 * 1024 * 1024) { toast.error('File must be under 5 MB'); return; }
    setSelectedFile(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="apex-card rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'var(--accent-subtle)' }}
          >
            <Paperclip size={18} style={{ color: 'var(--accent)' }} />
          </div>
          <div>
            <h3 className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>Submit for review</h3>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {SUBMIT_PROOF_PROMPT}
            </p>
          </div>
        </div>

        {/* Drop zone */}
        <div
          className={cn(
            'border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors',
            dragOver ? 'border-purple-400' : 'hover:border-purple-300',
          )}
          style={{
            borderColor: dragOver ? '#a855f7' : 'var(--border-primary)',
            backgroundColor: dragOver ? 'var(--accent-subtle)' : 'transparent',
          }}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) handleFile(file);
          }}
        >
          {selectedFile ? (
            <div className="flex items-center justify-center gap-2">
              <FileText size={18} className="text-purple-500" />
              <span className="text-sm font-medium truncate max-w-[200px]" style={{ color: 'var(--text-secondary)' }}>
                {selectedFile.name}
              </span>
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>({Math.round(selectedFile.size / 1024)} KB)</span>
            </div>
          ) : (
            <>
              <Upload size={24} className="mx-auto mb-2" style={{ color: 'var(--text-tertiary)' }} />
              <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Drop files here or click to upload</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>Optional · images, PDF, Word, Excel, CSV, text or ZIP (max 5 MB)</p>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onSkip}
            disabled={isUploading}
            title="Submit for review without an attachment"
            className="flex-1 py-2.5 text-sm rounded-lg border transition-colors disabled:opacity-50"
            style={{
              color: 'var(--text-secondary)',
              borderColor: 'var(--border-primary)',
              backgroundColor: 'var(--surface-card)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--surface-card)')}
          >
            Skip for now
          </button>
          <button
            onClick={() => selectedFile && onUploadAndSubmit(selectedFile)}
            disabled={!selectedFile || isUploading}
            className="flex-1 py-2.5 text-sm font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {isUploading ? (
              <><Loader2 size={14} className="animate-spin" /> Uploading…</>
            ) : (
              <><Upload size={14} /> Upload & Submit</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
type Tab = 'comments' | 'history' | 'attachments' | 'reviews';

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromContext = searchParams.get('from');
  const fromProjectId = searchParams.get('projectId');
  const fromProjectName = searchParams.get('projectName')
    ? decodeURIComponent(searchParams.get('projectName')!)
    : null;
  const { user } = useAuthStore();
  const qc = useQueryClient();

  const [comment, setComment] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('comments');
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectComment, setRejectComment] = useState('');
  // Optional estimate for the rework cycle, in hours (sent as minutes).
  const [reworkEstimateHours, setReworkEstimateHours] = useState('');
  const [taskEfficiencyRating, setTaskEfficiencyRating] = useState(0);
  const [employeePerformanceRating, setEmployeePerformanceRating] = useState(0);
  const [employeeAttitudeRating, setEmployeeAttitudeRating] = useState(0);
  const [ratingComment, setRatingComment] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  // POC upload modal state
  const [showPocModal, setShowPocModal] = useState(false);
  const [pocUploading, setPocUploading] = useState(false);
  // The reviewer chose View Only on the review-start prompt (no timer started).
  const [viewOnly, setViewOnly] = useState(false);
  useEffect(() => { setViewOnly(false); }, [id]);
  // Edit modal state
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  // Block modal state
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [blockReason, setBlockReason] = useState('');

  const { data: ticket, isLoading, isError: ticketLoadFailed } = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => ticketsApi.getOne(id) as Promise<any>,
    // The work timer is paused/resumed by the assignee's own workday (break, end
    // day, punch), which no mutation on this page sees. Poll so the ledger-backed
    // timer state stays current.
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  // The viewer's running clock, from the ledger: names the ticket a review start would pause.
  const { data: activeTimer, isSuccess: activeTimerKnown, isError: activeTimerFailed } = useActiveTimer();
  // The shared workday answer: a review cannot start while the person's day
  // is IDLE (only sessions from before idle detection was retired can be).
  const { data: workdayToday } = useQuery({
    queryKey: WORKDAY_TODAY_QUERY_KEY,
    queryFn: () => workdayApi.getToday() as Promise<any>,
    staleTime: 15_000,
  });
  const workdayIdle = (workdayToday as any)?.session?.status === 'IDLE';

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.getAll() as Promise<any[]>,
  });

  // QUERY/HELP tickets carry a targetDepartmentId (raw column, always returned) but
  // findOne() doesn't include the targetDepartment relation, so the name isn't on
  // the ticket response — resolve it frontend-only via the existing, unmodified
  // routing-departments endpoint instead of touching the backend include list.
  const { data: targetDepartments } = useQuery({
    queryKey: ['ticket-target-departments', ticket?.type],
    queryFn: () => ticketsApi.getRoutingDepartments(ticket.type as 'QUERY' | 'HELP') as Promise<any[]>,
    enabled: Boolean(ticket && ticket.type !== 'TASK' && ticket.targetDepartmentId),
  });
  const targetDepartmentName = Array.isArray(targetDepartments)
    ? targetDepartments.find((d: any) => d.id === ticket?.targetDepartmentId)?.name
    : undefined;

  const { data: history } = useQuery({
    queryKey: ['ticket-history', id],
    queryFn: () => ticketsApi.getHistory(id) as Promise<any[]>,
    enabled: activeTab === 'history',
  });

  const resolveUserName = (userIdOrName: string | null) => {
    if (!userIdOrName) return 'none';
    const uList = Array.isArray(users) ? users : (users as any)?.users ?? [];
    const found = uList.find((u: any) => u.id === userIdOrName);
    return found ? found.name : userIdOrName;
  };

  const formatHistoryItem = (h: any) => {
    const actor = h.changedBy?.name || 'Someone';
    const field = h.field;
    const oldVal = h.oldValue;
    const newVal = h.newValue;

    if (field === 'status') {
      return (
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          <span className="font-semibold text-slate-800 dark:text-gray-200">{actor}</span>
          {' moved ticket to '}
          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{STATUS_DISPLAY[newVal] || newVal}</span>
        </span>
      );
    }
    if (field === 'assignedToId') {
      const oldName = resolveUserName(oldVal);
      const newName = resolveUserName(newVal);
      return (
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          <span className="font-semibold text-slate-800 dark:text-gray-200">{actor}</span>
          {newVal ? (
            <>
              {' reassigned the ticket to '}
              <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{newName}</span>
            </>
          ) : (
            ' unassigned the ticket'
          )}
        </span>
      );
    }
    if (field === 'secondaryAssignee') {
      const name = resolveUserName(newVal ? newVal : oldVal);
      return (
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          <span className="font-semibold text-slate-800 dark:text-gray-200">{actor}</span>
          {newVal ? (
            <>
              {' added '}
              <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{name}</span>
              {' as a collaborator'}
            </>
          ) : (
            <>
              {' removed '}
              <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{name}</span>
              {' from the ticket'}
            </>
          )}
        </span>
      );
    }
    if (field === 'priority') {
      return (
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          <span className="font-semibold text-slate-800 dark:text-gray-200">{actor}</span>
          {' changed priority to '}
          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{newVal}</span>
        </span>
      );
    }
    return (
      <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        <span className="font-semibold text-slate-800 dark:text-gray-200">{actor}</span>
        {' updated '}
        <span className="font-medium">{FIELD_LABELS[field] || field}</span>
        {' from '}
        <span className="line-through" style={{ color: 'var(--text-tertiary)' }}>{humanValue(field, oldVal)}</span>
        {' → '}
        <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{humanValue(field, newVal)}</span>
      </span>
    );
  };

  useSocket({
    onTicketStatusChanged: ({ ticketId: changedId, newStatus }) => {
      if (ticket && changedId === ticket.id) {
        qc.invalidateQueries({ queryKey: ['ticket', id] });
        qc.invalidateQueries({ queryKey: ['ticket-history', id] });
        toast(`Status changed to ${newStatus.replace('_', ' ')}`, { icon: '🔄', duration: 3000 });
      }
    },
  });

  // Everything a ticket change can affect: this ticket and its history, the
  // ticket lists and counts, the approval queues and their reminders, and the
  // viewer's own clock and workday. So the details, the list and Pending
  // Approvals never disagree after an action taken here.
  const refreshTicketViews = () => {
    qc.invalidateQueries({ queryKey: ['ticket', id] });
    qc.invalidateQueries({ queryKey: ['ticket-history', id] });
    qc.invalidateQueries({ queryKey: ['tickets'] });
    qc.invalidateQueries({ queryKey: ['ticket-stats'] });
    qc.invalidateQueries({ queryKey: ['ticket-pending-approvals'] });
    qc.invalidateQueries({ queryKey: ['approval-reminders-pending-approvals'] });
    qc.invalidateQueries({ queryKey: ['approval-reminders-unread-notifications'] });
    qc.invalidateQueries({ queryKey: ACTIVE_TIMER_QUERY_KEY });
    qc.invalidateQueries({ queryKey: WORKDAY_TODAY_QUERY_KEY });
  };

  const updateStatus = useMutation({
    mutationFn: (status: string) => ticketsApi.updateStatus(ticket.id, status),
    onSuccess: (_data, status) => {
      refreshTicketViews();
      toast.success(status === 'CLOSED' ? 'Ticket closed' : 'Status updated');
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to update status'),
  });

  // Intercept REVIEW click to show POC modal
  const handleStatusClick = (status: string) => {
    if (status === 'REVIEW') {
      setShowPocModal(true);
    } else {
      updateStatus.mutate(status);
    }
  };

  // One request: the submission and its optional proof commit together, or
  // nothing is submitted and nothing is attached.
  const submitForReview = async (file: File | null) => {
    setPocUploading(true);
    try {
      await ticketsApi.submitForReview(ticket.id, file);
      refreshTicketViews();
      toast.success(file ? 'Submitted for review with proof of completion' : 'Submitted for review');
      setShowPocModal(false);
    } catch (e: any) {
      toast.error(e?.message || 'Could not submit for review. Nothing was submitted or attached.');
    } finally {
      setPocUploading(false);
    }
  };

  const handlePocUploadAndSubmit = (file: File) => submitForReview(file);
  const handlePocSkip = () => submitForReview(null);

  const assignMutation = useMutation({
    mutationFn: (assignedToId: string) => ticketsApi.assign(ticket.id, assignedToId),
    onSuccess: () => {
      refreshTicketViews();
      toast.success('Assigned!');
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to assign'),
  });

  const invalidateAfterUnassign = () => {
    refreshTicketViews();
    qc.invalidateQueries({ queryKey: ['dashboard-overview'] });
  };

  const unassignPrimaryMutation = useMutation({
    mutationFn: () => ticketsApi.unassignPrimary(ticket.id),
    onSuccess: () => {
      invalidateAfterUnassign();
      toast.success('Primary assignee unassigned');
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to unassign'),
  });

  const removeAssigneeMutation = useMutation({
    mutationFn: (userId: string) => ticketsApi.removeAssignee(ticket.id, userId),
    onSuccess: () => {
      invalidateAfterUnassign();
      toast.success('Assignee removed');
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to remove assignee'),
  });

  const handleUnassignPrimary = () => {
    if (!window.confirm('Unassign primary assignee? The ticket will be unassigned.' + (ticket.status === 'IN_PROGRESS' ? ' Since this ticket is In Progress, it will be moved back to Open.' : ''))) return;
    unassignPrimaryMutation.mutate();
  };

  const handleRemoveAssignee = (userId: string, name?: string) => {
    if (!window.confirm(`Remove ${name || 'this assignee'} from the ticket?`)) return;
    removeAssigneeMutation.mutate(userId);
  };

  const addComment = useMutation({
    mutationFn: () => commentsApi.create(id, comment),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticket', id] });
      toast.success('Comment added');
      setComment('');
    },
    onError: () => toast.error('Failed to add comment'),
  });

  const deleteTicket = useMutation({
    mutationFn: () => ticketsApi.remove(ticket.id),
    onSuccess: () => { refreshTicketViews(); router.push('/tickets'); toast.success('Ticket deleted'); },
    onError: () => toast.error('Failed to delete ticket'),
  });

  const approveCreationMutation = useMutation({
    mutationFn: () => ticketsApi.approveTicketCreation(ticket.id),
    onSuccess: () => {
      refreshTicketViews();
      toast.success('Task approved and created');
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to approve task'),
  });

  const rejectCreationMutation = useMutation({
    mutationFn: () => ticketsApi.rejectTicketCreation(ticket.id, rejectComment),
    onSuccess: () => {
      refreshTicketViews();
      toast.success('Task creation rejected');
      setRejectMode(false);
      setRejectComment('');
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to reject task'),
  });

  const approveMutation = useMutation({
    // Self-assigned TASK tickets are comment-only — never send star ratings.
    // QUERY creator and HELP requester can submit full ratings.
    mutationFn: () => {
      const ratingsAllowed = !ticket.selfAssigned;
      return ticketsApi.approve(ticket.id, ratingsAllowed
        ? { taskEfficiencyRating, employeePerformanceRating, employeeAttitudeRating, ratingComment }
        : { ratingComment });
    },
    onSuccess: () => {
      refreshTicketViews();
      toast.success('Ticket approved ✓');
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to approve ticket'),
  });

  const rejectMutation = useMutation({
    mutationFn: () => {
      const hours = parseFloat(reworkEstimateHours);
      const minutes = Number.isFinite(hours) && hours > 0 ? Math.round(hours * 60) : null;
      return ticketsApi.reject(ticket.id, rejectComment, minutes);
    },
    onSuccess: () => {
      refreshTicketViews();
      toast.success('Ticket sent back to In Progress');
      setRejectMode(false);
      setRejectComment('');
      setReworkEstimateHours('');
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to reject ticket'),
  });

  // Review clock and withdrawal. After success the ticket, its history, the
  // ticket lists and the workday (the clocks it reports) are all refreshed.
  const refreshAfterReviewAction = refreshTicketViews;
  const startReviewMutation = useMutation({
    mutationFn: () => ticketsApi.startReview(ticket.id),
    onSuccess: () => { refreshAfterReviewAction(); toast.success('Review started'); },
    // The backend's safe message (e.g. "Punch In before starting a review.").
    onError: (e: any) => { refreshAfterReviewAction(); toast.error(e?.message || 'Could not start the review'); },
  });
  const pauseReviewMutation = useMutation({
    mutationFn: () => ticketsApi.pauseReview(ticket.id),
    onSuccess: () => { refreshAfterReviewAction(); toast.success('Review paused'); },
    onError: (e: any) => { refreshAfterReviewAction(); toast.error(e?.message || 'Could not pause the review'); },
  });
  const withdrawMutation = useMutation({
    mutationFn: () => ticketsApi.withdraw(ticket.id),
    onSuccess: () => { refreshAfterReviewAction(); toast.success('Submission withdrawn — the ticket is back In Progress'); },
    onError: (e: any) => { refreshAfterReviewAction(); toast.error(e?.message || 'Could not withdraw the submission'); },
  });

  const editMutation = useMutation({
    mutationFn: (data: any) => ticketsApi.update(ticket.id, data),
    onSuccess: () => {
      refreshTicketViews();
      toast.success('Ticket updated');
      setEditing(false);
    },
    onError: (e: any) => toast.error(e?.message || 'Update failed'),
  });

  const uploadMutation = useMutation({
    // The backend records the viewer as the uploader and re-checks the purpose.
    mutationFn: (file: File) => ticketsApi.uploadAttachment(ticket.id, file, false, uploadPurposeFor(ticket, user?.id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticket', id] });
      toast.success('File uploaded');
      setActiveTab('attachments');
    },
    onError: (e: any) => toast.error(e?.message || 'Upload failed'),
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: (attId: string) => ticketsApi.deleteAttachment(ticket.id, attId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticket', id] });
      toast.success('Attachment deleted');
    },
    // The backend's safe reason (not the uploader, locked evidence, legacy).
    onError: (e: any) => toast.error(e?.message || 'Failed to delete attachment'),
  });

  const blockMutation = useMutation({
    mutationFn: () => ticketsApi.blockTicket(ticket.id, blockReason.trim()),
    onSuccess: () => {
      refreshTicketViews();
      toast.success('Ticket blocked');
      setShowBlockModal(false);
      setBlockReason('');
    },
    // Surface the backend authorization / validation message — never hide it
    onError: (e: any) => toast.error(e?.message || 'Failed to block ticket'),
  });

  const unblockMutation = useMutation({
    mutationFn: () => ticketsApi.unblockTicket(ticket.id),
    onSuccess: () => {
      refreshTicketViews();
      toast.success('Ticket unblocked');
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to unblock ticket'),
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('File must be under 5 MB'); return; }
    uploadMutation.mutate(file);
    e.target.value = '';
  };

  // Evidence first: once the reviewer is in this review (started it, or chose
  // View Only), current-cycle proof opens the Attachments tab. Once per review
  // cycle, so the reviewer can still move between tabs freely.
  const evidenceShownFor = useRef<string | null>(null);
  useEffect(() => {
    if (!ticket || ticket.status !== 'REVIEW' || ticket.viewerCanApprove !== true) return;
    const entered = viewOnly || reviewControls(ticket, user?.id, { isLoading: false, isError: false }).reviewRunningForViewer;
    const key = `${ticket.id}:${ticket.currentReviewCycle?.id ?? ''}`;
    if (!entered || evidenceShownFor.current === key) return;
    evidenceShownFor.current = key;
    if (shouldOpenEvidenceFirst(ticket)) setActiveTab('attachments');
  }, [ticket, viewOnly, user?.id]);

  const breadcrumbs = useMemo(() => {
    if (fromContext === 'project' && fromProjectId && fromProjectName) {
      return [
        { label: 'Projects', href: '/projects' },
        { label: fromProjectName, href: `/projects/${fromProjectId}` },
        { label: ticket?.ticketId || 'Ticket', href: null },
      ];
    }
    return [
      { label: 'Tickets', href: '/tickets' },
      { label: ticket?.ticketId || 'Ticket', href: null },
    ];
  }, [fromContext, fromProjectId, fromProjectName, ticket]);

  // Opened straight from the Tickets list or Kanban: Back is the browser's
  // Back, so that page returns with its filters, view and scroll. Anything
  // else (a direct link, a refresh, a notification) goes to /tickets.
  const backOrigin = useTicketBackOrigin(id, user?.id);
  const handleBack = () => {
    if (fromContext === 'project' && fromProjectId) {
      router.push(`/projects/${fromProjectId}`);
    } else if (backOrigin()) {
      router.back();
    } else {
      router.push('/tickets');
    }
  };

  if (isLoading) return <SkeletonTicketDetail />;
  if (!ticket) return <div className="text-center py-12" style={{ color: 'var(--text-secondary)' }}>This ticket could not be located</div>;

  const vis = getTicketVisibility({
    status: ticket?.status,
    isOverdue: ticket?.isOverdue,
    overdueSeverity: ticket?.overdueSeverity,
  });

  const roleName = (user?.role as any)?.name ?? (user?.role as any) ?? '';
  const isManagerPlus = ['MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(roleName);
  const isParticipant = ticket.createdById === user?.id || ticket.assignedToId === user?.id;
  const canEdit = isManagerPlus || isParticipant;
  const canDelete = isManagerPlus;
  const isTeamLeadPlus = ['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(roleName);
  // Backend is the source of truth: `selfAssigned` and `viewerCanApprove` are computed
  // server-side (hierarchy chain). The frontend only mirrors them — it never decides policy.
  const isSelfAssigned = Boolean(ticket.selfAssigned);
  const ratingsAllowed = !isSelfAssigned && ticket.type !== 'HELP';
  const canApprove = Boolean(ticket.viewerCanApprove) && ticket.status === 'REVIEW';
  const review = reviewControls(ticket, user?.id, { isLoading, isError: ticketLoadFailed });
  const reviewActionPending =
    startReviewMutation.isPending || pauseReviewMutation.isPending || withdrawMutation.isPending ||
    approveMutation.isPending || rejectMutation.isPending;
  // Mandatory before any decision; shown once the running clock is known so the
  // prompt can name the ticket a start would pause.
  const showReviewGate = review.needsReviewStart && !viewOnly && !workdayIdle && (activeTimerKnown || activeTimerFailed);
  const grouped = groupAttachments(ticket.attachments, ticket.currentReviewCycle?.id);
  const attachmentDelete = (attId: string) => deleteAttachmentMutation.mutate(attId);
  // The self-assigned worker is in REVIEW but must wait for their reporting hierarchy.
  const isSelfWorkerAwaitingReview =
    isSelfAssigned && ticket.createdById === user?.id && ticket.status === 'REVIEW' && !canApprove;
  const isDone = ticket.status === 'DONE' || ticket.status === 'CLOSED';
  // Block/unblock: backend (TicketAccessService.assertCanBlockTicket) is the final authority.
  // This is a client-side approximation so we don't show the action to users who clearly cannot use it.
  const canToggleBlock = roleName !== 'INTERN' && (isTeamLeadPlus || isParticipant);

  const submitComment = () => { if (comment.trim()) addComment.mutate(); };

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'comments', label: 'Comments', count: ticket.comments?.length ?? 0 },
    { key: 'reviews', label: 'Reviews', count: ticket.reviewCycles?.length ?? 0 },
    { key: 'history', label: 'History' },
    { key: 'attachments', label: 'Attachments', count: ticket.attachments?.length ?? 0 },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* Colored accent bar */}
      <div className={`h-1 w-full rounded-full ${
        ticket?.isOverdue
          ? ticket?.overdueSeverity === 'red' ? 'bg-red-500'
            : ticket?.overdueSeverity === 'deep-orange' ? 'bg-orange-600'
            : 'bg-orange-400'
          : ticket?.status === 'IN_PROGRESS' ? 'bg-yellow-400'
          : ticket?.status === 'REVIEW' ? 'bg-purple-400'
          : ticket?.status === 'DONE' ? 'bg-green-400'
          : ''
      }`}
      style={!ticket?.isOverdue && !['IN_PROGRESS','REVIEW','DONE'].includes(ticket?.status)
        ? { backgroundColor: 'var(--border-secondary)' }
        : undefined}
      />

      {/* Review-start gate: Start Review, View Only or Go Back. Opening the page started nothing. */}
      {showReviewGate && (
        <ReviewStartGate
          prompt={reviewStartPrompt(ticket, activeTimer)}
          starting={startReviewMutation.isPending}
          onStart={() => startReviewMutation.mutate()}
          onViewOnly={() => setViewOnly(true)}
          onGoBack={handleBack}
        />
      )}

      {/* POC Upload Modal */}
      {showPocModal && (
        <PocUploadModal
          ticketId={ticket.id}
          onUploadAndSubmit={handlePocUploadAndSubmit}
          onSkip={handlePocSkip}
          onClose={() => setShowPocModal(false)}
          isUploading={pocUploading}
        />
      )}

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="apex-card rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4">
            <h3 className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>Edit Ticket</h3>
            <div className="space-y-3">
              <div>
                <label className="apex-label">Title</label>
                <input
                  type="text"
                  value={editForm.title}
                  onChange={(e) => setEditForm((f: any) => ({ ...f, title: e.target.value }))}
                  className="apex-input"
                />
              </div>
              <div>
                <label className="apex-label">Description</label>
                <textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm((f: any) => ({ ...f, description: e.target.value }))}
                  className="apex-input resize-none"
                  rows={3}
                />
              </div>
              {/* Type (Task / Query / Help) is fixed at creation; it decides the workflow. */}
              <div>
                <label className="apex-label">Priority</label>
                <select value={editForm.priority} onChange={(e) => setEditForm((f: any) => ({ ...f, priority: e.target.value }))} className="apex-select w-full">
                  {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="apex-label">Due Date</label>
                  <input type="date" value={editForm.dueDate} onChange={(e) => setEditForm((f: any) => ({ ...f, dueDate: e.target.value }))} className="apex-input" />
                </div>
                <div>
                  <label className="apex-label">Est. Minutes</label>
                  <input type="number" min="1" step="1" value={editForm.estimatedMinutes} onChange={(e) => setEditForm((f: any) => ({ ...f, estimatedMinutes: e.target.value }))} className="apex-input" placeholder="e.g. 60 for 1 hour" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => editMutation.mutate(buildTicketEditPayload(editForm))}
                disabled={editMutation.isPending || !editForm.title?.trim()}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg text-sm disabled:opacity-50 transition-colors"
              >
                {editMutation.isPending ? 'Saving…' : 'Save Changes'}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="flex-1 py-2.5 rounded-lg text-sm transition-colors border"
                style={{
                  borderColor: 'var(--border-primary)',
                  color: 'var(--text-secondary)',
                  backgroundColor: 'var(--surface-card)',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--surface-card)')}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Block Modal */}
      {showBlockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="apex-card rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Ban size={18} className="text-amber-600" />
              <h3 className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>Block Ticket</h3>
            </div>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Blocking pauses work on this ticket. Add a clear reason so the assignee knows what to resolve.
            </p>
            <div>
              <label className="apex-label">Blocker reason</label>
              <textarea
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                className="apex-input resize-none"
                rows={3}
                placeholder="e.g. Waiting on vendor approval"
                autoFocus
              />
              <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>Minimum 3 characters.</p>
            </div>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => blockMutation.mutate()}
                disabled={blockMutation.isPending || blockReason.trim().length < 3}
                className="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-medium py-2.5 rounded-lg text-sm disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {blockMutation.isPending ? <><Loader2 size={14} className="animate-spin" /> Blocking…</> : <><Ban size={14} /> Block ticket</>}
              </button>
              <button
                onClick={() => { setShowBlockModal(false); setBlockReason(''); }}
                className="flex-1 py-2.5 rounded-lg text-sm transition-colors border"
                style={{
                  borderColor: 'var(--border-primary)',
                  color: 'var(--text-secondary)',
                  backgroundColor: 'var(--surface-card)',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--surface-card)')}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-sm mb-4 flex-wrap" style={{ color: 'var(--text-secondary)' }}>
        {breadcrumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="w-3 h-3 flex-shrink-0" />}
            {crumb.href ? (
              <Link
                href={crumb.href}
                className="transition-colors hover:underline"
                style={{ color: 'var(--text-secondary)' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
              >
                {crumb.label}
              </Link>
            ) : (
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{crumb.label}</span>
            )}
          </span>
        ))}
      </nav>

      {/* Header */}
      <div className="flex items-start gap-3">
        <button
          onClick={handleBack}
          className="p-2 rounded-lg transition-colors mt-0.5"
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <ArrowLeft size={18} style={{ color: 'var(--text-secondary)' }} />
        </button>
        {/* min-w-0: lets a long title wrap on a phone instead of pushing the
            action buttons past the screen edge (Phase 6E). */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <CopyableId ticketId={ticket.ticketId} />
            {/* User-facing classification is Department + Request Type. The old internal
                Category enum is intentionally not shown (it's a legacy backend-only field). */}
            {ticket.department && (
              <span
                className="text-xs px-2 py-0.5 rounded font-medium flex items-center gap-1"
                style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent-text)' }}
              >
                <Building2 size={11} />
                {ticket.department.name}
              </span>
            )}
            {/* Request type — deliberately stronger than the other header chips (bigger
                text, bold, real border) so a QUERY/HELP ticket never reads as an
                ordinary TASK at a glance. */}
            <span className={cn('text-sm font-extrabold tracking-wide px-3 py-1 rounded-md border-2', requestTypeBadge(ticket.type).cls)}>
              {requestTypeBadge(ticket.type).label}
            </span>
            <span className={cn('text-xs px-2 py-0.5 rounded font-medium', PRIORITY_COLORS[ticket.priority])}>
              {PRIORITY_LABELS[ticket.priority] ?? ticket.priority}
            </span>
            <span className={cn('text-xs px-2 py-1 rounded-lg font-medium', vis.badgeClass)}>
              {vis.badgeText}
            </span>
            {ticket.isOverdue && (
              <span className="flex items-center gap-0.5 text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                <AlertTriangle size={9} /> OVERDUE
              </span>
            )}
            {ticket.reworkLabel && (
              <span className="text-xs px-2 py-0.5 rounded font-medium bg-red-100 text-red-700">
                {ticket.reworkLabel}
              </span>
            )}
          </div>
          <h2 className="text-xl font-bold [overflow-wrap:anywhere]" style={{ color: 'var(--text-primary)' }}>{ticket.title}</h2>
          <TimingHeaderSummary ticket={ticket} />
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
            Reported by {ticket.createdBy?.name} · {formatRelativeTime(ticket.createdAt)}
          </p>
          {ticket.timers && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs font-medium text-slate-600">
              <span className="flex items-center gap-1" title="Time since work first started, up to completion"><Clock size={12} /> Ticket age: {Math.floor(ticket.timers.totalTicketSeconds / 3600)}h {Math.floor((ticket.timers.totalTicketSeconds % 3600) / 60)}m</span>
              <span className={cn("flex items-center gap-1", ticket.timers.activeClock === 'EMPLOYEE_WORK' && 'text-blue-600')}><User size={12} /> Employee Work Time: {Math.floor(ticket.timers.employeeWorkSeconds / 3600)}h {Math.floor((ticket.timers.employeeWorkSeconds % 3600) / 60)}m</span>
              <span className={cn("flex items-center gap-1", ticket.timers.activeClock === 'REVIEWER_WORK' && 'text-purple-600')} title="Time a reviewer actively spent reviewing (Start Review to Pause / decision)"><CheckCircle size={12} /> Reviewer active: {formatHoursMinutes(ticket.timers.reviewerWorkSeconds)}</span>
              <span className="flex items-center gap-1" title="Wall-clock time in review (the review SLA clock); keeps running while nobody is reviewing"><Clock size={12} /> Review turnaround: {formatHoursMinutes(ticket.timers.reviewTurnaroundSeconds)}</span>
            </div>
          )}
        </div>
        {canToggleBlock && !ticket.isBlocked && !isDone && (
          <button
            onClick={() => { setBlockReason(''); setShowBlockModal(true); }}
            className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
            title="Block ticket"
          >
            <Ban size={16} />
          </button>
        )}
        {canEdit && (
          <button
            onClick={() => {
              setEditForm({
                title: ticket.title,
                description: ticket.description ?? '',
                priority: ticket.priority,
                dueDate: ticket.dueDate ? new Date(ticket.dueDate).toISOString().split('T')[0] : '',
                estimatedMinutes: ticket.estimatedMinutes ? String(ticket.estimatedMinutes) : '',
              });
              setEditing(true);
            }}
            className="p-2 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
            title="Edit ticket"
          >
            <Edit2 size={16} />
          </button>
        )}
        {canDelete && (
          <button
            onClick={() => { if (confirm('Delete this ticket? This cannot be undone.')) deleteTicket.mutate(); }}
            className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
            title="Delete ticket"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      {/* Blocked Banner */}
      {ticket.isBlocked && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-2.5">
              <Ban size={18} className="text-red-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-red-800">This ticket is blocked</p>
                {ticket.blockedReason && (
                  <p className="text-sm text-red-700 mt-1 whitespace-pre-wrap">{ticket.blockedReason}</p>
                )}
                <p className="text-xs text-red-500 mt-1.5">
                  {ticket.blockedById && <>Blocked by {resolveUserName(ticket.blockedById)}</>}
                  {ticket.blockedById && ticket.blockedAt && ' · '}
                  {ticket.blockedAt && <>{formatDate(ticket.blockedAt)}</>}
                </p>
              </div>
            </div>
            {canToggleBlock && (
              <button
                onClick={() => unblockMutation.mutate()}
                disabled={unblockMutation.isPending}
                className="flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-red-100 text-red-700 text-sm font-medium rounded-lg border border-red-200 transition-colors disabled:opacity-50"
              >
                {unblockMutation.isPending
                  ? <><Loader2 size={14} className="animate-spin" /> Unblocking…</>
                  : <><Unlock size={14} /> Unblock ticket</>}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Self-assigned worker awaiting hierarchy review — cannot self-approve */}
      {isSelfWorkerAwaitingReview && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-amber-800">
            This ticket requires approval from your reporting hierarchy.
          </p>
          <p className="text-xs text-amber-700 mt-1">
            You have submitted this self-assigned work for review. You cannot approve, reject, or rate your own ticket — your Team Lead, Manager, or Admin will review it.
          </p>
        </div>
      )}

      {/* Pending Approval Banner */}
      {ticket.status === 'PENDING_APPROVAL' && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock size={18} className="text-amber-600" />
            <p className="text-sm font-semibold text-amber-800">
              This task requires approval before it can become active.
            </p>
          </div>
          {ticket.approverId === user?.id ? (
            rejectMode ? (
              <div className="space-y-2">
                <input
                  type="text"
                  value={rejectComment}
                  onChange={(e) => setRejectComment(e.target.value)}
                  placeholder="Reason for rejection..."
                  className="apex-input"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => rejectCreationMutation.mutate()}
                    disabled={!rejectComment.trim() || rejectCreationMutation.isPending}
                    className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg disabled:opacity-40 transition-colors"
                  >
                    <XCircle size={14} /> Confirm Reject
                  </button>
                  <button
                    onClick={() => { setRejectMode(false); setRejectComment(''); }}
                    className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => approveCreationMutation.mutate()}
                  disabled={approveCreationMutation.isPending}
                  className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg disabled:opacity-40 transition-colors"
                >
                  <CheckCircle size={14} /> Approve Task
                </button>
                <button
                  onClick={() => setRejectMode(true)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-red-50 hover:bg-red-100 text-red-700 text-sm font-medium rounded-lg border border-red-200 transition-colors"
                >
                  <XCircle size={14} /> Reject Task
                </button>
              </div>
            )
          ) : (
            <p className="text-xs text-amber-700 mt-1">
              Waiting for {resolveUserName(ticket.approverId)} to approve.
            </p>
          )}
        </div>
      )}

      {/* Withdraw Submission — only the ticket's own assignee, only while in REVIEW */}
      {review.canWithdraw && (
        <div className="flex items-center justify-between gap-3 rounded-xl border p-3" style={{ borderColor: 'var(--border-primary)' }}>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Submitted for review. Withdraw it to keep working; this is not counted as rework.
          </p>
          <button
            type="button"
            onClick={() => withdrawMutation.mutate()}
            disabled={reviewActionPending}
            aria-busy={withdrawMutation.isPending}
            className="text-sm font-medium px-3 py-1.5 rounded-lg border disabled:opacity-50"
            style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
          >
            {withdrawMutation.isPending ? 'Withdrawing…' : 'Withdraw Submission'}
          </button>
        </div>
      )}

      {/* Approvals Banner */}
      {canApprove && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-amber-800 mb-3">
            {isSelfAssigned
              ? 'This self-assigned ticket is awaiting your review — approve (comment only) or send back'
              : 'This ticket is awaiting review — approve or send back'}
          </p>
          {/* Reviewer active-work clock: explicit start/pause, shown running only from the ledger */}
          <div className="flex flex-wrap items-center gap-2 mb-3" role="group" aria-label="Review timer">
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }} aria-live="polite">
              {review.reviewRunningForViewer ? 'Your review timer is running.' : 'Your review timer is paused.'}
            </span>
            {review.canPauseReview ? (
              <button
                type="button"
                onClick={() => pauseReviewMutation.mutate()}
                disabled={reviewActionPending}
                aria-busy={pauseReviewMutation.isPending}
                className="text-xs font-medium px-3 py-1.5 rounded-lg border border-amber-300 text-amber-800 disabled:opacity-50"
              >
                {pauseReviewMutation.isPending ? 'Pausing…' : 'Pause Review'}
              </button>
            ) : (
              <button
                type="button"
                // Where a started review is required, reopen the prompt so the
                // reviewer sees which ticket the start will pause.
                onClick={() => (review.needsReviewStart ? setViewOnly(false) : startReviewMutation.mutate())}
                disabled={!review.canStartReview || reviewActionPending}
                title={review.disabledReason ?? undefined}
                aria-busy={startReviewMutation.isPending}
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-amber-600 text-white disabled:opacity-50"
              >
                {startReviewMutation.isPending ? 'Starting…' : 'Start Review'}
              </button>
            )}
          </div>
          {review.decisionBlockedReason && (
            <p className="text-xs text-amber-800 mb-2" role="note">
              {viewOnly ? 'View Only. ' : ''}{review.decisionBlockedReason}
            </p>
          )}
          {rejectMode ? (
            <div className="space-y-2">
              <input
                type="text"
                value={rejectComment}
                onChange={(e) => setRejectComment(e.target.value)}
                placeholder="Reason for rejection..."
                className="apex-input"
              />
              <input
                type="number"
                min={0.25}
                step={0.25}
                value={reworkEstimateHours}
                onChange={(e) => setReworkEstimateHours(e.target.value)}
                placeholder="Rework estimate in hours (optional)"
                className="apex-input"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => rejectMutation.mutate()}
                  disabled={!rejectComment.trim() || reviewActionPending || !review.canDecide}
                  className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg disabled:opacity-40 transition-colors"
                >
                  <XCircle size={14} /> Confirm Reject
                </button>
                <button
                  onClick={() => { setRejectMode(false); setRejectComment(''); setReworkEstimateHours(''); }}
                  className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4 mt-4">
              {ratingsAllowed ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">Task Efficiency</label>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <button key={s} onClick={() => setTaskEfficiencyRating(s)} className={s <= taskEfficiencyRating ? 'text-amber-500' : 'text-slate-300'}>
                          <Star size={20} fill={s <= taskEfficiencyRating ? 'currentColor' : 'none'} />
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">Employee Performance</label>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <button key={s} onClick={() => setEmployeePerformanceRating(s)} className={s <= employeePerformanceRating ? 'text-amber-500' : 'text-slate-300'}>
                          <Star size={20} fill={s <= employeePerformanceRating ? 'currentColor' : 'none'} />
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">Employee Attitude</label>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <button key={s} onClick={() => setEmployeeAttitudeRating(s)} className={s <= employeeAttitudeRating ? 'text-amber-500' : 'text-slate-300'}>
                          <Star size={20} fill={s <= employeeAttitudeRating ? 'currentColor' : 'none'} />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-500">
                  Self-assigned work is approved comment-only — no ratings are recorded.
                </p>
              )}
              <input
                type="text"
                value={ratingComment}
                onChange={(e) => setRatingComment(e.target.value)}
                placeholder="Optional comment on approval..."
                className="apex-input"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => approveMutation.mutate()}
                  title={review.decisionBlockedReason ?? undefined}
                  disabled={reviewActionPending || !review.canDecide || (ratingsAllowed && (!taskEfficiencyRating || !employeePerformanceRating || !employeeAttitudeRating))}
                  className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg disabled:opacity-40 transition-colors"
                >
                  <CheckCircle size={14} /> {isSelfAssigned ? 'Approve & Complete' : 'Approve Task'}
                </button>
                <button
                  onClick={() => setRejectMode(true)}
                  disabled={reviewActionPending || !review.canDecide}
                  title={review.decisionBlockedReason ?? undefined}
                  className="flex items-center gap-1.5 px-4 py-2 bg-red-50 hover:bg-red-100 text-red-700 text-sm font-medium rounded-lg border border-red-200 transition-colors disabled:opacity-40"
                >
                  <XCircle size={14} /> Send Back for Rework
                </button>
              </div>
              <p className="text-xs text-slate-500">Rework returns the ticket to In Progress for the same assignee as a new cycle with its own estimate. The assignee's timer resumes when they are working. The same ticket ID is retained.</p>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-4">
          {/* Description */}
          {ticket.description && (
            <div className="apex-card p-5">
              <h3 className="font-semibold text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>Description</h3>
              <p className="text-sm whitespace-pre-wrap break-words leading-relaxed" style={{ color: 'var(--text-secondary)' }}><LinkifiedText text={ticket.description} /></p>
            </div>
          )}

          {/* Tabs */}
          <div className="apex-card">
            {/* Tab Header */}
            <div className="flex border-b overflow-x-auto" style={{ borderColor: 'var(--border-subtle)' }}>
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={cn(
                    'flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap',
                    activeTab === t.key
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent hover:text-slate-700',
                  )}
                  style={activeTab !== t.key ? { color: 'var(--text-secondary)' } : undefined}
                >
                  {t.key === 'history' && <History size={13} />}
                  {t.key === 'reviews' && <CheckCircle size={13} />}
                  {t.key === 'attachments' && <Paperclip size={13} />}
                  {t.label}
                  {typeof t.count === 'number' && (
                    <span
                      className="text-xs px-1.5 py-0.5 rounded-full"
                      style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }}
                    >
                      {t.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Comments Tab */}
            {activeTab === 'comments' && (
              <>
                <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                  {ticket.comments?.map((c: any) => (
                    <div key={c.id} className="px-5 py-4" style={{ borderColor: 'var(--border-subtle)' }}>
                      <div className="flex items-center gap-2 mb-2">
                        <div className={cn(
                          'w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0',
                          c.content?.startsWith('[REJECTED]') ? 'bg-red-500' : 'bg-blue-600',
                        )}>
                          <span className="text-white text-xs font-semibold">{getInitials(c.author?.name)}</span>
                        </div>
                        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{c.author?.name}</span>
                        <span className="text-xs ml-auto" style={{ color: 'var(--text-tertiary)' }}>{formatRelativeTime(c.createdAt)}</span>
                      </div>
                      <p className={cn(
                        'text-sm ml-9',
                        c.content?.startsWith('[REJECTED]') ? 'text-red-600 font-medium' : '',
                      )}
                      style={!c.content?.startsWith('[REJECTED]') ? { color: 'var(--text-secondary)' } : undefined}
                      >
                        {c.content}
                      </p>
                    </div>
                  ))}
                  {(!ticket.comments || ticket.comments.length === 0) && (
                    <div className="px-5 py-6 text-sm text-center" style={{ color: 'var(--text-tertiary)' }}>No comments yet</div>
                  )}
                </div>
                {/* Add Comment */}
                <div className="px-5 py-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div className="flex gap-3">
                    <div className="w-7 h-7 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-white text-xs font-semibold">{getInitials(user?.name || 'U')}</span>
                    </div>
                    <div className="flex-1 flex gap-2">
                      <input
                        type="text"
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && submitComment()}
                        placeholder="Add a comment..."
                        className="flex-1 apex-input"
                      />
                      <button
                        onClick={submitComment}
                        disabled={!comment.trim() || addComment.isPending}
                        className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-40"
                      >
                        <Send size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* History Tab */}
            {activeTab === 'history' && (
              <div>
                {!history ? (
                  <div className="px-5 py-6 text-sm text-center" style={{ color: 'var(--text-tertiary)' }}>Loading...</div>
                ) : history.length === 0 ? (
                  <div className="px-5 py-6 text-sm text-center" style={{ color: 'var(--text-tertiary)' }}>No changes recorded yet</div>
                ) : history.map((h: any) => (
                  <div key={h.id} className="px-5 py-3 flex items-start gap-3 border-b last:border-0" style={{ borderColor: 'var(--border-subtle)' }}>
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                      style={{ backgroundColor: 'var(--bg-tertiary)' }}
                    >
                      <span className="text-[10px] font-bold" style={{ color: 'var(--text-secondary)' }}>{getInitials(h.changedBy?.name)}</span>
                    </div>
                    <div className="flex-1">
                      {formatHistoryItem(h)}
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{formatRelativeTime(h.changedAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Reviews Tab */}
            {activeTab === 'reviews' && (
              <div>
                {(!ticket.reviewCycles || ticket.reviewCycles.length === 0) ? (
                  <div className="px-5 py-6 text-sm text-center" style={{ color: 'var(--text-tertiary)' }}>No review cycles yet</div>
                ) : ticket.reviewCycles.map((cycle: any, idx: number) => (
                  <div key={cycle.id} className="px-5 py-4 border-b last:border-0 space-y-3" style={{ borderColor: 'var(--border-subtle)' }}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm">Cycle {cycle.cycleNo}</span>
                      <span className={cn('text-xs px-2 py-0.5 rounded font-medium', 
                        cycle.decision === 'APPROVED' ? 'bg-green-100 text-green-700' :
                        cycle.decision === 'REWORK' ? 'bg-red-100 text-red-700' :
                        cycle.decision === 'WITHDRAWN' || cycle.decision === 'CANCELLED' ? 'bg-sky-100 text-sky-700' :
                        'bg-slate-100 text-slate-700'
                      )}>
                        {reviewDecisionLabel(cycle.decision)}
                      </span>
                    </div>
                    
                    <div className="text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
                      <span>Started: {formatDate(cycle.reviewStartedAt)}</span>
                      {cycle.reviewEndedAt && <span>Ended: {formatDate(cycle.reviewEndedAt)}</span>}
                      {(cycle.decision === 'APPROVED' || cycle.decision === 'REWORK') && (
                        <span title="Time the reviewer actively spent on this review">Reviewer active: {formatHoursMinutes(cycle.reviewerWorkSeconds)}</span>
                      )}
                    </div>

                    <div className="bg-slate-50 rounded-lg p-3 text-xs space-y-2">
                      {cycle.decision === 'APPROVED' && (
                        <div className="flex gap-4">
                          <span className="flex items-center gap-1">Efficiency: <Star size={12} className="text-amber-500" fill="currentColor"/> {cycle.taskEfficiencyRating}</span>
                          <span className="flex items-center gap-1">Performance: <Star size={12} className="text-amber-500" fill="currentColor"/> {cycle.employeePerformanceRating}</span>
                          <span className="flex items-center gap-1">Attitude: <Star size={12} className="text-amber-500" fill="currentColor"/> {cycle.employeeAttitudeRating}</span>
                        </div>
                      )}
                      {cycle.feedback && (
                        <div className="mt-1">
                          <span className="font-semibold text-slate-700">Feedback: </span>
                          <span className="text-slate-600 whitespace-pre-wrap">{cycle.feedback}</span>
                        </div>
                      )}
                      {cycle.ratingComment && (
                        <div className="mt-1">
                          <span className="font-semibold text-slate-700">Approval Comment: </span>
                          <span className="text-slate-600 whitespace-pre-wrap">{cycle.ratingComment}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Attachments Tab — while in review, the current cycle's proof comes first */}
            {activeTab === 'attachments' && (
              <div className="p-5 space-y-5">
                {ticket.status === 'REVIEW' && (
                  <section aria-labelledby="current-evidence-heading" className="space-y-2">
                    <h4 id="current-evidence-heading" className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
                      Proof of completion{ticket.currentReviewCycle ? ` — review cycle ${ticket.currentReviewCycle.cycleNo}` : ''}
                    </h4>
                    {grouped.currentProof.length > 0 ? (
                      <div className="space-y-2">
                        {grouped.currentProof.map((att: any, i: number) => (
                          <AttachmentCard key={att.id} att={att} ticketId={ticket.id} onDelete={attachmentDelete} highlight={i === 0} inlinePreview={i === 0} />
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>{NO_CURRENT_PROOF_MESSAGE}</p>
                    )}
                    {grouped.currentFeedback.length > 0 && (
                      <div className="space-y-2 pt-1">
                        <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Review feedback</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {grouped.currentFeedback.map((att: any) => (
                            <AttachmentCard key={att.id} att={att} ticketId={ticket.id} onDelete={attachmentDelete} />
                          ))}
                        </div>
                      </div>
                    )}
                  </section>
                )}

                <div
                  className="border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer"
                  style={{ borderColor: 'var(--border-primary)' }}
                  onClick={() => fileInputRef.current?.click()}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border-primary)')}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files[0];
                    if (!file) return;
                    if (file.size > 5 * 1024 * 1024) { toast.error('File must be under 5 MB'); return; }
                    uploadMutation.mutate(file);
                  }}
                >
                  <Upload size={24} className="mx-auto mb-2" style={{ color: 'var(--text-tertiary)' }} />
                  <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                    {uploadMutation.isPending ? 'Uploading...' : 'Drop a file or click to upload'}
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                    Max 5 MB · Images, PDFs, docs
                    {uploadPurposeFor(ticket, user?.id) === 'REVIEW_FEEDBACK' ? ' · saved as review feedback for this cycle' : ''}
                  </p>
                  <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
                </div>

                {grouped.pendingProof.length > 0 && (
                  <section className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Proof for the next submission</h4>
                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Attached to the review and locked when this ticket is submitted for review.</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {grouped.pendingProof.map((att: any) => (
                        <AttachmentCard key={att.id} att={att} ticketId={ticket.id} onDelete={attachmentDelete} />
                      ))}
                    </div>
                  </section>
                )}

                {grouped.other.length > 0 && (
                  <section className="space-y-2">
                    {ticket.status === 'REVIEW' && (
                      <h4 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Other files</h4>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {grouped.other.map((att: any) => (
                        <AttachmentCard key={att.id} att={att} ticketId={ticket.id} onDelete={attachmentDelete} />
                      ))}
                    </div>
                  </section>
                )}

                {grouped.previous.length > 0 && (
                  <section aria-labelledby="previous-evidence-heading" className="space-y-3">
                    <h4 id="previous-evidence-heading" className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Previous evidence</h4>
                    {grouped.previous.map((group) => (
                      <div key={group.cycleNo ?? 'legacy'} className="space-y-2">
                        <p className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>
                          {group.cycleNo ? `Review cycle ${group.cycleNo}` : 'Earlier proof (review cycle not recorded)'}
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {group.items.map((att: any) => (
                            <AttachmentCard key={att.id} att={att} ticketId={ticket.id} onDelete={attachmentDelete} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </section>
                )}

                {!(ticket.attachments?.length > 0) && (
                  <p className="text-sm text-center" style={{ color: 'var(--text-tertiary)' }}>No attachments yet</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Status stepper */}
          {ticket.status !== 'PENDING_APPROVAL' && (
            <div className="apex-card p-4">
              <h3 className="font-semibold text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>Status</h3>
            {(() => {
              const steps = ['OPEN', 'IN_PROGRESS', 'REVIEW', 'DONE'];
              const currentIdx = steps.indexOf(ticket.status);
              const isClosed = ticket.status === 'CLOSED';
              return (
                <div className="space-y-1.5">
                  {steps.map((s, i) => {
                    const isPast = i < currentIdx;
                    const isCurrent = i === currentIdx;
                    const isNext = i === currentIdx + 1;
                    const canClick = canEdit && !updateStatus.isPending && !pocUploading && (isNext || (isPast && !isClosed));
                    return (
                      <button
                        key={s}
                        onClick={() => canClick && handleStatusClick(s)}
                        disabled={!canClick}
                        className={cn(
                          'w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center gap-2',
                          isCurrent
                            ? 'bg-blue-600 text-white ring-2 ring-blue-300'
                            : isPast
                            ? 'bg-green-50 text-green-700 cursor-pointer hover:bg-green-100'
                            : '',
                        )}
                        style={!isCurrent && !isPast ? {
                          backgroundColor: 'var(--bg-tertiary)',
                          color: isNext && canEdit ? 'var(--text-secondary)' : 'var(--text-tertiary)',
                          cursor: isNext && canEdit ? 'pointer' : 'not-allowed',
                          border: isNext && canEdit ? '1px dashed var(--border-secondary)' : 'none',
                        } : undefined}
                        onMouseEnter={(e) => {
                          if (isNext && canEdit && !isCurrent && !isPast) {
                            e.currentTarget.style.backgroundColor = 'var(--accent-subtle)';
                            e.currentTarget.style.color = 'var(--accent)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (isNext && canEdit && !isCurrent && !isPast) {
                            e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)';
                            e.currentTarget.style.color = 'var(--text-secondary)';
                          }
                        }}
                      >
                        <span className="flex-shrink-0">
                          {isPast ? '✓' : isCurrent ? '●' : '○'}
                        </span>
                        {STATUS_LABELS[s] ?? s}
                        {isNext && canEdit && !isClosed && (
                          <span className="ml-auto text-[10px]" style={{ color: 'var(--text-tertiary)' }}>→ advance</span>
                        )}
                      </button>
                    );
                  })}
                  {isClosed ? (
                    <div
                      className="px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2"
                      style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
                    >
                      <span>✕</span> Closed
                    </div>
                  ) : ticket.viewerCanClose && (
                    <button
                      onClick={() => {
                        if (window.confirm('Close this ticket? A closed ticket cannot be reopened or edited.')) updateStatus.mutate('CLOSED');
                      }}
                      disabled={updateStatus.isPending || pocUploading}
                      className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors"
                      style={{ color: 'var(--text-tertiary)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      Close ticket
                    </button>
                  )}
                </div>
              );
            })()}
          </div>
          )}

          {/* Details */}
          <div className="apex-card p-4 space-y-3">
            <h3 className="font-semibold text-sm" style={{ color: 'var(--text-secondary)' }}>Details</h3>
            {/* Request Type — same TASK/QUERY/HELP distinction as the header badge,
                repeated here since this card is the other place people scan for
                what kind of ticket this is before reading the Assignee section. */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Request Type</span>
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {REQUEST_TYPE_DISPLAY[ticket.type] ?? 'Task'}
              </span>
            </div>
            {/* Assignee(s) */}
            <div>
              <p className="text-xs mb-1.5 flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}>
                <Users size={11} /> {assigneeLabelFor(ticket.type)}
              </p>
              {canEdit ? (
                <select
                  value={ticket.assignedToId || ''}
                  onChange={(e) => {
                    if (e.target.value === '') { handleUnassignPrimary(); return; }
                    assignMutation.mutate(e.target.value);
                  }}
                  className="apex-select w-full text-xs"
                >
                  <option value="">{ticket.assignedToId ? 'Unassign' : 'Unassigned'}</option>
                  {(Array.isArray(users) ? users : (users as any)?.users ?? []).map((u: any) => (
                    <option key={u.id} value={u.id}>{u.name} — {formatRole(u.role)}</option>
                  ))}
                </select>
              ) : null}
              {/* Primary assignee */}
              <div className="flex flex-wrap gap-2 mt-2">
                {ticket.assignedTo ? (
                  <div className="flex items-center gap-1.5">
                    <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-white text-[10px] font-bold">{getInitials(ticket.assignedTo.name)}</span>
                    </div>
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{ticket.assignedTo.name}</span>
                    <span
                      className="text-[9px] px-1 py-0.5 rounded"
                      style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }}
                    >Primary</span>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={handleUnassignPrimary}
                        disabled={unassignPrimaryMutation.isPending}
                        title="Unassign primary assignee"
                        className="ml-0.5 p-0.5 rounded hover:bg-red-500/10 transition-colors disabled:opacity-50"
                      >
                        <UserMinus size={12} className="text-red-400" />
                      </button>
                    )}
                  </div>
                ) : (ticket.assignees ?? []).length === 0 ? (
                  <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Unassigned</span>
                ) : null}
                {/* Additional assignees */}
                {(ticket.assignees ?? [])
                  .filter((a: any) => a.user?.id !== ticket.assignedToId)
                  .map((a: any) => (
                    <div key={a.id} className="flex items-center gap-1.5">
                      <div className="w-6 h-6 bg-indigo-500 rounded-full flex items-center justify-center flex-shrink-0">
                        <span className="text-white text-[10px] font-bold">{getInitials(a.user?.name)}</span>
                      </div>
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{a.user?.name}</span>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => handleRemoveAssignee(a.user?.id, a.user?.name)}
                          disabled={removeAssigneeMutation.isPending}
                          title="Remove from ticket"
                          className="p-0.5 rounded hover:bg-red-500/10 transition-colors disabled:opacity-50"
                        >
                          <UserMinus size={12} className="text-red-400" />
                        </button>
                      )}
                    </div>
                  ))}
              </div>
            </div>

            {/* Assigned By */}
            {ticket.createdBy && (
              <div>
                <p className="text-xs mb-1.5 flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}>
                  <User size={11} /> Assigned By
                </p>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-slate-400 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-white text-[10px] font-bold">{getInitials(ticket.createdBy.name)}</span>
                  </div>
                  <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{ticket.createdBy.name}</span>
                </div>
              </div>
            )}

            <div className="space-y-2.5 pt-1 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              {ticket.department && (
                <div>
                  {/* Requesting Department label only applies once there's a separate
                      Target Department to distinguish it from — TASK keeps the plain,
                      unlabeled row exactly as before. */}
                  {ticket.type !== 'TASK' && (
                    <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Requesting Department</span>
                  )}
                  <div className="flex items-center gap-2 mt-0.5">
                    <Building2 size={13} style={{ color: 'var(--text-tertiary)' }} />
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{ticket.department.name}</span>
                  </div>
                </div>
              )}
              {ticket.type !== 'TASK' && ticket.targetDepartmentId && targetDepartmentName && (
                <div>
                  <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    {ticket.type === 'HELP' ? 'Help From Department' : 'Target Department'}
                  </span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Building2 size={13} style={{ color: 'var(--text-tertiary)' }} />
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{targetDepartmentName}</span>
                  </div>
                </div>
              )}
              {ticket.project && (
                <div className="flex items-center gap-2">
                  <Tag size={13} style={{ color: 'var(--text-tertiary)' }} />
                  <Link href={`/projects/${ticket.project.id}`} className="text-xs text-blue-600 hover:underline">
                    {ticket.project.projectId} — {ticket.project.name}
                  </Link>
                </div>
              )}
              {ticket.estimatedTime && !ticket.estimatedMinutes && (
                <div className="flex items-center gap-2">
                  <Clock size={13} style={{ color: 'var(--text-tertiary)' }} />
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Est. {ticket.estimatedTime}h</span>
                </div>
              )}
              {/* One clean Timing section — Work Timer Status / Due Date / Due Time / Time Left.
                  Replaces the old scattered "Due Date" row, separate "Time Left" row, and the
                  mislabeled "Due date: 2h left" SLA timer that used to live at the bottom. */}
              {ticket.status !== 'PENDING_APPROVAL' && <TicketTimingPanel ticket={ticket} />}
              {ticket.scheduleRecurring && ticket.scheduleRecurring !== 'none' ? (
                <>
                  <div>
                    <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Recurrence</span>
                    <p className="text-sm font-medium mt-0.5" style={{ color: 'var(--text-primary)' }}>
                      🔁 {RECURRENCE_LABELS[ticket.scheduleRecurring] ?? ticket.scheduleRecurring}
                    </p>
                  </div>
                  {ticket.scheduleEndDate && (
                    <div>
                      <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Until</span>
                      <p className="text-sm font-medium mt-0.5" style={{ color: 'var(--text-primary)' }}>
                        {new Date(ticket.scheduleEndDate).toLocaleDateString()}
                      </p>
                    </div>
                  )}
                </>
              ) : ticket.scheduledFor ? (
                <div>
                  <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Scheduled</span>
                  <p className="text-sm font-medium mt-0.5" style={{ color: 'var(--text-primary)' }}>
                    ⏰ {new Date(ticket.scheduledFor).toLocaleString()}
                  </p>
                </div>
              ) : null}
              {ticket.scheduledNote && (
                <div className="flex items-start gap-2">
                  <Clock size={13} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--text-tertiary)' }} />
                  <span className="text-xs italic" style={{ color: 'var(--text-secondary)' }}>{ticket.scheduledNote}</span>
                </div>
              )}
              {ticket?.scheduledStartAt && (
                <div>
                  {/* Planning metadata — this is the SCHEDULED start, never the actual start
                      (actualStartAt is shown separately as "Started" only once IN_PROGRESS). */}
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Scheduled Start</p>
                  <p className="text-sm font-medium mt-0.5" style={{ color: 'var(--text-primary)' }}>
                    ⏰ {new Date(ticket.scheduledStartAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    {ticket?.scheduledEndAt && ` → ${new Date(ticket.scheduledEndAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                  </p>
                </div>
              )}
              {ticket?.estimatedMinutes && (
                <div>
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Estimated Time</p>
                  <p className="text-sm font-medium mt-0.5" style={{ color: 'var(--text-primary)' }}>
                    ⏱ {ticket.estimatedMinutes < 60 ? `${ticket.estimatedMinutes} min` : `${Math.floor(ticket.estimatedMinutes / 60)}h${ticket.estimatedMinutes % 60 > 0 ? ` ${ticket.estimatedMinutes % 60}m` : ''}`}
                  </p>
                </div>
              )}
              {/* "Started" reflects real work start (actualStartAt). Never show it while OPEN —
                  an OPEN ticket may still carry actualStartAt after a send-back/unassign to OPEN. */}
              {ticket?.actualStartAt && ticket?.status !== 'OPEN' && (
                <div>
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Started</p>
                  <p className="text-sm font-medium mt-0.5" style={{ color: 'var(--text-primary)' }}>
                    ▶ {new Date(ticket.actualStartAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              )}
              {ticket?.executionDueAt && !ticket?.submittedAt && !['DONE','CLOSED'].includes(ticket?.status) && (
                <div>
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Exec deadline</p>
                  <p className="text-sm font-medium mt-0.5" style={{ color: 'var(--text-primary)' }}>
                    ⏱ {new Date(ticket.executionDueAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              )}
              {ticket?.submittedAt && (
                <div>
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Submitted for review</p>
                  <p className="text-sm font-medium mt-0.5" style={{ color: 'var(--text-primary)' }}>
                    📤 {new Date(ticket.submittedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              )}
              {ticket?.reviewDueAt && ticket?.status === 'REVIEW' && (
                <div>
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Review deadline</p>
                  <p className="text-sm font-medium text-purple-700 mt-0.5">
                    🔍 {new Date(ticket.reviewDueAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              )}
              {ticket?.actualCompletedAt && (
                <div>
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Completed</p>
                  <p className="text-sm font-medium text-green-600 mt-0.5">
                    ✓ {new Date(ticket.actualCompletedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              )}
              {ticket?.actualStartAt && ['DONE', 'CLOSED'].includes(ticket?.status) && ticket?.actualCompletedAt && (() => {
                const ms = new Date(ticket.actualCompletedAt).getTime() - new Date(ticket.actualStartAt).getTime();
                const totalMins = Math.max(0, Math.floor(ms / 60000));
                if (totalMins <= 0) return null;
                const hours = Math.floor(totalMins / 60);
                const mins = totalMins % 60;
                const display = hours > 0
                  ? mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
                  : `${mins}m`;
                const vsEstimate = ticket.estimatedMinutes
                  ? totalMins <= ticket.estimatedMinutes
                    ? { label: `${ticket.estimatedMinutes - totalMins}m under`, color: 'text-green-600' }
                    : { label: `${totalMins - ticket.estimatedMinutes}m over`, color: 'text-orange-500' }
                  : null;
                return (
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-green-50 rounded-lg">
                    <CheckCircle size={12} className="text-green-500 flex-shrink-0" />
                    <div>
                      <span className="text-xs font-semibold text-green-700">Took {display}</span>
                      {vsEstimate && (
                        <span className={`ml-1.5 text-[10px] font-medium ${vsEstimate.color}`}>
                          ({vsEstimate.label} estimate)
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}
              {ticket?.actualStartAt && ticket?.status === 'REVIEW' && ticket?.submittedAt && (() => {
                const ms = new Date(ticket.submittedAt).getTime() - new Date(ticket.actualStartAt).getTime();
                const totalMins = Math.max(0, Math.floor(ms / 60000));
                if (totalMins <= 0) return null;
                const hours = Math.floor(totalMins / 60);
                const mins = totalMins % 60;
                const display = hours > 0
                  ? mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
                  : `${mins}m`;
                return (
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg" style={{ backgroundColor: 'rgba(168,85,247,0.08)' }}>
                    <Clock size={12} className="text-purple-500 flex-shrink-0" />
                    <span className="text-xs font-semibold text-purple-700">Execution time: {display}</span>
                  </div>
                );
              })()}
              {ticket?.workBudget && ticket?.status === 'IN_PROGRESS' && !ticket?.actualCompletedAt && (() => {
                // Productive assignee time in the current cycle (ledger): breaks,
                // end-day, overnight, blocked and switched-away time are excluded.
                // Spent so far + Time left = this cycle's estimate.
                const budget = computeWorkBudget(ticket);
                const totalMins = budget ? budget.workedMinutes : Math.max(0, Math.floor((ticket.workBudget.workedSeconds ?? 0) / 60));
                const cycleEstimate = budget ? budget.estimatedMinutes : ticket.workBudget.estimatedMinutes;
                if (totalMins <= 0) return null;
                const hours = Math.floor(totalMins / 60);
                const mins = totalMins % 60;
                const display = hours > 0
                  ? mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
                  : `${mins}m`;
                const isOverEst = cycleEstimate && totalMins > cycleEstimate;
                return (
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-50 rounded-lg">
                    <Clock size={12} className="text-blue-500 flex-shrink-0" />
                    <div>
                      <span className="text-xs font-semibold text-blue-700">Spent so far: {display}</span>
                      {cycleEstimate && (
                        <span className={`ml-1.5 text-[10px] font-medium ${isOverEst ? 'text-orange-500' : 'text-slate-500'}`}>
                          ({budget?.cycle === 'REWORK' ? 'Rework est' : 'Est'}: {cycleEstimate}m)
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}
              <div className="flex items-center gap-2">
                <Calendar size={13} style={{ color: 'var(--text-tertiary)' }} />
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Created {formatDate(ticket.createdAt)}</span>
              </div>
              {ticket.updatedAt && ticket.updatedAt !== ticket.createdAt && (
                <div className="flex items-center gap-2">
                  <Calendar size={13} style={{ color: 'var(--text-tertiary)' }} />
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Updated {formatRelativeTime(ticket.updatedAt)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Type card intentionally hidden — every ticket is type TASK today (hardcoded at
              creation, not a user choice), so showing it adds no information. Re-enable once
              Ticket Type (Task/Query/Help) becomes a real user-selected field. */}

          {/* Task Type */}
          {ticket.taskType && (
            <div className="apex-card p-4">
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Task Type</p>
              <p className="text-sm font-medium mt-0.5" style={{ color: 'var(--text-primary)' }}>
                {ticket.taskType.name}
                {ticket.taskSubtype ? (
                  <span style={{ color: 'var(--text-secondary)' }}> / {ticket.taskSubtype.name}</span>
                ) : (ticket as any).customSubtypeText ? (
                  <span style={{ color: 'var(--text-secondary)' }}> / {(ticket as any).customSubtypeText} <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>(custom)</span></span>
                ) : null}
              </p>
            </div>
          )}

          {/* AI Suggestions */}
          <AiSuggestionsPanel ticketId={ticket.id} />
        </div>
      </div>
    </div>
  );
}
