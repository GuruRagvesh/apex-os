-- CreateTable task_types
CREATE TABLE "task_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "departmentId" TEXT,
    "isGlobal" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "task_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable task_subtypes
CREATE TABLE "task_subtypes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taskTypeId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "task_subtypes_pkey" PRIMARY KEY ("id")
);

-- Add columns to tickets
ALTER TABLE "tickets" ADD COLUMN "taskTypeId" TEXT;
ALTER TABLE "tickets" ADD COLUMN "taskSubtypeId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "task_types_name_departmentId_key" ON "task_types"("name", "departmentId");
CREATE INDEX "task_types_departmentId_idx" ON "task_types"("departmentId");
CREATE UNIQUE INDEX "task_subtypes_name_taskTypeId_key" ON "task_subtypes"("name", "taskTypeId");
CREATE INDEX "task_subtypes_taskTypeId_idx" ON "task_subtypes"("taskTypeId");

-- AddForeignKey
ALTER TABLE "task_types" ADD CONSTRAINT "task_types_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_subtypes" ADD CONSTRAINT "task_subtypes_taskTypeId_fkey" FOREIGN KEY ("taskTypeId") REFERENCES "task_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_taskTypeId_fkey" FOREIGN KEY ("taskTypeId") REFERENCES "task_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_taskSubtypeId_fkey" FOREIGN KEY ("taskSubtypeId") REFERENCES "task_subtypes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
