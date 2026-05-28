# Activity Log E2E Audit

This audit evaluates the reliability, visibility, and role-scoping of the activity logging system across Apex OS.

## 1. Trace of Actions

| Action | Event Created? | Event Persisted? | Actor ID Set? | Entity Type | Entity ID | Scope Evaluated? | Click Target Works? |
| :--- | :---: | :---: | :---: | :--- | :--- | :---: | :--- |
| **1. Ticket Create** | Yes | Yes (`OperationalEvent`) | Yes | `Ticket` | ticket.id | Scoped to dept | Yes (`/tickets/:id`) |
| **2. Ticket Status Change** | Yes | Yes (`OperationalEvent`) | Yes | `Ticket` | ticket.id | Scoped to dept | Yes (`/tickets/:id`) |
| **3. Ticket Assignment** | No | No | N/A | `Ticket` | ticket.id | N/A | N/A (Missing log call) |
| **4. Comment Add** | Yes | Yes (`OperationalEvent`) | Yes | `Ticket` | ticket.id | Scoped to dept | Yes (`/tickets/:id`) |
| **5. Attachment Upload** | Yes | Yes (`OperationalEvent`) | Yes | `Ticket` | ticket.id | Scoped to dept | Yes (`/tickets/:id`) |
| **6. Leave Request** | Yes | Yes (`OperationalEvent`) | Yes | `LeaveRequest` | leave.id | Scoped to dept | No (Missing in controller url mapper) |
| **7. Leave Approve/Reject** | Yes | Yes (`OperationalEvent`) | Yes | `LeaveRequest` | leave.id | Scoped to dept | No (Missing in controller url mapper) |
| **8. Workday Start** | Yes | Yes (`OperationalEvent`) | Yes | `WorkdaySession` | session.id | Scoped to dept | No (Does not link to dead route) |
| **9. Break Start/End** | Yes | Yes (`OperationalEvent`) | Yes | `WorkdaySession` | session.id | Scoped to dept | No (Does not link to dead route) |
| **10. Workday End** | Yes | Yes (`OperationalEvent`) | Yes | `WorkdaySession` | session.id | Scoped to dept | No (Does not link to dead route) |
| **11. Project Update** | Yes | Yes (`OperationalEvent`) | Yes | `Project` | project.id | Scoped to dept | No (Missing in controller url mapper) |

---

## 2. Answers to Diagnostic Questions

### 1. What tickets/events should TEAM_LEAD see?
A `TEAM_LEAD` should see events where:
- The actor is they themselves or one of their managed department members.
- OR the event is related to a ticket belonging to their department or assigned to/created by/participated in by department members.
- OR the event is related to a project within their department.
- OR the event is related to a leave request of department members.

### 2. What tickets/events does TEAM_LEAD currently see?
Currently, a `TEAM_LEAD` only sees events where the actor is they themselves or active members of their department (`where: { actorId: { in: allAllowedIds } }`). They do **not** see events performed by other roles (e.g. admins or managers from other departments) on their department's tickets/projects/leaves.

### 3. Is TEAM_LEAD scope based on department, reporting hierarchy, teamLeadName, createdBy, assignee, or project membership?
Like ticket visibility, it is based on the team lead's managed department IDs (obtained via `AccessPolicyService.managedDepartmentIds`), matching against the actor's department.

### 4. Are frontend filters hiding visible tickets/events?
No, the frontend sends the selected `eventType` (action) and `from` timestamp. The backend query resolves events matching these filters.

### 5. Are API calls passing incorrect department/assignee filters?
No. The API call on both Recent Activity and Activity Log page calls `/events` with correct query parameters (`limit`, `action`, `from`).

### 6. Are dashboard counts and ticket/activity list using the same TEAM_LEAD scope?
No. The dashboard activity feed calls `/api/dashboard/activity-feed` (queries `ActivityLog`), while the dashboard Recent Activity widget and the main Activity Log page call `/api/events` (queries `OperationalEvent`). This causes inconsistency.

### 7. Are Kanban and ticket list using the same TEAM_LEAD scope?
Yes, they both use `TicketAccessService.buildTicketWhereForUser`.

### 8. Are analytics workload charts available and correctly scoped for TEAM_LEAD?
Yes. They correctly fetch workload metrics scoped to department members.

---

## 3. Root Cause of Empty / Incomplete Activity Log
1. **Scope Restriction:** The query in `EventsController.getEvents` only scopes by `actorId: { in: allAllowedIds }` or `actorId: user.id`. This means:
   - An employee only sees events where they themselves are the actor (e.g., they don't see status updates/comments made on their tickets by their leads).
   - A team lead only sees events where their department member is the actor (e.g., they don't see when an admin comments on or closes their team member's ticket).
2. **Missing Entity Scoping:** The query doesn't fetch entity-related IDs (tickets, leaves, projects) belonging to the user's scope.
3. **Missing Ticket Assignment Event:** `TICKET_ASSIGNED` is defined in `OperationalAction` but never logged.
4. **Missing Project/Leave Click Targets:** `getEntityUrl` on the backend doesn't resolve `/projects/:id` or `/leave`.
5. **Vague Empty States:** The empty states don't explain what filters are causing the results to be empty.
