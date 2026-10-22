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
    const allowedFields = [
      'companyName', 'logoUrl', 'contactEmail', 'website', 'country', 'timezone',
      'currency', 'registeredOffice', 'headOffice', 'workingDays',
    ];
    if (Object.keys(rest).some((field) => !allowedFields.includes(field))) {
      throw new BadRequestException('Unknown company setting');
    }
    for (const [field, value] of Object.entries(rest)) {
      const limit = ['registeredOffice', 'headOffice'].includes(field) ? 500 : 200;
      if (typeof value !== 'string' || value.length > limit) {
        throw new BadRequestException(`${field} must be text of at most ${limit} characters`);
      }
    }
    const requiredFields = ['companyName', 'logoUrl', 'contactEmail', 'website', 'country', 'timezone', 'currency', 'registeredOffice', 'headOffice'];
    for (const field of requiredFields) {
      if (rest[field] !== undefined && !rest[field].trim()) {
        throw new BadRequestException(`${field} is required`);
      }
    }
    if (rest.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rest.contactEmail)) {
      throw new BadRequestException('Invalid contact email');
    }
    if (rest.website) {
      try {
        const website = new URL(rest.website);
        if (website.protocol !== 'https:') throw new Error();
      } catch {
        throw new BadRequestException('Website must be a valid HTTPS URL');
      }
    }
    if (rest.logoUrl && !rest.logoUrl.startsWith('/')) {
      try {
        const logoUrl = new URL(rest.logoUrl);
        if (logoUrl.protocol !== 'https:') throw new Error();
      } catch {
        throw new BadRequestException('Logo must use a local path or valid HTTPS URL');
      }
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
      const normalized = Object.fromEntries(Object.entries(rest).map(([field, value]) => [field, (value as string).trim()]));
      await this.settings.set('company', { ...current, ...normalized }, req.user?.sub);
    }
    return this.settings.getCompanyWithTheme();
  }

  @Get('leave-policy')
  @UseGuards(RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
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
  updateLeavePolicy() {
    throw new BadRequestException('Direct leave-policy updates are disabled until effective dates, impact preview and historical safeguards are available.');
  }

  @Get('sla')
  @UseGuards(RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
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
  updateSla() {
    throw new BadRequestException('Direct SLA updates are disabled until effective dates, impact preview and historical safeguards are available.');
  }

  @Get('workday-policy')
  @UseGuards(RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  getWorkdayPolicy() {
    return this.settings.getWorkdayPolicy();
  }

  @Patch('workday-policy')
  @UseGuards(RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
  updateWorkdayPolicy() {
    throw new BadRequestException('Direct workday-policy updates are disabled until effective dates, impact preview and historical safeguards are available.');
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
