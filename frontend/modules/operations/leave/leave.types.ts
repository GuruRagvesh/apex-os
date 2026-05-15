export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type LeaveType   = 'ANNUAL' | 'SICK' | 'EMERGENCY' | 'MATERNITY' | 'PATERNITY' | 'UNPAID' | 'OTHER';

export interface LeaveRequest {
  id:         string;
  type:       LeaveType;
  status:     LeaveStatus;
  startDate:  string;
  endDate:    string;
  reason:     string;
  createdAt:  string;
  updatedAt:  string;
  employee:   { id: string; name: string; avatar?: string; department?: { name: string } };
  approver?:  { id: string; name: string };
  reviewNote?: string;
}

export interface LeaveStats {
  total:     number;
  pending:   number;
  approved:  number;
  rejected:  number;
  cancelled: number;
  byType:    Record<LeaveType, number>;
}
