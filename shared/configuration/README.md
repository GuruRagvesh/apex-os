# shared/configuration/

Application-wide constants and environment resolution.

**Status: Phase 0 — empty scaffold.** Live code includes
`frontend/lib/constants.ts`.

## May live here

- Environment-name resolution (`production`, `staging`, `development`).
- API base-URL resolution.
- Constants used across platforms.
- Feature-flag *reading* helpers — the mechanism, not the flag list.

## Must not live here

- **Secrets, credentials, tokens, connection strings.** Ever. Those come from
  environment variables at runtime and are never committed.
- `.env` files of any kind.
- Feature-specific constants. The daily break allowance belongs to
  `workforce/attendance`, not here.

## Feature flags

Apex OS has no flag framework today — `NEXT_PUBLIC_SALES_CRM_LEADS_BACKEND_ENABLED`
is a bare environment variable read in one place, defaulting off unless the
value is exactly `"true"`.

If a framework is introduced, its *mechanism* belongs here; the *flags
themselves* belong to the features they gate. New risky behaviour ships dark:
flags default OFF, and a missing flag means OFF.

## Dependency direction

```
platforms/* → shared/configuration
apps/*      → shared/configuration
shared/configuration → (nothing)
```

## Note

Server-side settings stored in the `AppSetting` table (workday policy, SMTP
config) are **not** configuration in this sense — they are data owned by
`core/settings`. This folder covers build-time and environment-level values
only.
