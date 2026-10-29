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
const subjectIdentifiers = (u: Subject): string[] => [u.id, u.employeeId].filter((value): value is string => Boolean(value));

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
  { key: 'MeetingApprovalResponse.approverId', model: 'MeetingApprovalResponse', field: 'approverId', fk: true, holds: 'id', action: 'NULL', history: true, sheet: 'Meeting Approvals', note: 'Clears the deleted account reference while preserving the approval decision and approver-name snapshot.' },
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
  // Phase 3: Emergency Leave evidence files, append-only (row-scoped trigger
  // exception), before their leave request. Bytes archived like documents.
  { key: 'LeaveEvidence.userId', model: 'LeaveEvidence', field: 'userId', fk: false, holds: 'id', action: 'DEL', history: true, retention: 'LEAVE', sheet: 'Leave Evidence', appendOnly: true, note: 'Append-only evidence files; bytes archived; original removed by cleanup.' },
  { key: 'LeaveEvidence.uploadedById', model: 'LeaveEvidence', field: 'uploadedById', fk: false, holds: 'id', action: 'DEL', where: (u) => ({ uploadedById: u.id, userId: u.id }), history: true, retention: 'LEAVE', sheet: 'Leave Evidence', appendOnly: true, note: 'Only the leave owner uploads evidence, so these are the same rows as LeaveEvidence.userId.' },
  // Phase 3: three-day unreported-absence decisions and recorded absence reports.
  { key: 'UnreportedAbsenceDecision.userId', model: 'UnreportedAbsenceDecision', field: 'userId', fk: false, holds: 'id', action: 'DEL', history: true, retention: 'ATTENDANCE', sheet: 'Attendance Absence Decisions', appendOnly: true, note: 'Audit history; deleted only under the row-scoped trigger exception.' },
  { key: 'AbsenceReport.userId', model: 'AbsenceReport', field: 'userId', fk: false, holds: 'id', action: 'DEL', history: true, retention: 'ATTENDANCE', sheet: 'Attendance Absence Reports', note: 'Reports that the person informed HR of an absence.' },
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
  { key: 'UserLegalHold.userId', model: 'UserLegalHold', field: 'userId', fk: false, holds: 'id', action: 'DEL', history: false, sheet: 'Legal Holds', note: 'Only released, rejected or withdrawn holds can exist here; an active or requested hold blocks deletion.' },

  // Private Create Ticket presets. They describe nothing that happened, so they are not history.
  { key: 'QuickTicketTemplate.ownerUserId', model: 'QuickTicketTemplate', field: 'ownerUserId', fk: false, holds: 'id', action: 'DEL', history: false, sheet: 'Ticket Templates', note: 'The person\'s own private templates: archived in the workbook, then deleted.' },
  { key: 'QuickTicketTemplatePreference.ownerUserId', model: 'QuickTicketTemplatePreference', field: 'ownerUserId', fk: false, holds: 'id', action: 'DEL', history: false, sheet: 'Ticket Templates', note: 'The person\'s own Quick Tag display preference.' },

  // Imported asset rows may hold either the application user id or employee code.
  // Preserve operational history while removing structured identity; NAME must run before SCRUB.
  { key: 'AssetAllocation.employeeName', model: 'AssetAllocation', field: 'employeeName', fk: false, holds: 'id', action: 'NAME', where: (u) => ({ employeeId: { in: subjectIdentifiers(u) } }), history: true, sheet: 'Asset Management', note: 'Linked allocation history stays with an anonymized employee name.' },
  { key: 'AssetAllocation.employeeId[user-or-employee-code]', model: 'AssetAllocation', field: 'employeeId', fk: false, holds: 'id', action: 'SCRUB', where: (u) => ({ employeeId: { in: subjectIdentifiers(u) } }), history: true, sheet: 'Asset Management', note: 'The identifier may contain either a user id or employee code.' },
  { key: 'AssetMobileSubscription.employeeName', model: 'AssetMobileSubscription', field: 'employeeName', fk: false, holds: 'id', action: 'NAME', where: (u) => ({ employeeId: { in: subjectIdentifiers(u) } }), history: true, sheet: 'Asset Management', note: 'Linked subscription history stays with an anonymized employee name.' },
  { key: 'AssetMobileSubscription.employeeId[user-or-employee-code]', model: 'AssetMobileSubscription', field: 'employeeId', fk: false, holds: 'id', action: 'SCRUB', where: (u) => ({ employeeId: { in: subjectIdentifiers(u) } }), history: true, sheet: 'Asset Management', note: 'The identifier may contain either a user id or employee code.' },
  { key: 'AssetRequest.employeeName', model: 'AssetRequest', field: 'employeeName', fk: false, holds: 'id', action: 'NAME', where: (u) => ({ employeeId: { in: subjectIdentifiers(u) } }), history: true, sheet: 'Asset Management', note: 'Linked request history stays with an anonymized employee name.' },
  { key: 'AssetRequest.employeeId[user-or-employee-code]', model: 'AssetRequest', field: 'employeeId', fk: false, holds: 'id', action: 'SCRUB', where: (u) => ({ employeeId: { in: subjectIdentifiers(u) } }), history: true, sheet: 'Asset Management', note: 'The identifier may contain either a user id or employee code.' },

  // ── 3b. Lifecycle foundation (Phase 1): own rows, children before parents ─
  // The running operation's attempts stay linked to its scrubbed receipt.
  {
    key: 'LifecycleRemediationAttempt.subjectUserId[running]', model: 'LifecycleRemediationAttempt', field: 'subjectUserId', fk: false, holds: 'id', action: 'NULL',
    where: (u, ctx) => (ctx.operationId ? { subjectUserId: u.id, lifecycleOperationId: ctx.operationId } : { id: { in: [] } }),
    history: false, sheet: 'Lifecycle Operations', note: 'The running operation\'s attempts stay with its receipt; the subject is cleared under the trigger exception.',
  },
  {
    key: 'LifecycleRemediationAttempt.subjectUserId', model: 'LifecycleRemediationAttempt', field: 'subjectUserId', fk: false, holds: 'id', action: 'DEL',
    scope: (_u, ctx) => (ctx.operationId ? { OR: [{ lifecycleOperationId: null }, { lifecycleOperationId: { not: ctx.operationId } }] } : {}),
    history: false, sheet: 'Lifecycle Operations', appendOnly: true, note: 'Bookkeeping about the person (earlier lifecycle attempts also cascade with their operations); deleted under the trigger exception.',
  },
  { key: 'FnfAdjustmentRequest.subjectUserId', model: 'FnfAdjustmentRequest', field: 'subjectUserId', fk: false, holds: 'id', action: 'DEL', history: true, sheet: 'Exit and F&F', appendOnly: true, note: 'Decided requests are frozen; deleted only under the row-scoped trigger exception, before the adjustments they point at.' },
  { key: 'FnfAdjustment.subjectUserId', model: 'FnfAdjustment', field: 'subjectUserId', fk: false, holds: 'id', action: 'DEL', history: true, sheet: 'Exit and F&F', appendOnly: true, note: 'Append-only; deleted only under the row-scoped trigger exception, before the exit case that owns the settlement.' },
  { key: 'ExitCase.userId', model: 'ExitCase', field: 'userId', fk: true, holds: 'id', action: 'DEL', history: true, sheet: 'Exit and F&F', note: 'Cascades clearance items and the settlement. Outside the retention gate; archived in full.' },
  { key: 'EmploymentPeriod.userId', model: 'EmploymentPeriod', field: 'userId', fk: true, holds: 'id', action: 'DEL', history: true, sheet: 'Employment Periods', note: 'After exit cases. The initial NEW_HIRE period is setup-only.' },
  { key: 'UserSetupIssue.userId', model: 'UserSetupIssue', field: 'userId', fk: true, holds: 'id', action: 'DEL', history: false, sheet: 'Setup Health', note: 'Setup health about the person.' },
  { key: 'HierarchyAssignment.subjectUserId', model: 'HierarchyAssignment', field: 'subjectUserId', fk: true, holds: 'id', action: 'DEL', history: true, sheet: 'Reporting Lines', note: 'The person\'s own TL/Manager assignments. The initial one is setup-only.' },
  { key: 'HierarchyAssignment.assigneeUserId', model: 'HierarchyAssignment', field: 'assigneeUserId', fk: true, holds: 'id', action: 'DEL', history: true, sheet: 'Reporting Lines', note: 'An open row where the person is TL/Manager blocks archival; ended rows are deleted.' },
  { key: 'OrganizationReportingLine.subjectUserId', model: 'OrganizationReportingLine', field: 'subjectUserId', fk: true, holds: 'id', action: 'DEL', history: true, sheet: 'Reporting Lines', note: 'The person\'s own business-reporting line. It is not an approval assignment.' },
  { key: 'OrganizationReportingLine.supervisorId', model: 'OrganizationReportingLine', field: 'supervisorId', fk: true, holds: 'id', action: 'DEL', history: true, sheet: 'Reporting Lines', note: 'An active business supervisor blocks archival until their reports have been reassigned.' },
  { key: 'DepartmentTransfer.userId', model: 'DepartmentTransfer', field: 'userId', fk: true, holds: 'id', action: 'DEL', history: true, sheet: 'Transfers', note: 'Cascades the transfer\'s review inventory.' },
  { key: 'ReviewQueueAssignment.subjectUserId', model: 'ReviewQueueAssignment', field: 'subjectUserId', fk: true, holds: 'id', action: 'NULL', history: true, sheet: 'Review Routing', note: 'Preserves the forwarding audit while clearing the deleted subject reference.' },

  // ── 4. Shared records: reassign required actor/owner columns ──────────────
  { key: 'Ticket.createdById', model: 'Ticket', field: 'createdById', fk: true, holds: 'id', action: 'REASSIGN', history: true, sheet: 'Tickets Created', note: 'Shared ticket stays.' },
  { key: 'Meeting.organizerId', model: 'Meeting', field: 'organizerId', fk: true, holds: 'id', action: 'REASSIGN', history: true, sheet: 'Meetings Organized', note: 'Historical meeting stays; the required organizer reference moves to the Deleted account principal.' },
  { key: 'Meeting.decidedById', model: 'Meeting', field: 'decidedById', fk: false, holds: 'id', action: 'NULL', history: true, sheet: 'Meetings Decided', note: 'The meeting and its approval outcome stay; the reference to who decided it is cleared.' },
  { key: 'Meeting.counterpartyId', model: 'Meeting', field: 'counterpartyId', fk: true, holds: 'id', action: 'REASSIGN', history: true, sheet: 'Meeting Counterparties', note: 'Historical meeting stays; the required person-met-with reference moves to the Deleted account principal.' },
  { key: 'Comment.authorId', model: 'Comment', field: 'authorId', fk: true, holds: 'id', action: 'REASSIGN', history: true, sheet: 'Comments', note: 'Text kept.' },
  { key: 'TicketHistory.changedById', model: 'TicketHistory', field: 'changedById', fk: true, holds: 'id', action: 'REASSIGN', history: true, sheet: 'Ticket History', note: 'Shared audit.' },
  { key: 'OperationalEvent.actorId', model: 'OperationalEvent', field: 'actorId', fk: true, holds: 'id', action: 'REASSIGN', history: true, sheet: 'Events By User', note: 'Exact identifiers scrubbed from JSON separately.' },
  { key: 'AssetAuditEvent.actorName', model: 'AssetAuditEvent', field: 'actorName', fk: false, holds: 'id', action: 'NAME', where: (u) => ({ actorId: u.id }), history: true, sheet: 'Asset Audit', note: 'Asset audit history stays while the actor name is anonymized.' },
  { key: 'AssetAuditEvent.actorId', model: 'AssetAuditEvent', field: 'actorId', fk: false, holds: 'id', action: 'REASSIGN', history: true, sheet: 'Asset Audit', note: 'Required actor moves to the non-login Deleted account principal.' },
  { key: 'AssetImportBatch.importedByName', model: 'AssetImportBatch', field: 'importedByName', fk: false, holds: 'id', action: 'NAME', where: (u) => ({ importedById: u.id }), history: true, sheet: 'Asset Imports', note: 'Import history stays while the importer name is anonymized.' },
  { key: 'AssetImportBatch.importedById', model: 'AssetImportBatch', field: 'importedById', fk: false, holds: 'id', action: 'REASSIGN', history: true, sheet: 'Asset Imports', note: 'Required importer moves to the non-login Deleted account principal.' },
  { key: 'EmployeeProfileChangeRequest.requestedById', model: 'EmployeeProfileChangeRequest', field: 'requestedById', fk: true, holds: 'id', action: 'REASSIGN', scope: (u) => ({ targetUserId: { not: u.id } }), history: true, sheet: 'Profile Change Requests', note: 'Requests the person raised for others.' },
  { key: 'AttendanceImportBatch.uploadedById', model: 'AttendanceImportBatch', field: 'uploadedById', fk: true, holds: 'id', action: 'REASSIGN', history: true, sheet: 'Attendance Imports', note: 'The system principal never approves, so the uploader != approver CHECK holds.' },
  { key: 'Lead.ownerId', model: 'Lead', field: 'ownerId', fk: true, holds: 'id', action: 'REASSIGN', history: true, sheet: 'CRM', note: 'Open leads block archival.' },
  { key: 'LeadActivity.createdById', model: 'LeadActivity', field: 'createdById', fk: true, holds: 'id', action: 'REASSIGN', history: true, sheet: 'CRM', note: 'Shared CRM.' },
  { key: 'FollowUp.createdById', model: 'FollowUp', field: 'createdById', fk: true, holds: 'id', action: 'REASSIGN', history: true, sheet: 'CRM', note: 'Shared CRM.' },
  { key: 'AttendanceRecoveryTombstone.deletedById', model: 'AttendanceRecoveryTombstone', field: 'deletedById', fk: false, holds: 'id', action: 'REASSIGN', scope: (u) => ({ employeeId: { not: u.id } }), history: true, sheet: 'Recovery Tombstones', note: 'Required column on other people\'s tombstones.' },
  { key: 'UserLifecycleOperation.actorId', model: 'UserLifecycleOperation', field: 'actorId', fk: false, holds: 'id', action: 'REASSIGN', scope: (u) => ({ OR: [{ userId: null }, { userId: { not: u.id } }] }), history: true, sheet: 'Lifecycle Operations', note: 'Operations the person ran on others.' },
  { key: 'UserArchiveSnapshot.createdById', model: 'UserArchiveSnapshot', field: 'createdById', fk: false, holds: 'id', action: 'REASSIGN', scope: (u) => ({ OR: [{ userId: null }, { userId: { not: u.id } }] }), history: true, sheet: 'Lifecycle Operations', note: 'Archives the person created of others.' },
  { key: 'DepartmentTransfer.actorId', model: 'DepartmentTransfer', field: 'actorId', fk: false, holds: 'id', action: 'REASSIGN', scope: others, history: true, sheet: 'Transfers', note: 'Transfers the person performed for others.' },
  { key: 'ReviewQueueAssignment.assignedReviewerId', model: 'ReviewQueueAssignment', field: 'assignedReviewerId', fk: true, holds: 'id', action: 'REASSIGN', history: true, sheet: 'Review Routing', note: 'Required reviewer on preserved forwarding history; moved to the Deleted account principal.' },
  { key: 'ReviewQueueAssignment.forwardedById', model: 'ReviewQueueAssignment', field: 'forwardedById', fk: true, holds: 'id', action: 'REASSIGN', history: true, sheet: 'Review Routing', note: 'Required forwarding actor on preserved history; moved to the Deleted account principal.' },
  ...(['approvedById', 'recordedById'] as const).map((field): Handler => ({
    key: `FnfAdjustment.${field}`, model: 'FnfAdjustment', field, fk: false, holds: 'id', action: 'REASSIGN',
    scope: (u) => ({ subjectUserId: { not: u.id } }), history: true, sheet: 'Exit and F&F', note: 'Required actor on another person\'s adjustment; moved under the trigger exception.',
  })),
  { key: 'LifecycleRemediationAttempt.actorId', model: 'LifecycleRemediationAttempt', field: 'actorId', fk: false, holds: 'id', action: 'REASSIGN', history: true, sheet: 'Lifecycle Operations', note: 'Attempts the person made on others; moved under the trigger exception.' },
  // v2.3 §2.5.3: the per-state CHECK forbids NULL actors on non-legacy holds.
  ...(['requestedById', 'placedById', 'rejectedById', 'withdrawnById', 'releasedById'] as const).map((field): Handler => ({
    key: `UserLegalHold.${field}`, model: 'UserLegalHold', field, fk: false, holds: 'id', action: 'REASSIGN', scope: others, history: true, sheet: 'Policies Acted On', note: 'Hold kept; the actor moves to the Deleted account principal.',
  })),

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
  { key: 'RetentionRule.approvedById', model: 'RetentionRule', field: 'approvedById', fk: false, holds: 'id', action: 'REASSIGN', history: true, sheet: 'Policies Acted On', note: 'Rule kept.' },

  // ── 6. Lifecycle foundation (Phase 1): clear optional references ──────────
  ...(['subjectUserId', 'resolvedApproverId', 'createdById'] as const).map((field): Handler => ({
    key: `RoutingSnapshot.${field}`, model: 'RoutingSnapshot', field, fk: false, holds: 'id', action: 'NULL', history: true, sheet: 'Routing History',
    note: 'Snapshots are immutable audit records and are never deleted; only the reference is cleared, under the trigger exception.',
  })),
  { key: 'LeaveRequest.fundingChangedById', model: 'LeaveRequest', field: 'fundingChangedById', fk: false, holds: 'id', action: 'NULL', scope: others, history: true, sheet: 'Leave Decisions', note: 'Funding changes made for others.' },
  { key: 'EmploymentPeriod.createdById', model: 'EmploymentPeriod', field: 'createdById', fk: false, holds: 'id', action: 'NULL', scope: others, history: true, sheet: 'Employment Periods', note: 'Periods recorded for others.' },
  ...(['acknowledgedById', 'resolvedById', 'waivedById'] as const).map((field): Handler => ({
    key: `UserSetupIssue.${field}`, model: 'UserSetupIssue', field, fk: false, holds: 'id', action: 'NULL', history: true, sheet: 'Setup Health', note: 'Issues the person handled for others.',
  })),
  { key: 'HierarchyAssignment.createdById', model: 'HierarchyAssignment', field: 'createdById', fk: false, holds: 'id', action: 'NULL', history: true, sheet: 'Reporting Lines', note: 'Assignments the person recorded.' },
  { key: 'PolicyHealthIssue.resolvedById', model: 'PolicyHealthIssue', field: 'resolvedById', fk: false, holds: 'id', action: 'NULL', history: true, sheet: 'Policies Acted On', note: 'Issue kept.' },
  // Phase 3 actor references on records about OTHER people. Their CHECKs
  // require an actor, so they move to the deleted-account principal.
  { key: 'AttendanceRegularization.decidedById', model: 'AttendanceRegularization', field: 'decidedById', fk: false, holds: 'id', action: 'REASSIGN', scope: others, history: true, sheet: 'Attendance Corrections', note: 'Final decisions on others\x27 corrections stay; the decider becomes the deleted-account principal.' },
  { key: 'UnreportedAbsenceDecision.correctedById', model: 'UnreportedAbsenceDecision', field: 'correctedById', fk: false, holds: 'id', action: 'REASSIGN', scope: (u) => ({ userId: { not: u.id } }), history: true, sheet: 'Attendance Absence Decisions', note: 'HR corrections of others\x27 LWP decisions stay.' },
  { key: 'AbsenceReport.recordedById', model: 'AbsenceReport', field: 'recordedById', fk: false, holds: 'id', action: 'REASSIGN', scope: (u) => ({ userId: { not: u.id } }), history: true, sheet: 'Attendance Absence Reports', note: 'Reports HR recorded for others stay.' },
  { key: 'PunchEvidenceReview.reviewedById', model: 'PunchEvidenceReview', field: 'reviewedById', fk: false, holds: 'id', action: 'NULL', history: true, sheet: 'Punch Evidence', note: 'Reviews of others\' evidence; the person\'s own reviews cascade with their evidence.' },
  ...(['createdById', 'submittedById'] as const).map((field): Handler => ({
    key: `ExitCase.${field}`, model: 'ExitCase', field, fk: false, holds: 'id', action: 'NULL', scope: others, history: true, sheet: 'Exit and F&F', note: 'Exit cases the person handled for others.',
  })),
  // Phase 4 CHECKs require these actors in their states, so they move to the deleted-account principal.
  ...(['withdrawnById', 'noticeAdjustedById', 'separatedById'] as const).map((field): Handler => ({
    key: `ExitCase.${field}`, model: 'ExitCase', field, fk: false, holds: 'id', action: 'REASSIGN', scope: others, history: true, sheet: 'Exit and F&F', note: 'Required actor on another person exit case; moved to the deleted-account principal.',
  })),
  { key: 'ExitClearanceItem.ownerId', model: 'ExitClearanceItem', field: 'ownerId', fk: false, holds: 'id', action: 'NULL', history: true, sheet: 'Exit and F&F', note: 'Clearance items the person owned for others.' },
  ...(['completedById', 'waivedById'] as const).map((field): Handler => ({
    key: `ExitClearanceItem.${field}`, model: 'ExitClearanceItem', field, fk: false, holds: 'id', action: 'REASSIGN', history: true, sheet: 'Exit and F&F', note: 'Required actor on a finished clearance item; moved to the deleted-account principal.',
  })),
  { key: 'FnfSettlement.releasedById', model: 'FnfSettlement', field: 'releasedById', fk: false, holds: 'id', action: 'REASSIGN', history: true, sheet: 'Exit and F&F', note: 'A released settlement keeps a releaser; moved to the deleted-account principal.' },

  // ── 7. Phase 4 ──
  ...(['requestedById', 'decidedById'] as const).map((field): Handler => ({
    key: `FnfAdjustmentRequest.${field}`, model: 'FnfAdjustmentRequest', field, fk: false, holds: 'id', action: 'REASSIGN',
    scope: (u) => ({ subjectUserId: { not: u.id } }), history: true, sheet: 'Exit and F&F', note: 'Actor on another person adjustment request; moved under the trigger exception.',
  })),
  ...(['proposedById', 'decidedById'] as const).map((field): Handler => ({
    key: `RetentionRuleProposal.${field}`, model: 'RetentionRuleProposal', field, fk: false, holds: 'id', action: 'REASSIGN', history: true, sheet: 'Policies Acted On', note: 'Retention history is kept; the actor moves to the deleted-account principal.',
  })),
  { key: 'RetentionRuleVersion.approvedById', model: 'RetentionRuleVersion', field: 'approvedById', fk: false, holds: 'id', action: 'REASSIGN', history: true, sheet: 'Policies Acted On', note: 'Immutable version history is kept; the approver moves to the deleted-account principal.' },
  { key: 'RetentionRule.createdById', model: 'RetentionRule', field: 'createdById', fk: false, holds: 'id', action: 'NULL', history: true, sheet: 'Policies Acted On', note: 'Rule kept.' },
  { key: 'AttendanceMonthClose.unresolvedAcknowledgedById', model: 'AttendanceMonthClose', field: 'unresolvedAcknowledgedById', fk: false, holds: 'id', action: 'REASSIGN', history: true, sheet: 'Payroll Months Finalized', note: 'Acknowledgement is paired with its time; the actor moves to the deleted-account principal.' },
  { key: 'EmploymentPeriod.probationVerifiedById', model: 'EmploymentPeriod', field: 'probationVerifiedById', fk: false, holds: 'id', action: 'REASSIGN', scope: others, history: true, sheet: 'Employment Periods', note: 'Verification is paired with its time; the actor moves to the deleted-account principal.' },
  { key: 'DepartmentTransfer.cancelledById', model: 'DepartmentTransfer', field: 'cancelledById', fk: false, holds: 'id', action: 'REASSIGN', scope: others, history: true, sheet: 'Transfers', note: 'A cancelled transfer requires its canceller.' },
  { key: 'DepartmentTransferImpact.reviewedById', model: 'DepartmentTransferImpact', field: 'reviewedById', fk: false, holds: 'id', action: 'REASSIGN', scope: (u) => ({ transfer: { userId: { not: u.id } } }), history: true, sheet: 'Transfers', note: 'A reviewed impact requires its reviewer.' },
  { key: 'TransitionRequestKey.actorId', model: 'TransitionRequestKey', field: 'actorId', fk: false, holds: 'id', action: 'REASSIGN', history: false, sheet: 'Exit and F&F', note: 'Idempotency ledger; the actor moves to the deleted-account principal.' },
];

/**
 * Handlers added after verified snapshots already existed (lifecycle
 * foundation, Phase 1). While they find no rows they are left out of the data
 * fingerprint, so archives verified before they existed do not turn stale. Any
 * row they do find is fingerprinted like every other.
 */
export const FINGERPRINT_OPTIONAL_WHEN_EMPTY: ReadonlySet<string> = new Set(
  HANDLERS.map((h) => h.key).filter((k) =>
    /^(LifecycleRemediationAttempt|FnfAdjustmentRequest|RetentionRuleProposal|RetentionRuleVersion|TransitionRequestKey|DepartmentTransferImpact|FnfAdjustment|ExitCase|ExitClearanceItem|FnfSettlement|EmploymentPeriod|UserSetupIssue|HierarchyAssignment|DepartmentTransfer|RoutingSnapshot|PolicyHealthIssue|PunchEvidenceReview|ReviewQueueAssignment|OrganizationReportingLine|AssetAllocation|AssetMobileSubscription|AssetRequest|AssetAuditEvent|AssetImportBatch)\./.test(k)
    || [
      'LeaveRequest.fundingChangedById',
      'RetentionRule.createdById',
      'AttendanceMonthClose.unresolvedAcknowledgedById',
      'EmploymentPeriod.probationVerifiedById',
      'UserLegalHold.requestedById',
      'UserLegalHold.rejectedById',
      'UserLegalHold.withdrawnById',
      'QuickTicketTemplate.ownerUserId',
      'QuickTicketTemplatePreference.ownerUserId',
    ].includes(k)),
);

/**
 * Columns that look like user references but are not, or that the service
 * manages itself. Listed so the coverage test can tell "considered and
 * excluded" from "never considered".
 */
export const NOT_USER_REFERENCES: Record<string, string> = {
  'ExitClearanceItem.ownerCapability': 'A capability label (TEAM_LEAD, DEPT_MANAGER, HR, ADMIN), not a person.',
  'AttendancePolicy.supersededById': 'Points at the superseding policy version.',
  'ShiftPolicy.supersededById': 'Points at the superseding policy version.',
  'HolidayCalendar.supersededById': 'Points at the superseding policy version.',
  'LeavePolicy.supersededById': 'Points at the superseding policy version.',
  'OperationalEvent.actorRoleId': 'A role id.',
  'OperationalEvent.actorContext': 'A context label, not a person.',
  'Meeting.createdByRole': 'A role snapshot captured with the meeting, not a person reference.',
  'MeetingApprovalResponse.approverNameSnapshot': 'A historical display-name snapshot kept after account deletion; the linked approverId is cleared separately.',
  'PushSubscription.userAgent': 'A browser string.',
  'TicketTimeLog.ownerType': 'An enum label.',
  'TicketTimeLog.pauseReason': 'An enum label.',
  'EmployeeProfileChangeRequest.managerDecision': 'A decision label.',
  'EmployeeProfileChangeRequest.employeeDeclineReason': 'A narrative reason, not a person reference.',
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
  'Meeting.approverIds': 'Service-managed array cleanup: the deleted person is removed from the eligible approvers of meetings inside the Permanent Delete transaction (MEETING_APPROVERS_REMOVED).',
  'QuickTicketTemplate.assigneeIds': 'Service-managed array cleanup: the deleted person is removed from other owners\' templates inside the Permanent Delete transaction (TEMPLATE_ASSIGNEES_REMOVED).',
  'CompanyAsset.ownership': 'An ownership category such as company-owned or rented, not a person reference.',
  'AssetAllocation.employeeId': 'Covered by the qualified AssetAllocation employee-identifier handler.',
  'AssetAllocation.hodManagerName': 'A historical manager-name snapshot, not an exact account reference.',
  'AssetRentalPayment.employeeName': 'A historical workbook name snapshot without a stable account identifier.',
  'AssetRentalPayment.approvedBy': 'A historical approver-name snapshot without a stable account identifier.',
  'AssetMobileSubscription.employeeId': 'Covered by the qualified mobile-subscription employee-identifier handler.',
  'AssetRequest.employeeId': 'Covered by the qualified asset-request employee-identifier handler.',
  'AssetRequest.managerName': 'A historical manager-name snapshot, not an exact account reference.',
  'AssetRequest.adminOwner': 'A display label for the administrative owner, not an exact account reference.',
  'AssetRequest.employeeRemark': 'Narrative request text, not a structured person reference.',
  'AssetRequest.managerRemark': 'Narrative request text, not a structured person reference.',
};

/** JSON columns scrubbed of exact identity matches (id, email, employee code). */
export const JSON_SCRUB_COLUMNS: { model: string; table: string; column: string }[] = [
  { model: 'OperationalEvent', table: 'operational_events', column: 'metadata' },
  { model: 'OperationalEvent', table: 'operational_events', column: 'beforeValue' },
  { model: 'OperationalEvent', table: 'operational_events', column: 'afterValue' },
  { model: 'ActivityLog', table: 'activity_logs', column: 'details' },
  { model: 'AttendanceEvent', table: 'attendance_events', column: 'metadata' },
  { model: 'EmployeeProfileChangeRequest', table: 'employee_profile_change_requests', column: 'changes' },
  { model: 'AssetAuditEvent', table: 'asset_audit_events', column: 'before' },
  { model: 'AssetAuditEvent', table: 'asset_audit_events', column: 'after' },
  { model: 'AssetAuditEvent', table: 'asset_audit_events', column: 'metadata' },
  { model: 'AssetImportBatch', table: 'asset_import_batches', column: 'sheets' },
  { model: 'AssetImportBatch', table: 'asset_import_batches', column: 'summary' },
  { model: 'AssetImportBatch', table: 'asset_import_batches', column: 'errors' },
];

/** Narrative text columns: never rewritten; exact mentions are only counted. */
export const NARRATIVE_TEXT_COLUMNS: { model: string; field: string }[] = [
  { model: 'Comment', field: 'content' },
  { model: 'Ticket', field: 'description' },
  { model: 'Notification', field: 'message' },
  { model: 'User', field: 'verifiedBy' },
  { model: 'EmployeeDocument', field: 'verifiedBy' },
  { model: 'AssetRequest', field: 'employeeRemark' },
  { model: 'AssetRequest', field: 'managerRemark' },
  { model: 'AssetRequest', field: 'adminRemark' },
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
