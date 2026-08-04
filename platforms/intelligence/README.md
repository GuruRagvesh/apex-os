# platforms/intelligence/

Dashboard, analytics, reports and AI — the read-and-interpret layer.

**Status: Phase 0 — empty scaffold.** Live code remains in
`backend/src/modules/platform/{dashboard,analytics}/`,
`backend/src/modules/ai/` and `frontend/components/{home,dashboard}/`.
Migrates in **Phase 2**.

## Planned modules

| Module | Scope |
| --- | --- |
| `dashboard/` | Role-scoped landing dashboard, KPI capsules, critical alerts. Includes the unlinked `home-v2` preview route. |
| `analytics/` | Manager and company analytics. |
| `reports/` | Report generation and export. |
| `ai/` | AI-assisted summaries and suggestions. |

Deliberately absent: `performance/` has no dedicated code today — it is part of
analytics. Not scaffolded until it has content.

## This platform mostly reads

Intelligence aggregates data owned by other platforms. It should almost never
write. When a dashboard needs a number, it asks the owning platform through a
public contract rather than querying that platform's tables directly.

## A standing caveat

Workday and analytics data are **not currently authoritative** for salary,
penalty, or performance decisions — that is an explicit company rollout
decision, pending verification of the attendance engine. Any dashboard or
report that presents attendance-derived figures inherits that caveat and should
not imply more confidence than the underlying data supports.

## Dependency direction

```
allowed:    intelligence/ → core/, workforce/, operations/, business/ (public contracts)
allowed:    intelligence/ → shared/, database/client
forbidden:  intelligence/ → apps/
forbidden:  any platform → intelligence/
```

Nothing should depend on intelligence. It is a leaf — it consumes, it is not
consumed. If another platform needs something from here, the dependency is
pointing the wrong way.

## Must not live here

- Business rules owned by another platform. A dashboard that computes ticket
  SLA state itself has duplicated `operations/tickets/sla`.
