import { redirect } from 'next/navigation';

export default function AttendanceReviewsPage({
  searchParams,
}: {
  searchParams?: { scope?: string; mode?: string };
}) {
  const params = new URLSearchParams({ tab: 'reviews' });
  if (searchParams?.scope) params.set('scope', searchParams.scope);
  if (searchParams?.mode) params.set('mode', searchParams.mode);
  redirect(`/attendance/admin?${params.toString()}`);
}
