CREATE TABLE "policy_document_revisions" (
  "id" TEXT NOT NULL,
  "policyKey" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "guidance" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "content" JSONB NOT NULL,
  "effectiveFrom" DATE,
  "createdById" TEXT NOT NULL,
  "publishedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "publishedAt" TIMESTAMP(3),
  CONSTRAINT "policy_document_revisions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "policy_document_revisions_policyKey_version_key" ON "policy_document_revisions"("policyKey", "version");
CREATE INDEX "policy_document_revisions_domain_status_effectiveFrom_idx" ON "policy_document_revisions"("domain", "status", "effectiveFrom");
CREATE INDEX "policy_document_revisions_policyKey_status_idx" ON "policy_document_revisions"("policyKey", "status");
