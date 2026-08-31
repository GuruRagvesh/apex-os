import { classifyKey, planRetention } from '../../scripts/backup/backup-retention';
import { archiveObjectKey } from '../../scripts/backup/photo-archive';
import { runSweep } from '../../scripts/backup/run-retention-sweep';
import type { Vault, VaultObjectSummary } from '../../src/modules/platform/backup-vault/r2-vault';

// The archive writes `attendance-photos/YYYY/MM/<photoId>`. Retention used to
// recognise only `^photos/`, a shape nothing has ever written, so every real
// photograph classified as "unrecognised" and survived on the fallback alone.
//
// The outcome was KEEP either way, which is why nothing caught it: attendance
// evidence was protected by an accident rather than by the rule meant to
// protect it. Tighten the fallback to DELETE some day -- an obvious-looking
// "clean up junk objects" change -- and every punch photograph goes with it.

const NOW = new Date('2026-08-27T00:00:00Z');
const ANCIENT = '2024-01-01T00:00:00Z'; // ~2.5 years old: past every window

const obj = (key: string, createdAt = ANCIENT): VaultObjectSummary => ({
  key,
  byteSize: 50_000,
  lastModified: createdAt,
});

const plan = (keys: VaultObjectSummary[]) =>
  planRetention(
    keys.map((o) => ({ key: o.key, type: null, createdAt: o.lastModified, byteSize: o.byteSize })),
    NOW,
  );

describe('real archive keys classify as photo evidence', () => {
  it('classifies attendance-photos/2026/08/photo123', () => {
    expect(classifyKey('attendance-photos/2026/08/photo123')).toBe('PHOTO_ARCHIVE');
  });

  it('classifies attendance-photos/2025/01/oldPhoto', () => {
    expect(classifyKey('attendance-photos/2025/01/oldPhoto')).toBe('PHOTO_ARCHIVE');
  });

  it('classifies whatever archiveObjectKey actually produces', () => {
    // Bound to the producer rather than to a literal, so changing the key
    // shape without changing retention fails here instead of in production.
    const key = archiveObjectKey({ id: 'clx123abc', receivedAt: new Date('2026-08-14T09:30:00Z') });

    expect(key).toBe('attendance-photos/2026/08/clx123abc');
    expect(classifyKey(key)).toBe('PHOTO_ARCHIVE');
  });

  it('still recognises the legacy photos/ shape', () => {
    expect(classifyKey('photos/2026/01/legacy')).toBe('PHOTO_ARCHIVE');
  });

  it('does not classify photo evidence by the fallback', () => {
    // The point of the fix: the reason evidence survives must be the rule,
    // not the absence of one.
    expect(classifyKey('attendance-photos/2026/08/photo123')).not.toBeNull();
  });
});

describe('photo evidence is protected from deletion', () => {
  it('keeps a photo far older than every retention window', () => {
    const [decision] = plan([obj('attendance-photos/2024/01/ancientPhoto')]);

    expect(decision.action).toBe('KEEP');
    expect(decision.reason).toMatch(/evidence/i);
    expect(decision.ageDays).toBeGreaterThan(365);
  });

  it('keeps legacy-shaped photo evidence too', () => {
    const [decision] = plan([obj('photos/2024/01/ancientLegacy')]);

    expect(decision.action).toBe('KEEP');
    expect(decision.reason).toMatch(/evidence/i);
  });

  it('protects photos for the stated reason, not for being unclassifiable', () => {
    const [decision] = plan([obj('attendance-photos/2024/01/ancientPhoto')]);

    expect(decision.reason).not.toMatch(/unrecognised/i);
  });

  it('still expires an old daily dump, so the sweep has not simply stopped', () => {
    // A protection test that passes because nothing is ever deleted proves
    // nothing.
    const [decision] = plan([obj('database/daily/2024/01/ancient.dump')]);

    expect(decision.action).toBe('DELETE');
  });
});

describe('unrecognised objects remain fail-safe', () => {
  it('keeps an object it cannot classify', () => {
    const [decision] = plan([obj('something/nobody/planned-for')]);

    expect(decision.action).toBe('KEEP');
    expect(decision.reason).toMatch(/does not delete what it cannot classify/i);
  });

  it('keeps an object with an unreadable date', () => {
    const [decision] = plan([obj('attendance-photos/2026/08/p', 'not-a-date')]);

    expect(decision.action).toBe('KEEP');
  });
});

describe('retention --apply never deletes photo evidence', () => {
  // planRetention is pure; this exercises the runner that actually calls
  // vault.remove(), which is the layer that can destroy something.
  const vaultOver = (keys: VaultObjectSummary[]) => {
    const removed: string[] = [];
    const present = new Set(keys.map((k) => k.key));

    const vault: Vault = {
      async list() {
        return keys;
      },
      async remove(key) {
        removed.push(key);
        present.delete(key);
      },
      async put(key) {
        present.add(key);
      },
      async head(key) {
        return present.has(key) ? { key, byteSize: 1 } : null;
      },
      async getToFile() {},
    };
    return { vault, removed };
  };

  it('deletes the expired dump and leaves every photograph', async () => {
    const keys = [
      obj('attendance-photos/2024/01/photoA'),
      obj('attendance-photos/2025/06/photoB'),
      obj('photos/2024/01/legacyPhoto'),
      obj('database/daily/2024/01/expired.dump'),
      obj('database/daily/2026/08/fresh.dump', '2026-08-26T00:00:00Z'),
    ];
    const { vault, removed } = vaultOver(keys);

    const report = await runSweep({ vault, now: () => NOW }, true);

    // The sweep also creates and removes its own delete-permission probe,
    // which is not a vault object under retention.
    const realDeletes = removed.filter((k) => !k.startsWith('probes/'));

    expect(realDeletes).toEqual(['database/daily/2024/01/expired.dump']);
    expect(realDeletes.some((k) => k.includes('photo'))).toBe(false);
    expect(report.deleted).toBe(1);
    expect(report.deletePermissionProven).toBe(true);
    expect(report.failures).toEqual([]);
  });

  it('deletes nothing at all when the vault holds only photographs', async () => {
    const keys = [
      obj('attendance-photos/2024/01/photoA'),
      obj('attendance-photos/2024/02/photoB'),
    ];
    const { vault, removed } = vaultOver(keys);

    const report = await runSweep({ vault, now: () => NOW }, true);

    expect(removed).toEqual([]);
    expect(report.deleteCandidates).toBe(0);
    // No candidates means the delete-permission probe never needed to run.
    expect(report.deletePermissionProven).toBe(false);
  });

  it('a dry run deletes nothing even when a dump has expired', async () => {
    const keys = [
      obj('attendance-photos/2024/01/photoA'),
      obj('database/daily/2024/01/expired.dump'),
    ];
    const { vault, removed } = vaultOver(keys);

    const report = await runSweep({ vault, now: () => NOW }, false);

    expect(removed).toEqual([]);
    expect(report.deleteCandidates).toBe(1);
    expect(report.applied).toBe(false);
  });
});
