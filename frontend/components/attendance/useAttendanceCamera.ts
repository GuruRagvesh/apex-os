'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadPunchPhoto } from './punch-photo-api';
import {
  assessReadiness,
  judgeFrame,
  measureFrame,
  type CameraReadiness,
  type FrameVerdict,
} from './frame-quality';

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

/** Longest edge used for quality measurement. Enough detail, little work. */
const QUALITY_SAMPLE_EDGE = 240;

/**
 * Measures the drawn frame at a reduced size.
 *
 * Sharpness is scale-sensitive, so the sample edge is fixed rather than a
 * ratio: every frame is judged at the same resolution whatever the camera
 * reports, or a 4K webcam and a 640x480 one would be held to different bars.
 */
function judgeCanvas(source: HTMLCanvasElement, _ctx: CanvasRenderingContext2D): FrameVerdict {
  try {
    const scale = Math.min(1, QUALITY_SAMPLE_EDGE / Math.max(source.width, source.height));
    const w = Math.max(1, Math.round(source.width * scale));
    const h = Math.max(1, Math.round(source.height * scale));

    const small = document.createElement('canvas');
    small.width = w;
    small.height = h;
    const sctx = small.getContext('2d', { willReadFrequently: true });
    if (!sctx) return 'UNREADABLE';

    sctx.drawImage(source, 0, 0, w, h);
    const data = sctx.getImageData(0, 0, w, h).data;
    return judgeFrame(measureFrame(data, w, h));
  } catch {
    // getImageData throws on a tainted canvas. A frame that cannot be read
    // cannot be judged, and unjudged is not the same as acceptable.
    return 'UNREADABLE';
  }
}

function readinessMessage(readiness: CameraReadiness): string {
  const text: Record<string, string> = {
    NO_STREAM: 'The camera is not running. Try again, or use your phone.',
    TRACK_ENDED: 'The camera stopped. Another app may have taken it.',
    NOT_PLAYING: 'The camera preview is not playing. Try again.',
    NO_FRAME_DATA: 'The camera has not produced a picture yet. Wait a moment and try again.',
    ZERO_DIMENSIONS: 'The camera is not producing a picture. Try again, or use your phone.',
  };
  return text[readiness] ?? 'The camera is not ready.';
}

function frameMessage(verdict: FrameVerdict): string {
  const text: Record<string, string> = {
    BLANK: 'The camera view is not clear. Uncover the camera and try again.',
    TOO_DARK: 'The picture is too dark. Move to better lighting and try again.',
    TOO_BLURRY: 'The picture is too blurry. Hold the device steady and try again.',
    UNREADABLE: 'The picture could not be read. Try again.',
  };
  return text[verdict] ?? 'The picture could not be used. Try again.';
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

      // A swallowed play() failure followed by an unconditional 'ready' is how
      // a covered or blocked camera produced a black JPEG that was accepted as
      // attendance evidence. Playback must actually succeed.
      if (!videoRef.current) {
        stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
        setStatus('error');
        setError('The camera preview could not be attached.');
        return;
      }

      videoRef.current.srcObject = stream;
      try {
        await videoRef.current.play?.();
      } catch {
        stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
        streamRef.current = null;
        setStatus('error');
        setError('The camera preview could not start. Try again, or use your phone.');
        return;
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

    // Re-checked at the moment of capture: the stream can stop between the
    // preview looking fine and the button being pressed.
    const readiness = assessReadiness(video, streamRef.current?.getVideoTracks() ?? null);
    if (readiness !== 'READY') {
      setStatus('error');
      setError(readinessMessage(readiness));
      return null;
    }

    const canvas = document.createElement('canvas');
    // No `|| 1280` fallback. Zero dimensions mean no frame exists, and
    // substituting a default size is what manufactured the black image.
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setStatus('error');
      setError('The captured image could not be processed.');
      return null;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Judge the frame that was actually drawn, not the one the preview showed.
    // Downscaled first: quality is a whole-image property and measuring every
    // pixel of a 1280x720 frame on a phone is needless work.
    const verdict = judgeCanvas(canvas, ctx);
    if (verdict !== 'OK') {
      setStatus('ready');
      setError(frameMessage(verdict));
      return null;
    }
    setError(null);

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
