/**
 * WHAT HAPPENS TO EVERY RECORD THAT POINTS AT A USER, WHEN THAT USER IS DELETED.
 *
 * This file is the executable form of
 * docs/architecture/USER_DELETION_RELATION_MATRIX.md. The Markdown explains
 * the reasoning; this decides the behaviour, and a test extracts the relations
 * from schema.prisma and fails when one of them is not listed here.
 *
 * WHY EXECUTABLE RATHER THAN A DOCUMENT. A document describing 45 foreign keys
 * is accurate on the day it is written and silently wrong afterwards. The
 * matrix was already stale by one relation when this was built --
 * AttendanceMonthClose.reopenedBy was added days later and nothing noticed.
 * Deletion is irreversible, so "the list drifted from the schema" is not a
 * documentation problem; it is an unclassified relation deleted or orphaned by
 * accident.
 *
 * THE DEFAULT IS REFUSAL. An unknown relation does not fall through to
 * "probably fine": the guard test fails, and until somebody classifies it the
 * deletion path reports it as unclassified and refuses.
 */

export type RelationAction =
  /**
   * Personal or ephemeral. It goes with the person, and the Drive archive is
   * the long-term record of it.
   */
  | 'DELETE_WITH_USER'
  /**
   * The company record survives and the actor reference becomes NULL. For an
   * actor whose identity adds nothing once they are gone -- an unassigned
   * ticket is simply unassigned.
   */
  | 'RETAIN_AND_NULL_ACTOR'
  /**
   * The company record survives AND keeps a readable identity, because a bare
   * NULL would make the history unanswerable: "who approved this payroll
   * month" cannot be answered by a blank.
   */
  | 'RETAIN_WITH_SNAPSHOT'
  /**
   * Deletion is refused while this exists. Not a tidy null -- an operational
   * gap a human has to resolve first, by reassigning it.
   */
  | 'BLOCK_DELETE';

export interface RelationRule {
  /** Prisma model holding the foreign key. */
  model: string;
  /** The relation field, e.g. `createdBy`. */
  field: string;
  /** The scalar FK column, e.g. `createdById`. */
  fk: string;
  action: RelationAction;
  /** Why, in one line. The Markdown carries the full argument. */
  why: string;
  /**
   * What a human must do before deletion can proceed. BLOCK_DELETE only.
   */
  resolution?: string;
}

/**
 * Every FK relation to User in schema.prisma, and what deletion does to it.
 *
 * Keyed `Model.field`, because several models point at User more than once
 * and the action differs per field: a Ticket's creator is kept with a
 * snapshot while its assignee is simply nulled.
 */
export const USER_RELATION_RULES: readonly RelationRule[] = [
  // ── The employee's own attendance ──────────────────────────────────────
  // Personal facts, not shared company history. Archived in full to Drive
  // before anything is removed, so the archive becomes the record.
  { model: 'DailyAttendance', field: 'user', fk: 'userId', action: 'DELETE_WITH_USER',
    why: 'Their own daily outcome. Archived first.' },
  { model: 'AttendancePunchEvidence', field: 'user', fk: 'userId', action: 'DELETE_WITH_USER',
    why: 'Personal punch evidence, including location and photo references.' },
  { model: 'AttendancePunchPhoto', field: 'user', fk: 'userId', action: 'DELETE_WITH_USER',
    why: 'Biometric-adjacent personal data. Must not outlive the person.' },
  { model: 'AttendancePunchHandoff', field: 'user', fk: 'userId', action: 'DELETE_WITH_USER',
    why: 'Ephemeral mobile handoff token.' },
  { model: 'AttendanceEvent', field: 'user', fk: 'userId', action: 'DELETE_WITH_USER',
    why: 'Their own attendance event stream.' },
  { model: 'WorkSession', field: 'user', fk: 'userId', action: 'DELETE_WITH_USER',
    why: 'Their own workday sessions.' },
  { model: 'BreakLog', field: 'user', fk: 'userId', action: 'DELETE_WITH_USER',
    why: 'Breaks, a child of WorkSession.' },
  { model: 'AttendanceRegularization', field: 'user', fk: 'userId', action: 'DELETE_WITH_USER',
    why: 'Corrections to their own attendance.' },
  { model: 'AttendanceRegularization', field: 'createdBy', fk: 'createdById',
    action: 'RETAIN_AND_NULL_ACTOR',
    why: 'A correction this person raised for SOMEBODY ELSE belongs to that other record.' },
  { model: 'EmployeeAttendanceProfile', field: 'user', fk: 'userId', action: 'DELETE_WITH_USER',
    why: 'Their shift and policy assignment.' },
  { model: 'UserWorkdayPolicyOverride', field: 'user', fk: 'userId', action: 'DELETE_WITH_USER',
    why: 'Per-person policy override. Configuration, not history.' },
  { model: 'CompOffCredit', field: 'employee', fk: 'employeeId', action: 'DELETE_WITH_USER',
    why: 'Personal entitlement. Archived, then removed.' },
  { model: 'LeaveRequest', field: 'user', fk: 'userId', action: 'DELETE_WITH_USER',
    why: 'Their own leave. Archived, then removed.' },

  // ── Attendance records that are the COMPANY's, not theirs ──────────────
  { model: 'AttendanceMonthClose', field: 'finalizedBy', fk: 'finalizedById',
    action: 'RETAIN_WITH_SNAPSHOT',
    why: 'A payroll month is a financial record. "Who approved this" must stay answerable.' },
  { model: 'AttendanceMonthClose', field: 'reopenedBy', fk: 'reopenedById',
    action: 'RETAIN_WITH_SNAPSHOT',
    why: 'Who unsealed a finalized month, and therefore who authorised changing history.' },
  { model: 'AttendanceImportBatch', field: 'uploadedBy', fk: 'uploadedById',
    action: 'RETAIN_WITH_SNAPSHOT',
    why: 'An import that rewrote attendance keeps an attributable author.' },
  { model: 'AttendanceImportBatch', field: 'approvedBy', fk: 'approvedById',
    action: 'RETAIN_WITH_SNAPSHOT', why: 'Who approved that import.' },
  { model: 'AttendanceImportBatch', field: 'appliedBy', fk: 'appliedById',
    action: 'RETAIN_WITH_SNAPSHOT', why: 'Who applied it.' },

  // ── Tickets: the work survives the worker ──────────────────────────────
  { model: 'Ticket', field: 'createdBy', fk: 'createdById', action: 'RETAIN_WITH_SNAPSHOT',
    why: 'The ticket is company work. Its origin stays readable.' },
  { model: 'Ticket', field: 'assignedTo', fk: 'assignedToId', action: 'RETAIN_AND_NULL_ACTOR',
    why: 'Open work returns to the queue rather than vanishing with its owner.' },
  { model: 'Ticket', field: 'approver', fk: 'approverId', action: 'RETAIN_AND_NULL_ACTOR',
    why: 'Approval re-routes. A PENDING approval on the leaver blocks first -- see guards.' },
  { model: 'TicketAssignee', field: 'user', fk: 'userId', action: 'DELETE_WITH_USER',
    why: 'A membership row, not history. The ticket survives.' },
  { model: 'TicketWatcher', field: 'user', fk: 'userId', action: 'DELETE_WITH_USER',
    why: 'A subscription preference.' },
  { model: 'TicketHistory', field: 'changedBy', fk: 'changedById', action: 'RETAIN_WITH_SNAPSHOT',
    why: 'Status-transition audit. Must survive and stay attributable.' },
  { model: 'TicketTimeLog', field: 'user', fk: 'userId', action: 'RETAIN_WITH_SNAPSHOT',
    why: 'Payroll- and SLA-relevant time. Deleting it silently rewrites historical cost.' },
  { model: 'ReviewCycleLog', field: 'assignee', fk: 'assigneeId', action: 'RETAIN_AND_NULL_ACTOR',
    why: 'The cycle survives; who was assigned adds nothing once they are gone.' },
  { model: 'ReviewCycleLog', field: 'reviewer', fk: 'reviewerId', action: 'RETAIN_WITH_SNAPSHOT',
    why: 'Who approved work is attributable history.' },
  { model: 'Comment', field: 'author', fk: 'authorId', action: 'RETAIN_WITH_SNAPSHOT',
    why: 'A discussion thread with holes in it is unreadable.' },
  { model: 'Attachment', field: 'uploadedBy', fk: 'uploadedById',
    action: 'RETAIN_WITH_SNAPSHOT',
    why: 'Evidence on a ticket. Who submitted a proof of completion is what an audit asks.' },

  // ── Memberships and grants: rows about access, not history ─────────────
  { model: 'ProjectMember', field: 'user', fk: 'userId', action: 'DELETE_WITH_USER',
    why: 'Membership row only. THE PROJECT SURVIVES.' },
  { model: 'TeamMember', field: 'user', fk: 'userId', action: 'DELETE_WITH_USER',
    why: 'Membership row only. The team survives.' },
  { model: 'UserDepartmentMembership', field: 'user', fk: 'userId', action: 'DELETE_WITH_USER',
    why: 'Membership row only. The department survives.' },
  { model: 'UserRoleAssignment', field: 'user', fk: 'userId', action: 'DELETE_WITH_USER',
    why: 'A role grant. The role survives.' },
  { model: 'ManagerDeptAccess', field: 'manager', fk: 'managerId', action: 'DELETE_WITH_USER',
    why: 'A permission grant, not history.' },
  { model: 'Team', field: 'teamLead', fk: 'teamLeadId', action: 'BLOCK_DELETE',
    why: 'A team with no lead is an operational gap, not a tidy null.',
    resolution: 'Assign a new team lead first.' },

  // ── The audit trail ────────────────────────────────────────────────────
  { model: 'OperationalEvent', field: 'actor', fk: 'actorId', action: 'RETAIN_WITH_SNAPSHOT',
    why: 'The append-only forensic ledger. Never deleted, always attributable.' },
  { model: 'ActivityLog', field: 'user', fk: 'userId', action: 'RETAIN_WITH_SNAPSHOT',
    why: 'A shared feed other people read.' },
  { model: 'Notification', field: 'user', fk: 'userId', action: 'DELETE_WITH_USER',
    why: 'Personal and ephemeral.' },

  // ── HR records ─────────────────────────────────────────────────────────
  { model: 'EmployeeDocument', field: 'user', fk: 'userId', action: 'DELETE_WITH_USER',
    why: 'Their documents. Metadata archived; see the collector on binaries.' },
  { model: 'EmployeeProfileChangeRequest', field: 'targetUser', fk: 'targetUserId',
    action: 'DELETE_WITH_USER', why: 'A request about them. Archived, then removed.' },
  { model: 'EmployeeProfileChangeRequest', field: 'requestedBy', fk: 'requestedById',
    action: 'RETAIN_WITH_SNAPSHOT',
    why: 'Requests they raised about OTHER people must survive.' },
  { model: 'EmployeeProfileChangeRequest', field: 'currentApprover', fk: 'currentApproverId',
    action: 'BLOCK_DELETE',
    why: 'An in-flight approval assigned to the leaver would stall silently and forever.',
    resolution: 'Reassign or resolve the pending change request first.' },

  // ── Sales pipeline ─────────────────────────────────────────────────────
  { model: 'Lead', field: 'owner', fk: 'ownerId', action: 'BLOCK_DELETE',
    why: 'A lead with no owner is lost pipeline.',
    resolution: 'Reassign the lead to another owner first.' },
  { model: 'LeadActivity', field: 'createdBy', fk: 'createdById', action: 'RETAIN_WITH_SNAPSHOT',
    why: 'History on a lead that survives them.' },
  { model: 'FollowUp', field: 'createdBy', fk: 'createdById', action: 'RETAIN_WITH_SNAPSHOT',
    why: 'A scheduled follow-up on a surviving lead.' },
  { model: 'Requirement', field: 'owner', fk: 'ownerId', action: 'RETAIN_AND_NULL_ACTOR',
    why: 'Already nullable; the requirement survives unowned.' },
] as const;

/** `Model.field` -> rule, for a direct lookup. */
export const RULES_BY_KEY: ReadonlyMap<string, RelationRule> = new Map(
  USER_RELATION_RULES.map((r) => [`${r.model}.${r.field}`, r]),
);

export function relationKey(model: string, field: string): string {
  return `${model}.${field}`;
}

export function rulesFor(action: RelationAction): RelationRule[] {
  return USER_RELATION_RULES.filter((r) => r.action === action);
}

// ════════════════════════════════════════════════════════════════════════════
// Reading the relations out of the schema
// ════════════════════════════════════════════════════════════════════════════

export interface SchemaRelation {
  model: string;
  field: string;
  fk: string;
  required: boolean;
  onDelete: string | null;
}

/**
 * Every foreign key pointing at User, read from schema.prisma text.
 *
 * PARSED FROM THE SCHEMA, NOT FROM A LIST SOMEBODY MAINTAINS. The whole point
 * of the guard is that it notices a relation nobody told it about, so it has
 * to read the same file Prisma does.
 *
 * Back-references (`User[]` on the other side) carry no FK on this side and
 * are not returned: there is nothing to null, snapshot or delete.
 */
export function extractUserRelations(schemaText: string): SchemaRelation[] {
  const out: SchemaRelation[] = [];
  const modelBlock = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;

  for (let m = modelBlock.exec(schemaText); m; m = modelBlock.exec(schemaText)) {
    const [, model, body] = m;
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      // `///` doc comments and `//` notes can mention User without declaring one.
      if (line.startsWith('//') || !line.includes('@relation')) continue;

      const decl = /^(\w+)\s+User(\?)?\s/.exec(line);
      if (!decl) continue;

      const fields = /fields:\s*\[([^\]]+)\]/.exec(line);
      if (!fields) continue; // a named back-reference, no FK here

      const onDelete = /onDelete:\s*(\w+)/.exec(line);
      out.push({
        model,
        field: decl[1],
        fk: fields[1].trim(),
        required: !decl[2],
        onDelete: onDelete ? onDelete[1] : null,
      });
    }
  }

  return out;
}

export interface ClassificationAudit {
  total: number;
  /** In the schema but not in USER_RELATION_RULES. Deletion must refuse. */
  unclassified: SchemaRelation[];
  /** In USER_RELATION_RULES but no longer in the schema. Stale rule. */
  obsolete: RelationRule[];
  /** Classified RETAIN_AND_NULL_ACTOR or RETAIN_WITH_SNAPSHOT but NOT NULL. */
  needsNullable: SchemaRelation[];
}

/**
 * Compares the schema against the classification, both ways.
 *
 * BOTH DIRECTIONS MATTER. An unclassified relation is the dangerous one -- it
 * is deleted or orphaned by accident. An obsolete rule is merely misleading,
 * but it is how a list starts being wrong, so it is reported too.
 *
 * `needsNullable` catches the third failure: a relation we intend to RETAIN by
 * nulling the actor, on a column the database still declares NOT NULL. The
 * intent is unachievable until a migration makes it nullable, and finding that
 * out during an irreversible delete is far too late.
 */
export function auditClassification(schemaText: string): ClassificationAudit {
  const relations = extractUserRelations(schemaText);
  const seen = new Set(relations.map((r) => relationKey(r.model, r.field)));

  const retaining: RelationAction[] = ['RETAIN_AND_NULL_ACTOR', 'RETAIN_WITH_SNAPSHOT'];

  return {
    total: relations.length,
    unclassified: relations.filter((r) => !RULES_BY_KEY.has(relationKey(r.model, r.field))),
    obsolete: USER_RELATION_RULES.filter((r) => !seen.has(relationKey(r.model, r.field))),
    needsNullable: relations.filter((r) => {
      const rule = RULES_BY_KEY.get(relationKey(r.model, r.field));
      return Boolean(rule && retaining.includes(rule.action) && r.required);
    }),
  };
}
