# Apex OS System Feature Audit

Audit date: 2026-05-29  
Scope: visible routes, navigation, tabs, modals, buttons, API clients, backend controllers, backend services, Prisma models, RBAC, event/activity logging, dashboard/reporting impacts, realtime, AI, and tests.  
Constraint: documentation-only audit. No application code or schema changes were made.

## Executive Summary

This audit treats Apex OS as it exists today, not as the UI implies it may become later.

Summary counts are feature-capability counts. Some matrix rows group adjacent controls when the same UI, API, RBAC, and persistence evidence applies.

```text
Total features audited: 109
Complete real: 56
Complete local-only: 5
Partial working: 14
UI-only namesake: 3
Backend-only unused: 6
Broken: 5
Security risk: 6
Misleading: 5
Intentionally not supported: 5
Future roadmap: 4
```

Readiness verdict: Apex OS has a real operational core for authentication, tickets, leave, workday, dashboards, settings persistence, attachments, calendar ticket/leave views, and activity logging. It is not production-ready for a full P1-9 smoke until the P0/P1 items in the status board are fixed, especially socket data scoping, AI endpoint scoping, project ID route parsing, notification mark-read/delete, and forgot-password OTP delivery.

## Classification Legend

| Code | Classification | Meaning |
|---|---|---|
| A | COMPLETE_REAL | End-to-end UI, API, backend, DB, RBAC, persistence, and required logging/reporting are real. |
| B | COMPLETE_LOCAL_ONLY | Intentionally browser/local-only and reasonably clear. |
| C | PARTIAL_WORKING | Some real behavior exists, but expected parts are missing or incomplete. |
| D | UI_ONLY_NAMESAKE | UI suggests a feature, but no real backend/data workflow exists. |
| E | BACKEND_ONLY_UNUSED | Backend/API/model exists, but no usable frontend surface exists. |
| F | BROKEN | Intended workflow currently fails. |
| G | SECURITY_RISK | Data leak, missing guard, privilege issue, or sensitive behavior gap. |
| H | MISLEADING | Does something, but communicates the wrong product truth. |
| I | INTENTIONALLY_NOT_SUPPORTED | Not implemented and should not appear as operational. |
| J | FUTURE_ROADMAP | Planned/aspirational capability outside the current operational system. |

## Evidence Sources

Primary code evidence:

- Frontend route tree: `frontend/app/**/page.tsx`
- Navigation: `frontend/components/layout/sidebar.tsx`, `frontend/components/layout/topbar.tsx`
- API client: `frontend/lib/api.ts`
- Auth store and route protection: `frontend/store/auth.store.ts`, `frontend/app/(dashboard)/layout.tsx`
- Backend controllers and services under `backend/src/modules/**`
- Shared access policies: `backend/src/common/services/access-policy.service.ts`, `backend/src/common/services/ticket-access.service.ts`, `backend/src/common/services/leave-access.service.ts`, `backend/src/shared/guards/roles.guard.ts`
- Event logging: `backend/src/common/services/event-logger.service.ts`, `backend/src/modules/platform/events/events.controller.ts`
- Database schema: `backend/prisma/schema.prisma`
- Existing test/doc evidence: `backend/test/**`, `e2e/tests/**`, `docs/CALENDAR_REAL_WORLD_AUDIT.md`, `docs/ROLE_VISIBILITY_AUDIT.md`, `docs/E2E_BROWSER_WORKFLOW_REPORT.md`, `docs/DASHBOARD-DATA-AUDIT.md`, `docs/RULES-INTEGRATIONS-AUDIT.md`

Existing P1 evidence included:

```text
P1-4 Settings: complete
P1-5 Attachments: complete
P1-6 Calendar: complete
P1-7 Role visibility: complete
P1-8 Browser E2E: complete
P1-9 Production smoke: pending / separate
```

## Feature Matrix

| Module | Feature | UI Route | Frontend | API | Backend | DB | RBAC | Logging | Dashboard/Reports | Status | Evidence | Issue | Priority | Fix |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Authentication | Login, JWT creation, current user load | `/login` | `login/page.tsx`, auth store | `POST /auth/login`, `GET /auth/me` | `AuthController`, `AuthService`, `JwtStrategy` | `User`, `Role`, `Department`, `WorkSession`, `AttendanceEvent` | JWT plus inactive-user rejection | `USER_LOGIN` | Workday status starts session | A | Login stores token, `/me` guarded, inactive users rejected | None found in core path | KEEP | Keep |
| Authentication | Invalid credentials and rate limiting | `/login` | Error toast | `POST /auth/login` | ThrottlerGuard plus explicit login throttle | `User` | Public login only | No success log on failure | No | A | Invalid password throws unauthorized; global throttling present | Dev throttle is looser than prod by design | KEEP | Keep |
| Authentication | Logout | Topbar/sidebar menus | Clears local token/store, warns if workday active | No server logout endpoint | Client-only | `WorkSession` remains until end day/auto-close | Local only | No `USER_LOGOUT` event | Workday may still show active | C | Sidebar/topbar clear storage only | Logout is not audit-logged and does not end workday | P2 / S | Add optional logout endpoint/event or document stateless logout |
| Authentication | Forgot password and OTP reset | `/forgot-password` | Email, OTP, new password form | `POST /auth/forgot-password`, `POST /auth/reset-password` | `AuthService.sendOtp`, `resetPasswordWithOtp` | `User`; OTP in memory | Public endpoints | No operational event | No | F | OTP is stored in memory; TODO says SMTP send is not wired | Production users cannot receive OTP; unknown email reveals account existence | P1 / M | Wire OTP to `EmailService`, avoid user enumeration, add audit event |
| Authentication | Forced password change | `/change-password` | Current/new password form | `PATCH /auth/change-password` | `AuthService.changePassword` | `User.mustChangePassword` | JWT | Not logged | No | A | Login redirects when `mustChangePassword` is true | Password change audit logging absent but workflow works | P3 / XS | Add audit event later |
| Authentication | Role chooser | `/select-mode` | Local `apexMode` switch | None | None | LocalStorage | Client-only | No | Nav only | B | Super admin selector changes visible nav only | Local mode is not backend impersonation | KEEP | Keep as local view mode |
| Authentication | Super admin team-lead mode scope | `/select-mode`, sidebar | Hardcoded team-lead mode text and nav | Same super admin token | Backend still sees `SUPER_ADMIN` | None | Not downgraded | No | Nav only | H | Backend RBAC uses JWT role, not `apexMode` | UI implies scoped team-lead operation while API remains super admin | P1 / M | Either label as view mode only or implement server-side scoped impersonation |
| Authentication | Welcome/onboarding flow | `/welcome` | Local `apexWelcomeSeen` | None | None | LocalStorage | Client-only | No | No | B | Does not block valid login after seen | Feature claims include AI/smart automation not fully real | P2 / XS | Keep local flow, remove unsupported claims |
| Authentication | Protected routes and invalid token behavior | Dashboard layout | Client auth guard plus axios 401 handler | All guarded APIs | JwtAuthGuard | User active state | Backend enforced | No | No | A | 401 clears local token and redirects to login | Frontend guard is convenience only | KEEP | Keep |
| User Management | User list, search, role/department filters | `/users` | Users page | `GET /users` | `UsersService.findAll` | `User`, `Role`, `Department` | Service scoping plus admin UI | No read event | User counts | A | Sensitive fields stripped from broad results | None found | KEEP | Keep |
| User Management | Create, edit, deactivate users | `/users` | Create/edit forms | `POST /users`, `PUT /users/:id`, `DELETE /users/:id` | `UsersController`, `UsersService` | `User` | Admin/Super admin route guard | User create/update/deactivate events | User stats | A | Writes persist and emit operational events | No hierarchy check; see separate risk row | KEEP | Keep with hierarchy fix |
| User Management | Admin role update hierarchy | `/users` | Admin can change role | `PUT /users/:id` | `UsersService.update` | `User.roleId` | Admin and Super admin both allowed | `USER_ROLE_CHANGED` | Role-scoped dashboards impacted | G | No check prevents an ADMIN from editing higher/equal privilege accounts | Privilege boundary can be changed by non-super admin | P1 / M | Enforce role hierarchy for role/status/reset/deactivate |
| User Management | Reset user password | `/users` | Admin action surface | `PUT /users/:id/reset-password` | `UsersService.resetPassword` | `User.password`, `mustChangePassword` | Admin/Super admin | No operational event found | No | C | Backend persists temp password and forces change | Missing audit event and hierarchy check | P1 / S | Add event and hierarchy guard |
| Employee Profiles | Profile summary and tabs | `/users/:id`, `/users/:id/profile`, `/profile` | Profile pages | `GET /users/:id/profile`, related list APIs | `UsersService.getProfile` | `User`, `EmployeeDocument`, `Ticket`, `Project`, `LeaveRequest` | `AccessPolicyService` | Sensitive view uses legacy ActivityLog | User/profile dashboards | A | Payroll/doc fields masked by role and self/admin rules | Legacy and operational audit streams differ | P2 / S | Move sensitive access logging into OperationalEvent too |
| Employee Profiles | Self personal profile edit | `/settings`, `/users/:id/profile` | Profile settings and profile page | `PATCH /users/me`, `PATCH /users/:id/profile` | `UsersService.updateMe`, `updateProfile` | `User` | Self field allowlist | User update event for admin path | No | A | Self updates limited personal fields | None found | KEEP | Keep |
| Employee Profiles | Payroll/statutory fields | `/users/:id/profile` | Admin/HR profile tabs | `GET/PATCH /users/:id/profile` | `AccessPolicyService`, `UsersService` | Payroll/statutory fields on `User` | Admin/HR/full, self masked, managers restricted | Legacy `VIEW_PAYROLL_DATA` | No | A | Broad list strips sensitive fields | Logging stream inconsistency | P2 / S | Standardize audit logging |
| Profile Photos | Upload and remove profile photo | `/settings` | ProfileSection | `POST /users/me/photo`, `DELETE /users/me/photo` | `UsersService.uploadPhoto/removePhoto` | `User.photoUrl` base64 | Self JWT | `PHOTO_UPLOADED`, `PHOTO_REMOVED` | Avatar surfaces | A | Upload/remove persists and logs | Base64 storage should remain documented | KEEP | Keep |
| Employee Documents | Upload, view, delete employee docs | `/users/:id/profile`, `/users/:id` | Document panels | `POST/GET/DELETE /users/:id/documents` | `UsersService` | `EmployeeDocument.fileUrl` | AccessPolicyService document permissions | Upload/delete operational events | Profile doc counts | A | Permission-scoped API and base64/cloud fallback | Direct data URL is returned after authorization | KEEP | Keep |
| Employee Documents | Verify/reject documents | `/users/:id/profile` | Verification controls | `PATCH /users/:id/documents/:docId/verify` | `UsersService.verifyDocument` | `EmployeeDocument.verified*` | HR/Admin/Super admin | Legacy ActivityLog only | Profile status | C | Backend and UI exist | Not logged to OperationalEvent | P2 / S | Add operational event |
| Departments | Department list/detail/stats | `/departments`, `/departments/:id` | Department pages | `GET /departments`, `GET /departments/:id` | `DepartmentsService` | `Department`, `User`, `Ticket`, `Project`, `LeaveRequest` | Admin/Super admin only | No read event | Department stats | A | Counts derive from DB | Manager project forms cannot use this API; see project row | KEEP | Keep as admin module |
| Departments | Create/update/delete department | `/departments` | Forms/buttons | `POST/PUT/PATCH/DELETE /departments/:id` | `DepartmentsService` | `Department` | Admin/Super admin | No operational events | Dashboard scoping affected | C | Delete blocks active-ticket departments | Missing event logging for org-structure changes | P2 / S | Add department create/update/delete events |
| Departments | Department lead and member reassignment | `/departments/:id` | Member table and lead controls | `PUT /users/:id` | `UsersService.update` | `User.departmentId`, `User.roleId` | Admin/Super admin | User update/role events | Department stats | A | Persists by user update | Hierarchy guard still needed | P1 / M | Covered by user hierarchy fix |
| Team Management | Company directory | `/team` | Directory tab | `GET /users/directory`, `GET /users` | `UsersService.getDirectory/findAll` | `User`, `Department`, `Role` | Manager/Admin/Super for directory, list scoped | No read event | Team views | A | Returns scoped users | None found | KEEP | Keep |
| Team Management | My team | `/team` | My team tab | `GET /users/my-team` | `UsersService.getMyTeam` | `User.departmentId` | JWT and role/department scope | No | Team page | A | Employee/team scoping is real | None found | KEEP | Keep |
| Team Management | Live team status | `/team` | Live status tab | `GET /workday/team` | `WorkdayService.getTeamStatus` | `User.currentStatus`, `WorkSession` | Employee/intern receive empty; lead+ scoped | No | Dashboard/team | A | P1-8 verifies employee cannot see live status tab | None found | KEEP | Keep |
| Team Management | Request member addition | `/team` | Request button plus local pending state | `POST /team/request` | `TeamService.sendTeamRequest` | `Notification` only | JWT | Notification created | No | D | No TeamRequest model or approve/reject workflow exists | UI says manager will approve/reject, but only a notification is sent | P1 / M | Disable UI or build real request lifecycle |
| Tickets / Tasks | Ticket list, search, filters | `/tickets` | Ticket list page | `GET /tickets`, `GET /tickets/stats` | `TicketsService.findAll/getStats` | `Ticket`, relations | `TicketAccessService` scoping | Export only logs | Dashboard counts | A | Scoped list and stats are DB-backed | None found | KEEP | Keep |
| Tickets / Tasks | Create ticket basic fields | `/tickets/new` | Create form | `POST /tickets` | `TicketsService.create` | `Ticket`, `TicketAssignee`, `TaskType`, `TaskSubtype` | Creation/assignment rules | ActivityLog and OperationalEvent | Dashboard/list/kanban/calendar | A | Persists title, department, assignees, dates, project link, task subtype | None found | KEEP | Keep |
| Tickets / Tasks | Custom ticket type | `/tickets/new` | `CUSTOM` type input | `POST /tickets` | Prisma enum write | `Ticket.type` enum | Same as create | No because create fails | No | F | UI sends arbitrary text or `CUSTOM`; Prisma enum has no matching custom enum | Create fails for custom type | P1 / S | Remove custom type UI or map to supported enum plus separate custom field |
| Task Types / Subtypes | Task type/subtype usage on tickets | `/tickets/new`, ticket detail | Selects department task types | `GET /task-types`, ticket create/update | `TaskTypesService`, `TicketsService` | `TaskType`, `TaskSubtype`, `Ticket.taskTypeId` | Read endpoint currently open; write admin only | Ticket events only | Reports by type possible | C | Subtypes and custom subtype text persist | Read endpoint security and settings logging gaps | P1 / S | Guard read endpoint and log admin changes |
| Tickets / Tasks | AI priority suggestion | `/tickets/new` | AI button | `POST /ai/suggest-priority` | `AiService.suggestPriority` | None | JWT | No | No | C | Graceful disabled state without key | Optional, no fake output, but not core workflow | P3 / XS | Keep optional and label clearly |
| Tickets / Tasks | Ticket detail and edit | `/tickets/:id` | Detail/edit form | `GET/PUT/PATCH /tickets/:id` | `TicketsService.findOne/update` | `Ticket` and relations | `TicketAccessService` | TicketHistory, ActivityLog, OperationalEvent | Dashboard/list/kanban | A | Scoped direct access and update rules exist | None found | KEEP | Keep |
| Tickets / Tasks | Assignment | `/tickets/:id`, `/tickets/new` | Assignment controls | `PATCH /tickets/:id/assign`, create body | `TicketsService.assign/update` | `assignedToId`, `TicketAssignee` | Assignment scope rules | Assignment event and notifications | Workload/dashboard | A | Enforces manager/TL/user scope | None found | KEEP | Keep |
| Tickets / Tasks | Status transitions, start work, review, done | `/tickets/:id`, `/kanban` | Status buttons/drag | `PATCH /tickets/:id/status`, approve/reject | `TicketsService`, `TicketTimingService` | Status/timer fields | Transition rules by role | TicketHistory, OperationalEvent | Counts/kanban/SLA | A | Unit and E2E coverage exists | None found | KEEP | Keep |
| Ticket Blocking | Block/unblock ticket | `/tickets/:id` | Block modal/buttons | `POST /tickets/:id/block`, `POST /tickets/:id/unblock` | `TicketsService.block/unblock` | `isBlocked`, block fields | Assignee or scoped manager, not intern | OperationalEvent and notifications | SLA excludes blocked | A | Blocked-ticket unit tests cover timers/stats | None found | KEEP | Keep |
| Ticket SLA / Timers | Execution/review timers and overdue | Ticket list/detail/dashboard | Timer badges | Ticket stats/SLA risk APIs | `TicketTimingService` | Timer and review fields | Scoped through ticket APIs | Status events | Dashboard, SLA risk | A | SLA uses AppSetting values and blocked pause | None found | KEEP | Keep |
| Ticket Comments | Create/list comments | `/tickets/:id` | Embedded comment list/create | `GET/POST /tickets/:ticketId/comments` | `CommentsService` | `Comment` | Ticket access plus author | ActivityLog and OperationalEvent on create | Activity feed | A | Comment create sends notifications | None found | KEEP | Keep |
| Ticket Comments | Edit/delete comments | No visible controls found | API client exists | `PUT/DELETE /tickets/:ticketId/comments/:id` | `CommentsService.update/remove` | `Comment` | Author/admin rules | No edit/delete event | No | E | Backend exists; UI imports only create | Unused backend capability | P3 / XS | Document-only or add UI later |
| Ticket Attachments | Upload, view/download, delete | `/tickets/:id` | Attachment panel | `POST/GET/DELETE /tickets/:id/attachments` | `TicketsController`, `UploadsService` | `Attachment` | TicketAccessService | Upload/delete events | Attachment counts | A | P1-5 and unit tests cover scoped access | Cloudinary remote object delete is not implemented | P3 / S | Document storage cleanup limitation |
| Ticket History | History/activity timeline | `/tickets/:id`, `/admin/activity` | History UI | `GET /tickets/:id/history`, `/events` | `TicketsService`, `EventsController` | `TicketHistory`, `OperationalEvent` | Ticket/event scope | Yes | Activity page | A | Status/assign/priority/title changes captured | Some comment edit/delete missing events | P3 / S | Add missing event types later |
| Tickets / Tasks | Project-linked tickets | Ticket create/detail, project page | Project select/filter | `projectId` in ticket APIs | `TicketsService`, `ProjectsService` | `Ticket.projectId` | Ticket and project scoping | Ticket events | Project progress/counts | A | Project links persist and affect progress | Project detail route is broken separately | P1 / S | Fix project ID route parsing |
| Tickets / Tasks | Due date and scheduled date | Ticket create/detail/calendar | Date fields | Ticket create/update/list | `TicketsService`, `SchedulerService` | `dueDate`, `scheduledFor` | Ticket scope | Ticket events | Calendar/dashboard/SLA | A | Calendar maps due/scheduled ticket dates | None found | KEEP | Keep |
| Tickets / Tasks | Recurring tickets | Ticket create scheduled section | Recurrence controls | Ticket create/update fields | `SchedulerService` | `scheduleRecurring`, `scheduleEndDate` | Ticket scope | Scheduler side effects | Notifications/tickets | C | Fields and scheduler exist | No clear UI surface to inspect generated recurrence or manage series | P2 / M | Add recurrence management or document limits |
| Tickets / Tasks | Kanban | `/kanban` | Board/drag columns | `GET /tickets/kanban`, status update | `TicketsService.getKanban/updateStatus` | `Ticket.status` | Ticket scope and transition rules | Status events | Dashboard invalidation | A | P1-8 covers board access | None found | KEEP | Keep |
| Exports | Ticket CSV export | `/tickets`, `/analytics` | Export buttons | `GET /tickets/export` | `TicketsService.exportCsv` | `Ticket` scoped query | TicketAccessService | `EXPORT_PERFORMED` | Analytics | A | CSV escapes fields and respects scope | Other export types unsupported | KEEP | Keep ticket export only |
| Projects | Project list | `/projects` | Project cards/list | `GET /projects`, `GET /projects/stats` | `ProjectsService.findAll/getStats` | `Project`, `ProjectMember`, `Ticket` | Project scope | No read event | Dashboard active projects | A | Scoped list works without ID pipe | None found | KEEP | Keep |
| Projects | Project create | `/projects` | Create modal | `POST /projects` | `ProjectsService.create` | `Project`, optional owner/member | Manager/Admin/Super | `PROJECT_CREATED` | Dashboard active projects | C | Backend create is real | UI needs `GET /departments`, which is admin-only, so manager create flow can fail | P1 / S | Provide scoped department selector endpoint or adjust allowed creators |
| Projects | Project detail | `/projects/:id` | Detail page | `GET /projects/:id` | Controller uses `ParseUUIDPipe` | `Project` uses cuid IDs | Project scope in service | No because request fails | Project progress | F | Prisma IDs are cuid, but controller rejects non-UUID params | Detail route fails for real project IDs | P1 / XS | Remove UUID pipe or accept cuid/projectId |
| Projects | Project edit/delete | `/projects/:id` | Edit/delete controls | `PUT/DELETE /projects/:id` | Controller uses `ParseUUIDPipe` | `Project` | Service has scope checks | No because request fails | Dashboard | F | Same cuid vs UUID mismatch | Edit/delete fail for real IDs | P1 / XS | Fix ID parsing |
| Project Members | Add/remove members | `/projects/:id` | Member controls | `POST /projects/:id/members`, `DELETE /projects/:id/members/:userId` | Controller uses UUID pipe for project/user | `ProjectMember` | Service checks project scope | No because request fails | Project team | F | User/project IDs are cuid, not UUID | Member management fails | P1 / XS | Fix ID parsing |
| Projects | Owner/status/priority/progress | `/projects`, `/projects/:id` | Project metadata/progress | Project APIs | `ProjectsService` | `Project`, linked `Ticket` | Project scope | Project update events when route works | Dashboard | C | Progress logic from linked tickets is real | Detail/edit paths broken by controller pipe | P1 / XS | Fix ID parsing |
| Projects | Project activity | `/projects/:id` | Activity tab | `GET /events` filtered client-side | `EventsController` | `OperationalEvent` | Event scoping | Yes | Activity | C | API is real and scoped | Client filters recent events after broad fetch; detail route broken | P2 / S | Add server-side entity filter and fix detail |
| Projects | Project deadlines on calendar | Calendar route | No project event mapping | None | None | `Project.endDate` exists | N/A | N/A | Calendar | I | Calendar only maps ticket and leave events | Project deadlines are not calendar events | DOCUMENT_ONLY | Keep documented unsupported |
| Leave Management | Apply leave | `/leave` | Apply form | `POST /leave` | `LeaveService.create` | `LeaveRequest` | JWT self | `LEAVE_REQUESTED`, notifications | Dashboard pending leave, calendar after approval | A | Balance and overlap validation run | None found | KEEP | Keep |
| Leave Management | My requests, all requests, needs action | `/leave` | Tabs/filters | `GET /leave`, `GET /leave/stats` | `LeaveService.findAll/getStats` | `LeaveRequest` | `LeaveAccessService` | No read event | Dashboard counts | A | Employee sees own; approvers scoped | None found | KEEP | Keep |
| Leave Approval | Approve/reject leave | `/leave` | Action buttons | `PATCH /leave/:id/approve`, `PATCH /leave/:id/reject` | `LeaveService.approve/reject` | `LeaveRequest.status` | Role hierarchy and department scope | Operational events, notifications | Dashboard/calendar | A | No self-approval; cuid IDs work | Rejection reason is not stored, UI states this honestly | P3 / S | Optional reason persistence later |
| Leave Management | Cancel leave | No visible action found | API client exists | `PATCH /leave/:id/cancel` | `LeaveService.cancel` | `LeaveRequest.status` | Owner pending only | `LEAVE_CANCELLED` | Dashboard/calendar | E | Backend/API/client exist | User cannot cancel from UI | P2 / S | Add cancel button for pending own leave or document unused |
| Leave Policy | Leave balance and quotas | `/leave`, `/settings` | Balance cards, policy settings | `GET /leave/balance`, settings API | `LeaveBalanceService`, `SettingsService` | `LeaveRequest`, `AppSetting.leave_policy` | User/approver scope; admin settings write | Settings events | Dashboard pending leave | A | Quotas persist through AppSetting | Holiday calendar is hardcoded for 2026 | P2 / M | Add configurable holiday calendar |
| Leave Management | Overlap and balance validation | `/leave` | Form submit feedback | `POST /leave` | `LeaveBalanceService.validateLeaveRequest` | `LeaveRequest` | JWT self | Failed attempts not logged | No | A | Unit tests cover overlap/insufficient balance | None found | KEEP | Keep |
| Leave Management | Leave calendar mapping | `/calendar` | FullCalendar events | `GET /leave` | `LeaveService.findAll` | `LeaveRequest` | LeaveAccessService | No | Calendar | A | Approved leaves are role-scoped and inclusive end is handled | None found | KEEP | Keep |
| Workday Tracking | Start workday, break, resume, end | Workday bar/dashboard/team | Workday controls | `/workday/start`, `/break/start`, `/break/end`, `/resume`, `/end` | `WorkdayService` | `WorkSession`, `BreakLog`, `AttendanceEvent`, `User.currentStatus` | JWT self | Start/break/end events | Dashboard/team status | A | End day closes open breaks and persists summary | Resume event not logged to OperationalEvent | P2 / S | Add resume/idle events |
| Workday Tracking | Idle detection | Workday client and API | Idle report/resume | `POST /workday/idle`, `/resume` | `WorkdayService.reportIdle/resumeWork` | `AttendanceEvent`, `User.currentStatus` | JWT self | AttendanceEvent only | Team live status | C | Status changes persist | Missing OperationalEvent and limited direct API guard against repeated open breaks | P2 / S | Add logging and server-side state guards |
| Attendance | Attendance/history page | Profile/team snippets only | No standalone attendance route | `GET /workday/history/:userId` | `WorkdayService.getHistory` | `WorkSession`, `AttendanceEvent` | Self/manager/TL/admin scope | Workday events | Dashboard preview | C | Records persist and history API exists | No dedicated attendance page despite module name | P2 / M | Build or document as workday history only |
| Calendar | Ticket and leave calendar | `/calendar` | FullCalendar composite | `GET /tickets`, `GET /leave` | Ticket and Leave services | `Ticket`, `LeaveRequest` | Source API scoping | No extra log | Calendar | A | P1-6 confirms date handling and role scope | No standalone calendar backend model | KEEP | Keep composite model |
| Calendar | Scheduled tickets and due dates | `/calendar` | Ticket event mapping | Ticket list API | `TicketsService.findAll` | `Ticket.dueDate`, `scheduledFor` | Ticket scope | No | Calendar | A | Dates normalized to avoid shift | None found | KEEP | Keep |
| Calendar | Event drilldown | `/calendar` | Event links/clicks | Source item routes | Frontend route navigation | Source models | Source API scoping on detail | No | Calendar | C | Ticket drilldown is real; leave has no dedicated detail page | Leave drilldown is limited to list context | P2 / S | Add scoped leave detail route or document limitation |
| Calendar | Partial failure warnings | `/calendar` | Warning banner | Source query errors | Frontend handling | N/A | N/A | No | Calendar | A | UI does not silently show fake zero on partial failure | None found | KEEP | Keep |
| Notifications | Notification bell/list/unread count | Topbar | Polling plus socket refresh | `GET /notifications`, `/unread-count` | `NotificationsService` | `Notification` | Own-user only | No read event | Bell count | A | List and count are scoped to current user | None found | KEEP | Keep |
| Notifications | Mark all read | Topbar | Menu action | `PATCH /notifications/mark-all-read` | `NotificationsService.markAllRead` | `Notification.read` | Own-user only | No | Bell count | A | Cuid-safe endpoint, persists read state | No audit needed | KEEP | Keep |
| Notifications | Mark single read and delete | Topbar/API client | Click marks read; delete API unused | `PATCH /notifications/:id/read`, `DELETE /notifications/:id` | Controller uses `ParseUUIDPipe` | `Notification.id` is cuid | Own-user service check after pipe | No | Bell count | F | Controller rejects real cuid IDs before service | Single read/delete fail for real notifications | P1 / XS | Remove UUID pipe |
| Notifications | Notification creation and preferences | Ticket/leave/comment/project actions | Preferences settings | Notification events | `NotificationEventService` | `Notification`, `AppSetting.user-prefs-*` | Recipients chosen by service | Source action events | Bell/socket/email | A | Quiet hours and disabled preferences respected | Recipient correctness depends on source workflows | KEEP | Keep |
| Activity Logs | Activity page | `/admin/activity` | Event table/filter | `GET /events` | `EventsController`, `EventLoggerService` | `OperationalEvent` | Role-scoped event visibility | Source events | Activity dashboard | A | P1-8 super admin audit flow exists; integration tests cover scoping | Some modules still use legacy only | P2 / M | Migrate missing events to OperationalEvent |
| Audit Trail | Separate audit trail product surface | `/admin/activity` only | No separate audit module | `/events` | Events controller | `OperationalEvent`, legacy `ActivityLog` | Scoped | Partial | Activity only | C | Operational event feed is real | Legacy ActivityLog and OperationalEvent are split | P2 / M | Consolidate audit model or document two-layer audit |
| Realtime / Socket.IO | User notification realtime | Topbar socket hook | `notification:new`, `leave:status_changed` | Gateway user room | `EventsGateway` | `Notification` | JWT socket auth, user rooms | Source events | Bell refresh | A | User-specific emits use `user:${id}` rooms | None found | KEEP | Keep |
| Realtime / Socket.IO | Ticket realtime broadcasts | Ticket list/detail invalidation | `ticket:created`, `ticket:status_changed` | Gateway broadcasts globally | `EventsGateway` | `Ticket` payload | Socket auth only, no role room scope | No | Dashboards/list refresh | G | `server.emit` sends ticket created/status payloads to all connected clients | Cross-scope ticket metadata can leak over socket | P0 / M | Emit only to authorized user/role/department rooms or payload-minimize |
| Dashboard | Dashboard cards and previews | `/dashboard` | Dashboard page | `/dashboard/overview`, `/home/summary`, SLA risk | `DashboardService` | Ticket, Project, Leave, WorkSession, User | Access services | No read event | Dashboard | A | Counts are scoped and DB-backed; failures show warning/blank, not fake zero | None found | KEEP | Keep |
| Dashboard | Dashboard drilldowns and quick actions | `/dashboard` | Cards/quick action palette | Source list routes | Frontend navigation | Source models | Source APIs enforce scope | No | Dashboard to modules | A | Links route to scoped lists | Some unsupported quick claims should stay factual | KEEP | Keep |
| Analytics / Reports | Analytics charts and ticket export | `/analytics` | Charts/tables/export | Dashboard chart APIs and ticket export | `DashboardService`, `TicketsService` | Ticket/Project/Leave/User | Scoped API data | Export event | Analytics | A | Charts use real API data | No advanced report builder | KEEP | Keep analytics |
| Analytics / Reports | Reports route | `/reports` | Redirect page | None | None | None | N/A | No | Analytics | C | Redirects to `/analytics` | No separate reports product exists | P3 / XS | Keep redirect or remove nav if unused |
| Exports | Non-ticket exports | No visible dedicated export | None found | None | None | N/A | N/A | N/A | Reports | I | Only ticket CSV export is implemented | User/project/leave/project exports unsupported | DOCUMENT_ONLY | Document only |
| Settings | Notification preferences | `/settings` | Preferences form | `GET/PATCH /users/me/preferences` | `UsersService`, `NotificationEventService` | `AppSetting.user-prefs-*` | Self | Settings write through user prefs not EventLogger | Notifications | A | Preferences persist and drive notification sending | Fallback local save is clearly messaged | KEEP | Keep |
| Settings | Ticket preferences | `/settings` | Auto-assign/default priority controls | `GET/PATCH /users/me/preferences` | `UsersService` stores values | `AppSetting.user-prefs-*` | Self | No | Intended ticket creation | H | Values persist, but ticket create page does not read/apply them | UI implies operational defaults that are not used | P1 / S | Apply preferences in ticket create or relabel/remove controls |
| Appearance Preferences | Per-user local theme/accent | `/settings` | Appearance settings | LocalStorage; company defaults optional | `useTheme`, settings company defaults | LocalStorage and `AppSetting.theme_defaults` | Local self; admin for defaults | Settings event for company only | UI only | B | Local-only/device language is explicit | Company theme default logging bypasses `settings.set` path | P3 / XS | Add event for theme defaults later |
| Company Settings | Company info/defaults | `/settings` | Company tab | `GET/PATCH /settings/company` | `SettingsService` | `AppSetting.company`, `theme_defaults` | Read any auth; write Admin/Super | `SETTINGS_UPDATED` for company | Branding/settings | A | Persists after refresh/logout | Theme defaults separately stored | KEEP | Keep |
| Leave Policy Settings | Leave quotas/working days | `/settings` | Policy tab | `GET/PATCH /settings/leave-policy` | `SettingsService`, `LeaveBalanceService` | `AppSetting.leave_policy` | Read any auth; write Admin/Super | `SETTINGS_UPDATED` | Leave balance | A | Quotas drive balance service | Public holidays not configurable | P2 / M | Add holiday settings later |
| SLA Settings | Execution/review SLA | `/settings` | SLA tab | `GET/PATCH /settings/sla` | `SettingsService`, `TicketTimingService` | `AppSetting.sla`, `review_sla` | Read any auth; write Admin/Super | `SETTINGS_UPDATED` | SLA/dashboard | A | SLA values drive ticket timing | None found | KEEP | Keep |
| SMTP / Email Settings | SMTP config and test email | `/settings` | SMTP tab | `GET/PATCH /settings/smtp`, `POST /settings/email/test` | `SettingsController`, `EmailService` | `AppSetting.smtp` | Super admin only | `SETTINGS_UPDATED` | Email notifications | A | EmailService loads persisted SMTP settings and test email uses them | Optional integration; emails skipped if not configured | KEEP | Keep |
| Task Types / Subtypes | Task type admin settings | `/settings` | Task type tab | `GET /task-types/all`, create/delete/update APIs | `TaskTypesService` | `TaskType`, `TaskSubtype` | Admin/Super for admin endpoints | No operational events | Ticket creation | C | Create/delete visible; update API exists | No audit logging and edit/reorder UI incomplete | P2 / S | Add events and complete edit surface |
| Task Types / Subtypes | Public task type read endpoint | Ticket create | `taskTypesApi.getByDepartment` | `GET /task-types` | `TaskTypesController` | `TaskType`, `TaskSubtype` | No JWT guard | No | Ticket create | G | Endpoint is unauthenticated | Internal taxonomy and department-linked metadata exposed | P1 / XS | Add JwtAuthGuard and role/scope filtering |
| Security Settings | Change password from settings | `/settings` | Security tab | `PATCH /auth/change-password` | `AuthService.changePassword` | `User.password`, `mustChangePassword` | JWT self | No | No | A | Validates current password and length | Missing audit event | P3 / XS | Add password-change event |
| Public Site | Public landing claims/stats | `/` | Marketing page | None | None | None | Public | No | No | H | Hardcoded 40 employees, 11 departments, AI powered, smart assignment claims | Public page overstates current implementation | P2 / XS | Replace with factual product status or remove claims |
| Legal Pages | Privacy and terms pages | `/privacy`, `/terms` | Static pages | None | None | None | Public | No | No | B | Static content only | Legal accuracy not audited | P3 / S | Legal review separately |
| AI Features | Ticket-specific suggestions | `/tickets/:id` | Suggestions panel | `POST /ai/ticket-suggestions/:id` | `AiService.ticketSuggestions` | `Ticket`, comments | JWT only; no TicketAccessService | No | No | G | Service fetches ticket by id/ticketId without scope check | Any authenticated user with an ID can request AI summary context | P0 / M | Inject TicketAccessService and authorize before AI read |
| AI Features | Ticket summary and daily digest | API only/admin trigger | No primary UI except trigger API | `POST /ai/summarize-tickets`, `/trigger-digest` | `AiService`, `AiCronService` | `Ticket`, `LeaveRequest`, `User` | Role guard but no department scoping | No | Email digest | G | Manager summary/digest queries global tickets/leaves | Managers can receive data outside their scope | P1 / M | Scope summaries/digests per recipient |
| AI Features | Smart assignment / agents | Landing/welcome copy only | Copy claims | None | None | None | N/A | N/A | N/A | D | No assignment engine was found | UI/marketing namesake only | P2 / XS | Remove claim or move to roadmap |
| Future Roadmap | CRM, workflow builder, marketplace, mobile app | None found as real modules | Not implemented | None | None | None | N/A | N/A | N/A | J | No route/controller/model found | Roadmap only | ROADMAP | Keep out of operational UI |

## Route And Navigation Coverage

### Frontend Routes

| Route | Page/component | Module | Roles/visibility | Status | Notes |
|---|---|---|---|---|---|
| `/` | `frontend/app/page.tsx` | Public landing | Public | H | Hardcoded stats and AI claims are not source-of-truth. |
| `/login` | `frontend/app/(auth)/login/page.tsx` | Auth | Public | A | Real login and redirect logic. |
| `/forgot-password` | `frontend/app/(auth)/forgot-password/page.tsx` | Auth | Public | F | OTP cannot be delivered in production. |
| `/change-password` | `frontend/app/(auth)/change-password/page.tsx` | Auth | Authenticated redirected users | A | Real forced password flow. |
| `/welcome` | `frontend/app/(auth)/welcome/page.tsx` | Onboarding | Authenticated | H | Local-only welcome works, but copy overclaims AI. |
| `/select-mode` | `frontend/app/(auth)/select-mode/page.tsx` | Auth mode selector | Super admin | H | Local nav mode only, not server-side impersonation. |
| `/dashboard` | Dashboard page | Dashboard | All authenticated | A | Scoped metrics and warnings. |
| `/tickets` | Tickets list | Tickets | All authenticated | A | Scoped list, filters, export. |
| `/tickets/new` | Create ticket | Tickets | All authenticated with service rules | F | Basic create works; custom type fails. |
| `/tickets/:id` | Ticket detail | Tickets | Scoped by backend | A | Detail/edit/history/comments/attachments real. |
| `/kanban` | Kanban page | Tickets | All authenticated | A | Scoped columns and transition rules. |
| `/projects` | Projects list | Projects | All authenticated; create lead+ | C | List works; manager create has department API mismatch. |
| `/projects/:id` | Project detail | Projects | Scoped by backend intended | F | Cuid rejected by UUID pipe. |
| `/leave` | Leave page | Leave | All authenticated | C | Apply/approval real; cancel API has no UI. |
| `/calendar` | Calendar page | Calendar | All authenticated | C | Tickets/leaves real; project deadlines unsupported. |
| `/team` | Team page | Team | Team lead+ nav; route load still scoped | C | Directory/live status real; request workflow namesake. |
| `/analytics` | Analytics page | Analytics | Manager+ nav; APIs scoped | A | Real charts and ticket export. |
| `/reports` | Redirect page | Reports | Platform route | C | Redirects to `/analytics`; no separate reports module. |
| `/users` | Users page | User management | Admin/Super nav and backend writes | G | Core works; hierarchy guard missing. |
| `/users/:id` | User operational profile | Employee profile | Scoped by APIs | A | Uses profile, tickets, projects, leave, docs, workday. |
| `/users/:id/profile` | Full employee profile | Employee profile | Scoped by APIs | C | Profile/docs real; doc verification logging partial. |
| `/departments` | Department list | Departments | Admin/Super backend | C | CRUD real but missing department events. |
| `/departments/:id` | Department detail | Departments | Admin/Super backend | C | Members and stats real; department logging gap remains. |
| `/admin/activity` | Activity events | Activity/Audit | Team lead+ nav and scoped backend | C | Real OperationalEvent feed; not a separate full audit product. |
| `/profile` | Own profile redirect/surface | Profile | Authenticated | A | Uses scoped own profile/dashboard data. |
| `/settings` | Settings | Settings | All; tabs gated by role | G | Core settings real; ticket prefs misleading; task-types open read. |
| `/privacy`, `/terms` | Static legal pages | Static | Public | B | Static informational pages. |

### Sidebar/Nav Items And Quick Actions

| Surface | Items | Status | Notes |
|---|---|---|---|
| Sidebar base nav | Dashboard, Tickets, Kanban, Projects, Leave, Calendar | C | Projects detail broken; other base modules real. |
| Team lead/manager nav | Team, Analytics | C | Team live/status real; request workflow not real. |
| Admin nav | Users, Departments, Activity | G | User hierarchy and department logging gaps. |
| Settings nav | Settings | G | Settings tabs have mixed truth. |
| Super admin mode nav | Super admin or team lead view | H | View mode only; not backend scope. |
| Topbar actions | New ticket, command palette, notifications, screenshot, profile menu | F | Notification single mark-read is broken by UUID pipe; screenshot is local-only. |

### Backend API Coverage

| Method/Endpoint | Controller | Service | Auth required | Roles | Used by frontend | Status | Flags |
|---|---|---|---|---|---|---|---|
| `GET /health` | HealthController | Health/service DB check | No | Public | Ops only | A | Intentional open health check. |
| `POST /auth/login` | AuthController | AuthService | No | Public | Yes | A | Throttled. |
| `POST /auth/register` | AuthController | AuthService | Yes | Admin/Super | Not primary UI | E | Backend exists; users UI uses `/users`. |
| `PATCH /auth/change-password` | AuthController | AuthService | Yes | Any | Yes | A | Missing audit event. |
| `GET /auth/me` | AuthController | AuthService/JWT | Yes | Any | Yes | A | Rejects invalid/inactive tokens. |
| `POST /auth/forgot-password`, `POST /auth/reset-password` | AuthController | AuthService | No | Public | Yes | G | OTP not emailed; user enumeration risk. |
| `GET/PATCH /users/me`, `/users/me/preferences`, photo endpoints | UsersController | UsersService | Yes | Any | Yes | A | Self-scoped. |
| `GET /users`, `/users/:id`, `/users/stats`, `/users/directory`, `/users/my-team` | UsersController | UsersService | Yes | Scoped by service/roles | Yes | A | Sensitive fields stripped. |
| `POST/PUT/DELETE /users`, `/users/:id/reset-password` | UsersController | UsersService | Yes | Admin/Super | Yes | G | Missing hierarchy guard for high-privilege targets. |
| `GET/PATCH /users/:id/profile` | UsersController | UsersService | Yes | Scoped | Yes | C | Sensitive logging split between legacy/operational. |
| `POST/GET/PATCH/DELETE /users/:id/documents` | UsersController | UsersService | Yes | Scoped/HR/Admin | Yes | C | Verify uses legacy logging only. |
| `GET/POST/PUT/DELETE /roles` | RolesController | RolesService | Yes | Reads any, writes Admin/Super | Partly | C | Role admin UI minimal; no events, no delete-in-use guard found. |
| `GET/POST/PUT/PATCH/DELETE /departments` | DepartmentsController | DepartmentsService | Yes | Admin/Super | Yes | C | Missing org-change events. |
| `GET /tickets`, `/tickets/stats`, `/tickets/sla-risk`, `/tickets/kanban` | TicketsController | TicketsService | Yes | Scoped | Yes | A | Real scoped APIs. |
| `GET /tickets/export` | TicketsController | TicketsService | Yes | Scoped | Yes | A | Logs export. |
| `GET /tickets/:id`, `/history`, create/update/status/assign/block/unblock/approve/reject/delete | TicketsController | TicketsService | Yes | Scoped/action-specific | Yes | A | Core lifecycle real. |
| `POST/GET/DELETE /tickets/:id/attachments` | TicketsController | UploadsService/TicketsService | Yes | Ticket-scoped | Yes | A | Scoped download avoids raw URL leakage. |
| `GET/POST/PUT/DELETE /tickets/:ticketId/comments` | CommentsController | CommentsService | Yes | Ticket-scoped | Create/list only | E | Edit/delete unused in UI. |
| `GET/POST/PUT/DELETE /projects`, member endpoints | ProjectsController | ProjectsService | Yes | Scoped/role-specific | Yes | F | ID routes broken by UUID pipe against cuid IDs. |
| `GET/POST/PATCH /leave` routes | LeaveController | LeaveService | Yes | Scoped; approve lead+ | Yes | C | Cancel unused in UI. |
| `GET/PATCH/DELETE /notifications` routes | NotificationsController | NotificationsService | Yes | Own user | Yes/partly | F | Single read/delete broken by UUID pipe. |
| `POST /team/request` | TeamController | TeamService | Yes | Any | Yes | D | Sends notification only; no request lifecycle. |
| `GET /dashboard/*`, `GET /home/summary` | Dashboard/Home controllers | DashboardService | Yes | Scoped | Yes | A | Scoped metrics. |
| `GET /events` | EventsController | EventLoggerService | Yes | Scoped | Yes | C | Operational feed real; legacy events separate. |
| `GET/PATCH /settings/company`, `/leave-policy`, `/sla`, `/smtp`, `/email/test` | SettingsController | SettingsService/EmailService | Yes | Writes gated; SMTP super only | Yes | A | SMTP loads persisted AppSetting. |
| `GET /task-types` | TaskTypesController | TaskTypesService | No | Public | Yes | G | Should be guarded. |
| `GET /task-types/all`, create/update/delete type/subtype | TaskTypesController | TaskTypesService | Yes | Admin/Super | Yes/partly | C | No event logging, edit UI incomplete. |
| `GET/POST /workday/*` | WorkdayController | WorkdayService | Yes | Scoped | Yes | C | Resume/idle logging partial. |
| `POST /ai/*` | AiController | AiService/AiCronService | Yes | Mixed | Partly | G | Suggest priority optional; ticket suggestions and summaries not scoped correctly. |

Flagged coverage mismatches:

- Frontend route with broken backend: `/projects/:id`, project edit/delete/member management.
- Frontend action with broken backend: notification single mark-read/delete.
- Frontend UI with no real workflow: team member request approval, smart assignment/AI agents claim.
- Backend route unused by frontend: comment edit/delete, leave cancel, auth register, role CRUD beyond read/use in user pages.
- Open API that should be guarded: `GET /task-types`.
- Guarded API with visible UI mismatch: manager project create uses admin-only departments endpoint.
- Dead or redirect route: `/reports` redirects to `/analytics`.

## Database Model Coverage

| Model | Used by feature | Frontend surface | API surface | Status | Orphan risk | Notes |
|---|---|---|---|---|---|---|
| `User` | Auth, profiles, users, workday, leave, tickets | Many | Auth/users/workday/leave/tickets | G | Low | Sensitive fields mostly protected; hierarchy update risk remains. |
| `EmployeeDocument` | Employee documents | Profile pages | User document APIs | C | Low | Stores base64 or URL; verify logging partial. |
| `Role` | RBAC, user management | Users/dept/settings indirectly | Roles/users APIs | C | Low | Reads available to any authenticated user; delete-in-use guard not found. |
| `Department` | Departments, scoping, tickets, projects, users | Departments, tickets, projects, users | Department/users/tickets/project APIs | C | Low | CRUD lacks OperationalEvent logging. |
| `Project` | Projects, project-linked tickets | Projects, ticket create/detail | Project/ticket APIs | F | Medium | Cuid IDs conflict with UUID pipe in project controller. |
| `ProjectMember` | Project visibility/members | Project detail | Project member APIs | F | Medium | API path broken by UUID pipe. |
| `Ticket` | Tickets, dashboard, calendar, analytics | Tickets, kanban, dashboard, calendar | Tickets/dashboard/calendar source APIs | F | Low | Custom ticket type UI does not match enum. |
| `TicketAssignee` | Multi-assignee tickets | Ticket create/detail | Tickets service | A | Low | Real participant visibility. |
| `Comment` | Ticket comments | Ticket detail | Comments API | E | Low | Edit/delete backend unused. |
| `Attachment` | Ticket attachments | Ticket detail | Attachment APIs | A | Low | Sanitized download, storage fallback documented. |
| `LeaveRequest` | Leave, dashboard, calendar | Leave/calendar/dashboard | Leave APIs | E | Low | Cancel backend unused in UI. |
| `Notification` | Bell, events, team requests | Topbar notifications | Notifications/service events | F | Low | Cuid mark-read/delete broken; team request is notification-only. |
| `ActivityLog` | Legacy activity | Limited/legacy only | Some services write | C | Medium | Split from OperationalEvent; sensitive/doc verification uses legacy. |
| `TicketHistory` | Ticket audit/history | Ticket detail | Ticket history API | A | Low | Captures key ticket field changes. |
| `TaskType` | Ticket classification | Settings, ticket create | Task type APIs | G | Low | Public read endpoint and missing events. |
| `TaskSubtype` | Ticket sub-classification | Settings, ticket create | Task type APIs | C | Low | Custom subtype text also supported on Ticket. |
| `AppSetting` | Settings, prefs, SMTP, SLA, leave policy | Settings | Settings/users/email/timing services | H | Low | Ticket preferences stored but not applied. |
| `WorkSession` | Workday/attendance | Workday bar, team, profile snippets | Workday APIs | C | Low | No standalone attendance page. |
| `BreakLog` | Workday breaks | Workday bar/history | Workday APIs | A | Low | Break time excluded. |
| `AttendanceEvent` | Attendance timeline | Workday/history/team | Workday APIs | C | Low | Idle/resume not in OperationalEvent. |
| `OperationalEvent` | Activity/audit | Activity page | Events API | C | Low | Primary audit feed, but not every module writes to it. |
| `ManagerDeptAccess` | Extended manager scoping | Indirect only | Access services | E | Medium | Model exists; no obvious UI management surface found. |

Additional database notes:

- Models storing base64/files: `User.photoUrl`, `EmployeeDocument.fileUrl`, `Attachment.url` can hold base64 fallback or storage references.
- Settings stored as `AppSetting`: company, theme defaults, leave policy, SLA, review SLA, SMTP, user preferences.
- UI features with no durable model: local welcome seen flag, local super-admin view mode, local screenshot download, team request approval lifecycle.
- Risky nullable fields are common in operational entities by design; the higher-risk cases are business-workflow gaps, not nullability alone.

## Test Coverage Map

Tests were mapped from existing files. They were not re-run as part of this documentation-only audit.

| Feature | Playwright | API simulation/integration | Unit/integration | Manual verification doc | Gap |
|---|---|---|---|---|---|
| Auth login/session/invalid credentials | Partial | `smoke.spec.ts` | `auth.otp.spec.ts` | P1-8 | Forgot-password delivery not covered. |
| OTP/password reset | No | No | `auth.otp.spec.ts` | No | Unit covers in-memory OTP, not SMTP delivery. |
| Protected routes/direct URL | Yes | `smoke.spec.ts` | Roles guard tests | P1-7/P1-8 | Frontend-only guard not security source. |
| User list/profile/sensitive fields | Partial | `smoke.spec.ts` | `p0.access-policy.spec.ts` | P1-7 | Admin hierarchy update gap not covered. |
| Departments | Partial | `smoke.spec.ts` appears stale against current admin-only guard | No direct unit | No | Missing current-role regression coverage. |
| Tickets lifecycle | Yes | `smoke.spec.ts` | `ticket.transitions`, `p0.ticket-access-timing` | P1-8 | Custom type failure not covered. |
| Ticket blocking/SLA pause | Partial | No | `blocked-ticket.spec.ts` | P1 docs | Good unit coverage. |
| Ticket attachments | Yes | No | `p1d.attachment-security.spec.ts` | P1-5 | Cloudinary remote delete cleanup not covered. |
| Comments | Partial | `smoke.spec.ts` activity section | No dedicated comment edit/delete unit | P1-8 | Edit/delete unused UI not covered. |
| Projects | Partial | `smoke.spec.ts` list only | `p0.project-access.spec.ts` service-level | P1-8 | Controller UUID/cuid break not covered. |
| Leave apply/approve | Yes | `smoke.spec.ts` | `leave.rules`, `p1.leave-balance` | P1-8 | Cancel UI gap not covered. |
| Workday/attendance | Yes | No | No direct unit found | P1-8 | Idle/resume logging and multi-break guard gaps. |
| Calendar ticket/leave | Yes | No | Indirect leave/ticket tests | P1-6 | Project deadlines intentionally unsupported. |
| Notifications | Partial | `smoke.spec.ts` list only | `p1.notification-event.spec.ts` | P1-8 | Mark-read/delete UUID bug not covered. |
| Activity/events | Yes | `smoke.spec.ts` activity section | Event logger indirectly | P1-8 | Legacy vs OperationalEvent split remains. |
| Dashboard/analytics | Yes/partial | `p2.dashboard-recovery.spec.ts`, `smoke.spec.ts` | `p1d.dashboard-consistency.spec.ts` | Dashboard audit doc | Analytics chart rendering not deeply asserted. |
| Settings | Yes | `smoke.spec.ts` | `p1d.smtp-settings.spec.ts` | P1-4 | Ticket prefs apply-to-create not covered. |
| Task types | Partial | No | No dedicated unit found | No | Public read endpoint and audit gaps. |
| Realtime/socket | Partial browser presence | No | Notification event emits mocked | Rules audit | Ticket broadcast scoping not covered. |
| AI | No | No | No dedicated unit found | Rules audit | Scoping risks not covered. |

## Priority Scoring Rules

```text
P0: Security leak, data loss, login broken, production down, critical workflow impossible.
P1: Core workflow broken or misleading, but system mostly usable.
P2: Partial feature gap, weak UX, missing drilldown, incomplete edge case.
P3: Polish, future enhancement, documentation gap.

XS: one-file / copy / condition fix
S: small frontend/backend patch
M: multiple files but contained
L: module-level refactor
XL: architecture-level / future phase
```

## Master Feature Status Board

The executive board is maintained separately in `docs/FEATURE_STATUS_BOARD.md`.
