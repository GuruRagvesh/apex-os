'use client';

import Link from 'next/link';
import { useId, type CSSProperties, type MouseEventHandler, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, unwrap as r } from '@apex/shared-auth';
import {
  ticketCreationGate,
  WORKDAY_TODAY_QUERY_KEY,
  type TicketCreationGate,
} from '../../shared/ticket-creation-gate';

// Inline, not a Tailwind class: Tailwind does not scan platforms/, so a class
// used only here would never be generated.
const VISUALLY_HIDDEN: CSSProperties = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0,
};

/**
 * The creation gate from the backend's own workday answer. Shares the
 * ['workday-today'] query with the workday bar, so a Punch In / Punch Out
 * (which refetches that query) updates every creation control at once.
 */
export function useTicketCreationGate({ enabled = true }: { enabled?: boolean } = {}): TicketCreationGate {
  const { data, isLoading, isError } = useQuery({
    queryKey: WORKDAY_TODAY_QUERY_KEY,
    // Same request as workdayApi.getToday(), through the shared client.
    queryFn: () => r(api.get('/workday/today')) as Promise<any>,
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  return ticketCreationGate(data, { isLoading, isError });
}

/**
 * A "New ticket" link that is disabled, with the reason as its tooltip, while
 * the person cannot create tickets. The disabled link stays in the tab order
 * and announces its reason, so keyboard and screen-reader users learn why.
 */
export function CreateTicketLink({
  href = '/tickets/new',
  className,
  style,
  children,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: {
  href?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  onMouseEnter?: MouseEventHandler<HTMLElement>;
  onMouseLeave?: MouseEventHandler<HTMLElement>;
}) {
  const gate = useTicketCreationGate();
  const reasonId = useId();
  if (!gate.allowed) {
    return (
      <span
        role="link"
        aria-disabled="true"
        tabIndex={0}
        aria-describedby={gate.reason ? reasonId : undefined}
        title={gate.reason ?? undefined}
        className={className}
        style={{ ...style, opacity: 0.5, cursor: 'not-allowed' }}
        data-ticket-create-disabled="true"
      >
        {children}
        {gate.reason && <span id={reasonId} style={VISUALLY_HIDDEN}>{gate.reason}</span>}
      </span>
    );
  }
  return (
    <Link href={href} className={className} style={style} onClick={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      {children}
    </Link>
  );
}
