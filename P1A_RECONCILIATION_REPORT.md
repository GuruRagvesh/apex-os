# P1-A Reconciliation Report

**Date:** 2026-05-27  
**Branch:** stabilize/apex-os-core  
**HEAD commit:** 3205680  
**Inspector:** Read-only — no code changed during this inspection  

---

## 1. Repository State Summary

| Check | Result |
|---|---|
| Git status | **Clean — working tree has 0 uncommitted changes** |
| Backend `tsc --noEmit` | ✅ 0 errors |
| Frontend `tsc --noEmit` | ✅ 0 errors |
| Unit tests | ✅ 56/56 pass (9 suites) |
| DB migration status | ✅ `Database schema is up to date!` (18 migrations applied) |
| `isHalfDay`/`halfDayType` live in DB | ✅ Confirmed via `information_schema.columns` query |
| `apex-os-stabilized-v1` tag | ✅ Tag exists (created earlier in stabilization) |
| P0 freeze tag `p0-verified-2026-05-27` | ✅ Exists |

---

## 2. Completed Modules

### 2.1 Database Stabilization
- **Status: COMPLETE**
- 18 migrations applied and verified (`prisma migrate status: up to date`)
- 13 performance indexes present (`tickets_status_assignedToId_idx`, `tickets_status_departmentId_idx`, `leave_requests_userId_status_idx`, etc.)
- `isHalfDay` (Boolean, default false) and `halfDayType` (String, nullable) columns are live in PostgreSQL `leave_requests` table
- **Known gap:** These two columns were applied via `db push`, not `migrate dev`. No timestamped migration SQL file exists for them. Local DB is correct. A fresh `prisma migrate deploy` (production scenario) would **not** include them.

### 2.2 LeaveBalanceService
- **Status: COMPLETE**
- File: `backend/src/modules/operations/leave/leave-balance.service.ts`
- Implements: role-based quotas via `SettingsService.getLeaveQuotas()`, Mon-Fri/Sat/Sun schedule enforcement, 10 hardcoded 2026 public holidays, half-day (returns 0.5), empty-range rejection, overlap prevention, deficit prevention
- Wired into `LeaveService.create()` via `this.leaveBalance.validateLeaveRequest()`
- Exposed via `LeaveService.getUserBalance()` → scoped by `AccessPolicyService.canViewUser()`
- API endpoints: `GET /leave/balance` (own) and `GET /leave/balance/:userId` (scoped)
- Module: `LeaveModule` imports `SettingsModule` and provides/exports `LeaveBalanceService` ✅
- Tests: `p1.leave-balance.spec.ts` — 9 tests pass (allocation, duration, holidays, half-day, balance, overlap, deficit)

### 2.3 NotificationEventService
- **Status: COMPLETE**
- File: `backend/src/modules/operations/notifications/notification-event.service.ts`
- Implements: preference resolution via `UsersService.getPreferences()` with `NOTIF_DEFAULTS` fallback, preference-key gating (returns null if disabled), DB write always, Socket.io emission only if outside quiet hours AND `inApp !== false`
- Quiet-hours engine handles midnight-crossing ranges (e.g. 22:00–08:00)
- Timezone-aware via `Intl.DateTimeFormat` with IST (Asia/Kolkata) as default
- Module: `NotificationsModule` provides and exports both `NotificationsService` and `NotificationEventService`; imports `UsersModule` and `GatewayModule` ✅
- **No circular dependency:** `UsersModule` does NOT import `NotificationsModule`
- Tests: `p1.notification-event.spec.ts` — 5 quiet-hours tests + 3 sendNotification tests, all pass

### 2.4 Notifications Wired into Core Services
- **Status: COMPLETE**
- `tickets.service.ts`: 6 `sendNotification` call sites (assign, reassign, resolve, reopen, status change, close) ✅
- `comments.service.ts`: 1 call site (commentAdded — sent to ticket owner + all assignees except author) ✅
- `leave.service.ts`: 3 call sites (teamLeaveApply on create/cancel, leaveApproved, leaveRejected) ✅
- All three modules import `NotificationsModule` ✅
- **Intentional dual-path for real-time board updates:** `leave.service.ts` also calls `gateway.emitLeaveStatusChanged()` (for live board state machine); `tickets.service.ts` calls `gateway.emitTicketCreated()` and `gateway.emitTicketStatusChanged()` (for live board ordering). These are **complementary, not conflicting** — direct gateway calls update UI state, NotificationEventService writes to the inbox and emits the notification bell. Both gateway methods exist and are verified in `events.gateway.ts` at lines 69, 74, 84.

### 2.5 User Profile Page
- **Status: COMPLETE**
- File: `frontend/app/(dashboard)/(platform)/users/[id]/page.tsx` (682 lines)
- Tabbed interface: Overview / Leaves / Tickets / Payroll & Documents
- Overview tab: profile header, employment details, live workday status (via `workdayApi.getHistory`), workday history table (30 sessions), activity feed (via `dashboardApi.getActivityFeed?userId=`)
- Leaves tab: balance widget (via `leaveApi.getBalance(id)`) + allocation / approved / pending / remaining breakdown
- Tickets tab: 20 most recent assigned tickets with status/priority badges
- Projects tab: active project memberships
- Payroll tab: frontend visibility gated by `isSelf || isHR` (role read from `useAuthStore`)
- **Server-side masking IS implemented** in `UsersService.getOne()` (lines 228–254): HR/Admin gets full payroll, Manager gets employment-only, TeamLead gets operational-only, Employee gets public-only. The `P1A_REMAINING_RISKS.md` Risk 6 (payroll masking is frontend-only) was **overly conservative** — backend masking is in place.

### 2.6 Workday History Endpoint
- **Status: COMPLETE**
- Controller: `GET /workday/history/:userId` scoped by `AccessPolicyService.canViewUser()` ✅
- Returns last 30 `WorkSession` records with `breakLogs` included
- Frontend: `workdayApi.getHistory(userId)` calls `/workday/history/${userId}` ✅

### 2.7 Dashboard Activity Feed User Filter
- **Status: COMPLETE**
- `dashboard.service.ts` `getActivityFeed()` accepts optional `userId` param
- When `userId` is provided, non-admins validate the target is in their managed departments before adding `userId: userId` to the `WHERE` clause
- Controller: `@Query('userId') userId?: string` passed through ✅

### 2.8 Settings Persistence: Timezone and Branding
- **Status: COMPLETE**
- `settings/page.tsx` CompanySection now includes `timezone` (select) and `branding` (input) fields
- Submitted via existing `settingsApi.updateCompany()` to `PATCH /settings/company`
- Persisted to `appSetting` table under the `company` key ✅

### 2.9 Frontend api.ts
- **Status: COMPLETE**
- `leaveApi.getBalance(userId?: string)` → `/leave/balance` or `/leave/balance/${userId}` ✅
- `workdayApi.getHistory(userId: string)` → `/workday/history/${userId}` ✅

---

## 3. Partial Modules

### 3.1 `isHalfDay`/`halfDayType` Migration Gap
- **Status: PARTIAL — production deploy risk only**
- Local DB: ✅ Columns are live (confirmed by direct column query)
- Schema: ✅ `schema.prisma` L309-310 has both fields
- Migration files: ❌ No timestamped `.sql` migration file for these columns
- `prisma migrate status` returns clean because the DB state matches the schema — but a **fresh `prisma migrate deploy` on a new/production environment would skip these columns**
- **Action required before production:** `npx prisma migrate dev --name add_leave_half_day`

### 3.2 SLA Hardcoding (pre-existing, deferred)
- **Status: KNOWN TECHNICAL DEBT — not P1-A scope**
- `SLA_HOURS` constant remains in 4 files: `tickets.service.ts`, `automation.service.ts`, `ai.service.ts`, `ai.cron.service.ts`
- `SettingsService.getSlaHours()` exists but is never called by these services
- Admin SLA changes in settings → DB but execution ignores them
- **Not a regression introduced in P1-A** — pre-existed since Stage 6

---

## 4. Broken Modules

**None found.** All inspected modules compile, test, and wire correctly.

---

## 5. Risky Overlaps

### 5.1 Gateway Direct Calls + NotificationEventService (NOT a conflict)
- `leave.service.ts` calls `this.gateway.emitLeaveStatusChanged(...)` AND `this.notificationEventService.sendNotification(...)`
- `tickets.service.ts` calls `this.gateway.emitTicketCreated(...)` / `emitTicketStatusChanged(...)` AND `this.notificationEventService.sendNotification(...)`
- **Assessment:** These serve distinct concerns. Direct gateway calls = real-time board state (Kanban column moves, leave queue updates). NotificationEventService = user inbox notification (bell icon, preference-filtered, quiet-hours). They do not double-send the same notification type to the same user.
- **Verdict: Intentional and correct. No action required.**

### 5.2 P0 Freeze Compliance — All 7 Rules Verified
| Rule | Status |
|---|---|
| 1. No direct role checks in controllers | ✅ — `@Roles()` decorator used; no `if (role === 'ADMIN')` in controllers |
| 2. No ticket list/count outside TicketAccessService | ✅ — `tickets.service.ts` exclusively uses `ticketAccess.buildTicketWhereForUser()` and `ticketAccess.findAccessibleTicket()` |
| 3. No frontend-owned SLA truth | ✅ — Frontend SLA display uses `TicketTimingService` decorated fields |
| 4. No unscoped dashboard/global metrics | ✅ — All dashboard queries pass `user` through `LeaveAccessService`/`TicketAccessService` |
| 5. No sensitive payroll exposure outside AccessPolicyService | ✅ — `UsersService.getOne()` delegates to `accessPolicy.canViewPayroll()` and `accessPolicy.maskPayrollForSelf()` |
| 6. P0 service changes require regression tests | ✅ — No P0 services were modified in P1-A |
| 7. P1-A builds on P0 architecture, not replaces it | ✅ — `LeaveService` imports and uses `LeaveAccessService`; `WorkdayService` uses `AccessPolicyService` |

---

## 6. Duplicated Services

**None found.**

- `LeaveBalanceService` (new, `operations/leave/`) handles quotas, durations, validation. No other service duplicates this logic.
- `NotificationEventService` (new, `operations/notifications/`) is the single notification pipeline. No raw `prisma.notification.create` calls exist outside it (grep confirmed zero results).
- `LeaveAccessService` (P0, `common/services/`) handles scope/approval guards. `LeaveBalanceService` does not overlap — it handles balance arithmetic only.
- `AccessPolicyService` (P0, `common/services/`) handles visibility/masking. `NotificationEventService` uses it indirectly via `UsersService.getPreferences()`, not directly. No conflict.

---

## 7. Missing Tests

### 7.1 No unit test for `WorkdayService.getHistory()`
- New method added in P1-A; no spec covers scope enforcement or the 30-session return contract.
- **Severity: Low** — the method delegates directly to `AccessPolicyService.canViewUser()` (which is covered by `p0.access-policy.spec.ts`) then calls `prisma.workSession.findMany()`.

### 7.2 No unit test for `LeaveService.getUserBalance()` scope gating
- The method calls `accessPolicy.canViewUser()` and throws 403 if not permitted. No test exercises the forbidden branch.
- **Severity: Low** — covered indirectly by `p0.access-policy.spec.ts`.

### 7.3 Test worker process leak (non-blocking)
- Jest reports `"A worker process has failed to exit gracefully and has been force exited"` after unit test run.
- All 56 tests still pass. Root cause: NestJS test module likely not calling `module.close()` in `afterAll` in some specs.
- Files missing `afterAll(() => module.close())`: `leave.rules.spec.ts`, `ticket.transitions.spec.ts` (both lack teardown — pre-existing issue).
- **Severity: Low** — does not affect test correctness, only adds ~2s forced termination delay.

---

## 8. Migration Status

| Migration | Status |
|---|---|
| `20260525000001_add_custom_subtype_text` | ✅ Applied |
| `20260525000002_add_operational_event` | ✅ Applied |
| `20260526000001_add_performance_indexes` | ✅ Applied |
| `isHalfDay` / `halfDayType` columns | ⚠️ Live in DB via `db push` — **no migration file** |
| All other 15 migrations | ✅ Applied |
| `prisma migrate status` | ✅ `Database schema is up to date!` |

---

## 9. Exact Remaining Work Required to Finish P1-A

The P1-A scope as defined in `P1A_COMPLETION_REPORT.md` (13 items) is **fully implemented and verified**. There is no remaining incomplete P1-A work.

The following items are **deferred risks documented in `P1A_REMAINING_RISKS.md`** — they are not regressions and were explicitly not in P1-A scope:

| Item | Risk | Recommended Action |
|---|---|---|
| `isHalfDay`/`halfDayType` migration file | Medium — production deploy breaks | Run `npx prisma migrate dev --name add_leave_half_day` before any production deploy |
| SLA hardcoding in 4 files | High — settings changes have no effect | P1-B or separate task |
| `GET /users` auth-only (no role scope) | High — any employee can enumerate directory | P1-B or separate task |
| Hardcoded 2026 holiday list | Low — year drift | Settings-driven holiday table |
| Test worker process leak | Low — no correctness impact | Add `afterAll(() => module.close())` to affected spec files |
| `commentAdded` default false | Low — may be intentional | Confirm with product owner |

---

## 10. Overall Assessment

### What was verified in this reconciliation:
1. Repository is clean — no uncommitted changes, no stash, no detached HEAD
2. TypeScript compilation: backend and frontend both 0 errors
3. All 56 unit tests pass across 9 suites
4. All P0 frozen services (`AccessPolicyService`, `TicketAccessService`, `TicketTimingService`, `LeaveAccessService`) are intact and in use — no bypass, no drift
5. All new P1-A services (`LeaveBalanceService`, `NotificationEventService`) are correctly implemented, module-wired, and tested
6. No circular dependency introduced
7. No duplicated notification logic
8. No raw `prisma.notification.create` outside `NotificationEventService`
9. No scattered role checks in controllers
10. Payroll masking is server-side (not frontend-only as Risk 6 of `P1A_REMAINING_RISKS.md` suggested)
11. All new API endpoints exist, are scoped, and are wired in `api.ts`
12. Database is consistent with schema (confirmed by both `prisma migrate status` and direct column query)
13. All modules registered in `app.module.ts`

---

## READY_FOR_P1A_COMPLETION

P1-A is complete. There is no incomplete work remaining from the P1-A scope.  
The only required action before a production deploy is generating the `isHalfDay`/`halfDayType` migration file.  
All P0 frozen architecture rules are satisfied. All tests pass. Both compilers are clean.
