import { api, unwrap as r } from '@apex/shared-auth';

/**
 * Phase 4 typed client: transfers, exit, clearance, F&F, retention, legal
 * holds. Every mutation takes an idempotency key that the CALLER generates once
 * per form submit (newKey) and reuses on retry, so a double click or a retried
 * request cannot duplicate an operation.
 */

export const newKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const n = (Math.random() * 16) | 0;
        return (c === 'x' ? n : (n & 0x3) | 0x8).toString(16);
      });

export type CapabilityName = 'transfer' | 'exit' | 'compliance' | 'retentionDefaultDeny' | 'payrollAck';
export type Capabilities = Record<CapabilityName, { enabled: boolean; switchOn: boolean; schemaReady: boolean }>;

// ── Transfers ──
export interface TransferPlanInput {
  toDepartmentId: string | null;
  toRoleId: string;
  newTeamLeadId?: string | null;
  newManagerId?: string | null;
}
export interface TransferPreview {
  fingerprint: string;
  user: { id: string; name: string };
  department: { from: { id: string; name: string } | null; to: { id: string; name: string } | null };
  role: { from: { id: string; name: string }; to: { id: string; name: string } | null };
  hierarchy: { currentTeamLeadId: string | null; currentManagerId: string | null; asSubject: unknown[]; asAssigneeForReview: unknown[] };
  attendanceProfile: { id: string } | null;
  pendingLeave: Array<{ id: string; startDate: string; endDate: string }>;
  leaveApprovalsRoutedToThem: number;
  corrections: { own: unknown[]; awaitingTheirApproval: number };
  ticketsWaitingForReview: Array<{ id: string; title: string; type: string }>;
  tickets: { owned: number; assigned: number; coAssigned: number };
  projects: number;
  teams: number;
  pendingChangeRequests: number;
  openExitCaseId: string | null;
  permissions: { gained: string[]; lost: string[] };
  today: string;
  canApplyToday: boolean;
  todayBlockers: string[];
  earliestScheduledDay: string;
}
export interface TransferView {
  id: string;
  userId: string;
  status: 'SCHEDULED' | 'REVIEW_REQUIRED' | 'COMPLETED' | 'CANCELLED' | 'FAILED';
  effectiveOn: string;
  appliedAt: string | null;
  fromDepartment: { id: string; name: string | null } | null;
  toDepartment: { id: string; name: string | null } | null;
  fromRole: { id: string; name: string | null };
  toRole: { id: string; name: string | null };
  employee?: { id: string; name: string; employeeId: string | null };
  reason?: string | null;
  reviewReasonCode?: string | null;
  impacts?: Array<{ id: string; kind: string; entityType: string | null; entityId: string; action: string; reviewStatus: string }>;
}

export const transitionsApi = {
  capabilities: (): Promise<Capabilities> => r(api.get('/transitions/capabilities')),
  setCapability: (capability: CapabilityName, enabled: boolean): Promise<Capabilities> => r(api.put(`/transitions/capabilities/${capability}`, { enabled })),

  previewTransfer: (userId: string, plan: TransferPlanInput): Promise<TransferPreview> => r(api.post(`/transitions/transfers/preview/${userId}`, plan)),
  confirmTransfer: (userId: string, plan: TransferPlanInput, o: { fingerprint: string; idempotencyKey: string; effectiveOn?: string; reason?: string }): Promise<TransferView> =>
    r(api.post(`/transitions/transfers/confirm/${userId}`, { ...plan, ...o })),
  reconfirmTransfer: (id: string, plan: TransferPlanInput, o: { fingerprint: string; idempotencyKey: string; effectiveOn?: string }): Promise<TransferView> =>
    r(api.post(`/transitions/transfers/${id}/reconfirm`, { ...plan, ...o })),
  cancelTransfer: (id: string, reason: string, idempotencyKey: string): Promise<TransferView> => r(api.post(`/transitions/transfers/${id}/cancel`, { reason, idempotencyKey })),
  markImpactReviewed: (id: string) => r(api.post(`/transitions/transfer-impacts/${id}/reviewed`)),
  transferReview: (params?: { page?: number; status?: string }): Promise<{ total: number; items: TransferView[] }> => r(api.get('/transitions/transfers', { params })),
  transferHistory: (userId: string): Promise<TransferView[]> => r(api.get(`/transitions/users/${userId}/transfers`)),

  // ── Exit ──
  exitList: (params?: { page?: number; state?: string }) => r<any>(api.get('/transitions/exits', { params })),
  exitForUser: (userId: string): Promise<{ cases: ExitTimeline[]; employmentPeriod?: { probationStatus: string | null; probationVerifiedAt: string | null } | null }> => r(api.get(`/transitions/users/${userId}/exit`)),
  verifyProbation: (userId: string, probationStatus: 'PROBATION' | 'CONFIRMED', idempotencyKey: string) =>
    r(api.post(`/transitions/users/${userId}/probation-verification`, { probationStatus, idempotencyKey })),
  startExit: (userId: string, body: { resignedOn?: string; backdateReason?: string; backdateReference?: string; idempotencyKey: string }): Promise<ExitTimeline> => r(api.post(`/transitions/users/${userId}/exit`, body)),
  adjustNotice: (id: string, body: { source?: string; noticeDays?: number; reason?: string; reference?: string; waive?: boolean; idempotencyKey: string }): Promise<ExitTimeline> => r(api.post(`/transitions/exits/${id}/notice`, body)),
  withdraw: (id: string, body: { reason?: string; idempotencyKey: string }): Promise<ExitTimeline> => r(api.post(`/transitions/exits/${id}/withdraw`, body)),

  // ── Clearance ──
  myClearance: (): Promise<Array<ClearanceItem & { employee: { id: string; name: string | null; employeeId: string | null }; lastWorkingDay: string }>> => r(api.get('/transitions/clearance/mine')),
  updateClearance: (itemId: string, body: { action: 'START' | 'DONE' | 'REOPEN' | 'WAIVE' | 'NOT_APPLICABLE' | 'REASSIGN'; evidenceRef?: string; reason?: string; ownerId?: string; idempotencyKey: string }): Promise<ClearanceItem> =>
    r(api.post(`/transitions/clearance/${itemId}`, body)),

  // ── F&F ──
  releaseFnf: (exitCaseId: string, body: { releaseReference: string; idempotencyKey: string }) => r(api.post(`/transitions/exits/${exitCaseId}/fnf/release`, body)),
  requestAdjustment: (exitCaseId: string, body: Record<string, unknown> & { idempotencyKey: string }) => r(api.post(`/transitions/exits/${exitCaseId}/fnf/adjustments`, body)),
  decideAdjustment: (requestId: string, body: { decision: 'APPROVE' | 'REJECT'; reason?: string }) => r(api.post(`/transitions/fnf/adjustments/${requestId}/decision`, body)),
  cancelAdjustment: (requestId: string) => r(api.delete(`/transitions/fnf/adjustments/${requestId}`)),

  // ── Compliance ──
  retention: (): Promise<RetentionOverview> => r(api.get('/compliance/retention')),
  proposeRetention: (body: Record<string, unknown> & { idempotencyKey: string }) => r(api.post('/compliance/retention/proposals', body)),
  decideRetention: (id: string, body: { decision: 'APPROVE' | 'REJECT'; reason?: string }) => r(api.post(`/compliance/retention/proposals/${id}/decision`, body)),
  cancelRetention: (id: string) => r(api.delete(`/compliance/retention/proposals/${id}`)),
  holds: (params?: { status?: string; userId?: string }): Promise<HoldView[]> => r(api.get('/compliance/legal-holds', { params })),
  requestHold: (userId: string, body: { reasonCode: string; notes?: string; reference?: string; idempotencyKey: string }) => r(api.post(`/compliance/users/${userId}/legal-holds`, body)),
  holdAction: (id: string, action: 'confirm' | 'reject' | 'withdraw' | 'release' | 'adopt', body: { reason?: string } = {}) => r(api.post(`/compliance/legal-holds/${id}/${action}`, body)),
  restriction: (userId: string): Promise<{ deletionRestricted: boolean }> => r(api.get(`/compliance/users/${userId}/restriction`)),
};

export interface ClearanceItem {
  id: string;
  exitCaseId?: string;
  category: string;
  label: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'WAIVED' | 'NOT_APPLICABLE' | 'CANCELLED';
  ownerId?: string | null;
  ownerCapability?: string | null;
  ownerNeeded: boolean;
  evidenceRequired?: boolean;
  evidenceRef?: string | null;
  completedAt?: string | null;
  waiverReason?: string | null;
}

export interface FnfStaff {
  id: string;
  state: 'NOT_STARTED' | 'ON_HOLD_REVIEW_REQUIRED' | 'READY_FOR_RELEASE' | 'RELEASED' | 'CANCELLED';
  holdReason?: string | null;
  deadlineOn: string;
  releasedAt?: string | null;
  releaseReference?: string | null;
  adjustments: Array<{ id: string; kind: string; direction: 'DEBIT' | 'CREDIT'; amount: string; currency: string; reasonCode: string; reference?: string; note?: string | null; reversesId?: string | null; reason?: string; approvedOn?: string }>;
  requests?: Array<{ id: string; kind: string; direction: string; amount: string; currency: string; reasonCode: string; status: string; reference?: string; note?: string | null; requestedById: string; reversesId?: string | null; adjustmentId?: string | null }>;
}

export interface ExitTimeline {
  id: string;
  userId: string;
  employee: { id: string; name: string; employeeId: string | null };
  state: 'NOTICE_RUNNING' | 'CLEARANCE_IN_PROGRESS' | 'CLEARED' | 'WITHDRAWN' | 'COMPLETED';
  resignedOn: string;
  noticeDays: number;
  noticeSource: string;
  lastWorkingDay: string;
  separatedAt: string | null;
  canWithdraw: boolean;
  withdrawalClosesAt: string;
  clearance: ClearanceItem[];
  settlement: FnfStaff | null;
  events: Array<{ id: string; action: string; toState?: string | null; timestamp: string }>;
}

export interface RetentionOverview {
  rules: Array<{ category: string; status: string | null; retentionMonths: number | null; noExpiry: boolean; version: number; policyReference: string | null }>;
  proposals: Array<{ id: string; category: string; action: string; retentionMonths: number | null; noExpiry: boolean; policyReference: string | null; reason: string; status: string; proposedById: string; proposedAt: string; decisionReason?: string | null }>;
  versions: Array<{ id: string; category: string; version: number; status: string; retentionMonths: number | null; noExpiry: boolean; approvedAt: string }>;
  readiness: { ready: boolean; defaultDenyOn: boolean; categories: Array<{ category: string; health: string; version: number | null }> };
}

export interface HoldView {
  id: string;
  userId: string;
  status: string;
  reasonCode: string;
  blocksDeletion: boolean;
  requestedById?: string | null;
  requestedAt?: string | null;
  notes?: string | null;
  reference?: string | null;
  employee?: { id: string; name: string; employeeId: string | null } | null;
}

/** A readable, calm sentence for a coded refusal when no remediation dialog applies. */
export function messageFor(err: any, fallback = 'Something went wrong. Nothing was changed.'): string {
  return err?.message && typeof err.message === 'string' && !/^Request failed/.test(err.message) ? err.message : fallback;
}
