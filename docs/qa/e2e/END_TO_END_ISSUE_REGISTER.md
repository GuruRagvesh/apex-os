# Apex OS End-to-End Issue Register

Date: 2026-05-28  
Mode: Audit only  
Baseline commit: `ba9413d fix(deploy): synchronize deployed runtime api routes migrations and socket fallback`

This register separates confirmed defects from verification gaps. No production code was changed during this audit.

| ID | Severity | Module | Issue | Evidence | Root Cause | Recommended Fix | Owner | Status |
|---|---|---|---|---|---|---|---|---|
| E2E-P0-001 | P0 | Deployment | GitHub, Vercel, and Render deployment alignment could not be directly verified. | `git ls-remote` could not connect to GitHub; no Vercel/Render dashboard or API session was available. Local tracking ref shows `origin/stabilize/apex-os-core` at `ba9413d`, but live deployment commit is UNKNOWN. | Environment/network access gap, not a confirmed code defect. | Run deployment-console verification: compare GitHub HEAD, Vercel build commit, Render build commit, and deployed frontend/backend versions. | DevOps | Open |
| E2E-P0-002 | P0 | Deployment/API | Authenticated deployed API, Render migration logs, and deployed Prisma state could not be verified. | Local API probe passed, but shell network to Render/Vercel failed. Render logs and DB migration history were not accessible. | Environment/network access gap, not a confirmed local defect. | Run live smoke script against production backend with a seeded admin account; capture migration status from Render logs/database. | DevOps | Open |
| E2E-P1-001 | P1 | Activity Log | Activity Log can show empty data on API failure instead of a clear error. | `frontend/app/(dashboard)/admin/activity/page.tsx` uses raw fetch and converts non-OK responses to `[]`. | Error path masks operational API failures. | Keep current page behavior but display a role-aware error/retry state when `/api/events` fails. | Frontend | Open |
| E2E-P1-002 | P1 | API Client | Several frontend surfaces still bypass the central API client. | Raw/manual fetch patterns found in `RecentActivityFeed.tsx`, project detail event fetch, calendar, and activity page. | Legacy integration paths remain after recovery work. | Migrate remaining fetches to the central authenticated client after rollout stabilization. | Frontend | Open |
| E2E-P1-003 | P1 | Settings | Some display/preferences behavior remains local-only or mixed persistence. | Settings page includes local UI preferences while backend-backed settings exist for company/SLA/SMTP/leave. | Product split between personal display state and persisted operating settings is not fully explicit. | Label local-only preferences clearly or persist them through user preferences. | Product/Frontend | Open |
| E2E-P1-004 | P1 | Attachments/Storage | Storage provider and public-file bypass posture could not be fully verified in deployment. | Secure ticket attachment route exists locally; backend tests passed. Cloudinary warnings appeared during backend test/build environment. Production storage env is inaccessible. | Deployment secret/config visibility gap. | Verify production storage provider, direct URL behavior, and secure proxy route from an unauthorized session. | Backend/DevOps | Open |
| E2E-P1-005 | P1 | Calendar | Approved leave mapping is code-verified but not data-verified in this audit. | `frontend/app/(dashboard)/calendar/page.tsx` maps leave response `items`; local API returned valid leave shape but no approved leave visual test was completed. | Test data/browser verification gap. | Create or use one approved leave request, open Calendar, verify rendering and click route. | QA | Open |
| E2E-P1-006 | P1 | Browser Workflows | Full browser click-through for drag/drop, downloads, exports, and drilldowns was not completed. | Local API endpoints passed; browser server/session could not be kept alive for full interactive QA in this environment. | Tooling/runtime limitation. | Perform browser QA against deployed or stable local app with each seeded role. | QA | Open |
| E2E-P1-007 | P1 | Role UX | Employee/intern access to Team and personal Activity Log remains product-policy unclear. | Local guards protect admin pages; Team/Profile/Settings access exists for non-admin roles, but the expected Team visibility for employee/intern needs business confirmation. | Business rule ambiguity. | Decide whether employee/intern Team page should be hidden, personal-only, or directory-only. | Product | Open |
| E2E-P1-008 | P1 | Production Env | Frontend and backend production environment variables could not be audited. | Local env files exist; Vercel/Render env values are not visible from this environment. | Deployment-console access gap. | Verify `NEXT_PUBLIC_API_URL`, CORS origins, `JWT_SECRET`, DB URL, SMTP, storage, and socket envs in production. | DevOps | Open |
| E2E-P1-009 | P1 | Frontend Quality | Frontend build has existing warnings. | Previous frontend build passed with hook dependency/image warnings on projects/team/ticker/command-palette areas. | Technical debt, not a blocker. | Clean warnings after pilot-critical checks are complete. | Frontend | Open |
| E2E-P1-010 | P1 | Deployment | Vercel/Render deployed route parity remains unconfirmed after runtime fixes. | Reports say `/api/home/summary`, `/api/events`, notifications, dashboard, SLA risk, and workday routes now return 200, but this audit could only verify them locally. | No deployed authenticated smoke evidence available. | Re-run `verify-endpoints.js` or equivalent against production and archive output. | DevOps/QA | Open |
| E2E-P2-001 | P2 | UX | Mobile/responsive behavior was not fully browser-verified. | Code/build checks only; no mobile screenshots captured during this audit. | Audit environment limitation. | Run mobile viewport pass for Dashboard, Tickets, Leave, Calendar, Settings, and Profile. | QA/Frontend | Open |
| E2E-P2-002 | P2 | Performance | Analytics route remains relatively heavy. | Build output from prior pass showed Analytics page around 117 kB route size and 258 kB first-load JS. | Chart-heavy page. | Consider chart-level dynamic imports after operational rollout. | Frontend | Deferred |
| E2E-P2-003 | P2 | UX Copy | Some empty/error/loading states still need visual copy review. | Page-level code shows improved states, but browser visual QA was incomplete. | UX polish gap. | Review role-specific empty/error states in browser. | Product/Design | Open |
| E2E-P2-004 | P2 | Notifications | Quiet hours/preferences enforcement was not proven end-to-end. | Notifications endpoints passed locally; preference runtime enforcement was not traced through every event trigger. | Integration evidence incomplete. | Add a focused notification-preference QA scenario after production smoke. | Backend/QA | Open |
| E2E-P2-005 | P2 | Workday | Stale-session auto-close behavior was not proven in this audit. | Workday local endpoints returned 200; time-based stale/auto-close behavior requires controlled clock or long-running test. | Time-based scenario not executed. | Add manual or automated time-travel test for stale sessions. | Backend/QA | Open |
| E2E-P2-006 | P2 | Settings | SMTP test behavior passed by code path expectation, but live SMTP delivery is unverified. | Backend tests passed; production SMTP env and actual mailbox delivery not visible. | External provider verification gap. | Send live test email from production settings after env audit. | DevOps/QA | Open |
| E2E-P2-007 | P2 | Accessibility | Keyboard focus, hover affordance, and contrast were not fully checked in browser. | Audit did not include visual/browser accessibility pass. | Manual QA gap. | Run keyboard/contrast pass on major pages. | QA/Design | Open |
| E2E-P3-001 | P3 | Future Integrations | External Google/Outlook calendar sync is not present. | Calendar uses internal tickets/leave source; no external integration was requested for this phase. | Deferred scope. | Keep deferred until P2/P3 integration phase. | Product | Deferred |
| E2E-P3-002 | P3 | AI/Automation | AI, workflow engine, CRM, forecasting, and advanced automation are intentionally not built. | User explicitly excluded these in stabilization phases. | Deferred scope. | Revisit only after operational rollout. | Product | Deferred |

## Counts

| Severity | Count |
|---|---:|
| P0 | 2 |
| P1 | 10 |
| P2 | 7 |
| P3 | 2 |

## Production Blocker Interpretation

The two P0s are verification blockers, not locally reproduced application defects. Locally, backend build, backend tests, Prisma validation, Prisma migration status, and core authenticated API probes passed. Apex OS should not be broadly rolled out until the production deployment and authenticated API evidence is captured.
