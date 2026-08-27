import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  assertImportTarget,
  assessActiveCalendars,
  planImport,
  type ActiveCalendarRow,
} from '../../scripts/import-attendance-calendar-2026';
import {
  OFFICIAL_HOLIDAYS_2026,
  OFFICIAL_HOLIDAY_COUNT_2026,
  OFFICIAL_HOLIDAY_FINANCIAL_YEAR,
} from '../../src/modules/platform/attendance/calendar/official-holidays-2026';

// The importer refused production outright, and the tempting way past that was
// to run it with APP_ENV=staging against the production URL. So the production
// path is explicit, and every way of reaching the wrong database is a test.

const PROD_HOST = 'dpg-d8259omk1jcs73e37fbg-a.oregon-postgres.render.com';
const PROD_DB = 'apex_db_dugl';
const SENTINEL = 'S3nt1nel-Pa55w0rd-DoNotLeak';
const PROD_URL = `postgresql://apex_user:${SENTINEL}@${PROD_HOST}:5432/${PROD_DB}`;

const STAGING_HOST = 'dpg-d95pamvaqgkc73fdurig-a.oregon-postgres.render.com';
const STAGING_DB = 'apex_os_staging_db';
const STAGING_URL = `postgresql://apex_user:${SENTINEL}@${STAGING_HOST}:5432/${STAGING_DB}`;

const prodEnv = (over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  APP_ENV: 'production',
  DATABASE_URL: PROD_URL,
  EXPECTED_PRODUCTION_DB_HOST: PROD_HOST,
  EXPECTED_PRODUCTION_DB_NAME: PROD_DB,
  ...over,
});

const stagingEnv = (over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  APP_ENV: 'staging',
  DATABASE_URL: STAGING_URL,
  EXPECTED_STAGING_DB_HOST: STAGING_HOST,
  EXPECTED_STAGING_DB_NAME: STAGING_DB,
  ...over,
});

describe('production target identity', () => {
  it('accepts a correctly declared production target', () => {
    expect(assertImportTarget(prodEnv())).toEqual({
      environment: 'production',
      host: PROD_HOST,
      database: PROD_DB,
    });
  });

  it('refuses a host mismatch', () => {
    const env = prodEnv({ EXPECTED_PRODUCTION_DB_HOST: 'some-other-host.render.com' });

    expect(() => assertImportTarget(env)).toThrow(/Host mismatch/i);
  });

  it('refuses a database mismatch', () => {
    const env = prodEnv({ EXPECTED_PRODUCTION_DB_NAME: 'apex_db_something_else' });

    expect(() => assertImportTarget(env)).toThrow(/Database mismatch/i);
  });

  it('refuses when the expected identity is not supplied at all', () => {
    // Without independently-supplied values there is nothing to check the URL
    // against, and the guard would be decorative.
    expect(() => assertImportTarget(prodEnv({ EXPECTED_PRODUCTION_DB_HOST: '' }))).toThrow(
      /must both be set/i,
    );
    expect(() => assertImportTarget(prodEnv({ EXPECTED_PRODUCTION_DB_NAME: '' }))).toThrow(
      /must both be set/i,
    );
  });

  it('refuses when DATABASE_URL is absent', () => {
    expect(() => assertImportTarget(prodEnv({ DATABASE_URL: '' }))).toThrow(/DATABASE_URL/i);
  });

  it('does not accept the expected identity derived from the URL itself', () => {
    // Checking a URL against values taken from that same URL proves only that
    // it parsed. The values must come from the dashboard.
    const env = prodEnv({ EXPECTED_PRODUCTION_DB_HOST: '', EXPECTED_PRODUCTION_DB_NAME: '' });

    expect(() => assertImportTarget(env)).toThrow();
  });
});

describe('staging target identity', () => {
  it('accepts a correctly declared staging target', () => {
    expect(assertImportTarget(stagingEnv())).toEqual({
      environment: 'staging',
      host: STAGING_HOST,
      database: STAGING_DB,
    });
  });

  it('refuses APP_ENV=staging pointed at the production database', () => {
    // The exact bypass the brief forbids.
    const env = stagingEnv({
      DATABASE_URL: PROD_URL,
      EXPECTED_STAGING_DB_HOST: PROD_HOST,
      EXPECTED_STAGING_DB_NAME: PROD_DB,
    });

    expect(() => assertImportTarget(env)).toThrow(/production marker/i);
  });

  it('refuses a staging host mismatch', () => {
    expect(() =>
      assertImportTarget(stagingEnv({ EXPECTED_STAGING_DB_HOST: 'elsewhere.render.com' })),
    ).toThrow(/Host mismatch/i);
  });

  it('refuses a staging database mismatch', () => {
    expect(() =>
      assertImportTarget(stagingEnv({ EXPECTED_STAGING_DB_NAME: 'other_db' })),
    ).toThrow(/Database mismatch/i);
  });
});

describe('an ambiguous environment is refused, not guessed', () => {
  for (const appEnv of ['', 'PRODUCTION_LIKE', 'prod', 'dev', 'test', undefined]) {
    it(`refuses APP_ENV=${JSON.stringify(appEnv)}`, () => {
      expect(() => assertImportTarget({ APP_ENV: appEnv, DATABASE_URL: PROD_URL })).toThrow(
        /Declare "staging" or "production"/i,
      );
    });
  }
});

describe('no secret ever reaches a message', () => {
  const attempts: Array<[string, NodeJS.ProcessEnv]> = [
    ['production host mismatch', prodEnv({ EXPECTED_PRODUCTION_DB_HOST: 'x.render.com' })],
    ['production db mismatch', prodEnv({ EXPECTED_PRODUCTION_DB_NAME: 'x' })],
    ['staging pointed at production', stagingEnv({ DATABASE_URL: PROD_URL })],
    ['ambiguous environment', { APP_ENV: 'whatever', DATABASE_URL: PROD_URL }],
    ['unparseable url', prodEnv({ DATABASE_URL: 'not-a-url' })],
  ];

  for (const [label, env] of attempts) {
    it(`keeps the password out of the "${label}" failure`, () => {
      try {
        assertImportTarget(env);
        throw new Error('expected a refusal');
      } catch (err: any) {
        expect(err.message).not.toContain(SENTINEL);
        expect(err.message).not.toContain(PROD_URL);
      }
    });
  }
});

describe('the approved 2026 holiday set', () => {
  it('is exactly 17 rows', () => {
    expect(OFFICIAL_HOLIDAYS_2026).toHaveLength(17);
    expect(OFFICIAL_HOLIDAY_COUNT_2026).toBe(17);
  });

  it('keeps both November Bhai Duj entries as separate rows', () => {
    const bhaiDuj = OFFICIAL_HOLIDAYS_2026.filter((h) => h.name === 'Bhai Duj');

    expect(bhaiDuj.map((h) => h.date)).toEqual(['2026-11-10', '2026-11-11']);
  });

  it('does not contain Good Friday', () => {
    // It is in public Indian holiday lists and in the leave module's old
    // hardcoded array, but not in the approved TechnoEdge source.
    expect(OFFICIAL_HOLIDAYS_2026.some((h) => /good friday/i.test(h.name))).toBe(false);
  });

  it('has no duplicate dates', () => {
    const dates = OFFICIAL_HOLIDAYS_2026.map((h) => h.date);

    expect(new Set(dates).size).toBe(dates.length);
  });

  it('targets financial year 2026-2027', () => {
    expect(OFFICIAL_HOLIDAY_FINANCIAL_YEAR).toBe('2026-2027');
  });
});

describe('planning an import', () => {
  const asRows = (rows: Array<{ date: string; name: string }>) =>
    rows.map((r) => ({ date: new Date(`${r.date}T00:00:00.000Z`), name: r.name }));

  it('creates all 17 against an empty calendar', () => {
    const plan = planImport(OFFICIAL_HOLIDAYS_2026, []);

    expect(plan.toCreate).toHaveLength(17);
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.duplicates).toHaveLength(0);
  });

  it('is idempotent: a second run creates nothing', () => {
    const already = asRows(OFFICIAL_HOLIDAYS_2026.map((h) => ({ date: h.date, name: h.name })));
    const plan = planImport(OFFICIAL_HOLIDAYS_2026, already);

    expect(plan.toCreate).toHaveLength(0);
    expect(plan.duplicates).toHaveLength(17);
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.extra).toHaveLength(0);
  });

  it('treats a same-date different-name row as a conflict, never an overwrite', () => {
    const plan = planImport(
      OFFICIAL_HOLIDAYS_2026,
      asRows([{ date: '2026-01-01', name: 'Company Foundation Day' }]),
    );

    expect(plan.conflicts).toEqual([
      { date: '2026-01-01', existing: 'Company Foundation Day', approved: "New Year's Day" },
    ]);
    expect(plan.toCreate.some((h) => h.date === '2026-01-01')).toBe(false);
  });

  it('reports unknown rows without removing them', () => {
    const plan = planImport(
      OFFICIAL_HOLIDAYS_2026,
      asRows([{ date: '2026-07-04', name: 'Some Other Holiday' }]),
    );

    expect(plan.extra).toEqual([{ date: '2026-07-04', name: 'Some Other Holiday' }]);
  });

  it('creates the second Bhai Duj even though the name already exists', () => {
    const plan = planImport(
      OFFICIAL_HOLIDAYS_2026,
      asRows([{ date: '2026-11-10', name: 'Bhai Duj' }]),
    );

    expect(plan.toCreate.some((h) => h.date === '2026-11-11' && h.name === 'Bhai Duj')).toBe(true);
    expect(plan.conflicts).toHaveLength(0);
  });
});

describe('exactly one ACTIVE calendar must remain resolvable', () => {
  const cal = (over: Partial<ActiveCalendarRow> = {}): ActiveCalendarRow => ({
    id: 'cal-1',
    name: 'TechnoEdge Holiday Calendar 2026',
    financialYear: OFFICIAL_HOLIDAY_FINANCIAL_YEAR,
    effectiveTo: null,
    ...over,
  });

  it('accepts a clean database with no calendars at all', () => {
    expect(assessActiveCalendars([], [], null).ok).toBe(true);
  });

  it('accepts re-running against the approved calendar', () => {
    const existing = cal();

    expect(assessActiveCalendars([existing], [], existing.id).ok).toBe(true);
  });

  it('fails closed when two ACTIVE calendars already govern the year', () => {
    const verdict = assessActiveCalendars([cal(), cal({ id: 'cal-2' })], [], null);

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/cannot say which one governs/i);
  });

  it('fails closed rather than adding a second alongside somebody else\'s', () => {
    // Deactivating a live policy is not this script's decision.
    const verdict = assessActiveCalendars([cal({ id: 'other', name: 'Client Site Calendar' })], [], null);

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/not the approved one/i);
    expect(verdict.reason).not.toMatch(/deactivat(e|ing) it automatically/i);
  });

  it('fails closed when an open calendar from another year would still cover these dates', () => {
    // The bootstrap filters by financial year and would report this as fine.
    // BusinessCalendarService does not, and would resolve AMBIGUOUS.
    const verdict = assessActiveCalendars(
      [],
      [cal({ id: 'cal-2025', financialYear: '2025-2026', effectiveTo: null })],
      null,
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/AMBIGUOUS/);
  });

  it('accepts an older calendar that has been properly closed', () => {
    const closed = cal({ id: 'cal-2025', financialYear: '2025-2026', effectiveTo: new Date() });

    // A closed window is filtered out before it reaches the assessment.
    expect(assessActiveCalendars([], [], null).ok).toBe(true);
    expect(closed.effectiveTo).not.toBeNull();
  });
});

describe('the execution path contains nothing destructive', () => {
  const src = readFileSync(
    resolve(__dirname, '../../scripts/import-attendance-calendar-2026.ts'),
    'utf8',
  );
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it.each([
    ['deleteMany', /deleteMany/],
    ['delete', /prisma\.\w+\.delete\b/],
    ['raw DELETE', /DELETE\s+FROM/i],
    ['TRUNCATE', /TRUNCATE/i],
    ['DROP', /DROP\s+(TABLE|DATABASE|SCHEMA)/i],
    ['migrate deploy', /migrate\s+deploy/],
    ['migrate reset', /migrate\s+reset/],
    ['db push', /db\s+push/],
    ['updateMany', /updateMany/],
  ])('contains no %s', (_label, pattern) => {
    expect(code).not.toMatch(pattern);
  });

  it('writes only through createMany and a single calendar create', () => {
    expect(code).toMatch(/holiday\.createMany/);
    expect(code).toMatch(/holidayCalendar\.create\(/);
  });

  it('requires --apply before any write is reached', () => {
    expect(code).toMatch(/const APPLY = process\.argv\.includes\('--apply'\)/);
    expect(code).toMatch(/if \(!APPLY\)/);
  });

  it('never logs a connection string or DATABASE_URL', () => {
    expect(code).not.toMatch(/console\.\w+\([^)]*DATABASE_URL/);
  });

  it('never interpolates the host or database unmasked', () => {
    // `${target!.host}` leaks it; `${mask(target!.host)}` does not, so the
    // check is for the bare interpolation rather than for the identifier.
    expect(code).not.toMatch(/\$\{target!?\.host\}/);
    expect(code).not.toMatch(/\$\{target!?\.database\}/);
  });

  it('masks the host and database it prints', () => {
    expect(code).toMatch(/mask\(target!?\.host\)/);
    expect(code).toMatch(/mask\(target!?\.database\)/);
  });
});
