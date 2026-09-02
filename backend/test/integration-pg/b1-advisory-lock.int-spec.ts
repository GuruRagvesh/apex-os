/**
 * Items 11-13: the advisory lock, proven by PostgreSQL rather than by reading
 * the source.
 *
 * Up to Phase 5C, "the correction path and the payroll close path serialize"
 * was a claim supported by both call sites appearing to call the same helper.
 * That is an argument about code. This suite makes PostgreSQL settle it: a
 * competing session takes the month lock and holds it, the real service path
 * is then started, and pg_locks is read to see whether the real path is
 * actually waiting on the same lock object.
 *
 * A test that merely called lockAttendanceMonth() twice would prove only that
 * pg_advisory_xact_lock blocks, which nobody doubted.
 */

import { PrismaClient } from '@prisma/client';
import {
  buildHarness,
  Harness,
  rawClient,
  seedCompany,
  Seed,
  givenAttendance,
  DATE,
  MONTH,
} from './harness';
import { monthLockKey } from '../../src/modules/platform/attendance/evaluation/attendance-month-lock';

const NAMESPACE = 4271;
const KEY = monthLockKey(MONTH); // 202608

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Everything PostgreSQL will say about who holds or wants this month lock. */
async function lockRows(client: PrismaClient) {
  return client.$queryRawUnsafe<any[]>(
    `SELECT l.pid, l.granted, l.classid, l.objid, a.state,
            left(coalesce(a.query, ''), 60) AS query
     FROM pg_locks l
     LEFT JOIN pg_stat_activity a ON a.pid = l.pid
     WHERE l.locktype = 'advisory' AND l.classid = ${NAMESPACE} AND l.objid = ${KEY}
     ORDER BY l.granted DESC, l.pid`,
  );
}

/** Waits until a predicate over pg_locks holds, or gives up. */
async function until(
  client: PrismaClient,
  predicate: (rows: any[]) => boolean,
  timeoutMs = 15000,
): Promise<any[]> {
  const deadline = Date.now() + timeoutMs;
  let rows: any[] = [];
  while (Date.now() < deadline) {
    rows = await lockRows(client);
    if (predicate(rows)) return rows;
    await sleep(120);
  }
  return rows;
}

describe('the attendance month advisory lock, observed in pg_locks', () => {
  let h: Harness;
  let seed: Seed;
  let holder: PrismaClient;
  let observer: PrismaClient;

  beforeAll(async () => {
    h = await buildHarness();
    // Two more connections. The holder blocks; the observer must stay free to
    // read pg_locks while everything else is stuck, which it cannot do if it
    // shares a connection with either party.
    holder = rawClient();
    observer = rawClient();
    await holder.$connect();
    await observer.$connect();
  });

  afterAll(async () => {
    await holder?.$disconnect();
    await observer?.$disconnect();
    await h?.close();
  });

  beforeEach(async () => {
    seed = await seedCompany(h.prisma);
  });

  it('19a. maps the month to the documented lock key', () => {
    expect(KEY).toBe(202608);
  });

  it('19b. a held month lock is visible, and a competing request waits for it', async () => {
    // ── Session A takes the lock and holds it ──────────────────────────────
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const sessionA = holder.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${NAMESPACE}, ${KEY})`);
        await gate;
        return 'A committed';
      },
      { timeout: 60000 },
    );

    const held = await until(observer, (rows) => rows.some((r) => r.granted));
    expect(held.length).toBe(1);
    expect(held[0].granted).toBe(true);
    expect(Number(held[0].classid)).toBe(NAMESPACE);
    expect(Number(held[0].objid)).toBe(KEY);

    // ── Session B asks for the same lock, on its own connection ───────────
    let bDone = false;
    const contender = rawClient();
    await contender.$connect();
    const sessionB = contender
      .$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${NAMESPACE}, ${KEY})`);
          bDone = true;
        },
        { timeout: 60000 },
      )
      .finally(() => contender.$disconnect());

    // PostgreSQL now shows two rows for this one lock object: one granted,
    // one not. That ungranted row IS the contention.
    const contended = await until(observer, (rows) => rows.length === 2 && rows.some((r) => !r.granted));
    expect(contended.length).toBe(2);
    expect(contended.filter((r) => r.granted)).toHaveLength(1);
    expect(contended.filter((r) => !r.granted)).toHaveLength(1);

    // Still waiting, definitively: not merely slow.
    expect(bDone).toBe(false);
    await sleep(500);
    expect(bDone).toBe(false);

    // ── A commits, B proceeds ─────────────────────────────────────────────
    release();
    await expect(sessionA).resolves.toBe('A committed');
    await sessionB;
    expect(bDone).toBe(true);

    // And nothing is left holding it.
    const after = await until(observer, (rows) => rows.length === 0);
    expect(after).toHaveLength(0);
  });

  it('20. the REAL correction path waits on that same lock', async () => {
    // Not a hand-rolled lock call: the actual evaluator entry point the apply
    // service uses. If it stopped taking the month lock, this test would see
    // it finish while another session held the month.
    const emp = seed.employees.A;
    await givenAttendance(h.prisma, emp.id, DATE);
    const reg = await h.prisma.attendanceRegularization.create({
      data: {
        userId: emp.id,
        date: new Date(`${DATE}T00:00:00.000Z`),
        requestType: 'MISSING_PUNCH',
        reason: 'Integration lock probe correction',
        requestedPunchOut: new Date(`${DATE}T13:45:00.000Z`),
        status: 'HR_APPROVED',
      } as any,
    });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = holder.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${NAMESPACE}, ${KEY})`);
        await gate;
      },
      { timeout: 60000 },
    );
    await until(observer, (rows) => rows.some((r) => r.granted));

    // Now start the real correction. It must not complete.
    let corrected = false;
    const correction = h.prisma
      .$transaction(
        async (tx) => {
          await h.evaluator.reviseForApprovedCorrection(tx as any, emp.id, DATE, reg.id, {
            authority: 'BULK_IMPORT',
          });
          corrected = true;
        },
        { timeout: 60000 },
      )
      .catch((e) => {
        corrected = true;
        throw e;
      });

    const contended = await until(observer, (rows) => rows.length >= 2);
    expect(contended.length).toBeGreaterThanOrEqual(2);
    expect(contended.some((r) => !r.granted)).toBe(true);
    expect(corrected).toBe(false);

    release();
    await blocker;
    await correction;
    expect(corrected).toBe(true);

    // The correction genuinely happened once the lock was free.
    const after = await h.prisma.dailyAttendance.findFirst({
      where: { userId: emp.id, date: new Date(`${DATE}T00:00:00.000Z`) },
    });
    expect(after?.punchOutAt?.toISOString()).toBe(new Date(`${DATE}T13:45:00.000Z`).toISOString());
    expect(after?.revision).toBe(2);
  });

  it('21. a correction for a DIFFERENT month does not wait', async () => {
    // The lock must be per month. One keyed on something coarser would make
    // every import serialize against every close in the company, and a test
    // that only ever proves blocking would never notice.
    const emp = seed.employees.B;
    const otherDate = '2026-09-11';
    await givenAttendance(h.prisma, emp.id, otherDate);
    const reg = await h.prisma.attendanceRegularization.create({
      data: {
        userId: emp.id,
        date: new Date(`${otherDate}T00:00:00.000Z`),
        requestType: 'MISSING_PUNCH',
        reason: 'Integration different-month probe',
        requestedPunchOut: new Date(`${otherDate}T13:45:00.000Z`),
        status: 'HR_APPROVED',
      } as any,
    });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = holder.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${NAMESPACE}, ${KEY})`);
        await gate;
      },
      { timeout: 60000 },
    );
    await until(observer, (rows) => rows.some((r) => r.granted));

    // August is locked; this is September, and it must sail straight through.
    await h.prisma.$transaction(
      async (tx) => {
        await h.evaluator.reviseForApprovedCorrection(tx as any, emp.id, otherDate, reg.id, {
          authority: 'BULK_IMPORT',
        });
      },
      { timeout: 60000 },
    );

    const after = await h.prisma.dailyAttendance.findFirst({
      where: { userId: emp.id, date: new Date(`${otherDate}T00:00:00.000Z`) },
    });
    expect(after?.revision).toBe(2);

    release();
    await blocker;
  });
});
