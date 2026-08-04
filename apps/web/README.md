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

Empty. Populated during Phases 1–5 as each component migrates. Browser URLs
must not change during any migration.
