CREATE TABLE "asset_types" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "asset_types_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "company_assets" (
  "id" TEXT NOT NULL,
  "assetCode" TEXT NOT NULL,
  "assetTypeId" TEXT,
  "brandModel" TEXT NOT NULL,
  "specification" TEXT,
  "modelNumber" TEXT,
  "ownership" TEXT NOT NULL,
  "vendorName" TEXT,
  "acquisitionDate" DATE,
  "vendorReturnDate" DATE,
  "purchaseCost" DECIMAL(14,2),
  "monthlyRent" DECIMAL(14,2),
  "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
  "chargerIncluded" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "company_assets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "company_assets_ownership_check" CHECK ("ownership" IN ('OWNED', 'RENTED'))
);

CREATE TABLE "asset_allocations" (
  "id" TEXT NOT NULL, "assetId" TEXT NOT NULL, "employeeId" TEXT,
  "employeeName" TEXT NOT NULL, "branch" TEXT, "fromDate" DATE NOT NULL,
  "toDate" DATE, "returned" BOOLEAN NOT NULL DEFAULT false,
  "conditionAtIssue" TEXT, "conditionAtReturn" TEXT,
  "repairingCost" DECIMAL(14,2), "repairingDate" DATE,
  "hodManagerName" TEXT, "accessories" JSONB, "workflowStatus" TEXT NOT NULL DEFAULT 'ACTIVE_ASSIGNMENT',
  "acknowledgedAt" TIMESTAMP(3), "returnRequestedAt" TIMESTAMP(3), "remarks" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "asset_allocations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "asset_repairs" (
  "id" TEXT NOT NULL, "assetId" TEXT, "brand" TEXT NOT NULL, "specification" TEXT,
  "issues" TEXT NOT NULL, "reportedDate" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "repairingDate" DATE, "expectedCompletionDate" DATE, "completedDate" DATE,
  "estimatedCost" DECIMAL(14,2), "finalCost" DECIMAL(14,2), "status" TEXT NOT NULL DEFAULT 'REPORTED',
  "repairVendor" TEXT, "outcome" TEXT, "responsibility" TEXT, "remarks" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "asset_repairs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "asset_rental_payments" (
  "id" TEXT NOT NULL, "assetId" TEXT NOT NULL, "periodMonth" DATE NOT NULL,
  "employeeName" TEXT, "branch" TEXT, "vendorName" TEXT, "specification" TEXT, "modelName" TEXT,
  "monthlyRent" DECIMAL(14,2) NOT NULL, "approvedBy" TEXT, "paid" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "asset_rental_payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "asset_mobile_subscriptions" (
  "id" TEXT NOT NULL, "employeeId" TEXT, "employeeName" TEXT NOT NULL, "branch" TEXT,
  "model" TEXT, "simProvider" TEXT NOT NULL, "phoneNumber" TEXT NOT NULL, "plan" TEXT,
  "amount" DECIMAL(14,2), "frequency" TEXT NOT NULL DEFAULT 'MONTHLY',
  "lastRechargeDate" DATE, "dueDate" DATE, "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "asset_mobile_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "asset_mobile_recharges" (
  "id" TEXT NOT NULL, "subscriptionId" TEXT NOT NULL, "billingMonth" DATE NOT NULL,
  "rechargeDate" DATE, "dueDate" DATE, "plan" TEXT, "amount" DECIMAL(14,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "asset_mobile_recharges_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "asset_requests" (
  "id" TEXT NOT NULL, "requestCode" TEXT NOT NULL, "requestType" TEXT NOT NULL,
  "employeeId" TEXT, "employeeName" TEXT NOT NULL, "department" TEXT, "branch" TEXT,
  "managerName" TEXT, "requestedAssetType" TEXT, "linkedAssetId" TEXT, "reason" TEXT NOT NULL,
  "priority" TEXT NOT NULL DEFAULT 'MEDIUM', "requiredByDate" DATE,
  "status" TEXT NOT NULL DEFAULT 'SUBMITTED', "adminOwner" TEXT,
  "employeeRemark" TEXT, "managerRemark" TEXT, "adminRemark" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "asset_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "asset_audit_events" (
  "id" TEXT NOT NULL, "actorId" TEXT NOT NULL, "actorName" TEXT, "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL, "action" TEXT NOT NULL, "before" JSONB, "after" JSONB,
  "metadata" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "asset_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "asset_import_batches" (
  "id" TEXT NOT NULL, "fileName" TEXT NOT NULL, "fileSha256" TEXT NOT NULL,
  "sheets" JSONB NOT NULL, "summary" JSONB NOT NULL, "errorCount" INTEGER NOT NULL DEFAULT 0,
  "errors" JSONB, "importedById" TEXT NOT NULL, "importedByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "asset_import_batches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "asset_types_name_key" ON "asset_types"("name");
CREATE UNIQUE INDEX "company_assets_assetCode_key" ON "company_assets"("assetCode");
CREATE INDEX "company_assets_assetTypeId_idx" ON "company_assets"("assetTypeId");
CREATE INDEX "company_assets_status_idx" ON "company_assets"("status");
CREATE INDEX "company_assets_ownership_idx" ON "company_assets"("ownership");
CREATE INDEX "asset_allocations_assetId_returned_idx" ON "asset_allocations"("assetId", "returned");
CREATE UNIQUE INDEX "asset_allocations_one_active_per_asset" ON "asset_allocations"("assetId") WHERE "returned" = false;
CREATE INDEX "asset_allocations_employeeId_idx" ON "asset_allocations"("employeeId");
CREATE INDEX "asset_allocations_employeeName_idx" ON "asset_allocations"("employeeName");
CREATE INDEX "asset_repairs_assetId_idx" ON "asset_repairs"("assetId");
CREATE INDEX "asset_repairs_status_idx" ON "asset_repairs"("status");
CREATE UNIQUE INDEX "asset_rental_payments_assetId_periodMonth_key" ON "asset_rental_payments"("assetId", "periodMonth");
CREATE INDEX "asset_rental_payments_paid_idx" ON "asset_rental_payments"("paid");
CREATE UNIQUE INDEX "asset_mobile_subscriptions_phoneNumber_key" ON "asset_mobile_subscriptions"("phoneNumber");
CREATE INDEX "asset_mobile_subscriptions_employeeId_idx" ON "asset_mobile_subscriptions"("employeeId");
CREATE INDEX "asset_mobile_subscriptions_status_idx" ON "asset_mobile_subscriptions"("status");
CREATE UNIQUE INDEX "asset_mobile_recharges_subscriptionId_billingMonth_key" ON "asset_mobile_recharges"("subscriptionId", "billingMonth");
CREATE INDEX "asset_mobile_recharges_dueDate_idx" ON "asset_mobile_recharges"("dueDate");
CREATE UNIQUE INDEX "asset_requests_requestCode_key" ON "asset_requests"("requestCode");
CREATE INDEX "asset_requests_status_idx" ON "asset_requests"("status");
CREATE INDEX "asset_requests_employeeId_idx" ON "asset_requests"("employeeId");
CREATE INDEX "asset_audit_events_entityType_entityId_idx" ON "asset_audit_events"("entityType", "entityId");
CREATE INDEX "asset_audit_events_createdAt_idx" ON "asset_audit_events"("createdAt");
CREATE INDEX "asset_import_batches_fileSha256_idx" ON "asset_import_batches"("fileSha256");
CREATE INDEX "asset_import_batches_createdAt_idx" ON "asset_import_batches"("createdAt");

ALTER TABLE "company_assets" ADD CONSTRAINT "company_assets_assetTypeId_fkey" FOREIGN KEY ("assetTypeId") REFERENCES "asset_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "asset_allocations" ADD CONSTRAINT "asset_allocations_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "company_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "asset_repairs" ADD CONSTRAINT "asset_repairs_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "company_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "asset_rental_payments" ADD CONSTRAINT "asset_rental_payments_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "company_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "asset_mobile_recharges" ADD CONSTRAINT "asset_mobile_recharges_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "asset_mobile_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
