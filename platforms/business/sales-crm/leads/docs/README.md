# Sales CRM — Leads

**Status:** Frontend migrated (Phase 1A). Backend deferred to Phase 1B.
**Migrated:** 2026-08-04
**Shared dependencies extracted:** 2026-08-05 (Phase 2A)
**Legacy assets reclaimed:** 2026-08-05 (Phase 2B)
**API ownership moved:** 2026-08-05 (Phase 2C)
**Debt identifiers:** `DEBT-P2B-LEADS-COMPANY-REPOSITORY`,
`DEBT-P2C-LEADS-GLOBAL-USERS-API`

The first vertical slice migrated under the Platform → Module → Component
architecture. Chosen as the pilot because it is the lowest-risk feature in the
repository: flagged dark, admin-gated, and self-contained.

---

## Ownership

This component owns lead capture, listing, filtering, detail view, activities,
follow-ups, requirements, deals, and column configuration for the Sales CRM
Leads surface.

**Migrated here (18 files):**

| Area | Contents |
| --- | --- |
| `frontend/screens/` | `SalesCrmLeads.tsx` — the route-level screen |
| `frontend/components/` | 13 view components (list, detail, tabs, modals, filters, stats, column manager) |
| `frontend/api/` | `lead-adapter.ts` (backend↔frontend shape mapping), `lead-calculations.ts` (stats, filter/sort) |
| `shared/types/` | `stage-forms.ts` (stage field config), `date-utils.ts` (UTC-drift-safe date helpers) |

**Reclaimed in Phase 2B (2026-08-05):**

| Area | Contents | Why Leads-owned |
| --- | --- | --- |
| `frontend/styles/` | `leads.module.css` (1407 lines, 196 classes) | All 16 importers are Leads files, once the two controls below moved. |
| `frontend/components/` | `CompanyAutocomplete.tsx`, `CountryCodeSelect.tsx` | Each had exactly **one** repository consumer — `LeadCreate.tsx`. |

These are **component-internal**. They are not re-exported, and the validator
rejects any external component importing them — including through the
`@apex/sales-crm-leads` alias, by dynamic `import()` and by `require()`.

**Not here — deliberately:**

- Backend controller, service, access policy and Nest module remain in
  `backend/src/`. See [Backend deferral](#backend-deferral-phase-1b).
- Sales CRM shared code (types, auth adapter, audit log, permissions,
  constants, mock data, country codes, API/data-mode connector) is owned by the
  **`shared` component** as of Phase 2A and consumed here through
  `@apex/sales-crm-shared`. See
  [Temporary legacy dependencies](#temporary-legacy-dependencies).

---

## Browser route

```
/sales-crm/leads
```

**Unchanged by the migration.** The route file
`frontend/app/(workspaces)/sales-crm/leads/page.tsx` is a thin adapter that
imports only this component's public entry point:

```tsx
import { SalesCrmLeads } from '@apex/sales-crm-leads';

export default function SalesCrmLeadsPage() {
  return <SalesCrmLeads />;
}
```

It must never import an internal file path such as
`.../leads/frontend/screens/SalesCrmLeads`.

## Role gate

Authorization is enforced by the **parent layout**
(`frontend/app/(workspaces)/sales-crm/layout.tsx`), not by this component:

- **ADMIN** and **SUPER_ADMIN** only.
- MANAGER, TEAM_LEAD, EMPLOYEE and INTERN are denied for the entire
  `/sales-crm` tree.
- Unauthenticated users are redirected to `/login`.

This component does not re-implement that gate and must not weaken it.

## Feature flag

```
NEXT_PUBLIC_SALES_CRM_LEADS_BACKEND_ENABLED
```

Read by `isSalesLeadsBackendEnabled()`, published from the Sales CRM `shared`
component as `@apex/sales-crm-shared` (Phase 2A moved the file from
`frontend/lib/sales-crm/api-connector.ts` without changing the flag logic).

| Value | Behaviour |
| --- | --- |
| exactly `"true"` | Backend mode — calls `/api/sales-crm/leads` via `salesCrmLeadsApi` |
| absent, empty, or any other value | **OFF** — mock/local data, **zero** Sales CRM Leads backend requests |

Currently commented out in both `.env.example` files, so it is **off in every
environment**. The migration changed neither the flag, its default, nor any
call site — the check is a pure function of an environment variable and is
unaffected by file location.

---

## Public exports

Import only from `@apex/sales-crm-leads` (the component root `index.ts`).

| Export | From |
| --- | --- |
| `SalesCrmLeads` | the screen |
| `getLeadsStats`, `filterAndSearchLeads` | `frontend/api/lead-calculations` |
| `LeadsStatsData`, `LeadFilterState`, `LeadSortState` | types |
| `mapBackendLead`, `mapBackendActivity`, `mapBackendFollowUp`, `mapBackendRequirement`, `mapBackendDeal`, `buildCreatePayload` | `frontend/api/lead-adapter` |
| `STAGE_FORMS` + stage config types | `shared/types/stage-forms` |
| `getLocalTodayISO`, `getLocalTomorrowISO`, `isStrictFutureDate`, `isTodayOrPastDate` | `shared/types/date-utils` |

The 13 view components are **internal** and intentionally not re-exported.

---

## Temporary legacy dependencies

Sales CRM shared imports now use:

```ts
import { Role, useAuth, logAction, isSalesLeadsBackendEnabled } from '@apex/sales-crm-shared';
```

Shared Sales CRM code comes from the component's public entry point; its styles
come from the declared public style subpath — **not** the JavaScript barrel,
which would change bundle position and cascade order:

```ts
import { useAuth, Role } from '@apex/sales-crm-shared';                 // shared code
import { salesCrmLeadsApi } from '@apex/sales-crm-shared/api';          // shared HTTP API
import styles from '../styles/leads.module.css';                        // own asset
import ui from '@apex/sales-crm-shared/styles/primitives.module.css';   // shared asset
```

Since Phase 2C this component makes **no** direct HTTP calls: `salesCrmLeadsApi`
is owned by the Sales CRM `shared` component and built on the application's
single authenticated client in `shared/auth`. Nothing here imports axios, reads
a token or handles a 401.

The API comes from the `/api` subpath rather than the root barrel on purpose —
the barrel is kept free of HTTP infrastructure so screens that need only types,
constants or styles do not load axios.

**Current remaining migration debt:**

| Identifier | Imports | Removal phase |
| --- | --- | --- |
| `DEBT-P2B-LEADS-COMPANY-REPOSITORY` | 1 | Phase 2D |
| `DEBT-P2C-LEADS-GLOBAL-USERS-API` | 1 | Phase 3 |
| `DEBT-P2A-SALES-CRM-AUTH-STORE` | 1 | Phase 3 |

**Total remaining debt: 3 imports.** Phase 1A: **90** → Phase 2A: **37** →
Phase 2B: **8** → Phase 2C: **3**. `DEBT-P2A-SALES-CRM-API-CLIENT` (6) is
**removed**.

`DEBT-P2A-SALES-CRM-AUTH-STORE` is not carried by this component — it belongs to
the `shared` component's auth adapter and is listed here only to account for the
full 3.

### Moved to the `shared` component in Phase 2A

- types
- auth adapter
- audit log
- permissions
- constants
- mock data
- country codes
- API/data-mode connector

### Reclaimed by this component in Phase 2B

- `leads.module.css` → `frontend/styles/`
- `CompanyAutocomplete` → `frontend/components/`
- `CountryCodeSelect` → `frontend/components/`

`primitives.module.css` went to the **shared** component instead, because 37 of
its 51 importers are other Sales CRM features. It is published as an exact
public style subpath rather than a barrel export.

### Intentionally still legacy

| Kept in `frontend/` | Why |
| --- | --- |
| `LocalStorageCompanyRepository` (1 import, from `CompanyAutocomplete` only) | It could not follow the control into Leads: it has a second importer (`frontend/lib/sales-crm/storage.ts`) and it reads `MOCK_CLIENTS` from `database-data.ts`, owned by the unmigrated Sales CRM **database** component. Moving it into Leads would drag a database-owned dependency along; moving it into `shared` would make shared depend on a feature's mock data. Both invert ownership. |
| Application-wide `usersApi` (1 import, from the Leads screen only) | The screen calls `usersApi.getAll()` once, to populate the assignable lead-owner list. `usersApi` is an application-wide group used by 20 files across attendance, tickets, projects and admin — not a Sales CRM concern. Re-implementing `GET /users` inside Sales CRM to satisfy a boundary would duplicate an existing application API, which is worse than recording the dependency. |
| Application-wide auth store (`frontend/store/auth.store.ts`) | Owned by the identity platform. Only the `shared` auth adapter may touch it; every Sales CRM file consumes `useAuth()` instead. |
| Settings-owned types (`frontend/lib/sales-crm/types/settings.ts`) | Belongs to the unmigrated `settings` component, not to shared code. Not a Leads dependency. |

**These are visible, not hidden.** The validator resolves `@/…` to
`frontend/…` specifically so this debt is reported on every run rather than
silently skipped as an external package. Phase 2A additionally declared
`componentAliases` in `architecture-boundaries.json` so `@apex/sales-crm-leads`
and `@apex/sales-crm-shared` are resolved too — previously they were treated as
bare packages, which meant an import reaching into a component's internals
through its alias was invisible.

### Removal conditions

`DEBT-P2B-LEADS-COMPANY-REPOSITORY` is removed when the Sales CRM **database**
component migrates (giving `database-data.ts` an owner), `LocalStorageCompanyRepository`
and its `normalization` helper move to that owner or to the `shared` component,
and `CompanyAutocomplete` consumes it through a public entry point.

`DEBT-P2C-LEADS-GLOBAL-USERS-API` is removed when `core/users` migrates to
`platforms/core/users` with a public entry point and the Leads screen resolves
assignable owners through it.

No other component may use these exemptions. Self-tests prove that a sibling
Leads component cannot reuse the company-repository exemption, that a sibling
Sales CRM component and an unrelated platform are both rejected for the same
import, and that every path Phase 2A and Phase 2B migrated away is no longer
allowlisted.

---

## Backend deferral (Phase 1B)

The backend slice was **not** migrated. This was a deliberate decision from the
Phase 1 audit, not an omission.

`backend/tsconfig.json` sets `"rootDir": "./src"`. Importing anything outside
`src/` produces **TS6059**. Widening `rootDir` changes the emit layout from
`dist/main.js` to `dist/backend/src/main.js`, which breaks both
`backend/package.json`'s `start` script and `render.yaml`'s
`startCommand: node dist/main.js` — a deployment-root change that Phase 1
explicitly forbids.

**Still in place, unchanged:**

```
backend/src/modules/business/sales-crm/leads.controller.ts
backend/src/modules/business/sales-crm/leads.service.ts
backend/src/modules/business/sales-crm/sales-crm.module.ts
backend/src/common/services/sales-access.service.ts   ← Leads-only despite living in common/
```

Phase 1B must design a `tsconfig.build.json` / `outDir` strategy that preserves
`node dist/main.js` before any backend file moves.

⚠️ **Route-order hazard for Phase 1B:** `@Patch('bulk')` is declared *before*
`@Patch(':id/owner')` in the controller. Nest matches in declaration order —
reordering would make `/bulk` match `:id`. Declaration order must be preserved
exactly.

---

## Validation requirements

Any change to this component must pass:

```bash
npm run architecture:test    # 26 self-tests, incl. exemption narrowness
npm run architecture:check   # live scan; debt count reported, not hidden
cd frontend && npm run build # must stay at 38/38 static pages
cd backend  && npm run build # must remain unaffected
```

Manual verification:

- `/sales-crm/leads` loads and renders the lead list.
- ADMIN and SUPER_ADMIN can access; MANAGER, TEAM_LEAD, EMPLOYEE, INTERN cannot.
- Flag **OFF** → mock data, and **zero** `/api/sales-crm/leads` requests in the
  network tab.
- Flag **ON** → tested against the **staging** backend and staging database only.

**No test may connect to the production database.**

There are currently **no automated tests** for this component — no backend spec
references `LeadsService`/`LeadsController`/`SalesAccessService`, no frontend
tests exist in the repository, and there is no Leads E2E spec. That is a real
coverage gap, not a passing result.
