# shared/utilities/

Small, dependency-free helpers used across the whole system.

**Status:** 3 exports extracted 2026-08-06. **Debt added: none.**

---

## The bar for living here

An export belongs here only when **all** of these hold:

1. it has consumers across **more than one platform** or shared module;
2. it contains no feature-specific business rule;
3. it has no platform dependency;
4. its behaviour can remain exactly unchanged.

Rule 4 matters as much as the rest: this module is a relocation target, not a
place to improve things.

## Contents

| Export | File | Consumers when extracted |
| --- | --- | --- |
| `cn` | `class-names.ts` | 20 files — dashboard, leave, projects + legacy |
| `getInitials` | `text.ts` | 9 files — leave, projects + legacy |
| `formatDate` | `date.ts` | 7 files — leave, projects + legacy |

All three moved **verbatim** from `frontend/lib/utils.ts`.

`formatDate` is a **display formatter** — `toLocaleDateString('en-IN', …)`. It is
not business time logic. Company-date, timezone and TVA rules belong to
`shared/time` per **D1**; do not add them here.

## Public API

```ts
import { cn, formatDate, getInitials } from '@apex/shared-utilities';
```

`shared/utilities/index.ts` is the only importable path. Reaching into
`./class-names`, `./date` or `./text` across a module boundary is a violation,
enforced for static imports, dynamic `import()` and `require()`.

## What deliberately stayed in `frontend/lib/utils.ts`

That file is **not** a utilities module — it is feature vocabulary. What remains
is owned by the features that use it and moves with them:

| Kept | Owner |
| --- | --- |
| `PRIORITY_COLORS`, `PRIORITY_LABELS`, `STATUS_COLORS`, `STATUS_LABELS`, `CATEGORY_COLORS`, `CATEGORY_LABELS` | tickets |
| `PROJECT_STATUS_COLORS`, `PROJECT_STATUS_LABELS` | operations/projects |
| `LEAVE_STATUS_COLORS`, `LEAVE_STATUS_LABELS` | workforce/leave |
| `ROLE_LABELS`, `formatRole` | core/identity |
| `DEPT_COLORS` | core/organization |
| `formatRelativeTime` | **1 platform consumer only** — fails rule 1 |

`formatRelativeTime` falls back to `formatDate` for anything older than a week,
so `frontend/lib/utils.ts` now imports the extracted helper rather than keeping
a second copy. There is exactly one implementation of each moved function.

## What this unblocked

`shared/ui` could not hold `skeleton`, `multi-select` or `status-badge` while
their only legacy dependency was `cn` — `shared/` may not import the legacy
`frontend/` root, and that rule has no exemption mechanism. With `cn` here, all
three moved to `shared/ui` in the same phase, each published by an exact
subpath.

## Dependency rules

```
platforms/*   → shared/utilities
shared/ui     → shared/utilities
apps/*        → shared/utilities
shared/utilities → (nothing internal)
```

`shared/utilities` must never import `platforms/**`, `backend/**`, a feature
store, a feature API adapter, or the legacy `frontend/` root. Self-tests cover
each direction.
