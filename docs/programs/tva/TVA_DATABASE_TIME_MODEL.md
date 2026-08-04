# TVA_DATABASE_TIME_MODEL.md

Date: 2026-06-06
Mode: Read-only forensic audit

## Summary

The database has two major operational time ledgers:

1. Workday/attendance: `WorkSession`, `BreakLog`, `AttendanceEvent`, and `User.currentStatus/lastActiveAt`.
2. Ticket work: `Ticket`, `TicketTimeLog`, and `ReviewCycleLog`.

There is no single `TimeAuthority` or `TVA` table/model. Authority is spread across domain models and services.

## Time Fields By Model

| Table/Model | Field | Purpose | Used By |
| --- | --- | --- | --- |
| `User` | `lastActiveAt` | Last activity timestamp for status/idle logic | auth login, workday resume/end break, scheduler auto-logout |
| `User` | `createdAt` | user creation audit | users/admin views |
| `User` | `updatedAt` | user update audit | users/profile |
| `User` | `dateOfBirth` | profile date | user profile |
| `User` | `joiningDate` | employment/profile date | user profile |
| `User` | `verificationDate` | HR/profile verification date | profile/documents |
| `EmployeeDocument` | `verifiedAt` | document verification time | user documents |
| `EmployeeDocument` | `uploadedAt` | upload time | user documents |
| `EmployeeDocument` | `updatedAt` | document update time | user documents |
| `Role` | `createdAt` | role creation audit | role admin |
| `Department` | `createdAt` | department creation audit | department admin |
| `Project` | `startDate` | project schedule | projects |
| `Project` | `endDate` | project deadline | projects/dashboard |
| `Project` | `createdAt` | project creation audit | projects/dashboard |
| `Project` | `updatedAt` | project update audit | projects |
| `ProjectStage` | `startDate` | stage schedule | project detail |
| `ProjectStage` | `endDate` | stage deadline | project detail |
| `ProjectStage` | `createdAt` | stage audit | project detail |
| `ProjectStage` | `updatedAt` | stage audit | project detail |
| `ProjectMember` | `joinedAt` | membership start | project members |
| `Ticket` | `estimatedMinutes` | execution estimate | ticket create/update, SLA calculation |
| `Ticket` | `scheduledStartAt` | scheduled execution start | ticket timing, calendar, kanban |
| `Ticket` | `scheduledEndAt` | scheduled execution end | calendar/kanban display |
| `Ticket` | `actualStartAt` | actual execution start | ticket timing/detail |
| `Ticket` | `actualCompletedAt` | actual completion time | ticket detail/export |
| `Ticket` | `dueDate` | explicit due date | ticket timing/calendar/dashboard |
| `Ticket` | `scheduledFor` | one-time schedule/reminder | scheduler |
| `Ticket` | `scheduleEndDate` | recurring schedule end | scheduler |
| `Ticket` | `resolvedAt` | resolution time | dashboard trend, digest |
| `Ticket` | `executionDueAt` | execution SLA due time | ticket timing, analytics |
| `Ticket` | `submittedAt` | submitted for review | ticket timing |
| `Ticket` | `reviewStartedAt` | review clock start | ticket timing/review cycle |
| `Ticket` | `reviewDueAt` | review SLA due time | ticket timing |
| `Ticket` | `closedAt` | closed time | ticket ledger total age |
| `Ticket` | `cancelledAt` | cancelled time | ticket timing/ledger |
| `Ticket` | `createdAt` | creation time | tickets, dashboard, analytics, automation |
| `Ticket` | `updatedAt` | update time | tickets, dashboard, analytics |
| `Ticket` | `blockedAt` | SLA freeze/block time | ticket timing |
| `TicketAssignee` | `assignedAt` | assignment time | tickets/assignees |
| `Comment` | `createdAt` | comment creation | ticket comments |
| `Comment` | `updatedAt` | comment update | ticket comments |
| `Attachment` | `createdAt` | upload time | ticket attachments |
| `LeaveRequest` | `startDate` | leave start | leave/calendar/scheduler |
| `LeaveRequest` | `endDate` | leave end | leave/calendar/scheduler |
| `LeaveRequest` | `approvedAt` | approval time | leave audit |
| `LeaveRequest` | `rejectedAt` | rejection time | leave audit |
| `LeaveRequest` | `createdAt` | request time | leave/dashboard |
| `LeaveRequest` | `updatedAt` | update time | leave |
| `Notification` | `createdAt` | notification time | topbar/list |
| `ActivityLog` | `createdAt` | activity time | activity feed |
| `TicketHistory` | `changedAt` | history event time | ticket history |
| `TaskType` | `createdAt` | setup audit | settings |
| `AppSetting` | `updatedAt` | setting change time | settings audit |
| `WorkSession` | `date` | company date for workday | workday/team/dashboard/scheduler |
| `WorkSession` | `loginAt` | login/session presence time | auth/workday |
| `WorkSession` | `startWorkAt` | work tracking start | workday runtime |
| `WorkSession` | `logoutAt` | work/session end | workday runtime/history |
| `WorkSession` | `totalLoggedMinutes` | stored duration placeholder | not primary in code |
| `WorkSession` | `totalBreakMinutes` | stored break total | workday history/display/runtime seed |
| `WorkSession` | `totalIdleMinutes` | stored idle total | not primary in code |
| `WorkSession` | `totalWorkMinutes` | stored work total | workday history/display |
| `WorkSession` | `autoClosedAt` | auto-close event time | workday runtime/history |
| `WorkSession` | `createdAt` | session creation audit | workday ordering |
| `WorkSession` | `updatedAt` | session update audit | workday |
| `BreakLog` | `estimatedMinutes` | planned break duration | break modal/team tooltip |
| `BreakLog` | `startAt` | break start | workday runtime |
| `BreakLog` | `endAt` | break end | workday runtime |
| `BreakLog` | `durationMinutes` | stored break duration | workday totals/history |
| `BreakLog` | `createdAt` | break audit | workday |
| `UserWorkdayPolicyOverride` | `createdAt` | override audit | settings/workday |
| `UserWorkdayPolicyOverride` | `updatedAt` | override audit | settings/workday |
| `AttendanceEvent` | `timestamp` | attendance event time | audit/history |
| `OperationalEvent` | `timestamp` | activity/event time | calendar/activity |
| `ManagerDeptAccess` | `createdAt` | access audit | user/team visibility |
| `TicketTimeLog` | `startedAt` | ticket work/review start | ledger/analytics |
| `TicketTimeLog` | `endedAt` | ticket work/review end | ledger/analytics |
| `TicketTimeLog` | `durationSeconds` | stored productive/review seconds | analytics |
| `TicketTimeLog` | `createdAt` | log audit | ledger |
| `TicketTimeLog` | `updatedAt` | log audit | ledger |
| `ReviewCycleLog` | `reviewStartedAt` | review cycle start | analytics |
| `ReviewCycleLog` | `reviewEndedAt` | review cycle end | analytics |
| `ReviewCycleLog` | `reworkStartedAt` | rework start | analytics |
| `ReviewCycleLog` | `reworkEndedAt` | rework end | analytics |
| `ReviewCycleLog` | `createdAt` | cycle audit | analytics |
| `ReviewCycleLog` | `updatedAt` | cycle audit | analytics |
| `EmployeeProfileChangeRequest` | `approvedAt` | approval time | approvals |
| `EmployeeProfileChangeRequest` | `rejectedAt` | rejection time | approvals |
| `EmployeeProfileChangeRequest` | `cancelledAt` | cancellation time | approvals |
| `EmployeeProfileChangeRequest` | `createdAt` | request time | approvals |
| `EmployeeProfileChangeRequest` | `updatedAt` | request update | approvals |

## Model Assessment

Authoritative current workday state is split between:

- `WorkSession.status`, `startWorkAt`, `logoutAt`, totals.
- `BreakLog.startAt`, `endAt`, `durationMinutes`.
- `User.currentStatus`, `lastActiveAt`.

This is a TVA risk because team status often reads `User.currentStatus`, while work minutes come from `WorkSession` calculations.

Authoritative ticket time is split between:

- `Ticket` due/status timestamps for SLA.
- `TicketTimeLog.durationSeconds` for actual productive/review work.
- `ReviewCycleLog` for review/rework cycle metrics.

This split is valid only if the UI labels each metric precisely. It becomes a violation when "SLA", "time spent", "age", and "productive hours" are treated as interchangeable.

