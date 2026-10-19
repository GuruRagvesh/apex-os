import type { RawExecutor } from './template-assignees';

/**
 * Meetings keep their eligible approvers as a scalar id array (no FK), so the
 * dependency matrix cannot clear them with a column handler. Permanent Delete
 * calls this once, after the handlers, inside its transaction.
 *
 * One statement, the subject's id only. Meetings that never named the person
 * are not touched.
 */
export async function removeMeetingApprover(tx: RawExecutor, userId: string): Promise<number> {
  return tx.$executeRaw`UPDATE "meetings" SET "approverIds" = array_remove("approverIds", ${userId}) WHERE ${userId} = ANY("approverIds")`;
}
