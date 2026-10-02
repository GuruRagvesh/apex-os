'use client';

import Link from 'next/link';
import { useEffect, useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap as r } from '@apex/shared-auth';
import { ACTIVE_TIMER_QUERY_KEY, formatElapsed, type ActiveTimer } from '../../shared/review-workspace';

// Inline styles, not Tailwind classes: Tailwind does not scan platforms/.
const BAR: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
  padding: '8px 24px', borderBottom: '1px solid #d8b4fe',
  backgroundColor: '#f3e8ff', color: '#581c87', fontSize: 13,
};
const BUTTON: CSSProperties = {
  fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 8,
  border: '1px solid #c084fc', backgroundColor: '#ffffff', color: '#6b21a8', cursor: 'pointer',
};

/** The caller's running clock, from the ledger. Shared with the ticket page. */
export function useActiveTimer() {
  return useQuery({
    queryKey: ACTIVE_TIMER_QUERY_KEY,
    queryFn: () => r(api.get('/tickets/active-timer')) as Promise<ActiveTimer>,
    // Breaks, idle and the end of the day stop timers without any action on
    // this page; poll so the banner never claims a review that has stopped.
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
}

/**
 * Shown on every page while the viewer's own review timer runs: which ticket,
 * how long, a way back to it and a way to pause it. Never shown from page
 * state; only when the backend reports a running REVIEWER clock.
 */
export function ActiveReviewBanner() {
  const qc = useQueryClient();
  const { data } = useActiveTimer();
  const review = data?.activeClock === 'REVIEWER_WORK' ? data.active : null;
  const ticket = review?.ticket ?? null;

  // Elapsed time ticks locally between polls, anchored to the server's value.
  const [anchor, setAnchor] = useState(() => ({ seconds: 0, at: Date.now() }));
  const [, setTick] = useState(0);
  useEffect(() => {
    setAnchor({ seconds: review?.elapsedSeconds ?? 0, at: Date.now() });
  }, [review?.elapsedSeconds, review?.startedAt]);
  useEffect(() => {
    if (!review) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [review]);

  const pause = useMutation({
    mutationFn: (id: string) => r(api.post(`/tickets/${id}/review/pause`, {})),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ACTIVE_TIMER_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ['ticket'] });
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['workday-today'] });
    },
  });

  if (!review || !ticket) return null;
  const elapsed = anchor.seconds + Math.floor((Date.now() - anchor.at) / 1000);

  return (
    <div role="status" aria-live="polite" style={BAR}>
      <span style={{ fontWeight: 600 }}>
        Reviewing {ticket.ticketId} — {formatElapsed(elapsed)}
      </span>
      <Link href={`/tickets/${ticket.id}`} style={{ ...BUTTON, textDecoration: 'none' }}>
        Return to Review
      </Link>
      <button
        type="button"
        style={{ ...BUTTON, opacity: pause.isPending ? 0.6 : 1 }}
        disabled={pause.isPending}
        aria-busy={pause.isPending}
        onClick={() => pause.mutate(ticket.id)}
      >
        {pause.isPending ? 'Pausing…' : 'Pause Review'}
      </button>
      {pause.isError && (
        <span style={{ color: '#b91c1c' }}>{(pause.error as any)?.message || 'Could not pause the review.'}</span>
      )}
    </div>
  );
}
