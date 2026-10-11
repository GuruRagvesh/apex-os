-- Phase 7: team/project productivity configuration, ticket output targets,
-- planned-break reminders and personal workday notes.
-- All columns are nullable/additive so existing rows retain their meaning.

ALTER TABLE "projects"
  ADD COLUMN "outputTargetMinutes" INTEGER;

ALTER TABLE "tickets"
  ADD COLUMN "outputTargetMinutes" INTEGER;

ALTER TABLE "break_logs"
  ADD COLUMN "plannedEndAt" TIMESTAMP(3);

ALTER TABLE "teams"
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_output_target_minutes_range"
  CHECK ("outputTargetMinutes" IS NULL OR "outputTargetMinutes" BETWEEN 1 AND 1440);

ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_output_target_minutes_range"
  CHECK ("outputTargetMinutes" IS NULL OR "outputTargetMinutes" BETWEEN 1 AND 1440);

CREATE TABLE "project_team_assignments" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "outputTargetMinutes" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "project_team_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_team_assignments_output_target_minutes_range"
    CHECK ("outputTargetMinutes" IS NULL OR "outputTargetMinutes" BETWEEN 1 AND 1440)
);

CREATE UNIQUE INDEX "project_team_assignments_projectId_teamId_key"
  ON "project_team_assignments"("projectId", "teamId");
CREATE INDEX "project_team_assignments_teamId_idx"
  ON "project_team_assignments"("teamId");
ALTER TABLE "project_team_assignments"
  ADD CONSTRAINT "project_team_assignments_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_team_assignments"
  ADD CONSTRAINT "project_team_assignments_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "workday_notes" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "workSessionId" TEXT,
  "content" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workday_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "workday_notes_userId_createdAt_idx"
  ON "workday_notes"("userId", "createdAt");
CREATE INDEX "workday_notes_workSessionId_idx"
  ON "workday_notes"("workSessionId");
CREATE UNIQUE INDEX "workday_notes_userId_idempotencyKey_key"
  ON "workday_notes"("userId", "idempotencyKey");
ALTER TABLE "workday_notes"
  ADD CONSTRAINT "workday_notes_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workday_notes"
  ADD CONSTRAINT "workday_notes_workSessionId_fkey"
  FOREIGN KEY ("workSessionId") REFERENCES "work_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_workday_note_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Workday notes are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "workday_notes_no_update"
BEFORE UPDATE ON "workday_notes"
FOR EACH ROW EXECUTE FUNCTION prevent_workday_note_mutation();

CREATE TRIGGER "workday_notes_no_delete"
BEFORE DELETE ON "workday_notes"
FOR EACH ROW EXECUTE FUNCTION prevent_workday_note_mutation();

-- QC Implement is a department-specific Task Type. Deterministic IDs make the
-- data migration retry-safe while the existing unique key prevents duplicates.
INSERT INTO "task_types" ("id", "name", "departmentId", "isGlobal", "order", "createdAt")
SELECT 'phase7_qc_' || md5(d."id"), 'QC Implement', d."id", false, 0, CURRENT_TIMESTAMP
FROM "departments" d
WHERE lower(d."name") IN ('content', 'content sales', 'retail business')
ON CONFLICT ("name", "departmentId") DO NOTHING;

CREATE INDEX "teams_isActive_idx" ON "teams"("isActive");
