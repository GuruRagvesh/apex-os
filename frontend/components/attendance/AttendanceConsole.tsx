'use client';

import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AttendanceImportLauncher,
  AttendanceImportModal,
  type AttendanceImportOption,
} from './AttendanceImportLauncher';
import {
  downloadRegister,
  getConsoleAccess,
  getRegister,
  type RegisterEmployee,
} from './console-api';
import {
  currentMonth,
  formatBalance,
  formatCompletion,
  formatHours,
  formatProvisional,
  isFutureMonth,
  monthLabel,
  monthRange,
  shiftMonth,
} from './register-month';

/**
 * HR / manager attendance console (HC-1).
 *
 * Practical, not analytical: what happened today, who needs attention, and the
 * controls to act. Every number shown is a stored evaluation result — this
 * screen never asks the server to compute attendance as a side effect of being
 * opened. Evaluation happens only when someone presses a button.
 */

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?';
}

// The avatar field sometimes holds a colour such as "#3b82f6" rather than a
// picture. Only something that can load as an image is treated as a photo, and
// a photo that fails to load falls back to initials instead of a broken icon.
function photoSource(employee: RegisterEmployee): string | null {
  const candidate = employee.photoUrl || employee.avatar;
  return candidate && /^(https?:|\/|data:image\/|blob:)/i.test(candidate) ? candidate : null;
}

function RegisterEmployeeIdentity({ employee }: { employee: RegisterEmployee }) {
  const [failed, setFailed] = useState(false);
  const image = failed ? null : photoSource(employee);
  return (
    <div className="flex min-w-0 items-center gap-3">
      {image ? (
        <img
          src={image}
          onError={() => setFailed(true)}
          alt={`${employee.name} profile photo`}
          className="h-10 w-10 shrink-0 rounded-full border border-blue-200 object-cover"
        />
      ) : (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-xs font-semibold text-blue-700">
          {initials(employee.name)}
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold text-slate-900 dark:text-white">{employee.name}</span>
        <span className="block truncate text-[11px] font-medium uppercase tracking-wide text-blue-600 dark:text-blue-300">
          Employee{employee.department ? ` · ${employee.department}` : ''}
        </span>
      </span>
    </div>
  );
}

export function AttendanceConsole({ embedded = false }: { embedded?: boolean } = {}) {
  const [month, setMonth] = useState(() => currentMonth());
  const [importOption, setImportOption] = useState<AttendanceImportOption | null>(null);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [downloading, setDownloading] = useState<'xlsx' | 'zip' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: access, isLoading: accessLoading } = useQuery({
    queryKey: ['console-access'],
    queryFn: getConsoleAccess,
    staleTime: 5 * 60_000,
    retry: false,
  });

  // The register asks for the WHOLE month. The server clamps its calculations
  // to elapsed working days, so requesting September on September 1st does not
  // manufacture twenty-one absences.
  const range = monthRange(month);
  const {
    data: register,
    isLoading: registerLoading,
    isError: registerFailed,
  } = useQuery({
    queryKey: ['console-register', month],
    queryFn: () => getRegister(range.from, range.to),
    enabled: !!access?.hasTeam,
    staleTime: 60_000,
  });

  /**
   * Both files come from the server's monthly report, built from one snapshot.
   * Nothing is recomputed here. The in-flight guard drops a second click while
   * a file is still being prepared, so one click is one request.
   */
  const downloadInFlight = useRef(false);
  const download = async (format: 'xlsx' | 'zip') => {
    if (downloadInFlight.current) return;
    downloadInFlight.current = true;
    setDownloading(format);
    setError(null);
    try {
      await downloadRegister(month, format);
    } catch {
      setError(
        format === 'xlsx'
          ? 'The Excel report could not be downloaded. Please try again.'
          : 'The CSV package could not be downloaded. Please try again.',
      );
    } finally {
      downloadInFlight.current = false;
      setDownloading(null);
    }
  };

  if (accessLoading) {
    return <p className="apex-text-muted py-8 text-center text-sm">Loading…</p>;
  }
  if (!access?.hasTeam) {
    return (
      <div className="apex-card">
        <p className="apex-text text-sm font-semibold">Not available</p>
        <p className="apex-text-muted mt-1 text-sm">
          This console is for HR and for managers with reporting employees.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        {!embedded && <h1 className="apex-page-title apex-text text-xl">Attendance</h1>}
        <p className="apex-text-muted mt-1 text-sm">
          {access.isHr ? 'Company-wide' : 'Your team'} · stored results only
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-amber-50 p-3 dark:bg-amber-900/20">
          <p className="text-xs text-amber-800 dark:text-amber-300">{error}</p>
        </div>
      )}

      <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--text-inverse)]">
                Monthly Register
              </span>
              <button
                onClick={() => setMonth(shiftMonth(month, -1))}
                className="apex-text-muted rounded-lg border border-[var(--border-secondary)] px-2.5 py-1.5 text-sm"
                aria-label="Previous month"
              >
                ‹
              </button>
              <span className="apex-text min-w-[9.5rem] text-center text-sm font-semibold">
                {monthLabel(month)}
              </span>
              <button
                onClick={() => setMonth(shiftMonth(month, 1))}
                // A month that has not begun holds nothing to review.
                disabled={isFutureMonth(shiftMonth(month, 1))}
                className="apex-text-muted rounded-lg border border-[var(--border-secondary)] px-2.5 py-1.5 text-sm disabled:opacity-40"
                aria-label="Next month"
              >
                ›
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <div className="text-right">
                <p className="apex-text-subtle text-[11px] uppercase tracking-wide">
                  Working days
                </p>
                {/* The full scheduled month, not the elapsed part of it. What
                    HR is asked at the end of the month is how many working days
                    it contained, and that answer does not change on the 2nd. */}
                <p className="apex-text text-2xl font-semibold leading-tight">
                  {register?.workingDays ?? '—'}
                </p>
              </div>
              <div className="flex gap-2">
                <div
                  className="relative"
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) {
                      setDownloadMenuOpen(false);
                    }
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setDownloadMenuOpen((open) => !open)}
                    disabled={!register || downloading !== null}
                    aria-haspopup="menu"
                    aria-expanded={downloadMenuOpen}
                    className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--text-inverse)] transition-opacity hover:opacity-90 active:opacity-80 disabled:opacity-40"
                  >
                    {downloading === 'xlsx' ? 'Preparing Excel…' : downloading === 'zip' ? 'Preparing CSV…' : 'Download ▾'}
                  </button>
                  {downloadMenuOpen && (
                    <div
                      role="menu"
                      className="absolute right-0 z-20 mt-1 min-w-56 overflow-hidden rounded-lg border border-[var(--border-secondary)] bg-[var(--surface-card)] p-1 shadow-lg"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setDownloadMenuOpen(false);
                          void download('xlsx');
                        }}
                        className="apex-text w-full rounded-md px-3 py-2 text-left text-sm hover:bg-[var(--accent)] hover:text-[var(--text-inverse)]"
                      >
                        Download Excel (.xlsx)
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setDownloadMenuOpen(false);
                          void download('zip');
                        }}
                        className="apex-text w-full rounded-md px-3 py-2 text-left text-sm hover:bg-[var(--accent)] hover:text-[var(--text-inverse)]"
                      >
                        Download CSV Package (.zip)
                      </button>
                    </div>
                  )}
                </div>
                <AttendanceImportLauncher onSelect={setImportOption} />
              </div>
            </div>
          </div>

          {register && !register.calendarResolved && (
            <div className="rounded-lg bg-amber-50 p-3 dark:bg-amber-900/20">
              <p className="text-xs text-amber-800 dark:text-amber-300">
                No weekly-off policy could be resolved for this month, so weekends
                are being counted as working days. The working-day total and every
                percentage below it are unreliable until that is configured.
              </p>
            </div>
          )}

          {register?.provisional && (
            <div className="rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20">
              <p className="text-xs text-blue-800 dark:text-blue-300">
                {register.monthComplete
                  ? 'Provisional: some days are unresolved or have a correction still open. Attendance % stays blank for anyone with unresolved days until they are settled.'
                  : 'Provisional: this month is not complete yet, so every figure can still change.'}
              </p>
            </div>
          )}

          {registerLoading && (
            <p className="apex-text-muted py-8 text-center text-sm">Loading register…</p>
          )}
          {registerFailed && (
            <p className="apex-text-muted py-8 text-center text-sm">
              The register could not be loaded.
            </p>
          )}

          {register && (
            <div className="overflow-x-auto rounded-xl border-2 border-blue-300 bg-white dark:border-blue-800 dark:bg-slate-900">
              <table className="w-full min-w-[1280px] table-fixed border-collapse text-left text-sm">
                <thead className="bg-[#245B8F] text-xs font-semibold uppercase tracking-wide text-white">
                  <tr className="border-b-2 border-blue-300 dark:border-blue-800">
                    <th className="w-[19%] border-r border-white/20 px-4 py-3">Employee</th>
                    <th className="w-[7%] border-r border-white/20 px-3 py-3 text-right">Present</th>
                    <th className="w-[7%] border-r border-white/20 px-3 py-3 text-right">Absent</th>
                    <th className="w-[7%] border-r border-white/20 px-3 py-3 text-right">Half days</th>
                    <th className="w-[7%] border-r border-white/20 px-3 py-3 text-right">Leave days</th>
                    <th className="w-[7%] border-r border-white/20 px-3 py-3 text-right">Late days</th>
                    <th className="w-[8%] border-r border-white/20 px-3 py-3 text-right">Below 9 hours</th>
                    <th className="w-[8%] border-r border-white/20 px-3 py-3 text-right">Leave balance</th>
                    <th className="w-[8%] border-r border-white/20 px-3 py-3 text-right">Comp off (hrs)</th>
                    <th className="w-[7%] border-r border-white/20 px-3 py-3 text-right">Unresolved</th>
                    <th className="w-[8%] border-r border-white/20 px-3 py-3 text-right">Attendance %</th>
                    <th className="w-[7%] px-3 py-3 text-right">Provisional</th>
                  </tr>
                </thead>
                <tbody className="divide-y-2 divide-slate-300 dark:divide-slate-700">
                  {register.employees.map((e) => (
                    <tr
                      key={e.userId}
                      className="align-middle odd:bg-white even:bg-slate-50 transition hover:bg-blue-50 dark:odd:bg-slate-900 dark:even:bg-slate-900/70 dark:hover:bg-blue-950/20"
                    >
                      <td className="px-4 py-4">
                        <RegisterEmployeeIdentity employee={e} />
                        {e.isActive === false && (
                          <span className="apex-text-subtle ml-[3.25rem] text-[10px] font-medium uppercase tracking-wide">
                            Inactive
                          </span>
                        )}
                      </td>
                      <td className="apex-text-muted px-3 py-4 text-right">{e.daysPresent}</td>
                      <td className="apex-text-muted px-3 py-4 text-right">{e.daysAbsent}</td>
                      <td className="apex-text-muted px-3 py-4 text-right">{e.halfDays}</td>
                      <td className="apex-text-muted px-3 py-4 text-right">{e.leaveDays}</td>
                      <td className="apex-text-muted px-3 py-4 text-right">{e.latePunchIns}</td>
                      <td className="apex-text-muted px-3 py-4 text-right">{e.daysBelowNineHours}</td>
                      <td className="apex-text-muted px-3 py-4 text-right">
                        {formatBalance(e.leaveBalance)}
                      </td>
                      <td className="apex-text-muted px-3 py-4 text-right">{formatHours(e.approvedCompOff)}</td>
                      <td className="apex-text-muted px-3 py-4 text-right">{e.unresolvedDays}</td>
                      <td className="apex-text px-3 py-4 text-right">
                        {formatCompletion(e.attendanceCompletionPercentage)}
                      </td>
                      <td className="apex-text-muted px-3 py-4 text-right">{formatProvisional(e.provisional)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {register.employees.length === 0 && (
                <p className="apex-text-muted py-6 text-center text-sm">
                  No employees in view.
                </p>
              )}
            </div>
          )}
      </div>
      {importOption && (
        <AttendanceImportModal
          option={importOption}
          onClose={() => {
            setImportOption(null);
            const url = new URL(window.location.href);
            url.searchParams.delete('import');
            window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
          }}
        />
      )}
    </div>
  );
}
