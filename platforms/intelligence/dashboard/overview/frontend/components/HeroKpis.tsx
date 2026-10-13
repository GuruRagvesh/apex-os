'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, ClipboardCheck, FileClock, FolderKanban, Ticket, Timer, type LucideIcon } from 'lucide-react';
import { dashboardApi, type HomeKpiScope } from '../api';

type Scope = 'mine' | 'scoped';

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

/** What the shared non-personal scope means for a role. */
function scopeLabel(role: string): { short: string; detail: string; projects: string } {
  if (role === 'ADMIN' || role === 'SUPER_ADMIN') return { short: 'Company', detail: 'across the company', projects: 'company projects' };
  if (role === 'MANAGER') return { short: 'Department', detail: 'in your department', projects: 'department projects' };
  return { short: 'Team', detail: 'across your team', projects: 'team projects' };
}

function ticketHref(status: 'OPEN' | 'IN_PROGRESS' | 'REVIEW' | 'PENDING_APPROVAL', scope: Scope, userId?: string) {
  if (scope === 'mine' && userId) return `/tickets?status=${status}&assignedToId=${userId}`;
  return `/tickets?status=${status}`;
}

/**
 * The Home hero is an action queue, not a historic reporting surface. One
 * shared scope switch changes every card together so its six numbers can be
 * read as one coherent My/Team/Department/Company snapshot.
 */
export function HeroKpis({ isLead, userId, role = '' }: { isLead: boolean; userId?: string; role?: string }) {
  const router = useRouter();
  const [scope, setScope] = useState<Scope>('mine');
  const scopeName = scopeLabel(role);
  const { data, isError } = useQuery({
    queryKey: ['home-kpis'],
    queryFn: () => dashboardApi.getHomeKpis(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const selected: HomeKpiScope | undefined = scope === 'scoped' ? data?.scoped ?? undefined : data?.mine;
  const show = (n: number | null | undefined) => (isError ? '–' : n ?? '…');
  const isScoped = scope === 'scoped';
  const workSub = isScoped ? scopeName.detail : 'assigned to you';
  const reviewSub = isScoped ? 'in your authorized scope' : 'waiting for a decision';
  const ticketApprovalSub = isScoped ? 'waiting for your approval' : 'your requests awaiting approval';
  const leaveSub = isScoped ? 'waiting for your decision' : 'your pending leave requests';

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      <Tile label="Open tickets" value={show(selected?.openTickets)} sub={workSub} icon={Ticket}
        onClick={() => router.push(ticketHref('OPEN', scope, userId))}>
        {isLead && <div className="apex-hero-kpi-toggle" role="group" aria-label="All dashboard KPIs scope">
          <button type="button" aria-pressed={scope === 'mine'} onClick={() => setScope('mine')}>My</button>
          <button type="button" aria-pressed={scope === 'scoped'} onClick={() => setScope('scoped')}>{scopeName.short}</button>
        </div>}
      </Tile>
      <Tile label="In progress" value={show(selected?.inProgressTickets)} sub={workSub} icon={Timer}
        onClick={() => router.push(ticketHref('IN_PROGRESS', scope, userId))} />
      <Tile label="Under review" value={show(selected?.underReviewTickets)} sub={reviewSub} icon={ClipboardCheck}
        onClick={() => router.push(ticketHref('REVIEW', scope, userId))} />
      <Tile label="Ticket approvals" value={show(selected?.pendingTicketApprovals)} sub={ticketApprovalSub} icon={FileClock}
        onClick={() => router.push(ticketHref('PENDING_APPROVAL', scope, userId))} />
      <Tile label="Active projects" value={show(selected?.activeProjects)} sub={isScoped ? scopeName.projects : 'projects you belong to'} icon={FolderKanban}
        onClick={() => router.push('/projects?status=ACTIVE')} />
      <Tile label={isScoped ? 'Leave approvals' : 'Leave request'} value={show(selected?.leaveApprovals)} sub={leaveSub} icon={CalendarClock}
        onClick={() => router.push(isScoped ? '/leave?tab=needs-action' : '/leave')} />
    </div>
  );
}
