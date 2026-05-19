-- AlterTable
ALTER TABLE "tickets" ADD COLUMN "scheduledFor" TIMESTAMP(3);
ALTER TABLE "tickets" ADD COLUMN "scheduledNote" TEXT;
