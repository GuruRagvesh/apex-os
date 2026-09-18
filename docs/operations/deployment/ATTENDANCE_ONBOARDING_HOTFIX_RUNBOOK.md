# Attendance onboarding hotfix runbook

## Scope

This release fixes attendance onboarding for newly created users in every
canonical role (`INTERN`, `EMPLOYEE`, `TEAM_LEAD`, `MANAGER`, `ADMIN`, and
`SUPER_ADMIN`) and provides a separately controlled repair for exactly these
six reported accounts:

- Sherin
- Dhruv
- Vivek
- Shruti
- Tejas Goswami
- Kanishk

The release does not change punch capture, camera handling, photo storage,
attendance evaluation, authentication for existing accounts, or the database
schema. It must not modify any other existing user. In particular, an existing
working user who has no joining date is an audit observation, not a repair
target.

## Non-negotiable gates

Stop the release if any gate fails:

1. Work from `codex/fix-attendance-onboarding-all-roles`, never directly from
   `main`.
2. Review the final diff and confirm that it contains only the approved
   onboarding, exact-six repair, tests, and this runbook.
3. Do not copy `.env`, `.env.local`, passwords, database URLs, repair JSON, or
   user identifiers into Git, build logs, tickets, or chat.
4. Obtain a verified production backup or Render snapshot before any write.
5. Independently read the production database host and database name from the
   Render dashboard. Do not derive the expected values from `DATABASE_URL`.
6. Obtain immutable database IDs, exact emails, and verified joining dates for
   all six targets. Display names are not sufficient identity evidence.
7. Obtain the immutable ID of one approved working employee whose current
   attendance profile is the correct policy template.
8. Obtain the immutable ID of the Admin or Super Admin authorizing the repair.
9. Run the repair in dry-run mode first and have a second person verify all six
   rows and policy assignments.
10. Never run `prisma db push`, `prisma migrate dev`, the general seed script,
    or an unscoped SQL update against production for this release.

## Release contents

The production change is limited to:

- the Users administration form requiring a joining date;
- `POST /users` creating the user and attendance profile atomically;
- `POST /auth/register` delegating to the same atomic creation path;
- the read-only production attendance-onboarding audit;
- the exact-six guarded repair tool;
- focused regression tests.

No Prisma migration is required.

## Pre-release verification

From the repository root:

```powershell
npm run backend:build
npm --prefix backend run typecheck:scripts
npm --prefix backend test -- --runInBand `
  test/unit/users.attendance-onboarding.spec.ts `
  test/unit/auth.register-attendance.spec.ts `
  test/unit/production-attendance-six-repair.spec.ts `
  test/unit/production-attendance-onboarding-audit.spec.ts `
  test/unit/employee-timeline.spec.ts `
  test/unit/daily-attendance-context.spec.ts
npm --prefix frontend run build
npm run frontend:verify-api-contract
npm run architecture:check
git diff --check
```

Confirm that all commands pass. Warnings already present outside this hotfix
must be recorded, but no new warning may be introduced by the hotfix.

## Backup gate

Use the existing verified production backup process or create a Render snapshot.
The existing backup command is:

```powershell
Set-Location backend
npm run backup:pre-migration
```

That command needs its documented production identity and R2 vault environment
variables. Continue only after the backup reports `COMPLETED`, its checksum is
recorded, and the backup object is visible in the configured vault. If that
process is not fully configured, use a Render snapshot and record its identifier
and creation time instead. A merely started backup is not sufficient.

## Read-only production census

Set the following values only in the operator's secured shell or deployment job:

```powershell
$env:APP_ENV = 'production'
$env:DATABASE_URL = '<production database URL from the secret manager>'
$env:EXPECTED_PRODUCTION_DB_HOST = '<host independently copied from Render>'
$env:EXPECTED_PRODUCTION_DB_NAME = '<database name independently copied from Render>'
```

Run the read-only audit:

```powershell
Set-Location backend
npx ts-node --transpile-only scripts/audit-production-attendance-onboarding.ts
```

The report may identify other existing users. Do not repair them in this
release. Save only the counts and masked output; do not publish personal data.

## Deployment order

1. Announce a short freeze on **new user creation only**. Existing users may
   continue punching and using the system.
2. Deploy the backend revision to Render first.
3. Verify `/api/health`, login with a designated test account, and read that
   account's `/api/attendance/daily/today`. Do not create or edit an existing
   employee during this check.
4. Confirm a registration request without `joiningDate` is rejected with HTTP
   400. This is a non-writing negative test.
5. Deploy the matching frontend revision to Vercel.
6. Confirm the New User form requires a joining date and cannot submit without
   one.
7. End the new-user freeze only after both deployments are healthy.

Backend-first is deliberate: during the short gap, an old browser can receive a
safe 400 response instead of creating another attendance-incomplete account.
Existing punch-in and punch-out routes are not part of this deployment.

## Exact-six dry run

Prepare `ATTENDANCE_REPAIR_TARGETS_JSON` as a secured runtime value containing
exactly six objects. Each object must contain `caseKey`, immutable `id`, exact
`email`, and the verified `joiningDate` in `yyyy-MM-dd` format. The case keys
must be exactly:

```text
sherin, dhruv, vivek, shruti, tejas-goswami, kanishk
```

Set the remaining secured values:

```powershell
$env:ATTENDANCE_REPAIR_TARGETS_JSON = '<secured exact-six JSON>'
$env:ATTENDANCE_REPAIR_TEMPLATE_USER_ID = '<approved working template user ID>'
$env:ATTENDANCE_REPAIR_ACTOR_ID = '<approving Admin or Super Admin user ID>'
Remove-Item Env:ATTENDANCE_REPAIR_CONFIRM -ErrorAction SilentlyContinue
```

Run dry-run mode only:

```powershell
npx ts-node --transpile-only scripts/repair-production-attendance-six.ts
```

Two people must verify that:

- the database identity is production and matches Render;
- exactly six masked targets appear;
- all IDs and emails match the approved source record;
- every joining date is correct and is not in the future;
- each target currently has no attendance profile;
- the template has exactly one current regular-employee profile;
- every referenced policy is active and covers each target's joining date;
- no additional user is proposed for modification.

Any mismatch is a stop condition. Correct the input evidence; do not weaken a
guard in the script.

## Exact-six apply

Only after the backup and dry-run approvals:

```powershell
$env:ATTENDANCE_REPAIR_CONFIRM = 'REPAIR_EXACTLY_SIX_ATTENDANCE_USERS'
npx ts-node --transpile-only scripts/repair-production-attendance-six.ts --apply
```

The transaction may only fill a null joining date and create one missing
attendance profile for each exact target. It must abort if a target identity
changed, already has a profile, or has a different joining date.

Immediately clear secured runtime values from the operator shell:

```powershell
Remove-Item Env:ATTENDANCE_REPAIR_TARGETS_JSON -ErrorAction SilentlyContinue
Remove-Item Env:ATTENDANCE_REPAIR_TEMPLATE_USER_ID -ErrorAction SilentlyContinue
Remove-Item Env:ATTENDANCE_REPAIR_ACTOR_ID -ErrorAction SilentlyContinue
Remove-Item Env:ATTENDANCE_REPAIR_CONFIRM -ErrorAction SilentlyContinue
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
```

## Post-release verification

1. Re-run the read-only onboarding audit and confirm the six targets no longer
   have `NO_PROFILE` or `NO_CURRENT_PROFILE`.
2. Ask each of the six users to sign out, sign in, and perform one real punch-in
   through the normal hosted UI. Do not manufacture production punch evidence.
3. For each user, confirm the punch appears in My Attendance with the expected
   time and photo through the normal application UI.
4. Confirm at least two previously working users can still view today's
   attendance and complete their normal punch flow.
5. Create the next real user only after the UI requires a joining date. Confirm
   that user's daily attendance returns an applicable status rather than
   `NOT_EMPLOYED`.
6. Monitor Render errors, HTTP 4xx/5xx rates, and user reports during the agreed
   observation window.

## Rollback and incident response

If login, attendance reads, or punch flows regress before the repair is applied:

1. Reinstate the new-user creation freeze.
2. Roll Render back to the prior backend revision.
3. Roll Vercel back to the prior frontend deployment.
4. Verify health, login, attendance read, and an authorized punch flow.

If the exact-six repair has already committed, do **not** delete profiles or
blank joining dates with ad-hoc SQL. Stop further changes, preserve logs, compare
the six rows against the pre-write backup, and use the approved incident/restore
procedure. The code rollback and the data recovery decision are separate.

## Release evidence to retain

Retain the commit SHA, reviewed file list, test output, backup/snapshot ID,
masked dry-run output, approver names, deployment IDs, apply result, post-release
audit counts, and the six user confirmations. Never retain passwords, database
URLs, unmasked repair JSON, or other secrets in the release record.
