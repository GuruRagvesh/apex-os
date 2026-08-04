# TVA_DASHBOARD_AUDIT.md

Date: 2026-06-06
Mode: Read-only forensic audit

## Verdict

Dashboard backend mostly uses the right authorities for workday and ticket overdue. The frontend dashboard surface still includes time labels and components that calculate display time locally.

Risk: High because users compare dashboard, WorkdayBar, ticket list, and analytics.

## Dashboard Metrics

| Metric Name | File | API | Source Table | Calculation | Consumer | Origin |
| --- | --- | --- | --- | --- | --- | --- |
| Overview ticket counts | `dashboard.service.ts` | `/dashboard/overview` | `Ticket` | Prisma counts scoped by role | dashboard page | Backend |
| Overdue tickets | `dashboard.service.ts` | `/dashboard/overview`, `/home/summary` | `Ticket` | `TicketTimingService.getTimingState` | dashboard/home | Backend |
| Blocked tickets | `dashboard.service.ts` | `/dashboard/overview` | `Ticket` | `isBlocked` count/filter | dashboard | Backend |
| Team online/active today | `dashboard.service.ts` | `/home/summary` | `User` | `currentStatus in WORKING, ON_BREAK, LOGGED_IN` | dashboard/home | Backend |
| Current user's workday | `dashboard.service.ts` | `/home/summary` | `WorkSession`, `BreakLog` | `calculateWorkdayRuntime` | dashboard/home | Backend |
| Upcoming events | `dashboard.service.ts` | `/home/summary` | `Ticket`, `LeaveRequest` | due/start date range from `new Date()` | dashboard/home | Backend |
| Ticket trend | `dashboard.service.ts` | `/dashboard/ticket-trend` | `Ticket` | buckets by `createdAt` and `resolvedAt` | analytics/dashboard chart | Backend |
| Pending leave preview duration | `dashboard.service.ts` | `/home/summary` | `LeaveRequest` | local Mon-Sat loop | home preview | Backend duplicate |
| WorkdayBar active time | `WorkdayBar.tsx` | `/workday/today` | `WorkSession`, `BreakLog` | backend seed plus frontend `Date.now()` delta | dashboard layout | Mixed |
| Dashboard greeting/date | `dashboard/page.tsx` | none | browser clock | `new Date().getHours()` and local date | dashboard header | Frontend |
| Recent activity relative time | `RecentActivityFeed.tsx`, `activity-item.tsx` | activity APIs | event timestamps | `Date.now() - timestamp` labels | dashboard/home | Frontend display |
| Upcoming event labels | `UpcomingEvents.tsx` | `/home/summary` | event dates | local today/tomorrow comparison | home | Frontend display |

## CRITICAL Frontend Business-Time Calculation

Any frontend calculation of official business time must be flagged Critical.

| ID | Metric | File | Why Critical |
| --- | --- | --- | --- |
| TVA-DB-001 | Active workday minutes | `frontend/components/workday/WorkdayBar.tsx` | Calculates work minutes with `Date.now()` on top of backend `elapsedWorkMinutes`. This can disagree with backend/team/history. |

## Backend Dashboard Strengths

- `countOverdueTickets` delegates to `TicketTimingService`.
- `getWorkdayStatus` delegates to `calculateWorkdayRuntime`.
- role-scoped ticket and leave queries are centralized.

## Dashboard Risks

| Risk | Severity | Evidence |
| --- | --- | --- |
| WorkdayBar mixed calculation | Critical | `WorkdayBar.tsx` live effect |
| Home pending leave duration duplicates leave rules | Medium | local function in `dashboard.service.ts`; backend leave authority is `LeaveBalanceService` |
| Team active status counts read `User.currentStatus`, not work sessions | High | `dashboard.service.ts` counts `currentStatus` |
| Frontend date labels use browser timezone | Medium | dashboard page and home components |

## Dashboard TVA Status

Backend: mostly compliant.

Frontend: partial violation due WorkdayBar.

Production confidence: unverified in this pass beyond code and DB inspection.

