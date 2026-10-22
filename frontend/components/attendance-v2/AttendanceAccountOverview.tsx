'use client';
import { useQuery } from '@tanstack/react-query';
import { Gift, Plane } from 'lucide-react';
import { getHolidayCalendar, upcomingHolidays } from '../attendance/holiday-api';
import { getMyLeaveBalance, getMyCompOffCredits, LEAVE_TYPE_LABEL, type PersonalLeaveType } from '../attendance/leave-balance-api';
import s from './qc.module.css';
export function AttendanceAccountOverview() {
  const holidays = useQuery({ queryKey: ['holiday-calendar-v2'], queryFn: () => getHolidayCalendar(), staleTime: 600_000, retry: false });
  const credits = useQuery({ queryKey: ['my-comp-off'], queryFn: getMyCompOffCredits, staleTime: 300_000, retry: false });
  const upcoming = upcomingHolidays(holidays.data, 3);
  return <section className={s.account} aria-label="Holidays and leave balance">
    <section className={s.holidays}><h2><Gift size={20} />Upcoming Holidays</h2>
      {holidays.isError ? <p role="alert">Holiday calendar unavailable. <button onClick={() => holidays.refetch()}>Try again</button></p> : holidays.isPending ? <p>Loading holidays…</p> : upcoming.length ? <ul>{upcoming.map(day => <li key={day.id}><strong>{day.name}</strong><span>{new Date(day.date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}</span></li>)}</ul> : <p>No upcoming holidays on the calendar.</p>}
    </section>
    <section className={s.leave}>
      <header className={s.leaveHeader}>
        <div><h2><Plane size={20} />Leave balance</h2><p>Your available leave and current requests.</p></div>
        <div className={s.compOff}><span>Comp Off</span><strong>{credits.isError ? 'Unavailable' : credits.isPending ? 'Loading…' : credits.data?.length ?? '—'}</strong></div>
      </header>
      <div className={s.leaveGrid} role="list" aria-label="Leave balances"><LeaveRow type="CASUAL" /><LeaveRow type="SICK" /></div>
    </section>
  </section>;
}
function LeaveRow({ type }: { type: PersonalLeaveType }) {
  const query = useQuery({ queryKey: ['my-leave-balance', type], queryFn: () => getMyLeaveBalance(type), staleTime: 300_000, retry: false });
  const data = query.isError ? undefined : query.data;
  const value = (field: 'allocation' | 'approved' | 'pending' | 'balance') => data && Number.isFinite(data[field]) ? data[field] : null;
  return <article className={s.leaveRow} role="listitem"><h3>{LEAVE_TYPE_LABEL[type]}</h3>
    {query.isError && <p role="alert">Leave balance unavailable. <button onClick={() => query.refetch()}>Try again</button></p>}
    {query.isPending ? <p>Loading balance…</p> : <>
      <div className={s.leaveBalance}><strong>{value('balance') ?? '—'}</strong><span>{value('balance') === null ? 'Remaining unavailable' : 'days remaining'}</span></div>
      <dl>{([['allocation', 'Allocated'], ['approved', 'Approved'], ['pending', 'Pending']] as const).map(([field, label]) => <div key={field}><dt>{label}</dt><dd>{value(field) ?? '—'}<small>{value(field) !== null ? ' days' : ''}</small></dd></div>)}</dl>
    </>}
  </article>;
}
