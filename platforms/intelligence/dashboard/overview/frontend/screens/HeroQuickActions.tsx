'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BriefcaseBusiness, Coffee, PanelRightOpen, UsersRound, X } from 'lucide-react';
import { BreakModal } from '@/components/workday/BreakModal';
import { MeetingStartModal } from '@/components/workday/MeetingStartModal';
import { showMeetingOverlay, useHiddenMeetingId } from '@/components/workday/meeting-overlay-store';
import { workdayApi } from '@/lib/api';
import { ModalPortal } from '../components/ModalPortal';
import { dashboardApi } from '../api';
import { WorkspaceSection } from './WorkspaceSection';
import type { HomeWorkspace } from './home-types';

type PauseType = 'break' | 'meeting' | null;

export function HeroQuickActions({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const { data: workday } = useQuery({
    queryKey: ['workday-today'],
    queryFn: () => workdayApi.getToday() as Promise<any>,
    staleTime: 0,
  });
  const [pauseType, setPauseType] = useState<PauseType>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const hiddenMeetingId = useHiddenMeetingId();

  useEffect(() => {
    if (!workspaceOpen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setWorkspaceOpen(false); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [workspaceOpen]);

  const closePause = () => setPauseType(null);
  const canStartPause = (workday as any)?.session?.status === 'WORKING';
  const openBreak = (workday as any)?.session?.breakLogs?.find((entry: any) => !entry.endAt) ?? null;
  // "Back to Apex" was chosen: the meeting is still running, so the button turns red and pulses.
  const meetingLive = Boolean(openBreak?.meetingId) && openBreak?.breakType === 'MEETING' && hiddenMeetingId === openBreak.meetingId;
  const onPauseStarted = () => {
    closePause();
    queryClient.invalidateQueries({ queryKey: ['workday-today'] });
  };
  const onMeetingButton = () => {
    if (meetingLive) { showMeetingOverlay(); return; }
    setPauseType('meeting');
  };
  const prefetchWorkspace = useCallback(() => queryClient.prefetchQuery({
    queryKey: ['home-workspace', userId],
    queryFn: () => dashboardApi.getHomeWorkspace() as Promise<HomeWorkspace>,
    staleTime: 5 * 60_000,
  }), [queryClient, userId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void prefetchWorkspace(); }, 1_200);
    return () => window.clearTimeout(timer);
  }, [prefetchWorkspace]);

  return <>
    <div className="apex-hero-quick-actions" aria-label="Quick workday actions">
      <button type="button" onClick={() => setPauseType('break')} disabled={!canStartPause} title={canStartPause ? 'Start a tracked break' : 'Start work to take a tracked break'} className="apex-hero-quick-action apex-hero-quick-action-break"><Coffee size={18} aria-hidden="true" />Break</button>
      <button type="button" onClick={onMeetingButton} disabled={!canStartPause && !meetingLive} title={meetingLive ? 'Meeting in progress. Click to return to it' : canStartPause ? 'Start a tracked meeting' : 'Start work to begin a meeting'} className={`apex-hero-quick-action apex-hero-quick-action-meeting${meetingLive ? ' apex-hero-quick-action-meeting-live' : ''}`} aria-live="polite"><UsersRound size={18} aria-hidden="true" />{meetingLive ? 'In meeting' : 'Meeting'}</button>
      <button type="button" onPointerEnter={() => { void prefetchWorkspace(); }} onFocus={() => { void prefetchWorkspace(); }} onClick={() => { void prefetchWorkspace(); setWorkspaceOpen(true); }} className="apex-hero-quick-action apex-hero-quick-action-primary" aria-haspopup="dialog" aria-expanded={workspaceOpen}><PanelRightOpen size={18} aria-hidden="true" />Quick access</button>
    </div>

    {pauseType === 'break' && <BreakModal onClose={closePause} onBreakStarted={onPauseStarted} />}
    {pauseType === 'meeting' && <MeetingStartModal onClose={closePause} onStarted={onPauseStarted} />}

    {workspaceOpen && <ModalPortal>
      <div className="apex-workspace-drawer-layer" role="presentation">
        <button type="button" className="apex-workspace-drawer-scrim" aria-label="Close quick access" onClick={() => setWorkspaceOpen(false)} />
        <aside className="apex-workspace-drawer" role="dialog" aria-modal="true" aria-label="Quick access workspace">
          <header className="apex-workspace-drawer-header">
            <div className="flex min-w-0 items-center gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700"><BriefcaseBusiness size={18} /></span><div><p className="text-sm font800 font-semibold text-slate-900">Quick access</p><p className="mt-0.5 text-xs text-slate-500">Your personal workspace</p></div></div>
            <button type="button" onClick={() => setWorkspaceOpen(false)} className="apex-workspace-drawer-close" aria-label="Close quick access"><X size={18} /></button>
          </header>
          <div className="apex-workspace-drawer-content"><WorkspaceSection userId={userId} drawer /></div>
        </aside>
      </div>
    </ModalPortal>}
  </>;
}
