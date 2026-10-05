# Phase 5 — Final runtime runbook (ticket time, review, idle)

This is the operating guide for the ticket-time / review program after Phase 5.
It covers the safe local test environment, release order, smoke tests, audit
commands and rollback boundaries. It contains no secrets and no hostnames of
real systems.

## 1. What Phase 5 adds

- **Idle workflow (frontend):**
  - mounted once in the dashboard shell;
  - runs only while `GET /workday/today` reports the person WORKING in an open session;
  - warns at 10 minutes and reports at 20 minutes, once per idle episode, sending the measured minutes;
  - suggests ending the day at 45 minutes;
  - the idle prompt offers Resume Work, Take a Break, and End Workday (or Punch Out when punching is on);
  - activity is shared across tabs, and elapsed time comes from timestamps, so sleep and background tabs are measured correctly.
- **Idle hardening (backend, no schema change):**
  - `POST /workday/idle` validates `idleDuration` (0–1440 minutes, else 400).
  - Only a WORKING session goes IDLE. A stale or duplicate report changes no state and is recorded with `applied: false`.
  - `POST /workday/resume` writes nothing when there is nothing to resume, so a stale tab never marks an ended day WORKING.
  - A break may start from IDLE (`BreakLog.source = MANUAL_BREAK_FROM_IDLE`); ending it resumes the idle-paused employee ticket.
  - A review timer never resumes by itself.
- **WorkdayBar fix:** Take Break and End Day now open their modals from the IDLE state too.
- **Test and QA isolation** (sections 2–3).

No business rule from Phases 1–4 changed. No migration ships in Phase 5.

## 2. Safe local test environment

**Database:** a disposable PostgreSQL 18 cluster, used only by tests.
- Bind to `127.0.0.1`, port `55432`, database `apex_os_attendance_integration`.
- Never use 5432/5433 or any shared, staging or production database.

```bash
initdb -D "$SCRATCH/pg/data" -U apex_test --auth-local=trust --auth-host=trust --encoding=UTF8 --locale=C
pg_ctl -D "$SCRATCH/pg/data" -o "-p 55432 -h 127.0.0.1" -l "$SCRATCH/pg/server.log" start
createdb -h 127.0.0.1 -p 55432 -U apex_test apex_os_attendance_integration
```

**Run from `backend/`, always with an explicit URL:**

```bash
export DATABASE_URL="postgresql://apex_test@127.0.0.1:55432/apex_os_attendance_integration?schema=public"
export DIRECT_URL="$DATABASE_URL"
npx prisma migrate deploy
npx prisma migrate status
npm run test:unit        # mocked; gets an unreachable loopback DATABASE_URL by itself
npm run test:int         # PostgreSQL suites (t1–t15 and the attendance suites)
npm run test:api         # API suites
npm run ticket-time:audit
```

Prisma may print that it loaded `backend/.env`. The explicit `DATABASE_URL` always wins, and every suite verifies the server's identity before writing.

**Teardown:**

```bash
dropdb -h 127.0.0.1 -p 55432 -U apex_test apex_os_attendance_integration
pg_ctl -D "$SCRATCH/pg/data" stop -m fast
```

## 3. External-service isolation

The generated Prisma client loads `backend/.env` into the process for every variable that is not already set. A developer `.env` can hold real Cloudinary, Resend, R2, Microsoft Graph or Sentry settings. Two guards stop those from being used.

**Tests (`backend/test/test-environment-guard.ts`, installed by `test/jest.env.ts` before anything imports Prisma):**
- refuses to run if a provider credential is exported in the shell (it names the variable, never the value);
- pre-sets every provider variable, and every other variable named in `backend/.env` or `.env.local`, to an empty string, so no loader can fill them (names only are read);
- gives unit tests an unreachable loopback `DATABASE_URL`, and validates any explicit one with `test/integration-pg/db-guard.ts`;
- blocks `fetch`, `http` and `https` to any non-loopback host (`ExternalNetworkBlockedError`, naming the host only).

Proof lives in `test/unit/test-environment-guard.spec.ts` and `test/integration-pg/t15-external-service-isolation.int-spec.ts`. The latter shows no Cloudinary upload or delete, no email, no R2 or OneDrive call, and no external request during a real submission.

**Browser QA (`backend/scripts/qa/run-isolated-backend.mjs`):**

```bash
cd backend && npm run build && cd ..
DATABASE_URL="postgresql://apex_test@127.0.0.1:55432/apex_os_attendance_integration?schema=public" \
  node backend/scripts/qa/run-isolated-backend.mjs --port 3001
```

- Refuses any database other than the loopback integration one.
- Starts from an empty environment, blanks every `.env`-declared and provider variable, generates a throwaway JWT secret, and runs from the OS temp directory.
- Stops itself if `/api/health` reports photo storage configured.
- Use test-only accounts created in the throwaway database.
- Start the frontend normally (`npm run dev` in `frontend/`); its API base must be `http://localhost:3001/api`.

**Never** edit or delete anyone's `.env` files to get isolation; the guards do it in-process.

## 4. Migration status checks

Migrations are applied **by hand**. Startup never migrates (the backend runs `node dist/main.js`).

| Migration | Phase | What it does |
| --- | --- | --- |
| `20261001000000_one_active_assignee_timer` | 2 | one active employee timer per user |
| `20261002000000_one_active_timed_ticket_per_user` | 4 | one active employee **or** review timer per user (replaces the above index) |
| `20261003000000_attachment_ownership_and_review_evidence` | 4 follow-up | attachment uploader, purpose, review cycle, lock (additive) |

Phase 5 adds none.

Before and after every release:

```bash
npx prisma migrate status    # must list exactly the expected pending migrations, then "up to date"
```

**Never** run `prisma migrate reset`, `prisma db push` or `prisma migrate dev` against production.

## 5. Production rollout order

1. **Back up first.** Take a production backup and verify it (restore test or manifest), following `docs/operations/backup-recovery/`.
2. **Confirm the release commit.** The exact `main` commit being released is recorded.
3. **Check migrations:** `prisma migrate status`. Phase 5 must show none pending. If any migration is pending, follow its own release section (`TICKET_TIMER_GUARDRAIL_RELEASE.md`) before continuing: `migrate status` → `migrate deploy` → `migrate status`.
4. **Deploy the backend before, or together with, the frontend.** The new frontend calls only existing endpoints, but the backend idle hardening must be live before many idle reports arrive.
5. **Deploy the frontend.**
6. **Verify health and logs:** `/api/health` reports `database: connected`, and backend logs show no errors on `/workday/idle`, `/workday/resume` or `/workday/break/start`.
7. **Run the smoke tests** in section 6 with a test account.
8. **Observe** using section 8.

**Audit and cleanup:** `ticket-time:audit` and `ticket-time:cleanup` refuse every database except the local integration one. There is no production override. Running them against production needs a separately reviewed change, as `TICKET_TIMER_GUARDRAIL_RELEASE.md` explains.

## 6. Smoke-test checklist

Use a test account, on a working day **and** on a weekend or holiday with explicit Punch In.

- **Workday:**
  - Punch In / Start Work starts the day, even on a holiday or weekend.
  - The idle warning appears after 10 minutes without input, and input dismisses it.
  - At 20 minutes, idle is recorded once and the prompt appears.
  - The employee timer stops at the back-dated time.
  - Resume Work restarts the eligible employee ticket only.
  - Take a Break from the prompt works, and ending the break resumes the ticket.
  - End Workday or Punch Out from the prompt closes the day.
- **Multiple tabs:** activity in one tab keeps the others active, and one idle report covers all tabs.
- **Tickets:**
  - OPEN has no timer.
  - Starting a ticket pauses another as designed.
  - Break, idle and Punch Out pause timing; Punch In resumes the eligible queue.
  - Review ends employee execution.
  - Rework uses its own estimate.
  - Time Left freezes when paused.
- **Review:**
  - Opening a review ticket changes nothing.
  - The Start Review / View Only / Go Back prompt works.
  - The banner shows the running review.
  - Approve and Send Back are gated on a started review.
  - Pause and decisions resume eligible employee work.
  - A reviewer who goes idle mid-review does **not** get the review back on resume.
- **Attachments:**
  - Proof is optional (Skip for now).
  - Submission with proof is atomic.
  - Current-cycle proof shows first; previous-cycle proof stays visible.
  - Only the uploader can delete an unlocked file; locked and legacy files cannot be deleted.
  - A user who uploaded attachments cannot be permanently deleted.
- **Failure handling:**
  - When the workday cannot be read, ticket creation is disabled and no idle report is sent.
  - Errors show safe messages, never table, index or constraint names.

## 7. Timer audit: commands and expected output

Local or integration only:

```bash
npm run ticket-time:audit           # human readable
npm run ticket-time:audit -- --json # machine readable
```

Expected clean output ends with `0 violation(s)` and exit code 0.

| Exit | Meaning |
| --- | --- |
| 0 | CLEAN |
| 2 | violations found (review them; nothing is changed) |
| 1 | refused or failed |

The audit is read-only. Cleanup is separate, guarded, and needs `--apply --confirm-database=<name>`.

## 8. Post-deploy observation (first days)

- **Idle events:** count `attendance_events` with type `IDLE_DETECTED` per day. Most should have `metadata.applied = true`; a high `false` share points to many stale or duplicate reports, which is harmless but worth a look.
- **Idle failures:** no growth in 4xx/5xx on `/workday/idle` (400 means a client sent an invalid duration).
- **Integrity:** no new duplicate active timers. The database index enforces this; a 409 rate spike on ticket actions would show attempts.
- **Review resumes:** reviewer rows with pause reason `IDLE` are never followed by an automatic reviewer restart.
- **User feedback:** reports of unexpected idle prompts, for example a long meeting without input. That is the expected behaviour; such users can use a break type instead.

## 9. Rollback boundaries

- **Phase 5 has no migration.** Reverting the Phase 5 commit restores the previous frontend (idle UI not mounted) and backend behaviour.
- After rollback:
  - idle reports from an older frontend no longer arrive (it never sent them);
  - the backend accepts the old, unvalidated reports again.
- **Breaks started from IDLE before a rollback:** end normally. The older backend resumes through the break path, so the idle-paused ticket may come back as "next waiting ticket" rather than the exact one.
- **Never roll back by editing `_prisma_migrations`** or by `migrate reset`. Earlier migrations have their own rollback sections in `TICKET_TIMER_GUARDRAIL_RELEASE.md`.

## 10. Known intentional product decisions

- **QUERY and HELP** decisions do not require Start Review. They belong to the requester or the HELP assignee, and are unchanged.
- **HELP gap (pre-existing):** employee HELP requesters cannot approve, and HELP assignees cannot decline, because of the transition rules. This is an open product question, not changed here.
- **Reviewer timers** never auto-resume after break, idle, End Day or Punch In; reviewers press Start Review again.
- **Idle thresholds** are 10 / 20 / 45 minutes. Focus and visibility changes re-check idle time but do not count as activity; only input does.
- **Permanent user deletion** is the existing guarded flow. A user who uploaded attachments is blocked; use deactivate or archive.
