CREATE TABLE "dashboard_workspaces" (
    "userId" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "shortcuts" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_workspaces_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "dashboard_workspaces" ADD CONSTRAINT "dashboard_workspaces_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
