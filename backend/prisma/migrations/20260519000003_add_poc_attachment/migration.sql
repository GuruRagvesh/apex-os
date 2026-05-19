-- AlterTable
ALTER TABLE "attachments" ADD COLUMN "isPoc" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "attachments" ADD COLUMN "pocFor" TEXT;
