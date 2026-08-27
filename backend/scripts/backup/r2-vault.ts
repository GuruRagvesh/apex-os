import { createHash } from 'crypto';
import { createReadStream, statSync } from 'fs';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Readable } from 'stream';

/**
 * The independent backup vault: Cloudflare R2, reached over its S3-compatible
 * API.
 *
 * Behind an interface on purpose. Every rule that decides whether a backup
 * counts lives in the orchestrator, and the orchestrator must be testable
 * without credentials or a network — so the tests supply a fake vault and the
 * real one is a thin adapter with no judgement of its own.
 *
 * R2 has no regions in the AWS sense but the SDK requires the field, so it is
 * set to 'auto', which is what Cloudflare documents. Nothing here should ever
 * behave differently per region.
 *
 * The bucket is private. This client never sets an ACL, never generates a
 * public URL, and never logs a credential.
 */

export interface VaultObjectSummary {
  key: string;
  byteSize: number;
  lastModified: string;
}

export interface Vault {
  put(key: string, filePath: string, contentType?: string): Promise<void>;
  head(key: string): Promise<{ key: string; byteSize: number } | null>;
  getToFile(key: string, destinationPath: string): Promise<void>;
  list(prefix: string): Promise<VaultObjectSummary[]>;
  remove(key: string): Promise<void>;
}

export class VaultNotConfigured extends Error {
  constructor(missing: string[]) {
    super(
      `Backup vault is not configured. Missing: ${missing.join(', ')}. ` +
        'Refusing to run: a backup with nowhere to go is not a backup.',
    );
    this.name = 'VaultNotConfigured';
  }
}

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/**
 * Reads the vault configuration, or refuses.
 *
 * Deliberately strict: a partially configured vault would let a job get as far
 * as producing a dump before failing, which wastes a maintenance window and
 * leaves a temporary file behind.
 */
export function readR2Config(env: NodeJS.ProcessEnv): R2Config {
  const required = {
    R2_ACCOUNT_ID: env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET: env.R2_BUCKET,
  };
  const missing = Object.entries(required)
    .filter(([, v]) => !v || !String(v).trim())
    .map(([k]) => k);
  if (missing.length > 0) throw new VaultNotConfigured(missing);

  return {
    accountId: required.R2_ACCOUNT_ID!.trim(),
    accessKeyId: required.R2_ACCESS_KEY_ID!.trim(),
    secretAccessKey: required.R2_SECRET_ACCESS_KEY!.trim(),
    bucket: required.R2_BUCKET!.trim(),
  };
}

export function createR2Vault(config: R2Config): Vault {
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  const Bucket = config.bucket;

  return {
    async put(key, filePath, contentType = 'application/octet-stream') {
      // Streamed rather than buffered: a production dump can be far larger
      // than the job's memory.
      const { size } = statSync(filePath);
      await client.send(
        new PutObjectCommand({
          Bucket,
          Key: key,
          Body: createReadStream(filePath),
          ContentType: contentType,
          ContentLength: size,
        }),
      );
    },

    async head(key) {
      try {
        const res = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { key, byteSize: Number(res.ContentLength ?? 0) };
      } catch (err: any) {
        // A genuinely absent object is an answer. Anything else is a fault and
        // must not be reported as "not there", which would read as a clean
        // failure rather than an unknown one.
        const status = err?.$metadata?.httpStatusCode;
        if (status === 404 || err?.name === 'NotFound' || err?.name === 'NoSuchKey') return null;
        throw err;
      }
    },

    async getToFile(key, destinationPath) {
      const { createWriteStream } = await import('fs');
      const { pipeline } = await import('stream/promises');
      const res = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      if (!res.Body) throw new Error(`Vault returned no body for ${key}`);
      await pipeline(res.Body as Readable, createWriteStream(destinationPath));
    },

    async list(prefix) {
      const out: VaultObjectSummary[] = [];
      let token: string | undefined;
      do {
        const res = await client.send(
          new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }),
        );
        for (const o of res.Contents ?? []) {
          if (!o.Key) continue;
          out.push({
            key: o.Key,
            byteSize: Number(o.Size ?? 0),
            lastModified: (o.LastModified ?? new Date(0)).toISOString(),
          });
        }
        // Paginated deliberately: a truncated listing would make the retention
        // sweep believe the vault is smaller than it is.
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (token);
      return out;
    },

    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
  };
}

/** SHA-256 of a file, streamed so size does not matter. */
export async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
