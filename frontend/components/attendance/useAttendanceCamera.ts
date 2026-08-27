'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadPunchPhoto } from './punch-photo-api';

/**
 * Live camera capture for attendance punch (PE-3).
 *
 * Deliberately offers no gallery or file-picker path. A punch photo must be
 * taken now, by this person, on this device — letting someone attach a saved
 * image would defeat the entire point of the evidence.
 *
 * Nothing is persisted client-side. The captured blob lives in component state
 * only until it is uploaded or discarded: no localStorage, no sessionStorage,
 * no base64 kept around after the upload resolves.
 */

export type CameraStatus =
  | 'idle'
  | 'starting'
  | 'ready'
  | 'captured'
  | 'uploading'
  | 'permission-denied'
  | 'unavailable'
  | 'error';

export interface AttendanceCameraState {
  status: CameraStatus;
  error: string | null;
  previewUrl: string | null;
  videoRef: React.RefObject<HTMLVideoElement>;
  start: () => Promise<void>;
  capture: () => Promise<Blob | null>;
  retake: () => void;
  upload: () => Promise<string | null>;
  stop: () => void;
}

export function useAttendanceCamera(): AttendanceCameraState {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const capturedAtRef = useRef<Date | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const [status, setStatus] = useState<CameraStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  /**
   * Releases the camera. Stopping every track matters: without it the device
   * indicator stays lit and the camera stays locked from other apps.
   */
  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setStatus('starting');

    const media = (globalThis as any)?.navigator?.mediaDevices;
    if (!media?.getUserMedia) {
      setStatus('unavailable');
      setError('This device or browser has no camera available.');
      return;
    }

    try {
      const stream = await media.getUserMedia({
        // Front-facing where supported. `facingMode` is a hint, not a promise:
        // a desktop with one webcam simply ignores it rather than failing.
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play?.().catch(() => {});
      }
      setStatus('ready');
    } catch (err: any) {
      const name = err?.name ?? '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setStatus('permission-denied');
        setError('Camera access was denied. Allow camera access to punch in.');
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setStatus('unavailable');
        setError('No usable camera was found on this device.');
      } else {
        setStatus('error');
        setError('The camera could not be started. Please try again.');
      }
    }
  }, []);

  /** Grabs the current frame as a JPEG blob and freezes the preview. */
  const capture = useCallback(async (): Promise<Blob | null> => {
    const video = videoRef.current;
    if (!video || status !== 'ready') return null;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setStatus('error');
      setError('The captured image could not be processed.');
      return null;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85),
    );
    if (!blob) {
      setStatus('error');
      setError('The captured image could not be processed.');
      return null;
    }

    blobRef.current = blob;
    capturedAtRef.current = new Date();

    // Object URL rather than a base64 data URL: the bytes stay out of React
    // state and out of anything that might be serialised.
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = URL.createObjectURL(blob);
    setPreviewUrl(previewUrlRef.current);

    // The stream is released as soon as a frame is held. Nothing more is needed
    // from the camera unless the user retakes.
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    setStatus('captured');
    return blob;
  }, [status]);

  /** Discards the frame and restarts the camera. */
  const retake = useCallback(() => {
    blobRef.current = null;
    capturedAtRef.current = null;
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
    setStatus('idle');
    void start();
  }, [start]);

  /**
   * Uploads the held frame and returns the opaque server asset id.
   *
   * The blob is dropped as soon as the server has it — the client keeps no
   * copy of a photograph it no longer needs.
   */
  const upload = useCallback(async (): Promise<string | null> => {
    if (!blobRef.current || !capturedAtRef.current) return null;
    setStatus('uploading');
    setError(null);
    try {
      const { photoAssetId } = await uploadPunchPhoto(blobRef.current, capturedAtRef.current);
      blobRef.current = null;
      return photoAssetId;
    } catch (err: any) {
      setStatus('error');
      setError(err?.response?.data?.message ?? 'The photo could not be uploaded. Please retry.');
      return null;
    }
  }, []);

  // Release the camera on unmount, including on an error path or a route
  // change mid-capture.
  useEffect(() => stop, [stop]);

  return { status, error, previewUrl, videoRef, start, capture, retake, upload, stop };
}
