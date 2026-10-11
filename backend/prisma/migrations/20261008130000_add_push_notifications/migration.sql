-- Phase 7 follow-up: durable Web Push subscriptions extend the existing
-- notification ledger to background computers and phones.

ALTER TABLE "notifications"
  ADD COLUMN "dedupeKey" TEXT,
  ADD COLUMN "pushAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "pushDeliveredAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "notifications_userId_dedupeKey_key"
  ON "notifications"("userId", "dedupeKey");

CREATE TABLE "push_subscriptions" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "userAgent" TEXT,
  "failureCount" INTEGER NOT NULL DEFAULT 0,
  "lastSuccessAt" TIMESTAMP(3),
  "disabledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "push_subscriptions_endpoint_key"
  ON "push_subscriptions"("endpoint");
CREATE INDEX "push_subscriptions_userId_disabledAt_idx"
  ON "push_subscriptions"("userId", "disabledAt");
ALTER TABLE "push_subscriptions"
  ADD CONSTRAINT "push_subscriptions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
