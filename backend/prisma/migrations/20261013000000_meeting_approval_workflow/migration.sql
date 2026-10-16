-- Captured meetings with synchronized attendance logs.

CREATE TABLE "meetings" (
  "id" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "meetingType" TEXT NOT NULL,
  "timingMode" TEXT NOT NULL,
  "departmentId" TEXT,
  "organizerId" TEXT NOT NULL,
  "organizerNameSnapshot" TEXT NOT NULL,
  "counterpartyId" TEXT NOT NULL,
  "counterpartyNameSnapshot" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "scheduledStartAt" TIMESTAMP(3),
  "plannedMinutes" INTEGER,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "meetings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "meetings_type_check" CHECK ("meetingType" IN ('SELF', 'INTERNAL', 'EXTERNAL', 'REVIEW', 'ONE_ON_ONE')),
  CONSTRAINT "meetings_timing_check" CHECK ("timingMode" IN ('IMMEDIATE', 'SCHEDULED')),
  CONSTRAINT "meetings_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'ACTIVE', 'COMPLETED', 'REJECTED', 'CANCELLED')),
  CONSTRAINT "meetings_planned_minutes_check" CHECK ("plannedMinutes" IS NULL OR "plannedMinutes" BETWEEN 1 AND 1440),
  CONSTRAINT "meetings_schedule_check" CHECK (
    ("timingMode" = 'IMMEDIATE' AND "scheduledStartAt" IS NULL)
    OR ("timingMode" = 'SCHEDULED' AND "scheduledStartAt" IS NOT NULL)
  )
);

CREATE TABLE "meeting_participants" (
  "id" TEXT NOT NULL,
  "meetingId" TEXT NOT NULL,
  "userId" TEXT,
  "displayNameSnapshot" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "meeting_participants_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "break_logs" ADD COLUMN "meetingId" TEXT;

CREATE INDEX "meetings_organizerId_createdAt_idx" ON "meetings"("organizerId", "createdAt");
CREATE INDEX "meetings_counterpartyId_status_idx" ON "meetings"("counterpartyId", "status");
CREATE INDEX "meetings_status_scheduledStartAt_idx" ON "meetings"("status", "scheduledStartAt");
CREATE INDEX "meetings_departmentId_idx" ON "meetings"("departmentId");
CREATE UNIQUE INDEX "meeting_participants_meetingId_userId_key" ON "meeting_participants"("meetingId", "userId");
CREATE INDEX "meeting_participants_userId_meetingId_idx" ON "meeting_participants"("userId", "meetingId");
CREATE INDEX "break_logs_meetingId_idx" ON "break_logs"("meetingId");

ALTER TABLE "meetings" ADD CONSTRAINT "meetings_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_organizerId_fkey"
  FOREIGN KEY ("organizerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_counterpartyId_fkey"
  FOREIGN KEY ("counterpartyId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_meetingId_fkey"
  FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "break_logs" ADD CONSTRAINT "break_logs_meetingId_fkey"
  FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
