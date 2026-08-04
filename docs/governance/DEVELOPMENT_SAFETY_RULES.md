# Development Safety Rules

To prevent catastrophic data loss, all developers, including automated agents, MUST adhere to the following rules:

1. **Never test on production.** All tests, including simple read queries, should run against a local SQLite/PostgreSQL instance or a dedicated staging database.
2. **Never run `deleteMany` against production.** Use targeted `delete` with specific IDs if manual cleanup is absolutely necessary, and only after a verified backup.
3. **Never run `migrate reset` against production.** This command drops the database and recreates it. It is strictly for local development.
4. **Every destructive script requires approval.** Any script that alters or deletes data must be reviewed by another engineer and use the `destructive-operation-guard`.
5. **Every backup must be verified.** A backup is not a backup until `scripts/verify-backup.ts` passes successfully against the `backup_manifest.json`.
6. **Every recovery must be tested on backup/staging DB first.** Never restore directly into the live production database without a successful trial run in a staging environment.
7. **Every production deployment requires backup confirmation.** Before merging to `main` or triggering a deployment, ensure a recent, verified backup exists.
