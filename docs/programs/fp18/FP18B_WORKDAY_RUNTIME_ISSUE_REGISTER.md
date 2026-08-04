# FP-18B WORKDAY RUNTIME ISSUE REGISTER

## Phase 4: API Response Field Audit

We audited the following endpoints that handle workday state transitions:

1. **POST /workday/start**
   - **Current Return**: `{ session }`
   - **Issue**: It only returns the newly created (or updated) session. It does not return the aggregated `elapsedWorkMinutes` or `firstStartTime` for the day. If a user is resuming after an auto-close, the frontend `WorkdayBar` won't immediately know the true daily totals until it refetches `/workday/today`.

2. **POST /workday/break/start**
   - **Current Return**: `{ breakLog }`
   - **Issue**: It only returns the newly created `breakLog`.

3. **POST /workday/break/end**
   - **Current Return**: `{ breakLog, durationMinutes }`
   - **Issue**: It only returns the closed break and its duration.

4. **POST /workday/end**
   - **Current Return**: `{ session: updated }` (implicit)
   - **Issue**: Same as above, does not return day's aggregated totals.

**Recommendation**: All state transition endpoints (start, break start, break end, end work) should ideally return the fully aggregated payload (matching `/workday/today`) so the frontend doesn't need a follow-up fetch to get accurate running totals.

## Phase 5: Frontend Component Verification

1. **WorkdayBar.tsx**
   - Uses `getToday()` which returns `elapsedWorkMinutes`, `totalBreakMinutes`, etc.
   - It correctly computes live time: `const diffMin = Math.max(0, Math.floor(diffMs / 60000) - totalBreakMinutes - currentBreakMins);`
   - **Bug fixed**: Previously it was getting duplicate or single session data from `dashboardApi`. Now that we created `calculateWorkdayRuntime()`, we guarantee deterministic aggregation.

2. **Team Status Page**
   - Relies on `/workday/team` which now uses the deterministic `calculateWorkdayRuntime()` helper. This guarantees that Team Status matches `WorkdayBar` exactly.

## Phase 6: Code Issues Discovered & Fixed

| Issue | Location | Status | Resolution |
|-------|----------|--------|------------|
| **Dashboard single-session bug** | `dashboard.service.ts` | **FIXED** | Dashboard was using `findFirst` to get workday status, causing totals to drop prior sessions in the same day. Updated `getWorkdayStatus` to fetch all sessions and use `calculateWorkdayRuntime`. |
| **Local time zone bug** | `dashboard.service.ts` | **FIXED** | Dashboard was using `new Date(); today.setHours(0,0,0,0)` which is server local time instead of the company configured timezone `TimezoneUtil.getCompanyTodayDate()`. Fixed alongside the aggregation bug. |
| **Duplicate Calculation Logic** | `workday.service.ts` | **FIXED** | Both `getToday()` and `getTeam()` duplicated a complex `for` loop to aggregate sessions and open breaks. Extracted to a pure `calculateWorkdayRuntime` helper with exhaustive unit tests. |
| **Unused Field: totalLoggedMinutes** | `schema.prisma` | **LOGGED** | The DB model `WorkSession` has a `totalLoggedMinutes` field that is never updated or used by the system. It should be removed in a future PR to avoid confusion. |
| **Edge Case: Missed open breaks** | `workday.service.ts` | **LOGGED** | If a break is left open and the day auto-closes, the next day's calculations might drift if the break is never formally closed. The dynamic calculation handles it live, but the DB record remains open permanently. |
