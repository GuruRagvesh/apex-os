/**
 * The real FileStore: reads and deletes original objects with the same
 * provider conventions the rest of the backend uses.
 *
 *   cloudinary     signed authenticated reads; `uploader.destroy` to delete
 *   local-private  the development-only private photo directory
 *   inline / database   bytes are already in hand; nothing to delete
 *   external-url   read over HTTPS; never deleted (not ours to manage)
 *
 * Errors carry no reference: callers map them to controlled codes.
 */

import { readFile, unlink } from 'fs/promises';
import { resolve } from 'path';
import { v2 as cloudinary } from 'cloudinary';
import { FileObject, FileProvider, FileStore } from './archive-files';

export class ProviderFileStoreError extends Error {
  constructor(readonly code: 'PROVIDER_UNAVAILABLE' | 'PROVIDER_REFUSED' | 'UNSUPPORTED') {
    super(code);
  }
}

export function createProviderFileStore(env: NodeJS.ProcessEnv, fetchImpl: any = (globalThis as any).fetch): FileStore {
  const cloudName = env.CLOUDINARY_CLOUD_NAME;
  const configured = !!(cloudName && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
  if (configured) {
    cloudinary.config({ cloud_name: cloudName, api_key: env.CLOUDINARY_API_KEY, api_secret: env.CLOUDINARY_API_SECRET });
  }
  const localDir = resolve(env.ATTENDANCE_PHOTO_LOCAL_DIR || resolve(process.cwd(), 'private', 'attendance-punch-photos'));

  const cloudinaryParts = (ref: string) => {
    // cloudinary:<type>:<resourceType>:<publicId>:<format>
    const [, type, resourceType, publicId, format] = ref.split(':');
    return { type, resourceType: resourceType || 'raw', publicId: decodeURIComponent(publicId ?? ''), format: format ? decodeURIComponent(format) : undefined };
  };

  const fetchBytes = async (url: string) => {
    let res: any;
    try {
      res = await fetchImpl(url);
    } catch {
      throw new ProviderFileStoreError('PROVIDER_UNAVAILABLE');
    }
    if (!res?.ok) throw new ProviderFileStoreError(res?.status === 404 ? 'PROVIDER_REFUSED' : 'PROVIDER_UNAVAILABLE');
    return { bytes: Buffer.from(await res.arrayBuffer()), mimeType: res.headers?.get?.('content-type') ?? null };
  };

  return {
    async read(file: FileObject) {
      if (file.bytes) return { bytes: file.bytes, mimeType: file.mimeType };
      if (file.provider === 'cloudinary') {
        if (!configured) throw new ProviderFileStoreError('PROVIDER_UNAVAILABLE');
        const p = cloudinaryParts(file.ref);
        const url = cloudinary.url(p.publicId, {
          resource_type: p.resourceType,
          type: p.type,
          secure: true,
          sign_url: true,
          format: p.format,
          ...(p.type === 'authenticated' ? { expires_at: Math.floor(Date.now() / 1000) + 300 } : {}),
        });
        const got = await fetchBytes(url);
        return { bytes: got.bytes, mimeType: file.mimeType ?? got.mimeType };
      }
      if (file.provider === 'local-private') {
        const [, name] = file.ref.split(':');
        if (!/^[0-9a-f-]+\.(?:jpg|png|webp|pdf)$/.test(name ?? '')) throw new ProviderFileStoreError('PROVIDER_REFUSED');
        try {
          return { bytes: await readFile(resolve(localDir, name)), mimeType: file.mimeType };
        } catch {
          throw new ProviderFileStoreError('PROVIDER_UNAVAILABLE');
        }
      }
      if (file.provider === 'external-url') return fetchBytes(file.ref.slice('url:'.length));
      throw new ProviderFileStoreError('UNSUPPORTED');
    },

    async remove(provider: FileProvider, ref: string) {
      if (provider === 'cloudinary') {
        if (!configured) throw new ProviderFileStoreError('PROVIDER_UNAVAILABLE');
        const p = cloudinaryParts(ref);
        let out: any;
        try {
          out = await cloudinary.uploader.destroy(p.publicId, { resource_type: p.resourceType, type: p.type, invalidate: true });
        } catch {
          throw new ProviderFileStoreError('PROVIDER_UNAVAILABLE');
        }
        if (out?.result === 'ok') return 'DELETED';
        if (out?.result === 'not found') return 'NOT_FOUND';
        throw new ProviderFileStoreError('PROVIDER_REFUSED');
      }
      if (provider === 'local-private') {
        const [, name] = ref.split(':');
        if (!/^[0-9a-f-]+\.(?:jpg|png|webp|pdf)$/.test(name ?? '')) throw new ProviderFileStoreError('PROVIDER_REFUSED');
        try {
          await unlink(resolve(localDir, name));
          return 'DELETED';
        } catch (err: any) {
          if (err?.code === 'ENOENT') return 'NOT_FOUND';
          throw new ProviderFileStoreError('PROVIDER_UNAVAILABLE');
        }
      }
      throw new ProviderFileStoreError('UNSUPPORTED');
    },
  };
}
