# Archived-user lifecycle: pre-commit report (v3, failed archive changes nothing)

**Status:** implemented, synchronized with staging and fully re-validated. **Nothing is committed, pushed, migrated outside the throwaway database, or deployed.** Nothing is staged.

## What changed since the first report

| Review item | Done |
|---|---|
| 1. Synchronize with staging | Fast-forwarded from `b6617f2` to `origin/staging` `843d5eb`. Staging added migration `20261013000000_regularization_other_request_type`, so this branch's migration was renamed to `20261014000000_user_lifecycle_archive` to keep it last. Staging's schema change (`OTHER` request type) merged cleanly. The temporary stash was verified and dropped. |
| 2. Full validation after sync | All green after the final change, below (§12 to §17). |
| 3. Remove the legacy permanent-deletion code | `UsersService.permanentDelete`, `activeResponsibilities`, `archiveAfterBackup`, `resolveArchiveRecipients` and `BackupVaultService.archiveUserToDrive` are deleted, together with their tests (`archive-user-google-drive.spec.ts`, t10 U1 to U3, the archive-after-backup safety tests). The lifecycle module is the only archive and deletion path. |
| 4. Handle keys documented | `LIFECYCLE_HANDLE_ENCRYPTION_KEY` and `LIFECYCLE_HANDLE_HMAC_KEY` added to `backend/.env.example` and `backend/.env.production.example`, with the generation command, and to the runbook ([README.md](README.md)). |
| 5. Long transaction removed | No transaction is open during any Drive or provider call; every interactive transaction has a two-minute ceiling (was 15 minutes). |
| 7. Failed archive changes nothing (second review) | Work closure and deactivation moved into the final short transaction, after the backup is verified and the fingerprint and closure plan are revalidated (§8). A failed backup leaves the user, their work and their sessions unchanged. |
| 6. Reports preserved | This report, the design ([DESIGN.md](DESIGN.md), now v3.2) and the 10 [screenshots](screenshots/) are in `docs/operations/archived-user-lifecycle/`, and linked from `docs/operations/README.md`. |

## 1. Branch and base

| | |
|---|---|
| Branch | `claude/archived-user-lifecycle-actions` |
| Base | `origin/staging` @ `843d5eb` (merge of #106) |
| `git log origin/staging..HEAD` | empty (no commits) |
| Purge commits | `fb2ac68` and `ef893df` are not ancestors; the old safety stash was not restored |
| Untouched local files, **not part of this change** | `backend/.user-purge/` and `user-purge-cli-report.md` (pre-existing, untracked) |

## 2. Complete file list

**Modified (23) and deleted (1):** `24 files changed, 837 insertions(+), 1578 deletions(-)`.

| File | What changed |
|---|---|
| `backend/.env.example`, `backend/.env.production.example` | The two handle keys, blank, with the generation command |
| `backend/prisma/schema.prisma` | 7 models (the snapshot now also has `backupFingerprint`), 2 User columns |
| `backend/src/app.module.ts` | Registers `UserLifecycleModule` |
| `backend/src/modules/core/auth/auth.service.ts` | Login and OTP refuse system and inactive accounts; OTP bound to user id, email, issue time and code id; one-time codes |
| `backend/src/modules/core/auth/strategies/jwt.strategy.ts` | Rejects `iat < sessionsRevokedAt` and system accounts |
| `backend/src/modules/core/users/users.controller.ts` | Old archive and permanent-delete routes removed; rehire accepts `email` |
| `backend/src/modules/core/users/users.service.ts` | Rehire extended (email, lock, snapshot invalidation, session revocation, canonical event); system-account guards; toggle refuses archived users; **legacy archive and delete methods removed** |
| `backend/src/modules/operations/tickets/tickets.service.ts` | Archive ticket plan/apply through the existing prepare/commit path |
| `backend/src/modules/platform/backup-vault/backup-vault.service.ts` | **`archiveUserToDrive` removed** |
| `backend/src/modules/platform/backup-vault/drive-vault.ts` | `setAppProperties` |
| `backend/src/prisma/prisma.service.ts` | Middleware excluding system accounts from User lists, counts, groupBy and aggregate |
| `backend/test/helpers/fake-drive-vault.ts` | Recursive delete, `failRemove`, `setAppProperties` |
| `backend/test/integration-pg/t10-review-gate-and-attachment-ownership.int-spec.ts` | U1 to U3 (legacy delete) removed |
| `backend/test/unit/archive-user-google-drive.spec.ts` | **Deleted** (legacy archive path) |
| `backend/test/unit/attendance-import-persistence.spec.ts` | Test 32 re-pointed from the legacy delete's counts to the lifecycle matrix (see Decisions, 2) |
| `backend/test/unit/backup-vault-authority.spec.ts` | Asserts archival goes only through the lifecycle Drive path |
| `backend/test/unit/phase6d-qc-ui.spec.ts` | Counts the lifecycle modal shell; checks the Archive, Rehire and Delete actions |
| `backend/test/unit/user-lifecycle-safety.spec.ts` | Legacy archive tests removed; matrix and reader tests kept |
| `backend/test/unit/users.rehire.spec.ts` | Canonical event; snapshot, email, lock, system-account and race tests |
| `docs/operations/README.md`, `docs/operations/permanent-deletion-storage/README.md` | Links to the runbook |
| `platforms/core/users/administration/frontend/api/users-api.ts` | Lifecycle endpoints |
| `platforms/core/users/administration/frontend/screens/UsersScreen.tsx` | Archive action; archived-card Rehire and Delete; old modals removed |

**New:**

| File | Lines |
|---|---|
| `backend/prisma/migrations/20261014000000_user_lifecycle_archive/migration.sql` | 256 |
| `backend/src/modules/core/users/lifecycle/` (12 files) | 2,376 (service 1,066) |
| `backend/test/integration-pg/l1-user-lifecycle.int-spec.ts` | 688 |
| `backend/test/unit/user-lifecycle-matrix.spec.ts`, `user-lifecycle-units.spec.ts`, `auth-lifecycle-revocation.spec.ts` | 118, 179, 83 |
| `platforms/core/users/administration/frontend/screens/UserLifecycleModals.tsx` | 297 |
| `docs/operations/archived-user-lifecycle/` | README (runbook), DESIGN (v3.2), this report, 10 screenshots |

**Not modified:** Quick Ticket Tags, the Deactivate behaviour, and every other module.

## 3. Migration (`20261014000000_user_lifecycle_archive`)

Renamed to sort after staging's new migration, and `user_archive_snapshots` gained one nullable column, `backupFingerprint` (§8). Otherwise unchanged. All additive:
- `users.isSystemAccount`, `users.sessionsRevokedAt`; seven lifecycle tables with no FK to `users`;
- the userId-while-active and kind CHECKs; partial uniques for one in-flight operation and one usable snapshot per user;
- `apex_row_delete_authorized()` and the two replaced append-only trigger functions (DELETE-only, row-scoped, transaction-bound; UPDATE always raises; never `DISABLE TRIGGER`);
- an idempotent Deleted-account insert.

No backfill, no existing row changed, no retention rule or legal hold seeded.

## 4. Lifecycle state diagram

```
ACTIVE ──Deactivate (unchanged)──▶ DEACTIVATED ──reactivate toggle (refused if ARCHIVED)──▶ ACTIVE
ACTIVE/DEACTIVATED ──Archive──▶ ARCHIVED
   1 backup (no tx): blockers, inventory, closure plan, Drive upload + read-back
   2 commit (tx): fingerprint and plan unchanged → close work as planned, inactive,
                  sessions revoked, snapshot, USER_ARCHIVED
   any failure → user, work and sessions unchanged; folder removed (or ARCHIVE_CLEANUP_PENDING)
ARCHIVED ──Rehire──▶ ACTIVE (snapshot INVALIDATED_REHIRED; re-archive = version N+1, new folder)
ARCHIVED ──Permanently delete──▶ DB_DELETED ──▶ CLEANUP_PENDING ──retry──▶ PERMANENTLY_DELETED
```

## 5. Dependency matrix

88 handlers plus the excluded columns, unchanged. The schema-coverage test parses `schema.prisma` and fails on any unclassified user reference; it passes against the synced schema.

## 6. Active-work handling

Unchanged rules (close sole tickets, promote the earliest co-assignee, remove co-assignee and watcher rows, end sessions and breaks at server time, cancel pending own leave, delete push subscriptions; block on direct reports, managed departments or teams, led teams, tickets awaiting approval and approval-chain roles). They now run in the **final short transaction**, only after the backup is verified.

## 7. Backup / no-history decision

Unchanged (`no-history-v1`; complete `archive-v2` workbook; every file copied and read back; privacy before and after). It now runs **first, outside any transaction, before anything about the user changes**.

## 8. The archive sequence (new)

1. **Backup**, no transaction. Blockers, inventory, fingerprint, and the exact **closure plan**: tickets to close, re-home, unassign or unwatch; sessions, breaks and pending leave to end or cancel; one effective time fixed when the operation starts. With history, the workbook (which includes the plan as an **Archive Closures** sheet) and every file are uploaded and read back. The in-flight operation row (partial unique index) keeps a second archive, a rehire or a deletion out. **Nothing about the user changes.**
2. **Commit**, one short transaction. Re-lock, re-check blockers, and require both the fingerprint and the closure-plan hash to equal the backup's, else **`ARCHIVE_DATA_CHANGED`**. Then apply the closures as planned, make the user inactive, revoke sessions, and write the snapshot and `USER_ARCHIVED`. Any failure rolls all of it back.

**Any failure** leaves the user, their tickets, sessions, breaks, leave and sign-in exactly as they were. The pending Drive folder is removed, or the operation is left in `ARCHIVE_CLEANUP_PENDING`. The operation is `FAILED` with its reason code only.

**Two fingerprints.** The workbook is the data immediately before the closures, plus the closure sheet describing exactly what was then applied. The snapshot stores:
- `backupFingerprint`, matching the workbook manifest; checked when permanent delete re-verifies the archive;
- `dataFingerprint`, the data after the closures; what the deletion staleness check compares.

Rows the closures create as side effects (ticket history, the attendance `USER_ARCHIVED` event, any daily-attendance recalculation when the open session ends) are not in the workbook; they follow from the closure sheet.

New reason code: `ARCHIVE_DATA_CHANGED`. The earlier `ARCHIVE_FAILED_USER_RESTORED` event and the restore step are gone.

## 9. Existing-backup verification and permanent delete

Unchanged. Deletion re-verifies the existing archive and never uploads; the DB deletion is one short transaction with no network I/O; cleanup is `DB_DELETED` → `CLEANUP_PENDING` → `PERMANENTLY_DELETED`; shared files are never deleted.

## 10. Rehire

Unchanged from the approved design: only path back from archived; snapshot invalidated; sessions revoked; nothing reopened.

## 11. API endpoints and role guards

Unchanged: eight `/user-lifecycle/...` routes (ADMIN and SUPER_ADMIN only) plus the extended `POST /users/:id/rehire`. The old `archive-after-backup` and `DELETE /users/:id/permanent` routes are gone, and so is the code behind them.

## 12. Tests and exact totals (all after the sync, mirror refreshed once before each run, nothing synced during a run)

| Run | Result |
|---|---|
| **Full backend unit suite**, one clean run | **161 suites, 3,588 tests: all passed** (316 s) |
| **All PostgreSQL integration suites**, fresh throwaway DB | **30 suites, 528 tests: all passed** (588 s) |
| of which `l1-user-lifecycle` | 25 tests, including the 6 failed-archive and closure tests below and the 7 SQL exception cases |

New integration cases (each failure case asserts every ticket, assignee, watcher, session, break, leave, event, snapshot and Drive folder is unchanged):
- a failed backup (unreadable file) changes nothing, and a later archive succeeds;
- a failure inside the final transaction (an injected trigger on the leave update) rolls everything back and removes the uploaded archive;
- data changed during the backup gives `ARCHIVE_DATA_CHANGED` and changes nothing; the retry succeeds and includes the change;
- only the closure plan changed during the backup (the co-assignee was deactivated) gives `ARCHIVE_DATA_CHANGED`;
- a deactivated user stays deactivated with nothing closed;
- the workbook's Archive Closures sheet lists every closure, and the permanent-delete preflight finds the snapshot neither stale nor mismatched.

Before the clean run, two problems surfaced and were fixed, then the whole suite was run again from scratch:
- staging's `attendance-import-persistence` test 32 was pinned to the removed legacy delete. It now checks the lifecycle matrix;
- `phase6d-qc-ui` pinned the delete button's old static title. It now checks the Archive, Rehire and Delete titles.

## 13. TypeScript and build

| Check | Result |
|---|---|
| Backend `tsc --noEmit -p tsconfig.json` | Exit 0 |
| Backend `tsc --noEmit -p tsconfig.scripts.json` | Exit 0 |
| Frontend `tsc --noEmit -p tsconfig.json` | Exit 0 |
| **Frontend `next build`** | **Exit 0.** `/users` built (15.2 kB). The lint warnings it prints are all in files this change does not touch. |

## 14. Prisma

- `prisma validate`: valid.
- `migrate deploy` on a newly created throwaway database: all 60 migrations applied; a second deploy reported "No pending migrations".
- `migrate diff --from-url <db> --to-schema-datamodel`: empty migration (no drift).

## 15. Architecture

- `validate-boundaries.mjs`: "OK — no boundary violations found".
- `validate-boundaries.test.mjs`: 1 / 1 passed.

## 16. `git diff --check`

Clean, including new files.

## 17. Secret scan

Added lines were scanned for client secrets, refresh and access tokens, AWS, Stripe, Slack and GitHub keys, private keys and 32-byte base64 keys. The only hits are environment-variable *names* in existing Cloudinary configuration code. The env examples carry blank keys only. Tests generate random keys at run time.

## 18. Screenshots

In [screenshots/](screenshots/), all from synthetic demo users against the throwaway database (01 to 10, as listed in the first report: archive preflight, active-work confirmation, no-history archive, active card, archived cards, typed delete confirmation, after delete with the legacy card disabled, Rehire, the Add User same-email shortcut, and a refused archive leaving the user unchanged). The UI did not change since they were taken.

## 19. Real users and external environments

No real user was touched. No contact with staging or production databases, Google Drive, R2, Cloudinary, Render or Vercel. Migrations ran only on the throwaway cluster `127.0.0.1:55432` (data directory confirmed before each reset). Your servers on 3000 and 3001 and your databases on 5432 and 5433 were not touched.

## 20. No unrelated feature in the diff

No Quick Ticket Tags change and no other module change beyond the list above.

## Decisions

1. **Failed archive:** corrected as directed. Nothing changes unless the whole archive succeeds.
2. **Import batches:** approved. The batch is preserved, the uploader is re-assigned to the Deleted Account, approver and applier are cleared, and all are archived first.
3. **Unused `EmailService` / `BackupVaultService` injections in `UsersService`:** accepted as a follow-up.
4. Already approved: `no-history-v1`, Drive-only archives with no email, rehire-only restoration, session revocation, deleting the legacy methods.

**Known operational limitation:** users with attendance, leave or payroll history cannot be permanently deleted until retention rules are configured. With no rule the gate deliberately refuses (`POLICY_NOT_CONFIGURED`).
