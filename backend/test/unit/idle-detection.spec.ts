import * as fs from 'fs';
import * as path from 'path';
import {
  IDLE_CLAIM_TTL_MS,
  IDLE_EPISODE_CLAIM_PREFIX,
  IDLE_REPORT_MS,
  IDLE_RETRY_MS,
  IDLE_SUGGEST_END_MS,
  IDLE_WARNING_MS,
  idleDetectionEnabled,
  idleEpisodeKey,
  idleState,
  latestActivity,
  acceptActivityTimestamp,
  mergeActivity,
  claimIdleEpisode,
  releaseIdleEpisode,
  pruneIdleEpisodeClaims,
  type ClaimStorage,
  parseStoredActivity,
  shouldReportIdle,
} from '../../../frontend/lib/idle-detection';

// Phase 5A: the idle workflow's rules (pure) and its wiring (source). The
// backend transitions are proven in test/integration-pg/t14.

const REPO = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const ready = { isLoading: false, isError: false };
const working = { session: { id: 's1', status: 'WORKING', logoutAt: null } };

describe('idle detection rules', () => {
  it('runs only while the backend reports WORKING in an open session', () => {
    expect(idleDetectionEnabled(working, ready)).toBe(true);
    for (const status of ['OFFLINE', 'LOGGED_OUT', 'AUTO_CLOSED', 'ON_BREAK', 'ON_LEAVE', 'IDLE', 'LOGGED_IN']) {
      expect(idleDetectionEnabled({ session: { id: 's1', status, logoutAt: null } }, ready)).toBe(false);
    }
    expect(idleDetectionEnabled({ session: { id: 's1', status: 'WORKING', logoutAt: '2026-10-02T12:00:00Z' } }, ready)).toBe(false);
    expect(idleDetectionEnabled({ ...working, onLeaveToday: true }, ready)).toBe(false);
    expect(idleDetectionEnabled(working, { isLoading: true, isError: false })).toBe(false);
    expect(idleDetectionEnabled(working, { isLoading: false, isError: true })).toBe(false);
    expect(idleDetectionEnabled(null, ready)).toBe(false);
    expect(idleDetectionEnabled({ session: null }, ready)).toBe(false);
  });

  it('thresholds: warning at 10 minutes, report at 20, end-of-day suggestion at 45', () => {
    const t0 = 1_000_000_000_000;
    expect(idleState(t0 + IDLE_WARNING_MS - 1, t0).phase).toBe('ACTIVE');
    expect(idleState(t0 + IDLE_WARNING_MS, t0).phase).toBe('WARNING');
    expect(idleState(t0 + IDLE_REPORT_MS, t0)).toMatchObject({ phase: 'IDLE', idleMinutes: 20, suggestEndOfDay: false });
    expect(idleState(t0 + IDLE_SUGGEST_END_MS, t0)).toMatchObject({ phase: 'IDLE', idleMinutes: 45, suggestEndOfDay: true });
  });

  it('measures elapsed time from timestamps: after sleep or a background tab the real gap counts at once', () => {
    const t0 = 1_000_000_000_000;
    // No ticks ran for 37 minutes (laptop asleep); the first evaluation sees all of it.
    expect(idleState(t0 + 37 * 60_000 + 30_000, t0)).toMatchObject({ phase: 'IDLE', idleMinutes: 37 });
    // A clock that moved backwards never yields negative idle time.
    expect(idleState(t0 - 5_000, t0)).toMatchObject({ phase: 'ACTIVE', idleMs: 0 });
  });

  it('activity anywhere resets it: the latest activity across tabs wins', () => {
    expect(latestActivity(100, 300, 200)).toBe(300);
    expect(latestActivity(100, null, undefined, NaN)).toBe(100);
    expect(parseStoredActivity('1790000000000')).toBe(1790000000000);
    expect(parseStoredActivity('garbage')).toBe(0);
    expect(parseStoredActivity(null)).toBe(0);
  });

  it('one report per idle episode; none while disabled, in flight, or right after a failure', () => {
    const base = { enabled: true, phase: 'IDLE' as const, inFlight: false, episodeReported: false, lastFailureAtMs: null, nowMs: 10_000_000 };
    expect(shouldReportIdle(base)).toBe(true);
    expect(shouldReportIdle({ ...base, episodeReported: true })).toBe(false);
    expect(shouldReportIdle({ ...base, inFlight: true })).toBe(false);
    expect(shouldReportIdle({ ...base, enabled: false })).toBe(false);
    expect(shouldReportIdle({ ...base, phase: 'WARNING' })).toBe(false);
    expect(shouldReportIdle({ ...base, lastFailureAtMs: base.nowMs - 1_000 })).toBe(false);
    expect(shouldReportIdle({ ...base, lastFailureAtMs: base.nowMs - IDLE_RETRY_MS })).toBe(true); // retry after the backoff
  });

  it('episode keys are per session and per idle start, identical across tabs', () => {
    expect(idleEpisodeKey('s1', 123)).toBe(idleEpisodeKey('s1', 123));
    expect(idleEpisodeKey('s1', 123)).not.toBe(idleEpisodeKey('s1', 456)); // new activity → new episode
    expect(idleEpisodeKey('s1', 123)).not.toBe(idleEpisodeKey('s2', 123));
  });
});

describe('future-dated shared activity cannot suppress idle', () => {
  const now = 1_790_000_000_000;

  it('a stored timestamp 30 s ahead is accepted (small clock differences work)', () => {
    expect(acceptActivityTimestamp(String(now + 30_000), now)).toBe(now + 30_000);
    expect(mergeActivity(now - 5 * 60_000, now, String(now + 30_000))).toBe(now + 30_000);
  });

  it('a stored timestamp more than 60 s ahead is ignored and never replaces valid local activity', () => {
    const local = now - 25 * 60_000;
    expect(acceptActivityTimestamp(String(now + 61_000), now)).toBe(0);
    expect(mergeActivity(local, now, String(now + 3_600_000))).toBe(local);
  });

  it('a BroadcastChannel timestamp more than 60 s ahead is ignored', () => {
    const local = now - 21 * 60_000;
    expect(mergeActivity(local, now, now + 10 * 60_000)).toBe(local);
    expect(mergeActivity(local, now, 'garbage', -5, Number.NaN, Infinity)).toBe(local);
  });

  it('a poisoned in-memory value (far in the future) recovers to now', () => {
    expect(mergeActivity(now + 2 * 3_600_000, now)).toBe(now);
    expect(mergeActivity(now + 2 * 3_600_000, now, String(now - 60_000))).toBe(now);
  });

  it('a future timestamp cannot prevent the warning or the idle report', () => {
    const lastReal = now - 22 * 60_000;
    const merged = mergeActivity(lastReal, now, String(now + 24 * 3_600_000), now + 3_600_000);
    expect(idleState(now, merged).phase).toBe('IDLE');
    const warn = mergeActivity(now - 11 * 60_000, now, String(now + 3_600_000));
    expect(idleState(now, warn).phase).toBe('WARNING');
    // Even a poisoned memory value only resets the clock to now; it then counts normally.
    const recovered = mergeActivity(now + 3_600_000, now);
    expect(idleState(recovered + IDLE_REPORT_MS, recovered).phase).toBe('IDLE');
  });

  it('ordinary cross-tab activity still wins when it is the latest', () => {
    expect(mergeActivity(now - 15 * 60_000, now, String(now - 2_000), now - 30_000)).toBe(now - 2_000);
  });
});

/** An in-memory stand-in for window.localStorage. */
function memoryStorage(initial: Record<string, string> = {}): ClaimStorage & { dump(): Record<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    get length() { return data.size; },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => (data.has(k) ? data.get(k)! : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    dump: () => Object.fromEntries(data),
  };
}

describe('bounded idle-episode claims', () => {
  const now = 1_790_000_000_000;
  const key = (sid: string, at: number) => idleEpisodeKey(sid, at);

  it('stale claims are cleaned; current claims and unrelated keys stay untouched', () => {
    const store = memoryStorage({
      [key('s1', 1)]: String(now - IDLE_CLAIM_TTL_MS - 1),   // stale
      [key('s1', 2)]: 'not-a-time',                           // unreadable
      [key('s1', 3)]: String(now + 10 * 60_000),             // future-dated (poisoned)
      [key('s1', 4)]: String(now - 60_000),                  // current (another tab's in-flight claim)
      'apex:last-activity-at': String(now),
      'apex_token': 'keep-me',
      'theme': 'dark',
      'apex:idle-episode-lookalike': '1',                   // similar name, different prefix: untouched
    });
    const removed = pruneIdleEpisodeClaims(store, now);
    expect(removed.sort()).toEqual([key('s1', 1), key('s1', 2), key('s1', 3)].sort());
    expect(store.dump()).toEqual({
      [key('s1', 4)]: String(now - 60_000),
      'apex:last-activity-at': String(now),
      'apex_token': 'keep-me',
      'theme': 'dark',
      'apex:idle-episode-lookalike': '1',
    });
  });

  it('a current claim held by another tab is respected (no second report)', () => {
    const store = memoryStorage({ [key('s1', 5)]: String(now - 5_000) });
    expect(claimIdleEpisode(store, key('s1', 5), now)).toBe(false);
    expect(store.getItem(key('s1', 5))).toBe(String(now - 5_000));
  });

  it('a successful report keeps its claim, so the episode is applied once', () => {
    const store = memoryStorage();
    expect(claimIdleEpisode(store, key('s1', 6), now)).toBe(true);
    // Another tab, seconds later, same episode: refused.
    expect(claimIdleEpisode(store, key('s1', 6), now + 3_000)).toBe(false);
  });

  it('a failed report releases its claim and is retryable after the backoff', () => {
    const store = memoryStorage();
    expect(claimIdleEpisode(store, key('s1', 7), now)).toBe(true);
    releaseIdleEpisode(store, key('s1', 7));
    const retry = { enabled: true, phase: 'IDLE' as const, inFlight: false, episodeReported: false, lastFailureAtMs: now, nowMs: now + 1_000 };
    expect(shouldReportIdle(retry)).toBe(false);                                   // inside the backoff
    expect(shouldReportIdle({ ...retry, nowMs: now + IDLE_RETRY_MS })).toBe(true);  // after it
    expect(claimIdleEpisode(store, key('s1', 7), now + IDLE_RETRY_MS)).toBe(true);
  });

  it('the claim store stays bounded over many episodes', () => {
    const store = memoryStorage({ other: 'x' });
    for (let i = 0; i < 200; i += 1) {
      claimIdleEpisode(store, key('s1', i), now + i * 10 * 60_000); // one episode every 10 minutes
    }
    const claims = Object.keys(store.dump()).filter((k) => k.startsWith(IDLE_EPISODE_CLAIM_PREFIX));
    expect(claims.length).toBeLessThanOrEqual(Math.ceil(IDLE_CLAIM_TTL_MS / (10 * 60_000)) + 1);
    expect(store.getItem('other')).toBe('x');
  });
});

describe('idle workflow wiring', () => {
  const layout = read('frontend/app/(dashboard)/layout.tsx');
  const workflow = read('frontend/components/workday/IdleWorkflow.tsx');
  const popup = read('frontend/components/workday/IdlePopup.tsx');
  const hook = read('frontend/hooks/useIdleDetection.ts');
  const bar = read('frontend/components/workday/WorkdayBar.tsx');

  it('is mounted exactly once, in the authenticated dashboard shell', () => {
    expect(layout.split('<IdleWorkflow />').length - 1).toBe(1);
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]);
    const elsewhere = ['frontend/app', 'frontend/components', 'platforms']
      .map((d) => path.join(REPO, d))
      .flatMap((d) => walk(d))
      .filter((f) => /\.tsx$/.test(f) && fs.readFileSync(f, 'utf8').includes('<IdleWorkflow'));
    expect(elsewhere.map((f) => path.relative(REPO, f).replace(/\\/g, '/'))).toEqual(['frontend/app/(dashboard)/layout.tsx']);
  });

  it('is enabled from the backend workday only, and reports through the existing endpoint once per episode', () => {
    expect(workflow).toContain('idleDetectionEnabled(today as any, { isLoading, isError })');
    expect(workflow).toContain('workdayApi.reportIdle(idle.idleMinutes)');
    expect(workflow).toContain('claimEpisode(episode)');
    expect(workflow).not.toMatch(/ticket\??\.status/);
    // The prompt follows the backend state (IDLE), in every tab.
    expect(workflow).toContain("status === 'IDLE'");
  });

  it('refreshes the workday, the running clock and ticket views after any idle transition, in every tab', () => {
    expect(workflow).toContain('qc.invalidateQueries({ queryKey: WORKDAY_TODAY_QUERY_KEY })');
    expect(workflow).toContain('qc.invalidateQueries({ queryKey: ACTIVE_TIMER_QUERY_KEY })');
    expect(workflow).toContain("type: 'workday-changed'");
  });

  it('measures from timestamps and shares activity across tabs', () => {
    expect(hook).toContain('idleState(now, lastActivityRef.current)');
    // Every shared source goes through the timestamp acceptance rule.
    expect(hook).toContain('mergeActivity(lastActivityRef.current, now, readShared())');
    expect(hook).toContain('mergeActivity(lastActivityRef.current, Date.now(), e.data.at)');
    expect(hook).not.toContain('latestActivity(');
    expect(hook).toContain('LAST_ACTIVITY_STORAGE_KEY');
    expect(hook).toContain("document.addEventListener('visibilitychange'");
    for (const e of ['mousemove', 'keydown', 'pointerdown', 'touchstart', 'scroll']) expect(hook).toContain(`'${e}'`);
  });

  it('the prompt: Resume / Take a Break / End Workday through the existing workday authority, accessible, no double submit', () => {
    expect(popup).toContain('workdayApi.resumeWork()');
    expect(popup).toContain('<BreakModal');
    expect(popup).toContain('<PunchModal');
    expect(popup).toContain('<EndDayModal');
    expect(popup).toContain('role="dialog"');
    expect(popup).toContain('aria-live="assertive"');
    expect(popup).toContain('if (pending) return;');
    expect(popup).not.toContain('workdayApi.startBreak');   // the break modal owns it
    expect(popup).not.toContain('workdayApi.endWork');      // End Day / Punch Out own it
  });

  it('the workday bar opens Break and End Day from the idle state too', () => {
    const idleBranch = bar.slice(bar.indexOf("if (status === 'IDLE')"), bar.indexOf('// WORKING state'));
    expect(idleBranch).toContain('<BreakModal');
    expect(idleBranch).toContain('<EndDayModal');
  });
});
