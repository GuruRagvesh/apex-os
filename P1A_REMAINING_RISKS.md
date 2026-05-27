# P1-A Remaining Risks

**Date:** 2026-05-27  
**Scope:** Known gaps NOT addressed in P1-A (not regressions — pre-existing or deferred)

---

## Risk 1 — isHalfDay / halfDayType: no formal migration

**Severity:** Medium  
**Detail:** The `isHalfDay` and `halfDayType` columns were added to `schema.prisma` and are live in the DB (confirmed via `prisma migrate status: up to date` and `prisma migrate diff: empty`), but no timestamped migration file was created. This means `prisma migrate deploy` on a fresh/production DB will not add these columns — only `prisma db push` or a manually created migration would.  
**Recommended fix before production deploy:** Run `npx prisma migrate dev --name add_leave_half_day` to generate and record the migration properly.

---

## Risk 2 — SLA hardcoding (pre-existing P0, deferred from P1-A)

**Severity:** High  
**Detail:** `SLA_HOURS` is still hardcoded in `tickets.service.ts`, `automation.service.ts`, `ai.service.ts`, and `ai.cron.service.ts`. The `SettingsService.getSlaHours()` method exists but is never called by ticket workflows. Admin SLA changes have no effect on ticket execution.  
**Status:** Known from feature audit; not in P1-A scope.

---

## Risk 3 — User list endpoint unauthenticated-only scope (pre-existing P0)

**Severity:** High  
**Detail:** `GET /users` is guarded by JWT only, not by role. Any authenticated employee can enumerate the full user directory.  
**Status:** Known from feature audit; not in P1-A scope.

---

## Risk 4 — Leave balance holiday list is hardcoded to 2026

**Severity:** Low  
**Detail:** `LeaveBalanceService.holidays` contains a static array of 2026 dates. In 2027+ these will be wrong.  
**Recommended fix:** Move to a DB-backed holiday table or settings-driven holiday list.

---

## Risk 5 — Notification preferences default `commentAdded: false`

**Severity:** Low  
**Detail:** `NOTIF_DEFAULTS.commentAdded = false` suppresses comment notifications by default. This means new users will not receive comment alerts until they explicitly opt in. This may be intentional (opt-in design) but should be confirmed with product.

---

## Risk 6 — Payroll/statutory masking relies on frontend logic only

**Severity:** Medium  
**Detail:** The user profile page applies masking via conditional rendering in React. If the backend `GET /users/:id` response includes unmasked payroll fields for all roles, a sufficiently technical employee could retrieve raw data via the API directly.  
**Recommended fix:** Backend `UsersService.getOne` should apply field masking server-side based on requester role.
