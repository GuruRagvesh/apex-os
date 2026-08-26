import { readFileSync } from 'fs';
import { resolve } from 'path';
import { toOwnEvidenceView } from '../../src/modules/platform/attendance/punch/punch-evidence.service';

// An employee may now inspect the location evidence behind their OWN punches --
// a deliberate revision of the earlier employee-view assumption, because a
// disputed punch is unarguable from the employee's side without it.
//
// listMine previously returned the whole row, which also handed over the photo
// storage key, the photo hash, the IP address and the device metadata. The
// storage key is the one that matters: a punch photo is reachable only through
// a short-lived signed URL scoped to its owner, and the key routes around that.

const SOURCE = readFileSync(
  resolve(__dirname, '../../src/modules/platform/attendance/punch/punch-evidence.service.ts'),
  'utf8',
);

const row = (over: Partial<any> = {}): any => ({
  id: 'ev-1',
  userId: 'emp-1',
  type: 'PUNCH_IN',
  businessDate: new Date('2026-08-26T00:00:00.000Z'),
  serverOccurredAt: new Date('2026-08-26T04:05:00.000Z'),
  clientCapturedAt: new Date('2026-08-26T04:04:58.000Z'),
  receivedAt: new Date('2026-08-26T04:05:01.000Z'),
  latitude: 18.52043,
  longitude: 73.856744,
  accuracyMeters: 18,
  distanceFromLocationMeters: 57,
  geofenceRadiusMeters: 150,
  accuracyThresholdMeters: 100,
  locationVerification: 'VERIFIED',
  attendanceLocationId: 'loc-1',
  attendanceLocation: { name: 'Technols Main Office' },
  photoAssetId: 'asset-1',
  photoObjectKey: 'cloudinary:authenticated:image:apex%2Fattendance%2Fpunch%2Femp-1%2Fabc:jpg',
  photoHash: 'a'.repeat(64),
  photoVerification: 'CAPTURED',
  source: 'WEB',
  deviceMetadata: { ua: 'Mozilla/5.0', platform: 'Win32' },
  ipAddress: '203.0.113.44',
  workSessionId: 'ws-1',
  employeeProfileId: 'prof-1',
  shiftPolicyId: 'shift-1',
  shiftPolicyVersion: 1,
  ...over,
});

describe('own punch evidence view', () => {
  it('gives the employee the location facts behind their own punch', () => {
    const v: any = toOwnEvidenceView(row());

    expect(v.latitude).toBe(18.52043);
    expect(v.longitude).toBe(73.856744);
    expect(v.accuracyMeters).toBe(18);
    expect(v.distanceFromLocationMeters).toBe(57);
    expect(v.geofenceRadiusMeters).toBe(150);
    expect(v.locationVerification).toBe('VERIFIED');
    expect(v.locationName).toBe('Technols Main Office');
  });

  it('keeps accuracy and distance as separate values', () => {
    // ±111m accuracy does not mean 111m from the office. Collapsing the two
    // is the specific misreading this shape exists to prevent, so both must
    // survive independently.
    const v: any = toOwnEvidenceView(
      row({ accuracyMeters: 111, distanceFromLocationMeters: 95 }),
    );

    expect(v.accuracyMeters).toBe(111);
    expect(v.distanceFromLocationMeters).toBe(95);
    expect(v.accuracyMeters).not.toBe(v.distanceFromLocationMeters);
  });

  it('never returns the photo storage key or hash', () => {
    const v: any = toOwnEvidenceView(row());

    expect(v.photoObjectKey).toBeUndefined();
    expect(v.photoHash).toBeUndefined();
    // The asset id addresses the signed-URL route; it is not the photo.
    expect(v.photoAssetId).toBe('asset-1');

    const serialized = JSON.stringify(v);
    expect(serialized).not.toContain('cloudinary');
    expect(serialized).not.toContain('a'.repeat(64));
  });

  it('never returns the IP address or device metadata', () => {
    const v: any = toOwnEvidenceView(row());

    expect(v.ipAddress).toBeUndefined();
    expect(v.deviceMetadata).toBeUndefined();
    expect(JSON.stringify(v)).not.toContain('203.0.113.44');
    expect(JSON.stringify(v)).not.toContain('Mozilla');
  });

  it('exposes exactly the agreed field set, and nothing added by accident', () => {
    // A new column on the model must not reach the employee just because it
    // was added; this fails until somebody decides about it deliberately.
    expect(Object.keys(toOwnEvidenceView(row())).sort()).toEqual(
      [
        'accuracyMeters',
        'accuracyThresholdMeters',
        'businessDate',
        'clientCapturedAt',
        'distanceFromLocationMeters',
        'geofenceRadiusMeters',
        'id',
        'latitude',
        'locationName',
        'locationVerification',
        'longitude',
        'photoAssetId',
        'photoVerification',
        'serverOccurredAt',
        'source',
        'type',
        'workSessionId',
      ].sort(),
    );
  });

  it('carries a missing location through as null rather than inventing one', () => {
    const v: any = toOwnEvidenceView(
      row({
        attendanceLocation: null,
        attendanceLocationId: null,
        distanceFromLocationMeters: null,
        locationVerification: 'NOT_ENFORCED',
      }),
    );

    expect(v.locationName).toBeNull();
    expect(v.distanceFromLocationMeters).toBeNull();
    // NOT_ENFORCED must not be presented as VERIFIED: geofencing being off is
    // not evidence the employee was inside an approved location.
    expect(v.locationVerification).toBe('NOT_ENFORCED');
  });

  it('preserves a low-accuracy verdict instead of upgrading it', () => {
    const v: any = toOwnEvidenceView(
      row({ accuracyMeters: 111, locationVerification: 'LOW_ACCURACY' }),
    );

    expect(v.locationVerification).toBe('LOW_ACCURACY');
    expect(v.locationVerification).not.toBe('VERIFIED');
  });
});

describe('own evidence authorization', () => {
  it('scopes the query by the authenticated user, not by a supplied id', () => {
    // Opaque ids are not authorization. The row filter is what stops employee
    // A reading employee B's evidence.
    const listMine = /async listMine\(userId: string[\s\S]*?\n  \}/.exec(SOURCE)![0];

    expect(listMine).toMatch(/where: \{ userId \}/);
    expect(listMine).not.toMatch(/where: \{\s*id\b/);
  });

  it('reads the persisted coordinate rather than recomputing it', () => {
    // A recomputed coordinate would answer where the employee is now, not
    // where they punched.
    const view = /export function toOwnEvidenceView[\s\S]*?\n\}/.exec(SOURCE)![0];

    expect(view).toMatch(/latitude: row\.latitude/);
    expect(view).toMatch(/longitude: row\.longitude/);
    expect(view).not.toMatch(/geolocation|navigator|Date\.now\(\)/);
  });
});
