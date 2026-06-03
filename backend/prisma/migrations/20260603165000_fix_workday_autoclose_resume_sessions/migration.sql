-- FP-16A.2 Workday auto-close resume sessions hotfix
-- Allows multiple work sessions per user/date and links resumed sessions.

ALTER TABLE "work_sessions"
ADD COLUMN IF NOT EXISTS "continuationOfSessionId" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'work_sessions'
      AND indexname = 'work_sessions_userId_date_key'
  ) THEN
    DROP INDEX "work_sessions_userId_date_key";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'work_sessions'
      AND indexname = 'WorkSession_userId_date_key'
  ) THEN
    DROP INDEX "WorkSession_userId_date_key";
  END IF;
END $$;