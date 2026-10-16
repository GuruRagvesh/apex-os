'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { workdayApi } from '@/lib/api';
import { MeetingModal } from './MeetingModal';
import { WorkPauseOverlay } from './WorkPauseOverlay';

/**
 * Locks every authenticated workspace route while the current user is paused.
 * The backend session is the source of truth, so the lock survives refreshes
 * and direct navigation instead of depending on which button started it.
 */
export function WorkPauseGuard() {
  const [resuming, setResuming] = useState(false);
  const [elapsedMinutes, setElapsedMinutes] = useState(0);
  const [meetingToClassify, setMeetingToClassify] = useState<any | null>(null);
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

  const resumeWork = async () => {
    if (resuming) return;
    setResuming(true);
    try {
      const result = await workdayApi.endBreak() as any;
      if (isMeeting && !result?.breakLog?.meetingId) {
        setMeetingToClassify(result.breakLog);
      }
      toast.success(isMeeting ? 'Meeting timer stopped' : `Break ended — ${result?.durationMinutes ?? 0} min`);
      await refetch();
    } catch (error: any) {
      toast.error(error?.message || 'Work could not be resumed');
      await refetch();
    } finally {
      setResuming(false);
    }
  };

  return (
    <>
      {paused && (
        <WorkPauseOverlay
          kind={isMeeting ? 'meeting' : 'break'}
          elapsedMinutes={elapsedMinutes}
          plannedMinutes={openBreak?.estimatedMinutes}
          resuming={resuming}
          onResume={resumeWork}
        />
      )}
      {meetingToClassify && (
        <MeetingModal
          breakLog={meetingToClassify}
          onClose={() => setMeetingToClassify(null)}
          onChanged={() => refetch()}
        />
      )}
    </>
  );
}
