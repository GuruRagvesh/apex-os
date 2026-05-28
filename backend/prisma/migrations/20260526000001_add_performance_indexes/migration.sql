-- Stage 6: Add performance indexes for common filter/sort columns
-- These indexes improve query performance for ticket filters, notification filters,
-- leave filters, activity logs, project filters, and user lookups.

-- User indexes
CREATE INDEX IF NOT EXISTS "users_departmentId_idx" ON "users"("departmentId");
CREATE INDEX IF NOT EXISTS "users_roleId_idx" ON "users"("roleId");
CREATE INDEX IF NOT EXISTS "users_isActive_idx" ON "users"("isActive");

-- Project indexes
CREATE INDEX IF NOT EXISTS "projects_departmentId_idx" ON "projects"("departmentId");
CREATE INDEX IF NOT EXISTS "projects_status_idx" ON "projects"("status");
CREATE INDEX IF NOT EXISTS "projects_createdAt_idx" ON "projects"("createdAt");

-- ProjectMember indexes
CREATE INDEX IF NOT EXISTS "project_members_userId_idx" ON "project_members"("userId");

-- Ticket composite indexes
CREATE INDEX IF NOT EXISTS "tickets_priority_idx" ON "tickets"("priority");
CREATE INDEX IF NOT EXISTS "tickets_dueDate_idx" ON "tickets"("dueDate");
CREATE INDEX IF NOT EXISTS "tickets_status_assignedToId_idx" ON "tickets"("status", "assignedToId");
CREATE INDEX IF NOT EXISTS "tickets_status_departmentId_idx" ON "tickets"("status", "departmentId");

-- TicketAssignee indexes
CREATE INDEX IF NOT EXISTS "ticket_assignees_userId_idx" ON "ticket_assignees"("userId");

-- Comment indexes
CREATE INDEX IF NOT EXISTS "comments_ticketId_idx" ON "comments"("ticketId");

-- LeaveRequest composite indexes
CREATE INDEX IF NOT EXISTS "leave_requests_startDate_idx" ON "leave_requests"("startDate");
CREATE INDEX IF NOT EXISTS "leave_requests_userId_status_idx" ON "leave_requests"("userId", "status");

-- Notification composite indexes
CREATE INDEX IF NOT EXISTS "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "notifications_userId_isRead_idx" ON "notifications"("userId", "isRead");

-- ActivityLog indexes (previously had none)
CREATE INDEX IF NOT EXISTS "activity_logs_userId_idx" ON "activity_logs"("userId");
CREATE INDEX IF NOT EXISTS "activity_logs_entityType_entityId_idx" ON "activity_logs"("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "activity_logs_action_idx" ON "activity_logs"("action");
CREATE INDEX IF NOT EXISTS "activity_logs_createdAt_idx" ON "activity_logs"("createdAt");

-- TicketHistory indexes (previously had none)
CREATE INDEX IF NOT EXISTS "ticket_history_ticketId_idx" ON "ticket_history"("ticketId");
CREATE INDEX IF NOT EXISTS "ticket_history_changedAt_idx" ON "ticket_history"("changedAt");
