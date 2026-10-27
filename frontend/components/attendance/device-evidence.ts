/**
 * Browser-installation evidence for Phase 3 attendance punches.
 *
 * This is deliberately not a hardware fingerprint. It is a random UUID kept
 * in this browser's local storage. Clearing storage or using a private window
 * can make it unavailable; that never blocks the punch.
 */

/**
 * Scoped to the environment so a staging and a production tab in the same
 * browser never share an installation ID.
 */
const ENVIRONMENT = process.env.NEXT_PUBLIC_APEX_ENVIRONMENT || process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV || 'unknown';
export const DEVICE_ID_STORAGE_KEY = `apex-os:${ENVIRONMENT}:attendance-device-id:v1`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type ClientDeviceEvidence = {
  deviceId: string | null;
  deviceTypeHint: 'MOBILE' | 'TABLET' | 'LAPTOP_DESKTOP' | null;
  clientHintMobile: boolean | null;
  clientHintPlatform: string | null;
};

function installationId(): string | null {
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    // A stored value that is not exactly a UUID is replaced, never sent.
    if (existing && UUID.test(existing)) return existing;
    const id = globalThis.crypto?.randomUUID?.()?.toLowerCase();
    if (!id || !UUID.test(id)) return null;
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, id);
    // Storage that silently refuses writes (some private modes) is unavailable.
    return window.localStorage.getItem(DEVICE_ID_STORAGE_KEY) === id ? id : null;
  } catch {
    return null;
  }
}

function formFactor(mobile: boolean | null): ClientDeviceEvidence['deviceTypeHint'] {
  const ua = window.navigator.userAgent;
  if (/iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'TABLET';
  if (mobile === true || /iPhone|iPod|Android.*Mobile/i.test(ua)) return 'MOBILE';
  if (/Windows|Macintosh|Linux|CrOS/i.test(ua)) return 'LAPTOP_DESKTOP';
  return null;
}

export function currentDeviceEvidence(): ClientDeviceEvidence {
  const uaData = (window.navigator as Navigator & {
    userAgentData?: { mobile?: boolean; platform?: string };
  }).userAgentData;
  const mobile = typeof uaData?.mobile === 'boolean' ? uaData.mobile : null;
  return {
    deviceId: installationId(),
    deviceTypeHint: formFactor(mobile),
    clientHintMobile: mobile,
    clientHintPlatform: typeof uaData?.platform === 'string' ? uaData.platform : null,
  };
}
