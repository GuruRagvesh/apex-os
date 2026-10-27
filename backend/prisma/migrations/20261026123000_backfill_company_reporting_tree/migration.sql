-- Rebuild the business reporting tree used by the organization atlas.
-- Access roles are intentionally independent: a SUPER_ADMIN or ADMIN role
-- does not make that account part of company leadership.

-- People are named below, not identified by id, so every step resolves a name
-- through this table. A name resolves only when it points to exactly one
-- active user, or, when no active user has it, exactly one user. A name two
-- people share is skipped (and reported below) instead of aborting the
-- migration or giving both people the same title and manager.
CREATE TEMP TABLE "_reporting_tree_people" AS
WITH named AS (
  SELECT lower("name") AS name_key, "id", "isActive" FROM "users"
)
SELECT name_key, min("id") AS id
FROM named
WHERE "isActive"
GROUP BY name_key
HAVING count(*) = 1
UNION ALL
SELECT name_key, min("id") AS id
FROM named
WHERE NOT EXISTS (
  SELECT 1 FROM named AS active WHERE active.name_key = named.name_key AND active."isActive"
)
GROUP BY name_key
HAVING count(*) = 1;

DO $$
DECLARE
  skipped TEXT;
BEGIN
  SELECT string_agg(DISTINCT u."name", ', ')
  INTO skipped
  FROM "users" AS u
  WHERE lower(u."name") IN (
    'pavan lalwani', 'payal', 'tejas kadam', 'anshika patel', 'krunal mehta',
    'komal', 'arpit bharuka', 'suyash', 'swayam', 'guru thanumoorthy', 'pratik',
    'shama', 'snehal intern', 'sonali', 'subrat', 'gunjan ranglani',
    'harshal tilekar', 'sumedh sadaphal', 'ajay singh', 'snehal p', 'vaishnavi',
    'gaurav', 'irfan', 'shubendu', 'honey dembani', 'mahendra', 'pooja kamble',
    'revati patil', 'sahil waykar', 'sanika dongare', 'trishank pal', 'vishal',
    'narendra suthar', 'pawan tiwari', 'aniket phapale', 'salman', 'sushant gire',
    'charu kadam', 'harshada patil', 'pankaj', 'rajashree solanki'
  )
    AND NOT EXISTS (
      SELECT 1 FROM "_reporting_tree_people" AS p WHERE p.name_key = lower(u."name")
    );
  IF skipped IS NOT NULL THEN
    RAISE WARNING 'Reporting tree backfill skipped names shared by more than one user: %', skipped;
  END IF;
END $$;

UPDATE "users" AS person
SET "organizationParticipation" = CASE
  WHEN resolved.name_key = 'subrat' THEN 'ACCESS_ONLY'
  ELSE 'WORKFORCE'
END
FROM "_reporting_tree_people" AS resolved
WHERE person."id" = resolved.id
  AND resolved.name_key IN (
    'subrat', 'pavan lalwani', 'payal', 'tejas kadam', 'anshika patel',
    'krunal mehta', 'komal', 'guru thanumoorthy'
  );

WITH titles(name, designation) AS (
  VALUES
    ('Pavan Lalwani', 'Chief Executive Officer'),
    ('Payal', 'Chief Financial Officer'),
    ('Tejas Kadam', 'Chief of Staff'),
    ('Anshika Patel', 'Content Manager'),
    ('Krunal Mehta', 'Corporate Training Manager'),
    ('Komal', 'Accountant'),
    ('Arpit Bharuka', 'AI Media Team Lead'),
    ('Suyash', 'AI Media Intern'),
    ('Swayam', 'AI Media Intern'),
    ('Guru Thanumoorthy', 'AI & R&D Team Lead'),
    ('Pratik', 'AI & R&D Intern'),
    ('Shama', 'AI & R&D Intern'),
    ('Snehal Intern', 'AI & R&D Intern'),
    ('Sonali', 'AI & R&D Intern'),
    ('Subrat', 'Platform Administrator'),
    ('Gunjan Ranglani', 'Sales Executive'),
    ('Harshal Tilekar', 'Sales Executive'),
    ('Sumedh Sadaphal', 'Sales & Delivery Team Lead'),
    ('Ajay Singh', 'Corporate Trainer'),
    ('Snehal P', 'Training Coordinator'),
    ('Vaishnavi', 'Corporate Training Lead'),
    ('Gaurav', 'Content Executive'),
    ('Irfan', 'Content Executive'),
    ('Shubendu', 'Content Team Lead'),
    ('Honey Dembani', 'ID Team Lead'),
    ('Mahendra', 'Content Executive'),
    ('Pooja Kamble', 'Content Executive'),
    ('Revati Patil', 'Content Executive'),
    ('Sahil Waykar', 'Content Executive'),
    ('Sanika Dongare', 'Content Executive'),
    ('Trishank Pal', 'Content Executive'),
    ('Vishal', 'ID Team Lead'),
    ('Narendra Suthar', 'Social Media Marketing Lead'),
    ('Pawan Tiwari', 'Social Media Executive'),
    ('Aniket Phapale', 'QC Team Lead'),
    ('Salman', 'QC Executive'),
    ('Sushant Gire', 'QC Executive'),
    ('Charu Kadam', 'Retail Executive'),
    ('Harshada Patil', 'Retail Executive'),
    ('Pankaj', 'Retail Executive'),
    ('Rajashree Solanki', 'Retail Business Team Lead')
)
UPDATE "users" AS person
SET "designation" = titles.designation,
    "updatedAt" = CURRENT_TIMESTAMP
FROM titles
JOIN "_reporting_tree_people" AS resolved ON resolved.name_key = lower(titles.name)
WHERE person."id" = resolved.id;

-- Aniket belongs to Retail Business while owning the QC department. This is
-- represented by one primary membership plus one department-lead membership.
UPDATE "users" AS aniket
SET "departmentId" = retail."id",
    "updatedAt" = CURRENT_TIMESTAMP
FROM "departments" AS retail,
     "_reporting_tree_people" AS resolved
WHERE aniket."id" = resolved.id
  AND resolved.name_key = 'aniket phapale'
  AND retail."name" = 'Retail Business';

INSERT INTO "user_department_memberships" (
  "id", "userId", "departmentId", "isPrimary", "designation",
  "isDepartmentLead", "allocationPercent", "createdAt"
)
SELECT
  'membership_' || md5(aniket."id" || ':' || retail."id"),
  aniket."id", retail."id", true, 'QC Team Lead', false, NULL,
  CURRENT_TIMESTAMP
FROM "users" AS aniket
JOIN "_reporting_tree_people" AS resolved ON resolved.id = aniket."id"
JOIN "departments" AS retail ON retail."name" = 'Retail Business'
WHERE resolved.name_key = 'aniket phapale'
ON CONFLICT ("userId", "departmentId") DO UPDATE
SET "isPrimary" = true,
    "designation" = 'QC Team Lead';

INSERT INTO "user_department_memberships" (
  "id", "userId", "departmentId", "isPrimary", "designation",
  "isDepartmentLead", "allocationPercent", "createdAt"
)
SELECT
  'membership_' || md5(aniket."id" || ':' || qc."id"),
  aniket."id", qc."id", false, 'QC Team Lead', true, NULL,
  CURRENT_TIMESTAMP
FROM "users" AS aniket
JOIN "_reporting_tree_people" AS resolved ON resolved.id = aniket."id"
JOIN "departments" AS qc ON qc."name" = 'QC Team'
WHERE resolved.name_key = 'aniket phapale'
ON CONFLICT ("userId", "departmentId") DO UPDATE
SET "isPrimary" = false,
    "designation" = 'QC Team Lead',
    "isDepartmentLead" = true;

-- A person has one primary business supervisor. Department memberships carry
-- cross-department responsibility without producing duplicate chart nodes.
DELETE FROM "organization_reporting_lines" AS line
USING "_reporting_tree_people" AS resolved
WHERE line."subjectUserId" = resolved.id
  AND resolved.name_key = 'aniket phapale'
  AND line."scopeKey" <> 'PRIMARY';

WITH relationships(subject_name, supervisor_name) AS (
  VALUES
    ('Payal', 'Pavan Lalwani'),
    ('Tejas Kadam', 'Pavan Lalwani'),
    ('Anshika Patel', 'Pavan Lalwani'),
    ('Krunal Mehta', 'Pavan Lalwani'),
    ('Komal', 'Payal'),
    ('Guru Thanumoorthy', 'Tejas Kadam'),
    ('Pratik', 'Guru Thanumoorthy'),
    ('Shama', 'Guru Thanumoorthy'),
    ('Snehal Intern', 'Guru Thanumoorthy'),
    ('Sonali', 'Guru Thanumoorthy'),
    ('Arpit Bharuka', 'Tejas Kadam'),
    ('Suyash', 'Arpit Bharuka'),
    ('Swayam', 'Arpit Bharuka'),
    ('Sumedh Sadaphal', 'Tejas Kadam'),
    ('Gunjan Ranglani', 'Sumedh Sadaphal'),
    ('Harshal Tilekar', 'Sumedh Sadaphal'),
    ('Narendra Suthar', 'Tejas Kadam'),
    ('Pawan Tiwari', 'Narendra Suthar'),
    ('Rajashree Solanki', 'Tejas Kadam'),
    ('Charu Kadam', 'Rajashree Solanki'),
    ('Harshada Patil', 'Rajashree Solanki'),
    ('Pankaj', 'Rajashree Solanki'),
    ('Aniket Phapale', 'Rajashree Solanki'),
    ('Salman', 'Aniket Phapale'),
    ('Sushant Gire', 'Aniket Phapale'),
    ('Shubendu', 'Anshika Patel'),
    ('Gaurav', 'Shubendu'),
    ('Irfan', 'Shubendu'),
    ('Honey Dembani', 'Shubendu'),
    ('Vishal', 'Shubendu'),
    ('Mahendra', 'Shubendu'),
    ('Revati Patil', 'Shubendu'),
    ('Sahil Waykar', 'Honey Dembani'),
    ('Sanika Dongare', 'Honey Dembani'),
    ('Pooja Kamble', 'Vishal'),
    ('Trishank Pal', 'Vishal'),
    ('Vaishnavi', 'Krunal Mehta'),
    ('Ajay Singh', 'Vaishnavi'),
    ('Snehal P', 'Vaishnavi')
)
INSERT INTO "organization_reporting_lines" (
  "id", "subjectUserId", "supervisorId", "departmentId", "scopeKey",
  "createdAt", "updatedAt"
)
SELECT
  'orgline_' || md5(subject."id" || ':primary:' || supervisor."id"),
  subject."id",
  supervisor."id",
  subject."departmentId",
  'PRIMARY',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM relationships
JOIN "_reporting_tree_people" AS subject_ref ON subject_ref.name_key = lower(relationships.subject_name)
JOIN "_reporting_tree_people" AS supervisor_ref ON supervisor_ref.name_key = lower(relationships.supervisor_name)
JOIN "users" AS subject ON subject."id" = subject_ref.id
JOIN "users" AS supervisor ON supervisor."id" = supervisor_ref.id
ON CONFLICT ("subjectUserId", "scopeKey") DO UPDATE
SET "supervisorId" = EXCLUDED."supervisorId",
    "departmentId" = EXCLUDED."departmentId",
    "updatedAt" = CURRENT_TIMESTAMP;

DROP TABLE "_reporting_tree_people";
