-- CreateTable work_sessions
CREATE TABLE "work_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "loginAt" TIMESTAMP(3),
    "startWorkAt" TIMESTAMP(3),
    "logoutAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'LOGGED_IN',
    "totalLoggedMinutes" INTEGER NOT NULL DEFAULT 0,
    "totalBreakMinutes" INTEGER NOT NULL DEFAULT 0,
    "totalIdleMinutes" INTEGER NOT NULL DEFAULT 0,
    "totalWorkMinutes" INTEGER NOT NULL DEFAULT 0,
    "leaveId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "work_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable break_logs
CREATE TABLE "break_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workSessionId" TEXT NOT NULL,
    "breakType" TEXT NOT NULL,
    "estimatedMinutes" INTEGER,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "durationMinutes" INTEGER,
    "autoDetected" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "break_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable attendance_events
CREATE TABLE "attendance_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workSessionId" TEXT,
    "eventType" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "metadata" JSONB,
    CONSTRAINT "attendance_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable manager_dept_access
CREATE TABLE "manager_dept_access" (
    "id" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "accessLevel" TEXT NOT NULL DEFAULT 'READ',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "manager_dept_access_pkey" PRIMARY KEY ("id")
);

-- AlterTable users
ALTER TABLE "users" ADD COLUMN "isHR" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "currentStatus" TEXT NOT NULL DEFAULT 'OFFLINE';
ALTER TABLE "users" ADD COLUMN "lastActiveAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "work_sessions_userId_date_key" ON "work_sessions"("userId", "date");
CREATE INDEX "work_sessions_userId_idx" ON "work_sessions"("userId");
CREATE INDEX "work_sessions_date_idx" ON "work_sessions"("date");
CREATE INDEX "work_sessions_status_idx" ON "work_sessions"("status");
CREATE INDEX "break_logs_userId_idx" ON "break_logs"("userId");
CREATE INDEX "break_logs_workSessionId_idx" ON "break_logs"("workSessionId");
CREATE INDEX "attendance_events_userId_idx" ON "attendance_events"("userId");
CREATE INDEX "attendance_events_timestamp_idx" ON "attendance_events"("timestamp");
CREATE INDEX "attendance_events_eventType_idx" ON "attendance_events"("eventType");
CREATE UNIQUE INDEX "manager_dept_access_managerId_departmentId_key" ON "manager_dept_access"("managerId", "departmentId");
CREATE INDEX "manager_dept_access_managerId_idx" ON "manager_dept_access"("managerId");

-- AddForeignKey
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_leaveId_fkey" FOREIGN KEY ("leaveId") REFERENCES "leave_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "break_logs" ADD CONSTRAINT "break_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "break_logs" ADD CONSTRAINT "break_logs_workSessionId_fkey" FOREIGN KEY ("workSessionId") REFERENCES "work_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_workSessionId_fkey" FOREIGN KEY ("workSessionId") REFERENCES "work_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "manager_dept_access" ADD CONSTRAINT "manager_dept_access_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manager_dept_access" ADD CONSTRAINT "manager_dept_access_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
