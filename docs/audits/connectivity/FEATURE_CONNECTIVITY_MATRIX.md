# Feature Connectivity Matrix

## Executive Summary
This read-only audit traces the current Apex OS repo from Prisma models to NestJS services/controllers, frontend API wrappers, pages/components, persistence, refetch behavior and RBAC. The current codebase has many real core modules, but most sensitive workflows are only partially safe because role scope, direct ID reads, SLA timing, analytics counts and local-only settings still diverge.

## Count Summary
| Metric | Count |
|---|---:|
| Total features audited | 188 |
| A_FULLY_CONNECTED | 58 |
| B_PARTIAL_OR_BROKEN | 95 |
| C_FRONTEND_ONLY | 11 |
| D_BACKEND_ONLY | 2 |
| E_UNKNOWN | 1 |
| F_NOT_PRESENT | 21 |
| P0 issues | 27 |
| Features with mock/static/local-only data | 44 |
| Features with frontend UI but no backend | 11 |
| Features with backend but no frontend | 2 |

## Status Definitions
- A_FULLY_CONNECTED: backend model/API, frontend calls, persistence, role scope, loading/error states and counts are all materially in place.
- B_PARTIAL_OR_BROKEN: backend and frontend both exist, but connection, scope, count consistency, refetch, mutation or safety is incomplete.
- C_FRONTEND_ONLY: UI exists but data is mock/static/local-only or lacks real backend/database persistence.
- D_BACKEND_ONLY: backend model/API/service exists but no meaningful frontend UI is connected.
- E_UNKNOWN: not enough evidence found in this read-only audit.
- F_NOT_PRESENT: feature does not exist in the current repo.

## Feature Matrix

### Auth/RBAC
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-001 | Authentication / Login | Auth/RBAC | Yes | Yes | Yes | Yes | Yes | No | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P1 | AUTH1, AUTH2, FEAUTH1, FEAUTH2 | Login and token storage are real, but the dashboard guard can redirect before auth persistence hydrates. |
| FEAT-002 | Current User / Session Profile | Auth/RBAC | Yes | Yes | Yes | Partial | Yes | No | Partial | Unknown | Partial | B_PARTIAL_OR_BROKEN | P1 | AUTH1, FEAUTH2, API1 | GET /auth/me exists, but the UI mostly trusts persisted login state instead of consistently refetching current user. |
| FEAT-003 | RBAC / Role Permissions | Auth/RBAC | Partial | Yes | Partial | Partial | Yes | No | Partial | Partial | Partial | B_PARTIAL_OR_BROKEN | P0 | ROLES1, USERS1, TICKETS1, PROJECTS1, LEAVE1, DASH1 | Role constants exist, but direct ID reads and some manager/team-lead actions are not consistently scoped. |
| FEAT-004 | User List | Auth/RBAC | Yes | Yes | Yes | Yes | Yes | No | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P0 | USERS1, USERS2, FEUSERS1 | User list is connected and paginated, but backend GET /users is authenticated only, exposing directory data beyond admins. |
| FEAT-005 | Add User | Auth/RBAC | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | USERS1, USERS2, FEUSERS1 | Create user UI calls the guarded users API and persists role and department. |
| FEAT-006 | Edit User | Auth/RBAC | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | USERS1, USERS2, FEUSERS1 | Edit user mutation persists role, department, and profile fields through the backend. |
| FEAT-007 | Activate / Deactivate User | Auth/RBAC | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | USERS1, USERS2, FEUSERS1 | Active flag is editable and persisted through the users update flow. |
| FEAT-008 | User Status | Auth/RBAC | Partial | Partial | Partial | Partial | Partial | No | Partial | Unknown | Partial | B_PARTIAL_OR_BROKEN | P1 | SCHEMA_USER, WORKDAY1, FEUSERS1 | The app has isActive and currentStatus, but not the full invited, suspended, deactivated lifecycle. |
| FEAT-009 | User Role Badges | Auth/RBAC | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P2 | SCHEMA_USER, USERS2, FEUSERS1 | Role badges are read from the role relation rather than a static frontend list. |
| FEAT-010 | User Department Assignment | Auth/RBAC | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | SCHEMA_USER, USERS2, FEUSERS1 | Department assignment is a persisted User.department relation and editable by admin flows. |

### HRMS Profile
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-011 | User Profile Header | HRMS Profile | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | SCHEMA_USER, USERS1, FEUSERPROFILE1 | Profile header uses real user, role, department, avatar, and active fields. |
| FEAT-012 | Personal Details | HRMS Profile | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | SCHEMA_USER, USERS2, FEUSERPROFILE1 | Personal fields exist in Prisma and are loaded/saved through profile APIs. |
| FEAT-013 | Employment Details | HRMS Profile | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | SCHEMA_USER, USERS2, FEUSERPROFILE1 | Employment fields are present in the user model and connected in the profile screen. |
| FEAT-014 | Account & Access | HRMS Profile | Yes | Yes | Partial | Partial | Partial | No | Partial | Unknown | Partial | B_PARTIAL_OR_BROKEN | P1 | SCHEMA_USER, USERS1, FEUSERPROFILE1 | Role and status display exists, but session/last-active and reset/account flows are fragmented. |
| FEAT-015 | Payroll & Statutory | HRMS Profile | Yes | Yes | Yes | Yes | Yes | No | Partial | Unknown | Yes | B_PARTIAL_OR_BROKEN | P0 | SCHEMA_USER, USERS2, FEUSERPROFILE1 | Payroll fields persist, but sensitive data protection depends on profile API discipline and needs stronger audit coverage. |
| FEAT-016 | Documents & Verification | HRMS Profile | Yes | Yes | Yes | Yes | Yes | No | Partial | Unknown | Yes | B_PARTIAL_OR_BROKEN | P0 | SCHEMA_DOCS, USERS1, USERS2, FEUSERPROFILE1 | Document upload and verification exist, but document storage/access controls need hardening. |
| FEAT-017 | HR Notes | HRMS Profile | Yes | Yes | Yes | Yes | Yes | No | Yes | Unknown | Yes | A_FULLY_CONNECTED | P1 | SCHEMA_USER, USERS2, FEUSERPROFILE1 | HR notes are persisted in the protected profile update path. |
| FEAT-018 | Verification Details | HRMS Profile | Partial | Yes | Partial | Partial | Partial | No | Partial | Unknown | Partial | B_PARTIAL_OR_BROKEN | P1 | SCHEMA_USER, SCHEMA_DOCS, USERS2, FEUSERPROFILE1 | Document verification is implemented, but user-level verification status is only partly surfaced. |

### Departments/Teams
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-019 | Departments List | Departments/Teams | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | SCHEMA_DEPT, DEPTS1, FEDEPTS1 | Department list uses backend cards with counts and member data. |
| FEAT-020 | New Department | Departments/Teams | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | DEPTS1, FEDEPTS1 | Create department is guarded and persists through the departments API. |
| FEAT-021 | Edit Department | Departments/Teams | Yes | Yes | Yes | Yes | Yes | No | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P1 | DEPTS1, FEDEPTDETAIL1 | Name and metadata save, but lead edits are role-derived rather than a true lead relation. |
| FEAT-022 | Delete/Archive Department | Departments/Teams | Yes | Yes | Partial | Yes | Yes | No | Yes | Partial | Yes | B_PARTIAL_OR_BROKEN | P1 | DEPTS1, FEDEPTS1 | Delete exists and blocks active tickets, but there is no archive state. |
| FEAT-023 | Department Detail | Departments/Teams | Yes | Yes | Yes | Yes | Yes | No | Yes | Partial | Yes | A_FULLY_CONNECTED | P1 | DEPTS1, FEDEPTDETAIL1 | Detail page loads real department, members, ticket and leave metrics. |
| FEAT-024 | Department Lead | Departments/Teams | Partial | No | Partial | Partial | Partial | No | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P1 | SCHEMA_DEPT, DEPTS2, FEDEPTDETAIL1 | Lead is inferred from MANAGER or TEAM_LEAD users in a department, not stored as a validated relation. |
| FEAT-025 | Add Member to Department | Departments/Teams | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | USERS1, FEDEPTDETAIL1 | Adding/removing members updates User.departmentId through the users API. |
| FEAT-026 | Department Metrics | Departments/Teams | Yes | Yes | Partial | Yes | Yes | No | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P1 | DEPTS2, FEDEPTDETAIL1 | Member/ticket/project/leave metrics exist, but logic is duplicated and partly derived. |
| FEAT-027 | Company Directory | Departments/Teams | Yes | Yes | Yes | Yes | Yes | No | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P1 | USERS1, TEAMFE1 | Directory data is real, but access is limited and team/company concepts are mixed. |
| FEAT-028 | Live Status Directory | Departments/Teams | Partial | Yes | Yes | Yes | Yes | No | Partial | Unknown | Partial | B_PARTIAL_OR_BROKEN | P2 | WORKDAY1, TEAMFE1 | Workday status is persisted and displayed, but directory presence is not a full realtime presence system. |
| FEAT-029 | Teams Model | Departments/Teams | No | No | No | No | No | No | No | No | No | F_NOT_PRESENT | P2 | SCHEMA_DEPT, SCHEMA_USER | There is no separate Team model; teams are represented by departments and roles. |
| FEAT-030 | Team Members | Departments/Teams | Partial | Partial | Partial | Partial | Partial | No | Partial | Partial | Partial | B_PARTIAL_OR_BROKEN | P1 | SCHEMA_DEPT, USERS2, TEAMFE1 | Team members work through department membership, not a dedicated team membership model. |

### Workday/Attendance
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-031 | Workday Start | Workday/Attendance | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | SCHEMA_WORKDAY, WORKDAY1, FEWORKDAY1 | Start work creates/updates a persisted WorkSession and attendance event. |
| FEAT-032 | Workday Active State | Workday/Attendance | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | WORKDAY1, FEWORKDAY1 | Active state, started time, and duration come from today workday API data. |
| FEAT-033 | Break Flow | Workday/Attendance | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | SCHEMA_WORKDAY, WORKDAY1, FEWORKDAY1 | Break start/end is backed by BreakLog records. |
| FEAT-034 | Break Types | Workday/Attendance | Yes | No | Partial | Yes | Partial | Yes | No | No | Yes | C_FRONTEND_ONLY | P2 | FEWORKDAY1 | Break type choices are static UI options; backend persists only the chosen string. |
| FEAT-035 | Resume Work | Workday/Attendance | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | WORKDAY1, FEWORKDAY1 | Resume work is connected through the workday API. |
| FEAT-036 | End Workday | Workday/Attendance | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | WORKDAY1, FEWORKDAY1 | End day updates the WorkSession and returns summary values. |
| FEAT-037 | End Day Summary | Workday/Attendance | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | WORKDAY1, FEWORKDAY1 | Work time and break totals are computed from persisted session/break records. |
| FEAT-038 | Workday Logs | Workday/Attendance | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | SCHEMA_WORKDAY, WORKDAY1 | Workday and attendance events are stored in WorkSession, BreakLog, and AttendanceEvent. |
| FEAT-039 | Team Workday Visibility | Workday/Attendance | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | WORKDAY1, TEAMFE1 | Team visibility calls the scoped workday team endpoint. |
| FEAT-040 | Idle Tracking | Workday/Attendance | Yes | Yes | Yes | Yes | Yes | No | Yes | Unknown | Yes | A_FULLY_CONNECTED | P2 | WORKDAY1, FEWORKDAY1 | Idle reporting and resume endpoints are present and wired to the workday UI. |

### Tickets
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-041 | Ticket List Page | Tickets | Yes | Yes | Yes | Yes | Yes | No | Yes | Partial | Yes | A_FULLY_CONNECTED | P1 | SCHEMA_TICKET, TICKETS1, FETICKETS1 | Ticket list loads paginated, role-scoped tickets through the backend. |
| FEAT-042 | New Ticket | Tickets | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | TICKETS1, TICKETS2, FENEWTICKET1 | Create ticket form posts to the backend and persists relations and subtype data. |
| FEAT-043 | Ticket Search | Tickets | Yes | Yes | Yes | Yes | Yes | No | Yes | Partial | Yes | A_FULLY_CONNECTED | P1 | TICKETS2, FETICKETS1 | Search is passed to backend ticket filters and refetches the list. |
| FEAT-044 | Ticket Filters | Tickets | Partial | Yes | Partial | Partial | Yes | No | Yes | Partial | Yes | B_PARTIAL_OR_BROKEN | P1 | TICKETS2, FETICKETS1 | Status, category, priority and department are wired, but due/overdue/assignee/project filters are incomplete in UI. |
| FEAT-045 | Ticket Sorting | Tickets | Partial | Yes | Partial | Partial | Yes | No | Yes | Partial | Partial | B_PARTIAL_OR_BROKEN | P2 | TICKETS2, FETICKETS1 | Backend has fixed ordering, but user-facing sort controls are incomplete. |
| FEAT-046 | Ticket Status Tabs | Tickets | Yes | Yes | Partial | Yes | Yes | No | Yes | Partial | Yes | B_PARTIAL_OR_BROKEN | P1 | TICKETS3, FETICKETS1 | Tabs filter real data, but tab counts and backend stats are separate calculations. |
| FEAT-047 | Ticket Export | Tickets | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P2 | TICKETS1, TICKETS2, FETICKETS1 | Ticket CSV export calls the backend scoped export endpoint. |
| FEAT-048 | Ticket Detail Page | Tickets | Yes | Yes | Partial | Yes | Yes | No | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P0 | TICKETS1, TICKETS2, FETICKETDETAIL1 | Detail UI is real, but backend findOne is not role scoped by ticket ID. |
| FEAT-049 | Ticket Comments | Tickets | Yes | Yes | Partial | Yes | Yes | No | Partial | Unknown | Yes | B_PARTIAL_OR_BROKEN | P0 | COMMENTS1, FETICKETDETAIL1 | Comment APIs exist, but they rely on ticket ID access without enough scoped ticket checks. |
| FEAT-050 | Ticket History | Tickets | Yes | Yes | Partial | Yes | Yes | No | Partial | Unknown | Yes | B_PARTIAL_OR_BROKEN | P0 | TICKETS1, TICKETS2, FETICKETDETAIL1 | History is logged and shown, but history fetch is not scoped by accessible ticket. |
| FEAT-051 | Ticket Attachments | Tickets | Yes | Yes | Partial | Yes | Yes | No | Partial | Unknown | Yes | B_PARTIAL_OR_BROKEN | P0 | TICKETS1, UPLOADS1, FETICKETDETAIL1 | Uploads persist, but attachment access inherits the unscoped ticket detail risk. |
| FEAT-052 | Ticket Assignment | Tickets | Yes | Yes | Partial | Yes | Yes | No | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P0 | TICKETS1, TICKETS2, FETICKETDETAIL1 | Assignment mutates backend state, but manager/admin scope is broad and frontend role assumptions differ. |
| FEAT-053 | Ticket Reassignment | Tickets | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | TICKETS2, FETICKETDETAIL1 | Assigned-to changes are persisted and written to ticket history. |
| FEAT-054 | Ticket Status Workflow | Tickets | Yes | Yes | Partial | Yes | Yes | No | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P0 | TICKETS2, FETICKETDETAIL1 | Status updates persist, but transition and approval rules differ between frontend and backend. |
| FEAT-055 | Ticket Close/Reopen | Tickets | Partial | Yes | Partial | Partial | Yes | No | Partial | Partial | Partial | B_PARTIAL_OR_BROKEN | P1 | TICKETS2, FETICKETDETAIL1 | Close can be sent as a status update, but no complete reopen workflow was found. |
| FEAT-056 | Ticket Edit | Tickets | Yes | Yes | Partial | Yes | Yes | No | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P1 | TICKETS2, FETICKETDETAIL1 | Edit persists, but authorization is broader than department/team ownership. |
| FEAT-057 | Ticket Delete | Tickets | Yes | Yes | Partial | Yes | Yes | No | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P0 | TICKETS1, FETICKETDETAIL1 | Delete is guarded by role but not department scope and appears to hard-delete rather than archive. |
| FEAT-058 | Ticket Project Link | Tickets | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | SCHEMA_TICKET, TICKETS2, PROJECTS2, FENEWTICKET1 | Ticket projectId relation is persisted and displayed. |
| FEAT-059 | Ticket Reporter | Tickets | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | SCHEMA_TICKET, TICKETS2, FETICKETDETAIL1 | Reporter is the createdBy relation and is displayed in ticket views. |
| FEAT-060 | Ticket Category/Department | Tickets | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | SCHEMA_TICKET, TICKETS2, FETICKETS1 | Category and department are separate persisted fields/relations. |
| FEAT-061 | Ticket Type/Subtype | Tickets | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | SCHEMA_TASKTYPES, TASKTYPES1, FENEWTICKET1 | Task types and subtypes are backed by database models and used in ticket creation. |

### SLA/Timing
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-062 | SLA Settings | SLA/Timing | Yes | Yes | Partial | Yes | Yes | Partial | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P0 | SETTINGS1, TICKETS2, FESETTINGS1 | SLA settings persist, but execution SLA still uses hardcoded priority hours. |
| FEAT-063 | Ticket SLA Timer | SLA/Timing | Yes | Yes | Partial | Yes | Yes | Partial | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P0 | TICKETS2, FETICKETDETAIL1, SLAUTIL1 | Timer data exists, but frontend and backend calculations are duplicated and inconsistent. |
| FEAT-064 | SLA Progress Bar | SLA/Timing | Yes | Yes | Partial | Yes | Yes | Partial | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P0 | TICKETS2, SLAUTIL1, FEKANBAN1 | Progress bars are displayed, but calculation paths differ across ticket list/detail/kanban. |
| FEAT-065 | Overdue Badge | SLA/Timing | Yes | Yes | Partial | Yes | Yes | Partial | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P0 | TICKETS2, TICKETS3, SLAUTIL1 | Overdue badge logic mixes dueDate, executionDueAt, reviewDueAt and stats queries. |
| FEAT-066 | Immediate Overdue Bug Check | SLA/Timing | Partial | Yes | Partial | Partial | Yes | Partial | Partial | Partial | Partial | B_PARTIAL_OR_BROKEN | P0 | TICKETS2, SLAUTIL1 | New-ticket timing is improved by due dates, but mixed timer sources still leave immediate-overdue regression risk. |
| FEAT-067 | Working Hours Aware SLA | SLA/Timing | No | No | No | No | No | No | No | No | No | F_NOT_PRESENT | P2 | TICKETS2, SETTINGS1 | No working-hours-aware SLA engine was found. |
| FEAT-068 | Pause/Resume SLA | SLA/Timing | No | No | No | No | No | No | No | No | No | F_NOT_PRESENT | P2 | TICKETS2 | No SLA pause/resume state was found. |
| FEAT-069 | Shared Ticket Timing Utility | SLA/Timing | Partial | Yes | Partial | Partial | Yes | Partial | Partial | Partial | Partial | B_PARTIAL_OR_BROKEN | P1 | SLAUTIL1, TICKETS2 | There is a frontend SLA utility, but backend timing logic remains separate. |
| FEAT-070 | SLA Risk Categories | SLA/Timing | Partial | Yes | Partial | Partial | Yes | Partial | Partial | Partial | Partial | B_PARTIAL_OR_BROKEN | P1 | HOME1, TICKETS3 | Some risk counts exist, but blocker, review-ageing and acknowledgement flows are incomplete. |

### Kanban
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-071 | Kanban Board Page | Kanban | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | TICKETS1, TICKETS2, FEKANBAN1 | Kanban columns and cards load from scoped backend ticket data. |
| FEAT-072 | Kanban Drag-and-Drop | Kanban | Yes | Yes | Partial | Yes | Yes | No | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P1 | TICKETS1, TICKETS2, FEKANBAN1 | Drag sends backend status updates, but frontend team-lead permissions can exceed backend rules. |
| FEAT-073 | Kanban Filters | Kanban | Partial | Yes | Partial | Partial | Yes | No | Yes | Partial | Yes | B_PARTIAL_OR_BROKEN | P2 | TICKETS2, FEKANBAN1 | Kanban filtering is limited mainly to department. |
| FEAT-074 | Kanban Card SLA Display | Kanban | Yes | Yes | Partial | Yes | Yes | Partial | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P1 | FEKANBAN1, SLAUTIL1, TICKETS2 | Cards show SLA data, but use the same inconsistent timing sources as tickets. |
| FEAT-075 | Kanban Count Consistency | Kanban | Partial | Yes | Partial | Partial | Yes | No | Yes | Partial | Partial | B_PARTIAL_OR_BROKEN | P0 | TICKETS2, TICKETS3, FEKANBAN1 | Kanban counts exclude closed tickets and are separate from list/stats queries. |
| FEAT-076 | Kanban UI Contrast | Kanban | Yes | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | E_UNKNOWN | P2 | FEKANBAN1 | No screenshot/browser QA was run in this read-only audit, so contrast is unknown. |

### Projects
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-077 | Projects List | Projects | Yes | Yes | Yes | Yes | Yes | No | Yes | Partial | Yes | A_FULLY_CONNECTED | P1 | SCHEMA_PROJECT, PROJECTS1, FEPROJECTS1 | Project list is backed by paginated, scoped project API data. |
| FEAT-078 | New Project | Projects | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | PROJECTS1, PROJECTS2, FEPROJECTS1 | Create project is guarded and persists owner/team data. |
| FEAT-079 | Edit Project | Projects | Yes | Yes | Partial | Yes | Yes | No | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P0 | PROJECTS1, PROJECTS2, FEPROJECTDETAIL1 | Edit persists, but frontend permits TEAM_LEAD while backend allows manager/admin/superadmin only. |
| FEAT-080 | Delete/Archive Project | Projects | Yes | Yes | Partial | Yes | Yes | No | Yes | Partial | Yes | B_PARTIAL_OR_BROKEN | P1 | PROJECTS1, FEPROJECTDETAIL1 | Delete exists for admin roles, but no archive workflow is present. |
| FEAT-081 | Project Detail | Projects | Yes | Yes | Partial | Yes | Yes | No | Partial | Partial | Yes | A_FULLY_CONNECTED | P1 | PROJECTS1, PROJECTS2, FEPROJECTDETAIL1 | Project detail renders real project, tickets, members, and progress. |
| FEAT-082 | Project Tickets | Projects | Partial | Yes | Yes | Partial | Yes | No | Partial | Partial | Partial | B_PARTIAL_OR_BROKEN | P1 | PROJECTS2, FEPROJECTDETAIL1, FENEWTICKET1 | Linked tickets display, but adding existing tickets is mostly through ticket create/edit rather than project detail. |
| FEAT-083 | Project Team | Projects | Partial | Yes | Yes | Partial | Yes | No | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P1 | SCHEMA_PROJECT, PROJECTS1, PROJECTS2, FEPROJECTDETAIL1 | Backend member APIs exist, but project detail lacks complete add/remove member UI. |
| FEAT-084 | Project Progress | Projects | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | PROJECTS2, FEPROJECTDETAIL1 | Progress is computed from linked ticket completion. |
| FEAT-085 | Project Priority | Projects | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P2 | SCHEMA_PROJECT, PROJECTS2, FEPROJECTS1 | Project priority is a persisted enum and displayed in UI. |
| FEAT-086 | Project Status | Projects | Yes | Yes | Partial | Yes | Yes | No | Yes | Partial | Yes | B_PARTIAL_OR_BROKEN | P2 | SCHEMA_PROJECT, PROJECTS2, FEPROJECTS1 | Status is persisted, but does not cover all requested on-track/at-risk/delayed/archive states. |
| FEAT-087 | Strategic Projects Workspace | Projects | No | No | No | No | No | No | No | No | No | F_NOT_PRESENT | P3 | FEPROJECTS1, FEPROJECTDETAIL1 | No separate strategic-projects focus workspace was found. |

### Tasks/Checklist
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-088 | My Tasks Panel | Tasks/Checklist | No | No | No | No | No | No | No | No | No | F_NOT_PRESENT | P3 | ROUTES1 | No separate personal task panel was found beyond tickets and quick actions. |
| FEAT-089 | Task Board | Tasks/Checklist | No | No | No | No | No | No | No | No | No | F_NOT_PRESENT | P3 | ROUTES1, SCHEMA_ALL | No standalone task board or Task model was found. |
| FEAT-090 | Checklist Operations Console | Tasks/Checklist | Yes | No | No | No | No | Yes | No | No | Yes | C_FRONTEND_ONLY | P3 | QUICK1 | Checklist/operations console behavior is static quick-action UI, not persisted tasks. |
| FEAT-091 | Add Personal Task | Tasks/Checklist | No | No | No | No | No | No | No | No | No | F_NOT_PRESENT | P3 | SCHEMA_ALL, API1 | No personal task persistence model or API was found. |
| FEAT-092 | Add Team Duty | Tasks/Checklist | No | No | No | No | No | No | No | No | No | F_NOT_PRESENT | P3 | SCHEMA_ALL, API1 | No team duty persistence model or API was found. |
| FEAT-093 | Complete Task | Tasks/Checklist | No | No | No | No | No | No | No | No | No | F_NOT_PRESENT | P3 | SCHEMA_ALL, API1 | No task completion API was found. |
| FEAT-094 | Task Due Time | Tasks/Checklist | No | No | No | No | No | No | No | No | No | F_NOT_PRESENT | P3 | SCHEMA_ALL, API1 | No task due time persistence exists outside ticket due dates. |
| FEAT-095 | Task Owner | Tasks/Checklist | No | No | No | No | No | No | No | No | No | F_NOT_PRESENT | P3 | SCHEMA_ALL | No task owner relation exists outside tickets/projects. |

### Leave
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-096 | Leave List | Leave | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | SCHEMA_LEAVE, LEAVE1, FELEAVE1 | Leave list uses paginated, role-scoped backend data. |
| FEAT-097 | Apply Leave | Leave | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | LEAVE1, LEAVE2, FELEAVE1 | Apply leave posts to backend and persists a LeaveRequest. |
| FEAT-098 | Leave Summary Cards | Leave | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | LEAVE2, FELEAVE1 | Summary cards read backend leave stats. |
| FEAT-099 | Leave Tabs | Leave | Yes | Yes | Partial | Yes | Yes | No | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P1 | LEAVE2, FELEAVE1 | Tabs are connected, but role/approval assumptions differ for TEAM_LEAD. |
| FEAT-100 | Leave Approval | Leave | Yes | Yes | Partial | Yes | Yes | No | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P0 | LEAVE1, LEAVE2, FELEAVE1 | Approval persists, but backend does not fully enforce department/managed-department scope by ID. |
| FEAT-101 | Leave Rejection | Leave | Yes | Yes | Partial | Yes | Yes | No | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P0 | LEAVE1, LEAVE2, FELEAVE1 | Rejection persists, but has the same scope issue as approval. |
| FEAT-102 | Leave Types | Leave | Partial | Yes | Partial | Partial | Yes | No | Yes | Yes | Yes | B_PARTIAL_OR_BROKEN | P2 | SCHEMA_LEAVE, FELEAVE1 | Leave enum covers annual/sick/emergency/unpaid/other, not the full requested type set. |
| FEAT-103 | Leave Policy Settings | Leave | Yes | Yes | Yes | Yes | Yes | No | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P1 | SETTINGS1, FESETTINGS1, LEAVE2 | Leave policy values save, but they are not clearly used in leave balance enforcement. |
| FEAT-104 | Leave Balance Calculation | Leave | No | No | No | No | No | No | No | No | No | F_NOT_PRESENT | P1 | LEAVE2, FELEAVE1 | No durable leave balance calculation service/UI was found. |
| FEAT-105 | Leave Count Consistency | Leave | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | LEAVE2, FELEAVE1 | List and stats are generated by the same LeaveService scope helpers. |
| FEAT-106 | Leave Notifications | Leave | Partial | Yes | Partial | Partial | Yes | No | Partial | Unknown | Yes | B_PARTIAL_OR_BROKEN | P1 | LEAVE2, NOTIFS1 | Approval/rejection notifications exist, but preference enforcement and applied-notification coverage are incomplete. |

### Analytics/Reporting
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-107 | Analytics Overview | Analytics/Reporting | Yes | Yes | Partial | Yes | Yes | No | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P0 | DASH1, FEANALYTICS1 | Overview is connected, but totalTickets is unscoped while other values use role scope. |
| FEAT-108 | Ticket Trend Chart | Analytics/Reporting | Yes | Yes | Partial | Yes | Yes | No | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P0 | DASH1, FEANALYTICS1 | Trend chart is real, but resolved counts are derived from createdAt rather than a resolved timestamp. |
| FEAT-109 | Category Donut Chart | Analytics/Reporting | Yes | Yes | Partial | Yes | Yes | No | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P0 | DASH1, FEANALYTICS1 | Category data is backend-driven but not role scoped. |
| FEAT-110 | Team Workload | Analytics/Reporting | Yes | Yes | Partial | Yes | Yes | No | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P0 | DASH1, FEANALYTICS1 | Workload data is backend-driven but not role scoped to manager/team visibility. |
| FEAT-111 | Detailed Analytics Tab | Analytics/Reporting | Yes | Yes | Partial | Yes | Yes | No | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P1 | FEANALYTICS1, TICKETS2 | Detailed view uses a capped ticket list rather than a dedicated analytics query. |
| FEAT-112 | Analytics Scope Consistency | Analytics/Reporting | Partial | Yes | Partial | Partial | Yes | No | Partial | Partial | Partial | B_PARTIAL_OR_BROKEN | P0 | DASH1, FEANALYTICS1 | Analytics filters, role scope, and counts are not consistently shared with ticket list queries. |
| FEAT-113 | Reports Export | Analytics/Reporting | Partial | Yes | Partial | Partial | Yes | No | Partial | Partial | Partial | B_PARTIAL_OR_BROKEN | P1 | REPORTS1, FETICKETS1, FEANALYTICS1 | Reports route redirects to analytics and only ticket CSV export is complete. |

### Delivery Risk
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-114 | Delivery Risk Snapshot | Delivery Risk | Partial | Yes | Partial | Partial | Yes | Partial | Partial | Partial | Partial | B_PARTIAL_OR_BROKEN | P1 | HOME1, DASHFE1 | Dashboard risk cards exist, but are not a complete delivery-risk subsystem. |
| FEAT-115 | Delivery SLA Risks Analyzer | Delivery Risk | Yes | No | No | No | No | Yes | No | No | Yes | C_FRONTEND_ONLY | P2 | QUICK1 | Risk analyzer quick action is static navigation, not a real analyzer API/page. |
| FEAT-116 | Blocked Tickets Risk | Delivery Risk | No | No | No | No | No | No | No | No | No | F_NOT_PRESENT | P2 | SCHEMA_TICKET, TICKETS3 | No blocked status/risk query was found. |
| FEAT-117 | SLA Breach Risk | Delivery Risk | Partial | Yes | Partial | Partial | Yes | No | Partial | Partial | Partial | B_PARTIAL_OR_BROKEN | P1 | TICKETS3, HOME1 | Overdue/SLA risk counts exist, but depend on inconsistent SLA logic. |
| FEAT-118 | Unassigned Tickets Risk | Delivery Risk | Partial | Yes | Partial | Partial | Yes | No | Partial | Partial | Partial | B_PARTIAL_OR_BROKEN | P1 | TICKETS3, HOME1 | Unassigned risk counts exist in stats/home data, but not as a complete risk workflow. |
| FEAT-119 | Review Ageing Risk | Delivery Risk | Partial | Yes | Partial | Partial | Yes | Partial | Partial | Partial | Partial | B_PARTIAL_OR_BROKEN | P1 | HOME1, TICKETS2 | Review ageing is partially inferred but no complete ageing query/workflow exists. |
| FEAT-120 | Risk Acknowledgement | Delivery Risk | No | No | No | No | No | No | No | No | No | F_NOT_PRESENT | P2 | EVENTS1, QUICK1 | No risk ACK mutation or audit event was found. |
| FEAT-121 | Risk Severity | Delivery Risk | Partial | Partial | Partial | Partial | Partial | Partial | Partial | Partial | Partial | B_PARTIAL_OR_BROKEN | P2 | HOME1, DASHFE1 | Severity labels exist in generated alerts/UI, but not as a normalized backend model. |

### Notifications
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-122 | Dashboard Notifications | Notifications | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | SCHEMA_NOTIF, NOTIFS1, FENOTIFS1 | Notification list/panel loads real backend notifications. |
| FEAT-123 | Notification Bell | Notifications | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | NOTIFS1, FENOTIFS1 | Unread count uses backend unread-count and refetches after mutations. |
| FEAT-124 | System Alerts Dropdown | Notifications | Yes | No | No | No | No | Yes | No | No | Yes | C_FRONTEND_ONLY | P3 | DASHFE1, QUICK1 | Mockup-style system alerts are UI/static and separate from real notifications. |
| FEAT-125 | Mark All Read | Notifications | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | NOTIFS1, FENOTIFS1 | Mark all read calls the backend and invalidates notification queries. |
| FEAT-126 | Dismiss Alert | Notifications | No | Yes | Yes | No | Yes | No | Yes | Unknown | Unknown | D_BACKEND_ONLY | P2 | NOTIFS1, API1 | Backend delete exists with ownership checks, but no complete dismiss/delete UI was found. |
| FEAT-127 | Notification Preferences | Notifications | Yes | Yes | Partial | Yes | Yes | Partial | Partial | Unknown | Yes | B_PARTIAL_OR_BROKEN | P1 | USERS2, FESETTINGS1, NOTIFS1 | Preferences persist in AppSetting, but notification triggers do not enforce them. |
| FEAT-128 | Quiet Hours | Notifications | Yes | Partial | Partial | Yes | Partial | Yes | No | No | Yes | C_FRONTEND_ONLY | P2 | FESETTINGS1, NOTIFS1 | Quiet-hours UI/storage exists, but backend delivery enforcement was not found. |
| FEAT-129 | Notification Event Triggers | Notifications | Partial | Yes | Partial | Partial | Yes | Partial | Partial | Unknown | Yes | B_PARTIAL_OR_BROKEN | P1 | TICKETS2, LEAVE2, NOTIFS1 | Ticket/leave triggers exist, but preference enforcement and duplicate channels remain incomplete. |

### Command Center
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-130 | Command Center Shell | Command Center | Yes | Partial | Partial | Partial | Partial | No | Partial | Unknown | Partial | B_PARTIAL_OR_BROKEN | P1 | LAYOUT1, DASHFE1 | Shell exists, but protected-route/auth hydration and role visibility are not fully stable. |
| FEAT-131 | Global Command Search | Command Center | Yes | Yes | Partial | Partial | Yes | Partial | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P2 | COMMAND1, API1 | Command search queries real tickets/projects/people, but not every requested domain. |
| FEAT-132 | Command Palette / Quick Actions | Command Center | Yes | Partial | Partial | Partial | Partial | Yes | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P2 | COMMAND1, QUICK1 | Command palette is partly real search and partly static action definitions. |
| FEAT-133 | Quick Action: Create New Ticket | Command Center | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P2 | QUICK1, FENEWTICKET1 | Quick action routes to the real new-ticket workflow. |
| FEAT-134 | Quick Action: Review Delivery Risks | Command Center | Yes | No | No | No | No | Yes | No | No | Yes | C_FRONTEND_ONLY | P2 | QUICK1 | Action routes to a ticket priority filter, not a delivery-risk analyzer. |
| FEAT-135 | Quick Action: Check Due Today | Command Center | Yes | Yes | Partial | Partial | Partial | Partial | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P2 | QUICK1, FETICKETS1 | Due-today route parameter is not consistently consumed by the tickets page. |
| FEAT-136 | Quick Action: Review High Priority | Command Center | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P2 | QUICK1, FETICKETS1 | High-priority action maps to ticket priority filtering. |
| FEAT-137 | Quick Action: Open Projects | Command Center | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P2 | QUICK1, FEPROJECTS1 | Projects action routes to the real projects page. |
| FEAT-138 | Quick Action: Check Team Availability | Command Center | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P2 | QUICK1, TEAMFE1 | Team availability action opens connected team/workday data. |
| FEAT-139 | Quick Action: Review Leave Requests | Command Center | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P2 | QUICK1, FELEAVE1 | Leave request action opens the real leave workflow. |

### Broadcasts/Calendar
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-140 | Operations Broadcast Banner | Broadcasts/Calendar | Yes | No | No | No | No | Yes | No | No | Yes | C_FRONTEND_ONLY | P3 | BROADCAST1 | Broadcast banner is a static component with optional local props only. |
| FEAT-141 | Broadcast Details Modal | Broadcasts/Calendar | Yes | No | No | No | No | Yes | No | No | Yes | C_FRONTEND_ONLY | P3 | BROADCAST1 | Broadcast details are frontend-only/static. |
| FEAT-142 | Acknowledge Broadcast | Broadcasts/Calendar | No | No | No | No | No | No | No | No | No | F_NOT_PRESENT | P3 | BROADCAST1, EVENTS1 | No acknowledgement mutation or audit event exists. |
| FEAT-143 | Add to Calendar | Broadcasts/Calendar | Yes | No | No | No | No | Yes | No | No | Yes | C_FRONTEND_ONLY | P3 | BROADCAST1 | Broadcast add-to-calendar only toggles local UI state. |
| FEAT-144 | Create Pre-review Ticket from Broadcast | Broadcasts/Calendar | No | No | No | No | No | No | No | No | No | F_NOT_PRESENT | P3 | BROADCAST1, FENEWTICKET1 | No broadcast-to-ticket integration exists. |
| FEAT-145 | Broadcast History | Broadcasts/Calendar | No | No | No | No | No | No | No | No | No | F_NOT_PRESENT | P3 | BROADCAST1 | No broadcast history model/API/page was found. |
| FEAT-146 | Critical Timeline Milestones | Broadcasts/Calendar | Partial | Yes | Partial | Partial | Yes | No | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P2 | CALENDAR1, HOME1 | Timeline/calendar uses tickets and approved leave, not a durable milestone model. |
| FEAT-147 | Milestone Types | Broadcasts/Calendar | Partial | Partial | Partial | Partial | Partial | No | Partial | Partial | Partial | B_PARTIAL_OR_BROKEN | P2 | CALENDAR1 | Calendar event types cover tickets/leave, not release/meeting/deadline/approval taxonomy. |
| FEAT-148 | Milestone Links | Broadcasts/Calendar | Partial | Partial | Partial | Partial | Partial | No | Partial | Partial | Partial | B_PARTIAL_OR_BROKEN | P2 | CALENDAR1 | Calendar links exist for tickets/leave only, not broad ticket/project/department milestones. |

### Settings
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-149 | Settings Shell | Settings | Yes | Yes | Yes | Yes | Yes | No | Yes | Unknown | Yes | A_FULLY_CONNECTED | P1 | FESETTINGS1, SETTINGS1 | Settings navigation and admin visibility are connected to real APIs. |
| FEAT-150 | Settings Profile | Settings | Yes | Yes | Partial | Partial | Yes | No | Partial | Unknown | Yes | B_PARTIAL_OR_BROKEN | P1 | FESETTINGS1, USERS1 | Profile save is connected, but not every displayed profile/account field is editable/persisted. |
| FEAT-151 | Appearance Settings | Settings | Yes | Partial | Partial | Partial | Partial | Partial | Partial | Unknown | Yes | B_PARTIAL_OR_BROKEN | P2 | FESETTINGS1, THEME1 | Theme controls mostly persist locally, with only company defaults on backend. |
| FEAT-152 | Company Default Theme | Settings | Yes | Yes | Partial | Yes | Yes | Partial | Partial | Unknown | Yes | B_PARTIAL_OR_BROKEN | P2 | SETTINGS1, FESETTINGS1 | Company theme saves through settings, but JSON parsing/storage path is brittle. |
| FEAT-153 | Preferences Settings | Settings | Yes | Yes | Partial | Yes | Yes | Partial | Partial | Unknown | Yes | B_PARTIAL_OR_BROKEN | P2 | FESETTINGS1, USERS2 | Preferences persist, but auto-assign/default-priority behavior is not enforced in workflows. |
| FEAT-154 | Security Settings | Settings | Partial | Yes | Partial | Partial | Partial | No | Yes | Unknown | Yes | B_PARTIAL_OR_BROKEN | P1 | AUTH1, FESETTINGS1 | Password change exists, but session/device management is incomplete. |
| FEAT-155 | Company Info Settings | Settings | Yes | Yes | Yes | Yes | Yes | No | Yes | Unknown | Yes | A_FULLY_CONNECTED | P1 | SETTINGS1, FESETTINGS1 | Company name/tagline/contact email save and reload through settings API. |
| FEAT-156 | SLA Settings Persistence | Settings | Yes | Yes | Partial | Yes | Yes | Partial | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P0 | SETTINGS1, TICKETS2, FESETTINGS1 | SLA values persist but are not fully used by ticket SLA execution logic. |
| FEAT-157 | Task Types Settings | Settings | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | SCHEMA_TASKTYPES, TASKTYPES1, FESETTINGS1 | Task type and subtype settings are backed by database CRUD. |
| FEAT-158 | Custom Subtype Save | Settings | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | SCHEMA_TICKET, FENEWTICKET1, TICKETS2 | Custom subtype text persists on tickets and is used in ticket creation. |
| FEAT-159 | Email & SMTP Settings | Settings | Yes | Yes | Yes | Yes | Yes | No | Yes | Unknown | Yes | A_FULLY_CONNECTED | P1 | SETTINGS1, FESETTINGS1, EMAIL1 | SMTP settings save through protected settings APIs. |
| FEAT-160 | Send Test Email | Settings | No | No | No | No | No | No | No | No | No | F_NOT_PRESENT | P2 | SETTINGS1, EMAIL1, FESETTINGS1 | No send-test-email endpoint or connected UI was found. |

### Theme/UI
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-161 | Dark Theme | Theme/UI | Yes | Partial | Partial | Partial | Partial | Partial | Partial | Unknown | Partial | B_PARTIAL_OR_BROKEN | P2 | THEME1, FESETTINGS1 | Dark theme tokens exist, but app-wide coverage was not proven and local/server paths differ. |
| FEAT-162 | Light Theme | Theme/UI | Yes | Partial | Partial | Partial | Partial | No | Partial | Unknown | Yes | A_FULLY_CONNECTED | P2 | THEME1 | Light theme is the baseline style and appears broadly applied. |
| FEAT-163 | Theme Presets | Theme/UI | Yes | Partial | Partial | Partial | Partial | Partial | Partial | Unknown | Partial | B_PARTIAL_OR_BROKEN | P2 | THEME1, FESETTINGS1 | Named presets exist, but persistence and app-wide consistency are partial. |
| FEAT-164 | Accent Color | Theme/UI | Yes | Partial | Partial | Partial | Partial | Partial | Partial | Unknown | Partial | B_PARTIAL_OR_BROKEN | P2 | THEME1, FESETTINGS1 | Accent color uses local/user/company paths inconsistently. |
| FEAT-165 | Font Size | Theme/UI | Yes | No | No | Yes | No | Yes | No | No | Yes | C_FRONTEND_ONLY | P3 | FESETTINGS1 | Font size persists locally only. |
| FEAT-166 | Compact Mode | Theme/UI | Yes | No | No | Yes | No | Yes | No | No | Yes | C_FRONTEND_ONLY | P3 | FESETTINGS1 | Compact mode persists locally only. |
| FEAT-167 | Consistent Design Tokens | Theme/UI | Yes | Partial | Partial | Partial | Partial | Partial | Partial | Unknown | Partial | B_PARTIAL_OR_BROKEN | P2 | THEME1 | Global tokens exist, but hardcoded styles remain across UI. |
| FEAT-168 | Loading States | Theme/UI | Yes | Unknown | Unknown | Unknown | Unknown | No | Unknown | Unknown | Yes | A_FULLY_CONNECTED | P2 | FEUSERS1, FETICKETS1, FELEAVE1, FESETTINGS1 | Major pages use loading states through query/loading branches. |
| FEAT-169 | Error States | Theme/UI | Partial | Unknown | Unknown | Unknown | Unknown | Partial | Unknown | Unknown | Partial | B_PARTIAL_OR_BROKEN | P2 | API1, FESETTINGS1, FETICKETDETAIL1 | Error handling exists, but some UI paths surface generic/raw backend messages. |
| FEAT-170 | Empty States | Theme/UI | Yes | Unknown | Unknown | Unknown | Unknown | No | Unknown | Unknown | Yes | A_FULLY_CONNECTED | P2 | FEUSERS1, FETICKETS1, FEPROJECTS1, FELEAVE1 | Major list pages include empty states. |

### AI
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-171 | Ticket AI Suggestions | AI | Yes | No | Partial | Yes | No | Partial | Partial | Unknown | Yes | B_PARTIAL_OR_BROKEN | P2 | AI1, FETICKETDETAIL1 | AI ticket suggestions are connected but depend on optional provider config and fallback behavior. |
| FEAT-172 | AI Ticket Summary | AI | No | No | Yes | No | No | Partial | Partial | Unknown | Unknown | D_BACKEND_ONLY | P2 | AI1, API1 | Summarize endpoint exists, but no complete frontend workflow was found. |
| FEAT-173 | Suggested Next Action | AI | Yes | No | Partial | Yes | No | Partial | Partial | Unknown | Yes | B_PARTIAL_OR_BROKEN | P2 | AI1, FETICKETDETAIL1 | Next-action suggestions display when AI suggestions are available. |
| FEAT-174 | Suggested Assignee/Priority/Category | AI | Partial | No | Partial | Partial | No | Partial | Partial | Unknown | Yes | B_PARTIAL_OR_BROKEN | P2 | AI1, FENEWTICKET1, FETICKETDETAIL1 | Priority suggestion is wired, but assignee/category suggestion coverage is incomplete. |
| FEAT-175 | Guidance Engine | AI | Partial | No | Partial | Partial | No | Partial | Partial | Partial | Partial | B_PARTIAL_OR_BROKEN | P2 | HOME1, AI1 | Dashboard guidance exists as rule-based alerts, not a full AI guidance engine. |

### Audit/Event Logs
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-176 | Event Log Model | Audit/Event Logs | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | A_FULLY_CONNECTED | P1 | SCHEMA_EVENT, EVENTS1 | OperationalEvent model, logger service, and events controller exist. |
| FEAT-177 | Ticket Events | Audit/Event Logs | Partial | Yes | Partial | Partial | Yes | No | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P1 | TICKETS2, EVENTS1 | Ticket create/status/assignment events exist, but comment/attachment/close coverage is incomplete. |
| FEAT-178 | Leave Events | Audit/Event Logs | Partial | Yes | Partial | Partial | Yes | No | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P1 | LEAVE2, EVENTS1 | Leave events exist, but cancel is logged through rejection-style action semantics. |
| FEAT-179 | Workday Events | Audit/Event Logs | Partial | Yes | Partial | Partial | Yes | No | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P1 | SCHEMA_WORKDAY, WORKDAY1, EVENTS1 | Workday has AttendanceEvent storage, but it is separate from OperationalEvent reporting. |
| FEAT-180 | User/Admin Events | Audit/Event Logs | Partial | Yes | Partial | Partial | Yes | No | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P1 | USERS2, EVENTS1 | Some user/admin activity is logged, but create/edit/deactivate/role-change coverage is not complete. |
| FEAT-181 | Settings Events | Audit/Event Logs | No | No | No | No | No | No | No | No | No | F_NOT_PRESENT | P2 | SETTINGS1, EVENTS1 | No settings-change audit events were found. |
| FEAT-182 | Risk Acknowledgement Events | Audit/Event Logs | No | No | No | No | No | No | No | No | No | F_NOT_PRESENT | P2 | EVENTS1 | No risk acknowledgement event type/workflow was found. |

### Files/Integrations
| Feature ID | Feature | Module | UI Exists | Backend Model Exists | Backend API/Service Exists | Frontend Calls Backend | Persists to DB | Uses Mock/Static Data | RBAC/Role Scoped | Counts Consistent | Error/Loading States | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-183 | File Upload Infrastructure | Files/Integrations | Yes | Yes | Partial | Yes | Yes | Partial | Partial | Unknown | Yes | B_PARTIAL_OR_BROKEN | P1 | UPLOADS1, SCHEMA_DOCS, FETICKETDETAIL1 | Cloudinary and base64 fallback uploads exist, but storage policy is mixed. |
| FEAT-184 | Document Access Control | Files/Integrations | Yes | Yes | Partial | Yes | Yes | No | Partial | Unknown | Yes | B_PARTIAL_OR_BROKEN | P0 | USERS2, FEUSERPROFILE1 | Document API has sensitive RBAC paths and manager-scope access needs tightening. |
| FEAT-185 | CSV/Excel Export | Files/Integrations | Partial | Yes | Partial | Partial | Yes | No | Partial | Partial | Yes | B_PARTIAL_OR_BROKEN | P1 | TICKETS1, FETICKETS1, REPORTS1 | Ticket CSV works; project, leave, SLA and report exports are not complete. |
| FEAT-186 | SMTP Email Sending | Files/Integrations | Partial | Yes | Partial | Partial | Partial | Partial | Partial | Unknown | Yes | B_PARTIAL_OR_BROKEN | P1 | EMAIL1, AUTH2, SETTINGS1 | Nodemailer sending exists when configured, but OTP/test-email flows are incomplete. |
| FEAT-187 | Calendar Integration | Files/Integrations | No | No | No | No | No | No | No | No | No | F_NOT_PRESENT | P3 | CALENDAR1, BROADCAST1 | Internal calendar page exists, but no Google/Outlook/ICS integration was found. |
| FEAT-188 | AI Provider Integration | Files/Integrations | Partial | No | Partial | Partial | No | Partial | Partial | Unknown | Yes | B_PARTIAL_OR_BROKEN | P2 | AI1 | OpenAI integration exists; Anthropic/config signals are inconsistent and fallback mode is common. |

## P0 Issues
- FEAT-003 RBAC / Role Permissions: Role constants exist, but direct ID reads and some manager/team-lead actions are not consistently scoped. Evidence: ROLES1, USERS1, TICKETS1, PROJECTS1, LEAVE1, DASH1.
- FEAT-004 User List: User list is connected and paginated, but backend GET /users is authenticated only, exposing directory data beyond admins. Evidence: USERS1, USERS2, FEUSERS1.
- FEAT-015 Payroll & Statutory: Payroll fields persist, but sensitive data protection depends on profile API discipline and needs stronger audit coverage. Evidence: SCHEMA_USER, USERS2, FEUSERPROFILE1.
- FEAT-016 Documents & Verification: Document upload and verification exist, but document storage/access controls need hardening. Evidence: SCHEMA_DOCS, USERS1, USERS2, FEUSERPROFILE1.
- FEAT-048 Ticket Detail Page: Detail UI is real, but backend findOne is not role scoped by ticket ID. Evidence: TICKETS1, TICKETS2, FETICKETDETAIL1.
- FEAT-049 Ticket Comments: Comment APIs exist, but they rely on ticket ID access without enough scoped ticket checks. Evidence: COMMENTS1, FETICKETDETAIL1.
- FEAT-050 Ticket History: History is logged and shown, but history fetch is not scoped by accessible ticket. Evidence: TICKETS1, TICKETS2, FETICKETDETAIL1.
- FEAT-051 Ticket Attachments: Uploads persist, but attachment access inherits the unscoped ticket detail risk. Evidence: TICKETS1, UPLOADS1, FETICKETDETAIL1.
- FEAT-052 Ticket Assignment: Assignment mutates backend state, but manager/admin scope is broad and frontend role assumptions differ. Evidence: TICKETS1, TICKETS2, FETICKETDETAIL1.
- FEAT-054 Ticket Status Workflow: Status updates persist, but transition and approval rules differ between frontend and backend. Evidence: TICKETS2, FETICKETDETAIL1.
- FEAT-057 Ticket Delete: Delete is guarded by role but not department scope and appears to hard-delete rather than archive. Evidence: TICKETS1, FETICKETDETAIL1.
- FEAT-062 SLA Settings: SLA settings persist, but execution SLA still uses hardcoded priority hours. Evidence: SETTINGS1, TICKETS2, FESETTINGS1.
- FEAT-063 Ticket SLA Timer: Timer data exists, but frontend and backend calculations are duplicated and inconsistent. Evidence: TICKETS2, FETICKETDETAIL1, SLAUTIL1.
- FEAT-064 SLA Progress Bar: Progress bars are displayed, but calculation paths differ across ticket list/detail/kanban. Evidence: TICKETS2, SLAUTIL1, FEKANBAN1.
- FEAT-065 Overdue Badge: Overdue badge logic mixes dueDate, executionDueAt, reviewDueAt and stats queries. Evidence: TICKETS2, TICKETS3, SLAUTIL1.
- FEAT-066 Immediate Overdue Bug Check: New-ticket timing is improved by due dates, but mixed timer sources still leave immediate-overdue regression risk. Evidence: TICKETS2, SLAUTIL1.
- FEAT-075 Kanban Count Consistency: Kanban counts exclude closed tickets and are separate from list/stats queries. Evidence: TICKETS2, TICKETS3, FEKANBAN1.
- FEAT-079 Edit Project: Edit persists, but frontend permits TEAM_LEAD while backend allows manager/admin/superadmin only. Evidence: PROJECTS1, PROJECTS2, FEPROJECTDETAIL1.
- FEAT-100 Leave Approval: Approval persists, but backend does not fully enforce department/managed-department scope by ID. Evidence: LEAVE1, LEAVE2, FELEAVE1.
- FEAT-101 Leave Rejection: Rejection persists, but has the same scope issue as approval. Evidence: LEAVE1, LEAVE2, FELEAVE1.
- FEAT-107 Analytics Overview: Overview is connected, but totalTickets is unscoped while other values use role scope. Evidence: DASH1, FEANALYTICS1.
- FEAT-108 Ticket Trend Chart: Trend chart is real, but resolved counts are derived from createdAt rather than a resolved timestamp. Evidence: DASH1, FEANALYTICS1.
- FEAT-109 Category Donut Chart: Category data is backend-driven but not role scoped. Evidence: DASH1, FEANALYTICS1.
- FEAT-110 Team Workload: Workload data is backend-driven but not role scoped to manager/team visibility. Evidence: DASH1, FEANALYTICS1.
- FEAT-112 Analytics Scope Consistency: Analytics filters, role scope, and counts are not consistently shared with ticket list queries. Evidence: DASH1, FEANALYTICS1.
- FEAT-156 SLA Settings Persistence: SLA values persist but are not fully used by ticket SLA execution logic. Evidence: SETTINGS1, TICKETS2, FESETTINGS1.
- FEAT-184 Document Access Control: Document API has sensitive RBAC paths and manager-scope access needs tightening. Evidence: USERS2, FEUSERPROFILE1.

## Frontend-only Features
- FEAT-034 Break Types: Break type choices are static UI options; backend persists only the chosen string.
- FEAT-090 Checklist Operations Console: Checklist/operations console behavior is static quick-action UI, not persisted tasks.
- FEAT-115 Delivery SLA Risks Analyzer: Risk analyzer quick action is static navigation, not a real analyzer API/page.
- FEAT-124 System Alerts Dropdown: Mockup-style system alerts are UI/static and separate from real notifications.
- FEAT-128 Quiet Hours: Quiet-hours UI/storage exists, but backend delivery enforcement was not found.
- FEAT-134 Quick Action: Review Delivery Risks: Action routes to a ticket priority filter, not a delivery-risk analyzer.
- FEAT-140 Operations Broadcast Banner: Broadcast banner is a static component with optional local props only.
- FEAT-141 Broadcast Details Modal: Broadcast details are frontend-only/static.
- FEAT-143 Add to Calendar: Broadcast add-to-calendar only toggles local UI state.
- FEAT-165 Font Size: Font size persists locally only.
- FEAT-166 Compact Mode: Compact mode persists locally only.

## Backend-only Features
- FEAT-126 Dismiss Alert: Backend delete exists with ownership checks, but no complete dismiss/delete UI was found.
- FEAT-172 AI Ticket Summary: Summarize endpoint exists, but no complete frontend workflow was found.

## Partial/Broken Features
- FEAT-001 Authentication / Login [P1]: Login and token storage are real, but the dashboard guard can redirect before auth persistence hydrates.
- FEAT-002 Current User / Session Profile [P1]: GET /auth/me exists, but the UI mostly trusts persisted login state instead of consistently refetching current user.
- FEAT-003 RBAC / Role Permissions [P0]: Role constants exist, but direct ID reads and some manager/team-lead actions are not consistently scoped.
- FEAT-004 User List [P0]: User list is connected and paginated, but backend GET /users is authenticated only, exposing directory data beyond admins.
- FEAT-008 User Status [P1]: The app has isActive and currentStatus, but not the full invited, suspended, deactivated lifecycle.
- FEAT-014 Account & Access [P1]: Role and status display exists, but session/last-active and reset/account flows are fragmented.
- FEAT-015 Payroll & Statutory [P0]: Payroll fields persist, but sensitive data protection depends on profile API discipline and needs stronger audit coverage.
- FEAT-016 Documents & Verification [P0]: Document upload and verification exist, but document storage/access controls need hardening.
- FEAT-018 Verification Details [P1]: Document verification is implemented, but user-level verification status is only partly surfaced.
- FEAT-021 Edit Department [P1]: Name and metadata save, but lead edits are role-derived rather than a true lead relation.
- FEAT-022 Delete/Archive Department [P1]: Delete exists and blocks active tickets, but there is no archive state.
- FEAT-024 Department Lead [P1]: Lead is inferred from MANAGER or TEAM_LEAD users in a department, not stored as a validated relation.
- FEAT-026 Department Metrics [P1]: Member/ticket/project/leave metrics exist, but logic is duplicated and partly derived.
- FEAT-027 Company Directory [P1]: Directory data is real, but access is limited and team/company concepts are mixed.
- FEAT-028 Live Status Directory [P2]: Workday status is persisted and displayed, but directory presence is not a full realtime presence system.
- FEAT-030 Team Members [P1]: Team members work through department membership, not a dedicated team membership model.
- FEAT-044 Ticket Filters [P1]: Status, category, priority and department are wired, but due/overdue/assignee/project filters are incomplete in UI.
- FEAT-045 Ticket Sorting [P2]: Backend has fixed ordering, but user-facing sort controls are incomplete.
- FEAT-046 Ticket Status Tabs [P1]: Tabs filter real data, but tab counts and backend stats are separate calculations.
- FEAT-048 Ticket Detail Page [P0]: Detail UI is real, but backend findOne is not role scoped by ticket ID.
- FEAT-049 Ticket Comments [P0]: Comment APIs exist, but they rely on ticket ID access without enough scoped ticket checks.
- FEAT-050 Ticket History [P0]: History is logged and shown, but history fetch is not scoped by accessible ticket.
- FEAT-051 Ticket Attachments [P0]: Uploads persist, but attachment access inherits the unscoped ticket detail risk.
- FEAT-052 Ticket Assignment [P0]: Assignment mutates backend state, but manager/admin scope is broad and frontend role assumptions differ.
- FEAT-054 Ticket Status Workflow [P0]: Status updates persist, but transition and approval rules differ between frontend and backend.
- FEAT-055 Ticket Close/Reopen [P1]: Close can be sent as a status update, but no complete reopen workflow was found.
- FEAT-056 Ticket Edit [P1]: Edit persists, but authorization is broader than department/team ownership.
- FEAT-057 Ticket Delete [P0]: Delete is guarded by role but not department scope and appears to hard-delete rather than archive.
- FEAT-062 SLA Settings [P0]: SLA settings persist, but execution SLA still uses hardcoded priority hours.
- FEAT-063 Ticket SLA Timer [P0]: Timer data exists, but frontend and backend calculations are duplicated and inconsistent.
- FEAT-064 SLA Progress Bar [P0]: Progress bars are displayed, but calculation paths differ across ticket list/detail/kanban.
- FEAT-065 Overdue Badge [P0]: Overdue badge logic mixes dueDate, executionDueAt, reviewDueAt and stats queries.
- FEAT-066 Immediate Overdue Bug Check [P0]: New-ticket timing is improved by due dates, but mixed timer sources still leave immediate-overdue regression risk.
- FEAT-069 Shared Ticket Timing Utility [P1]: There is a frontend SLA utility, but backend timing logic remains separate.
- FEAT-070 SLA Risk Categories [P1]: Some risk counts exist, but blocker, review-ageing and acknowledgement flows are incomplete.
- FEAT-072 Kanban Drag-and-Drop [P1]: Drag sends backend status updates, but frontend team-lead permissions can exceed backend rules.
- FEAT-073 Kanban Filters [P2]: Kanban filtering is limited mainly to department.
- FEAT-074 Kanban Card SLA Display [P1]: Cards show SLA data, but use the same inconsistent timing sources as tickets.
- FEAT-075 Kanban Count Consistency [P0]: Kanban counts exclude closed tickets and are separate from list/stats queries.
- FEAT-079 Edit Project [P0]: Edit persists, but frontend permits TEAM_LEAD while backend allows manager/admin/superadmin only.
- FEAT-080 Delete/Archive Project [P1]: Delete exists for admin roles, but no archive workflow is present.
- FEAT-082 Project Tickets [P1]: Linked tickets display, but adding existing tickets is mostly through ticket create/edit rather than project detail.
- FEAT-083 Project Team [P1]: Backend member APIs exist, but project detail lacks complete add/remove member UI.
- FEAT-086 Project Status [P2]: Status is persisted, but does not cover all requested on-track/at-risk/delayed/archive states.
- FEAT-099 Leave Tabs [P1]: Tabs are connected, but role/approval assumptions differ for TEAM_LEAD.
- FEAT-100 Leave Approval [P0]: Approval persists, but backend does not fully enforce department/managed-department scope by ID.
- FEAT-101 Leave Rejection [P0]: Rejection persists, but has the same scope issue as approval.
- FEAT-102 Leave Types [P2]: Leave enum covers annual/sick/emergency/unpaid/other, not the full requested type set.
- FEAT-103 Leave Policy Settings [P1]: Leave policy values save, but they are not clearly used in leave balance enforcement.
- FEAT-106 Leave Notifications [P1]: Approval/rejection notifications exist, but preference enforcement and applied-notification coverage are incomplete.
- FEAT-107 Analytics Overview [P0]: Overview is connected, but totalTickets is unscoped while other values use role scope.
- FEAT-108 Ticket Trend Chart [P0]: Trend chart is real, but resolved counts are derived from createdAt rather than a resolved timestamp.
- FEAT-109 Category Donut Chart [P0]: Category data is backend-driven but not role scoped.
- FEAT-110 Team Workload [P0]: Workload data is backend-driven but not role scoped to manager/team visibility.
- FEAT-111 Detailed Analytics Tab [P1]: Detailed view uses a capped ticket list rather than a dedicated analytics query.
- FEAT-112 Analytics Scope Consistency [P0]: Analytics filters, role scope, and counts are not consistently shared with ticket list queries.
- FEAT-113 Reports Export [P1]: Reports route redirects to analytics and only ticket CSV export is complete.
- FEAT-114 Delivery Risk Snapshot [P1]: Dashboard risk cards exist, but are not a complete delivery-risk subsystem.
- FEAT-117 SLA Breach Risk [P1]: Overdue/SLA risk counts exist, but depend on inconsistent SLA logic.
- FEAT-118 Unassigned Tickets Risk [P1]: Unassigned risk counts exist in stats/home data, but not as a complete risk workflow.
- FEAT-119 Review Ageing Risk [P1]: Review ageing is partially inferred but no complete ageing query/workflow exists.
- FEAT-121 Risk Severity [P2]: Severity labels exist in generated alerts/UI, but not as a normalized backend model.
- FEAT-127 Notification Preferences [P1]: Preferences persist in AppSetting, but notification triggers do not enforce them.
- FEAT-129 Notification Event Triggers [P1]: Ticket/leave triggers exist, but preference enforcement and duplicate channels remain incomplete.
- FEAT-130 Command Center Shell [P1]: Shell exists, but protected-route/auth hydration and role visibility are not fully stable.
- FEAT-131 Global Command Search [P2]: Command search queries real tickets/projects/people, but not every requested domain.
- FEAT-132 Command Palette / Quick Actions [P2]: Command palette is partly real search and partly static action definitions.
- FEAT-135 Quick Action: Check Due Today [P2]: Due-today route parameter is not consistently consumed by the tickets page.
- FEAT-146 Critical Timeline Milestones [P2]: Timeline/calendar uses tickets and approved leave, not a durable milestone model.
- FEAT-147 Milestone Types [P2]: Calendar event types cover tickets/leave, not release/meeting/deadline/approval taxonomy.
- FEAT-148 Milestone Links [P2]: Calendar links exist for tickets/leave only, not broad ticket/project/department milestones.
- FEAT-150 Settings Profile [P1]: Profile save is connected, but not every displayed profile/account field is editable/persisted.
- FEAT-151 Appearance Settings [P2]: Theme controls mostly persist locally, with only company defaults on backend.
- FEAT-152 Company Default Theme [P2]: Company theme saves through settings, but JSON parsing/storage path is brittle.
- FEAT-153 Preferences Settings [P2]: Preferences persist, but auto-assign/default-priority behavior is not enforced in workflows.
- FEAT-154 Security Settings [P1]: Password change exists, but session/device management is incomplete.
- FEAT-156 SLA Settings Persistence [P0]: SLA values persist but are not fully used by ticket SLA execution logic.
- FEAT-161 Dark Theme [P2]: Dark theme tokens exist, but app-wide coverage was not proven and local/server paths differ.
- FEAT-163 Theme Presets [P2]: Named presets exist, but persistence and app-wide consistency are partial.
- FEAT-164 Accent Color [P2]: Accent color uses local/user/company paths inconsistently.
- FEAT-167 Consistent Design Tokens [P2]: Global tokens exist, but hardcoded styles remain across UI.
- FEAT-169 Error States [P2]: Error handling exists, but some UI paths surface generic/raw backend messages.
- FEAT-171 Ticket AI Suggestions [P2]: AI ticket suggestions are connected but depend on optional provider config and fallback behavior.
- FEAT-173 Suggested Next Action [P2]: Next-action suggestions display when AI suggestions are available.
- FEAT-174 Suggested Assignee/Priority/Category [P2]: Priority suggestion is wired, but assignee/category suggestion coverage is incomplete.
- FEAT-175 Guidance Engine [P2]: Dashboard guidance exists as rule-based alerts, not a full AI guidance engine.
- FEAT-177 Ticket Events [P1]: Ticket create/status/assignment events exist, but comment/attachment/close coverage is incomplete.
- FEAT-178 Leave Events [P1]: Leave events exist, but cancel is logged through rejection-style action semantics.
- FEAT-179 Workday Events [P1]: Workday has AttendanceEvent storage, but it is separate from OperationalEvent reporting.
- FEAT-180 User/Admin Events [P1]: Some user/admin activity is logged, but create/edit/deactivate/role-change coverage is not complete.
- FEAT-183 File Upload Infrastructure [P1]: Cloudinary and base64 fallback uploads exist, but storage policy is mixed.
- FEAT-184 Document Access Control [P0]: Document API has sensitive RBAC paths and manager-scope access needs tightening.
- FEAT-185 CSV/Excel Export [P1]: Ticket CSV works; project, leave, SLA and report exports are not complete.
- FEAT-186 SMTP Email Sending [P1]: Nodemailer sending exists when configured, but OTP/test-email flows are incomplete.
- FEAT-188 AI Provider Integration [P2]: OpenAI integration exists; Anthropic/config signals are inconsistent and fallback mode is common.

## Unknown Features
- FEAT-076 Kanban UI Contrast: No screenshot/browser QA was run in this read-only audit, so contrast is unknown.

## Recommended Fix Order
1. Lock down RBAC direct-ID reads and sensitive document/payroll access before UI work.
2. Unify ticket query/scope/count logic for list, detail, kanban, dashboard, analytics and project detail.
3. Make SLA settings the single source of truth and remove duplicated timer logic.
4. Repair leave approval scope, leave date validation and balance/policy enforcement.
5. Replace frontend-only command, broadcast, quiet-hours and appearance behavior with real persistence or remove them from stable scope.
6. Complete missing frontend surfaces for backend-only endpoints, especially notification dismiss and AI summary if they remain in scope.
7. Add browser-based UI verification for contrast, loading, empty and error states after the data layer is stable.

## Evidence Appendix
- AUTH1: backend/src/modules/core/auth/auth.controller.ts:17-53 exposes login, guarded register, change-password, me, forgot-password, reset-password.
- AUTH2: backend/src/modules/core/auth/auth.service.ts functions login, register, forgotPassword, resetPasswordWithOtp, generateTokens; OTP is in-memory and email sending is TODO/fallback.
- API1: frontend/lib/api.ts central axios client, apex_token storage/migration, auth/users/tickets/projects/leave/settings/workday/notifications API wrappers.
- FEAUTH1: frontend/app/(auth)/login/page.tsx uses authApi.login and setAuth, then routes by mustChangePassword/welcome/mode/dashboard.
- FEAUTH2: frontend/store/auth.store.ts persists apex-auth and apex_token; frontend/app/(dashboard)/layout.tsx guards by persisted isAuthenticated.
- ROLES1: backend/src/common/constants/roles.ts defines SUPER_ADMIN, ADMIN, MANAGER, TEAM_LEAD, EMPLOYEE, INTERN and backend controllers import it.
- SCHEMA_USER: backend/prisma/schema.prisma:10-95 User model includes roleId, departmentId, personal, employment, payroll, verification and indexes.
- SCHEMA_DOCS: backend/prisma/schema.prisma:99-116 EmployeeDocument model.
- SCHEMA_DEPT: backend/prisma/schema.prisma:132-146 Department model.
- SCHEMA_PROJECT: backend/prisma/schema.prisma:148-168 Project model and project/member/ticket relations.
- SCHEMA_TICKET: backend/prisma/schema.prisma:186-245 Ticket model with status, priority, due/timing fields, project, department, assignees, task type/subtype and indexes.
- SCHEMA_LEAVE: backend/prisma/schema.prisma:294-316 LeaveRequest model.
- SCHEMA_NOTIF: backend/prisma/schema.prisma:319-336 Notification model.
- SCHEMA_TASKTYPES: backend/prisma/schema.prisma:375-400 TaskType and TaskSubtype models.
- SCHEMA_SETTING: backend/prisma/schema.prisma:467-475 AppSetting key/value model.
- SCHEMA_WORKDAY: backend/prisma/schema.prisma:477-538 WorkSession, BreakLog, AttendanceEvent models.
- SCHEMA_EVENT: backend/prisma/schema.prisma:541-560 OperationalEvent model.
- SCHEMA_ALL: backend/prisma/schema.prisma overall schema search found no separate Task, Team, Broadcast, RiskAck, or CalendarIntegration models.
- USERS1: backend/src/modules/core/users/users.controller.ts:18-130 includes me, my-team, preferences, list, stats, directory, id, create, update, reset, deactivate, profile, documents and verify routes.
- USERS2: backend/src/modules/core/users/users.service.ts implements findAll pagination, create/update/deactivate, getProfile RBAC masking, updateProfile, uploadDocument, getDocuments, verifyDocument and AppSetting-backed preferences.
- FEUSERS1: frontend/app/(dashboard)/(platform)/users/page.tsx loads users/roles/departments and performs create, edit and active-state mutations.
- FEUSERPROFILE1: frontend/app/(dashboard)/(platform)/users/[id]/profile/page.tsx loads protected HR profile and document data, then updates profile/doc verification via usersApi.
- DEPTS1: backend/src/modules/core/departments/departments.controller.ts has JWT-protected list/get and admin/superadmin create/update/delete routes.
- DEPTS2: backend/src/modules/core/departments/departments.service.ts derives lead from department users and computes member, ticket, project and leave metrics.
- FEDEPTS1: frontend/app/(dashboard)/(platform)/departments/page.tsx loads department cards and admin create/delete actions.
- FEDEPTDETAIL1: frontend/app/(dashboard)/(platform)/departments/[id]/page.tsx loads department detail, edits metadata, and adds/removes users through usersApi.update.
- WORKDAY1: backend/src/modules/core/workday/workday.controller.ts and workday.service.ts expose start/end/break/idle/resume/today/team with WorkSession persistence.
- FEWORKDAY1: frontend/components/workday/WorkdayBar.tsx and related hooks call workdayApi for start, break, resume, end and idle flows.
- TEAMFE1: frontend/app/(dashboard)/(operations)/team/page.tsx loads usersApi, team directory and workday team status.
- TICKETS1: backend/src/modules/core/tickets/tickets.controller.ts:18-113 exposes list/stats/kanban/export/detail/history/create/upload/update/status/assign/approve/reject/delete.
- TICKETS2: backend/src/modules/core/tickets/tickets.service.ts implements role-scoped findAll, create/update/assign/status/history/export, notifications, events and SLA decoration.
- TICKETS3: backend/src/modules/core/tickets/tickets.service.ts getStats/getKanban use separate calculations for overdue/status/kanban buckets.
- FETICKETS1: frontend/app/(dashboard)/(operations)/tickets/page.tsx loads tickets/stats/departments, filters, pagination and export.
- FENEWTICKET1: frontend/app/(dashboard)/(operations)/tickets/new/page.tsx loads projects/users/taskTypes/departments/team status, creates tickets and calls AI priority.
- FETICKETDETAIL1: frontend/app/(dashboard)/(operations)/tickets/[id]/page.tsx loads ticket detail, history, comments, AI suggestions, uploads, status, assign, approve/reject, edit and delete flows.
- COMMENTS1: backend/src/modules/core/tickets/comments.controller.ts exposes ticket comment list/create/update/delete routes under JWT.
- UPLOADS1: backend/src/modules/core/uploads/uploads.service.ts stores Cloudinary uploads under apex/tickets when configured and base64 fallback otherwise.
- SLAUTIL1: frontend/lib/sla.ts provides frontend SLA timer/progress helpers separate from backend ticket SLA calculation.
- FEKANBAN1: frontend/app/(dashboard)/(operations)/kanban/page.tsx loads kanban data, department filters and drag/drop status updates.
- PROJECTS1: backend/src/modules/core/projects/projects.controller.ts provides list/stats/detail/create/update/member/delete routes with manager/admin guards for mutations.
- PROJECTS2: backend/src/modules/core/projects/projects.service.ts implements scoped project listing, create/update/member mutation, delete and computed progress; findOne and stats have scope/count gaps.
- FEPROJECTS1: frontend/app/(dashboard)/(operations)/projects/page.tsx loads projects/departments and creates projects for permitted roles.
- FEPROJECTDETAIL1: frontend/app/(dashboard)/(operations)/projects/[id]/page.tsx loads and edits project detail, deletes admin projects and displays tickets/team/progress.
- LEAVE1: backend/src/modules/core/leave/leave.controller.ts exposes list/stats/detail/create/approve/reject/cancel with manager/admin guards for approve/reject.
- LEAVE2: backend/src/modules/core/leave/leave.service.ts implements role-scoped list/stats and create/approve/reject/cancel notification/event logic.
- FELEAVE1: frontend/app/(dashboard)/(operations)/leave/page.tsx loads leave list/stats and performs apply/approve/reject mutations.
- DASH1: backend/src/modules/core/dashboard/dashboard.service.ts exposes overview/category/department/activity/workload/trend; several analytics queries are unscoped or use divergent counts.
- HOME1: backend/src/modules/core/home/home.service.ts builds role-scoped dashboard summary, critical alerts and home cards.
- DASHFE1: frontend/app/(dashboard)/(operations)/dashboard/page.tsx uses home/dashboard/notification/workday widgets and command/alert components.
- FEANALYTICS1: frontend/app/(dashboard)/(platform)/analytics/page.tsx loads dashboard analytics plus capped ticket list for detailed analytics.
- REPORTS1: frontend/app/(dashboard)/(platform)/reports/page.tsx redirects to analytics; frontend/modules/platform/reports/reports.api.ts re-exports dashboardApi.
- NOTIFS1: backend/src/modules/core/notifications/notifications.controller.ts and notifications.service.ts list, unread-count, mark-read, mark-all-read and delete own notifications.
- FENOTIFS1: frontend/components/layout/topbar.tsx loads unread count/list and performs mark-read/mark-all-read.
- COMMAND1: frontend/components/command/CommandPalette.tsx searches tickets/projects/people and executes selected routes.
- QUICK1: frontend/components/command/QuickActionPalette.tsx and QuickActionDock define static and route-backed quick actions.
- BROADCAST1: frontend/components/dashboard/AnnouncementBroadcast.tsx renders broadcast content from props/defaults and local added-to-calendar state only.
- CALENDAR1: frontend/app/(dashboard)/(operations)/calendar/page.tsx builds FullCalendar events from ticket and approved-leave APIs.
- SETTINGS1: backend/src/modules/core/settings/settings.controller.ts and settings.service.ts manage company, leave-policy, SLA and SMTP AppSetting records.
- FESETTINGS1: frontend/app/(dashboard)/(platform)/settings/page.tsx wires profile, notification preferences, appearance, company, leave-policy, SLA, task type and SMTP forms.
- TASKTYPES1: backend/src/modules/core/settings/task-types.controller.ts and task-types.service.ts expose task type/subtype CRUD and department filtered reads.
- THEME1: frontend/app/globals.css and frontend/lib/theme.ts define theme tokens/presets and browser-applied data-theme/data-accent values.
- AI1: backend/src/modules/core/ai/ai.controller.ts and ai.service.ts expose priority, summary and ticket-suggestion endpoints with OpenAI/fallback behavior.
- EVENTS1: backend/src/modules/core/events/events.controller.ts and event-logger.service.ts expose OperationalEvent list/create logging with admin/self scoping.
- EMAIL1: backend/src/modules/core/notifications/email.service.ts uses nodemailer when SMTP env/settings are available and skips when not configured.
- LAYOUT1: frontend/app/(dashboard)/layout.tsx, sidebar/topbar components, and auth store provide the shell and route protection.
- ROUTES1: frontend/app directory route scan found login, dashboard, tickets, kanban, projects, leave, team, calendar, analytics, settings, profile, users, departments and reports, but no task board route.
