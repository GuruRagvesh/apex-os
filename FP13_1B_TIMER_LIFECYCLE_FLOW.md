# FP-13.1B Timer Lifecycle Flow

## D. Timer Lifecycle Design

### 1. Ticket assigned/self-assigned
- **When does TicketTimeLog start?** It does not start immediately if the ticket is merely `OPEN`. It only starts if the ticket moves to `IN_PROGRESS` or the assigned user is actively beginning work.
- **userId:** The assigned employee.
- **stage:** `WORK`
- **ownerType:** `ASSIGNEE`

### 2. Ticket moves to IN_PROGRESS
- Starts the `TicketTimeLog` for the assignee.
- `startedAt` = `now()`.

### 3. User starts break
- The active `TicketTimeLog` is closed: `endedAt` = `now()`, `durationMinutes` calculated, `pauseReason` = `'BREAK'`.
- `BreakLog` is created.
- Result: Ticket time does NOT accumulate while the user rests.

### 4. User ends break/resumes
- `BreakLog` closes.
- If the ticket was still in `IN_PROGRESS` and assigned to this user, a **new** `TicketTimeLog` row is created with `startedAt` = `now()`.

### 5. User logs out during day
- The active `TicketTimeLog` is closed: `pauseReason` = `'LOGOUT'`.
- Workday service sets user to `LOGGED_OUT`.
- The ticket remains in `IN_PROGRESS` at the status level, but physically has no running timer log.

### 6. User logs back in
- User re-enters `WORKING` state.
- System identifies their active `IN_PROGRESS` ticket and creates a new `TicketTimeLog` row to resume tracking.

### 7. Ticket sent to REVIEW
- The assignee's active `TicketTimeLog` ends.
- **Recommendation:** Do *not* start the reviewer's `TicketTimeLog` immediately. A ticket waiting in the queue is not active effort. The reviewer's log (`stage: 'REVIEW'`, `ownerType: 'REVIEWER'`) should only begin when they explicitly claim or begin evaluating the ticket, ensuring fair attribution of queue time versus effort time.

### 8. Reviewer approves
- The reviewer's `TicketTimeLog` ends.
- Ticket moves to `DONE`.
- `ReviewCycleLog.decision` set to `'APPROVED'`.
- No active timers remain.

### 9. Reviewer requests rework
- Reviewer `TicketTimeLog` ends.
- `ReviewCycleLog.decision` set to `'REWORK'`, `reworkStartedAt` = `now()`.
- The ticket returns to `IN_PROGRESS`.
- The rework timer (`stage: 'REWORK'`) starts only when the assignee resumes work.

### 10. Ticket reopened from DONE
- A completely new work cycle (`ReviewCycleLog`) or a fresh `TicketTimeLog` initiates under the new assignee.

### 11. Ticket CLOSED
- Hard lock enforced (per FP-13.1A).
- All logs definitively ended. No future `TicketTimeLog` rows can be created under any circumstance.

## E. SLA and Overdue Design

### 1. How should overdue be calculated after introducing logs?
Overdue should shift from a raw timestamp comparison to an elapsed duration comparison against the SLA hours target, excluding permitted pause blocks (breaks/logouts). 

### 2. Should breaks extend executionDueAt or only subtract from productive-time analytics?
They should logically **extend** `executionDueAt`. If an SLA is 4 hours of effort, and the user takes a 1-hour mandated break, the absolute wall-clock deadline must shift forward by 1 hour.

### 3. If an employee is on break past due time, should SLA pause or analytics blame exclude break time?
The SLA pauses. If they go on break at 3h50m (of a 4h SLA), they still have 10m remaining upon return. The system will not auto-flag it as overdue while they eat.

### 4. How should blocked tickets differ from breaks?
Blocked tickets are external blockers (client unresponsive, dependencies missing) and pause the timer completely regardless of the user's presence. Breaks are specific to the human's Workday limitations. Both pause the ticket, but for fundamentally different reasons that must be reported on differently.

### 5. How should review overdue be attributed to reviewer?
Review time has its own SLA configured in `ticket-timing.service.ts` (`DEFAULT_REVIEW_SLA`). If a ticket waits in the queue too long, or the reviewer takes too long, it breaches the review SLA, heavily separating assignee blame from management delay.

### 6. How should assignee overdue stop once ticket is under review?
The execution SLA timer explicitly freezes the moment the ticket transitions to `REVIEW`. The assignee's accountability for that cycle is sealed.
