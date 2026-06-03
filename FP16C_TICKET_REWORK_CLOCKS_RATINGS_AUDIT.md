# FP-16C Ticket Rework Clocks & Ratings — Audit Report

## 1. Current State Summary
Based on the codebase inspection:

1. **Where does REVIEW start?**
   In `tickets.service.ts`, when status changes from `IN_PROGRESS` to `REVIEW`. This initiates a review cycle using `ticketLedger.startReviewCycle`.
2. **Where does approval happen?**
   API endpoint `PATCH /tickets/:id/approve` maps to `ticketsService.approve(...)`.
3. **Where does rejection happen?**
   API endpoint `PATCH /tickets/:id/reject` maps to `ticketsService.reject(...)`.
4. **What status does rejection currently set?**
   Typically it sets `IN_PROGRESS` and resumes assignee work. The request states this must be changed to `OPEN`.
5. **Where is `reworkCount` incremented?**
   In `ticketsService.reject(...)`.
6. **Where does reviewer timer start/end?**
   Starts when entering `REVIEW` and ends upon approval/rejection using `TicketLedgerService`.
7. **Where does assignee timer start/end?**
   Starts when ticket moves to `IN_PROGRESS`, pauses when blocked or entering `REVIEW`.
8. **Does ticket total lifecycle time exist?**
   It does not exist as a stored duration, but can be derived from `createdAt` and `now()` or `resolvedAt`.
9. **Is total lifecycle derived or stored?**
   Derived.
10. **Does ReviewCycleLog already store feedback?**
    Yes, it has a `feedback String?` field.
11. **Are ratings already present anywhere?**
    No. We must add `taskEfficiencyRating`, `employeePerformanceRating`, and `employeeAttitudeRating` (along with `ratingComment`) to `ReviewCycleLog`.
12. **Which frontend screen has approve/reject buttons?**
    `frontend/app/(dashboard)/(operations)/tickets/[id]/page.tsx` and likely related components in `frontend/components/tickets/`.
13. **Which API endpoint handles approval/rejection?**
    `PATCH /tickets/:id/approve` and `PATCH /tickets/:id/reject`.
14. **Which tests currently assert review/rework behavior?**
    `test/unit/ticket.guardrails.spec.ts`, `test/unit/ticket.transitions.spec.ts`, and `test/unit/ticket-ledger.service.spec.ts`.

## 2. Gaps & Requirements
- Add rating fields to `ReviewCycleLog` via a safe migration `add_review_cycle_ratings`.
- Change rejection behavior to push the ticket back to `OPEN`.
- The assignee timer should *not* automatically start upon rejection.
- Frontend UX must mandate 1-5 integer ratings before allowing approval.
- Expose `timers` on the ticket detail response representing Total, Assignee Work, and Reviewer Approval clocks.
- Add specific `Rework 1`, `Rework 2` labels based on `reworkCount`.
