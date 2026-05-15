export const EVENTS = {
  TICKET_CREATED:  'ticket.created',
  TICKET_UPDATED:  'ticket.updated',
  TICKET_ASSIGNED: 'ticket.assigned',
  TICKET_OVERDUE:  'ticket.overdue',
  TICKET_RESOLVED: 'ticket.resolved',
  LEAVE_SUBMITTED: 'leave.submitted',
  LEAVE_APPROVED:  'leave.approved',
  LEAVE_REJECTED:  'leave.rejected',
  USER_CREATED:    'user.created',
} as const;

export type EventName = typeof EVENTS[keyof typeof EVENTS];
