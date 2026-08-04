# Blocked Ticket Workflow — Design Document
**Phase:** UX Fix 8
**Date:** 2026-05-28
**Status:** AWAITING APPROVAL — do not implement until decision is confirmed

---

## Research Summary

### Current TicketStatus enum
```
OPEN → IN_PROGRESS → REVIEW → DONE → CLOSED
```
Five states, hardcoded in Prisma schema and enforced by `TicketAccessService.assertCanTransitionTicket()`.

### Transition rules (TicketAccessService)
| From | Allowed To |
|------|-----------|
| OPEN | IN_PROGRESS, CLOSED |
| IN_PROGRESS | REVIEW, DONE, CLOSED |
| REVIEW | IN_PROGRESS (rework), DONE, CLOSED |
| DONE | CLOSED |
| CLOSED | (none) |

INTERNs: can only move to IN_PROGRESS (with carve-out for own self-assigned tickets).

### TicketTimingService — key observation
The `TicketTimingState` type already declares:
```ts
timerType: 'none' | 'scheduled' | 'execution' | 'review' | 'blocked' | 'completed' | 'cancelled'
```
`'blocked'` is in the union but **no branch in `getTimingState()` currently produces it** — it was reserved for future use. This is a strong signal the architecture already anticipated Option B.

### EventLoggerService — key observation
`OperationalAction.TICKET_BLOCKED = 'TICKET_BLOCKED'` **already exists** in the enum.  
`events.controller.ts` already maps `TICKET_BLOCKED → 'ticket was blocked'` in the description renderer.  
These are pre-wired: the backend event infrastructure for blocking is ready; only the trigger and storage are missing.

### Kanban columns
Four hardcoded columns: `OPEN`, `IN_PROGRESS`, `REVIEW`, `DONE`. Adding a fifth column would require touching the `COLUMNS` array constant, the `getKanban()` service method, and all frontend column logic.

### Dashboard risk surface
- `bottleneckTickets` in `dashboard.service.ts` = overdue OR in-review tickets (top 10)
- `getSlaRiskCategories()` returns `{ overdue, dueSoon, reviewAgeing, unassigned, total }`
- `CriticalActionPanel` supports alert types: `TICKET_OVERDUE`, `REVIEW_PENDING`, `LEAVE_PENDING`, `CONFIG_WARNING`
- No blocked-ticket surface exists anywhere today

### Notification infrastructure
`NotificationEventService.sendNotification(userId, eventKey, data)` — dispatches to DB + socket.  
Existing event keys: `assignedTicket`, `statusChanged`, `overdueTicket`, `ticketResolved`, etc.  
A new `ticketBlocked` key can be added without schema changes.

---

## Option A — Add BLOCKED to TicketStatus enum

### Description
Extend the Prisma `TicketStatus` enum with a `BLOCKED` value. A blocked ticket becomes a new status, distinct from IN_PROGRESS or REVIEW.

### Transition additions required
```
OPEN → BLOCKED
IN_PROGRESS → BLOCKED
REVIEW → BLOCKED
BLOCKED → IN_PROGRESS  (unblock)
BLOCKED → REVIEW       (unblock back to review)
```
The service needs to remember the **pre-block status** to know where to return the ticket on unblock. This requires either a separate `previousStatus` column or a convention (e.g., always unblock to IN_PROGRESS regardless of where the ticket came from).

### DB migration
```sql
ALTER TYPE "TicketStatus" ADD VALUE 'BLOCKED';
```
Prisma enum migrations on PostgreSQL **cannot remove or rename enum values** — they can only add. Adding is safe. However, all queries that filter by status (e.g., `notIn: [DONE, CLOSED]`) must be reviewed; `BLOCKED` tickets should generally be included in "active" counts. Also: `getKanban()` currently returns `{ OPEN, IN_PROGRESS, REVIEW, DONE }` — BLOCKED tickets would be excluded unless the kanban method is updated.

### Impact matrix

| Dimension | Impact |
|-----------|--------|
| DB migration risk | **Low** — adding an enum value is safe in Postgres. Cannot rollback easily. |
| Active ticket filtering | **Medium** — all `notIn: [DONE, CLOSED]` queries are fine; BLOCKED stays visible |
| SLA behavior | **Medium-High** — must special-case BLOCKED in `getTimingState()`: no timer, isOverdue=false. Re-entry to IN_PROGRESS must recalculate dueAt or preserve it. |
| `TicketTimingService` changes | `getTimingState()` needs a `BLOCKED` branch added |
| Kanban impact | **High** — need a 5th column, or filter BLOCKED tickets into a badge overlay. The `COLUMNS` constant, `getKanban()`, and draggable logic all change. |
| Transition logic | **High** — need pre-block status stored somewhere (can't infer from BLOCKED status alone) |
| Reporting | **Medium** — `byStatus` groupBy already captures it. `getSlaRiskCategories()` must not count BLOCKED as overdue |
| Rollback risk | **High** — Postgres enum values cannot be removed once created without schema rebuild |
| Tests | Many existing tests that enumerate statuses need updating |

### Verdict
❌ **Not recommended.** Adds a full new status lifecycle with complex transition memory requirements, requires a permanent schema change, and forces a 5th kanban column. The lack of rollback path for Postgres enums makes this risky for a correctness-focused system.

---

## Option B — isBlocked overlay fields on Ticket ✅ RECOMMENDED

### Description
Keep `TicketStatus` unchanged. Add four nullable columns to the `Ticket` model:

```prisma
isBlocked       Boolean   @default(false)
blockedAt       DateTime?
blockedReason   String?
blockedById     String?
```

A blocked ticket remains `IN_PROGRESS` or `REVIEW` (its status doesn't change). `isBlocked` is an orthogonal overlay — like a flag that says "this ticket is stuck, SLA paused."

### Why this fits the existing architecture
1. `TicketTimingState.timerType` already has `'blocked'` in its union — a clear placeholder.
2. `OperationalAction.TICKET_BLOCKED` already exists in `EventLoggerService`.
3. `events.controller.ts` already handles `TICKET_BLOCKED` in its description map.
4. The timing service can check `ticket.isBlocked === true` before its normal status branches, short-circuit to the blocked timer state.
5. No enum change — Prisma migration is purely additive (new nullable columns).

### Schema change
```prisma
// In model Ticket, add:
isBlocked       Boolean   @default(false)
blockedAt       DateTime?
blockedReason   String?
blockedById     String?
```

```sql
-- Migration SQL (safe, additive, rollback by dropping columns)
ALTER TABLE "tickets" ADD COLUMN "isBlocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tickets" ADD COLUMN "blockedAt" TIMESTAMPTZ;
ALTER TABLE "tickets" ADD COLUMN "blockedReason" TEXT;
ALTER TABLE "tickets" ADD COLUMN "blockedById" TEXT;
```

### New API endpoints required
```
PATCH /tickets/:id/block
  Body: { reason: string }
  Guard: participant or scoped lead/manager
  Action: sets isBlocked=true, blockedAt=now, blockedReason, blockedById; logs TICKET_BLOCKED; notifies assignee's manager

PATCH /tickets/:id/unblock
  Body: (none)
  Guard: participant or scoped lead/manager
  Action: clears isBlocked, blockedAt, blockedReason, blockedById; logs TICKET_UNBLOCKED; notifies stakeholders
```

### SLA behavior — PAUSE
When `isBlocked = true`, `getTimingState()` returns:
```ts
{
  timerType: 'blocked',
  label: 'Blocked — SLA paused',
  isOverdue: false,
  dueAt: ticket.blockedAt,   // frozen at block time
  remainingMs: 0,
  overdueMs: 0,
  responsibleRole: null,
  displayColor: 'amber',
  progressPercent: <frozen at value when blocked>,
  reason: 'Ticket is blocked — timer is paused'
}
```
This means:
- Blocked tickets **never show as overdue** during the blocked period
- They are excluded from `overdue` count in `getSlaRiskCategories()` but counted in a new `blocked` count
- When unblocked, SLA resumes from original timestamps (no extension of dueAt in V1)
- **V2 enhancement** (out of scope): track `blockedMinutes` accumulation and add to executionDueAt on unblock

### Transition rules — no change needed
The existing `assertCanTransitionTicket()` rules are untouched. Blocking/unblocking is a separate action, not a status transition. Guards for block/unblock:
- Assignee (participant) can block/unblock their own ticket
- Scoped TEAM_LEAD / MANAGER can block/unblock tickets in their scope
- ADMIN / SUPER_ADMIN can block/unblock any ticket
- INTERN cannot block/unblock (same as they cannot do DONE/CLOSED)

### History tracking
Add `'isBlocked'` to the `trackedFields` array in `tickets.service.ts`. This creates a `TicketHistory` row: `field: 'isBlocked', oldValue: 'false', newValue: 'true'`.

### Notification events
- On block: notify assignee's manager/TL (new `ticketBlocked` event key)
- On unblock: notify original blocker (new `ticketUnblocked` event key)

### Impact matrix

| Dimension | Impact |
|-----------|--------|
| DB migration risk | **Very Low** — 4 nullable columns, purely additive, rollback = DROP COLUMN |
| Active ticket filtering | **None** — existing `notIn: [DONE, CLOSED]` queries unchanged |
| SLA behavior | **Contained** — single `if (ticket.isBlocked)` branch added before status checks in `getTimingState()` |
| `TicketTimingService` changes | Add 1 branch at the top of `getTimingState()` |
| `TicketAccessService` changes | Add `assertCanBlockTicket()` helper (similar to `assertCanUpdateTicket`) |
| Kanban impact | **Minimal** — blocked badge overlay on existing column cards; no new column |
| Reporting | **Easy** — add `blocked` count to `getSlaRiskCategories()` and `getStats()` |
| Rollback risk | **Low** — drop 4 columns, revert API endpoint |
| Tests | Targeted: test block endpoint, unblock endpoint, SLA pause, history entry |

### Verdict
✅ **Recommended.** Aligns with pre-wired infrastructure (`timerType: 'blocked'`, `TICKET_BLOCKED` action). Minimal DB risk. No kanban redesign. Orthogonal to existing status machine — blocked is a "flag overlay," not a new lifecycle state.

---

## Option C — TicketBlocker model (separate table)

### Description
Create a new `TicketBlocker` Prisma model:
```prisma
model TicketBlocker {
  id           String    @id @default(cuid())
  ticketId     String
  ticket       Ticket    @relation(fields: [ticketId], references: [id])
  blockerType  String    // DEPENDENCY, WAITING_FOR_INFO, RESOURCE, OTHER
  reason       String
  ownerId      String?   // who is responsible for resolving
  createdById  String
  resolvedAt   DateTime?
  createdAt    DateTime  @default(now())
}
```

### Motivation
Supports: multiple concurrent blockers per ticket, structured blocker types, assignment of blocker ownership, partial resolution (some blockers cleared but not all).

### Impact matrix

| Dimension | Impact |
|-----------|--------|
| DB migration risk | **Low** — new table, no changes to existing tables |
| Query complexity | **High** — every "is this ticket blocked?" check requires a join or subquery |
| Service complexity | **High** — `TicketBlocker` service, controller, DTOs, guards all needed |
| SLA behavior | **Complex** — must check if any unresolved TicketBlocker exists before SLA calc |
| Kanban impact | **Same as B** — badge overlay, need join to get blocker count |
| Reporting | **High** — aggregate by blockerType, owner, etc. |
| UI complexity | **High** — must show list of blockers, allow individual resolution |
| Over-engineering risk | **High** — multiple concurrent blockers, blocker ownership not in spec requirements |

### Verdict
❌ **Not recommended for this phase.** Correctly models complex dependency tracking but is substantial over-engineering for the stated requirements. Could be a V2 evolution if the business needs structured dependency management. Option B can be evolved into Option C later by adding a `TicketBlocker` table and migrating the existing `blockedReason` field into it.

---

## Decision Summary

| | Option A | Option B | Option C |
|--|---------|---------|---------|
| Schema risk | Medium (enum add, no rollback) | **Very Low** (nullable columns) | Low (new table) |
| Architecture fit | Poor (needs status memory) | **Excellent** (pre-wired) | Good (overkill) |
| Kanban change | Major (5th column) | **Minimal** (badge overlay) | Minimal |
| SLA complexity | Medium | **Low** (1 branch) | High |
| Rollback safety | ❌ No | ✅ Yes | ✅ Yes |
| Matches spec requirements | Yes | **Yes** | Exceeds (overkill) |
| Pre-wired in codebase | No | **Yes** | No |

**Recommendation: Option B.**

---

## Approved Design — Option B Full Specification

> Implementation begins only after this section is confirmed.

### 1. Schema changes

```prisma
// model Ticket — add 4 fields
isBlocked     Boolean   @default(false)
blockedAt     DateTime?
blockedReason String?
blockedById   String?

// New index for dashboard queries
@@index([isBlocked])
@@index([status, isBlocked])
```

### 2. Backend changes

#### 2a. TicketTimingService — `getTimingState()`
Add at the top of the method, before any status checks:
```ts
// Blocked overlay — SLA paused regardless of status
if (ticket.isBlocked) {
  const frozenAt = this.asDate(ticket.blockedAt) ?? this.asDate(ticket.updatedAt);
  const elapsed = frozenAt && ticket.actualStartAt
    ? Math.max(0, frozenAt.getTime() - new Date(ticket.actualStartAt).getTime())
    : 0;
  const totalWindow = ticket.executionDueAt && ticket.actualStartAt
    ? Math.max(1, new Date(ticket.executionDueAt).getTime() - new Date(ticket.actualStartAt).getTime())
    : 1;
  return {
    timerType: 'blocked',
    label: 'Blocked — SLA paused',
    isOverdue: false,
    dueAt: frozenAt,
    remainingMs: 0,
    overdueMs: 0,
    responsibleRole: null,
    displayColor: 'amber',
    progressPercent: Math.min(100, Math.round((elapsed / totalWindow) * 100)),
    reason: ticket.blockedReason ?? 'Ticket is blocked',
  };
}
```

#### 2b. TicketAccessService — `assertCanBlockTicket()`
```ts
async assertCanBlockTicket(user: any, ticket: any): Promise<void> {
  const roleName = this.access.roleName(user);
  if (this.access.isAdmin(user)) return;
  if (roleName === ROLES.INTERN) throw new ForbiddenException('Interns cannot block tickets');
  if (!(await this.isTicketInUserScope(user, ticket))) {
    throw new ForbiddenException('Ticket is outside your scope');
  }
  if ([ROLES.MANAGER, ROLES.TEAM_LEAD].includes(roleName as any)) return;
  if (this.isTicketParticipant(user.id, ticket)) return;
  throw new ForbiddenException('Only participants or scoped leads can block this ticket');
}
```

#### 2c. TicketsService — `blockTicket()` and `unblockTicket()`
```ts
async blockTicket(id: string, reason: string, userId: string, user?: any) {
  const ticket = user
    ? await this.ticketAccess.findAccessibleTicket(id, user, { assignees: true })
    : await this.prisma.ticket.findFirst({ where: { OR: [{ id }, { ticketId: id }] }, include: { assignees: true } });
  if (!ticket) throw new NotFoundException('Ticket not found');
  if (ticket.status === TicketStatus.DONE || ticket.status === TicketStatus.CLOSED)
    throw new BadRequestException('Cannot block a completed or closed ticket');
  if (ticket.isBlocked) throw new BadRequestException('Ticket is already blocked');
  if (user) await this.ticketAccess.assertCanBlockTicket(user, ticket);

  const updated = await this.prisma.ticket.update({
    where: { id: ticket.id },
    data: { isBlocked: true, blockedAt: new Date(), blockedReason: reason, blockedById: userId },
    include: this.includeOptions,
  });

  await this.prisma.ticketHistory.create({
    data: { ticketId: ticket.id, field: 'isBlocked', oldValue: 'false', newValue: 'true', changedById: userId },
  });
  await this.prisma.activityLog.create({
    data: { userId, action: 'TICKET_BLOCKED', entityType: 'TICKET', entityId: ticket.id,
      details: { ticketId: ticket.ticketId, reason } },
  });
  this.eventLogger.log({ actorId: userId, entityType: 'Ticket', entityId: ticket.id,
    action: OperationalAction.TICKET_BLOCKED, fromState: ticket.status,
    metadata: { ticketId: ticket.ticketId, reason } }).catch(() => {});
  this.gateway.emitTicketStatusChanged(ticket.id, 'BLOCKED', userId);

  // Notify scoped manager/TL that a ticket is blocked
  // (notification target resolution is handled by caller or via a new 'ticketBlocked' event key)

  return this.addSla(updated);
}

async unblockTicket(id: string, userId: string, user?: any) {
  const ticket = user
    ? await this.ticketAccess.findAccessibleTicket(id, user, { assignees: true })
    : await this.prisma.ticket.findFirst({ where: { OR: [{ id }, { ticketId: id }] }, include: { assignees: true } });
  if (!ticket) throw new NotFoundException('Ticket not found');
  if (!ticket.isBlocked) throw new BadRequestException('Ticket is not blocked');
  if (user) await this.ticketAccess.assertCanBlockTicket(user, ticket);

  const updated = await this.prisma.ticket.update({
    where: { id: ticket.id },
    data: { isBlocked: false, blockedAt: null, blockedReason: null, blockedById: null },
    include: this.includeOptions,
  });

  await this.prisma.ticketHistory.create({
    data: { ticketId: ticket.id, field: 'isBlocked', oldValue: 'true', newValue: 'false', changedById: userId },
  });
  await this.prisma.activityLog.create({
    data: { userId, action: 'TICKET_UNBLOCKED', entityType: 'TICKET', entityId: ticket.id,
      details: { ticketId: ticket.ticketId } },
  });
  this.eventLogger.log({ actorId: userId, entityType: 'Ticket', entityId: ticket.id,
    action: 'TICKET_UNBLOCKED' as any, fromState: 'BLOCKED',
    toState: ticket.status, metadata: { ticketId: ticket.ticketId } }).catch(() => {});
  this.gateway.emitTicketStatusChanged(ticket.id, ticket.status, userId);

  return this.addSla(updated);
}
```

#### 2d. TicketsController — new endpoints
```
PATCH /tickets/:id/block     body: { reason: string }
PATCH /tickets/:id/unblock   body: (none)
```

#### 2e. getSlaRiskCategories() — add blocked count
```ts
const blocked = candidates.filter((t: any) => t.isBlocked).length;
// Return: { overdue, dueSoon, reviewAgeing, unassigned, blocked, total }
// Blocked tickets must NOT be double-counted in overdue
const overdue = candidates.filter((t: any) => !t.isBlocked && timing.isOverdue).length;
```

#### 2f. getStats() — include blocked count
```ts
const blocked = await this.prisma.ticket.count({ where: this.andWhere(activeScope, { isBlocked: true }) });
// Add to return: { ..., blocked }
```

#### 2g. EventLoggerService — add TICKET_UNBLOCKED
```ts
TICKET_UNBLOCKED = 'TICKET_UNBLOCKED',
```

#### 2h. NotificationEventService — new event key
Add `ticketBlocked: true` to `NOTIF_DEFAULTS`.

#### 2i. findAll() filter support
```ts
// In buildFilterWhere(), add:
if (filters.isBlocked === 'true' || filters.isBlocked === true) where.isBlocked = true;
```

### 3. Frontend changes

#### 3a. ticketsApi — new methods
```ts
block: (id: string, reason: string) => r(api.patch(`/tickets/${id}/block`, { reason })),
unblock: (id: string) => r(api.patch(`/tickets/${id}/unblock`)),
```

#### 3b. Kanban — blocked badge overlay
In `CardContent`, add after the OVERDUE badge:
```tsx
{ticket.isBlocked && !isDone && (
  <span className="flex items-center gap-0.5 text-[9px] font-bold text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-400 px-1 py-0.5 rounded">
    🚫 BLOCKED
  </span>
)}
```
Card border: when `isBlocked`, use amber border instead of default:
```tsx
border: ticket.isBlocked
  ? '2px solid #F59E0B'
  : ticket.isOverdue && !isDone
  ? '2px solid var(--color-danger)'
  : '1px solid var(--border-primary)',
```

#### 3c. Ticket list — blocked row indicator
In the ticket list, show an amber 🚫 BLOCKED badge next to the status pill.

#### 3d. Ticket detail page — block/unblock controls
In the ticket detail view:
- If ticket is `IN_PROGRESS` or `REVIEW` and not blocked: show "Mark as Blocked" button (participant/lead/manager guard)
- If ticket is blocked: show amber "Blocked" banner with `blockedReason`, "Unblock" button
- "Mark as Blocked" opens a small modal asking for the blocking reason (required, min 10 chars)

#### 3e. Dashboard — blocked count in SLA risk banner
The existing SLA risk banner (visible to isLeadOrAbove) receives an additional "Blocked" stat cell:
```tsx
// existing: Overdue / Due Soon / Review Ageing / Unassigned
// add:      Blocked (amber)
```

#### 3f. Dashboard — CriticalActionPanel — TICKET_BLOCKED alert type
```ts
TICKET_BLOCKED: '🚫',
// Add severity: 'amber'
// Alert: "{N} tickets are currently blocked — review and unblock"
// actionUrl: '/tickets?isBlocked=true'
```

#### 3g. Critical alerts from home summary
If `blockedTickets > 0`, add to `criticalAlerts` array in home service:
```ts
{
  type: 'TICKET_BLOCKED',
  severity: 'amber',
  title: `${blocked} ticket${blocked > 1 ? 's' : ''} blocked`,
  desc: 'Blocked tickets have their SLA paused. Review and unblock.',
  actionLabel: 'View Blocked',
  actionUrl: '/tickets?isBlocked=true',
}
```

#### 3h. Ticket filter — isBlocked filter support
Add "Blocked" option to the status filter dropdown in the tickets list page.

#### 3i. TimingTicker component
The existing `TimingTicker` component reads `ticket.timerType`. When `timerType === 'blocked'`, render an amber "🚫 Blocked — SLA paused" label instead of a countdown.

### 4. Events

| Event | Trigger | Logged to |
|-------|---------|-----------|
| `TICKET_BLOCKED` | `blockTicket()` | `OperationalEvent`, `ActivityLog` |
| `TICKET_UNBLOCKED` | `unblockTicket()` | `OperationalEvent`, `ActivityLog` (new action) |

Both events appear in the ticket detail timeline and the activity log.

### 5. Tests to add

| Test | Type |
|------|------|
| `PATCH /tickets/:id/block` — success | Integration |
| `PATCH /tickets/:id/block` — already blocked | Integration |
| `PATCH /tickets/:id/block` — on DONE ticket | Integration |
| `PATCH /tickets/:id/block` — INTERN guard | Integration |
| `PATCH /tickets/:id/unblock` — success | Integration |
| `PATCH /tickets/:id/unblock` — not blocked | Integration |
| `TicketTimingService.getTimingState()` — isBlocked=true | Unit |
| `TicketTimingService.getTimingState()` — isBlocked=false (existing tests unchanged) | Unit |
| `getSlaRiskCategories()` — blocked excluded from overdue | Unit |
| `getStats()` — blocked count returned | Unit |

---

## SLA Behavior Summary

| State | Timer | isOverdue |
|-------|-------|-----------|
| IN_PROGRESS, isBlocked=false | Execution SLA running | Yes if past executionDueAt |
| IN_PROGRESS, isBlocked=true | **Paused at blockedAt** | **Never** |
| REVIEW, isBlocked=false | Review SLA running | Yes if past reviewDueAt |
| REVIEW, isBlocked=true | **Paused at blockedAt** | **Never** |
| After unblock | Resumes from original timestamps | Yes if now past original dueAt |

**V1 behavior (this fix):** SLA clock stops showing overdue during blocked period. dueAt is NOT extended on unblock. The ticket may immediately become overdue after unblock if the original SLA window has passed — this is by design (blocking doesn't grant unlimited extension, only visual suppression).

**V2 enhancement (future):** Track `blockedDurationMinutes` accumulation; add to `executionDueAt` when ticket is unblocked. Requires additional field and logic in `unblockTicket()`.

---

## Files to be Modified (after approval)

### Backend
| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add 4 fields to Ticket model + 2 indexes |
| `common/services/ticket-timing.service.ts` | Add `isBlocked` branch at top of `getTimingState()` |
| `common/services/ticket-access.service.ts` | Add `assertCanBlockTicket()` |
| `common/services/event-logger.service.ts` | Add `TICKET_UNBLOCKED` action |
| `modules/operations/tickets/tickets.service.ts` | Add `blockTicket()`, `unblockTicket()`, update `getSlaRiskCategories()`, `getStats()`, `findAll()` filter |
| `modules/operations/tickets/tickets.controller.ts` | Add `PATCH /block` and `PATCH /unblock` endpoints |
| `modules/platform/dashboard/dashboard.service.ts` | Add `blocked` count to `getOverview()` critical alerts |
| `modules/operations/notifications/notification-event.service.ts` | Add `ticketBlocked` key to NOTIF_DEFAULTS |

### Frontend
| File | Change |
|------|--------|
| `lib/api.ts` | Add `block()`, `unblock()` to ticketsApi |
| `app/(dashboard)/(operations)/kanban/page.tsx` | Blocked badge overlay, amber border |
| `app/(dashboard)/(operations)/tickets/page.tsx` | Blocked badge, isBlocked filter |
| `app/(dashboard)/(operations)/tickets/[id]/page.tsx` | Block/unblock controls + blocked banner |
| `components/tickets/OverdueTicker.tsx` (TimingTicker) | Handle timerType='blocked' display |
| `app/(dashboard)/(core)/dashboard/page.tsx` | Add 'Blocked' stat to SLA risk banner |
| `components/home/CriticalActionPanel.tsx` | Add TICKET_BLOCKED alert type icon |

---

## Constraints — Not Changing

- ✅ `TicketStatus` enum: unchanged
- ✅ `TicketAccessService.assertCanTransitionTicket()`: unchanged (block/unblock is a separate action)
- ✅ `LeaveAccessService`, `LeaveBalanceService`, `NotificationEventService` core: unchanged
- ✅ `AccessPolicyService`: unchanged
- ✅ No fake metrics or front-end owned business logic
- ✅ INTERN cannot block/unblock
- ✅ Blocked state cannot be applied to DONE or CLOSED tickets

---

## Status

**AWAITING APPROVAL.**

Please confirm one of:
- ✅ **Approved — proceed with Option B as specified**
- 🔄 **Approved with modifications** — describe changes
- ❌ **Rejected — use different option** — specify which

Once approved, implementation will proceed in this order:
1. Prisma schema + migration
2. Backend service changes (timing, access, tickets service, controller)
3. Backend tests
4. Frontend API, kanban, ticket list, ticket detail
5. Dashboard integration
6. Frontend TypeScript check
7. Full backend test suite
