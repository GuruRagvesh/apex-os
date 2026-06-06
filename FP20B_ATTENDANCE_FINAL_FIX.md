# FP20B_ATTENDANCE_FINAL_FIX

## Objective
Close the remaining Attendance Authority violations (TVA-004) by refactoring the final 4 rogue functions to route through `AttendanceAuthorityService`.

## Changes Made
1. **AttendanceAuthorityService**:
   - Added `updateManyWorkSessions` to handle bulk updates for attendance state.
   - Added `updateManyUserStatus` to handle bulk updates for user presence.
   - Added `continuationOfSessionId` property to `createWorkSession` to support resuming auto-closed work.
   
2. **WorkdayService**:
   - Refactored `reportIdle` to use `attendanceAuthority.updateManyWorkSessions` and `setUserStatus`.
   - Refactored `resumeWork` to use `attendanceAuthority.updateManyWorkSessions` and `setUserStatus`.
   - Refactored `resumeAutoClosedWork` to use `attendanceAuthority.createWorkSession` and `setUserStatus`.

3. **SchedulerService**:
   - Refactored `autoLogoutInactive` to use `attendanceAuthority.updateManyWorkSessions` and `setUserStatus`.
   - Refactored leave status reset (line 180) to use `attendanceAuthority.updateManyUserStatus` instead of direct `prisma.user.updateMany`.

4. **Testing**:
   - Updated `scheduler.service.spec.ts` assertions to check `attendanceAuthority.updateWorkSession` instead of `prisma.workSession.update`.
   - Supplied `AttendanceAuthorityService` and `CompanyDateService` mocks across the test suite (`auth.otp.spec.ts`, `p1d.dashboard-consistency.spec.ts`, `scheduler.recurring.spec.ts`, `tva-sla-authority.spec.ts`, `workday.history.spec.ts`) to fix 8 broken test suites.

## Status
All attendance writes are now securely encapsulated within the authoritative boundary. Tests are green.
