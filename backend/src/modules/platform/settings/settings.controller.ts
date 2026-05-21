import { Controller, Get, Patch, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/decorators/roles.decorator';
import { SettingsService } from './settings.service';

@ApiTags('Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  // ── Company ────────────────────────────────────────────────────────────────

  @Get('company')
  getCompany() {
    return this.settings.getCompanyWithTheme();
  }

  @Patch('company')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  async updateCompany(@Body() body: any, @Request() req: any) {
    const { defaultTheme, defaultAccent, ...rest } = body;
    if (defaultTheme || defaultAccent) {
      await this.settings.upsertThemeDefaults(defaultTheme, defaultAccent);
    }
    return this.settings.set('company', rest, req.user?.sub);
  }

  // ── Leave Policy ───────────────────────────────────────────────────────────

  @Get('leave-policy')
  getLeavePolicy() {
    return this.settings.get('leave_policy');
  }

  @Patch('leave-policy')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  updateLeavePolicy(@Body() body: any, @Request() req: any) {
    return this.settings.set('leave_policy', body, req.user?.sub);
  }

  // ── SLA ────────────────────────────────────────────────────────────────────

  @Get('sla')
  getSla() {
    return this.settings.get('sla');
  }

  @Patch('sla')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  updateSla(@Body() body: any, @Request() req: any) {
    return this.settings.set('sla', body, req.user?.sub);
  }

  // ── SMTP ───────────────────────────────────────────────────────────────────

  @Get('smtp')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  async getSmtp() {
    const data = await this.settings.get('smtp');
    // Mask password in response
    return { ...data, password: data?.password ? '••••••••' : '' };
  }

  @Patch('smtp')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  async updateSmtp(@Body() body: any, @Request() req: any) {
    // If password is the mask placeholder, preserve the existing password
    let value = { ...body };
    if (body.password === '••••••••') {
      const existing = await this.settings.get('smtp');
      value.password = existing?.password ?? '';
    }
    await this.settings.set('smtp', value, req.user?.sub);
    return { ...value, password: value.password ? '••••••••' : '' };
  }
}
