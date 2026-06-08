# Disaster Recovery Standard Operating Procedure (SOP)

## Scenario 1: Accidental Ticket Deletion
- **Detection:** Users report missing tickets, or automated table counts drop unexpectedly.
- **Containment:** Immediately restrict dashboard access or put the app in maintenance mode to prevent new tickets from being created with reused IDs.
- **Recovery:** 
  1. Identify the exact time of deletion.
  2. Run `scripts/verify-backup.ts` on the latest backup prior to deletion.
  3. Extract the `tickets` table data from the `.sql` backup.
  4. Perform an additive restore OR use a specialized recovery script (like `ticket_recovery_restore.ts`) to merge missing records.
- **Validation:** Check `ticket` table counts and verify relations (`RESTORE_RELATION_HEALTH_REPORT.md`).
- **Rollback:** If recovery fails, revert to the state captured immediately before the recovery attempt.

## Scenario 2: Database Corruption
- **Detection:** Prisma throws constraint errors, queries return garbage data, or API endpoints crash with 500s.
- **Containment:** Shut down the API servers immediately to prevent further corruption spreading to third-party integrations.
- **Recovery:** 
  1. Spin up the secondary Backup DB.
  2. Restore the last known good full backup (`.sql.gz`) to the Backup DB.
  3. Change `DATABASE_URL` in production to point to the new Backup DB.
- **Validation:** Run the full e2e test suite against the newly restored DB. Verify checksums via `backup_manifest.json`.
- **Rollback:** N/A (Production is already corrupt. Keep the corrupt DB instance offline for forensics).

## Scenario 3: Failed Deployment
- **Detection:** Post-deploy health checks fail, or error rate spikes in monitoring tools.
- **Containment:** Halt any further rollouts. 
- **Recovery:** 
  1. Revert the commit in version control.
  2. Redeploy the previous stable tag/commit.
- **Validation:** Monitor error rates for 15 minutes post-revert. Run manual smoke tests on core workflows.
- **Rollback:** If the revert fails, manually adjust the deployment container image hash to the previous version in the hosting provider.

## Scenario 4: Bad Migration
- **Detection:** `prisma migrate deploy` fails, or subsequent queries fail due to missing columns/tables.
- **Containment:** Stop the deployment pipeline. Put the application in maintenance mode.
- **Recovery:** 
  1. Do NOT run `migrate reset` in production.
  2. If the migration was partially applied, manually fix the schema using `psql` to match the target state, or apply a down-migration script.
  3. If unrecoverable, restore the pre-deployment backup to the Backup DB and point production to it.
- **Validation:** Ensure `prisma migrate status` shows all migrations applied successfully.
- **Rollback:** Restore from the `apex_backup_*.sql.gz` taken immediately before the `prisma migrate deploy` command.

## Scenario 5: Complete Database Loss
- **Detection:** Database provider goes offline, or the instance is maliciously/accidentally deleted.
- **Containment:** Update DNS/Load Balancers to show a static "Under Maintenance" page.
- **Recovery:** 
  1. Provision a completely new PostgreSQL instance.
  2. Download the latest backup `.sql.gz` from secure cloud storage.
  3. Execute a full restore to the new instance.
  4. Apply any Prisma migrations if the schema was updated after the backup.
- **Validation:** Run `scripts/verify-backup.ts`. Ensure all 14 critical table counts match the manifest.
- **Rollback:** If the restore fails mid-way, wipe the new instance and restart the restore process.
