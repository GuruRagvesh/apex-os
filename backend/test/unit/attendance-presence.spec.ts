import {
  assessPresence,
  REQUIRED_PRESENCE_MINUTES,
} from '../../../frontend/components/attendance/attendance-presence';

// Attendance presence is defined by policy as punch out minus punch in, and the
// 540-minute requirement applies to that and nothing else. A previous UI change
// compared 540 against the Workday session span instead, which quietly
// redefined the rule while looking like a labelling fix. These tests exist to
// make that specific mistake fail loudly.

const scenario = (over: Partial<Parameters<typeof assessPresence>[0]> = {}) =>
  assessPresence({
    punchInAt: '2026-08-26T06:42:00.000Z', // 12:12 IST
    punchOutAt: '2026-08-26T06:45:00.000Z', // 12:15 IST
    workedMinutes: 158,
    firstSessionStart: '2026-08-26T04:05:00.000Z', // 09:35 IST
    lastSessionEnd: '2026-08-26T06:45:00.000Z',
    sessionCount: 3,
    unevidencedSessions: 2,
    ...over,
  });

describe('the staging record that prompted this rule', () => {
  // Worked 158m across 3 sessions from 09:35, but the evidenced punch pair is
  // 12:12 to 12:15. Both facts are true; they measure different things.
  const a = scenario();

  it('reports worked minutes from the Workday sessions', () => {
    expect(a.workedMinutes).toBe(158);
  });

  it('reports attendance presence as punch out minus punch in', () => {
    expect(a.presenceMinutes).toBe(3);
  });

  it('compares the requirement against presence, NOT the session span', () => {
    expect(a.requiredMinutes).toBe(540);
    expect(a.meetsRequirement).toBe(false);
    // The session span is 160 minutes. If the requirement were ever wired to
    // it, presence would stop being the deciding measure -- which is the exact
    // regression this asserts against.
    expect(a.sessionSpanMinutes).toBe(160);
    expect(a.presenceMinutes).not.toBe(a.sessionSpanMinutes);
  });

  it('never folds unevidenced Workday activity into presence', () => {
    // 158 worked minutes must not become 158 minutes of official presence.
    expect(a.presenceMinutes).toBe(3);
    expect(a.presenceMinutes).not.toBe(a.workedMinutes);
    expect(a.presenceMinutes! < a.workedMinutes).toBe(true);
  });

  it('displays the session span separately as operational data', () => {
    expect(a.sessionSpanMinutes).toBe(160);
    expect(a.sessionCount).toBe(3);
  });

  it('exposes the evidence/workday mismatch so the UI can explain it', () => {
    expect(a.evidenceMismatch).toBe(true);
    expect(a.coverage).toBe('PARTIAL');
    expect(a.unevidencedSessions).toBe(2);
  });
});

describe('presence semantics', () => {
  it('uses the policy constant, not an invented number', () => {
    expect(REQUIRED_PRESENCE_MINUTES).toBe(540);
  });

  it('meets the requirement on a genuine full day', () => {
    // 10:00 to 19:00 IST is exactly 540 minutes of presence.
    const a = scenario({
      punchInAt: '2026-08-26T04:30:00.000Z',
      punchOutAt: '2026-08-26T13:30:00.000Z',
      firstSessionStart: '2026-08-26T04:30:00.000Z',
      lastSessionEnd: '2026-08-26T13:30:00.000Z',
      sessionCount: 1,
      unevidencedSessions: 0,
      workedMinutes: 480,
    });

    expect(a.presenceMinutes).toBe(540);
    expect(a.meetsRequirement).toBe(true);
    // Worked is lower because breaks are excluded. That does not fail the day.
    expect(a.workedMinutes).toBe(480);
    expect(a.evidenceMismatch).toBe(false);
    expect(a.coverage).toBe('FULL');
  });

  it('falls short at one minute under, without rounding it away', () => {
    const a = scenario({
      punchInAt: '2026-08-26T04:30:00.000Z',
      punchOutAt: '2026-08-26T13:29:00.000Z',
      unevidencedSessions: 0,
      sessionCount: 1,
    });

    expect(a.presenceMinutes).toBe(539);
    expect(a.meetsRequirement).toBe(false);
  });

  it('treats an unfinished day as unknown, not as failing', () => {
    // A day still in progress has not failed the requirement; it has not
    // answered it. Reporting false mid-morning would invent an exception.
    const a = scenario({ punchOutAt: null });

    expect(a.presenceMinutes).toBeNull();
    expect(a.meetsRequirement).toBeNull();
    expect(a.meetsRequirement).not.toBe(false);
  });

  it('treats a day with no punch at all as unknown presence', () => {
    const a = scenario({ punchInAt: null, punchOutAt: null, unevidencedSessions: 3 });

    expect(a.presenceMinutes).toBeNull();
    expect(a.meetsRequirement).toBeNull();
    expect(a.coverage).toBe('NONE');
    expect(a.evidenceMismatch).toBe(true);
  });

  it('never returns a negative presence from reversed timestamps', () => {
    const a = scenario({
      punchInAt: '2026-08-26T06:45:00.000Z',
      punchOutAt: '2026-08-26T06:42:00.000Z',
    });

    expect(a.presenceMinutes).toBe(0);
  });
});

describe('evidence coverage', () => {
  it('is FULL when every session carries evidence', () => {
    const a = scenario({ sessionCount: 3, unevidencedSessions: 0, firstSessionStart: null });

    expect(a.coverage).toBe('FULL');
    expect(a.evidenceMismatch).toBe(false);
  });

  it('flags a mismatch when Workday began before the first punch', () => {
    // Even with every session nominally evidenced, activity starting before
    // the evidenced span is a discrepancy worth explaining.
    const a = scenario({ sessionCount: 1, unevidencedSessions: 0 });

    expect(a.evidenceMismatch).toBe(true);
  });

  it('reports no mismatch when there was no Workday activity at all', () => {
    const a = scenario({
      sessionCount: 0,
      unevidencedSessions: 0,
      firstSessionStart: null,
      lastSessionEnd: null,
      workedMinutes: 0,
    });

    expect(a.coverage).toBe('NONE');
    expect(a.evidenceMismatch).toBe(false);
  });
});
