# FP-13.1B Timer Ledger Design Audit

## A. Current Timing Model Analysis

### 1. What fields currently exist on Ticket for timing?
**Evidence from `schema.prisma`:**
- `actualStartAt`, `actualCompletedAt`
- `executionDueAt`, `reviewStartedAt`, `reviewDueAt`, `closedAt`, `cancelledAt`
- `isBlocked`, `blockedAt`, `blockedReason`
- `scheduledStartAt`, `scheduledEndAt`, `estimatedMinutes`
- `estimatedTime`, `actualTime` (Float variants)
- `dueDate`, `submittedAt`, `resolvedAt`

### 2. What fields currently exist on WorkSession and BreakLog?
**Evidence from `schema.prisma`:**
- `WorkSession`: `totalLoggedMinutes`, `totalBreakMinutes`, `totalIdleMinutes`, `totalWorkMinutes`, `startWorkAt`, `logoutAt`
- `BreakLog`: `estimatedMinutes`, `startAt`, `endAt`, `durationMinutes`, `autoDetected`

### 3. Is ticket work time stored as duration anywhere?
**No.** The `actualTime` float exists on `Ticket`, but dynamic elapsed working time (excluding breaks/weekends) is not accurately accumulated. Currently, all SLAs are calculated purely by comparing the exact start timestamps against `now()` in `ticket-timing.service.ts`. 

### 4. Is ticket timing currently calculated from timestamps only?
**Yes.** `ticket-timing.service.ts` calculates elapsed time linearly (`now.getTime() - startAt.getTime()`). It has no awareness of when the user was logged out, sleeping, or on a break. 

### 5. Is SLA deadline stored as executionDueAt/reviewDueAt?
**Yes.** `ticket-timing.service.ts` prefers `ticket.executionDueAt` for in-progress and `ticket.reviewDueAt` for review state.

### 6. Is executionDueAt meant to represent a deadline or a paused/resumed timer target?
**Currently a hard deadline.** It represents the fixed SLA target. 

### 7. Does blocked-ticket logic already pause SLA? If yes, how?
**Yes, synthetically.** `ticket-timing.service.ts` checks `if (ticket.isBlocked)`. It freezes the elapsed percentage by overriding `now` to `blockedAt` (`frozenAt`), displaying `isOverdue: false`. It does not, however, dynamically extend the `executionDueAt` field in the database.

### 8. Does break/logout currently affect ticket timing at all?
**No.** `workday.service.ts` strictly manages `WorkSession` and `BreakLog`. The ticket system runs entirely parallel and ignorant to these states, meaning tickets "age" through breaks and logouts.

### 9. Does review timing overwrite previous review start/end values?
**Yes.** Moving a ticket back into `REVIEW` overwrites `submittedAt`, `reviewStartedAt`, and recalculates `reviewDueAt` dynamically. Historical review cycle durations are lost.

### 10. Does rework overwrite prior cycles?
**Yes.** Transitioning a ticket back to `IN_PROGRESS` nullifies `submittedAt` and `reviewStartedAt`, recalculating `executionDueAt` from the new transition point. Past rework times are completely lost to history.
