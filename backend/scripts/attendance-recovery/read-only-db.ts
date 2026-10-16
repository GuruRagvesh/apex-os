/**
 * The only database access the September recovery tooling has.
 *
 * `ReadOnlyDb` has ONE method, `findMany`. There is no create, update, upsert,
 * delete, transaction or raw query on it, so a caller holding a ReadOnlyDb
 * cannot write by construction. Every read also names its columns: a restored
 * backup can predate columns the current Prisma schema has added, and an
 * implicit "all columns" query would fail on exactly the database we most need
 * to read.
 */
import { PrismaClient } from '@prisma/client';

/** Models the tool may read. Anything else is refused. */
export const READABLE_MODELS = [
  'user',
  'department',
  'attendancePolicy',
  'shiftPolicy',
  'holidayCalendar',
  'dailyAttendance',
  'workSession',
  'breakLog',
  'attendancePunchEvidence',
  'attendanceRegularization',
  'leaveRequest',
  'weeklyOffPolicy',
  'holiday',
  'businessDayOverride',
  'employeeAttendanceProfile',
  'attendanceLocation',
  'attendanceMonthClose',
  'attendanceRecoveryTombstone',
] as const;

export type ReadableModel = (typeof READABLE_MODELS)[number];

export interface ReadArgs {
  select: Record<string, true>;
  where?: Record<string, unknown>;
}

export interface ReadOnlyDb {
  findMany(model: ReadableModel, args: ReadArgs): Promise<any[]>;
}

/** Wraps anything with Prisma-shaped delegates. Exposed so tests can supply a fake client. */
export function readOnlyFrom(client: Record<string, any>): ReadOnlyDb {
  return {
    async findMany(model, args) {
      if (!(READABLE_MODELS as readonly string[]).includes(model)) {
        throw new Error(`refused: model "${String(model)}" is not readable by this tool`);
      }
      if (!args || !args.select || Object.keys(args.select).length === 0) {
        throw new Error('refused: a read must name its columns (explicit select)');
      }
      return client[model].findMany(args);
    },
  };
}

export function openReadOnlyDb(url: string): { db: ReadOnlyDb; close: () => Promise<void> } {
  const client = new PrismaClient({ datasources: { db: { url } }, log: [] });
  return { db: readOnlyFrom(client as unknown as Record<string, any>), close: () => client.$disconnect() };
}
