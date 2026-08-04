# shared/testing/

Test helpers and fixtures used by more than one component.

**Status: Phase 0 — empty scaffold.** Live code is
`backend/test/helpers/{app,auth}.helper.ts`, `backend/test/jest.env.ts` and
`e2e/tests/utils.ts`.

## May live here

- Test application bootstrap (`createTestApp`).
- Authentication helpers (`loginAs`, `bearerFor`).
- Jest environment setup.
- Playwright helpers used across many component specs.
- Generic factories and builders.

## Must not live here

- Component-specific tests. Those live in the component's own
  `tests/{frontend,backend,integration,e2e}/`.
- Fixtures encoding one feature's domain shape — a `makeWorkSession()` factory
  belongs to `workforce/attendance/workday/tests/`.
- Production code of any kind. Nothing here ships.

## Dependency direction

```
platforms/*/tests → shared/testing
apps/e2e          → shared/testing
shared/testing    → shared/* (may import other shared modules)
```

`shared/testing` may import `platforms/` **types** where a helper needs them,
but must not import platform runtime code — a test helper that instantiates a
real service is a component fixture, not a shared one.

## Known pre-existing issue

Several current specs fail on `main` due to a mock gap — `tva.companyDateOnly`
is not stubbed in older test setups. When `shared/testing` is populated, the
bootstrap helper should provide a complete, current time-authority mock so this
class of failure stops recurring per-file.
