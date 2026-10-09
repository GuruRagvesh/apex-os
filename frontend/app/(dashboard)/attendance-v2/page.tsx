import { redirect } from 'next/navigation';

// Preserve saved preview links while keeping one employee attendance route.
export default function AttendanceV2Page() {
  redirect('/attendance');
}
