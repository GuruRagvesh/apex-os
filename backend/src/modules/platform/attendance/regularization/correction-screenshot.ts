import { BadRequestException } from '@nestjs/common';
import { readImageDimensions } from '../punch/image-header';
export const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
export const MAX_SCREENSHOTS = 3;
export const SCREENSHOT_METADATA = { id: true, filename: true, mimeType: true, byteSize: true, createdAt: true } as const;
export interface ScreenshotUpload { buffer: Buffer; mimetype: string; originalname: string; size: number; }
export function validateScreenshots(files: ScreenshotUpload[]) {
  if (files.length > MAX_SCREENSHOTS) throw new BadRequestException('Attach up to 3 screenshots.');
  return files.map(file => {
    if (!Buffer.isBuffer(file.buffer) || !file.buffer.length || file.buffer.length > MAX_SCREENSHOT_BYTES || file.size !== file.buffer.length) throw new BadRequestException('Each screenshot must be no larger than 2 MB.');
    const dimensions = readImageDimensions(file.buffer);
    const type = dimensions ? { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }[dimensions.format] : null;
    if (!type || type !== file.mimetype || !dimensions || dimensions.width < 1 || dimensions.height < 1 || dimensions.width > 16000 || dimensions.height > 16000 || dimensions.width * dimensions.height > 40000000) throw new BadRequestException('Use a valid PNG, JPEG or WebP screenshot.');
    const filename = (file.originalname || 'screenshot').split(/[\\/]/).pop()!.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 160) || 'screenshot';
    return { filename, mimeType: type, byteSize: file.buffer.length, content: file.buffer };
  });
}
