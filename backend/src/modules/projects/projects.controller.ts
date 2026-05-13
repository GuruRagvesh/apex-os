import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private projectsService: ProjectsService) {}

  @Get()
  findAll(@Query() query: any) { return this.projectsService.findAll(query); }

  @Get('stats')
  getStats() { return this.projectsService.getStats(); }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.projectsService.findOne(id); }

  @Post()
  create(@Body() body: any, @CurrentUser() user: any) {
    return this.projectsService.create(body, user.id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.projectsService.update(id, body);
  }

  @Post(':id/members')
  addMember(@Param('id') id: string, @Body() body: { userId: string; role?: string }) {
    return this.projectsService.addMember(id, body.userId, body.role);
  }

  @Delete(':id/members/:userId')
  removeMember(@Param('id') id: string, @Param('userId') userId: string) {
    return this.projectsService.removeMember(id, userId);
  }

  @Delete(':id')
  remove(@Param('id') id: string) { return this.projectsService.remove(id); }
}
