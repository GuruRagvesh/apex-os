# Apex OS End-to-End Verification Matrix

Date: 2026-05-28  
Mode: Audit only  
Baseline commit: `ba9413d`

| Area | Test | Expected | Actual | Pass/Fail | Notes |
|---|---|---|---|---|---|
| Version | Current branch | Stabilization branch | `stabilize/apex-os-core` | Pass | `git status --short --branch` verified. |
| Version | Local HEAD | Latest deployment recovery commit | `ba9413d fix(deploy): synchronize deployed runtime api routes migrations and socket fallback` | Pass | Local tracking ref also shows `origin/stabilize/apex-os-core` at `ba9413d`. |
| Version | Working tree | No production-code drift | Only audit docs untracked during this audit | Pass | No modified production files were present during final check. |
| Version | GitHub remote commit | Matches local HEAD | UNKNOWN | Fail | `git ls-remote` could not connect to GitHub. |
| Deployment | Vercel frontend deployed commit | Matches local HEAD | UNKNOWN | Fail | No Vercel dashboard/API access. |
| Deployment | Render backend deployed commit | Matches local HEAD | UNKNOWN | Fail | No Render dashboard/API access. |
| Deployment | Render migration logs | Migrations applied in production | UNKNOWN | Fail | Render logs/database not accessible here. |
| Backend Build | Backend build | Completes successfully | Build passed locally | Pass | Prisma client generated during build. |
| Backend Tests | Backend unit/integration tests | Pass | 15 suites / 135 tests passed | Pass | Warnings were configuration-related, not failing. |
| Frontend Build | Frontend production build | Completes successfully | Passed in immediately preceding role UX QA pass | Pass | Existing warnings remain. |
| Prisma | `prisma validate` | Schema valid | Valid | Pass | Local Prisma schema passed validation. |
| Prisma | `prisma migrate status` | Local DB current | Up to date, 20 migrations | Pass | Local only; production DB unknown. |
| Public API | `/health` unauthenticated | 200 | 200 local | Pass | Public health endpoint works locally. |
| Protected API | `/events` unauthenticated | 401 | 401 local | Pass | Correct protected behavior. |
| Protected API | `/home/summary` unauthenticated | 401 | 401 local | Pass | Correct protected behavior. |
| Protected API | `/dashboard/overview` unauthenticated | 401 | 401 local | Pass | Correct protected behavior. |
| Protected API | `/workday/today` unauthenticated | 401 | 401 local | Pass | Correct protected behavior. |
| Protected API | `/notifications/unread-count` unauthenticated | 401 | 401 local | Pass | Correct protected behavior. |
| Auth API | Login seeded admin locally | Token returned | Local login succeeded with seeded fallback super admin | Pass | Production login not verified. |
| Auth API | Invalid login | Fails safely | 400 validation for malformed/wrong input | Pass | Safe failure, no stack trace observed. |
| Auth API | `/users/me` authenticated | 200 current user | 200 local | Pass | Session profile endpoint valid locally. |
| Dashboard API | `/home/summary` authenticated | 200 valid shape | 200 local, `criticalAlerts,metrics,workdayStatus,upcomingEvents,previews` | Pass | Production not probed. |
| Dashboard API | `/dashboard/overview` authenticated | 200 valid shape | 200 local, `stats,recentTickets,myTickets,bottleneckTickets,blockedTickets` | Pass | Production not probed. |
| Events API | `/events?limit=15` authenticated | 200 event list | 200 local, 15 events | Pass | Scoped UI still needs browser check. |
| Notifications API | `/notifications` authenticated | 200 list | 200 local | Pass | Local list empty in probe. |
| Notifications API | `/notifications/unread-count` authenticated | 200 count | 200 local | Pass | Count shape valid. |
| Tickets API | `/tickets` authenticated | 200 paginated tickets | 200 local | Pass | Response shape valid. |
| Tickets API | `/tickets/kanban` authenticated | 200 kanban columns | 200 local | Pass | Count parity browser check still needed. |
| Tickets API | `/tickets/stats` authenticated | 200 stats | 200 local | Pass | Includes blocked stats. |
| Tickets API | `/tickets/sla-risk` authenticated | 200 risk payload | 200 local | Pass | Uses timing-aware backend path. |
| Projects API | `/projects` authenticated | 200 paginated projects | 200 local | Pass | Scope-specific project edit not browser-tested. |
| Leave API | `/leave` authenticated | 200 paginated `items` | 200 local | Pass | Calendar mapping expects `items`. |
| Leave API | `/leave/stats` authenticated | 200 stats | 200 local | Pass | Role-scoped values not manually cross-checked for all roles. |
| Leave API | `/leave/balance` authenticated | 200 balance | 200 local | Pass | Balance shape valid. |
| Workday API | `/workday/today` authenticated | 200 workday state | 200 local | Pass | Re-login/stale-session flow not browser-tested. |
| Workday API | `/workday/team` authenticated | 200 team state | 200 local, array response | Pass | Role-specific visual scope needs manual QA. |
| Settings API | `/settings/company` authenticated | 200 company settings | 200 local | Pass | Settings persistence from prior stabilization remains code-backed. |
| Schema | Notification table | Exists | Present locally | Pass | Physical table `notifications`. |
| Schema | OperationalEvent table | Exists | Present locally | Pass | Physical table `operational_events`. |
| Schema | AttendanceEvent table | Exists | Present locally | Pass | Physical table `attendance_events`. |
| Schema | Ticket blocked fields | Present | `isBlocked`, `blockedAt`, `blockedReason`, `blockedById` present | Pass | Prisma schema and DB table verified locally. |
| Schema | Leave half-day fields | Present if supported | `isHalfDay`, `halfDayType` present | Pass | Prisma schema and DB table verified locally. |
| Schema | Settings table | Present | `app_settings` present | Pass | Production table unknown. |
| Architecture | Protected services | Present and used | Access, ticket access, timing, leave access, notification event, event logger services found | Pass | No bypass changes were made. |
| RBAC | Users list protection | Backend guarded/scoped | Controller/service guard evidence present | Pass | Browser per-role check incomplete. |
| RBAC | Ticket direct-ID protection | Backend scoped | TicketAccessService used by ticket service/controller paths | Pass | Unauthorized live deployed direct-ID probe not run. |
| RBAC | Leave approval protection | Backend scoped | LeaveAccessService and role guards used | Pass | Per-role workflow check incomplete. |
| RBAC | Project edit protection | Backend scoped | Project controller guards and access policy evidence present | Pass | Per-role edit workflow not browser-tested. |
| RBAC | Settings role gates | Backend guarded | Company/SLA/SMTP gates present | Pass | UI fallback checked by code, not browser. |
| Attachments | Secure download path | Requires backend authorization | Secure ticket attachment route exists | Partial | Direct storage URL bypass not production-verified. |
| Dashboard | Count convergence | Matches tickets/analytics/kanban | Local endpoints passed; full parity assertions not rerun in this audit | Partial | Needs deployed/browser count comparison. |
| Calendar | Approved leave source | Uses `items`, not `leaves` | Code evidence says `items` mapping is present | Partial | No approved leave record was rendered in browser during this audit. |
| Activity | Activity Log page errors | Clear error on API failure | Raw fetch can return `[]` on non-OK | Fail | P1 issue E2E-P1-001. |
| Frontend | Central API client usage | All authenticated calls centralized | Some raw fetches remain | Partial | P1 issue E2E-P1-002. |
| UX | Empty states | Honest and role-aware | Mostly improved; browser review incomplete | Partial | Needs visual QA. |
| UX | Loading/error states | Present on core pages | Present in many areas; gaps remain | Partial | Activity and some raw fetch paths need improvement. |
| Workflow | Ticket create/assign/status/comment/attachment/block | End-to-end operational | Backend evidence and tests pass; full browser flow not rerun | Partial | Needs manual deployed workflow pass. |
| Workflow | Workday start/break/resume/end | End-to-end operational | API evidence passes; browser/time-based flow not rerun | Partial | Needs manual deployed workflow pass. |
| Workflow | Leave apply/approve/reject/calendar | End-to-end operational | API evidence passes; visual calendar/approval flow not rerun | Partial | Needs manual deployed workflow pass. |
| Workflow | Project create/edit/detail | End-to-end operational | API evidence passes; browser edit/detail flow not rerun | Partial | Needs manual deployed workflow pass. |
| Notifications | Event-triggered notifications | Created and scoped | NotificationEventService present; endpoints pass | Partial | Trigger matrix not fully executed. |
| Performance | Backend response stability | Core APIs return 200 locally | 200 local for core endpoints | Pass | Production response time unavailable. |
| Performance | Socket failure behavior | Graceful degradation | Recent deployment commit says socket fallback fixed | Partial | Browser console not live-verified. |
| Security | Unauthenticated access | Protected APIs return 401 | Local protected probes returned 401 | Pass | Deployed unauth probes not verified here. |
| Security | Sensitive HR/payroll/docs | Backend role-scoped | Access policy evidence present | Partial | Browser/live direct-ID probes not rerun for every role. |
| Security | Production secrets | Not exposed and correctly configured | UNKNOWN | Fail | Vercel/Render envs inaccessible. |

## Summary

| Result | Count |
|---|---:|
| Pass | 43 |
| Partial | 16 |
| Fail | 6 |

The failed items are verification and UX-quality gaps rather than locally reproduced critical workflow failures. The two rollout-blocking failures are deployment parity and production authenticated API verification.
