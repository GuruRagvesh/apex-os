-- AlterTable
ALTER TABLE "review_cycle_logs" ADD COLUMN     "employeeAttitudeRating" INTEGER,
ADD COLUMN     "employeePerformanceRating" INTEGER,
ADD COLUMN     "ratingComment" TEXT,
ADD COLUMN     "taskEfficiencyRating" INTEGER;
