'use client';

import { useState, useEffect } from 'react';
import { computeClientTimingState, getTimingColorClasses } from '../../shared/ticket-timing';

// ── TimingTicker ─────────────────────────────────────────────────────────────
// The canonical timing badge component.
// Shows countdown or overdue label for execution (OPEN/IN_PROGRESS) and
// review (REVIEW) timers. Updates every 60 s.
//
// Props:
//   ticket     – raw ticket object from API (must include all timing fields)
//   showLabel  – if true, prefix with "Exec:" or "Review:"
//   className  – extra Tailwind classes

interface TimingTickerProps {
  ticket: Record<string, any>;
  showLabel?: boolean;
  className?: string;
}

export function TimingTicker({ ticket, showLabel = false, className = '' }: TimingTickerProps) {
  const [state, setState] = useState(() => computeClientTimingState(ticket));

  useEffect(() => {
    // No active timer — don't bother polling
    if (state.phase === 'none' || state.dueAt === null) return;

    const interval = setInterval(() => {
      setState(computeClientTimingState(ticket));
    }, 60_000);
    return () => clearInterval(interval);
  }, [ticket]);

  if (!state.countdownLabel) return null;

  // Blocked state — amber pill, no timer
  if (state.phase === 'blocked') {
    return (
      <span className={`inline-flex items-center gap-1 text-xs font-bold text-amber-700 dark:text-amber-400 ${className}`}>
        <span>🚫</span>
        <span>Blocked</span>
      </span>
    );
  }

  const colors = getTimingColorClasses(state.overdueSeverity);
  const icon = state.isOverdue
    ? (state.overdueSeverity === 'red' ? '🔥' : '⏱')
    : '⏳';

  // Prefer the backend's own label (e.g. "Due date", "Execution SLA", "Review SLA") —
  // it correctly distinguishes "counting down to the due date" from "counting down an
  // execution/review SLA", which the old hardcoded Exec/Review guess collapsed into one.
  const phaseLabel =
    showLabel
      ? state.label
        ? `${state.label}: `
        : state.phase === 'review'
        ? 'Review: '
        : 'Exec: '
      : '';

  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${colors.text} ${className}`}>
      <span>{icon}</span>
      <span>{phaseLabel}{state.countdownLabel}</span>
    </span>
  );
}

// ── Backward-compatible OverdueTicker ────────────────────────────────────────
// Accepts old-style props and forwards to TimingTicker via a thin shim.
// This keeps existing import sites working without change.

interface OverdueTickerProps {
  dueAt?: string | null;
  scheduledEndAt?: string | null;
  status: string;
  className?: string;
}

export function OverdueTicker({ dueAt, scheduledEndAt, status, className = '' }: OverdueTickerProps) {
  // Build a minimal ticket-like object so computeClientTimingState can work.
  // Old callers don't have executionDueAt / reviewDueAt, so we fall back to
  // scheduledEndAt → dueAt as the execution deadline.
  const ticket = {
    status,
    executionDueAt: scheduledEndAt || dueAt || null,
    reviewDueAt: status === 'REVIEW' ? (dueAt || scheduledEndAt || null) : null,
    submittedAt: null,
  };
  return <TimingTicker ticket={ticket} className={className} />;
}
