# FP-14A — PROJECT MODULE V2 — CURRENT STATE AUDIT
**Date:** 2026-06-02 | Branch: `main` @ `a1ee8ab`
**Method:** Direct source inspection — no assumptions

---

## PHASE 0 — REPO SAFETY

| Check | Result |
|---|---|
| Branch | `main` |
| Latest commit | `a1ee8ab feat(analytics): build ledger-based analytics dashboard UI` |
| Analytics UI present | ✅ Yes (`a1ee8ab`) |
| Dirty tracked files | 3 doc files (AUTH_FORM_OTP_*.md) — not code |
| Prototype V2 files in repo | ❌ Not found — prototype exists separately |

---

## CURRENT APEX PROJECT MODULE — COMPLETE AUDIT

### 1. Prisma Models

#### `Project` (`backend/prisma/schema.prisma:151-172`)
```
id           String        @id @default(cuid())
projectId    String        @unique            ← auto-generated PRJ-001 etc.
name         String
description  String?
status       ProjectStatus @default(ACTIVE)   ← ACTIVE | ON_HOLD | COMPLETED | CANCELLED
priority     Priority      @default(MEDIUM)   ← LOW | MEDIUM | HIGH | URGENT
startDate    DateTime?
endDate      DateTime?
departmentId String?
createdAt    DateTime
updatedAt    DateTime
```
Relations: `department`, `members[]`, `tickets[]`
Indexes: `departmentId`, `status`, `createdAt`

#### `ProjectMember` (`schema.prisma:174-187`)
```
id        String   @id @default(cuid())
projectId String
userId    String
role      String   @default("MEMBER")    ← freeform string: OWNER | MEMBER | REVIEWER etc.
joinedAt  DateTime
```
Unique: `[projectId, userId]`

**Models NOT present:**
- ❌ `ProjectStage`
- ❌ `ProjectDocument`
- ❌ `ProjectMilestone`
- ❌ `ProjectActivity` (uses global `OperationalEvent`)
- ❌ `ProjectHealthSnapshot`
- ❌ `ProjectTimeline`
- ❌ `ProjectRisk`
- ❌ `ProjectDependency`
- ❌ `ProjectUpdate`

---

### 2. Backend API Endpoints (8 total)

| Method | Route | Auth | Role |
|---|---|---|---|
| GET | /projects | JWT | All (scoped) |
| GET | /projects/stats | JWT | All (scoped) |
| GET | /projects/:id | JWT | All (scoped) |
| POST | /projects | JWT + Roles | MANAGER / ADMIN / SUPER_ADMIN |
| PUT | /projects/:id | JWT + Roles | TEAM_LEAD / MANAGER / ADMIN / SUPER_ADMIN |
| POST | /projects/:id/members | JWT + Roles | TEAM_LEAD / MANAGER / ADMIN / SUPER_ADMIN |
| DELETE | /projects/:id/members/:userId | JWT + Roles | TEAM_LEAD / MANAGER / ADMIN / SUPER_ADMIN |
| DELETE | /projects/:id | JWT + Roles | ADMIN / SUPER_ADMIN only |

**Endpoints NOT present:**
- ❌ GET/POST /projects/:id/stages
- ❌ GET/POST /projects/:id/documents
- ❌ GET /projects/:id/timeline
- ❌ GET /projects/:id/dashboard
- ❌ GET /projects/:id/activity
- ❌ POST /projects/:id/ai/workflow
- ❌ POST /projects/:id/ai/classify-ticket
- ❌ GET /projects/:id/milestones
- ❌ GET /projects/:id/risks

---

### 3. Role-Based Access Control (current)

| Action | EMPLOYEE/INTERN | TEAM_LEAD | MANAGER | ADMIN | SUPER_ADMIN |
|---|---|---|---|---|---|
| View project list | Own member-of only | Dept + member-of | Managed depts + member-of | All | All |
| View project detail | Own member-of | Dept + member-of | Managed depts + member-of | All | All |
| Create project | ❌ | ❌ | ✅ | ✅ | ✅ |
| Edit project | ❌ | ✅ (in-dept/member) | ✅ (in-dept/member) | ✅ | ✅ |
| Delete project | ❌ | ❌ | ❌ | ✅ | ✅ |
| Add/remove members | ❌ | ✅ (scoped) | ✅ (scoped) | ✅ | ✅ |

---

### 4. Frontend Routes

| Route | File | Status |
|---|---|---|
| `/projects` | `frontend/app/(dashboard)/(operations)/projects/page.tsx` | ✅ Working |
| `/projects/[id]` | `frontend/app/(dashboard)/(operations)/projects/[id]/page.tsx` | ✅ Working |

**Routes NOT present:**
- ❌ `/projects/[id]/stages`
- ❌ `/projects/[id]/timeline`
- ❌ `/projects/[id]/documents`
- ❌ `/projects/[id]/dashboard`

---

### 5. Frontend Project List (`projects/page.tsx`) — CURRENT FEATURES

✅ Project cards with: name, projectId badge, status badge, priority, health indicator
✅ Health states: Healthy / At Risk / Needs Review / No Work / Completed (computed from tickets)
✅ Member avatars (up to 4)
✅ Progress bar (done/total tickets %)
✅ Ticket counts: active, review, overdue
✅ Department and end date display
✅ Create project modal (inline form)
✅ Search + status filter
✅ Pagination (implicit via API limit)
✅ Role-based visibility of "New Project" button

---

### 6. Frontend Project Detail (`projects/[id]/page.tsx`) — CURRENT FEATURES

✅ Project header: name, projectId, status, priority, description, dates, department
✅ Edit modal (inline form: name, description, status, priority, department, endDate)
✅ Delete button (Admin+ only)
✅ Add member modal (user select + role assignment)
✅ Remove member button
✅ Linked tickets list (TicketRow component, sorted by createdAt desc)
✅ Activity feed (from global eventsApi, filtered client-side by project)
✅ Progress stats (total/done/open counts from backend)
✅ Breadcrumb navigation

**Missing from detail:**
- ❌ Stages tab / lifecycle view
- ❌ Timeline / Gantt view
- ❌ Documents tab
- ❌ Performance dashboard
- ❌ Milestone tracking
- ❌ Project-specific activity (uses global events + client filter)
- ❌ Stage-based ticket grouping
- ❌ Risk management

---

### 7. Tests

**Backend:** `backend/test/unit/p0.project-access.spec.ts`
- Project access and CUID routing tests
- No stage/document/timeline tests (those models don't exist)

**Frontend:** No frontend tests for project pages

---

### 8. Summary of Current State

| Area | State |
|---|---|
| Project CRUD | ✅ Complete |
| Member management | ✅ Complete |
| Ticket linking | ✅ Read-only (link via ticket creation) |
| Progress tracking | ✅ Auto-computed (done tickets / total) |
| Health indicators | ✅ Computed client-side |
| Activity logging | ✅ Via global OperationalEvent |
| RBAC | ✅ Well-implemented |
| Project stages | ❌ Not implemented |
| Project timeline | ❌ Not implemented |
| Project documents | ❌ Not implemented |
| Project dashboard | ❌ Not implemented |
| Milestones | ❌ Not implemented |
| AI features | ❌ Not implemented |
| Multi-step creation | ❌ Single form, no steps |
