# Workforce Calendar — overview

**Status:** Standalone UI retired in Phase 7. Shared calendar and holiday data remain available to their owning features.
**Compartmentalised:** 2026-08-10
**Debt identifier:** `DEBT-P12-WORKFORCE-CALENDAR-LEGACY-FRONTEND` (1 import)

The `workforce/calendar` module, created by decision **D11** as a
cross-workforce module rather than a sub-component of `leave/`.

**Source correspondence.** `CalendarScreen.tsx` differs from the route file by
exactly two edits — the `useAuthStore` import path and the component
identifier. It had no trailing whitespace, so nothing else changed.

---

## Ownership

This component is retained as legacy source, but it no longer owns an exposed
navigation surface. Phase 7 removed the standalone Calendar entry.

| Area | Contents |
| --- | --- |
| `frontend/screens/CalendarScreen.tsx` | 149 lines — event assembly plus the inline `CalendarView` FullCalendar wrapper |

### It aggregates; it owns nothing it renders

Per **D11**, calendar is its own module precisely because it spans several
workforce concerns. Tickets belong to `operations/tickets`, leave to
`workforce/leave`. This component reads both and owns neither, so a self-test
rejects any reach into the Leave component's internals — the dependency
direction D11 exists to protect.

## Browser route

`/calendar` is retained only as a compatibility route and redirects to
`/dashboard`:

```tsx
import { redirect } from 'next/navigation';

export default function CalendarPage() {
  redirect('/dashboard');
}
```

No route params, no query string, no `metadata` export.

## Public API

| Specifier | Purpose |
| --- | --- |
| `@apex/workforce-calendar` | Component entry — exports `CalendarScreen` |

**No exact subpath**: one screen, one route, so the barrel cannot force a
consumer to load code it does not use — the Workforce Leave rule.

`CalendarView` stays inline in the screen exactly as it was. That matters: it
lazy-loads the five FullCalendar packages through `import()` inside a
`useEffect`, so they stay out of the initial bundle. Extracting it into its own
module was not needed and would have risked disturbing that.

## Phase 7 route retirement

1. Removed the standalone Calendar entry from navigation and dashboard quick actions.
2. Kept `/calendar` as a redirect so saved links fail safely.
3. Preserved shared holiday and date functionality used by attendance and other features.

The screen reads auth with a selector, `useAuthStore(s => s.user)`, used only to
tint the current user's own leave events green. That call shape is unchanged.

## What did not move

| Kept | Owner |
| --- | --- |
| `ticketsApi` in `lib/api.ts` | `operations/tickets` |
| `leaveApi` in `lib/api.ts` | `workforce/leave` |

Moving either here would invert the dependency D11 establishes. The status
colour map is declared **inline** in the event builder, so there is no
`lib/utils` coupling, and the FullCalendar dynamic imports are npm packages, not
internal paths.

### `DEBT-P12-WORKFORCE-CALENDAR-LEGACY-FRONTEND`

**1 import** — `frontend/lib/api.ts`, for `ticketsApi` and `leaveApi`. It
retires when those two become published contracts from their owning components,
which calendar then consumes through their public entries.

## Behaviour — preserved, not touched

Date handling (including the UTC end-date increment that makes multi-day leave
render inclusively), event colours, ticket status mapping, the overdue tint, the
`DONE`/`CLOSED` due-date exclusion, click-through URLs, the partial-data warning,
query keys, copy and styling are all unchanged. The screen has no mutations and
no role checks.

## Validation requirements

```bash
npm run architecture:test    # boundary self-tests
npm run architecture:check   # live scan; debt reported, not hidden
cd frontend && npm run build # /calendar compatibility redirect
```

Manual check: visiting `/calendar` redirects to `/dashboard`, while attendance
holiday/date functionality continues to work in its existing surfaces.
