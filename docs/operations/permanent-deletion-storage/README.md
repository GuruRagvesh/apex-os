# Permanent-deletion storage: configuration and verification

This covers only the two storage systems that a permanent deletion will depend on, and the commands that configure and verify them. **Nothing here selects, archives or deletes a user.** The deletion workflow itself, and the frontend Permanent Delete action, are separate, later changes.

| Storage | Holds | Where | Credentials |
|---|---|---|---|
| Cloudflare R2 | Full database backups. A recent verified backup is required before any permanent deletion. | One private bucket per environment. Production must be exactly `apex-os-production-backups`. Staging uses its own bucket, declared in `EXPECTED_STAGING_VAULT_BUCKET` and named with "staging". | `R2_*` |
| Google Drive | Per-user archives: "Archive user" backups now, permanent-deletion archives later | A private Google Drive owned by `ai.technoedge@gmail.com`: `Apex OS Secure Archives/<environment>/…` | `GOOGLE_DRIVE_*` |

The two never mix. User archives never go to R2, and database backups never go to Drive.

## R2: database backups

`npm run backup:database` runs with `APP_ENV=production` or `APP_ENV=staging`. Before reading anything it proves the target (`assertBackupTarget` in `backend/scripts/backup/backup-identity.ts`):

- The database host and name in `DATABASE_URL` must equal `EXPECTED_<ENV>_DB_HOST` / `EXPECTED_<ENV>_DB_NAME`, which are read independently from the provider dashboard.
- Production may use only `apex-os-production-backups`.
- Staging may use only the bucket in `EXPECTED_STAGING_VAULT_BUCKET`. That bucket must be named as a staging bucket and can never be the production bucket.

Each backup:
1. dumps the database;
2. checks the dump with `pg_restore --list`, which must show table data;
3. uploads it;
4. checks the remote size;
5. **downloads it again and compares its SHA-256** with the local dump;
6. writes a manifest (`manifests/YYYY-MM-DD/<id>.json`) recording the environment, the vault bucket, the masked database name, the size and the SHA-256.

**The backup proof a deletion will require** is `verifyDatabaseBackup` (`backend/scripts/backup/verify-backup-reference.ts`). All of these must hold:
- the manifest says SUCCESS and was remote-verified within **24 hours**;
- its environment, vault bucket and masked database name match the target, and a missing vault field is refused;
- the dump is present at the recorded size, and is downloaded and **re-hashed**;
- the local `pg_restore` is at least the major version of the server recorded in the manifest, and `pg_restore --list` can read the dump.

Screenshots, logs and file names are not accepted as proof.

**Health check:** `npm run admin:r2:verify -- --environment=staging`.
- It validates the environment, database identity and exact bucket without connecting to the database.
- It writes random bytes to `healthcheck/<environment>/<uuid>`, checks the size, downloads them, compares the SHA-256, deletes the object and confirms it is gone.
- It never prints credentials.

## Google Drive: per-user archive vault

**Access.** OAuth 2.0 offline access with the narrow `https://www.googleapis.com/auth/drive.file` scope. Apex OS can see only the files and folders it created itself, so **the root folder must be created by the tool, not by hand**.

**Layout:**

```
Apex OS Secure Archives/
├── staging/
│   ├── healthcheck/        disposable verification files only
│   ├── archived-users/
│   │   └── <year>/         "Archive user" backups, written by the app server
│   └── deleted-users/
│       └── <year>/         created only when the first real archive is stored
└── production/             same structure, separate
```

Every folder is labelled with the environment it belongs to, so a staging run refuses a folder labelled production, and the reverse.

**Folder privacy.** A folder passes only when the archive account owns it with no other permission (no public link, domain, group or extra user), it lives in My Drive rather than a Shared Drive, and its label is correct. The tools never remove sharing themselves. They stop and name the folder, and you fix it in Drive.

### Commands

| Command | What it does |
|---|---|
| `npm run admin:drive:authorize -- --token-out=<file>` | One-time OAuth consent on an operator's machine. Writes the refresh token to `<file>` only; see below. |
| `npm run admin:drive:verify -- --environment=staging --init-root` | First run only. Creates `Apex OS Secure Archives` in My Drive and prints its id for `GOOGLE_DRIVE_ARCHIVE_ROOT_FOLDER_ID`. |
| `npm run admin:drive:verify -- --environment=staging` | Health check: OAuth, exact account, root and environment labels, folder privacy before and after, quota, a random test upload (resumable), download and SHA-256 match, owner-only file, delete, gone. It uses only `staging/healthcheck`. |

### Refresh token handling

The refresh token gives lasting access to the archive Drive. **Never print it, paste it into chat or a ticket, screenshot it, or commit it.**

- `--token-out` must be an absolute path outside every Git repository or worktree, for example `C:\Users\<you>\.apex-os-secrets\staging\drive-refresh-token`.
  - Add `--create-parent` if the folder doesn't exist yet.
  - An existing file is replaced only with `--overwrite`.
- The token is written as raw text: first to a temporary file in the same folder, restricted to your Windows user (`icacls /inheritance:r /grant:r`), then renamed into place. If anything fails, the temporary file is removed.
- The command prints only success, the account, the scope and the file path. Any account other than `GOOGLE_DRIVE_ARCHIVE_ACCOUNT` is refused, and nothing is written.

Load the token into a PowerShell session without displaying it:

```powershell
$env:GOOGLE_DRIVE_REFRESH_TOKEN = (Get-Content -Raw -LiteralPath 'C:\Users\<you>\.apex-os-secrets\staging\drive-refresh-token').Trim()
```

- **Expiry:** while the Google OAuth app is in **Testing**, refresh tokens expire after about **seven days**. Publish the app before relying on the token for a background worker.
- **Revocation:** in the archive account, open Google Account → Security → Third-party apps with account access and remove the app. Alternatively, POST the token to `https://oauth2.googleapis.com/revoke`.
- **Rotation:** run `admin:drive:authorize -- --token-out=<file> --overwrite`, update `GOOGLE_DRIVE_REFRESH_TOKEN` wherever it is set, then run `admin:drive:verify`. If the client JSON may have been exposed, rotate the OAuth client secret too, then authorize again. Delete old token files.

## Readiness (read-only)

`npm run admin:storage:readiness -- --environment=staging` reports, without writing, creating or deleting anything:

| Check | Ready when |
|---|---|
| `environment` | `--environment`, `APP_ENV` and `GOOGLE_DRIVE_ARCHIVE_ENVIRONMENT` all name the same environment |
| `r2-config` | R2 credentials are present, and the database identity and exact backup bucket are accepted |
| `r2-backup` | The newest backup for this environment passes `verifyDatabaseBackup` in full: a SUCCESS manifest under 24 hours old for this environment, database and exact bucket; the dump present at the recorded size, **downloaded and re-hashed** to the recorded SHA-256; a `pg_restore` at least the server's major version, as recorded in the manifest, reads it with `--list` |
| `drive-config` | All `GOOGLE_DRIVE_*` settings are present for this environment |
| `drive-account` | The refresh token works and belongs to `GOOGLE_DRIVE_ARCHIVE_ACCOUNT` |
| `drive-private` | `Apex OS Secure Archives/<environment>` is owner-only, in My Drive, and correctly labelled |

There is no lighter backup check. A manifest and a matching size don't prove the bytes, so a corrupted or replaced dump of the same size is NOT READY. The dump is downloaded to a temporary folder that is removed afterwards, so the machine running the check needs `pg_restore` and enough free disk for one dump. The deletion workflow will still run `verifyDatabaseBackup` again immediately before it deletes.

## Variables (names only; never in Git, Vercel, the frontend, screenshots or chat)

Staging:
- `APP_ENV=staging`, `DATABASE_URL`
- `EXPECTED_STAGING_DB_HOST`, `EXPECTED_STAGING_DB_NAME`, `EXPECTED_STAGING_VAULT_BUCKET`
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
- `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN`
- `GOOGLE_DRIVE_ARCHIVE_ROOT_FOLDER_ID`, `GOOGLE_DRIVE_ARCHIVE_ACCOUNT=ai.technoedge@gmail.com`, `GOOGLE_DRIVE_ARCHIVE_ENVIRONMENT=staging`

Production uses the `EXPECTED_PRODUCTION_DB_*` equivalents, `R2_BUCKET=apex-os-production-backups` and `GOOGLE_DRIVE_ARCHIVE_ENVIRONMENT=production`, with its own database and R2 credentials. The Google Drive keys (client, refresh token, root folder, account) may be the same as staging: `GOOGLE_DRIVE_ARCHIVE_ENVIRONMENT` keeps each environment inside its own labelled folder, and a backend refuses the other environment's folder.

## Staging setup checklist

1. **R2 bucket:** create a private staging R2 bucket, for example `apex-os-staging-backups`, with an API token limited to that bucket.
2. **Google Cloud:**
   - enable the Drive API;
   - consent screen: audience External, test user `ai.technoedge@gmail.com`, scope `drive.file`;
   - create a Desktop OAuth client;
   - keep the client JSON outside every repository, for example `C:\Users\<you>\.apex-os-secrets\staging\`.
3. **Authorize:** run `admin:drive:authorize -- --token-out=<file>` and sign in as `ai.technoedge@gmail.com`.
4. **Create the root folder:** run `admin:drive:verify -- --environment=staging --init-root` and set `GOOGLE_DRIVE_ARCHIVE_ROOT_FOLDER_ID`.
5. **Run the health checks:** `admin:drive:verify` and `admin:r2:verify`.
6. **Back up the database:** run `backup:database` with the staging variables.
7. **Check readiness:** `admin:storage:readiness` should report every check ready.
