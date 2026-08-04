# FP13_2_PERMISSION_AUDIT

## Audit Findings

1. **Who can currently edit tickets?**
   Currently, `TicketAccessService.assertCanUpdateTicket` allows any Employee who is the assignee, creator, or a participant to edit tickets. Managers and Team Leads can edit any ticket within their scoped departments. Admins have global edit access. However, there is no granular field-level protection — an employee who is the assignee can edit any field (priority, SLA, department, etc.) as long as the ticket is not closed.

2. **Who can currently assign tickets?**
   `TicketAccessService.assertCanAssignTicket` currently allows Managers and Team Leads to assign tickets, provided the target assignee belongs to a department they manage. Employees are blocked from assigning tickets. However, Team Leads do not have a separate restriction forcing assignment "within their own team hierarchy"; they share the same department-scoped logic as Managers.

3. **Who can currently change status?**
   `TicketAccessService.assertCanTransitionTicket` enforces workflow paths (e.g., OPEN → IN_PROGRESS → REVIEW → DONE). Employees can move their own tickets through these paths. Managers/TLs can move scoped tickets.

4. **Who can currently move cards?**
   Kanban movements map directly to `updateStatus`. Therefore, the same transition guardrails apply. Employees can move their own cards.

5. **Can employees edit after submission?**
   If an Employee's ticket is in `REVIEW` or `DONE`, the general `assertCanUpdateTicket` might still allow edits if they are the participant. Field-level protection is missing to explicitly lock down edits after submission.

6. **Can employees assign tickets?**
   No, `assertCanAssignTicket` throws `ForbiddenException` for Employees.

7. **Can employees reopen DONE tickets?**
   Yes, if they are the participant and the workflow allows DONE → OPEN or DONE → IN_PROGRESS.

8. **Can TLs modify unrelated tickets?**
   No, they are restricted to their scope via `isTicketInUserScope`. But within that scope, they have full edit access.

9. **Can managers override ownership?**
   Yes, Managers can reassign any scoped ticket.

10. **Where are the safest enforcement points?**
    The safest enforcement points are inside `TicketAccessService` methods:
    - `assertCanAssignTicket` (refining Manager vs. Team Lead logic).
    - `assertCanUpdateTicket` (adding field-level checks based on role).
    - `assertCanTransitionTicket` (hardening Kanban movements and reopening logic).

## Conclusion
While base-level scope access control exists, there is a lack of strict field-level immutability and distinct hierarchy checks for Team Leads versus Managers. These gaps will be closed in this Fix Pack.
