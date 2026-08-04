# apps/

Composition shells. Each app wires together features that live in
`platforms/` and exposes them over a transport — HTTP routes, a browser
bundle, or a test runner.

**Status: Phase 0 — empty scaffold.** `frontend/`, `backend/` and `e2e/` at the
repository root remain the live application roots and are what actually builds
and deploys today. Nothing here is wired into any build.

## Responsibility

Composition and transport only. An app answers "what is exposed, and where",
never "how does this behave".

## May live here

- Route adapters that re-export a screen from a platform component.
- Framework bootstrap (`main.ts`, `app.module.ts`, `next.config.js`).
- Framework configuration (`tsconfig.json`, `tailwind.config.ts`).
- Static assets served directly by the app.

## Must not live here

- Business rules, validation logic, or domain calculations.
- Database queries or Prisma access.
- Feature components, hooks, services, or state.
- Anything another app needs to import.

## Dependency direction

```
apps/ → platforms/ → shared/ → database/client
apps/ → shared/
```

Apps import **from** platforms and shared. Nothing imports **from** an app.
One app never imports another app's internals.

## Public import expectations

Apps import only a platform component's public `index.ts`:

```ts
// allowed
export { LeadsScreen as default } from '@apex/business/sales-crm/leads';

// forbidden — reaches past the public entry point
import { LeadsScreen } from '@apex/business/sales-crm/leads/frontend/screens/LeadsScreen';
```

## Contents

| Folder | Purpose |
| --- | --- |
| [`web/`](web/) | Next.js browser application. |
| [`api/`](api/) | NestJS HTTP API. |
| [`e2e/`](e2e/) | Playwright runner and configuration root. |

See [`../docs/architecture/MODULAR_ARCHITECTURE_FOUNDATION.md`](../docs/architecture/MODULAR_ARCHITECTURE_FOUNDATION.md).
