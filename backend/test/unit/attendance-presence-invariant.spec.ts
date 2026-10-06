import { readFileSync } from 'fs';
import { resolve } from 'path';

// Attendance presence is punch out minus punch in. Nothing else.
//
// The evaluator used to fall back to summing Workday session spans when the
// punch pair was incomplete, which let operational Workday time satisfy an
// evidence-backed attendance requirement -- the one substitution the policy
// exists to prevent. AttendanceConsoleService and the employee's own view both
// already returned null there; the evaluator was the outlier.
//
// These are source-level invariants rather than behavioural cases because the
// evaluator needs a fully built DailyAttendanceContext plus punch, session and
// leave fixtures to run, and the rule being protected is a single expression.
// The behavioural coverage lives in attendance-evaluator specs; what is easy to
// regress silently is the FORM of this expression, so that is what is pinned.

const SRC = resolve(
  __dirname,
  '../../src/modules/platform/attendance/evaluation/daily-attendance-evaluator.service.ts',
);

const source = readFileSync(SRC, 'utf8');
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('presence is measured from punches, or not at all', () => {
  it('computes it only when BOTH punches exist', () => {
    expect(code).toMatch(
      /presenceSpanMinutes:\s*number \| null\s*=\s*\n?\s*punchInAt && punchOutAt/,
    );
  });

  it('is null when the pair is incomplete, never a number', () => {
    // `: null` and not `: 0`. Zero would read as "present for no time", which
    // is a measurement; null is the absence of one.
    const expr = code.slice(
      code.indexOf('presenceSpanMinutes'),
      code.indexOf('const permittedBreak') > 0
        ? code.length
        : code.length,
    );
    const assignment = expr.slice(0, expr.indexOf(';') + 1);

    expect(assignment).toMatch(/:\s*null;?$/m);
    expect(assignment).not.toMatch(/:\s*0[,;]/);
  });

  it('never sums Workday sessions into presence', () => {
    // The exact shape of the removed fallback.
    const assignment = code.slice(
      code.indexOf('presenceSpanMinutes'),
      code.indexOf('const permittedBreak'),
    );

    expect(assignment).not.toMatch(/closed\.reduce/);
    expect(assignment).not.toMatch(/startWorkAt/);
    expect(assignment).not.toMatch(/logoutAt/);
    expect(assignment).not.toMatch(/sess\./);
  });

  it('guards the shortfall check against an unmeasurable presence', () => {
    // Without the null guard, `null < 540` coerces to `0 < 540` and every
    // incomplete day would be reported as an insufficient-presence shortfall --
    // a finding invented from a measurement that was never taken.
    expect(code).toMatch(
      /presenceSpanMinutes !== null && presenceSpanMinutes < requiredSpan/,
    );
  });

  it('proves the coercion this guard prevents', () => {
    // Documents WHY the guard is needed rather than asserting on source alone.
    const requiredSpan = 540;
    const unmeasured = null as number | null;

    expect((unmeasured as any) < requiredSpan).toBe(true); // the trap
    expect(unmeasured !== null && unmeasured < requiredSpan).toBe(false); // guarded
  });
});

describe('the boundary arithmetic', () => {
  // The comparison is `<`, so the requirement is "at least", not "more than".
  const shortfall = (presence: number | null, required = 540) =>
    presence !== null && presence < required;

  it.each([
    [539, true],
    [540, false],
    [541, false],
  ])('%i minutes -> shortfall %s', (presence, expected) => {
    expect(shortfall(presence)).toBe(expected);
  });

  it('reports no shortfall when presence cannot be measured', () => {
    expect(shortfall(null)).toBe(false);
  });

  it('still measures a genuinely zero-length presence', () => {
    // Punch in and out at the same instant is measurable and is a shortfall.
    expect(shortfall(0)).toBe(true);
  });
});

describe('every incomplete case still reaches a human', () => {
  it('a missing punch out returns early with forced review', () => {
    expect(code).toMatch(/if \(punchIn && !punchOut && !correctedOut\)/);
    const block = code.slice(code.indexOf('if (punchIn && !punchOut && !correctedOut)'));

    expect(block.slice(0, 600)).toMatch(/forceReview: true/);
    expect(block.slice(0, 600)).toMatch(/INCOMPLETE_PUNCH_PAIR/);
  });

  it('no punch evidence raises MISSING_PUNCH, which is not review-exempt', () => {
    expect(code).toMatch(/if \(!punchIn\) \{\s*flags\.push\('MISSING_PUNCH'\)/);

    const types = readFileSync(
      resolve(__dirname, '../../src/modules/platform/attendance/evaluation/daily-attendance.types.ts'),
      'utf8',
    );
    const nonReview = types.slice(types.indexOf('NON_REVIEW_FLAGS'));

    // Only a settled correction is exempt. If MISSING_PUNCH were added here,
    // declining to measure presence WOULD lose signal.
    expect(nonReview.slice(0, 200)).toMatch(/\['CORRECTED_BY_REGULARIZATION'\]/);
    expect(nonReview.slice(0, 200)).not.toMatch(/MISSING_PUNCH/);
  });
});

describe('the other two surfaces already agreed', () => {
  it('the console returns null for an incomplete pair', () => {
    const console = readFileSync(
      resolve(__dirname, '../../src/modules/platform/attendance/console/attendance-console.service.ts'),
      'utf8',
    );
    const assignment = console.slice(
      console.indexOf('const presenceSpanMinutes'),
      console.indexOf('return {', console.indexOf('const presenceSpanMinutes')),
    );

    expect(assignment).toMatch(/official\?\.punchInAt && official\?\.punchOutAt/);
    expect(assignment).toMatch(/:\s*null;/);
  });

  it("the employee's own view returns null too", () => {
    const presence = readFileSync(
      resolve(__dirname, '../../../frontend/components/attendance/attendance-presence.ts'),
      'utf8',
    );

    // minutesBetween returns null unless both instants exist.
    expect(presence).toMatch(/if \(!a \|\| !b\) return null;/);
    expect(presence).toMatch(/const presenceMinutes = minutesBetween\(input\.punchInAt, input\.punchOutAt\)/);
  });
});
