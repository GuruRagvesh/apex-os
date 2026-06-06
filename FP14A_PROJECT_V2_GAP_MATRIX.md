# FP-14A — PROJECT MODULE V2 — GAP MATRIX
**Date:** 2026-06-02

| # | Feature | Prototype Behavior | Current Apex | Gap | Backend Work | Frontend Work | DB Work | RBAC Work | Tests | Priority | Phase |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Project list cards | Rich cards: health badges, progress rings, member avatars, department tag | ✅ Has cards with health, progress, members | Minor visual polish only | None | Cosmetic only | None | None | None | P3 | FP-14C |
| 2 | Project list filters | Status / dept / search + URL-state | ✅ Has search + status filter | URL-state persistence for filters | None | Small | None | None | None | P3 | FP-14C |
| 3 | Multi-step create modal (basic) | Step 1: name/desc/priority/status, Step 2: members | Single-form modal | UX improvement; no backend change | None | Replace modal | None | None | FE build | P2 | FP-14C |
| 4 | Multi-step create modal (stages) | Step 3: initial stages setup | Not present | Requires stage model | CRUD stages | Modal step 3 | ProjectStage | TL+ | Unit + E2E | P2 | FP-14E |
| 5 | Tabbed project detail page | Tabs: Overview / Tickets / Lifecycle / Timeline / Dashboard / Documents / Activity | Single-page with edit/members/tickets/activity | Tab shell needed; each tab backed by different endpoints | Varies per tab | Tab shell | None | None | None | P1 | FP-14C |
| 6 | Member role change (inline) | Click role badge to change role | Add/remove only | PATCH /projects/:id/members/:userId missing | Add PATCH endpoint | Inline edit UI | None | TL+ | Unit test | P2 | FP-14B |
| 7 | Project-scoped activity feed | Dedicated project activity timeline, filterable | Global eventsApi filtered client-side | Scoped endpoint missing | GET /projects/:id/activity | Replace client filter | None | Scoped | Unit test | P1 | FP-14B |
| 8 | Project progress stats (rich) | Velocity, completion rate, per-member stats | Counts only (total/done/open) | Richer stats needed | GET /projects/:id/dashboard | Dashboard tab | None | Scoped | Analytics tests | P2 | FP-14G |
| 9 | Project lifecycle / stages view | Linear stage visualization: Discovery → Design → Dev → Test → Deploy | Not present | ProjectStage model + endpoints + UI | Full stage CRUD | Lifecycle tab | ProjectStage | TL+ | Unit + FE | P1 | FP-14E |
| 10 | Stage management (CRUD) | Add/edit/delete/reorder stages | Not present | Same as above | CRUD + reorder | Management UI | ProjectStage | TL+ | Unit test | P1 | FP-14E |
| 11 | Stage-grouped ticket Kanban | Tickets grouped by project stage, draggable | Flat ticket list | Requires Ticket.projectStageId | Add field + filter endpoint | Kanban view | Ticket.projectStageId | Scoped | Unit test | P2 | FP-14D |
| 12 | Ticket-to-stage assignment | Drag ticket into stage column | Not present | Same as stage-grouped kanban | PATCH /tickets/:id stage field | Drag-drop | Ticket.projectStageId | TL+ | Unit test | P2 | FP-14D |
| 13 | Timeline / Gantt view | Horizontal Gantt: stages as bars, milestones as markers | Not present | Requires stage dates + milestones + Gantt lib | Stage dates API | Gantt library | ProjectMilestone | View-only | Manual | P3 | FP-14F |
| 14 | Project milestones | Milestone markers on timeline | Not present | Requires ProjectMilestone model | CRUD milestones | Milestone UI | ProjectMilestone | TL+ | Unit test | P3 | FP-14F |
| 15 | Project documents tab | File list, upload, download, delete, categorized | Not present | Requires ProjectDocument + storage | GET/POST/DELETE /projects/:id/documents | Documents tab | ProjectDocument | TL+ | Unit test | P2 | FP-14H |
| 16 | Project dashboard / performance | Project-specific KPI cards, ticket trends within project | Not present | Extend analytics with projectId scope | GET /analytics/project/:id | Dashboard tab | None (uses existing) | Scoped | Analytics unit | P2 | FP-14G |
| 17 | AI workflow generation | Generate stages + tickets from project description | Not present | New NestJS AI method | POST /projects/:id/ai/workflow | Generation modal | None | Manager+ | None yet | FUTURE | FP-14J |
| 18 | AI ticket classification | AI assigns ticket to stage | Not present | New NestJS AI method | POST /projects/:id/ai/classify-ticket | Classify button | None | TL+ | None yet | FUTURE | FP-14J |
| 19 | Project health snapshot history | Historical health score timeline | Not present | Requires scheduler + snapshot model | Cron + snapshot | Health chart | ProjectHealthSnapshot | Admin | None yet | P3 | FUTURE |
| 20 | Project risks | Risk register with likelihood/impact | Not present | New model | Risk CRUD | Risk tab | ProjectRisk | TL+ | Unit | FUTURE | FUTURE |
| 21 | Archive project (vs delete) | Soft-archive that preserves data | Only hard delete | Add ARCHIVED status + archive endpoint | PATCH /projects/:id/archive | Archive button | None (add enum value) | Admin | Unit | P2 | FP-14B |
| 22 | Project ID in ticket filter | Filter tickets by projectId in all ticket list/kanban views | Partial | Ticket list already accepts projectId query | None needed | Ticket list filter | None | Scoped | None | P2 | FP-14C |

---

## PRIORITY BREAKDOWN

| Priority | Count | Items |
|---|---|---|
| P0 (blocking) | 0 | Current module is functional |
| P1 (essential enterprise) | 4 | Tabbed detail, project activity endpoint, stages/lifecycle, stage management |
| P2 (valuable) | 10 | Create modal upgrade, member role change, stage kanban, documents, dashboard, archive |
| P3 (polish) | 4 | List polish, filter URL state, Gantt, milestone |
| FUTURE | 4 | AI features, health snapshots, risks |
