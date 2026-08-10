# Sales CRM — shell

**Status:** Frontend compartmentalised. Backend deferred.
**Compartmentalised:** 2026-08-10 (Phase 2B)
**Debt identifier:** `DEBT-P2B5-SALES-CRM-SHELL-LEGACY-FRONTEND` (3 imports, scheduled)

## Ownership

The CRM workspace chrome: `SalesCrmShell` composing `Sidebar` and `Topbar`,
plus `PlannedPane` for the two placeholder routes.

Both `shell.module.css` (484 ln) and `tokens.module.css` (210 ln) are
exclusively shell-owned — verified no consumer anywhere outside the folder —
so both moved into the component and are imported by relative path.

**Order matters here.** `SalesCrmShell` imports `tokens.module.css` *before*
`shell.module.css`, and both apply to the same nodes. That relative order is
preserved exactly.

## Public API

| Specifier | Why |
| --- | --- |
| `@apex/sales-crm-shell` → `SalesCrmShell` | consumed by the CRM layout |
| `@apex/sales-crm-shell` → `PlannedPane` | rendered directly by `/deals` and `/requirements-sourcing` |

The two differ in export shape — `SalesCrmShell` is a default export,
`PlannedPane` a named one — and each is re-exported exactly as declared.

## Scheduled debt

3 imports into `lib/sales-crm/{theme,dashboard-calculations}`, resolved by the
library split.

## Behaviour

No layout, navigation, sidebar collapse, topbar or shell state changed.
