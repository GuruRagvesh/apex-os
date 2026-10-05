'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LAST_ACTIVITY_STORAGE_KEY,
  WORKDAY_CHANNEL,
  idleState,
  mergeActivity,
  type IdleState,
} from '@/lib/idle-detection';

/** How often the idle state is re-evaluated while detection is on. */
const TICK_MS = 15_000;
/** Activity is shared with other tabs at most this often. */
const SHARE_EVERY_MS = 5_000;

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'pointerdown', 'touchstart', 'wheel', 'scroll'] as const;

const ACTIVE: IdleState = { phase: 'ACTIVE', idleMs: 0, idleMinutes: 0, suggestEndOfDay: false };

/** The raw shared value; acceptance (finite, positive, not far in the future) is mergeActivity's job. */
function readShared(): string | null {
  try { return localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY); } catch { return null; }
}

/**
 * Measures inactivity while `enabled` (the backend says the person is
 * WORKING). Input in any of the person's tabs counts as activity in all of
 * them. Elapsed time comes from timestamps, so returning from sleep or a
 * background tab evaluates the real gap immediately; focus and visibility
 * changes re-evaluate but are not activity themselves.
 */
export function useIdleDetection({ enabled }: { enabled: boolean }) {
  const lastActivityRef = useRef<number>(Date.now());
  const lastSharedRef = useRef<number>(0);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const [state, setState] = useState<IdleState>(ACTIVE);

  const evaluate = useCallback(() => {
    const now = Date.now();
    // A future-dated shared value is ignored, and a poisoned in-memory value
    // recovers to now: neither can keep the person "active" forever.
    lastActivityRef.current = mergeActivity(lastActivityRef.current, now, readShared());
    setState(idleState(now, lastActivityRef.current));
  }, []);

  /** Record activity now (input, or "Yes, I'm here"), and share it. */
  const markActive = useCallback(() => {
    const now = Date.now();
    lastActivityRef.current = now;
    setState((s) => (s.phase === 'ACTIVE' ? s : ACTIVE));
    if (now - lastSharedRef.current >= SHARE_EVERY_MS) {
      lastSharedRef.current = now;
      try { localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(now)); } catch { /* storage unavailable */ }
      try { channelRef.current?.postMessage({ type: 'activity', at: now }); } catch { /* channel closed */ }
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setState(ACTIVE);
      return;
    }
    // Becoming eligible (Punch In, Resume, end of a break) is itself activity:
    // the idle clock starts now, never from before the person came back.
    lastActivityRef.current = Date.now();
    lastSharedRef.current = 0;
    markActive();

    let channel: BroadcastChannel | null = null;
    try {
      channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(WORKDAY_CHANNEL) : null;
    } catch { channel = null; }
    channelRef.current = channel;
    const onChannel = (e: MessageEvent) => {
      if (e.data?.type === 'activity') {
        lastActivityRef.current = mergeActivity(lastActivityRef.current, Date.now(), e.data.at);
        evaluate();
      }
    };
    channel?.addEventListener('message', onChannel);

    const onStorage = (e: StorageEvent) => {
      if (e.key === LAST_ACTIVITY_STORAGE_KEY) evaluate();
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') evaluate(); };

    ACTIVITY_EVENTS.forEach((name) => window.addEventListener(name, markActive, { passive: true, capture: true }));
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', evaluate);
    document.addEventListener('visibilitychange', onVisibility);
    const tick = setInterval(evaluate, TICK_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((name) => window.removeEventListener(name, markActive, { capture: true }));
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', evaluate);
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(tick);
      channel?.removeEventListener('message', onChannel);
      channel?.close();
      channelRef.current = null;
    };
  }, [enabled, evaluate, markActive]);

  return { ...state, lastActivityAt: lastActivityRef.current, markActive };
}
