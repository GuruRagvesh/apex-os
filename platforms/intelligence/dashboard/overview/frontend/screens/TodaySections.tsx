'use client';

import Link from 'next/link';
import { CalendarCheck2, ClipboardCheck, FolderKanban, Ticket } from 'lucide-react';
import type { HomeExperience } from './home-types';

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
