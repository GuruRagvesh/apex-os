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

Phase 2B moved **`primitives.module.css`** here, to
`frontend/styles/primitives.module.css`. 37 of its 51 importers are Sales CRM
feature screens other than Leads, so it is genuinely shared.

It is published as an **exact public style subpath**, never through the
JavaScript barrel above:

```ts
import ui from '@apex/sales-crm-shared/styles/primitives.module.css';           // correct
import { ui } from '@apex/sales-crm-shared';                                    // never — barrel
import ui from '@apex/sales-crm-shared/frontend/styles/primitives.module.css';  // never — internal path
```

The third line reaches the **same physical file** and is still rejected.
Approval matches the **original import specifier**, not the resolved path, so a
public asset has exactly one public spelling. It also fails to resolve at build
time: `frontend/tsconfig.json` maps `@apex/sales-crm-shared/styles/*` and
nothing under `frontend/`.

**Why not the barrel.** A CSS module routed through a JS barrel changes its
position in the bundle graph, and therefore its cascade order against other
stylesheets applied to the same elements — `primitives.module.css` and
`leads.module.css` are applied together on the same nodes, so a reordering
silently changes which declaration wins. Publishing by exact path keeps each
consumer's stylesheet imports in their original positions.

The alias is declared in three places that must stay in agreement:

| Where | Entry |
| --- | --- |
| `frontend/tsconfig.json` | `"@apex/sales-crm-shared/styles/*"` |
| `architecture-boundaries.json` → `componentAliases` | `"@apex/sales-crm-shared/styles"` |
| `architecture-boundaries.json` → `publicStyleSubpaths.specifiers` | exact specifier → exact repository path |

`publicStyleSubpaths` is an **exact specifier allowlist, not a directory**.
Another stylesheet dropped beside `primitives.module.css` is still private, and
the entry only counts if the specifier resolves to the path it is declared
against — so a drifting alias in `frontend/tsconfig.json` cannot silently widen
what is public. Self-tests cover the canonical alias, the internal-path
spelling, an unapproved neighbour, and both dynamic `import()` and `require()`.

`leads.module.css` is **not** here. It went to the Leads component, where all
16 of its importers live.

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

Both are carried by the Leads component, not by this one:

- `DEBT-P2A-SALES-CRM-API-CLIENT` (6) — `salesCrmLeadsApi` in
  `frontend/lib/api.ts`, which rides the shared axios instance carrying the
  auth interceptor and the 401 redirect.
- `DEBT-P2B-LEADS-COMPANY-REPOSITORY` (1) — `CompanyAutocomplete` still calls
  `LocalStorageCompanyRepository`, which could not move: it has a second
  importer and it reads `MOCK_CLIENTS` from the unmigrated Sales CRM
  **database** component. It was deliberately not placed here, because that
  would make this component depend on a feature's mock data.

`DEBT-P2A-LEADS-OWNED-LEGACY-ASSETS` (30) was **removed** in Phase 2B:
`leads.module.css` and both controls went to Leads, `primitives.module.css`
came here. Total Sales CRM debt is now **8** imports, down from 37.

See `architecture-boundaries.json` for the exact allowlists and removal
conditions.
