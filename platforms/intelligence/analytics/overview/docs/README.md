# Intelligence Analytics — overview

**Status:** Frontend compartmentalised. Backend deferred.
**Compartmentalised:** 2026-08-07
**Debt identifier:** `DEBT-P10-INTELLIGENCE-ANALYTICS-LEGACY-FRONTEND` (1 import)

The second `intelligence` compartment, and the one that finally takes custody of
the two charts the Dashboard phase declined. **Three legacy files for one debt
import** — the best ratio of any component so far.

**Source correspondence.** `category-chart.tsx` and `ticket-trend-chart.tsx` are
`R100` — byte-identical. `AnalyticsScreen.tsx` differs from the original route
file by exactly four edits, listed below; there was no trailing whitespace to
normalise, so nothing else changed at all.

---

## Ownership

This component owns the `/analytics` workspace: a seven-tab reporting surface
over ticket operations — Overview, Command Center, Productivity, Review, Team,
SLA and Rework.

**Compartmentalised here (3 files):**

| Area | Contents |
| --- | --- |
| `frontend/screens/AnalyticsScreen.tsx` | 988 lines — the seven-tab workspace |
| `frontend/components/category-chart.tsx` | 41 lines — recharts pie, internal |
| `frontend/components/ticket-trend-chart.tsx` | 40 lines — recharts area, internal |

### Why the charts came here

The Dashboard phase examined `frontend/components/dashboard/*` and found the map
row assigning all four to the dashboard was wrong:

> `activity-item` is consumed by profile, `category-chart` and
> `ticket-trend-chart` by analytics, `stat-card` by nothing.

That prediction held. Both charts have **exactly one importer repo-wide** — this
screen — so the sole-consumer rule brings them here. They are pure presentational
components importing nothing but `recharts` and `date-fns`, which is why this
component's debt is **1 and not 3**. A self-test asserts they never acquire an
API, store or legacy import.

### Why `stat-card` did NOT come here

It has **zero** consumers anywhere. Ownership follows consumers, and an
unconsumed file has none to follow — absorbing it would have been tidying the
folder, not establishing ownership. It stays in `frontend/components/dashboard/`,
and a self-test asserts this phase left it alone and that it gained no importer.

`components/dashboard/` is now down to that single file.

## Browser route

```
/analytics
```

**Unchanged.** The route file stays at `frontend/app/(dashboard)/analytics/page.tsx`
as a thin adapter:

```tsx
import { AnalyticsScreen } from '@apex/intelligence-analytics';

export default function AnalyticsPage() {
  return <AnalyticsScreen />;
}
```

The screen takes no route params and reads no query string. There is no
`metadata` export.

## Public API

| Specifier | Purpose |
| --- | --- |
| `@apex/intelligence-analytics` | Component entry — exports `AnalyticsScreen` |

**No exact screen subpath.** One screen behind the barrel consumed by one route
cannot force a consumer to load code it does not use — the Workforce Leave rule.
`/analytics` measured **117 kB / 263 kB, exactly its baseline**; in fact **every
route in the build was byte-identical** after this move.

Both charts are deliberately **not** published. They are internal, and a
self-test proves neither barrel exports them — publishing would pull `recharts`
into every consumer of the component entry.

## Why `analytics/overview` and not `analytics/`

The map row is `platforms/intelligence/analytics/frontend/screens/`, which is
depth-2. `componentDepth` is **3**, so `componentRootOf` returns `null` for a
path that shallow and the component-privacy rules would not bind. The Dashboard
phase hit the same gap and resolved it with `dashboard/overview`; this follows
that precedent exactly, and the alias mirrors it —
`@apex/intelligence-dashboard` → `@apex/intelligence-analytics`.

> The component is named `overview` for consistency with its sibling, even
> though "Overview" is also the name of the screen's first tab. The component
> holds the whole workspace, not that one tab.

## What changed — exactly four things

1. **`useAuthStore` import path:** `@/store/auth.store` → `@apex/core-identity`.
2. **`TicketTrendChart` import path** → `../components/ticket-trend-chart`.
3. **`CategoryChart` import path** → `../components/category-chart`.
4. **Component identifier:** `AnalyticsPage` → `AnalyticsScreen`. The route
   adapter keeps the original `AnalyticsPage` name.

A self-test asserts the auth destructure is still exactly
`const { user, hasHydrated } = useAuthStore();`. **`hasHydrated` matters**: the
Core Identity debt entry records that redirecting while it is false is what
logged users out on every refresh. This move did not touch that logic.

## Read-only by construction

The screen declares **no mutation** — no `useMutation`, no `mutationFn`, no
`invalidateQueries`. Its three role expressions therefore gate *views* only and
cannot authorize an action:

```ts
const isManagerPlus = ['MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(roleName);
const isAdminPlus   = ['ADMIN', 'SUPER_ADMIN'].includes(roleName);
const canAccess     = ['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(roleName);
```

All three are locked verbatim by a self-test, which also fails if a mutation
ever appears here — a future write on this screen deserves its own review rather
than arriving inside an architecture commit.

## What did not move

| Kept | Owner |
| --- | --- |
| `analyticsApi` in `lib/api.ts` | **2 consumers** — this screen and `core/users/profiles`, which calls `getReviewerMetrics` |
| `dashboardApi` in `lib/api.ts` | `intelligence/dashboard` |
| `ticketsApi` in `lib/api.ts` | `operations/tickets` |
| `frontend/components/dashboard/stat-card.tsx` | Nobody — see above |
| `frontend/app/(dashboard)/(platform)/reports/page.tsx` | `intelligence/reports` — a different component, still a 15-line redirect |

### `DEBT-P10-INTELLIGENCE-ANALYTICS-LEGACY-FRONTEND`

**1 import** — a single multi-line statement pulling `analyticsApi`,
`dashboardApi` and `ticketsApi` from `frontend/lib/api.ts`. None of the three can
follow this component: one is shared with profiles, and the other two belong to
sibling components.

`Skeleton` arrives through `@apex/shared-ui/components/skeleton` and auth through
`@apex/core-identity`, so those couplings were already retired.

## Backend

**Not migrated.** `backend/src/modules/platform/analytics/*` (3 files) stays put.
Backend slices are blocked until the Render deployment root moves.

## Behaviour — preserved, not touched

Tabs, role gating, period filters, query keys, API calls, chart rendering, empty
states, export behaviour, copy, styling and existing defects are all unchanged.

## Validation requirements

```bash
npm run architecture:test    # boundary + read-only + chart-ownership self-tests
npm run architecture:check   # live scan; debt reported, not hidden
cd frontend && npm run build # 38/38 static pages; /analytics 117 kB / 263 kB
```

Manual checks not performed by this phase: each of the seven tabs renders per
role, period switching, the two charts render with and without data, the access
denial path for roles below `TEAM_LEAD`, and the export control.
