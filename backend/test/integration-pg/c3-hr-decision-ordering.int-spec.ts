/**
 * Phase 6B: which HR decision governs a day.
 *
 * The evaluator asks "what is the approved correction for this employee-day?"
 * and answers it by ordering on hrDecisionAt, which is nullable. PostgreSQL
 * sorts NULLs FIRST on DESC -- proved below rather than assumed -- so a row
 * carrying no decision timestamp could outrank every decision taken after it.
 *
 * TWO QUESTIONS THAT MUST NOT BE CONFLATED:
 *
 *   A. "Is there an open correction?"   -- pending rows absolutely matter, and
 *                                          must keep being found.
 *   B. "What was the latest HR decision?" -- undecided rows must not appear at
 *                                          all, let alone outrank a decided one.
 *
 * This suite pins both, because a fix to B that damaged A would be worse than
 * the bug: an import would stop noticing that a human is mid-conversation
 * about the day it is about to rewrite.
 */

import {
  buildHarness,
  Harness,
  seedCompany,
  Seed,
  givenAttendance,
  csvFile,
  DATE,
} from './harness';
import { NON_REVIEW_FLAGS } from '../../src/modules/platform/attendance/evaluation/daily-attendance.types';

const DAY = new Date(`${DATE}T00:00:00.000Z`);
const CURRENT_IN = '09:35';

/** Aug 30, the decision date from the brief's worked example. */
const AUG30 = new Date('2026-08-30T12:00:00.000Z');
const SEP01 = new Date('2026-09-01T09:00:00.000Z');

describe('which HR decision governs a day', () => {
  let h: Harness;
  let seed: Seed;

  beforeAll(async () => {
    h = await buildHarness();
  });
  afterAll(async () => {
    await h?.close();
  });
  beforeEach(async () => {
    seed = await seedCompany(h.prisma);
  });

  const mkCorrection = (over: Record<string, any>) =>
    h.prisma.attendanceRegularization.create({
      data: {
        userId: seed.employees.B.id,
        date: DAY,
        requestType: 'MISSING_PUNCH',
        reason: 'Integration ordering fixture reason',
        ...over,
      } as any,
    });

  const evaluateB = () => h.evaluator.evaluate(seed.employees.B.id, DATE);

  // ── The hazard itself ─────────────────────────────────────────────────────

  it('1. PostgreSQL really does sort NULLs first on DESC', async () => {
    // Stated as a fact everywhere in the fix's reasoning, so it is proved here
    // rather than trusted. If a future PostgreSQL changed this, the comments
    // explaining the fix would become wrong and nothing else would notice.
    const rows: any[] = await h.prisma.$queryRawUnsafe(
      `SELECT label FROM (VALUES ('dated', TIMESTAMP '2026-08-30 12:00'), ('undated', NULL))
         AS t(label, decided)
       ORDER BY decided DESC`,
    );
    expect(rows.map((r) => r.label)).toEqual(['undated', 'dated']);

    const nullsLast: any[] = await h.prisma.$queryRawUnsafe(
      `SELECT label FROM (VALUES ('dated', TIMESTAMP '2026-08-30 12:00'), ('undated', NULL))
         AS t(label, decided)
       ORDER BY decided DESC NULLS LAST`,
    );
    expect(nullsLast.map((r) => r.label)).toEqual(['dated', 'undated']);
  });

  it("2. the brief's dataset: a newer PENDING row cannot displace a decided one", async () => {
    await givenAttendance(h.prisma, seed.employees.B.id, DATE);

    // A: decided, and it moves the punch out.
    await mkCorrection({
      status: 'HR_APPROVED',
      hrDecisionAt: AUG30,
      requestedPunchOut: new Date(`${DATE}T13:35:00.000Z`),
    });
    // B: undecided, newer, and proposes something quite different.
    await mkCorrection({
      status: 'PENDING',
      hrDecisionAt: null,
      createdAt: SEP01,
      requestedPunchOut: new Date(`${DATE}T16:00:00.000Z`),
    });

    const result = await evaluateB();
    expect(result.punchOutAt?.toISOString()).toBe(`${DATE}T13:35:00.000Z`);
    // The pending row never had a chance -- the status filter excludes it
    // before ordering is even reached.
    expect(result.punchOutAt?.toISOString()).not.toBe(`${DATE}T16:00:00.000Z`);
  });

  it('3. a REJECTED decision never governs, timestamp or not', async () => {
    await givenAttendance(h.prisma, seed.employees.B.id, DATE);
    await mkCorrection({
      status: 'REJECTED',
      hrDecisionAt: SEP01, // newer than the approval below
      requestedPunchOut: new Date(`${DATE}T16:00:00.000Z`),
    });
    await mkCorrection({
      status: 'HR_APPROVED',
      hrDecisionAt: AUG30,
      requestedPunchOut: new Date(`${DATE}T13:35:00.000Z`),
    });

    const result = await evaluateB();
    expect(result.punchOutAt?.toISOString()).toBe(`${DATE}T13:35:00.000Z`);
  });

  it('4. between two approved decisions, the later one governs', async () => {
    await givenAttendance(h.prisma, seed.employees.B.id, DATE);
    await mkCorrection({
      status: 'HR_APPROVED',
      hrDecisionAt: AUG30,
      requestedPunchOut: new Date(`${DATE}T13:35:00.000Z`),
    });
    await mkCorrection({
      status: 'HR_APPROVED',
      hrDecisionAt: SEP01,
      requestedPunchOut: new Date(`${DATE}T14:10:00.000Z`),
    });

    const result = await evaluateB();
    expect(result.punchOutAt?.toISOString()).toBe(`${DATE}T14:10:00.000Z`);
  });

  it('5. two decisions with the identical timestamp resolve deterministically', async () => {
    await givenAttendance(h.prisma, seed.employees.B.id, DATE);
    // The ids deliberately run OPPOSITE to createdAt. Left to chance a cuid
    // for the later row sorts higher too, and `id DESC` alone would give the
    // right answer -- masking removal of the createdAt tie-breaker.
    const older = await mkCorrection({
      id: 'zzzz-created-first',
      status: 'HR_APPROVED',
      hrDecisionAt: AUG30,
      createdAt: new Date('2026-08-29T09:00:00.000Z'),
      requestedPunchOut: new Date(`${DATE}T13:35:00.000Z`),
    });
    const newer = await mkCorrection({
      id: 'aaaa-created-second',
      status: 'HR_APPROVED',
      hrDecisionAt: AUG30, // exactly the same instant
      createdAt: new Date('2026-08-29T17:00:00.000Z'),
      requestedPunchOut: new Date(`${DATE}T14:10:00.000Z`),
    });
    expect(older.hrDecisionAt).toEqual(newer.hrDecisionAt);

    // createdAt breaks the tie, so the answer is the later-created one AND it
    // is the same answer every time. Repeated because "deterministic" is the
    // actual claim, and one run cannot demonstrate it.
    for (let i = 0; i < 5; i++) {
      const result = await evaluateB();
      expect(result.punchOutAt?.toISOString()).toBe(`${DATE}T14:10:00.000Z`);
    }
  });

  it('5b. identical timestamp AND identical createdAt still resolve to one answer', async () => {
    // The case that makes the id tie-breaker load-bearing. Without it the
    // ordering is finished and PostgreSQL may return either row, in whatever
    // order the plan happens to produce -- which is not a rule, and can differ
    // between two runs of the same query on the same data.
    await givenAttendance(h.prisma, seed.employees.B.id, DATE);
    const sameCreated = new Date('2026-08-29T09:00:00.000Z');
    await mkCorrection({
      id: 'aaaa-first-by-id',
      status: 'HR_APPROVED',
      hrDecisionAt: AUG30,
      createdAt: sameCreated,
      requestedPunchOut: new Date(`${DATE}T13:35:00.000Z`),
    });
    await mkCorrection({
      id: 'zzzz-last-by-id',
      status: 'HR_APPROVED',
      hrDecisionAt: AUG30,
      createdAt: sameCreated,
      requestedPunchOut: new Date(`${DATE}T14:10:00.000Z`),
    });

    // id DESC, so the higher id wins -- arbitrary, but FIXED, which is the
    // whole point. Authoritative selection must not be a coin toss.
    for (let i = 0; i < 5; i++) {
      const result = await evaluateB();
      expect(result.punchOutAt?.toISOString()).toBe(`${DATE}T14:10:00.000Z`);
    }
  });

  // ── The undated-approval anomaly ─────────────────────────────────────────

  it('6. an approval with no decision time does not outrank a dated one', async () => {
    await givenAttendance(h.prisma, seed.employees.B.id, DATE);
    await mkCorrection({
      status: 'HR_APPROVED',
      hrDecisionAt: AUG30,
      requestedPunchOut: new Date(`${DATE}T13:35:00.000Z`),
    });
    // The anomaly: approved, no decision timestamp, created later.
    await mkCorrection({
      status: 'HR_APPROVED',
      hrDecisionAt: null,
      createdAt: SEP01,
      requestedPunchOut: new Date(`${DATE}T16:00:00.000Z`),
    });

    const result = await evaluateB();
    expect(result.punchOutAt?.toISOString()).toBe(`${DATE}T13:35:00.000Z`);
    // And it was not silently dropped.
    expect(result.exceptionFlags).toContain('APPROVED_CORRECTION_WITHOUT_DECISION_TIME');
  });

  it('7. an approval with no decision time cannot govern even when it is alone', async () => {
    await givenAttendance(h.prisma, seed.employees.B.id, DATE);
    await mkCorrection({
      status: 'HR_APPROVED',
      hrDecisionAt: null,
      requestedPunchOut: new Date(`${DATE}T16:00:00.000Z`),
    });

    const result = await evaluateB();
    // The day keeps its evidence-derived punch out. A decision that cannot be
    // placed in time does not get to rewrite attendance.
    expect(result.punchOutAt?.toISOString()).toBe(`${DATE}T13:10:00.000Z`);
    expect(result.exceptionFlags).toContain('APPROVED_CORRECTION_WITHOUT_DECISION_TIME');

    // LOUD, NOT SILENT -- asserted at the mechanism, not the outcome.
    //
    // Checking evaluationState === 'NEEDS_REVIEW' here would be vacuous: these
    // fixture days carry punch evidence with no photo (inventing one is exactly
    // what the design forbids), so PHOTO_MISSING already routes every one of
    // them to review. The assertion would pass with the flag removed.
    //
    // What actually makes this flag route the day to a human is its ABSENCE
    // from NON_REVIEW_FLAGS, so that is what gets pinned.
    expect(NON_REVIEW_FLAGS).not.toContain('APPROVED_CORRECTION_WITHOUT_DECISION_TIME');
  });

  it('8. an ordinary corrected day raises no such flag', async () => {
    await givenAttendance(h.prisma, seed.employees.B.id, DATE);
    await mkCorrection({
      status: 'HR_APPROVED',
      hrDecisionAt: AUG30,
      requestedPunchOut: new Date(`${DATE}T13:35:00.000Z`),
    });

    const result = await evaluateB();
    expect(result.exceptionFlags).not.toContain('APPROVED_CORRECTION_WITHOUT_DECISION_TIME');
    // A properly decided correction is not itself a review trigger.
    expect(NON_REVIEW_FLAGS).toContain('CORRECTED_BY_REGULARIZATION');
    expect(result.exceptionFlags).toContain('CORRECTED_BY_REGULARIZATION');
  });

  it('8b. undated approvals cannot crowd the dated one out of the query window', async () => {
    // WHY `nulls: 'last'` IS NOT REDUNDANT.
    //
    // The governing decision is picked in TypeScript, which scans past undated
    // rows wherever they sit -- so null PLACEMENT looks like it stops mattering
    // once that rule exists. It still does, because the query is BOUNDED: under
    // PostgreSQL's default (NULLS FIRST on DESC) enough undated rows fill the
    // window and the real decision is never fetched at all.
    //
    // Eleven undated approvals against a take of 10.
    await givenAttendance(h.prisma, seed.employees.B.id, DATE);
    await mkCorrection({
      status: 'HR_APPROVED',
      hrDecisionAt: AUG30,
      requestedPunchOut: new Date(`${DATE}T13:35:00.000Z`),
    });
    for (let i = 0; i < 11; i++) {
      await mkCorrection({
        status: 'HR_APPROVED',
        hrDecisionAt: null,
        createdAt: new Date(`2026-09-0${(i % 9) + 1}T09:00:00.000Z`),
        requestedPunchOut: new Date(`${DATE}T16:00:00.000Z`),
      });
    }

    const result = await evaluateB();
    // The one real decision still governs, because NULLS LAST keeps it inside
    // the window however many undated rows exist.
    expect(result.punchOutAt?.toISOString()).toBe(`${DATE}T13:35:00.000Z`);
    expect(result.exceptionFlags).toContain('APPROVED_CORRECTION_WITHOUT_DECISION_TIME');
  });

  // ── Question A must be undamaged ─────────────────────────────────────────

  it('9. open-correction detection still sees a pending row', async () => {
    await givenAttendance(h.prisma, seed.employees.B.id, DATE);
    const batch = await h.imports.upload(seed.actors.operator, {
      buffer: csvFile([
        { employeeId: 'TE-011', date: DATE, status: 'PRESENT', punchIn: CURRENT_IN, punchOut: '19:05' },
      ]),
      fileName: 'open-detection.csv',
      mode: 'CURRENT_CORRECTION',
    });
    await h.apply.approve(seed.actors.hr, batch.id);

    // Raised after approval, never decided, so it carries no hrDecisionAt.
    // This is exactly the row shape the ordering fix excludes from AUTHORITY,
    // and it must still be found here.
    await mkCorrection({ status: 'PENDING', hrDecisionAt: null });

    const out = await h.apply.apply(seed.actors.admin, batch.id);
    expect(out.applied).toBe(0);
    expect(out.stale).toBe(1);

    const day = await h.prisma.dailyAttendance.findFirst({
      where: { userId: seed.employees.B.id, date: DAY },
    });
    expect(day!.revision).toBe(1);
    // No second competing correction was created.
    expect(
      await h.prisma.attendanceRegularization.count({ where: { entrySource: 'BULK_IMPORT' } }),
    ).toBe(0);
  });

  it('10. MANAGER_APPROVED is open too, and is likewise still seen', async () => {
    await givenAttendance(h.prisma, seed.employees.B.id, DATE);
    const batch = await h.imports.upload(seed.actors.operator, {
      buffer: csvFile([
        { employeeId: 'TE-011', date: DATE, status: 'PRESENT', punchIn: CURRENT_IN, punchOut: '19:05' },
      ]),
      fileName: 'open-detection-2.csv',
      mode: 'CURRENT_CORRECTION',
    });
    await h.apply.approve(seed.actors.hr, batch.id);

    // Half-decided: a manager signed, HR has not. Still open.
    await mkCorrection({
      status: 'MANAGER_APPROVED',
      managerDecisionAt: SEP01,
      hrDecisionAt: null,
    });

    const out = await h.apply.apply(seed.actors.admin, batch.id);
    expect(out.stale).toBe(1);
    expect(out.applied).toBe(0);
  });

  it('11. a half-decided row does not govern the day either', async () => {
    // MANAGER_APPROVED carries a real managerDecisionAt, so a query that
    // reached for "the newest decision timestamp" without checking status
    // could pick it. It is not an HR decision and must not rewrite attendance.
    await givenAttendance(h.prisma, seed.employees.B.id, DATE);
    await mkCorrection({
      status: 'MANAGER_APPROVED',
      managerDecisionAt: SEP01,
      hrDecisionAt: null,
      requestedPunchOut: new Date(`${DATE}T16:00:00.000Z`),
    });

    const result = await evaluateB();
    expect(result.punchOutAt?.toISOString()).toBe(`${DATE}T13:10:00.000Z`);
    // And it is NOT the undated-approval anomaly: nobody approved it.
    expect(result.exceptionFlags).not.toContain('APPROVED_CORRECTION_WITHOUT_DECISION_TIME');
  });
});
