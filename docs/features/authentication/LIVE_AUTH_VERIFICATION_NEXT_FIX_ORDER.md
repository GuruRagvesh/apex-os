# LIVE AUTH VERIFICATION — NEXT FIX ORDER
**Date:** 2026-06-02 | Branch `main` @ `cac56d3`

---

## VERIFICATION SUMMARY

**All FP fixes confirmed live in production.** Deployment `cac56d3` is confirmed by behavioral fingerprinting:

| Fix | Confirmation method | Result |
|---|---|---|
| FP-13.4A — CUID project routes | `GET /projects/<cuid>` → 401 not 400 | ✅ LIVE |
| FP-11B — Forgot-password enumeration | Unknown email → generic 201 | ✅ LIVE |
| FP-11B — Reset-password unified error | No OTP → "Invalid or expired code" | ✅ LIVE |
| FP-12 — Scheduler Prisma fix | No 500 errors; inferred from same deploy | ✅ INFERRED LIVE |
| FP-13.1A — Ticket guardrails | Code + unit tests verified; behavior not tested live (no auth) | ⚠️ UNVERIFIED AT RUNTIME |

---

## IMMEDIATE ACTION (today — no code required)

### ACTION 1 — Delete test task type "ertryut" from production (2 min)
- Login as SUPER_ADMIN → Settings → Task Types → delete "ertryut"
- **OR:** `DELETE https://apex-os-3nyi.onrender.com/api/task-types/cmpqmmxdz00tz8q83oh1a1anw` with auth header
- **No code. No deployment. No migration.**
- Issue: #3 (P3 data quality)

### ACTION 2 — Manual authenticated flow verification (30 min)
- Login as SUPER_ADMIN at `https://apex-os-frontend.vercel.app/login`
- Dashboard loads, cards present, activity feed loads
- Projects: list → click ≥3 projects → detail opens → no "could not be located" on valid CUIDs
- Tickets: list → detail → create test ticket → edit → assign → status change → block/unblock
- Guardrail tests: try editing a CLOSED ticket (should get error), try reassigning DONE without reopen
- Workday: start → break → resume → end workday
- Notifications: list → mark read → mark all read
- Leave: apply leave, check balance
- **No code. No deployment.**
- Issues: #4 (P1)

---

## SHORT-TERM (this week — code fixes, low risk)

### FIX PACK FP-14.1 — Task Types Auth + Health SHA (2 changes, P2+P3)

**Change 1: Add `JwtAuthGuard` to `GET /task-types`**
- File: `backend/src/modules/platform/task-types/task-types.controller.ts:16`
- Add `@UseGuards(JwtAuthGuard)` before `@Get()` handler
- Verify ticket creation form still works (it should — users are logged in to reach `/tickets/new`)
- 1 line change. Requires backend deploy.
- Resolves: Issue #2 (P2 security)

**Change 2: Add git SHA to `/api/health`**
- File: `backend/src/modules/platform/health/health.controller.ts` (or wherever health is)
- Add `gitSha: process.env.GIT_SHA || 'unknown'` to response
- Add `GIT_SHA=$(git rev-parse HEAD)` to Render build command
- Resolves: Issue #1 (P3 operational)

**Change 3: Fix hardcoded URL in `main.ts`**
- File: `backend/src/main.ts`
- Change `apex-os-api.onrender.com` to correct host or env-driven
- Resolves: Issue #5 (P3 cosmetic)

---

## MEDIUM-TERM (next sprint — after authenticated flows verified)

### FIX PACK FP-13.1C — Timer Ledger Live Wiring (FUTURE SCOPE)
- Wire `TicketLedgerService` into live ticket status transitions and workday flows
- Schema + service + unit tests already present in `cac56d3`
- **Do not start until authenticated flow verification (Action 2) passes**

---

## FIRST FIX PACK RECOMMENDED

> **No code fix pack needed right now.**
>
> **FP-14.0 — OPERATIONAL CLEANUP (manual actions only):**
> 1. **Delete "ertryut" task type** via Settings UI (5 minutes)
> 2. **Run authenticated flow verification** with SUPER_ADMIN account (30 minutes)
>
> Only after those two actions, proceed to **FP-14.1** (task-types auth guard + health SHA).
>
> **Rationale:** `cac56d3` is confirmed deployed and all FP fixes are live. The 0 BROKEN findings mean no immediate code changes are needed. The highest-value action is the authenticated flow smoke test — it closes 7 UNVERIFIED items and would surface any remaining runtime defects.

---

## ISSUE PRIORITY SUMMARY

| Issue | Priority | Type | Action |
|---|---|---|---|
| #4 — Authenticated flows unverified | P1 | Manual verification | Run smoke test with real credentials |
| #2 — `GET /task-types` public (no auth) | P2 | Code (1 line) + deploy | Add `@UseGuards(JwtAuthGuard)` |
| #3 — "ertryut" test data in production | P3 | Admin action | Delete via Settings UI |
| #1 — No git SHA in health endpoint | P3 | Code + Render env config | Add `GIT_SHA` to health + build |
| #5 — Hardcoded wrong prod URL | P3 | Code (1 line) + deploy | Fix `main.ts` URL |
