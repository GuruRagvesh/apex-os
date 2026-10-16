# Archived-user lifecycle: design v3.2

**Status:** implemented on `claude/archived-user-lifecycle-actions`. v3.1 was the approved design; v3.2 adds only the short-transaction change below, made after the pre-commit reviews. Operations guide: [README.md](README.md).

## v3.2: no long transactions, and a failed archive changes nothing

v3.1 ran the whole archive, including the Google Drive upload and read-back, inside one database transaction of up to 15 minutes. That is not acceptable in production. Archive now runs in two phases, and no transaction is open during any network call:

1. **Backup**, no transaction: blockers, inventory, no-history classification, fingerprint, and the exact **closure plan** (tickets to close, re-home, unassign or unwatch; sessions, breaks and pending leave to end or cancel; one effective time fixed when the operation starts). With history, the Drive upload and read-back; the plan is written into the workbook as an **Archive Closures** sheet. The in-flight operation row keeps a second archive, a rehire or a deletion out. Nothing about the user changes.
2. **Commit**, one short transaction: re-lock and re-check blockers; the fingerprint and the closure-plan hash must both equal the ones the archive was built from, else `ARCHIVE_DATA_CHANGED`. Then apply the closures as planned, make the user inactive, revoke sessions, write the snapshot and `USER_ARCHIVED`. Any failure rolls all of it back.

A failure anywhere leaves the user, their work and their sessions unchanged; the pending Drive folder is removed (or the operation is left in `ARCHIVE_CLEANUP_PENDING`).

The workbook holds the data as it was immediately before the closures, plus the closure sheet describing exactly what was then applied. The snapshot therefore stores two fingerprints: `backupFingerprint` (matches the workbook manifest; checked when permanent delete re-verifies the archive) and `dataFingerprint` (the data after the closures; what permanent delete's staleness check compares). Rows the closures create as side effects (ticket history, the `USER_ARCHIVED` attendance event, any daily-attendance recalculation when the open session is ended) are not in the workbook; they follow from the closure sheet.

Every interactive transaction (the archive commit, permanent delete) has a two-minute ceiling.

## v3.1 corrections

1. **Complete external-file inventory.**
   - Sources: `User.avatar`, `User.photoUrl`, `EmployeeDocument.fileUrl`, `AttendancePunchPhoto.objectKey`, `AttendancePunchEvidence.photoObjectKey`, `AttendanceEvent.faceImageUrl`, `Attachment.url` (uploaded by the employee), `CorrectionScreenshot.content` and `data:` URLs.
   - Ticket attachments are copied and marked `shared=true`; the original is never deleted.
   - One provider object referenced by several records is copied **once**, deduplicated by its canonical provider reference, which is never logged. **Every** source reference gets its own row in the Files sheet.
2. **Single key model.**
   - `user_archive_files` holds archive-side metadata only: snapshot id, seq, provider type, shared flag, archive Drive file id and path, size and SHA-256. No handle columns.
   - The clear original reference lives only in the private workbook's Files sheet.
   - Permanent-delete preflight:
     1. downloads and verifies the workbook;
     2. reads the references from it;
     3. re-checks sharing;
     4. creates `user_deletion_cleanup_items` for non-shared originals only, encrypting and HMAC-ing each handle at that point.
   - So archive needs no lifecycle keys, delete refuses without both keys, and PostgreSQL never holds a plain handle.
3. **Partial Drive uploads.**
   - The `<archiveRef>` folder starts labelled `apexArchiveState=pending`.
   - **On any failure** (upload, read-back, checksum, privacy, workbook or DB):
     - user changes roll back and the user stays active;
     - the snapshot is never verified;
     - every uploaded file and the pending folder are deleted, and the deletion is verified.
   - **If that Drive cleanup fails:** the operation becomes `ARCHIVE_CLEANUP_PENDING`. It keeps only the random operation, snapshot and folder ids, never reports archival success, and blocks any new archive of that user until a cleanup retry succeeds. The retry is idempotent.
   - A folder without a `VERIFIED` snapshot pointing at it is never treated as an archive.
4. **Non-PII identifiers and codes.**
   - `operationId`, `receiptId`, `archiveRef`, `idempotencyKey` and the cleanup item id are random UUID v4 values, never derived from a user id, email, employee code, name or phone.
   - An active retention rule with `retentionMonths = NULL` is invalid and evaluates as `POLICY_NOT_CONFIGURED` (never zero).
   - `reasonCode`, `lastErrorCode`, operation results, event metadata and retention results use controlled enums only.
   - The identifier sweep covers operation results, idempotency keys, archive metadata, cleanup items, receipts, event JSON and error fields.

**Test additions:**
- T-ARC: attachment copied and shared; one object with many references is copied once with all rows listed.
- T-ARC-FAIL: failure after one upload; after all files but before the workbook; after the workbook but before read-back; at privacy verification; at the DB transaction; on a cleanup deletion failure, then retry.
- T-HANDLE: `user_archive_files` has no handle columns; archive works without keys; delete creates encrypted handles from the workbook.
- T-RET: a NULL-month active rule means `POLICY_NOT_CONFIGURED`.
- T-ID: ids are UUID v4 and not derived from the user.

## What changed from v2 (final design-review decisions)

| # | Decision | Where |
|---|---|---|
| R1 | Archive layout approved: one folder per snapshot version, never overwritten, nothing identifying in any name, every folder and file verified. | §4 |
| R2 | **Shared external files are now copied** into the archive (`shared=true`), verified, and excluded from provider cleanup. | §1 D4, §3, §4 |
| R3 | Cleanup references are stored as `resourceHandleEncrypted` + `resourceHandleHmac` (keyed HMAC-SHA-256). The decryptable handle is erased after a successful cleanup. **This needs two new backend secrets** (reported, see §4.4). | §4.4, §9 |
| R4 | Retention: schema plus a read-only evaluation and the default-deny gate only. No APIs or UI to change rules or holds, no seeds, no bypass. | §5 |
| R5 | Events: readers recognise legacy and new names; **new operations write only the canonical event** (no duplicates). Every event carries the full required fields. | §8 |
| R6 | `user_lifecycle_operations.userId` is nullable; it is set to NULL (with `deleteTxid`) **before** `DB_DELETED` commits. Only the random operation id and a non-PII result remain. | §6, §9 |
| R7 | Completion: `DB_DELETED` → `CLEANUP_PENDING` → `PERMANENTLY_DELETED`. `USER_PERMANENTLY_DELETED` is emitted only at the end. | §4, §8 |
| R8 | SQL exception approved. The six tests are kept, plus a seventh: userId scrubbed before commit while the authorized deletes still succeed. | §6, §10 |

**New facts established for this revision:**

| Fact | Evidence |
|---|---|
| The append-only functions only raise. Both are attached to **BEFORE UPDATE and BEFORE DELETE**. | `attendance_punch_evidence_append_only()` (migration `20260820000300…`); `prevent_workday_note_mutation()` (migration `20261008000000…`) |
| `attendance_punch_evidence.workSessionId` and `workday_notes.workSessionId` are `ON DELETE SET NULL`. Deleting a work session first would **UPDATE** protected rows. | Same migrations |
| Deletion order is therefore fixed: protected rows first, sessions after. | Inferred from the FK rules above |
| `CorrectionScreenshot.content` stores the image **bytes in Postgres**, not externally. | `schema.prisma:2312` |
| External file columns are `User.avatar`, `User.photoUrl`, `EmployeeDocument.fileUrl`, `AttendancePunchPhoto.objectKey` (and `AttendancePunchEvidence.photoObjectKey`), `AttendanceEvent.faceImageUrl` and `Attachment.url`. | `schema.prisma` |
| Providers are authenticated Cloudinary (`cloudinary:authenticated:<type>:<id>:<fmt>`), a dev-only `local-private` store, and **`data:` URLs in Postgres** when Cloudinary was unconfigured (UploadsService fallback). | `punch-photo.storage.ts`, `uploads.service.ts` |
| Leave cancellation is PENDING → CANCELLED, requester-only, plus a `LEAVE_CANCELLED` event. | `leave.service.ts:474` |
| `TicketAssignee.assignedAt` and `TicketWatcher.addedAt` exist, which gives deterministic ordering. | `schema.prisma:360,373` |
| `AttendanceMonthClose` stores only month-level totals (`employeeCount`, `unresolvedDays`), **not per-employee export rows**. A closed month's export is recomputed from live attendance rows. | `schema.prisma:1975` |

---

## 1. Revised decision table

| # | Decision | Final rule |
|---|---|---|
| D1 | Complete Excel backup | The `.xlsx` stays the structured backup.<ul><li>No row caps.</li><li>One sheet for **every table whose rows are deleted, scrubbed, nulled or reassigned**.</li><li>A `Manifest` sheet with each table's row count and a SHA-256 of its canonical rows.</li><li>A `Files` sheet listing every external object.</li><li>If any sheet would exceed **1,048,575 data rows** or any cell **32,767 characters**, archival is **refused**, never truncated.</li><li>`schemaVersion` = `archive-v2`.</li><li>Tests assert that sheet row counts equal the dependency inventory exactly.</li></ul> |
| D2 | Retention / legal-hold gate | Protected attendance, leave and payroll categories block permanent deletion unless the retention result is `NO_HOLD` or `RETENTION_APPROVED_FOR_DELETION`. There are no durations in code. With no approved company policy, the result is `RETENTION_PERIOD_ACTIVE` (reason `POLICY_NOT_CONFIGURED`). See §5. |
| D3 | Row-scoped deletion of append-only rows | **No `DISABLE TRIGGER`.** The trigger functions gain one narrow exception: a DELETE of a row owned by the user named in a `PERMANENT_DELETE` operation that is `VERIFIED_FOR_DELETE`, bound to the **current transaction id**. UPDATE stays forbidden. See §6. |
| D4 | External files archived as bytes and cleaned up | At archive:<ul><li>every external object that belongs to or is referenced by the employee is inventoried;</li><li>**every one, shared or not, is copied as bytes** into the snapshot's private Drive folder, downloaded back and verified (size + SHA-256);</li><li>shared objects are marked `shared=true`;</li><li>any failure blocks archival.</li></ul>At delete:<ul><li>a cleanup plan is built from the snapshot's **non-shared** objects only;</li><li>those originals are removed after the DB commit with provider-authenticated deletion;</li><li>shared originals are never deleted;</li><li>a failure leaves the operation `CLEANUP_PENDING` with an encrypted, HMAC'd, non-PII retry record.</li></ul>See §4. |
| D5 | Other live duties block | Archival is blocked for direct reports, active team lead, managed departments, pending approvals of every kind, open CRM leads, roles on active colleagues' attendance profiles, and any unclassified active dependency. Counts are shown by category, with no automatic reassignment. |
| D6 | Deleted Account principal | Fixed id `system-deleted-account`, email `deleted-account@system.invalid`, `isSystemAccount = true`. It is inactive, has no memberships, and its password hash can never match. Login, JWT, rehire and reactivation reject it; every list excludes it. The migration is idempotent. See §7. |
| D7 | Identity scrubbing | <ul><li>**Exact** id, email or employee code → placeholder.</li><li>**Structured actor-name** fields proven to belong to this user by an id or ownership link → `Deleted user`.</li><li>Import `rawName` is scrubbed only where the row's `userId` or exact `rawEmployeeId` belongs to this user.</li><li>Narrative text is never rewritten; mentions are counted in the receipt.</li><li>A test with two same-name employees proves the other person's text is untouched.</li></ul> |
| D8 | Sessions and reset codes | <ul><li>Additive `users.sessionsRevokedAt`, set on archive, rehire, permanent delete and admin password reset.</li><li>JWT rejects `iat < sessionsRevokedAt`.</li><li>OTP entries become `{ codeId, userId, emailAtIssue, otp, expires }`. Reset requires a matching id and email and an active user, and the code is single-use.</li><li>Entries for the user are cleared on archive, rehire and delete.</li></ul> |
| D9 | Versioned "no history" | Classification `no-history-v1` lists every checked table and the named **setup-only** rows that may be ignored:<ul><li>initial `UserRoleAssignment`;</li><li>initial `UserDepartmentMembership`;</li><li>the initial `EmployeeAttendanceProfile` (exactly one, unchanged since creation);</li><li>`OperationalEvent` `USER_CREATED`;</li><li>an empty `AppSetting user-prefs-<id>`.</li></ul>The snapshot stores the classification version, every count, the ignored counts, the fingerprint and the timestamp. The schema-coverage test fails on any unclassified user-related table. |
| D10 | Primary on a shared ticket | Remove the archived employee and promote the remaining **active** co-assignee with the earliest `assignedAt`, tie-broken by `TicketAssignee.id`. `TicketHistory` records old and new primary, the actor and the operation id. With no eligible assignee, the ticket closes through the ticket transition service. |
| D11 | Legacy archived users | They show **"Backup verification unavailable"**. Permanent Delete is disabled; Rehire stays available. There is no inference from old event metadata and no backfill. |
| C1 | Pending own leave | **Cancelled at archive** with the same PENDING → CANCELLED transition and a `LEAVE_CANCELLED` event, `reason: USER_ARCHIVED`, actor = admin. Approved, rejected and cancelled leave is untouched. To verify during implementation: pending leave does not reserve balance (if it does, the existing release path is used). |
| C2 | Ticket watchers | **Removed at archive** from every ticket not DONE/CLOSED, with a `TicketHistory` row (`field: watcher`). Watcher rows on closed tickets stay until permanent delete. |
| C3 | "Lists exclude inactive users" | No longer assumed. Each selector gets a test (see §10 T-SEL). |
| C4 | Permanent-delete gate | Not implemented until archive-v2, the external-byte verification, the retention gate, the responsibility gate, snapshot matching and the §6 SQL are reviewed and approved. |

---

## 2. Revised dependency matrix

**Action legend:**
- **At archive:** CLOSE, REMOVE, END, CANCEL, BLOCK, keep.
- **At delete:** DEL, REASSIGN (→ Deleted Account), NULL, SCRUB, NAME (→ "Deleted user"), RETAIN (blocked by the retention gate while held).
- **P** = protected retention category (§5).

### 2a. The person's own rows (all in the archive workbook)

| Model.field | P | At archive | At delete | Notes |
|---|---|---|---|---|
| WorkSession.userId | P | END open (finalizer) | DEL **after** evidence and notes | |
| BreakLog.userId | P | END open (finalizer) | DEL | |
| TicketTimeLog.userId | | ended with the session or ticket | DEL | |
| AttendanceEvent.userId | P | keep | DEL; `faceImageUrl` file → cleanup plan | |
| AttendancePunchPhoto.userId | P | keep | DEL; object → cleanup plan | |
| AttendancePunchEvidence.userId | P | keep | DEL via the §6 exception, **first** | |
| WorkdayNote.userId | P | keep | DEL via the §6 exception, before sessions | |
| AttendancePunchHandoff.userId | P | keep | DEL | |
| DailyAttendance.userId | P | keep | DEL | |
| AttendanceRegularization.userId (+ CorrectionScreenshot bytes) | P | keep | DEL | |
| LeaveRequest.userId | P | **CANCEL pending** (C1) | DEL | |
| CompOffCredit.employeeId | P | keep | DEL | |
| UserWorkdayPolicyOverride.userId | | keep | DEL | |
| EmployeeAttendanceProfile.userId | P | keep (rehire closes it) | DEL | |
| EmployeeDocument.userId | | keep | DEL; file → cleanup plan | |
| Notification.userId | | keep | DEL | |
| PushSubscription.userId | | **remove at archive** | DEL | |
| ActivityLog.userId | | keep | DEL | |
| DashboardWorkspace.userId | | keep | DEL | |
| UserRoleAssignment / UserDepartmentMembership / TeamMember / ProjectMember | | keep | DEL | |
| ManagerDeptAccess.managerId | | **BLOCK** | DEL | |
| EmployeeProfileChangeRequest.targetUserId | | keep | DEL | |
| AttendanceRecoveryTombstone.employeeId (no FK) | P | keep | DEL | |
| OperationalEvent / ActivityLog where `entityId = user` | | keep | DEL, replaced by the non-PII receipt | |
| AppSetting `user-prefs-<id>` | | keep | DEL | |
| User.avatar / photoUrl | | keep | DEL with the user; files → cleanup plan | |

### 2b. Live work and responsibilities

| Model.field | At archive | At delete |
|---|---|---|
| Ticket.assignedToId, open, **no** other assignee | **CLOSE** (transition service) | NULL |
| Ticket.assignedToId, open, with active co-assignees | **REMOVE + promote** (D10) | NULL |
| TicketAssignee.userId, open ticket | **REMOVE**; CLOSE if none left | DEL |
| TicketWatcher.userId, open ticket | **REMOVE** (C2) | DEL (closed tickets) |
| Ticket.approverId, approval PENDING | BLOCK | NULL |
| User.reportingManager = employeeId (active) | BLOCK | NULL |
| User.teamLeadName = employeeId (active) | BLOCK | NULL |
| Team.teamLeadId (active team with members) | BLOCK | NULL |
| LeaveRequest.managerApprovedById / hrApprovedById on others' PENDING | BLOCK | NULL |
| EmployeeProfileChangeRequest current/tl/manager/admin approver, PENDING | BLOCK | NULL |
| AttendanceRegularization manager/hr approver, PENDING / MANAGER_APPROVED | BLOCK | NULL |
| EmployeeAttendanceProfile.reportingManagerId / hrReviewerId on an active colleague's in-force profile | BLOCK | NULL |
| Lead.ownerId, open stage | BLOCK | REASSIGN (closed leads) |
| Any active dependency not classified | BLOCK | n/a |

### 2c. Shared records the person acted on (kept)

| Model.field | At delete |
|---|---|
| Ticket.createdById, Comment.authorId, TicketHistory.changedById, OperationalEvent.actorId (+ JSON exact-id SCRUB), EmployeeProfileChangeRequest.requestedById (for others), AttendanceImportBatch.uploadedById, LeadActivity.createdById, FollowUp.createdById, AttendanceRecoveryTombstone.deletedById | **REASSIGN** |
| Attachment.uploadedById (file stays: shared business object), ReviewCycleLog.assigneeId/reviewerId, Ticket.blockedById, AttendanceRegularization.createdById (others), AttendanceMonthClose.finalizedById, AttendanceImportBatch.approvedById/appliedById, AttendanceImportRow.userId, Requirement.ownerId, LeaveRequest.approvedBy/rejectedBy (others), EmployeeAttendanceProfile.updatedById, UserWorkdayPolicyOverride.created/updatedById, policy & override created/approved/updated/revokedById, AppSetting.updatedBy | **NULL** |
| AttendanceImportRow.rawEmployeeId (exact, case-insensitive match on this user's code) | **SCRUB** |
| AttendanceImportRow.rawName where the row's `userId` or exact `rawEmployeeId` is this user | **NAME** |
| User.verifiedBy / EmployeeDocument.verifiedBy (name text on *other* people) | Kept and counted (no ownership proof) |

### 2d. Considered and excluded
`*.supersededById`, `OperationalEvent.actorRoleId`, `PushSubscription.userAgent`, `TicketTimeLog.ownerType`/`pauseReason`, `*.employeeProfileId`, `*.leadId`, `AttendanceMonthClose.recipientEmail`, `AttendanceRegularization.actorRoleAtEntry` and `User.userLocation` are not references to a person's account.

---

## 3. Archive contents matrix (`archive-v2` workbook)

Every sheet holds **all** rows matched by the dependency inventory for that user, with no limit.

| Sheet | Source rows | Notes |
|---|---|---|
| Manifest | one row per sheet: name, row count, SHA-256 of canonical rows | plus classification version, `schemaVersion`, operation id and fingerprint |
| User Profile | the `users` row (no `password`) | |
| Role & Department memberships | UserRoleAssignment, UserDepartmentMembership, TeamMember, ProjectMember, ManagerDeptAccess | |
| Tickets Created / Assigned / Co-assigned / Watching | Ticket (createdBy, assignedTo), TicketAssignee, TicketWatcher | |
| Ticket History (by user) | TicketHistory.changedById | |
| Comments | Comment.authorId | |
| Ticket Time Logs | TicketTimeLog | |
| Attachments Uploaded | Attachment metadata | Files are **copied** (`shared=true`); originals are never deleted |
| Review Cycles | ReviewCycleLog assignee/reviewer | |
| Work Sessions / Breaks / Workday Notes | WorkSession, BreakLog, WorkdayNote | |
| Daily Attendance / Attendance Events / Punch Evidence / Punch Photos / Handoffs | the respective tables | Photo bytes go in the `files/` folder |
| Attendance Corrections + Screenshots | AttendanceRegularization, CorrectionScreenshot | Screenshot bytes are written to `files/` (they live in the DB) |
| Attendance Profiles / Workday Override | EmployeeAttendanceProfile, UserWorkdayPolicyOverride | |
| Leave / Comp-Off | LeaveRequest, CompOffCredit | |
| Recovery Tombstones | AttendanceRecoveryTombstone (employee + deletedBy) | |
| Imports involving user | AttendanceImportBatch (uploaded/approved/applied), AttendanceImportRow (userId or rawEmployeeId) | |
| Documents | EmployeeDocument metadata | Bytes go in `files/` |
| Notifications / Activity Log / Operational Events (actor and entity) | the respective tables | JSON stored as text |
| Profile Change Requests | EmployeeProfileChangeRequest (target, requestedBy, approver) | |
| CRM | Lead (owner), LeadActivity, FollowUp, Requirement | |
| Policies & Overrides acted on | AttendancePolicy/Shift/Holiday/Leave policy and BusinessDayOverride rows referencing the user | |
| Dashboard / Preferences | DashboardWorkspace, AppSetting user-prefs | |
| Files | one row per external or DB-binary object, **shared ones included** | provider, original resource reference (in the clear, inside the private archive only, for restoration), archive file id and path, size, SHA-256, shared flag |

**Excel limits:** a sheet over 1,048,575 data rows, or a cell over 32,767 characters, → `ARCHIVE_TOO_LARGE_FOR_WORKBOOK`. Archival is refused, nothing changes, and the event is recorded.

---

## 4. External-file archive and cleanup design

### 4.1 Drive layout (one private folder per snapshot version)

```
Apex OS Secure Archives/
  <environment>/
    archived-users/
      <year>/
        <archiveRef>/
          records.xlsx
          files/
            <n>-<sha256 first 12>.<ext>
```

- **`archiveRef`** is a fresh random UUID (v4) for **every** archive and re-archive.
  - A re-archive creates snapshot version N+1 in a **new** folder.
  - An earlier snapshot folder is never written to again.
  - A name collision with an existing folder is treated as an error, not reused.
- **No names in Drive:** no user name, email, employee ID, phone number or database user id appears in any folder or file name. File names use a sequence number and a hash prefix only; the extension comes from the verified MIME type.
- **Every folder and every file** must pass the privacy check: owner-only (the archive account), My Drive (not a Shared Drive), and labelled with `apexArchiveEnvironment=<env>`. The `<archiveRef>` folder also carries `apexArchiveKind=archived-user` and `apexArchiveRef=<uuid>`.
- **`records.xlsx`** holds the Manifest sheet (every sheet's row count and SHA-256) and the Files sheet (every file's mapping, size and SHA-256).

### 4.2 Archive

1. **Inventory** every object that belongs to, or is referenced by, the employee:
   - `User.avatar` and `User.photoUrl`;
   - `EmployeeDocument.fileUrl`;
   - `AttendancePunchPhoto.objectKey`;
   - `AttendanceEvent.faceImageUrl`;
   - `CorrectionScreenshot.content` (DB bytes);
   - any `data:` URL (inline bytes).
2. **Mark shared objects.** An object is **shared** when the same provider resource is also referenced by a row that survives deletion: another user's row, or a shared business object such as a ticket `Attachment`. Shared objects get `shared=true`.
3. **Copy every object's bytes, shared or not.**
   - Read with provider-authenticated access: a Cloudinary signed read, the local-private store, the decoded data URL, or DB bytes.
   - Upload to `files/`.
   - **Download it back and compare size and SHA-256** with the bytes read.
4. **Any unreadable or mismatched file blocks archival.** No snapshot is written and nothing about the user changes (v3.2).
5. **Write the workbook** (Manifest + Files), upload it, and download it back to verify.
6. **Mark the snapshot `VERIFIED`** only after the workbook **and every file** passed the read-back check, and the folder chain passed privacy before and after.

### 4.3 Permanent delete

1. **Preflight re-verifies the existing archive. It uploads or creates nothing.**
   - The folder and workbook still exist under the recorded file ids and parent, are owner-only, and are in My Drive.
   - The size and downloaded SHA-256 match.
   - Every `files/` object matches its manifest row.
2. **Build the cleanup plan** from the snapshot rows where `shared=false`, re-checking sharing at execution time. If an object has become shared since archival, it is moved out of the plan and stays.
3. **DB transaction commits.** The user is removed, the receipt and cleanup items are written, and the operation becomes `DB_DELETED`. From this point the user has no system or login access, and the archived card is gone from lists.
4. **Operation moves to `CLEANUP_PENDING`.** The admin status shows "Cleanup pending" (no handles, no names).
5. **Provider-authenticated deletion** of each planned original.
   - A success, or an authoritative "not found" from the provider, marks the item `DONE`.
   - Any other failure keeps it `PENDING`, with an attempt count and a non-sensitive error code.
6. **When every item is `DONE`:** the operation becomes `PERMANENTLY_DELETED` and **only then** is `USER_PERMANENTLY_DELETED` emitted.
7. **Retry** (`POST /users/permanent-delete/:operationId/cleanup-retry`, ADMIN/SUPER_ADMIN) processes only `PENDING` items and is idempotent.

### 4.4 Cleanup references: encrypted and keyed-HMAC

`user_deletion_cleanup_items` stores **no plain provider handle**:

| Column | Content | Lifetime |
|---|---|---|
| `resourceHandleEncrypted` | AES-256-GCM of the exact provider identifier (random 96-bit nonce, auth tag, key id) | **Erased (set NULL)** as soon as the item is `DONE` |
| `resourceHandleHmac` | HMAC-SHA-256(key, `provider` + ":" + identifier), hex | Kept, for dedup, correlation and the durable receipt |
| `provider` | `cloudinary` / `local-private` | Kept |
| `state`, `attempts`, `lastErrorCode`, `createdAt`, `updatedAt`, `completedAt` | Non-sensitive | Kept |

- **No unkeyed SHA-256** of guessable identifiers anywhere.
- **Handles never leave the backend.** They never appear in API responses, logs, console output, receipts or frontend messages. Error paths log only the item id, provider and error code.
- **The private archive** (`records.xlsx` Files sheet) keeps the original reference in the clear, because restoration needs it. It sits only inside the verified owner-only Drive folder.
- **New configuration this requires (reported per the earlier "no new flag without reason" rule):**
  - `LIFECYCLE_HANDLE_ENCRYPTION_KEY` (32 random bytes, base64);
  - `LIFECYCLE_HANDLE_HMAC_KEY` (32 random bytes, base64).
  - **Why:** R3 requires encryption plus a *keyed* HMAC, and no existing key serves either purpose. Reusing `JWT_SECRET` would couple unrelated secrets.
  - Backend-only, never in Vercel or the frontend.
  - With either key missing, **permanent delete refuses**. Archive does not need them.
  - Tests use generated local keys.

---

## 5. Retention / legal-hold design

**Protected categories** (`retention-classification-v1`):
- attendance: DailyAttendance, WorkSession, BreakLog, AttendanceEvent, AttendancePunchEvidence, AttendancePunchPhoto, AttendancePunchHandoff, WorkdayNote, AttendanceRegularization, AttendanceRecoveryTombstone, EmployeeAttendanceProfile;
- leave: LeaveRequest, CompOffCredit;
- payroll: membership in any FINALIZED `AttendanceMonthClose` month.

**Tables (additive; this branch only reads them):**
- `retention_rules`
  - `category` (unique), `retentionMonths` (nullable);
  - `policyReference`, `approvedById`, `approvedAt`, `active`.
  - **No rows are seeded.**
- `user_legal_holds`
  - `id`, `userId`, `reasonCode`, `placedById`, `placedAt`, `releasedById`, `releasedAt`.
  - **No rows are seeded.**

**Result (computed server-side in delete preflight, re-checked in the delete transaction, never accepted from the client):**

| Result | When |
|---|---|
| `LEGAL_HOLD` | Any unreleased hold. |
| `RETENTION_PERIOD_ACTIVE` | The user has protected rows **and** either no active approved rule exists for a category (reason `POLICY_NOT_CONFIGURED`), or the newest protected date + `retentionMonths` is in the future. Closed months count via their month end. |
| `RETENTION_APPROVED_FOR_DELETION` | Every category with rows has an approved rule whose period has elapsed, and there is no hold. |
| `NO_HOLD` | No protected rows and no hold. |

- **Deletion is allowed only for `NO_HOLD` or `RETENTION_APPROVED_FOR_DELETION`.**
- **Out of scope for this branch:** no API, UI or script to create or change rules or holds. No hardcoded period. **No bypass:** there is no override parameter, flag or role exception.
- **Closed payroll months stay reproducible** because their underlying rows cannot be deleted before the approved period ends.
- **UI text:** "Permanent deletion is blocked by a record-retention requirement." It shows category names only, never payroll figures, and no legal conclusions.

---

## 6. SQL: row-scoped deletion of append-only rows (approved; R6 applied)

```sql
CREATE TABLE "user_lifecycle_operations" (
  "id"             TEXT PRIMARY KEY,               -- random UUID (correlation id)
  "userId"         TEXT,                           -- required while active; NULL after deletion (R6)
  "kind"           TEXT NOT NULL CHECK ("kind" IN ('ARCHIVE','REHIRE','PERMANENT_DELETE')),
  "state"          TEXT NOT NULL,
  "deleteTxid"     TEXT,
  "snapshotId"     TEXT,
  "actorId"        TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "result"         JSONB,                          -- non-PII only
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- userId may be NULL only once the user is gone.
  CONSTRAINT "user_lifecycle_operations_user_required_while_active"
    CHECK ("userId" IS NOT NULL OR "state" IN ('DB_DELETED','CLEANUP_PENDING','PERMANENTLY_DELETED'))
);
CREATE UNIQUE INDEX "user_lifecycle_operations_one_inflight"
  ON "user_lifecycle_operations" ("userId")
  WHERE "userId" IS NOT NULL AND "state" IN ('PREFLIGHTED','RUNNING','VERIFIED_FOR_DELETE');
```

`actorId` is the administrator, a surviving user. If that administrator is ever deleted, it is handled by the REASSIGN rule like every other actor column.

`apex_row_delete_authorized()` and the two trigger functions are **unchanged from v2**:
- DELETE-only;
- checks the operation id from the transaction-local setting, `kind`, `state = 'VERIFIED_FOR_DELETE'`, the exact `userId` and `deleteTxid = pg_current_xact_id()::text`;
- UPDATE is always rejected.

**Application sequence (one transaction; R6 ordering):**

```sql
SELECT id FROM "users" WHERE id = $u FOR UPDATE;
UPDATE "user_lifecycle_operations"
   SET "state" = 'VERIFIED_FOR_DELETE', "deleteTxid" = pg_current_xact_id()::text
 WHERE "id" = $op AND "userId" = $u AND "state" = 'RUNNING';        -- must affect exactly 1 row
SELECT set_config('apex.lifecycle_operation_id', $op, true);
DELETE FROM "attendance_punch_evidence" WHERE "userId" = $u;         -- authorized: userId still set
DELETE FROM "workday_notes"             WHERE "userId" = $u;
-- … remaining matrix (DEL / REASSIGN / NULL / SCRUB / NAME), user row last …
UPDATE "user_archive_snapshots" SET "status" = 'CONSUMED_BY_PERMANENT_DELETE', "userId" = NULL
 WHERE "id" = $snap;
UPDATE "user_lifecycle_operations"
   SET "state" = 'DB_DELETED', "userId" = NULL, "deleteTxid" = NULL, "result" = $nonPiiResult
 WHERE "id" = $op;                                                   -- before COMMIT (R6)
COMMIT;
```

Once `userId` is NULL, `apex_row_delete_authorized()` can no longer match anything, so the exception cannot be reused after this point, even within the same transaction.

**PostgreSQL tests (throwaway local cluster only):**
1. A DELETE without the setting is rejected.
2. Wrong state, wrong user, or a stale or foreign txid is rejected.
3. Another user's rows are rejected inside an authorized transaction.
4. UPDATE is always rejected, authorized or not.
5. After a forced failure and rollback, protection is fully active.
6. After commit, a new transaction is rejected.
7. **(R8)** In one transaction: the authorized deletes succeed, then `userId` and `deleteTxid` are scrubbed, and the commit succeeds. After commit, the operation row holds no user id and no txid, and a further protected DELETE attempt (same or new transaction) is rejected.

---

## 7. Deleted Account principal

**Schema (additive):** `users.isSystemAccount BOOLEAN NOT NULL DEFAULT false`. Existing rows get `false` from the default; no rewrite.

**Idempotent insert:**

```sql
INSERT INTO "users" ("id","email","name","password","isActive","isSystemAccount","mustChangePassword","roleId", …required columns…)
VALUES ('system-deleted-account','deleted-account@system.invalid','Deleted account',
        '!disabled-no-login!', false, true, false, <lowest-privilege existing role id resolved by name>, …)
ON CONFLICT ("id") DO NOTHING;
```

- **Password:** the stored value is not a bcrypt hash, so `bcrypt.compare` always fails.
- **Role:** the `roleId` requirement will be confirmed against the schema during implementation. If the role must be resolved, the migration selects it by name and **fails** rather than guessing.

**Exclusion rules:**
- `login`, `jwt.strategy`, OTP send and reset reject `isSystemAccount` (alongside `isActive`).
- `rehire`, `update(isActive)`, `remove`, `archive`, `permanentDelete`, `adminCorrectEmail` and `resetPassword` refuse it.
- Every list, count, directory, selector, search, analytics and report query adds `isSystemAccount: false`. This goes through one shared helper (`humanUsersWhere()`) plus a test that greps `prisma.user.findMany/count` call sites for it.
- The UI never renders it as an employee. Where a shared record points at it, the text "Deleted user" is shown with no profile link.

---

## 8. Lifecycle states and events

```
                Deactivate (unchanged)
  ACTIVE  ─────────────────────────────▶  DEACTIVATED ──(reactivate, unchanged)──▶ ACTIVE
    │
    │ Archive: preflight ─▶ op RUNNING
    │   closes or removes active work, cancels pending leave,
    │   builds archive v<N> folder + workbook + files ─▶ read-back verify
    │   ─▶ snapshot VERIFIED | NO_HISTORY_VERIFIED
    ▼   (any failure ─▶ snapshot FAILED, user stays ACTIVE, all DB changes rolled back)
  ARCHIVED ──Rehire──▶ ACTIVE    (snapshot ─▶ INVALIDATED_REHIRED; sessions and codes revoked)
    │
    │ Permanent delete: preflight (existing archive re-verified, fingerprint, retention, responsibilities)
    │   ─▶ op VERIFIED_FOR_DELETE (txid-bound) ─▶ one DB transaction
    ▼
  DB_DELETED   (no login, no lists; op.userId = NULL)
    ▼
  CLEANUP_PENDING ──all non-shared originals deleted or authoritatively missing──▶ PERMANENTLY_DELETED
        ▲  └──retry (idempotent)──┘
```

**Event names (R5):**

| Meaning | Readers recognise | New operations write |
|---|---|---|
| Archived | `USER_ARCHIVED_AFTER_BACKUP` (legacy), `USER_ARCHIVED` | `USER_ARCHIVED` only |
| Returned to active | `USER_REACTIVATED` (legacy, also the existing reactivate toggle), `USER_REHIRED` | `USER_REHIRED` for rehire. The existing Deactivate/reactivate toggle keeps writing `USER_REACTIVATED`, unchanged. |

- The archived-state reader takes the **latest** event across all four names.
- New operations never write two equivalent events.
- **Other events:** `ARCHIVE_PREFLIGHT_COMPLETED`, `ACTIVE_WORK_CLOSED_FOR_ARCHIVE`, `ARCHIVE_BACKUP_STARTED`, `ARCHIVE_BACKUP_VERIFIED`, `ARCHIVE_NO_HISTORY_VERIFIED`, `ARCHIVE_SNAPSHOT_INVALIDATED`, `PERMANENT_DELETE_REQUESTED`, `PERMANENT_DELETE_VERIFICATION_FAILED`, `USER_PERMANENTLY_DELETED`.

**Required event metadata (every new event, `eventSchemaVersion: 1`):**
- `operationId`;
- `snapshotVersion` (where applicable);
- `actorId` (the event's `actorId` column);
- server timestamp (the `timestamp` column, server default);
- `fromState`, `toState`;
- `reasonCode`;
- `counts` (non-PII);
- `eventSchemaVersion`.

No name, email, employee code or phone appears in any of them.

**After permanent deletion:**
- `OperationalEvent` rows whose `entityId` was the user are removed. `USER_PERMANENTLY_DELETED` is written with `entityType: 'UserDeletionReceipt'` and `entityId: <receiptId>`.
- The receipt, the operation row (userId NULL) and the cleanup items carry no identifier of the former user.

---

## 9. Migration outline (one additive migration; applied only to a verified throwaway local DB until approved)

1. `users`: add `sessionsRevokedAt TIMESTAMPTZ NULL` and `isSystemAccount BOOLEAN NOT NULL DEFAULT false`. No existing values are rewritten.
2. `user_lifecycle_operations`: as in §6, with nullable `userId`, the CHECK constraint, the "one in-flight per user" partial unique index and a unique `idempotencyKey`.
3. `user_archive_snapshots`
   - **Columns:**
     - `id`, `userId` (nullable; NULL once consumed by deletion), `archiveRef` (unique UUID), `version`, `status`, `backupRequired`;
     - `provider`, `environment`, `folderId`, `folderPath`, `workbookFileId`, `workbookSizeBytes`, `workbookSha256`, `fileCount`;
     - `schemaVersion` (`archive-v2`), `classificationVersion` (`no-history-v1`), `dataFingerprint`, `dependencyCounts JSONB`, `ignoredSetupCounts JSONB`;
     - `operationId`, `createdById`, `createdAt`, `verifiedAt`, `invalidatedAt`, `invalidationReason`.
   - **Indexes:**
     - unique `(userId, version)` where `userId` is not null;
     - partial unique `(userId)` where `status IN ('VERIFIED','NO_HISTORY_VERIFIED')` (one usable snapshot).
   - **Guarantee:** `folderPath` holds only environment, year and `archiveRef`, never PII.
4. `user_archive_files`
   - `id`, `snapshotId`, `seq`, `provider`, `shared`, `archiveFileId`, `sizeBytes`, `sha256`;
   - `sourceHandleEncrypted`, `sourceHandleHmac`. The handle is encrypted at rest here too, so the DB never stores a plain provider handle. The clear reference lives only in the private workbook.
5. `user_deletion_receipts`
   - `receiptId` (random UUID, primary key), `operationId`, `archiveRef`, `snapshotVersion`;
   - `counts JSONB` (non-PII), `retentionResult`, `cleanupState`, `createdAt`, `completedAt`.
   - No user id, name, email, employee code or phone.
6. `user_deletion_cleanup_items`
   - `id`, `receiptId`, `provider`, `resourceHandleEncrypted` (nullable; erased on DONE), `resourceHandleHmac`;
   - `state`, `attempts`, `lastErrorCode`, `createdAt`, `updatedAt`, `completedAt`.
7. `retention_rules` and `user_legal_holds`: schema only. **No seed rows.**
8. `apex_row_delete_authorized()` plus the two replaced trigger functions (§6, unchanged from v2).
9. Idempotent Deleted Account insert (`ON CONFLICT ("id") DO NOTHING`) with `isSystemAccount = true` (§7).

**Not done by the migration:** no backfill, no existing user changed, nothing marked VERIFIED, no retention rule or hold created, and no staging or production apply.

**Migration verification (throwaway local cluster only):**
1. `prisma validate`.
2. `prisma migrate deploy` on an empty DB.
3. Deploy again (idempotent insert).
4. Check the CHECK constraint and indexes.
5. The §6 PostgreSQL tests.

---

## 10. Test matrix (v3 additions marked ★)

| Area | Tests |
|---|---|
| **T-COV** | <ul><li>Every User FK and user-like column is classified.</li><li>Every DEL/SCRUB/NULL/REASSIGN/NAME table has a workbook sheet.</li><li>The no-history classification names every table.</li><li>A new user-related table fails until classified.</li></ul> |
| **T-ARC** | All v2 cases, plus:<ul><li>★ a new folder per version, never overwritten, and an `archiveRef` collision is an error;</li><li>★ no PII in any Drive folder or file name;</li><li>★ every folder **and file** is owner-only, in My Drive and labelled;</li><li>★ a **shared** object is copied, verified, `shared=true`, and absent from the cleanup plan;</li><li>★ `VERIFIED` is set only after every file and the workbook are read back.</li></ul> |
| **T-HANDLE** ★ | <ul><li>Cleanup items store only encrypted + HMAC handles; no plain handle in DB rows, API responses, logs, receipts or frontend payloads.</li><li>The encrypted handle is NULL after `DONE`; the HMAC and counters stay.</li><li>The HMAC is keyed: a different key gives a different value, and unkeyed SHA-256 is never used.</li><li>A missing key → permanent delete refuses; archive is unaffected.</li></ul> |
| **T-RET** | All v2 cases, plus:<ul><li>★ no rules → `POLICY_NOT_CONFIGURED` blocks;</li><li>★ there is no endpoint or UI that writes rules or holds (route scan);</li><li>★ no request parameter or role bypasses the gate.</li></ul> |
| **T-EVT** ★ | <ul><li>Mixed history: legacy only (`USER_ARCHIVED_AFTER_BACKUP` / `USER_REACTIVATED`), new only (`USER_ARCHIVED` / `USER_REHIRED`), and multiple archive/rehire cycles mixing both all give the correct archived state.</li><li>New operations write exactly one canonical event.</li><li>Every new event carries the required fields and no PII.</li></ul> |
| **T-SQL** | The six v2 cases, plus ★ case 7 (userId and txid scrubbed before commit; authorized deletes still succeed; protection holds afterwards). |
| **T-DEL** | All v2 cases, plus:<ul><li>★ `DB_DELETED` → no login and no list presence;</li><li>★ the status shows cleanup pending;</li><li>★ `USER_PERMANENTLY_DELETED` is emitted only after every non-shared original is deleted or reported missing;</li><li>★ a retry is idempotent;</li><li>★ **identifier sweep:** after deletion, every ordinary text and JSON column in every table contains none of the former user id, email, employee code or other exact identifiers. The private Drive archive is the only place they remain.</li></ul> |
| **T-RHR, T-SYS, T-SEL, T-SEC, T-UI, T-REG** | As in v2. |

---

## 11. Implementation gate

The design is complete. **Implementation will not start without explicit approval.**

Once approved, the work runs only against:
- local test doubles (fake Drive, fake Cloudinary, fake email);
- a throwaway PostgreSQL cluster created for this purpose on `127.0.0.1:55432`, verified by the existing integration-test identity gates. Ports 5432 and 5433 are never touched.

There is no contact with Google Drive, R2, Cloudinary, Render, staging or production. No migration is applied anywhere else, no real user is touched, and nothing is committed or pushed without separate approval.
