import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { Roles } from '../../../shared/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { ROLES } from '../../../shared/constants/roles';
import { HierarchyService } from './hierarchy.service';

@ApiTags('Organization hierarchy')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
@Controller('organization-hierarchy')
export class HierarchyController {
  constructor(private readonly hierarchy: HierarchyService) {}

  @Get()
  getMap() {
    return this.hierarchy.getMap();
  }

  @Get('organization')
  getOrganizationMap() {
    return this.hierarchy.getOrganizationMap();
  }

  /**
   * Bounded directory lookup for the hierarchy editor. Keeping this separate
   * from the map prevents a 1,000-person company from turning an edit control
   * into a 1,000-option browser dropdown.
   */
  @Get('organization/directory')
  getOrganizationDirectory(@Query() query: Record<string, string | undefined>) {
    return this.hierarchy.getOrganizationDirectory(query);
  }

  @Post('apply')
  apply(
    @CurrentUser() actor: any,
    @Body() body: { operations?: Array<Record<string, unknown>> },
  ) {
    return this.hierarchy.apply(actor.id, body?.operations);
  }

  @Post('organization')
  applyOrganization(
    @CurrentUser() actor: any,
    @Body() body: { operations?: Array<Record<string, unknown>> },
  ) {
    return this.hierarchy.applyOrganization(actor.id, body?.operations);
  }
}
