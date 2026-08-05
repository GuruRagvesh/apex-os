# Sales CRM — Leads

**Status:** Frontend migrated (Phase 1A). Backend deferred to Phase 1B.
**Migrated:** 2026-08-04
**Shared dependencies extracted:** 2026-08-05 (Phase 2A)
**Debt identifiers:** `DEBT-P2A-LEADS-OWNED-LEGACY-ASSETS`,
`DEBT-P2A-SALES-CRM-API-CLIENT`

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

**Current remaining migration debt:**

| Identifier | Imports | Removal phase |
| --- | --- | --- |
| `DEBT-P2A-LEADS-OWNED-LEGACY-ASSETS` | 30 | Phase 2B |
| `DEBT-P2A-SALES-CRM-API-CLIENT` | 6 | Phase 2C |
| `DEBT-P2A-SALES-CRM-AUTH-STORE` | 1 | Phase 3 |

**Total remaining debt: 37 imports** (previous Phase 1A debt: **90 imports**).

`DEBT-P2A-SALES-CRM-AUTH-STORE` is not carried by this component — it belongs to
the `shared` component's auth adapter and is listed here only to account for the
full 37.

### Moved to the `shared` component in Phase 2A

- types
- auth adapter
- audit log
- permissions
- constants
- mock data
- country codes
- API/data-mode connector

### Intentionally still legacy

| Kept in `frontend/` | Why |
| --- | --- |
| Sales CRM CSS assets (`leads.module.css`, `primitives.module.css` — 28 imports) | `primitives` is genuinely shared, but it styles the same elements as `leads.module.css`; routing a CSS module through the shared barrel changes its bundle-graph position and therefore cascade order. Phase 2A declined that visual-regression risk. Both move in Phase 2B once all consumers migrate together. |
| `CompanyAutocomplete`, `CountryCodeSelect` (2 imports) | Each has exactly **one** consumer — this component. Moving them into `shared` would create a shared module that nothing shares. |
| Global API client / `salesCrmLeadsApi` (6 imports) | `salesCrmLeadsApi` rides the module-local axios instance in `frontend/lib/api.ts`, which carries the Bearer-token interceptor, the 401 → `/login?expired=true` redirect, `response.data` unwrapping and a one-time `nexus_*`→`apex_*` localStorage migration shared by 58 files. Extracting it would duplicate that chain or import it back anyway. |
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

`DEBT-P2A-LEADS-OWNED-LEGACY-ASSETS` is removed when:

1. `leads.module.css` moves into this component's `frontend/styles/`.
2. `CompanyAutocomplete` and `CountryCodeSelect` move into this component, or
   gain a second Sales CRM consumer that justifies the `shared` component.
3. `primitives.module.css` moves once the remaining Sales CRM feature screens
   migrate, so all its consumers move together and cascade order can be
   verified in one step.

`DEBT-P2A-SALES-CRM-API-CLIENT` is removed when the shared axios instance and
its interceptors move to a platform- or shared-owned HTTP client, and
`salesCrmLeadsApi` is replaced by a Leads-owned API adapter built on it.

No other component may use these exemptions. Self-tests prove a sibling Sales
CRM component and an unrelated platform are both rejected for the same import,
and that paths Phase 2A migrated away are no longer allowlisted.

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
