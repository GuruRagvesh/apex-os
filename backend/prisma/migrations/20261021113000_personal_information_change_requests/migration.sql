-- Separate official identity/contact data from employee-controlled display data.
ALTER TABLE "users"
  ADD COLUMN "legalName" TEXT,
  ADD COLUMN "personalEmail" TEXT;

-- Preserve the current identity value as the initial official baseline while
-- leaving `name` available for employee-controlled display personalization.
UPDATE "users" SET "legalName" = "name" WHERE "legalName" IS NULL;

-- Additive workflow metadata; existing hierarchy requests remain unchanged.
ALTER TABLE "employee_profile_change_requests"
  ADD COLUMN "supportingDocumentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "employeeConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "employeeDeclinedAt" TIMESTAMP(3),
  ADD COLUMN "employeeDeclineReason" TEXT;

-- Close the check-then-insert race: an employee can have only one unresolved
-- official personal-information request, regardless of who initiated it.
CREATE UNIQUE INDEX "employee_profile_change_requests_one_personal_pending"
  ON "employee_profile_change_requests" ("targetUserId")
  WHERE "requestType" = 'PERSONAL_INFORMATION'
    AND "status" IN ('AWAITING_EMPLOYEE_CONFIRMATION', 'PENDING_HR_REVIEW');
