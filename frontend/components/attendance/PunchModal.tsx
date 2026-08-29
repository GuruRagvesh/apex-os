'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AttendanceCamera } from './AttendanceCamera';
import { useLocationAcquisition } from './useLocationAcquisition';
import { PunchHandoffQr } from './PunchHandoffQr';
import { newIdempotencyKey, submitPunch, type PunchResult, type PunchType } from './punch-api';
import { ModalPortal } from '../ui/ModalPortal';

/**
 * The employee-facing punch flow (PE-4).
 *
 * Composes the three things a punch needs — a live photo, a fresh GPS reading,
 * and the workday mutation — into one deliberate action. The server does the
 * rest: it decides the business date, the geofence verdict and which work
 * session this punch belongs to.
 *
 * Two properties matter more than the visuals here:
 *
 *  1. One idempotency key per deliberate attempt. A network retry reuses it, so
 *     a dropped response can never become a second punch.
 *  2. A location the server flags for review is still a successful punch. This
 *     screen never tells anyone they were marked absent, on leave, or docked —
 *     it is not empowered to make that call, and saying so would be false.
 */

type Phase = 'location' | 'photo' | 'submitting' | 'done' | 'failed';

const TITLES: Record<PunchType, string> = {
  PUNCH_IN: 'Punch in',
  PUNCH_OUT: 'Punch out',
};

/** Verdicts that are recorded, reviewable, and explicitly not a penalty. */
const REVIEW_VERDICTS = ['OUTSIDE_GEOFENCE', 'LOW_ACCURACY', 'UNAVAILABLE'];

export function PunchModal({
  type,
  onClose,
  onPunched,
}: {
  type: PunchType;
  onClose: () => void;
  onPunched: (result: PunchResult) => void;
}) {
  const geo = useLocationAcquisition();
  const [phase, setPhase] = useState<Phase>('location');
  const [error, setError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [result, setResult] = useState<PunchResult | null>(null);

  // Both survive a retry: the key so the server recognises the retry as the
  // same attempt, the photo so a transient failure does not force the employee
  // to stand in front of the camera again.
  const idempotencyKeyRef = useRef<string>(newIdempotencyKey());
  const photoAssetIdRef = useRef<string | null>(null);
  const capturedAtRef = useRef<string | null>(null);

  useEffect(() => {
    void geo.locate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (geo.phase === 'ready') setPhase('photo');
  }, [geo.phase]);

  const send = useCallback(async () => {
    const reading = geo.sample;
    const photoAssetId = photoAssetIdRef.current;
    // Belt and braces: neither can be missing by this point, and neither has a
    // safe default worth inventing.
    if (!reading || !photoAssetId) {
      setPhase('failed');
      setError('The punch is missing its location or photo. Please start again.');
      setCanRetry(false);
      return;
    }

    setPhase('submitting');
    setError(null);

    try {
      const res = await submitPunch({
        type,
        idempotencyKey: idempotencyKeyRef.current,
        latitude: reading.latitude,
        longitude: reading.longitude,
        accuracyMeters: reading.accuracyMeters,
        clientCapturedAt: capturedAtRef.current,
        photoAssetId,
      });
      setResult(res);
      setPhase('done');
      onPunched(res);
    } catch (err: any) {
      const statusCode = err?.response?.status;
      const message = err?.response?.data?.message;

      // A transient failure keeps the same key and the same photo, so pressing
      // "Try again" resumes the attempt rather than starting a new one. A
      // rejection by the server (422/400/403) is a decision, not a blip, and
      // must not be hammered.
      const transient = !statusCode || statusCode >= 500 || statusCode === 408 || statusCode === 429;

      setPhase('failed');
      setCanRetry(transient);
      setError(
        typeof message === 'string'
          ? message
          : transient
            ? 'The punch could not be sent. Check your connection and try again.'
            : 'The punch was not accepted.',
      );
    }
  }, [geo.sample, onPunched, type]);

  const handleCaptured = useCallback(
    (photoAssetId: string) => {
      photoAssetIdRef.current = photoAssetId;
      capturedAtRef.current = new Date().toISOString();
      void send();
    },
    [send],
  );

  // One flag per real fault, not one flag for every fault. A timeout is not
  // a refused permission, and telling an employee their location is off when
  // it is merely slow is what made this undiagnosable.
  const geoBlocked = geo.phase === 'failed';

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-900">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {TITLES[type]}
            </h2>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              A live photo and your current location are recorded with this punch.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={phase === 'submitting'}
            className="rounded-lg px-2 py-1 text-sm text-gray-400 hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-800"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {phase === 'location' && (
          <div className="grid gap-5 md:grid-cols-2 md:divide-x md:divide-[var(--border-secondary)]">
            <div className="py-6 text-center md:pr-5">
              {geoBlocked ? (
                <>
                  <p className="text-sm font-medium text-red-600 dark:text-red-400">
                    {geo.message}
                  </p>
                  {/* Only a refused permission is worth explaining as a setting.
                      A timeout or an unavailable position is transient, and the
                      phone beside it is usually the faster answer. */}
                  {!geo.terminal && (
                    <button
                      onClick={() => void geo.locate()}
                      className="mt-4 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white dark:bg-gray-100 dark:text-gray-900"
                    >
                      Try again
                    </button>
                  )}
                </>
              ) : (
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Getting your location…
                </p>
              )}
            </div>

            <div className="md:pl-5">
              <PunchHandoffQr type={type} onCompleted={onClose} />
            </div>
          </div>
        )}

        {phase === 'photo' && (
          <div className="grid gap-5 md:grid-cols-2 md:divide-x md:divide-[var(--border-secondary)]">
            <div className="md:pr-5">
              <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                Location captured
                {geo.sample?.accuracyMeters != null &&
                  ` · accurate to about ${Math.round(geo.sample.accuracyMeters)} m`}
              </p>
              <AttendanceCamera onCaptured={handleCaptured} onCancel={onClose} />
            </div>

            {/* Kept visible rather than shown only on failure: a laptop whose
                camera is refused mid-flow should not have to start again to
                find the phone route. */}
            <div className="md:pl-5">
              <PunchHandoffQr type={type} onCompleted={onClose} />
            </div>
          </div>
        )}

        {phase === 'submitting' && (
          <p className="py-8 text-center text-sm text-gray-600 dark:text-gray-300">
            Recording your punch…
          </p>
        )}

        {phase === 'done' && result && (
          <div className="py-6 text-center">
            <p className="text-sm font-semibold text-green-600 dark:text-green-400">
              {type === 'PUNCH_IN' ? 'Punched in' : 'Punched out'}
            </p>
            {REVIEW_VERDICTS.includes(result.locationVerification) && (
              // Recorded, flagged, and nothing more. Attendance outcomes are
              // decided by HR against policy, never announced by this screen.
              <p className="mx-auto mt-3 max-w-xs rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                Location needs review. Your punch was recorded and will be checked by HR.
              </p>
            )}
            <button
              onClick={onClose}
              className="mt-5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white dark:bg-gray-100 dark:text-gray-900"
            >
              Done
            </button>
          </div>
        )}

        {phase === 'failed' && (
          <div className="py-6 text-center">
            <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
            <div className="mt-4 flex justify-center gap-2">
              {canRetry && (
                <button
                  onClick={() => void send()}
                  className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white dark:bg-gray-100 dark:text-gray-900"
                >
                  Try again
                </button>
              )}
              <button
                onClick={onClose}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 dark:border-gray-700 dark:text-gray-300"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
      </div>
    </ModalPortal>
  );
}
