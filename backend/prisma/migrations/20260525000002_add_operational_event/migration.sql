-- CreateTable
CREATE TABLE IF NOT EXISTS "operational_events" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromState" TEXT,
    "toState" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "device" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operational_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "operational_events_actorId_idx" ON "operational_events"("actorId");
CREATE INDEX IF NOT EXISTS "operational_events_entityType_entityId_idx" ON "operational_events"("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "operational_events_action_idx" ON "operational_events"("action");
CREATE INDEX IF NOT EXISTS "operational_events_timestamp_idx" ON "operational_events"("timestamp");

-- AddForeignKey
ALTER TABLE "operational_events" ADD CONSTRAINT "operational_events_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
