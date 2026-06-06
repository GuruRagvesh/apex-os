# Apex OS Complete Audit Report
Date: 2026-06-05
Audited by: Claude Code

## Executive Summary

Audit mode was read-only except for creation of this requested report file. No code fixes, migrations, provider changes, or commits were made.

Active workspace audited: `C:\Projects\nexus-app`.

The pasted request referenced `C:\Users\Administrator\Desktop\nexus-app`; that path is not present in this environment. The actual shared workspace is `C:\Projects\nexus-app`.

Overall completion estimate: 77% risk-adjusted, 79% by feature matrix weighting.

Backend build: PASS. `npm run build` completed Prisma client generation and TypeScript compilation.

Frontend build: PASS. Next.js compiled successfully and generated 27 static pages. Build emitted warnings only.

Prisma schema validation: PASS. `npx prisma validate` reported the schema is valid.

Production frontend check: PASS. `https://apex-os-frontend.vercel.app` returned HTTP 200.

Production backend check: FAIL. `https://apex-os-api.onrender.com` is reachable, but all checked routes returned 404, including `/api/health`, `/health`, `/api/auth/me`, `/auth/me`, `/api/tickets`, `/api`, and `/`.

Critical security issues confirmed: 4.

P0 bugs confirmed present: 2.

P0 bugs confirmed fixed: 0. Several recent workflow bugs are fixed, but none of the currently confirmed P0s are fixed.

Total feature rows audited: 99.

Features complete: 68.

Features partial: 21.

Features missing: 4.

Features broken: 6.

Total confirmed issues and gaps: 24.

Priority counts:

| Priority | Count |
| --- | ---: |
| P0 | 2 |
| P1 | 8 |
| P2 | 9 |
| P3 | 5 |

Exact next fix recommended: fix and verify the production backend 404 first. Nothing else can be confidently production-verified until the API host serves the expected Nest app routes.

## Section 1: Infrastructure

### Package Structure

| Area | Status | Evidence |
| --- | --- | --- |
| Backend package | Present | `backend/package.json`, package name `apex-os-backend` |
| Frontend package | Present | `frontend/package.json`, Next.js `14.2.3` |
| Render deploy file | Present | `render.yaml` at repo root |
| Backend start command | Present | `npx prisma migrate deploy && node dist/main.js` |
| Backend build command | Present | `npm install --include=dev && npm run build` |
| Frontend build | Present | `next build` |
| Node engine pin | Missing | No `engines.node` in backend or frontend package files |

### Dependencies

Backend build dependencies are available in `dependencies`, not only `devDependencies`: `prisma`, `typescript`, and `ts-node` are present. This is safe for Render because the current `render.yaml` also installs dev dependencies.

Frontend uses `motion`, not `framer-motion`. This matches imports found in the UI, including the dashboard sidebar.

### Environment Status

Secrets were not printed or copied into this report. Only presence/config state was checked.

| Variable/Service | Local Status | Production Status | Classification |
| --- | --- | --- | --- |
| `DATABASE_URL` | Set | Read-only DB checks succeeded | Config present |
| `JWT_SECRET` | Set but placeholder-like locally | Unverified | P1/P2 config risk |
| `JWT_EXPIRES_IN` | `24h` | Unverified | Present |
| `FRONTEND_URL` | `http://localhost:3000` | Render references env var | Config required in prod |
| `RESEND_API_KEY` | Missing locally | User context says Resend blocked until domain verification | Config/operational gap |
| `RESEND_FROM_EMAIL` | Missing locally | User context says domain not verified | Config/operational gap |
| `SMTP_*` | Set locally | SMTP fallback intentionally paused | Do not fix now |
| `OPENAI_API_KEY` | Set locally | Unverified | Config required before AI prod use |
| `CLOUDINARY_*` | Set locally, secret placeholder-like | Unverified | Config required |
| Frontend `.env` | Missing locally | Unverified | Frontend uses fallback API URL locally |

Important nuance: unconfigured Resend, Cloudinary, or OpenAI are not counted as code bugs by themselves. They are marked CONFIG REQUIRED unless code behavior creates a separate bug.

### Build and Lint Output

Backend:

- Build result: PASS.
- Prisma client generation: PASS.
- TypeScript compile: PASS.

Frontend:

- Build result: PASS.
- Generated static pages: 27.
- Next route table includes 30 app routes.
- Warnings:
  - `frontend/app/(dashboard)/(operations)/projects/page.tsx`: missing hook dependency.
  - `frontend/app/(dashboard)/(operations)/team/page.tsx`: missing hook dependencies.
  - `frontend/components/tickets/OverdueTicker.tsx`: missing hook dependency.
  - `frontend/components/ui/command-palette.tsx`: missing hook dependency.
  - `frontend/components/workday/WorkdayBar.tsx`: missing hook dependency.
  - Multiple `<img>` warnings in ticket detail, department detail, users pages, multi-select, and user avatar.

### Deployment Health

Production frontend:

- `https://apex-os-frontend.vercel.app`: HTTP 200.

Production backend:

- `https://apex-os-api.onrender.com/api/health`: HTTP 404.
- `https://apex-os-api.onrender.com/health`: HTTP 404.
- `https://apex-os-api.onrender.com/api`: HTTP 404.
- `https://apex-os-api.onrender.com/`: HTTP 404.
- `https://apex-os-api.onrender.com/api/auth/me`: HTTP 404.
- `https://apex-os-api.onrender.com/auth/me`: HTTP 404.
- `https://apex-os-api.onrender.com/api/tickets`: HTTP 404.

Classification: P0 production deploy/routing/startup gap.

Safe fix recommendation: verify Render service root directory, current deployed commit, build output, `dist/main.js` startup, Nest global prefix, service URL, and any reverse-proxy route rewrite. This is deployment/config verification first, not a code change unless the deployed service is pointing at the wrong app or command.

### Cron and Render Sleep Risk

Cron jobs exist:

- `backend/src/modules/ai/ai.cron.service.ts`: daily digest.
- `backend/src/modules/platform/automation/automation.service.ts`: overdue check.
- `backend/src/modules/platform/scheduler/scheduler.service.ts`: scheduled reminders, recurring tickets, workday auto-close, hourly tasks.
- `backend/src/app.module.ts`: `ScheduleModule.forRoot()`.

No repo-level UptimeRobot or keepalive configuration was found. If the Render backend sleeps, cron reliability is unverified.

Classification: P2 reliability/config gap.

## Section 2: Database and Prisma

Prisma validation result: PASS.

Applied production migrations: 27.

### Prisma Model Inventory

| Model | Field Count | Primary Modules |
| --- | ---: | --- |
| `User` | 79 | Auth, users, RBAC, workday, dashboards |
| `EmployeeDocument` | 14 | User profile documents |
| `Role` | 6 | RBAC |
| `Department` | 10 | Departments, users, tickets, projects |
| `Project` | 15 | Projects, tickets |
| `ProjectStage` | 13 | Project stages |
| `ProjectMember` | 7 | Project membership |
| `Ticket` | 55 | Tickets, kanban, dashboard, analytics |
| `TicketAssignee` | 6 | Multi-assignee tickets |
| `Comment` | 8 | Ticket comments |
| `Attachment` | 10 | Ticket attachments |
| `LeaveRequest` | 17 | Leave |
| `Notification` | 11 | Notifications |
| `ActivityLog` | 8 | Activity feed |
| `TicketHistory` | 9 | Ticket history |
| `TaskType` | 9 | Task type settings/forms |
| `TaskSubtype` | 6 | Task subtype settings/forms |
| `AppSetting` | 5 | Settings |
| `WorkSession` | 23 | Workday |
| `BreakLog` | 16 | Workday breaks |
| `UserWorkdayPolicyOverride` | 17 | Workday policies |
| `AttendanceEvent` | 9 | Workday/attendance |
| `OperationalEvent` | 12 | Calendar/events/activity |
| `ManagerDeptAccess` | 7 | Manager role visibility |
| `TicketTimeLog` | 19 | Ticket timers/analytics |
| `ReviewCycleLog` | 22 | Review/rework analytics |
| `EmployeeProfileChangeRequest` | 23 | Approval workflow |

Enums present: `ProjectStatus`, `Priority`, `TicketStatus`, `TicketCategory`, `TicketType`, `LeaveType`, `LeaveStatus`, `NotificationType`.

### Production Data Integrity Checks

Read-only production DB checks were run through Prisma using the configured `DATABASE_URL`; the URL and credentials are redacted.

| Check | Result | Status |
| --- | ---: | --- |
| Applied migrations | 27 | OK |
| Tickets with `departmentId IS NULL` | 263 | P1 data gap |
| Active users with `departmentId IS NULL` | 6 | P1 data gap |
| Leave requests with `userId IS NULL` | 0 | OK |
| Tickets with invalid department FK | 0 | OK |
| Users with invalid department FK | 0 | OK |
| Tickets with invalid assigned-user FK | 0 | OK |
| Corrupt/stale work sessions under current schema | 66 | P1 data gap |
| Open work sessions | 17 | Needs review |
| Long work sessions over 600 minutes | 55 | P1 data gap |
| Stale open work sessions over 12 hours | 11 | P1 data gap |

The prompt's sample workday SQL referenced `endWorkAt`. Current schema uses `logoutAt`, so the equivalent check was run against `logoutAt`.

Null ticket department breakdown by status:

| Status | Count |
| --- | ---: |
| DONE | 193 |
| CLOSED | 37 |
| IN_PROGRESS | 16 |
| OPEN | 10 |
| REVIEW | 7 |

Active non-terminal tickets with null department: 33.

Active users with null department by role:

| Role | Count |
| --- | ---: |
| EMPLOYEE | 3 |
| MANAGER | 2 |
| INTERN | 1 |

Active user role distribution:

| Role | Count |
| --- | ---: |
| EMPLOYEE | 24 |
| INTERN | 8 |
| TEAM_LEAD | 8 |
| MANAGER | 7 |
| SUPER_ADMIN | 2 |
| ADMIN | 1 |

Department membership:

| Department | Active Users |
| --- | ---: |
| ID Team | 8 |
| Editors | 6 |
| Retail Business | 6 |
| AI and R&D | 5 |
| AI & Media Production | 3 |
| Company / Operations | 3 |
| Corporate Training | 3 |
| QC Team | 3 |
| Sales | 3 |
| Accounts | 2 |
| HR | 2 |
| Marketing | 0 |
| Miscellaneous | 0 |

### DB Gaps

P1: `User.departmentId` is nullable and production has 6 active users without a department. Because team, manager, ticket, project, and dashboard visibility depend on departments, these users can disappear from scoped views.

P1: `Ticket.departmentId` is nullable and production has 33 active tickets without a department. Dashboards, departments, kanban filters, and role visibility can drift.

P2: `Attachment.ticketId` has no direct index, while attachments are queried by ticket.

P2: `WorkSession.logoutAt` has no direct index, while scheduler cron scans open sessions with `logoutAt: null`.

Migration recommendation: do not create migrations as part of this audit. First fix code paths that create null departments, manually repair production data, then consider constraints/indexes in a separate migration pass.

## Section 3: Backend API Audit

Global backend behavior:

- `backend/src/main.ts` sets global prefix `api`.
- `helmet()` is enabled.
- `compression()` is enabled.
- CORS allows local hosts, Vercel production/preview, and `FRONTEND_URL`.
- Global `ValidationPipe` uses `whitelist`, `transform`, and `forbidNonWhitelisted`.
- Swagger is disabled in production.
- Required env validation includes `DATABASE_URL` and `JWT_SECRET`.

### Controller Inventory

All backend controllers found under `backend/src`:

| Controller | Routes | Status |
| --- | --- | --- |
| `backend/src/modules/core/auth/auth.controller.ts` | `POST /auth/login`, `POST /auth/register`, `PATCH /auth/change-password`, `GET /auth/me`, `POST /auth/forgot-password`, `POST /auth/reset-password` | Present, P0 forgot-password provider failure bug |
| `backend/src/modules/core/users/users.controller.ts` | `/users`, `/users/me`, `/users/my-team`, photo, preferences, stats, directory, profile, documents | Present, upload validation gap |
| `backend/src/modules/core/users/change-requests.controller.ts` | `/users/:id/hierarchy-summary`, change requests, approvals | Present |
| `backend/src/modules/core/roles/roles.controller.ts` | role list/detail/create/update/delete | Present |
| `backend/src/modules/core/departments/departments.controller.ts` | department list/detail/create/update/patch/delete | Present |
| `backend/src/modules/operations/tickets/tickets.controller.ts` | ticket list/stats/sla/kanban/export/detail/history/create/update/status/assign/block/unblock/approve/reject/delete/attachments | Present, service CUID issue |
| `backend/src/modules/operations/comments/comments.controller.ts` | ticket comments list/create/update/delete | Present |
| `backend/src/modules/operations/projects/projects.controller.ts` | project list/stats/detail/create/update/members/stages/activity/archive/restore/delete | Present, service CUID issue |
| `backend/src/modules/operations/leave/leave.controller.ts` | leave list/detail/create/approve/reject/cancel/stats/balance | Present |
| `backend/src/modules/operations/notifications/notifications.controller.ts` | list/unread/mark-all/mark-read/delete | Present, mark-read/delete broken for CUID IDs |
| `backend/src/modules/operations/team/team.controller.ts` | team request | Present |
| `backend/src/modules/platform/dashboard/dashboard.controller.ts` | overview/category/department/activity/workload/trend | Present |
| `backend/src/modules/platform/dashboard/home.controller.ts` | home summary | Present |
| `backend/src/modules/platform/analytics/analytics.controller.ts` | employee/reviewer/manager/sla/rework/command-center | Present, partial RBAC/count gaps |
| `backend/src/modules/platform/events/events.controller.ts` | events list | Present |
| `backend/src/modules/platform/settings/settings.controller.ts` | company, leave policy, SLA, workday policy, SMTP, email test | Present, company/theme bug |
| `backend/src/modules/platform/task-types/task-types.controller.ts` | task type list/all/create/update/delete/subtypes | Present, public list is unauthenticated |
| `backend/src/modules/platform/workday/workday.controller.ts` | history/start/end/break/idle/resume/today/team | Present |
| `backend/src/modules/platform/health/health.controller.ts` | `GET /health` under global `/api` prefix | Present locally, production 404 |
| `backend/src/modules/ai/ai.controller.ts` | suggest priority, summarize tickets, ticket suggestions, trigger digest | Present, AI scope gap before enabling |

### Service Inventory

All backend services found under `backend/src`:

- `backend/src/common/services/access-policy.service.ts`
- `backend/src/common/services/event-logger.service.ts`
- `backend/src/common/services/leave-access.service.ts`
- `backend/src/common/services/ticket-access.service.ts`
- `backend/src/common/services/ticket-timing.service.ts`
- `backend/src/modules/ai/ai.cron.service.ts`
- `backend/src/modules/ai/ai.service.ts`
- `backend/src/modules/core/auth/auth.service.ts`
- `backend/src/modules/core/departments/departments.service.ts`
- `backend/src/modules/core/roles/roles.service.ts`
- `backend/src/modules/core/users/change-requests.service.ts`
- `backend/src/modules/core/users/users.service.ts`
- `backend/src/modules/operations/comments/comments.service.ts`
- `backend/src/modules/operations/leave/leave-balance.service.ts`
- `backend/src/modules/operations/leave/leave.service.ts`
- `backend/src/modules/operations/notifications/notification-event.service.ts`
- `backend/src/modules/operations/notifications/notifications.service.ts`
- `backend/src/modules/operations/projects/projects.service.ts`
- `backend/src/modules/operations/team/team.service.ts`
- `backend/src/modules/operations/tickets/ticket-ledger.service.ts`
- `backend/src/modules/operations/tickets/tickets.service.ts`
- `backend/src/modules/platform/analytics/analytics.service.ts`
- `backend/src/modules/platform/automation/automation.service.ts`
- `backend/src/modules/platform/dashboard/dashboard.service.ts`
- `backend/src/modules/platform/email/email.service.ts`
- `backend/src/modules/platform/scheduler/scheduler.service.ts`
- `backend/src/modules/platform/settings/settings.service.ts`
- `backend/src/modules/platform/task-types/task-types.service.ts`
- `backend/src/modules/platform/uploads/uploads.service.ts`
- `backend/src/modules/platform/workday/workday.service.ts`
- `backend/src/prisma/prisma.service.ts`

### Backend Bugs and Evidence

#### P0: Production Backend Returns 404

Evidence:

- Production host reachable, but all checked API routes return 404.
- Local code has `HealthController` at `backend/src/modules/platform/health/health.controller.ts`.
- Local global prefix in `backend/src/main.ts` means health should be `/api/health`.

Impact: blocks login, dashboard, tickets, workday, notifications, and all production API workflows.

Fix type: deploy/config/manual verification first.

#### P0: Forgot-Password Enumeration Under Email Provider Failure

Evidence:

- `backend/src/modules/core/auth/auth.service.ts:158` starts `sendOtp`.
- `backend/src/modules/core/auth/auth.service.ts:179` calls `emailService.sendOtpEmail`.
- `backend/src/modules/platform/email/email.service.ts:56` implements strict OTP send behavior.
- Unknown emails return generic success without provider send.
- Known emails hit provider send; provider failure can bubble to the client.

Impact: when Resend is missing or blocked, a registered email can behave differently from an unregistered email. This weakens auth enumeration hardening.

Safe fix recommendation: preserve the generic response for all cases, log provider failure internally, and avoid exposing provider errors from forgot-password. Do not change email provider in this pass.

Fix type: code.

#### P1: CUID IDs Misclassified as Names

Evidence:

- `backend/src/modules/operations/tickets/tickets.service.ts:14` defines `isUUID`.
- `backend/src/modules/operations/tickets/tickets.service.ts:261-273` resolves `departmentId` and `assignedToId` only if the value is UUID; otherwise treats it as a display name.
- `backend/src/common/services/ticket-access.service.ts:7` defines the same UUID-only helper.
- `backend/src/common/services/ticket-access.service.ts:332-334` returns the filter value only if UUID.
- `backend/src/modules/operations/projects/projects.service.ts:11` defines the same UUID-only helper.
- `backend/src/modules/operations/projects/projects.service.ts:113-118` resolves project `departmentId` with UUID-only logic.
- Prisma IDs are CUID, not UUID.
- Production has 263 tickets with null `departmentId`, including 33 active tickets.

Impact: create/filter flows can drop valid CUID department/assignee/project IDs or treat them as names.

Safe fix recommendation: accept CUID-like Prisma IDs directly, or stop overloading ID fields with names. If display names are supported, use separate fields.

Fix type: code plus production data repair/manual verification.

#### P1: Notification Mark-Read/Delete Broken for CUID IDs

Evidence:

- `backend/src/modules/operations/notifications/notifications.controller.ts:1` imports `ParseUUIDPipe`.
- `backend/src/modules/operations/notifications/notifications.controller.ts:31` uses `ParseUUIDPipe` for `PATCH /notifications/:id/read`.
- `backend/src/modules/operations/notifications/notifications.controller.ts:36` uses `ParseUUIDPipe` for `DELETE /notifications/:id`.
- Prisma IDs are CUID.
- Frontend `notificationsApi.markRead` and `notificationsApi.remove` pass IDs from the backend.

Impact: clicking a notification or deleting one can fail with 400.

Safe fix recommendation: remove `ParseUUIDPipe` or replace with a CUID-compatible validation pipe used consistently.

Fix type: code.

#### P1: Settings Company/Theme Save Can Wipe Company Settings

Evidence:

- `backend/src/modules/platform/settings/settings.controller.ts:30` `updateCompany`.
- `backend/src/modules/platform/settings/settings.controller.ts:31` destructures `defaultTheme` and `defaultAccent` into separate variables and `...rest`.
- `backend/src/modules/platform/settings/settings.controller.ts:35` always saves `rest` to the `company` setting.
- If the frontend sends only theme defaults, `rest` is `{}` and company settings can be overwritten as empty.

Impact: appearance/theme saves can erase company settings.

Safe fix recommendation: update theme defaults independently and save `company` only when company fields are present, or merge with existing company settings.

Fix type: code.

#### P1: Settings Audit User ID Is Undefined

Evidence:

- `backend/src/modules/platform/settings/settings.controller.ts:35`, `:47`, `:64`, `:65`, `:79` use `req.user?.sub`.
- `JwtStrategy` returns a user object with `id`, not `sub`.

Impact: settings `updatedBy` and settings activity events may lose actor attribution.

Safe fix recommendation: use `req.user?.id`.

Fix type: code.

#### P1: AI Ticket Suggestions Bypass Ticket Scope Before AI Is Enabled

Evidence:

- `backend/src/modules/ai/ai.controller.ts:38-39` calls `aiService.ticketSuggestions(id)` without passing current user.
- `backend/src/modules/ai/ai.service.ts:159` starts `ticketSuggestions`.
- `backend/src/modules/ai/ai.service.ts:165` uses `prisma.ticket.findFirst` directly.

Impact: once OpenAI is enabled in production, authenticated users may be able to request suggestions for tickets outside their role scope.

Safe fix recommendation: pass `CurrentUser` into AI service and use `TicketAccessService.findAccessibleTicket`.

Fix type: code.

#### P1: User Photo and Document Upload Validation Gap

Evidence:

- `backend/src/modules/core/users/users.controller.ts:40` uses `FileInterceptor('photo')` without size/type config.
- `backend/src/modules/core/users/users.controller.ts:120` uses `FileInterceptor('file')` without size/type config.
- Ticket attachments already have 5 MB limit and MIME allowlist in `backend/src/modules/operations/tickets/tickets.controller.ts:88-90`.

Impact: user uploads can accept unexpectedly large or unsafe file types. User photo/documents are also stored as base64 in DB by the user service.

Safe fix recommendation: add size limits and MIME allowlist for user photo/documents. Longer-term storage strategy should use Cloudinary or object storage after config is verified.

Fix type: code/config.

#### P1: Production Workday Data Corruption Still Present

Evidence:

- Production read-only DB check found 66 corrupt/stale work sessions.
- 55 sessions have `totalWorkMinutes > 600`.
- 11 stale open sessions are older than 12 hours.
- 17 open sessions exist.

Impact: team live status, workday history, dashboard summaries, and analytics can show impossible durations.

Safe fix recommendation: after production API routing is fixed, verify scheduler is deployed and running, then run a manual production data repair with a reviewed script. Do not create a migration for this cleanup.

Fix type: manual data repair plus deployment verification.

## Section 4: RBAC and Security

### RBAC Summary

RBAC is present and mostly centralized:

- `RolesGuard` checks `user.role.name`.
- `JwtAuthGuard` protects most controllers.
- `AccessPolicyService` is used for user/project/team visibility.
- `TicketAccessService` is used for ticket list/detail/actions.
- `LeaveAccessService` is used for leave list/detail/actions.

Areas verified as improved:

- Ticket list, stats, kanban, dashboard, and home summary use ticket scoping.
- Leave list and leave stats use leave scoping.
- Projects list/detail uses project scoping.
- Department list is available to authenticated users, not admin-only.
- Projects route params no longer use `ParseUUIDPipe`.
- Block/unblock routes use ticket access checks.
- Leave self-approval and same/higher role approval are blocked in code.

### Security Gaps

| Priority | Gap | Evidence | Fix Type |
| --- | --- | --- | --- |
| P0 | Forgot-password provider failure reveals registered emails | `auth.service.ts:158`, `auth.service.ts:179`, `email.service.ts:56` | Code |
| P1 | AI ticket suggestions do not use ticket access scope | `ai.controller.ts:38-39`, `ai.service.ts:165` | Code |
| P1 | User uploads lack size/type validation | `users.controller.ts:40`, `users.controller.ts:120` | Code |
| P1/P2 | Local `JWT_SECRET` is placeholder-like | local env classification | Env config |
| P2 | Public task-type list has no JWT guard | `task-types.controller.ts:16` | Code or intentional public decision |
| P2 | Multi-assignee counts drift from role expectations | dashboard/users/analytics count by `assignedToId` | Code |

### Direct ID Access Review

| Module | Status |
| --- | --- |
| Tickets | Mostly safe. `TicketAccessService.findAccessibleTicket` scopes detail/actions. CUID filter bug remains. |
| Users | Mostly safe. `AccessPolicyService.canViewUser` protects profile/detail paths. |
| Leave | Mostly safe. `LeaveAccessService` protects detail and action paths. |
| Projects | Mostly safe. Project scope is applied. |
| AI | Not safe before enablement. Ticket suggestions direct-query by ID without user scope. |
| Notifications | Ownership check exists in controller before delete, but CUID validation blocks mark/delete first. |

## Section 5: Frontend Audit

### Frontend Route Inventory

Routes found and reconciled against backend/API client:

| Route | Page File | Backend/API Status |
| --- | --- | --- |
| `/` | `frontend/app/page.tsx` | Present |
| `/login` | `frontend/app/(auth)/login/page.tsx` | `authApi.login` |
| `/forgot-password` | `frontend/app/(auth)/forgot-password/page.tsx` | `authApi.forgotPassword`, `authApi.resetPassword`, backend bug |
| `/change-password` | `frontend/app/(auth)/change-password/page.tsx` | `authApi.changePassword` |
| `/select-mode` | `frontend/app/(auth)/select-mode/page.tsx` | Present |
| `/welcome` | `frontend/app/(auth)/welcome/page.tsx` | Present |
| `/dashboard` | `frontend/app/(dashboard)/(core)/dashboard/page.tsx` | `dashboardApi.getHomeSummary`, `dashboardApi.getOverview`, tickets/change requests |
| `/kanban` | `frontend/app/(dashboard)/(operations)/kanban/page.tsx` | `ticketsApi.getKanban`, status updates |
| `/leave` | `frontend/app/(dashboard)/(operations)/leave/page.tsx` | `leaveApi` |
| `/projects` | `frontend/app/(dashboard)/(operations)/projects/page.tsx` | `projectsApi` |
| `/projects/[id]` | `frontend/app/(dashboard)/(operations)/projects/[id]/page.tsx` | `projectsApi` |
| `/team` | `frontend/app/(dashboard)/(operations)/team/page.tsx` | `usersApi.getMyTeam`, workday/team |
| `/tickets` | `frontend/app/(dashboard)/(operations)/tickets/page.tsx` | `ticketsApi.getAll` |
| `/tickets/new` | `frontend/app/(dashboard)/(operations)/tickets/new/page.tsx` | `ticketsApi.create`, CUID department bug risk |
| `/tickets/[id]` | `frontend/app/(dashboard)/(operations)/tickets/[id]/page.tsx` | ticket detail/comments/attachments |
| `/departments` | `frontend/app/(dashboard)/(platform)/departments/page.tsx` | `departmentsApi` |
| `/departments/[id]` | `frontend/app/(dashboard)/(platform)/departments/[id]/page.tsx` | `departmentsApi`, users/tickets/projects |
| `/reports` | `frontend/app/(dashboard)/(platform)/reports/page.tsx` | Static/redirect-like, no report export backend connected |
| `/users` | `frontend/app/(dashboard)/(platform)/users/page.tsx` | `usersApi`, roles, departments |
| `/users/[id]` | `frontend/app/(dashboard)/(platform)/users/[id]/page.tsx` | `usersApi.getOne` |
| `/users/[id]/profile` | `frontend/app/(dashboard)/(platform)/users/[id]/profile/page.tsx` | user profile/documents/change requests |
| `/admin/activity` | `frontend/app/(dashboard)/admin/activity/page.tsx` | `eventsApi`, activity |
| `/admin/approvals` | `frontend/app/(dashboard)/admin/approvals/page.tsx` | `changeRequestsApi` |
| `/analytics` | `frontend/app/(dashboard)/analytics/page.tsx` | `analyticsApi` |
| `/calendar` | `frontend/app/(dashboard)/calendar/page.tsx` | `eventsApi` |
| `/profile` | `frontend/app/(dashboard)/profile/page.tsx` | current user, tickets, leave, projects |
| `/settings` | `frontend/app/(dashboard)/settings/page.tsx` | `settingsApi`, task types |
| `/privacy` | `frontend/app/privacy/page.tsx` | Static |
| `/terms` | `frontend/app/terms/page.tsx` | Static |

App layouts:

- `frontend/app/layout.tsx`
- `frontend/app/(dashboard)/layout.tsx`

### Central API Client Inventory

All frontend API calls are centralized in `frontend/lib/api.ts`, except blob/export helper fetches inside that same central wrapper. Direct route pages use the central client groups.

API groups and methods:

- `authApi`: `login`, `me`, `changePassword`, `forgotPassword`, `resetPassword`.
- `usersApi`: `getAll`, `getMe`, `getMyTeam`, `updateMe`, `getPreferences`, `updatePreferences`, `getOne`, `create`, `update`, `resetPassword`, `deactivate`, `getStats`, `uploadPhoto`, `removePhoto`, `getProfile`, `updateProfile`, `uploadDocument`, `getDocuments`, `deleteDocument`, `verifyDocument`.
- `changeRequestsApi`: `getHierarchySummary`, `create`, `listMyRequests`, `listPendingApprovals`, `getOne`, `approve`, `reject`, `cancel`.
- `rolesApi`: `getAll`, `create`, `update`, `remove`.
- `departmentsApi`: `getAll`, `getOne`, `create`, `update`, `patch`, `remove`.
- `projectsApi`: `getAll`, `getOne`, `create`, `update`, `addMember`, `removeMember`, `remove`, `getStats`.
- `ticketsApi`: `getAll`, `getOne`, `create`, `update`, `updateStatus`, `assign`, `approve`, `reject`, `getHistory`, `uploadAttachment`, `downloadAttachment`, `exportCsv`, `deleteAttachment`, `remove`, `getStats`, `getSlaRisk`, `getKanban`, `blockTicket`, `unblockTicket`.
- `commentsApi`: `getAll`, `create`, `update`, `remove`.
- `dashboardApi`: `getOverview`, `getTicketsByCategory`, `getTicketsByDepartment`, `getActivityFeed`, `getWorkload`, `getTicketTrend`, `getHomeSummary`.
- `analyticsApi`: `getCommandCenter`, `getEmployeeMetrics`, `getReviewerMetrics`, `getManagerMetrics`, `getSlaAnalytics`, `getReworkAnalytics`.
- `eventsApi`: `getAll`.
- `leaveApi`: `getAll`, `getOne`, `create`, `approve`, `reject`, `cancel`, `getStats`, `getBalance`.
- `aiApi`: `suggestPriority`, `summarizeTickets`, `ticketSuggestions`, `triggerDigest`.
- `teamApi`: `getDirectory`, `sendRequest`.
- `settingsApi`: `getCompany`, `updateCompany`, `getLeavePolicy`, `updateLeavePolicy`, `getSla`, `updateSla`, `getSmtp`, `updateSmtp`, `testEmail`, `getWorkdayPolicy`, `updateWorkdayPolicy`.
- `taskTypesApi`: `getByDepartment`, `getAll`, `create`, `createSubtype`, `updateType`, `updateSubtype`, `deleteType`, `deleteSubtype`.
- `workdayApi`: `startWork`, `endWork`, `startBreak`, `endBreak`, `resumeWork`, `reportIdle`, `resumeAutoClosedWork`, `getToday`, `getTeam`, `getHistory`.
- `notificationsApi`: `getAll`, `getUnreadCount`, `markRead`, `markAllRead`, `remove`.

### Frontend Bugs and Gaps

#### P2: Dashboard Layout Can Redirect Before Auth Hydration

Evidence:

- `frontend/app/(dashboard)/layout.tsx:17` reads `isAuthenticated`.
- `frontend/app/(dashboard)/layout.tsx:25` redirects to `/login` when false.
- The layout does not use `hasHydrated`, although the auth store exposes it and the sidebar/root patterns account for hydration.

Impact: hard refresh/deep links can redirect before persisted auth is hydrated.

Safe fix recommendation: gate redirect/rendering on hydration state.

Fix type: code.

#### P2: Quick Action Dock Uses Stale Workday Status

Evidence:

- `frontend/components/ui/QuickActionDock.tsx:17` reads `(user as any)?.currentStatus`.
- The component imports `workdayApi` but does not query `workdayApi.getToday` for live status.

Impact: start, resume, end, and break actions can be disabled/enabled based on stale user state.

Safe fix recommendation: bind the dock to the same live workday state as `WorkdayBar` and invalidate after actions.

Fix type: code.

#### P2: Visible Encoding/Mojibake

Evidence:

- Build/source scans show garbled strings in multiple frontend/backend files, including `QuickActionDock`, dashboard pages, calendar, topbar, and `main.ts` logs/comments.

Impact: visible polish bug and trust issue.

Safe fix recommendation: do a controlled text encoding cleanup after functional P0/P1 fixes.

Fix type: code/content.

#### P3: Modal Escape Behavior Is Incomplete

Evidence:

- Workday modals use full-screen `fixed inset-0 z-[9999]`.
- Escape-key close is not implemented consistently in modal components.

Impact: usability/polish.

Fix type: code.

## Section 6: Real-Time and Performance

### Realtime

Backend gateway:

- Socket authentication uses JWT from handshake auth or Authorization header.
- Users join `user:${payload.sub}` rooms.
- Server emits:
  - `ticket:created`
  - `ticket:status_changed`
  - `notification:new`
  - `leave:status_changed`

Frontend:

- `useSocket` strips `/api` from `NEXT_PUBLIC_API_URL` before socket connect.
- Tickets page invalidates ticket queries on ticket events.
- Topbar invalidates notification count/list and shows toast on notification events.
- Polling fallback exists for notifications and workday/team screens.

Status: present and connected. Production status is unverified because backend routes currently return 404.

### Performance Risks

| Priority | Risk | Evidence | Recommendation |
| --- | --- | --- | --- |
| P2 | Workday cron scans open sessions without index | scheduler queries `logoutAt: null`; no `WorkSession.logoutAt` index | Add index in migration later |
| P2 | Attachment queries by ticket lack direct index | `Attachment.ticketId` has relation but no direct index | Add index in migration later |
| P2 | Overdue automation loops per ticket | `automation.service.ts` checks overdue tickets and notifications in loop | Batch notification lookup |
| P2 | Ticket export caps at 10,000 | `ticketsApi.exportCsv`, backend export uses high limit | Consider streaming or background export later |
| P3 | Hook dependency warnings | frontend build warnings | Clean after priority fixes |

## Section 7: Feature Matrix

Legend:

- COMPLETE: backend, frontend, DB, and role/data flow are connected.
- PARTIAL: feature exists but has confirmed code/config/data gaps.
- MISSING: not implemented or not wired.
- BROKEN: built but confirmed to fail.

Counts: COMPLETE 68, PARTIAL 21, MISSING 4, BROKEN 6.

| # | Feature | Backend | Frontend | DB | API Client | Local | Production | Status | Priority |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Login | Yes | Yes | User/Role | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 2 | JWT protected session | Yes | Yes | User/Role | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 3 | Auth me/session restore | Yes | Yes | User/Role | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 4 | Admin register/create user | Yes | Yes via users | User | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 5 | Change password | Yes | Yes | User | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 6 | Forgot password OTP | Yes | Yes | User OTP fields | Yes | Code bug | Email/domain blocked | BROKEN | P0 |
| 7 | Reset password with OTP | Yes | Yes | User OTP fields | Yes | Needs OTP | Email/domain blocked | PARTIAL | P1 |
| 8 | Auth throttle/enumeration hardening | Yes | Yes | User | Yes | Provider failure bug | Email/domain blocked | PARTIAL | P0 |
| 9 | Client logout | Client only | Yes | None | No endpoint | Build PASS | Unverified | MISSING | P3 |
| 10 | Refresh/token blacklist | No | No | None | No | Missing | Missing | MISSING | P3 |
| 11 | User list | Yes | Yes | User | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 12 | User detail | Yes | Yes | User | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 13 | User create | Yes | Yes | User | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 14 | User update | Yes | Yes | User | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 15 | Admin reset user password | Yes | Yes | User | Yes | Min policy unclear | Blocked by API 404 | PARTIAL | P2 |
| 16 | Deactivate user | Yes | Yes | User | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 17 | Role CRUD | Yes | Yes | Role | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 18 | Department CRUD | Yes | Yes | Department | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 19 | User preferences | Yes | Yes | User | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 20 | Avatar/photo | Yes | Yes | User | Yes | Upload validation gap | Cloudinary unverified | PARTIAL | P1 |
| 21 | Employee profile tabs | Yes | Yes | User/EmployeeDocument | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 22 | Employee documents | Yes | Yes | EmployeeDocument | Yes | Upload validation gap | Cloudinary unverified | PARTIAL | P1 |
| 23 | Ticket list | Yes | Yes | Ticket | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 24 | Ticket create | Yes | Yes | Ticket | Yes | CUID department bug | Null departments exist | PARTIAL | P1 |
| 25 | Ticket detail | Yes | Yes | Ticket | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 26 | Ticket edit | Yes | Yes | Ticket | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 27 | Ticket status workflow | Yes | Yes | Ticket/History | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 28 | Ticket assign/reassign | Yes | Yes | Ticket/TicketAssignee | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 29 | Review approve | Yes | Yes | Ticket/ReviewCycleLog | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 30 | Review reject/rework | Yes | Yes | Ticket/ReviewCycleLog | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 31 | Block ticket | Yes | Yes | Ticket | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 32 | Unblock ticket | Yes | Yes | Ticket | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 33 | Delete ticket | Yes | Yes | Ticket | Yes | Role expectation unclear | Blocked by API 404 | PARTIAL | P3 |
| 34 | Ticket comments | Yes | Yes | Comment | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 35 | Ticket attachments | Yes | Yes | Attachment | Yes | Ticket validation present | Cloudinary unverified | PARTIAL | P2 |
| 36 | Ticket history | Yes | Yes | TicketHistory | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 37 | Ticket export CSV | Yes | Yes | Ticket | Yes | 10k cap | Blocked by API 404 | PARTIAL | P2 |
| 38 | SLA timing | Yes | Yes | Ticket | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 39 | Overdue display | Yes | Yes | Ticket | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 40 | Task type/subtype | Yes | Yes | TaskType/TaskSubtype | Yes | Public list gap | Blocked by API 404 | COMPLETE | P2 |
| 41 | Kanban board | Yes | Yes | Ticket | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 42 | Kanban drag/drop | Yes | Yes | Ticket | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 43 | Kanban role enforcement | Yes | Yes | Ticket | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 44 | Kanban filters | Yes | Yes | Ticket/Department | Yes | CUID filter bug | Blocked by API 404 | PARTIAL | P1 |
| 45 | Project list | Yes | Yes | Project | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 46 | Project create | Yes | Yes | Project | Yes | CUID department bug | Blocked by API 404 | PARTIAL | P1 |
| 47 | Project detail | Yes | Yes | Project | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 48 | Project members | Yes | Yes | ProjectMember | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 49 | Project stages | Yes | Yes | ProjectStage | Partial client | Build PASS | Blocked by API 404 | COMPLETE | None |
| 50 | Project archive/restore | Yes | Yes | Project | Partial client | Build PASS | Blocked by API 404 | COMPLETE | None |
| 51 | Project activity | Yes | Yes | OperationalEvent | No explicit client method | Build PASS | Blocked by API 404 | COMPLETE | None |
| 52 | Direct add ticket to project UI | Backend via ticket fields | No dedicated UI confirmed | Ticket/Project | Ticket create/update | Not present | Unverified | MISSING | P3 |
| 53 | Leave list | Yes | Yes | LeaveRequest | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 54 | Leave create | Yes | Yes | LeaveRequest | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 55 | Leave approve | Yes | Yes | LeaveRequest | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 56 | Leave reject | Yes | Yes | LeaveRequest | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 57 | Leave cancel | Yes | Yes | LeaveRequest | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 58 | Leave balance | Yes | Yes | LeaveRequest | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 59 | Leave stats | Yes | Yes | LeaveRequest | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 60 | Leave calendar view | Yes | Yes | LeaveRequest/Event | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 61 | Own/higher leave approval enforcement | Yes | Yes | LeaveRequest/User | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 62 | Leave list/stat consistency | Yes | Yes | LeaveRequest | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 63 | Workday start | Yes | Yes | WorkSession | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 64 | Workday end | Yes | Yes | WorkSession | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 65 | Break start/end | Yes | Yes | BreakLog | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 66 | Idle/resume | Yes | Yes | WorkSession | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 67 | Auto-close/recovery | Yes | Yes | WorkSession | Yes | Cron unverified | Corrupt data present | PARTIAL | P1 |
| 68 | Workday today | Yes | Yes | WorkSession | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 69 | Team live status | Yes | Yes | User/WorkSession | Yes | Build PASS | Null dept users affect scope | COMPLETE | P1 data |
| 70 | Workday history | Yes | Yes | WorkSession | Yes | Build PASS | Corrupt data present | COMPLETE | P1 data |
| 71 | Workday policy settings | Yes | Yes | AppSetting/Override | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 72 | Existing production work sessions | DB only | Visible in UI | WorkSession | N/A | Data issue | Confirmed corrupt | BROKEN | P1 |
| 73 | Notifications list | Yes | Yes | Notification | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 74 | Notification unread count | Yes | Yes | Notification | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 75 | Mark one notification read | Yes | Yes | Notification | Yes | ParseUUID bug | Blocked by API 404 | BROKEN | P1 |
| 76 | Mark all notifications read | Yes | Yes | Notification | Yes | Build PASS | Blocked by API 404 | COMPLETE | None |
| 77 | Delete notification | Yes | Yes | Notification | Yes | ParseUUID bug | Blocked by API 404 | BROKEN | P1 |
| 78 | Realtime socket notifications | Yes | Yes | Notification | Hook connected | Build PASS | Backend unverified | COMPLETE | P2 verify |
| 79 | Ticket event notifications | Yes | Yes | Notification | Yes | Build PASS | Backend unverified | COMPLETE | None |
| 80 | Leave decision notifications | Yes | Yes | Notification | Yes | Build PASS | Backend unverified | COMPLETE | None |
| 81 | Activity feed | Yes | Yes | ActivityLog/OperationalEvent | Yes | Build PASS | Backend unverified | COMPLETE | None |
| 82 | Calendar/events | Yes | Yes | OperationalEvent/Leave | Yes | Build PASS | Backend unverified | COMPLETE | None |
| 83 | Email delivery | Resend-only | Settings/status UI | N/A | Yes | Config missing | Domain blocked | PARTIAL | P1 |
| 84 | Daily digest AI/email | Yes | No user UI | Notification/email | AI API | Config dependent | Unverified | PARTIAL | P2 |
| 85 | Home summary | Yes | Yes | Multiple | Yes | Build PASS | Backend unverified | COMPLETE | None |
| 86 | Dashboard overview | Yes | Yes | Multiple | Yes | Build PASS | Backend unverified | COMPLETE | None |
| 87 | KPI count consistency | Yes | Yes | Multiple | Yes | Multi-assignee drift | Null dept data | PARTIAL | P2 |
| 88 | Workload/team pressure | Yes | Yes | User/Ticket | Yes | Primary assignee only | Null dept data | PARTIAL | P2 |
| 89 | Recent activity | Yes | Yes | ActivityLog/Event | Yes | Build PASS | Backend unverified | COMPLETE | None |
| 90 | Upcoming events | Yes | Yes | OperationalEvent/Leave | Yes | Build PASS | Backend unverified | COMPLETE | None |
| 91 | Command center analytics | Yes | Yes | Multiple | Yes | Leave scope gap | Backend unverified | PARTIAL | P2 |
| 92 | Employee analytics | Yes | Yes | Ticket/Logs | Yes | Multi-assignee drift | Backend unverified | PARTIAL | P2 |
| 93 | Manager analytics | Yes | Yes | Multiple | Yes | Placeholder metrics | Backend unverified | PARTIAL | P2 |
| 94 | Reports export | No dedicated export confirmed | Page present | N/A | No | Missing | Missing | MISSING | P3 |
| 95 | Company/theme settings | Yes | Yes | AppSetting | Yes | Wipe bug | Backend unverified | BROKEN | P1 |
| 96 | SLA/leave/workday settings | Yes | Yes | AppSetting | Yes | Build PASS | Backend unverified | COMPLETE | None |
| 97 | AI endpoints | Yes | Partial UI | Ticket | Yes | Config/scope gap | OpenAI unverified | PARTIAL | P1 |
| 98 | Cloudinary uploads | Yes | Yes | Attachment/User | Yes | Config required | Unverified | PARTIAL | P2 |
| 99 | Production API deployment | Yes in repo | Frontend live | N/A | Yes | Local build PASS | All checked routes 404 | BROKEN | P0 |

## Section 8: Known Bug Status

| Known Issue | Current Status | Evidence |
| --- | --- | --- |
| Resend cannot send to all employees without verified domain | Still operationally blocked | Resend env missing locally; user context says domain verification pending |
| Forgot-password email delivery blocked operationally | Still blocked, plus code bug | Provider failure can leak registered email state |
| Scheduler Prisma bug committed as `9b9e0af` | Unverified in production | Production API 404 prevents deploy/runtime verification |
| Cloudinary/file storage not configured | Config required | Local config placeholder-like; prod unverified |
| `OPENAI_API_KEY` not configured | Local set, production unverified | AI code returns disabled fallback if not configured |
| Workday sessions showing impossible durations | Still present in production data | 66 corrupt/stale sessions |
| Dashboard KPI counts not matching ticket list | Mostly fixed, partial drift remains | Ticket scopes centralized; multi-assignee and null-dept drift remain |
| Leave stats counts but list empty | Fixed in code | `LeaveAccessService` used by list/stats |
| Team page showing 0 members | Fixed in code, data gaps remain | manager department access considered; null department users remain |
| Avatar color not syncing to sidebar | Fixed in code | `UserAvatar` receives avatar/photo fields |
| Workday modal not covering full screen | Fixed for coverage | modals use full-screen fixed overlay |
| Mac-only Cmd-K symbol | Fixed | UI displays `Ctrl K` |
| Ticket overdue immediately on creation | Fixed in code | no-due open tickets handled as no active SLA |
| DONE/CLOSED still overdue | Fixed in code | terminal statuses return not overdue |
| Manager approve/reject own leave | Fixed in code | frontend and backend block |
| Kanban moveable by any user | Fixed in code | frontend and backend role checks present |
| Profile counts showing `-` instead of `0` | Fixed/no longer reproduced in code | numeric fallbacks present |

## Section 9: Module-by-Module Status

| Module | Backend Present | Frontend Present | DB Model Present | Central API Client | Local Status | Production Status | Classification | Bug/Gaps | Priority | Fix Need |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Auth | Yes | Yes | User/Role | Yes | Build PASS | Backend 404 | Partial/Broken | Forgot-password enumeration/provider failure | P0 | Code + env |
| Users | Yes | Yes | User/EmployeeDocument | Yes | Build PASS | Backend 404 | Partial | upload validation, null departments | P1 | Code + data |
| Roles | Yes | Yes | Role | Yes | Build PASS | Backend 404 | Connected | No blocker found | None | Verify |
| Departments | Yes | Yes | Department | Yes | Build PASS | Backend 404 | Connected | empty departments exist, no bug by itself | P3 | Verify/data |
| Tickets | Yes | Yes | Ticket/TicketAssignee | Yes | Build PASS | Backend 404 | Partial | CUID ID handling, null departments | P1 | Code + data |
| Kanban | Yes | Yes | Ticket | Yes | Build PASS | Backend 404 | Partial | department filter CUID risk | P1 | Code |
| Block/Unblock | Yes | Yes | Ticket | Yes | Build PASS | Backend 404 | Connected | no current code bug found | None | Verify |
| Comments | Yes | Yes | Comment | Yes | Build PASS | Backend 404 | Connected | no current code bug found | None | Verify |
| Attachments | Yes | Yes | Attachment | Yes | Build PASS | Backend 404 | Partial | Cloudinary config, missing `Attachment.ticketId` index | P2 | Config + migration later |
| Projects | Yes | Yes | Project/Stage/Member | Yes | Build PASS | Backend 404 | Partial | CUID department create bug | P1 | Code |
| Leave | Yes | Yes | LeaveRequest | Yes | Build PASS | Backend 404 | Connected | no current code bug found | None | Verify |
| Workday | Yes | Yes | WorkSession/BreakLog | Yes | Build PASS | Backend 404 | Partial/Broken data | corrupt prod sessions, cron unverified | P1 | Manual data + verify |
| Team Live Status | Yes | Yes | User/WorkSession | Yes | Build PASS | Backend 404 | Partial | null department users affect scope | P1 | Data |
| Dashboard | Yes | Yes | Multiple | Yes | Build PASS | Backend 404 | Partial | multi-assignee/count drift | P2 | Code |
| Home Summary | Yes | Yes | Multiple | Yes | Build PASS | Backend 404 | Connected | no blocker found | None | Verify |
| Activity/Events | Yes | Yes | ActivityLog/OperationalEvent | Yes | Build PASS | Backend 404 | Connected | no blocker found | None | Verify |
| Notifications | Yes | Yes | Notification | Yes | Build PASS | Backend 404 | Broken actions | ParseUUID on CUID mark/delete | P1 | Code |
| Calendar | Yes | Yes | OperationalEvent/Leave | Yes | Build PASS | Backend 404 | Connected | no blocker found | None | Verify |
| Settings | Yes | Yes | AppSetting | Yes | Build PASS | Backend 404 | Partial/Broken | company/theme wipe, `req.user.sub` | P1 | Code |
| SMTP/Email | Yes | Settings present | AppSetting/config | Yes | Config missing | Domain blocked | Config required | Resend domain blocked, SMTP paused | P1 config | Env/manual |
| Uploads/Cloudinary | Yes | Yes | Attachment/User | Yes | Config required | Unverified | Config required | user upload validation gap | P1/P2 | Code + env |
| AI | Yes | Partial | Ticket | Yes | Config dependent | Unverified | Partial | scope gap before enabling | P1 | Code + env |
| Scheduler/Recurring | Yes | No direct page | Ticket/WorkSession/Notification | N/A | Build PASS | Unverified | Partial | API 404 and Render sleep risk | P1/P2 | Deploy verify |
| Deployment | Yes | Yes | N/A | N/A | Builds PASS | API 404 | Broken | production backend not serving routes | P0 | Deploy/config |
| Prisma Migrations | Yes | N/A | All | N/A | Validate PASS | 27 applied | Connected | future indexes only | P2 | Migration later |
| Frontend API Usage | Yes | Yes | N/A | Yes | Centralized | Backend 404 | Connected locally | no broad direct fetch issue | None | Verify |
| Role Visibility | Yes | Yes | User/Role/Department | Yes | Build PASS | Backend 404 | Partial | null departments, AI scope gap | P1 | Code + data |

## Section 10: Code Quality

### Positive Findings

- Backend and frontend builds pass.
- Prisma schema validates.
- API client is centralized in `frontend/lib/api.ts`.
- Ticket, leave, user, and project access policies are much more centralized than before.
- Ticket attachment upload has a 5 MB limit and MIME allowlist.
- Swagger is disabled in production.
- Validation pipe is strict.

### Quality Gaps

| Priority | Gap | Evidence |
| --- | --- | --- |
| P2 | Build warnings from hook dependencies and image usage | Next build warnings |
| P2 | Mojibake strings in UI/source | source/build scan |
| P3 | Unused home components | `HomeHeader.tsx`, `MetricCards.tsx`, `QuickActionStrip.tsx` appear unused |
| P3 | Runtime console logging remains | backend runtime source has multiple console calls |
| P3 | Several `any` usages remain in frontend/backend | source scan counts high |

## Section 11: Priority Board

### P0

| # | Issue | Exact Location/Evidence | Safe Fix Recommendation | Fix Type |
| ---: | --- | --- | --- | --- |
| 1 | Production backend routes return 404 | Production HTTP checks for `/api/health`, `/health`, `/api/auth/me`, `/api/tickets` all 404 | Verify Render service, root dir, deployed commit, build output, start command, and route prefix | Deploy/config/manual |
| 2 | Forgot-password enumeration under provider failure | `auth.service.ts:158`, `auth.service.ts:179`, `email.service.ts:56` | Always return same generic response, log provider errors internally, keep provider unchanged | Code |

### P1

| # | Issue | Exact Location/Evidence | Safe Fix Recommendation | Fix Type |
| ---: | --- | --- | --- | --- |
| 3 | Production workday corrupted/stale sessions | DB check: 66 corrupt/stale, 55 long, 11 stale open | Verify scheduler deploy, then manually repair data | Manual + deploy verify |
| 4 | CUID/UUID ID misclassification | `tickets.service.ts:14`, `:261-273`; `ticket-access.service.ts:7`, `:332-334`; `projects.service.ts:11`, `:113-118` | Accept CUID IDs or separate name fields from ID fields | Code + data |
| 5 | Notification mark-read/delete broken | `notifications.controller.ts:1`, `:31`, `:36` | Remove UUID pipe or replace with CUID-compatible validation | Code |
| 6 | Settings company/theme save wipe | `settings.controller.ts:30-35` | Merge company settings or save theme separately only | Code |
| 7 | Settings audit actor missing | `settings.controller.ts:35`, `:47`, `:64`, `:79`; JWT user has `id`, not `sub` | Use `req.user.id` | Code |
| 8 | AI ticket suggestions scope bypass | `ai.controller.ts:38-39`, `ai.service.ts:165` | Pass current user and use ticket access service | Code |
| 9 | User photo/document upload validation | `users.controller.ts:40`, `users.controller.ts:120` | Add size and MIME limits | Code |
| 10 | Null department production data | DB: 6 active users, 33 active tickets without department | Fix creation paths first, then manually assign/clean data | Code + manual data |

### P2

| # | Issue | Exact Location/Evidence | Safe Fix Recommendation | Fix Type |
| ---: | --- | --- | --- | --- |
| 11 | Multi-assignee count drift | dashboard/users/analytics count by `assignedToId` | Include `TicketAssignee` where user-facing count claims include assigned work | Code |
| 12 | Dashboard layout hydration redirect | `frontend/app/(dashboard)/layout.tsx:17`, `:25` | Gate auth redirect on hydration | Code |
| 13 | QuickActionDock stale workday status | `QuickActionDock.tsx:17` | Use live `workdayApi.getToday` state | Code |
| 14 | Visible mojibake | source scan in frontend/backend strings | Controlled encoding cleanup | Code/content |
| 15 | Missing `Attachment.ticketId` index | Prisma schema | Add migration after priority fixes | DB migration later |
| 16 | Missing `WorkSession.logoutAt` index | Prisma schema and scheduler scan | Add migration after scheduler verification | DB migration later |
| 17 | Render cron reliability unverified | cron exists, no keepalive config found | Add/verify external uptime monitor if service sleeps | Config/manual |
| 18 | Frontend env/API URL unverified | local frontend env missing, prod env unverified | Verify Vercel env points to corrected backend | Config |
| 19 | Analytics command-center leave scope gap | `analytics.service.ts:259` counts pending leave without leave scope | Apply leave access scope | Code |

### P3

| # | Issue | Exact Location/Evidence | Safe Fix Recommendation | Fix Type |
| ---: | --- | --- | --- | --- |
| 20 | No direct topbar Sun/Moon toggle | topbar has Appearance link, not direct theme toggle | Add only if product wants it | Code |
| 21 | Escape key not consistent across modals | workday modal scan | Add shared modal escape behavior | Code |
| 22 | Unused home components | `HomeHeader`, `MetricCards`, `QuickActionStrip` appear unused | Remove or rewire later | Code |
| 23 | Runtime console logging | source scan | Replace with logger where needed | Code |
| 24 | Build warnings | Next build warnings | Clean hook deps and image components | Code |

## Section 12: Deployment Gaps

| Gap | Status | Priority |
| --- | --- | --- |
| Backend production API returns 404 | Confirmed | P0 |
| Production deployed commit not verified against local build | Unverified | P0/P1 |
| Scheduler runtime not verifiable due API 404 | Unverified | P1 |
| Recurring scheduler Prisma fix `9b9e0af` not deploy-verified | Unverified | P1 |
| Resend domain verification blocks email to employees | Confirmed by user context | P1 config |
| SMTP fallback intentionally paused | Do not change now | None |
| Cloudinary production env | Unverified | P2 config |
| OpenAI production env | Unverified | P2 config |
| Vercel frontend env API URL | Unverified | P2 config |
| Render free-tier sleep/keepalive | No repo config found | P2 |

## What To Do Next (Ordered)

1. Fix production backend 404 and verify `/api/health` returns 200.
2. Verify production deployed commit includes the latest scheduler/auth/dashboard fixes.
3. Fix forgot-password provider failure behavior so registered and unregistered emails always return the same response.
4. Fix CUID handling in ticket/project department and assignee paths, then manually repair null production departments.
5. Fix notification mark-read/delete CUID validation.
6. Fix settings company/theme overwrite and `req.user.sub` actor bug.
7. Verify scheduler runtime and repair corrupt production work sessions with a reviewed manual script.
8. Add user upload size/type validation.
9. Scope AI ticket suggestions before enabling production AI.
10. Reconcile dashboard/analytics multi-assignee counts.
11. Verify Resend domain or keep email provider work paused as currently decided.
12. Add Prisma indexes in a separate migration pass only after the code/data fixes are stable.

