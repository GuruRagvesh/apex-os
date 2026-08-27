import { Module } from '@nestjs/common';
import { PunchPhotoStorage } from './punch-photo.storage';

/**
 * Provides PunchPhotoStorage on its own.
 *
 * It exists so the health route can ask whether attendance photo storage is
 * configured without importing PunchEvidenceModule, which drags in the daily
 * context, settings and workday modules — far too much for a route Render may
 * be polling for liveness, and a circular-import risk besides.
 *
 * This module imports nothing (ConfigModule is global), so it is a leaf and
 * cannot participate in a cycle. Both consumers share one instance, which
 * keeps PunchPhotoStorage the single authority on whether storage is
 * configured rather than letting a second copy of that rule appear elsewhere.
 */
@Module({
  providers: [PunchPhotoStorage],
  exports: [PunchPhotoStorage],
})
export class PunchPhotoStorageModule {}
