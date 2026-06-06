# FP-13.1B Migration Risk Plan

## F. Migration Safety

### 1. Nullable vs Required Fields
- `endedAt` and `durationMinutes` must be nullable because a log is open/active while work is occurring.
- `pauseReason` is nullable as it is only populated when a log is interrupted/ended.
- `workSessionId` and `breakLogId` are nullable to account for generic system actions (like forced migrations) and external events not directly tied to a workday.

### 2. Backfill Strategy for Existing Tickets
- **Recommendation:** Do not attempt to reverse-engineer granular `TicketTimeLog` records from incomplete timestamps (`actualStartAt`, `updatedAt`). 
- Instead, treat the ledger activation date as day zero. All elapsed time *prior* to deployment is grandfathered into `actualTime` or a one-time synthetic `TicketTimeLog` record marked `source = 'MIGRATION_BACKFILL'` spanning `createdAt` to `now()`.

### 3. Do historical tickets need synthetic rows?
Only if analytics demands full backwards compatibility over the new ledger schema immediately. The safest approach is additive: let old tickets die out organically using the legacy timestamp math for their remaining lifespan, while new/active tickets generate precise logs.

### 4. Can migration be additive only?
**Yes, absolutely.** The proposed Prisma schema creates new tables (`TicketTimeLog`, `ReviewCycleLog`) without deleting or altering any existing columns on the `Ticket` table (except adding the non-breaking `reworkCount Int @default(0)`). This is a purely additive structural change.

### 5. Rollback Risk
- **Extremely Low.** Because no existing ticket fields are being destroyed, rolling back the deployment merely orphans the new tables. The legacy system in `ticket-timing.service.ts` can immediately take back over if the new logic is toggled off.

### 6. Indexes Needed
- `@@index([ticketId])`: Required for summing ticket durations.
- `@@index([userId])`: Required for employee productivity reports.
- `@@index([startedAt])`: Required for chronologically sorting the ledger.
- `@@index([workSessionId])`: Crucial for tying ticket logs to Workday lifecycle actions (start/end day).
- To find the "active log" quickly: `@@index([ticketId, endedAt])` is recommended.

### 7. Unique Constraint for Active Logs
Should there be a unique constraint to prevent multiple active logs per ticket/user/stage? (e.g. `endedAt IS NULL`).
Postgres supports partial unique indexes, but Prisma's native `@@unique` does not cleanly handle partials without raw SQL migrations.

### 8. DB-Level Constraints vs Service-Level Guards
**Recommendation for V1:** Rely on service-level guards (`findFirst` check before `create`) instead of raw SQL partial unique constraints. It limits Prisma drift, simplifies migrations, and keeps the initial deployment completely agnostic of underlying database engine quirks. 
