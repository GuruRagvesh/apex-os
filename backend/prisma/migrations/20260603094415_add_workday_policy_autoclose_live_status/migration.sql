-- AlterTable
ALTER TABLE "break_logs" ADD COLUMN     "reason" TEXT,
ADD COLUMN     "source" TEXT;

-- AlterTable
ALTER TABLE "work_sessions" ADD COLUMN     "autoClosed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autoClosedAt" TIMESTAMP(3),
ADD COLUMN     "closureReason" TEXT;

-- CreateTable
CREATE TABLE "user_workday_policy_overrides" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timezone" TEXT,
    "startTime" TEXT,
    "endTime" TEXT,
    "entryWindowStart" TEXT,
    "entryWindowEnd" TEXT,
    "exitWindowStart" TEXT,
    "exitWindowEnd" TEXT,
    "minimumWorkdayMinutes" INTEGER,
    "flexible" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_workday_policy_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_workday_policy_overrides_userId_key" ON "user_workday_policy_overrides"("userId");

-- AddForeignKey
ALTER TABLE "user_workday_policy_overrides" ADD CONSTRAINT "user_workday_policy_overrides_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
