/**
 * Numerically equivalent TE employee codes (spec §2.3), as a pure function.
 *
 * "Well-formed" is ^TE-[0-9]{1,9}$, case-sensitive, read numerically, so
 * TE-014 and TE-14 are the same number. Malformed spellings (te-5, TE_7, TE-,
 * EMP-9) and TE-0 are ignored, exactly like the migration's ledger seed.
 */

export const WELL_FORMED = /^TE-([0-9]{1,9})$/;

export interface CodeSource {
  source: 'users' | 'attendance_import_rows';
  code: string;
  /** The user holding the code (users only). */
  userId?: string | null;
}

export interface EquivalenceGroup {
  number: number;
  spellings: { code: string; users: number; importRows: number }[];
  distinctUsers: number;
  /** True when two different users hold this number: the migration refuses to run. */
  blocksMigration: boolean;
}

export function equivalenceGroups(rows: CodeSource[]): EquivalenceGroup[] {
  const byNumber = new Map<number, { spellings: Map<string, { users: number; importRows: number }>; userIds: Set<string> }>();
  for (const r of rows) {
    const m = WELL_FORMED.exec(r.code);
    if (!m) continue;
    const n = Number(m[1]);
    if (n <= 0) continue;
    const g = byNumber.get(n) ?? { spellings: new Map(), userIds: new Set<string>() };
    const s = g.spellings.get(r.code) ?? { users: 0, importRows: 0 };
    if (r.source === 'users') {
      s.users++;
      if (r.userId) g.userIds.add(r.userId);
    } else s.importRows++;
    g.spellings.set(r.code, s);
    byNumber.set(n, g);
  }
  return [...byNumber.entries()]
    .filter(([, g]) => g.spellings.size > 1 || g.userIds.size > 1)
    .map(([number, g]) => ({
      number,
      spellings: [...g.spellings.entries()].map(([code, c]) => ({ code, ...c })).sort((a, b) => a.code.localeCompare(b.code)),
      distinctUsers: g.userIds.size,
      blocksMigration: g.userIds.size > 1,
    }))
    .sort((a, b) => a.number - b.number);
}
