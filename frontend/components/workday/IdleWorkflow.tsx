'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { workdayApi } from '@/lib/api';
import { useIdleDetection } from '@/hooks/useIdleDetection';
import {
  IDLE_SUGGEST_END_MS,
  LAST_ACTIVITY_STORAGE_KEY,
  WORKDAY_CHANNEL,
  acceptActivityTimestamp,
  claimIdleEpisode,
  idleDetectionEnabled,
  idleEpisodeKey,
  releaseIdleEpisode,
  shouldReportIdle,
} from '@/lib/idle-detection';
import { WORKDAY_TODAY_QUERY_KEY } from '@apex/operations-tickets-lifecycle/shared/ticket-creation-gate';
import { ACTIVE_TIMER_QUERY_KEY } from '@apex/operations-tickets-lifecycle/shared/review-workspace';
import { IdleWarningToast } from './IdleWarningToast';
import { IdlePopup } from './IdlePopup';

/** Everything an idle transition changes: the workday, the running clock, ticket views. */
export function refreshAfterWorkdayChange(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: WORKDAY_TODAY_QUERY_KEY });
  qc.invalidateQueries({ queryKey: ACTIVE_TIMER_QUERY_KEY });
  qc.invalidateQueries({ queryKey: ['my-attendance-today'] });
  qc.invalidateQueries({ queryKey: ['ticket'] });
  qc.invalidateQueries({ queryKey: ['tickets'] });
}

/** Tells the person's other tabs that the workday changed, so they refetch. */
export function announceWorkdayChange() {
  try {
    const channel = new BroadcastChannel(WORKDAY_CHANNEL);
    channel.postMessage({ type: 'workday-changed' });
    channel.close();
  } catch { /* BroadcastChannel unavailable: other tabs catch up on focus/poll */ }
}

/** Claims the episode across tabs (pruning stale claims). Storage unavailable: the backend still ignores a second report. */
function claimEpisode(key: string): boolean {
  try { return claimIdleEpisode(localStorage, key, Date.now()); } catch { return true; }
}

function releaseEpisode(key: string) {
  try { releaseIdleEpisode(localStorage, key); } catch { /* ignore */ }
}

/**
 * The idle workflow, mounted once in the authenticated dashboard shell.
 *
 * WORKING (backend) → 10 min without input: warning → 20 min: one report
 * (POST /workday/idle with the measured minutes; the backend back-dates the
 * pause of the employee and any review clock) → IDLE (backend) → the idle
 * prompt: Resume Work / Take a Break / End Workday. The prompt follows the
 * backend state, so every tab shows it, and it closes in every tab once the
 * workday leaves IDLE.
 */
export function IdleWorkflow() {
  const qc = useQueryClient();
  const { data: today, isLoading, isError } = useQuery({
    queryKey: WORKDAY_TODAY_QUERY_KEY,
    queryFn: () => workdayApi.getToday() as Promise<any>,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
  const session = (today as any)?.session ?? null;
  const enabled = idleDetectionEnabled(today as any, { isLoading, isError });
  const idle = useIdleDetection({ enabled });

  const inFlightRef = useRef(false);
  const reportedRef = useRef<string | null>(null);
  const [lastFailureAt, setLastFailureAt] = useState<number | null>(null);

  // Other tabs: refetch when one of them changed the workday.
  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    try { channel = new BroadcastChannel(WORKDAY_CHANNEL); } catch { return; }
    const onMessage = (e: MessageEvent) => { if (e.data?.type === 'workday-changed') refreshAfterWorkdayChange(qc); };
    channel.addEventListener('message', onMessage);
    return () => { channel?.removeEventListener('message', onMessage); channel?.close(); };
  }, [qc]);

  // Report once per idle episode.
  useEffect(() => {
    if (!session?.id) return;
    const episode = idleEpisodeKey(session.id, idle.lastActivityAt);
    const now = Date.now();
    if (!shouldReportIdle({
      enabled,
      phase: idle.phase,
      inFlight: inFlightRef.current,
      episodeReported: reportedRef.current === episode,
      lastFailureAtMs: lastFailureAt,
      nowMs: now,
    })) return;
    if (!claimEpisode(episode)) {
      // Another tab is reporting this episode; follow the backend instead.
      reportedRef.current = episode;
      qc.invalidateQueries({ queryKey: WORKDAY_TODAY_QUERY_KEY });
      return;
    }
    inFlightRef.current = true;
    reportedRef.current = episode;
    workdayApi.reportIdle(idle.idleMinutes)
      .then(() => {
        setLastFailureAt(null);
        refreshAfterWorkdayChange(qc);
        announceWorkdayChange();
      })
      .catch(() => {
        // Not reported: release the episode so this or another tab retries later.
        reportedRef.current = null;
        releaseEpisode(episode);
        setLastFailureAt(Date.now());
      })
      .finally(() => { inFlightRef.current = false; });
  }, [enabled, idle.phase, idle.idleMinutes, idle.lastActivityAt, session?.id, lastFailureAt, qc]);

  const status = session?.status;

  // While IDLE, detection is off in every tab, so the shared last-activity time
  // still marks when activity stopped: it drives the 45-minute suggestion in
  // every tab and after a reload, re-checked as time passes.
  const [idleNow, setIdleNow] = useState(() => Date.now());
  useEffect(() => {
    if (status !== 'IDLE') return;
    setIdleNow(Date.now());
    const t = setInterval(() => setIdleNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [status]);
  let idleSince = 0;
  try { idleSince = acceptActivityTimestamp(localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY), idleNow); } catch { idleSince = 0; }
  const suggestEndOfDay = status === 'IDLE' && idleSince > 0 && idleNow - idleSince >= IDLE_SUGGEST_END_MS;

  return (
    <>
      {enabled && idle.phase === 'WARNING' && <IdleWarningToast onDismiss={idle.markActive} />}
      {status === 'IDLE' && !session?.logoutAt && (
        <IdlePopup
          today={today}
          suggestEndOfDay={suggestEndOfDay}
          onResolved={() => { refreshAfterWorkdayChange(qc); announceWorkdayChange(); }}
        />
      )}
    </>
  );
}
