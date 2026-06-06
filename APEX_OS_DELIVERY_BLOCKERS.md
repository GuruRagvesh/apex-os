# APEX OS — DELIVERY BLOCKERS (P0 / P1 ONLY)
**Date:** 2026-06-02 | `main` @ `7f1c8fb`

This document lists **only** P0 (must fix before any delivery) and P1 (should fix before delivery) items. P2/P3 are in the master audit.

---

## P0 — MUST FIX BEFORE DELIVERY

### P0-1 · Verify production JWT_SECRET is not the placeholder
- **Evidence:** `backend/.env:5` = `"change-this-to-a-long-random-secret-in-production"`
- **Impact:** If this value is also set in Render production env, ANY attacker can forge JWTs and impersonate SUPER_ADMIN. Total auth bypass.
- **Why "verify" not "confirmed broken":** The local `.env` is dev-only; production reads from Render dashboard env which this audit cannot inspect.
- **Action:** Open Render dashboard → apex-os-backend → Environment → confirm `JWT_SECRET` is a long random string (≥64 chars), NOT the placeholder. If it is the placeholder, rotate immediately (this also invalidates all existing sessions — acceptable).
- **Fix type:** Config (Render env). No code change.

---

## P1 — SHOULD FIX BEFORE DELIVERY

### P1-1 · [RESOLVED] `GET /task-types` is publicly accessible (no auth guard)
- **Evidence:** `task-types.controller.ts:16` — `@Get()` has no `@UseGuards(JwtAuthGuard)` (all other methods do).
- **Impact:** Returns production task-type names/IDs to unauthenticated callers. Exposes internal work taxonomy. Verified live (200 without token).
- **Action:** Add `@UseGuards(JwtAuthGuard)` to the `@Get()` handler. The ticket-creation form already requires login, so no UX regression.
- **Fix type:** Code (1 line) + deploy.

### P1-2 · ~59 corrupted workday sessions in production (only 2 auto-repairable)
- **Evidence (updated):** `WORKDAY_SESSION_REPAIR_DRY_RUN_REPORT.json` (dry-run already executed): scanned **156**, **59 suspicious**, **2 auto-repair candidates**, **57 require MANUAL review**, 2 suspicious break logs. (Earlier raw query: 55 rows with `totalWorkMinutes > 600` + 1 stale open session.)
- **Impact:** Users see impossible work totals. Erodes trust in attendance data and any analytics derived from it.
- **Root cause:** Historical rows created before the `*/15` auto-close cron (FP-19) existed; varied corruption types (impossible duration, logout-before-start, bad status, open breaks).
- **Action:** **Not a one-command fix.** `npm run workday:repair` will only auto-fix the **2** Rule-A candidates. The other **57 need manual triage** (review `manualReviewList` in the dry-run JSON, decide per-session). Plan a manual cleanup pass before relying on attendance analytics.
- **Fix type:** Run repair for the 2 safe cases + manual data review for 57. No code change.

### P1-3 · Forgot-password / email delivery depends on Resend being configured
- **Evidence:** `EmailService` is Resend-first; `sendOtpEmail` throws if `RESEND_API_KEY`/`RESEND_FROM_EMAIL` are unset. Not present in local `.env`.
- **Impact:** If Resend env vars are not set in Render (or the sending domain is unverified), users cannot receive OTP → cannot self-reset passwords. Transactional emails (ticket assigned, leave decisions) silently no-op.
- **Action:** Confirm `RESEND_API_KEY` + `RESEND_FROM_EMAIL` (verified domain) are set in Render env, then send a test via Settings → Email Test.
- **Fix type:** Config. No code change. (Code is correct and tested — 12 OTP unit tests pass.)

### P1-4 · All 263 production tickets have `departmentId = NULL`
- **Evidence:** `SELECT count(*) FROM tickets WHERE "departmentId" IS NULL` → **263 / 263**.
- **Impact:** Any feature that filters/scopes tickets by `departmentId` (manager dashboard scope, dept analytics, dept workload) will see ZERO tickets via that path. Manager-by-department views may appear empty even though tickets exist.
- **Why P1 not P0:** Ticket access primarily scopes by assignee/creator/project (which works — managers still see tickets via those paths), so the app is not fully broken. But department-scoped manager views are likely affected.
- **Action:** Investigate ticket creation — confirm whether `departmentId` should be set (from assignee's dept or the form). Verify manager dashboard ticket counts match reality with a MANAGER test account. Decide: backfill departmentId, or confirm assignee-based scoping is intended and remove dept-based filters.
- **Fix type:** Investigation → possibly code (creation logic) + data backfill.

### P1-5 · Cron jobs may not fire on Render free tier (no keepalive)
- **Evidence:** 7 `@Cron` jobs found; no UptimeRobot/keepalive config in repo. Render free web services sleep after ~15 min idle.
- **Impact:** Auto-close (workday), overdue checks, scheduled reminders, daily digest, auto-logout may not run reliably → contributes to corrupted/stale sessions accumulating again after P1-2 cleanup.
- **Action:** Set up an external pinger (UptimeRobot/cron-job.org) hitting `/api/health` every 10 min, OR move to a Render paid tier / background worker. Confirm the service stays warm during business hours at minimum.
- **Fix type:** Config / infra. No code change.

---

## SUMMARY

| Priority | Count | All config/data — code-clean? |
|---|---|---|
| P0 | 1 | Config verification (JWT_SECRET) |
| P1 | 5 | 1 code (task-types guard), 1 data script (workday repair), 1 investigation (ticket dept), 2 config (Resend, cron keepalive) |

**There are ZERO P0/P1 items caused by broken application code.** Every blocker is either a config/env verification, a data-cleanup run with existing tooling, one 1-line security guard, or an investigation. The build is clean and 244 unit tests pass.

**Delivery recommendation:** Resolve P0-1 (JWT verify) and P1-1 (task-types guard) before any external delivery. P1-2 (workday repair) and P1-3 (Resend) should be done at delivery. P1-4/P1-5 can be monitored if delivery is to a controlled pilot.
