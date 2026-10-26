-- Rebuild the business reporting tree used by the organization atlas.
-- Access roles are intentionally independent: a SUPER_ADMIN or ADMIN role
-- does not make that account part of company leadership.

UPDATE "users"
SET "organizationParticipation" = CASE
  WHEN lower("name") = 'subrat' THEN 'ACCESS_ONLY'
  ELSE 'WORKFORCE'
END
WHERE lower("name") IN (
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
WHERE lower(person."name") = lower(titles.name);

-- Aniket belongs to Retail Business while owning the QC department. This is
-- represented by one primary membership plus one department-lead membership.
UPDATE "users" AS aniket
SET "departmentId" = retail."id",
    "updatedAt" = CURRENT_TIMESTAMP
FROM "departments" AS retail
WHERE lower(aniket."name") = 'aniket phapale'
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
JOIN "departments" AS retail ON retail."name" = 'Retail Business'
WHERE lower(aniket."name") = 'aniket phapale'
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
JOIN "departments" AS qc ON qc."name" = 'QC Team'
WHERE lower(aniket."name") = 'aniket phapale'
ON CONFLICT ("userId", "departmentId") DO UPDATE
SET "isPrimary" = false,
    "designation" = 'QC Team Lead',
    "isDepartmentLead" = true;

-- A person has one primary business supervisor. Department memberships carry
-- cross-department responsibility without producing duplicate chart nodes.
DELETE FROM "organization_reporting_lines" AS line
USING "users" AS person
WHERE line."subjectUserId" = person."id"
  AND lower(person."name") = 'aniket phapale'
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
JOIN "users" AS subject ON lower(subject."name") = lower(relationships.subject_name)
JOIN "users" AS supervisor ON lower(supervisor."name") = lower(relationships.supervisor_name)
ON CONFLICT ("subjectUserId", "scopeKey") DO UPDATE
SET "supervisorId" = EXCLUDED."supervisorId",
    "departmentId" = EXCLUDED."departmentId",
    "updatedAt" = CURRENT_TIMESTAMP;
