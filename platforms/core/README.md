# platforms/core/

Identity, access, users, organizational structure and company settings —
the foundations every other platform depends on.

**Status: Phase 0 — empty scaffold.** Live code remains in
`backend/src/modules/core/`, `backend/src/common/services/` and
`frontend/app/(auth)/`. Migrates in **Phase 3**.

## Planned modules

| Module | Components |
| --- | --- |
| `identity/` | `authentication`, `authorization`, `password-recovery`, `sessions` |
| `users/` | `profiles`, `change-requests`, `administration` |
| `organization/` | `departments`, `roles`, `hierarchy` |
| `settings/` | (single component) |

## May live here

- Login, JWT issuance and validation, password recovery.
- Role and permission resolution, department-scope policies.
- User CRUD, profiles, employee documents, profile change requests.
- Departments, roles, reporting hierarchy.
- Company-wide `AppSetting` management.

## Must not live here

- Attendance, leave, or team-membership rules — those are `workforce/`.
- Guards, decorators, and the role-name constant — those are `shared/auth/`,
  because every platform needs them and putting them here would force
  `operations → core` imports for something that is not a core business rule.

## Dependency direction

`core/` is the most depended-upon platform. It must import from **no other
platform** — doing so would create a cycle almost immediately.

```
allowed:    core/ → shared/, core/ → database/client
forbidden:  core/ → workforce/, operations/, intelligence/, business/, system/
```

Other platforms consume `core/` through its components' public `index.ts`.

## Note on `sessions`

Apex OS is JWT-stateless — there is no server-side session store. The
`sessions` component is frontend-only, covering the post-login mode/welcome
flow.
