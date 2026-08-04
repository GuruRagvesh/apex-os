# TVA_AUTH_AUDIT.md

Date: 2026-06-06
Mode: Read-only forensic audit

## Rule Set

Login MUST NOT equal Start Work.

Logout MUST NOT equal End Day.

Browser Close MUST NOT equal End Day.

Any violation is Critical.

## Verdict

Login does not equal Start Work because `startWorkAt` is not set to working time unless the user explicitly starts work or an existing active session is preserved. However, login is coupled to attendance because it creates or updates `WorkSession.loginAt`, creates a `LOGIN` attendance event, and sets `User.currentStatus` to `LOGGED_IN` or preserves active status.

Client logout does not call a backend logout endpoint and does not end the workday. Browser close has no direct end-day behavior.

Critical coupling exists through login session creation and scheduler auto-logout.

## Login

File: `backend/src/modules/core/auth/auth.service.ts`

Behavior:

- validates credentials.
- creates `today` with `new Date()` and `setHours(0,0,0,0)`.
- sets `nextStatus = LOGGED_IN`.
- if existing session status is `WORKING`, `ON_BREAK`, or `IDLE`, preserves that status.
- if session exists, updates `loginAt` and status.
- if no session exists, creates `WorkSession` with `loginAt` and status `LOGGED_IN`.
- creates `AttendanceEvent` `LOGIN`.
- updates `User.currentStatus` and `lastActiveAt`.

Assessment:

- Login does not start work.
- Login does create attendance/session state.
- Login uses server local midnight, not `TimezoneUtil.getCompanyTodayDate`.

Severity: Critical coupling, not a direct "login equals start work" violation.

## Logout

Frontend files:

- `frontend/store/auth.store.ts`
- `frontend/components/layout/topbar.tsx`
- `frontend/components/layout/sidebar.tsx`

Behavior:

- removes `apex_token`.
- removes local mode value.
- clears auth store.
- does not call backend.
- does not call `/workday/end`.

Assessment:

- Logout does not equal End Day.
- No backend logout/token blacklist endpoint was found.

Severity: Low for TVA rule, P3 auth feature gap.

## JWT Refresh and Expiry

Backend files:

- `backend/src/modules/core/auth/auth.module.ts`
- `backend/src/modules/core/auth/auth.service.ts`
- `backend/src/modules/core/auth/strategies/jwt.strategy.ts`

Behavior:

- JWT expiry reads `JWT_EXPIRES_IN`, default in code is `7d`.
- Local env audit previously showed `JWT_EXPIRES_IN=24h`.
- No refresh endpoint found.
- JWT expiry does not write workday state.

Assessment:

- JWT expiry does not equal End Day.
- No refresh clock affects attendance.

Severity: Low for TVA.

## Browser Close

No code path found where browser close directly calls end-day.

Assessment:

- Browser close does not equal End Day.

Severity: Low.

## Scheduler Auto-Logout

File: `backend/src/modules/platform/scheduler/scheduler.service.ts`

Behavior:

- hourly job between server hours 9 and 20.
- finds `User.currentStatus = IDLE` with `lastActiveAt` older than 2 hours.
- sets user `currentStatus` to `OFFLINE`.
- updates today's idle work sessions to `LOGGED_OUT` and sets `logoutAt = new Date()`.

Assessment:

- This is not auth logout, but it behaves like an automatic end of session based on idle status.
- If idle status is stale or wrong, attendance can be closed incorrectly.

Severity: Critical.

## Auth Coupling Findings

| ID | Finding | Severity |
| --- | --- | --- |
| TVA-AUTH-001 | Login creates/updates `WorkSession` and `User.currentStatus`. | Critical |
| TVA-AUTH-002 | Login uses server local midnight instead of company date utility. | High |
| TVA-AUTH-003 | Client logout does not end workday, which is compliant with the rule. | None |
| TVA-AUTH-004 | Browser close does not end workday, which is compliant with the rule. | None |
| TVA-AUTH-005 | Scheduler auto-logout can set `logoutAt` based on idle/currentStatus. | Critical |

