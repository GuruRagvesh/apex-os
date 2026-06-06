# FP13_1D_REVIEW_REWORK_AUDIT

## 1. What fields currently represent review?
- In `Ticket`: `reviewStartedAt`, `reviewDueAt`, `reworkCount`.
- In `ReviewCycleLog`: `cycleNo`, `reviewStartedAt`, `reviewEndedAt`, `decision`, `feedback`, `reworkStartedAt`, `reworkEndedAt`, `assigneeWorkSeconds`, `reviewerWorkSeconds`.

## 2. What starts REVIEW state?
- The ticket transitions to `TicketStatus.REVIEW` via `TicketsService.update()`. Currently, `update` emits events and stops active ASSIGNEE timers with `pauseReason = 'REVIEW'`.

## 3. What starts DONE state?
- A transition to `TicketStatus.DONE` via `TicketsService.update()` or specifically `TicketsService.approve()` (which wraps `update()`).

## 4. What happens when reviewer rejects?
- `TicketsService.reject()` wraps `update()` to set status back to `IN_PROGRESS` and leaves a `[REJECTED]` comment.

## 5. What fields already exist in ReviewCycleLog?
- `ticketId`, `cycleNo`, `assigneeId`, `reviewerId`, `reviewStartedAt`, `reviewEndedAt`, `decision`, `feedback`, `assigneeWorkSeconds`, `reviewerWorkSeconds`, `reworkStartedAt`, `reworkEndedAt`, `createdAt`, `updatedAt`.

## 6. Is reworkCount already present?
- Yes, `Ticket` has `reworkCount Int @default(0)`.

## 7. What timer ownership currently exists?
- `TicketTimeLog` uses `ownerType` which can be `'ASSIGNEE'` or `'REVIEWER'`.

## 8. Which transitions are safest hook points?
- The safest hook point is inside `TicketsService.update()` near line 585 where we already handle `TicketStatus.IN_PROGRESS` and `existing.status === IN_PROGRESS && data.status !== IN_PROGRESS`. 
- We can expand this to:
  - If `data.status === REVIEW`: call `ticketLedger.startReviewCycle()` and `ticketLedger.startWorkLog()` with `ownerType = REVIEWER`.
  - If `data.status === DONE` (and previous was `REVIEW`): call `ticketLedger.endReviewCycle({ decision: 'APPROVED' })` and `ticketLedger.endActiveLog()`.
  - If `existing.status === REVIEW && data.status === IN_PROGRESS`: call `ticketLedger.endReviewCycle({ decision: 'REWORK' })`, `ticketLedger.endActiveLog()`, and increment `reworkCount`.
