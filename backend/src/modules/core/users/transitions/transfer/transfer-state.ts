import { createHash } from 'crypto';
import { fromZonedTime } from 'date-fns-tz';
import { addDays, dateOnly } from '../transitions-codes';

/**
 * What a transfer would touch, read in one place so the preview, the confirm
 * re-check and the activation re-check all see the same thing (correction 1).
 *
 * The fingerprint is a canonical SHA-256 over ids and states only: any new
 * pending leave, correction, change request, review ticket, membership,
 * hierarchy row or exit case between preview and confirm (or between
 * scheduling and activation) changes it, and a stale confirm or activation is
 * refused rather than applying different data. Presence fields such as
 * lastActiveAt are deliberately left out.
 */

export const OPEN_TICKET_STATUSES = ['PENDING_APPROVAL', 'OPEN', 'IN_PROGRESS', 'REVIEW'] as const;
export const UNRESOLVED_CORRECTION_STATUSES = ['PENDING', 'MANAGER_APPROVED', 'STALE_REVIEW_REQUIRED'] as const;

export interface TransferPlan {
  toDepartmentId: string | null;
  toRoleId: string;
  /** Overrides for the new attendance profile (ids only). */
  profileOverrides?: Partial<Record<'assignedShiftId' | 'assignedLeavePolicyId' | 'assignedHolidayCalendarId' | 'assignedWeeklyOffPolicyId' | 'assignedAttendanceLocationId', string | null>>;
  /** Optional new EMPLOYEE-scope primary Team Lead / Manager. */
  newTeamLeadId?: string | null;
  newManagerId?: string | null;
}

export interface TransferState {
  user: { id: string; name: string; departmentId: string | null; roleId: string; roleName: string; roleLevel: number; isHR: boolean; isActive: boolean; employmentState: string | null };
  fromDepartment: { id: string; name: string } | null;
  toDepartment: { id: string; name: string } | null;
  fromRole: { id: string; name: string; level: number };
  toRole: { id: string; name: string; level: number } | null;
  hierarchyAsSubject: Array<{ id: string; scope: string; role: string; assigneeUserId: string }>;
  hierarchyAsAssignee: Array<{ id: string; scope: string; role: string; subjectUserId: string | null; departmentId: string | null }>;
  profile: { id: string; effectiveFrom: string; assignedShiftId: string | null; assignedLeavePolicyId: string | null; assignedHolidayCalendarId: string | null; assignedWeeklyOffPolicyId: string | null; assignedAttendanceLocationId: string | null } | null;
  ownPendingLeave: Array<{ id: string; routingSnapshotId: string | null; startDate: string; endDate: string }>;
  leaveApprovalsRoutedToUser: Array<{ id: string; userId: string }>;
  ownCorrections: Array<{ id: string; date: string; status: string }>;
  correctionsAwaitingUser: Array<{ id: string; userId: string }>;
  reviewTickets: Array<{ id: string; title: string; type: string; submittedAt: string | null; approverId: string | null }>;
  ownedTickets: Array<{ id: string; status: string }>;
  assignedTickets: Array<{ id: string; status: string }>;
  coAssignedTickets: Array<{ id: string; status: string }>;
  projectMemberships: Array<{ id: string; projectId: string }>;
  teamMemberships: Array<{ id: string; teamId: string }>;
  pendingChangeRequests: Array<{ id: string; status: string }>;
  openExitCaseId: string | null;
}

export async function gatherTransferState(db: any, userId: string, plan: Pick<TransferPlan, 'toDepartmentId' | 'toRoleId'>, now: Date): Promise<TransferState | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, departmentId: true, roleId: true, isHR: true, isActive: true, employmentState: true, isSystemAccount: true, role: { select: { id: true, name: true, level: true } }, department: { select: { id: true, name: true } } },
  });
  if (!user || user.isSystemAccount) return null;
  const openAt = { OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] };
  const [
    toDepartment, toRole, asSubject, asAssignee, profile, ownLeave, routedLeave, ownCorr, corrForUser,
    review, owned, assigned, coAssigned, projects, teams, changeReqs, exitCase,
  ] = await Promise.all([
    plan.toDepartmentId ? db.department.findUnique({ where: { id: plan.toDepartmentId }, select: { id: true, name: true } }) : null,
    db.role.findUnique({ where: { id: plan.toRoleId }, select: { id: true, name: true, level: true } }),
    db.hierarchyAssignment.findMany({ where: { subjectUserId: userId, ...openAt }, select: { id: true, scope: true, role: true, assigneeUserId: true }, orderBy: { id: 'asc' } }),
    db.hierarchyAssignment.findMany({ where: { assigneeUserId: userId, ...openAt }, select: { id: true, scope: true, role: true, subjectUserId: true, departmentId: true }, orderBy: { id: 'asc' } }),
    db.employeeAttendanceProfile.findFirst({
      where: { userId, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: dateOnly(now.toISOString().slice(0, 10)) } }] },
      orderBy: { effectiveFrom: 'desc' },
      select: { id: true, effectiveFrom: true, assignedShiftId: true, assignedLeavePolicyId: true, assignedHolidayCalendarId: true, assignedWeeklyOffPolicyId: true, assignedAttendanceLocationId: true },
    }),
    db.leaveRequest.findMany({ where: { userId, status: 'PENDING' }, select: { id: true, routingSnapshotId: true, startDate: true, endDate: true }, orderBy: { id: 'asc' } }),
    db.leaveRequest.findMany({ where: { status: 'PENDING', userId: { not: userId }, routingSnapshot: { resolvedApproverId: userId } }, select: { id: true, userId: true }, orderBy: { id: 'asc' } }),
    db.attendanceRegularization.findMany({ where: { userId, status: { in: UNRESOLVED_CORRECTION_STATUSES as any } }, select: { id: true, date: true, status: true }, orderBy: { id: 'asc' } }),
    db.attendanceRegularization.findMany({
      where: { userId: { not: userId }, status: { in: UNRESOLVED_CORRECTION_STATUSES as any }, OR: [{ managerApproverId: userId }, { hrApproverId: userId }] },
      select: { id: true, userId: true }, orderBy: { id: 'asc' },
    }),
    db.ticket.findMany({
      where: { status: 'REVIEW', type: { not: 'QUERY' }, OR: [{ assignedToId: userId }, { assignees: { some: { userId } } }] },
      select: { id: true, title: true, type: true, submittedAt: true, approverId: true }, orderBy: { id: 'asc' },
    }),
    db.ticket.findMany({ where: { createdById: userId, status: { in: OPEN_TICKET_STATUSES as any } }, select: { id: true, status: true }, orderBy: { id: 'asc' }, take: 500 }),
    db.ticket.findMany({ where: { assignedToId: userId, status: { in: OPEN_TICKET_STATUSES as any } }, select: { id: true, status: true }, orderBy: { id: 'asc' }, take: 500 }),
    db.ticket.findMany({ where: { assignees: { some: { userId } }, assignedToId: { not: userId }, status: { in: OPEN_TICKET_STATUSES as any } }, select: { id: true, status: true }, orderBy: { id: 'asc' }, take: 500 }),
    db.projectMember.findMany({ where: { userId }, select: { id: true, projectId: true }, orderBy: { id: 'asc' } }),
    db.teamMember.findMany({ where: { userId }, select: { id: true, teamId: true }, orderBy: { id: 'asc' } }),
    db.employeeProfileChangeRequest.findMany({
      where: { targetUserId: userId, OR: [{ status: { startsWith: 'PENDING' } }, { status: 'AWAITING_EMPLOYEE_CONFIRMATION' }] },
      select: { id: true, status: true }, orderBy: { id: 'asc' },
    }),
    db.exitCase.findFirst({ where: { userId, state: { in: ['NOTICE_RUNNING', 'CLEARANCE_IN_PROGRESS', 'CLEARED'] } }, select: { id: true } }),
  ]);
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  return {
    user: { id: user.id, name: user.name, departmentId: user.departmentId, roleId: user.roleId, roleName: user.role.name, roleLevel: user.role.level, isHR: user.isHR, isActive: user.isActive, employmentState: user.employmentState ?? null },
    fromDepartment: user.department ?? null,
    toDepartment: toDepartment ?? null,
    fromRole: user.role,
    toRole: toRole ?? null,
    hierarchyAsSubject: asSubject,
    hierarchyAsAssignee: asAssignee,
    profile: profile ? { ...profile, effectiveFrom: day(profile.effectiveFrom)! } : null,
    ownPendingLeave: ownLeave.map((l: any) => ({ id: l.id, routingSnapshotId: l.routingSnapshotId, startDate: day(l.startDate)!, endDate: day(l.endDate)! })),
    leaveApprovalsRoutedToUser: routedLeave,
    ownCorrections: ownCorr.map((c: any) => ({ id: c.id, date: day(c.date)!, status: c.status })),
    correctionsAwaitingUser: corrForUser,
    reviewTickets: review.map((t: any) => ({ id: t.id, title: t.title, type: t.type, submittedAt: t.submittedAt ? t.submittedAt.toISOString() : null, approverId: t.approverId })),
    ownedTickets: owned,
    assignedTickets: assigned,
    coAssignedTickets: coAssigned,
    projectMemberships: projects,
    teamMemberships: teams,
    pendingChangeRequests: changeReqs,
    openExitCaseId: exitCase?.id ?? null,
  };
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
}

/** Canonical fingerprint of the state AND the plan applied to it. */
export function transferFingerprint(state: TransferState, plan: TransferPlan): string {
  const material = {
    v: 'transfer-fp-v1',
    user: state.user,
    to: { dept: state.toDepartment?.id ?? null, role: state.toRole ? { id: state.toRole.id, level: state.toRole.level } : null },
    plan: { toDepartmentId: plan.toDepartmentId ?? null, toRoleId: plan.toRoleId, profileOverrides: plan.profileOverrides ?? {}, newTeamLeadId: plan.newTeamLeadId ?? null, newManagerId: plan.newManagerId ?? null },
    hs: state.hierarchyAsSubject, ha: state.hierarchyAsAssignee, profile: state.profile,
    leave: state.ownPendingLeave, routed: state.leaveApprovalsRoutedToUser.map((l) => l.id),
    corr: state.ownCorrections.map((c) => [c.id, c.status]), corrFor: state.correctionsAwaitingUser.map((c) => c.id),
    review: state.reviewTickets.map((t) => [t.id, t.submittedAt, t.approverId]),
    tickets: [state.ownedTickets, state.assignedTickets, state.coAssignedTickets].map((l) => l.map((t) => t.id)),
    projects: state.projectMemberships.map((p) => p.id), teams: state.teamMemberships.map((t) => t.id),
    cr: state.pendingChangeRequests.map((c) => [c.id, c.status]), exit: state.openExitCaseId,
  };
  return createHash('sha256').update(canonical(material)).digest('hex');
}

/**
 * Role capabilities shown in the permission delta. The authority model is
 * role-based in code, so this is the human-readable summary of what each base
 * role can do; isHR is a separate flag that a transfer does not change.
 */
export const ROLE_CAPABILITIES: Record<string, string[]> = {
  SUPER_ADMIN: ['System settings and rollout switches', 'User administration, archive and permanent delete', 'Company-wide tickets, leave and attendance', 'Compliance: retention and legal holds', 'F&F release and adjustment approval'],
  ADMIN: ['User administration, archive and permanent delete', 'Company-wide tickets, leave and attendance', 'Compliance: retention and legal holds', 'F&F release and adjustment approval'],
  MANAGER: ['Department ticket review and approval', 'Department leave approval', 'Department team visibility'],
  TEAM_LEAD: ['Team ticket review and approval', 'Team leave approval', 'Team visibility'],
  EMPLOYEE: ['Own tickets, leave and attendance'],
  INTERN: ['Own tickets and attendance (limited status changes)'],
};

export function permissionDelta(fromRole: string, toRole: string | null): { gained: string[]; lost: string[] } {
  if (!toRole || toRole === fromRole) return { gained: [], lost: [] };
  const a = new Set(ROLE_CAPABILITIES[fromRole] ?? []);
  const b = new Set(ROLE_CAPABILITIES[toRole] ?? []);
  return { gained: [...b].filter((x) => !a.has(x)), lost: [...a].filter((x) => !b.has(x)) };
}

/** Start of a company day as a UTC instant. */
export function companyDayStartAt(day: string, timezone: string): Date {
  return fromZonedTime(`${day}T00:00:00.000`, timezone);
}

/**
 * Why `day` is not clean for an immediate transfer: attendance, punch
 * evidence, a work session, a daily row, a waiting phone handoff, a pending
 * correction for that day, or a finalized/sent payroll month. Empty = clean.
 */
export async function dayActivity(db: any, userId: string, day: string, timezone: string): Promise<string[]> {
  const start = companyDayStartAt(day, timezone);
  const end = companyDayStartAt(addDays(day, 1), timezone);
  const d = dateOnly(day);
  const [events, evidence, sessions, daily, handoffs, corrections, month] = await Promise.all([
    db.attendanceEvent.count({ where: { userId, timestamp: { gte: start, lt: end } } }),
    db.attendancePunchEvidence.count({ where: { userId, businessDate: d } }),
    db.workSession.count({ where: { userId, date: d } }),
    db.dailyAttendance.count({ where: { userId, date: d } }),
    db.attendancePunchHandoff.count({ where: { userId, status: 'WAITING' } }),
    db.attendanceRegularization.count({ where: { userId, date: d, status: { in: UNRESOLVED_CORRECTION_STATUSES as any } } }),
    db.attendanceMonthClose.findUnique({ where: { month: day.slice(0, 7) }, select: { status: true } }),
  ]);
  const out: string[] = [];
  if (events > 0) out.push('ATTENDANCE_EVENT');
  if (evidence > 0) out.push('PUNCH_EVIDENCE');
  if (sessions > 0) out.push('WORK_SESSION');
  if (daily > 0) out.push('DAILY_ATTENDANCE');
  if (handoffs > 0) out.push('PHONE_HANDOFF_WAITING');
  if (corrections > 0) out.push('PENDING_CORRECTION');
  if (month && (month.status === 'FINALIZED' || month.status === 'SENT')) out.push('PAYROLL_MONTH_CLOSED');
  return out;
}
