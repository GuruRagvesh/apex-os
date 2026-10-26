'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Megaphone, Undo2 } from 'lucide-react';
import { useAuthStore } from '@apex/core-identity';
import { ModalPortal } from '@/components/ui/ModalPortal';
import { dashboardApi } from '@apex/intelligence-dashboard/api';

type CurrentAnnouncement = {
  id: string;
  title: string;
  body: string;
  priority: 'GENERAL' | 'IMPORTANT' | 'CRITICAL';
  startsAt: string;
  endsAt: string | null;
  updatedAt?: string;
  creatorName?: string;
};

const storageKey = (userId: string, item: CurrentAnnouncement) =>
  `apex:announcement-seen:${userId}:${item.id}:${item.updatedAt ?? item.startsAt}`;

/**
 * Delivers each new or materially edited announcement once as a blocking,
 * app-wide notice. The durable Notification Center entry is created by the
 * backend; this local receipt only prevents the full-screen notice from
 * blocking the same browser on every route change or refresh.
 */
export function AnnouncementOverlayGuard() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const layerRef = useRef<HTMLElement | null>(null);
  const [receiptVersion, setReceiptVersion] = useState(0);
  const { data = [] } = useQuery({
    queryKey: ['current-announcements', user?.id],
    queryFn: () => dashboardApi.getCurrentAnnouncements() as Promise<CurrentAnnouncement[]>,
    enabled: Boolean(user?.id),
    staleTime: 60_000,
    // Socket notifications invalidate this query immediately. Five minutes is
    // only a low-cost recovery path for a device that missed the socket event.
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
  });

  const announcement = useMemo(() => {
    if (!user?.id || typeof window === 'undefined') return null;
    return data.find((item) => {
      try { return window.localStorage.getItem(storageKey(user.id, item)) !== 'seen'; }
      catch { return true; }
    }) ?? null;
  }, [data, receiptVersion, user?.id]);

  useEffect(() => {
    if (!announcement) return;
    const layer = layerRef.current;
    if (!layer) return;
    const siblings = Array.from(document.body.children).filter((node) => node !== layer) as HTMLElement[];
    const previous = siblings.map((node) => ({ node, inert: node.inert }));
    siblings.forEach((node) => { node.inert = true; });
    return () => previous.forEach(({ node, inert }) => { node.inert = inert; });
  }, [announcement]);

  if (!announcement || !user?.id) return null;

  const handleReturn = () => {
    try { window.localStorage.setItem(storageKey(user.id, announcement), 'seen'); } catch { /* storage may be blocked */ }
    setReceiptVersion((version) => version + 1);
    router.push('/dashboard');
  };

  return (
    <ModalPortal>
      <section ref={layerRef} role="dialog" aria-modal="true" aria-labelledby="announcement-title"
        className="fixed inset-0 z-[145] grid place-items-center overflow-hidden bg-slate-950/65 p-4 backdrop-blur-xl">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(59,130,246,0.28),transparent_38rem)]" aria-hidden="true" />
        <div className="relative w-[min(92vw,680px)] overflow-hidden rounded-3xl border border-white/20 bg-white/95 shadow-[0_2rem_7rem_rgba(2,8,23,0.55)] dark:bg-slate-900/95">
          <div className={`h-2 ${announcement.priority === 'CRITICAL' ? 'bg-rose-500' : announcement.priority === 'IMPORTANT' ? 'bg-amber-400' : 'bg-blue-600'}`} />
          <div className="p-7 sm:p-10">
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 shadow-inner dark:bg-blue-950 dark:text-blue-300">
              <Megaphone size={27} aria-hidden="true" />
            </span>
            <p className="mt-5 text-xs font-bold uppercase tracking-[0.16em] text-blue-600">APEX OS announcement</p>
            <h2 id="announcement-title" className="mt-2 text-3xl font-extrabold tracking-tight text-slate-950 dark:text-white sm:text-4xl">{announcement.title}</h2>
            <p className="mt-5 whitespace-pre-wrap text-base leading-7 text-slate-600 dark:text-slate-300">{announcement.body}</p>
            <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-5 dark:border-slate-700">
              <p className="text-xs text-slate-500">Published {new Date(announcement.startsAt).toLocaleString()}{announcement.creatorName ? ` by ${announcement.creatorName}` : ''}</p>
              <button type="button" onClick={handleReturn} autoFocus
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-600/20 transition hover:-translate-y-0.5 hover:bg-blue-700 focus-visible:outline focus-visible:outline-4 focus-visible:outline-blue-300">
                <Undo2 size={17} aria-hidden="true" /> Return
              </button>
            </div>
          </div>
        </div>
      </section>
    </ModalPortal>
  );
}
