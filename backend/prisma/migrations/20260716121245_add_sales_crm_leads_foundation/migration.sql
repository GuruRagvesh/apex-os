-- CreateTable
CREATE TABLE "sales_leads" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "departmentId" TEXT,
    "company" TEXT NOT NULL,
    "poc" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "alternatePhone" TEXT,
    "designation" TEXT,
    "location" TEXT,
    "linkedin" TEXT,
    "website" TEXT,
    "leadStage" TEXT NOT NULL DEFAULT 'Created',
    "leadSource" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'Medium',
    "headquarters" TEXT,
    "department" TEXT,
    "companySize" TEXT,
    "industry" TEXT,
    "serviceInterest" TEXT,
    "score" INTEGER,
    "age" INTEGER,
    "tags" JSONB,
    "customFields" JSONB,
    "initialNotes" TEXT,
    "lastActivityDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_lead_activities" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "activityType" TEXT NOT NULL,
    "comment" TEXT,
    "previousStage" TEXT,
    "newStage" TEXT,
    "createdById" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_lead_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_followups" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "note" TEXT,
    "followupDate" TEXT NOT NULL,
    "followupTime" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_followups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_requirements" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'Medium',
    "status" TEXT NOT NULL DEFAULT 'New Requirement',
    "timeline" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_deals" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "requirementId" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'Proposal Sent',
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentStatus" TEXT,
    "expectedCloseAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_deals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_leads_ownerId_idx" ON "sales_leads"("ownerId");

-- CreateIndex
CREATE INDEX "sales_leads_departmentId_idx" ON "sales_leads"("departmentId");

-- CreateIndex
CREATE INDEX "sales_leads_leadStage_idx" ON "sales_leads"("leadStage");

-- CreateIndex
CREATE INDEX "sales_leads_createdAt_idx" ON "sales_leads"("createdAt");

-- CreateIndex
CREATE INDEX "sales_leads_email_idx" ON "sales_leads"("email");

-- CreateIndex
CREATE INDEX "sales_leads_phone_idx" ON "sales_leads"("phone");

-- CreateIndex
CREATE INDEX "sales_lead_activities_leadId_idx" ON "sales_lead_activities"("leadId");

-- CreateIndex
CREATE INDEX "sales_lead_activities_createdById_idx" ON "sales_lead_activities"("createdById");

-- CreateIndex
CREATE INDEX "sales_lead_activities_occurredAt_idx" ON "sales_lead_activities"("occurredAt");

-- CreateIndex
CREATE INDEX "sales_followups_leadId_idx" ON "sales_followups"("leadId");

-- CreateIndex
CREATE INDEX "sales_followups_status_idx" ON "sales_followups"("status");

-- CreateIndex
CREATE INDEX "sales_followups_followupDate_idx" ON "sales_followups"("followupDate");

-- CreateIndex
CREATE INDEX "sales_requirements_leadId_idx" ON "sales_requirements"("leadId");

-- CreateIndex
CREATE INDEX "sales_requirements_status_idx" ON "sales_requirements"("status");

-- CreateIndex
CREATE INDEX "sales_requirements_ownerId_idx" ON "sales_requirements"("ownerId");

-- CreateIndex
CREATE INDEX "sales_deals_leadId_idx" ON "sales_deals"("leadId");

-- CreateIndex
CREATE INDEX "sales_deals_requirementId_idx" ON "sales_deals"("requirementId");

-- CreateIndex
CREATE INDEX "sales_deals_stage_idx" ON "sales_deals"("stage");

-- AddForeignKey
ALTER TABLE "sales_leads" ADD CONSTRAINT "sales_leads_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_leads" ADD CONSTRAINT "sales_leads_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_lead_activities" ADD CONSTRAINT "sales_lead_activities_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "sales_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_lead_activities" ADD CONSTRAINT "sales_lead_activities_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_followups" ADD CONSTRAINT "sales_followups_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "sales_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_followups" ADD CONSTRAINT "sales_followups_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_requirements" ADD CONSTRAINT "sales_requirements_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "sales_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_requirements" ADD CONSTRAINT "sales_requirements_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_deals" ADD CONSTRAINT "sales_deals_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "sales_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_deals" ADD CONSTRAINT "sales_deals_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "sales_requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

