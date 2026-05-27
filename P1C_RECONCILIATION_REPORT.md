# P1-C Reconciliation Report

**Date:** 2026-05-27  
**Sprint:** P1-C — Enterprise Hardening + Production Readiness  
**Prepared by:** Pre-implementation audit  
**Status:** AUDIT COMPLETE — READY TO PROCEED

---

## Executive Summary

P0 and P1-B foundations are solid. 56/56 unit tests pass. TypeScript compiles clean on both sides (one stale `doneTickets` reference found and fixed during this audit). No frozen P0 services have been bypassed. The codebase is structurally sound.

However, 12 concrete gaps exist that must be addressed before production:

1. **Critical:** `isHalfDay`/`halfDayType` have no Prisma migration file — `prisma migrate deploy` would silently skip these columns on a fresh DB.
2. **High:** User directory (`GET /users`) allows any authenticated EMPLOYEE/INTERN to enumerate all users.
3. **High:** `ThrottlerGuard` is registered but not applied globally — most endpoints have no rate limiting.
4. **High:** SLA logic is duplicated in 3 service files (`ai.service.ts`, `ai.cron.service.ts`, `automation.service.ts`) with hardcoded constants instead of calling `TicketTimingService.getSlaConfig()`.
5. **Medium:** No `.env.production.example` file — deployors must guess the required env vars.
6. **Medium:** `ValidationPipe(whitelist:true)` is applied globally but most bodies use `body: any`, making whitelist stripping a no-op.
7. **Medium:** `SLA_HOURS` / `REVIEW_SLA_HOURS` constants remain in `tickets.service.ts` (used only by `getReviewSlaHours()` helper) — partially superseded by `TicketTimingService`.
8. **Low:** `EXPORT_PERFORMED` event fires even if CSV export fails (logged before returning csv but after generating it — acceptable).
9. **Low:** `getSlaRisk` endpoint exists but no frontend widget surfaces the data.
10. **Low:** Holiday list in `LeaveBalanceService` hardcoded to 2026.
11. **Low:** Scattered inline role string arrays in `dashboard.service.ts`, `projects.service.ts`, `users.service.ts` — these duplicate logic that should delegate to `AccessPolicyService`.
12. **Low:** WebSocket CORS origin array includes hardcoded `localhost:3001` (backend URL) — this is unreachable from a browser and should be removed.

---

## What Already Exists (Production-Safe)

| Area | Status |
|------|--------|
| JWT Authentication | ✅ All controllers protected with `@UseGuards(JwtAuthGuard)` at class level |
| Ticket access scoping | ✅ `TicketAccessService` enforced on all read/write/status/assign/delete paths |
| Leave access scoping | ✅ `LeaveAccessService` enforced on all approval/rejection/view paths |
| Payroll masking | ✅ Server-enforced via `AccessPolicyService.safeUser()` |
| Password stripping | ✅ Consistent in `AccessPolicyService.safeUser()` |
| Helmet security headers | ✅ Applied globally in `main.ts` |
| Compression | ✅ Applied globally |
| CORS configuration | ✅ Whitelist in `main.ts` + reads `FRONTEND_URL` env |
| Input validation | ✅ `ValidationPipe(whitelist:true, transform:true)` applied globally |
| Database indexes | ✅ 13 performance indexes from P0/P1-A |
| Required env validation | ✅ `DATABASE_URL` and `JWT_SECRET` checked at startup |
| SMTP graceful failure | ✅ All `emailService.*` calls wrapped in try/catch |
| AI graceful failure | ✅ Caught in try/catch in AI service |
| Audit event coverage | ✅ 50 OperationalAction entries, wired in all critical paths |
| Export scoping | ✅ `exportCsv` delegates to `TicketAccessService` scope |
| MIME type validation | ✅ FileFilter on attachment upload |
| Kanban backend enforcement | ✅ `assertCanTransitionTicket` on every status change |
| Health check endpoint | ✅ `GET /api/health` public |
| Rate limiting on auth | ✅ Login/OTP throttled to 5/15min |
| Rate limiting on AI | ✅ AI endpoints throttled to 10/min |
| Swagger disabled in prod | ✅ `if (!isProd)` guard |
| Notification preferences | ✅ `NotificationEventService` filters by preference + quiet hours |
| SLA timing service | ✅ `TicketTimingService` as single source of truth for display contract |

---

## What Remains Weak

### HIGH PRIORITY

#### 1. Missing Prisma Migration: `isHalfDay` / `halfDayType`
- `prisma migrate status` shows "up to date" because DB matches schema.
- But no `*.sql` migration file contains `isHalfDay` or `halfDayType`.
- A fresh production deploy via `prisma migrate deploy` will fail or produce broken leave behavior.
- **Fix:** `npx prisma migrate dev --name add_leave_half_day`

#### 2. User Directory Over-Exposure
- `UsersService.findAll()` scopes MANAGER/TEAM_LEAD to their departments.
- EMPLOYEE and INTERN receive no restriction — they can query all users with `GET /users`.
- **Fix:** Restrict EMPLOYEE/INTERN to own record in `findAll()`.

#### 3. Global Rate Limiting Gap
- `ThrottlerModule` is registered with `{ ttl: 60000, limit: 100 }`.
- But `ThrottlerGuard` is not registered as a global provider.
- Only AI and Auth endpoints manually apply `@Throttle(...)`.
- All other endpoints: tickets, users, leave, projects, dashboard — unlimited.
- **Fix:** Register `{ provide: APP_GUARD, useClass: ThrottlerGuard }` in `AppModule`.

#### 4. Duplicated SLA Constants
- `ai.service.ts`: local `SLA_HOURS` constant
- `ai.cron.service.ts`: local `SLA_HOURS` constant  
- `automation.service.ts`: local `SLA_HOURS` constant
- `tickets.service.ts`: local `SLA_HOURS` + `REVIEW_SLA_HOURS` (partially used)
- Admin changes to SLA settings are ignored by these services.
- **Fix:** Inject `TicketTimingService` into AI + automation services; call `getSlaConfig()`.

### MEDIUM PRIORITY

#### 5. No Production Env Examples
- No `.env.production.example` for backend.
- No `.env.production.example` for frontend.
- Deployers must guess all required/optional vars from code.
- **Fix:** Create both files.

#### 6. Body DTOs Using `any`
- Most endpoints use `@Body() body: any`.
- `ValidationPipe(whitelist:true)` strips unknown properties from decorated DTOs, but since bodies are untyped, nothing is stripped.
- This is a medium risk: malicious extra fields pass through to Prisma's `data` spread.
- `tickets.service.ts` does some selective field handling; `users.service.ts` explicitly deletes `data.password` and `data.id`.
- **Fix (partial):** Add explicit field allowlists in service methods that spread `data` directly into Prisma `create/update`.

### LOW PRIORITY

#### 7. Scattered Role String Arrays
- Multiple services inline role arrays: `['ADMIN','SUPER_ADMIN']`, `['EMPLOYEE','INTERN']` etc.
- These are mostly conservative checks (not security holes), but they deviate from the P0 freeze rule: "No direct role checks scattered in controllers."
- **Fix:** Consolidate to `AccessPolicyService` helper methods.

#### 8. WebSocket CORS Extra Origin
- `WS_ORIGINS` includes `http://localhost:3001` — that's the backend itself, not reachable from a browser.
- Harmless but noisy.

#### 9. getSlaRisk Not Surfaced
- Endpoint exists, API method exists, but no frontend component calls it.

#### 10. Holiday List Hardcoded to 2026
- `LeaveBalanceService.holidays` contains a static array.
- Will be wrong from 2027 onward.

---

## Duplicate Logic Remaining

| Logic | Locations | Risk |
|-------|-----------|------|
| SLA hours map | `ai.service.ts`, `ai.cron.service.ts`, `automation.service.ts`, `tickets.service.ts` | High — admin changes ignored |
| Role name extraction | Multiple services with `user?.role?.name ?? user?.role ?? ''` pattern | Low — should use `AccessPolicyService.roleName()` |
| Admin check | Multiple services with `['ADMIN','SUPER_ADMIN'].includes(roleName)` | Low — should use `AccessPolicyService.isAdmin()` |

---

## Dangerous Queries

| Query | Risk | File |
|-------|------|------|
| `prisma.user.findMany()` with no scope for EMPLOYEE | Medium | `users.service.ts:findAll()` |
| `prisma.activityLog.findMany()` in dashboard — can be large | Low | `dashboard.service.ts:getActivityFeed()` — has `take: 20` limit |
| `prisma.ticket.findMany({ include: { assignedTo, createdBy } })` in project detail | Low | Returns all tickets for a project — add pagination or limit |

---

## Frontend/Backend Mismatches

| Item | Status |
|------|--------|
| `project.progress` field | ✅ Fixed in P1-B — frontend now reads backend value |
| `ticketApi.getSlaRisk()` | ⚠️ Backend exists, frontend method exists, no UI consumes it |
| Analytics date range export | ✅ Fixed in P1-B |
| Ticket filters (overdue, myTickets) | ✅ Fixed in P1-B |

---

## Performance Risks

| Area | Risk | Mitigation |
|------|------|-----------|
| Dashboard `getWorkload()` — loads all users + ticket join | Medium | Loaded lazily; has `take: 200` limit |
| `getSlaRiskCategories()` — loads all active tickets | Medium | Scoped by user access; needs pagination for large datasets |
| `ProjectsService.findAll()` — includes all members | Low | Paginated |
| Notification inbox — no cursor pagination | Low | `take: 50` limit in service |

---

## Security Hardening Gaps

| Gap | Severity |
|-----|---------|
| `GET /users` unrestricted for EMPLOYEE/INTERN | High |
| No global rate limiting | High |
| `body: any` spread into Prisma data | Medium |
| No `ParseUUIDPipe` on `:id` params | Low |

---

## UX Stability Gaps

| Gap | Pages |
|-----|-------|
| No error boundary / retry state on dashboard | dashboard |
| Leave page has loading skeleton but no isError path | leave |
| Projects page has no isError rendering | projects |
| Analytics page — no loading state on export click | analytics |

---

## Operational Gaps

| Gap | Severity |
|-----|---------|
| No `.env.production.example` | Medium |
| `prisma migrate deploy` will miss `isHalfDay`/`halfDayType` | High |
| No health check database probe (health returns 200 trivially) | Low |

---

## Scalability Concerns

1. `OperationalEvent` table has no index on `(entityType, entityId)` — used by `getTimeline()`.
2. `activityLog` has a composite index on `(entityType, entityId)` ✅.
3. `notification` table index on `(userId, createdAt)` ✅ — but no archival/TTL strategy.
4. WebSocket gateway keeps all sockets in memory — no distributed session store for multi-instance.

---

## P1-C Work Plan (Ordered by Priority)

### Must-Do Before Production
1. ✅ Fix `doneTickets` TypeScript error (done during audit)
2. Create Prisma migration for `isHalfDay`/`halfDayType`
3. Fix `GET /users` EMPLOYEE/INTERN scope
4. Add global `ThrottlerGuard`
5. Wire AI + automation services to `TicketTimingService.getSlaConfig()`
6. Create `.env.production.example` files

### Should-Do
7. Consolidate scattered role checks to `AccessPolicyService`
8. Add `ParseUUIDPipe` to critical `:id` params
9. Add operational_events index on `(entityType, entityId)`
10. Surface SLA risk widget on dashboard

### Polish
11. Add error states to leave/projects/analytics pages
12. Add health check DB probe
13. Fix WebSocket CORS extra origin
14. Write all 15 output report files
