-- Attribution for ticket attachments whose uploader has been deleted.
--
-- WHY THIS EXISTS. Upstream added Attachment.uploadedBy after the user-
-- deletion classification was written, and the classification guard failed on
-- merge -- which is what it is for: a new User foreign key gets a deletion
-- decision before it can ship. The decision is RETAIN_WITH_SNAPSHOT.
--
-- An attachment is company evidence on a ticket: a submitted proof of
-- completion, or a reviewer's feedback file, which the model itself locks once
-- it is "evidence of record". It must survive its uploader leaving, and who
-- submitted a POC is exactly what an audit asks about later.
--
-- ONE NULLABLE COLUMN AND ONE FOREIGN KEY. uploadedById is already nullable
-- upstream, so nothing has to be widened here.
--
-- DESTRUCTIVE-SQL REVIEW: no DROP TABLE, no TRUNCATE, no DELETE FROM. CASCADE
-- appears only as ON UPDATE CASCADE, which propagates a key change and is not
-- a delete rule. Purely additive.
--
-- A NOTE ON THE SIDE EFFECT, recorded because it is deliberate. Clearing
-- uploadedById during a deletion also makes the attachment "legacy protected"
-- by Attachment's own rule -- a null uploader is never deletable through the
-- normal API. For evidence whose owner has left the company, refusing casual
-- deletion is the safe direction, so this is accepted rather than worked
-- around.

ALTER TABLE "attachments"
  ADD COLUMN IF NOT EXISTS "formerUploaderId" TEXT;

-- ON DELETE RESTRICT, like every other tombstone reference: a FormerEmployee
-- is the only remaining record of who somebody was, and deleting one while an
-- attachment still points at it would recreate the problem the tombstone
-- exists to solve.
DO $$ BEGIN
  ALTER TABLE "attachments"
    ADD CONSTRAINT "attachments_formerUploaderId_fkey"
    FOREIGN KEY ("formerUploaderId") REFERENCES "former_employees"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
