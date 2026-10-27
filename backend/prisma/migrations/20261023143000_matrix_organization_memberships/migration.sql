ALTER TABLE "user_department_memberships"
  ADD COLUMN "designation" TEXT,
  ADD COLUMN "isDepartmentLead" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "allocationPercent" INTEGER;

ALTER TABLE "users"
  ADD COLUMN "organizationParticipation" TEXT NOT NULL DEFAULT 'WORKFORCE';

UPDATE "users"
SET "organizationParticipation" = 'ACCESS_ONLY'
WHERE lower("name") IN ('local apex administrator', 'subrat superadmin');

ALTER TABLE "organization_reporting_lines"
  ADD COLUMN "departmentId" TEXT,
  ADD COLUMN "scopeKey" TEXT NOT NULL DEFAULT 'PRIMARY';

DROP INDEX "organization_reporting_lines_subjectUserId_key";
CREATE UNIQUE INDEX "organization_reporting_lines_subjectUserId_scopeKey_key"
  ON "organization_reporting_lines"("subjectUserId", "scopeKey");
CREATE INDEX "organization_reporting_lines_departmentId_idx"
  ON "organization_reporting_lines"("departmentId");

ALTER TABLE "organization_reporting_lines"
  ADD CONSTRAINT "organization_reporting_lines_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Preserve the existing single-department field as the primary membership.
INSERT INTO "user_department_memberships" (
  "id", "userId", "departmentId", "isPrimary", "designation", "isDepartmentLead", "createdAt"
)
SELECT
  'membership_' || md5(u."id" || ':' || u."departmentId"),
  u."id",
  u."departmentId",
  true,
  u."designation",
  false,
  CURRENT_TIMESTAMP
FROM "users" u
WHERE u."departmentId" IS NOT NULL
ON CONFLICT ("userId", "departmentId") DO UPDATE
SET "isPrimary" = true,
    "designation" = COALESCE("user_department_memberships"."designation", EXCLUDED."designation");

UPDATE "organization_reporting_lines" line
SET "departmentId" = subject."departmentId"
FROM "users" subject
WHERE line."subjectUserId" = subject."id"
  AND line."scopeKey" = 'PRIMARY'
  AND line."departmentId" IS NULL;

-- Aniket keeps Retail Business as his home department and also leads QC.
INSERT INTO "user_department_memberships" (
  "id", "userId", "departmentId", "isPrimary", "designation", "isDepartmentLead", "allocationPercent", "createdAt"
)
SELECT
  'membership_' || md5(aniket."id" || ':' || qc."id"),
  aniket."id",
  qc."id",
  false,
  'QC Team Lead',
  true,
  NULL,
  CURRENT_TIMESTAMP
FROM "users" aniket
JOIN "departments" qc ON qc."name" = 'QC Team'
WHERE lower(aniket."name") = 'aniket phapale'
ON CONFLICT ("userId", "departmentId") DO UPDATE
SET "isPrimary" = false,
    "designation" = 'QC Team Lead',
    "isDepartmentLead" = true;

-- The QC assignment is operationally under the Chief of Staff.
INSERT INTO "organization_reporting_lines" (
  "id", "subjectUserId", "supervisorId", "departmentId", "scopeKey", "createdAt", "updatedAt"
)
SELECT
  'orgline_' || md5(aniket."id" || ':qc:' || tejas."id"),
  aniket."id",
  tejas."id",
  qc."id",
  'DEPARTMENT:' || qc."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "users" aniket
JOIN "users" tejas ON lower(tejas."name") = 'tejas kadam'
JOIN "departments" qc ON qc."name" = 'QC Team'
WHERE lower(aniket."name") = 'aniket phapale'
ON CONFLICT ("subjectUserId", "scopeKey") DO UPDATE
SET "supervisorId" = EXCLUDED."supervisorId",
    "departmentId" = EXCLUDED."departmentId",
    "updatedAt" = CURRENT_TIMESTAMP;

-- Salman remains an employee but reports to Aniket inside QC.
INSERT INTO "organization_reporting_lines" (
  "id", "subjectUserId", "supervisorId", "departmentId", "scopeKey", "createdAt", "updatedAt"
)
SELECT
  'orgline_' || md5(salman."id" || ':primary:' || aniket."id"),
  salman."id",
  aniket."id",
  qc."id",
  'PRIMARY',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "users" salman
JOIN "users" aniket ON lower(aniket."name") = 'aniket phapale'
JOIN "departments" qc ON qc."name" = 'QC Team'
WHERE lower(trim(salman."name")) = 'salman'
ON CONFLICT ("subjectUserId", "scopeKey") DO UPDATE
SET "supervisorId" = EXCLUDED."supervisorId",
    "departmentId" = EXCLUDED."departmentId",
    "updatedAt" = CURRENT_TIMESTAMP;

-- Founder's Office is a business unit, not an RBAC level. Vivek remains an
-- employee and reports directly to the CEO through this assignment.
INSERT INTO "departments" ("id", "name", "description", "color", "createdAt")
VALUES (
  'dept_founders_office',
  'Founder''s Office',
  'Cross-functional initiatives reporting directly to the CEO.',
  '#0f766e',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "user_department_memberships" (
  "id", "userId", "departmentId", "isPrimary", "designation", "isDepartmentLead", "allocationPercent", "createdAt"
)
SELECT
  'membership_' || md5(vivek."id" || ':' || founders."id"),
  vivek."id",
  founders."id",
  false,
  'Founder''s Office Employee',
  false,
  NULL,
  CURRENT_TIMESTAMP
FROM "users" vivek
JOIN "departments" founders ON founders."name" = 'Founder''s Office'
WHERE lower(vivek."name") = 'vivek mehta'
ON CONFLICT ("userId", "departmentId") DO UPDATE
SET "isPrimary" = false,
    "designation" = 'Founder''s Office Employee';

INSERT INTO "organization_reporting_lines" (
  "id", "subjectUserId", "supervisorId", "departmentId", "scopeKey", "createdAt", "updatedAt"
)
SELECT
  'orgline_' || md5(vivek."id" || ':founders:' || pavan."id"),
  vivek."id",
  pavan."id",
  founders."id",
  'DEPARTMENT:' || founders."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "users" vivek
JOIN "users" pavan ON lower(pavan."name") = 'pavan lalwani'
JOIN "departments" founders ON founders."name" = 'Founder''s Office'
WHERE lower(vivek."name") = 'vivek mehta'
ON CONFLICT ("subjectUserId", "scopeKey") DO UPDATE
SET "supervisorId" = EXCLUDED."supervisorId",
    "departmentId" = EXCLUDED."departmentId",
    "updatedAt" = CURRENT_TIMESTAMP;
