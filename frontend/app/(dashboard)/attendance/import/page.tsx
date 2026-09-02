// Thin route adapter, matching the other dashboard routes. Access is decided by
// the server on every call; the workspace renders a "not available" panel for
// anyone without import authority, so this route needs no client-side check.
import { ImportWorkspace } from '@/components/attendance/ImportWorkspace';

export default function AttendanceImportPage() {
  return <ImportWorkspace />;
}
