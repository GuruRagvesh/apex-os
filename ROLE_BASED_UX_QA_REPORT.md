# Apex OS Role-Based UX QA Report

Date: 2026-05-28  
Scope: Dashboard, Tickets, Kanban, Projects, Leave, Calendar, Team, Analytics, Users & Roles, Departments, Activity Log, Settings, Notifications, Profile across SUPER_ADMIN, ADMIN, MANAGER, TEAM_LEAD, EMPLOYEE, and INTERN.

## Executive Summary

The backend role scoping is mostly intact after P0/P1 stabilization: ticket, kanban, project, leave, activity, notification, user, and settings APIs return scoped or forbidden responses according to role. The main UX risks are now route/action visibility and role context clarity rather than raw data leakage.

Confirmed P0/operational UX issues before fixes:

1. Analytics is hidden from EMPLOYEE/INTERN in the sidebar but can still be opened directly at `/analytics`, where it renders manager-style workload/trend UI using scoped backend data.
2. Users & Roles and Departments are hidden from non-admins in the sidebar but direct routes still render admin-oriented pages.
3. The Alt+K Quick Action Palette ignores the role-filtered actions passed by the dashboard layout and instead shows the same default operational commands to every role, including manager-style actions for EMPLOYEE/INTERN.
4. Settings deep links can select admin-only tabs for non-admin users and render a blank content area instead of falling back to an allowed tab or explaining access.
5. Profile stats show hardcoded `Leave Days = 0` and `Projects = 0` instead of real scoped data.

Backend/API checks used signed JWTs for existing role personas to avoid login rate limits and verified API status/response shape against the local compiled backend. UI checks were performed by route/menu/component tracing because the app server cannot be kept alive across separate tool calls in this environment.

## Evidence Map

- Dashboard shell authentication guard: `frontend/app/(dashboard)/layout.tsx:16-23`
- Sidebar role menu rules: `frontend/components/layout/sidebar.tsx:57-74`, `frontend/components/layout/sidebar.tsx:124-134`, `frontend/components/layout/sidebar.tsx:226-263`
- Quick Action Palette defaults ignore passed actions: `frontend/components/ui/QuickActionPalette.tsx:23-28`, `frontend/components/ui/QuickActionPalette.tsx:95-120`
- Dashboard layout passes role-agnostic palette actions: `frontend/app/(dashboard)/layout.tsx:45-115`
- Analytics has no role gate and renders workload/trend cards for any direct visitor: `frontend/app/(dashboard)/analytics/page.tsx:48-76`, `frontend/app/(dashboard)/analytics/page.tsx:134-184`
- Users page only hides admin actions, but page itself still renders for non-admin direct access: `frontend/app/(dashboard)/(platform)/users/page.tsx:35-45`, `frontend/app/(dashboard)/(platform)/users/page.tsx:70-90`
- Departments page only hides create/edit actions, but page itself still renders for non-admin direct access: `frontend/app/(dashboard)/(platform)/departments/page.tsx:13-19`, `frontend/app/(dashboard)/(platform)/departments/page.tsx:37-45`, `frontend/app/(dashboard)/(platform)/departments/page.tsx:71-85`
- Settings tab gating renders blank content for unauthorized deep-linked tabs: `frontend/app/(dashboard)/settings/page.tsx:1410-1426`, `frontend/app/(dashboard)/settings/page.tsx:1469-1516`
- Profile hardcoded counters: `frontend/app/(dashboard)/profile/page.tsx:76-83`
- Calendar leave event response key fixed in prior UX Fix 1 and now uses `items`: `frontend/app/(dashboard)/calendar/page.tsx:67-80`
- Notifications are scoped to current user in backend and topbar: `backend/src/modules/operations/notifications/notifications.controller.ts:14-40`, `frontend/components/layout/topbar.tsx:70-100`, `frontend/components/layout/topbar.tsx:344-399`
- User list/profile backend scoping and safe fields: `backend/src/modules/core/users/users.service.ts:15-68`, `backend/src/modules/core/users/users.service.ts:223-275`
- Users admin mutations guarded: `backend/src/modules/core/users/users.controller.ts:80-101`
- User stats guarded manager/admin/super-admin: `backend/src/modules/core/users/users.controller.ts:63-66`
- Settings backend mutation gates: `backend/src/modules/platform/settings/settings.controller.ts:28-108`

## API Probe Summary

Personas used:

| Role | Persona |
|---|---|
| SUPER_ADMIN | QC Super Admin / No department |
| ADMIN | Pavan Lalwani / Company Operations |
| MANAGER | Anshika Patel / ID Team |
| TEAM_LEAD | Vishal / ID Team |
| EMPLOYEE | Pooja Kamble / ID Team |
| INTERN | Sonali / AI & R&D |

Important API observations:

| Check | Result |
|---|---|
| SUPER_ADMIN/ADMIN tickets | 13 visible tickets; kanban total also 13 |
| MANAGER/TL ID Team tickets | 0 visible tickets; kanban total also 0 |
| EMPLOYEE/INTERN tickets | 0 visible tickets; kanban total also 0 |
| MANAGER/TL team endpoint | 9 team members visible for ID Team personas |
| EMPLOYEE team endpoint | 9 department members visible |
| INTERN team endpoint | 4 department members visible |
| Analytics workload endpoint | 56 rows for admin scope, 10 rows for manager/TL ID Team, 1 row for employee/intern |
| User stats endpoint | 200 for MANAGER/ADMIN/SUPER_ADMIN; 403 for TEAM_LEAD/EMPLOYEE/INTERN |
| SMTP settings endpoint | 200 for SUPER_ADMIN; 403 for all other probed roles |
| Activity endpoint | 200 for all roles, scoped by backend to global, department, or personal visibility |
| Calendar approved leave endpoint | `items:0; total:0` in current data, response shape is correct |

## Role/Page Matrix

Legend: Access = whether the current UI/API lets the role reach useful content. Should = expected role access for operational UX. Data = whether backend response is scoped. Actions = whether visible actions match role. Notes call out confusing or broken experiences.

| Role | Page | Access | Should | Real Scoped Data | Actions Correct | Filters/Drilldowns | UX Notes |
|---|---|---:|---:|---:|---:|---:|---|
| SUPER_ADMIN | Dashboard | Yes | Yes | Yes | Yes | Yes | Company scope labels are clear. |
| SUPER_ADMIN | Tickets | Yes | Yes | Yes | Yes | Yes | Ticket count matched kanban in probe. |
| SUPER_ADMIN | Kanban | Yes | Yes | Yes | Yes | Yes | Company-wide board available. |
| SUPER_ADMIN | Projects | Yes | Yes | Yes | Yes | Yes | Project create/edit allowed. |
| SUPER_ADMIN | Leave | Yes | Yes | Yes | Yes | Yes | Company-wide leave scope; no current leave data. |
| SUPER_ADMIN | Calendar | Yes | Yes | Yes | Yes | Yes | Approved leave reads `items`; no approved leave exists in current DB. |
| SUPER_ADMIN | Team | Yes | Yes | Partial | Yes | Yes | QC super-admin has no department, so `/users/my-team` returns 0; company-mode UI still supports directory. |
| SUPER_ADMIN | Analytics | Yes | Yes | Yes | Yes | Yes | Company-wide analytics available. |
| SUPER_ADMIN | Users & Roles | Yes | Yes | Yes | Yes | Yes | Admin actions available. |
| SUPER_ADMIN | Departments | Yes | Yes | Yes | Yes | Yes | Admin actions available. |
| SUPER_ADMIN | Activity Log | Yes | Yes | Yes | Yes | Yes | Global activity visible. |
| SUPER_ADMIN | Settings | Yes | Yes | Yes | Yes | Yes | Email/SMTP tab correctly super-admin only. |
| SUPER_ADMIN | Notifications | Yes | Yes | Yes | Yes | Yes | Topbar dropdown scoped to current user. |
| SUPER_ADMIN | Profile | Yes | Yes | Partial | Yes | Yes | Leave/project counters were hardcoded to zero before fix. |
| ADMIN | Dashboard | Yes | Yes | Yes | Yes | Yes | Company administrator scope is clear. |
| ADMIN | Tickets | Yes | Yes | Yes | Yes | Yes | Ticket count matched kanban in probe. |
| ADMIN | Kanban | Yes | Yes | Yes | Yes | Yes | Company-wide board available. |
| ADMIN | Projects | Yes | Yes | Yes | Yes | Yes | Project management available. |
| ADMIN | Leave | Yes | Yes | Yes | Yes | Yes | Company-wide leave scope. |
| ADMIN | Calendar | Yes | Yes | Yes | Yes | Yes | Scoped tickets/leave render through backend. |
| ADMIN | Team | Yes | Yes | Partial | Yes | Yes | Persona showed one same-department teammate; admin analytics still global. |
| ADMIN | Analytics | Yes | Yes | Yes | Yes | Yes | Company analytics available. |
| ADMIN | Users & Roles | Yes | Yes | Yes | Yes | Yes | Admin actions available. |
| ADMIN | Departments | Yes | Yes | Yes | Yes | Yes | Admin actions available. |
| ADMIN | Activity Log | Yes | Yes | Yes | Yes | Yes | Global activity visible. |
| ADMIN | Settings | Yes | Yes | Yes | Yes | Yes | Workspace tabs visible; SMTP correctly hidden/403. |
| ADMIN | Notifications | Yes | Yes | Yes | Yes | Yes | Topbar dropdown scoped to current user. |
| ADMIN | Profile | Yes | Yes | Partial | Yes | Yes | Leave/project counters were hardcoded to zero before fix. |
| MANAGER | Dashboard | Yes | Yes | Yes | Yes | Yes | Department wording is clear; current selected manager had no tickets. |
| MANAGER | Tickets | Yes | Yes | Yes | Yes | Yes | Shows managed department tickets; current ID Team count was 0. |
| MANAGER | Kanban | Yes | Yes | Yes | Yes | Yes | Kanban count matched ticket list. |
| MANAGER | Projects | Yes | Yes | Yes | Yes | Yes | Can create scoped projects. |
| MANAGER | Leave | Yes | Yes | Yes | Yes | Yes | Approval controls have role/scope reasons. |
| MANAGER | Calendar | Yes | Yes | Yes | Yes | Yes | Uses scoped tickets and approved leave. |
| MANAGER | Team | Yes | Yes | Yes | Yes | Yes | ID Team manager saw 9 members and workload rows. |
| MANAGER | Analytics | Yes | Yes | Yes | Yes | Yes | Department workload visible. |
| MANAGER | Users & Roles | Direct only | No | Yes | Partial | Partial | Sidebar hides this, but direct route renders an admin-labeled page with scoped user rows. |
| MANAGER | Departments | Direct only | No | Partial | Partial | Partial | Sidebar hides this, but direct route renders all department cards. |
| MANAGER | Activity Log | Yes | Yes | Yes | Yes | Yes | Department activity scope shown. |
| MANAGER | Settings | Yes | Yes | Yes | Yes | Yes | Personal/account settings only; admin tabs hidden. |
| MANAGER | Notifications | Yes | Yes | Yes | Yes | Yes | Topbar dropdown scoped to current user. |
| MANAGER | Profile | Yes | Yes | Partial | Yes | Yes | Leave/project counters were hardcoded to zero before fix. |
| TEAM_LEAD | Dashboard | Yes | Yes | Yes | Yes | Yes | Team Lead scope labels are present. |
| TEAM_LEAD | Tickets | Yes | Yes | Yes | Yes | Yes | ID Team TL saw scoped team tickets, currently 0. |
| TEAM_LEAD | Kanban | Yes | Yes | Yes | Yes | Yes | Kanban count matched ticket list. |
| TEAM_LEAD | Projects | Yes | Yes | Yes | Partial | Yes | UI does not create projects, but project detail edit is allowed by backend when scoped. |
| TEAM_LEAD | Leave | Yes | Yes | Yes | Yes | Yes | Approval buttons explain blocked/self/upward cases. |
| TEAM_LEAD | Calendar | Yes | Yes | Yes | Yes | Yes | Uses scoped tickets and approved leave. |
| TEAM_LEAD | Team | Yes | Yes | Yes | Yes | Yes | ID Team TL saw 9 members and workload data. |
| TEAM_LEAD | Analytics | Yes | Yes | Yes | Yes | Yes | Scoped team workload available; acceptable if TL analytics is intended. |
| TEAM_LEAD | Users & Roles | Direct only | No | Yes | Partial | Partial | Direct route renders admin-style Users & Roles page even though sidebar hides it. |
| TEAM_LEAD | Departments | Direct only | No | Partial | Partial | Partial | Direct route renders all departments even though sidebar hides it. |
| TEAM_LEAD | Activity Log | Yes | Yes | Yes | Yes | Yes | Department activity scope shown. |
| TEAM_LEAD | Settings | Yes | Yes | Yes | Yes | Yes | Personal/account settings only; manager notification preference row visible. |
| TEAM_LEAD | Notifications | Yes | Yes | Yes | Yes | Yes | Topbar dropdown scoped to current user. |
| TEAM_LEAD | Profile | Yes | Yes | Partial | Yes | Yes | Leave/project counters were hardcoded to zero before fix. |
| EMPLOYEE | Dashboard | Yes | Yes | Yes | Yes | Yes | Personal contributor context visible. |
| EMPLOYEE | Tickets | Yes | Yes | Yes | Yes | Yes | Own/assigned ticket view; current persona had 0. |
| EMPLOYEE | Kanban | Yes | Yes | Yes | Partial | Yes | Board is scoped; drag is limited by frontend and backend. |
| EMPLOYEE | Projects | Yes | Yes | Yes | Yes | Yes | Scoped project view; no create action. |
| EMPLOYEE | Leave | Yes | Yes | Yes | Yes | Yes | Apply/self leave available; approval blocked. |
| EMPLOYEE | Calendar | Yes | Yes | Yes | Yes | Yes | Uses scoped tickets and approved leave. |
| EMPLOYEE | Team | Mixed | Maybe | Yes | Partial | Yes | Sidebar hides Team but QuickActionStrip exposes it. Team page shows department directory; decide if this should be formalized. |
| EMPLOYEE | Analytics | Direct only | No | Yes | No | Yes | Direct `/analytics` renders manager-style analytics with personal scoped data. |
| EMPLOYEE | Users & Roles | Direct only | No | Yes | Partial | Partial | Direct `/users` renders admin-labeled page with only self/safe rows. |
| EMPLOYEE | Departments | Direct only | No | Partial | Partial | Partial | Direct `/departments` renders department cards even though sidebar hides it. |
| EMPLOYEE | Activity Log | Direct only | Maybe | Yes | Yes | Yes | Page supports personal scope, but sidebar hides it. |
| EMPLOYEE | Settings | Yes | Yes | Yes | Partial | Yes | Admin deep-link tabs could render blank before fix. |
| EMPLOYEE | Notifications | Yes | Yes | Yes | Yes | Yes | Topbar dropdown scoped to current user. |
| EMPLOYEE | Profile | Yes | Yes | Partial | Yes | Yes | Leave/project counters were hardcoded to zero before fix. |
| INTERN | Dashboard | Yes | Yes | Yes | Yes | Yes | Restricted contributor context visible. |
| INTERN | Tickets | Yes | Yes | Yes | Yes | Yes | Own/assigned ticket view; current persona had 0. |
| INTERN | Kanban | Yes | Yes | Yes | Partial | Yes | Board is scoped; read-only helper text exists. |
| INTERN | Projects | Yes | Yes | Yes | Yes | Yes | Scoped assigned project view; no create action. |
| INTERN | Leave | Yes | Yes | Yes | Yes | Yes | Apply/self leave available; approval blocked. |
| INTERN | Calendar | Yes | Yes | Yes | Yes | Yes | Uses scoped tickets and approved leave. |
| INTERN | Team | Direct only | Maybe | Yes | Partial | Yes | Sidebar hides Team, but direct route returns department members. |
| INTERN | Analytics | Direct only | No | Yes | No | Yes | Direct `/analytics` renders manager-style analytics with personal scoped data. |
| INTERN | Users & Roles | Direct only | No | Yes | Partial | Partial | Direct `/users` renders admin-labeled page with only self/safe rows. |
| INTERN | Departments | Direct only | No | Partial | Partial | Partial | Direct `/departments` renders department cards even though sidebar hides it. |
| INTERN | Activity Log | Direct only | Maybe | Yes | Yes | Yes | Page supports personal scope, but sidebar hides it. |
| INTERN | Settings | Yes | Yes | Yes | Partial | Yes | Admin deep-link tabs could render blank before fix. |
| INTERN | Notifications | Yes | Yes | Yes | Yes | Yes | Topbar dropdown scoped to current user. |
| INTERN | Profile | Yes | Yes | Partial | Yes | Yes | Leave/project counters were hardcoded to zero before fix. |

## Broken Role Experiences

### P0: Employee/Intern Direct Analytics Access

EMPLOYEE and INTERN can open `/analytics` directly. The backend only returns scoped data, but the page still presents team workload, category analytics, trends, and export controls in a manager-style surface. This conflicts with the rule that interns should not see admin/manager intelligence.

Evidence: `frontend/app/(dashboard)/analytics/page.tsx:48-76`, `frontend/app/(dashboard)/analytics/page.tsx:134-184`.

### P0: Admin Pages Render By Direct URL For Non-Admins

`/users` and `/departments` are hidden from non-admin sidebars, but non-admin direct visitors still see admin-oriented pages. Backend user rows are safe/scoped and admin mutations are guarded, but the UX is misleading and Departments returns all department cards.

Evidence: `frontend/components/layout/sidebar.tsx:244-250`, `frontend/app/(dashboard)/(platform)/users/page.tsx:70-90`, `frontend/app/(dashboard)/(platform)/departments/page.tsx:71-85`.

### P0: Quick Action Palette Uses Same Commands For Every Role

The layout passes an `actions` prop, but `QuickActionPalette` ignores it and renders `DEFAULT_ACTIONS` for all roles. EMPLOYEE/INTERN can see commands like "Review Delivery Risks", "Review High Priority", "Check Team Availability", and "Review Leave Requests".

Evidence: `frontend/components/ui/QuickActionPalette.tsx:23-28`, `frontend/components/ui/QuickActionPalette.tsx:95-120`, `frontend/app/(dashboard)/layout.tsx:45-115`.

### P0: Settings Unauthorized Deep Links Create Blank Panel

Non-admin users can open `/settings?tab=company`, `/settings?tab=policies`, `/settings?tab=task-types`, or `/settings?tab=smtp`; the tab becomes active but no content renders. Backend remains safe, but the page is confusing and looks broken.

Evidence: `frontend/app/(dashboard)/settings/page.tsx:1415-1426`, `frontend/app/(dashboard)/settings/page.tsx:1504-1516`.

### P0: Profile Shows Hardcoded Operational Stats

Profile cards use real ticket data for open/in-progress but hardcode `Leave Days` and `Projects` as 0. This creates false reassurance for every role.

Evidence: `frontend/app/(dashboard)/profile/page.tsx:76-83`.

## Confusing Pages

- Team access is inconsistent for EMPLOYEE: sidebar hides Team, while dashboard quick actions expose it. The backend returns same-department members, so the product should either formalize Team as a directory for employees or remove that quick action.
- Activity Log supports personal scope for EMPLOYEE/INTERN, but the sidebar hides it and the page path is `/admin/activity`. The page label is safe, but the URL and menu rules are confusing.
- Analytics for TEAM_LEAD is currently allowed and scoped to team/department. This is acceptable if team workload is intended for TLs; otherwise the sidebar and page should be restricted to MANAGER+.
- Current seeded QC users under `@apex.local` have no department assignment, so they are poor personas for team/department QA. Existing department-assigned users were used for backend probes.

## Priority Fix List

P0 fixes to apply now:

1. Add frontend page guards for `/analytics`, `/users`, `/departments`, and department detail routes so direct URL access matches intended role visibility.
2. Make `QuickActionPalette` respect the role-filtered actions from `DashboardLayout`, or filter default actions by role.
3. Update `DashboardLayout` palette actions to use role-aware labels: employee/intern should not see manager wording like "Review Leave" or "Activity Log".
4. Fix Settings deep-link authorization so disallowed tabs fall back to Profile or show a clear permission message.
5. Replace Profile hardcoded leave/project counts with real scoped API data.

Non-blocking follow-ups:

1. Decide whether Team and personal Activity Log should be visible to employees/interns in the sidebar.
2. Assign departments to the six `@apex.local` QC users or document that role QA should use department-assigned personas.
3. Add a browser-accessible role smoke suite once the local server startup lifecycle is stable in automation.

## P0 Closure Applied After Report

Completed in this pass:

1. `/analytics` now renders only for TEAM_LEAD, MANAGER, ADMIN, and SUPER_ADMIN. EMPLOYEE and INTERN get a clear permission page and analytics queries do not run.
2. `/users`, `/departments`, and `/departments/:id` now render admin-only permission pages for non-admin direct access, and admin-only queries are disabled for those roles.
3. Both Quick Action Palette instances now receive and execute role-aware actions. EMPLOYEE/INTERN no longer see manager wording such as "Review Leave Requests", "Check Team Availability", or activity-log commands.
4. Settings deep links now fall back to Profile when a user opens a tab that is not allowed for their role.
5. Profile leave days and project counts now come from `leaveApi.getBalance()` and `projectsApi.getAll()` instead of hardcoded zeros.

Verification:

- Frontend build: PASS (`npm run build` in `frontend`)
- Backend build: not run because backend code was not changed
- Remaining warnings: existing lint warnings in projects/team/ticket image and hook-dependency areas; no new blocking compile or type errors from this pass
