# Archived-user lifecycle: operations runbook

How Archive, Rehire and Permanently delete work in Users & Roles, what they need configured, and what to do when one fails. The design and its decisions are in [DESIGN.md](DESIGN.md); the pre-commit evidence is in [PRECOMMIT-REPORT.md](PRECOMMIT-REPORT.md) and [screenshots/](screenshots/).

**Nothing here is run by hand against a real user.** Every action goes through the app, by an ADMIN or SUPER_ADMIN, one user at a time. There is no bulk path, no script and no deletion list.

## Configuration

The backend web service needs these, in its own environment only. Never in Vercel, the frontend, GitHub or chat.

| Variable | Purpose |
|---|---|
| `GOOGLE_DRIVE_*` | The private archive vault. Set up and verified as described in [permanent-deletion-storage](../permanent-deletion-storage/README.md). |
| `LIFECYCLE_HANDLE_ENCRYPTION_KEY` | 32 random bytes, base64. Encrypts (AES-256-GCM) the provider references of files that a permanent deletion still has to remove. |
| `LIFECYCLE_HANDLE_HMAC_KEY` | 32 random bytes, base64, different from the encryption key. Keyed SHA-256 of each reference, so a cleanup retry can be matched without decrypting. |

Generate each key separately, on a trusted machine, and paste it straight into the backend's environment:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

- Archive and Rehire do not need the two handle keys. **Permanent delete refuses with `HANDLE_KEYS_MISSING`** when either is absent or not exactly 32 bytes.
- Use different keys per environment.
- **Do not rotate the keys while a deletion is in `CLEANUP_PENDING`.** Its stored references can only be decrypted with the keys that wrote them. Finish or retry the cleanup first.
- A lost key never exposes data. It only means pending cleanup items must be removed from the provider by hand.

The migration `20261014000000_user_lifecycle_archive` must be applied before the code is deployed. It adds the lifecycle tables, `users.isSystemAccount`, `users.sessionsRevokedAt`, the row-scoped append-only DELETE exception, and the "Deleted account" principal (only when the INTERN role exists).

## Archive

Archive is allowed for active and deactivated users. It is refused, with nothing changed, when the user still has responsibilities someone else must take over first: direct reports, managed departments or teams, led teams, tickets awaiting their approval, or approval-chain roles. The preflight lists them.

**Nothing about the user changes until the backup is verified.** No database transaction is open while Google Drive or a file provider is being called, and the one transaction is short (two-minute ceiling).

1. **Backup** (no transaction). Check the blockers, take the inventory and work out exactly what archiving will close. With no history (classification `no-history-v1`) nothing is uploaded. Otherwise write the archive folder in Drive: the complete workbook, including an **Archive Closures** sheet listing every ticket to close, re-home, unassign or unwatch, every session, break and pending leave to end or cancel, and the effective time; and a copy of every file. Each is read back and compared by size and SHA-256. The in-flight operation stops a second archive, a rehire or a deletion from starting meanwhile; the user keeps working normally.
2. **Commit** (one transaction). Re-lock the user and re-check the blockers. The data fingerprint **and** the closure plan must both equal what the archive was built from; otherwise the archive is refused with `ARCHIVE_DATA_CHANGED`. Then, all together: close tickets only they hold, re-home shared ones to the earliest active co-assignee, remove them as co-assignee and watcher, end their session and breaks, cancel their pending leave, make them inactive, revoke their sessions, and write the snapshot and `USER_ARCHIVED`.

The snapshot keeps two fingerprints: the one the workbook was built from, and the one after the closures, which permanent delete later compares against.

### When an archive fails

**Nothing about the user changes.** Whether the backup fails, the data changes meanwhile, or the final transaction fails, the user keeps their work, their status and their sessions; the pending Drive folder is removed; the operation is recorded as `FAILED` with its reason code. Archiving can simply be tried again.

If the Drive folder itself cannot be removed, the operation is left in `ARCHIVE_CLEANUP_PENDING`, and no new archive for that user starts until **Retry cleanup** (`POST /user-lifecycle/operations/:id/archive-cleanup-retry`) succeeds. Retrying is safe to repeat.

## Rehire

Rehire is the only way back from archived, from the archived card or from **Add user** with the same email. It may change the email (checked for uniqueness), invalidates the archive snapshot (`INVALIDATED_REHIRED`), revokes old sessions, and reopens nothing. A later archive is a new version in a new folder. Edit and Reactivate refuse archived users.

## Permanently delete

Only for an archived user whose snapshot is still usable. Before anything is deleted the preflight re-checks, and the deletion refuses on any of:

- the snapshot is missing, stale, from another environment, or invalidated by a rehire;
- the data fingerprint no longer matches the snapshot, or new live work appeared;
- the archive in Drive is missing or its bytes changed;
- retention (`RETENTION_PERIOD_ACTIVE`, `LEGAL_HOLD`, or `POLICY_NOT_CONFIGURED` when no rule applies; default deny);
- `HANDLE_KEYS_MISSING`.

The admin types the user's email to confirm. The database deletion is one short transaction with no network calls. External files are removed afterwards: the operation goes `DB_DELETED` → `CLEANUP_PENDING` → `PERMANENTLY_DELETED`. Shared files (for example ticket attachments) are copied into the archive but never deleted. If a provider is down, **Retry cleanup** (`POST /user-lifecycle/operations/:id/cleanup-retry`) is idempotent.

Users archived before this feature show **"Backup verification unavailable"** and cannot be permanently deleted.

## Checking an operation

`GET /user-lifecycle/operations/:id` returns its state, reason code and counts. Reason codes are fixed values, never free text. Neither the operation nor its events hold the user's name or email after deletion.
