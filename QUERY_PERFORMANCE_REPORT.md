# QUERY PERFORMANCE REPORT
**Phase:** P1-C Enterprise Hardening  
**Date:** 2026-05-27  
**Status:** ✅ REVIEWED — No regressions introduced; P2 recommendations documented

---

## 1. Audit Scope

All service files touching Prisma were reviewed for N+1 queries, missing `select` projections, and unbounded list queries.

---

## 2. Existing Protections (P0/P1-A — Frozen, Not Modified)

| Service | Protection |
|---------|-----------|
| `TicketAccessService` | Loads only needed ticket fields with explicit `select` |
| `AccessPolicyService` | User lookup uses `select { id, role, departmentId }` — minimal projection |
| `TicketTimingService` | `getSlaConfig()` uses in-memory cache (60s TTL) — single DB read per minute under normal load |
| `LeaveAccessService` | Single query with join to user+role — no N+1 |

---

## 3. New Query Patterns Introduced in P1-C

### SLA Risk Categories (`tickets.service.ts → getSlaRiskCategories`)
- Loads all `OPEN / IN_PROGRESS / REVIEW / PENDING_APPROVAL` tickets with their timing states
- Calls `getTicketTimingState()` per ticket — this invokes `getSlaConfig()` which is cached; no per-ticket DB round trip
- **Risk**: On a system with 10,000+ open tickets this could be slow
- **Mitigation (P2)**: Add Redis cache for SLA risk snapshot, refreshed every 5 minutes

### Automation Overdue Check (`automation.service.ts`)
- Cron: runs every 15 minutes — loads all non-closed tickets
- Now uses `TicketTimingService.getSlaConfig()` (one cached DB call) instead of hardcoded constant
- **No change in query count** — just replaced constant with DB read (cached)

### AI Cron Digest (`ai.cron.service.ts`)
- Daily cron — loads all open tickets once for digest
- Uses cached `getSlaConfig()` — acceptable for once-daily batch

---

## 4. N+1 Patterns Reviewed

### `projects.service.ts — findAll()`
- Uses `include: { members: { include: { user: true } }, tickets: true, department: true }`
- Prisma batches these as JOINs — not N+1
- **Count**: `_count: { members: true, tickets: true }` avoids loading full member/ticket lists for list view ✅

### `users.service.ts — findAll()`
- `include: { role: true, department: true }` — single query with JOIN ✅

### `leave.service.ts — findAll()`
- `include: { user: { include: { role: true, department: true } } }` — batched JOINs ✅

### `tickets.service.ts — findAll()`
- Selective `include` with pagination (`take`, `skip`) ✅
- Cursor-based pagination not implemented — offset pagination acceptable at current scale

---

## 5. Unbounded Queries

| Query | Bound | Notes |
|-------|-------|-------|
| `leaveService.findAll()` | Paginated (limit/offset) ✅ | |
| `ticketsService.findAll()` | Paginated ✅ | |
| `usersService.findAll()` | Paginated ✅ | |
| `projectsService.findAll()` | Not paginated | Projects are org-scoped — typically <200 per org; acceptable |
| `analyticsService` | Date-range scoped | Query scoped by `createdAt` range ✅ |
| `auditLog queries` | Paginated with date filter | ✅ |

---

## 6. Connection Pool

`PrismaService` uses Prisma's default connection pool. For production:
- Set `DATABASE_URL` connection limit: `?connection_limit=10` for single-instance
- For multi-instance (Kubernetes): `?connection_limit=5&pool_timeout=10`

---

## 7. P2 Recommendations

1. **SLA risk endpoint cache** — cache `getSlaRiskCategories` result for 5 minutes in Redis; add cache-busting on ticket status change
2. **Partial index for open tickets** — `CREATE INDEX CONCURRENTLY idx_tickets_open ON tickets(id) WHERE status NOT IN ('DONE', 'CLOSED')`
3. **Audit log archival** — operational_logs older than 90 days should be archived to cold storage or a separate `_archive` table
4. **Cursor-based pagination** — for tickets list at >10k records, switch to cursor pagination

---

## Summary
| Check | Result |
|-------|--------|
| N+1 patterns | None introduced ✅ |
| Unbounded queries in hot paths | None ✅ |
| SLA config cached | ✅ |
| Migration queries additive | ✅ |
| P2 perf risks documented | ✅ |
