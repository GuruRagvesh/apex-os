/**
 * Which databases the September recovery tool may read and compare. Pure: no I/O,
 * no clock (the caller passes the company date). Refuses before any database is
 * opened.
 *
 *   TARGET   exactly the ACTIVE staging database (reuses the exact host id /
 *            exact database name guard of the staging migration helper).
 *            Production and legacy staging are recognised and refused by name.
 *   SOURCE   a disposable database on THIS machine, restored from a backup.
 *            Never a hosted database of any kind.
 *   RANGE    historical business dates only; today and yesterday are refused.
 *   MODE     dry run only. There is no apply path in this build.
 */
import { checkStagingIdentity, type StagingRefusal } from '../staging-recovery-migrate';
import { dayWindow } from '../../src/modules/platform/attendance/recovery/safety-window';

export type TargetRefusal =
  | StagingRefusal
  | 'SOURCE_NOT_SET'
  | 'SOURCE_MALFORMED'
  | 'SOURCE_NOT_POSTGRESQL'
  | 'SOURCE_NOT_LOCAL'
  | 'SOURCE_NOT_DISPOSABLE'
  | 'DATES_MISSING'
  | 'DATES_INVALID'
  | 'DATE_RANGE_INVERTED'
  | 'DATE_RANGE_TOO_LONG'
  | 'DATE_NOT_HISTORICAL'
  | 'DRY_RUN_INVALID'
  | 'APPLY_NOT_AVAILABLE';

export interface RecoveryTargets {
  ok: boolean;
  code?: TargetRefusal;
  reason?: string;
  staging?: { host: string; database: string };
  source?: { host: string; database: string };
  from?: string;
  to?: string;
}

export const MAX_RANGE_DAYS = 93;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
/** The restore-test convention: a local database that says it is disposable. */
const DISPOSABLE_SOURCE_DB = /^apex_restore_test(_[a-z0-9]+)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const realDate = (s: string) => {
  const d = new Date(`${s}T00:00:00.000Z`);
  return DATE_RE.test(s) && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(`${b}T00:00:00.000Z`).getTime() - new Date(`${a}T00:00:00.000Z`).getTime()) / 86_400_000);

export function checkSourceUrl(raw: string | undefined): { ok: boolean; code?: TargetRefusal; reason?: string; host?: string; database?: string } {
  const refuse = (code: TargetRefusal, reason: string) => ({ ok: false, code, reason });
  if (!raw) return refuse('SOURCE_NOT_SET', 'SOURCE_DATABASE_URL is not set');
  let u: URL;
  try { u = new URL(raw); } catch { return refuse('SOURCE_MALFORMED', 'SOURCE_DATABASE_URL is not a valid URL'); }
  if (!/^postgres(ql)?:$/.test(u.protocol)) return refuse('SOURCE_NOT_POSTGRESQL', 'source is not a PostgreSQL URL');
  const host = u.hostname.toLowerCase();
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!LOCAL_HOSTS.has(host)) return refuse('SOURCE_NOT_LOCAL', 'the source must be a database on this machine, never a hosted one');
  if (!DISPOSABLE_SOURCE_DB.test(database)) {
    return refuse('SOURCE_NOT_DISPOSABLE', 'the source database must be named apex_restore_test (or apex_restore_test_<suffix>)');
  }
  return { ok: true, host, database };
}

export function checkRecoveryTargets(env: NodeJS.ProcessEnv, companyToday: string): RecoveryTargets {
  const refuse = (code: TargetRefusal, reason: string, extra: Partial<RecoveryTargets> = {}): RecoveryTargets =>
    ({ ok: false, code, reason, ...extra });

  const target = checkStagingIdentity(env.STAGING_DATABASE_URL, env.APP_ENV);
  if (!target.ok) {
    return refuse(target.code!, target.reason!, target.host && target.database ? { staging: { host: target.host, database: target.database } } : {});
  }
  const staging = { host: target.host!, database: target.database! };

  const source = checkSourceUrl(env.SOURCE_DATABASE_URL);
  if (!source.ok) return refuse(source.code!, source.reason!, { staging });

  const from = (env.FROM_DATE ?? '').trim();
  const to = (env.TO_DATE ?? '').trim();
  if (!from || !to) return refuse('DATES_MISSING', 'FROM_DATE and TO_DATE are both required (YYYY-MM-DD)', { staging });
  if (!realDate(from) || !realDate(to)) return refuse('DATES_INVALID', 'FROM_DATE and TO_DATE must be real YYYY-MM-DD dates', { staging });
  if (from > to) return refuse('DATE_RANGE_INVERTED', 'FROM_DATE is after TO_DATE', { staging });
  if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) return refuse('DATE_RANGE_TOO_LONG', `range is longer than ${MAX_RANGE_DAYS} days`, { staging });
  // Open and still-settling days are never recovery material.
  if (dayWindow(to, companyToday) !== 'HISTORICAL') {
    return refuse('DATE_NOT_HISTORICAL', 'TO_DATE must be at least two days before today: open and settling days are refused', { staging });
  }

  const mode = (env.DRY_RUN ?? 'true').trim().toLowerCase();
  if (mode !== 'true' && mode !== 'false') return refuse('DRY_RUN_INVALID', 'DRY_RUN must be "true" or "false"', { staging });
  if (mode === 'false') return refuse('APPLY_NOT_AVAILABLE', 'this build has no write path; only a dry run exists', { staging });

  return { ok: true, staging, source: { host: source.host!, database: source.database! }, from, to };
}
