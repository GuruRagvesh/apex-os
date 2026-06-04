# FP-18C Ticket Timer Trigger Audit

## Phase 1 Answers

**1. Does ticket creation start a TicketTimeLog?**
No. A newly created ticket defaults to `OPEN`, which intentionally has no active timer. 

**2. Does OPEN status have an active employee timer?**
No active `TicketTimeLog` is associated with the `OPEN` state.

**3. Which method starts ASSIGNEE TicketTimeLog?**
The method `TicketLedgerService.startWorkLog()` with `ownerType = ASSIGNEE`.

**4. Which method ends/pause ASSIGNEE TicketTimeLog?**
The method `TicketLedgerService.endActiveLog()` is used for specific ticket logs, and `pauseActiveLogsForUser()` is used to suspend all logs for a user during a break/logout.

**5. What happens to active ASSIGNEE logs when user starts break?**
*Expected:* All active assignee logs should be paused.
*Actual (Before Fix):* Nothing happened because `pauseActiveLogsForUser` was not called during `startBreak` in `workday.service.ts`. 

**6. What happens to active ASSIGNEE logs when user ends workday/logs out?**
*Expected:* All active assignee logs should be paused.
*Actual (Before Fix):* Nothing happened. Timers were left running infinitely until the midnight auto-close script caught them.

**7. What happens when IN_PROGRESS → REVIEW?**
*Expected:* ASSIGNEE timer stops; REVIEWER timer starts.
*Actual (Before Fix):* The status transitioned and `startReviewCycle` was called (which records SLA timestamps), but no actual `TicketTimeLog` operations occurred for the assignee or the reviewer.

**8. Which method starts REVIEWER TicketTimeLog?**
`TicketLedgerService.startWorkLog()` with `ownerType = REVIEWER`. (Previously not invoked anywhere).

**9. Which method ends REVIEWER TicketTimeLog?**
`TicketLedgerService.endActiveLog()` when the ticket moves out of `REVIEW`.

**10. What happens when REVIEW → APPROVED/DONE?**
*Expected:* REVIEWER timer ends. 
*Actual (Before Fix):* Only `endReviewCycle` was called, logging stats using empty arrays since the `TicketTimeLog` was never started.

**11. What happens when REVIEW → REJECT/OPEN?**
*Expected:* REVIEWER timer ends, ticket goes to `OPEN` with no active timer.
*Actual (Before Fix):* `endReviewCycle` was called with `REWORK`, but again, no timer was physically stopped.

**12. Does rejected OPEN ticket have no active timer?**
Yes, because `activeClock` pulls from live logs, and ending the REVIEWER log successfully results in no active logs.

**13. Does rework restart create a new ASSIGNEE log?**
Yes, moving from `OPEN` to `IN_PROGRESS` triggers `startWorkLog` anew.

**14. Are DONE/CLOSED tickets protected from active timers?**
Yes. `assertNoOpenLogsForClosedTicket` acts as a guard, but practically, moving to `DONE` explicitly ends the active logs in the updated transition hooks.

**15. Is SLA/overdue calculation separate from productive work timer?**
Yes. SLA is computed based on wall-clock timestamps (`actualStartAt`, `estimatedMinutes`, `reviewDueAt`), completely decoupled from the start/stop mechanics of productive work time (which ignore out-of-office hours).

**16. Does frontend show active clock state correctly?**
The frontend displays the state as provided by `timers.activeClock`. Previously, it permanently displayed `NONE` because logs were never started. It now correctly toggles between `EMPLOYEE_WORK`, `REVIEWER_APPROVAL`, and `NONE`.

## Core Discovery
The `TicketLedgerService` was comprehensively built with solid time-tracking logic but completely decoupled from the core application loops (`workday.service.ts` and `tickets.service.ts`). Phase 2 and 3 of FP-18C integrated these components definitively via synchronous service injection.
