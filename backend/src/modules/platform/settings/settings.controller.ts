import { BadRequestException, Body, Controller, Get, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/guards/jwt-auth.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/decorators/roles.decorator';
import { SettingsService } from './settings.service';
import { ROLES } from '../../../shared/constants/roles';
import { EmailService } from '../email/email.service';



@ApiTags('Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly emailService: EmailService,
  ) {}

  @Get('company')
  getCompany() {
    return this.settings.getCompanyWithTheme();
  }

  @Patch('company')
  @UseGuards(RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  async updateCompany(@Body() body: any, @Request() req: any) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Company settings must be an object');
    }
    const { defaultTheme, defaultAccent, ...rest } = body;
    const allowedFields = ['companyName', 'tagline', 'contactEmail', 'timezone', 'branding', 'workingDays'];
    if (Object.keys(rest).some((field) => !allowedFields.includes(field))) {
      throw new BadRequestException('Unknown company setting');
    }
    for (const [field, value] of Object.entries(rest)) {
      if (typeof value !== 'string' || value.length > 200) {
        throw new BadRequestException(`${field} must be text of at most 200 characters`);
      }
    }
    if (rest.companyName !== undefined && !rest.companyName.trim()) {
      throw new BadRequestException('Company name is required');
    }
    if (rest.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rest.contactEmail)) {
      throw new BadRequestException('Invalid contact email');
    }
    if (rest.timezone) {
      try { new Intl.DateTimeFormat('en-US', { timeZone: rest.timezone }); }
      catch { throw new BadRequestException('Invalid company timezone'); }
    }
    if (defaultTheme !== undefined || defaultAccent !== undefined) {
      await this.settings.upsertThemeDefaults(defaultTheme, defaultAccent, req.user?.sub);
    }
    // A theme-only save must never replace company information with {}.
    if (Object.keys(rest).length > 0) {
      const current = await this.settings.get('company');
      await this.settings.set('company', { ...current, ...rest }, req.user?.sub);
    }
    return this.settings.getCompanyWithTheme();
  }

  @Get('leave-policy')
  getLeavePolicy() {
    return this.settings.get('leave_policy');
  }

  @Get('leave-policy/versions')
  @UseGuards(RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  getLeavePolicyVersions() {
    return this.settings.getActiveLeavePolicies();
  }

  @Patch('leave-policy')
  @UseGuards(RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  updateLeavePolicy(@Body() body: any, @Request() req: any) {
    return this.settings.set('leave_policy', body, req.user?.sub);
  }

  @Get('sla')
  async getSla() {
    const [executionSla, reviewSla] = await Promise.all([
      this.settings.getSlaHours(),
      this.settings.getReviewSlaHours(),
    ]);
    return { ...executionSla, reviewSla };
  }

  @Patch('sla')
  @UseGuards(RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  async updateSla(@Body() body: any, @Request() req: any) {
    const { reviewSla, ...executionSla } = body;
    const ops: Promise<any>[] = [this.settings.set('sla', executionSla, req.user?.sub)];
    if (reviewSla) ops.push(this.settings.set('review_sla', reviewSla, req.user?.sub));
    await Promise.all(ops);
    return this.getSla();
  }

  @Get('workday-policy')
  getWorkdayPolicy() {
    return this.settings.getWorkdayPolicy();
  }

  @Patch('workday-policy')
  @UseGuards(RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  updateWorkdayPolicy(@Body() body: any, @Request() req: any) {
    return this.settings.updateWorkdayPolicy(body, req.user?.sub);
  }

  @Get('smtp')
  @UseGuards(RolesGuard)
  @Roles(ROLES.SUPER_ADMIN)
  async getSmtp() {
    return { host: '', port: '587', email: '', password: '' };
  }

  @Patch('smtp')
  @UseGuards(RolesGuard)
  @Roles(ROLES.SUPER_ADMIN)
  async updateSmtp() {
    throw new BadRequestException('SMTP configuration is deprecated. Only Resend is supported.');
  }

  @Post('email/test')
  @UseGuards(RolesGuard)
  @Roles(ROLES.SUPER_ADMIN)
  async testEmail(@Body() body: any) {
    return this.emailService.sendTestEmail(body?.to);
  }
}
