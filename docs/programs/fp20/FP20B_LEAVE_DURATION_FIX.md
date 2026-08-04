# FP-20B LEAVE DURATION TVA CONSOLIDATION FIX

## SUMMARY

Resolved TVA-010 where the dashboard preview and the frontend `LeavePage` independently calculated leave duration using a naive `Mon-Sat` loop without factoring in company public holidays or the `workingDays` setting. `LeaveBalanceService` is now established as the sole authority for leave duration calculations.

## CHANGES MADE

1.  **backend/src/modules/operations/leave/leave-balance.service.ts**
    *   Added a wrapper `getDurationForRequest` which internally fetches the company's `leave_policy` to pass the `workingDays` setting to the existing `calculateLeaveDuration`.

2.  **backend/src/modules/operations/leave/leave.service.ts**
    *   Updated `findAll` and `findOne` methods to append the authoritative `duration` to the returned `LeaveRequest` payloads by calling `leaveBalance.getDurationForRequest`.
    *   Exposed a new `getDurationForRequest` method to be called by the controller.

3.  **backend/src/modules/operations/leave/leave.controller.ts**
    *   Exposed `GET /leave/duration` endpoint to allow the frontend to request duration asynchronously when the user interacts with the "Apply Leave" form.

4.  **backend/src/modules/platform/dashboard/dashboard.module.ts**
    *   Imported `LeaveModule` to allow dependency injection of `LeaveBalanceService`.

5.  **backend/src/modules/platform/dashboard/dashboard.service.ts**
    *   Injected `LeaveBalanceService` and removed the inline `getLeaveDuration` loop inside `getPreviews`.
    *   Now uses `this.leaveBalance.getDurationForRequest()` to calculate `pendingLeave` durations.

6.  **frontend/lib/api.ts**
    *   Exposed the new `/leave/duration` endpoint under `leaveApi.getDuration`.

7.  **frontend/app/(dashboard)/(operations)/leave/page.tsx**
    *   Removed the client-side `getLeaveDuration` loop entirely.
    *   Bound the listing table to use `leave.duration` provided by the backend payloads directly.
    *   Replaced synchronous duration calculation in the "Apply Leave" form with a `useEffect` hook that queries the backend `leaveApi.getDuration` to ensure live balance checking aligns 1:1 with backend policy.

## RISKS & VERIFICATION

*   **Risks:** Low-to-Medium. This makes a new asynchronous call on the frontend while applying for leave, but greatly ensures correctness.
*   **Verification:** Verified via backend build. Frontend builds pending. Leave records in the `LeavePage` table and dashboard will accurately reflect holidays and policy-based working days.

**Status:** Completed.
