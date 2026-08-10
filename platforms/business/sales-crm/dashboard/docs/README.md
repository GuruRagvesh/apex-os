# Sales CRM — dashboard

**Status:** Frontend compartmentalised. Backend deferred.
**Compartmentalised:** 2026-08-10 (Phase 2B)
**Debt identifier:** `DEBT-P2B1-SALES-CRM-DASHBOARD-LEGACY-FRONTEND` (11 imports, all scheduled)

Per **D12**, `dashboard` and `analytics` are separate components. Neither may
reach into the other's internals — a self-test enforces it.

## Ownership

10 components; `SalesCrmDashboard` composes the other nine, which stay internal.

```
frontend/components/  SalesCrmDashboard, SalesDashboard, DashboardHeader,
                      TopKpiStrip, TodayActionBoard, LeadFunnel,
                      NeedsAttention, OwnerPerformance, QuickAdd, ShareModal
```

All ten kept their existing relative (`./X`) imports untouched, which is why
they stayed in one folder rather than splitting into `screens/` + `components/`.

## Routes

`/sales-crm` and `/sales-crm/dashboard` — unchanged, both thin adapters
importing `{ SalesCrmDashboard } from '@apex/sales-crm-dashboard'`.

## Why Toast and ExportModal left

Both were in `dashboard/` but consumed by **analytics** as well:

| Component | Consumers |
| --- | --- |
| `Toast` (19 ln) | dashboard, analytics/DashboardGrid, analytics/ReportsView |
| `ExportModal` (75 ln) | dashboard, analytics/ReportsView |

Neither takes a dashboard-specific prop. Leaving them here would have forced
analytics to import dashboard internals the moment it migrated — exactly what
D12 forbids. They moved to `sales-crm/shared/frontend/components/` and are
published by **exact path**, like the stylesheets.

## CSS

Stylesheets are **never** re-exported through this component's barrel. Both
`dashboard.module.css` and `primitives.module.css` arrive by exact path from
`sales-crm/shared`. A self-test asserts no Sales CRM barrel references a `.css`
file, because routing a CSS module through a JS barrel moves it in the bundle
graph and changes its cascade position.

## Scheduled debt

11 imports across four targets, **all with a scheduled removal**:

| Target | Resolved by |
| --- | --- |
| `lib/sales-crm/dashboard-calculations` (7) | the library split |
| `lib/sales-crm/analytics-store` (2) | the library split |
| `lib/sales-crm/report-output` (1) | the library split |
| `components/sales-crm/ui/Chart` (1) | the ui-ownership commit |

The library split runs **last** in Phase 2B on purpose: ownership of a library
file can only be read from its consumers, and those consumers have to migrate
first.

## Behaviour

No query, calculation, export, share, filter, chart, copy or style changed.
