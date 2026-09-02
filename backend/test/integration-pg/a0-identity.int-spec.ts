/**
 * Items 1-2: the database says who it is, and the harness stands up.
 *
 * Runs first (a0) so that if the connection is wrong, nothing else has had a
 * chance to write to it.
 */

import { buildHarness, Harness, seedCompany } from './harness';
import { assertIsolatedDatabase } from './db-guard';

describe('the isolated integration database', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await buildHarness();
  });

  afterAll(async () => {
    await h?.close();
  });

  it('1. is positively identified by the server, not by the connection string', () => {
    expect(h.identity.db).toBe('apex_os_attendance_integration');
    expect(h.identity.addr).toBe('127.0.0.1');
    // Not the default port: this cluster was created for this run.
    expect(h.identity.port).toBe('55432');
  });

  it('2. is PostgreSQL 18', () => {
    expect(h.identity.ver).toMatch(/PostgreSQL 18\./);
  });

  it('3. refuses a hosted, staging or non-loopback database', () => {
    const refused = [
      'postgresql://u:p@dpg-abc.oregon-postgres.render.com/apex_os_attendance_integration',
      'postgresql://u:p@10.0.0.5:5432/apex_os_attendance_integration',
      'postgresql://u:p@127.0.0.1:5432/apex_production',
      // The subtle one: a real local working database is not a test database.
      'postgresql://u:p@127.0.0.1:5432/nexus_app',
    ];
    for (const url of refused) {
      expect(() => assertIsolatedDatabase(url)).toThrow();
    }
    expect(() =>
      assertIsolatedDatabase('postgresql://apex_test@127.0.0.1:55432/apex_os_attendance_integration'),
    ).not.toThrow();
  });

  it('4. never puts the connection string in the error it throws', () => {
    try {
      assertIsolatedDatabase('postgresql://someone:hunter2@db.production.example.com/x');
      throw new Error('should have refused');
    } catch (error: any) {
      expect(error.message).not.toContain('hunter2');
    }
  });

  it('5. seeds a complete synthetic company', async () => {
    const seed = await seedCompany(h.prisma);
    expect(Object.keys(seed.employees)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);

    const users = await h.prisma.user.count();
    expect(users).toBe(9); // three actors plus six employees

    const profiles = await h.prisma.employeeAttendanceProfile.count();
    expect(profiles).toBe(9);
  });
});
