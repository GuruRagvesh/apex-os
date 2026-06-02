-- FP-14B: Project Stages Foundation
-- Additive migration only: new table, new nullable column, new enum value.
-- No DROP, no data mutation, no breaking changes.

-- 1. Add ARCHIVED to ProjectStatus enum
ALTER TYPE "ProjectStatus" ADD VALUE IF NOT EXISTS 'ARCHIVED';

-- 2. Create project_stages table
CREATE TABLE "project_stages" (
    "id"          TEXT NOT NULL,
    "projectId"   TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "order"       INTEGER NOT NULL DEFAULT 0,
    "status"      TEXT NOT NULL DEFAULT 'PLANNED',
    "color"       TEXT,
    "startDate"   TIMESTAMP(3),
    "endDate"     TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_stages_pkey" PRIMARY KEY ("id")
);

-- FK: project_stages → projects (cascade delete)
ALTER TABLE "project_stages"
    ADD CONSTRAINT "project_stages_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes for project_stages
CREATE INDEX IF NOT EXISTS "project_stages_projectId_idx"
    ON "project_stages"("projectId");

CREATE INDEX IF NOT EXISTS "project_stages_projectId_order_idx"
    ON "project_stages"("projectId", "order");

-- 3. Add projectStageId to tickets (nullable)
ALTER TABLE "tickets"
    ADD COLUMN IF NOT EXISTS "projectStageId" TEXT;

-- FK: tickets.projectStageId → project_stages (set null on stage delete)
ALTER TABLE "tickets"
    ADD CONSTRAINT "tickets_projectStageId_fkey"
    FOREIGN KEY ("projectStageId") REFERENCES "project_stages"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Index for projectStageId lookups
CREATE INDEX IF NOT EXISTS "tickets_projectStageId_idx"
    ON "tickets"("projectStageId");
