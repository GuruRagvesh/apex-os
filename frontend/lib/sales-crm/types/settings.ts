// Sales CRM — Settings module TypeScript types
// Ported from intern source (src/types/settings.ts).

import { Role } from "./index";

/* ------------------------------------------------------------------ */
/*  Audit Actions                                                      */
/* ------------------------------------------------------------------ */
export type AuditAction =
  | "status_change"
  | "user_create"
  | "user_update"
  | "user_deactivate"
  | "role_create"
  | "permissions_update"
  | "settings_update"
  | "template_update"
  | "duplicate_rules_update"
  | "import"
  | "restore"
  | "profile_update"
  | "company_profile_update"
  | "password_update"
  | "backup_export";

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  status_change: "Status Change",
  user_create: "User Created",
  user_update: "User Updated",
  user_deactivate: "User Deactivated",
  role_create: "Role Created",
  permissions_update: "Permissions Updated",
  settings_update: "Settings Updated",
  template_update: "Template Updated",
  duplicate_rules_update: "Duplicate Rules Updated",
  import: "Data Import",
  restore: "System Restored",
  profile_update: "Profile Updated",
  company_profile_update: "Company Profile Updated",
  password_update: "Password Changed",
  backup_export: "Backup Exported",
};

/* ------------------------------------------------------------------ */
/*  Settings User (extended user for management)                       */
/* ------------------------------------------------------------------ */
export interface SettingsUser {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: Role;
  department: string;
  team_id: string;
  status: "active" | "inactive";
  phone?: string;
  timezone?: string;
  language?: string;
  address?: string;
  location?: string;
  manager?: string;
  user_type?: string;
  employee_id?: string;
  region?: string;
  joining_date?: string;
  permissions_view: boolean;
  permissions_add: boolean;
  permissions_edit: boolean;
  permissions_delete: boolean;
  permissions_export: boolean;
  assignable_to_leads: boolean;
  assignable_to_requirements: boolean;
  assignable_to_deals: boolean;
  password_reset_required: boolean;
}

/* ------------------------------------------------------------------ */
/*  Audit Log Entry                                                    */
/* ------------------------------------------------------------------ */
export interface AuditLogEntry {
  id: string;
  timestamp: string; // ISO 8601
  user_id: string;
  user_name: string;
  user_role?: string;
  action: AuditAction;
  target_collection?: string;
  details: string;
  department?: string;
  pipeline_stage?: string;
  lead_status?: string;
  entity_name?: string;
  previous_value?: string;
  new_value?: string;
  before?: unknown;
  after?: unknown;
  ip_address?: string;
  device?: string;
  status?: "success" | "failure" | "pending" | "warning" | string;
  metadata?: unknown;
  log_status?: "success" | "failure" | "warning";
}

export interface AuditLogFilters {
  department?: string;
  pipeline_stage?: string;
  lead_status?: string;
  action?: AuditAction | "";
  user?: string;
  date_from?: string;
  date_to?: string;
  status?: string;
}

/* ------------------------------------------------------------------ */
/*  Role Permission Defaults                                           */
/* ------------------------------------------------------------------ */
export interface RolePermissionSet {
  view: boolean;
  add: boolean;
  edit: boolean;
  delete: boolean;
  export: boolean;
}

export type RolePermissionDefaults = Record<Role, RolePermissionSet>;

/* ------------------------------------------------------------------ */
/*  CRM Configuration                                                  */
/* ------------------------------------------------------------------ */
export interface CRMConfig {
  // SLA values (in hours)
  sla_profile_sharing: number;
  sla_req_response: number;
  sla_follow_up: number;
  sla_payment_follow_up: number;
  sla_sourcing: number;

  // Status/stage arrays
  lead_statuses: string[];
  pipeline_stages: string[];
  requirement_statuses: string[];
  deal_statuses: string[];
  payment_statuses: string[];
  service_lines: string[];

  // Rules (JSON-structured arrays)
  sla_rules: SLARule[];
  duplicate_rules: DuplicateRule[];
  follow_up_rules: FollowUpRule[];
  notification_rules: NotificationRule[];

  // Mappings & templates
  import_mappings: ImportMapping[];
  form_templates: string[];
  proposal_templates: string[];
  invoice_settings: InvoiceSettings;

  // Role permissions reference
  role_permissions: RolePermissionDefaults;
}

export interface SLARule {
  id: string;
  name: string;
  entity: string;
  start_condition: string;
  stop_condition: string;
  priority: "High" | "Medium" | "Low";
  response_time: number;
  resolution_time: number;
  business_hours: boolean;
  calendar_hours: boolean;
  escalation_rules: string;
  warning_threshold: number;
  breach_threshold: number;
  notification_rules: string;
}

export interface DuplicateRule {
  id: string;
  collection: string;
  fields: string[];
  action: "reject" | "flag" | "merge";
}

export interface FollowUpRule {
  id: string;
  name: string;
  trigger: string;
  interval_days: number;
  max_attempts: number;
}

export interface NotificationRule {
  id: string;
  event: string;
  channels: string[];
  recipients: string[];
}

export interface ImportMapping {
  id: string;
  source_field: string;
  target_field: string;
  collection: string;
}

export interface InvoiceSettings {
  prefix: string;
  next_number: number;
  tax_rate: number;
  currency: string;
  payment_terms: string;
}

/* ------------------------------------------------------------------ */
/*  Import                                                             */
/* ------------------------------------------------------------------ */
export interface ImportInvalidRow {
  rowNumber: number;
  reason: string;
  data: Record<string, unknown>;
}

export interface ImportPreviewResult {
  total: number;
  validRows: Record<string, unknown>[];
  invalidRows: ImportInvalidRow[];
}

export interface ImportState {
  targetCollection: string;
  fileName: string;
  previewResult: ImportPreviewResult | null;
  rawData: Record<string, unknown>[];
}

/* ------------------------------------------------------------------ */
/*  Profiles                                                           */
/* ------------------------------------------------------------------ */
export interface CompanyProfile {
  company_name: string;
  company_address: string;
  timezone: string;
  currency: string;
  contact_details: string;
}

export interface UserProfile {
  name: string;
  phone: string;
  email: string;
  profile_photo: string;
  timezone: string;
  date_format: string;
  language: string;
  address: string;
  work_details: string;
  location_details: string;
}

export interface ImportHistoryEntry {
  id: string;
  timestamp: string; // ISO 8601
  target_collection: string;
  file_name: string;
  status: "success" | "partial" | "failed";
  imported_count: number;
  invalid_count: number;
  imported_by: string; // User Name
  error_log?: string;
}

export interface BackupHistoryEntry {
  id: string;
  timestamp: string; // ISO 8601
  size_bytes: number;
  action?: "export" | "import" | "reset";
  status: "success" | "failed";
  created_by: string; // User Name
}

export interface CustomRole {
  id: string;
  name: string;
  description: string;
  base_role: Role; // Which enum role it derives from for backward compatibility
  permissions: RolePermissionSet;
}

/* ------------------------------------------------------------------ */
/*  Settings Store State                                               */
/* ------------------------------------------------------------------ */
export interface SettingsState {
  users: SettingsUser[];
  auditLogs: AuditLogEntry[];
  rolePermissions: RolePermissionDefaults;
  customRoles: CustomRole[];
  crmConfig: CRMConfig;
  importState: ImportState | null;
  importedData: Record<string, Record<string, unknown>[]>;
  importHistory: ImportHistoryEntry[];
  backupHistory: BackupHistoryEntry[];
  companyProfile: CompanyProfile;
  userProfile: UserProfile;
}

/* ------------------------------------------------------------------ */
/*  Schema definitions for import validation                           */
/* ------------------------------------------------------------------ */
export interface CollectionSchema {
  fields: string[];
  requiredFields: string[];
  duplicateKeys: string[];
}

export const IMPORT_SCHEMAS: Record<string, CollectionSchema> = {
  leads: {
    fields: [
      "company", "poc", "designation", "email", "phone", "location",
      "linkedin", "website", "leadStage", "leadSource", "priority",
      "headquarters", "department", "companySize", "industry",
      "serviceInterest", "groupOwner", "initialNotes",
    ],
    requiredFields: ["company", "email"],
    duplicateKeys: ["email", "phone"],
  },
  requirements: {
    fields: ["title", "details", "priority", "status", "timeline", "fulfillmentOwner"],
    requiredFields: ["title"],
    duplicateKeys: ["title"],
  },
  deals: {
    fields: ["stage", "value", "paymentStatus", "status"],
    requiredFields: ["stage", "value"],
    duplicateKeys: [],
  },
  users: {
    fields: ["email", "firstName", "lastName", "role"],
    requiredFields: ["email"],
    duplicateKeys: ["email"],
  },
  tasks: {
    fields: ["title", "dueDate", "assignedTo", "status"],
    requiredFields: ["title"],
    duplicateKeys: [],
  },
  activities: {
    fields: ["type", "description", "date", "performedBy"],
    requiredFields: ["type"],
    duplicateKeys: [],
  },
  opportunities: {
    fields: ["name", "stage", "amount", "closeDate"],
    requiredFields: ["name"],
    duplicateKeys: ["name"],
  },
};

/* ------------------------------------------------------------------ */
/*  Target collections for import                                      */
/* ------------------------------------------------------------------ */
export const IMPORT_COLLECTIONS = ["leads", "requirements", "deals", "users", "tasks", "activities", "opportunities"] as const;
export type ImportCollection = (typeof IMPORT_COLLECTIONS)[number];
