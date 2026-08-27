'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AttendanceDrawer } from './AttendanceDrawer';
import { AttendanceDayDetail } from './AttendanceDayDetail';
import { getMyRegularizations } from './regularization-api';
import { getMyAttendanceRange, type AttendanceDay } from './attendance-api';
import { presentStatus } from './attendance-status';

/**
 * The employee's own attendance month (AE-1).
 *
 * A calendar — deliberately not an analytics screen. It answers one question:
 * "what is my attendance, and why?"
 *
 * The calendar is the navigation surface; selecting a date opens the context
 * drawer rather than expanding a detail panel underneath. The inline panel is
 * gone rather than kept alongside: two places showing the same day is how they
 * drift apart, and the one below the fold was the one nobody scrolled to.
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
  const [requesting, setRequesting] = useState(false);

  // AR-1: the employee's own correction requests, so a reviewable day can show
  // its stage instead of inviting a duplicate request.
  const { data: corrections } = useQuery({
    queryKey: ['my-regularizations'],
    queryFn: getMyRegularizations,
    staleTime: 60_000,
    retry: false,
  });

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
  const correction = corrections?.find((c) => c.date?.slice(0, 10) === selected) ?? null;

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
                    onClick={() => {
                      setSelected(date);
                      setRequesting(false);
                    }}
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

      <AttendanceDrawer
        open={Boolean(selected)}
        title={
          selected
            ? new Date(`${selected}T00:00:00Z`).toLocaleDateString([], {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                timeZone: 'UTC',
              })
            : ''
        }
        subtitle="Your attendance for this date"
        onClose={() => {
          setSelected(null);
          setRequesting(false);
        }}
      >
        {selected && (
          <AttendanceDayDetail
            businessDate={selected}
            day={detail}
            correction={correction}
            requesting={requesting}
            onRequest={() => setRequesting(true)}
            onRequestDone={() => setRequesting(false)}
          />
        )}
      </AttendanceDrawer>
    </div>
  );
}
