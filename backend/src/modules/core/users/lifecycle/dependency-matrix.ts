/**
 * The user dependency matrix, as code.
 *
 * One handler per place a person can be referenced: every foreign key to
 * `users`, every column that holds a user id or employee code without one, and
 * the rows that exist only to describe the person. A schema test parses
 * schema.prisma and fails when a User relation or user-like column appears that
 * this file does not classify, so a future migration cannot open an orphan path.
 *
 * The same list drives four things, so they cannot drift apart:
 *   - the dependency inventory (counts, "no history", the data fingerprint);
 *   - the archive workbook (one sheet per handler group, all rows, no caps);
 *   - the retention gate (protected categories);
 *   - permanent deletion (handlers run in ARRAY ORDER inside one transaction).
 *
 * ORDER IS LOAD-BEARING. Append-only rows (punch evidence, workday notes) and
 * rows that point at the person's own work sessions are deleted before the
 * sessions, because the session foreign keys are ON DELETE SET NULL and the
 * append-only triggers refuse that UPDATE.
 *
 * Delete actions:
 *   DEL       the row belongs to the person
 *   REASSIGN  a required actor/owner column on a SHARED record moves to the
 *             non-login Deleted account principal -- never to a real person
 *   NULL      an optional reference on a shared record is cleared
 *   SCRUB     an exact structured identifier is overwritten with a placeholder
 *   NAME      a structured name field proven (by row ownership or an exact
 *             employee code) to belong to the person becomes "Deleted user"
 */

export type DeleteAction = 'DEL' | 'REASSIGN' | 'NULL' | 'SCRUB' | 'NAME';

/** Retention categories (retention-classification-v1). */
export type RetentionCategory = 'ATTENDANCE' | 'LEAVE';

export interface Subject {
  id: string;
  email: string;
  employeeId: string | null;
}

export interface MatrixContext {
  /** The Deleted account principal. */
  systemUserId: string;
  /** The permanent-delete operation running now (excluded from its own handlers). */
  operationId: string | null;
  now: Date;
}

export interface Handler {
  /** Unique: `<Model>.<field>` plus a qualifier when one column has two rules. */
  key: string;
  model: string;
  field: string;
  /** True when Prisma declares a relation from this column to User. */
  fk: boolean;
  holds: 'id' | 'employeeId';
  action: DeleteAction;
  /** Narrows the rows this handler owns (e.g. "other people's rows only"). */
  scope?: (u: Subject, ctx: MatrixContext) => Record<string, unknown>;
  /** Replaces the default `{ [field]: value }` match entirely. */
  where?: (u: Subject, ctx: MatrixContext) => Record<string, unknown>;
  /** Activity/history: a non-zero count means the person has history. */
  history: boolean;
  /** Protected by the retention gate. */
  retention?: RetentionCategory;
  /** The archive workbook sheet these rows belong to. */
  sheet: string;
  /** Rows protected by an append-only trigger: deleted only under the row-scoped exception. */
  appendOnly?: boolean;
  note: string;
}

const others = (u: Subject) => ({ userId: { not: u.id } });
const otherUsers = (u: Subject) => ({ id: { not: u.id } });

/** Prisma client delegate for a model name: `TicketTimeLog` -> `ticketTimeLog`. */
export function delegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

export const HANDLERS: Handler[] = [
  // ── 1. Append-only rows, first (their session FKs are ON DELETE SET NULL) ──
  { key: 'AttendancePunchEvidence.userId', model: 'AttendancePunchEvidence', field: 'userId', fk: true, holds: 'id', action: 'DEL', history: true, retention: 'ATTENDANCE', sheet: 'Punch Evidence', appendOnly: true, note: 'Append-only; deleted only under the row-scoped trigger exception.' },
  { key: 'WorkdayNote.userId', model: 'WorkdayNote', field: 'userId', fk: true, holds: 'id', action: 'DEL', history: true, retention: 'ATTENDANCE', sheet: 'Workday Notes', appendOnly: true, note: 'Append-only; deleted only under the row-scoped trigger exception.' },

  // ── 2. Rows that exist only to describe this person ───────────────────────
  {
    key: 'OperationalEvent.entityId[User]', model: 'OperationalEvent', field: 'entityId', fk: false, holds: 'id', action: 'DEL',
    where: (u) => ({ entityType: 'User', entityId: u.id }),
    history: false, sheet: 'Events About User', note: 'Lifecycle and audit events about the person; replaced by the non-PII receipt.',
  },
  {
    key: 'ActivityLog.entityId[User]', model: 'ActivityLog', field: 'entityId', fk: false, holds: 'id', action: 'DEL',
    where: (u) => ({ entityType: { in: ['User', 'user', 'USER'] }, entityId: u.id }),
    history: false, sheet: 'Activity About User', note: 'Sensitive-access logs about the person.',
  },
  {
    key: 'AppSetting.key[user-prefs]', model: 'AppSetting', field: 'key', fk: false, holds: 'id', action: 'DEL',
    where: (u) => ({ key: `user-prefs-${u.id}` }),
    history: false, sheet: 'Preferences', note: 'Saved UI preferences (setup-only when empty).',
  },

  // ── 3. The person's own rows, children before parents ─────────────────────
  { key: 'TicketTimeLog.userId', model: 'TicketTimeLog', field: 'userId', fk: true, holds: 'id', action: 'DEL', history: true, sheet: 'Ticket Time Logs', note: 'Ticket totals derive from the remaining logs.' },
  { key: 'MeetingParticipant.userId', model: 'MeetingParticipant', field: 'userId', fk: true, holds: 'id', action: 'NULL', history: true, sheet: 'Meeting Participation', note: 'Clears the deleted account reference while preserving the attendee row and its historical display-name snapshot.' },
  { key: 'TicketAssignee.userId', model: 'TicketAssignee', field: 'userId', fk: true, holds: 'id', action: 'DEL', history: true, sheet: 'Ticket Co-assignments', note: 'Open tickets were handled at archive.' },
  { key: 'TicketWatcher.userId', model: 'TicketWatcher', field: 'userId', fk: true, holds: 'id', action: 'DEL', history: true, sheet: 'Ticket Watching', note: 'Open-ticket watching was removed at archive.' },
  { key: 'Notification.userId', model: 'Notification', field: 'userId', fk: true, holds: 'id', action: 'DEL', history: true, sheet: 'Notifications', note: 'Own inbox.' },
  { key: 'PushSubscription.userId', model: 'PushSubscription', field: 'userId', fk: true, holds: 'id', action: 'DEL', history: false, sheet: 'Push Subscriptions', note: 'Removed at archive; any left are deleted.' },
  { key: 'ActivityLog.userId', model: 'ActivityLog', field: 'userId', fk: true, holds: 'id', action: 'DEL', history: true, sheet: 'Activity Logs', note: 'Own activity.' },
  { key: 'AttendancePunchHandoff.userId', model: 'AttendancePunchHandoff', field: 'userId', fk: true, holds: 'id', action: 'DEL', history: true, retention: 'ATTENDANCE', sheet: 'Punch Handoffs', note: 'Own phone handoffs.' },
  { key: 'DailyAttendance.userId', model: 'DailyAttendance', field: 'userId', fk: true, holds: 'id', action: 'DEL', history: true, retention: 'ATTENDANCE', sheet: 'Daily Attendance', note: 'Derived days.' },
  { key: 'AttendanceRegularization.userId', model: 'AttendanceRegularization', field: 'userId', fk: true, holds: 'id', action: 'DEL', history: true, retention: 'ATTENDANCE', sheet: 'Attendance Corrections', note: 'Cascades to correction screenshots (archived as bytes). Import rows pointing here are SET NULL by the FK.' },
  { key: 'AttendancePunchPhoto.userId', model: 'AttendancePunchPhoto', field: 'userId', fk: true, holds: 'id', action: 'DEL', history: true, retention: 'ATTENDANCE', sheet: 'Punch Photos', note: 'Bytes archived; original removed by cleanup.' },
  { key: 'AttendanceEvent.userId', model: 'AttendanceEvent', field: 'userId', fk: true, holds: 'id', action: 'DEL', history: true, retention: 'ATTENDANCE', sheet: 'Attendance Events', note: 'faceImageUrl bytes archived.' },
  { key: 'CompOffCredit.employeeId', model: 'CompOffCredit', field: 'employeeId', fk: true, holds: 'id', action: 'DEL', history: true, retention: 'LEAVE', sheet: 'Comp-Off Credits', note: 'Own credits.' },
  { key: 'BreakLog.userId', model: 'BreakLog', field: 'userId', fk: true, holds: 'id', action: 'DEL', history: true, retention: 'ATTENDANCE', sheet: 'Break Logs', note: 'Own breaks.' },
  { key: 'WorkSession.userId', model: 'WorkSession', field: 'userId', fk: true, holds: 'id', action: 'DEL', history: true, retention: 'ATTENDANCE', sheet: 'Work Sessions', note: 'After evidence and notes.' },
  { key: 'LeaveRequest.userId', model: 'LeaveRequest', field: 'userId', fk: true, holds: 'id', action: 'DEL', history: true, retention: 'LEAVE', sheet: 'Leave Requests', note: 'Pending leave was cancelled at archive.' },
  { key: 'UserWorkdayPolicyOverride.userId', model: 'UserWorkdayPolicyOverride', field: 'userId', fk: true, holds: 'id', action: 'DEL', history: true, sheet: 'Workday Override', note: 'Own override.' },
  { key: 'EmployeeAttendanceProfile.userId', model: 'EmployeeAttendanceProfile', field: 'userId', fk: true, holds: 'id', action: 'DEL', history: true, sheet: 'Attendance Profiles', note: 'Configuration, not an attendance record: not retention-protected. The initial profile is setup-only.' },
  { key: 'EmployeeDocument.userId', model: 'EmployeeDocument', field: 'userId', fk: true, holds: 'id', action: 'DEL', history: true, sheet: 'Documents', note: 'Bytes archived; original removed by cleanup.' },
  { key: 'DashboardWorkspace.userId', model: 'DashboardWorkspace', field: 'userId', fk: true, holds: 'id', action: 'DEL', history: false, sheet: 'Dashboard Workspace', note: 'Personal notes and shortcuts.' },
  { key: 'UserRoleAssignment.userId', model: 'UserRoleAssignment', field: 'userId', fk: true, holds: 'id', action: 'DEL', history: false, sheet: 'Memberships', note: 'Membership (the initial one is setup-only).' },
  { key: 'UserDepartmentMembership.userId', model: 'UserDepartmentMembership', field: 'userId', fk: true, holds: 'id', action: 'DEL', history: false, sheet: 'Memberships', note: 'Membership (the initial one is setup-only).' },
  { key: 'TeamMember.userId', model: 'TeamMember', field: 'userId', fk: true, holds: 'id', action: 'DEL', history: true, sheet: 'Memberships', note: 'Membership.' },
  { key: 'ProjectMember.userId', model: 'ProjectMember', field: 'userId', fk: true, holds: 'id', action: 'DEL', history: true, sheet: 'Memberships', note: 'Membership.' },
  { key: 'ManagerDeptAccess.managerId', model: 'ManagerDeptAccess', field: 'managerId', fk: true, holds: 'id', action: 'DEL', history: true, sheet: 'Memberships', note: 'Blocks archival while present.' },
  { key: 'EmployeeProfileChangeRequest.targetUserId', model: 'EmployeeProfileChangeRequest', field: 'targetUserId', fk: true, holds: 'id', action: 'DEL', history: true, sheet: 'Profile Change Requests', note: 'Requests about the person.' },
  { key: 'AttendanceRecoveryTombstone.employeeId', model: 'AttendanceRecoveryTombstone', field: 'employeeId', fk: false, holds: 'id', action: 'DEL', history: true, retention: 'ATTENDANCE', sheet: 'Recovery Tombstones', note: 'Tombstones of the person\'s own attendance.' },
  {
    key: 'UserLifecycleOperation.userId', model: 'UserLifecycleOperation', field: 'userId', fk: false, holds: 'id', action: 'DEL',
    scope: (_u, ctx) => (ctx.operationId ? { id: { not: ctx.operationId } } : {}),
    history: false, sheet: 'Lifecycle Operations', note: 'Lifecycle bookkeeping (no-history-v1 ignores it): earlier operations about the person; the running one is scrubbed by the service.',
  },
  { key: 'UserLegalHold.userId', model: 'UserLegalHold', field: 'userId', fk: false, holds: 'id', action: 'DEL', history: false, sheet: 'Legal Holds', note: 'Only released holds can exist here; an active hold blocks deletion.' },

  // ── 4. Shared records: reassign required actor/owner columns ──────────────
  { key: 'Ticket.createdById', model: 'Ticket', field: 'createdById', fk: true, holds: 'id', action: 'REASSIGN', history: true, sheet: 'Tickets Created', note: 'Shared ticket stays.' },
  { key: 'Meeting.organizerId', model: 'Meeting', field: 'organizerId', fk: true, holds: 'id', action: 'REASSIGN', history: true, sheet: 'Meetings Organized', note: 'Historical meeting stays; the required organizer reference moves to the Deleted account principal.' },
  { key: 'Meeting.counterpartyId', model: 'Meeting', field: 'counterpartyId', fk: true, holds: 'id', action: 'REASSIGN', history: true, sheet: 'Meeting Counterparties', note: 'Historical meeting stays; the required person-met-with reference moves to the Deleted account principal.' },
  { key: 'Comment.authorId', model: 'Comment', field: 'authorId', fk: true, holds: 'id', action: 'REASSIGN', history: true, sheet: 'Comments', note: 'Text kept.' },
  { key: 'TicketHistory.changedById', model: 'TicketHistory', field: 'changedById', fk: true, holds: 'id', action: 'REASSIGN', history: true, sheet: 'Ticket History', note: 'Shared audit.' },
  { key: 'OperationalEvent.actorId', model: 'OperationalEvent', field: 'actorId', fk: true, holds: 'id', action: 'REASSIGN', history: true, sheet: 'Events By User', note: 'Exact identifiers scrubbed from JSON separately.' },
  { key: 'EmployeeProfileChangeRequest.requestedById', model: 'EmployeeProfileChangeRequest', field: 'requestedById', fk: true, holds: 'id', action: 'REASSIGN', scope: (u) => ({ targetUserId: { not: u.id } }), history: true, sheet: 'Profile Change Requests', note: 'Requests the person raised for others.' },
  { key: 'AttendanceImportBatch.uploadedById', model: 'AttendanceImportBatch', field: 'uploadedById', fk: true, holds: 'id', action: 'REASSIGN', history: true, sheet: 'Attendance Imports', note: 'The system principal never approves, so the uploader != approver CHECK holds.' },
  { key: 'Lead.ownerId', model: 'Lead', field: 'ownerId', fk: true, holds: 'id', action: 'REASSIGN', history: true, sheet: 'CRM', note: 'Open leads block archival.' },
  { key: 'LeadActivity.createdById', model: 'LeadActivity', field: 'createdById', fk: true, holds: 'id', action: 'REASSIGN', history: true, sheet: 'CRM', note: 'Shared CRM.' },
  { key: 'FollowUp.createdById', model: 'FollowUp', field: 'createdById', fk: true, holds: 'id', action: 'REASSIGN', history: true, sheet: 'CRM', note: 'Shared CRM.' },
  { key: 'AttendanceRecoveryTombstone.deletedById', model: 'AttendanceRecoveryTombstone', field: 'deletedById', fk: false, holds: 'id', action: 'REASSIGN', scope: (u) => ({ employeeId: { not: u.id } }), history: true, sheet: 'Recovery Tombstones', note: 'Required column on other people\'s tombstones.' },
  { key: 'UserLifecycleOperation.actorId', model: 'UserLifecycleOperation', field: 'actorId', fk: false, holds: 'id', action: 'REASSIGN', scope: (u) => ({ OR: [{ userId: null }, { userId: { not: u.id } }] }), history: true, sheet: 'Lifecycle Operations', note: 'Operations the person ran on others.' },
  { key: 'UserArchiveSnapshot.createdById', model: 'UserArchiveSnapshot', field: 'createdById', fk: false, holds: 'id', action: 'REASSIGN', scope: (u) => ({ OR: [{ userId: null }, { userId: { not: u.id } }] }), history: true, sheet: 'Lifecycle Operations', note: 'Archives the person created of others.' },

  // ── 5. Shared records: clear optional references ──────────────────────────
  { key: 'Ticket.assignedToId', model: 'Ticket', field: 'assignedToId', fk: true, holds: 'id', action: 'NULL', history: true, sheet: 'Tickets Assigned', note: 'Open tickets were closed or re-homed at archive.' },
  { key: 'Ticket.approverId', model: 'Ticket', field: 'approverId', fk: true, holds: 'id', action: 'NULL', history: true, sheet: 'Tickets Approved', note: 'Pending approvals block archival.' },
  { key: 'Ticket.blockedById', model: 'Ticket', field: 'blockedById', fk: false, holds: 'id', action: 'NULL', history: true, sheet: 'Tickets Assigned', note: 'Who marked a ticket blocked.' },
  { key: 'Attachment.uploadedById', model: 'Attachment', field: 'uploadedById', fk: true, holds: 'id', action: 'NULL', history: true, sheet: 'Attachments Uploaded', note: 'Shared business object; file copied to the archive, original kept.' },
  { key: 'ReviewCycleLog.assigneeId', model: 'ReviewCycleLog', field: 'assigneeId', fk: true, holds: 'id', action: 'NULL', history: true, sheet: 'Review Cycles', note: 'Shared ticket audit.' },
  { key: 'ReviewCycleLog.reviewerId', model: 'ReviewCycleLog', field: 'reviewerId', fk: true, holds: 'id', action: 'NULL', history: true, sheet: 'Review Cycles', note: 'Shared ticket audit.' },
  { key: 'Team.teamLeadId', model: 'Team', field: 'teamLeadId', fk: true, holds: 'id', action: 'NULL', history: true, sheet: 'Memberships', note: 'Active team leadership blocks archival.' },
  { key: 'EmployeeProfileChangeRequest.currentApproverId', model: 'EmployeeProfileChangeRequest', field: 'currentApproverId', fk: true, holds: 'id', action: 'NULL', scope: (u) => ({ targetUserId: { not: u.id } }), history: true, sheet: 'Profile Change Requests', note: 'Pending approvals block archival.' },
  ...(['tlApproverId', 'managerApproverId', 'adminApproverId'] as const).map((field): Handler => ({
    key: `EmployeeProfileChangeRequest.${field}`, model: 'EmployeeProfileChangeRequest', field, fk: false, holds: 'id', action: 'NULL',
    scope: (u) => ({ targetUserId: { not: u.id } }), history: true, sheet: 'Profile Change Requests', note: 'Pending approvals block archival.',
  })),
  { key: 'AttendanceRegularization.createdById', model: 'AttendanceRegularization', field: 'createdById', fk: true, holds: 'id', action: 'NULL', scope: others, history: true, sheet: 'Attendance Corrections', note: 'Corrections entered for others.' },
  ...(['managerApproverId', 'hrApproverId'] as const).map((field): Handler => ({
    key: `AttendanceRegularization.${field}`, model: 'AttendanceRegularization', field, fk: false, holds: 'id', action: 'NULL',
    scope: others, history: true, sheet: 'Attendance Corrections', note: 'Pending corrections block archival.',
  })),
  { key: 'AttendanceMonthClose.finalizedById', model: 'AttendanceMonthClose', field: 'finalizedById', fk: true, holds: 'id', action: 'NULL', history: true, sheet: 'Payroll Months Finalized', note: 'Month stays closed.' },
  { key: 'AttendanceImportBatch.approvedById', model: 'AttendanceImportBatch', field: 'approvedById', fk: true, holds: 'id', action: 'NULL', history: true, sheet: 'Attendance Imports', note: 'Shared import audit.' },
  { key: 'AttendanceImportBatch.appliedById', model: 'AttendanceImportBatch', field: 'appliedById', fk: true, holds: 'id', action: 'NULL', history: true, sheet: 'Attendance Imports', note: 'Shared import audit.' },
  // NAME before NULL/SCRUB: ownership is proven by userId or the exact code.
  {
    key: 'AttendanceImportRow.rawName', model: 'AttendanceImportRow', field: 'rawName', fk: false, holds: 'id', action: 'NAME',
    where: (u) => ({ OR: [{ userId: u.id }, ...(u.employeeId ? [{ rawEmployeeId: { equals: u.employeeId, mode: 'insensitive' } }] : [])] }),
    history: true, sheet: 'Attendance Import Rows', note: 'Name cell of rows that belong to the person by id or exact code; never by name match.',
  },
  { key: 'AttendanceImportRow.userId', model: 'AttendanceImportRow', field: 'userId', fk: false, holds: 'id', action: 'NULL', history: true, sheet: 'Attendance Import Rows', note: 'Resolution pointer cleared.' },
  {
    key: 'AttendanceImportRow.rawEmployeeId', model: 'AttendanceImportRow', field: 'rawEmployeeId', fk: false, holds: 'employeeId', action: 'SCRUB',
    where: (u) => (u.employeeId ? { rawEmployeeId: { equals: u.employeeId, mode: 'insensitive' } } : { id: { in: [] } }),
    history: true, sheet: 'Attendance Import Rows', note: 'Exact employee code replaced; releases the code.',
  },
  { key: 'Requirement.ownerId', model: 'Requirement', field: 'ownerId', fk: true, holds: 'id', action: 'NULL', history: true, sheet: 'CRM', note: 'Shared CRM.' },
  { key: 'User.reportingManager', model: 'User', field: 'reportingManager', fk: false, holds: 'employeeId', action: 'NULL', scope: otherUsers, history: true, sheet: 'Reporting Lines', note: 'Active reports block archival.' },
  { key: 'User.teamLeadName', model: 'User', field: 'teamLeadName', fk: false, holds: 'employeeId', action: 'NULL', scope: otherUsers, history: true, sheet: 'Reporting Lines', note: 'Active members block archival.' },
  { key: 'LeaveRequest.managerApprovedById', model: 'LeaveRequest', field: 'managerApprovedById', fk: false, holds: 'id', action: 'NULL', scope: others, history: true, sheet: 'Leave Decisions', note: 'Pending approvals block archival.' },
  { key: 'LeaveRequest.hrApprovedById', model: 'LeaveRequest', field: 'hrApprovedById', fk: false, holds: 'id', action: 'NULL', scope: others, history: true, sheet: 'Leave Decisions', note: 'Pending approvals block archival.' },
  { key: 'LeaveRequest.approvedBy', model: 'LeaveRequest', field: 'approvedBy', fk: false, holds: 'id', action: 'NULL', scope: others, history: true, sheet: 'Leave Decisions', note: 'Decided leave.' },
  { key: 'LeaveRequest.rejectedBy', model: 'LeaveRequest', field: 'rejectedBy', fk: false, holds: 'id', action: 'NULL', scope: others, history: true, sheet: 'Leave Decisions', note: 'Decided leave.' },
  ...(['reportingManagerId', 'hrReviewerId'] as const).map((field): Handler => ({
    key: `EmployeeAttendanceProfile.${field}`, model: 'EmployeeAttendanceProfile', field, fk: false, holds: 'id', action: 'NULL',
    scope: others, history: true, sheet: 'Attendance Profiles (Others)', note: 'Active colleagues\' profiles block archival.',
  })),
  { key: 'EmployeeAttendanceProfile.updatedById', model: 'EmployeeAttendanceProfile', field: 'updatedById', fk: false, holds: 'id', action: 'NULL', scope: others, history: true, sheet: 'Attendance Profiles (Others)', note: 'Audit pointer.' },
  ...(['createdById', 'updatedById'] as const).map((field): Handler => ({
    key: `UserWorkdayPolicyOverride.${field}`, model: 'UserWorkdayPolicyOverride', field, fk: false, holds: 'id', action: 'NULL', scope: others, history: true, sheet: 'Policies Acted On', note: 'Audit pointer.',
  })),
  ...(['createdById', 'approvedById', 'updatedById'] as const).map((field): Handler => ({
    key: `AttendancePolicy.${field}`, model: 'AttendancePolicy', field, fk: false, holds: 'id', action: 'NULL', history: true, sheet: 'Policies Acted On', note: 'Policy kept.',
  })),
  ...(['createdById', 'approvedById'] as const).flatMap((field): Handler[] =>
    ['ShiftPolicy', 'HolidayCalendar', 'LeavePolicy'].map((model) => ({
      key: `${model}.${field}`, model, field, fk: false, holds: 'id', action: 'NULL', history: true, sheet: 'Policies Acted On', note: 'Policy kept.',
    })),
  ),
  ...(['createdById', 'approvedById', 'revokedById'] as const).map((field): Handler => ({
    key: `BusinessDayOverride.${field}`, model: 'BusinessDayOverride', field, fk: false, holds: 'id', action: 'NULL', history: true, sheet: 'Policies Acted On', note: 'Override kept.',
  })),
  { key: 'AppSetting.updatedBy', model: 'AppSetting', field: 'updatedBy', fk: false, holds: 'id', action: 'NULL', history: true, sheet: 'Policies Acted On', note: 'Audit pointer.' },
  { key: 'RetentionRule.approvedById', model: 'RetentionRule', field: 'approvedById', fk: false, holds: 'id', action: 'NULL', history: true, sheet: 'Policies Acted On', note: 'Rule kept.' },
  ...(['placedById', 'releasedById'] as const).map((field): Handler => ({
    key: `UserLegalHold.${field}`, model: 'UserLegalHold', field, fk: false, holds: 'id', action: 'NULL', scope: others, history: true, sheet: 'Policies Acted On', note: 'Hold kept.',
  })),
];

/**
 * Columns that look like user references but are not, or that the service
 * manages itself. Listed so the coverage test can tell "considered and
 * excluded" from "never considered".
 */
export const NOT_USER_REFERENCES: Record<string, string> = {
  'AttendancePolicy.supersededById': 'Points at the superseding policy version.',
  'ShiftPolicy.supersededById': 'Points at the superseding policy version.',
  'HolidayCalendar.supersededById': 'Points at the superseding policy version.',
  'LeavePolicy.supersededById': 'Points at the superseding policy version.',
  'OperationalEvent.actorRoleId': 'A role id.',
  'OperationalEvent.actorContext': 'A context label, not a person.',
  'Meeting.createdByRole': 'A role snapshot captured with the meeting, not a person reference.',
  'PushSubscription.userAgent': 'A browser string.',
  'TicketTimeLog.ownerType': 'An enum label.',
  'TicketTimeLog.pauseReason': 'An enum label.',
  'EmployeeProfileChangeRequest.managerDecision': 'A decision label.',
  'AttendancePunchEvidence.employeeProfileId': 'Points at an attendance profile.',
  'DailyAttendance.employeeProfileId': 'Points at an attendance profile.',
  'AttendanceRegularization.actorRoleAtEntry': 'A role label.',
  'LeadActivity.leadId': 'Points at a lead.',
  'FollowUp.leadId': 'Points at a lead.',
  'Requirement.leadId': 'Points at a lead.',
  'Deal.leadId': 'Points at a lead.',
  'AttendanceMonthClose.recipientEmail': 'A finance mailbox copied at send time, not an employee.',
  'User.userLocation': 'A location label.',
  'User.employeeId': 'The person\'s own code; deleted with the row.',
  'User.verifiedBy': 'NAME text about another person; no ownership proof, kept and counted.',
  'EmployeeDocument.verifiedBy': 'NAME text about another document; no ownership proof, kept and counted.',
  'UserArchiveSnapshot.userId': 'Managed by the service: consumed snapshot cleared, others cleared.',
};

/** JSON columns scrubbed of exact identity matches (id, email, employee code). */
export const JSON_SCRUB_COLUMNS: { model: string; table: string; column: string }[] = [
  { model: 'OperationalEvent', table: 'operational_events', column: 'metadata' },
  { model: 'OperationalEvent', table: 'operational_events', column: 'beforeValue' },
  { model: 'OperationalEvent', table: 'operational_events', column: 'afterValue' },
  { model: 'ActivityLog', table: 'activity_logs', column: 'details' },
  { model: 'AttendanceEvent', table: 'attendance_events', column: 'metadata' },
  { model: 'EmployeeProfileChangeRequest', table: 'employee_profile_change_requests', column: 'changes' },
];

/** Narrative text columns: never rewritten; exact mentions are only counted. */
export const NARRATIVE_TEXT_COLUMNS: { model: string; field: string }[] = [
  { model: 'Comment', field: 'content' },
  { model: 'Ticket', field: 'description' },
  { model: 'Notification', field: 'message' },
  { model: 'User', field: 'verifiedBy' },
  { model: 'EmployeeDocument', field: 'verifiedBy' },
];

export const SCRUBBED = '[deleted-user]';
export const DELETED_USER_NAME = 'Deleted user';

export function subjectValue(handler: Handler, u: Subject): string | null {
  return handler.holds === 'employeeId' ? u.employeeId : u.id;
}

/** The where clause selecting every row this handler acts on, or null when it cannot apply. */
export function handlerWhere(handler: Handler, u: Subject, ctx: MatrixContext): Record<string, unknown> | null {
  if (handler.where) return handler.where(u, ctx);
  const value = subjectValue(handler, u);
  if (value === null || value === '') return null;
  return { [handler.field]: value, ...(handler.scope ? handler.scope(u, ctx) : {}) };
}

/** Workbook sheets, in order, de-duplicated. */
export function workbookSheets(): string[] {
  return [...new Set(HANDLERS.map((h) => h.sheet))];
}

/**
 * Deep-replaces exact identity matches in a JSON value. A string that merely
 * contains an identifier is left alone and counted: rewriting free text by
 * substring is how unrelated words get corrupted.
 */
export function scrubJson(value: unknown, u: Subject): { value: unknown; replaced: number; residualMentions: number } {
  const email = u.email.trim().toLowerCase();
  const exact = (s: string) =>
    s === u.id || s.trim().toLowerCase() === email || (!!u.employeeId && s.trim().toLowerCase() === u.employeeId.toLowerCase());
  const mentions = (s: string) =>
    s.includes(u.id) || s.toLowerCase().includes(email) || (!!u.employeeId && u.employeeId.length >= 4 && s.toLowerCase().includes(u.employeeId.toLowerCase()));
  let replaced = 0;
  let residualMentions = 0;
  const walk = (v: any): any => {
    if (typeof v === 'string') {
      if (exact(v)) {
        replaced++;
        return SCRUBBED;
      }
      if (mentions(v)) residualMentions++;
      return v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: any = {};
      for (const [k, child] of Object.entries(v)) out[k] = walk(child);
      return out;
    }
    return v;
  };
  return { value: walk(value), replaced, residualMentions };
}
