# Apex OS Homepage Role, Designation, and Hierarchy Rules

**Status:** Implementation-backed product rulebook
**Scope:** User creation, first login, homepage composition, homepage actions, and the navigation visible around Home
**Roles covered:** Intern, Employee, Team Lead, Manager, Admin, and Super Admin
**Last checked:** 14 October 2026

## 1. Purpose

This document defines what a newly created user sees and can do on the Apex OS homepage. It also explains which user-creation fields control the result.

The most important rule is:

> The canonical **role** controls authority and homepage composition. A free-text **designation** is a job title and must never grant authority by itself.

For example, entering `Senior Manager` in the designation field does not make an Employee a Manager. The account must be assigned the canonical `MANAGER` role.

## 2. Terms and sources of authority

### 2.1 Canonical role

Every account has exactly one primary `roleId`, resolving to one of these roles:

| Authority order | Canonical role | Product meaning |
|---:|---|---|
| 0 | `SUPER_ADMIN` | Unrestricted system administrator |
| 1 | `ADMIN` | Full system administrator |
| 2 | `MANAGER` | Company/department operations manager |
| 3 | `TEAM_LEAD` | Team oversight and task management |
| 4 | `EMPLOYEE` | Individual contributor |
| 5 | `INTERN` | Intern contributor |

Lower numeric levels are more senior. This ordering is also used by approval logic; a user cannot approve a person at the same or a more senior level.

### 2.2 Designation

`designation` is a descriptive profile value such as `Content Executive`, `HR Executive`, or `Engineering Manager`. It may be displayed in profile or employment records, but it does not currently decide homepage cards, navigation, approval authority, or data scope.

Never derive permissions by searching designation text for words such as “lead”, “manager”, or “admin”. Doing so would make free text a security control.

### 2.3 Department and hierarchy placement

`departmentId`, department memberships, team membership, team leadership, and manager-department access decide which people or records are inside a senior user's operational scope. They do not replace the canonical role.

Examples:

- An Employee in the Design department still receives the Employee homepage.
- A Team Lead receives senior homepage sections, but team results must be limited to the team or department the lead is assigned to.
- A Manager's operational visibility is resolved from their primary department and explicit manager-department access.
- Admin and Super Admin receive company-level administrative visibility where the feature defines company scope.

### 2.4 HR authority

`isHR` is an independent capability flag, not a seventh role.

- HR workspace access is granted when `isHR = true`.
- `ADMIN + isHR` is the intended HR Administrator combination.
- `SUPER_ADMIN + isHR` is deliberately refused; Super Admin and HR Admin remain separate responsibilities.
- The current Home UI still decides contributor-versus-senior layout from the canonical role. Therefore an `EMPLOYEE + isHR` user receives an Employee homepage even though HR-specific backend/workspace permissions may exist.

### 2.5 Workday state

Role grants permission; workday state decides whether a permitted action is currently available. For example, a user may have access to Create Ticket, Break, or Meeting, but the control can be disabled until the workday has started or while another work state is active.

## 3. Product categories used on Home

The homepage follows the two requested categories:

- **Overall category:** Intern, Employee, Team Lead, Manager, Admin, and Super Admin.
- **Senior category:** Team Lead, Manager, Admin, and Super Admin.

Employee and Intern are also referred to as **contributors** in implementation notes.

## 4. User creation and first-login decision flow

1. An authorized creator enters the required account values: name, email, initial password, canonical role, joining date, and optional department.
2. The backend verifies that the email is not already attached to an active or archived account and that the selected role exists.
3. The user and their attendance profile are created in one transaction. All human roles, including senior roles, are attendance-enabled by default.
4. If the email belongs to an inactive account, the system requires **rehire** instead of creating a duplicate. Earlier tickets, attendance, leave, and audit history remain attached to that account.
5. At login, authentication returns the user with their canonical role and department.
6. The frontend derives contributor/senior status from the canonical role and composes the homepage accordingly.
7. Homepage APIs independently enforce personal, team, department, approval-queue, or company scope. Hiding a card is not the security boundary; the backend scope is.
8. Workday state is loaded and determines which live controls are enabled.

### Current creation authority

The current `/users` creation route and **Users & Roles** page allow user creation only for `ADMIN` and `SUPER_ADMIN`.

An HR employee with only `isHR = true` cannot currently create users through this route. If HR must create accounts, use an `ADMIN + isHR` HR Administrator account or introduce a separately reviewed HR creation permission. Do not silently treat every HR user as Admin.

### Current creation fields and an important limitation

The current Add New User form collects:

- Full name
- Email
- Password
- Canonical role
- Department
- Joining date

It does not collect designation, `isHR`, team placement, reporting manager, or team lead during initial creation. Those are separate profile/authority assignments. Consequently, “designation-driven customization” is not automatic today; role selection is the required homepage switch.

## 5. Homepage section matrix

| Homepage feature | Intern | Employee | Team Lead | Manager | Admin | Super Admin |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Time-of-day hero | Yes | Yes | Yes | Yes | Yes | Yes |
| Workday status strip | Yes | Yes | Yes | Yes | Yes | Yes |
| Break / Meeting / Quick Access | Yes | Yes | Yes | Yes | Yes | Yes |
| Personal ticket KPIs | Yes | Yes | Yes | Yes | Yes | Yes |
| Ticket approval KPI | No | No | Yes | Yes | Yes | Yes |
| Leave approval KPI | No | No | Yes | Yes | Yes | Yes |
| Personal attendance/productivity calendar | Yes | Yes | Yes | Yes | Yes | Yes |
| “The Trailer” personal work-rhythm KPIs | Yes | Yes | Yes | Yes | Yes | Yes |
| Compact monthly paid-leave balance | Yes | No | No | No | No | No |
| Full leave usage/allocation analysis | No | Yes | Yes | Yes | Yes | Yes |
| Recognition/live activity ticker | No | No | Yes | Yes | Yes | Yes |
| Announcement/breaking-news ticker | Only when an active/critical announcement exists | Only when an active/critical announcement exists | Yes | Yes | Yes | Yes |
| Team insights | No | No | Yes | Yes | Yes | Yes |
| Project insights | No | No | Yes | Yes | Yes | Yes |

## 6. Hero rules

### 6.1 Overall category

Every user receives:

- A greeting using their first name.
- A day phase based on company-local time:
  - Morning: 08:00–11:59
  - Afternoon: 12:00–15:59
  - Evening: 16:00–17:59
  - Night: all other times
- The phase-specific visual treatment.
- Workday status and elapsed-time information.
- Break, Meeting, and Quick Access controls when allowed by current workday state.

### 6.2 Role-specific hero guidance

| Role | Guidance intent |
|---|---|
| Intern / Employee | Personal workday snapshot and focus |
| Team Lead | Team overview and responsibility |
| Manager | Operations, approvals, delegation, and decisions |
| Admin / Super Admin | Critical alerts when present; otherwise command-center status |

## 7. Hero KPI rules and data scope

### 7.1 KPIs shown to everyone

These cards are always personal unless explicitly stated otherwise:

| KPI | Rule |
|---|---|
| Open tickets | Count only OPEN tickets where the signed-in user is primary assignee or co-assignee |
| In progress | Count only IN_PROGRESS tickets where the signed-in user is primary assignee or co-assignee |
| Under review | Count only REVIEW work assigned to the signed-in user |
| Active projects | Scope depends on role, as defined below |

The removed My/Company toggle must not be restored. The scope is determined by role and backend logic.

### 7.2 Active-project scope

| Role | Active-project count |
|---|---|
| Intern | Active projects the user belongs to |
| Employee | Active projects the user belongs to |
| Team Lead | Active projects the Team Lead personally belongs to |
| Manager | All active company projects |
| Admin | All active company projects |
| Super Admin | All active company projects |

### 7.3 Senior-only approval KPIs

Team Lead, Manager, Admin, and Super Admin also receive:

- **Ticket approvals:** only pending tickets whose recorded approver is the signed-in user.
- **Leave approvals:** only pending leave requests within the viewer's allowed hierarchy/scope that the viewer is actually allowed to approve. The user's own leave is excluded.

Employee and Intern do not see empty approval cards; the cards are absent.

## 8. Quick Access rules

The Quick Access drawer is available to every role and contains personal essentials, private notes, and the daily checklist.

| Quick action | Intern | Employee | Team Lead | Manager | Admin | Super Admin | Additional condition |
|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
| Create Ticket | Yes | Yes | Yes | Yes | Yes | Yes | Subject to ticket/workday creation gate |
| Create Project | No | No | No | Yes | Yes | Yes | Canonical role only |
| Apply Leave | Yes | Yes | Yes | Yes | Yes | Yes | Subject to leave rules and balance |
| Edit Hero Bar | Yes | Yes | Yes | Yes | Yes | Yes | Personal appearance preference |

Team Lead intentionally cannot create a project from Quick Access under the current rule.

## 9. Break and meeting rules

### 9.1 Break

- Every role can start a break while the active work session is in WORKING state.
- Starting a break locks/blurs the workspace until Resume Work is selected.
- Resume Work ends the break and restores the workspace.

### 9.2 Meeting

- Every role can start a meeting timer while in WORKING state.
- The workspace remains locked during the meeting and the meeting record flow appears only after Resume Work.
- Every role can join an existing valid shared meeting by meeting ID.
- Shared/global meeting creation is restricted to Team Lead, Manager, Admin, and Super Admin.
- A new meeting created by an Employee or Intern is personal and does not create a shared meeting ID.
- Existing meeting validation checks the shared meeting ID, participant/counterparty, and compatible meeting timing before recording participation.

## 10. Calendar, attendance, and leave presentation

### 10.1 Overall category

Every role sees the same personal My Attendance calendar design on Home:

- Attendance and Productivity modes
- Interactive attendance colour filters
- Day cells with personal punch-in/punch-out information
- Personal attendance details, not a team calendar
- “The Trailer” with personal average working hours, average punch-in, average punch-out, and consistency streak

### 10.2 Intern leave variant

Interns see a compact **Paid leave balance** card below The Trailer:

- Allocation: one paid Casual leave day per month
- Used: approved paid leave
- Pending: submitted but not yet approved
- Remaining: allocation minus approved usage
- No separate Emergency Leave analysis
- No full-width annual leave analysis panel

### 10.3 Employee and senior leave variant

Employee, Team Lead, Manager, Admin, and Super Admin see the full leave usage and allocation analysis below the calendar:

- Casual Leave allocation: 10 days
- Emergency Leave allocation: 4 days
- Approved, pending, remaining, progress, and chart values come from the signed-in user's actual leave records

This is a personal benefit display. A senior role does not see another person's leave balance in this homepage panel.

## 11. Announcements, recognition, and insights

### Intern and Employee

- Do not show routine company live updates, ticket-completion messages, achievements, or recognition.
- Render the ticker only when an administrator/HR announcement or critical announcement exists.
- Do not show Team Insights.
- Do not show Project Insights.

### Team Lead, Manager, Admin, and Super Admin

- Show the full live updates/recognition experience.
- Show Team Insights.
- Show Project Insights.
- Returned data must remain within the viewer's backend-authorized scope; section visibility alone does not grant company-wide data.

## 12. Navigation and tabs around the homepage

The following matrix documents the current sidebar composition.

| Navigation item/section | Intern | Employee | Team Lead | Manager | Admin | Super Admin |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Home | Yes | Yes | Yes | Yes | Yes | Yes |
| Tickets | Yes | Yes | Yes | Yes | Yes | Yes |
| Kanban Board | Yes | Yes | Yes | Yes | Yes | Yes |
| Projects | Yes | Yes | Yes | Yes | Yes | Yes |
| My Attendance | Yes | Yes | Yes | Yes | Yes | Yes |
| Leave | Yes | Yes | Yes | Yes | Yes | Yes |
| Settings | Yes | Yes | Yes | Yes | Yes | Yes |
| My Team | No | No | Yes | Yes | Yes | Yes |
| Attendance Reviews | No | No | Yes | Yes | Yes | Yes |
| Analytics | No | No | Yes | Yes | Yes | Yes |
| Attendance Console | No | No | Yes | Yes | Yes | Yes |
| Activity Log | No | No | Yes | Yes | Yes | Yes |
| Scoped Departments in Main | No | No | No | Yes | No | No |
| Users & Roles | No | No | No | No | Yes | Yes |
| Departments in Admin | No | No | No | No | Yes | Yes |
| HRMS module switcher | Only with `isHR` | Only with `isHR` | Only with `isHR` | Only with `isHR` | Yes | Yes |
| Sales CRM module switcher | No | No | No | No | Yes | Yes |

Notes:

- An HR-flagged non-Admin also receives scoped Departments in Main.
- The present implementation shows Analytics and Attendance Console from Team Lead upward, even though the internal array is named `MANAGER_NAV`.
- Super Admin can select a streamlined Team Lead display mode. That mode hides senior navigation sections for focus, but it does not change the account's underlying Super Admin authority.

## 13. Role-by-role homepage result

### 13.1 Intern

The Intern homepage is a personal workday page. It includes the overall hero, four personal KPIs, workday controls, Quick Access without Create Project, personal calendar, The Trailer, and compact monthly paid-leave balance. It hides approval KPIs, routine live updates/recognition, full leave analysis, Team Insights, Project Insights, and senior navigation.

### 13.2 Employee

The Employee homepage matches the contributor experience, but shows the full 10-day Casual and 4-day Emergency Leave analysis instead of the Intern monthly card. It hides approval KPIs, routine live updates/recognition, Team Insights, Project Insights, and Create Project.

### 13.3 Team Lead

The Team Lead receives the senior homepage: six KPI cards including personal approval queues, recognition/live updates, Team Insights, and Project Insights. Project count remains membership-scoped. Quick Access does not include Create Project. The Team Lead can create a shared meeting ID and receives Team, Analytics, Attendance Console, and Activity Log navigation.

### 13.4 Manager

The Manager receives the senior homepage, shared meeting creation, company-wide active-project headline count, and Create Project. The Manager also receives scoped Departments access based on manager-department assignments. Approval counts remain actionable personal queues, not all approvals in the company.

### 13.5 Admin

The Admin receives the senior homepage, company active-project count, Create Project, shared meeting creation, administrative navigation, Users & Roles, Departments, HRMS, and Sales CRM. Admin may create users. Approval KPIs still show work awaiting that Admin's action rather than an unfiltered company total.

### 13.6 Super Admin

The Super Admin receives the Admin homepage and administrative creation capabilities with the highest authority. Super Admin may use the normal command-center navigation or the optional streamlined Team Lead display mode. `isHR` must not be added to this role.

### 13.7 HR variants

HR must be treated as a capability layered on a canonical role:

- `EMPLOYEE + isHR`: Employee homepage, plus HRMS and scoped Departments navigation. No senior Home cards under current composition.
- `TEAM_LEAD + isHR`: Team Lead homepage plus HRMS and scoped Departments.
- `MANAGER + isHR`: Manager homepage plus HRMS and scoped Departments.
- `ADMIN + isHR`: HR Administrator; Admin homepage plus HR capability.
- `SUPER_ADMIN + isHR`: invalid combination.

## 14. Required data and validation when assigning a user

### Required for account creation

- Unique email
- Name
- Initial password
- Canonical role ID
- Joining date

### Required for reliable hierarchy behavior

- Department for Intern, Employee, Team Lead, and Manager
- Team membership for contributors who belong to a formal team
- Team Lead assignment for each team
- Manager-department access for every department a Manager controls
- `isHR` only where HR capability is intended

### Recommended validation rules

- Reject unknown/noncanonical roles.
- Do not infer a role from designation.
- Warn when a Team Lead has no team assignment.
- Warn when a Manager has neither a department nor manager-department access.
- Reject `SUPER_ADMIN + isHR`.
- Do not allow a creator to assign authority equal to or above their own unless an explicit policy permits it.
- Record every role, department, HR-flag, and hierarchy change in the audit log.
- Recompute the homepage on the next authenticated session after authority changes; do not trust stale client state.

## 15. Security and implementation rules

1. Frontend visibility is presentation, not authorization.
2. Every homepage API must derive the signed-in user from the authenticated token, not from a user ID supplied by the browser.
3. Personal KPI queries must scope by the signed-in user's primary or co-assignee relationship.
4. Approval counts must use the actual approver/hierarchy policy.
5. Team and project insights must be scoped on the server.
6. Company scope is allowed only where this document explicitly grants it.
7. Role changes and `isHR` changes are authority changes and must use protected administrator workflows.
8. Designation, reporting-manager name, and team-lead name are not substitutes for relational hierarchy assignments.

## 16. Acceptance checklist

When a user is created or their role/hierarchy changes, verify all of the following:

- The role badge matches the canonical role.
- Contributor accounts receive four hero KPI cards; senior accounts receive six.
- Employee and Intern never receive approval cards.
- Ticket KPIs contain only the signed-in user's tickets.
- Team Lead project count is membership-scoped.
- Manager/Admin/Super Admin active-project count is company-scoped.
- Intern receives the compact one-day monthly paid-leave card.
- All non-Intern roles receive 10-day Casual and 4-day Emergency analysis.
- Employee/Intern ticker is absent when no announcement exists.
- Employee/Intern never receive Team Insights or Project Insights.
- Team Lead and above receive both insight sections.
- Create Project appears only for Manager, Admin, and Super Admin.
- Shared meeting creation appears only for Team Lead and above.
- Sidebar items match the navigation matrix.
- HRMS appears only for HR-flagged users, Admin, and Super Admin.
- A designation-only edit does not change permissions.
- A role or hierarchy edit changes the next authenticated homepage and server data scope.

## 17. Implementation references

- Canonical role ladder: `backend/src/shared/constants/roles.ts`
- User record and authority fields: `backend/prisma/schema.prisma`
- User creation and attendance-profile initialization: `backend/src/modules/core/users/users.service.ts`
- User-creation route authorization: `backend/src/modules/core/users/users.controller.ts`
- Add New User form: `platforms/core/users/administration/frontend/screens/UsersScreen.tsx`
- Sidebar composition and workspace switcher: `frontend/components/layout/sidebar.tsx`
- Homepage role composition: `platforms/intelligence/dashboard/overview/frontend/screens/DashboardScreen.tsx`
- Hero KPI presentation: `platforms/intelligence/dashboard/overview/frontend/components/HeroKpis.tsx`
- Hero KPI server scoping: `backend/src/modules/platform/dashboard/home-insights.service.ts`
- Quick Access permissions: `platforms/intelligence/dashboard/overview/frontend/screens/WorkspaceSection.tsx`
- Calendar and leave variants: `frontend/components/attendance-v2/home/HomeCalendarPanel.tsx`
- Leave allocation rules: `backend/src/modules/operations/leave/leave-balance.service.ts`
- Meeting authority: `backend/src/modules/platform/workday/meeting.service.ts`
- Leave hierarchy authority: `backend/src/common/services/leave-access.service.ts`

## 18. Current implementation gaps to resolve before calling the flow fully designation-driven

1. The initial Add New User flow does not collect designation, HR capability, team placement, reporting manager, or Team Lead assignment.
2. HR-only users cannot create accounts through the current Users API; account creation is Admin/Super Admin only.
3. An HR-flagged Employee keeps the contributor homepage because Home uses canonical role for senior composition. If HR needs senior Home cards, that must be an explicit product rule and backend scope—not an accidental side effect of `isHR`.
4. Manager/Admin/Super Admin active-project KPI is company-wide, while Team Lead is membership-scoped. Any desired department-only Manager scope would require a deliberate backend rule change.

These are explicit boundaries of the current application, not values that should be guessed from a designation string.
