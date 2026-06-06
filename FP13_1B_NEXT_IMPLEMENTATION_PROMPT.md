# FP-13.1B Next Implementation Plan

## G. Implementation Plan

The timer ledger should be rolled out in highly isolated phases to prevent cascading failures in SPMS operations. 

### Phase 1: Schema Migration (FP-13.1B1)
**Goal:** Deploy the database structure silently.
- Update `schema.prisma` to include `TicketTimeLog` and `ReviewCycleLog` models.
- Add `reworkCount` to `Ticket`.
- Run Prisma migrations.
- Verify production DB integrity. 
- **Rule:** No service-level logic connects to these tables yet.

### Phase 2: Core Utility Service (FP-13.1B2)
**Goal:** Create the internal engine for manipulating logs.
- Build a new `TicketLedgerService` dedicated to safely writing to these new tables.
- Implement methods: `startWorkLog()`, `endWorkLog()`, `pauseActiveLogsForUser()`, `resumeActiveLogsForUser()`, `startReviewCycle()`, `endReviewCycle()`.
- Add comprehensive unit tests isolating this service entirely.
- **Rule:** Do not hook this into `tickets.service.ts` or `workday.service.ts` yet.

### Phase 3: Workday ↔ Ticket Integration (FP-13.1C)
**Goal:** Hook the Workday actions to the ledger engine.
- Inject `TicketLedgerService` into `WorkdayService`.
- Hook `startBreak()` and `endWork()` to invoke `pauseActiveLogsForUser()`.
- Hook `endBreak()` and `startWork()` to invoke `resumeActiveLogsForUser()`.
- Update `TicketsService.update()` to trigger `startWorkLog()` / `endWorkLog()` during status transitions (`OPEN -> IN_PROGRESS`).

### Phase 4: Review and Rework Cycles (FP-13.1D)
**Goal:** Hook review transitions to `ReviewCycleLog`.
- Update `TicketsService.update()` transitions for `REVIEW`, `DONE`, and `IN_PROGRESS` (when rejecting).
- Ensure `ReviewCycleLog` accurately counts cycles and records feedback strings.
- Freeze assignee timers during this phase.

### Phase 5: Analytics and Display Shift (FP-13.3)
**Goal:** Switch the dashboard and reporting to the new ledger.
- Update `ticket-timing.service.ts` to derive elapsed time from `TicketTimeLog` rather than simple timestamp comparisons.
- Shift overdue calculation to subtract paused break durations.
- Roll out new precise productivity metrics.

---
**Next Step for Agent:** Wait for user approval to begin **FP-13.1B1 (Schema Migration)**. Do not execute any code until instructed.
