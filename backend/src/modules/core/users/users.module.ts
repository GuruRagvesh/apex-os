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
import { GatewayModule } from '../../platform/gateway/gateway.module';
import { TransitionCapabilitiesService } from './transitions/capabilities.service';

@Module({
  imports: [forwardRef(() => NotificationsModule), EmailModule, BackupVaultModule, GatewayModule],
  providers: [UsersService, ChangeRequestsService, ScheduledUserActivationService, UserSetupIssuesService, TransitionCapabilitiesService],
  controllers: [UsersController, ChangeRequestsController],
  exports: [UsersService, ChangeRequestsService, ScheduledUserActivationService, UserSetupIssuesService, TransitionCapabilitiesService],
})
export class UsersModule {}
