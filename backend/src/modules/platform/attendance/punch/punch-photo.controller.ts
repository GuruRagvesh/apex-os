import {
  BadRequestException,
  Body,
  Controller,
  Post,
  ServiceUnavailableException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../../../../shared/decorators/current-user.decorator';
import { MAX_PHOTO_BYTES, PunchPhotoService } from './punch-photo.service';
import { PunchFeatureDisabledError, PunchPhotoValidationError } from './punch-evidence.types';

/**
 * Attendance photo capture (PE-3).
 *
 * Its own controller because it sits at /attendance/punch-photo rather than
 * under the evidence route, and because staging a capture is a different
 * operation from recording a punch.
 *
 * There is no GET, no list and no delete: a capture is written once, consumed
 * once, and read only through the owning punch's evidence.
 */
@ApiTags('Attendance Punch Photo')
@Controller('attendance/punch-photo')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PunchPhotoController {
  constructor(private readonly punchPhoto: PunchPhotoService) {}

  /**
   * Uploads one live camera capture and returns an opaque asset id.
   *
   * Accepts BYTES, never a URL. The server derives the owner from the JWT, the
   * storage location and the SHA-256; none of those may be supplied by the
   * caller.
   *
   * This endpoint deliberately does NOT create punch evidence -- the capture is
   * staged here, then consumed by POST /attendance/punch-evidence.
   */
  @Post()
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: { fileSize: MAX_PHOTO_BYTES },
      fileFilter: (_req, file, cb) => {
        // First gate only. The authoritative check is the magic-byte comparison
        // in the service, because a client can label anything image/jpeg.
        const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
        if (ALLOWED.includes(file.mimetype)) cb(null, true);
        else cb(new BadRequestException(`Photo type "${file.mimetype}" is not allowed`), false);
      },
    }),
  )
  async upload(
    @CurrentUser() user: any,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { clientCapturedAt?: string },
  ) {
    const userId = user?.id ?? user?.sub;
    try {
      const asset = await this.punchPhoto.upload(userId, file as any, body?.clientCapturedAt);
      // Only the opaque id and its expiry leave the server. Never the object
      // key, never a URL, never the hash.
      return { photoAssetId: asset.id, expiresAt: asset.expiresAt };
    } catch (err) {
      if (err instanceof PunchFeatureDisabledError) {
        throw new ServiceUnavailableException(err.message);
      }
      if (err instanceof PunchPhotoValidationError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }
}
