# shared/

Genuinely cross-cutting code: used by multiple platforms, owned by none.

**Status: Phase 0 — empty scaffold.** Live code remains in
`backend/src/{common,shared}/`, `frontend/lib/`, `frontend/components/ui/`
and `frontend/hooks/`.

## The bar for living here

Ask two questions:

1. **Is it used by more than one platform?** If only attendance uses it, it
   belongs to attendance.
2. **Would moving it to a platform create a wrong dependency?** If
   `operations` would have to import `workforce` just to get a date helper,
   the helper is cross-cutting.

Both must be yes. "It felt generic" is not sufficient.

## Contents

| Folder | Scope |
| --- | --- |
| [`ui/`](ui/) | Design-system primitives and app chrome. |
| [`auth/`](auth/) | Guards, decorators, role constants, user payload types. |
| [`contracts/`](contracts/) | Types crossing platform boundaries. |
| [`configuration/`](configuration/) | Environment and app-wide constants. |
| [`observability/`](observability/) | Instrumentation and error reporting. |
| [`utilities/`](utilities/) | Small, dependency-free helpers. |
| [`testing/`](testing/) | Test helpers used across components. |
| [`time/`](time/) | ⏱ Company-date, timezone and elapsed-time authority. |

## Dependency direction

```
platforms/ → shared/
apps/      → shared/
shared/    → database/client   (only where genuinely needed)
```

`shared/` must **never** import from `apps/` or `platforms/`. This is the rule
most likely to be violated by accident and the one the boundary validator
checks hardest: a single `shared → platforms` import inverts the graph and
makes `shared` unimportable from the platform it now depends on.

## Must not become a dumping ground

This is the failure mode that kills modular architectures. `shared/` is not
"things I could not place". If code does not clearly satisfy both questions
above, it belongs in the feature that uses it — even if that means two features
have similar-looking code for a while.

Duplication is cheaper to fix than a wrong dependency.

## Migration status

Empty. Populated as each platform migrates and its cross-cutting dependencies
become visible. `shared/time/` is expected first — attendance, tickets, SLA and
scheduling all depend on it.
