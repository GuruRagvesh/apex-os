# LIVE STABILIZATION — PRIORITY BOARD
**Date:** 2026-06-02 | Branch `main` @ `cac56d3`

Priority key: **P0** core/security/data blocker · **P1** important daily workflow · **P2** reliability/UX/reporting · **P3** polish · **CONFIG** provider/env setup · **FUTURE** intentional.

Every item: feature · observed · expected · evidence · classification · priority · user impact · safe fix · fix type.

---

## P0 — CRITICAL

### P0-1 · Confirm production is actually running `cac56d3` (FP-13 live)
- **Observed:** Prod `/api/health` = 200, but version is static `1.0.0` with no git SHA. Cannot confirm the merged FP-13 code is the deployed build.
- **Expected:** Production runs `cac56d3` so guardrails + CUID route + scheduler fix are live.
- **Evidence:** health JSON (no SHA); Render dashboard not accessible here.
- **Classification:** UNVERIFIED · **P0**
- **User impact:** If prod is on an older commit, the ticket guardrails, project CUID route fix, and scheduler fix are NOT live — users still hit the old bugs.
- **Safe fix:** Check Render dashboard "Deployed commit"; if not `cac56d3`, trigger Manual Deploy. (Optionally add git SHA to health output — code change, separate.)
- **Fix type:** **deploy + manual verification**

### P0-2 · Verify DB migration `20260601132153_add_ticket_timer_ledger` applied to prod
- **Observed:** `prisma migrate status` unreachable from sandbox (P1001). Prod health = `database: connected` but schema version unconfirmed.
- **Expected:** All migrations applied; `_prisma_migrations` current.
- **Evidence:** P1001 (sandbox egress); user reported applied.
- **Classification:** UNVERIFIED · **P0**
- **User impact:** If timer-ledger tables missing, future FP-13.1C wiring will crash; if notification entity migration missing, notifications 500.
- **Safe fix:** From a network that can reach the DB (or Render shell), run `npx prisma migrate status`; expect "Database schema is up to date".
- **Fix type:** **manual verification** (no migration creation)

### P0-3 · Replace placeholder `JWT_SECRET` (local `.env`) + confirm prod secret
- **Observed:** Local `backend/.env` → `JWT_SECRET="change-this-to-a-long-random-secret-in-production"`.
- **Expected:** Cryptographically random 64-char secret; never the example string.
- **Evidence:** `.env:5` (read in FP-11). Prod value not visible.
- **Classification:** CONFIG REQUIRED · **P0**
- **User impact:** If this placeholder is ever used in prod, JWTs are forgeable → full account takeover.
- **Safe fix:** Set a strong secret in Render env (not committed); confirm prod uses it. Already flagged as a spawned task in FP-11.
- **Fix type:** **config + manual verification**

### P0-4 · Authentication runtime not exercised
- **Observed:** Login endpoint live in prod (400/401 correct), code intact, but no SUPER_ADMIN/employee login performed.
- **Expected:** Login, token persistence, `/auth/me`, logout all work for each role.
- **Evidence:** production probes (401/400); no credentials to complete.
- **Classification:** PARTIAL · **P0**
- **User impact:** Auth is the gate to everything; unverified end-to-end.
- **Safe fix:** Manual login test with known role accounts on prod + local.
- **Fix type:** **manual verification**

---

## P1 — HIGH (daily workflow / verification gaps)

### P1-1 · Projects CRUD / members / role-scoping runtime
- **Observed:** CUID route fix + error surfacing verified at code/test level; live CRUD/members/scoping not exercised (user reports local list+detail OK).
- **Expected:** Create/edit/delete, add/remove members, role-scoped visibility all work.
- **Evidence:** 468e579 diff, `p0.project-access.spec.ts` pass.
- **Classification:** PARTIAL · **P1** · Impact: project workflow trust. · Fix: manual browser test all 4 roles. · **manual verification**

### P1-2 · Tickets full lifecycle runtime (create/edit/assign/status/kanban/block/unblock/approve-reject)
- **Observed:** Guardrails + block/unblock code present and unit-tested; not exercised in browser.
- **Expected:** All transitions + guardrails behave per rules in the live UI.
- **Evidence:** a0f8e57 + FP-10 diffs; `ticket.guardrails.spec.ts` pass.
- **Classification:** PARTIAL · **P1** · Impact: core ticket workflow. · Fix: manual E2E ticket lifecycle. · **manual verification**

### P1-3 · DB migration sync visibility (see P0-2 dependency)
- **Observed:** Cannot run `migrate status` from sandbox.
- **Classification:** UNVERIFIED · **P1** · Fix: run from DB-reachable host. · **manual verification**

### P1-4 · Notifications runtime + entity-column migration
- **Observed:** Route 401 (exists); list/unread/read/delete not exercised; depends on `20260530000001` being applied.
- **Classification:** UNVERIFIED · **P1** · Impact: notification 500s if migration missing. · Fix: verify migration + manual test. · **manual verification**

### P1-5 · Workday + Leave runtime
- **Observed:** Endpoints/code present; not exercised.
- **Classification:** UNVERIFIED · **P1** · Impact: attendance + leave are daily flows. · Fix: manual test start/break/end + apply/approve. · **manual verification**

### P1-6 · Dashboard/Home runtime render
- **Observed:** Route 401 (exists); not rendered.
- **Classification:** UNVERIFIED · **P1** · Fix: load dashboard post-login, check cards/feed/no 401 loops. · **manual verification**

---

## P2 — MEDIUM (reliability / reporting / coverage)

- **P2-1 Integration test suite** — fails on missing seeded test DB (`admin@apex.local` 401). Fix: provision local test DB + seed; re-run. · **manual/config**
- **P2-2 Activity/Events runtime** — route exists; not exercised. · **manual verification**
- **P2-3 Users/Roles/Departments runtime** — code present; not exercised. · **manual verification**
- **P2-4 Settings pages runtime** — endpoints present; not exercised. · **manual verification**
- **P2-5 Production logs review** — no dashboard access; check for 4xx/5xx/Prisma/CORS/socket errors. · **manual verification**
- **P2-6 Browser DevTools** — no running frontend; check console/network/hydration. · **manual verification**
- **P2-7 Team live status runtime** — code present; not exercised. · **manual verification**

---

## P3 — POLISH

- **P3-1 Frontend lint warnings** — `<img>` (use `next/image`), `react-hooks/exhaustive-deps` in projects/[id], workday, dashboard. Non-blocking. · **code (later)**
- **P3-2 main.ts hardcoded prod URL** — logs `apex-os-api.onrender.com` while real host is `apex-os-3nyi.onrender.com`. Cosmetic/log-only. · **code (later)**

---

## CONFIG REQUIRED

- **CFG-1 Resend** — domain not verified → OTP/email not delivered. (Per context: CONFIG REQUIRED.)
- **CFG-2 SMTP fallback** — not configured in DB settings.
- **CFG-3 Cloudinary** — placeholder env → base64-in-Postgres fallback (DB bloat risk, FP-11 P1-3).
- **CFG-4 OpenAI** — placeholder key → AI features disabled.

---

## FUTURE SCOPE

- **FUT-1 FP-13.1C** — wire `TicketLedgerService` into live workday/ticket transitions (start/stop stage timers, review cycles, rework count). Currently present + unit-tested + NOT wired. **Not a bug.**

---

## PRIORITY COUNTS
| Priority | Count |
|---|---|
| P0 | 4 |
| P1 | 6 |
| P2 | 7 |
| P3 | 2 |
| CONFIG | 4 (+JWT under P0-3) |
| FUTURE | 1 |
