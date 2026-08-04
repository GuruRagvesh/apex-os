# Master Feature Reconciliation Tracker

## 1. Summary Counts
- **Total audited features:** 188
- **Fully connected:** 113
- **Partial/broken:** 48
- **Frontend-only:** 5
- **Backend-only:** 2
- **Unknown:** 1
- **Not present:** 19
- **Fixed since original audit:** 10 (Role UI/UX convergence, Calendar Leave fix, Blocked Ticket workflow, Deployment sync fixes, etc.)
- **Still open:** 38 (The remaining partial/broken features grouped into the fix packs below).

## 2. Feature-by-Feature Table (Critical Open Items)

| ID | Module | Feature | Current Status | Evidence | Root Cause | Fix Pack | Priority | Owner | Verification Needed |
|---|---|---|---|---|---|---|---|---|---|
| FEAT-081 | Projects | Project Detail | Partial | UI loads, but raw fetch exists and linkages are weak. | Legacy code, raw fetch logic bypasses central API. | P1 Projects module recovery | P1 | Frontend | Browser QA |
| FEAT-082 | Projects | Project Tickets | Partial | Ticket link UI incomplete. | Missing robust mutation UI for linking existing tickets. | P1 Projects module recovery | P1 | Frontend | Code & QA |
| FEAT-083 | Projects | Project Team | Partial | Member management incomplete. | Missing frontend integration for member APIs. | P1 Projects module recovery | P1 | Frontend | Code & QA |
| FEAT-031 | Workday | Workday Start | Partial | Start time / Login time conflated. | UI/logic doesn't distinct login vs explicit work start. | P1 Workday live status accuracy | P1 | Fullstack | Code & QA |
| FEAT-033 | Workday | Break Flow | Partial | Break counts/duration inaccurate. | Break calculation logic in UI/Backend mismatch. | P1 Workday live status accuracy | P1 | Fullstack | Code & QA |
| FEAT-038 | Workday | End Day Summary | Partial | Active work minutes incorrect. | Net work time isn't excluding breaks accurately. | P1 Workday live status accuracy | P1 | Fullstack | Code & QA |
| FEAT-194 | Activity | Activity Log | Partial | Blank data on error. | Raw fetch returns `[]` on non-OK responses. | P1 Activity Log reliability | P1 | Frontend | Code & QA |
| FEAT-151 | Settings | Appearance | Partial | Local-only settings. | Preferences not fully wired to DB user settings. | P1 Settings persistence clarity | P1 | Frontend | Code & QA |
| FEAT-051 | Tickets | Attachments | Partial | Public URL bypass / Storage unverified. | Missing secure proxy download / prod env config. | P1 Attachment verification | P1 | Backend | Env Config & QA |

## 3. Fix-Pack Grouping
- **P0 production smoke/proof:** Verify deployed GitHub/Vercel/Render alignment and authenticated API.
- **P1 Projects module recovery:** Fix project detail, linked tickets, members, and raw fetches.
- **P1 Workday live status accuracy:** Fix login/start distinction, precise break math, active minutes, end-day logic.
- **P1 Activity Log reliability:** Fix `RecentActivityFeed.tsx` and `admin/activity` raw fetches & error states.
- **P1 Role browser workflow pass:** Manual browser QA for all roles on all workflows (Kanban drag/drop, filters, exports).
- **P1 Attachment/storage verification:** Verify Cloudinary/storage provider for secure file uploads/downloads.
- **P1 Calendar approved leave verification:** Verify approved leave renders correctly on the calendar UI.
- **P1 Team/Activity role-policy decision:** Resolve business rules for employee/intern visibility on Team/Activity pages.
- **P1 Settings persistence clarity:** Sync local-only settings (theme, display) to the database preferences.
- **P1 Raw fetch/API client cleanup:** Replace all remaining raw `fetch` calls with `api.ts` authenticated requests.
- **P2 Mobile/accessibility/notifications/stale-workday/SMTP/frontend warnings:** Run responsive audits, check quiet hours, test SMTP, clear lint warnings.
- **P3 AI/calendar integrations/CRM/automation:** Future feature scope.

## 4. Explicit Answers
- **Are the 48 partial/broken features all accounted for?** Yes. They are mapped directly into the P1 and P2 fix packs outlined above (Projects, Workday, Settings, Activity, etc.).
- **Which of the 48 are already fixed?** The calendar mapping fix, basic role-guarded routes, blocked ticket workflows, and the deployed API 500/404s have been successfully resolved.
- **Which are still open?** Projects module completeness, Workday live accuracy, Activity Log fetch issues, Attachment storage security, UI/Settings persistence, and raw fetch deprecation.
- **Which are not defects but verification gaps?** Production environment smoke test, Role browser workflow pass, Calendar approved leave visual proof.
- **Which need business decisions?** Team/Activity role-policy visibility for employees and interns.
- **Which need production environment/config?** Attachment/storage verification and SMTP email delivery.
- **Which need browser QA only?** Role browser workflow pass, Kanban drag/drop, download/export validation.
- **Which require code fixes?** Projects module recovery, Workday live status accuracy, Activity log reliability, Settings persistence clarity, and Raw fetch/API client cleanup.

## 5. Specific Deep-Dive Sections

### A. Projects module
- **project list:** Functions, but drilldowns and exact counts need refinement.
- **project detail:** Behind-project view feels incomplete. Uses legacy raw fetch for events.
- **project members:** Missing full member management UI and robust linkage.
- **linked tickets:** Visible, but adding existing tickets or managing them from the project context is incomplete.
- **project progress:** Needs accurate computation based on functional linked tickets.
- **dashboard active projects:** Sometimes relies on unscoped totals rather than precise filtered lists.
- **project drilldowns:** Not thoroughly verified in browser workflows.
- **project empty/error states:** Need visual polish and better user guidance.

### B. Workday / Team Live Status
- **loginAt vs startWorkAt:** UI conflates logging in with officially starting the workday. They must be distinct.
- **endDayAt:** End-day logic and app-session logout behavior do not cleanly close out work duration.
- **break count & total break minutes:** Math is inaccurate or fails to update correctly in the frontend session state.
- **current break start:** The duration of an ongoing break is not displayed accurately.
- **active work minutes:** Not accurately calculating net work time (Total Elapsed - Total Break Duration).
- **stale/incomplete sessions:** Handling is unclear when users forget to end their day or log out.
- **manager/TL visibility:** Requires the above fixes to provide accurate "Team Live Status" oversight.

## 6. Priority Recommendation (Next 10 Prompts/Fix Packs)
*Do not implement these yet. This is the execution order.*

1. **[P1 Projects module recovery]** - Implement full project detail UI, link tickets, and manage project members.
2. **[P1 Workday live status accuracy]** - Rewrite the Workday session math to precisely separate login, start, breaks, and net work time.
3. **[P1 Raw fetch/API client cleanup]** - Refactor all remaining raw `fetch` calls (Activity Log, Projects, Calendar) into `api.ts`.
4. **[P1 Activity Log reliability]** - Enhance Activity Log to handle API errors gracefully instead of failing silently to empty data.
5. **[P1 Settings persistence clarity]** - Connect local-only UI preferences to the backend user settings model.
6. **[P1 Attachment/storage verification]** - Secure file downloads via backend proxy and verify production storage environment variables.
7. **[P1 Calendar approved leave verification]** - Seed an approved leave request and visually verify calendar UI rendering.
8. **[P1 Team/Activity role-policy decision]** - Implement final product decision for employee/intern visibility on Team directories.
9. **[P1 Role browser workflow pass]** - Perform manual browser-based UI click-throughs for all role permissions.
10. **[P0 production smoke/proof]** - Execute the final deployed end-to-end smoke test against the live Vercel/Render instances.
