'use client';

import { useQuery } from '@tanstack/react-query';
import { LeaveBalanceCard } from './LeaveBalanceCard';
import { getMyAttendanceToday } from './attendance-api';
import { presentStatus } from './attendance-status';

/**
 * "Attendance & Leave" for the employee's own profile.
 *
 * Personal information only — no HR controls. Granting comp off, adjusting a
 * balance or correcting a punch are HR-authoritative actions and do not appear
 * on a page about yourself.
 *
 * Reuses LeaveBalanceCard rather than restating the numbers, so the profile and
 * My Attendance cannot show different balances for the same person.
 *
 * Composed at the route level rather than inside ProfileScreen: that screen
 * lives in platforms/core/users/profiles, and platforms/** importing frontend/**
 * is a boundary violation the architecture validator rejects.
 */
export function AttendanceLeaveSummary() {
  const { data: today } = useQuery({
    queryKey: ['my-attendance-today'],
    queryFn: getMyAttendanceToday,
    staleTime: 60_000,
    retry: false,
  });

  const status = today ? presentStatus(today.status) : null;

  return (
    <section className="apex-card">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="apex-text text-sm font-semibold">Attendance &amp; Leave</h2>
        {status && (
          <span className={`rounded-md px-2 py-1 text-xs font-medium ${status.chip}`}>
            Today · {status.label}
          </span>
        )}
      </div>
      <LeaveBalanceCard compact />
      <p className="apex-text-subtle mt-3 text-[11px]">
        Leave balance is your personal entitlement. Company holidays are separate and appear in
        My Attendance.
      </p>
    </section>
  );
}
