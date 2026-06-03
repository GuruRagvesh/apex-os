import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { ChangeRequestsService } from './change-requests.service';
import { ChangeRequestsController } from './change-requests.controller';

@Module({
  providers: [UsersService, ChangeRequestsService],
  controllers: [UsersController, ChangeRequestsController],
  exports: [UsersService, ChangeRequestsService],
})
export class UsersModule {}
