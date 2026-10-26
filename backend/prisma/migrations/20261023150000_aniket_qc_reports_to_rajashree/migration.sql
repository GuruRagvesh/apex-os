-- QC remains Aniket's secondary department responsibility, while his sole
-- business reporting manager is Rajashree in the Retail Business chain.
UPDATE "organization_reporting_lines" AS line
SET "supervisorId" = rajashree."id",
    "updatedAt" = CURRENT_TIMESTAMP
FROM "users" AS aniket,
     "users" AS rajashree,
     "departments" AS qc
WHERE line."subjectUserId" = aniket."id"
  AND line."departmentId" = qc."id"
  AND line."scopeKey" = 'DEPARTMENT:' || qc."id"
  AND lower(aniket."name") = 'aniket phapale'
  AND lower(rajashree."name") = 'rajashree solanki'
  AND qc."name" = 'QC Team';
