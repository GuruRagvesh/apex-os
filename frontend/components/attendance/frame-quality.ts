/**
 * Whether a camera frame is real enough to be attendance evidence.
 *
 * The previous implementation swallowed a failed `video.play()` and then set
 * READY unconditionally, while `capture()` used `video.videoWidth || 1280`. A
 * covered or non-playing camera therefore produced a full-size black JPEG —
 * a valid image file, accepted as evidence, proving nothing. The `|| 1280`
 * fallback actively turned "no frame" into "full-size blank frame".
 *
 * Two separate gates:
 *
 *   readiness  is there a live, playing stream with real dimensions?
 *   quality    does the current frame contain anything?
 *
 * Both must pass before capture is offered, and the captured frame is checked
 * again before upload — the stream can stop between the two.
 *
 * This is IMAGE QUALITY, not identity. Nothing here detects a face or proves
 * who is in the picture, and no message in this file implies otherwise.
 * Client-side checks are also a UX gate, not a security boundary: they can be
 * bypassed, which is why the server validates the upload independently.
 */

export type CameraReadiness =
  | 'READY'
  | 'NO_STREAM'
  | 'TRACK_ENDED'
  | 'NOT_PLAYING'
  | 'NO_FRAME_DATA'
  | 'ZERO_DIMENSIONS';

export type FrameVerdict = 'OK' | 'BLANK' | 'TOO_DARK' | 'TOO_BLURRY' | 'UNREADABLE';

/** HTMLMediaElement.readyState: 2 = HAVE_CURRENT_DATA. */
export const HAVE_CURRENT_DATA = 2;

export interface VideoLike {
  videoWidth: number;
  videoHeight: number;
  readyState: number;
  paused: boolean;
  ended: boolean;
}

export interface TrackLike {
  readyState: string;
}

/**
 * Readiness of the stream and element.
 *
 * Order is deliberate: the cheapest, most fundamental failure is reported
 * first, so the employee is told "camera stopped" rather than "frame too dark"
 * when the real problem is that nothing is running.
 */
export function assessReadiness(
  video: VideoLike | null,
  tracks: TrackLike[] | null,
): CameraReadiness {
  if (!video || !tracks || tracks.length === 0) return 'NO_STREAM';
  if (!tracks.some((t) => t.readyState === 'live')) return 'TRACK_ENDED';
  if (video.ended) return 'TRACK_ENDED';
  if (video.paused) return 'NOT_PLAYING';
  if (video.readyState < HAVE_CURRENT_DATA) return 'NO_FRAME_DATA';
  // Zero dimensions mean no frame exists. It is never a reason to substitute
  // a default size and draw whatever is there.
  if (video.videoWidth <= 0 || video.videoHeight <= 0) return 'ZERO_DIMENSIONS';
  return 'READY';
}

export interface FrameStats {
  /** Mean luma, 0-255. */
  brightness: number;
  /** Standard deviation of luma. Near zero means a uniform, contentless frame. */
  contrast: number;
  /** Variance of the Laplacian. Low means out of focus. */
  sharpness: number;
}

/** Rec. 601 luma. Matches how a person perceives brightness. */
const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * Thresholds.
 *
 * Deliberately permissive: this rejects a covered lens or a black frame, not a
 * dim office or an ordinary webcam. A gate that refuses real punches is worse
 * than no gate, because it pushes people to the manual path for no reason.
 */
export const QUALITY_THRESHOLDS = {
  minBrightness: 18,
  maxBrightness: 250,
  minContrast: 6,
  minSharpness: 12,
} as const;

export function measureFrame(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): FrameStats | null {
  if (width <= 0 || height <= 0) return null;
  if (pixels.length < width * height * 4) return null;

  const gray = new Float64Array(width * height);
  let sum = 0;
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    const v = luma(pixels[p], pixels[p + 1], pixels[p + 2]);
    gray[i] = v;
    sum += v;
  }
  const brightness = sum / gray.length;

  let variance = 0;
  for (let i = 0; i < gray.length; i++) {
    variance += (gray[i] - brightness) ** 2;
  }
  const contrast = Math.sqrt(variance / gray.length);

  // Variance of the 4-neighbour Laplacian: the standard cheap focus measure.
  // Borders are skipped rather than clamped, so an edge artefact cannot read
  // as detail.
  let lapSum = 0;
  let lapSumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap =
        4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
      lapSum += lap;
      lapSumSq += lap * lap;
      n++;
    }
  }
  const sharpness = n > 0 ? lapSumSq / n - (lapSum / n) ** 2 : 0;

  return { brightness, contrast, sharpness };
}

/**
 * Verdict for a measured frame.
 *
 * Blankness is checked before darkness: a covered lens and a dark room are
 * different problems with different advice, and "uncover the camera" is
 * useless to someone sitting in poor light.
 */
export function judgeFrame(
  stats: FrameStats | null,
  thresholds = QUALITY_THRESHOLDS,
): FrameVerdict {
  if (!stats) return 'UNREADABLE';
  if (stats.contrast < thresholds.minContrast) return 'BLANK';
  if (stats.brightness < thresholds.minBrightness) return 'TOO_DARK';
  if (stats.brightness > thresholds.maxBrightness) return 'BLANK';
  if (stats.sharpness < thresholds.minSharpness) return 'TOO_BLURRY';
  return 'OK';
}

export const READINESS_TEXT: Record<Exclude<CameraReadiness, 'READY'>, string> = {
  NO_STREAM: 'The camera is not running.',
  TRACK_ENDED: 'The camera stopped. Another app may have taken it.',
  NOT_PLAYING: 'The camera preview is not playing yet.',
  NO_FRAME_DATA: 'Waiting for the camera to produce a picture…',
  ZERO_DIMENSIONS: 'The camera is not producing a picture.',
};

export const FRAME_TEXT: Record<Exclude<FrameVerdict, 'OK'>, string> = {
  BLANK: 'The camera view is not clear. Uncover the camera and try again.',
  TOO_DARK: 'The picture is too dark. Move to better lighting and try again.',
  TOO_BLURRY: 'The picture is too blurry. Hold the device steady and try again.',
  UNREADABLE: 'The picture could not be read. Try again.',
};
