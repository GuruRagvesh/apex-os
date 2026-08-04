# Team Lead Ticket Visibility - Fix Report

This document reports the surgical fix implemented to resolve the `TEAM_LEAD` ticket visibility issue in Apex OS.

## 1. Problem Identified
Under the expected product rules, a `TEAM_LEAD` (or `MANAGER`) should be able to see:
- Tickets assigned to their department/team members.
- Tickets created by their department/team members.
- Direct department/team tickets.

Previously, `TicketAccessService.buildScopeWhere` was only matching:
- The team lead's own tickets (assignee, creator, or participant).
- Tickets where the `ticket.departmentId` matched the team lead's department.

If a team member created or was assigned to a ticket with a null or different `departmentId` (e.g. cross-functional project tickets), the team lead had zero visibility over it.

## 2. Changes Made

### Backend Scoping Rules

#### [ticket-access.service.ts](file:///c:/Users/Administrator/Desktop/nexus-app/backend/src/common/services/ticket-access.service.ts)

Modified `buildScopeWhere` to include OR criteria searching for department membership in the assignee, creator, and participant entities:

```diff
     if (roleName === ROLES.MANAGER || roleName === ROLES.TEAM_LEAD) {
       const deptIds = await this.access.managedDepartmentIds(user);
       const scopedOr: any[] = [
         { assignedToId: user.id },
         { createdById: user.id },
         { assignees: { some: { userId: user.id } } },
       ];
-      if (deptIds.length > 0) scopedOr.unshift({ departmentId: { in: deptIds } });
+      if (deptIds.length > 0) {
+        scopedOr.push(
+          { departmentId: { in: deptIds } },
+          { assignedTo: { departmentId: { in: deptIds } } },
+          { createdBy: { departmentId: { in: deptIds } } },
+          { assignees: { some: { user: { departmentId: { in: deptIds } } } } },
+        );
+      }
       return { OR: scopedOr };
     }
```

This change resolves the visibility leak across all endpoints, including the Tickets page, Kanban board, Dashboard overview metrics, and Analytics workload chart since they all utilize the exact same access scoping.

---

### Tests

#### [p0.ticket-access-timing.spec.ts](file:///c:/Users/Administrator/Desktop/nexus-app/backend/test/unit/p0.ticket-access-timing.spec.ts)

Added a new test suite verifying all 6 mandatory visibility and count synchronization rules:
- `TEAM_LEAD can see team member assigned ticket`
- `TEAM_LEAD can see team member created ticket`
- `TEAM_LEAD can see department ticket`
- `TEAM_LEAD cannot see unrelated department ticket`
- `TEAM_LEAD ticket list count equals kanban count`
- `TEAM_LEAD dashboard ticket count equals scoped ticket count`
