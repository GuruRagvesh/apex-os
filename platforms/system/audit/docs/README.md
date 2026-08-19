# System Audit

**Status:** Frontend compartmentalised. Backend deferred.
**Compartmentalised:** 2026-08-10
**Debt identifier:** `DEBT-P14-SYSTEM-AUDIT-LEGACY-FRONTEND` (1 import)

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
| `frontend/api/events-api.ts` | `eventsApi.getAll` — the cross-domain event READ adapter |

### It renders every platform's events and owns no producer

Every platform emits into the event stream; this component displays it. That
makes it a consumer of everything, so a self-test rejects any reach into
another platform's internals.

It owns the READ adapter for that stream and nothing more. `GET /events` is a
single cross-domain aggregate whose backend controller has no service of its
own: it queries `OperationalEvent`, scopes per request through
`AccessPolicyService` and enriches at read time — it *is* the read model.
Event **production** stays with the domains that emit it. Tickets, projects,
workday, leave, auth, settings, users, comments and sales all write through
`EventLoggerService` and keep ownership of their own events. Nothing here may
emit an event, and owning the adapter confers no claim over any producer.

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
| `@apex/system-audit/api` | `eventsApi` — deliberately **not** through the root barrel |

The HTTP surface is an exact subpath so a consumer that wants the screen never
loads the authenticated client, and vice versa.

## Read-only by construction

The screen declares no mutation. It queries `eventsApi` and renders. A self-test
would need updating before a write could be added here, which is the intent.

## What did not move

| Kept | Owner |
| --- | --- |
| `frontend/lib/company-date.ts` | **Emphatically not audit-owned** — the central company business-date source, shared with the scheduler and attendance surfaces |

`company-date.ts` is the important one. It supplies `getCompanyNow`,
`getCompanyTodayStart` and `getCompanyStartOfDay`, and the same helpers back
business-date logic elsewhere in the system. Moving it into an audit component
would make attendance depend on audit. It must become a **published shared
contract** instead, and a self-test proves no other component can borrow this
exemption to reach it.

### `DEBT-P14-SYSTEM-AUDIT-LEGACY-FRONTEND`

**1 import** — `lib/company-date.ts`. The `lib/api.ts` target was discharged when
`eventsApi` moved here, and was struck from the allowlist rather than left
sanctioned-but-unused. The events **backend** has still not migrated.

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
