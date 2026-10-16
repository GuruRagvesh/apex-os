CREATE TABLE "quick_ticket_templates" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "codeSequence" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "departmentId" TEXT,
    "taskTypeId" TEXT,
    "taskSubtypeId" TEXT,
    "assigneeId" TEXT,
    "priority" "Priority",
    "estimatedMinutes" INTEGER,
    "projectId" TEXT,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quick_ticket_templates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "quick_ticket_templates_estimated_minutes_check" CHECK ("estimatedMinutes" > 0),
    CONSTRAINT "quick_ticket_templates_display_order_check" CHECK ("displayOrder" >= 0)
);

CREATE TABLE "quick_ticket_template_preferences" (
    "ownerUserId" TEXT NOT NULL,
    "visibleCount" INTEGER NOT NULL DEFAULT 5,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quick_ticket_template_preferences_pkey" PRIMARY KEY ("ownerUserId"),
    CONSTRAINT "quick_ticket_template_preferences_visible_count_check" CHECK ("visibleCount" BETWEEN 1 AND 20)
);

CREATE UNIQUE INDEX "quick_ticket_templates_ownerUserId_code_key"
    ON "quick_ticket_templates"("ownerUserId", "code");
CREATE UNIQUE INDEX "quick_ticket_templates_ownerUserId_codeSequence_key"
    ON "quick_ticket_templates"("ownerUserId", "codeSequence");
CREATE UNIQUE INDEX "quick_ticket_templates_ownerUserId_name_key"
    ON "quick_ticket_templates"("ownerUserId", "name");
CREATE UNIQUE INDEX "quick_ticket_templates_ownerUserId_name_ci_key"
    ON "quick_ticket_templates"("ownerUserId", lower("name"));
CREATE INDEX "quick_ticket_templates_ownerUserId_isVisible_isPinned_displayOrder_idx"
    ON "quick_ticket_templates"("ownerUserId", "isVisible", "isPinned", "displayOrder");

-- Ownership is checked against the authenticated id in the tickets service.
-- No FK is added to users: this ticket-only migration must not alter current
-- user creation/deletion behaviour. The lifecycle feature can deliberately
-- classify this table when that separate work is integrated.
