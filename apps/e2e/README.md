# apps/e2e/

Playwright runner and configuration root.

**Status: Phase 0 — empty scaffold.** `e2e/` at the repository root is the live
end-to-end suite. This folder takes over only when the runner moves.

## Why the runner is centralized but specs are not

Playwright needs one project root: one `playwright.config.ts`, one browser
install, one reporter configuration, one `npx playwright test` entry point.
Splitting that per component would mean many configs and many installs.

Feature specs, however, belong to their feature. So:

- **The runner lives here** — config, dependencies, reporters, global setup.
- **The specs live with their component** — `platforms/<...>/<component>/tests/e2e/`.

The config points `testDir`/`testMatch` into `platforms/` to discover them.

## May live here

- `playwright.config.ts`
- `package.json`, `package-lock.json` for Playwright itself
- Global setup/teardown
- Cross-cutting fixtures that no single component owns

## Must not live here

- Feature-specific specs. A workday spec belongs in
  `platforms/workforce/attendance/workday/tests/e2e/`.
- Helpers shared across many components — those go to `shared/testing/`.

## Dependency direction

```
apps/e2e → (runs against) a deployed or locally-served apps/web + apps/api
apps/e2e → shared/testing
```

E2E specs exercise the running system over HTTP and the browser. They do not
import platform source directly.

## Migration status

Empty. `e2e/` remains the live suite until the runner migrates.
