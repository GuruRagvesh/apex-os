'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuthStore } from '@apex/core-identity';
import { canApprove, canPrepare } from './import-presentation';
import { ImportWorkspace, type ImportWorkspaceSection } from './ImportWorkspace';

export type AttendanceImportOption = {
  section: Exclude<ImportWorkspaceSection, 'HOME'>;
  title: string;
  description: string;
  approvalOnly?: boolean;
};

const OPTIONS: AttendanceImportOption[] = [
  {
    section: 'RECOVERY',
    title: 'Manual recovery',
    description: "Fix one employee's day when a punch could not be captured.",
  },
  {
    section: 'BULK',
    title: 'Bulk import',
    description: 'Upload a spreadsheet to correct or bring in many days at once.',
  },
  {
    section: 'HISTORY',
    title: 'Import history',
    description: 'Review uploaded attendance files and their results.',
  },
  {
    section: 'HEALTH',
    title: 'Data health',
    description: 'Check attendance backup and recovery readiness.',
    approvalOnly: true,
  },
  {
    section: 'HISTORICAL_RECOVERY',
    title: 'Historical recovery',
    description: 'Restore missing history from an Apex recovery file.',
    approvalOnly: true,
  },
];

export function AttendanceImportLauncher({
  onSelect,
}: {
  onSelect: (option: AttendanceImportOption) => void;
}) {
  const { user } = useAuthStore();
  const launcherRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const mayPrepare = canPrepare(user as any);
  const mayApprove = canApprove(user as any);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: MouseEvent) => {
      if (!launcherRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', closeOutside);
    return () => document.removeEventListener('mousedown', closeOutside);
  }, [menuOpen]);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('import');
    if (!requested) return;
    const option = OPTIONS.find((candidate) => candidate.section === requested);
    if (option && (!option.approvalOnly || mayApprove)) onSelect(option);
    // onSelect is owned by the persistent Attendance Console. Reading the URL
    // only needs to happen when the viewer's authority becomes known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mayApprove]);

  if (!mayPrepare) return null;

  const options = OPTIONS.filter((option) => !option.approvalOnly || mayApprove);

  return (
    <>
      <div
        ref={launcherRef}
        className="relative"
      >
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--text-inverse)] transition-opacity hover:opacity-90 active:opacity-80"
        >
          Import / Update Data ▾
        </button>
        {menuOpen && (
          <div
            role="menu"
            aria-label="Import and update options"
            className="absolute right-0 top-full z-30 mt-2 w-80 overflow-hidden rounded-xl border border-[var(--border-secondary)] bg-[var(--surface-card)] p-1.5 shadow-xl"
          >
            {options.map((option) => (
              <a
                key={option.section}
                href={`/attendance/admin?tab=attendance&import=${option.section}`}
                role="menuitem"
                onClick={(event) => {
                  event.preventDefault();
                  const url = new URL(window.location.href);
                  url.searchParams.set('tab', 'attendance');
                  url.searchParams.set('import', option.section);
                  window.history.pushState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
                  setMenuOpen(false);
                  onSelect(option);
                }}
                className="group block w-full rounded-lg px-3 py-2.5 text-left hover:bg-[var(--accent)]"
              >
                <span className="apex-text block text-sm font-semibold group-hover:text-[var(--text-inverse)]">
                  {option.title}
                </span>
                <span className="apex-text-muted mt-0.5 block text-xs group-hover:text-white/80">
                  {option.description}
                </span>
              </a>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export function AttendanceImportModal({
  option,
  onClose,
}: {
  option: AttendanceImportOption;
  onClose: () => void;
}) {
  const [consoleLeft, setConsoleLeft] = useState(0);

  useLayoutEffect(() => {
    const main = document.getElementById('apex-main-content');
    const measure = () => setConsoleLeft(main?.getBoundingClientRect().left ?? 0);
    measure();
    const observer = typeof ResizeObserver === 'undefined' || !main ? null : new ResizeObserver(measure);
    observer?.observe(main);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  useEffect(() => {
    const main = document.getElementById('apex-main-content');
    const previousOverflow = main?.style.overflow ?? '';
    if (main) main.style.overflow = 'hidden';
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('keydown', close);
      if (main) main.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed bottom-0 right-0 z-[110] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-md"
      style={{ left: consoleLeft, top: 0 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={option.title}
        onClickCapture={(event) => {
          const target = event.target as Element;
          const link = target.closest<HTMLAnchorElement>('a[href]');
          if (!link || link.hasAttribute('download') || link.target === '_blank') return;
          // Let the link/router finish first. Closing synchronously in capture
          // would unmount the link before its navigation handler runs.
          window.setTimeout(onClose, 0);
        }}
        className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-blue-700 bg-white shadow-2xl dark:bg-slate-900"
      >
        <header className="flex items-start justify-between gap-4 bg-[#1D4ED9] px-5 py-4 text-white">
          <div>
            <h2 className="text-lg font-semibold">{option.title}</h2>
            <p className="mt-1 text-sm text-blue-100">{option.description}</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-xl leading-none text-white/90 hover:bg-white/15"
          >
            ×
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5">
          <ImportWorkspace key={option.section} initialSection={option.section} embedded />
        </div>
      </div>
    </div>,
    document.body,
  );
}
