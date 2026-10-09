CREATE TABLE "correction_screenshots" (
 "id" TEXT NOT NULL,
 "regularizationId" TEXT NOT NULL,
 "filename" TEXT NOT NULL,
 "mimeType" TEXT NOT NULL,
 "byteSize" INTEGER NOT NULL,
 "content" BYTEA NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "correction_screenshots_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "correction_screenshots_size_check" CHECK ("byteSize" > 0 AND "byteSize" <= 2097152 AND octet_length("content") = "byteSize"),
 CONSTRAINT "correction_screenshots_type_check" CHECK ("mimeType" IN ('image/png','image/jpeg','image/webp'))
);
CREATE INDEX "correction_screenshots_regularizationId_idx" ON "correction_screenshots"("regularizationId");
ALTER TABLE "correction_screenshots" ADD CONSTRAINT "correction_screenshots_regularizationId_fkey" FOREIGN KEY ("regularizationId") REFERENCES "attendance_regularizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
