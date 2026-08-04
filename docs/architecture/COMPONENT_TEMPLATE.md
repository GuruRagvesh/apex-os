# Component Template

**Status:** Canonical
**Date:** 2026-08-04

The shape every vertical-slice component takes. A component is the unit that
owns code: one responsibility, its own UI, its own API, its own contracts, its
own tests.

---

## Full shape

```
platforms/<platform>/<module>/<component>/
├── frontend/
│   ├── screens/          route-level views
│   ├── components/       view pieces used by this component's screens
│   ├── hooks/            React hooks scoped to this component
│   ├── api/              client-side API adapter
│   ├── state/            stores/context owned by this component
│   └── index.ts          public frontend surface
├── backend/
│   ├── controllers/      HTTP route handlers
│   ├── services/         business logic
│   ├── policies/         authorization and access rules
│   ├── repositories/     database access
│   ├── dto/              request/response shapes
│   ├── jobs/             scheduled work owned by this component (optional)
│   └── index.ts          public backend surface (module + contracts)
├── shared/
│   ├── contracts/        request/response types crossing the boundary
│   ├── events/           events this component publishes
│   ├── enums/            enumerations owned here
│   ├── types/            shared domain types
│   └── index.ts          public shared surface
├── tests/
│   ├── frontend/
│   ├── backend/
│   ├── integration/
│   └── e2e/
├── docs/
│   └── README.md         what this component is, its rules, its known issues
└── index.ts              the component's public entry point
```

---

## Create folders only when files exist

**This full tree is a target, not a scaffold to stamp out.** Creating empty
directories under every platform would be worse than leaving them absent: it
implies structure that does not exist, and it makes "is this built?"
unanswerable by looking.

A component starts as:

```
platforms/business/sales-crm/leads/
├── backend/
│   ├── services/leads.service.ts
│   └── index.ts
└── index.ts
```

and grows the rest as real files arrive. If a component has no frontend, it has
no `frontend/` folder.

This is why `regularization/`, `daily-attendance/`, `performance/`, `finance/`
and `training-delivery/` do not exist — they have Prisma models or placeholder
stubs, but no code.

---

## The public entry point

`index.ts` at the component root is the **only** thing other components may
import. It re-exports the narrow surface this component intends to publish:

```ts
// platforms/operations/tickets/lifecycle/index.ts
export { TicketsModule } from './backend';
export type { TicketSummary, TicketStatus } from './shared/contracts';
export { TicketList } from './frontend';
```

Everything not exported here is private. The boundary validator enforces this:
reaching into `<component>/backend/services/...` from another component is a
build-breaking violation.

### Why this matters

Without it, "modular" is decoration. Any file being importable from anywhere
means every refactor is a cross-cutting change and no component can be reasoned
about in isolation.

---

## Sub-surface index files

`frontend/index.ts`, `backend/index.ts` and `shared/index.ts` exist so the root
`index.ts` can compose them cleanly. They are **not** additional public entry
points for other components — only the component root `index.ts` is public.

---

## `docs/README.md`

Every component documents itself. At minimum:

- What this component is responsible for.
- What it deliberately does not do.
- Its public surface (what `index.ts` exports and why).
- Business rules that must not regress.
- Known issues, with dates.
- `DORMANT` marker if the code exists but nothing imports it.

---

## Jobs

Scheduled work belongs to the component whose data it touches, in
`backend/jobs/`. `system/scheduler` provides the cron mechanism; it owns no
jobs.

A Workday auto-close job lives in
`workforce/attendance/workday/backend/jobs/` and calls the shared finalizer
directly — a legal same-component call. That is what keeps `system → workforce`
out of the dependency graph.

---

## Tests

Tests live with their component, split by kind. E2E specs live here too, even
though the Playwright **runner** is centralized in `apps/e2e/` — the runner
discovers specs across `platforms/`.

A test that needs another component's internals is testing the wrong thing, or
that internal should be public.

---

## Worked example

```
platforms/workforce/attendance/workday/
├── frontend/
│   ├── screens/WorkdayScreen.tsx
│   ├── components/{WorkdayBar,EndDayModal,AutoCloseConsentModal}.tsx
│   ├── hooks/useWorkdayReminders.ts
│   ├── api/workday.api.ts
│   └── index.ts
├── backend/
│   ├── controllers/workday.controller.ts
│   ├── services/{workday.service,workday.calculation}.ts
│   ├── policies/workday.policy.ts
│   ├── repositories/attendance-authority.repository.ts
│   ├── jobs/{auto-close,auto-logout,end-reminder}.job.ts
│   ├── workday.module.ts
│   └── index.ts
├── shared/
│   ├── contracts/workday.contracts.ts
│   ├── enums/workday-status.enum.ts
│   └── index.ts
├── tests/
│   ├── backend/{workday.finalize-session,workday.calculation}.spec.ts
│   └── e2e/wf10-workday-attendance.spec.ts
├── docs/README.md
└── index.ts
```

Related: [`VERTICAL_SLICE_MIGRATION_MAP.md`](VERTICAL_SLICE_MIGRATION_MAP.md),
[`PUBLIC_API_CONVENTIONS.md`](PUBLIC_API_CONVENTIONS.md).
