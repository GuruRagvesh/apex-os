'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMyAttendanceRange, type AttendanceDay } from './attendance-api';
import {
  exceptionText,
  formatMinutes,
  formatTime,
  presentStatus,
  reasonText,
} from './attendance-status';

/**
 * The employee's own attendance month (AE-1).
 *
 * A calendar plus a detail panel — deliberately not an analytics screen. It
 * answers one question: "what is my attendance, and why?"
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function monthBounds(year: number, month: number) {
  const first = new Date(Date.UTC(year, month, 1));
  const last = new Date(Date.UTC(year, month + 1, 0));
  return {
    from: first.toISOString().slice(0, 10),
    to: last.toISOString().slice(0, 10),
    firstWeekday: first.getUTCDay(),
    daysInMonth: last.getUTCDate(),
  };
}

export function AttendanceCalendar() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selected, setSelected] = useState<string | null>(null);

  const { from, to, firstWeekday, daysInMonth } = useMemo(
    () => monthBounds(year, month),
    [year, month],
  );

  const { data, isLoading, isError } = useQuery({
    queryKey: ['my-attendance', from, to],
    queryFn: () => getMyAttendanceRange(from, to),
    staleTime: 60_000,
  });

  const byDate = useMemo(() => {
    const map = new Map<string, AttendanceDay>();
    for (const d of data?.days ?? []) map.set(d.businessDate, d);
    return map;
  }, [data]);

  const shift = (delta: number) => {
    const next = new Date(Date.UTC(year, month + delta, 1));
    setYear(next.getUTCFullYear());
    setMonth(next.getUTCMonth());
    setSelected(null);
  };

  const monthLabel = new Date(Date.UTC(year, month, 1)).toLocaleDateString([], {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const detail = selected ? byDate.get(selected) : undefined;

  return (
    <div className="space-y-4">
      <div className="apex-card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="apex-text text-base font-semibold">{monthLabel}</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => shift(-1)}
              className="apex-text-muted rounded-lg border border-[var(--border-secondary)] px-3 py-1 text-sm hover:bg-[var(--bg-tertiary)]"
            >
              ← Prev
            </button>
            <button
              onClick={() => shift(1)}
              className="apex-text-muted rounded-lg border border-[var(--border-secondary)] px-3 py-1 text-sm hover:bg-[var(--bg-tertiary)]"
            >
              Next →
            </button>
          </div>
        </div>

        {isError && (
          <p className="apex-text-muted py-8 text-center text-sm">
            Your attendance could not be loaded. Please try again.
          </p>
        )}

        {isLoading && (
          <p className="apex-text-muted py-8 text-center text-sm">Loading your attendance…</p>
        )}

        {!isLoading && !isError && (
          <>
            <div className="mb-1 grid grid-cols-7 gap-1">
              {WEEKDAYS.map((d) => (
                <div key={d} className="apex-text-subtle py-1 text-center text-xs font-medium">
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: firstWeekday }).map((_, i) => (
                <div key={`pad-${i}`} />
              ))}

              {Array.from({ length: daysInMonth }).map((_, i) => {
                const dayNumber = i + 1;
                const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;
                const day = byDate.get(date);
                const look = presentStatus(day?.status ?? null);
                const isSelected = selected === date;

                return (
                  <button
                    key={date}
                    onClick={() => setSelected(date)}
                    className={[
                      'flex min-h-[64px] flex-col items-start rounded-lg border p-2 text-left transition-colors',
                      look.cell || 'bg-transparent',
                      isSelected
                        ? 'border-[var(--accent)] ring-2 ring-[var(--accent-ring)]'
                        : 'border-[var(--border-primary)] hover:border-[var(--accent)]',
                    ].join(' ')}
                  >
                    <span className="apex-text text-xs font-semibold">{dayNumber}</span>
                    {day?.status && (
                      <span className="apex-text-muted mt-1 line-clamp-2 text-[10px] leading-tight">
                        {look.label}
                      </span>
                    )}
                    {day?.requiresReview && (
                      <span className="mt-auto text-[10px] font-medium text-orange-600 dark:text-orange-400">
                        ● review
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {selected && (
        <div className="apex-card">
          <div className="mb-3 flex items-start justify-between">
            <div>
              <h3 className="apex-text text-sm font-semibold">
                {new Date(`${selected}T00:00:00Z`).toLocaleDateString([], {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                  timeZone: 'UTC',
                })}
              </h3>
              {detail && (
                <p className="apex-text-muted mt-1 text-xs">{reasonText(detail.reason)}</p>
              )}
            </div>
            {detail && (
              <span
                className={`rounded-md px-2 py-1 text-xs font-medium ${presentStatus(detail.status).chip}`}
              >
                {presentStatus(detail.status).label}
              </span>
            )}
          </div>

          {!detail && (
            <p className="apex-text-muted text-sm">No attendance record for this date.</p>
          )}

          {detail && (
            <>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                <Fact label="Punch in" value={formatTime(detail.punchInAt)} />
                <Fact label="Punch out" value={formatTime(detail.punchOutAt)} />
                <Fact label="Worked" value={formatMinutes(detail.workedMinutes)} />
                <Fact label="Breaks" value={formatMinutes(detail.breakMinutes)} />
                <Fact
                  label="Location"
                  value={
                    detail.locationException
                      ? 'Needs review'
                      : detail.punchInAt
                        ? 'Verified'
                        : '—'
                  }
                />
                <Fact
                  label="Photo"
                  value={detail.punchInAt ? (detail.photoCaptured ? 'Captured' : 'Missing') : '—'}
                />
                <Fact
                  label="Leave"
                  value={
                    detail.lwpDeducted > 0
                      ? `${detail.lwpDeducted} unpaid`
                      : detail.leaveDeducted > 0
                        ? `${detail.leaveDeducted} day`
                        : '—'
                  }
                />
                <Fact
                  label="Late by"
                  value={detail.lateMinutes > 0 ? formatMinutes(detail.lateMinutes) : '—'}
                />
              </dl>

              {detail.exceptions.length > 0 && (
                <div className="mt-4 rounded-lg bg-amber-50 p-3 dark:bg-amber-900/20">
                  <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                    Needs review
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {detail.exceptions.map((f) => (
                      <li key={f} className="text-xs text-amber-700 dark:text-amber-400">
                        · {exceptionText(f)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="apex-text-subtle text-[11px] uppercase tracking-wide">{label}</dt>
      <dd className="apex-text mt-0.5 text-sm font-medium">{value}</dd>
    </div>
  );
}
