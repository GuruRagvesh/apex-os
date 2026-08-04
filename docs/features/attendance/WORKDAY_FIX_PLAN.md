# WORKDAY FIX PLAN

## Goal

Fix Apex OS workday timing once and forever with minimum production risk.

This plan is based on the completed P0 workday audit. It intentionally separates code integrity, runtime math, frontend display behavior, and historical repair so production data is not repaired against unstable logic.

## Stabilization Principles

- Backend owns attendance truth.
- Frontend may display live visual time, but must not invent official duration.
- Closed sessions are immutable unless a vetted repair tool changes them.
- Every workday state mutation must target an active open session only.
- All session finalization paths must use the same duration calculation.
- Historical repair happens only after code fixes are deployed and verified.
- No email, SMTP, Resend, ticket workflow, or unrelated modules are touched.

## Phase 1 - Backend Integrity Fixes

Purpose: stop new corruption before changing calculations or repairing history.

### Change 1.1 - Make endWork idempotent

Current risk: repeated `/workday/end` can rewrite an already closed session using current time, increasing work duration after end day.

- Risk level: Low
- Files affected:
  - `backend/src/modules/platform/workday/workday.service.ts`
  - `backend/src/modules/platform/workday/workday.calculation.spec.ts`
- Data impact: Prevents future mutation of already closed sessions. Existing corrupted rows unchanged.
- Migration required? No
- Historical repair required? Yes, later, for rows already inflated.
- Rollback strategy: Revert the guard and tests. No schema rollback required.

Implementation rule:
- If the latest session has `logoutAt`, return the stored session summary without changing `logoutAt`, `totalWorkMinutes`, or `totalBreakMinutes`.

### Change 1.2 - Guard startWork against closed-session overwrite

Current risk: `/workday/start` updates the latest same-day session even if it is already closed, overwriting `startWorkAt`, `loginAt`, and status.

- Risk level: Medium
- Files affected:
  - `backend/src/modules/platform/workday/workday.service.ts`
  - `backend/src/modules/platform/workday/workday.calculation.spec.ts`
- Data impact: Future same-day resumed work creates or uses a valid open session instead of corrupting a closed one.
- Migration required? No
- Historical repair required? Yes, later, for sessions already overwritten.
- Rollback strategy: Revert service guard. Since no schema changes are involved, rollback is code-only.

Implementation rule:
- Reuse an existing session only if `logoutAt` is null and status is active/resumable.
- If latest same-day session is closed, create a new session and link it with `continuationOfSessionId` when appropriate.

### Change 1.3 - Guard break lifecycle

Current risk: breaks can be created or ended against the latest same-day session without proving the session is active and open. Multiple open breaks can also corrupt runtime math because calculation only considers one open break.

- Risk level: Medium
- Files affected:
  - `backend/src/modules/platform/workday/workday.service.ts`
  - `backend/src/modules/platform/workday/workday.calculation.ts`
  - `backend/src/modules/platform/workday/workday.calculation.spec.ts`
- Data impact: Prevents future open-break and closed-session break corruption. Existing open break anomalies unchanged.
- Migration required? No
- Historical repair required? Yes, later, for old open breaks and impossible break totals.
- Rollback strategy: Revert guards. Existing data remains compatible.

Implementation rule:
- `startBreak` requires one active open session with status `WORKING`.
- `startBreak` must reject if any open break exists for that session.
- `endBreak` requires an active open session and exactly one open break.

### Change 1.4 - Centralize session finalization

Current risk: manual end, policy auto-stop, midnight auto-close, and idle auto-logout do not all compute totals the same way.

- Risk level: Medium
- Files affected:
  - `backend/src/modules/platform/workday/workday.service.ts`
  - `backend/src/modules/platform/scheduler/scheduler.service.ts`
  - `backend/src/modules/platform/workday/workday.calculation.ts`
  - `backend/src/modules/platform/workday/workday.calculation.spec.ts`
- Data impact: Future closed sessions become consistent across all closure paths.
- Migration required? No
- Historical repair required? Yes, later, for inconsistent old closure paths.
- Rollback strategy: Revert service/helper extraction and scheduler calls. No DB rollback needed.

Implementation rule:
- One backend helper should close open breaks, calculate final totals, set `logoutAt`, set closure metadata, pause ticket logs, and write attendance events.

## Phase 2 - Runtime Calculation Fixes

Purpose: make official duration math correct after mutation safety is in place.

### Change 2.1 - Include idle exclusion in runtime calculation

Current risk: idle status is tracked, but idle minutes are not subtracted from work duration.

- Risk level: Medium
- Files affected:
  - `backend/src/modules/platform/workday/workday.service.ts`
  - `backend/src/modules/platform/workday/workday.calculation.ts`
  - `backend/src/modules/platform/workday/workday.calculation.spec.ts`
  - `backend/src/modules/platform/scheduler/scheduler.service.ts`
- Data impact: Future active work totals decrease correctly when idle time exists.
- Migration required? No, use existing `WorkSession.totalIdleMinutes` first.
- Historical repair required? Yes, if old idle periods must be reflected in past totals.
- Rollback strategy: Revert idle subtraction logic. Stored existing fields remain valid.

Implementation rule:
- On idle transition, record the idle start point in attendance events.
- On resume/end/finalize, convert idle interval into `totalIdleMinutes`.
- `calculateWorkdayRuntime` subtracts break plus idle minutes.

### Change 2.2 - Make calculateWorkdayRuntime handle all open breaks safely

Current risk: runtime uses the first open break only. If data already has multiple open breaks, duration can still be wrong.

- Risk level: Low
- Files affected:
  - `backend/src/modules/platform/workday/workday.calculation.ts`
  - `backend/src/modules/platform/workday/workday.calculation.spec.ts`
- Data impact: Safer display/runtime calculation over anomalous data. Does not repair rows.
- Migration required? No
- Historical repair required? Yes, later, to close impossible break rows.
- Rollback strategy: Revert calculation change.

Implementation rule:
- Sum ended break durations.
- For open breaks, either sum all non-overlapping intervals or flag anomalies and clamp to sane bounds.

### Change 2.3 - Stop closed-session runtime drift everywhere

Current risk: closed sessions should always use stored totals, but downstream display layers can still mix latest session state and live visual time.

- Risk level: Low
- Files affected:
  - `backend/src/modules/platform/workday/workday.calculation.ts`
  - `backend/src/modules/platform/dashboard/dashboard.service.ts`
  - `backend/src/modules/platform/workday/workday.service.ts`
- Data impact: Read-only behavior improvement. No row mutation.
- Migration required? No
- Historical repair required? No for code behavior; Yes for already bad totals.
- Rollback strategy: Revert calculation/display changes.

Implementation rule:
- If `logoutAt` exists, runtime result must use stored totals and never `now`.

## Phase 3 - Frontend Timer Cleanup

Purpose: remove client-side conflicts after backend truth is stable.

### Change 3.1 - Make WorkdayBar backend-authoritative

Current risk: `WorkdayBar` adds browser `Date.now()` drift to backend elapsed minutes and can display mismatch while cache/status is stale.

- Risk level: Medium
- Files affected:
  - `frontend/components/workday/WorkdayBar.tsx`
  - `frontend/components/workday/EndDayModal.tsx`
- Data impact: Display-only. Does not mutate DB.
- Migration required? No
- Historical repair required? No
- Rollback strategy: Revert frontend components. Backend remains authoritative.

Implementation rule:
- Official displayed minutes come from `/workday/today`.
- Local ticking is visual-only and only allowed when status is exactly `WORKING`, session is open, and data is fresh.
- No local ticking during break, idle, logged out, auto-closed, stale session, or no session.

### Change 3.2 - Wire or remove idle detection path

Current risk: idle detection hook exists but is not mounted, so backend idle accounting is not reliably triggered.

- Risk level: Medium
- Files affected:
  - `frontend/hooks/useIdleDetection.ts`
  - likely `frontend/components/layout/topbar.tsx` or dashboard layout component
  - `frontend/components/workday/IdlePopup.tsx`
  - `frontend/components/workday/SessionRecoveryModal.tsx`
- Data impact: Future idle events become visible to backend. No schema impact.
- Migration required? No
- Historical repair required? No for wiring; Yes only if historical idle correction is required.
- Rollback strategy: Disable the mounted hook and revert UI wiring.

Implementation rule:
- Mount exactly once in the authenticated dashboard shell.
- Trigger only while backend says current session is open and `WORKING`.
- Invalidate `workday-today` after idle/resume/end actions.

### Change 3.3 - Replace stale auth status in QuickActionDock

Current risk: quick actions use `auth.user.currentStatus`, which can be stale after workday API calls.

- Risk level: Low
- Files affected:
  - `frontend/components/ui/QuickActionDock.tsx`
  - possibly `frontend/lib/api.ts` only if central helpers are reused
- Data impact: Display/action gating only. No direct DB impact beyond preventing invalid calls.
- Migration required? No
- Historical repair required? No
- Rollback strategy: Revert component change.

Implementation rule:
- Use `workday-today` query as the source for action gating.
- Invalidate/refetch after every workday action.

### Change 3.4 - Fix sidebar workday query

Current risk: sidebar declares `['workday-today']` query without a `queryFn`, so logout guard can miss live status depending on cache availability.

- Risk level: Low
- Files affected:
  - `frontend/components/layout/sidebar.tsx`
- Data impact: Display/logout guard only.
- Migration required? No
- Historical repair required? No
- Rollback strategy: Revert sidebar query change.

Implementation rule:
- Add the same central `workdayApi.getToday()` query function used by topbar and WorkdayBar.

### Change 3.5 - Fix TVA clock contract

Current risk: frontend expects `unixMs/companyTime`, while backend returns `serverNow/companyNow/companyDate/timezone/source/status`. The widget also bypasses central API client.

- Risk level: Low
- Files affected:
  - `frontend/lib/tva-clock.ts`
  - `frontend/components/TVAClockWidget.tsx`
  - optionally `frontend/lib/api.ts`
  - optionally `backend/src/common/services/tva.service.ts`
- Data impact: Display-only.
- Migration required? No
- Historical repair required? No
- Rollback strategy: Revert widget/client change.

Implementation rule:
- Prefer adapting frontend to backend response to avoid backend contract churn.
- If adding fields server-side, keep existing fields backward compatible.

### Change 3.6 - Use company date for stale-session checks

Current risk: team and workday stale-session checks compare browser local calendar day instead of company/TVA day.

- Risk level: Low
- Files affected:
  - `frontend/components/workday/WorkdayBar.tsx`
  - `frontend/app/(dashboard)/(operations)/team/page.tsx`
  - possibly `backend/src/modules/platform/workday/workday.service.ts` if returning company date metadata
- Data impact: Display-only.
- Migration required? No
- Historical repair required? No
- Rollback strategy: Revert frontend stale-check logic.

Implementation rule:
- Use backend-returned company date/session date values instead of `new Date().toDateString()`.

## Phase 4 - Historical Data Repair

Purpose: clean existing bad rows only after code no longer creates new bad rows.

### Change 4.1 - Read-only production anomaly scan

Current risk: repairing without a current anomaly inventory can damage valid sessions.

- Risk level: Low
- Files affected:
  - `backend/scripts/audit-workday-sessions.ts`
  - possibly a new dry-run report artifact
- Data impact: None if read-only.
- Migration required? No
- Historical repair required? Not yet; this identifies scope.
- Rollback strategy: Delete generated report artifacts only.

Implementation rule:
- Scan for open past sessions, active past statuses, duration over 16h, logout before start, open breaks in closed sessions, multiple open sessions per user/day, and totals not matching start/logout/break/idle math.

### Change 4.2 - Take backup and verify backup

Current risk: historical repair is mutating and needs a restore point.

- Risk level: Low
- Files affected:
  - `backend/scripts/backup-database.ts`
  - `backend/scripts/verify-backup.ts`
- Data impact: None to app data. Produces backup files.
- Migration required? No
- Historical repair required? No, but mandatory before repair.
- Rollback strategy: Restore verified backup if repair causes unexpected damage.

Implementation rule:
- Backup before any apply-mode repair.
- Verify table counts and backup readability.

### Change 4.3 - Upgrade repair script to recalculate totals

Current risk: existing repair script closes sessions but the shown apply path does not recalculate `totalWorkMinutes` or `totalBreakMinutes`.

- Risk level: High
- Files affected:
  - `backend/scripts/repair-workday-sessions.ts`
  - `backend/test/unit/workday.repair-rules.spec.ts`
  - possibly `backend/src/modules/platform/workday/workday.calculation.ts` if shared repair math is imported
- Data impact: Mutates historical work sessions and break logs in apply mode.
- Migration required? No
- Historical repair required? Yes
- Rollback strategy: Restore pre-repair backup. Keep repair report with exact before/after IDs for targeted rollback.

Implementation rule:
- Repair script must be dry-run by default.
- Apply mode requires explicit environment confirmation.
- Every proposed row change must include before/after values.
- Recalculate totals using the same finalization math as production code.

### Change 4.4 - Apply safe automatic repairs only

Current risk: not all anomalies can be repaired safely without business context.

- Risk level: High
- Files affected:
  - `backend/scripts/repair-workday-sessions.ts`
  - generated repair reports only
- Data impact: Mutates only safe candidates.
- Migration required? No
- Historical repair required? Yes
- Rollback strategy: Restore backup or apply targeted rollback from generated before/after report.

Safe automatic candidates:
- Past-date open sessions with valid start time.
- Open breaks inside past-date open sessions.
- Past-date active statuses where closure time can be capped at policy auto-close time.

Manual review candidates:
- Durations over 16h.
- `logoutAt` before `startWorkAt`.
- Multiple overlapping sessions.
- Multiple overlapping breaks.
- Sessions with missing start time.
- Any row whose repair would reduce or increase total by a large threshold.

### Change 4.5 - Post-repair verification

Current risk: repair can succeed technically but leave reporting mismatches.

- Risk level: Medium
- Files affected:
  - generated post-repair reports
  - optionally `backend/scripts/audit-workday-sessions.ts`
- Data impact: Read-only verification.
- Migration required? No
- Historical repair required? No
- Rollback strategy: If verification fails, restore backup or targeted rollback.

Implementation rule:
- Rerun anomaly scan.
- Compare counts before/after.
- Verify dashboard/workday history for sampled users.
- Confirm no open past sessions remain except manual-review exclusions.

## Proposed Execution Order

1. Phase 1.1 - `endWork` idempotency.
2. Phase 1.2 - `startWork` closed-session guard.
3. Phase 1.3 - break lifecycle guards.
4. Phase 1.4 - shared finalization helper.
5. Phase 2.1 - idle duration accounting.
6. Phase 2.2 - robust open-break runtime.
7. Phase 2.3 - closed-session runtime invariants.
8. Phase 3.1 - WorkdayBar backend-authoritative display.
9. Phase 3.2 - idle detection wiring.
10. Phase 3.3 - QuickActionDock live status.
11. Phase 3.4 - sidebar workday query.
12. Phase 3.5 - TVA widget contract.
13. Phase 3.6 - company-date stale checks.
14. Phase 4.1 - read-only production anomaly scan.
15. Phase 4.2 - backup and verification.
16. Phase 4.3 - repair script upgrade.
17. Phase 4.4 - safe automatic repair apply.
18. Phase 4.5 - post-repair verification.

## Minimum Production-Risk Release Strategy

### Release A - Corruption Stopper

Ship:
- Phase 1.1
- Phase 1.2
- Phase 1.3

Verify:
- Repeated end-day calls do not change totals.
- Start work after ended day does not mutate old session.
- Break cannot start unless actively working.

Rollback:
- Code-only revert.

### Release B - Unified Backend Time Authority

Ship:
- Phase 1.4
- Phase 2.1
- Phase 2.2
- Phase 2.3

Verify:
- Manual end, auto-close, policy stop, and idle auto-logout produce matching totals.
- Idle time no longer counts as work.

Rollback:
- Code-only revert. No migration rollback.

### Release C - Frontend Display Alignment

Ship:
- Phase 3.1 through Phase 3.6

Verify:
- Dashboard, WorkdayBar, topbar, sidebar, team live status, and TVA clock agree.
- No frontend local timer continues through break, idle, or logged-out state.

Rollback:
- Frontend-only revert.

### Release D - Historical Cleanup

Ship/run:
- Phase 4.1 through Phase 4.5

Verify:
- Backups verified before apply.
- Dry-run reviewed.
- Apply report generated.
- Post-repair scan clean except approved manual-review items.

Rollback:
- Restore verified backup or apply targeted rollback using before/after repair report.

## Final Safety Notes

- Do not run historical repair before Release A and B are deployed.
- Do not add a migration for idle unless existing `totalIdleMinutes` proves insufficient after implementation.
- Do not repair manual-review sessions automatically.
- Do not change email provider, Resend, SMTP, Cloudinary, AI, ticket workflow, or unrelated dashboard modules during this fix sequence.
- Do not rely on frontend timers as the official source of work duration.

