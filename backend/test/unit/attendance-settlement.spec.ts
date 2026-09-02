import { makeRawSqlDouble } from '../helpers/raw-sql-double';
import {
  SettledAttendanceError,
  assessSettlement,
  businessMonthOf,
  describeBlocked,
  describeSettlement,
  settlementBlocking,
  type SettlementFacts,
} from '../../src/modules/platform/attendance/evaluation/attendance-settlement';

/**
 * Phase 2. Who may rewrite a settled attendance period.
 *
 * The rule this suite exists to hold: a bulk operation must never carry enough
 * authority to silently change a financially settled month, while a
 * deliberately reviewed one-person correction keeps working exactly as it does
 * today. Those are different risks and they get different answers.
 */

const facts = (over: Partial<SettlementFacts> = {}): SettlementFacts => ({
  day: { locked: false, evaluationState: 'CALCULATED' },
  monthClose: { status: 'OPEN' },
  ...over,
});

describe('what settles an attendance day', () => {
  it('1. an open day in an open month is settled by nothing', () => {
    expect(describeSettlement(facts())).toEqual([]);
  });

  it('2. a day that has never been evaluated is not settled', () => {
    expect(describeSettlement(facts({ day: null }))).toEqual([]);
  });

  it('3. a month with no close row at all is not settled', () => {
    expect(describeSettlement(facts({ monthClose: null }))).toEqual([]);
  });

  it('4. a locked day is settled', () => {
    expect(describeSettlement(facts({ day: { locked: true, evaluationState: 'CALCULATED' } })))
      .toEqual(['LOCKED_DAY']);
  });

  it('5. a FINALIZED day is settled', () => {
    expect(describeSettlement(facts({ day: { locked: false, evaluationState: 'FINALIZED' } })))
      .toEqual(['FINALIZED_DAY']);
  });

  it('6. finalize() sets both together, so both are reported', () => {
    // The evaluator writes locked:true and evaluationState:FINALIZED in one
    // update. A caller explaining a refusal should be able to say so.
    expect(describeSettlement(facts({ day: { locked: true, evaluationState: 'FINALIZED' } })))
      .toEqual(['LOCKED_DAY', 'FINALIZED_DAY']);
  });

  it('7. a FINALIZED month settles a day that is itself wide open', () => {
    // THE CASE THIS MODULE EXISTS FOR. Month finalization does NOT touch the
    // day rows: every DailyAttendance inside a closed month still reads
    // locked:false, evaluationState:CALCULATED. A day-level check alone would
    // walk into a closed period and find nothing in its way.
    const inClosedMonth = facts({ monthClose: { status: 'FINALIZED' } });

    expect(inClosedMonth.day).toEqual({ locked: false, evaluationState: 'CALCULATED' });
    expect(describeSettlement(inClosedMonth)).toEqual(['FINALIZED_MONTH']);
  });

  it('8. a SENT month settles it too', () => {
    expect(describeSettlement(facts({ monthClose: { status: 'SENT' } }))).toEqual(['SENT_MONTH']);
  });

  it('9. REVIEWING is not settled — correcting a month under review is the point of reviewing it', () => {
    // preview() moves a month OPEN -> REVIEWING simply by someone looking at
    // it. Treating that as settled would block corrections at exactly the
    // moment HR is trying to make them.
    expect(describeSettlement(facts({ monthClose: { status: 'REVIEWING' } }))).toEqual([]);
  });

  it('10. every reason is reported, not just the first', () => {
    const both = facts({
      day: { locked: true, evaluationState: 'FINALIZED' },
      monthClose: { status: 'SENT' },
    });
    expect(describeSettlement(both)).toEqual([
      'LOCKED_DAY',
      'FINALIZED_DAY',
      'SENT_MONTH',
    ]);
  });
});

describe('who a settled day refuses', () => {
  const settled = [
    ['a locked day', facts({ day: { locked: true, evaluationState: 'CALCULATED' } })],
    ['a finalized day', facts({ day: { locked: false, evaluationState: 'FINALIZED' } })],
    ['a finalized month', facts({ monthClose: { status: 'FINALIZED' } })],
    ['a sent month', facts({ monthClose: { status: 'SENT' } })],
  ] as const;

  it.each(settled)('11. BULK_IMPORT is refused by %s', (_label, f) => {
    const out = assessSettlement(f, 'BULK_IMPORT');

    expect(out.settled).toBe(true);
    expect(out.blocked.length).toBeGreaterThan(0);
  });

  const correctableByAHuman = [
    ['a locked day', facts({ day: { locked: true, evaluationState: 'CALCULATED' } })],
    ['a finalized day', facts({ day: { locked: false, evaluationState: 'FINALIZED' } })],
    ['a finalized but unsent month', facts({ monthClose: { status: 'FINALIZED' } })],
  ] as const;

  it.each(correctableByAHuman)('12. INDIVIDUAL_REVIEW is not refused by %s', (_label, f) => {
    // The line is delivery, not finalization. Before the report leaves, a
    // reviewed correction is the sanctioned way to repair a month, and send()
    // re-renders and refuses anything that no longer matches its fingerprint --
    // so a corrected-but-unsent month cannot reach Finance stale.
    const out = assessSettlement(f, 'INDIVIDUAL_REVIEW');

    expect(out.settled).toBe(true);
    expect(out.blocked).toEqual([]);
  });

  it('12b. INDIVIDUAL_REVIEW IS refused once the month has been SENT', () => {
    // Finance is holding the report. Nothing downstream re-examines a report
    // that has gone, so a correction here does not repair the month -- it makes
    // Apex OS disagree with a document somebody is already working from.
    const out = assessSettlement(facts({ monthClose: { status: 'SENT' } }), 'INDIVIDUAL_REVIEW');

    expect(out.blocked).toEqual(['SENT_MONTH']);
  });

  it('12c. a SENT month refuses a human even when the day itself is open', () => {
    const out = assessSettlement(
      { day: { locked: false, evaluationState: 'CALCULATED' }, monthClose: { status: 'SENT' } },
      'INDIVIDUAL_REVIEW',
    );

    // The day is not settled at all; the delivery is what refuses.
    expect(out.blocked).toEqual(['SENT_MONTH']);
  });

  it('12d. a SENT month refuses for the delivery, not for the day state', () => {
    const out = assessSettlement(
      { day: { locked: true, evaluationState: 'FINALIZED' }, monthClose: { status: 'SENT' } },
      'INDIVIDUAL_REVIEW',
    );

    // Everything is reported; only SENT_MONTH refuses. A human is still
    // permitted to correct a locked day -- just not in a delivered month.
    expect(out.reasons).toEqual(['LOCKED_DAY', 'FINALIZED_DAY', 'SENT_MONTH']);
    expect(out.blocked).toEqual(['SENT_MONTH']);
  });

  it('13. an open day in an open month is eligible for either', () => {
    for (const authority of ['BULK_IMPORT', 'INDIVIDUAL_REVIEW'] as const) {
      expect(assessSettlement(facts(), authority).blocked).toEqual([]);
    }
  });

  it('14. REVIEWING is eligible for bulk correction', () => {
    const reviewing = facts({ monthClose: { status: 'REVIEWING' } });
    expect(assessSettlement(reviewing, 'BULK_IMPORT').blocked).toEqual([]);
  });

  it('15. settled and blocked are different questions', () => {
    // A preview needs to say "this day is finalized" about a day it is
    // nevertheless allowed to change. Collapsing the two would lose that.
    const out = assessSettlement(facts({ monthClose: { status: 'FINALIZED' } }), 'INDIVIDUAL_REVIEW');

    expect(out.settled).toBe(true);
    expect(out.reasons).toEqual(['FINALIZED_MONTH']);
    expect(out.blocked).toEqual([]);
  });
});

describe('the refusal a person has to act on', () => {
  it('16. names the date and every reason', () => {
    const err = new SettledAttendanceError('2026-08-12', ['FINALIZED_MONTH', 'LOCKED_DAY']);

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('SettledAttendanceError');
    expect(err.businessDate).toBe('2026-08-12');
    expect(err.reasons).toEqual(['FINALIZED_MONTH', 'LOCKED_DAY']);
    expect(err.message).toContain('2026-08-12');
    expect(err.message).toContain('finalized for payroll');
    expect(err.message).toContain('locked');
  });

  it('17. carries no import or spreadsheet vocabulary', () => {
    // The evaluator must not learn the importer's words. The importer maps
    // these reasons onto its own CONFLICT vocabulary at its own boundary.
    const message = describeBlocked(['LOCKED_DAY', 'FINALIZED_DAY', 'FINALIZED_MONTH', 'SENT_MONTH']);

    for (const word of ['import', 'batch', 'row', 'spreadsheet', 'excel', 'csv', 'upload']) {
      expect(message.toLowerCase()).not.toContain(word);
    }
  });
});

describe('the month a day belongs to', () => {
  it('18. is the key AttendanceMonthClose is stored under', () => {
    expect(businessMonthOf('2026-08-29')).toBe('2026-08');
    expect(businessMonthOf('2026-01-01')).toBe('2026-01');
    expect(businessMonthOf('2026-12-31')).toBe('2026-12');
  });
});

describe('the authority list is closed', () => {
  it('19. an unrecognised authority is treated as bulk, not waved through', () => {
    // Fail closed. A future caller that forgets to declare itself must not
    // inherit the permissive answer.
    const out = settlementBlocking(['SENT_MONTH'], 'SOMETHING_NEW' as any);
    expect(out).toEqual(['SENT_MONTH']);
  });
});


// ── The gate at the chokepoint ─────────────────────────────────────────────
//
// The rules above are pure. These prove they actually fire inside
// reviseForApprovedCorrection() -- the ONLY method that writes an official
// attendance revision -- so a bulk importer cannot reach the record by taking
// another path or forgetting a check.

import { DailyAttendanceEvaluatorService } from '../../src/modules/platform/attendance/evaluation/daily-attendance-evaluator.service';
import { TVAService } from '../../src/common/services/tva.service';
import { ConfigService } from '@nestjs/config';
import {
  MONTH_LOCK_NAMESPACE_FOR_TEST,
  monthLockKey,
} from '../../src/modules/platform/attendance/evaluation/attendance-month-lock';

const DATE = '2026-08-12';

function gateRig(over: { day?: any; monthStatus?: string | null } = {}) {
  const upserts: any[] = [];
  const monthLookups: any[] = [];

  const tx: any = {
    dailyAttendance: {
      findUnique: jest.fn().mockResolvedValue(
        'day' in over
          ? over.day
          : { id: 'da-1', revision: 0, locked: false, evaluationState: 'CALCULATED' },
      ),
      upsert: jest.fn((args: any) => {
        upserts.push(args);
        return Promise.resolve({ id: 'da-1', revision: 1 });
      }),
    },
    attendanceMonthClose: {
      findUnique: jest.fn((args: any) => {
        monthLookups.push(args);
        return Promise.resolve(
          over.monthStatus === null || over.monthStatus === undefined
            ? null
            : { status: over.monthStatus },
        );
      }),
    },
    attendancePunchEvidence: { findMany: jest.fn().mockResolvedValue([]) },
    workSession: { findMany: jest.fn().mockResolvedValue([]) },
    leaveRequest: { findMany: jest.fn().mockResolvedValue([]) },
    attendanceRegularization: { findFirst: jest.fn().mockResolvedValue(null) },
    // An honest raw-SQL double: it refuses void-returning SQL exactly as the
    // real driver does, so a lock sent the wrong way fails here too.
    ...makeRawSqlDouble(),
  };

  const tva = new TVAService({ get: () => undefined } as unknown as ConfigService);
  const service = new DailyAttendanceEvaluatorService(
    tx,
    tva,
    { resolveDailyContext: jest.fn().mockRejectedValue(new Error('evaluate() must not be reached')) } as any,
    { forDay: jest.fn() } as any,
  );

  return { service, tx, upserts, monthLookups };
}

describe('the settlement gate fires at the only write', () => {
  it('20. a bulk correction into a FINALIZED month is refused before anything is read', async () => {
    // The day itself is wide open -- month finalization never touched it. This
    // is the case a day-level check would have missed entirely.
    const { service, upserts } = gateRig({ monthStatus: 'FINALIZED' });

    await expect(
      service.reviseForApprovedCorrection(
        (service as any).prisma, 'emp-1', DATE, 'reg-1', { authority: 'BULK_IMPORT' },
      ),
    ).rejects.toThrow(SettledAttendanceError);

    // Nothing was written, and the evaluator was never even asked to run.
    expect(upserts).toEqual([]);
  });

  it('21. a bulk correction into a SENT month is refused', async () => {
    const { service, upserts } = gateRig({ monthStatus: 'SENT' });

    await expect(
      service.reviseForApprovedCorrection(
        (service as any).prisma, 'emp-1', DATE, 'reg-1', { authority: 'BULK_IMPORT' },
      ),
    ).rejects.toThrow(/sent to Finance/i);
    expect(upserts).toEqual([]);
  });

  it('22. a bulk correction onto a locked day is refused', async () => {
    const { service, upserts } = gateRig({
      day: { id: 'da-1', revision: 0, locked: true, evaluationState: 'FINALIZED' },
      monthStatus: 'OPEN',
    });

    await expect(
      service.reviseForApprovedCorrection(
        (service as any).prisma, 'emp-1', DATE, 'reg-1', { authority: 'BULK_IMPORT' },
      ),
    ).rejects.toThrow(SettledAttendanceError);
    expect(upserts).toEqual([]);
  });

  it('23. the check runs at APPLY time, not from a stale preview', async () => {
    // 14:00 preview sees OPEN. 14:05 the month is finalized. 14:06 apply.
    // The gate reads the month inside the caller's transaction, so the state at
    // the moment of writing is what decides -- not what the preview saw.
    const { service, tx, upserts } = gateRig({ monthStatus: 'OPEN' });

    // Preview-time state: eligible.
    expect(
      assessSettlement({ day: null, monthClose: { status: 'OPEN' } }, 'BULK_IMPORT').blocked,
    ).toEqual([]);

    // The month closes between preview and apply.
    tx.attendanceMonthClose.findUnique.mockResolvedValue({ status: 'FINALIZED' });

    await expect(
      service.reviseForApprovedCorrection(
        (service as any).prisma, 'emp-1', DATE, 'reg-1', { authority: 'BULK_IMPORT' },
      ),
    ).rejects.toThrow(SettledAttendanceError);
    expect(upserts).toEqual([]);
  });

  it('24. an INDIVIDUAL correction into a SENT month is refused at the write', async () => {
    const { service, upserts } = gateRig({ monthStatus: 'SENT' });

    await expect(
      service.reviseForApprovedCorrection((service as any).prisma, 'emp-1', DATE, 'reg-1'),
    ).rejects.toThrow(SettledAttendanceError);

    expect(upserts).toEqual([]);
  });

  it('24b. an INDIVIDUAL correction into a FINALIZED but unsent month still works', async () => {
    // The behaviour Phase 2B had to preserve. HR repairing a month before it
    // reaches Finance is the sanctioned workflow, and blocking it would push
    // people back to editing spreadsheets by hand.
    const { service } = gateRig({ monthStatus: 'FINALIZED' });

    await expect(
      service.reviseForApprovedCorrection((service as any).prisma, 'emp-1', DATE, 'reg-1'),
    ).rejects.toThrow('evaluate() must not be reached');
  });

  it('24c. an INDIVIDUAL correction onto a locked day in an open month still works', async () => {
    const { service } = gateRig({
      day: { id: 'da-1', revision: 0, locked: true, evaluationState: 'FINALIZED' },
      monthStatus: 'OPEN',
    });

    await expect(
      service.reviseForApprovedCorrection((service as any).prisma, 'emp-1', DATE, 'reg-1'),
    ).rejects.toThrow('evaluate() must not be reached');
  });

  it('24d. the month is LOCKED before it is read, for every authority', async () => {
    // Reading the month without holding it only narrows the race: finalize()
    // could commit between the read and the write. The order matters, so it is
    // asserted rather than assumed.
    for (const authority of ['INDIVIDUAL_REVIEW', 'BULK_IMPORT'] as const) {
      const { service, tx } = gateRig({ monthStatus: 'OPEN' });

      await expect(
        service.reviseForApprovedCorrection(
          (service as any).prisma, 'emp-1', DATE, 'reg-1', { authority },
        ),
      ).rejects.toThrow('evaluate() must not be reached');

      const lockCall = tx.$executeRaw.mock.invocationCallOrder[0];
      const readCall = tx.attendanceMonthClose.findUnique.mock.invocationCallOrder[0];

      expect(tx.$executeRaw).toHaveBeenCalled();
      expect(lockCall).toBeLessThan(readCall);
    }
  });

  it('24e. the lock names this month, and is transaction-scoped', async () => {
    const { service, tx } = gateRig({ monthStatus: 'OPEN' });

    await expect(
      service.reviseForApprovedCorrection((service as any).prisma, 'emp-1', DATE, 'reg-1'),
    ).rejects.toThrow('evaluate() must not be reached');

    const sql = tx.$executeRaw.mock.calls[0][0].join('?');
    // xact-scoped: released on commit, on rollback, and on a dropped
    // connection. A session-scoped lock would outlive a failed correction.
    expect(sql).toContain('pg_advisory_xact_lock');
    // 2026-08 -> 202608, readable in pg_locks during an incident.
    expect(tx.$executeRaw.mock.calls[0].slice(1)).toEqual([MONTH_LOCK_NAMESPACE_FOR_TEST, 202608]);
    // $executeRaw, not $queryRaw: pg_advisory_xact_lock() returns void, and
    // asking Prisma for its rows fails after the lock is taken -- rolling the
    // transaction back and releasing it. Proven against PostgreSQL 18 in
    // test/integration-pg/b1-advisory-lock.int-spec.ts.
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(monthLockKey('2026-08')).toBe(202608);
  });

  it('25. a bulk correction into an OPEN month is allowed through the gate', async () => {
    const { service, monthLookups } = gateRig({ monthStatus: 'OPEN' });

    await expect(
      service.reviseForApprovedCorrection(
        (service as any).prisma, 'emp-1', DATE, 'reg-1', { authority: 'BULK_IMPORT' },
      ),
    ).rejects.toThrow('evaluate() must not be reached');

    // It looked, and it looked at the right month.
    expect(monthLookups[0].where.month).toBe('2026-08');
  });
});
