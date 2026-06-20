-- Phase D2.1 schema foundation: organization, teams, multi-department,
-- multi-role, and work-routing additive groundwork.
-- Every change here is a brand-new table, a brand-new nullable column,
-- or a brand-new index. No existing column, constraint, or row is
-- modified. Nothing in the application reads or writes these yet.

-- CreateTable
CREATE TABLE IF NOT EXISTS "user_department_memberships" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_department_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- No @@unique on (userId, roleId, departmentId, teamId): Postgres treats
-- NULL as distinct in unique indexes, so a naive composite unique would
-- silently allow duplicate "no-context" rows. Left as plain indexes only;
-- real dedup enforcement is deferred to whichever phase adds a write path.
CREATE TABLE IF NOT EXISTS "user_role_assignments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "departmentId" TEXT,
    "teamId" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "teamLeadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "team_members" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ticket_watchers" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_watchers_pkey" PRIMARY KEY ("id")
);

-- AlterTable
-- Additive nullable routing fields on existing "tickets".
-- departmentId / assignedToId are untouched.
ALTER TABLE "tickets"
  ADD COLUMN IF NOT EXISTS "requestingDepartmentId" TEXT,
  ADD COLUMN IF NOT EXISTS "requestingTeamId" TEXT,
  ADD COLUMN IF NOT EXISTS "targetDepartmentId" TEXT,
  ADD COLUMN IF NOT EXISTS "targetTeamId" TEXT,
  ADD COLUMN IF NOT EXISTS "isCrossDepartment" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
-- Additive nullable audit-context fields on existing "operational_events".
-- fromState / toState are untouched.
ALTER TABLE "operational_events"
  ADD COLUMN IF NOT EXISTS "actorRoleId" TEXT,
  ADD COLUMN IF NOT EXISTS "actorContext" TEXT,
  ADD COLUMN IF NOT EXISTS "beforeValue" JSONB,
  ADD COLUMN IF NOT EXISTS "afterValue" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "user_department_memberships_userId_departmentId_key" ON "user_department_memberships"("userId", "departmentId");
CREATE INDEX IF NOT EXISTS "user_department_memberships_userId_idx" ON "user_department_memberships"("userId");
CREATE INDEX IF NOT EXISTS "user_department_memberships_departmentId_idx" ON "user_department_memberships"("departmentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "user_role_assignments_userId_idx" ON "user_role_assignments"("userId");
CREATE INDEX IF NOT EXISTS "user_role_assignments_roleId_idx" ON "user_role_assignments"("roleId");
CREATE INDEX IF NOT EXISTS "user_role_assignments_departmentId_idx" ON "user_role_assignments"("departmentId");
CREATE INDEX IF NOT EXISTS "user_role_assignments_teamId_idx" ON "user_role_assignments"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "teams_departmentId_name_key" ON "teams"("departmentId", "name");
CREATE INDEX IF NOT EXISTS "teams_departmentId_idx" ON "teams"("departmentId");
CREATE INDEX IF NOT EXISTS "teams_teamLeadId_idx" ON "teams"("teamLeadId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "team_members_teamId_userId_key" ON "team_members"("teamId", "userId");
CREATE INDEX IF NOT EXISTS "team_members_userId_idx" ON "team_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ticket_watchers_ticketId_userId_key" ON "ticket_watchers"("ticketId", "userId");
CREATE INDEX IF NOT EXISTS "ticket_watchers_userId_idx" ON "ticket_watchers"("userId");

-- CreateIndex
-- Routing fields on existing "tickets" — same column list as the
-- ADD COLUMN block above.
CREATE INDEX IF NOT EXISTS "tickets_requestingDepartmentId_idx" ON "tickets"("requestingDepartmentId");
CREATE INDEX IF NOT EXISTS "tickets_targetDepartmentId_idx" ON "tickets"("targetDepartmentId");
CREATE INDEX IF NOT EXISTS "tickets_requestingTeamId_idx" ON "tickets"("requestingTeamId");
CREATE INDEX IF NOT EXISTS "tickets_targetTeamId_idx" ON "tickets"("targetTeamId");
CREATE INDEX IF NOT EXISTS "tickets_isCrossDepartment_idx" ON "tickets"("isCrossDepartment");

-- CreateIndex
-- Audit-context field on existing "operational_events".
CREATE INDEX IF NOT EXISTS "operational_events_actorRoleId_idx" ON "operational_events"("actorRoleId");

-- AddForeignKey
ALTER TABLE "user_department_memberships" ADD CONSTRAINT "user_department_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_department_memberships" ADD CONSTRAINT "user_department_memberships_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "teams" ADD CONSTRAINT "teams_teamLeadId_fkey" FOREIGN KEY ("teamLeadId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_watchers" ADD CONSTRAINT "ticket_watchers_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_watchers" ADD CONSTRAINT "ticket_watchers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_requestingDepartmentId_fkey" FOREIGN KEY ("requestingDepartmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_targetDepartmentId_fkey" FOREIGN KEY ("targetDepartmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_requestingTeamId_fkey" FOREIGN KEY ("requestingTeamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_targetTeamId_fkey" FOREIGN KEY ("targetTeamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
