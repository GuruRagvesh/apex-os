# Operations Tickets — SLA (frontend presentation)

**Status:** Frontend presentation compartmentalised. Backend NOT migrated.
**Compartmentalised:** 2026-08-11 (Tickets Phase T1)
**Debt identifier:** none — this component carries zero legacy dependencies.

## This component computes no SLA

`backend/src/common/services/ticket-timing.service.ts` remains the **sole SLA
authority**. It derives `executionDueAt`, `reviewDueAt`, `timerType` and
`isOverdue` from the `AppSetting` SLA config and writes them onto the ticket.

`computeClientTimingState()` reads that state and turns it into labels and
colours. It returns `DONE_STATE` when `timerType` is `completed`, `cancelled` or
`none`, and renders `blocked` when the backend says the SLA is paused.

A contract test enforces this: the file must keep reading `backendTiming`,
`timerType` and `isOverdue`, and must not contain `getSlaConfig`, `slaHours`,
`addHours` or `setHours(`.

## Contents

| File | Lines | Role |
| --- | --- | --- |
| `shared/ticket-timing.ts` | 134 | timing presentation contract — pure, zero imports |
| `frontend/components/OverdueTicker.tsx` | 94 | live countdown/overdue badge |

## Public API

| Specifier | Purpose |
| --- | --- |
| `@apex/operations-tickets-sla` | the pure timing contract |
| `@apex/operations-tickets-sla/components/OverdueTicker` | exact subpath |

**OverdueTicker is deliberately not on the barrel.** It is React presentation
with a live interval; routing it through the root barrel would pull it into
every consumer that only wants the timing contract. Same rule as `PlannedPane`
in Sales CRM Phase 2B.

## Behaviour

Unchanged. Countdown labels, overdue severity thresholds, colour classes and the
blocked/paused rendering are all as they were.
