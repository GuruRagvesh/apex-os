'use client';

import { useQuery } from '@tanstack/react-query';
import { AttendanceDrawer } from './AttendanceDrawer';
import { getRegisterEmployeeDays, type RegisterEmployeeDay } from './console-api';

const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });

function dayLabel(date: string) {
  return WEEKDAY.format(new Date(`${date}T00:00:00Z`));
}

function hours(value: number | null) {
  return value === null ? '—' : `${value.toFixed(2)} h`;
}

function Location({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <span className="apex-text-subtle text-[10px] font-semibold uppercase tracking-wide">{label}</span>
      <p className="apex-text-muted break-words text-xs">{value ?? '—'}</p>
    </div>
  );
}

function DayRow({ day }: { day: RegisterEmployeeDay }) {
  const worked = day.punchIn || day.punchOut;
  return (
    <li className="border-b border-slate-200 py-3 last:border-0 dark:border-slate-700">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="apex-text text-sm font-semibold">{dayLabel(day.date)}</span>
        <span className="apex-text-muted text-xs font-medium">{day.status ?? '—'}</span>
      </div>
      {worked ? (
        <>
          <dl className="apex-text-muted mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
            <div><dt className="apex-text-subtle inline">In </dt><dd className="inline">{day.punchIn ?? '—'}</dd></div>
            <div><dt className="apex-text-subtle inline">Out </dt><dd className="inline">{day.punchOut ?? '—'}</dd></div>
            <div><dt className="apex-text-subtle inline">Presence </dt><dd className="inline">{hours(day.presenceHours)}</dd></div>
            <div><dt className="apex-text-subtle inline">Work </dt><dd className="inline">{hours(day.workHours)}</dd></div>
          </dl>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Location label="Punch in location" value={day.punchInLocation} />
            <Location label="Punch out location" value={day.punchOutLocation} />
          </div>
        </>
      ) : null}
      {day.missingPunch || day.remarks ? (
        <p className="apex-text-subtle mt-1 text-xs">{[day.missingPunch, day.remarks].filter(Boolean).join(' · ')}</p>
      ) : null}
    </li>
  );
}

/**
 * One employee's month from the Monthly Register: every day with its status,
 * punch times, hours and punch locations. Read from the same server report as
 * the Excel and CSV downloads, so it always matches them.
 */
export function RegisterEmployeeDaysDrawer({
  employee,
  from,
  to,
  onClose,
}: {
  employee: { userId: string; name: string } | null;
  from: string;
  to: string;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['console-register-employee', employee?.userId, from, to],
    queryFn: () => getRegisterEmployeeDays(employee!.userId, from, to),
    enabled: !!employee,
    staleTime: 60_000,
  });

  return (
    <AttendanceDrawer
      open={!!employee}
      title={employee?.name ?? ''}
      subtitle="Daily attendance with punch locations"
      onClose={onClose}
    >
      {isLoading ? <p className="apex-text-muted text-sm">Loading days…</p> : null}
      {isError ? <p className="apex-text-muted text-sm">These days could not be loaded. Please try again.</p> : null}
      {data ? (
        <ul>
          {data.days.map((day) => (
            <DayRow key={day.date} day={day} />
          ))}
        </ul>
      ) : null}
    </AttendanceDrawer>
  );
}
