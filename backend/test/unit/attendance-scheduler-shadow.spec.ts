import 'reflect-metadata';
import { AttendanceProcessingService } from '../../src/modules/platform/attendance/processing/attendance-processing.service';
import { AttendanceSchedulerService } from '../../src/modules/platform/attendance/processing/attendance-scheduler.service';
import { COMPANY_CRON_TIMEZONE } from '../../src/common/constants/company-time.constants';
import { SchedulerService } from '../../src/modules/platform/scheduler/scheduler.service';
import { TVAService } from '../../src/common/services/tva.service';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { formatInTimeZone } from 'date-fns-tz';

// SS-1. Real TVAService so company-time behaviour is genuinely exercised.
// Prisma, settings, audit and the evaluator are mocked, because every test here
// is about WHEN work runs and WHETHER it writes — not about attendance rules.

const DATE = '2026-08-20';
const tvaOf = () => new TVAService({ get: () => undefined } as unknown as ConfigService);

const officialResult = (over: any = {}) => ({
  official: true,
  status: 'PRESENT',
  evaluationState: 'CALCULATED',
  calculationReason: 'COMPLETE_WORKDAY',
  exceptionFlags: [],
  blockingReasons: [],
  ...over,
});

const blockedResult = () => ({
  official: false,
  status: null,
  evaluationState: 'NEEDS_REVIEW',
  calculationReason: 'CONTEXT_BLOCKED',
  exceptionFlags: [],
  blockingReasons: ['MISSING_SHIFT_ASSIGNMENT'],
});

interface Fixtures {
  automatic?: boolean;
  shadow?: boolean;
  official?: boolean;
  employees?: Array<{ id: string }>;
  perEmployee?: Record<string, any>;
  throwsFor?: Record<string, string>;
  persisted?: boolean;
  persistReason?: string;
  candidates?: Array<{ userId: string }>;
  finalizeOutcome?: any;
  lastRunEvent?: any;
}

function rig(f: Fixtures = {}) {
  const audit: any[] = [];
  const employees = f.employees ?? [{ id: 'e1' }, { id: 'e2' }];

  const resultFor = (userId: string) => f.perEmployee?.[userId] ?? officialResult();

  const prisma: any = {
    user: { findMany: jest.fn().mockResolvedValue(employees) },
    dailyAttendance: {
      findMany: jest.fn().mockResolvedValue(f.candidates ?? []),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    workSession: { update: jest.fn(), updateMany: jest.fn() },
    leaveRequest: { update: jest.fn(), updateMany: jest.fn() },
    attendancePunchEvidence: { update: jest.fn(), create: jest.fn() },
    operationalEvent: { findFirst: jest.fn().mockResolvedValue(f.lastRunEvent ?? null) },
  };

  const evaluator: any = {
    evaluate: jest.fn(async (userId: string) => {
      if (f.throwsFor?.[userId]) throw new Error(f.throwsFor[userId]);
      return resultFor(userId);
    }),
    evaluateAndPersist: jest.fn(async (userId: string) => {
      if (f.throwsFor?.[userId]) throw new Error(f.throwsFor[userId]);
      return {
        result: resultFor(userId),
        persisted: f.persisted ?? true,
        reason: f.persistReason ?? 'WRITTEN',
      };
    }),
    finalize: jest.fn().mockResolvedValue(
      f.finalizeOutcome ?? { finalized: true, reason: 'FINALIZED', record: { id: 'da-1' } },
    ),
  };

  const settings: any = {
    get: jest.fn().mockResolvedValue({
      automaticEvaluationEnabled: f.automatic === true,
      shadowEnabled: f.shadow === true,
      officialWriteEnabled: f.official === true,
    }),
  };

  const tva = tvaOf();
  const processing = new AttendanceProcessingService(
    prisma,
    tva,
    settings,
    { log: jest.fn((e: any) => { audit.push(e); return Promise.resolve(undefined); }) } as any,
    evaluator,
  );
  const scheduler = new AttendanceSchedulerService(processing, tva);

  return { processing, scheduler, prisma, evaluator, settings, audit, tva };
}

describe('SS-1 timezone hardening', () => {
  it('1. the company cron timezone is the company timezone, not the server', () => {
    expect(COMPANY_CRON_TIMEZONE).toBe(process.env.COMPANY_TIMEZONE || 'Asia/Kolkata');
    // The defect this replaces: with no zone, node-cron uses the HOST's, which
    // on Render is UTC.
    expect(COMPANY_CRON_TIMEZONE).not.toBe('UTC');
  });

  it('2. every attendance cron declares the company timezone explicitly', () => {
    // Read from the decorator metadata rather than the source text, so this
    // cannot pass on a comment.
    // @nestjs/schedule attaches its options to the method FUNCTION, so this
    // reads what the runtime will actually schedule with.
    const methods = ['inDayPass', 'postWorkdayPass', 'finalizePreviousDay'];
    for (const method of methods) {
      const fn = (AttendanceSchedulerService.prototype as any)[method];
      const options = Reflect.getMetadata('SCHEDULE_CRON_OPTIONS', fn);
      expect(options?.timeZone).toBe(COMPANY_CRON_TIMEZONE);
    }
  });

  it('3. the pre-existing daily jobs that meant company time now say so', () => {
    for (const method of ['setLeaveStatuses', 'workdayEndReminder']) {
      const fn = (SchedulerService.prototype as any)[method];
      const options = Reflect.getMetadata('SCHEDULE_CRON_OPTIONS', fn);
      expect(options?.timeZone).toBe(COMPANY_CRON_TIMEZONE);
    }
    expect(SchedulerRegistry).toBeDefined();
  });

  it('4. a UTC host cannot shift which business date the post-day pass targets', async () => {
    const { scheduler, processing, tva } = rig({ automatic: true, shadow: true });
    const spy = jest.spyOn(processing, 'processDate').mockResolvedValue({
      businessDate: '', mode: 'SHADOW', attempted: 0, evaluated: 0, unchanged: 0,
      needsReview: 0, blocked: [], notApplicable: 0, failed: [],
    } as any);

    // 21 Aug 00:30 IST is 20 Aug 19:00 UTC. A server reading UTC dates would
    // call this "the 20th" and evaluate the 19th; company time makes it the
    // 21st, so the previous business date is the 20th.
    jest.spyOn(tva, 'now').mockReturnValue(new Date('2026-08-20T19:00:00.000Z'));

    await scheduler.postWorkdayPass();

    expect(formatInTimeZone(new Date('2026-08-20T19:00:00.000Z'), 'Asia/Kolkata', 'yyyy-MM-dd'))
      .toBe('2026-08-21');
    expect(spy).toHaveBeenCalledWith('2026-08-20');
  });

  it('5. business dates either side of IST midnight resolve correctly', async () => {
    const { scheduler, processing, tva } = rig({ automatic: true, shadow: true });
    const spy = jest.spyOn(processing, 'processDate').mockResolvedValue({
      businessDate: '', mode: 'SHADOW', attempted: 0, evaluated: 0, unchanged: 0,
      needsReview: 0, blocked: [], notApplicable: 0, failed: [],
    } as any);

    // 18:29Z is 23:59 IST on the 20th -> today is the 20th.
    jest.spyOn(tva, 'now').mockReturnValue(new Date('2026-08-20T18:29:00.000Z'));
    await scheduler.inDayPass();
    expect(spy).toHaveBeenLastCalledWith('2026-08-20');

    // 18:31Z is 00:01 IST on the 21st -> today is the 21st.
    jest.spyOn(tva, 'now').mockReturnValue(new Date('2026-08-20T18:31:00.000Z'));
    await scheduler.inDayPass();
    expect(spy).toHaveBeenLastCalledWith('2026-08-21');
  });
});

describe('SS-1 processing uses the existing evaluator', () => {
  it('6. official mode calls evaluateAndPersist and nothing else', async () => {
    const { processing, evaluator } = rig({ automatic: true, official: true });

    const out = await processing.processDate(DATE);

    expect(evaluator.evaluateAndPersist).toHaveBeenCalledTimes(2);
    expect(evaluator.evaluate).not.toHaveBeenCalled();
    expect(out.mode).toBe('OFFICIAL');
    expect(out.evaluated).toBe(2);
  });

  it('7. a repeated run is idempotent and reported as unchanged', async () => {
    const { processing } = rig({
      automatic: true,
      official: true,
      persisted: false,
      persistReason: 'UNCHANGED',
    });

    const out = await processing.processDate(DATE);

    expect(out.evaluated).toBe(0);
    expect(out.unchanged).toBe(2);
  });

  it('8. one employee failing does not abort the others', async () => {
    const { processing } = rig({
      automatic: true,
      official: true,
      employees: [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }],
      throwsFor: { e2: 'boom' },
    });

    const out = await processing.processDate(DATE);

    expect(out.evaluated).toBe(2);
    expect(out.failed).toEqual([{ userId: 'e2', error: 'boom' }]);
  });

  it('9. a blocked employee is recorded with reasons, never given a status', async () => {
    const { processing, prisma } = rig({
      automatic: true,
      official: true,
      employees: [{ id: 'e1' }, { id: 'e2' }],
      perEmployee: { e2: blockedResult() },
    });

    const out = await processing.processDate(DATE);

    expect(out.blocked).toEqual([
      { userId: 'e2', blockingReasons: ['MISSING_SHIFT_ASSIGNMENT'] },
    ]);
    expect(out.evaluated).toBe(1);
    // No fabricated official record for the blocked person.
    expect(prisma.dailyAttendance.upsert).not.toHaveBeenCalled();
  });

  it('10. an exempt or not-employed day is separated from a blocked one', async () => {
    const { processing } = rig({
      automatic: true,
      official: true,
      employees: [{ id: 'e1' }],
      perEmployee: {
        e1: { official: false, calculationReason: 'NOT_APPLICABLE_EXEMPT', blockingReasons: [] },
      },
    });

    const out = await processing.processDate(DATE);

    expect(out.notApplicable).toBe(1);
    expect(out.blocked).toEqual([]);
  });

  it('11. the range is bounded and validated', async () => {
    const { processing } = rig({ automatic: true, official: true });

    await expect(processing.processRange('2026-01-01', '2026-12-31')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(processing.processRange('2026-08-20', '2026-08-01')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(processing.processDate('20-08-2026')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('12. employees are processed in bounded batches, not one company-wide fan-out', async () => {
    const inFlight: number[] = [];
    let current = 0;
    const many = Array.from({ length: 23 }, (_, i) => ({ id: `e${i}` }));
    const { processing, evaluator } = rig({ automatic: true, official: true, employees: many });

    evaluator.evaluateAndPersist.mockImplementation(async () => {
      current += 1;
      inFlight.push(current);
      await new Promise((r) => setTimeout(r, 1));
      current -= 1;
      return { result: officialResult(), persisted: true, reason: 'WRITTEN' };
    });

    await processing.processDate(DATE);

    expect(Math.max(...inFlight)).toBeLessThanOrEqual(5);
    expect(evaluator.evaluateAndPersist).toHaveBeenCalledTimes(23);
  });
});

describe('SS-1 shadow mode', () => {
  it('13. shadow mode evaluates for real but writes nothing official', async () => {
    const { processing, evaluator, prisma } = rig({ automatic: true, shadow: true, official: false });

    const out = await processing.processDate(DATE);

    expect(out.mode).toBe('SHADOW');
    // The real evaluator ran...
    expect(evaluator.evaluate).toHaveBeenCalledTimes(2);
    // ...and the persisting path was never touched.
    expect(evaluator.evaluateAndPersist).not.toHaveBeenCalled();
    expect(prisma.dailyAttendance.upsert).not.toHaveBeenCalled();
    expect(prisma.dailyAttendance.update).not.toHaveBeenCalled();
    expect(out.evaluated).toBe(2);
  });

  it('14. shadow mode changes nothing about legacy workday or leave', async () => {
    const { processing, prisma } = rig({ automatic: true, shadow: true });

    await processing.processDate(DATE);

    expect(prisma.workSession.update).not.toHaveBeenCalled();
    expect(prisma.workSession.updateMany).not.toHaveBeenCalled();
    expect(prisma.leaveRequest.update).not.toHaveBeenCalled();
    expect(prisma.leaveRequest.updateMany).not.toHaveBeenCalled();
    expect(prisma.attendancePunchEvidence.update).not.toHaveBeenCalled();
    expect(prisma.attendancePunchEvidence.create).not.toHaveBeenCalled();
  });

  it('15. official writes are off unless deliberately enabled', async () => {
    const defaults = rig({});
    expect((await defaults.processing.mode()).mode).toBe('DISABLED');

    // With nothing enabled, a direct call still defaults to the safe mode.
    const out = await defaults.processing.processDate(DATE);
    expect(out.mode).toBe('SHADOW');
    expect(defaults.evaluator.evaluateAndPersist).not.toHaveBeenCalled();
  });

  it('16. with automatic evaluation off, no cron does any work', async () => {
    const { scheduler, evaluator, prisma } = rig({ automatic: false, official: true });

    await scheduler.inDayPass();
    await scheduler.postWorkdayPass();
    await scheduler.finalizePreviousDay();

    expect(evaluator.evaluate).not.toHaveBeenCalled();
    expect(evaluator.evaluateAndPersist).not.toHaveBeenCalled();
    expect(evaluator.finalize).not.toHaveBeenCalled();
    expect(prisma.dailyAttendance.upsert).not.toHaveBeenCalled();
  });

  it('17. a shadow run is audited separately, with counts and no evidence', async () => {
    const { processing, audit } = rig({
      automatic: true,
      shadow: true,
      employees: [{ id: 'e1' }, { id: 'e2' }],
      perEmployee: { e2: blockedResult() },
    });

    await processing.processDate(DATE);

    const entry = audit.find((e) => e.action === 'ATTENDANCE_SHADOW_RUN');
    expect(entry).toBeDefined();
    expect(entry.metadata).toMatchObject({
      businessDate: DATE,
      mode: 'SHADOW',
      attempted: 2,
      blockedCount: 1,
    });
    // Ids and configuration reasons are operational; evidence is not.
    const serialised = JSON.stringify(entry);
    expect(serialised).not.toContain('latitude');
    expect(serialised).not.toContain('cloudinary');
    expect(serialised).not.toContain('photo');
  });

  it('18. an official run is audited under its own action', async () => {
    const { processing, audit } = rig({ automatic: true, official: true });
    await processing.processDate(DATE);

    expect(audit.find((e) => e.action === 'ATTENDANCE_EVALUATION_RUN')).toBeDefined();
    expect(audit.find((e) => e.action === 'ATTENDANCE_SHADOW_RUN')).toBeUndefined();
  });
});

describe('SS-1 finalization is separate and conservative', () => {
  it('19. only CALCULATED, unlocked records are even considered', async () => {
    const { processing, prisma } = rig({
      automatic: true,
      official: true,
      candidates: [{ userId: 'e1' }],
    });

    await processing.finalizeEligible(DATE);

    const where = prisma.dailyAttendance.findMany.mock.calls[0][0].where;
    expect(where.evaluationState).toBe('CALCULATED');
    expect(where.locked).toBe(false);
  });

  it('20. a NEEDS_REVIEW day is refused by the existing finalize, not force-closed', async () => {
    const { processing, evaluator } = rig({
      automatic: true,
      official: true,
      candidates: [{ userId: 'e1' }],
      finalizeOutcome: { finalized: false, reason: 'NEEDS_REVIEW' },
    });

    const out = await processing.finalizeEligible(DATE);

    expect(evaluator.finalize).toHaveBeenCalledWith('e1', DATE);
    expect(out.finalized).toBe(0);
    expect(out.skipped).toBe(1);
  });

  it('21. an already finalized day is idempotent', async () => {
    const { processing } = rig({
      automatic: true,
      official: true,
      candidates: [{ userId: 'e1' }],
      finalizeOutcome: { finalized: false, reason: 'ALREADY_FINAL' },
    });

    const out = await processing.finalizeEligible(DATE);
    expect(out.finalized).toBe(0);
    expect(out.skipped).toBe(1);
  });

  it('22. an eligible day finalizes', async () => {
    const { processing } = rig({ automatic: true, official: true, candidates: [{ userId: 'e1' }] });
    const out = await processing.finalizeEligible(DATE);
    expect(out.finalized).toBe(1);
  });

  it('23. finalization never runs in shadow mode', async () => {
    const { scheduler, evaluator } = rig({ automatic: true, shadow: true, official: false });

    await scheduler.finalizePreviousDay();

    // Finalizing a day whose result was never written would be meaningless.
    expect(evaluator.finalize).not.toHaveBeenCalled();
  });

  it('24. an in-day pass never finalizes anything', async () => {
    const { scheduler, evaluator } = rig({ automatic: true, official: true });

    await scheduler.inDayPass();

    expect(evaluator.finalize).not.toHaveBeenCalled();
  });
});

describe('SS-1 blocked employees reach the console', () => {
  it('25. the last run is read back rather than re-swept', async () => {
    const { processing, prisma } = rig({
      lastRunEvent: {
        metadata: { blocked: [{ userId: 'e2', blockingReasons: ['MISSING_SHIFT_ASSIGNMENT'] }] },
      },
    });

    const blocked = await processing.blockedFromLastRun(DATE);

    expect(blocked).toEqual([{ userId: 'e2', blockingReasons: ['MISSING_SHIFT_ASSIGNMENT'] }]);
    // One indexed lookup, not 56 context resolutions to render a card.
    expect(prisma.operationalEvent.findFirst).toHaveBeenCalledTimes(1);
  });

  it('26. no run yet reports null, which the console shows as unavailable', async () => {
    const { processing } = rig({ lastRunEvent: null });
    expect(await processing.blockedFromLastRun(DATE)).toBeNull();
  });

  it('27. a run with nobody blocked reports an empty list, which is a real zero', async () => {
    const { processing } = rig({ lastRunEvent: { metadata: { blocked: [] } } });
    // Distinct from null: this zero was actually measured.
    expect(await processing.blockedFromLastRun(DATE)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The five configuration states.
//
// The dangerous one is shadow AND official together: an administrator could
// believe they are observing a rehearsal while official attendance is being
// written. Neither flag wins — the combination stops everything.
// ─────────────────────────────────────────────────────────────────────────────

describe('SS-1 processing mode is never ambiguous', () => {
  it('28. automation off is DISABLED', async () => {
    const { processing } = rig({ automatic: false, shadow: true, official: false });
    const state = await processing.mode();

    expect(state.mode).toBe('DISABLED');
    expect(state.problem).toBeUndefined();
  });

  it('29. shadow on, official off is SHADOW', async () => {
    const { processing } = rig({ automatic: true, shadow: true, official: false });
    expect((await processing.mode()).mode).toBe('SHADOW');
  });

  it('30. shadow off, official on is OFFICIAL', async () => {
    const { processing } = rig({ automatic: true, shadow: false, official: true });
    expect((await processing.mode()).mode).toBe('OFFICIAL');
  });

  it('31. both flags off is DISABLED, not a silent default', async () => {
    const { processing } = rig({ automatic: true, shadow: false, official: false });
    expect((await processing.mode()).mode).toBe('DISABLED');
  });

  it('32. both flags on is a CONFIGURATION ERROR, with neither taking precedence', async () => {
    const { processing } = rig({ automatic: true, shadow: true, official: true });
    const state = await processing.mode();

    expect(state.mode).toBe('CONFIGURATION_ERROR');
    expect(state.problem).toContain('Enable exactly one');
    // Both are reported as they were set, so the operator can see the conflict
    // rather than being told one of them "won".
    expect(state.shadow).toBe(true);
    expect(state.official).toBe(true);
  });

  it('33. the ambiguous state is reported even before automation is switched on', async () => {
    const { processing } = rig({ automatic: false, shadow: true, official: true });

    // Surfaced the moment it exists, rather than lying dormant until somebody
    // enables automation and gets a surprise.
    expect((await processing.mode()).mode).toBe('CONFIGURATION_ERROR');
  });

  it('34. the ambiguous state cannot reach evaluateAndPersist', async () => {
    const { processing, evaluator, prisma } = rig({
      automatic: true,
      shadow: true,
      official: true,
    });

    const out = await processing.processDate(DATE);

    expect(out.configurationError).toContain('Enable exactly one');
    expect(out.attempted).toBe(0);
    expect(evaluator.evaluateAndPersist).not.toHaveBeenCalled();
    expect(evaluator.evaluate).not.toHaveBeenCalled();
    expect(prisma.dailyAttendance.upsert).not.toHaveBeenCalled();
    expect(prisma.dailyAttendance.update).not.toHaveBeenCalled();
  });

  it('35. an explicit mode argument cannot override the guard', async () => {
    const { processing, evaluator } = rig({
      automatic: true,
      shadow: true,
      official: true,
    });

    // Even a caller asking directly for OFFICIAL is refused. The guard exists
    // precisely so no code path can write official attendance while the
    // configuration says the system is rehearsing.
    const out = await processing.processDate(DATE, { mode: 'OFFICIAL' });

    expect(out.configurationError).toBeDefined();
    expect(evaluator.evaluateAndPersist).not.toHaveBeenCalled();
  });

  it('36. the ambiguous state cannot reach finalize', async () => {
    const { processing, evaluator } = rig({
      automatic: true,
      shadow: true,
      official: true,
      candidates: [{ userId: 'e1' }],
    });

    const out = await processing.finalizeEligible(DATE);

    expect(out.finalized).toBe(0);
    expect(evaluator.finalize).not.toHaveBeenCalled();
  });

  it('37. a range under the ambiguous state processes nothing', async () => {
    const { processing, evaluator } = rig({
      automatic: true,
      shadow: true,
      official: true,
    });

    const results = await processing.processRange('2026-08-19', '2026-08-21');

    expect(results).toHaveLength(3);
    for (const r of results) expect(r.configurationError).toBeDefined();
    expect(evaluator.evaluate).not.toHaveBeenCalled();
    expect(evaluator.evaluateAndPersist).not.toHaveBeenCalled();
  });

  it('38. the misconfiguration is audited so it is visible, not just refused', async () => {
    const { processing, audit } = rig({ automatic: true, shadow: true, official: true });

    await processing.processDate(DATE);

    const entry = audit.find((e) => e.action === 'ATTENDANCE_CONFIGURATION_ERROR');
    expect(entry).toBeDefined();
    expect(entry.metadata).toMatchObject({
      businessDate: DATE,
      shadowEnabled: true,
      officialWriteEnabled: true,
    });
    // Refusing silently would leave an administrator waiting for results that
    // are never coming.
    expect(entry.metadata.problem).toContain('Enable exactly one');
  });

  it('39. no cron does any work under the ambiguous state', async () => {
    const { scheduler, evaluator, prisma } = rig({
      automatic: true,
      shadow: true,
      official: true,
    });

    await scheduler.inDayPass();
    await scheduler.postWorkdayPass();
    await scheduler.finalizePreviousDay();

    expect(evaluator.evaluate).not.toHaveBeenCalled();
    expect(evaluator.evaluateAndPersist).not.toHaveBeenCalled();
    expect(evaluator.finalize).not.toHaveBeenCalled();
    expect(prisma.dailyAttendance.upsert).not.toHaveBeenCalled();
  });

  it('40. the two staging phases are each unambiguous', async () => {
    // Phase 1: observe.
    const phase1 = rig({ automatic: true, shadow: true, official: false });
    expect((await phase1.processing.mode()).mode).toBe('SHADOW');
    await phase1.processing.processDate(DATE);
    expect(phase1.evaluator.evaluateAndPersist).not.toHaveBeenCalled();
    expect(phase1.evaluator.evaluate).toHaveBeenCalled();

    // Phase 2: commit. Never both at once.
    const phase2 = rig({ automatic: true, shadow: false, official: true });
    expect((await phase2.processing.mode()).mode).toBe('OFFICIAL');
    await phase2.processing.processDate(DATE);
    expect(phase2.evaluator.evaluateAndPersist).toHaveBeenCalled();
  });
});
