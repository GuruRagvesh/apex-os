You are working on Apex OS stabilization.

First, read docs/APEX_OS_STABILIZATION_MASTER_PROMPT.md completely and treat it as the controlling recovery plan.

Do not edit application code yet.

Only perform Stage 0: Freeze, Backup, and Recovery Branch.

Rules:
- Do not proceed beyond Stage 0.
- Do not edit backend or frontend application logic.
- Do not run migrations.
- Do not touch production configuration.
- Do not delete or rename files.
- If git state is unsafe or unclear, stop and report.

After Stage 0, stop and report:
- current branch
- git status
- tags created
- tags skipped and why
- whether audit commit 4feaf11 exists
- any git issues
- rollback safety status
- next recommended step

Do not proceed to Stage 0.5 or Stage 1 without approval.


# Apex OS Stabilization Master Prompt

Use this file as the controlling instruction for Apex OS recovery work.

You are stabilizing an existing internal operating system, not rebuilding it from scratch. Treat this as a system recovery project with strict sequencing, verification, and preservation of working behavior.

## Mission

Bring Apex OS from an unstable mixed prototype into a stable internal operating system where:

- Authentication is safe.
- Role permissions are correct and consistent.
- Core workflows work end-to-end.
- Backend and frontend agree on routes, data, roles, and status names.
- No fake/stub UI claims success without persistence.
- UI restoration happens only after functionality is stable.
- Existing working features are preserved while the new design direction is applied carefully.

## Required First Read

Before editing code, read and compare:

- `README.md`
- `APEX_AUDIT_REPORT.md`
- `package.json`
- `backend/package.json`
- `frontend/package.json`
- `backend/prisma/schema.prisma`
- `backend/src/main.ts`
- Main backend controllers/services under `backend/src/modules`
- Main frontend routes under `frontend/app`
- Shared frontend API/state code under `frontend/lib`, `frontend/store`, and `frontend/hooks`

Important: the audit report may be stale. Verify every claimed bug against the current files before changing code. If an audit item is already fixed, mark it as verified-fixed instead of reworking it.

Do not print or expose raw secrets from `.env` files. Report secret presence by key name only.

## Execution Control Rule

This master prompt is a plan, not permission to execute all stages.

Claude Code must execute only the stage explicitly requested by the user.

Before editing files in any stage, Claude Code must:
1. Read the relevant stage.
2. Inspect current files.
3. Report exact files it intends to change.
4. Explain why each file needs to change.
5. Avoid unrelated files.
6. Stop if the change affects production, schema, auth, permissions, or core workflows beyond the current stage.

After completing the requested stage, Claude Code must stop and report.

Claude Code must not continue to the next stage without explicit user approval.

## Non-Negotiable Rules

- Do not delete existing features unless proven unused and approved.
- Do not redesign UI during stages 1-8.
- Do not add new product features during stabilization.
- Do not hide backend bugs with frontend-only workarounds.
- Do not perform broad refactors unless required to fix a known bug.
- Do not change unrelated files.
- Preserve existing API calls, forms, guards, Zustand state, ticket logic, leave logic, project logic, notifications, dashboard calculations, and settings APIs.
- Every fix must have a test, build check, smoke check, or documented manual verification.
- Commit after every completed stage.
- Report changed files, verification commands, remaining risks, and any blocked checks after each stage.

## Production Safety Rule

Do not run migrations, seed scripts, destructive commands, test scripts, environment changes, or deployment commands against production without explicit written approval.

Do not modify:
- production database
- production storage
- production SMTP/email behavior
- production user data
- production uploaded files
- production environment variables
- production deployment settings

If the environment is unclear, stop immediately and ask.

Before any database-related action, identify:
- current APP_ENV / NODE_ENV
- database target type: local, staging, or production
- whether the command is read-only or write/destructive

Production is for live company work only. Stabilization must happen in local or staging/preproduction first.

## Rollback Rule

Before each stage, record the current commit hash.

If the stage causes:
- build failure
- auth failure
- route failure
- permission failure
- database migration issue
- broken core workflow
- major UI regression
- production safety risk

then stop and report rollback options.

Do not proceed to the next stage until the current stage is clean or explicitly accepted with known risks.

Every stage must be small enough to rollback safely.

## Environment Matrix

Production:
- real company users
- real company database
- real uploaded files
- real emails/notifications
- no experiments
- no direct testing

Staging / Preproduction:
- safe test users
- staging database
- staging uploads
- sandbox/test email
- sandbox/test integrations
- final QA before production
- visible STAGING banner

Local Development:
- developer machines
- seed data
- local/test database
- no real users
- no production integrations

## Session Stability Rule

Do not log users out because there is no mouse movement or keyboard movement.

Authentication session expiry must be based only on:
- valid token/session expiry
- explicit logout
- admin/security revocation
- password/security change invalidation

Workday idle detection is not authentication logout.

If inactivity logout exists:
- disable it during stabilization
- or make it admin-configurable and off by default
- or convert it into a warning, not forced logout

Acceptance checks:
- user remains logged in after idle period if token is valid
- page refresh restores valid session
- expired/invalid token still logs out safely
- workday idle status does not destroy auth session

## Ticket Timer and QC Flow Rule

Ticket timing must be fair and role-aware.

Status meaning:
- OPEN: work not started
- IN_PROGRESS: employee execution timer is active
- REVIEW: employee execution timer stops, reviewer/QC timer starts
- DONE: all timers stop
- CLOSED/CANCELLED: all timers stop
- BLOCKED, if present: timer pauses or delay responsibility moves to blocker/dependency

Critical rule:
Employee must not be marked overdue while waiting for TL/QC/manager review.

Separate:
- employee execution delay
- reviewer/QC delay
- manager assignment delay
- dependency/blocker delay
- system delay

Acceptance checks:
- submitted-for-review ticket does not continue employee timer
- review overdue is attributed to reviewer/QC/manager
- done/closed/cancelled tickets show no active timer
- newly created ticket does not show fake overdue
- dashboard risk counts classify delay owner correctly

## Sensitive Data Access Rule

Sensitive user data must be protected by backend authorization, not only hidden in the frontend.

Sensitive data includes:
- salary/CTC/payroll
- bank details
- PAN/Aadhaar/statutory IDs
- documents
- private HR notes
- emergency contact details
- personal address
- phone number if restricted
- verification records

Access target:
- SUPER_ADMIN: full access
- ADMIN/HR-authorized users: full or configured access
- MANAGER: employment/team data only, no payroll unless explicitly allowed
- TEAM_LEAD: team operational data only
- EMPLOYEE/INTERN: own permitted profile data only

Acceptance checks:
- restricted users cannot fetch sensitive data by direct API URL
- UI does not expose restricted fields
- backend returns 403 or masked data where appropriate

## System Ownership Map

Frontend:
- routes
- layouts
- Zustand state
- UI rendering
- form validation
- client-side permissions

Backend:
- auth
- RBAC
- workflow enforcement
- SLA logic
- persistence
- notification triggers
- audit logging

Database:
- source of truth
- relational integrity
- indexes
- reporting queries

Realtime:
- notifications
- dashboard refresh
- workday presence

AI:
- optional layer only
- must never block core workflows

## Change Classification Rule

Every proposed change must be classified:

SAFE:
- CSS/UI-only
- text copy
- logging
- non-breaking cleanup

MODERATE:
- frontend state
- API response mapping
- settings persistence
- route fixes

HIGH RISK:
- auth
- RBAC
- database schema
- workflow logic
- timers
- notifications
- realtime
- production config

CRITICAL:
- migrations
- deletions
- role system
- token/session logic
- file storage changes

HIGH RISK and CRITICAL changes require:
- affected files list
- rollback explanation
- expected impact
- explicit approval

## Architecture Drift Prevention Rule

Do not create:
- duplicate APIs
- duplicate role systems
- duplicate state sources
- duplicate timer systems
- duplicate notification logic
- duplicate dashboard calculations
- duplicate auth/session handling

Before adding new logic:
1. Search for existing implementation.
2. Reuse or extend existing implementation if safe.
3. Document why duplication is necessary if duplication cannot be avoided.

Single source of truth must be preserved for:
- auth
- roles
- tickets
- projects
- leave
- dashboard metrics
- notifications
- settings


## Stage 0: Freeze, Backup, and Recovery Branch

Goal: stop uncontrolled changes and create a safe lane for recovery.

Actions:

```bash
git checkout main
git pull --ff-only
git checkout -b stabilize/apex-os-core
git tag backup-before-stabilization
git tag audit-commit-4feaf11 4feaf11
git tag ui-before-rebuild
```

If commit `4feaf11` does not exist locally, do not create a misleading tag. Report that the audit commit is unavailable.

No code fixes are allowed before this stage is attempted.


## Stage 0.5: Staging and Safe Preproduction Setup

Goal: create a safe environment where recovery work can be tested without affecting the live company system.

Actions:

- Create or verify a separate staging/preproduction environment.
- Use separate environment variables for staging.
- Use a separate staging database or isolated schema.
- Ensure staging API URL is different from production API URL.
- Add a visible STAGING banner or environment indicator in the frontend.
- Confirm migrations do not run against production accidentally.
- Confirm seed/test users are only created in staging/local environments.
- Confirm file uploads, SMTP, notifications, and integrations use safe staging/test configuration.
- Confirm production data is not modified during stabilization.

Session behavior rule:

- Do not auto logout users only because there is no mouse or keyboard movement.
- Session should remain active until token expiry, explicit logout, or security invalidation.
- If token refresh exists, refresh silently.
- If token expiry is near, show warning instead of forced logout.
- Workday/attendance idle tracking must be separate from authentication logout.

Data correctness rule:

- Dashboard cards, analytics, ticket counts, project progress, leave counts, SLA risk counts, notifications, workload, and team availability must reflect actual backend/database data.
- No mock dashboard values.
- No fake success toast without persistence.
- No frontend-only state pretending a backend update succeeded.

Acceptance checks:

- Staging opens separately from production.
- Staging has visible environment label.
- Production database is not touched.
- User is not logged out only due to inactivity.
- Dashboard data comes from backend.
- Settings persist after refresh and re-login.
- Integrations are either working in staging mode or clearly disabled with safe fallback.


## Stage 1: Security Hotfixes

Fix or verify these items first:

- Password reset OTP must be verified, hashed, expiring, and one-time-use.
- OTP must not be logged in production.
- Public registration must be disabled or protected by `ADMIN`/`SUPER_ADMIN`.
- JWT fallback secrets must be removed; missing `JWT_SECRET` should fail startup.
- Notification deletion must be ownership-scoped.
- Direct-ID access risks must be reviewed for tickets, comments, projects, leave, users, documents, and attachments.

Acceptance checks:

- Fake OTP reset fails.
- Expired OTP reset fails.
- Consumed OTP reset fails.
- Public register without token fails.
- Employee cannot delete another user's notification.
- App fails fast without `JWT_SECRET`.

## Stage 2: Role and Permission Stabilization

Create or verify one central role source:

```ts
export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  TEAM_LEAD: 'TEAM_LEAD',
  EMPLOYEE: 'EMPLOYEE',
  INTERN: 'INTERN',
} as const;
```

Use uppercase roles consistently in backend decorators, services, frontend guards, sidebar checks, settings checks, analytics access, and page-level access control.

Role scope target:

- `SUPER_ADMIN`: entire company.
- `ADMIN`: entire company, except super-admin-only behaviors.
- `MANAGER`: assigned managed departments plus intended home department.
- `TEAM_LEAD`: own department/team.
- `EMPLOYEE`: own tickets/projects/leave/profile.
- `INTERN`: assigned work only.

Acceptance checks:

- Each role sees the correct sidebar.
- Each role can perform allowed actions.
- Each role is blocked from restricted actions by backend, not only frontend.
- Dashboard, analytics, tickets, projects, leave, users, and events are role-scoped.

## Stage 3: Core Workflow Stabilization

Verify and fix the actual product workflows before UI work.

Ticket workflow:

- Create ticket.
- Assign ticket.
- Move `OPEN -> IN_PROGRESS -> REVIEW -> DONE`.
- Comment.
- History log.
- SLA timer.
- Filter/search.
- Kanban drag/drop.
- CSV export.

Project workflow:

- Create project.
- Edit project.
- View project detail.
- Link tickets to project.
- Add/remove members.
- Track progress from linked tickets.
- Delete as admin.

Leave workflow:

- Apply leave.
- View own leave.
- Manager/team lead visibility works as intentionally defined.
- Approve/reject/cancel rules are enforced.
- Stats and notifications update.

Notification workflow:

- Bell count.
- Unread count.
- Notification list.
- Mark one read.
- Mark all read.
- Delete own notification only.
- Realtime push without duplicate spam.

End-to-end acceptance scenario:

1. Admin creates user.
2. Manager creates project.
3. Employee creates ticket.
4. Manager assigns ticket.
5. Employee moves ticket to review.
6. Manager approves ticket.
7. Project progress updates.
8. Notification fires.
9. Dashboard counts update.
10. Kanban updates.

## Stage 4: Missing Pages and Broken Routes

Find and fix dead routes and fake links.

Required route checks:

- `/users/:id`
- `/users/:id/profile`
- `/reports`
- `/departments/:id`
- `/projects/:id`
- `/tickets/:id`

If `/reports` is only a redirect to analytics, sidebar links should point directly to `/analytics`. Keep `/reports` only as a compatibility redirect unless a real reports module is built later.

Acceptance check: click every sidebar item, row link, card link, modal CTA, and breadcrumb. Zero 404s.

## Stage 5: Settings and Persistence Repair

Remove fake success behavior.

Verify and fix persistence for:

- Company settings.
- Leave policy settings.
- SLA settings.
- SMTP settings and password masking.
- Notification preferences.
- Theme/appearance behavior.

If dark mode is incomplete, either remove it temporarily from visible UI or implement it completely. For stabilization, prefer deferring full theme rebuild to UI restoration.

Acceptance check: change every setting, refresh, log out, log back in, and confirm values persist.

## Stage 6: Database Performance and Data Integrity

Verify indexes before adding new ones. Do not duplicate existing indexes.

Required review areas:

- Ticket filters: department, assignee, creator, status, priority, due date, project.
- Notification filters: user, read state, created date.
- Leave filters: user, status, dates, department via user relation.
- Activity/event filters: actor, entity, action, timestamp.
- Project filters: owner/member, department, status.

Add pagination or hard limits for users, leave, notifications, activity/events, analytics, and any unbounded dashboard queries.

Acceptance check: seed or simulate larger data volumes and confirm pages still load cleanly.

## Stage 7: Branding and Product Consistency

Make Apex OS feel like one product.

Replace user-visible Nexus references:

- Email subjects.
- Email body copy.
- Email footers.
- From names.
- Public docs and deployment examples.

Rename storage keys carefully with migration compatibility:

```ts
const oldToken = localStorage.getItem('nexus_token');
if (oldToken && !localStorage.getItem('apex_token')) {
  localStorage.setItem('apex_token', oldToken);
  localStorage.removeItem('nexus_token');
}
```

New Cloudinary uploads should use `apex/tickets/`. Do not break old attachment URLs.

Acceptance check: repo search for `Nexus` and `nexus` shows only legacy compatibility comments or migration code.

## Stage 8: QC Operating System

Create formal quality control so future changes are testable.

Create:

```txt
docs/QC-STABILIZATION-CHECKLIST.md
```

Include sections for:

- Authentication.
- Role permissions.
- Tickets.
- Projects.
- Leave.
- Users.
- Departments.
- Settings.
- Notifications.
- Dashboard.
- Analytics.
- Mobile/responsive.
- UI consistency.
- Regression checks.

Create local-only role test users:

- `superadmin@apex.local`
- `admin@apex.local`
- `manager@apex.local`
- `teamlead@apex.local`
- `employee@apex.local`
- `intern@apex.local`

Add smoke tests where possible:

- Login works.
- Unauthorized page redirects.
- Tickets page loads.
- Ticket detail loads.
- Kanban loads.
- Projects page loads.
- Leave page loads.
- Settings page loads.
- Admin users page loads.

Add backend tests where possible:

- Auth reset OTP.
- Register protection.
- Role guard.
- Project guard.
- Notification ownership.
- Dashboard role scoping.
- Ticket status transition.
- Leave approval rule.

Acceptance check:

- Manual QC checklist passes.
- Role permission matrix passes.
- Smoke tests pass.
- API tests pass.
- No console errors.
- No 404s.
- No fake success toasts.

## Stage 8.5: Dashboard and Data Reflection Audit

Goal:
Ensure every visible dashboard count, graph, card, badge, alert, and command surface reflects actual backend/database data.

Verify:
- ticket counts
- open ticket count
- in-progress count
- review/pending approval count
- overdue/SLA risk count
- high-priority ticket count
- active project count
- project progress
- leave pending/approved/rejected stats
- notification bell count
- unread notification count
- team availability
- workload charts
- analytics cards
- Kanban column counts
- department member counts
- department ticket counts
- user workload counts
- workday status if present

Rules:
- No mock dashboard values.
- No hardcoded production numbers.
- No fake operational intelligence.
- No local-only state pretending backend persistence.
- No success toast unless backend confirms success.
- Every number must map to an API endpoint or backend formula.
- Every formula must be documented.

For every dashboard/card value, document:
- frontend component/page
- API endpoint
- backend service method
- database tables used
- role scope
- formula
- refresh behavior

Acceptance checks:
- create ticket updates relevant counts
- assign ticket updates workload/assignee views
- status change updates Kanban/dashboard
- ticket submitted for review updates review counts
- ticket approved/done updates resolved/project progress
- leave apply/approve/reject updates leave stats
- notification read/delete updates bell count
- dashboard respects role scope after refresh at minimum

## Stage 8.6: Rules and Integrations Audit

Goal:
Verify business rules and integrations so the system behaves truthfully and safely.

Integration audit:
- SMTP/email
- password reset OTP email
- notification/digest email
- file uploads/storage
- WebSocket/realtime notifications
- auth/JWT/session handling
- CORS
- frontend API base URL
- backend environment variables
- Prisma/database connection
- AI fallback behavior
- CSV export
- deployment environment separation

Business rule audit:
- ticket creation rules
- ticket assignment rules
- ticket edit rules
- ticket status transition rules
- ticket approval/rejection rules
- SLA and overdue rules
- review timer vs employee timer rules
- leave approval hierarchy
- leave quota rules
- overlapping leave rules
- project create/edit/delete rules
- project member rules
- project progress calculation
- user create/edit/deactivate rules
- role change rules
- department access rules
- notification trigger rules
- sensitive profile/payroll/document visibility rules

Acceptance checks:
- missing env values fail safely
- staging does not hit production services
- no fake success messages
- business rules are enforced by backend
- no core workflow depends on AI availability
- no movement-based auth logout exists unless explicitly configured
- integrations either work in staging or clearly fail with safe fallback




## Stage 9: UI Restoration

Only start after stages 1-8 are complete.

Do not rewrite the app around a mock UI. Extract the design direction and apply it to the existing working pages.

Preserve:

- Existing API calls.
- Existing forms.
- Existing role guards.
- Existing Zustand state.
- Existing ticket, leave, project, notification, dashboard, and settings logic.

Apply design in this order:

1. Shell: sidebar, topbar, layout, spacing, typography, buttons, cards, badges.
2. Dashboard: command center, workday status, command cards, broadcast panel, notifications, quick actions.
3. Tickets and Kanban: list, detail, SLA visual, status rail, comments, history, attachments, columns, cards.
4. Projects: cards, detail, progress, members, linked tickets, milestones.
5. Leave and Team: leave dashboard, modal, approval queue, availability, directory, roster.
6. Settings/Admin: profile, appearance, preferences, security, company, leave policy, SLA, task types, SMTP, users, departments.

## UI Restoration Data Rule

Screenshots are visual reference only.

Do not copy mock values into production pages.

Every UI element must either:
1. use real existing backend data,
2. show a true empty state,
3. be hidden until backend support exists,
4. or be clearly marked as planned/disabled.

Do not create fake operational intelligence.

Do not replace real functionality with decorative cards.

Every redesigned page must preserve:
- same data
- same actions
- same permissions
- same forms
- same API calls
- same workflow behavior

## Screenshot Checkpoint Rule

For every redesigned page:
- capture before screenshot
- capture after screenshot
- list changed files
- verify all old actions still exist
- verify all data is real
- verify no console errors
- verify responsive behavior
- verify role-based visibility

If screenshots cannot be captured, explain why and provide manual visual verification notes.

Every redesigned page needs before/after screenshots, same data, same actions, no mock data, no removed features, and responsive checks.

## Stage 10: Release Candidate

Release candidate is allowed only when:

- Security critical issues are fixed.
- Role matrix is verified.
- Tickets work end-to-end.
- Projects are guarded and working.
- Leave approval flow works.
- Users admin/detail flows work.
- Settings persist.
- Notifications are own-only and realtime.
- Dashboard is role-scoped.
- Analytics is manager-plus only.
- Branding is Apex OS only.
- Performance protections are in place.
- UI restoration is applied safely.
- QC matrix passes.

Create final release tag:

```bash
git tag apex-os-stabilized-v1
```

## Required Reporting Format After Each Stage

Report:

- Stage completed.
- Files changed.
- What was verified.
- Commands/checks run.
- Known risks.
- Blockers.
- Next recommended stage.

Keep the report factual. Do not overstate readiness.
