'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, Volume2, VolumeX } from 'lucide-react';
import toast from 'react-hot-toast';
import { usersApi } from '@apex/core-users/api';
import { useAuthStore } from '@apex/core-identity';
import { workdayApi } from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { DEFAULT_BREAK_SOUND, breakSoundSeconds, breakSoundSource, isBreakSoundId } from './BreakSoundPicker';
import { ModalPortal } from '@/components/ui/ModalPortal';

type BreakWarning = {
  breakLogId: string;
  breakType: string;
  estimatedMinutes: number | null;
  plannedEndAt: string;
  phase: 'EARLY' | 'FINAL';
  triggeredAt: string;
};

// An unanswered alarm rings in up to three rounds: the sound plays 20 times,
// pauses five minutes, then the next round starts. The scheduler re-sends the
// device notification on the same timetable (BREAK_ALARM_* in scheduler.service).
const ALARM_ROUNDS = 3;
const PLAYS_PER_ROUND = 20;
const PAUSE_BETWEEN_ROUNDS_MS = 5 * 60_000;

export function BreakWarningCenter() {
  const userId = useAuthStore((state) => state.user?.id);
  const queryClient = useQueryClient();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [mutedWarning, setMutedWarning] = useState<string | null>(null);

  const preferences = useQuery({
    queryKey: ['user-preferences', userId],
    queryFn: () => usersApi.getPreferences() as Promise<Record<string, unknown>>,
    enabled: Boolean(userId),
    staleTime: 30_000,
  });
  const warningQuery = useQuery({
    queryKey: ['active-break-warning'],
    queryFn: () => workdayApi.getBreakWarning() as Promise<{ warning: BreakWarning | null }>,
    enabled: Boolean(userId),
    refetchInterval: 15_000,
    // Keep checking while Apex is a background tab, so the alarm still starts
    // when the person is in another tab or watching a video.
    refetchIntervalInBackground: true,
  });

  useSocket({
    onNotificationNew: ({ notification }) => {
      if (notification?.entityType === 'BREAK') void queryClient.invalidateQueries({ queryKey: ['active-break-warning'] });
    },
    onBreakWarningChanged: () => void queryClient.invalidateQueries({ queryKey: ['active-break-warning'] }),
  });

  const warning = warningQuery.data?.warning ?? null;
  const warningKey = warning ? `${warning.breakLogId}:${warning.phase}` : null;
  const savedSound = preferences.data?.breakWarningSound;
  const selectedSound = isBreakSoundId(savedSound) ? savedSound : DEFAULT_BREAK_SOUND;

  const triggeredAt = warning?.triggeredAt ?? null;
  useEffect(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (!warningKey || !triggeredAt || mutedWarning === warningKey) return;
    const audio = new Audio(breakSoundSource(selectedSound));
    const playMs = breakSoundSeconds(selectedSound) * 1000;
    const roundMs = playMs * PLAYS_PER_ROUND;
    const cycleMs = roundMs + PAUSE_BETWEEN_ROUNDS_MS;
    let round = 0;
    let plays = 0;
    let pauseTimer: number | undefined;

    // Browsers block sound until the person has interacted with the page. If
    // that happens, ring on their next click or key press instead.
    function retryOnGesture() {
      window.removeEventListener('pointerdown', retryOnGesture);
      window.removeEventListener('keydown', retryOnGesture);
      playOnce();
    }
    function playOnce() {
      audio.currentTime = 0;
      void audio.play().catch(() => {
        window.addEventListener('pointerdown', retryOnGesture, { once: true });
        window.addEventListener('keydown', retryOnGesture, { once: true });
      });
    }
    function startRound(index: number, alreadyPlayed = 0) {
      if (index >= ALARM_ROUNDS) return;
      round = index;
      plays = alreadyPlayed;
      playOnce();
    }
    const onEnded = () => {
      plays += 1;
      if (plays < PLAYS_PER_ROUND) {
        playOnce();
      } else if (round + 1 < ALARM_ROUNDS) {
        pauseTimer = window.setTimeout(() => startRound(round + 1), PAUSE_BETWEEN_ROUNDS_MS);
      }
    };
    audio.addEventListener('ended', onEnded);
    audioRef.current = audio;

    // Join the schedule from the moment the alarm started, so a reload or a
    // second tab continues the current round instead of restarting it.
    const elapsed = Math.max(0, Date.now() - new Date(triggeredAt).getTime());
    const current = Math.floor(elapsed / cycleMs);
    const offset = elapsed - current * cycleMs;
    if (current < ALARM_ROUNDS) {
      if (offset < roundMs) startRound(current, Math.floor(offset / playMs));
      else pauseTimer = window.setTimeout(() => startRound(current + 1), cycleMs - offset);
    }

    return () => {
      audio.removeEventListener('ended', onEnded);
      window.removeEventListener('pointerdown', retryOnGesture);
      window.removeEventListener('keydown', retryOnGesture);
      window.clearTimeout(pauseTimer);
      audio.pause();
      audio.currentTime = 0;
    };
  }, [mutedWarning, selectedSound, triggeredAt, warningKey]);

  // While the alarm is up, flash the tab title so it stands out among other tabs.
  useEffect(() => {
    if (!warningKey) return;
    const originalTitle = document.title;
    let flashOn = false;
    const flash = window.setInterval(() => {
      flashOn = !flashOn;
      document.title = flashOn ? '⏰ Break alarm · Apex OS' : originalTitle;
    }, 1000);
    return () => {
      window.clearInterval(flash);
      document.title = originalTitle;
    };
  }, [warningKey]);

  const stopAlarm = () => {
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.currentTime = 0;
  };

  const resume = useMutation({
    mutationFn: () => workdayApi.endBreak(),
    onSuccess: async () => {
      stopAlarm();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['active-break-warning'] }),
        queryClient.invalidateQueries({ queryKey: ['workday-today'] }),
        queryClient.invalidateQueries({ queryKey: ['my-attendance-today'] }),
      ]);
      toast.success('Break ended. Welcome back.');
    },
    onError: (error: any) => toast.error(error?.response?.data?.message ?? 'Could not resume work'),
  });
  const later = useMutation({
    mutationFn: () => workdayApi.handleBreakWarning({
      breakLogId: warning!.breakLogId,
      phase: warning!.phase,
      action: 'LATER',
    }),
    onSuccess: () => {
      stopAlarm();
      void queryClient.invalidateQueries({ queryKey: ['active-break-warning'] });
    },
    onError: () => void queryClient.invalidateQueries({ queryKey: ['active-break-warning'] }),
  });
  // Rounds 2 and 3 of an early warning usually ring after the planned end.
  const breakTimeOver = warning ? new Date(warning.plannedEndAt).getTime() <= Date.now() : false;
  const durationLabel = useMemo(() => warning?.estimatedMinutes ? `${warning.estimatedMinutes}-minute break` : '60-minute default break', [warning]);

  return (
    <>
      {warning && (
        <ModalPortal>
          <div data-break-warning-layer className="apex-backdrop flex items-end justify-center p-4 sm:items-center" style={{ zIndex: 200 }} role="dialog" aria-modal="true" aria-labelledby="break-warning-title">
            <section className="w-full max-w-md rounded-card border p-5 shadow-xl" style={{ backgroundColor: 'var(--surface-elevated)', borderColor: 'var(--color-warning)' }}>
            <div className="flex items-start gap-3">
              <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: 'var(--color-warning-bg)', color: 'var(--color-warning)' }}>
                <AlarmClock size={20} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-warning)' }}>{durationLabel}</p>
                <h2 id="break-warning-title" className="mt-1 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {warning.phase === 'EARLY' && !breakTimeOver ? 'Your break ends in 5 minutes' : 'Your estimated break time is complete'}
                </h2>
                <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {warning.phase === 'EARLY' ? 'Resume work now, or choose Later to receive one final reminder at the estimated end time.' : 'You can resume work, or choose Later to continue without another reminder.'}
                </p>
              </div>
              <button
                type="button"
                className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
                style={{ color: 'var(--text-secondary)' }}
                aria-label={mutedWarning === warningKey ? 'Alarm muted' : 'Mute this alarm'}
                onClick={() => { stopAlarm(); setMutedWarning(warningKey); }}
              >
                {mutedWarning === warningKey ? <VolumeX size={20} /> : <Volume2 size={20} />}
              </button>
            </div>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="apex-btn apex-btn-secondary" disabled={later.isPending} onClick={() => later.mutate()}>Later</button>
              <button
                type="button"
                className="apex-btn"
                disabled={resume.isPending}
                onClick={() => resume.mutate()}
                style={{ backgroundColor: 'var(--color-success)', color: 'var(--text-inverse)' }}
              >
                {resume.isPending ? 'Resuming…' : 'Resume Work'}
              </button>
            </div>
            </section>
          </div>
        </ModalPortal>
      )}
    </>
  );
}
