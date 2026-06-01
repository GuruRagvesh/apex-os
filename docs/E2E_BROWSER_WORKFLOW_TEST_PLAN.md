# E2E Browser Workflow Test Plan

## Workflow 1 — Employee Ticket Execution
- **Role**: EMPLOYEE
- **Test user**: test_employee@example.com (or equivalent seeded user)
- **Modules to test**: Dashboard, Tickets, Activity, Calendar
- **Workflow steps**:
  1. Login as EMPLOYEE.
  2. Open dashboard.
  3. Confirm only own/scoped dashboard data appears.
  4. Open Tickets.
  5. Create or open an assigned ticket.
  6. Start ticket.
  7. Add comment.
  8. Upload attachment if allowed.
  9. Submit for review.
  10. Refresh page.
  11. Verify status persists.
  12. Verify ticket appears correctly in dashboard.
  13. Verify activity log shows own ticket activity only.
  14. Verify notification behavior if triggered.
  15. Verify calendar due date if ticket has due date.
  16. Attempt direct access to unrelated ticket URL.
- **Expected result**: Employee sees only own/assigned tickets. Status changes persist. Dashboard counts match scoped ticket list. No unrelated ticket data appears. Direct access to unrelated ticket is denied or scoped out.
- **Data created/updated**: Ticket status changed to 'REVIEW', Comment created, Attachment created.
- **Dashboard impact**: Active ticket counts update correctly.
- **Notification impact**: Notification potentially sent to Manager/Team Lead.
- **Activity log impact**: Log entry added for ticket update and comment.
- **Calendar impact**: Due date appears on calendar.
- **Permission checks**: Cannot view/edit unrelated tickets.
- **Direct URL checks**: Access unrelated `/tickets/:id` fails.
- **Pass/Fail**: TBD
- **Issue found**: TBD
- **Fix required**: TBD

## Workflow 2 — Team Lead Review Flow
- **Role**: TEAM_LEAD
- **Test user**: test_lead@example.com
- **Modules to test**: Dashboard, Tickets, Activity
- **Workflow steps**:
  1. Login as TEAM_LEAD.
  2. Open dashboard.
  3. Verify scoped team ticket metrics.
  4. Open ticket submitted by employee.
  5. Review ticket.
  6. Move to Done or send back if workflow supports it.
  7. Add review comment.
  8. Refresh page.
  9. Verify status persists.
  10. Verify employee-facing status updates.
  11. Verify dashboard count updates.
  12. Verify activity log is scoped to team/work items.
  13. Attempt to access unrelated department ticket.
- **Expected result**: Team Lead can review scoped tickets. Cannot see unrelated department/team tickets. Dashboard and list counts match. Activity does not leak outside scope.
- **Data created/updated**: Ticket status updated to 'DONE', Comment added.
- **Dashboard impact**: Review counts decrease, done counts increase.
- **Notification impact**: Notification sent back to Employee.
- **Activity log impact**: Review log entry added for team.
- **Calendar impact**: N/A.
- **Permission checks**: Denied access to other departments.
- **Direct URL checks**: Access unrelated `/tickets/:id` fails.
- **Pass/Fail**: TBD
- **Issue found**: TBD
- **Fix required**: TBD

## Workflow 3 — Manager Project/Ticket Oversight
- **Role**: MANAGER
- **Test user**: test_manager@example.com
- **Modules to test**: Dashboard, Projects, Tickets, Users
- **Workflow steps**:
  1. Login as MANAGER.
  2. Open dashboard.
  3. Verify department/project scoped metrics.
  4. Open Projects.
  5. Open a scoped project.
  6. Verify linked tickets.
  7. Add/remove project member if allowed.
  8. Open a project ticket.
  9. Assign/reassign within scope if allowed.
  10. Refresh page.
  11. Verify project dashboard sync.
  12. Try opening unrelated project URL.
  13. Try opening unrelated employee profile or sensitive document.
- **Expected result**: Manager sees only scoped department/project records. Project/ticket changes persist. Dashboard project/ticket counts match scoped lists. Sensitive employee data is not exposed unless explicitly allowed.
- **Data created/updated**: Project members modified, ticket assignee modified.
- **Dashboard impact**: Project stats sync correctly.
- **Notification impact**: Notifications sent for assignments.
- **Activity log impact**: Project assignment logged.
- **Calendar impact**: N/A.
- **Permission checks**: Denied access to cross-department projects/profiles.
- **Direct URL checks**: Access unrelated `/projects/:id` fails.
- **Pass/Fail**: TBD
- **Issue found**: TBD
- **Fix required**: TBD

## Workflow 4 — Leave Request and Approval
- **Role**: EMPLOYEE and MANAGER/ADMIN
- **Test user**: test_employee@example.com & test_manager@example.com
- **Modules to test**: Leave, Calendar, Dashboard, Activity
- **Workflow steps (Employee)**:
  1. Login as EMPLOYEE.
  2. Apply for leave.
  3. Submit request.
  4. Refresh page.
  5. Verify leave appears in My Requests.
  6. Verify calendar leave event appears on correct date.
  7. Verify dashboard pending leave count if applicable.
- **Workflow steps (Approver)**:
  1. Login as MANAGER.
  2. Open Leave Management.
  3. Verify pending request appears only if in scope.
  4. Approve or reject leave.
  5. Refresh page.
  6. Verify status persists.
  7. Verify employee sees updated status.
  8. Verify calendar status updates.
  9. Verify activity/notification entries.
- **Negative check**:
  - Login as unrelated employee and confirm leave request is not visible.
- **Expected result**: Leave workflow works end-to-end. Calendar date does not shift. Approval scope is correct. No private leave data leaks.
- **Data created/updated**: Leave request created and updated.
- **Dashboard impact**: Leave counts updated.
- **Notification impact**: Notifications for requested and approved.
- **Activity log impact**: Leave request events logged.
- **Calendar impact**: Leave dates rendered accurately.
- **Permission checks**: Denied access to other employees' leave.
- **Direct URL checks**: Access unrelated `/leave` API endpoints fails.
- **Pass/Fail**: TBD
- **Issue found**: TBD
- **Fix required**: TBD

## Workflow 5 — Workday / Attendance
- **Role**: EMPLOYEE and MANAGER
- **Test user**: test_employee@example.com & test_manager@example.com
- **Modules to test**: Workday, Attendance
- **Workflow steps (Employee)**:
  1. Login as EMPLOYEE.
  2. Start workday.
  3. Start break.
  4. Resume work.
  5. End workday.
  6. Refresh page.
  7. Verify final workday state persists.
  8. Verify attendance/workday page reflects correct status.
  9. Verify employee cannot see department-wide workday team data.
- **Workflow steps (Manager)**:
  1. Open team/workday view.
  2. Verify only scoped users appear.
  3. Verify presence/break/leave data is scoped correctly.
- **Expected result**: Logout does not equal End Day. Workday state persists accurately. Employee/Intern cannot see coworker live presence. Manager/TL only sees scoped team data.
- **Data created/updated**: Workday session, break logs, attendance events.
- **Dashboard impact**: Live status on dashboard updates.
- **Notification impact**: None natively expected, but verified if any.
- **Activity log impact**: Start/End workday and breaks logged.
- **Calendar impact**: N/A
- **Permission checks**: Employee can't view team status; Manager can view team.
- **Direct URL checks**: Access to `/workday/team` works properly (empty for employee, populated for manager).
- **Pass/Fail**: TBD
- **Issue found**: TBD
- **Fix required**: TBD

## Workflow 6 — Settings and Profile
- **Role**: EMPLOYEE and SUPER_ADMIN
- **Test user**: test_employee@example.com & test_admin@example.com
- **Modules to test**: Settings, Profile
- **Workflow steps (Employee)**:
  1. Open Settings.
  2. Update profile info if allowed.
  3. Change local appearance setting.
  4. Verify local-only banner exists.
  5. Save notification/ticket preferences.
  6. Refresh page.
  7. Verify persistence behavior matches P1-4 rules.
  8. Upload/remove profile photo.
  9. Verify activity log for photo upload/removal.
  10. Try accessing admin settings directly.
- **Workflow steps (Admin)**:
  1. Verify Company, Leave Policy, SLA, Task Types.
  2. Verify SMTP is visible only to SUPER_ADMIN.
  3. Save one safe setting if appropriate.
  4. Verify success only after API success.
- **Expected result**: Local-only settings are honestly labeled. Backend preferences persist. Profile photo upload/remove works. Employee cannot access admin/global settings.
- **Data created/updated**: User profile preferences updated, Avatar updated.
- **Dashboard impact**: N/A
- **Notification impact**: N/A
- **Activity log impact**: Profile updates logged.
- **Calendar impact**: N/A
- **Permission checks**: Admin settings denied for Employee.
- **Direct URL checks**: Employee access to `/settings/company`, `/settings/smtp` fails.
- **Pass/Fail**: TBD
- **Issue found**: TBD
- **Fix required**: TBD

## Workflow 7 — Attachments / Documents
- **Role**: EMPLOYEE
- **Test user**: test_employee@example.com
- **Modules to test**: Tickets, Documents
- **Workflow steps (Tickets)**:
  1. Upload ticket attachment.
  2. Refresh.
  3. View/download.
  4. Delete.
  5. Refresh.
  6. Verify deleted attachment is gone.
  7. Verify activity log.
- **Workflow steps (Documents)**:
  1. Upload document.
  2. Refresh.
  3. Verify visibility.
  4. Delete document.
  5. Verify activity log.
  6. Verify unauthorized user cannot view/delete.
- **Expected result**: No upload is permanent unless intentionally read-only. No upload is stealth/unlogged. Unauthorized access is blocked.
- **Data created/updated**: S3/Local attachments and DB metadata.
- **Dashboard impact**: N/A
- **Notification impact**: N/A
- **Activity log impact**: Upload/Delete attachment logged.
- **Calendar impact**: N/A
- **Permission checks**: Others can't delete document.
- **Direct URL checks**: Access to internal S3 path / attachment URL blocked for unauthorized users.
- **Pass/Fail**: TBD
- **Issue found**: TBD
- **Fix required**: TBD

## Workflow 8 — Calendar
- **Role**: ALL ROLES
- **Test user**: test_employee@example.com & test_manager@example.com
- **Modules to test**: Calendar
- **Workflow steps**:
  1. Open calendar.
  2. Verify ticket due dates.
  3. Verify leave date ranges.
  4. Verify multi-day leave renders inclusive of final date.
  5. Verify no timezone shift.
  6. Verify partial failure warning behavior if possible.
  7. Click calendar event.
  8. Confirm drilldown opens correct source record.
  9. Verify role-scoped events only.
- **Expected result**: Calendar events map to real DB records. Dates are correct. Unauthorized events do not appear. Project deadlines remain intentionally unsupported unless product expects them.
- **Data created/updated**: N/A
- **Dashboard impact**: N/A
- **Notification impact**: N/A
- **Activity log impact**: N/A
- **Calendar impact**: Fully populated accurately.
- **Permission checks**: Events scoped per role.
- **Direct URL checks**: Drilldown URLs scoped.
- **Pass/Fail**: TBD
- **Issue found**: TBD
- **Fix required**: TBD

## Workflow 9 — Notifications and Activity
- **Role**: ALL ROLES
- **Test user**: test_employee@example.com
- **Modules to test**: Notifications, Activity
- **Workflow steps**:
  1. Trigger an action that should create notification/activity.
  2. Verify notification appears for correct recipient only.
  3. Verify activity appears in correct scoped feed only.
  4. Mark notification read/delete if supported.
  5. Refresh.
  6. Verify state persists.
  7. Confirm unrelated users do not receive/see private notifications.
- **Expected result**: No notification leakage. No activity leakage. Read/delete state persists. Empty/error states are honest.
- **Data created/updated**: Notifications read state updated.
- **Dashboard impact**: Notification bubble counts updated.
- **Notification impact**: Correct recipients get them.
- **Activity log impact**: Event logged.
- **Calendar impact**: N/A
- **Permission checks**: Scope fully validated.
- **Direct URL checks**: Fetching `/notifications` returns scoped data.
- **Pass/Fail**: TBD
- **Issue found**: TBD
- **Fix required**: TBD

## Direct URL / API Access Checks
- **Modules to test**: Platform Security
- **Workflow steps**:
  For restricted roles (EMPLOYEE, INTERN), test direct URLs:
  - `/departments`
  - `/users`
  - `/users/:id/profile`
  - `/settings/company`
  - `/settings/policies`
  - `/settings/email`
  - `/projects/:id`
  - `/tickets/:id`
  - `/leave`
  - `/activity`
  - `/calendar`
- **Expected result**: Unauthorized pages block, redirect, or show forbidden state. Unauthorized APIs return 401/403 or scoped empty data. No hidden route leaks private data.
- **Pass/Fail**: TBD
- **Issue found**: TBD
- **Fix required**: TBD
