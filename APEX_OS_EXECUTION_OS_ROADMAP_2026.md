# Apex OS → Enterprise Execution OS — Phased Roadmap (2026-08-02)

Companion to `APEX_OS_COMPLETE_PROJECT_AUDIT_2026.md` (full evidence) and `FEATURE_CONNECTION_MATRIX_2026.md` (quick-reference status). This document is the actionable, standalone roadmap.

**Sequencing principle:** fix trust and access-control gaps *before* extending the data model, extend the data model *before* adding new external-facing modules (CRM), and build AI-layer features last, once everything underneath is trustworthy. Every phase below builds on the one before it — do not skip ahead.

---

## Phase A — Stabilize Trust

**Objective:** Close every confirmed data-scoping and data-safety gap. Zero new features in this phase.

**Why now:** Three confirmed, evidence-backed findings exist today — one Critical, one High, one Medium-High. None require a schema change. All three get more expensive to have missed the longer they sit, because every later phase either touches the same code paths or adds new data that inherits the same gaps.

**Dependencies:** None.

**Exact features:**
1. Add a `NODE_ENV`/`APP_ENV` production guard to `backend/prisma/seed.ts` and `backend/prisma/seed-test-users.ts`. This is a same-day fix and should land first, alone, ahead of everything else in this phase.
2. Fix `DashboardService.getApprovalWorkload()` — scope the pending-review count through `buildTicketWhereForUser` (or equivalent) instead of an unfiltered `prisma.ticket.count()`.
3. Scope `EventsGateway.emitTicketCreated()` / `emitTicketStatusChanged()` to department/role-relevant Socket.IO rooms, matching the REST-layer visibility rules already correctly implemented in `ticket-access.service.ts`.
4. Add a linked-ticket safety check to `ProjectsService.remove()`, mirroring the existing (and correct) pattern in `deleteStage()`.
5. Fix the 5 pre-existing failing backend test suites so the baseline is genuinely green before layering more work on top: `tva-date-authority.spec.ts`, `tva-sla-authority.spec.ts`, `analytics.spec.ts` (clock-dependent), `ticket-ledger.service.spec.ts` (self-contradictory mock), `ticket.guardrails.spec.ts` (stale call signature, TS compile error).
6. Confirm Cloudinary is actually configured in the production environment (attachment base64-in-DB fallback risk).
7. Confirm the 3 OneDrive environment variables and target folder exist in production (the known backup-vault "404" is very likely this, not a code defect — verified this audit).

**Risk:** Low. Every item is additive or corrective, none touch the ticket/workday/hierarchy logic that this project has spent the most effort getting right.

**Acceptance criteria:**
- Running the seed script outside an explicitly-allowed environment throws immediately, before any delete executes.
- A Manager/Team Lead viewing their dashboard sees a pending-review count that matches their own department, verified by a new regression test.
- A user connected via WebSocket in Department X does not receive `ticket:created`/`ticket:status_changed` events for a ticket created in Department Y they have no access to.
- `npm run build` clean on both frontend and backend; full backend test suite green, zero known failures.

---

## Phase B — Complete Execution Core

**Objective:** Finish what's already 80-100% built on the backend and simply missing a frontend.

**Why now:** Building new frontend surface on top of a *fixed* trust foundation (Phase A) is low-risk and high-value — this phase is pure "finish the job," not new design.

**Dependencies:** Phase A (don't ship new UI reading from endpoints that still have open scoping questions).

**Exact features:**
1. Build the ProjectStage / milestone frontend UI on the project detail page. The backend (`listStages`/`createStage`/`updateStage`/`deleteStage`/`reorderStages`, with delete-protection against linked tickets) is fully built and tested (`fp14b.project-stages.spec.ts`, 283 lines) — this is a pure frontend task.
2. Build a real "time worked" display on the ticket detail page, sourced from the now-correctly-populated `TicketTimeLog` data (this session's ledger-wiring fix). Note: `getTicketTimers()` in `ticket-ledger.service.ts` currently has zero real callers — either wire it into `findOne()`'s response or compute the display from a fresh, simple aggregation; don't assume the existing method is already wired anywhere.
3. Spend a short, dedicated pass reading `calendar/page.tsx` and `settings/page.tsx` in full — both are non-trivial in size (149 and 1671 lines respectively) and were not deep-audited this pass. Confirm their actual connection status before either is assumed complete or assumed broken.

**Risk:** Low.

**Acceptance criteria:** A Manager can create/reorder/complete project stages from the UI. A user viewing a ticket they've worked on sees actual elapsed worked time, not just the SLA countdown. Calendar and Settings have a confirmed status in the feature matrix (no more ❓).

---

## Phase C — Multi-Membership Foundation

**Objective:** Make "one user can belong to multiple departments" and "multiple teams" real in the access-control logic, not just the schema.

**Why now:** `UserDepartmentMembership` already exists as a model but is not wired into ticket, leave, or project access logic anywhere confirmed this audit. This is the actual blocker behind business-model assumptions #5 and #6, and it's a prerequisite for making Department Head/Team Lead "accountability" (#7/#8) meaningful — you can't cleanly attribute KRA ownership to a department if a user's department membership itself isn't multi-valued in the places that matter.

**Dependencies:** Phase A. Do not migrate access logic that's still sitting on unconfirmed/unfixed scoping bugs — fix the *current* single-department model's known issues first, so the multi-membership version isn't inheriting them.

**Exact features:**
1. Wire `UserDepartmentMembership` into `buildTicketWhereForUser`, `LeaveAccessService`, and project access scoping — a user should see tickets/leave/projects across every department they're a member of, not just `User.departmentId`.
2. Extend the same treatment to multi-team membership wherever `TeamMember` already exists but access logic doesn't consult it.
3. Safe, non-destructive backfill: every existing `User.departmentId` becomes exactly one row in `UserDepartmentMembership`. Write this as a script with a dry-run mode and verify row counts match before and after.
4. Build a membership-management UI (add/remove a user's department and team memberships).

**Risk:** Medium — this phase touches the most security-sensitive scoping code in the application. Apply the same rigor this session's QUERY/HELP routing work used: audit first, smallest safe change, tests before and after, verify with `git diff` exactly what changed.

**Acceptance criteria:** A user assigned to two departments correctly sees tickets/leave/projects from both, verified by new tests. A user assigned to exactly one department (today's default for everyone) sees zero behavior change, verified by re-running every existing access-control test suite unmodified.

---

## Phase D — Analytics Foundation

**Objective:** Move from "good per-entity metrics" (already true today) to genuine company-wide process intelligence.

**Why now:** Phases A-C fix the trust and access-model gaps that analytics currently inherits — a multi-department rollup is only honest once multi-department access itself is real.

**Dependencies:** Phase C, ideally — company/department rollups are more meaningful once a user's real department footprint is multi-valued.

**Exact features:**
1. Fill in the two confirmed placeholder ranking queries — "most reworked employees/types" (Rework tab) and employee/reviewer rankings (Team tab) — both currently return hardcoded empty arrays in the backend service itself.
2. Build company/department/team/project rollup dashboards using the `AnalyticsService` pattern already established (scoped Prisma aggregation, real SLA-config lookups via `TicketTimingService`) — extend it, don't replace it.
3. Add process-bottleneck detection: where does work actually stall, across departments, not just within one.
4. Add a project-metrics scoping audit — `ProjectsService.getStats()` exists but wasn't scoping-verified this pass.

**Risk:** Low-Medium.

**Acceptance criteria:** No analytics endpoint returns a hardcoded empty array. A multi-department user sees correctly-aggregated cross-department numbers, not just their "primary" department's.

---

## Phase E — CRM Foundation

**Objective:** Bring in the "work in" side of Enterprise Execution OS — leads, clients, deals.

**Why now — deliberately not sooner:** Zero CRM code exists today (confirmed by exhaustive search). CRM introduces a genuinely new data-sensitivity class — external client/deal data — on top of a system that, as of this audit, has *just* closed two confirmed internal department-boundary leaks. Sequence this after Phase A is non-negotiable; sequencing it after Phase C is strongly recommended, because "won deal → project" is only an honest conversion if a project can actually represent the departments doing the resulting work (Phase C's multi-membership work is a natural precursor to a future multi-department project model, even though that specific schema change isn't in this roadmap's named phases — flag it as a likely Phase E sub-task if deals routinely span departments).

**Dependencies:** Phase A (hard requirement). Phase C (strongly recommended).

**Exact features:**
1. `Lead`, `Company`/`Client`, `Contact`, `Deal`/`Opportunity` models — new, no reuse of existing models attempted (they represent genuinely different entities from `User`/`Department`).
2. Deal pipeline stages — consider reusing the *pattern* established by `ProjectStage` (ordered, status-tagged, with delete-protection against linked records) rather than inventing a new pattern.
3. `Proposal`/`Quote` model.
4. Won-deal-to-project conversion endpoint — `Project` already has the right shape to receive this (add a `dealId` reference).
5. CRM-activity-generated follow-up tickets — reuse this session's QUERY/HELP cross-department routing work as the design template for "a request that originates outside the normal ticket-creation flow but still needs correct department/role routing."
6. Sales analytics, following the same `AnalyticsService` pattern as Phase D.

**Risk:** Medium-High — new external-data surface, needs its own access-control audit from day one, not an afterthought.

**Acceptance criteria:** A deal can be created, won, and converted to a project; the resulting tickets are correctly department-scoped from creation, not scoped as an afterthought.

---

## Phase F — HRMS/Performance Foundation

**Objective:** Build the KRA/KPI layer that does not exist in any form today.

**Why now:** This is a genuine from-scratch build — there is no partial implementation to extend (`ReviewCycleLog` is ticket-specific, not a general performance-review system). Sequenced after CRM in this roadmap as a product-priority choice, not a hard technical dependency — the real technical dependency is Phase C, because Department Head/Team Lead "ownership" of a KRA is only as meaningful as the underlying multi-membership and department-scoping model.

**Dependencies:** Phase C (hard requirement for KRA ownership to be unambiguous). Phase A (hard requirement, as always).

**Exact features:**
1. `KRA`/`KPI` models, with clear ownership (Department Head, Team Lead, or individual).
2. Employee profile completion features beyond what exists (the underlying `User` model and document-management are already strong — this is about the performance-specific layer on top).
3. Review cycles distinct from ticket `ReviewCycleLog` — a genuine periodic performance-review workflow, not ticket-approval ratings.
4. Performance analytics, following the `AnalyticsService` pattern again.

**Risk:** Medium — this is sensitive data (performance scores) and needs access-control rigor from the first commit, matching the standard this project's own ticket-permission work has already set. Do not repeat the class of mistake found in the dashboard/WebSocket findings — audit scoping before shipping, not after.

**Acceptance criteria:** A Department Head can set and track a KRA independent of any single ticket's approval history, correctly scoped to only the department(s) they actually head.

---

## Phase G — AI Layer

**Objective:** Scoped intelligence on top of a now-trustworthy, now-complete data model.

**Why now — deliberately last:** An AI summary or recommendation is only as trustworthy as the scoping of the data it reads. Every phase above exists, in part, to make that data trustworthy before AI features aggregate across it. This is also the phase with the *least* net-new foundational work required — this audit found AI is already a real, working GPT-4o-mini integration (priority suggestion, ticket summarization, per-ticket suggestions, daily digest), not a stub. Phase G is about *extending* that proven integration across the newly-built CRM/HRMS data, not building AI infrastructure from scratch.

**Dependencies:** Ideally all of A-F have their access-control fixed — AI features are exactly the kind of feature that can accidentally aggregate/leak cross-boundary data if the underlying queries aren't already correctly scoped, because summarization naturally pulls from many records at once.

**Exact features:**
1. Extend the existing AI service pattern to CRM data (deal summaries, lead scoring suggestions) once Phase E exists.
2. Extend to HRMS/performance data (review-cycle summarization, KRA progress narratives) once Phase F exists.
3. Process intelligence — surface the Phase D bottleneck-detection output as natural-language insight, not just a chart.
4. Leadership insights — company-wide narrative summaries, correctly scoped to what that specific leader is actually allowed to see.

**Risk:** Medium — entirely dependent on the rigor of what it's built on. Low incremental risk if Phases A-F are done properly; high risk if this phase is pulled forward.

**Acceptance criteria:** Every AI-surfaced insight can be traced back to a correctly-scoped underlying query — no insight should ever be able to say something about data the requesting user couldn't see directly.

---

## Cross-phase notes

- **Do not build Phase E or F work in parallel with Phase A being incomplete.** This is the single most important sequencing rule in this roadmap — it is tempting to start CRM or HRMS schema design "in the background" while trust fixes land, but both new modules will need to re-litigate the same access-control questions Phase A is meant to settle once, and doing that twice is more expensive than doing Phase A first.
- **Phase C is the hinge phase.** It's the one piece of foundational work that materially de-risks both Phase E (honest multi-department deal-to-project conversion) and Phase F (unambiguous KRA ownership). If only one "big" phase can be prioritized after Phase A/B, make it Phase C.
- **Every phase should add tests before claiming done**, matching the standard this project already holds itself to in the ticket subsystem (46 unit test suites, heaviest coverage exactly where the business logic is most complex). Frontend currently has zero test coverage of any kind — this is a standing gap across every phase, not specific to any one of them, and is worth a dedicated decision (adopt a frontend testing strategy) independent of the phase sequencing above.
