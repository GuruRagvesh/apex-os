# shared/ui/

Design-system primitives and application chrome used across platforms.

**Status: Phase 0 — empty scaffold.** Live code is
`frontend/components/ui/`, `frontend/components/layout/` and
`frontend/app/globals.css`.

## May live here

- Presentational primitives: buttons, badges, skeletons, modals, empty states,
  avatars, breadcrumbs, multi-select.
- App chrome used by every authenticated screen: sidebar, topbar.
- Global stylesheet and design tokens.

## Must not live here

- Components that know about a domain. `LeavesApprover` renders leave
  approvals — it belongs to `workforce/leave/approvals`, not here, even though
  it currently sits in `components/ui/`.
- Anything importing a platform. A "shared" component that imports
  `@apex/operations/tickets` is not shared.
- Screen-level layouts owned by one feature.

## The test

If the component's props mention a domain entity (`ticket`, `leave`,
`workSession`), it is not a UI primitive. A `<StatusBadge>` that takes
`{ label, tone }` is shared; one that takes `{ ticket }` is not.

## Dependency direction

```
platforms/*/frontend → shared/ui
apps/web             → shared/ui
shared/ui            → shared/utilities (only)
```

`shared/ui` must never import from `platforms/`, `apps/`, or any backend path.

## Styling

Global CSS and tokens live here. Feature-specific CSS modules stay with their
component — `sales-crm` styles, for instance, belong to
`business/sales-crm/shared/styles/`, not here.
