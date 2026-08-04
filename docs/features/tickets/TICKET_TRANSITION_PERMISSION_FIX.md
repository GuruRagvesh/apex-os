# TICKET_TRANSITION_PERMISSION_FIX

## Files Changed
1. `backend/src/common/services/ticket-access.service.ts`
   - Fixed `isIntern` blocked transition rule.
   - Updated transition matrix `allowed[TicketStatus.REVIEW]` to include `TicketStatus.IN_PROGRESS`.
2. `backend/test/unit/ticket.transitions.spec.ts`
   - Added positive test: `allows assigned INTERN to move IN_PROGRESS ticket to REVIEW`
   - Added negative test: `blocks unassigned INTERN from moving IN_PROGRESS ticket to REVIEW`

## Old Rule
- Employees and Interns were blocked from transitioning tickets `REVIEW -> IN_PROGRESS` because the global state machine map omitted `IN_PROGRESS` as a valid destination from `REVIEW`.
- Interns were strictly hardcoded to only be able to transition tickets to `IN_PROGRESS` (`toStatus !== TicketStatus.IN_PROGRESS`), causing the error: "Interns can only move tickets to IN_PROGRESS" whenever they tried to submit their completed work for review.

## New Rule
- Interns can now move tickets to `IN_PROGRESS` OR `REVIEW`.
- The global transition matrix explicitly allows `REVIEW -> IN_PROGRESS` for rework, protected by the existing reviewer-scope guard.
- Workers (Employees and Interns) assigned to a ticket can successfully move `OPEN -> IN_PROGRESS` and `IN_PROGRESS -> REVIEW`.

## Tested Transition Matrix
| Actor | From | To | Result |
|---|---|---|---|
| Assigned INTERN / EMPLOYEE | OPEN | IN_PROGRESS | ✅ SUCCESS |
| Assigned INTERN / EMPLOYEE | IN_PROGRESS | REVIEW | ✅ SUCCESS |
| Unassigned INTERN | IN_PROGRESS | REVIEW | ❌ BLOCKED |
| Assigned INTERN / EMPLOYEE | REVIEW | DONE | ❌ BLOCKED |
| Scoped Reviewer (TL/Manager) | REVIEW | DONE | ✅ SUCCESS |
| Scoped Reviewer (TL/Manager) | REVIEW | IN_PROGRESS (Rework) | ✅ SUCCESS |

## Remaining Risks
- Frontend button disabled states: The frontend correctly determines `canEdit = isManagerPlus || isParticipant`. So workers assigned to the ticket will have full access to click the `REVIEW` button. No hardcoded frontend blocks were found.
- If a ticket is unassigned and an intern tries to claim it, they must first assign themselves before transitioning it to `REVIEW`. This is standard workflow behavior.
