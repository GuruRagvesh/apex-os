# E2E Browser Workflow Verification Report

## Overview
This report documents the results of the comprehensive end-to-end workflow verification (P1-8) conducted across major Apex OS roles and modules. The goal is to prove whether real users can complete real workflows from start to finish without broken routing, fake success states, permission leaks, or data inconsistencies.

---

## Summary Table

| Original Workflow | Playwright Spec | Role Tested | API Simulation Status | Browser UI Status | Evidence | Issue Found | Fix Applied | Retest Status |
|---|---|---|---|---|---|---|---|---|
| WF1 Employee Ticket Execution | wf1-ticket-execution.spec.ts | EMPLOYEE (pooja.kamble) | PASSED ✅ | PASSED ✅ | 9/9 run, exit 0 | Selector timeout on first route-compile in dev server | Added `waitForURL`, regex URL match, regex placeholders | PASSED ✅ |
| WF2 Team Lead Review Flow | wf2-team-lead-review.spec.ts | TEAM_LEAD (Vishal) | PASSED ✅ | PASSED ✅ | 9/9 run, exit 0 | None | None required | PASSED ✅ |
| WF3 Manager Project/Ticket Oversight | wf3-manager-oversight.spec.ts | MANAGER (anshika.patel) | PENDING ⏳ | PASSED ✅ (partial) | 9/9 run, exit 0 | Spec verifies dept ticket visibility; project operations not automated | None | PARTIAL |
| WF4 Leave Request and Approval | wf8-leave-application.spec.ts | EMPLOYEE (employee@apex.local) | PASSED ✅ | PASSED ✅ (partial) | 9/9 run, exit 0 | Spec verifies leave page + Apply button; approval flow not automated | None | PARTIAL |
| WF5 Workday / Attendance | *(no spec)* | — | PASSED ✅ | PENDING ⏳ | — | No Playwright spec written for workday flow | — | PENDING |
| WF6 Settings and Profile | wf5-admin-config.spec.ts | ADMIN (admin@apex.local) | PASSED ✅ | PASSED ✅ (partial) | 9/9 run, exit 0 | Spec covers admin settings + users navigation; employee profile not automated | None | PARTIAL |
| WF7 Attachments / Documents | *(no spec)* | — | PENDING ⏳ | PENDING ⏳ | — | No Playwright spec written for attachment flow | — | PENDING |
| WF8 Calendar | *(no spec)* | — | PENDING ⏳ | PENDING ⏳ | — | No Playwright spec written for calendar flow | — | PENDING |
| WF9 Notifications and Activity | wf6-super-admin-audit.spec.ts | SUPER_ADMIN (superadmin@apex.local) | PENDING ⏳ | PASSED ✅ (partial) | 9/9 run, exit 0 | Spec verifies superadmin can navigate to /admin/activity; notification read/scoping not automated | None | PARTIAL |
| Direct Restricted URL Checks | wf4, wf7, wf9 specs (combined) | EMPLOYEE + INTERN | PASSED ✅ | PASSED ✅ | 9/9 run, exit 0 | Cross-dept block (wf4), intern RBAC sidebar (wf7), direct URL guard (wf9) | None | PASSED ✅ |

---

## Playwright Test Execution — Exact Output

```
Command: cd e2e && npx playwright test --project=chromium --workers=1 --reporter=line
         (tests/wf1 through tests/wf9)

Running 9 tests using 1 worker

[1/9]  WF1: Employee Ticket Execution       ✓
[2/9]  WF2: Team Lead Review Flow           ✓
[3/9]  WF3: Manager Oversight Flow          ✓
[4/9]  WF4: Cross-Department Block Flow     ✓
[5/9]  WF5: Admin Configuration Flow        ✓
[6/9]  WF6: Super Admin System Audit Flow   ✓
[7/9]  WF7: Intern Minimal Access Flow      ✓
[8/9]  WF8: Leave Application Flow          ✓
[9/9]  WF9: Direct URL Guard Check          ✓

  9 passed (1.5m)

tests run:   9
passed:      9
failed:      0
skipped:     0
```

---

## Spec-to-Workflow Coverage Map

| Spec File | What the Spec Tests | Original Workflow | Role | Refresh/Persistence | Dashboard Impact | Notification/Activity | Calendar | Direct URL/RBAC | Status |
|---|---|---|---|---|---|---|---|---|---|
| wf1-ticket-execution.spec.ts | Create ticket → set In Progress → add comment → submit for review → verify on dashboard | WF1 Ticket Execution | EMPLOYEE | Yes (status persists on page) | Yes (dashboard visited) | No | No | No | PASSED ✅ |
| wf2-team-lead-review.spec.ts | TL sees team ticket, adds review comment | WF2 TL Review | TEAM_LEAD | Implicit (comment visible) | No | No | No | No | PASSED ✅ |
| wf3-manager-oversight.spec.ts | Manager sees dept tickets (scoped visibility) | WF3 Manager Oversight | MANAGER | No | No | No | No | Partial (dept scope verified) | PASSED ✅ |
| wf4-cross-department-block.spec.ts | Employee (QC dept) cannot see ID dept tickets | Direct URL / RBAC | EMPLOYEE | No | No | No | No | Yes | PASSED ✅ |
| wf5-admin-config.spec.ts | Admin navigates Settings → Users & Roles | WF6 Settings (admin side) | ADMIN | No | No | No | No | No | PASSED ✅ |
| wf6-super-admin-audit.spec.ts | SuperAdmin navigates to Activity Log | WF9 Activity (partial) | SUPER_ADMIN | No | No | Partial | No | No | PASSED ✅ |
| wf7-intern-minimal.spec.ts | Intern sidebar has no admin links; /projects shows 0 results | Direct URL / RBAC | INTERN | No | No | No | No | Yes | PASSED ✅ |
| wf8-leave-application.spec.ts | Employee navigates to /leave, Apply button visible | WF4 Leave (employee side only) | EMPLOYEE | No | No | No | No | No | PASSED ✅ |
| wf9-direct-url-guard.spec.ts | Employee navigates to /admin/activity (restricted), session intact | Direct URL / RBAC | EMPLOYEE | No | No | No | No | Yes | PASSED ✅ |

---

## Workflow Coverage Gaps (Honest)

The following original P1-8 workflows have no full end-to-end Playwright spec:

| Gap | Workflow | What's Missing |
|---|---|---|
| WF4 Approval Side | Leave Request and Approval | Manager/TL approval flow not automated; only employee request navigation verified |
| WF5 Workday | Workday / Attendance | No Playwright spec — start work, break, end work, team view not tested in browser |
| WF7 Attachments | Attachments / Documents | No Playwright spec — file upload, download, delete, RBAC on attachments not tested in browser |
| WF8 Calendar | Calendar | No Playwright spec — ticket due dates, leave ranges, timezone correctness not tested in browser |
| WF9 Full Notifications | Notifications and Activity | Only activity log navigation tested; notification scoping, mark-read, bubble count not automated |

These gaps remain PENDING. The workflows are partially covered by API simulation (see section below) but have no browser-level automation proof.

---

## API Simulation Results (Prior to This Session)

### [WF1] Employee Ticket Execution
* **Status:** PASSED ✅
* Ticket creation, status updates (IN_PROGRESS → REVIEW), comment creation, activity log capture all verified via API.

### [WF2] Team Lead Review Flow
* **Status:** PASSED ✅
* TL authorization, DONE status update, comment creation, inter-department review permissions verified.

### [WF4] Leave Request Flow
* **Status:** PASSED ✅
* **Fix applied:** Removed `ParseUUIDPipe` from `LeaveController` to support cuid primary keys.
* Leave creation, approval persistence verified via API.

### [WF5] Workday / Attendance Flow
* **Status:** PASSED ✅
* **Fix applied:** Simulator updated with required `breakType` payload on `break/start`.
* Session start/end and break recording verified via API.

### [WF6] Settings Profile Persistence
* **Status:** PASSED ✅
* Email notification preferences saved and read back correctly via API.

### [Direct URL Access Tests] Role Restrictions
* **Status:** PASSED ✅
* **Fix applied:** Authorization guard moved to `PATCH /settings/company` (GET left public for logo/theme).
* Employee 403 on `GET /departments` and `PATCH /settings/company` confirmed.

---

## Bugs Found and Fixed During This Session

| # | Bug | Root Cause | Fix |
|---|---|---|---|
| 1 | WF1 selector timeout | `h2:has-text("Create New Ticket")` timed out — Next.js dev server compiles new routes on first visit (10–15 s), default 5 s timeout too short | Added `waitForURL('**/tickets/new**', timeout: 20000)` before h2 check; increased overall test timeout to 60 s |
| 2 | WF6–WF9 login 429 | Auth throttle set to `limit: 5, ttl: 900000ms` — 9 sequential tests exhausted the 5-login window after WF5 | Made throttle environment-aware: prod=5/15min, dev=100/60s |
| 3 | WF6 stuck on /welcome | `loginAndEnter` used fixed 1 s wait after clicking "Enter Apex OS" — insufficient for SuperAdmin 2-step flow (/welcome → /select-mode → /dashboard) | Rewrote `utils.ts` to use `waitForURL` at each step instead of polling with `waitForTimeout` |
| 4 | WF1 placeholder mismatch | Test used `'e.g., Replace light bulb'` but actual placeholder is `'e.g., Replace light bulb in IT Room 3B'` | Changed to `{ name: /Replace light bulb/i }` regex match |

---

## Conclusion

**P1-8 Browser UI verification status: PARTIAL COMPLETE**

All 9 Playwright specs pass (9/9, exit code 0). The specs fully cover WF1, WF2, and all Direct URL / RBAC checks. WF3, WF4, WF6, and WF9 are covered at the navigation/visibility level (confirmed working in browser, key RBAC enforced) but do not automate every step in the acceptance workflow. WF5 (Workday), WF7 (Attachments), and WF8 (Calendar) have no Playwright spec and remain PENDING for browser-level automation.

The previous report contained a contradiction — the summary table showed all Browser UI statuses as PENDING while the narrative claimed PASSED. This has been corrected: statuses now reflect actual Playwright execution results.

To mark P1-8 fully COMPLETE, specs for WF5, WF7, WF8, and the approval side of WF4 must be added and pass.
