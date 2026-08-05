# Sales CRM — Shared Component

Foundation shared by every Sales CRM component. Migrated in **Phase 2A**.

## Ownership

This component owns the Sales CRM concerns that more than one Sales CRM
component depends on: the domain model, role policy, reference data, the auth
adapter, the audit-log store, and the data-mode connector.

It owns nothing feature-specific. Leads screens, dashboard widgets, analytics
calculations, settings forms and database views stay with their own components.

## Public API

`@apex/sales-crm-shared` — the component root — is the **only** importable path.
The alias is declared in `frontend/tsconfig.json` and in
`architecture-boundaries.json` under `componentAliases`, so the validator
resolves it rather than treating it as an external package.

Reaching past it is a boundary violation and is enforced:

```ts
import { Role, useAuth } from '@apex/sales-crm-shared';                       // OK
import { useAuth } from '@apex/sales-crm-shared/frontend/api/auth-adapter';   // rejected
```

### `shared/` — framework-independent

Nothing here imports React, Next or Nest, so a future Sales CRM backend slice
can consume it unchanged.

| Export | Source |
| --- | --- |
| `Role` (enum — a value, not only a type) | `shared/types/index.ts` |
| `User`, `ColumnConfig`, `NavItem`, `AuthState`, `LeadStage`, `Activity`, `FollowUp`, `Requirement`, `Deal`, `Lead`, `CompanyMaster`, `CompanyAlias`, `ExternalCompanySuggestion` | `shared/types/index.ts` |
| `AuditAction`, `AuditCollection`, `AuditLogRecord` | `shared/types/audit.ts` |
| `APP_NAME`, `NAVIGATION_ITEMS`, `ROLE_LABELS`, `ROLE_COLORS`, `MOCK_USERS` | `shared/constants/constants.ts` |
| `MOCK_LEADS` | `shared/constants/mock-data.ts` |
| `getCountryCodes`, `getDefaultCountryCode`, `CountryCodeOption` | `shared/constants/country-codes.ts` |
| `CONTACT_FIELDS` and the `can*` / `is*Visible` predicates | `shared/constants/permissions.ts` |

`permissions.ts` sits under `constants/` rather than a layer of its own: it is
pure policy over the role constants beside it, with no behaviour and no I/O.

`country-codes.ts` reads `shared/constants/data/countries.json`, which moved
with it. `resolveJsonModule` is already enabled in `frontend/tsconfig.json`.

### `frontend/` — browser-side

| Export | Source |
| --- | --- |
| `useAuth`, `mapApexRoleToCrmRole`, `UseAuthResult` | `frontend/api/auth-adapter.ts` |
| `logAction`, `useAuditLogs` | `frontend/api/audit-log.ts` |
| `SALES_CRM_DATA_MODE`, `isMockMode`, `resolveDataSource`, `isSalesLeadsBackendEnabled`, `SalesCrmDataMode` | `frontend/api/api-connector.ts` |

`isSalesLeadsBackendEnabled()` is the Sales CRM Leads feature flag. It reads
`NEXT_PUBLIC_SALES_CRM_LEADS_BACKEND_ENABLED` and defaults to mock unless the
value is exactly `"true"`. Phase 2A moved the file without touching that logic.

## Consumers

- `platforms/business/sales-crm/leads/` — the migrated Leads slice.
- `frontend/components/sales-crm/{analytics,dashboard,database,settings,shell,ui}/`
  — feature screens that have **not** migrated yet. They import
  `@apex/sales-crm-shared` from their legacy location, which is allowed and is
  why there is exactly one implementation of each shared concern.
- `frontend/lib/sales-crm/{company/company-repository,dashboard-calculations,settings-store,types/settings}.ts`
  — legacy stores that previously reached these files by relative path.

## Styles

**This component owns no stylesheets.** The Sales CRM CSS modules remain in
`frontend/styles/sales-crm/`.

`primitives.module.css` is genuinely shared — every Sales CRM component uses
it — but it is applied to the same elements as `leads.module.css`, and routing
a CSS module through this component's barrel would change its position in the
bundle graph. Cascade order between the two decides which declaration wins.
Phase 2A declined that visual-regression risk for a phase whose contract is
"no UI change". Both stylesheets move together in a later phase, when all their
consumers have migrated and the ordering can be verified in one step.

## Temporary legacy dependencies

One, and it is deliberately as small as it can be.

### `DEBT-P2A-SALES-CRM-AUTH-STORE`

`frontend/api/auth-adapter.ts` → `frontend/store/auth.store.ts`

The adapter maps an Apex identity onto a CRM `Role`. It is the single point of
contact between Sales CRM and the application-wide Zustand auth store, which
belongs to the identity platform and must not move during a Sales CRM phase.

The exemption names that **one exact file**. It is proved narrow by tests that
reject a sibling in the same folder (`audit-log.ts`) and another platform
(`workday`) making the same import.

**Removed when** the auth store migrates to `platforms/core/identity/` and the
adapter imports it through that component's public entry point.

Every other Sales CRM file consumes `useAuth()` from this component. None of
them import the store.

## Forbidden dependency directions

- `shared/` must not import `frontend/` — it would drag React into the
  framework-independent surface a future backend slice depends on.
- This component must not import any other Sales CRM component. It is the
  bottom of the Sales CRM graph; importing Leads or dashboard would create a
  cycle.
- No `platforms/**` file may import `backend/**`. There is no exemption
  mechanism for it.
- No consumer may address a path inside this component.

## Related debts owned elsewhere

Both are carried by the Leads slice, not by this component:

- `DEBT-P2A-LEADS-OWNED-LEGACY-ASSETS` — the two stylesheets plus
  `CompanyAutocomplete` and `CountryCodeSelect`. Those two controls have
  exactly one consumer (Leads), so moving them here would create a shared
  module that nothing shares.
- `DEBT-P2A-SALES-CRM-API-CLIENT` — `salesCrmLeadsApi` in `frontend/lib/api.ts`,
  which rides the shared axios instance carrying the auth interceptor and the
  401 redirect.

See `architecture-boundaries.json` for the exact allowlists and removal
conditions.
