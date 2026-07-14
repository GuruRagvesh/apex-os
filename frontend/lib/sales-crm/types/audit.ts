// Sales CRM — Audit log types
// Ported from intern SalesCRM Phase 1 source (src/types/audit.ts).
import { Role } from "./index";

export type AuditAction =
  | "login"
  | "logout"
  | "create"
  | "update"
  | "delete"
  | "archive"
  | "import"
  | "export"
  | "permission_update"
  | "backup"
  | "restore"
  | "stage_change"
  | "activity_added"
  | "followup_added"
  | "requirement_added"
  | "settings_update"
  | "status_change"
  | "column_reorder"
  | "column_visibility_toggle"
  | "custom_column_delete"
  | "custom_column_create"
  | "email_clicked"
  | "call_clicked"
  | "owner_change"
  | "action_menu_opened"
  | "add_activity_opened";

export type AuditCollection =
  | "Auth"
  | "Leads"
  | "Lead Activities"
  | "Follow-ups"
  | "Requirements"
  | "Database Clients"
  | "Database Leads Master"
  | "Database Vendors"
  | "Database Trainers"
  | "Database Service Database"
  | "Settings Users"
  | "Settings Role Permissions"
  | "Settings CRM Configuration"
  | "Settings Import Data"
  | "Settings Backup Restore"
  | "System";

export interface AuditLogRecord {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  userRole: Role | "SYSTEM";
  action: AuditAction;
  collection: AuditCollection;
  entityId?: string;
  entityName?: string;
  details: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string;
  device?: string;
  status?: "success" | "failure" | "pending" | string;
  metadata?: unknown;
}
