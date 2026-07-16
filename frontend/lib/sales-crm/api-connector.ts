// Sales CRM — Future backend connector boundary
//
// Phase 1 has no backend wiring. Every store (audit-log.ts,
// settings-store.ts, analytics-store.ts, company-repository.ts, and
// whatever Step 2+ ports add) reads/writes local mock data or
// localStorage directly. This file is the single place that later work
// flips from "local" to "calling /api/sales-crm/*" — it does not call
// any backend today, and it does not assume a specific endpoint shape
// for modules that aren't ported yet (Dashboard/Leads/Database/Analytics/
// Settings UI). It only defines the mode flag and a generic resolver so
// that decision lives in one place instead of being hardcoded per store.

export type SalesCrmDataMode = "mock" | "api";

// Hardcoded for Phase 1. When real /api/sales-crm/* endpoints exist, this
// becomes the one line that changes — not a per-store rewrite.
export const SALES_CRM_DATA_MODE: SalesCrmDataMode = "mock";

export function isMockMode(): boolean {
  return SALES_CRM_DATA_MODE === "mock";
}

/**
 * Resolves to `mockValue` today. Once a module has a real endpoint, its
 * store swaps this call for a real fetch behind the same `isMockMode()`
 * branch — call sites don't need to change shape twice.
 */
export async function resolveDataSource<T>(mockValue: T, apiCall: () => Promise<T>): Promise<T> {
  if (isMockMode()) return mockValue;
  return apiCall();
}
