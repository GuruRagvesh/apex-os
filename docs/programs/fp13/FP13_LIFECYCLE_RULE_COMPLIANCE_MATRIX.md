# FP-13 Lifecycle Rule Compliance Matrix

| Rule Group | Rule | Status | Evidence/Notes | Action Required |
| :--- | :--- | :--- | :--- | :--- |
| **1. Workday lifecycle** | First login creates/resumes session | IMPLEMENTED | `workday.service.ts` `startWork` uses upsert. | None |
| | Logout stops active ticket timer | BROKEN | `workday.service.ts` `endWork` does not interact with tickets. | Code |
| | Logout/away counts as break/away time | PARTIAL | `totalWorkMinutes` subtracts breaks, but `away` is not explicitly categorized. | Code |
| | Return after logout resumes session | IMPLEMENTED | Upsert logic covers this. | None |
| | End Day locks daily totals | IMPLEMENTED | `logoutAt` is populated. | None |
| | Forgotten close day remains visible | PARTIAL | No cron job exists to auto-close or flag. | Code |
| **2. Break rules** | Break requires type | IMPLEMENTED | `breakType` required in DTO. | None |
| | Break stores reason, start, end, duration | PARTIAL | `reason`/`note` not collected in `startBreak`. | Code |
| | Active ticket timer stops during break | BROKEN | No hook in `workday.service.ts` to pause ticket SLA. | Code |
| | Cannot submit/done ticket on break | MISSING | No validation in `tickets.service.ts` `update()`. | Code |
| | Total break time calculated | IMPLEMENTED | Handled in `endWork` and `endBreak`. | None |
| | Allowed break = 1 hour/day | MISSING | No validation or extra-time flags. | Code |
| | Extra break time visible | MISSING | Not calculated or exposed. | Code |
| **3. Work Ticket lifecycle** | Full State Transition Flow | PARTIAL | Reopen logic exists but `Blocked` is just a flag, no `Pause`. | Code |
| **4. Timer ownership** | Assignee gets active work time | IMPLEMENTED | `actualStartAt` and `executionDueAt`. | None |
| | Break time counted separately | MISSING | Tickets don't subtract break time. | Code |
| | Reviewer gets review time | IMPLEMENTED | `reviewStartedAt` and `reviewDueAt`. | None |
| | Rework time returns to assignee | IMPLEMENTED | Resets review stamps, adds to execution due. | None |
| | Done stops timers | IMPLEMENTED | `actualCompletedAt`. | None |
| | Closed locks timers | IMPLEMENTED | `actualCompletedAt` / `closedAt`. | None |
| **5. Review & rework** | Send for approval | IMPLEMENTED | Transition to `REVIEW`. | None |
| | Rework count increments | MISSING | No `reworkCount` in `schema.prisma`. | Migration + Code |
| | Review cycles stored separately | MISSING | Overwrites timestamps. Need `ReviewCycleLog`. | Migration + Code |
| | Assignee rework time captured | PARTIAL | Overwrites existing `executionDueAt`. | Code |
| **6. Done/Reopen/Closed** | Done can reopen | IMPLEMENTED | Handled in `tickets.service.ts`. | None |
| | Done reassigned only after reopen | MISSING | Can reassign DONE tickets freely. | Code |
| | Closed cannot reopen | BROKEN | Code allows transition from CLOSED to OPEN/IN_PROGRESS. | Code |
| | Closed cannot be edited/reassigned | MISSING | Missing block validation in update method. | Code |
| **7. Assignment Permissions** | Employee can assign only to self | IMPLEMENTED | `create` enforces `assignedToId = userId`. | None |
| | TL assigns to team, cross-dept allowed | PARTIAL | `assertCanAssignTicket` may lack strict dept boundary validation. | Code |
| | Superadmin can assign broadly | IMPLEMENTED | Admin role bypass. | None |
| **8. Edit permissions** | Employee restricted to basic fields | BROKEN | API doesn't strip protected fields (timer logs) during update. | Code |
| | Edits record old, new, editor, reason | PARTIAL | `TicketHistory` captures old/new, but no `reason` field. | Migration + Code |
| **9. Ticket & Kanban Display** | Role-based Kanban filters | UNVERIFIED | Frontend checks needed. | Manual Verification |
| **10. Overdue & Analytics** | Overdue belongs to respective role | IMPLEMENTED | Handled in `ticket-timing.service.ts` (`responsibleRole`). | None |
| | Detailed Analytics snapshots | MISSING | Analytics module does not exist. | Code |
| **11. Required logs** | TicketTimeLog, ReviewCycleLog, StageHistoryLog | MISSING | Schemas do not exist. | Migration + Code |
| **12. Projects module** | List, create, link, edit, delete | IMPLEMENTED | Backend APIs exist. | None |
| | Reliability and Role Visibilty | UNVERIFIED | Needs production validation. | Manual Verification |
| **13. Deployment/Runtime** | Resend email configuration | CONFIG REQUIRED| Domain unverified. | Config |
| | Recurring scheduler fix | UNVERIFIED | Needs prod validation of commit `9b9e0af`. | Manual Verification |
