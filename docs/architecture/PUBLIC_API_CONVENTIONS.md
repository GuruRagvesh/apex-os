# Public API Conventions

**Status:** Canonical
**Date:** 2026-08-04
**Enforced by:** `scripts/architecture/validate-boundaries.mjs`
**Configuration:** `architecture-boundaries.json`

The import rules that make the architecture real rather than decorative.

---

## The sixteen rules

1. **Cross-component imports use only a component's public `index.ts`.**
2. **Internal files cannot be imported across component boundaries.**
3. **Frontend cannot import backend.**
4. **Backend cannot import frontend.**
5. **`shared/` cannot import `platforms/` or `apps/`.**
6. **`database/` cannot import `apps/` or `platforms/`.**
7. **Apps compose features but contain no business rules.**
8. **Feature-specific code stays within its feature.**
9. **Truly cross-cutting code may live in `shared/`.**
10. **`shared/` must not become a generic dumping ground.**
11. **Prisma schema and migrations stay centralized in `database/prisma/`.**
12. **`PrismaService` and `PrismaModule` live in `database/client/`.**
13. **Route adapters remain inside `apps/web/app/`.**
14. **NestJS bootstrap remains inside `apps/api/`.**
15. **Feature-owned scheduled jobs stay with the feature.**
16. **`system/scheduler` contains generic scheduling infrastructure only.**

---

## Dependency direction

```
        apps/
          ↓
      platforms/
          ↓
       shared/
          ↓
   database/client
```

Imports flow downward only. Any upward import is a violation. Sideways imports
between platforms are allowed **through public entry points**, provided they do
not create a cycle.

---

## Examples

### Cross-component imports (rules 1, 2)

```ts
// ✅ allowed — public entry point
import { TicketSummary } from '@apex/operations/tickets/lifecycle';

// ✅ allowed — the component directory resolves to its index.ts
import { TicketsModule } from '@apex/operations/tickets/lifecycle';

// ❌ forbidden — reaches into another component's backend
import { TicketService } from '@apex/operations/tickets/lifecycle/backend/services/ticket.service';

// ❌ forbidden — reaches into another component's frontend
import { TicketRow } from '@apex/operations/tickets/lifecycle/frontend/components/TicketRow';

// ✅ allowed — internal import within the same component
import { repo } from '../repositories/ticket.repository';
```

### Frontend/backend isolation (rules 3, 4)

```ts
// ❌ forbidden — in frontend/screens/WorkdayScreen.tsx
import { finalizeWorkSession } from '../../backend/services/workday.service';

// ✅ allowed — call the API adapter instead
import { workdayApi } from '../api/workday.api';

// ❌ forbidden — in backend/services/workday.service.ts
import { WorkdayBar } from '../../frontend/components/WorkdayBar';
```

The validator catches this in dynamic form too:

```ts
// ❌ forbidden — dynamic import is still an import
const mod = await import('../../backend/services/workday.service');
```

### `shared/` restrictions (rules 5, 9, 10)

```ts
// ❌ forbidden — in shared/utilities/helper.ts
import { WorkSession } from '@apex/workforce/attendance/workday';

// ✅ allowed — shared importing shared
import { formatMinutes } from '@apex/shared/time';
```

If something in `shared/` needs a platform type, it is not shared. Move it into
the platform, or invert it so the platform passes the value in.

### `database/` restrictions (rules 6, 11, 12)

```ts
// ❌ forbidden — in database/client/prisma.service.ts
import { UserProfile } from '@apex/core/users/profiles';

// ✅ allowed — a component repository importing the client
// in platforms/core/users/profiles/backend/repositories/user.repository.ts
import { PrismaService } from '@apex/database/client';
```

### Apps compose only (rules 7, 13, 14)

```tsx
// ✅ allowed — apps/web/app/attendance/page.tsx
export { WorkdayScreen as default } from '@apex/workforce/attendance/workday';

// ❌ forbidden — business logic in a route adapter
export default function Page() {
  const total = elapsed - breakMinutes;      // ← belongs in the component
  return <div>{total}</div>;
}

// ❌ forbidden — one app importing another app's internals
import { helper } from '@apex/apps/api/src/helper';
```

### Scheduled jobs (rules 15, 16)

```ts
// ✅ allowed — platforms/workforce/attendance/workday/backend/jobs/auto-close.job.ts
import { finalizeWorkSession } from '../services/workday.service';   // same component

// ❌ forbidden — platforms/system/scheduler importing a platform
import { WorkdayService } from '@apex/workforce/attendance/workday';
```

`system/scheduler` owns cron registration and scheduling utilities. It owns no
jobs. This is precisely how the current `scheduler → workday` coupling is
removed rather than re-encoded.

---

## What the validator checks today

| Rule ID | Enforced |
| --- | --- |
| `frontend-no-backend` | ✅ |
| `backend-no-frontend` | ✅ |
| `shared-no-platforms` | ✅ |
| `database-no-upper-layers` | ✅ |
| `platforms-no-apps` | ✅ |
| `app-internal-isolation` | ✅ |
| `component-public-entry` | ✅ |

Rules 7–11 and 15–16 are partly conventions the validator cannot fully check —
it can see that a route file imports a platform, not whether a function inside
it encodes a business rule. Those are review responsibilities.

Static imports, `export … from`, dynamic `import()` and `require()` are all
inspected. Commented-out imports are ignored.

---

## Scope in Phase 0

Enforcement covers `apps/`, `platforms/`, `database/` and `shared/` only.

`frontend/`, `backend/` and `e2e/` are **legacy-active roots** — they serve
production and are deliberately excluded until their modules migrate. Adding
them to enforcement now would produce hundreds of violations describing code
that is working correctly under the old structure.

---

## Running it

```bash
npm run architecture:test    # validator self-tests
npm run architecture:check   # scan the repository
```

Both run in CI on pull requests and on pushes to `main` and `staging`. Neither
installs dependencies, touches a database, or needs secrets.

---

Related: [`COMPONENT_TEMPLATE.md`](COMPONENT_TEMPLATE.md),
[`VERTICAL_SLICE_MIGRATION_MAP.md`](VERTICAL_SLICE_MIGRATION_MAP.md),
[`MODULAR_ARCHITECTURE_FOUNDATION.md`](MODULAR_ARCHITECTURE_FOUNDATION.md).
