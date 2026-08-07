# System Public Site

**Status:** Frontend compartmentalised. No backend exists for this component.
**Compartmentalised:** 2026-08-07
**Debt identifier:** none — **this component carries zero legacy dependencies.**

The first `system` compartment, and the first component in the migration to add
no debt at all.

---

## Ownership

Per architecture decision **D4**, this component collects the **unauthenticated**
marketing and legal surfaces. They are real screens with no platform
affiliation; putting them in `apps/web` would leak page implementation into the
composition shell.

**Compartmentalised here (3 files):**

| Screen | Lines | Serves |
| --- | --- | --- |
| `frontend/screens/ApexLandingPage.tsx` | 474 | `/` and `/home-v2` |
| `frontend/screens/PrivacyScreen.tsx` | 47 | `/privacy` |
| `frontend/screens/TermsScreen.tsx` | 47 | `/terms` |

All three import only `next/link` and lucide icons. None touches an API, a
store, a feature or a shared module.

## Browser routes

```
/           /home-v2           /privacy           /terms
```

**All unchanged.** Every route file stays where it was, as a thin adapter.

```tsx
import { ApexLandingPage } from '@apex/system-public-site/screens/ApexLandingPage';

export default function HomePage() {
  return <ApexLandingPage />;
}
```

`/home-v2` keeps its `showPreviewBanner` prop and its explanatory comment
verbatim — it is a review alias for `/`, not a dashboard preview. (The map's
**D5** claim that `home-v2` previews the dashboard was corrected during the
Intelligence Dashboard phase.)

### `metadata` stays in the route files

`/privacy` and `/terms` each `export const metadata`. Next.js only honours that
in a route file, never in an imported component — so the exports remain in
`frontend/app/privacy/page.tsx` and `frontend/app/terms/page.tsx` with
**byte-identical values** (`'Privacy Policy'`, `'Terms of Service'`). Only the
JSX bodies moved.

## Public API

| Specifier | Purpose |
| --- | --- |
| `@apex/system-public-site` | Component entry — exports all three screens |
| `@apex/system-public-site/screens/ApexLandingPage` | Exact screen subpath |
| `@apex/system-public-site/screens/PrivacyScreen` | Exact screen subpath |
| `@apex/system-public-site/screens/TermsScreen` | Exact screen subpath |

**The routes use the subpaths, not the barrel.** A barrel would pull the
474-line landing page into `/privacy` and `/terms`, which are 193 B pages. With
subpaths, all four routes measured **193 B / 94.5 kB** — identical to baseline.

The subpaths are declared in `publicSubpaths.specifiers` as an **exact
allowlist**: a fourth file dropped into `frontend/screens/` is still private,
and a self-test proves it.

## What did not move

Nothing. `ApexLandingPage` had exactly two consumers — `/` and `/home-v2` — both
public-site routes. `frontend/components/landing/` is now empty. No component in
Dashboard, Analytics, Profile, Core Users, Projects, Leave or Sales CRM
consumed any of these files.

## Zero debt

This component imports no legacy path, so it has **no exemption entry** in
`architecture-boundaries.json` and repository debt is unchanged at 19. A
self-test asserts that any legacy import from this component is rejected —
there is no allowlist for it to fall back on.

## Backend

**None.** `system/public-site` is frontend-only by nature. Other `system`
components (notifications, email, uploads, events, websocket, scheduler,
automation, health, backup) are backend-heavy and remain unmigrated; backend
slices are blocked until the Render deployment root moves.

## Behaviour — preserved, not touched

Rendered copy, layout, styling, animations, links, navigation, responsive
behaviour, route URLs, route visibility, auth gating (there is none — these are
public) and metadata values are all unchanged.

`ApexLandingPage.tsx` is **byte-identical**. `PrivacyScreen.tsx` and
`TermsScreen.tsx` are identical to their route-file bodies once the `metadata`
export is accounted for and the component identifier renamed
(`PrivacyPage` → `PrivacyScreen`, `TermsPage` → `TermsScreen`).

## Validation requirements

```bash
npm run architecture:test    # boundary + subpath + debt-count self-tests
npm run architecture:check   # live scan; debt reported, not hidden
cd frontend && npm run build # 38/38 static pages; all four public routes 193 B / 94.5 kB
```

Manual checks not performed by this phase: landing page renders at `/`, preview
banner appears only at `/home-v2`, privacy and terms render with correct browser
tab titles, and all footer/nav links resolve.
