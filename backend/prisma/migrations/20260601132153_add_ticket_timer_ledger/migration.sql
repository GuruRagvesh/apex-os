-- DropForeignKey
ALTER TABLE "attendance_events" DROP CONSTRAINT "attendance_events_userId_fkey";

-- DropForeignKey
ALTER TABLE "break_logs" DROP CONSTRAINT "break_logs_userId_fkey";

-- DropForeignKey
ALTER TABLE "break_logs" DROP CONSTRAINT "break_logs_workSessionId_fkey";

-- DropForeignKey
ALTER TABLE "manager_dept_access" DROP CONSTRAINT "manager_dept_access_departmentId_fkey";

-- DropForeignKey
ALTER TABLE "manager_dept_access" DROP CONSTRAINT "manager_dept_access_managerId_fkey";

-- DropForeignKey
ALTER TABLE "work_sessions" DROP CONSTRAINT "work_sessions_userId_fkey";

-- AlterTable
ALTER TABLE "employee_documents" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "reworkCount" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "blockedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "work_sessions" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "ticket_time_logs" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "countsAsWork" BOOLEAN NOT NULL DEFAULT true,
    "pauseReason" TEXT,
    "workSessionId" TEXT,
    "breakLogId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_time_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_cycle_logs" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "cycleNo" INTEGER NOT NULL,
    "assigneeId" TEXT,
    "reviewerId" TEXT,
    "reviewStartedAt" TIMESTAMP(3),
    "reviewEndedAt" TIMESTAMP(3),
    "decision" TEXT,
    "feedback" TEXT,
    "assigneeWorkSeconds" INTEGER,
    "reviewerWorkSeconds" INTEGER,
    "reworkStartedAt" TIMESTAMP(3),
    "reworkEndedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_cycle_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_time_logs_ticketId_idx" ON "ticket_time_logs"("ticketId");

-- CreateIndex
CREATE INDEX "ticket_time_logs_userId_idx" ON "ticket_time_logs"("userId");

-- CreateIndex
CREATE INDEX "ticket_time_logs_startedAt_idx" ON "ticket_time_logs"("startedAt");

-- CreateIndex
CREATE INDEX "ticket_time_logs_workSessionId_idx" ON "ticket_time_logs"("workSessionId");

-- CreateIndex
CREATE INDEX "ticket_time_logs_ticketId_endedAt_idx" ON "ticket_time_logs"("ticketId", "endedAt");

-- CreateIndex
CREATE INDEX "ticket_time_logs_userId_endedAt_idx" ON "ticket_time_logs"("userId", "endedAt");

-- CreateIndex
CREATE INDEX "review_cycle_logs_ticketId_idx" ON "review_cycle_logs"("ticketId");

-- CreateIndex
CREATE INDEX "review_cycle_logs_cycleNo_idx" ON "review_cycle_logs"("cycleNo");

-- CreateIndex
CREATE UNIQUE INDEX "review_cycle_logs_ticketId_cycleNo_key" ON "review_cycle_logs"("ticketId", "cycleNo");

-- CreateIndex
CREATE INDEX "leave_requests_userId_idx" ON "leave_requests"("userId");

-- CreateIndex
CREATE INDEX "leave_requests_status_idx" ON "leave_requests"("status");

-- CreateIndex
CREATE INDEX "notifications_userId_idx" ON "notifications"("userId");

-- CreateIndex
CREATE INDEX "notifications_isRead_idx" ON "notifications"("isRead");

-- CreateIndex
CREATE INDEX "tickets_departmentId_idx" ON "tickets"("departmentId");

-- CreateIndex
CREATE INDEX "tickets_assignedToId_idx" ON "tickets"("assignedToId");

-- CreateIndex
CREATE INDEX "tickets_status_idx" ON "tickets"("status");

-- CreateIndex
CREATE INDEX "tickets_createdById_idx" ON "tickets"("createdById");

-- CreateIndex
CREATE INDEX "tickets_projectId_idx" ON "tickets"("projectId");

-- CreateIndex
CREATE INDEX "tickets_createdAt_idx" ON "tickets"("createdAt");

-- AddForeignKey
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_logs" ADD CONSTRAINT "break_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_logs" ADD CONSTRAINT "break_logs_workSessionId_fkey" FOREIGN KEY ("workSessionId") REFERENCES "work_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manager_dept_access" ADD CONSTRAINT "manager_dept_access_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manager_dept_access" ADD CONSTRAINT "manager_dept_access_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_time_logs" ADD CONSTRAINT "ticket_time_logs_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_time_logs" ADD CONSTRAINT "ticket_time_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_time_logs" ADD CONSTRAINT "ticket_time_logs_workSessionId_fkey" FOREIGN KEY ("workSessionId") REFERENCES "work_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_time_logs" ADD CONSTRAINT "ticket_time_logs_breakLogId_fkey" FOREIGN KEY ("breakLogId") REFERENCES "break_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_cycle_logs" ADD CONSTRAINT "review_cycle_logs_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_cycle_logs" ADD CONSTRAINT "review_cycle_logs_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_cycle_logs" ADD CONSTRAINT "review_cycle_logs_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
