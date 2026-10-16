import { Module, forwardRef } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { ChangeRequestsService } from './change-requests.service';
import { ChangeRequestsController } from './change-requests.controller';
import { NotificationsModule } from '../../operations/notifications/notifications.module';
import { EmailModule } from '../../platform/email/email.module';
import { BackupVaultModule } from '../../platform/backup-vault/backup-vault.module';
import { ScheduledUserActivationService } from './scheduled-user-activation.service';
import { UserSetupIssuesService } from './user-setup-issues.service';

@Module({
  imports: [forwardRef(() => NotificationsModule), EmailModule, BackupVaultModule],
  providers: [UsersService, ChangeRequestsService, ScheduledUserActivationService, UserSetupIssuesService],
  controllers: [UsersController, ChangeRequestsController],
  exports: [UsersService, ChangeRequestsService, ScheduledUserActivationService, UserSetupIssuesService],
})
export class UsersModule {}
