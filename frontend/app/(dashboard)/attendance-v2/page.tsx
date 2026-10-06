// My Attendance V2 — HIDDEN ROUTE.
//
// Deliberately absent from the sidebar and from every navigation list. The live
// /attendance page is unchanged and still the one employees reach; this exists
// so the V2 contract can be exercised against real data without anyone landing
// on it by accident.
//
// Thin route adapter, matching the convention used by the other dashboard
// routes: the screen lives in a component, the route just mounts it.
import { MyAttendanceV2 } from '@/components/attendance-v2/MyAttendanceV2';

export default function AttendanceV2Page() {
  return <MyAttendanceV2 />;
}
