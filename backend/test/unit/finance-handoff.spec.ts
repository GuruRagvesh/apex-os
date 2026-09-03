import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  DELIVERY_FAILED,
  DELIVERY_SENT,
  DELIVERY_UNKNOWN,
  NO_PAYROLL_STATEMENT,
  attachmentFileName,
  classifyProviderResult,
  deliveryStatusFor,
  formatTimestamp,
  handoffSummaryRows,
  idempotencyKeyFor,
  IDEMPOTENCY_WINDOW_MS,
  firstAttemptStamp,
  mayContactProvider,
  withinIdempotencyWindow,
  monthFileToken,
  monthLabel,
  reportSubject,
  unresolvedWarning,
  type HandoffFacts,
} from '../../src/modules/platform/attendance/reports/finance-handoff';

/**
 * The monthly Finance handoff.
 *
 * This is the one thing Apex OS sends outside the company about people's
 * attendance. Every rule below is about a message an accountant will act on.
 */

const facts = (over: Partial<HandoffFacts> = {}): HandoffFacts => ({
  month: '2026-09',
  finalizedAt: new Date('2026-10-01T06:30:00.000Z'),
  finalizedByName: 'Priya',
  reference: 'mc-abc123',
  employees: 56,
  unresolvedDays: 0,
  employeesWithUnresolved: 0,
  ...over,
});

// ════════════════════════════════════════════════════════════════════════════
describe('what Finance receives is named for what it is', () => {
  it('1. the attachment is the final register, by month', () => {
    expect(attachmentFileName('2026-09')).toBe('APEX_OS_Final_Attendance_Register_Sep_2026.xlsx');
    expect(attachmentFileName('2026-01')).toBe('APEX_OS_Final_Attendance_Register_Jan_2026.xlsx');
    expect(attachmentFileName('2027-12')).toBe('APEX_OS_Final_Attendance_Register_Dec_2027.xlsx');
  });

  it('2. the subject names the real month, not a code', () => {
    expect(reportSubject('2026-09')).toBe('APEX OS | Final Attendance Register – September 2026');
    expect(reportSubject('2026-09')).not.toContain('2026-09');
  });

  it('3. months are rendered for people everywhere they are shown', () => {
    expect(monthLabel('2026-09')).toBe('September 2026');
    expect(monthFileToken('2026-09')).toBe('Sep_2026');
  });

  it('4. an unparseable month is refused rather than guessed', () => {
    for (const bad of ['2026', '2026-13', '2026-00', 'September', '', '26-09']) {
      expect(() => attachmentFileName(bad)).toThrow();
      expect(() => reportSubject(bad)).toThrow();
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('the body tells Finance what they are looking at', () => {
  it('5. states the period, when it was finalized, and by whom', () => {
    const rows = handoffSummaryRows(facts());
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));

    expect(byLabel['Attendance period']).toBe('September 2026');
    expect(byLabel['Finalized']).toMatch(/01 October 2026/);
    expect(byLabel['Finalized by']).toBe('Priya');
    expect(byLabel['Employees included']).toBe('56');
    expect(byLabel['Prepared by']).toMatch(/Apex OS/);
  });

  it('6. carries the reference when there is one, and omits it when there is not', () => {
    expect(handoffSummaryRows(facts()).some((r) => r.label === 'Reference')).toBe(true);
    expect(handoffSummaryRows(facts({ reference: null })).some((r) => r.label === 'Reference')).toBe(
      false,
    );
  });

  it('7. names HR rather than leaving a blank when the finalizer is unknown', () => {
    const rows = handoffSummaryRows(facts({ finalizedByName: null }));
    expect(rows.find((r) => r.label === 'Finalized by')!.value).toBe('HR');
  });

  it('8. shows a dash rather than an invented timestamp', () => {
    expect(formatTimestamp(null)).toBe('—');
    expect(formatTimestamp('not a date')).toBe('—');
    const rows = handoffSummaryRows(facts({ finalizedAt: null }));
    expect(rows.find((r) => r.label === 'Finalized')!.value).toBe('—');
  });

  it('9. says plainly that no payroll has been calculated', () => {
    // The sentence that must never be softened: an accountant needs to know the
    // arithmetic is still theirs.
    expect(NO_PAYROLL_STATEMENT).toMatch(/attendance facts only/i);
    expect(NO_PAYROLL_STATEMENT).toMatch(/has not calculated any salary/i);
    expect(NO_PAYROLL_STATEMENT).toMatch(/no payroll has been processed/i);
    expect(NO_PAYROLL_STATEMENT).toMatch(/leave balances are unaffected/i);
  });

  it('10. warns about unresolved days before the attachment is opened', () => {
    expect(unresolvedWarning(facts())).toBeNull();
    const warning = unresolvedWarning(facts({ employeesWithUnresolved: 3, unresolvedDays: 7 }));
    expect(warning).toContain('3 employee(s)');
    expect(warning).toContain('7 unresolved');
    expect(warning).toMatch(/not a settled attendance result/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('a retry must not become a second email', () => {
  const key = () => idempotencyKeyFor({ monthCloseId: 'mc-1', reportSha256: 'sha-abc' });

  it('11. the key identifies the REPORT, so a retry presents the same one', () => {
    expect(key()).toBe('attendance-final-report/mc-1/sha-abc');
    // Called again -- as a retry would -- it is identical. A random id per
    // attempt is the bug this exists to prevent.
    expect(key()).toBe(key());
  });

  it('12. a different report cannot collide with it', () => {
    const a = idempotencyKeyFor({ monthCloseId: 'mc-1', reportSha256: 'sha-abc' });
    const b = idempotencyKeyFor({ monthCloseId: 'mc-2', reportSha256: 'sha-abc' });
    const c = idempotencyKeyFor({ monthCloseId: 'mc-1', reportSha256: 'sha-xyz' });
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('13. refuses to invent a key when the report cannot be identified', () => {
    // A month with no stored fingerprint has not been finalized, and a key that
    // did not name the report would defeat the whole mechanism.
    expect(() => idempotencyKeyFor({ monthCloseId: 'mc-1', reportSha256: null })).toThrow();
    expect(() => idempotencyKeyFor({ monthCloseId: '', reportSha256: 'sha' })).toThrow();
  });

  it('14. the key contains no random component', () => {
    const source = readFileSync(
      resolve(__dirname, '../../src/modules/platform/attendance/reports/finance-handoff.ts'),
      'utf8',
    );
    const fn = source.slice(
      source.indexOf('export function idempotencyKeyFor'),
      source.indexOf('// ── Delivery outcome'),
    );
    for (const forbidden of ['randomUUID', 'Math.random', 'Date.now', 'new Date']) {
      expect(fn).not.toContain(forbidden);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('three delivery states, because two is a lie', () => {
  it('15. an accepted send with an id is SENT', () => {
    expect(classifyProviderResult({ id: 'msg-1' })).toEqual({
      outcome: 'SENT',
      providerId: 'msg-1',
    });
  });

  it('16. a request the provider understood and refused is REJECTED', () => {
    // Nothing was sent for any of these, so a retry is safe.
    for (const code of ['validation_error', 'invalid_from_address', 'invalid_api_key']) {
      expect(classifyProviderResult({ errorCode: code }).outcome).toBe('REJECTED');
    }
  });

  it('17. a transport throw is UNKNOWN, never REJECTED', () => {
    // THE ONE THAT MATTERS. The request left the process and never came back;
    // the mail may well have been delivered. Calling that a failure invites a
    // second copy of a payroll report.
    const result = classifyProviderResult({ threw: true, errorMessage: 'socket hang up' });
    expect(result.outcome).toBe('UNKNOWN');
    expect(result.outcome).not.toBe('REJECTED');
  });

  it('18. an in-flight duplicate is UNKNOWN, so nothing races it', () => {
    // concurrent_idempotent_requests means another attempt at THIS report is
    // already running. Firing a second differently-keyed request would be the
    // worst possible response.
    expect(classifyProviderResult({ errorCode: 'concurrent_idempotent_requests' }).outcome).toBe(
      'UNKNOWN',
    );
  });

  it('19. the same key with a different payload is refused, loudly', () => {
    // Our bug, not the provider's: the key is supposed to identify the report.
    const result = classifyProviderResult({ errorCode: 'invalid_idempotent_request' });
    expect(result.outcome).toBe('REJECTED');
    expect(result.reason).toBe('invalid_idempotent_request');
  });

  it('20. an unrecognised provider error is UNKNOWN, not assumed safe', () => {
    expect(classifyProviderResult({ errorCode: 'something_new_next_year' }).outcome).toBe('UNKNOWN');
    // Accepted with no id is not an acceptance anybody can evidence.
    expect(classifyProviderResult({ id: null }).outcome).toBe('UNKNOWN');
  });

  it('21. the stored status keeps the three apart', () => {
    expect(deliveryStatusFor('SENT')).toBe(DELIVERY_SENT);
    expect(deliveryStatusFor('REJECTED')).toBe(DELIVERY_FAILED);
    expect(deliveryStatusFor('UNKNOWN')).toBe(DELIVERY_UNKNOWN);
    expect(new Set([DELIVERY_SENT, DELIVERY_FAILED, DELIVERY_UNKNOWN]).size).toBe(3);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('an already-delivered month is refused before the provider is reached', () => {
  it('22. a month already sent does not silently send again', () => {
    const gate = mayContactProvider({ status: 'SENT', deliveryStatus: 'SENT' }, new Date());
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/already been sent/i);
    expect(gate.reason).toMatch(/second copy/i);
    // And it points at the right remedy rather than inviting a retry.
    expect(gate.reason).toMatch(/separate, audited action/i);
  });

  it('23. a rejected delivery is retryable; an unknown one only inside the window', () => {
    // FAILED means the provider refused before accepting anything, so nothing
    // was delivered and a retry cannot duplicate. UNKNOWN is different: the
    // retry is only safe while the provider still recognises the key, so it
    // needs a recorded first attempt to measure from. Timing is covered in
    // detail below.
    expect(mayContactProvider({ status: 'FINALIZED', deliveryStatus: 'FAILED' }, new Date()).allowed).toBe(true);
    expect(
      mayContactProvider({
        status: 'FINALIZED',
        deliveryStatus: 'UNKNOWN',
        deliveryFirstAttemptAt: new Date(),
      }, new Date()).allowed,
    ).toBe(true);
    // No recorded attempt: we cannot show the window is open, so we do not act
    // as though it is.
    expect(mayContactProvider({ status: 'FINALIZED', deliveryStatus: 'UNKNOWN' }, new Date()).allowed).toBe(
      false,
    );
  });

  it('24. never attempted is not the same as failed', () => {
    // NULL is load-bearing: nobody has tried.
    expect(mayContactProvider({ status: 'FINALIZED', deliveryStatus: null }, new Date()).allowed).toBe(true);
  });

  it('25. an unfinalized month is refused', () => {
    for (const status of ['OPEN', 'REVIEWING']) {
      const gate = mayContactProvider({ status, deliveryStatus: null }, new Date());
      expect(gate.allowed).toBe(false);
      expect(gate.reason).toMatch(/must be finalized/i);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('an UNKNOWN delivery may only retry while the provider still remembers', () => {
  const NOW = new Date('2026-10-02T12:00:00.000Z');
  const ago = (ms: number) => new Date(NOW.getTime() - ms);
  const unknown = (firstAttemptAt: Date | null) => ({
    status: 'FINALIZED',
    deliveryStatus: 'UNKNOWN',
    deliveryFirstAttemptAt: firstAttemptAt,
  });

  it('29. the window sits deliberately under the one the provider offers', () => {
    // Resend honours a key for about 24 hours. Being an hour too cautious costs
    // a human a decision; being an hour too confident costs Finance a duplicate.
    expect(IDEMPOTENCY_WINDOW_MS).toBeLessThan(24 * 60 * 60 * 1000);
    expect(IDEMPOTENCY_WINDOW_MS).toBe(23 * 60 * 60 * 1000);
  });

  it('30. a retry an hour later is allowed, with the same key', () => {
    const gate = mayContactProvider(unknown(ago(60 * 60 * 1000)), NOW);
    expect(gate.allowed).toBe(true);
  });

  it('31. a retry three days later is REFUSED, and says why', () => {
    // The case this whole change exists for. The provider has forgotten the
    // key, so the same retry would genuinely deliver a second copy.
    const gate = mayContactProvider(unknown(ago(3 * 24 * 60 * 60 * 1000)), NOW);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/delivery state is unknown/i);
    expect(gate.reason).toMatch(/idempotency window has expired/i);
    expect(gate.reason).toMatch(/verify with finance/i);
  });

  it('32. the boundary is inclusive on the safe side', () => {
    expect(withinIdempotencyWindow(ago(IDEMPOTENCY_WINDOW_MS), NOW)).toBe(true);
    expect(withinIdempotencyWindow(ago(IDEMPOTENCY_WINDOW_MS + 1), NOW)).toBe(false);
  });

  it('33. an UNKNOWN with no recorded attempt is refused, not assumed fresh', () => {
    // Conservative: we cannot show the window is still open, so we do not act
    // as though it is. This is also the pre-migration row.
    expect(withinIdempotencyWindow(null, NOW)).toBe(false);
    expect(mayContactProvider(unknown(null), NOW).allowed).toBe(false);
  });

  it('34. FAILED is retryable however old it is', () => {
    // The provider refused it before accepting anything, so nothing was
    // delivered and no duplicate is possible no matter how long ago.
    const old = {
      status: 'FINALIZED',
      deliveryStatus: 'FAILED',
      deliveryFirstAttemptAt: ago(90 * 24 * 60 * 60 * 1000),
    };
    expect(mayContactProvider(old, NOW).allowed).toBe(true);
  });

  it('35. never attempted is unaffected by the window', () => {
    expect(
      mayContactProvider(
        { status: 'FINALIZED', deliveryStatus: null, deliveryFirstAttemptAt: null },
        NOW,
      ).allowed,
    ).toBe(true);
  });

  it('36. an already-sent month is still refused regardless of the window', () => {
    const gate = mayContactProvider(
      { status: 'SENT', deliveryStatus: 'SENT', deliveryFirstAttemptAt: ago(1000) },
      NOW,
    );
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/already been sent/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('the first attempt is stamped once and never moved', () => {
  const NOW = new Date('2026-10-02T12:00:00.000Z');
  const EARLIER = new Date('2026-10-01T09:00:00.000Z');

  it('37. a first attempt is stamped now', () => {
    expect(firstAttemptStamp(null, NOW)).toEqual(NOW);
    expect(firstAttemptStamp(undefined, NOW)).toEqual(NOW);
  });

  it('38. A RETRY DOES NOT MOVE IT', () => {
    // The guard's whole load-bearing property. Refreshing this on each attempt
    // would slide the window forward forever and the expiry could never fire.
    expect(firstAttemptStamp(EARLIER, NOW)).toEqual(EARLIER);
    expect(firstAttemptStamp(EARLIER.toISOString(), NOW)).toEqual(EARLIER);
  });

  it('39. an unreadable stored value falls back to now rather than crashing', () => {
    expect(firstAttemptStamp('not a date', NOW)).toEqual(NOW);
  });

  it('40. send stamps it before contacting the provider, and only when absent', () => {
    const source = readFileSync(
      resolve(__dirname, '../../src/modules/platform/attendance/reports/payroll-report.service.ts'),
      'utf8',
    );
    const send = source.slice(source.indexOf('  async send('), source.indexOf('  async status('));

    const stampAt = send.indexOf('deliveryFirstAttemptAt: firstAttemptAt');
    const sendAt = send.indexOf('sendPayrollAttendanceReport');
    expect(stampAt).toBeGreaterThan(-1);
    // Timed by when we TRIED, not by when the attempt finished.
    expect(stampAt).toBeLessThan(sendAt);
    // Written only when there is not already one.
    expect(send).toContain('if (!close.deliveryFirstAttemptAt)');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('the handoff changes nothing it is reporting on', () => {
  const source = readFileSync(
    resolve(__dirname, '../../src/modules/platform/attendance/reports/finance-handoff.ts'),
    'utf8',
  );

  it('26. computes no salary, deduction or payroll figure', () => {
    for (const forbidden of ['salary', 'deduct', 'payable', 'netPay', 'grossPay']) {
      // The no-payroll STATEMENT mentions salary and deduction; that is the
      // point of it. Nothing else may.
      const withoutStatement = source.replace(/export const NO_PAYROLL_STATEMENT[\s\S]*?;/, '');
      expect(withoutStatement.toLowerCase()).not.toContain(`${forbidden}(`);
    }
  });

  it('27. touches no leave, no attendance and no close status', () => {
    for (const forbidden of ['leaveRequest', 'dailyAttendance', 'prisma', 'update(', 'upsert(']) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('28. the send path never finalizes or reopens a month', () => {
    const service = readFileSync(
      resolve(__dirname, '../../src/modules/platform/attendance/reports/payroll-report.service.ts'),
      'utf8',
    );
    const send = service.slice(service.indexOf('  async send('), service.indexOf('  async status('));
    expect(send).not.toContain("status: 'FINALIZED'");
    expect(send).not.toContain("status: 'REVIEWING'");
    expect(send).not.toContain('leaveRequest');
    expect(send).not.toContain('dailyAttendance');
    // The only status it may write is SENT.
    expect(send).toContain("status: 'SENT'");
  });
});
