# FP-14A — PROJECT MODULE V2 — IMPLEMENTATION ROADMAP
**Date:** 2026-06-02

---

## PHASE OVERVIEW

```
FP-14B  Backend Foundation          ← Start here
FP-14C  UI Shell + Registry         ← Parallel candidate after FP-14B
FP-14D  Tickets Workspace           ← Depends on FP-14B (stage model)
FP-14E  Lifecycle + Stages          ← Depends on FP-14B + FP-14D
FP-14F  Timeline / Gantt            ← Depends on FP-14E
FP-14G  Project Dashboard           ← Parallel after FP-14B
FP-14H  Documents + Storage         ← Independent after FP-14B migration
FP-14I  Project Activity Log        ← Quick win, can start now
FP-14J  AI Features                 ← Future, after everything above
```

---

## FP-14B — PROJECT BACKEND + DATA FOUNDATION

**Scope:** Database migrations + essential new API endpoints that everything else depends on.

**Files touched:**
- `backend/prisma/schema.prisma` — add `ProjectStage`, `ProjectMemberRole` enum, `ARCHIVED` status, `Ticket.projectStageId`
- `backend/prisma/migrations/` — new migration file
- `backend/src/modules/operations/projects/projects.service.ts` — add stage CRUD, activity, member role update, archive
- `backend/src/modules/operations/projects/projects.controller.ts` — new endpoints
- `backend/test/unit/p0.project-access.spec.ts` — extend tests

**New endpoints:**
- PATCH /projects/:id/members/:userId (role update)
- GET /projects/:id/activity (scoped events — quick win)
- GET/POST/PATCH/DELETE /projects/:id/stages
- PATCH /projects/:id/stages/reorder
- PATCH /projects/:id/archive
- PATCH /projects/:id/restore

**DB migration required:** YES — ProjectStage, Ticket.projectStageId, enum changes
**Tests required:** Unit tests for all new service methods
**Risk:** LOW-MEDIUM (migration is additive, existing data unaffected)
**Expected output:** Full API foundation ready for all subsequent phases

---

## FP-14C — PROJECT UI SHELL + REGISTRY UPGRADE

**Scope:** Frontend restructure — tabbed layout, multi-step create modal, improved list. No new endpoints needed beyond FP-14B.

**Files touched:**
- `frontend/app/(dashboard)/(operations)/projects/page.tsx` — enhanced list, create modal upgrade
- `frontend/app/(dashboard)/(operations)/projects/[id]/page.tsx` — tab shell with Overview, Tickets, Lifecycle, Documents, Activity tabs
- `frontend/lib/api.ts` — add projectsApi methods for stages, activity, archive

**Tab shell (FP-14C):**
- Overview tab: current detail (edit form, members, progress stats, department)
- Tickets tab: current ticket list + move from overview
- Lifecycle tab: **placeholder** (FP-14E)
- Documents tab: **placeholder** (FP-14H)
- Activity tab: **uses new scoped endpoint** from FP-14B

**Multi-step create modal:**
- Step 1: Name, description, priority, status, department, dates
- Step 2: Add initial members (search + role selection)
- (Step 3 — stages — added in FP-14E)

**DB migration required:** NO
**Tests required:** tsc + build only
**Risk:** LOW (UI-only, existing functionality preserved)
**Expected output:** Professional tabbed project detail page

---

## FP-14D — PROJECT TICKETS WORKSPACE

**Scope:** Stage-aware ticket view inside project. Requires `Ticket.projectStageId` from FP-14B.

**Files touched:**
- `frontend/app/(dashboard)/(operations)/projects/[id]/page.tsx` — Tickets tab with stage grouping
- `backend/src/modules/operations/tickets/tickets.service.ts` — filter tickets by stageId
- `backend/src/modules/operations/tickets/tickets.controller.ts` — add stageId to query

**Features:**
- Group tickets by project stage within the project Tickets tab
- "No stage" group for unassigned tickets
- Inline ticket-to-stage assignment (drag or dropdown)
- Create ticket with default stage pre-selected

**DB migration required:** NO (uses field from FP-14B)
**Tests required:** Unit test for stage-filtered ticket query
**Risk:** LOW-MEDIUM (modifies ticket query; existing ticket list unaffected)

---

## FP-14E — LIFECYCLE STAGES + STAGE MANAGEMENT

**Scope:** Full stage lifecycle UI — the roadmap view showing project phases.

**Files touched:**
- `frontend/app/(dashboard)/(operations)/projects/[id]/page.tsx` — Lifecycle tab
- New component: `frontend/components/projects/lifecycle-board.tsx`
- New component: `frontend/components/projects/stage-card.tsx`

**Features:**
- Linear roadmap showing stages in order
- Stage status badges (PLANNED / ACTIVE / COMPLETED / SKIPPED)
- Stage progress (tickets done / total in stage)
- Add/edit/delete stage modals
- Reorder stages via drag (dnd-kit, already installed)
- Stage date ranges

**DB migration required:** NO (uses FP-14B migration)
**Tests required:** Unit test for stage CRUD
**Risk:** LOW

---

## FP-14F — TIMELINE / GANTT VIEW

**Scope:** Horizontal Gantt chart for project timeline.

**Files touched:**
- `frontend/app/(dashboard)/(operations)/projects/[id]/page.tsx` — Timeline tab
- New component: `frontend/components/projects/gantt-view.tsx`
- Possibly: new npm package for Gantt (evaluate react-gantt-task or similar)
- `backend/src/modules/operations/projects/projects.service.ts` — timeline endpoint
- `backend/prisma/schema.prisma` + migration — `ProjectMilestone` model

**Features:**
- Stages as colored bars on time axis
- Milestones as diamond markers
- Today marker
- Zoom: week / month / quarter

**DB migration required:** YES — `ProjectMilestone`
**Tests required:** Manual verification (Gantt rendering hard to unit test)
**Risk:** MEDIUM — Gantt libraries add bundle size; requires careful date math
**Recommendation:** Evaluate whether a lightweight custom SVG implementation is better than a library

---

## FP-14G — PROJECT DASHBOARD / PERFORMANCE

**Scope:** Project-specific analytics dashboard tab.

**Files touched:**
- `backend/src/modules/platform/analytics/analytics.service.ts` — add `getProjectMetrics(projectId, user)`
- `backend/src/modules/platform/analytics/analytics.controller.ts` — GET /analytics/project/:id
- `frontend/app/(dashboard)/(operations)/projects/[id]/page.tsx` — Dashboard tab
- New component: reuse `MetricCard` from analytics page

**Features:**
- Completion rate, velocity, blocked %, SLA compliance within project
- Member contribution table (tickets completed per member)
- Ticket trend chart (created/resolved within project over time)

**DB migration required:** NO (queries existing data)
**Tests required:** Analytics unit test extension
**Risk:** LOW (extends existing analytics service)

---

## FP-14H — PROJECT DOCUMENTS + STORAGE

**Scope:** File attachments for project-level documents.

**Files touched:**
- `backend/prisma/schema.prisma` + migration — `ProjectDocument`
- `backend/src/modules/operations/projects/projects.service.ts` — document CRUD
- `backend/src/modules/platform/uploads/uploads.service.ts` — add `uploadProjectDocument()`
- `frontend/app/(dashboard)/(operations)/projects/[id]/page.tsx` — Documents tab

**Storage:** Same pattern as ticket attachments (Cloudinary if configured, base64 fallback)
**DB migration required:** YES — `ProjectDocument`
**Tests required:** Unit test for document upload/delete
**Risk:** LOW (follows existing attachment pattern exactly)

---

## FP-14I — PROJECT ACTIVITY / AUDIT LOG

**Scope:** Dedicated project activity feed tab (replaces client-side filtered global events).

**Files touched:**
- `backend/src/modules/operations/projects/projects.controller.ts` — GET /projects/:id/activity
- `backend/src/modules/operations/projects/projects.service.ts` — activity query
- `frontend/app/(dashboard)/(operations)/projects/[id]/page.tsx` — Activity tab using new endpoint

**This is a quick win** — backend just queries existing `OperationalEvent` where `entityId = project.id OR entityId IN (ticket.id WHERE ticket.projectId = project.id)`. No new model.

**DB migration required:** NO
**Tests required:** Unit test for activity query
**Risk:** VERY LOW

---

## FP-14J — AI WORKFLOW + CLASSIFICATION (FUTURE)

**Scope:** AI-assisted project setup and ticket classification.

**Depends on:** FP-14E (stage model must exist), FP-14D (ticket-stage assignment must work)

**Features:**
- POST /projects/:id/ai/workflow → OpenAI generates suggested stage names + initial ticket titles
- POST /projects/:id/ai/classify-ticket → OpenAI suggests which stage a ticket belongs to
- Both return suggestions only — user confirms before applying
- "Generated with AI" badge on AI-created items

**DB migration required:** NO
**Risk:** HIGH — AI hallucination, cost, latency, user confusion if auto-applied
**Mitigation:** Suggestion-only mode; user confirms; show confidence indicator

---

## DEPENDENCY ORDER

```
FP-14B (DB foundation + core APIs)
  ├── FP-14C (UI shell — can start immediately after FP-14B)
  ├── FP-14D (stage kanban — needs FP-14B stage model)
  │     └── FP-14E (lifecycle — needs FP-14D stage model + FP-14B CRUD)
  │           └── FP-14F (Gantt — needs FP-14E stages + new milestone migration)
  ├── FP-14G (project dashboard — needs FP-14B, can be parallel with FP-14C)
  ├── FP-14H (documents — needs FP-14B migration window)
  └── FP-14I (activity log — quick win, needs only FP-14B activity endpoint)
        └── FP-14J (AI — needs FP-14E complete, deferred)
```

---

## PHASE SUMMARY TABLE

| Phase | Scope | DB Migration | Risk | Estimated Complexity | Dependency |
|---|---|---|---|---|---|
| FP-14B | Backend + data foundation | YES (ProjectStage + fields) | LOW-MEDIUM | High | None |
| FP-14C | UI shell + tabbed layout | NO | LOW | Medium | FP-14B |
| FP-14D | Stage-aware ticket workspace | NO | LOW-MEDIUM | Medium | FP-14B |
| FP-14E | Lifecycle + stage management | NO | LOW | Medium | FP-14B + FP-14D |
| FP-14F | Timeline / Gantt | YES (Milestones) | MEDIUM | High | FP-14E |
| FP-14G | Project performance dashboard | NO | LOW | Medium | FP-14B |
| FP-14H | Documents + storage | YES (ProjectDocument) | LOW | Low-Medium | FP-14B |
| FP-14I | Project activity log (scoped) | NO | VERY LOW | Low | FP-14B |
| FP-14J | AI workflow + classification | NO | HIGH | High | FP-14E + AI config |
