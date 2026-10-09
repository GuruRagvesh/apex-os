/**
 * Phase 6E selected shared UI: View All popup, Global Search, Recent activity,
 * plus the Tailwind scan that the search palette depends on.
 *
 * The frontend has no DOM test runner, so behaviour that needs a browser
 * (position, scroll lock, focus return) was proved in the browser and is
 * pinned here by the code that implements it. Pure decisions are tested
 * directly.
 */
import * as fs from 'fs';
import * as path from 'path';
import { searchOutcome } from '../../../apps/web/components/global-search-state';
import { companyTimeLabel } from '../../../platforms/intelligence/dashboard/overview/frontend/lib/activity-time';

const REPO = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8').replace(/\r\n/g, '\n');

describe('Global Search: unavailable is never "No results"', () => {
  const ok = { status: 'fulfilled' as const };
  const bad = { status: 'rejected' as const };

  it('every source failing is "unavailable"', () => {
    expect(searchOutcome([bad, bad], 0)).toBe('unavailable');
    expect(searchOutcome([bad, bad, bad], 0)).toBe('unavailable');
  });

  it('one source answering is a real answer, results or empty', () => {
    expect(searchOutcome([ok, bad], 0)).toBe('empty');
    expect(searchOutcome([bad, ok], 3)).toBe('results');
    expect(searchOutcome([ok, ok], 0)).toBe('empty');
  });

  it('the palette shows a retry for "unavailable", and searches only what the role may search', () => {
    const src = read('apps/web/components/command-palette.tsx');
    expect(src).toContain("searchOutcome(sources, 0) === 'unavailable'");
    expect(src).toContain('Search is unavailable right now.');
    expect(src).toContain('onClick={() => setAttempt((n) => n + 1)}');
    expect(src).toContain("const canSearchPeople = ['ADMIN', 'SUPER_ADMIN', 'MANAGER'].includes(roleName);");
    expect(src).toContain('role="dialog"');
    expect(src).toContain('if (opener && document.contains(opener)) opener.focus();');
  });

  it('Tailwind scans apps/, so the palette\'s own classes are generated', () => {
    expect(read('frontend/tailwind.config.ts')).toContain('"../apps/**/*.{ts,tsx}"');
  });
});

describe('View All popup (shared CommandModal)', () => {
  const src = read('shared/ui/frontend/components/CommandModal.tsx');

  it('renders into <body>, so a transformed ancestor cannot pin it inside the page', () => {
    expect(src).toContain("import { createPortal } from 'react-dom';");
    expect(src).toMatch(/return createPortal\(\s*<AnimatePresence>/);
    expect(src).toContain('document.body,\n  );');
  });

  it('locks background scroll while open and returns focus to the opener', () => {
    expect(src).toContain("document.body.style.overflow = 'hidden';");
    expect(src).toContain("if (main) main.style.overflow = 'hidden';");
    expect(src).toContain('if (opener && document.contains(opener)) opener.focus();');
  });

  it('the focus-trap listener is always removed on close (it used to leak)', () => {
    expect(src).toContain("window.addEventListener('keydown', handleTabTrap);");
    expect(src).toContain("window.removeEventListener('keydown', handleTabTrap);");
    expect(src).not.toMatch(/setTimeout\(\(\) => \{\s*const focusableElements/);
  });

  it('sits above the Quick Action dock (z 200)', () => {
    expect(src).toContain('fixed inset-0 z-[300] flex select-none');
  });

  it('is announced as a modal dialog with its title', () => {
    expect(src).toContain('role="dialog"');
    expect(src).toContain('aria-modal="true"');
    expect(src).toContain('aria-labelledby={titleId}');
  });
});

describe('Recent activity', () => {
  it('shows the exact time in the company timezone, not the browser\'s', () => {
    // 2026-10-06 19:00 UTC is 7 Oct, 00:30 in IST.
    expect(companyTimeLabel('2026-10-06T19:00:00.000Z')).toMatch(/^7 Oct 2026, 12:30\s?am IST$/i);
    expect(companyTimeLabel('not a date')).toBe('');
  });

  it('rows that link somewhere are keyboard reachable; empty and loading are honest', () => {
    const src = read('platforms/intelligence/dashboard/overview/frontend/components/RecentActivityFeed.tsx');
    expect(src).toContain("role: 'link',");
    expect(src).toContain('title={companyTimeLabel(ev.timestamp)}');
    expect(src).toContain('No recent activity');
    expect(src).not.toContain('No activity yet today');
    expect(src).toContain('if (isPending && !isError) {');
  });
});
