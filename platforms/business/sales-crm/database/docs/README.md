# Sales CRM — database

**Status:** Frontend compartmentalised. Backend deferred.
**Compartmentalised:** 2026-08-10 (Phase 2B)
**Debt identifier:** `DEBT-P2B3-SALES-CRM-DATABASE-LEGACY-FRONTEND` (7 imports, all scheduled)

## Ownership

5 components; `SalesCrmDatabase` composes the other four, which stay internal.
`database.module.css` (614 ln) is **exclusively database-owned** — no consumer
outside this folder — so it moved into the component and is imported by
relative path from its five siblings, keeping it out of every barrel.

## Route

`/sales-crm/database` — unchanged, a thin adapter importing
`{ SalesCrmDatabase } from '@apex/sales-crm-database'`.

## Scheduled debt

7 imports into `frontend/lib/sales-crm/{database-schema,database-utils,database-data}`,
all resolved by the library split, which runs last because a library file's
owner can only be read from consumers that have already migrated.

## Behaviour

No data, query, filter, table, import or duplicate-detection behaviour changed.
