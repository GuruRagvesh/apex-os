# FP-14A — PROJECT MODULE V2 — RISK ASSESSMENT
**Date:** 2026-06-02

---

## RISK REGISTER

### RISK-1 — localStorage prototype contamination
**Description:** Prototype uses localStorage for state. If any prototype component patterns are copy-pasted without stripping localStorage calls, data may appear to persist in browser but not in DB.
**Probability:** MEDIUM (easy mistake during porting)
**Impact:** HIGH (silent data loss; users think projects are saved, they aren't)
**Mitigation:**
- Strict rule: no prototype file is imported directly into Apex
- All prototype code is reference-only; every component rewritten from scratch
- Every mutation must go through `useMutation → API → backend → DB`
- Code review checklist item: search for `localStorage` in all new project code
**Priority:** P1

---

### RISK-2 — Mock data accidentally reaching production
**Description:** Prototype has hardcoded mock users, dates, ticket names. If used as seed data or fixtures during testing, fake data can appear in production.
**Probability:** LOW (careful dev practice)
**Impact:** HIGH (erodes employee trust, data integrity breach)
**Mitigation:**
- Use `STABILIZATION-TEST` prefix for any test records created
- Never run prototype seed scripts against production DB
- Production seed file (`prisma/seed.ts`) is the only authorised seeding source
**Priority:** P1

---

### RISK-3 — Route mismatch / duplicate project systems
**Description:** If V2 routes (`/projects/[id]/stages`) are added before the tab shell (FP-14C), users might reach partially-implemented pages.
**Probability:** LOW (phased approach)
**Impact:** MEDIUM (broken pages, user confusion)
**Mitigation:**
- Tab shell (FP-14C) is implemented first; placeholder tabs shown for unimplemented sections
- Each new tab shows "Coming soon" until backed by real API
- New routes are only added once the feature is complete
**Priority:** P2

---

### RISK-4 — ProjectMemberRole enum migration breaking existing string data
**Description:** Changing `ProjectMember.role` from `String` to `enum ProjectMemberRole` requires a data migration for all existing rows.
**Probability:** HIGH (existing rows have string values like "OWNER", "MEMBER")
**Impact:** MEDIUM (migration failure causes deploy rollback)
**Mitigation:**
- Run data audit first: `SELECT DISTINCT role FROM project_members`
- Map each existing value to enum before migration
- Use `prisma migrate dev --name formalize-member-role` with explicit SQL in migration
- Test on staging DB before production
- Consider keeping `String` and adding a separate `roleEnum ProjectMemberRole?` nullable field as a safer path
**Priority:** P1

---

### RISK-5 — Gantt library bundle size impact
**Description:** Gantt chart libraries tend to be large (react-gantt-task, dhtmlx-gantt). Adding one increases the `/projects/[id]` bundle significantly.
**Probability:** HIGH (Gantt = large lib)
**Impact:** LOW-MEDIUM (page load slower; not a functional issue)
**Mitigation:**
- Evaluate custom SVG/CSS Gantt implementation for simple use case
- If using library, wrap in `dynamic(() => import('...'), { ssr: false })` for code-splitting
- Check bundle size before committing. Acceptable threshold: < 50 kB added to chunk
**Priority:** P3

---

### RISK-6 — RBAC bypass in project stages
**Description:** If stage management endpoints don't re-validate project membership/scope, employees might modify stages of projects they're not in.
**Probability:** LOW (if built correctly)
**Impact:** HIGH (data integrity; cross-project data leak)
**Mitigation:**
- All stage endpoints must call `findOne(projectId, user)` first (which already enforces scope)
- Never trust client-supplied projectId without scope check
- Unit tests must cover "employee cannot manage stages of foreign project"
**Priority:** P0 (security)

---

### RISK-7 — AI hallucination of stages/tickets
**Description:** AI workflow generator might produce nonsensical stage names or ticket titles that pollute the project.
**Probability:** MEDIUM (LLMs hallucinate)
**Impact:** MEDIUM (bad UX; user sees garbage suggestions)
**Mitigation:**
- AI endpoints return suggestions only — user must explicitly click "Apply"
- Show "Generated with AI — review before applying" disclaimer
- Limit stage name length and disallow HTML in AI output (sanitize)
- Rate limit AI endpoints per project
**Priority:** P2 (FUTURE scope anyway)

---

### RISK-8 — Document storage without Cloudinary
**Description:** If Cloudinary isn't configured when documents tab is launched, all project documents fall back to base64-in-DB. Large spec PDFs could bloat the database.
**Probability:** HIGH (Cloudinary is currently unconfigured)
**Impact:** MEDIUM (DB bloat; not a data loss)
**Mitigation:**
- Same mitigation as ticket attachments: warn user in UI if Cloudinary unconfigured
- Consider enforcing file size limit at 2 MB for project docs (lower than ticket 5 MB)
- Surface explicit warning in Documents tab: "Files are stored in database. Configure Cloudinary for optimal performance."
**Priority:** P2

---

### RISK-9 — Performance: stage-grouped ticket Kanban
**Description:** Fetching all tickets grouped by stage for large projects could be slow if a project has hundreds of tickets.
**Probability:** LOW at current scale; grows with data
**Impact:** LOW-MEDIUM (slow page load)
**Mitigation:**
- Paginate tickets within each stage column (e.g., max 20 per stage)
- Add `@@index([projectStageId])` to Ticket model in schema
- Lazy-load stages rather than fetching all at once
**Priority:** P2

---

### RISK-10 — User confusion during V2 transition
**Description:** While tabs are being added phase by phase, users will see placeholder tabs ("coming soon"). This could confuse real employees.
**Probability:** MEDIUM
**Impact:** LOW (annoyance, not breakage)
**Mitigation:**
- Label placeholder tabs clearly: "Lifecycle (Coming Soon)"
- Don't add tabs that are purely empty — only add when at least loading/empty states are implemented
- Communicate to employees which features are live
**Priority:** P3

---

## RISK SUMMARY

| Risk | Probability | Impact | Priority | Phase |
|---|---|---|---|---|
| RISK-1 localStorage contamination | MEDIUM | HIGH | P1 | All phases |
| RISK-2 Mock data in production | LOW | HIGH | P1 | FP-14B |
| RISK-3 Route mismatch | LOW | MEDIUM | P2 | FP-14C |
| RISK-4 Enum migration failure | HIGH | MEDIUM | P1 | FP-14B |
| RISK-5 Gantt bundle size | HIGH | LOW-MEDIUM | P3 | FP-14F |
| RISK-6 RBAC bypass on stages | LOW | HIGH | P0 | FP-14B/E |
| RISK-7 AI hallucination | MEDIUM | MEDIUM | P2 | FP-14J |
| RISK-8 Document storage without Cloudinary | HIGH | MEDIUM | P2 | FP-14H |
| RISK-9 Stage Kanban performance | LOW | LOW-MEDIUM | P2 | FP-14D |
| RISK-10 User confusion during transition | MEDIUM | LOW | P3 | All phases |
