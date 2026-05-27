# Kanban Workflow Report

**Date:** 2026-05-27  
**Sprint:** P1-B  
**Status:** COMPLETE — no new changes required

---

## Architecture Review

The Kanban board was fully inspected during P1-B reconciliation. No gaps were found.

### Drag-and-Drop Flow

```
@dnd-kit/core DragEndEvent
  → moveMutation (useMutation)
    → ticketsApi.updateStatus(id, newStatus)
      → PATCH /tickets/:id/status
        → TicketsService.updateStatus()
          → ticketAccess.assertCanTransitionTicket(user, ticket, newStatus)
          → prisma.ticket.update(status)
          → eventLogger.log(TICKET_CLOSED | TICKET_STARTED | etc.)
```

### Security Properties

- **Backend enforces all transitions:** `assertCanTransitionTicket()` in `TicketAccessService` is called before every status update. Invalid transitions (e.g., DONE → REVIEW) throw `ForbiddenException`.
- **Frontend `canMoveCard()` is UI-only gating:** Prevents the drag gesture from appearing active for illegal moves. The backend will reject any bypass attempt.
- **Optimistic UI with rollback:** `localKanban` is updated immediately on drag. If the backend PATCH fails, the `onError` callback calls `qc.invalidateQueries` to reset the board to authoritative server state.
- **Column counts:** `localKanban[col.key].length` reflects the current board state accurately. CLOSED tickets are excluded from the kanban view.

### Status Map (frontend → backend)

| Frontend column | Status value |
|----------------|-------------|
| Open | OPEN |
| In Progress | IN_PROGRESS |
| Under Review | REVIEW |
| Done | DONE |

CLOSED tickets do not appear on the Kanban board (filter: `status: { notIn: ['CLOSED'] }`).

---

## Conclusion

No code changes were required for Kanban. The existing implementation correctly enforces all workflow transitions through the frozen `TicketAccessService` with proper optimistic-UI rollback.
