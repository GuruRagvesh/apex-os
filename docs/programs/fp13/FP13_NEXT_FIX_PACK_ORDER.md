# FP-13 Next Fix Pack Order

## Recommended: Fix Pack 13.1 (Timers & Data Integrity)

This pack must address the P0 data integrity and operational blockers that destroy trust in the SLA system.

### Scope of Work (FP 13.1)
1. **Schema Migrations:**
   - Add `reworkCount` (Int) to `Ticket`.
   - Create `ReviewCycleLog` model.
   - Create `TicketTimeLog` model (optional but recommended for pause/resume tracking).
2. **Workday-Ticket Timer Integration:**
   - Intercept `startBreak` and `endBreak` in `workday.service.ts` to emit events or directly update ticket SLA timers.
   - Intercept `endWork` (Logout) to pause ticket timers.
3. **Strict State Enforcement:**
   - Modify `tickets.service.ts` to block edits/reassignment/reopening of `CLOSED` tickets.
   - Reject status updates to DONE/REVIEW if the user's `currentStatus` is `ON_BREAK` or `LOGGED_OUT`.
4. **Rework Logic:**
   - Increment `reworkCount` when a ticket moves from REVIEW to IN_PROGRESS.
   - Record the cycle in `ReviewCycleLog`.

### Future Fix Packs
- **FP 13.2 (Permissions & Edits):** Strip protected fields from API updates, add reason to TicketHistory, add reason to BreakLog.
- **FP 13.3 (Analytics & Cron):** Auto-close forgotten workdays, build AnalyticsSnapshots module, calculate Extra Break Time.
- **FP 13.4 (UI & Config):** Verify Projects UI, configure SMTP/Resend.
