-- Collaboration availability is separate from the official workday state.
ALTER TABLE "users"
  ADD COLUMN "availabilityStatus" TEXT NOT NULL DEFAULT 'AUTO',
  ADD COLUMN "availabilityExpiresAt" TIMESTAMP(3);
