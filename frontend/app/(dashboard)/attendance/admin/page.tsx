// One route owns both attendance-management surfaces. Each embedded surface
// keeps its existing server-side authority checks.
import { AttendanceConsoleWorkspace } from '@/components/attendance/AttendanceConsoleWorkspace';

export default function AttendanceAdminPage() {
  return <AttendanceConsoleWorkspace />;
}
