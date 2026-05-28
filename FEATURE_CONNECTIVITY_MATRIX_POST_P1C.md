# Feature Connectivity Matrix - Post P1-C Re-Audit

## Executive Summary
This is a fresh, read-only feature connectivity re-audit of the current Apex OS codebase after the stated P0, P1-A, P1-B, and P1-C stabilization work. I did not modify production code and did not reuse prior statuses as truth.

Current code evidence shows the core backend-first stabilization has materially improved the system: shared RBAC, ticket access, leave access, and SLA timing services now exist and are used by most critical APIs. The main remaining partial areas are not the old broad P0 failures; they are mostly feature-completeness gaps, local/static UI behavior, missing external integrations, incomplete task/broadcast models, URL filter gaps, public ticket attachment URLs, and some remaining home-dashboard risk/count drift.

## Count Summary
| Metric | Count |
|---|---:|
| Total features audited | 188 |
| A_FULLY_CONNECTED | 113 |
| B_PARTIAL_OR_BROKEN | 48 |
| C_FRONTEND_ONLY | 5 |
| D_BACKEND_ONLY | 2 |
| E_UNKNOWN | 1 |
| F_NOT_PRESENT | 19 |
| Current P0 regressions reopened from source evidence | 2 |
| Features using mock/static/local-only behavior | 24 |
| Features with frontend UI but no real backend persistence | 5 |
| Features with backend but no meaningful frontend | 2 |

## Status Definitions
- A = A_FULLY_CONNECTED: backend model/API/service, frontend call/UI, persistence, role scope, and states are materially connected.
- B = B_PARTIAL_OR_BROKEN: backend and frontend both exist or feature exists, but scope, count consistency, URL behavior, persistence, mutation coverage, or completeness is incomplete.
- C = C_FRONTEND_ONLY: UI exists but is static/local-only or has no real backend/database persistence.
- D = D_BACKEND_ONLY: backend exists but no meaningful frontend UI is connected.
- E = E_UNKNOWN: not enough current-code evidence without browser/visual QA or runtime verification.
- F = F_NOT_PRESENT: feature is not present in the current repo.

## Evidence Keys
- DB: `backend/prisma/schema.prisma:10-576`
- AUTH: `backend/src/modules/core/auth/auth.controller.ts:18-55`; `backend/src/modules/core/auth/auth.service.ts:29-177`; `frontend/store/auth.store.ts:35-58`; `frontend/app/(dashboard)/layout.tsx:20-39`
- RBAC: `backend/src/shared/constants/roles.ts:1-10`; `backend/src/shared/guards/roles.guard.ts:10-23`; `backend/src/common/services/access-policy.service.ts:34-150`
- USERS: `backend/src/modules/core/users/users.controller.ts:18-137`; `backend/src/modules/core/users/users.service.ts:15-416`; `frontend/lib/api.ts:74-111`; `frontend/app/(dashboard)/(platform)/users/page.tsx:35-67`
- HRMS: `backend/src/modules/core/users/users.service.ts:223-397`; `frontend/app/(dashboard)/(platform)/users/[id]/page.tsx:54-130`; `frontend/app/(dashboard)/(platform)/users/[id]/profile/page.tsx:64-107,508-563`
- DEPTS: `backend/src/modules/core/departments/departments.controller.ts:16-51`; `backend/src/modules/core/departments/departments.service.ts:8-103`; `frontend/app/(dashboard)/(platform)/departments/page.tsx:37-68`; `frontend/app/(dashboard)/(platform)/departments/[id]/page.tsx:73-147`
- WORKDAY: `backend/src/modules/platform/workday/workday.controller.ts:13-55`; `backend/src/modules/platform/workday/workday.service.ts:37-323`; `frontend/components/workday/WorkdayBar.tsx:33-89`; `frontend/components/workday/BreakModal.tsx:8-47`
- TICKET_ACCESS: `backend/src/common/services/ticket-access.service.ts:18-235`
- TICKET_TIMING: `backend/src/common/services/ticket-timing.service.ts:24-280`; `frontend/lib/ticket-timing.ts:76-151`; `frontend/components/tickets/ticket-row.tsx:132-169`
- TICKETS: `backend/src/modules/operations/tickets/tickets.controller.ts:28-149`; `backend/src/modules/operations/tickets/tickets.service.ts:103-819`; `frontend/lib/api.ts:146-182`; `frontend/app/(dashboard)/(operations)/tickets/page.tsx:41-284`; `frontend/app/(dashboard)/(operations)/tickets/[id]/page.tsx:464-586`
- COMMENTS: `backend/src/modules/operations/comments/comments.controller.ts:15-31`; `backend/src/modules/operations/comments/comments.service.ts:18-106`
- PROJECTS: `backend/src/modules/operations/projects/projects.controller.ts:17-58`; `backend/src/modules/operations/projects/projects.service.ts:21-293`; `frontend/app/(dashboard)/(operations)/projects/page.tsx:95-109`; `frontend/app/(dashboard)/(operations)/projects/[id]/page.tsx:26-75`
- LEAVE: `backend/src/modules/operations/leave/leave.controller.ts:17-57`; `backend/src/modules/operations/leave/leave.service.ts:31-316`; `backend/src/common/services/leave-access.service.ts:14-88`; `backend/src/modules/operations/leave/leave-balance.service.ts:78-150`; `frontend/app/(dashboard)/(operations)/leave/page.tsx:31-242`
- DASH: `backend/src/modules/platform/dashboard/dashboard.controller.ts:14-37`; `backend/src/modules/platform/dashboard/dashboard.service.ts:39-414`; `frontend/app/(dashboard)/analytics/page.tsx:53-106`; `frontend/app/(dashboard)/(core)/dashboard/page.tsx:34-55`
- NOTIFS: `backend/src/modules/operations/notifications/notifications.controller.ts:14-40`; `backend/src/modules/operations/notifications/notifications.service.ts:9-55`; `backend/src/modules/operations/notifications/notification-event.service.ts:30-81`; `frontend/components/layout/topbar.tsx:70-100,314-352`
- SETTINGS: `backend/src/modules/platform/settings/settings.controller.ts:18-91`; `backend/src/modules/platform/settings/settings.service.ts:29-91`; `frontend/app/(dashboard)/settings/page.tsx:96-123,344-373,622-862,905-978,1159-1178,1367-1371`
- TASKTYPES: `backend/src/modules/platform/task-types/task-types.controller.ts:16-65`; `backend/src/modules/platform/task-types/task-types.service.ts:10-53`; `frontend/app/(dashboard)/(operations)/tickets/new/page.tsx:108-207,340-372`; `frontend/app/(dashboard)/settings/page.tsx:905-978`
- AI: `backend/src/modules/ai/ai.controller.ts:23-45`; `backend/src/modules/ai/ai.service.ts:19-221`; `frontend/app/(dashboard)/(operations)/tickets/new/page.tsx:225-234,391-404`; `frontend/app/(dashboard)/(operations)/tickets/[id]/page.tsx:205-283`
- EVENTS: `backend/src/common/services/event-logger.service.ts:4-79`; `backend/src/modules/platform/events/events.controller.ts:64-89`; `frontend/app/(dashboard)/admin/activity/page.tsx:66-125`
- FILES: `backend/src/modules/platform/uploads/uploads.service.ts:26-63`; `backend/src/modules/operations/tickets/tickets.controller.ts:67-106`; `backend/src/modules/core/users/users.service.ts:329-397`; `frontend/app/(dashboard)/(operations)/tickets/[id]/page.tsx:128-152,1035-1067`
- STATIC: `frontend/components/ui/QuickActionPalette.tsx:23-59`; `frontend/app/(dashboard)/layout.tsx:45-117`; `frontend/components/ui/AnnouncementBroadcast.tsx:18-127`; `frontend/hooks/useTheme.ts:25-80`; `frontend/app/(dashboard)/settings/page.tsx:429-557`

## Feature Matrix

### Section 1 - Auth, Users, RBAC
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-001 | Authentication / Login | Auth | Yes | Yes | Yes | Yes | Yes | No | Partial | Partial | Yes | B | P1 | AUTH, RBAC | Login/JWT/logout are connected, but dashboard guard trusts persisted auth state and does not consistently refetch `/auth/me` before access decisions. |
| FEAT-002 | Current User / Session Profile | Auth | Yes | Yes | Yes | Partial | Yes | No | Partial | Unknown | Partial | B | P1 | AUTH, USERS | `/auth/me` and `/users/me` exist, but UI state mostly comes from persisted Zustand rather than a universal current-user refresh. |
| FEAT-003 | RBAC / Role Permissions | RBAC | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P0 | RBAC, TICKET_ACCESS, LEAVE, PROJECTS | Canonical role constants, guards, access policy, ticket scope, leave scope, and project scope are present. |
| FEAT-004 | User List | Users | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P0 | USERS, RBAC | List is paginated/scoped and generic responses use `safeUser` to strip sensitive fields. |
| FEAT-005 | Add User | Users | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | USERS | Admin-guarded create path hashes password and persists role/department. |
| FEAT-006 | Edit User | Users | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | USERS | Admin update route persists profile, role, department, and active state. |
| FEAT-007 | Activate / Deactivate User | Users | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | USERS | Deactivation updates `isActive` and emits an operational event. |
| FEAT-008 | User Status | Users | Partial | Partial | Partial | Partial | Partial | No | Partial | Unknown | Partial | B | P1 | DB, USERS, WORKDAY | `isActive` and `currentStatus` exist, but invited/suspended/deactivated lifecycle is not fully modeled. |
| FEAT-009 | User Role Badges | Users | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P2 | DB, USERS, HRMS | Badges are sourced from the role relation. |
| FEAT-010 | User Department Assignment | Users | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | DB, USERS, DEPTS | `User.departmentId` is persisted and editable through admin/user flows. |

### Section 2 - HRMS Profile
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-011 | User Profile Header | HRMS | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | HRMS, USERS | Header fields load from `/users/:id/profile`. |
| FEAT-012 | Personal Details | HRMS | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | DB, HRMS | Personal fields are in Prisma and profile update enforces self/admin rules. |
| FEAT-013 | Employment Details | HRMS | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | DB, HRMS | Employment fields are persisted and shown in the profile UI. |
| FEAT-014 | Account & Access | HRMS | Yes | Yes | Partial | Partial | Partial | No | Partial | Unknown | Partial | B | P1 | USERS, HRMS | Role/status are connected; session/last-active/reset account management remains fragmented. |
| FEAT-015 | Payroll & Statutory | HRMS | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P0 | DB, HRMS, RBAC | Payroll fields are masked/stripped unless admin/HR/self policy allows access. |
| FEAT-016 | Documents & Verification | HRMS | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P0 | DB, HRMS, FILES | Document list/upload/verify paths are backend scoped; documents are stored as DB data URLs, not public predictable paths. |
| FEAT-017 | HR Notes | HRMS | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | DB, HRMS | HR notes are admin/HR editable through profile update. |
| FEAT-018 | Verification Details | HRMS | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | DB, HRMS | User/document verification status, verifier, dates, and rejection reason are modeled and surfaced. |

### Section 3 - Departments, Teams, Directory
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-019 | Departments List | Departments | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | DEPTS | Department cards use backend counts and department data. |
| FEAT-020 | New Department | Departments | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | DEPTS | Create is admin-guarded and persisted. |
| FEAT-021 | Edit Department | Departments | Yes | Yes | Partial | Yes | Yes | No | Yes | Partial | Yes | B | P1 | DEPTS | Name/color/description save; lead assignment is not a true department relation. |
| FEAT-022 | Delete/Archive Department | Departments | Yes | Yes | Partial | Yes | Yes | No | Yes | Partial | Yes | B | P1 | DEPTS | Delete exists and blocks active-ticket departments, but no archive state exists. |
| FEAT-023 | Department Detail | Departments | Yes | Yes | Yes | Yes | Yes | No | Yes | Partial | Yes | A | P1 | DEPTS | Detail page loads real members, tickets, leave, project metrics. |
| FEAT-024 | Department Lead | Departments | Partial | No | Partial | Partial | Partial | No | Partial | Partial | Yes | B | P1 | DB, DEPTS | Lead is inferred from users/roles, not stored as a validated department lead relation. |
| FEAT-025 | Add Member to Department | Departments | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | USERS, DEPTS | Member add/remove updates `User.departmentId`. |
| FEAT-026 | Department Metrics | Departments | Yes | Yes | Partial | Yes | Yes | No | Partial | Partial | Yes | B | P1 | DEPTS | Metrics are real but duplicated and partly unscoped/derived from `_count`. |
| FEAT-027 | Company Directory | Directory | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | USERS, WORKDAY | Directory uses scoped active users and ticket counts. |
| FEAT-028 | Live Status Directory | Directory | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P2 | WORKDAY | Team status uses persisted work session/user status data. |
| FEAT-029 | Teams Model | Teams | No | No | No | No | No | No | No | No | No | F | P2 | DB | No separate Team model exists. |
| FEAT-030 | Team Members | Teams | Partial | Partial | Partial | Partial | Partial | No | Partial | Partial | Partial | B | P1 | DB, USERS, WORKDAY | Team membership is represented through departments, not a dedicated team membership model. |

### Section 4 - Workday / Attendance
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-031 | Workday Start | Workday | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | DB, WORKDAY | Start work upserts a WorkSession and AttendanceEvent. |
| FEAT-032 | Workday Active State | Workday | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | WORKDAY | Active state, duration, and started time come from `/workday/today`. |
| FEAT-033 | Break Flow | Workday | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | DB, WORKDAY | Break start/end persists BreakLog and session totals. |
| FEAT-034 | Break Types | Workday | Yes | Partial | Partial | Yes | Partial | Yes | Yes | Yes | Yes | B | P2 | DB, WORKDAY | Selected break type persists as a string; the type catalogue is static UI. |
| FEAT-035 | Resume Work | Workday | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | WORKDAY | Resume updates session/user status. |
| FEAT-036 | End Workday | Workday | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | WORKDAY | End work computes and persists work/break totals. |
| FEAT-037 | End Day Summary | Workday | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | WORKDAY | Summary values are returned from persisted session records. |
| FEAT-038 | Workday Logs | Workday | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | DB, WORKDAY | WorkSession, BreakLog, and AttendanceEvent cover logs/history. |
| FEAT-039 | Team Workday Visibility | Workday | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | WORKDAY | Team endpoint scopes by admin/manager/TL department access. |
| FEAT-040 | Idle Tracking | Workday | Yes | Yes | Yes | Yes | Yes | No | Yes | Unknown | Yes | A | P2 | WORKDAY | Idle reporting and resume actions are connected. |

### Section 5 - Tickets
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-041 | Ticket List Page | Tickets | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | TICKETS, TICKET_ACCESS | List is paginated, role-scoped, and decorated with backend timing. |
| FEAT-042 | New Ticket | Tickets | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | TICKETS, TASKTYPES | Create persists department/project/assignee/type/subtype data. |
| FEAT-043 | Ticket Search | Tickets | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | TICKETS, TICKET_ACCESS | Backend search covers title, ticketId, and description. |
| FEAT-044 | Ticket Filters | Tickets | Partial | Yes | Partial | Partial | Yes | No | Yes | Partial | Yes | B | P1 | TICKETS, TICKET_ACCESS | Core filters work; UI still lacks full assignee/project/date/url-filter coverage and overdue filter uses dueDate. |
| FEAT-045 | Ticket Sorting | Tickets | Partial | Yes | Partial | Partial | Yes | No | Yes | Partial | Partial | B | P2 | TICKETS | Backend has fixed ordering; no complete user-facing sort controls. |
| FEAT-046 | Ticket Status Tabs | Tickets | Yes | Yes | Partial | Yes | Yes | No | Yes | Partial | Yes | B | P1 | TICKETS | Tabs are real, but counts come from separate stats and do not include current search/filter state. |
| FEAT-047 | Ticket Export | Tickets | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P2 | TICKETS | CSV export uses scoped `findAll`. |
| FEAT-048 | Ticket Detail Page | Tickets | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P0 | TICKETS, TICKET_ACCESS | Detail endpoint calls `findAccessibleTicket`. |
| FEAT-049 | Ticket Comments | Tickets | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P0 | COMMENTS, TICKET_ACCESS | Comment list/create/update/delete inherits ticket visibility. |
| FEAT-050 | Ticket History | Tickets | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P0 | TICKETS | History fetches only after accessible ticket resolution. |
| FEAT-051 | Ticket Attachments | Tickets | Yes | Yes | Partial | Yes | Yes | No | Partial | Unknown | Yes | B | P0 | FILES, TICKETS | Upload/list inherit ticket access, but attachment view/download opens stored `url` directly; no protected download endpoint. |
| FEAT-052 | Ticket Assignment | Tickets | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P0 | TICKET_ACCESS, TICKETS | Assignment checks role, ticket scope, and assignee scope. |
| FEAT-053 | Ticket Reassignment | Tickets | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | TICKETS, EVENTS | Reassignment persists and writes history/event data. |
| FEAT-054 | Ticket Status Workflow | Tickets | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P0 | TICKET_ACCESS, TICKETS | Transition matrix and role/scope checks are centralized. |
| FEAT-055 | Ticket Close/Reopen | Tickets | Partial | Yes | Partial | Partial | Yes | No | Yes | Partial | Partial | B | P1 | TICKET_ACCESS, TICKETS | Close exists; no complete reopen workflow from CLOSED. |
| FEAT-056 | Ticket Edit | Tickets | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | TICKET_ACCESS, TICKETS | Update path verifies ticket scope and mutation rights. |
| FEAT-057 | Ticket Delete | Tickets | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P0 | TICKET_ACCESS, TICKETS, EVENTS | Delete is admin-only, scoped, and event-logged; it is still hard delete rather than archive. |
| FEAT-058 | Ticket Project Link | Tickets | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | DB, TICKETS, PROJECTS | `projectId` relation is persisted and rendered. |
| FEAT-059 | Ticket Reporter | Tickets | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | DB, TICKETS | Reporter is the `createdBy` relation. |
| FEAT-060 | Ticket Category/Department | Tickets | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | DB, TICKETS | Category enum and department relation are separate persisted fields. |
| FEAT-061 | Ticket Type/Subtype | Tickets | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | DB, TASKTYPES, TICKETS | Task type/subtype models are used during ticket creation and display. |

### Section 6 - SLA / Timing
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-062 | SLA Settings | SLA | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P0 | SETTINGS, TICKET_TIMING | SLA/review SLA save in AppSetting and are read by TicketTimingService. |
| FEAT-063 | Ticket SLA Timer | SLA | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P0 | TICKET_TIMING, TICKETS | Backend returns authoritative `timing`; frontend formats it. |
| FEAT-064 | SLA Progress Bar | SLA | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P0 | TICKET_TIMING | `progressPercent` is returned by backend and consumed in ticket rows/detail. |
| FEAT-065 | Overdue Badge | SLA | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P0 | TICKET_TIMING, TICKETS | Overdue comes from backend timing decoration. |
| FEAT-066 | Immediate Overdue Bug Check | SLA | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P0 | TICKET_TIMING | OPEN tickets without due/schedule/estimate return no active SLA, not overdue. |
| FEAT-067 | Working Hours Aware SLA | SLA | No | No | No | No | No | No | No | No | No | F | P2 | TICKET_TIMING | Timing is calendar-time based; no working-hours/calendar engine exists. |
| FEAT-068 | Pause/Resume SLA | SLA | No | No | No | No | No | No | No | No | No | F | P2 | TICKET_TIMING | No blocked/paused SLA state exists. |
| FEAT-069 | Shared Ticket Timing Utility | SLA | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | TICKET_TIMING | Backend shared service plus frontend formatter is present. |
| FEAT-070 | SLA Risk Categories | SLA | Partial | Yes | Partial | Partial | Yes | No | Yes | Partial | Partial | B | P1 | TICKETS, DASH | `sla-risk` covers overdue/due soon/review/unassigned; blocked and acknowledgement are absent. |

### Section 7 - Kanban
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-071 | Kanban Board Page | Kanban | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | TICKETS | Kanban endpoint returns scoped ticket columns. |
| FEAT-072 | Kanban Drag-and-Drop | Kanban | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | TICKETS, TICKET_ACCESS | Drag/drop uses `updateStatus`; backend enforces transition scope. |
| FEAT-073 | Kanban Filters | Kanban | Partial | Yes | Partial | Partial | Yes | No | Yes | Partial | Yes | B | P2 | TICKETS | Kanban UI mainly exposes department filtering despite backend supporting more filters. |
| FEAT-074 | Kanban Card SLA Display | Kanban | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | TICKET_TIMING, TICKETS | Cards use tickets decorated by backend timing. |
| FEAT-075 | Kanban Count Consistency | Kanban | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P0 | TICKETS, TICKET_ACCESS | Kanban counts are generated from the same scoped query result. |
| FEAT-076 | Kanban UI Contrast | Kanban | Yes | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | E | P2 | `frontend/app/(dashboard)/(operations)/kanban/page.tsx:400` | Visual/browser contrast QA was not run in this source-only audit. |

### Section 8 - Projects
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-077 | Projects List | Projects | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | PROJECTS | Project list uses scoped backend data. |
| FEAT-078 | New Project | Projects | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | PROJECTS | Create is manager/admin guarded and persists. |
| FEAT-079 | Edit Project | Projects | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P0 | PROJECTS, RBAC | Scoped manager/TL/admin edit policy is enforced by backend. |
| FEAT-080 | Delete/Archive Project | Projects | Yes | Yes | Partial | Yes | Yes | No | Yes | Partial | Yes | B | P1 | PROJECTS | Admin delete exists; no archive state/workflow. |
| FEAT-081 | Project Detail | Projects | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | PROJECTS | Detail loads real project, tickets, members, and progress. |
| FEAT-082 | Project Tickets | Projects | Partial | Yes | Partial | Partial | Yes | No | Yes | Partial | Partial | B | P1 | PROJECTS, TICKETS | Linked tickets display; adding existing tickets from project detail is incomplete. |
| FEAT-083 | Project Team | Projects | Partial | Yes | Partial | Partial | Yes | No | Yes | Partial | Yes | B | P1 | PROJECTS | Backend member APIs exist, but frontend member management is not complete. |
| FEAT-084 | Project Progress | Projects | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | PROJECTS | Progress is computed from linked tickets. |
| FEAT-085 | Project Priority | Projects | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P2 | DB, PROJECTS | Priority enum persists and renders. |
| FEAT-086 | Project Status | Projects | Yes | Yes | Partial | Yes | Yes | No | Yes | Partial | Yes | B | P2 | DB, PROJECTS | Persisted enum lacks requested on-track/at-risk/delayed/archived status taxonomy. |
| FEAT-087 | Strategic Projects Workspace | Projects | No | No | No | No | No | No | No | No | No | F | P3 | PROJECTS | No separate strategic project workspace was found. |

### Section 9 - Tasks / Checklist
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-088 | My Tasks Panel | Tasks | No | No | No | No | No | No | No | No | No | F | P3 | DB, STATIC | No standalone task model/panel exists beyond tickets and quick links. |
| FEAT-089 | Task Board | Tasks | No | No | No | No | No | No | No | No | No | F | P3 | DB | No task board exists. |
| FEAT-090 | Checklist Operations Console | Tasks | Yes | No | No | No | No | Yes | No | No | Yes | C | P3 | STATIC | Quick-action/checklist surface is static navigation, not task persistence. |
| FEAT-091 | Add Personal Task | Tasks | No | No | No | No | No | No | No | No | No | F | P3 | DB, SETTINGS | No personal task API/model exists. |
| FEAT-092 | Add Team Duty | Tasks | No | No | No | No | No | No | No | No | No | F | P3 | DB | No team duty API/model exists. |
| FEAT-093 | Complete Task | Tasks | No | No | No | No | No | No | No | No | No | F | P3 | DB | No task completion endpoint exists. |
| FEAT-094 | Task Due Time | Tasks | No | No | No | No | No | No | No | No | No | F | P3 | DB | Due times exist for tickets, not standalone tasks. |
| FEAT-095 | Task Owner | Tasks | No | No | No | No | No | No | No | No | No | F | P3 | DB | Owner relation exists for tickets/projects, not standalone tasks. |

### Section 10 - Leave Management
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-096 | Leave List | Leave | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | LEAVE | List is paginated and scope-filtered through LeaveAccessService. |
| FEAT-097 | Apply Leave | Leave | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | LEAVE | Apply creates LeaveRequest after date/balance validation. |
| FEAT-098 | Leave Summary Cards | Leave | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | LEAVE | Cards read scoped backend stats. |
| FEAT-099 | Leave Tabs | Leave | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | LEAVE | Needs Action/All/My Requests map to scoped backend queries. |
| FEAT-100 | Leave Approval | Leave | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P0 | LEAVE | Direct ID approve is scoped and hierarchy checked. |
| FEAT-101 | Leave Rejection | Leave | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P0 | LEAVE | Direct ID reject is scoped and hierarchy checked. |
| FEAT-102 | Leave Types | Leave | Partial | Yes | Partial | Yes | Yes | Yes | Yes | Yes | Yes | B | P2 | DB, LEAVE | Enum/UI cover annual/sick/emergency/unpaid/other; requested casual/paid/WFH/half-day type set is incomplete. |
| FEAT-103 | Leave Policy Settings | Leave | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | SETTINGS, LEAVE | Quotas save in AppSetting and are read by LeaveBalanceService. |
| FEAT-104 | Leave Balance Calculation | Leave | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | LEAVE | Balance API calculates allocation/approved/pending/balance. |
| FEAT-105 | Leave Count Consistency | Leave | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | LEAVE | List and stats share LeaveAccessService scope. |
| FEAT-106 | Leave Notifications | Leave | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | LEAVE, NOTIFS | Applied/approved/rejected/cancelled notifications are wired through NotificationEventService. |

### Section 11 - Analytics / Reporting
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-107 | Analytics Overview | Analytics | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P0 | DASH | Ticket overview uses TicketAccessService and TicketTimingService. |
| FEAT-108 | Ticket Trend Chart | Analytics | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P0 | DASH | Trend uses scoped ticket query and `resolvedAt` for resolved counts. |
| FEAT-109 | Category Donut Chart | Analytics | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P0 | DASH | Category groupBy is scoped through TicketAccessService. |
| FEAT-110 | Team Workload | Analytics | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P0 | DASH | Workload uses visible users and scoped assigned active tickets. |
| FEAT-111 | Detailed Analytics Tab | Analytics | Partial | Yes | Partial | Partial | Yes | No | Yes | Partial | Yes | B | P1 | DASH | Detailed analytics uses capped ticket list rather than a dedicated report query. |
| FEAT-112 | Analytics Scope Consistency | Analytics | Partial | Yes | Partial | Partial | Yes | No | Partial | Partial | Partial | B | P0 | DASH | Analytics endpoints are scoped; home dashboard still has dueDate-based overdue/risk counts and unscoped project totals. |
| FEAT-113 | Reports Export | Reporting | Partial | Yes | Partial | Partial | Yes | No | Yes | Partial | Partial | B | P1 | TICKETS, STATIC | Ticket CSV export works; `/reports` redirects to analytics and no full report builder/export suite exists. |

### Section 12 - Delivery Risk / Command Analytics
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-114 | Delivery Risk Snapshot | Delivery Risk | Partial | Yes | Partial | Partial | Yes | Partial | Yes | Partial | Partial | B | P1 | DASH, TICKETS | Risk snapshot exists through summary/sla-risk, but no full delivery-risk subsystem. |
| FEAT-115 | Delivery SLA Risks Analyzer | Delivery Risk | Partial | Yes | Partial | Partial | Yes | Partial | Yes | Partial | Partial | B | P2 | TICKETS, STATIC | Backend `sla-risk` exists; analyzer modal/page is still mostly quick-action/navigation UI. |
| FEAT-116 | Blocked Tickets Risk | Delivery Risk | No | No | No | No | No | No | No | No | No | F | P2 | DB | No BLOCKED ticket status/model was found. |
| FEAT-117 | SLA Breach Risk | Delivery Risk | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | TICKETS, TICKET_TIMING | SLA breach count uses backend timing state. |
| FEAT-118 | Unassigned Tickets Risk | Delivery Risk | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | TICKETS | Unassigned risk count is scoped in `getSlaRisk`. |
| FEAT-119 | Review Ageing Risk | Delivery Risk | Partial | Yes | Partial | Partial | Yes | No | Yes | Partial | Partial | B | P1 | TICKETS | Review-ageing count exists, but threshold semantics are limited and overlap overdue logic. |
| FEAT-120 | Risk Acknowledgement | Delivery Risk | No | No | No | No | No | No | No | No | No | F | P2 | EVENTS, TICKETS | No ACK mutation or risk acknowledgement event exists. |
| FEAT-121 | Risk Severity | Delivery Risk | Partial | Partial | Partial | Partial | Partial | Yes | Partial | Partial | Partial | B | P2 | DASH, STATIC | Severity labels are generated in alerts/UI but not normalized as backend risk records. |

### Section 13 - Notifications / Alerts
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-122 | Dashboard Notifications | Notifications | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | NOTIFS | Notification panel loads real user notifications. |
| FEAT-123 | Notification Bell | Notifications | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | NOTIFS | Bell unread count is backend-backed and refetched. |
| FEAT-124 | System Alerts Dropdown | Notifications | Yes | Partial | Partial | Partial | Partial | Yes | Partial | Partial | Yes | C | P3 | DASH, STATIC | Mockup-style system alerts are UI-derived, not persisted alert records. |
| FEAT-125 | Mark All Read | Notifications | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | NOTIFS | Mark-all-read updates only the current user's notifications. |
| FEAT-126 | Dismiss Alert | Notifications | No | Yes | Yes | No | Yes | No | Yes | Unknown | Unknown | D | P2 | NOTIFS | Backend delete exists with ownership guard; no dismiss/delete UI is connected. |
| FEAT-127 | Notification Preferences | Notifications | Yes | Yes | Yes | Yes | Yes | Partial | Yes | Yes | Yes | A | P1 | USERS, NOTIFS, SETTINGS | Preferences persist as AppSetting and are checked by NotificationEventService. |
| FEAT-128 | Quiet Hours | Notifications | Yes | Yes | Yes | Yes | Yes | Partial | Yes | Yes | Yes | A | P2 | NOTIFS, SETTINGS | Quiet hours suppress realtime socket delivery while still storing in-app notifications. |
| FEAT-129 | Notification Event Triggers | Notifications | Partial | Yes | Partial | Partial | Yes | Partial | Partial | Unknown | Yes | B | P1 | TICKETS, LEAVE, NOTIFS | Ticket/leave triggers exist; automation/scheduler paths still create some notifications directly and can bypass preferences. |

### Section 14 - Command Center / Quick Actions
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-130 | Command Center Shell | Command Center | Yes | Partial | Partial | Partial | Partial | Yes | Partial | Unknown | Partial | B | P1 | AUTH, STATIC | Shell exists; auth hydration/current-user refresh is still partial. |
| FEAT-131 | Global Command Search | Command Center | Yes | Yes | Partial | Yes | Yes | Partial | Partial | Partial | Yes | B | P2 | STATIC, TICKETS, PROJECTS, USERS | Command search queries tickets/projects/people but not all requested domains. |
| FEAT-132 | Command Palette / Quick Actions | Command Center | Yes | Partial | Partial | Partial | Partial | Yes | Partial | Partial | Yes | B | P2 | STATIC | Palette mixes real navigation with static action definitions. |
| FEAT-133 | Quick Action: Create New Ticket | Command Center | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P2 | STATIC, TICKETS | Routes to the real new-ticket workflow. |
| FEAT-134 | Quick Action: Review Delivery Risks | Command Center | Yes | Partial | Partial | Partial | Partial | Yes | Partial | Partial | Yes | B | P2 | STATIC, TICKETS | Routes/filter links exist; no full risk analyzer action. |
| FEAT-135 | Quick Action: Check Due Today | Command Center | Yes | Partial | Partial | Partial | Partial | Yes | Partial | Partial | Yes | B | P2 | STATIC, TICKETS | Layout pushes `?filter=due-today`, but ticket page does not parse that URL filter. |
| FEAT-136 | Quick Action: Review High Priority | Command Center | Yes | Partial | Partial | Partial | Partial | Yes | Partial | Partial | Yes | B | P2 | STATIC, TICKETS | Route query is generated, but ticket page does not hydrate filters from URL. |
| FEAT-137 | Quick Action: Open Projects | Command Center | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P2 | STATIC, PROJECTS | Routes to connected projects page. |
| FEAT-138 | Quick Action: Check Team Availability | Command Center | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P2 | STATIC, WORKDAY | Routes to team page backed by directory/workday data. |
| FEAT-139 | Quick Action: Review Leave Requests | Command Center | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P2 | STATIC, LEAVE | Routes to leave page with role-sensitive pending tab. |

### Section 15 - Broadcasts / Calendar / Timeline
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-140 | Operations Broadcast Banner | Broadcasts | Yes | No | No | No | No | Yes | No | No | Yes | C | P3 | STATIC, DASH | Banner is UI-derived from summary/alerts, not a broadcast model/API. |
| FEAT-141 | Broadcast Details Modal | Broadcasts | Yes | No | No | No | No | Yes | No | No | Yes | C | P3 | STATIC | Hover/details copy is static UI. |
| FEAT-142 | Acknowledge Broadcast | Broadcasts | No | No | No | No | No | No | No | No | No | F | P3 | STATIC | No acknowledgement mutation/audit exists. |
| FEAT-143 | Add to Calendar | Calendar | Yes | No | No | No | No | Yes | No | No | Yes | C | P3 | STATIC | Broadcast Add to Calendar only toggles local UI state. |
| FEAT-144 | Create Pre-review Ticket from Broadcast | Broadcasts | No | No | No | No | No | No | No | No | No | F | P3 | STATIC, TICKETS | No broadcast-to-ticket integration exists. |
| FEAT-145 | Broadcast History | Broadcasts | No | No | No | No | No | No | No | No | No | F | P3 | DB | No broadcast history model/page exists. |
| FEAT-146 | Critical Timeline Milestones | Timeline | Partial | Yes | Partial | Yes | Yes | No | Yes | Partial | Yes | B | P2 | DASH, `frontend/app/(dashboard)/calendar/page.tsx:62-130` | Calendar/upcoming events come from tickets/leave; no milestone model. |
| FEAT-147 | Milestone Types | Timeline | Partial | Partial | Partial | Partial | Partial | Yes | Partial | Partial | Partial | B | P3 | DASH | Timeline types are inferred from ticket/leave events, not a full milestone type system. |
| FEAT-148 | Milestone Links | Timeline | Partial | Yes | Partial | Yes | Yes | No | Yes | Partial | Yes | B | P2 | DASH | Ticket/leave calendar links exist; project/department milestone links are not complete. |

### Section 16 - Settings
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-149 | Settings Shell | Settings | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | SETTINGS | Settings sections are role-visible and backend-backed where applicable. |
| FEAT-150 | Settings Profile | Settings | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | SETTINGS, USERS | Name/avatar/photo/bio save through users APIs. |
| FEAT-151 | Appearance Settings | Settings | Yes | Partial | Partial | Partial | Partial | Yes | Partial | Partial | Yes | B | P2 | SETTINGS, STATIC | Theme/accent/company defaults exist; personal font/compact remain localStorage. |
| FEAT-152 | Company Default Theme | Settings | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P2 | SETTINGS | Company default theme/accent save through company settings. |
| FEAT-153 | Preferences Settings | Settings | Yes | Yes | Partial | Partial | Partial | Partial | Yes | Partial | Yes | B | P2 | USERS, SETTINGS, STATIC | Notification/default priority prefs persist; onboarding reset remains local-only. |
| FEAT-154 | Security Settings | Settings | Yes | Yes | Partial | Yes | Yes | No | Yes | Unknown | Yes | B | P1 | AUTH, SETTINGS | Password change is connected; session-info/security management is incomplete. |
| FEAT-155 | Company Info Settings | Settings | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | SETTINGS | Company name/tagline/contact/defaults persist in AppSetting. |
| FEAT-156 | SLA Settings Persistence | Settings | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P0 | SETTINGS, TICKET_TIMING | SLA settings are saved and consumed by ticket timing. |
| FEAT-157 | Task Types Settings | Settings | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | TASKTYPES | Task types/subtypes are CRUD-backed. |
| FEAT-158 | Custom Subtype Save | Settings/Tickets | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | TASKTYPES, TICKETS | Custom subtype text persists on tickets. |
| FEAT-159 | Email & SMTP Settings | Settings | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | SETTINGS | SMTP values save with password mask preservation. |
| FEAT-160 | Send Test Email | Settings | No | No | No | No | No | No | No | No | No | F | P2 | SETTINGS | No test-email endpoint/UI was found. |

### Section 17 - Theme / UI System
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-161 | Dark Theme | Theme/UI | Yes | Partial | Partial | Partial | Partial | No | Yes | Yes | Yes | A | P2 | SETTINGS, STATIC, `frontend/app/globals.css` | Data-theme and dark classes exist app-wide enough for current UI. |
| FEAT-162 | Light Theme | Theme/UI | Yes | Partial | Partial | Partial | Partial | No | Yes | Yes | Yes | A | P2 | SETTINGS, STATIC, `frontend/app/globals.css` | Light theme is default and tokenized. |
| FEAT-163 | Theme Presets | Theme/UI | Yes | Partial | Partial | Partial | Partial | Yes | Yes | Yes | Yes | A | P2 | SETTINGS | Preset list and application are implemented. |
| FEAT-164 | Accent Color | Theme/UI | Yes | Partial | Partial | Partial | Partial | Yes | Yes | Yes | Yes | A | P2 | SETTINGS, STATIC | Accent persists locally and as company default. |
| FEAT-165 | Font Size | Theme/UI | Yes | No | No | No | Partial | Yes | No | No | Yes | A | P3 | STATIC | Local persisted UI setting exists via data attribute. |
| FEAT-166 | Compact Mode | Theme/UI | Yes | No | No | No | Partial | Yes | No | No | Yes | A | P3 | STATIC | Local persisted compact mode exists via data attribute. |
| FEAT-167 | Consistent Design Tokens | Theme/UI | Yes | Partial | Partial | Partial | Partial | No | Yes | Yes | Yes | A | P2 | `frontend/app/globals.css`; SETTINGS | CSS variables/data-theme tokens are centralized. |
| FEAT-168 | Loading States | Theme/UI | Yes | Unknown | Unknown | Unknown | Unknown | No | Unknown | Unknown | Yes | A | P2 | TICKETS, LEAVE, USERS, PROJECTS, DASH | Major modules have loaders/skeletons. |
| FEAT-169 | Error States | Theme/UI | Yes | Unknown | Unknown | Unknown | Unknown | No | Unknown | Unknown | Yes | A | P2 | `frontend/lib/api.ts:36-55`; module pages | API interceptor normalizes 403/validation and pages show retry/toasts. |
| FEAT-170 | Empty States | Theme/UI | Yes | Unknown | Unknown | Unknown | Unknown | No | Unknown | Unknown | Yes | A | P2 | TICKETS, LEAVE, USERS | Major lists include empty states. |

### Section 18 - AI
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-171 | Ticket AI Suggestions | AI | Yes | No | Partial | Yes | No | Yes | Yes | No | Yes | B | P3 | AI | Priority suggestion endpoint/UI exists but returns coming-soon fallback without provider key. |
| FEAT-172 | AI Ticket Summary | AI | No | No | Yes | No | No | Yes | Yes | No | Unknown | D | P3 | AI | Backend summary endpoint exists; no meaningful frontend consumer was found. |
| FEAT-173 | Suggested Next Action | AI | Yes | No | Partial | Yes | No | Yes | Yes | No | Yes | B | P3 | AI | Ticket detail panel calls backend but can return disabled/fallback output. |
| FEAT-174 | Suggested Assignee/Priority/Category | AI | Partial | No | Partial | Partial | No | Yes | Yes | No | Yes | B | P3 | AI | Priority and assignee suggestions exist; category suggestion is incomplete. |
| FEAT-175 | Guidance Engine | AI | Partial | No | Partial | Partial | No | Yes | Partial | Partial | Yes | B | P3 | DASH, AI | Dashboard has rule-based alerts, not a full AI guidance engine. |

### Section 19 - Audit / Event Logs
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-176 | Event Log Model | Audit | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | DB, EVENTS | ActivityLog and OperationalEvent exist with admin activity UI. |
| FEAT-177 | Ticket Events | Audit | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | TICKETS, EVENTS | Ticket create/edit/status/comment/attachment/delete events are logged. |
| FEAT-178 | Leave Events | Audit | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | LEAVE, EVENTS | Leave request/approve/reject/cancel events are logged. |
| FEAT-179 | Workday Events | Audit | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | WORKDAY, DB | AttendanceEvent logs start/break/resume/end/idle-style events. |
| FEAT-180 | User/Admin Events | Audit | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | USERS, EVENTS | User create/update/deactivate/role changes are event-logged. |
| FEAT-181 | Settings Events | Audit | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P1 | SETTINGS, EVENTS | Settings writes call EventLoggerService. |
| FEAT-182 | Risk Acknowledgement Events | Audit | No | No | No | No | No | No | No | No | No | F | P2 | EVENTS, TICKETS | No risk ACK feature exists, so no ACK events exist. |

### Section 20 - Files / Exports / Integrations
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-183 | File Upload Infrastructure | Files | Yes | Yes | Yes | Yes | Yes | Partial | Yes | Yes | Yes | A | P1 | FILES | Ticket uploads use Cloudinary or base64 fallback; HR documents store DB data URLs. |
| FEAT-184 | Document Access Control | Files/HRMS | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A | P0 | HRMS, FILES | HR documents are only returned through scoped backend document endpoints. |
| FEAT-185 | CSV/Excel Export | Exports | Partial | Yes | Partial | Partial | Yes | No | Yes | Partial | Partial | B | P2 | TICKETS | Ticket CSV export works; Excel/project/leave/report exports are absent. |
| FEAT-186 | SMTP Email Sending | Integrations | Partial | Partial | Partial | Partial | Partial | No | Yes | Unknown | Partial | B | P1 | `backend/src/modules/platform/email/email.service.ts:8-122`; SETTINGS | Nodemailer email sending exists via env config; saved SMTP settings are not the active transporter source. |
| FEAT-187 | Calendar Integration | Integrations | No | No | No | No | No | No | No | No | No | F | P3 | STATIC | Internal calendar exists, but no Google/Outlook/ICS integration was found. |
| FEAT-188 | AI Provider Integration | Integrations | Yes | No | Yes | Yes | No | Partial | Yes | Unknown | Yes | A | P3 | AI | OpenAI provider initialization exists and gracefully disables when no key is configured. |

## Current P0 Reopened By Evidence
| Feature | Reason |
|---|---|
| FEAT-051 Ticket Attachments | Ticket upload/list is scoped, but frontend opens stored attachment URLs directly and no protected download route exists. |
| FEAT-112 Analytics Scope Consistency | Analytics endpoints are scoped, but home dashboard/risk metrics still use dueDate-based overdue logic and some unscoped project totals. |

## Recommended Fix Order
1. Close the remaining attachment download gap by adding an authenticated ticket attachment download/proxy route or signed URL policy.
2. Finish count convergence by replacing home dashboard dueDate-overdue counts with TicketTimingService-derived counts and scoping project totals.
3. Make ticket URL query filters hydrate the ticket list for quick actions (`due-today`, `priority=HIGH`, etc.).
4. Decide whether standalone tasks/broadcasts/risk acknowledgement are in scope; they are currently absent or UI-only.
5. Decide whether SMTP settings should drive the email transporter instead of environment variables.

