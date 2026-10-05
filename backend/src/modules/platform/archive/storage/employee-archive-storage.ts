/**
 * Where a verified employee archive goes, and how we know it arrived.
 *
 * TWO METHODS, DELIBERATELY. `upload` puts the bytes somewhere; `verify` asks
 * the destination what it actually has. They are separate because an upload
 * that returned without throwing is NOT evidence the file is there and intact
 * -- that is precisely the assumption that makes an irreversible deletion
 * unsafe. Nothing is deleted until `verify` has answered about the stored
 * object rather than about the request.
 *
 * NOT A CLOUD-STORAGE FRAMEWORK. There is one implementation for production
 * and one for tests. It exists so the destructive workflow can be tested
 * without Google credentials, not to abstract over providers we do not have.
 */

export interface ArchiveUploadRequest {
  fileName: string;
  buffer: Buffer;
  /** SHA-256 of `buffer`. The canonical value, recorded in the ledger. */
  checksum: string;
  /**
   * MD5 of the same bytes.
   *
   * CARRIED ONLY BECAUSE GOOGLE DRIVE REPORTS MD5 AND NOT SHA-256. Verifying
   * content means comparing like with like, so the provider-shaped hash is
   * computed here rather than the comparison quietly being skipped -- which
   * is how "verified" comes to mean "the upload call returned".
   *
   * MD5 is weak against a deliberate collision and is not relied on for
   * anything but this: did the bytes Drive stored match the bytes we sent.
   * The ledger keeps SHA-256.
   */
  md5: string;
  /** For the provider's own metadata. Never a secret. */
  description?: string;
}

export interface UploadedArchive {
  /** The provider's identifier for the stored object. */
  fileId: string;
  fileName: string;
  /** Size the provider reports, which may differ from what we sent. */
  bytes: number | null;
  /** Folder the provider says it landed in, when it reports one. */
  folderId: string | null;
}

export interface ArchiveVerification {
  verified: boolean;
  /** Every reason it failed, not just the first -- a report should be complete. */
  problems: string[];
  /** What the provider reported, for the failure message and the ledger. */
  observed: {
    fileId: string | null;
    fileName: string | null;
    bytes: number | null;
    folderId: string | null;
    checksum: string | null;
  };
}

export interface ArchiveVerifyRequest {
  fileId: string;
  expectedFileName: string;
  expectedBytes: number;
  /** SHA-256. Kept for the ledger and for providers that can report it. */
  expectedChecksum: string;
  /** The hash THIS provider is able to report back. See ArchiveUploadRequest. */
  expectedContentHash: string;
}

export interface EmployeeArchiveStorage {
  upload(request: ArchiveUploadRequest): Promise<UploadedArchive>;
  verify(request: ArchiveVerifyRequest): Promise<ArchiveVerification>;
}

/** Injection token, so the workflow depends on the interface and not on Drive. */
export const EMPLOYEE_ARCHIVE_STORAGE = Symbol('EMPLOYEE_ARCHIVE_STORAGE');

/**
 * The checks every implementation must apply, in one place.
 *
 * SHARED SO THE FAKE AND THE REAL ADAPTER CANNOT DISAGREE. If the fake were
 * lenient where Drive is strict, the test suite would be proving the wrong
 * thing about the only code path that gates an irreversible deletion.
 */
export function compareArchive(
  expected: ArchiveVerifyRequest,
  observed: ArchiveVerification['observed'],
  options: { expectedFolderId?: string | null } = {},
): ArchiveVerification {
  const problems: string[] = [];

  if (!observed.fileId) {
    problems.push('The storage provider returned no file id for the archive.');
  } else if (observed.fileId !== expected.fileId) {
    problems.push(
      `Archive id mismatch: expected ${expected.fileId}, found ${observed.fileId}.`,
    );
  }

  if (observed.fileName !== expected.expectedFileName) {
    problems.push(
      `Archive name mismatch: expected ${expected.expectedFileName}, found ${observed.fileName ?? 'nothing'}.`,
    );
  }

  // A size that cannot be read is NOT a pass. Unknown is treated as failure
  // throughout: the point of verification is positive evidence, and "the
  // provider did not say" is the absence of it.
  if (observed.bytes === null) {
    problems.push('The storage provider did not report the archive size.');
  } else if (observed.bytes !== expected.expectedBytes) {
    problems.push(
      `Archive size mismatch: expected ${expected.expectedBytes} bytes, found ${observed.bytes}.`,
    );
  }

  // The strongest check, and the only one that proves the CONTENT arrived
  // rather than merely a file of the right length. Compared against the
  // provider-shaped hash, because comparing a SHA-256 to Drive's MD5 would
  // fail every time and the obvious "fix" is to stop comparing at all.
  if (observed.checksum === null) {
    problems.push('The storage provider did not report a content checksum.');
  } else if (observed.checksum.toLowerCase() !== expected.expectedContentHash.toLowerCase()) {
    problems.push('Archive checksum mismatch: the stored file is not the one we built.');
  }

  if (options.expectedFolderId) {
    if (observed.folderId !== options.expectedFolderId) {
      problems.push(
        `Archive is not in the configured folder: expected ${options.expectedFolderId}, found ${observed.folderId ?? 'nothing'}.`,
      );
    }
  }

  return { verified: problems.length === 0, problems, observed };
}
