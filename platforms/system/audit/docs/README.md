# System Audit

**Status:** Frontend compartmentalised. Backend deferred.
**Compartmentalised:** 2026-08-10
**Debt identifier:** `DEBT-P14-SYSTEM-AUDIT-LEGACY-FRONTEND` (2 imports)

The second `system` compartment, after `public-site`.

**Source correspondence.** `ActivityLogScreen.tsx` matched the route file before
trailing-whitespace normalisation — one whitespace sequence removed. The only
other changes are the `useAuthStore` import path and the component identifier.

---

## Ownership

This component owns the `/admin/activity` surface: the read-only audit log of
events emitted across the platform.

| Area | Contents |
| --- | --- |
| `frontend/screens/ActivityLogScreen.tsx` | 425 lines — filters, grouping, event rendering |

### It renders other platforms' events and owns none of them

Every platform emits into the event stream; this component displays it. That
makes it a consumer of everything and an owner of nothing, so a self-test
rejects any reach into another platform's internals.

## Browser route

```
/admin/activity
```

**Unchanged**, with the route file as a thin adapter. No route params, no query
string, no `metadata` export.

## Public API

| Specifier | Purpose |
| --- | --- |
| `@apex/system-audit` | Component entry — exports `ActivityLogScreen` |

**No exact subpath**: one screen, one route.

## Read-only by construction

The screen declares no mutation. It queries `eventsApi` and renders. A self-test
would need updating before a write could be added here, which is the intent.

## What did not move

| Kept | Owner |
| --- | --- |
| `eventsApi` in `lib/api.ts` | The events backend is a `system` component that has not migrated |
| `frontend/lib/company-date.ts` | **Emphatically not audit-owned** — the central company business-date source, shared with the scheduler and attendance surfaces |

`company-date.ts` is the important one. It supplies `getCompanyNow`,
`getCompanyTodayStart` and `getCompanyStartOfDay`, and the same helpers back
business-date logic elsewhere in the system. Moving it into an audit component
would make attendance depend on audit. It must become a **published shared
contract** instead, and a self-test proves no other component can borrow this
exemption to reach it.

### `DEBT-P14-SYSTEM-AUDIT-LEGACY-FRONTEND`

**2 imports** — `lib/api.ts` and `lib/company-date.ts`, each with its own removal
condition.

## Behaviour — preserved, not touched

Filters, grouping, date bucketing, event rendering, links, query keys, copy and
styling are all unchanged.

## Validation requirements

```bash
npm run architecture:test
npm run architecture:check
cd frontend && npm run build # /admin/activity ~5.36 kB / 140 kB
```

Manual checks not performed by this phase: log loads per role, filters apply,
date grouping is correct across the company-day boundary, event links resolve.
