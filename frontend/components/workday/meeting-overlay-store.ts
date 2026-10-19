'use client';

import { useSyncExternalStore } from 'react';

/**
 * Whether the person chose "Back to Apex" for a running meeting. The meeting
 * keeps running on the server; this only hides the full-screen meeting layer
 * in this browser tab until they click the (red, pulsing) Meeting button.
 * Kept per meeting id in sessionStorage so a refresh keeps their choice.
 */
const KEY = 'apex-meeting-overlay-hidden';
const listeners = new Set<() => void>();

function read(): string | null {
  try { return window.sessionStorage.getItem(KEY); } catch { return null; }
}

export function hideMeetingOverlay(meetingId: string) {
  try { window.sessionStorage.setItem(KEY, meetingId); } catch { /* private mode: in-memory only */ }
  memory = meetingId;
  listeners.forEach((fn) => fn());
}

export function showMeetingOverlay() {
  try { window.sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  memory = null;
  listeners.forEach((fn) => fn());
}

let memory: string | null = null;

function snapshot(): string | null {
  return typeof window === 'undefined' ? null : (read() ?? memory);
}

/** The id of the meeting whose overlay is hidden, or null. */
export function useHiddenMeetingId(): string | null {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    snapshot,
    () => null,
  );
}
