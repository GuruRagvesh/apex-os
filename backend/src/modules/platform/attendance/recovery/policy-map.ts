import type { PolicyReference } from './recovery.types';

/**
 * Policy references resolve by stable identity — (policyKey, version) — never by
 * a historic UUID, and never by creating a policy.
 *
 * ShiftPolicy / AttendancePolicy / HolidayCalendar are versioned rows
 * (@@unique([policyKey, version]) with effectiveFrom/effectiveTo and a status,
 * managed by PolicyVersionService). A reference resolves when that exact version
 * exists; it is then checked against the date it is used for:
 *
 *   RESOLVED              exists, not a draft, effective on that business date
 *   MISSING_REFERENCE     no row with that key and version
 *   DRAFT_VERSION         exists but was never approved — evidence of a mismatch
 *   NOT_EFFECTIVE_ON_DATE exists but its effective window excludes the date
 *
 * The last two are not "missing", and they are not fine either: they mean the
 * history and the current policy table disagree, which is a human question.
 */

export interface PolicyVersionRow {
  id: string;
  policyKey: string;
  version: number;
  status: string;
  /** Company business dates, YYYY-MM-DD (convert with TVAService before calling). */
  effectiveFrom: string;
  effectiveTo: string | null;
}

export type PolicyResolution =
  | { state: 'RESOLVED'; id: string }
  | { state: 'MISSING_REFERENCE' }
  | { state: 'DRAFT_VERSION'; id: string }
  | { state: 'NOT_EFFECTIVE_ON_DATE'; id: string };

export function indexPolicies(rows: PolicyVersionRow[]): Map<string, PolicyVersionRow> {
  return new Map(rows.map((r) => [`${r.policyKey}|${r.version}`, r]));
}

export function resolvePolicyReference(
  ref: PolicyReference,
  index: Map<string, PolicyVersionRow>,
  businessDate: string,
): PolicyResolution {
  const row = index.get(`${ref.policyKey}|${ref.version}`);
  if (!row) return { state: 'MISSING_REFERENCE' };
  if (row.status === 'DRAFT') return { state: 'DRAFT_VERSION', id: row.id };
  if (businessDate < row.effectiveFrom || (row.effectiveTo !== null && businessDate > row.effectiveTo)) {
    return { state: 'NOT_EFFECTIVE_ON_DATE', id: row.id };
  }
  return { state: 'RESOLVED', id: row.id };
}
