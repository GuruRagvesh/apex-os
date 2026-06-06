# LIVE STABILIZATION AUDIT — MASTER
**Date:** 2026-06-02
**Branch:** `main` @ `cac56d3` (in sync with `origin/main`)
**Scope:** Stabilization audit after FP-13 fixes merged to `main`. AUDIT ONLY — no code, config, migration, or commit changes made.

---

## METHOD & EVIDENCE SOURCES

| Source | Available? | Notes |
|---|---|---|
| Git / repo state | ✅ | Full local + origin comparison |
| Prisma schema validate | ✅ | `npx prisma validate` |
| Prisma migrate status (DB) | ❌ | `P1001` — sandbox cannot reach Render Postgres external host |
| Backend build | ✅ | `npm run build` |
| Backend unit tests | ✅ | `npm test --testPathPatterns test/unit` |
| Backend integration tests | ⚠️ | Run, but fail on missing seeded test DB (401 login) — environmental |
| Frontend build + tsc | ✅ | `next build` + `tsc --noEmit` |
| Local runtime (`:3001`/`:3000`) | ❌ | Neither server running in this environment |
| **Production backend** | ✅ | `https://apex-os-3nyi.onrender.com/api/health` → **200, db connected** |
| Production authenticated flows | ❌ | No production credentials available |
| Production deployed commit SHA | ❌ | Health endpoint exposes version `1.0.0`, not git SHA |
| Render server logs | ❌ | No dashboard access from this environment |
| Browser DevTools | ❌ | No running frontend to inspect |

**Honesty rule applied:** anything not directly proven is marked **UNVERIFIED**, never **BROKEN**.

---

## PHASE 0 — REPO & DEPLOYMENT STATE — VERIFIED OK

| Check | Result | Evidence |
|---|---|---|
| Current branch | `main` | `git branch --show-current` |
| Latest local commit | `cac56d3 merge stabilize fixes into main` | `git log --oneline -10` |
| Local `main` == `origin/main` | ✅ identical (`cac56d3…`) | `git rev-parse main` == `git rev-parse origin/main` |
| FP-13.1A `a0f8e57` in main | ✅ ancestor | `git merge-base --is-ancestor` |
| FP-13.1B1 `8dabe48` in main | ✅ ancestor | same |
| FP-13.1B2 `37afba0` in main | ✅ ancestor | same |
| FP-13.4A `468e579` in main | ✅ ancestor | same |
| Migration folder present | ✅ `20260601132153_add_ticket_timer_ledger` | `Test-Path` |
| Tracked working-tree changes | ✅ none | `git diff --stat HEAD` empty |
| Untracked docs | ✅ audit/report `.md` only (incl. FP13_*.md) | `git status --short` — left untouched |

**No staging/commits performed.**

---

## PHASE 1 — BACKEND HEALTH & DB

| Check | Result | Evidence |
|---|---|---|
| `prisma validate` | ✅ "schema is valid" | exit 0 |
| `prisma migrate status` | ⚠️ **UNVERIFIED** | `P1001: Can't reach database server at dpg-…oregon-postgres.render.com:5432` — sandbox egress blocked; **not** a DB defect (production health shows `database: connected`) |
| `npm run build` | ✅ exit 0 | Prisma generate + tsc compile clean |
| Unit tests (16 suites) | ✅ **129 passed / 129** | `--testPathPatterns test/unit` |
| `ticket` pattern | ✅ 5 suites / 62 tests pass | incl. `ticket.guardrails.spec.ts`, `ticket-ledger.service.spec.ts`, `ticket.transitions.spec.ts`, `blocked-ticket.spec.ts` |
| `scheduler` pattern | ✅ 1 suite / 8 tests pass | `scheduler.recurring.spec.ts` |
| `project` / `workday` patterns | ⚠️ matched integration suites that fail on env | unit portions pass; see integration note |
| Integration tests | ⚠️ **UNVERIFIED** | `smoke.spec.ts` login → `401` (no seeded `admin@apex.local`); needs local seeded test DB |

**Phase-1 checklist answers:**
1. Backend starts cleanly — **UNVERIFIED locally** (not started); **production starts cleanly** (health 200).
2. `/api/health` — ✅ **VERIFIED on production** (`{"status":"ok","database":"connected","environment":"production"}`).
3. No missing migration — **UNVERIFIED** (can't reach DB to run `migrate status`); user reported applied.
4. Prisma Client matches schema — ✅ build + generate succeed.
5. No timer-ledger runtime crash — ✅ build/tests pass; models compile; not wired to runtime.
6. No recurrence scheduler Prisma error — ✅ FP-12 fix in main; scheduler tests pass.
7. No project route UUID/CUID error — ✅ `ParseUUIDPipe` removed (468e579); unit test passes.
8. No auth/login crash — ✅ production `/auth/login` responds (400 on invalid DTO, 401 on bad creds).
9. No ticket guardrail regression — ✅ `ticket.guardrails.spec.ts` + transitions pass.

---

## PHASE 2 — FRONTEND HEALTH — VERIFIED OK

| Check | Result | Evidence |
|---|---|---|
| `tsc --noEmit` | ✅ exit 0 | no type errors |
| `next build` | ✅ "Compiled successfully" | warnings only (`<img>`, exhaustive-deps) |
| Hard build errors | ✅ none | only lint warnings |
| Project detail import (468e579) | ✅ compiles | `error/isError` added to `useQuery` |
| API base URL config | ✅ `NEXT_PUBLIC_API_URL` → `/api` | `lib/api.ts` strips trailing `/api`; localhost fallback |

Frontend checklist 1–8: build-level **VERIFIED OK**; per-route *runtime* rendering is **UNVERIFIED** (no running frontend) but all routes compiled into the build.

---

## PHASE 3 — RUNTIME / LIVE AUDIT

### Production liveness — VERIFIED OK
- `GET /api/health` → **200** `{"status":"ok","timestamp":"2026-06-02T06:29:28Z","version":"1.0.0","database":"connected","environment":"production"}`
- Protected routes (`/projects`, `/tickets`, `/notifications`, `/dashboard/overview`) → **401** (routes exist, auth guard active)
- `POST /api/auth/login` short password → **400** (DTO `@MinLength(6)` validation active in prod)
- `GET /api/projects/<cuid>` → **401** (auth guard precedes handler)

> ⚠️ **Deployed commit identity UNVERIFIED.** Health reports static version `1.0.0`, not a git SHA. I cannot confirm production is running `cac56d3` (with FP-13 fixes). Production is **up and DB-connected**, but whether the FP-13 code is *live* requires a Render dashboard check or a deploy.

### A. Authentication — PARTIAL (code OK, runtime UNVERIFIED)
- Code: case-insensitive lookup, bcrypt compare, JWT issuance, `/auth/me` guard — all present and unchanged.
- Production: login endpoint live (400/401 behavior correct).
- **UNVERIFIED:** actual SUPER_ADMIN / employee login, token persistence, logout — no credentials.

### B. Dashboard/Home — UNVERIFIED
- Route compiled; production `/dashboard/overview` returns 401 (exists). No runtime render verification.

### C. Projects — PARTIAL (fix verified at code + test level)
- CUID route fix (468e579): `ParseUUIDPipe` removed from `findOne/update/addMember/removeMember/remove` → CUID IDs now accepted. Verified in code + `p0.project-access.spec.ts` passes.
- Frontend now surfaces real API error (`isError` → `error.message`) instead of generic "could not be located" mask. Verified in diff.
- **UNVERIFIED:** live list/detail render, create/edit/delete, member add/remove, role scoping — no running app/credentials. (User reported local project list + detail working.)

### D. Tickets — PARTIAL (guardrails verified at code + test level)
- Guardrails (a0f8e57) verified in `tickets.service.ts`:
  - CLOSED → "Cannot modify a closed ticket" / "Cannot delete a closed ticket"
  - DONE + reassignment without reopen → "Cannot reassign a DONE ticket unless it is reopened first"
  - status→REVIEW/DONE while actor `ON_BREAK`/`LOGGED_OUT` → "Resume work before submitting or completing a ticket."
  - DONE transition map allows OPEN/IN_PROGRESS/CLOSED (reopen permitted).
- `ticket.guardrails.spec.ts` (unit) passes.
- **UNVERIFIED:** live create/edit/assign/status/kanban/block/unblock/approve-reject in browser.

### E. Workday — UNVERIFIED (code present, no runtime)
- Start/break/resume/end + team status endpoints present (FP-11A trace).
- **UNVERIFIED** at runtime. No crash evidence. Workday↔ticket-timer pause is **FUTURE (FP-13.1C)**, not a bug.

### F. Timer Ledger — FUTURE SCOPE (correctly not wired)
- `Ticket.reworkCount` ✅ (schema:244), `TicketTimeLog` ✅ (596), `ReviewCycleLog` ✅ (627).
- `TicketLedgerService` ✅ present (`ticket-ledger.service.ts:36`), registered + exported in `tickets.module.ts`, unit-tested (`ticket-ledger.service.spec.ts`).
- **NOT wired into live flows:** zero references to `ledger`/`timeLog`/`reviewCycle`/`reworkCount` in `tickets.service.ts` or `tickets.controller.ts`.
- **Classification: FUTURE / FP-13.1C — NOT a defect.**

### G. Leave — UNVERIFIED (code present)
- Endpoints + email decision hooks present. No runtime verification.

### H. Notifications — PARTIAL
- Production `/notifications` → 401 (route exists). In-app create/socket code present.
- ⚠️ **Note (carried from FP-11A):** notification entity columns required migration `20260530000001`; production health shows DB connected but migration application is **UNVERIFIED** here.
- **UNVERIFIED:** list/unread/mark-read/delete at runtime.

### I. Activity / Events — UNVERIFIED (route exists)
### J. Users / Roles / Departments — UNVERIFIED (routes/code present)

### K. Settings / Config
- Company / leave-policy / SLA / SMTP settings endpoints present (SuperAdmin-guarded).
- **Email = CONFIG REQUIRED** (Resend domain not verified; SMTP not set in DB).
- **Cloudinary = CONFIG REQUIRED** (placeholder env → base64 DB fallback).
- **OpenAI = CONFIG REQUIRED** (placeholder).

### L. Uploads / Attachments — CONFIG REQUIRED
- Cloudinary unconfigured → base64-in-Postgres fallback (FP-11 finding). Ticket attachment upload/download/delete code present; live behavior UNVERIFIED.

### M. Production logs — UNVERIFIED (no access). Public probes show no 404/500 on core routes.

### N. Browser DevTools — UNVERIFIED (no running frontend).

---

## CROSS-CUTTING / SECURITY

| Item | Finding | Class |
|---|---|---|
| `JWT_SECRET` (local `.env`) | Placeholder `"change-this-to-a-long-random-secret-in-production"` | **CONFIG REQUIRED / P0 (local)** — production value UNVERIFIED (Render env not visible; prod health is up so a secret is set) |
| DB migration sync (prod) | health = `database: connected`; schema version **UNVERIFIED** | UNVERIFIED |
| Deployed commit identity | no SHA in health | UNVERIFIED |
| Integration test DB | no seeded `admin@apex.local` in this env | UNVERIFIED (env) |

---

## DELIVERABLES
- `LIVE_STABILIZATION_AUDIT_MASTER.md` (this file)
- `LIVE_STABILIZATION_FEATURE_MATRIX.md`
- `LIVE_STABILIZATION_PRIORITY_BOARD.md`
- `LIVE_STABILIZATION_RUNTIME_ERRORS.md`
- `LIVE_STABILIZATION_NEXT_FIX_ORDER.md`
