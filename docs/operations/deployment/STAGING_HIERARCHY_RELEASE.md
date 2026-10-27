# Staging organization hierarchy release

The organization hierarchy is a backend and database feature, not a frontend
mock. A release is complete only when all three layers agree:

1. `staging` contains the frontend and NestJS changes.
2. The four hierarchy migrations are applied to the independently verified
   staging database.
3. Render is serving that same staging commit.

## Release order

Follow the staging identity and preflight steps in
[Migration release procedure](MIGRATION_RELEASE_PROCEDURE.md). After preflight
is clear, apply migrations, then manually deploy the `staging` commit to the
`apex-os-backend-staging` Render service.

Never put `prisma migrate deploy` in a Render start command or trigger it from
a merge. The migration procedure deliberately requires a person to verify the
staging database identity first.

## Verification

After the approved migrations and manual Render deployment have started, run
the **Verify staging hierarchy release** GitHub workflow against the staging
commit. The workflow is deliberately manual: a staging push does not deploy
the backend or authorize database migrations. It waits up to 20 minutes for
Render to serve the selected commit before checking the database and route
contract.

Alternatively, run this command from a trusted terminal after deployment:

```bash
STAGING_API_URL=https://apex-os-backend-staging.onrender.com/api \
EXPECTED_COMMIT=<staging-commit> \
node scripts/deployment/verify-staging-hierarchy.mjs
```

The verifier requires all of the following:

- `/api/health` says `environment: staging` and reports the deployed commit.
- `/api/health/release-readiness` confirms all four hierarchy migrations.
- `/api/organization-hierarchy/organization` returns `401` or `403` when
  unauthenticated, proving the protected route is registered. A `404` means the
  frontend and backend are on different releases.
