# Sales CRM — settings

**Status:** Frontend compartmentalised. Backend deferred.
**Compartmentalised:** 2026-08-10 (Phase 2B)
**Debt identifier:** `DEBT-P2B4-SALES-CRM-SETTINGS-LEGACY-FRONTEND` (14 imports, all scheduled)

## This is CRM settings, not Apex OS settings

Scope is CRM-scoped configuration only: CRM field configuration, CRM role
permissions, integrations, audit logs and CRM data import/backup. The Apex OS
global settings route (`/settings`) is a different, unmigrated screen.

**Verified before moving:** this component carries **no** `auth.store`,
`authApi`, workday, attendance or scheduler dependency. Its `RolePermissions`
and `UserManagement` panels operate on the CRM settings store, not on Apex OS
identity.

## Ownership

10 components; `SalesCrmSettings` composes the other nine, which stay internal.
`settings.module.css` (2128 ln) is exclusively settings-owned and moved
**byte-identically** — no selector, declaration, class name or line of
formatting changed. Its ten sibling consumers import it by relative path.

## Route

`/sales-crm/settings` — unchanged, a thin adapter.

## Scheduled debt

14 imports: `lib/sales-crm/settings-store` (7), `lib/sales-crm/types/settings`
(6) and `ui/ConfirmModal` (2)  — the first two resolved by the library split,
the third by the ui-ownership commit.

## Behaviour

No configuration, permission, integration, import, backup or audit behaviour
changed.
