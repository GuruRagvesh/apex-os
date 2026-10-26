'use client';

import { useState } from 'react';
import { AttendanceConsole } from './AttendanceConsole';
import { AttendanceReviewsPanel } from './AttendanceReviewsPanel';

type ConsoleTab = 'reviews' | 'attendance';

function initialTab(): ConsoleTab {
  if (typeof window === 'undefined') return 'reviews';
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('tab');
  if (requested === 'reviews' || requested === 'attendance') return requested;
  return params.has('businessDate') ? 'attendance' : 'reviews';
}

export function AttendanceConsoleWorkspace() {
  const [tab, setTab] = useState<ConsoleTab>(initialTab);

  const selectTab = (next: ConsoleTab) => {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <h1 className="apex-page-title apex-text text-xl">Attendance Console</h1>
        <div role="tablist" aria-label="Attendance Console sections" className="flex gap-1 border-b border-[var(--border-primary)]">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'reviews'}
            aria-controls="attendance-console-reviews"
            onClick={() => selectTab('reviews')}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === 'reviews'
                ? 'border-[var(--accent)] text-[var(--accent)]'
                : 'border-transparent apex-text-muted hover:text-[var(--text-primary)]'
            }`}
          >
            Team Review Corrections
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'attendance'}
            aria-controls="attendance-console-attendance"
            onClick={() => selectTab('attendance')}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === 'attendance'
                ? 'border-[var(--accent)] text-[var(--accent)]'
                : 'border-transparent apex-text-muted hover:text-[var(--text-primary)]'
            }`}
          >
            Team Attendance
          </button>
        </div>
      </div>

      <section
        id="attendance-console-reviews"
        role="tabpanel"
        aria-label="Team Review Corrections"
        hidden={tab !== 'reviews'}
      >
        {tab === 'reviews' && <AttendanceReviewsPanel />}
      </section>
      <section
        id="attendance-console-attendance"
        role="tabpanel"
        aria-label="Team Attendance"
        hidden={tab !== 'attendance'}
      >
        {tab === 'attendance' && <AttendanceConsole embedded />}
      </section>
    </div>
  );
}
