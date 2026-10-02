import { createHash } from 'crypto';
import {
  compareArchive,
  type ArchiveUploadRequest,
  type ArchiveVerification,
  type ArchiveVerifyRequest,
  type EmployeeArchiveStorage,
  type UploadedArchive,
} from '../../src/modules/platform/archive/storage/employee-archive-storage';

/**
 * A storage that behaves like Drive, without Drive.
 *
 * STORES THE BYTES AND ANSWERS FROM THEM. It would be easier to return
 * whatever the caller claimed and say "verified", but then the test suite
 * would be proving that the workflow can read back its own assumptions. This
 * keeps what it was given and reports on THAT, so a size or content mismatch
 * is detected the same way Drive would detect it.
 *
 * IT SHARES compareArchive WITH THE REAL ADAPTER, deliberately. A fake that
 * was more lenient than production would make every fail-closed test a lie
 * about the only path gating an irreversible deletion.
 */
export class FakeEmployeeArchiveStorage implements EmployeeArchiveStorage {
  readonly uploads: ArchiveUploadRequest[] = [];
  readonly verifications: ArchiveVerifyRequest[] = [];

  private stored = new Map<string, { name: string; buffer: Buffer; folderId: string }>();
  private nextId = 1;

  constructor(
    private readonly behaviour: {
      /** Reject the upload itself. */
      failUpload?: Error;
      /** Reject the verification read. */
      failVerify?: Error;
      /** Report a size other than what was stored. */
      reportBytes?: number;
      /** Report a content hash other than the stored one. */
      reportChecksum?: string;
      /** Report a different name. */
      reportFileName?: string;
      /** Report a different folder. */
      reportFolderId?: string;
      /** Pretend nothing is there. */
      missing?: boolean;
      folderId?: string;
    } = {},
  ) {}

  async upload(request: ArchiveUploadRequest): Promise<UploadedArchive> {
    this.uploads.push(request);
    if (this.behaviour.failUpload) throw this.behaviour.failUpload;

    const fileId = `fake-drive-${this.nextId++}`;
    const folderId = this.behaviour.folderId ?? 'fake-folder';
    this.stored.set(fileId, { name: request.fileName, buffer: request.buffer, folderId });

    return {
      fileId,
      fileName: request.fileName,
      bytes: request.buffer.length,
      folderId,
    };
  }

  async verify(request: ArchiveVerifyRequest): Promise<ArchiveVerification> {
    this.verifications.push(request);
    if (this.behaviour.failVerify) {
      return {
        verified: false,
        problems: [`Could not read the archive back: ${this.behaviour.failVerify.message}`],
        observed: { fileId: null, fileName: null, bytes: null, folderId: null, checksum: null },
      };
    }

    const found = this.behaviour.missing ? undefined : this.stored.get(request.fileId);
    if (!found) {
      return {
        verified: false,
        problems: ['The archive is not present in storage.'],
        observed: { fileId: null, fileName: null, bytes: null, folderId: null, checksum: null },
      };
    }

    const observed = {
      fileId: request.fileId,
      fileName: this.behaviour.reportFileName ?? found.name,
      bytes: this.behaviour.reportBytes ?? found.buffer.length,
      folderId: this.behaviour.reportFolderId ?? found.folderId,
      // MD5, exactly as Drive reports it, computed from the bytes actually held.
      checksum:
        this.behaviour.reportChecksum ??
        createHash('md5').update(found.buffer).digest('hex'),
    };

    return compareArchive(request, observed);
  }

  /** What the fake is actually holding, for a test that wants to look. */
  storedBuffer(fileId: string): Buffer | undefined {
    return this.stored.get(fileId)?.buffer;
  }
}
