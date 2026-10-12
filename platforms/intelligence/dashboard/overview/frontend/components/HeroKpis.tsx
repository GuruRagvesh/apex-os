'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, ClipboardCheck, FolderKanban, Ticket, type LucideIcon } from 'lucide-react';
import { dashboardApi } from '../api';

type Scope = 'mine' | 'team';

function Tile({
  label, value, sub, icon: Icon, onClick, children,
}: {
  label: string;
  value: number | string;
  sub: string;
  icon: LucideIcon;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="apex-hero-kpi group" role="group" aria-label={label}>
      <div className="flex items-center justify-between gap-2">
        <span className="apex-hero-kpi-label">{label}</span>
        <span className="apex-hero-kpi-icon" aria-hidden="true"><Icon size={15} /></span>
      </div>
      <button type="button" onClick={onClick} className="mt-1.5 block text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 rounded-md">
        <span className="apex-hero-kpi-value">{value}</span>
        <span className="apex-hero-kpi-sub">{sub}</span>
      </button>
      {children}
    </div>
  );
}

/**
 * The four "needs attention" figures inside the Home hero.
 * Leads and above: active tickets (mine/team), active projects, ticket
 * approvals, leave approvals. Employees and interns: their own active tickets,
 * projects and tickets waiting in review.
 */
/** What "team" actually covers for this role: admins see the whole company, managers their department. */
function scopeLabel(role: string): { short: string; sub: string; projects: string } {
  if (role === 'ADMIN' || role === 'SUPER_ADMIN') return { short: 'Company', sub: 'open across the company', projects: 'across the company' };
  if (role === 'MANAGER') return { short: 'Department', sub: 'open in your department', projects: 'in your department' };
  return { short: 'Team', sub: 'open across your team', projects: 'in your team' };
}

export function HeroKpis({ isLead, userId, role = '' }: { isLead: boolean; userId?: string; role?: string }) {
  const scopeName = scopeLabel(role);
  const router = useRouter();
  const [scope, setScope] = useState<Scope>(isLead ? 'team' : 'mine');
  const { data, isError } = useQuery({
    queryKey: ['home-kpis'],
    queryFn: () => dashboardApi.getHomeKpis(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const show = (n: number | null | undefined) => (isError ? '–' : n ?? '…');
  const activeValue = scope === 'team' ? data?.activeTickets.team : data?.activeTickets.mine;

  return (
    <div className={`grid gap-3 ${isLead ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 sm:grid-cols-3'}`}>
      <Tile
        label="Active tickets"
        value={show(activeValue)}
        sub={scope === 'team' ? scopeName.sub : 'assigned to you'}
        icon={Ticket}
        onClick={() => router.push(scope === 'team' || !userId ? '/tickets' : `/tickets?assignedToId=${userId}`)}
      >
        {isLead && (
          <div className="apex-hero-kpi-toggle" role="group" aria-label="Active tickets scope">
            <button type="button" aria-pressed={scope === 'mine'} onClick={() => setScope('mine')}>My</button>
            <button type="button" aria-pressed={scope === 'team'} onClick={() => setScope('team')}>{scopeName.short}</button>
          </div>
        )}
      </Tile>
      <Tile
        label="Active projects"
        value={show(data?.activeProjects)}
        sub={isLead ? scopeName.projects : 'you are part of'}
        icon={FolderKanban}
        onClick={() => router.push('/projects?status=ACTIVE')}
      />
      {isLead ? (
        <>
          <Tile
            label="Ticket approvals"
            value={show(data?.pendingTicketApprovals)}
            sub="under review, need you"
            icon={ClipboardCheck}
            onClick={() => router.push('/tickets?status=REVIEW')}
          />
          <Tile
            label="Leave approvals"
            value={show(data?.pendingLeaveApprovals)}
            sub="waiting for a decision"
            icon={CalendarClock}
            onClick={() => router.push('/leave?tab=needs-action')}
          />
        </>
      ) : (
        <Tile
          label="My tickets in review"
          value={show(data?.myInReview)}
          sub="waiting for approval"
          icon={ClipboardCheck}
          onClick={() => router.push('/tickets?status=REVIEW')}
        />
      )}
    </div>
  );
}
