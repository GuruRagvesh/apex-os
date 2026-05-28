import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { v2 as cloudinary } from 'cloudinary';

@Injectable()
export class UploadsService {
  private configured = false;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    const cloudName = this.configService.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.configService.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = this.configService.get<string>('CLOUDINARY_API_SECRET');

    if (cloudName && apiKey && apiSecret) {
      cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
      this.configured = true;
    } else {
      console.warn('[UploadsService] Cloudinary not configured â€” file uploads will be skipped');
    }
  }

  async uploadTicketAttachment(
    ticketId: string,
    file: Express.Multer.File,
    isPoc = false,
    pocFor?: string,
  ) {
    let url = '';

    if (this.configured) {
      const result = await new Promise<any>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: `apex/tickets/${ticketId}`, resource_type: 'auto', type: 'authenticated' },
          (err, result) => (err ? reject(err) : resolve(result)),
        );
        stream.end(file.buffer);
      });
      url = this.toCloudinaryReference(result);
    } else {
      // Fallback: store as base64 data URL so the browser can display/download it
      console.warn('[UploadsService] Cloudinary not configured — using base64 fallback');
      url = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
    }

    return this.prisma.attachment.create({
      data: {
        ticketId,
        filename: file.originalname,
        url,
        size: file.size,
        mimeType: file.mimetype,
        isPoc,
        pocFor: pocFor ?? (isPoc ? ticketId : undefined),
      },
    });
  }

  async deleteAttachment(attachmentId: string) {
    return this.prisma.attachment.delete({ where: { id: attachmentId } });
  }

  async readAttachment(attachment: { url: string; mimeType?: string | null }) {
    const storedUrl = attachment.url ?? '';
    if (storedUrl.startsWith('data:')) {
      const match = storedUrl.match(/^data:([^;,]+)?;base64,(.*)$/);
      if (!match) throw new BadGatewayException('Stored attachment data is invalid');
      return {
        buffer: Buffer.from(match[2], 'base64'),
        contentType: match[1] || attachment.mimeType || 'application/octet-stream',
      };
    }

    const remoteUrl = storedUrl.startsWith('cloudinary:authenticated:')
      ? this.signedCloudinaryUrl(storedUrl)
      : storedUrl;

    if (!/^https?:\/\//i.test(remoteUrl)) {
      throw new BadGatewayException('Stored attachment location is invalid');
    }

    const response = await (globalThis as any).fetch(remoteUrl);
    if (!response?.ok) {
      throw new BadGatewayException('Attachment storage could not be reached');
    }

    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers?.get?.('content-type') || attachment.mimeType || 'application/octet-stream',
    };
  }

  private toCloudinaryReference(result: any) {
    const resourceType = result.resource_type || 'raw';
    const publicId = encodeURIComponent(result.public_id || '');
    const format = encodeURIComponent(result.format || '');
    return `cloudinary:authenticated:${resourceType}:${publicId}:${format}`;
  }

  private signedCloudinaryUrl(reference: string) {
    const [, , resourceType, publicId, format] = reference.split(':');
    if (!publicId) throw new BadGatewayException('Stored attachment reference is invalid');
    return cloudinary.url(decodeURIComponent(publicId), {
      resource_type: resourceType || 'raw',
      type: 'authenticated',
      secure: true,
      sign_url: true,
      format: format ? decodeURIComponent(format) : undefined,
    });
  }
}
