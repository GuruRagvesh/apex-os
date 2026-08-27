'use client';

import { useCallback, useEffect, useState } from 'react';
import { ImageOff, Loader2, RefreshCw } from 'lucide-react';
import { ModalPortal } from '../ui/ModalPortal';
import { getOwnPunchPhotoUrl } from './punch-photo-api';

/**
 * A punch photo, fetched only when it is actually going to be seen.
 *
 * Signed URLs are short-lived and scoped to the owner, so they are minted when
 * this mounts — inside the drawer — rather than for every punch when
 * /attendance loads. A month of punches would otherwise mint a month of URLs
 * that nobody looks at and that expire before they are used.
 *
 * The URL is held in component state for as long as it is valid and is never
 * persisted: not in localStorage, not in the attendance record, nowhere. It is
 * a presentation artifact.
 *
 * "Photo missing" and "preview unavailable" are DIFFERENT conditions and must
 * not be collapsed. The first means no evidence was captured — a real
 * attendance exception. The second means the evidence exists and the temporary
 * URL failed, which is a display problem and says nothing about the punch.
 */

type Phase = 'idle' | 'loading' | 'ready' | 'failed';

export function PunchPhoto({
  evidenceId,
  captured,
  label,
}: {
  evidenceId: string;
  /** Whether the server says a photo was captured at all. */
  captured: boolean;
  label: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [enlarged, setEnlarged] = useState(false);
  // One automatic refresh only. A URL that fails twice is not an expiry
  // problem, and retrying forever would hammer the endpoint behind a broken
  // image.
  const [refreshed, setRefreshed] = useState(false);

  const load = useCallback(async () => {
    setPhase('loading');
    try {
      setUrl(await getOwnPunchPhotoUrl(evidenceId));
      setPhase('ready');
    } catch {
      setUrl(null);
      setPhase('failed');
    }
  }, [evidenceId]);

  useEffect(() => {
    if (!captured) return;
    void load();
  }, [captured, load]);

  if (!captured) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
        <ImageOff size={13} className="flex-shrink-0" />
        {/* A genuine attendance exception, not a display failure. */}
        No photo was captured for this punch.
      </div>
    );
  }

  if (phase === 'loading' || phase === 'idle') {
    return (
      <div className="apex-text-muted flex h-40 items-center justify-center gap-2 rounded-lg border border-[var(--border-secondary)] text-xs">
        <Loader2 size={13} className="animate-spin" />
        Loading photo…
      </div>
    );
  }

  if (phase === 'failed' || !url) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border-secondary)] px-3 py-2 text-xs">
        <span className="apex-text-muted">
          {/* The evidence exists; only the temporary URL did not work. */}
          Photo evidence recorded · preview unavailable
        </span>
        <button
          onClick={() => {
            setRefreshed(false);
            void load();
          }}
          className="apex-text inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium hover:bg-[var(--bg-tertiary)]"
        >
          <RefreshCw size={11} />
          Retry
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setEnlarged(true)}
        className="block w-full overflow-hidden rounded-lg border border-[var(--border-secondary)]"
        aria-label={`Enlarge ${label} photo`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={`${label} evidence`}
          className="h-40 w-full object-cover"
          onError={() => {
            // A signed URL expires on its own schedule. Refresh once, then
            // report it as a preview problem rather than missing evidence.
            if (!refreshed) {
              setRefreshed(true);
              void load();
            } else {
              setPhase('failed');
            }
          }}
        />
      </button>

      {enlarged && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/80 p-4"
            onClick={() => setEnlarged(false)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={`${label} evidence, enlarged`}
              className="max-h-full max-w-full rounded-lg object-contain"
            />
          </div>
        </ModalPortal>
      )}
    </>
  );
}
