'use client';

import { useCallback, useState } from 'react';

/**
 * One-shot GPS reading for an attendance punch (PE-4).
 *
 * There is no silent fallback. If the position cannot be obtained the punch
 * does not proceed with a blank location — the server requires coordinates, and
 * quietly submitting without them would produce evidence that proves nothing.
 */

export type GeolocationStatus =
  | 'idle'
  | 'locating'
  | 'ready'
  | 'denied'
  | 'unavailable'
  | 'timeout'
  | 'error';

export interface GeoReading {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
}

export interface GeolocationState {
  status: GeolocationStatus;
  reading: GeoReading | null;
  error: string | null;
  locate: () => Promise<GeoReading | null>;
  reset: () => void;
}

export function useGeolocation(): GeolocationState {
  const [status, setStatus] = useState<GeolocationStatus>('idle');
  const [reading, setReading] = useState<GeoReading | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStatus('idle');
    setReading(null);
    setError(null);
  }, []);

  const locate = useCallback(async (): Promise<GeoReading | null> => {
    const geo = (globalThis as any)?.navigator?.geolocation;
    if (!geo?.getCurrentPosition) {
      setStatus('unavailable');
      setError('This device or browser cannot provide a location.');
      return null;
    }

    setStatus('locating');
    setError(null);

    return new Promise<GeoReading | null>((resolve) => {
      geo.getCurrentPosition(
        (pos: any) => {
          const next: GeoReading = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            // Kept as reported. The server decides whether it is good enough;
            // the client never rounds it into looking better than it is.
            accuracyMeters:
              typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : null,
          };
          setReading(next);
          setStatus('ready');
          resolve(next);
        },
        (err: any) => {
          // 1 PERMISSION_DENIED, 2 POSITION_UNAVAILABLE, 3 TIMEOUT
          if (err?.code === 1) {
            setStatus('denied');
            setError('Location access was denied. Allow location access to punch.');
          } else if (err?.code === 3) {
            setStatus('timeout');
            setError('Getting your location took too long. Please try again.');
          } else {
            setStatus('unavailable');
            setError('Your location could not be determined. Please try again.');
          }
          resolve(null);
        },
        {
          // A punch is a point-in-time claim about where someone is, so a cached
          // fix from an hour ago is worse than useless.
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 20_000,
        },
      );
    });
  }, []);

  return { status, reading, error, locate, reset };
}
