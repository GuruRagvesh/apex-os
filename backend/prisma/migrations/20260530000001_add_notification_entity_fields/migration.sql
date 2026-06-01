-- Fix: notifications schema/migration drift (P1-9 finding, item 13)
--
-- The Prisma `Notification` model and NotificationEventService/NotificationsService
-- write `entityId` and `entityType`, but no prior migration added these columns to
-- the `notifications` table. Production (which applies only committed migrations via
-- `prisma migrate deploy`) is therefore missing both columns, which makes
-- `GET /api/notifications` (findMany SELECT *) return 500 while `unread-count`
-- (count over userId/isRead) returns 200, and makes every notification.create throw.
--
-- This migration is purely additive: two nullable columns, no data rewrite. The
-- declared composite indexes (userId,createdAt / userId,isRead) already exist from
-- 20260526000001_add_performance_indexes, so no index changes are needed here.
--
-- `IF NOT EXISTS` keeps it idempotent: production (missing the columns) gets them,
-- while any environment already synced via `prisma db push` is a safe no-op.

ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "entityId" TEXT;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "entityType" TEXT;
