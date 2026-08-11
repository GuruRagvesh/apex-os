// Priority presentation — cross-domain, not feature-owned.
//
// The Prisma `Priority` enum (LOW/MEDIUM/HIGH/URGENT) backs BOTH the Ticket and
// the Project model. Projects do not borrow ticket vocabulary: they have their
// own first-class `priority` field on the same enum. So these labels and colours
// present a shared business enum and belong to no single feature.
//
// That is why they are here rather than in operations/tickets, and why they are
// NOT in shared/contracts — that folder is types only, no runtime code.
// Moved verbatim from frontend/lib/utils.ts.

export const PRIORITY_LABELS: Record<string, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
};

export const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
  MEDIUM: 'apex-status-open',
  HIGH: 'apex-status-progress',
  URGENT: 'bg-red-600 text-white shadow-[0_0_8px_rgba(220,38,38,0.4)]',
};
