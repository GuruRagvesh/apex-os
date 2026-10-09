import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { RecoveryVaultConfig } from './recovery-vault-config';

/**
 * The only object store the recovery vault talks to. It is BOUND to one
 * bucket when it is created; no method accepts a bucket name, and there is no
 * delete, no copy, no bucket operation and no way to reach the S3 client.
 *
 * `putIfAbsent` sends `If-None-Match: *`, so even two racing writers cannot
 * overwrite each other: the second receives { written: false } and must look
 * at what is there. That is the storage-level half of the immutability rule;
 * the service does the HEAD-and-compare half.
 *
 * This file is internal to the recovery module (not exported by it).
 */

export interface StoredObjectInfo {
  key: string;
  byteSize: number;
  sha256: string | null;
  contentType: string | null;
}

export interface RecoveryObjectStore {
  head(key: string): Promise<StoredObjectInfo | null>;
  get(key: string): Promise<Buffer | null>;
  list(prefix: string, maxKeys?: number): Promise<string[]>;
  /** Writes only if the key does not exist. Never overwrites. */
  putIfAbsent(key: string, body: Buffer, meta: { contentType: string; sha256: string; metadata?: Record<string, string> }): Promise<{ written: boolean }>;
}

const statusOf = (err: any) => err?.$metadata?.httpStatusCode as number | undefined;

export function createR2RecoveryStore(config: RecoveryVaultConfig): RecoveryObjectStore {
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // Recovery must never hold an attendance request hostage: short timeouts,
    // no retries. A slow vault is reported as DEGRADED, not waited on.
    maxAttempts: 1,
    requestHandler: { connectionTimeout: 3000, requestTimeout: 5000 } as any,
  });
  const Bucket = config.bucket; // fixed for the life of this store

  return Object.freeze({
    async head(key: string) {
      try {
        const r = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return {
          key,
          byteSize: Number(r.ContentLength ?? 0),
          sha256: r.Metadata?.sha256 ?? null,
          contentType: r.ContentType ?? null,
        };
      } catch (err: any) {
        if (statusOf(err) === 404 || err?.name === 'NotFound' || err?.name === 'NoSuchKey') return null;
        throw err;
      }
    },
    async get(key: string) {
      try {
        const r = await client.send(new GetObjectCommand({ Bucket, Key: key }));
        if (!r.Body) return null;
        return Buffer.from(await (r.Body as any).transformToByteArray());
      } catch (err: any) {
        if (statusOf(err) === 404 || err?.name === 'NoSuchKey') return null;
        throw err;
      }
    },
    async list(prefix: string, maxKeys = 1000) {
      const out: string[] = [];
      let token: string | undefined;
      do {
        const r = await client.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token, MaxKeys: Math.min(maxKeys, 1000) }));
        for (const o of r.Contents ?? []) if (o.Key) out.push(o.Key);
        token = r.IsTruncated && out.length < maxKeys ? r.NextContinuationToken : undefined;
      } while (token);
      return out.slice(0, maxKeys);
    },
    async putIfAbsent(key: string, body: Buffer, meta: { contentType: string; sha256: string; metadata?: Record<string, string> }) {
      try {
        await client.send(new PutObjectCommand({
          Bucket,
          Key: key,
          Body: body,
          ContentType: meta.contentType,
          ContentLength: body.length,
          IfNoneMatch: '*',
          Metadata: { ...(meta.metadata ?? {}), sha256: meta.sha256 },
        }));
        return { written: true };
      } catch (err: any) {
        // 412: the key appeared between our HEAD and our PUT. Not an overwrite.
        if (statusOf(err) === 412 || err?.name === 'PreconditionFailed') return { written: false };
        throw err;
      }
    },
  });
}
