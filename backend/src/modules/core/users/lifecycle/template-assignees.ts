/**
 * Quick ticket templates keep assignees as a scalar id array (no FK), so the
 * dependency matrix cannot clear them with a column handler. Permanent Delete
 * calls this once, after the handlers, inside its transaction (spec §8.2).
 *
 * One statement, the subject's id only, array order kept. Rows that never
 * named the person are not touched, so their updatedAt stays as it was.
 */
export interface RawExecutor {
  $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<number>;
}

export async function removeTemplateAssignee(tx: RawExecutor, userId: string): Promise<number> {
  return tx.$executeRaw`UPDATE "quick_ticket_templates" SET "assigneeIds" = array_remove("assigneeIds", ${userId}) WHERE ${userId} = ANY("assigneeIds")`;
}
