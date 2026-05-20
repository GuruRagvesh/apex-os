-- Add personal detail fields to users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "dateOfBirth" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "gender" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bloodGroup" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "currentAddress" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "permanentAddress" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emergencyName" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emergencyPhone" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emergencyRelation" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "userLocation" TEXT DEFAULT 'Pune HQ';

-- Employment details
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employeeId" TEXT UNIQUE;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "designation" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employmentType" TEXT DEFAULT 'Full-time';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "workMode" TEXT DEFAULT 'Office';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "joiningDate" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "probationPeriod" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "reportingManager" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "teamLeadName" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "workLocation" TEXT DEFAULT 'Pune HQ';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "shiftTiming" TEXT DEFAULT '9:30 AM - 6:30 PM';

-- Payroll & statutory
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ctcAnnual" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "basicSalary" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "salaryStructure" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bankName" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "accountNumber" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ifscCode" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "accountHolderName" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "paymentMode" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "panNumber" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "aadhaarNumber" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "uanNumber" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pfApplicable" BOOLEAN DEFAULT true;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "esicApplicable" BOOLEAN DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "professionalTax" BOOLEAN DEFAULT true;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "taxRegime" TEXT;

-- Verification
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "verificationStatus" TEXT DEFAULT 'Pending';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "verifiedBy" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "verificationDate" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "hrNotes" TEXT;

-- CreateTable employee_documents
CREATE TABLE IF NOT EXISTS "employee_documents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'Pending',
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "employee_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "employee_documents_userId_idx" ON "employee_documents"("userId");
CREATE INDEX IF NOT EXISTS "employee_documents_documentType_idx" ON "employee_documents"("documentType");

ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
