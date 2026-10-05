'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  compOffKeys,
  extendCompOff,
  getEmployeeCompOffCredits,
  grantCompOff,
  type CompOffCredit,
} from './leave-balance-api';

/**
 * Comp off actions for somebody else's attendance, for whoever may take them.
 *
 * WHETHER TO SHOW THIS IS THE SERVER'S ANSWER. The panel runs the same read
 * the actions are authorized by -- HR and Admin anywhere, a manager inside
 * their own departments -- and renders nothing when that read is refused. It
 * does not inspect the viewer's role, because a role check written here would
 * be a second copy of an authorization rule, free to disagree with the real
 * one, and the browser's copy is the one nobody can trust.
 *
 * HIDING IS NOT ENFORCEMENT, and nothing here pretends otherwise. Every action
 * is re-decided by CompOffService: scope, the reason, and the ceiling. A
 * crafted request that skipped this component entirely is refused identically.
 *
 * THE EXPIRY IS NEVER SENT ON A GRANT. The server resolves it from the
 * employee's policy, so the panel shows the result rather than proposing it.
 */
export function ManagerCompOffPanel({
  employeeId,
  employeeName,
}: {
  employeeId: string;
  employeeName?: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<'none' | 'grant' | string>('none');

  const credits = useQuery({
    queryKey: compOffKeys.employeeCredits(employeeId),
    queryFn: () => getEmployeeCompOffCredits(employeeId),
    retry: false,
    staleTime: 60_000,
  });

  const refresh = () => {
    // The employee's own balance is a different cache entry and a grant must
    // move it too, or they are told they have nothing until it goes stale.
    queryClient.invalidateQueries({ queryKey: compOffKeys.employeeCredits(employeeId) });
    queryClient.invalidateQueries({ queryKey: ['comp-off-credits'] });
    setOpen('none');
  };

  // Refused, or not yet answered: show nothing rather than a disabled shell
  // that implies the actions exist for this viewer.
  if (credits.isError || credits.isLoading) return null;

  const rows = credits.data ?? [];

  return (
    <section className="apex-card space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="apex-text text-sm font-semibold">
          Comp off{employeeName ? ` — ${employeeName}` : ''}
        </h3>
        <button
          type="button"
          onClick={() => setOpen(open === 'grant' ? 'none' : 'grant')}
          className="rounded-md bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white"
        >
          {open === 'grant' ? 'Cancel' : 'Grant comp off'}
        </button>
      </div>

      <p className="apex-text-subtle text-[11px]">
        Available: {rows.length}. Validity runs from the day the credit is granted, not the day
        that was worked.
      </p>

      {open === 'grant' && <GrantForm employeeId={employeeId} onDone={refresh} />}

      {rows.length === 0 ? (
        <p className="apex-text-muted text-xs">No available credits.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((credit) => (
            <CreditRow
              key={credit.id}
              credit={credit}
              expanded={open === credit.id}
              onToggle={() => setOpen(open === credit.id ? 'none' : credit.id)}
              onDone={refresh}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function CreditRow({
  credit,
  expanded,
  onToggle,
  onDone,
}: {
  credit: CompOffCredit;
  expanded: boolean;
  onToggle: () => void;
  onDone: () => void;
}) {
  return (
    <li className="rounded-lg border border-[var(--border-primary)] p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs">
          <span className="apex-text font-medium">
            Earned {formatDate(credit.earnedFromBusinessDate)}
          </span>
          <span className="apex-text-muted"> · expires {formatDate(credit.expiresAt)}</span>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="rounded-md border border-[var(--border-primary)] px-2 py-1 text-[11px] font-medium"
        >
          {expanded ? 'Cancel' : 'Extend'}
        </button>
      </div>
      {expanded && <ExtendForm credit={credit} onDone={onDone} />}
    </li>
  );
}

function GrantForm({ employeeId, onDone }: { employeeId: string; onDone: () => void }) {
  const [workedOn, setWorkedOn] = useState('');
  const [reason, setReason] = useState('');
  const [granted, setGranted] = useState<CompOffCredit | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      grantCompOff({ employeeId, earnedFromBusinessDate: workedOn, reason }),
    onSuccess: (credit) => {
      // Shown rather than predicted: the expiry is whatever the server
      // resolved from this employee's policy.
      setGranted(credit);
      onDone();
    },
  });

  if (granted) {
    return (
      <p className="text-xs text-emerald-700 dark:text-emerald-400">
        Granted. It expires {formatDate(granted.expiresAt)}.
      </p>
    );
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <label className="block">
        <span className="apex-text-subtle text-[11px] font-medium">Day worked</span>
        <input
          type="date"
          required
          value={workedOn}
          onChange={(e) => setWorkedOn(e.target.value)}
          className="apex-input mt-0.5 w-full text-xs"
        />
      </label>
      <label className="block">
        <span className="apex-text-subtle text-[11px] font-medium">Reason</span>
        <input
          type="text"
          required
          minLength={5}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Worked the Sunday release"
          className="apex-input mt-0.5 w-full text-xs"
        />
      </label>
      <Submit pending={mutation.isPending} label="Grant" />
      <Problem error={mutation.error} />
    </form>
  );
}

function ExtendForm({ credit, onDone }: { credit: CompOffCredit; onDone: () => void }) {
  const [newExpiry, setNewExpiry] = useState('');
  const [reason, setReason] = useState('');

  const mutation = useMutation({
    mutationFn: () => extendCompOff(credit.id, { newExpiry, reason }),
    onSuccess: onDone,
  });

  return (
    <form
      className="mt-2 space-y-2 border-t border-[var(--border-primary)] pt-2"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <p className="apex-text-subtle text-[11px]">
        Currently expires {formatDate(credit.expiresAt)}. The maximum is 60 days from the grant,
        and the server decides it — a date past the ceiling is refused.
      </p>
      <label className="block">
        <span className="apex-text-subtle text-[11px] font-medium">New expiry</span>
        <input
          type="date"
          required
          // A lower bound for convenience only. The ceiling is NOT set here:
          // it depends on the grant date and the employee's policy, and a
          // client that computed it would be a second copy of the rule.
          min={credit.expiresAt.slice(0, 10)}
          value={newExpiry}
          onChange={(e) => setNewExpiry(e.target.value)}
          className="apex-input mt-0.5 w-full text-xs"
        />
      </label>
      <label className="block">
        <span className="apex-text-subtle text-[11px] font-medium">Reason</span>
        <input
          type="text"
          required
          minLength={5}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Project ran into the following month"
          className="apex-input mt-0.5 w-full text-xs"
        />
      </label>
      <Submit pending={mutation.isPending} label="Extend" />
      <Problem error={mutation.error} />
    </form>
  );
}

function Submit({ pending, label }: { pending: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white disabled:opacity-60"
    >
      {pending ? 'Working…' : label}
    </button>
  );
}

/** The server's own refusal, shown verbatim rather than paraphrased. */
function Problem({ error }: { error: unknown }) {
  if (!error) return null;
  const message =
    (error as any)?.response?.data?.message ??
    (error as any)?.message ??
    'That could not be completed.';
  return (
    <p className="text-[11px] text-red-600 dark:text-red-400">
      {Array.isArray(message) ? message.join(' ') : String(message)}
    </p>
  );
}

function formatDate(value: string): string {
  const at = new Date(value);
  return Number.isNaN(at.getTime())
    ? '—'
    : at.toLocaleDateString([], {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      });
}
