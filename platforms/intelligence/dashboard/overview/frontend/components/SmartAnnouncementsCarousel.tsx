'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Award, List, Loader2, Megaphone, PenLine, Plus, Trophy, X, type LucideIcon } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { dashboardApi, type AnnouncementInput } from '../api';

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
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  creatorName?: string;
};

export type HomeCarouselData = {
  announcements?: HomeAnnouncement[];
  announcement: HomeAnnouncement | null;
  criticalAnnouncements: HomeAnnouncement[];
  spotlight: {
    weekStart: string;
    basis: 'FINALIZED_ATTENDANCE';
    leaders: { id: string; name: string; onTime: number; eligible: number; rate: number }[];
  };
  recognition: TeamAchievement[];
};

export type TeamAchievement = { id: string; person: string; title: string; ticketId: string; date: string; url: string };

export const SMART_CAROUSEL_SAMPLE: { data: HomeCarouselData; recognition: TeamAchievement[] } = {
  data: {
    announcement: { id: 'sample-notice', title: 'Important company updates', body: 'Policies, notices and upcoming company events',
      priority: 'IMPORTANT', audience: 'COMPANY', targetIds: [], startsAt: '2026-10-12T00:00:00.000Z', endsAt: null, active: true },
    criticalAnnouncements: [],
    spotlight: { weekStart: '2026-10-12', basis: 'FINALIZED_ATTENDANCE',
      leaders: [{ id: 'sample-person', name: 'Sample Employee', onTime: 4, eligible: 4, rate: 100 }] },
    recognition: [],
  },
  recognition: [{ id: 'sample-ticket', person: 'Sample Employee', title: 'Completed project milestone',
    ticketId: 'TKT-SAMPLE', date: '2026-10-12T00:00:00.000Z', url: '/tickets/sample-ticket' }],
};

type Props = {
  data?: HomeCarouselData;
  recognition?: TeamAchievement[];
  announcementsOnly?: boolean;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  canManageAnnouncements?: boolean;
};

type TickerItem = {
  key: string;
  category: string;
  title: string;
  summary: string;
  icon: LucideIcon;
  kind: 'announcement' | 'spotlight' | 'achievement';
  achievement?: TeamAchievement;
  announcement?: HomeAnnouncement;
};

const EMPTY_RECOGNITION: TeamAchievement[] = [];

/** Retains the existing Home integration contract; visually this is now a continuous news ticker. */
export function SmartAnnouncementsCarousel({ data, recognition = EMPTY_RECOGNITION, announcementsOnly = false, loading = false, error = false, onRetry, canManageAnnouncements = false }: Props) {
  const reduceMotion = useReducedMotion();
  const [interactionPaused, setInteractionPaused] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedCritical, setSelectedCritical] = useState<HomeAnnouncement | null>(null);
  const [measurements, setMeasurements] = useState({ groupWidth: 0, viewportWidth: 0 });
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<HomeAnnouncement | null>(null);
  const [draft, setDraft] = useState<AnnouncementInput>({ title: '', body: '', priority: 'GENERAL', audience: 'COMPANY', targetIds: [] });
  const viewportRef = useRef<HTMLDivElement>(null);
  const firstGroupRef = useRef<HTMLDivElement>(null);

  const items = useMemo<TickerItem[]>(() => {
    const result: TickerItem[] = [];
    const activeAnnouncements = data?.announcements?.length
      ? data.announcements
      : [...(data?.announcement ? [data.announcement] : []), ...(data?.criticalAnnouncements ?? [])];
    for (const announcement of activeAnnouncements) result.push({
      key: `announcement-${announcement.id}`, category: announcement.priority === 'CRITICAL' ? 'Critical announcement' : announcementsOnly ? 'Breaking news' : 'Company announcement',
      title: announcement.title, summary: announcement.body,
      icon: Megaphone, kind: 'announcement', announcement,
    });
    if (!announcementsOnly && data?.spotlight.leaders.length) {
      const leaders = data.spotlight.leaders;
      result.push({
        key: `spotlight-${data.spotlight.weekStart}`, category: 'Recognition spotlight',
        title: 'Most punctual employees this week',
        summary: leaders.slice(0, 3).map((person) => person.name).join(' · '),
        icon: Trophy, kind: 'spotlight',
      });
    }
    if (!announcementsOnly) {
      for (const achievement of recognition.slice(0, 5)) result.push({
        key: `achievement-${achievement.id}`, category: 'Team recognition',
        title: `${achievement.person} completed ${achievement.ticketId}`,
        summary: achievement.title, icon: Award, kind: 'achievement', achievement,
      });
    }
    return result;
  }, [announcementsOnly, data, recognition]);

  useEffect(() => {
    const group = firstGroupRef.current;
    const viewport = viewportRef.current;
    if (!group || !viewport || !items.length || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const groupWidth = Math.ceil(group.getBoundingClientRect().width);
      const viewportWidth = viewport.clientWidth;
      setMeasurements((previous) => previous.groupWidth === groupWidth && previous.viewportWidth === viewportWidth
        ? previous : { groupWidth, viewportWidth });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(group);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [items]);

  const paused = interactionPaused || detailsOpen;
  const canAnimate = Boolean(items.length && measurements.groupWidth && !reduceMotion);
  const repeatCount = canAnimate
    ? Math.max(2, Math.ceil(measurements.viewportWidth / measurements.groupWidth) + 2)
    : 1;
  const tickerStyle = {
    '--apex-ticker-distance': `-${measurements.groupWidth}px`,
    '--apex-ticker-duration': `${Math.max(12, measurements.groupWidth / 72)}s`,
    animationPlayState: paused ? 'paused' : 'running',
  } as CSSProperties;
  const selectedItem = items.find((item) => item.key === selectedKey) ?? null;
  const newestAnnouncement = useMemo(() => [...(data?.announcements ?? [])]
    .sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime())[0] ?? data?.announcement ?? null, [data]);
  const queryClient = useQueryClient();
  const saveAnnouncement = useMutation({
    mutationFn: (input: AnnouncementInput) => editing
      ? dashboardApi.updateAnnouncement(editing.id, input)
      : dashboardApi.createAnnouncement(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['home-carousel'] }),
        queryClient.invalidateQueries({ queryKey: ['current-announcements'] }),
      ]);
      setEditorOpen(false);
      setEditing(null);
    },
  });

  const openEditor = (announcement: HomeAnnouncement | null) => {
    setEditing(announcement);
    setDraft({
      title: announcement?.title ?? '', body: announcement?.body ?? '',
      priority: announcement?.priority ?? 'GENERAL', audience: announcement?.audience ?? 'COMPANY', targetIds: announcement?.targetIds ?? [],
    });
    setEditorOpen(true);
  };

  const submitAnnouncement = (event: FormEvent) => {
    event.preventDefault();
    saveAnnouncement.mutate(draft);
  };

  const openItem = (key: string) => {
    setSelectedCritical(null);
    setSelectedKey(key);
    setDetailsOpen(true);
  };

  return (
    <>
      <div className="space-y-2">
        {data?.criticalAnnouncements.map((item) => (
          <button key={item.id} type="button" onClick={() => { setSelectedKey(null); setSelectedCritical(item); setDetailsOpen(true); }}
            className="flex w-full items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-left text-xs font-medium text-rose-800 hover:bg-rose-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
            <Megaphone size={14} aria-hidden="true" /> Critical announcement: {item.title}
          </button>
        ))}
        {(!announcementsOnly || items.length > 0) && <section aria-label={announcementsOnly ? 'Breaking news' : 'Announcements and recognition ticker'}
          onMouseEnter={() => setInteractionPaused(true)}
          onMouseLeave={() => setInteractionPaused(false)}
          onFocusCapture={() => setInteractionPaused(true)}
          onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setInteractionPaused(false); }}
          onTouchStart={() => setInteractionPaused(true)}
          onTouchEnd={() => setInteractionPaused(false)}
          className="apex-news-ticker relative flex min-h-[86px] w-full items-center overflow-hidden rounded-[9px] border border-[#dbe5f3] bg-white shadow-none dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="relative z-10 flex h-[86px] shrink-0 items-center gap-2 border-r border-slate-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-900 sm:px-5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[#eef4ff] text-[#2563eb] dark:bg-blue-950 dark:text-blue-300">
              <Megaphone size={17} strokeWidth={1.8} aria-hidden="true" />
            </span>
            <span className="hidden sm:block">
              <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-[#4477bf] dark:text-blue-300">APEX OS</span>
              <span className="block text-[13px] font-semibold text-[#172b50] dark:text-slate-100">{announcementsOnly ? 'Breaking news' : 'Live updates'}</span>
            </span>
          </div>

          <div ref={viewportRef} className={`apex-news-ticker-viewport min-w-0 flex-1 ${reduceMotion ? 'overflow-x-auto' : 'overflow-hidden'}`}>
            {items.length ? (
              <div className={`flex w-max items-center ${canAnimate ? 'apex-news-ticker-track' : ''}`}
                style={tickerStyle} aria-label="Latest updates">
                {Array.from({ length: repeatCount }, (_, copyIndex) => (
                  <div key={copyIndex} ref={copyIndex === 0 ? firstGroupRef : undefined}
                    aria-hidden={copyIndex > 0 ? 'true' : undefined}
                    className="flex w-max shrink-0 items-center pr-8">
                    {items.map((item) => {
                      const Icon = item.icon;
                      return <div key={`${copyIndex}-${item.key}`} className="flex shrink-0 items-center gap-8">
                        <button type="button" tabIndex={copyIndex === 0 ? 0 : -1}
                          onClick={() => openItem(item.key)}
                          className="group flex min-h-[64px] shrink-0 items-center gap-2.5 whitespace-nowrap px-2 text-left focus-visible:rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
                          <Icon size={15} className="shrink-0 text-blue-600 dark:text-blue-300" aria-hidden="true" />
                          <span className="text-[10px] font-medium text-[#4477bf] dark:text-blue-300">{item.category}</span>
                          <span className="max-w-[280px] truncate text-[13px] font-semibold text-[#172b50] group-hover:text-blue-600 dark:text-slate-100">{item.title}</span>
                          <span className="max-w-[260px] truncate text-[11px] text-[#6b82a6] dark:text-slate-400">{item.summary}</span>
                        </button>
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-300" aria-hidden="true" />
                      </div>;
                    })}
                  </div>
                ))}
              </div>
            ) : <p className="px-4 text-xs text-slate-500 dark:text-slate-400">
              {loading ? 'Loading updates…' : error ? 'Updates are unavailable right now.' : 'No announcements or recognition in your scope right now.'}
            </p>}
          </div>

          <div className="relative z-10 flex h-[86px] shrink-0 items-center gap-1 border-l border-slate-200 bg-white px-2 dark:border-slate-700 dark:bg-slate-900 sm:px-3">
            {error && onRetry && <button type="button" onClick={onRetry} className="mr-1 text-xs font-medium text-blue-600 underline">Retry</button>}
            {canManageAnnouncements && <>
              <button type="button" onClick={() => openEditor(null)} aria-label="Create announcement" title="New announcement"
                className="rounded-full p-2 text-blue-600 transition-colors hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-blue-300 dark:hover:bg-slate-800">
                <Plus size={18} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => newestAnnouncement && openEditor(newestAnnouncement)} disabled={!newestAnnouncement}
                aria-label="Edit latest announcement" title="Edit latest announcement"
                className="rounded-full p-2 text-slate-500 transition-colors hover:bg-blue-50 hover:text-blue-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-35 dark:text-slate-300 dark:hover:bg-slate-800">
                <PenLine size={17} aria-hidden="true" />
              </button>
            </>}
            <button type="button" onClick={() => { setSelectedCritical(null); setSelectedKey(null); setDetailsOpen(true); }}
              aria-label="Browse all updates" disabled={!items.length}
              className="rounded-full p-2 text-slate-500 transition-colors hover:bg-blue-50 hover:text-blue-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800">
              <List size={18} aria-hidden="true" />
            </button>
          </div>
        </section>}
      </div>

      <Dialog.Root open={detailsOpen} onOpenChange={(open) => { setDetailsOpen(open); if (!open) { setSelectedCritical(null); setSelectedKey(null); } }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[100] bg-slate-950/30 backdrop-blur-[3px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[101] max-h-[85vh] w-[min(92vw,540px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl focus:outline-none dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-blue-600">{selectedCritical ? 'Critical announcement' : selectedItem?.category ?? 'APEX OS live updates'}</p>
                <Dialog.Title className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{selectedCritical?.title ?? selectedItem?.title ?? 'Announcements and recognition'}</Dialog.Title>
              </div>
              <Dialog.Close className="rounded-md p-1 text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 dark:hover:bg-slate-800" aria-label="Close details"><X size={18} /></Dialog.Close>
            </div>
            <Dialog.Description className="mt-3 text-sm text-slate-600 dark:text-slate-300">
              {selectedCritical?.body ?? (selectedItem?.kind === 'announcement' ? selectedItem.announcement?.body
                : selectedItem?.kind === 'spotlight' ? 'Based on finalized scheduled workdays; approved leave and non-working days are excluded.'
                : selectedItem?.summary ?? 'Select an update to see its details.')}
            </Dialog.Description>
            {!selectedCritical && !selectedItem && <div className="mt-4 space-y-2">
              {items.map((item) => <button key={item.key} type="button" onClick={() => setSelectedKey(item.key)}
                className="block w-full rounded-lg bg-blue-50 px-3 py-2 text-left text-sm hover:bg-blue-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 dark:bg-slate-800 dark:hover:bg-slate-700">
                <span className="block text-[11px] font-medium text-blue-600 dark:text-blue-300">{item.category}</span>
                <span className="font-medium text-slate-800 dark:text-slate-100">{item.title}</span>
                <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{item.summary}</span>
              </button>)}
            </div>}
            {selectedItem?.kind === 'spotlight' && <div className="mt-4 space-y-2">
              {data?.spotlight.leaders.map((person) => <div key={person.id} className="flex justify-between gap-3 rounded-lg bg-blue-50 px-3 py-2 text-sm dark:bg-slate-800">
                <span className="font-medium text-slate-800 dark:text-slate-100">{person.name}</span>
                <span className="text-slate-600 dark:text-slate-300">{person.onTime}/{person.eligible} on time · {person.rate}%</span>
              </div>)}
            </div>}
            {selectedItem?.achievement && <a href={selectedItem.achievement.url}
              className="mt-4 inline-block text-sm font-medium text-blue-600 hover:underline dark:text-blue-300">Open {selectedItem.achievement.ticketId} ↗</a>}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={editorOpen} onOpenChange={(open) => { if (!saveAnnouncement.isPending) setEditorOpen(open); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[130] bg-slate-950/30 backdrop-blur-[3px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[131] w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-blue-100 bg-white p-6 shadow-2xl focus:outline-none dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-xs font-semibold uppercase tracking-wider text-blue-600">APEX OS live updates</p>
                <Dialog.Title className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{editing ? 'Edit today’s announcement' : 'New announcement'}</Dialog.Title></div>
              <Dialog.Close className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close"><X size={18} /></Dialog.Close>
            </div>
            <Dialog.Description className="mt-2 text-sm text-slate-500">It will remain live for 24 hours, notify everyone, then move to announcement history.</Dialog.Description>
            <form onSubmit={submitAnnouncement} className="mt-5 space-y-4">
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">Title
                <input value={draft.title} maxLength={140} required onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950" /></label>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">Announcement
                <textarea value={draft.body} maxLength={2000} required rows={5} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                  className="mt-1.5 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950" /></label>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">Priority
                <select value={draft.priority} onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value as AnnouncementInput['priority'] }))}
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal dark:border-slate-700 dark:bg-slate-950">
                  <option value="GENERAL">General</option><option value="IMPORTANT">Important</option><option value="CRITICAL">Critical</option>
                </select></label>
              {saveAnnouncement.isError && <p role="alert" className="text-sm font-medium text-rose-600">The announcement could not be saved. Please try again.</p>}
              <div className="flex justify-end gap-2 pt-1"><Dialog.Close type="button" className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</Dialog.Close>
                <button type="submit" disabled={saveAnnouncement.isPending} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60">
                  {saveAnnouncement.isPending && <Loader2 size={16} className="animate-spin" />} {editing ? 'Save changes' : 'Publish announcement'}
                </button></div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
