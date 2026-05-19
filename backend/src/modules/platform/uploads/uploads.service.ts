import { Injectable } from '@nestjs/common';
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
          { folder: `nexus/tickets/${ticketId}`, resource_type: 'auto' },
          (err, result) => (err ? reject(err) : resolve(result)),
        );
        stream.end(file.buffer);
      });
      url = result.secure_url;
    } else {
      // Fallback: store filename only (no actual upload)
      console.warn('[UploadsService] Cloudinary not configured — using local fallback');
      url = `/uploads/${file.originalname}`;
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
}
