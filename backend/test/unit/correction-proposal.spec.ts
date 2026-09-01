import {
  MIN_REASON_EMPLOYEE_REQUEST,
  MIN_REASON_ENTERED_CORRECTION,
  buildCorrectionRecord,
  validateCorrectionProposal,
  type CorrectionProposal,
  type OfficialSnapshot,
} from '../../src/modules/platform/attendance/regularization/correction-proposal';

/**
 * The rules every attendance correction obeys, proved without a database.
 *
 * A hand-entered day, an employee's request and a row out of a six-month
 * spreadsheet are one operation with different paperwork. These are the rules
 * that operation holds to, extracted so the bulk importer cannot quietly grow a
 * more forgiving second copy of them.
 */

const at = (iso: string) => new Date(iso);

const proposal = (over: Partial<CorrectionProposal> = {}): CorrectionProposal => ({
  punchInAt: at('2026-08-29T04:00:00.000Z'),
  punchOutAt: at('2026-08-29T13:00:00.000Z'),
  proposedStatus: null,
  reason: 'Apex OS was unavailable when the employee tried to punch out.',
  ...over,
});

const official = (over: Partial<OfficialSnapshot> = {}): OfficialSnapshot => ({
  punchInAt: null,
  punchOutAt: null,
  status: null,
  sourceFingerprint: 'fp-1',
  ...over,
});

const entered = { minReasonLength: MIN_REASON_ENTERED_CORRECTION };
const codes = (p: ReturnType<typeof validateCorrectionProposal>) => p.map((x) => x.code);

describe('a correction has to say what it is asserting', () => {
  it('1. accepts a complete proposal', () => {
    expect(validateCorrectionProposal(proposal(), null, entered)).toEqual([]);
  });

  it('2. refuses a proposal that changes nothing', () => {
    const empty = proposal({ punchInAt: null, punchOutAt: null, proposedStatus: null });
    expect(codes(validateCorrectionProposal(empty, null, entered))).toContain('NOTHING_PROPOSED');
  });

  it('3. a status alone is a proposal', () => {
    // Historical days and approved absences have no punch times to offer, and
    // refusing them would make the importer unable to express most of a
    // six-month migration.
    const statusOnly = proposal({
      punchInAt: null,
      punchOutAt: null,
      proposedStatus: 'PRESENT',
    });
    expect(validateCorrectionProposal(statusOnly, null, entered)).toEqual([]);
  });

  it('4. an entered correction needs a real explanation; a request needs less', () => {
    const thin = proposal({ reason: 'wrong' });

    expect(codes(validateCorrectionProposal(thin, null, entered))).toContain('REASON_TOO_SHORT');
    expect(
      validateCorrectionProposal(thin, null, { minReasonLength: MIN_REASON_EMPLOYEE_REQUEST }),
    ).toEqual([]);

    // The two bars are different on purpose: an employee is reporting a
    // problem, somebody entering attendance on their behalf is deciding one.
    expect(MIN_REASON_ENTERED_CORRECTION).toBeGreaterThan(MIN_REASON_EMPLOYEE_REQUEST);
  });

  it('5. whitespace is not an explanation', () => {
    const blank = proposal({ reason: '           ' });
    expect(codes(validateCorrectionProposal(blank, null, entered))).toContain('REASON_TOO_SHORT');
  });
});

describe('a day cannot end before it starts', () => {
  it('6. refuses an inverted punch pair', () => {
    // Previously unguarded: an inverted pair reached the evaluator and became a
    // nonsensical presence on a record that feeds payroll.
    const inverted = proposal({
      punchInAt: at('2026-08-29T13:00:00.000Z'),
      punchOutAt: at('2026-08-29T04:00:00.000Z'),
    });
    expect(codes(validateCorrectionProposal(inverted, null, entered))).toContain(
      'PUNCH_OUT_BEFORE_PUNCH_IN',
    );
  });

  it('7. refuses a zero-length day', () => {
    const same = at('2026-08-29T04:00:00.000Z');
    const zero = proposal({ punchInAt: same, punchOutAt: new Date(same) });
    expect(codes(validateCorrectionProposal(zero, null, entered))).toContain(
      'PUNCH_OUT_BEFORE_PUNCH_IN',
    );
  });

  it('8. one side alone is never an ordering problem', () => {
    // Adding a missing punch out is the commonest recovery there is.
    expect(validateCorrectionProposal(proposal({ punchInAt: null }), null, entered)).toEqual([]);
    expect(validateCorrectionProposal(proposal({ punchOutAt: null }), null, entered)).toEqual([]);
  });

  it('9. says which two times disagree, in company terms', () => {
    const inverted = proposal({
      punchInAt: at('2026-08-29T13:00:00.000Z'),
      punchOutAt: at('2026-08-29T04:00:00.000Z'),
    });
    const [problem] = validateCorrectionProposal(inverted, null, {
      ...entered,
      formatTime: (d) => (d.getUTCHours() === 13 ? '18:30' : '09:30'),
    });

    // A refusal nobody can act on is one they will simply retry.
    expect(problem.message).toContain('18:30');
    expect(problem.message).toContain('09:30');
  });
});

describe('two authoritative answers for one moment', () => {
  it('10. refuses a second punch on top of one that exists', () => {
    const existing = official({ punchInAt: at('2026-08-29T04:22:00.000Z') });
    expect(codes(validateCorrectionProposal(proposal(), existing, entered))).toContain(
      'PUNCH_IN_ALREADY_EXISTS',
    );
  });

  it('11. allows it when the actor is deliberately correcting', () => {
    const existing = official({
      punchInAt: at('2026-08-29T04:22:00.000Z'),
      punchOutAt: at('2026-08-29T12:30:00.000Z'),
    });
    expect(
      validateCorrectionProposal(proposal(), existing, { ...entered, correctExisting: true }),
    ).toEqual([]);
  });

  it('12. reports every problem at once, not just the first', () => {
    // The single-day caller throws on the first; the importer puts all of them
    // on the row so an operator fixes a spreadsheet in one pass.
    const bad = proposal({
      reason: 'no',
      punchInAt: at('2026-08-29T13:00:00.000Z'),
      punchOutAt: at('2026-08-29T04:00:00.000Z'),
    });
    const found = codes(validateCorrectionProposal(bad, official({ punchInAt: at('2026-08-29T04:22:00.000Z') }), entered));

    expect(found).toEqual(
      expect.arrayContaining(['REASON_TOO_SHORT', 'PUNCH_OUT_BEFORE_PUNCH_IN', 'PUNCH_IN_ALREADY_EXISTS']),
    );
  });
});

describe('what the correction record preserves', () => {
  const built = () =>
    buildCorrectionRecord({
      userId: 'emp-1',
      date: at('2026-08-29T00:00:00.000Z'),
      proposal: proposal(),
      official: official({
        punchInAt: at('2026-08-29T04:22:00.000Z'),
        punchOutAt: at('2026-08-29T12:34:00.000Z'),
        sourceFingerprint: 'fp-before',
      }),
      entrySource: 'MANUAL_RECOVERY',
      requestType: 'MISSING_PUNCH',
      createdById: 'hr-1',
      actorRoleAtEntry: 'ADMIN',
      recoveryReason: 'SERVER_UNAVAILABLE',
      employeeInformedAt: at('2026-08-29T13:06:00.000Z'),
    });

  it('13. captures the values being replaced, before they are replaced', () => {
    const row = built();

    // The moment this correction is applied the previous values exist nowhere
    // else. This row has to be able to say 09:52 -> 09:30 on its own, six
    // months later, in front of a payroll query.
    expect(row.originalPunchIn).toEqual(at('2026-08-29T04:22:00.000Z'));
    expect(row.originalPunchOut).toEqual(at('2026-08-29T12:34:00.000Z'));
  });

  it('14. captures the official result it was argued against', () => {
    expect(built().basedOnFingerprint).toBe('fp-before');
  });

  it('15. a first-ever record has nothing to preserve, and says so with null', () => {
    const row = buildCorrectionRecord({
      userId: 'emp-1',
      date: at('2026-08-29T00:00:00.000Z'),
      proposal: proposal(),
      official: null,
      entrySource: 'HISTORICAL_IMPORT',
      requestType: 'MISSING_PUNCH',
      createdById: 'ops-1',
      actorRoleAtEntry: 'EMPLOYEE',
    });

    expect(row.originalPunchIn).toBeNull();
    expect(row.originalPunchOut).toBeNull();
    expect(row.basedOnFingerprint).toBeNull();
  });

  it('16. records who entered it and the role they held AT ENTRY', () => {
    const row = built();

    // A historical snapshot: if this manager later becomes HR, the record must
    // still say a manager entered it.
    expect(row.createdById).toBe('hr-1');
    expect(row.actorRoleAtEntry).toBe('ADMIN');
    expect(row.entrySource).toBe('MANUAL_RECOVERY');
  });

  it('17. trims the reason but keeps it', () => {
    const row = buildCorrectionRecord({
      ...({} as any),
      userId: 'emp-1',
      date: at('2026-08-29T00:00:00.000Z'),
      proposal: proposal({ reason: '  Office internet outage — attendance unavailable.  ' }),
      official: null,
      entrySource: 'MANUAL_RECOVERY',
      requestType: 'MISSING_PUNCH',
      createdById: 'hr-1',
      actorRoleAtEntry: 'ADMIN',
    });

    expect(row.reason).toBe('Office internet outage — attendance unavailable.');
  });

  it('18. NEVER produces evidence, whatever it is handed', () => {
    // The invariant this whole module exists to keep. A correction is somebody
    // asserting a fact, not a device recording one, and a manufactured
    // coordinate is indistinguishable from a real one once it is stored.
    const row: Record<string, unknown> = built() as any;

    for (const forbidden of [
      'latitude',
      'longitude',
      'accuracyMeters',
      'accuracy',
      'photoAssetId',
      'photoObjectKey',
      'photoHash',
      'deviceId',
      'userAgent',
      'locationVerification',
      'photoVerification',
    ]) {
      expect(Object.keys(row)).not.toContain(forbidden);
    }
  });

  it('19. carries a proposed status through untouched', () => {
    const row = buildCorrectionRecord({
      userId: 'emp-1',
      date: at('2026-08-29T00:00:00.000Z'),
      proposal: proposal({ punchInAt: null, punchOutAt: null, proposedStatus: 'LEAVE' }),
      official: null,
      entrySource: 'HISTORICAL_IMPORT',
      requestType: 'MISSING_PUNCH',
      createdById: 'ops-1',
      actorRoleAtEntry: 'EMPLOYEE',
    });

    expect(row.proposedStatus).toBe('LEAVE');
    expect(row.requestedPunchIn).toBeNull();
    expect(row.requestedPunchOut).toBeNull();
  });
});
