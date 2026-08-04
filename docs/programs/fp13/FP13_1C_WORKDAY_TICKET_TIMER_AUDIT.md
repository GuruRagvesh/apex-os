# FP13_1C_WORKDAY_TICKET_TIMER_AUDIT

## 1. How does WorkdayService represent user status?
- It uses the `WorkSession` table to track the daily session (`status: 'WORKING' | 'ON_BREAK' | 'LOGGED_OUT' | 'IDLE'`).
- It also maintains a denormalized `currentStatus` field on the `User` model.
- Break intervals are tracked in `BreakLog`.

## 2. Which methods start workday, start break, end break, and end work?
- `WorkdayService.startWork(userId)`
- `WorkdayService.startBreak(userId, dto)`
- `WorkdayService.endBreak(userId)`
- `WorkdayService.endWork(userId)`
- `WorkdayService.resumeWork(userId)` (used for returning from IDLE/Break generally)

## 3. Which methods set currentStatus to WORKING / ON_BREAK / LOGGED_OUT?
- `startWork`: `WORKING`
- `endWork`: `LOGGED_OUT`
- `startBreak`: `ON_BREAK`
- `endBreak`: `WORKING`
- `resumeWork`: `WORKING`
- `reportIdle`: `IDLE`

## 4. Which active tickets should be resumed after break?
- Any ticket that was actively being worked on by the user *before* the break.
- Safest method: Only tickets that were paused with `breakLogId === currentBreakLog.id`, provided the ticket is still assigned to the user, has status `IN_PROGRESS`, and is not blocked (`isBlocked === false`).

## 5. Is there a field showing current active ticket, or must active IN_PROGRESS tickets be queried?
- There is no direct "current active ticket" field on the User model. Active tickets must be queried via `TicketTimeLog` where `endedAt === null` (or in this case, by checking recent logs that were paused). 

## 6. How does TicketsService transition to IN_PROGRESS / REVIEW / DONE / CLOSED?
- Via `TicketsService.update()` (and `updateStatus()`), which receives the new status in the `data` payload. It validates transitions via `ticketAccess.assertCanTransitionTicket()`.

## 7. Does TicketLedgerService already have all methods required?
- It has `pauseActiveLogsForUser()` and `endActiveLog()`.
- It has `startWorkLog()`.
- Missing: A helper to safely "resume" logs for a specific `breakLogId`.

## 8. Are active logs idempotent?
- Yes. `TicketLedgerService.startWorkLog` checks if an active log already exists (`endedAt: null`) and returns the existing one instead of creating a duplicate. `pauseActiveLogsForUser` handles multiple open logs gracefully.

## 9. What tests already exist?
- `backend/test/unit/ticket-ledger.service.spec.ts` covers the ledger isolated logic.
- `backend/test/unit/workday.service.spec.ts` (implied) covers workday session states.
- `backend/test/unit/tickets.service.spec.ts` (implied) covers ticket updates and guardrails.

## 10. What is the safest minimal integration?
- Inject `TicketLedgerService` into `WorkdayService` and `TicketsService`.
- Hook into `startBreak`, `endBreak`, and `endWork`.
- Hook into `update` when `status` changes.
- Hook into `blockTicket`.
- Ensure we wrap the new ticket ledger calls with `try/catch` or let them participate in the main transaction (but currently they are separate Prisma calls, so standard sequential awaits are fine as long as they run after the main updates).
