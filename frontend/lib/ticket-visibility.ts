export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'REVIEW' | 'DONE' | 'CLOSED';
export type OverdueSeverity = 'orange' | 'deep-orange' | 'red';

export interface TicketVisibility {
  borderClass: string;
  bgClass: string;
  badgeClass: string;
  badgeText: string;
  overdueClass?: string;
  overdueIcon?: string;
}

const STATUS_VISIBILITY: Record<TicketStatus, TicketVisibility> = {
  OPEN: {
    borderClass: 'border-l-4 border-l-slate-300 dark:border-l-slate-600',
    bgClass: '',
    badgeClass: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    badgeText: 'Open',
  },
  IN_PROGRESS: {
    borderClass: 'border-l-4 border-l-yellow-400',
    bgClass: 'bg-yellow-50/30 dark:bg-yellow-950/20',
    badgeClass: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
    badgeText: 'In Progress',
  },
  REVIEW: {
    borderClass: 'border-l-4 border-l-purple-400',
    bgClass: 'bg-purple-50/30 dark:bg-purple-950/20',
    badgeClass: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
    badgeText: 'In Review',
  },
  DONE: {
    borderClass: 'border-l-4 border-l-green-400',
    bgClass: 'bg-green-50/20 dark:bg-green-950/10',
    badgeClass: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
    badgeText: 'Done',
  },
  CLOSED: {
    borderClass: 'border-l-4 border-l-slate-400 dark:border-l-slate-600',
    bgClass: 'opacity-60',
    badgeClass: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
    badgeText: 'Closed',
  },
};

const OVERDUE_VISIBILITY: Record<OverdueSeverity, Partial<TicketVisibility>> = {
  orange: {
    borderClass: 'border-l-4 border-l-orange-400',
    bgClass: 'bg-orange-50/40 dark:bg-orange-950/25',
    overdueClass: 'text-orange-600 dark:text-orange-400',
    overdueIcon: '⏱',
  },
  'deep-orange': {
    borderClass: 'border-l-4 border-l-orange-600',
    bgClass: 'bg-orange-50/60 dark:bg-orange-950/35',
    overdueClass: 'text-orange-700 dark:text-orange-300',
    overdueIcon: '⏱',
  },
  red: {
    borderClass: 'border-l-4 border-l-red-500',
    bgClass: 'bg-red-50/50 dark:bg-red-950/30',
    overdueClass: 'text-red-600 dark:text-red-400',
    overdueIcon: '🔥',
  },
};

export function getTicketVisibility(ticket: {
  status: string;
  isOverdue?: boolean;
  overdueSeverity?: OverdueSeverity;
}): TicketVisibility {
  const status = (ticket.status as TicketStatus) || 'OPEN';
  const base = STATUS_VISIBILITY[status] || STATUS_VISIBILITY.OPEN;
  if (status === 'CLOSED') return base;
  if (ticket.isOverdue && ticket.overdueSeverity) {
    const override = OVERDUE_VISIBILITY[ticket.overdueSeverity];
    return { ...base, ...override };
  }
  return base;
}

export const PRIORITY_DOT: Record<string, string> = {
  URGENT: 'bg-red-500',
  HIGH:   'bg-orange-400',
  MEDIUM: 'bg-blue-400',
  LOW:    'bg-green-400',
};

export function computeOverdueDisplay(
  dueAt: string | null | undefined,
  status: string,
  scheduledEndAt?: string | null,
): { isOverdue: boolean; display: string; severity: OverdueSeverity | null } {
  const effectiveDue = scheduledEndAt || dueAt;
  if (!effectiveDue || ['DONE', 'CLOSED'].includes(status)) {
    return { isOverdue: false, display: '', severity: null };
  }
  const diffMinutes = Math.floor((Date.now() - new Date(effectiveDue).getTime()) / 60000);
  if (diffMinutes <= 0) return { isOverdue: false, display: '', severity: null };

  let display = '';
  let severity: OverdueSeverity = 'orange';

  if (diffMinutes < 60) {
    display = `${diffMinutes}m overdue`;
    severity = 'orange';
  } else if (diffMinutes < 240) {
    const h = Math.floor(diffMinutes / 60);
    const m = diffMinutes % 60;
    display = m > 0 ? `${h}h ${m}m overdue` : `${h}h overdue`;
    severity = 'deep-orange';
  } else {
    const d = Math.floor(diffMinutes / 1440);
    const h = Math.floor((diffMinutes % 1440) / 60);
    display = d > 0 ? (h > 0 ? `${d}d ${h}h overdue` : `${d}d overdue`) : `${h}h overdue`;
    severity = 'red';
  }

  return { isOverdue: true, display, severity };
}
