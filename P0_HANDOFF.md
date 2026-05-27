# Apex OS — P0 Stabilization Handoff Document

This document outlines the state of the codebase following the completion of the P0 stabilization phase, highlighting the verification status and recommended immediate next tasks.

---

## 1. Project Health & Verification Status

* **Unit Tests:** **PASS**
  - **Command:** `npm run test:unit` (run in `backend`)
  - **Result:** 7 test suites, 39 tests passed successfully.
* **Compilation Status (TypeScript):** **PASS**
  - **Backend:** `npx tsc -p tsconfig.json` compiles with zero errors.
  - **Frontend:** `npx tsc --noEmit` compiles with zero errors.
* **Database State:** Prisma schema is validated and inline with migrations.

---

## 2. Key Architecture & File Changes

The following new services and components have been introduced to stabilize access scoping and SLA tracking:

| Component/Service | File Path | Responsibility |
|---|---|---|
| **Access Policy Engine** | [access-policy.service.ts](file:///c:/Users/Administrator/Desktop/nexus-app/backend/src/common/services/access-policy.service.ts) | Centralizes user visibility, password stripping, payroll masking, and document upload verification logic. |
| **Ticket Access Guard** | [ticket-access.service.ts](file:///c:/Users/Administrator/Desktop/nexus-app/backend/src/common/services/ticket-access.service.ts) | Restricts ticket reading, listing, and writing to the scoped users (assignee/reporter/lead/manager). |
| **Ticket SLA Engine** | [ticket-timing.service.ts](file:///c:/Users/Administrator/Desktop/nexus-app/backend/src/common/services/ticket-timing.service.ts) | Unifies timer status calculation (execution/review/scheduled) and delivers a single display contract to the frontend. |
| **Leave Access Guard** | [leave-access.service.ts](file:///c:/Users/Administrator/Desktop/nexus-app/backend/src/common/services/leave-access.service.ts) | Ensures leave requests, listings, and approvals respect department bounds and role hierarchies. |

These services have been wired into the following controllers and services:
* `users.controller.ts`, `users.service.ts`
* `tickets.controller.ts`, `tickets.service.ts`
* `comments.controller.ts`, `comments.service.ts`
* `leave.controller.ts`, `leave.service.ts`
* `projects.controller.ts`, `projects.service.ts`
* `dashboard.controller.ts`, `dashboard.service.ts`

---

## 3. Pending Technical Debt & Action Items

The following tasks are scheduled for the next development cycle:

### Task 1: Dead Code Cleanup
* **Scope:** Clean up unused imports, deprecated parameters, and old inline comments generated during the initial migration from the prototype codebase.
* **Target Files:** Various controllers/services in `backend/src/modules`.

### Task 2: Dashboard buildRoleScope Refactor
* **Scope:** Refactor `getCriticalAlerts`, `getMetrics`, and `getUpcomingEvents` in [dashboard.service.ts](file:///c:/Users/Administrator/Desktop/nexus-app/backend/src/modules/platform/dashboard/dashboard.service.ts) to delegate scoping queries directly to `TicketAccessService.buildTicketWhereForUser` and `LeaveAccessService.buildLeaveWhereForUser`.
* **Goal:** Eliminate the legacy `buildRoleScope` and `buildLeaveScope` helpers.

### Task 3: ESLint Config
* **Scope:** Resolve missing ESLint configurations in both backend and frontend to automate lint checks during CI/CD.
* **Target Files:** `/backend/.eslintrc.js`, `/frontend/.eslintrc.json`.

### Task 4: P1 Roadmap Tasks
* **Database Indexes:** Implement database index migration (`@@index`) on foreign keys in `schema.prisma`.
* **Profile view:** Develop the `/users/:id` frontend view to resolve 404 page transitions.
* **Settings updates:** Integrate the Settings Company form to persist configurations to the backend.

---

## 4. Next Recommended Coding Task

Start immediately on **Task 2: Dashboard buildRoleScope Refactor**. Unifying the alerts and metrics queries under the centralized `TicketAccessService` and `LeaveAccessService` will eliminate any potential risk of count/metric drift on the dashboard.
