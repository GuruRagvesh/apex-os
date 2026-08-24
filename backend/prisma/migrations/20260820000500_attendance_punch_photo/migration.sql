-- PE-3 Live photo evidence.
--
-- Adds the server-owned staging table for a camera capture, and the one-use
-- link from immutable punch evidence to it.
--
-- Purely additive: one new table, one nullable column plus a unique index on
-- attendance_punch_evidence, indexes and foreign keys. No column is dropped, no
-- type is changed, no existing row is modified, and the PE-1/PE-2 migrations
-- are untouched.
--
-- Photo BYTES are never stored here. Only a private storage reference and a
-- server-computed SHA-256.
--
-- The unique index on photoAssetId is the real one-use guarantee: two
-- concurrent punches racing for the same capture cannot both succeed, because
-- the second insert violates it. Application-level "find unused then insert"
-- would leave that race open.
--
-- NOT YET APPLIED ANYWHERE.

-- CreateTable
CREATE TABLE "attendance_punch_photos" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "clientCapturedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_punch_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_punch_photos_userId_expiresAt_idx" ON "attendance_punch_photos"("userId", "expiresAt");

-- AlterTable
ALTER TABLE "attendance_punch_evidence"
ADD COLUMN IF NOT EXISTS "photoAssetId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_punch_evidence_photoAssetId_key" ON "attendance_punch_evidence"("photoAssetId");

-- AddForeignKey
ALTER TABLE "attendance_punch_photos" ADD CONSTRAINT "attendance_punch_photos_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_punch_evidence" ADD CONSTRAINT "attendance_punch_evidence_photoAssetId_fkey" FOREIGN KEY ("photoAssetId") REFERENCES "attendance_punch_photos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
