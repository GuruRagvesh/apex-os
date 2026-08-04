# platforms/business/

Business-line applications that run *on* Apex OS rather than being part of the
core operating system.

**Status: Phase 0 — empty scaffold.** Live code remains in
`backend/src/modules/business/sales-crm/`, `frontend/components/sales-crm/`
and `frontend/lib/sales-crm/`. Migrates **first, in Phase 1** — this is the
pilot.

## Planned modules

| Module | Components |
| --- | --- |
| `sales-crm/` | `leads`, `dashboard`, `analytics`, `database`, `deals`, `requirements`, `settings` |

`dashboard` and `analytics` stay **separate** components — they are distinct
surfaces (12 and 8 components respectively), and collapsing them would obscure
which screens are which.

Deliberately absent: `finance/` and `training-delivery/` exist only as
placeholder `index.ts` stubs with no implementation. Not scaffolded.

## Why Sales CRM is the migration pilot

Lowest blast radius in the repository:

- 86 files, already self-contained under `sales-crm/` prefixes in four trees.
- Backend is feature-flagged dark
  (`NEXT_PUBLIC_SALES_CRM_LEADS_BACKEND_ENABLED`, defaults off).
- The whole workspace is route-gated to ADMIN/SUPER_ADMIN.
- A mistake here cannot affect attendance, tickets, or payroll-adjacent data.

## Dependency direction

```
allowed:    business/ → core/ (auth, users), shared/, database/client
forbidden:  business/ → workforce/, operations/
forbidden:  business/ → apps/
forbidden:  any core platform → business/
```

Business-line applications are leaves. Core Apex OS must never depend on a
business platform — if `operations/tickets` imported `business/sales-crm`,
removing the CRM would break ticketing.

## Must not live here

- Anything the rest of Apex OS depends on. If a business module builds
  something genuinely reusable, it moves to `shared/` or a core platform first.
