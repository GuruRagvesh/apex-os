-- CreateEnum
CREATE TYPE "AttendanceCategory" AS ENUM ('MANAGEMENT_EXEMPT', 'TEAM_LEADER', 'REGULAR_EMPLOYEE');

-- CreateEnum
CREATE TYPE "DailyAttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'LATE_EXEMPTED', 'LEAVE', 'HALF_DAY', 'WEEKLY_OFF', 'HOLIDAY', 'LWP', 'ABSENT', 'MISSING_PUNCH', 'PENDING_REGULARIZATION', 'GEO_MISMATCH', 'FACE_MISSING');

-- CreateEnum
CREATE TYPE "RegularizationRequestType" AS ENUM ('MISSING_PUNCH', 'LOCATION_EXCEPTION', 'FACE_EXCEPTION', 'LATE_CORRECTION', 'HALF_DAY_CORRECTION');

-- CreateEnum
CREATE TYPE "RegularizationStatus" AS ENUM ('PENDING', 'MANAGER_APPROVED', 'HR_APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "attendance_events" ADD COLUMN     "accuracy" DOUBLE PRECISION,
ADD COLUMN     "clientTimestamp" TIMESTAMP(3),
ADD COLUMN     "deviceMetadata" JSONB,
ADD COLUMN     "faceImageUrl" TEXT,
ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "policyVersion" TEXT,
ADD COLUMN     "timezone" TEXT,
ADD COLUMN     "verificationStatus" TEXT;

-- CreateTable
CREATE TABLE "attendance_policies" (
    "id" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "minimumWorkingMinutes" INTEGER NOT NULL DEFAULT 540,
    "lateExemptionEnabled" BOOLEAN NOT NULL DEFAULT true,
    "faceCaptureRequired" BOOLEAN NOT NULL DEFAULT false,
    "locationCaptureRequired" BOOLEAN NOT NULL DEFAULT false,
    "geoFenceEnabled" BOOLEAN NOT NULL DEFAULT false,
    "regularizationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "attendance_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_policies" (
    "id" TEXT NOT NULL,
    "attendancePolicyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "AttendanceCategory" NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "graceMinutes" INTEGER NOT NULL DEFAULT 10,
    "minimumWorkingMinutes" INTEGER NOT NULL DEFAULT 540,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shift_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_attendance_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "AttendanceCategory" NOT NULL,
    "attendanceRequired" BOOLEAN NOT NULL DEFAULT true,
    "assignedShiftId" TEXT,
    "assignedLeavePolicyId" TEXT,
    "reportingManagerId" TEXT,
    "hrReviewerId" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "employee_attendance_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_off_policies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "everySunday" BOOLEAN NOT NULL DEFAULT true,
    "secondSaturday" BOOLEAN NOT NULL DEFAULT true,
    "fourthSaturday" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_off_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holiday_calendars" (
    "id" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "holiday_calendars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_policies" (
    "id" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "totalPaidLeaves" INTEGER NOT NULL DEFAULT 14,
    "combinedPoolTypes" JSONB NOT NULL DEFAULT '[]',
    "lwpAfterBalanceExhausted" BOOLEAN NOT NULL DEFAULT true,
    "approvedLeavePriorityOverAbsent" BOOLEAN NOT NULL DEFAULT true,
    "weeklyOffExcluded" BOOLEAN NOT NULL DEFAULT true,
    "holidaysExcluded" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_attendance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "DailyAttendanceStatus" NOT NULL,
    "punchInAt" TIMESTAMP(3),
    "punchOutAt" TIMESTAMP(3),
    "workedMinutes" INTEGER NOT NULL DEFAULT 0,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "leaveDeducted" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lwpDeducted" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "calculationReason" TEXT,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "lockedAt" TIMESTAMP(3),
    "policyVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_regularizations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "requestType" "RegularizationRequestType" NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedPunchIn" TIMESTAMP(3),
    "requestedPunchOut" TIMESTAMP(3),
    "status" "RegularizationStatus" NOT NULL DEFAULT 'PENDING',
    "managerApproverId" TEXT,
    "managerDecisionAt" TIMESTAMP(3),
    "hrApproverId" TEXT,
    "hrDecisionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_regularizations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_policies_financialYear_idx" ON "attendance_policies"("financialYear");

-- CreateIndex
CREATE INDEX "attendance_policies_isActive_idx" ON "attendance_policies"("isActive");

-- CreateIndex
CREATE INDEX "shift_policies_attendancePolicyId_idx" ON "shift_policies"("attendancePolicyId");

-- CreateIndex
CREATE INDEX "shift_policies_category_idx" ON "shift_policies"("category");

-- CreateIndex
CREATE UNIQUE INDEX "employee_attendance_profiles_userId_key" ON "employee_attendance_profiles"("userId");

-- CreateIndex
CREATE INDEX "employee_attendance_profiles_category_idx" ON "employee_attendance_profiles"("category");

-- CreateIndex
CREATE INDEX "employee_attendance_profiles_assignedShiftId_idx" ON "employee_attendance_profiles"("assignedShiftId");

-- CreateIndex
CREATE INDEX "employee_attendance_profiles_assignedLeavePolicyId_idx" ON "employee_attendance_profiles"("assignedLeavePolicyId");

-- CreateIndex
CREATE INDEX "employee_attendance_profiles_reportingManagerId_idx" ON "employee_attendance_profiles"("reportingManagerId");

-- CreateIndex
CREATE INDEX "weekly_off_policies_isActive_idx" ON "weekly_off_policies"("isActive");

-- CreateIndex
CREATE INDEX "holiday_calendars_financialYear_idx" ON "holiday_calendars"("financialYear");

-- CreateIndex
CREATE INDEX "holidays_calendarId_idx" ON "holidays"("calendarId");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_calendarId_date_key" ON "holidays"("calendarId", "date");

-- CreateIndex
CREATE INDEX "leave_policies_financialYear_idx" ON "leave_policies"("financialYear");

-- CreateIndex
CREATE INDEX "daily_attendance_userId_idx" ON "daily_attendance"("userId");

-- CreateIndex
CREATE INDEX "daily_attendance_date_idx" ON "daily_attendance"("date");

-- CreateIndex
CREATE INDEX "daily_attendance_status_idx" ON "daily_attendance"("status");

-- CreateIndex
CREATE UNIQUE INDEX "daily_attendance_userId_date_key" ON "daily_attendance"("userId", "date");

-- CreateIndex
CREATE INDEX "attendance_regularizations_userId_date_idx" ON "attendance_regularizations"("userId", "date");

-- CreateIndex
CREATE INDEX "attendance_regularizations_status_idx" ON "attendance_regularizations"("status");

-- AddForeignKey
ALTER TABLE "shift_policies" ADD CONSTRAINT "shift_policies_attendancePolicyId_fkey" FOREIGN KEY ("attendancePolicyId") REFERENCES "attendance_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_attendance_profiles" ADD CONSTRAINT "employee_attendance_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_attendance_profiles" ADD CONSTRAINT "employee_attendance_profiles_assignedShiftId_fkey" FOREIGN KEY ("assignedShiftId") REFERENCES "shift_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_attendance_profiles" ADD CONSTRAINT "employee_attendance_profiles_assignedLeavePolicyId_fkey" FOREIGN KEY ("assignedLeavePolicyId") REFERENCES "leave_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "holiday_calendars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_attendance" ADD CONSTRAINT "daily_attendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_regularizations" ADD CONSTRAINT "attendance_regularizations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
