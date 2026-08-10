# Core Users — change-requests

**Status:** Frontend compartmentalised. Backend deferred.
**Compartmentalised:** 2026-08-07
**Debt identifier:** `DEBT-P9-CORE-USERS-CHANGE-REQUESTS-LEGACY-FRONTEND` (1 import)

The third and final component of the `core/users` module, completing it on the
frontend. The **cleanest relocation in the migration so far**: one file, one
import statement of debt, and not a single import path rewritten.

**Source correspondence.** `ApprovalsScreen.tsx` matched the original route file
before trailing-whitespace normalisation — eleven pre-existing whitespace
sequences (18 characters) were removed so the commit carries no
`git diff --check` failures. The only other change is the component identifier
rename. Logic, strings, class names, component behaviour and rendered output
are unchanged.

---

## Ownership

This component owns the **approvals queue** for user change requests: the
surface where a team lead, manager or admin sees requests awaiting their
decision and approves or rejects them.

**Compartmentalised here (1 file):**

| Area | Contents |
| --- | --- |
| `frontend/screens/ApprovalsScreen.tsx` | 195 lines — pending queue, change diff rendering, approve, reject-with-reason modal |

### Three components, one module

`core/users` is now fully compartmentalised on the frontend:

| Component | Owns | Public entry |
| --- | --- | --- |
| `administration` | `/users`, `/users/[id]` — the directory | `@apex/core-users` |
| `profiles` | `/profile`, `/users/[id]/profile` | `@apex/core-users-profiles` |
| **`change-requests`** | **`/admin/approvals`** | **`@apex/core-users-change-requests`** |

A self-test proves none of the three can reach into another's internals — the
property that keeps the module from collapsing back into one folder as more of
it migrates.

## Browser route

```
/admin/approvals
```

**Unchanged.** The route file stays at
`frontend/app/(dashboard)/admin/approvals/page.tsx` as a thin adapter:

```tsx
import { ApprovalsScreen } from '@apex/core-users-change-requests';

export default function ApprovalsPage() {
  return <ApprovalsScreen />;
}
```

The screen takes no route params and reads no query string, so no prop contract
was introduced. There is no `metadata` export and no `layout.tsx` under
`admin/` — auth gating comes from `(dashboard)/layout.tsx`, which was not
touched.

## Public API

| Specifier | Purpose |
| --- | --- |
| `@apex/core-users-change-requests` | Component entry — exports `ApprovalsScreen` |

**No exact screen subpath, deliberately.** The barrel publishes a single screen
consumed by a single route, so it cannot force a consumer to load code it does
not use — the same reasoning that left Workforce Leave without one. `/admin/approvals`
measured **4.94 kB / 133 kB** against a 4.96 kB / 133 kB baseline; the 20-byte
drop is the stripped trailing whitespace. Every other route in the build was
byte-identical.

If a second screen is ever added here, it must come with exact subpaths.

## Approvals safety — what this relocation preserved

This screen performs approve and reject actions against real change requests, so
the move is locked down by self-tests rather than trusted:

| Preserved | Detail |
| --- | --- |
| Endpoints | `listPendingApprovals()`, `approve(id)`, `reject(id, reason)` |
| Query keys | `pending-approvals`, `departments`, `users-list`, `roles` |
| Invalidation | `['pending-approvals']` after both actions, and again on the already-processed error branch |
| Eligibility gate | `!['APPROVED', 'REJECTED', 'CANCELLED'].includes(req.status)` — buttons vs. status pill |
| Disabled states | per-row `approveMutation.variables === req.id`, plus the reject-modal guard |
| Toast copy | all five strings, including `'This request has already been processed.'` |

### There is no client-side role check, and that is intentional

Queue scoping is entirely **backend-driven**: `listPendingApprovals()` returns
only the requests the caller may act on. The screen renders what it is given.

A self-test asserts no authorization expression (`SUPER_ADMIN`, `role?.name`,
`isHR`, `canApprove`, `currentUser`) appears in this file. If one ever does, it
is either a genuine authorization change or a duplicate of a backend rule —
both need review, not a silent commit.

## No Core Identity dependency

This is the only migrated screen with **no frontend auth-state dependency at
all** — it never imported `@/store/auth.store`, so unlike Profiles there was no
auth import to migrate. A self-test still rejects a direct legacy auth-store
import from this component, so it cannot acquire one silently.

## What did not move

| Kept | Owner |
| --- | --- |
| `changeRequestsApi` in `lib/api.ts` | **4 consumers** — this screen, `core/users/profiles`, `intelligence/dashboard` and the legacy `hrms` page. Moving it here would make three unrelated features import a change-requests component. |
| `departmentsApi`, `usersApi`, `rolesApi` | Application-wide API groups |
| `frontend/modules/core/users/users.api.ts` | Not assigned to this component by the map; still a zero-importer shim. Untouched. |

Nothing else was eligible. The screen has **zero local imports** — no relative
imports, no dynamic `import()`, no `require()`. Its reject modal, loading
skeleton and both constant tables (`REQUEST_TYPES`, `MULTI_FIELDS`) are inline
and moved with it. There is no helper anywhere whose sole consumer is this
screen, so unlike Profiles there was no second file to claim.

> `MULTI_FIELDS` labels both `reportingManager` and `primaryManager` as
> "Department Manager", and its tables overlap with near-duplicates inside
> `ProfileScreen`. Both were left exactly as they are. Deduplicating across a
> component boundary would be a behaviour change disguised as tidying.

### `DEBT-P9-CORE-USERS-CHANGE-REQUESTS-LEGACY-FRONTEND`

**1 import** — the narrowest debt entry of any component that carries one. It
names a single target, `frontend/lib/api.ts`, scoped to this component's
`frontend/` folder.

Notably `frontend/lib/utils.ts` is **not** allowlisted even though both sibling
components have it, and a self-test proves it is rejected here. The screen never
needed it.

## Backend

**Not migrated.** `backend/src/modules/core/users/change-requests.controller.ts`
and `change-requests.service.ts` stay put, along with
`backend/test/unit/users.change-requests.spec.ts`. Backend slices are blocked
until the Render deployment root moves.

The approval policy — who may approve which request type, and the
TL → manager → admin escalation encoded in the request statuses — lives entirely
in that service. Nothing about it was read, moved or changed here.

## Behaviour — preserved, not touched

Approval rules, rejection rules, status eligibility, button visibility, disabled
states, request payloads, endpoints, mutation callbacks, cache invalidation,
error handling, toast copy, labels, icons, styling and existing defects are all
unchanged. The screen required no import rewrite whatsoever.

## Validation requirements

```bash
npm run architecture:test    # boundary + approval-contract + debt-count self-tests
npm run architecture:check   # live scan; debt reported, not hidden
cd frontend && npm run build # 38/38 static pages; /admin/approvals ~4.94 kB / 133 kB
```

Manual checks not performed by this phase: queue loads per role (team lead,
manager, admin), change diff renders old → new correctly for each request type,
approve, reject with and without a reason, the already-processed error path, and
the empty-queue state.
