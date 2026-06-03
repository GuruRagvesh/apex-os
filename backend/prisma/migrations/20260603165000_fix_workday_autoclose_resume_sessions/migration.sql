-- FP-16A.2 Workday auto-close resume sessions hotfix
-- Allows multiple work sessions per user/date and links resumed sessions.

ALTER TABLE "WorkSession"
ADD COLUMN IF NOT EXISTS "continuationOfSessionId" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'WorkSession'
      AND indexname = 'WorkSession_userId_date_key'
  ) THEN
    DROP INDEX "WorkSession_userId_date_key";
  END IF;
END $$;