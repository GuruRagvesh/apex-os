-- Policy Center acknowledgements are publication records only. They are
-- deliberately independent from attendance, leave and payroll configuration.
CREATE TABLE "policy_acknowledgements" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "policyKey" TEXT NOT NULL,
  "policyVersion" INTEGER NOT NULL,
  "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "policy_acknowledgements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "policy_acknowledgements_userId_policyKey_policyVersion_key"
  ON "policy_acknowledgements"("userId", "policyKey", "policyVersion");
CREATE INDEX "policy_acknowledgements_userId_acknowledgedAt_idx"
  ON "policy_acknowledgements"("userId", "acknowledgedAt");

ALTER TABLE "policy_acknowledgements"
  ADD CONSTRAINT "policy_acknowledgements_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
