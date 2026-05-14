import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'bg-slate-100 text-slate-700',
  MEDIUM: 'bg-blue-100 text-blue-700',
  HIGH: 'bg-orange-100 text-orange-700',
  URGENT: 'bg-red-100 text-red-700',
};

export const STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-yellow-100 text-yellow-700',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  REVIEW: 'bg-purple-100 text-purple-700',
  DONE: 'bg-green-100 text-green-700',
  CLOSED: 'bg-slate-100 text-slate-700',
};

export const CATEGORY_COLORS: Record<string, string> = {
  IT: 'bg-indigo-100 text-indigo-700',
  FACILITIES: 'bg-amber-100 text-amber-700',
  HR: 'bg-pink-100 text-pink-700',
  OPERATIONS: 'bg-emerald-100 text-emerald-700',
  PROJECT: 'bg-cyan-100 text-cyan-700',
  ADMIN: 'bg-gray-100 text-gray-700',
};

export const STATUS_LABELS: Record<string, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  REVIEW: 'Under Review',
  DONE: 'Done',
  CLOSED: 'Closed',
  TODO: 'To Do',
};

export const PRIORITY_LABELS: Record<string, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
};

export const CATEGORY_LABELS: Record<string, string> = {
  IT: 'IT',
  FACILITIES: 'Facilities',
  HR: 'Human Resources',
  OPERATIONS: 'Operations',
  PROJECT: 'Project',
  ADMIN: 'Admin',
};

export const PROJECT_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  ON_HOLD: 'On Hold',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const LEAVE_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

export const PROJECT_STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  ON_HOLD: 'bg-yellow-100 text-yellow-700',
  COMPLETED: 'bg-blue-100 text-blue-700',
  CANCELLED: 'bg-red-100 text-red-700',
};

export const LEAVE_STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-700',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-700',
};

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export function formatRelativeTime(date: string | Date): string {
  const now = new Date();
  const d = new Date(date);
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(date);
}

// Department accent colours — used for left-border on ticket rows & top-border on kanban cards
export const DEPT_COLORS: Record<string, string> = {
  'IT':                     '#3b82f6',
  'Facilities':             '#f59e0b',
  'HR':                     '#ec4899',
  'Operations':             '#10b981',
  'Finance':                '#8b5cf6',
  'AI & R&D':               '#6366f1',
  'ID Team':                '#14b8a6',
  'Editors Team':           '#f97316',
  'Content Sales':          '#84cc16',
  'QC Team':                '#ef4444',
  'Marketing':              '#a855f7',
  'Retail Business':        '#06b6d4',
  'Corporate Training':     '#f59e0b',
  'AI & Media Production':  '#8b5cf6',
  'Accounts':               '#10b981',
};
