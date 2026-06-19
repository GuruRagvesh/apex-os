import { Module, forwardRef } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { ChangeRequestsService } from './change-requests.service';
import { ChangeRequestsController } from './change-requests.controller';
import { NotificationsModule } from '../../operations/notifications/notifications.module';
import { EmailModule } from '../../platform/email/email.module';

@Module({
  imports: [forwardRef(() => NotificationsModule), EmailModule],
  providers: [UsersService, ChangeRequestsService],
  controllers: [UsersController, ChangeRequestsController],
  exports: [UsersService, ChangeRequestsService],
})
export class UsersModule {}
