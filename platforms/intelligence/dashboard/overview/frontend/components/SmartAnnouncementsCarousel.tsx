'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Award, ChevronRight, Megaphone, Trophy, X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';

export type HomeAnnouncement = {
  id: string;
  title: string;
  body: string;
  priority: 'GENERAL' | 'IMPORTANT' | 'CRITICAL';
  audience: 'COMPANY' | 'ROLE' | 'DEPARTMENT';
  targetIds: string[];
  startsAt: string;
  endsAt: string | null;
  active: boolean;
};

export type HomeCarouselData = {
  announcement: HomeAnnouncement | null;
  criticalAnnouncements: HomeAnnouncement[];
  spotlight: {
    weekStart: string;
    basis: 'FINALIZED_ATTENDANCE';
    leaders: { id: string; name: string; onTime: number; eligible: number; rate: number }[];
  };
};

export type TeamAchievement = { id: string; person: string; title: string; ticketId: string; date: string; url: string };

export const SMART_CAROUSEL_SAMPLE: { data: HomeCarouselData; recognition: TeamAchievement[] } = {
  data: {
    announcement: { id: 'sample-notice', title: 'Important company updates', body: 'Policies, notices and upcoming company events',
      priority: 'IMPORTANT', audience: 'COMPANY', targetIds: [], startsAt: '2026-10-12T00:00:00.000Z', endsAt: null, active: true },
    criticalAnnouncements: [],
    spotlight: { weekStart: '2026-10-12', basis: 'FINALIZED_ATTENDANCE',
      leaders: [{ id: 'sample-person', name: 'Sample Employee', onTime: 4, eligible: 4, rate: 100 }] },
  },
  recognition: [{ id: 'sample-ticket', person: 'Sample Employee', title: 'Completed project milestone',
    ticketId: 'TKT-SAMPLE', date: '2026-10-12T00:00:00.000Z', url: '/tickets/sample-ticket' }],
};

type Props = {
  data?: HomeCarouselData;
  recognition?: TeamAchievement[];
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
};

const SLIDES = [
  { category: 'Company announcement', icon: Megaphone },
  { category: 'Recognition spotlight', icon: Trophy },
  { category: 'Team recognition', icon: Award },
] as const;

export function SmartAnnouncementsCarousel({ data, recognition = [], loading = false, error = false, onRetry }: Props) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedCritical, setSelectedCritical] = useState<HomeAnnouncement | null>(null);
  const touchStart = useRef<number | null>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (paused || detailsOpen || loading || error || reduceMotion) return;
    const timer = window.setInterval(() => setActive((current) => (current + 1) % SLIDES.length), 8000);
    return () => window.clearInterval(timer);
  }, [paused, detailsOpen, loading, error, reduceMotion, epoch]);

  const navigate = (index: number) => {
    setActive((index + SLIDES.length) % SLIDES.length);
    setEpoch((value) => value + 1);
  };

  const slide = SLIDES[active];
  const Icon = slide.icon;
  const headline = active === 0
    ? data?.announcement?.title ?? 'Important company updates'
    : active === 1 ? 'Most punctual employees this week' : 'Celebrating team achievements';
  const description = active === 0
    ? data?.announcement?.body ?? 'No current notices; policies and events will appear here.'
    : active === 1
      ? data?.spotlight.leaders.length
        ? `${data.spotlight.leaders.map((person) => person.name).slice(0, 2).join(' · ')} · consistent on-time attendance`
        : 'Recognition appears after finalized workdays are available.'
      : recognition.length
        ? `${recognition[0].person} completed ${recognition[0].ticketId} · ${recognition[0].title}`
        : 'Recent completed work will appear here.';

  return (
    <>
      <div className="space-y-2">
        {data?.criticalAnnouncements.map((item) => (
          <button key={item.id} type="button" onClick={() => { setActive(0); setSelectedCritical(item); setDetailsOpen(true); }}
            className="flex w-full items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-left text-xs font-medium text-rose-800 hover:bg-rose-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
            <Megaphone size={14} aria-hidden="true" /> Critical announcement: {item.title}
          </button>
        ))}
        <section aria-roledescription="carousel" aria-label="Announcements and recognition"
          onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
          onFocusCapture={() => setPaused(true)}
          onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') { event.preventDefault(); navigate(active + 1); }
            if (event.key === 'ArrowLeft') { event.preventDefault(); navigate(active - 1); }
          }}
          onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientX ?? null; setPaused(true); }}
          onTouchEnd={(event) => {
            const end = event.changedTouches[0]?.clientX;
            if (touchStart.current !== null && end !== undefined && Math.abs(end - touchStart.current) > 45) {
              navigate(active + (end < touchStart.current ? 1 : -1));
            }
            touchStart.current = null;
            setPaused(false);
          }}
          className="relative flex min-h-[96px] w-full items-center rounded-[9px] border border-[#dbe5f3] bg-white px-3.5 pb-5 pt-2.5 shadow-none dark:border-slate-700 dark:bg-slate-900 sm:px-5"
        >
          <div className="relative flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden" style={{ perspective: 700 }}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={active}
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6, rotateX: -10 }}
                animate={{ opacity: 1, y: 0, rotateX: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, rotateX: 10 }}
                transition={{ duration: reduceMotion ? 0.12 : 0.24, ease: 'easeInOut' }}
                className="flex min-w-0 flex-1 items-center gap-2.5"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[#eef4ff] text-[#2563eb] dark:bg-blue-950 dark:text-blue-300">
                  <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[10px] font-medium leading-4 text-[#4477bf] dark:text-blue-300">{slide.category}</p>
                  <button type="button" onClick={() => { setSelectedCritical(null); setDetailsOpen(true); }}
                    className="block max-w-full truncate text-left text-[14px] font-semibold leading-5 text-[#172b50] hover:text-blue-600 focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-slate-100"
                  >{loading ? 'Loading updates…' : error ? 'Updates unavailable' : headline}</button>
                  <p className="truncate text-[11px] leading-[18px] text-[#6b82a6] dark:text-slate-400">
                    {loading ? 'Checking announcements and recognition' : error ? 'Please retry to load the latest information.' : description}
                  </p>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
          {error && onRetry && <button type="button" onClick={onRetry} className="mr-2 text-xs font-medium text-blue-600 underline">Retry</button>}
          <button type="button" aria-label="Next slide" onClick={() => navigate(active + 1)}
            className="ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-transparent text-[#697080] transition-colors hover:border-pink-200 hover:bg-pink-50 hover:text-blue-600 focus-visible:border-pink-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-slate-300"
          ><ChevronRight size={20} aria-hidden="true" /></button>
          <div className="absolute bottom-[10px] left-1/2 flex -translate-x-1/2 items-center gap-1.5" aria-label="Choose slide">
            {SLIDES.map((item, index) => (
              <button key={item.category} type="button" aria-label={`Show ${item.category}`} aria-current={active === index ? 'true' : undefined}
                onClick={() => navigate(index)}
                className={`h-[6px] rounded-full transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${active === index ? 'w-[22px] bg-[#2965f5]' : 'w-[7px] bg-[#c9d7ec] hover:bg-blue-300'}`} />
            ))}
          </div>
        </section>
      </div>

      <Dialog.Root open={detailsOpen} onOpenChange={(open) => { setDetailsOpen(open); if (!open) setSelectedCritical(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[100] bg-slate-950/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[101] max-h-[85vh] w-[min(92vw,540px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl focus:outline-none dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-blue-600">{selectedCritical ? 'Critical announcement' : slide.category}</p>
                <Dialog.Title className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{selectedCritical?.title ?? headline}</Dialog.Title>
              </div>
              <Dialog.Close className="rounded-md p-1 text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 dark:hover:bg-slate-800" aria-label="Close details"><X size={18} /></Dialog.Close>
            </div>
            <Dialog.Description className="mt-3 text-sm text-slate-600 dark:text-slate-300">
              {selectedCritical ? selectedCritical.body
                : active === 0 ? data?.announcement?.body ?? 'There are no current announcements for your role or department.'
                : active === 1 ? 'Recognizing on-time attendance from finalized scheduled workdays. Approved leave and non-working days are not counted.'
                : 'Recent completed work visible within your authorized scope.'}
            </Dialog.Description>
            {active === 1 && <div className="mt-4 space-y-2">
              {data?.spotlight.leaders.length ? data.spotlight.leaders.map((person) => (
                <div key={person.id} className="flex justify-between gap-3 rounded-lg bg-blue-50 px-3 py-2 text-sm dark:bg-slate-800">
                  <span className="font-medium text-slate-800 dark:text-slate-100">{person.name}</span>
                  <span className="text-slate-600 dark:text-slate-300">{person.onTime}/{person.eligible} on time · {person.rate}%</span>
                </div>
              )) : <p className="text-sm text-slate-500">No eligible finalized workdays yet this week.</p>}
            </div>}
            {active === 2 && <div className="mt-4 space-y-2">
              {recognition.length ? recognition.map((item) => (
                <a key={item.id} href={item.url} className="block rounded-lg bg-blue-50 px-3 py-2 text-sm hover:text-blue-600 dark:bg-slate-800">
                  <span className="font-medium">{item.person} completed {item.ticketId}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">{item.title}</span>
                </a>
              )) : <p className="text-sm text-slate-500">No recent completed work in your scope.</p>}
            </div>}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
