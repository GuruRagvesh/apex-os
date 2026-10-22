import {
  buildDeviceEvidence,
  deviceLabel,
  deviceShortCode,
  normalizeDeviceId,
} from '../../src/modules/platform/attendance/punch/device-evidence';

const ID_A = '0b6f2c3e-8a41-4f7d-9c55-3e2a1d4b5c6f';
const ID_B = '6d1e2f3a-4b5c-4d6e-8f70-112233445566';
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const CHROME_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const SAFARI_IPAD_DESKTOP_MODE = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

describe('Phase 3 Apex browser-installation ID (device evidence)', () => {
  it('accepts only an opaque UUID; hostnames, serials and fingerprints are discarded', () => {
    expect(normalizeDeviceId(ID_A.toUpperCase())).toBe(ID_A);
    for (const bad of ['LAPTOP-7K4M2P', 'C02XK0ABJG5H', '00:1A:2B:3C:4D:5E', `${ID_A}x`, '', null, 42]) {
      expect(normalizeDeviceId(bad)).toBeNull();
    }
  });

  it('the same browser installation keeps its ID; a different installation has another', () => {
    const a1 = buildDeviceEvidence({ deviceId: ID_A, clientHintMobile: false }, { userAgent: CHROME_WINDOWS });
    const a2 = buildDeviceEvidence({ deviceId: ID_A, clientHintMobile: false }, { userAgent: CHROME_WINDOWS });
    const b = buildDeviceEvidence({ deviceId: ID_B, clientHintMobile: false }, { userAgent: CHROME_WINDOWS });
    expect(a1.deviceId).toBe(a2.deviceId);
    expect(deviceShortCode(a1.deviceId)).toBe(deviceShortCode(a2.deviceId));
    expect(deviceShortCode(b.deviceId)).not.toBe(deviceShortCode(a1.deviceId));
  });

  it('cleared or unavailable storage gives UNKNOWN, no ID, and a DEVICE_ID_UNAVAILABLE review reason', () => {
    const e = buildDeviceEvidence({ deviceId: null, clientHintMobile: true }, { userAgent: CHROME_ANDROID, secChUaMobile: '?1' });
    expect(e.deviceId).toBeNull();
    expect(e.deviceType).toBe('UNKNOWN');
    expect(e.reviewReasons).toEqual(['DEVICE_ID_UNAVAILABLE']);
    expect(deviceLabel({ deviceType: e.deviceType, deviceId: e.deviceId, deviceMetadata: e.deviceMetadata })).toBe('Unknown device · Device ID unavailable');
  });

  it('classifies mobile from Client Hints, corroborated by the server', () => {
    const e = buildDeviceEvidence(
      { deviceId: ID_A, clientHintMobile: true, deviceTypeHint: 'MOBILE' },
      { userAgent: CHROME_ANDROID, secChUaMobile: '?1', secChUaPlatform: '"Android"' },
    );
    expect(e.deviceType).toBe('MOBILE');
    expect(e.deviceMetadata.classification).toBe('AGREED');
    expect(deviceLabel({ ...e })).toMatch(/^Mobile · Android · Chrome · DEV-[0-9A-Z]{6}$/);
  });

  it('never claims laptop versus desktop: both are LAPTOP_DESKTOP', () => {
    const e = buildDeviceEvidence({ deviceId: ID_A, deviceTypeHint: 'LAPTOP_DESKTOP' }, { userAgent: CHROME_WINDOWS, secChUaMobile: '?0' });
    expect(e.deviceType).toBe('LAPTOP_DESKTOP');
    expect(deviceLabel({ ...e })).toMatch(/^Laptop\/Desktop · Windows · Chrome · DEV-/);
  });

  it('accepts the known iPadOS desktop-mode case, and records a real conflict as UNKNOWN', () => {
    const ipad = buildDeviceEvidence({ deviceId: ID_A, deviceTypeHint: 'TABLET' }, { userAgent: SAFARI_IPAD_DESKTOP_MODE });
    expect(ipad.deviceType).toBe('TABLET');
    const conflict = buildDeviceEvidence({ deviceId: ID_A, deviceTypeHint: 'MOBILE' }, { userAgent: CHROME_WINDOWS, secChUaMobile: '?0' });
    expect(conflict.deviceType).toBe('UNKNOWN');
    expect(conflict.deviceMetadata.classification).toBe('CONFLICT');
    // A conflict is not "unavailable": the ID was supplied, so no review reason.
    expect(conflict.reviewReasons).toEqual([]);
  });

  it('stores only browser and OS family, never the raw User-Agent', () => {
    const e = buildDeviceEvidence({ deviceId: ID_A }, { userAgent: CHROME_WINDOWS });
    expect(JSON.stringify(e.deviceMetadata)).not.toContain('Mozilla');
    expect(Object.keys(e.deviceMetadata).sort()).toEqual(['browserFamily', 'classification', 'clientHintMobile', 'osFamily', 'version']);
  });

  it('historical punches read as "Device not recorded"', () => {
    expect(deviceLabel({ deviceType: null, deviceId: null })).toBe('Device not recorded');
  });
});
