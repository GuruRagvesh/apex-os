# LIVE STABILIZATION — NEXT FIX ORDER
**Date:** 2026-06-02 | Branch `main` @ `cac56d3`

Ordered sequence to close the audit. **Verification-first** — most P0/P1 items are *verification* gaps, not code defects. Do these before writing any new code.

---

## STEP 0 — DEPLOYMENT TRUTH (verification, ~15 min) ← do first
Confirm what is actually live before changing anything.
1. Render dashboard → apex-os-backend → confirm **deployed commit == `cac56d3`**. If older, **Manual Deploy → Deploy `cac56d3`**.
2. From a DB-reachable host or Render shell: `npx prisma migrate status` → expect "up to date" incl. `20260601132153_add_ticket_timer_ledger` and `20260530000001_add_notification_entity_fields`.
3. Confirm Render env: real `JWT_SECRET`, `DATABASE_URL`, `FRONTEND_URL`, `NEXT_PUBLIC_API_URL`.
- Closes: **P0-1, P0-2, P0-3 (prod side), P1-3**
- Type: deploy + manual verification. **No code.**

## STEP 1 — AUTH + CORE WORKFLOW SMOKE (verification, ~30 min)
With known role accounts, on the live URL:
1. Login SUPER_ADMIN + one EMPLOYEE; invalid login shows error; `/auth/me`; logout.
2. Dashboard loads (cards, activity, no 401 loops).
3. Projects: list → open detail (CUID route) → confirm no "could not be located" mask; create/edit/member add-remove; role scoping.
4. Tickets: create → assign → status → kanban move → block/unblock → approve/reject; verify guardrails (CLOSED immutable, DONE no-reassign-without-reopen, ON_BREAK/LOGGED_OUT cannot submit).
- Closes: **P0-4, P1-1, P1-2, P1-6**
- Type: manual verification. **No code** unless a real defect surfaces.

## STEP 2 — WORKDAY / LEAVE / NOTIFICATIONS (verification, ~20 min)
1. Workday start/break/resume/end; team live status.
2. Leave apply/approve/reject/cancel/balance.
3. Notifications list/unread/mark-read/mark-all/delete (confirms `20260530000001` applied — no 500).
- Closes: **P1-4, P1-5, P2-7**
- Type: manual verification.

## STEP 3 — CONFIG ENABLEMENT (config, as available)
1. Decide email provider: verify a Resend domain **or** set SMTP in Settings → test email (honest result).
2. Set Cloudinary env to stop base64-in-Postgres fallback (prevents DB bloat).
3. Set `OPENAI_API_KEY` only if AI features are in pilot scope.
- Closes: **CFG-1..4**
- Type: config. **No code.**

## STEP 4 — TEST INFRA + REMAINING RUNTIME COVERAGE (P2)
1. Provision a local seeded test DB so `test/integration` runs (closes E2/P2-1).
2. Review Render logs for 4xx/5xx/Prisma/CORS/socket/scheduler/Resend (P2-5).
3. Browser DevTools pass on key routes — console/network/hydration (P2-6).
4. Activity / Users / Roles / Departments / Settings runtime spot-checks (P2-2..4).
- Type: config + manual verification.

## STEP 5 — POLISH (P3, optional, batched)
1. Frontend lint: replace `<img>` with `next/image`; fix `exhaustive-deps` in `projects/[id]`, workday, dashboard.
2. Fix misleading hardcoded prod URL in `main.ts` (`apex-os-api` → real host) or make it env-driven; optionally add git SHA to `/api/health`.
- Type: code (small, low risk). Requires its own fix pack + review.

## STEP 6 — FUTURE (do NOT start without approval)
- **FP-13.1C** — wire `TicketLedgerService` into live ticket/workday transitions (stage timers, review cycles, rework count, break-aware pausing). Service + schema + unit tests already exist and are merged but intentionally unwired.
- Type: feature. Separate fix pack.

---

## RECOMMENDED FIRST FIX PACK

> **FP-13.0 — DEPLOYMENT TRUTH & LIVE SMOKE (verification-only, no code)**
> Execute **STEP 0 + STEP 1**: confirm prod is on `cac56d3`, migrations applied, real `JWT_SECRET` set; then run the auth + projects + tickets-guardrail live smoke on production.
>
> **Rationale:** Every P0 is currently a *verification* gap, and 0 BROKEN items were found in code. The single largest risk is **not knowing whether the merged FP-13 fixes are actually deployed**. Proving deployment + core-flow health converts the bulk of UNVERIFIED → VERIFIED with zero code risk, and surfaces any genuine runtime defect before further engineering.
>
> Only after FP-13.0 passes should config (STEP 3) and FP-13.1C (STEP 6) proceed.
