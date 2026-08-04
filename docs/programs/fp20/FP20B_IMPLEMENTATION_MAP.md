# FP-20B IMPLEMENTATION MAP

## PROJECT

APEX OS (AI-Powered Enterprise eXecution) - TVA CONSOLIDATION IMPLEMENTATION SPRINT

## CONTEXT

Consolidation of Time Value Authority (TVA) across APEX OS to eliminate duplicate time calculations, establish single sources of truth, and stabilize metrics. This phase explicitly forbids new features and historical data modification.

---

## TVA VIOLATIONS MAP

### 1. TVA-001 & TVA-002: Workday Calculation Consolidation
**Problem:** Frontend calculates workday time independently, leading to drift and double counting.
*   **Exact file paths:**
    *   `frontend/components/workday/WorkdayBar.tsx`
    *   `frontend/components/workday/EndDayModal.tsx`
*   **Exact functions:**
    *   `WorkdayBar` (`useEffect` calculating `Date.now() - startWorkAt`)
    *   `EndDayModal` (`elapsed` calculation)
*   **Dependencies:** `workdayApi.getToday()`
*   **API Impact:** None. Frontend purely consumes existing backend responses.
*   **Frontend Impact:** Replaces live timers with state driven by backend `elapsedWorkMinutes` plus local visual-only increment based strictly on backend diff.
*   **Test Impact:** Add tests comparing frontend displayed minutes vs workday API response minutes.
*   **Risk Level:** Low.

### 2. TVA-004: Attendance Authority Consolidation
**Problem:** Multiple writers mutate `User.currentStatus` and `WorkSession.status`.
*   **Exact file paths:**
    *   `backend/src/modules/platform/attendance/attendance-authority.service.ts` [NEW]
    *   `backend/src/modules/platform/workday/workday.service.ts`
    *   `backend/src/modules/core/auth/auth.service.ts`
    *   `backend/src/modules/platform/scheduler/scheduler.service.ts`
*   **Exact functions:**
    *   `AuthService.login`
    *   `SchedulerService.setLeaveStatuses`, `autoCloseMidnightSessions`, `autoLogoutInactive`
    *   `WorkdayService.startWork`, `endWork`, `startBreak`, `endBreak`, `reportIdle`, `resumeWork`, `resumeAutoClosedWork`
*   **Dependencies:** `PrismaService`, `EventLoggerService`.
*   **API Impact:** Internal refactor only. Endpoint signatures remain unchanged.
*   **Frontend Impact:** None.
*   **Test Impact:** High. Needs integration tests proving attendance state correctly routes through `AttendanceAuthorityService`.
*   **Risk Level:** Critical. (Touches auth, core workday logic, and scheduled background jobs).

### 3. TVA-005, TVA-006, TVA-007, TVA-009: Ticket SLA Authority Consolidation
**Problem:** Dashboard, Automation, AI Digest, Analytics, and Frontend fallback use different SLA formulas.
*   **Exact file paths:**
    *   `backend/src/common/services/ticket-timing.service.ts`
    *   `backend/src/modules/platform/automation/automation.service.ts`
    *   `backend/src/modules/ai/ai.cron.service.ts`
    *   `backend/src/modules/platform/analytics/analytics.service.ts`
    *   `frontend/lib/ticket-timing.ts`
*   **Exact functions:**
    *   `AutomationService` SLA check
    *   `AiCronService` daily digest SLA check
    *   `AnalyticsService` SLA breach calculation
    *   `computeClientTimingState` (Frontend fallback to be removed)
*   **Dependencies:** `TicketTimingService` injected into all callers.
*   **API Impact:** Analytics and AI endpoints will shift to align exactly with dashboard SLA metrics.
*   **Frontend Impact:** Deletion of `frontend/lib/ticket-timing.ts` fallback. Frontend relies entirely on `ticket.isOverdue` and `ticket.timing` from backend.
*   **Test Impact:** Must assert SLA outputs across Dashboard, Automation, AI, and Analytics are identical for the same ticket.
*   **Risk Level:** High.

### 4. TVA-008: Productive Time Authority
**Problem:** Ticket detail page calculates time natively instead of using `TicketLedgerService`.
*   **Exact file paths:**
    *   `backend/src/modules/operations/tickets/ticket-ledger.service.ts`
    *   `frontend/app/(dashboard)/(operations)/tickets/[id]/page.tsx`
*   **Exact functions:** Productive time UI display render function.
*   **Dependencies:** Ticket ledger API.
*   **API Impact:** None.
*   **Frontend Impact:** Remove `Date.now() - actualStartAt` calculation. Bind strictly to `ticket.durationSeconds`.
*   **Test Impact:** Add test proving ticket detail page duration matches `TicketLedgerService` output.
*   **Risk Level:** Medium.

### 5. TVA-010: Leave Duration Authority
**Problem:** Dashboard and Frontend independently calculate leave duration using Mon-Sat loops instead of the backend authority.
*   **Exact file paths:**
    *   `backend/src/modules/operations/leave/leave-balance.service.ts`
    *   `backend/src/modules/platform/dashboard/dashboard.service.ts`
    *   `frontend/app/(dashboard)/(operations)/leave/page.tsx`
*   **Exact functions:**
    *   Dashboard `preview` duration loop
    *   Leave Page duration loop
*   **Dependencies:** `LeaveBalanceService.calculateLeaveDuration`
*   **API Impact:** Dashboard API response might return explicitly calculated leave duration if missing.
*   **Frontend Impact:** UI must stop calculating duration. Form input must fetch duration from an API route upon date selection.
*   **Test Impact:** Test proving Dashboard and Leave endpoints utilize `LeaveBalanceService`.
*   **Risk Level:** Medium.

### 6. TVA-011: Company Date Authority
**Problem:** Three definitions of today exist: Company date, Server date, Browser date.
*   **Exact file paths:**
    *   `backend/src/common/utils/timezone.util.ts` or `backend/src/common/services/company-date.service.ts` [NEW]
    *   `backend/src/modules/core/auth/auth.service.ts`
    *   `backend/src/modules/platform/scheduler/scheduler.service.ts`
    *   `frontend/app/(dashboard)/(operations)/tickets/page.tsx`
*   **Exact functions:**
    *   Auth login: `today.setHours(0, 0, 0, 0)` -> Change to company timezone boundary.
    *   Scheduler: `today.setHours(0, 0, 0, 0)` -> Change to company timezone boundary.
    *   Frontend ticket filters: Due-today filters -> Change to backend-provided company date or API parameterized date.
*   **Dependencies:** Standardized `CompanyDateService`.
*   **API Impact:** Date boundaries shifted.
*   **Frontend Impact:** Minor refactor to stop using local browser Date for critical filtering.
*   **Test Impact:** Check business day calculation tests across multiple boundary cases.
*   **Risk Level:** High.

---

## SAFEST EXECUTION ORDER

To ensure system stability, fixes are ordered from lowest integration risk (UI presentation only) to highest risk (core state updates).

1.  **TASK 5 (TVA-008): Productive Time Authority**
    *   *Why:* Pure UI fix. Unbinds frontend from bad calculation.
2.  **TASK 2 (TVA-001, TVA-002): Workday TVA Consolidation**
    *   *Why:* Pure UI fix. Rebinds live dashboard to backend values without altering backend data logic.
3.  **TASK 7 (TVA-010): Leave Duration Authority**
    *   *Why:* Moves logic to backend, small refactor in dashboard and frontend form.
4.  **TASK 4 (TVA-005, 006, 007, 009): Ticket SLA Authority**
    *   *Why:* Read-only metric consolidation across AI, Analytics, and Automation. Does not mutate core system state.
5.  **TASK 6 (TVA-011): Company Date Authority**
    *   *Why:* Updates time boundaries but keeps state-mutation logic largely identical. Prerequisite for reliable attendance.
6.  **TASK 3 (TVA-004): Attendance Authority Consolidation**
    *   *Why:* Touches critical paths (Auth, Workday, Scheduler). Must be done last to ensure underlying time/date systems are fully stabilized.
7.  **TASK 8: TVA Compliance Test Suite**
    *   *Why:* Written iteratively and finalized to prove all the above components align exactly.

## NEXT STEPS

Pending your approval, I will begin execution with **TASK 2 & TASK 5** (the UI authority consolidations) and create the corresponding markdown reports as requested.
