# Intelligence Dashboard — overview

**Status:** Frontend compartmentalised. Backend deferred.
**Compartmentalised:** 2026-08-06
**Debt identifier:** `DEBT-P4-DASHBOARD-LEGACY-FRONTEND` (15 imports)

The main authenticated landing surface: the screen a user sees after login.
This was a **relocation of ownership**, not a redesign — all nine files moved
verbatim.

---

## Ownership

This component owns the dashboard overview: critical actions, upcoming events,
recent activity, team pressure, and the loading skeleton.

**Compartmentalised here (9 files):**

| Area | Contents |
| --- | --- |
| `frontend/screens/DashboardScreen.tsx` | 770 lines — the route-level screen |
| `frontend/components/` | `CriticalActionPanel`, `UpcomingEvents`, `RecentActivityFeed`, `TeamPressurePanel`, `HomeSkeleton` — each had exactly **one** consumer, this screen |
| `frontend/components/` | `HomeHeader`, `MetricCards`, `QuickActionStrip` — **zero consumers anywhere** |

The three unused widgets moved rather than being left behind: they lived in
`frontend/components/home/`, this component's own folder, and nothing else
referenced them. Moving them emptied that folder completely instead of leaving
orphans. They are **not deleted** — dead-code removal is a separate decision.

## Browser route

```
/dashboard
```

**Unchanged.** The route file stays at
`frontend/app/(dashboard)/(core)/dashboard/page.tsx` as a thin adapter:

```tsx
import { DashboardScreen } from '@apex/intelligence-dashboard';

export default function DashboardPage() {
  return <DashboardScreen />;
}
```

## Public API

`@apex/intelligence-dashboard` — the component root — is the only importable
path. It publishes **one** export, `DashboardScreen`.

The eight widgets are internal and deliberately not re-exported. Because the
barrel carries a single screen consumed by a single route, no exact subpath is
needed here: `/dashboard` measured 20.5 kB / 223 kB against a 20.6 kB / 223 kB
baseline. Add subpaths only if a second screen is ever published from this
component.

## What did not move

| Kept in `frontend/` | Why |
| --- | --- |
| `components/dashboard/*` (4) | **Not dashboard-owned despite the folder name.** `activity-item` is consumed by profile; `category-chart` and `ticket-trend-chart` by analytics; `stat-card` by nothing. They belong with analytics and profile. |
| `components/workday/{WorkdayBar,WorkdayHistoryStrip}` | Owned by workforce/attendance — explicitly out of scope. |
| `components/ui/*` (KpiCapsuleStrip, AnnouncementBroadcast, CommandModal, QuickActionPalette, CommandCard) | Global primitives used across features. |
| `lib/api.ts`, `lib/utils.ts`, `lib/company-date.ts` | Application-wide API groups and shared helpers. |
| `store/auth.store.ts` | Application-wide identity store. |
| `app/home-v2/page.tsx` | **Not a dashboard preview.** It renders `ApexLandingPage` with a preview banner, identically to `/`. Belongs to `system/public-site` per **D4**. See the D5 correction below. |

### `DEBT-P4-DASHBOARD-LEGACY-FRONTEND`

15 imports across six target groups, scoped to this component's `frontend/`
folder. Each target has its own removal condition in
`architecture-boundaries.json`. The largest group is `components/ui/` — it
clears when global primitives migrate to `shared/ui`.

## Map corrections found while compartmentalising

Both from reading actual file contents, not assumptions.

**D5 is stale.** It states `home-v2` is "an unlinked preview of the dashboard".
It is not: `frontend/app/home-v2/page.tsx` renders `ApexLandingPage` with
`showPreviewBanner`, the same component `/` renders. The comment in the file
says the content "is promoted to /". It belongs to `system/public-site` (D4),
not here, and was not moved.

**`components/dashboard/*` is misassigned.** The map routes all four files to
this component. Usage says otherwise — see the table above. They stay until
analytics and profile are compartmentalised.

## Backend

**Not migrated.** `backend/src/modules/platform/dashboard/` (controller,
service, module, `home.controller.ts`) stays put. Backend slices are blocked
until the Render deployment root moves.

## Validation requirements

```bash
npm run architecture:test    # boundary + debt-count self-tests
npm run architecture:check   # live scan; debt reported, not hidden
cd frontend && npm run build # 38/38 static pages; /dashboard ~20.5 kB / 223 kB
```

Manual checks not performed by this phase: dashboard load per role, critical
action panel, upcoming events, recent activity feed, team pressure panel,
loading skeleton, and the workday bar embedded at the top of the screen.
