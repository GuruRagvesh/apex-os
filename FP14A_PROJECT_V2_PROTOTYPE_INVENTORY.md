# FP-14A — PROJECT MODULE V2 — PROTOTYPE INVENTORY
**Date:** 2026-06-02
**Source:** Intern-built Vite/React prototype (external repo, not present in nexus-app)
**Note:** Prototype uses localStorage + mock data + no Apex auth. All features below are UI/UX references — none are production-ready.

---

## PROTOTYPE ARCHITECTURE (known limitations)

| Aspect | Prototype | Required for Apex |
|---|---|---|
| Framework | Vite + React | Next.js App Router |
| Persistence | localStorage | Prisma + PostgreSQL |
| Auth | None / hardcoded | JWT + Apex RBAC |
| Data | Mock/hardcoded | Real API |
| Uploads | Simulated | Cloudinary / DB fallback |
| AI | Express helper patterns | NestJS module |
| Users | Hardcoded names | Real `User` records |

---

## FEATURE INVENTORY BY CATEGORY

---

### 1. Project Portfolio / List
**Prototype behavior:** Grid of project cards with visual status indicators, progress rings, team member avatars, health badges, priority labels, department tags. Filter bar with status/department/search.

**Classification:** **Strong candidate for Apex integration — UI-only improvement**
- Current Apex list already has most of this; visual polish from prototype is adoptable
- No new backend work required for base list
- Health/progress logic already exists in Apex

---

### 2. Multi-Step Project Creation Modal
**Prototype behavior:** 3-step wizard: (1) Basic info (name, description, priority, status), (2) Team assignment (select members + roles), (3) Initial stages/milestones setup.

**Classification:** **Needs backend support (stages/milestones), UI improvement for base fields**
- Steps 1-2: Can be built now (no new backend needed)
- Step 3: Requires `ProjectStage` model — future phase

---

### 3. Project Registry / Detail Page
**Prototype behavior:** Rich header (logo, status, health indicator, completion %, date range), tabbed navigation (Overview, Tickets, Lifecycle, Timeline, Dashboard, Documents, Activity), project description, key stats cards.

**Classification:** **Strong candidate — needs tabbed layout + new backend endpoints for non-overview tabs**
- Overview tab: Can be built now
- Other tabs: Each requires backend work

---

### 4. Project Members / Departments
**Prototype behavior:** Member list with role badges (Owner, Lead, Developer, Reviewer), inline role change, remove member, invite modal with department filter.

**Classification:** **Partial — current Apex has add/remove. Role change endpoint missing.**
- Current: add/remove ✅
- Missing: PATCH /projects/:id/members/:userId (role update)
- Role enum/type standardization needed

---

### 5. Project Tickets Workspace
**Prototype behavior:** Kanban-style board grouped by project stage (not ticket status). Drag tickets between stages. Filter by assignee/status. Create ticket directly in stage context.

**Classification:** **Needs backend support — ProjectStage model + stage-aware ticket filtering**
- Stage-grouped view requires `ProjectStage` model
- Stage-aware ticket drag requires new API
- Currently Apex shows flat ticket list in project detail

---

### 6. Ticket Detail Inside Project
**Prototype behavior:** Full ticket detail accessible from project context. Shows which stage ticket belongs to. Stage assignment UI.

**Classification:** **Partial — current Apex ticket detail loads from project context. Stage field missing.**
- Ticket detail already works from project context (via `?from=project&projectId=...`)
- Stage assignment on ticket requires `Ticket.projectStageId` field

---

### 7. Project Lifecycle Roadmap
**Prototype behavior:** Linear stage visualization showing project phases (e.g., Discovery → Design → Development → Testing → Deployment). Each stage shows status (planned/active/completed), ticket count, assignees, date range.

**Classification:** **Needs backend + DB — ProjectStage model required**
- Requires `ProjectStage` model (id, projectId, name, order, status, startDate, endDate, color)
- New endpoints: GET/POST/PATCH /projects/:id/stages

---

### 8. Stage Management
**Prototype behavior:** Add/edit/delete stages, reorder stages via drag, set stage dates and owners, assign tickets to stages.

**Classification:** **Needs backend + DB — ProjectStage CRUD**
- Same `ProjectStage` model as lifecycle roadmap
- Stage reorder (order field) + ticket-to-stage assignment

---

### 9. Stage Timeline / Gantt View
**Prototype behavior:** Horizontal Gantt chart showing stages as bars on a time axis. Milestones as diamond markers. Zoom level selector (week/month/quarter).

**Classification:** **Complex — needs ProjectStage + ProjectMilestone models + frontend Gantt library**
- Highest technical complexity of all features
- Frontend: requires Gantt library (react-gantt-chart or similar)
- Backend: stage dates + milestones needed
- Recommend: Future phase (FP-14F)

---

### 10. Project Dashboard / Performance
**Prototype behavior:** Project-specific KPI cards (velocity, completion rate, blocked %, review cycle time). Charts for ticket trends within project. Member contribution breakdown.

**Classification:** **Needs backend analytics per project**
- Extend analytics endpoints with `projectId` scope
- Ticket time logs can be filtered by `ticket.projectId`
- Shares infrastructure with FP-13.3 analytics
- Frontend: reuse analytics MetricCard components

---

### 11. Project Documents
**Prototype behavior:** File list with upload button, document type categorization (Spec, Design, Meeting Notes, Other), download and delete. Preview for images/PDFs.

**Classification:** **Needs backend + DB + storage**
- Requires `ProjectDocument` model
- Storage: Cloudinary or DB fallback (same pattern as ticket attachments)
- New endpoints: GET/POST/DELETE /projects/:id/documents

---

### 12. Project Activity History
**Prototype behavior:** Timeline of project events (stage changes, member joins, ticket moves, document uploads, status changes). Filterable by event type.

**Classification:** **Partial — uses global OperationalEvent, needs project-scoped filter endpoint**
- All project events are already logged to `OperationalEvent`
- Missing: dedicated `/projects/:id/activity` endpoint that filters by `entityId=projectId`
- This is a **quick win** — only needs a new endpoint that queries existing data

---

### 13. AI Workflow Generation
**Prototype behavior:** "Generate workflow" button → AI analyzes project name/description and suggests a set of stages + initial tickets. Editable before applying.

**Classification:** **Future phase (FP-14J) — requires OpenAI + new NestJS AI module method**
- OpenAI already configured (OPENAI_API_KEY in .env)
- Existing `ai.service.ts` pattern can be extended
- Risk: AI hallucination of stage names/tickets — requires careful UX guardrails
- Recommend: POST /projects/:id/ai/workflow (returns suggestions only, not auto-applied)

---

### 14. AI Ticket-Stage Classification
**Prototype behavior:** AI assigns incoming tickets to the most appropriate project stage based on ticket title/description/type.

**Classification:** **Future phase (FP-14J) — complex + risk**
- Requires stage context to classify against
- Risk of misclassification affecting real workflow
- Should be opt-in/suggestion-only, not automatic

---

### 15. UI/UX Components / Design Language
**Prototype behavior:** Dark-mode-ready cards, progress rings, health badges, Gantt bars, stage chips, role badges, timeline connector lines, section dividers.

**Classification:** **Selective adoption**
- Visual concepts (health badges, stage chips, role color-coding) = adopt gradually
- Full design system = must match Apex OS CSS variables and component patterns
- Cannot copy Vite/React components directly — must be rewritten for Next.js + Apex design system

---

### 16. Mock/Simulated-Only Behavior (REJECT)

These prototype behaviors are hardcoded mocks with no real equivalent:

| Feature | Why Reject |
|---|---|
| Hardcoded user names / avatars | Real users come from `User` model |
| Simulated file downloads | Real files need Cloudinary or DB blob |
| localStorage project state | No real persistence |
| Fake date/progress data | Must come from real DB |
| Instant AI responses | Real AI has latency + failure modes |
| Drag-drop with mock state | Must use real PATCH endpoints |

---

## PROTOTYPE FEATURE CLASSIFICATION SUMMARY

| Category | Classification | Priority |
|---|---|---|
| Project portfolio cards (visual) | UI improvement | P3 |
| Multi-step creation (steps 1-2) | UI improvement | P2 |
| Multi-step creation (step 3 — stages) | Needs backend | P2 |
| Project registry / tabbed detail | Needs backend per tab | P1 |
| Member role change | Needs 1 endpoint | P2 |
| Tickets workspace (flat list) | Already exists | — |
| Tickets workspace (stage-grouped Kanban) | Needs ProjectStage | P2 |
| Lifecycle roadmap | Needs ProjectStage | P1 |
| Stage management | Needs ProjectStage | P1 |
| Stage timeline / Gantt | Needs library + DB | P3 |
| Project dashboard | Needs analytics endpoint | P2 |
| Project documents | Needs DB + storage | P2 |
| Project activity (scoped) | Quick win (1 endpoint) | P1 |
| AI workflow generation | Future | FUTURE |
| AI ticket classification | Future | FUTURE |
| Mock-only behaviors | Reject | — |
