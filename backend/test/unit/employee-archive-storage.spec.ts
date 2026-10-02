/**
 * VERIFICATION IS THE LAST THING BEFORE AN IRREVERSIBLE DELETION.
 *
 * Every test here is really one question: can "verified" ever come back true
 * when the archive is not actually sitting in Drive, intact? Each case below
 * is a way that could happen -- a failed upload, a truncated file, a swapped
 * one, a trashed one, a provider that answers nothing -- and each must fail
 * closed, because the next thing the workflow does is delete somebody.
 */
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { packEmployeeArchive, archiveFileName } from '../../src/modules/platform/archive/employee-archive-zip';
import { compareArchive } from '../../src/modules/platform/archive/storage/employee-archive-storage';
import { GoogleDriveEmployeeArchiveStorage } from '../../src/modules/platform/archive/storage/google-drive-archive-storage';
import { FakeEmployeeArchiveStorage } from '../helpers/fake-archive-storage';
import type { EmployeeArchive } from '../../src/modules/platform/archive/employee-archive.types';

const ARCHIVE: EmployeeArchive = {
  manifest: {
    archiveVersion: '1.0',
    generatedAt: '2026-10-03T06:00:00.000Z',
    environment: 'test',
    applicationVersion: 'abc1234',
    formerUserId: 'u-1',
    employeeId: 'TE-014',
    displayName: 'Rahul Verma',
    archivedByUserId: 'admin-1',
    archivedByDisplayName: 'Priya',
    datasets: ['attendance/daily'],
    entityCounts: { 'attendance/daily': 1 },
    excludedSecretCategories: ['passwordHash'],
  },
  employee: { id: 'u-1', name: 'Rahul Verma' } as any,
  datasets: { 'attendance/daily': [{ id: 'd1' }] },
  relationships: [
    { model: 'DailyAttendance', field: 'user', action: 'DELETE_WITH_USER', rows: 1, why: 'personal' },
  ],
};

async function packed() {
  return packEmployeeArchive(ARCHIVE);
}

function verifyRequest(fileId: string, p: Awaited<ReturnType<typeof packed>>) {
  return {
    fileId,
    expectedFileName: archiveFileName(ARCHIVE),
    expectedBytes: p.bytes,
    expectedChecksum: p.checksum,
    expectedContentHash: p.md5,
  };
}

// ════════════════════════════════════════════════════════════════════════════
describe('the archive ZIP', () => {
  it('contains the manifest, the profile and every dataset', async () => {
    const p = await packed();

    expect(p.entries).toEqual(
      expect.arrayContaining([
        'manifest.json',
        'employee/profile.json',
        'relationships/summary.json',
        'attendance/daily.json',
      ]),
    );
  });

  it('IS BYTE-IDENTICAL FOR THE SAME ARCHIVE', async () => {
    // The checksum gates a deletion. If the bytes moved between two runs over
    // identical content -- because entry dates came from the clock, or key
    // order varied -- the comparison would mean nothing and a failure would
    // be impossible to reproduce.
    const first = await packed();
    const second = await packed();

    expect(first.checksum).toBe(second.checksum);
    expect(first.bytes).toBe(second.bytes);
  });

  it('changes its checksum when the content changes', async () => {
    // Without this, determinism above could be satisfied by a constant.
    const other = await packEmployeeArchive({
      ...ARCHIVE,
      datasets: { 'attendance/daily': [{ id: 'CHANGED' }] },
    });
    const base = await packed();

    expect(other.checksum).not.toBe(base.checksum);
  });

  it('names the file by employee id and timestamp, never by name alone', async () => {
    // Two people called Priya Sharma must not shadow each other in the folder.
    expect(archiveFileName(ARCHIVE)).toBe(
      'APEX_EMPLOYEE_ARCHIVE_TE-014_20261003-060000.zip',
    );
  });

  it('falls back to the user id when there is no employee id', async () => {
    const name = archiveFileName({
      ...ARCHIVE,
      manifest: { ...ARCHIVE.manifest, employeeId: null },
    });
    expect(name).toContain('u-1');
  });

  it('carries both a SHA-256 and the provider-shaped MD5', async () => {
    const p = await packed();

    expect(p.checksum).toBe(createHash('sha256').update(p.buffer).digest('hex'));
    expect(p.md5).toBe(createHash('md5').update(p.buffer).digest('hex'));
    expect(p.checksum).not.toBe(p.md5);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('upload and verification, through the fake', () => {
  it('ACCEPTS AN ARCHIVE THAT ACTUALLY ARRIVED', async () => {
    // The positive case. Without it every fail-closed test below could pass
    // against a storage that simply refuses everything.
    const storage = new FakeEmployeeArchiveStorage();
    const p = await packed();

    const uploaded = await storage.upload({
      fileName: archiveFileName(ARCHIVE),
      buffer: p.buffer,
      checksum: p.checksum,
      md5: p.md5,
    });
    const verdict = await storage.verify(verifyRequest(uploaded.fileId, p));

    expect(uploaded.fileId).toBeTruthy();
    expect(verdict.verified).toBe(true);
    expect(verdict.problems).toEqual([]);
  });

  it('stores the real bytes, so verification is about the file and not the claim', async () => {
    const storage = new FakeEmployeeArchiveStorage();
    const p = await packed();

    const uploaded = await storage.upload({
      fileName: archiveFileName(ARCHIVE), buffer: p.buffer, checksum: p.checksum, md5: p.md5,
    });

    expect(storage.storedBuffer(uploaded.fileId)!.equals(p.buffer)).toBe(true);
  });

  it('FAILS CLOSED when the upload itself throws', async () => {
    const storage = new FakeEmployeeArchiveStorage({ failUpload: new Error('drive down') });
    const p = await packed();

    await expect(
      storage.upload({ fileName: 'x.zip', buffer: p.buffer, checksum: p.checksum, md5: p.md5 }),
    ).rejects.toThrow('drive down');
  });

  it('FAILS CLOSED when the file cannot be read back', async () => {
    const storage = new FakeEmployeeArchiveStorage({ failVerify: new Error('permission denied') });
    const p = await packed();

    const verdict = await storage.verify(verifyRequest('fake-drive-1', p));

    expect(verdict.verified).toBe(false);
    expect(verdict.problems.join(' ')).toMatch(/could not read/i);
  });

  it('FAILS CLOSED when nothing is there', async () => {
    const storage = new FakeEmployeeArchiveStorage({ missing: true });
    const p = await packed();
    const uploaded = await storage.upload({
      fileName: archiveFileName(ARCHIVE), buffer: p.buffer, checksum: p.checksum, md5: p.md5,
    });

    const verdict = await storage.verify(verifyRequest(uploaded.fileId, p));

    expect(verdict.verified).toBe(false);
  });

  it('FAILS CLOSED on a size mismatch', async () => {
    // A truncated upload is the classic silent failure: the call returns, the
    // file exists, and it is half an archive.
    const storage = new FakeEmployeeArchiveStorage({ reportBytes: 12 });
    const p = await packed();
    const uploaded = await storage.upload({
      fileName: archiveFileName(ARCHIVE), buffer: p.buffer, checksum: p.checksum, md5: p.md5,
    });

    const verdict = await storage.verify(verifyRequest(uploaded.fileId, p));

    expect(verdict.verified).toBe(false);
    expect(verdict.problems.join(' ')).toMatch(/size mismatch/i);
  });

  it('FAILS CLOSED on a content mismatch, even at the right size', async () => {
    // The case size alone cannot catch: the right number of wrong bytes.
    const storage = new FakeEmployeeArchiveStorage({
      reportChecksum: 'ffffffffffffffffffffffffffffffff',
    });
    const p = await packed();
    const uploaded = await storage.upload({
      fileName: archiveFileName(ARCHIVE), buffer: p.buffer, checksum: p.checksum, md5: p.md5,
    });

    const verdict = await storage.verify(verifyRequest(uploaded.fileId, p));

    expect(verdict.verified).toBe(false);
    expect(verdict.problems.join(' ')).toMatch(/checksum mismatch/i);
  });

  it('FAILS CLOSED on the wrong filename', async () => {
    const storage = new FakeEmployeeArchiveStorage({ reportFileName: 'something-else.zip' });
    const p = await packed();
    const uploaded = await storage.upload({
      fileName: archiveFileName(ARCHIVE), buffer: p.buffer, checksum: p.checksum, md5: p.md5,
    });

    const verdict = await storage.verify(verifyRequest(uploaded.fileId, p));

    expect(verdict.verified).toBe(false);
    expect(verdict.problems.join(' ')).toMatch(/name mismatch/i);
  });

  it('reports EVERY problem, not only the first', async () => {
    // A failure report that stops at the first fault sends somebody round the
    // loop once per fault.
    const storage = new FakeEmployeeArchiveStorage({
      reportBytes: 1, reportChecksum: 'aa', reportFileName: 'wrong.zip',
    });
    const p = await packed();
    const uploaded = await storage.upload({
      fileName: archiveFileName(ARCHIVE), buffer: p.buffer, checksum: p.checksum, md5: p.md5,
    });

    const verdict = await storage.verify(verifyRequest(uploaded.fileId, p));

    expect(verdict.problems.length).toBeGreaterThanOrEqual(3);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('the shared comparison treats unknown as failure', () => {
  const expected = {
    fileId: 'f1',
    expectedFileName: 'a.zip',
    expectedBytes: 100,
    expectedChecksum: 'sha',
    expectedContentHash: 'md5v',
  };

  it('refuses when the provider reports no size', () => {
    const verdict = compareArchive(expected, {
      fileId: 'f1', fileName: 'a.zip', bytes: null, folderId: null, checksum: 'md5v',
    });

    // "The provider did not say" is the ABSENCE of evidence, and verification
    // exists to produce positive evidence.
    expect(verdict.verified).toBe(false);
  });

  it('refuses when the provider reports no checksum', () => {
    const verdict = compareArchive(expected, {
      fileId: 'f1', fileName: 'a.zip', bytes: 100, folderId: null, checksum: null,
    });

    expect(verdict.verified).toBe(false);
  });

  it('refuses when the file id comes back different', () => {
    const verdict = compareArchive(expected, {
      fileId: 'other', fileName: 'a.zip', bytes: 100, folderId: null, checksum: 'md5v',
    });

    expect(verdict.verified).toBe(false);
  });

  it('refuses when it landed in the wrong folder', () => {
    const verdict = compareArchive(
      expected,
      { fileId: 'f1', fileName: 'a.zip', bytes: 100, folderId: 'elsewhere', checksum: 'md5v' },
      { expectedFolderId: 'archive-folder' },
    );

    expect(verdict.verified).toBe(false);
    expect(verdict.problems.join(' ')).toMatch(/configured folder/i);
  });

  it('accepts when everything lines up', () => {
    const verdict = compareArchive(
      expected,
      { fileId: 'f1', fileName: 'a.zip', bytes: 100, folderId: 'archive-folder', checksum: 'MD5V' },
      { expectedFolderId: 'archive-folder' },
    );

    // Case-insensitive on the hash: providers differ on casing and that is
    // not a content difference.
    expect(verdict.verified).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('the Google Drive adapter configuration', () => {
  const adapter = (values: Record<string, string | undefined>) =>
    new GoogleDriveEmployeeArchiveStorage({
      get: (key: string) => values[key],
    } as unknown as ConfigService);

  const COMPLETE = {
    GOOGLE_DRIVE_CLIENT_EMAIL: 'svc@project.iam.gserviceaccount.com',
    GOOGLE_DRIVE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nAAAA\\n-----END PRIVATE KEY-----\\n',
    GOOGLE_DRIVE_ARCHIVE_FOLDER_ID: 'folder-123',
  };

  it('reports itself unconfigured when anything is missing', () => {
    expect(adapter({}).isConfigured()).toBe(false);
    expect(adapter({ ...COMPLETE, GOOGLE_DRIVE_PRIVATE_KEY: undefined }).isConfigured()).toBe(false);
    expect(adapter({ ...COMPLETE, GOOGLE_DRIVE_ARCHIVE_FOLDER_ID: undefined }).isConfigured()).toBe(false);
    expect(adapter(COMPLETE).isConfigured()).toBe(true);
  });

  it('NAMES THE MISSING VARIABLE AND NEVER A VALUE', () => {
    const problem = adapter({ GOOGLE_DRIVE_CLIENT_EMAIL: 'svc@x' }).configurationProblem();

    expect(problem).toContain('GOOGLE_DRIVE_PRIVATE_KEY');
    expect(problem).toContain('GOOGLE_DRIVE_ARCHIVE_FOLDER_ID');
    // The one thing a configuration error must not be is helpful about
    // secrets.
    expect(problem).not.toContain('svc@x');
    expect(problem).not.toMatch(/BEGIN PRIVATE KEY/);
  });

  it('CARRIES NO CREDENTIAL IN ITS SOURCE', () => {
    const source = require('fs').readFileSync(
      require('path').resolve(
        __dirname,
        '../../src/modules/platform/archive/storage/google-drive-archive-storage.ts',
      ),
      'utf8',
    );

    expect(source).not.toMatch(/BEGIN PRIVATE KEY/);
    expect(source).not.toMatch(/"private_key"/);
    expect(source).not.toMatch(/gserviceaccount\.com/);
    // And it never logs the key, whatever happens.
    expect(source).not.toMatch(/log\([^)]*privateKey/);
    expect(source).not.toMatch(/console\.(log|error)\([^)]*key/i);
  });

  it('asks Drive only for the scope it needs', () => {
    const source = require('fs').readFileSync(
      require('path').resolve(
        __dirname,
        '../../src/modules/platform/archive/storage/google-drive-archive-storage.ts',
      ),
      'utf8',
    );

    // drive.file limits the service account to files it created itself, so a
    // bug here cannot read or damage the rest of the Drive.
    expect(source).toContain('auth/drive.file');
    expect(source).not.toMatch(/auth\/drive['"]/);
  });
});
