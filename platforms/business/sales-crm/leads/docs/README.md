# Sales CRM — Leads

**Status:** Frontend migrated (Phase 1A). Backend deferred to Phase 1B.
**Migrated:** 2026-08-04
**Debt identifier:** `DEBT-P1A-LEADS-LEGACY-FRONTEND`

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
  constants, mock data, country codes, API connector) is still owned by
  unmigrated Sales CRM components.

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

Read by `isSalesLeadsBackendEnabled()` in
`frontend/lib/sales-crm/api-connector.ts` (**not** migrated — still shared).

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

This component still imports from the legacy `frontend/` root — **90 imports**,
all covered by the narrow exemption `DEBT-P1A-LEADS-LEGACY-FRONTEND` in
`architecture-boundaries.json`.

| Legacy path | Why still there |
| --- | --- |
| `@/lib/sales-crm/types` (16) | Sales CRM-wide type module, shared with 13 other files |
| `@/styles/sales-crm/*.module.css` (28) | CRM stylesheets shared with the shell and other components |
| `@/lib/sales-crm/auth-adapter` (10) | Shared with 15 other files |
| `@/lib/sales-crm/audit-log` (8) | Shared with database, settings, shell |
| `@/lib/sales-crm/api-connector` (6) | Holds the flag **and** the CRM-wide data-mode boundary |
| `@/lib/api` (6) | Global Apex API client (`salesCrmLeadsApi`) |
| `@/lib/sales-crm/permissions` (5) | Shared with database, shell |
| `@/lib/sales-crm/constants` (5) | Shared with settings, shell |
| `@/lib/sales-crm/mock-data` (2) | Shared with dashboard |
| `@/lib/sales-crm/country-codes` (1) | Shared with `ui/CountryCodeSelect` |
| `@/components/sales-crm/ui/*` (2) | Shared CRM UI primitives |

**These are visible, not hidden.** The validator resolves `@/…` to
`frontend/…` specifically so this debt is reported on every run rather than
silently skipped as an external package.

### Removal conditions

The exemption is removed when **all** of these are true:

1. The Sales CRM shared slice migrates, publishing entry points for types,
   auth-adapter, audit-log, permissions, constants, mock-data and country-codes.
2. `api-connector.ts` is assigned an owner (open audit decision **D2** — it is
   currently Leads-only in practice but documented as the CRM-wide connector).
3. `CompanyAutocomplete` and `CountryCodeSelect` move to
   `platforms/business/sales-crm/shared/ui/`.
4. CRM stylesheets move to `platforms/business/sales-crm/shared/styles/`.
5. `salesCrmLeadsApi` is replaced by a component-owned API adapter (Phase 1B).

No other component may use this exemption. Self-tests prove a sibling Sales CRM
component and an unrelated platform are both rejected for the same import.

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
npm run architecture:test    # 15 self-tests, incl. exemption narrowness
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
