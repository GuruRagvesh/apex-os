// Thin route adapter, matching the convention used by the other dashboard
// routes: the screen lives in a component, the route just mounts it.
import { AttendanceCalendar } from '@/components/attendance/AttendanceCalendar';
import { AttendanceToday } from '@/components/attendance/AttendanceToday';
import { MyAttendanceSummary } from '@/components/attendance/MyAttendanceSummary';

export default function AttendancePage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="apex-text text-xl font-semibold">My attendance</h1>
        <p className="apex-text-muted mt-1 text-sm">
          Your recorded attendance for each day, and why it looks the way it does.
        </p>
      </div>
      {/* Today first: the question the page is opened with. History below. */}
      <AttendanceToday />
      {/*
        The official record, then the day-by-day view.

        Order is deliberate: the summary is what payroll reads, so it comes
        before the calendar, which shows live operational detail for one day at
        a time. Somebody checking "how many late days do I have" should meet the
        authoritative answer first rather than counting cells.
      */}
      <MyAttendanceSummary />
      <AttendanceCalendar />
    </div>
  );
}
