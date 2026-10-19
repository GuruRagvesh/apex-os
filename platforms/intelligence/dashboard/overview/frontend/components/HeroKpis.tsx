'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, ClipboardCheck, FileClock, FolderKanban, Ticket, Timer, type LucideIcon } from 'lucide-react';
import { dashboardApi, type HomeKpiScope } from '../api';

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

function personalTicketHref(status: 'OPEN' | 'IN_PROGRESS' | 'REVIEW', userId?: string) {
  return userId ? `/tickets?status=${status}&assignedToId=${userId}` : `/tickets?status=${status}`;
}

/**
 * A single role-aware snapshot: work cards are always personal, while approval
 * cards are actionable queues and therefore exist only for leadership roles.
 */
export function HeroKpis({ isLead, userId, role = '' }: { isLead: boolean; userId?: string; role?: string }) {
  const router = useRouter();
  const { data, isError } = useQuery({
    queryKey: ['home-kpis'],
    queryFn: () => dashboardApi.getHomeKpis(),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
  const selected: HomeKpiScope | undefined = data?.mine;
  const show = (n: number | null | undefined) => (isError ? '–' : n ?? '…');
  const companyProjectScope = ['MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(role);

  return (
    <div className={`grid grid-cols-2 gap-3 ${isLead ? 'md:grid-cols-3 lg:grid-cols-6' : 'md:grid-cols-4'}`}>
      <Tile label="Open tickets" value={show(selected?.openTickets)} sub="assigned to you" icon={Ticket}
        onClick={() => router.push(personalTicketHref('OPEN', userId))} />
      <Tile label="In progress" value={show(selected?.inProgressTickets)} sub="assigned to you" icon={Timer}
        onClick={() => router.push(personalTicketHref('IN_PROGRESS', userId))} />
      <Tile label="Under review" value={show(selected?.underReviewTickets)} sub="your submitted work" icon={ClipboardCheck}
        onClick={() => router.push(personalTicketHref('REVIEW', userId))} />
      {isLead && <Tile label="Ticket approvals" value={show(selected?.pendingTicketApprovals)} sub="waiting for your approval" icon={FileClock}
        onClick={() => router.push('/tickets?tab=approvals')} />}
      <Tile label="Active projects" value={show(selected?.activeProjects)} sub={companyProjectScope ? 'active company projects' : 'projects you belong to'} icon={FolderKanban}
        onClick={() => router.push('/projects?status=ACTIVE')} />
      {isLead && <Tile label="Leave approvals" value={show(selected?.leaveApprovals)} sub="waiting for your decision" icon={CalendarClock}
        onClick={() => router.push('/leave?tab=needs-action')} />}
    </div>
  );
}
