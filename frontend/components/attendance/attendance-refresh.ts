import type { QueryClient } from '@tanstack/react-query';

/**
 * Every cached view that shows official attendance, by its query-key root.
 *
 * Approving or applying a correction changes the official DailyAttendance row,
 * and with it the Monthly Register, the calendars and the summaries. All of
 * them are refetched from the server -- nothing is patched in the browser --
 * so the page shows the corrected figures without a reload, and the Excel and
 * CSV downloads (always fetched fresh) match what is on screen.
 */
const ATTENDANCE_QUERY_ROOTS = new Set<string>([
  'console-register',
  'console-roster',
  'console-summary',
  'home-team-insights',
  'my-attendance',
  'my-attendance-today',
  'my-attendance-activity',
  'my-attendance-activity-v2',
  'my-attendance-v2',
  'my-attendance-v2-day',
  'my-attendance-v2-fiscal-year',
  'my-comp-off',
  'my-regularizations',
  'regularization-queue',
  'regularization-held',
  'regularization-counts',
  'unified-review-queue',
  'unified-review-counts',
]);

export function refreshAttendanceViews(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: (query) => ATTENDANCE_QUERY_ROOTS.has(String(query.queryKey[0])),
  });
}
