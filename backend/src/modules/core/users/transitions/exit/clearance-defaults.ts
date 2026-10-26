/**
 * Default ownership of the nine clearance areas (correction 10).
 *
 * Every category has a responsible capability. TEAM_LEAD and DEPT_MANAGER
 * items resolve to one person; HR and ADMIN items are owned by the capability
 * (any HR / any Admin may act) and carry no single ownerId. When a TEAM_LEAD
 * or DEPT_MANAGER owner cannot be resolved the item stays "Owner needed" and a
 * CLEARANCE_OWNER_MISSING setup issue is raised; it is never treated as done.
 */

export const CLEARANCE_CATEGORIES = [
  'HANDOVER',
  'KNOWLEDGE_TRANSFER',
  'ASSETS',
  'DOCUMENTS',
  'DEPARTMENT',
  'ACCESS_SHUTDOWN',
  'FINANCIAL',
  'FINAL_DOCUMENTS',
  'ARCHIVE_READINESS',
] as const;
export type ClearanceCategory = (typeof CLEARANCE_CATEGORIES)[number];

export type OwnerCapability = 'TEAM_LEAD' | 'DEPT_MANAGER' | 'HR' | 'ADMIN';

export const CLEARANCE_DEFAULTS: Record<ClearanceCategory, { capability: OwnerCapability; evidenceRequired: boolean; label: string }> = {
  HANDOVER: { capability: 'TEAM_LEAD', evidenceRequired: false, label: 'Work handover' },
  KNOWLEDGE_TRANSFER: { capability: 'TEAM_LEAD', evidenceRequired: false, label: 'Knowledge transfer' },
  ASSETS: { capability: 'ADMIN', evidenceRequired: true, label: 'Company assets returned' },
  DOCUMENTS: { capability: 'HR', evidenceRequired: true, label: 'Documents returned' },
  DEPARTMENT: { capability: 'DEPT_MANAGER', evidenceRequired: false, label: 'Department clearance' },
  ACCESS_SHUTDOWN: { capability: 'ADMIN', evidenceRequired: true, label: 'Access shutdown' },
  FINANCIAL: { capability: 'ADMIN', evidenceRequired: true, label: 'Financial clearance' },
  FINAL_DOCUMENTS: { capability: 'HR', evidenceRequired: true, label: 'Final documents issued' },
  ARCHIVE_READINESS: { capability: 'ADMIN', evidenceRequired: false, label: 'Archive readiness' },
};

export const TERMINAL_CLEARANCE = ['DONE', 'WAIVED', 'NOT_APPLICABLE', 'CANCELLED'] as const;
/** Terminal for F&F readiness. CANCELLED appears only on a withdrawn case. */
export const SETTLED_CLEARANCE = ['DONE', 'WAIVED', 'NOT_APPLICABLE'] as const;

export function isTerminalClearance(status: string): boolean {
  return (TERMINAL_CLEARANCE as readonly string[]).includes(status);
}

/**
 * An evidence reference is an opaque internal reference such as `AST-2026-0042`
 * or `DOC-HR-311`: a prefix of capitals, a dash, then capitals, digits and
 * dashes, with at least one digit. Never a URL, an email address, a path, a
 * person's name or a raw storage key. Mirrors the SQL CHECK.
 */
export const EVIDENCE_REF_PATTERN = /^[A-Z][A-Z0-9]{1,15}-[A-Z0-9-]{3,48}$/;

export function evidenceRefProblem(ref: string): string | null {
  if (/:\/\/|@|\s|[\\/]/.test(ref)) return 'Use an internal reference, not a link, email address or file path.';
  if (!EVIDENCE_REF_PATTERN.test(ref) || !/[0-9]/.test(ref)) {
    return 'Use an internal reference such as AST-2026-0042 (capitals, digits and dashes).';
  }
  return null;
}

/** Allowed status moves for the owner path. Waive / N/A / reassign are HR/Admin only. */
export const OWNER_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['IN_PROGRESS', 'DONE'],
  IN_PROGRESS: ['DONE', 'PENDING'],
};
