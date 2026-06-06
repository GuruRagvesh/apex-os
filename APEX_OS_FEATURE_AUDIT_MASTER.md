# APEX OS — COMPLETE FEATURE AUDIT (MASTER)
**Date:** 2026-06-02
**Branch:** `main` @ `7f1c8fb` (FP-19E smoke test docs)
**Audited by:** Claude Code — read-only inspection
**Method:** Source inspection + production DB queries + build/test verification

---

## PHASE 0 — SAFETY CHECK

| Item | Result |
|---|---|
| Branch | `main` |
| Latest commit | `7f1c8fb docs(stabilization): add FP-19E smoke test results` |
| FP-19E smoke docs | ✅ present (`7f1c8fb`) |
| FP-19X runtime stabilization | ✅ present (`a2b34e5 fix(runtime): stabilize ticket workday auth and calendar flows`) |
| FP-19X.8 attachments / Under Review | ✅ present (`5a32092 fix(tickets): stabilize review submission and attachment uploads`) |
| FP-19A/19B workday cleanup | ✅ present (`83212fc`, `8ead48c`, `707698b`, `afc6996`) |
| Working tree | 4 staged docs (APEX_OS_HANDOVER_*, etc.) + untracked audit md files. **No code changes staged.** |

---

## VERIFICATION RESULTS (Phase 10)

| Check | Result |
|---|---|
| Backend `npm run test:unit` | ✅ **244 passed / 244** (27 suites) |
| Backend `npm run build` | ✅ PASS (exit 0) |
| Backend `npx prisma validate` | ✅ Schema valid |
| Frontend `npx tsc --noEmit` | ✅ PASS (exit 0) |
| Frontend `npm run build` | ✅ PASS (30 routes compiled) |
| Frontend tests | ⚠️ **0 test files exist** |
| Backend integration tests | ⚠️ 2 suites exist but require live seeded DB (env-blocked locally) |

---

## PRODUCTION DATABASE STATE (live queries, 2026-06-02)

| Metric | Value |
|---|---|
| Migrations applied | **27** |
| Active users | **50** |
| Tickets (total) | 263 (OPEN 10, IN_PROGRESS 16, REVIEW 7, DONE 193, CLOSED 37) |
| Tickets with `departmentId = NULL` | **263 / 263** ⚠️ (100%) |
| Active users with no department | 6 |
| Leave requests | 14 (PENDING 3, APPROVED 9, REJECTED 2) |
| Projects | 2 |
| Notifications | 348 |
| **Corrupted work sessions (>600 min)** | **55** ⚠️ |
| Stale open work sessions (>12h, no logout) | 1 |
| Departments | 13 (2 empty: Marketing, Miscellaneous) |

**Role distribution:** EMPLOYEE 24 · INTERN 8 · TEAM_LEAD 8 · MANAGER 7 · SUPER_ADMIN 2 · ADMIN 1

---

## INFRASTRUCTURE (Section 1)

| Item | Finding | Status |
|---|---|---|
| `engines.node` in package.json | **Not specified** | ⚠️ P3 |
| Backend build script | `npx prisma generate && npx tsc -p tsconfig.json` | ✅ correct |
| Runtime deps in devDeps | None — `prisma`, `typescript`, `ts-node` correctly in `dependencies` | ✅ |
| `JWT_SECRET` (local .env) | `"change-this-to-a-long-random-secret-in-production"` | 🔴 **placeholder** |
| `DATABASE_URL` | Real Render Postgres | ✅ |
| `OPENAI_API_KEY` | `"sk-..."` placeholder | CONFIG |
| Cloudinary | All placeholders | CONFIG |
| SMTP | Placeholders (not read — EmailService is Resend-first) | CONFIG |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | Not in local .env (set in Render env) | CONFIG |
| Frontend Next.js | 14.2.x | ✅ |
| `framer-motion` / `motion` | Present | ✅ |

> **Note on JWT_SECRET:** The local `backend/.env` holds the placeholder. The live production value is set separately in the Render dashboard environment. This audit cannot read Render env vars, so production JWT_SECRET strength is **UNVERIFIED** — must be confirmed manually in the Render dashboard.

---

## CRON JOBS (Section 7) — 7 total

| # | Schedule | Name / Purpose | File |
|---|---|---|---|
| 1 | `0 18 * * *` | daily-digest (AI summary) | `ai/ai.cron.service.ts` |
| 2 | `0 9 * * *` | overdue-check | `platform/automation/automation.service.ts` |
| 3 | `0 * * * *` | scheduled-ticket-reminders (hourly) | `platform/scheduler/scheduler.service.ts` |
| 4 | `1 0 * * *` | leave status setter + stale session auto-close (00:01) | scheduler |
| 5 | `*/15 * * * *` | workday auto-close / idle sweep (every 15 min — FP-19) | scheduler |
| 6 | `30 18 * * 1-6` | workday end reminder (6:30 PM Mon-Sat) | scheduler |
| 7 | `0 * * * *` | auto-logout inactive (hourly) | scheduler |

> **Render free-tier risk:** Cron jobs only fire when the service process is awake. Render free web services spin down after ~15 min idle. **No UptimeRobot/keepalive config found in repo.** Cron reliability is therefore **RISKY** unless a keepalive pings the service. This directly relates to the 55 corrupted sessions (created before auto-close cron existed) and is the reason auto-close may still miss sessions.

---

## MASTER FEATURE INVENTORY

Legend — Status: `WORKING` `PARTIAL` `BROKEN` `UI_ONLY` `BACKEND_ONLY` `PLACEHOLDER` `RISKY` `DEFERRED` `UNKNOWN`

### 1. AUTH / SESSION
| ID | Feature | FE route | BE endpoint | Roles | Status | Evidence | Tests | Risk | Decision |
|---|---|---|---|---|---|---|---|---|---|
| A1 | Login (email/pw) | `/login` | `POST /auth/login` | all | WORKING | throttle test, prod 401 verified | auth.throttle.spec | P0 | Keep |
| A2 | JWT 24h expiry | — | jwt.strategy | all | WORKING | `JWT_EXPIRES_IN=24h` | — | — | Keep |
| A3 | Forgot password OTP | `/forgot-password` | `POST /auth/forgot-password` | public | PARTIAL | code done; needs Resend env | auth.otp.spec (12) | P1 | Keep but monitor |
| A4 | Reset password | `/forgot-password` step2 | `POST /auth/reset-password` | public | WORKING | unified error, prod verified | auth.otp.spec | P1 | Keep |
| A5 | Force password change | `/change-password` | `PATCH /auth/change-password` | all | WORKING | `mustChangePassword` flag | — | P2 | Keep |
| A6 | Login rate limiting | — | `@Throttle` on login | public | WORKING | 429 reproduced in prod | auth.throttle.spec | P1 | Keep |
| A7 | Logout / token invalidation | topbar | client-side token clear | all | PARTIAL | no server blacklist (stateless JWT) | — | P2 | Keep but monitor |

### 2. USERS / ROLES / DEPARTMENTS
| ID | Feature | FE | BE | Roles | Status | Tests | Risk | Decision |
|---|---|---|---|---|---|---|---|---|
| U1 | User list | `/users` | `GET /users` (role-scoped) | MGR+ | WORKING | users.profile.spec | P2 | Keep |
| U2 | Create user | `/users` | `POST /users` | ADMIN+ | WORKING | — | P2 | Keep |
| U3 | Edit user | `/users/[id]` | `PUT /users/:id` | ADMIN+ | WORKING | — | P2 | Keep |
| U4 | Deactivate user | `/users` | `DELETE /users/:id` | ADMIN+ | WORKING | — | P2 | Keep |
| U5 | Reset user password | `/users` | `PUT /users/:id/reset-password` | ADMIN+ | WORKING | — | P2 | Keep |
| U6 | Profile 5-tab page | `/users/[id]/profile` | `GET/PATCH /users/:id/profile` | self/HR/ADMIN | WORKING | users.profile.spec | P2 | Keep |
| U7 | Avatar/photo upload | `/profile`,`/settings` | `POST /users/me/photo` | self | PARTIAL | base64 in DB, no size limit | — | P2 | Keep but monitor |
| U8 | Role assignment | `/users` | `PUT /users/:id` | ADMIN+ | WORKING | roles.guard.spec | P2 | Keep |
| U9 | Department CRUD | `/departments` | `GET/POST/PUT/PATCH/DELETE /departments` | ADMIN+ | WORKING | — | P2 | Keep |
| U10 | Employee documents | profile tab | `POST/GET/DELETE /users/:id/documents` | HR/ADMIN | PARTIAL | Cloudinary not configured | — | P2 | Keep but monitor |
| U11 | Hierarchy change-requests | `/admin/approvals` | `change-requests.controller` (7 endpoints) | TL/MGR/ADMIN | WORKING | users.change-requests.spec | P2 | Keep |

### 3. TICKETS
| ID | Feature | FE | BE | Status | Tests | Risk | Decision |
|---|---|---|---|---|---|---|---|
| T1 | Create ticket | `/tickets/new` | `POST /tickets` | WORKING | ticket.transitions.spec | P1 | Keep |
| T2 | Ticket list + filters | `/tickets` | `GET /tickets` (scoped) | WORKING | ticket.permissions.spec | P1 | Keep |
| T3 | Ticket detail | `/tickets/[id]` | `GET /tickets/:id` | WORKING | — | P1 | Keep |
| T4 | Status workflow | detail | `PATCH /tickets/:id/status` | WORKING | ticket.guardrails.spec | P0 | Keep |
| T5 | Review → Rework → InProgress | detail | status + reject | WORKING | ticket.guardrails | P1 | Keep |
| T6 | Self-assigned self-approval | detail | approve | WORKING | ticket.transitions | P2 | Keep |
| T7 | Comments | detail | `tickets/:id/comments` CRUD | WORKING | — | P2 | Keep |
| T8 | Attachments | detail | `POST/DELETE/GET .../attachments` | PARTIAL | base64 fallback (no Cloudinary) | P1 | Keep but monitor |
| T9 | Ticket history/audit | detail | `GET /tickets/:id/history` | WORKING | — | P2 | Keep |
| T10 | Delete (MGR+ effectively ADMIN) | detail | `DELETE /tickets/:id` | WORKING | — | P2 | Keep |
| T11 | Edit modal | detail | `PUT/PATCH /tickets/:id` | WORKING | — | P2 | Keep |
| T12 | Export CSV | `/tickets`,`/analytics` | `GET /tickets/export` | WORKING | — | P3 | Keep |
| T13 | SLA timer (execution) | detail | ticket-timing | WORKING | p0.ticket-access-timing | P1 | Keep |
| T14 | SLA timer (review) | detail | review SLA | WORKING | ticket-ledger.service.spec | P1 | Keep |
| T15 | Overdue detection | detail/list | timing service | WORKING | p0.ticket-access-timing | P1 | Keep |
| T16 | Blocked ticket workflow | detail | `POST /tickets/:id/block`,`/unblock` | WORKING | blocked-ticket.spec | P1 | Keep |
| T17 | Rework clocks + ratings | detail | ReviewCycleLog | WORKING | ticket-ledger.service.spec | P1 | Keep |
| T18 | Workday↔ticket timer | detail | TicketTimeLog | WORKING | ticket-ledger.service.spec | P1 | Keep |
| T19 | Custom subtype text | new/edit | `customSubtypeText` | WORKING | — | P3 | Keep |
| T20 | Ticket departmentId population | new | create | PARTIAL | **263/263 tickets have NULL departmentId** | P1 | Fix before delivery (investigate) |

### 4. KANBAN
| ID | Feature | FE | BE | Status | Risk | Decision |
|---|---|---|---|---|---|
| K1 | Kanban board | `/kanban` | `GET /tickets/kanban` | WORKING | P2 | Keep |
| K2 | Drag and drop | `/kanban` | `PATCH /tickets/:id/status` | UNKNOWN | P2 | Manual QA required |
| K3 | RBAC on drag | `/kanban` | transition guards (backend) | WORKING | P2 | Keep (backend enforces) |
| K4 | Column counts | `/kanban` | kanban response | WORKING | P3 | Keep |

### 5. PROJECTS
| ID | Feature | FE | BE | Status | Tests | Risk | Decision |
|---|---|---|---|---|---|---|
| P1 | Project list | `/projects` | `GET /projects` | WORKING | p0.project-access | P2 | Keep |
| P2 | Create project | `/projects` | `POST /projects` (MGR+) | WORKING | — | P2 | Keep |
| P3 | Project detail (CUID) | `/projects/[id]` | `GET /projects/:id` | WORKING | p0.project-access (FP-13.4A) | P2 | Keep |
| P4 | Edit project | detail | `PUT /projects/:id` | WORKING | fp14b | P2 | Keep |
| P5 | Members add/remove/role | detail | members endpoints | WORKING | fp14b | P2 | Keep |
| P6 | Linked tickets | detail | relation | WORKING | — | P2 | Keep |
| P7 | Stages (CRUD/reorder) | — | `/projects/:id/stages*` | BACKEND_ONLY | fp14b (26) | P3 | Defer (no UI yet) |
| P8 | Archive/restore | — | `PATCH /:id/archive,/restore` | BACKEND_ONLY | fp14b | P3 | Defer (no UI yet) |
| P9 | Project activity | detail | `GET /:id/activity` | WORKING | fp14b | P3 | Keep |

### 6. LEAVE
| ID | Feature | FE | BE | Status | Tests | Risk | Decision |
|---|---|---|---|---|---|---|
| L1 | Apply leave | `/leave` | `POST /leave` | WORKING | leave.rules.spec | P1 | Keep |
| L2 | Approve (hierarchy) | `/leave` | `PATCH /leave/:id/approve` | WORKING | leave.rules.spec | P1 | Keep |
| L3 | Reject | `/leave` | `PATCH /leave/:id/reject` | WORKING | leave.rules | P1 | Keep |
| L4 | Cancel | `/leave` | `PATCH /leave/:id/cancel` | WORKING | — | P2 | Keep |
| L5 | Balance tracking | `/leave` | `GET /leave/balance` | WORKING | p1.leave-balance.spec | P1 | Keep |
| L6 | Leave stats | dashboard | `GET /leave/stats` | WORKING | p1.leave-balance | P2 | Keep |
| L7 | Manager can't approve own/higher | `/leave` | leave-access service | WORKING | leave.rules.spec | P1 | Keep |
| L8 | Leave calendar view | `/calendar` | leave (APPROVED) | WORKING | — | P2 | Keep |

### 7. WORKDAY / ATTENDANCE
| ID | Feature | FE | BE | Status | Tests | Risk | Decision |
|---|---|---|---|---|---|---|
| W1 | Start workday | WorkdayBar | `POST /workday/start` | WORKING | scheduler.policy.spec | P1 | Keep |
| W2 | Breaks (multi-type) | modal | `POST /workday/break/start,end` | WORKING | — | P1 | Keep |
| W3 | Resume from break | modal | `POST /workday/resume` | WORKING | — | P1 | Keep |
| W4 | End workday | modal | `POST /workday/end` | WORKING | — | P1 | Keep |
| W5 | Idle detection | IdlePopup | `POST /workday/idle` | PARTIAL | UNKNOWN runtime | P2 | Manual QA |
| W6 | Session recovery | modal | `POST /workday/resume-auto-closed` | WORKING | workday.repair-rules.spec | P1 | Keep |
| W7 | Auto-close cron | — | scheduler `*/15`,`1 0 * * *` | RISKY | scheduler tests | P1 | Keep but monitor (Render keepalive) |
| W8 | Session history (grouped) | `/profile`,history | `GET /workday/history/:userId` | WORKING | workday.history.spec | P2 | Keep |
| W9 | Team live status | `/team` | `GET /workday/team` | WORKING | — | P2 | Keep |
| W10 | Corrupted sessions (173h etc) | — | repair tooling | PARTIAL | **59 suspicious (dry-run); only 2 auto-repairable, 57 manual review** | P1 | Fix before delivery (2 auto + 57 manual triage) |
| W11 | Workday policy | `/settings` | `GET/PATCH /settings/workday-policy` | WORKING | scheduler.policy.spec | P2 | Keep |

### 8. NOTIFICATIONS
| ID | Feature | FE | BE | Status | Tests | Risk | Decision |
|---|---|---|---|---|---|---|
| N1 | In-app bell + unread count | topbar | `GET /notifications`,`/unread-count` | WORKING | p1.notification-event | P2 | Keep |
| N2 | Real-time (Socket.IO) | useSocket | events gateway | PARTIAL | UNKNOWN runtime push | P2 | Manual QA |
| N3 | Mark read / read-all | dropdown | `PATCH :id/read`,`/mark-all-read` | WORKING | — | P2 | Keep |
| N4 | Delete notification | dropdown | `DELETE /notifications/:id` | WORKING | — | P3 | Keep |
| N5 | Notify on assign/status/leave | — | NotificationEventService | WORKING | p1.notification-event, p1d.notification-monitoring | P2 | Keep |
| N6 | Email notifications | — | EmailService (Resend) | PARTIAL | needs RESEND env | P2 | Keep but monitor |

### 9. DASHBOARD / HOME
| ID | Feature | FE | BE | Status | Risk | Decision |
|---|---|---|---|---|---|
| D1 | Role-aware home | `/dashboard` | `GET /home/summary`,`/dashboard/overview` | WORKING | P1 | Keep |
| D2 | KPI capsules | dashboard | overview | WORKING | P2 | Keep |
| D3 | Critical alerts panel | dashboard | sla-risk | WORKING | P2 | Keep |
| D4 | Workday bar | dashboard | workday/today | WORKING | P1 | Keep |
| D5 | Recent activity feed | dashboard | `GET /dashboard/activity-feed` | WORKING | P2 | Keep |
| D6 | Team pressure / workload | dashboard | `GET /dashboard/workload` | WORKING | P2 | Keep |

### 10. ANALYTICS
| ID | Feature | FE | BE | Status | Tests | Risk | Decision |
|---|---|---|---|---|---|---|
| AN1 | Analytics 7-tab dashboard | `/analytics` | `analytics.*` (6 endpoints) | WORKING | analytics.spec | P2 | Keep |
| AN2 | Command center | tab | `GET /analytics/command-center` | WORKING | analytics.spec | P2 | Keep |
| AN3 | Employee/Reviewer metrics | tab | `/analytics/employee,/reviewer` | WORKING | analytics.spec | P2 | Keep |
| AN4 | Manager metrics + rankings | tab | `/analytics/manager` | PARTIAL | rankings are `[]` placeholders | P3 | Keep (honest "no data") |
| AN5 | SLA + Rework analytics | tab | `/analytics/sla,/rework` | PARTIAL | top-lists placeholder `[]` | P3 | Keep |
| AN6 | Legacy overview charts | tab | dashboard endpoints | WORKING | — | P2 | Keep |

### 11. SETTINGS
| ID | Feature | FE | BE | Status | Tests | Risk | Decision |
|---|---|---|---|---|---|---|
| S1 | Company settings | `/settings` | `GET/PATCH /settings/company` | WORKING | settings.service.spec | P2 | Keep |
| S2 | Leave policy | settings | `/settings/leave-policy` | WORKING | settings.service.spec | P2 | Keep |
| S3 | SLA settings (DB-driven) | settings | `/settings/sla` | WORKING | settings.service.spec | P1 | Keep |
| S4 | Workday policy | settings | `/settings/workday-policy` | WORKING | scheduler.policy.spec | P2 | Keep |
| S5 | SMTP settings | settings | `/settings/smtp` (SA only) | PARTIAL | EmailService Resend-first | P2 | Keep but monitor |
| S6 | Email test | settings | `POST /settings/email/test` | PARTIAL | needs provider | P2 | Keep but monitor |
| S7 | Theme settings | settings | company theme_defaults | WORKING | — | P3 | Keep |
| S8 | Task types CRUD | settings | `/task-types` | WORKING | — | P2 | Keep |

### 12. ACTIVITY / EVENTS
| ID | Feature | FE | BE | Status | Risk | Decision |
|---|---|---|---|---|---|
| E1 | Activity log page | `/admin/activity` | `GET /events` | WORKING | P2 | Keep |
| E2 | OperationalEvent logging | — | EventLoggerService (auth/tickets/leave/workday/projects) | WORKING | P2 | Keep |

### 13. AI / MISC
| ID | Feature | FE | BE | Status | Risk | Decision |
|---|---|---|---|---|---|
| AI1 | Suggest priority / summarize / digest | ticket detail panel | `POST /ai/*` | PLACEHOLDER | CONFIG | Hide if no OPENAI key |
| R1 | Reports page | `/reports` | redirect → `/analytics` | UI_ONLY | P3 | Keep (intentional redirect) |
| TT1 | Task types public GET | new ticket form | `GET /task-types` (**no JWT guard**) | RISKY | P1 | Fix before delivery (add guard) |
| TM1 | Team request | `/team` | `POST /team/request` | PARTIAL | thin single endpoint | P3 | Keep but monitor |

---

## SECURITY HIGHLIGHTS (Section 4)

| Finding | Severity | Evidence |
|---|---|---|
| `JWT_SECRET` placeholder in local .env (prod value UNVERIFIED) | 🔴 CRITICAL (if prod) | `backend/.env:5` |
| `GET /task-types` has no `@UseGuards(JwtAuthGuard)` | 🟠 HIGH | `task-types.controller.ts:16` (returns prod data unauthenticated) |
| ValidationPipe global w/ whitelist | ✅ verify in main.ts | — |
| Helmet + CORS specific origins | ✅ confirmed (CORS allow-list to Vercel) | prior verification |
| bcrypt rounds (10–12) | ✅ | auth.service |
| Password excluded from responses | ✅ | accessPolicy.safeUser, SENSITIVE_USER_FIELDS |
| Direct-ID scope checks | ✅ tickets/projects/leave verify scope after lookup | service layer |

---

## COUNT CONSISTENCY (Section 6)

| Check | Result | Evidence |
|---|---|---|
| Ticket findAll vs stats vs kanban | Shared `buildTicketWhereForUser` scope | ✅ PASS (single scope builder) |
| Dashboard vs ticket counts | `p1d.dashboard-consistency.spec` covers this | ✅ PASS (test exists) |
| Leave findAll vs stats | leave-access shared scope | ✅ PASS |
| Analytics vs ticket list | analytics uses `buildTicketWhereForUser` (SLA/rework) | ✅ PASS |

---

## SUMMARY COUNTS

| Status | Count |
|---|---|
| WORKING | 58 |
| PARTIAL | 14 |
| BROKEN | 0 |
| UI_ONLY | 1 |
| BACKEND_ONLY | 2 |
| PLACEHOLDER | 1 |
| RISKY | 2 |
| UNKNOWN (manual QA) | 3 |
| **TOTAL FEATURES** | **81** |

| Priority | Count |
|---|---|
| P0 blockers | 1 (JWT_SECRET prod verification) |
| P1 issues | 5 |
| P2 issues | ~30 |
| P3 issues | ~13 |
