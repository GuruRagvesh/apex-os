# Feature Connectivity Summary - Post P1-C

## Plain-English Summary
The current Apex OS codebase is significantly more connected than the pre-stabilization audit. The core operating workflows now have real backend models, scoped services, frontend API calls, and persistence for users, HRMS profiles, tickets, leave, projects, settings, notifications, analytics, workday, and audit logs.

The strongest current improvements are the shared backend access/timing layers: `AccessPolicyService`, `TicketAccessService`, `TicketTimingService`, and `LeaveAccessService`. These eliminate most of the old direct-ID, role-scope, SLA, and leave approval drift.

## Exact Counts
| Status | Count |
|---|---:|
| Total audited | 188 |
| A_FULLY_CONNECTED | 113 |
| B_PARTIAL_OR_BROKEN | 48 |
| C_FRONTEND_ONLY | 5 |
| D_BACKEND_ONLY | 2 |
| E_UNKNOWN | 1 |
| F_NOT_PRESENT | 19 |

## Top 10 Findings
1. RBAC is now substantially centralized through shared backend policy/scope services.
2. User list/profile responses now strip or mask sensitive HR/payroll/document fields based on backend policy.
3. Ticket detail, comments, history, assignment, workflow, delete, stats, kanban, export, and analytics now use scoped backend access paths.
4. SLA settings now persist and feed a single backend timing contract used by ticket UI and counts.
5. Leave list, stats, approvals, rejections, balances, and notifications are now backend scoped.
6. Analytics overview, trend, category, and workload now use shared ticket scope, but home-dashboard risk metrics still have some drift.
7. HR document access is backend-scoped, but ticket attachments still open stored URLs directly rather than a protected download route.
8. Task/checklist and broadcast features are still mostly absent or UI-only.
9. Settings persistence is much better, but some appearance/security/preferences pieces remain local-only or partial.
10. SMTP sending exists through environment-based Nodemailer config, while saved SMTP settings are not clearly used by the transporter.

## What To Fix First
1. Protect ticket attachment downloads end-to-end.
2. Finish dashboard/risk count convergence around the backend timing/query services.
3. Parse URL query filters on ticket pages so quick actions work as promised.
4. Decide scope for standalone task, broadcast, risk acknowledgement, and external calendar integrations.
5. Wire saved SMTP settings into the actual email transporter or document env-only SMTP as intentional.

## What Not To Build Yet
Do not add new AI agents, CRM, workflow-engine, or cosmetic redesign work until the remaining B/C/F operational gaps are either fixed or explicitly deferred.

