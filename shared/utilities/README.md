# shared/utilities/

Small, dependency-free helpers used across platforms.

**Status: Phase 0 — empty scaffold.** Live code includes
`frontend/lib/utils.ts`, `frontend/lib/download-screenshot.ts` and
`frontend/hooks/{useDebounce,useTheme}.ts`.

## May live here

- Pure functions: string/array/object helpers, class-name merging.
- Framework-agnostic hooks with no domain knowledge (`useDebounce`,
  `useTheme`).
- Type guards and narrow assertion helpers.

## Must not live here

- **Date and time helpers.** Those are [`../time/`](../time/) — a deliberate
  split, because time in this system carries business meaning and needs one
  authoritative home.
- Anything importing a platform, an app, or the database client.
- Anything with domain knowledge. A `formatTicketId` helper belongs to
  `operations/tickets`.

## The size test

If a utility grows its own state, configuration, or dependency on another
module, it has stopped being a utility. Promote it to a proper `shared/`
sub-folder or move it into the feature that needs it.

## Dependency direction

```
platforms/* → shared/utilities
apps/*      → shared/utilities
shared/ui   → shared/utilities
shared/utilities → (nothing)
```

This is the strictest leaf in the tree: utilities import nothing internal at
all. If a helper needs something from elsewhere in the repository, it does not
belong here.
