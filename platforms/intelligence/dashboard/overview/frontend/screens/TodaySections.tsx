'use client';

import Link from 'next/link';
import { CalendarCheck2, ClipboardCheck, FolderKanban, Ticket, Zap } from 'lucide-react';
import { WorkdayBar } from '@/components/workday/WorkdayBar';
import type { HomeExperience } from './home-types';
import { SectionFrame } from './home-ui';

export function SmartHeader({ name, role, scope }: { name: string; role: string; scope: string }) {
  const title = role.toLowerCase().replace(/_/g, ' ');
  return (
    <SectionFrame icon={Zap} title="Your workspace today" subtitle="Personalized status and priorities" aside={<span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium capitalize text-blue-700 dark:bg-blue-950 dark:text-blue-300">{title} · {scope} scope</span>}>
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">Welcome back, {name}. Your workday controls and current priorities are here.</p>
      <WorkdayBar />
    </SectionFrame>
  );
}

export function HomeKpis({ experience }: { experience: HomeExperience }) {
  const { kpis } = experience;
  const cards = [
    { label: 'Active tickets', value: kpis.activeTickets, Icon: Ticket, href: '/tickets', detail: `${experience.scope} scope` },
    { label: 'Projects', value: kpis.activeProjects, Icon: FolderKanban, href: '/projects?status=ACTIVE', detail: 'Active projects' },
    { label: kpis.ticketReviewLabel, value: kpis.ticketReviews, Icon: ClipboardCheck, href: experience.scope === 'Personal' ? '/tickets?status=REVIEW&filter=personal-review' : '/tickets?status=REVIEW&filter=actionable-review', detail: experience.scope === 'Personal' ? 'Your submitted work' : 'Decisions you can take' },
    { label: kpis.leaveReviewLabel, value: kpis.leaveReviews, Icon: CalendarCheck2, href: experience.scope === 'Personal' && kpis.leaveReviewLabel === 'My leave requests' ? '/leave' : '/leave?tab=needs-action', detail: kpis.leaveReviewLabel === 'My leave requests' ? 'Pending requests' : 'Decisions you can take' },
  ];
  return (
    <section aria-label="Home KPIs" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map(({ label, value, Icon, href, detail }) => (
        <Link key={label} href={href} className="group rounded-2xl border border-sky-200 bg-white p-4 shadow-sm transition hover:border-blue-400 hover:shadow-md dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-2 text-xs font-medium text-slate-500 dark:text-slate-400"><span>{label}</span><Icon size={17} className="text-blue-500" aria-hidden /></div>
          <p className="mt-2 text-3xl font-bold text-slate-900 dark:text-slate-100">{value.toLocaleString('en-IN')}</p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{detail}</p>
        </Link>
      ))}
    </section>
  );
}
