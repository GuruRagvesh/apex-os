/**
 * A raw-SQL double that refuses what PostgreSQL refuses.
 *
 * WHY THIS EXISTS
 *
 * `lockAttendanceMonth()` was written as:
 *
 *     await tx.$queryRaw`SELECT pg_advisory_xact_lock(...)`
 *
 * Seventy-one unit tests and eighteen surviving mutations agreed it worked.
 * Against a real database it throws EVERY time: pg_advisory_xact_lock() returns
 * void, $queryRaw reads the result set back, and Prisma cannot deserialize a
 * void column. PostgreSQL takes the lock, Prisma then fails, the transaction
 * rolls back, and the lock is released -- so the one function serializing
 * attendance corrections against the payroll close protected nothing.
 *
 * A `jest.fn().mockResolvedValue([])` answers any statement cheerfully, which
 * is exactly how a function that always throws passed for a working one. The
 * problem was never the coverage; it was that the double was more agreeable
 * than the thing it stood in for.
 *
 * So this double carries the one rule that matters here: a statement whose
 * result cannot be deserialized must be sent with $executeRaw, and asking for
 * its rows is an error. Reach for it wherever a test needs raw SQL.
 */

/** Functions returning void. Prisma cannot deserialize any of them. */
const VOID_RETURNING = [
  'pg_advisory_xact_lock',
  'pg_advisory_lock',
  'pg_advisory_unlock_all',
  'pg_notify',
];

/** Rebuilds the statement from a tagged-template call or a plain string. */
export function sqlTextOf(args: any[]): string {
  const first = args[0];
  if (typeof first === 'string') return first;
  if (first && Array.isArray(first.strings)) return first.strings.join('?');
  if (Array.isArray(first)) return first.join('?');
  if (first && typeof first.sql === 'string') return first.sql;
  return String(first ?? '');
}

export interface RawSqlDouble {
  $queryRaw: jest.Mock;
  $queryRawUnsafe: jest.Mock;
  $executeRaw: jest.Mock;
  $executeRawUnsafe: jest.Mock;
  /** Every statement sent, in order, whichever method sent it. */
  statements: string[];
  /** Just the ones sent through $executeRaw / $executeRawUnsafe. */
  executed: any[][];
}

export function makeRawSqlDouble(
  queryResult: (sql: string, args: any[]) => any = () => [],
): RawSqlDouble {
  const statements: string[] = [];
  const executed: any[][] = [];

  const query = jest.fn((...args: any[]) => {
    const sql = sqlTextOf(args);
    statements.push(sql);
    const offender = VOID_RETURNING.find((fn) => sql.includes(fn));
    if (offender) {
      // The real message, near enough to be recognised in a failure.
      return Promise.reject(
        new Error(
          `Raw query failed. Message: "Failed to deserialize column of type 'void'." ` +
            `${offender}() returns void -- send it with $executeRaw, not $queryRaw.`,
        ),
      );
    }
    return Promise.resolve(queryResult(sql, args.slice(1)));
  });

  const execute = jest.fn((...args: any[]) => {
    statements.push(sqlTextOf(args));
    executed.push(args);
    return Promise.resolve(1);
  });

  return {
    $queryRaw: query,
    $queryRawUnsafe: query,
    $executeRaw: execute,
    $executeRawUnsafe: execute,
    statements,
    executed,
  };
}
