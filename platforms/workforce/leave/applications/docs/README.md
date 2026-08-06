# Workforce Leave — applications

**Status:** Frontend compartmentalised. Backend deferred.
**Compartmentalised:** 2026-08-06
**Debt identifier:** `DEBT-P5-LEAVE-LEGACY-FRONTEND` (3 imports)

The first `workforce` compartment. A **relocation of ownership**, not a
redesign: all three files moved with no import rewrite needed.

**Source correspondence.** `LeavesApprover.tsx` and `leave.types.ts` are
`R100`. `LeaveScreen.tsx` was identical before trailing-whitespace
normalisation — four whitespace-only lines (18 characters) were then removed so
the commit carries no `git diff --check` failures. **Screen logic and rendered
output: unchanged.**

---

## Ownership

This component owns the Leave surface: applying for leave, listing requests,
and approving or rejecting them.

**Compartmentalised here (3 files):**

| Area | Contents |
| --- | --- |
| `frontend/screens/LeaveScreen.tsx` | 677 lines — the route-level screen |
| `frontend/components/LeavesApprover.tsx` | 146 lines — presentational approver list, no dependencies |
| `shared/contracts/leave.types.ts` | 25 lines — `LeaveStatus`, `LeaveType`, `LeaveRequest`, `LeaveStats`; zero imports |

## Browser route

```
/leave
```

**Unchanged.** The route file stays at
`frontend/app/(dashboard)/(operations)/leave/page.tsx` as a thin adapter:

```tsx
import { LeaveScreen } from '@apex/workforce-leave';

export default function LeavePage() {
  return <LeaveScreen />;
}
```

## Public API

`@apex/workforce-leave` publishes **one screen** plus the four domain types.
`LeavesApprover` is internal and deliberately not re-exported — nothing outside
this component consumes it, and publishing it would pull it into every barrel
consumer. Because the barrel carries a single screen consumed by a single
route, no exact subpath is needed: `/leave` measured 7.05 kB / 149 kB against a
7.06 kB / 149 kB baseline.

## Why the map's applications/approvals split was not applied

The migration map splits Leave into `applications`, `approvals` and `balances`.
That is a **backend** split. On the frontend there is one surface:
`LeaveScreen.tsx` performs both application *and* approval — it owns
`approveMutation`, `rejectMutation` and the self-approval guard.

The map also carries an explicit warning on this boundary:

> ⚠️ the approve/reject route guard checks role only and ignores `isHR`, while
> the service layer honours `isHR`. Resolve the policy question **before**
> splitting `leave.service.ts` across two components.

Creating a frontend `approvals` component now — for one unused presentational
file — would bake in exactly the boundary the map warns against baking in.
Everything therefore lives under `applications`. When the backend split happens
and the `isHR` question is settled, `LeavesApprover` is a clean candidate to
move into an `approvals` component.

## What did not move

| Kept in `frontend/` | Why |
| --- | --- |
| `modules/operations/leave/leave.api.ts` | A one-line re-export shim of `@/lib/api` with **zero importers**, matching the projects/team/tickets/notifications pattern. Moving it into `platforms/` would create tracked debt for a file nobody uses. Left in place; **not deleted**. |
| `leaveApi` in `lib/api.ts` | One of ~20 application-wide API groups. |
| `lib/utils.ts` | Broad shared module (`cn`, `formatDate`, `getInitials`) that also holds `LEAVE_STATUS_COLORS`. Splitting it is unrelated-code restructuring. |
| `store/auth.store.ts` | Application-wide identity store, owned by `core/identity`. |

### `DEBT-P5-LEAVE-LEGACY-FRONTEND`

3 imports, scoped to this component's `frontend/` folder — a self-test proves
the `shared/contracts` layer cannot reuse the exemption, keeping it free of
React and legacy code so a future backend slice can consume it.

Notably the screen's **global UI dependency was already retired**: it consumes
`EmptyState` through `@apex/shared-ui/components/empty-state`, not the legacy
path. That is the shared/ui phase paying off.

## Backend

**Not migrated.** `backend/src/modules/operations/leave/` (controller, service,
balance service), `backend/src/common/services/leave-access.service.ts` and the
scheduler's `setLeaveStatuses` job all stay put. Backend slices are blocked
until the Render deployment root moves.

## Behaviour — preserved, not touched

Leave policies, balances, approval rules, role permissions, date calculations,
endpoint paths, request payloads, response handling, query keys, validation and
existing defects are all unchanged. The screen required no import rewrite
whatsoever. See [Source correspondence](#workforce-leave--applications) above
for the exact provenance of each file.

## Validation requirements

```bash
npm run architecture:test    # boundary + debt-count self-tests
npm run architecture:check   # live scan; debt reported, not hidden
cd frontend && npm run build # 38/38 static pages; /leave ~7.05 kB / 149 kB
```

Manual checks not performed by this phase: apply for leave, list per role,
approve, reject, self-approval guard, balance display, date validation.
