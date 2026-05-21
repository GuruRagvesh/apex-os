'use client';

import { useState, useEffect } from 'react';
import { computeOverdueDisplay, type OverdueSeverity } from '@/lib/ticket-visibility';

interface OverdueTickerProps {
  dueAt?: string | null;
  scheduledEndAt?: string | null;
  status: string;
  className?: string;
}

export function OverdueTicker({ dueAt, scheduledEndAt, status, className = '' }: OverdueTickerProps) {
  const [overdue, setOverdue] = useState(() =>
    computeOverdueDisplay(dueAt, status, scheduledEndAt),
  );

  useEffect(() => {
    const effectiveDue = scheduledEndAt || dueAt;
    if (!effectiveDue || ['DONE', 'CLOSED'].includes(status)) return;
    const interval = setInterval(() => {
      setOverdue(computeOverdueDisplay(dueAt, status, scheduledEndAt));
    }, 60000);
    return () => clearInterval(interval);
  }, [dueAt, scheduledEndAt, status]);

  if (!overdue.isOverdue) return null;

  const colors: Record<OverdueSeverity, string> = {
    orange: 'text-orange-600 dark:text-orange-400',
    'deep-orange': 'text-orange-700 dark:text-orange-300 font-medium',
    red: 'text-red-600 dark:text-red-400 font-semibold',
  };
  const icons: Record<OverdueSeverity, string> = {
    orange: '⏱',
    'deep-orange': '⏱',
    red: '🔥',
  };

  return (
    <span className={`inline-flex items-center gap-1 text-xs ${colors[overdue.severity!]} ${className}`}>
      <span>{icons[overdue.severity!]}</span>
      <span>{overdue.display}</span>
    </span>
  );
}
