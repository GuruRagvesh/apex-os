'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Loader2, Smartphone } from 'lucide-react';
import {
  cancelHandoff,
  createHandoff,
  getHandoffStatus,
  mobilePunchUrl,
  type HandoffStatus,
} from './handoff-api';
import { classifyHandoffFailure, describeHandoffFailure } from './handoff-failure';
import type { PunchType } from './punch-api';

/**
 * The phone route: a QR the employee scans to finish the punch on a device that
 * has a working camera and location.
 *
 * The QR is rendered locally in the browser — the URL never leaves the machine
 * to be drawn by a third-party image service, which would hand the handoff
 * secret to whoever runs it.
 *
 * Completion arrives two ways on purpose. The socket is instant; the poll is
 * what makes the flow finish anyway when the socket is blocked by a corporate
 * proxy, which is exactly the sort of network these employees are on.
 */

const POLL_MS = 2_500;

export function PunchHandoffQr({
  type,
  onCompleted,
}: {
  type: PunchType;
  onCompleted: () => void;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<HandoffStatus | 'CREATING' | 'ERROR'>('CREATING');
  const [error, setError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const handoffRef = useRef<string | null>(null);
  // A completed handoff must not be cancelled on the way out. Unmount happens
  // right after success, and cancelling then would race the punch that just
  // landed.
  const completedRef = useRef(false);

  /**
   * The completion callback lives in a ref, NOT in the dependency array.
   *
   * This is the whole reason the phone link kept failing. The parent passes an
   * inline arrow (`onClose={() => setPunchType(null)}`), so its identity
   * changes on every render of WorkdayBar -- which re-renders on a timer and on
   * every react-query refetch. With `onCompleted` as a dependency, each of
   * those renders tore this effect down and rebuilt it: cancel the handoff,
   * create another, cancel that one. The employee was looking at a QR that had
   * usually already been cancelled, and the burst of creates is exactly what a
   * throttler rejects.
   *
   * The effect now depends only on `type`, so one open modal means one handoff.
   */
  const completedCb = useRef(onCompleted);
  useEffect(() => {
    completedCb.current = onCompleted;
  }, [onCompleted]);

  /** Bumped to ask for a fresh handoff without remounting the component. */
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setStatus('CREATING');
    setError(null);
    setDataUrl(null);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const stopPolling = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    (async () => {
      try {
        const created = await createHandoff(type);
        if (cancelled) {
          // The dialog closed while this was in flight. Release the handoff
          // rather than leaving a live QR nobody is watching.
          void cancelHandoff(created.handoffId).catch(() => undefined);
          return;
        }
        handoffRef.current = created.handoffId;

        const url = mobilePunchUrl(window.location.origin, created.handoffId, created.token);
        // Rendered from the string in memory; the token is never sent anywhere
        // to produce this image.
        const png = await QRCode.toDataURL(url, { width: 220, margin: 1 });
        if (cancelled) return;

        setDataUrl(png);
        setStatus('WAITING');

        timer = setInterval(async () => {
          try {
            const s = await getHandoffStatus(created.handoffId);
            if (cancelled) return;
            setStatus(s.status);

            // Stop on every terminal state, not only success: polling a dead
            // handoff forever is a leak.
            if (s.status !== 'WAITING') {
              stopPolling();
              if (s.status === 'COMPLETED') {
                completedRef.current = true;
                completedCb.current();
              }
            }
          } catch {
            /* transient; the next tick tries again */
          }
        }, POLL_MS);
      } catch (err: any) {
        if (cancelled) return;
        setStatus('ERROR');
        setError(describeHandoffFailure(err));
        setCanRetry(classifyHandoffFailure(err).retryable);
      }
    })();

    return () => {
      cancelled = true;
      stopPolling();
      const id = handoffRef.current;
      // Never cancel a handoff that already produced a punch.
      if (id && !completedRef.current) void cancelHandoff(id).catch(() => undefined);
    };
  }, [type, attempt]);

  if (status === 'ERROR') {
    return (
      <div className="text-center">
        <div className="mb-2 flex items-center justify-center gap-1.5">
          <Smartphone size={14} className="apex-text-subtle" />
          <span className="apex-text text-xs font-semibold">Use your phone</span>
        </div>
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        {canRetry && (
          <button
            onClick={retry}
            className="mt-3 rounded-lg border border-[var(--border-secondary)] px-3 py-1.5 text-sm apex-text"
          >
            Try again
          </button>
        )}
      </div>
    );
  }

  if (status === 'EXPIRED' || status === 'CANCELLED') {
    return (
      <div className="text-center">
        <div className="mb-2 flex items-center justify-center gap-1.5">
          <Smartphone size={14} className="apex-text-subtle" />
          <span className="apex-text text-xs font-semibold">Use your phone</span>
        </div>
        <p className="apex-text-muted text-sm">This phone link has expired.</p>
        <button
          onClick={retry}
          className="mt-3 rounded-lg border border-[var(--border-secondary)] px-3 py-1.5 text-sm apex-text"
        >
          New link
        </button>
      </div>
    );
  }

  return (
    <div className="text-center">
      <div className="mb-2 flex items-center justify-center gap-1.5">
        <Smartphone size={14} className="apex-text-subtle" />
        <span className="apex-text text-xs font-semibold">Use your phone</span>
      </div>

      <div className="mx-auto flex h-[220px] w-[220px] items-center justify-center rounded-xl bg-white p-2">
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dataUrl} alt="Scan to complete your punch on your phone" className="h-full w-full" />
        ) : (
          <Loader2 size={20} className="animate-spin text-gray-400" />
        )}
      </div>

      <p className="apex-text-muted mt-2 text-xs">
        Scan with your phone camera to finish this punch there.
      </p>
      <p className="apex-text-subtle mt-1 text-[11px]">
        You will need to be signed in to Apex OS on your phone.
      </p>
    </div>
  );
}
