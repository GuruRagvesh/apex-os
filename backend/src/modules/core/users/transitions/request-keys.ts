import type { Prisma } from '@prisma/client';
import { badRequest, conflict, TRANSITION_CODE } from './transitions-codes';

/**
 * The idempotency ledger for exit and transfer mutations.
 *
 * Every mutation that a client retry could duplicate carries a UUID v4 key,
 * generated once per form submit and reused on retry. The key is written in the
 * SAME transaction as the mutation, so it exists exactly when the mutation
 * committed: a replay finds it and gets the entity's current state back, and a
 * concurrent duplicate hits the primary key and is answered the same way.
 */

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requireIdempotencyKey(value: unknown): string {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!UUID_V4.test(key)) {
    badRequest(TRANSITION_CODE.IDEMPOTENCY_KEY_REQUIRED, 'This request needs a fresh idempotency key (UUID v4). Reload the form and try again.');
  }
  return key;
}

export interface KeyRecord {
  key: string;
  scope: string;
  entityId: string;
  actorId: string;
}

/** The committed key, if any. A key reused for a different scope is refused. */
export async function findKey(db: any, key: string, scope: string): Promise<KeyRecord | null> {
  const row = await db.transitionRequestKey.findUnique({ where: { key } });
  if (!row) return null;
  if (row.scope !== scope) {
    conflict(TRANSITION_CODE.IDEMPOTENCY_KEY_REUSED, 'This idempotency key was already used for a different action. Reload the form and try again.');
  }
  return row;
}

/** Records the key inside the mutation's transaction. */
export async function claimKey(tx: Prisma.TransactionClient | any, rec: KeyRecord): Promise<void> {
  await tx.transitionRequestKey.create({ data: rec });
}

export function isUniqueViolation(err: any): boolean {
  return err?.code === 'P2002' || /unique constraint|duplicate key/i.test(String(err?.message ?? ''));
}
