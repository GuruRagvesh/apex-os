# P1-B Remaining Risks

**Date:** 2026-05-27  
**Scope:** Known gaps NOT addressed in P1-B (not regressions — pre-existing or deferred)

---

## Risk 1 — SLA hardcoding (carried from P1-A Risk 2)

**Severity:** High  
**Detail:** `SLA_HOURS` is still hardcoded as fallback constants in `ticket-timing.service.ts`. `SettingsService.getSlaHours()` and `getSlaConfig()` do read from the DB first, but only `TicketTimingService.getSlaConfig()` is used for decoration. The AI cron service and automation service may still have their own hardcoded defaults.  
**Recommended fix:** Audit `ai.service.ts`, `ai.cron.service.ts`, `automation.service.ts` to confirm they call `TicketTimingService.getSlaConfig()` rather than local constants.

---

## Risk 2 — User list endpoint role-scoping (carried from P1-A Risk 3)

**Severity:** High  
**Detail:** `GET /users` is scoped to same-department for MANAGER/TEAM_LEAD but is unrestricted (returns all users) for any EMPLOYEE or INTERN. Any authenticated employee can enumerate the full user directory.  
**Recommended fix:** Add employee-scope restriction in `UsersService.findAll()` to return only the requester when role is EMPLOYEE or INTERN, matching the pattern used for `getDirectory()`.

---

## Risk 3 — isHalfDay / halfDayType: no formal migration (carried from P1-A Risk 1)

**Severity:** Medium  
**Detail:** Columns are live in the current DB but no timestamped migration file was created. `prisma migrate deploy` on a fresh/production DB will not add these columns.  
**Recommended fix:** `npx prisma migrate dev --name add_leave_half_day`

---

## Risk 4 — USER_REACTIVATED event not wired

**Severity:** Low  
**Detail:** `OperationalAction.USER_REACTIVATED` was added to the enum but no service path currently reactivates users (the `remove()` method sets `isActive: false` only). If a reactivation endpoint is added later, it should log this action.  
**Status:** Deferred until reactivation flow is implemented.

---

## Risk 5 — getSlaRisk frontend integration

**Severity:** Low  
**Detail:** `ticketsApi.getSlaRisk()` was added to `lib/api.ts` and the backend endpoint exists, but no frontend component currently calls it. The SLA risk data is not surfaced to users.  
**Recommended fix (P1-C):** Add an SLA risk widget to the dashboard or a banner on the tickets page that calls this endpoint and shows the overdue/due-soon counts.

---

## Risk 6 — Leave balance holiday list hardcoded to 2026 (carried from P1-A Risk 4)

**Severity:** Low  
**Detail:** `LeaveBalanceService.holidays` contains a static array of 2026 dates.  
**Recommended fix:** Move to DB-backed holiday table or settings-driven list.

---

## Risk 7 — Notification preferences default `commentAdded: false` (carried from P1-A Risk 5)

**Severity:** Low  
**Detail:** New users will not receive comment notifications until they explicitly opt in. May be intentional.  
**Status:** Confirm with product before changing.
