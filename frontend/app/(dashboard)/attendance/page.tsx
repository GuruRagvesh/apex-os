// Thin route adapter, matching the convention used by the other dashboard
// routes: the screen lives in a component, the route just mounts it.
import { AttendanceCalendar } from '@/components/attendance/AttendanceCalendar';
import { AttendanceToday } from '@/components/attendance/AttendanceToday';

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
      <AttendanceCalendar />
    </div>
  );
}
