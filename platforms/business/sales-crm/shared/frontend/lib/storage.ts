// Sales CRM — Storage key registry + safe localStorage access
//
// Single source of truth for every localStorage key this workspace uses,
// so a future module port can never introduce an unnamespaced key by
// accident. All keys are "salescrm_"/"salescrm-" prefixed — never a
// generic name like "user", "token", "theme", or "settings".
//
// Existing ported files (audit-log.ts, company/company-repository.ts,
// settings-store.ts) already read/write their own keys directly and are
// intentionally left as-is in this step — they already use safe,
// namespaced keys (see the KEYS registry below, which documents them for
// reference). This module is the pattern for keys introduced from here
// on (Step 2+ modules: activity tabs, lead columns, theme, sidebar
// collapse, etc.), not a mandatory rewrite of already-correct code.

export const SALES_CRM_STORAGE_KEYS = {
  // Already in use by ported files:
  auditLogs: "salescrm_audit_logs",
  companyMaster: "salescrm_company_master",
  settings: "salescrm_settings",
  // Already safely namespaced in intern source, reserved for Step 2+ ports:
  sidebarCollapsed: "salescrm-sidebar-collapsed",
  theme: "salescrm-theme",
  activityTabOrder: "salescrm_activity_tab_order",
  activityTabs: "salescrm_activity_tabs",
  defaultActivityTab: "salescrm_default_activity_tab",
  defaultDashboard: "salescrm_default_dashboard",
  leadColumns: "salescrm_lead_columns",
} as const;

export type SalesCrmStorageKey = (typeof SALES_CRM_STORAGE_KEYS)[keyof typeof SALES_CRM_STORAGE_KEYS];

/** SSR-safe localStorage.getItem — returns null on the server or on read failure. */
export function safeGetItem(key: SalesCrmStorageKey): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** SSR-safe localStorage.setItem — no-op on the server or on write failure. */
export function safeSetItem(key: SalesCrmStorageKey, value: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can fail (quota, private browsing) — callers treat this as
    // best-effort persistence, matching the ported stores' own behavior.
  }
}

/** SSR-safe localStorage.removeItem — no-op on the server or on failure. */
export function safeRemoveItem(key: SalesCrmStorageKey): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {
    // best-effort, same as safeSetItem
  }
}

/** SSR-safe JSON read with a typed fallback if the key is missing or malformed. */
export function safeGetJSON<T>(key: SalesCrmStorageKey, fallback: T): T {
  const raw = safeGetItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** SSR-safe JSON write. */
export function safeSetJSON<T>(key: SalesCrmStorageKey, value: T): void {
  safeSetItem(key, JSON.stringify(value));
}
