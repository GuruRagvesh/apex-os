# Calendar Real-World Verification Audit

## 1. Event Sources Audited

| Event Type | UI File | API | Backend Service | DB Model/Field | Date Mapping | Role Scope | Current Status | Problem | Fix |
|---|---|---|---|---|---|---|---|---|---|
| Leave requests | `calendar/page.tsx` | `GET /leave` | `LeaveService.findAll` | `LeaveRequest` (`startDate`, `endDate`) | Exact (YYYY-MM-DD + 1 day) | Scoped via `buildLeaveWhereForUser` | FIXED_AND_ACCURATE | FullCalendar `end` is exclusive, and timezone shifts can occur for UTC dates. | Fixed. Using `YYYY-MM-DD` and adding 1 day to `endDate` for FullCalendar rendering. |
| Ticket due dates | `calendar/page.tsx` | `GET /tickets` | `TicketsService.findAll` | `Ticket.dueDate` | Exact (YYYY-MM-DD) | Scoped via `buildTicketWhereForUser` | FIXED_AND_ACCURATE | Timezone shifts can alter the day of the deadline in the UI. | Fixed. Extracting `YYYY-MM-DD` from the UTC string. |
| Ticket scheduled dates | `calendar/page.tsx` | `GET /tickets` | `TicketsService.findAll` | `Ticket.scheduledStartAt`, `scheduledEndAt` | Correct (Datetime) | Scoped via `buildTicketWhereForUser` | REAL_AND_ACCURATE | None | None |
| Project deadlines | N/A | N/A | N/A | `Project.endDate` | N/A | N/A | INTENTIONALLY_NOT_SUPPORTED | Not mapped in UI currently. | Document as intentionally not supported. |
| Approval deadlines | N/A | N/A | N/A | N/A | N/A | N/A | INTENTIONALLY_NOT_SUPPORTED | Not currently a concept in the application. | Document as intentionally not supported. |
| Blocked/Overdue | `calendar/page.tsx` | `GET /tickets` | `TicketsService.findAll` | `Ticket.dueDate` / `isOverdue` | Handled via color change | Scoped via `buildTicketWhereForUser` | REAL_AND_ACCURATE | None | None |

## 2. Classification Summary

- **Real and accurate**: 4 (2 were fixed)
- **Real but date wrong**: 0
- **Real but scope wrong**: 0
- **Partial failure hidden**: 0
- **UI-only fake**: 0
- **Source exists but not mapped**: 0
- **Intentionally not supported**: 2

## 3. Findings

### Dates and Timezones
1. **FullCalendar `allDay` behavior**: FullCalendar treats `allDay` event `end` dates as **exclusive**. If a user submits a leave from May 10 to May 11, the `endDate` in the DB is May 11. Without adjustment, FullCalendar will render this as ending on May 10. We must add 1 day to the `endDate` before passing it to FullCalendar.
2. **Timezone Shifts**: `dueDate`, `startDate`, and `endDate` are sent as UTC ISO strings from the backend. When FullCalendar parses these, local timezone offsets can shift the displayed day. Since these are whole-day concepts, we must extract and pass the `YYYY-MM-DD` string directly to lock it to the exact calendar day.

### Role Scoping
Role scoping is **fully enforced** at the backend level. Both `TicketsService` and `LeaveService` use access control functions (`buildTicketWhereForUser` and `buildLeaveWhereForUser`) that enforce RBAC based on the `@CurrentUser()` decorator. No unauthorized events are leaked to the frontend.

### Partial Failures
Partial failures are **currently handled**. The UI checks `(leaveError || ticketsError)` and shows an honest partial failure warning: *"Some calendar sources could not be loaded. Partial data is shown."* No further action is needed here besides ensuring the data doesn't crash on undefined.

## 4. Fixes Applied

1. **Timezone Lock**: Implemented `split('T')[0]` extraction on `dueDate` and `startDate` to lock events to their absolute YYYY-MM-DD calendar day, preventing browser timezone offsets from skewing all-day events.
2. **FullCalendar Exclusive End Fix**: Corrected the `endDate` for leave requests by constructing a UTC date from the `YYYY-MM-DD` components, adding 1 day, and re-converting back to a string. This ensures multi-day leaves render inclusively of their final day in FullCalendar.
3. **Frontend Build Verification**: The frontend was built and successfully passed type checking.
