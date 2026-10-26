CREATE TABLE "organization_reporting_lines" (
    "id" TEXT NOT NULL,
    "subjectUserId" TEXT NOT NULL,
    "supervisorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_reporting_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organization_reporting_lines_subjectUserId_key" ON "organization_reporting_lines"("subjectUserId");
CREATE INDEX "organization_reporting_lines_supervisorId_idx" ON "organization_reporting_lines"("supervisorId");

ALTER TABLE "organization_reporting_lines"
  ADD CONSTRAINT "organization_reporting_lines_subjectUserId_fkey"
  FOREIGN KEY ("subjectUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "organization_reporting_lines"
  ADD CONSTRAINT "organization_reporting_lines_supervisorId_fkey"
  FOREIGN KEY ("supervisorId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
