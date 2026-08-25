// Thin route adapter, matching the other dashboard routes. Access is decided by
// the server: the console renders a "not available" panel for anyone without a
// team or HR authority, so this route needs no client-side permission logic.
import { AttendanceConsole } from '@/components/attendance/AttendanceConsole';

export default function AttendanceAdminPage() {
  return <AttendanceConsole />;
}
