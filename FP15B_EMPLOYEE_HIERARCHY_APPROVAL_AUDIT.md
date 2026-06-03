# FP15B Employee Hierarchy Approval Audit

## Phase 1: Current User / Hierarchy Audit Findings

### Hierarchy Data Fields Checked in `schema.prisma`
- **Role**: `roleId` maps to the `Role` table (contains `EMPLOYEE`, `TEAM_LEAD`, `MANAGER`, etc.).
- **Designation**: `designation` string field on the `User` model.
- **Reporting Manager**: `reportingManager` maps to a direct supervisor via `employeeId`.
- **Team Lead**: `teamLeadName` maps to an immediate lead via `employeeId`.
- **Department**: `departmentId` links to the `Department` model.
- **Manager Department Access**: `ManagerDeptAccess` table controls cross-department manager visibility.

### Current User Profile Update Flow
- Examined `backend/src/modules/core/users/users.controller.ts` and `users.service.ts`.
- `PATCH /users/me` only permits safe fields: `name`, `avatar`, `photoUrl`, `bio`.
- `PATCH /users/:id/profile` (handled by `updateProfile`) enforces rigorous checks based on `access-policy.service.ts`.
- When an employee edits their own profile (`isOwnProfile === true`), they are strictly limited to `PERSONAL_EDITABLE_BY_SELF` which contains fields like:
  - `name`, `phone`, `currentAddress`, `permanentAddress`, `emergencyContact`, `dateOfBirth`, etc.
- Hierarchy and payroll fields (`designation`, `departmentId`, `roleId`, `reportingManager`) are completely blocked from self-editing.

### Existing Approval/Notification Logic
- The `LeaveRequest` model acts as a proxy for existing approval flows (status values: `PENDING`, `APPROVED`, `REJECTED`).
- `ActivityLog` captures system events and `Notification` dispatches alerts to users.
- A new `EmployeeProfileChangeRequest` model is necessary to capture intent for sensitive profile updates safely, following a similar pattern.

## Safety Check Confirmations
- **OTP / Resend**: Remains untouched (commit `2dc537a` verified).
- **SMTP**: Confirmed removed.
- **Access Policy**: The `access-policy.service.ts` logic remains intact; no existing restrictions were bypassed. All test cases run against `UsersService` remain valid.
