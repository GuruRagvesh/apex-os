# Operations Tickets — lifecycle (visibility contract only)

**Status:** Visibility contract compartmentalised. Screens and backend NOT migrated.
**Compartmentalised:** 2026-08-11 (Tickets Phase T1)
**Debt identifier:** none — zero legacy dependencies.

## This component defines no transitions

The allowed-status matrix lives **only** in
`backend/src/common/services/ticket-access.service.ts`
(`assertCanTransitionTicket`). This component maps a status to presentation:
labels, dot colours, and the rule that **DONE and CLOSED never render as
overdue**.

A contract test enforces that nothing under `platforms/operations/tickets/`
declares a transition map, a permission rule or a scope rule.

## Contents

| File | Lines | Role |
| --- | --- | --- |
| `shared/ticket-visibility.ts` | 120 | status presentation contract — pure, zero imports |

## Public API

`@apex/operations-tickets-lifecycle` — the visibility contract.

## Not migrated

The lifecycle **screens** — `/tickets`, `/tickets/[id]`, `/kanban` — remain
legacy. `/tickets/[id]` is 2,093 lines and also renders review/rework; the map
flags it ⚠️. They are Phase T2/T4 and need browser and staging validation.
