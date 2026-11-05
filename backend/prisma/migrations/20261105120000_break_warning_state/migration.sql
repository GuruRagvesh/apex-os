-- Break alarm state lives on the break itself instead of one app_settings
-- row per break, so the scheduler can select only the alarms that are due.
ALTER TABLE "break_logs" ADD COLUMN "warningStage" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN "warningUpdatedAt" TIMESTAMP(3),
ADD COLUMN "earlyWarningSentAt" TIMESTAMP(3),
ADD COLUMN "finalWarningSentAt" TIMESTAMP(3);

-- Breaks that already ended can never alarm.
UPDATE "break_logs" SET "warningStage" = 'COMPLETE' WHERE "endAt" IS NOT NULL;

-- CreateIndex
CREATE INDEX "break_logs_endAt_warningStage_plannedEndAt_idx" ON "break_logs"("endAt", "warningStage", "plannedEndAt");
