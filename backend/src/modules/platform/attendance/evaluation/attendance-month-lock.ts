/**
 * One month-level lock that attendance corrections and the payroll close both
 * take, so they cannot run past each other.
 *
 * WHY NOT LOCK THE AttendanceMonthClose ROW
 *
 * Because it frequently does not exist. A month has no close row until somebody
 * previews or finalizes it, and `SELECT ... FOR UPDATE` on a row that is not
 * there locks nothing at all -- two transactions both read "no close row",
 * both conclude the month is open, and both proceed. That is the classic
 * phantom, and row locking cannot express it.
 *
 * finalize() creates the row with an upsert, so the row's absence is exactly
 * the window that needs protecting. An advisory lock is keyed by a value rather
 * than a row, so it works before the row exists, and PostgreSQL releases an
 * xact-scoped advisory lock automatically when the transaction ends -- on
 * commit, on rollback, and on a dropped connection.
 *
 * WHAT IT SERIALIZES
 *
 *   reviseForApprovedCorrection()   the only writer of an official revision
 *   payrollReport.finalize()        month -> FINALIZED + report fingerprint
 *   payrollReport.send()            report delivered, month -> SENT
 *
 * All three take this lock for the month they concern. Two months never block
 * each other.
 *
 * DEADLOCK
 *
 * The correction path takes its row locks (regularization, then the attendance
 * day) before this one; the close path takes only this one. There is no cycle
 * because no transaction takes this lock and then waits on a row lock the close
 * path holds -- the close path holds no row locks while waiting.
 */

/**
 * Namespace for attendance-month locks, so a key cannot collide with an
 * advisory lock taken elsewhere for an unrelated reason. Arbitrary but fixed.
 */
const ATTENDANCE_MONTH_LOCK_NAMESPACE = 4271;

/**
 * `2026-08` -> 202608.
 *
 * Deliberately readable rather than hashed: this value shows up in pg_locks
 * during an incident, and "202608" answers which month is blocked without
 * anybody having to reverse a hash.
 */
export function monthLockKey(month: string): number {
  const [year, mon] = month.split('-').map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(mon) || mon < 1 || mon > 12) {
    throw new Error(`Cannot lock an unparseable month: ${month}`);
  }
  return year * 100 + mon;
}

/**
 * Blocks until this transaction owns the month.
 *
 * Must be called INSIDE an interactive transaction -- an xact-scoped advisory
 * lock taken outside one is released immediately and protects nothing.
 */
export async function lockAttendanceMonth(tx: any, month: string): Promise<void> {
  const key = monthLockKey(month);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${ATTENDANCE_MONTH_LOCK_NAMESPACE}::int, ${key}::int)`;
}

export const MONTH_LOCK_NAMESPACE_FOR_TEST = ATTENDANCE_MONTH_LOCK_NAMESPACE;
