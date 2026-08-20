'use client';

import { useQuery } from '@tanstack/react-query';
import { getPunchStatus } from './punch-api';

/**
 * Whether the Attendance V2 punch flow is switched on (PE-4).
 *
 * Fails closed. While the probe is loading, or if it errors, this reports
 * `false` so the legacy workday controls render exactly as they do today — a
 * flag check that breaks must never strand an employee in front of a punch
 * screen that cannot work.
 */
export function useAttendanceV2(): { punchEnabled: boolean; isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ['attendance-v2-punch-status'],
    queryFn: getPunchStatus,
    // A deployment flag, not live data: no need to re-ask on every focus.
    staleTime: 5 * 60_000,
    retry: false,
  });

  return { punchEnabled: data?.enabled === true, isLoading };
}
