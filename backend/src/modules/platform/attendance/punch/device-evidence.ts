import { createHash } from 'crypto';

/**
 * Device evidence for a punch (Phase 3).
 *
 * WHAT THIS IS: metadata recorded beside a punch so HR can see which browser
 * installation, on what kind of device, produced it.
 *
 * WHAT THIS IS NOT: identity, authentication or authorization. The Apex Device
 * ID is an opaque UUID a browser generated for itself and kept in its own
 * storage. Clearing that storage, or using Incognito, legitimately produces a
 * new one. Nothing may ever be allowed or refused because of it.
 *
 * Privacy boundary, enforced here and by the database CHECK:
 *   - the id must be a UUID; a hostname, serial, MAC, IMEI or fingerprint
 *     cannot be stored in its place;
 *   - only browser family and OS family are kept from request headers, never
 *     the raw User-Agent string;
 *   - a browser cannot tell a laptop from a desktop, so neither does this.
 *
 * Pure functions only, so every rule is unit-testable without a request.
 */

export type DeviceTypeValue = 'MOBILE' | 'TABLET' | 'LAPTOP_DESKTOP' | 'UNKNOWN';
export type CaptureChannelValue = 'CURRENT_DEVICE' | 'PHONE_HANDOFF';

/** What the browser is allowed to say about itself. Everything is optional. */
export interface ClientDeviceInput {
  deviceId?: unknown;
  /** The browser's own classification hint. Corroborated, never trusted alone. */
  deviceTypeHint?: unknown;
  /** navigator.userAgentData.mobile, when the browser supports it. */
  clientHintMobile?: unknown;
  /** navigator.userAgentData.platform, when supported. */
  clientHintPlatform?: unknown;
}

/** Only the headers this module reads. */
export interface DeviceRequestHeaders {
  userAgent?: string | null;
  secChUaMobile?: string | null;
  secChUaPlatform?: string | null;
}

export type BrowserFamily = 'Chrome' | 'Edge' | 'Firefox' | 'Safari' | 'Samsung Internet' | 'Opera' | 'Other';
export type OsFamily = 'Android' | 'iOS' | 'iPadOS' | 'Windows' | 'macOS' | 'Linux' | 'ChromeOS' | 'Other';

export interface NormalizedDeviceMetadata {
  browserFamily: BrowserFamily;
  osFamily: OsFamily;
  /** What the browser's Client Hints said, if anything. */
  clientHintMobile: boolean | null;
  /** How deviceType was decided, for HR's explanation. */
  classification: 'AGREED' | 'SERVER_ONLY' | 'CLIENT_ONLY' | 'CONFLICT' | 'NO_SIGNAL';
  version: 1;
}

export interface DeviceEvidence {
  deviceId: string | null;
  deviceType: DeviceTypeValue;
  deviceMetadata: NormalizedDeviceMetadata;
  /** Review reasons this evidence adds to the punch's HR review row. */
  reviewReasons: string[];
}

export const DEVICE_ID_UNAVAILABLE = 'DEVICE_ID_UNAVAILABLE';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DEVICE_TYPES: readonly DeviceTypeValue[] = ['MOBILE', 'TABLET', 'LAPTOP_DESKTOP', 'UNKNOWN'];

/**
 * A valid Apex Device ID, lowercased, or null.
 *
 * Anything that is not exactly a 36-character UUID is discarded rather than
 * rejected: a broken id must never cost an employee their punch, it only means
 * the device could not be identified.
 */
export function normalizeDeviceId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length !== 36 || !UUID_RE.test(trimmed)) return null;
  return trimmed;
}

function headerBool(value: string | null | undefined): boolean | null {
  if (value === '?1') return true;
  if (value === '?0') return false;
  return null;
}

function unquote(value: string | null | undefined): string {
  return (value ?? '').replace(/^"|"$/g, '').trim();
}

/** Browser family from a User-Agent, checked most-specific first. */
export function browserFamilyOf(userAgent: string | null | undefined): BrowserFamily {
  const ua = userAgent ?? '';
  if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet';
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'Firefox';
  if (/Chrome\/|CriOS\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return 'Safari';
  return 'Other';
}

/** OS family from Client Hints first, then the User-Agent. */
export function osFamilyOf(headers: DeviceRequestHeaders, clientPlatform?: unknown): OsFamily {
  const platform = unquote(headers.secChUaPlatform) || (typeof clientPlatform === 'string' ? clientPlatform : '');
  const p = platform.toLowerCase();
  if (p === 'android') return 'Android';
  if (p === 'ios') return 'iOS';
  if (p === 'windows') return 'Windows';
  if (p === 'macos') return 'macOS';
  if (p === 'linux') return 'Linux';
  if (p === 'chrome os' || p === 'chromeos') return 'ChromeOS';

  const ua = headers.userAgent ?? '';
  if (/Android/.test(ua)) return 'Android';
  if (/iPad/.test(ua)) return 'iPadOS';
  if (/iPhone|iPod/.test(ua)) return 'iOS';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Windows NT/.test(ua)) return 'Windows';
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Other';
}

/**
 * The server's own reading of the form factor, from headers alone.
 *
 * Sec-CH-UA-Mobile is the low-entropy hint browsers send by default; the
 * User-Agent tokens are the fallback for browsers without Client Hints.
 */
export function serverDeviceType(headers: DeviceRequestHeaders, os: OsFamily): DeviceTypeValue {
  const chMobile = headerBool(headers.secChUaMobile);
  const ua = headers.userAgent ?? '';
  if (os === 'iPadOS') return 'TABLET';
  if (os === 'iOS') return 'MOBILE';
  if (os === 'Android') {
    if (chMobile === true || /Mobile/.test(ua)) return 'MOBILE';
    return 'TABLET';
  }
  if (chMobile === true) return 'MOBILE';
  if (os === 'Windows' || os === 'macOS' || os === 'Linux' || os === 'ChromeOS') return 'LAPTOP_DESKTOP';
  return 'UNKNOWN';
}

function clientDeviceType(input: ClientDeviceInput): DeviceTypeValue | null {
  const hint = typeof input.deviceTypeHint === 'string' ? input.deviceTypeHint.toUpperCase() : null;
  if (hint && (DEVICE_TYPES as readonly string[]).includes(hint) && hint !== 'UNKNOWN') {
    return hint as DeviceTypeValue;
  }
  if (input.clientHintMobile === true) return 'MOBILE';
  return null;
}

/**
 * Builds the device evidence for one punch.
 *
 * The client's hint and the server's reading must agree. iPadOS Safari
 * presents itself as macOS, so a TABLET hint against a macOS desktop reading
 * is the one disagreement accepted. Any other disagreement, or no signal at
 * all, is UNKNOWN: recording a confident wrong answer is worse than recording
 * none.
 */
export function buildDeviceEvidence(
  input: ClientDeviceInput | null | undefined,
  headers: DeviceRequestHeaders,
): DeviceEvidence {
  const client = input ?? {};
  const deviceId = normalizeDeviceId(client.deviceId);
  const os = osFamilyOf(headers, client.clientHintPlatform);
  const browser = browserFamilyOf(headers.userAgent);
  const fromServer = serverDeviceType(headers, os);
  const fromClient = clientDeviceType(client);

  let deviceType: DeviceTypeValue;
  let classification: NormalizedDeviceMetadata['classification'];
  if (fromClient && fromServer !== 'UNKNOWN') {
    if (fromClient === fromServer) {
      deviceType = fromClient;
      classification = 'AGREED';
    } else if (fromClient === 'TABLET' && os === 'macOS') {
      deviceType = 'TABLET';
      classification = 'AGREED';
    } else {
      deviceType = 'UNKNOWN';
      classification = 'CONFLICT';
    }
  } else if (fromServer !== 'UNKNOWN') {
    deviceType = fromServer;
    classification = 'SERVER_ONLY';
  } else if (fromClient) {
    deviceType = fromClient;
    classification = 'CLIENT_ONLY';
  } else {
    deviceType = 'UNKNOWN';
    classification = 'NO_SIGNAL';
  }

  // Storage unavailable or cleared: the punch still goes ahead. The device is
  // recorded as UNKNOWN and HR gets a review item, never a popup or message.
  if (!deviceId) deviceType = 'UNKNOWN';

  return {
    deviceId,
    deviceType,
    deviceMetadata: {
      browserFamily: browser,
      osFamily: os,
      clientHintMobile: typeof client.clientHintMobile === 'boolean' ? client.clientHintMobile : headerBool(headers.secChUaMobile),
      classification,
      version: 1,
    },
    reviewReasons: deviceId ? [] : [DEVICE_ID_UNAVAILABLE],
  };
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * The short code HR sees, e.g. DEV-7K4M2P.
 *
 * Derived by hashing, so the stored id itself is never displayed and two
 * different ids are vanishingly unlikely to share a code.
 */
export function deviceShortCode(deviceId: string | null | undefined): string | null {
  const id = normalizeDeviceId(deviceId);
  if (!id) return null;
  const digest = createHash('sha256').update(id).digest();
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of digest) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < 6) {
      out += CROCKFORD[(buffer >> (bits - 5)) & 31];
      bits -= 5;
    }
    if (out.length >= 6) break;
  }
  return `DEV-${out}`;
}

const TYPE_LABEL: Record<DeviceTypeValue, string> = {
  MOBILE: 'Mobile',
  TABLET: 'Tablet',
  LAPTOP_DESKTOP: 'Laptop/Desktop',
  UNKNOWN: 'Unknown device',
};

/** Read the normalized metadata back, tolerating legacy free-form JSON. */
function metadataOf(raw: unknown): Partial<NormalizedDeviceMetadata> {
  if (!raw || typeof raw !== 'object') return {};
  const m = raw as Record<string, unknown>;
  if (m.version !== 1) return {};
  return {
    browserFamily: typeof m.browserFamily === 'string' ? (m.browserFamily as BrowserFamily) : undefined,
    osFamily: typeof m.osFamily === 'string' ? (m.osFamily as OsFamily) : undefined,
  };
}

/**
 * The single device label for HR/Admin screens and exports:
 *   Mobile · Android · Chrome · DEV-7K4M2P
 *   Laptop/Desktop · Windows · Chrome · DEV-2F8C1A
 *   Unknown device · Device ID unavailable
 * Historical punches (recorded before Phase 3) read "Not recorded".
 */
export function deviceLabel(row: {
  deviceId?: string | null;
  deviceType?: string | null;
  deviceMetadata?: unknown;
}): string {
  if (!row.deviceType) return 'Device not recorded';
  const type = (DEVICE_TYPES as readonly string[]).includes(row.deviceType)
    ? (row.deviceType as DeviceTypeValue)
    : 'UNKNOWN';
  const code = deviceShortCode(row.deviceId);
  if (!code) return `${TYPE_LABEL[type]} · Device ID unavailable`;
  const meta = metadataOf(row.deviceMetadata);
  const parts = [TYPE_LABEL[type]];
  if (meta.osFamily && meta.osFamily !== 'Other') parts.push(meta.osFamily);
  if (meta.browserFamily && meta.browserFamily !== 'Other') parts.push(meta.browserFamily);
  parts.push(code);
  return parts.join(' · ');
}

/** The HR/Admin view of one punch's device. Never the raw metadata. */
export function deviceView(row: {
  deviceId?: string | null;
  deviceType?: string | null;
  captureChannel?: string | null;
  deviceMetadata?: unknown;
}) {
  return {
    deviceType: row.deviceType ?? null,
    deviceCode: deviceShortCode(row.deviceId),
    captureChannel: row.captureChannel ?? null,
    deviceLabel: deviceLabel(row),
  };
}
