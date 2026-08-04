# FP13_1D_REVIEW_REWORK_REPORT

## Implementation Summary
The Review/Rework Lifecycle Engine has been implemented inside `TicketsService`, integrating with the `TicketLedgerService`. 

### Reviewer Identity Approach
- By default, `TicketsService.update` uses the authenticated `userId` (actor) as the `reviewerId` when starting a `REVIEW` cycle, satisfying the rule "Use the authenticated actor as reviewer for review actions". 
- If the assignee moves the ticket to `REVIEW` themselves, their ID will technically be stamped as the reviewer until actual rejection or approval takes place, which uses the ID of the manager taking action.
- Fallback resolution is strictly deterministic: the `userId` passed to the transition function.

### Files Modified
- `backend/src/modules/operations/tickets/ticket-ledger.service.ts`: Updated `endReviewCycle` to support tracking `reworkStartedAt`, `assigneeWorkSeconds`, and `reviewerWorkSeconds`.
- `backend/src/modules/operations/tickets/tickets.service.ts`: Updated state transition logic to properly hook `startReviewCycle`, `endReviewCycle`, start `REVIEWER` logs, and increment `reworkCount` when `existing.status === REVIEW && data.status === IN_PROGRESS`.
- `backend/test/unit/ticket.transitions.spec.ts`: Added tests verifying Review/Rework hooks.
- `backend/test/unit/p1d.attachment-security.spec.ts`: Fixed constructor parameters to supply mocked TicketLedgerService properly.

### Verified Behaviors
- **Single Active Timer Rule**: The `ASSIGNEE` timer stops automatically when transitioning into `REVIEW`, effectively replacing it with the `REVIEWER` timer. Only one runs simultaneously.
- **Rework Integrity**: Rejections capture the exact `rejectComment` as `feedback` on the immutable `ReviewCycleLog` instance, ensuring historical auditability. `reworkCount` explicitly increments exactly once per rejection.

### Remaining Gaps
- `ReviewCycleLog` records do not yet dynamically accumulate and calculate `assigneeWorkSeconds` and `reviewerWorkSeconds` before the cycle ends. They are schema-ready but currently unused placeholders.
- A future UI/GraphQL update is required to actually present the `ReviewCycleLog` array to end-users via the frontend Command Center.

### Next Steps
We recommend moving towards the analytics tracking phase or addressing the **Project Module V2 Prototype**.
