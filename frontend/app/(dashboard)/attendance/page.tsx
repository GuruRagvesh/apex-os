// Thin route adapter, matching the convention used by the other dashboard
// routes: the screen lives in a component, the route just mounts it.
import { AttendanceCalendar } from '@/components/attendance/AttendanceCalendar';
import { AttendanceToday } from '@/components/attendance/AttendanceToday';
import { EmployeeAttendanceDashboard } from '@/components/attendance/EmployeeAttendanceDashboard';
import { MyAttendanceYear } from '@/components/attendance/MyAttendanceYear';

export default function AttendancePage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="apex-text text-xl font-semibold">My attendance</h1>
        <p className="apex-text-muted mt-1 text-sm">
          Your recorded attendance for each day, and why it looks the way it does.
        </p>
      </div>

      {/*
        ORDER IS THE READING ORDER, and each panel answers a different question.

        Today first: it is what the page is opened with. Then the month
        dashboard -- the KPIs, leave balance and comp off -- which is the
        richer, already-tested surface and the one that answers "how is this
        month going". Then the year, for "how do my months compare". The
        calendar last, for a specific day and the evidence behind it.

        ONE CALENDAR ON THIS PAGE, deliberately. The year view is twelve
        summary rows and not a second grid of days; picking a month is how you
        get back to the calendar.
      */}
      <AttendanceToday />
      <EmployeeAttendanceDashboard />
      <MyAttendanceYear />
      <AttendanceCalendar />
    </div>
  );
}
