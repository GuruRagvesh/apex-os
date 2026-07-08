import { Module } from '@nestjs/common';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DepartmentsModule } from '../../core/departments/departments.module';

@Module({
  imports: [PrismaModule, NotificationsModule, DepartmentsModule],
  controllers: [TeamController, TeamsController],
  providers: [TeamService, TeamsService],
})
export class TeamModule {}
