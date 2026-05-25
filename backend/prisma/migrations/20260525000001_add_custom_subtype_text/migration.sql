-- AlterTable: add customSubtypeText to tickets
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "customSubtypeText" TEXT;
