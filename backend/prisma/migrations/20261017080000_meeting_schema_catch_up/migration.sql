-- Catch-up for databases created from an earlier version of
-- 20261013000000_meeting_approval_workflow (that file was later edited after
-- some databases had already applied it). Add-only and idempotent: on a
-- database that already has these columns every statement is a no-op, and no
-- existing column or row is removed.

-- meetings: organizer / counterparty name snapshots and the counterparty.
ALTER TABLE "meetings" ADD COLUMN IF NOT EXISTS "organizerNameSnapshot" TEXT;
ALTER TABLE "meetings" ADD COLUMN IF NOT EXISTS "counterpartyId" TEXT;
ALTER TABLE "meetings" ADD COLUMN IF NOT EXISTS "counterpartyNameSnapshot" TEXT;

UPDATE "meetings" m
   SET "organizerNameSnapshot" = COALESCE(m."organizerNameSnapshot", u."name")
  FROM "users" u
 WHERE u."id" = m."organizerId" AND m."organizerNameSnapshot" IS NULL;
-- Older rows recorded no separate counterparty: the organizer stands in.
UPDATE "meetings" SET "counterpartyId" = "organizerId" WHERE "counterpartyId" IS NULL;
UPDATE "meetings" SET "counterpartyNameSnapshot" = "organizerNameSnapshot" WHERE "counterpartyNameSnapshot" IS NULL;

ALTER TABLE "meetings" ALTER COLUMN "organizerNameSnapshot" SET NOT NULL;
ALTER TABLE "meetings" ALTER COLUMN "counterpartyId" SET NOT NULL;
ALTER TABLE "meetings" ALTER COLUMN "counterpartyNameSnapshot" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "meetings_counterpartyId_status_idx" ON "meetings"("counterpartyId", "status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meetings_counterpartyId_fkey') THEN
    ALTER TABLE "meetings" ADD CONSTRAINT "meetings_counterpartyId_fkey"
      FOREIGN KEY ("counterpartyId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  -- The early approver column is kept (with its data) but is no longer required.
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'meetings' AND column_name = 'approverId') THEN
    ALTER TABLE "meetings" ALTER COLUMN "approverId" DROP NOT NULL;
  END IF;
END $$;

-- meeting_participants: display-name snapshot; the user reference becomes
-- optional and is cleared (not blocked) when an account is deleted.
ALTER TABLE "meeting_participants" ADD COLUMN IF NOT EXISTS "displayNameSnapshot" TEXT;
UPDATE "meeting_participants" p
   SET "displayNameSnapshot" = u."name"
  FROM "users" u
 WHERE u."id" = p."userId" AND p."displayNameSnapshot" IS NULL;
UPDATE "meeting_participants" SET "displayNameSnapshot" = 'Former employee' WHERE "displayNameSnapshot" IS NULL;
ALTER TABLE "meeting_participants" ALTER COLUMN "displayNameSnapshot" SET NOT NULL;
ALTER TABLE "meeting_participants" ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "meeting_participants" DROP CONSTRAINT IF EXISTS "meeting_participants_userId_fkey";
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
