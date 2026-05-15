export type TicketStatus   = 'OPEN' | 'IN_PROGRESS' | 'PENDING_APPROVAL' | 'DONE' | 'CLOSED' | 'REJECTED';
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface Ticket {
  id:            string;
  ticketId:      string;
  title:         string;
  description:   string;
  status:        TicketStatus;
  priority:      TicketPriority;
  createdAt:     string;
  updatedAt:     string;
  dueDate?:      string;
  resolvedAt?:   string;
  category?:     string;
  tags?:         string[];
  createdBy?:    { id: string; name: string; avatar?: string };
  assignedTo?:   { id: string; name: string; avatar?: string };
  department?:   { id: string; name: string; color: string };
  _count?:       { comments: number; attachments: number };
}

export interface TicketComment {
  id:        string;
  content:   string;
  createdAt: string;
  author:    { id: string; name: string; avatar?: string };
}

export interface TicketHistory {
  id:        string;
  field:     string;
  oldValue:  string | null;
  newValue:  string | null;
  changedAt: string;
  changedBy: { id: string; name: string };
}
