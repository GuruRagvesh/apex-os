/**
 * Provider handles for post-deletion cleanup.
 *
 * A handle (a Cloudinary public id, a storage key) can embed a person's name,
 * so PostgreSQL never stores one in the clear: it is AES-256-GCM encrypted
 * while cleanup is pending and erased once done, and a keyed HMAC-SHA-256
 * remains for de-duplication and correlation. An unkeyed hash of a guessable
 * identifier would be reversible by guessing, so none is used.
 *
 * Keys: LIFECYCLE_HANDLE_ENCRYPTION_KEY and LIFECYCLE_HANDLE_HMAC_KEY, each 32
 * random bytes in base64. Permanent deletion refuses without both; archive
 * does not need them.
 */

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';

export interface HandleKeys {
  encryptionKey: Buffer;
  hmacKey: Buffer;
}

const KEY_ID = 'k1';

function decodeKey(value: string | undefined): Buffer | null {
  if (!value || !value.trim()) return null;
  const buf = Buffer.from(value.trim(), 'base64');
  return buf.length === 32 ? buf : null;
}

/** The two keys, or null when either is missing or not 32 bytes. Never logs a key. */
export function readHandleKeys(env: NodeJS.ProcessEnv): HandleKeys | null {
  const encryptionKey = decodeKey(env.LIFECYCLE_HANDLE_ENCRYPTION_KEY);
  const hmacKey = decodeKey(env.LIFECYCLE_HANDLE_HMAC_KEY);
  if (!encryptionKey || !hmacKey) return null;
  return { encryptionKey, hmacKey };
}

export function handleHmac(keys: HandleKeys, provider: string, handle: string): string {
  return createHmac('sha256', keys.hmacKey).update(`${provider}:${handle}`).digest('hex');
}

/** `k1.<iv>.<tag>.<ciphertext>`, all base64url. */
export function encryptHandle(keys: HandleKeys, handle: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keys.encryptionKey, iv);
  const ct = Buffer.concat([cipher.update(handle, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [KEY_ID, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

export function decryptHandle(keys: HandleKeys, sealed: string): string {
  const [kid, iv, tag, ct] = sealed.split('.');
  if (kid !== KEY_ID || !iv || !tag || !ct) throw new Error('HANDLE_UNREADABLE');
  const decipher = createDecipheriv('aes-256-gcm', keys.encryptionKey, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}
