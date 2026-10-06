import * as fs from 'fs';
import * as path from 'path';

// Phase 6C: automatic idle detection is retired. A punched-in day stays
// WORKING until the person starts a break, ends the day or punches out. These
// are source checks over the frontend (it has no test runner of its own); the
// backend half is proven against PostgreSQL in test/integration-pg/t18.

const REPO = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(REPO, rel));

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return ['node_modules', '.next', 'dist'].includes(e.name) ? [] : walk(path.join(dir, e.name));
    return /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : [];
  });
}
const sources = ['frontend', 'platforms', 'shared']
  .flatMap((d) => walk(path.join(REPO, d)))
  .map((f) => ({ file: path.relative(REPO, f).replace(/\\/g, '/'), text: fs.readFileSync(f, 'utf8') }));
const filesContaining = (re: RegExp) => sources.filter((s) => re.test(s.text)).map((s) => s.file);

describe('automatic idle detection is gone from the frontend', () => {
  it('the idle detector, idle prompt, warning toast and recovery modal no longer exist', () => {
    for (const rel of [
      'frontend/lib/idle-detection.ts',
      'frontend/hooks/useIdleDetection.ts',
      'frontend/components/workday/IdleWorkflow.tsx',
      'frontend/components/workday/IdlePopup.tsx',
      'frontend/components/workday/IdleWarningToast.tsx',
      'frontend/components/workday/SessionRecoveryModal.tsx',
    ]) expect(exists(rel)).toBe(false);
  });

  it('nothing imports or mounts them', () => {
    expect(filesContaining(/idle-detection|useIdleDetection|IdleWorkflow|IdlePopup|IdleWarningToast|SessionRecoveryModal/)).toEqual([]);
    expect(read('frontend/app/(dashboard)/layout.tsx')).not.toMatch(/Idle/);
  });

  it('nothing can call the idle endpoint: the client function is removed and no source names the route', () => {
    expect(read('frontend/lib/api.ts')).not.toContain('reportIdle');
    expect(filesContaining(/reportIdle|['"`]\/workday\/idle['"`]/)).toEqual([]);
  });

  it('no full-screen idle dialog text remains anywhere', () => {
    expect(filesContaining(/been inactive|appear inactive|Welcome back!|Save & Resume Work/)).toEqual([]);
  });

  it('no visibility or focus handler exists that could pause or resume the workday', () => {
    expect(filesContaining(/addEventListener\(\s*['"](visibilitychange|focus|blur|pagehide|pageshow)['"]/)).toEqual([]);
  });
});

describe('the workday controls keep their manual actions and lose only the idle Resume', () => {
  const bar = read('frontend/components/workday/WorkdayBar.tsx');
  const idleBranch = bar.slice(bar.indexOf("if (status === 'IDLE')"), bar.indexOf('// WORKING state'));

  it('an IDLE day (legacy only) shows no Resume and continues only through Break or End Day', () => {
    expect(idleBranch.length).toBeGreaterThan(0);
    expect(idleBranch).not.toMatch(/Resume/);
    expect(idleBranch).not.toContain('handleResumeWork');
    expect(idleBranch).toContain('setShowBreakModal(true)');
    expect(idleBranch).toContain('<BreakModal');
    expect(idleBranch).toContain('<EndDayModal');
  });

  it('POST /workday/resume is reachable only from the explicit auto-closed Resume Workday button', () => {
    const callers = filesContaining(/workdayApi\.resumeWork\(/);
    expect(callers).toEqual(['frontend/components/workday/WorkdayBar.tsx']);
    // handleResumeWork is wired to exactly one control, in the AUTO_CLOSED branch.
    const uses = bar.split('onClick={handleResumeWork}').length - 1;
    expect(uses).toBe(1);
    const autoClosed = bar.slice(bar.indexOf("if (status === 'AUTO_CLOSED')"), bar.indexOf("if (status === 'LOGGED_OUT')"));
    expect(autoClosed).toContain('onClick={handleResumeWork}');
  });

  it('every workday mutation in the frontend runs from a click handler, never from an effect', () => {
    const mutation = /workdayApi\.(startWork|endWork|startBreak|endBreak|resumeWork|resumeAutoClosedWork|continueWorking)\(/;
    for (const { file, text } of sources.filter((s) => mutation.test(s.text))) {
      // Cut each useEffect body and make sure none of them holds a mutation.
      const effects = text.split(/useEffect\(/).slice(1).map((chunk) => chunk.slice(0, chunk.indexOf('}, [') + 1 || undefined));
      for (const body of effects) expect({ file, mutationInEffect: mutation.test(body) }).toEqual({ file, mutationInEffect: false });
    }
  });

  it('Start Break, End Break, End Day, Punch In/Out and Start Work are still wired as before', () => {
    expect(bar).toContain('await workdayApi.startWork()');
    expect(bar).toContain('await workdayApi.endBreak()');
    expect(bar).toContain("setPunchType('PUNCH_IN')");
    expect(bar).toContain("setPunchType('PUNCH_OUT')");
    expect(read('frontend/components/workday/BreakModal.tsx')).toContain('workdayApi.startBreak(');
    expect(read('frontend/components/workday/EndDayModal.tsx')).toContain('workdayApi.endWork()');
  });
});

describe('the backend keeps its idle support dormant for compatibility', () => {
  it('the endpoint and the transition are unchanged (historical IDLE rows stay readable)', () => {
    const controller = read('backend/src/modules/platform/workday/workday.controller.ts');
    expect(controller).toContain("@Post('idle')");
    expect(read('backend/src/modules/platform/workday/workday.service.ts')).toContain('async reportIdle(');
  });
});
