# User Deletion — Relation Matrix

**Branch** `refactor/attendance-canonical-archive-delete` · **Date** 2026-10-01
**Method** every relation extracted from `schema.prisma` programmatically, not by reading or
by guessing from names. Script: `relations.py` (scratchpad).

**50 foreign-key relations reference `User`, across 38 models.** None is skipped below.

---

## 0. The finding that shapes everything

**35 of the 50 FK columns are `REQUIRED`, and 39 relations carry no explicit `onDelete`.**

Prisma's default for a required relation is `Restrict`. So today, `prisma.user.delete()` on
an employee who has ever created a ticket, written a comment, owned a lead or appeared in an
audit event **fails at the database level**. That is accidentally a safety property — shared
history is protected because nothing can be deleted — but it means:

> The archive-and-delete workflow cannot be built on `user.delete()` alone, and
> `RETAIN_AND_NULL_ACTOR` is **not available** for a required column without a schema change.

**Therefore Migration A is a prerequisite**, not an afterthought: the actor columns on shared
business records must become nullable before any deletion can retain them. B6 anticipates
exactly this. The migrations are additive (`DROP NOT NULL`), reversible, and must land and be
verified before the delete path is enabled.

The alternative — `onDelete: Cascade` — is explicitly rejected. It would delete the company's
tickets, comments and audit trail because one person left.

---

## 1. Legend

| Action | Meaning |
|---|---|
| `DELETE_WITH_USER` | Personal or ephemeral. No business-history value once the person is gone. |
| `RETAIN_AND_NULL_ACTOR` | The record survives; the actor reference becomes `NULL`. Needs a nullable FK. |
| `RETAIN_WITH_SNAPSHOT` | The record survives and keeps a denormalised display identity (former name / employee id), because a bare `NULL` would make the history unreadable. |
| `BLOCK_DELETE` | Must be refused until a human decides. Deleting would corrupt or orphan something. |

`MIG` marks a relation that needs a schema change before its action is possible.

---

## 2. The matrix

### 2.1 Attendance — the employee's own record

Archived in full to Drive before deletion, then removed. These are the person's own facts,
not shared company history, and the archive is the long-term record.

| Model | Relation | FK | Null? | onDelete | Business meaning | Action | Reason |
|---|---|---|---|---|---|---|---|
| `DailyAttendance` | `user` | `userId` | REQUIRED | Cascade | Official daily outcome | `DELETE_WITH_USER` | Already cascades. Personal; archived first. |
| `AttendancePunchEvidence` | `user` | `userId` | REQUIRED | (default) | Immutable punch facts | `DELETE_WITH_USER` **MIG** | Personal evidence. Needs explicit cascade or ordered delete; default Restrict blocks today. |
| `AttendancePunchPhoto` | `user` | `userId` | REQUIRED | (default) | Punch photo | `DELETE_WITH_USER` **MIG** | Personal biometric-adjacent data. Should go. |
| `AttendancePunchHandoff` | `user` | `userId` | REQUIRED | (default) | Mobile handoff token | `DELETE_WITH_USER` **MIG** | Ephemeral. |
| `AttendanceEvent` | `user` | `userId` | REQUIRED | (default) | Attendance event stream | `DELETE_WITH_USER` **MIG** | Personal. |
| `WorkSession` | `user` | `userId` | REQUIRED | (default) | Workday sessions | `DELETE_WITH_USER` **MIG** | Personal. |
| `BreakLog` | `user` | `userId` | REQUIRED | (default) | Breaks | `DELETE_WITH_USER` **MIG** | Personal; child of WorkSession. |
| `AttendanceRegularization` | `user` | `userId` | REQUIRED | Cascade | Their own corrections | `DELETE_WITH_USER` | Already cascades. |
| `AttendanceRegularization` | `createdBy?` | `createdById` | NULLABLE | (default) | Who raised it for them | `RETAIN_AND_NULL_ACTOR` | A manager who raised a correction for someone else; that correction belongs to the other person's record. |
| `EmployeeAttendanceProfile` | `user` | `userId` | REQUIRED | Cascade | Shift/policy assignment | `DELETE_WITH_USER` | Already cascades. |
| `UserWorkdayPolicyOverride` | `user` | `userId` | REQUIRED | (default) | Per-user policy override | `DELETE_WITH_USER` **MIG** | Personal configuration. |
| `CompOffCredit` | `employee` | `employeeId` | REQUIRED | (default) | Earned comp-off | `DELETE_WITH_USER` **MIG** | Personal entitlement; archived. |
| `LeaveRequest` | `user` | `userId` | REQUIRED | (default) | Their leave | `DELETE_WITH_USER` **MIG** | Personal; archived. |

### 2.2 Attendance — company lifecycle records

| Model | Relation | FK | Null? | onDelete | Business meaning | Action | Reason |
|---|---|---|---|---|---|---|---|
| `AttendanceMonthClose` | `finalizedBy?` | `finalizedById` | NULLABLE | (default) | **Who sealed a payroll month** | `RETAIN_WITH_SNAPSHOT` | The month close is a financial record. A null finalizer makes "who approved this payroll" unanswerable, so the former name is denormalised onto the row. |
| `AttendanceImportBatch` | `uploadedBy` | `uploadedById` | REQUIRED | **Restrict** | Who imported attendance | `RETAIN_WITH_SNAPSHOT` **MIG** | Deliberately Restrict today. An import that rewrote attendance must keep an attributable author. |
| `AttendanceImportBatch` | `approvedBy?` | `approvedById` | NULLABLE | **Restrict** | Who approved the import | `RETAIN_WITH_SNAPSHOT` | Same; already nullable, needs the snapshot. |
| `AttendanceImportBatch` | `appliedBy?` | `appliedById` | NULLABLE | **Restrict** | Who applied it | `RETAIN_WITH_SNAPSHOT` | Same. |

### 2.3 Tickets — shared company work

**The central case.** A ticket created by the leaver but worked by others is the company's,
not theirs.

| Model | Relation | FK | Null? | onDelete | Business meaning | Action | Reason |
|---|---|---|---|---|---|---|---|
| `Ticket` | `createdBy` | `createdById` | **REQUIRED** | (default) | Who raised the work | `RETAIN_WITH_SNAPSHOT` **MIG** | **Blocks deletion today.** The ticket survives; the creator becomes a former-employee snapshot. |
| `Ticket` | `assignedTo?` | `assignedToId` | NULLABLE | (default) | Current owner | `RETAIN_AND_NULL_ACTOR` | Unassigns rather than deletes. Open work returns to the queue. |
| `Ticket` | `approver?` | `approverId` | NULLABLE | (default) | Who must approve | `RETAIN_AND_NULL_ACTOR` | Approval re-routes; see §4. |
| `TicketAssignee` | `user` | `userId` | REQUIRED | (default) | Multi-assignee join | `DELETE_WITH_USER` **MIG** | A membership row, not history. The ticket survives. |
| `TicketWatcher` | `user` | `userId` | REQUIRED | (default) | Watch subscription | `DELETE_WITH_USER` **MIG** | Ephemeral preference. |
| `TicketHistory` | `changedBy` | `changedById` | **REQUIRED** | (default) | Status-transition audit | `RETAIN_WITH_SNAPSHOT` **MIG** | Audit history must survive and stay attributable. |
| `TicketTimeLog` | `user` | `userId` | REQUIRED | (default) | **Productive time ledger** | `RETAIN_WITH_SNAPSHOT` **MIG** | Payroll- and SLA-relevant. Deleting it would silently change historical ticket cost. |
| `ReviewCycleLog` | `assignee?` | `assigneeId` | NULLABLE | (default) | Review/rework cycle | `RETAIN_AND_NULL_ACTOR` | Cycle survives. |
| `ReviewCycleLog` | `reviewer?` | `reviewerId` | NULLABLE | (default) | Who reviewed | `RETAIN_WITH_SNAPSHOT` | Who approved work is attributable history. |
| `Comment` | `author` | `authorId` | **REQUIRED** | (default) | Discussion on shared work | `RETAIN_WITH_SNAPSHOT` **MIG** | A thread with holes is unreadable. Content stays, author becomes a snapshot. |

### 2.4 Org structure and membership

| Model | Relation | FK | Null? | onDelete | Business meaning | Action | Reason |
|---|---|---|---|---|---|---|---|
| `ProjectMember` | `user` | `userId` | REQUIRED | Cascade | Project membership | `DELETE_WITH_USER` | Already cascades. **The project survives** — only the membership row goes. |
| `TeamMember` | `user` | `userId` | REQUIRED | Cascade | Team membership | `DELETE_WITH_USER` | Same. |
| `UserDepartmentMembership` | `user` | `userId` | REQUIRED | Cascade | Department membership | `DELETE_WITH_USER` | Same. |
| `UserRoleAssignment` | `user` | `userId` | REQUIRED | Cascade | Role assignment | `DELETE_WITH_USER` | Same. |
| `Team` | `teamLead?` | `teamLeadId` | NULLABLE | (default) | Who leads a team | `BLOCK_DELETE` | A team with no lead is an operational gap, not a tidy null. Requires reassignment first — see §4. |
| `ManagerDeptAccess` | `manager` | `managerId` | **REQUIRED** | (default) | Manager's dept scope | `DELETE_WITH_USER` **MIG** | A permission grant, not history. |
| `Department` / `Role` | `users[]` etc. | — | implicit | (default) | Back-references | `RETAIN_AND_NULL_ACTOR` | No FK on this side; nothing to do. The department and role survive. |

### 2.5 Audit and notifications

| Model | Relation | FK | Null? | onDelete | Business meaning | Action | Reason |
|---|---|---|---|---|---|---|---|
| `OperationalEvent` | `actor` | `actorId` | **REQUIRED** | (default) | **Append-only audit ledger** | `RETAIN_WITH_SNAPSHOT` **MIG** | The forensic record. Must never be deleted and must stay attributable. The strongest case for a snapshot rather than a null. |
| `ActivityLog` | `user` | `userId` | REQUIRED | (default) | Activity feed | `RETAIN_WITH_SNAPSHOT` **MIG** | Shared feed; others' entries reference it. |
| `Notification` | `user` | `userId` | REQUIRED | (default) | Their notifications | `DELETE_WITH_USER` **MIG** | Personal and ephemeral. |

### 2.6 HR records

| Model | Relation | FK | Null? | onDelete | Business meaning | Action | Reason |
|---|---|---|---|---|---|---|---|
| `EmployeeDocument` | `user` | `userId` | REQUIRED | Cascade | Their documents | `DELETE_WITH_USER` | Cascades. **Metadata archived; Cloudinary binaries are external — see §5.** |
| `EmployeeProfileChangeRequest` | `targetUser` | `targetUserId` | **REQUIRED** | (default) | Request about them | `DELETE_WITH_USER` **MIG** | Theirs; archived. |
| `EmployeeProfileChangeRequest` | `requestedBy` | `requestedById` | **REQUIRED** | (default) | Who raised it | `RETAIN_WITH_SNAPSHOT` **MIG** | Requests about *other* people must survive. |
| `EmployeeProfileChangeRequest` | `currentApprover?` | `currentApproverId` | NULLABLE | (default) | Pending approver | `BLOCK_DELETE` | An in-flight approval assigned to the leaver stalls silently. Must be reassigned — §4. |

### 2.7 Sales CRM

| Model | Relation | FK | Null? | onDelete | Business meaning | Action | Reason |
|---|---|---|---|---|---|---|---|
| `Lead` | `owner` | `ownerId` | **REQUIRED** | (default) | Lead ownership | `BLOCK_DELETE` | A lead with no owner is lost pipeline. Reassign first. |
| `LeadActivity` | `createdBy` | `createdById` | **REQUIRED** | (default) | Activity on a lead | `RETAIN_WITH_SNAPSHOT` **MIG** | History on a surviving lead. |
| `FollowUp` | `createdBy` | `createdById` | **REQUIRED** | (default) | Scheduled follow-up | `RETAIN_WITH_SNAPSHOT` **MIG** | Survives on the lead. |
| `Requirement` | `owner?` | `ownerId` | NULLABLE | (default) | Requirement ownership | `RETAIN_AND_NULL_ACTOR` | Already nullable. |

---

## 3. Totals

| Action | Count |
|---|---|
| `DELETE_WITH_USER` | 21 |
| `RETAIN_WITH_SNAPSHOT` | 14 |
| `RETAIN_AND_NULL_ACTOR` | 8 |
| `BLOCK_DELETE` | 4 |
| implicit back-references (no action) | 3 |
| **total** | **50** |

**22 relations need a migration** before their action is possible — almost all because a
required actor column has to become nullable, or an implicit Restrict has to become an
explicit, intentional cascade.

---

## 4. The four `BLOCK_DELETE` relations

These are not defects. They are the cases where deleting silently would leave the company
worse off in a way no snapshot can express:

| Relation | What breaks | Required of the operator |
|---|---|---|
| `Team.teamLead` | A team with no lead | Reassign the team lead |
| `EmployeeProfileChangeRequest.currentApprover` | An approval stalls forever | Reassign or resolve it |
| `Lead.owner` | Pipeline with no owner | Reassign the lead |
| `Ticket.approver` (when pending) | A ticket cannot be approved | Reassign or resolve |

The workflow must **refuse** and name the blocking records, so an administrator fixes them
and retries. Failing closed here is the point: a silent null would be discovered weeks later
by whoever needed the approval.

---

## 5. What deletion cannot reach

Recorded so the archive is not mistaken for completeness:

- **Cloudinary binaries.** `EmployeeDocument` and `AttendancePunchPhoto` metadata is archived
  and the rows are deleted, but the image bytes live in Cloudinary. Removing those is a
  separate external action.
- **Attachments stored as base64 in PostgreSQL.** Some attachment bytes are in the database
  and some in Cloudinary, depending on configuration at upload time
  (`APEX_OS_COMPLETE_ARCHITECTURE.md` §17), so the split is not uniform.
- **R2 backup vault.** Prior database backups still contain the employee. That is the
  intended behaviour of a backup and is not in scope for a deletion request.

---

## 6. Sequencing

1. **Migration A** — make the 14 `RETAIN_WITH_SNAPSHOT` actor columns nullable and add the
   snapshot columns (`formerActorName`, `formerActorEmployeeId`). Additive, reversible.
2. **Migration B** — make the `DELETE_WITH_USER` relations explicitly cascade, rather than
   relying on an implicit Restrict that the workflow would have to work around.
3. Only then implement the delete transaction against this matrix.
4. `BLOCK_DELETE` is enforced **before** the archive is built, so an operator is not told
   "archived, then failed".

No migration here is destructive and none is applied to production.
