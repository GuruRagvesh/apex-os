# Leave Balance Engine Report

**Date:** 2026-05-27  
**Status:** Completed, Verified, & Tested

---

## 1. Engine Architecture & Rules

The leave balance engine has been implemented as a centralized `LeaveBalanceService` to enforce strict corporate leave policies and prevent balance deficits.

### A. Yearly Allocation & Quotas
- Quotas are resolved dynamically using company configuration settings with standard fallbacks:
  - **SUPER_ADMIN / ADMIN / MANAGER:** 15 days/year
  - **TEAM_LEAD / EMPLOYEE:** 12 days/year
  - **INTERN:** 6 days/year
- Leave cycles are bound to the calendar year (January 1 to December 31).

### B. Deduction & Working Days
- Duration calculations exclude non-working days based on the department or company schedule:
  - **Mon-Fri schedule (5 days):** Saturdays and Sundays are excluded from duration counts.
  - **Mon-Sat schedule (6 days):** Sundays are excluded.
  - **Mon-Sun schedule (7 days):** No weekend days are excluded.

### C. Holiday Handling
- A static list of national public holidays (including Republic Day, Holi, Independence Day, Gandhi Jayanti, Diwali, Christmas, etc.) is checked. If a holiday falls in the requested date range, it is automatically excluded from the leave duration deduction.

### D. Half-Day Logic
- Added database schema support for half-day leaves:
  - `isHalfDay` (Boolean) - forces the calculated duration of the request to be exactly `0.5` days.
  - `halfDayType` (String) - stores `FIRST_HALF` or `SECOND_HALF`.

---

## 2. Validation Policies

1. **Deficit Prevention:** Before a leave request is created, the system calculates the user's remaining balance (`Allocation - Approved Leaves`). If the requested duration exceeds the balance, it throws a `ForbiddenException` with a descriptive message.
2. **Overlapping Prevention:** The system blocks creation of any leave request that overlaps with an existing `PENDING` or `APPROVED` leave request for the same user.
3. **Empty Request Blocking:** Ranges consisting entirely of non-working days or holidays are rejected (e.g. requesting leave only on a Sunday under a Mon-Sat schedule).

---

## 3. Verification & Testing

The engine is covered by a comprehensive suite of unit tests in [p1.leave-balance.spec.ts](file:///c:/Users/Administrator/Desktop/nexus-app/backend/test/unit/p1.leave-balance.spec.ts) covering:
- **Allocation Checks:** Role-to-quota mappings.
- **Duration calculations:** Exclusions of Sundays, Saturdays, and holidays.
- **Half-day validation:** Accurate deduction of `0.5` days.
- **Overlapping requests:** Rejection of conflicting dates.
- **Balance checking:** Rejection of requests exceeding remaining quotas.

All tests passed successfully:
```bash
PASS test/unit/p1.leave-balance.spec.ts
  LeaveBalanceService
    getYearlyAllocation
      √ returns role-based quota
      √ returns default value if role quota not found
    calculateLeaveDuration
      √ excludes Sundays under Mon-Sat working schedule
      √ excludes Saturdays and Sundays under Mon-Fri working schedule
      √ excludes company public holidays
      √ counts half days as exactly 0.5 days
    getLeaveBalance
      √ correctly calculates dynamic balance
    validateLeaveRequest
      √ throws ForbiddenException when there is an overlapping request
      √ throws ForbiddenException when balance is insufficient
```
