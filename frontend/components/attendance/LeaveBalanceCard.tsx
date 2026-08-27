'use client';

import { useQuery } from '@tanstack/react-query';
import {
  expiringSoon,
  getMyCompOffCredits,
  getMyLeaveBalance,
  LEAVE_TYPE_LABEL,
  PERSONAL_LEAVE_TYPES,
  type PersonalLeaveType,
} from './leave-balance-api';

/**
 * The employee's own leave entitlement.
 *
 * Deliberately called "Leave balance", never "holidays available": a company
 * holiday is a date nobody works, an entitlement is days this person may take.
 * Merging the two is the mistake this wording exists to prevent.
 *
 * Reused unchanged in My Attendance and in the employee's profile, so the two
 * cannot drift apart and show different numbers for the same person.
 *
 * Nothing here grants, earns or expires anything. Comp off is granted by HR and
 * consumed oldest-expiry-first by the leave module; this only reports what
 * those authorities already decided.
 */

function Row({
  label,
  available,
  used,
  pending,
}: {
  label: string;
  available: number | null;
  used?: number;
  pending?: number;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="apex-text-muted text-xs">{label}</span>
      <span className="flex items-baseline gap-2">
        <span className="apex-text text-sm font-semibold tabular-nums">
          {available === null ? '—' : available}
        </span>
        {(used !== undefined || pending !== undefined) && (
          <span className="apex-text-subtle text-[11px] tabular-nums">
            {used !== undefined ? `${used} used` : ''}
            {used !== undefined && pending ? ' · ' : ''}
            {pending ? `${pending} pending` : ''}
          </span>
        )}
      </span>
    </div>
  );
}

export function LeaveBalanceCard({ compact = false }: { compact?: boolean }) {
  // One query per type, because the endpoint answers per type. They are
  // independent, so a failure in one does not blank the others.
  const casual = useQuery({
    queryKey: ['my-leave-balance', 'CASUAL'],
    queryFn: () => getMyLeaveBalance('CASUAL' as PersonalLeaveType),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const emergency = useQuery({
    queryKey: ['my-leave-balance', 'EMERGENCY'],
    queryFn: () => getMyLeaveBalance('EMERGENCY' as PersonalLeaveType),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const compOff = useQuery({
    queryKey: ['my-comp-off'],
    queryFn: getMyCompOffCredits,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const byType: Record<PersonalLeaveType, typeof casual> = {
    CASUAL: casual,
    EMERGENCY: emergency,
  };

  const credits = compOff.data ?? [];
  const expiring = expiringSoon(credits, new Date());
  const nextExpiry = expiring[0];

  const body = (
    <>
      <dl className="divide-y divide-[var(--border-secondary)]">
        {PERSONAL_LEAVE_TYPES.map((type) => {
          const q = byType[type];
          return (
            <Row
              key={type}
              label={LEAVE_TYPE_LABEL[type]}
              // `balance` is the authority; allocation minus what is taken or
              // awaiting a decision is already applied server-side.
              available={q.data ? q.data.balance : null}
              used={q.data?.approved}
              pending={q.data?.pending}
            />
          );
        })}
        <Row label="Comp Off" available={compOff.isSuccess ? credits.length : null} />
      </dl>

      {nextExpiry && (
        <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
          {expiring.length === 1 ? '1 comp off expires' : `${expiring.length} comp off expire`} by{' '}
          {new Date(nextExpiry.expiresAt).toLocaleDateString([], {
            day: 'numeric',
            month: 'short',
            timeZone: 'UTC',
          })}
        </p>
      )}
    </>
  );

  if (compact) return body;

  return (
    <div className="apex-card">
      <h3 className="apex-text mb-2 text-sm font-semibold">Leave balance</h3>
      {body}
    </div>
  );
}
