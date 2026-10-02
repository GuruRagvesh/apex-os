import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  attentionItems,
  categoryLabel,
  compOffBuckets,
  completionDisplay,
  dayLabel,
  formatDateOnly,
  formatDurationMinutes,
  formatClockMinutes,
  formatMonthLabel,
  formatPunchTime,
  leaveRow,
  lockNote,
  metricRows,
  monthKpis,
  monthLockState,
  monthOptions,
  sampleNote,
  tenureLabel,
  todayFrom,
} from '../../../frontend/components/attendance/employee-summary-presentation';
import type {
  EmployeeAttendanceSummary,
  SummaryDay,
} from '../../../frontend/components/attendance/employee-summary-api';

/**
 * What the employee Attendance dashboard is allowed to say.
 *
 * FIXTURES AVOID EVERY PRODUCTION DEFAULT. Punches at 10:17 and 19:29, not
 * 09:30 and 18:30. Presence 552 minutes, work 511, break 41 -- three different
 * numbers, so a function that returned the wrong one of the three cannot pass
 * by coincidence. A casual leave balance of 4.5, because a screen printing an
 * integer where the entitlement is fractional looks entirely correct against a
 * fixture of 12. One comp off credit available and one expired, because the
 * count that matters is the one that tells them apart.
 *
 * The rules under test are the ones that would be expensive to get wrong in
 * front of the person whose record it is: an unresolved day rendered as an
 * absence, a break subtracted out of presence, an entitlement recomputed in the
 * browser, or a completion time invented where the server declined to give one.
 */

// ── Fixtures ────────────────────────────────────────────────────────────────

const PRESENCE = 552; // 10:17 -> 19:29, 9h 12m
const WORK = 511; // 8h 31m
const BREAK = 41;

const day = (over: Partial<SummaryDay> = {}): SummaryDay => ({
  businessDate: '2026-08-11',
  status: 'PRESENT',
  evaluationState: 'CALCULATED',
  punchInAt: '2026-08-11T04:47:00.000Z',
  punchOutAt: '2026-08-11T13:59:00.000Z',
  officePresenceMinutes: PRESENCE,
  workedMinutes: WORK,
  breakMinutes: BREAK,
  locked: false,
  notApplicable: false,
  ...over,
});

const summary = (over: Partial<EmployeeAttendanceSummary> = {}): EmployeeAttendanceSummary => ({
  employee: {
    id: 'emp-7', name: 'Asha Rao', employeeId: 'TE-0412', designation: 'Engineer',
    department: { id: 'dept-1', name: 'Platform' },
    isActive: true,
    joiningDate: '2023-11-09', // deliberately not the 1st of a month
    lastWorkingDate: null,
    employmentCategory: 'REGULAR_EMPLOYEE',
    tenure: { years: 2, months: 9, known: true },
  },
  month: '2026-08',
  requiredPresenceMinutes: 525,
  counts: {
    present: 12, late: 3, halfDay: 1, fullDay: 15, approvedLeaveDays: 2,
    missingPunchIn: 1, missingPunchOut: 2, requiredHoursShortfall: 4,
    needsReview: 3, absent: 1, noRecord: 0, notApplicable: 0,
  },
  metrics: {
    averagePunchInMinutes: 617, averagePunchOutMinutes: 1169,
    averageOfficePresenceMinutes: PRESENCE, averageEffectiveWorkMinutes: WORK,
    averageBreakMinutes: BREAK, sampleSize: 14,
  },
  days: [day()],
  today: {
    businessDate: '2026-08-17',
    completion: { expectedCompletionMinutes: 1142, unresolvedReason: null },
  },
  needsAttention: {
    missingPunchIn: 0, missingPunchOut: 0, needsReview: 0, noRecord: 0,
    pendingRegularizations: 0, missingJoiningDate: false,
    requiredPresenceUnconfigured: false,
  },
  ...over,
});

const credit = (over: any = {}) => ({
  id: 'c1',
  earnedFromBusinessDate: '2026-06-14',
  earnedAt: '2026-06-15T05:00:00.000Z',
  expiresAt: '2026-09-14T00:00:00.000Z',
  status: 'AVAILABLE',
  ...over,
});

// ════════════════════════════════════════════════════════════════════════════
describe('durations and clocks', () => {
  it('1. 542 minutes reads as "9h 02m" -- padded, and spaced', () => {
    expect(formatDurationMinutes(542)).toBe('9h 02m');
  });

  it('2. the fixture day: presence, work and break are three different strings', () => {
    expect(formatDurationMinutes(PRESENCE)).toBe('9h 12m');
    expect(formatDurationMinutes(WORK)).toBe('8h 31m');
    expect(formatDurationMinutes(BREAK)).toBe('41m');
  });

  it('3. A WHOLE NUMBER OF HOURS STILL PADS ITS MINUTES', () => {
    // "10h 0m" beside "9h 02m" in the same column is the alignment bug this
    // format exists to avoid.
    expect(formatDurationMinutes(600)).toBe('10h 00m');
    expect(formatDurationMinutes(60)).toBe('1h 00m');
  });

  it('4. nothing is not zero: null and negatives render as a dash', () => {
    expect(formatDurationMinutes(null)).toBe('—');
    expect(formatDurationMinutes(-5)).toBe('—');
    expect(formatDurationMinutes(0)).toBe('0m');
  });

  it('5. clock minutes render as wall time', () => {
    expect(formatClockMinutes(617)).toBe('10:17');
    expect(formatClockMinutes(1169)).toBe('19:29');
    expect(formatClockMinutes(0)).toBe('00:00');
    expect(formatClockMinutes(null)).toBe('—');
  });

  it('6. an unreadable punch instant is a dash, never an Invalid Date', () => {
    expect(formatPunchTime(null)).toBe('—');
    expect(formatPunchTime('not-a-date')).toBe('—');
  });

  it('7. a stored date is not shifted a day by the reader’s timezone', () => {
    expect(formatDateOnly('2023-11-09')).toContain('9');
    expect(formatDateOnly('2023-11-09')).toContain('2023');
    expect(formatDateOnly(null)).toBe('—');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('a day’s label: unresolved is never an absence', () => {
  it('8. AN UNRESOLVED DAY IS NEVER LABELLED ABSENT', () => {
    const unresolved = dayLabel(day({ status: null, evaluationState: 'NEEDS_REVIEW' }));
    expect(unresolved.label).toBe('Needs Review');
    expect(unresolved.label).not.toMatch(/absent/i);
  });

  it('9. NEEDS_REVIEW WINS over a provisional status', () => {
    // A day carrying ABSENT that the evaluator flagged for review has not been
    // decided. Printing the provisional verdict makes it look final.
    expect(dayLabel(day({ status: 'ABSENT', evaluationState: 'NEEDS_REVIEW' })).label)
      .toBe('Needs Review');
  });

  it('10. NOT APPLICABLE AND NO RECORD ARE TOLD APART, both having a null status', () => {
    const exempt = dayLabel(day({ status: null, evaluationState: null, notApplicable: true }));
    const gap = dayLabel(day({ status: null, evaluationState: null, notApplicable: false }));
    expect(exempt.label).toBe('Not Applicable');
    expect(exempt.tone).toBe('muted');
    expect(gap.label).toBe('No Record');
    expect(gap.tone).toBe('warn');
  });

  it('11. not-applicable beats a review flag: an exempt day is not somebody’s problem', () => {
    const exempt = dayLabel(day({ status: null, evaluationState: 'NEEDS_REVIEW', notApplicable: true }));
    expect(exempt.label).toBe('Not Applicable');
  });

  it('12. a real absence is still called one', () => {
    const absent = dayLabel(day({ status: 'ABSENT', evaluationState: 'CALCULATED' }));
    expect(absent.label).toBe('Absent');
    expect(absent.tone).toBe('bad');
  });

  it('13. every status the API can return has a human label, none a raw enum', () => {
    const statuses = [
      'PRESENT', 'LATE', 'LATE_EXEMPTED', 'LEAVE', 'HALF_DAY', 'WEEKLY_OFF',
      'HOLIDAY', 'LWP', 'ABSENT', 'MISSING_PUNCH', 'PENDING_REGULARIZATION',
      'GEO_MISMATCH', 'FACE_MISSING',
    ];
    for (const status of statuses) {
      const look = dayLabel(day({ status: status as any, evaluationState: 'CALCULATED' }));
      expect(look.label).not.toMatch(/_/);
      expect(look.label).not.toBe(status);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('the month’s cards', () => {
  it('14. UNRESOLVED IS NOT ADDED INTO ABSENCE', () => {
    const cards = monthKpis(summary().counts);
    const absent = cards.find((c) => c.key === 'absent');
    const review = cards.find((c) => c.key === 'needsReview');
    expect(absent!.value).toBe(1); // counts.absent, alone
    expect(review!.value).toBe(3);
    // 1 + 3 = 4 would be the merge this asserts against.
    expect(absent!.value).not.toBe(4);
  });

  it('15. needs review is present even at zero, so a clean month shows the check', () => {
    const clean = summary({
      counts: { ...summary().counts, needsReview: 0, absent: 0 },
    });
    expect(monthKpis(clean.counts).map((c) => c.key)).toContain('needsReview');
  });

  it('16. no-record and not-applicable cards appear only when they mean something', () => {
    const none = monthKpis(summary().counts).map((c) => c.key);
    expect(none).not.toContain('noRecord');
    expect(none).not.toContain('notApplicable');

    const exempt = monthKpis({ ...summary().counts, notApplicable: 21 }).map((c) => c.key);
    expect(exempt).toContain('notApplicable');
  });

  it('17. a shortfall card never claims a pay consequence', () => {
    const shortfall = monthKpis(summary().counts).find((c) => c.key === 'shortfall');
    expect(shortfall!.label).toBe('Short Hours');
    expect(`${shortfall!.label} ${shortfall!.hint}`).not.toMatch(/deduct|salary|pay|lwp/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('time metrics keep presence and work apart', () => {
  it('18. PRESENCE AND WORK ARE SEPARATE ROWS CARRYING DIFFERENT VALUES', () => {
    const rows = metricRows(summary().metrics);
    const presence = rows.find((r) => r.key === 'presence');
    const work = rows.find((r) => r.key === 'work');
    expect(presence!.value).toBe('9h 12m');
    expect(work!.value).toBe('8h 31m');
    expect(presence!.value).not.toBe(work!.value);
  });

  it('19. THE PRESENCE ROW STATES THAT BREAKS ARE NOT DEDUCTED', () => {
    const presence = metricRows(summary().metrics).find((r) => r.key === 'presence');
    expect(presence!.hint).toMatch(/breaks are not deducted/i);
    // And it is not quietly the break-subtracted figure either: 552 - 41 = 511,
    // which is exactly the work figure, so the wrong one is indistinguishable
    // unless the number itself is checked.
    expect(presence!.value).not.toBe(formatDurationMinutes(PRESENCE - BREAK));
  });

  it('20. a missing average is a dash, not a zero duration', () => {
    const rows = metricRows({
      averagePunchInMinutes: null, averagePunchOutMinutes: null,
      averageOfficePresenceMinutes: null, averageEffectiveWorkMinutes: null,
      averageBreakMinutes: null, sampleSize: 0,
    });
    expect(rows.every((r) => r.value === '—')).toBe(true);
  });

  it('21. the sample note says half-punched days are excluded, not counted as zero', () => {
    expect(sampleNote(summary().metrics)).toMatch(/14 days/);
    expect(sampleNote(summary().metrics)).toMatch(/excluded, not counted as zero/i);
    expect(sampleNote({ ...summary().metrics, sampleSize: 0 })).toMatch(/no day this month/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('today’s completion time is the server’s or nobody’s', () => {
  it('22. a resolved completion renders as the clock the server computed', () => {
    expect(completionDisplay(summary().today).value).toBe('19:02');
    expect(completionDisplay(summary().today).explanation).toBeNull();
  });

  it('23. NO PUNCH IN: THE REASON IS SHOWN, NEVER A DEFAULT TIME', () => {
    const out = completionDisplay({
      businessDate: '2026-08-17',
      completion: { expectedCompletionMinutes: null, unresolvedReason: 'NO_PUNCH_IN' },
    });
    expect(out.value).toBe('—');
    expect(out.explanation).toMatch(/not punched in/i);
    // 18:30 and 09:30 + 9h are the two figures a screen would invent here.
    expect(out.value).not.toMatch(/18:30|09:30|17:30/);
  });

  it('24. AN UNCONFIGURED POLICY SAYS SO, and says who configures it', () => {
    const noArrival = completionDisplay({
      businessDate: '2026-08-17',
      completion: { expectedCompletionMinutes: null, unresolvedReason: 'NO_ARRIVAL_POLICY' },
    });
    const noHours = completionDisplay({
      businessDate: '2026-08-17',
      completion: { expectedCompletionMinutes: null, unresolvedReason: 'NO_REQUIRED_PRESENCE' },
    });
    expect(noArrival.explanation).toMatch(/shift start/i);
    expect(noArrival.explanation).toMatch(/HR/);
    expect(noHours.explanation).toMatch(/required hours/i);
    expect(noArrival.explanation).not.toBe(noHours.explanation);
  });

  it('25. an unrecognised reason still refuses to guess', () => {
    const out = completionDisplay({
      businessDate: '2026-08-17',
      completion: { expectedCompletionMinutes: null, unresolvedReason: 'SOMETHING_NEW' as any },
    });
    expect(out.value).toBe('—');
    expect(out.explanation).toBeTruthy();
  });

  it('26. today is found by the date the SERVER calls today, not the browser', () => {
    const withToday = summary({
      days: [day({ businessDate: '2026-08-11' }), day({ businessDate: '2026-08-17' })],
    });
    expect(todayFrom(withToday)!.businessDate).toBe('2026-08-17');
    expect(todayFrom(summary())).toBeNull(); // a month that does not contain it
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('needs attention describes, and never offers a repair', () => {
  it('27. a clean record produces an empty list', () => {
    expect(attentionItems(summary())).toEqual([]);
  });

  it('28. each flag produces its own item, in the order the reader can act on', () => {
    const items = attentionItems(summary({
      needsAttention: {
        missingPunchIn: 1, missingPunchOut: 2, needsReview: 3, noRecord: 4,
        pendingRegularizations: 1, missingJoiningDate: true,
        requiredPresenceUnconfigured: true,
      },
    }));
    expect(items.map((i) => i.key)).toEqual([
      'missingPunchIn', 'missingPunchOut', 'needsReview', 'noRecord',
      'pendingRegularizations', 'missingJoiningDate', 'requiredPresence',
    ]);
  });

  it('29. NO ITEM OFFERS A CONTROL THAT DOES NOT EXIST', () => {
    const items = attentionItems(summary({
      needsAttention: {
        missingPunchIn: 1, missingPunchOut: 1, needsReview: 1, noRecord: 1,
        pendingRegularizations: 1, missingJoiningDate: true,
        requiredPresenceUnconfigured: true,
      },
    }));
    for (const item of items) {
      const text = `${item.label} ${item.detail}`;
      expect(text).not.toMatch(/click here|fix now|repair|resolve this automatically/i);
    }
  });

  it('30. the review item repeats that it is not an absence', () => {
    const items = attentionItems(summary({
      needsAttention: { ...summary().needsAttention, needsReview: 2 },
    }));
    expect(items[0].detail).toMatch(/not counted as absence/i);
  });

  it('31. singular and plural are both grammatical', () => {
    const one = attentionItems(summary({
      needsAttention: { ...summary().needsAttention, missingPunchIn: 1 },
    }));
    const many = attentionItems(summary({
      needsAttention: { ...summary().needsAttention, missingPunchIn: 3 },
    }));
    expect(one[0].label).toBe('1 day with no punch in');
    expect(many[0].label).toBe('3 days with no punch in');
  });

  it('32. MISSING MASTER DATA IS THE LOUDER TONE, because only HR can clear it', () => {
    const items = attentionItems(summary({
      needsAttention: { ...summary().needsAttention, missingJoiningDate: true },
    }));
    expect(items[0].tone).toBe('bad');
    expect(items[0].detail).toMatch(/HR/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('tenure and employment are never invented', () => {
  it('33. AN UNKNOWN TENURE IS NULL, NOT ZERO YEARS', () => {
    expect(tenureLabel({ years: 0, months: 0, known: false })).toBeNull();
  });

  it('34. a known tenure reads in words', () => {
    expect(tenureLabel({ years: 2, months: 9, known: true })).toBe('2 years 9 months');
    expect(tenureLabel({ years: 1, months: 1, known: true })).toBe('1 year 1 month');
    expect(tenureLabel({ years: 0, months: 7, known: true })).toBe('7 months');
    expect(tenureLabel({ years: 0, months: 0, known: true })).toBe('Less than a month');
  });

  it('35. the exempt category says what it means for attendance', () => {
    expect(categoryLabel('MANAGEMENT_EXEMPT')).toMatch(/exempt/i);
    expect(categoryLabel('TEAM_LEADER')).toBe('Team Leader');
    expect(categoryLabel(null)).toBeNull();
    expect(categoryLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('month selection and historical truth', () => {
  it('36. THE SELECTOR NEVER OFFERS A FUTURE MONTH', () => {
    const options = monthOptions('2026-08-17', 6);
    expect(options[0]).toBe('2026-08');
    expect(options.every((m) => m <= '2026-08')).toBe(true);
  });

  it('37. it walks backwards across a year boundary correctly', () => {
    expect(monthOptions('2026-02-03', 4)).toEqual(['2026-02', '2026-01', '2025-12', '2025-11']);
  });

  it('38. a month renders by name, not as the wire format', () => {
    expect(formatMonthLabel('2026-08')).toMatch(/August/);
    expect(formatMonthLabel('2026-08')).toMatch(/2026/);
  });

  it('39. A CLOSED MONTH IS READ FROM THE LOCK FLAGS, NOT FROM THE DATE', () => {
    const closed = [day({ locked: true }), day({ businessDate: '2026-08-12', locked: true })];
    const open = [day({ locked: false }), day({ businessDate: '2026-08-12', locked: false })];
    const mixed = [day({ locked: true }), day({ businessDate: '2026-08-12', locked: false })];
    expect(monthLockState(closed)).toBe('LOCKED');
    expect(monthLockState(open)).toBe('OPEN');
    expect(monthLockState(mixed)).toBe('PARTIALLY_LOCKED');
  });

  it('40. days carrying no record do not keep a closed month permanently open', () => {
    const exemptAndClosed = [
      day({ locked: true }),
      day({ businessDate: '2026-08-12', status: null, evaluationState: null, notApplicable: true }),
    ];
    expect(monthLockState(exemptAndClosed)).toBe('LOCKED');
    expect(monthLockState([])).toBe('OPEN');
  });

  it('41. the closed note says what cannot be changed, and only when it is true', () => {
    expect(lockNote('LOCKED')).toMatch(/cannot be changed/i);
    expect(lockNote('PARTIALLY_LOCKED')).toMatch(/some days/i);
    expect(lockNote('OPEN')).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('leave and comp off are read, not recomputed', () => {
  it('42. THE THREE LEAVE FIGURES ARE THE SERVER’S OWN FIELDS, unmodified', () => {
    // A non-round balance: 7 allocated, 2.5 taken, 4.5 left. A screen doing its
    // own subtraction would still produce 4.5 here -- so the test that matters
    // is the next one, where the server's numbers deliberately do not add up.
    const row = leaveRow('Casual Leave', { allocation: 7, approved: 2.5, pending: 1, balance: 4.5 });
    expect(row).toEqual({ label: 'Casual Leave', accrued: 7, used: 2.5, remaining: 4.5 });
  });

  it('43. REMAINING IS NOT RECOMPUTED FROM ACCRUED MINUS USED', () => {
    // The server applies pending requests, carry-forward and policy rules this
    // screen knows nothing about, so its balance legitimately differs from the
    // subtraction. Whichever number the screen prints must be the server's.
    const row = leaveRow('Casual Leave', { allocation: 12, approved: 3, pending: 2, balance: 6.5 });
    expect(row.remaining).toBe(6.5);
    expect(row.remaining).not.toBe(12 - 3);
  });

  it('44. a balance that has not loaded is a dash, never zero', () => {
    expect(leaveRow('Casual Leave', undefined)).toEqual({
      label: 'Casual Leave', accrued: null, used: null, remaining: null,
    });
  });

  it('45. comp off counts by the status the server assigned', () => {
    // The available credit expires in November, well outside the expiring
    // window, so this test is about status counting alone -- test 48 is the one
    // about the window. A fixture 28 days out satisfies both at once and
    // therefore proves neither.
    const buckets = compOffBuckets(
      [
        credit({ id: 'a', status: 'AVAILABLE', expiresAt: '2026-11-20' }),
        credit({ id: 'b', status: 'USED' }),
        credit({ id: 'c', status: 'EXPIRED', expiresAt: '2026-05-01' }),
      ],
      new Date('2026-08-17T09:00:00.000Z'),
    );
    expect(buckets).toEqual({ available: 1, used: 1, expired: 1, expiringSoon: 0 });
  });

  it('46. A CREDIT STILL MARKED AVAILABLE WHOSE DATE HAS PASSED IS NOT AVAILABLE', () => {
    // Nothing sweeps that status on a schedule. Counting by status alone tells
    // somebody they hold two days when one lapsed in June.
    const buckets = compOffBuckets(
      [
        credit({ id: 'a', status: 'AVAILABLE', expiresAt: '2026-09-14' }),
        credit({ id: 'b', status: 'AVAILABLE', expiresAt: '2026-06-30' }),
      ],
      new Date('2026-08-17T09:00:00.000Z'),
    );
    expect(buckets.available).toBe(1);
    expect(buckets.expired).toBe(1);
  });

  it('47. THE LAST DAY IS INCLUSIVE: a credit expiring today is still usable today', () => {
    const buckets = compOffBuckets(
      [credit({ status: 'AVAILABLE', expiresAt: '2026-08-17' })],
      new Date('2026-08-17T09:00:00.000Z'),
    );
    expect(buckets.available).toBe(1);
    expect(buckets.expired).toBe(0);
  });

  it('48. only live credits count as expiring; a spent or lapsed one does not', () => {
    const soon = new Date('2026-08-17T09:00:00.000Z');
    const buckets = compOffBuckets(
      [
        credit({ id: 'a', status: 'AVAILABLE', expiresAt: '2026-08-25' }), // within 30 days
        credit({ id: 'b', status: 'USED', expiresAt: '2026-08-20' }),
        credit({ id: 'c', status: 'AVAILABLE', expiresAt: '2026-07-20' }), // lapsed
      ],
      soon,
    );
    expect(buckets.expiringSoon).toBe(1);
    expect(buckets.available).toBe(1);
  });

  it('49. no comp off at all is zero of everything, not a dash and not a guess', () => {
    expect(compOffBuckets([], new Date('2026-08-17T09:00:00.000Z')))
      .toEqual({ available: 0, used: 0, expired: 0, expiringSoon: 0 });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Static guards: what the SCREEN is forbidden from doing, checked in its source
// ════════════════════════════════════════════════════════════════════════════

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const FRONTEND = resolve(__dirname, '../../../frontend');
const read = (rel: string) => stripComments(readFileSync(resolve(FRONTEND, rel), 'utf8'));

const SCREEN = 'components/attendance/EmployeeAttendanceDashboard.tsx';
const PURE = 'components/attendance/employee-summary-presentation.ts';

/** Every useQuery({...}) block in a file, as raw text. */
function queryBlocks(code: string): string[] {
  const blocks: string[] = [];
  const marker = 'useQuery({';
  let at = code.indexOf(marker);
  while (at !== -1) {
    const end = code.indexOf('});', at);
    blocks.push(code.slice(at, end === -1 ? undefined : end));
    at = code.indexOf(marker, at + marker.length);
  }
  return blocks;
}

describe('the screen does not hold a second opinion about policy', () => {
  it('50. NO ARRIVAL, COMPLETION OR REQUIRED-HOURS FIGURE IS WRITTEN INTO EITHER FILE', () => {
    // 09:30, 18:30, nine hours as 540, and 18:30 as 1110 -- the four spellings
    // an invented default takes. Comments are stripped first: twice in this
    // programme a guard has been satisfied by the prose explaining it.
    for (const file of [SCREEN, PURE]) {
      const code = read(file);
      expect({ file, code: code.match(/\b(09:30|9:30|18:30)\b/) }).toEqual({ file, code: null });
      expect({ file, m: code.match(/\b540\b|\b1110\b|\b525\b/) }).toEqual({ file, m: null });
      expect({ file, m: code.match(/9\s*\*\s*60|18\s*\*\s*60/) }).toEqual({ file, m: null });
    }
  });

  it('51. PRESENCE IS NEVER COMPUTED, AND A BREAK IS NEVER SUBTRACTED FROM IT', () => {
    const code = read(SCREEN) + read(PURE);
    expect(code).not.toMatch(/officePresenceMinutes\s*-\s*/);
    // The property-access form is the one that matters and the one an earlier
    // version of this guard missed: `\w*` does not cross the dot in
    // `- day.breakMinutes`, so a break subtraction written the way anybody
    // would actually write it walked straight past the check. Mutation testing
    // found that; inspection had not.
    expect(code).not.toMatch(/-\s*\(?\s*[\w.?[\]]*[Bb]reakMinutes/);
    expect(code).not.toMatch(/presence\s*=\s*[^;]*break/i);
    // And presence is never read off the work field instead.
    expect(code).not.toMatch(/officePresence\w*\s*[:=]\s*\w*workedMinutes/);
  });

  it('52. NO LEAVE BALANCE IS RECOMPUTED IN THE BROWSER', () => {
    const code = read(SCREEN) + read(PURE);
    expect(code).not.toMatch(/allocation\s*-\s*/);
    expect(code).not.toMatch(/-\s*(approved|pending)\b/);
    expect(code).not.toMatch(/remaining\s*[:=]\s*[^,;]*[-+][^,;]*\b(allocation|approved)\b/);
  });

  it('53. NO COMP OFF FIGURE IS HARDCODED', () => {
    const code = read(SCREEN);
    // Each displayed credit figure traces to the bucket function, which traces
    // to the server's own rows -- never to a literal.
    for (const bucket of ['available', 'used', 'expired', 'expiringSoon']) {
      expect({ bucket, used: code.includes(`credits.${bucket}`) })
        .toEqual({ bucket, used: true });
    }
    expect(code).not.toMatch(/compOff\w*\s*[:=]\s*\d/);
  });

  it('54. the screen asserts no pay consequence anywhere', () => {
    const code = read(SCREEN) + read(PURE);
    // Pay NOUNS only. An earlier version of this guard also matched the word
    // "deducted" and failed on "breaks are not deducted" -- a sentence whose
    // whole purpose is to deny a deduction. A guard that reports a problem
    // which is not there teaches people to ignore it.
    expect(code).not.toMatch(/salary|payroll|wages?\b|₹|\bCTC\b/i);
    // And the two fields that DO carry a pay consequence are not rendered here:
    // how much leave a day consumed is HR's statement to make, not a summary's.
    expect(code).not.toMatch(/leaveDeducted|lwpDeducted/);
  });
});

describe('the screen asks, and never assumes, who may look', () => {
  it('55. EVERY PERSONAL READ WAITS FOR ITS VIEWER', () => {
    const blocks = queryBlocks(read(SCREEN));
    expect(blocks.length).toBeGreaterThanOrEqual(4);
    for (const block of blocks) {
      expect({ block, gated: /enabled:\s*[^,\n]*\b(viewerId|user)\b/.test(block) })
        .toEqual({ block, gated: true });
    }
  });

  it('56. THE SUMMARY CACHE KEY CARRIES BOTH VIEWER AND SUBJECT', () => {
    const code = read(SCREEN);
    const block = queryBlocks(code).find((b) => b.includes('employeeSummary'));
    expect(block).toBeDefined();
    expect(block).toMatch(/employeeSummary\(\s*viewerId\s*,\s*subjectId\s*,/);
    // Spelled through the factory, never as its own literal array.
    expect(code).not.toMatch(/\[\s*'employee-attendance-summary'/);
  });

  it('57. the key factory actually puts both of them in the returned array', () => {
    const factory = readFileSync(resolve(FRONTEND, 'lib/workday-status-keys.ts'), 'utf8');
    const at = factory.indexOf('employeeSummary: (');
    expect(at).toBeGreaterThan(-1);
    const body = factory.slice(at, factory.indexOf('as const', at));
    expect(body).toContain("viewerId ?? 'anonymous'");
    expect(body).toContain('subjectId');
    expect(body).toContain('month');
  });

  it('58. A SELF-SCOPED ENDPOINT IS NEVER READ WHILE LOOKING AT SOMEBODY ELSE', () => {
    // /leave/balance and /leave/comp-off/me answer for whoever is
    // authenticated and take no id. Rendering them beside another person's
    // name would print the VIEWER's entitlement under the SUBJECT's heading.
    const blocks = queryBlocks(read(SCREEN));
    const selfScoped = blocks.filter(
      (b) => /getMyLeaveBalance|getMyCompOffCredits/.test(b),
    );
    expect(selfScoped.length).toBe(3);
    for (const block of selfScoped) {
      expect({ block, gated: /enabled:[^,\n]*isSelf/.test(block) }).toEqual({ block, gated: true });
    }
  });

  it('59. isSelf compares the SUBJECT to the VIEWER, not the route’s own argument', () => {
    const code = read(SCREEN);
    expect(code).toMatch(/const\s+isSelf\s*=\s*[^;]*subjectId\s*===\s*viewerId/);
  });

  it('60. AN ARBITRARY EMPLOYEE IS ASKED FOR THROUGH THE ID ENDPOINT, never assumed allowed', () => {
    const code = read(SCREEN);
    // The id-taking client is used only when an id was actually passed in, and
    // the server decides the rest. Nothing in the screen gates on a role.
    expect(code).toMatch(/employeeId\s*&&\s*employeeId\s*!==\s*viewerId/);
    expect(code).not.toMatch(/role\s*===|isHR|isAdmin|user\.role/);
  });
});

describe('the screen states what it cannot know', () => {
  it('61. a failed load says the records are unaffected, not that there is no data', () => {
    const code = read(SCREEN);
    expect(code).toMatch(/could not be loaded/i);
    expect(code).toMatch(/unaffected/i);
  });

  it('62. THE MONTH SELECTOR IS BUILT FROM THE SERVER’S DATE, not the browser’s', () => {
    const code = read(SCREEN);
    expect(code).toMatch(/monthOptions\(\s*summary\.today\.businessDate/);
    expect(code).not.toMatch(/monthOptions\(\s*new Date/);
  });

  it('63. tenure falls back to words, never to a number the screen made up', () => {
    const code = read(SCREEN);
    expect(code).toMatch(/tenure\s*\?\?\s*'Not known'/);
    expect(code).not.toMatch(/tenure[^;]*\?\?\s*0/);
  });
});
