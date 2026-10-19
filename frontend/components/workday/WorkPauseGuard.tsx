'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { workdayApi } from '@/lib/api';
import { WorkPauseOverlay } from './WorkPauseOverlay';
import { hideMeetingOverlay, showMeetingOverlay, useHiddenMeetingId } from './meeting-overlay-store';

/**
 * Locks every authenticated workspace route while the current user is paused.
 * The backend session is the source of truth, so the lock survives refreshes
 * and direct navigation instead of depending on which button started it.
 *
 * During a meeting the person may choose "Back to Apex": the meeting keeps
 * running and the layer stays hidden until they click the Meeting button.
 */
export function WorkPauseGuard() {
  const queryClient = useQueryClient();
  const [resuming, setResuming] = useState(false);
  const [elapsedMinutes, setElapsedMinutes] = useState(0);
  const hiddenMeetingId = useHiddenMeetingId();
  const { data, refetch } = useQuery({
    queryKey: ['workday-today'],
    queryFn: () => workdayApi.getToday() as Promise<any>,
    refetchInterval: 60_000,
    staleTime: 0,
  });

  const session = (data as any)?.session;
  const openBreak = session?.breakLogs?.find((entry: any) => !entry.endAt) ?? null;
  const paused = session?.status === 'ON_BREAK' && Boolean(openBreak);
  const isMeeting = openBreak?.breakType === 'MEETING';
  const meetingId: string | null = isMeeting ? openBreak?.meetingId ?? null : null;

  const { data: meeting } = useQuery({
    queryKey: ['meeting-v2-active', meetingId],
    queryFn: () => workdayApi.getActiveMeetingV2() as Promise<any>,
    enabled: Boolean(meetingId),
    refetchInterval: 20_000,
  });

  useEffect(() => {
    if (!paused || !openBreak?.startAt) {
      setElapsedMinutes(0);
      return;
    }

    const updateElapsed = () => {
      setElapsedMinutes(Math.max(0, Math.floor((Date.now() - new Date(openBreak.startAt).getTime()) / 60_000)));
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 10_000);
    return () => window.clearInterval(timer);
  }, [paused, openBreak?.startAt]);

  // A finished meeting must never leave the layer hidden for the next one.
  useEffect(() => {
    if (hiddenMeetingId && hiddenMeetingId !== meetingId) showMeetingOverlay();
  }, [hiddenMeetingId, meetingId]);

  const refreshAll = async () => {
    await Promise.all([
      refetch(),
      queryClient.invalidateQueries({ queryKey: ['meeting-v2-active'] }),
      queryClient.invalidateQueries({ queryKey: ['meeting-v2-options'] }),
    ]);
  };

  const resumeWork = async () => {
    if (resuming) return;
    setResuming(true);
    try {
      if (meetingId) {
        await workdayApi.leaveMeetingV2(meetingId);
        toast.success('Meeting recorded. Work resumed.');
      } else {
        const result = await workdayApi.endBreak() as any;
        toast.success(isMeeting ? 'Meeting ended. Work resumed.' : `Break ended — ${result?.durationMinutes ?? 0} min`);
      }
      showMeetingOverlay();
      await refreshAll();
    } catch (error: any) {
      toast.error(error?.message || 'Work could not be resumed');
      await refreshAll();
    } finally {
      setResuming(false);
    }
  };

  const cancelMeeting = async () => {
    if (!meetingId || resuming) return;
    setResuming(true);
    try {
      await workdayApi.cancelMeetingV2(meetingId);
      toast.success('Meeting cancelled. Nothing was recorded.');
      showMeetingOverlay();
      await refreshAll();
    } catch (error: any) {
      toast.error(error?.message || 'The meeting could not be cancelled');
      await refreshAll();
    } finally {
      setResuming(false);
    }
  };

  const overlayHidden = Boolean(meetingId) && hiddenMeetingId === meetingId;
  if (!paused || overlayHidden) return null;

  return (
    <WorkPauseOverlay
      kind={isMeeting ? 'meeting' : 'break'}
      elapsedMinutes={elapsedMinutes}
      plannedMinutes={openBreak?.estimatedMinutes}
      resuming={resuming}
      onResume={resumeWork}
      onBackToApex={meetingId ? () => hideMeetingOverlay(meetingId) : undefined}
      onCancelMeeting={meetingId && meeting?.isOrganizer ? cancelMeeting : undefined}
      meetingAgenda={meeting?.agenda ?? null}
      meetingPeople={(meeting?.attendees ?? []).map((person: any) => ({ name: person.name, status: person.status }))}
    />
  );
}
