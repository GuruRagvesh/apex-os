ALTER TABLE "quick_ticket_templates"
ADD COLUMN "assigneeIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "quick_ticket_templates"
SET "assigneeIds" = ARRAY["assigneeId"]
WHERE "assigneeId" IS NOT NULL;

ALTER TABLE "quick_ticket_templates"
DROP COLUMN "assigneeId";
