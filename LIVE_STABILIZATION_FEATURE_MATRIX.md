# LIVE STABILIZATION — FEATURE MATRIX
**Date:** 2026-06-02 | Branch `main` @ `cac56d3`

Classifications: **VERIFIED OK · PARTIAL · BROKEN · MISSING · CONFIG REQUIRED · UNVERIFIED · FUTURE SCOPE**

| # | Module / Feature | Observed (evidence) | Expected | Classification | Priority |
|---|---|---|---|---|---|
| 1 | Repo / Git state | `main`==`origin/main`==`cac56d3`; 4 FP commits ancestors; clean tree | merged + synced | **VERIFIED OK** | — |
| 2 | Prisma schema | `prisma validate` exit 0 | valid | **VERIFIED OK** | — |
| 3 | Backend build | `npm run build` exit 0 | compiles | **VERIFIED OK** | — |
| 4 | Backend unit tests | 16 suites / 129 tests pass | green | **VERIFIED OK** | — |
| 5 | Backend integration tests | `smoke.spec` login 401 (no seeded DB) | green w/ seed | **UNVERIFIED** | P2 |
| 6 | DB migration sync (prod) | `migrate status` P1001 from sandbox; prod health `db connected` | applied | **UNVERIFIED** | P1 |
| 7 | Frontend tsc | exit 0 | no type errors | **VERIFIED OK** | — |
| 8 | Frontend build | "Compiled successfully" (warnings only) | builds | **VERIFIED OK** | — |
| 9 | Production backend liveness | `/api/health` → 200, db connected, env production | up | **VERIFIED OK** | — |
| 10 | Production deployed commit = cac56d3 | health shows version `1.0.0`, no SHA | FP-13 live | **UNVERIFIED** | P1 |
| 11 | Production routing/auth guard | protected routes → 401; login DTO 400 on short pw | guarded | **VERIFIED OK** | — |
| 12 | Auth — login/me/logout (runtime) | code intact; no creds to exercise | works | **PARTIAL** | P0 |
| 13 | Dashboard/Home (runtime) | route 401 (exists); not rendered | loads | **UNVERIFIED** | P1 |
| 14 | Projects — CUID detail route fix | `ParseUUIDPipe` removed (468e579) + unit test pass | CUID accepted | **VERIFIED OK** (code/test) | P0 |
| 15 | Projects — error surfacing | frontend `isError`→`error.message` (no mask) | honest error | **VERIFIED OK** (code) | P1 |
| 16 | Projects — CRUD/members/scoping (runtime) | not exercised; user reports local OK | works | **PARTIAL** | P1 |
| 17 | Tickets — state guardrails | CLOSED no-modify/delete, DONE no-reassign, break/logout no-submit (a0f8e57) + tests | enforced | **VERIFIED OK** (code/test) | P0 |
| 18 | Tickets — create/edit/assign/status/kanban (runtime) | code present; not exercised | works | **PARTIAL** | P1 |
| 19 | Tickets — block/unblock (runtime) | FP-10 code present; not exercised | works | **PARTIAL** | P1 |
| 20 | Tickets — approve/reject/review (runtime) | code present; not exercised | works | **UNVERIFIED** | P1 |
| 21 | Timer Ledger — schema | `TicketTimeLog`,`ReviewCycleLog`,`reworkCount` present | exists | **VERIFIED OK** | — |
| 22 | Timer Ledger — service | `TicketLedgerService` present + unit-tested | exists | **VERIFIED OK** | — |
| 23 | Timer Ledger — live wiring | NOT referenced in tickets.service/controller | not yet wired | **FUTURE SCOPE** (FP-13.1C) | FUTURE |
| 24 | Workday — start/break/resume/end (runtime) | endpoints/code present; not exercised | works | **UNVERIFIED** | P1 |
| 25 | Workday — team live status (runtime) | code present; not exercised | works | **UNVERIFIED** | P2 |
| 26 | Leave — apply/approve/reject/cancel/balance (runtime) | code present; not exercised | works | **UNVERIFIED** | P1 |
| 27 | Notifications — list/unread/read/delete (runtime) | route 401 (exists); not exercised | works | **UNVERIFIED** | P1 |
| 28 | Notifications — entity columns migration | needs `20260530000001`; prod sync UNVERIFIED | applied | **UNVERIFIED** | P1 |
| 29 | Activity / Events (runtime) | route exists; not exercised | works | **UNVERIFIED** | P2 |
| 30 | Users / Roles / Departments (runtime) | code present; not exercised | works | **UNVERIFIED** | P2 |
| 31 | Settings — company/leave/SLA (runtime) | endpoints present; not exercised | works | **UNVERIFIED** | P2 |
| 32 | Email — Resend | no verified domain (per context) | sends | **CONFIG REQUIRED** | CONFIG |
| 33 | Email — SMTP fallback | not configured in DB settings | sends | **CONFIG REQUIRED** | CONFIG |
| 34 | OTP delivery (FP-11B) | wired to EmailService; needs provider | delivers | **CONFIG REQUIRED** | CONFIG |
| 35 | Uploads / Cloudinary | placeholder env → base64 DB fallback | cloud storage | **CONFIG REQUIRED** | CONFIG |
| 36 | AI / OpenAI | placeholder key | AI features | **CONFIG REQUIRED** | CONFIG |
| 37 | `JWT_SECRET` (local .env) | placeholder string | strong secret | **CONFIG REQUIRED** | P0 (local) |
| 38 | Production logs | no dashboard access | clean | **UNVERIFIED** | P2 |
| 39 | Browser DevTools console/network | no running frontend | clean | **UNVERIFIED** | P2 |

---

## CLASSIFICATION COUNTS (39 rows audited)

| Classification | Count |
|---|---|
| **VERIFIED OK** | 11 |
| **PARTIAL** | 5 |
| **BROKEN** | 0 |
| **MISSING** | 0 |
| **CONFIG REQUIRED** | 6 |
| **UNVERIFIED** | 16 |
| **FUTURE SCOPE** | 1 |

> **0 BROKEN, 0 MISSING.** The high UNVERIFIED count reflects this sandbox's inability to run authenticated runtime flows / reach the production DB / access logs — **not** evidence of failure. All code-level and build/test checks that *could* run are green.
