# Migration release procedure

Applying a database migration is a separate, deliberate operation. It is not a
side effect of deploying, restarting, or scaling a service.

## Why this exists

Until 2026-08-21 the backend started with:

```
npx prisma migrate deploy && node dist/main.js
```

in **two** places — `render.yaml`'s `startCommand` and `backend/package.json`'s
`start:prod`. That meant:

- merging a branch containing a migration applied it to production on the next
  deploy, with no approval step;
- an ordinary **restart** — including one Render performs by itself after a
  crash or a health-check failure — was also a schema-migration event;
- there was no point at which anyone verified *which* database was about to be
  changed.

Both now start the application and nothing else. Migration is the procedure
below.

## Staging

```bash
cd backend

# 1. Identity gate + read-only data preflight. Connects, reads, writes nothing.
APP_ENV=staging \
EXPECTED_STAGING_DB_HOST='<staging host from Render>' \
EXPECTED_STAGING_DB_NAME='<staging database from Render>' \
DATABASE_URL='<staging url>' \
npx ts-node scripts/staging-preflight.ts
```

Require `STAGING IDENTITY: PASSED` **and** `PREFLIGHT: CLEAR`. Review every
WARNING. Any BLOCKER, identity mismatch, missing `APP_ENV`, or ambiguous
database identity means stop.

The expected host and database name must be read off the Render dashboard by a
person. They are not derived from the connection string — matching the URL only
proves the connection went where the URL pointed, which says nothing about
whether that URL is staging.

```bash
# 2. What would be applied.
APP_ENV=staging DATABASE_URL='<staging url>' npm run db:migrate:status

# 3. Apply. Only after 1 and 2 are clean.
APP_ENV=staging DATABASE_URL='<staging url>' npm run db:migrate:deploy

# 4. Confirm.
APP_ENV=staging DATABASE_URL='<staging url>' npm run db:migrate:status
```

Then deploy the application, which now only starts it.

## Production

The same four steps, plus:

- **explicit approval** for that specific release;
- production identity verified independently — host *and* database name read off
  Render, not inferred from a service name or a connection string;
- a database backup taken immediately before step 3;
- a stated rollback (see `docs/operations/backup-recovery/DISASTER_RECOVERY_SOP.md`).

There is deliberately no production preflight script. The staging script's
positive `APP_ENV=staging` assertion is what makes it safe, and a production
variant would be a script whose purpose is to permit changing production — which
is exactly the thing that should require a human at every step.

## Deploy order

Additive migrations (new nullable columns, new tables, new indexes) can be
applied before the code that uses them, because existing code ignores them.
That is the normal order:

```
migrate  ->  deploy code
```

A migration that is NOT additive needs a plan of its own, and does not belong in
a routine release.

## What must never be automated

- `prisma migrate deploy` in a start command, entrypoint, Dockerfile `CMD`, or
  health check.
- `prisma migrate reset`, `prisma db push`, or any seed/repair script against a
  deployed environment.
- Any migration triggered by a merge, a tag, or a CI job without a human
  confirming the target database first.
