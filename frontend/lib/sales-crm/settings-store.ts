"use client";

// Sales CRM — Settings localStorage store
// Ported from intern source (src/lib/settings-store.ts). Follows the same
// useSyncExternalStore pattern as audit-log.ts. Storage key renamed from
// the generic "crm_settings" to a namespaced key.

import { useSyncExternalStore, useCallback } from "react";
import { Role } from "./types";
import {
  SettingsState,
  SettingsUser,
  AuditLogEntry,
  AuditAction,
  AuditLogFilters,
  RolePermissionDefaults,
  CRMConfig,
  ImportState,
  ImportPreviewResult,
  ImportInvalidRow,
  CollectionSchema,
  IMPORT_SCHEMAS,
  IMPORT_COLLECTIONS,
  CompanyProfile,
  UserProfile,
  CustomRole,
} from "./types/settings";
import { logAction } from "./audit-log";
import { AuditAction as GlobalAuditAction, AuditCollection } from "./types/audit";

/* ------------------------------------------------------------------ */
/*  Storage key                                                        */
/* ------------------------------------------------------------------ */
const SETTINGS_KEY = "salescrm_settings";

/* ------------------------------------------------------------------ */
/*  Default data                                                       */
/* ------------------------------------------------------------------ */
const DEFAULT_ROLE_PERMISSIONS: RolePermissionDefaults = {
  // NOTE: Frontend checks rely on frontend/src/lib/permissions.ts as the single source of truth.
  // These settings are merely UI representations of those defaults.
  [Role.SUPERADMIN]: { view: true, add: true, edit: true, delete: true, export: true },
  [Role.ADMIN]: { view: true, add: true, edit: true, delete: true, export: true },
  [Role.MANAGER]: { view: true, add: true, edit: true, delete: false, export: false },
  [Role.TL]: { view: true, add: true, edit: true, delete: false, export: false },
  [Role.EMPLOYEE]: { view: true, add: true, edit: true, delete: false, export: false },
};

const DEFAULT_CRM_CONFIG: CRMConfig = {
  sla_profile_sharing: 24,
  sla_req_response: 48,
  sla_follow_up: 24,
  sla_payment_follow_up: 72,
  sla_sourcing: 48,
  lead_statuses: ["Created", "Cold", "Level 0", "Level 0(A)", "Level 1", "Level 1(A)", "Level 2", "Level 3", "Level 4", "Level 4(A)", "Level 5", "Level 6", "Closed", "Invalid", "Hold"],
  pipeline_stages: ["New", "Qualification", "Proposal", "Negotiation", "Closed Won", "Closed Lost"],
  requirement_statuses: ["New Requirement", "In Discussion", "Fulfillment", "Proposal", "Deal"],
  deal_statuses: ["Proposal Sent", "Negotiation", "Confirmed", "Payment Pending", "Won", "Lost", "Closed", "Cancelled"],
  payment_statuses: ["Pending", "Partial", "Paid"],
  service_lines: ["IT Consulting", "Software Development", "Cloud Services", "Data Analytics", "Cybersecurity"],
  sla_rules: [],
  duplicate_rules: [
    { id: "dr-1", collection: "leads", fields: ["email"], action: "reject" },
    { id: "dr-2", collection: "leads", fields: ["phone"], action: "flag" },
  ],
  follow_up_rules: [],
  notification_rules: [],
  import_mappings: [],
  form_templates: [],
  proposal_templates: [],
  invoice_settings: {
    prefix: "INV-",
    next_number: 1001,
    tax_rate: 18,
    currency: "INR",
    payment_terms: "Net 30",
  },
  role_permissions: DEFAULT_ROLE_PERMISSIONS,
};

const DEFAULT_USERS: SettingsUser[] = [
  {
    id: "u-superadmin-1",
    first_name: "Priya",
    last_name: "Sharma",
    email: "priya@salescrm.io",
    role: Role.SUPERADMIN,
    department: "Management",
    team_id: "team-1",
    status: "active",
    permissions_view: true,
    permissions_add: true,
    permissions_edit: true,
    permissions_delete: true,
    permissions_export: true,
    assignable_to_leads: true,
    assignable_to_requirements: true,
    assignable_to_deals: true,
    password_reset_required: false,
  },
  {
    id: "u-admin-1",
    first_name: "Rahul",
    last_name: "Mehta",
    email: "rahul@salescrm.io",
    role: Role.ADMIN,
    department: "Sales",
    team_id: "team-1",
    status: "active",
    permissions_view: true,
    permissions_add: true,
    permissions_edit: true,
    permissions_delete: true,
    permissions_export: true,
    assignable_to_leads: true,
    assignable_to_requirements: true,
    assignable_to_deals: true,
    password_reset_required: false,
  },
  {
    id: "u-manager-1",
    first_name: "Anita",
    last_name: "Desai",
    email: "anita@salescrm.io",
    role: Role.MANAGER,
    department: "Sales",
    team_id: "team-2",
    status: "active",
    permissions_view: true,
    permissions_add: true,
    permissions_edit: true,
    permissions_delete: false,
    permissions_export: false,
    assignable_to_leads: true,
    assignable_to_requirements: true,
    assignable_to_deals: true,
    password_reset_required: false,
  },
  {
    id: "u-tl-1",
    first_name: "Vikram",
    last_name: "Singh",
    email: "vikram@salescrm.io",
    role: Role.TL,
    department: "Pre-Sales",
    team_id: "team-2",
    status: "active",
    permissions_view: true,
    permissions_add: true,
    permissions_edit: true,
    permissions_delete: false,
    permissions_export: false,
    assignable_to_leads: true,
    assignable_to_requirements: true,
    assignable_to_deals: false,
    password_reset_required: false,
  },
  {
    id: "u-employee-1",
    first_name: "Sneha",
    last_name: "Patil",
    email: "sneha@salescrm.io",
    role: Role.EMPLOYEE,
    department: "Pre-Sales",
    team_id: "team-2",
    status: "active",
    permissions_view: true,
    permissions_add: true,
    permissions_edit: true,
    permissions_delete: false,
    permissions_export: false,
    assignable_to_leads: true,
    assignable_to_requirements: false,
    assignable_to_deals: false,
    password_reset_required: false,
  },
];

function getDefaultState(): SettingsState {
  return {
    users: DEFAULT_USERS,
    auditLogs: [],
    rolePermissions: DEFAULT_ROLE_PERMISSIONS,
    crmConfig: DEFAULT_CRM_CONFIG,
    importState: null,
    importedData: {},
    companyProfile: {
      company_name: "SalesCRM Inc",
      company_address: "123 Business Rd",
      timezone: "UTC",
      currency: "USD",
      contact_details: "contact@salescrm.io",
    },
    userProfile: {
      name: "Demo User",
      phone: "+1234567890",
      email: "demo@salescrm.io",
      profile_photo: "",
      timezone: "UTC",
      date_format: "MM/DD/YYYY",
      language: "English",
      address: "456 User St",
      work_details: "Software Engineer",
      location_details: "Remote",
    },
    importHistory: [],
    backupHistory: [],
    customRoles: [],
  };
}

/* ------------------------------------------------------------------ */
/*  External store (same pattern as audit-log.ts)                      */
/* ------------------------------------------------------------------ */
let listeners: Array<() => void> = [];

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

let cachedSnapshot: SettingsState | null = null;
let cachedRaw: string | null = null;

function readStorage(): SettingsState {
  if (typeof window === "undefined") return getDefaultState();
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw === cachedRaw && cachedSnapshot) return cachedSnapshot;
    cachedRaw = raw;
    cachedSnapshot = raw ? (JSON.parse(raw) as SettingsState) : getDefaultState();
    return cachedSnapshot;
  } catch {
    cachedRaw = null;
    cachedSnapshot = getDefaultState();
    return cachedSnapshot;
  }
}

function writeStorage(state: SettingsState) {
  const json = JSON.stringify(state);
  localStorage.setItem(SETTINGS_KEY, json);
  cachedRaw = json;
  cachedSnapshot = state;
  emitChange();
}

function getSnapshot(): SettingsState {
  return readStorage();
}

function getServerSnapshot(): SettingsState {
  return getDefaultState();
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
let generatedIdCounter = 0;

function generateId(prefix: string): string {
  generatedIdCounter += 1;
  const stateSize = JSON.stringify(cachedSnapshot ?? getDefaultState()).length;
  return `${prefix}-${stateSize}-${generatedIdCounter}`;
}

function createAuditEntry(
  action: AuditAction,
  userName: string,
  userId: string,
  details: string,
  extra?: Partial<AuditLogEntry>
): AuditLogEntry {
  // Find the role if possible from current state (or mock snapshot)
  let userRole: Role | "SYSTEM" = "SYSTEM";
  const state = cachedSnapshot;
  if (state) {
    const user = state.users.find((u) => u.id === userId);
    if (user) {
      userRole = user.role;
    }
  }

  // Determine collection based on action or extra
  let collection: AuditCollection = "Settings CRM Configuration";
  if (["user_create", "user_update", "user_deactivate", "password_update"].includes(action)) collection = "Settings Users";
  else if (action === "permissions_update") collection = "Settings Role Permissions";
  else if (action === "import") collection = "Settings Import Data";
  else if (action === "backup_export" || action === "restore") collection = "Settings Backup Restore";

  // Map action to GlobalAuditAction if needed
  let globalAction: GlobalAuditAction = action as unknown as GlobalAuditAction;
  if (action === "user_create") globalAction = "create";
  if (action === "user_update" || action === "profile_update" || action === "company_profile_update" || action === "password_update") globalAction = "update";
  if (action === "user_deactivate") globalAction = "delete";
  if (action === "role_create") globalAction = "create";
  if (action === "restore") globalAction = "restore";
  if (action === "backup_export") globalAction = "backup";

  logAction({
    userId,
    userName,
    userRole,
    action: globalAction,
    collection,
    details,
    status: typeof extra === 'object' && extra !== null && 'log_status' in extra ? (extra as Record<string, unknown>).log_status as string : undefined,
    before: typeof extra === 'object' && extra !== null && 'before' in extra ? (extra as Record<string, unknown>).before : undefined,
    after: typeof extra === 'object' && extra !== null && 'after' in extra ? (extra as Record<string, unknown>).after : undefined,
    metadata: extra,
  });

  return {
    id: generateId("audit"),
    timestamp: new Date().toISOString(),
    user_id: userId,
    user_name: userName,
    action,
    details,
    ...extra,
  };
}

/* ------------------------------------------------------------------ */
/*  Duplicate normalization                                            */
/* ------------------------------------------------------------------ */
export function normalizeDuplicateField(field: string, value: string): string {
  if (!value || typeof value !== "string") return "";
  const key = field.toLowerCase();
  if (["email", "company", "linkedin", "gst"].includes(key)) {
    return value.toLowerCase().trim();
  }
  if (key === "phone") {
    return value.replace(/[\s+\-()[\]]/g, "");
  }
  return value.trim();
}

/* ------------------------------------------------------------------ */
/*  Import validation                                                  */
/* ------------------------------------------------------------------ */
export function validateImportData(
  data: Record<string, unknown>[],
  targetCollection: string,
  existingData: Record<string, unknown>[] = []
): ImportPreviewResult {
  const schema: CollectionSchema | undefined = IMPORT_SCHEMAS[targetCollection];
  if (!schema) {
    return {
      total: data.length,
      validRows: [],
      invalidRows: data.map((row, i) => ({
        rowNumber: i + 1,
        reason: "Invalid target collection",
        data: row,
      })),
    };
  }

  const validRows: Record<string, unknown>[] = [];
  const invalidRows: ImportInvalidRow[] = [];
  const seenDuplicates = new Map<string, number>();

  // Build existing duplicate keys set
  const existingKeys = new Set<string>();
  for (const existing of existingData) {
    for (const dk of schema.duplicateKeys) {
      const val = existing[dk];
      if (val && typeof val === "string") {
        existingKeys.add(`${dk}:${normalizeDuplicateField(dk, val)}`);
      }
    }
  }

  // Check if there are any recognized headers in the first row
  if (data.length > 0) {
    const firstRowKeys = Object.keys(data[0]);
    if (firstRowKeys.length > 0) {
      const hasRecognized = firstRowKeys.some(k => schema.fields.includes(k));
      if (!hasRecognized) {
        throw new Error("No recognized headers found in the file. Please check the expected fields or download the template.");
      }
    }
  }

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const rowNum = i + 1;

    // Check empty row
    const values = Object.values(row).filter((v) => v !== null && v !== undefined && v !== "");
    if (values.length === 0) {
      invalidRows.push({ rowNumber: rowNum, reason: "Empty row", data: row });
      continue;
    }

    // Check unknown columns
    const rowKeys = Object.keys(row);
    const unknownKeys = rowKeys.filter((k) => !schema.fields.includes(k));
    if (unknownKeys.length > 0) {
      invalidRows.push({
        rowNumber: rowNum,
        reason: `Unknown columns: ${unknownKeys.join(", ")}`,
        data: row,
      });
      continue;
    }

    // Check required fields
    const missingRequired = schema.requiredFields.filter((f) => {
      const v = row[f];
      return v === undefined || v === null || v === "";
    });
    if (missingRequired.length > 0) {
      invalidRows.push({
        rowNumber: rowNum,
        reason: `Missing required fields: ${missingRequired.join(", ")}`,
        data: row,
      });
      continue;
    }

    // Normalize and check duplicates
    let isDuplicate = false;
    let duplicateReason = "";
    for (const dk of schema.duplicateKeys) {
      const val = row[dk];
      if (val && typeof val === "string") {
        const normalized = normalizeDuplicateField(dk, val);
        const key = `${dk}:${normalized}`;

        // Check against existing data
        if (existingKeys.has(key)) {
          isDuplicate = true;
          duplicateReason = `Duplicate ${dk} (exists in database): ${val}`;
          break;
        }

        // Check within import batch
        if (seenDuplicates.has(key)) {
          isDuplicate = true;
          duplicateReason = `Duplicate ${dk} (same as row ${seenDuplicates.get(key)}): ${val}`;
          break;
        }

        seenDuplicates.set(key, rowNum);
      }
    }

    if (isDuplicate) {
      invalidRows.push({ rowNumber: rowNum, reason: duplicateReason, data: row });
      continue;
    }

    // Normalize all fields
    const normalizedRow: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (schema.fields.includes(k) && typeof v === "string") {
        normalizedRow[k] = normalizeDuplicateField(k, v);
      } else if (schema.fields.includes(k)) {
        normalizedRow[k] = v;
      }
    }

    validRows.push(normalizedRow);
  }

  return {
    total: data.length,
    validRows,
    invalidRows,
  };
}

/* ------------------------------------------------------------------ */
/*  CSV parser                                                         */
/*  Intern's original parseCSV ran both CSV and Excel files through    */
/*  XLSX.read(). xlsx was removed pending an import-package decision,  */
/*  and Settings' ImportData.tsx (Step 7) only ever offers .csv/.json  */
/*  in its file picker anyway — there is no Excel path here to keep    */
/*  disabled. This is a manual RFC-4180-style parser (quoted fields,   */
/*  escaped quotes, embedded commas, CRLF/LF) with no dependency, so   */
/*  CSV import keeps working. Errors propagate to the caller rather    */
/*  than silently resolving to an empty array (intern's original did  */
/*  the latter, swallowing parse failures behind a console.error).    */
/* ------------------------------------------------------------------ */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];

    if (inQuotes) {
      if (char === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

export async function parseCSV(file: File | string): Promise<Record<string, string>[]> {
  const text = typeof file === "string" ? file : await file.text();
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];

  const headers = rows[0];
  return rows
    .slice(1)
    .filter((row) => row.some((cell) => cell !== ""))
    .map((row) => {
      const stringRow: Record<string, string> = {};
      headers.forEach((header, i) => {
        stringRow[header] = row[i] ?? "";
      });
      return stringRow;
    });
}

/* ------------------------------------------------------------------ */
/*  JSON parser                                                        */
/* ------------------------------------------------------------------ */
export function parseJSONImport(text: string): Record<string, unknown>[] {
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed === "object" && parsed !== null) return [parsed];
  throw new Error("Invalid JSON: expected array or object");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSettingsBackupCandidate(value: unknown): value is SettingsState {
  if (!isRecord(value)) return false;

  return (
    Array.isArray(value.users) &&
    Array.isArray(value.auditLogs) &&
    isRecord(value.crmConfig) &&
    isRecord(value.rolePermissions) &&
    Array.isArray(value.importHistory || []) &&
    Array.isArray(value.backupHistory || []) &&
    isRecord(value.companyProfile || {}) &&
    isRecord(value.userProfile || {})
  );
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */
export function useSettingsStore() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // ---- User Management ----
  const addUser = useCallback((user: Omit<SettingsUser, "id">, actorName: string, actorId: string) => {
    const s = readStorage();
    const newUser: SettingsUser = { ...user, id: generateId("u") };
    const userNameToUse = 'name' in user ? (user as Record<string, unknown>).name : user.first_name;
    const audit = createAuditEntry("user_create", actorName, actorId, `Created user: ${userNameToUse} (${user.email})`, { log_status: "success", after: newUser });
    writeStorage({ ...s, users: [...s.users, newUser], auditLogs: [audit, ...s.auditLogs] });
    return newUser;
  }, []);

  const updateUser = useCallback((userId: string, updates: Partial<SettingsUser>, actorName: string, actorId: string) => {
    const s = readStorage();
    const target = s.users.find((u) => u.id === userId);
    const updated = { ...target, ...updates } as SettingsUser;
    const users = s.users.map((u) => (u.id === userId ? updated : u));
    const targetNameToUse = target && 'name' in target ? (target as Record<string, unknown>).name : target?.first_name;
    const audit = createAuditEntry("user_update", actorName, actorId, `Updated user: ${targetNameToUse}`, { log_status: "success", before: target, after: updated });
    writeStorage({ ...s, users, auditLogs: [audit, ...s.auditLogs] });
  }, []);

  const deactivateUser = useCallback((userId: string, actorName: string, actorId: string) => {
    const s = readStorage();
    const target = s.users.find((u) => u.id === userId);
    const updated = { ...target, status: "inactive" as const } as SettingsUser;
    const users = s.users.map((u) => (u.id === userId ? updated : u));
    const targetNameToUse = target && 'name' in target ? (target as Record<string, unknown>).name : target?.first_name;
    const audit = createAuditEntry("user_deactivate", actorName, actorId, `Deactivated user: ${targetNameToUse}`, { log_status: "success", before: target, after: updated });
    writeStorage({ ...s, users, auditLogs: [audit, ...s.auditLogs] });
  }, []);

  // ---- Custom Roles ----
  const addCustomRole = useCallback((role: Omit<CustomRole, "id">, actorName: string, actorId: string) => {
    const s = readStorage();
    const newRole: CustomRole = { ...role, id: generateId("cr") };
    const audit = createAuditEntry("role_create", actorName, actorId, `Created custom role: ${role.name}`, { log_status: "success", after: newRole });
    writeStorage({ ...s, customRoles: [...s.customRoles, newRole], auditLogs: [audit, ...s.auditLogs] });
    return newRole;
  }, []);

  const updateCustomRole = useCallback((roleId: string, updates: Partial<CustomRole>, actorName: string, actorId: string) => {
    const s = readStorage();
    const target = s.customRoles.find((r) => r.id === roleId);
    const updated = { ...target, ...updates } as CustomRole;
    const customRoles = s.customRoles.map((r) => (r.id === roleId ? updated : r));
    const audit = createAuditEntry("permissions_update", actorName, actorId, `Updated custom role: ${updates.name || roleId}`, { log_status: "success", before: target, after: updated });
    writeStorage({ ...s, customRoles, auditLogs: [audit, ...s.auditLogs] });
  }, []);

  const deleteCustomRole = useCallback((roleId: string, actorName: string, actorId: string) => {
    const s = readStorage();
    const target = s.customRoles.find((r) => r.id === roleId);
    const customRoles = s.customRoles.filter((r) => r.id !== roleId);
    const audit = createAuditEntry("permissions_update", actorName, actorId, `Deleted custom role: ${target?.name}`, { log_status: "success", before: target });
    writeStorage({ ...s, customRoles, auditLogs: [audit, ...s.auditLogs] });
  }, []);

  // ---- Role Permissions ----
  const updateRolePermissions = useCallback((permissions: RolePermissionDefaults, actorName: string, actorId: string) => {
    const s = readStorage();
    const audit = createAuditEntry("permissions_update", actorName, actorId, "Updated role permission defaults", { log_status: "success", before: s.rolePermissions, after: permissions });
    const crmConfig = { ...s.crmConfig, role_permissions: permissions };
    writeStorage({ ...s, rolePermissions: permissions, crmConfig, auditLogs: [audit, ...s.auditLogs] });
  }, []);

  // ---- CRM Config ----
  const updateCRMConfig = useCallback((config: Partial<CRMConfig>, actorName: string, actorId: string, auditDetail?: string) => {
    const s = readStorage();
    const newConfig = { ...s.crmConfig, ...config };
    const audit = createAuditEntry("settings_update", actorName, actorId, auditDetail || "Updated CRM configuration", { log_status: "success", before: s.crmConfig, after: newConfig });
    writeStorage({ ...s, crmConfig: newConfig, auditLogs: [audit, ...s.auditLogs] });
  }, []);

  // ---- Import ----
  const setImportPreview = useCallback((importState: ImportState) => {
    const s = readStorage();
    writeStorage({ ...s, importState });
  }, []);

  const commitImport = useCallback((actorName: string, actorId: string) => {
    const s = readStorage();
    if (!s.importState?.previewResult) return;
    const { targetCollection, fileName, previewResult } = s.importState;
    const count = previewResult.validRows.length;
    const existingCollectionData = s.importedData[targetCollection] || [];
    const updatedImportedData = {
      ...s.importedData,
      [targetCollection]: [...existingCollectionData, ...previewResult.validRows],
    };
    const audit = createAuditEntry("import", actorName, actorId, `Imported ${count} records into ${targetCollection}`, {
      target_collection: targetCollection,
      log_status: previewResult.invalidRows.length > 0 ? "warning" : "success",
    });

    const errorLog = previewResult.invalidRows.length > 0
      ? previewResult.invalidRows.slice(0, 10).map(r => `Row ${r.rowNumber}: ${r.reason}`).join(" | ") + (previewResult.invalidRows.length > 10 ? "..." : "")
      : undefined;

    const historyEntry = {
      id: generateId("ih"),
      timestamp: new Date().toISOString(),
      target_collection: targetCollection,
      file_name: fileName,
      status: previewResult.invalidRows.length > 0 ? "partial" as const : "success" as const,
      imported_count: count,
      invalid_count: previewResult.invalidRows.length,
      imported_by: actorName,
      error_log: errorLog,
    };

    writeStorage({
      ...s,
      importState: null,
      importedData: updatedImportedData,
      auditLogs: [audit, ...s.auditLogs],
      importHistory: [historyEntry, ...s.importHistory],
    });
  }, []);

  const clearImport = useCallback(() => {
    const s = readStorage();
    writeStorage({ ...s, importState: null });
  }, []);

  const recordImportFailure = useCallback((
    targetCollection: string,
    fileName: string,
    errorMessage: string,
    actorName: string,
    actorId: string
  ) => {
    const s = readStorage();
    const audit = createAuditEntry("import", actorName, actorId, `Failed import into ${targetCollection}: ${errorMessage}`, {
      target_collection: targetCollection,
      log_status: "failure",
    });
    const historyEntry = {
      id: generateId("ih"),
      timestamp: new Date().toISOString(),
      target_collection: targetCollection,
      file_name: fileName,
      status: "failed" as const,
      imported_count: 0,
      invalid_count: 1,
      imported_by: actorName,
      error_log: errorMessage,
    };

    writeStorage({
      ...s,
      importState: null,
      auditLogs: [audit, ...s.auditLogs],
      importHistory: [historyEntry, ...s.importHistory],
    });
  }, []);

  // ---- Audit Logs ----
  const getFilteredAuditLogs = useCallback((filters: AuditLogFilters): AuditLogEntry[] => {
    const s = readStorage();
    return s.auditLogs.filter((log) => {
      if (filters.department && log.department !== filters.department) return false;
      if (filters.pipeline_stage && log.pipeline_stage !== filters.pipeline_stage) return false;
      if (filters.lead_status && log.lead_status !== filters.lead_status) return false;
      if (filters.action && log.action !== filters.action) return false;
      if (filters.user && !log.user_name.toLowerCase().includes(filters.user.toLowerCase())) return false;
      if (filters.date_from && log.timestamp < filters.date_from) return false;
      if (filters.date_to && log.timestamp > filters.date_to + "T23:59:59.999Z") return false;
      return true;
    });
  }, []);

  const addAuditLog = useCallback((action: AuditAction, actorName: string, actorId: string, details: string, extra?: Partial<AuditLogEntry>) => {
    const s = readStorage();
    const audit = createAuditEntry(action, actorName, actorId, details, extra);
    writeStorage({ ...s, auditLogs: [audit, ...s.auditLogs] });
  }, []);

  // ---- Backup / Restore / Reset ----
  const exportBackup = useCallback((actorName: string, actorId: string): string => {
    const s = readStorage();
    const data = JSON.stringify(s, null, 2);

    const audit = createAuditEntry("backup_export", actorName, actorId, "Exported system backup", { log_status: "success" });

    const historyEntry = {
      id: generateId("bh"),
      timestamp: new Date().toISOString(),
      size_bytes: new Blob([data]).size,
      action: "export" as const,
      status: "success" as const,
      created_by: actorName,
    };

    writeStorage({
      ...s,
      auditLogs: [audit, ...s.auditLogs],
      backupHistory: [historyEntry, ...s.backupHistory],
    });

    return data;
  }, []);

  const importBackup = useCallback((data: string, actorName: string, actorId: string, isFailure?: boolean, errorMsg?: string) => {
    if (isFailure) {
      const s = readStorage();
      const audit = createAuditEntry("restore", actorName, actorId, `Failed to restore system backup: ${errorMsg}`, { log_status: "failure" });
      const historyEntry = {
        id: generateId("bh"),
        timestamp: new Date().toISOString(),
        size_bytes: new Blob([data]).size,
        action: "import" as const,
        status: "failed" as const,
        created_by: actorName,
      };
      writeStorage({ ...s, auditLogs: [audit, ...s.auditLogs], backupHistory: [historyEntry, ...s.backupHistory] });
      return;
    }

    const parsed = JSON.parse(data);
    if (!isSettingsBackupCandidate(parsed)) {
      throw new Error("Invalid backup format: missing required fields");
    }

    const audit = createAuditEntry("restore", actorName, actorId, "Restored system from backup");
    parsed.auditLogs = [audit, ...parsed.auditLogs];

    const historyEntry = {
      id: generateId("bh"),
      timestamp: new Date().toISOString(),
      size_bytes: new Blob([data]).size,
      action: "import" as const,
      status: "success" as const,
      created_by: actorName,
    };
    parsed.backupHistory = [historyEntry, ...(parsed.backupHistory || [])];

    writeStorage(parsed);
  }, []);

  const factoryReset = useCallback((actorName: string, actorId: string) => {
    const fresh = getDefaultState();
    const audit = createAuditEntry("restore", actorName, actorId, "Factory reset system to defaults", { log_status: "success" });
    fresh.auditLogs = [audit];

    const historyEntry = {
      id: generateId("bh"),
      timestamp: new Date().toISOString(),
      size_bytes: 0,
      action: "reset" as const,
      status: "success" as const,
      created_by: actorName,
    };
    fresh.backupHistory = [historyEntry];

    writeStorage(fresh);
  }, []);

  return {
    state,
    // Users
    addUser,
    updateUser,
    deactivateUser,
    // Custom Roles
    addCustomRole,
    updateCustomRole,
    deleteCustomRole,
    // Permissions
    updateRolePermissions,
    // CRM Config
    updateCRMConfig,
    // Profiles
    updateCompanyProfile: useCallback((profile: Partial<CompanyProfile>, actorName: string, actorId: string) => {
      const s = readStorage();
      const audit = createAuditEntry("company_profile_update", actorName, actorId, "Updated company profile");
      writeStorage({ ...s, companyProfile: { ...s.companyProfile, ...profile }, auditLogs: [audit, ...s.auditLogs] });
    }, []),
    updateUserProfile: useCallback((profile: Partial<UserProfile>, actorName: string, actorId: string) => {
      const s = readStorage();
      const audit = createAuditEntry("profile_update", actorName, actorId, "Updated personal profile");
      writeStorage({ ...s, userProfile: { ...s.userProfile, ...profile }, auditLogs: [audit, ...s.auditLogs] });
    }, []),
    // Import
    setImportPreview,
    commitImport,
    clearImport,
    recordImportFailure,
    // Audit
    getFilteredAuditLogs,
    addAuditLog,
    // Backup
    exportBackup,
    importBackup,
    factoryReset,
  };
}

// Re-export utilities for use outside hook
export { IMPORT_SCHEMAS, IMPORT_COLLECTIONS };
export type { ImportState, ImportPreviewResult, CustomRole, ImportHistoryEntry, BackupHistoryEntry } from "./types/settings";
