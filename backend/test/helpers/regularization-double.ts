/**
 * A correction-lookup double that filters and orders the way PostgreSQL does.
 *
 * WHY NOT jest.fn().mockResolvedValue([theRowIWant])
 *
 * Because then the test supplies the answer. The evaluator's choice of WHICH
 * approved correction governs a day is exactly the thing under test: it filters
 * on status, orders on a nullable timestamp, and breaks ties. A double that
 * returns a fixed row proves none of that, and would pass just as happily with
 * the status filter deleted or the ordering reversed.
 *
 * So this one honours `where`, honours `orderBy` INCLUDING null placement, and
 * honours `take`. PostgreSQL's default is the part worth being careful about:
 * DESC puts NULLs FIRST, ASC puts them LAST — the opposite of what most people
 * assume, and the reason this helper exists at all.
 */

type Row = Record<string, any>;

/**
 * Prisma's `where` subset these queries actually use.
 *
 * Scoping is OPT-IN. A store holds the corrections for one employee-day, so a
 * fixture that does not model `userId` or `date` is not re-filtered on them --
 * a row simply has to define a field for that field to be checked. Tests about
 * scoping define those fields (and the PostgreSQL suites use real rows, where
 * every field exists); tests about WHICH correction governs leave them out and
 * stay about that.
 */
function matchesWhere(row: Row, where: Row = {}): boolean {
  for (const [field, condition] of Object.entries(where)) {
    if (!(field in row)) continue;
    const value = row[field];
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      if ('in' in condition && !(condition as any).in.includes(value)) return false;
      if ('not' in condition) {
        const not = (condition as any).not;
        if (not === null && (value === null || value === undefined)) return false;
        if (not !== null && value === not) return false;
      }
      continue;
    }
    if (condition instanceof Date) {
      if (!(value instanceof Date) || value.getTime() !== condition.getTime()) return false;
      continue;
    }
    if (value !== condition) return false;
  }
  return true;
}

interface SortKey {
  field: string;
  desc: boolean;
  nullsLast: boolean;
}

function toSortKeys(orderBy: any): SortKey[] {
  if (!orderBy) return [];
  const list = Array.isArray(orderBy) ? orderBy : [orderBy];
  return list.map((entry) => {
    const [field, spec] = Object.entries(entry)[0] as [string, any];
    if (typeof spec === 'string') {
      const desc = spec === 'desc';
      // PostgreSQL's default: DESC => NULLS FIRST, ASC => NULLS LAST.
      return { field, desc, nullsLast: !desc };
    }
    const desc = spec.sort === 'desc';
    return {
      field,
      desc,
      nullsLast: spec.nulls ? spec.nulls === 'last' : !desc,
    };
  });
}

function compare(a: Row, b: Row, keys: SortKey[]): number {
  for (const key of keys) {
    const av = a[key.field] ?? null;
    const bv = b[key.field] ?? null;

    if (av === null && bv === null) continue;
    if (av === null) return key.nullsLast ? 1 : -1;
    if (bv === null) return key.nullsLast ? -1 : 1;

    const an = av instanceof Date ? av.getTime() : av;
    const bn = bv instanceof Date ? bv.getTime() : bv;
    if (an === bn) continue;
    const order = an < bn ? -1 : 1;
    return key.desc ? -order : order;
  }
  return 0;
}

/**
 * Builds `findMany` / `findFirst` over a fixed set of rows.
 *
 * The rows are given in whatever order the test likes; the double sorts them,
 * so a test cannot accidentally get the right answer by listing them well.
 */
export function correctionStore(rows: Row[] = []) {
  const findMany = jest.fn(async (args: any = {}) => {
    const matched = rows.filter((row) => matchesWhere(row, args.where));
    const sorted = [...matched].sort((a, b) => compare(a, b, toSortKeys(args.orderBy)));
    return args.take ? sorted.slice(0, args.take) : sorted;
  });

  const findFirst = jest.fn(async (args: any = {}) => (await findMany(args))[0] ?? null);

  return { rows, findMany, findFirst };
}
