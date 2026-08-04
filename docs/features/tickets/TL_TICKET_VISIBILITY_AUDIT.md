# Team Lead Ticket Visibility Audit

This audit evaluates the ticket visibility rules and potential mismatches for the `TEAM_LEAD` role in Apex OS.

## 1. What tickets should TEAM_LEAD see?
According to the Expected Product Rules, a `TEAM_LEAD` should see:
- Own tickets (assigned to them, created by them, or where they are a participant).
- Tickets assigned to members in their team/department.
- Tickets created by members in their team/department.
- Department tickets if they lead that department/team.

They should **NOT** see:
- Unrelated department tickets.
- Admin/global data.
- Other team leads' private team data.

---

## 2. What tickets does TEAM_LEAD currently see?
Currently, a `TEAM_LEAD` only sees:
- Own tickets (where `assignedToId` is the user, `createdById` is the user, or they are in the `assignees` table).
- Tickets whose `departmentId` field matches the `TEAM_LEAD`'s `departmentId` (obtained via `AccessPolicyService.managedDepartmentIds`).

A `TEAM_LEAD` **cannot** see:
- Tickets assigned to their department/team members if the ticket's `departmentId` is null or set to a different department (e.g., cross-functional project tickets).
- Tickets created by their department/team members if the ticket's `departmentId` is null or different.

This is a visibility mismatch because the scope rules in `TicketAccessService.buildScopeWhere` do not check the creator's or assignee's department membership.

---

## 3. Is TEAM_LEAD scope based on department, reporting hierarchy, teamLeadName, createdBy, assignee, or project membership?
The `TEAM_LEAD` scope is based on **department** (specifically the team lead's `departmentId` via `AccessPolicyService.managedDepartmentIds`), **assignee** (`assignedToId`), **creator** (`createdById`), and **participant** (via the `TicketAssignee` junction table).
It is **not** based on reporting hierarchy, `teamLeadName`, or project membership.

---

## 4. Are frontend filters hiding visible tickets?
No. The frontend `/tickets` and `/kanban` pages display whatever list is returned by the API. However, selecting "All Departments" from the dropdown passes `departmentId: ""` to the backend. The backend then resolves the scope under `TicketAccessService.buildScopeWhere`. The frontend filters themselves do not hide tickets that the backend permits.

---

## 5. Are API calls passing incorrect department/assignee filters?
No, the frontend passes queries such as `departmentId` or `assignedToId` correctly as query parameters to `/api/tickets` and `/api/tickets/kanban`, which are parsed and handled correctly by `TicketAccessService`.

---

## 6. Are dashboard counts and ticket list using the same TEAM_LEAD scope?
Yes. Both the dashboard overview service (`DashboardService.getOverview` and `DashboardService.getMetrics`) and the ticket list query (`TicketsService.findAll`) invoke the same query builder: `TicketAccessService.buildTicketWhereForUser`.

---

## 7. Are Kanban and ticket list using the same TEAM_LEAD scope?
Yes. The Kanban board endpoint (`TicketsService.getKanban`) also invokes `TicketAccessService.buildTicketWhereForUser`, ensuring that the Kanban counts and ticket list counts are synchronized.

---

## 8. Are analytics workload charts available and correctly scoped for TEAM_LEAD?
Yes. The analytics workload page queries `/api/dashboard/workload`, which triggers `DashboardService.getWorkloadByUser`. This method resolves team member IDs using `TicketAccessService.visibleUserIdsForWorkload`, which correctly returns the team lead and all active members of their department. The workloads are then computed by grouping active tickets scoped to those users.

---

## Conclusion & Recommended Fixes
The primary visibility mismatch is in `TicketAccessService.buildScopeWhere`. 
For `TEAM_LEAD` (and `MANAGER`), the database query must check if the ticket's `assignedTo` user, `createdBy` user, or any record in the `assignees` table belongs to the managed departments.

### Suggested Prisma Where Clause for `TEAM_LEAD` / `MANAGER`:
```typescript
{
  OR: [
    { assignedToId: user.id },
    { createdById: user.id },
    { assignees: { some: { userId: user.id } } },
    { departmentId: { in: deptIds } },
    { assignedTo: { departmentId: { in: deptIds } } },
    { createdBy: { departmentId: { in: deptIds } } },
    { assignees: { some: { user: { departmentId: { in: deptIds } } } } },
  ]
}
```
This fix will instantly align all endpoints (tickets list, Kanban, dashboard, analytics workload) because they all depend on `buildTicketWhereForUser` and `visibleUserIdsForWorkload`.
