# TVA_VIOLATIONS.md

Date: 2026-06-06
Mode: Read-only forensic audit

## Definition

A TVA violation exists when the same metric is calculated in multiple places or when a time-derived state is written by multiple authorities without a single source of truth.

## Violations

### TVA-001

Metric: Worked minutes today

Dashboard/Backend: `calculateWorkdayRuntime`.

WorkdayBar: frontend `Date.now()` live calculation seeded by backend elapsed.

Violation: WorkdayBar can double count or drift because backend elapsed already includes open-session runtime.

Severity: Critical.

Files:

- `backend/src/modules/platform/workday/workday.calculation.ts`
- `frontend/components/workday/WorkdayBar.tsx`

### TVA-002

Metric: End-day worked minutes

Backend: `WorkdayService.endWork`.

Frontend: `EndDayModal` computes local elapsed from `startWorkAt`.

Violation: modal may show a different total than backend saves.

Severity: High.

Files:

- `backend/src/modules/platform/workday/workday.service.ts`
- `frontend/components/workday/EndDayModal.tsx`

### TVA-003

Metric: Live team status

Source A: `User.currentStatus`.

Source B: `WorkSession.status`.

Source C: workday runtime sessions.

Violation: status label and minutes are derived from different authorities.

Severity: High.

Files:

- `backend/src/modules/platform/workday/workday.service.ts`
- `backend/src/modules/platform/dashboard/dashboard.service.ts`
- `frontend/app/(dashboard)/(operations)/team/page.tsx`

### TVA-004

Metric: Attendance/session state

Source A: workday actions.

Source B: auth login.

Source C: scheduler reset/auto-close/auto-logout.

Violation: multiple writers mutate `WorkSession` and `User.currentStatus`.

Severity: Critical.

Files:

- `backend/src/modules/platform/workday/workday.service.ts`
- `backend/src/modules/core/auth/auth.service.ts`
- `backend/src/modules/platform/scheduler/scheduler.service.ts`

### TVA-005

Metric: Ticket overdue/SLA

Dashboard/tickets: `TicketTimingService`.

Automation: `Date.now() - Ticket.createdAt > SLA`.

Violation: overdue notification can disagree with dashboard/ticket list.

Severity: Critical.

Files:

- `backend/src/common/services/ticket-timing.service.ts`
- `backend/src/modules/platform/automation/automation.service.ts`

### TVA-006

Metric: Ticket overdue/SLA in daily digest

Dashboard/tickets: `TicketTimingService`.

AI digest: `Date.now() - Ticket.createdAt > SLA`.

Violation: email digest can disagree with app.

Severity: Critical.

Files:

- `backend/src/common/services/ticket-timing.service.ts`
- `backend/src/modules/ai/ai.cron.service.ts`

### TVA-007

Metric: Analytics SLA breach

Operational SLA: due window from `TicketTimingService`.

Analytics SLA: `TicketTimeLog.durationSeconds` vs SLA hours.

Violation: same SLA label can represent different formulas.

Severity: Critical.

Files:

- `backend/src/common/services/ticket-timing.service.ts`
- `backend/src/modules/platform/analytics/analytics.service.ts`

### TVA-008

Metric: Ticket spent/productive time

Backend authority: `TicketTimeLog.durationSeconds`.

Frontend ticket detail: `Date.now() - actualStartAt` or `actualCompletedAt - actualStartAt`.

Violation: UI "spent so far" ignores breaks, logout, blocked time, and paused logs.

Severity: Critical.

Files:

- `backend/src/modules/operations/tickets/ticket-ledger.service.ts`
- `frontend/app/(dashboard)/(operations)/tickets/[id]/page.tsx`

### TVA-009

Metric: Ticket SLA countdown

Backend authority: `TicketTimingService`.

Frontend fallback: `computeClientTimingState` recomputes execution/review due state when backend timing is absent.

Violation: latent parallel SLA formula.

Severity: High.

Files:

- `backend/src/common/services/ticket-timing.service.ts`
- `frontend/lib/ticket-timing.ts`

### TVA-010

Metric: Leave duration

Backend authority: `LeaveBalanceService.calculateLeaveDuration`.

Dashboard/home preview: local Mon-Sat duration loop.

Leave page: frontend Mon-Sat duration loop.

Violation: frontend and dashboard duplicate leave duration and do not consistently include backend holiday/policy rules.

Severity: High.

Files:

- `backend/src/modules/operations/leave/leave-balance.service.ts`
- `backend/src/modules/platform/dashboard/dashboard.service.ts`
- `frontend/app/(dashboard)/(operations)/leave/page.tsx`

### TVA-011

Metric: Company date boundary

Authority: `TimezoneUtil.getCompanyTodayDate`.

Competing sources: auth login uses server local midnight; scheduler leave reset uses server local midnight; frontend due-today filters use browser local day.

Violation: "today" is not consistently company-timezone based.

Severity: High.

Files:

- `backend/src/common/utils/timezone.util.ts`
- `backend/src/modules/core/auth/auth.service.ts`
- `backend/src/modules/platform/scheduler/scheduler.service.ts`
- `frontend/app/(dashboard)/(operations)/tickets/page.tsx`

### TVA-012

Metric: Historical workday truth

Stored source: `WorkSession.totalWorkMinutes`, `totalBreakMinutes`.

Derived source: `calculateWorkdayRuntime`.

Violation: historical records contain impossible timelines and stored totals that cannot be trusted.

Severity: Critical.

Evidence: `TVA_HISTORICAL_FORENSICS.md`.

## Severity Counts

| Severity | Count |
| --- | ---: |
| Critical | 8 |
| High | 4 |
| Medium | 0 |
| Low | 0 |

