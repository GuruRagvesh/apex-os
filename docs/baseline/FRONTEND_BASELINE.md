# Frontend Baseline

Anchor commit: `3d845242151c33b32296778bdbd43f0f6d77a9a1` (origin/main, 2026-10-07). Fingerprints of 385 frontend-side files: `frontend-fingerprints.json`.

## Routes (50)

Kind: **adapter** = thin route delegating to a `platforms/` screen; **in-route** = screen code lives in the route file (short in-route attendance pages delegate to legacy `frontend/components/attendance*`).

| Route | Lines | Kind | Owning package |
|---|---|---|---|
| `/change-password` | 211 | in-route | `@apex/core-identity`, `@apex/core-identity/api` |
| `/forgot-password` | 240 | in-route | `@apex/core-identity/api` |
| `/login` | 156 | in-route | `@apex/core-identity`, `@apex/core-identity/api` |
| `/select-mode` | 167 | in-route | `@apex/core-identity` |
| `/welcome` | 143 | in-route | `@apex/core-identity` |
| `/dashboard` | 8 | adapter | `@apex/intelligence-dashboard` |
| `/kanban` | 9 | adapter | `@apex/operations-tickets-lifecycle/screens/KanbanScreen` |
| `/leave` | 8 | adapter | `@apex/workforce-leave` |
| `/projects/[id]` | 8 | adapter | `@apex/operations-projects/screens/ProjectDetailScreen` |
| `/projects` | 8 | adapter | `@apex/operations-projects/screens/ProjectsScreen` |
| `/team` | 851 | in-route | `@apex/shared-utilities` |
| `/teams/[id]` | 8 | adapter | `@apex/workforce-teams/screens/TeamDetailScreen` |
| `/teams` | 8 | adapter | `@apex/workforce-teams/screens/TeamsScreen` |
| `/tickets/[id]` | 2466 | in-route | `@apex/core-users/api`, `@apex/operations-tickets-lifecycle/api` |
| `/tickets/new` | 1069 | in-route | `@apex/core-users/api`, `@apex/operations-tickets-lifecycle/api` |
| `/tickets` | 594 | in-route | `@apex/operations-tickets-lifecycle/api`, `@apex/core-organization-departments/api` |
| `/departments/[id]` | 8 | adapter | `@apex/core-organization-departments/screens/DepartmentDetailScreen` |
| `/departments` | 8 | adapter | `@apex/core-organization-departments/screens/DepartmentsScreen` |
| `/reports` | 16 | in-route | — |
| `/users/[id]` | 8 | adapter | `@apex/core-users/screens/UserDetailScreen` |
| `/users/[id]/profile` | 8 | adapter | `@apex/core-users-profiles/screens/UserProfileScreen` |
| `/users` | 8 | adapter | `@apex/core-users/screens/UsersScreen` |
| `/admin/activity` | 8 | adapter | `@apex/system-audit` |
| `/admin/approvals` | 9 | adapter | `@apex/core-users-change-requests` |
| `/analytics` | 9 | adapter | `@apex/intelligence-analytics` |
| `/attendance-v2` | 15 | in-route | — |
| `/attendance/admin` | 9 | in-route | — |
| `/attendance/import` | 9 | in-route | — |
| `/attendance` | 21 | in-route | — |
| `/attendance/reviews` | 62 | in-route | — |
| `/calendar` | 8 | adapter | `@apex/workforce-calendar` |
| `(dashboard)` layout (sidebar/topbar shell) | 180 | layout | `@apex/apps-web/components/cold-start-banner`, `@apex/shared-ui/components/QuickActionPalette` |
| `/profile` | 21 | adapter | `@apex/core-users-profiles/screens/ProfileScreen` |
| `/settings` | 1675 | in-route | `@apex/core-identity`, `@apex/core-identity/api` |
| `/hrms` | 693 | in-route | `@apex/core-identity`, `@apex/core-users-change-requests/api` |
| `/sales-crm/analytics` | 6 | adapter | `@apex/sales-crm-analytics` |
| `/sales-crm/dashboard` | 6 | adapter | `@apex/sales-crm-dashboard` |
| `/sales-crm/database` | 6 | adapter | `@apex/sales-crm-database` |
| `/sales-crm/deals` | 14 | adapter | `@apex/sales-crm-shell/components/PlannedPane` |
| `/sales-crm` (layout) | 70 | layout | `@apex/core-identity`, `@apex/sales-crm-shell` |
| `/sales-crm/leads` | 11 | adapter | `@apex/sales-crm-leads` |
| `/sales-crm` | 10 | adapter | `@apex/sales-crm-dashboard` |
| `/sales-crm/requirements-sourcing` | 14 | adapter | `@apex/sales-crm-shell/components/PlannedPane` |
| `/sales-crm/settings` | 6 | adapter | `@apex/sales-crm-settings` |
| `/attendance/mobile-punch/[handoffId]` | 271 | in-route | — |
| `/home-v2` | 8 | adapter | `@apex/system-public-site/screens/ApexLandingPage` |
| root layout (`frontend/app/layout.tsx`) | 37 | layout | `@apex/apps-web/components/providers`, `@apex/shared-ui/components/staging-banner` |
| `/` | 6 | adapter | `@apex/system-public-site/screens/ApexLandingPage` |
| `/privacy` | 10 | adapter | `@apex/system-public-site/screens/PrivacyScreen` |
| `/terms` | 10 | adapter | `@apex/system-public-site/screens/TermsScreen` |

## Shared UI components (shared/ui/frontend)

`AnnouncementBroadcast.tsx`, `breadcrumb.tsx`, `CommandCard.tsx`, `CommandModal.tsx`, `empty-state.tsx`, `HoverPreview.tsx`, `KpiCapsule.tsx`, `KpiCapsuleStrip.tsx`, `multi-select.tsx`, `QuickActionPalette.tsx`, `skeleton.tsx`, `staging-banner.tsx`, `status-badge.tsx`, `user-avatar.tsx`

Legacy: `frontend/components/{attendance,attendance-v2,layout,notifications,ui,workday}`.

## Theme

- Root: `data-theme` default `technoedge-light`, `data-accent` default `royal-blue`, set pre-paint from localStorage (`apex-theme`, `apex-accent`) in `frontend/app/layout.tsx`.
- Themes in globals.css: john-wick-dark, gen-z-pastel, executive-midnight, focus-mode, neo-future. Tailwind dark mode = `john-wick-dark`.
- Accents: royal-blue, emerald, violet, gold, crimson, slate.
- 93 CSS custom properties in globals.css (1089 lines).

## Sidebar navigation by role (`frontend/components/layout/sidebar.tsx`)

| Role | Main nav | Extra sections |
|---|---|---|
| SUPER_ADMIN | Home, Tickets, Kanban Board, Projects, My Attendance, Leave, Calendar | My Team, Attendance Reviews, Analytics, Attendance Console, Users & Roles, Departments, Activity Log, Settings; module switcher (HRMS, Sales CRM). In `team_lead` mode the nav swaps to the streamlined team-lead list and these sections hide. |
| ADMIN | Same base nav | Same sections and modules as SUPER_ADMIN (no mode switch) |
| MANAGER | Base nav plus Departments (own) | My Team, Attendance Reviews, Analytics, Attendance Console, Activity Log, Settings |
| TEAM_LEAD | Base nav, no Departments | My Team, Attendance Reviews, Analytics, Attendance Console, Activity Log, Settings |
| EMPLOYEE | Base nav, no Departments | Settings |
| INTERN | Base nav, no Departments | Settings |

`isHR` (a user flag, not a role) adds scoped Departments and the HRMS module. Role badge colours are defined in `ROLE_BADGE_COLOR`.

Verify exact gating in the source before relying on this table; it was read from code, not from a running app.

## Screenshot baseline (pending)

Not captured yet: it needs the local database and the six role users. When available, capture each key page per role at 1440px and 390px wide in the default theme (`technoedge-light`) plus `john-wick-dark`, saved under `docs/baseline/screens/<role>/<route>-<width>-<theme>.png`:
login, dashboard, tickets, ticket detail, new ticket, kanban, projects, departments, team, users, user profile, attendance, leave, calendar, analytics, settings, HRMS, Sales CRM.
