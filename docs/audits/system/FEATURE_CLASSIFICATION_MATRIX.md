# FEATURE CLASSIFICATION MATRIX
**Apex OS — Post Fix-Pack 9**
**Date:** 2026-05-30

| ID | Module | Feature | Class | Frontend File | Backend Endpoint(s) | DB Model | RBAC | Dashboard | Activity | Notifications | Priority |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 001 | Auth | Login / JWT | **A** | `(auth)/login/page.tsx` | `POST /auth/login` | User | JWT+Passport | auth.store feeds all | USER_LOGIN | — | P0 |
| 002 | Auth | Register | **A** | Settings/Admin | `POST /auth/register` | User | ADMIN only | — | USER_CREATED | — | P1 |
| 003 | Auth | Change Password | **A** | Settings page | `PATCH /auth/change-password` | User | Self | — | — | — | P2 |
| 004 | Auth | Forgot/Reset Password | **B** | No UI page found | `POST /auth/forgot-password` `POST /auth/reset-password` | User | Public | — | — | — | P1 |
| 005 | Users | User List (Admin) | **A** | `(platform)/users/page.tsx` | `GET /users` | User | Admin/SA | workload panel | USER_CREATED | — | P1 |
| 006 | Users | User Detail | **A** | `(platform)/users/[id]/page.tsx` | `GET /users/:id` | User | Admin/SA | — | PROFILE_UPDATED | — | P2 |
| 007 | Users | User Documents | **B** | `(platform)/users/[id]/page.tsx` | `POST /users/:id/documents` | EmployeeDocument | Admin | — | — | — | P2 |
| 008 | Users | Profile (Self) | **A** | `profile/page.tsx` | `GET/PATCH /users/me` | User | Self | — | PROFILE_UPDATED | — | P2 |
| 009 | Roles | Role CRUD | **A** | Settings page | `GET/POST/PUT/DELETE /roles` | Role | SA/Admin | — | USER_ROLE_CHANGED | — | P2 |
| 010 | Departments | Department CRUD | **A** | `(platform)/departments/page.tsx` | `GET/POST/PUT/PATCH/DELETE /departments` | Department | Admin/SA | dept chart | — | — | P2 |
| 011 | Dashboard | Command Center | **A** | `(core)/dashboard/page.tsx` | `GET /dashboard/overview` + 5 more | Ticket+User+WS | Role-scoped | IS dashboard | activity-feed | notifications bell | P0 |
| 012 | Dashboard | KPI Capsules | **A** | `KpiCapsuleStrip` component | `GET /dashboard/overview` | Ticket | Role-scoped | ✅ | — | — | P1 |
| 013 | Dashboard | Critical Action Panel | **A** | `CriticalActionPanel` component | `GET /tickets/sla-risk` | Ticket | Role-scoped | ✅ | — | — | P1 |
| 014 | Dashboard | Team Pressure Panel | **A** | `TeamPressurePanel` component | `GET /dashboard/workload` | Ticket+User | TL+ | ✅ | — | — | P1 |
| 015 | Tickets | Ticket List | **A** | `(operations)/tickets/page.tsx` | `GET /tickets` `GET /tickets/stats` | Ticket | ticket-access.service | ✅ | TICKET_CREATED | ✅ | P0 |
| 016 | Tickets | Create Ticket | **A** | `(operations)/tickets/new/page.tsx` | `POST /tickets` | Ticket | Role-scoped | — | TICKET_CREATED | ✅ | P0 |
| 017 | Tickets | Ticket Detail | **A** | `(operations)/tickets/[id]/page.tsx` | `GET/PUT/PATCH /tickets/:id` + 4 more | Ticket+TicketHistory | ticket-visibility.ts | — | TICKET_UPDATED | ✅ | P0 |
| 018 | Tickets | Status Transitions | **A** | Ticket detail page | `PATCH /tickets/:id/status` | Ticket | Role+status rules | — | TICKET_STARTED etc | ✅ | P0 |
| 019 | Tickets | Approve/Reject (Review) | **A** | Ticket detail page | `PATCH /tickets/:id/approve` `PATCH /tickets/:id/reject` | Ticket | TL/Manager | — | TICKET_REVIEWED | ✅ | P1 |
| 020 | Tickets | Block/Unblock | **B** | **UI MISSING in [id]/page** | `POST /tickets/:id/block` `POST /tickets/:id/unblock` | Ticket | Manager+ | — | TICKET_BLOCKED | — | P1 |
| 021 | Tickets | Ticket History | **A** | History tab in ticket detail | `GET /tickets/:id/history` | TicketHistory | Self+above | — | — | — | P2 |
| 022 | Tickets | SLA Timer | **A** | `SlaTimer` component | `GET /tickets/sla-risk` | AppSetting | All | SLA risk panel | TICKET_OVERDUE | — | P1 |
| 023 | Tickets | Export | **B** | No export button confirmed | `GET /tickets/export` | Ticket | Admin | — | — | — | P2 |
| 024 | Tickets | Assign | **A** | Ticket detail | `PATCH /tickets/:id/assign` | TicketAssignee | Manager/TL | — | TICKET_ASSIGNED | ✅ | P1 |
| 025 | Kanban | Kanban Board | **A** | `(operations)/kanban/page.tsx` | `GET /tickets/kanban` | Ticket | ticket-access | — | — | — | P1 |
| 026 | Kanban | Drag-Drop Status | **B** | Present but unverified | `PATCH /tickets/:id/status` | Ticket | Role-scoped | — | TICKET_UPDATED | — | P1 |
| 027 | Comments | Ticket Comments | **A** | Ticket detail — Comments tab | `GET/POST/PUT/DELETE /comments` | Comment | ticket scope | — | COMMENT_ADDED | — | P1 |
| 028 | Attachments | Upload Attachment | **B** | Drag-drop UI in ticket detail | `POST /tickets/:id/attachments` | Attachment | ticket scope | — | ATTACHMENT_UPLOADED | — | P1 |
| 029 | Attachments | Download/View | **B** | `AttachmentCard` with view/download | `GET /tickets/:id/attachments/:id/download` | Attachment | ticket scope | — | — | — | P1 |
| 030 | Projects | Project List | **A** | `(operations)/projects/page.tsx` | `GET /projects` `GET /projects/stats` | Project | RBAC via canEdit | — | PROJECT_CREATED | — | P1 |
| 031 | Projects | Project Detail | **A** | `(operations)/projects/[id]/page.tsx` | `GET /projects/:id` | Project+ProjectMember | RBAC via canEdit | — | PROJECT_UPDATED | — | P1 |
| 032 | Projects | Project Members | **A** | Project detail modal | `POST/DELETE /projects/:id/members` | ProjectMember | Manager+ | — | PROJECT_MEMBER_ADDED | — | P2 |
| 033 | Projects | Project Tickets | **A** | `TicketRow` in project detail | `GET /tickets?projectId=` | Ticket | ticket-access | — | — | — | P2 |
| 034 | Leave | Leave List | **A** | `(operations)/leave/page.tsx` | `GET /leave` | LeaveRequest | Role-scoped | dashboard link | LEAVE_REQUESTED | ✅ | P1 |
| 035 | Leave | Request Leave | **A** | Leave page form | `POST /leave` | LeaveRequest | All | — | LEAVE_REQUESTED | ✅ | P1 |
| 036 | Leave | Approve/Reject Leave | **A** | Leave pending tab | `PATCH /leave/:id/approve` `PATCH /leave/:id/reject` | LeaveRequest | Manager/TL/Admin | — | LEAVE_APPROVED | ✅ | P1 |
| 037 | Leave | Leave Balance | **B** | Balance visible but unverified | `GET /leave/balance` | LeaveRequest | Self+above | — | — | — | P2 |
| 038 | Leave | Cancel Leave | **A** | Leave page | `PATCH /leave/:id/cancel` | LeaveRequest | Self | — | LEAVE_CANCELLED | — | P2 |
| 039 | Calendar | Calendar View | **A** | `calendar/page.tsx` | `GET /leave?status=APPROVED` + tickets | LeaveRequest+Ticket | Self+above | dashboard link | — | — | P1 |
| 040 | Workday | Start/End Workday | **A** | `WorkdayBar` component | `POST /workday/start` `POST /workday/end` | WorkSession | Self | ✅ | WORKDAY_STARTED | — | P0 |
| 041 | Workday | Break Tracking | **A** | `WorkdayBar` component | `POST /workday/break/start` `POST /workday/break/end` | BreakLog | Self | — | BREAK_STARTED | — | P1 |
| 042 | Workday | Idle Detection | **B** | `useIdleDetection.ts` hook | `POST /workday/idle` `POST /workday/resume` | AttendanceEvent | Self | — | IDLE_DETECTED | — | P1 |
| 043 | Workday | History | **A** | `WorkdayHistoryStrip` | `GET /workday/history/:userId` | WorkSession | Self+Manager | — | — | — | P2 |
| 044 | Team | Team Live Status | **A** | `(operations)/team/page.tsx` | `GET /workday/team` | WorkSession+User | TL+ | TeamPressurePanel | — | — | P1 |
| 045 | Team | Team Requests | **B** | No dedicated page | `POST /team/request` | — | — | — | — | — | P2 |
| 046 | Activity | Activity Log | **A** | `admin/activity/page.tsx` | `GET /events` | OperationalEvent | Admin/SA | dashboard feed | IS activity | — | P1 |
| 047 | Notifications | Notification Bell | **A** | Components in layout | `GET /notifications` `GET /notifications/unread-count` | Notification | Self | ✅ | — | IS notifications | P1 |
| 048 | Notifications | Mark Read / Delete | **A** | Notification dropdown | `PATCH /notifications/:id/read` `PATCH /notifications/mark-all-read` `DELETE /notifications/:id` | Notification | Self | — | — | — | P2 |
| 049 | Settings | Profile/Password | **A** | `settings/page.tsx` | `PATCH /users/me` `PATCH /auth/change-password` | User | Self | — | PROFILE_UPDATED | — | P1 |
| 050 | Settings | Company Settings | **A** | Settings page — Company tab | `GET/PATCH /settings/company` | AppSetting | Admin/SA | — | SETTINGS_UPDATED | — | P2 |
| 051 | Settings | Leave Policy | **A** | Settings page — Leave tab | `GET/PATCH /settings/leave-policy` | AppSetting | Admin/SA | — | SETTINGS_UPDATED | — | P2 |
| 052 | Settings | SLA Config | **A** | Settings page — SLA tab | `GET/PATCH /settings/sla` | AppSetting | Admin/SA | — | SETTINGS_UPDATED | — | P2 |
| 053 | Settings | SMTP Config | **B** | Settings page — SMTP tab | `GET/PATCH /settings/smtp` `POST /settings/email/test` | AppSetting | Admin/SA | — | SETTINGS_UPDATED | — | P1 |
| 054 | Settings | Theme/Appearance | **A** | Settings page — Theme tab | `GET/PATCH /settings/company` (theme_defaults) | AppSetting | Self/Admin | — | — | — | P2 |
| 055 | Settings | Task Types | **A** | Settings page — Task Types tab | Full CRUD `/task-types` | TaskType+TaskSubtype | Admin/SA | — | — | — | P2 |
| 056 | Analytics | Analytics Dashboard | **A** | `analytics/page.tsx` | `GET /dashboard/ticket-trend` + charts | Ticket | Role-scoped | dashboard link | — | — | P2 |
| 057 | Reports | Reports Page | **B** | Redirects to `/analytics` | `GET /tickets/export` (unverified) | Ticket | Admin | — | — | — | P3 |
| 058 | AI | Priority Suggestion | **B** | Ticket detail AI panel | `POST /ai/suggest-priority` | Ticket | All | — | — | — | P2 |
| 059 | AI | Ticket Summary | **B** | Dashboard? | `POST /ai/summarize-tickets` | Ticket | Manager+ | — | — | — | P2 |
| 060 | AI | AI Digest (Cron) | **B** | No UI | `POST /ai/trigger-digest` | OperationalEvent | Cron/System | — | — | — | P3 |
| 061 | Deployment | Render.com Config | **A** | N/A | `render.yaml` ✅ | N/A | N/A | — | — | — | P0 |
| 062 | Storage | Cloudinary Uploads | **B** | Drag-drop in ticket detail | multer + cloudinary SDK | Attachment | ticket scope | — | ATTACHMENT_UPLOADED | — | P1 |
| 063 | Real-time | Socket.IO Gateway | **A** | `useSocket.ts` | WS Gateway — JWT auth | — | JWT scoped | — | — | notifications push | P1 |
| 064 | Mobile | Responsive UI | **B** | Tailwind responsive classes | N/A | N/A | N/A | — | — | — | P3 |
| 065 | A11y | Accessibility | **B** | `eslint-plugin-jsx-a11y` | N/A | N/A | N/A | — | — | — | P3 |

---

## CLASSIFICATION COUNTS

| Class | Label | Count |
|---|---|---|
| **A** | FULLY_CONNECTED | **38** |
| **B** | PARTIAL_OR_BROKEN | **19** |
| **C** | FRONTEND_ONLY | 0 |
| **D** | BACKEND_ONLY | 0 |
| **E** | UNKNOWN | 0 |
| **F** | NOT_PRESENT | 0 |
| | **TOTAL** | **57** |
