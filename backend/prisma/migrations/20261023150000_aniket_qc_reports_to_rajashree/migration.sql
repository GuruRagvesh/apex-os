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
  AND qc."name" = 'QC Team'
  -- Names identify people here, so act only when each name is unambiguous.
  -- A shared name would otherwise pick an arbitrary Rajashree, or move every
  -- Aniket's QC line.
  AND (SELECT count(*) FROM "users" AS u WHERE lower(u."name") = 'aniket phapale') = 1
  AND (SELECT count(*) FROM "users" AS u WHERE lower(u."name") = 'rajashree solanki') = 1;
