import { Module } from '@nestjs/common';
import { PolicyVersionService } from './policy-version.service';

/**
 * Versioned policy lifecycle (Attendance Base Layer, BL-4).
 *
 * No controller yet, matching the calendar and timeline modules: policy
 * activation is a maker-checker action and must not be exposed over HTTP until
 * the admin surface (BL-6) defines its permissions. TVAService and
 * PrismaService arrive through the global CommonModule.
 */
@Module({
  providers: [PolicyVersionService],
  exports: [PolicyVersionService],
})
export class PolicyVersionModule {}
