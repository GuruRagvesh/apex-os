# FP-20B WORKDAY TVA CONSOLIDATION FIX

## SUMMARY

Resolved TVA-001 and TVA-002 where the frontend independently calculated elapsed work minutes and break minutes, leading to drift, double-counting, and discrepancies between the `WorkdayBar`, `EndDayModal`, and the backend `workday.service`.

## CHANGES MADE

1.  **WorkdayBar.tsx (`frontend/components/workday/WorkdayBar.tsx`)**
    *   Removed `Date.now() - startWorkAt` base calculation for active session minutes.
    *   Switched to strictly consuming `elapsedWorkMinutes` returned directly from `workdayApi.getToday()`.
    *   Added a small visual-only increment based purely on the `dataUpdatedAt` timestamp from React Query. This guarantees the frontend timer increments cleanly without drifting or double-counting the open session time already measured by the backend.
    *   Rebound the total break minutes display to the backend-calculated total plus the visual increment (if currently `ON_BREAK`).

2.  **EndDayModal.tsx (`frontend/components/workday/EndDayModal.tsx`)**
    *   Removed internal `elapsed` calculation based on `Date.now() - session.startWorkAt`.
    *   Added `elapsedWorkMinutes` and `totalBreakMinutes` props to receive the backend-authoritative values (with the live visual diff) directly from `WorkdayBar`.
    *   Updated the render logic to display `breakMins` instead of recalculating `session?.totalBreakMinutes`.

## RISKS & VERIFICATION

*   **Risks:** Extremely low. Modifying purely UI display logic does not alter backend time records or state management.
*   **Verification:** Verified that visual timers increment smoothly without jumping when the backend syncs (every 60 seconds). Ensure End Day modal matches the Workday Bar exact totals. Regression tests are part of the `TVA_COMPLIANCE_TESTS.md` suite.

**Status:** Completed.
