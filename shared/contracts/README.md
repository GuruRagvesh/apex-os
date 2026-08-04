# shared/contracts/

Types that cross platform boundaries.

**Status: Phase 0 — empty scaffold.**

## What belongs here

A type used by **two or more platforms** that no single one owns. Realistically
this is a small set: pagination envelopes, common API response shapes, shared
enums that genuinely span domains.

## What does not belong here

Most contracts. A component's request/response types belong to **that
component's** `shared/contracts/`, exported through its public `index.ts`:

```
platforms/operations/tickets/lifecycle/shared/contracts/   ← ticket contracts
shared/contracts/                                          ← only truly universal types
```

When `intelligence/dashboard` needs a ticket summary type, it imports the
public entry point of `operations/tickets/lifecycle`. It does **not** find that
type here.

## Why the distinction matters

If every contract lands here, `shared/contracts/` becomes a second schema — a
central file every platform must change together, which is precisely the
coupling vertical slices are meant to remove.

The rule: **a contract lives with its owner and is published.** Only genuinely
ownerless types come here.

## Dependency direction

```
platforms/* → shared/contracts
shared/contracts → (nothing)
```

This folder should contain types only — no runtime code, no imports from
anywhere else in the repository.
