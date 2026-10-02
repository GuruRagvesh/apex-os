import {
  assessPresence,
} from '../../../frontend/components/attendance/attendance-presence';

/**
 * What the browser is still allowed to work out about a day.
 *
 * THE CLASSIFICATION TESTS ARE NOT HERE ANY MORE, AND THAT IS THE CHANGE.
 * assessPresence() used to hold its own 540 and decide whether a day met the
 * nine-hour requirement -- an official attendance decision taken in React,
 * free to disagree with the evaluator and with nothing able to notice. It had
 * already been wrong once: it compared ROUNDED minutes, so 08:59:59 rounded to
 * 540 and the day passed one second short.
 *
 * The requirement, the measured presence and the verdict now come from the
 * server and are passed straight through. The boundary cases that used to live
 * here are in daily-attendance-evaluator.spec.ts, against the code that now
 * decides them.
 *
 * WHAT REMAINS IS NOT ATTENDANCE STATE. Evidence coverage and the session span
 * describe what was RECORDED -- how many Workday sessions carry punch evidence,
 * and whether activity sits outside the evidenced span. Those are facts about
 * the record, not a judgement about the day, and the UI explaining them is the
 * whole reason the drawer is useful.
 */

const SERVER_SAYS_MET = {
  requiredPresenceMinutes: 540,
  serverPresenceMinutes: 540,
  meetsRequirement: true,
};

const scenario = (over: Partial<Parameters<typeof assessPresence>[0]> = {}) =>
  assessPresence({
    punchInAt: '2026-08-26T06:42:00.000Z', // 12:12 IST
    punchOutAt: '2026-08-26T06:45:00.000Z', // 12:15 IST
    workedMinutes: 158,
    firstSessionStart: '2026-08-26T04:05:00.000Z', // 09:35 IST
    lastSessionEnd: '2026-08-26T06:45:00.000Z',
    sessionCount: 3,
    unevidencedSessions: 2,
    requiredPresenceMinutes: 540,
    serverPresenceMinutes: 3,
    meetsRequirement: false,
    ...over,
  });

describe('the server decides the requirement, this module renders it', () => {
  it('PASSES THE VERDICT THROUGH rather than recomputing it', async () => {
    // The punches say three minutes. If this module still judged the day, no
    // arrangement of its inputs could make it report the requirement met --
    // which is exactly what proves it is not judging.
    const a = scenario({ ...SERVER_SAYS_MET });

    expect(a.meetsRequirement).toBe(true);
    expect(a.requiredMinutes).toBe(540);
  });

  it('reports a refusal the server gave, over punches that look complete', () => {
    const a = scenario({
      punchInAt: '2026-08-26T04:30:00.000Z',
      punchOutAt: '2026-08-26T13:30:00.000Z', // a full nine hours by the clock
      requiredPresenceMinutes: 540,
      serverPresenceMinutes: 539,
      meetsRequirement: false,
    });

    expect(a.meetsRequirement).toBe(false);
  });

  it('prefers the measured presence the server sent', () => {
    // The local span is a fallback for a day the server has not measured, not
    // a second opinion about one it has.
    const a = scenario({ serverPresenceMinutes: 537 });
    expect(a.presenceMinutes).toBe(537);
  });

  it('falls back to the local span only when the server has none', () => {
    // 12:12 to 12:15 IST.
    const a = scenario({ serverPresenceMinutes: null });
    expect(a.presenceMinutes).toBe(3);
  });

  it('CARRIES AN UNKNOWN VERDICT AS UNKNOWN, never as a failure', () => {
    // An unfinished day has not failed the requirement; it has not answered
    // it. Reporting false mid-morning would invent an exception.
    const a = scenario({
      punchOutAt: null,
      serverPresenceMinutes: null,
      meetsRequirement: null,
    });

    expect(a.meetsRequirement).toBeNull();
    expect(a.meetsRequirement).not.toBe(false);
    expect(a.presenceMinutes).toBeNull();
  });

  it('carries an absent requirement as absent, not as zero', () => {
    // A day that is not an attendance situation has no requirement. Zero would
    // read as "no time required", which every day trivially meets.
    const a = scenario({ requiredPresenceMinutes: null });
    expect(a.requiredMinutes).toBeNull();
    expect(a.requiredMinutes).not.toBe(0);
  });

  it('HOLDS NO REQUIREMENT CONSTANT OF ITS OWN', () => {
    // The guard against the whole defect returning. If this module ever
    // reacquires a 540, the next change can quietly start judging days again.
    const source = require('fs').readFileSync(
      require('path').resolve(
        __dirname,
        '../../../frontend/components/attendance/attendance-presence.ts',
      ),
      'utf8',
    );

    // Comments explain the history and are allowed to mention it; code is not.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    expect(code).not.toMatch(/\b540\b/);
    expect(code).not.toMatch(/>=\s*\w*[Rr]equired/);
  });
});

describe('what the browser still works out: evidence, not attendance', () => {
  // Worked 158m across 3 sessions from 09:35, but the evidenced punch pair is
  // 12:12 to 12:15. Both facts are true; they measure different things.
  it('reports worked minutes from the Workday sessions', () => {
    expect(scenario().workedMinutes).toBe(158);
  });

  it('flags activity that began before the evidenced span', () => {
    const a = scenario();
    expect(a.evidenceMismatch).toBe(true);
    expect(a.coverage).toBe('PARTIAL');
    expect(a.unevidencedSessions).toBe(2);
  });

  it('reports FULL coverage when every session carries evidence', () => {
    const a = scenario({
      unevidencedSessions: 0,
      sessionCount: 1,
      firstSessionStart: '2026-08-26T06:42:00.000Z',
      lastSessionEnd: '2026-08-26T06:45:00.000Z',
    });

    expect(a.coverage).toBe('FULL');
    expect(a.evidenceMismatch).toBe(false);
  });

  it('reports NONE when no session carries evidence', () => {
    const a = scenario({ unevidencedSessions: 3, sessionCount: 3 });
    expect(a.coverage).toBe('NONE');
  });

  it('reports NONE when there were no sessions at all', () => {
    const a = scenario({ sessionCount: 0, unevidencedSessions: 0 });
    expect(a.coverage).toBe('NONE');
  });

  it('measures the session span separately from presence', () => {
    // 09:35 to 12:15 IST is 160 minutes. It is NEVER substituted for presence,
    // which is the punch pair -- an earlier version of the UI compared the
    // requirement against this span and quietly redefined the policy.
    const a = scenario();
    expect(a.sessionSpanMinutes).toBe(160);
    expect(a.sessionSpanMinutes).not.toBe(a.presenceMinutes);
  });
});
