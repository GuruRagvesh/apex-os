# Manual Backup Database Setup

## Overview
This setup defines a strict, manual procedure to clone the Production database into a secondary Backup database. Automatic restores are prohibited to prevent recursive corruption.

## Architecture
\`Production DB -> Manual Backup via pg_dump -> Backup DB\`

## 1. How to Clone Production
1. **Ensure environment is clean:** Run from a secure environment (e.g., local securely authenticated terminal or secure CI job).
2. **Execute Backup Script:**
   \`\`\`bash
   npx ts-node scripts/backup-database.ts
   \`\`\`
3. **Verify Artifacts:** The script will output:
   - \`apex_backup_YYYY-MM-DD_HH-mm.sql.gz\`
   - \`backup_manifest.json\`
   - \`BACKUP_REPORT.md\`
4. **Secure the Archive:** Upload the \`.sql.gz\` and \`backup_manifest.json\` to secure cloud storage (e.g., AWS S3, Google Cloud Storage) with versioning enabled. Do NOT commit them to git.

## 2. How to Restore Backups
*Restores should ONLY be performed against the Backup DB or Staging DB first. NEVER restore directly to Production without validation.*

1. **Locate the Backup:** Download the desired \`apex_backup_*.sql.gz\` and its corresponding \`backup_manifest.json\`.
2. **Decompress:**
   \`\`\`bash
   gunzip apex_backup_YYYY-MM-DD_HH-mm.sql.gz
   \`\`\`
3. **Restore to Secondary DB:**
   Ensure your \`DATABASE_URL\` is pointing to the **Backup/Staging DB**.
   \`\`\`bash
   psql "postgres://user:pass@host:port/backup_db" < apex_backup_YYYY-MM-DD_HH-mm.sql
   \`\`\`

## 3. Verification Process
1. Place the `backup_manifest.json` and the compressed `.sql.gz` in the root backend directory.
2. Run the verification script:
   \`\`\`bash
   npx ts-node scripts/verify-backup.ts
   \`\`\`
3. Review \`BACKUP_VERIFICATION_REPORT.md\` to ensure the checksums, file sizes, and table counts perfectly match the state of the database when the backup was taken.

## Important Rule
**No automatic restore.** Restores are catastrophic operations that overwrite current data. They must always be executed manually by a Lead Engineer after full verification.
