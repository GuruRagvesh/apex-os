-- Phase 1 ticket time engine: per-rework-cycle estimate and frozen actual.
-- Additive only: two nullable columns, no default, no backfill, no rewrite.
-- AlterTable
ALTER TABLE "review_cycle_logs" ADD COLUMN     "reworkEstimatedMinutes" INTEGER,
ADD COLUMN     "reworkWorkSeconds" INTEGER;
