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
    <section className={s.leave}><h2><Plane size={20} />Leave Usage &amp; Allocation Analysis</h2><p>Your current allocation and recorded leave requests.</p>
      <div className={s.leaveGrid}><LeavePanel type="CASUAL" /><LeavePanel type="EMERGENCY" /></div>
      <p>Comp Off credits: <strong>{credits.isError ? 'Unavailable' : credits.isPending ? 'Loading…' : credits.data?.length ?? '—'}</strong></p>
    </section>
  </section>;
}
function LeavePanel({ type }: { type: PersonalLeaveType }) {
  const query = useQuery({ queryKey: ['my-leave-balance', type], queryFn: () => getMyLeaveBalance(type), staleTime: 300_000, retry: false });
  const data = query.isError ? undefined : query.data;
  const value = (field: 'allocation' | 'approved' | 'pending' | 'balance') => data && Number.isFinite(data[field]) ? data[field] : null;
  const allocation = value('allocation');
  const used = value('approved');
  // Display ratio only. The server's balance is never recalculated from this chart.
  const percent = allocation !== null && allocation > 0 && used !== null && used >= 0 ? Math.round(used / allocation * 100) : null;
  return <article className={s.leavePanel}><h3>{LEAVE_TYPE_LABEL[type]}</h3>
    {query.isError && <p role="alert">Leave balance unavailable. <button onClick={() => query.refetch()}>Try again</button></p>}
    {query.isPending ? <p>Loading balance…</p> : <>
      <dl>{([['allocation', 'Allocated'], ['balance', 'Remaining'], ['approved', 'Approved'], ['pending', 'Pending']] as const).map(([field, label]) => <div key={field}><dt>{label}</dt><dd>{value(field) ?? '—'}<small>{value(field) !== null ? ' days' : ''}</small></dd></div>)}</dl>
      <div className={s.usage}><span>Approved / allocated</span><strong>{percent === null ? '—' : percent + '%'}</strong></div>
      <div className={s.leaveTrack} role={percent === null ? undefined : 'progressbar'} aria-label={LEAVE_TYPE_LABEL[type] + ' approved allocation usage'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent === null ? undefined : Math.min(100, percent)}>{percent !== null && <span style={{ width: Math.min(100, percent) + '%' }} />}</div>
    </>}
  </article>;
}
