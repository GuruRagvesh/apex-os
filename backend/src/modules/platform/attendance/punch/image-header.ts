/**
 * Image dimensions read straight from the file header.
 *
 * The client refuses blank, dark and blurred frames, but client-side checks are
 * a user-experience gate, not a security boundary: anything the browser decides
 * can be bypassed by not using the browser. So the server independently proves
 * the upload is a real image of a plausible size.
 *
 * Deliberately dependency-free. Decoding pixels would need `sharp` — a large
 * native module — and that buys blur and darkness analysis the client already
 * does well enough for its purpose. Reading a header proves the bytes are an
 * image and how big it is, which is the part a client cannot be trusted on.
 *
 * NOT claimed: that a passing image contains a person, a face, or the right
 * person. This is structure, not content.
 *
 * Every parser is bounds-checked before it reads. A truncated or malformed
 * header returns null rather than throwing or, worse, reading past the buffer
 * into whatever followed it.
 */

export interface ImageDimensions {
  width: number;
  height: number;
  format: 'jpeg' | 'png' | 'webp';
}

/**
 * A punch photo below this on either edge is not a camera frame.
 *
 * Low enough to accept an old webcam, high enough to reject a 1x1 pixel or an
 * icon submitted in place of evidence.
 */
export const MIN_PHOTO_EDGE_PX = 120;

function readPng(buf: Buffer): ImageDimensions | null {
  // 8-byte signature, then a 25-byte IHDR whose width/height sit at 16..24.
  if (buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;

  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), format: 'png' };
}

function readJpeg(buf: Buffer): ImageDimensions | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;

  let offset = 2;
  // Walk the marker segments to the frame header. Bounded by the buffer length
  // on every read, so a truncated file simply runs out and returns null.
  while (offset + 3 < buf.length) {
    if (buf[offset] !== 0xff) return null;

    const marker = buf[offset + 1];

    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    // Start of scan: pixel data begins, and no frame header was found.
    if (marker === 0xda) return null;

    const length = buf.readUInt16BE(offset + 2);
    if (length < 2) return null;

    // SOF0..SOF15, excluding the non-frame markers in that range.
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

    if (isFrame) {
      // length(2) precision(1) height(2) width(2)
      if (offset + 9 >= buf.length) return null;
      return {
        height: buf.readUInt16BE(offset + 5),
        width: buf.readUInt16BE(offset + 7),
        format: 'jpeg',
      };
    }
    offset += 2 + length;
  }
  return null;
}

function readWebp(buf: Buffer): ImageDimensions | null {
  // RIFF....WEBP
  if (buf.length < 30) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
    return null;
  }

  const chunk = buf.toString('ascii', 12, 16);

  if (chunk === 'VP8 ') {
    // Lossy: 3-byte frame tag, 3-byte sync, then 14-bit width and height.
    if (buf.length < 30) return null;
    return {
      width: buf.readUInt16LE(26) & 0x3fff,
      height: buf.readUInt16LE(28) & 0x3fff,
      format: 'webp',
    };
  }
  if (chunk === 'VP8L') {
    // Lossless: 1 signature byte, then 14 bits width and 14 bits height,
    // each stored minus one.
    if (buf.length < 25) return null;
    const bits = buf.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
      format: 'webp',
    };
  }
  if (chunk === 'VP8X') {
    // Extended: 24-bit little-endian canvas size, each stored minus one.
    if (buf.length < 30) return null;
    return {
      width: (buf.readUIntLE(24, 3) & 0xffffff) + 1,
      height: (buf.readUIntLE(27, 3) & 0xffffff) + 1,
      format: 'webp',
    };
  }
  return null;
}

/** Dimensions, or null if the bytes are not a readable image of a known type. */
export function readImageDimensions(buf: Buffer): ImageDimensions | null {
  if (!buf || buf.length === 0) return null;

  const dims = readPng(buf) ?? readJpeg(buf) ?? readWebp(buf);
  if (!dims) return null;

  // A header can parse structurally and still describe nothing.
  if (!Number.isFinite(dims.width) || !Number.isFinite(dims.height)) return null;
  if (dims.width <= 0 || dims.height <= 0) return null;

  return dims;
}

export type ImageRejection =
  | 'EMPTY'
  | 'UNREADABLE_HEADER'
  | 'ZERO_DIMENSIONS'
  | 'TOO_SMALL';

export interface ImageCheck {
  ok: boolean;
  rejection: ImageRejection | null;
  dimensions: ImageDimensions | null;
}

export function checkPunchPhotoBytes(
  buf: Buffer,
  minEdge = MIN_PHOTO_EDGE_PX,
): ImageCheck {
  if (!buf || buf.length === 0) {
    return { ok: false, rejection: 'EMPTY', dimensions: null };
  }

  const dimensions = readImageDimensions(buf);
  if (!dimensions) {
    return { ok: false, rejection: 'UNREADABLE_HEADER', dimensions: null };
  }
  if (dimensions.width <= 0 || dimensions.height <= 0) {
    return { ok: false, rejection: 'ZERO_DIMENSIONS', dimensions };
  }
  if (dimensions.width < minEdge || dimensions.height < minEdge) {
    return { ok: false, rejection: 'TOO_SMALL', dimensions };
  }

  return { ok: true, rejection: null, dimensions };
}

export const IMAGE_REJECTION_TEXT: Record<ImageRejection, string> = {
  EMPTY: 'The photo was empty.',
  UNREADABLE_HEADER: 'The photo could not be read as an image.',
  ZERO_DIMENSIONS: 'The photo has no picture in it.',
  TOO_SMALL: `A punch photo must be at least ${MIN_PHOTO_EDGE_PX} pixels on each side.`,
};
