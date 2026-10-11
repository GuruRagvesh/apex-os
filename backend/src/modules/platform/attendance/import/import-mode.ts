import { BadRequestException, ForbiddenException } from '@nestjs/common';

/**
 * Every decision the existing import pipeline makes from a batch's mode, made
 * EXHAUSTIVELY in one place.
 *
 * Before RECOVERY_IMPORT existed, `mode === 'HISTORICAL_MIGRATION' ? … : …`
 * was a complete answer. With a third mode it becomes a fall-through: a recovery
 * batch would have been approved and applied as an ordinary HR correction,
 * writing BULK_IMPORT regularizations that revise existing days -- the opposite
 * of the recovery rule (insert-missing-only, never overwrite).
 *
 * So:
 *   CURRENT_CORRECTION    → existing behaviour, unchanged
 *   HISTORICAL_MIGRATION  → existing behaviour, unchanged
 *   RECOVERY_IMPORT       → refused, FAIL-CLOSED, with an explicit code
 *   anything else         → refused (a value nobody classified is never let through)
 *
 * Recovery imports get their own apply path in a later, separately approved
 * phase; until then nothing in this pipeline may act on one.
 */

export type CorrectionImportMode = 'CURRENT_CORRECTION' | 'HISTORICAL_MIGRATION';

export const RECOVERY_IMPORT_APPLY_NOT_ENABLED = 'RECOVERY_IMPORT_APPLY_NOT_ENABLED';
export const RECOVERY_IMPORT_UPLOAD_NOT_ENABLED = 'RECOVERY_IMPORT_UPLOAD_NOT_ENABLED';
export const UNKNOWN_IMPORT_MODE = 'UNKNOWN_IMPORT_MODE';

/** The batch action being attempted, for the refusal message. */
export type ImportAction = 'approve' | 'apply' | 'resume' | 're-preview' | 'apply row';

/**
 * Narrows a stored mode to one the correction pipeline may act on, or throws.
 * Call at every entry point that moves a batch forward.
 */
export function assertCorrectionImportMode(mode: string, action: ImportAction): CorrectionImportMode {
  switch (mode) {
    case 'CURRENT_CORRECTION':
    case 'HISTORICAL_MIGRATION':
      return mode;
    case 'RECOVERY_IMPORT':
      throw new ForbiddenException({
        code: RECOVERY_IMPORT_APPLY_NOT_ENABLED,
        message: `Historical recovery imports cannot ${action === 'apply row' ? 'be applied' : `be ${action === 're-preview' ? 're-previewed' : `${action}d`}`} yet. Recovery apply is not enabled.`,
      });
    default:
      throw new ForbiddenException({
        code: UNKNOWN_IMPORT_MODE,
        message: 'This import batch has a mode the import pipeline does not handle, so it was refused.',
      });
  }
}

/** The regularization entrySource a correction batch writes. Exhaustive; recovery never reaches it. */
export function correctionEntrySource(mode: string): 'HISTORICAL_IMPORT' | 'BULK_IMPORT' {
  const m = assertCorrectionImportMode(mode, 'apply row');
  switch (m) {
    case 'HISTORICAL_MIGRATION':
      return 'HISTORICAL_IMPORT';
    case 'CURRENT_CORRECTION':
      return 'BULK_IMPORT';
  }
}

/**
 * The upload `mode` query parameter. Recovery uploads are refused until the
 * dedicated Attendance Recovery Vault exists: the existing pipeline archives
 * every upload into the database-backup vault, and recovery files must never
 * be stored there.
 */
export function parseUploadMode(mode: string | undefined): CorrectionImportMode {
  if (mode === 'CURRENT_CORRECTION' || mode === 'HISTORICAL_MIGRATION') return mode;
  if (mode === 'RECOVERY_IMPORT') {
    throw new ForbiddenException({
      code: RECOVERY_IMPORT_UPLOAD_NOT_ENABLED,
      message: 'Historical recovery uploads will become available after the Attendance Recovery Vault is configured.',
    });
  }
  throw new BadRequestException(
    'Choose a mode: CURRENT_CORRECTION for recent days, HISTORICAL_MIGRATION for a period predating Apex OS.',
  );
}
