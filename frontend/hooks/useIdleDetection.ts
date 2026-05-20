'use client';

import { useEffect, useRef, useCallback } from 'react';

interface IdleDetectionOptions {
  onWarning?: () => void;
  onIdle?: () => void;
  onSuggest?: () => void;
  isWorking: boolean;
}

export function useIdleDetection({ onWarning, onIdle, onSuggest, isWorking }: IdleDetectionOptions) {
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastActivityRef = useRef<Date>(new Date());

  const resetTimer = useCallback(() => {
    lastActivityRef.current = new Date();
    clearTimeout(warningTimerRef.current);
    if (onWarning) {
      warningTimerRef.current = setTimeout(onWarning, 10 * 60 * 1000);
    }
  }, [onWarning]);

  useEffect(() => {
    if (!isWorking) {
      clearTimeout(warningTimerRef.current);
      return;
    }

    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, resetTimer, { passive: true }));
    resetTimer();

    const checkInterval = setInterval(() => {
      const idleMs = Date.now() - lastActivityRef.current.getTime();
      const idleMinutes = idleMs / 60000;
      if (idleMinutes >= 45 && onSuggest) onSuggest();
      else if (idleMinutes >= 20 && onIdle) onIdle();
    }, 60000);

    return () => {
      events.forEach((e) => window.removeEventListener(e, resetTimer));
      clearTimeout(warningTimerRef.current);
      clearInterval(checkInterval);
    };
  }, [isWorking, resetTimer, onIdle, onSuggest]);
}
