# Feature Connectivity Summary

Apex OS has real foundations: NestJS/Prisma backend modules, Next.js operational pages, persistent users, departments, tickets, projects, leave, notifications, settings, workday and audit models. It is not a fake prototype overall.

The main problem is that many features are connected but not yet trustworthy. The riskiest gaps are RBAC/direct-ID scope, analytics/dashboard count drift, duplicated ticket/SLA timing, leave approval scope, sensitive HR document access, and frontend-only command/broadcast/theme/preference behavior.

## Top 10 Findings
1. RBAC is only partial: several list endpoints are scoped, but detail-by-ID endpoints and some manager actions are not consistently scoped.
2. Ticket detail, comments, history and attachments inherit direct-ID access risks.
3. Dashboard and analytics counts do not always use the same role scope or query logic as ticket lists.
4. SLA settings persist, but execution SLA still uses hardcoded priority-hour logic.
5. Frontend and backend disagree on some TEAM_LEAD capabilities for tickets, kanban, projects and leave.
6. Leave approval/rejection persists, but ID-based approval scope and leave balance enforcement are incomplete.
7. Project list/create/detail are real, but project detail/member/edit authorization and stats have gaps.
8. Notifications are real, but preferences and quiet hours are not enforced by notification triggers.
9. Broadcasts, several quick actions, quiet hours, font size and compact mode are frontend-only/local-only.
10. Backend-only capabilities exist for notification delete and AI summary, but complete frontend workflows are missing.

## Exact Counts
- Total features audited: 188
- A_FULLY_CONNECTED: 58
- B_PARTIAL_OR_BROKEN: 95
- C_FRONTEND_ONLY: 11
- D_BACKEND_ONLY: 2
- E_UNKNOWN: 1
- F_NOT_PRESENT: 21
- P0 issues: 27
- Features with mock/static/local-only data: 44
- Features with frontend UI but no backend: 11
- Features with backend but no frontend: 2

## Top 5 Riskiest Modules
- Tickets: 12 non-complete features, 7 P0
- SLA/Timing: 9 non-complete features, 5 P0
- Analytics/Reporting: 7 non-complete features, 5 P0
- Leave: 7 non-complete features, 2 P0
- Auth/RBAC: 5 non-complete features, 2 P0

## What To Fix First
1. RBAC and direct-ID access for users, tickets, comments/history/attachments, projects, leave and documents.
2. Shared ticket query/count service for list, kanban, dashboard, analytics and project detail.
3. SLA settings and timer logic, using one backend source and one frontend display contract.
4. Leave approval scope, date validation and leave balance/policy enforcement.
5. Settings/preferences enforcement, especially notification preferences and quiet hours.

## What Not To Build Yet
- Do not add AI agents, CRM modules, workflow engines, more dashboards or major UI redesigns until RBAC, SLA, counts and settings persistence are stable.
