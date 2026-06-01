# Apex OS End-to-End System Audit

Date: 2026-05-28  
Mode: Audit only  
Scope: Current local codebase after operational recovery, UX convergence, blocked ticket workflow, deployment runtime fixes, calendar leave fix, and role-based UX QA fixes.

## Executive Summary

Apex OS is substantially operational in the current local codebase. The backend builds, tests pass, Prisma validates, local migrations are current, protected APIs return correct authenticated/unauthenticated status codes, and the critical backend architecture services are present and used across tickets, dashboard, leave, users, workday, events, notifications, projects, and settings.

The biggest readiness risk is deployment/version alignment. The committed local code is at `ba9413d`, and the working tree only contains audit documentation from this audit pass. GitHub remote access was not reachable from this environment, and Vercel/Render deployment dashboards/logs were not accessible. Therefore GitHub, Vercel, and Render cannot be honestly marked aligned from direct evidence. Until the deployed domains are verified with authenticated probes and deployment logs, Apex OS should be treated as ready for a controlled pilot only, not full internal rollout.

Local verification passed:

- Backend build: PASS
- Backend tests: PASS, 15 suites / 135 tests
- Prisma validate: PASS
- Prisma migrate status: PASS, local DB up to date
- Frontend build: PASS from the role UX QA pass immediately before this audit, with existing lint warnings
- Local API protected route probe: PASS for core dashboard, events, notifications, tickets, kanban, projects, leave, workday, users, and settings endpoints

Not fully verified:

- Latest pushed GitHub commit, because `git ls-remote` could not connect to GitHub from the environment.
- Latest Vercel deployed commit and build logs, because deployment console/API access is unavailable.
- Latest Render deployed commit, backend logs, and migration logs, because deployment console/API access is unavailable.
- Authenticated deployed API probe, because shell network access to Render/Vercel failed and web tools cannot perform credentialed POST login checks.
- Browser click-through workflows, because the local app server cannot be kept alive across separate tool calls in this environment.

## Readiness Scores

| Area | Score | Rationale |
|---|---:|---|
| Overall | 84% | Core local system is healthy, but deployment alignment is unverified from this environment. |
| Backend | 91% | Build/tests/API/Prisma pass locally; deployment logs unavailable. |
| Frontend | 82% | Build passes; role guards and calendar fix are present locally; some raw fetches and local-only preferences remain. |
| UX | 78% | Major role-action issues fixed locally; browser/manual workflow evidence is incomplete. |
| Security | 88% | Backend guards and scoped services are present; deployed auth checks and attachment storage configuration are not fully verified. |
| Deployment | 68% | Render config is improved and local branch is clean aside from audit docs, but deployed commit/log evidence is unavailable. |

Recommendation: Ready only for controlled pilot after performing a live deployed smoke test against Vercel, Render, and the production database.

## Section 1 - Version / Deployment Audit

Evidence:

- Current branch: `stabilize/apex-os-core`
- HEAD: `ba9413d fix(deploy): synchronize deployed runtime api routes migrations and socket fallback`
- `origin/stabilize/apex-os-core` also points to `ba9413d` locally.
- Working tree check during this audit showed only audit documentation as untracked.
- GitHub remote: `https://github.com/GuruRagvesh/apex-os.git`
- `git ls-remote origin refs/heads/stabilize/apex-os-core` failed due inability to connect to GitHub.
- Render config at `render.yaml` uses `buildCommand: npm install --include=dev && npm run build` and `startCommand: npx prisma migrate deploy && node dist/main.js`.
- Deployed backend URL referenced by local verification script: `https://apex-os-3nyi.onrender.com`.
- Known frontend origins are whitelisted in `backend/src/main.ts:33-36`.

| Layer | Expected Commit | Actual Commit | Status | Notes |
|---|---|---|---|---|
| Local | Latest recovery code | `ba9413d` plus audit docs | PASS | Production code is clean in the current workspace. |
| GitHub | `ba9413d` | UNKNOWN | Risk | Remote network check failed. Local tracking ref says `origin/stabilize/apex-os-core` is `ba9413d`. |
| Vercel Frontend | `ba9413d` | UNKNOWN | Risk | No Vercel CLI/API/session available. |
| Render Backend | `ba9413d` | UNKNOWN | Partial | `render.yaml` start command now runs migrations. Latest Render deployed commit/logs unavailable. |
| Render Database | All Prisma migrations applied | UNKNOWN | Risk | Local DB migrations are current; deployed migration logs unavailable. |

Environment status:

| Item | Local Evidence | Status |
|---|---|---|
| Backend env | `backend/.env` present, local DB and JWT configured | Present locally |
| Frontend env | `frontend/.env.local` uses `NEXT_PUBLIC_API_URL=http://localhost:3001/api` | Present locally |
| Production backend env | Not accessible | UNKNOWN |
| Production frontend env | Not accessible | UNKNOWN |
| Prisma client generation | Backend build generated Prisma client | PASS locally |

## Section 2 - Deployed API Health Audit

Deployed API health is not fully verifiable from this environment.

Evidence and limits:

- Shell network calls to `https://apex-os-3nyi.onrender.com/api/health` and `https://apex-os.vercel.app` failed with "Unable to connect to the remote server".
- Existing repo script `verify-endpoints.js` references deployed backend `https://apex-os-3nyi.onrender.com` and credentialed checks for `/api/home/summary`, `/api/events?limit=15`, `/api/notifications/unread-count`, `/api/dashboard/overview`, `/api/tickets/sla-risk`, and `/api/workday/today`.
- Existing deployment reports state the route prefix fix moved calls under `/api`.

Local API probe results:

| Feature | Endpoint | Auth Required | Status | Response Shape Valid | Notes |
|---|---|---:|---:|---:|---|
| Health | `GET /api/health` | No | 200 | Yes | Local health returned status, timestamp, version, database, environment. |
| Events unauth | `GET /api/events` | Yes | 401 | Yes | Correct protected behavior. |
| Home Summary unauth | `GET /api/home/summary` | Yes | 401 | Yes | Correct protected behavior. |
| Dashboard unauth | `GET /api/dashboard/overview` | Yes | 401 | Yes | Correct protected behavior. |
| Workday unauth | `GET /api/workday/today` | Yes | 401 | Yes | Correct protected behavior. |
| Notifications unauth | `GET /api/notifications/unread-count` | Yes | 401 | Yes | Correct protected behavior. |
| Home Summary | `GET /api/home/summary` | Yes | 200 | Yes | Shape: `criticalAlerts, metrics, workdayStatus, upcomingEvents, previews`. |
| Dashboard Overview | `GET /api/dashboard/overview` | Yes | 200 | Yes | Shape: `stats, recentTickets, myTickets, bottleneckTickets, blockedTickets`. |
| Events | `GET /api/events?limit=15` | Yes | 200 | Yes | Array length 15. |
| Notifications | `GET /api/notifications` | Yes | 200 | Yes | Array. |
| Unread Count | `GET /api/notifications/unread-count` | Yes | 200 | Yes | Shape: `count`. |
| Tickets | `GET /api/tickets` | Yes | 200 | Yes | Shape: `tickets,total,page,limit,totalPages`. |
| Kanban | `GET /api/tickets/kanban` | Yes | 200 | Yes | Shape: kanban columns. |
| Ticket Stats | `GET /api/tickets/stats` | Yes | 200 | Yes | Includes total, status/category/priority, overdue, unassigned, blocked. |
| SLA Risk | `GET /api/tickets/sla-risk` | Yes | 200 | Yes | Includes overdue, dueSoon, reviewAgeing, unassigned, blocked, total. |
| Projects | `GET /api/projects` | Yes | 200 | Yes | Shape: `projects,total,page,limit,totalPages`. |
| Leave | `GET /api/leave` | Yes | 200 | Yes | Shape: `items,total,page,limit,totalPages`. |
| Leave Stats | `GET /api/leave/stats` | Yes | 200 | Yes | Shape: `total,pending,approved,rejected`. |
| Leave Balance | `GET /api/leave/balance` | Yes | 200 | Yes | Shape: `allocation,approved,pending,balance`. |
| Workday Today | `GET /api/workday/today` | Yes | 200 | Yes | Shape: `session,elapsedWorkMinutes,onLeaveToday,leaveInfo`. |
| Workday Team | `GET /api/workday/team` | Yes | 200 | Yes | Array length 55 for super-admin persona. |
| Users Me | `GET /api/users/me` | Yes | 200 | Yes | Current user safe profile fields. |
| Company Settings | `GET /api/settings/company` | Yes | 200 | Yes | Company name/theme settings. |

## Section 3 - Database / Prisma Audit

Local status:

- `npx prisma validate`: PASS
- `npx prisma migrate status`: 20 migrations found; local database schema is up to date
- Prisma schema is valid.

Required local tables exist under mapped snake_case table names:

| Model/Table | Exists | Required Fields Present | Migration Applied | Risk |
|---|---:|---:|---:|---|
| `notifications` | Yes | Yes | Yes locally | Low |
| `operational_events` | Yes | Yes via Prisma mapped fields | Yes locally | Low |
| `attendance_events` | Yes | Yes via Prisma mapped fields | Yes locally | Low |
| `tickets` blocked fields | Yes | `isBlocked`, `blockedAt`, `blockedReason`, `blockedById` present | Yes locally | Low |
| `leave_requests` half-day fields | Yes | `isHalfDay`, `halfDayType` present | Yes locally | Low |
| `app_settings` | Yes | `key`, `value` present | Yes locally | Low |
| `work_sessions` | Yes | Session fields present under mapped names | Yes locally | Low |
| `ticket_assignees` | Yes | `ticketId`, `userId` present | Yes locally | Low |
| `project_members` | Yes | `projectId`, `userId`, `role` present | Yes locally | Low |
| `employee_documents` | Yes | `fileUrl`, `documentType`, verification fields present | Yes locally | Medium: document storage provider/env not verified. |

Deployment DB status: UNKNOWN, because Render database and migration logs are not accessible here.

## Section 4 - Auth / Session Audit

Evidence:

- Auth controller login/register/session/change-password routes: `backend/src/modules/core/auth/auth.controller.ts`.
- Register route is admin/super-admin guarded.
- Frontend auth store attaches `apex_token` through the central API client in `frontend/lib/api.ts`.
- Dashboard layout redirects unauthenticated users to `/login`.
- Local unauth protected API probes returned 401.
- Invalid login probe failed safely. One malformed invalid login returned 400 due validation, not 500.

| Role | Login | Token API Calls | Reload Session | Logout | Direct Route Guard | Role Route Guard | Notes |
|---|---|---|---|---|---|---|---|
| SUPER_ADMIN | Code/API verified | Pass | Code verified | Code verified | Pass local code | Pass local code | Full browser session not run. |
| ADMIN | Code/API verified | Pass | Code verified | Code verified | Pass local code | Pass local code | SMTP hidden/403 except super-admin. |
| MANAGER | Code/API verified | Pass | Code verified | Code verified | Pass local code | Pass local code | Scoped department APIs pass locally. |
| TEAM_LEAD | Code/API verified | Pass | Code verified | Code verified | Pass local code | Pass local code | Analytics allowed and scoped. |
| EMPLOYEE | Code/API verified | Pass | Code verified | Code verified | Pass local code | Pass local code | Admin/analytics direct pages now guarded locally. |
| INTERN | Code/API verified | Pass | Code verified | Code verified | Pass local code | Pass local code | Admin/analytics direct pages now guarded locally. |

## Section 5 - Role / RBAC Audit

Backend role services and guards:

- `AccessPolicyService`, `TicketAccessService`, `TicketTimingService`, `LeaveAccessService`, and `EventLoggerService` are exported from `backend/src/common/common.module.ts`.
- Ticket APIs use `TicketAccessService` and `TicketTimingService`.
- Dashboard uses `TicketAccessService`, `TicketTimingService`, `LeaveAccessService`, and `AccessPolicyService`.
- Leave uses `LeaveAccessService`.
- Notification APIs scope to current user.
- Settings mutation endpoints are admin/super-admin gated; SMTP is super-admin-only.

| Role | Page | Should Access | Actual Access | Data Scope Correct | Actions Correct | Notes |
|---|---|---:|---:|---:|---:|---|
| SUPER_ADMIN | Dashboard/Tickets/Kanban/Projects/Leave/Calendar/Team/Analytics/Users/Departments/Activity/Settings/Profile/Notifications | Yes | Yes | Yes | Yes | Global APIs local-pass. |
| ADMIN | Dashboard/Tickets/Kanban/Projects/Leave/Calendar/Team/Analytics/Users/Departments/Activity/Settings/Profile/Notifications | Yes | Yes | Yes | Yes | SMTP endpoint 403, as expected. |
| MANAGER | Dashboard/Tickets/Kanban/Projects/Leave/Calendar/Team/Analytics/Activity/Settings/Profile/Notifications | Yes | Yes | Yes | Yes | Users/Departments direct pages now admin-only locally. |
| TEAM_LEAD | Dashboard/Tickets/Kanban/Projects/Leave/Calendar/Team/Analytics/Activity/Settings/Profile/Notifications | Yes | Yes | Yes | Mostly | Project create hidden; scoped project edit allowed where backend allows. |
| EMPLOYEE | Dashboard/Tickets/Kanban/Projects/Leave/Calendar/Settings/Profile/Notifications | Yes | Yes | Yes | Yes | Analytics/Users/Departments guarded locally. Team is direct-access only and should be product-decided. |
| INTERN | Dashboard/Tickets/Kanban/Projects/Leave/Calendar/Settings/Profile/Notifications | Yes | Yes | Yes | Yes | Analytics/Users/Departments guarded locally. Team is direct-access only and should be product-decided. |

## Section 6 - Frontend-Backend Integration Audit

| Page | Frontend File | API Source | Real Data? | Mock/Fallback? | Response Mapping | Error State | Status |
|---|---|---|---:|---:|---|---|---|
| Dashboard | `frontend/app/(dashboard)/(core)/dashboard/page.tsx` | `/home/summary`, `/dashboard/overview`, `/tickets/sla-risk` | Yes | No fake data found | Valid local shapes | Partial | Working, but browser drilldowns not fully verified. |
| Tickets | `frontend/app/(dashboard)/(operations)/tickets/page.tsx` | `ticketsApi.getAll`, stats/export | Yes | No | `tickets,total...` | Yes | Working. |
| Ticket Detail | `frontend/app/(dashboard)/(operations)/tickets/[id]/page.tsx` | ticket/detail/comments/history/attachments | Yes | No | Real ticket contract | Yes | Working by code/tests; browser workflow not run. |
| Kanban | `frontend/app/(dashboard)/(operations)/kanban/page.tsx` | `ticketsApi.getKanban` and status updates | Yes | No | Kanban columns | Partial | Working; drag needs browser confirmation. |
| Projects | `frontend/app/(dashboard)/(operations)/projects/page.tsx` | `projectsApi` | Yes | No | `projects,total...` | Yes | Working. |
| Project Detail | `frontend/app/(dashboard)/(operations)/projects/[id]/page.tsx` | project API plus raw events fetch | Yes | No | Real project contract | Partial | Working, but raw events fetch remains. |
| Leave | `frontend/app/(dashboard)/(operations)/leave/page.tsx` | `leaveApi` | Yes | No | `items,total...` | Yes | Working. |
| Calendar | `frontend/app/(dashboard)/calendar/page.tsx` | raw `apiFetch` to tickets/leave | Yes | No | Leave uses `items` locally | Partial | Mapping fixed; approved leave not present locally to visually verify. |
| Team | `frontend/app/(dashboard)/(operations)/team/page.tsx` | `usersApi.getMyTeam`, directory/workday | Yes | Local request cache | Real team data | Partial | Working; local request IDs use localStorage. |
| Analytics | `frontend/app/(dashboard)/analytics/page.tsx` | dashboard/tickets APIs | Yes | No | Real scoped analytics | Permission fallback | Working locally for TL+. |
| Users & Roles | `frontend/app/(dashboard)/(platform)/users/page.tsx` | users/roles/departments APIs | Yes | No | Real admin data | Permission fallback | Admin-only locally. |
| Departments | `frontend/app/(dashboard)/(platform)/departments/page.tsx` | departments/users APIs | Yes | No | Real departments | Permission fallback | Admin-only locally. |
| Activity Log | `frontend/app/(dashboard)/admin/activity/page.tsx` | raw fetch `/events` | Yes | No | Events array | Weak | Working, but failed fetch returns empty array silently. |
| Settings | `frontend/app/(dashboard)/settings/page.tsx` | settings/users APIs and localStorage | Partial | Some local-only preferences | Mixed | Partial | Core settings persist; some appearance/display preferences are local-only. |
| Profile | `frontend/app/(dashboard)/profile/page.tsx` | tickets/activity/leave/projects APIs | Yes | No hardcoded counts after local fix | Real scoped data | Partial | Working locally. |
| Notifications | `frontend/components/layout/topbar.tsx` | notifications API | Yes | No | Array/count | Loading/empty state | Working. |

Raw fetches still present:

- `frontend/components/home/RecentActivityFeed.tsx`
- `frontend/app/(dashboard)/(operations)/projects/[id]/page.tsx`
- `frontend/app/(dashboard)/calendar/page.tsx`
- `frontend/app/(dashboard)/admin/activity/page.tsx`

## Section 7 - Dashboard End-to-End Audit

Local API evidence:

- `/api/home/summary`: 200, real command-center shape
- `/api/dashboard/overview`: 200, stats and recent ticket shapes
- `/api/tickets/sla-risk`: 200, risk counts
- `/api/events?limit=15`: 200
- `/api/workday/today`: 200

| Dashboard Item | Source Endpoint | Expected Value | Actual Value | Match? | Notes |
|---|---|---|---|---:|---|
| Workday bar | `/workday/today` | Real session | 200 local | Yes | Stale/recovery behavior code exists. |
| Recent activity | `/events` or dashboard feed | Real events | 200 local | Yes | One component still uses raw fetch. |
| Open tickets | `/dashboard/overview` and `/tickets` | Scoped counts | 13 for super-admin local | Yes | Tickets and kanban both total 13 in local probe. |
| Overdue | `TicketTimingService` via dashboard/tickets | Timing truth | SLA risk overdue 3 | Yes | Local API returns backend risk contract. |
| Pending leave | Leave query/service | Scoped count | 0 local | Yes | No local leave records. |
| SLA risk | `/tickets/sla-risk` | Real risk cards | 200 local | Yes | Shape valid. |
| Bottlenecks | `/dashboard/overview` | Risk tickets | Present in shape | Yes | Visual drilldown not clicked. |
| Active projects | `/projects` plus dashboard | Scoped projects | 2 local for super-admin | Yes | Filter drilldown not browser-verified. |
| Upcoming events | `/home/summary` | Tickets/leave/calendar source | Present in shape | Yes | Calendar visual not browser-verified. |

Risk: Dashboard does not have a fully automated browser-level parity test against tickets/kanban/analytics after the latest local changes.

## Section 8 - Tickets / Kanban / SLA Audit

Local backend evidence:

- Ticket APIs use `TicketAccessService`, `TicketTimingService`, `NotificationEventService`, and `EventLoggerService`.
- `/tickets`: 200 local
- `/tickets/kanban`: 200 local
- `/tickets/stats`: 200 local
- `/tickets/sla-risk`: 200 local
- Ticket blocked fields exist in local DB/schema.
- Backend tests pass.

| Workflow | Backend Result | Frontend Result | Event Created | Notification | Scope Correct | Status |
|---|---|---|---|---|---|---|
| Create ticket | Code/test covered | UI exists | Expected via service | Expected | Yes | Partially verified, not browser-run. |
| Assign/reassign | Backend endpoint exists | UI exists | Expected | Expected | Yes | Partially verified. |
| Status move | Backend endpoint exists | List/detail/kanban UI exists | Expected | Expected | Yes | Partially verified. |
| Kanban drag | Backend endpoint exists | UI exists | Expected | Expected | Yes | Needs browser test. |
| Comment | Comments controller/service exists | UI exists | Expected | Expected | Yes | Partially verified. |
| Attachment upload/download | Secure route exists | UI/API wrapper uses secure download | Expected | Not always | Yes | Storage provider deployment config unverified. |
| Block/unblock | Endpoints exist | UI exists | Expected | Possible | Yes | Partially verified. |
| Complete/close | Backend transitions exist | UI exists | Expected | Expected | Yes | Partially verified. |
| Filters/export | API wrappers exist | UI exists | N/A | N/A | Yes | Export browser download not verified. |

## Section 9 - Activity / Events Audit

Evidence:

- `EventLoggerService` exists and is exported.
- Events controller is protected and uses `AccessPolicyService`.
- Local `/events?limit=15` returned 200 and 15 events.
- Activity page supports date and event type filters.
- Dashboard recent activity uses events/home data.

| Action | DB Event | API Event | Dashboard Recent | Activity Log | Link Works | Scope Correct |
|---|---|---|---|---|---|---|
| Ticket created | Expected | Expected | Expected | Expected | Code mapped | Yes by service scope |
| Ticket assigned | Expected | Expected | Expected | Expected | Code mapped | Yes |
| Ticket status changed | Expected | Expected | Expected | Expected | Code mapped | Yes |
| Ticket blocked/unblocked | Expected | Expected | Expected | Expected | Code mapped | Yes |
| Comment added | Expected | Expected | Expected | Expected | Code mapped | Yes |
| Attachment uploaded | Expected | Expected | Expected | Expected | Code mapped | Yes |
| Leave requested/approved/rejected | Expected | Expected | Expected | Expected | Code mapped | Yes |
| Workday started/break/end | Expected | Expected | Expected | Expected | Code mapped | Yes |
| Project created/updated | Expected | Expected | Expected | Expected | Code mapped | Yes |
| Settings changed | Expected in service | Expected | Maybe | Maybe | Code mapped | Yes |

Risk: Activity Log raw fetch returns `[]` on non-OK response, which can make an API error look like a true empty state.

## Section 10 - Workday / Attendance Audit

Evidence:

- Workday controller is protected.
- Workday service uses `AccessPolicyService` and `EventLoggerService`.
- Local `/workday/today`: 200.
- Local `/workday/team`: 200.
- Workday UI components include `WorkdayBar`, `IdlePopup`, `SessionRecoveryModal`, break/end modals.

| Workday Flow | Expected | Actual | API | UI | Event | Status |
|---|---|---|---|---|---|---|
| Login does not equal Start Work | Login creates login/session status, start work separate | Code supports | `/auth/login`, `/workday/start` | UI separate | Login event | Pass by code |
| Start Work | Create/update work session | Endpoint exists | 200 expected | WorkdayBar | Event expected | Partially verified |
| Break start/end | Update session | Endpoints exist | 200 expected | Break modal | Events expected | Partially verified |
| End day | Close session | Endpoint exists | 200 expected | End modal | Event expected | Partially verified |
| Logout while active warns | Warn user | Code in sidebar | N/A | Confirm dialog | N/A | Code verified |
| Team live status | Scoped roster | 200 local | `/workday/team` | Team page | N/A | Pass local API |

## Section 11 - Leave Audit

Evidence:

- Leave controller endpoints are protected.
- Approve/reject are role-gated for TL/Manager/Admin/SuperAdmin.
- Leave service uses `LeaveAccessService`, `AccessPolicyService`, `NotificationEventService`, and `EventLoggerService`.
- Leave balance uses settings-backed quotas.
- Local `/leave`, `/leave/stats`, `/leave/balance`: all 200.
- Calendar leave mapping uses `items` locally.

| Leave Flow | Backend | Frontend | Balance | Event | Notification | Status |
|---|---|---|---|---|---|---|
| Apply leave | Endpoint exists | UI exists | Balance API exists | Expected | Expected | Partially verified |
| Half-day | Schema fields exist | UI support present | Calculation service | Expected | Expected | Partially verified |
| Approve/reject | Role scoped | UI explains blocked cases | Stats update expected | Expected | Expected | Partially verified |
| Unauthorized approval | Guarded | UI hides/blocks | N/A | N/A | N/A | Code verified |
| Calendar approved leave | API returns `items` | Local mapping fixed | N/A | N/A | N/A | Code verified; no local approved leave to render |

## Section 12 - Projects Audit

Evidence:

- Projects controller is protected.
- Create requires Manager/Admin/SuperAdmin.
- Update/member changes allow TL/Manager/Admin/SuperAdmin and service enforces scoped permission.
- Delete requires Admin/SuperAdmin.
- Local `/projects`: 200.

| Project Flow | Backend | Frontend | Dashboard Sync | Scope | Status |
|---|---|---|---|---|---|
| List | 200 local | UI exists | Dashboard uses project data | Yes | Pass local API |
| Create | Guarded | Manager+ UI action | Expected | Yes | Code verified |
| Edit | Guarded and scoped | Detail UI exists | Expected | Yes | Code verified |
| Delete/archive | Admin guarded | UI exists | Expected | Yes | Code verified |
| Detail/tickets/members | APIs and UI exist | UI exists | Expected | Yes | Partially verified |
| `status=ACTIVE` filter | API param path exists | Quick actions use route | Expected | Yes | Needs browser/API filter test |

## Section 13 - Team / Manager Intelligence Audit

| Intelligence Item | Manager | Team Lead | Employee | Intern | Correct? | Notes |
|---|---:|---:|---:|---:|---:|---|
| Team members | Yes | Yes | Direct only | Direct only | Partial | Employee/intern team access needs product decision. |
| Department members | Yes | Yes | Scoped/direct | Scoped/direct | Partial | Backend scopes; UI menu hides for employee/intern. |
| Workload by member | Yes | Yes | No manager UI | No manager UI | Yes | Analytics guarded locally for employee/intern. |
| Tickets by member | Yes | Yes | Own/assigned | Own/assigned | Yes | Scoped ticket service. |
| Overdue by member | Yes | Yes | Own/assigned | Own/assigned | Yes | Timing service based. |
| Pending reviews | Yes | Yes | No | No | Yes | Dashboard/TL panels. |
| Active workers | Yes | Yes | No manager UI | No manager UI | Yes | Workday team endpoint scoped. |
| Pending leave | Yes | Yes | Own | Own | Yes | LeaveAccessService. |
| Recent team activity | Yes | Yes | Personal direct only | Personal direct only | Partial | `/admin/activity` path naming remains confusing. |
| Delivery/SLA risks | Yes | Yes | No analytics UI | No analytics UI | Yes locally | Direct analytics now guarded. |

## Section 14 - Calendar Audit

| Calendar Source | API | Events Rendered | Click Works | Scope Correct | Status |
|---|---|---|---|---:|---|
| Ticket due dates | `/tickets?limit=200` | Code maps `dueDate` | `/tickets/:id` | Yes | Code verified |
| Ticket scheduled events | `/tickets?limit=200` | Code maps `scheduledStartAt` | `/tickets/:id` | Yes | Code verified |
| Approved leave | `/leave?status=APPROVED&limit=100` | Code maps `items` | `/leave` | Yes | Code verified; no local approved leave data |
| Empty/error state | Ticket events still render if leave fails | Partial | N/A | Yes | Pass by code |

## Section 15 - Notifications Audit

Evidence:

- Notifications controller is protected.
- List and unread-count scope to `user.id`.
- Delete validates notification ownership before deletion.
- Topbar fetches notification list and unread count, can mark read/all-read, and routes notification click based on entity type.

| Notification Flow | DB | API | UI | Read State | Route | Status |
|---|---|---|---|---|---|---|
| List | Table exists | 200 local | Topbar dropdown | Yes | Entity link | Pass local API |
| Unread count | Table exists | 200 local | Bell count | Yes | N/A | Pass local API |
| Mark read | Service exists | Endpoint exists | UI calls endpoint | Yes | N/A | Code verified |
| Mark all read | Service exists | Endpoint exists | UI calls endpoint | Yes | N/A | Code verified |
| Ticket/leave notifications | Service exists | Service invoked | UI capable | Yes | Yes | Partially verified |
| Preferences/quiet hours | Preferences present | User prefs API | Settings UI | Partial | N/A | Runtime enforcement not fully verified |

## Section 16 - Settings Audit

| Setting | API | Saves? | Persists? | Runtime Used? | Role Gate | Status |
|---|---|---:|---:|---:|---:|---|
| Profile | `/users/me`, `/users/:id/profile` | Yes | Yes | Yes | Scoped | Working |
| Photo upload | `/users/me/photo` | Yes | Yes if storage configured | Yes | Self | Partial: storage env unknown |
| Change password | `/auth/change-password` | Yes | Yes | Yes | Auth | Working |
| Notification preferences | `/users/me/preferences` | Yes | Yes | Partial | Self | Partial enforcement |
| Theme/display | Mixed localStorage/settings | Partial | Partial | Yes locally | Self/Admin defaults | Partial |
| Company settings | `/settings/company` | Yes | Yes | Yes | Admin+ | Working local |
| Leave policy | `/settings/leave-policy` | Yes | Yes | Yes | Admin+ | Working local |
| SLA settings | `/settings/sla` | Yes | Yes | Yes via timing service | Admin+ | Working local |
| SMTP settings/test | `/settings/smtp`, `/settings/email/test` | Yes | Yes | Yes via email service | Super-admin | Tests pass |
| Task types | `/task-types` | Yes | Yes | Ticket creation uses task types | Admin+ for mutation | Working |
| Unauthorized tabs | Frontend fallback | N/A | N/A | N/A | Local guard | Fixed locally |

## Section 17 - UX / Product Quality Audit

| Page | Visual Quality | Operational Clarity | Empty State | Error State | Mobile | Issues |
|---|---|---|---|---|---|---|
| Dashboard | Good | Good | Partial | Partial | Unknown | Drilldowns not browser-verified. |
| Tickets | Good | Good | Good | Good | Unknown | Export/download not browser-verified. |
| Kanban | Good | Good | Good | Partial | Unknown | Drag not browser-verified. |
| Projects | Good | Good | Good | Good | Unknown | Existing hook dependency warning. |
| Leave | Good | Good | Good | Good | Unknown | Approved leave absent locally. |
| Calendar | Good | Good | Partial | Partial | Unknown | Uses raw fetch. |
| Team | Good | Good for TL+ | Good | Partial | Unknown | Employee/intern access policy unclear. |
| Analytics | Good | Good for TL+ | Good | Permission fallback | Unknown | Frontend guard local-only until deployed. |
| Activity Log | Good | Good | Partial | Weak | Unknown | Non-OK fetch maps to empty array. |
| Settings | Good | Partial | N/A | Partial | Unknown | Some preferences remain local-only. |
| Profile | Good | Better after local fix | Good | Partial | Unknown | Activity feed uses dashboard API. |

## Section 18 - Security / Data Leak Audit

| Security Check | Expected | Actual | Status | Risk |
|---|---|---|---|---|
| Unauthenticated core APIs | 401 | 401 local | Pass | Low |
| Role-scoped tickets | Scoped by backend | TicketAccessService present and used | Pass by code | Low |
| Attachment access | Secure backend route | Route and frontend helper exist | Partial | Storage provider/env unknown |
| Payroll/document masking | Backend policy | Users service masks by requester role | Pass by code | Low |
| Settings access | Admin/super-admin mutations | Guards present | Pass | Low |
| Admin route direct access | Should not render admin UI | Local frontend guard added | Pass local | Deployment risk until direct deployed route check is completed |
| Activity log scoping | Role scoped | Events controller uses AccessPolicyService | Pass by code/API | Low |
| Notification scoping | Own only | Controller scopes and ownership-checks delete | Pass | Low |
| Invalid role/API access | 403 | Guards present | Pass by code | Low |
| Deployment env secrets | Not exposed | Not accessible | Unknown | Medium |

## Section 19 - Performance / Reliability Audit

| Area | Observation | Risk | Recommendation |
|---|---|---|---|
| Frontend bundle | Analytics route is large at about 117 kB page size / 258 kB first-load JS | P2 | Consider chart code splitting later. |
| API polling | Notifications poll 15-60s; dashboard refreshes periodically | Low | Acceptable for internal pilot. |
| Socket fallback | Recent fixes downgrade socket failures and rely on HTTP polling | Low | Verify on deployed domain. |
| Raw fetch | Several pages still bypass central API client | P1 | Migrate to central client after rollout stabilization. |
| Render cold start | Historical risk on free/low tier Render | Medium | Keep cold-start banner and monitor response times. |
| Long lists | Users/leave/tickets have pagination | Low | Continue enforcing limits. |
| Tests | Backend 135 tests pass | Low | Add frontend role smoke tests. |
| Browser console | Not fully verified | Medium | Run browser QA after deployment. |

## Section 20 - Final Classification

P0 blockers:

1. GitHub/Vercel/Render alignment is not directly verified from this environment.
2. Deployed authenticated API, migration logs, and deployment build logs could not be verified from this environment.

P1 issues:

1. Activity Log raw fetch returns empty state on non-OK instead of explicit error.
2. Several frontend surfaces still bypass the central API client.
3. Some Settings preferences are local-only or mixed local/server persistence.
4. Storage provider/Cloudinary deployment configuration is unverified.
5. Calendar approved leave rendering is code-verified but not data-verified because local DB has no approved leave.
6. Browser-level workflow tests were not completed for drag/drop, downloads, exports, and drilldowns.
7. Employee/intern Team and personal Activity Log access policy remains product-unclear.
8. Production env values for frontend/backend are not visible in this environment.
9. Frontend build has existing lint warnings.
10. Deployed Vercel/Render commit parity is unknown.

P2 issues:

- Mobile/responsive verification not completed.
- Some visual polish and copy consistency still need browser review.
- Analytics bundle size can be optimized later.
- Existing image and hook dependency lint warnings.

P3 future:

- AI, automation, forecasting, CRM, calendar integrations, advanced analytics.
