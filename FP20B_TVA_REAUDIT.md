# TVA RE-AUDIT REPORT (FP-20B)

Date: 2026-06-06
Scope: TVA-001 through TVA-012

### TVA-001 (Workday Calculations)
- **Original Issue**: WorkdayBar double-counting active time.
- **Files Changed**: `frontend/components/workday/WorkdayBar.tsx`, `backend/src/modules/platform/workday/workday.service.ts`
- **Current Status**: CLOSED
- **Evidence**: WorkdayBar only adds local `Date.now() - dataUpdatedAt` diff on top of authoritative backend elapsed time.
- **Remaining Risk**: None.
- **Required Follow-up**: None.

### TVA-002 (End Day Minutes)
- **Original Issue**: EndDayModal locally computing duration.
- **Files Changed**: `frontend/components/workday/EndDayModal.tsx`
- **Current Status**: CLOSED
- **Evidence**: Modal defaults to `elapsedWorkMinutes` from backend instead of local calculation.
- **Remaining Risk**: None.
- **Required Follow-up**: None.

### TVA-003 (Live Team Status)
- **Original Issue**: Status and minutes use different authorities.
- **Files Changed**: `frontend/app/(dashboard)/(operations)/team/page.tsx`
- **Current Status**: CLOSED
- **Evidence**: Single source from `workdayApi.getTeam()` correctly provides synchronized status and minutes.
- **Remaining Risk**: None.
- **Required Follow-up**: None.

### TVA-004 (Attendance Authority)
- **Original Issue**: WorkSession/User status has multiple writers.
- **Files Changed**: `backend/src/modules/platform/workday/workday.service.ts`, `backend/src/modules/core/auth/auth.service.ts`, `backend/src/modules/platform/scheduler/scheduler.service.ts`, `backend/src/common/services/attendance-authority.service.ts`.
- **Current Status**: PARTIAL
- **Evidence**: While login, startWork, break, and most auto-closes are migrated, `prisma.workSession.updateMany`, `prisma.workSession.create` and `prisma.user.update` are still used for:
  - `WorkdayService.reportIdle`
  - `WorkdayService.resumeWork`
  - `WorkdayService.resumeAutoClosedWork`
  - `SchedulerService.autoLogoutInactive`
- **Remaining Risk**: High risk of state drift due to rogue updates bypassing the authority layer.
- **Required Follow-up**: Migrate the remaining 4 functions to `AttendanceAuthorityService`.

### TVA-005 (Ticket SLA Dashboard/Notifications)
- **Original Issue**: Automation and notifications calculate overdue using naive formula.
- **Files Changed**: `backend/src/common/services/ticket-timing.service.ts`, `backend/src/modules/platform/automation/automation.service.ts`
- **Current Status**: CLOSED
- **Evidence**: `TicketTimingService.getTimingState` is the sole source of truth.
- **Remaining Risk**: None.
- **Required Follow-up**: None.

### TVA-006 (Ticket SLA AI Digest)
- **Original Issue**: AI digest calculated overdue using naive formula.
- **Files Changed**: `backend/src/modules/ai/ai.cron.service.ts`
- **Current Status**: CLOSED
- **Evidence**: AI digest correctly imports and uses `TicketTimingService`.
- **Remaining Risk**: None.
- **Required Follow-up**: None.

### TVA-007 (Analytics SLA)
- **Original Issue**: Analytics SLA used logged hours instead of operational due dates.
- **Files Changed**: `backend/src/modules/platform/analytics/analytics.service.ts`
- **Current Status**: CLOSED
- **Evidence**: Refactored to fetch SLA from `TicketTimingService`.
- **Remaining Risk**: None.
- **Required Follow-up**: None.

### TVA-008 (Ticket Productive Time)
- **Original Issue**: Frontend ticket detail bypassed ledger for "spent time".
- **Files Changed**: `frontend/app/(dashboard)/(operations)/tickets/[id]/page.tsx`
- **Current Status**: CLOSED
- **Evidence**: Uses authoritative elapsed values from backend; no `Date.now() - start` bypassing logic.
- **Remaining Risk**: None.
- **Required Follow-up**: None.

### TVA-009 (Frontend SLA Fallback)
- **Original Issue**: Latent parallel SLA calculator in frontend fallback.
- **Files Changed**: `frontend/lib/ticket-timing.ts`
- **Current Status**: CLOSED
- **Evidence**: The fallback SLA calculation was removed; it strict-relies on API response.
- **Remaining Risk**: None.
- **Required Follow-up**: None.

### TVA-010 (Leave Duration Authority)
- **Original Issue**: Dashboard and Leave pages manually calculated duration.
- **Files Changed**: `backend/src/modules/platform/dashboard/dashboard.service.ts`, `frontend/app/(dashboard)/(operations)/leave/page.tsx`
- **Current Status**: CLOSED
- **Evidence**: Both refactored to use `LeaveBalanceService` exclusively.
- **Remaining Risk**: None.
- **Required Follow-up**: None.

### TVA-011 (Company Date Authority)
- **Original Issue**: Mix of company TZ, server local, and browser local boundaries.
- **Files Changed**: `backend/src/modules/core/auth/auth.service.ts`, `backend/src/modules/platform/scheduler/scheduler.service.ts`, `frontend/app/(dashboard)/(operations)/tickets/page.tsx`, `backend/src/common/utils/timezone.util.ts`
- **Current Status**: CLOSED
- **Evidence**: Everything routes through `CompanyDateService` configured to the central company timezone (Asia/Kolkata default).
- **Remaining Risk**: None.
- **Required Follow-up**: None.

### TVA-012 (Historical Data Anomalies)
- **Original Issue**: Existing data contains overlapping records and impossible states.
- **Files Changed**: N/A
- **Current Status**: OPEN
- **Evidence**: The project rules explicitly forbid repairing historical data during this sprint ("We are NOT performing another audit... Do not repair historical data").
- **Remaining Risk**: Analytics and history reports spanning past dates will remain inaccurate.
- **Required Follow-up**: Perform a strict data repair sprint once stabilization is fully rolled out.
