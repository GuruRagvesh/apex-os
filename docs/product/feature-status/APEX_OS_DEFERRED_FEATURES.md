# APEX OS — DEFERRED / NOT-IN-DELIVERY FEATURES
**Date:** 2026-06-02 | `main` @ `7f1c8fb`

Features intentionally NOT part of this delivery, or built but dormant.

---

## 1. BACKEND-ONLY (built, no UI yet) — DEFER

| Feature | Backend | Why deferred | Recommendation |
|---|---|---|---|
| Project Stages (CRUD/reorder) | `/projects/:id/stages*` (5 endpoints, 26 tests) | FP-14B added backend; FP-14C UI shell not built | Defer — endpoints dormant, harmless. Build UI in FP-14C. |
| Project Archive/Restore | `PATCH /projects/:id/archive,/restore` | Same — no UI button yet | Defer — dormant. |
| Ticket ↔ project-stage assignment | `projectStageId` filter + validation | No stage Kanban UI | Defer with stages. |

> These are safe to leave deployed: they require authenticated TL+/MANAGER+ calls and have no UI entry point, so end users won't hit them accidentally.

---

## 2. CONFIG-GATED (built, disabled without keys) — DEFER until configured

| Feature | Gate | Status |
|---|---|---|
| AI suggest-priority / summarize-tickets / ticket-suggestions | `OPENAI_API_KEY` (placeholder) | Endpoints exist; return errors/disabled without key. **Hide AI UI panel before delivery** unless key is set. |
| AI daily digest cron | `OPENAI_API_KEY` + cron keepalive | Dormant. |
| Cloudinary file storage | `CLOUDINARY_*` (placeholders) | Falls back to base64-in-DB. Functional but not production-grade. |
| Email (Resend) | `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | OTP + transactional email inert without it. |

---

## 3. PLACEHOLDER DATA (honest "no data yet")

| Feature | Placeholder | Note |
|---|---|---|
| Manager employee/reviewer rankings | `[]` from backend | UI shows "No ranking data yet — scoring algorithm pending." Not fake. |
| Rework "most reworked" lists | `[]` | UI shows "No rework data yet." |
| Manager `averageTurnaroundTime` | `0` | Backend placeholder. |

---

## 4. INTENTIONAL REDIRECTS / THIN ENDPOINTS

| Feature | Behavior |
|---|---|
| `/reports` page | Redirects to `/analytics` (Reports was merged into Analytics). Intentional. |
| `POST /team/request` | Single thin endpoint; team module is minimal. Keep but monitor. |

---

## 5. NOT BUILT (explicitly out of scope — confirmed absent)

| Area | Status |
|---|---|
| CRM module | ❌ Not built. Out of scope. Not in delivery. |
| HRMS expansion (payroll runs, attendance regularization workflows beyond current) | ❌ Profile has payroll *fields* (sensitive, masked) but no payroll *processing*. Not in delivery. |
| Advanced AI workflow generation (Project V2 prototype concept) | ❌ Prototype-only concept; not integrated. Deferred to future FP-14J. |
| Project Gantt / timeline view | ❌ Not built (FP-14F future). |
| Project documents UI | ❌ Not built (FP-14H future). |
| Frontend automated tests | ❌ Zero frontend test files. Manual QA required (see checklist). |
| Refresh-token / token blacklist | ❌ Stateless JWT only; logout is client-side. |

---

## DELIVERY GUIDANCE

- **Hide before delivery (if keys absent):** AI panel/buttons in ticket detail.
- **Leave dormant (safe):** Project stages/archive backend endpoints.
- **Document as "coming soon":** Project Gantt, documents, AI workflow.
- **Do not advertise:** CRM, HRMS payroll processing — not built.
