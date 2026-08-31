'use client';

import { useEffect } from 'react';
import { useAttendanceCamera } from './useAttendanceCamera';

/**
 * Reusable live-capture surface for attendance punch (PE-3).
 *
 * A primitive, not a screen. PE-4 composes it with GPS and the Workday action;
 * this component only produces a server photo asset id and hands it upward.
 *
 * There is deliberately no file input anywhere in this component.
 */
export function AttendanceCamera({
  onCaptured,
  onCancel,
  handoff,
}: {
  onCaptured: (photoAssetId: string) => void;
  onCancel?: () => void;
  /** Set only on the phone handoff page, which uploads without a session. */
  handoff?: { handoffId: string; handoffToken: string } | null;
}) {
  const cam = useAttendanceCamera(handoff);

  useEffect(() => {
    void cam.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUse = async () => {
    const id = await cam.upload();
    if (id) onCaptured(id);
  };

  const blocked = cam.status === 'permission-denied' || cam.status === 'unavailable';

  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-hidden rounded-xl bg-black aspect-[4/3]">
        {cam.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cam.previewUrl} alt="Captured photo preview" className="h-full w-full object-cover" />
        ) : (
          <video
            ref={cam.videoRef}
            playsInline
            muted
            autoPlay
            className="h-full w-full object-cover"
          />
        )}
      </div>

      {cam.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {cam.error}
        </p>
      )}

      <div className="flex gap-2">
        {cam.status === 'ready' && (
          <button
            type="button"
            onClick={() => void cam.capture()}
            className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Take photo
          </button>
        )}

        {cam.status === 'captured' && (
          <>
            <button
              type="button"
              onClick={cam.retake}
              className="flex-1 rounded-lg border border-gray-300 py-2.5 text-sm font-medium dark:border-gray-600"
            >
              Retake
            </button>
            <button
              type="button"
              onClick={() => void handleUse()}
              className="flex-1 rounded-lg bg-green-600 py-2.5 text-sm font-medium text-white hover:bg-green-700"
            >
              Use this photo
            </button>
          </>
        )}

        {cam.status === 'uploading' && (
          <button
            type="button"
            disabled
            className="flex-1 rounded-lg bg-green-600/60 py-2.5 text-sm font-medium text-white"
          >
            Uploading…
          </button>
        )}

        {blocked && (
          <button
            type="button"
            onClick={() => void cam.start()}
            className="flex-1 rounded-lg border border-gray-300 py-2.5 text-sm font-medium dark:border-gray-600"
          >
            Try again
          </button>
        )}

        {onCancel && (
          <button
            type="button"
            onClick={() => {
              cam.stop();
              onCancel();
            }}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
