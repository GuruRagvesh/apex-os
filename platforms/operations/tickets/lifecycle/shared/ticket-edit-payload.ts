// Operations Tickets — the Edit Ticket request body.
//
// The edit dialog changes only what it shows: title, description, priority,
// due date and the estimate. A ticket's type (TASK / QUERY / HELP) is fixed at
// creation and decides its workflow, so it is never sent; neither is the hidden
// category or the legacy estimatedTime (hours) column.

export interface TicketEditForm {
  title: string;
  description: string;
  priority: string;
  dueDate: string;
  estimatedMinutes: string;
}

export function buildTicketEditPayload(form: TicketEditForm): {
  title: string;
  description: string;
  priority: string;
  dueDate?: string;
  estimatedMinutes?: number;
} {
  const minutes = form.estimatedMinutes ? parseInt(form.estimatedMinutes, 10) : NaN;
  return {
    title: form.title.trim(),
    description: form.description,
    priority: form.priority,
    // Date only keeps the system convention (18:30 IST = 13:00 UTC).
    dueDate: form.dueDate ? (form.dueDate.includes('T') ? form.dueDate : `${form.dueDate}T13:00:00.000Z`) : undefined,
    estimatedMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : undefined,
  };
}
