# apps/web/

The Next.js browser application: routing, rendering shell, and build
configuration.

**Status: Phase 0 — empty scaffold.** `frontend/` at the repository root is the
live web application. It builds, it deploys to Vercel, and it is what users
load today. This folder receives its contents progressively, one migrated
component at a time.

## Responsibility

Expose platform screens at browser URLs. Nothing else.

## May live here

- `app/**` route files — thin adapters, typically a single re-export.
- The genuine app shell: root `layout.tsx`, `providers.tsx`, `not-found.tsx`.
- `public/` static assets.
- `next.config.js`, `tailwind.config.ts`, `postcss.config.js`, `tsconfig.json`,
  `package.json`, `.eslintrc.json`, `.env*.example`.

## Must not live here

- Screen implementations. A screen lives in its component's
  `frontend/screens/` and is re-exported by the route adapter.
- Components, hooks, API adapters, or state belonging to a feature.
- Any backend import. The browser bundle must never reach server code.

## The route-adapter principle

A route file exists to map a URL to a screen. It should read as one line:

```tsx
// apps/web/app/attendance/page.tsx
export { AttendancePage as default } from '@apex/workforce/attendance/workday';
```

If a route file contains layout, data fetching, or conditional rendering, that
logic belongs in the component instead.

## Dependency direction

```
apps/web → platforms/*/frontend (via public index.ts)
apps/web → shared/ui, shared/auth, shared/utilities, shared/time
```

`apps/web` must never import `platforms/*/backend/**` or `database/**`.

## Migration status

**First occupant: `components/cold-start-banner.tsx` (2026-08-12).**
**Second: `components/command-palette.tsx` (2026-08-17).**

`frontend/` remains the live Next.js root and still owns routing, rendering and
build config. This folder now holds one piece of genuine app-shell chrome, and
grows one migrated item at a time. Browser URLs have not changed.

### Why a `components/` folder exists here

The "must not live here" rule above excludes components *belonging to a
feature*. The cold-start banner belongs to none: it detects a sleeping backend
and shows a global notice, mounted once in the dashboard layout beside the other
shell chrome. It is infrastructure UX, so it falls under "the genuine app shell".

It is deliberately **not** in `shared/ui`. That module's own README blocks it
under *rule 2 — feature logic*, because it calls `api.get('/auth/me')`.
`shared/ui` holds presentation primitives with no behaviour, and that exclusion
still stands regardless of where the API client lives.

Published as the exact subpath `@apex/apps-web/components/cold-start-banner`.
There is no root barrel here, and one should not be added: a barrel would let a
consumer pull unrelated shell code, which is the bundle trap this repository has
hit repeatedly.

### `command-palette.tsx` — the cross-domain shell feature (2026-08-17)

Ctrl+K search over tickets, projects and people. It moved here from
`frontend/components/ui/command-palette.tsx`, which is now **retired** — no
re-export, no compatibility shim, and the retired-path guard in the
architecture suite holds the old path shut.

It qualifies under the same reasoning as the banner, from the opposite
direction. The banner belongs to no feature; the palette belongs to *four*
and therefore to none of them. It composes three platform APIs plus identity
in one surface, so no single business platform can own it without importing
its three peers. It is mounted once in the topbar as shell chrome, and it is
not a `shared/ui` primitive — it issues HTTP requests and reads auth state,
which that module's README excludes as feature logic.

All four data dependencies cross public boundaries:

| Capability | Public entry |
| --- | --- |
| tickets | `@apex/operations-tickets-lifecycle/api` → `ticketsApi.getAll` |
| projects | `@apex/operations-projects/api` → `projectsApi.getAll` |
| directory | `@apex/core-users/api` → `usersApi.getDirectory` |
| auth | `@apex/core-identity` → `useAuthStore` |

`@/lib/api`, `@/store/auth.store`, `teamApi` and workday imports are all
**zero**. The move took the legacy auth-store consumer count from 19 to 18 —
the first departure that is not a route, so no adapter survives behind it.

Published as the exact subpath `@apex/apps-web/components/command-palette`.
No config change was needed: the `@apex/apps-web/components/*` wildcard the
banner established already resolves it, and `component-public-entry` is
scoped to `platforms/`, not `apps/`. Still no root barrel.

### Dependency direction is already enforced

`shared/`, `platforms/` and `database/` may not import `apps/` — the validator
enforces all three, plus app-internal isolation. `apps/web` composes downward
through public entry points only. No rule change was needed to establish this
folder; the boundary model already existed.
