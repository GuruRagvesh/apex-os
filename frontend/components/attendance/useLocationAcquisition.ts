'use client';

import { useCallback, useRef, useState } from 'react';
import {
  FAILURE_TEXT,
  acquireLocation,
  type AcquisitionDiagnostic,
  type LocationFailureCode,
  type LocationSample,
} from './location-acquisition';

/**
 * Location for a punch, on either device.
 *
 * Shared by the desktop modal and the mobile handoff page so the two cannot
 * drift into different acquisition rules — a phone that tried harder than a
 * laptop, or vice versa, would make "why did my punch fail" unanswerable.
 *
 * The decision logic lives in location-acquisition.ts, which is pure and
 * tested. This is only the React surface around it.
 */

export type LocationPhase = 'idle' | 'locating' | 'ready' | 'failed';

export interface LocationAcquisitionState {
  phase: LocationPhase;
  sample: LocationSample | null;
  failure: LocationFailureCode | null;
  message: string | null;
  /** Kept so a support conversation can name the actual browser fault. */
  diagnostic: AcquisitionDiagnostic | null;
  /** True only for a refused permission: retrying re-prompts a browser that said no. */
  terminal: boolean;
  locate: () => Promise<LocationSample | null>;
  reset: () => void;
}

/** Promise wrapper so the pure module never touches a browser API directly. */
function browserGetPosition(options: PositionOptions): Promise<any> {
  return new Promise((resolve, reject) => {
    const geo = (globalThis as any)?.navigator?.geolocation;
    if (!geo?.getCurrentPosition) {
      reject(Object.assign(new Error('unsupported'), { code: 0 }));
      return;
    }
    geo.getCurrentPosition(resolve, reject, options);
  });
}

export function useLocationAcquisition(): LocationAcquisitionState {
  const [phase, setPhase] = useState<LocationPhase>('idle');
  const [sample, setSample] = useState<LocationSample | null>(null);
  const [failure, setFailure] = useState<LocationFailureCode | null>(null);
  const [diagnostic, setDiagnostic] = useState<AcquisitionDiagnostic | null>(null);
  const running = useRef(false);

  const reset = useCallback(() => {
    setPhase('idle');
    setSample(null);
    setFailure(null);
    setDiagnostic(null);
  }, []);

  const locate = useCallback(async (): Promise<LocationSample | null> => {
    // Two overlapping acquisitions would race and the loser's result could
    // overwrite the winner's.
    if (running.current) return null;
    running.current = true;

    setPhase('locating');
    setFailure(null);
    try {
      const outcome = await acquireLocation(browserGetPosition);
      setDiagnostic(outcome.diagnostic);

      if (outcome.ok === true) {
        setSample(outcome.sample);
        setPhase('ready');
        return outcome.sample;
      }
      setFailure(outcome.failure);
      setPhase('failed');
      return null;
    } finally {
      running.current = false;
    }
  }, []);

  return {
    phase,
    sample,
    failure,
    message: failure ? FAILURE_TEXT[failure] : null,
    diagnostic,
    // Everything except a denial is worth another try, and the UI says so
    // rather than reporting a transient fault as "location is off".
    terminal: failure === 'LOCATION_PERMISSION_DENIED' || failure === 'LOCATION_NOT_SUPPORTED',
    locate,
    reset,
  };
}
