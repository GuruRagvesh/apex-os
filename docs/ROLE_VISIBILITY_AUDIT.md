# ROLE VISIBILITY AUDIT

## 1. Role Rule Inventory

### SUPER_ADMIN
- **Modules**: All operational modules
- **Can access route**: All
- **Can see list**: All
- **Can see detail**: All
- **Can create**: All
- **Can update**: All
- **Can delete/cancel**: All
- **Can approve/reject**: All
- **Can assign**: All
- **Can export**: All
- **Can see dashboard count**: Global
- **Can see activity**: Global
- **Can receive notification**: All
- **Backend enforcement**: Enforced via `AccessPolicyService.isHrOrAdmin`
- **Frontend enforcement**: Enforced via component role checks.
- **Current status**: VERIFIED_CORRECT

### ADMIN
- **Modules**: All operational modules (except SMTP settings)
- **Can access route**: All except `/settings/smtp`
- **Can see list**: All
- **Can see detail**: All
- **Can create**: All
- **Can update**: All
- **Can delete/cancel**: All
- **Can approve/reject**: All
- **Can assign**: All
- **Can export**: All
- **Can see dashboard count**: Global
- **Can see activity**: Global
- **Can receive notification**: All
- **Backend enforcement**: Enforced via `AccessPolicyService` and `@Roles` guards.
- **Frontend enforcement**: Enforced via UI condition rendering.
- **Current status**: VERIFIED_CORRECT

### MANAGER
- **Modules**: Scoped by department.
- **Can access route**: Scoped routes
- **Can see list**: Department/team scope
- **Can see detail**: Department/team scope
- **Can create**: Department scope
- **Can update**: Department scope
- **Can delete/cancel**: No (Admin only)
- **Can approve/reject**: Department leave requests
- **Can assign**: Department tickets
- **Can export**: Scoped
- **Can see dashboard count**: Scoped to department
- **Can see activity**: Scoped to department
- **Backend enforcement**: Enforced via `managedDepartmentIds` mapping.
- **Frontend enforcement**: Scoped UI.
- **Current status**: VERIFIED_CORRECT

### TEAM_LEAD
- **Modules**: Scoped to own department.
- **Can access route**: Scoped routes
- **Can see list**: Department scope
- **Can see detail**: Department scope
- **Can create**: Assigned tickets
- **Can update**: Scoped tickets
- **Can delete/cancel**: No
- **Can approve/reject**: Department leave
- **Can assign**: Department scope
- **Can see dashboard count**: Scoped to department
- **Can see activity**: Scoped to department
- **Backend enforcement**: Enforced via `managedDepartmentIds` falling back to `user.departmentId`.
- **Frontend enforcement**: Scoped UI.
- **Current status**: VERIFIED_CORRECT

### EMPLOYEE
- **Modules**: Self-service only.
- **Can access route**: Self routes, own profile, own tickets.
- **Can see list**: Own tickets, own leave.
- **Can see detail**: Own tickets, own leave.
- **Can create**: Own tickets, own leave.
- **Can update**: Own tickets.
- **Can delete/cancel**: No.
- **Can approve/reject**: No.
- **Can assign**: No (can only self-assign or leave unassigned).
- **Can see dashboard count**: Own tickets.
- **Can see activity**: Own activity only.
- **Can see workday team data**: No department-wide team visibility.
- **Current status**: VERIFIED_CORRECT.
- **Problem**: Fixed. Previously scope too broad for ActivityLog and Workday.getTeam.

### INTERN
- **Modules**: Self-service only (stricter than EMPLOYEE).
- **Can access route**: Assigned tickets.
- **Can see list**: Assigned tickets.
- **Can update**: Only move to IN_PROGRESS.
- **Can see activity**: Own activity only.
- **Can see workday team data**: No department-wide team visibility.
- **Current status**: VERIFIED_CORRECT.
- **Problem**: Fixed. Previously scope too broad for ActivityLog and Workday.getTeam.

## 2. Classification Summary

| Module | Role | Route Access | List Scope | Detail Scope | Actions | Dashboard Count | Backend Guard | Frontend Guard | Status | Problem | Fix |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Dashboard (Activity) | EMPLOYEE/INTERN | Allowed | Dept Scope | N/A | N/A | N/A | Correct | Partial | VERIFIED_CORRECT | N/A | Fixed. Updated `whereClause` in `getActivityFeed` to restrict to self for non-managers. |
| Workday (Team) | EMPLOYEE/INTERN | Allowed | Dept Scope | N/A | N/A | N/A | Correct | Partial | VERIFIED_CORRECT | N/A | Fixed. Restrict `WorkdayService.getTeam` to self for non-managers. |
| Departments | ALL | Allowed (API) | Global | Global | N/A | N/A | Correct | Present | VERIFIED_CORRECT | N/A | Fixed. Added `@UseGuards(RolesGuard)` to `DepartmentsController.findAll` and `findOne`. |
| Tickets | ALL | Allowed | Scoped | Scoped | Scoped | Scoped | Correct | Correct | VERIFIED_CORRECT | None | None |
| Projects | ALL | Allowed | Scoped | Scoped | Scoped | Scoped | Correct | Correct | VERIFIED_CORRECT | None | None |
| Leave | ALL | Allowed | Scoped | Scoped | Scoped | Scoped | Correct | Correct | VERIFIED_CORRECT | None | None |
| Settings | ALL | Scoped | Scoped | Scoped | Scoped | N/A | Correct | Correct | VERIFIED_CORRECT | None | None |

**Summary Counts:**
- Verified correct: 7
- UI hidden but backend open: 0 (Departments API fixed)
- UI visible but backend denied: 0
- Scope too broad: 0 (Activity Feed & Workday Team fixed)
- Scope too narrow: 0
- Count mismatch: 0
- Action permission broken: 0
- Misleading empty state: 0
- Undocumented rule: 0
