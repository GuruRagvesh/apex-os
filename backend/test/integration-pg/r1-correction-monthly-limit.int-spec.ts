/**
 * Monthly correction limits under simultaneous submissions.
 *
 * The unit suite proves the count is compared with the right limit. It cannot
 * prove that two requests arriving together do not both read the same count:
 * that is a property of PostgreSQL transactions and the advisory lock, so it
 * is settled here against a real server. Submissions are spread over several
 * independent clients, so they genuinely run on separate connections.
 *
 *   R1  15 simultaneous punch submissions: exactly 10 are created
 *   R2  8 simultaneous status submissions: exactly 4 are created
 *   R3  both buckets and two employees at once: 10 + 4 each, independently
 */

import { PrismaClient } from '@prisma/client';
import { TVAService } from '../../src/common/services/tva.service';
import { RegularizationService } from '../../src/modules/platform/attendance/regularization/regularization.service';
import { buildHarness, Harness, rawClient, seedCompany, Seed } from './harness';

const PUNCH_MSG = 'The monthly limit of ten missing/incorrect punch correction requests has been reached.';
const STATUS_MSG = 'The monthly limit of four attendance-status correction requests has been reached.';
const PUNCH_TYPES = ['MISSING_PUNCH_IN', 'MISSING_PUNCH_OUT', 'INCORRECT_PUNCH_IN', 'INCORRECT_PUNCH_OUT'] as const;
const CLIENTS = 4;

/** Distinct past days in August 2026, so the one-open-request-per-day rule never interferes. */
const aug = (day: number) => `2026-08-${String(day).padStart(2, '0')}`;

describe('monthly correction limits hold under simultaneous submissions', () => {
  let h: Harness;
  let seed: Seed;
  let clients: PrismaClient[];
  let services: RegularizationService[];

  beforeAll(async () => {
    h = await buildHarness();
    clients = Array.from({ length: CLIENTS }, () => rawClient());
    await Promise.all(clients.map((c) => c.$connect()));
    const tva = h.moduleRef.get(TVAService);
    // Everything that matters to the limit is real: Prisma, the transaction
    // and the lock. Reviewer routing, audit and settings are not under test.
    services = clients.map((client) => new RegularizationService(
      client as any, tva,
      { log: async () => undefined } as any,
      { resolveApproverChainFor: async () => [], isApproverFor: async () => false } as any,
      { isHrOrAdmin: () => false } as any,
      { get: async () => ({ regularizationEnabled: true }) } as any,
      { reviseForApprovedCorrection: async () => { throw new Error('submission must not revise attendance'); } } as any,
    ));
  });

  afterAll(async () => {
    await Promise.all((clients ?? []).map((c) => c.$disconnect()));
    await h?.close();
  });

  beforeEach(async () => {
    seed = await seedCompany(h.prisma);
  });

  const submit = (i: number, userId: string, requestType: string, date: string) =>
    services[i % CLIENTS].create(userId, { businessDate: date, requestType: requestType as any, reason: 'integration: please correct this day' });

  const outcome = async (calls: Promise<unknown>[]) => {
    const settled = await Promise.allSettled(calls);
    return {
      created: settled.filter((s) => s.status === 'fulfilled').length,
      refusals: settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected').map((s) => String(s.reason?.message)),
    };
  };

  const stored = (userId: string, status: boolean) => h.prisma.attendanceRegularization.count({
    where: status ? { userId, policyCorrectionType: 'INCORRECT_ATTENDANCE_STATUS' } : { userId, policyCorrectionType: { in: [...PUNCH_TYPES] as any } },
  });

  it('R1. fifteen simultaneous punch submissions create exactly ten', async () => {
    const userId = seed.employees.A.id;
    const result = await outcome(Array.from({ length: 15 }, (_, i) => submit(i, userId, PUNCH_TYPES[i % 4], aug(i + 1))));
    expect(result.created).toBe(10);
    expect(result.refusals).toEqual(Array(5).fill(PUNCH_MSG));
    expect(await stored(userId, false)).toBe(10);
    expect(await h.prisma.dailyAttendance.count({ where: { userId } })).toBe(0);
  });

  it('R2. eight simultaneous status submissions create exactly four', async () => {
    const userId = seed.employees.A.id;
    const result = await outcome(Array.from({ length: 8 }, (_, i) => submit(i, userId, 'INCORRECT_ATTENDANCE_STATUS', aug(i + 16))));
    expect(result.created).toBe(4);
    expect(result.refusals).toEqual(Array(4).fill(STATUS_MSG));
    expect(await stored(userId, true)).toBe(4);
  });

  it('R3. both buckets for two employees at once stay at ten and four each', async () => {
    const people = [seed.employees.B.id, seed.employees.C.id];
    const calls = people.flatMap((userId) => [
      ...Array.from({ length: 15 }, (_, i) => submit(i, userId, PUNCH_TYPES[i % 4], aug(i + 1))),
      ...Array.from({ length: 8 }, (_, i) => submit(i + 1, userId, 'INCORRECT_ATTENDANCE_STATUS', aug(i + 16))),
    ]);
    const result = await outcome(calls);
    expect(result.created).toBe(28);
    expect(result.refusals.filter((m) => m === PUNCH_MSG)).toHaveLength(10);
    expect(result.refusals.filter((m) => m === STATUS_MSG)).toHaveLength(8);
    expect(result.refusals).toHaveLength(18);
    for (const userId of people) {
      expect(await stored(userId, false)).toBe(10);
      expect(await stored(userId, true)).toBe(4);
    }
  });
});
