# FP-20B TICKET SLA AUTHORITY CONSOLIDATION

## SUMMARY

Resolved TVA-005, TVA-006, TVA-007, and TVA-009. The Ticket SLA calculation formula has been fully centralized into `TicketTimingService.getTimingState`. All duplicate and conflicting logic across the application has been removed and refactored to consume the output of this single authority.

## CHANGES MADE

1.  **backend/src/modules/platform/automation/automation.service.ts**
    *   Updated the `checkOverdueTickets` cron job.
    *   Removed the hardcoded inline SLA logic (`Date.now() - ticket.createdAt > sla`).
    *   Expanded the Prisma `select` payload to fetch all ticket states required by the timer service.
    *   Refactored to check `this.ticketTiming.getTimingState(ticket, config).isOverdue`.

2.  **backend/src/modules/ai/ai.cron.service.ts**
    *   Updated the `sendDailyDigest` cron job.
    *   Removed the hardcoded SLA logic for the digest summary.
    *   Refactored the `overdueTickets` filter to check `this.ticketTiming.getTimingState(t, config).isOverdue`.

3.  **backend/src/modules/platform/analytics/analytics.service.ts**
    *   Updated `getManagerMetrics`.
    *   Removed the simplistic inline overdue check (`t.executionDueAt < new Date()`).
    *   Expanded the `select` payload and refactored to evaluate overdue tickets strictly through the `TicketTimingService`.

4.  **frontend/lib/ticket-timing.ts**
    *   Removed the client-side fallback timer calculation.
    *   The frontend now strictly assumes `ticket.timing` is provided by the API. If missing or terminal, it simply reports the ticket as not overdue.

5.  **backend/test/unit/tva-sla-authority.spec.ts**
    *   Added a unit test to statically prove that the Dashboard/Tickets API, Automation cron, AI Digest cron, and Analytics manager metrics all evaluate the SLA of tickets through exactly the same central service function.

## VERIFICATION

*   Backend unit tests passed successfully.
*   Frontend production build passed successfully.
*   The system now guarantees that an "Overdue Ticket" notification is perfectly synchronized with the Dashboard's red countdown indicators and the AI's email digest.

**Status:** Completed.
