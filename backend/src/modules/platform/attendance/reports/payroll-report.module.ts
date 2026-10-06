import { Module } from '@nestjs/common';
import { PayrollReportService } from './payroll-report.service';
import { PayrollReportController } from './payroll-report.controller';
import { SettingsModule } from '../../settings/settings.module';
import { EmailModule } from '../../email/email.module';

/**
 * Monthly attendance for payroll.
 *
 * Reuses the existing settings and email modules rather than introducing a
 * second configuration store or a second mail stack. PrismaService, TVAService,
 * AccessPolicyService and EventLoggerService come from the global CommonModule.
 */
@Module({
  imports: [SettingsModule, EmailModule],
  controllers: [PayrollReportController],
  providers: [PayrollReportService],
  exports: [PayrollReportService],
})
export class PayrollReportModule {}
